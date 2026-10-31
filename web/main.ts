// The web page: a script editor on the left, the extension's explanation panel on the right.
// The same script also runs two other pages of the site (web/mode.ts): `?view=panel`, only the explanation
// panel, filled by the page around it (the compare page); compare.html, the editor and two such frames.
// Everything runs here, in the browser; the script is never sent anywhere.
//
// This file holds the page's state (language, file kind, settings, theme) and wires the parts together:
// web/editor.ts (the script), web/panel-bridge.ts (the panel's frame), web/compare.ts (the compare page),
// web/share.ts (links), web/storage.ts (what the browser keeps), web/layout.ts (dividers and sheets),
// web/file-io.ts (opening a file, saving to one), web/editor-head.ts (the editor's header, its hint and empty block).
import { undo } from '@codemirror/commands';
import { ViewUpdate } from '@codemirror/view';
import { Analyzer, LineExplanation } from '../src/analyzer';
import { DocumentIssue, explainDocumentLine, ShellDocument, Shells } from '../src/document';
import { openDocument, shellsOf } from '../src/document-setup';
import { Lang, resolveLang } from '../src/i18n';
import { changedSettings, explainOptions, forcedShell, mergeSettings, readSettings, Settings } from '../src/settings';
import { detectKind } from '../src/hosts/detect';
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
import { ChosenFile, chooseFile, decodeText, fileContent, isMac, kindForFile, kindFromName, MAX_BYTES, saveText, withEol } from './file-io';
import { FileState } from './file-state';
import { FileNameControl } from './file-name';
import { linkWords, showMenuTexts } from './menu';
import { showChannel } from './banner';
import { ask, askReplaceWithSample } from './kind-dialog';
import { closeSheet, narrow, reopenSheet, setUpEdgeSwipe, setUpProblems, setUpSheet, setUpSplitter } from './layout';
import { mode } from './mode';
import { PanelBridge } from './panel-bridge';
import { Picker } from './picker';
import { showProblems } from './problem-list';
import { CopyState, Theme, THEMES } from './protocol';
import { Kind, KINDS } from './samples';
import { openingReady } from './opening';
import { setUpFocusRings } from './popover';
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
/** The file the script is (web/file-state.ts): where it came from, how that file holds its text, its name, and what is not saved. */
const fileState = new FileState<FileSystemFileHandle>();
/**
 * The one name the page gives the script, wherever it shows it (the header, Save, the title, the panel's `file`, Copy as
 * Markdown's `file:line`): the file's, else the name given, else "untitled" with the kind's extension. The analyzer needs
 * no more of the kind's path: only a name ending in `.zsh` or the like says another shell (`detectShell`).
 */
const scriptName = () => fileState.name(kindInfo(kind).fileName);
let shown: { explanation: LineExplanation; line: number } | undefined;

const analyzer = () => analyzers.get(lang) ?? analyzers.set(lang, new Analyzer(lang)).get(lang)!;

/** The script as the explainers see it, parsed once per change. */
function shellDocument(): ShellDocument | undefined {
  const text = withEol(editor.text, fileState.format.eol);
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

// ---- Editor ---------------------------------------------------------------------------------

let readMode = readStored(STORAGE_KEYS.readMode) === '1';
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
    showProblems(list, lang, (i) => editor.select(i.startLine, i.startCol, i.endLine, i.endCol));
  },
  changed(u: ViewUpdate) {
    // Undo would no longer undo the sample once the text changed again.
    if (u.docChanged && undoOffered && !loadingSample) status('');
    if (u.docChanged && !mode.panel) detectPasted(u);
    if (u.docChanged) showFileSoon();
    // In panel mode the page around sends every change as a message, which is handled at once.
    if (mode.panel || (!u.docChanged && !u.selectionSet)) return;
    clearTimeout(timer);
    timer = setTimeout(updatePanel, u.docChanged ? 150 : 60);
  },
  openSettings: () => settingsDialog?.show(),
  announce: (text) => announcer?.say(text),
}, { parent: $('editor'), text: shared.text ?? kindInfo(kind).sample, readMode, problems: mode.hasChrome });
editor.shade();
editor.placeCursor(shared.text ? 1 : kindInfo(kind).cursorLine);
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
  const explanation = explainDocumentLine(analyzer(), doc, line, lang, s, { ...explainOptions(settings), reading: needsReading(panel.panelState()) });
  shown = { explanation, line };
  announcer?.shown(explanation, line, lang);
  panel.show(panelUpdate({
    lang, explanation, file: scriptName(), line, lineText: doc.lines[line] ?? '', doc, wrap: settings['editor.wrap'],
    choice: choice(), detected: s.detected, placement: settings['examples.placement'],
    animations: settings['panel.animations'], marks: lineMarks(problemsShown, line), web: true, state: panel.panelState(),
  }));
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
  void writeClipboard(md).then((ok) => status(TEXT[lang][ok ? 'copied' : 'copyRefused']));
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
function status(text: string, sticky = false, action?: StatusAction): void {
  const el = $('status');
  undoOffered = false;
  el.replaceChildren(...(text ? [text] : []));
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
  clearTimeout(statusTimer);
  if (!sticky && text) statusTimer = setTimeout(() => status(''), 6000);
}

/** Goes to another page of the site with the script in the hash, in the same language and file kind. */
async function goWithScript(href: string): Promise<void> {
  const params = await scriptParams(lang, kind, editor.text);
  location.href = `${href}#${params}`;
}

function applyLanguage(): void {
  const t = TEXT[lang];
  document.documentElement.lang = lang;
  if (mode.compare) put('tagline', t.compareTagline);
  put('install', t.install);
  put('readtip-text', t.readTip);
  document.getElementById('readtip-close')?.setAttribute('aria-label', t.close);
  document.getElementById('readtip-close')?.setAttribute('title', t.close);
  placeReadTip();
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
  // The buttons drawn as icons say what they do to screen readers and in a tooltip.
  for (const [id, name] of [['sample', t.sample], ['readmode', t.readMode], ['settings-open', t.settings], ['menu-open', t.menu], ['menu-close', t.close], ['github', t.github], ['splitter', t.resize], ['problems-resize', t.resizeProblems]]) {
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
  kindPicker?.set(KINDS.map((k) => ({ value: k.kind, name: t.kinds[k.kind] ?? k.name, short: SHORT_KIND[k.kind] })), kind, t.kind);
  // The same choice as a select in the menu, for a phone.
  const menuKind = document.getElementById('kind-menu') as HTMLSelectElement | null;
  if (menuKind) {
    menuKind.replaceChildren(...KINDS.map((k) => new Option(t.kinds[k.kind] ?? k.name, k.kind)));
    menuKind.value = kind;
    menuKind.setAttribute('aria-label', t.kind);
    put('kind-label', t.kind);
  }
}

// The colours are CSS variables (theme.css): the attribute switches them, the editor and the panel follow.
$<HTMLSelectElement>('theme').addEventListener('change', (e) => {
  theme = (e.target as HTMLSelectElement).value as Theme;
  if (theme === 'auto') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.setAttribute('data-theme', theme);
  // When storage refuses, the choice lasts until the page is closed.
  if (theme === 'auto') removeStored(STORAGE_KEYS.theme);
  else writeStored(STORAGE_KEYS.theme, theme);
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

const dialogElement = document.getElementById('settings-dialog') as HTMLDialogElement | null;
const settingsDialog = dialogElement && new SettingsDialog(dialogElement, {
  get: () => settings,
  set: changeSettings,
  lang: () => lang,
  defaults: () => mergeSettings(),
  canSave: () => canSave,
  codes: () => codesSeen,
  clearAll: clearEverything,
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
  readMode = false;
  editor.setReadMode(false);
  showReadMode();
  resetSplit?.();
  resetProblems?.();
  showReadTip();
  showFile();
}
function showReadMode(): void {
  // The compare page has no such button.
  document.getElementById('readmode')?.setAttribute('aria-pressed', String(readMode));
}
showReadMode();
on('readmode', 'click', () => {
  hideReadTip(true);
  readMode = !readMode;
  editor.setReadMode(readMode);
  showReadMode();
  writeStored(STORAGE_KEYS.readMode, readMode ? '1' : '0');
});

// The first-run tip for the read-mode switch: shown while the switch is (a coarse pointer), until it has
// been closed or the switch used. It is kept in storage; without storage it shows again on the next visit.
function readTipSeen(): boolean {
  return readStored(STORAGE_KEYS.readTipSeen) === '1';
}
/** Puts the bubble under the switch (below the banner too, on the development version and previews) and points its arrow at the middle of the switch. */
function placeReadTip(): void {
  const tip = document.getElementById('readtip');
  const btn = document.getElementById('readmode');
  if (!tip || !btn || tip.hidden) return;
  const b = btn.getBoundingClientRect();
  tip.style.top = `${b.bottom + 10}px`;
  tip.style.setProperty('--arrow-x', `${b.left + b.width / 2 - tip.getBoundingClientRect().left}px`);
}
function hideReadTip(remember: boolean): void {
  const tip = document.getElementById('readtip');
  if (tip) tip.hidden = true;
  if (remember) writeStored(STORAGE_KEYS.readTipSeen, '1');
  // The first visit's hint over the editor waits for this tip: one at a time.
  showFile();
}
/** Shows the tip, if there is a switch to point at and the tip was not seen. */
function showReadTip(): void {
  const tip = document.getElementById('readtip');
  const btn = document.getElementById('readmode');
  if (tip && btn && window.matchMedia('(pointer: coarse)').matches && !readTipSeen()) {
    tip.hidden = false;
    placeReadTip();
  }
}
showReadTip();
window.addEventListener('resize', placeReadTip);
on('readtip-close', 'click', () => hideReadTip(true));
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
// The menu's items do what the editor's header does, and close the menu first. Copy a link says "Copied" on the item
// itself, and the menu stays.
for (const [item, run] of [['menu-sample', sampleAsked], ['menu-clear', clearEditor], ['menu-copy-script', copyScript]] as const) {
  on(item, 'click', () => {
    drawer?.close();
    run();
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

on('kind-menu', 'change', (e) => {
  chooseKind((e.target as HTMLSelectElement).value as Kind);
});

/**
 * Whether the editor holds no text of the user's: nothing, or a sample exactly as the page loads it. Read from
 * the text itself rather than from a record of edits, so that it also holds after an undo back to a sample.
 */
const untouched = (text: string) => !text.trim() || KINDS.some((k) => k.sample === text);
/** Whether the editor holds the user's own text: a file's (even an empty one), or text that is no sample. */
const ownText = () => fileState.own(editor.text, untouched);

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
  const before = fileState.snapshot();
  loadingSample = true;
  try { editor.setText(info.sample, info.cursorLine); } finally { loadingSample = false; }
  fileState.sampleLoaded(editor.text);
  showFile();
  // Undo brings back the text, and the file it was (its name, its handle, its line ends).
  const back = () => {
    undo(editor.view);
    fileState.restore(before);
    showFile();
    editor.focusUnlessTouch();
  };
  if (own) status(TEXT[lang].sampleLoaded, false, { label: TEXT[lang].undo, run: back, untilEdit: true });
}

/** "Load the sample" (⋯, the menu, the empty editor; the compare page's button). */
function sampleAsked(): void {
  // The user's own text asks for a confirmation and, once replaced, offers to undo; a sample or nothing does not.
  const own = ownText();
  if (own && !confirm(TEXT[lang].replace)) return;
  loadSample(own);
}
on('sample', 'click', sampleAsked);

/**
 * Empties the editor, as one step of the history: the toast offers to undo it ("Sample cleared" when it held a sample).
 * A file opened stays the file (its text is now empty, not saved).
 */
function clearEditor(): void {
  const t = TEXT[lang];
  if (!editor.text) return editor.view.focus();
  const wasSample = untouched(editor.text);
  loadingSample = true;
  try { editor.setText('', 1); } finally { loadingSample = false; }
  showFile();
  const back = () => {
    undo(editor.view);
    showFile();
    editor.focusUnlessTouch();
  };
  status(wasSample ? t.sampleCleared : t.editorCleared, false, { label: t.undo, run: back, untilEdit: true });
  editor.focusUnlessTouch();
}

function copyScript(): void {
  void writeClipboard(editor.text).then((ok) => status(TEXT[lang][ok ? 'scriptCopied' : 'copyRefused']));
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
  const params = await scriptParams(lang, kind, editor.text);
  const url = `${location.origin}${location.pathname}#${params}`;
  // Safari refuses a write that comes after the compression above (it is no longer the click's own turn): say so.
  if (!await writeClipboard(url)) {
    drawer?.close(); // the toast would lie under the open menu
    return status(TEXT[lang].copyRefused);
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
  loadSample: sampleAsked,
  clear: clearEditor,
  copyScript,
  holdsSample: () => KINDS.some((k) => k.sample === editor.text),
  tipShown: () => document.getElementById('readtip')?.hidden === false,
  status: (text) => status(text),
}) : undefined;
// Focus rings follow the input: none on a control given the focus back after a pointer (web/popover.ts).
setUpFocusRings();

/** Whether opening a file would lose text (web/file-state.ts): the editor's text differs from the one last opened, saved or loaded, and is the user's own. */
const unsaved = () => fileState.unsaved(editor.text, untouched);

let fileTimer: ReturnType<typeof setTimeout> | undefined;
/** The script's name as the page shows it (src/ui/fileName.ts): muted until saved or opened, ● for changes not saved. */
const nameView = () => fileState.view(editor.text, untouched, kindInfo(kind).fileName);
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
  if (named && named !== kind) return setKind(named);
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
  fileState.opened({ name: chosen.name, handle }, { eol: read.eol, bom: read.bom }, read.text);
  editor.openText(read.text);
  setKind(kindForFile(chosen.name, read.text));
  status(read.mixed ? t.mixedEol(chosen.name, read.eol === '\n' ? 'LF' : 'CRLF') : t.opened(chosen.name));
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
  const before = scriptName();
  const version = fileState.version();
  const r = await saveText(fileContent(text, fileState.format), scriptName(), fileState.handle());
  if (r.how === 'cancelled') return;
  // Another file was opened (or the name changed) while the browser asked (its permission bubble is not modal): that is not the file saved.
  if (fileState.version() !== version) return status(r.how === 'refused' ? t.notSaved(r.name) : r.how === 'written' ? t.saved(r.name) : t.downloaded(r.name));
  if (r.how === 'refused') {
    fileState.refused();
    return status(t.notSaved(r.name));
  }
  fileState.saved({ name: r.name, handle: r.how === 'written' ? r.handle : undefined }, text);
  showFile();
  status(r.how === 'written' ? t.saved(r.name) : t.downloaded(r.name));
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
    if (fileState.file && unsaved()) e.preventDefault();
  });

  on('menu-open-file', 'click', () => {
    drawer?.close();
    void openFile();
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
