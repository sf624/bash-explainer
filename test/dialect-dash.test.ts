// What each dialect issue says in sh, dash and busybox ash, against those shells (docs/design/three-levels.md, section 10): an Error
// is what the shell refuses while reading, or what fails where it surely gets to it; a variable it does not set, another result with status 0, or a failure the script discards and goes on from, a Warning.
// Every row of FEATURES has a row here; each runs in real dash and, where it is on PATH or in $BASH_EXPLAINER_SHELLS, real busybox.
import * as assert from 'assert';
import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { dialectIssues, dialectNotes, dialectTexts, FEATURES, type Shell } from '../src/dialect';
import { documentIssues } from '../src/document';
import { openDocument, shellsOf } from '../src/document-setup';
import { Analyzer } from '../src/analyzer';
import { type Case, failureOf, isFailure, works } from '../src/shellfeatures';
import { createUnbashParser } from '../src/syntax/adapters/unbash';
import { surelyRuns } from '../src/semantics/scriptstops';
import { descendants, type BashParser } from '../src/syntax/tree';

/** Where a program is, on $BASH_EXPLAINER_SHELLS or PATH. */
function locate(program: string): string | undefined {
  const dirs = [process.env.BASH_EXPLAINER_SHELLS, ...(process.env.PATH ?? '').split(':')].filter(Boolean) as string[];
  for (const d of dirs) if (fs.existsSync(path.join(d, program))) return path.join(d, program);
  return undefined;
}

/** The snippets of each feature dash lacks or runs, each using only that construct. */
const ROWS: Record<string, string[]> = {
  dbracket: ['[[ a = a ]]'],
  regex: ['[[ a =~ a ]] && echo y'],
  array: ['a=(1 2)', 'echo "${a[0]}"'],
  assoc: ['declare -A m'],
  plusAssign: ['a=1; a+=2'],
  replace: ['x=abc; echo "${x/a/b}"'],
  replaceAnchor: ['x=abc; echo "${x/#a/b}"'],
  caseMod: ['x=abc; echo "${x^^}"'],
  substr: ['x=abc; echo "${x:1}"'],
  indirect: ['x=a; echo "${!x}"'],
  prefixNames: ['echo "${!a*}"'],
  arrayKeys: ['echo "${!a[@]}"'],
  transform: ['x=abc; echo "${x@Q}"'],
  negIndex: ['echo "${a[-1]}"'],
  funcKeyword: ['function f { echo a; }', 'function f {\n  echo a\n}', 'function f() { echo a; }'],
  herestring: ['cat <<< a'],
  ansiC: ["echo $'a\\tb'"],
  ansiCQuote: ["echo $'a\\'b'"],
  translated: ['echo $"a"'],
  procSub: ['cat <(echo a)'],
  ampRedirect: ['echo a &>out; wait; echo "[$(cat out)]"'],
  ampAppend: ['echo a &>>out; wait; echo "[$(cat out)]"'],
  netRedirect: ['echo a >/dev/tcp/127.0.0.1/1'],
  pipeAmp: ['echo a |& cat'],
  eqeqTest: ['[ a == a ]'],
  arithCommand: ['((1+1))'],
  cFor: ['for ((i=0;i<1;i++)); do echo a; done'],
  braceRange: ['echo {1..3}'],
  braceList: ['echo {a,b}'],
  caseFall: ['case a in a) echo a;& b) echo b;; esac'],
  caseCont: ['case a in a) echo a;;& b) echo b;; esac'],
  extglob: ['echo @(a|b)'],
  select: ['select x in a; do break; done </dev/null'],
  local: ['f() { local x=1; echo "$x"; }; f'],
  declare: ['declare x=1'],
  typeset: ['typeset x=1'],
  readarray: ['mapfile x </dev/null'],
  source: ['source /dev/null'],
  let: ['let x=1'],
  shopt: ['shopt -s nullglob'],
  pushd: ['pushd /tmp'],
  exportF: ['f() { :; }; export -f f'],
  waitN: ['sleep 0 & wait -n'],
  coproc: ['coproc cat'],
  print: ['print hello'],
  whence: ['whence ls'],
  typeT: ['type -t ls'],
  printfV: ['printf -v x a'],
  printfQ: ['printf %q a'],
  echoE: ['echo -e "a\\tb"'],
  echoN: ['echo -n a'],
  readA: ['read -a x </dev/null'],
  readP: ['echo a | read -p x y'],
  readOpts: ['read -n 1 x <file', 'read -s x <file', 'read -t 1 x <file'],
  readD: ['read -d : x <file'],
  pipefail: ['set -o pipefail'],
  trapErr: ["trap 'echo e' ERR"],
  errtrace: ['set -E'],
  random: ['echo "x$RANDOM"'],
  seconds: ['echo "x$SECONDS"'],
  pipestatus: ['echo "x$PIPESTATUS"'],
  bashVar: ['echo "x$BASH"', 'echo "x$BASH_VERSION"', 'echo "x${BASH_ENV}"', 'echo "x$BASHPID"', 'echo "x$BASHOPTS"'],
  epoch: ['echo "x$EPOCHSECONDS"', 'echo "x$EPOCHREALTIME"'],
  setByBash: ['echo "x$OSTYPE"', 'echo "x$HOSTTYPE"', 'echo "x$MACHTYPE"', 'echo "x$REPLY"', 'echo "x$SHELLOPTS"', 'echo "x$GROUPS"', 'echo "x$DIRSTACK"'],
  funcname: ['f() { echo "x$FUNCNAME"; }; f'],
  uid: ['echo "x$UID"', 'echo "x$EUID"'],
  hostname: ['echo "x$HOSTNAME"'],
  funsub: ['echo ${ echo a; }'],
  valsub: ['echo ${| REPLY=a; }'],
};

let parser: BashParser;
let dir: string;
before(() => {
  parser = createUnbashParser();
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'explain-bash-dialect-dash-'));
  fs.writeFileSync(path.join(dir, 'file'), 'a:b\n');
});
after(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

type Real = 'dash' | 'ash';
const COMMANDS: Record<Real, string[] | undefined> = { dash: locate('dash') ? [locate('dash')!] : undefined, ash: locate('busybox') ? [locate('busybox')!, 'sh'] : undefined };
const REALS = ['dash', 'ash'] as const;

const runIn = (command: string[], text: string) => {
  const file = path.join(dir, 'script');
  fs.writeFileSync(file, text);
  const r = spawnSync(command[0], [...command.slice(1), file], { cwd: dir, encoding: 'utf8', timeout: 10000, killSignal: 'SIGKILL', env: { PATH: process.env.PATH, FUNCNEST: '50' } });
  return { status: r.status, out: r.stdout, err: r.stderr };
};

const issues = (text: string, shell: Shell = 'sh') => dialectIssues(parser.parse(text), shell, 'en');
const levelOf = (text: string, id: string, shell: Shell = 'sh'): string[] => issues(text, shell).filter((i) => i.id === id).map((i) => i.note.level);

/** What the shell does at the snippet: `stops` the script, `fails` with a status, or `runs` with status 0. */
function does(sh: Real, code: string): 'stops' | 'fails' | 'runs' {
  const next = /next=(\d+)/.exec(runIn(COMMANDS[sh]!, `${code}\necho "next=$?"\n`).out);
  return !next ? 'stops' : next[1] === '0' ? 'runs' : 'fails';
}

/** Whether the row says the shell goes on with status 0: a variable it does not set, or another result. */
const statusZero = (id: string, sh: Real): boolean => { const said = FEATURES[id][sh]; return said === 'empty' || (typeof said === 'object' && !isFailure(said)); };

/** The level a feature has at the top of a script, from what its row says of the shell. */
const expected = (id: string, sh: Real): string | undefined => (works(FEATURES[id], sh) ? undefined : statusZero(id, sh) ? 'warning' : 'error');

/** Whether the shell refuses the text while it reads it: it stops at text that never runs, measured. */
const refused = (sh: Real, code: string): boolean => !/next/.test(runIn(COMMANDS[sh]!, `if false; then\n${code}\nfi\necho next\n`).out);

describe('busybox', () => {
  // (CI sets it, as BASH_EXPLAINER_BASH_AST: without busybox, the tests of what it does would be skipped.)
  it('is there where BASH_EXPLAINER_BUSYBOX says it must be', () => {
    if (process.env.BASH_EXPLAINER_BUSYBOX) assert.ok(locate('busybox'), 'BASH_EXPLAINER_BUSYBOX is set, but busybox is not on PATH or in $BASH_EXPLAINER_SHELLS');
  });
});

for (const sh of REALS) {
  (locate(sh === 'ash' ? 'busybox' : 'dash') ? describe : describe.skip)(`the dialect issues, against ${sh}`, () => {
    it('has a row for every feature', () => {
      assert.deepStrictEqual(Object.keys(ROWS).sort(), Object.keys(FEATURES).sort());
    });

    // What the text of a row that fails claims (src/messages-shfail.ts): the status, a word of the message, and whether the shell stops. One shell
    // process runs the table (`eval` in a subshell, a snippet at a time); the rows that fail with a status print `next=` and its status.
    it('says how each row fails: its status, its message, and whether the shell goes on', function () {
      // (They run the shell once for each row: load must not fail them.)
      this.timeout(20000);
      const cases: { id: string; code: string; fail: NonNullable<ReturnType<typeof failureOf>>; marker?: string; setE?: boolean }[] = [];
      for (const [id, snippets] of Object.entries(ROWS)) {
        const fail = failureOf(FEATURES[id], sh);
        // (A row that fails has how, and one that works or gives status 0 has none.)
        assert.strictEqual(fail === undefined, works(FEATURES[id], sh) || statusZero(id, sh), id);
        if (fail) for (const code of snippets) cases.push({ id, code, fail });
      }
      // The same where the place changes it: a case of the row, or a subshell (`sub`) that stops alone. `marker`: what the script prints after, if the shell goes on.
      const VARIANTS: { id: string; code: string; cases?: Case[]; sub?: boolean; marker?: string; setE?: boolean }[] = [
        { id: 'caseMod', code: 'f() { echo "${x^^}"; }; f; echo after', marker: 'after' },
        { id: 'caseMod', code: 'y=$(echo "${x^^}"); echo after=$?', sub: true, marker: 'after=2' },
        { id: 'caseMod', code: 'echo "${x,,}" | tr a b; echo after', sub: true, marker: 'after' },
        { id: 'caseMod', code: 'echo x | echo "${x^^}"; echo after', sub: true, marker: 'after' },
        { id: 'caseMod', code: '(echo "${x^^}"); echo after=$?', sub: true, marker: 'after=2' },
        { id: 'exportF', code: 'f() { :; }; y=$(export -f f); echo after=$?', sub: true, marker: 'after=2' },
        { id: 'exportF', code: 'f() { :; }; export -f f; echo after', marker: 'after' },
        { id: 'pipefail', code: 'y=$(set -o pipefail); echo after=$?', sub: true, marker: 'after=2' },
        // (Under `set -e` the script stops after the subshell's failure: the text says it goes on unless `set -e` stops it.)
        { id: 'caseMod', code: 'set -e\n( echo "${x^^}" )\necho after', sub: true, marker: 'after', setE: true },
        { id: 'caseMod', code: 'set -e\nv=$(echo "${x^^}")\necho after', sub: true, marker: 'after', setE: true },
        { id: 'caseMod', code: 'set -e\necho hi | echo "${x^^}"\necho after', sub: true, marker: 'after', setE: true },
        { id: 'pipefail', code: 'set -e\n(set -o pipefail)\necho after', sub: true, marker: 'after', setE: true },
        { id: 'dbracket', code: '[[ $1 =~ ^(yes|y)$ ]]', cases: ['parenthesis'] },
        { id: 'regex', code: '[[ $1 =~ ^(yes|y)$ ]]', cases: ['parenthesis'] },
        { id: 'dbracket', code: '[[ ( a = b ) ]]', cases: ['parenthesis'] },
        { id: 'dbracket', code: '[[ a == *(b) ]]', cases: ['parenthesis'] },
        // (An escaped or quoted parenthesis is a word: the command is not found.)
        { id: 'regex', code: '[[ a =~ \\( ]]' },
        { id: 'regex', code: '[[ a =~ "(" ]]' },
        { id: 'regex', code: '[[ a =~ ^"("a ]]' },
        { id: 'netRedirect', code: 'exec 3<>/dev/tcp/127.0.0.1/1; echo after', cases: ['special'], marker: 'after' },
        { id: 'netRedirect', code: ': </dev/tcp/127.0.0.1/1; echo after', cases: ['special'], marker: 'after' },
        { id: 'netRedirect', code: 'y=$(exec 3<>/dev/tcp/127.0.0.1/1); echo after=$?', cases: ['special'], sub: true, marker: 'after=' },
        { id: 'netRedirect', code: 'cat </dev/tcp/127.0.0.1/1; echo after', marker: 'after' },
        // (No command, or a compound command: the redirection fails, and the shell goes on.)
        { id: 'netRedirect', code: '</dev/tcp/127.0.0.1/1; echo after', marker: 'after' },
        { id: 'netRedirect', code: '{ :; } </dev/tcp/127.0.0.1/1; echo after', marker: 'after' },
      ];
      for (const { id, code, cases: where, sub, marker, setE } of VARIANTS) {
        const base = failureOf(FEATURES[id], sh, where);
        if (!base) continue;
        const fail = sub ? base.subshell! : base;
        cases.push({ id, code, fail, marker, setE });
        // (The note says the same: the sentence of that failure, at the level the shell's stop gives.)
        const said = issues(code, sh).filter((i) => i.id === id).map((i) => i.note.text).join('\n');
        assert.ok(said.includes(fail.en('')), `${id}: ${code}: ${said}`);
      }
      assert.ok(cases.length > 25);
      const driver = path.join(dir, 'table');
      fs.writeFileSync(driver, 'i=0\nfor code do\n  i=$((i + 1))\n  echo "@@BEGIN $i"\n  ( eval "$code\necho \\"next=\\$?\\"" ) 2>&1\n  echo "@@END $i $?"\ndone\n');
      const r = spawnSync(COMMANDS[sh]![0], [...COMMANDS[sh]!.slice(1), driver, ...cases.map((c) => c.code)], { cwd: dir, encoding: 'utf8', timeout: 20000, killSignal: 'SIGKILL', env: { PATH: process.env.PATH, FUNCNEST: '50' } });
      const seen = [...r.stdout.matchAll(/^@@BEGIN (\d+)\n([\s\S]*?)^@@END \1 (\d+)$/gm)];
      assert.strictEqual(seen.length, cases.length);
      cases.forEach(({ id, code, fail, marker, setE }, i) => {
        const [, , out, exit] = seen[i];
        const at = `${id}: ${code}`;
        // (`${a[0]}`, of a row whose `a=(…)` is a syntax error, is a bad substitution when it runs.)
        if (fail.fault !== 'read' || !code.includes('${')) assert.ok(out.toLowerCase().includes(fail.says.toLowerCase()), `${at}: ${out}`);
        if (setE) {
          assert.ok(!out.includes(marker!), `${at}: ${out}`);
          assert.strictEqual(Number(exit), fail.status, at);
        } else if (fail.fault === 'status') assert.ok(out.includes(marker ? `${marker}${marker.endsWith('=') ? fail.status : ''}\n` : `next=${fail.status}\n`), `${at}: ${out}`);
        else {
          assert.ok(!out.includes('next=') && !(marker && out.includes(marker)), `${at}: ${out}`);
          assert.strictEqual(Number(exit), fail.status, at);
        }
      });
    });

    // `function` in dash is a command name: not found (127), then the `}` or `()` is a syntax error (2). The text claims: the stop is at the syntax error, or sooner under `set -e`;
    // lines before it may have run. Measured as scripts (files), at the top level and in a compound command, with and without `set -e`; each table row is a script.
    (sh === 'dash' ? it : it.skip)('`function f {` stops at its syntax error, or sooner under `set -e`, with the lines before it run or not', () => {
      const FUNCTION = 'function f {\n  echo body\n}\n';
      const rows: [string, string, number][] = [
        ['echo before\n' + FUNCTION + 'echo after\n', 'before\nbody\n', 2],
        ['set -e\necho before\n' + FUNCTION + 'echo after\n', 'before\n', 127],
        ['echo before\nfunction f { echo body; }\necho after\n', 'before\n', 2],
        ['set -e\necho before\nfunction f { echo body; }\necho after\n', 'before\n', 2],
        ['echo before\nfunction f() {\n  echo body\n}\necho after\n', 'before\n', 2],
        ['echo before\nif true; then\n' + FUNCTION + 'fi\necho after\n', 'before\n', 2],
        ['set -e\necho before\nif true; then\n' + FUNCTION + 'fi\necho after\n', 'before\n', 2],
        ['echo before\nf() {\n' + FUNCTION + '}\necho after\n', 'before\n', 2],
      ];
      for (const [script, out, status] of rows) {
        const r = runIn(COMMANDS[sh]!, script);
        assert.deepStrictEqual([r.out, r.status], [out, status], script);
        assert.match(r.err, status === 127 ? /function: not found/ : /Syntax error/, script);
        const said = issues(script, sh).filter((i) => i.id === 'funcKeyword');
        assert.ok(said[0].note.text.includes(failureOf(FEATURES.funcKeyword, sh)!.en('')), script);
        assert.strictEqual(said[0].note.level, 'error', script);
      }
      // (At the top level over several lines, the shell has run the line of `function f {` and the body before it stops.)
      assert.match(runIn(COMMANDS[sh]!, rows[0][0]).err, /function: not found[\s\S]*Syntax error: "}" unexpected/);
    });

    it('a redirection that fails at `exec` stops the shell, and it is an Error (not kept quiet by `|| true`: the shell has stopped)', () => {
      assert.deepStrictEqual([...new Set(levelOf('exec 3<>/dev/tcp/h/1\necho after', 'netRedirect', sh))], ['error']);
      assert.deepStrictEqual([...new Set(levelOf('exec 3<>/dev/tcp/h/1 || true\necho after', 'netRedirect', sh))], ['error']);
      assert.strictEqual(runIn(COMMANDS[sh]!, 'exec 3<>/dev/tcp/h/1 || true\necho after\n').out, '');
    });

    it('`(( x > 0 ))` runs `x` with its output in a file `0`, and the condition is false', () => {
      const r = runIn(COMMANDS[sh]!, 'x=1\nif (( x > 0 )); then echo yes; else echo no; fi\n');
      assert.strictEqual(r.out, 'no\n');
      assert.match(r.err, /x: not found/);
      assert.ok(fs.existsSync(path.join(dir, '0')));
      fs.rmSync(path.join(dir, '0'));
    });

    // The forms the text of `=~` names (usability-9.md, Q9), against bash's `[[ =~ ]]`: one process for each shell and one for bash.
    it('`case` and `expr` do what the text of `=~` says, and `grep -E` matches the regex', () => {
      const strings = ['', 'abc', '123', '0', '12a', 'a12', ' 1', '1 ', '1-2'];
      const driver = path.join(dir, 'regex');
      const forms = 'case $s in \'\'|*[!0-9]*) c=no;; *) c=yes;; esac\nif expr "$s" : \'[0-9][0-9]*$\' >/dev/null; then e=yes; else e=no; fi\nif printf \'%s\\n\' "$s" | grep -Eq \'^[0-9]+$\'; then g=yes; else g=no; fi\n';
      fs.writeFileSync(driver, `for s do\n${forms}echo "$s|$c|$e|$g|$(expr "$s" : '[0-9]')"\ndone\n`);
      const run = (command: string[]) => spawnSync(command[0], [...command.slice(1), driver, ...strings], { cwd: dir, encoding: 'utf8', timeout: 20000, killSignal: 'SIGKILL', env: { PATH: process.env.PATH, FUNCNEST: '50' } }).stdout;
      const bashDriver = path.join(dir, 'regex-bash');
      fs.writeFileSync(bashDriver, 'for s do\n  if [[ $s =~ ^[0-9]+$ ]]; then r=yes; else r=no; fi\n  echo "$s|$r|$r|$r|$([[ $s =~ [0-9] ]] && echo 1 || echo 0)"\ndone\n');
      const bash = spawnSync('bash', ['--norc', '--noprofile', bashDriver, ...strings], { cwd: dir, encoding: 'utf8', timeout: 20000, killSignal: 'SIGKILL' }).stdout.split('\n');
      const mine = run(COMMANDS[sh]!).split('\n');
      assert.strictEqual(mine.length, strings.length + 1);
      strings.forEach((s, i) => {
        const [, c, e, g] = mine[i].split('|');
        const [, want] = bash[i].split('|');
        assert.deepStrictEqual([c, e, g], [want, want, want], JSON.stringify(s));
      });
      // (`expr` matches from the start of the string, as its text says; `=~` finds a match anywhere: `abc1` has a digit, and `expr` finds none at its start.)
      assert.strictEqual(mine[strings.indexOf('a12')].split('|')[4], '0');
      assert.strictEqual(bash[strings.indexOf('a12')].split('|')[4], '1');
    });

    for (const [id, snippets] of Object.entries(ROWS)) {
      for (const code of snippets) {
        it(`${id}: ${code.replace(/\n/g, ' ')}`, () => {
          const f = FEATURES[id];
          const said = issues(code, sh).filter((i) => i.id === id);
          const result = does(sh, code);
          if (works(f, sh)) {
            assert.strictEqual(result, 'runs');
            assert.deepStrictEqual(said, []);
            return;
          }
          assert.deepStrictEqual([...new Set(said.map((i) => i.note.level))], [expected(id, sh)]);
          const notes = said.map((i) => i.note.text).join('\n');
          if (f[sh] === 'empty') {
            assert.strictEqual(result, 'runs');
            assert.strictEqual(runIn(COMMANDS[sh]!, code).out, 'x\n');
            assert.match(notes, /not set it, so it expands to nothing/);
          } else if (statusZero(id, sh)) {
            assert.strictEqual(result, 'runs');
            // (Status 0, with another result than bash's. `=~` only where it holds a `(`.)
            if (id !== 'regex') assert.notStrictEqual(runIn(COMMANDS[sh]!, code).out, runIn(['bash', '--norc', '--noprofile'], code).out);
          } else {
            assert.notStrictEqual(result, 'runs');
            assert.match(notes, /is not available in/);
            // (The row says how it fails, as measured: `$'a\'b'` here has no next `'`. `${a[0]}`, of a row whose `a=(…)` is refused, stops where it runs.)
            assert.strictEqual(result === 'stops', failureOf(f, sh)!.fault !== 'status', 'stops');
            if (id !== 'ansiCQuote') assert.strictEqual(refused(sh, code), failureOf(f, sh)!.fault === 'read' && !code.includes('${'), 'refused');
          }
        });
      }
    }

    // Each row wrapped: where it runs, what fails still fails; the level follows `surelyRuns` (test of the rule below).
    const WRAPS: [string, (code: string) => string, boolean][] = [
      ['a function', (code) => `f() {\n${code}\necho "st=$?"\n}\nf`, false],
      ['a pipe', (code) => `{ ${code}\necho "st=$?"\n} | cat`, true],
      ['$( )', (code) => `y=$(${code}\necho "st=$?"\n)\necho "$y"`, true],
      ['set -e', (code) => `set -e\n${code}\necho "st=$?"`, true],
      ['if', (code) => `if true; then\n${code}\necho "st=$?"\nfi`, false],
      ['&&', (code) => `true && {\n${code}\necho "st=$?"\n}`, false],
    ];
    for (const [where, wrap, sure] of WRAPS) {
      it(`what fails, in ${where}`, function () {
        // (They run the shell once for each row: load must not fail them.)
        this.timeout(20000);
        for (const [id, snippets] of Object.entries(ROWS)) {
          // (`function f {` in dash is a command and a block, whose `}` closes what is around it.)
          if (works(FEATURES[id], sh) || statusZero(id, sh) || id === 'funcKeyword') continue;
          for (const code of snippets) {
            const script = wrap(code);
            const r = runIn(COMMANDS[sh]!, script);
            assert.doesNotMatch(r.out, /st=0/, `${id}: ${code}`);
            // (What the shell refuses while reading fails in any of them. `$'a\'b'` depends on the next `'` of the script: it is no row of those.)
            for (const level of levelOf(script, id, sh)) assert.strictEqual(level, sure || (id !== 'ansiCQuote' && refused(sh, code)) ? 'error' : 'warning', `${id}: ${code}`);
          }
        }
      });
      it(`what gives status 0, in ${where}`, function () {
        // (They run the shell once for each row: load must not fail them.)
        this.timeout(20000);
        for (const [id, snippets] of Object.entries(ROWS)) {
          if (works(FEATURES[id], sh) || !statusZero(id, sh) || id === 'funcname') continue;
          for (const code of snippets) {
            const script = wrap(code);
            assert.match(runIn(COMMANDS[sh]!, script).out, /st=0/, `${id}: ${code}`);
            for (const level of levelOf(script, id, sh)) assert.strictEqual(level, 'warning', `${id}: ${code}`);
          }
        }
      });
    }

    it('what fails, under set -eu', function () {
      // (They run the shell once for each row: load must not fail them.)
      this.timeout(20000);
      for (const [id, snippets] of Object.entries(ROWS)) {
        if (works(FEATURES[id], sh) || statusZero(id, sh) || id === 'funcKeyword') continue;
        for (const code of snippets) {
          const script = `set -eu\n${code}\necho "st=$?"`;
          assert.doesNotMatch(runIn(COMMANDS[sh]!, script).out, /st=0/, `${id}: ${code}`);
          assert.deepStrictEqual([...new Set(levelOf(script, id, sh))], ['error'], `${id}: ${code}`);
        }
      }
    });
    it('a variable it does not set stops the shell under set -eu, and another result does not: a Warning, as the environment may set it', function () {
      // (They run the shell once for each row: load must not fail them.)
      this.timeout(20000);
      for (const [id, snippets] of Object.entries(ROWS)) {
        if (works(FEATURES[id], sh) || !statusZero(id, sh)) continue;
        const empty = FEATURES[id][sh] === 'empty';
        for (const code of snippets) {
          const script = `set -eu\n${code}\necho "st=$?"`;
          const r = runIn(COMMANDS[sh]!, script);
          // (The rows that keep a value with `set -u`: `$REPLY` and the like have none.)
          assert.strictEqual(/st=0/.test(r.out), !empty, `${id}: ${code}`);
          assert.deepStrictEqual([...new Set(levelOf(script, id, sh))], ['warning'], `${id}: ${code}`);
        }
      }
    });

    it('`**` is `*` here, with status 0', () => {
      fs.mkdirSync(path.join(dir, 'd/e'), { recursive: true });
      fs.writeFileSync(path.join(dir, 'd/e/x'), '');
      assert.strictEqual(runIn(COMMANDS[sh]!, 'for f in **/x; do echo "$f"; done\necho "next=$?"\n').out, '**/x\nnext=0\n');
    });

    // A variable the shell does not set, as `[` or `test` reads it.
    const SECONDS = sh === 'ash' ? 'SECONDS' : 'RANDOM';
    for (const code of ['[ "$UID" -ne 0 ]', '[ "$EUID" -ne 0 ]', '[ $UID = 0 ]', 'test $UID -eq 0', '[ "$SECONDS" -gt 10 ]', `[ $${SECONDS} -lt 5 ]`]) {
      it(`status 2 where it is unset is a Warning: ${code}`, () => {
        assert.strictEqual(runIn(COMMANDS[sh]!, `${code}\necho "st=$?"`).out, 'st=2\n');
        const said = issues(code, sh);
        assert.deepStrictEqual(said.map((i) => i.note.level), ['warning']);
        assert.match(said[0].note.text, /the test reports an error \(status 2\), and counts as false/);
      });
    }
    it('the body of the test that failed does not run, and what follows does', () => {
      assert.strictEqual(runIn(COMMANDS[sh]!, 'if [ "$UID" -ne 0 ]; then echo must be root; exit 1; fi\necho rest').out, 'rest\n');
      assert.deepStrictEqual(issues('if [ "$UID" -ne 0 ]; then echo must be root; exit 1; fi', sh).map((i) => i.note.level), ['warning']);
    });
    for (const code of ['[ "$UID" = 0 ]', '[ $UID ]', '[ -z "$UID" ]', '[ -n $UID ]', '[ "$UID" = "$x" ]', '[ "$UID" = "$RANDOM" ]', '[ "$UID" = "$@" ]', '[ "$UID" = $x ]', '[ "$(echo "$UID")" -ne 0 ]', '[ a = b ] >"$UID"', 'for f in $UID; do :; done', 'case $UID in a) ;; esac', 'cat <"$UID"']) {
      it(`status 0 or 1, or not known, is a Warning: ${code}`, () => {
        assert.deepStrictEqual(levelOf(code, 'uid', sh), ['warning']);
      });
    }
    it('a test that gives its own value says nothing', () => {
      for (const code of ['[ "${UID-0}" -eq 0 ]', '[ "${UID:-0}" -eq 0 ]', 'UID=1; [ "$UID" -ne 0 ]']) {
        assert.strictEqual(runIn(COMMANDS[sh]!, `${code}\necho "st=$?"`).out.endsWith('st=1\n') || runIn(COMMANDS[sh]!, `${code}\necho "st=$?"`).out.endsWith('st=0\n'), true, code);
        assert.deepStrictEqual(issues(code, sh), [], code);
      }
    });

    // The word gives another value: the shell gives it.
    for (const [code, out] of [['echo "${UID:-0}"', '0\n'], ['echo "${UID-0}"', '0\n'], ['echo "${UID:-$(echo 7)}"', '7\n'], ['echo "${BASH_SOURCE:-b}"', 'b\n'], ['echo "${UID:=3}"', '3\n'], ['echo "${UID:+a}"', '\n']]) {
      it(`says nothing where the word gives the value: ${code}`, () => {
        assert.strictEqual(runIn(COMMANDS[sh]!, code).out, out);
        assert.deepStrictEqual(issues(code, sh), []);
      });
    }
    for (const code of ['echo "${UID:?need}"', 'echo "${UID?need}"', ': "${UID:?}"; echo "$UID"']) {
      it(`a Warning where the word stops the shell if it is unset: ${code}`, () => {
        assert.strictEqual(does(sh, code), 'stops');
        assert.deepStrictEqual(issues(code, sh).map((i) => i.note.level), ['warning']);
        assert.match(issues(code, sh)[0].note.text, /so the shell stops here/);
      });
    }

    // Under `set -u`.
    for (const code of ['set -u; echo "x$UID"', 'set -u; echo "${UID#x}"', 'set -u; [ -z "$UID" ]']) {
      it(`a Warning where set -u stops the shell if it is unset: ${code}`, () => {
        assert.strictEqual(does(sh, code), 'stops');
        assert.deepStrictEqual(levelOf(code, 'uid', sh), ['warning']);
        assert.match(issues(code, sh)[0].note.text, /so the shell stops here/);
      });
    }
    for (const code of ['set -u; x=$(echo "$UID")', 'set -u; echo "$UID" | cat', 'set -u; (echo "$UID")', 'y=$(: "${UID:?}")']) {
      it(`a Warning where only a subshell stops: ${code}`, () => {
        assert.strictEqual(runIn(COMMANDS[sh]!, `${code}\necho next`).out.endsWith('next\n'), true);
        assert.deepStrictEqual(levelOf(code, 'uid', sh), ['warning']);
        assert.match(issues(code, sh)[0].note.text, /only that subshell stops, and the script goes on unless `set -e` stops it/);
      });
    }
    it('a subshell stops, and the script goes on: `cd "$(dirname "$BASH_SOURCE")"`', () => {
      assert.strictEqual(runIn(COMMANDS[sh]!, 'set -u; cd "$(dirname "$BASH_SOURCE")"; echo NEXT').out, 'NEXT\n');
      assert.deepStrictEqual(levelOf('set -u; cd "$(dirname "$BASH_SOURCE")"; echo NEXT', 'bashVar', sh), ['warning']);
    });
    for (const code of ['set -u; [ -n "${UID:-}" ] && echo "$UID"', 'set -u; if [ -n "${UID+x}" ]; then echo "$UID"; fi', 'set -u; [ -z "${UID:-}" ] && exit 1\necho "$UID"', '. ./lib\nset -u\necho "$UID"']) {
      it(`no stop is said after a test of the name, or what the model does not read: ${code.replace(/\n/g, ' ')}`, () => {
        for (const i of issues(code, sh).filter((x) => x.id === 'uid')) {
          assert.strictEqual(i.note.level, 'warning');
          assert.doesNotMatch(i.note.text, /stops/);
        }
      });
    }

    it('a name in `$(( ))` counts as 0, with status 0', () => {
      for (const [code, out] of [['echo $((UID + 1))', '1\n'], ['echo $((SECONDS/60))', '0\n'], ['echo $((UID))', '0\n']]) {
        assert.strictEqual(runIn(COMMANDS[sh]!, code).out, out);
        const said = issues(code, sh);
        assert.deepStrictEqual(said.map((i) => i.note.level), ['warning'], code);
        assert.match(said[0].note.text, /counts as 0 in arithmetic/);
      }
      // (`(( ))` is its own issue, and a name set in the script none.)
      assert.deepStrictEqual(issues('((UID + 1))', sh).map((i) => i.id), ['arithCommand']);
      assert.deepStrictEqual(issues('UID=2; echo $((UID + 1))', sh), []);
    });
    for (const code of ['echo $(($SECONDS % 5))', 'echo $((1 + $SECONDS))', 'echo $((-$SECONDS))', 'echo $((($SECONDS)))', 'echo "$((${SECONDS} % 5))"']) {
      it(`a Warning where an operand is missing if it is unset: ${code}`, () => {
        assert.strictEqual(does(sh, code), 'stops');
        assert.deepStrictEqual(levelOf(code, 'seconds', sh), ['warning']);
      });
    }
    for (const code of ['echo $(($SECONDS + 1))', 'echo $(($SECONDS - 1))', 'echo $((1$SECONDS))', 'echo $(($SECONDS$SECONDS + 1))', 'echo $((${SECONDS:-1} % 5))', 'echo "$(echo $SECONDS)"', 'echo "${SECONDS%x}"']) {
      it(`a Warning, or nothing, where the operands are there: ${code}`, () => {
        assert.strictEqual(does(sh, code), 'runs');
        for (const level of levelOf(code, 'seconds', sh)) assert.strictEqual(level, 'warning');
      });
    }
    it('`$(($x))` alone stops dash, and is 0 in busybox ash', () => {
      assert.strictEqual(does(sh, 'echo $(($SECONDS))'), sh === 'dash' ? 'stops' : 'runs');
      assert.deepStrictEqual(levelOf('echo $(($SECONDS))', 'seconds', sh), ['warning']);
      assert.match(issues('echo $(($SECONDS))', sh)[0].note.text, sh === 'dash' ? /so the shell stops here/ : /so it expands to nothing/);
    });

    it('says nothing of a variable the script sets, or of a name that is no variable of bash', () => {
      for (const code of ['UID=3; echo "$UID"', 'read UID </dev/null; echo "$UID"', 'echo "${UID=1}"', '[ -z "$UID" ] && UID=3\necho $(($UID % 5))']) {
        assert.deepStrictEqual(issues(code, sh).filter((i) => i.id === 'uid'), [], code);
      }
      // (tests/run-all in bash's source; bash-completion.)
      for (const name of ['BASH_TSTOUT', 'BASH_COMPLETION_VERSINFO', 'BASHFOO', 'EPOCHS']) assert.deepStrictEqual(issues(`echo "$${name}"`, sh), [], name);
      assert.deepStrictEqual(issues('BASH_TSTOUT=/tmp/x; echo "$BASH_TSTOUT"', sh), []);
    });

    it('says nothing of a command the script defines', () => {
      for (const code of ['print() { echo "$1"; }\nprint x', 'f() { shopt a; }\nshopt() { :; }\nf']) {
        assert.strictEqual(does(sh, code), 'runs', code);
        assert.deepStrictEqual(issues(code, sh), [], code);
      }
    });
    it('reads a definition of a command before the line, not one after it', () => {
      for (const code of ['shopt -s x\nshopt() { :; }', 'shopt -s x; shopt() { :; }', 'shopt() { :; }\nunset -f shopt\nshopt -s x']) {
        assert.match(runIn(COMMANDS[sh]!, `${code}\n`).err, /not found/, code);
        assert.deepStrictEqual(levelOf(code, 'shopt', sh), ['error'], code);
      }
    });

    it('says that an expansion fails once, not that its variable is empty as well', () => {
      assert.deepStrictEqual(issues('echo "${UID^^}"', sh).map((i) => `${i.id} ${i.note.level}`), ['caseMod error']);
      assert.deepStrictEqual(issues('f() { echo "${FUNCNAME[0]}"; }', sh).map((i) => `${i.id} ${i.note.level}`), ['array warning']);
    });

    // The environment may set what the shell does not (docs/design/three-levels.md, section 2): whatever would follow without it, a Warning, in the same words.
    const withEnv = (env: Record<string, string>, text: string) => {
      const file = path.join(dir, 'env-script');
      fs.writeFileSync(file, text);
      const [program, ...args] = COMMANDS[sh]!;
      return spawnSync(program, [...args, file], { cwd: dir, encoding: 'utf8', timeout: 10000, killSignal: 'SIGKILL', env: { PATH: process.env.PATH, FUNCNEST: '50', ...env } });
    };
    for (const [env, code, id, out] of [
      [{ UID: '1000' }, 'if [ "$UID" -ne 0 ]; then echo notroot; fi', 'uid', 'notroot\n'],
      [{ UID: '7' }, 'set -u; echo "$UID"', 'uid', '7\n'],
      [{ UID: '7' }, 'echo "${UID:?}"', 'uid', '7\n'],
      [{ SECONDS: '7' }, 'echo $(($SECONDS % 5))', 'seconds', '2\n'],
    ] as const) {
      it(`a Warning, and it runs where the environment sets it: ${code}`, () => {
        const r = withEnv(env, code);
        assert.strictEqual(r.status, 0);
        assert.strictEqual(r.stdout, out);
        assert.strictEqual(r.stderr, '');
        assert.deepStrictEqual(levelOf(code, id, sh), ['warning']);
      });
    }
    it('says nothing of a variable the script assigns first, whatever follows', () => {
      for (const code of ['UID=7; [ "$UID" -ne 0 ]', 'UID=7; set -u; echo "$UID"', 'UID=7; echo $(($UID % 5))']) assert.deepStrictEqual(levelOf(code, 'uid', sh), [], code);
    });

    // A script that probes its shell: it discards the message, and the failure leaves it going. Nothing else: what really stops, or shows its message, stays an Error.
    const PROBES: [string, string, string][] = [
      ['if (set -o pipefail) 2>/dev/null; then :; fi', 'pipefail', 'warning'],
      ['(set -o pipefail) 2>/dev/null && :', 'pipefail', 'warning'],
      ['(set -o pipefail) >/dev/null 2>&1', 'pipefail', 'warning'],
      ['shopt -s x 2>/dev/null || true', 'shopt', 'warning'],
      ['if shopt -q x 2>/dev/null; then :; fi', 'shopt', 'warning'],
      ['shopt -s x 2>/dev/null', 'shopt', 'warning'],
      ['{ shopt -s x; } 2>/dev/null', 'shopt', 'warning'],
      ['y=$(shopt -s x 2>/dev/null)', 'shopt', 'warning'],
      ['y=$(shopt -s x) 2>/dev/null', 'shopt', 'warning'],
      ['a=1 a+=2 2>/dev/null', 'plusAssign', 'warning'],
      ['[[ a ]] 2>/dev/null', 'dbracket', 'warning'],
      ['if [[ a ]] 2>/dev/null; then :; fi', 'dbracket', 'warning'],
      ['set -e\n[[ a ]] 2>/dev/null', 'dbracket', 'error'],
      ['if (echo "${x:1}") >/dev/null 2>&1; then :; fi', 'substr', 'warning'],
      ['(echo "${x^^}") 2>/dev/null', 'caseMod', 'warning'],
      ['set -e\nif (set -o pipefail) 2>/dev/null; then :; fi', 'pipefail', 'warning'],
      ['set -e\nshopt -s x 2>/dev/null || true', 'shopt', 'warning'],
      ['set -e\nshopt -s x 2>/dev/null | cat', 'shopt', 'warning'],
      // The shell stops there.
      ['set -o pipefail 2>/dev/null || true', 'pipefail', 'error'],
      ['{ set -o pipefail; } 2>/dev/null', 'pipefail', 'error'],
      ['if echo "${x:1}" 2>&1 >/dev/null; then :; fi', 'substr', 'error'],
      ['echo "${x^^}" 2>/dev/null', 'caseMod', 'error'],
      ['if (a=(1)) 2>/dev/null; then :; fi', 'array', 'error'],
      ['cat <<< a 2>/dev/null || true', 'herestring', 'error'],
      // `set -e` stops the shell at the status.
      ['set -e\nshopt -s x 2>/dev/null', 'shopt', 'error'],
      ['set -e\n(shopt -s x) 2>/dev/null', 'shopt', 'error'],
      ['set -e\n(set -o pipefail) 2>/dev/null', 'pipefail', 'error'],
      // The message is seen: it is not on what fails, or goes elsewhere.
      ['shopt -s x', 'shopt', 'error'],
      ['shopt -s x 2>&1 >/dev/null || true', 'shopt', 'error'],
      ['shopt -s x >/dev/null || true', 'shopt', 'error'],
      ['shopt -s x 2>log || true', 'shopt', 'error'],
      ['(shopt -s x 2>log) 2>/dev/null', 'shopt', 'error'],
      ['echo $(shopt -s x) 2>/dev/null', 'shopt', 'error'],
      ['(echo "${x^^}" 2>/dev/null)', 'caseMod', 'error'],
    ];
    for (const [code, id, level] of PROBES) {
      it(`${level === 'warning' ? 'a Warning' : 'an Error'} on a probe: ${code.replace(/\n/g, ' ')}`, () => {
        if (works(FEATURES[id], sh)) {
          assert.deepStrictEqual(levelOf(code, id, sh), []);
          return;
        }
        assert.deepStrictEqual([...new Set(levelOf(code, id, sh))], [level]);
        const log = path.join(dir, 'log');
        fs.rmSync(log, { force: true });
        const r = runIn(COMMANDS[sh]!, `${code}\necho next\n`);
        // (Nothing is printed but what follows, and it goes on: only that is a probe.)
        const seen = `${r.out}${r.err}${fs.existsSync(log) ? fs.readFileSync(log, 'utf8') : ''}`;
        assert.strictEqual(seen === 'next\n', level === 'warning', `${r.status} ${seen}`);
      });
    }
    it('takes `&>/dev/null` as bash reads it: where the shell reads it otherwise, the issue of `&>` says so', () => {
      const code = 'shopt -s x &>/dev/null || true';
      const said = issues(code, sh).map((i) => `${i.id} ${i.note.level}`);
      assert.deepStrictEqual(said, sh === 'dash' ? ['shopt warning', 'ampRedirect warning'] : ['shopt warning']);
      assert.strictEqual(/not found/.test(runIn(COMMANDS[sh]!, code).err), sh === 'dash');
    });

    it('`test a == a`, as `[ a == a ]`', () => {
      for (const code of ['test a == a', '[ a == a ]']) {
        assert.strictEqual(does(sh, code), sh === 'dash' ? 'fails' : 'runs');
        assert.deepStrictEqual(levelOf(code, 'eqeqTest', sh), sh === 'dash' ? ['error'] : []);
      }
    });
  });
}

describe('`sh`, dash or busybox ash', () => {
  const textOf = (code: string, id: string): string => issues(code).find((i) => i.id === id)!.note.text;
  it('names the shell that fails, and the worst decides', () => {
    assert.strictEqual(textOf('echo a &>>f', 'ampAppend'), 'ⓧ Error: `&>>` is not POSIX sh (dash reads `cmd &` and `>>file`: the output is not redirected, and nothing is added to the file; in busybox ash it is a syntax error with status 2: the shell stops as it reads the line, even if the line would never run). Instead, write `>>file 2>&1`.');
    assert.strictEqual(textOf('printf -v x a', 'printfV'), 'ⓧ Error: `printf -v` is not POSIX sh (in dash `printf` rejects the option with `illegal option` and status 2; busybox ash prints `-v` as text, and sets no variable). Instead, write `v=$(printf …)`.');
    assert.strictEqual(textOf('type -t ls', 'typeT'), 'ⓧ Error: `type -t` is not POSIX sh (in dash `-t` is taken for a name to look up: it prints `-t: not found` and gives status 127; busybox ash\'s `type -t` prints the name, not the kind). Instead, use `command -v`.');
    assert.strictEqual(textOf('shopt -s x', 'shopt'), 'ⓧ Error: `shopt` is not POSIX sh (in dash and busybox ash the command is not found, with status 127).');
  });
  it('names only the shell that does not set a variable', () => {
    assert.match(textOf('echo "$EPOCHSECONDS"', 'epoch'), /\(dash does not set it, so it expands to nothing\)/);
    assert.match(textOf('echo "$RANDOM"', 'random'), /\(dash does not set it, so it expands to nothing\)/);
    assert.match(textOf('f() { echo "$FUNCNAME"; }', 'funcname'), /\(dash does not set it/);
    assert.match(textOf('echo "$HOSTNAME"', 'hostname'), /\(dash does not set it/);
    assert.match(textOf('echo "$UID"', 'uid'), /\(dash and busybox ash do not set it, so it expands to nothing\)/);
  });
  it('reads each shell apart at a missing operand, and in what the model cannot say of a call', () => {
    assert.deepStrictEqual(levelOf('echo $((-$UID))', 'uid'), ['warning']);
    assert.match(textOf('echo $((-$UID))', 'uid'), /\(dash and busybox ash do not set it, so the shell stops here\)/);
    assert.match(textOf('echo $(($UID % 5))', 'uid'), /\(dash and busybox ash do not set it, so the shell stops here\)/);
    assert.match(textOf('echo $(( $(echo $UID) + 1))', 'uid'), /so it expands to nothing/);
    // (A function called in a pipe and by itself: where it stops is not one place, and a function's body is a warning at any rate.)
    assert.deepStrictEqual(levelOf('set -u; f() { echo "$UID"; }; f | cat; f', 'uid'), ['warning']);
    assert.match(textOf('set -u; f() { echo "$UID"; }; f | cat; f', 'uid'), /so the shell stops here/);
    // (`[[ ]]` is its own issue in dash; the variable in it is no test of `[`.)
    assert.deepStrictEqual(levelOf('[[ $UID ]]', 'uid'), ['warning']);
  });
  it('says what each does, and is an Error where either fails', () => {
    // (`$RANDOM` is set in busybox ash, and the test passes there.)
    assert.deepStrictEqual(levelOf('[ $RANDOM -lt 5 ]', 'random'), ['warning']);
    assert.match(textOf('[ $RANDOM -lt 5 ]', 'random'), /\(dash does not set it, so the test reports an error/);
    assert.deepStrictEqual(levelOf('echo $(($RANDOM % 5))', 'random'), ['warning']);
    assert.match(textOf('echo $(($UID))', 'uid'), /\(dash does not set it, so the shell stops here; busybox ash does not set it, so it expands to nothing\)/);
    assert.deepStrictEqual(levelOf('[ a == a ]', 'eqeqTest'), ['error']);
  });
  it('keeps information for what both run', () => {
    assert.deepStrictEqual(levelOf('f() { local x; }', 'local'), ['info']);
    assert.deepStrictEqual(levelOf('set -E', 'errtrace'), ['info']);
  });
  it('says the same in a script for dash and for busybox ash, in the words of that shell, and leaves the other shells', () => {
    const note = (code: string, shell: Shell = 'dash') => dialectNotes(parser.parse(code), 0, shell, 'en');
    assert.deepStrictEqual(note('echo "$UID"'), ['⚠ Portability: `$UID` / `$EUID` is not available in dash (dash does not set it, so it expands to nothing). Instead, use `$(id -u)`.']);
    assert.deepStrictEqual(note('echo "$UID"', 'ash'), ['⚠ Portability: `$UID` / `$EUID` is not available in busybox ash (busybox ash does not set it, so it expands to nothing). Instead, use `$(id -u)`.']);
    assert.deepStrictEqual(note('echo $(($UID % 2))'), ['⚠ Portability: `$UID` / `$EUID` is not available in dash (dash does not set it, so the shell stops here). Instead, use `$(id -u)`.']);
    assert.deepStrictEqual(note('echo -e a'), ['⚠ Portability: `echo -e` is not available in dash (dash\'s `echo` prints `-e` as text). Instead, use `printf` (dash\'s `echo` always interprets `\\t` and friends).']);
    assert.deepStrictEqual(note('shopt -s x'), ['ⓧ Error: `shopt` is not available in dash (the command is not found, with status 127).']);
    assert.deepStrictEqual(note('f() { local x; }'), []);
    assert.deepStrictEqual(note('echo {a,b}', 'ash'), ['⚠ Portability: brace expansion `{a,b}` is not available in busybox ash (in busybox ash the braces stay, as one word).']);
    // (Not run here: the shell's lack is an error, as it was; a name in `$(( ))` says nothing, as it did.)
    assert.deepStrictEqual(levelOf('echo "$UID"', 'uid', 'ksh'), ['error']);
    assert.deepStrictEqual(levelOf('echo {1..3}', 'braceRange', 'mksh'), ['error']);
    assert.deepStrictEqual(levelOf('echo $((UID + 1))', 'uid', 'ksh'), []);
  });
  it('writes each text in Japanese too, in the words of the style check', () => {
    const texts = dialectTexts('ja');
    assert.ok(texts.includes('`$UID` / `$EUID` は POSIX sh にない書き方です（dash・busybox ash には設定されないので、展開すると空になります）。代わりに `$(id -u)` を使う。'));
    assert.ok(texts.includes('`$UID` / `$EUID` は POSIX sh にない書き方です（dash・busybox ash には設定されないので、ここでシェルが止まります）。代わりに `$(id -u)` を使う。'));
    assert.ok(texts.includes('`shopt` は POSIX sh にない書き方です（dash・busybox ash ではそのコマンドが見つからず、`not found` で終了ステータス 127 になります）。'));
  });
});

describe('an error of the dialect, where the shell surely gets to it', () => {
  const inDocument = (text: string) => {
    const doc = openDocument(text, 'shell', (x) => parser.parse(x));
    return documentIssues(doc, 'en', shellsOf(doc.lines, 'script', undefined));
  };
  const sh = (code: string) => inDocument(`#!/bin/sh\n${code}\n`);
  const levels = (code: string, id: string) => sh(code).filter((i) => i.code === id).map((i) => i.severity);

  for (const code of ['shopt -s x', 'y=$(shopt -s x)', 'shopt -s x | cat', '(shopt -s x)', '{ shopt -s x; }', 'if shopt -s x; then :; fi', 'shopt -s x && echo a', 'while shopt -s x; do :; done', 'for f in $(shopt -s x); do :; done', 'case $(shopt -s x) in a) ;; esac', 'if [ "$UID" -ne 0 ]; then :; fi; shopt -s x']) {
    it(`is an Error where it is reached: ${code}`, () => {
      assert.deepStrictEqual(levels(code, 'shopt'), ['error']);
    });
  }
  for (const code of ['exit 0; shopt -s x', 'exec bash "$0"; shopt -s x']) {
    it(`says nothing after a sure stop: ${code}`, () => {
      assert.deepStrictEqual(levels(code, 'shopt'), []);
    });
  }
  it('says nothing that reports a problem after a sure stop, whatever its kind', () => {
    for (const [code, id] of [['exit 0\necho -e a', 'echoE'], ['exit 0\necho {a,b}', 'braceList'], ['exit 0\necho "$UID"', 'uid'], ['exit 0\na=(1)', 'array']]) {
      assert.deepStrictEqual(levels(code, id), [], code);
    }
  });
  for (const code of ['if [ -z "$BASH" ]; then exit; fi\nshopt -s x', '. ./lib\nshopt -s x', 'source ./lib\nshopt -s x', 'eval "$(cat lib)"\nshopt -s x', 'f() { exit 1; }\nshopt -s x', 'trap "exit 0" INT\nshopt -s x']) {
    it(`is a Warning after a stop that may come first: ${code.replace(/\n/g, ' ')}`, () => {
      assert.deepStrictEqual(levels(code, 'shopt'), ['warning']);
    });
  }
  for (const code of ['if a; then shopt -s x; fi', 'if a; then :; else shopt -s x; fi', 'if a; then :; elif shopt -s x; then :; fi', 'if a; then :; elif b; then shopt -s x; fi', 'case a in a) shopt -s x;; esac', 'a && shopt -s x', 'a || shopt -s x', 'f() { shopt -s x; }', 'function g { :; }\nh() { shopt -s x; }', 'while a; do shopt -s x; done', 'for f in a; do shopt -s x; done', 'echo "${x:-$(shopt -s x)}"', '[ -n "$BASH_VERSION" ] && shopt -s x', 'type shopt >/dev/null && shopt -s x']) {
    it(`is a Warning in what may be left out: ${code.replace(/\n/g, ' ')}`, () => {
      assert.deepStrictEqual(levels(code, 'shopt'), ['warning']);
    });
  }
  it('keeps the same words at a Warning, under its own heading', () => {
    const issue = sh('if a; then shopt -s x; fi').find((i) => i.code === 'shopt')!;
    assert.match(issue.message, /`shopt` is not POSIX sh \(in dash and busybox ash the command is not found, with status 127\)/);
    assert.strictEqual(issue.severity, 'warning');
  });
  it('says nothing of `**` after a sure stop, as of the rest', () => {
    assert.deepStrictEqual(levels('ls **/x', 'globstar-unsupported'), ['warning']);
    assert.deepStrictEqual(levels('. ./lib\nls **/x', 'globstar-unsupported'), ['warning']);
    assert.deepStrictEqual(levels('exit 0\nls **/x', 'globstar-unsupported'), []);
  });
  it('holds for what a shell cannot read: the words claim no more', () => {
    for (const sh2 of REALS.filter((x) => COMMANDS[x])) {
      // (A shell that reads this stops at it, whatever runs, if it gets to read it at all.)
      assert.strictEqual(runIn(COMMANDS[sh2]!, 'if false; then\na=(1 2)\nfi\necho after\n').status, 2);
      assert.strictEqual(runIn(COMMANDS[sh2]!, 'echo before\nexit 0\na=(1 2)\n').out, 'before\n');
    }
    assert.deepStrictEqual(levels('a=(1 2)', 'array'), ['error']);
    assert.deepStrictEqual(levels('. ./lib\na=(1 2)', 'array'), ['warning']);
    assert.deepStrictEqual(levels('exit 0\na=(1 2)', 'array'), []);
    assert.doesNotMatch(sh('a=(1 2)')[0].message, /whatever|no test/);
  });
  // A syntax error comes while the shell reads the text, before anything of the line runs: where the text would run does not count, only what keeps the shell from reading it.
  const READS: [string, string][] = [['a=(1)', 'array'], ['a+=(1)', 'array'], ['declare -a x=(1 2)', 'array'], ['cat <<< a', 'herestring'], ['echo a |& cat', 'pipeAmp'], ['for ((;;)); do :; done', 'cFor'], ['select x in a; do :; done', 'select'], ['case a in a) :;& esac', 'caseFall'], ['case a in a) :;;& esac', 'caseCont'], ['echo @(a|b)', 'extglob'], ['case a in @(a|b)) :;; esac', 'extglob'], ['[[ a == @(a|b) ]]', 'extglob'], ['function g { :; }', 'funcKeyword'], ['cat <(echo a)', 'procSub'], ['echo a &>>f', 'ampAppend']];
  const PLACES: [string, (code: string) => string][] = [
    ['a function never called', (code) => `f() { ${code}; }`],
    ['if false', (code) => `if false; then\n${code}\nfi`],
    ['an else', (code) => `if true; then :; else ${code}; fi`],
    ['a loop', (code) => `while false; do ${code}; done`],
    ['a case', (code) => `case a in b) ${code};; esac`],
    ['after &&', (code) => `false && { ${code}; }`],
    ['$( ) in a function', (code) => `f() { y=$(${code}); }`],
    ['${x:-$( )}', (code) => `echo "\${x:-$(${code})}"`],
    ['a line with an exit before it', (code) => `exit 0; ${code}`],
    ['a block with an exit before it', (code) => `if true; then exit 0\n${code}\nfi`],
  ];
  const inShell = (name: string, code: string, id: string) => inDocument(`#!/bin/${name}\n${code}\n`).filter((i) => i.code === id).map((i) => i.severity);
  const realOf = (name: Real, text: string) => runIn(COMMANDS[name]!, text);
  for (const [place, wrap] of PLACES) {
    it(`what the shell refuses while reading is an Error in ${place}`, () => {
      for (const [code, id] of READS) {
        const script = `${wrap(code)}\necho next\n`;
        for (const name of REALS.filter((x) => COMMANDS[x])) {
          const lacks = !works(FEATURES[id], name);
          // (As the shell does: `&>>` in dash runs, `function` and `<( )` in busybox ash too.)
          const stops = failureOf(FEATURES[id], name)?.fault === 'read';
          if (stops) assert.strictEqual(realOf(name, script).status, 2, `${name}: ${script}`);
          assert.ok(!stops || !/next/.test(realOf(name, script).out), `${name}: ${script}`);
          if (stops) assert.deepStrictEqual([...new Set(inShell(name === 'dash' ? 'dash' : 'ash', wrap(code), id))], ['error'], `${name}: ${script}`);
          else if (lacks) assert.ok(!inShell(name === 'dash' ? 'dash' : 'ash', wrap(code), id).includes('error'), `${name}: ${script}`);
        }
        assert.deepStrictEqual([...new Set(inShell('sh', wrap(code), id))], ['error'], script);
      }
    });
  }
  it('what the shell refuses: a Warning after a stop that may come first, nothing after a sure one', () => {
    for (const [code, id] of READS) {
      for (const before of ['. ./lib', 'f() { exit 1; }', 'if [ -z "$BASH" ]; then exit; fi']) {
        assert.deepStrictEqual([...new Set(inShell('sh', `${before}\nf2() { ${code}; }`, id))], ['warning'], `${before} ${code}`);
      }
      for (const before of ['exit 0', 'exec bash "$0"']) {
        assert.deepStrictEqual(inShell('sh', `${before}\nif false; then ${code}; fi`, id), [], `${before} ${code}`);
      }
      // (What the model says never runs comes first too, as far as it trusts the script, which holds what it does not read.)
      for (const before of ['if true; then exit; fi', '{ exit 0; }']) {
        assert.ok(!inShell('sh', `${before}\nif false; then ${code}; fi`, id).includes('error'), `${before} ${code}`);
      }
    }
    for (const name of REALS.filter((x) => COMMANDS[x])) {
      assert.strictEqual(realOf(name, 'echo a\nexit 0\nif false; then a=(1); fi\n').status, 0);
      assert.strictEqual(realOf(name, 'echo a\nif true; then exit; fi\nf() { a=(1); }\n').status, 0);
      assert.strictEqual(realOf(name, 'echo a\nf() { exit 1; }\ng() { a=(1); }\n').status, 2);
    }
  });
  it('what is read when it runs is not refused: `${a[0]}`, `${x#@(a)}` and a backquote', () => {
    for (const name of REALS.filter((x) => COMMANDS[x])) {
      for (const script of ['if false; then echo "${a[0]}"; fi', 'if false; then echo `a=(1)`; fi', 'echo `a=(1)`', 'echo "${x#@(a)}"']) {
        assert.match(realOf(name, `${script}\necho next\n`).out, /next/, script);
      }
    }
    assert.deepStrictEqual(levels('f() { echo "${a[0]}"; }', 'array'), ['warning']);
    assert.deepStrictEqual(levels('f() { echo `a=(1)`; }', 'array'), ['warning']);
    assert.deepStrictEqual(levels('f() { echo `y=$(a=(1))`; }', 'array'), ['warning']);
    assert.deepStrictEqual(levels('f() { y=$(a=(1)); }', 'array'), ['error']);
    assert.deepStrictEqual(levels('f() { echo "${x:-$(a=(1))}"; }', 'array'), ['error']);
  });
  it('a string keeps the rule of the command that runs it: the shell reads it when it runs', () => {
    const inBash = (code: string, id: string) => inDocument(`#!/bin/bash\n${code}\n`).filter((i) => i.code === id).map((i) => i.severity);
    assert.deepStrictEqual(inBash(`sh -c 'a=(1)'`, 'array'), ['error']);
    assert.deepStrictEqual(inBash(`sh -c 'if false; then a=(1); fi'`, 'array'), ['error']);
    assert.deepStrictEqual(inBash(`if a; then sh -c 'a=(1)'; fi`, 'array'), ['warning']);
    assert.deepStrictEqual(inBash(`f() { sh -c 'a=(1)'; }`, 'array'), ['warning']);
    assert.deepStrictEqual(inBash(`. ./lib\nsh -c 'a=(1)'`, 'array'), ['warning']);
    assert.deepStrictEqual(inBash(`exit 0\nsh -c 'a=(1)'`, 'array'), []);
    assert.deepStrictEqual(levels(`if a; then eval 'a=(1)'; fi`, 'array'), ['warning']);
    const explained = (code: string, line: number): string[] => new Analyzer('en').explainLine(parser.parse(`#!/bin/bash\n${code}\n`), line, 'bash', { script: 'said' }).notes.filter((n) => n.includes('an array')).map((n) => n[0]);
    assert.deepStrictEqual(explained(`sh -c 'if false; then a=(1); fi'`, 1), ['ⓧ']);
    assert.deepStrictEqual(explained(`if a; then sh -c 'a=(1)'; fi`, 1), ['⚠']);
  });
  it('a string whose stderr the command discards: its failure is a status, or stops the shell the string runs in', () => {
    const row: [string, string, string, string[]][] = [
      ['if (eval "a=(1)") 2>/dev/null; then :; fi', 'array', 'sh', ['warning']],
      ['eval "a=(1)" 2>/dev/null', 'array', 'sh', ['error']],
      ['eval "a=(1)"', 'array', 'sh', ['error']],
      ['eval "shopt -s x" 2>/dev/null', 'shopt', 'sh', ['warning']],
      ['eval "shopt -s x"', 'shopt', 'sh', ['error']],
      [`sh -c 'a=(1)' 2>/dev/null`, 'array', 'bash', ['warning']],
      [`sh -c 'shopt -s x' 2>/dev/null`, 'shopt', 'bash', ['warning']],
      [`sh -c 'shopt -s x'`, 'shopt', 'bash', ['error']],
      [`set -e\nsh -c 'shopt -s x' 2>/dev/null`, 'shopt', 'bash', ['error']],
    ];
    for (const [code, id, shell, want] of row) {
      assert.deepStrictEqual(inShell(shell, code, id), want, code);
      const lines = code.split('\n');
      const notes = new Analyzer('en').explainLine(parser.parse(`#!/bin/${shell}\n${code}\n`), lines.length, shell as Shell, { script: 'said' }).notes;
      assert.deepStrictEqual(notes.filter((n) => n.includes(id === 'array' ? 'an array' : '`shopt`')).map((n) => n[0]), [want[0] === 'error' ? 'ⓧ' : '⚠'], `explained: ${code}`);
    }
    for (const name of REALS.filter((x) => COMMANDS[x])) {
      assert.deepStrictEqual([/next/.test(realOf(name, 'if (eval "a=(1)") 2>/dev/null; then :; fi\necho next\n').out), realOf(name, 'if (eval "a=(1)") 2>/dev/null; then :; fi\necho next\n').err], [true, '']);
      assert.doesNotMatch(realOf(name, 'eval "a=(1)" 2>/dev/null\necho next\n').out, /next/);
      assert.strictEqual(realOf(name, 'eval "shopt -s x" 2>/dev/null\necho next\n').out, 'next\n');
    }
  });
  it('holds in the other shells and in a release of bash, where it is no fact of the shell', () => {
    const issuesIn = (code: string, shell: Shell) => dialectIssues(parser.parse(code), shell, 'en', undefined, undefined, '5.2').map((i) => `${i.id} ${i.note.level}`);
    assert.deepStrictEqual(issuesIn('[[ a ]]; declare x', 'mksh').filter((x) => x.startsWith('declare')), ['declare error']);
    assert.deepStrictEqual(issuesIn('if a; then declare x; fi', 'mksh').filter((x) => x.startsWith('declare')), ['declare warning']);
    assert.deepStrictEqual(issuesIn('if a; then echo ${ echo b; }; fi', 'bash').map((x) => x.split(' ')[1]), ['warning']);
  });
  it('reads a string run by a command the same way, as the explanation does', () => {
    const inBash = (code: string, id: string) => inDocument(`#!/bin/bash\n${code}\n`).filter((i) => i.code === id).map((i) => i.severity);
    assert.deepStrictEqual(inBash(`sh -c '[[ a ]]'`, 'dbracket'), ['error']);
    assert.deepStrictEqual(inBash(`if a; then sh -c '[[ a ]]'; fi`, 'dbracket'), ['warning']);
    assert.deepStrictEqual(inBash(`sh -c 'if a; then [[ a ]]; fi'`, 'dbracket'), ['warning']);
    assert.deepStrictEqual(inBash(`. ./lib\nsh -c '[[ a ]]'`, 'dbracket'), ['warning']);
    assert.deepStrictEqual(inBash(`exit 0\nsh -c '[[ a ]]'`, 'dbracket'), []);
    assert.deepStrictEqual(inBash(`sh -c '. ./lib; [[ a ]]'`, 'dbracket'), ['warning']);
    assert.deepStrictEqual(inBash(`sh -c 'exit 0; [[ a ]]'`, 'dbracket'), []);
    const explained = (text: string, line: number): string[] => new Analyzer('en').explainLine(parser.parse(text), line, text.startsWith('#!/bin/sh') ? 'sh' : 'bash', { script: 'said' }).notes;
    const notesOf = (code: string, line: number) => explained(`#!/bin/bash\n${code}\n`, line).filter((n) => n.includes('[[')).map((n) => n[0]);
    assert.deepStrictEqual(notesOf(`sh -c '[[ a ]]'`, 1), ['ⓧ']);
    assert.deepStrictEqual(notesOf(`if a; then sh -c '[[ a ]]'; fi`, 1), ['⚠']);
    assert.deepStrictEqual(notesOf(`. ./lib\nsh -c '[[ a ]]'`, 2), ['⚠']);
    assert.deepStrictEqual(notesOf(`exit 0\nsh -c '[[ a ]]'`, 2), []);
    const scriptNotes = (code: string, line: number) => explained(`#!/bin/sh\n${code}\n`, line).filter((n) => n.includes('`shopt`')).map((n) => n[0]);
    assert.deepStrictEqual(scriptNotes('shopt -s x', 1), ['ⓧ']);
    assert.deepStrictEqual(scriptNotes('. ./lib\nshopt -s x', 2), ['⚠']);
    assert.deepStrictEqual(scriptNotes('exit 0\nshopt -s x', 2), []);
  });
});

describe('surelyRuns', () => {
  const place = (code: string, name = 'c'): boolean => {
    const n = descendants(parser.parse(code).root, ['command']).find((c) => c.children[0].text === name)!;
    return surelyRuns(n);
  };
  for (const code of ['c', 'c | d', 'c &', '( c )', '{ c; }', '! c', 'x=$(c)', 'c && d', 'if c; then d; fi', 'while c; do d; done', 'until c; do d; done', 'for x in $(c); do d; done', 'case $(c) in a) ;; esac', 'select x in $(c); do d; done', 'for ((i=$(c);;)); do d; done']) {
    it(`runs: ${code}`, () => assert.strictEqual(place(code), true));
  }
  for (const code of ['f() { c; }', 'if a; then c; fi', 'if a; then :; else c; fi', 'if a; then :; elif c; then :; fi', 'if a; then :; elif b; then c; fi', 'while a; do c; done', 'until a; do c; done', 'for x in a; do c; done', 'select x in a; do c; done', 'for ((;;)); do c; done', 'for ((;;i=$(c))); do d; done', 'case a in a) c;; esac', 'a && c', 'a || c', 'a && b && c', 'echo ${x:-$(c)}', '[[ a || $(c) ]]', 'case a in a|$(c)) ;; esac']) {
    it(`may be left out: ${code}`, () => assert.strictEqual(place(code), false));
  }
});

// Whether a string surely runs, the two sides of a level (the Problems, and the note in the explanation), and what dash and busybox ash do.
describe('a string that may not run, and what is said by mistake as a fault', () => {
  const inDocument = (code: string) => {
    const doc = openDocument(`#!/bin/sh\n${code}\n`, 'shell', (x) => parser.parse(x));
    return documentIssues(doc, 'en', shellsOf(doc.lines, 'script', undefined));
  };
  /** The level of the problem `id`, as the Problems say it and as the notes do (by their mark). */
  const sides = (code: string, id: string): [string[], string[]] => {
    const text = `#!/bin/sh\n${code}\n`;
    const tree = parser.parse(text);
    const label = FEATURES[id]?.en;
    const notes = code.split('\n').flatMap((_, line) => new Analyzer('en').explainLine(tree, line + 1, 'sh', { script: 'said' }).notes);
    const marks = notes.filter((n) => /^[ⓧ⚠]/.test(n) && (!label || n.includes(label))).map((n) => (n[0] === 'ⓧ' ? 'error' : 'warning'));
    return [inDocument(code).filter((i) => i.code === id).map((i) => i.severity), [...new Set(marks)]];
  };
  const says = (code: string, id: string, level: 'error' | 'warning' | undefined): void => {
    const [problems, notes] = sides(code, id);
    assert.deepStrictEqual(problems, level ? [level] : [], `problems: ${code}`);
    assert.deepStrictEqual(notes, level ? [level] : [], `notes: ${code}`);
  };

  /** The script run by each shell, as `sh` too (a folder first on PATH, where `sh` is that shell). */
  const inEach = (code: string, check: (r: { status: number | null; out: string; err: string }, sh: Real) => void): void => {
    for (const sh of REALS) {
      if (!COMMANDS[sh]) continue;
      const bin = path.join(dir, `bin-${sh}`);
      if (!fs.existsSync(bin)) {
        fs.mkdirSync(bin);
        fs.symlinkSync(COMMANDS[sh]![0], path.join(bin, sh === 'ash' ? 'busybox' : 'dash'));
        fs.symlinkSync(COMMANDS[sh]![0], path.join(bin, 'sh'));
      }
      const file = path.join(dir, 'string-script');
      fs.writeFileSync(file, `${code}\n`);
      const r = spawnSync(path.join(bin, 'sh'), [file], { cwd: dir, encoding: 'utf8', timeout: 10000, killSignal: 'SIGKILL', env: { PATH: `${bin}:${process.env.PATH}`, FUNCNEST: '50' } });
      check({ status: r.status, out: r.stdout, err: r.stderr }, sh);
    }
  };
  const quiet = (code: string): void => inEach(code, (r, sh) => assert.deepStrictEqual([r.status, r.err], [0, ''], `${sh}: ${code}`));
  const fails = (code: string): void => inEach(code, (r, sh) => assert.notStrictEqual(r.status, 0, `${sh}: ${code}`));

  // A trap's action runs if its signal comes.
  const TEMP_TRAP = 'tmp=$(mktemp)\ntrap \'[[ -f "$tmp" ]] && rm -f "$tmp"; exit 1\' INT TERM\necho work; rm -f "$tmp"';
  for (const [code, id] of [
    [TEMP_TRAP, 'dbracket'], ["trap 'a=(1)' USR1", 'array'], ["trap 'a=(1)' INT", 'array'], ["trap 'a=(1)' TERM", 'array'], ["trap 'x=$(cat <<< a)' INT TERM", 'herestring'],
    ["trap 'shopt -s x' INT", 'shopt'], ["trap 'declare -p x; exit 1' TERM", 'declare'], ["trap 'echo \"${x:1}\"' USR2", 'substr'],
    ["trap 'a=(1)' EXIT\ntrap - EXIT", 'array'], ["trap 'a=(1)' EXIT\ntrap '' EXIT", 'array'], ["trap 'a=(1)' 0\ntrap 0", 'array'], ["trap 'a=(1)' exit\ntrap - 0", 'array'], ["trap 'a=(1)' EXIT\nexec true", 'array'],
    ["if false; then trap 'a=(1)' EXIT; fi", 'array'],
  ]) {
    it(`a Warning, status 0 with nothing on stderr: ${code.replace(/\n/g, '; ')}`, () => {
      says(code, id, 'warning');
      quiet(code);
    });
  }
  for (const signal of ['INT', 'TERM', 'USR1']) {
    it(`what a string read only when ${signal} comes does then`, () => {
      inEach(`trap 'a=(1)' ${signal}\nkill -${signal} $$\necho next`, (r, sh) => assert.deepStrictEqual([r.status, r.out], [2, ''], sh));
    });
  }
  for (const code of ["trap 'a=(1)' EXIT", "trap 'a=(1)' 0", "trap 'a=(1)' exit", "trap 'a=(1)' INT EXIT", "trap -- 'a=(1)' EXIT", "trap 'a=(1)' EXIT\ntrap : INT", "trap 'a=(1)' EXIT\nexec 3>&1", "(trap 'a=(1)' EXIT; echo a)\nexit $?"]) {
    it(`an Error, as the end of the shell runs it: ${code.replace(/\n/g, '; ')}`, () => {
      says(code, 'array', 'error');
      inEach(code, (r, sh) => assert.match(r.err, /[Ss]yntax error/, `${sh}: ${code}`));
    });
  }
  it('an EXIT trap dash cannot run and busybox ash can: dash is enough', () => {
    const code = "trap '[[ -f x ]] && rm x' EXIT";
    says(code, 'dbracket', 'error');
    inEach(code, (r, sh) => assert.strictEqual(/\[\[: not found/.test(r.err), sh === 'dash', sh));
  });
  it('a later `trap` of signals not known here may take the end back; a signal word not known is no EXIT', () => {
    says("trap 'a=(1)' EXIT\ntrap : \"$s\"", 'array', 'warning');
    says("trap 'a=(1)' \"$s\"", 'array', 'warning');
    says("if a; then trap 'a=(1)' EXIT; fi", 'array', 'warning');
  });

  // Each slot of the dictionary: `run` where the row runs in the shells here (the others are other machines, or need a privilege).
  const STRING = "sh -c 'shopt -s x'";
  const SURE: [string, boolean][] = [
    ['env', true], ['env -i PATH="$PATH"', true], ['timeout 5', true], ['nice', true], ['nohup', true], ['exec', true], ['command', true], ['setsid -w', true], ['stdbuf -o0', true],
    ['sudo', false], ['sudo -E', false], ['doas', false], ['ionice', false], ['chroot /', false], ['unshare', false], ['nsenter', false], ['runcon -t x', false], ['strace', false], ['ltrace', false], ['perf stat', false], ['perf record', false], ['caffeinate', false],
  ];
  for (const [wrapper, run] of SURE) {
    it(`an Error: ${wrapper} ${STRING}`, () => {
      says(`${wrapper} ${STRING}`, 'shopt', 'error');
      if (run) fails(`${wrapper} ${STRING}`);
    });
  }
  for (const code of ["eval 'shopt -s x'", "builtin eval 'shopt -s x'", "command eval 'shopt -s x'", STRING, `(${STRING})`, `: | ${STRING}`, `y=$(${STRING}) || exit 1`, 'dash -c \'shopt -s x\'', `env timeout 5 ${STRING}`, `sudo env ${STRING}`, `time ${STRING}`, `/usr/bin/time ${STRING}`]) {
    it(`an Error: ${code}`, () => says(code, 'shopt', 'error'));
  }
  const SOMETIMES = [
    `xargs ${STRING}`, `xargs -r ${STRING}`, `xargs -I{} ${STRING}`, `find . -exec ${STRING} \\;`, `find . -execdir ${STRING} \\;`, `find . -ok ${STRING} \\;`, `find . -exec ${STRING} _ {} +`, `watch ${STRING}`, 'watch \'shopt -s x\'', 'watch -x sh -c \'shopt -s x\'',
    `ssh h sh -c "'shopt -s x'"`, `su -c "${STRING}"`, `docker run i ${STRING}`, `docker exec c ${STRING}`, `docker compose run s ${STRING}`, `docker compose exec s ${STRING}`, `kubectl exec p -- ${STRING}`, `kubectl run p --image=i -- ${STRING}`, `kubectl debug p -- ${STRING}`,
    `flock f ${STRING}`, `flock -n f ${STRING}`, `systemd-run ${STRING}`, `systemd-cat ${STRING}`, `uv run ${STRING}`, `poetry run ${STRING}`, `npx ${STRING}`, `jobs -x ${STRING}`, `sudo xargs ${STRING}`, `xargs env ${STRING}`, `sh -n -c 'shopt -s x'`, `sh -en -c 'shopt -s x'`, `if a; then ${STRING}; fi`,
  ];
  for (const code of SOMETIMES) {
    it(`a Warning: ${code}`, () => says(code, 'shopt', 'warning'));
  }
  it('a slot that runs per item, or reads and runs nothing: status 0 where it does not run', () => {
    for (const code of ['find . -name nonexist -exec sh -c \'shopt -s x\' \\;', 'find . -name nonexist -exec sh -c \'a=(1)\' \\;', ': | xargs -r sh -c \'[[ -f "$1" ]]\' _', "sh -n -c 'shopt -s x'"]) quiet(code);
    says('find . -name nonexist -exec sh -c \'shopt -s x\' \\;', 'shopt', 'warning');
    says('find . -name nonexist -exec sh -c \'a=(1)\' \\;', 'array', 'warning');
    says(': | xargs -r sh -c \'[[ -f "$1" ]]\' _', 'dbracket', 'warning');
  });
  it('a program the dictionary does not know: no string is read', () => {
    assert.deepStrictEqual(inDocument(`parallel ${STRING}`).filter((i) => i.code === 'shopt'), []);
  });
  it('a string in a string asks at each level', () => {
    says('sh -c "sh -c \'a=(1)\'"', 'array', 'error');
    says('trap "sh -c \'a=(1)\'" EXIT', 'array', 'error');
    says('trap "sh -c \'a=(1)\'" INT', 'array', 'warning');
    says('trap \'eval "a=(1)"\' INT', 'array', 'warning');
    says('trap \'eval "a=(1)"\' EXIT', 'array', 'error');
    says('if a; then sh -c "sh -c \'a=(1)\'"; fi', 'array', 'warning');
    says('find . -exec sh -c "sh -c \'a=(1)\'" \\;', 'array', 'warning');
    says('sh -c "trap \'a=(1)\' INT"', 'array', 'warning');
    says('sh -c "trap \'a=(1)\' EXIT"', 'array', 'error');
    says('watch "trap \'a=(1)\' EXIT"', 'array', 'warning');
  });
  it('a fault of the text of a string follows the same rule', () => {
    says("trap 'if a then b; fi' INT", 'keyword-needs-separator', 'warning');
    says("trap 'x = 1' INT", 'assignment-with-spaces', 'warning');
    says("if a; then sh -c 'if a then b; fi'; fi", 'keyword-needs-separator', 'warning');
    says("find . -exec sh -c 'if a then b; fi' \\;", 'keyword-needs-separator', 'warning');
    says("trap 'if a then b; fi' EXIT", 'keyword-needs-separator', 'error');
    says("sh -c 'if a then b; fi'", 'keyword-needs-separator', 'error');
  });

  // `printf`: the format alone is read.
  for (const code of [`printf '%d%%quality\\n' 90`, `printf '%s\\n' '50%quota'`, `printf "%s: %s\\n" "%q" x`, `printf '%%q\\n'`, `printf '%%%%q\\n'`, 'printf "$f" x', `printf '%s' %q`]) {
    it(`nothing of %q: ${code}`, () => {
      says(code, 'printfQ', undefined);
      inEach(code, (r, sh) => assert.deepStrictEqual([r.status, r.err], [0, ''], `${sh}: ${code}`));
    });
  }
  for (const code of ['printf %q x', `printf '%q\\n' x`, `printf 'a%qb' x`, `printf -- '%q' x`, `printf '%5q' x`, `printf '%-5q' x`, `printf '%%%q' x`, `printf >f '%q' x`, `printf "%q" x`]) {
    it(`an Error: ${code}`, () => {
      says(code, 'printfQ', 'error');
      fails(code);
    });
  }

  it('a format not known says nothing; with `-v`, dash refuses it, and busybox ash reads `-v` as the format', () => {
    says('printf "$f%q" x', 'printfQ', undefined);
    says('printf -v v %q x', 'printfQ', 'error');
    inEach('printf -v v %q x', (r, sh) => assert.strictEqual(r.status, sh === 'dash' ? 2 : 0, sh));
  });

  // `==`: where the test reads it as an operator.
  for (const [code, status] of [['[ "$1" = == ]', 1], ['[ == ]', 0], ['[ == = == ]', 0], ['test == = ==', 0], ['[ a = b -o c = == ]', 1], ['[ ! == ]', 1], ['[ -n == ]', 0]] as const) {
    it(`nothing of ==, as an operand: ${code}`, () => {
      says(code, 'eqeqTest', undefined);
      inEach(code, (r, sh) => assert.deepStrictEqual([r.status, r.err], [status, ''], `${sh}: ${code}`));
    });
  }
  it('nothing of ==, in a test that fails with or without it', () => {
    says('[ a == ]', 'eqeqTest', undefined);
    says('[ == a ]', 'eqeqTest', undefined);
    inEach('[ a == ]', (r, sh) => assert.strictEqual(r.status, 2, sh));
  });
  for (const code of ['test a == a', '[ a == b ]', `[ a '==' b ]`, '[ "$x" == "$y" ]', '[ ! a == b ]', '[ a = a -a b == b ]', '[ \\( a == b \\) ]', '[ == == == ]']) {
    it(`an Error, as an operator, which dash refuses: ${code}`, () => {
      says(code, 'eqeqTest', 'error');
      inEach(code, (r, sh) => {
        if (sh === 'dash') assert.strictEqual(r.status, 2, code);
        else assert.strictEqual(r.err, '', code);
      });
    });
  }

  // `${x:?}` may end the shell.
  for (const [first, then, id] of [
    [': "${BASH_VERSION:?needs bash}"', 'shopt -s x', 'shopt'], [': "${BASH_VERSION:?needs bash}"', 'a=(1)', 'array'], [': "${BASH_VERSION?needs bash}"', 'shopt -s x', 'shopt'], [': "${x?}"', 'a=(1)', 'array'],
    [': "${1:?usage}"', 'shopt -s x', 'shopt'], ['y="${1:?usage}"', 'shopt -s x', 'shopt'], ['x=; : "${x:?}"', 'shopt -s x', 'shopt'], ['x=$(true); : "${x:?}"', 'shopt -s x', 'shopt'], ['unset x; : "${x?}"', 'shopt -s x', 'shopt'],
  ]) {
    it(`a Warning after what stops the shell: ${first}; ${then}`, () => {
      says(`${first}\n${then}`, id, 'warning');
      inEach(`${first}\n${then}\necho next`, (r, sh) => {
        assert.strictEqual(r.status, 2, `${sh}: ${first}`);
        assert.strictEqual(r.out, '', `${sh}: ${first}`);
        assert.doesNotMatch(r.err, /shopt|\($/, `${sh}: ${first}`);
      });
    });
  }
  for (const first of ['x=1; : "${x:?}"', 'x=; : "${x?}"', '(: "${x:?}")', 'y=$(: "${x:?}")', ': "${x:?}" | cat', ': "${x:-a}"']) {
    it(`an Error, as the shell goes on: ${first}; shopt -s x`, () => {
      says(`${first}\nshopt -s x`, 'shopt', 'error');
      inEach(`${first}\nshopt -s x`, (r, sh) => assert.match(r.err, /shopt: not found/, `${sh}: ${first}`));
    });
  }
  it('what the shell refuses on the same line comes first', () => {
    says(': "${x:?}"; a=(1)', 'array', 'error');
    inEach(': "${x:?}"; a=(1)', (r, sh) => assert.match(r.err, /[Ss]yntax error/, sh));
  });
  it('an expansion read only sometimes, or in a function, may still stop it; one the shell has no reading of does not', () => {
    says(': "${y:-${x:?}}"\nshopt -s x', 'shopt', 'warning');
    says('f() { : "${x:?}"; }\nshopt -s x', 'shopt', 'warning');
    says(': "${(f)x}"\nshopt -s x', 'shopt', 'error');
  });
});
