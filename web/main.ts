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
import { ViewUpdate } from '@codemirror/view';
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
const shownName = () => file?.name ?? draftName ?? defaultName(kind);
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
    if (u.docChanged) {
      showFileSoon();
      showEmptyEditor();
    }
    if (u.selectionSet || u.docChanged) queueMicrotask(showProblemPosition);
    if (u.selectionSet || u.docChanged || u.viewportChanged) queueMicrotask(placeToast);
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
  // The phone's tab says which line it explains ("Explanation · Ln 8").
  put('tab-explain-line', blank ? '' : ` · ${TEXT[lang].line(line + 1)}`);
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
/** Round 4: a toast that the next edit dismisses ("Opened a.sh."). */
let toastUntilEdit = false;
function status(text: string, sticky = false, action?: StatusAction, opts: { untilEdit?: boolean } = {}): void {
  const el = $('status');
  undoOffered = false;
  toastUntilEdit = !!(text && opts.untilEdit);
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
  if (text && !mode.compare && !mode.panel) {
    // Round 4: every toast can be dismissed (✕), in the same row.
    const x = Object.assign(document.createElement('button'), { type: 'button', className: 'status-close' });
    x.innerHTML = '<svg aria-hidden="true"><use href="#i-close"/></svg>';
    x.setAttribute('aria-label', CHROME[lang].dismiss);
    x.addEventListener('click', () => status(''));
    el.append(x);
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
  put('drawer-title', t.menu);
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
  put('mode-read-label', c.read);
  put('mode-edit-label', c.edit);
  document.getElementById('modes')?.setAttribute('aria-label', c.modes);
}
showReadMode();
/** Read or Edit. Never moves the cursor (Editor.setReadMode keeps it and the scroll); Edit gives the editor the focus. */
function setReadModeTo(on: boolean): void {
  if (on !== readMode) {
    readMode = on;
    editor.setReadMode(readMode);
    writeStored(STORAGE_KEYS.readMode, readMode ? '1' : '0');
  }
  showReadMode();
  // Edit brings the keyboard: the editor takes the focus, with its cursor where it was (read mode leaves the focus where it is).
  if (!readMode) {
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
  // On a phone the editor goes to Edit (the keyboard, the paste menu) first.
  if (narrow.matches) setReadModeTo(false);
  clearEditor();
  editor.view.focus();
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
  if (button) {
    put('file-name', name);
    button.classList.toggle('draft', !saved);
    $('file-dot').hidden = !dirty;
    button.setAttribute('aria-label', `${name}${saved ? '' : ` (${c.notSavedYet})`}${dirty ? TEXT[lang].unsaved : ''}`);
    button.title = c.renameTip;
  }
  const saveDot = document.getElementById('save-dot');
  if (saveDot) saveDot.hidden = !dirty;
  $('menu-save-name').replaceChildren(...nameWithMark(name, dirty && saved));
  document.getElementById('menu-file-name')?.replaceChildren(...nameWithMark(name, dirty));
  document.getElementById('menu-file')?.classList.toggle('draft', !saved);
  const dot = document.getElementById('menu-dot');
  if (dot) dot.hidden = !dirty;
  document.getElementById('menu-open')?.setAttribute('aria-label', dirty && narrow.matches ? c.menuUnsaved : TEXT[lang].menu);
  const save = document.getElementById('save-btn');
  if (save) {
    save.title = saved ? c.saveTo(name) : c.saveAs(name);
    save.setAttribute('aria-label', `${c.save}${dirty ? TEXT[lang].unsaved : ''}`);
  }
  showFirstHint();
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
function setUpRename(): void {
  const button = document.getElementById('file-name-btn');
  const input = document.getElementById('file-name-input') as HTMLInputElement | null;
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
setUpRename();

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

/** Whether the long text of a download was shown once in this page. */
let downloadExplained = false;
/** "Downloaded a.sh." with a "Why?" that tells why a save downloads; the first time the whole text. */
function downloadedToast(name: string): void {
  const t = TEXT[lang];
  const c = CHROME[lang];
  if (!downloadExplained) {
    downloadExplained = true;
    return status(t.downloaded(name));
  }
  status(c.downloaded(name), false, { label: c.why, run: () => queueMicrotask(() => status(`${c.downloaded(name)} ${c.whyText}`)) });
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
  put('copy-md-label', c.copyMd);
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
  document.getElementById('menu-keys-list')?.replaceChildren(...c.keyRows.flatMap(([k, what]) => [
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
  put('tab-ref', c.reference);
  put('first-hint-text', narrow.matches ? (touchOnly() ? c.hintPhone : c.hintClick) : c.hintDesk4);
  put('hint-paste-label', narrow.matches ? c.useOwn : c.useOwnDesk);
  // (The phone's hint has room for "Open a file" without the dots: it opens the chooser at once.)
  put('hint-open-label', narrow.matches ? c.openFileShort : c.openFile);
  const auto = document.querySelector<HTMLOptionElement>('#lang option[value="auto"]');
  if (auto) auto.textContent = c.autoBrowser;
  // Round 3: Share (three items) and the phone menu's SHARE; the empty editor; the panel header's view slot.
  put('menu-h-share', c.menuShare);
  put('menu-copy-script-label', c.copyScript);
  put('menu-copy-label', c.copyMd);
  put('empty-paste-label', touchOnly() ? c.paste : c.pasteScript);
  put('empty-paste-key', touchOnly() ? '' : shortcut('V'));
  put('empty-open-label', c.openFile);
  put('empty-sample-label', c.loadSample);
  put('empty-drop', c.orDrop);
  put('sheet-back-label', c.backShort);
  document.getElementById('sheet-back')?.setAttribute('aria-label', c.backToScript);
  document.getElementById('sheet-back')?.setAttribute('title', c.backToScript);
  for (const where of ['top', 'phone']) {
    put(`view-list-${where}`, c.viewMeaning);
    put(`view-tree-${where}`, c.viewReading);
    document.getElementById(`views-${where}`)?.setAttribute('aria-label', c.viewLabel);
  }
  // The empty editor's block says it all: CodeMirror's placeholder would say it twice.
  if (document.getElementById('empty-editor')) editor.setPlaceholder('');
  const named: [string, string, string?][] = [
    ['open-btn', `${t.openTip}`, shortcut('O')], ['save-btn', c.saveAs(defaultName(kind)), shortcut('S')], ['ed-more', c.more],
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
  const kindName = t.kinds[kind] ?? kindInfo(kind).name;
  const shell = document.getElementById('shell-top') as HTMLSelectElement | null;
  const text = shell?.selectedOptions[0]?.textContent ?? '';
  // "Auto (bash)" → "bash" ("自動（bash）" too); a shell chosen is its own name.
  const short = /[(（]([^)）]+)[)）]/.exec(text)?.[1] ?? text;
  chip.textContent = short ? `${kindName} · ${short}` : kindName;
  document.getElementById('scope-chip')?.setAttribute('aria-label', `${CHROME[lang].script}: ${chip.textContent}`);
  document.getElementById('scope-chip')?.setAttribute('title', `${CHROME[lang].fileType}, ${CHROME[lang].shell}`);
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
on('tab-explain', 'click', () => showTab('explain'));
on('tab-problems', 'click', () => {
  showTab('explain');
  tab = 'problems';
  showTabs();
  sheet?.raise('half');
});
on('tab-ref', 'click', () => {
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

// The toast: at the bottom left of the editor's pane, 12px above the Problems strip (or its open list); on a phone 12px
// above the sheet's top edge. It never covers a control.
function placeToast(): void {
  const toast = document.getElementById('status');
  if (!toast || mode.compare || mode.panel) return;
  if (narrow.matches) {
    const top = sheetCol?.getBoundingClientRect().top ?? window.innerHeight;
    toast.style.left = '12px';
    toast.style.right = '12px';
    toast.style.maxWidth = '';
    toast.style.bottom = `${Math.round(window.innerHeight - top + 12)}px`;
    return;
  }
  const source = $('source').getBoundingClientRect();
  const problems = document.getElementById('problems');
  const floor = problems && !problems.hidden ? problems.getBoundingClientRect().top : source.bottom;
  toast.style.left = `${Math.round(source.left + 12)}px`;
  toast.style.right = '';
  toast.style.maxWidth = `${Math.round(Math.min(420, source.width - 24))}px`;
  toast.style.bottom = `${Math.round(window.innerHeight - floor + 12)}px`;
  // Round 4: never over the cursor's line: then at the right of the pane, or above the line when that covers it too.
  if (!toast.textContent) return;
  const at = editor.view.coordsAtPos(editor.view.state.selection.main.head);
  if (!at) return;
  const covers = (r: DOMRect) => r.top < at.bottom + 2 && r.bottom > at.top - 2;
  let box = toast.getBoundingClientRect();
  if (!covers(box)) return;
  toast.style.left = `${Math.round(source.right - 12 - box.width)}px`;
  box = toast.getBoundingClientRect();
  const line = editor.view.lineBlockAt(editor.view.state.selection.main.head);
  const lineLeft = editor.view.contentDOM.getBoundingClientRect().left;
  const textRight = lineLeft + editor.view.state.doc.lineAt(line.from).length * editor.view.defaultCharacterWidth;
  if (covers(box) && box.left < textRight) toast.style.bottom = `${Math.round(window.innerHeight - at.top + 12)}px`;
}
const toast = document.getElementById('status');
if (toast) new MutationObserver(placeToast).observe(toast, { childList: true });
window.addEventListener('resize', placeToast);

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
  let text: string | undefined;
  try {
    text = await navigator.clipboard.readText();
  } catch {
    text = undefined;
  }
  if (text === undefined) {
    // Refused, or a browser without the API: the editor takes the focus, and the toast says which key pastes.
    editor.view.focus();
    return status(CHROME[lang].pasteRefused(shortcut('V')));
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
    // Round 4: the longest common value: the shell's "Auto (POSIX sh)", yq's longest choice.
    const auto = [...select.options].find((o) => o.value === 'auto')?.textContent ?? '';
    const base = auto.replace(/\s*[(（].*$/, '');
    const common = id === 'shell-top' ? (lang === 'ja' ? `${base}（POSIX sh）` : `${base} (POSIX sh)`) : [...select.options].map((o) => o.textContent ?? '').reduce((a, b) => (b.length > a.length ? b : a), '');
    fitSelect(select, common);
  }
  // (The file type needs no minimum: the pickers are anchored at the right, and the type is left of the shell, so a
  // change of its width moves no other control; the spacer before it takes the difference.)
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
  panel.markSheet(snap !== 'full', !!lead);
  followFrameScroll();
}
/** The view row follows the frame's scroll: it moves up as the explanation does, and comes back at the top. */
function followFrameScroll(): void {
  const w = panel.frameWindow();
  const row = document.getElementById('view-row');
  if (!w || !row) return;
  const place = () => {
    const y = narrow.matches ? Math.min(w.scrollY, row.offsetHeight) : 0;
    row.style.transform = y ? `translateY(${-y}px)` : '';
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
