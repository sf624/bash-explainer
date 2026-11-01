// The page's toasts (docs/design/chrome-redesign.md, C3, decision 8): one component, one look, one place. A toast has
// an icon (↶ it can be undone, ✓ done, • a refusal or a note: not ⓘ, which is the Info level's mark), a short text, and at most a button (Undo) and a longer
// text behind "More" or "Why?". It shows above the Problems list, inside the editor's pane: never over the explanation
// or the panel's header. While it shows, the editor keeps the cursor's line above it (a bottom scroll margin). How long
// it stays is src/ui/toastTimer.ts: 4 s, 8 s with a button, held while the pointer or the keyboard's focus is on it.
// Only the text is a live region (`role=status`): a screen reader says "Link copied", not "Link copied. More".
import { holdToast, releaseToast, startToast, toastEnds, type ToastTimer } from '../src/ui/toastTimer';

/** The space around the toast, in pixels: from the Problems list below it, from the pane's sides, and from the cursor's line above it. */
export const GAP = 8;

export type ToastIcon = 'undo' | 'done' | 'note';

/** A toast's words: its text, and a longer one behind "More" (`more`) or "Why?" (`why`). */
export interface ToastText { text: string; more?: string; why?: string }

export interface ToastSpec extends ToastText {
  icon: ToastIcon;
  /** Its one button; the toast hides when it runs. `untilEdit`: it undoes an edit, so the next edit hides it. */
  action?: { label: string; run: () => void; untilEdit?: boolean };
}

/** What a toast asks of the page. */
export interface ToastHost {
  /** The words of the buttons "More" and "Why?" in the page's language. */
  labels(): { more: string; why: string };
  /** Where it goes: the box it sits in (the editor's pane) and the top of what it sits above (the Problems list). */
  room(): { left: number; width: number; bottom: number } | undefined;
  /** How much of the editor's bottom it covers, in pixels (0: none): the editor keeps the cursor's line above it. */
  covers(px: number): void;
  /** Where the focus goes back when it was in the toast and the toast goes (Escape, a button run, another toast). */
  focusBack(): void;
}

const MARKS: Record<ToastIcon, string> = { undo: '↶', done: '✓', note: '•' };

export class Toast {
  private timer: ToastTimer | undefined;
  private timeout: ReturnType<typeof setTimeout> | undefined;
  private shown: ToastSpec | undefined;
  /** The icon and the text (the live region) stay; the buttons and the longer text are made for each toast. */
  private readonly icon = Object.assign(document.createElement('span'), { className: 'toast-icon' });
  private readonly text = Object.assign(document.createElement('span'), { className: 'toast-text' });
  private readonly row = Object.assign(document.createElement('div'), { className: 'toast-row' });

  constructor(private readonly el: HTMLElement, private readonly host: ToastHost) {
    this.icon.setAttribute('aria-hidden', 'true');
    // Only the text is announced: the buttons are in the toast, outside the live region.
    this.text.setAttribute('role', 'status');
    this.row.append(this.icon, this.text);
    el.replaceChildren(this.row);
    el.addEventListener('pointerenter', () => this.hold());
    // The focus holds the toast for a keyboard user (Tab, F6), not for a click: a clicked button takes the focus too,
    // and the toast would stay until another click elsewhere.
    el.addEventListener('focusin', () => {
      if (this.keyboardFocus()) this.hold();
    });
    const release = () => setTimeout(() => this.release(), 0);
    el.addEventListener('pointerleave', release);
    el.addEventListener('focusout', release);
    el.addEventListener('keydown', (e) => {
      // (Escape that ends a Japanese composition is the IME's, not a request to close.)
      if (e.key !== 'Escape' || e.isComposing || e.keyCode === 229) return;
      e.preventDefault();
      this.hide();
    });
    window.addEventListener('resize', () => this.place());
    // Placed from the start where the page has a pane, so that the first toast slides up, not in from the middle.
    el.classList.toggle('placed', !!host.room());
  }

  /** The toast shown, if any. */
  get current(): ToastSpec | undefined {
    return this.shown;
  }

  /** Whether a toast with a button shows: F6 stops there. */
  get hasButton(): boolean {
    return !!this.shown && !!this.el.querySelector('button');
  }

  /** Puts the focus on the toast's first button (F6). */
  focus(): void {
    this.el.querySelector<HTMLElement>('button')?.focus();
  }

  /** Whether the focus is in the toast. */
  get focused(): boolean {
    return this.el.contains(document.activeElement);
  }

  show(spec: ToastSpec): void {
    const hadFocus = this.focused;
    this.shown = spec;
    const el = this.el;
    this.icon.className = `toast-icon ${spec.icon}`;
    this.icon.textContent = MARKS[spec.icon];
    this.text.textContent = spec.text;
    const row = this.row;
    this.clear();
    const parts: HTMLElement[] = [];
    const longer = spec.more ?? spec.why;
    if (longer !== undefined) {
      const detail = Object.assign(document.createElement('p'), { id: 'status-more', className: 'toast-more', textContent: longer, hidden: true });
      const labels = this.host.labels();
      const more = this.button('status-more-toggle', spec.more !== undefined ? labels.more : labels.why, () => {
        detail.hidden = !detail.hidden;
        more.setAttribute('aria-expanded', String(!detail.hidden));
        this.place();
      });
      more.setAttribute('aria-expanded', 'false');
      more.setAttribute('aria-controls', 'status-more');
      row.append(more);
      parts.push(detail);
    }
    if (spec.action) {
      const { run } = spec.action;
      row.append(this.button('status-action', spec.action.label, () => {
        run();
        this.hide();
      }));
    }
    el.append(...parts);
    el.classList.add('shown');
    // (The button that had the focus is gone: the focus goes back, not to the page's body.)
    if (hadFocus) this.host.focusBack();
    this.timer = startToast(!!(spec.action || longer !== undefined), Date.now());
    // (Shown under the pointer, or with the keyboard's focus in it: held from the start.)
    if (el.matches(':hover') || this.keyboardFocus()) this.timer = holdToast(this.timer, Date.now());
    this.arm();
    this.place();
  }

  hide(): void {
    const hadFocus = this.focused;
    clearTimeout(this.timeout);
    this.timer = undefined;
    this.shown = undefined;
    this.el.classList.remove('shown');
    this.text.textContent = '';
    this.clear();
    this.host.covers(0);
    if (hadFocus) this.host.focusBack();
  }

  /** Takes away the buttons and the longer text of the toast before: the icon and the text (the live region) stay. */
  private clear(): void {
    while (this.text.nextSibling) this.text.nextSibling.remove();
    while (this.row.nextSibling) this.row.nextSibling.remove();
  }

  /** Puts the toast in its place again (after a resize of the window or of the Problems list). */
  place(): void {
    // (A toast going keeps its place while it fades.)
    if (!this.shown) return;
    const el = this.el;
    const room = this.host.room();
    el.classList.toggle('placed', !!room);
    if (!room) {
      el.style.removeProperty('left');
      el.style.removeProperty('bottom');
      el.style.removeProperty('max-width');
      this.host.covers(0);
      return;
    }
    // (Inside the window too: the pane may be moving, as when the menu slides away on a phone.)
    const left = Math.min(Math.max(GAP, room.left + GAP), window.innerWidth - GAP);
    el.style.left = `${Math.round(left)}px`;
    el.style.maxWidth = `${Math.max(0, Math.round(Math.min(room.width - 2 * GAP, window.innerWidth - GAP - left)))}px`;
    // (And never above the window's top: on a phone's full sheet the room above it is only the strip over the editor.)
    el.style.bottom = `${Math.round(Math.min(window.innerHeight - room.bottom + GAP, window.innerHeight - GAP - el.getBoundingClientRect().height))}px`;
    // The editor keeps its cursor's line above the toast, with the same gap as the toast keeps from the list below.
    this.host.covers(Math.round(el.getBoundingClientRect().height + 2 * GAP));
  }

  private button(id: string, label: string, run: () => void): HTMLButtonElement {
    const b = Object.assign(document.createElement('button'), { type: 'button', id, className: `toast-button ${id}`, textContent: label });
    b.addEventListener('click', run);
    return b;
  }

  private hold(): void {
    if (!this.timer) return;
    this.timer = holdToast(this.timer, Date.now());
    this.arm();
  }

  /** Whether the focus is in the toast as a key put it there (`:focus-visible`), not as a click on a button did. */
  private keyboardFocus(): boolean {
    return !!this.el.querySelector(':focus-visible');
  }

  private release(): void {
    if (!this.timer || this.el.matches(':hover') || this.keyboardFocus()) return;
    this.timer = releaseToast(this.timer, Date.now());
    this.arm();
  }

  private arm(): void {
    clearTimeout(this.timeout);
    const end = this.timer && toastEnds(this.timer);
    if (end !== undefined) this.timeout = setTimeout(() => this.hide(), Math.max(0, end - Date.now()));
  }
}
