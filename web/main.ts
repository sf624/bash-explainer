// The web page: a script editor on the left, the extension's explanation panel on the right.
// Everything runs here, in the browser; the script is never sent anywhere.
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { HighlightStyle, StreamLanguage, StreamParser, syntaxHighlighting } from '@codemirror/language';
import { dockerFile } from '@codemirror/legacy-modes/mode/dockerfile';
import { groovy } from '@codemirror/legacy-modes/mode/groovy';
import { json } from '@codemirror/legacy-modes/mode/javascript';
import { python } from '@codemirror/legacy-modes/mode/python';
import { shell } from '@codemirror/legacy-modes/mode/shell';
import { yaml } from '@codemirror/legacy-modes/mode/yaml';
import { Diagnostic, forceLinting, linter, lintGutter } from '@codemirror/lint';
import { Compartment, EditorState, StateEffect, StateField } from '@codemirror/state';
import { Decoration, DecorationSet, drawSelection, EditorView, highlightActiveLine, highlightActiveLineGutter, keymap, lineNumbers } from '@codemirror/view';
import { tags } from '@lezer/highlight';
import type { BashParser as Parser } from '../src/parser';
import { Analyzer, LineExplanation, Span } from '../src/analyzer';
import { detectShell, Shell } from '../src/dialect';
import { DocumentIssue, documentIssues, explainDocumentLine, ShellDocument, Shells } from '../src/document';
import { rerun } from '../src/examples/rerun';
import { extractShell } from '../src/hosts';
import { Lang } from '../src/i18n';
import { createBashParser } from '../src/parser';
import { FromPanel, panelUpdate } from '../src/ui/panelView';
import { quickReference } from '../src/ui/reference';
import { toPlainMarkdown } from '../src/ui/render';
import { Kind, KINDS } from './samples';

declare const __VERSION__: string;

const TEXT = {
  en: {
    tagline: 'Explains shell scripts line by line. Move the cursor to a line to see what it does.',
    install: 'Install for VS Code',
    kind: 'File',
    lang: 'Language',
    sample: 'Load the sample',
    share: 'Copy a link to this script',
    shared: 'Link copied. The script is in the part after #, which browsers do not send to the server.',
    copied: 'Copied the explanation as Markdown.',
    problems: 'Problems',
    privacy: 'Your script stays in this browser: it is parsed and explained here, with no server and no AI.',
    notices: 'Third-party notices',
    loading: 'Loading the parser…',
    failed: 'Could not load the parser:',
    replace: 'Replace your script with the sample?',
    line: (n: number) => `Ln ${n}`,
    kinds: { shell: 'Shell script' } as Partial<Record<Kind, string>>,
  },
  ja: {
    tagline: 'シェルスクリプトを1行ずつ解説します。知りたい行にカーソルを置いてください。',
    install: 'VS Code に入れる',
    kind: 'ファイル',
    lang: '言語',
    sample: 'サンプルを読み込む',
    share: 'このスクリプトへのリンクをコピー',
    shared: 'リンクをコピーしました。スクリプトは # より後ろに入っていて、ブラウザはこの部分をサーバーに送りません。',
    copied: '解説を Markdown でコピーしました。',
    problems: '問題',
    privacy: 'スクリプトはこのブラウザから出ません。構文解析も解説もこのページの中で行い、サーバーも AI も使いません。',
    notices: 'サードパーティのライセンス',
    loading: '構文解析器を読み込んでいます…',
    failed: '構文解析器を読み込めませんでした:',
    replace: '入力中のスクリプトをサンプルに置き換えますか？',
    line: (n: number) => `${n} 行目`,
    kinds: { shell: 'シェルスクリプト' } as Partial<Record<Kind, string>>,
  },
};

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const kindInfo = (k: Kind) => KINDS.find((x) => x.kind === k) ?? KINDS[0];

// ---- State ----------------------------------------------------------------------------------

const shared = readHash();
let lang: Lang = shared.lang ?? (navigator.language.toLowerCase().startsWith('ja') ? 'ja' : 'en');
let kind: Kind = shared.kind ?? 'shell';
/** The shell and yq chosen in the panel ('auto' when unset). */
const choice: { shell?: Shell; yq?: string } = {};
let parser: Parser | undefined;
const analyzers = new Map<Lang, Analyzer>();
let parsed: { text: string; kind: Kind; doc: ShellDocument } | undefined;
let shown: { explanation: LineExplanation; line: number } | undefined;

const analyzer = () => analyzers.get(lang) ?? analyzers.set(lang, new Analyzer(lang)).get(lang)!;

/** The script as the explainers see it, parsed once per change. */
function shellDocument(): ShellDocument | undefined {
  if (!parser) return undefined;
  const text = view.state.doc.toString();
  if (parsed && parsed.text === text && parsed.kind === kind) return parsed.doc;
  parsed?.doc.tree.delete();
  const lines = text.split('\n');
  let doc: ShellDocument;
  if (kind === 'shell') {
    doc = { lines, tree: parser.parse(text) };
  } else {
    const extracted = extractShell(kind, text);
    doc = { lines, extracted, tree: parser.parse(extracted.text) };
  }
  parsed = { text, kind, doc };
  return doc;
}

function shells(): Shells {
  const head = view.state.doc.sliceString(0, view.state.doc.line(Math.min(50, view.state.doc.lines)).to);
  return { forced: choice.shell, detected: detectShell(head, kindInfo(kind).fileName) };
}

// ---- Editor ---------------------------------------------------------------------------------

const MODES: Partial<Record<Kind, StreamParser<unknown>>> = {
  shell, makefile: shell, dockerfile: dockerFile, yaml, npm: json, python, jenkinsfile: groovy,
};
const languageMode = new Compartment();
const modeFor = (k: Kind) => (MODES[k] ? StreamLanguage.define(MODES[k]!) : []);

/** The part of the line the pointer is on in the panel. */
const setHighlight = StateEffect.define<{ from: number; to: number } | null>();
const highlightField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(set, tr) {
    for (const e of tr.effects) {
      if (e.is(setHighlight)) return e.value && e.value.to > e.value.from ? Decoration.set([Decoration.mark({ class: 'cm-bx-highlight' }).range(e.value.from, e.value.to)]) : Decoration.none;
    }
    return tr.docChanged ? Decoration.none : set;
  },
  provide: (f) => EditorView.decorations.from(f),
});

const highlightStyle = HighlightStyle.define([
  { tag: [tags.keyword, tags.operator, tags.controlKeyword], color: 'var(--vscode-charts-purple)' },
  { tag: [tags.string, tags.special(tags.string)], color: 'var(--vscode-charts-green)' },
  { tag: tags.comment, color: 'var(--vscode-descriptionForeground)', fontStyle: 'italic' },
  { tag: [tags.variableName, tags.special(tags.variableName), tags.definition(tags.variableName)], color: 'var(--vscode-charts-red)' },
  { tag: [tags.number, tags.bool, tags.atom], color: 'var(--vscode-charts-orange)' },
  { tag: [tags.function(tags.variableName), tags.standard(tags.variableName), tags.propertyName, tags.attributeName], color: 'var(--vscode-charts-blue)' },
  { tag: tags.meta, color: 'var(--vscode-descriptionForeground)' },
]);

const theme = EditorView.theme({
  '&': { height: '100%', color: 'var(--vscode-editor-foreground)', backgroundColor: 'var(--vscode-editor-background)', fontSize: 'var(--vscode-editor-font-size)' },
  '.cm-scroller': { fontFamily: 'var(--vscode-editor-font-family)', lineHeight: '1.5' },
  '.cm-content': { caretColor: 'var(--vscode-editor-foreground)' },
  '.cm-gutters': { backgroundColor: 'var(--vscode-editor-background)', color: 'var(--vscode-descriptionForeground)', border: 'none' },
  '.cm-activeLine, .cm-activeLineGutter': { backgroundColor: 'var(--vscode-list-hoverBackground)' },
  '&.cm-focused .cm-cursor': { borderLeftColor: 'var(--vscode-editor-foreground)' },
  '&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground': { backgroundColor: 'rgba(0, 120, 212, 0.3)' },
  '.cm-bx-highlight': { backgroundColor: 'var(--vscode-editor-findMatchHighlightBackground)', borderRadius: '2px' },
  '.cm-tooltip': { backgroundColor: 'var(--vscode-input-background)', color: 'var(--vscode-foreground)', border: '1px solid var(--vscode-panel-border)' },
});

/** A problem's message without the ⚠ / ℹ it starts with in the explanations. */
const plain = (message: string) => message.replace(/^[⚠ℹ]\uFE0F?\s*/u, '');

/** Line and column (0-based) to a position in the editor, clamped to the document. */
function pos(state: EditorState, line: number, col: number): number {
  const l = state.doc.line(Math.max(1, Math.min(line + 1, state.doc.lines)));
  return Math.min(l.from + Math.max(0, col), l.to);
}

const problems = linter((v): Diagnostic[] => {
  const doc = shellDocument();
  if (!doc) return [];
  const list = documentIssues(doc, lang, shells());
  showProblems(list);
  return list.map((i) => ({
    from: pos(v.state, i.startLine, i.startCol),
    to: pos(v.state, i.endLine, i.endCol),
    severity: i.severity,
    message: plain(i.message),
    source: i.code,
    actions: i.fix ? [{
      name: i.fix.title[lang === 'ja' ? 0 : 1],
      apply: (view: EditorView) => view.dispatch({ changes: i.fix!.edits.map((e) => ({ from: pos(view.state, e.startLine, e.startCol), to: pos(view.state, e.endLine, e.endCol), insert: e.text })) }),
    }] : undefined,
  }));
}, {
  delay: 300,
  // The problems depend on the shell and the language too, not only on the text.
  needsRefresh: (u) => u.transactions.some((tr) => tr.effects.some((e) => e.is(relint))),
});

const relint = StateEffect.define<null>();
/** Checks the script again now (forceLinting alone only hurries a check the text already asked for). */
function recheck(): void {
  view.dispatch({ effects: relint.of(null) });
  forceLinting(view);
}

let timer: ReturnType<typeof setTimeout> | undefined;
const view = new EditorView({
  parent: $('editor'),
  state: EditorState.create({
    doc: shared.text ?? kindInfo(kind).sample,
    selection: { anchor: 0 },
    extensions: [
      lineNumbers(), highlightActiveLineGutter(), highlightActiveLine(), drawSelection(), history(),
      keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab]),
      languageMode.of(modeFor(kind)), syntaxHighlighting(highlightStyle), theme,
      highlightField, problems, lintGutter(),
      EditorView.updateListener.of((u) => {
        if (!u.docChanged && !u.selectionSet) return;
        clearTimeout(timer);
        timer = setTimeout(updatePanel, u.docChanged ? 150 : 60);
      }),
    ],
  }),
});
placeCursor(shared.text ? 1 : kindInfo(kind).cursorLine);

function placeCursor(lineNumber: number): void {
  const line = view.state.doc.line(Math.min(lineNumber, view.state.doc.lines));
  view.dispatch({ selection: { anchor: line.from }, scrollIntoView: true });
}

function setText(text: string, cursorLine: number): void {
  view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text } });
  placeCursor(cursorLine);
}

// ---- Panel ----------------------------------------------------------------------------------

const frame = $<HTMLIFrameElement>('panel');
let panelReady = false;

// The panel says 'ready' when it starts; it may have done so before this script ran.
function panelLoaded(): void {
  panelReady = true;
  updatePanel();
}
frame.addEventListener('load', panelLoaded);
if (frame.contentDocument?.readyState === 'complete' && frame.contentWindow?.location.href.endsWith('panel.html')) panelReady = true;

function toPanel(message: unknown): void {
  if (panelReady) frame.contentWindow?.postMessage(message, location.origin);
}

function updatePanel(): void {
  const doc = shellDocument();
  if (!doc) return;
  const line = view.state.doc.lineAt(view.state.selection.main.head).number - 1;
  const s = shells();
  const explanation = explainDocumentLine(analyzer(), doc, line, lang, s, {
    yqFlavor: choice.yq ?? 'auto',
    examples: { enabled: true, disabled: [] },
  });
  shown = { explanation, line };
  toPanel(panelUpdate({
    lang, explanation, file: kindInfo(kind).fileName, line, lineText: doc.lines[line] ?? '',
    choice, detected: s.detected, placement: 'first',
  }));
}

function spanRange(span: Span): { from: number; to: number } {
  return { from: pos(view.state, span.start.line, span.start.character), to: pos(view.state, span.end.line, span.end.character) };
}

window.addEventListener('message', (e) => {
  if (e.source !== frame.contentWindow || e.origin !== location.origin) return;
  const m = e.data as FromPanel;
  switch (m.type) {
    case 'ready':
      return panelLoaded();
    case 'rerun':
      return toPanel({ type: 'rerunResult', id: m.id, result: rerun(m.spec, m.input.replace(/\n$/, '').split('\n'), lang) });
    case 'reference':
      return toPanel({ type: 'reference', entries: quickReference(lang) });
    case 'override':
      choice[m.key] = m.value === 'auto' ? undefined : (m.value as Shell);
      updatePanel();
      return recheck();
    case 'highlight':
      view.dispatch({ effects: setHighlight.of(m.span ? spanRange(m.span) : null) });
      return;
    case 'reveal': {
      const r = spanRange(m.span);
      view.dispatch({ selection: { anchor: r.from, head: r.to }, scrollIntoView: true });
      view.focus();
      return;
    }
    case 'copy': {
      if (!shown) return;
      const md = toPlainMarkdown(shown.explanation, view.state.doc.line(shown.line + 1).text, `${kindInfo(kind).fileName}:${shown.line + 1}`);
      void navigator.clipboard.writeText(md).then(() => status(TEXT[lang].copied));
      return;
    }
  }
});

// ---- Problems list --------------------------------------------------------------------------

function showProblems(list: DocumentIssue[]): void {
  const t = TEXT[lang];
  $('problems').hidden = list.length === 0;
  $('problems-title').textContent = `${t.problems} (${list.length})`;
  $('problem-list').replaceChildren(...list.map((i) => {
    const li = document.createElement('li');
    const span = (cls: string, text: string) => Object.assign(document.createElement('span'), { className: cls, textContent: text });
    li.append(span(`icon ${i.severity}`, i.severity === 'warning' ? '⚠' : 'ℹ'), span('where', t.line(i.startLine + 1)), span('message', plain(i.message)), span('code', i.code));
    li.addEventListener('click', () => {
      view.dispatch({ selection: { anchor: pos(view.state, i.startLine, i.startCol), head: pos(view.state, i.endLine, i.endCol) }, scrollIntoView: true });
      view.focus();
    });
    return li;
  }));
}

// ---- Toolbar --------------------------------------------------------------------------------

let statusTimer: ReturnType<typeof setTimeout> | undefined;
function status(text: string, sticky = false): void {
  $('status').textContent = text;
  clearTimeout(statusTimer);
  if (!sticky) statusTimer = setTimeout(() => ($('status').textContent = ''), 6000);
}

function applyLanguage(): void {
  const t = TEXT[lang];
  document.documentElement.lang = lang;
  $('tagline').textContent = t.tagline;
  $('install').textContent = t.install;
  $('kind-label').textContent = t.kind;
  $('lang-label').textContent = t.lang;
  $('sample').textContent = t.sample;
  $('share').textContent = t.share;
  $('privacy').textContent = t.privacy;
  $('notices').textContent = t.notices;
  $<HTMLSelectElement>('lang').value = lang;
  $<HTMLSelectElement>('kind').replaceChildren(...KINDS.map((k) => new Option(t.kinds[k.kind] ?? k.name, k.kind, false, k.kind === kind)));
}

$<HTMLSelectElement>('lang').addEventListener('change', (e) => {
  lang = (e.target as HTMLSelectElement).value === 'ja' ? 'ja' : 'en';
  applyLanguage();
  // The panel keeps its quick reference once loaded: start it again in the new language.
  panelReady = false;
  frame.src = 'panel.html';
  recheck();
});

$<HTMLSelectElement>('kind').addEventListener('change', (e) => {
  const before = kindInfo(kind);
  kind = (e.target as HTMLSelectElement).value as Kind;
  // A shell or yq chosen in the panel was for the previous file.
  choice.shell = undefined;
  choice.yq = undefined;
  view.dispatch({ effects: languageMode.reconfigure(modeFor(kind)) });
  // An untouched sample gives way to the sample of the new kind; the user's own text stays.
  const text = view.state.doc.toString();
  if (!text.trim() || text === before.sample) setText(kindInfo(kind).sample, kindInfo(kind).cursorLine);
  updatePanel();
  recheck();
});

$('sample').addEventListener('click', () => {
  const info = kindInfo(kind);
  const text = view.state.doc.toString();
  if (text.trim() && text !== info.sample && !KINDS.some((k) => k.sample === text) && !confirm(TEXT[lang].replace)) return;
  setText(info.sample, info.cursorLine);
});

$('share').addEventListener('click', async () => {
  const params = new URLSearchParams({ lang, kind, ...(await encodeText(view.state.doc.toString())) });
  const url = `${location.origin}${location.pathname}#${params}`;
  window.history.replaceState(null, '', url);
  await navigator.clipboard.writeText(url);
  status(TEXT[lang].shared);
});

// ---- Links ----------------------------------------------------------------------------------
// A link carries the script after '#', which browsers keep to themselves: z= is deflated, t= plain.

async function encodeText(text: string): Promise<Record<string, string>> {
  const bytes = new TextEncoder().encode(text);
  if (typeof CompressionStream === 'undefined') return { t: toBase64Url(bytes) };
  const deflated = await new Response(new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate-raw'))).arrayBuffer();
  return { z: toBase64Url(new Uint8Array(deflated)) };
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(text: string): Uint8Array {
  return Uint8Array.from(atob(text.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
}

function readHash(): { lang?: Lang; kind?: Kind; text?: string; deflated?: Uint8Array } {
  const p = new URLSearchParams(location.hash.slice(1));
  const out: { lang?: Lang; kind?: Kind; text?: string; deflated?: Uint8Array } = {};
  const l = p.get('lang');
  if (l === 'en' || l === 'ja') out.lang = l;
  const k = p.get('kind');
  if (KINDS.some((x) => x.kind === k)) out.kind = k as Kind;
  try {
    const t = p.get('t');
    if (t) out.text = new TextDecoder().decode(fromBase64Url(t));
    const z = p.get('z');
    if (z) out.deflated = fromBase64Url(z);
  } catch {
    // A broken link opens the sample.
  }
  return out;
}

async function inflate(bytes: Uint8Array): Promise<string | undefined> {
  if (typeof DecompressionStream === 'undefined') return undefined;
  try {
    return await new Response(new Blob([bytes as BlobPart]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).text();
  } catch {
    return undefined;
  }
}

// ---- Start ----------------------------------------------------------------------------------

async function start(): Promise<void> {
  applyLanguage();
  $('version').textContent = `Bash Explainer ${__VERSION__}`;
  if (shared.deflated) {
    const text = await inflate(shared.deflated);
    if (text !== undefined) setText(text, 1);
  }
  status(TEXT[lang].loading, true);
  try {
    parser = await createBashParser({ runtimeDir: '.', bashWasm: 'tree-sitter-bash.wasm' });
  } catch (e) {
    status(`${TEXT[lang].failed} ${e instanceof Error ? e.message : String(e)}`, true);
    return;
  }
  status('');
  updatePanel();
  recheck();
}

void start();
