// What the editor scrolls into view when its room changes (src/ui/cursorView.ts): the cursor's whole line when it fits.
import * as assert from 'assert';
import { viewTarget } from '../src/ui/cursorView';

describe('what keeps in view', () => {
  it('is the cursor\'s whole line when it fits in the room, and the cursor when it does not', () => {
    assert.strictEqual(viewTarget(59, 207), 'line');
    assert.strictEqual(viewTarget(207, 207), 'line');
    assert.strictEqual(viewTarget(208, 207), 'cursor');
    // (No room left: only the cursor.)
    assert.strictEqual(viewTarget(20, -10), 'cursor');
  });
});
