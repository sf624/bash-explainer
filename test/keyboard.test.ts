// The phone's on-screen keyboard as data (src/ui/keyboard.ts; docs/design/chrome-redesign.md, step C8b): whether it is
// open over the editor, and where the summary row goes, from the window's and the visual viewport's numbers. The page
// reads them and folds the sheet (test/web-keyboard.test.ts).
import * as assert from 'assert';
import { keyboard, KEYBOARD_MIN, type Tallest, type Viewport } from '../src/ui/keyboard';

/** A reading: the window, and the visual viewport as much of it as `covered` leaves (from the bottom), scrolled by `top`. */
const view = (width: number, height: number, covered = 0, top = 0, scale = 1, left = 0): Viewport => ({
  width, height, visualLeft: left, visualTop: top, visualWidth: width / scale, visualHeight: (height - covered) / scale, scale,
});
/** What a reading says: where the row goes, and whether the keyboard is open. */
const open = (before: Tallest | undefined, v: Viewport, typing = true) => !!keyboard(before, v, typing).place;

describe('the phone\'s keyboard as data', () => {
  it('tells the keyboard on iOS, where only the visual viewport shrinks: the row is lifted by what it covers', () => {
    const before = keyboard(undefined, view(390, 664), false);
    assert.deepStrictEqual(before, { tallest: { width: 390, height: 664 } });
    const place = (bottom: number) => ({ left: 0, bottom, width: 390, zoom: 1 });
    assert.deepStrictEqual(keyboard(before.tallest, view(390, 664, 336), true), { place: place(336), tallest: { width: 390, height: 664 } });
    // Safari scrolls the visual viewport to the caret: the keyboard's top is lower in the window.
    assert.deepStrictEqual(keyboard(before.tallest, view(390, 664, 336, 40), true).place, place(296));
    // Scrolled further than what it covers: never under the window's bottom.
    assert.deepStrictEqual(keyboard(before.tallest, { ...view(390, 664, 200), visualTop: 300 }, true).place, place(0));
  });

  it('tells the keyboard on Android, where the window shrinks: it covers nothing', () => {
    const before = keyboard(undefined, view(412, 839), false).tallest;
    assert.deepStrictEqual(keyboard(before, view(412, 539), true), { place: { left: 0, bottom: 0, width: 412, zoom: 1 }, tallest: { width: 412, height: 839 } });
    // Closed with Back: the focus stays in the editor, and the window is as tall as before.
    assert.deepStrictEqual(keyboard(before, view(412, 839), true), { tallest: { width: 412, height: 839 } });
  });

  it('takes no keyboard while the user does not type, and each such reading is the new baseline', () => {
    const before = keyboard(undefined, view(390, 664), false).tallest;
    // A keyboard of another field (the file's name, the settings' search).
    assert.deepStrictEqual(keyboard(before, view(390, 664, 336), false), { tallest: { width: 390, height: 664 } });
    assert.deepStrictEqual(keyboard(before, view(390, 400), false), { tallest: { width: 390, height: 400 } });
  });

  it('takes a window short for another reason for no keyboard, when the focus comes after it: split screen, a foldable, a resize', () => {
    // Split screen: the window shrinks while the focus is elsewhere, then the editor takes it. No keyboard, and a keyboard then is seen from there.
    const split = keyboard(keyboard(undefined, view(390, 800), false).tallest, view(390, 400), false).tallest;
    assert.strictEqual(open(split, view(390, 400)), false);
    assert.strictEqual(open(split, view(390, 400 - KEYBOARD_MIN + 1)), false);
    assert.strictEqual(open(split, view(390, 400 - KEYBOARD_MIN)), true);
    // A hardware keyboard: the window never shrinks, so the focus alone is no keyboard.
    assert.strictEqual(open(keyboard(undefined, view(768, 1024), false).tallest, view(768, 1024)), false);
    // Rotated and back, the focus away: the last reading is the baseline, not the tallest ever seen.
    let t = keyboard(undefined, view(390, 844), false).tallest;
    t = keyboard(t, view(844, 390), false).tallest;
    t = keyboard(t, view(390, 700), false).tallest;
    assert.strictEqual(open(t, view(390, 700)), false);
  });

  it('keeps the tallest window while typing: the browser\'s bars, Safari\'s bottom bar collapsing, a phone turned', () => {
    // The address bar shown again (56 px less), or more than a bar can take.
    const before = keyboard(undefined, view(412, 895), false).tallest;
    assert.strictEqual(open(before, view(412, 839)), false);
    assert.strictEqual(open(before, view(412, 895 - KEYBOARD_MIN + 1)), false);
    assert.strictEqual(open(before, view(412, 895 - KEYBOARD_MIN)), true);
    // Safari's bottom bar collapses while typing: the window grows, and the bar coming back is no keyboard.
    const grown = keyboard(keyboard(undefined, view(390, 664), false).tallest, view(390, 745), true).tallest;
    assert.deepStrictEqual(grown, { width: 390, height: 745 });
    assert.strictEqual(open(grown, view(390, 664)), false);
    // Turned with the keyboard open: the new width starts again (a width within 1 px is the same). On iOS the window
    // does not shrink, so the keyboard is still seen; on Android it shows only once it has closed and opened again.
    assert.deepStrictEqual(keyboard(before, view(895, 412), true).tallest, { width: 895, height: 412 });
    assert.deepStrictEqual(keyboard(before, view(412.5, 900), true).tallest, { width: 412.5, height: 900 });
    assert.strictEqual(open({ width: 390, height: 844 }, view(844, 390, 200)), true);
    assert.strictEqual(open({ width: 412, height: 839 }, view(839, 212)), false);
  });

  it('keeps the row on the visual viewport of a zoomed page: a pinch is no keyboard, and the row is drawn at its own size', () => {
    const before = keyboard(undefined, view(412, 895), false).tallest;
    assert.strictEqual(open(before, view(412, 895, 0, 100, 2)), false);
    // iOS zooms into the editor (13 px text) by 1.25: the keyboard covers 300 px of the screen, and the visual viewport
    // is 312 × 356 of the window's px at (20, 40): the row at its bottom, drawn 390 px wide at 1 / 1.25.
    assert.deepStrictEqual(keyboard({ width: 390, height: 745 }, view(390, 745, 300, 40, 1.25, 20), true).place, { left: 20, bottom: 349, width: 390, zoom: 0.8 });
  });
});
