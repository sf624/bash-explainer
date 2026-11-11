import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { base, compareKnown, keyOf } from './support/scan';
import { ALLOWED, counted, scanAll, scanSource, type Kind } from './support/shell-checks';

// The guard of docs/design/sources.md (row 9, SC6): what the script's shell does comes from the table of src/shellfeatures.ts, the features and
// builtins of FEATURES, the behaviours of SHELL_BEHAVIOURS, and the questions over them (`isBash`, three-valued: in `sh` it is not known;
// `asBash`, `differIn`, `shellsOf`, `wordsFollowed`, `featureWorks`, `builtinIn`). The guard leaves that file out. So no other file of src/,
// cli/ or web/ may
//   - compare a shell with a shell's name (`shell === 'sh'`, `cx.shell !== 'bash'`, `'zsh' === opts.shell`), or switch on one (`case 'zsh':`);
//   - look a shell up in a list (`COMMON_SH.includes(shell)`, `POSIX_SHELLS.has(this.shell)`);
//   - write a list of shells' names (`['sh', 'dash', 'ash']`).
// A shell is an expression named `shell` or `sh`, or a property `.shell`. Not caught: a shell under another name, a map keyed by shells' names
// (`SHELL_NAMES`), and a test of whether a shell is said at all (`!shell`). test/fixtures/shell-checks-known.json lists what they do today, in two parts:
//   checks  places that decide by themselves what a shell does, each with the source it moves to (`to`: isBash, SHELL_BEHAVIOURS or FEATURES)
//           and what it decides. The list may only shrink: a new place fails the test, and so does an entry that no longer matches.
//   other   places that only look like one (a host's name of a program), a reason for each use.

const TO: ReadonlySet<string> = new Set(['isBash', 'SHELL_BEHAVIOURS', 'FEATURES']);
interface Use { fn: string; kind: Kind; count: number; reason: string }
interface Known {
  checks: { file: string; fn: string; kind: Kind; count: number; to: string; reason: string }[];
  other: { file: string; uses: Use[] }[];
}
const known: Known = JSON.parse(fs.readFileSync(path.join(base, 'test', 'fixtures', 'shell-checks-known.json'), 'utf8'));

/** The matches of a code snippet, as `kind what` texts. */
const found = (code: string): string[] => scanSource('src/x.ts', code).map((m) => `${m.kind} ${m.what}`);

describe('shell checks guard (docs/design/sources.md, SC6)', function () {
  // (The scan of every source takes up to 9 s under coverage in CI, beside the browser tests of other workers: mocha's 10 s is too close.)
  this.timeout(60000);

  it('finds every kind of match', () => {
    assert.deepStrictEqual(found("function f(shell, cx) { return shell === 'sh' || cx.shell !== 'bash' || 'zsh' == opts.shell || (cx.state.shell) === 'dash'; }"),
      ["compare shell === 'sh'", "compare cx.shell !== 'bash'", "compare 'zsh' == opts.shell", "compare (cx.state.shell) === 'dash'"]);
    assert.deepStrictEqual(found("function f(sh) { switch (sh) { case 'ksh': return 1; case 'x': return 2; } }"), ['case ksh']);
    assert.deepStrictEqual(found('function f(shell) { return COMMON_SH.includes(shell) || S.has(this.shell) || L.indexOf(shell!) >= 0; }'),
      ['member COMMON_SH.includes(shell)', 'member S.has(this.shell)', 'member L.indexOf(shell!)']);
    assert.deepStrictEqual(found("const S = ['dash', 'ash'];"), ["list ['dash', 'ash']"]);
  });

  it('leaves out what is not a shell', () => {
    // Another name, a name that is no shell's, one name alone in a list, a map keyed by shells, a test of absence.
    assert.deepStrictEqual(found("function f(n, shell, cx) { return n === 'bash' || shell === 'unknown' || cx.kind === 'sh' || ['zsh'] || { sh: 1, dash: 2 } || !shell || x.includes(n); }"), []);
    assert.deepStrictEqual(found("function f(k) { switch (k) { case 'zsh': return 1; } return ['bash', 'x']; }"), []);
  });

  it('names the outermost named function around a match', () => {
    const m = scanSource('src/x.ts', "export function outer(shell) { const inner = () => shell === 'zsh'; return inner(); } class C { method(cx) { return cx.shell === 'sh'; } } const T = ['dash', 'ash'];");
    assert.deepStrictEqual(m.map((x) => x.fn), ['outer', 'method', 'T']);
  });

  it('keeps the allow-list to files that exist', () => {
    for (const a of ALLOWED) assert.ok(fs.existsSync(path.join(base, a)), `${a} is gone: remove it from ALLOWED`);
  });

  it('lists every match outside the allow-list, no more and no fewer', () => {
    const actual = new Map(counted(scanAll()).map((e) => [keyOf(e.file, e.fn, e.kind), e.count]));
    const listed = new Map<string, number>();
    const problems: string[] = [];
    const list = (file: string, fn: string, kind: string, count: number, where: string): void => {
      const k = keyOf(file, fn, kind);
      if (listed.has(k)) problems.push(`${k} is listed twice (${where})`);
      listed.set(k, count);
    };
    for (const c of known.checks) {
      if (!TO.has(c.to)) problems.push(`checks: ${keyOf(c.file, c.fn, c.kind)} names no source it moves to ("${c.to}")`);
      if (typeof c.reason !== 'string' || c.reason.trim() === '') problems.push(`checks: ${keyOf(c.file, c.fn, c.kind)} has no reason`);
      list(c.file, c.fn, c.kind, c.count, 'checks');
    }
    for (const o of known.other) {
      for (const u of o.uses) {
        if (typeof u.reason !== 'string' || u.reason.trim() === '') problems.push(`other: ${keyOf(o.file, u.fn, u.kind)} has no reason`);
        list(o.file, u.fn, u.kind, u.count, 'other');
      }
    }
    problems.push(...compareKnown(actual, listed, 'ask the table of src/shellfeatures.ts (isBash, asBash with a row of SHELL_BEHAVIOURS, featureWorks with a row of FEATURES), adding a row where none says it, with its probe in test/shell-behaviours.test.ts; something that only looks like a shell goes into the "other" list of test/fixtures/shell-checks-known.json, with a reason'));
    assert.deepStrictEqual(problems, []);
  });
});
