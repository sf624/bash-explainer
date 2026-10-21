// The shell state model (src/semantics/state.ts): what it says along small scripts. Its agreement with bash is
// checked on the rows of test/fixtures/probes/state.json by test/state-probes.test.ts.
import * as assert from 'assert';
import type { Shell } from '../src/dialect';
import { attribute, defaultOn, merge, option, readDeclaration, shellState, ShellState, StateModel } from '../src/semantics/state';
import { createUnbashParser } from '../src/syntax/adapters/unbash';
import { descendants } from '../src/syntax/tree';

const parser = createUnbashParser();
const model = (src: string, shell?: Shell, posix = false): StateModel => shellState(parser.parse(src), shell, { posix });
const end = (src: string, shell?: Shell): ShellState => model(src, shell).end;
/** The state before the first command of `src` whose text is `text` runs (`parse`: when bash read it). */
const before = (src: string, text: string, when: 'run' | 'parse' = 'run', shell?: Shell): ShellState => {
  const tree = parser.parse(src);
  return shellState(tree, shell).at(descendants(tree.root, ['command']).find((c) => c.text === text)!)[when];
};
const shopt = (st: ShellState, name: string) => option(st, 'shopt', name);
const set = (st: ShellState, name: string) => option(st, 'set', name);
const variable = (st: ShellState, name: string) => st.variables.get(name);

describe('shell state: options', () => {
  it('reads set and shopt with their specs', () => {
    const st = end('set -euo pipefail +B; set -o noclobber +o errexit; shopt -s nullglob dotglob; shopt -u dotglob; shopt -so xtrace; shopt -q extglob; shopt -s $x');
    assert.deepStrictEqual(['errexit', 'nounset', 'pipefail', 'braceexpand', 'noclobber', 'xtrace'].map((o) => set(st, o)), ['off', 'on', 'on', 'off', 'on', 'on']);
    assert.deepStrictEqual(['nullglob', 'dotglob', 'extglob'].map((o) => shopt(st, o)), ['on', 'off', 'default']);
    // `set -o` alone prints the options; `set -- -f` sets the positional parameters.
    assert.strictEqual(set(end('set -o; set -- -f'), 'noglob'), 'default');
  });
  it('counts from where they run, not from where they are written', () => {
    const src = 'ls\nshopt -s globstar\nls -a\nshopt -u globstar\nls -l';
    assert.deepStrictEqual(['ls', 'ls -a', 'ls -l'].map((c) => shopt(before(src, c), 'globstar')), ['default', 'on', 'off']);
    assert.strictEqual(shopt(before('shopt -s globstar; ls', 'ls'), 'globstar'), 'on');
    assert.strictEqual(shopt(before('# shopt -s globstar\nls', 'ls'), 'globstar'), 'default');
  });
  it('gives the state when the unit was read: aliases and extglob count from the next line', () => {
    const src = 'shopt -s extglob; ls\nls -a\nif true; then\n  shopt -s nullglob\n  ls -l\nfi';
    assert.strictEqual(shopt(before(src, 'ls', 'parse'), 'extglob'), 'default');
    assert.strictEqual(shopt(before(src, 'ls', 'run'), 'extglob'), 'on');
    assert.strictEqual(shopt(before(src, 'ls -a', 'parse'), 'extglob'), 'on');
    assert.strictEqual(shopt(before(src, 'ls -l', 'parse'), 'nullglob'), 'default');
    assert.strictEqual(shopt(before(src, 'ls -l', 'run'), 'nullglob'), 'on');
  });
  it('POSIX mode: set -o posix, bash --posix, and the shells that start in it', () => {
    const on = end('set -o posix');
    assert.deepStrictEqual([set(on, 'posix'), shopt(on, 'expand_aliases'), variable(on, 'POSIXLY_CORRECT')?.value], ['on', 'on', 'y']);
    const off = end('set -o posix; set +o posix');
    assert.deepStrictEqual([set(off, 'posix'), shopt(off, 'expand_aliases'), shopt(off, 'inherit_errexit'), variable(off, 'POSIXLY_CORRECT')?.set], ['off', 'off', 'on', 'off']);
    assert.strictEqual(shopt(model('', 'bash', true).end, 'expand_aliases'), 'on');
    assert.strictEqual(set(end('', 'dash'), 'posix'), 'on');
    // Other shells have no shopt.
    assert.strictEqual(shopt(end('set -o posix', 'dash'), 'expand_aliases'), 'default');
    assert.strictEqual(shopt(end('shopt -s nullglob; mapfile -t a', 'zsh'), 'nullglob'), 'default');
    assert.strictEqual(end('mapfile -t a', 'zsh').variables.size, 0);
  });
  it('set -G is globstar in ksh only', () => {
    assert.strictEqual(set(end('set -G', 'ksh'), 'globstar'), 'on');
    assert.strictEqual(set(end('set +o globstar', 'ksh'), 'globstar'), 'off');
    assert.strictEqual(set(end('set -G'), 'globstar'), 'default');
  });
  it('knows bash\'s defaults', () => {
    assert.deepStrictEqual([defaultOn('shopt', 'globskipdots'), defaultOn('shopt', 'nullglob'), defaultOn('shopt', 'expand_aliases', true), defaultOn('set', 'hashall')], [true, false, true, true]);
  });
});

describe('shell state: paths', () => {
  it('merges the branches of if, case, && and ||', () => {
    assert.strictEqual(shopt(end('if a; then shopt -s nullglob; fi'), 'nullglob'), 'unknown');
    assert.strictEqual(shopt(end('if a; then shopt -s nullglob; elif b; then shopt -s nullglob; else shopt -s nullglob; fi'), 'nullglob'), 'on');
    assert.strictEqual(shopt(end('if a; then shopt -s nullglob; elif b; then shopt -s nullglob; fi'), 'nullglob'), 'unknown');
    // A branch that sets an option to its default, and one that leaves it alone: the default.
    assert.strictEqual(shopt(end('if a; then shopt -u nullglob; fi'), 'nullglob'), 'default');
    assert.strictEqual(shopt(end('if a; then shopt -u nullglob; else shopt -s nullglob; fi'), 'nullglob'), 'unknown');
    assert.strictEqual(shopt(end('if a; then shopt -s globskipdots; fi'), 'globskipdots'), 'default');
    assert.strictEqual(set(end('a && set -f'), 'noglob'), 'unknown');
    assert.strictEqual(set(end('a || set -f; a || set -f'), 'noglob'), 'unknown');
    assert.strictEqual(set(end('case $x in a) set -f;; esac'), 'noglob'), 'unknown');
    assert.strictEqual(set(end('case $x in a) set -f;; *) set -f;; esac'), 'noglob'), 'on');
    // While typing: `a &&` has no right side yet.
    assert.strictEqual(set(end('set -f &&'), 'noglob'), 'on');
  });
  it('a loop may not run: what its body changes is unknown after it, and on its next pass', () => {
    assert.strictEqual(set(end('while a; do set -f; done'), 'noglob'), 'unknown');
    assert.strictEqual(set(end('until a; do :; done'), 'noglob'), 'default');
    assert.strictEqual(set(before('for f in a b; do echo; set -f; done', 'echo'), 'noglob'), 'unknown');
    assert.strictEqual(set(end('for ((i = 0; i < 3; i++)); do set -f; done'), 'noglob'), 'unknown');
    assert.strictEqual(variable(end('for ((i = 0; i < 3; i++)); do :; done'), 'i')?.set, 'on');
    assert.strictEqual(set(end('select s in a b; do set -f; done'), 'noglob'), 'unknown');
    // The variable of a for loop is its last word after it, when the words are known.
    assert.strictEqual(variable(end('for i in a b c; do :; done'), 'i')?.value, 'c');
    assert.strictEqual(variable(before('for i in a a; do echo; done', 'echo'), 'i')?.value, 'a');
    assert.strictEqual(variable(before('for i in a b; do echo; done', 'echo'), 'i')?.value, undefined);
    assert.strictEqual(variable(end('for i in $x; do :; done'), 'i')?.set, 'unknown');
    assert.strictEqual(variable(end('for i; do :; done'), 'i')?.set, 'unknown');
    // While typing.
    for (const src of ['while', 'for', 'for i in a', 'select', 'for ((;;))']) assert.ok(end(src));
  });
  it('a subshell keeps what it changes', () => {
    for (const src of ['( set -f )', 'x=$(set -f)', 'cat <(set -f)', '{ set -f; } &', 'set -f | cat', 'coproc { set -f; }', 'echo "$(set -f)" > "$(set -f)"', 'f() ( set -f ); f']) {
      assert.strictEqual(set(end(src), 'noglob'), 'default', src);
    }
    assert.strictEqual(set(before('x=$(set -f; echo)', 'echo'), 'noglob'), 'on');
    for (const src of ['! set -f', 'time set -f', '{ set -f; } > out', 'set -f 2>/dev/null']) assert.strictEqual(set(end(src), 'noglob'), 'on', src);
  });
  it('the last stage of a pipeline runs in the shell with lastpipe, unless job control is on; always in zsh and ksh', () => {
    assert.strictEqual(variable(end('shopt -s lastpipe; echo | read v'), 'v')?.set, 'on');
    assert.strictEqual(variable(end('shopt -s lastpipe; set -m; echo | read v'), 'v'), undefined);
    assert.strictEqual(variable(end('a && shopt -s lastpipe; echo | read v'), 'v')?.set, 'unknown');
    assert.strictEqual(variable(end('echo | read v', 'zsh'), 'v')?.set, 'on');
  });
});

describe('shell state: variables', () => {
  it('follows assignments, attributes and unset', () => {
    const st = end('a=1; a+=2; b+=x; c=$x; c+=1; d=(1 2); d[3]=4; e[1]=x; declare -A m; m[k]=v; m=(); declare -i n=2+3; n+=1; n=x; declare -l lo=AB; declare -u up=ab; i=; unset i; unset "d[1]"');
    assert.deepStrictEqual([variable(st, 'a')?.value, variable(st, 'b')?.value, variable(st, 'c')?.value, variable(st, 'n')?.value, variable(st, 'lo')?.value, variable(st, 'up')?.value], ['12', undefined, undefined, undefined, 'ab', 'AB']);
    assert.deepStrictEqual(['d', 'e', 'm'].map((v) => [attribute(st, v, 'a'), attribute(st, v, 'A')]), [['on', 'off'], ['on', 'off'], ['off', 'on']]);
    assert.deepStrictEqual([variable(st, 'i')?.set, variable(st, 'd')?.set], ['off', 'on']);
    assert.strictEqual(variable(end('declare -i n; n+=1'), 'n')?.value, undefined);
    assert.strictEqual(variable(end('declare -i n; n=3; n+=1'), 'n')?.value, '4');
    assert.strictEqual(variable(end('d=(1); d=x'), 'd')?.value, undefined);
  });
  it('reads the declaration builtins with their specs', () => {
    const st = end('export e=1 f; readonly r; declare -x +i g; typeset -r t; export -n f; declare -p e; declare -- "s=1" $x');
    assert.deepStrictEqual([attribute(st, 'e', 'x'), attribute(st, 'f', 'x'), attribute(st, 'g', 'x'), attribute(st, 'g', 'i'), attribute(st, 'r', 'r'), attribute(st, 't', 'r')], ['on', 'off', 'on', 'off', 'on', 'on']);
    assert.strictEqual(variable(st, 's'), undefined);
    assert.deepStrictEqual(readDeclaration(parser.parse('declare -ix +r a').root.namedChildren[0]).on, 'ix');
  });
  it('a nameref passes its assignments on', () => {
    assert.strictEqual(variable(end('declare -n r=t; r=5'), 't')?.value, '5');
    assert.strictEqual(variable(end('declare -n r=t; r=5'), 'r')?.value, 't');
    assert.strictEqual(variable(end('declare -n r=$1; r=5'), 'r')?.value, undefined);
    assert.strictEqual(variable(end('declare -n r; r=5'), 'r')?.value, undefined);
  });
  it('allexport exports what is assigned', () => {
    assert.strictEqual(attribute(end('set -a; x=1'), 'x', 'x'), 'on');
    assert.strictEqual(attribute(end('a && set -a; x=1'), 'x', 'x'), 'unknown');
    assert.strictEqual(attribute(end('export x; a && set -a; x=1'), 'x', 'x'), 'on');
  });
  it('read, mapfile, printf -v, getopts and ${x:=…} set variables', () => {
    const st = end('read -r a b; read -ra arr; mapfile -t; readarray lines; printf -v pv %s 1; printf x; getopts ab o; getopts; : ${d:=1} ${e=} ${f:-1} "$(: ${g:=1})"');
    assert.deepStrictEqual(['a', 'b', 'pv', 'o', 'OPTIND', 'OPTARG', 'd', 'e'].map((v) => variable(st, v)?.set), ['on', 'on', 'on', 'on', 'on', 'on', 'on', 'on']);
    assert.deepStrictEqual(['arr', 'MAPFILE', 'lines'].map((v) => attribute(st, v, 'a')), ['on', 'on', 'on']);
    assert.deepStrictEqual([variable(st, 'f'), variable(st, 'g')], [undefined, undefined]);
    assert.strictEqual(variable(end('x=${y:=1}'), 'y')?.set, 'on');
    assert.strictEqual(variable(end('[[ ${y:=1} ]]'), 'y')?.set, 'on');
  });
  it('a prefix assignment is for the command only, unless before a special builtin in POSIX mode', () => {
    assert.strictEqual(variable(end('x=1 :'), 'x'), undefined);
    assert.strictEqual(attribute(end('set -o posix; x=1 :'), 'x', 'x'), 'on');
    assert.strictEqual(variable(end('a && set -o posix; x=1 :'), 'x')?.set, 'unknown');
    assert.strictEqual(variable(end('x=1 :', 'sh'), 'x')?.set, 'on');
    assert.strictEqual(variable(end('x=1 >out'), 'x')?.set, 'on');
    assert.strictEqual(variable(end('x=1 $(:)'), 'x')?.set, 'on');
    assert.strictEqual(variable(end('x=1 $cmd'), 'x'), undefined);
  });
  it('merges the variables of the branches', () => {
    const st = end('if a; then x=1; y=1; declare -A m; else y=1; declare -a m; unset z; fi; if b; then w=1; fi; if c; then w=2; fi');
    assert.deepStrictEqual([variable(st, 'x')?.set, variable(st, 'y')?.value, attribute(st, 'm', 'A'), attribute(st, 'm', 'a'), variable(st, 'z')?.set, variable(st, 'w')?.set], ['unknown', '1', 'unknown', 'unknown', 'unknown', 'unknown']);
    assert.strictEqual(merge([st, st]), st);
    // Set, or given an attribute, in the else branch only; or later in the second branch.
    const other = end('x=1; if a; then :; else export x; y=1; fi; if b; then z=1; else z=2; fi');
    assert.deepStrictEqual([attribute(other, 'x', 'x'), variable(other, 'y')?.set, variable(other, 'z')?.at.text], ['unknown', 'unknown', 'z=2']);
    assert.strictEqual(attribute(end('x=1; if a; then export x; fi'), 'x', 'x'), 'unknown');
    assert.strictEqual(attribute(end('if a; then declare -x x; else declare +x x; fi'), 'x', 'x'), 'unknown');
    assert.strictEqual(attribute(end('if a; then export x; else export x; fi'), 'x', 'x'), 'on');
  });
});

describe('shell state: functions and aliases', () => {
  it('a function exists once its definition ran; its body runs with every function of the script', () => {
    const src = 'f\nf() { g; }\nf -x\ng() { :; }';
    const m = model(src);
    assert.strictEqual(before(src, 'f').functions.get('f'), undefined);
    assert.strictEqual(before(src, 'f -x').functions.get('f')?.state, 'on');
    assert.strictEqual(before(src, 'g').functions.get('g')?.state, 'unknown');
    assert.deepStrictEqual([...m.definitions.functions.keys()], ['f', 'g']);
  });
  it('a call applies what the body changes, but its locals', () => {
    const st = end('f() { set -f; x=1; local l=1; local l; declare d=1; declare -g dg=1; g() { :; }; alias a=b; }; f');
    assert.deepStrictEqual([set(st, 'noglob'), variable(st, 'x')?.set, variable(st, 'l'), variable(st, 'd'), variable(st, 'dg')?.set, st.functions.get('g')?.state, st.aliases.get('a')?.value], ['on', 'on', undefined, undefined, 'on', 'on', 'b']);
    assert.strictEqual(set(end('f() { set -f; }'), 'noglob'), 'default');
    assert.strictEqual(set(end('a && f() { set -f; }; f'), 'noglob'), 'unknown');
    // A call inside its own body: its effects are not known yet.
    assert.strictEqual(set(end('f() { f; set -f; }'), 'noglob'), 'default');
    // While typing.
    assert.ok(end('f()').functions.get('f'));
  });
  it('unset -f, export -f and declare -fx', () => {
    const st = end('f() { :; }; g() { :; }; h() { :; }; k() { :; }; unset -f g; export -f h; declare -fx k; declare -f f; export -f nofn; unset -f nofn; unset h; export -fn k');
    assert.deepStrictEqual(['f', 'g', 'h', 'k'].map((n) => [st.functions.get(n)?.state, st.functions.get(n)?.exported]), [['on', 'off'], ['off', 'off'], ['off', 'on'], ['on', 'off']]);
    assert.strictEqual(end('f() { :; }; x=1; unset -v f').functions.get('f')?.state, 'on');
    assert.strictEqual(end('f() { :; }; f=1; unset f').functions.get('f')?.state, 'on');
    assert.strictEqual(end('f() { :; }; declare +fx f').functions.get('f')?.exported, 'off');
    // A redefinition keeps the export.
    assert.strictEqual(end('f() { :; }; export -f f; f() { :; }').functions.get('f')?.exported, 'on');
  });
  it('merges the functions of the branches', () => {
    const st = end('f() { :; }; if a; then f() { :; }; export -f f; g() { :; }; fi');
    assert.deepStrictEqual([st.functions.get('f')?.state, st.functions.get('f')?.exported, st.functions.get('g')?.state], ['on', 'unknown', 'unknown']);
  });
  it('alias and unalias', () => {
    const st = end(`alias ll='ls -l' q='it'\\''s' r="$x" -p; alias g=grep; unalias g nope $x`);
    assert.deepStrictEqual([...st.aliases].map(([k, a]) => [k, a.state, a.value]), [['ll', 'on', 'ls -l'], ['q', 'on', "it's"], ['r', 'on', '$x'], ['g', 'off', 'grep']]);
    assert.ok([...end('alias a=1 b=2; unalias -a').aliases.values()].every((a) => a.state === 'off'));
    const merged = end('alias a=1 b=1; if x; then alias a=2 c=1; unalias b; fi');
    assert.deepStrictEqual(['a', 'b', 'c'].map((k) => merged.aliases.get(k)?.state), ['unknown', 'unknown', 'unknown']);
    assert.strictEqual(end('alias a=1; if x; then alias a=1; fi').aliases.get('a')?.state, 'on');
    const later = end('if x; then alias a=1; else alias a=1; alias b=2; fi');
    assert.deepStrictEqual([later.aliases.get('a')?.at.text, later.aliases.get('a')?.state, later.aliases.get('b')?.state], ['alias a=1', 'on', 'unknown']);
    assert.strictEqual(end('if x; then alias a=1; else alias a=1; fi').aliases.get('a')?.at.startIndex, 'if x; then alias a=1; else '.length);
  });
  it('is cached per tree and shell', () => {
    const tree = parser.parse('set -f');
    assert.strictEqual(shellState(tree), shellState(tree, 'bash'));
    assert.notStrictEqual(shellState(tree), shellState(tree, 'sh'));
    assert.strictEqual(shellState(tree).at(tree.root).run.set.size, 0);
  });
});
