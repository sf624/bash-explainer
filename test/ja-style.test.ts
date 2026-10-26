import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { Analyzer, type Token } from '../src/analyzer';
import { dialectTexts, type Shell } from '../src/dialect';
import { createUnbashParser } from '../src/syntax/adapters/unbash';

// Keeps the Japanese wording consistent, as docs/japanese-style.md describes.
const root = path.join(__dirname, '..');

function* sources(dir: string): Generator<string> {
  for (const e of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) yield* sources(p);
    else if (/\.ts$/.test(e.name)) yield p;
  }
}

/** The single-quoted strings with Japanese in them, with where they are. */
function japanese(): { where: string; text: string }[] {
  const out: { where: string; text: string }[] = [];
  for (const file of [...sources('src'), ...sources('cli')]) {
    fs.readFileSync(path.join(root, file), 'utf8').split('\n').forEach((line, i) => {
      for (const m of line.matchAll(/'((?:[^'\\]|\\.)*)'/g)) {
        if (/[぀-ヿ一-鿿]/.test(m[1])) out.push({ where: `${file}:${i + 1}`, text: m[1] });
      }
    });
  }
  return out;
}

describe('Japanese wording', () => {
  const texts = japanese();

  it('finds the Japanese strings', () => assert.ok(texts.length > 1000, String(texts.length)));

  const rules: [RegExp, string][] = [
    [/作成(する|し[、てた])/, '「作る」を使う'],
    [/消[すさしせ]/, '「削除する」を使う'],
    [/(ヘッダ|ユーザ|サーバ)(?!ー)/, '長音を付ける（ヘッダー、ユーザー、サーバー）'],
    [/パラメーター/, '「パラメータ」を使う（bash の用語に合わせる）'],
    [/[぀-ヿ一-鿿] \((?=[A-Za-z0-9<>=! ]+\))/, '略語の注記は空白を入れずに半角カッコで（拡張正規表現(ERE)）'],
  ];
  for (const [pattern, advice] of rules) {
    it(`does not use ${pattern.source}: ${advice}`, () => {
      const hits = texts.filter((t) => pattern.test(t.text)).map((t) => `${t.where}: ${t.text}`);
      assert.deepStrictEqual(hits, []);
    });
  }

  it('puts a space between code and Japanese in the literal strings (`local` は)', () => {
    const hits = texts.flatMap((t) => glued(t.text.replace(/\\`/g, '`')).map((g) => `${t.where}: ${g}`));
    assert.deepStrictEqual(hits, []);
  });

  it('puts a space between code and Japanese in the dialect notes, built from parts', () => {
    const notes = dialectTexts('ja');
    assert.ok(notes.length > 100, String(notes.length));
    assert.deepStrictEqual(notes.flatMap((t) => glued(t).map((g) => `${g}: ${t}`)), []);
    // (No space between Japanese words either: `代わりに一時ファイル`.)
    assert.deepStrictEqual(notes.filter((t) => /[ぁ-ゖァ-ヺー一-鿿] [ぁ-ゖァ-ヺー一-鿿]/.test(t)), []);
    assert.ok(notes.includes('`local` は POSIX sh にない書き方です（dash・busybox ash では動きますが、POSIX にはありません）。'));
  });

  it('puts a space between code and Japanese in the explanations of the sample script, in every shell', function () {
    this.timeout(60_000);
    const sample = fs.readFileSync(path.join(root, 'test/fixtures/sample.sh'), 'utf8').replace(/^#!.*\n/, '');
    const parser = createUnbashParser();
    const hits = new Set<string>();
    for (const shell of ['bash', 'sh', 'dash', 'zsh'] as Shell[]) {
      const tree = parser.parse(sample);
      sample.split('\n').forEach((_, i) => {
        const e = new Analyzer('ja').explainLine(tree, i, shell);
        const all: string[] = [...e.notes, e.summary];
        const walk = (t: Token) => (all.push(t.explanation), t.children.forEach(walk));
        e.items.forEach(walk);
        for (const t of all) for (const g of glued(t)) hits.add(`${shell}:${i + 1}: ${g}`);
      });
    }
    assert.deepStrictEqual([...hits], []);
  });
});

/** Where a code span (`` `…` ``) touches a kana or a kanji with no space: none when the backticks do not pair up. */
function glued(text: string): string[] {
  const letter = /[ぁ-ゖァ-ヺー一-鿿]/;
  const parts = text.split('`');
  if (parts.length % 2 === 0) return [];
  const out: string[] = [];
  for (let i = 1; i < parts.length; i += 2) {
    if (letter.test(parts[i - 1].slice(-1))) out.push(`${parts[i - 1].slice(-3)}\`${parts[i]}\``);
    if (letter.test(parts[i + 1][0] ?? '')) out.push(`\`${parts[i]}\`${parts[i + 1].slice(0, 3)}`);
  }
  return out;
}
