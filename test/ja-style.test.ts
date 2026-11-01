import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import * as ts from 'typescript';
import { Analyzer, type Token } from '../src/analyzer';
import { dialectTexts, type Shell } from '../src/dialect';
import { createUnbashParser } from '../src/syntax/adapters/unbash';

// Keeps the Japanese wording consistent, as docs/japanese-style.md describes.
const root = path.join(__dirname, '..');

function* sources(dir: string): Generator<string> {
  for (const e of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) yield* sources(p);
    else if (/\.(ts|js)$/.test(e.name) && !e.name.endsWith('.d.ts')) yield p;
  }
}

const kana = /[぀-ヿ一-鿿]/;

/**
 * The string literals of a script (.ts or .js) with Japanese in them, as written between the quotes: single-quoted,
 * double-quoted and backquoted ones (a template literal may span lines; each substitution `${…}` is written as such), with the
 * line each starts on. The TypeScript scanner reads them, so a comment is not text (a backtick or a quote in a comment
 * neither fails the test nor hides a string), and a template nested in a `${…}` is found as well.
 */
function japaneseStrings(source: string, file: string): { where: string; text: string }[] {
  const out: { where: string; text: string }[] = [];
  const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, file.endsWith('.js') ? ts.ScriptKind.JS : ts.ScriptKind.TS);
  const visit = (n: ts.Node): void => {
    // (A template with substitutions: its literal parts, with `${…}` for each substitution. The code inside is not text; a
    // string or a template written there is visited as a node of its own.)
    const text = ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n) ? n.getText(tree).slice(1, -1)
      : ts.isTemplateExpression(n) ? n.head.getText(tree).slice(1, -2) + n.templateSpans.map((x) => '${…}' + x.literal.getText(tree).slice(1, ts.isTemplateTail(x.literal) ? -1 : -2)).join('')
        : undefined;
    if (text !== undefined && kana.test(text)) out.push({ where: `${file}:${tree.getLineAndCharacterOfPosition(n.getStart(tree)).line + 1}`, text });
    ts.forEachChild(n, visit);
  };
  visit(tree);
  return out;
}

/** The strings of src/, cli/, web/ (.ts and .js) and media/ (.js) with Japanese in them, and the text of the pages (web/*.html), with where they are. */
function japanese(): { where: string; text: string }[] {
  const out: { where: string; text: string }[] = [];
  const scripts = [...sources('src'), ...sources('cli'), ...sources('web'), ...sources('media')];
  for (const file of scripts) out.push(...japaneseStrings(fs.readFileSync(path.join(root, file), 'utf8'), file));
  return [...out, ...pageJapanese()];
}

/** The text and the attribute values of the web pages (web/*.html). */
function pageJapanese(): { where: string; text: string }[] {
  const out: { where: string; text: string }[] = [];
  const at = (text: string, index: number) => text.slice(0, index).split('\n').length;
  for (const file of fs.readdirSync(path.join(root, 'web')).filter((f) => /\.html$/.test(f)).map((f) => `web/${f}`)) {
    const html = fs.readFileSync(path.join(root, file), 'utf8');
    for (const m of html.matchAll(/>([^<>]+)<|"([^"<>]*)"/g)) {
      const text = (m[1] ?? m[2]).trim();
      if (kana.test(text)) out.push({ where: `${file}:${at(html, m.index!)}`, text });
    }
  }
  return out;
}

describe('Japanese wording', () => {
  const texts = japanese();

  it('finds the Japanese strings', () => assert.ok(texts.length > 1000, String(texts.length)));

  it('finds the Japanese of the web page (web/*.ts and web/*.html)', () => {
    const web = texts.filter((t) => t.where.startsWith('web/'));
    assert.ok(web.length > 100, String(web.length));
    assert.ok(web.some((t) => t.where.startsWith('web/text.ts')));
    assert.ok(web.some((t) => t.where.startsWith('web/index.html') && t.text === '日本語'));
  });

  it('reads strings of all three quote kinds, in .ts and .js, and not the comments (the probe cases)', () => {
    const found = (source: string, file = 'probe.ts') => japaneseStrings(source, file).map((t) => t.text);
    // (Double-quoted and backquoted strings, which the scan once skipped or paired over the whole file.)
    assert.deepStrictEqual(found('const a = "二重引用符 `x`は"; const b = `${n} 行目`; const c = \'単一\';'), ['二重引用符 `x`は', '${…} 行目', '単一']);
    // (A backtick in a comment: no text of its own, and it must not pair with the next one.)
    assert.deepStrictEqual(found('// Ja reads `行 3` here.\nconst a = 1;'), []);
    assert.deepStrictEqual(found('// an odd backtick `\nconst a = `日本語 ${x}`;'), ['日本語 ${…}']);
    assert.deepStrictEqual(found('/* `\n * 「行 3」 */\nconst a = "日本語";'), ['日本語']);
    // (A template inside the `${…}` of another; where it starts.)
    assert.deepStrictEqual(found('const a = `${ok ? `あ` : ""}`;'), ['あ']);
    assert.deepStrictEqual(japaneseStrings('\n\nconst a = `日本語`;', 'probe.js'), [{ where: 'probe.js:3', text: '日本語' }]);
    // (A .js file is read as a script: no type syntax to trip on.)
    assert.deepStrictEqual(found("el.title = labels.x ?? '早見表';", 'probe.js'), ['早見表']);
  });

  it('scans the scripts and pages that hold text: media/*.js, web/*.js and web/compare.html among them', () => {
    for (const file of ['media/panel.js', 'media/view-control.js', 'web/panel-host.js', 'web/theme-init.js', 'web/compare.html']) {
      assert.ok(fs.existsSync(path.join(root, file)), file);
    }
    const files = new Set([...sources('media'), ...sources('web')]);
    for (const file of ['media/panel.js', 'web/panel-host.js', 'web/theme-init.js']) assert.ok(files.has(file), file);
    assert.ok(texts.some((t) => t.where.startsWith('web/compare.html:')));
  });

  // (docs/design/sources.md, row 17.) The panel's and the page's own texts live in their catalogs; a pair written
  // beside the code that shows it (`lang === 'ja' ? '…' : '…'`) escapes the checks above and drifts from its neighbours.
  it('keeps the Japanese text of src/ui, cli and web in the catalogs', () => {
    const catalogs = new Map([
      ['src/ui/texts.ts', 'the panel, hover and status texts (`ui`)'],
      ['src/ui/reference.ts', 'the quick reference, a table of content of its own'],
      ['web/text.ts', "the page's texts"],
      ['web/index.html', 'the page markup'],
      ['web/compare.html', 'the compare page markup'],
    ]);
    const files = [...new Set(texts.map((t) => t.where.replace(/:\d+$/, '')))]
      .filter((f) => /^(src\/ui|cli|web)\//.test(f) && !catalogs.has(f));
    assert.deepStrictEqual(files, []);
    for (const file of catalogs.keys()) assert.ok(texts.some((t) => t.where.startsWith(`${file}:`)), file);
  });

  it('finds the Japanese of the panel texts, the templates among them', () => {
    assert.ok(texts.some((t) => t.where.startsWith('src/ui/texts.ts') && t.text.includes('項目はパネルで')));
    assert.ok(texts.some((t) => t.where.startsWith('src/i18n.ts') && t.text.includes('行 ${…}')));
  });

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

  it('puts a space between code and Japanese around a part of a template that may be empty (`\\`x\\`${a ? \'…\' : \'\'}は`)', () => {
    // (One branch of the part gives the text, the other nothing: with nothing, the code span touches the Japanese.)
    const hits = [...sources('src'), ...sources('cli'), ...sources('web')].flatMap((file) => fs.readFileSync(path.join(root, file), 'utf8').split('\n')
      .flatMap((line, i) => emptyPartGlued(line).map((m) => `${file}:${i + 1}: ${m}`)));
    assert.deepStrictEqual(hits, []);
    // (It finds the text that had it: `-ok` "`\;`がない".)
    assert.strictEqual(emptyPartGlued("`${o} のコマンドを終わらせる \\`\\\\;\\`${plus ? '（または `{}` の直後の `+`）' : ''}がない`").length, 1);
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

/**
 * In the source line of a template literal: a code span (an escaped backtick) and Japanese with a part between them, `${…}`,
 * one of whose branches is empty (`? '' :` or `: ''`), so that the two touch when it is taken. Each such part, as written.
 */
function emptyPartGlued(line: string): string[] {
  const letter = /[ぁ-ゖァ-ヺー一-鿿]/;
  const out: string[] = [];
  for (let at = line.indexOf('${'); at >= 0; at = line.indexOf('${', at + 2)) {
    // (Its end: the brace that closes it, counting those inside, `{}` in its strings among them.)
    let depth = 0;
    let end = at + 1;
    for (; end < line.length; end++) {
      if (line[end] === '{') depth++;
      else if (line[end] === '}' && --depth === 0) break;
    }
    const part = line.slice(at, end + 1);
    if (!/\? (?:''|"") :|: (?:''|"")\}$/.test(part)) continue;
    const before = line.slice(0, at);
    const after = line.slice(end + 1);
    if ((before.endsWith('\\`') && letter.test(after[0] ?? '')) || (letter.test(before.slice(-1)) && after.startsWith('\\`'))) out.push(part);
  }
  return out;
}

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
