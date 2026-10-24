import * as vscode from 'vscode';
import { ExplainService } from '../service';
import { ThemeKind } from './palette';
import { pruneDepth } from './render';
import { HoverLayout, hoverSpan, layoutMarkdown } from './hoverLayouts';

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

  /** Show the hover at the cursor, even when the hover is turned off. */
  async showAtCursor(): Promise<void> {
    this.forceNext = true;
    await vscode.commands.executeCommand('editor.action.showHover');
    // If no hover was requested (e.g. focus elsewhere), do not leak the flag to a later mouse hover.
    setTimeout(() => (this.forceNext = false), 500);
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
    const args = encodeURIComponent(JSON.stringify([{ uri: doc.uri.toString(), line: pos.line }]));
    const link = `command:bashExplainer.openPanel?${args}`;
    // PROTOTYPE: the layout comes from an unregistered setting (design study).
    const layout = vscode.workspace.getConfiguration('bashExplainer').get<HoverLayout>('proto.hoverLayout', 'list');
    const at = forced ? undefined : pos;
    const md = new vscode.MarkdownString(layoutMarkdown(layout, { ex, lang: this.service.lang, at, panelLink: link, lineText: doc.lineAt(pos.line).text, placement: this.service.examplePlacement, theme: themeKind() }), true);
    md.supportHtml = true;
    md.isTrusted = { enabledCommands: ['bashExplainer.openPanel', 'bashExplainer.openSettings'] };
    const span = hoverSpan(layout, ex, at);
    const lineRange = doc.lineAt(pos.line).range;
    const range = span ? new vscode.Range(span.start.line < pos.line ? lineRange.start : new vscode.Position(span.start.line, span.start.character), span.end.line > pos.line ? lineRange.end : new vscode.Position(span.end.line, span.end.character)) : lineRange;
    return new vscode.Hover(md, range);
  }

  private onSelection(e: vscode.TextEditorSelectionChangeEvent): void {
    clearTimeout(this.followTimer);
    if (!this.service.enabled('hover') || !this.service.settings['hover.followCursor']) return;
    if (e.kind === vscode.TextEditorSelectionChangeKind.Command) return;
    if (!this.service.isTarget(e.textEditor.document) || !e.selections[0].isEmpty) return;
    const editor = e.textEditor;
    this.followTimer = setTimeout(() => {
      if (vscode.window.activeTextEditor === editor && !editor.document.lineAt(editor.selection.active.line).isEmptyOrWhitespace) {
        void this.showAtCursor();
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
