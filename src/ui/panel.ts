import * as vscode from 'vscode';
import { Span } from '../analyzer-types';
import { ExplainService } from '../service';
import { toPlainMarkdown, ui } from './render';
import { FromPanel, lineMarks, PANEL_BODY, PanelState, panelUpdate } from './panelView';
import { isPanelQuestion, panelReply } from './panelReply';
import { THEME_SETTINGS, themeRoleColours } from './themeColours';
import { panelPalette, paletteVars, type PanelBase } from './themePalette';

/** Where the panel's view and step are kept between sessions (the webview's own state dies with the panel). */
const STATE_KEY = 'bashExplainer.panelState';

/** Side pane that follows the cursor and shows a regex101-style breakdown of the current line. */
export class PanelController implements vscode.Disposable {
  private panel: vscode.WebviewPanel | undefined;
  /** The user closed the panel; do not reopen it automatically until asked. */
  private dismissed = false;
  private editor: vscode.TextEditor | undefined;
  /** Line requested from the hover link; shown until the cursor moves. */
  private pinnedLine: number | undefined;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private highlight = vscode.window.createTextEditorDecorationType({
    backgroundColor: new vscode.ThemeColor('editor.findMatchHighlightBackground'),
    borderRadius: '2px',
  });
  private disposables: vscode.Disposable[] = [];
  /** The view and step the viewer chose, kept in the global state: the tree is built only in the tree view. */
  private state: PanelState;
  /** What the panel last said it draws on (`themeBase`), and the number of the last theme request (an older answer is dropped). */
  private themeBase: PanelBase | undefined;
  private themeRequest = 0;

  constructor(private ctx: vscode.ExtensionContext, private service: ExplainService) {
    this.state = ctx.globalState.get<PanelState>(STATE_KEY) ?? {};
    this.disposables.push(
      // `panel.colors`: the colours of the theme in use, again when it or the user's customizations change (and on `refresh`, after our settings).
      vscode.window.onDidChangeActiveColorTheme(() => this.postTheme()),
      vscode.extensions.onDidChange(() => this.postTheme()),
      vscode.workspace.onDidChangeConfiguration((e) => {
        if (THEME_SETTINGS.some((k) => e.affectsConfiguration(k))) this.watchTheme();
      }),
      vscode.window.onDidChangeTextEditorSelection((e) => this.schedule(e.textEditor, 80)),
      vscode.window.onDidChangeActiveTextEditor((e) => {
        if (e) this.schedule(e, 0);
      }),
      vscode.workspace.onDidChangeTextDocument((e) => {
        if (this.editor && e.document === this.editor.document) this.schedule(this.editor, 150);
      }),
    );
  }

  /**
   * Called on activation and when `panel.autoOpen` is turned on: open the panel for the active
   * script. A panel the user opened stays open when auto-open is turned off.
   */
  autoOpen(): void {
    if (!this.service.enabled('panel')) return;
    this.dismissed = false;
    const ed = vscode.window.activeTextEditor;
    if (ed && this.service.isTarget(ed.document)) this.open(ed);
  }

  /** Re-render after a setting such as the language changes. */
  refresh(): void {
    this.watchTheme();
    this.post();
  }

  open(editor = vscode.window.activeTextEditor, line?: number): void {
    this.dismissed = false;
    this.pinnedLine = line;
    if (editor && this.service.isTarget(editor.document)) this.editor = editor;
    if (this.panel) {
      this.panel.reveal(undefined, true);
      this.post();
      return;
    }
    const media = vscode.Uri.joinPath(this.ctx.extensionUri, 'media');
    this.panel = vscode.window.createWebviewPanel(
      'bashExplainer.panel',
      ui[this.service.lang].title,
      { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true },
      { enableScripts: true, localResourceRoots: [media], retainContextWhenHidden: true },
    );
    this.panel.iconPath = vscode.Uri.joinPath(media, 'icon.svg');
    this.panel.webview.html = this.html(this.panel.webview, media);
    this.panel.webview.onDidReceiveMessage((m: FromPanel) => this.onMessage(m), undefined, this.disposables);
    this.panel.onDidDispose(() => {
      this.panel = undefined;
      this.dismissed = true;
      this.clearHighlight();
    }, undefined, this.disposables);
  }

  private schedule(editor: vscode.TextEditor, delay: number): void {
    if (!this.service.isTarget(editor.document)) return;
    this.editor = editor;
    this.pinnedLine = undefined;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      if (!this.panel && this.service.enabled('panel') && !this.dismissed) this.open(editor);
      else this.post();
    }, delay);
  }

  /** Asks the panel to report what it draws on when the colours follow the theme (`themeWatch`), and sends them. */
  private watchTheme(): void {
    const on = this.service.panelColours !== 'classic';
    if (!on) this.themeBase = undefined;
    void this.panel?.webview.postMessage({ type: 'themeWatch', on });
    this.postTheme();
  }

  /** Sends the panel the role colours of `panel.colors` in the theme in use (none: its own). */
  private postTheme(): void {
    const id = ++this.themeRequest;
    const mode = this.service.panelColours;
    const base = this.themeBase;
    if (!this.panel || mode === 'classic' || !base) return;
    // (A theme or a customization the code cannot read leaves the panel's own colours.)
    const vars = themeRoleColours(this.ctx, this.service.settings['highlight.enabled']).then((roles) => (roles ? paletteVars(panelPalette(mode, roles, base)) : {})).catch(() => ({}));
    void vars.then((v) => {
      if (id === this.themeRequest) void this.panel?.webview.postMessage({ type: 'themeColours', vars: v });
    });
  }

  private post(): void {
    if (!this.panel) return;
    const lang = this.service.lang;
    const t = ui[lang];
    const ed = this.editor;
    if (!ed || ed.document.isClosed) {
      void this.panel.webview.postMessage({ type: 'empty', message: t.noEditor, settingsLabel: t.settings });
      return;
    }
    const line = Math.min(this.pinnedLine ?? ed.selection.active.line, ed.document.lineCount - 1);
    const ex = this.service.explain(ed.document, line, this.state.view === 'tree');
    this.panel.title = `${t.title}: ${fileName(ed.document)}:${line + 1}`;
    void this.panel.webview.postMessage(panelUpdate({
      lang,
      explanation: ex,
      file: fileName(ed.document),
      line,
      lineText: ed.document.lineAt(line).text,
      choice: this.service.overrideOf(ed.document),
      detected: this.service.detectedShell(ed.document),
      placement: this.service.examplePlacement,
      animations: this.service.panelAnimations,
      marks: lineMarks(this.service.issues(ed.document), line),
    }));
  }

  private onMessage(m: FromPanel): void {
    const ed = this.editor;
    if (m.type === 'ready') {
      void this.panel?.webview.postMessage({ type: 'panelState', state: this.state });
      this.watchTheme();
      return this.post();
    }
    if (m.type === 'panelState') {
      const treeBefore = this.state.view === 'tree';
      this.state = m.state;
      void this.ctx.globalState.update(STATE_KEY, m.state);
      // The tree is built only for the tree view: explain the line again for the view just chosen.
      if ((m.state.view === 'tree') !== treeBefore) this.post();
      return;
    }
    if (m.type === 'themeBase') {
      this.themeBase = m.base;
      return this.postTheme();
    }
    if (m.type === 'openSettings') return void vscode.commands.executeCommand('bashExplainer.openSettings');
    if (isPanelQuestion(m)) return void this.panel?.webview.postMessage(panelReply(m, this.service.lang));
    if (!ed || ed.document.isClosed) return;
    if (m.type === 'copy') {
      const line = Math.min(this.pinnedLine ?? ed.selection.active.line, ed.document.lineCount - 1);
      const md = toPlainMarkdown(this.service.explain(ed.document, line), ed.document.lineAt(line).text, `${fileName(ed.document)}:${line + 1}`, this.service.lang);
      void vscode.env.clipboard.writeText(md).then(() => vscode.window.showInformationMessage(ui[this.service.lang].panel.copied));
      return;
    }
    if (m.type === 'override') return this.service.override(ed.document, m.key, m.value);
    if (m.type === 'highlight') {
      ed.setDecorations(this.highlight, m.span ? [toRange(m.span)] : []);
    } else if (m.type === 'reveal') {
      const r = toRange(m.span);
      void vscode.window.showTextDocument(ed.document, { viewColumn: ed.viewColumn, selection: new vscode.Selection(r.start, r.end), preserveFocus: m.preserveFocus }); // (the tree view keeps the focus in the panel)
    }
  }

  private clearHighlight(): void {
    for (const ed of vscode.window.visibleTextEditors) ed.setDecorations(this.highlight, []);
  }

  private html(webview: vscode.Webview, media: vscode.Uri): string {
    const nonce = Array.from({ length: 32 }, () => Math.floor(Math.random() * 36).toString(36)).join('');
    const css = webview.asWebviewUri(vscode.Uri.joinPath(media, 'panel.css'));
    const icons = webview.asWebviewUri(vscode.Uri.joinPath(media, 'icons.js'));
    const js = webview.asWebviewUri(vscode.Uri.joinPath(media, 'panel.js'));
    return `<!DOCTYPE html>
<html lang="${this.service.lang}">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource}; script-src 'nonce-${nonce}';">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<link rel="stylesheet" href="${css}">
</head>
<body>
${PANEL_BODY}
<script nonce="${nonce}" src="${icons}"></script>
<script nonce="${nonce}" src="${js}"></script>
</body>
</html>`;
  }

  dispose(): void {
    clearTimeout(this.timer);
    this.panel?.dispose();
    this.highlight.dispose();
    this.disposables.forEach((d) => d.dispose());
  }
}

/** The document's file name, from its URI (there is no file system path on the web). */
function fileName(doc: vscode.TextDocument): string {
  return doc.uri.path.split('/').pop() || doc.fileName;
}

function toRange(s: Span): vscode.Range {
  return new vscode.Range(s.start.line, s.start.character, s.end.line, s.end.character);
}
