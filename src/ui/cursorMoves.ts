// Whether the reader moved the cursor, with no edit, since the panel was last sent the line: the panel then opens the stages of a
// pipeline the cursor moved into (`ModelRow.atCursor`, src/ui/panelRows.ts). Typing and a paste move the cursor too, to the end of
// what they put, but that is no reader choosing a stage, so they open nothing (the maintainer's rule of 2026-11-07). Each product says
// what it knows, where it knows it: the web page from an update of its editor (web/main.ts), VS Code from its selection events
// (src/ui/followMoves.ts). A tap, a click and an arrow key are all moves, not told apart (the maintainer's rule of 2026-11-08): each
// opens the stages the cursor is in and drops the viewer's ▸ fold of them, even where the cursor was in them already (media/panel.js).

/** A document as VS Code gives it: the same object for the same document. */
export type Doc = object;

/** A change of a document's text as VS Code gives it (`TextDocumentContentChangeEvent`): its range in the text before, as offsets. */
export interface TextChange { readonly rangeOffset: number; readonly rangeLength: number; readonly text: string }

/** A stretch of a document's text, as offsets from its start to its end, both included. */
type Stretch = readonly [number, number];

/**
 * Where an offset of the text before an edit is in the text after it (`changes`: those of one edit, each range in the text before it,
 * apart from one another): moved by what the changes before it added or took; in a change, or at its edges, at the start of what it put
 * or (`after`) at its end.
 */
function mapped(at: number, changes: readonly TextChange[], after: boolean): number {
  let to = at;
  for (const c of changes) {
    if (c.rangeOffset + c.rangeLength < at) to += c.text.length - c.rangeLength;
    else if (c.rangeOffset <= at) to += c.rangeOffset - at + (after ? c.text.length : 0);
  }
  return to;
}

/** An update of the web page's editor, as CodeMirror gives it (`ViewUpdate`). */
export interface EditorUpdate {
  docChanged: boolean;
  selectionSet: boolean;
  transactions: readonly { selection: unknown; isUserEvent(event: string): boolean }[];
}

/** The moves of the cursor not yet sent to the panel. */
export class CursorMoves {
  private pending = false;
  /** The document of the last change of the selection, in VS Code. */
  private doc: Doc | undefined;
  /** The stretches of the text the edits of `doc` put since that change (`edited`). */
  private put: Stretch[] = [];
  /** The ends of the selections of that change, where the edits since have carried them (`edited`). */
  private ends: readonly number[] = [];

  /**
   * The cursor changed: `moved`, by the reader with no edit (the web page's editor knows both of each update); or not, by an edit or a
   * selection made by the page or a command (the panel's reveal). The last change says.
   */
  cursor(moved: boolean): void {
    this.pending = moved;
  }

  /**
   * An update of the web page's editor: a move when it sets a selection the reader made (a `select…` event: a key, a click, a tap) and
   * changes no text. A selection the page sets, as the panel's reveal, has no such event; typing and a paste change the text.
   */
  editorUpdate(u: EditorUpdate): void {
    if (!u.docChanged && !u.selectionSet) return;
    this.cursor(!u.docChanged && u.transactions.some((tr) => tr.selection !== undefined && tr.isUserEvent('select')));
  }

  /**
   * An edit of `doc` in VS Code. VS Code tells it before the change of the selection the edit makes (typing, a paste, Backspace), and
   * an edit that leaves the cursor in place makes none (Delete, a format on save, Replace All elsewhere): integration/extension.itest.ts
   * checks both. It is no move, and it keeps the stretches of the text it put and carries the ends of the last selection along, by
   * which `selected` tells the edit's own change of the selection from the reader's next one. An edit of a document the reader has no
   * cursor in (not the one of the last change of the selection) leaves all as it is.
   */
  edited(doc: Doc, changes: readonly TextChange[]): void {
    if (doc !== this.doc) return;
    this.cursor(false);
    const put = changes.map((c): Stretch => { const from = mapped(c.rangeOffset, changes, false); return [from, from + c.text.length]; });
    this.put = [...this.put.map(([from, to]): Stretch => [mapped(from, changes, false), mapped(to, changes, true)]), ...put];
    this.ends = this.ends.map((o) => mapped(o, changes, true));
  }

  /**
   * A change of the selection in `doc`, by the reader (`by`: a key or a pointer) or not (a command, the panel's reveal), as VS Code says
   * it, with the offsets of the ends of its selections (`at`). It is a move when the reader made it in the document of the change
   * before, and an edit since did not make it: typing and a paste change the selection with the kind `Keyboard` too, but each of their
   * cursors lies in the text they put, or (a paste of a whole line, put before the cursor's line) it is where the edits carried the
   * selection before. So the first move after an edit that left the cursor in place is one.
   */
  selected(doc: Doc, by: boolean, at: readonly number[]): void {
    const same = this.doc === doc;
    const edits = this.put;
    const carried = edits.length > 0 && (at.every((o) => edits.some(([from, to]) => from <= o && o <= to)) || (at.length === this.ends.length && at.every((o, i) => o === this.ends[i])));
    this.doc = doc;
    this.put = [];
    this.ends = at;
    this.cursor(same && !carried && by);
  }

  /** The move the line to send comes after, once: the next one comes after none, unless the reader moves again. */
  take(): boolean {
    const was = this.pending;
    this.pending = false;
    return was;
  }
}
