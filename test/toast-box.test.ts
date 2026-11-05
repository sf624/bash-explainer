// Where the toast sits and how wide it may be (src/ui/toastBox.ts; docs/design/chrome-redesign.md, C3): in the room of the editor's
// pane, never narrower than it can be read, never out of the window. test/web-toast.test.ts measures it in the browser.
import * as assert from 'assert';
import { TOAST_GAP, TOAST_MIN_WIDTH, TOAST_READABLE, toastBox } from '../src/ui/toastBox';

describe('the toast\'s box', () => {
  it('fills the pane\'s room inside its gaps when the pane is wide enough', () => {
    assert.deepStrictEqual(toastBox({ left: 0, width: 640 }, 1280), { left: TOAST_GAP, maxWidth: 624 });
    assert.deepStrictEqual(toastBox({ left: 400, width: 500 }, 1280), { left: 408, maxWidth: 484 });
  });

  it('keeps to the pane while the room inside its gaps can hold the words, as before', () => {
    // (The pane beside the settings at 768 px: 190 px.)
    assert.deepStrictEqual(toastBox({ left: 0, width: 190 }, 768), { left: TOAST_GAP, maxWidth: 174 });
    assert.deepStrictEqual(toastBox({ left: 0, width: TOAST_READABLE + 2 * TOAST_GAP }, 768), { left: TOAST_GAP, maxWidth: TOAST_READABLE });
    assert.strictEqual(toastBox({ left: 0, width: TOAST_READABLE + 2 * TOAST_GAP - 1 }, 768).maxWidth, TOAST_MIN_WIDTH);
  });

  it('is as wide as it can be read in a pane that is very narrow, over the pane\'s edge (the divider at 15% of 768 px)', () => {
    assert.deepStrictEqual(toastBox({ left: 0, width: 115 }, 768), { left: TOAST_GAP, maxWidth: TOAST_MIN_WIDTH });
  });

  it('never leaves the window: it moves left when its room ends at the window\'s right edge', () => {
    const box = toastBox({ left: 700, width: 68 }, 768);
    assert.strictEqual(box.maxWidth, TOAST_MIN_WIDTH);
    assert.strictEqual(box.left + box.maxWidth, 768 - TOAST_GAP);
    // (A pane that starts outside the window.)
    assert.deepStrictEqual(toastBox({ left: 900, width: 300 }, 768), { left: 768 - TOAST_GAP - TOAST_READABLE, maxWidth: TOAST_READABLE });
    // (A pane that starts left of it.)
    assert.strictEqual(toastBox({ left: -50, width: 300 }, 768).left, TOAST_GAP);
  });

  it('takes what a window narrower than its minimum has', () => {
    assert.deepStrictEqual(toastBox({ left: 0, width: 200 }, 200), { left: TOAST_GAP, maxWidth: 200 - 2 * TOAST_GAP });
    // (A window narrower than the two gaps: no width, nothing negative.)
    assert.strictEqual(toastBox({ left: 0, width: 10 }, 10).maxWidth, 0);
  });
});
