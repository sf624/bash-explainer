import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import * as ts from 'typescript';
import { lineLabel, lineListLabel, lineRangeLabel } from '../src/i18n';
import { featureNames, ui } from '../src/ui/texts';

// The panel's and the page's own texts (src/ui/texts.ts) and the line label (docs/design/sources.md, row 17).

/** The shape of a text table: a string, a function (with its arity), an array of shapes, or an object of shapes. */
function shape(x: unknown): unknown {
  if (typeof x === 'string') return 'string';
  if (typeof x === 'function') return `function/${x.length}`;
  if (Array.isArray(x)) return x.map(shape);
  return Object.fromEntries(Object.entries(x as object).map(([k, v]) => [k, shape(v)]));
}

const root = path.join(__dirname, '..');

/** The files whose texts are the message catalogs and the explanation's: src/messages*.ts, src/statusfacts.ts and src/explain/**. */
function catalogFiles(): string[] {
  const out = fs.readdirSync(path.join(root, 'src')).filter((f) => /^(messages.*|statusfacts)\.ts$/.test(f)).map((f) => `src/${f}`);
  const walk = (dir: string): void => {
    for (const e of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) {
      if (e.isDirectory()) walk(`${dir}/${e.name}`);
      else if (e.name.endsWith('.ts')) out.push(`${dir}/${e.name}`);
    }
  };
  walk('src/explain');
  return out;
}

/** A line number written by hand in a template (`行 ${n}`, `line ${n}`, `Line ${n}`, `lines ${a}`): the text before the substitution ends with the word. */
const HAND_WRITTEN = /((?<![一-鿿])行 ?|\b[Ll]ines? )$/;

/** Rare exceptions: a text that is no line label although it ends with the word, with why. */
const NOT_LABELS: { file: string; before: string; why: string }[] = [
  { file: 'src/messages-sentence.ts', before: 'each line ', why: '"counts how often each line ${lines}occurs": a line of the input, then the words of an option' },
];

/** Where a template of `source` writes a line number by hand, as `file:line`. The TypeScript scanner reads the templates, so a comment is not text. */
function handWrittenLabels(source: string, file: string): string[] {
  const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  const out: string[] = [];
  const visit = (n: ts.Node): void => {
    if (ts.isTemplateExpression(n)) {
      // (Each text that a substitution follows: the head, and the literal of every span but the last.)
      const before = [n.head.text, ...n.templateSpans.slice(0, -1).map((x) => x.literal.text)];
      for (const b of before) {
        if (HAND_WRITTEN.test(b) && !NOT_LABELS.some((x) => x.file === file && b.endsWith(x.before))) {
          out.push(`${file}:${tree.getLineAndCharacterOfPosition(n.getStart(tree)).line + 1}`);
        }
      }
    }
    ts.forEachChild(n, visit);
  };
  visit(tree);
  return out;
}

describe('the ui texts', () => {
  it('say the same things in both languages (the same keys, the same kinds of value)', () => {
    assert.deepStrictEqual(shape(ui.ja), shape(ui.en));
  });

  it('list the features the same in both languages', () => {
    assert.deepStrictEqual(featureNames(), ['hover', 'panel']);
    assert.deepStrictEqual(Object.keys(ui.en.features), featureNames());
  });

  it('write a line number: 行 N in Japanese whatever the form, three forms in English', () => {
    assert.deepStrictEqual((['long', 'inline', 'compact'] as const).map((f) => lineLabel('en', 5, f)), ['Line 5', 'line 5', 'Ln 5']);
    assert.deepStrictEqual((['long', 'inline', 'compact'] as const).map((f) => lineLabel('ja', 5, f)), ['行 5', '行 5', '行 5']);
    assert.strictEqual(lineLabel('en', 7), 'Line 7');
  });

  it('give the panel its line labels from the one function', () => {
    for (const lang of ['ja', 'en'] as const) {
      assert.strictEqual(ui[lang].line(3), lineLabel(lang, 3));
      assert.strictEqual(ui[lang].lineShort(3), lineLabel(lang, 3, 'inline'));
    }
  });

  it('write a range and a list of lines: 行 2〜4, lines 2–4; 行 1、3, lines 1, 2 and 3', () => {
    assert.deepStrictEqual([lineRangeLabel('ja', 2, 4), lineRangeLabel('en', 2, 4), lineRangeLabel('ja', 2, 2), lineRangeLabel('en', 2, 2)], ['行 2〜4', 'lines 2–4', '行 2', 'line 2']);
    assert.deepStrictEqual([lineListLabel('ja', [1, 3]), lineListLabel('en', [1, 3]), lineListLabel('en', [1, 2, 3]), lineListLabel('en', [4])], ['行 1、3', 'lines 1 and 3', 'lines 1, 2 and 3', 'line 4']);
  });

  it('write no script-line label by hand in the catalogs and the explanation (they call lineLabel, lineRangeLabel, lineListLabel)', () => {
    const files = catalogFiles();
    assert.ok(files.length > 20, String(files.length));
    const found = files.flatMap((f) => handWrittenLabels(fs.readFileSync(path.join(root, f), 'utf8'), f));
    assert.deepStrictEqual(found, []);
  });

  it('finds a label written by hand in a template (the probe cases)', () => {
    const found = (s: string) => handWrittenLabels(s, 'probe.ts').length;
    assert.strictEqual(found('const a = `行 ${n}`;'), 1);
    assert.strictEqual(found('const a = `on line ${n}`;'), 1);
    assert.strictEqual(found('const a = `${x} and Line ${n} and lines ${m}`;'), 2);
    assert.strictEqual(found('const a = `（行 ${n}）${lineLabel(1)}`;'), 1);
    assert.strictEqual(found("// `行 ${n}`\nconst a = `${lineLabel('ja', n)} は 1 行目`;"), 0);
    assert.strictEqual(found('const a = `実行 ${n}`;'), 0);
    assert.strictEqual(found('const a = `each line ${n}`;'), 1);
    assert.strictEqual(handWrittenLabels('const a = `each line ${n}occurs`;', 'src/messages-sentence.ts').length, 0);
  });
});
