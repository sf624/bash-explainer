// The phone's on-screen keyboard (docs/design/chrome-redesign.md, step C8b): the page reads the window's and the visual
// viewport's numbers at each change, and src/ui/keyboard.ts tells from them whether the keyboard is open over the
// editor while the user types there, and where the summary row goes. The sheet (web/sheet.ts) follows.
import { keyboard, type Keyboard, type Tallest } from '../src/ui/keyboard';

export interface KeyboardHost {
  /** The user types in the editor: the sheet's layout, Edit mode, and the focus in the editor. */
  typing(): boolean;
  /** A new reading: the keyboard may have opened, closed or moved (the sheet tells, and keeps the fold's state). */
  changed(k: Keyboard): void;
}

/**
 * Follows the keyboard: on the visual viewport's changes, the window's, and the editor's focus (`editor`, its text's
 * element). Gives a function that reads again. The window is the layout viewport, the root's client box, which what is
 * fixed is placed in: Safari is said to report the visual viewport as `innerWidth` and `innerHeight` on a zoomed page.
 */
export function watchKeyboard(editor: HTMLElement, host: KeyboardHost): () => void {
  const vv = window.visualViewport;
  // (Every browser the page supports has one.)
  if (!vv) return () => undefined;
  const root = document.documentElement;
  let tallest: Tallest | undefined;
  const check = () => {
    const k = keyboard(tallest, { width: root.clientWidth, height: root.clientHeight, visualLeft: vv.offsetLeft, visualTop: vv.offsetTop, visualWidth: vv.width, visualHeight: vv.height, scale: vv.scale }, host.typing());
    tallest = k.tallest;
    host.changed(k);
  };
  vv.addEventListener('resize', check);
  vv.addEventListener('scroll', check);
  window.addEventListener('resize', check);
  // (Typing starts and stops with the focus; the keyboard comes after it, and goes with it.)
  editor.addEventListener('focus', check);
  editor.addEventListener('blur', check);
  check();
  return check;
}
