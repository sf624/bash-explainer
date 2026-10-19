// A Language Server (LSP over standard input and output) for editors other than VS Code: hover
// explanations, the problems as diagnostics and their quick fixes. Hand-written JSON-RPC, so the
// tool still needs nothing but fs (the usual libraries also bring sockets).
import { Analyzer } from '../src/analyzer';
import { detectShell, Shell, SHELL_NAMES } from '../src/dialect';
import { DocumentIssue, documentIssues, explainDocumentLine, ShellDocument } from '../src/document';
import { extractShell, HostKind, hostKind } from '../src/hosts';
import { Lang } from '../src/i18n';
import { createUnbashParser } from '../src/syntax/adapters/unbash';
import { toPlainMarkdown } from '../src/ui/render';

type Message = { id?: number | string; method?: string; params?: any; result?: unknown; error?: unknown };

/** Language IDs editors use for shell scripts (VS Code, Neovim, Helix, Emacs, Zed…). */
const SHELL_LANGUAGES = new Set(['shellscript', 'sh', 'bash', 'zsh', 'ksh', 'dash', 'shell']);

interface Doc {
  uri: string;
  languageId: string;
  version: number;
  text: string;
  parsed?: ShellDocument;
}

interface Settings {
  language: Lang;
  /** The shell to check for; undefined: from the file. */
  shell?: Shell;
  examples: boolean;
}

export interface Io {
  input: NodeJS.ReadableStream;
  output: NodeJS.WritableStream;
  env: NodeJS.ProcessEnv;
  version: string;
  exit: (code: number) => void;
}

const fileName = (uri: string) => decodeURIComponent(uri.replace(/^[a-z][\w+.-]*:\/\/[^/]*/i, ''));

export function startLanguageServer(io: Io): void {
  const locale = io.env.LC_ALL || io.env.LC_MESSAGES || io.env.LANG || '';
  const settings: Settings = { language: locale.toLowerCase().startsWith('ja') ? 'ja' : 'en', examples: true };
  const docs = new Map<string, Doc>();
  const timers = new Map<string, ReturnType<typeof setTimeout>>();
  const parser = createUnbashParser();
  let shuttingDown = false;

  const send = (msg: Message) => {
    const json = JSON.stringify({ jsonrpc: '2.0', ...msg });
    io.output.write(`Content-Length: ${Buffer.byteLength(json, 'utf8')}\r\n\r\n${json}`);
  };

  /** What kind of document it is, or undefined when it has nothing for us. */
  function kindOf(doc: Doc): 'shell' | HostKind | undefined {
    if (SHELL_LANGUAGES.has(doc.languageId)) return 'shell';
    return hostKind(doc.languageId === 'make' ? 'makefile' : doc.languageId, fileName(doc.uri));
  }

  function parse(doc: Doc): ShellDocument | undefined {
    if (doc.parsed) return doc.parsed;
    const kind = kindOf(doc);
    if (!kind) return undefined;
    const lines = doc.text.split(/\r?\n/);
    if (kind === 'shell') {
      doc.parsed = { lines, tree: parser.parse(doc.text) };
    } else {
      const extracted = extractShell(kind, doc.text);
      doc.parsed = { lines, extracted, tree: parser.parse(extracted.text) };
    }
    return doc.parsed;
  }

  function forget(doc: Doc | undefined): void {
    if (doc) doc.parsed = undefined;
  }

  const shells = (doc: ShellDocument, uri: string) => ({ forced: settings.shell, detected: detectShell(doc.lines.slice(0, 50).join('\n'), fileName(uri)) });
  const plain = (message: string) => message.replace(/^[⚠ℹ]️?\s*/u, '');

  function issues(doc: Doc): DocumentIssue[] {
    const parsed = parse(doc);
    return parsed ? documentIssues(parsed, settings.language, shells(parsed, doc.uri)) : [];
  }

  function publish(uri: string): void {
    const doc = docs.get(uri);
    send({
      method: 'textDocument/publishDiagnostics',
      params: {
        uri,
        version: doc?.version,
        diagnostics: (doc ? issues(doc) : []).map((i) => ({
          range: { start: { line: i.startLine, character: i.startCol }, end: { line: i.endLine, character: i.endCol } },
          severity: i.severity === 'warning' ? 2 : 3,
          code: i.code,
          source: 'Bash Explainer',
          message: plain(i.message),
        })),
      },
    });
  }

  function schedule(uri: string): void {
    clearTimeout(timers.get(uri));
    timers.set(uri, setTimeout(() => publish(uri), 200));
  }

  function hover(doc: Doc, line: number) {
    const parsed = parse(doc);
    if (!parsed || line >= parsed.lines.length) return null;
    const analyzer = new Analyzer(settings.language);
    const ex = explainDocumentLine(analyzer, parsed, line, settings.language, shells(parsed, doc.uri), { examples: { enabled: settings.examples, disabled: [] } });
    if (!ex.items.length && !ex.notes.length) return null;
    const where = `Bash Explainer · ${settings.language === 'ja' ? `${line + 1} 行目` : `line ${line + 1}`}`;
    return {
      contents: { kind: 'markdown', value: toPlainMarkdown(ex, parsed.lines[line], where) },
      range: { start: { line, character: 0 }, end: { line, character: parsed.lines[line].length } },
    };
  }

  function codeActions(doc: Doc, range: { start: { line: number }; end: { line: number } }) {
    return issues(doc)
      .filter((i) => i.fix && i.startLine <= range.end.line && i.endLine >= range.start.line)
      .map((i) => ({
        title: i.fix!.title[settings.language === 'ja' ? 0 : 1],
        kind: 'quickfix',
        diagnostics: [{ range: { start: { line: i.startLine, character: i.startCol }, end: { line: i.endLine, character: i.endCol } }, code: i.code, source: 'Bash Explainer', message: plain(i.message) }],
        edit: {
          changes: {
            [doc.uri]: i.fix!.edits.map((e) => ({ range: { start: { line: e.startLine, character: e.startCol }, end: { line: e.endLine, character: e.endCol } }, newText: e.text })),
          },
        },
      }));
  }

  function configure(options: any): void {
    const o = options?.bashExplainer ?? options ?? {};
    if (o.language === 'en' || o.language === 'ja') settings.language = o.language;
    if (typeof o.shell === 'string') settings.shell = o.shell in SHELL_NAMES ? (o.shell as Shell) : undefined;
    if (typeof o.examples === 'boolean') settings.examples = o.examples;
  }

  async function handle(m: Message): Promise<void> {
    const reply = (result: unknown) => m.id !== undefined && send({ id: m.id, result });
    switch (m.method) {
      case 'initialize':
        configure(m.params?.initializationOptions);
        return void reply({
          capabilities: {
            textDocumentSync: { openClose: true, change: 1 },
            hoverProvider: true,
            codeActionProvider: { codeActionKinds: ['quickfix'] },
          },
          serverInfo: { name: 'bash-explainer', version: io.version },
        });
      case 'initialized':
        return;
      case 'shutdown':
        shuttingDown = true;
        return void reply(null);
      case 'exit':
        return io.exit(shuttingDown ? 0 : 1);
      case 'workspace/didChangeConfiguration':
        configure(m.params?.settings);
        for (const doc of docs.values()) schedule(doc.uri);
        return;
      case 'textDocument/didOpen': {
        const d = m.params.textDocument;
        docs.set(d.uri, { uri: d.uri, languageId: d.languageId, version: d.version, text: d.text });
        return schedule(d.uri);
      }
      case 'textDocument/didChange': {
        const doc = docs.get(m.params.textDocument.uri);
        const changes = m.params.contentChanges;
        if (!doc || !changes.length) return;
        forget(doc);
        doc.text = changes[changes.length - 1].text;
        doc.version = m.params.textDocument.version;
        return schedule(doc.uri);
      }
      case 'textDocument/didClose': {
        const uri = m.params.textDocument.uri;
        forget(docs.get(uri));
        docs.delete(uri);
        clearTimeout(timers.get(uri));
        return send({ method: 'textDocument/publishDiagnostics', params: { uri, diagnostics: [] } });
      }
      case 'textDocument/hover': {
        const doc = docs.get(m.params.textDocument.uri);
        return void reply(doc ? hover(doc, m.params.position.line) : null);
      }
      case 'textDocument/codeAction': {
        const doc = docs.get(m.params.textDocument.uri);
        return void reply(doc ? codeActions(doc, m.params.range) : []);
      }
      default:
        // A request we do not know gets an error; notifications are ignored.
        if (m.id !== undefined && m.method) send({ id: m.id, error: { code: -32601, message: `Unhandled method ${m.method}` } });
    }
  }

  // Messages are framed by a Content-Length header.
  let buffer = Buffer.alloc(0);
  io.input.on('data', (chunk: Buffer) => {
    buffer = Buffer.concat([buffer, chunk]);
    for (;;) {
      const end = buffer.indexOf('\r\n\r\n');
      if (end < 0) return;
      const length = Number(/content-length:\s*(\d+)/i.exec(buffer.subarray(0, end).toString('ascii'))?.[1]);
      if (!Number.isFinite(length) || buffer.length < end + 4 + length) return;
      const body = buffer.subarray(end + 4, end + 4 + length).toString('utf8');
      buffer = buffer.subarray(end + 4 + length);
      let m: Message;
      try {
        m = JSON.parse(body);
      } catch {
        continue;
      }
      handle(m).catch((e) => m.id !== undefined && send({ id: m.id, error: { code: -32603, message: e instanceof Error ? e.message : String(e) } }));
    }
  });
  io.input.on('end', () => io.exit(shuttingDown ? 0 : 1));
}
