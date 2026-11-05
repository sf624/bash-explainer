// What a touch screen's first visit shows (src/ui/firstRun.ts; docs/design/chrome-redesign.md, C8c): the mode it starts in,
// how it follows the script, and the tip of the Read | Edit switch. test/web-first-run.test.ts runs them in the browser.
import * as assert from 'assert';
import { modeChosen, readAsTextChanges, startInRead, tipDue } from '../src/ui/firstRun';

describe('the first visit on a touch screen', () => {
  it('starts in Read on the untouched sample, and in Edit for another script or where the switch does not show', () => {
    assert.strictEqual(startInRead(null, true, true), true);
    // (No storage at all: the same as no choice.)
    assert.strictEqual(startInRead(undefined, true, true), true);
    assert.strictEqual(startInRead(null, true, false), false);
    assert.strictEqual(startInRead(null, false, true), false);
    assert.strictEqual(startInRead(null, false, false), false);
  });

  it('keeps the mode the user chose, whatever the page shows', () => {
    for (const sample of [true, false]) {
      assert.strictEqual(startInRead('1', true, sample), true);
      assert.strictEqual(startInRead('0', true, sample), false);
    }
    // (A stored value that is neither is no choice.)
    assert.strictEqual(startInRead('x', true, true), true);
    assert.deepStrictEqual(['1', '0', 'x', null, undefined].map(modeChosen), [true, true, false, false, false]);
  });

  it('is never in Read where the switch does not show: no keyboard could open there, whatever is stored', () => {
    for (const stored of ['1', '0', null]) {
      for (const sample of [true, false]) assert.strictEqual(startInRead(stored, false, sample), false);
    }
  });

  it('follows the script while no mode is chosen: Edit on an empty editor, Read on the sample, the same for any other script', () => {
    assert.strictEqual(readAsTextChanges(true, 'empty', false), false);
    assert.strictEqual(readAsTextChanges(false, 'empty', false), false);
    assert.strictEqual(readAsTextChanges(false, 'sample', false), true);
    assert.strictEqual(readAsTextChanges(true, 'sample', false), true);
    assert.strictEqual(readAsTextChanges(true, 'script', false), true);
    assert.strictEqual(readAsTextChanges(false, 'script', false), false);
  });

  it('changes nothing while the editor has the focus: the switch does not flip under an open keyboard', () => {
    for (const read of [true, false]) for (const showing of ['empty', 'sample', 'script'] as const) assert.strictEqual(readAsTextChanges(read, showing, true), read);
  });

  it('shows the tip only on a touch screen in Edit mode, until it was seen', () => {
    assert.strictEqual(tipDue(true, false, false), true);
    assert.strictEqual(tipDue(true, true, false), false);
    assert.strictEqual(tipDue(true, false, true), false);
    assert.strictEqual(tipDue(false, false, false), false);
  });
});
