import * as vscode from 'vscode';
import { LEGEND, semanticTokens } from '../semanticTokens';
import type { ExplainService } from '../service';

const legend = new vscode.SemanticTokensLegend(LEGEND.tokenTypes, LEGEND.tokenModifiers);

/**
 * Colours shell code from our syntax tree, as semantic tokens over the TextMate grammar, when
 * `bashExplainer.highlight.enabled` is on. Off, nothing is registered, so the grammar alone colours. Not registered for Python, whose own provider (Pylance) would lose its tokens for the whole file.
 */
export class SemanticTokensController implements vscode.Disposable {
  private registration: vscode.Disposable | undefined;
  private changed = new vscode.EventEmitter<void>();

  constructor(private service: ExplainService) {
    this.refresh();
  }

  /** Registers or drops the provider as the setting says, and asks for new tokens (the language IDs may have changed). */
  refresh(): void {
    this.registration?.dispose();
    this.registration = undefined;
    if (!this.service.settings['highlight.enabled']) return;
    // No answer (not an empty one) for a document with no shell code: VS Code takes the first non-null result, so an
    // empty one would hide the tokens of another provider.
    const tokens = (doc: vscode.TextDocument, lines?: { from: number; to: number }) => {
      if (!this.service.isTarget(doc) || !this.service.hasShell(doc)) return undefined;
      return new vscode.SemanticTokens(new Uint32Array(semanticTokens(this.service.document(doc), lines)));
    };
    const selector = this.service.semanticSelector();
    this.registration = vscode.Disposable.from(
      vscode.languages.registerDocumentSemanticTokensProvider(selector, { onDidChangeSemanticTokens: this.changed.event, provideDocumentSemanticTokens: (doc) => tokens(doc) }, legend),
      vscode.languages.registerDocumentRangeSemanticTokensProvider(selector, { provideDocumentRangeSemanticTokens: (doc, r) => tokens(doc, { from: r.start.line, to: r.end.line }) }, legend),
    );
    this.changed.fire();
  }

  dispose(): void {
    this.registration?.dispose();
    this.changed.dispose();
  }
}
