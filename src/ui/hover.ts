import * as vscode from 'vscode';
import { heredocAt } from '../document';
import { ExplainService } from '../service';
import { blankRange, partAt, rangeOnLine } from './hoverParts';
import { HoverInput, lineCard, partHover, wholeLine } from './hoverView';
import { ThemeKind } from './palette';
import { pruneDepth } from './render';

/**
 * The hover (docs/design/hover.md): a hover at a position explains the part there; on no part, a small card of the
 * line. The whole line opens only through our command (Ctrl+K Ctrl+E, the context menu) or the hover's link.
 */
export class HoverController implements vscode.HoverProvider, vscode.Disposable {
  private registration: vscode.Disposable | undefined;
  private forceNext = false;
  private followTimer: ReturnType<typeof setTimeout> | undefined;
  private disposables: vscode.Disposable[] = [];

  constructor(private service: ExplainService) {
    this.register();
    this.disposables.push(
      vscode.window.onDidChangeTextEditorSelection((e) => this.onSelection(e)),
    );
  }

  /** (Re-)register for the configured languages. */
  register(): void {
    this.registration?.dispose();
    this.registration = vscode.languages.registerHoverProvider(this.service.selector(), this);
  }

  /** Explain the whole cursor line in the hover, even when the hover is turned off. */
  async showAtCursor(): Promise<void> {
    this.forceNext = true;
    await vscode.commands.executeCommand('editor.action.showHover');
    // If no hover was requested (e.g. focus elsewhere), do not leak the flag to a later mouse hover.
    setTimeout(() => (this.forceNext = false), 500);
  }

  /** The link "Whole line" of the hover: the cursor goes to that line (if it is elsewhere), and the hover explains it whole. */
  async explainLine(target?: { uri: string; line: number }): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return;
    if (target && editor.document.uri.toString() === target.uri && editor.selection.active.line !== target.line) {
      const p = new vscode.Position(target.line, editor.document.lineAt(target.line).firstNonWhitespaceCharacterIndex);
      editor.selection = new vscode.Selection(p, p);
    }
    // The click leaves the focus in the hover: the editor takes it back, so that the hover shows at its cursor.
    await vscode.window.showTextDocument(editor.document, { viewColumn: editor.viewColumn, preserveFocus: false });
    await vscode.commands.executeCommand('editor.action.hideHover');
    await this.showAtCursor();
  }

  provideHover(doc: vscode.TextDocument, pos: vscode.Position): vscode.Hover | undefined {
    const forced = this.forceNext;
    this.forceNext = false;
    if (!forced && !this.service.enabled('hover')) return undefined;
    if (!this.service.isTarget(doc)) return undefined;
    const full = this.service.explain(doc, pos.line);
    if (!full.items.length && !forced) return undefined;
    // The hover can be kept short: fewer levels of the tree, examples only in the panel.
    const settings = this.service.settings;
    const ex = {
      ...full,
      items: pruneDepth(full.items, settings['hover.maxDepth']),
      examples: settings['examples.inHover'] ? full.examples : [],
    };
    const line = doc.lineAt(pos.line);
    const args = encodeURIComponent(JSON.stringify([{ uri: doc.uri.toString(), line: pos.line }]));
    const x: HoverInput = {
      ex, lang: this.service.lang, theme: themeKind(), lineText: line.text, placement: this.service.examplePlacement,
      panelLink: `command:bashExplainer.openPanel?${args}`, lineLink: `command:bashExplainer.explainLine?${args}`,
      keys: typeof process === 'object' && process.platform === 'darwin' ? '⌘K ⌘E' : 'Ctrl+K Ctrl+E',
    };
    const chain = forced ? [] : partAt(ex.items, pos, heredocAt(this.service.document(doc), pos.line));
    const [value, span] = forced ? [wholeLine(x), line.range]
      : chain.length ? [partHover(x, chain), rangeOnLine(chain[chain.length - 1].span, pos.line, line.text.length)]
        : [lineCard(x), blankRange(line.text, pos)];
    const md = new vscode.MarkdownString(value, true);
    md.supportHtml = true;
    md.isTrusted = { enabledCommands: ['bashExplainer.openPanel', 'bashExplainer.openSettings', 'bashExplainer.explainLine'] };
    const range = span instanceof vscode.Range ? span
      : new vscode.Range(span.start.line, span.start.character, span.end.line, span.end.character);
    return new vscode.Hover(md, range);
  }

  private onSelection(e: vscode.TextEditorSelectionChangeEvent): void {
    clearTimeout(this.followTimer);
    if (!this.service.enabled('hover') || !this.service.settings['hover.followCursor']) return;
    if (e.kind === vscode.TextEditorSelectionChangeKind.Command) return;
    if (!this.service.isTarget(e.textEditor.document) || !e.selections[0].isEmpty) return;
    const editor = e.textEditor;
    this.followTimer = setTimeout(() => {
      // The part at the cursor, as any hover at a position.
      if (vscode.window.activeTextEditor === editor && !editor.document.lineAt(editor.selection.active.line).isEmptyOrWhitespace) {
        void vscode.commands.executeCommand('editor.action.showHover');
      }
    }, this.service.settings['hover.followDelay']);
  }

  dispose(): void {
    clearTimeout(this.followTimer);
    this.registration?.dispose();
    this.disposables.forEach((d) => d.dispose());
  }
}

/** The kind of the active colour theme, whose colours the hover's labels take. */
function themeKind(): ThemeKind {
  switch (vscode.window.activeColorTheme.kind) {
    case vscode.ColorThemeKind.Light: return 'light';
    case vscode.ColorThemeKind.HighContrast: return 'highContrast';
    case vscode.ColorThemeKind.HighContrastLight: return 'highContrastLight';
    default: return 'dark';
  }
}
