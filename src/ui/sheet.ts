import { levelTally, type NoteLevel } from '../levels';
import { type ViewForm, viewControlForms } from './panelHead';
import type { ViewControl } from './panelView';

// The phone's bottom sheet on the web page (docs/design/chrome-redesign.md, step C8a): its heights, the height it
// settles on after a drag, a tap or a key, and the forms of its header row. The page (web/sheet.ts, web/panel-head.ts)
// measures, draws and wires the events; every decision is here.

/** The sheet's heights, lowest first: its header row alone, about half the window, and up to the strip above the editor. */
export const SNAPS = ['peek', 'half', 'full'] as const;
export type Snap = (typeof SNAPS)[number];
export type SnapHeights = Record<Snap, number>;

/** The half height's share of the window. */
export const HALF_SHARE = 0.55;
/** A release at least this fast (px per ms, 500 px a second) is a fling: the sheet goes on to the next height that way. */
export const FLING = 0.5;
/** A slower release still carries the sheet as far as it would go in this many ms, then to the nearest height. */
export const CARRY_MS = 150;

/**
 * The heights in px, from the window's height (`view`), the top a full sheet reaches (the strip's bottom, once the app
 * bar has slid away) and the height of the header row with the bottom's safe area (`peek`). A height is never under
 * the peek nor over the full one, so on a short window two of them may be the same.
 */
export function snapHeights(view: number, top: number, peek: number): SnapHeights {
  const full = Math.max(peek, Math.round(view - top));
  return { peek, half: Math.min(full, Math.max(peek, Math.round(view * HALF_SHARE))), full };
}

/**
 * The height a drag settles on, from the sheet's height when the finger lets go (px) and its speed then (px per ms,
 * positive upwards). A fling goes to the next height in its direction (the highest or lowest when none is left);
 * otherwise the sheet goes to the height nearest to where its speed would carry it in `CARRY_MS`.
 */
export function settle(heights: SnapHeights, height: number, velocity: number): Snap {
  if (Math.abs(velocity) >= FLING) {
    const way = velocity > 0 ? [...SNAPS] : [...SNAPS].reverse();
    return way.find((s) => (velocity > 0 ? heights[s] > height : heights[s] < height)) ?? way[way.length - 1];
  }
  const to = height + velocity * CARRY_MS;
  return SNAPS.reduce((a, b) => (Math.abs(heights[b] - to) < Math.abs(heights[a] - to) ? b : a));
}

/** A tap on the grabber: peek → half → full → peek. */
export function tapped(snap: Snap): Snap {
  return SNAPS[(SNAPS.indexOf(snap) + 1) % SNAPS.length];
}

/** A key on the grabber: ↑ one height higher, ↓ one lower, Home the peek, End full; undefined for any other key. */
export function keyed(snap: Snap, key: string): Snap | undefined {
  const at = SNAPS.indexOf(snap);
  const to = ({ ArrowUp: Math.min(at + 1, SNAPS.length - 1), ArrowDown: Math.max(at - 1, 0), Home: 0, End: SNAPS.length - 1 } as Record<string, number>)[key];
  return to === undefined ? undefined : SNAPS[to];
}

/**
 * A form of the sheet's header row (decision 9): the view control's form; the panel's tools with their words under
 * their icons, or not in the row; the Explanation tab with its quiet line ("Ln 8") or without; the Reference tab's word
 * in full or short ("Ref"); the Problems tab with the count of each level that has problems, or of the highest only.
 */
export interface SheetForm {
  view: ViewForm;
  tools: 'under' | 'none';
  line: boolean;
  ref: 'full' | 'short';
  counts: 'all' | 'top';
}

/**
 * The forms of the sheet's header row, in order: the page takes the first that fits. The tools go first (on a tablet
 * the row has room for them; on a phone they leave it: the explanation's rows fold one by one), then "Reference" is
 * shortened, then the line goes, and last the Problems tab keeps only its highest level.
 */
export function sheetForms(control: ViewControl): SheetForm[] {
  const views = viewControlForms(control);
  const menu = views[views.length - 1];
  const full = { line: true, ref: 'full' as const, counts: 'all' as const };
  return [
    ...views.map((view) => ({ view, tools: 'under' as const, ...full })),
    ...views.map((view) => ({ view, tools: 'none' as const, ...full })),
    { view: menu, tools: 'none', ...full, ref: 'short' },
    { view: menu, tools: 'none', ...full, ref: 'short', line: false },
    { view: menu, tools: 'none', ...full, ref: 'short', line: false, counts: 'top' },
  ];
}

/** What the Problems tab shows while there is no problem (its name says "No problems"). */
export const NO_PROBLEMS = '✓';

/** The counts the Problems tab shows, from the level of each problem: every level that has problems, highest first, or the highest only. */
export function problemCounts(levels: readonly NoteLevel[], counts: SheetForm['counts']): { level: NoteLevel; n: number }[] {
  const tally = levelTally(levels);
  return counts === 'all' ? tally : tally.slice(0, 1);
}
