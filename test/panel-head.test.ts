// The panel's header as data (src/ui/panelHead.ts; docs/design/chrome-redesign.md, decisions 4 and 11, step C7): the
// forms of the view control and of the web page's panel header, widest first, and the names and icons of the tools.
// The hosts measure the forms and take the first that fits (test/web-panel-head.test.ts, test/panel-header.test.ts).
import * as assert from 'assert';
import { panelHeaderForms, panelTools, viewControlForms } from '../src/ui/panelHead';
import { ViewControl, viewControl } from '../src/ui/panelView';

describe('the panel header as data', () => {
  it('gives the view control as segments, then as a menu: before P8, Meaning | Reading without digits and no label drawn', () => {
    assert.deepStrictEqual(viewControlForms(viewControl({}, 'en')), [
      { kind: 'segments' },
      { kind: 'menu', button: [{ text: 'Meaning', name: 'View: Meaning' }, { text: 'Reading', name: 'View: Reading' }] },
    ]);
    // (The words are the panel's, in the panel's language; the form does not change with the option shown.)
    assert.deepStrictEqual(viewControlForms(viewControl({ view: 'tree' }, 'ja')), [
      { kind: 'segments' },
      { kind: 'menu', button: [{ text: '意味', name: '表示: 意味' }, { text: '読まれ方', name: '表示: 読まれ方' }] },
    ]);
  });

  it('draws the label before options with digits, and the menu says the label and the digit ("Depth 1")', () => {
    // (The depths of P8, as `viewControl` will give them.)
    const depth = (lang: 'en' | 'ja'): ViewControl => {
      const [label, does, reads, full1, full2] = lang === 'en' ? ['Depth', 'Does', 'Reads', 'What it does', 'How bash reads it'] : ['深さ', '何をする', '読まれ方', '何をするか', 'bash がどう読むか'];
      return {
        label,
        options: [
          { id: 'list', digit: '1', short: does, full: full1, pressed: true, sets: { view: 'list' } },
          { id: 'tree', digit: '2', short: reads, full: full2, pressed: false, sets: { view: 'tree' } },
        ],
      };
    };
    assert.deepStrictEqual(viewControlForms(depth('en')), [
      { kind: 'segments', label: 'Depth' },
      { kind: 'menu', button: [{ text: 'Depth 1', name: 'Depth: 1 What it does' }, { text: 'Depth 2', name: 'Depth: 2 How bash reads it' }] },
    ]);
    assert.deepStrictEqual(viewControlForms(depth('ja')), [
      { kind: 'segments', label: '深さ' },
      { kind: 'menu', button: [{ text: '深さ 1', name: '深さ: 1 何をするか' }, { text: '深さ 2', name: '深さ: 2 bash がどう読むか' }] },
    ]);
  });

  it('gives the web page\'s header forms widest first: the segments kept longest, the tools\' words under their icons before the menu, the tabs\' short words last', () => {
    const control = viewControl({}, 'en');
    const [segments, menu] = viewControlForms(control);
    assert.deepStrictEqual(panelHeaderForms(control), [
      { view: segments, tools: 'beside', tabs: 'full' },
      { view: segments, tools: 'under', tabs: 'full' },
      { view: menu, tools: 'beside', tabs: 'full' },
      { view: menu, tools: 'under', tabs: 'full' },
      { view: menu, tools: 'under', tabs: 'short' },
    ]);
  });

  it('names the tools for each state, in both languages, with their Codicons', () => {
    assert.deepStrictEqual(panelTools('en'), {
      toggle: { fold: { name: 'Collapse all', icon: 'collapse-all' }, unfold: { name: 'Expand all', icon: 'expand-all' } },
      ref: { open: { name: 'Quick reference', icon: 'book', pressed: false }, close: { name: '← Back to the explanation', icon: 'arrow-left', pressed: true } },
      copy: { name: 'Copy as Markdown', icon: 'copy' },
    });
    const ja = panelTools('ja');
    assert.deepStrictEqual([ja.toggle.fold.name, ja.toggle.unfold.name, ja.ref.open.name, ja.ref.close.name, ja.copy.name], ['すべて折りたたむ', 'すべて展開', '早見表', '← 解説に戻る', 'Markdown でコピー']);
  });
});
