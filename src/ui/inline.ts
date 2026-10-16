import * as vscode from 'vscode';
import { ExplainService } from '../service';

/** Faint one-line summary after the cursor line. */
export class InlineController implements vscode.Disposable {
  private decoration = vscode.window.createTextEditorDecorationType({
    after: {
      color: new vscode.ThemeColor('editorCodeLens.foreground'),
      fontStyle: 'italic',
      margin: '0 0 0 3em',
    },
    rangeBehavior: vscode.DecorationRangeBehavior.ClosedClosed,
  });
  private timer: ReturnType<typeof setTimeout> | undefined;
  private decorated = new Set<vscode.TextEditor>();
  private disposables: vscode.Disposable[] = [];

  constructor(private service: ExplainService) {
    this.disposables.push(
      vscode.window.onDidChangeTextEditorSelection((e) => this.schedule(e.textEditor)),
      vscode.window.onDidChangeActiveTextEditor((e) => {
        this.clearAll();
        if (e) this.schedule(e);
      }),
      vscode.workspace.onDidChangeTextDocument((e) => {
        const ed = vscode.window.activeTextEditor;
        if (ed && e.document === ed.document) this.schedule(ed);
      }),
    );
    this.refresh();
  }

  refresh(): void {
    this.clearAll();
    const ed = vscode.window.activeTextEditor;
    if (ed) this.update(ed);
  }

  private schedule(editor: vscode.TextEditor): void {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.update(editor), 60);
  }

  private update(editor: vscode.TextEditor): void {
    if (!this.service.enabled('inline') || !this.service.isTarget(editor.document)) {
      this.clear(editor);
      return;
    }
    const line = editor.selection.active.line;
    const ex = this.service.explain(editor.document, line);
    if (!ex.summary) {
      this.clear(editor);
      return;
    }
    const max = this.service.config.get<number>('inline.maxLength', 120);
    const text = ex.summary.length > max ? ex.summary.slice(0, max - 1) + '…' : ex.summary;
    const end = editor.document.lineAt(line).range.end;
    editor.setDecorations(this.decoration, [{
      range: new vscode.Range(end, end),
      renderOptions: { after: { contentText: `💡 ${text.replace(/`/g, '')}` } },
    }]);
    this.decorated.add(editor);
  }

  private clear(editor: vscode.TextEditor): void {
    editor.setDecorations(this.decoration, []);
    this.decorated.delete(editor);
  }

  private clearAll(): void {
    for (const ed of this.decorated) ed.setDecorations(this.decoration, []);
    this.decorated.clear();
  }

  dispose(): void {
    clearTimeout(this.timer);
    this.clearAll();
    this.decoration.dispose();
    this.disposables.forEach((d) => d.dispose());
  }
}
