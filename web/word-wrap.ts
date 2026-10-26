// Prototype round 6 (proto/chrome-6): long lines wrap only between shell words, with a hanging indent.
//
// CodeMirror's `lineWrapping` breaks a line wherever the browser may (after a hyphen in `sort -u`, a slash in a path,
// a space inside `$(date +%F)`). Here each shell word that fits on a row is marked `white-space: pre`, so the line
// breaks only at the blanks between words. A word wider than a row is kept whole where it can be cut at its own
// blanks (`"done: $(date +%F)"` → `"done: $(date` and `+%F)"`), and a run without blanks that is still too wide may
// break anywhere (the line keeps `overflow-wrap: anywhere`): the last resort, never a scroll.
// The rows after the first are indented by the line's own indentation plus 2ch (a hanging indent), and the gutter marks
// each of them with a faint ↪.
import { RangeSetBuilder } from '@codemirror/state';
import { Decoration, DecorationSet, EditorView, gutter, GutterMarker, ViewPlugin, ViewUpdate } from '@codemirror/view';

/** How far the rows after the first are indented past the line's own indentation, in characters. */
const HANG = 2;

/** The shell words of one line, as [from, to) offsets: blanks inside quotes, `$( )`, `${ }`, `<( )` and backquotes do not split a word; a comment is split at each blank. */
export function shellWords(text: string): Array<[number, number]> {
  const words: Array<[number, number]> = [];
  const n = text.length;
  const blank = (c: string) => c === ' ' || c === '\t';
  let i = 0;
  while (i < n) {
    while (i < n && blank(text[i])) i++;
    if (i >= n) break;
    const start = i;
    if (text[i] === '#') {
      // A comment: plain words.
      while (i < n) {
        while (i < n && blank(text[i])) i++;
        const s = i;
        while (i < n && !blank(text[i])) i++;
        if (i > s) words.push([s, i]);
      }
      break;
    }
    // What the word is inside: quotes, $( ) or ( ), ${ }, backquotes.
    const stack: string[] = [];
    while (i < n) {
      const c = text[i];
      const top = stack[stack.length - 1];
      if (top === "'") {
        if (c === "'") stack.pop();
        i++;
        continue;
      }
      if (c === '\\') {
        i += 2;
        continue;
      }
      if (top === '`') {
        if (c === '`') stack.pop();
        i++;
        continue;
      }
      if (!top && blank(c)) break;
      if (top === '"' && c === '"') {
        stack.pop();
        i++;
        continue;
      }
      if (top === '(' && c === ')') {
        stack.pop();
        i++;
        continue;
      }
      if (top === '{' && c === '}') {
        stack.pop();
        i++;
        continue;
      }
      if (top !== '"' && (c === '"' || c === "'")) {
        stack.push(c);
        i++;
        continue;
      }
      if (top === '"' && c === "'") {
        i++;
        continue;
      }
      if (c === '`') {
        stack.push('`');
        i++;
        continue;
      }
      // `$(`, `$((`, `<(`, `>(`, `=(` (an array), and a `(` inside one.
      if (c === '(' && (top === '(' || (i > start && '$<>='.includes(text[i - 1])))) {
        stack.push('(');
        i++;
        continue;
      }
      if (c === '{' && i > start && text[i - 1] === '$') {
        stack.push('{');
        i++;
        continue;
      }
      i++;
    }
    words.push([start, Math.min(i, n)]);
  }
  return words;
}

/** The width of a text in columns: East Asian wide characters take two. */
function columns(text: string): number {
  let w = 0;
  for (const ch of text) w += /[ᄀ-ᅟ⺀-꓏가-힣豈-﫿︰-﹏＀-｠￠-￦]/u.test(ch) ? 2 : 1;
  return w;
}

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

const keep = Decoration.mark({ class: 'cm-bx-word' });
const hangs = new Map<number, Decoration>();
const hangOf = (cols: number) => hangs.get(cols) ?? hangs.set(cols, Decoration.line({ attributes: { style: `--bx-hang: ${cols}ch` } })).get(cols)!;

const wordMarks = ViewPlugin.fromClass(class {
  decorations: DecorationSet;
  /** The width the marks were made for (a row's width changes what fits). */
  width = -1;
  constructor(view: EditorView) {
    this.decorations = this.build(view);
  }
  update(u: ViewUpdate): void {
    const width = u.view.contentDOM.clientWidth;
    if (u.docChanged || u.viewportChanged || (u.geometryChanged && Math.abs(width - this.width) > 1)) this.decorations = this.build(u.view);
  }
  build(view: EditorView): DecorationSet {
    this.width = view.contentDOM.clientWidth;
    const cw = view.defaultCharacterWidth || 8;
    // A row's room: the content's width less the line's padding (6px at the left, 2px at the right).
    const room = Math.floor((this.width - 8 - 1) / cw);
    const b = new RangeSetBuilder<Decoration>();
    const tabSize = view.state.tabSize;
    for (const { from, to } of view.visibleRanges) {
      for (let pos = from; pos <= to;) {
        const line = view.state.doc.lineAt(pos);
        const text = line.text;
        const indent = Math.min(indentOf(text, tabSize), Math.floor(room / 2));
        const hang = indent + HANG;
        b.add(line.from, line.from, hangOf(hang));
        // A word may land on a row after the first, which is `hang` columns narrower.
        const fit = room - hang;
        if (columns(text) > room - 1) {
          for (const [s, e] of shellWords(text)) {
            if (e - s < 2) continue;
            if (columns(text.slice(s, e)) <= fit) {
              b.add(line.from + s, line.from + e, keep);
              continue;
            }
            // Too wide whole: its own blanks are the breaks, each run kept whole where it fits.
            const word = text.slice(s, e);
            const runs = /[^ \t]+/g;
            for (let m = runs.exec(word); m; m = runs.exec(word)) {
              if (m[0].length > 1 && columns(m[0]) <= fit) b.add(line.from + s + m.index, line.from + s + m.index + m[0].length, keep);
            }
          }
        }
        pos = line.to + 1;
      }
    }
    return b.finish();
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
  // The hanging indent: the first row starts at the line's padding; the others `--bx-hang` further in.
  '.cm-lineWrapping .cm-line': { paddingLeft: 'calc(6px + var(--bx-hang, 2ch))', textIndent: 'calc(-1 * var(--bx-hang, 2ch))' },
  '.cm-bx-word': { whiteSpace: 'pre' },
  '.cm-bx-wrap-gutter': { width: '12px' },
  '.cm-bx-wrap-gutter .cm-gutterElement': { position: 'relative', padding: '0' },
  '.cm-bx-wrapmarks > span': {
    position: 'absolute', left: '0', width: '12px', textAlign: 'center',
    color: 'var(--vscode-descriptionForeground)', opacity: '0.55', fontSize: '11px',
  },
});

/** Wrapping between shell words, with the hanging indent and the gutter's marks. */
export const wordWrap = [EditorView.lineWrapping, wordMarks, wrapGutter, theme];
