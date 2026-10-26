import * as assert from 'assert';
import { execFileSync } from 'child_process';
import * as path from 'path';
import type { BashParser as Parser } from '../src/syntax/tree';
import { Analyzer, Token } from '../src/analyzer';
import { describeGlob, exampleFor, globParts, parseExpansion } from '../src/expansion';
import { createUnbashParser } from '../src/syntax/adapters/unbash';
import { allTokens } from './support/explain';

const root = path.join(__dirname, '..');
let parser: Parser;

before(async () => {
  parser = createUnbashParser();
});

function expansionToken(src: string, lang: 'ja' | 'en' = 'en'): Token {
  const tree = parser.parse(src);
  const ex = new Analyzer(lang).explainLine(tree, 0);
  const t = allTokens(ex.items).find((x) => x.label.startsWith('${') && x.children.some((c) => c.label !== x.label));
  assert.ok(t, `no expansion token in ${src}`);
  return t;
}

describe('parseExpansion', () => {
  it('splits a default-value expansion into parts with offsets', () => {
    const p = parseExpansion('${LOG_DIR:-$HOME/log}')!;
    assert.strictEqual(p.op, ':-');
    assert.deepStrictEqual(p.parts.map((x) => [x.role, x.text, x.start]), [
      ['name', 'LOG_DIR', 2], ['op', ':-', 9], ['word', '$HOME/log', 11],
    ]);
  });

  it('handles prefixes, subscripts, replacement and substrings', () => {
    assert.deepStrictEqual(parseExpansion('${#arr[@]}')!.parts.map((x) => x.role), ['prefix', 'name', 'subscript']);
    assert.deepStrictEqual(parseExpansion('${s//a\\/b/x}')!.parts.map((x) => [x.role, x.text]), [
      ['name', 's'], ['op', '//'], ['pattern', 'a\\/b'], ['op', '/'], ['replacement', 'x'],
    ]);
    assert.deepStrictEqual(parseExpansion('${s: -2:1}')!.parts.map((x) => [x.role, x.text]), [
      ['name', 's'], ['op', ':'], ['offset', '-2'], ['op', ':'], ['length', '1'],
    ]);
    assert.strictEqual(parseExpansion('${x:-${y:-z}}')!.parts[2].text, '${y:-z}');
    assert.strictEqual(parseExpansion('${#}')!.name, '#');
    assert.strictEqual(parseExpansion('${!}')!.name, '!');
    assert.strictEqual(parseExpansion('${!pre*}')!.op, '*');
  });

  it('describes glob patterns', () => {
    assert.strictEqual(describeGlob(globParts('.*')!, 'en'), '"." + any string');
    assert.strictEqual(describeGlob(globParts('[0-9]?')!, 'ja'), '0〜9のどれか1文字 + 任意の1文字');
    assert.strictEqual(globParts('$suffix'), undefined);
  });
});

describe('examples match bash', () => {
  // Each case: the expansion text and the variable assignment its example uses.
  const cases = [
    '${file%.*}', '${file%%.*}', '${path#*/}', '${path##*/}', '${f%.sh}', '${v#v}',
    '${s/foo/bar}', '${s//foo/bar}', '${s/#foo/bar}', '${s/%foo/bar}', '${s//o/}', '${d//-/}',
    '${s^}', '${s^^}', '${s,}', '${s,,}', '${s:2}', '${s:1:3}', '${s: -2}', '${s:2:-1}', '${s@U}', '${s// /_}',
    '${v:-def}', '${v-def}', '${v:=def}', '${v=def}', '${v:+alt}', '${v+alt}', '${#s}', '${#a[@]}', '${!a[@]}', '${a[1]}', '${a[@]}',
    '${a[@]:1}', '${a[@]:1:2}', '${a[@]: -2}', '${a[*]:2}', '${@:2}', '${@:2:2}', '${@: -1}',
    '${!v*}', '${a[5]}', '${v#?}', '${v%[!a]}', '${v#[[:digit:]]}', '${v#\\*}', '${v%"*.gz"}', '${v#zz*}', '${v%*qq}', '${v#[ab}',
    '${v/#zz/x}', '${v/%qq/x}', '${v//?/x}', '${v/[!a]/x}', '${v:1 }', '${v/}', '${v//"a/b"/c}', '${v%[[:digit:]x]}', '${v#[]a]}', '${v%[a-c]}',
    '${#a[1]}', '${a[1]:-def}', '${a[1]-def}', '${a[1]:+alt}', '${a[1]^^}', '${a[1]:1:2}', '${a[1]/x/y}', '${a[2]#*/}', '${a[1]@U}',
    '${@:-none}', '${@-x}', '${@:+alt}', '${@+alt}', '${*:-x}',
    '${v#?q}', '${v#[!a]q}', '${v#[b]q}', '${v/#?q/x}', '${v/%[!a]q/x}', '${v/#[b]q/x}', '${v/#*qq/x}',
  ];
  for (const text of cases) {
    it(text, () => {
      const p = parseExpansion(text)!;
      const ex = exampleFor(p, 'en');
      assert.ok(ex, `no example for ${text}`);
      for (const c of ex) {
        assert.ok(c.setup, c.when);
        const actual = execFileSync('bash', ['-c', `${c.setup}; echo -n "${text}"`]).toString();
        assert.strictEqual(c.result, actual, `${c.setup}; ${text}`);
      }
    });
  }
  it('${v:?msg} exits with the message when missing', () => {
    const ex = exampleFor(parseExpansion('${v:?not set}')!, 'en')!;
    assert.match(ex[0].result, /prints the error "not set" and exits/);
    assert.strictEqual(execFileSync('bash', ['-c', `${ex[1].setup}; printf %s "\${v:?not set}"`]).toString(), ex[1].result);
  });
});

/** The examples of a line as "label → result" strings. */
function examples(src: string, lang: 'ja' | 'en' = 'en'): string[] {
  const tree = parser.parse(src);
  const ex = new Analyzer(lang).explainLine(tree, 0);
  return ex.examples.flatMap((e) => e.sections.map((sec) => `${sec.label} → ${sec.lines.join(' ') || sec.empty}`));
}

describe('expansion tokens', () => {
  it('explains each part at its own column', () => {
    const t = expansionToken('echo "${LOG_DIR:-$HOME/log}"');
    assert.deepStrictEqual(examples('echo "${LOG_DIR:-$HOME/log}"'), ['When LOG_DIR is unset or empty → $HOME/log (expanded)', 'When `LOG_DIR=hello` → hello']);
    assert.deepStrictEqual(t.children.map((c) => [c.label, c.span.start.character]), [['LOG_DIR', 8], [':-', 15], ['$HOME/log', 17]]);
    const word = t.children[2];
    assert.match(word.explanation, /Default/);
    assert.deepStrictEqual(word.children.map((c) => c.label), ['$HOME']);
  });

  it('describes positional parameters as arguments, not assignments', () => {
    assert.deepStrictEqual(examples('echo ${2:-/tmp}'), ['When argument 2 is missing or empty → /tmp', 'When argument 2 is `/data` → /data']);
    assert.deepStrictEqual(examples('echo ${2:-/tmp}', 'ja'), ['2 番目の引数が無いか空のとき → /tmp', '2 番目の引数が `/data` のとき → /data']);
    assert.deepStrictEqual(examples('echo ${1+set}'), ['When argument 1 is `hello` → set', 'When argument 1 is empty → set', 'When argument 1 is missing → (empty string)']);
    assert.deepStrictEqual(examples('echo ${PORT:-8080}')[1], 'When `PORT=42` → 42');
    assert.deepStrictEqual(examples('echo ${1%.*}'), ['When argument 1 is `report.tar.gz` → report.tar']);
  });

  it('reads patterns and numbers', () => {
    assert.match(expansionToken('echo ${file%%.*}').children[2].explanation, /Pattern `\.\*`: Glob pattern \(shell wildcards\): matched against a string/);
    assert.deepStrictEqual(expansionToken('echo ${file%%.*}').children[2].children.map((c) => [c.label, c.span.start.character, c.span.end.character]), [['.', 13, 14], ['*', 14, 15]]);
    const sub = expansionToken('echo ${s: -2}');
    assert.match(sub.explanation, /last 2 characters/);
    assert.deepStrictEqual(sub.children.map((c) => c.label), ['s', ':', '-2']);
    assert.match(sub.children[2].explanation, /space or parentheses/);
    assert.match(expansionToken('echo ${arr[0]}').children[1].explanation, /1st element \(0-based\)/);
    const del = expansionToken('echo ${s//x/}');
    assert.match(del.explanation, /Delete every match of `x` in `s`/);
    assert.deepStrictEqual(examples('echo ${s//x/}'), ['When `s=a-x-b-x` → a--b-']);
    assert.match(del.children[3].explanation, /matches are deleted/);
    assert.match(expansionToken('echo ${s//x/y}').children[4].explanation, /Replacement `y`/);
  });

  it('explains transformations', () => {
    const t = expansionToken('echo ${s@Q}', 'ja');
    assert.match(t.explanation, /クォートする$/);
    assert.deepStrictEqual(examples('echo ${s@Q}', 'ja'), [`\`s="it's"\` のとき → 'it'\\''s'`]);
    assert.ok(!t.children[2].explanation.startsWith('`Q`'));
    assert.match(t.children[2].explanation, /^[^`]/);
  });
});

describe('all the elements where the word stays one string', () => {
  // `t=${a[@]}` joins the elements with a space, `t=${a[*]}` with the first character of IFS (manual 3.4.2, 3.4); the
  // value of an assignment, a here-string, the word of `case` and `[[ ]]` are not split. Each row: the script (its last
  // line, or the body of `f`, is explained), the expansion, what the explanation says, and the value bash gives
  // (`declare -p t`, or what `cat` reads).
  const rows: [string, string, RegExp, string][] = [
    ['a=("x  y" b c)\nt=${a[@]}', '${a[@]}', /separated by a space/, 'x  y b c'],
    ['a=("x  y" b c)\nt="${a[@]}"', '${a[@]}', /separated by a space/, 'x  y b c'],
    ['a=("x  y" b c)\nIFS=:\nt=${a[@]}', '${a[@]}', /separated by a space/, 'x  y b c'],
    ['a=("x  y" b c)\nIFS=:\nt=${a[*]}', '${a[*]}', /separated by the first character of `IFS`, `:`/, 'x  y:b:c'],
    ['a=("x  y" b c)\nIFS=\nt=${a[*]}', '${a[*]}', /with nothing between them/, 'x  ybc'],
    ['a=("x  y" b c)\nIFS=:\nunset IFS\nt=${a[*]}', '${a[*]}', /separated by a space/, 'x  y b c'],
    ['set -- "x  y" b c\nIFS=:\nt=$@', '$@', /arguments are joined into one string, separated by a space/, 'x  y b c'],
    ['set -- "x  y" b c\nIFS=:\nt=$*', '$*', /separated by the first character of `IFS`, `:`/, 'x  y:b:c'],
    ['set -- "x  y" b c\nt=${@}', '${@}', /separated by a space/, 'x  y b c'],
    ['a=("x  y" b c)\nf() { IFS=:; local t=${a[@]}; declare -p t; }\nf', '${a[@]}', /separated by a space/, 'x  y b c'],
    ['a=("x  y" b c)\nIFS=:\ncat <<< ${a[*]}', '${a[*]}', /In a here-string .* `:`/, 'x  y:b:c'],
    ['a=("x  y" b c)\nif [ "$1" ]; then IFS=:; fi\nt=${a[*]}', '${a[*]}', /separated by the first character of `IFS` \(quoting/, 'x  y b c'],
    ['a=("x  y" b c)\nIFS=:\nt=${a[@]:1}', '${a[@]:1}', /^Parameter expansion: .*separated by a space/, 'b c'],
  ];
  for (const [src, text, said, value] of rows) {
    it(`${src.replace(/\n/g, '; ')}: ${value}`, () => {
      const lines = src.split('\n');
      const at = lines[lines.length - 1] === 'f' ? lines.length - 2 : lines.length - 1;
      const t = allTokens(new Analyzer('en').explainLine(parser.parse(src), at).items).find((x) => x.label === text);
      assert.ok(t, src);
      assert.match(t.explanation, said);
      assert.doesNotMatch(t.explanation, /separate word/);
      const own = /declare -p t|<<</.test(src);
      const out = execFileSync('bash', ['--norc', '--noprofile', '-c', own ? src : `${src}\ndeclare -p t`]).toString();
      assert.strictEqual(/<<</.test(src) ? out : out.match(/^declare -- t="(.*)"\n$/s)?.[1], /<<</.test(src) ? `${value}\n` : value);
    });
  }
  it('says so in Japanese, and not where the words are split', () => {
    const ja = allTokens(new Analyzer('ja').explainLine(parser.parse('a=(x y)\nT=${a[@]}'), 1).items);
    assert.match(ja.find((x) => x.label === '${a[@]}')!.explanation, /代入の値は単語分割されないので、要素は空白で区切って1つの文字列につながる/);
    assert.match(ja.find((x) => x.label === '[@]')!.explanation, /1つの文字列につながる/);
    const split = allTokens(new Analyzer('en').explainLine(parser.parse('a=(x y)\necho ${a[@]} $@; t=${!a[@]} n=${#a[@]}; alias $@ ${a[*]}'), 1).items);
    assert.ok(split.some((x) => x.label === '$@'));
    assert.ok(split.some((x) => x.label === '${!a[@]}'));
    assert.ok(split.every((x) => !/joined into one string/.test(x.explanation)));
  });
});
