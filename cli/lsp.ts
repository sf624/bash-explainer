// A Language Server (LSP over standard input and output) for editors other than VS Code: hover
// explanations, the problems as diagnostics and their quick fixes, hints after surprising command names, and (with highlight.enabled) semantic tokens. Hand-written JSON-RPC, so the
// tool still needs nothing but fs (the usual libraries also bring sockets).
import { Analyzer } from '../src/analyzer';
import { DocumentIssue, diagnosticsFor, explainDocumentLine, heredocAt, plain, ShellDocument } from '../src/document';
import { FileKind, kindOfDocument, openDocument, shellsOf } from '../src/document-setup';
import { Lang, resolveLang } from '../src/i18n';
import { LEGEND, semanticTokens } from '../src/semanticTokens';
import { explainOptions, forcedShell, mergeSettings, readSettings, Settings } from '../src/settings';
import { createUnbashParser } from '../src/syntax/adapters/unbash';
import { partAt, rangeOnLine } from '../src/ui/hoverParts';
import { plainPartHover } from '../src/ui/hoverView';
import { nameHints } from '../src/ui/nameHints';
import { pruneDepth, toPlainMarkdown } from '../src/ui/render';
import { readSettingsFile, settingsFile } from './settings-file';

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

export interface Io {
  input: NodeJS.ReadableStream;
  output: NodeJS.WritableStream;
  env: NodeJS.ProcessEnv;
  version: string;
  exit: (code: number) => void;
  /** The settings file given with --config. */
  config?: string;
}

const fileName = (uri: string) => decodeURIComponent(uri.replace(/^[a-z][\w+.-]*:\/\/[^/]*/i, ''));

export function startLanguageServer(io: Io): void {
  const locale = io.env.LC_ALL || io.env.LC_MESSAGES || io.env.LANG || '';
  // The settings: the defaults, then the settings file of the command-line tool, then what the editor
  // sends (initializationOptions, workspace/didChangeConfiguration).
  let fromFile: Partial<Settings> = {};
  let fromEditor: Partial<Settings> = {};
  let settings = mergeSettings();
  let lang: Lang = 'en';
  const update = () => {
    settings = mergeSettings(fromFile, fromEditor);
    lang = resolveLang(settings.language, locale);
  };
  /** Said in the editor's log once the client is ready. */
  const notices: string[] = [];
  const file = settingsFile(io.config, io.env);
  if (file) {
    try {
      const read = readSettingsFile(file);
      fromFile = read.settings;
      notices.push(...read.warnings);
    } catch (e) {
      notices.push((e as Error).message);
    }
  }
  update();
  const docs = new Map<string, Doc>();
  const timers = new Map<string, ReturnType<typeof setTimeout>>();
  const parser = createUnbashParser();
  let shuttingDown = false;
  /** Whether the client lets the server ask it to request the semantic tokens again. */
  let canRefresh = false;
  /** Whether the client lets the server ask it to request the inlay hints again. */
  let canRefreshHints = false;
  let requests = 0;

  const send = (msg: Message) => {
    const json = JSON.stringify({ jsonrpc: '2.0', ...msg });
    io.output.write(`Content-Length: ${Buffer.byteLength(json, 'utf8')}\r\n\r\n${json}`);
  };

  /** What kind of document it is, or undefined when it has nothing for us. */
  function kindOf(doc: Doc): FileKind | undefined {
    return kindOfDocument({ languageId: doc.languageId, fileName: fileName(doc.uri), text: doc.text }, settings, [...SHELL_LANGUAGES, ...settings.languages]);
  }

  function parse(doc: Doc): ShellDocument | undefined {
    if (doc.parsed) return doc.parsed;
    const kind = kindOf(doc);
    if (!kind) return undefined;
    doc.parsed = openDocument(doc.text, kind, (text) => parser.parse(text));
    return doc.parsed;
  }

  function forget(doc: Doc | undefined): void {
    if (doc) doc.parsed = undefined;
  }

  const shells = (doc: ShellDocument, uri: string) => shellsOf(doc.lines, fileName(uri), forcedShell(settings));

  function issues(doc: Doc): DocumentIssue[] {
    return diagnosticsFor(() => parse(doc), (d) => shells(d, doc.uri), lang, settings, 'lsp').shown;
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

  /** The part at the position first, then the whole line below a rule (plain Markdown: editors show no HTML, and run no command links). */
  function hover(doc: Doc, line: number, character: number) {
    if (!settings['hover.enabled']) return null;
    const parsed = parse(doc);
    if (!parsed || line >= parsed.lines.length) return null;
    const analyzer = new Analyzer(lang);
    const full = explainDocumentLine(analyzer, parsed, line, lang, shells(parsed, doc.uri), explainOptions(settings));
    if (!full.items.length && !full.notes.length) return null;
    // As in VS Code, the hover can be kept short: fewer levels of the tree, no examples.
    const ex = { ...full, items: pruneDepth(full.items, settings['hover.maxDepth']), examples: settings['examples.inHover'] ? full.examples : [] };
    const where = `Bash Explainer · ${lang === 'ja' ? `${line + 1} 行目` : `line ${line + 1}`}`;
    const text = parsed.lines[line];
    const chain = partAt(ex.items, { line, character }, heredocAt(parsed, line));
    const range = chain.length ? rangeOnLine(chain[chain.length - 1].span, line, text.length) : { start: { line, character: 0 }, end: { line, character: text.length } };
    return { contents: { kind: 'markdown', value: plainPartHover(ex, chain, lang, toPlainMarkdown(ex, text, where, lang)) }, range };
  }

  /** Hints after the command names that do not run what they suggest, on the lines asked for (`hints.names`). */
  function inlayHints(doc: Doc, from: number, to: number) {
    const parsed = settings['hints.names'] ? parse(doc) : undefined;
    if (!parsed) return [];
    const analyzer = new Analyzer(lang);
    const opts = explainOptions(settings);
    const out: unknown[] = [];
    for (let line = Math.max(0, from); line <= to && line < parsed.lines.length; line++) {
      if (!parsed.lines[line].trim()) continue;
      const ex = explainDocumentLine(analyzer, parsed, line, lang, shells(parsed, doc.uri), opts);
      for (const h of nameHints(ex, line, parsed.lines[line], lang)) {
        out.push({ position: h.position, label: h.label, paddingLeft: true, paddingRight: true, tooltip: { kind: 'markdown', value: h.tooltip } });
      }
    }
    return out;
  }

  function codeActions(doc: Doc, range: { start: { line: number }; end: { line: number } }) {
    return issues(doc)
      .filter((i) => i.fix && i.startLine <= range.end.line && i.endLine >= range.start.line)
      .map((i) => ({
        title: i.fix!.title[lang === 'ja' ? 0 : 1],
        kind: 'quickfix',
        diagnostics: [{ range: { start: { line: i.startLine, character: i.startCol }, end: { line: i.endLine, character: i.endCol } }, code: i.code, source: 'Bash Explainer', message: plain(i.message) }],
        edit: {
          changes: {
            [doc.uri]: i.fix!.edits.map((e) => ({ range: { start: { line: e.startLine, character: e.startCol }, end: { line: e.endLine, character: e.endCol } }, newText: e.text })),
          },
        },
      }));
  }

  /** The semantic tokens of a document (none while highlight.enabled is off); with `lines`, of those lines only. */
  function tokens(doc: Doc | undefined, lines?: { from: number; to: number }) {
    const parsed = doc && settings['highlight.enabled'] ? parse(doc) : undefined;
    return { data: parsed ? semanticTokens(parsed, lines) : [] };
  }

  const log = (message: string) => send({ method: 'window/logMessage', params: { type: 2, message: `Bash Explainer: ${message}` } });

  /** Settings from the editor: the keys of VS Code's settings, flat or nested, under `bashExplainer` or not. */
  function configure(options: any, where: string): void {
    const o = { ...(options?.bashExplainer ?? options) };
    // `examples: false`, as the first releases of the server read it.
    if (typeof o.examples === 'boolean') {
      o['examples.enabled'] = o.examples;
      delete o.examples;
    }
    const read = readSettings(o, where);
    fromEditor = { ...fromEditor, ...read.settings };
    update();
    read.warnings.forEach(log);
  }

  async function handle(m: Message): Promise<void> {
    const reply = (result: unknown) => m.id !== undefined && send({ id: m.id, result });
    switch (m.method) {
      case 'initialize':
        configure(m.params?.initializationOptions, 'initializationOptions');
        canRefresh = !!m.params?.capabilities?.workspace?.semanticTokens?.refreshSupport;
        canRefreshHints = !!m.params?.capabilities?.workspace?.inlayHint?.refreshSupport;
        return void reply({
          capabilities: {
            textDocumentSync: { openClose: true, change: 1 },
            hoverProvider: true,
            inlayHintProvider: true,
            codeActionProvider: { codeActionKinds: ['quickfix'] },
            // Always offered: highlight.enabled may be turned on later, and the tokens are empty while it is off.
            semanticTokensProvider: { legend: LEGEND, full: true, range: true },
          },
          serverInfo: { name: 'bash-explainer', version: io.version },
        });
      case 'initialized':
        notices.splice(0).forEach(log);
        return;
      case 'shutdown':
        shuttingDown = true;
        return void reply(null);
      case 'exit':
        return io.exit(shuttingDown ? 0 : 1);
      case 'workspace/didChangeConfiguration':
        configure(m.params?.settings, 'settings');
        // The kind of a document depends on the settings too (languages, embedded.files).
        for (const doc of docs.values()) {
          forget(doc);
          schedule(doc.uri);
        }
        // highlight.enabled, or which documents are shell code, may have changed.
        if (canRefresh) send({ id: `bash-explainer-${++requests}`, method: 'workspace/semanticTokens/refresh' });
        if (canRefreshHints) send({ id: `bash-explainer-${++requests}`, method: 'workspace/inlayHint/refresh' });
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
        return void reply(doc ? hover(doc, m.params.position.line, m.params.position.character) : null);
      }
      case 'textDocument/inlayHint': {
        const doc = docs.get(m.params.textDocument.uri);
        return void reply(doc ? inlayHints(doc, m.params.range.start.line, m.params.range.end.line) : []);
      }
      case 'textDocument/semanticTokens/full':
        return void reply(tokens(docs.get(m.params.textDocument.uri)));
      case 'textDocument/semanticTokens/range': {
        const r = m.params.range;
        return void reply(tokens(docs.get(m.params.textDocument.uri), { from: r.start.line, to: r.end.line }));
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
