import * as vscode from 'vscode';
import { ExplainService } from '../service';
import { toMarkdown } from './render';

export class HoverController implements vscode.HoverProvider, vscode.Disposable {
  private registration: vscode.Disposable | undefined;
  private forceNext = false;
  private followTimer: ReturnType<typeof setTimeout> | undefined;
  private disposables: vscode.Disposable[] = [];

  constructor(private service: ExplainService) {
    this.register();
    this.disposables.push(
      vscode.window.onDidChangeTextEditorSelection((e) => this.onSelection(e)),
    );
  }

  /** (Re-)register for the configured languages. */
  register(): void {
    this.registration?.dispose();
    this.registration = vscode.languages.registerHoverProvider(
      this.service.languages.map((language) => ({ language })),
      this,
    );
  }

  /** Show the hover at the cursor, regardless of the display mode. */
  async showAtCursor(): Promise<void> {
    this.forceNext = true;
    await vscode.commands.executeCommand('editor.action.showHover');
    // If no hover was requested (e.g. focus elsewhere), do not leak the flag to a later mouse hover.
    setTimeout(() => (this.forceNext = false), 500);
  }

  provideHover(doc: vscode.TextDocument, pos: vscode.Position): vscode.Hover | undefined {
    const forced = this.forceNext;
    this.forceNext = false;
    if (!forced && !this.service.showsHover()) return undefined;
    const ex = this.service.explain(doc, pos.line);
    if (!ex.items.length && !forced) return undefined;
    const args = encodeURIComponent(JSON.stringify([{ uri: doc.uri.toString(), line: pos.line }]));
    const link = `command:bashExplain.openPanel?${args}`;
    const md = new vscode.MarkdownString(toMarkdown(ex, this.service.lang, forced ? undefined : pos, link), true);
    md.isTrusted = { enabledCommands: ['bashExplain.openPanel'] };
    return new vscode.Hover(md, doc.lineAt(pos.line).range);
  }

  private onSelection(e: vscode.TextEditorSelectionChangeEvent): void {
    clearTimeout(this.followTimer);
    if (!this.service.showsHover() || !this.service.config.get<boolean>('hover.followCursor', false)) return;
    if (e.kind === vscode.TextEditorSelectionChangeKind.Command) return;
    if (!this.service.isTarget(e.textEditor.document) || !e.selections[0].isEmpty) return;
    const editor = e.textEditor;
    this.followTimer = setTimeout(() => {
      if (vscode.window.activeTextEditor === editor && !editor.document.lineAt(editor.selection.active.line).isEmptyOrWhitespace) {
        void this.showAtCursor();
      }
    }, this.service.config.get<number>('hover.followDelay', 400));
  }

  dispose(): void {
    clearTimeout(this.followTimer);
    this.registration?.dispose();
    this.disposables.forEach((d) => d.dispose());
  }
}
