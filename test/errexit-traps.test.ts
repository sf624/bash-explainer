// What the models say of a failure under `set -e` (docs/design/errexit-stop.md, U11a), against what bash does: the
// traps of `EXIT` and `ERR` in effect at the failing command (`ShellState.traps`, src/semantics/walk/traps.ts), the
// trap set later (`laterExitTrap`), what the trap's action does to the status (`trapOutcome`), a failure in the
// action of an `EXIT` trap (`ErrexitContext.within`), and the builtins and function calls that cannot fail
// (`mayFail`: `CommandSpec.fails`, `returnsFailure`). Each row is a script whose failing command is `sh -c 'exit 3'`,
// after an `echo @@`; the actions of its traps print a word of their own. From the model at that command, the test
// says which words bash prints after `@@` (each trap that runs, in each shell that the failure ends), whether `AFTER`
// prints, and the status; bash 5.2 (and 5.3, from `$BASH_EXPLAINER_BASH53`) runs every row in one process, in a cgroup
// (`runContained`).
import * as assert from 'assert';
import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { STATEMENTS } from '../src/semantics/env';
import { shellState, type StateModel } from '../src/semantics/state';
import { statusModel, type StatusModel } from '../src/semantics/status';
import { laterExitTrap, trapAt, type Trapped } from '../src/semantics/traps';
import { createUnbashParser } from '../src/syntax/adapters/unbash';
import { descendants, type SyntaxNode } from '../src/syntax/tree';
import { runContained } from './support/contained';
import { hasBash53, PROBE_BASH53 } from './support/probe';

const parser = createUnbashParser();
const FAIL = "sh -c 'exit 3'";

interface Row {
  readonly name: string;
  readonly script: string;
  /** The status bash exits with, where the trap's action changes it (`trapOutcome`); else 3. */
  readonly status?: number;
  /** The model gives a trap as set on some paths only: the words it prints are not checked. */
  readonly maybe?: true;
}

const ROWS: Row[] = [
  { name: 'a command at the top', script: `set -e\ntrap 'echo T1' EXIT\necho @@\n${FAIL}\necho AFTER` },
  { name: 'in a for loop', script: `set -e\ntrap 'echo T1' EXIT\nfor i in 1 2; do\n  echo @@\n  ${FAIL}\n  echo AFTER\ndone` },
  { name: 'in a function called at the top', script: `set -e\ntrap 'echo T1' EXIT\nf() {\n  echo @@\n  ${FAIL}\n  echo AFTER\n}\nf\necho AFTER` },
  { name: 'before the trap is set', script: `set -e\necho @@\n${FAIL}\necho AFTER\ntrap 'echo T1' EXIT` },
  { name: 'a trap taken back with -', script: `set -e\ntrap 'echo T1' EXIT\ntrap - EXIT\necho @@\n${FAIL}` },
  { name: 'a trap taken back by its name alone', script: `set -e\ntrap 'echo T1' EXIT\ntrap EXIT\necho @@\n${FAIL}` },
  { name: 'a trap taken back with 0', script: `set -e\ntrap 'echo T1' exit\ntrap 0\necho @@\n${FAIL}` },
  { name: 'a trap that runs nothing', script: `set -e\ntrap 'echo T1' EXIT\ntrap '' EXIT\necho @@\n${FAIL}` },
  { name: 'a trap set on some paths', script: `set -e\nif [ -n "$1" ]; then trap 'echo T1' EXIT; fi\necho @@\n${FAIL}`, maybe: true },
  { name: 'a trap set in a function', script: `set -e\ng() { trap 'echo T1' EXIT; }\ng\necho @@\n${FAIL}` },
  { name: 'a trap set in a subshell', script: `set -e\n( trap 'echo T2' EXIT )\necho @@\n${FAIL}` },
  { name: 'in a subshell', script: `set -e\ntrap 'echo T1' EXIT\n( echo @@; ${FAIL}; echo AFTER )\necho AFTER` },
  { name: 'in a subshell with a trap of its own', script: `set -e\ntrap 'echo T1' EXIT\n( trap 'echo T2' EXIT; echo @@; ${FAIL}; echo AFTER )\necho AFTER` },
  { name: 'in a pipeline stage, with pipefail', script: `set -eo pipefail\ntrap 'echo T1' EXIT\ntrue | { echo @@; ${FAIL}; echo AFTER; } | cat\necho AFTER` },
  { name: 'a later trap replaces it', script: `set -e\ntrap 'echo T1' EXIT\ntrap 'echo T2' EXIT\necho @@\n${FAIL}` },
  { name: 'an ERR trap and an EXIT trap', script: `set -e\ntrap 'echo E1' ERR\ntrap 'echo T1' EXIT\necho @@\n${FAIL}` },
  { name: 'an ERR trap, in a function', script: `set -e\ntrap 'echo E1' ERR\nf() { echo @@; ${FAIL}; }\nf` },
  { name: 'an ERR trap, in a function, with errtrace', script: `set -eE\ntrap 'echo E1' ERR\nf() { echo @@; ${FAIL}; }\nf` },
  { name: 'an ERR trap the function sets', script: `set -e\ntrap 'echo E1' ERR\nf() { trap 'echo E2' ERR; echo @@; ${FAIL}; }\nf` },
  { name: 'an ERR trap a function set before', script: `set -e\ntrap 'echo E1' ERR\nf() { trap 'echo E2' ERR; }\nf\necho @@\n${FAIL}` },
  { name: 'an ERR trap a function takes back with -', script: `set -e\ntrap 'echo E1' ERR\nf() { trap - ERR; }\nf\necho @@\n${FAIL}` },
  { name: 'an ERR trap a function sets to nothing', script: `set -e\ntrap 'echo E1' ERR\nf() { trap '' ERR; }\nf\necho @@\n${FAIL}` },
  { name: 'an ERR trap a function sets and takes back', script: `set -e\ntrap 'echo E1' ERR\nf() { trap 'echo E2' ERR; trap - ERR; }\nf\necho @@\n${FAIL}` },
  { name: 'exec of words that may be none', script: `set -e\ntrap 'echo T1' EXIT\nset --\nexec "$@"\necho @@\n${FAIL}`, maybe: true },
  { name: 'an ERR trap, in a subshell', script: `set -e\ntrap 'echo E1' ERR\n( echo @@; ${FAIL} )` },
  { name: 'an ERR trap, in a subshell, with errtrace', script: `set -eE\ntrap 'echo E1' ERR\n( echo @@; ${FAIL} )` },
  { name: 'an action that cannot fail', script: `set -e\nc() { echo C; }\ntrap c EXIT\necho @@\n${FAIL}` },
  { name: 'an action that fails', script: `set -e\nc() { echo C; sh -c 'exit 7'; echo D; }\ntrap c EXIT\necho @@\n${FAIL}`, status: 7 },
  { name: 'an action that calls exit', script: `set -e\ntrap 'echo T1; exit 5' EXIT\necho @@\n${FAIL}`, status: 5 },
  { name: 'an action that calls exit with no status', script: `set -e\ntrap 'echo T1; exit' EXIT\necho @@\n${FAIL}`, status: 3 },
  { name: 'an action whose subshell exits', script: `set -e\ntrap 'echo T1; ( exit 5 )' EXIT\necho @@\n${FAIL}`, status: 5 },
  { name: 'an action that calls a function that cannot fail', script: `set -e\nlog() { echo L; }\nc() { log; echo C; }\ntrap c EXIT\necho @@\n${FAIL}` },
  { name: 'in the action of the EXIT trap', script: `set -e\nc() {\n  echo @@\n  ${FAIL}\n  echo AFTER\n}\ntrap c EXIT\ntrue` },
  { name: 'in a function the EXIT trap calls', script: `set -e\nd() {\n  echo @@\n  ${FAIL}\n  echo AFTER\n}\nc() { d; echo AFTER; }\ntrap c EXIT\ntrue` },
];

/**
 * Statements that cannot fail in normal use (`mayFail` false: `CommandSpec.fails`, `returnsFailure`): the last line of
 * each script, which bash runs with status 0.
 */
const SUCCEEDS = [
  'set -euo pipefail', "trap 'echo T1' EXIT", 'echo hi', 'echo hi >&2', 'shopt -s extglob', 'shopt -u extglob', 'umask 022', 'true', ':', 'continue', 'break',
  'log() { echo "$1"; }\nlog hi', 'g() { echo a; return 0; }\ng', 'h() { if [ -n "" ]; then echo x; fi; }\nh',
  'k() { for i in 1 2; do [ "$i" = 3 ] || continue; done; }\nk',
];

/**
 * Statements that fail in normal use, which the model must not take for ones that cannot (`mayFail` true): the last
 * line of each script, which bash runs with a status other than 0 (the review of #767).
 */
const MAY_FAIL = [
  'declare -p nosuch', 'declare -F nosuch', 'typeset -f nosuch', 'export -f nosuch', 'readonly -f nosuch', 'shopt -q extglob', 'shopt extglob',
  'shopt -p extglob', 'alias ll', 'local x=1', "set -- 'a b'\ndeclare -i n=\"$1\"", "f() { local -i n=\"$1\"; }\nset -- 'a b'\nf \"$1\"",
  'readonly R=1\nreadonly R=2', 'readonly R=1\nexport R=2', 'readonly R=1\nunset R', 'declare -A m\ndeclare -a m',
  'run() { declare -F "$1" >/dev/null && "$1"; }\nrun nosuch',
];

/**
 * The words a trap's action prints in a row: `echo X` in it, and those of the functions of the row it calls (`c() { … }`
 * on one line), in order, up to a command that fails (`sh -c 'exit 7'`).
 */
function markerOf(script: string, action: string): string[] {
  const out: string[] = [];
  for (const cmd of action.split(/[;\n]/).map((c) => c.trim()).filter(Boolean)) {
    const echo = /^echo (\w+)$/.exec(cmd);
    const body = new RegExp(`(?:^|\\n)${cmd}\\(\\) \\{ ([^}]*) \\}`).exec(script);
    if (echo) out.push(echo[1]);
    else if (body) out.push(...markerOf(script, body[1]));
    else if (cmd.startsWith('sh -c')) break;
  }
  return out;
}

interface Expected { words: string[]; after: boolean; changes: boolean; maybe: boolean }

/** What the model says bash prints after `@@` and how it ends, from the failing command `n`. */
function expected(row: Row, state: StateModel, status: StatusModel, n: SyntaxNode): Expected {
  const words: string[] = [];
  let maybe = false;
  let changes = false;
  const e = status.errexit(n);
  assert.ok(status.mayFail(n), `${row.name}: \`${FAIL}\` may fail`);
  const stops = e.active === 'on' && e.checked === true;
  const ending = (at: SyntaxNode): void => {
    for (const name of ['ERR', 'EXIT'] as Trapped[]) {
      const t = trapAt(state, at, name);
      if (!t || t.state === 'off') continue;
      if (t.state === 'unknown') {
        maybe = true;
        continue;
      }
      words.push(...markerOf(row.script, t.script!.text));
      if (name === 'EXIT') {
        const out = status.trapOutcome(t.script!);
        changes ||= out.fails || out.exits;
      }
    }
  };
  if (stops && e.within?.kind !== 'exit-trap') {
    ending(n);
    // (A subshell that ends fails where it is: in the main shell, that stops it too.)
    if (e.stops === 'subshell') {
      let outer: SyntaxNode = n.parent!;
      while (!(STATEMENTS.has(outer.type) && (outer.type === 'subshell' || outer.parent?.type === 'program'))) outer = outer.parent!;
      ending(outer);
    }
  }
  return { words, after: !stops, changes, maybe };
}

/** The bashes to compare with: bash 5.2 on PATH, and 5.3 when given. */
const BASHES: [string, string][] = [['bash 5.2', 'bash'], ...(hasBash53 ? [['bash 5.3', PROBE_BASH53!] as [string, string]] : [])];

let dir: string;
before(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'errexit-traps-'));
});
after(() => fs.rmSync(dir, { recursive: true, force: true }));

/** Runs each script in `scripts` with `bash` in one process: its output (stdout and stderr) and its status. */
async function runAll(bash: string, scripts: string[]): Promise<{ out: string; status: number }[]> {
  const cwd = fs.mkdtempSync(path.join(dir, 'run-'));
  scripts.forEach((s, i) => fs.writeFileSync(path.join(cwd, `r${i}.sh`), `${s}\n`));
  const driver = scripts.map((_, i) => `${JSON.stringify(bash)} --norc --noprofile r${i}.sh > r${i}.out 2>&1; echo $? > r${i}.st`).join('\n');
  await runContained(['bash', '--norc', '-c', driver], cwd, { PATH: process.env.PATH }, 30000);
  return scripts.map((_, i) => ({ out: fs.readFileSync(path.join(cwd, `r${i}.out`), 'utf8'), status: Number(fs.readFileSync(path.join(cwd, `r${i}.st`), 'utf8')) }));
}

const failing = (tree: { root: SyntaxNode }): SyntaxNode => descendants(tree.root, ['command']).find((c) => c.text === FAIL)!;

describe('a failure under set -e, the traps it runs and its status, against bash (docs/design/errexit-stop.md, U11a)', function () {
  this.timeout(60000);
  before(function () {
    if (spawnSync('bash', ['--version']).status !== 0) this.skip();
  });

  for (const [label, bash] of BASHES) {
    it(`says what ${label} runs after each failure, and its status`, async () => {
      const runs = await runAll(bash, ROWS.map((r) => r.script));
      const wrong: string[] = [];
      ROWS.forEach((row, i) => {
        const tree = parser.parse(row.script);
        const state = shellState(tree);
        const status = statusModel(state);
        const want = expected(row, state, status, failing(tree));
        const { out, status: got } = runs[i];
        const words = out.slice(out.lastIndexOf('@@\n') + 3).split('\n').filter((w) => /^[A-Z]\w*$/.test(w));
        const said = words.filter((w) => w !== 'AFTER');
        if (want.maybe !== !!row.maybe) wrong.push(`${row.name}: the model gives a trap set on some paths: ${want.maybe}`);
        if (!want.maybe && said.join(' ') !== want.words.join(' ')) wrong.push(`${row.name}: model ${want.words.join(' ') || '(none)'}, bash ${said.join(' ') || '(none)'}`);
        if (words.includes('AFTER') !== want.after) wrong.push(`${row.name}: AFTER ${want.after ? 'runs' : 'does not run'} by the model, bash: ${words.includes('AFTER')}`);
        const wantStatus = want.changes ? row.status : 3;
        if (want.changes !== (row.status !== undefined) || got !== wantStatus) wrong.push(`${row.name}: status, model ${want.changes ? 'changed by the action' : 3}, bash ${got}`);
      });
      assert.deepStrictEqual(wrong, []);
    });
  }

  it('names the trap set later where none is set yet (run 4, fix 1), and none after it', () => {
    const tree = parser.parse(`set -e\nx=$(date)\nfor i in 1; do ${FAIL}; done\nif true; then trap 'echo B' EXIT; fi\ntrap 'echo T1' EXIT\n${FAIL}`);
    const state = shellState(tree);
    const fails = descendants(tree.root, ['command']).filter((c) => c.text === FAIL);
    const at = (n: SyntaxNode) => laterExitTrap(state, n)?.at.text;
    assert.strictEqual(at(descendants(tree.root, ['command'])[1]), "trap 'echo T1' EXIT");
    assert.strictEqual(at(fails[0]), "trap 'echo T1' EXIT");
    assert.strictEqual(at(fails[1]), undefined);
    // (Not in a function, which may be called after the trap.)
    const f = parser.parse(`f() { ${FAIL}; }\ntrap 'echo T1' EXIT\nf`);
    assert.strictEqual(laterExitTrap(shellState(f), failing(f)), undefined);
  });

  it('says the statements that cannot fail in normal use, and bash runs them with status 0', async () => {
    const runs = await runAll('bash', SUCCEEDS.map((s) => `${s}\necho "OK $?"`));
    SUCCEEDS.forEach((s, i) => {
      const tree = parser.parse(s);
      const status = statusModel(shellState(tree));
      const last = tree.root.namedChildren.filter((c) => STATEMENTS.has(c.type)).at(-1)!;
      assert.strictEqual(status.mayFail(last), false, s);
      assert.match(runs[i].out, /^OK 0$/m, `${s}: ${runs[i].out}`);
    });
  });

  it('says the statements that fail in normal use may fail, and bash fails them', async () => {
    const runs = await runAll('bash', MAY_FAIL.map((s) => `${s}\necho "OK $?"`));
    MAY_FAIL.forEach((s, i) => {
      const tree = parser.parse(s);
      const status = statusModel(shellState(tree));
      const last = tree.root.namedChildren.filter((c) => STATEMENTS.has(c.type)).at(-1)!;
      assert.strictEqual(status.mayFail(last), true, s);
      assert.match(runs[i].out, /^OK [1-9]\d*$/m, `${s}: ${runs[i].out}`);
    });
    // (Under set -e, the call stops the script: a call of it may fail, G3.)
    const run = await runAll('bash', [`set -e\n${MAY_FAIL.at(-1)}\necho AFTER`]);
    assert.strictEqual(run[0].status, 1);
    assert.doesNotMatch(run[0].out, /AFTER/);
  });
});
