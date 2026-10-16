import * as vscode from 'vscode';
import { createBashParser, TreeCache } from './parser';
import { ExplainService } from './service';
import { HoverController } from './ui/hover';
import { InlineController } from './ui/inline';
import { PanelController } from './ui/panel';
import { Feature, ui } from './ui/render';

export async function activate(ctx: vscode.ExtensionContext): Promise<void> {
  const parser = await createBashParser({
    runtimeDir: ctx.asAbsolutePath('dist'),
    bashWasm: ctx.asAbsolutePath('dist/tree-sitter-bash.wasm'),
  });
  const service = new ExplainService(new TreeCache(parser));
  const hover = new HoverController(service);
  const panel = new PanelController(ctx, service);
  const inline = new InlineController(service);
  const status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  status.command = 'bashExplain.selectDisplayMode';

  const updateStatus = () => {
    const t = ui[service.lang];
    const on = (Object.keys(t.features) as Feature[]).filter((f) => service.enabled(f));
    status.text = `$(comment-discussion) ${on.map((f) => t.short[f]).join(' + ') || t.off}`;
    status.tooltip = t.statusTooltip;
    const doc = vscode.window.activeTextEditor?.document;
    if (service.isTarget(doc) && service.hasShell(doc)) status.show();
    else status.hide();
  };

  ctx.subscriptions.push(
    service, hover, panel, inline, status,
    vscode.commands.registerCommand('bashExplain.showAtCursor', () => hover.showAtCursor()),
    vscode.commands.registerCommand('bashExplain.openSettings', () => vscode.commands.executeCommand('workbench.action.openSettings', `@ext:${ctx.extension.id}`)),
    vscode.commands.registerCommand('bashExplain.openPanel', (target?: { uri: string; line: number }) => {
      // From the hover link: show the hovered line, which may differ from the cursor line.
      const editor = target && vscode.window.visibleTextEditors.find((e) => e.document.uri.toString() === target.uri);
      panel.open(editor ?? vscode.window.activeTextEditor, editor ? target.line : undefined);
    }),
    vscode.commands.registerCommand('bashExplain.selectDisplayMode', async () => {
      const t = ui[service.lang];
      const features = Object.keys(t.features) as Feature[];
      const picked = await vscode.window.showQuickPick(
        features.map((f) => ({ label: t.features[f][0], detail: t.features[f][1], picked: service.enabled(f), feature: f })),
        { placeHolder: t.pickFeatures, canPickMany: true },
      );
      if (!picked) return;
      for (const f of features) {
        const on = picked.some((p) => p.feature === f);
        if (on !== service.enabled(f)) await service.config.update(ExplainService.FEATURES[f][0], on, vscode.ConfigurationTarget.Global);
      }
    }),
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (!e.affectsConfiguration('bashExplain')) return;
      if (e.affectsConfiguration('bashExplain.languages')) hover.register();
      if (e.affectsConfiguration('bashExplain.embedded.enabled')) vscode.workspace.textDocuments.forEach((d) => service.forget(d));
      if (e.affectsConfiguration('bashExplain.panel.autoOpen')) panel.autoOpen();
      panel.refresh();
      inline.refresh();
      updateStatus();
    }),
    vscode.window.onDidChangeActiveTextEditor(updateStatus),
    vscode.workspace.onDidCloseTextDocument((doc) => service.forget(doc)),
  );

  updateStatus();
  panel.autoOpen();
}

export function deactivate(): void {}
