// Deciding conditions (src/semantics/conditions.ts, and the status the state model gives: docs/design/semantics.md,
// 4.14) against bash: the `test` builtin over a generated table of argument lists, pattern matching against `case`,
// and the status after a statement against `$?`.
import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { run } from './support/run';
import { patternMatches, testInteger, testStatus, unaryTest } from '../src/semantics/conditions';
import { shellState } from '../src/semantics/state';
import { createUnbashParser } from '../src/syntax/adapters/unbash';

const quote = (w: string): string => `'${w.replace(/'/g, `'\\''`)}'`;

/** The output lines of a bash script (`bash -s`, in the C locale). */
function bashLines(script: string): string[] {
  const out = run('bash', ['-s'], { input: script, env: { ...process.env, LC_ALL: 'C' }, ignoreStderr: true, maxBuffer: 1 << 28 }).stdout.toString();
  return out.split('\n').slice(0, -1);
}

/** A seeded generator (mulberry32), so that the table is the same on every run. */
function random(seed: number): () => number {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('the test builtin against bash (src/semantics/conditions.ts)', () => {
  // (`-o errexit` is off in `bash -s`; the other options are not known to the decision.)
  const env = { option: (name: string) => (name === 'errexit' ? false : undefined) };

  it('gives the status of `test` for every list of up to three words, and many longer ones', function () {
    this.timeout(120_000);
    const tokens = ['', 'a', 'b', '!', '(', ')', '-a', '-o', '-n', '-z', '=', '==', '!=', '<', '>', '-eq', '-ne', '-lt', '-le', '-gt', '-ge', '1', '01', ' 2', '-3', 'x1', '-f', '-t', 'errexit'];
    const lists: string[][] = [[]];
    for (const a of tokens) {
      lists.push([a]);
      for (const b of tokens) {
        lists.push([a, b]);
        for (const c of tokens) lists.push([a, b, c]);
      }
    }
    const next = random(42);
    const pick = (): string => tokens[Math.floor(next() * tokens.length)];
    for (let i = 0; i < 6000; i++) lists.push(Array.from({ length: 4 + Math.floor(next() * 4) }, pick));
    const bash = bashLines(lists.map((l) => `test ${l.map(quote).join(' ')}; echo $?`).join('\n')).map(Number);
    assert.strictEqual(bash.length, lists.length);
    let decided = 0;
    const wrong: string[] = [];
    lists.forEach((l, i) => {
      const ours = testStatus(l, env);
      if (ours === undefined) return;
      decided++;
      if (ours !== bash[i]) wrong.push(`test ${l.map(quote).join(' ')}: ours ${ours}, bash ${bash[i]}`);
    });
    assert.deepStrictEqual(wrong.slice(0, 20), []);
    // (Most lists are decided: only the tests of files, `-t` and some long tests with them are not.)
    assert.ok(decided > lists.length * 0.8, `${decided} of ${lists.length} decided`);
  });

  it('reads integers as bash does, and leaves out what it does not follow', () => {
    assert.strictEqual(testInteger(' \t12 \t'), 12n);
    assert.strictEqual(testInteger('12\n'), undefined);
    assert.strictEqual(testInteger('99999999999999999999'), null);
    assert.strictEqual(testStatus(['1', '-eq', '99999999999999999999'], env), undefined);
    assert.strictEqual(testStatus(['a', '-nt', 'b'], env), undefined);
    assert.strictEqual(testStatus(['-o', 'pipefail'], env), undefined);
    assert.strictEqual(testStatus(['a', '<', 'b'], env), undefined);
    assert.strictEqual(testStatus(['é', '<', 'b'], env), undefined);
    assert.strictEqual(testStatus(['-f', 'x', '-o', 'a'], env), 0);
    assert.strictEqual(testStatus(['-f', 'x', '-a', 'a'], env), undefined);
    assert.strictEqual(unaryTest('-d', 'x', env), undefined);
  });
});

describe('pattern matching against case (src/semantics/conditions.ts)', () => {
  it('matches as `case` does', () => {
    const patterns = ['*', 'a*', '*b', 'a?c', '[abc]', '[!a]x', '[^a]x', '[a-c]*', '[[:digit:]]*', '[[:alpha:]_]', '\\*', 'a\\?', '[]]', '[!]]', '[a-]',
      '*.txt', '?', '??', '[', 'a[', '[a', '\\\\', '[[:upper:]][[:lower:]]', '[.]', 'x*y*z', '[[:space:]]', 'a\\b', '[\\]]', '[a\\-z]', '*[0-9]', '[z-a]'];
    const subjects = ['', 'a', 'b', 'abc', 'a*', 'a?', ']', '-', '*', 'x.txt', 'Ab', '1', '_', '[', 'a[', '[a', '\\', 'xyz', 'xaybz', ' ', 'ax', 'bx', 'ab', 'z', '.'];
    const cases = patterns.flatMap((p) => subjects.map((s) => ({ p, s })));
    const bash = bashLines(cases.map(({ p, s }) => `case ${quote(s)} in ${p}) echo 0;; *) echo 1;; esac`).join('\n'));
    const wrong = cases.filter(({ p, s }, i) => patternMatches(s, p) !== (bash[i] === '0')).map(({ p, s }) => `${JSON.stringify(s)} ${p}`);
    assert.deepStrictEqual(wrong, []);
  });

  it('leaves out extended globs and text that is not ASCII', () => {
    assert.strictEqual(patternMatches('ab', '@(a|b)b'), undefined);
    assert.strictEqual(patternMatches('é', '?'), undefined);
  });
});

describe('the status after a statement against bash (src/semantics/state.ts)', () => {
  const parser = createUnbashParser();
  /** The status the model gives after `snippet`, read at a `:` after it. */
  const ours = (snippet: string): number | undefined => {
    const tree = parser.parse(`${snippet}\n:`);
    const last = tree.root.namedChildren[tree.root.namedChildren.length - 1];
    return shellState(tree, 'bash').at(last).run.status;
  };
  let dir: string;
  before(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'conditions-'));
  });
  after(() => fs.rmSync(dir, { recursive: true, force: true }));
  /** bash's `$?` after `snippet` (or its exit status, when it stops). */
  const theirs = (snippet: string): number => {
    const r = run('bash', ['-c', `${snippet}\necho "status $?"`], { cwd: dir, env: { ...process.env, LC_ALL: 'C' }, ignoreStderr: true });
    const m = /status (\d+)\n$/.exec(r.stdout.toString());
    return m ? Number(m[1]) : r.status!;
  };

  // Each snippet, and whether the model knows its status.
  const rows: [string, boolean][] = [
    ['true', true], ['false', true], [':', true], ['! true', true], ['! false', true], ['true | false', true], ['false | true', true],
    ['set -o pipefail; false | true', true], ['set -o pipefail; false | true | true', true], ['[ -f x ] && set -o pipefail; false | true', false],
    ['x=1', true], ['x=1 y=2', true], ['x=1 >/dev/null', true], ['x=$(false)', false], ['readonly r=1; r=2', false], ['declare -i n; n=x', false],
    ['set -u; x=$nope', false], ['x=${nope?}', false],
    ['[ ]', true], ['[ a ]', true], ['[ -n "" ]', true], ['[ a = b ]', true], ['[ 1 -lt 2 ]', true], ['[ a -lt 2 ]', true], ['test a', true], ['test', true],
    ['x=; [ -n $x ]', true], ['x="a b"; [ -n $x ]', true], ['x="a b"; [ -n "$x" ]', true], ['x="*"; [ $x = a ]', false], ['IFS=:; x=a; [ $x = a ]', false],
    ['[ " 1" -eq 1 ]', true], ['[ "1 " -eq 1 ]', true], ['[ ! ]', true], ['[ \\( a \\) ]', true], ['[ a -a "" ]', true], ['[ a -o "" ]', true],
    ['[ ! a = a ]', true], ['test 1 -gt 0 -a 2 -lt 1', true], ['[ "" ]', true], ['[ a \\< b ]', false], ['[ -f /nonexistent ]', false], ['[ a ] > /nonexistent/x', false],
    ['[ a ] 2>/dev/null', true], ['[ a ] 2>&1', true], ['[ $nope = a ]', false], ['NOPE=1; [ "$NOPE" = 1 ]', true], ['[ "$HOME" = 1 ]', false],
    ['[[ a ]]', true], ['[[ -z "" ]]', true], ['[[ a == a* ]]', true], ['[[ ab != a? ]]', true], ['[[ a == "a*" ]]', true], ['[[ a* == "a*" ]]', true],
    ['p="a*"; [[ ab == $p ]]', true], ['p="a*"; [[ ab == "$p" ]]', true], ['[[ 1 -eq 01 ]]', false], ['[[ 2 -gt 1 ]]', true], ['[[ " 2" -ge 3 ]]', true],
    ['[[ a < b ]]', false], ['[[ abc =~ ^ab ]]', true], ['[[ abc =~ c$ ]]', true], ['[[ abc =~ bd ]]', true], ['[[ abc =~ ^abc$ ]]', true], ['[[ abc =~ a.c ]]', false], ['[[ 12 =~ 1 ]]', true], ['[[ abc =~ "b" ]]', false],
    ['[[ -o errexit ]]', false], ['set -e; [[ -o errexit ]]', true], ['set -o noglob; [ -o noglob ]', true], ['[[ ! ( a == b ) ]]', true],
    ['[[ -f /nonexistent || a ]]', true], ['[[ -f /nonexistent && a ]]', false], ['[[ 1 == 2 && $nope == 2 ]]', true], ['x=1; [[ $x == 1 && $nope == 2 ]]', false],
    ['[[ -f /nonexistent || "" ]]', false], ['[[ -f /nonexistent && "" ]]', true], ['[[ a = ~ ]]', false], ['[[ a=~/x == a ]]', false],
    ['shopt -s nocasematch; [[ A == a ]]', false], ['[[ ab == @(a|b)b ]]', false], ['[[ a == $nope ]]', false],
    ['(( 0 ))', true], ['(( 2 ))', true], ['(( x = 3 ))', true], ['x=0; (( x ))', false], ['(( y ))', false], ['(( 1 / 0 ))', false], ['(( $nope ))', false],
    ['{ false; true; }', true], ['( false )', true], ['( true; false )', true], ['false; true', true], ['set -e; true; false', false], ['true &', true],
    ['( exit 3 )', false], ['f() { false; }; f', false], ['x=1 true', false], ['true $nope', false], ['true 2>&1', true], ['true <<< x', false],
    ['debug=false; $debug', true], ['debug="false x"; $debug', false], ['true() { false; }; true', false],
    ['if true; then false; fi', true], ['if false; then true; fi', true], ['if false; then :; else false; fi', true],
    ['if false; then :; elif true; then false; fi', true], ['if [ -f /nonexistent ]; then false; fi', false], ['x=1; if [ $x = 1 ]; then (exit 3); fi', false],
    ['case a in a) false;; esac', true], ['case a in b) false;; esac', true], ['case ab in a*) true ;& b) false;; esac', true],
    ['case ab in a*) false ;;& *b) true;; esac', true], ['case ab in a*) false ;;& c) true;; esac', true], ['case $nope in a) false;; esac', false],
    ['case "a b" in "a "*) false;; esac', true], ['case a in [!b]) false;; esac', true],
    ['false || true', true], ['true && false', true], ['false && true', true], ['true || false', true], ['[ -f /nonexistent ] && true', false],
    ['false; [ $? -eq 1 ]', true], ['false; (( $? == 1 ))', true], ['false; [ "$(true)" ] || [ $? = 1 ]', true], ['true | false; [ $? = 1 ]', true],
    ['f() { :; }; f; [ $? = 0 ]', false],
    // Words read as bash expands them (src/semantics/words.ts): a pattern in parts, `${x:-w}`, `~`, `$(( ))`, braces, `set -f`.
    ['p=a; [[ abc == $p* ]]', true], ['p=a; [[ abc == "$p"* ]]', true], ['p=a; [[ a* == "$p*" ]]', true], ['p=a; case abc in $p*) false;; esac', true],
    ['p="\\*"; [[ "*" == $p ]]', true], ['p="\\*"; [[ a == $p ]]', true], ['x=a; [[ ${x:-b} == a ]]', true], ['[[ ${nope-b} == b ]]', false], ['x=abc; [ "${x#a}" = bc ]', true],
    ['HOME=/h; [[ ~ == /h ]]', true], ['HOME=/h; [ ~/a = /h/a ]', true], ['[[ ~ == /h ]]', false], ['[[ $((1+2)) == 3 ]]', true], ['x=1; [[ $((x=2)) == 2 && $x == 2 ]]', false],
    ['set -f; x="*"; [ $x = "*" ]', true], ['x="*"; [ $x = "*" ]', false], ['x=a; [ {a,b} = a ]', true], ['set +B; [ {a,b} = a ]', true], ['x="a b"; [ $x = "a b" ]', true],
    ['IFS=:; x="a:b"; [ $x = a ]', false], ['x=; [[ a == b || ${x:?empty} == a ]]', false],
    // What the model does not follow, or must not decide.
    ['set -o pipefail; [ -f /nonexistent ] | true', false], ['set -o pipefail; true | true', true], ['if true; then false; elif true; then true; fi', true], ['[() { return 3; }; [ a ]', false],
    ['set +e; [[ -o errexit ]]', true], ['set -o posix; [ a \\< b ]', false], ['[ -f /nonexistent ] && set -o posix; [ a \\< b ]', false],
    ['[[ 1 -eq $nope ]]', false], ["[ $'\\xff' = a ]", false], ["[ $'a\\tb' = a ]", true], ['unset x; [ -z "$x" ]', false], ['x=; [ -z "$x" ]', true], ['x=1 ""', false],
    ['x=1 $(:)', false], ['x=1 "" >/dev/null', false], ['v="u + 1"; (( v )); (( v ))', false], ['x=1; eval :; [ "$x" = 1 ]', true], ['x=1; eval "$c"; [ "$x" = 1 ]', false],
    ['x=1; exec {x}>/dev/null; [ "$x" = 1 ]', false], ['[ "$(echo a)" = a ]', false], ['[ "${#x}" = 0 ]', false], ['[ "a\\b" = "a\\b" ]', true],
    ['shopt -s nocasematch; [[ A =~ a ]]', false], ["x=$'1\\r'; [[ $x -eq 1 ]]", false], ['x=$\'1\\n\'; [[ $x -eq 1 ]]', false], ['[[ $\'1\\n\' -eq 1 ]]', true], ['[ @(a) = a ]', false],
    ['declare -c y=abc; [ "$y" = abc ]', false], ['_=5; [ "$_" = 5 ]', false], ['x=1; v=x; unset "$v"; [ "$x" = 1 ]', false], ['x=1; v=x; read $v <<< 2; [ "$x" = 1 ]', false],
    ['x=1; v=x; printf -v "$v" 2; [ "$x" = 1 ]', false], ['x=1; v=x; declare "$v=2"; [ "$x" = 1 ]', false], ['x=1; v=x; typeset -n r=$v; r=2; [ "$x" = 1 ]', false],
    ['PWD=/x; cd /; [ "$PWD" = /x ]', false], ['enable -n "["; [ a ]', false], ['x=1; for i in a; do x=2; break; x=3; done; [ "$x" = 2 ]', true],
    ['x=1; f() { x=2; return; x=3; }; f; [ "$x" = 2 ]', true], ['x=1; for i in a b; do x=$i; continue; x=9; done; [ "$x" = b ]', false], ['x=1; for i in a b; do x=2; continue; x=9; done; [ "$x" = 2 ]', true],
  ];
  for (const [snippet, known] of rows) {
    it(JSON.stringify(snippet), () => {
      const status = ours(snippet);
      assert.strictEqual(status !== undefined, known, `model: ${status}`);
      if (status !== undefined) assert.strictEqual(status, theirs(snippet));
    });
  }
});
