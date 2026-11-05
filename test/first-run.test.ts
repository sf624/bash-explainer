// What a touch screen's first visit shows (src/ui/firstRun.ts; docs/design/chrome-redesign.md, C8): the mode it starts in,
// and the tip of the Read | Edit switch. test/web-phone.test.ts runs them in the browser.
import * as assert from 'assert';
import { startInRead, tipDue } from '../src/ui/firstRun';

describe('the first visit on a touch screen', () => {
  it('starts in Read on the untouched sample, and in Edit for a script from a link or with a mouse', () => {
    assert.strictEqual(startInRead(null, true, true), true);
    // (No storage at all: the same as no choice.)
    assert.strictEqual(startInRead(undefined, true, true), true);
    assert.strictEqual(startInRead(null, true, false), false);
    assert.strictEqual(startInRead(null, false, true), false);
    assert.strictEqual(startInRead(null, false, false), false);
  });

  it('keeps the mode the user chose, whatever the page shows', () => {
    for (const touch of [true, false]) {
      for (const sample of [true, false]) {
        assert.strictEqual(startInRead('1', touch, sample), true);
        assert.strictEqual(startInRead('0', touch, sample), false);
      }
    }
    // (A stored value that is neither is no choice.)
    assert.strictEqual(startInRead('x', true, true), true);
  });

  it('shows the tip only on a touch screen in Edit mode, until it was seen', () => {
    assert.strictEqual(tipDue(true, false, false), true);
    assert.strictEqual(tipDue(true, true, false), false);
    assert.strictEqual(tipDue(true, false, true), false);
    assert.strictEqual(tipDue(false, false, false), false);
  });
});
