// The page's chrome prototype (proto/chrome-1): small popovers (the Share menu, the editor's ⋯ menu, the
// kind-and-shell chip), the page's own tooltips, the Problems strip's next/previous, and the phone's bottom sheet.

/** The popovers open now: one at a time. */
const openPops = new Set<() => void>();

/**
 * A button that opens a small popover under it: a menu (role=menu, its items are buttons; the arrows move between
 * them) or a little dialog (the kind-and-shell chip). A press outside, Escape, or choosing an item closes it.
 */
export function popover(button: HTMLElement, pop: HTMLElement, opts: { closeOnPick?: boolean; onOpen?: () => void; scrim?: HTMLElement } = {}): { close(): void } {
  const items = () => [...pop.querySelectorAll<HTMLElement>('[role="menuitem"], [role="menuitemradio"], [role="radio"]')].filter((i) => !i.hidden && i.offsetParent !== null);
  const close = (focusButton = false) => {
    if (pop.hidden) return;
    pop.hidden = true;
    if (opts.scrim) opts.scrim.hidden = true;
    button.setAttribute('aria-expanded', 'false');
    openPops.delete(closer);
    if (focusButton) button.focus();
  };
  const closer = () => close(false);
  const open = () => {
    for (const other of [...openPops]) other();
    pop.hidden = false;
    // The scrim (a phone's sheet): shown only where the popover is a sheet; a tap on it closes the sheet on its click,
    // so that the tap never reaches the editor under it (it would move the cursor).
    if (opts.scrim) opts.scrim.hidden = getComputedStyle(pop).position !== 'fixed';
    button.setAttribute('aria-expanded', 'true');
    openPops.add(closer);
    opts.onOpen?.();
    // (Round 7: in lists of radio items, the one chosen.)
    (items().find((i) => (i.getAttribute('role') === 'radio' || i.getAttribute('role') === 'menuitemradio') && i.getAttribute('aria-checked') === 'true') ?? items()[0] ?? pop.querySelector<HTMLElement>('select, button, input'))?.focus();
  };
  button.addEventListener('click', () => (pop.hidden ? open() : close(true)));
  document.addEventListener('pointerdown', (e) => {
    if (!pop.hidden && !button.contains(e.target as Node) && !pop.contains(e.target as Node) && e.target !== opts.scrim) close(false);
  });
  opts.scrim?.addEventListener('click', () => close(false));
  window.addEventListener('blur', () => {
    // A native select's popup takes the focus from the window in some browsers: keep the popover then.
    if (!pop.contains(document.activeElement)) close(false);
  });
  pop.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      close(true);
      return;
    }
    const list = items();
    const at = list.indexOf(document.activeElement as HTMLElement);
    if (at < 0) return;
    const go = (i: number) => list[(i + list.length) % list.length]?.focus();
    if (e.key === 'ArrowDown') go(at + 1);
    else if (e.key === 'ArrowUp') go(at - 1);
    else if (e.key === 'Home') go(0);
    else if (e.key === 'End') go(list.length - 1);
    else if (e.key === 'Tab') return close(false);
    else return;
    e.preventDefault();
  });
  if (opts.closeOnPick !== false) {
    pop.addEventListener('click', (e) => {
      if ((e.target as Element).closest('[role="menuitem"], [role="menuitemradio"]')) close(false);
    });
  }
  return { close: () => close(true) };
}

/** Closes every popover (a dialog opens, the layout changes). */
export function closePopovers(): void {
  for (const c of [...openPops]) c();
}

/**
 * The page's tooltips, instead of the browser's: shown after 400 ms of hover with a mouse, and at once on a keyboard
 * focus, under the control (above it near the bottom of the window), with the shortcut of `data-key`. Applies to the
 * controls inside `roots`; their `title` moves to `data-tip` (the accessible name stays their aria-label).
 */
export function setUpTooltips(tip: HTMLElement, roots: string): void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let shownFor: Element | undefined;
  const target = (e: Event): HTMLElement | undefined => {
    const el = (e.target as Element | null)?.closest?.<HTMLElement>('[title], [data-tip]');
    if (!el || !el.closest(roots) || el.closest('[role="menu"], [role="dialog"]')) return undefined;
    if (el.hasAttribute('title')) {
      const t = el.getAttribute('title') ?? '';
      el.removeAttribute('title');
      if (t) el.dataset.tip = t;
      if (t && !el.getAttribute('aria-label') && !el.textContent?.trim()) el.setAttribute('aria-label', t);
    }
    return el.dataset.tip ? el : undefined;
  };
  const hide = () => {
    clearTimeout(timer);
    tip.hidden = true;
    shownFor = undefined;
  };
  const show = (el: HTMLElement) => {
    if (el.getAttribute('aria-expanded') === 'true') return;
    tip.replaceChildren(el.dataset.tip ?? '');
    if (el.dataset.key) tip.append(Object.assign(document.createElement('kbd'), { textContent: el.dataset.key }));
    tip.hidden = false;
    shownFor = el;
    const r = el.getBoundingClientRect();
    const w = tip.offsetWidth;
    const h = tip.offsetHeight;
    const left = Math.max(8, Math.min(window.innerWidth - w - 8, r.left + r.width / 2 - w / 2));
    const below = r.bottom + 6 + h < window.innerHeight - 8;
    tip.style.left = `${left}px`;
    tip.style.top = `${below ? r.bottom + 6 : r.top - h - 6}px`;
  };
  document.addEventListener('mouseover', (e) => {
    const el = target(e);
    if (el === shownFor) return;
    hide();
    if (el) timer = setTimeout(() => show(el), 400);
  });
  document.addEventListener('mouseout', (e) => {
    if (!(e.relatedTarget as Node | null) || !shownFor?.contains(e.relatedTarget as Node)) hide();
  });
  document.addEventListener('focusin', (e) => {
    const el = target(e);
    hide();
    // (A problem shows its whole text itself when it has the focus.)
    if (el && el.matches(':focus-visible') && !el.matches('.problem')) show(el);
  });
  document.addEventListener('focusout', hide);
  document.addEventListener('pointerdown', hide, true);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') hide();
  }, true);
  window.addEventListener('blur', hide);
}

/** The heights of the phone's bottom sheet, in % of the window's height; `full` reaches up to the editor's strip. */
export const SNAPS = { peek: 40, half: 55, full: 100 } as const;
export type Snap = keyof typeof SNAPS;

/**
 * The phone's bottom sheet: the explanation's column, over the editor's lower part, at one of three heights. Dragging
 * its handle moves it and lets go at the nearest height; a tap on the handle goes peek → half → full → peek.
 * `--sheet-h` (on the root) is its height, which the editor's pane leaves free (up to the half height). Full puts its
 * top edge exactly under the app bar and the editor's strip (`top()`, in px from the top of the window): never over them.
 */
export class BottomSheet {
  snap: Snap = 'peek';
  constructor(private readonly col: HTMLElement, private readonly head: HTMLElement, private readonly handle: HTMLElement, private readonly top: () => number, private readonly changed: () => void) {
    let start: { y: number; h: number; id: number; moved: boolean } | undefined;
    let quietUntil = 0;
    head.addEventListener('click', (c) => {
      if (Date.now() >= quietUntil) return;
      c.stopPropagation();
      c.preventDefault();
    }, true);
    head.addEventListener('pointerdown', (e) => {
      if (!document.documentElement.classList.contains('narrow')) return;
      // The whole header drags: the handle, the tabs (a tap still picks one) and the space between them.
      if ((e.target as Element).closest('button:not(.bsheet-handle):not([role="tab"])')) return;
      start = { y: e.clientY, h: col.getBoundingClientRect().height, id: e.pointerId, moved: false };
    });
    head.addEventListener('pointermove', (e) => {
      if (!start || e.pointerId !== start.id) return;
      const dy = start.y - e.clientY;
      if (!start.moved && Math.abs(dy) < 6) return;
      if (!start.moved) head.setPointerCapture(e.pointerId);
      start.moved = true;
      col.classList.add('dragging');
      const h = Math.max(window.innerHeight * 0.18, Math.min(this.px('full'), start.h + dy));
      document.documentElement.style.setProperty('--sheet-h', `${h}px`);
    });
    const end = (e: PointerEvent) => {
      if (!start || e.pointerId !== start.id) return;
      const moved = start.moved;
      start = undefined;
      col.classList.remove('dragging');
      if (!moved) return; // a tap: the handle's click cycles, a tab's click picks it
      // The click right after a drag is not a tap.
      quietUntil = Date.now() + 400;
      const h = col.getBoundingClientRect().height;
      const nearest = (Object.keys(SNAPS) as Snap[]).reduce((a, b) => (Math.abs(this.px(b) - h) < Math.abs(this.px(a) - h) ? b : a));
      this.set(nearest);
    };
    head.addEventListener('pointerup', end);
    head.addEventListener('pointercancel', end);
    handle.addEventListener('click', () => this.set(this.snap === 'peek' ? 'half' : this.snap === 'half' ? 'full' : 'peek'));
    handle.addEventListener('keydown', (e) => {
      const order: Snap[] = ['peek', 'half', 'full'];
      const at = order.indexOf(this.snap);
      if (e.key === 'ArrowUp') this.set(order[Math.min(2, at + 1)]);
      else if (e.key === 'ArrowDown') this.set(order[Math.max(0, at - 1)]);
      else return;
      e.preventDefault();
    });
    // The window's height changes (the phone turned, the keyboard): full keeps to the strip.
    window.addEventListener('resize', () => {
      if (this.snap === 'full') this.set('full');
    });
    this.set('peek');
  }

  /** The height of a snap in px. */
  px(snap: Snap): number {
    const full = window.innerHeight - this.top();
    return snap === 'full' ? full : Math.min(full, (window.innerHeight * SNAPS[snap]) / 100);
  }

  set(snap: Snap): void {
    this.snap = snap;
    document.documentElement.style.setProperty('--sheet-h', snap === 'full' ? `${this.px('full')}px` : `${SNAPS[snap]}dvh`);
    document.documentElement.dataset.sheet = snap;
    this.handle.setAttribute('aria-valuenow', String(Math.round((this.px(snap) / window.innerHeight) * 100)));
    this.changed();
  }

  /** At least this high (a tap on a line raises a peeking sheet to half). */
  raise(to: Snap): void {
    if (SNAPS[this.snap] < SNAPS[to]) this.set(to);
  }
}

let measure: CanvasRenderingContext2D | null | undefined;
/**
 * Sizes a native select to the option it shows (proto/chrome-3): the editor header's pickers fit their content
 * instead of the widest option. Its own padding (with the arrow) and borders are added to the text's width.
 */
export function fitSelect(select: HTMLSelectElement, atLeast = '', extra = 0): number | undefined {
  if (!select.isConnected || !select.offsetParent) return undefined;
  measure ??= document.createElement('canvas').getContext('2d');
  if (!measure) return undefined;
  const cs = getComputedStyle(select);
  measure.font = `${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
  const text = select.selectedOptions[0]?.textContent ?? '';
  const pad = parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight) + parseFloat(cs.borderLeftWidth) + parseFloat(cs.borderRightWidth);
  // Round 4: never narrower than the longest common value, so that choosing another value moves no other control.
  const own = measure.measureText(text).width;
  const w = Math.max(own, atLeast ? measure.measureText(atLeast).width : 0);
  // (Round 5: `extra`, room after the longest value for an arrow drawn right after the value shown.)
  select.style.width = `${Math.ceil(w + pad + 2 + extra)}px`;
  return own;
}
