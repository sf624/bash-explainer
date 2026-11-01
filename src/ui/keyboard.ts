// The phone's on-screen keyboard on the web page (docs/design/chrome-redesign.md, step C8b): whether it is open over the
// editor, and how much of the window it covers, read from the window's and the visual viewport's numbers. The page
// (web/keyboard.ts) reads them at each change and folds the sheet to its summary row on the keyboard's top
// (web/sheet.ts); the decision is here.
//
// A browser shows the keyboard in one of two ways. iOS Safari keeps the window (the layout viewport) and shrinks only
// the visual viewport: the keyboard then covers the window's bottom, and the page lifts what is fixed there by that
// much (`overlap`). Chrome on Android, with `interactive-widget=resizes-content` (web/index.html), shrinks the window
// itself: nothing is covered. Both shrink the visual viewport, so that is what tells the keyboard; the window's own
// height, the tallest seen at this width, is what it is compared with (the browser's bars come and go by less).

/** What the page reads: the window's size (`innerWidth`, `innerHeight`) and the visual viewport's height, top and scale. */
export interface Viewport {
  width: number;
  height: number;
  visualHeight: number;
  visualTop: number;
  /** The pinch zoom: a zoomed-in page has a smaller visual viewport, with no keyboard. */
  scale: number;
}

/** The window's height with no keyboard: the tallest seen at this width (a phone turned starts again). */
export interface Tallest {
  width: number;
  height: number;
}

export interface Keyboard {
  /** The keyboard is open over the editor, while the user types in it. */
  open: boolean;
  /** How many px of the window's bottom it covers (iOS), 0 where the window shrank instead (Android) or when closed. */
  overlap: number;
  /** What the next reading compares with. */
  tallest: Tallest;
}

/**
 * Less than this shrinks a window by the browser's own bars (an address bar shown or hidden: about 50 to 100 px); an
 * on-screen keyboard takes more (about 250 px and over on a phone).
 */
export const KEYBOARD_MIN = 150;

/**
 * The keyboard from a reading of the viewport, while the user types in the editor (`typing`: Edit mode and the focus
 * in the editor), and the tallest window seen before (none at first).
 */
export function keyboard(before: Tallest | undefined, v: Viewport, typing: boolean): Keyboard {
  const tallest = { width: v.width, height: before && Math.abs(before.width - v.width) <= 1 ? Math.max(before.height, v.height) : v.height };
  const open = typing && tallest.height - v.visualHeight * v.scale >= KEYBOARD_MIN;
  const overlap = open ? Math.max(0, Math.round(v.height - v.visualTop - v.visualHeight)) : 0;
  return { open, overlap, tallest };
}
