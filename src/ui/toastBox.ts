// Where the page's toast sits and how wide it may be (web/toast.ts, docs/design/chrome-redesign.md, C3): in the room of
// the editor's pane, and only where that room is too narrow to read it in, over the pane's edge, but never out of the window.

/** The space around the toast, in pixels: from the Problems list below it, from the pane's sides, and from the window's edge. */
export const TOAST_GAP = 8;

/** The narrowest room a toast is wrapped in (inside its gaps): its words go on two or three rows there, and read. */
export const TOAST_READABLE = 160;

/**
 * The width a toast has where the pane is narrower than that: with the divider far to one side the pane can be 115 px
 * wide, and a toast wrapped in it had one letter on a row ("Sample cleared" took 79 x 262 px). It then goes over the
 * panel's edge, which is the lesser harm.
 */
export const TOAST_MIN_WIDTH = 240;

/** The toast's left edge and its largest width, in the window's pixels; `room` is the pane's box, `win` the window's width. */
export function toastBox(room: { left: number; width: number }, win: number): { left: number; maxWidth: number } {
  const inside = room.width - 2 * TOAST_GAP;
  // What it keeps in the window, right of its left edge: the readable room, or the minimum where the pane is too narrow for that.
  // (A window narrower than that plus the gaps: the toast takes what the window has.)
  const keep = Math.max(0, Math.min(inside >= TOAST_READABLE ? TOAST_READABLE : TOAST_MIN_WIDTH, win - 2 * TOAST_GAP));
  const left = Math.min(Math.max(TOAST_GAP, room.left + TOAST_GAP), win - TOAST_GAP - keep);
  const maxWidth = Math.max(keep, Math.min(inside, win - TOAST_GAP - left));
  return { left, maxWidth };
}
