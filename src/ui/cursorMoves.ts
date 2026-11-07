// Whether the reader moved the cursor, with no edit, since the panel was last sent the line: the panel then opens the stages of a
// pipeline the cursor moved into (`ModelRow.atCursor`, src/ui/panelRows.ts). Typing and a paste move the cursor too, to the end of
// what they put, but that is no reader choosing a stage, so they open nothing (the maintainer's rule of 2026-11-07). Each product says
// what it knows, where it knows it: the web page from an update of its editor (web/main.ts), VS Code from its selection events
// (src/ui/panel.ts).

/** A document as VS Code gives it: the same object for the same document, and a version that every edit raises. */
export interface Versioned { readonly version: number }

/** An update of the web page's editor, as CodeMirror gives it (`ViewUpdate`). */
export interface EditorUpdate {
  docChanged: boolean;
  selectionSet: boolean;
  transactions: readonly { selection: unknown; isUserEvent(event: string): boolean }[];
}

/** The moves of the cursor not yet sent to the panel. */
export class CursorMoves {
  private pending = false;
  private doc: Versioned | undefined;
  private version = 0;

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
    if (u.docChanged || u.selectionSet) this.cursor(!u.docChanged && u.transactions.some((tr) => tr.selection !== undefined && tr.isUserEvent('select')));
  }

  /** The text changed: what the cursor did with it is no move. */
  edited(): void {
    this.cursor(false);
  }

  /**
   * A change of the selection in `doc`, by the reader (`byReader`: a key, a pointer) or not (a command, the panel's reveal), as VS Code
   * says it. It is a move when the reader made it and the document has the version it had at the change before: an edit raised it.
   * Whichever of an edit's two events comes first, it is none (`edited` drops a move the selection's event took it for).
   */
  selected(doc: Versioned, byReader: boolean): void {
    const same = this.doc === doc && this.version === doc.version;
    this.doc = doc;
    this.version = doc.version;
    this.cursor(same && byReader);
  }

  /** Whether the line to send comes after a move, once: the next one does not, unless the reader moves again. */
  take(): boolean {
    const was = this.pending;
    this.pending = false;
    return was;
  }
}
