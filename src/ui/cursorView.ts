// What the editor scrolls into view when a message over it or the phone's sheet changes its room (web/editor.ts
// `keepLineInView`): the cursor's whole line when it fits in the room, so that the reader sees the line the explanation is
// about; else the cursor, which is where a reader types (a wrapped line taller than the room would otherwise scroll its end
// out of view while typing). Only up or down: with long lines unwrapped, the line's end is far to the right of what is read.

/** What to bring into view: the cursor's line (all the rows it wraps to) or the cursor alone. */
export function viewTarget(lineHeight: number, room: number): 'line' | 'cursor' {
  return lineHeight <= room ? 'line' : 'cursor';
}

/** A stretch of the window, from top to bottom, in pixels. */
export interface Span { top: number; bottom: number }

/** The space kept between what is brought into view and the room's edge (CodeMirror's own `scrollIntoView` keeps 5 px). */
export const VIEW_MARGIN = 5;

/**
 * How far to scroll down (negative: up) so that `target` is in `room`, and not at all when it is in already. A target
 * taller than the room shows its top.
 */
export function scrollToShow(target: Span, room: Span): number {
  const above = target.top - room.top - VIEW_MARGIN;
  if (above < 0) return above;
  return Math.max(0, Math.min(above, target.bottom - room.bottom + VIEW_MARGIN));
}
