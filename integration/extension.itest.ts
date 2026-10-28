// The extension at work in a real VS Code: it starts on a shell script, explains lines on hover,
// warns with quick fixes, reads Dockerfiles and opens its panel, all without any network access
// or process of its own (see watch.ts). In CI on Linux the whole VS Code runs with no network.
import * as assert from 'assert';
import * as dns from 'dns';
import * as net from 'net';
import * as path from 'path';
import * as vscode from 'vscode';
import { themeRoleColours } from '../src/ui/themeColours';
import copied from '../src/ui/vscodeThemes.json';
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

  it('lists every warning and caveat of the explanations as a problem, with its level, range and code, and no plain fact', async () => {
    const doc = await vscode.workspace.openTextDocument({ language: 'shellscript', content: '#!/bin/bash\nf() {\n  local x=$(false)\n}\n[ -f a\nexit 300\n' });
    await open(doc);
    const mine = (d: vscode.Diagnostic[]) => d.filter((x) => x.source === 'Bash Explainer');
    const diagnostics = await until('the problems', () => mine(vscode.languages.getDiagnostics(doc.uri)), (d) => d.length >= 2);
    const at = (x: vscode.Diagnostic) => [x.code, x.severity, x.range.start.line, x.range.start.character, x.range.end.line, x.range.end.character];
    assert.deepStrictEqual(diagnostics.map(at), [
      ['declaration-masks-status', vscode.DiagnosticSeverity.Information, 2, 2, 2, 18],
      ['bracket-missing-close', vscode.DiagnosticSeverity.Warning, 4, 0, 4, 6],
    ]);
    // `diagnostics.ignore` leaves one out.
    await config().update('diagnostics.ignore', ['declaration-masks-status'], vscode.ConfigurationTarget.Global);
    try {
      await until('one problem left', () => mine(vscode.languages.getDiagnostics(doc.uri)), (d) => d.length === 1 && d[0].code === 'bracket-missing-close');
    } finally {
      await config().update('diagnostics.ignore', undefined, vscode.ConfigurationTarget.Global);
    }
    await vscode.commands.executeCommand('workbench.action.closeAllEditors');
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

  it('explains the part at the position, for its range, and offers the whole line', async () => {
    const { document: doc } = await open(fixture('sample.sh'));
    const at = lineWith(doc, 'grep -rn');
    const hoverAt = (col: number) => until('a hover', () => vscode.commands.executeCommand<vscode.Hover[]>('vscode.executeHoverProvider', doc.uri, new vscode.Position(at.line, col)), (h) => !!h?.length);
    // `-rn`, then its letter `r`: each hover's range is its part.
    const hovers = await hoverAt(at.col + 5);
    const range = hovers[0].range!;
    assert.deepStrictEqual([range.start.character, range.end.character], [at.col + 5, at.col + 8]);
    const r = (await hoverAt(at.col + 6))[0].range!;
    assert.deepStrictEqual([r.start.character, r.end.character], [at.col + 6, at.col + 7]);
    assert.match((hovers[0].contents[0] as vscode.MarkdownString).value, /Whole line/);
    // In the indentation: the line card, with the link to the whole line.
    const indented = [...Array(doc.lineCount).keys()].find((l) => /^\s+\S/.test(doc.lineAt(l).text))!;
    assert.match(await hoverText(doc, indented, 0), /Whole line\]\(command:bashExplainer\.explainLine/);
    assert.ok((await vscode.commands.getCommands(true)).includes('bashExplainer.explainLine'));
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

  it("reads the theme's colours for the panel, also where the theme extensions are in another extension host (a remote window)", async () => {
    const ctx = { extension: extension() } as unknown as vscode.ExtensionContext;
    const wb = vscode.workspace.getConfiguration('workbench');
    const win = vscode.workspace.getConfiguration('window');
    // `activeColorTheme` follows the setting some time after `update` returns, and its kind can lag by more than one
    // change (CI: the high contrast kind arrived only after Monokai was set). With `autoDetectHighContrast`,
    // `activeThemeName` reads the preferred high contrast theme while the kind is high contrast: off here, it reads
    // the setting, which `update` has written when it returns. (No wait for the kind: VS Code 1.85 here never
    // changes it.)
    const setTheme = (theme: string | undefined) => wb.update('colorTheme', theme, vscode.ConfigurationTarget.Global);
    await win.update('autoDetectHighContrast', false, vscode.ConfigurationTarget.Global);
    try {
      // The default theme, and other default ones (named alike in VS Code 1.85): here from their extension, and with no extension from our copy.
      for (const theme of [undefined, 'Visual Studio Light', 'Default High Contrast']) {
        await setTheme(theme);
        const here = await themeRoleColours(ctx, true);
        const remote = await themeRoleColours(ctx, true, []);
        assert.ok(here && typeof here === 'object' && here.string, `${theme}: ${JSON.stringify(here)}`);
        assert.ok(remote && typeof remote === 'object' && remote.string, `${theme} (remote): ${JSON.stringify(remote)}`);
        // (Another VS Code may have changed its themes since the copy.)
        if (vscode.version === copied.vscode) assert.deepStrictEqual(remote, here, theme);
      }
      // Another theme VS Code ships: here only. Its name otherwise, for the panel's notice.
      await setTheme('Monokai');
      assert.strictEqual(typeof (await themeRoleColours(ctx, true)), 'object');
      assert.strictEqual(await themeRoleColours(ctx, true, []), 'Monokai');
    } finally {
      await wb.update('colorTheme', undefined, vscode.ConfigurationTarget.Global);
      await win.update('autoDetectHighContrast', undefined, vscode.ConfigurationTarget.Global);
    }
  });

  it('colours shell code with semantic tokens by default, and stops where highlight.enabled is off, also for one language', async () => {
    const tokens = (uri: vscode.Uri) => vscode.commands.executeCommand<vscode.SemanticTokens | undefined>('vscode.provideDocumentSemanticTokens', uri);
    const { document: script } = await open(fixture('sample.sh'));
    const docker = await vscode.workspace.openTextDocument(fixture('hosts', 'Dockerfile'));
    const make = await vscode.workspace.openTextDocument(fixture('hosts', 'Makefile'));
    const legend = await until('the legend', () => vscode.commands.executeCommand<vscode.SemanticTokensLegend | undefined>('vscode.provideDocumentSemanticTokensLegend', script.uri), Boolean);
    assert.ok(legend!.tokenTypes.includes('keyword'));
    const data = (await until('tokens', () => tokens(script.uri), (t) => !!t && t.data.length > 0))!.data;
    // The first token is the shebang, our own type (a comment to a theme with no rule for it: package.json's superType).
    assert.deepStrictEqual([...data.slice(0, 2)], [0, 0]);
    assert.strictEqual(legend!.tokenTypes[data[3]], 'shebang');
    // A Makefile has tokens on its recipe lines only.
    const mdata = (await until('Makefile tokens', () => tokens(make.uri), (t) => !!t && t.data.length > 0))!.data;
    assert.match(make.lineAt(mdata[0]).text, /^\t/);
    // A Dockerfile is left to its own language server: no tokens of ours.
    assert.strictEqual((await tokens(docker.uri))?.data.length ?? 0, 0);
    // Off for Makefiles only, as `"[makefile]": { "bashExplainer.highlight.enabled": false }` says.
    const makeConfig = vscode.workspace.getConfiguration('bashExplainer', { languageId: 'makefile' });
    await makeConfig.update('highlight.enabled', false, vscode.ConfigurationTarget.Global, true);
    try {
      await until('no Makefile tokens', () => tokens(make.uri), (t) => (t?.data.length ?? 0) === 0);
      assert.ok(((await tokens(script.uri))?.data.length ?? 0) > 0);
    } finally {
      await makeConfig.update('highlight.enabled', undefined, vscode.ConfigurationTarget.Global, true);
    }
    // The shell decides what a name runs: `shopt` is a builtin of bash (defaultLibrary), a program in sh.
    const shopt = await vscode.workspace.openTextDocument({ language: 'shellscript', content: '#!/bin/bash\nshopt -s extglob\n' });
    const shoptModifiers = async () => {
      const t = await tokens(shopt.uri);
      // (The first token on line 1: the second one, after the shebang's comment.)
      return t && t.data.length >= 10 ? t.data[9] : undefined;
    };
    const builtin = 1 << legend!.tokenModifiers.indexOf('defaultLibrary');
    assert.strictEqual(await until('shopt as a builtin', shoptModifiers, (m) => m !== undefined), builtin);
    await config().update('shell', 'sh', vscode.ConfigurationTarget.Global);
    try {
      await until('shopt as a program in sh', shoptModifiers, (m) => m === 0);
    } finally {
      await config().update('shell', undefined, vscode.ConfigurationTarget.Global);
    }
    // Off everywhere.
    await config().update('highlight.enabled', false, vscode.ConfigurationTarget.Global);
    try {
      await until('no tokens', () => tokens(script.uri), (t) => (t?.data.length ?? 0) === 0);
    } finally {
      await config().update('highlight.enabled', undefined, vscode.ConfigurationTarget.Global);
    }
    await vscode.commands.executeCommand('workbench.action.closeAllEditors');
  });

  it('shows the whole line at the cursor', async () => {
    const editor = await open(fixture('sample.sh'));
    for (let line = 0; line < 8; line++) {
      editor.selection = new vscode.Selection(line, 0, line, 0);
      await sleep(100);
    }
    await vscode.commands.executeCommand('bashExplainer.showAtCursor');
    await sleep(500);
    await vscode.commands.executeCommand('workbench.action.closeAllEditors');
  });

  it('gives a hint after a command name that does not run what it suggests, unless hints.names is off', async () => {
    const doc = await vscode.workspace.openTextDocument({ language: 'shellscript', content: 'cd() { builtin cd "$@"; }\ncd /tmp\n' });
    await open(doc);
    const hints = () => vscode.commands.executeCommand<vscode.InlayHint[]>('vscode.executeInlayHintProvider', doc.uri, new vscode.Range(0, 0, 2, 0));
    const got = await until('a name hint', hints, (h) => (h ?? []).length > 0);
    const label = got[0].label as vscode.InlayHintLabelPart[];
    assert.deepStrictEqual([got[0].position.line, got[0].position.character, label[0].value], [1, 2, 'function, not the builtin']);
    assert.strictEqual(label[0].command?.command, 'bashExplainer.openPanel');
    await config().update('hints.names', false, vscode.ConfigurationTarget.Global);
    try {
      await until('no name hint', hints, (h) => (h ?? []).length === 0);
    } finally {
      await config().update('hints.names', undefined, vscode.ConfigurationTarget.Global);
    }
    await vscode.commands.executeCommand('workbench.action.closeAllEditors');
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
