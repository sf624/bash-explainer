// Long lines in the page's editor wrap between shell words (docs/design/chrome-redesign.md, C1a), with the setting
// `editor.wrap`. CodeMirror's `lineWrapping` breaks a line wherever the browser may: after the `-` of `sort -u`, at a
// slash of a path, at the blank inside `"done: $(date +%F)"`. Here each run of src/ui/wrapRuns.ts (a word with its
// quotes and substitutions, or any text between blanks) that fits on a row is drawn `white-space: pre`, so a row ends
// only at a blank between runs. A run wider than a row breaks at its own blanks; a part of it still too wide may break
// anywhere (the line keeps `overflow-wrap: anywhere`): the last resort, never a sideways scroll.
//
// The widths are measured with the editor's own font (a canvas, so a fallback font for Japanese counts as drawn), never
// estimated from a character's width. Only the lines in view are marked, so the work per key press does not grow with
// the script. The runs come from the tree, which trails typing (web/main.ts): until the next tree, the runs of the last
// one move with the text, and new text breaks at its blanks, so typing at the end of a wrapped line does not move its
// earlier rows. The rows after the first are indented by the line's own indentation and 2ch more (a hanging indent),
// and the gutter marks each of them with ↪.
import { Range, RangeSet, StateEffect } from '@codemirror/state';
import { Decoration, DecorationSet, EditorView, gutter, GutterMarker, ViewPlugin, ViewUpdate } from '@codemirror/view';
import { blankRuns, type Run } from '../src/ui/wrapRuns';

/** How far the rows after the first are indented past the line's own indentation, in characters. */
const HANG = 2;
/** CodeMirror's padding of a line (`0 2px 0 6px`), and a pixel for the cursor at the end of a row. */
const LINE_PADDING = 6 + 2 + 1;

/** New runs, from the tree of the text the editor has now: [from, to) positions in the document. */
export const setWrapRuns = StateEffect.define<ReadonlyArray<readonly [number, number]>>();

/** A run's range, only to move it with the text (it draws nothing). */
const runMark = Decoration.mark({});
/** A run kept on one row. */
const keep = Decoration.mark({ class: 'cm-bx-run' });
const hangs = new Map<number, Decoration>();
const hangOf = (cols: number) => hangs.get(cols) ?? hangs.set(cols, Decoration.line({ attributes: { style: `--bx-hang: ${cols}ch` } })).get(cols)!;

/** The leading blanks of a line, in columns (a tab to the next stop of `tabSize`). */
function indentOf(text: string, tabSize: number): number {
  let col = 0;
  for (const ch of text) {
    if (ch === ' ') col++;
    else if (ch === '\t') col += tabSize - (col % tabSize);
    else break;
  }
  return col;
}

/** The editor's content was measured again: a new width or font. */
const remeasured = StateEffect.define<null>();

const wordMarks = ViewPlugin.fromClass(class {
  decorations: DecorationSet = Decoration.none;
  /** The runs of the last tree, moved with the text since. */
  runs: DecorationSet = Decoration.none;
  /** The width of the editor's content the marks were made for, and its font (0 and '' until it is laid out). */
  width = 0;
  font = '';
  readonly widths = new Map<string, number>();
  readonly canvas = document.createElement('canvas').getContext('2d');
  /** How many lines were marked since the view was made (read by the speed test, test/web-wrap.test.ts). */
  marked = 0;
  /** Reads the width and the font where CodeMirror reads the layout, never while it updates. */
  readonly measure: { read: (view: EditorView) => { width: number; font: string }; write: (m: { width: number; font: string }, view: EditorView) => void };

  constructor(view: EditorView) {
    this.measure = {
      read: (v) => ({ width: v.contentDOM.clientWidth, font: getComputedStyle(v.contentDOM).font }),
      write: ({ width, font }, v) => {
        if (Math.abs(width - this.width) <= 1 && font === this.font) return;
        if (font !== this.font) this.widths.clear();
        this.width = width;
        this.font = font;
        // (A transaction may not start while the view measures.)
        void Promise.resolve().then(() => v.dispatch({ effects: remeasured.of(null) }));
      },
    };
    view.requestMeasure(this.measure);
  }

  update(u: ViewUpdate): void {
    let fresh: ReadonlyArray<readonly [number, number]> | undefined;
    let resized = false;
    for (const tr of u.transactions) {
      for (const e of tr.effects) {
        if (e.is(setWrapRuns)) fresh = e.value;
        else if (e.is(remeasured)) resized = true;
      }
    }
    if (fresh) this.runs = RangeSet.of(fresh.map(([from, to]) => runMark.range(from, to)));
    else if (u.docChanged) this.runs = this.runs.map(u.changes);
    if (u.geometryChanged) u.view.requestMeasure(this.measure);
    if (fresh || resized || u.viewportChanged) this.decorations = this.build(u.view, u.view.visibleRanges);
    else if (u.docChanged) {
      // A key press: the lines it changed only, the others' marks moved with the text.
      const changed: { from: number; to: number }[] = [];
      u.changes.iterChangedRanges((_a, _b, from, to) => {
        // (Only what shows of them: a paste of many lines marks the lines in view.)
        for (const v of u.view.visibleRanges) {
          const a = Math.max(from, v.from), b = Math.min(to, v.to);
          if (a <= b) changed.push({ from: u.state.doc.lineAt(a).from, to: u.state.doc.lineAt(b).to });
        }
      });
      let set = this.decorations.map(u.changes);
      for (const r of changed) {
        set = set.update({ filterFrom: r.from, filterTo: r.to, filter: () => false, add: this.marks(u.view, [r]), sort: true });
      }
      this.decorations = set;
    }
  }

  /** How wide a text draws in the editor's font, in pixels. */
  widthOf(text: string, tabSize: number): number {
    let w = this.widths.get(text);
    if (w === undefined) {
      this.canvas!.font = this.font;
      w = this.canvas!.measureText(text.replace(/\t/g, ' '.repeat(tabSize))).width;
      if (this.widths.size > 5000) this.widths.clear();
      this.widths.set(text, w);
    }
    return w;
  }

  build(view: EditorView, ranges: readonly { from: number; to: number }[]): DecorationSet {
    return Decoration.set(this.marks(view, ranges), true);
  }

  /** The marks of the lines in `ranges`: each line's hanging indent, and its runs that fit on a row. */
  marks(view: EditorView, ranges: readonly { from: number; to: number }[]): Range<Decoration>[] {
    // (Not laid out yet: the first measure brings the width.)
    if (!this.width || !this.canvas) return [];
    const marks: Range<Decoration>[] = [];
    const tabSize = view.state.tabSize;
    const ch = this.widthOf('0', tabSize);
    const room = this.width - LINE_PADDING;
    for (const { from, to } of ranges) {
      for (let pos = from; pos <= to;) {
        const line = view.state.doc.lineAt(pos);
        pos = line.to + 1;
        this.marked++;
        const text = line.text;
        const hang = Math.min(indentOf(text, tabSize), Math.floor(room / ch / 2)) + HANG;
        marks.push(hangOf(hang).range(line.from));
        // A run may land on a row after the first, which is `hang` narrower.
        const fit = room - hang * ch;
        for (const [s, e] of this.lineRuns(line.from, text)) {
          if (e - s < 2) continue;
          const run = text.slice(s, e);
          if (this.widthOf(run, tabSize) <= fit) {
            marks.push(keep.range(line.from + s, line.from + e));
            continue;
          }
          // Too wide whole: it breaks at its own blanks, each part kept whole where it fits.
          for (const [a, b] of blankRuns(run)) {
            if (b - a > 1 && this.widthOf(run.slice(a, b), tabSize) <= fit) marks.push(keep.range(line.from + s + a, line.from + s + b));
          }
        }
      }
    }
    view.dom.dataset.wrapMarked = String(this.marked);
    return marks;
  }

  /** The runs of a line: those of the tree, and the text between them (new since the tree) cut at its blanks. */
  lineRuns(start: number, text: string): Run[] {
    const out: Run[] = [];
    let at = 0;
    const gap = (to: number) => {
      for (const [a, b] of blankRuns(text.slice(at, to))) out.push([at + a, at + b]);
    };
    this.runs.between(start, start + text.length, (from, to) => {
      const s = Math.max(from - start, at);
      const e = Math.min(to - start, text.length);
      if (e <= s) return;
      gap(s);
      out.push([s, e]);
      at = e;
    });
    gap(text.length);
    return out;
  }
}, { decorations: (p) => p.decorations });

/** The gutter's ↪ on each row after a line's first. */
class WrapMarks extends GutterMarker {
  constructor(readonly rows: number, readonly height: number) {
    super();
  }
  eq(other: WrapMarks): boolean {
    return other.rows === this.rows && other.height === this.height;
  }
  toDOM(): Node {
    const box = document.createElement('span');
    box.className = 'cm-bx-wrapmarks';
    box.setAttribute('aria-hidden', 'true');
    for (let r = 1; r < this.rows; r++) {
      const mark = document.createElement('span');
      mark.textContent = '↪';
      mark.style.top = `${Math.round(r * this.height)}px`;
      box.append(mark);
    }
    return box;
  }
}

const wrapGutter = gutter({
  class: 'cm-bx-wrap-gutter',
  lineMarker(view, line) {
    const h = view.defaultLineHeight;
    const rows = Math.round(line.height / h);
    return rows > 1 ? new WrapMarks(rows, h) : null;
  },
  lineMarkerChange: (u) => u.geometryChanged || u.docChanged || u.viewportChanged,
});

const theme = EditorView.baseTheme({
  // The hanging indent: the first row starts at the line's padding, the others `--bx-hang` further in.
  '.cm-lineWrapping .cm-line': { paddingLeft: 'calc(6px + var(--bx-hang, 2ch))', textIndent: 'calc(-1 * var(--bx-hang, 2ch))' },
  '.cm-bx-run': { whiteSpace: 'pre' },
  '.cm-bx-wrap-gutter': { width: '12px' },
  '.cm-bx-wrap-gutter .cm-gutterElement': { position: 'relative', padding: '0' },
  '.cm-bx-wrapmarks > span': {
    position: 'absolute', left: '0', width: '12px', textAlign: 'center',
    color: 'var(--vscode-descriptionForeground)', opacity: '0.7', fontSize: '11px',
  },
});

/** Wrapping between shell words, with the hanging indent and the gutter's marks. */
export const wordWrap = [EditorView.lineWrapping, wordMarks, wrapGutter, theme];
