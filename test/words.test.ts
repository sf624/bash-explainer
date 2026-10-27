// The word model (src/semantics/words.ts): the context of a word, the steps that apply to it, and its fields.
// Its agreement with bash on the probes is checked by test/word-probes.test.ts; here, the contexts the probes'
// arguments cannot show (a here-string, a here-document) are compared with bash too.
import * as assert from 'assert';
import { execFileSync } from 'child_process';
import { shellState, type StateModel } from '../src/semantics/state';
import { bracesInContext, CONTEXTS, partMeaning, underscoreValue, wordFields, wordMeaning, wordOf, type WordEnv } from '../src/semantics/words';
import { createUnbashParser } from '../src/syntax/adapters/unbash';
import { descendants, type SyntaxNode } from '../src/syntax/tree';
import { staticWordValue } from '../src/staticword';
import { BOX, FILES, PROBE_ENV, probeSkipReason, runProbe } from './support/probe';

const parser = createUnbashParser();
const ENV: WordEnv = { variables: PROBE_ENV, pwd: BOX, files: FILES };

/** The model of `src` and its node whose text is `text` (the `nth` one, from 0). */
function find(src: string, text: string, nth = 0, posix = false): { node: SyntaxNode; model: StateModel } {
  const tree = parser.parse(src);
  const all: SyntaxNode[] = [];
  const visit = (n: SyntaxNode): void => {
    if (n.named && n.text === text) all.push(n);
    n.children.forEach(visit);
  };
  visit(tree.root);
  assert.ok(all[nth], `${text} in ${src}`);
  return { node: all[nth], model: shellState(tree, 'bash', { posix }) };
}
const context = (src: string, text: string, nth = 0) => wordOf(find(src, text, nth).node)?.context;
const meaning = (src: string, text: string, nth = 0, posix = false) => {
  const { node, model } = find(src, text, nth, posix);
  return wordMeaning(node, model)!;
};
const step = (src: string, text: string, kind: string, nth = 0, posix = false) => {
  const s = meaning(src, text, nth, posix).steps.find((x) => x.kind === kind)!;
  return s.why ? [s.applies, s.why] : [s.applies];
};
const fieldsOf = (src: string, text: string, env: WordEnv | null = ENV, nth = 0, posix = false) => {
  const { node, model } = find(src, text, nth, posix);
  // (The failures are checked on their own.)
  const { failure: _, ...rest } = wordFields(node, model, env ?? undefined);
  return rest;
};

describe('words: contexts', () => {
  it('has no brace expression in the roles where bash never expands braces, whose contexts say so (unbash.ts, NO_BRACES)', () => {
    // [script, the word]: a pattern of `case`, `[[ == ]]`, `[[ ]]`, `=~`, arithmetic, an index; and the word of `${x:-…}`.
    const cases: [string, string][] = [
      ['case a in {a,b}) ;; esac', '{a,b}'], ['case a in x|{a,b}) ;; esac', '{a,b}'], ['[[ x == {a,b} ]]', '{a,b}'], ['[[ {a,b} ]]', '{a,b}'],
      ['[[ x =~ {a,b} ]]', '{a,b}'], ['echo $(( {1,2} ))', '{1,2}'], ['a[{1,2}]=x', '{1,2}'],
    ];
    for (const [src, text] of cases) {
      const { node } = find(src, text);
      assert.deepStrictEqual([CONTEXTS[wordOf(node)!.context].brace, descendants(parser.parse(src).root, ['brace_expression']).length], [false, 0], src);
    }
    assert.strictEqual(descendants(parser.parse('echo ${x:-{a,b}} ${x#{a,b}} ${a[{1,2}]}').root, ['brace_expression']).length, 0);
    // (Where bash does expand them, the context says so: an argument, a `for` list, an array's element, a redirection, an
    // assignment given to `declare`, a definition of `alias`.)
    for (const [src, text] of [['echo {a,b}', '{a,b}'], ['for i in {a,b}; do :; done', '{a,b}'], ['a=({a,b})', '{a,b}'], ['cat > {a,b}', '{a,b}'], ['declare x={a,b}', '{a,b}'], ['alias z={a,b}', 'z={a,b}']]) {
      assert.ok(bracesInContext(find(src, text).node), src);
    }
    assert.ok(!bracesInContext(find('x={a,b}', '{a,b}').node) && !bracesInContext(find('cat <<< {a,b}', '{a,b}').node));
  });

  it('finds the context of a word from where it is', () => {
    const cases: [string, string, string | undefined][] = [
      ['echo $x', '$x', 'argument'], ['$c a', '$c', undefined], ['$c a', 'c', undefined], ['x=$y', '$y', 'assignment-value'], ['a=(1 $y)', '$y', 'array-element'],
      ['declare "a"=$y', '"a"=$y', 'declaration-argument'], ['declare a=$y', '$y', 'assignment-value'], ['unset $v', '$v', 'argument'],
      ['[ $a = b ]', '$a', 'argument'], ['[ -n $a ]', '$a', 'argument'], ['[[ $a ]]', '$a', 'cond-operand'], ['[[ -n $a && $b == $p ]]', '$b', 'cond-operand'],
      ['[[ $a == $p ]]', '$p', 'cond-pattern'], ['[[ $a != $p ]]', '$p', 'cond-pattern'], ['[[ $a =~ ^$r ]]', '$r', 'cond-regex'], ['[[ $a < $b ]]', '$b', 'cond-operand'],
      ['case $x in $p) ;; esac', '$x', 'case-word'], ['case $x in $p) ;; esac', '$p', 'case-pattern'], ['for i in $l; do :; done', '$l', 'for-list'],
      ['select i in $l; do :; done', '$l', 'for-list'], ['cat > $o', '$o', 'redirect-target'], ['cat <<< $h', '$h', 'herestring'],
      ['cat <<E\n$h\nE', '$h', 'heredoc-body'], ['echo $(( $n + 1 ))', '$n', 'arith'], ['(( $n ))', '$n', 'arith'], ['for ((i=$n; i<3; i++)); do :; done', '$n', 'arith'],
      ['a[$i]=1', '$i', 'subscript-indexed'], ['echo ${a[$i]}', '$i', 'subscript-indexed'], ['echo ${u:-$w}', '$w', 'param-word'], ['echo ${s:$i:2}', '$i', 'arith'], ['echo ${u#x}', 'x', 'param-pattern'],
      ['echo "a$x"', '$x', 'argument'], ['echo $(( $(echo $n) ))', '$n', 'argument'],
      ['$c a', '$c', undefined],
      // Not words: a name, the variable of a loop, a function's name, a descriptor, a here-document's delimiter.
      ['cat 2> x', '2', undefined], ['cat <<E\nx\nE', 'E', undefined], ['case a in b) echo;; esac', 'echo', undefined], ['a[$i]=1', 'a', undefined],
      ['x=1', 'x', undefined], ['for i in 1; do :; done', 'i', undefined], ['f() { :; }', 'f', undefined], ['echo ${u:-w}', 'u', undefined],
      ['case a in b) ;; esac', 'b) ;;', undefined], ['coproc c { :; }', 'c', undefined], ['a[1]=2', 'a[1]', undefined],
    ];
    for (const [src, text, want] of cases) assert.strictEqual(context(src, text), want, `${src}: ${text}`);
    assert.strictEqual(context('$c a', '$c', 1), 'command-name');
    assert.strictEqual(wordOf(parser.parse('echo').root), undefined);
  });

  it('takes the parts of the right side of `[[ == ]]` as one word', () => {
    const w = meaning('[[ $a == $b* ]]', '$b');
    assert.deepStrictEqual(w.nodes.map((n) => n.text), ['$b', '*']);
    assert.strictEqual(meaning('[[ $a == x$b* ]]', '*').nodes.length, 3);
    assert.strictEqual(meaning('[[ $a == x ]]', 'x').nodes.length, 1);
  });

  it('has a row of the table for every context, with its section of the manual', () => {
    for (const [ctx, rule] of Object.entries(CONTEXTS)) assert.match(rule.manual, /^\d+(\.\d+)*$/, ctx);
    assert.strictEqual(meaning('x=*', '*').rule.glob, false);
  });

  it('is cached per model', () => {
    const { node, model } = find('echo $x', '$x');
    assert.strictEqual(wordMeaning(node, model), wordMeaning(node, model));
    assert.strictEqual(wordMeaning(find('x=1', 'x').node, model), undefined);
    assert.strictEqual(partMeaning(find('x=1', 'x').node, model), undefined);
  });
});

describe('words: steps', () => {
  it('splits and globs unquoted expansions where the context does', () => {
    assert.deepStrictEqual(step('echo $x', '$x', 'split'), [true]);
    assert.deepStrictEqual(step('echo "$x"', '"$x"', 'split'), [false, 'quoted']);
    assert.deepStrictEqual(step('echo a', 'a', 'split'), [false]);
    assert.deepStrictEqual(step('x=$y', '$y', 'split'), [false, 'context']);
    assert.deepStrictEqual(step('IFS=; echo $x', '$x', 'split'), [false, 'ifs-empty']);
    assert.deepStrictEqual(step('IFS=$v; echo $x', '$x', 'split'), ['unknown']);
    assert.deepStrictEqual(step('set -f; echo $x', '$x', 'glob'), [false, 'noglob']);
    assert.deepStrictEqual(step('if a; then set -f; fi; echo $x', '$x', 'glob'), ['unknown', 'noglob']);
    assert.deepStrictEqual(step('echo "$x"', '"$x"', 'glob'), [false, 'quoted']);
    assert.deepStrictEqual(step('echo a', 'a', 'glob'), [false]);
    assert.deepStrictEqual(step('echo *.txt', '*.txt', 'glob'), [true]);
  });

  it('neither splits nor globs a redirection target in POSIX mode', () => {
    assert.deepStrictEqual(step('cat > $o', '$o', 'split', 0, true), [false, 'posix-mode']);
    assert.deepStrictEqual(step('cat > *.log', '*.log', 'glob', 0, true), [false, 'posix-mode']);
    assert.deepStrictEqual(step('cat > $o', '$o', 'split'), [true]);
    assert.deepStrictEqual(step('if a; then set -o posix; fi; cat > $o', '$o', 'split'), ['unknown', 'posix-mode']);
    assert.deepStrictEqual(step('if a; then set -o posix; fi; cat > *.log', '*.log', 'glob'), ['unknown', 'posix-mode']);
  });

  it('splits the word of `${x:-word}` as the expansion around it', () => {
    assert.deepStrictEqual(step('echo ${u:-$w}', '$w', 'split'), [true]);
    assert.deepStrictEqual(step('echo "${u:-$w}"', '$w', 'split'), [false, 'quoted']);
    assert.deepStrictEqual(step('x=${u:-$w}', '$w', 'split'), [false, 'context']);
    assert.deepStrictEqual(step('echo $(( ${u:-$w} ))', '$w', 'split'), [false, 'context']);
    // (A coproc's name is not a word.)
    assert.deepStrictEqual(step('coproc ${x:-$w} { :; }', '$w', 'split'), [false, 'context']);
  });

  it('gives what happens to one expansion of a word', () => {
    const { node, model } = find('echo "$a"$b', '$b');
    assert.deepStrictEqual([partMeaning(node, model)!.split.applies, partMeaning(node, model)!.quoted], [true, false]);
    const a = find('echo "$a"$b', '$a');
    assert.deepStrictEqual(partMeaning(a.node, a.model)!.split, { kind: 'split', applies: false, why: 'quoted', parts: [], manual: '3.5.7' });
    // (A part that is no expansion: neither step acts on it.)
    const r = find('echo a$x', 'a');
    assert.deepStrictEqual(partMeaning(r.node, r.model)!.split, { kind: 'split', applies: false, parts: [], manual: '3.5.7' });
    const q = find('echo <(ls)', '<(ls)');
    assert.deepStrictEqual(partMeaning(q.node, q.model)!.split, { kind: 'split', applies: false, parts: [], manual: '3.5.7' });
    const p = find('echo ${u:-$w}', '${u:-$w}');
    assert.deepStrictEqual(partMeaning(p.node, p.model)!.glob.applies, true);
  });

  it('finds brace expansions, unless braceexpand is off', () => {
    assert.deepStrictEqual(step('echo {a,b}', '{a,b}', 'brace'), [true]);
    assert.deepStrictEqual(step('echo {1..9999}', '{1..9999}', 'brace'), [true]);
    assert.deepStrictEqual(step('set +B; echo {a,b}', '{a,b}', 'brace'), [false, 'braceexpand-off']);
    assert.deepStrictEqual(step('if a; then set +B; fi; echo {a,b}', '{a,b}', 'brace'), ['unknown', 'braceexpand-off']);
    assert.deepStrictEqual(step('x={a,b}', '{a,b}', 'brace'), [false, 'context']);
    assert.deepStrictEqual(step('echo {x}', '{x}', 'brace'), [false]);
  });

  it('finds the tilde prefixes the context and the mode expand', () => {
    const tildes = (src: string, text: string, posix = false) => meaning(src, text, 0, posix).tildes.map((t) => [t.start, t.end, t.user, t.after]);
    assert.deepStrictEqual(tildes('echo ~/a', '~/a'), [[0, 1, '', '']]);
    assert.deepStrictEqual(tildes('echo ~root ~+/x', '~root'), [[0, 5, 'root', '']]);
    assert.deepStrictEqual(tildes('echo x=~/a:~/b:c~', 'x=~/a:~/b:c~'), [[2, 3, '', '='], [6, 7, '', ':']]);
    assert.deepStrictEqual(tildes('echo x=~/a:~/b', 'x=~/a:~/b', true), []);
    assert.deepStrictEqual(tildes('echo a[1]+=~ x=a:~', 'a[1]+=~'), [[6, 7, '', '=']]);
    assert.deepStrictEqual(tildes('echo x=a\\:~', 'x=a\\:~'), []);
    assert.deepStrictEqual(tildes('x=~/a:~/b', '~/a:~/b'), [[0, 1, '', ''], [4, 5, '', ':']]);
    assert.deepStrictEqual(tildes('a=(x=~/y)', 'x=~/y'), []);
    // A prefix that is not all in the plain word: `~"x"`, `~$u`.
    assert.deepStrictEqual(tildes('echo ~"x"', '~"x"'), []);
    assert.deepStrictEqual(tildes('echo ~$u', '~$u'), []);
    assert.deepStrictEqual(tildes('echo ~/$u', '~/$u'), [[0, 1, '', '']]);
    assert.deepStrictEqual(tildes('echo "~"', '"~"'), []);
    assert.deepStrictEqual(tildes('echo $(( ~1 ))', '~1'), []);
    assert.deepStrictEqual(tildes('x=a:~\\x', 'a:~\\x'), []);
  });

  it('knows the IFS and the glob options where the word is', () => {
    assert.deepStrictEqual(meaning('echo $x', '$x').ifs, { kind: 'default' });
    assert.deepStrictEqual(meaning('unset IFS; echo $x', '$x').ifs, { kind: 'default' });
    assert.strictEqual(meaning("IFS=:; echo $x", '$x').ifs.kind, 'value');
    const g = meaning('shopt -s nullglob extglob; GLOBIGNORE=a; echo *', '*').glob;
    assert.deepStrictEqual([g.nullglob, g.extglob, g.dotglob, g.failglob, g.globignore], ['on', 'on', 'on', 'off', { value: 'a' }]);
    assert.strictEqual(meaning('GLOBIGNORE=$x; echo *', '*').glob.globignore, 'unknown');
    assert.strictEqual(meaning('GLOBIGNORE=; echo *', '*').glob.globignore, 'unset');
  });

  it('has the value of a word with nothing to expand', () => {
    assert.strictEqual(meaning("echo a'b'\"c\"\\d", "a'b'\"c\"\\d").value, 'abcd');
    assert.strictEqual(meaning('echo $x', '$x').value, undefined);
    assert.strictEqual(meaning('echo *', '*').value, undefined);
    assert.deepStrictEqual(meaning("echo 'a'", "'a'").steps.find((s) => s.kind === 'quote-removal')!.applies, true);
  });
});

const underscore = (src: string) => {
  const { node, model } = find(src, '$_');
  return underscoreValue(node, model);
};

describe('words: fields', () => {
  it('splits on IFS as bash does', () => {
    assert.deepStrictEqual(fieldsOf("x=' a  b '; echo $x", '$x').fields, ['a', 'b']);
    assert.deepStrictEqual(fieldsOf("IFS=:; x=':a::b:'; echo $x", '$x').fields, ['', 'a', '', 'b']);
    assert.deepStrictEqual(fieldsOf("IFS=' :'; x=' : b'; echo $x", '$x').fields, ['', 'b']);
    assert.deepStrictEqual(fieldsOf("x=''; echo $x", '$x').fields, []);
    assert.deepStrictEqual(fieldsOf("x=''; echo $x''", "$x''").fields, ['']);
    assert.deepStrictEqual(fieldsOf("x='a b'; IFS=; echo $x", '$x').fields, ['a b']);
    assert.deepStrictEqual(fieldsOf('x=; IFS=; echo $x', '$x').fields, []);
    // An IFS not known here: unknown, unless nothing is split.
    assert.deepStrictEqual(fieldsOf("IFS=$v; x='a b'; echo $x", '$x'), {});
    assert.deepStrictEqual(fieldsOf("IFS=$v; x=''; echo $x a", '$x'), { fields: [] });
  });

  it('gives the value of a variable, or says it is not known', () => {
    assert.deepStrictEqual(fieldsOf('echo $nope', '$nope').fields, []);
    assert.deepStrictEqual(fieldsOf('echo "$NOPE"', '"$NOPE"'), {});
    assert.deepStrictEqual(fieldsOf('echo "$HOME"', '"$HOME"').fields, ['/home/probe']);
    assert.deepStrictEqual(fieldsOf('echo "$RANDOM"', '"$RANDOM"'), {});
    assert.deepStrictEqual(fieldsOf('echo "$nope"', '"$nope"', null), {});
    assert.deepStrictEqual(fieldsOf('declare x; echo "$x"', '"$x"').fields, ['']);
    assert.deepStrictEqual(fieldsOf('if a; then x=1; fi; echo "$x"', '"$x"'), {});
    assert.deepStrictEqual(fieldsOf('a=(1); echo "$a"', '"$a"'), {});
    assert.deepStrictEqual(fieldsOf('declare -n r=x; echo "$r"', '"$r"'), {});
    assert.deepStrictEqual(fieldsOf('echo "$1" "$@"', '"$1"'), {});
    assert.deepStrictEqual(fieldsOf('x=1; (( x++ )); echo "$x"', '"$x"').fields, ['2']);
    assert.deepStrictEqual(fieldsOf('x=1; let x+=1; echo "$x"', '"$x"').fields, ['2']);
    assert.deepStrictEqual(fieldsOf('x=1; : $(( x *= 3 )); echo "$x"', '"$x"').fields, ['3']);
    // Double quotes in `(( ))` are removed (bash prints 1); bash changes RANDOM itself.
    assert.deepStrictEqual(fieldsOf('u=0; (( "u=1" )); echo $u', '$u').fields, ['1']);
    assert.deepStrictEqual(fieldsOf('RANDOM=1; echo "$RANDOM"', '"$RANDOM"'), {});
    // (In the statement that assigns it, the state is the one before it.)
    assert.deepStrictEqual(fieldsOf('x=1; echo $(( ++x )) "$x"', '"$x"'), {});
    assert.deepStrictEqual(fieldsOf('x=1; echo $(( ++x )) "$(echo "$x")"', '"$x"'), {});
    // A simple command expands its words before its redirections (bash prints <1>).
    assert.deepStrictEqual(fieldsOf('x=1; printf "<%s>" "$x" 2>/dev/null > g$(( x *= 5 ))', '"$x"').fields, ['1']);
    // Also written before the name, and after assignments alone (bash prints <1>, and `z` is 1).
    assert.deepStrictEqual(fieldsOf('x=1; >g$(( x *= 5 )) printf "<%s>" "$x"', '"$x"').fields, ['1']);
    assert.deepStrictEqual(fieldsOf('y=1; z=$y >g$(( y *= 5 )); echo "$z"', '"$z"').fields, ['1']);
    // (In the redirection itself, what it assigns is not known.)
    assert.deepStrictEqual(fieldsOf('x=1; printf a > g$(( x *= 5 ))$x', '$x'), {});
    assert.deepStrictEqual(wordFields(find('x=1', 'x').node, find('x=1', 'x').model), {});
    assert.deepStrictEqual(fieldsOf('x=1; : ${x:=2}; echo "$x"', '"$x"'), {});
    assert.deepStrictEqual(fieldsOf('x=1; let y=1; echo "$x"', '"$x"').fields, ['1']);
  });

  it('takes `$(true)` for empty only where `true` runs the builtin', () => {
    // (bash prints `a` for each of the redefined ones.)
    for (const def of ['true() { echo a; }', 'shopt -s expand_aliases\nalias true="echo a"\n']) {
      const src = `${def}; x=$(true); echo "$x" "$(true)"`.replace('\n;', '\n');
      assert.strictEqual(execFileSync('bash', ['-c', src]).toString(), 'a a\n', src);
      assert.deepStrictEqual(fieldsOf(src, '"$x"'), {}, src);
      assert.deepStrictEqual(fieldsOf(src, '"$(true)"'), {}, src);
    }
    assert.deepStrictEqual(fieldsOf('x=$(true); echo "$x" "$(true)"', '"$x"').fields, ['']);
    assert.deepStrictEqual(fieldsOf('x=$(true); echo "$x" "$(true)"', '"$(true)"').fields, ['']);
  });

  it('expands the word of an assignment whose value is not static, where it ran', () => {
    assert.deepStrictEqual(fieldsOf("y='a  b'; x=$y; y=c; echo \"$x\"", '"$x"').fields, ['a  b']);
    assert.deepStrictEqual(fieldsOf('x=$y; y=$x; echo "$y"', '"$y"').fields, ['']);
    assert.deepStrictEqual(fieldsOf('x=$x; echo "$x"', '"$x"').fields, ['']);
    assert.deepStrictEqual(fieldsOf('declare -i x=$y; echo "$x"', '"$x"'), {});
    assert.deepStrictEqual(fieldsOf('for i in 1 2; do x=$i; done; echo "$x"', '"$x"'), {});
  });

  it('expands `$_` after an assignment to nothing', () => {
    assert.deepStrictEqual(fieldsOf('x=1\necho "$_"', '"$_"').fields, ['']);
    assert.deepStrictEqual(fieldsOf('echo a\necho "$_"', '"$_"'), {});
    assert.strictEqual(underscore('x=1; y=$(z=1); f() { a=1; }; ( b=1 ); echo $_'), '');
    assert.strictEqual(underscore('echo $_'), undefined);
    assert.strictEqual(underscore('x=1 cmd; echo $_'), undefined);
    assert.strictEqual(underscore('declare x=1; echo $_'), undefined);
    assert.strictEqual(underscore('x=1 y=2\necho $_'), '');
  });

  it('fails as bash does under `set -u`', () => {
    assert.deepStrictEqual(fieldsOf('set -u; echo $nope', '$nope'), { error: 'unbound' });
    assert.deepStrictEqual(fieldsOf('set -u; echo ${#nope}', '${#nope}'), { error: 'unbound' });
    assert.deepStrictEqual(fieldsOf('set -u; echo ${nope-x}', '${nope-x}').fields, ['x']);
    assert.deepStrictEqual(fieldsOf('if a; then set -u; fi; echo $nope', '$nope'), {});
    assert.deepStrictEqual(fieldsOf('set -u; echo ${x#$nope}', '${x#$nope}', { variables: { x: 'a' } }), { error: 'unbound' });
    assert.deepStrictEqual(fieldsOf('echo ${#nope}', '${#nope}').fields, ['0']);
  });

  it('expands the forms of `${…}` whose value follows from known values', () => {
    const env: WordEnv = { ...ENV, variables: { ...PROBE_ENV, x: 'abc.tar.gz', e: '', n: 'x', m: 'a b' } };
    const cases: [string, string[] | undefined][] = [
      ['${x}', ['abc.tar.gz']], ['${#x}', ['10']], ['${!n}', ['abc.tar.gz']], ['${!m}', undefined], ['${!u}', undefined], ['${!n@}', undefined],
      ['${e:-d}', ['d']], ['${e-d}', []], ['${u-d}', ['d']], ['${x:+y}', ['y']], ['${e:+y}', []], ['${u+y}', []], ['${e+y}', ['y']],
      // (A `${x:=y}` assigns: the model does not follow its variable.)
      ['${x:=y}', undefined], ['${x?m}', ['abc.tar.gz']],
      ['${x:1:2}', ['bc']], ['${x: -2}', ['gz']], ['${x:2}', ['c.tar.gz']], ['${x:1:-2}', ['bc.tar.']], ['${x: -20}', []], ['${x:$o}', undefined], ['${x:1:$l}', undefined],
      ['${x^^}', ['ABC.TAR.GZ']], ['${x^}', ['Abc.tar.gz']], ['${x,,}', ['abc.tar.gz']], ['${m,}', ['a', 'b']], ['${x^^[a]}', undefined],
      ['${x%.*}', ['abc.tar']], ['${x%%.*}', ['abc']], ['${x#*.}', ['tar.gz']], ['${x##*.}', ['gz']], ['${x#z}', ['abc.tar.gz']], ['${x%q}', ['abc.tar.gz']], ['${x%z}', ['abc.tar.g']],
      ['${x#"a"}', ['bc.tar.gz']], ["${x#'*'}", ['abc.tar.gz']], ['${x#\\a}', ['bc.tar.gz']], ['${x#@(a)}', undefined], ['${x#$(a)}', undefined], ['${x#[}', ['abc.tar.gz']],
      ['${x/a/X}', ['Xbc.tar.gz']], ['${x//a/X}', ['Xbc.tXr.gz']], ['${x/#a/X}', ['Xbc.tar.gz']], ['${x/#b/X}', ['abc.tar.gz']], ['${x/%gz/X}', ['abc.tar.X']], ['${x/%a/X}', ['abc.tar.gz']],
      ['${x/q/X}', ['abc.tar.gz']], ['${x//./}', ['abctargz']], ['${x/a/&}', undefined], ["${x/a/'&'}", ['&bc.tar.gz']], ['${x/*/X}', undefined], ['${x/a/$m}', ['a', 'bbc.tar.gz']],
      ['${x/a/`b`}', undefined], ['${x@U}', undefined], ['${a[1]}', undefined], ['${u:?m}', undefined], ['${e?}', []], ['"${e?}"', ['']],
    ];
    for (const [w, want] of cases) {
      const r = fieldsOf(`echo ${w}`, w, env);
      if (want) assert.deepStrictEqual(r.fields, want, w);
      else assert.ok(!r.fields, w);
    }
    assert.deepStrictEqual(fieldsOf('echo ${u:?m}', '${u:?m}', env), { error: 'parameter-null' });
    // "substring expression < 0": bash fails, and the command does not run.
    assert.deepStrictEqual(fieldsOf('echo ${x:2:-9}', '${x:2:-9}', env), { error: 'substring' });
    // Text other than ASCII is read by the locale (src/semantics/chars.ts): `$'é'` is `é` in a UTF-8 locale, `é` in C.
    assert.deepStrictEqual(fieldsOf("echo $'\\u00e9'", "$'\\u00e9'", env), {});
    assert.deepStrictEqual(fieldsOf("echo $'a\\u0041'", "$'a\\u0041'", env).fields, ['aA']);
    assert.deepStrictEqual(fieldsOf('echo "${x/a/"&"}"', '"${x/a/"&"}"', env).fields, ['&bc.tar.gz']);
    assert.deepStrictEqual(fieldsOf('echo "${x#\\a}"', '"${x#\\a}"', env).fields, ['bc.tar.gz']);
    assert.deepStrictEqual(fieldsOf('echo "${x#"$n"}"', '"${x#"$n"}"', env).fields, ['abc.tar.gz']);
    assert.deepStrictEqual(fieldsOf("echo \"${x#'a'}\"", "\"${x#'a'}\"", env).fields, ['bc.tar.gz']);
    assert.deepStrictEqual(fieldsOf("echo \"${u:-'q'} ${u:-\\a} ${u:-\"q\"}\"", "\"${u:-'q'} ${u:-\\a} ${u:-\"q\"}\"", env).fields, ["'q' \\a q"]);
    assert.deepStrictEqual(fieldsOf('echo ${x#$p}', '${x#$p}', env).fields, ['abc.tar.gz']);
    assert.deepStrictEqual(fieldsOf('p="a*"; echo "${x#$p}"', '"${x#$p}"', env).fields, ['bc.tar.gz']);
    assert.deepStrictEqual(fieldsOf('echo ${x#"$p"}', '${x#"$p"}', env).fields, ['abc.tar.gz']);
    assert.deepStrictEqual(fieldsOf('echo ${x#"a\\"}', '${x#"a\\"}', env).fields, ['abc.tar.gz']);
    assert.deepStrictEqual(fieldsOf("echo ${x#$'\\x61'}", "${x#$'\\x61'}", env).fields, ['bc.tar.gz']);
    assert.deepStrictEqual(fieldsOf("echo ${x#$'\\xff'}", "${x#$'\\xff'}", env), {});
    assert.deepStrictEqual(fieldsOf('echo ${x#$}', '${x#$}', env), {});
    assert.deepStrictEqual(fieldsOf('p=a; echo ${x#${p}}', '${x#${p}}', env).fields, ['bc.tar.gz']);
    assert.deepStrictEqual(fieldsOf('echo ${x#$P}', '${x#$P}', env), {});
    assert.deepStrictEqual(fieldsOf('if a; then set -u; fi; echo ${x#$nope}', '${x#$nope}', env), {});
    assert.deepStrictEqual(fieldsOf('echo ${x:-a\nb}'.replace('\\n', '\n'), '${x:-a\nb}'.replace('\\n', '\n'), env), {});
    assert.deepStrictEqual(fieldsOf('echo ${#v}', '${#v}', null), {});
    assert.deepStrictEqual(fieldsOf('echo ${v:1}', '${v:1}', null), {});
    assert.deepStrictEqual(fieldsOf('echo ${nope:1}', '${nope:1}', env).fields, []);
    assert.deepStrictEqual(fieldsOf('echo ${x:}', '${x:}', env), {});
    assert.deepStrictEqual(fieldsOf('echo ${!n}', '${!n}', { variables: { n: 'NOPE' } }), {});
    assert.deepStrictEqual(fieldsOf('echo ${!n}', '${!n}', { variables: { n: 'nope' } }).fields, []);
    assert.deepStrictEqual(fieldsOf('echo ${x#[z-a]bc}', '${x#[z-a]bc}', env).fields, ['abc.tar.gz']);
  });

  it('reads the word of `${x:-word}` with its quotes and tilde', () => {
    const cases: [string, string[] | undefined][] = [
      ['${u:-~/x}', ['/home/probe/x']], ['"${u:-~/x}"', ['~/x']], ['${u:-~nope}', undefined], ['${u:-~$v}', undefined], ['${u:-a b}', ['a', 'b']],
      ["${u:-'a b'}", ['a b']], ['${u:-"a b"}', ['a b']], ['${u:-a\\ b}', ['a b']], ['"${u:-\\a\\$}"', ['\\a$']], ['${u:-$HOME}', ['/home/probe']],
      ['${u:-$(x)}', undefined], ["${u:-'a}", undefined], ['${u:-"a}', undefined], ["${u:-$'a}", undefined], ['${u:-"$(x)"}', undefined], ['${u:-*.log}', ['c.log']],
    ];
    for (const [w, want] of cases) {
      const r = fieldsOf(`echo ${w}`, w);
      if (want) assert.deepStrictEqual(r.fields, want, w);
      else assert.ok(!r.fields, w);
    }
  });

  it('expands tildes, braces, quotes and constants', () => {
    assert.deepStrictEqual(fieldsOf('echo ~ ~+ ~-', '~').fields, ['/home/probe']);
    assert.deepStrictEqual(fieldsOf('echo ~+/x', '~+/x').fields, ['/BOX/x']);
    assert.deepStrictEqual(fieldsOf('echo ~-', '~-'), {});
    assert.deepStrictEqual(fieldsOf('OLDPWD=/o; echo ~-', '~-').fields, ['/o']);
    assert.deepStrictEqual(fieldsOf('HOME=$h; echo ~', '~', { files: [] }), {});
    assert.deepStrictEqual(fieldsOf('echo ~', '~', null), {});
    assert.deepStrictEqual(fieldsOf('echo x=~/a:~/b', 'x=~/a:~/b').fields, ['x=/home/probe/a:/home/probe/b']);
    assert.deepStrictEqual(fieldsOf('echo ~/x/{a,b}', '~/x/{a,b}').fields, ['/home/probe/x/a', '/home/probe/x/b']);
    assert.deepStrictEqual(fieldsOf('echo {~,~nope}/x', '{~,~nope}/x'), {});
    assert.deepStrictEqual(fieldsOf('echo {a,b}{1..2}', '{a,b}{1..2}').fields, ['a1', 'a2', 'b1', 'b2']);
    assert.deepStrictEqual(fieldsOf('echo a{b,c}d', 'a{b,c}d').fields, ['abd', 'acd']);
    assert.deepStrictEqual(fieldsOf('echo {1..9999}', '{1..9999}'), {});
    assert.deepStrictEqual(fieldsOf('echo {a,b}$x', '{a,b}$x').fields, ['a', 'b']);
    assert.deepStrictEqual(fieldsOf('if a; then set +B; fi; echo {a,b}', '{a,b}'), {});
    assert.deepStrictEqual(fieldsOf('set +B; echo {a,b}', '{a,b}').fields, ['{a,b}']);
    assert.deepStrictEqual(fieldsOf("echo $'a\\tb' $\"c\" \"d\\\"e\\\\\"", "$'a\\tb'").fields, ['a\tb']);
    assert.deepStrictEqual(fieldsOf("echo $'\\xff'", "$'\\xff'"), {});
    assert.deepStrictEqual(fieldsOf('echo $"c $HOME"', '$"c $HOME"').fields, ['c /home/probe']);
    assert.deepStrictEqual(fieldsOf('echo "d\\"e\\\\\\$"', '"d\\"e\\\\\\$"').fields, ['d"e\\$']);
    assert.deepStrictEqual(fieldsOf('echo a\\\nb', 'a\\\nb').fields, ['ab']);
    assert.deepStrictEqual(fieldsOf('echo "a\\\nb"', '"a\\\nb"').fields, ['ab']);
    assert.deepStrictEqual(fieldsOf('echo {\\*,b}', '{\\*,b}').fields, ['*', 'b']);
    assert.deepStrictEqual(fieldsOf('echo {~\\x,~/y}', '{~\\x,~/y}').fields, ['~x', '/home/probe/y']);
    assert.deepStrictEqual(fieldsOf('unset HOME; echo ~', '~'), {});
    assert.deepStrictEqual(fieldsOf('echo $((1+2)) $[3]', '$((1+2))').fields, ['3']);
    assert.deepStrictEqual(fieldsOf('echo $[3]', '$[3]').fields, ['3']);
    assert.deepStrictEqual(fieldsOf('echo $((n))', '$((n))'), {});
    assert.deepStrictEqual(fieldsOf('echo $(:)a', '$(:)a').fields, ['a']);
    assert.deepStrictEqual(fieldsOf('echo $(ls)', '$(ls)'), {});
    assert.deepStrictEqual(fieldsOf('echo <(ls)', '<(ls)'), {});
  });

  it('globs with the options in effect', () => {
    const g = (src: string, text: string) => fieldsOf(src, text).fields;
    assert.deepStrictEqual(g('echo *.txt', '*.txt'), ['a.txt', 'b.txt', 'x y.txt']);
    assert.deepStrictEqual(g('echo "*".txt', '"*".txt'), ['*.txt']);
    assert.deepStrictEqual(g('echo \\*', '\\*'), ['*']);
    assert.deepStrictEqual(g('echo */', '*/'), ['empty/', 'sub/']);
    assert.deepStrictEqual(g('x="*"; echo "$x"$x', '"$x"$x'), ['**']);
    assert.deepStrictEqual(g('set -f; echo *', '*'), ['*']);
    assert.deepStrictEqual(g('shopt -s nullglob; echo *.zz', '*.zz'), []);
    assert.deepStrictEqual(fieldsOf('shopt -s failglob; echo *.zz', '*.zz'), { error: 'no-match' });
    assert.deepStrictEqual(g('GLOBIGNORE=*.txt:sub; echo *', '*'), ['.hidden', 'c.log', 'empty']);
    assert.deepStrictEqual(g('x=*; echo $x', '$x'), ['a.txt', 'b.txt', 'c.log', 'empty', 'sub', 'x y.txt']);
    assert.deepStrictEqual(fieldsOf('if a; then set -f; fi; echo *', '*'), {});
    assert.deepStrictEqual(fieldsOf('echo *', '*', { variables: {} }), {});
    assert.deepStrictEqual(fieldsOf('echo @(a).txt', '@(a).txt'), {});
    assert.deepStrictEqual(fieldsOf('if a; then shopt -s nullglob; fi; echo *', '*'), {});
    assert.deepStrictEqual(fieldsOf('GLOBIGNORE=$v; echo *', '*'), {});
    assert.deepStrictEqual(fieldsOf('x="[["; echo $x', '$x').fields, ['[[']);
    assert.deepStrictEqual(fieldsOf('x="a(b"; shopt -s extglob; echo !$x', '!$x').fields, ['!a(b']);
    assert.deepStrictEqual(fieldsOf('shopt -s extglob; x="!(*)"; echo $x', '$x').fields, ['!(*)']);
    assert.deepStrictEqual(fieldsOf('shopt -s extglob; x="!(*.txt)"; echo $x', '$x').fields, ['c.log', 'empty', 'sub']);
    assert.deepStrictEqual(fieldsOf('shopt -s extglob; x="!(a)*"; echo $x', '$x'), {});
  });

  it('gives one field, or none, where bash does not split', () => {
    assert.deepStrictEqual(fieldsOf("x='a  *'; y=$x; echo \"$y\"", '"$y"').fields, ['a  *']);
    assert.deepStrictEqual(fieldsOf('x=; cat <<< $x', '$x').fields, ['']);
    assert.deepStrictEqual(fieldsOf('cat <<E\na \\$ \\" $HOME\nE', 'a \\$ \\" $HOME\n').fields, ['a $ \\" /home/probe\n']);
    assert.deepStrictEqual(fieldsOf("cat <<'E'\na \\$ $HOME\nE", 'a \\$ $HOME\n').fields, ['a \\$ $HOME\n']);
  });

  it('reads a word in backquotes after bash removes the backslashes before `$`, a backquote and a backslash', () => {
    const bash = (src: string): string => execFileSync('bash', ['--norc', '--noprofile', '-c', `${src}; echo "$x"`]).toString();
    const printed = (tree: ReturnType<typeof parser.parse>): (string[] | undefined)[] => {
      const model = shellState(tree, 'bash');
      const printf = descendants(tree.root, ['command']).find((c) => c.namedChildren[0].text === 'printf')!;
      return printf.namedChildren.slice(2).map((w) => wordFields(w, model, ENV).fields);
    };
    assert.strictEqual(bash('b=B; x=`printf "<%s>" \'a\\$b\' a\\$b "a\\$b" "a\\\\\\$b" \'a\\`b\' "\\\\\\\\" ${u:-a\\$b} "${u:-\\$b}"`'), '<a$b><aB><aB><a$b><a`b><\\><aB><B>\n');
    assert.deepStrictEqual(printed(parser.parse('b=B; x=`printf "<%s>" \'a\\$b\' a\\$b "a\\$b" "a\\\\\\$b" \'a\\`b\' "\\\\\\\\" ${u:-a\\$b} "${u:-\\$b}"`')),
      [['a$b'], ['aB'], ['aB'], ['a$b'], ['a`b'], ['\\'], ['aB'], ['B']]);
    // In double quotes, also the backslash before a double quote; in a here-document, the body as bash reads it.
    assert.strictEqual(bash('x="`printf "<%s>" \'a\\"b\'`"'), '<a"b>\n');
    assert.deepStrictEqual(printed(parser.parse('x="`printf "<%s>" \'a\\"b\'`"')), [['a"b']]);
    assert.strictEqual(bash("x=`cat <<'E'\na\\$b\nE`"), 'a$b\n');
    assert.deepStrictEqual(fieldsOf("x=`cat <<'E'\na\\$b\nE`", 'a\\$b\n').fields, ['a$b\n']);
  });

  it('gives an ambiguous redirection for a target that is not one word', () => {
    assert.deepStrictEqual(fieldsOf("x='a b'; cat > $x", '$x'), { error: 'ambiguous-redirect' });
    assert.deepStrictEqual(fieldsOf('x=; cat > $x', '$x'), { error: 'ambiguous-redirect' });
    assert.deepStrictEqual(fieldsOf('cat > *.log', '*.log').fields, ['c.log']);
    assert.deepStrictEqual(fieldsOf("x='a b'; cat > $x", '$x', ENV, 0, true).fields, ['a b']);
  });
});

(probeSkipReason ? describe.skip : describe)(`words: what a here-string and a here-document give, against bash${probeSkipReason ? ` (${probeSkipReason})` : ''}`, function () {
  this.timeout(20000);
  const cases = [
    "x='a  *.txt'; @PROBE:a@ <<< $x",
    "x='a  b'; @PROBE:a@ <<< ~/$x\"$x\"",
    "@PROBE:a@ <<< {a,b}*",
    'x=1; @PROBE:a@ <<E\n$x ~ {a,b} * \\$x \\" \\\\\nE',
    "@PROBE:a@ <<'E'\n$HOME \\$x\nE",
  ];
  for (const snippet of cases) {
    it(JSON.stringify(snippet), async () => {
      const run = await runProbe(snippet, `{ printf '%s\\0' "$1"; cat; printf '\\0\\x1e'; } >>LOG`);
      const tree = parser.parse(snippet.replace('@PROBE:a@', '__probe a'));
      const model = shellState(tree, 'bash');
      const target = descendants(tree.root, ['herestring_redirect', 'heredoc_body'])[0];
      const word = target.type === 'herestring_redirect' ? target.namedChildren[0] : target;
      const { fields } = wordFields(word, model, ENV);
      assert.deepStrictEqual(fields!.map((f) => (target.type === 'herestring_redirect' ? `${f}\n` : f)), [run.records[0][1]]);
    });
  }
});

describe('words: after the review', () => {
  it('expands a tilde after each `:` of an assignment, whatever starts the word', () => {
    const tildes = (src: string, text: string, posix = false) => meaning(src, text, 0, posix).tildes.map((t) => [t.node.text, t.start, t.after]);
    assert.deepStrictEqual(tildes('PATH=$PATH:~/bin:~/x', '$PATH:~/bin:~/x'), [[':~/bin:~/x', 1, ':'], [':~/bin:~/x', 7, ':']]);
    assert.deepStrictEqual(tildes('x="a:"~/b', '"a:"~/b'), []);
    assert.deepStrictEqual(tildes('x=a"b":~/c', 'a"b":~/c'), [[':~/c', 1, ':']]);
    assert.deepStrictEqual(tildes('x=a:"~/b"', 'a:"~/b"'), []);
    assert.deepStrictEqual(tildes('echo x=$P:~/bin', 'x=$P:~/bin'), [[':~/bin', 1, ':']]);
    assert.deepStrictEqual(tildes('echo $P:~/bin', '$P:~/bin'), []);
    assert.strictEqual(staticWordValue(find('x="a"~/b', '"a"~/b').node, true), 'a~/b');
    assert.strictEqual(staticWordValue(find('x=a:~/b', 'a:~/b').node, true), undefined);
    assert.strictEqual(staticWordValue(find('echo a"b"~', 'a"b"~').node), 'ab~');
  });

  // (Checked with bash 5.2 and nullglob, in test/fixtures/probes/words.json: `[ a[ x\[y]` stay, `[]`, `a["b"]` are patterns.)
  it('takes a `[` with no `]` after it as text, as bash does: no pattern', () => {
    const value = (src: string, text: string) => staticWordValue(find(src, text).node);
    assert.strictEqual(value('echo [ x', '['), '[');
    assert.strictEqual(value('echo a[', 'a['), 'a[');
    assert.strictEqual(value('echo x\\[y]', 'x\\[y]'), 'x[y]');
    assert.strictEqual(value('echo []', '[]'), undefined);
    assert.strictEqual(value('echo [a]', '[a]'), undefined);
    assert.strictEqual(value('echo a["b"]', 'a["b"]'), undefined);
  });

  it('expands a tilde after `=` in `case`, `[[ ]]` and redirection targets in bash mode, and in declarations always', () => {
    const after = (src: string, text: string, posix = false) => meaning(src, text, 0, posix).tildes.map((t) => t.after);
    assert.deepStrictEqual(after('case a=~/d in x) ;; esac', 'a=~/d'), ['=']);
    assert.deepStrictEqual(after('case x in a=~/d) ;; esac', 'a=~/d'), ['=']);
    assert.deepStrictEqual(after('[[ a=~/e == b=~/f ]]', 'b=~/f'), ['=']);
    assert.deepStrictEqual(after('cat > a=~/b', 'a=~/b'), ['=']);
    assert.deepStrictEqual(after('cat > a=~/b', 'a=~/b', true), []);
    assert.deepStrictEqual(after('cat <<< a=~/b', 'a=~/b'), []);
    assert.deepStrictEqual(after('x=1 declare y=~/a:~/b', '~/a:~/b', true), ['', ':']);
    assert.deepStrictEqual(after('alias y=~/a:~/b', 'y=~/a:~/b', true), ['=', ':']);
    assert.deepStrictEqual(after('\\declare y=~/a:~/b', 'y=~/a:~/b', true), []);
  });

  it('reads `x=1 declare y=$v` as a declaration, by the spelling of its first word, and arithmetic in `$( (( )) )`', () => {
    // (bash 5.2: after `declare` written so, an assignment is one, not split; `\declare`, `command declare` split it.)
    assert.strictEqual(context('x=1 declare y=$v z', '$v'), 'assignment-value');
    assert.strictEqual(context('>o declare y=$v z', '$v'), 'assignment-value');
    assert.strictEqual(context('x=1 declare y=$v z', 'z'), 'declaration-argument');
    assert.strictEqual(context('x=1 declare "y"=$v', '"y"=$v'), 'declaration-argument');
    assert.strictEqual(context('declare y=$v', '$v'), 'assignment-value');
    assert.strictEqual(context('x=1 command declare y=$v', 'y=$v'), 'argument');
    assert.strictEqual(context('\\declare y=$v', 'y=$v'), 'argument');
    assert.strictEqual(context('"declare" y=$v', 'y=$v'), 'argument');
    assert.strictEqual(context('x=1 echo y=$v', 'y=$v'), 'argument');
    // (`alias` is marked too: its definitions are not split. Not `\alias`.)
    assert.strictEqual(context('alias y=$v', 'y=$v'), 'declaration-assignment');
    assert.strictEqual(context('\\alias y=$v', 'y=$v'), 'argument');
    assert.deepStrictEqual(step('x=1 declare y=$v', '$v', 'split'), [false, 'context']);
    assert.deepStrictEqual(step('\\declare y=$v', 'y=$v', 'split'), [true]);
    assert.strictEqual(context('[[ $( (( $x )) ) ]]', '$x'), 'arith');
    assert.strictEqual(context('echo $(( $(echo $x) ))', '$x'), 'argument');
  });

  it('tells an associative subscript from an indexed one', () => {
    assert.strictEqual(meaning('declare -A m; m[$k]=1', '$k').context, 'subscript-assoc');
    assert.strictEqual(meaning('m[$k]=1', '$k').context, 'subscript-indexed');
  });

  it('gives each step its section of the manual', () => {
    const w = meaning('echo $x', '$x');
    assert.deepStrictEqual(w.steps.map((s) => s.manual), ['3.5.1', '3.5.2', '3.5.3', '3.5.4', '3.5.5', '3.5.6', '3.5.7', '3.5.8', '3.5.9']);
    assert.strictEqual(meaning('cat > $o', '$o', 0, true).steps.find((s) => s.kind === 'split')!.manual, '6.11');
  });

  it('says how bash may fail on a word', () => {
    const failure = (src: string, text: string, env: WordEnv | null = ENV) => {
      const { node, model } = find(src, text);
      return [wordMeaning(node, model)!.failure, wordFields(node, model, env ?? undefined).failure];
    };
    assert.deepStrictEqual(failure('set -u; echo $nope', '$nope'), [{ kind: 'fatal', applies: 'unknown' }, { kind: 'fatal', applies: true }]);
    assert.deepStrictEqual(failure('set -u; echo "$NOPE"', '"$NOPE"'), [{ kind: 'fatal', applies: 'unknown' }, { kind: 'fatal', applies: 'unknown' }]);
    assert.deepStrictEqual(failure('echo ${u:?m}', '${u:?m}'), [{ kind: 'fatal', applies: 'unknown' }, { kind: 'fatal', applies: true }]);
    assert.deepStrictEqual(failure('shopt -s failglob; echo *.zz', '*.zz'), [{ kind: 'fatal', applies: 'unknown' }, { kind: 'fatal', applies: true }]);
    assert.deepStrictEqual(failure("x='a b'; cat > $x", '$x'), [{ kind: 'command', applies: 'unknown' }, { kind: 'command', applies: true }]);
    assert.deepStrictEqual(failure('cat > $x', '$x', null), [{ kind: 'command', applies: 'unknown' }, { kind: 'command', applies: 'unknown' }]);
    assert.deepStrictEqual(failure('cat > a', 'a'), [undefined, undefined]);
    assert.deepStrictEqual(failure('echo $x *', '$x'), [undefined, undefined]);
  });

  it('expands a long chain of assignments without running out of stack', function () {
    this.timeout(20000);
    const lines = ['a0=x'];
    for (let i = 1; i <= 1000; i++) lines.push(`a${i}=$a${i - 1}`);
    lines.push('echo "$a1000" "$a20"');
    const tree = parser.parse(lines.join('\n'));
    const model = shellState(tree, 'bash');
    const words = descendants(tree.root, ['string']);
    const t = Date.now();
    assert.deepStrictEqual(wordFields(words[0], model, ENV), {});
    assert.deepStrictEqual(wordFields(words[1], model, ENV).fields, ['x']);
    // Every word, as the explanations ask for them, reuses what was expanded.
    for (const w of descendants(tree.root, ['simple_expansion'])) wordFields(w, model, ENV);
    assert.ok(Date.now() - t < 3000, `${Date.now() - t} ms`);
  });

  it('expands sources without an environment, and knows commands with no name', () => {
    assert.deepStrictEqual(fieldsOf('y=a; x=$y; echo "$x"', '"$x"', null).fields, ['a']);
    assert.deepStrictEqual(fieldsOf('x=1 > f; echo ~+', '~+').fields, ['/BOX']);
  });

  it('knows nocasematch in `${x/p/r}`, and globskipdots', () => {
    assert.deepStrictEqual(fieldsOf('shopt -s nocasematch; x=ABC; echo ${x/b/-} ${x#a}', '${x/b/-}').fields, ['A-C']);
    assert.deepStrictEqual(fieldsOf('shopt -s nocasematch; x=ABC; echo ${x#a}', '${x#a}').fields, ['ABC']);
    assert.deepStrictEqual(fieldsOf('if a; then shopt -s nocasematch; fi; x=ABC; echo ${x/b/-}', '${x/b/-}'), {});
    assert.deepStrictEqual(fieldsOf('if a; then shopt -u globskipdots; fi; echo .*', '.*'), {});
    assert.deepStrictEqual(fieldsOf('shopt -u globskipdots; echo sub/.*', 'sub/.*'), {});
    assert.deepStrictEqual(fieldsOf('shopt -s extglob; echo ./!(a)*', './!(a)*'), {});
  });
});
