// The layout of the web page: the divider between the editor and the explanation, and the side
// sheets (the menu and the settings), which a swipe opens and closes on a touch screen.

/**
 * Phones (at every zoom) and narrow windows: the explanation below the editor. theme-init.js decides it
 * before the first paint, as the class `narrow` of the page that page.css follows.
 */
export const narrow = {
  get matches(): boolean {
    return document.documentElement.classList.contains('narrow');
  },
  addEventListener(_type: 'change', listener: () => void): void {
    document.documentElement.addEventListener('narrowchange', listener);
  },
};

/**
 * A touch screen: what shows the Read | Edit switch (`.touch-only`, web/page.css), and what the page's words and start go
 * by. (The sheet's layout, in web/theme-init.js, also asks for no hover: a screen with a mouse keeps its panes side by side.)
 */
export const touchScreen = (): boolean => window.matchMedia('(pointer: coarse)').matches;

/**
 * What the phone's sheet covers of the editor's box, in px, at the height it is at or going to (web/sheet.ts, `apply`):
 * the box goes on under the sheet, so what is shown of the editor ends this far above its bottom. 0 without the sheet.
 */
export const sheetCover = (): number => parseFloat(document.documentElement.style.getPropertyValue('--sheet-cover')) || 0;

/**
 * Whether a row's items fit it: none runs past its end padding (or out of its box). A row of forms (the panel's header,
 * the editor's header) takes the first form whose items fit. `scrollWidth` alone is not enough: Chromium does not count
 * what runs into the end padding, so a form whose last item lay under the edge's swipe strip of a touch screen (12 px
 * of padding) passed as fitting. Items laid out of the row (positioned absolutely, as the sheet's grabber) do not count.
 * (The page is left to right only.)
 */
export function fitsRow(row: HTMLElement): boolean {
  if (row.scrollWidth > row.clientWidth) return false;
  const s = getComputedStyle(row);
  const end = row.getBoundingClientRect().right - parseFloat(s.borderRightWidth) - parseFloat(s.paddingRight);
  return [...row.children].every((item) => !item.getClientRects().length || getComputedStyle(item).position === 'absolute' || item.getBoundingClientRect().right <= end + 0.5);
}

import { readStoredObject, STORAGE_KEYS, writeStored } from './storage';

const SPLIT_KEY = STORAGE_KEYS.split;
const MIN = 15;
const MAX = 85;
/** The editor's share of the page, in %, by default: half beside the explanation, a bit less above it. */
const byDefault = () => (narrow.matches ? 45 : 50);

/** The shares chosen, side by side and one above the other, kept in this browser when it lets the page. */
function savedSplit(): { wide?: number; narrow?: number } {
  return readStoredObject(SPLIT_KEY);
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
  /**
   * How far the divider goes. Beside the settings, the panes hold their floors (page.css), and it stops there: past them it
   * would not move, though the share it stands for would, and would show when the settings close.
   */
  const range = (): [number, number] => {
    const css = getComputedStyle(split);
    const floor = (name: string) => parseFloat(css.getPropertyValue(name)) * (parseFloat(css.getPropertyValue('--sheet-in')) || 0);
    const full = split.clientWidth;
    return [Math.max(MIN, (floor('--editor-floor') / full) * 100), Math.min(MAX, ((full - parseFloat(css.getPropertyValue('--gutter')) - floor('--panel-floor')) / full) * 100)];
  };
  const within = (v: number) => {
    const [low, high] = range();
    return Math.min(high, Math.max(low, v));
  };
  /** What a screen reader hears: where the divider is shown and how far it goes, which beside the settings are not the share kept. */
  const announce = () => {
    const [low, high] = range();
    handle.setAttribute('aria-valuemin', String(Math.round(low)));
    handle.setAttribute('aria-valuemax', String(Math.round(high)));
    handle.setAttribute('aria-valuenow', String(Math.round(within(current()))));
  };
  const apply = () => {
    split.style.setProperty('--split', `${current()}%`);
    announce();
    // The divider of panes one above the other is horizontal.
    handle.setAttribute('aria-orientation', narrow.matches ? 'horizontal' : 'vertical');
  };
  // (The settings come and go, and the window changes: the floors are a share of this box.)
  new ResizeObserver(announce).observe(split);
  attachDivider(handle, {
    current: () => within(current()),
    set(v) {
      if (v === undefined) delete saved[key()];
      else {
        // What does not change what is shown changes nothing: a share kept behind a floor stays as it was.
        const next = within(v);
        if (Math.abs(next - within(current())) < 1e-6) return;
        saved[key()] = next;
      }
      apply();
      onChange();
      // When storage refuses, the sizes last until the page is closed.
      writeStored(SPLIT_KEY, JSON.stringify(saved));
    },
    at(e) {
      const r = split.getBoundingClientRect();
      return narrow.matches ? ((e.clientY - r.top) / r.height) * 100 : ((e.clientX - r.left) / r.width) * 100;
    },
    min: () => range()[0],
    max: () => range()[1],
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
 * header folds it away (folded at first on a phone). Both are kept in this browser when it lets the page. Returns what resets them.
 */
export function setUpProblems(
  pane: HTMLElement, box: HTMLElement, handle: HTMLElement, toggle: HTMLElement, onChange: () => void,
): () => void {
  let saved = readStoredObject<{ height?: number; collapsed?: boolean }>(STORAGE_KEYS.problems);
  // When storage refuses, the choice lasts until the page is closed.
  const store = () => writeStored(STORAGE_KEYS.problems, JSON.stringify(saved));
  // Without a stored choice the list starts folded on a phone (it would take much of the editor) and open elsewhere.
  const isCollapsed = () => saved.collapsed ?? narrow.matches;
  // The editor keeps its few lines under what lies above it in the pane (its header, the first visit's hint).
  const editor = pane.querySelector<HTMLElement>('#editor');
  // (The hint toward POSIX sh is a line after the list, which the list does not give up: the least height has it too.)
  const hint = box.querySelector<HTMLElement>('.sh-hint');
  const min = () => LIST_MIN + (hint && !hint.hidden ? hint.offsetHeight : 0);
  const max = () => Math.max(min(), pane.clientHeight - EDITOR_MIN - (editor?.offsetTop ?? 0));
  const clamp = (v: number) => Math.round(Math.min(max(), Math.max(min(), v)));
  const height = () => (saved.height === undefined ? box.getBoundingClientRect().height : clamp(saved.height));
  const controls = toggle.getAttribute('aria-controls') ?? '';
  const apply = () => {
    const collapsed = isCollapsed();
    // With no problem (web/problem-list.ts marks the box `empty`) the fold has nothing to open: no state to say.
    if (box.classList.contains('empty')) {
      toggle.removeAttribute('aria-expanded');
      toggle.removeAttribute('aria-controls');
    } else {
      toggle.setAttribute('aria-expanded', String(!collapsed));
      toggle.setAttribute('aria-controls', controls);
    }
    box.classList.toggle('collapsed', collapsed);
    handle.hidden = collapsed;
    if (saved.height === undefined) box.style.removeProperty('--problems-height');
    else box.style.setProperty('--problems-height', `${clamp(saved.height)}px`);
    handle.setAttribute('aria-valuemin', String(min()));
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
    min,
    max,
    step: 30,
    inverted: true,
  });
  toggle.addEventListener('click', () => {
    saved.collapsed = !isCollapsed();
    apply();
    store();
  });
  window.addEventListener('resize', apply);
  narrow.addEventListener('change', apply);
  // The list's own height changes as problems come and go (and with the pane): the handle tells it.
  new ResizeObserver(apply).observe(box);
  // (And when the problems come or go: the box's class. `apply` changes a class only when it differs, so no loop.)
  new MutationObserver(apply).observe(box, { attributeFilter: ['class'] });
  // (The hint toward POSIX sh comes, goes, or wraps to another height: the least height and the stored height follow it, whatever the box does.)
  if (hint) new ResizeObserver(apply).observe(hint);
  apply();
  return () => {
    saved = {};
    apply();
  };
}

const closing = new WeakMap<HTMLDialogElement, () => void>();

/** Fired on a sheet about to close with no motion, while what lies beside it is still as it was. */
export const SHEET_CLOSES_AT_ONCE = 'sheetclosesatonce';

/** Reduced motion: a sheet is there or gone at once. */
export const stillSheets = (): boolean => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Whether a transition of `property` is running on a sheet. (Asking brings the styles up to date: one about to begin has begun.) */
export const sheetMoves = (sheet: HTMLElement, property: string): boolean => sheet.getAnimations().some((a) => (a as CSSTransition).transitionProperty === property);

/**
 * The edge a side sheet lies along, as a sign: -1 for the left one (the menu), 1 for the right one (the settings, at
 * every width; a sheet as wide as the screen comes from the right). Read from where it is drawn, so that one rule of
 * page.css decides it.
 */
function sheetSide(sheet: HTMLElement): -1 | 1 {
  const r = sheet.getBoundingClientRect();
  return r.left <= 0.5 && r.right < window.innerWidth - 0.5 ? -1 : 1;
}

/**
 * Closes a side sheet. At every width it slides out towards its edge, as it slid in, and the backdrop fades (as
 * after a swipe), then the dialog closes; with reduced motion it closes at once.
 */
export function closeSheet(sheet: HTMLDialogElement): void {
  if (!sheet.open || closing.has(sheet)) return;
  if (stillSheets()) {
    // (A swipe has left the sheet where the finger let go: it opens at its place next time.)
    sheet.classList.remove('dragging');
    sheet.style.transform = '';
    sheet.dispatchEvent(new Event(SHEET_CLOSES_AT_ONCE));
    sheet.close();
    return;
  }
  const side = sheetSide(sheet);
  // (The settings beside the panes slide on `--sheet-in`, with the panes: page.css reads the class.)
  const beside = !sheet.matches(':modal');
  let timer = 0;
  const reset = () => {
    sheet.removeEventListener('transitionend', onEnd);
    sheet.removeEventListener('transitioncancel', onEnd);
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
  const property = beside ? '--sheet-in' : 'transform';
  // (Cancelled for another in its place, it is not over.)
  const onEnd = (e: TransitionEvent) => {
    if (e.target === sheet && e.propertyName === property && !sheetMoves(sheet, property)) finish();
  };
  // Opened again while sliding out: it slides back. Closed by other means meanwhile: nothing is left over.
  closing.set(sheet, reset);
  sheet.addEventListener('close', reset);
  sheet.addEventListener('transitionend', onEnd);
  sheet.addEventListener('transitioncancel', onEnd);
  // In case no transition runs (the sheet is already out of the screen), and as a safety net.
  timer = window.setTimeout(finish, 500);
  sheet.classList.add('closing');
  if (!beside) sheet.style.transform = `translateX(${side * 100}%)`;
}

/** Called when a sheet is asked to open: if it is sliding out, it comes back and this returns true. */
export function reopenSheet(sheet: HTMLDialogElement): boolean {
  const cancel = closing.get(sheet);
  if (!cancel) return false;
  cancel();
  return true;
}

/**
 * Holds a sheet `dx` px from where it rests, towards its edge, under a finger (undefined: lets it go). The settings beside the
 * panes move on `--sheet-in`, and the panes with them, so that no gap opens between them.
 */
function holdSheet(sheet: HTMLDialogElement, sign: number, dx?: number): void {
  if (sheet.matches(':modal')) {
    sheet.style.transform = dx === undefined ? '' : `translateX(${sign * dx}px)`;
    return;
  }
  for (const part of [sheet, document.querySelector('main')]) {
    if (dx === undefined) part?.style.removeProperty('--sheet-in');
    else part?.style.setProperty('--sheet-in', String(Math.max(0, 1 - dx / sheet.offsetWidth)));
  }
}

/**
 * A side sheet, a dialog along an edge of the screen (`sheetSide`), modal where the page behind it is shut: Esc and a
 * click beside it close it (the browser keeps the focus inside while it is open), and so does a swipe towards its edge
 * on a touch screen. (The settings side by side are not modal: web/settings-dialog.ts closes them on Esc itself.)
 */
export function setUpSheet(sheet: HTMLDialogElement): void {
  // Towards the sheet's own edge is positive.
  let sign = 1;
  sheet.addEventListener('click', (e) => {
    // (A sheet that is not modal has no backdrop: a click on the sheet itself is not one beside it.)
    if (e.target === sheet && sheet.matches(':modal')) closeSheet(sheet);
  });
  // Esc slides it out too.
  sheet.addEventListener('cancel', (e) => {
    e.preventDefault();
    closeSheet(sheet);
  });
  let start: { x: number; y: number; id: number } | undefined;
  sheet.addEventListener('pointerdown', (e) => {
    start = e.pointerType === 'touch' ? { x: e.clientX, y: e.clientY, id: e.pointerId } : undefined;
    sign = sheetSide(sheet);
  });
  sheet.addEventListener('pointermove', (e) => {
    if (!start || e.pointerId !== start.id) return;
    const dx = sign * (e.clientX - start.x);
    // Sideways more than down: the sheet follows the finger; a scroll of its content does not move it.
    if (dx > 10 && dx > Math.abs(e.clientY - start.y)) {
      sheet.classList.add('dragging');
      holdSheet(sheet, sign, dx);
    }
  });
  // (The window crossing between the layouts under the finger closes the sheet and opens it again in the other kind, and the
  // finger's end does not reach it: nothing of the hold is left over.)
  sheet.addEventListener('close', () => {
    start = undefined;
    sheet.classList.remove('dragging');
    for (const part of [sheet, document.querySelector('main')]) part?.style.removeProperty('--sheet-in');
    sheet.style.removeProperty('transform');
  });
  const end = (e: PointerEvent) => {
    if (!start || e.pointerId !== start.id) return;
    const dx = sign * (e.clientX - start.x);
    start = undefined;
    const out = e.type === 'pointerup' && dx > 80;
    sheet.classList.remove('dragging');
    holdSheet(sheet, sign);
    if (out) {
      // Slides out from where the finger let go.
      if (sheet.matches(':modal')) {
        holdSheet(sheet, sign, dx);
        void sheet.offsetWidth;
      }
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

/**
 * Whether the drawn controls of the sheet's row (the view control, the tools) keep clear of the bar drawn at the top of
 * its grabber (`.sheet-grab::before`, read as drawn, in the row's middle). The tabs pass under the bar:
 * they draw only their words, below it. A row without a grabber is clear.
 */
export function clearOfGrabBar(row: HTMLElement): boolean {
  const grab = row.querySelector<HTMLElement>('.sheet-grab');
  if (!grab?.getClientRects().length) return true;
  const g = grab.getBoundingClientRect();
  const half = (parseFloat(getComputedStyle(grab, '::before').width) || 0) / 2;
  const [left, right] = [g.left + g.width / 2 - half, g.left + g.width / 2 + half];
  const drawn = [...row.querySelectorAll<HTMLElement>('.view-slot .vc-open, .view-slot .vc-options, .panel-tools')].filter((e) => e.getClientRects().length && getComputedStyle(e).display !== 'none');
  return drawn.every((e) => {
    const r = e.getBoundingClientRect();
    return r.right <= left + 0.5 || r.left >= right - 0.5;
  });
}
