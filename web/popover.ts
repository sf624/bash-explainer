// Small popovers of the page (the editor header's ⋯ menu), and focus rings that follow the input
// (docs/design/chrome-redesign.md, section 4: `popover` and `.no-ring`; C4).

/** The popovers open now: one at a time. */
const openPops = new Set<() => void>();

/** Whether the last input was a pointer (a mouse, a pen, a finger), not a key. */
let byPointer = false;

/**
 * Focuses `el`, as the page gives the focus back to a control (a dialog or a popover closes). After a pointer the control
 * gets no focus ring (`.no-ring`), as a click on it would have; after a key it keeps the ring, as a keyboard user needs.
 * The ring comes back at the next key.
 */
export function focusBack(el: HTMLElement): void {
  el.focus();
  markRing(el);
}

function markRing(el: Element | null): void {
  if (!byPointer || !(el instanceof HTMLElement) || el === document.body) return;
  el.classList.add('no-ring');
  el.addEventListener('blur', () => el.classList.remove('no-ring'), { once: true });
}

/** Sets up `.no-ring`: once per page. A dialog closed after a pointer gives the focus back to its opener without a ring. */
export function setUpFocusRings(): void {
  document.addEventListener('pointerdown', () => { byPointer = true; }, true);
  document.addEventListener('keydown', () => {
    byPointer = false;
    for (const e of document.querySelectorAll('.no-ring')) e.classList.remove('no-ring');
  }, true);
  document.addEventListener('close', (e) => {
    if (!(e.target instanceof HTMLDialogElement) || !byPointer) return;
    // The browser gives the focus back to the opener after the event.
    setTimeout(() => markRing(document.activeElement), 0);
  }, true);
}

export interface Popover {
  readonly open: boolean;
  /** Closes it, and gives the focus back to its button. */
  close(): void;
}

/**
 * A button that opens a small menu under it (`role="menu"`, its items buttons with `role="menuitem"`). Opening puts the
 * focus on the first item; the arrows, Home and End move between the items; Escape closes it and gives the focus back to
 * the button; Tab, a press outside or choosing an item closes it. An item's own click runs first: when it moved the
 * focus elsewhere (a field, the editor), the focus stays there; else it goes back to the button.
 */
export function popover(button: HTMLElement, pop: HTMLElement): Popover {
  const items = () => [...pop.querySelectorAll<HTMLElement>('[role="menuitem"]')].filter((i) => !i.hidden);
  const close = (focusButton: boolean) => {
    if (pop.hidden) return;
    const hadFocus = pop.contains(document.activeElement);
    pop.hidden = true;
    button.setAttribute('aria-expanded', 'false');
    openPops.delete(closer);
    if (focusButton && hadFocus) focusBack(button);
  };
  const closer = () => close(false);
  const open = () => {
    for (const other of [...openPops]) other();
    pop.hidden = false;
    button.setAttribute('aria-expanded', 'true');
    openPops.add(closer);
    items()[0]?.focus();
  };
  button.addEventListener('click', () => (pop.hidden ? open() : close(true)));
  button.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    open();
    const list = items();
    if (e.key === 'ArrowUp') list[list.length - 1]?.focus();
  });
  document.addEventListener('pointerdown', (e) => {
    if (!pop.hidden && !button.contains(e.target as Node) && !pop.contains(e.target as Node)) close(false);
  });
  // A press in the panel's frame reaches no listener of this page: the page's window loses the focus instead.
  window.addEventListener('blur', () => close(false));
  pop.addEventListener('keydown', (e) => {
    const list = items();
    const at = list.indexOf(document.activeElement as HTMLElement);
    const go = (i: number) => list[(i + list.length) % list.length].focus();
    if (e.key === 'Escape') {
      e.stopPropagation();
      close(true);
    } else if (e.key === 'Tab') {
      return close(false);
    } else if (e.key === 'ArrowDown') go(at + 1);
    else if (e.key === 'ArrowUp') go(at - 1);
    else if (e.key === 'Home') go(0);
    else if (e.key === 'End') go(list.length - 1);
    else return;
    e.preventDefault();
  });
  pop.addEventListener('click', (e) => {
    if ((e.target as Element).closest('[role="menuitem"]')) close(true);
  });
  return {
    get open() { return !pop.hidden; },
    close: () => close(true),
  };
}

/** Closes every popover (a dialog opens). */
export function closePopovers(): void {
  for (const c of [...openPops]) c();
}
