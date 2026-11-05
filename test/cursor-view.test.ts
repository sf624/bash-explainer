// What the editor scrolls into view when its room changes (src/ui/cursorView.ts): the cursor's whole line when it fits.
import * as assert from 'assert';
import { scrollToShow, VIEW_MARGIN, viewTarget } from '../src/ui/cursorView';

describe('what keeps in view', () => {
  it('is the cursor\'s whole line when it fits in the room, and the cursor when it does not', () => {
    assert.strictEqual(viewTarget(59, 207), 'line');
    assert.strictEqual(viewTarget(207, 207), 'line');
    assert.strictEqual(viewTarget(208, 207), 'cursor');
    // (No room left: only the cursor.)
    assert.strictEqual(viewTarget(20, -10), 'cursor');
  });

  it('scrolls as little as shows it, with a margin, and not at all when it shows', () => {
    const room = { top: 100, bottom: 300 };
    assert.strictEqual(VIEW_MARGIN, 5);
    // In the room: no move.
    assert.strictEqual(scrollToShow({ top: 105, bottom: 295 }, room), 0);
    assert.strictEqual(scrollToShow({ top: 150, bottom: 170 }, room), 0);
    // Below it: down by what lies past the margin. Above it: up.
    assert.strictEqual(scrollToShow({ top: 290, bottom: 310 }, room), 15);
    assert.strictEqual(scrollToShow({ top: 90, bottom: 110 }, room), -15);
    // Far below: as far.
    assert.strictEqual(scrollToShow({ top: 900, bottom: 960 }, room), 665);
    // Taller than the room: its top shows, whichever side it lies on.
    assert.strictEqual(scrollToShow({ top: 150, bottom: 500 }, room), 45);
    assert.strictEqual(scrollToShow({ top: 50, bottom: 500 }, room), -55);
  });
});
