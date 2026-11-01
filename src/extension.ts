import * as vscode from 'vscode';
import { createUnbashParser } from './syntax/adapters/unbash';
import { TreeCache } from './syntax/cache';
import { ExplainService } from './service';
import { TOKEN_SETTINGS } from './settings';
import { DiagnosticsController } from './ui/diagnostics';
import { HoverController } from './ui/hover';
import { InlayHintsController } from './ui/inlayHints';
import { INLINE_NOTICE_KEY, inlineNotice, inlineNoticeDue } from './ui/inlineNotice';
import { PanelController } from './ui/panel';
import { SemanticTokensController } from './ui/semanticTokens';
import { type Feature, ui } from './ui/texts';

export async function activate(ctx: vscode.ExtensionContext): Promise<void> {
  const parser = createUnbashParser();
  const service = new ExplainService(new TreeCache(parser));
  const hover = new HoverController(service);
  const panel = new PanelController(ctx, service);
  const hints = new InlayHintsController(service);
  const diagnostics = new DiagnosticsController(service);
  const semantic = new SemanticTokensController(service);
  const status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  status.command = 'bashExplainer.selectDisplayMode';

  let statusTimer: ReturnType<typeof setTimeout> | undefined;
  const updateStatus = () => {
    const t = ui[service.lang];
    const on = (Object.keys(t.features) as Feature[]).filter((f) => service.enabled(f));
    status.text = `$(comment-discussion) ${on.map((f) => t.short[f]).join(' + ') || t.off}`;
    status.tooltip = t.statusTooltip;
    const doc = vscode.window.activeTextEditor?.document;
    const active = service.isTarget(doc) && service.hasShell(doc);
    // Shows the panel button and the context-menu entry in any file with shell code.
    void vscode.commands.executeCommand('setContext', 'bashExplainer.hasShell', active);
    if (active) status.show();
    else status.hide();
  };

  ctx.subscriptions.push(
    service, hover, panel, hints, diagnostics, semantic, status,
    vscode.commands.registerCommand('bashExplainer.showAtCursor', () => hover.showAtCursor()),
    // The hover's link to the whole line.
    vscode.commands.registerCommand('bashExplainer.explainLine', (target?: { uri: string; line: number }) => hover.explainLine(target)),
    vscode.commands.registerCommand('bashExplainer.openSettings', () => vscode.commands.executeCommand('workbench.action.openSettings', `@ext:${ctx.extension.id}`)),
    vscode.commands.registerCommand('bashExplainer.openPanel', (target?: { uri: string; line: number }) => {
      // From the hover link: show the hovered line, which may differ from the cursor line.
      const editor = target && vscode.window.visibleTextEditors.find((e) => e.document.uri.toString() === target.uri);
      panel.open(editor ?? vscode.window.activeTextEditor, editor ? target.line : undefined);
    }),
    vscode.commands.registerCommand('bashExplainer.selectDisplayMode', async () => {
      const t = ui[service.lang];
      const features = Object.keys(t.features) as Feature[];
      const picked = await vscode.window.showQuickPick(
        features.map((f) => ({ label: t.features[f][0], detail: t.features[f][1], picked: service.enabled(f), feature: f })),
        { placeHolder: t.pickFeatures, canPickMany: true },
      );
      if (!picked) return;
      for (const f of features) {
        const on = picked.some((p) => p.feature === f);
        if (on !== service.enabled(f)) await service.config.update(ExplainService.FEATURES[f], on, vscode.ConfigurationTarget.Global);
      }
    }),
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (!e.affectsConfiguration('bashExplainer')) return;
      service.settingsChanged();
      if (e.affectsConfiguration('bashExplainer.languages')) { hover.register(); hints.register(); diagnostics.register(); }
      if (e.affectsConfiguration('bashExplainer.embedded.files')) vscode.workspace.textDocuments.forEach((d) => service.forget(d));
      if (e.affectsConfiguration('bashExplainer.panel.autoOpen')) panel.autoOpen();
      if (TOKEN_SETTINGS.some((k) => e.affectsConfiguration(`bashExplainer.${k}`))) semantic.refresh();
      panel.refresh();
      hints.refresh();
      diagnostics.refresh();
      updateStatus();
    }),
    vscode.window.onDidChangeActiveTextEditor(updateStatus),
    // A shell or yq chosen in the panel changes the explanations and the warnings, and a shell the colours.
    service.onDidChangeOverrides(() => {
      semantic.refresh();
      panel.refresh();
      hints.refresh();
      diagnostics.refresh();
    }),
    // A code block added to a Markdown file (or removed) changes whether it has shell code.
    vscode.workspace.onDidChangeTextDocument((e) => {
      if (e.document === vscode.window.activeTextEditor?.document) {
        clearTimeout(statusTimer);
        statusTimer = setTimeout(updateStatus, 300);
      }
    }),
    vscode.workspace.onDidCloseTextDocument((doc) => service.forget(doc)),
  );

  updateStatus();
  panel.autoOpen();
  void noticeInlineRemoved(ctx, service);
}

/** Tell a user who had the inline summary on that it was removed, once per session, until "Don't show again". */
async function noticeInlineRemoved(ctx: vscode.ExtensionContext, service: ExplainService): Promise<void> {
  if (!inlineNoticeDue(service.config.inspect('inline.enabled'), ctx.globalState.get(INLINE_NOTICE_KEY))) return;
  const t = inlineNotice(service.lang);
  const choice = await vscode.window.showInformationMessage(t.message, t.open, t.dismiss);
  if (choice === t.open) await vscode.commands.executeCommand('workbench.action.openSettings', 'bashExplainer.inline');
  else if (choice === t.dismiss) await ctx.globalState.update(INLINE_NOTICE_KEY, true);
}

export function deactivate(): void {}
