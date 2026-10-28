import * as assert from 'assert';
import { execFileSync, spawnSync } from 'child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { BashParser as Parser } from '../src/syntax/tree';
import { dialectIssues } from '../src/dialect';
import { Edit, fixFor } from '../src/fixes';
import { createUnbashParser } from '../src/syntax/adapters/unbash';

const root = path.join(__dirname, '..');
let parser: Parser;
before(async () => {
  parser = createUnbashParser();
});

/** Apply edits (on one line) to the source. */
function apply(src: string, edits: Edit[]): string {
  let out = src;
  for (const e of [...edits].sort((a, b) => b.startCol - a.startCol)) out = out.slice(0, e.startCol) + e.text + out.slice(e.endCol);
  return out;
}

/** The fixed source for the first fixable issue, if any. */
function fixed(src: string, shell: 'sh' | 'dash' = 'sh'): string | undefined {
  const tree = parser.parse(src);
  const fix = dialectIssues(tree, shell, 'en').map(fixFor).find(Boolean);
  return fix && apply(src, fix.edits);
}

describe('[[ ]] quick fix keeps the meaning (bash [[ ]] vs dash [ ])', () => {
  const cases: [string, string][] = [
    ['[[ -f $f ]]', '[ -f "$f" ]'],
    ['[[ -n $a && $b != c ]]', '[ -n "$a" ] && [ "$b" != c ]'],
    ['[[ ! -d $d ]]', '[ ! -d "$d" ]'],
    ['[[ $x ]]', '[ -n "$x" ]'],
    ['[[ $# -gt 0 || -z "$m" ]]', '[ "$#" -gt 0 ] || [ -z "$m" ]'],
    ['[[ "$#" -eq 1 && 3 -lt 10 ]]', '[ "$#" -eq 1 ] && [ 3 -lt 10 ]'],
    ["[[ ${#} -ne '0' ]]", "[ \"${#}\" -ne '0' ]"],
    ['[[ ! -e $f && $a -ef $b ]]', '[ ! -e "$f" ] && [ "$a" -ef "$b" ]'],
    ['[[ -t 1 || $* == "x y" ]]', '[ -t 1 ] || [ "$*" = "x y" ]'],
    ['[[ $a == "x y" ]]', '[ "$a" = "x y" ]'],
    ['[[ a$b == ab ]]', '[ "a$b" = ab ]'],
    ['[[ $(echo $a) == x ]]', '[ "$(echo $a)" = x ]'],
  ];
  const values = [['', '', '', ''], ['x y', 'c', '5', ''], ['*', 'b c', '1', 'm'], ['x', '', '4', '-n'], ['/', '/tmp', '0', '']];
  for (const [src, expected] of cases) {
    it(src, () => {
      const out = fixed(src)!;
      assert.strictEqual(out, expected);
      for (const [a, b, n, m] of values) {
        const set = `set -- ${n}; a=${JSON.stringify(a)} b=${JSON.stringify(b)} f=${JSON.stringify(b)} d=${JSON.stringify(b)} x=${JSON.stringify(a)} n=${JSON.stringify(n)} m=${JSON.stringify(m)};`;
        const run = (shell: string, code: string) => execFileSync(shell, ['-c', `${set} if ${code}; then echo T; else echo F; fi 2>/dev/null`]).toString().trim();
        assert.strictEqual(run('dash', out), run('bash', src), `${set} ${src} vs ${out}`);
      }
    });
  }
  it('offers no fix when [ ] would mean something else', () => {
    for (const src of ['[[ $f == *.txt ]]', '[[ $a == $b ]]', '[[ $a =~ ^x ]]', '[[ $a < $b ]]', '[[ ( -f a ) ]]', '[[ -f a || -f b && -f c ]]']) {
      assert.strictEqual(fixed(src), undefined, src);
    }
  });
  // Each: a `[[ ]]`, the `[ ]` a fix that kept its operators would write, and values for which dash runs that `[ ]`
  // otherwise than bash runs the `[[ ]]` (status 0, 1 or 2), in a directory with the file `f`.
  const kept: [string, string, string][] = [
    ['[[ $a -eq $b ]]', '[ "$a" -eq "$b" ]', 'a=1+1 b=2'],
    ['[[ $a -eq 010 ]]', '[ "$a" -eq 010 ]', 'a=8'],
    ['[[ $a -lt 1 ]]', '[ "$a" -lt 1 ]', 'a='],
    ['[[ $# -gt $a ]]', '[ "$#" -gt "$a" ]', 'a=1+1'],
    ['[[ -n a$@ ]]', '[ -n "a$@" ]', 'set -- a b'],
    ['[[ 010 -ne 8 ]]', '[ 010 -ne 8 ]', ''],
    ["[[ '010' -ge 9 ]]", "[ '010' -ge 9 ]", ''],
    ['[[ "$a" -gt 2 ]]', '[ "$a" -gt 2 ]', 'a=x=3'],
    ['[[ 99999999999999999999 -le 1 ]]', '[ 99999999999999999999 -le 1 ]', ''],
    ['[[ 1x -eq 1 ]]', '[ 1x -eq 1 ]', ''],
    ['[[ ${#a} -eq 1 ]]', '[ "${#a}" -eq 1 ]', 'a=\u00e9'],
    ['[[ -v a ]]', '[ -v a ]', 'a=1'],
    ['[[ -o errexit ]]', '[ -o errexit ]', 'set -e'],
    ['[[ -a f ]]', '[ -a f ]', ''],
    ['[[ -R a ]]', '[ -R a ]', ''],
    ['[[ -N f ]]', '[ -N f ]', ''],
    ['[[ f -nt g ]]', '[ f -nt g ]', ''],
    ['[[ g -ot f ]]', '[ g -ot f ]', ''],
    ['[[ -t $a ]]', '[ -t "$a" ]', 'a=x'],
    ['[[ ! ! $a ]]', '[ ! ! -n "$a" ]', 'a='],
    ['[[ ! ! -f $a ]]', '[ ! ! -f "$a" ]', 'a=g'],
    ['[[ -n $@ ]]', '[ -n "$@" ]', 'set -- a b'],
    ['[[ "$@" == "a b" ]]', '[ "$@" = "a b" ]', 'set -- a b'],
  ];
  for (const [src, naive, set] of kept) {
    it(`offers no fix for ${src}, which dash reads otherwise as ${naive}`, () => {
      assert.strictEqual(fixed(src), undefined);
      const dir = mkdtempSync(path.join(os.tmpdir(), 'fixes-'));
      try {
        writeFileSync(path.join(dir, 'f'), '');
        const status = (shell: string, code: string) => spawnSync(shell, ['-c', `${set}\n${code}`], { cwd: dir, env: { PATH: process.env.PATH, LC_ALL: 'C.UTF-8' } }).status;
        assert.notStrictEqual(status('dash', naive), status('bash', src), `${set}; ${src} vs ${naive}`);
      } finally {
        rmSync(dir, { recursive: true });
      }
    });
  }
  it('only fixes where the shell lacks [[ ]]', () => {
    const tree = parser.parse('[[ -f x ]]');
    assert.deepStrictEqual(dialectIssues(tree, 'bash', 'en'), []);
    assert.deepStrictEqual(dialectIssues(tree, 'ash', 'en'), []);
    assert.strictEqual(dialectIssues(tree, 'dash', 'en').length, 1);
  });
});

describe('other quick fixes', () => {
  const cases: [string, string][] = [
    ['[ "$a" == x ]', '[ "$a" = x ]'],
    ['source ./lib.sh', '. ./lib.sh'],
    ['function f { echo hi; }', 'f() { echo hi; }'],
    ['function g() { :; }', 'g() { :; }'],
    ['make &> build.log', 'make > build.log 2>&1'],
    ['make &>> build.log', 'make >> build.log 2>&1'],
    ['make |& tee log', 'make 2>&1 | tee log'],
  ];
  for (const [src, expected] of cases) {
    it(src, () => {
      assert.strictEqual(fixed(src), expected);
      // The rewrite parses in dash.
      execFileSync('dash', ['-n', '-c', expected]);
    });
  }
});
