// The panel's header as data (src/ui/panelHead.ts; docs/design/chrome-redesign.md, decisions 4 and 11, step C7): the
// forms of the view control and of the web page's panel header, widest first, and the names and icons of the tools.
// The hosts measure the forms and take the first that fits (test/web-panel-head.test.ts, test/panel-header.test.ts).
import * as assert from 'assert';
import { panelHeaderForms, panelTools, ToolButton, viewControlForms } from '../src/ui/panelHead';
import { ViewControl, viewControl } from '../src/ui/panelView';

describe('the panel header as data', () => {
  it('draws the label before options with digits, and the menu says the label and the digit ("Depth 1")', () => {
    const depth = (lang: 'en' | 'ja'): ViewControl => viewControl({}, lang);
    assert.deepStrictEqual(viewControlForms(depth('en')), [
      { kind: 'segments', label: 'Depth' },
      { kind: 'menu', button: [{ text: 'Depth 1', name: 'Depth: 1 What it does' }, { text: 'Depth 2', name: 'Depth: 2 How bash reads it' }] },
    ]);
    assert.deepStrictEqual(viewControlForms(depth('ja')), [
      { kind: 'segments', label: '深さ' },
      { kind: 'menu', button: [{ text: '深さ 1', name: '深さ: 1 何をするか' }, { text: '深さ 2', name: '深さ: 2 bash がどう読むか' }] },
    ]);
    // (An option with no digit: its name, and no label drawn.)
    const named: ViewControl = { label: 'View', options: [{ id: 'depth1', short: 'A', full: 'Full A', said: 'Full A', pressed: true, sets: {} }] };
    assert.deepStrictEqual(viewControlForms(named), [{ kind: 'segments' }, { kind: 'menu', button: [{ text: 'A', name: 'View: Full A' }] }]);
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

  it('names the tools for each state, in both languages, with their Codicons and the short word the web page shows', () => {
    assert.deepStrictEqual(panelTools('en'), {
      toggle: { fold: { name: 'Collapse all', icon: 'collapse-all', word: 'Collapse' }, unfold: { name: 'Expand all', icon: 'expand-all', word: 'Expand' } },
      ref: { open: { name: 'Quick reference', icon: 'book', word: 'Reference', short: 'Ref' }, close: { name: '← Back to the explanation', icon: 'arrow-left' } },
      copy: { name: 'Copy as Markdown', icon: 'copy', word: 'Copy' },
    });
    const ja = panelTools('ja');
    assert.deepStrictEqual([ja.toggle.fold.name, ja.toggle.unfold.name, ja.ref.open.name, ja.ref.close.name, ja.copy.name], ['すべて折りたたむ', 'すべて展開する', '早見表', '← 解説に戻る', 'Markdown でコピー']);
    assert.deepStrictEqual([ja.toggle.fold.word, ja.toggle.unfold.word, ja.ref.open.word, ja.ref.open.short, ja.copy.word], ['折りたたむ', '展開する', '早見表', '早見表', 'コピー']);
  });

  it('keeps each tool\'s visible word in its accessible name, in both languages (WCAG 2.5.3, Label in Name: voice control says the word it sees)', () => {
    for (const lang of ['en', 'ja'] as const) {
      const tools = panelTools(lang);
      const buttons: [string, ToolButton][] = [['fold', tools.toggle.fold], ['unfold', tools.toggle.unfold], ['reference', tools.ref.open], ['copy', tools.copy]];
      for (const [id, b] of buttons) {
        assert.ok(b.word.length > 0, `${lang} ${id}: has a word`);
        assert.ok(b.name.toLowerCase().includes(b.word.toLowerCase()), `${lang} ${id}: the name "${b.name}" contains the word "${b.word}"`);
      }
      // (The tab's short word is a part of its word, so the name holds it too.)
      assert.ok(tools.ref.open.word.toLowerCase().includes(tools.ref.open.short.toLowerCase()), `${lang}: "Ref" is a part of "Reference"`);
    }
  });
});
