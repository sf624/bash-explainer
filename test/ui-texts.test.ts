import * as assert from 'assert';
import { lineLabel } from '../src/i18n';
import { featureNames, ui } from '../src/ui/texts';

// The panel's and the page's own texts (src/ui/texts.ts) and the line label (docs/design/sources.md, row 17).

/** The shape of a text table: a string, a function (with its arity), an array of shapes, or an object of shapes. */
function shape(x: unknown): unknown {
  if (typeof x === 'string') return 'string';
  if (typeof x === 'function') return `function/${x.length}`;
  if (Array.isArray(x)) return x.map(shape);
  return Object.fromEntries(Object.entries(x as object).map(([k, v]) => [k, shape(v)]));
}

describe('the ui texts', () => {
  it('say the same things in both languages (the same keys, the same kinds of value)', () => {
    assert.deepStrictEqual(shape(ui.ja), shape(ui.en));
  });

  it('list the features the same in both languages', () => {
    assert.deepStrictEqual(featureNames(), ['hover', 'panel']);
    assert.deepStrictEqual(Object.keys(ui.en.features), featureNames());
  });

  it('write a line number in the three forms', () => {
    assert.deepStrictEqual((['long', 'inline', 'compact'] as const).map((f) => lineLabel('en', 5, f)), ['Line 5', 'line 5', 'Ln 5']);
    assert.deepStrictEqual((['long', 'inline', 'compact'] as const).map((f) => lineLabel('ja', 5, f)), ['5 行目', '行 5', '5 行目']);
    assert.strictEqual(lineLabel('en', 7), 'Line 7');
  });

  it('give the panel its line labels from the one function', () => {
    for (const lang of ['ja', 'en'] as const) {
      assert.strictEqual(ui[lang].line(3), lineLabel(lang, 3));
      assert.strictEqual(ui[lang].lineShort(3), lineLabel(lang, 3, 'inline'));
    }
  });
});
