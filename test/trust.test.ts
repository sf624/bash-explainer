// What the decisions of the state model trust (src/semantics/trust.ts): the scan reads the syntax tree, and the trees
// of the strings the walk runs, not their text again. Each case is compared with bash.
import * as assert from 'assert';
import { execFileSync } from 'child_process';
import { shellState } from '../src/semantics/state';
import { createUnbashParser } from '../src/syntax/adapters/unbash';
import { descendants } from '../src/syntax/tree';

const parser = createUnbashParser();
const bash = (code: string): string => execFileSync('bash', ['-c', code], { env: { PATH: '/usr/bin:/bin', LC_ALL: 'C' } }).toString();

/** What the model decides of the last `&&` list of `src` (undefined: nothing). */
function decided(src: string): string | undefined {
  const tree = parser.parse(src);
  return shellState(tree).condition(descendants(tree.root, ['list']).pop()!)?.outcome;
}

describe('the trust of the decisions (src/semantics/trust.ts)', () => {
  it('reads an indirection from the tree: one whose subscript may assign a variable trusts nothing', () => {
    // Each name the expansion may take is `a[n=7]`: an indirection runs the subscript, which sets `n`.
    const setup = "n=1; v='a[n=7]'; a=('a[n=7]'); set -- 'a[n=7]'";
    for (const e of ['${!v}', '${!1}', '${!@}', '${!*}', '${!v@Q}', '${!v:-x}', '${!a[@]:-x}', '${!a[*]@Q}', '${!a[0]}', '${!a}',
      // Not an indirection: the keys, the names with a prefix, a special parameter whose value is a number or letters.
      '${!a[@]}', '${!a[*]}', '${!v@}', '${!v*}', '${!#}', '${!-}', '${!?}', '${!}', '${!:-x}']) {
      const src = `${setup}; : "${e}"`;
      const set = bash(`${src} 2>/dev/null; echo "$n"`).trim() === '7';
      assert.strictEqual(decided(`${src}; [ "$n" = 1 ] && :`), set ? undefined : 'true', `${e}: bash ${set ? 'sets' : 'leaves'} n`);
    }
  });

  it("reads the strings the walk runs from the walk's own trees, with what the script declares", () => {
    // (The key of an associative array is not arithmetic: `k` is not read. Before, the string was read on its own.)
    for (const [src, key] of [["declare -A m; eval 'm[k]=1'", 'k'], ["declare -A m; eval 'm[$k]=1'", 'x=5']]) {
      assert.strictEqual(bash(`k='x=5'; x=1; ${src}; echo "\${!m[@]} $x"`), `${key} 1\n`);
      assert.strictEqual(decided(`${src}; x=1; [ "$x" = 1 ] && :`), 'true', src);
    }
    // (A subscript of an array that is not associative is arithmetic: `k`, never set, may come from the environment.)
    assert.strictEqual(bash("k='x=5'; x=1; eval 'm[k]=1'; echo $x").trim(), '5');
    assert.strictEqual(decided("eval 'm[k]=1'; x=1; [ \"$x\" = 1 ] && :"), undefined);
  });

  it("calls a function in an eval's string where the walk runs it; not in a trap's action or an alias", () => {
    const body = 'x=0; f() { [ "$x" = 0 ] && :; }';
    assert.strictEqual(bash(`${body}; f() { [ "$x" = 0 ] && echo yes; }; eval f`).trim(), 'yes');
    assert.strictEqual(decided(`${body}; eval f`), 'true');
    assert.strictEqual(decided(`${body}; eval 'eval f'`), 'true');
    for (const more of ['trap f INT', "eval 'trap f INT'", "trap 'eval f' INT", "shopt -s expand_aliases; alias g='f'"]) assert.strictEqual(decided(`${body}; ${more}`), undefined, more);
  });
});
