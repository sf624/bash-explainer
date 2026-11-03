// The phone's on-screen keyboard on the web page (docs/design/chrome-redesign.md, step C8b): whether it is open over the
// editor, and where the summary row goes on its top, read from the window's and the visual viewport's numbers. The page
// (web/keyboard.ts) reads them at each change and folds the sheet to its summary row (web/sheet.ts); the decision is here.
//
// A browser shows the keyboard in one of two ways. iOS Safari keeps the window (the layout viewport) and shrinks only
// the visual viewport: the keyboard then covers the window's bottom, and what is fixed there is lifted by that much
// (`RowPlace.bottom`). Chrome on Android, with `interactive-widget=resizes-content` (web/index.html), shrinks the window
// itself: nothing is covered. Both shrink the visual viewport, so that is what tells the keyboard. It is compared with
// the window as it was before the user started typing: a window that is short for another reason (split screen, a
// foldable, a hardware keyboard, which shows none) is no keyboard.

/** What the page reads: the layout viewport's size (the root's client box) and the visual viewport's box and scale. */
export interface Viewport {
  width: number;
  height: number;
  visualLeft: number;
  visualTop: number;
  visualWidth: number;
  visualHeight: number;
  /** The zoom: a pinch, or iOS zooming into a field whose text it finds too small (under 16 px). */
  scale: number;
}

/**
 * The window with no keyboard: its height at the last reading while the user did not type, and the tallest seen since
 * while typing (the keyboard closed with the focus kept, the browser's bar hidden). Turned, the phone starts again from
 * the reading of the new width.
 */
export interface Tallest {
  width: number;
  height: number;
}

/**
 * Where the summary row goes while the keyboard is open, in the window's px: along the visual viewport, its bottom on the
 * keyboard's top (`bottom`: what the keyboard covers of the window), and drawn at `zoom` (1 / the scale), so that a zoomed
 * page shows it whole and at its own size. With no zoom, it is the window's whole width.
 */
export interface RowPlace {
  left: number;
  bottom: number;
  /** Its width before the zoom: the visual viewport's, times the scale. */
  width: number;
  zoom: number;
}

export interface Keyboard {
  /** Where the summary row goes, while the keyboard is open over the editor; none when it is closed. */
  place?: RowPlace;
  /** What the next reading compares with. */
  tallest: Tallest;
}

/**
 * Less than this shrinks a window by the browser's own bars (an address bar shown or hidden: about 50 to 100 px); an
 * on-screen keyboard takes more (about 250 px and over on a phone).
 */
export const KEYBOARD_MIN = 150;

/**
 * The keyboard from a reading of the viewport, while the user types in the editor (`typing`: Edit mode and the focus in
 * the editor), and the window before (`before`; none at first). A reading while the user does not type is the new
 * baseline, whatever it shows.
 */
export function keyboard(before: Tallest | undefined, v: Viewport, typing: boolean): Keyboard {
  const keep = typing && before && Math.abs(before.width - v.width) <= 1;
  const tallest = { width: v.width, height: keep ? Math.max(before.height, v.height) : v.height };
  if (!typing || tallest.height - v.visualHeight * v.scale < KEYBOARD_MIN) return { tallest };
  const bottom = Math.max(0, Math.round(v.height - v.visualTop - v.visualHeight));
  return { place: { left: Math.round(v.visualLeft), bottom, width: Math.round(v.visualWidth * v.scale), zoom: 1 / v.scale }, tallest };
}
