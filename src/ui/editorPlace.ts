// The reader's place in the page's editor, kept while its width changes (docs/design/chrome-redesign.md, "The place across a
// rewrap"): the decisions. Measuring and scrolling are web/editor-place.ts.

/** A row of the editor: a position in the text, and where it is drawn, in the same coordinates as the view it is compared with. */
export interface PlaceRow {
  pos: number;
  top: number;
  bottom: number;
}

/** The row to keep: the cursor's when it lies whole in the view, otherwise the first one that shows (the same rule as the panel's `keepPlace`). */
export function rowToKeep(cursor: PlaceRow | null, first: PlaceRow | null, view: { top: number; bottom: number }): PlaceRow | null {
  return cursor && cursor.top >= view.top && cursor.bottom <= view.bottom ? cursor : first;
}

/** Where in `text`, from `from` on, the first character that is not a blank lies; -1 when there is none. */
export function firstNonBlank(text: string, from: number): number {
  const at = text.slice(from).search(/\S/);
  return at < 0 ? -1 : from + at;
}

/** What is compared at the close: where the cursor is, and the editor's scroll both ways (once the place has been kept, where it was left). */
export interface PlaceMark {
  head: number;
  scroll: number;
  sideways: number;
}

/** A scroll this close (in px) is the one the place was left at: the browser rounds what it is given. */
const SAME_SCROLL = 1;

/**
 * The place to keep when the settings close. The one from before they opened, if nothing has moved since, so that the editor
 * comes back as it was; if the text or the cursor changed, or the editor scrolled either way, the place the reader has now.
 */
export function placeOnClose<P extends PlaceMark>(opened: P, now: P, sameText: boolean): P {
  const same = sameText && now.head === opened.head && Math.abs(now.scroll - opened.scroll) <= SAME_SCROLL && Math.abs(now.sideways - opened.sideways) <= SAME_SCROLL;
  return same ? opened : now;
}

/** Where a row noted at `y` is kept in a view of `height`: where it was, unless the view has since become too low to show it there. */
export const yInView = (y: number, rowHeight: number, height: number): number => Math.min(y, height - rowHeight);

/** Frames with nothing to correct after which a rewrap is over; and the most frames a place is held in any case. */
const QUIET_FRAMES = 3;
const MOST_FRAMES = 60;

/** Whether to go on holding the place, after `frames` frames, the last `quiet` of them with nothing to correct. */
export const holdGoesOn = (frames: number, quiet: number): boolean => frames < MOST_FRAMES && quiet < QUIET_FRAMES;
