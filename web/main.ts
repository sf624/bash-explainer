// The web page: a script editor on the left, the extension's explanation panel on the right.
// The same script also runs two other pages of the site (web/mode.ts): `?view=panel`, only the explanation
// panel, filled by the page around it (the compare page); compare.html, the editor and two such frames.
// Everything runs here, in the browser; the script is never sent anywhere.
//
// This file holds the page's state (language, file kind, settings, theme) and wires the parts together:
// web/editor.ts (the script), web/panel-bridge.ts (the panel's frame), web/compare.ts (the compare page),
// web/share.ts (links), web/storage.ts (what the browser keeps), web/layout.ts (dividers and sheets).
import { undo } from '@codemirror/commands';
import { ViewUpdate } from '@codemirror/view';
import { Analyzer, LineExplanation } from '../src/analyzer';
import { explainDocumentLine, ShellDocument, Shells } from '../src/document';
import { openDocument, shellsOf } from '../src/document-setup';
import { Lang, resolveLang } from '../src/i18n';
import { changedSettings, explainOptions, forcedShell, mergeSettings, readSettings, Settings } from '../src/settings';
import { createUnbashParser } from '../src/syntax/adapters/unbash';
import { panelUpdate } from '../src/ui/panelView';
import { toPlainMarkdown } from '../src/ui/render';
import { CHANNEL, COMMIT, PR, UP, VERSION } from './build-info';
import { Compare, receiveState, toParent } from './compare';
import { $, on, put } from './dom';
import { Editor } from './editor';
import { closeSheet, narrow, reopenSheet, setUpEdgeSwipe, setUpProblems, setUpSheet, setUpSplitter } from './layout';
import { mode } from './mode';
import { PanelBridge } from './panel-bridge';
import { Picker } from './picker';
import { showProblems } from './problem-list';
import { CopyState, Theme, THEMES } from './protocol';
import { Kind, KINDS } from './samples';
import { SettingsDialog } from './settings-dialog';
import { inflate, readHash, scriptParams } from './share';
import { clearStoredData, readStored, removeStored, STORAGE_KEYS, writeStored } from './storage';
import { TEXT } from './text';

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
let shown: { explanation: LineExplanation; line: number } | undefined;

const analyzer = () => analyzers.get(lang) ?? analyzers.set(lang, new Analyzer(lang)).get(lang)!;

/** The script as the explainers see it, parsed once per change. */
function shellDocument(): ShellDocument | undefined {
  const text = editor.text;
  if (parsed && parsed.text === text && parsed.kind === kind) return parsed.doc;
  const doc = openDocument(text, kind, (shellText) => parser.parse(shellText));
  parsed = { text, kind, doc };
  return doc;
}

function shells(): Shells {
  const doc = editor.view.state.doc;
  const lines = Array.from({ length: Math.min(50, doc.lines) }, (_, i) => doc.line(i + 1).text);
  return shellsOf(lines, kindInfo(kind).fileName, forcedShell(settings));
}

// ---- Editor ---------------------------------------------------------------------------------

let readMode = readStored(STORAGE_KEYS.readMode) === '1';
/** The warning codes in the script, offered in the settings dialog. */
let codesSeen: string[] = [];
/** Whether the sample button is replacing the text, so that the offer to undo it stays. */
let loadingSample = false;
/** Whether the toast offers to undo the sample. */
let undoOffered = false;
let timer: ReturnType<typeof setTimeout> | undefined;

const editor = new Editor({
  kind: () => kind,
  lang: () => lang,
  settings: () => settings,
  document: shellDocument,
  shells,
  problems(list, codes) {
    codesSeen = codes;
    showProblems(list, lang, (i) => editor.select(i.startLine, i.startCol, i.endLine, i.endCol));
  },
  changed(u: ViewUpdate) {
    // Undo would no longer undo the sample once the text changed again.
    if (u.docChanged && undoOffered && !loadingSample) status('');
    // In panel mode the page around sends every change as a message, which is handled at once.
    if (mode.panel || (!u.docChanged && !u.selectionSet)) return;
    clearTimeout(timer);
    timer = setTimeout(updatePanel, u.docChanged ? 150 : 60);
  },
}, { parent: $('editor'), text: shared.text ?? kindInfo(kind).sample, readMode, problems: mode.hasChrome });
editor.shade();
editor.placeCursor(shared.text ? 1 : kindInfo(kind).cursorLine);

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
  reveal: mode.panel ? (span) => toParent({ type: 'bx-reveal', span }) : (span) => editor.selectSpan(span),
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
  const explanation = explainDocumentLine(analyzer(), doc, line, lang, s, explainOptions(settings));
  shown = { explanation, line };
  panel.show(panelUpdate({
    lang, explanation, file: kindInfo(kind).fileName, line, lineText: doc.lines[line] ?? '',
    choice: choice(), detected: s.detected, placement: settings['examples.placement'],
  }));
}

function copyMarkdown(): void {
  if (!shown) return;
  const md = toPlainMarkdown(shown.explanation, editor.view.state.doc.line(shown.line + 1).text, `${kindInfo(kind).fileName}:${shown.line + 1}`, lang);
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
    reveal: (span) => editor.selectSpan(span),
    highlight: (span) => editor.highlight(span),
    choose: setChoice,
  });
}

// ---- Toolbar --------------------------------------------------------------------------------

let statusTimer: ReturnType<typeof setTimeout> | undefined;
function status(text: string, sticky = false, action?: { label: string; run: () => void }): void {
  const el = $('status');
  undoOffered = false;
  el.replaceChildren(...(text ? [text] : []));
  if (text && action) {
    // A toast with one button (the sample's "Undo"); it hides when the button runs.
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'status-action';
    button.textContent = action.label;
    button.addEventListener('click', () => {
      action.run();
      status('');
    });
    el.append(button);
    undoOffered = true;
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
  put('readtip-text', t.readTip);
  document.getElementById('readtip-close')?.setAttribute('aria-label', t.close);
  document.getElementById('readtip-close')?.setAttribute('title', t.close);
  placeReadTip();
  put('lang-label', t.lang);
  put('menu-sample-label', t.sample);
  put('menu-share-label', t.share);
  put('menu-install-label', t.install);
  put('settings-label', t.settings);
  put('drawer-title', t.menu);
  panel.showActions();
  // The buttons drawn as icons say what they do to screen readers and in a tooltip.
  for (const [id, name] of [['sample', t.sample], ['share', t.share], ['readmode', t.readMode], ['settings-open', t.settings], ['menu-open', t.menu], ['menu-close', t.close], ['github', t.github], ['splitter', t.resize], ['problems-resize', t.resizeProblems]]) {
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
  put('channel-label', t.version);
  $<HTMLSelectElement>('channel')?.replaceChildren(
    new Option(CHANNEL === 'release' ? `${t.release} (v${VERSION})` : t.release, 'release', false, CHANNEL === 'release'),
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
  } else {
    put('dev-link-label', t.dev);
    $('dev-link').hidden = false;
  }
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
for (const [item, target] of [['menu-sample', 'sample'], ['menu-share', 'share']]) {
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
narrow.addEventListener('change', () => editor.keepCursorInView());

on('kind-menu', 'change', (e) => {
  const k = (e.target as HTMLSelectElement).value as Kind;
  kindPicker?.show(k);
  chooseKind(k);
});

function chooseKind(k: Kind): void {
  kind = k;
  const menuKind = document.getElementById('kind-menu') as HTMLSelectElement | null;
  if (menuKind) menuKind.value = k;
  editor.setKind(kind);
  // Only the reading changes; the text stays, unless there is none: then the new kind's sample is loaded.
  if (!editor.text.trim()) editor.setText(kindInfo(kind).sample, kindInfo(kind).cursorLine);
  editor.shade();
  updatePanel();
  editor.recheck();
}

on('sample', 'click', () => {
  const info = kindInfo(kind);
  const text = editor.text;
  // The user's own text asks for a confirmation and, once replaced, offers to undo; a sample or nothing does not.
  const own = text.trim() !== '' && !KINDS.some((k) => k.sample === text);
  if (own && !confirm(TEXT[lang].replace)) return;
  loadingSample = true;
  try { editor.setText(info.sample, info.cursorLine); } finally { loadingSample = false; }
  if (own) status(TEXT[lang].sampleLoaded, false, { label: TEXT[lang].undo, run: () => { undo(editor.view); editor.focusUnlessTouch(); } });
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
  window.history.replaceState(null, '', url);
  await navigator.clipboard.writeText(url);
  status(TEXT[lang].shared);
});

// ---- Start ----------------------------------------------------------------------------------

async function start(): Promise<void> {
  applyLanguage();
  put('version', `Bash Explainer ${VERSION}`);
  if (shared.deflated) {
    const text = await inflate(shared.deflated);
    if (text !== undefined) editor.setText(text, 1);
  }
  updatePanel();
  editor.recheck();
  // In panel mode: tell the page around that this copy is ready for a script.
  if (mode.panel) toParent({ type: 'bx-ready', channel: CHANNEL, version: VERSION, pr: PR, commit: COMMIT });
}

void start();
