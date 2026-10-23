import * as assert from 'assert';
import { rerun } from '../src/examples/rerun';
import { quickReference } from '../src/ui/reference';
import { FromPanel } from '../src/ui/panelView';
import { isPanelQuestion, panelReply } from '../src/ui/panelReply';

// The VS Code panel (src/ui/panel.ts) and the web page (web/panel-bridge.ts) answer the panel's questions
// with this one function.
describe('panel replies', () => {
  const spec = { kind: 'regex', regex: { source: 'a', flags: '' }, mode: 'inverted' } as const;

  it('runs an example again on the input, without the final newline', () => {
    const m: FromPanel = { type: 'rerun', id: 7, spec, input: 'abc\nxyz\n' };
    assert.ok(isPanelQuestion(m));
    if (!isPanelQuestion(m)) return;
    assert.deepStrictEqual(panelReply(m, 'en'), { type: 'rerunResult', id: 7, result: rerun(spec, ['abc', 'xyz'], 'en') });
  });

  it('sends the quick reference in the language asked', () => {
    const m: FromPanel = { type: 'reference' };
    assert.ok(isPanelQuestion(m));
    if (!isPanelQuestion(m)) return;
    assert.deepStrictEqual(panelReply(m, 'ja'), { type: 'reference', entries: quickReference('ja') });
  });

  it('leaves the other messages to the page', () => {
    for (const m of [{ type: 'ready' }, { type: 'copy' }, { type: 'openSettings' }] as FromPanel[]) assert.strictEqual(isPanelQuestion(m), false);
  });
});
