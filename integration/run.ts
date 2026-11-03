// Runs the integration tests: the production build of the extension in a real VS Code.
// Usage: node --import tsx integration/run.ts [--version=stable|1.85.0] [--download-only] [--executable=<path>]
//   --download-only  download VS Code (into .vscode-test/) and print the executable's path
//   --executable     use that VS Code, without looking anything up online (for runs with no network)
import { downloadAndUnzipVSCode, runTests } from '@vscode/test-electron';
import { execFileSync } from 'child_process';
import * as esbuild from 'esbuild';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const root = path.join(__dirname, '..');
const option = (name: string) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);

/**
 * Reads the panel's page in the VS Code that runs the tests. The extension test API cannot read a webview, so VS Code
 * is started with a port for a browser tool (`--remote-debugging-port=0` writes it to `DevToolsActivePort` in the
 * user data directory), and this asks each page of the webview's origin how many rows the explanation has drawn.
 * The result goes to `panel-check.txt` in that directory, for the suite to assert.
 */
async function checkPanel(userData: string, stop: { done: boolean }): Promise<void> {
  const result = (text: string) => fs.writeFileSync(path.join(userData, 'panel-check.txt'), text);
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  // (The rows of the first document that has any, looking into the frames of the webview's host.)
  const expression = `(() => { const docs = [document]; for (const d of docs) for (const f of d.querySelectorAll('iframe')) { try { if (f.contentDocument) docs.push(f.contentDocument); } catch {} }
    for (const d of docs) { const n = d.querySelectorAll('#tree .row').length; if (n) return JSON.stringify({ rows: n, where: d.getElementById('where')?.textContent ?? '' }); } return JSON.stringify({ rows: 0, where: '' }); })()`;
  /** Evaluates `expression` in the target through its WebSocket. */
  const evaluate = (url: string) => new Promise<string>((resolve, reject) => {
    // (Node.js 22 and later have WebSocket; the types here do not know it.)
    const ws = new (globalThis as unknown as { WebSocket: new (url: string) => any }).WebSocket(url);
    ws.onopen = () => ws.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: { expression, returnByValue: true } }));
    ws.onmessage = (e: { data: unknown }) => {
      const m = JSON.parse(String(e.data));
      if (m.id !== 1) return;
      ws.close();
      resolve(m.result?.result?.value ?? `{"error":${JSON.stringify(JSON.stringify(m).slice(0, 300))}}`);
    };
    ws.onerror = () => reject(new Error('no answer'));
  });
  try {
    const portFile = path.join(userData, 'DevToolsActivePort');
    while (!fs.existsSync(portFile) || !fs.readFileSync(portFile, 'utf8').includes('\n')) {
      if (stop.done) return;
      await sleep(200);
    }
    const port = fs.readFileSync(portFile, 'utf8').split('\n')[0];
    let seen = '{"rows":0,"where":""}';
    let targets = '';
    for (const end = Date.now() + 90000; Date.now() < end && !stop.done; await sleep(500)) {
      const list = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()) as { type: string; url: string; webSocketDebuggerUrl?: string }[];
      targets = list.map((t) => `${t.type} ${t.url.slice(0, 40)}`).join('; ');
      for (const t of list.filter((t) => t.webSocketDebuggerUrl && t.url.startsWith('vscode-webview:'))) {
        const got = await evaluate(t.webSocketDebuggerUrl!).catch(() => '');
        targets += ` => ${got.slice(0, 120)}`;
        if (got && (JSON.parse(got) as { rows?: number }).rows) seen = got;
      }
      if ((JSON.parse(seen) as { rows: number }).rows > 0) break;
    }
    const drew = JSON.parse(seen) as { rows: number; where: string };
    result(drew.rows > 0 && drew.where ? 'ok' : `the panel drew no rows: ${seen}; targets: ${targets}`);
  } catch (e) {
    result(`the check failed: ${e instanceof Error ? e.message : e}`);
  }
}

async function main(): Promise<void> {
  let executable = option('executable');
  if (executable === '') throw new Error('--executable is empty: VS Code was not downloaded');
  if (!executable) executable = await downloadAndUnzipVSCode({ version: option('version') ?? 'stable', cachePath: path.join(root, '.vscode-test') });
  if (process.argv.includes('--download-only')) {
    console.log(executable);
    return;
  }

  // What is published: the production bundle.
  execFileSync(process.execPath, ['esbuild.mjs', '--production'], { cwd: root, stdio: 'inherit' });
  const out = path.join(root, 'out', 'integration');
  await esbuild.build({
    entryPoints: [path.join(__dirname, 'suite.ts'), path.join(__dirname, 'extension.itest.ts')],
    outdir: out,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node18',
    external: ['vscode', 'mocha'],
    logLevel: 'warning',
  });

  // Run from inside VS Code (its terminal, an extension), this makes the test VS Code start as plain Node.js.
  delete process.env.ELECTRON_RUN_AS_NODE;
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'bash-explainer-vscode-'));
  const stop = { done: false };
  const check = checkPanel(userData, stop);
  try {
    await runTests({
      vscodeExecutablePath: executable,
      extensionDevelopmentPath: root,
      extensionTestsPath: path.join(out, 'suite.js'),
      extensionTestsEnv: { BASH_EXPLAINER_NO_NETWORK: process.env.BASH_EXPLAINER_NO_NETWORK ?? '', BASH_EXPLAINER_PANEL_CHECK: userData },
      launchArgs: [
        path.join(root, 'test', 'fixtures'),
        `--user-data-dir=${userData}`,
        '--disable-extensions',
        '--disable-workspace-trust',
        '--skip-welcome',
        '--skip-release-notes',
        '--disable-gpu',
        '--remote-debugging-port=0',
      ],
    });
  } finally {
    stop.done = true;
    await check;
    fs.rmSync(userData, { recursive: true, force: true });
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
