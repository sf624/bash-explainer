// Where the web page's hover card goes (docs/design/chrome-redesign.md, decision 10; docs/design/hover.md, "Web
// page"): under the whole line it is about (a wrapped line is one), or above its first row when there is more room
// there, never over a row of the line; and how high it may be. The page measures, this decides (web/hover.ts).

/** A box on the page, in CSS pixels. */
export interface Box { readonly top: number; readonly bottom: number }

/** A card is never higher than this, nor than half the window: a longer one scrolls inside. */
export const CARD_CAP = 420;
/** The space left between the line and the card, and between the card and the edge of its room. */
export const CARD_GAP = 4;
/** Below this room under the line, a card goes above it when there is more room there. */
const ENOUGH = 200;
/** A card needs this room at least: with less on both sides of the line, it goes over the line instead. */
export const CARD_MIN = 120;

export interface CardPlace {
  /** The card goes above the line's first row (or, over the line, above the hovered row). */
  readonly above: boolean;
  /**
   * The line has no room for a card on either side (a line taller than its room): the card goes by the hovered row,
   * over the line's other rows, on the side with more room.
   */
  readonly overLine: boolean;
  /** Its height at most, in pixels. */
  readonly maxHeight: number;
}

/**
 * The card of a line whose rows span `line`, hovered on its row `row`, in a room `space` (the editor's pane, inside the
 * window), with a window `windowHeight` high: below the line when the room there holds a whole card or a good part of
 * one, else on the side with more room; at most `CARD_CAP` and half the window high, and never past its room. When
 * neither side has `CARD_MIN` (a long line in a short pane), it goes by the hovered row instead, over the line's other
 * rows, at least `CARD_MIN` high: a sliver of a card helps no one.
 */
export function cardPlace(line: Box, row: Box, space: Box, windowHeight: number): CardPlace {
  const cap = Math.min(CARD_CAP, Math.round(windowHeight / 2));
  const room = (of: Box) => ({ below: space.bottom - of.bottom - 2 * CARD_GAP, above: of.top - space.top - 2 * CARD_GAP });
  const { below, above } = room(line);
  if (Math.max(below, above) < Math.min(CARD_MIN, cap)) {
    const by = room(row);
    return { above: by.above > by.below, overLine: true, maxHeight: Math.round(Math.min(cap, Math.max(CARD_MIN, by.above, by.below))) };
  }
  const under = below >= Math.min(cap, ENOUGH) || below >= above;
  return { above: !under, overLine: false, maxHeight: Math.round(Math.min(cap, under ? below : above)) };
}

/** Where the pointer was, and when (milliseconds). */
export interface PointerAt { readonly x: number; readonly y: number; readonly time: number }

/** How long the pointer may take from the part to its card across the line's other rows. */
export const CARD_GRACE = 600;

/**
 * Whether a card stays while the pointer is off its part (decision 10): the pointer was last on the part at `left`, on
 * the line's row `row`, and is now at `now`. It stays while `now` is past that row on the card's side (in the line's
 * later rows, or the gap to the card, not past the card's edge), more than 2 px nearer the card than `left`, and within
 * `CARD_GRACE` of `left`. Only `now` is compared with `left`, not with the move before it: a pointer that turns back
 * within those rows keeps the card until the time is up. So the card is not lost to the words of the line's later rows
 * on the way to it, as a menu keeps its submenu; a move along the part's row, or back to it, is the editor's as usual
 * (another word's card, a selection).
 */
export function towardCard(left: PointerAt, now: PointerAt, row: Box, line: Box, card: Box): boolean {
  if (now.time - left.time > CARD_GRACE) return false;
  const below = card.top >= line.bottom - 1;
  return below ? now.y > row.bottom && now.y <= card.top && now.y > left.y + 2 : now.y < row.top && now.y >= card.bottom && now.y < left.y - 2;
}
