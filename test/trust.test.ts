// What the decisions of the state model trust (src/semantics/trust.ts): the scan reads the syntax tree, and the trees
// of the strings the walk runs, not their text again. Each case is compared with bash.
import * as assert from 'assert';
import { execFileSync, spawnSync } from 'child_process';
import { shellState } from '../src/semantics/state';
import { createUnbashParser } from '../src/syntax/adapters/unbash';
import { descendants } from '../src/syntax/tree';
import { assertGrowth } from './support/growth';

const parser = createUnbashParser();
const bash = (code: string): string => execFileSync('bash', ['-c', code], { env: { PATH: '/usr/bin:/bin', LC_ALL: 'C' } }).toString();
/** The last line `code` prints, run with `n='u=2'` in the environment. */
const inherited = (code: string): string => spawnSync('bash', ['-c', code], { env: { PATH: '/usr/bin:/bin', LC_ALL: 'C', n: 'u=2' }, encoding: 'utf8' }).stdout.trim().split('\n').pop()!;
const bashErr = (code: string): string => spawnSync('bash', ['-c', code], { env: { PATH: '/usr/bin:/bin', LC_ALL: 'C' }, encoding: 'utf8' }).stderr;

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
    // (An alias named with a comma: bash expands it, `g,h` runs `f`.)
    assert.strictEqual(bash(`${body}; f() { echo F; }; shopt -s expand_aliases; alias 'g,h=f'\ng,h`), 'F\n');
    assert.strictEqual(decided(`${body}; shopt -s expand_aliases; alias 'g,h=f'`), undefined);
    // (A name with a `/` is invalid: bash defines nothing, so nothing runs `f`.)
    assert.match(bashErr(`shopt -s expand_aliases; alias 'g/h=f'`), /invalid alias name/);
    assert.strictEqual(decided(`${body}; shopt -s expand_aliases; alias 'g/h=f'; eval f`), 'true');
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
    // (Nor do the trees of all the commands together grow without bound: 100 commands of a chain that doubles 8 times
    // ask for 51,100. Before, 500 such commands of 9 made V8 run out of memory. Past the bound the walk still runs what
    // the aliases do, in trees shared by text, and nothing is trusted.)
    const commands = (n: number): string => ['shopt -s expand_aliases', ...Array.from({ length: 8 }, (_, i) => `alias a${i}='a${i + 1}; a${i + 1}'`), "alias a8='set -f; y=2'", 'y=1', ...Array(n).fill('a0'), 'x=1; [ "$x" = 1 ] && :'].join('\n');
    const chain = commands(100);
    assert.strictEqual(bash(`${chain}\necho "$y \${-//[^f]/}"`), '2 f\n');
    const heap = process.memoryUsage().heapUsed;
    const tree = parser.parse(chain);
    const model = shellState(tree);
    assert.strictEqual(model.blind, 'too many aliases expanded');
    assert.strictEqual(model.condition(descendants(tree.root, ['list']).pop()!), undefined);
    assert.deepStrictEqual([model.end.variables.get('y')?.value, model.end.set.get('noglob')], ['2', 'on']);
    assert.ok(process.memoryUsage().heapUsed - heap < 1e9, `${process.memoryUsage().heapUsed - heap} bytes`);
    // Ten times the commands, past the bound, take about ten times as long as 10 commands within it (not against a
    // fixed time, which a loaded runner may exceed).
    assertGrowth('10 commands, then 100', () => shellState(parser.parse(commands(10))), () => shellState(parser.parse(chain)), 30, 2);
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

  // docs/design/trust-per-position.md, section 2: what changed `u` where the scan saw no write. bash's environment
  // here gives `n='u=2'` (a variable the script declares without a value keeps it).
  it('trusts nothing where bash may run a subscript, a prompt, a word list or a history line, or an inherited value', () => {
    const changes: [string, string][] = [
      // A nameref whose target is not known, read: the target's subscript is arithmetic.
      ["set -- 'a[u=2]'; declare -n r=$1; : \"$r\"", 'reads a nameref'],
      // `-v` of a name not known: its subscript is arithmetic.
      ["set -- 'a[u=2]'; [ -v \"$1\" ]", '[ -v'], ["set -- 'a[u=2]'; test -v \"$1\"", 'test -v'], ["x='a[u=2]'; [[ -v $x ]]", '[[ -v'],
      // `@P` expands the value as a prompt: `$(( ))` in it runs, also from an octal escape.
      ["set -- '$((u=2))'; : \"${1@P}\"", '@P of $1'], ["x='$((u=2))'; : \"${x@P}\"", '@P'], ["x='\\044((u=2))'; : \"${x@P}\"", '@P of \\044'],
      ["PS4='+\\044((u=2)) '; set -x; :", 'PS4 with \\044'],
      // `compgen -W` expands its list; `-F` runs a function.
      ["compgen -W '$((u=2))' >/dev/null", 'compgen -W'], ['f() { u=2; }; compgen -F f x >/dev/null 2>&1', 'compgen -F'],
      // `fc -s` runs a line of the history again.
      ['set -o history\nu=2\nu=1\nfc -s 1=2 u >/dev/null 2>&1\n', 'fc'],
      // `declare n` outside a function keeps the value from the environment, which arithmetic runs; so does `+=` of an integer.
      ['declare n; (( n ))', 'declare n'], ['declare -i n; n+=1', 'declare -i n; n+='], ['f() { declare -g n; }; f; (( n ))', 'declare -g n'], ['declare -i n+=1', 'declare -i n+=1'],
    ];
    for (const [src, what] of changes) {
      assert.strictEqual(inherited(`u=1; ${src}\necho "$u"`), '2', what);
      assert.strictEqual(decided(`u=1; ${src}\n[ "$u" = 1 ] && :`), undefined, what);
    }
    // Their quiet forms change nothing: a static name, a quiet prompt, a word list of plain words, `fc -l`, a local.
    const quiet = ['a=(1); [ -v u ]; [[ -v a[0] ]]; test -v a[0]; test -v 1x', "x='a \\u $u'; : \"${x@P}\"", "compgen -W 'a b $u' -- a >/dev/null", 'fc -l >/dev/null 2>&1',
      'f() { declare n; local -i m; m+=1; (( n )); }; f', 'declare n=0; (( n ))', 'enable -n echo'];
    for (const src of quiet) {
      assert.strictEqual(inherited(`u=1; ${src}\necho "$u"`), '1', src);
      assert.strictEqual(decided(`u=1; ${src}\n[ "$u" = 1 ] && :`), 'true', src);
    }
    // (`enable` of a name not known may turn off any builtin.)
    assert.strictEqual(decided('u=1; enable -n "$b"; [ "$u" = 1 ] && :'), undefined);
    assert.strictEqual(decided('u=1; compgen -W "$w" -- a; [ "$u" = 1 ] && :'), undefined);
  });
});
