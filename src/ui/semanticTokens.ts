import * as vscode from 'vscode';
import { LEGEND, semanticTokens } from '../semanticTokens';
import type { ExplainService } from '../service';

const legend = new vscode.SemanticTokensLegend(LEGEND.tokenTypes, LEGEND.tokenModifiers);

/**
 * Colours shell code from our syntax tree, as semantic tokens over the TextMate grammar, when
 * `bashExplainer.highlight.enabled` is on. Off, nothing is registered, so the grammar alone colours.
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
    if (!this.service.config.get<boolean>('highlight.enabled', false)) return;
    const tokens = (doc: vscode.TextDocument, lines?: { from: number; to: number }) => {
      const parsed = this.service.isTarget(doc) && this.service.hasShell(doc) ? this.service.document(doc) : undefined;
      return new vscode.SemanticTokens(new Uint32Array(parsed ? semanticTokens(parsed, lines) : []));
    };
    const selector = this.service.selector();
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
