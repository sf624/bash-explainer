// The phone's on-screen keyboard as data (src/ui/keyboard.ts; docs/design/chrome-redesign.md, step C8b): whether it is
// open over the editor, and how much of the window it covers, from the window's and the visual viewport's numbers. The
// page reads them and folds the sheet (test/web-keyboard.test.ts).
import * as assert from 'assert';
import { keyboard, KEYBOARD_MIN, type Tallest, type Viewport } from '../src/ui/keyboard';

/** An iPhone 13 in Safari (390 × 664 px of window, the bars shown) and a Pixel 7 in Chrome (412 × 839). */
const view = (width: number, height: number, visualHeight = height, visualTop = 0, scale = 1): Viewport => ({ width, height, visualHeight, visualTop, scale });

describe('the phone\'s keyboard as data', () => {
  it('tells the keyboard on iOS, where only the visual viewport shrinks: it covers the window\'s bottom', () => {
    const before = keyboard(undefined, view(390, 664), true);
    assert.deepStrictEqual(before, { open: false, overlap: 0, tallest: { width: 390, height: 664 } });
    // The keyboard (336 px with its bar) over the window; Safari may scroll the visual viewport to the caret.
    assert.deepStrictEqual(keyboard(before.tallest, view(390, 664, 328), true), { open: true, overlap: 336, tallest: { width: 390, height: 664 } });
    assert.deepStrictEqual(keyboard(before.tallest, view(390, 664, 328, 40), true), { open: true, overlap: 296, tallest: { width: 390, height: 664 } });
    // Not while the user does not type in the editor (Read mode, the focus elsewhere: a field of the settings).
    assert.deepStrictEqual(keyboard(before.tallest, view(390, 664, 328), false), { open: false, overlap: 0, tallest: { width: 390, height: 664 } });
  });

  it('tells the keyboard on Android, where the window shrinks: it covers nothing', () => {
    const before = keyboard(undefined, view(412, 839), true).tallest;
    assert.deepStrictEqual(keyboard(before, view(412, 539), true), { open: true, overlap: 0, tallest: { width: 412, height: 839 } });
    // Closed again: the window as tall as before.
    assert.deepStrictEqual(keyboard(before, view(412, 839), true), { open: false, overlap: 0, tallest: { width: 412, height: 839 } });
  });

  it('takes the browser\'s bars and a pinch zoom for no keyboard, and starts again when the phone turns', () => {
    // The address bar shown again (56 px less), or Safari's bar expanded (less than KEYBOARD_MIN): no keyboard.
    let tallest: Tallest = keyboard(undefined, view(412, 895), true).tallest;
    assert.strictEqual(keyboard(tallest, view(412, 839), true).open, false);
    assert.strictEqual(keyboard(tallest, view(412, 895 - KEYBOARD_MIN + 1), true).open, false);
    assert.strictEqual(keyboard(tallest, view(412, 895 - KEYBOARD_MIN), true).open, true);
    // Zoomed in twice: half the visual viewport, and no keyboard; with one, the keyboard.
    assert.strictEqual(keyboard(tallest, view(412, 895, 447.5, 100, 2), true).open, false);
    assert.strictEqual(keyboard(tallest, view(412, 895, 297.5, 100, 2), true).open, true);
    // Turned: the tallest window is the new one's (a width within 1 px is the same).
    tallest = keyboard(tallest, view(895, 412), true).tallest;
    assert.deepStrictEqual(tallest, { width: 895, height: 412 });
    assert.deepStrictEqual(keyboard(tallest, view(895.5, 420), true).tallest, { width: 895.5, height: 420 });
  });
});
