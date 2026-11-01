// The web page: a script editor on the left, the extension's explanation panel on the right.
// The same script also runs two other pages of the site (web/mode.ts): `?view=panel`, only the explanation
// panel, filled by the page around it (the compare page); compare.html, the editor and two such frames.
// Everything runs here, in the browser; the script is never sent anywhere.
//
// This file holds the page's state (language, file kind, settings, theme) and wires the parts together:
// web/editor.ts (the script), web/panel-bridge.ts (the panel's frame), web/compare.ts (the compare page),
// web/share.ts (links), web/storage.ts (what the browser keeps), web/layout.ts (dividers and sheets),
// web/file-io.ts (opening a file, saving to one), web/editor-head.ts (the editor's header, its hint and empty block),
// web/kinds.ts (the file kind and its samples), web/scope-chip.ts (the chip of the file type and the shell).
import { undo } from '@codemirror/commands';
import { ViewUpdate } from '@codemirror/view';
import { Analyzer, LineExplanation } from '../src/analyzer';
import type { AutoShell } from '../src/dialect';
import { autoShellAt, DocumentIssue, explainDocumentLine, ShellDocument, Shells } from '../src/document';
import { openDocument, shellsOf } from '../src/document-setup';
import { Lang, resolveLang } from '../src/i18n';
import { problemLevels } from '../src/levels';
import { changedSettings, explainOptions, forcedShell, mergeSettings, readSettings, Settings } from '../src/settings';
import { createUnbashParser } from '../src/syntax/adapters/unbash';
import { lineMarks, needsReading, panelUpdate } from '../src/ui/panelView';
import { toPlainMarkdown } from '../src/ui/render';
import { editorAttributes, editorHint, isPaneKey, LineAnnouncer } from './a11y';
import { CHANNEL, COMMIT, PR, UP, VERSION } from './build-info';
import { Compare, receiveState, toParent } from './compare';
import { $, on, put } from './dom';
import { Editor } from './editor';
import { drawIcons } from './icons';
import { confirmCopied, EditorHead, shortcut } from './editor-head';
import { ChosenFile, chooseFile, decodeText, fileContent, hasFiles, isMac, kindForFile, kindFromName, MAX_BYTES, refuseDrops, saveText, withEol } from './file-io';
import { FileState } from './file-state';
import { FileNameControl } from './file-name';
import { linkWords, showMenuTexts } from './menu';
import { showChannel } from './banner';
import { ask } from './kind-dialog';
import { KindControl, untouched } from './kinds';
import { closeSheet, narrow, reopenSheet, setUpEdgeSwipe, setUpProblems, setUpSheet, setUpSplitter } from './layout';
import { mode } from './mode';
import { PanelBridge } from './panel-bridge';
import { ProblemStrip, roomAboveStrip, watchStrip } from './problem-list';
import { ReadEdit } from './read-edit';
import { watchKeyboard } from './keyboard';
import { BottomSheet, sheetLayout } from './sheet';
import { CopyState, DEFAULT_THEME, Theme, THEMES } from './protocol';
import { Kind, KINDS } from './samples';
import { openingReady } from './opening';
import { closePopovers, setUpFocusRings } from './popover';
import { ScopeControl } from './scope-chip';
import { SettingsDialog } from './settings-dialog';
import { takeLinkFromAddress, inflate, readHash, scriptParams } from './share';
import { clearStoredData, readStored, removeStored, STORAGE_KEYS, writeStored } from './storage';
import { TEXT } from './text';
import { Toast, type ToastIcon, type ToastSpec, type ToastText } from './toast';

// The icons the page shares with the VS Code panel (web/icons.ts).
drawIcons();

/** The saved choice, read by theme-init.js before the first paint too; Auto when storage is unavailable. */
function savedTheme(): Theme {
  const v = readStored(STORAGE_KEYS.theme);
  return v === 'light' || v === 'dark' ? v : DEFAULT_THEME;
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


// ---- State ----------------------------------------------------------------------------------

const shared = readHash();
let lang: Lang = shared.lang ?? resolveLang(settings.language, navigator.language);
/** The file kind, its samples, and the compare page's picker of it (web/kinds.ts). */
const kinds: KindControl = new KindControl({
  lang: () => lang,
  editor: (): Editor => editor,
  files: () => fileState,
  showFile: () => showFile(),
  explain: () => updatePanel(),
  status,
  dropUndo: () => dropUndo(),
  closeSheets() {
    drawer?.close();
    closePopovers();
  },
  focusHome: () => focusHome(),
}, shared.kind ?? 'shell');
/** The shell and yq of the settings, as the panel's header shows them (undefined: auto). */
const choice = () => ({ shell: forcedShell(settings), yq: settings['yq.flavor'] === 'auto' ? undefined : settings['yq.flavor'] });
const parser = createUnbashParser();
const analyzers = new Map<Lang, Analyzer>();
let parsed: { text: string; kind: Kind; doc: ShellDocument } | undefined;
/** The file the script is (web/file-state.ts): where it came from, how that file holds its text, its name, and what is not saved. */
const fileState = new FileState<FileSystemFileHandle>();
/**
 * The one name the page gives the script, wherever it shows it (the header, Save, the title, the panel's `file`, Copy as
 * Markdown's `file:line`): the file's, else the name given, else "untitled" with the kind's extension. The analyzer needs
 * no more of the kind's path: only a name ending in `.zsh` or the like says another shell (`detectShell`).
 */
const scriptName = () => fileState.name(kinds.info().fileName);
let shown: { explanation: LineExplanation; line: number } | undefined;
/** The chip of the file type and the shell in the editor's header (web/scope-chip.ts); the yq choices of the line, as the panel offers them; the shell reading the settings were drawn with. */
let scope: ScopeControl | undefined;
let yqLine: { options?: readonly (readonly string[])[]; value: string } = { value: 'auto' };
let readingShown = '';

const analyzer = () => analyzers.get(lang) ?? analyzers.set(lang, new Analyzer(lang)).get(lang)!;

/** The script as the explainers see it, parsed once per change. */
function shellDocument(): ShellDocument | undefined {
  const text = withEol(editor.text, fileState.format.eol);
  const { kind } = kinds;
  if (parsed && parsed.text === text && parsed.kind === kind) return parsed.doc;
  const doc = openDocument(text, kind, (shellText) => parser.parse(shellText));
  parsed = { text, kind, doc };
  return doc;
}

function shells(): Shells {
  const doc = editor.view.state.doc;
  const lines = Array.from({ length: Math.min(50, doc.lines) }, (_, i) => doc.line(i + 1).text);
  return shellsOf(lines, scriptName(), forcedShell(settings));
}

/** The shell the cursor's line is explained as when none is chosen, and where from: what the chip, its popover and the Shell setting say. */
function autoShell(): AutoShell | undefined {
  const doc = shellDocument();
  return doc && autoShellAt(doc, shells(), editor.cursorLine());
}

// ---- Editor ---------------------------------------------------------------------------------

const readEdit = new ReadEdit({ set: (read) => editor.setReadMode(read), tipGone: () => showFile() });
/** The warning codes in the script, offered in the settings dialog. */
let codesSeen: string[] = [];
/** The problems the editor shows, for the panel's squiggles. */
let problemsShown: DocumentIssue[] = [];
/** Whether the sample button is replacing the text, so that the offer to undo it stays. */
let timer: ReturnType<typeof setTimeout> | undefined;
/** The live region that says what the line the cursor moved to is about (the editor page only). */
let announcer: LineAnnouncer | undefined;

/** The Problems strip and list under the editor; a click on a problem, ‹ › and F8 (on the page) select it in the editor. */
const strip = mode.hasChrome ? new ProblemStrip({
  lang: () => lang, cursor: () => editor.cursor(), spans: () => editor.problemSpans(),
  pick: (i) => {
    editor.select(i.startLine, i.startCol, i.endLine, i.endCol);
    sheet?.picked();
  },
}) : undefined;
const editor = new Editor({
  kind: () => kinds.kind,
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
    strip?.show(list);
    panel.problems(problemLevels(list.map((i) => i.severity)));
  },
  changed(u: ViewUpdate) {
    // Undo would no longer undo the sample once the text changed again.
    if (u.docChanged && toast.current?.action?.untilEdit && !kinds.puttingText) toast.hide();
    if (u.docChanged && !mode.panel) kinds.detectPasted(u);
    if (u.docChanged) showFileSoon();
    if (Editor.problemsMoved(u)) strip?.place();
    // In panel mode the page around sends every change as a message, which is handled at once.
    if (mode.panel || (!u.docChanged && !u.selectionSet)) return;
    clearTimeout(timer);
    timer = setTimeout(updatePanel, u.docChanged ? 150 : 60);
  },
  openSettings: () => settingsDialog?.show(),
  announce: (text) => announcer?.say(text),
}, { parent: $('editor'), text: shared.text ?? kinds.info().sample, readMode: readEdit.read, problems: mode.hasChrome });
editor.shade();
editor.placeCursor(shared.text ? 1 : kinds.info().cursorLine);
{
  const region = document.getElementById('announce');
  if (region) announcer = new LineAnnouncer(region, editor.view);
  const hint = document.getElementById('editor-hint');
  if (hint) editorHint(editor.view, hint);
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
  const explanation = explainDocumentLine(analyzer(), doc, line, lang, s, { ...explainOptions(settings), reading: needsReading(panel.panelState()), sentence: true });
  const auto = autoShellAt(doc, s, line);
  shown = { explanation, line };
  announcer?.shown(explanation, line, lang);
  sheet?.summarize(explanation, line);
  const update = panelUpdate({
    lang, explanation, file: scriptName(), line, lineText: doc.lines[line] ?? '', doc, wrap: settings['editor.wrap'],
    choice: choice(), detected: auto, placement: settings['examples.placement'],
    animations: settings['panel.animations'], marks: lineMarks(problemsShown, line), web: true, state: panel.panelState(),
  });
  panel.show(update, line);
  yqLine = { options: update.dialect.yqs, value: update.dialect.yq };
  scope?.draw();
  // (The Shell setting says the shell the script reads as now: decision 12.)
  if (JSON.stringify(auto) !== readingShown) {
    readingShown = JSON.stringify(auto);
    settingsDialog?.refresh();
  }
}

/** Writes to the clipboard; false when the browser refuses (a write outside a click's own turn, a policy). */
async function writeClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

function copyMarkdown(): void {
  if (!shown) return;
  const md = toPlainMarkdown(shown.explanation, editor.view.state.doc.line(shown.line + 1).text, `${scriptName()}:${shown.line + 1}`, lang);
  void writeClipboard(md).then((ok) => status(ok ? 'done' : 'note', TEXT[lang][ok ? 'copied' : 'copyRefused']));
}

// ---- Panel mode: the page around sends the script ---------------------------------------------

/** Takes the script, the cursor and the settings the compare page sent, and explains the line. */
function applyCopyState(m: CopyState): void {
  const newLang: Lang = m.lang === 'ja' ? 'ja' : 'en';
  const langChanged = newLang !== lang;
  lang = newLang;
  kinds.kind = KINDS.some((k) => k.kind === m.kind) ? m.kind : 'shell';
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
      return { text: editor.text, kind: kinds.kind, line, col, lang, theme, choice: choice(), settings: changedSettings(settings, 'web') };
    },
    reveal: (span, preserveFocus) => editor.selectSpan(span, preserveFocus),
    highlight: (span) => editor.highlight(span),
    choose: setChoice,
  });
}

// ---- Toolbar --------------------------------------------------------------------------------

/** The page's toast (web/toast.ts): above the Problems strip, inside the editor's pane (none on the compare page or in panel mode). */
const toast = new Toast($('status'), {
  labels: () => ({ more: TEXT[lang].toastMore, why: TEXT[lang].toastWhy }),
  room: () => (mode.compare || mode.panel ? undefined : roomAboveStrip()),
  covers: (px) => editor.setBottomMargin(px),
  focusBack: () => focusHome(),
});
watchStrip(() => toast.place());

/** Shows a toast, or hides the one shown (`''`). */
function status(icon: ToastIcon | '', words: ToastText | string = '', action?: ToastSpec['action']): void {
  if (!icon) return toast.hide();
  toast.show({ icon, ...(typeof words === 'string' ? { text: words } : words), action });
}

/** Goes to another page of the site with the script in the hash, in the same language and file kind. */
async function goWithScript(href: string): Promise<void> {
  const params = await scriptParams(lang, kinds.kind, editor.text);
  location.href = `${href}#${params}`;
}

function applyLanguage(): void {
  const t = TEXT[lang];
  document.documentElement.lang = lang;
  if (mode.compare) put('tagline', t.compareTagline);
  put('install', t.install);
  readEdit.draw(lang);
  put('lang-label', t.lang);
  put('menu-sample-label', t.sample);
  put('menu-open-label', t.open);
  put('menu-save-label', t.save);
  put('menu-panes-label', t.toPanel);
  put('editor-hint', t.editorHint);
  editor.setLabels(editorAttributes(lang));
  document.getElementById('menu-open-file')?.setAttribute('title', t.openTip);
  document.getElementById('menu-save')?.setAttribute('title', t.saveTip);
  put('drop-title', t.dropTitle);
  put('drop-note', t.dropNote);
  showFile();
  put('menu-install-label', t.install);
  put('settings-label', t.settings);
  showMenuTexts(lang);
  head?.showTexts();
  panel.showActions();
  sheet?.name();
  // The buttons drawn as icons say what they do to screen readers and in a tooltip.
  for (const [id, name] of [['sample', t.sample], ['settings-open', t.settings], ['menu-open', t.menu], ['menu-close', t.close], ['github', t.github], ['splitter', t.resize], ['problems-resize', t.resizeProblems]]) {
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
  showChannel(lang);
  $<HTMLSelectElement>('lang').value = lang;
  // (The compare page's picker of the file kind; the editor page's chip.)
  kinds.showLanguage();
  scope?.draw();
}

// The colours are CSS variables (theme.css): the attribute switches them, the editor and the panel follow. The menu's
// select and the settings' Theme are the same choice.
function setTheme(next: Theme): void {
  theme = next;
  $<HTMLSelectElement>('theme').value = theme;
  if (theme === DEFAULT_THEME) document.documentElement.removeAttribute('data-theme');
  else document.documentElement.setAttribute('data-theme', theme);
  // When storage refuses, the choice lasts until the page is closed.
  if (theme === DEFAULT_THEME) removeStored(STORAGE_KEYS.theme);
  else writeStored(STORAGE_KEYS.theme, theme);
  pushTheme();
}
$<HTMLSelectElement>('theme').addEventListener('change', (e) => setTheme((e.target as HTMLSelectElement).value as Theme));

// The language menu is the `language` setting.
$<HTMLSelectElement>('lang').addEventListener('change', (e) => {
  changeSettings({ ...settings, language: (e.target as HTMLSelectElement).value === 'ja' ? 'ja' : 'en' });
});

/** Applies new settings, keeps them, and shows them in the toolbar, the panel and the dialog. */
function changeSettings(next: Settings): void {
  // A link's language stays until the setting itself changes.
  const languageChanged = next.language !== settings.language;
  settings = next;
  editor.setWrap(settings['editor.wrap']);
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
}

/** The shell or yq chosen in the panel's header ('auto' clears it). */
function setChoice(key: 'shell' | 'yq', value: string): void {
  const next = { ...settings, [key === 'shell' ? 'shell' : 'yq.flavor']: value };
  // Only values the setting takes (a copy of another version may offer others).
  if (readSettings(changedSettings(next), 'panel').warnings.length) return;
  changeSettings(next);
  settingsDialog?.refresh();
}

/** A place the focus can go to as a whole: the editor's, the explanation's (F6's stops), or the toast's. */
type Stop = 'editor' | 'settings' | 'grabber' | 'panel' | 'toast';

/**
 * Where the editor's and the explanation's stops are, while what covers them makes them inert: side by side, the
 * settings sheet takes the editor's; on a phone, the sheet's grabber takes the editor's while the sheet is full, and
 * the explanation's while it is folded. The one source for `focusHome` and F6 (`paneKeys`).
 */
function paneStops(): { home: Stop; panel: Stop } {
  const home = settingsDialog?.sideBySide ? 'settings' : sheet?.covers ? 'grabber' : 'editor';
  return { home, panel: sheet?.folded ? 'grabber' : 'panel' };
}

/** Puts the focus on a stop (`touch`: the editor only with a mouse or a pen, so that no on-screen keyboard opens). */
function focusStop(stop: Stop, touch = false): void {
  if (stop === 'settings') settingsDialog?.focus();
  else if (stop === 'grabber') sheet?.focus();
  else if (stop === 'panel') toPanel();
  else if (stop === 'toast') toast.focus();
  else if (touch) editor.focusUnlessTouch();
  else editor.view.focus();
}

/**
 * Where the focus goes when its holder goes (a toast, an Undo, a question, an opened file): the editor's stop
 * (`paneStops`), the editor itself but on touch.
 */
function focusHome(): void {
  focusStop(paneStops().home, true);
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
  pane: () => document.querySelector<HTMLElement>('main > .source'),
  shellReading: autoShell,
});

/**
 * Removes everything the page keeps in the browser and shows the defaults at once: the settings, the
 * theme, read mode, the size of the panes and the first-run tip (again, on a touch screen).
 */
function clearEverything(): void {
  clearStoredData();
  changeSettings(mergeSettings());
  setTheme(DEFAULT_THEME);
  readEdit.reset();
  resetSplit?.();
  resetProblems?.();
  showFile();
}
function openSettings(): void {
  if (dialogElement && reopenSheet(dialogElement)) return;
  if (settingsDialog?.open || drawer?.open) return;
  settingsDialog?.show();
}
on('settings-open', 'click', () => settingsDialog?.toggle());
if (dialogElement) setUpSheet(dialogElement);

// ---- The menu: a sheet from the right, with what the top bar has no room for ----------------------

const drawer = document.getElementById('drawer') as HTMLDialogElement | null;
function openMenu(): void {
  if (!drawer) return;
  // The settings sheet next to the bar slides out: the menu takes its place.
  if (settingsDialog?.open && dialogElement) closeSheet(dialogElement);
  if (reopenSheet(drawer) || drawer.open) return;
  drawer.showModal();
}
on('menu-open', 'click', openMenu);
on('menu-close', 'click', () => drawer && closeSheet(drawer));
if (drawer) setUpSheet(drawer);
const edge = document.getElementById('edge');
if (edge) setUpEdgeSwipe(edge, openMenu, 'left');
const edgeRight = document.getElementById('edge-right');
if (edgeRight) setUpEdgeSwipe(edgeRight, openSettings, 'right');
// The menu's items do what the top bar's buttons do, and close the menu first.
// The menu's items do what the editor's header does, and close the menu first. Copy a link says "Copied" on the item
// itself, and the menu stays.
for (const [item, run] of [['menu-sample', sampleAsked], ['menu-clear', clearEditor], ['menu-copy-script', copyScript], ['menu-copy-md', copyMarkdown]] as const) {
  on(item, 'click', (e) => {
    drawer?.close();
    // (The item is told, so that a question the command asks gives the focus back to the sheet's button.)
    void run(e.currentTarget as HTMLElement);
  });
}
on('menu-share', 'click', () => void copyLink('menu-share'));

// ---- The divider between the editor and the explanation ------------------------------------------

const splitElement = document.getElementById('split');
const resetSplit = splitElement && mode.hasChrome ? setUpSplitter(splitElement, $('splitter'), () => editor.view.requestMeasure()) : undefined;
const resetProblems = splitElement && mode.hasChrome
  ? setUpProblems($('source'), $('problems'), $('problems-resize'), $('problems-toggle'), () => editor.view.requestMeasure())
  : undefined;
// The cursor's line stays in view when the editor's pane changes size (the phone turned, the divider moved).
narrow.addEventListener('change', () => editor.keepCursorInView());
// On a phone the explanation is a sheet over the editor (web/sheet.ts): the editor's room and the toast follow it.
const panePane = document.getElementById('panel-pane');
const sheet = panePane && mode.hasChrome ? new BottomSheet(panePane, {
  lang: () => lang,
  moved() {
    editor.view.requestMeasure();
    editor.keepCursorInView('nearest');
    toast.place();
  },
  reading: () => readEdit.read,
  explain: () => panel.explain(),
  announce: (text) => announcer?.say(text),
  home: () => focusStop(paneStops().home),
}) : undefined;
// While the keyboard is open over the editor, the sheet is the summary row on its top (web/keyboard.ts).
if (sheet) watchKeyboard(editor.view.contentDOM, { typing: () => sheetLayout() && !readEdit.read && editor.view.hasFocus, changed: (k) => sheet.typing(k) });

/** Hides the toast whose Undo goes back over an edit, when another edit of the editor's text comes first. */
function dropUndo(): void {
  if (toast.current?.action?.untilEdit) toast.hide();
}

/**
 * "Load the sample" (⋯, the menu, the empty editor; the compare page's button). The user's own text is replaced at once,
 * and the toast offers to undo it; a sample or nothing gets no toast. A file opened and changed since is asked about as
 * Open asks (the same question, in the same dialog): the Undo toast goes with the first keystroke, and Ctrl+Z would
 * bring the text back but not the file.
 */
async function sampleAsked(from: HTMLElement | null = document.activeElement as HTMLElement | null): Promise<void> {
  const t = TEXT[lang];
  if (fileState.file && unsaved()) {
    const discard = await ask({
      id: 'discard', title: t.discardTitle, message: t.discardSampleMessage(window.matchMedia('(pointer: fine)').matches ? shortcut('S') : t.saveInMenu),
      confirm: { id: 'discard-open', text: t.discardLoad }, cancel: { id: 'discard-cancel', text: t.cancel },
    }, from);
    if (!discard) return;
    // (The file is not the editor's any more: the focus goes to the text, as after Open.)
    kinds.loadSample(kinds.own());
    return focusHome();
  }
  kinds.loadSample(kinds.own());
}
on('sample', 'click', () => void sampleAsked());

/**
 * Empties the editor, as one step of the history: the toast offers to undo it ("Sample cleared" when it held a sample).
 * A file opened stays the file (its text is now empty, not saved).
 */
function clearEditor(): void {
  const t = TEXT[lang];
  if (!editor.text) return focusHome();
  const wasSample = untouched(editor.text);
  dropUndo();
  kinds.putText('', 1);
  showFile();
  const back = () => {
    undo(editor.view);
    showFile();
    focusHome();
  };
  status('undo', wasSample ? t.sampleCleared : t.editorCleared, { label: t.undo, run: back, untilEdit: true });
  focusHome();
}

function copyScript(): void {
  void writeClipboard(editor.text).then((ok) => status(ok ? 'done' : 'note', TEXT[lang][ok ? 'scriptCopied' : 'copyRefused']));
}

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

/** Copies the link to the script, and says "Copied" on the button pressed (the app bar's, or the menu's on a phone). */
async function copyLink(id: 'share' | 'menu-share'): Promise<void> {
  const params = await scriptParams(lang, kinds.kind, editor.text);
  const url = `${location.origin}${location.pathname}#${params}`;
  // Safari refuses a write that comes after the compression above (it is no longer the click's own turn): say so.
  if (!await writeClipboard(url)) {
    drawer?.close(); // the toast would lie under the open menu
    return status('note', TEXT[lang].copyRefused);
  }
  confirmCopied($(id), lang, document.getElementById(id === 'share' ? 'share-said' : 'menu-share-said'), () => linkWords(id, lang));
}
on('share', 'click', () => void copyLink('share'));

// ---- Files: open one into the editor, save the editor's text to one (web/file-io.ts) ----------------

/** The editor page has them; the compare page and the copies in panel mode do not. */
const withFiles = !mode.compare && !mode.panel;
/** The editor's header, the first visit's hint and the empty editor's block (web/editor-head.ts); the editor page's only. */
const head = withFiles ? new EditorHead({
  lang: () => lang,
  editor,
  names: new FileNameControl({ lang: () => lang, view: () => nameView(), rename }),
  openFile: () => void openFile(),
  saveFile: () => void saveFile(),
  loadSample: (from) => void sampleAsked(from),
  clear: clearEditor,
  copyScript,
  holdsSample: () => KINDS.some((k) => k.sample === editor.text),
  tipShown: () => readEdit.tipShown(),
  status: (text) => status('note', text),
}) : undefined;
scope = withFiles ? new ScopeControl({ lang: () => lang, kind: () => kinds.kind, shells: () => ({ forced: forcedShell(settings), auto: autoShell() }), yq: () => yqLine, chooseKind: (k) => kinds.choose(k), choose: setChoice }) : undefined;
// The menu's row opens the same popover.
on('menu-scope', 'click', () => {
  drawer?.close();
  scope?.open();
});
// Focus rings follow the input: none on a control given the focus back after a pointer (web/popover.ts).
setUpFocusRings();

/** Whether opening a file would lose text (web/file-state.ts): the editor's text differs from the one last opened, saved or loaded, and is the user's own. */
const unsaved = () => fileState.unsaved(editor.text, untouched);

let fileTimer: ReturnType<typeof setTimeout> | undefined;
/** The script's name as the page shows it (src/ui/fileName.ts): muted until saved or opened, ● for changes not saved. */
const nameView = () => fileState.view(editor.text, untouched, kinds.info().fileName);
/** Shows the script's name, and whether it has changes not saved: in the editor's header, the menu (its first row and its Save) and the page's title. */
function showFile(): void {
  if (!withFiles) return;
  clearTimeout(fileTimer);
  const v = nameView();
  const t = TEXT[lang];
  // Save says where the script goes: into the file, or the name a save suggests (never with the dot: Save has none).
  $('menu-save-name').textContent = v.name;
  head?.show(fileState.handle() ? t.saveTo(v.name) : t.saveAs(v.name));
  document.title = fileState.named() ? `${v.dot ? '● ' : ''}${v.name} — Bash Explainer` : 'Bash Explainer';
  // (A name of another length leaves the chip another room.)
  scope?.draw();
}

/**
 * Gives the script another name (the file name, renamed in place): the one a save writes (a file's next save then asks
 * where). The file kind follows the name as it does when a file of that name is opened (`kindFromName`): `test.bats`
 * makes a bats file, `Makefile` a makefile; a name that says nothing (`notes.txt`) leaves the kind as it is.
 */
function rename(next: string): void {
  const before = scriptName();
  fileState.rename(next);
  const named = kindFromName(next);
  if (named && named !== kinds.kind) return kinds.set(named);
  showFile();
  // A new name can say another shell (`.zsh`).
  if (scriptName() !== before) {
    editor.shade();
    updatePanel();
    editor.recheck();
  }
}

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
  if (chosen.size > MAX_BYTES) return status('note', t.tooLarge(chosen.name));
  let bytes: ArrayBuffer;
  try {
    bytes = await chosen.arrayBuffer();
  } catch {
    // A folder dropped, or a file changed or gone since it was chosen.
    return status('note', t.notRead(chosen.name));
  }
  const read = decodeText(new Uint8Array(bytes));
  if (read === 'binary') return status('note', t.notText(chosen.name));
  if (read === 'cr') return status('note', t.loneCr(chosen.name));
  if (unsaved()) {
    const discard = await ask({
      id: 'discard', title: t.discardTitle, message: t.discardMessage(chosen.name, window.matchMedia('(pointer: fine)').matches ? shortcut('S') : t.saveInMenu),
      confirm: { id: 'discard-open', text: t.discard }, cancel: { id: 'discard-cancel', text: t.cancel },
    }, back, focusHome);
    if (!discard) return;
  }
  fileState.opened({ name: chosen.name, handle }, { eol: read.eol, bom: read.bom }, read.text);
  editor.openText(read.text);
  kinds.set(kindForFile(chosen.name, read.text));
  if (read.mixed) status('note', t.mixedEol(chosen.name, read.eol === '\n' ? 'LF' : 'CRLF'));
  else status('done', t.opened(chosen.name));
  focusHome();
}

async function openFile(back: HTMLElement | null = document.activeElement as HTMLElement | null): Promise<void> {
  let chosen: ChosenFile | undefined;
  try {
    chosen = await chooseFile($<HTMLInputElement>('open-input'));
  } catch {
    // Picked, but changed or gone before it could be read.
    return status('note', TEXT[lang].notRead());
  }
  if (chosen) await openChosen(chosen, back);
}

/** Saves the editor's text as the file holds it (line ends, BOM): into the file, or where the user says, or as a download. */
async function saveFile(): Promise<void> {
  const t = TEXT[lang];
  const text = editor.text;
  const before = scriptName();
  const version = fileState.version();
  const r = await saveText(fileContent(text, fileState.format), scriptName(), fileState.handle());
  if (r.how === 'cancelled') return;
  // Another file was opened (or the name changed) while the browser asked (its permission bubble is not modal): that is not the file saved.
  if (fileState.version() !== version) return r.how === 'refused' ? status('note', t.notSaved(r.name)) : status('done', r.how === 'written' ? t.saved(r.name) : t.downloaded(r.name));
  if (r.how === 'refused') {
    fileState.refused();
    return status('note', t.notSaved(r.name));
  }
  fileState.saved({ name: r.name, handle: r.how === 'written' ? r.handle : undefined }, text);
  showFile();
  status('done', r.how === 'written' ? t.saved(r.name) : t.downloaded(r.name));
  // A new name can say another shell (`.zsh`).
  if (scriptName() !== before) {
    editor.shade();
    updatePanel();
    editor.recheck();
  }
}

/** Ctrl+S and Ctrl+O (⌘S and ⌘O on a Mac), also with the focus in the panel's frame: the page's save and open, not the browser's. */
function fileKeys(e: KeyboardEvent): void {
  const mod = isMac() ? e.metaKey && !e.ctrlKey : e.ctrlKey && !e.metaKey;
  if (!mod || e.altKey || e.shiftKey) return;
  // The letter typed, or on a keyboard of another script the key at its place.
  const key = /^[a-z]$/i.test(e.key) ? e.key.toLowerCase() : ({ KeyS: 's', KeyO: 'o' } as Record<string, string>)[e.code];
  if (key !== 's' && key !== 'o') return;
  e.preventDefault();
  // A question, or the settings on a phone, are open: they come first (side by side the settings leave the page in use).
  if (e.repeat || document.querySelector('dialog.ask[open], #settings-dialog:modal')) return;
  if (drawer?.open) drawer.close();
  void (key === 's' ? saveFile() : openFile());
}

/**
 * F6 (or Shift+F6) moves between the editor, the explanation in the panel's frame and the toast when one with a button
 * shows, as F6 moves between the parts of VS Code: editor, explanation, toast, editor. Shift+F6 goes the other way.
 * `inFrame`: the key was pressed in the frame.
 */
function paneKeys(e: KeyboardEvent, inFrame: boolean): void {
  if (!isPaneKey(e) || document.querySelector('dialog:modal')) return;
  e.preventDefault();
  // (What covers the editor or the explanation takes its stop in the round: `paneStops`.)
  const { home, panel: explanation } = paneStops();
  const stops: Stop[] = [home, explanation, ...(toast.hasButton ? ['toast' as const] : [])];
  const at = inFrame ? 'panel' : toast.focused ? 'toast' : explanation === 'grabber' && sheet?.focused ? explanation : home;
  focusStop(stops[(stops.indexOf(at) + (e.shiftKey ? stops.length - 1 : 1)) % stops.length]);
}

/** Puts the focus in the explanation: into the frame, then on what the panel shows (media/panel.js, `focusExplanation`). */
function toPanel(): void {
  (document.getElementById('panel') as HTMLIFrameElement | null)?.focus();
  panel.send({ type: 'focus' });
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
    w.addEventListener('keydown', (e) => settingsDialog?.escape(e));
    if (strip) w.addEventListener('keydown', strip.keys, true);
    refuseDrops(w);
  };
  frame?.addEventListener('load', watchFrame);
  if (frame?.contentDocument?.readyState === 'complete') watchFrame();

  // Leaving the page (closing it, reloading it, another version) would lose changes not saved to the file: the browser asks.
  window.addEventListener('beforeunload', (e) => {
    if (fileState.file && unsaved()) e.preventDefault();
  });

  on('menu-open-file', 'click', (e) => {
    drawer?.close();
    void openFile(e.currentTarget as HTMLElement);
  });
  on('menu-save', 'click', () => {
    drawer?.close();
    void saveFile();
  });
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

// ---- Start ----------------------------------------------------------------------------------

async function start(): Promise<void> {
  applyLanguage();
  put('version', `Bash Explainer ${VERSION}`);
  if (shared.deflated) {
    const text = await inflate(shared.deflated);
    if (text !== undefined) editor.setText(text, 1);
  }
  fileState.sampleLoaded(editor.text);
  showFile();
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
