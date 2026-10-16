// The extension in VS Code for the Web (as on vscode.dev and github.dev): it starts in the
// browser's extension host, reads the wasm files through VS Code, explains on hover and warns.
import * as vscode from 'vscode';

const extension = () => vscode.extensions.getExtension('shun-fujioka.bash-explainer')!;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function check(ok: unknown, message: string): asserts ok {
  if (!ok) throw new Error(message);
}

async function until<T>(what: string, get: () => Thenable<T> | T, ok: (v: T) => boolean, ms = 30000): Promise<T> {
  const end = Date.now() + ms;
  let v = await get();
  while (!ok(v)) {
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await sleep(200);
    v = await get();
  }
  return v;
}

async function hoverText(doc: vscode.TextDocument, line: number, col: number): Promise<string> {
  const hovers = await vscode.commands.executeCommand<vscode.Hover[]>('vscode.executeHoverProvider', doc.uri, new vscode.Position(line, col));
  return (hovers ?? []).flatMap((h) => h.contents.map((c) => (typeof c === 'string' ? c : 'value' in c ? c.value : ''))).join('\n');
}

function lineWith(doc: vscode.TextDocument, text: string): { line: number; col: number } {
  for (let line = 0; line < doc.lineCount; line++) {
    const col = doc.lineAt(line).text.indexOf(text);
    if (col >= 0) return { line, col };
  }
  throw new Error(`no line with ${text}`);
}

/** A file of the folder the test opened (test/fixtures), served by VS Code for the Web. */
function fixture(...parts: string[]): vscode.Uri {
  const folder = vscode.workspace.workspaceFolders?.[0];
  check(folder, 'no workspace folder');
  return vscode.Uri.joinPath(folder.uri, ...parts);
}

describe('Bash Explainer in VS Code for the Web', function () {
  it('starts on a shell script and explains a line on hover', async () => {
    const doc = await vscode.workspace.openTextDocument(fixture('sample.sh'));
    await vscode.window.showTextDocument(doc);
    await until('the extension to start', () => extension().isActive, Boolean);
    const at = lineWith(doc, 'grep -rn');
    const text = await until('a hover', () => hoverText(doc, at.line, at.col), (t) => t.includes('grep'));
    check(/-r/.test(text), `unexpected hover: ${text.slice(0, 200)}`);
  });

  it('warns about [[ ]] in a POSIX sh script, with a quick fix', async () => {
    const doc = await vscode.workspace.openTextDocument({ language: 'shellscript', content: '#!/bin/sh\nif [[ -f "$1" ]]; then echo yes; fi\n' });
    await vscode.window.showTextDocument(doc);
    const diagnostics = await until('the [[ ]] warning', () => vscode.languages.getDiagnostics(doc.uri), (d) => d.some((x) => x.code === 'dbracket'));
    const warning = diagnostics.find((x) => x.code === 'dbracket')!;
    const actions = await vscode.commands.executeCommand<vscode.CodeAction[]>('vscode.executeCodeActionProvider', doc.uri, warning.range);
    const fix = actions.find((a) => a.edit && a.title.includes('[ ]'));
    check(fix, `no quick fix among: ${actions.map((a) => a.title).join(', ')}`);
    check(await vscode.workspace.applyEdit(fix.edit!), 'the quick fix did not apply');
    check(doc.lineAt(1).text === 'if [ -f "$1" ]; then echo yes; fi', `after the fix: ${doc.lineAt(1).text}`);
  });

  it('explains the shell code in a Dockerfile', async () => {
    const doc = await vscode.workspace.openTextDocument(fixture('hosts', 'Dockerfile'));
    await vscode.window.showTextDocument(doc);
    const at = lineWith(doc, 'apk add');
    await until('a hover on RUN', () => hoverText(doc, at.line, at.col), (t) => t.includes('apk'));
  });

  it('opens the panel', async () => {
    await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(fixture('sample.sh')));
    await vscode.commands.executeCommand('bashExplainer.openPanel');
    const isPanel = (t: vscode.Tab) => t.input instanceof vscode.TabInputWebview && t.input.viewType.includes('bashExplainer.panel');
    await until('the panel', () => vscode.window.tabGroups.all.flatMap((g) => g.tabs).some(isPanel), Boolean);
  });
});
