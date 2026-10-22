// The shell state model (src/semantics/state.ts): what it says along small scripts. Its agreement with bash is
// checked on the rows of test/fixtures/probes/state.json by test/state-probes.test.ts.
import * as assert from 'assert';
import type { Shell } from '../src/dialect';
import { attribute, defaultOn, lastStageInShell, merge, NameMap, option, readDeclaration, shellState, ShellState, StateModel } from '../src/semantics/state';
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
    // (`declare "s=1"` assigns, as bash does; `$x` is not known.)
    assert.strictEqual(variable(st, 's')?.value, '1');
    assert.deepStrictEqual(readDeclaration(parser.parse('declare -ix +r a').root.namedChildren[0]).on, 'ix');
  });
  it('a nameref passes its assignments on', () => {
    assert.strictEqual(variable(end('declare -n r=t; r=5'), 't')?.value, '5');
    assert.strictEqual(variable(end('declare -n r=t; r=5'), 'r')?.value, 't');
    assert.strictEqual(variable(end('declare -n r=$1; r=5'), 'r')?.value, undefined);
    // An empty nameref takes the name assigned to it (not one that is no name).
    assert.strictEqual(variable(end('declare -n r; r=5'), 'r')?.set, 'off');
    assert.strictEqual(variable(end('declare -n r; r=x; r=5'), 'x')?.value, '5');
    assert.strictEqual(variable(end('declare -n a=b; declare -n b=c; a=1'), 'c')?.value, '1');
    assert.strictEqual(variable(end('declare -n a=b; declare -n b=a; a=1'), 'a')?.value, 'b');
    assert.strictEqual(variable(end('x=1; declare -n r=x; unset r'), 'x')?.declared, 'off');
    assert.strictEqual(variable(end('x=1; declare -n r=x; unset -n r'), 'r')?.declared, 'off');
    assert.strictEqual(variable(end('declare -n r=$1; unset r'), 'r')?.declared, 'on');
    // A word not known here: what its default sets may be the variable it names (bash: f=x r=1; an element is not followed).
    const dflt = end('unset ${x}; unset -f ${f:=x}; readonly r=1; unset ${r:=x}; unset ${a[1]:=x}; unset ${u:=u}');
    assert.deepStrictEqual(['f', 'r', 'a', 'u'].map((v) => variable(dflt, v)?.set), ['on', 'on', undefined, 'unknown']);
  });
  it('allexport exports what is assigned', () => {
    assert.strictEqual(attribute(end('set -a; x=1'), 'x', 'x'), 'on');
    assert.strictEqual(attribute(end('a && set -a; x=1'), 'x', 'x'), 'unknown');
    assert.strictEqual(attribute(end('export x; a && set -a; x=1'), 'x', 'x'), 'on');
  });
  it('read, mapfile, printf -v, getopts and ${x:=…} set variables', () => {
    const st = end('read -r a b; read -ra arr; mapfile -t; readarray lines; printf -v pv %s 1; printf x; getopts ab o; getopts; : ${d:=1} ${e=} ${f:-1} "$(: ${g:=1})"');
    assert.deepStrictEqual(['a', 'b', 'pv', 'o', 'OPTIND', 'OPTARG', 'd', 'e'].map((v) => variable(st, v)?.set), ['on', 'on', 'on', 'on', 'on', 'unknown', 'on', 'on']);
    assert.strictEqual(variable(end('read'), 'REPLY')?.set, 'on');
    assert.strictEqual(attribute(end("printf -v 'a[1]' x"), 'a', 'a'), 'on');
    assert.strictEqual(end('printf -v $v x; mapfile $m').variables.size, 0);
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
    assert.deepStrictEqual([variable(st, 'x')?.set, variable(st, 'y')?.value, attribute(st, 'm', 'A'), attribute(st, 'm', 'a'), variable(st, 'z')?.set, variable(st, 'w')?.set], ['unknown', '1', 'unknown', 'unknown', 'off', 'unknown']);
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
  it('a function exists once its definition ran; its body runs with the state of its call', () => {
    const src = 'f\nf() { g; }\nf -x\ng() { :; }';
    const m = model(src);
    assert.strictEqual(before(src, 'f').functions.get('f'), undefined);
    assert.strictEqual(before(src, 'f -x').functions.get('f')?.state, 'on');
    assert.strictEqual(before(src, 'g').functions.get('g'), undefined);
    assert.strictEqual(before('f() { g; }\ng() { :; }\nf', 'g').functions.get('g')?.state, 'on');
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
    assert.deepStrictEqual([...st.aliases].map(([k, a]) => [k, a.state, a.value]).sort(), [['g', 'off', 'grep'], ['ll', 'on', 'ls -l'], ['q', 'on', "it's"], ['r', 'on', '$x']]);
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

describe('shell state: function bodies run at their calls', () => {
  it('a body has the state of its call: functions defined and options set after the definition count', () => {
    const src = 'main() { setup; ls; }\nsetup() { shopt -s nullglob; }\nmain';
    assert.strictEqual(shopt(before(src, 'ls'), 'nullglob'), 'on');
    assert.strictEqual(set(end('f() { g; }; g() { set -f; }; f'), 'noglob'), 'on');
    assert.strictEqual(variable(end('f() { declare x=1; g; }; g() { y=2; }; f'), 'y')?.value, '2');
    assert.strictEqual(shopt(before('f() { ls; }\nshopt -s lastpipe\nf', 'ls'), 'lastpipe'), 'on');
    // Called twice with different states: the merge of both.
    assert.strictEqual(set(before('f() { ls; }\nf\nset -f\nf', 'ls'), 'noglob'), 'unknown');
    // Called twice with the same state: walked once.
    assert.strictEqual(set(end('f() { set -f; }; f; f'), 'noglob'), 'on');
  });
  it('a function no call reaches is walked from its definition, with what changes after it unknown', () => {
    const src = 'f() { ls; }\nset -C\nshopt -s nullglob\nalias q=ls\ng() { :; }\nx=1';
    const st = before(src, 'ls');
    // (But a function the top level defines, in the main shell and on every path, is there: the body runs later.)
    assert.deepStrictEqual([set(st, 'noclobber'), shopt(st, 'nullglob'), st.aliases.get('q')?.state, st.functions.get('g')?.state, variable(st, 'x')?.set], ['unknown', 'unknown', 'unknown', 'on', 'unknown']);
    for (const later of ['if [ "$x" ]; then g() { :; }; fi', 'g() { :; } &', 'g() { :; }\nunset g', '( g() { :; } )']) {
      assert.strictEqual(before(`f() { ls; }\n${later}`, 'ls').functions.get('g')?.state, 'unknown', later);
    }
    assert.strictEqual(set(before('set -C\nf() { ls; }\nset -C', 'ls'), 'noclobber'), 'unknown');
    // A function only called from one that is never called.
    assert.strictEqual(set(before('f() { g; }\ng() { ls; }\nset -f', 'ls'), 'noglob'), 'unknown');
    // An alias defined after, with a value that is not static, is left alone.
    assert.strictEqual(before('f() { ls; }\nalias q="$x"', 'ls').aliases.get('q')?.value, '$x');
  });
  it('locals and temporaries come back when the function returns', () => {
    assert.strictEqual(variable(end('f() { local x; declare -g x=1; }; f'), 'x')?.value, '1');
    assert.strictEqual(variable(end('f() { x=1; local x=2; }; f'), 'x')?.value, '1');
    assert.strictEqual(variable(end('x=0; f() { local x=1; g; }; g() { x=2; }; f'), 'x')?.value, '0');
    assert.strictEqual(variable(end('f() { local x=1; local x=2; }; f'), 'x'), undefined);
    assert.strictEqual(set(end('f() { local -; set -f; shopt -s dotglob; }; f'), 'noglob'), 'default');
    assert.strictEqual(shopt(end('f() { local -; set -f; shopt -s dotglob; }; f'), 'dotglob'), 'on');
    assert.strictEqual(variable(end('f() { x=5; }; x=1 f'), 'x'), undefined);
    assert.strictEqual(variable(end('x=0; f() { x=5; }; x=1 f; x=1 x=2 f'), 'x')?.value, '0');
    // `unset` of a caller's local shows the variable outside again; of its own local, it stays local.
    assert.strictEqual(variable(end('x=0; f() { local x=1; g; }; g() { unset x; x=2; }; f'), 'x')?.value, '2');
    assert.strictEqual(variable(end('x=0; f() { local x=1; g; }; g() { local x; unset x; x=2; }; f'), 'x')?.value, '0');
    // `local` outside a function sets nothing.
    assert.strictEqual(variable(end('local x=1'), 'x'), undefined);
    // `declare` in a function is local, `declare -g` is not, and `typeset` is local too.
    assert.deepStrictEqual(['a', 'b', 'c'].map((v) => variable(end('f() { declare a=1; declare -g b=1; typeset c=1; }; f'), v)?.value), [undefined, '1', undefined]);
  });
  it('a recursive call, and calls too deep, are guessed from what the body changes', () => {
    assert.strictEqual(set(end('f() { if a; then set -f; return; fi; f; }; f'), 'noglob'), 'unknown');
    const deep = Array.from({ length: 40 }, (_, i) => `f${i}() { f${i + 1}; }`).join('\n') + '\nf40() { set -f; }\nf0';
    assert.strictEqual(set(end(deep), 'noglob'), 'on');
    // Deeper than 64 calls, the rest is not followed.
    const deeper = Array.from({ length: 70 }, (_, i) => `f${i}() { f${i + 1}; }`).join('\n') + '\nf70() { set -f; }\nf0';
    assert.strictEqual(set(end(deeper), 'noglob'), 'default');
    // Called with many different states.
    const many = 'f() { set -f; x=1; }\n' + Array.from({ length: 20 }, (_, i) => `v${i}=1; f`).join('\n');
    assert.strictEqual(variable(end(many), 'x')?.set, 'unknown');
  });
  it('a readonly function is not defined again', () => {
    const st = end('f() { :; }; readonly -f f; f() { set -f; }; f');
    assert.deepStrictEqual([set(st, 'noglob'), st.functions.get('f')?.readonly], ['default', 'on']);
    assert.strictEqual(end('f() { :; }; declare -fr f').functions.get('f')?.readonly, 'on');
  });
});

describe('shell state: more builtins', () => {
  it('command, builtin, and declarations after a prefix assignment', () => {
    const st = end('command set -f; builtin shopt -s nullglob; command -p set -C; x=1 declare y=2; x=1 export z=3 w; builtin unset y; builtin; command -v set -u; command $c');
    assert.deepStrictEqual([set(st, 'noglob'), shopt(st, 'nullglob'), set(st, 'noclobber'), variable(st, 'y')?.declared, attribute(st, 'z', 'x'), variable(st, 'w')?.set, variable(st, 'x'), set(st, 'nounset')], ['on', 'on', 'on', 'off', 'on', 'off', undefined, 'default']);
    assert.strictEqual(variable(end('declare "a[1]=x" b+=1 "c d=1"'), 'b')?.set, 'on');
  });
  it('POSIXLY_CORRECT turns POSIX mode on and off; leaving a mode bash is not in changes nothing', () => {
    assert.deepStrictEqual([set(end('POSIXLY_CORRECT=1'), 'posix'), shopt(end('export POSIXLY_CORRECT=1'), 'expand_aliases')], ['on', 'on']);
    const off = model('unset POSIXLY_CORRECT', 'bash', true).end;
    assert.deepStrictEqual([set(off, 'posix'), shopt(off, 'expand_aliases'), shopt(off, 'inherit_errexit')], ['off', 'off', 'on']);
    assert.strictEqual(shopt(end('shopt -s shift_verbose; set +o posix'), 'shift_verbose'), 'on');
    assert.strictEqual(shopt(end('a && set -o posix; set +o posix'), 'shift_verbose'), 'unknown');
    assert.strictEqual(set(end('shopt -so posix'), 'posix'), 'on');
    assert.strictEqual(set(end('set -o posix; set +o posix', 'dash'), 'posix'), 'off');
  });
  it('an alias that is expanded runs its text', () => {
    assert.strictEqual(set(end("shopt -s expand_aliases\nalias e='set -f'\ne"), 'noglob'), 'on');
    assert.strictEqual(set(end("alias e='set -f'\ne"), 'noglob'), 'default');
    assert.strictEqual(set(end("shopt -s expand_aliases; alias e='set -f'; e"), 'noglob'), 'default');
    assert.strictEqual(set(end("a && shopt -s expand_aliases\nalias e='set -f'\ne"), 'noglob'), 'unknown');
    assert.strictEqual(set(end("alias e='set -f'\ne", 'sh'), 'noglob'), 'on');
    assert.strictEqual(set(end("shopt -s expand_aliases\nalias set='set -C'\nset -f; 'set' -u"), 'noclobber'), 'on');
    assert.strictEqual(end("alias 'q=echo'").aliases.get('q')?.value, 'echo');
  });
  it('the aliases of a command substitution are those of when it runs', () => {
    const src = 'shopt -s expand_aliases; alias x="echo A"; echo "$(x)" `y`; x';
    const tree = parser.parse(src);
    const m = shellState(tree);
    const cmds = descendants(tree.root, ['command']).filter((c) => c.text === 'x');
    assert.deepStrictEqual(cmds.map((c) => m.at(c).expand.aliases.get('x')?.state), ['on', undefined]);
    assert.strictEqual(m.at(cmds[0]).parse.aliases.get('x'), undefined);
  });
  it('attributes bash refuses or keeps', () => {
    const st = end('declare -a a; declare -A a; declare -A m; declare -a m; declare -r r=1; r=2; r+=3; unset r; set -a; arr=(1); arr2[1]=x; s=1; fn() { :; }');
    assert.deepStrictEqual([attribute(st, 'a', 'A'), attribute(st, 'm', 'a'), variable(st, 'r')?.value, attribute(st, 'arr', 'x'), attribute(st, 'arr2', 'x'), attribute(st, 's', 'x'), st.functions.get('fn')?.exported], ['off', 'off', '1', 'off', 'off', 'on', 'on']);
    assert.strictEqual(end('a && set -a; fn() { :; }').functions.get('fn')?.exported, 'unknown');
    assert.strictEqual(variable(end('declare -r r=1; declare r=2'), 'r')?.value, '1');
    assert.strictEqual(variable(end('x=1; unset x; x+=2'), 'x')?.value, '2');
  });
  it('unset: a name with no variable is a function; -f and -v together unset nothing', () => {
    assert.strictEqual(end('unset -v f; f() { :; }; unset f').functions.get('f')?.state, 'off');
    assert.strictEqual(end('f() { :; }; x=1; unset -fv f x').functions.get('f')?.state, 'on');
  });
  it('more paths through the walk', () => {
    // A default merged again with a path that left it alone.
    assert.strictEqual(shopt(end('if a; then if b; then shopt -u nullglob; fi; fi'), 'nullglob'), 'default');
    // Aliases changed after a function no call reaches.
    const al = (src: string) => before(src, 'ls').aliases.get('q');
    assert.strictEqual(al('alias q=ls\nf() { ls; }\nalias q=ls2')?.state, 'unknown');
    assert.strictEqual(al('if x; then alias q=1; fi\nf() { ls; }\nalias q=2')?.state, 'unknown');
    assert.strictEqual(al('f() { ls; }\nbuiltin alias q=ls'), undefined);
    // Export under set -a of a function defined again.
    assert.strictEqual(end('fn() { :; }; export -f fn; a && set -a; fn() { :; }').functions.get('fn')?.exported, 'on');
    assert.strictEqual(end('fn() { :; }; export -f fn; fn() { :; }').functions.get('fn')?.exported, 'on');
    // A function defined by an alias.
    assert.strictEqual(set(end("shopt -s expand_aliases\nalias d='g() { set -f; }'\nd\ng"), 'noglob'), 'on');
    assert.strictEqual(attribute(end('declare a[1]=x b[2]'), 'b', 'a'), 'on');
    assert.strictEqual(end('x=1; unset $v').variables.get('x')?.set, 'on');
  });
  it('names that are no names are left alone', () => {
    assert.strictEqual(end('read 1x; printf -v $v x; mapfile 2; getopts ab').variables.get('1x'), undefined);
  });
  it('the last stage of a pipeline', () => {
    const st = (src: string) => end(src);
    assert.deepStrictEqual([lastStageInShell(st('shopt -s lastpipe')), lastStageInShell(st('')), lastStageInShell(st('a && shopt -s lastpipe')),
      lastStageInShell(st('shopt -s lastpipe; a && set -m')), lastStageInShell(st(''), 'zsh'), lastStageInShell(st('shopt -s lastpipe'), 'dash')],
    ['on', 'off', 'unknown', 'unknown', 'on', 'off']);
  });
  it('is fast on long scripts with many functions', function () {
    this.timeout(20000);
    const lines: string[] = [];
    for (let i = 0; i < 300; i++) {
      lines.push(`f${i}() {`, `  local a${i}=1`, '  for x in a b c; do', `    while read -r line; do v${i}=$line; f${(i * 7) % 300}; done < /dev/null`, '  done',
        `  g${i}=2; IFS=, ; [[ -n $x ]] && shopt -s extglob`, `  f${(i * 13) % 300}`, '}', `f${i} "$@"`, `if [ -n "$x" ]; then y${i}=1; else declare -A m${i}; fi`);
    }
    const tree = parser.parse(lines.join('\n'));
    const t = Date.now();
    shellState(tree);
    assert.ok(Date.now() - t < 3000, `${Date.now() - t} ms`);
  });
});

describe('shell state: name maps', () => {
  it('keeps names in buckets that are shared between states', () => {
    const a = NameMap.empty<number>().with('x', 1).with('y', 2);
    assert.strictEqual(a.with('x', 1), a);
    assert.strictEqual(a.with('z', undefined), a);
    const b = a.with('x', undefined);
    assert.deepStrictEqual([b.size, b.has('x'), [...b.values()], [...a.keys()].sort()], [1, false, [2], ['x', 'y']]);
    const seen: string[] = [];
    a.forEach((v, k) => seen.push(`${k}${v}`));
    assert.deepStrictEqual(seen.sort(), ['x1', 'y2']);
    assert.strictEqual(a.withAll(new Map()), a);
    assert.deepStrictEqual([...a.withAll(new Map([['x', 3], ['w', 4]]))].sort(), [['w', 4], ['x', 3], ['y', 2]]);
    assert.ok(NameMap.same(a, NameMap.empty<number>().with('y', 2).with('x', 1), (x, y) => x === y));
    assert.ok(!NameMap.same(a, b, (x, y) => x === y));
    assert.ok(!NameMap.same(a, a.with('x', 5), (x, y) => x === y));
    assert.ok(!NameMap.same(a.with('w', 1), a.with('v', 1), (x, y) => x === y));
  });
});

describe('shell state: GLOBIGNORE and dotglob', () => {
  it('follows a local GLOBIGNORE going out of scope', () => {
    assert.strictEqual(shopt(end('f() { local GLOBIGNORE=x; }; f'), 'dotglob'), 'off');
    assert.strictEqual(shopt(end('unset GLOBIGNORE; f() { local GLOBIGNORE=x; }; f'), 'dotglob'), 'off');
    assert.strictEqual(shopt(end('GLOBIGNORE=y; f() { local GLOBIGNORE=x; }; f'), 'dotglob'), 'on');
    assert.strictEqual(shopt(end('if a; then GLOBIGNORE=y; fi; f() { local GLOBIGNORE=; }; f'), 'dotglob'), 'unknown');
    assert.strictEqual(shopt(end('GLOBIGNORE=$v'), 'dotglob'), 'unknown');
  });

});

describe('shell state: arithmetic', () => {
  /** What the state says of each name at the end: `set` (with the value when known), `unknown`, `off` or `none`. */
  const after = (src: string, ...names: string[]): string[] => names.map((n) => {
    const v = variable(end(src), n);
    return !v ? 'none' : v.set === 'on' ? `set${v.value === undefined ? '' : `=${v.value}`}` : v.set;
  });
  it('gives no value when an operand is not known', () => {
    // A text pasted that is not known may change the expression: what it seems to assign may be.
    assert.deepStrictEqual(after('(( h = $1 )); (( k = $(echo 1), l = 2 )); m=1; (( m = 2, n = ${#m} ))', 'h', 'k', 'l', 'm', 'n'), ['unknown', 'unknown', 'unknown', 'set', 'unknown']);
    // (`f = ` is a syntax error.)
    assert.deepStrictEqual(after('arr=(1); q=w; (( c = 2 ** 200, d = 1 << 64 )); (( e = $(( Z )) )); (( f = $nope )); (( g = $arr )); (( i = $q, j = "3" ))', 'c', 'd', 'e', 'f', 'g', 'i', 'j'),
      ['set', 'set', 'unknown', 'unknown', 'unknown', 'set=0', 'set=3']);
    // (An error in a subshell's expansion stays there.)
    assert.deepStrictEqual(after(': $(( a = 1, 1 / 0 )) | cat', 'a'), ['none']);
    // (A shift by a negative count or by 64 or more depends on the machine; a nameref to an element is not followed.)
    assert.deepStrictEqual(after('declare -n e=\'a[1]\'; (( a = 1 << -1, b = 1 << 64, c = 1 >> -1, d = 1 >> 64, f = e ))', 'a', 'b', 'c', 'd', 'f'), ['set', 'set', 'set', 'set', 'unknown']);
    assert.deepStrictEqual(after('declare x; declare -n r; (( a = x, b = 1 && 2, c = 0 || 3, d = 1 ? 4 : 4, e = r ))', 'a', 'b', 'c', 'd', 'e'), ['set=0', 'set=1', 'set=1', 'set=4', 'set=0']);
    // A name that leads back to itself is an error.
    assert.deepStrictEqual(after('z=y; y=z; (( b = 1, m = z ))', 'b', 'm'), ['set=1', 'none']);
  });
  it('reads a value not known as an expression that may fail or assign: what is assigned after it may be', () => {
    // (bash runs the value: `x='z = 9'` sets z; `x=/home` is an error, which ends the expression.)
    assert.deepStrictEqual(after('x=$y; a=(1)\n(( b = 1, c = x, d = 2 )); (( e = a[0] )); (( f = HOME )); read n; (( g = n ))', 'b', 'c', 'd', 'e', 'f', 'g'),
      ['set=1', 'unknown', 'unknown', 'unknown', 'unknown', 'unknown']);
    // A variable set before stays set, to a value not known (bash: 0).
    assert.deepStrictEqual(after('total=0; while read n; do (( total += n )); done', 'total'), ['set']);
    // Values that are numbers: an integer variable, one bash changes itself.
    assert.deepStrictEqual(after('declare -i n=$1; (( a = n, b = RANDOM, c = 1, d = -n ))', 'a', 'b', 'c', 'd'), ['set', 'set', 'set=1', 'set']);
    // (Also a value read from a value.)
    assert.deepStrictEqual(after('x=HOME; (( a = 1, b = x, c = 2 )); (( d = x ))', 'a', 'b', 'c', 'd'), ['set=1', 'unknown', 'unknown', 'unknown']);
  });
  it('says nothing sure of a name not set once a file was sourced, a string run or a trap set', () => {
    // (bash: y=4 each time; foo=3 comes from the file, the string, the trap.)
    assert.deepStrictEqual(after('(( a = foo + 1 )); source ./c.sh; (( b = foo + 1 ))', 'a', 'b'), ['set=1', 'unknown']);
    assert.deepStrictEqual(after('. ./c.sh; (( b = foo + 1 ))', 'b'), ['unknown']);
    assert.deepStrictEqual(after('eval "$cmd"; (( b = foo + 1 ))', 'b'), ['unknown']);
    assert.deepStrictEqual(after('trap \'foo=3\' USR1; (( b = foo + 1 ))', 'b'), ['unknown']);
    // (Resetting a trap, or ignoring a signal, runs nothing.)
    assert.deepStrictEqual(after('trap - USR1; trap \'\' INT; (( b = foo + 1 ))', 'b'), ['set=1']);
    // A value read before is not taken again for one that may have changed.
    assert.deepStrictEqual(after('x=\'foo + 1\'; (( a = x )); source ./c.sh; (( b = x ))', 'a', 'b'), ['set=1', 'unknown']);
  });
  it('reads ++ and -- as bash does', () => {
    // After a name, `x++`; before one, `++x`; elsewhere, a sign (bash: y=8 z=8 w=8 v=4, 4 and x=3).
    assert.deepStrictEqual(after('x=-3; (( y = 5-$x ))', 'y'), ['set=8']);
    assert.deepStrictEqual(after('(( y = 5 --3, z = 5 ++ 3, w = 5 -- (3), v = 7 ---3 ))', 'y', 'z', 'w', 'v'), ['set=8', 'set=8', 'set=8', 'set=4']);
    assert.deepStrictEqual(after('x=2; (( y = 1 +++x ))', 'y', 'x'), ['set=4', 'set=3']);
    // (bash: `x---3` is `x-- - 3`.)
    assert.deepStrictEqual(after('x=2; (( y = x++ + ++x, z = x---3, a[1]++, w = ++ x ))', 'y', 'z', 'w', 'x'), ['set=6', 'set=1', 'set=4', 'set=4']);
    // (`++5` is two signs; inside a subscript too.)
    assert.deepStrictEqual(after('(( y = ++5, a[5--3] = 1 ))', 'y'), ['set=5']);
    // bash fails on `++x++`; the parser reads `x++ 3` and `x ++y` otherwise.
    assert.deepStrictEqual(after('x=2; (( y = ++x++ )); (( z = x++ 3 )); (( w = x ++y ))', 'y', 'z', 'w', 'x'), ['unknown', 'unknown', 'unknown', 'set']);
  });
  it('takes a syntax error as not known: bash has made the assignments before it', () => {
    // (bash: y=1; y=3 z unset; y=1 z=1; a=1 c=1; y=0 twice.)
    assert.deepStrictEqual(after('(( y = 1 2 ))', 'y'), ['unknown']);
    assert.deepStrictEqual(after('(( y = 3, , z = 4 ))', 'y', 'z'), ['unknown', 'unknown']);
    assert.deepStrictEqual(after('(( y = 1, z = 1 2 ))', 'y', 'z'), ['unknown', 'unknown']);
    assert.deepStrictEqual(after('(( a = 1, l = 1 + )); for (( c = 1, i = ; ; )); do break; done', 'a', 'l', 'c', 'i'), ['unknown', 'unknown', 'unknown', 'unknown']);
    // A missing operand of `?:`.
    assert.deepStrictEqual(after('y=0; (( y = 1 ? 2 : )); z=0; (( z = 1 ? : 3 ))', 'y', 'z'), ['set', 'set']);
    // Text left in a value read (bash: an error); base 64's `@` next to other terms (bash: y=63).
    assert.deepStrictEqual(after('v=\'$z\'; (( w = v )); (( y = 64#@ + 1 ))', 'w', 'y'), ['unknown', 'unknown']);
  });
  it('may assign on a side the condition does not decide', () => {
    assert.deepStrictEqual(after('declare -i u=$1; (( u ? v = 1 : (w = 2), u && (o = 2), u || (p = 3), q = u && 1, r = 1 && u ))', 'v', 'w', 'o', 'p', 'q', 'r'), ['unknown', 'unknown', 'unknown', 'unknown', 'set', 'set']);
    assert.deepStrictEqual(after('declare -i u=$1; (( u ? 1 : 2, u && 1 ))', 'u'), ['set']);
    // An operand of `${…}` may not be expanded.
    assert.deepStrictEqual(after('s=abc; echo ${s:$(( k = 1 ))} ${s:-$(( 2 ))}', 'k'), ['unknown']);
    // A command whose name is not known may be a program, which makes its redirections in its own process.
    assert.deepStrictEqual(after('$cmd > f$(( a = 1 )); $cmd > ${b:=x}; ls > ${c:=x}; { $cmd; } > f$(( d = 1 )); command > f$(( e = 1 ))', 'a', 'b', 'c', 'd', 'e'),
      ['unknown', 'unknown', 'none', 'set=1', 'set=1']);
    // (`command -v` and `-pv` only look the name up.)
    assert.deepStrictEqual(after('command -pv ls > f$(( a = 1 )); command -V ls > f$(( b = 1 ))', 'a', 'b'), ['set=1', 'set=1']);
    // An array that may be associative: its subscript may be arithmetic.
    assert.deepStrictEqual(after('[ "$1" ] && declare -A m\ni=0; (( m[i++] = 1 ))', 'i'), ['set']);
    // An error there discards the command: what came before it may have been assigned.
    assert.deepStrictEqual(after('s=abc; echo ${s:$(( a = 1, 1 / 0 ))}; $cmd > f$(( b = 1, 1 / 0 )); echo $(( c = 1, 1 / 0 ))', 'a', 'b', 'c'), ['unknown', 'unknown', 'set=1']);
  });
  it('expands the value of an assignment before its subscript', () => {
    // (Not with `declare`, which expands its words in order: bash gives j=0, then j=1.)
    assert.deepStrictEqual(after('i=0; arr[$(( i++ ))]=$(( j = i ))', 'i', 'j'), ['set=1', 'set=0']);
    assert.deepStrictEqual(after('i=0; declare arr[$(( i++ ))]=$(( j = i ))', 'i', 'j'), ['set=1', 'set=1']);
  });
  it('reads what it can of arithmetic the parser does not read', () => {
    // (Assigning to `$x`, or to a number, is not followed.)
    assert.deepStrictEqual(after('(( $x = 1, 1++ ))', 'x'), ['none']);
    // (bash: none of them is set; `**=` is no operator.)
    assert.deepStrictEqual(after('let "a[1] = $v" "b += $v"\nlet \'c **= 2\' \'d = (\'', 'a', 'b', 'c', 'd'), ['unknown', 'unknown', 'none', 'unknown']);
    assert.strictEqual(attribute(end('v=1; let "a[1] = $v"'), 'a', 'a'), 'on');
    assert.deepStrictEqual(after('let "n++ + $1" "++q + $1"', 'n', 'q'), ['unknown', 'unknown']);
    // An unquoted expansion in an argument of `let` is split and globbed; `let` stops at an argument that fails
    // (bash: `+` alone does, and z is not set), so what those after it assign may be.
    assert.deepStrictEqual(after('v=1; w="1 + 2"; let x=$v y=$w z="$w"', 'x', 'y', 'z'), ['set=1', 'unknown', 'unknown']);
    assert.deepStrictEqual(after('i=0; (( a[i++] = 2, a[j += 2] = 3 ))', 'i', 'j'), ['set=1', 'set=2']);
  });
  it('says what it cannot be sure of as unknown, not as a value or an error', () => {
    // A side bash may not take: an error there may not happen.
    assert.deepStrictEqual(after('declare -i u=$1; (( u ? (a = 1 / 0) : 2, b = 1 )); (( u && (c = 08), d = 1 ))', 'a', 'b', 'c', 'd'), ['unknown', 'unknown', 'unknown', 'unknown']);
    assert.deepStrictEqual(after('[ "$1" ] && declare -A m\n(( m[1 / 0] = 1, e = 1 ))', 'e'), ['unknown']);
    // Variables bash changes itself.
    assert.deepStrictEqual(after('RANDOM=1; SECONDS=5; (( r = RANDOM, s = SECONDS + 1 )); (( t = $RANDOM ))', 'r', 's', 't'), ['set', 'set', 'unknown']);
    // Pasted text not followed here: command output, `$'…'`, a backslash in double quotes, a subscript that what the
    // text assigns before it may change.
    assert.deepStrictEqual(after('(( a = $(echo 1) )); (( b = $\'1\' )); (( c = "\\1" )); i=0; x=\'i = 1, y = a[$i]\'; (( d = x ))', 'a', 'b', 'c', 'd', 'i', 'y'),
      ['unknown', 'unknown', 'unknown', 'unknown', 'set', 'unknown']);
    // (An element read is a value not known: bash gives y=0 d=0.)
    assert.deepStrictEqual(after('j=0; x=\'k = 1, y = a[$j]\'; (( d = x ))', 'k', 'y', 'd'), ['set=1', 'unknown', 'unknown']);
    assert.deepStrictEqual(after('j=0; x=\'k++, ++l, y = a[$j]\'; (( d = x ))', 'k', 'l', 'y', 'd'), ['set=1', 'set=1', 'unknown', 'unknown']);
    assert.deepStrictEqual(after('declare -i u=$1; x=\'k = 1, a[$(( 1 ))]\'; (( d = x )); y=\'m = 1, a[$m]\'; (( u ? y : 0 ))', 'd', 'k', 'm'), ['unknown', 'unknown', 'unknown']);
    // (An array that may be associative, whose subscript changes nothing.)
    assert.deepStrictEqual(after('[ "$1" ] && declare -A m\n(( m[1] = 1, e = 1 ))', 'e'), ['set=1']);
    // An expansion in a subscript of a text read as arithmetic, after one (bash: an error); an empty `$(( ))` is 0; an
    // error in the expansion of an argument of `let` discards the command.
    assert.deepStrictEqual(after('let \'y = a[1] + $b\'; (( z = 2 + $(( )) )); let w=1 v=$(( 1 / 0 ))', 'y', 'z', 'w'), ['unknown', 'set=2', 'none']);
    // (A `$(( ))` in an argument of `let` runs once, with the words: bash gives n=1, x=0.)
    assert.deepStrictEqual(after('n=0; let x=$(( n++ )) "y = $(( 1 ))"', 'n', 'x', 'y'), ['set=1', 'unknown', 'unknown']);
    // A chain of values deeper than followed here (also when its start was read before); a name read again once
    // something changed.
    const chain = (n: number): string => ['v0=1', ...Array.from({ length: n }, (_, i) => `v${i + 1}=v${i}`)].join('; ');
    assert.deepStrictEqual(after(`${chain(150)}; (( y = v150 ))`, 'y'), ['unknown']);
    assert.deepStrictEqual(after(`${chain(150)}; (( x = v60 )); (( y = v150 ))`, 'x', 'y'), ['set=1', 'unknown']);
    assert.deepStrictEqual(after(`${chain(90)}; (( y = v90 ))`, 'y'), ['set=1']);
    assert.deepStrictEqual(after('i=0; x=\'i++ < 5 ? x : 7\'; (( y = x ))', 'i', 'y'), ['set=6', 'set=7']);
    // A value read again is taken again once what it reads has changed (also past the values remembered of it), or
    // when it reads a nameref.
    assert.deepStrictEqual(after('x=\'y + 1\'; y=1; (( a = x )); y=5; (( b = x )); (( c = x ))', 'a', 'b', 'c'), ['set=2', 'set=6', 'set=6']);
    const changes = Array.from({ length: 10 }, (_, i) => `y=${i}; (( a = x ))`).join('; ');
    assert.deepStrictEqual(after(`x='y + 1'; ${changes}; y=0; (( b = x ))`, 'a', 'b'), ['set=10', 'set=1']);
    assert.deepStrictEqual(after('w=5; declare -n r=w; x=\'r + 1\'; (( a = x )); w=6; (( b = x ))', 'a', 'b'), ['set=6', 'set=7']);
    // What is not known stays so (bash: an error).
    assert.deepStrictEqual(after('x=\'$1\'; (( a = x )); (( b = x ))', 'a', 'b'), ['unknown', 'unknown']);
    // What may be assigned is looked for in the values the expression reads, also through a nameref.
    assert.deepStrictEqual(after('x=\'a[1] = 2, i++, ++j\'; declare -n r=x; (( y = $1 + r ))', 'a', 'i', 'j', 'y'), ['unknown', 'unknown', 'unknown', 'unknown']);
  });
  it('gives up on an expression too long or too deep to follow, quickly', () => {
    // (Each value reads the one before twice, and assigns: 2 ** 30 steps.)
    const values = ['v0=\'c++\'', ...Array.from({ length: 30 }, (_, i) => `v${i + 1}='v${i}+v${i}'`)].join('; ');
    let start = Date.now();
    // (`u`: an argument of `let` not followed may fail, which stops `let`.)
    assert.deepStrictEqual(after(`${values}; (( y = v30, z = 1 )); let w=v30 u=1`, 'y', 'z', 'w', 'u', 'c'), ['unknown', 'unknown', 'unknown', 'unknown', 'unknown']);
    assert.ok(Date.now() - start < 1000, `took ${Date.now() - start} ms`);
    // Past the steps of the whole script, the rest of it is not followed (each line here takes all the steps it may).
    start = Date.now();
    assert.deepStrictEqual(after(`${values}\n${'(( y = v30 ))\n'.repeat(60)}(( z = 1 ))`, 'z'), ['unknown']);
    assert.ok(Date.now() - start < 3000, `took ${Date.now() - start} ms`);
    // Values nested deeper than followed here (bash: 1), or than the stack of the parser.
    const deep = ['v0=1', ...Array.from({ length: 100 }, (_, i) => `v${i + 1}='${'('.repeat(40)}v${i}${')'.repeat(40)}'`)].join('\n');
    assert.deepStrictEqual(after(`${deep}\n(( y = v100 ))`, 'y'), ['unknown']);
    assert.deepStrictEqual(after(`x='${'('.repeat(100_000)}1${')'.repeat(100_000)}'; (( y = x ))`, 'y'), ['unknown']);
  });
  it('follows scripts that read values many times in linear time', () => {
    const time = (src: string): number => {
      const start = Date.now();
      end(src);
      return Date.now() - start;
    };
    const lines = (n: number, line: string): string => Array.from({ length: n }, () => line).join('\n');
    const doubling = ['v0=1', ...Array.from({ length: 60 }, (_, i) => `v${i + 1}='v${i}+v${i}'`)].join('\n');
    const elements = ['v0=1', ...Array.from({ length: 60 }, (_, i) => `v${i + 1}='a[v${i}] + a[v${i}]'`)].join('\n');
    const chain = ['v0=1', ...Array.from({ length: 1000 }, (_, i) => `v${i + 1}=v${i}`)].join('\n');
    let loops = '(( z++ ))';
    for (let d = 0; d < 18; d++) loops = `for (( i${d} = 0; i${d} < 3; i${d}++ )); do (( t += i${d} )); ${loops}; done`;
    for (const src of [`${doubling}\n${lines(2000, '(( y = v60 ))')}`, `${doubling}\n${lines(2000, 'let y=v60 z=v59')}`, `${elements}\n${lines(2000, '(( y = v60 ))')}`,
      `${chain}\n${lines(2000, '(( y = v1000 ))')}`, loops]) {
      const ms = time(src);
      assert.ok(ms < 1000, `took ${ms} ms: ${src.slice(0, 40)}`);
    }
    // (Each loop starts from the values its last walk ended with: an inner loop may not run.)
    assert.deepStrictEqual(after(loops, 't', 'z', 'i0', 'i17'), ['unknown', 'unknown', 'unknown', 'set']);
  });
});
