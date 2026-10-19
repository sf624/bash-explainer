import * as assert from 'assert';
import { execFileSync } from 'child_process';
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
    ['[[ $n -gt 3 || -z "$m" ]]', '[ "$n" -gt 3 ] || [ -z "$m" ]'],
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
        const set = `a=${JSON.stringify(a)} b=${JSON.stringify(b)} f=${JSON.stringify(b)} d=${JSON.stringify(b)} x=${JSON.stringify(a)} n=${JSON.stringify(n)} m=${JSON.stringify(m)};`;
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
