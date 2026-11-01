import * as vscode from 'vscode';
import { ExplainService } from '../service';
import { nameHints } from './nameHints';
import { ui } from './texts';

/**
 * Inlay hints after the command names that do not run what they suggest (src/ui/nameHints.ts), on the lines in view.
 * `bashExplainer.hints.names` turns them off; VS Code's `editor.inlayHints.enabled` turns all hints on, off, or on
 * while Ctrl+Alt is held. The tooltip says what runs and what else the name is; a click opens the line in the panel.
 */
export class InlayHintsController implements vscode.InlayHintsProvider, vscode.Disposable {
  private emitter = new vscode.EventEmitter<void>();
  readonly onDidChangeInlayHints = this.emitter.event;
  private registration: vscode.Disposable | undefined;

  /** Until when a move of the cursor asks for the hints again (see `refresh`). */
  private againUntil = 0;
  private againTimer: ReturnType<typeof setTimeout> | undefined;
  private disposables: vscode.Disposable[] = [];

  constructor(private service: ExplainService) {
    this.register();
    this.disposables.push(vscode.window.onDidChangeTextEditorSelection(() => {
      if (Date.now() > this.againUntil) return;
      clearTimeout(this.againTimer);
      this.againTimer = setTimeout(() => this.emitter.fire(), 300);
    }));
  }

  /** (Re-)register for the configured languages. */
  register(): void {
    this.registration?.dispose();
    this.registration = vscode.languages.registerInlayHintsProvider(this.service.selector(), this);
  }

  /** Ask VS Code for the hints again (a setting, or a choice in the panel, changed them). */
  refresh(): void {
    this.emitter.fire();
    // VS Code (1.142) keeps a copy of the hints of the line whose hint the mouse is on, and puts that copy back when
    // the mouse moves off it, even after a refresh: a language switched meanwhile left that hint in the old language,
    // until the next edit or scroll. For a minute, a move of the cursor asks for the hints again, to replace the copy.
    this.againUntil = Date.now() + 60_000;
  }

  provideInlayHints(doc: vscode.TextDocument, range: vscode.Range): vscode.InlayHint[] {
    if (!this.service.settings['hints.names'] || !this.service.isTarget(doc)) return [];
    const lang = this.service.lang;
    const hints: vscode.InlayHint[] = [];
    for (let line = range.start.line; line <= range.end.line && line < doc.lineCount; line++) {
      const text = doc.lineAt(line).text;
      if (!text.trim()) continue;
      const target = { uri: doc.uri.toString(), line };
      const link = `command:bashExplainer.openPanel?${encodeURIComponent(JSON.stringify([target]))}`;
      for (const h of nameHints(this.service.explain(doc, line), line, text, lang)) {
        const tip = new vscode.MarkdownString(`${h.tooltip}\n\n[$(comment-discussion) ${ui[lang].openInPanel}](${link})`, true);
        tip.isTrusted = { enabledCommands: ['bashExplainer.openPanel'] };
        const part = new vscode.InlayHintLabelPart(h.label);
        part.tooltip = tip;
        part.command = { title: ui[lang].openInPanel, command: 'bashExplainer.openPanel', arguments: [target] };
        const hint = new vscode.InlayHint(new vscode.Position(h.position.line, h.position.character), [part]);
        hint.paddingLeft = true;
        hint.paddingRight = true;
        hints.push(hint);
      }
    }
    return hints;
  }

  dispose(): void {
    this.registration?.dispose();
    clearTimeout(this.againTimer);
    this.disposables.forEach((d) => d.dispose());
    this.emitter.dispose();
  }
}
