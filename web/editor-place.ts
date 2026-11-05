// Keeps the reader's place in the editor while its width changes, as the settings open and close beside it: one row stays where
// it is on the screen, and what lies around it moves (docs/design/chrome-redesign.md, "The place across a rewrap"). The row
// is a position in the text, so a rewrap cannot lose it. What the row is and when it holds is decided in src/ui/editorPlace.ts.
//
// CodeMirror keeps only the top of the first line block in view, which leaves every row under it to move as the rows above
// them change height. And it measures a frame after a new width, while the browser has already laid the text out: so the
// correction brings its measure forward (`requestMeasure`, then a read: `coordsAtPos` does that measure at once), runs in
// the task that changes the width and again after the microtasks that measure leaves (the marks of web/word-wrap.ts come in
// one), and so on the next frames, before they are drawn, while newly drawn lines settle.
import type { Text } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { firstNonBlank, holdGoesOn, type PlaceRow, placeOnClose, rowToKeep, yInView } from '../src/ui/editorPlace';

export interface EditorPlace {
  /** The row's position in the text, and how far its top lies from the top of the editor's view. */
  pos: number;
  y: number;
  /** Whether that row is the cursor's. */
  cursor: boolean;
  head: number;
  doc: Text;
  /** The scroll sideways to give back; a row is not moved sideways by a rewrap. */
  left: number;
  /** Where the editor's scroll was left, both ways. */
  scroll: number;
  sideways: number;
}

function rowAt(view: EditorView, pos: number): PlaceRow | null {
  const at = view.coordsAtPos(pos, pos === view.state.selection.main.head ? view.state.selection.main.assoc || 1 : 1);
  return at && { pos, top: at.top, bottom: at.bottom };
}

/** The first row that shows: the first character that is not a blank whose box reaches below the top of the view, among the lines drawn. */
function firstRow(view: EditorView, top: number): PlaceRow | null {
  const reading = top + 1;
  const start = view.posAtCoords({ x: view.contentDOM.getBoundingClientRect().left + 1, y: reading }, false);
  const { doc } = view.state;
  for (let line = doc.lineAt(start), from = start - line.from; ; line = doc.line(line.number + 1), from = 0) {
    for (let k = firstNonBlank(line.text, from); k >= 0; k = firstNonBlank(line.text, k + 1)) {
      const row = rowAt(view, line.from + k);
      if (row && row.bottom > reading) return row;
    }
    if (line.number === doc.lines || line.to >= view.viewport.to) return rowAt(view, start);
  }
}

/** The place as it is now; undefined while the editor is not drawn. */
export function notePlace(view: EditorView): EditorPlace | undefined {
  const dom = view.scrollDOM;
  if (!dom.offsetParent) return undefined;
  const box = dom.getBoundingClientRect();
  const head = view.state.selection.main.head;
  const cursor = rowAt(view, head);
  const row = rowToKeep(cursor, firstRow(view, box.top), box);
  return row ? { pos: row.pos, y: row.top - box.top, cursor: row === cursor, head, doc: view.state.doc, left: dom.scrollLeft, scroll: dom.scrollTop, sideways: dom.scrollLeft } : undefined;
}

/** The place the settings' close keeps: `opened`, the one from before they opened, unless the reader has moved since. */
export function closingPlace(view: EditorView, opened: EditorPlace): EditorPlace {
  const now = notePlace(view);
  const place = now ? placeOnClose(opened, now, opened.doc === view.state.doc) : opened;
  // (A closing widens the editor, which never hides its cursor at the side: no reveal, which would undo a sideways scroll that hid it.)
  return { ...place, cursor: false };
}

/** Brings the place back to its row, measuring first. Says whether that moved anything. */
function settle(view: EditorView, place: EditorPlace): boolean {
  const dom = view.scrollDOM;
  let moved = false;
  // (Scrolling draws other lines, whose true heights can move the row again: a few rounds at most.)
  for (let round = 0; round < 4; round++) {
    view.requestMeasure();
    const row = rowAt(view, place.pos);
    // A row out of the drawn lines (those above it grew by more than CodeMirror draws around the view): near it first, by the heights CodeMirror knows.
    // (A view that has become too low to show the row where it was, the Problems list opened or the window made lower, shows it at its bottom edge; the height read is the one at the width now, which a scrollbar can change.)
    const y = yInView(place.y, view.defaultLineHeight, dom.clientHeight);
    const to = row ? dom.scrollTop + row.top - dom.getBoundingClientRect().top - y : view.lineBlockAt(place.pos).top - y;
    if (Math.abs(to - dom.scrollTop) < 0.5) break;
    const was = dom.scrollTop;
    dom.scrollTop = to;
    // (At the end of the scroll's range there is nothing more to gain.)
    if (Math.abs(dom.scrollTop - was) < 0.5) break;
    moved = true;
  }
  place.scroll = dom.scrollTop;
  place.sideways = dom.scrollLeft;
  return moved;
}

/** What the reader does that takes the place over from the hold. */
const TAKES_OVER = ['wheel', 'pointerdown', 'touchstart', 'keydown'] as const;
let stopHolding = (): void => {};

/** Keeps `place` now, before anything is drawn, and on the next frames until the rewrap is over. */
export function keepPlace(view: EditorView, place: EditorPlace): void {
  stopHolding();
  view.scrollDOM.scrollLeft = place.left;
  // (Without wrapping the row does not move, but a narrower editor can hide its cursor at the side.)
  if (place.cursor && !view.lineWrapping) view.dispatch({ effects: EditorView.scrollIntoView(place.head, { x: 'nearest', y: 'nearest', yMargin: 0 }) });
  let request = 0;
  let frames = 0;
  let quiet = 0;
  let over = false;
  const stop = () => {
    over = true;
    cancelAnimationFrame(request);
    for (const type of TAKES_OVER) view.dom.removeEventListener(type, stop);
    stopHolding = () => {};
  };
  /** Corrects the place, and again after the microtasks that its measure leaves: a new width's wrap marks. */
  const correct = (left: number, moved: boolean) => {
    if (over) return;
    if (view.state.doc !== place.doc || view.state.selection.main.head !== place.head) {
      stop();
      return;
    }
    moved = settle(view, place) || moved;
    if (left) {
      queueMicrotask(() => correct(left - 1, moved));
      return;
    }
    quiet = moved ? 0 : quiet + 1;
    frames++;
    if (holdGoesOn(frames, quiet)) request = requestAnimationFrame(() => correct(2, false));
    else stop();
  };
  for (const type of TAKES_OVER) view.dom.addEventListener(type, stop, { passive: true });
  stopHolding = stop;
  correct(2, false);
}
