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

  constructor(cli: string, preload: string, opts: { env?: NodeJS.ProcessEnv; args?: string[] } = {}) {
    this.proc = spawn(process.execPath, ['--require', preload, cli, '--lsp', '--stdio', ...(opts.args ?? [])], { env: { PATH: process.env.PATH, LANG: 'en_US.UTF-8', ...opts.env } });
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
  let cli = '';
  let blocker = '';

  before(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bash-explainer-lsp-'));
    execFileSync(process.execPath, ['--import', 'tsx', 'scripts/build-cli.ts', `--outdir=${dir}`], { cwd: root, stdio: 'pipe' });
    blocker = path.join(dir, 'block.js');
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
    cli = path.join(dir, 'dist', 'cli.js');
    client = new Client(cli, blocker);
  });
  after(() => fs.rmSync(dir, { recursive: true, force: true }));

  const script = 'file:///work/install.sh';
  const dockerfile = 'file:///work/Dockerfile';

  it('starts and says what it can do', async () => {
    const r = await client.request('initialize', { processId: null, rootUri: null, capabilities: {} });
    assert.strictEqual(r.result.serverInfo.name, 'bash-explainer');
    assert.strictEqual(r.result.capabilities.hoverProvider, true);
    assert.strictEqual(r.result.capabilities.inlayHintProvider, true);
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
    // The part at the position first (`[[ … ]]`, with the parts around it), then the whole line below a rule.
    const [part, whole] = r.result.contents.value.split('\n---\n');
    assert.match(part, /^`if` \*condition\* `then`.* ›\n\n\*\*`\[\[ -f "\$1" \]\]`\*\*\n\nExtended test/);
    assert.deepStrictEqual(r.result.range, { start: { line: 1, character: 3 }, end: { line: 1, character: 16 } });
    assert.match(whole, /^\n\*\*Bash Explainer · line 2\*\*/);
    assert.match(whole, /`-f "\$1"`/);
    // The word just before the position: `then`; past the end of the line, the whole line alone.
    const then = await client.request('textDocument/hover', { textDocument: { uri: script }, position: { line: 1, character: 21 } });
    assert.match(then.result.contents.value, /^\*\*`then`\*\*/m);
    const end = await client.request('textDocument/hover', { textDocument: { uri: script }, position: { line: 1, character: 60 } });
    assert.match(end.result.contents.value, /^\*\*Bash Explainer · line 2\*\*/);
    assert.deepStrictEqual(end.result.range, { start: { line: 1, character: 0 }, end: { line: 1, character: 35 } });
    // Each row ends with the sections of the manual it is about, linked.
    assert.ok(r.result.contents.value.includes('(Bash manual [3.2.5.2](https://www.gnu.org/software/bash/manual/html_node/Conditional-Constructs.html "Conditional Constructs")'), r.result.contents.value);
  });

  it('gives a hint after a command name that does not run what it suggests', async () => {
    const uri = 'file:///work/hints.sh';
    client.notify('textDocument/didOpen', { textDocument: { uri, languageId: 'sh', version: 1, text: 'cd() { builtin cd "$@"; }\n\ncd /tmp\nsudo cd /\n' } });
    const r = await client.request('textDocument/inlayHint', { textDocument: { uri }, range: { start: { line: 0, character: 0 }, end: { line: 9, character: 0 } } });
    assert.deepStrictEqual(r.result.map((h: any) => [h.position, h.label]), [
      [{ line: 2, character: 2 }, 'function, not the builtin'],
      [{ line: 3, character: 7 }, 'program, run by sudo: usually there is none'],
    ]);
    assert.strictEqual(r.result[0].tooltip.kind, 'markdown');
    assert.match(r.result[0].tooltip.value, /^`cd` \*\*function\*\*\n\nSame name, also: /);
    // Only the lines asked for; none for a document it does not know.
    const one = await client.request('textDocument/inlayHint', { textDocument: { uri }, range: { start: { line: 3, character: 0 }, end: { line: 3, character: 9 } } });
    assert.strictEqual(one.result.length, 1);
    assert.deepStrictEqual((await client.request('textDocument/inlayHint', { textDocument: { uri: 'file:///work/none.sh' }, range: { start: { line: 0, character: 0 }, end: { line: 1, character: 0 } } })).result, []);
    // hints.names off: none.
    client.notify('workspace/didChangeConfiguration', { settings: { bashExplainer: { hints: { names: false } } } });
    assert.deepStrictEqual((await client.request('textDocument/inlayHint', { textDocument: { uri }, range: { start: { line: 0, character: 0 }, end: { line: 9, character: 0 } } })).result, []);
    client.notify('workspace/didChangeConfiguration', { settings: { bashExplainer: { hints: { names: true } } } });
    client.notify('textDocument/didClose', { textDocument: { uri } });
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

  it('reports the pitfalls, a warning for one that breaks the script and information for the others', async () => {
    const uri = 'file:///work/pitfalls.sh';
    client.notify('textDocument/didOpen', { textDocument: { uri, languageId: 'shellscript', version: 1, text: '#!/bin/bash\nx = 1\nread line\n' } });
    const d = await client.diagnostics(uri, (list) => list.length > 0);
    assert.deepStrictEqual(d.map((x) => [x.code, x.severity, x.range.start.line, x.message.split(':')[0]]), [['assignment-with-spaces', 2, 1, 'Pitfall'], ['read-without-r', 3, 2, 'Caveat']]);
    client.notify('textDocument/didClose', { textDocument: { uri } });
  });

  it('reports the other warnings and caveats of the explanations, and no plain fact', async () => {
    const uri = 'file:///work/notes.sh';
    client.notify('textDocument/didOpen', { textDocument: { uri, languageId: 'shellscript', version: 1, text: '#!/bin/bash\nf() {\n  local x=$(false)\n}\n[ -f a\nexit 300\n' } });
    const d = await client.diagnostics(uri, (list) => list.length > 0);
    const at = (x: any) => [x.code, x.severity, x.range.start.line, x.range.start.character, x.range.end.character, x.message.slice(0, 14)];
    // (Without the mark: a caveat starts with its word; an error, at severity 1, without "Error:", which the severity says.)
    assert.deepStrictEqual(d.map(at), [['declaration-masks-status', 3, 2, 2, 18, 'Caveat: the st'], ['bracket-missing-close', 1, 4, 0, 6, '`[` has no `]`']]);
    client.notify('textDocument/didClose', { textDocument: { uri } });
  });

  it('fades code that never runs: a hint tagged Unnecessary, unless hints.deadCode is off', async () => {
    const uri = 'file:///work/dead.sh';
    client.notify('textDocument/didOpen', { textDocument: { uri, languageId: 'shellscript', version: 1, text: '#!/bin/bash\nif false; then\n  echo a\n  echo b\nfi\nexit 0\necho c\n' } });
    const d = await client.diagnostics(uri, (list) => list.length > 0);
    assert.deepStrictEqual(d.map((x) => [x.code, x.severity, x.tags, x.range.start, x.range.end]), [
      ['dead-code', 4, [1], { line: 2, character: 2 }, { line: 3, character: 8 }],
      ['dead-code', 4, [1], { line: 6, character: 0 }, { line: 6, character: 6 }],
    ]);
    assert.match(d[0].message, /^This never runs/);
    client.notify('workspace/didChangeConfiguration', { settings: { bashExplainer: { hints: { deadCode: false } } } });
    await client.diagnostics(uri, (list) => list.length === 0);
    client.notify('workspace/didChangeConfiguration', { settings: { bashExplainer: { hints: { deadCode: true } } } });
    client.notify('textDocument/didClose', { textDocument: { uri } });
  });

  it('reads the shell code in a Dockerfile', async () => {
    client.notify('textDocument/didOpen', { textDocument: { uri: dockerfile, languageId: 'dockerfile', version: 1, text: 'FROM alpine\nRUN curl -s x | sh\n' } });
    const d = await client.diagnostics(dockerfile, (list) => list.length > 0);
    assert.ok(d.some((x) => x.code === 'dockerPipefail'), JSON.stringify(d));
    const r = await client.request('textDocument/hover', { textDocument: { uri: dockerfile }, position: { line: 1, character: 5 } });
    assert.match(r.result.contents.value, /curl/);
    // The command is named, not repeated with its arguments.
    assert.match(r.result.contents.value, /^ {2}- `curl` — Transfer data/m);
  });

  it('gives semantic tokens while highlight.enabled is on (by default), for scripts and the shell code of host files', async () => {
    const init = await client.request('textDocument/semanticTokens/full', { textDocument: { uri: script } });
    assert.ok(init.result.data.length > 0);
    client.notify('workspace/didChangeConfiguration', { settings: { bashExplainer: { highlight: { enabled: false } } } });
    const off = await client.request('textDocument/semanticTokens/full', { textDocument: { uri: script } });
    assert.deepStrictEqual(off.result, { data: [] });
    client.notify('workspace/didChangeConfiguration', { settings: { bashExplainer: { highlight: { enabled: true } } } });
    // [line, character, length, type, modifiers], absolute.
    const decode = (data: number[], legend: string[]) => {
      const out: string[] = [];
      for (let i = 0, line = 0, ch = 0; i < data.length; i += 5) {
        ch = data[i] ? data[i + 1] : ch + data[i + 1];
        line += data[i];
        out.push(`${line}:${ch}:${data[i + 2]}:${legend[data[i + 3]]}:${data[i + 4]}`);
      }
      return out;
    };
    const { tokenTypes } = (await import('../src/semanticTokens')).LEGEND;
    const full = await client.request('textDocument/semanticTokens/full', { textDocument: { uri: script } });
    // #!/bin/sh / if [ -f "$1" ]; then echo yes; fi (the shebang a comment: this client lists no `tokenTypes`)
    assert.deepStrictEqual(decode(full.result.data, tokenTypes), [
      '0:0:9:comment:0', '1:0:2:keyword:0', '1:3:1:function:4', '1:5:2:parameter:0', '1:8:1:string:0', '1:9:2:variable:0', '1:11:1:string:0', '1:13:1:function:4',
      '1:14:1:operator:0', '1:16:4:keyword:0', '1:21:4:function:4', '1:29:1:operator:0', '1:31:2:keyword:0',
    ]);
    const range = await client.request('textDocument/semanticTokens/range', { textDocument: { uri: script }, range: { start: { line: 0, character: 0 }, end: { line: 0, character: 9 } } });
    assert.deepStrictEqual(decode(range.result.data, tokenTypes), ['0:0:9:comment:0']);
    const docker = await client.request('textDocument/semanticTokens/full', { textDocument: { uri: dockerfile } });
    assert.deepStrictEqual(decode(docker.result.data, tokenTypes), ['1:4:4:function:0', '1:9:2:parameter:0', '1:14:1:operator:0', '1:16:2:function:0']);
    const unknown = await client.request('textDocument/semanticTokens/full', { textDocument: { uri: 'file:///work/none.sh' } });
    assert.deepStrictEqual(unknown.result, { data: [] });
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

  it('reads the settings file of the command-line tool, under the settings the editor sends', async () => {
    const xdg = path.join(dir, 'xdg');
    fs.mkdirSync(path.join(xdg, 'bash-explainer'), { recursive: true });
    fs.writeFileSync(path.join(xdg, 'bash-explainer', 'settings.json'), '{ "bashExplainer.shell": "sh", "hover.maxDepth": 1, "nope": 1 }');
    const c = new Client(cli, blocker, { env: { XDG_CONFIG_HOME: xdg } });
    await c.request('initialize', { processId: null, rootUri: null, capabilities: {}, initializationOptions: { bashExplainer: { examples: false, notes: { pitfalls: false } } } });
    c.notify('initialized', {});
    const uri = 'file:///work/bash.sh';
    c.notify('textDocument/didOpen', { textDocument: { uri, languageId: 'sh', version: 1, text: '#!/bin/bash\n[[ -f x ]] && echo "hi"\n' } });
    // The shell from the file: a bash script is checked as sh.
    const d = await c.diagnostics(uri, (list) => list.length > 0);
    assert.deepStrictEqual(d.map((x) => x.code), ['dbracket']);
    const logs = c.notifications.filter((n) => n.method === 'window/logMessage').map((n) => n.params.message);
    assert.ok(logs.some((m) => /settings\.json: unknown setting nope; ignored/.test(m)), JSON.stringify(logs));
    // hover.maxDepth from the file: the top level only.
    const hover = async () => (await c.request('textDocument/hover', { textDocument: { uri }, position: { line: 1, character: 0 } })).result;
    const value: string = (await hover()).contents.value;
    assert.match(value, /^- /m);
    assert.doesNotMatch(value, /^ {2}- /m);
    // The editor's settings win, a key at a time; a wrong value is logged and left out.
    c.notify('workspace/didChangeConfiguration', { settings: { bashExplainer: { diagnostics: { ignore: ['dbracket'] }, 'hover.maxDepth': 0, shell: 'fish' } } });
    await c.diagnostics(uri, (list) => list.length === 0);
    assert.match((await hover()).contents.value, /^ {2}- /m);
    assert.ok(c.notifications.some((n) => n.method === 'window/logMessage' && /bashExplainer\.shell: expected one of/.test(n.params.message)));
    // Off: the hover, and the warnings altogether.
    c.notify('workspace/didChangeConfiguration', { settings: { bashExplainer: { 'hover.enabled': false, 'diagnostics.ignore': [], 'diagnostics.enabled': false } } });
    assert.strictEqual(await hover(), null);
    await c.diagnostics(uri, (list) => list.length === 0);
    // Files with shell code: only the kinds in embedded.files, and warnings in them only with diagnostics.embedded.
    const docker = 'file:///work/Dockerfile';
    c.notify('workspace/didChangeConfiguration', { settings: { 'bashExplainer.embedded.files': ['makefile'], 'bashExplainer.diagnostics.enabled': true, 'bashExplainer.hover.enabled': true } });
    c.notify('textDocument/didOpen', { textDocument: { uri: docker, languageId: 'dockerfile', version: 1, text: 'FROM alpine\nRUN curl -s x | sh\n' } });
    await c.diagnostics(docker, (list) => list.length === 0);
    assert.strictEqual((await c.request('textDocument/hover', { textDocument: { uri: docker }, position: { line: 1, character: 5 } })).result, null);
    c.notify('workspace/didChangeConfiguration', { settings: { bashExplainer: { 'embedded.files': ['dockerfile'], 'diagnostics.embedded': false } } });
    assert.match((await c.request('textDocument/hover', { textDocument: { uri: docker }, position: { line: 1, character: 5 } })).result.contents.value, /curl/);
    await c.diagnostics(docker, (list) => list.length === 0);
    c.notify('workspace/didChangeConfiguration', { settings: { bashExplainer: { 'diagnostics.embedded': true } } });
    await c.diagnostics(docker, (list) => list.some((x) => x.code === 'dockerPipefail'));
    // More language IDs read as shell scripts.
    const other = 'file:///work/build.txt';
    c.notify('textDocument/didOpen', { textDocument: { uri: other, languageId: 'plaintext', version: 1, text: 'ls -l\n' } });
    assert.strictEqual((await c.request('textDocument/hover', { textDocument: { uri: other }, position: { line: 0, character: 0 } })).result, null);
    c.notify('workspace/didChangeConfiguration', { settings: { bashExplainer: { languages: ['shellscript', 'plaintext'] } } });
    assert.match((await c.request('textDocument/hover', { textDocument: { uri: other }, position: { line: 0, character: 0 } })).result.contents.value, /`ls`/);
    await c.request('shutdown', null);
    c.notify('exit', null);
    assert.strictEqual(await c.exited, 0);
  });

  it('reads the settings file given with --config, and logs one it cannot read', async () => {
    const file = path.join(dir, 'lsp.json');
    fs.writeFileSync(file, '{ "language": "ja" }');
    const c = new Client(cli, blocker, { args: ['--config', file] });
    await c.request('initialize', { processId: null, rootUri: null, capabilities: {} });
    c.notify('initialized', {});
    c.notify('textDocument/didOpen', { textDocument: { uri: script, languageId: 'sh', version: 1, text: 'ls -l\n' } });
    assert.match((await c.request('textDocument/hover', { textDocument: { uri: script }, position: { line: 0, character: 0 } })).result.contents.value, /1 行目/);
    await c.request('shutdown', null);
    c.notify('exit', null);
    await c.exited;
    const broken = new Client(cli, blocker, { args: [`--config=${path.join(dir, 'missing.json')}`] });
    await broken.request('initialize', { processId: null, rootUri: null, capabilities: {} });
    broken.notify('initialized', {});
    await until(() => broken.notifications.some((n) => n.method === 'window/logMessage' && /cannot read the settings file .*missing\.json/.test(n.params.message)));
    await broken.request('shutdown', null);
    broken.notify('exit', null);
    await broken.exited;
  });

  it('asks a client that can do it to request the semantic tokens again when the settings change', async () => {
    const c = new Client(cli, blocker);
    const init = await c.request('initialize', {
      processId: null, rootUri: null, capabilities: { workspace: { semanticTokens: { refreshSupport: true } }, textDocument: { semanticTokens: { tokenTypes: ['comment', 'shebang'] } } },
    });
    const legend: string[] = init.result.capabilities.semanticTokensProvider.legend.tokenTypes;
    assert.strictEqual(legend[0], 'comment');
    c.notify('initialized', {});
    c.notify('workspace/didChangeConfiguration', { settings: { bashExplainer: { 'highlight.enabled': true } } });
    await until(() => c.notifications.some((n) => n.method === 'workspace/semanticTokens/refresh' && n.id !== undefined));
    // A client that lists our own type `shebang` gets it (the others get a comment, as above).
    c.notify('textDocument/didOpen', { textDocument: { uri: script, languageId: 'sh', version: 1, text: '#!/bin/sh\n' } });
    const tokens = await c.request('textDocument/semanticTokens/full', { textDocument: { uri: script } });
    assert.deepStrictEqual(tokens.result.data.slice(0, 5), [0, 0, 9, legend.indexOf('shebang'), 0]);
    await c.request('shutdown', null);
    c.notify('exit', null);
    await c.exited;
  });
});

async function until(ok: () => boolean): Promise<void> {
  const end = Date.now() + 10000;
  while (!ok()) {
    if (Date.now() > end) throw new Error('timed out');
    await new Promise((r) => setTimeout(r, 50));
  }
}
