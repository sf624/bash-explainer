import * as vscode from 'vscode';
import { createBashParser, TreeCache } from './parser';
import { ExplainService } from './service';
import { HoverController } from './ui/hover';
import { InlineController } from './ui/inline';
import { PanelController } from './ui/panel';
import { DisplayMode, ui } from './ui/render';

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
    status.text = `$(comment-discussion) ${t.modes[service.mode][0]}`;
    status.tooltip = t.statusTooltip;
    if (service.isTarget(vscode.window.activeTextEditor?.document)) status.show();
    else status.hide();
  };

  ctx.subscriptions.push(
    service, hover, panel, inline, status,
    vscode.commands.registerCommand('bashExplain.showAtCursor', () => hover.showAtCursor()),
    vscode.commands.registerCommand('bashExplain.openPanel', () => panel.open()),
    vscode.commands.registerCommand('bashExplain.selectDisplayMode', async () => {
      const t = ui[service.lang];
      const modes = Object.keys(t.modes) as DisplayMode[];
      const picked = await vscode.window.showQuickPick(
        modes.map((m) => ({ label: t.modes[m][0], description: m === service.mode ? '✓' : '', detail: t.modes[m][1], mode: m })),
        { placeHolder: t.pickMode },
      );
      if (picked) await service.config.update('displayMode', picked.mode, vscode.ConfigurationTarget.Global);
    }),
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (!e.affectsConfiguration('bashExplain')) return;
      if (e.affectsConfiguration('bashExplain.languages')) hover.register();
      if (e.affectsConfiguration('bashExplain.displayMode') || e.affectsConfiguration('bashExplain.language')) {
        panel.refresh();
      }
      inline.refresh();
      updateStatus();
    }),
    vscode.window.onDidChangeActiveTextEditor(updateStatus),
    vscode.workspace.onDidCloseTextDocument((doc) => service.forget(doc)),
  );

  updateStatus();
  panel.refresh();
}

export function deactivate(): void {}
