import * as vscode from 'vscode';
import { plain } from '../document';
import type { Fix } from '../fixes';
import { ExplainService } from '../service';
import { surprisingNames, surpriseText } from './surprising';

/**
 * Puts the warnings shown in explanations (constructs the target shell lacks, injection risks…)
 * into the Problems panel, with quick fixes where a portable rewrite exists.
 */
export class DiagnosticsController implements vscode.CodeActionProvider, vscode.Disposable {
  private collection = vscode.languages.createDiagnosticCollection('bashExplainer');
  /** Quick fixes of each document, by diagnostic code and range. */
  private fixes = new Map<string, { code: string; range: vscode.Range; fix: Fix }[]>();
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
    const fixes: { code: string; range: vscode.Range; fix: Fix }[] = [];
    const diagnostics = this.service.issues(doc).map((i) => {
      const range = new vscode.Range(i.startLine, i.startCol, i.endLine, i.endCol);
      // The ⚠ / ℹ marks are for the hover; the Problems panel has its own icons.
      const d = new vscode.Diagnostic(range, plain(i.message), i.severity === 'warning' ? vscode.DiagnosticSeverity.Warning : vscode.DiagnosticSeverity.Information);
      d.source = 'Bash Explainer';
      d.code = i.code;
      if (i.fix) fixes.push({ code: i.code, range, fix: i.fix });
      return d;
    });
    // PROTOTYPE (hi2): the pitfalls the explanations say that are not problems yet (the analyzer's catalog facts), and
    // the surprising command names as hints (no Problems entry: three dots under the name, the message on hover).
    const proto = vscode.workspace.getConfiguration('bashExplainer');
    const notes = proto.get<boolean>('proto.noteDiagnostics', false), names = proto.get<boolean>('proto.nameDiagnostics', false);
    if (notes || names) {
      for (let line = 0; line < doc.lineCount; line++) {
        if (doc.lineAt(line).isEmptyOrWhitespace) continue;
        const ex = this.service.explain(doc, line);
        if (notes && ex.line === line) {
          for (const n of ex.notes.filter((t) => /^⚠/.test(t))) {
            const body = plain(n).slice(0, 40);
            if (diagnostics.some((d) => d.range.start.line <= line && line <= d.range.end.line && d.message.startsWith(body))) continue;
            const r = doc.lineAt(line).range;
            const d = new vscode.Diagnostic(new vscode.Range(line, doc.lineAt(line).firstNonWhitespaceCharacterIndex, line, r.end.character), plain(n), vscode.DiagnosticSeverity.Information);
            d.source = 'Bash Explainer';
            d.code = ex.facts?.find((f) => f.text === n)?.id ?? 'note';
            diagnostics.push(d);
          }
        }
        if (names) {
          for (const { tok, why } of surprisingNames(ex, line)) {
            const text = doc.lineAt(line).text;
            const m = /^\S+/.exec(text.slice(tok.span.start.character));
            const d = new vscode.Diagnostic(new vscode.Range(line, tok.span.start.character, line, tok.span.start.character + (m?.[0].length ?? 1)), `${surpriseText(tok, why, this.service.lang)}${tok.name!.said.also ? `. ${plain(tok.name!.said.also)}` : ''}`, vscode.DiagnosticSeverity.Hint);
            d.source = 'Bash Explainer';
            d.code = `name-${why}`;
            diagnostics.push(d);
          }
        }
      }
    }
    this.collection.set(doc.uri, diagnostics);
    this.fixes.set(doc.uri.toString(), fixes);
  }

  provideCodeActions(doc: vscode.TextDocument, _range: vscode.Range, context: vscode.CodeActionContext): vscode.CodeAction[] {
    const lang = this.service.lang;
    const known = this.fixes.get(doc.uri.toString()) ?? [];
    return context.diagnostics
      .filter((d) => d.source === 'Bash Explainer')
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
    this.registration?.dispose();
    this.disposables.forEach((d) => d.dispose());
  }
}
