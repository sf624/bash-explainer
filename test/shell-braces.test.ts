// Brace expansion by shell where a word's value matters: `unset {a,b}` and `local {a,b}` (the names bash passes), `trap
// {x,EXIT}` (a text in dash, not "known only when it runs"). Each case is compared with the real shell; dash is skipped
// when it is not installed.
import * as assert from 'assert';
import { spawnSync } from 'child_process';
import { staticWordValue } from '../src/staticword';
import { shellState } from '../src/semantics/state';
import { wordFields } from '../src/semantics/words';
import { createUnbashParser } from '../src/syntax/adapters/unbash';
import { descendants } from '../src/syntax/tree';
import { runBash } from './support/bash';
import { Analyzer } from '../src/analyzer';
import { featureWorks, type Shell } from '../src/dialect';
import { bracesMayWork } from '../src/shellfeatures';
import { allTokens } from './support/explain';

const parser = createUnbashParser();
/** The tokens of the last line of `src`, explained for `shell` (bash when absent). */
const tokensOf = (src: string, shell?: Shell) => allTokens(new Analyzer('en').explainLine(parser.parse(src), src.split('\n').length - 1, shell).items);
const dashAvailable = spawnSync('dash', ['-c', ':']).status === 0;
const dash = (code: string): string => spawnSync('dash', ['-c', code], { encoding: 'utf8', env: { PATH: '/usr/bin:/bin', LC_ALL: 'C' } }).stdout;

/** What the model says of `name` after `src`, run by `shell`: unset, a value, `maybe` (set on some paths only), or `?`. */
function modelOf(src: string, name: string, shell?: Shell): string {
  const v = shellState(parser.parse(src), shell).end.variables.get(name);
  return !v || v.set === 'off' ? 'unset' : v.set === 'unknown' ? 'maybe' : v.value ?? '?';
}

/** The explanation of the word `word` of the last line of `src` (not the token of its brace expansion). */
const label = (src: string, word: string, shell?: Shell, lang: 'en' | 'ja' = 'en'): string | undefined =>
  allTokens(new Analyzer(lang).explainLine(parser.parse(src), src.split('\n').length - 1, shell).items).find((t) => t.label === word && t.kind !== 'expansion')?.explanation;

describe('unset with a brace expansion', () => {
  it('unsets the words bash passes, and the model follows', () => {
    assert.strictEqual(runBash('a=1 b=2; unset {a,b}; echo "[$a$b]"').stdout, '[]\n');
    assert.deepStrictEqual([modelOf('a=1 b=2; unset {a,b}', 'a'), modelOf('a=1 b=2; unset {a,b}', 'b')], ['unset', 'unset']);
    assert.strictEqual(runBash('a1=1 a2=2 a3=3; unset a{1,3}; echo "[$a1$a2$a3]"').stdout, '[2]\n');
    assert.deepStrictEqual(['a1', 'a2', 'a3'].map((n) => modelOf('a1=1 a2=2 a3=3; unset a{1,3}', n)), ['unset', '2', 'unset']);
    // (A range: unbash reads `a{1..3}` as a concatenation; the word model gives its words.)
    assert.strictEqual(runBash('a1=1 a2=2 a3=3; unset a{1..3}; echo "[$a1$a2$a3]"').stdout, '[]\n');
    assert.deepStrictEqual(['a1', 'a2', 'a3'].map((n) => modelOf('a1=1 a2=2 a3=3; unset a{1..3}', n)), ['unset', 'unset', 'unset']);
    assert.strictEqual(runBash('f() { echo f; }; g() { echo g; }; unset -f {f,g}; type -t f g; echo $?').stdout, '1\n');
    const fns = shellState(parser.parse('f() { :; }; g() { :; }; unset -f {f,g}')).end.functions;
    assert.deepStrictEqual([fns.get('f')?.state, fns.get('g')?.state], ['off', 'off']);
    // (`set +B`: no brace expansion, so no variable of these names is unset; `set -o braceexpand` turns it on again.)
    assert.strictEqual(runBash('set +B; a=1; unset {a,b}; echo "[$a]"').stdout, '[1]\n');
    assert.strictEqual(modelOf('set +B; a=1; unset {a,b}', 'a'), '1');
    assert.strictEqual(runBash('set +B; set -o braceexpand; a=1; unset {a,b}; echo "[$a]"').stdout, '[]\n');
    assert.strictEqual(modelOf('set +B; set -o braceexpand; a=1; unset {a,b}', 'a'), 'unset');
  });
  it('follows both paths where brace expansion may be off', () => {
    const src = 'a=1; if [ -n "$x" ]; then set +B; fi; unset {a,b}';
    assert.strictEqual(runBash(`${src}; echo "[$a]"`).stdout, '[]\n');
    assert.strictEqual(runBash(`x=1; ${src}; echo "[$a]"`).stdout, '[1]\n');
    assert.strictEqual(modelOf(src, 'a'), 'maybe');
    assert.match(label(src, '{a,b}')!, /^If brace expansion takes place here, each word it gives is a name to unset\. It may not \(`set \+B` turns it off on some paths before\), and then `\{a,b\}` is one name$/);
    // (A word with no braces is the same either way: one path.)
    assert.strictEqual(modelOf('a=1; if [ -n "$x" ]; then set +B; fi; unset a', 'a'), 'unset');
    // (A function's word: `local {a,b}` declares `a` and `b`, or nothing.)
    // (mksh expands `{a,b}` but not `{1..2}`: which braces of a word with both expand is not followed.)
    assert.strictEqual(label('unset {a,b}$x{1..2}', '{a,b}$x{1..2}', 'mksh'), 'Each word the braces give is a name to unset (which of them this shell expands is not known here)');
    assert.strictEqual(label('local {a,b}$x{1..2}', '{a,b}$x{1..2}', 'mksh'), '`local` takes each word the braces give (which of them this shell expands is not known here)');
    const local = 'a=1; if [ -n "$x" ]; then set +B; fi\nf() { local {a,b}; }';
    assert.match(label(local, '{a,b}')!, /^If brace expansion takes place here, `local` takes each word it gives\. It may not \(`set \+B`/);
  });
  it('does not take a `$` in the braces as text (`{a,$v}b`)', () => {
    // (unbash leaves `$v` as text in the word: bash expands `$vb` after the braces, and it is empty here.)
    assert.strictEqual(runBash('ab=1 b=2 vb=; unset {a,$v}b; echo "[${ab-U}${b-U}]"').stdout, '[U2]\n');
    const word = descendants(parser.parse('unset {a,$v}b').root, ['word']).find((w) => w.text === '{a,$v}b')!;
    assert.deepStrictEqual(wordFields(word, shellState(parser.parse('unset {a,$v}b'))), {});
    assert.strictEqual(label('unset {a,$v}b', '{a,$v}b'), 'The braces expand first, and each word is a name to unset (the words are not known here)');
    assert.strictEqual(label('declare {a,$v}b', '{a,$v}b'), 'The braces expand first, and `declare` takes each word (the words are not known here)');
  });
  it('labels the names bash unsets, one or more', () => {
    assert.strictEqual(label('unset {a,b}', '{a,b}'), 'The braces expand first: unset the variables `a`, `b` (they become undefined)');
    assert.strictEqual(label('unset {a,b}', '{a,b}', undefined, 'ja'), 'ブレース展開のあと、変数 `a`・`b` を削除する（未定義の状態に戻す）');
    assert.strictEqual(label('unset a{1..3}', 'a{1..3}'), 'The braces expand first: unset the variables `a1`, `a2`, `a3` (they become undefined)');
    assert.strictEqual(runBash('a=1; unset {a,}; echo "[${a-U}]"').stdout, '[U]\n');
    assert.strictEqual(label('unset {a,}', '{a,}'), 'The braces expand first: unset the variable `a` (it becomes undefined)');
    assert.strictEqual(label('unset -f {a,b}', '{a,b}'), 'The braces expand first: remove the functions `a`, `b`');
    assert.strictEqual(label('unset -f {a,}', '{a,}'), 'The braces expand first: remove the function `a`');
    assert.strictEqual(label('unset -n {a,}', '{a,}'), 'The braces expand first: unset the name reference `a` itself (the variable it points to stays; a variable that is not a name reference is not unset)');
    assert.match(label('unset -n {a,b}', '{a,b}')!, /^The braces expand first: unset the name references `a`, `b` themselves/);
    // (`{,}` gives only empty words, which bash drops: `unset` gets no name.)
    assert.strictEqual(runBash('a=1; unset {,}; echo "[$a]"').stdout, '[1]\n');
    assert.strictEqual(label('unset {,}', '{,}'), 'The braces give only empty words, which are dropped: nothing is passed');
    assert.strictEqual(label('local {,}', '{,}'), 'The braces give only empty words, which are dropped: nothing is passed');
  });
  it('says when the word is no variable name', () => {
    // bash: with `-v` an error; else it looks for a function of that name, and says nothing.
    assert.match(runBash('unset -v 1a; echo "[$?]"').stderr, /not a valid identifier/);
    assert.strictEqual(runBash('set +B; unset {a,b}; echo "[$?]"').stdout, '[0]\n');
    assert.strictEqual(label('unset -v 1a', '1a'), '`1a` is not a valid variable name, so nothing is unset (an error, status 1)');
    assert.strictEqual(label('set +B\nunset {a,b}', '{a,b}'), 'No variable can have the name `{a,b}`, so no variable is unset (a function of that name, if any, is removed)');
    assert.strictEqual(label('set +B\nunset -n {a,b}', '{a,b}'), 'No variable can have the name `{a,b}`, so nothing is unset');
  });
  (dashAvailable ? it : it.skip)('is one word in dash, which refuses it and exits', () => {
    // (dash refuses the name `{a,b}` and ends the shell, so nothing after it runs; `a` is not unset either way.)
    assert.strictEqual(dash('a=1; unset {a,b} 2>/dev/null; echo "[$a]"'), '');
    assert.strictEqual(dash('a=1; (unset {a,b}) 2>/dev/null; echo "[$a]"'), '[1]\n');
    assert.strictEqual(modelOf('a=1; (unset {a,b})', 'a', 'dash'), '1');
    assert.strictEqual(label('unset {a,b}', '{a,b}', 'dash'), '`{a,b}` is not a valid variable name: an error, and the shell exits (dash: "bad variable name")');
    // (`-f`: a function may have that name, and dash says nothing.)
    assert.strictEqual(dash('unset -f {a,b}; echo "[$?]"'), '[0]\n');
  });
});

describe('unset -n of a variable that is not a name reference', () => {
  it('leaves it set, as bash does', () => {
    assert.strictEqual(label('declare -n r=x; unset -n r', 'r'), 'Unset the name reference `r` itself (the variable it points to stays)');
    assert.strictEqual(runBash('a=1; unset -n a; echo "[${a-U}]"').stdout, '[1]\n');
    assert.strictEqual(modelOf('a=1; unset -n a', 'a'), '1');
    assert.strictEqual(label('a=1; unset -n a', 'a'), '`a` is not a name reference, so nothing is unset (`-n` unsets only a name reference)');
    // A name reference itself is unset, and the variable it names stays.
    assert.strictEqual(runBash('declare -n r=x; x=1; a=1; unset -n {r,a}; echo "[${r-U}${x-U}${a-U}]"').stdout, '[U11]\n');
    const src = 'declare -n r=x; x=1; a=1; unset -n {r,a}';
    assert.deepStrictEqual(['r', 'x', 'a'].map((n) => modelOf(src, n)), ['unset', '1', '1']);
    // (A name reference on some paths only: unset there, kept on the others.)
    const maybe = 'a=1; if [ -n "$x" ]; then declare -n a=z; fi; unset -n a';
    assert.strictEqual(runBash(`${maybe}; echo "[\${a-U}]"`).stdout, '[1]\n');
    assert.strictEqual(modelOf(maybe, 'a'), 'maybe');
    assert.match(label(maybe, 'a')!, /; if it is not a name reference, nothing is unset\)$/);
  });
});

describe('a declaration with a brace expansion', () => {
  it('declares the words bash passes', () => {
    assert.strictEqual(runBash('f() { local {a,b}; declare -p a b; }; f; declare {c,d}=1; declare -p c d').stdout, 'declare -- a\ndeclare -- b\ndeclare -- c="1"\ndeclare -- d="1"\n');
    assert.deepStrictEqual(['c', 'd'].map((n) => modelOf('declare {c,d}=1', n)), ['1', '1']);
    // (In the function, `a` is a new local variable with no value: `$a` is empty there.)
    assert.strictEqual(runBash('a=1; f() { local {a,b}; echo "[${a-U}]"; }; f').stdout, '[U]\n');
    const tree = parser.parse('a=1; f() { local {a,b}; echo "$a"; }; f');
    const echo = descendants(tree.root, ['command']).find((c) => c.text.startsWith('echo'))!;
    assert.strictEqual(shellState(tree).at(echo).run.variables.get('a')?.set, 'off');
    assert.strictEqual(label('f() { local {a,b}; }', '{a,b}'), 'The braces expand first, and `local` takes each word: `a`, `b`');
    assert.strictEqual(label('f() { local a{1..3}; }', 'a{1..3}'), 'The braces expand first, and `local` takes each word: `a1`, `a2`, `a3`');
    assert.strictEqual(label('declare {c,d}=1', '{c,d}=1', undefined, 'ja'), 'ブレース展開のあと、各語を `declare` が受け取る: `c=1`・`d=1`');
  });
});

describe('a word with a brace in dash', () => {
  it('lists the shells with no brace expansion as the dialect table does', () => {
    const none = (['sh', 'dash', 'ash', 'yash', 'ksh', 'mksh', 'zsh', 'bash'] as const).filter((sh) => !featureWorks('braceList', sh) && !featureWorks('braceRange', sh));
    const word = descendants(parser.parse('echo {a,b}').root, ['word']).find((w) => w.text === '{a,b}')!;
    const plain = (['sh', 'dash', 'ash', 'yash', 'ksh', 'mksh', 'zsh', 'bash'] as const).filter((sh) => staticWordValue(word, false, sh) !== undefined);
    assert.deepStrictEqual(plain, none);
  });
  it('takes a brace as text where the shell has none of its kinds', () => {
    // (src/shellfeatures.ts: dash has no brace expansion, mksh no ranges; a `{` of neither kind counts where the shell has one.)
    const rows: [string, Shell | undefined, boolean][] = [
      ['{a,b}', undefined, true], ['{a,b}', 'dash', false], ['{1..3}', 'mksh', false], ['{a,b}', 'mksh', true], ['{1..3}{a,b}', 'mksh', true],
      ['{1..3}', 'zsh', true], ['a{b', 'dash', false], ['a{b', 'mksh', true], ['a{b', 'bash', true],
    ];
    for (const [text, shell, may] of rows) assert.strictEqual(bracesMayWork(text, shell), may, `${text} ${shell}`);
  });
  it('has a value there, not in bash', () => {
    const word = (src: string) => descendants(parser.parse(src).root, ['word']).find((w) => w.text === '{x,EXIT}')!;
    assert.strictEqual(staticWordValue(word('trap {x,EXIT} INT'), false, 'dash'), '{x,EXIT}');
    assert.strictEqual(staticWordValue(word('trap {x,EXIT} INT'), false, 'sh'), '{x,EXIT}');
    assert.strictEqual(staticWordValue(word('trap {x,EXIT} INT')), undefined);
    assert.strictEqual(staticWordValue(word('trap {x,EXIT} INT'), false, 'bash'), undefined);
    assert.strictEqual(staticWordValue(word('trap {x,EXIT} INT'), false, 'mksh'), undefined);
    // mksh has `{a,b}` but no ranges: `{1..3}` is text there (the table of src/shellfeatures.ts).
    const range = descendants(parser.parse('echo {1..3}').root, ['word', 'concatenation', 'brace_expression']).find((w) => w.text === '{1..3}')!;
    assert.strictEqual(staticWordValue(range, false, 'mksh'), '{1..3}');
    assert.strictEqual(staticWordValue(range, false, 'zsh'), undefined);
  });
  (dashAvailable ? it : it.skip)('is text in `eval` in dash: what is known only when it runs is the next word', () => {
    // (finding of #425's review: the note was on `{a,b}`, which dash passes as it is.)
    assert.strictEqual(dash('x=1; eval echo {a,b} "$x"'), '{a,b} 1\n');
    const noted = (shell?: Shell) => tokensOf('eval {a,b} "$x"', shell).filter((t) => /known only when it runs/.test(t.explanation)).map((t) => t.label);
    assert.deepStrictEqual(noted('dash'), ['"$x"']);
    assert.deepStrictEqual(noted(), ['{a,b}']);
  });
  (dashAvailable ? it : it.skip)('is the action of `trap` in dash, a command to explain; bash expands it first', () => {
    assert.strictEqual(dash('trap {x,EXIT} INT; trap'), "trap -- '{x,EXIT}' INT\n");
    const arg = (src: string, shell?: Shell) => tokensOf(src, shell).find((t) => t.label === '{x,EXIT}' && t.kind === 'argument')!;
    const inDash = arg('trap {x,EXIT} INT', 'dash');
    assert.doesNotMatch(inDash.explanation, /known only when it runs/);
    assert.ok(inDash.children.some((c) => c.kind === 'command'), 'read as a script of one command');
    // bash: two words (the action `x`, the signal `EXIT`), so there is no string it can read.
    assert.ok(!arg('trap {x,EXIT} INT').children.some((c) => c.kind === 'command'));
  });
});
