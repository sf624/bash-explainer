// PROTOTYPE (design study): inlay hints on the cursor line, in place of the line-end summary. After each command name,
// what it is (the badge of the panel); after each option of a command, the start of what it means. Each hint's tooltip
// is the whole explanation, and a click opens the line in the panel. `editor.inlayHints.enabled` turns them on, off, or
// on only while Ctrl+Alt is held.
import * as vscode from 'vscode';
import { Token } from '../analyzer-types';
import { ExplainService } from '../service';
import { surprisingNames, surpriseText } from './surprising';

export class InlayHintsController implements vscode.InlayHintsProvider, vscode.Disposable {
  private emitter = new vscode.EventEmitter<void>();
  readonly onDidChangeInlayHints = this.emitter.event;
  private line = -1;
  private disposables: vscode.Disposable[] = [];

  constructor(private service: ExplainService) {
    this.disposables.push(
      vscode.languages.registerInlayHintsProvider(service.selector(), this),
      vscode.workspace.onDidChangeConfiguration((e) => { if (e.affectsConfiguration('bashExplainer')) this.emitter.fire(); }),
      vscode.window.onDidChangeTextEditorSelection((e) => {
        if (e.selections[0].active.line !== this.line) {
          this.line = e.selections[0].active.line;
          this.emitter.fire();
        }
      }),
    );
  }

  provideInlayHints(doc: vscode.TextDocument, range: vscode.Range): vscode.InlayHint[] {
    if (vscode.workspace.getConfiguration('bashExplainer').get<boolean>('proto.nameHints', false)) return this.nameHints(doc, range);
    if (!vscode.workspace.getConfiguration('bashExplainer').get<boolean>('proto.inlayHints', false)) return [];
    const editor = vscode.window.activeTextEditor;
    if (!editor || editor.document !== doc || !this.service.isTarget(doc)) return [];
    const line = editor.selection.active.line;
    if (line < range.start.line || line > range.end.line) return [];
    const ex = this.service.explain(doc, line);
    const args = encodeURIComponent(JSON.stringify([{ uri: doc.uri.toString(), line }]));
    const hints: vscode.InlayHint[] = [];
    const add = (tok: Token, text: string) => {
      const end = tok.name ? nameEnd(tok, doc) : tok.span.end;
      if (end.line !== line) return;
      const tip = new vscode.MarkdownString(`${tok.explanation}${tok.name?.said.also ? `\n\n${tok.name.said.also}` : ''}\n\n[$(comment-discussion) Open in panel](command:bashExplainer.openPanel?${args})`, true);
      tip.isTrusted = { enabledCommands: ['bashExplainer.openPanel'] };
      const part = new vscode.InlayHintLabelPart(text);
      part.tooltip = tip;
      part.command = { title: 'Open in panel', command: 'bashExplainer.openPanel', arguments: [{ uri: doc.uri.toString(), line }] };
      const h = new vscode.InlayHint(new vscode.Position(end.line, end.character), [part]);
      h.paddingLeft = true;
      hints.push(h);
    };
    const walk = (t: Token) => {
      if (t.name) add(t, t.name.said.kind + (t.name.said.by ? ` · ${t.name.said.by.replace(/`/g, '')}` : '') + (t.name.said.also ? ' +' : ''));
      else if (t.kind === 'option' && t.origin === 'argv') add(t, short(t.explanation));
      t.children.forEach(walk);
    };
    ex.items.forEach(walk);
    return hints;
  }

  /**
   * hi2: hints only where a name does not run what it suggests, on every line in view (not only the cursor line).
   * The tooltip says what runs and what else the name is; a click opens the line in the panel.
   */
  private nameHints(doc: vscode.TextDocument, range: vscode.Range): vscode.InlayHint[] {
    if (!this.service.isTarget(doc)) return [];
    const lang = this.service.lang;
    const hints: vscode.InlayHint[] = [];
    for (let line = range.start.line; line <= range.end.line && line < doc.lineCount; line++) {
      if (doc.lineAt(line).isEmptyOrWhitespace) continue;
      const ex = this.service.explain(doc, line);
      for (const { tok, why } of surprisingNames(ex, line)) {
        const end = nameEnd(tok, doc);
        const s = tok.name!.said;
        const args = encodeURIComponent(JSON.stringify([{ uri: doc.uri.toString(), line }]));
        const tip = new vscode.MarkdownString([`\`${tok.name!.name}\` **${s.kind}**${s.by ? ` — ${s.by}` : ''}`, s.also ?? '', tok.explanation, `[$(comment-discussion) ${lang === 'ja' ? 'パネルで開く' : 'Open in panel'}](command:bashExplainer.openPanel?${args})`].filter(Boolean).join('\n\n'), true);
        tip.isTrusted = { enabledCommands: ['bashExplainer.openPanel'] };
        const part = new vscode.InlayHintLabelPart(surpriseText(tok, why, lang));
        part.tooltip = tip;
        part.command = { title: 'Open in panel', command: 'bashExplainer.openPanel', arguments: [{ uri: doc.uri.toString(), line }] };
        const h = new vscode.InlayHint(new vscode.Position(end.line, end.character), [part]);
        h.paddingLeft = true;
        h.paddingRight = true;
        hints.push(h);
      }
    }
    return hints;
  }

  dispose(): void {
    this.emitter.dispose();
    this.disposables.forEach((d) => d.dispose());
  }
}

/** The end of the name itself: a command's token spans the whole command, its name is its first word. */
function nameEnd(tok: Token, doc: vscode.TextDocument): { line: number; character: number } {
  const text = doc.lineAt(tok.span.start.line).text.slice(tok.span.start.character);
  const m = /^\S+/.exec(text);
  return { line: tok.span.start.line, character: tok.span.start.character + (m ? m[0].length : 0) };
}

/** The start of an explanation, cut at a word: a hint must stay short. */
function short(text: string, max = 26): string {
  const plain = text.replace(/`/g, '').replace(/\s*\(.*$/, '');
  if (plain.length <= max) return plain;
  const cut = plain.slice(0, max);
  return cut.slice(0, Math.max(cut.lastIndexOf(' '), 12)) + '…';
}
