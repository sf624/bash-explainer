// The Language Server (`bash-explainer --lsp`), as an editor drives it: the built tool, spoken to
// over standard input and output, with network and process modules blocked.
import * as assert from 'assert';
import { ChildProcess, execFileSync, spawn } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const root = path.join(__dirname, '..');

interface Message { id?: number; method?: string; params?: any; result?: any; error?: any }

class Client {
  private proc: ChildProcess;
  private buffer = Buffer.alloc(0);
  private nextId = 1;
  private pending = new Map<number, (m: Message) => void>();
  readonly notifications: Message[] = [];
  readonly exited: Promise<number | null>;

  constructor(cli: string, preload: string) {
    this.proc = spawn(process.execPath, ['--require', preload, cli, '--lsp', '--stdio'], { env: { PATH: process.env.PATH, LANG: 'en_US.UTF-8' } });
    this.exited = new Promise((r) => this.proc.on('exit', r));
    this.proc.stdout!.on('data', (chunk: Buffer) => {
      this.buffer = Buffer.concat([this.buffer, chunk]);
      for (;;) {
        const end = this.buffer.indexOf('\r\n\r\n');
        if (end < 0) return;
        const length = Number(/Content-Length: (\d+)/.exec(this.buffer.subarray(0, end).toString())![1]);
        if (this.buffer.length < end + 4 + length) return;
        const m: Message = JSON.parse(this.buffer.subarray(end + 4, end + 4 + length).toString('utf8'));
        this.buffer = this.buffer.subarray(end + 4 + length);
        if (m.id !== undefined && this.pending.has(m.id)) this.pending.get(m.id)!(m);
        else this.notifications.push(m);
      }
    });
  }

  private write(m: Message): void {
    const json = JSON.stringify({ jsonrpc: '2.0', ...m });
    this.proc.stdin!.write(`Content-Length: ${Buffer.byteLength(json)}\r\n\r\n${json}`);
  }

  request(method: string, params: unknown): Promise<Message> {
    const id = this.nextId++;
    return new Promise((resolve) => {
      this.pending.set(id, resolve);
      this.write({ id, method, params });
    });
  }

  notify(method: string, params: unknown): void {
    this.write({ method, params });
  }

  async diagnostics(uri: string, ok: (d: any[]) => boolean): Promise<any[]> {
    const end = Date.now() + 10000;
    for (;;) {
      const last = [...this.notifications].reverse().find((n) => n.method === 'textDocument/publishDiagnostics' && n.params.uri === uri);
      if (last && ok(last.params.diagnostics)) return last.params.diagnostics;
      if (Date.now() > end) throw new Error(`no matching diagnostics for ${uri}: ${JSON.stringify(last?.params.diagnostics)}`);
      await new Promise((r) => setTimeout(r, 50));
    }
  }
}

describe('the Language Server', function () {
  this.timeout(60000);
  let dir = '';
  let client: Client;

  before(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bash-explainer-lsp-'));
    execFileSync(process.execPath, ['--import', 'tsx', 'scripts/build-cli.ts', `--outdir=${dir}`], { cwd: root, stdio: 'pipe' });
    const blocker = path.join(dir, 'block.js');
    fs.writeFileSync(blocker, `
      const Module = require('module');
      const load = Module._load;
      const blocked = ['http', 'https', 'http2', 'net', 'tls', 'dgram', 'dns', 'child_process', 'worker_threads', 'cluster'];
      Module._load = function (request, ...rest) {
        if (blocked.includes(request.replace(/^node:/, ''))) throw new Error('blocked: require(' + request + ')');
        return load.call(this, request, ...rest);
      };
      for (const name of ['fetch', 'XMLHttpRequest', 'WebSocket']) globalThis[name] = () => { throw new Error('blocked: ' + name); };
    `);
    client = new Client(path.join(dir, 'dist', 'cli.js'), blocker);
  });
  after(() => fs.rmSync(dir, { recursive: true, force: true }));

  const script = 'file:///work/install.sh';
  const dockerfile = 'file:///work/Dockerfile';

  it('starts and says what it can do', async () => {
    const r = await client.request('initialize', { processId: null, rootUri: null, capabilities: {} });
    assert.strictEqual(r.result.serverInfo.name, 'bash-explainer');
    assert.strictEqual(r.result.capabilities.hoverProvider, true);
    client.notify('initialized', {});
  });

  it('reports what a POSIX sh script uses that its shell lacks', async () => {
    client.notify('textDocument/didOpen', { textDocument: { uri: script, languageId: 'sh', version: 1, text: '#!/bin/sh\nif [[ -f "$1" ]]; then echo yes; fi\n' } });
    const d = await client.diagnostics(script, (list) => list.length > 0);
    assert.deepStrictEqual(d.map((x) => [x.code, x.source, x.range.start]), [['dbracket', 'Bash Explainer', { line: 1, character: 3 }]]);
  });

  it('explains a line on hover', async () => {
    const r = await client.request('textDocument/hover', { textDocument: { uri: script }, position: { line: 1, character: 5 } });
    assert.strictEqual(r.result.contents.kind, 'markdown');
    assert.match(r.result.contents.value, /^\*\*Bash Explainer · line 2\*\*/);
    assert.match(r.result.contents.value, /`-f "\$1"`/);
  });

  it('offers the quick fix', async () => {
    const r = await client.request('textDocument/codeAction', { textDocument: { uri: script }, range: { start: { line: 1, character: 0 }, end: { line: 1, character: 0 } }, context: { diagnostics: [] } });
    assert.strictEqual(r.result.length, 1);
    assert.deepStrictEqual(r.result[0].edit.changes[script].map((e: any) => e.newText), ['[ -f "$1" ]']);
  });

  it('updates the problems as the text changes', async () => {
    client.notify('textDocument/didChange', { textDocument: { uri: script, version: 2 }, contentChanges: [{ text: '#!/bin/sh\nif [ -f "$1" ]; then echo yes; fi\n' }] });
    await client.diagnostics(script, (list) => list.length === 0);
  });

  it('reads the shell code in a Dockerfile', async () => {
    client.notify('textDocument/didOpen', { textDocument: { uri: dockerfile, languageId: 'dockerfile', version: 1, text: 'FROM alpine\nRUN curl -s x | sh\n' } });
    const d = await client.diagnostics(dockerfile, (list) => list.length > 0);
    assert.ok(d.some((x) => x.code === 'dockerPipefail'), JSON.stringify(d));
    const r = await client.request('textDocument/hover', { textDocument: { uri: dockerfile }, position: { line: 1, character: 5 } });
    assert.match(r.result.contents.value, /curl/);
  });

  it('switches to Japanese when configured', async () => {
    client.notify('workspace/didChangeConfiguration', { settings: { bashExplainer: { language: 'ja' } } });
    const r = await client.request('textDocument/hover', { textDocument: { uri: script }, position: { line: 1, character: 5 } });
    assert.match(r.result.contents.value, /2 行目/);
  });

  it('answers unknown requests with an error, and shuts down cleanly', async () => {
    const r = await client.request('textDocument/definition', { textDocument: { uri: script }, position: { line: 0, character: 0 } });
    assert.strictEqual(r.error.code, -32601);
    await client.request('shutdown', null);
    client.notify('exit', null);
    assert.strictEqual(await client.exited, 0);
  });
});
