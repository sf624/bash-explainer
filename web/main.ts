// The web page: a script editor on the left, the extension's explanation panel on the right.
// The same script also runs two other pages of the site (web/mode.ts): `?view=panel`, only the explanation
// panel, filled by the page around it (the compare page); compare.html, the editor and two such frames.
// Everything runs here, in the browser; the script is never sent anywhere.
//
// This file holds the page's state (language, file kind, settings, theme) and wires the parts together:
// web/editor.ts (the script), web/panel-bridge.ts (the panel's frame), web/compare.ts (the compare page),
// web/share.ts (links), web/storage.ts (what the browser keeps), web/layout.ts (dividers and sheets),
// web/file-io.ts (opening a file, saving to one).
import { undo } from '@codemirror/commands';
import { EditorView, ViewUpdate } from '@codemirror/view';
import { Analyzer, LineExplanation } from '../src/analyzer';
import { DocumentIssue, explainDocumentLine, ShellDocument, Shells } from '../src/document';
import { openDocument, shellsOf } from '../src/document-setup';
import { Lang, resolveLang } from '../src/i18n';
import { changedSettings, explainOptions, forcedShell, mergeSettings, readSettings, Settings } from '../src/settings';
import { detectKind } from '../src/hosts/detect';
import { createUnbashParser } from '../src/syntax/adapters/unbash';
import { lineMarks, panelUpdate } from '../src/ui/panelView';
import { toPlainMarkdown } from '../src/ui/render';
import { editorAttributes, editorHint, isPaneKey, LineAnnouncer } from './a11y';
import { CHANNEL, COMMIT, PR, UP, VERSION } from './build-info';
import { Compare, receiveState, toParent } from './compare';
import { $, on, put } from './dom';
import { Editor } from './editor';
import { drawIcons } from './icons';
import { ChosenFile, chooseFile, decodeText, defaultName, fileContent, FileFormat, isMac, kindForFile, MAX_BYTES, PLAIN, saveText, withEol } from './file-io';
import { ask, askReplaceWithSample } from './kind-dialog';
import { closeSheet, narrow, reopenSheet, setUpEdgeSwipe, setUpProblems, setUpSheet, setUpSplitter } from './layout';
import { mode } from './mode';
import { PanelBridge } from './panel-bridge';
import { Picker } from './picker';
import { nextProblem, showPosition, showProblems } from './problem-list';
import { BottomSheet, closePopovers, fitSelect, popover, setUpTooltips } from './chrome';
import { CHROME } from './chrome-text';
import { CopyState, Theme, THEMES } from './protocol';
import { Kind, KINDS } from './samples';
import { openingReady } from './opening';
import { SettingsDialog } from './settings-dialog';
import { takeLinkFromAddress, inflate, readHash, scriptParams } from './share';
import { clearStoredData, readStored, removeStored, STORAGE_KEYS, writeStored } from './storage';
import { TEXT } from './text';

// The icons the page shares with the VS Code panel (web/icons.ts).
drawIcons();

/** The saved choice, read by theme-init.js before the first paint too; Auto when storage is unavailable. */
function savedTheme(): Theme {
  const v = readStored(STORAGE_KEYS.theme);
  return v === 'light' || v === 'dark' ? v : 'auto';
}
let theme: Theme = savedTheme();

// ---- Settings: those of the VS Code extension that apply here (src/settings.ts) ----------------

/** Whether the page can keep the settings (localStorage may be unavailable or throw). */
let canSave = true;
/** The saved settings; the defaults when there are none, or no storage. */
function savedSettings(): Settings {
  const raw = readStored(STORAGE_KEYS.settings);
  if (raw === undefined) {
    canSave = false;
    return mergeSettings();
  }
  try {
    return mergeSettings(raw ? readSettings(JSON.parse(raw), 'saved').settings : {});
  } catch {
    canSave = false;
    return mergeSettings();
  }
}
/** In panel mode the page around sends the settings; a copy keeps none of its own. */
let settings: Settings = savedSettings();

const kindInfo = (k: Kind) => KINDS.find((x) => x.kind === k) ?? KINDS[0];

// ---- State ----------------------------------------------------------------------------------

const shared = readHash();
let lang: Lang = shared.lang ?? resolveLang(settings.language, navigator.language);
let kind: Kind = shared.kind ?? 'shell';
/** What the file kind's button shows on a narrow screen, where the whole name has no room. */
const SHORT_KIND: Record<Kind, string> = { shell: 'sh', dockerfile: 'Docker', makefile: 'make', yaml: 'YAML', npm: 'npm', markdown: 'md', python: 'py', jenkinsfile: 'Jenkins', bats: 'bats' };
const kindButton = document.getElementById('kind');
const kindList = document.getElementById('kind-list');
/** The file kind: a button with a list (the compare page has it too). */
const kindPicker = kindButton instanceof HTMLButtonElement && kindList ? new Picker(kindButton, kindList, (v) => chooseKind(v as Kind)) : undefined;
/** The shell and yq of the settings, as the panel's header shows them (undefined: auto). */
const choice = () => ({ shell: forcedShell(settings), yq: settings['yq.flavor'] === 'auto' ? undefined : settings['yq.flavor'] });
const parser = createUnbashParser();
const analyzers = new Map<Lang, Analyzer>();
let parsed: { text: string; kind: Kind; doc: ShellDocument } | undefined;
/** The file the script was opened from or last saved to: its name, and its handle where the browser gives one (a save writes to it). */
let file: { name: string; handle?: FileSystemFileHandle } | undefined;
/**
 * How that file holds its text: the editor keeps "\n" and no BOM; the file has its own line end (the explainers read it
 * too, so a CRLF file gets the `crlf` warning) and its BOM back.
 */
let format: FileFormat = PLAIN;
/** The name the user gave the script before it was ever saved or opened (the file name control, renamed inline). */
let draftName: string | undefined;
/** The name the explanations give the script: the file's, else the name given, else the kind's (`script.sh`); a name ending in `.zsh` makes it zsh. */
const fileName = () => file?.name ?? draftName ?? kindInfo(kind).fileName;
/** The name the page shows and a first save suggests: the file's, the name given, or the kind's (`script.sh`). */
const shownName = () => file?.name ?? draftName ?? untitledName(kind);
/**
 * Round 5: the name of a script never saved, as editors name one ("untitled.sh"), in muted text; a kind whose files have
 * a fixed name keeps it ("Dockerfile"). The explanations still call the script by the kind's name (`fileName`).
 */
function untitledName(k: Kind): string {
  const name = defaultName(k);
  return k === 'shell' || k === 'bats' || k === 'python' ? `untitled${name.slice(name.lastIndexOf('.'))}` : name;
}
let shown: { explanation: LineExplanation; line: number } | undefined;
/** The frame window whose scroll the phone's view row follows (round 4). */
let scrollWatched: Window | null = null;

const analyzer = () => analyzers.get(lang) ?? analyzers.set(lang, new Analyzer(lang)).get(lang)!;

/** The script as the explainers see it, parsed once per change. */
function shellDocument(): ShellDocument | undefined {
  const text = withEol(editor.text, format.eol);
  if (parsed && parsed.text === text && parsed.kind === kind) return parsed.doc;
  const doc = openDocument(text, kind, (shellText) => parser.parse(shellText));
  parsed = { text, kind, doc };
  return doc;
}

function shells(): Shells {
  const doc = editor.view.state.doc;
  const lines = Array.from({ length: Math.min(50, doc.lines) }, (_, i) => doc.line(i + 1).text);
  return shellsOf(lines, fileName(), forcedShell(settings));
}

// ---- Editor ---------------------------------------------------------------------------------

/** Read mode (a tap selects a line, no keyboard): on by default on a touch screen (prototype). */
const touchOnly = () => window.matchMedia('(pointer: coarse) and (hover: none)').matches;
const readModeDefault = () => (readStored(STORAGE_KEYS.readMode) ?? (touchOnly() ? '1' : '0')) === '1';
let readMode = readModeDefault();
/** The warning codes in the script, offered in the settings dialog. */
let codesSeen: string[] = [];
/** The problems the editor shows, for the panel's squiggles. */
let problemsShown: DocumentIssue[] = [];
/** Whether the sample button is replacing the text, so that the offer to undo it stays. */
let loadingSample = false;
/** Whether the toast offers to undo the sample. */
let undoOffered = false;
let timer: ReturnType<typeof setTimeout> | undefined;
/** The live region that says what the line the cursor moved to is about (the editor page only). */
let announcer: LineAnnouncer | undefined;

const editor = new Editor({
  kind: () => kind,
  lang: () => lang,
  settings: () => settings,
  document: shellDocument,
  shells,
  explainer() {
    const doc = shellDocument();
    if (!doc) return undefined;
    const s = shells();
    const opts = explainOptions(settings);
    return (line) => explainDocumentLine(analyzer(), doc, line, lang, s, opts);
  },
  problems(list, codes) {
    codesSeen = codes;
    problemsShown = list;
    updatePanel();
    showProblems(list, lang, (i) => {
      editor.select(i.startLine, i.startCol, i.endLine, i.endCol);
      if (narrow.matches) {
        showTab('explain');
        lineToUpperThird();
      }
    });
    showProblemPosition();
  },
  changed(u: ViewUpdate) {
    // Undo would no longer undo the sample once the text changed again.
    if (u.docChanged && (undoOffered || toastUntilEdit) && !loadingSample) status('');
    if (u.docChanged && !mode.panel) detectPasted(u);
    if (u.docChanged && !mode.panel && !mode.compare) cursorAfterPaste(u);
    if (u.docChanged) {
      showFileSoon();
      showEmptyEditor();
    }
    if (u.selectionSet || u.docChanged) queueMicrotask(showProblemPosition);
    // In panel mode the page around sends every change as a message, which is handled at once.
    if (mode.panel || (!u.docChanged && !u.selectionSet)) return;
    clearTimeout(timer);
    timer = setTimeout(updatePanel, u.docChanged ? 150 : 60);
  },
  openSettings: () => settingsDialog?.show(),
  hideHover: () => hideHover(),
  announce: (text) => announcer?.say(text),
}, { parent: $('editor'), text: shared.text ?? kindInfo(kind).sample, readMode, problems: mode.hasChrome });
editor.shade();
editor.setWrap(wrapOn());
editor.placeCursor(shared.text ? 1 : kindInfo(kind).cursorLine);
{
  const region = document.getElementById('announce');
  if (region) announcer = new LineAnnouncer(region, editor.view);
  const hint = document.getElementById('editor-hint');
  if (hint) editorHint(editor.view, hint);
  // The empty editor's block lies over the editor itself, centred in it.
  const empty = document.getElementById('empty-editor');
  if (empty) $('editor').append(empty);
}

// ---- Panel ----------------------------------------------------------------------------------

/** In panel mode: whether the page around has sent the script yet (until then there is nothing to explain). */
let stateReceived = false;
/** The compare page's two frames (compare mode only). */
let compareView: Compare | undefined;

/** The panel's own frame: none on the compare page, whose frames hold copies of this page. */
const panel = new PanelBridge({
  lang: () => lang,
  theme: () => theme,
  update: updatePanel,
  copy: copyMarkdown,
  choose: setChoice,
  // The compare page keeps the choice for both copies; the page has one script: the choice in the panel's header is the setting.
  override: mode.panel ? (key, value) => toParent({ type: 'bx-choice', key, value }) : setChoice,
  openSettings: () => settingsDialog?.show(),
  reveal: mode.panel ? (span, preserveFocus) => toParent({ type: 'bx-reveal', span, preserveFocus }) : (span, preserveFocus) => editor.selectSpan(span, preserveFocus),
  highlight: mode.panel ? (span) => toParent({ type: 'bx-highlight', span }) : (span) => editor.highlight(span),
}, document.getElementById('panel') as HTMLIFrameElement | null, mode.hasChrome);

/** Shows the theme in the panel, and in the copies on the compare page. */
function pushTheme(): void {
  panel.send({ type: 'theme', theme });
  compareView?.sendState();
}

/** The line of the cursor changed, or the text, or the settings: the panel (or, on the compare page, both copies) follow. */
function updatePanel(): void {
  if (compareView) return compareView.sendState();
  if (mode.panel && !stateReceived) return;
  const doc = shellDocument();
  if (!doc) return;
  const line = editor.cursorLine();
  const s = shells();
  const explanation = explainDocumentLine(analyzer(), doc, line, lang, s, { ...explainOptions(settings), reading: panel.view() === 'tree' });
  shown = { explanation, line };
  announcer?.shown(explanation, line, lang);
  queueMicrotask(showScope);
  const message = panelUpdate({
    lang, explanation, file: fileName(), line, lineText: doc.lines[line] ?? '',
    choice: choice(), detected: s.detected, placement: settings['examples.placement'],
    animations: settings['panel.animations'], marks: lineMarks(problemsShown, line), web: true,
  });
  // An empty script: the panel says where to start instead of "Nothing to explain on this line" over an empty line box.
  const blank = !mode.compare && !mode.panel && !editor.text.trim();
  if (blank) message.emptyMessage = narrow.matches ? CHROME[lang].panelEmptyPhone : CHROME[lang].panelEmpty;
  panel.show(message);
  fitPickers();
  panel.markLine(blank ? undefined : TEXT[lang].line(line + 1));
  followFrameScroll();
  // The phone's tab says which line it explains ("Explanation · Ln 8").
  put('tab-explain-line', blank ? '' : ` · ${CHROME[lang].lineTab(line + 1)}`);
  document.getElementById('tab-explain')?.setAttribute('aria-label', blank ? CHROME[lang].explain : CHROME[lang].lineTabLabel(line + 1));
  queueMicrotask(fitTabs);
  document.getElementById('panel-col')?.classList.toggle('blank', blank);
  if (blank) queueMicrotask(alignEmpty);
  markSheet();
}

function copyMarkdown(): void {
  if (!shown) return;
  const md = toPlainMarkdown(shown.explanation, editor.view.state.doc.line(shown.line + 1).text, `${fileName()}:${shown.line + 1}`, lang);
  void navigator.clipboard.writeText(md).then(() => status(TEXT[lang].copied));
}

// ---- Panel mode: the page around sends the script ---------------------------------------------

/** Takes the script, the cursor and the settings the compare page sent, and explains the line. */
function applyCopyState(m: CopyState): void {
  const newLang: Lang = m.lang === 'ja' ? 'ja' : 'en';
  const langChanged = newLang !== lang;
  lang = newLang;
  kind = KINDS.some((k) => k.kind === m.kind) ? m.kind : 'shell';
  // The page around sends its settings; from one built before they existed, the shell and yq only.
  settings = mergeSettings(m.settings ? readSettings(m.settings, 'page').settings : { shell: m.choice?.shell ?? 'auto', 'yq.flavor': (m.choice?.yq ?? 'auto') as Settings['yq.flavor'] });
  editor.replaceText(m.text);
  editor.setCursor(m.line, m.col);
  stateReceived = true;
  if (langChanged) return panel.reload(); // the panel's `loaded` sends the theme and explains the line
  if (m.theme !== theme) {
    theme = m.theme;
    panel.send({ type: 'theme', theme });
  }
  updatePanel();
}

if (mode.panel) receiveState(applyCopyState);

// ---- Compare mode: two copies of this page, each showing its explanation ---------------------

if (mode.compare) {
  compareView = new Compare({
    lang: () => lang,
    state() {
      const { line, col } = editor.cursor();
      return { text: editor.text, kind, line, col, lang, theme, choice: choice(), settings: changedSettings(settings, 'web') };
    },
    reveal: (span, preserveFocus) => editor.selectSpan(span, preserveFocus),
    highlight: (span) => editor.highlight(span),
    choose: setChoice,
  });
}

// ---- Toolbar --------------------------------------------------------------------------------

let statusTimer: ReturnType<typeof setTimeout> | undefined;
/** A toast's button; `untilEdit`: it undoes an edit, so the next edit hides it (the sample's Undo). */
interface StatusAction { label: string; run: () => void; untilEdit?: boolean }
/**
 * Round 5: `untilEdit`: the next edit dismisses the toast ("Opened a.sh."); `detail`: a longer text, behind a button
 * (`detailLabel`, "More" by default) that shows it in a bubble over the toast. The toast itself is always one line.
 */
interface StatusOpts { untilEdit?: boolean; detail?: string; detailLabel?: string }
/** Round 4: a toast that the next edit dismisses ("Opened a.sh."). */
let toastUntilEdit = false;
function status(text: string, sticky = false, action?: StatusAction, opts: StatusOpts = {}): void {
  const el = $('status');
  undoOffered = false;
  toastUntilEdit = !!(text && opts.untilEdit);
  const bubble = document.getElementById('status-detail');
  if (bubble) bubble.hidden = true;
  el.replaceChildren(...(text ? [Object.assign(document.createElement('span'), { className: 'status-text', textContent: text })] : []));
  if (text && action) {
    // A toast with one button (the sample's or the detected kind's "Undo"); it hides when the button runs.
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'status-action';
    button.textContent = action.label;
    button.addEventListener('click', () => {
      action.run();
      status('');
    });
    el.append(button);
    undoOffered = action.untilEdit === true;
  }
  if (text && opts.detail && bubble && !mode.compare && !mode.panel) {
    // Round 5: the longer text behind "More" ("Why?"), in a bubble over the toast; the toast stays while it shows.
    const more = Object.assign(document.createElement('button'), { type: 'button', className: 'status-action status-more', textContent: opts.detailLabel ?? CHROME[lang].moreText });
    more.setAttribute('aria-expanded', 'false');
    more.setAttribute('aria-controls', 'status-detail');
    more.addEventListener('click', () => {
      bubble.textContent = opts.detail!;
      bubble.hidden = !bubble.hidden;
      more.setAttribute('aria-expanded', String(!bubble.hidden));
      clearTimeout(statusTimer);
      toastLeft = 0;
      placeToast();
    });
    el.append(more);
  }
  if (text && !mode.compare && !mode.panel) {
    // Round 4: every toast can be dismissed (✕), in the same row.
    const x = Object.assign(document.createElement('button'), { type: 'button', className: 'status-close' });
    x.innerHTML = '<svg aria-hidden="true"><use href="#i-close"/></svg>';
    x.setAttribute('aria-label', CHROME[lang].dismiss);
    x.addEventListener('click', () => status(''));
    el.append(x);
  }
  clearTimeout(statusTimer);
  toastLeft = 0;
  toastHeld = false;
  // Round 6: a toast with nothing to press goes after 4 s; one with a button (Undo, More, Why?) after 8 s. The time
  // stops while the pointer is over the toast or the focus in it (armToast, and the listeners below).
  if (!sticky && text) armToast(action || opts.detail ? 8000 : 4000);
  // Round 5: one line. A text too long for it keeps its first sentence; the rest goes behind "More".
  if (text && !opts.detail && !mode.compare && !mode.panel) {
    placeToast();
    const span = el.querySelector<HTMLElement>('.status-text');
    if (span && span.scrollWidth > span.clientWidth + 1) {
      const [head, rest] = splitToast(text);
      return status(head, sticky, action, { ...opts, detail: rest });
    }
  }
}

/** Round 6: the toast's time left (ms; 0: none running) and when it was started. */
let toastLeft = 0;
let toastSince = 0;
let toastHeld = false;
function armToast(ms: number): void {
  clearTimeout(statusTimer);
  toastHeld = false;
  toastLeft = ms;
  toastSince = Date.now();
  statusTimer = setTimeout(() => status(''), ms);
}
/** The toast's time stops while it is pointed at or focused, and goes on (at least 2 s more) when neither is. */
function holdToast(hold: boolean): void {
  const el = document.getElementById('status');
  if (!el || !toastLeft) return;
  if (hold) {
    if (toastHeld) return;
    clearTimeout(statusTimer);
    toastHeld = true;
    toastLeft = Math.max(1, toastLeft - (Date.now() - toastSince));
    return;
  }
  if (!toastHeld || el.matches(':hover') || el.contains(document.activeElement)) return;
  toastHeld = false;
  armToast(Math.max(2000, toastLeft));
}
{
  const el = document.getElementById('status');
  el?.addEventListener('pointerenter', () => holdToast(true));
  el?.addEventListener('focusin', () => holdToast(true));
  el?.addEventListener('pointerleave', () => setTimeout(() => holdToast(false), 0));
  el?.addEventListener('focusout', () => setTimeout(() => holdToast(false), 0));
}

/** A toast's text in two: its first sentence (or what comes before ": "), and the rest; the whole text twice when it has no such break. */
function splitToast(text: string): [string, string] {
  const ja = /^(.+?。)(.+)$/su.exec(text);
  if (lang === 'ja' && ja) return [ja[1], ja[2]];
  const sentence = /^(.+?\.)\s+(.+)$/su.exec(text);
  if (sentence) return [sentence[1], sentence[2]];
  const colon = /^(.+?):\s+(.+)$/su.exec(text);
  if (colon) return [`${colon[1]}.`, colon[2].charAt(0).toUpperCase() + colon[2].slice(1)];
  return [text, text];
}

/** Goes to another page of the site with the script in the hash, in the same language and file kind. */
async function goWithScript(href: string): Promise<void> {
  const params = await scriptParams(lang, kind, editor.text);
  location.href = `${href}#${params}`;
}

function applyLanguage(): void {
  const t = TEXT[lang];
  document.documentElement.lang = lang;
  put('tagline', mode.compare ? t.compareTagline : t.tagline);
  put('install', t.install);
  chromeLanguage();
  put('lang-label', t.lang);
  put('menu-sample-label', t.sample);
  put('menu-open-label', CHROME[lang].open);
  put('menu-save-label', t.save);
  put('editor-hint', t.editorHint);
  editor.setLabels(editorAttributes(lang));
  put('menu-open-key', shortcut('O'));
  put('menu-save-key', shortcut('S'));
  document.getElementById('menu-open-file')?.setAttribute('title', t.openTip);
  document.getElementById('menu-save')?.setAttribute('title', t.saveTip);
  put('drop-title', t.dropTitle);
  put('drop-note', t.dropNote);
  showFile();
  put('menu-share-label', t.share);
  put('menu-install-label', t.install);
  put('settings-label', t.settings);
  // (Round 5: the menu is titled with the product's name; the script's name is its first row.)
  panel.showActions();
  // The buttons drawn as icons say what they do to screen readers and in a tooltip.
  for (const [id, name] of [['settings-open', t.settings], ['menu-open', t.menu], ['menu-close', t.close], ['github', t.github], ['splitter', t.resize], ['problems-resize', t.resizeProblems]]) {
    const el = document.getElementById(id);
    el?.setAttribute('aria-label', name);
    if (!id.endsWith('resize') && id !== 'splitter') el?.setAttribute('title', name);
  }
  put('privacy', t.privacy);
  put('notices', t.notices);
  put('editor-head', t.editor);
  put('back', t.back);
  compareView?.showHeads();
  // The page is built from one version, so it knows its own label only: the release page the version it
  // shows, the development page its commit. The URL decides which is selected.
  put('theme-label', t.theme);
  $<HTMLSelectElement>('theme').replaceChildren(...THEMES.map((x) => new Option(t.themes[x], x, false, x === theme)));
  // The release page has no version switch (the build leaves it out); the development and preview pages do.
  put('channel-label', t.version);
  $<HTMLSelectElement>('channel')?.replaceChildren(
    new Option(t.release, 'release', false, false),
    new Option(CHANNEL === 'next' ? `${t.development}, ${COMMIT})` : `${t.development})`, 'next', false, CHANNEL === 'next'),
    // A preview has its own entry, the current one; the other pages do not list previews.
    ...(CHANNEL === 'pr' ? [new Option(`${t.pr} #${PR}, ${COMMIT}`, 'pr', false, true)] : []),
  );
  if (!document.getElementById('channel-banner')) {
    // The compare page has no banner.
  } else if (CHANNEL !== 'release') {
    const code = Object.assign(document.createElement('code'), { textContent: COMMIT });
    const release = $<HTMLAnchorElement>('banner-release');
    // The pages sit at /, /next/ and /pr/N/.
    release.href = UP;
    release.textContent = t.toRelease;
    // From a preview, main is the other copy; from main, the release.
    $('banner-compare').textContent = t.compareLink[CHANNEL];
    if (CHANNEL === 'next') {
      // Ja reads "main の abc1234 からビルドしています。": the commit sits in the middle of the sentence.
      $('banner-text').replaceChildren(t.banner + ' ', code, ' ' + t.bannerTail);
    } else {
      // En reads "Preview of pull request #12 (commit abc1234). Not released."; ja "プルリクエスト #12（コミット abc1234）のプレビュー。未リリース。"
      const open = lang === 'ja' ? '（コミット ' : ' (commit ';
      const close = lang === 'ja' ? '）' : '). ';
      $('banner-text').replaceChildren(`${t.prBanner} #${PR}${open}`, code, close + t.prBannerTail);
      $<HTMLAnchorElement>('banner-pr').href = `https://github.com/sf624/bash-explainer/pull/${PR}`;
      $('banner-pr').textContent = `${t.toPr} #${PR}`;
      $('banner-pr').hidden = false;
      $('banner-pr-sep').hidden = false;
    }
    $<HTMLAnchorElement>('banner-commit').href = `https://github.com/sf624/bash-explainer/commit/${COMMIT}`;
    $('banner-commit').textContent = COMMIT;
    $('channel-banner').hidden = false;
  }
  $<HTMLSelectElement>('lang').value = mode.compare ? lang : settings.language === 'auto' ? 'auto' : lang;
  kindPicker?.set(KINDS.map((k) => ({ value: k.kind, name: t.kinds[k.kind] ?? k.name, short: SHORT_KIND[k.kind] })), kind, mode.compare ? t.kind : CHROME[lang].fileType);
  const scopeKind = document.getElementById('scope-kind') as HTMLSelectElement | null;
  if (scopeKind) {
    scopeKind.replaceChildren(...KINDS.map((k) => new Option(t.kinds[k.kind] ?? k.name, k.kind)));
    scopeKind.value = kind;
  }
  showScope();
  // The same choice as a select in the menu, for a phone.
  const menuKind = document.getElementById('kind-menu') as HTMLSelectElement | null;
  if (menuKind) {
    menuKind.replaceChildren(...KINDS.map((k) => new Option(t.kinds[k.kind] ?? k.name, k.kind)));
    menuKind.value = kind;
    menuKind.setAttribute('aria-label', t.kind);
    put('kind-label', CHROME[lang].kind);
  }
}

// The colours are CSS variables (theme.css): the attribute switches them, the editor and the panel follow.
function setTheme(next: Theme): void {
  theme = next;
  $<HTMLSelectElement>('theme').value = theme;
  if (theme === 'auto') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.setAttribute('data-theme', theme);
  // When storage refuses, the choice lasts until the page is closed.
  if (theme === 'auto') removeStored(STORAGE_KEYS.theme);
  else writeStored(STORAGE_KEYS.theme, theme);
  pushTheme();
  settingsDialog?.refresh();
  showLook();
}
$<HTMLSelectElement>('theme').addEventListener('change', (e) => setTheme((e.target as HTMLSelectElement).value as Theme));

// The language menu is the `language` setting.
$<HTMLSelectElement>('lang').addEventListener('change', (e) => {
  const v = (e.target as HTMLSelectElement).value;
  changeSettings({ ...settings, language: v === 'ja' ? 'ja' : v === 'auto' && !mode.compare ? 'auto' : 'en' });
});

/** Applies new settings, keeps them, and shows them in the toolbar, the panel and the dialog. */
function changeSettings(next: Settings): void {
  // A link's language stays until the setting itself changes.
  const languageChanged = next.language !== settings.language;
  settings = next;
  editor.setWrap(wrapOn());
  // When storage refuses, they last until the page is closed.
  const changed = changedSettings(settings, 'web');
  if (Object.keys(changed).length) writeStored(STORAGE_KEYS.settings, JSON.stringify(changed));
  else removeStored(STORAGE_KEYS.settings);
  const newLang = resolveLang(settings.language, navigator.language);
  if (languageChanged && newLang !== lang) {
    lang = newLang;
    applyLanguage();
    // The panel keeps its quick reference once loaded: start it again in the new language.
    panel.reload();
    if (mode.compare) updatePanel();
  } else {
    updatePanel();
  }
  // (The shell setting changes what a command name runs, and its colour.)
  editor.shade();
  editor.recheck();
  showLook();
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
  clearAll: clearEverything,
  theme: () => theme,
  setTheme,
});

/**
 * Removes everything the page keeps in the browser and shows the defaults at once: the settings, the
 * theme, read mode, the size of the panes and the first-run tip (again, on a touch screen).
 */
function clearEverything(): void {
  clearStoredData();
  changeSettings(mergeSettings());
  theme = 'auto';
  document.documentElement.removeAttribute('data-theme');
  $<HTMLSelectElement>('theme').value = 'auto';
  pushTheme();
  readMode = readModeDefault();
  editor.setReadMode(readMode);
  showReadMode();
  resetSplit?.();
  resetProblems?.();
  showFirstHint();
}
/** The phone's mode switch, two segments [Read | Edit]: the one pressed is the mode the editor is in. */
function showReadMode(): void {
  const c = CHROME[lang];
  for (const [id, on, tip] of [['mode-read', readMode, c.readTip], ['mode-edit', !readMode, c.editTip]] as const) {
    const b = document.getElementById(id);
    if (!b) continue; // the compare page has no such switch
    b.setAttribute('aria-pressed', String(on));
    b.title = tip;
  }
  // Round 5: the accent line under the editor's header shows the focus in Edit mode only (web/page.css).
  document.documentElement.classList.toggle('read-mode', readMode);
  put('mode-read-label', c.read);
  put('mode-edit-label', c.edit);
  document.getElementById('modes')?.setAttribute('aria-label', c.modes);
}
showReadMode();
/**
 * Read or Edit. Never moves the cursor (Editor.setReadMode keeps it and the scroll); Edit gives the editor the focus,
 * unless `focus` is false (round 5: "Use my own script" switches to Edit without opening the keyboard).
 */
function setReadModeTo(on: boolean, focus = true): void {
  if (on !== readMode) {
    readMode = on;
    editor.setReadMode(readMode);
    writeStored(STORAGE_KEYS.readMode, readMode ? '1' : '0');
  }
  showReadMode();
  // Edit brings the keyboard: the editor takes the focus, with its cursor where it was (read mode leaves the focus where it is).
  if (!readMode && focus) {
    const selection = editor.view.state.selection;
    editor.view.focus();
    if (!editor.view.state.selection.eq(selection)) editor.view.dispatch({ selection });
  }
}
on('mode-read', 'click', () => setReadModeTo(true));
on('mode-edit', 'click', () => setReadModeTo(false));

// A one-line hint over the editor on the first visit, while the editor holds the sample (it pushes the code down, it
// covers none), until it is closed or acted on. Its buttons put the user's own script in place of the sample.
function showFirstHint(): void {
  const hint = document.getElementById('first-hint');
  if (!hint || mode.compare) return;
  const show = readStored(STORAGE_KEYS.firstHint) !== '1' && KINDS.some((k) => k.sample === editor.text);
  if (hint.hidden === !show) return;
  hint.hidden = !show;
  editor.view.requestMeasure();
}
function closeFirstHint(): void {
  writeStored(STORAGE_KEYS.firstHint, '1');
  showFirstHint();
}
on('first-hint-close', 'click', closeFirstHint);
on('hint-paste', 'click', () => {
  closeFirstHint();
  // On a phone the editor goes to Edit first, without the focus (round 5): the keyboard opens only when the Paste button
  // or a tap on the editor asks for it, so that the block and the sheet stay in view.
  if (narrow.matches) setReadModeTo(false, false);
  clearEditor();
  if (!touchOnly()) editor.view.focus();
});
on('hint-open', 'click', () => {
  closeFirstHint();
  void openFile();
});

function openSettings(): void {
  if (dialogElement && reopenSheet(dialogElement)) return;
  if (settingsDialog?.open || drawer?.open) return;
  settingsDialog?.show();
}
on('settings-open', 'click', () => settingsDialog?.show());
if (dialogElement) setUpSheet(dialogElement);

// ---- The menu: a sheet from the right, with what the top bar has no room for ----------------------

const drawer = document.getElementById('drawer') as HTMLDialogElement | null;
function openMenu(): void {
  if (!drawer || settingsDialog?.open) return;
  if (reopenSheet(drawer) || drawer.open) return;
  drawer.showModal();
}
on('menu-open', 'click', openMenu);
on('menu-close', 'click', () => drawer && closeSheet(drawer));
if (drawer) setUpSheet(drawer, 'left');
const edge = document.getElementById('edge');
if (edge) setUpEdgeSwipe(edge, openMenu, 'left');
const edgeRight = document.getElementById('edge-right');
if (edgeRight) setUpEdgeSwipe(edgeRight, openSettings, 'right');
// The menu's items do what the top bar's buttons do, and close the menu first.
on('menu-settings', 'click', () => {
  drawer?.close();
  settingsDialog?.show();
});
for (const [item, target] of [['menu-sample', 'sample'], ['menu-share', 'share'], ['menu-clear', 'clear'], ['menu-copy-script', 'copy-script']]) {
  on(item, 'click', () => {
    drawer?.close();
    $(target).click();
  });
}

// ---- The divider between the editor and the explanation ------------------------------------------

const splitElement = document.getElementById('split');
const resetSplit = splitElement && mode.hasChrome ? setUpSplitter(splitElement, $('splitter'), () => editor.view.requestMeasure()) : undefined;
const resetProblems = splitElement && mode.hasChrome
  ? setUpProblems($('source'), $('problems'), $('problems-resize'), $('problems-toggle'), () => editor.view.requestMeasure())
  : undefined;
// The cursor's line stays in view when the editor's pane changes size (the phone turned, the divider moved).
narrow.addEventListener('change', () => {
  closePopovers();
  panel.markPhone();
  editor.setWrap(wrapOn());
  editor.keepCursorInView();
});

on('scope-kind', 'change', (e) => {
  chooseKind((e.target as HTMLSelectElement).value as Kind);
});
on('kind-menu', 'change', (e) => {
  chooseKind((e.target as HTMLSelectElement).value as Kind);
});

/**
 * Whether the editor holds no text of the user's: nothing, or a sample exactly as the page loads it. Read from
 * the text itself rather than from a record of edits, so that it also holds after an undo back to a sample.
 */
const untouched = (text: string) => !text.trim() || KINDS.some((k) => k.sample === text);
/** Whether the editor holds the user's own text: a file's (even an empty one), or text that is no sample. */
const ownText = () => file !== undefined || !untouched(editor.text);

function chooseKind(k: Kind): void {
  // A sample, or nothing, gives way to the new kind's sample; whether the user's own text does is theirs to say.
  const own = ownText();
  setKind(k, () => {
    if (!own) loadSample(false);
  });
  if (own) askAboutSample(k);
}

/** Makes `k` the file kind, with the text as it is (`then` may change it before the script is explained again). */
function setKind(k: Kind, then?: () => void): void {
  kind = k;
  const menuKind = document.getElementById('kind-menu') as HTMLSelectElement | null;
  if (menuKind) menuKind.value = k;
  const scopeKind = document.getElementById('scope-kind') as HTMLSelectElement | null;
  if (scopeKind) scopeKind.value = k;
  kindPicker?.show(k);
  editor.setKind(kind);
  showFile();
  then?.();
  editor.shade();
  updatePanel();
  editor.recheck();
}

/**
 * A paste (or a drop) that brings a whole script decides the file kind from its content (src/hosts/detect.ts): when it
 * makes most of the text (80% or more), or the editor held only a sample or nothing. A few lines pasted into the user's
 * own script never change it. The text stays as pasted; the toast says what was detected and can undo the change of kind.
 */
function detectPasted(u: ViewUpdate): void {
  const pasted = u.transactions.filter((tr) => tr.isUserEvent('input.paste') || tr.isUserEvent('input.drop'));
  if (!pasted.length) return;
  let text = '';
  for (const tr of pasted) tr.changes.iterChanges((_fa, _ta, _fb, _tb, inserted) => { text += inserted.toString(); });
  const whole = text.trim().length >= 0.8 * u.state.doc.toString().trim().length;
  if (!whole && !untouched(u.startState.doc.toString())) return;
  const found = detectKind(text);
  if (!found || found.kind === kind) return;
  const before = kind;
  // The editor is still in its update: change its mode after it.
  queueMicrotask(() => {
    setKind(found.kind);
    const t = TEXT[lang];
    status(t.detected(t.kinds[found.kind] ?? kindInfo(found.kind).name), false, { label: t.undo, run: () => setKind(before) });
  });
}

/** Asks whether the user's text gives way to the sample of the kind just chosen (the kind has changed either way). */
function askAboutSample(k: Kind): void {
  const t = TEXT[lang];
  const name = t.kinds[k] ?? kindInfo(k).name;
  // From the menu (a phone), the menu closes first, so that the toast after the choice is not under it.
  const fromMenu = drawer?.open === true;
  if (fromMenu) drawer!.close();
  const back = fromMenu ? document.getElementById('menu-open') : document.activeElement as HTMLElement | null;
  void askReplaceWithSample({ title: t.askTitle(name), message: t.askMessage(name), replace: t.askReplace, keep: t.askKeep }, back)
    .then((replace) => {
      if (replace) loadSample(true);
    });
}

/** Puts in the current kind's sample; when it replaced the user's own text, the toast offers to undo it. */
function loadSample(own: boolean): void {
  const info = kindInfo(kind);
  const before = { file, format, clean };
  loadingSample = true;
  try { editor.setText(info.sample, info.cursorLine); } finally { loadingSample = false; }
  // The sample is no file's text: a save asks where again (and never writes it into the file opened before).
  file = undefined;
  format = PLAIN;
  clean = editor.text;
  showFile();
  // Undo brings back the text, and the file it was (its name, its handle, its line ends).
  const back = () => {
    undo(editor.view);
    ({ file, format, clean } = before);
    showFile();
    editor.focusUnlessTouch();
  };
  if (own) status(CHROME[lang].sampleLoaded, false, { label: TEXT[lang].undo, run: back, untilEdit: true });
}

/**
 * Empties the editor, as one step of the history: the toast offers to undo it ("Sample cleared." when it held the sample).
 * The file stays the one opened (its text is now empty, not saved).
 */
function clearEditor(): void {
  if (!editor.text) return editor.view.focus();
  const wasSample = KINDS.some((k) => k.sample === editor.text);
  loadingSample = true;
  try { editor.clear(); } finally { loadingSample = false; }
  const back = () => {
    undo(editor.view);
    editor.focusUnlessTouch();
  };
  const c = CHROME[lang];
  status(wasSample ? c.sampleCleared : c.editorCleared, false, { label: TEXT[lang].undo, run: back, untilEdit: true });
  editor.focusUnlessTouch();
}
on('clear', 'click', clearEditor);
on('copy-script', 'click', () => {
  void navigator.clipboard.writeText(editor.text).then(() => status(CHROME[lang].scriptCopied));
});

on('sample', 'click', () => {
  // Replaced at once; the user's own text gets the toast's Undo (prototype: no confirm() before it).
  loadSample(ownText());
});

// The other version is another page: go there with the script in the hash, in the same language.
on('channel', 'change', async (e) => {
  const to = (e.target as HTMLSelectElement).value;
  if (to === CHANNEL) return;
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
  const params = await scriptParams(lang, kind, editor.text);
  const url = `${location.origin}${location.pathname}#${params}`;
  await navigator.clipboard.writeText(url);
  status(TEXT[lang].shared);
});

// ---- Files: open one into the editor, save the editor's text to one (web/file-io.ts) ----------------

/** The editor page has them; the compare page and the copies in panel mode do not. */
const withFiles = !mode.compare && !mode.panel;
/** The text as it was last opened, saved or loaded: the editor has changes not saved while it differs (`unsaved`). */
let clean = '';
/** The key of a shortcut: ⌘S on a Mac, Ctrl+S elsewhere. */
const shortcut = (key: string) => (isMac() ? `⌘${key}` : `Ctrl+${key}`);

/**
 * Whether opening a file would lose text: the editor's text differs from the one last opened, saved or loaded, and is
 * the user's own (with no file open, a sample or nothing is not). Read from the text, so that an undo back to it counts.
 */
function unsaved(): boolean {
  const text = editor.text;
  return text !== clean && (file !== undefined || !untouched(text));
}

/** The name of the file and a mark for changes not saved, as the screen shows them (the mark is said in words to a screen reader). */
function nameWithMark(name: string, dirty: boolean): Node[] {
  if (!dirty) return [document.createTextNode(name)];
  const mark = Object.assign(document.createElement('span'), { textContent: ' ●' });
  mark.setAttribute('aria-hidden', 'true');
  const said = Object.assign(document.createElement('span'), { className: 'sr-only', textContent: TEXT[lang].unsaved });
  return [document.createTextNode(name), mark, said];
}

let fileTimer: ReturnType<typeof setTimeout> | undefined;
/**
 * Shows the script's name, and whether it has changes not saved: the file name control in the editor's header (muted
 * and italic until the script is saved or opened, ● after it while unsaved), a dot on Save, the menu's header and its
 * Save, the dot on ≡ (shown on a phone only, where no name shows), and the page's title.
 */
function showFile(): void {
  if (!withFiles) return;
  clearTimeout(fileTimer);
  const dirty = unsaved();
  const c = CHROME[lang];
  const name = shownName();
  const saved = file !== undefined;
  const button = document.getElementById('file-name-btn');
  // Round 5: one model everywhere (the editor's header, the menu's first row): the name, in muted text while the script
  // was never saved or opened ("untitled.sh"; the tooltip and the label say "not saved yet"), and "●" after the name of
  // a file with changes not saved to it.
  const label = `${name}${saved ? '' : ` (${c.notSavedYet})`}${dirty && saved ? TEXT[lang].unsaved : ''}`;
  for (const [b, n, d] of [['file-name-btn', 'file-name', 'file-dot'], ['menu-file', 'menu-file-name', 'menu-file-dot']]) {
    const el = document.getElementById(b);
    if (!el) continue;
    put(n, name);
    $(d).hidden = !(dirty && saved);
    el.classList.toggle('draft', !saved);
    el.setAttribute('aria-label', b === 'menu-file' ? `${c.renameTip}: ${label}` : label);
    el.title = saved ? c.renameTip : `${c.renameTip} (${c.notSavedYet})`;
  }
  $('menu-save-name').replaceChildren(...nameWithMark(name, dirty && saved));
  const dot = document.getElementById('menu-dot');
  if (dot) dot.hidden = !(dirty && saved);
  document.getElementById('menu-open')?.setAttribute('aria-label', dirty && narrow.matches ? c.menuUnsaved : TEXT[lang].menu);
  const save = document.getElementById('save-btn');
  if (save) {
    save.title = saved ? c.saveTo(name) : c.saveAs(name);
    save.setAttribute('aria-label', `${c.save}${dirty ? TEXT[lang].unsaved : ''}`);
  }
  showFirstHint();
  queueMicrotask(fitPickers);
  document.title = saved || draftName ? `${dirty ? '● ' : ''}${name} — Bash Explainer` : 'Bash Explainer';
}

/** Gives the script another name (the file name control): the file's (a save then asks where again), or the name a first save suggests. */
function rename(next: string): void {
  const before = fileName();
  if (file) file = { name: next };
  else draftName = next;
  showFile();
  // A new name can say another shell (`.zsh`).
  if (fileName() !== before) {
    editor.shade();
    updatePanel();
    editor.recheck();
  }
}

/** The file name control: a click turns it into a field (Enter or leaving it confirms, Escape cancels). */
function setUpRename(buttonId: string, inputId: string): void {
  const button = document.getElementById(buttonId);
  const input = document.getElementById(inputId) as HTMLInputElement | null;
  if (!button || !input) return;
  const fit = () => {
    input.style.width = `${Math.min(28, Math.max(8, input.value.length + 2))}ch`;
  };
  const end = (commit: boolean) => {
    if (input.hidden) return;
    const hadFocus = document.activeElement === input;
    const value = input.value.trim().replace(/[\\/]/g, '');
    input.hidden = true;
    button.hidden = false;
    if (commit && value && value !== shownName()) rename(value);
    if (hadFocus) button.focus();
  };
  button.addEventListener('click', () => {
    input.value = shownName();
    input.setAttribute('aria-label', CHROME[lang].renameLabel);
    fit();
    button.hidden = true;
    input.hidden = false;
    input.focus();
    // The stem is selected, the extension kept.
    const dot = input.value.lastIndexOf('.');
    input.setSelectionRange(0, dot > 0 ? dot : input.value.length);
  });
  input.addEventListener('input', fit);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      end(true);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      end(false);
    }
  });
  input.addEventListener('blur', () => end(true));
}
setUpRename('file-name-btn', 'file-name-input');
setUpRename('menu-file', 'menu-file-input');

/** After an edit: the mark follows once typing rests (comparing the whole text at every key would slow a large file down). */
function showFileSoon(): void {
  if (!withFiles) return;
  clearTimeout(fileTimer);
  fileTimer = setTimeout(showFile, 150);
}

/**
 * Opens a file chosen or dropped: refuses one too large or not text, asks before it replaces changes not saved, then
 * puts its text in the editor as a new document and sets the kind from its name and content.
 */
async function openChosen({ file: chosen, handle }: ChosenFile, back: HTMLElement | null): Promise<void> {
  const t = TEXT[lang];
  if (chosen.size > MAX_BYTES) return status(t.tooLarge(chosen.name));
  let bytes: ArrayBuffer;
  try {
    bytes = await chosen.arrayBuffer();
  } catch {
    // A folder dropped, or a file changed or gone since it was chosen.
    return status(t.notRead(chosen.name));
  }
  const read = decodeText(new Uint8Array(bytes));
  if (read === 'binary') return status(t.notText(chosen.name));
  if (read === 'cr') return status(t.loneCr(chosen.name));
  if (unsaved()) {
    const discard = await ask({
      id: 'discard', title: t.discardTitle, message: t.discardMessage(chosen.name, window.matchMedia('(pointer: fine)').matches ? shortcut('S') : t.saveInMenu),
      confirm: { id: 'discard-open', text: t.discard }, cancel: { id: 'discard-cancel', text: t.cancel },
    }, back);
    if (!discard) return;
  }
  file = { name: chosen.name, handle };
  draftName = undefined;
  format = { eol: read.eol, bom: read.bom };
  editor.openText(read.text);
  clean = editor.text;
  setKind(kindForFile(chosen.name, read.text));
  // (Round 4: "Opened a.sh." goes at the first edit.)
  status(read.mixed ? t.mixedEol(chosen.name, read.eol === '\n' ? 'LF' : 'CRLF') : t.opened(chosen.name), false, undefined, { untilEdit: true });
  editor.focusUnlessTouch();
}

async function openFile(): Promise<void> {
  const back = document.activeElement as HTMLElement | null;
  let chosen: ChosenFile | undefined;
  try {
    chosen = await chooseFile($<HTMLInputElement>('open-input'));
  } catch {
    // Picked, but changed or gone before it could be read.
    return status(TEXT[lang].notRead());
  }
  if (chosen) await openChosen(chosen, back);
}

/** Saves the editor's text as the file holds it (line ends, BOM): into the file, or where the user says, or as a download. */
async function saveFile(): Promise<void> {
  const t = TEXT[lang];
  const text = editor.text;
  const before = fileName();
  const saving = file;
  const r = await saveText(fileContent(text, format), shownName(), file?.handle);
  if (r.how === 'cancelled') return;
  // Another file was opened while the browser asked (its permission bubble is not modal): that one is not the file saved.
  if (file !== saving) return r.how === 'downloaded' ? downloadedToast(r.name) : status(r.how === 'refused' ? t.notSaved(r.name) : t.saved(r.name));
  if (r.how === 'refused') {
    // The same write would fail again: the next save asks where.
    if (file) file = { name: file.name };
    return status(t.notSaved(r.name));
  }
  file = { name: r.name, handle: r.how === 'written' ? r.handle : undefined };
  clean = text;
  showFile();
  if (r.how === 'downloaded') downloadedToast(r.name);
  else status(t.saved(r.name));
  // A new name can say another shell (`.zsh`).
  if (fileName() !== before) {
    editor.shade();
    updatePanel();
    editor.recheck();
  }
}

/** "Downloaded a.sh. · Why?" (round 5: from the first save; the reason in the bubble behind "Why?"). */
function downloadedToast(name: string): void {
  const c = CHROME[lang];
  status(c.downloaded(name), false, undefined, { detail: c.whyText, detailLabel: c.why });
}

/** Ctrl+S and Ctrl+O (⌘S and ⌘O on a Mac), also with the focus in the panel's frame: the page's save and open, not the browser's. */
function fileKeys(e: KeyboardEvent): void {
  const mod = isMac() ? e.metaKey && !e.ctrlKey : e.ctrlKey && !e.metaKey;
  if (!mod || e.altKey || e.shiftKey) return;
  // The letter typed, or on a keyboard of another script the key at its place.
  const key = /^[a-z]$/i.test(e.key) ? e.key.toLowerCase() : ({ KeyS: 's', KeyO: 'o' } as Record<string, string>)[e.code];
  if (key !== 's' && key !== 'o') return;
  e.preventDefault();
  // A question or the settings are open: they come first.
  if (e.repeat || document.querySelector('dialog.ask[open], #settings-dialog[open]')) return;
  if (drawer?.open) drawer.close();
  void (key === 's' ? saveFile() : openFile());
}

/**
 * F6 (or Shift+F6) goes from the editor, or anywhere on the page, to the explanation in the panel's frame, and from the
 * frame back to the editor: as F6 moves between the parts of VS Code. `inFrame`: the key was pressed in the frame.
 */
function paneKeys(e: KeyboardEvent, inFrame: boolean): void {
  if (!isPaneKey(e) || document.querySelector('dialog[open]')) return;
  e.preventDefault();
  if (inFrame) editor.view.focus();
  else toPanel();
}

/** Puts the focus in the explanation: into the frame, then on what the panel shows (media/panel.js, `focusExplanation`). */
function toPanel(): void {
  (document.getElementById('panel') as HTMLIFrameElement | null)?.focus();
  panel.send({ type: 'focus' });
}

/** Whether a drag carries files (not text dragged from the editor or another page). */
const hasFiles = (e: DragEvent) => !!e.dataTransfer && [...e.dataTransfer.types].includes('Files');

/** Anywhere but on the editor, a file dropped would make the browser show it instead of the page: refuse it. */
function refuseDrops(w: Window): void {
  w.addEventListener('dragover', (e) => {
    if (!hasFiles(e) || e.defaultPrevented) return; // the settings take a dropped settings file
    e.preventDefault();
    e.dataTransfer!.dropEffect = 'none';
  });
  w.addEventListener('drop', (e) => {
    if (hasFiles(e)) e.preventDefault();
  });
}

if (withFiles) {
  window.addEventListener('keydown', fileKeys, true);
  window.addEventListener('keydown', (e) => paneKeys(e, false), true);
  refuseDrops(window);
  // The panel's frame is a page of its own (the same origin): its keys and drops too, each time it loads.
  const frame = document.getElementById('panel') as HTMLIFrameElement | null;
  const watchFrame = () => {
    const w = frame?.contentWindow;
    if (!w || w.location.href === 'about:blank') return;
    w.addEventListener('keydown', fileKeys, true);
    w.addEventListener('keydown', (e) => paneKeys(e, true), true);
    refuseDrops(w);
  };
  frame?.addEventListener('load', watchFrame);
  if (frame?.contentDocument?.readyState === 'complete') watchFrame();

  // Leaving the page (closing it, reloading it, another version) would lose changes not saved to the file: the browser asks.
  window.addEventListener('beforeunload', (e) => {
    if (file && unsaved()) e.preventDefault();
  });

  on('menu-open-file', 'click', () => {
    drawer?.close();
    void openFile();
  });
  on('menu-save', 'click', () => {
    drawer?.close();
    void saveFile();
  });
  on('open-btn', 'click', () => void openFile());
  on('save-btn', 'click', () => void saveFile());
  on('menu-panes', 'click', () => {
    drawer?.close();
    toPanel();
  });

  // A file dragged over the editor: the drop target shows while it is there, and a drop opens the file. Taken before
  // CodeMirror, which would put the file's text where it is dropped. The target goes when the drag leaves the editor
  // (for the page or the window) or ends; and, in case a browser misses that, a second after the last dragover
  // (browsers repeat it every 350 ms or so while the pointer rests, or only when it moves).
  const source = $('source');
  const target = $('drop-target');
  let dragTimer: ReturnType<typeof setTimeout> | undefined;
  const hideTarget = () => {
    clearTimeout(dragTimer);
    target.hidden = true;
  };
  source.addEventListener('dragover', (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer!.dropEffect = 'copy';
    target.hidden = false;
    clearTimeout(dragTimer);
    dragTimer = setTimeout(hideTarget, 1000);
  }, true);
  source.addEventListener('dragleave', (e) => {
    if (!source.contains(e.relatedTarget as Node | null)) hideTarget();
  });
  window.addEventListener('dragend', hideTarget);
  source.addEventListener('drop', (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    e.stopPropagation();
    hideTarget();
    const dropped = e.dataTransfer!.files[0];
    if (!dropped) return;
    // Chromium gives the file's handle too, so that a save writes to it; it is to be asked for during the event.
    const item = [...e.dataTransfer!.items].find((i) => i.kind === 'file') as (DataTransferItem & { getAsFileSystemHandle?(): Promise<FileSystemHandle | null> }) | undefined;
    const handle = item?.getAsFileSystemHandle?.().catch(() => null);
    const back = document.activeElement as HTMLElement | null;
    void Promise.resolve(handle).then((h) => openChosen({ file: dropped, handle: h?.kind === 'file' ? (h as FileSystemFileHandle) : undefined }, back));
  }, true);
}

// ---- The chrome prototype (proto/chrome-1): app bar, panes' headers, Problems strip, the phone's sheet --------

/**
 * Whether the editor wraps long lines: the setting, and on a phone by default (no sideways scroll on a tap) unless the
 * stored settings say otherwise.
 */
function wrapOn(): boolean {
  if (settings['editor.wrap']) return true;
  if (!narrow.matches || mode.panel) return false;
  const raw = readStored(STORAGE_KEYS.settings);
  return !(raw && raw.includes('"editor.wrap"'));
}

/** The texts of the chrome, in the page's language. */
function chromeLanguage(): void {
  const c = CHROME[lang];
  const t = TEXT[lang];
  put('share-open-label', c.share);
  put('share-label', c.copyLink);
  put('clear-label', c.clear);
  put('menu-clear-label', c.clear);
  put('copy-script-label', c.copyScript);
  put('menu-h-help', c.menuHelp);
  put('menu-keys-label', c.keys);
  // The shortcuts are open at once where there is a keyboard and a mouse; a touch screen without one has no Help group
  // (round 4: its only item was the keyboard's shortcuts).
  if (!touchOnly()) document.getElementById('menu-keys')?.setAttribute('open', '');
  const help = document.getElementById('menu-g-help');
  if (help) help.hidden = touchOnly();
  put('menu-look-label', c.look);
  showLook();
  document.getElementById('menu-keys-list')?.replaceChildren(...[...c.keyRows, c.keyHelp].flatMap(([k, what]) => [
    Object.assign(document.createElement('dt'), { textContent: k }), Object.assign(document.createElement('dd'), { textContent: what }),
  ]));
  put('scope-done', c.done);
  put('scope-help', c.autoHelp);
  // (The compare page has no empty-editor block: it keeps the placeholder.)
  editor.setPlaceholder(touchOnly() ? c.placeholderTouch : c.placeholder(shortcut('V')));
  document.getElementById('panel-tabs')?.setAttribute('aria-label', c.panelTabs);
  put('sample-label', t.sample);
  // (Round 4: the header's Open has no "…"; the menu's keeps it.)
  put('open-btn-label', c.openShort);
  put('save-btn-label', c.save);
  put('kind-prefix', c.typePrefix);
  put('shell-top-prefix', c.shellPrefix);
  put('yq-top-prefix', c.yqPrefix);
  put('scope-pop-title', c.script);
  put('scope-kind-label', c.fileType);
  put('scope-shell-label', c.shell);
  put('menu-h-script', c.menuScript);
  put('menu-h-explanation', c.menuExplanation);
  put('menu-h-prefs', c.menuPrefs);
  put('menu-h-about', c.menuAbout);
  put('menu-settings-label', c.allSettings);
  put('tab-explain-label', c.explain);
  put('tab-problems-label', c.problems);
  put('tab-ref-label', c.reference);
  document.getElementById('tab-ref')?.setAttribute('title', c.reference);
  queueMicrotask(fitTabs);
  put('first-hint-text', narrow.matches ? (touchOnly() ? c.hintPhone : c.hintClick) : c.hintDesk4);
  put('hint-paste-label', narrow.matches ? c.useOwn : c.useOwnDesk);
  // (The phone's hint has room for "Open a file" without the dots: it opens the chooser at once.)
  put('hint-open-label', narrow.matches ? c.openFileShort : c.openFile);
  const auto = document.querySelector<HTMLOptionElement>('#lang option[value="auto"]');
  if (auto) auto.textContent = c.autoBrowser;
  // Round 3: Share (three items) and the phone menu's SHARE; the empty editor; the panel header's view slot.
  put('menu-h-share', c.menuShare);
  put('menu-copy-script-label', c.copyScript);
  put('menu-copy-label', c.copyMd5);
  put('empty-paste-label', touchOnly() ? c.paste : c.pasteScript);
  put('empty-paste-key', touchOnly() ? '' : shortcut('V'));
  put('empty-open-label', c.openFile);
  put('empty-sample-label', c.loadSample);
  put('empty-drop', c.orDrop);
  document.getElementById('sheet-back')?.setAttribute('aria-label', c.showScript);
  document.getElementById('sheet-back')?.setAttribute('title', c.showScript);
  // Round 6: the full sheet's way back is labelled ("Script ⌄"); ⋯ has Rename… and Copy the script; the Shell picker.
  put('sheet-back-label', c.script);
  put('more-rename-label', c.renameMore);
  put('more-copy-script-label', c.copyScript);
  put('shell-pick-prefix', c.shellPrefix);
  for (const where of ['top', 'phone']) {
    put(`view-list-${where}`, c.viewMeaning);
    put(`view-tree-${where}`, c.viewReading);
    document.getElementById(`views-${where}`)?.setAttribute('aria-label', c.viewLabel);
  }
  // The empty editor's block says it all: CodeMirror's placeholder would say it twice.
  if (document.getElementById('empty-editor')) editor.setPlaceholder('');
  const named: [string, string, string?][] = [
    ['open-btn', `${t.openTip}`, shortcut('O')], ['save-btn', c.saveAs(shownName()), shortcut('S')], ['ed-more', c.more],
    ['problem-prev', c.prevProblem, 'Shift+F8'], ['problem-next', c.nextProblem, 'F8'], ['bsheet-handle', c.sheet],
    ['first-hint-close', c.close], ['share-open', c.share],
  ];
  for (const [id, name, key] of named) {
    const el = document.getElementById(id);
    if (!el) continue;
    if (!el.textContent?.trim() || id === 'open-btn' || id === 'save-btn') el.setAttribute('aria-label', id.endsWith('-btn') ? (id === 'open-btn' ? c.open : c.save) : name);
    el.title = name;
    if (key) {
      el.dataset.key = key;
      el.setAttribute('aria-keyshortcuts', key.replace('Ctrl', 'Control'));
    }
  }
  showReadMode();
  showProblemsToggle();
  showScope();
  showFile();
}

/** The chip that stands for the kind and the shell where the editor's header has no room for both pickers: "Shell script · bash". */
function showScope(): void {
  const chip = document.getElementById('scope-chip-text');
  if (!chip) return;
  const t = TEXT[lang];
  const c = CHROME[lang];
  const kindName = t.kinds[kind] ?? kindInfo(kind).name;
  // Round 6: always "<type> · <the shell the script is read as>": the shell chosen, or the one its #! line names
  // ("Shell script · bash", "Shell script · sh"); with neither, bash, marked "(auto)" ("Shell script · bash (auto)").
  const s = shells();
  const shellName = s.forced ?? s.detected ?? 'bash';
  const auto = !s.forced && !s.detected;
  const shellText = auto ? `${shellName}${lang === 'ja' ? '' : ' '}${c.autoMark}` : shellName;
  chip.textContent = `${kindName} · ${shellText}`;
  // A chip with no room for the type's name shows its short one: never "sh" for a shell script, which reads as the
  // shell ("Script · bash", "スクリプト · bash").
  // Where the chip shows, the file name comes first: while the name is cut (or the chip is), the header takes less room
  // in steps: the chip's short form ("Script · bash"; it leaves "(auto)" to its name and tooltip), Open and Save as
  // icons (`tight`), the shell alone in the chip ("bash"), and last, with no room for even part of the name (larger
  // text on a phone), no name: it stays in the menu's first row (`no-name`).
  const head = document.getElementById('ed-head');
  head?.classList.remove('no-name', 'tight');
  const name = document.getElementById('file-name');
  const chipShown = chip.offsetParent !== null;
  const nameCut = () => chipShown && !!name && name.offsetParent !== null && name.scrollWidth > name.clientWidth + 1;
  const fits = () => !nameCut() && chip.scrollWidth <= chip.clientWidth + 1;
  const steps = [
    () => { chip.textContent = `${kind === 'shell' ? c.script : SHORT_KIND[kind]} · ${shellName}`; },
    () => head?.classList.add('tight'),
    () => { if (kind === 'shell') chip.textContent = shellName; },
    () => {
      const box = document.getElementById('file-name-btn')?.getBoundingClientRect();
      if (box && box.width < 72) head?.classList.add('no-name');
    },
  ];
  for (const step of steps) {
    if (fits()) break;
    step();
  }
  document.getElementById('scope-chip')?.setAttribute('aria-label', `${c.script}: ${kindName} · ${shellText}`);
  document.getElementById('scope-chip')?.setAttribute('title', auto ? `${c.fileType}, ${c.shell}. ${c.autoMarkTip}` : `${c.fileType}, ${c.shell}`);
}

// The popovers: Share (app bar), ⋯ (editor's header), the kind-and-shell chip.
for (const [button, pop, pick] of [['share-open', 'share-menu', true], ['ed-more', 'ed-more-menu', true], ['scope-chip', 'scope-pop', false]] as const) {
  const b = document.getElementById(button);
  const p = document.getElementById(pop);
  const scrim = pop === 'scope-pop' ? document.getElementById('scope-scrim') ?? undefined : undefined;
  const pops = b && p ? popover(b, p, { closeOnPick: pick, scrim }) : undefined;
  if (pop === 'scope-pop') on('scope-done', 'click', () => pops?.close());
}

// The Problems strip: its button names what it does; ‹ › (and F8, Shift+F8) go to the next or previous problem.
function showProblemsToggle(): void {
  const toggle = document.getElementById('problems-toggle');
  if (!toggle) return;
  const open = toggle.getAttribute('aria-expanded') === 'true';
  toggle.title = open ? CHROME[lang].hideProblems : CHROME[lang].showProblems;
}
document.getElementById('problems-toggle')?.addEventListener('click', () => queueMicrotask(showProblemsToggle));
function goProblem(back: boolean): void {
  const { line, col } = editor.cursor();
  const i = nextProblem(problemsShown, line, col, back);
  if (i) editor.select(i.startLine, i.startCol, i.endLine, i.endCol);
}
/** The strip's "3 / 11" (the problem at the cursor, of all), and the list's items of the cursor's line marked. */
function showProblemPosition(): void {
  const { line, col } = editor.cursor();
  showPosition(problemsShown, line, col, lang);
}
on('problem-prev', 'click', () => goProblem(true));
on('problem-next', 'click', () => goProblem(false));
if (mode.hasChrome && !mode.compare) {
  window.addEventListener('keydown', (e) => {
    if (e.key !== 'F8' || e.ctrlKey || e.metaKey || e.altKey || document.querySelector('dialog[open]')) return;
    e.preventDefault();
    goProblem(e.shiftKey);
  }, true);
}

// The explanation's column: one set of tabs at every width, Explanation | Reference (and Problems on a phone, where the
// column is a bottom sheet at three heights). Collapse all and Copy act on the explanation, so show in its tab only.
const sheetCol = document.getElementById('panel-col');
const sheet = sheetCol && !mode.compare && !mode.panel
  ? new BottomSheet(sheetCol, $('panel-head'), $('bsheet-handle'), () => $('ed-head').getBoundingClientRect().bottom, () => {
    editor.view.requestMeasure();
    placeToast();
    markSheet();
    fitTabs();
  })
  : undefined;
type Tab = 'explain' | 'problems' | 'ref';
let tab: Tab = 'explain';
function showTab(next: Tab): void {
  if (!sheetCol) return;
  tab = next;
  if ((next === 'ref') !== panel.refOpen()) panel.pressRef();
  showTabs();
}
function showTabs(): void {
  if (!sheetCol) return;
  // The quick reference may be opened or closed from elsewhere (the panel's own keys).
  if (tab !== 'problems' || !narrow.matches) tab = panel.refOpen() ? 'ref' : 'explain';
  for (const id of ['explain', 'problems', 'ref'] as const) {
    const b = document.getElementById(`tab-${id}`);
    b?.setAttribute('aria-selected', String(tab === id));
    // A tablist is one stop in the Tab order: the selected tab; the arrows move between them.
    b?.setAttribute('tabindex', tab === id ? '0' : '-1');
  }
  sheetCol.dataset.tab = tab;
  $('sheet-problem-list').hidden = tab !== 'problems';
  const tools = document.getElementById('panel-tools');
  if (tools) tools.hidden = tab !== 'explain';
  markSheet();
}
panel.onActions = showTabs;
narrow.addEventListener('change', showTabs);
/** Round 6: a tap on the tab that is already open, with the sheet full, takes the sheet back to half (the script shows). */
function backToHalf(id: Tab): boolean {
  if (!narrow.matches || document.documentElement.dataset.sheet !== 'full' || tab !== id) return false;
  sheet?.set('half');
  return true;
}
on('tab-explain', 'click', () => {
  if (!backToHalf('explain')) showTab('explain');
});
on('tab-problems', 'click', () => {
  if (backToHalf('problems')) return;
  showTab('explain');
  tab = 'problems';
  showTabs();
  sheet?.raise('half');
});
on('tab-ref', 'click', () => {
  if (backToHalf('ref')) return;
  showTab('ref');
  sheet?.raise('half');
});
document.getElementById('panel-tabs')?.addEventListener('keydown', (e) => {
  const tabs = [...document.querySelectorAll<HTMLElement>('#panel-tabs [role="tab"]')].filter((b) => b.offsetParent !== null);
  const at = tabs.indexOf(document.activeElement as HTMLElement);
  const k = (e as KeyboardEvent).key;
  const to = k === 'ArrowRight' ? at + 1 : k === 'ArrowLeft' ? at - 1 : k === 'Home' ? 0 : k === 'End' ? tabs.length - 1 : undefined;
  if (at < 0 || to === undefined) return;
  e.preventDefault();
  const next = tabs[(to + tabs.length) % tabs.length];
  next.focus();
  next.click();
});
// A tap on a line raises a peeking sheet to half, and brings the line into the upper third of what shows of the editor.
$('editor')?.addEventListener('pointerup', (e) => {
  if (!narrow.matches || e.pointerType === 'mouse') return;
  // The phone's hint said to tap a line: done, it goes.
  if (document.getElementById('first-hint')?.hidden === false) closeFirstHint();
  sheet?.raise('half');
  lineToUpperThird();
});
/** On a phone: the cursor's line in the upper third of the editor above the sheet, once the sheet has moved. */
function lineToUpperThird(): void {
  if (!narrow.matches) return;
  setTimeout(() => editor.cursorToUpperThird(), 300);
}

// The toast (round 5): on the desktop it docks in the Problems strip, over the strip's left part ("Sample loaded. · Undo
// · ✕"), so that it never covers code; on a phone 12px above the sheet's top edge. The bubble of "More" sits above it.
function placeToast(): void {
  const toast = document.getElementById('status');
  if (!toast || mode.compare || mode.panel) return;
  const bubble = document.getElementById('status-detail');
  const placeBubble = () => {
    if (!bubble || bubble.hidden) return;
    const r = toast.getBoundingClientRect();
    bubble.style.left = `${Math.round(r.left + (narrow.matches ? 0 : 8))}px`;
    bubble.style.maxWidth = `${Math.round(Math.min(440, narrow.matches ? r.width : window.innerWidth - r.left - 16))}px`;
    bubble.style.bottom = `${Math.round(window.innerHeight - r.top + 6)}px`;
  };
  toast.style.top = '';
  toast.style.width = '';
  toast.style.height = '';
  toast.classList.remove('in-tabs');
  const stripEl = document.querySelector<HTMLElement>('#problems .problems-strip');
  // Round 6: the strip makes room for the toast between its counts and its position (web/page.css, `with-toast`).
  stripEl?.classList.toggle('with-toast', !narrow.matches && !!toast.textContent);
  if (narrow.matches && document.documentElement.classList.contains('kb-open')) {
    // Round 6: with the on-screen keyboard open the toast stays out of the editor: inside the sheet's tabs row.
    toast.classList.remove('docked');
    toast.classList.add('in-tabs');
    const head = $('panel-head').getBoundingClientRect();
    toast.style.left = '8px';
    toast.style.right = '8px';
    toast.style.maxWidth = '';
    toast.style.bottom = '';
    toast.style.top = `${Math.round(head.top + 4)}px`;
    toast.style.height = `${Math.round(head.height - 8)}px`;
    return placeBubble();
  }
  if (narrow.matches) {
    toast.classList.remove('docked');
    const top = sheetCol?.getBoundingClientRect().top ?? window.innerHeight;
    toast.style.left = '12px';
    toast.style.right = '12px';
    toast.style.maxWidth = '';
    // (A full sheet leaves no room above it: the toast sits at the bottom of the screen, over the explanation.)
    const full = document.documentElement.dataset.sheet === 'full' && !document.documentElement.classList.contains('kb-open');
    toast.style.bottom = full ? '12px' : `${Math.round(window.innerHeight - top + 12)}px`;
    return placeBubble();
  }
  const strip = stripEl;
  if (strip && strip.getClientRects().length) {
    const r = strip.getBoundingClientRect();
    const nav = strip.querySelector<HTMLElement>('.strip-nav');
    // Round 6: [› Problems ⚠ 5 ⓘ 6] [the toast] [Ln 20 · 1/11 ‹ ›]: the counts and the position stay in sight.
    const navBox = nav?.getBoundingClientRect();
    const pos = nav?.querySelector<HTMLElement>('.pos');
    const navLeft = navBox && navBox.width > 0 ? (pos && pos.textContent ? pos.getBoundingClientRect().left : navBox.left) : r.right;
    // (The toggle's last thing shown: the counts, or "✓ No problems".)
    const ends = [...(strip.querySelector('#problems-toggle')?.children ?? [])].map((e) => e.getBoundingClientRect()).filter((b) => b.width > 0).map((b) => b.right);
    const left = ends.length ? Math.max(...ends) + 10 : r.left;
    toast.classList.add('docked');
    toast.style.left = `${Math.round(left)}px`;
    toast.style.right = '';
    toast.style.top = `${Math.round(r.top + 4)}px`;
    toast.style.bottom = '';
    toast.style.height = `${Math.round(r.height - 8)}px`;
    toast.style.width = `${Math.max(120, Math.round(navLeft - left - 6))}px`;
    toast.style.maxWidth = '';
    return placeBubble();
  }
  toast.classList.remove('docked');
  const source = $('source').getBoundingClientRect();
  const problems = document.getElementById('problems');
  const floor = problems && !problems.hidden ? problems.getBoundingClientRect().top : source.bottom;
  toast.style.left = `${Math.round(source.left + 12)}px`;
  toast.style.right = '';
  toast.style.maxWidth = `${Math.round(Math.min(420, source.width - 24))}px`;
  toast.style.bottom = `${Math.round(window.innerHeight - floor + 12)}px`;
  placeBubble();
}
const toast = document.getElementById('status');
if (toast) new MutationObserver(placeToast).observe(toast, { childList: true });
// (The strip's right part changes width as the cursor moves on or off a problem: the docked toast follows.)
const stripNav = document.querySelector('#problems .strip-nav');
if (stripNav) new MutationObserver(() => queueMicrotask(placeToast)).observe(stripNav, { childList: true, subtree: true, attributes: true, characterData: true });
window.addEventListener('resize', placeToast);
// (The sheet's height moves in a transition: the toast follows where it ends.)
sheetCol?.addEventListener('transitionend', (e) => {
  if (e.target === sheetCol) placeToast();
});

// The page's own tooltips (hover 400 ms, and keyboard focus), over the bar, the panes' headers and the Problems strip.
const tooltip = document.getElementById('tooltip');
if (tooltip) setUpTooltips(tooltip, '.top, .pane-head, #problems, .panel-head, .first-hint');

// A dialog that opens (the menu, the settings, a question) dismisses the toast, which it would cover or contradict.
new MutationObserver((records) => {
  if (records.some((r) => r.target instanceof HTMLDialogElement && r.target.open)) {
    status('');
    closePopovers();
  }
}).observe(document.body, { attributes: true, attributeFilter: ['open'], subtree: true });

// ---- Round 3 (proto/chrome-3): empty states, the hover card's "Hide hover cards", the sheet's way back -----------------

/** An empty editor shows a block in its middle: Paste a script, Open a file…, Load the sample (and that a file can be dropped). */
function showEmptyEditor(): void {
  const box = document.getElementById('empty-editor');
  if (!box) return;
  const empty = editor.view.state.doc.length === 0;
  if (box.hidden === !empty) return;
  box.hidden = !empty;
}

/** "Paste a script": reads the clipboard (the browser may ask), and puts its text in the editor as a paste, so that its kind is detected. */
async function pasteScript(): Promise<void> {
  // Round 5: on a touch screen the button gives the editor the focus first (in Edit mode), so that the keyboard and
  // the system's paste menu can come, whether or not the page may read the clipboard.
  if (touchOnly()) {
    if (readMode) setReadModeTo(false, false);
    editor.view.focus();
  }
  let text: string | undefined;
  try {
    text = await navigator.clipboard.readText();
  } catch {
    text = undefined;
  }
  if (text === undefined) {
    // Refused, or a browser without the API: the editor takes the focus, and the toast says which key pastes.
    editor.view.focus();
    return status(CHROME[lang].pasteRefused5(shortcut('V')));
  }
  if (!text) return editor.view.focus();
  editor.view.dispatch({ changes: { from: 0, to: editor.view.state.doc.length, insert: text }, selection: { anchor: 0 }, userEvent: 'input.paste', scrollIntoView: true });
  editor.focusUnlessTouch();
}
on('empty-paste', 'click', () => void pasteScript());
on('empty-open', 'click', () => void openFile());
on('empty-sample', 'click', () => loadSample(ownText()));

/** The hover card's "Hide hover cards": turns the setting off, with Undo in the toast. */
function hideHover(): void {
  const set = (on: boolean) => {
    changeSettings({ ...settings, 'hover.enabled': on });
    settingsDialog?.refresh();
  };
  set(false);
  status(CHROME[lang].hoverHidden, false, { label: TEXT[lang].undo, run: () => set(true) });
}

/** The editor header's Shell and yq pickers fit the value they show. */
function fitPickers(): void {
  for (const id of ['shell-top', 'yq-top']) {
    const select = document.getElementById(id);
    if (!(select instanceof HTMLSelectElement)) continue;
    // Round 5: no reserved width (round 4 kept the longest common value's): each picker fits its value, with the arrow
    // right after it (drawn over the select, which keeps the whole width to click) and room for that arrow.
    const textWidth = fitSelect(select, '', 17);
    const chev = select.parentElement?.querySelector('.pick-chev');
    if (chev && textWidth !== undefined) {
      const cs = getComputedStyle(select);
      select.parentElement!.style.setProperty('--chev-x', `${Math.round(select.offsetLeft + parseFloat(cs.borderLeftWidth) + parseFloat(cs.paddingLeft) + textWidth + 5)}px`);
    }
  }
  // (Round 5: no picker keeps a reserved width. They are anchored at the right, so a change of one moves only the
  // controls at its left, and only as the result of that choice; the header keeps room for the file name at 1280px.)
  syncShellPicker();
  fitScope();
}

/** Round 6: the Shell picker is a list like Type's (web/picker.ts), over the select the panel bridge fills. */
const shellPickButton = document.getElementById('shell-pick');
const shellPickList = document.getElementById('shell-list');
const shellPicker = shellPickButton instanceof HTMLButtonElement && shellPickList
  ? new Picker(shellPickButton, shellPickList, (v) => {
    const select = document.getElementById('shell-top') as HTMLSelectElement | null;
    if (!select) return;
    select.value = v;
    select.dispatchEvent(new Event('change'));
  })
  : undefined;
let shellPickerKey = '';
function syncShellPicker(): void {
  const select = document.getElementById('shell-top') as HTMLSelectElement | null;
  if (!shellPicker || !select) return;
  // "Auto" with no #! line says what it resolves to, as the chip does: "Auto (bash)".
  const name = (o: HTMLOptionElement) => (o.value === 'auto' && !/[(（]/.test(o.text) ? `${o.text}${lang === 'ja' ? '（bash）' : ' (bash)'}` : o.text);
  const options = [...select.options].map((o) => ({ value: o.value, name: name(o), short: name(o) }));
  const key = JSON.stringify([options, lang]);
  if (key !== shellPickerKey) {
    shellPickerKey = key;
    shellPicker.set(options, select.value, CHROME[lang].shell);
  } else {
    shellPicker.show(select.value);
  }
}

/**
 * Round 6: the editor header shows the Type and Shell pickers when they fit with the file name, and the chip when they
 * do not: measured, in every language (no width threshold per language). A stacked layout always has the chip.
 */
function fitScope(): void {
  const head = document.getElementById('ed-head');
  if (!head || mode.compare || mode.panel) return showScope();
  head.classList.remove('use-chip');
  if (!narrow.matches) {
    const name = document.getElementById('file-name');
    const nameButton = document.getElementById('file-name-btn');
    // The name is cut although it has not reached its own largest width, or the header overflows.
    const maxName = nameButton ? parseFloat(getComputedStyle(nameButton).maxWidth) || Infinity : Infinity;
    const nameCut = !!name && !!nameButton && !nameButton.hidden && name.scrollWidth > name.clientWidth + 1 && nameButton.getBoundingClientRect().width < maxName - 1;
    const spacer = head.querySelector<HTMLElement>('.spacer');
    const over = head.scrollWidth > head.clientWidth + 1 || nameCut || (spacer !== null && spacer.getBoundingClientRect().width < 4 && nameCut);
    head.classList.toggle('use-chip', over);
  }
  showScope();
}
window.addEventListener('resize', fitPickers);
for (const id of ['shell-top', 'yq-top']) on(id, 'change', () => queueMicrotask(fitPickers));

// The full sheet's "↓ Script": back to half, the script above it.
on('sheet-back', 'click', () => sheet?.set('half'));

// ---- Round 4 (proto/chrome-4) ------------------------------------------------------------------------------------

/** The menu's "Language and theme": the values set now, in one line ("English · Auto"); the item opens Settings at them. */
function showLook(): void {
  const t = TEXT[lang];
  const c = CHROME[lang];
  // (The language in effect, also when it follows the browser.)
  const language = lang === 'ja' ? '日本語' : 'English';
  put('menu-look-note', c.lookNote(language, theme === 'auto' ? c.auto : t.themes[theme]));
}
on('menu-look', 'click', () => {
  drawer?.close();
  settingsDialog?.show();
  const first = document.getElementById('setting-language');
  first?.focus();
});

/** The empty panel's message starts level with the empty editor's block: 30% down the editor (web/panel-page.css). */
function alignEmpty(): void {
  const ed = document.getElementById('editor');
  const frame = document.getElementById('panel');
  if (!ed || !frame) return;
  const e = ed.getBoundingClientRect();
  const top = e.top + e.height * 0.3;
  document.documentElement.style.setProperty('--empty-top', `${Math.round(e.height * 0.3)}px`);
  if (!narrow.matches) panel.setEmptyTop(Math.max(16, top - frame.getBoundingClientRect().top));
  else panel.setEmptyTop(24);
}
window.addEventListener('resize', () => {
  if (!editor.text.trim()) alignEmpty();
});

/**
 * The phone's sheet tells the frame its room: below full no line box (`bx-compact`); on the Explanation tab of a script,
 * the view row lies over the frame's top (`bx-lead`) and scrolls away with the explanation.
 */
function markSheet(): void {
  if (!editor.text.trim()) alignEmpty();
  if (!narrow.matches) return panel.markSheet(false, false);
  const snap = document.documentElement.dataset.sheet;
  const col = document.getElementById('panel-col');
  // (At peek the sheet is a glance: the explanation alone, under the tabs; the view row comes at half and full.)
  const lead = col?.dataset.tab === 'explain' && !col.classList.contains('blank') && snap !== 'peek';
  // Round 6: the same order at half and full: the line box (one compact row), then the view row; at peek neither.
  panel.markSheet(snap === 'peek', !!lead);
  followFrameScroll();
}
/** The view row follows the frame's scroll: it moves up as the explanation does, and comes back at the top. */
function followFrameScroll(): void {
  const w = panel.frameWindow();
  const row = document.getElementById('view-row');
  if (!w || !row) return;
  const place = () => {
    const y = narrow.matches ? Math.min(w.scrollY, row.offsetHeight) : 0;
    // Round 6: the row sits under the frame's line box (sticky at the frame's top) and slides away under it.
    const top = w.document.getElementById('top');
    const above = narrow.matches && top && w.getComputedStyle(top).display !== 'none' ? top.offsetHeight : 0;
    row.style.marginTop = above ? `${above}px` : '';
    row.style.transform = y ? `translateY(${-y}px)` : '';
    row.style.clipPath = y ? `inset(${y}px 0 0 0)` : '';
  };
  if (w !== scrollWatched) {
    scrollWatched = w;
    w.addEventListener('scroll', place, { passive: true });
  }
  place();
}
document.getElementById('panel')?.addEventListener('load', () => queueMicrotask(markSheet));
narrow.addEventListener('change', markSheet);

// The view dropdown ("View: Meaning ▾"): in a narrow view slot, and in the phone's row.
for (const where of ['top', 'phone']) {
  const b = document.getElementById(`view-drop-${where}`);
  const m = document.getElementById(`view-menu-${where}`);
  if (b && m) popover(b, m);
}

// ---- Round 5 (proto/chrome-5) ------------------------------------------------------------------------------------

/**
 * The phone's tabs size to their content, the spare width shared (web/page.css). When they do not fit (a long line
 * number, larger text, the full sheet's "↓"), they take less room in steps: `wide` (14px), `snug` (13px, less padding),
 * `icons` (Problems and Reference as their icons, the count kept; their names stay for screen readers and tooltips).
 */
function fitTabs(): void {
  const tabs = document.getElementById('panel-tabs');
  if (!tabs) return;
  if (!narrow.matches) {
    delete tabs.dataset.fit;
    return;
  }
  const fits = () => tabs.scrollWidth <= tabs.clientWidth + 1 && [...tabs.querySelectorAll<HTMLElement>('[role="tab"]')].every((b) => b.scrollWidth <= b.clientWidth + 1);
  // (Measured with the full sheet's "↓" in the row, at every height: the tabs keep one size as the sheet moves.)
  const bar = tabs.parentElement;
  bar?.classList.add('fit-test');
  for (const fit of ['wide', 'snug', 'icons']) {
    tabs.dataset.fit = fit;
    // Round 6: "Script ⌄" keeps its word at `wide` and `snug`, and is its icon alone at `icons`.
    if (bar) bar.dataset.fit = fit;
    if (fits()) break;
  }
  bar?.classList.remove('fit-test');
}
window.addEventListener('resize', fitTabs);
narrow.addEventListener('change', fitTabs);

/** After a paste into an empty editor, the cursor goes to the first line that is a command (not blank, not a comment or the #! line). */
function cursorAfterPaste(u: ViewUpdate): void {
  if (u.startState.doc.length > 0 || !u.transactions.some((tr) => tr.isUserEvent('input.paste'))) return;
  const doc = u.state.doc;
  for (let i = 1; i <= doc.lines; i++) {
    const text = doc.line(i).text;
    const trimmed = text.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const at = doc.line(i).from + (text.length - text.trimStart().length);
    queueMicrotask(() => editor.view.dispatch({ selection: { anchor: at }, effects: EditorView.scrollIntoView(at, { y: 'nearest', yMargin: 40 }) }));
    return;
  }
}

/**
 * The phone's on-screen keyboard (round 5): while it is open over the editor in Edit mode, the sheet folds to its tabs row
 * just above it (`kb-open`), and the editor (its cursor, the empty editor's block) keeps to what shows above both. Read
 * from the visual viewport: iOS shrinks only that (the keyboard then covers the layout's bottom: `--kb-overlap`), Android
 * with `interactive-widget=resizes-content` shrinks the window too (no overlap).
 */
function setUpKeyboard(): void {
  const vv = window.visualViewport;
  if (!vv || mode.compare || mode.panel) return;
  const root = document.documentElement;
  let base = { w: window.innerWidth, h: window.innerHeight };
  let open = false;
  const check = () => {
    // (The phone turned: a new height to compare with.)
    if (Math.abs(window.innerWidth - base.w) > 1) base = { w: window.innerWidth, h: window.innerHeight };
    base.h = Math.max(base.h, window.innerHeight);
    const covered = base.h - vv.height;
    const now = narrow.matches && touchOnly() && !readMode && editor.view.hasFocus && covered > 150;
    root.style.setProperty('--kb-overlap', `${now ? Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop)) : 0}px`);
    if (now === open) return;
    open = now;
    root.classList.toggle('kb-open', open);
    editor.view.requestMeasure();
    placeToast();
    fitTabs();
    if (!editor.text.trim()) alignEmpty();
    setTimeout(() => {
      if (editor.text) editor.view.dispatch({ effects: EditorView.scrollIntoView(editor.view.state.selection.main.head, { y: 'nearest', yMargin: 24 }) });
    }, 60);
  };
  vv.addEventListener('resize', check);
  vv.addEventListener('scroll', check);
  window.addEventListener('resize', check);
  editor.view.contentDOM.addEventListener('focus', () => setTimeout(check, 0));
  editor.view.contentDOM.addEventListener('blur', () => setTimeout(check, 0));
}
setUpKeyboard();

/** "?" opens the keyboard shortcuts (in the menu's Help), when the focus is not in the editor or a field. */
function shortcutsKey(e: KeyboardEvent): void {
  if (e.key !== '?' || e.ctrlKey || e.metaKey || e.altKey || editor.view.hasFocus || document.querySelector('dialog[open]')) return;
  const target = e.target as Element | null;
  if (target?.closest?.('input, textarea, select, [contenteditable="true"], .cm-editor')) return;
  e.preventDefault();
  openMenu();
  const keys = document.getElementById('menu-keys') as HTMLDetailsElement | null;
  const help = document.getElementById('menu-g-help');
  if (!keys || !help) return;
  help.hidden = false;
  keys.open = true;
  keys.scrollIntoView({ block: 'nearest' });
  keys.querySelector('summary')?.focus();
}
if (withFiles) {
  window.addEventListener('keydown', shortcutsKey);
  const frame = document.getElementById('panel') as HTMLIFrameElement | null;
  frame?.addEventListener('load', () => frame.contentWindow?.addEventListener('keydown', shortcutsKey));
  if (frame?.contentDocument?.readyState === 'complete') frame.contentWindow?.addEventListener('keydown', shortcutsKey);
}

// ---- Round 6 (proto/chrome-6) ------------------------------------------------------------------------------------

// ⋯ has useful items before Load the sample and Clear: Rename… (the header's name turns into a field) and Copy the script.
on('more-rename', 'click', () => setTimeout(() => {
  const button = document.getElementById('file-name-btn');
  if (button && button.offsetParent !== null) button.click();
  else {
    openMenu();
    document.getElementById('menu-file')?.click();
  }
}, 0));
on('more-copy-script', 'click', () => document.getElementById('copy-script')?.click());

// The empty panel (desktop): a one-line preview of what it will show, and "Try the sample".
panel.onEmpty = () => ({ preview: CHROME[lang].emptyPreview, link: CHROME[lang].trySample, run: () => loadSample(ownText()) });

// ---- Start ----------------------------------------------------------------------------------

async function start(): Promise<void> {
  applyLanguage();
  put('version', `Bash Explainer ${VERSION}`);
  if (shared.deflated) {
    const text = await inflate(shared.deflated);
    if (text !== undefined) editor.setText(text, 1);
  }
  clean = editor.text;
  showFile();
  showEmptyEditor();
  updatePanel();
  editor.recheck();
  // The page is ready: the opening labels its line and leaves.
  openingReady();
  // In panel mode: tell the page around that this copy is ready for a script.
  if (mode.panel) toParent({ type: 'bx-ready', channel: CHANNEL, version: VERSION, pr: PR, commit: COMMIT });
}

// A link pasted into the address bar of the open page: off the address bar at once, read by the next reload.
window.addEventListener('hashchange', () => void takeLinkFromAddress());
void start();
