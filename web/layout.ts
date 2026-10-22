// The layout of the web page: the divider between the editor and the explanation, and the side
// sheets (the menu and the settings), which a swipe opens and closes on a touch screen.

/** Phones and narrow windows: the explanation below the editor (page.css has the same width). */
export const narrow = window.matchMedia('(max-width: 767px)');

import { STORAGE_KEYS } from './storage';

const SPLIT_KEY = STORAGE_KEYS.split;
const MIN = 15;
const MAX = 85;
/** The editor's share of the page, in %, by default: half beside the explanation, a bit less above it. */
const byDefault = () => (narrow.matches ? 45 : 50);

/** The shares chosen, side by side and one above the other, kept in this browser when it lets the page. */
function savedSplit(): { wide?: number; narrow?: number } {
  try {
    const v = JSON.parse(localStorage.getItem(SPLIT_KEY) ?? '{}');
    return v && typeof v === 'object' ? v : {};
  } catch {
    return {};
  }
}

/** What a divider needs to know: its value and how to change it (see `attachDivider`). */
interface DividerModel {
  current(): number;
  /** Sets a value (clamped by the model) or, with undefined, goes back to the default. */
  set(v: number | undefined): void;
  /** The value the pointer stands for. */
  at(e: PointerEvent): number;
  min(): number;
  max(): number;
  /** The arrow keys' step (with Shift: a fifth of it, at least 1). */
  step: number;
  /** True when the value grows towards the top or the left (the height of a list under the editor). */
  inverted?: boolean;
}

/**
 * The behaviour of a divider: dragged with a pointer, moved with the arrow keys (Home and End for the
 * ends), and back to the default with a double click or Enter.
 */
function attachDivider(handle: HTMLElement, m: DividerModel): void {
  /** Where in the divider it was taken, so that it does not jump to the pointer. */
  let grab = 0;
  handle.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    grab = m.at(e) - m.current();
    handle.setPointerCapture(e.pointerId);
    document.body.classList.add('resizing');
  });
  handle.addEventListener('pointermove', (e) => {
    if (handle.hasPointerCapture(e.pointerId)) m.set(m.at(e) - grab);
  });
  const stop = (e: PointerEvent) => {
    if (handle.hasPointerCapture(e.pointerId)) handle.releasePointerCapture(e.pointerId);
    document.body.classList.remove('resizing');
  };
  handle.addEventListener('pointerup', stop);
  handle.addEventListener('pointercancel', stop);
  handle.addEventListener('dblclick', () => m.set(undefined));
  handle.addEventListener('keydown', (e) => {
    const step = (e.shiftKey ? Math.max(1, m.step / 5) : m.step) * (m.inverted ? -1 : 1);
    const moves: Record<string, number | undefined> = {
      ArrowLeft: m.current() - step, ArrowUp: m.current() - step,
      ArrowRight: m.current() + step, ArrowDown: m.current() + step,
      Home: m.min(), End: m.max(), Enter: undefined,
    };
    if (!(e.key in moves)) return;
    e.preventDefault();
    m.set(moves[e.key]);
  });
}

/** The divider between the editor and the explanation. */
export function setUpSplitter(split: HTMLElement, handle: HTMLElement, onChange: () => void): () => void {
  const saved = savedSplit();
  const key = () => (narrow.matches ? 'narrow' : 'wide');
  const current = () => saved[key()] ?? byDefault();
  const apply = () => {
    const v = current();
    split.style.setProperty('--split', `${v}%`);
    handle.setAttribute('aria-valuenow', String(Math.round(v)));
    // The divider of panes one above the other is horizontal.
    handle.setAttribute('aria-orientation', narrow.matches ? 'horizontal' : 'vertical');
  };
  attachDivider(handle, {
    current,
    set(v) {
      if (v === undefined) delete saved[key()];
      else saved[key()] = Math.min(MAX, Math.max(MIN, v));
      apply();
      onChange();
      try {
        localStorage.setItem(SPLIT_KEY, JSON.stringify(saved));
      } catch {
        // The sizes then last until the page is closed.
      }
    },
    at(e) {
      const r = split.getBoundingClientRect();
      return narrow.matches ? ((e.clientY - r.top) / r.height) * 100 : ((e.clientX - r.left) / r.width) * 100;
    },
    min: () => MIN,
    max: () => MAX,
    step: 5,
  });
  narrow.addEventListener('change', apply);
  apply();
  // Back to the default sizes, as after the stored data was cleared.
  return () => {
    delete saved.wide;
    delete saved.narrow;
    apply();
    onChange();
  };
}

/** The editor keeps this many pixels (about three lines) above the Problems list. */
const EDITOR_MIN = 66;
/** The list keeps at least its handle, its header and a row. */
const LIST_MIN = 72;

/**
 * The Problems list under the editor: a divider above it changes its height (dragged, or with the arrow
 * keys; a double click or Enter goes back to the default, a third of the editor's pane at most), and its
 * header folds it away. Both are kept in this browser when it lets the page. Returns what resets them.
 */
export function setUpProblems(
  pane: HTMLElement, box: HTMLElement, handle: HTMLElement, toggle: HTMLElement, onChange: () => void,
): () => void {
  let saved: { height?: number; collapsed?: boolean } = {};
  try {
    const v = JSON.parse(localStorage.getItem(STORAGE_KEYS.problems) ?? '{}');
    if (v && typeof v === 'object') saved = v;
  } catch {
    // Not readable: the defaults.
  }
  const store = () => {
    try {
      localStorage.setItem(STORAGE_KEYS.problems, JSON.stringify(saved));
    } catch {
      // The choice then lasts until the page is closed.
    }
  };
  const max = () => Math.max(LIST_MIN, pane.clientHeight - EDITOR_MIN);
  const clamp = (v: number) => Math.round(Math.min(max(), Math.max(LIST_MIN, v)));
  const height = () => (saved.height === undefined ? box.getBoundingClientRect().height : clamp(saved.height));
  const apply = () => {
    const collapsed = !!saved.collapsed;
    toggle.setAttribute('aria-expanded', String(!collapsed));
    box.classList.toggle('collapsed', collapsed);
    handle.hidden = collapsed;
    if (saved.height === undefined) box.style.removeProperty('--problems-height');
    else box.style.setProperty('--problems-height', `${clamp(saved.height)}px`);
    handle.setAttribute('aria-valuemin', String(LIST_MIN));
    handle.setAttribute('aria-valuemax', String(max()));
    if (!collapsed && !box.hidden) handle.setAttribute('aria-valuenow', String(Math.round(height())));
    onChange();
  };
  attachDivider(handle, {
    current: height,
    set(v) {
      if (v === undefined) delete saved.height;
      else saved.height = clamp(v);
      apply();
      store();
    },
    at: (e) => pane.getBoundingClientRect().bottom - e.clientY,
    min: () => LIST_MIN,
    max,
    step: 30,
    inverted: true,
  });
  toggle.addEventListener('click', () => {
    if (saved.collapsed) delete saved.collapsed;
    else saved.collapsed = true;
    apply();
    store();
  });
  window.addEventListener('resize', apply);
  narrow.addEventListener('change', apply);
  // The list's own height changes as problems come and go (and with the pane): the handle tells it.
  new ResizeObserver(apply).observe(box);
  apply();
  return () => {
    saved = {};
    apply();
  };
}

const closing = new WeakMap<HTMLDialogElement, () => void>();

/**
 * Closes a side sheet. At every width it slides out towards its edge, as it slid in, and the backdrop fades (as
 * after a swipe), then the dialog closes; with reduced motion it closes at once.
 */
export function closeSheet(sheet: HTMLDialogElement): void {
  if (!sheet.open || closing.has(sheet)) return;
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    sheet.close();
    return;
  }
  const side = sheet.classList.contains('menu') ? -1 : 1;
  let timer = 0;
  const reset = () => {
    sheet.removeEventListener('transitionend', onEnd);
    sheet.removeEventListener('close', reset);
    clearTimeout(timer);
    closing.delete(sheet);
    sheet.classList.remove('closing');
    sheet.style.transform = '';
  };
  const finish = () => {
    reset();
    sheet.close();
  };
  const onEnd = (e: TransitionEvent) => {
    if (e.target === sheet && e.propertyName === 'transform') finish();
  };
  // Opened again while sliding out: it slides back. Closed by other means meanwhile: nothing is left over.
  closing.set(sheet, reset);
  sheet.addEventListener('close', reset);
  sheet.addEventListener('transitionend', onEnd);
  // In case no transition runs (the sheet is already out of the screen), and as a safety net.
  timer = window.setTimeout(finish, 500);
  sheet.classList.add('closing');
  sheet.style.transform = `translateX(${side * 100}%)`;
}

/** Called when a sheet is asked to open: if it is sliding out, it comes back and this returns true. */
export function reopenSheet(sheet: HTMLDialogElement): boolean {
  const cancel = closing.get(sheet);
  if (!cancel) return false;
  cancel();
  return true;
}

/**
 * A side sheet, a modal dialog along the right edge (the left one for the menu): Esc and a click beside it
 * close it (the browser keeps the focus inside while it is open), and so does a swipe towards its edge on a
 * touch screen.
 */
export function setUpSheet(sheet: HTMLDialogElement, side: 'left' | 'right' = 'right'): void {
  // Towards the sheet's own edge is positive.
  const sign = side === 'right' ? 1 : -1;
  sheet.addEventListener('click', (e) => {
    if (e.target === sheet) closeSheet(sheet);
  });
  // Esc slides it out too.
  sheet.addEventListener('cancel', (e) => {
    e.preventDefault();
    closeSheet(sheet);
  });
  let start: { x: number; y: number; id: number } | undefined;
  sheet.addEventListener('pointerdown', (e) => {
    start = e.pointerType === 'touch' ? { x: e.clientX, y: e.clientY, id: e.pointerId } : undefined;
  });
  sheet.addEventListener('pointermove', (e) => {
    if (!start || e.pointerId !== start.id) return;
    const dx = sign * (e.clientX - start.x);
    // Sideways more than down: the sheet follows the finger; a scroll of its content does not move it.
    if (dx > 10 && dx > Math.abs(e.clientY - start.y)) {
      sheet.classList.add('dragging');
      sheet.style.transform = `translateX(${sign * dx}px)`;
    }
  });
  const end = (e: PointerEvent) => {
    if (!start || e.pointerId !== start.id) return;
    const dx = sign * (e.clientX - start.x);
    start = undefined;
    sheet.classList.remove('dragging');
    sheet.style.transform = '';
    if (e.type === 'pointerup' && dx > 80) {
      // Slides out from where the finger let go.
      sheet.style.transform = `translateX(${sign * dx}px)`;
      void sheet.offsetWidth;
      closeSheet(sheet);
    }
  };
  sheet.addEventListener('pointerup', end);
  sheet.addEventListener('pointercancel', end);
}

/**
 * A swipe away from the screen's edge, from the strip along it (touch screens only), calls `open`. The strip
 * only listens: it never cancels a touch, so the browser's own back gesture at the edge is left alone.
 */
export function setUpEdgeSwipe(edge: HTMLElement, open: () => void, side: 'left' | 'right' = 'right'): void {
  let start: { x: number; y: number; id: number } | undefined;
  edge.addEventListener('pointerdown', (e) => {
    start = { x: e.clientX, y: e.clientY, id: e.pointerId };
    edge.setPointerCapture(e.pointerId);
  });
  edge.addEventListener('pointermove', (e) => {
    if (!start || e.pointerId !== start.id) return;
    const dx = side === 'right' ? start.x - e.clientX : e.clientX - start.x;
    if (dx > 40 && dx > 2 * Math.abs(e.clientY - start.y)) {
      start = undefined;
      open();
    }
  });
  const end = () => (start = undefined);
  edge.addEventListener('pointerup', end);
  edge.addEventListener('pointercancel', end);
}
