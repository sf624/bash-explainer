import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';

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
});
