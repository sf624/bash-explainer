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
    // (An alias named with a character the walk does not take: bash expands it, `g,h` runs `f`; its text is read alone.)
    assert.strictEqual(bash(`${body}; f() { echo F; }; shopt -s expand_aliases; alias 'g,h=f'\ng,h`), 'F\n');
    assert.strictEqual(decided(`${body}; shopt -s expand_aliases; alias 'g,h=f'`), undefined);
  });

  it("reads the aliases the walk expands from the walk's own trees: the alias's text with the rest of the command", function () {
    this.timeout(60000);
    // (The key of an associative array is not arithmetic, also in an alias's text: `k` is not read. Before, that tree
    // was read on its own, without `declare -A m`, and nothing was trusted.)
    const src = "declare -A m; shopt -s expand_aliases; alias put='m[k]=1'\nput";
    assert.strictEqual(bash(`k='x=5'; x=1; ${src}\necho "\${!m[@]} $x"`), 'k 1\n');
    assert.strictEqual(decided(`${src}\nx=1; [ "$x" = 1 ] && :`), 'true');
    // (Each alias whose text names another doubles the trees to read: past a bound, nothing is trusted.)
    const many = ['shopt -s expand_aliases', ...Array.from({ length: 11 }, (_, i) => `alias a${i}='a${i + 1}; a${i + 1}'`), 'a0', 'x=1; [ "$x" = 1 ] && :'].join('\n');
    assert.strictEqual(shellState(parser.parse(many)).blind, 'too many aliases expanded in aliases');
    // (The bound is per command of the script: many plain uses of aliases, even of one that names another, are read.
    // Before, every use counted, and such a script trusted nothing.)
    const defs = "alias ls='ls -F'; alias ll='ls -l'";
    const uses = (on: boolean, lines: string[]): string => [...(on ? ['shopt -s expand_aliases'] : []), defs, ...lines, 'x=1; [ "$x" = 1 ] && :'].join('\n');
    assert.strictEqual(bash(`x=1; ${uses(true, Array(3).fill('ll / >/dev/null'))}\necho $x`), '1\n');
    for (const on of [false, true]) {
      assert.strictEqual(decided(uses(on, Array(1200).fill('ll /'))), 'true', `1,200 uses, expand_aliases ${on}`);
      const forty = Array.from({ length: 40 }, (_, i) => `alias a${i}='echo ${i}'`);
      assert.strictEqual(decided(uses(on, [...forty, ...Array.from({ length: 1200 }, (_, i) => `a${i % 40}`)])), 'true', `40 aliases, 30 uses each, expand_aliases ${on}`);
    }
    // (Nor do the trees of all the commands together grow without bound: 500 commands of a chain that doubles 9 times
    // ask for 255,500. Before, V8 ran out of memory after about 20 s.)
    const chain = ['shopt -s expand_aliases', ...Array.from({ length: 9 }, (_, i) => `alias a${i}='a${i + 1}; a${i + 1}'`), 'alias a9=echo', ...Array(500).fill('a0'), 'x=1; [ "$x" = 1 ] && :'].join('\n');
    const heap = process.memoryUsage().heapUsed;
    const t = Date.now();
    const tree = parser.parse(chain);
    const model = shellState(tree);
    assert.strictEqual(model.blind, 'too many aliases expanded');
    assert.strictEqual(model.condition(descendants(tree.root, ['list']).pop()!), undefined);
    assert.ok(Date.now() - t < 20000, `took ${Date.now() - t} ms`);
    assert.ok(process.memoryUsage().heapUsed - heap < 1e9, `${process.memoryUsage().heapUsed - heap} bytes`);
  });
  it("reads bash's own variables from the catalog (src/semantics/vars.ts), as bash treats them", () => {
    // Arithmetic that reads a variable whose value is always a number runs no code: decisions stay.
    for (const src of ['shift $((OPTIND-1))', 'while getopts ab o; do :; done; shift $((OPTIND-1))', '(( EUID == 0 ))', ': $((UID + PPID + RANDOM))']) {
      assert.strictEqual(bash(`x=1; ${src}; echo $x`).trim(), '1');
      assert.strictEqual(decided(`x=1; ${src}; [ "$x" = 1 ] && :`), 'true', src);
    }
    // A variable that bash sets only at start keeps what the script assigns; a readonly one keeps bash's value.
    assert.strictEqual(bash('SHLVL=3; BASH_ARGV0=a; echo $SHLVL $BASH_ARGV0'), '3 a\n');
    assert.strictEqual(decided('SHLVL=3; [ "$SHLVL" = 3 ] && :'), 'true');
    assert.strictEqual(decided('BASH_ARGV0=a; [ "$BASH_ARGV0" = a ] && :'), 'true');
    // (The failed assignment discards the rest of its line.)
    assert.strictEqual(bash('exec 2>/dev/null\nUID=5\n[ "$UID" = 5 ] && echo yes || echo no'), 'no\n');
    assert.strictEqual(decided('UID=5\n[ "$UID" = 5 ] && :'), undefined);
    // Some of bash's integers read the text assigned to them as arithmetic, which may set a variable.
    for (const src of ['OPTIND="x=5"', 'RANDOM="x=5"', 'y="x=5"; SRANDOM=$y']) {
      assert.strictEqual(bash(`x=1; ${src}; echo $x`).trim(), '5', src);
      assert.strictEqual(decided(`x=1; ${src}; [ "$x" = 1 ] && :`), undefined, src);
    }
    // An unset gives them no text: nothing is run (text not known still is: `OPTIND=$y`).
    for (const src of ['unset OPTIND', 'unset RANDOM', 'declare -i n; unset n']) {
      assert.strictEqual(bash(`x=1; ${src}; echo $x`).trim(), '1', src);
      assert.strictEqual(decided(`x=1; ${src}; [ "$x" = 1 ] && :`), 'true', src);
    }
    assert.strictEqual(decided('x=1; OPTIND="$y"; [ "$x" = 1 ] && :'), undefined);
  });
});
