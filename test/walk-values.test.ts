// What the walk of the shell state gives the values of expansions (src/semantics/walk/, src/semantics/values.ts), where
// bash's own facts are hard to put in a probe marker: the prefix assignments of a command (each sees those before it;
// `export` and `readonly` keep them), bash's readonly variables, bodies only uncalled functions call, a word that
// fails, PS4 and the variables bash 5.3 makes dynamic. test/fixtures/probes/values.json and state.json hold the rows
// bash checks.
import * as assert from 'assert';
import { assignmentsOf, keptPrefixes, resolveName } from '../src/semantics/names';
import { shellState } from '../src/semantics/state';
import { expansionValue } from '../src/semantics/values';
import { changedByBash, DYNAMIC_SINCE_53 } from '../src/semantics/vars';
import { createUnbashParser } from '../src/syntax/adapters/unbash';
import { descendants } from '../src/syntax/tree';
import { allTokens, explain } from './support/explain';

const parser = createUnbashParser();

/** The value of the `nth` expansion whose text is `text` in `src` (undefined: none). */
function valueOf(src: string, text: string, nth = 0): string | undefined {
  const tree = parser.parse(src);
  const n = descendants(tree.root, ['simple_expansion', 'expansion']).filter((e) => e.text === text)[nth];
  assert.ok(n, `${text} in ${src}`);
  return expansionValue(n, shellState(tree))?.text;
}

/** The value of `name` in the state at the end of `src`: its text, `unknown`, or `unset`. */
function after(src: string, name: string): string | undefined {
  const tree = parser.parse(`${src}\n: END`);
  const end = descendants(tree.root, ['command']).find((c) => c.text === ': END')!;
  const v = shellState(tree).at(end).run.variables.get(name);
  return !v ? undefined : v.declared === 'unknown' || v.set === 'unknown' ? 'unknown' : v.set === 'off' ? 'unset' : v.value ?? 'unknown';
}

describe('the prefix assignments of a command with a name', () => {
  it('expands each with those before it, as bash does', () => {
    assert.strictEqual(valueOf('a=1; a=2 b=$a cmd', '$a'), '2');
    assert.strictEqual(valueOf('a=1; f() { echo "$b"; }; a=2 b=$a f', '$b'), '2');
    assert.strictEqual(valueOf('P=/a; P=/x D=$P make', '$P'), '/x');
    // (The words are expanded before them; an element is no variable of the command: bash refuses it.)
    assert.strictEqual(valueOf('a=1; a=2 printf %s "$a"', '$a'), '1');
    assert.strictEqual(valueOf('b=1; c[1]=2 d=$b cmd', '$b'), '1');
    // (Nothing of it stays after the command.)
    assert.strictEqual(after('a=1; a=2 b=$a true', 'a'), '1');
    assert.strictEqual(after('a=1; a=2 b=$a true', 'b'), undefined);
  });

  it('keeps those `export` and `readonly` get, in any mode, also behind `command` and `builtin`', () => {
    assert.strictEqual(after('a=1; a=2 export a', 'a'), '2');
    assert.strictEqual(after('a=1; b=1; a=2 b=3 export a', 'b'), '1');
    assert.strictEqual(after('a=1; a=2 command export -- a', 'a'), '2');
    assert.strictEqual(after('a=1; a=2 builtin readonly a', 'a'), '2');
    assert.strictEqual(after('a=1; x=5; a=$x export a; x=6', 'a'), 'unknown');
    assert.strictEqual(valueOf('a=1; x=5; a=$x export a; x=6; echo "$a"', '$a'), '5');
    assert.strictEqual(after('a=1; a=2 export a=7', 'a'), '7');
    // (Not when the value or the variable is not known for sure: an option, a word not known, declare, an attribute
    // that changes the value, a nameref.)
    for (const src of ['a=1; a=2 export -n a', 'a=1; a=2 declare -x a', 'a=1; a=2 declare a=7', 'a=1; a=2 local a', 'a=1; a=2 export "$v"',
      'declare -i a=1; a=1+1 export a', 'declare -n a=t; t=1; a=2 export a', 'a=1; a=2 typeset "a=7"']) {
      assert.strictEqual(after(src, 'a'), 'unknown', src);
    }
    assert.strictEqual(after('b=2 local b', 'b'), 'unknown');
    assert.strictEqual(after('c=2 export -n c', 'c'), 'unknown');
    // (Nor when a program of the name runs: `enable -n`.)
    assert.strictEqual(after('a=1; enable -n export; a=2 export a', 'a'), '1');
    assert.strictEqual(after('[ -f x ] && enable -n export; a=2 export a', 'a'), 'unknown');
    // (`command -v` only looks the name up.)
    assert.strictEqual(after('a=1; a=2 command -v export', 'a'), '1');
    assert.deepStrictEqual(keptPrefixes(parser.parse('a=2 command -v export a').root.namedChildren[0], () => undefined), { names: new Map() });
  });

  it('says that the one `export` gets stays', () => {
    const tree = parser.parse('a=2 b=3 export a');
    const c = descendants(tree.root, ['command'])[0];
    const model = shellState(tree);
    const res = resolveName(model, 'export', c, { command: true });
    assert.deepStrictEqual(assignmentsOf(model, c, res).map((a) => `${a.name}:${a.scope}${a.named ? ` by ${a.named}` : ''}`), ['a:persists by export', 'b:command']);
    const said = (src: string, lang: 'en' | 'ja'): string => allTokens(explain(src, 0, lang).items).map((t) => t.explanation).join('\n');
    assert.match(said('a=2 b=3 command export a', 'en'), /`export` gets this name, so this assignment stays after the command, exported/);
    assert.match(said('a=2 b=3 command export a', 'en'), /Environment variable set only for this command/);
    assert.match(said('a=2 readonly a', 'ja'), /`readonly` がこの名前を受け取るので、この代入はコマンドの後も残り、エクスポートされる/);
  });
});

describe("bash's own readonly variables", () => {
  it('end the line at an assignment, as a readonly variable of the script does', () => {
    assert.strictEqual(valueOf('y=1; UID=5; y=5; echo "$y"', '$y'), undefined);
    assert.strictEqual(valueOf('y=1; SHELLOPTS=x\ny=5; echo "$y"', '$y'), '5');
    assert.strictEqual(valueOf('y=1; f() { EUID=5; y=6; }; f\necho "$y"', '$y'), '1');
    // (Before a command, or given to a builtin, the assignment fails, and bash goes on.)
    assert.strictEqual(valueOf('y=1; PPID=5 true; y=5; echo "$y"', '$y'), '5');
    assert.strictEqual(after('UID=5; y=1', 'UID'), 'unknown');
  });
});

describe('a body that only bodies no call reaches call', () => {
  it('is not settled: no value, no decision, no dead code', () => {
    assert.strictEqual(valueOf('X=1; f() { g; }; g() { echo "$X"; }', '$X'), undefined);
    assert.strictEqual(valueOf('X=1; f() { g; }; g() { h; }; h() { echo "$X"; }', '$X'), undefined);
    assert.strictEqual(valueOf('X=1; f() { f; echo "$X"; }', '$X'), undefined);
    // (Also called from the top level: reached.)
    assert.strictEqual(valueOf('X=1; f() { g; }; g() { echo "$X"; }; g', '$X'), '1');
    const src = 'X=1; f() { g; }; g() { if [ "$X" = 1 ]; then echo one; else echo other; fi; }';
    const tree = parser.parse(src);
    const model = shellState(tree);
    assert.strictEqual(model.condition(descendants(tree.root, ['if_statement'])[0]), undefined);
    assert.strictEqual(model.dead(descendants(tree.root, ['command']).find((c) => c.text === 'echo other')!), false);
    const reached = parser.parse(`${src}; g`);
    assert.strictEqual(shellState(reached).condition(descendants(reached.root, ['if_statement'])[0])?.outcome, 'true');
  });
});

describe('a word bash fails on', () => {
  it('leaves no value to the other words of its statement', () => {
    assert.strictEqual(valueOf('e=; x=1; echo ${e:?} "$x"', '$x'), undefined);
    assert.strictEqual(valueOf('e=; x=1; a=${e:?} b=$x', '$x'), undefined);
    assert.strictEqual(valueOf('e=; x=1; for i in ${e:?} "$x"; do :; done', '$x'), undefined);
    assert.strictEqual(valueOf('set -u; x=1; [[ $nope == "$x" ]]', '$x'), undefined);
    assert.strictEqual(valueOf('set -u; x=1; echo $1 "$x"', '$x'), undefined);
    assert.strictEqual(valueOf('set -u; x=1; echo "${a[@]}" "$x"', '$x'), undefined);
    // (Not one that cannot fail, nor one in a statement of its own.)
    assert.strictEqual(valueOf('x=abc; echo "${x:?}" "$x"', '$x'), 'abc');
    assert.strictEqual(valueOf('set -u; x=1; echo "$@" "$*" $# $? $0 ${nope:-d} ${nope+w} "$x"', '$x'), '1');
    assert.strictEqual(valueOf('x=1; echo "$x" $(echo ${e:?})', '$x'), '1');
    assert.strictEqual(valueOf('x=1; echo "$x" ${x:?}', '$x'), '1');
    // (Under `set -u`, each word of the statement asks for the others: all known.)
    const tree = parser.parse('set -u; x=1; y=2; z=3; echo "$x" "$y" "$z"');
    const model = shellState(tree);
    assert.deepStrictEqual(descendants(tree.root, ['simple_expansion']).map((e) => expansionValue(e, model)?.text), ['1', '2', '3']);
  });

  it('is the word of `${y:-w}` only when bash expands it', () => {
    assert.strictEqual(valueOf('e=; y=1; : ${y:-${e:?}}; echo "$y"', '$y'), '1');
    assert.strictEqual(valueOf('e=; y=1; : ${y:+${e:?}}; echo "$y"', '$y'), undefined);
    assert.strictEqual(valueOf('e=; y=; : ${y-${e:?}}; echo "$y"', '$y'), '');
    assert.strictEqual(valueOf('e=; y=; : ${y:=${e:?}}\necho "$y"', '$y'), undefined);
    // (A variable not known here, or a nameref to one not known: it may be. The subscript is always expanded.)
    assert.strictEqual(valueOf('e=; y=$(cmd); x=1; : ${y:+${e:?}}\necho "$x"', '$x'), '1');
    assert.strictEqual(valueOf('e=; t=a; declare -n r=$t; x=1; : ${r:+${e:?}}\necho "$x"', '$x'), '1');
    assert.strictEqual(valueOf('e=; a=(1); x=1; : ${a[${e:?}]}\necho "$x"', '$x'), undefined);
  });
});

describe('PS4, which `set -x` expands before each command', () => {
  const blind = (src: string): string | undefined => shellState(parser.parse(src)).blind;
  it('makes nothing trusted when it may assign or run a command', () => {
    for (const ps4 of ["'$((n++)) '", "'${x:=1}'", "'$(date) '", "'`date`'", "'${a[i++]}'", '"$y"', "'${!r}'"]) {
      assert.match(blind(`PS4=${ps4}; set -x; x=1`) ?? '', /PS4/, ps4);
    }
    assert.match(blind('read PS4') ?? '', /PS4/);
    assert.match(blind("f() { local PS4='$((n++))'; }") ?? '', /PS4/);
  });
  it('trusts one that only reads parameters', () => {
    for (const ps4 of ["'+ '", "'+ ${BASH_SOURCE}:${LINENO}: '", "'+${BASH_SOURCE}:${LINENO}:${FUNCNAME[0]:+${FUNCNAME[0]}(): }'", "'$# ${#x} ${x:?no}'"]) {
      assert.strictEqual(blind(`PS4=${ps4}; set -x; x=1`), undefined, ps4);
    }
    assert.strictEqual(blind("PS4='+ '; unset PS4; (( PS4 = 1 ))"), undefined);
  });
});

describe('the variables bash 5.3 makes dynamic', () => {
  it('have no value, which 5.2 would keep', () => {
    for (const name of DYNAMIC_SINCE_53) {
      assert.ok(changedByBash(name), name);
      assert.strictEqual(valueOf(`${name}=1; echo "$${name}"`, `$${name}`), undefined);
    }
  });
});

describe('errors bash stops at, and commands bash may not run (review of #356)', () => {
  /** The value of the last expansion `text` of `src`, in the shell `shell`. */
  const last = (src: string, text: string, shell?: 'bash' | 'dash' | 'sh'): string | undefined => {
    const tree = parser.parse(src);
    const all = descendants(tree.root, ['simple_expansion', 'expansion']).filter((e) => e.text === text);
    return expansionValue(all[all.length - 1], shellState(tree, shell))?.text;
  };

  it('gives no value to the words of a statement whose other expansion may fail (bash checks the rows of values.json)', () => {
    assert.strictEqual(valueOf('x=abc; echo "${x:1:-4}" "$x"', '$x'), undefined);
    assert.strictEqual(valueOf('x=abc; echo "${x:08}" "$x"', '$x'), undefined);
    assert.strictEqual(valueOf('x=abc; echo "$((1/0))" "$x"', '$x'), undefined);
    assert.strictEqual(valueOf('x=abc; echo "${x@Z}" "$x"', '$x'), undefined);
    // (A constant arithmetic expansion, a substring that cannot fail, a known transformation: the value stays.)
    assert.strictEqual(valueOf('x=abc; echo "$x" $((2+3)) "${x: -2}" "${x@Q}"', '$x'), 'abc');
    // With failglob maybe on, any word may fail.
    assert.strictEqual(valueOf('[ -f a ] && shopt -s failglob; x=abc; echo "$x" *.c', '$x'), undefined);
  });

  it('keeps the values of the words before a redirection that fails: bash expands them first', () => {
    assert.deepStrictEqual(valueOf("x='a b'; echo \"$x\" > $x", '$x'), 'a b');
  });

  it('follows the line or the shell that an error ends', () => {
    assert.strictEqual(last('x=a; z=abc; : "${z:08}"; x=b\necho "$x"', '$x'), undefined);
    assert.strictEqual(last('x=a; z=abc; : "${z:1:2}"; x=b\necho "$x"', '$x'), 'b');
    assert.strictEqual(last('x=a; z=abc; : "${z@Z}"; x=b\necho "$x"', '$x'), undefined);
    // (Unset, `${z@Z}` gives nothing; from the environment, it may be set.)
    assert.strictEqual(last('x=a; unset z; : "${z@Z}"; x=b\necho "$x"', '$x'), 'b');
    assert.strictEqual(last('x=a; : "${z@Z}"; x=b\necho "$x"', '$x'), 'b');
    // In POSIX mode an assignment or arithmetic error ends the shell; with the mode not known, it may.
    assert.strictEqual(last('set -o posix; x=a; readonly r=1; r=2\necho "$x"', '$x'), undefined);
    assert.strictEqual(last('[ -f a ] && set -o posix; x=a; readonly r=1; r=2\necho "$x"', '$x'), 'a');
    assert.strictEqual(last('set -o posix; x=a; echo $((1/0))\necho "$x"', '$x'), undefined);
    assert.strictEqual(last('x=a; readonly r=1; r=2\necho "$x"', '$x'), 'a');
  });

  it('follows the errors that end a dash script', () => {
    assert.strictEqual(last('x=a; readonly r=1; r=2 true\necho "$x"', '$x', 'dash'), undefined);
    assert.strictEqual(last('x=a; readonly r=1; unset r\necho "$x"', '$x', 'dash'), undefined);
    assert.strictEqual(last('x=a; [ -f a ] && readonly r=1; unset r\necho "$x"', '$x', 'dash'), 'a');
    assert.strictEqual(last('x=a; : $((1/0))\necho "$x"', '$x', 'sh'), undefined);
    assert.strictEqual(last('x=a; unset q\necho "$x"', '$x', 'dash'), 'a');
  });

  it('takes a command whose redirection may fail as maybe not run', () => {
    assert.strictEqual(after('a=1; a=2 export a >/nonexistent/x', 'a'), 'unknown');
    assert.strictEqual(after('a=1; { a=2; } >/bad', 'a'), 'unknown');
    assert.strictEqual(after('a=1; f() { a=2; }; f >/bad', 'a'), 'unknown');
    assert.strictEqual(after('a=1; { a=2; } >/dev/null 2>&1', 'a'), '2');
  });

  it("gives no value for `\\x{…}` in `$'…'`", () => {
    assert.strictEqual(valueOf("x=$'\\x{41}'; echo \"$x\"", '$x'), undefined);
    assert.strictEqual(valueOf("x=$'\\x41'; echo \"$x\"", '$x'), 'A');
  });
});
