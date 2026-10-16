import * as vscode from 'vscode';
import type { Fix } from '../fixes';
import { ExplainService } from '../service';

/**
 * Puts the warnings shown in explanations (constructs the target shell lacks, injection risks…)
 * into the Problems panel, with quick fixes where a portable rewrite exists.
 */
export class DiagnosticsController implements vscode.CodeActionProvider, vscode.Disposable {
  private collection = vscode.languages.createDiagnosticCollection('bashExplain');
  /** Quick fixes of each document, by diagnostic code and range. */
  private fixes = new Map<string, { code: string; range: vscode.Range; fix: Fix }[]>();
  private timers = new Map<string, ReturnType<typeof setTimeout>>();
  private disposables: vscode.Disposable[] = [];

  static readonly metadata: vscode.CodeActionProviderMetadata = { providedCodeActionKinds: [vscode.CodeActionKind.QuickFix] };

  constructor(private service: ExplainService) {
    this.disposables.push(
      this.collection,
      vscode.workspace.onDidOpenTextDocument((d) => this.update(d)),
      vscode.workspace.onDidChangeTextDocument((e) => this.schedule(e.document)),
      vscode.workspace.onDidCloseTextDocument((d) => this.clear(d)),
      vscode.languages.registerCodeActionsProvider({ language: 'shellscript' }, this, DiagnosticsController.metadata),
    );
    this.refresh();
  }

  /** Recompute every open document (after a settings change). */
  refresh(): void {
    vscode.workspace.textDocuments.forEach((d) => this.update(d));
  }

  private schedule(doc: vscode.TextDocument): void {
    const key = doc.uri.toString();
    clearTimeout(this.timers.get(key));
    this.timers.set(key, setTimeout(() => this.update(doc), 500));
  }

  private clear(doc: vscode.TextDocument): void {
    this.collection.delete(doc.uri);
    this.fixes.delete(doc.uri.toString());
  }

  private update(doc: vscode.TextDocument): void {
    if (doc.isClosed || !this.service.config.get<boolean>('diagnostics.enabled', true) || !this.service.isTarget(doc)) {
      this.clear(doc);
      return;
    }
    const fixes: { code: string; range: vscode.Range; fix: Fix }[] = [];
    const diagnostics = this.service.issues(doc).map((i) => {
      const range = new vscode.Range(i.startLine, i.startCol, i.endLine, i.endCol);
      // The ⚠ / ℹ marks are for the hover; the Problems panel has its own icons.
      const d = new vscode.Diagnostic(range, i.message.replace(/^[⚠ℹ]\s*/u, ''), i.severity === 'warning' ? vscode.DiagnosticSeverity.Warning : vscode.DiagnosticSeverity.Information);
      d.source = 'Bash Explain';
      d.code = i.code;
      if (i.fix) fixes.push({ code: i.code, range, fix: i.fix });
      return d;
    });
    this.collection.set(doc.uri, diagnostics);
    this.fixes.set(doc.uri.toString(), fixes);
  }

  provideCodeActions(doc: vscode.TextDocument, _range: vscode.Range, context: vscode.CodeActionContext): vscode.CodeAction[] {
    const lang = this.service.lang;
    const known = this.fixes.get(doc.uri.toString()) ?? [];
    return context.diagnostics
      .filter((d) => d.source === 'Bash Explain')
      .flatMap((d) => known.filter((k) => k.code === d.code && k.range.isEqual(d.range)).map((k) => {
        const action = new vscode.CodeAction(k.fix.title[lang === 'ja' ? 0 : 1], vscode.CodeActionKind.QuickFix);
        action.diagnostics = [d];
        action.isPreferred = true;
        action.edit = new vscode.WorkspaceEdit();
        for (const e of k.fix.edits) action.edit.replace(doc.uri, new vscode.Range(e.startLine, e.startCol, e.endLine, e.endCol), e.text);
        return action;
      }));
  }

  dispose(): void {
    this.timers.forEach((t) => clearTimeout(t));
    this.disposables.forEach((d) => d.dispose());
  }
}
