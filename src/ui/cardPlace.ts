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

export interface CardPlace {
  /** The card goes above the line's first row. */
  readonly above: boolean;
  /** Its height at most, in pixels. */
  readonly maxHeight: number;
}

/**
 * The card of a line whose rows span `line`, in a room `space` (the editor's pane, inside the window), with a window
 * `windowHeight` high: below the line when the room there holds a whole card or a good part of one, else on the side
 * with more room; at most `CARD_CAP` and half the window high, and never past its room.
 */
export function cardPlace(line: Box, space: Box, windowHeight: number): CardPlace {
  const cap = Math.min(CARD_CAP, Math.round(windowHeight / 2));
  const below = space.bottom - line.bottom - 2 * CARD_GAP;
  const above = line.top - space.top - 2 * CARD_GAP;
  const under = below >= Math.min(cap, ENOUGH) || below >= above;
  return { above: !under, maxHeight: Math.max(0, Math.round(Math.min(cap, under ? below : above))) };
}

/** Where the pointer was, and when (milliseconds). */
export interface PointerAt { readonly x: number; readonly y: number; readonly time: number }

/** How long the pointer may take from the part to its card across the line's other rows. */
export const CARD_GRACE = 600;

/**
 * Whether a card stays while the pointer is off its part (decision 10): the pointer left the part at `left`, and is now
 * at `now`, still between the part and the card (inside the line's rows, or in the gap to the card), not moving away
 * from the card, within `CARD_GRACE`. So the card is not lost to the words of the line's later rows on the way to it,
 * as a menu keeps its submenu.
 */
export function towardCard(left: PointerAt, now: PointerAt, line: Box, card: Box): boolean {
  if (now.time - left.time > CARD_GRACE) return false;
  const below = card.top >= line.bottom - 1;
  // The band between the part's row and the card: the line's rows, and the gap to the card.
  const top = below ? line.top : card.bottom;
  const bottom = below ? card.top : line.bottom;
  if (now.y < top || now.y > bottom) return false;
  // Moving towards the card, or resting (a few pixels of jitter).
  return below ? now.y >= left.y - 2 : now.y <= left.y + 2;
}
