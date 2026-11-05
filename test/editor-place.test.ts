// The decisions behind the reader's place in the page's editor (src/ui/editorPlace.ts); test/web-editor-place.test.ts measures it.
import * as assert from 'assert';
import { firstNonBlank, holdGoesOn, placeOnClose, rowToKeep } from '../src/ui/editorPlace';

describe('the place in the editor', () => {
  const view = { top: 100, bottom: 500 };
  const row = (pos: number, top: number) => ({ pos, top, bottom: top + 20 });

  it('keeps the cursor\'s row when it lies whole in the view, and otherwise the first row that shows', () => {
    const first = row(7, 100);
    assert.strictEqual(rowToKeep(row(50, 300), first, view)?.pos, 50);
    // On the edges, whole.
    assert.strictEqual(rowToKeep(row(50, 100), first, view)?.pos, 50);
    assert.strictEqual(rowToKeep(row(50, 480), first, view)?.pos, 50);
    // Cut by an edge, out of the view, or not drawn at all.
    assert.strictEqual(rowToKeep(row(50, 95), first, view)?.pos, 7);
    assert.strictEqual(rowToKeep(row(50, 481), first, view)?.pos, 7);
    assert.strictEqual(rowToKeep(row(50, 900), first, view)?.pos, 7);
    assert.strictEqual(rowToKeep(null, first, view)?.pos, 7);
    assert.strictEqual(rowToKeep(null, null, view), null);
  });

  it('finds the first character that is not a blank, from where it is asked', () => {
    assert.strictEqual(firstNonBlank('  ab', 0), 2);
    assert.strictEqual(firstNonBlank('  ab', 3), 3);
    assert.strictEqual(firstNonBlank('a\t b', 1), 3);
    assert.strictEqual(firstNonBlank('a   ', 1), -1);
    assert.strictEqual(firstNonBlank('', 0), -1);
  });

  it('comes back to the place from before the opening unless the reader has moved', () => {
    const opened = { head: 10, scroll: 300, name: 'opened' };
    const same = { head: 10, scroll: 300.5, name: 'now' };
    assert.strictEqual(placeOnClose(opened, same, true).name, 'opened');
    assert.strictEqual(placeOnClose(opened, { ...same, scroll: 301 }, true).name, 'opened');
    assert.strictEqual(placeOnClose(opened, { ...same, scroll: 299 }, true).name, 'opened');
    // Scrolled, the cursor moved, or the text changed: the place they have now.
    assert.strictEqual(placeOnClose(opened, { ...same, scroll: 302 }, true).name, 'now');
    assert.strictEqual(placeOnClose(opened, { ...same, scroll: 200 }, true).name, 'now');
    assert.strictEqual(placeOnClose(opened, { ...same, head: 11 }, true).name, 'now');
    assert.strictEqual(placeOnClose(opened, same, false).name, 'now');
  });

  it('holds the place until frames have had nothing to correct, and not for ever', () => {
    assert.strictEqual(holdGoesOn(1, 0), true);
    assert.strictEqual(holdGoesOn(5, 2), true);
    assert.strictEqual(holdGoesOn(5, 3), false);
    assert.strictEqual(holdGoesOn(59, 0), true);
    assert.strictEqual(holdGoesOn(60, 0), false);
  });
});
