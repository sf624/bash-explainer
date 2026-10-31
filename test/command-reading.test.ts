import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { base, compareKnown, isAllowed, keyOf, sourceFiles } from './support/scan';
import { ALLOWED, counted, optionRegex, scanAll, scanSource, type Kind } from './support/command-reading';

// The guard of docs/design/sources.md (row 2, step SA2): how a command takes its words (which are options, which are values, which are
// operands) comes from the argument interpreter (`interpret` in src/argv/, today; `commandRead(n)` on the model after stage SC2). So no
// other file calls `interpret`, or looks at a word's text for a dash (`/^-/`, `/^-[a-z]*r/`, `.startsWith('-')`, `=== '--'`,
// `[0] === '-'`) or for an option spelled out (`w.text === '-r'`, `before !== '-S'`, `.includes('-x')`, `['-n', '-e'].includes(w)`) to
// read an option. The rule is syntactic: it finds the calls and the tests, not the meaning, so a place that only looks like
// one is listed with its reason. test/fixtures/command-reading-known.json lists what src/ does today, in two parts:
//   deciders  places that read a command's words again, each `to` the source that replaces them (`commandRead`) and what they read.
//             The list may only shrink: a new entry fails the test, and so does an entry that no longer matches.
//   other     places that only look like a reading (the sign of a number, the operators of `[ ]`, a flag the interpreter already read,
//             another language), a reason for each use.
// Left out: src/argv/ (the source), src/dict/ (the specs), the embedded programs' own syntax in src/embedded/ file by file (src/embedded/yq.ts
// is scanned: judgeYq reads yq's options), the parser's adapter, the language interpreters in src/examples/, and the arithmetic. A
// comparison of an option with the interpreter's results (`flag`, `flags`, `of`, `names`, `op`, `role.*`, `spec.*`) is not a reading.
// cli/ parses the tool's own command line and is not scanned. Only tracked files are read (never a built bundle).
// Not caught, because the rule is syntactic and the rarer spellings are for code review: a regex that is not anchored at the start
// (`/^[-+]x/`), `slice(0, 1)` and `.at(0)` for the first character, option strings built in a template, `interpret` imported under
// another name, and a `Set` or `Map` of options (`OPTIONS.has(w)`).

interface Use { fn: string; kind: Kind; count: number; reason: string }
interface Known {
  deciders: { file: string; fn: string; kind: Kind; count: number; to: string; reason: string }[];
  other: { file: string; uses: Use[] }[];
}
const known: Known = JSON.parse(fs.readFileSync(path.join(base, 'test', 'fixtures', 'command-reading-known.json'), 'utf8'));

/** The matches of a snippet, as `kind what` texts. */
const found = (code: string, rel = 'src/x.ts'): string[] => scanSource(rel, code).map((m) => `${m.kind} ${m.what}`);

describe('command reading guard (docs/design/sources.md, SA2)', () => {
  it('finds every kind of match', () => {
    assert.deepStrictEqual(found('function f(s, a) { return interpret(s, a, {}) || r.interpret(s, a); }'), ['interpret-call interpret', 'interpret-call interpret']);
    assert.deepStrictEqual(found("function f(w) { return w.startsWith('-') || w.text.startsWith('--') || x.startsWith(`-n`); }"), ['dash-prefix startsWith:-', 'dash-prefix startsWith:--', 'dash-prefix startsWith:-n']);
    assert.deepStrictEqual(found("function f(w) { return w === '--' || '--' !== w.text || w[0] === '-' || '-' == w.charAt(0); }"), ['dash-prefix === \'--\'', 'dash-prefix === \'--\'', "dash-prefix [0] === '-'", "dash-prefix [0] === '-'"]);
    assert.deepStrictEqual(found('const A = /^-/; const B = /^-[a-z]*r/; const C = /^(?:-|--)x/; const D = /^(--?[^-=\\s]|--$)/; const E = new RegExp("^--quiet");'),
      ['option-regex /^-/', 'option-regex /^-[a-z]*r/', 'option-regex /^(?:-|--)x/', 'option-regex /^(--?[^-=\\s]|--$)/', 'option-regex /^--quiet/']);
  });

  it('leaves out what does not read an option', () => {
    // Numbers and lone dashes, unanchored patterns, other prefixes, other positions, other names.
    assert.deepStrictEqual(found('const A = /^-?\\d+$/; const B = /^-\\d+$/; const C = /^-$/; const D = /foo-/; const E = /a^-/; const F = /[-+]x/;'), []);
    assert.deepStrictEqual(found("function f(w) { return w.startsWith('a-') || w.endsWith('-') || w.includes('--') || w.startsWith(x) || w.startsWith(); }"), []);
    assert.deepStrictEqual(found("function f(w) { return w === '-' || w[1] === '-' || w.charAt(1) === '-' || w[0] === 'a' || w === '---' || w.x[0] === 1; }"), []);
    // An option spelled out: a word's text against an option, but not the interpreter's results or what is not an option.
    assert.deepStrictEqual(found("function f(w, words, before, n) { return w.text === '-r' || words[0] !== '-S' || '--posix' == before || staticWordValue(w) === '-print0' || n === '-q' || w.text.includes('-x') || ['-n', '-e'].includes(w.text); }"),
      ['option-literal === -r', 'option-literal === -S', 'option-literal === --posix', 'option-literal === -print0', 'option-literal === -q', 'option-literal includes:-x', 'option-literal includes:[-n…]']);
    assert.deepStrictEqual(found("function f(r, spec, flags, w) { return r.flag === '-r' || r.role.name === '-x' || spec.name !== '-S' || of === '-v' || flags.includes('-s') || ['-n', '-e'].includes(r.op) || w.text === '-' || w.text === '-1' || w.text === 'ab' || w.text === '-x y'; }"), []);
    assert.deepStrictEqual(found('function f(s) { return interpretation(s) || s.interpreted || reinterpret(s); }'), []);
    assert.strictEqual(optionRegex('^-?0\\d'), false);
    assert.strictEqual(optionRegex('-x'), false);
    assert.strictEqual(optionRegex('^(?:a|-x)'), false);
    assert.strictEqual(optionRegex('^((?:-x))'), true);
  });

  it('names the outermost named function around a match', () => {
    const m = scanSource('src/x.ts', "const top = 1; export function outer(a) { const inner = (x) => x.startsWith('-'); return inner(a); } class C { method(a) { return interpret(a); } } const T = /^-x/;");
    assert.deepStrictEqual(m.map((x) => x.fn), ['outer', 'method', 'T']);
  });

  it('keeps the allow-list to files that exist', () => {
    // The scan reads tracked files only: a built bundle or node_modules of a maintainer's checkout is never in it.
    assert.deepStrictEqual(sourceFiles('.').filter((f) => /[\\/](dist|node_modules)[\\/]/.test(f)), []);
    // The embedded programs are left out file by file; yq's options are read by hand, so its file is scanned.
    assert.ok(!isAllowed(ALLOWED, 'src/embedded/yq.ts'));
    assert.ok(isAllowed(ALLOWED, 'src/embedded/find.ts'));
    for (const a of ALLOWED) {
      if (a.endsWith('/')) assert.ok(fs.statSync(path.join(base, a)).isDirectory(), a);
      else assert.ok(fs.existsSync(path.join(base, a)), `${a} is gone: remove it from ALLOWED`);
    }
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
    for (const d of known.deciders) {
      if (d.to !== 'commandRead') problems.push(`deciders: ${keyOf(d.file, d.fn, d.kind)} names no source it moves to ("${d.to}")`);
      if (typeof d.reason !== 'string' || d.reason.trim() === '') problems.push(`deciders: ${keyOf(d.file, d.fn, d.kind)} has no reason`);
      list(d.file, d.fn, d.kind, d.count, 'deciders');
    }
    for (const o of known.other) {
      for (const u of o.uses) {
        if (typeof u.reason !== 'string' || u.reason.trim() === '') problems.push(`other: ${keyOf(o.file, u.fn, u.kind)} has no reason`);
        list(o.file, u.fn, u.kind, u.count, 'other');
      }
    }
    problems.push(...compareKnown(actual, listed, 'read the command through the interpreter\'s result (src/argv/interpret.ts; commandRead on the model after SC2) instead; a place that only looks like a reading goes into the "other" list of test/fixtures/command-reading-known.json, with a reason'));
    assert.deepStrictEqual(problems, []);
  });
});
