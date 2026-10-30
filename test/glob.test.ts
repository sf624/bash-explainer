import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
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
  it('a character of IFS in a word with an unquoted expansion, which bash matches as itself', () => {
    // (bash: with files `a?` and `ab`, `IFS='?'; x=a; echo $x?` prints `a?`, and `echo a?` prints `a? ab`.)
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'explain-bash-ifsword-'));
    try {
      for (const f of ['a?', 'ab']) fs.writeFileSync(path.join(dir, f), '');
      assert.strictEqual(execFileSync('bash', ['-c', "IFS='?'; x=a; echo $x?; echo a?"], { cwd: dir }).toString(), 'a?\na? ab\n');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
    const q = flat(explain("IFS='?'; x=a; ls $x?").items).find((t) => t.label === '?')!;
    assert.strictEqual(q.kind, 'argument');
    assert.strictEqual(q.explanation, 'Word `?`. The word has an unquoted expansion, so bash matches `?`, which `IFS` holds, as itself: no wildcard here');
    assert.match(flat(explain("IFS='[]'; y=; echo $y[ab]", 'ja').items).find((t) => t.label === '[ab]')!.explanation, /`IFS` にある `\[`・`\]` をそのままの文字として照合する/);
    assert.strictEqual(flat(explain("IFS='?'; x=a; ls $x\\*?").items).find((t) => t.label === '\\*?')!.kind, 'argument');
    // (Without an expansion, or with `?` not in IFS, it is a wildcard.)
    assert.ok(flat(explain("IFS='?'; x=a; ls $x?*").items).some((t) => t.label === '?*' && t.kind === 'pattern'));
    assert.ok(flat(explain("IFS='?'; ls a?").items).some((t) => t.label === '?' && t.kind === 'pattern'));
    assert.ok(flat(explain("IFS=':'; x=a; ls $x?").items).some((t) => t.label === '?' && t.kind === 'pattern'));
  });
  it('a pattern some of whose glob characters are in IFS: those are themselves, the others wildcards', () => {
    // (Before, `?` of `$x[ab]?` with `IFS='?'` was "any one character", the `-` of `[a-c]` with `IFS='-'` a range, and
    // the `|` of `@(a|b)` with `IFS='|'` a separator: bash matches each as itself, in bash 5.2 and 5.3.)
    const rows: [string, string, string][] = [
      ["x=; IFS='?'", '$x[ab]?', '<a?>'], ["x=; IFS='-'", '$x[a-c]b', '<-b><ab><cb>'], ["x=; IFS='!'", '$x[!a]b', '<!b><ab>'],
      ["x=; IFS='^'", '$x[^a]b', '<^b><ab>'], ["x=; IFS='|'", '$x@(a|b)', '<a|b>'], ["x=; IFS='\\|'", '$x@(a\\\\|b)', '<a\\|b>'], ["x=; IFS=' '", '$x@(a|b)', '<a><b>'],
      ["x=; IFS='@'", '$x@(a|b)', '<@(a|b)>'], ["x=; IFS='-!'", '$x[!a-c]b', '<!b><-b><ab><cb>'],
      ["x=a; IFS=']'", '[$x]', '<[a]>'], ["x=a; IFS='['", '[$x]', '<[a]>'], ["x=a; IFS='!'", '[!$x]b', '<!b><ab>'],
    ];
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'explain-bash-ifspattern-'));
    try {
      for (const f of ['a?', 'ax', 'ab', 'cb', '-b', '!b', '^b', 'a|b', 'a\\|b', 'a', 'b']) fs.writeFileSync(path.join(dir, f), '');
      for (const b of ['bash', ...(process.env.BASH_EXPLAINER_BASH53 ? [process.env.BASH_EXPLAINER_BASH53] : [])]) {
        for (const [set, word, out] of rows) assert.strictEqual(execFileSync(b, ['-c', `shopt -s extglob\n${set}; printf '<%s>' ${word}`], { cwd: dir }).toString(), out, `${b}: ${set}; ${word}`);
      }
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
    // (The line after `shopt -s extglob`.)
    const tokens = (set: string, word: string, lang: 'ja' | 'en' = 'en') => flat(new Analyzer(lang).explainLine(parser.parse(`shopt -s extglob\n${set}; ls ${word}`), 1).items);
    const said = (set: string, word: string, label: string, lang: 'ja' | 'en' = 'en') => tokens(set, word, lang).find((t) => t.label === label)!;
    const held = /^`IFS` holds it and the word has an unquoted expansion, so bash matches the character itself, not a pattern symbol$/;
    assert.strictEqual(said("x=; IFS='?'", '$x[ab]?', '[ab]?').kind, 'pattern');
    assert.match(said("x=; IFS='?'", '$x[ab]?', '[ab]').explanation, /one character from ab$/);
    assert.deepStrictEqual([said("x=; IFS='?'", '$x[ab]?', '?')].map((t) => [t.kind, held.test(t.explanation.replace(/^`\?`: /, ''))]), [['string', true]]);
    assert.match(said("x=; IFS='?'", '$x[ab]?', '?', 'ja').explanation, /`IFS` にある文字で、語にクォートしていない展開があるので、bash はこの文字そのものとして照合する/);
    assert.match(said("x=; IFS='-'", '$x[a-c]b', '[a-c]').explanation, /one character from a, -, c \(`-`, which `IFS` holds, is itself\)$/);
    assert.match(said("x=; IFS='-'", '$x[a-c]b', '[a-c]', 'ja').explanation, /a、-、cのどれか1文字（`IFS` にある `-` はその文字そのもの）$/);
    for (const c of ['!', '^']) assert.match(said(`x=; IFS='${c}'`, `$x[${c}a]b`, `[${c}a]`).explanation, new RegExp(`one character from \\${c}a \\(\`\\${c}\`, which \`IFS\` holds, is itself\\)$`), c);
    // (An extended glob whose `|` is in IFS: one alternative, `a|b`; the note that lists alternatives is left out.)
    assert.ok(!tokens("x=; IFS='|'", '$x@(a|b)').some((t) => /one of `a`, `b`/.test(t.explanation)));
    assert.deepStrictEqual(said("x=; IFS='|'", '$x@(a|b)', '@(a|b)').children.find((t) => t.kind === 'pattern')!.children.map((t) => [t.label, t.kind]), [['a|b', 'pattern']]);
    assert.ok(held.test(said("x=; IFS='|'", '$x@(a|b)', '|').explanation.replace(/^`\|`: /, '')));
    assert.match(said("x=; IFS='\\|'", '$x@(a\\\\|b)', 'a\\\\|b').explanation, /^Alternative `a\\\\\|b`$/);
    assert.match(said("x=; IFS=' '", '$x@(a|b)', '@(a|b)').explanation, /Extended glob: `@\(a\|b\)` is one of `a`, `b`/);
    assert.match(said("x=; IFS='-!'", '$x[!a-c]b', '[!a-c]').explanation, /one character from !, a, -, c \(`!`, `-`, which `IFS` holds, are themselves\)$/);
    // (An `@` of IFS before `(`: no extended glob, and no wildcard left.)
    assert.match(said("x=; IFS='@'", '$x@(a|b)', '@(a|b)').explanation, /^Word `@\(a\|b\)`\. The word has an unquoted expansion, so bash matches `@`, which `IFS` holds, as itself: no wildcard here$/);
    // (A bracket expression around an expansion: none where `IFS` holds `[` or `]`, and not negated by a `!` it holds.)
    for (const set of ["x=a; IFS=']'", "x=a; IFS='['"]) assert.deepStrictEqual(tokens(set, '[$x]').filter((t) => t.label === '[' || t.label === ']').map((t) => [t.label, t.kind]), [['[', 'argument'], [']', 'argument']], set);
    assert.match(said("x=a; IFS='!'", '[!$x]b', '[!').explanation, /`\[` opens the `\[…\]` of `\[!\$x\]`: it matches one character of those between/);
    assert.match(said("x=a; IFS=' '", '[!$x]b', '[!').explanation, /`\[!` opens the `\[…\]` of `\[!\$x\]`: it matches any one character except those between/);
    assert.strictEqual(said('x=a; IFS=$1', '[$x]', '[').kind, 'pattern');
    // (A line continuation, which bash removes first: bash lists `a?` and `b?` with files `a?`, `b?`, `ax`.)
    const broken = flat(new Analyzer('en').explainLine(parser.parse("x=; IFS='?'; ls $x[a\\\nb]?"), 0).items);
    assert.ok(broken.some((t) => t.explanation === '`[ab]`: one character from ab'));
    assert.ok(broken.some((t) => t.label === '?' && held.test(t.explanation.replace(/^`\?`: /, ''))));
    // (A `-` written escaped is no range either.)
    assert.match(said('x=', '[a\\-c]b', '[a\\-c]').explanation, /one character from a, -, c$/);
  });
  it('a `:`, `.` or `=` of IFS after a `[`: no class, but characters of the bracket expression', () => {
    // (Before, `$x[[:alpha:]]` with `IFS=':'` was "one character from letters": bash quotes the `:`, and matches one
    // of `[`, `:`, `a`, `l`, `p`, `h`, then `]`, in bash 5.2 and 5.3.)
    const rows: [string, string, string][] = [
      ["x=; IFS=':'", '$x[[:alpha:]]', '<:]><[]><a]><l]><p]>'], ["x=; IFS=':'", '$x[![:alpha:]]', '<!]><=]><x]>'], ["x=; IFS=':'", '$x[[:alpha:][:digit:]]', '<a:]>'],
      ["x=; IFS='='", '$x[[=a=]]', '<=]><[]><a]>'], ["x=; IFS='.'", '$x[[.a.]]', '<[]><a]>'], ["x=; IFS=':'", '[[:alpha:]]', '<a><b>'],
      ['x=', '[[":"alpha:]]', '<:]><[]><a]><l]><p]>'], ["x=; IFS=':'", '$x[a:]', '<a>'],
    ];
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'explain-bash-ifsclass-'));
    try {
      for (const f of ['a', 'b', ':]', '[]', 'a]', 'l]', 'p]', '!]', '=]', 'x]', 'a:]', '1']) fs.writeFileSync(path.join(dir, f), '');
      for (const b of ['bash', ...(process.env.BASH_EXPLAINER_BASH53 ? [process.env.BASH_EXPLAINER_BASH53] : [])]) {
        for (const [set, word, out] of rows) assert.strictEqual(execFileSync(b, ['-c', `${set}; printf '<%s>' ${word}`], { cwd: dir }).toString(), out, `${b}: ${set}; ${word}`);
      }
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
    const said = (set: string, word: string, label: string, lang: 'ja' | 'en' = 'en') => flat(new Analyzer(lang).explainLine(parser.parse(`${set}; ls ${word}`), 0).items).filter((t) => t.label === label).pop()!;
    assert.match(said("x=; IFS=':'", '$x[[:alpha:]]', '[[:alpha:]').explanation, /one character from \[, :, a, l, p, h, a, : \(`:`, which `IFS` holds, is itself\)$/);
    assert.strictEqual(said("x=; IFS=':'", '$x[[:alpha:]]', ']').kind, 'string');
    assert.match(said("x=; IFS=':'", '$x[[:alpha:]]', '[[:alpha:]', 'ja').explanation, /\[、:、a、l、p、h、a、:のどれか1文字（`IFS` にある `:` はその文字そのもの）$/);
    assert.match(said("x=; IFS=':'", '$x[![:alpha:]]', '[![:alpha:]').explanation, /one character other than \[, :, a, l, p, h, a, :/);
    assert.match(said("x=; IFS='='", '$x[[=a=]]', '[[=a=]').explanation, /one character from \[, =, a, =/);
    assert.match(said("x=; IFS='.'", '$x[[.a.]]', '[[.a.]').explanation, /one character from \[, \., a, \./);
    // (With no expansion, or with `:` not in IFS, a class; a `[` last in a set reads as itself.)
    assert.match(said("x=; IFS=':'", '[[:alpha:]]', '[[:alpha:]]').explanation, /one character from letters$/);
    assert.match(said('x=; IFS=,', '$x[[:alpha:]]', '[[:alpha:]]').explanation, /one character from letters$/);
    assert.match(explainGlob('[a[]', 'en')[0].explanation, /one character from a\[$/);
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
