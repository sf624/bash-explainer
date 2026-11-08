// The note `errexit-stops-here` (docs/design/errexit-stop.md, U11b) against bash: on the line of a failing command,
// whether there is a note, and what it says (`stopContext`, src/explain/status.ts): that the script (or a subshell, or
// the EXIT trap) stops there, which traps run then and on which lines, and the status the script exits with. Each row
// is a script whose failing command is `sh -c 'exit 3'` (or `fail`, with its status `code`), after an `echo @@`; the
// actions of its traps print a word of their own, and `IN` and `AFTER` must not print after a stop. Where the model
// gives no note, bash must go on (`AFTER` prints). bash 5.2 (and 5.3, from `$BASH_EXPLAINER_BASH53`) runs every row in
// one process, in a cgroup (`runContained`).
import * as assert from 'assert';
import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { Analyzer } from '../src/analyzer';
import { stopContext, type StopContext } from '../src/explain/status';
import { errexitStopText, type StopTrap } from '../src/messages-errexit-stop';
import { shellState } from '../src/semantics/state';
import { statusModel } from '../src/semantics/status';
import { createUnbashParser } from '../src/syntax/adapters/unbash';
import { descendants, type SyntaxNode } from '../src/syntax/tree';
import { runContained } from './support/contained';
import { hasBash53, PROBE_BASH53 } from './support/probe';

const parser = createUnbashParser();
const FAIL = "sh -c 'exit 3'";

interface Row {
  readonly name: string;
  readonly script: string;
  /** The failing statement, as written (`FAIL` when absent), and the status it fails with (3). */
  readonly fail?: string;
  readonly code?: number;
  /** The status bash exits with where a trap's action changes it (the note hedges it). */
  readonly status?: number;
  /** A trap may run (set on some paths, or after code the model does not read): its words are not checked. */
  readonly maybe?: true;
}

const ROWS: Row[] = [
  // (Where a failure stops the script.)
  { name: 'a command at the top', script: `set -e\necho @@\n${FAIL}\necho AFTER` },
  { name: 'with an EXIT trap', script: `set -e\ntrap 'echo T1' EXIT\necho @@\n${FAIL}\necho AFTER` },
  { name: 'in a for loop', script: `set -e\ntrap 'echo T1' EXIT\nfor i in 1 2; do\n  echo @@\n  ${FAIL}\n  echo IN\ndone\necho AFTER` },
  { name: 'in a function called at the top', script: `set -e\ntrap 'echo T1' EXIT\nf() {\n  echo @@\n  ${FAIL}\n  echo IN\n}\nf\necho AFTER` },
  { name: 'a pipeline, with pipefail', script: `set -eo pipefail\ntrap 'echo T1' EXIT\necho @@\n${FAIL} | cat\necho AFTER`, fail: `${FAIL} | cat` },
  { name: 'an assignment of $( )', script: `set -e\ntrap 'echo T1' EXIT\necho @@\nx=$(${FAIL})\necho AFTER`, fail: `x=$(${FAIL})` },
  { name: 'a [[ ]] test', script: `set -e\ntrap 'echo T1' EXIT\necho @@\n[[ -d /nope/x ]]\necho AFTER`, fail: '[[ -d /nope/x ]]', code: 1 },
  { name: 'a [ ] test', script: `set -e\necho @@\n[ -d /nope/x ]\necho AFTER`, fail: '[ -d /nope/x ]', code: 1 },
  { name: 'an (( )) test', script: `set -e\ni=0\necho @@\n((i))\necho AFTER`, fail: '((i))', code: 1 },
  { name: 'a command not found', script: `set -e\ntrap 'echo T1' EXIT\necho @@\nno_such_command_u11b\necho AFTER`, fail: 'no_such_command_u11b', code: 127 },
  { name: 'two commands on a line', script: `set -e\ntrap 'echo T1' EXIT\necho @@\n${FAIL}; echo AFTER` },
  { name: 'a subshell', script: `set -e\ntrap 'echo T1' EXIT\necho @@\n( ${FAIL}; echo IN )\necho AFTER` },
  { name: 'in a subshell, on a line of its own', script: `set -e\ntrap 'echo T1' EXIT\n(\n  echo @@\n  ${FAIL}\n  echo IN\n)\necho AFTER` },
  { name: 'in a subshell with a trap of its own', script: `set -e\ntrap 'echo T1' EXIT\n(\n  trap 'echo T2' EXIT\n  echo @@\n  ${FAIL}\n  echo IN\n)\necho AFTER` },
  { name: 'in a pipeline stage, with pipefail', script: `set -eo pipefail\ntrap 'echo T1' EXIT\ntrue | {\n  echo @@\n  ${FAIL}\n  echo IN\n} | cat\necho AFTER` },
  { name: '$( ) with inherit_errexit', script: `set -e\nshopt -s inherit_errexit\ntrap 'echo T1' EXIT\nx=$(\n  echo @@ >&2\n  ${FAIL}\n  echo IN >&2\n)\necho AFTER` },
  // (The traps.)
  { name: 'before the trap is set (run 4, fix 1)', script: `set -e\necho @@\n${FAIL}\necho AFTER\ntrap 'echo T1' EXIT` },
  { name: 'a trap taken back', script: `set -e\ntrap 'echo T1' EXIT\ntrap - EXIT\necho @@\n${FAIL}\necho AFTER` },
  { name: 'a trap that runs nothing', script: `set -e\ntrap 'echo T1' EXIT\ntrap '' EXIT\necho @@\n${FAIL}\necho AFTER` },
  { name: 'a trap set on some paths', script: `set -e\nif [ -n "$1" ]; then trap 'echo T1' EXIT; fi\necho @@\n${FAIL}\necho AFTER`, maybe: true },
  { name: 'a trap set in a function', script: `set -e\ng() { trap 'echo T1' EXIT; }\ng\necho @@\n${FAIL}\necho AFTER` },
  { name: 'a trap set in a subshell', script: `set -e\n( trap 'echo T2' EXIT )\necho @@\n${FAIL}\necho AFTER` },
  { name: 'the function of the trap defined after it', script: `set -e\ntrap c EXIT\nc() { echo C; }\necho @@\n${FAIL}\necho AFTER` },
  { name: 'an action that fails', script: `set -e\nc() { echo C; sh -c 'exit 7'; echo D; }\ntrap c EXIT\necho @@\n${FAIL}\necho AFTER`, status: 7 },
  { name: 'an action that calls exit', script: `set -e\ntrap 'echo T1; exit 5' EXIT\necho @@\n${FAIL}\necho AFTER`, status: 5 },
  { name: 'an ERR trap and an EXIT trap', script: `set -e\ntrap 'echo E1' ERR\ntrap 'echo T1' EXIT\necho @@\n${FAIL}\necho AFTER` },
  { name: 'an ERR trap that calls exit', script: `set -e\ntrap 'echo E1; exit 9' ERR\necho @@\n${FAIL}\necho AFTER`, status: 9 },
  { name: 'an ERR trap, in a function', script: `set -e\ntrap 'echo E1' ERR\nf() {\n  echo @@\n  ${FAIL}\n  echo IN\n}\nf\necho AFTER` },
  { name: 'an ERR trap, in a function, with errtrace', script: `set -eE\ntrap 'echo E1' ERR\nf() {\n  echo @@\n  ${FAIL}\n  echo IN\n}\nf\necho AFTER` },
  { name: 'after source', script: `set -e\ntrap 'echo T1' EXIT\nsource ./lib.sh\necho @@\n${FAIL}\necho AFTER`, maybe: true },
  { name: 'after eval of a value', script: `set -e\neval "$(cat lib.sh)"\necho @@\n${FAIL}\necho AFTER`, maybe: true },
  { name: 'in the action of the EXIT trap', script: `set -e\nc() {\n  echo @@\n  ${FAIL}\n  echo IN\n}\ntrap c EXIT\necho AFTER` },
  // (Where bash goes on: no note.)
  { name: 'in an if condition', script: `set -e\necho @@\nif ${FAIL}; then :; fi\necho AFTER` },
  { name: 'left of &&', script: `set -e\necho @@\n${FAIL} && echo no\necho AFTER` },
  { name: 'right of || true', script: `set -e\necho @@\n${FAIL} || true\necho AFTER` },
  { name: 'after !', script: `set -e\necho @@\n! ${FAIL}\necho AFTER`, fail: `! ${FAIL}` },
  { name: 'a pipeline stage, without pipefail', script: `set -e\necho @@\n${FAIL} | cat\necho AFTER` },
  { name: '$( ) without inherit_errexit', script: `set -e\necho @@\nx=$(${FAIL}; echo y)\necho AFTER` },
  { name: 'a function called left of ||', script: `set -e\nf() {\n  ${FAIL}\n  echo in\n}\necho @@\nf || echo or\necho AFTER` },
  { name: 'without set -e', script: `echo @@\n${FAIL}\necho AFTER` },
];

/** The word each trap's action prints: `echo X` in it, or that of the function it calls (`c() { echo X; … }`). */
function markerOf(script: string, action: string): string[] {
  const out: string[] = [];
  for (const cmd of action.split(/[;\n]/).map((c) => c.trim()).filter(Boolean)) {
    const echo = /^echo (\w+)$/.exec(cmd);
    const body = new RegExp(`(?:^|\\n)${cmd}\\(\\) \\{ ([^}]*) \\}`).exec(script);
    if (echo) out.push(echo[1]);
    else if (body) out.push(...markerOf(script, body[1]));
    else if (cmd.startsWith('sh -c') || cmd.startsWith('exit')) break;
  }
  return out;
}

/** The words of the `trap` command on line `line` of `script` (1-based): its action's. */
function trapWords(script: string, line: number): string[] {
  const m = /trap '([^']*)'|trap (\w+)/.exec(script.split('\n')[line - 1]);
  assert.ok(m, `line ${line} holds no trap: ${script.split('\n')[line - 1]}`);
  return markerOf(script, m[1] ?? m[2]);
}

interface Expected { words: string[]; after: boolean; changes: boolean; maybe: boolean; lines: number[] }

/** What the note's params say bash prints after `@@` and how it ends. */
function expected(row: Row, ctx: StopContext | undefined, outer: StopContext | undefined): Expected {
  const out: Expected = { words: [], after: !ctx, changes: false, maybe: false, lines: [] };
  const traps = (c: StopContext | undefined): void => {
    for (const t of [c?.err, c?.exit].filter((x): x is StopTrap => !!x)) {
      if (t.line) out.lines.push(t.line);
      if (!t.sure) {
        out.maybe = true;
        continue;
      }
      out.words.push(...trapWords(row.script, t.line!));
      out.changes ||= !!(t.fails || t.exits);
    }
  };
  traps(ctx);
  // (A subshell that ends fails where it is: in the main shell, that stops it too.)
  if (ctx?.stops === 'subshell') traps(outer);
  return out;
}

const BASHES: [string, string][] = [['bash 5.2', 'bash'], ...(hasBash53 ? [['bash 5.3', PROBE_BASH53!] as [string, string]] : [])];

let dir: string;
before(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'errexit-stop-'));
});
after(() => fs.rmSync(dir, { recursive: true, force: true }));

/** Runs each script with `bash` in one process (a `lib.sh` beside them sets a trap): its output and its status. */
async function runAll(bash: string, scripts: readonly string[]): Promise<{ out: string; status: number }[]> {
  const cwd = fs.mkdtempSync(path.join(dir, 'run-'));
  fs.writeFileSync(path.join(cwd, 'lib.sh'), "trap 'echo L1' EXIT\n");
  scripts.forEach((s, i) => fs.writeFileSync(path.join(cwd, `r${i}.sh`), `${s}\n`));
  const driver = scripts.map((_, i) => `FUNCNEST=50 ${JSON.stringify(bash)} --norc --noprofile r${i}.sh > r${i}.out 2>&1; echo $? > r${i}.st`).join('\n');
  await runContained(['bash', '--norc', '-c', driver], cwd, { PATH: process.env.PATH }, 30000);
  return scripts.map((_, i) => ({ out: fs.readFileSync(path.join(cwd, `r${i}.out`), 'utf8'), status: Number(fs.readFileSync(path.join(cwd, `r${i}.st`), 'utf8')) }));
}

/** The failing statement of a row, and the subshell or `$( )` statement of the main shell around it. */
function failing(row: Row, root: SyntaxNode): { n: SyntaxNode; outer?: SyntaxNode } {
  const text = row.fail ?? FAIL;
  const n = descendants(root, ['command', 'pipeline', 'extended_test', 'arithmetic_command', 'negated_command']).find((c) => c.text === text)!;
  let outer: SyntaxNode | undefined = n.parent!;
  while (outer && !(outer.parent?.type === 'program')) outer = outer.parent!;
  return { n, ...(outer && outer !== n ? { outer } : {}) };
}

/** The stop notes of line `line` of `script`, in English. */
function notesOn(script: string, line: number): string[] {
  const ex = new Analyzer('en').explainLine(parser.parse(script), line);
  return (ex.facts ?? []).filter((f) => f.id === 'errexit-stops-here').map((f) => f.text);
}

describe('the note on where `set -e` stops the script, against bash (docs/design/errexit-stop.md, U11b)', function () {
  this.timeout(60000);
  before(function () {
    if (spawnSync('bash', ['--version']).status !== 0) this.skip();
  });

  for (const [label, bash] of BASHES) {
    it(`says what ${label} runs after each failure, on which lines, and its status`, async () => {
      const runs = await runAll(bash, ROWS.map((r) => r.script));
      const wrong: string[] = [];
      ROWS.forEach((row, i) => {
        const tree = parser.parse(row.script);
        const state = shellState(tree);
        const status = statusModel(state);
        const { n, outer } = failing(row, tree.root);
        assert.ok(n, `${row.name}: no failing statement`);
        const ctx = stopContext(state, status, n);
        const want = expected(row, ctx, outer && stopContext(state, status, outer));
        // (The line has a note where the statement stops a shell.)
        if (ctx && !notesOn(row.script, n.startPosition.row).length) wrong.push(`${row.name}: no note on its line`);
        const { out, status: got } = runs[i];
        const words = out.slice(out.lastIndexOf('@@\n') + 3).split('\n').filter((w) => /^[A-Z]\w*$/.test(w));
        const said = words.filter((w) => w !== 'AFTER' && w !== 'IN');
        if (want.maybe !== !!row.maybe) wrong.push(`${row.name}: the note says a trap may run: ${want.maybe}`);
        if (!want.maybe && ctx && ctx.stops !== 'unknown' && said.join(' ') !== want.words.join(' ')) wrong.push(`${row.name}: note ${want.words.join(' ') || '(none)'}, bash ${said.join(' ') || '(none)'}`);
        if (ctx?.later && (said.includes(trapWords(row.script, ctx.later.line)[0]) || ctx.later.line <= n.startPosition.row + 1)) wrong.push(`${row.name}: the later trap of line ${ctx.later.line} runs`);
        if (words.includes('IN') || words.includes('AFTER') !== want.after) wrong.push(`${row.name}: AFTER ${want.after ? 'runs' : 'does not run'} by the note, bash: ${words.join(' ')}`);
        if (!ctx) return;
        const wantStatus = want.changes ? row.status : row.code ?? 3;
        if (want.changes !== (row.status !== undefined) || got !== wantStatus) wrong.push(`${row.name}: status, note ${want.changes ? 'changed by the action' : row.code ?? 3}, bash ${got}`);
      });
      assert.deepStrictEqual(wrong, []);
    });
  }

  it('says when an EXIT trap runs as bash runs it (`idiom-exit-trap`: not on SIGKILL, nor after `exec cmd`)', async () => {
    // (Each way of ending the idiom's text names, and whether the trap's `T` prints.)
    const ways: [string, boolean][] = [
      ['true', true], ['exit 4', true], ["set -e\nsh -c 'exit 3'", true], ['kill -TERM $$', true], ['kill -INT $$', true], ['kill -HUP $$', true],
      ['kill -KILL $$', false], ['exec true', false], ['exec 3>/dev/null', true],
    ];
    const runs = await runAll('bash', ways.map(([end]) => `trap 'echo T' EXIT\n${end}`));
    assert.deepStrictEqual(runs.map((r) => /^T$/m.test(r.out)), ways.map(([, runs]) => runs));
    const idiom = new Analyzer('en').explainLine(parser.parse("trap 'rm -f x' EXIT"), 0).notes.join('\n');
    assert.match(idiom, /at its end, on `exit`, on an error, or on a signal such as SIGTERM or SIGINT; not when it is killed with SIGKILL, nor when `exec` replaces the shell/);
  });

  it('says that a trap may run after code it does not read, and names no line there', () => {
    for (const row of ROWS.filter((r) => /source|eval/.test(r.name))) {
      const line = row.script.split('\n').indexOf(FAIL);
      const [note] = notesOn(row.script, line);
      assert.match(note, /an ERR trap and an EXIT trap may run first/, row.name);
      assert.doesNotMatch(note, /line \d/, row.name);
    }
  });

  it('says each case of section 4 of the design, in English and in Japanese', () => {
    const tar = [{ kind: 'command', name: 'tar' }] as const;
    const cleanup = { sure: true, line: 19, action: 'cleanup', fails: true };
    const cases: [Parameters<typeof errexitStopText>[1], string, string][] = [
      [{ what: [{ kind: 'command', name: 'mkdir' }], stops: 'script' }, "If `mkdir` fails, `set -e` stops the script here, with `mkdir`'s status", '`mkdir` が失敗すると、`set -e` でスクリプトはここで終わり、`mkdir` の終了ステータスで終了する'],
      [{ what: tar, stops: 'script', exit: cleanup }, "If `tar` fails, `set -e` stops the script here: the EXIT trap of line 19 runs `cleanup`, and the script exits with `tar`'s status (or that of `cleanup`, if it fails)", '`tar` が失敗すると、`set -e` でスクリプトはここで終わり、行 19 の EXIT トラップの `cleanup` が実行され、`tar` の終了ステータスで終了する（`cleanup` が失敗したときはそのステータス）'],
      [{ what: tar, stops: 'script', exit: { ...cleanup, fails: false } }, "If `tar` fails, `set -e` stops the script here: the EXIT trap of line 19 runs `cleanup`, and the script exits with `tar`'s status", '`tar` が失敗すると、`set -e` でスクリプトはここで終わり、行 19 の EXIT トラップの `cleanup` が実行され、`tar` の終了ステータスで終了する'],
      [{ what: tar, stops: 'script', exit: { ...cleanup, fails: false, exits: true } }, "If `tar` fails, `set -e` stops the script here: the EXIT trap of line 19 runs `cleanup`, and the script exits with `tar`'s status (unless `cleanup` calls `exit`)", '`tar` が失敗すると、`set -e` でスクリプトはここで終わり、行 19 の EXIT トラップの `cleanup` が実行され、`tar` の終了ステータスで終了する（`cleanup` が `exit` を呼ばなければ）'],
      [{ what: tar, stops: 'script', exit: { ...cleanup, sure: false, fails: false } }, "If `tar` fails, `set -e` stops the script here, with `tar`'s status; the EXIT trap of line 19 may run first", '`tar` が失敗すると、`set -e` でスクリプトはここで終わり、`tar` の終了ステータスで終了する（先に行 19 の EXIT トラップが実行されることがある）'],
      [{ what: tar, stops: 'script', err: { sure: false }, exit: { sure: false } }, "If `tar` fails, `set -e` stops the script here, with `tar`'s status; an ERR trap and an EXIT trap may run first and change the status", '`tar` が失敗すると、`set -e` でスクリプトはここで終わり、`tar` の終了ステータスで終了する（先に ERR トラップと EXIT トラップが実行され、終了ステータスを変えることがある）'],
      [{ what: tar, stops: 'script', err: { sure: true, line: 4, action: 'echo E' }, exit: cleanup }, "If `tar` fails, `set -e` stops the script here: the ERR trap of line 4 runs `echo E`, then the EXIT trap of line 19 runs `cleanup`, and the script exits with `tar`'s status (or that of `cleanup`, if it fails)", '`tar` が失敗すると、`set -e` でスクリプトはここで終わり、行 4 の ERR トラップの `echo E`、行 19 の EXIT トラップの `cleanup` の順に実行され、`tar` の終了ステータスで終了する（`cleanup` が失敗したときはそのステータス）'],
      [{ what: [{ kind: 'pipeline' }], stops: 'script' }, "If the pipeline fails, `set -e` stops the script here, with the pipeline's status", 'パイプラインが失敗すると、`set -e` でスクリプトはここで終わり、パイプラインの終了ステータスで終了する'],
      [{ what: [{ kind: 'substitution', name: 'date' }], stops: 'script', later: { line: 19, action: 'cleanup' } }, "If `date` in `$( )` fails, `set -e` stops the script here, with `date`'s status; no EXIT trap is set yet, so `cleanup` (line 19) does not run", '`$( )` の中の `date` が失敗すると、`set -e` でスクリプトはここで終わり、`date` の終了ステータスで終了する（EXIT トラップはまだ設定されていないので、行 19 の `cleanup` は実行されない）'],
      [{ what: [{ kind: 'substitution' }], stops: 'script' }, 'If `$( )` fails, `set -e` stops the script here, with the status of `$( )`', '`$( )` が失敗すると、`set -e` でスクリプトはここで終わり、`$( )` の終了ステータスで終了する'],
      [{ what: [{ kind: 'test', text: '[[ … ]]' }], stops: 'script' }, 'If `[[ … ]]` is false, `set -e` stops the script here, with status 1', '`[[ … ]]` が偽だと、`set -e` でスクリプトはここで終わり、終了ステータス 1 で終了する'],
      [{ what: [{ kind: 'command', name: 'x' }], stops: 'subshell' }, "If `x` fails, `set -e` ends the subshell here, with `x`'s status", '`x` が失敗すると、`set -e` でサブシェルはここで終わり、`x` の終了ステータスで終了する'],
      [{ what: [{ kind: 'subshell' }], stops: 'script' }, 'If `( … )` fails, `set -e` stops the script here, with the status of `( … )`', '`( … )` が失敗すると、`set -e` でスクリプトはここで終わり、`( … )` の終了ステータスで終了する'],
      [{ what: [{ kind: 'command', name: 'x' }], stops: 'unknown' }, 'If `x` fails, `set -e` stops the shell it runs in (the script or a subshell)', '`x` が失敗すると、`set -e` で実行しているシェル（スクリプトかサブシェル）が止まる'],
      [{ what: [{ kind: 'command', name: 'rm' }], stops: 'exit-trap' }, "If `rm` fails, `set -e` ends the EXIT trap here, and the script exits with `rm`'s status", '`rm` が失敗すると、`set -e` で EXIT トラップはここで終わり、スクリプトは `rm` の終了ステータスで終了する'],
      [{ what: [{ kind: 'command', name: 'cat' }], stops: 'test', teardown: 'teardown' }, 'If `cat` fails, the test fails here: its remaining lines do not run, `teardown` runs, and bats goes on with the next test', '`cat` が失敗すると、テストはここで失敗する。残りの行は実行されず、`teardown` が実行され、bats は次のテストに進む'],
      [{ what: [{ kind: 'command', name: 'cd' }, { kind: 'command', name: 'make' }], more: true, stops: 'script' }, 'If `cd`, `make` or another fails, `set -e` stops the script here, with the status of the one that fails', '`cd`・`make`・ほかのコマンドのどれかが失敗すると、`set -e` でスクリプトはここで終わり、失敗したコマンドの終了ステータスで終了する'],
      [{ what: tar, stops: 'script', err: { sure: true, line: 4, action: 'e', exits: true }, exit: cleanup }, "If `tar` fails, `set -e` stops the script here: the ERR trap of line 4 runs `e`, then the EXIT trap of line 19 runs `cleanup`, and the script exits with `tar`'s status (unless `e` or `cleanup` fails or calls `exit`)", '`tar` が失敗すると、`set -e` でスクリプトはここで終わり、行 4 の ERR トラップの `e`、行 19 の EXIT トラップの `cleanup` の順に実行され、`tar` の終了ステータスで終了する（`e`・`cleanup` のどれかが失敗したり `exit` を呼んだりしなければ）'],
      [{ what: tar, stops: 'script', err: { sure: false, line: 4, action: 'e' }, exit: { sure: false, line: 19, action: 'cleanup' } }, "If `tar` fails, `set -e` stops the script here, with `tar`'s status; the ERR trap of line 4 and the EXIT trap of line 19 may run first", '`tar` が失敗すると、`set -e` でスクリプトはここで終わり、`tar` の終了ステータスで終了する（先に行 4 の ERR トラップと行 19 の EXIT トラップが実行されることがある）'],
      [{ what: [{ kind: 'command', name: 'a' }, { kind: 'command', name: 'b' }], stops: 'subshell' }, 'If `a` or `b` fails, `set -e` ends the subshell here, with the status of the one that fails', '`a`・`b` のどれかが失敗すると、`set -e` でサブシェルはここで終わり、失敗したコマンドの終了ステータスで終了する'],
      [{ what: [{ kind: 'command', name: 'cat' }], stops: 'test' }, 'If `cat` fails, the test fails here: its remaining lines do not run, and bats goes on with the next test', '`cat` が失敗すると、テストはここで失敗する。残りの行は実行されず、bats は次のテストに進む'],
    ];
    for (const [p, en, ja] of cases) {
      assert.strictEqual(errexitStopText('en', p), en);
      assert.strictEqual(errexitStopText('ja', p), ja);
    }
  });

  it('gives one note for the statements of a line that stop the same way, and none where a problem says what set -e does', () => {
    assert.deepStrictEqual(notesOn('set -e\ncd /x; make; make install; make test', 1).length, 1);
    assert.match(notesOn('set -e\ncd /x; make; make install; make test', 1)[0], /^ℹ If `cd`, `make`, `make` or another fails/);
    // (`((i++))` says what set -e does at 0; `local x=$( )` that the failure is masked.)
    assert.deepStrictEqual(notesOn('set -e\ni=0\n((i++))', 2), []);
    assert.deepStrictEqual(notesOn('set -e\nf() {\n  local x=$(false)\n}\nf', 2), []);
    // (A function called in the script and in a subshell: the shell is not known; code not reached says nothing.)
    assert.match(notesOn('set -e\nf() {\n  false\n}\nf\n( f )', 2)[0], /stops the shell it runs in/);
    assert.deepStrictEqual(notesOn('set -e\nexit 1\nfalse', 2), []);
    // (An action the model does not read: the trap may run, and change the status.)
    assert.match(notesOn('set -e\ntrap "$cmd" EXIT\nfalse', 2)[0], /, with `false`'s status; an EXIT trap may run first and change the status$/);
    assert.match(notesOn('set -e\nx=$(a; b)', 1)[0], /^ℹ If `\$\( \)` fails/);
    assert.match(notesOn('set -e\nx=$(y=$(a))', 1)[0], /^ℹ If `\$\( \)` fails/);
    assert.match(notesOn('set -e\nx=$(date)', 1)[0], /^ℹ If `date` in `\$\( \)` fails/);
    assert.match(notesOn('set -e\ntest -d x', 1)[0], /^ℹ If `test -d x` is false/);
    // (Builtins that fail only on a usage or write error, and a call of a function whose failures stop inside it.)
    assert.deepStrictEqual(notesOn("set -e\ntrap 'rm -f x' EXIT", 1), []);
    assert.deepStrictEqual(notesOn('set -e\nlog() { echo "$1"; }\nlog hi', 2), []);
  });
});
