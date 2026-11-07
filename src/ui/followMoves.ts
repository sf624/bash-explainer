// What VS Code says of the cursor, for the panel's moves (src/ui/cursorMoves.ts). Apart from src/ui/panel.ts so that a unit test can
// feed it a stand-in of VS Code's events (test/cursor-moves.test.ts); integration/extension.itest.ts feeds it VS Code's own.
import * as vscode from 'vscode';
import type { CursorMoves } from './cursorMoves';

/**
 * Tells `moves` what VS Code says of the cursor in a document the panel explains (`isTarget`): a change of the selection by a key
 * (`Keyboard`) or a pointer (`Mouse`), both the reader's moves (typing and a paste are of the kind `Keyboard` too: the text they put tells
 * them apart), the editor open now or another, with its selections (a paste right after the switch is told by them too), an
 * edit (integration/extension.itest.ts checks them on typing, a paste, Delete, the keys, undo and selections set by an extension). A
 * change in another document, as a README, schedules no line, so it leaves the moves as they are.
 */
export function followMoves(moves: CursorMoves, isTarget: (doc: vscode.TextDocument) => boolean): vscode.Disposable[] {
  const { Keyboard, Mouse } = vscode.TextEditorSelectionChangeKind;
  const ends = (doc: vscode.TextDocument, sels: readonly vscode.Selection[]) => sels.flatMap((s) => [doc.offsetAt(s.anchor), doc.offsetAt(s.active)]);
  // (The editor open already: its first move is one.)
  const active = vscode.window.activeTextEditor;
  if (active && isTarget(active.document)) moves.selected(active.document, false, ends(active.document, active.selections));
  return [
    vscode.window.onDidChangeTextEditorSelection((e) => {
      const doc = e.textEditor.document;
      if (isTarget(doc)) moves.selected(doc, e.kind === Mouse || e.kind === Keyboard, ends(doc, e.selections));
    }),
    vscode.window.onDidChangeActiveTextEditor((e) => {
      if (e && isTarget(e.document)) moves.selected(e.document, false, ends(e.document, e.selections));
    }),
    vscode.workspace.onDidChangeTextDocument((e) => {
      if (e.contentChanges.length) moves.edited(e.document, e.contentChanges);
    }),
  ];
}
