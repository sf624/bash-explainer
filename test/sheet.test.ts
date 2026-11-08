// The phone's bottom sheet as data (src/ui/sheet.ts; docs/design/chrome-redesign.md, steps C8a and C8b): its heights,
// where a drag, a tap or a key leaves it, its height while the keyboard is open, and the forms of its header row. The page measures and wires them
// (test/web-sheet.test.ts).
import * as assert from 'assert';
import { cursorFollows, dragRange, FLING, FLING_TRAVEL, FULL_GAP, problemCounts, settle, SHEET_TOOLS_WIDTH, sheetForms, sheetHeight, type Snap, snapHeights, tapped, keyed } from '../src/ui/sheet';
import { viewControlForms } from '../src/ui/panelHead';
import { viewControl } from '../src/ui/panelView';

describe('the phone\'s sheet as data', () => {
  it('gives the heights from the window, the full sheet\'s top, the header row and the summary row, and keeps them in order', () => {
    // An iPhone 13 (844 px), the strip's bottom at 44 px, the header (the grab strip and the tabs row) 93 px with the
    // sheet's edge, the summary row 48 px: the peek is both (decision 5), and a full sheet stops 8 px under the strip, so
    // that a tap just above it is not on the file's name (usability-9.md, 2.5).
    assert.strictEqual(FULL_GAP, 8);
    assert.deepStrictEqual(snapHeights(844, 44, 93, 48), { peek: 141, half: 464, full: 792 });
    assert.deepStrictEqual(snapHeights(844, 53, 49, 48), { peek: 97, half: 464, full: 783 });
    assert.deepStrictEqual(snapHeights(740, 97.4, 49, 48), { peek: 97, half: 407, full: 635 });
    // With a phone's safe area at the bottom (34 px), the peek keeps it.
    assert.deepStrictEqual(snapHeights(844, 53, 83, 48), { peek: 131, half: 464, full: 783 });
    // A short window (a phone turned): half is never over full, and nothing is under the peek.
    assert.deepStrictEqual(snapHeights(300, 53, 49, 48), { peek: 97, half: 165, full: 239 });
    assert.deepStrictEqual(snapHeights(160, 53, 49, 48), { peek: 97, half: 97, full: 99 });
    assert.deepStrictEqual(snapHeights(120, 53, 49, 48), { peek: 97, half: 97, full: 97 });
  });

  it('is the summary row alone on the keyboard\'s top while the keyboard is open, and ends the editor at its top', () => {
    const h = snapHeights(844, 53, 49, 48);
    const closed = {};
    // Closed: the height chosen; the editor's room ends at the sheet's top at half or lower, and as at half under a full
    // sheet. Its box ends at the peek at every height, and what the sheet covers of it is the rest; the room under the
    // text is the same at every height, so that no move cuts the scroll short.
    assert.deepStrictEqual((['peek', 'half', 'full'] as Snap[]).map((s) => sheetHeight(h, s, closed, 49)), [
      { height: 97, rest: 97, box: 97, cover: 0, past: 367 }, { height: 464, rest: 464, box: 97, cover: 367, past: 367 }, { height: 783, rest: 464, box: 97, cover: 367, past: 367 },
    ]);
    // Open on Android (the window shrank: nothing covered), on iOS (the keyboard covers 336 px of the window), and on a
    // zoomed page (the row is drawn at its own size, so it takes fewer of the window's px), at any height chosen.
    const place = (bottom: number, zoom = 1) => ({ place: { left: 0, bottom, width: 390, zoom } });
    for (const snap of ['peek', 'half'] as Snap[]) {
      assert.deepStrictEqual(sheetHeight(h, snap, place(0), 49), { height: 49, rest: 49, box: 49, cover: 0, past: 367 });
      assert.deepStrictEqual(sheetHeight(h, snap, place(336), 49), { height: 385, rest: 385, box: 385, cover: 0, past: 367 });
      assert.deepStrictEqual(sheetHeight(h, snap, place(336, 1 / 1.25), 49), { height: 376, rest: 376, box: 376, cover: 0, past: 367 });
    }
  });

  it('brings the cursor\'s line back after a move where it showed, but when the fold stays on with no less room (a pan with the keyboard open)', () => {
    const room = { width: 390, height: 300, fold: true };
    assert.strictEqual(cursorFollows(room, room, true), false);
    assert.strictEqual(cursorFollows(room, { ...room, height: 340 }, true), false);
    assert.strictEqual(cursorFollows(room, { ...room, height: 260 }, true), true);
    assert.strictEqual(cursorFollows(room, { ...room, width: 844 }, true), true);
    // The fold starting or ending; the sheet's own moves, as ever.
    assert.strictEqual(cursorFollows(undefined, room, true), true);
    assert.strictEqual(cursorFollows({ ...room, fold: false }, room, true), true);
    assert.strictEqual(cursorFollows(room, { ...room, fold: false }, true), true);
    assert.strictEqual(cursorFollows({ ...room, fold: false }, { ...room, fold: false, height: 340 }, true), true);
    // A reader who scrolled away from the cursor stays where they read, whatever moved (#659: 4,058 px back to the top).
    for (const [before, now] of [[undefined, room], [{ ...room, fold: false }, room], [room, { ...room, height: 260 }], [{ ...room, fold: false }, { ...room, fold: false, height: 340 }]] as const) {
      assert.strictEqual(cursorFollows(before, now, false), false);
    }
  });

  it('settles a drag on a height from where the finger lets go and how fast it moves', () => {
    const h = snapHeights(844, 53, 48, 0);
    // [height when released, speed in px/ms (up is positive), the height it settles on]
    const table: [number, number, Snap][] = [
      // Slow: the nearest height to where the speed carries it in 150 ms.
      [48, 0, 'peek'],
      [200, 0, 'peek'],
      [300, 0, 'half'],
      [464, 0, 'half'],
      [620, 0, 'half'],
      [650, 0, 'full'],
      [783, 0, 'full'],
      [240, 0.4, 'half'],
      [600, 0.4, 'full'],
      [300, -0.4, 'peek'],
      [700, -0.4, 'full'],
      [640, -0.4, 'half'],
      // Under 1 px/ms, carried (at 0.5 and 0.6 px/ms, it used to be a fling).
      [60, 0.5, 'peek'],
      [470, 0.6, 'half'],
      // A fling: the next height in its direction, even near another.
      [60, 1, 'half'],
      [470, 1.2, 'full'],
      [464, 2, 'full'],
      [780, 3, 'full'],
      [783, 1, 'full'],
      [780, -1, 'half'],
      [464, -1.5, 'peek'],
      [460, -1.5, 'peek'],
      [48, -2, 'peek'],
      // Past the ends (a drag beyond them is clamped by the page; the rule needs no clamp).
      [900, 0, 'full'],
      [10, 0, 'peek'],
    ];
    // (Each drag 200 px long, in the way it goes.)
    for (const [height, v, want] of table) assert.strictEqual(settle(h, height, v, v < 0 ? -200 : 200), want, `${height} px at ${v} px/ms`);
    assert.deepStrictEqual([FLING, FLING_TRAVEL], [1, 80]);
    // A short flick is neither flung nor carried: the nearest height to where it is let go (usability-9.md, 2.5: a flick
    // of 66 px up from half went to full). [height when released, speed, the drag's length, the height it settles on]
    const short: [number, number, number, Snap][] = [
      [530, 2, 66, 'half'],
      [398, -3, -66, 'half'],
      [600, 0.9, 70, 'half'],
      [600, 0.9, 80, 'full'],
      [544, 1, 80, 'full'],
      [544, 1, 79, 'half'],
      [114, -1, -79, 'peek'],
    ];
    for (const [height, v, travel, want] of short) assert.strictEqual(settle(h, height, v, travel), want, `${height} px at ${v} px/ms after ${travel} px`);
    // Two heights the same (a short window): the lower one wins a tie, and a fling still finds its way.
    const low = snapHeights(120, 53, 49, 48);
    assert.strictEqual(settle(low, 97, 0, 0), 'peek');
    assert.strictEqual(settle(low, 97, 1, 100), 'full');
  });

  it('keeps a drag under the app bar while the bar shows, and lets it reach the full height once the bar is away', () => {
    // An iPhone 13: the bar's bottom at 48 px, the strip's at 92 px (44 px once the bar is away), so a full sheet stops at 52 px.
    const h = snapHeights(844, 44, 93, 48);
    assert.deepStrictEqual(dragRange(h, 844, 48), { min: 141, max: 792 });
    // A strip lower than the bar: the drag stops at the bar's bottom, and the sheet settles at full from there.
    const low = snapHeights(844, 20, 93, 48);
    assert.deepStrictEqual([low.full, dragRange(low, 844, 48)], [816, { min: 141, max: 796 }]);
    assert.strictEqual(settle(low, 796, 0, 300), 'full');
    // Under a preview's banner (40 px), and at full, where the bar has slid away above the window.
    assert.deepStrictEqual(dragRange(snapHeights(844, 84, 93, 48), 844, 88), { min: 141, max: 752 });
    assert.deepStrictEqual(dragRange(low, 844, 0), { min: 141, max: 816 });
    // A short window: never under the peek.
    assert.deepStrictEqual(dragRange(snapHeights(120, 53, 49, 48), 120, 48), { min: 97, max: 97 });
  });

  it('cycles the heights on a tap and on Enter, and steps them with the arrow keys, Home and End', () => {
    assert.deepStrictEqual((['peek', 'half', 'full'] as Snap[]).map(tapped), ['half', 'full', 'peek']);
    const keys = ['ArrowUp', 'ArrowDown', 'Home', 'End', 'ArrowLeft', 'Enter'];
    assert.deepStrictEqual((['peek', 'half', 'full'] as Snap[]).map((s) => keys.map((k) => keyed(s, k))), [
      ['half', 'peek', 'peek', 'full', undefined, 'half'],
      ['full', 'peek', 'peek', 'full', undefined, 'full'],
      ['full', 'half', 'peek', 'full', undefined, 'peek'],
    ]);
  });

  it('gives the header row\'s forms in order: the tools (on a tablet\'s row only), then "Ref", then the highest level only, then the line', () => {
    for (const lang of ['en', 'ja'] as const) {
      const control = viewControl({}, lang);
      const [segments, menu] = viewControlForms(control);
      // (A phone's row has no tools, in every language: their room does not depend on the words' widths.)
      assert.deepStrictEqual(sheetForms(control, SHEET_TOOLS_WIDTH - 1), sheetForms(control, SHEET_TOOLS_WIDTH).filter((f) => f.tools === 'none'), lang);
      assert.deepStrictEqual(sheetForms(control, SHEET_TOOLS_WIDTH), [
        { view: segments, tools: 'under', line: true, ref: 'full', counts: 'all' },
        { view: menu, tools: 'under', line: true, ref: 'full', counts: 'all' },
        { view: segments, tools: 'none', line: true, ref: 'full', counts: 'all' },
        { view: menu, tools: 'none', line: true, ref: 'full', counts: 'all' },
        { view: menu, tools: 'none', line: true, ref: 'short', counts: 'all' },
        { view: menu, tools: 'none', line: true, ref: 'short', counts: 'top' },
        { view: menu, tools: 'none', line: false, ref: 'short', counts: 'top' },
      ], lang);
    }
  });

  it('counts the problems by level, highest first, and leaves out a level with none', () => {
    const levels = ['info', 'warning', 'info', 'warning', 'warning', 'error'] as const;
    assert.deepStrictEqual(problemCounts(levels, 'all'), [{ level: 'error', n: 1 }, { level: 'warning', n: 3 }, { level: 'info', n: 2 }]);
    assert.deepStrictEqual(problemCounts(levels, 'top'), [{ level: 'error', n: 1 }]);
    assert.deepStrictEqual(problemCounts(['info', 'warning'], 'all'), [{ level: 'warning', n: 1 }, { level: 'info', n: 1 }]);
    assert.deepStrictEqual(problemCounts(['info'], 'top'), [{ level: 'info', n: 1 }]);
    assert.deepStrictEqual(problemCounts([], 'all'), []);
    assert.deepStrictEqual(problemCounts([], 'top'), []);
  });
});
