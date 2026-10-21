// The web page: a script editor on the left, the extension's explanation panel on the right.
// The same script also runs two other pages of the site:
//  - `?view=panel` (panel mode): only the explanation panel, filled by the page around it (the compare page);
//  - compare.html (compare mode): the editor and two such frames, this copy's and another copy's.
// Everything runs here, in the browser; the script is never sent anywhere.
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { HighlightStyle, StreamLanguage, StreamParser, syntaxHighlighting } from '@codemirror/language';
import { dockerFile } from '@codemirror/legacy-modes/mode/dockerfile';
import { groovy } from '@codemirror/legacy-modes/mode/groovy';
import { json } from '@codemirror/legacy-modes/mode/javascript';
import { python } from '@codemirror/legacy-modes/mode/python';
import { yaml } from '@codemirror/legacy-modes/mode/yaml';
import { Diagnostic, forceLinting, linter, lintGutter } from '@codemirror/lint';
import { Compartment, EditorState, Prec, RangeSetBuilder, StateEffect, StateField } from '@codemirror/state';
import { Decoration, DecorationSet, drawSelection, EditorView, highlightActiveLine, highlightActiveLineGutter, keymap, lineNumbers, ViewPlugin, ViewUpdate } from '@codemirror/view';
import { tags } from '@lezer/highlight';
import { Analyzer, LineExplanation, Span } from '../src/analyzer';
import { detectShell, Shell } from '../src/dialect';
import { DocumentIssue, documentIssues, explainDocumentLine, ShellDocument, Shells } from '../src/document';
import { rerun } from '../src/examples/rerun';
import { documentHighlight, HighlightKind, HIGHLIGHT_KINDS } from '../src/highlight';
import { CLASSIC_COLOURS, Colors, paletteColour } from './editor-colors';
import { extractShell } from '../src/hosts';
import { Lang, resolveLang } from '../src/i18n';
import { changedSettings, explainOptions, forcedShell, mergeSettings, readSettings, Settings } from '../src/settings';
import { createUnbashParser } from '../src/syntax/adapters/unbash';
import { FromPanel, panelUpdate } from '../src/ui/panelView';
import { quickReference } from '../src/ui/reference';
import { toPlainMarkdown } from '../src/ui/render';
import { Kind, KINDS } from './samples';
import { narrow, setUpEdgeSwipe, setUpSheet, setUpSplitter } from './layout';
import { SettingsDialog } from './settings-dialog';

declare const __VERSION__: string;
declare const __CHANNEL__: 'release' | 'next' | 'pr';
declare const __PR__: string;
declare const __COMMIT__: string;

/** The way up from this page to the root of the site: the release at /, main at /next/, a preview at /pr/N/. */
const UP = __CHANNEL__ === 'pr' ? '../../' : __CHANNEL__ === 'next' ? '../' : '';

const TEXT = {
  en: {
    tagline: 'Explains shell scripts line by line. Move the cursor to a line to see what it does.',
    install: 'Install for VS Code',
    kind: 'File',
    lang: 'Language',
    sample: 'Load the sample',
    share: 'Copy a link to this script',
    readMode: 'Read mode: tapping the script does not open the keyboard',
    shared: 'Link copied. The script is in the part after #, which browsers do not send to the server.',
    copied: 'Copied the explanation as Markdown.',
    problems: 'Problems',
    privacy: 'Your script stays in this browser: it is parsed and explained here, with no server and no AI.',
    notices: 'Third-party notices',
    banner: 'Development version, unreleased: built from main at',
    bannerTail: 'It may differ from the released extension.',
    prBanner: 'Preview of pull request',
    prBannerTail: 'Not released.',
    toRelease: 'Released version',
    toPr: 'Pull request',
    dev: 'Development version',
    theme: 'Theme',
    themes: { auto: 'Auto', light: 'Light', dark: 'Dark' },
    version: 'Version',
    release: 'Release',
    development: 'Development (main',
    pr: 'PR',
    replace: 'Replace your script with the sample?',
    line: (n: number) => `Ln ${n}`,
    compareLink: { pr: 'Compare with main', next: 'Compare with release' },
    compareTagline: 'Compares this version with another, side by side. Type or move the cursor on the left: both panels follow.',
    editor: 'Script',
    back: 'Back to the editor',
    loading: 'Loading…',
    cannot: 'This version cannot be compared (it has no panel-only view).',
    otherNames: { release: 'Release', next: 'main' },
    kinds: { shell: 'Shell script' } as Partial<Record<Kind, string>>,
    settings: 'Settings',
    menu: 'Menu',
    close: 'Close',
    github: 'Source code on GitHub',
    resize: 'Resize the script and the explanation',
  },
  ja: {
    tagline: 'シェルスクリプトを1行ずつ解説します。知りたい行にカーソルを置いてください。',
    install: 'VS Code に入れる',
    kind: 'ファイル',
    lang: '言語',
    sample: 'サンプルを読み込む',
    share: 'このスクリプトへのリンクをコピー',
    readMode: '閲覧モード: スクリプトをタップしてもキーボードを出さない',
    shared: 'リンクをコピーしました。スクリプトは # より後ろに入っていて、ブラウザはこの部分をサーバーに送りません。',
    copied: '解説を Markdown でコピーしました。',
    problems: '問題',
    privacy: 'スクリプトはこのブラウザから出ません。構文解析も解説もこのページの中で行い、サーバーも AI も使いません。',
    notices: 'サードパーティのライセンス',
    banner: '開発版（未リリース）: main の',
    bannerTail: 'からビルドしています。リリース済みの拡張とは異なる場合があります。',
    prBanner: 'プルリクエスト',
    prBannerTail: 'のプレビュー。未リリース。',
    toRelease: 'リリース版',
    toPr: 'プルリクエスト',
    dev: '開発版',
    theme: 'テーマ',
    themes: { auto: '自動', light: 'ライト', dark: 'ダーク' },
    version: 'バージョン',
    release: 'リリース版',
    development: '開発版（main',
    pr: 'PR',
    replace: '入力中のスクリプトをサンプルに置き換えますか？',
    line: (n: number) => `${n} 行目`,
    compareLink: { pr: 'main と比較', next: 'リリース版と比較' },
    compareTagline: 'このバージョンを別のバージョンと並べて比べます。左で入力やカーソル移動をすると、2つのパネルが追従します。',
    editor: 'スクリプト',
    back: 'エディタに戻る',
    loading: '読み込み中…',
    cannot: 'このバージョンは比較できません（パネルだけの表示がありません）。',
    otherNames: { release: 'リリース版', next: 'main' },
    kinds: { shell: 'シェルスクリプト' } as Partial<Record<Kind, string>>,
    settings: '設定',
    menu: 'メニュー',
    close: '閉じる',
    github: 'GitHub のソースコード',
    resize: 'スクリプトと解説の大きさを変える',
  },
};

/** compare.html: the editor and two frames, each holding a copy of this page in panel mode. */
const compare = document.body.dataset.page === 'compare';
/** `?view=panel`: the explanation panel only. The script, the cursor and the rest come from the page around it. */
const panelOnly = !compare && new URLSearchParams(location.search).get('view') === 'panel';

/** What a copy of the page in panel mode says about itself when it is ready. */
interface CopyInfo { channel: 'release' | 'next' | 'pr'; version: string; pr: string; commit: string }
/** What the compare page sends to a copy in panel mode: everything the page would have read from its own editor. */
interface CopyState {
  text: string; kind: Kind; line: number; col: number; lang: Lang; theme: Theme; choice: { shell?: Shell; yq?: string };
  /** The settings that differ from the defaults (copies built before the settings dialog read `choice` only). */
  settings?: Record<string, unknown>;
}
/** From the compare page to a copy. */
type ToCopy = { type: 'bx-state' } & CopyState;
/** From a copy to the compare page: the handshake, then what a click in its panel asks of the editor. */
type FromCopy =
  | ({ type: 'bx-ready' } & CopyInfo)
  | { type: 'bx-reveal'; span: Span }
  | { type: 'bx-highlight'; span: Span | null }
  | { type: 'bx-choice'; key: 'shell' | 'yq'; value: string };

const THEMES = ['auto', 'light', 'dark'] as const;
type Theme = (typeof THEMES)[number];
const THEME_KEY = 'bash-explainer-theme';
/** The saved choice, read by theme-init.js before the first paint too; Auto when storage is unavailable. */
function savedTheme(): Theme {
  try {
    const v = localStorage.getItem(THEME_KEY);
    return v === 'light' || v === 'dark' ? v : 'auto';
  } catch {
    return 'auto';
  }
}
let theme: Theme = savedTheme();

// ---- Settings: those of the VS Code extension that apply here (src/settings.ts) ----------------

const SETTINGS_KEY = 'bash-explainer-settings';
/** Whether the page can keep the settings (localStorage may be unavailable or throw). */
let canSave = true;
/** The saved settings; the defaults when there are none, or no storage. */
function savedSettings(): Settings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    return mergeSettings(raw ? readSettings(JSON.parse(raw), 'saved').settings : {});
  } catch {
    canSave = false;
    return mergeSettings();
  }
}
/** In panel mode the page around sends the settings; a copy keeps none of its own. */
let settings: Settings = savedSettings();
applyColors(settings.colors);

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const kindInfo = (k: Kind) => KINDS.find((x) => x.kind === k) ?? KINDS[0];

// ---- State ----------------------------------------------------------------------------------

const shared = readHash();
let lang: Lang = shared.lang ?? resolveLang(settings.language, navigator.language);
let kind: Kind = shared.kind ?? 'shell';
/** The shell and yq of the settings, as the panel's header shows them (undefined: auto). */
const choice = () => ({ shell: forcedShell(settings), yq: settings['yq.flavor'] === 'auto' ? undefined : settings['yq.flavor'] });
const parser = createUnbashParser();
const analyzers = new Map<Lang, Analyzer>();
let parsed: { text: string; kind: Kind; doc: ShellDocument; spans?: Shading[] } | undefined;
let shown: { explanation: LineExplanation; line: number } | undefined;

const analyzer = () => analyzers.get(lang) ?? analyzers.set(lang, new Analyzer(lang)).get(lang)!;

/** The script as the explainers see it, parsed once per change. */
function shellDocument(): ShellDocument | undefined {
  const text = view.state.doc.toString();
  if (parsed && parsed.text === text && parsed.kind === kind) return parsed.doc;
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
  return { forced: forcedShell(settings), detected: detectShell(head, kindInfo(kind).fileName) };
}

// ---- Editor ---------------------------------------------------------------------------------

// The shell code is coloured from our own syntax tree (below); these modes colour the rest of a host file.
const MODES: Partial<Record<Kind, StreamParser<unknown>>> = {
  dockerfile: dockerFile, yaml, npm: json, python, jenkinsfile: groovy,
};
const languageMode = new Compartment();
/** Read mode (for touch screens): the editor says it takes no text input, so a tap places the cursor without the soft keyboard. */
const inputMode = new Compartment();
const READ_KEY = 'bash-explainer-read-mode';
let readMode = false;
try {
  readMode = localStorage.getItem(READ_KEY) === '1';
} catch {
  // Without storage the mode lasts until the page is closed.
}
const inputModeFor = (on: boolean) => EditorView.contentAttributes.of(on ? { inputmode: 'none' } : {});
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

// ---- Shell highlighting: from the tree the explanations are made from (src/highlight.ts) ----------

/** A span to colour, in editor positions. */
interface Shading { from: number; to: number; kind: HighlightKind }

/** The spans of the whole script, worked out once per parse. */
function shadings(): Shading[] {
  const doc = shellDocument()!;
  if (parsed!.spans) return parsed!.spans;
  const lines = view.state.doc;
  parsed!.spans = documentHighlight(doc).map((s) => {
    const start = lines.line(s.line + 1).from;
    return { from: start + s.from, to: start + s.to, kind: s.kind };
  });
  return parsed!.spans;
}

const marks = new Map<HighlightKind, Decoration>();
const mark = (k: HighlightKind) => marks.get(k) ?? marks.set(k, Decoration.mark({ class: `cm-bx-${k}` })).get(k)!;
/** New spans for the text the editor has now. */
const setShadings = StateEffect.define<Shading[]>();

/**
 * Marks the visible part of the script with the spans. While the text changes, the marks move with it
 * until the new spans come (debounced, as the panel is), so typing never waits for a parse.
 */
const shading = ViewPlugin.fromClass(class {
  decorations: DecorationSet;
  spans: Shading[] = [];
  /** Whether `spans` are positions in the current text. */
  current = false;
  constructor(view: EditorView) {
    this.decorations = this.build(view);
  }
  update(u: ViewUpdate): void {
    const fresh = u.transactions.flatMap((tr) => tr.effects.filter((e) => e.is(setShadings)));
    if (fresh.length) {
      // shade() sends them alone, made from the text of that moment.
      this.spans = fresh[fresh.length - 1].value as Shading[];
      this.current = true;
    } else if (u.docChanged) {
      this.current = false;
    }
    if (this.current && (fresh.length || u.viewportChanged)) this.decorations = this.build(u.view);
    else if (u.docChanged) this.decorations = this.decorations.map(u.changes);
  }
  build(view: EditorView): DecorationSet {
    const b = new RangeSetBuilder<Decoration>();
    let i = 0;
    for (const r of view.visibleRanges) {
      // The first span that ends after the start of the range.
      let lo = i, hi = this.spans.length;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (this.spans[mid].to <= r.from) lo = mid + 1;
        else hi = mid;
      }
      for (i = lo; i < this.spans.length && this.spans[i].from < r.to; i++) b.add(this.spans[i].from, this.spans[i].to, mark(this.spans[i].kind));
    }
    return b.finish();
  }
}, { decorations: (p) => p.decorations });

let shadingTimer: ReturnType<typeof setTimeout> | undefined;
/** Colours the script as it is now (the parse is shared with the panel and the problems). */
function shade(): void {
  clearTimeout(shadingTimer);
  view.dispatch({ effects: setShadings.of(shadings()) });
}

// The colours are variables on the page (`--bx-<kind>`, set by applyColors from the `colors` setting): the shell's
// kinds, and the host files' modes (Dockerfile, YAML, Makefile, …) by the kind that means the same.
const bx = (kind: string) => `var(--bx-${kind})`;
const highlightStyle = HighlightStyle.define([
  { tag: [tags.keyword, tags.controlKeyword], color: bx('keyword') },
  { tag: tags.operator, color: bx('operator') },
  { tag: [tags.string, tags.special(tags.string)], color: bx('string') },
  { tag: tags.comment, color: bx('comment'), fontStyle: 'var(--bx-comment-style)' },
  { tag: [tags.variableName, tags.special(tags.variableName), tags.definition(tags.variableName)], color: bx('variable') },
  { tag: [tags.number, tags.bool, tags.atom], color: bx('number') },
  { tag: [tags.function(tags.variableName), tags.standard(tags.variableName), tags.propertyName, tags.attributeName], color: bx('function') },
  { tag: tags.meta, color: bx('meta') },
]);

/** Sets the editor's colours from the `colors` setting: the VS Code default themes' (light and dark) or the panel's classic ones. */
function applyColors(colors: Colors): void {
  const style = document.documentElement.style;
  for (const k of HIGHLIGHT_KINDS) style.setProperty(`--bx-${k}`, paletteColour(k, colors));
  style.setProperty('--bx-meta', colors === 'classic' ? CLASSIC_COLOURS.muted : 'light-dark(#0000FF, #569CD6)');
  style.setProperty('--bx-comment-style', colors === 'classic' ? 'italic' : 'normal');
}

const shellColours = Object.fromEntries(HIGHLIGHT_KINDS.map((k) => [`.cm-bx-${k}`, { color: bx(k), ...(k === 'comment' ? { fontStyle: 'var(--bx-comment-style)' } : {}) }]));

const editorTheme = EditorView.theme({
  '&': { height: '100%', color: 'var(--vscode-editor-foreground)', backgroundColor: 'var(--vscode-editor-background)', fontSize: 'var(--vscode-editor-font-size)' },
  '.cm-scroller': { fontFamily: 'var(--vscode-editor-font-family)', lineHeight: '1.5' },
  '.cm-content': { caretColor: 'var(--vscode-editor-foreground)' },
  '.cm-gutters': { backgroundColor: 'var(--vscode-editor-background)', color: 'var(--vscode-descriptionForeground)', border: 'none' },
  // The active line is drawn over the selection layer, so its colour must let a selection on it show through.
  '.cm-activeLine': { backgroundColor: 'rgba(127, 127, 127, 0.1)' },
  '.cm-activeLineGutter': { backgroundColor: 'var(--vscode-list-hoverBackground)' },
  '&.cm-focused .cm-cursor': { borderLeftColor: 'var(--vscode-editor-foreground)' },
  '&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground': { backgroundColor: 'rgba(0, 120, 212, 0.3)' },
  '.cm-bx-highlight': { backgroundColor: 'var(--vscode-editor-findMatchHighlightBackground)', borderRadius: '2px' },
  // The shell's colours: those of VS Code's shell grammar and default themes (editor-colors.ts).
  ...shellColours,
  '.cm-tooltip': { backgroundColor: 'var(--vscode-input-background)', color: 'var(--vscode-foreground)', border: '1px solid var(--vscode-panel-border)' },
});

/** A problem's message without the ⚠ / ℹ it starts with in the explanations. */
const plain = (message: string) => message.replace(/^[⚠ℹ]\uFE0F?\s*/u, '');

/** Line and column (0-based) to a position in the editor, clamped to the document. */
function pos(state: EditorState, line: number, col: number): number {
  const l = state.doc.line(Math.max(1, Math.min(line + 1, state.doc.lines)));
  return Math.min(l.from + Math.max(0, col), l.to);
}

/** The warning codes in the script, offered in the settings dialog. */
let codesSeen: string[] = [];

const problems = linter((v): Diagnostic[] => {
  const doc = shellDocument();
  if (!doc) return [];
  // diagnostics.enabled, and diagnostics.embedded for the shell code in other files.
  const all = documentIssues(doc, lang, shells());
  codesSeen = [...new Set(all.map((i) => i.code))].sort();
  const off = !settings['diagnostics.enabled'] || (kind !== 'shell' && !settings['diagnostics.embedded']);
  const list = off ? [] : all.filter((i) => !settings['diagnostics.ignore'].includes(i.code));
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
      languageMode.of(modeFor(kind)), inputMode.of(inputModeFor(readMode)), syntaxHighlighting(highlightStyle), editorTheme,
      highlightField, Prec.highest(shading), ...(panelOnly ? [] : [problems, lintGutter()]),
      EditorView.updateListener.of((u) => {
        if (u.docChanged) {
          clearTimeout(shadingTimer);
          shadingTimer = setTimeout(shade, 100);
        }
        // In panel mode the page around sends every change as a message, which is handled at once.
        if (panelOnly || (!u.docChanged && !u.selectionSet)) return;
        clearTimeout(timer);
        timer = setTimeout(updatePanel, u.docChanged ? 150 : 60);
      }),
    ],
  }),
});
shade();
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

/** The panel's own frame: none on the compare page, whose frames hold copies of this page. */
const frame = document.getElementById('panel') as HTMLIFrameElement | null;
let panelReady = false;
/** In panel mode: whether the page around has sent the script yet (until then there is nothing to explain). */
let stateReceived = false;

// The panel says 'ready' when it starts; it may have done so before this script ran.
function panelLoaded(): void {
  panelReady = true;
  // The panel's ⚙ button opens the settings dialog (it is hidden where there is none: in panel mode).
  if (!panelOnly) frame?.contentDocument?.documentElement.classList.add('bx-settings');
  toPanel({ type: 'theme', theme });
  updatePanel();
}
frame?.addEventListener('load', panelLoaded);
if (frame?.contentDocument?.readyState === 'complete' && frame.contentWindow?.location.href.endsWith('panel.html')) panelReady = true;

function toPanel(message: unknown): void {
  if (panelReady) frame?.contentWindow?.postMessage(message, location.origin);
}

/** Starts the panel again (it keeps its quick reference once loaded: needed when the language changes). */
function reloadPanel(): void {
  panelReady = false;
  if (frame) frame.src = 'panel.html';
}

function toParent(message: FromCopy): void {
  if (window.parent !== window) window.parent.postMessage(message, location.origin);
}

/** Shows the theme in the panel, and in the copies on the compare page. */
function pushTheme(): void {
  toPanel({ type: 'theme', theme });
  if (compare) sendState();
}

/** The line of the cursor changed, or the text, or the settings: the panel (or, on the compare page, both copies) follow. */
function updatePanel(): void {
  if (compare) return sendState();
  if (panelOnly && !stateReceived) return;
  const doc = shellDocument();
  if (!doc) return;
  const line = view.state.doc.lineAt(view.state.selection.main.head).number - 1;
  const s = shells();
  const explanation = explainDocumentLine(analyzer(), doc, line, lang, s, explainOptions(settings));
  shown = { explanation, line };
  toPanel(panelUpdate({
    lang, explanation, file: kindInfo(kind).fileName, line, lineText: doc.lines[line] ?? '',
    choice: choice(), detected: s.detected, placement: settings['examples.placement'], colors: settings.colors,
  }));
}

/** Focusing the editor opens the soft keyboard on a phone: do it only with a mouse or a pen. */
function focusUnlessTouch(): void {
  if (window.matchMedia('(pointer: fine)').matches) view.focus();
}

function selectSpan(span: Span): void {
  const r = spanRange(span);
  // Bring the start of the token into view, and move sideways only as far as that needs (the
  // end of a long span, as `scrollIntoView` does, could hide the start of every line).
  view.dispatch({ selection: { anchor: r.from, head: r.to }, effects: EditorView.scrollIntoView(r.from, { x: 'nearest', y: 'nearest', xMargin: 40 }) });
  focusUnlessTouch();
}

function spanRange(span: Span): { from: number; to: number } {
  return { from: pos(view.state, span.start.line, span.start.character), to: pos(view.state, span.end.line, span.end.character) };
}

window.addEventListener('message', (e) => {
  if (!frame || e.source !== frame.contentWindow || e.origin !== location.origin) return;
  const m = e.data as FromPanel;
  switch (m.type) {
    case 'ready':
      return panelLoaded();
    case 'rerun':
      return toPanel({ type: 'rerunResult', id: m.id, result: rerun(m.spec, m.input.replace(/\n$/, '').split('\n'), lang) });
    case 'reference':
      return toPanel({ type: 'reference', entries: quickReference(lang) });
    case 'override':
      // The compare page keeps the choice for both copies.
      if (panelOnly) return toParent({ type: 'bx-choice', key: m.key, value: m.value });
      // The page has one script: the choice in the panel's header is the setting.
      return setChoice(m.key, m.value);
    case 'openSettings':
      return settingsDialog?.show();
    case 'highlight':
      if (panelOnly) return toParent({ type: 'bx-highlight', span: m.span });
      view.dispatch({ effects: setHighlight.of(m.span ? spanRange(m.span) : null) });
      return;
    case 'reveal':
      if (panelOnly) return toParent({ type: 'bx-reveal', span: m.span });
      return selectSpan(m.span);
    case 'copy': {
      if (!shown) return;
      const md = toPlainMarkdown(shown.explanation, view.state.doc.line(shown.line + 1).text, `${kindInfo(kind).fileName}:${shown.line + 1}`, lang);
      void navigator.clipboard.writeText(md).then(() => status(TEXT[lang].copied));
      return;
    }
  }
});

// ---- Panel mode: the page around sends the script ---------------------------------------------

/** Takes the script, the cursor and the settings the compare page sent, and explains the line. */
function applyState(m: CopyState): void {
  const newLang: Lang = m.lang === 'ja' ? 'ja' : 'en';
  const langChanged = newLang !== lang;
  lang = newLang;
  kind = KINDS.some((k) => k.kind === m.kind) ? m.kind : 'shell';
  // The page around sends its settings; from one built before they existed, the shell and yq only.
  settings = mergeSettings(m.settings ? readSettings(m.settings, 'page').settings : { shell: m.choice?.shell ?? 'auto', 'yq.flavor': (m.choice?.yq ?? 'auto') as Settings['yq.flavor'] });
  if (m.text !== view.state.doc.toString()) view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: m.text } });
  view.dispatch({ selection: { anchor: pos(view.state, m.line, m.col) } });
  stateReceived = true;
  if (langChanged) return reloadPanel(); // panelLoaded sends the theme and explains the line
  if (m.theme !== theme) {
    theme = m.theme;
    toPanel({ type: 'theme', theme });
  }
  updatePanel();
}

if (panelOnly) {
  window.addEventListener('message', (e) => {
    const m = e.data as ToCopy | undefined;
    if (window.parent === window || e.source !== window.parent || e.origin !== location.origin || m?.type !== 'bx-state') return;
    if (THEMES.includes(m.theme)) applyState(m);
  });
}

// ---- Compare mode: two copies of this page, each showing its explanation ---------------------

/** Which copy to compare with: main from a preview, the release from main, main from the release; `?with=` decides. */
const withParam = new URLSearchParams(location.search).get('with');
const otherTarget: 'release' | 'next' = withParam === 'release' || withParam === 'next' ? withParam : __CHANNEL__ === 'next' ? 'release' : 'next';
/** How long a copy has to answer the handshake. */
const HANDSHAKE_MS = 4000;

interface Copy { column: HTMLElement; head: HTMLElement; frame: HTMLIFrameElement; note: HTMLElement; info?: CopyInfo; own: boolean }
const copies: Copy[] = compare ? [true, false].map((own) => {
  const id = own ? 'this' : 'other';
  return { own, column: $(`col-${id}`), head: $(`head-${id}`), frame: $<HTMLIFrameElement>(`frame-${id}`), note: $(`note-${id}`) };
}) : [];

function copyName(c: CopyInfo): string {
  const t = TEXT[lang];
  return c.channel === 'pr' ? `PR #${c.pr} (${c.commit})` : c.channel === 'next' ? `main (${c.commit})` : `${t.otherNames.release} v${c.version}`;
}

function showCopyHeads(): void {
  const t = TEXT[lang];
  for (const c of copies) {
    c.head.textContent = c.info ? copyName(c.info) : c.own ? t.loading : `${t.otherNames[otherTarget]}…`;
    c.note.textContent = t.cannot;
  }
}

function sendState(): void {
  const head = view.state.selection.main.head;
  const l = view.state.doc.lineAt(head);
  const m: ToCopy = {
    type: 'bx-state', text: view.state.doc.toString(), kind, line: l.number - 1, col: head - l.from, lang, theme,
    choice: choice(), settings: changedSettings(settings, 'web'),
  };
  for (const c of copies) if (c.info) c.frame.contentWindow?.postMessage(m, location.origin);
}

if (compare) {
  window.addEventListener('message', (e) => {
    const c = copies.find((x) => x.frame.contentWindow === e.source);
    if (!c || e.origin !== location.origin) return;
    const m = e.data as FromCopy;
    switch (m?.type) {
      case 'bx-ready': {
        c.info = { channel: m.channel, version: m.version, pr: m.pr, commit: m.commit };
        c.frame.hidden = false;
        c.note.hidden = true;
        showCopyHeads();
        return sendState();
      }
      case 'bx-reveal':
        return selectSpan(m.span);
      case 'bx-highlight':
        view.dispatch({ effects: setHighlight.of(m.span ? spanRange(m.span) : null) });
        return;
      case 'bx-choice':
        return setChoice(m.key, m.value);
    }
  });
  for (const c of copies) {
    c.frame.hidden = true;
    c.frame.src = c.own ? './?view=panel' : `${UP}${otherTarget === 'next' ? 'next/' : ''}?view=panel`;
  }
  showCopyHeads();
  // A copy built before panel mode existed (or a page that is not there) never answers: say so.
  setTimeout(() => {
    for (const c of copies) if (!c.info) c.note.hidden = false;
  }, HANDSHAKE_MS);
}

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
      focusUnlessTouch();
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

/** Sets the text of an element the page has (the compare page has fewer than the main page). */
function put(id: string, text: string): void {
  const el = document.getElementById(id);
  if (el) el.textContent = text;
}

/** Adds a listener to an element the page has. */
function on(id: string, type: string, fn: (e: Event) => void): void {
  document.getElementById(id)?.addEventListener(type, fn);
}

/** Goes to another page of the site with the script in the hash, in the same language and file kind. */
async function goWithScript(href: string): Promise<void> {
  const params = new URLSearchParams({ lang, kind, ...(await encodeText(view.state.doc.toString())) });
  location.href = `${href}#${params}`;
}

function applyLanguage(): void {
  const t = TEXT[lang];
  document.documentElement.lang = lang;
  put('tagline', compare ? t.compareTagline : t.tagline);
  put('install', t.install);
  put('kind-label', t.kind);
  put('lang-label', t.lang);
  put('menu-sample-label', t.sample);
  put('menu-share-label', t.share);
  put('menu-settings-label', t.settings);
  put('menu-install-label', t.install);
  put('settings-label', t.settings);
  put('drawer-title', t.menu);
  // The buttons drawn as icons say what they do to screen readers and in a tooltip.
  for (const [id, name] of [['sample', t.sample], ['share', t.share], ['readmode', t.readMode], ['settings-open', t.settings], ['menu-open', t.menu], ['menu-close', t.close], ['github', t.github], ['splitter', t.resize]]) {
    const el = document.getElementById(id);
    el?.setAttribute('aria-label', name);
    if (id !== 'splitter') el?.setAttribute('title', name);
  }
  put('privacy', t.privacy);
  put('notices', t.notices);
  put('editor-head', t.editor);
  put('back', t.back);
  if (compare) showCopyHeads();
  // The page is built from one version, so it knows its own label only: the release page the version it
  // shows, the development page its commit. The URL decides which is selected.
  put('theme-label', t.theme);
  $<HTMLSelectElement>('theme').replaceChildren(...THEMES.map((x) => new Option(t.themes[x], x, false, x === theme)));
  put('channel-label', t.version);
  $<HTMLSelectElement>('channel')?.replaceChildren(
    new Option(__CHANNEL__ === 'release' ? `${t.release} (v${__VERSION__})` : t.release, 'release', false, __CHANNEL__ === 'release'),
    new Option(__CHANNEL__ === 'next' ? `${t.development}, ${__COMMIT__})` : `${t.development})`, 'next', false, __CHANNEL__ === 'next'),
    // A preview has its own entry, the current one; the other pages do not list previews.
    ...(__CHANNEL__ === 'pr' ? [new Option(`${t.pr} #${__PR__}, ${__COMMIT__}`, 'pr', false, true)] : []),
  );
  if (!document.getElementById('channel-banner')) {
    // The compare page has no banner.
  } else if (__CHANNEL__ !== 'release') {
    const code = Object.assign(document.createElement('code'), { textContent: __COMMIT__ });
    const release = $<HTMLAnchorElement>('banner-release');
    // The pages sit at /, /next/ and /pr/N/.
    release.href = UP;
    release.textContent = t.toRelease;
    // From a preview, main is the other copy; from main, the release.
    $('banner-compare').textContent = t.compareLink[__CHANNEL__];
    if (__CHANNEL__ === 'next') {
      // Ja reads "main の abc1234 からビルドしています。": the commit sits in the middle of the sentence.
      $('banner-text').replaceChildren(t.banner + ' ', code, ' ' + t.bannerTail);
    } else {
      // En reads "Preview of pull request #12 (commit abc1234). Not released."; ja "プルリクエスト #12（コミット abc1234）のプレビュー。未リリース。"
      const open = lang === 'ja' ? '（コミット ' : ' (commit ';
      const close = lang === 'ja' ? '）' : '). ';
      $('banner-text').replaceChildren(`${t.prBanner} #${__PR__}${open}`, code, close + t.prBannerTail);
      $<HTMLAnchorElement>('banner-pr').href = `https://github.com/sf624/bash-explainer/pull/${__PR__}`;
      $('banner-pr').textContent = `${t.toPr} #${__PR__}`;
      $('banner-pr').hidden = false;
      $('banner-pr-sep').hidden = false;
    }
    $<HTMLAnchorElement>('banner-commit').href = `https://github.com/sf624/bash-explainer/commit/${__COMMIT__}`;
    $('banner-commit').textContent = __COMMIT__;
    $('channel-banner').hidden = false;
  } else {
    put('dev-link-label', t.dev);
    $('dev-link').hidden = false;
  }
  $<HTMLSelectElement>('lang').value = lang;
  $<HTMLSelectElement>('kind').replaceChildren(...KINDS.map((k) => new Option(t.kinds[k.kind] ?? k.name, k.kind, false, k.kind === kind)));
}

// The colours are CSS variables (theme.css): the attribute switches them, the editor and the panel follow.
$<HTMLSelectElement>('theme').addEventListener('change', (e) => {
  theme = (e.target as HTMLSelectElement).value as Theme;
  if (theme === 'auto') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.setAttribute('data-theme', theme);
  try {
    if (theme === 'auto') localStorage.removeItem(THEME_KEY);
    else localStorage.setItem(THEME_KEY, theme);
  } catch {
    // The choice then lasts until the page is closed.
  }
  pushTheme();
});

// The language menu is the `language` setting.
$<HTMLSelectElement>('lang').addEventListener('change', (e) => {
  changeSettings({ ...settings, language: (e.target as HTMLSelectElement).value === 'ja' ? 'ja' : 'en' });
});

/** Applies new settings, keeps them, and shows them in the toolbar, the panel and the dialog. */
function changeSettings(next: Settings): void {
  // A link's language stays until the setting itself changes.
  const languageChanged = next.language !== settings.language;
  settings = next;
  applyColors(settings.colors);
  try {
    const changed = changedSettings(settings, 'web');
    if (Object.keys(changed).length) localStorage.setItem(SETTINGS_KEY, JSON.stringify(changed));
    else localStorage.removeItem(SETTINGS_KEY);
  } catch {
    // They then last until the page is closed.
  }
  const newLang = resolveLang(settings.language, navigator.language);
  if (languageChanged && newLang !== lang) {
    lang = newLang;
    applyLanguage();
    // The panel keeps its quick reference once loaded: start it again in the new language.
    reloadPanel();
    if (compare) updatePanel();
  } else {
    updatePanel();
  }
  recheck();
}

/** The shell or yq chosen in the panel's header ('auto' clears it). */
function setChoice(key: 'shell' | 'yq', value: string): void {
  const next = { ...settings, [key === 'shell' ? 'shell' : 'yq.flavor']: value };
  // Only values the setting takes (a copy of another version may offer others).
  if (readSettings(changedSettings(next), 'panel').warnings.length) return;
  changeSettings(next);
  settingsDialog?.refresh();
}

const dialogElement = document.getElementById('settings-dialog') as HTMLDialogElement | null;
const settingsDialog = dialogElement && new SettingsDialog(dialogElement, {
  get: () => settings,
  set: changeSettings,
  lang: () => lang,
  defaults: () => mergeSettings(),
  canSave: () => canSave,
  codes: () => codesSeen,
});
function showReadMode(): void {
  // The compare page has no such button.
  document.getElementById('readmode')?.setAttribute('aria-pressed', String(readMode));
}
showReadMode();
on('readmode', 'click', () => {
  readMode = !readMode;
  view.dispatch({ effects: inputMode.reconfigure(inputModeFor(readMode)) });
  showReadMode();
  try {
    localStorage.setItem(READ_KEY, readMode ? '1' : '0');
  } catch {
    // Not kept.
  }
});
on('settings-open', 'click', () => settingsDialog?.show());
if (dialogElement) setUpSheet(dialogElement);

// ---- The menu: a sheet from the right, with what the top bar has no room for ----------------------

const drawer = document.getElementById('drawer') as HTMLDialogElement | null;
function openMenu(): void {
  if (!drawer || drawer.open || settingsDialog?.open) return;
  drawer.showModal();
}
on('menu-open', 'click', openMenu);
on('menu-close', 'click', () => drawer?.close());
if (drawer) setUpSheet(drawer);
const edge = document.getElementById('edge');
if (edge) setUpEdgeSwipe(edge, openMenu);
// The menu's items do what the top bar's buttons do, and close the menu first.
for (const [item, target] of [['menu-settings', 'settings-open'], ['menu-sample', 'sample'], ['menu-share', 'share']]) {
  on(item, 'click', () => {
    drawer?.close();
    $(target).click();
  });
}

// ---- The divider between the editor and the explanation ------------------------------------------

const splitElement = document.getElementById('split');
if (splitElement && !panelOnly) setUpSplitter(splitElement, $('splitter'), () => view.requestMeasure());
// The cursor's line stays in view when the editor's pane changes size (the phone turned, the divider moved).
narrow.addEventListener('change', () => view.dispatch({ effects: EditorView.scrollIntoView(view.state.selection.main.head, { y: 'center' }) }));

$<HTMLSelectElement>('kind').addEventListener('change', (e) => {
  const before = kindInfo(kind);
  kind = (e.target as HTMLSelectElement).value as Kind;
  view.dispatch({ effects: languageMode.reconfigure(modeFor(kind)) });
  // An untouched sample gives way to the sample of the new kind; the user's own text stays.
  const text = view.state.doc.toString();
  if (!text.trim() || text === before.sample) setText(kindInfo(kind).sample, kindInfo(kind).cursorLine);
  shade();
  updatePanel();
  recheck();
});

on('sample', 'click', () => {
  const info = kindInfo(kind);
  const text = view.state.doc.toString();
  if (text.trim() && text !== info.sample && !KINDS.some((k) => k.sample === text) && !confirm(TEXT[lang].replace)) return;
  setText(info.sample, info.cursorLine);
});

// The other version is another page: go there with the script in the hash, in the same language.
on('channel', 'change', async (e) => {
  const to = (e.target as HTMLSelectElement).value;
  if (to === __CHANNEL__) return;
  await goWithScript(`${UP}${to === 'next' ? 'next/' : ''}`);
});

// The banner's link to the compare page, and the compare page's way back, take the script along too.
for (const [id, href] of [['banner-compare', 'compare.html'], ['back', './']]) {
  on(id, 'click', (e) => {
    const m = e as MouseEvent;
    if (m.ctrlKey || m.metaKey || m.shiftKey || m.altKey) return;
    e.preventDefault();
    void goWithScript(href);
  });
}

on('share', 'click', async () => {
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
  put('version', `Bash Explainer ${__VERSION__}`);
  if (shared.deflated) {
    const text = await inflate(shared.deflated);
    if (text !== undefined) setText(text, 1);
  }
  updatePanel();
  recheck();
  // In panel mode: tell the page around that this copy is ready for a script.
  if (panelOnly) toParent({ type: 'bx-ready', channel: __CHANNEL__, version: __VERSION__, pr: __PR__, commit: __COMMIT__ });
}

void start();
