// The layout of the web page: the divider between the editor and the explanation, and the side
// sheets (the menu and the settings), which a swipe opens and closes on a touch screen.

/** Phones and narrow windows: the explanation below the editor (page.css has the same width). */
export const narrow = window.matchMedia('(max-width: 767px)');

const SPLIT_KEY = 'bash-explainer-split';
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

/**
 * The divider: dragged with a pointer, moved with the arrow keys (Home and End for the ends), and
 * back to the default sizes with a double click or Enter.
 */
export function setUpSplitter(split: HTMLElement, handle: HTMLElement, onChange: () => void): void {
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
  const set = (v: number | undefined) => {
    if (v === undefined) delete saved[key()];
    else saved[key()] = Math.min(MAX, Math.max(MIN, v));
    apply();
    onChange();
    try {
      localStorage.setItem(SPLIT_KEY, JSON.stringify(saved));
    } catch {
      // The sizes then last until the page is closed.
    }
  };
  const at = (e: PointerEvent) => {
    const r = split.getBoundingClientRect();
    return narrow.matches ? ((e.clientY - r.top) / r.height) * 100 : ((e.clientX - r.left) / r.width) * 100;
  };
  /** Where in the divider it was taken, so that it does not jump to the pointer. */
  let grab = 0;
  handle.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    grab = at(e) - current();
    handle.setPointerCapture(e.pointerId);
    document.body.classList.add('resizing');
  });
  handle.addEventListener('pointermove', (e) => {
    if (handle.hasPointerCapture(e.pointerId)) set(at(e) - grab);
  });
  const stop = (e: PointerEvent) => {
    if (handle.hasPointerCapture(e.pointerId)) handle.releasePointerCapture(e.pointerId);
    document.body.classList.remove('resizing');
  };
  handle.addEventListener('pointerup', stop);
  handle.addEventListener('pointercancel', stop);
  handle.addEventListener('dblclick', () => set(undefined));
  handle.addEventListener('keydown', (e) => {
    const step = e.shiftKey ? 1 : 5;
    const moves: Record<string, number | undefined> = {
      ArrowLeft: current() - step, ArrowUp: current() - step, ArrowRight: current() + step, ArrowDown: current() + step,
      Home: MIN, End: MAX, Enter: undefined,
    };
    if (!(e.key in moves)) return;
    e.preventDefault();
    set(moves[e.key]);
  });
  narrow.addEventListener('change', apply);
  apply();
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
    if (e.target === sheet) sheet.close();
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
    if (e.type === 'pointerup' && dx > 80) sheet.close();
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
