import * as vscode from 'vscode';
import { LEGEND, semanticTokens } from '../semanticTokens';
import type { ExplainService } from '../service';

const legend = new vscode.SemanticTokensLegend(LEGEND.tokenTypes, LEGEND.tokenModifiers);

/**
 * Colours shell code from our syntax tree and models, as semantic tokens over the TextMate grammar, where
 * `bashExplainer.highlight.enabled` is on for the document's language (the setting can be overridden per language:
 * `"[makefile]": { "bashExplainer.highlight.enabled": false }`). Where it is off, the provider gives no answer, so the
 * grammar alone colours. Not registered for Python or Dockerfiles, whose own providers (Pylance, the Docker extension's language
 * server) would lose their tokens for the whole file.
 * The tree and the models come from the service's caches, per document version, shared with the panel and the diagnostics.
 */
export class SemanticTokensController implements vscode.Disposable {
  private registration: vscode.Disposable | undefined;
  private changed = new vscode.EventEmitter<void>();

  constructor(private service: ExplainService) {
    this.refresh();
  }

  /** Registers the provider for the languages of the settings, and asks for new tokens (the setting or the language IDs may have changed). */
  refresh(): void {
    this.registration?.dispose();
    // No answer (not an empty one) for a document with no shell code, or with the setting off: VS Code takes the first
    // non-null result, so an empty one would hide the tokens of another provider.
    const tokens = (doc: vscode.TextDocument, cancel: vscode.CancellationToken, lines?: { from: number; to: number }) => {
      // (A request VS Code no longer needs, as typing goes on, is not worked out.)
      if (cancel.isCancellationRequested || !this.service.highlightEnabled(doc) || !this.service.isTarget(doc) || !this.service.hasShell(doc)) return undefined;
      const parsed = this.service.document(doc);
      return new vscode.SemanticTokens(new Uint32Array(semanticTokens(parsed, { shells: this.service.shells(doc), ...(lines ? { lines } : {}) })));
    };
    const selector = this.service.semanticSelector();
    this.registration = vscode.Disposable.from(
      vscode.languages.registerDocumentSemanticTokensProvider(selector, { onDidChangeSemanticTokens: this.changed.event, provideDocumentSemanticTokens: (doc, cancel) => tokens(doc, cancel) }, legend),
      vscode.languages.registerDocumentRangeSemanticTokensProvider(selector, { provideDocumentRangeSemanticTokens: (doc, r, cancel) => tokens(doc, cancel, { from: r.start.line, to: r.end.line }) }, legend),
    );
    this.changed.fire();
  }

  dispose(): void {
    this.registration?.dispose();
    this.changed.dispose();
  }
}
