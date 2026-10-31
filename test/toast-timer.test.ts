// How long a toast of the web page stays (src/ui/toastTimer.ts): docs/design/chrome-redesign.md, C3.
// test/web-toast.test.ts runs it in the browser.
import * as assert from 'assert';
import { ACTION_MS, AFTER_HOLD_MS, holdToast, PLAIN_MS, releaseToast, startToast, toastEnds } from '../src/ui/toastTimer';

describe('the toast timer (src/ui/toastTimer.ts)', () => {
  it('stays 4 s, or 8 s with a button', () => {
    assert.strictEqual(toastEnds(startToast(false, 1000)), 1000 + PLAIN_MS);
    assert.strictEqual(toastEnds(startToast(true, 1000)), 1000 + ACTION_MS);
    assert.deepStrictEqual([PLAIN_MS, ACTION_MS, AFTER_HOLD_MS], [4000, 8000, 2000]);
  });

  it('stops while held, and goes on with what was left, at least 2 s', () => {
    const held = holdToast(startToast(true, 0), 3000);
    assert.deepStrictEqual(held, { left: 5000 });
    assert.strictEqual(toastEnds(held), undefined);
    // Held again: nothing changes.
    assert.strictEqual(holdToast(held, 9000), held);
    assert.strictEqual(toastEnds(releaseToast(held, 20000)), 25000);
    // Held near its end: 2 s more after both leave.
    const late = holdToast(startToast(false, 0), 3900);
    assert.strictEqual(toastEnds(releaseToast(late, 10000)), 10000 + AFTER_HOLD_MS);
    // Held past its end (a slow event): 2 s too, never a negative time.
    assert.deepStrictEqual(holdToast(startToast(false, 0), 9000), { left: 0 });
  });

  it('leaves a running timer alone when released', () => {
    const t = startToast(false, 0);
    assert.strictEqual(releaseToast(t, 100), t);
  });
});
