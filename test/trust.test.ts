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

  it('takes a command whose redirection may fail as one that may not run (docs/design/trust-allow-list.md, step 3)', () => {
    // bash runs no command after a redirection that fails: the group, the declaration, the function.
    const after = (src: string): string => bash(`${src} 2>/dev/null; if [ "$x" = 2 ]; then echo two; else echo other; fi`);
    for (const src of ['x=1; { x=2; } < ./nofile', 'x=1; declare x=2 < ./nofile', 'f() { x=2; }; x=1; f > ./no/such/dir', 'f() { x=2; } 2>&9; x=1; f', 'x=1; { x=2; } >&"$fd"', 'x=1; { x=2; } > >g']) {
      if (!src.includes('$fd') && !src.includes('>g')) assert.strictEqual(after(src), 'other\n', src);
      assert.strictEqual(decided(`${src}; [ "$x" = 2 ] && :`), undefined, src);
    }
    // A here-document, a here-string, /dev/null, a copy of fd 0, 1 or 2, closing a descriptor, and assignments alone.
    for (const src of ['x=1; { x=2; } <<< a', 'x=1; { x=2; } > /dev/null 2>&1', 'x=1; { x=2; } <&0 >&2 3>&-', 'x=1; x=2 < ./nofile', 'x=1; { x=2; } < <(echo a)']) {
      assert.strictEqual(after(src), 'two\n', src);
      assert.strictEqual(decided(`${src}; [ "$x" = 2 ] && :`), 'true', src);
    }
  });

  it('follows the patterns after `;;&` in the state the list before them leaves (step 3)', () => {
    // bash tests `"$x"` after `x=c`: `*)` runs.
    const src = 'x=b; case b in b) x=c ;;& "$x") y=1 ;; *) y=2 ;; esac';
    assert.strictEqual(bash(`${src}; echo $y`), '2\n');
    assert.strictEqual(shellState(parser.parse(src)).condition(descendants(parser.parse(src).root, ['case_statement'])[0]), undefined);
    // Static patterns after lists that change no option: decided as before.
    const fixed = 'case a in a) echo 1 ;;& b) echo 2 ;; *) echo 3 ;; esac';
    assert.strictEqual(bash(fixed), '1\n3\n');
    const tree = parser.parse(fixed);
    assert.strictEqual(shellState(tree).condition(descendants(tree.root, ['case_statement'])[0])?.outcome, '0,2');
    // (Not after a list that may turn on nocasematch.)
    const nocase = 'case a in a) shopt -s nocasematch ;;& A) echo 2 ;; esac';
    assert.strictEqual(bash(nocase), '2\n');
    assert.strictEqual(shellState(parser.parse(nocase)).condition(descendants(parser.parse(nocase).root, ['case_statement'])[0]), undefined);
    // (Nor after one that may do more than assign, by the rows of the allow-list: `jobs -x` runs `shopt` in this shell.)
    const jobs = 'case a in a) jobs -x shopt -s nocasematch ;;& A) echo 2 ;; esac';
    assert.strictEqual(bash(jobs), '2\n');
    for (const list of ['jobs -x shopt -s nocasematch', 'eval :', 'declare x=1', 'complete -F f c', 'IFS=:']) {
      const t = parser.parse(`f() { :; }; case a in a) ${list} ;;& A) echo 2 ;; esac`);
      assert.strictEqual(shellState(t).condition(descendants(t.root, ['case_statement'])[0]), undefined, list);
    }
    // (A pattern after `;;&` that assigns, `${p:=b}`, is expanded after the list before it.)
    const assigns = 'case b in b) p= ;;& ${p:=b}) y=1 ;; esac';
    assert.strictEqual(bash(`${assigns}; echo "$p $y"`), 'b 1\n');
    assert.strictEqual(shellState(parser.parse(assigns)).condition(descendants(parser.parse(assigns).root, ['case_statement'])[0]), undefined);
  });

  it('takes a copy of a nameref whose target is not known as a value the script may not have written (step 3)', () => {
    assert.strictEqual(shellState(parser.parse('v=a; declare -n r="$v"; y=$r')).blind, 'a nameref whose target is not known is read');
  });

  it('takes arithmetic of lengths alone as one that cannot fail, so that what it assigns is set on every path (step 3)', () => {
    // (A value that may not be set, from an error that ends the line, may be the environment's: arithmetic of it trusts nothing.)
    const blind = (e: string): string | undefined => shellState(parser.parse(`a=(1 2); n=3; y=${e}\n(( y ))`)).blind;
    assert.strictEqual(blind('$(( ${#a[@]} * 2 ))'), undefined);
    for (const e of ['$(( ${#a[@]} / 2 ))', '$(( ${#a[@]} * n ))', '$(( RANDOM * 2 ))']) assert.strictEqual(blind(e), 'arithmetic reads `y`, which the script may not have set', e);
    assert.strictEqual(bash('a=(1 2); y=$(( ${#a[@]} * 2 )); echo $y'), '4\n');
  });

  it('follows copies of IFS, `save=$IFS; IFS=:; …; IFS=$save`, when the copy is set where IFS takes it (step 3)', () => {
    const copy = 's=$IFS; IFS=:; x=a; IFS=$s';
    assert.strictEqual(bash(`u=1; ${copy}; [ $x = a ] && echo $u`), '1\n');
    assert.strictEqual(decided(`u=1; ${copy}; [ $x = a ]; [ "$u" = 1 ] && :`), 'true');
    // (A copy of a variable set on some paths only, or later, may be a value of the environment.)
    for (const src of ['f() { s=$IFS; }; [ "$z" ] && f; IFS=$s', 'IFS=$s; s=:', 'IFS=$s', 's=:; IFS="$s$s"']) assert.strictEqual(decided(`u=1; ${src}; x=a; [ $x = a ]; [ "$u" = 1 ] && :`), undefined, src);
    // (bash ignores an IFS in the environment.)
    assert.strictEqual(spawnSync('bash', ['-c', 'printf %q "$IFS"'], { env: { PATH: '/usr/bin:/bin', IFS: '9' }, encoding: 'utf8' }).stdout, "$' \\t\\n'");
  });

  it('splits the words of `test` by each IFS the script may set, also one copied through `for`, an array or `$(( ))`', () => {
    // Each of these makes IFS `0` or `:` where `$x` splits into `-v` and its subscript runs (the review of step 3).
    for (const src of ["s=$IFS; s=( 0 ); IFS=$s; x='-v0'; [ $x 'a[u=2]' ]", "for s in 0; do :; done; IFS=$s; x='-v0'; [ $x 'a[u=2]' ]",
      "s=$((0)); IFS=$s; x='-v0'; [ $x 'a[u=2]' ]", "IFS=$((0)); x='-v0'; [ $x 'a[u=2]' ]", "for IFS in 0; do :; done; x='-v0'; [ $x 'a[u=2]' ]",
      // (Split by both `v` and `:`, `-v:` gives no `-v`; by `:` alone, it does.)
      "IFS=v; IFS=:; x='-v:'; test $x 'a[u=2]'",
      // (`+=` adds to a value: `x` is `-v`.)
      "x=-; x+=v; [ $x 'a[u=2]' ]"]) {
      assert.strictEqual(bash(`u=1; ${src}; echo $u`), '2\n', src);
      assert.strictEqual(decided(`u=1; ${src}; [ "$u" = 1 ] && :`), undefined, src);
    }
    // A variable a word of `[` splits must be set there on every path: else it may be `-v` from the environment.
    for (const src of ["[ -n \"$1\" ] && x=a; [ $x 'a[u=2]' ]", "f() { x=a; }; [ $x 'a[u=2]' ] 2>/dev/null; f", "x+=a; [ $x 'a[u=2]' ] 2>/dev/null"]) {
      const out = spawnSync('bash', ['-c', `u=1; ${src}; echo $u`], { env: { PATH: '/usr/bin:/bin', LC_ALL: 'C', x: '-v' }, encoding: 'utf8' }).stdout;
      assert.strictEqual(out, src.startsWith('x+=') ? '1\n' : '2\n', src);
      assert.strictEqual(decided(`u=1; ${src}; [ "$u" = 1 ] && :`), undefined, src);
    }
    // (`+=` of text with no `-` gives no `-v`: decided, where the variable is set before.)
    assert.strictEqual(decided("u=1; x=a; x+=b; [ $x = ab ]; [ \"$u\" = 1 ] && :"), 'true');
    assert.strictEqual(decided("u=1; x=a; x+=b; unset x; x=ab; [ $x = ab ]; [ \"$u\" = 1 ] && :"), 'true');
    // IFS saved and restored, unset first: decided as before.
    const restore = 'unset IFS; save=$IFS; IFS=:; IFS=$save; x=yes';
    assert.strictEqual(bash(`u=1; ${restore}; [ $x = yes ] && echo $u`), '1\n');
    assert.strictEqual(decided(`u=1; ${restore}; [ $x = yes ]; [ "$u" = 1 ] && :`), 'true');
  });

  it('takes a copy of fd 0, 1 or 2 as a redirection that may fail where the script may close them (the review of step 3)', () => {
    // bash: "Bad file descriptor", and the group does not run. (Output goes to fd 3 or 2 where 1 is closed.)
    const after = (src: string): string => spawnSync('bash', ['-c', `exec 3>&1; x=1; ${src}; echo "$x" >&3`], { env: { PATH: '/usr/bin:/bin', LC_ALL: 'C' }, encoding: 'utf8' }).stdout;
    for (const src of ['exec 1>&-; { x=2; } 2>&1', 'exec 2>&-; { x=2; } >&2', 'exec 0<&-; { x=2; } 1<&0', 'exec <&-; { x=2; } 1<&0', 'v=1; exec {v}>&-; { x=2; } 2>&1', 'exec 4>&1 1>&-; { x=2; } 2>&1', '{ x=2; } >&- 2>&1',
      'f() { { x=2; } 2>&1; }; f >&-', 'BASH_XTRACEFD=1; unset BASH_XTRACEFD; { x=2; } 2>&1', 'BASH_XTRACEFD=1; BASH_XTRACEFD=; { x=2; } 2>&1', 'exec 1>&2-; { x=2; } >&2', 'exec 4>&1-; { x=2; } 2>&1']) {
      assert.strictEqual(after(src), '1\n', src);
      assert.strictEqual(decided(`x=1; ${src}; [ "$x" = 2 ] && :`), undefined, src);
    }
    // (Closing another descriptor leaves them open.)
    assert.strictEqual(after('exec 4>&-; { x=2; } 2>&1'), '2\n');
    assert.strictEqual(decided('x=1; exec 4>&-; { x=2; } 2>&1; [ "$x" = 2 ] && :'), 'true');
  });

  it('takes a redirection that fails under `set -e` as the end of the shell, where `set -e` is not ignored (the review of step 3)', () => {
    const run = (src: string): string => spawnSync('bash', ['-c', `cd "$(mktemp -d)" || exit; x=1; ${src}; echo "$x"`], { env: { PATH: '/usr/bin:/bin', LC_ALL: 'C' }, encoding: 'utf8' }).stdout;
    // The code after it runs only when the command ran: `x` is 2 there.
    for (const src of ['set -e; { x=2; } > out.txt', 'set -e; f() { x=2; }; f > out.txt', 'set -e; true && { x=2; } > out.txt', 'set -e; { x=2; } > ./no/such/dir']) {
      assert.strictEqual(run(src), src.includes('no/such') ? '' : '2\n', src);
      assert.strictEqual(decided(`x=1; ${src}; [ "$x" = 2 ] && :`), 'true', src);
    }
    // Where `set -e` is ignored (a condition, the left of `||`, `!`, a function called there), or off (`$( )`), it may not run.
    for (const src of ['set -e; if { x=2; } > ./no/such/dir; then :; fi', 'set -e; { x=2; } > ./no/such/dir || :', 'set -e; ! { x=2; } > ./no/such/dir',
      'set -e; g() { { x=2; } > ./no/such/dir; }; g || :', 'set -e; set +e; { x=2; } > ./no/such/dir']) {
      assert.strictEqual(run(`${src} 2>/dev/null`), '1\n', src);
      assert.strictEqual(decided(`x=1; ${src}; [ "$x" = 2 ] && :`), undefined, src);
    }
  });

  it('takes an array with an element the script may not have written, or a tilde, as a value arithmetic may run (the review of step 3)', () => {
    // With `q='y=5'` and `HOME='y=5'` in the environment, each sets `y`.
    const env = (code: string): string => spawnSync('bash', ['-c', code], { env: { PATH: '/usr/bin:/bin', LC_ALL: 'C', q: 'y=5', HOME: 'y=5' }, encoding: 'utf8' }).stdout.trim();
    for (const src of ['a=(0); a[0]=$q; q=0; (( a[0] ))', 'a=("$q"); q=0; (( a[0] ))', 'a=(); a+=("$q"); q=0; (( a[0] ))', 'a=(0); a[0]=$q; q=0; (( a ))',
      'declare -a a=([0]="$q"); q=0; (( a[0] ))', 'm=~; (( m ))', 'declare m=~; (( m ))', 'export m=~; (( m ))', 'm=~; : ${a[m]}', 'm=(~); (( m ))']) {
      assert.strictEqual(env(`y=1; ${src}; echo $y`), '5', src);
      assert.strictEqual(decided(`y=1; ${src}; [ "$y" = 1 ] && :`), undefined, src);
    }
    // (`~user` is a home the model does not know: bash reads it from the system's user database.)
    assert.strictEqual(decided('y=1; m=~nobody; (( m )) 2>/dev/null; [ "$y" = 1 ] && :'), undefined);
    // (A HOME the script sets is followed.)
    assert.strictEqual(decided('y=1; HOME=0; m=~; (( m )); [ "$y" = 1 ] && :'), 'true');
  });

  it('takes a function defined after `shopt -so allexport` as exported, as after `set -a`', () => {
    // (bash exports it: another bash sees it. Before the allow-list, the scan read `set -a` but not `shopt -so`.)
    assert.strictEqual(bash("shopt -so allexport; f() { :; }; bash -c 'declare -F f'"), 'f\n');
    const body = 'x=0; f() { [ "$x" = 0 ] && :; }; f';
    assert.strictEqual(decided(body), 'true');
    for (const on of ['set -a', 'shopt -so allexport', 'shopt -s -o "$o"']) assert.strictEqual(decided(`${on}; ${body}`), undefined, on);
    for (const off of ['shopt -so errexit', 'shopt -uo allexport', 'shopt -s extglob']) assert.strictEqual(decided(`${off}; ${body}`), 'true', off);
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
  it('trusts nothing after `ulimit -n` or `-u`, which may make a redirection or `$( )` fail', () => {
    // (`> /dev/null` fails with "Too many open files", and so does the pipe of `$( )`.)
    for (const src of ['ulimit -n 3; { u=2; } > /dev/null', 'ulimit -Sn 3; v=$(echo 2); u=${v:-1}']) {
      assert.strictEqual(inherited(`u=1; ${src} 2>/dev/null\necho "$u"`), '1', src);
      assert.strictEqual(decided(`u=1; ${src}\n[ "$u" = 2 ] && :`), undefined, src);
    }
    // (Other limits change nothing the model reads.)
    assert.strictEqual(decided('u=1; ulimit -c 0; ulimit -f; { u=2; } > /dev/null\n[ "$u" = 2 ] && :'), 'true');
  });

  it('trusts nothing where bash may run a subscript, a prompt, a word list or a history line, or an inherited value', () => {
    const changes: [string, string][] = [
      // A nameref whose target is not known, read: the target's subscript is arithmetic.
      ["set -- 'a[u=2]'; declare -n r=$1; : \"$r\"", 'reads a nameref'],
      // `-v` of a name not known: its subscript is arithmetic.
      ["set -- 'a[u=2]'; [ -v \"$1\" ]", '[ -v'], ["set -- 'a[u=2]'; test -v \"$1\"", 'test -v'], ["x='a[u=2]'; [[ -v $x ]]", '[[ -v'],
      // A word not known of `test` or `[` may be `-v` itself, and one that splits gives words not known.
      ["set -- -v 'a[u=2]'; [ \"$1\" \"$2\" ]", '[ $1 $2'], ["set -- -v 'a[u=2]'; [ ! \"$1\" \"$2\" ]", '[ ! $1 $2'], ["set -- -v 'a[u=2]'; test \"$@\"", 'test "$@"'],
      ["set -- '-v a[u=2]'; x=$1; [ $x ]", '[ $x'], ["x='-v a[u=2]'; [ $x ]", '[ $x of a known -v'], ["set -- 'x -a -v a[u=2]'; [ -z $1 ] 2>/dev/null", '[ -z $1'],
      // A nameref that refers to one whose target is not known, read or assigned, declared in either order.
      ["set -- 'a[u=2]'; declare -n q=$1; declare -n p=q; : \"$p\"", 'reads a nameref of a nameref'],
      ["set -- 'a[u=2]'; declare -n p=q; declare -n q=$1; : \"$p\"", 'the same, declared the other way'],
      ["set -- 'a[u=2]'; declare -n q=$1; declare -n p=q; p=x", 'assigns a nameref of a nameref'],
      // `@P` expands the value as a prompt: `$(( ))` in it runs, also from an octal escape.
      ["set -- '$((u=2))'; : \"${1@P}\"", '@P of $1'], ["x='$((u=2))'; : \"${x@P}\"", '@P'], ["x='\\044((u=2))'; : \"${x@P}\"", '@P of \\044'],
      ["PS4='+\\044((u=2)) '; set -x; :", 'PS4 with \\044'],
      // `compgen -W` expands its list; `-F` runs a function.
      ["compgen -W '$((u=2))' >/dev/null", 'compgen -W'], ['f() { u=2; }; compgen -F f x >/dev/null 2>&1', 'compgen -F'],
      // `fc -s` runs a line of the history again.
      ['set -o history\nu=2\nu=1\nfc -s 1=2 u >/dev/null 2>&1\n', 'fc'],
      // `declare n` outside a function keeps the value from the environment, which arithmetic runs; so does `+=` of an integer.
      ['declare n; (( n ))', 'declare n'], ['declare -i n; n+=1', 'declare -i n; n+='], ['f() { declare -g n; }; f; (( n ))', 'declare -g n'], ['declare -i n+=1', 'declare -i n+=1'],
      // `declare -I` and `local -I` in a function keep the value from outside, also one from the environment.
      ['f() { declare -I n; (( n )); }; f', 'declare -I n'], ['f() { local -I n; (( n )); }; f', 'local -I n'],
      // `mapfile -C` (and `readarray -C`) runs its text in this shell; `jobs -x` its command.
      ["mapfile -C 'u=2; :' -c 1 arr <<< q", 'mapfile -C'], ["readarray -C 'u=2; :' -c 1 arr <<< q", 'readarray -C'], ['f() { u=2; }; mapfile -C f -c 1 arr <<< q', 'mapfile -C f'],
      ['jobs -x eval u=2', 'jobs -x'],
      // The walk: arithmetic reads a value the script may not have written there, on some path or through a copy
      // (docs/design/trust-allow-list.md, section 2, "Arithmetic").
      ['[ -n "$z" ] && n=0; (( n ))', 'n set on some paths'], ['n="$n"; (( n ))', 'n="$n"'], [': "${n:=0}"; (( n ))', '${n:=0}'],
      ["n+=''; (( n ))", 'n+='], ['a="$n"; n=0; (( a ))', 'a="$n"; n=0'], ['export n; (( n ))', 'export n'],
    ];
    for (const [src, what] of changes) {
      assert.strictEqual(inherited(`u=1; ${src}\necho "$u"`), '2', what);
      assert.strictEqual(decided(`u=1; ${src}\n[ "$u" = 1 ] && :`), undefined, what);
    }
    // Their quiet forms change nothing: a static name, a quiet prompt, a word list of plain words, `fc -l`, a local.
    const quiet = ['a=(1); [ -v u ]; [[ -v a[0] ]]; test -v a[0]; test -v 1x', "x='a \\u $u'; : \"${x@P}\"", "compgen -W 'a b $u' -- a >/dev/null", 'fc -l >/dev/null 2>&1',
      // (`compgen -G`, `-X`, `-P` and `-S` take their words as text.)
      "compgen -G '$((u=2))' -X '$((u=2))' -P '$((u=2))' -S '$((u=2))' -W 'a b' -- a >/dev/null",
      'f() { declare n; local -i m; m+=1; (( n )); }; f', 'declare n=0; (( n ))', 'enable -n echo',
      // (Words of `test` that are never `-v`, or are known: `[[ ]]` reads its operators before it expands.)
      "set -- a; x=abc; y='a b'; n=$((1+1)); [ \"$1\" = \"$u\" ]; [ $# -eq 1 ]; [ $x = abc ]; [ $y = a ] 2>/dev/null; [ $n -gt 1 ]; [ -n \"$1\" ]; [ x\"$1\" = xa ]; [ /*/ ] 2>/dev/null",
      'o=-v; [[ $o ]]; [[ -n $o ]]', 'IFS=; f() { local IFS; }; f; (( n = 3 )); g() { local m; [ $m ]; }; g; [ $n -gt 1 ]'];
    for (const src of quiet) {
      assert.strictEqual(inherited(`u=1; ${src}\necho "$u"`), '1', src);
      assert.strictEqual(decided(`u=1; ${src}\n[ "$u" = 1 ] && :`), 'true', src);
    }
    // `unset` of a nameref of a nameref whose target is not known may unset any variable (bash unsets `u`).
    assert.strictEqual(bash("u=1; set -- u; declare -n q=$1; declare -n p=q; unset p; echo \"${u-unset}\""), 'unset\n');
    assert.strictEqual(decided("u=1; set -- u; declare -n q=$1; declare -n p=q; unset p; [ \"$u\" = 1 ] && :"), undefined);
    // An unquoted number splits only where IFS has digits (`IFS=1`: `$#` of 10 is two words, the second `0`).
    assert.strictEqual(decided('u=1; IFS=1; [ $# -eq 0 ]; [ "$u" = 1 ] && :'), undefined);
    assert.strictEqual(decided('u=1; IFS=:; [ $# -eq 0 ]; [ "$u" = 1 ] && :'), 'true');
    // (A variable the script does not set, from the environment, may hold anything; so may an IFS not known.)
    assert.strictEqual(decided('u=1; [ -d $HOME ]; [ "$u" = 1 ] && :'), undefined);
    // (An IFS not known may split anything.)
    for (const ifs of ['IFS=$y', 'read -r IFS']) assert.strictEqual(decided(`u=1; ${ifs}; [ $# -eq 0 ]; [ "$u" = 1 ] && :`), undefined, ifs);
    // `enable -f` loads a builtin from a shared object: it may replace any builtin, and run code as it loads.
    assert.strictEqual(shellState(parser.parse('enable -f ./b.so b')).blind, '`enable -f` loads a builtin the model does not read');
    // (`enable` of a name not known may turn off any builtin.)
    assert.strictEqual(decided('u=1; enable -n "$b"; [ "$u" = 1 ] && :'), undefined);
    assert.strictEqual(decided('u=1; compgen -W "$w" -- a; [ "$u" = 1 ] && :'), undefined);
    // (`compgen -C` runs a command, and bash warns that `-C` and `-F` "may not work as you expect" outside completion.)
    assert.match(bashErr('compgen -C true x'), /-C option may not work as you expect/);
    assert.strictEqual(decided('u=1; compgen -C true x; [ "$u" = 1 ] && :'), undefined);
  });
});
