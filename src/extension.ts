import * as vscode from 'vscode';
import { createTreeSitterParser } from './syntax/adapters/tree-sitter';
import { TreeCache } from './syntax/cache';
import { ExplainService } from './service';
import { DiagnosticsController } from './ui/diagnostics';
import { HoverController } from './ui/hover';
import { InlineController } from './ui/inline';
import { PanelController } from './ui/panel';
import { Feature, ui } from './ui/render';

export async function activate(ctx: vscode.ExtensionContext): Promise<void> {
  // Read through VS Code, so that the same code works on the desktop and on the web (vscode.dev).
  const wasm = (name: string) => vscode.workspace.fs.readFile(vscode.Uri.joinPath(ctx.extensionUri, 'dist', name));
  const parser = await createTreeSitterParser({ runtime: await wasm('web-tree-sitter.wasm'), bash: await wasm('tree-sitter-bash.wasm') });
  const service = new ExplainService(new TreeCache(parser));
  const hover = new HoverController(service);
  const panel = new PanelController(ctx, service);
  const inline = new InlineController(service);
  const diagnostics = new DiagnosticsController(service);
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
    service, hover, panel, inline, diagnostics, status,
    vscode.commands.registerCommand('bashExplainer.showAtCursor', () => hover.showAtCursor()),
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
        if (on !== service.enabled(f)) await service.config.update(ExplainService.FEATURES[f][0], on, vscode.ConfigurationTarget.Global);
      }
    }),
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (!e.affectsConfiguration('bashExplainer')) return;
      if (e.affectsConfiguration('bashExplainer.languages')) hover.register();
      if (e.affectsConfiguration('bashExplainer.embedded.files')) vscode.workspace.textDocuments.forEach((d) => service.forget(d));
      if (e.affectsConfiguration('bashExplainer.panel.autoOpen')) panel.autoOpen();
      panel.refresh();
      inline.refresh();
      diagnostics.refresh();
      updateStatus();
    }),
    vscode.window.onDidChangeActiveTextEditor(updateStatus),
    // A shell or yq chosen in the panel changes the explanations and the warnings.
    service.onDidChangeOverrides(() => {
      panel.refresh();
      inline.refresh();
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
}

export function deactivate(): void {}
