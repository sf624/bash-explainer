// The phone's on-screen keyboard (docs/design/chrome-redesign.md, step C8b): the page reads the window's and the visual
// viewport's numbers at each change, and src/ui/keyboard.ts tells from them whether the keyboard is open over the
// editor while the user types there, and how much of the window it covers. The sheet (web/sheet.ts) follows.
import { keyboard, type Keyboard, type Tallest } from '../src/ui/keyboard';

export interface KeyboardHost {
  /** The user types in the editor: the sheet's layout, Edit mode, and the focus in the editor. */
  typing(): boolean;
  /** The keyboard opened, closed, or covers another part of the window. */
  changed(k: Keyboard): void;
}

/** Follows the keyboard: on the visual viewport's changes, the window's, and the editor's focus (`editor`, its text's element). */
export function watchKeyboard(editor: HTMLElement, host: KeyboardHost): void {
  const vv = window.visualViewport;
  // (Every browser the page supports has one.)
  if (!vv) return;
  let tallest: Tallest | undefined;
  let last: Keyboard | undefined;
  const check = () => {
    const k = keyboard(tallest, { width: window.innerWidth, height: window.innerHeight, visualHeight: vv.height, visualTop: vv.offsetTop, scale: vv.scale }, host.typing());
    tallest = k.tallest;
    if (last && last.open === k.open && last.overlap === k.overlap) return;
    last = k;
    host.changed(k);
  };
  vv.addEventListener('resize', check);
  vv.addEventListener('scroll', check);
  window.addEventListener('resize', check);
  // (Typing starts and stops with the focus; the keyboard comes after it, and goes with it.)
  editor.addEventListener('focus', check);
  editor.addEventListener('blur', check);
  check();
}
