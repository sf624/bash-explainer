// The phone's bottom sheet as data (src/ui/sheet.ts; docs/design/chrome-redesign.md, step C8a): its heights, where a
// drag, a tap or a key leaves it, and the forms of its header row. The page measures and wires them
// (test/web-sheet.test.ts).
import * as assert from 'assert';
import { problemCounts, settle, sheetForms, type Snap, snapHeights, tapped, keyed } from '../src/ui/sheet';
import { viewControl } from '../src/ui/panelView';

describe('the phone\'s sheet as data', () => {
  it('gives the heights from the window, the full sheet\'s top and the header row, and keeps them in order', () => {
    // An iPhone 13 (844 px), the strip's bottom at 53 px, the header row 48 px.
    assert.deepStrictEqual(snapHeights(844, 53, 48), { peek: 48, half: 464, full: 791 });
    assert.deepStrictEqual(snapHeights(740, 97.4, 48), { peek: 48, half: 407, full: 643 });
    // A short window (a phone turned): half is never over full, and nothing is under the peek.
    assert.deepStrictEqual(snapHeights(300, 53, 48), { peek: 48, half: 165, full: 247 });
    assert.deepStrictEqual(snapHeights(120, 53, 48), { peek: 48, half: 66, full: 67 });
    assert.deepStrictEqual(snapHeights(80, 53, 48), { peek: 48, half: 48, full: 48 });
  });

  it('settles a drag on a height from where the finger lets go and how fast it moves', () => {
    const h = snapHeights(844, 53, 48);
    // [height when released, speed in px/ms (up is positive), the height it settles on]
    const table: [number, number, Snap][] = [
      // Slow: the nearest height to where the speed carries it in 150 ms.
      [48, 0, 'peek'],
      [200, 0, 'peek'],
      [300, 0, 'half'],
      [464, 0, 'half'],
      [620, 0, 'half'],
      [650, 0, 'full'],
      [791, 0, 'full'],
      [240, 0.4, 'half'],
      [600, 0.4, 'full'],
      [300, -0.4, 'peek'],
      [700, -0.4, 'full'],
      [640, -0.4, 'half'],
      // A fling: the next height in its direction, even near another.
      [60, 0.5, 'half'],
      [470, 0.6, 'full'],
      [464, 2, 'full'],
      [780, 3, 'full'],
      [791, 1, 'full'],
      [780, -0.5, 'half'],
      [464, -0.8, 'peek'],
      [460, -0.8, 'peek'],
      [48, -2, 'peek'],
      // Past the ends (a drag beyond them is clamped by the page; the rule needs no clamp).
      [900, 0, 'full'],
      [10, 0, 'peek'],
    ];
    for (const [height, v, want] of table) assert.strictEqual(settle(h, height, v), want, `${height} px at ${v} px/ms`);
    // Two heights the same (a short window): the lower one wins a tie, and a fling still finds its way.
    const short = snapHeights(80, 53, 48);
    assert.strictEqual(settle(short, 48, 0), 'peek');
    assert.strictEqual(settle(short, 48, 1), 'full');
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

  it('gives the header row\'s forms in order: the tools, then "Ref", then the line, then the highest level only', () => {
    for (const lang of ['en', 'ja'] as const) {
      const control = viewControl({}, lang);
      const [segments, menu] = [{ kind: 'segments' }, { kind: 'menu', button: control.options.map((o) => ({ text: o.short, name: `${control.label}: ${o.full}` })) }];
      assert.deepStrictEqual(sheetForms(control), [
        { view: segments, tools: 'under', line: true, ref: 'full', counts: 'all' },
        { view: menu, tools: 'under', line: true, ref: 'full', counts: 'all' },
        { view: segments, tools: 'none', line: true, ref: 'full', counts: 'all' },
        { view: menu, tools: 'none', line: true, ref: 'full', counts: 'all' },
        { view: menu, tools: 'none', line: true, ref: 'short', counts: 'all' },
        { view: menu, tools: 'none', line: false, ref: 'short', counts: 'all' },
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
