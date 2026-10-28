import * as assert from 'assert';
import { execFileSync } from 'child_process';
import type { BashParser as Parser } from '../src/syntax/tree';
import { Analyzer, Token } from '../src/analyzer';
import { explainGlob, globIntro } from '../src/embedded/glob';
import { createUnbashParser } from '../src/syntax/adapters/unbash';

let parser: Parser;
before(() => {
  parser = createUnbashParser();
});

const flat = (ts: Token[]): Token[] => ts.flatMap((t) => [t, ...flat(t.children)]);
const explain = (src: string, lang: 'ja' | 'en' = 'en') => new Analyzer(lang).explainLine(parser.parse(src), 0);
/** The glob pattern token of a line: the first with a "Glob pattern" explanation, and its parts. */
const globOf = (src: string, lang: 'ja' | 'en' = 'en', label?: string) =>
  flat(explain(src, lang).items).find((t) => t.explanation.startsWith(lang === 'en' ? 'Glob pattern' : 'グロブパターン') || (t.explanation.includes(globIntro(lang, 'value')) && t.label === label))!;
const parts = (t: Token) => t.children.map((c) => [c.label, c.span.start.character, c.span.end.character]);
const bash = (script: string) => execFileSync('bash', ['-c', script]).toString();

describe('explainGlob', () => {
  const kinds = (src: string) => explainGlob(src, 'en').map((t) => [src.slice(t.start, t.end), t.kind]);
  it('splits a pattern into its parts, with offsets', () => {
    assert.deepStrictEqual(kinds('a*b?[c-e]\\*"x*"\'y\'.txt'), [
      ['a', 'string'], ['*', 'pattern'], ['b', 'string'], ['?', 'pattern'], ['[c-e]', 'pattern'], ['\\*', 'string'], ['"x*"', 'string'], ["'y'", 'string'], ['.txt', 'string'],
    ]);
    assert.deepStrictEqual(kinds('[!x][^x][[:alpha:]_][]a]'), [['[!x]', 'pattern'], ['[^x]', 'pattern'], ['[[:alpha:]_]', 'pattern'], ['[]a]', 'pattern']]);
  });
  it('explains each kind of part in English and Japanese', () => {
    const text = (src: string, lang: 'ja' | 'en') => explainGlob(src, lang).map((t) => t.explanation);
    assert.deepStrictEqual(text('*?[a-c]', 'en'), ['`*`: any string, including an empty one', '`?`: any one character', '`[a-c]`: one character from a-c']);
    assert.deepStrictEqual(text('*?[!a-c]', 'ja'), ['`*`: 任意の文字列（空でもよい）', '`?`: 任意の1文字', '`[!a-c]`: a〜c以外の1文字']);
    assert.deepStrictEqual(text('.txt\\*', 'en'), ['The text `.txt` itself', '`\\*`: the character `*` itself, not a pattern symbol']);
    assert.deepStrictEqual(text('.txt\\*"a"', 'ja'), ['文字列 `.txt` そのもの', '`\\*`: `*` という文字そのもの（パターンの記号としては働かない）', 'クォートされた部分: 中の文字そのもの（`*` や `?` もパターンにならない）']);
  });
  it('gives an extended glob its alternatives, which are patterns themselves', () => {
    const [ext] = explainGlob('@(*.c|x?|)!(a)', 'en');
    assert.strictEqual(ext.explanation, '`@(…)`: extended glob, exactly one of the alternatives separated by `|`');
    // (The empty alternative has no token.)
    assert.deepStrictEqual(ext.children.map((c) => [c.start, c.end, c.explanation]), [[2, 5, 'Alternative `*.c`'], [6, 8, 'Alternative `x?`']]);
    assert.deepStrictEqual(ext.children[0].children.map((c) => [c.start, c.end]), [[2, 3], [3, 5]]);
    const ops = explainGlob('?(a)*(a)+(a)!(a)', 'ja').map((t) => t.explanation);
    assert.deepStrictEqual(ops.map((x) => x.slice(0, 40)), [
      '`?(…)`: 拡張グロブ。次を0回か1回（`|` で区切った選択肢）', '`*(…)`: 拡張グロブ。次の0回以上の繰り返し（`|` で区切った選択肢）',
      '`+(…)`: 拡張グロブ。次の1回以上の繰り返し（`|` で区切った選択肢）', '`!(…)`: 拡張グロブ。次のどれにも一致しないもの（`|` で区切った選択肢）',
    ].map((x) => x.slice(0, 40)));
  });
  it('takes what cannot be a part for plain text, and says nothing of a pattern with an expansion', () => {
    assert.deepStrictEqual(kinds('a[b'), [['a[b', 'string']]);
    assert.deepStrictEqual(kinds('"ab'), [['"ab', 'string']]);
    assert.deepStrictEqual(kinds('@(a'), [['@(a', 'string']]);
    assert.deepStrictEqual(explainGlob('*$x', 'en'), []);
    assert.deepStrictEqual(explainGlob('*`x`', 'en'), []);
  });
  it('words the introduction once for strings and for file names', () => {
    assert.strictEqual(globIntro('en', 'value'), 'Glob pattern (shell wildcards): matched against a string');
    assert.strictEqual(globIntro('en', 'file'), 'Glob pattern (shell wildcards): expands to the matching file names');
    assert.strictEqual(globIntro('ja', 'value'), 'グロブパターン（シェルのワイルドカード）: 文字列と照合される');
    assert.strictEqual(globIntro('ja', 'file'), 'グロブパターン（シェルのワイルドカード）: 一致するファイル名に展開される');
  });
});

describe('glob patterns in every context', () => {
  it('[[ ]] right sides', () => {
    const t = flat(explain('[[ $x = *.txt || $x = *.sh ]]').items).filter((x) => x.explanation === globIntro('en', 'value'));
    assert.deepStrictEqual(t.map((x) => x.label), ['*.txt', '*.sh']);
    assert.deepStrictEqual(parts(t[1]), [['*', 22, 23], ['.sh', 23, 26]]);
    const ja = flat(explain('[[ $x != *.txt ]]', 'ja').items).find((x) => x.label === '*.txt')!;
    assert.strictEqual(ja.explanation, globIntro('ja', 'value'));
    assert.deepStrictEqual(parts(ja), [['*', 9, 10], ['.txt', 10, 14]]);
    // The quoted part keeps its wording.
    const q = explain('[[ $x == "a"* ]]').items[0];
    assert.ok(flat([q]).some((x) => /the quoted parts of the right side are literal text, the rest is a pattern/.test(x.explanation)));
  });
  it('[[ ]] extglobs', () => {
    const t = flat(explain('[[ $x == @(a|b)* ]]').items).find((x) => x.explanation.startsWith('Glob pattern'))!;
    assert.deepStrictEqual(parts(t), [['@(a|b)', 9, 15], ['*', 15, 16]]);
    assert.deepStrictEqual(parts(t.children[0]), [['a', 11, 12], ['b', 13, 14]]);
    const e = flat(explain('[[ $x == !(a) ]]').items).find((x) => x.explanation.startsWith('Glob pattern'))!;
    assert.deepStrictEqual(parts(e), [['!(a)', 9, 13]]);
  });
  it('case patterns', () => {
    const items = flat(explain('case $f in *.sh|[a-c]?) :;; start) :;; esac').items).filter((x) => x.kind === 'pattern');
    const sh = items.find((x) => x.label === '*.sh')!;
    assert.strictEqual(sh.explanation, globIntro('en', 'value'));
    assert.deepStrictEqual(parts(sh), [['*', 11, 12], ['.sh', 12, 15]]);
    assert.deepStrictEqual(parts(items.find((x) => x.label === '[a-c]?')!), [['[a-c]', 16, 21], ['?', 21, 22]]);
    assert.match(items.find((x) => x.label === 'start')!.explanation, /^Pattern `start` \(no wildcards/);
  });
  it('arguments', () => {
    const ls = flat(explain('ls *.txt').items).find((x) => x.label === '*.txt' && x.children.length)!;
    assert.match(ls.explanation, /Glob pattern \(shell wildcards\): expands to the matching file names/);
    assert.deepStrictEqual(parts(ls), [['*', 3, 4], ['.txt', 4, 8]]);
    const rm = flat(explain('rm -f log-202[0-4]-??.txt', 'ja').items).find((x) => x.label === 'log-202[0-4]-??.txt' && x.children.length)!;
    assert.deepStrictEqual(parts(rm), [['log-202', 6, 13], ['[0-4]', 13, 18], ['-', 18, 19], ['?', 19, 20], ['?', 20, 21], ['.txt', 21, 25]]);
    assert.ok(rm.explanation.includes('グロブパターン（シェルのワイルドカード）: 一致するファイル名に展開される'));
    // A word the command has no description for.
    const echo = flat(explain('echo *.log').items).find((x) => x.label === '*.log')!;
    assert.strictEqual(echo.explanation, 'text to print — ' + globIntro('en', 'file'));
    assert.deepStrictEqual(parts(echo), [['*', 5, 6], ['.log', 6, 10]]);
  });
  it('a bracket expression with expansions or quotes in it: its `[` and `]` (in each context), no example', () => {
    // (bash expands them: with x=ab, `[$x].txt` is the pattern `[ab].txt`; with x unset, the text `[].txt`.)
    assert.strictEqual(bash('cd "$(mktemp -d)" && touch a.txt b.txt && x=ab && echo [$x].txt ["$x"].txt && unset x && echo [$x].txt'), 'a.txt b.txt a.txt b.txt\n[].txt\n');
    const pieces = (src: string, lang: 'ja' | 'en' = 'en') => flat(explain(src, lang).items).filter((x) => x.refs?.includes('3.5.8.1')).map((x) => [x.label, x.explanation, parts(x)]);
    const opens = (w: string, target: 'file' | 'value') => `${globIntro('en', target)}. \`[\` opens the \`[…]\` of \`${w}\`: it matches one character of those between, the characters the expansions give included`;
    const closes = (w: string, target: 'file' | 'value') => `${globIntro('en', target)}. \`]\` closes the \`[…]\` of \`${w}\``;
    assert.deepStrictEqual(pieces('ls *[$x]*.txt ["$x"]'), [
      ['*[', opens('[$x]', 'file'), [['*', 3, 4]]], [']*.txt', closes('[$x]', 'file'), [['*', 8, 9], ['.txt', 9, 13]]],
      ['[', opens('["$x"]', 'file'), []], [']', closes('["$x"]', 'file'), []],
    ]);
    assert.deepStrictEqual(pieces('echo [$x][$y]').map((x) => x[0]), ['[', '][', ']']);
    assert.strictEqual(pieces('echo [$x][$y]')[1][1], `${closes('[$x]', 'file')}. \`[\` opens the \`[…]\` of \`[$y]\`: it matches one character of those between, the characters the expansions give included`);
    assert.deepStrictEqual(pieces('case $1 in [$x]) ;; esac').map((x) => x[1]), [opens('[$x]', 'value'), closes('[$x]', 'value')]);
    assert.deepStrictEqual(pieces('[[ $1 == a[$x] ]]').map((x) => [x[0], x[1]]), [['a[', opens('[$x]', 'value')], [']', closes('[$x]', 'value')]]);
    assert.match(pieces('ls [$x]', 'ja')[0][1] as string, /`\[` は `\[\$x\]` の `\[…\]` の始まり/);
    // (No pattern in an assignment, nor with `set -f`; no example of names, which depend on the value.)
    assert.deepStrictEqual([pieces('x=[$y]'), pieces('set -f; ls [$x]')], [[], []]);
    // (`[!…]` and `[^…]` match any other character: with x=a, `[!$x]` matches `b`, not `a`; a quoted `!` or `^` is none.)
    assert.strictEqual(bash('x=a; [[ b == [!$x] ]] && echo 1; [[ a == [^$x] ]] || echo 2; [[ a == ["^"$x] ]] && echo 3'), '1\n2\n3\n');
    const except = (w: string, c: string) => `${globIntro('en', 'value')}. \`[${c}\` opens the \`[…]\` of \`${w}\`: it matches any one character except those between, the characters the expansions give included`;
    assert.deepStrictEqual(pieces('[[ $1 == [!$x] ]]').map((x) => [x[0], x[1]]), [['[!', except('[!$x]', '!')], [']', closes('[!$x]', 'value')]]);
    assert.deepStrictEqual(pieces('case $1 in [^$x]*) ;; esac').map((x) => x[1]), [except('[^$x]', '^'), closes('[^$x]', 'value')]);
    assert.deepStrictEqual(pieces('[[ $1 == ["^"$x] ]]').map((x) => x[1]), [opens('["^"$x]', 'value'), closes('["^"$x]', 'value')]);
    assert.match(pieces('ls [!$x]', 'ja')[0][1] as string, /`\[!` は `\[!\$x\]` の `\[…\]` の始まり: 間にある文字（展開した値の文字も含む）以外の1文字に一致する/);
    assert.ok(!explain('ls [$x].c').examples.some((e) => e.title.startsWith('Example (glob')));
    assert.ok(explain('ls [x].c').examples.some((e) => e.title.startsWith('Example (glob')));
  });

  it('${x#pat} ${x##pat} ${x%pat} ${x%%pat} and ${x/pat/rep}', () => {
    for (const [src, label, expected] of [
      ['echo ${x#*/}', '*/', [['*', 9, 10], ['/', 10, 11]]],
      ['echo ${x##*/}', '*/', [['*', 10, 11], ['/', 11, 12]]],
      ['echo ${x%.*}', '.*', [['.', 9, 10], ['*', 10, 11]]],
      ['echo ${x%%.[a-z]*}', '.[a-z]*', [['.', 10, 11], ['[a-z]', 11, 16], ['*', 16, 17]]],
      ['echo ${x/a?/-}', 'a?', [['a', 9, 10], ['?', 10, 11]]],
      ['echo ${x//a*/-}', 'a*', [['a', 10, 11], ['*', 11, 12]]],
      ['echo ${x/#a*/-}', 'a*', [['a', 10, 11], ['*', 11, 12]]],
      ['echo ${x/%*b/-}', '*b', [['*', 10, 11], ['b', 11, 12]]],
      ['echo ${x#+(a|b)}', '+(a|b)', [['+(a|b)', 9, 15]]],
    ] as const) {
      const t = flat(explain(src).items).find((x) => x.label === label && x.kind === 'pattern' && x.children.length)!;
      assert.match(t.explanation, /Glob pattern \(shell wildcards\): matched against a string/, src);
      assert.deepStrictEqual(parts(t), expected, src);
    }
    // With an expansion in it, only that is explained.
    const dyn = flat(explain('echo ${x#$y*}').items).find((x) => x.label === '$y*')!;
    assert.ok(!dyn.children.some((c) => c.label === '*'));
  });
  it('quoted patterns given to find', () => {
    const t = flat(explain("find . -name '*.txt'").items).find((x) => x.label === '*' && x.span.start.character === 14)!;
    assert.strictEqual(t.explanation, 'any string, including an empty one');
    assert.deepStrictEqual(flat(explain("find . -name '*.txt'").items).filter((x) => x.explanation.startsWith('The text')).map((x) => [x.label, x.span.start.character, x.span.end.character]), [['.txt', 15, 19]]);
    assert.ok(flat(explain("find . -name 'a?c'", 'ja').items).some((x) => x.explanation === '任意の1文字'));
  });
});

describe('the examples of [[ ]] patterns agree with bash', () => {
  const lines = (src: string, label: string) => {
    const ex = explain(src).examples.find((e) => e.title.startsWith('Example (pattern'));
    assert.ok(ex, src);
    return ex.sections.find((s) => s.label === label)?.lines ?? [];
  };
  const patterns = ['*.txt', 'a?c', '[a-c]*', '[!0-9]*x', '[[:digit:]]*', '*/*', '@(foo|bar)*', '!(a*)', '+([0-9]).log', '?(x)y', '*(ab)c'];
  for (const p of patterns) {
    it(p, () => {
      const check = (v: string): [boolean, boolean] => [
        execFileSync('bash', ['-c', `shopt -s extglob; [[ "$1" == ${p} ]] && echo y || echo n`, '_', v]).toString().trim() === 'y',
        execFileSync('bash', ['-c', `shopt -s extglob\neval 'case "$1" in '"$2"') echo y;; *) echo n;; esac'`, '_', v, p]).toString().trim() === 'y',
      ];
      const src = `[[ $x == ${p} ]]`;
      const yes = lines(src, 'Values that match');
      const no = lines(src, 'Values that do not match');
      assert.ok(yes.length > 0, `no matching value for ${p}`);
      for (const v of yes) assert.deepStrictEqual(check(v), [true, true], `${v} should match ${p}`);
      for (const v of no) assert.deepStrictEqual(check(v), [false, false], `${v} should not match ${p}`);
    });
  }
  it('gives each pattern of an || its own example, in Japanese too', () => {
    const e = explain('[[ $x = *.txt || $x = *.sh ]]', 'ja').examples;
    assert.deepStrictEqual(e.map((x) => x.title), ['例（パターン `*.txt`）', '例（パターン `*.sh`）']);
    assert.deepStrictEqual(e[0].sections.map((s) => s.label), ['一致する値', '一致しない値']);
  });
  it('has none for a quoted or plain right side, or for [ ]', () => {
    for (const src of ['[[ $x == "*.txt" ]]', '[[ $x == abc ]]', '[ "$x" = *.txt ]', '[[ $x == *"$y" ]]']) {
      assert.ok(!explain(src).examples.some((e) => e.title.startsWith('Example (pattern')), src);
    }
  });
});
