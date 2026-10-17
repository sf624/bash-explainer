import * as assert from 'assert';
import { execFileSync } from 'child_process';
import * as path from 'path';
import type { BashParser as Parser } from '../src/parser';
import { Analyzer, Token } from '../src/analyzer';
import { describeGlob, exampleFor, globParts, parseExpansion } from '../src/expansion';
import { createBashParser } from '../src/parser';

const root = path.join(__dirname, '..');
let parser: Parser;

before(async () => {
  parser = await createBashParser({
    runtimeDir: path.join(root, 'node_modules/web-tree-sitter'),
    bashWasm: path.join(root, 'node_modules/tree-sitter-bash/tree-sitter-bash.wasm'),
  });
});

function expansionToken(src: string, lang: 'ja' | 'en' = 'en'): Token {
  const tree = parser.parse(src);
  const ex = new Analyzer(lang).explainLine(tree, 0);
  tree.delete();
  const all = (ts: Token[]): Token[] => ts.flatMap((t) => [t, ...all(t.children)]);
  const t = all(ex.items).find((x) => x.label.startsWith('${') && x.children.some((c) => c.label !== x.label));
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
  tree.delete();
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
    assert.match(expansionToken('echo ${file%%.*}').children[2].explanation, /Pattern `\.\*`: "\." \+ any string/);
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
    assert.match(t.children[2].explanation, /^`Q`: /);
  });
});
