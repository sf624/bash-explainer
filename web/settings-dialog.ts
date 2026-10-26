// The settings dialog of the web page: the settings of the VS Code extension that have a meaning here
// (src/settings.ts), one control each, applied at once. The page keeps them (localStorage).
import { closeSheet, reopenSheet } from './layout';
import { Lang } from '../src/i18n';
import { ask } from './kind-dialog';
import { Theme, THEMES } from './protocol';
import { TEXT as PAGE_TEXT } from './text';
import { CHROME } from './chrome-text';
import { readStored, STORAGE_KEYS, writeStored } from './storage';
import { checkValue, exportSettings, Ignored, importSettings, parseJsonc, Settings, SettingSpec, SettingText, SETTINGS, settingsFor } from '../src/settings';

/** The name of an exported settings file. */
const FILE_NAME = 'bash-explainer-settings.json';

/** The descriptions from package.json and package.nls*.json, put in by scripts/build-web.ts. */
declare const __SETTING_TEXT__: Record<Lang, Record<string, SettingText>>;

const TEXT = {
  en: {
    title: 'Settings',
    intro: 'Changes apply at once',
    saved: 'and are kept in this browser.',
    unsaved: '. This browser does not let the page keep them: they last until the page is closed.',
    sections: { display: 'Display', examples: 'Examples', checks: 'Checks', editor: 'Editor', data: 'Data' },
    sectionNav: 'Sections',
    search: 'Search settings',
    noMatch: 'No setting matches.',
    notTouch: 'Not on touch screens',
    themeDesc: 'The colours of the page: follow the browser, or always light or dark.',
    reset: 'Reset to defaults',
    resetDesc: 'Puts every setting back to its default. The theme and the size of the panes stay as they are.',
    resetAsk: 'Reset every setting to its default?',
    resetYes: 'Reset',
    resetDone: 'Every setting is back to its default.',
    clear: 'Clear stored data',
    clearDesc: 'Removes everything this page keeps in this browser: the settings, the theme, the size of the panes, read mode and the first-run tips. They go back to their defaults at once.',
    clearAsk: 'Clear all of it? This cannot be undone.',
    clearYes: 'Clear',
    clearNo: 'Cancel',
    cleared: 'Cleared. Everything is back to its defaults.',
    close: 'Close',
    add: 'Add',
    remove: (v: string) => `Remove ${v}`,
    codePlaceholder: 'a warning code, e.g. dbracket',
    none: 'None.',
    jsonError: (m: string) => `Not applied: ${m}`,
    notHere: 'Not on this page, as they are about VS Code (the depth, the examples and the following of its hover, the panel, the files it opens); some also apply in the Language Server:',
    browser: 'Follow the browser',
    io: 'Export and import',
    ioDesc: "Export writes the settings you changed from the defaults as JSON with the keys of VS Code's `settings.json`: use the file with the command-line tool (`--config`, or as `~/.config/bash-explainer/settings.json`), or paste it into VS Code's `settings.json`. Import replaces the settings of this page with those of a file; you can also drop the file on this dialog.",
    exportFile: 'Export to a file',
    copy: 'Copy',
    importFile: 'Import a file…',
    paste: 'Paste JSON to import',
    pasteImport: 'Import',
    exported: `Downloaded ${FILE_NAME}.`,
    copied: 'Copied the settings as JSON.',
    noClipboard: 'This browser does not let the page copy: the JSON is in the box below; select it and copy it.',
    imported: (n: number) => `Imported ${n} ${n === 1 ? 'setting' : 'settings'}; the others are back to their defaults.`,
    leftOut: 'Left out:',
    reasons: {
      unknown: () => 'not a setting',
      invalid: (d: string) => `wrong value (${d})`,
      elsewhere: () => 'not used on this page (it is for VS Code or the Language Server)',
    },
    importError: (m: string) => `Not imported, nothing changed: ${m}`,
  },
  ja: {
    title: '設定',
    intro: '変更はすぐに反映され',
    saved: '、このブラウザに保存されます。',
    unsaved: 'ます。このブラウザではページが設定を保存できないため、ページを閉じるまで有効です。',
    sections: { display: '表示', examples: '具体例', checks: 'チェック', editor: 'エディター', data: 'データ' },
    sectionNav: 'セクション',
    search: '設定を検索',
    noMatch: '一致する設定はありません。',
    notTouch: 'タッチ操作の画面では使われません',
    themeDesc: 'ページの配色です。ブラウザに合わせるか、常にライトまたはダークにします。',
    reset: '既定値に戻す',
    resetDesc: 'すべての設定を既定値に戻します。テーマと画面の分割の大きさはそのままです。',
    resetAsk: 'すべての設定を既定値に戻しますか？',
    resetYes: '戻す',
    resetDone: 'すべての設定を既定値に戻しました。',
    clear: '保存したデータを消去',
    clearDesc: 'このページがこのブラウザに保存しているものをすべて消します。設定、テーマ、画面の分割の大きさ、閲覧モード、初回のヒントです。すぐに既定の状態に戻ります。',
    clearAsk: 'すべて消去しますか？ 元に戻せません。',
    clearYes: '消去',
    clearNo: 'キャンセル',
    cleared: '消去しました。すべて既定の状態に戻りました。',
    close: '閉じる',
    add: '追加',
    remove: (v: string) => `${v} を削除`,
    codePlaceholder: '警告のコード（例: dbracket）',
    none: 'なし',
    jsonError: (m: string) => `反映していません: ${m}`,
    notHere: '次の設定は VS Code についてのもの（ホバーの深さ・具体例・追従、パネル、開くファイル）なので、このページにはありません。一部は Language Server でも使えます:',
    browser: 'ブラウザの言語に合わせる',
    io: 'エクスポートとインポート',
    ioDesc: 'エクスポートすると、既定値から変えた設定を、VS Code の `settings.json` と同じキーの JSON にします。そのファイルはコマンドラインツールで使ったり（`--config`、または `~/.config/bash-explainer/settings.json`）、VS Code の `settings.json` に貼り付けたりできます。インポートすると、このページの設定をファイルの内容に置き換えます。ファイルはこのダイアログにドロップしても読み込めます。',
    exportFile: 'ファイルにエクスポート',
    copy: 'コピー',
    importFile: 'ファイルからインポート…',
    paste: 'JSON を貼り付けてインポート',
    pasteImport: 'インポート',
    exported: `${FILE_NAME} をダウンロードしました。`,
    copied: '設定を JSON でコピーしました。',
    noClipboard: 'このブラウザではページからコピーできません。下の欄の JSON を選択してコピーしてください。',
    imported: (n: number) => `${n} 個の設定を読み込みました。それ以外の設定は既定値に戻しました。`,
    leftOut: '読み込まなかったキー:',
    reasons: {
      unknown: () => '設定にないキー',
      invalid: (d: string) => `値が正しくない（${d}）`,
      elsewhere: () => 'このページでは使わない設定（VS Code や Language Server 用）',
    },
    importError: (m: string) => `読み込めませんでした（設定は変わっていません）: ${m}`,
  },
};

export interface SettingsHost {
  get(): Settings;
  /** Applies and keeps the settings. */
  set(next: Settings): void;
  lang(): Lang;
  defaults(): Settings;
  /** Whether the page can keep the settings. */
  canSave(): boolean;
  /** Removes everything the page keeps in the browser and returns the page to its defaults. */
  clearAll(): void;
  /** Warning codes to suggest (those in the script now). */
  codes(): string[];
  /** The page's theme, the same as the menu's. */
  theme(): Theme;
  setTheme(t: Theme): void;
}

// Round 4 (proto/chrome-4): Common (what most people change) first; the rest under Advanced, folded.
type Section = 'common' | 'examples' | 'checks' | 'editor' | 'data';
const SECTIONS: Section[] = ['common', 'examples', 'checks', 'editor', 'data'];
/** The sections inside Advanced. */
const ADVANCED: Section[] = ['examples', 'checks', 'editor', 'data'];
/** The section of each setting that the page shows. */
const SECTION_OF: Record<string, Section> = {
  language: 'common', 'notes.idioms': 'common', 'notes.pitfalls': 'common', 'examples.enabled': 'common', 'hover.enabled': 'common', 'editor.wrap': 'common',
  'examples.disabled': 'examples', 'examples.placement': 'examples',
  shell: 'checks', bashVersion: 'checks', 'yq.flavor': 'checks', 'diagnostics.enabled': 'checks', 'diagnostics.ignore': 'checks',
  'diagnostics.embedded': 'checks', 'diagnostics.pitfalls': 'checks', customCommands: 'checks',
  'hints.names': 'editor', 'panel.animations': 'editor',
};
/** The order of the common settings (the theme goes after the language). */
const COMMON_ORDER = ['language', 'notes.idioms', 'notes.pitfalls', 'examples.enabled', 'hover.enabled', 'editor.wrap'];
/** Settings that only a mouse hover or a desktop editor uses: marked on a touch-only device. */
const MOUSE_ONLY = new Set(['hover.enabled']);
const touchOnly = (): boolean => typeof matchMedia === 'function' && matchMedia('(hover: none)').matches;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, props: Record<string, unknown> = {}, ...children: (Node | string)[]): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  Object.assign(e, props);
  e.append(...children);
  return e;
}

/**
 * The Markdown of a description, as text and code spans (`code`, **bold**), with VS Code's own syntax
 * read as well: `#bashExplainer.key#` (a link to a setting, also inside a code span) is the name of
 * the setting in code style, and a link that scrolls to it when the dialog has that setting;
 * `[text](https://…)` is a link, and `[text](command:…)` (which only VS Code can follow) is its text.
 */
export function rich(text: string): Node[] {
  const setting = (key: string): Node => {
    const code = el('code', { textContent: `bashExplainer.${key}` });
    if (!settingsFor('web').some((x) => x.key === key)) return code;
    const a = el('a', { href: `#setting-${key.replace(/\./g, '-')}`, className: 'setting-link' }, code);
    a.addEventListener('click', (e) => {
      e.preventDefault();
      const row = document.querySelector<HTMLElement>(`.setting[data-key="${key}"]`);
      row?.scrollIntoView({ block: 'center' });
      row?.querySelector<HTMLElement>('input, select, textarea, fieldset')?.focus();
    });
    return a;
  };
  return text.split(/(`[^`]*`|\*\*[^*]*\*\*|#bashExplainer\.[\w.]+#|\[[^\]]*\]\([^)]*\))/).filter(Boolean).map((part) => {
    const key = /^`?#bashExplainer\.([\w.]+)#`?$/.exec(part)?.[1];
    if (key) return setting(key);
    // (A setting of VS Code's own, `#editor.inlayHints.enabled#`, is its name.)
    if (part.startsWith('`')) return el('code', { textContent: part.slice(1, -1).replace(/^#([\w.]+)#$/, '$1') });
    if (part.startsWith('**')) return el('strong', { textContent: part.slice(2, -2) });
    const link = /^\[([^\]]*)\]\(([^)]*)\)$/.exec(part);
    if (link) return /^https?:/.test(link[2]) ? el('a', { href: link[2], textContent: link[1], target: '_blank', rel: 'noopener' }) : document.createTextNode(link[1]);
    return document.createTextNode(part);
  });
}

export class SettingsDialog {
  private dialog: HTMLDialogElement;
  /** The JSON being typed for customCommands, kept while it is not valid. */
  private draft?: string;
  /** What the last export or import did, shown until the dialog closes. */
  private status?: { error: boolean; text: string; ignored?: Ignored[] };
  /** The paste box: open or not, and its text. */
  private paste = { open: false, text: '' };
  /** Clearing the stored data (or resetting the settings): asked for, then done. */
  private clearing: 'done' | 'reset' | undefined;
  /** The text in the search field. */
  private query = '';
  /** Whether Advanced is unfolded (it unfolds by itself while a search is typed, or a link jumps into it). */
  private advancedOpen = false;

  constructor(dialog: HTMLDialogElement, private host: SettingsHost) {
    this.dialog = dialog;
    window.addEventListener('resize', () => {
      if (this.dialog.open) this.fitDescs();
    });
    dialog.addEventListener('close', () => {
      this.draft = undefined;
      this.status = undefined;
      this.query = '';
      this.paste = { open: false, text: '' };
    });
    // A settings file dropped on the dialog is imported.
    dialog.addEventListener('dragover', (e) => {
      if (e.dataTransfer?.types.includes('Files')) e.preventDefault();
    });
    dialog.addEventListener('drop', (e) => {
      const file = e.dataTransfer?.files[0];
      if (!file) return;
      e.preventDefault();
      void file.text().then((text) => this.importText(text));
    });
    // A click on the backdrop (outside the box) closes it.
    dialog.addEventListener('click', (e) => {
      if (e.target === dialog) closeSheet(dialog);
    });
  }

  get open(): boolean {
    return this.dialog.open;
  }

  show(): void {
    if (reopenSheet(this.dialog)) return;
    this.clearing = undefined;
    this.query = '';
    this.advancedOpen = false;
    this.render();
    this.dialog.showModal();
    this.dialog.querySelector<HTMLElement>('.settings-body')?.scrollTo(0, 0);
    this.markSection();
    this.fitDescs();
  }

  /** Draws the dialog again, after a change made in it or elsewhere (keeping the focus). */
  refresh(): void {
    if (!this.dialog.open) return;
    const focused = document.activeElement?.id;
    const scroll = this.dialog.querySelector('.settings-body')?.scrollTop ?? 0;
    this.render();
    this.dialog.querySelector('.settings-body')!.scrollTop = scroll;
    if (focused) document.getElementById(focused)?.focus();
  }

  private change(key: keyof Settings, value: unknown): void {
    this.host.set({ ...this.host.get(), [key]: value });
    this.refresh();
  }

  /** Replaces the settings with those of a settings file; on an error, changes nothing. */
  private importText(text: string): void {
    const t = TEXT[this.host.lang()];
    try {
      const read = importSettings(text, 'web');
      this.draft = undefined;
      this.host.set({ ...this.host.defaults(), ...read.settings });
      // The language may have changed with the settings.
      const after = TEXT[this.host.lang()];
      this.status = { error: false, text: after.imported(Object.keys(read.settings).length), ignored: read.ignored };
    } catch (e) {
      this.status = { error: true, text: t.importError((e as Error).message) };
    }
    this.refresh();
  }

  private exportFile(): void {
    const url = URL.createObjectURL(new Blob([exportSettings(this.host.get(), 'web')], { type: 'application/json' }));
    const a = el('a', { href: url, download: FILE_NAME });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    this.status = { error: false, text: TEXT[this.host.lang()].exported };
    this.refresh();
  }

  private async copy(): Promise<void> {
    const t = TEXT[this.host.lang()];
    const text = exportSettings(this.host.get(), 'web');
    try {
      await navigator.clipboard.writeText(text);
      this.status = { error: false, text: t.copied };
    } catch {
      // No clipboard (an insecure page, a refused permission): the text, ready to copy by hand.
      this.status = { error: true, text: t.noClipboard };
      this.paste = { open: true, text };
    }
    this.refresh();
    if (this.paste.open && this.paste.text === text) this.dialog.querySelector<HTMLTextAreaElement>('#settings-paste-text')?.select();
  }

  /** Export, import, and what the last one did. */
  private io(lang: Lang): HTMLElement {
    const t = TEXT[lang];
    const button = (id: string, text: string, fn: () => void) => {
      const b = el('button', { type: 'button', id, textContent: text });
      b.addEventListener('click', fn);
      return b;
    };
    const picker = el('input', { type: 'file', id: 'settings-file', accept: '.json,application/json', hidden: true });
    picker.addEventListener('change', () => {
      const file = picker.files?.[0];
      if (file) void file.text().then((text) => this.importText(text));
    });
    const area = el('textarea', { id: 'settings-paste-text', rows: 5, spellcheck: false, value: this.paste.text });
    area.setAttribute('aria-label', t.paste);
    area.addEventListener('input', () => {
      this.paste.text = area.value;
    });
    const details = el('details', { id: 'settings-paste', open: this.paste.open },
      el('summary', { textContent: t.paste }), area, button('settings-paste-import', t.pasteImport, () => this.importText(area.value)));
    details.addEventListener('toggle', () => {
      this.paste.open = details.open;
    });
    const status = el('div', { id: 'settings-io-status', className: 'settings-io-status' });
    status.setAttribute('role', 'status');
    if (this.status) {
      status.classList.toggle('error', this.status.error);
      status.append(el('p', { textContent: this.status.text }));
      if (this.status.ignored?.length) {
        status.append(el('p', { textContent: t.leftOut }), el('ul', {}, ...this.status.ignored.map((i) => el('li', {},
          el('code', { textContent: i.key }), ` — ${i.reason === 'invalid' ? t.reasons.invalid(i.detail!) : t.reasons[i.reason]()}`))));
      }
    }
    // Round 6: the same two lines and "More" as every other description.
    return el('section', { className: 'settings-group settings-io' },
      el('h4', { textContent: t.io }),
      this.descLine(el('p', { className: 'setting-desc' }, ...rich(t.ioDesc)), lang),
      el('div', { className: 'settings-io-buttons' },
        button('settings-export', t.exportFile, () => this.exportFile()),
        button('settings-copy', t.copy, () => void this.copy()),
        button('settings-import', t.importFile, () => picker.click()),
        picker),
      details, status);
  }

  /** The "Reset to defaults" group (in Data): a button, then the page's modal question. */
  private reset(lang: Lang): HTMLElement {
    const t = TEXT[lang];
    const status = el('div', { id: 'settings-reset-status', className: 'settings-io-status' });
    status.setAttribute('role', 'status');
    const reset = el('button', { type: 'button', id: 'settings-reset', textContent: t.reset });
    reset.addEventListener('click', () => {
      void ask({ id: 'reset', title: t.resetAsk, message: t.resetDesc, confirm: { id: 'settings-reset-yes', text: t.resetYes }, cancel: { id: 'settings-reset-no', text: t.clearNo } }, reset)
        .then((yes) => {
          if (!yes) return;
          this.draft = undefined;
          this.host.set(this.host.defaults());
          this.clearing = 'reset';
          this.refresh();
        });
    });
    if (this.clearing === 'reset') status.append(el('p', { textContent: t.resetDone }));
    return el('section', { className: 'settings-group settings-clear settings-reset' },
      el('h4', { textContent: t.reset }),
      this.descLine(el('p', { className: 'setting-desc', textContent: t.resetDesc }), lang),
      el('div', { className: 'settings-io-buttons' }, reset),
      status);
  }

  /** The "Clear stored data" group: a button, then the page's modal question before anything is removed. */
  private clear(lang: Lang): HTMLElement {
    const t = TEXT[lang];
    const button = (id: string, text: string, fn: () => void) => {
      const b = el('button', { type: 'button', id, textContent: text });
      b.addEventListener('click', fn);
      return b;
    };
    const status = el('div', { id: 'settings-clear-status', className: 'settings-io-status' });
    status.setAttribute('role', 'status');
    const clear = button('settings-clear', t.clear, () => {
      void ask({ id: 'clear', title: t.clearAsk, message: t.clearDesc, confirm: { id: 'settings-clear-yes', text: t.clearYes }, cancel: { id: 'settings-clear-no', text: t.clearNo } }, clear)
        .then((yes) => {
          if (!yes) return;
          this.draft = undefined;
          this.host.clearAll();
          this.clearing = 'done';
          this.refresh();
        });
    });
    if (this.clearing === 'done') status.append(el('p', { textContent: t.cleared }));
    return el('section', { className: 'settings-group settings-clear' },
      el('h4', { textContent: t.clear }),
      this.descLine(el('p', { className: 'setting-desc', textContent: t.clearDesc }), lang),
      el('div', { className: 'settings-io-buttons' }, clear),
      status);
  }

  private render(): void {
    const lang = this.host.lang();
    const t = TEXT[lang];
    const texts = __SETTING_TEXT__[lang];
    const s = this.host.get();
    const here = settingsFor('web');
    const close = el('button', { type: 'button', className: 'icon-btn settings-x', textContent: '×', title: t.close });
    close.setAttribute('aria-label', t.close);
    close.addEventListener('click', () => closeSheet(this.dialog));
    const elsewhere = SETTINGS.filter((x) => !x.surfaces.includes('web'));
    const c = CHROME[lang];
    // Round 6: Common's descriptions in at most two lines: the page's own shorter copy where the shared one is longer.
    const short: Record<string, string> = c.settingShort;
    const rowOf = (spec: SettingSpec) => this.row(spec, s, short[spec.key] ? { ...texts[spec.key], description: short[spec.key] } : spec.description ? { ...texts[spec.key], description: spec.description[lang === 'ja' ? 0 : 1] } : texts[spec.key], lang);
    const section = (id: Section, ...rows: HTMLElement[]) => {
      // Common is a section heading (big); the parts of Advanced are sub-headings (small capitals).
      const heading = id === 'common' ? el('h3', { className: 'settings-major', textContent: c.common }) : el('h4', { textContent: t.sections[id] });
      const e = el('section', { className: `settings-group${id === 'common' ? ' settings-common' : ''}`, id: `settings-section-${id}` }, heading, ...rows);
      e.dataset.section = id;
      return e;
    };
    // Round 5: a setting that does nothing on this device (the hover cards on a touch screen) is not shown.
    const useful = (x: SettingSpec) => !(MOUSE_ONLY.has(x.key) && touchOnly());
    const inSection = (id: Section) => here.filter((x) => SECTION_OF[x.key] === id && useful(x)).map(rowOf);
    const commonRows = () => {
      const rows = here.filter((x) => SECTION_OF[x.key] === 'common' && useful(x)).sort((a, b) => COMMON_ORDER.indexOf(a.key) - COMMON_ORDER.indexOf(b.key)).map(rowOf);
      return [rows[0], this.themeRow(lang), ...rows.slice(1)];
    };
    const io = this.io(lang);
    const clear = this.clear(lang);
    const reset = this.reset(lang);
    const search = el('input', { type: 'search', id: 'settings-search', placeholder: t.search, value: this.query, autocomplete: 'off', spellcheck: false });
    search.setAttribute('aria-label', t.search);
    search.addEventListener('input', () => {
      this.query = search.value;
      this.filter();
    });
    search.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && search.value) {
        e.preventDefault();
        e.stopPropagation();
        search.value = '';
        this.query = '';
        this.filter();
      }
    });
    const nav = el('nav', { className: 'settings-nav' });
    nav.setAttribute('aria-label', t.sectionNav);
    // A row of plain links ("Jump to: Display · Examples · …"), not tabs: they scroll the one page of settings.
    nav.append(el('span', { className: 'settings-jump', textContent: c.jumpTo }));
    nav.append(...SECTIONS.map((id) => {
      const a = el('a', { href: `#settings-section-${id}`, textContent: id === 'common' ? c.common : t.sections[id] });
      a.addEventListener('click', (e) => {
        e.preventDefault();
        if (ADVANCED.includes(id)) this.setAdvanced(true);
        const target = this.dialog.querySelector<HTMLElement>(`#settings-section-${id}`);
        if (target && !target.hidden) target.scrollIntoView({ block: 'start' });
        this.markSection(id);
      });
      return a;
    }));
    const none = el('p', { className: 'settings-nomatch', textContent: t.noMatch, hidden: true });
    none.setAttribute('role', 'status');
    this.dialog.replaceChildren(
      el('header', { className: 'settings-head' }, el('h2', { id: 'settings-title', textContent: t.title }), close),
      nav,
      el('div', { className: 'settings-body' },
        el('p', { className: 'settings-intro', textContent: `${t.intro}${lang === 'ja' ? '' : this.host.canSave() ? ' ' : ''}${this.host.canSave() ? t.saved : t.unsaved}` }),
        search,
        section('common', ...commonRows()),
        this.advanced(lang,
          this.namesSwitch(lang),
          section('examples', ...inSection('examples')),
          section('checks', ...inSection('checks')),
          section('editor', ...inSection('editor')),
          section('data', io, reset, clear),
          el('p', { className: 'settings-elsewhere' }, t.notHere, ' ', ...elsewhere.flatMap((x, i) => [i ? ', ' : '', el('code', { textContent: x.key })]))),
        none,
      ),
    );
    // No footer: X and Escape close, and every change applies at once. The section link of the part in view is marked.
    this.dialog.querySelector('.settings-body')?.addEventListener('scroll', () => this.markSection(), { passive: true });
    this.filter();
    this.markSection();
    this.fitDescs();
  }

  /** Advanced: a section heading that folds what most people leave as it is (folded when the dialog opens). */
  private advanced(lang: Lang, ...parts: HTMLElement[]): HTMLElement {
    const c = CHROME[lang];
    const toggle = el('button', { type: 'button', id: 'settings-advanced-toggle', className: 'settings-fold' },
      el('span', { className: 'fold-chev', textContent: '›' }), el('span', { textContent: c.advanced }));
    toggle.setAttribute('aria-controls', 'settings-advanced-body');
    toggle.addEventListener('click', () => this.setAdvanced(!this.advancedOpen));
    const note = el('p', { className: 'settings-advanced-note', textContent: c.advancedNote });
    const body = el('div', { id: 'settings-advanced-body', className: 'settings-advanced-body' }, ...parts);
    return el('section', { id: 'settings-advanced', className: 'settings-advanced' }, el('h3', { className: 'settings-major' }, toggle), note, body);
  }

  /** Folds or unfolds Advanced (a search unfolds it while it is typed). */
  private setAdvanced(open: boolean): void {
    this.advancedOpen = open;
    this.showAdvanced();
  }

  private showAdvanced(): void {
    const open = this.advancedOpen || !!this.query.trim();
    const body = this.dialog.querySelector<HTMLElement>('#settings-advanced-body');
    if (body) body.hidden = !open;
    this.dialog.querySelector('#settings-advanced-toggle')?.setAttribute('aria-expanded', String(open));
    this.dialog.querySelector('#settings-advanced')?.classList.toggle('open', open);
    this.fitDescs();
  }

  /** "Show VS Code setting names": off by default on the web; the names are for those who copy settings to VS Code. */
  private namesSwitch(lang: Lang): HTMLElement {
    const on = readStored(STORAGE_KEYS.settingNames) === '1';
    this.dialog.classList.toggle('show-keys', on);
    const box = el('input', { type: 'checkbox', id: 'settings-show-keys', checked: on });
    box.setAttribute('role', 'switch');
    box.addEventListener('change', () => {
      writeStored(STORAGE_KEYS.settingNames, box.checked ? '1' : '0');
      this.dialog.classList.toggle('show-keys', box.checked);
    });
    return el('label', { className: 'settings-show-keys', htmlFor: 'settings-show-keys' }, box, ' ', CHROME[lang].showKeys);
  }

  /** Marks (underlines) the section link of the part in view: the last section whose top is above the body's upper part. */
  private markSection(chosen?: Section): void {
    const body = this.dialog.querySelector<HTMLElement>('.settings-body');
    if (!body || !this.dialog.open) return;
    let current: string | undefined = chosen;
    if (!current) {
      // (Round 4: the section whose heading has passed the upper quarter of the body.)
      const top = body.getBoundingClientRect().top + Math.max(24, body.clientHeight * 0.25);
      for (const sec of body.querySelectorAll<HTMLElement>('.settings-group[data-section]')) {
        if (sec.hidden || !sec.getClientRects().length) continue;
        if (sec.getBoundingClientRect().top <= top || !current) current = sec.dataset.section;
      }
      // At the end of the scroll, the last section is the one in view.
      if (body.scrollTop + body.clientHeight >= body.scrollHeight - 2) {
        const shown = [...body.querySelectorAll<HTMLElement>('.settings-group[data-section]')].filter((x) => !x.hidden && x.getClientRects().length);
        current = shown[shown.length - 1]?.dataset.section ?? current;
      }
    }
    for (const a of this.dialog.querySelectorAll<HTMLElement>('.settings-nav a')) {
      const on = a.getAttribute('href') === `#settings-section-${current}`;
      if (on) a.setAttribute('aria-current', 'true');
      else a.removeAttribute('aria-current');
    }
  }

  /** Hides the rows (and sections) that the search text does not match. */
  private filter(): void {
    const q = this.query.trim().toLowerCase();
    let shown = 0;
    for (const group of this.dialog.querySelectorAll<HTMLElement>('.settings-group[data-section]')) {
      const items = [...group.querySelectorAll<HTMLElement>('.setting, .settings-io, .settings-clear')];
      let any = false;
      for (const item of items) {
        const hit = !q || (item.textContent ?? '').toLowerCase().includes(q);
        item.hidden = !hit;
        any ||= hit;
      }
      group.hidden = !any;
      if (any) shown++;
    }
    const none = this.dialog.querySelector<HTMLElement>('.settings-nomatch');
    if (none) none.hidden = shown > 0;
    this.showAdvanced();
    // A search that matches nothing under Advanced hides it whole.
    const adv = this.dialog.querySelector<HTMLElement>('#settings-advanced');
    if (adv) adv.hidden = !!q && ![...adv.querySelectorAll<HTMLElement>('.settings-group[data-section]')].some((g) => !g.hidden);
    const elsewhere = this.dialog.querySelector<HTMLElement>('.settings-elsewhere');
    if (elsewhere) elsewhere.hidden = !!q;
    for (const a of this.dialog.querySelectorAll<HTMLElement>('.settings-nav a')) {
      const target = this.dialog.querySelector<HTMLElement>(a.getAttribute('href')!);
      a.classList.toggle('off', !!target?.hidden);
    }
  }

  /**
   * Round 5: a setting's description on one line, cut at its end, with "More" after it when it is longer (the button
   * shows the whole text; "Less" folds it again). `fitDescs` hides "More" where the line holds the whole text.
   */
  private descLine(desc: HTMLElement, lang: Lang): HTMLElement {
    const c = CHROME[lang];
    desc.classList.add('clamp');
    const more = el('button', { type: 'button', className: 'link-btn desc-more', textContent: c.moreText });
    more.setAttribute('aria-expanded', 'false');
    more.addEventListener('click', () => {
      const open = !desc.classList.contains('open');
      desc.classList.toggle('open', open);
      more.textContent = open ? c.less : c.moreText;
      more.setAttribute('aria-expanded', String(open));
    });
    return el('div', { className: 'desc-line' }, desc, more);
  }

  /**
   * Round 6: a description shows two lines; "More" (at the end of the second line, at the right) only when the text
   * really takes more than two lines at the dialog's width. The cut falls between lines, and a code chip never wraps,
   * so no chip is cut in two. On a touch screen the whole text shows, with no "More".
   */
  fitDescs(): void {
    const touch = window.matchMedia('(pointer: coarse)').matches;
    for (const line of this.dialog.querySelectorAll<HTMLElement>('.desc-line')) {
      const desc = line.firstElementChild as HTMLElement | null;
      const more = line.querySelector<HTMLElement>('.desc-more');
      if (!desc || !more || desc.classList.contains('open') || !desc.clientWidth) continue;
      // Measured whole, at the full width. A chip wider than most of the line may wrap (it would run past the edge).
      desc.classList.remove('cut');
      desc.style.maxHeight = '';
      const chips = [...desc.querySelectorAll<HTMLElement>('code')];
      for (const code of chips) code.classList.remove('long');
      for (const code of chips) code.classList.toggle('long', code.getBoundingClientRect().width > desc.clientWidth * 0.7);
      const lh = parseFloat(getComputedStyle(desc).lineHeight) || 18;
      const long = !touch && desc.scrollHeight > lh * 2 + 2;
      more.hidden = !long;
      desc.classList.toggle('cut', long);
      if (!long) continue;
      // A wrapping chip that starts on the second line and goes on past it: the text ends before it, after one line.
      const top = desc.getBoundingClientRect().top;
      for (const code of chips) {
        const rects = code.getClientRects();
        if (rects.length < 2) continue;
        const line = Math.floor((rects[0].top - top + 2) / lh);
        if (line === 1) desc.style.maxHeight = `${lh}px`;
      }
    }
  }

  /** The theme: the same state as the menu's select. */
  private themeRow(lang: Lang): HTMLElement {
    const t = TEXT[lang];
    const names = PAGE_TEXT[lang];
    const id = 'setting-theme';
    const desc = el('p', { className: 'setting-desc', id: `${id}-desc`, textContent: t.themeDesc });
    const select = el('select', { id });
    select.setAttribute('aria-describedby', desc.id);
    const current = this.host.theme();
    select.append(...THEMES.map((x) => new Option(names.themes[x], x, false, x === current)));
    select.addEventListener('change', () => {
      this.host.setTheme(select.value as Theme);
      this.refresh();
    });
    const row = el('div', { className: 'setting setting-string' }, el('div', { className: 'setting-head' }, el('label', { htmlFor: id, textContent: names.theme })), this.descLine(desc, lang), select);
    row.dataset.key = 'theme';
    return row;
  }

  private row(spec: SettingSpec, s: Settings, text: SettingText, lang: Lang): HTMLElement {
    const t = TEXT[lang];
    const id = `setting-${spec.key.replace(/\./g, '-')}`;
    const title = spec.title[lang === 'ja' ? 0 : 1];
    const key = el('p', { className: 'setting-key', textContent: `bashExplainer.${spec.key}` });
    const desc = el('p', { className: 'setting-desc', id: `${id}-desc` }, ...rich(text.description));
    const row = el('div', { className: `setting setting-${spec.type}` });
    row.dataset.key = spec.key;
    const note = MOUSE_ONLY.has(spec.key) && touchOnly();
    if (note) row.classList.add('setting-touch-off');
    const touch = note ? [el('p', { className: 'setting-touch', textContent: t.notTouch })] : [];
    const value = s[spec.key];
    const describe = (c: HTMLElement) => c.setAttribute('aria-describedby', desc.id);

    if (spec.type === 'boolean') {
      const box = el('input', { type: 'checkbox', id, checked: value as boolean });
      describe(box);
      box.addEventListener('change', () => this.change(spec.key, box.checked));
      row.append(el('div', { className: 'setting-head' }, el('label', { htmlFor: id }, box, ' ', title)), this.descLine(desc, lang), key, ...touch);
      return row;
    }
    row.append(el('div', { className: 'setting-head' }, el('label', { htmlFor: id, id: `${id}-label`, textContent: title })), this.descLine(desc, lang), key, ...touch);

    if (spec.type === 'string') {
      const labels: Record<string, string> = { ...text.values, ...(spec.key === 'language' ? { auto: t.browser } : {}) };
      const select = el('select', { id });
      describe(select);
      // The language: the same words as the menu's ("Auto (follows the browser)", "English", "日本語").
      const languageName: Record<string, string> = { auto: CHROME[lang].autoBrowser, en: 'English', ja: '日本語' };
      select.append(...spec.enum!.map((v) => new Option(spec.key === 'language' && languageName[v] ? languageName[v] : labels[v] && labels[v] !== v ? `${v} — ${labels[v].replace(/`/g, '')}` : v, v, false, v === value)));
      select.addEventListener('change', () => this.change(spec.key, select.value));
      row.append(select);
    } else if (spec.type === 'number') {
      const input = el('input', { type: 'number', id, value: String(value), min: String(spec.minimum ?? '') });
      describe(input);
      input.addEventListener('change', () => {
        const n = Number(input.value);
        if (input.value !== '' && !checkValue(spec, n)) this.change(spec.key, n);
      });
      row.append(input);
    } else if (spec.type === 'array' && spec.items) {
      // A fixed list of values: a checkbox each.
      const list = value as string[];
      const fieldset = el('fieldset', { className: 'setting-choices', id });
      describe(fieldset);
      fieldset.setAttribute('aria-labelledby', `${id}-label`);
      fieldset.append(...spec.items.map((v) => {
        const box = el('input', { type: 'checkbox', id: `${id}-${v}`, checked: list.includes(v) });
        box.addEventListener('change', () => this.change(spec.key, spec.items!.filter((x) => (x === v ? box.checked : list.includes(x)))));
        const label = text.values?.[v];
        return el('label', { htmlFor: box.id }, box, ' ', el('code', { textContent: v }), ...(label && label !== v ? [' ', ...rich(label)] : []));
      }));
      row.append(fieldset);
    } else if (spec.type === 'array') {
      // Any strings: the list, and a field to add one.
      const list = value as string[];
      const items = el('ul', { className: 'setting-list' }, ...list.map((v) => {
        const remove = el('button', { type: 'button', textContent: '×', title: t.remove(v) });
        remove.setAttribute('aria-label', t.remove(v));
        remove.addEventListener('click', () => this.change(spec.key, list.filter((x) => x !== v)));
        return el('li', {}, el('code', { textContent: v }), remove);
      }));
      if (!list.length) items.append(el('li', { className: 'setting-none', textContent: t.none }));
      const input = el('input', { type: 'text', id, placeholder: t.codePlaceholder, autocomplete: 'off', spellcheck: false });
      describe(input);
      const datalist = el('datalist', { id: `${id}-codes` }, ...this.host.codes().filter((c) => !list.includes(c)).map((c) => new Option(c, c)));
      input.setAttribute('list', datalist.id);
      const add = el('button', { type: 'button', id: `${id}-add`, textContent: t.add });
      const addValue = () => {
        const v = input.value.trim();
        if (v && !list.includes(v)) this.change(spec.key, [...list, v]);
        else input.value = '';
      };
      add.addEventListener('click', addValue);
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          addValue();
        }
      });
      row.append(items, el('div', { className: 'setting-add' }, input, add), datalist);
    } else {
      // An object (customCommands): JSON, checked as it is typed, applied when it is valid.
      const area = el('textarea', { id, rows: 8, spellcheck: false, value: this.draft ?? (Object.keys(value as object).length ? JSON.stringify(value, null, 2) : '{}') });
      describe(area);
      const error = el('p', { className: 'setting-error', id: `${id}-error` });
      error.setAttribute('role', 'alert');
      const check = () => {
        let parsed: unknown;
        let why: string | undefined;
        try {
          parsed = parseJsonc(area.value.trim() || '{}');
          why = checkValue(spec, parsed);
        } catch (e) {
          why = (e as Error).message;
        }
        error.textContent = why ? t.jsonError(why) : '';
        area.setAttribute('aria-invalid', String(!!why));
        return why ? undefined : parsed;
      };
      area.addEventListener('input', () => {
        const parsed = check();
        this.draft = area.value;
        // Applied without drawing the dialog again, which would move the caret.
        if (parsed !== undefined) this.host.set({ ...this.host.get(), [spec.key]: parsed });
      });
      if (this.draft !== undefined) check();
      row.append(area, error);
    }
    return row;
  }
}
