import * as vscode from 'vscode';
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
 */
export class BlockOutlineController implements vscode.Disposable {
  private mode: BlockOutline | undefined;
  private type: vscode.TextEditorDecorationType | undefined;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private disposables: vscode.Disposable[] = [];
  /** How many lookups of a block were made (read by the tests). */
  lookups = 0;

  constructor(private service: Pick<ExplainService, 'settings' | 'isTarget' | 'document'>) {
    this.disposables.push(
      vscode.window.onDidChangeTextEditorSelection((e) => this.draw(e.textEditor)),
      vscode.window.onDidChangeActiveTextEditor((e) => e && this.draw(e)),
      vscode.window.onDidChangeVisibleTextEditors((es) => es.forEach((e) => this.draw(e))),
      // The tree trails typing: the block is looked up again once the text rests.
      vscode.workspace.onDidChangeTextDocument((e) => {
        if (!this.type) return;
        clearTimeout(this.timer);
        this.timer = setTimeout(() => vscode.window.visibleTextEditors.filter((v) => v.document === e.document).forEach((v) => this.draw(v)), 150);
      }),
    );
    this.settingsChanged();
  }

  /** The setting may have changed (the extension calls it after every change of the configuration): draws at once, with the other kind of mark or none. */
  settingsChanged(): void {
    const mode = this.service.settings.blockOutline;
    if (mode === this.mode) return;
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
    const doc = editor.document;
    const ranges: vscode.Range[] = [];
    if (this.service.isTarget(doc)) {
      this.lookups++;
      const at = editor.selection.active;
      const block = blockAt(this.service.document(doc), at.line, at.character);
      if (block) for (let n = block.startLine; n <= block.endLine; n++) ranges.push(new vscode.Range(n, 0, n, 0));
    }
    editor.setDecorations(this.type, ranges);
  }

  dispose(): void {
    clearTimeout(this.timer);
    this.disposables.forEach((d) => d.dispose());
    this.type?.dispose();
  }
}
