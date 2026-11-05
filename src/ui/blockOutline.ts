import * as vscode from 'vscode';
import { contained } from '../failures';
import type { ExplainService } from '../service';
import type { BlockOutline } from '../settings';
import { blockAt } from './blockAt';

/**
 * Marks the command over several lines at the cursor (src/ui/blockAt.ts) in the editors, with the setting
 * `bashExplainer.blockOutline`: a bar at the left of its lines (`bar`), a faint background (`tint`), or nothing (`off`:
 * no decoration type, and the handlers return at once). A decoration of a whole line takes no room (VS Code draws it
 * in a layer of its own), so no text moves, and the selection, the current line and wrapped rows stay as they are. The
 * colours are theme colours (contributes.colors in package.json, `bashExplainer.blockBar` and `bashExplainer.blockTint`),
 * with a default for each kind of theme; a user can change them in `workbench.colorCustomizations`.
 *
 * The block is looked up in the document's syntax tree, which the service parses when the text has changed (the cache
 * misses on a new version, 90 to 135 ms for 5000 lines). A key fires the selection event along with the text event, so a
 * move of the cursor that comes with a new version of the text waits for the timer (150 ms after the last change, as the
 * panel's): typing parses the text once when it rests, not at each key. A move on the same version draws at once.
 */
export class BlockOutlineController implements vscode.Disposable {
  private mode: BlockOutline | undefined;
  private type: vscode.TextEditorDecorationType | undefined;
  private timer: ReturnType<typeof setTimeout> | undefined;
  /** The documents changed since the timer was set (one timer for all). */
  private changed = new Set<vscode.TextDocument>();
  /** The version of each document at its last drawing: the selection handler draws only on the same one. */
  private drawn = new WeakMap<vscode.TextDocument, number>();
  private disposables: vscode.Disposable[] = [];
  /** How many lookups of a block were made (read by the tests). */
  lookups = 0;

  constructor(private service: Pick<ExplainService, 'settings' | 'isTarget' | 'document'>) {
    this.disposables.push(
      vscode.window.onDidChangeTextEditorSelection((e) => {
        const v = this.drawn.get(e.textEditor.document);
        if (v !== undefined && v !== e.textEditor.document.version) return;
        this.draw(e.textEditor);
      }),
      vscode.window.onDidChangeActiveTextEditor((e) => e && this.draw(e)),
      vscode.window.onDidChangeVisibleTextEditors((es) => es.forEach((e) => this.draw(e))),
      // The tree trails typing: the block is looked up again once the text rests.
      vscode.workspace.onDidChangeTextDocument((e) => {
        if (!this.type) return;
        this.changed.add(e.document);
        clearTimeout(this.timer);
        this.timer = setTimeout(() => {
          const docs = this.changed;
          this.changed = new Set();
          vscode.window.visibleTextEditors.filter((v) => docs.has(v.document)).forEach((v) => this.draw(v));
        }, 150);
      }),
    );
    this.settingsChanged();
  }

  /**
   * The configuration changed (the extension calls it after every change, once the services have forgotten their
   * documents): draws again at once, with the other kind of mark or none for a new mode; for the same mode too, since
   * the languages and the embedded files decide which documents are marked.
   */
  settingsChanged(): void {
    const mode = this.service.settings.blockOutline;
    if (mode === this.mode) {
      vscode.window.visibleTextEditors.forEach((v) => this.draw(v));
      return;
    }
    this.mode = mode;
    // (Disposing a type takes its marks off every editor.)
    this.type?.dispose();
    this.type = mode === 'off' ? undefined : vscode.window.createTextEditorDecorationType({
      isWholeLine: true,
      ...(mode === 'bar'
        ? { borderStyle: 'solid', borderWidth: '0 0 0 2px', borderColor: new vscode.ThemeColor('bashExplainer.blockBar') }
        : { backgroundColor: new vscode.ThemeColor('bashExplainer.blockTint') }),
    });
    vscode.window.visibleTextEditors.forEach((v) => this.draw(v));
  }

  private draw(editor: vscode.TextEditor): void {
    if (!this.type) return;
    // (A failure of the lookup leaves the marks as they were: the extension goes on.)
    contained('the block mark', () => {
      const doc = editor.document;
      let range: vscode.Range[] = [];
      if (this.service.isTarget(doc)) {
        this.lookups++;
        const at = editor.selection.active;
        const block = blockAt(this.service.document(doc), at.line, at.character);
        // (One range of whole lines: the lines of the block, each with the decoration, as a range per line would give.)
        if (block) range = [new vscode.Range(block.startLine, 0, block.endLine, 0)];
      }
      this.drawn.set(doc, doc.version);
      editor.setDecorations(this.type!, range);
    }, () => undefined);
  }

  dispose(): void {
    clearTimeout(this.timer);
    this.changed.clear();
    this.disposables.forEach((d) => d.dispose());
    this.type?.dispose();
  }
}
