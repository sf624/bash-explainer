import * as vscode from 'vscode';
import { LEGEND, RICH_LEGEND, richSemanticTokens, semanticTokens } from '../semanticTokens';
import type { ExplainService } from '../service';

// Design study: BASH_EXPLAINER_PLAIN_TOKENS=1 keeps the tokens of the tree only (the shipped provider), for comparisons.
const rich = !process.env.BASH_EXPLAINER_PLAIN_TOKENS;
const legend = rich ? new vscode.SemanticTokensLegend(RICH_LEGEND.tokenTypes, RICH_LEGEND.tokenModifiers) : new vscode.SemanticTokensLegend(LEGEND.tokenTypes, LEGEND.tokenModifiers);

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
    if (!this.service.settings['highlight.enabled']) return;
    const tokens = (doc: vscode.TextDocument, lines?: { from: number; to: number }) => {
      // No shell code: no answer (undefined), so that another provider for the language (Docker's) is asked instead.
      if (!this.service.isTarget(doc) || !this.service.hasShell(doc)) return process.env.BASH_EXPLAINER_EMPTY_TOKENS ? new vscode.SemanticTokens(new Uint32Array()) : undefined;
      const parsed = this.service.document(doc);
      const t0 = performance.now();
      const data = rich ? richSemanticTokens(parsed, this.service.shellOf(doc), lines) : semanticTokens(parsed, lines);
      if (process.env.BASH_EXPLAINER_TOKEN_TIMES) console.log(`[bash-explainer] semantic tokens ${doc.lineCount} lines${lines ? ` ${lines.from}-${lines.to}` : ''}: ${(performance.now() - t0).toFixed(1)} ms`);
      return new vscode.SemanticTokens(new Uint32Array(data));
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
