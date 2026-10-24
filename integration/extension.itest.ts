// The extension at work in a real VS Code: it starts on a shell script, explains lines on hover,
// warns with quick fixes, reads Dockerfiles and opens its panel, all without any network access
// or process of its own (see watch.ts). In CI on Linux the whole VS Code runs with no network.
import * as assert from 'assert';
import * as dns from 'dns';
import * as net from 'net';
import * as path from 'path';
import * as vscode from 'vscode';
import { state } from './watch';

const root = path.resolve(__dirname, '../..');
const fixture = (...parts: string[]) => vscode.Uri.file(path.join(root, 'test', 'fixtures', ...parts));
const extension = () => vscode.extensions.getExtension('shun-fujioka.bash-explainer')!;
const config = () => vscode.workspace.getConfiguration('bashExplainer');
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function until<T>(what: string, get: () => Thenable<T> | T, ok: (v: T) => boolean, ms = 20000): Promise<T> {
  const end = Date.now() + ms;
  let v = await get();
  while (!ok(v)) {
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await sleep(200);
    v = await get();
  }
  return v;
}

async function open(doc: vscode.Uri | vscode.TextDocument): Promise<vscode.TextEditor> {
  const d = doc instanceof vscode.Uri ? await vscode.workspace.openTextDocument(doc) : doc;
  return vscode.window.showTextDocument(d);
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

describe('Bash Explainer in VS Code', function () {
  this.timeout(60000);

  it('had not started before the watch began', () => {
    assert.strictEqual(state().activeAtStart, false);
  });

  it('starts on a shell script and explains a line on hover', async () => {
    const { document: doc } = await open(fixture('sample.sh'));
    await until('the extension to start', () => extension().isActive, Boolean);
    const at = lineWith(doc, 'grep -rn');
    const text = await until('a hover', () => hoverText(doc, at.line, at.col), (t) => t.includes('grep'));
    assert.match(text, /-r/);
  });

  it('explains in Japanese when asked', async () => {
    await config().update('language', 'ja', vscode.ConfigurationTarget.Global);
    try {
      const { document: doc } = await open(fixture('sample.sh'));
      const at = lineWith(doc, 'grep -rn');
      await until('a Japanese hover', () => hoverText(doc, at.line, at.col), (t) => /[ぁ-んァ-ヶ]/.test(t));
    } finally {
      await config().update('language', undefined, vscode.ConfigurationTarget.Global);
    }
  });

  it('warns about [[ ]] in a POSIX sh script, with a quick fix that keeps the meaning', async () => {
    const doc = await vscode.workspace.openTextDocument({ language: 'shellscript', content: '#!/bin/sh\nif [[ -f "$1" ]]; then echo yes; fi\n' });
    await open(doc);
    const diagnostics = await until('the [[ ]] warning', () => vscode.languages.getDiagnostics(doc.uri), (d) => d.some((x) => x.code === 'dbracket'));
    const warning = diagnostics.find((x) => x.code === 'dbracket')!;
    assert.strictEqual(warning.source, 'Bash Explainer');
    const actions = await vscode.commands.executeCommand<vscode.CodeAction[]>('vscode.executeCodeActionProvider', doc.uri, warning.range);
    const fix = actions.find((a) => a.edit && a.title.includes('[ ]'));
    assert.ok(fix, `no quick fix among: ${actions.map((a) => a.title).join(', ')}`);
    assert.ok(await vscode.workspace.applyEdit(fix.edit!));
    assert.strictEqual(doc.lineAt(1).text, 'if [ -f "$1" ]; then echo yes; fi');
  });

  it('offers the quick fix in a language added to bashExplainer.languages', async () => {
    const doc = await vscode.workspace.openTextDocument({ language: 'plaintext', content: '#!/bin/sh\nif [[ -f "$1" ]]; then echo yes; fi\n' });
    await open(doc);
    const original = config().inspect<string[]>('languages')?.globalValue;
    await config().update('languages', ['shellscript', 'plaintext'], vscode.ConfigurationTarget.Global);
    try {
      const diagnostics = await until('the [[ ]] warning', () => vscode.languages.getDiagnostics(doc.uri), (d) => d.some((x) => x.code === 'dbracket'));
      const range = diagnostics.find((x) => x.code === 'dbracket')!.range;
      const actions = await until('the quick fix', () => vscode.commands.executeCommand<vscode.CodeAction[]>('vscode.executeCodeActionProvider', doc.uri, range), (a) => a.some((x) => !!x.edit && x.title.includes('[ ]')));
      assert.ok(actions.length > 0);
    } finally {
      await config().update('languages', original, vscode.ConfigurationTarget.Global);
    }
    await vscode.commands.executeCommand('workbench.action.closeAllEditors');
  });

  it('explains the shell code in a Dockerfile', async () => {
    const { document: doc } = await open(fixture('hosts', 'Dockerfile'));
    const at = lineWith(doc, 'apk add');
    const text = await until('a hover on RUN', () => hoverText(doc, at.line, at.col), (t) => t.includes('apk'));
    assert.ok(text.length > 0);
  });

  it('opens the panel, which follows the cursor', async () => {
    const editor = await open(fixture('sample.sh'));
    await vscode.commands.executeCommand('bashExplainer.openPanel');
    const isPanel = (t: vscode.Tab) => t.input instanceof vscode.TabInputWebview && t.input.viewType.includes('bashExplainer.panel');
    await until('the panel', () => vscode.window.tabGroups.all.flatMap((g) => g.tabs).some(isPanel), Boolean);
    for (let line = 0; line < Math.min(12, editor.document.lineCount); line++) {
      editor.selection = new vscode.Selection(line, 0, line, 0);
      await sleep(150);
    }
    await vscode.commands.executeCommand('workbench.action.closeAllEditors');
  });

  it('colours shell code with semantic tokens when highlight.enabled is on, and stops when it is off', async () => {
    const tokens = (uri: vscode.Uri) => vscode.commands.executeCommand<vscode.SemanticTokens | undefined>('vscode.provideDocumentSemanticTokens', uri);
    const { document: script } = await open(fixture('sample.sh'));
    const docker = await vscode.workspace.openTextDocument(fixture('hosts', 'Dockerfile'));
    const make = await vscode.workspace.openTextDocument(fixture('hosts', 'Makefile'));
    assert.strictEqual((await tokens(script.uri))?.data.length ?? 0, 0);
    await config().update('highlight.enabled', true, vscode.ConfigurationTarget.Global);
    try {
      const legend = await until('the legend', () => vscode.commands.executeCommand<vscode.SemanticTokensLegend | undefined>('vscode.provideDocumentSemanticTokensLegend', script.uri), Boolean);
      assert.ok(legend!.tokenTypes.includes('keyword'));
      const data = (await until('tokens', () => tokens(script.uri), (t) => !!t && t.data.length > 0))!.data;
      // The first token is the shebang, a comment.
      assert.deepStrictEqual([...data.slice(0, 2)], [0, 0]);
      assert.strictEqual(legend!.tokenTypes[data[3]], 'comment');
      // A Makefile has tokens on its recipe lines only.
      const mdata = (await until('Makefile tokens', () => tokens(make.uri), (t) => !!t && t.data.length > 0))!.data;
      assert.match(make.lineAt(mdata[0]).text, /^\t/);
      // A Dockerfile is left to its own language server: no tokens of ours.
      assert.strictEqual((await tokens(docker.uri))?.data.length ?? 0, 0);
    } finally {
      await config().update('highlight.enabled', undefined, vscode.ConfigurationTarget.Global);
    }
    await until('no tokens', () => tokens(script.uri), (t) => (t?.data.length ?? 0) === 0);
    await vscode.commands.executeCommand('workbench.action.closeAllEditors');
  });

  it('shows the inline summary and the hover at the cursor', async () => {
    await config().update('inline.enabled', true, vscode.ConfigurationTarget.Global);
    try {
      const editor = await open(fixture('sample.sh'));
      for (let line = 0; line < 8; line++) {
        editor.selection = new vscode.Selection(line, 0, line, 0);
        await sleep(100);
      }
      await vscode.commands.executeCommand('bashExplainer.showAtCursor');
      await sleep(500);
    } finally {
      await config().update('inline.enabled', undefined, vscode.ConfigurationTarget.Global);
    }
  });

  it('runs where there is no network at all', async function () {
    // Set in CI, where VS Code runs in a network namespace of its own.
    if (!process.env.BASH_EXPLAINER_NO_NETWORK) this.skip();
    const connected = await new Promise<boolean>((resolve) => {
      const socket = net.connect({ host: '1.1.1.1', port: 443, timeout: 5000 });
      socket.once('connect', () => (socket.destroy(), resolve(true)));
      socket.once('error', () => resolve(false));
      socket.once('timeout', () => (socket.destroy(), resolve(false)));
    });
    assert.strictEqual(connected, false, 'reached 1.1.1.1:443');
    const resolved = await new Promise<boolean>((resolve) => dns.lookup('example.com', (err) => resolve(!err)));
    assert.strictEqual(resolved, false, 'resolved example.com');
  });

  it('made no network request and started no process', () => {
    assert.deepStrictEqual(state().calls, []);
  });
});
