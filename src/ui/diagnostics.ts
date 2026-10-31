import * as vscode from 'vscode';
import { fixTitle, plain } from '../document';
import type { Fix } from '../fixes';
import { SEVERITIES } from '../levels';
import { ExplainService } from '../service';

/** The source of our diagnostics, by which the hover finds them (src/ui/hover.ts). */
export const DIAGNOSTIC_SOURCE = 'Bash Explainer';

/**
 * Puts the warnings shown in explanations (constructs the target shell lacks, injection risks…)
 * into the Problems panel, with quick fixes where a portable rewrite exists.
 */
export class DiagnosticsController implements vscode.CodeActionProvider, vscode.Disposable {
  private collection = vscode.languages.createDiagnosticCollection('bashExplainer');
  /** Quick fixes of each document, by diagnostic code and range. */
  private fixes = new Map<string, { code: string; range: vscode.Range; fix: Fix; preferred: boolean }[]>();
  private registration: vscode.Disposable | undefined;
  private timers = new Map<string, ReturnType<typeof setTimeout>>();
  private disposables: vscode.Disposable[] = [];

  static readonly metadata: vscode.CodeActionProviderMetadata = { providedCodeActionKinds: [vscode.CodeActionKind.QuickFix] };

  constructor(private service: ExplainService) {
    this.disposables.push(
      this.collection,
      vscode.workspace.onDidOpenTextDocument((d) => this.update(d)),
      vscode.workspace.onDidChangeTextDocument((e) => this.schedule(e.document)),
      vscode.workspace.onDidCloseTextDocument((d) => this.clear(d)),
    );
    this.register();
    this.refresh();
  }

  /** (Re-)register the quick fixes for the configured languages. */
  register(): void {
    this.registration?.dispose();
    this.registration = vscode.languages.registerCodeActionsProvider(this.service.selector(), this, DiagnosticsController.metadata);
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
    if (doc.isClosed || !this.service.isTarget(doc)) {
      this.clear(doc);
      return;
    }
    const fixes: { code: string; range: vscode.Range; fix: Fix; preferred: boolean }[] = [];
    const diagnostics = this.service.issues(doc).map((i) => {
      const range = new vscode.Range(i.startLine, i.startCol, i.endLine, i.endCol);
      // The marks are for the hover; the Problems panel has its own icons.
      const d = new vscode.Diagnostic(range, plain(i.message), SEVERITIES[i.severity].vscode);
      d.source = DIAGNOSTIC_SOURCE;
      d.code = i.code;
      for (const [k, fix] of (i.fixes ?? []).entries()) fixes.push({ code: i.code, range, fix, preferred: k === 0 });
      return d;
    });
    // Code that never runs: a hint the editor fades (no problem: no squiggle, and not in the Problems panel by default).
    for (const r of this.service.faded(doc)) {
      const d = new vscode.Diagnostic(new vscode.Range(r.startLine, r.startCol, r.endLine, r.endCol), plain(r.message), SEVERITIES[r.severity].vscode);
      d.source = DIAGNOSTIC_SOURCE;
      d.code = r.code;
      d.tags = [vscode.DiagnosticTag.Unnecessary];
      diagnostics.push(d);
    }
    this.collection.set(doc.uri, diagnostics);
    this.fixes.set(doc.uri.toString(), fixes);
  }

  provideCodeActions(doc: vscode.TextDocument, _range: vscode.Range, context: vscode.CodeActionContext): vscode.CodeAction[] {
    const lang = this.service.lang;
    const known = this.fixes.get(doc.uri.toString()) ?? [];
    return context.diagnostics
      .filter((d) => d.source === DIAGNOSTIC_SOURCE)
      .flatMap((d) => known.filter((k) => k.code === d.code && k.range.isEqual(d.range)).map((k) => {
        const action = new vscode.CodeAction(fixTitle(k.fix, lang), vscode.CodeActionKind.QuickFix);
        action.diagnostics = [d];
        // (The first fix of a problem is the one it recommends.)
        action.isPreferred = k.preferred;
        action.edit = new vscode.WorkspaceEdit();
        for (const e of k.fix.edits) action.edit.replace(doc.uri, new vscode.Range(e.startLine, e.startCol, e.endLine, e.endCol), e.text);
        return action;
      }));
  }

  dispose(): void {
    this.timers.forEach((t) => clearTimeout(t));
    this.registration?.dispose();
    this.disposables.forEach((d) => d.dispose());
  }
}
