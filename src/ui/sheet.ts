import { levelTally, type NoteLevel } from '../levels';
import type { Keyboard } from './keyboard';
import { type ViewForm, viewControlForms } from './panelHead';
import type { ViewControl } from './panelView';

// The phone's bottom sheet on the web page (docs/design/chrome-redesign.md, steps C8a and C8b): its heights, the height
// it settles on after a drag, a tap or a key, its height while the keyboard is open, and the forms of its header row.
// The page (web/sheet.ts, web/panel-head.ts) measures, draws and wires the events; every decision is here.

/** The sheet's heights, lowest first: its header row and the summary row under it, about half the window, and up to the strip above the editor. */
export const SNAPS = ['peek', 'half', 'full'] as const;
export type Snap = (typeof SNAPS)[number];
export type SnapHeights = Record<Snap, number>;

/** The half height's share of the window. */
export const HALF_SHARE = 0.55;
/**
 * A release at least this fast (px per ms, 1,000 px a second) is a fling: the sheet goes on to the next height that way
 * (docs/design/usability-9.md, 2.5: at 0.5 px/ms a flick of 66 px jumped to full), but to full only after `FLING_TRAVEL`.
 */
export const FLING = 1;
/** A slower release still carries the sheet as far as it would go in this many ms, then to the nearest height. */
export const CARRY_MS = 150;
/**
 * A fling (a quick release) up shorter than this (px, from where the finger took the sheet) that would reach full stops
 * at half: a short flick up from half does not open the sheet over the whole editor. A slow drag ends at the nearest height.
 */
export const FLING_TRAVEL = 80;
/** The room a full sheet leaves under the editor's header strip (px): a tap just above the sheet is not on the strip's file name. */
export const FULL_GAP = 8;

/**
 * The heights in px, from the window's height (`view`), the strip's bottom once the app bar has slid away (`top`: a full
 * sheet stops `FULL_GAP` under it), the height of the header (the grab strip and the tabs row) with the sheet's edge and
 * the bottom's safe area (`row`), and the summary row's (`summary`, step C8b): the peek is both (decision 5). A height is
 * never under the peek nor over the full one, so on a short window two of them may be the same.
 */
export function snapHeights(view: number, top: number, row: number, summary: number): SnapHeights {
  const peek = row + summary;
  const full = Math.max(peek, Math.round(view - top - FULL_GAP));
  return { peek, half: Math.min(full, Math.max(peek, Math.round(view * HALF_SHARE))), full };
}

/** The sheet on the page, and the editor around it, in px from the window's bottom. */
export interface SheetRoom {
  /** The sheet's height. */
  height: number;
  /** Where the editor's room ends: at the sheet's top at half or lower; at full, as at half, under the sheet. */
  rest: number;
  /**
   * Where the editor's box ends, which no move of the sheet changes: at the lowest the sheet goes. So the lines a sheet
   * uncovers are always laid out and drawn, under it, whichever way it moves and however far.
   */
  box: number;
  /** What the sheet covers of the box, at its height (`rest` above `box`): the cursor's line stays above it. */
  cover: number;
  /**
   * The room under the text, at every height: the last line can scroll up to the top of a half sheet, and a move never
   * cuts the scroll short, which would make the text jump.
   */
  past: number;
}

/**
 * The sheet's height on the page, and the editor around it (`SheetRoom`). While the keyboard is open over the editor
 * (src/ui/keyboard.ts), the sheet is its summary row alone (`summary`, with the sheet's edge, at the page's zoom) on the
 * keyboard's top, and what ends at the sheet (the editor, a toast's room) ends at the row, above the part of the window
 * the keyboard covers.
 */
export function sheetHeight(heights: SnapHeights, snap: Snap, keyboard: Pick<Keyboard, 'place'>, summary: number): SheetRoom {
  const { place } = keyboard;
  const past = heights.half - heights.peek;
  if (place) {
    const height = Math.ceil(summary * place.zoom) + place.bottom;
    return { height, rest: height, box: height, cover: 0, past };
  }
  const rest = Math.min(heights[snap], heights.half);
  return { height: heights[snap], rest, box: heights.peek, cover: rest - heights.peek, past };
}

/**
 * The editor's room: the window's width and height (`view`), what the sheet leaves of its height, and whether the
 * keyboard's fold is on.
 */
export interface EditorRoom {
  width: number;
  view: number;
  height: number;
  fold: boolean;
}

/**
 * Whether the cursor's line is brought back into view after the sheet moved or the window changed. Always when the
 * layout comes, when the keyboard's fold starts or ends (the reader types at the cursor), and when the window changes
 * (a phone turned): its old place says nothing of the new room. Under the fold only the width counts, since the keyboard
 * itself may change the window's height. Otherwise, a move of the sheet's own, only when the line showed before it
 * (`shown`: in what the sheet left of the editor), since a reader who scrolled away from it stays where they read (a
 * move pulled them back from 4,058 px to the top, #659); and not while the fold stays on with no less room, where the
 * moves are the visual viewport's pans (a reader scrolling with the keyboard open), which hide nothing.
 */
export function cursorFollows(before: EditorRoom | undefined, now: EditorRoom, shown: boolean): boolean {
  if (!before || before.fold !== now.fold || before.width !== now.width || (!now.fold && before.view !== now.view)) return true;
  return shown && (!now.fold || now.height < before.height);
}

/**
 * The heights a finger can take the sheet to while it drags: from the peek up to the full height, but never over the app
 * bar while it shows (`bar`, its bottom in px from the window's top; the bar slides away only once the sheet settles at
 * full), so that a drag does not cover the menu's button (docs/design/usability-9.md, 2.5).
 */
export function dragRange(heights: SnapHeights, view: number, bar: number): { min: number; max: number } {
  return { min: heights.peek, max: Math.max(heights.peek, Math.min(heights.full, Math.round(view - bar))) };
}

/**
 * The height a drag settles on, from the sheet's height when the finger lets go (px), its speed then (px per ms,
 * positive upwards), and how far it went from where the finger took the sheet (`travel`, px). A fling goes to the next
 * height in its direction (the highest or lowest when none is left), and a slower release to the height nearest to
 * where its speed would carry it in `CARRY_MS`. But a fling (or the carry of a release) up shorter than `FLING_TRAVEL`
 * that would reach full stops at half (the maintainer's decision of 2026-11-08, usability-9.md, 2.5); a slow drag ends
 * at the nearest height, and a short flick between the peek and half, or down from full, goes by its speed alone.
 */
export function settle(heights: SnapHeights, height: number, velocity: number, travel: number): Snap {
  const to = bySpeed(heights, height, velocity);
  // A slow drag that lets go nearest to full stays there: only a fling, or a release that its speed carried to full, is held.
  const held = Math.abs(velocity) >= FLING || nearest(heights, height) !== 'full';
  return to === 'full' && held && travel > 0 && travel < FLING_TRAVEL ? 'half' : to;
}

function nearest(heights: SnapHeights, at: number): Snap {
  return SNAPS.reduce((a, b) => (Math.abs(heights[b] - at) < Math.abs(heights[a] - at) ? b : a));
}

function bySpeed(heights: SnapHeights, height: number, velocity: number): Snap {
  if (Math.abs(velocity) >= FLING) {
    const way = velocity > 0 ? [...SNAPS] : [...SNAPS].reverse();
    return way.find((s) => (velocity > 0 ? heights[s] > height : heights[s] < height)) ?? way[way.length - 1];
  }
  return nearest(heights, height + velocity * CARRY_MS);
}

/** A tap on the grabber: peek → half → full → peek. */
export function tapped(snap: Snap): Snap {
  return SNAPS[(SNAPS.indexOf(snap) + 1) % SNAPS.length];
}

/**
 * A key on the grabber: ↑ one height higher, ↓ one lower, Home the peek, End full, Enter the next as a tap does;
 * undefined for any other key.
 */
export function keyed(snap: Snap, key: string): Snap | undefined {
  if (key === 'Enter') return tapped(snap);
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
 * The narrowest sheet's row, in px, that offers the panel's tools (a tablet's): a phone held upright never has them, in
 * every language, so that whether they show does not depend on how wide the words are (the maintainer, 2026-11-07: in
 * Japanese they fitted at 430 px and the depth's menu then lay under the grab bar). Copy as Markdown is in the menu then.
 */
export const SHEET_TOOLS_WIDTH = 600;

/**
 * The forms of the sheet's header row, in order: the page takes the first that fits. The tools go first where the row
 * is a tablet's (`SHEET_TOOLS_WIDTH`; on a phone they leave it: the explanation's rows fold one by one), then
 * "Reference" is shortened, then the Problems tab keeps only its highest level (its name still has every count), and
 * last the line goes (decision 9, the maintainer's order of 2026-11-01).
 */
export function sheetForms(control: ViewControl, rowWidth: number): SheetForm[] {
  const views = viewControlForms(control);
  const menu = views[views.length - 1];
  const full = { line: true, ref: 'full' as const, counts: 'all' as const };
  return [
    ...(rowWidth >= SHEET_TOOLS_WIDTH ? views.map((view) => ({ view, tools: 'under' as const, ...full })) : []),
    ...views.map((view) => ({ view, tools: 'none' as const, ...full })),
    { view: menu, tools: 'none', ...full, ref: 'short' },
    { view: menu, tools: 'none', ...full, ref: 'short', counts: 'top' },
    { view: menu, tools: 'none', ...full, ref: 'short', counts: 'top', line: false },
  ];
}

/** What the Problems tab shows while there is no problem (its name says "No problems"). */
export const NO_PROBLEMS = '✓';

/** The counts the Problems tab shows, from the level of each problem: every level that has problems, highest first, or the highest only. */
export function problemCounts(levels: readonly NoteLevel[], counts: SheetForm['counts']): { level: NoteLevel; n: number }[] {
  const tally = levelTally(levels);
  return counts === 'all' ? tally : tally.slice(0, 1);
}
