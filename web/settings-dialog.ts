// The settings dialog of the web page: the settings of the VS Code extension that have a meaning here
// (src/settings.ts), one control each, applied at once. The page keeps them (localStorage).
import { Lang } from '../src/i18n';
import { checkValue, exportSettings, Ignored, importSettings, parseJsonc, Settings, SettingSpec, SettingText, SETTINGS, settingsFor } from '../src/settings';

/** The name of an exported settings file. */
const FILE_NAME = 'bash-explainer-settings.json';

/** The descriptions from package.json and package.nls*.json, put in by scripts/build-web.ts. */
declare const __SETTING_TEXT__: Record<Lang, Record<string, SettingText>>;

const TEXT = {
  en: {
    title: 'Settings',
    intro: 'The settings of the VS Code extension that apply on this page, and the page\'s own. They take effect at once.',
    saved: 'They are kept in this browser.',
    unsaved: 'This browser does not let the page keep them: they last until the page is closed.',
    groups: { display: 'Display', checks: 'Checks', files: 'Files', dictionary: 'Dictionary' },
    reset: 'Reset to defaults',
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
    notHere: 'Not on this page, as they are about VS Code (the hover, the inline summary, the panel, the files it opens); some also apply in the Language Server:',
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
    intro: 'VS Code 拡張の設定のうち、このページで使えるものと、このページだけの設定です。変更はすぐに反映されます。',
    saved: '設定はこのブラウザに保存されます。',
    unsaved: 'このブラウザではページが設定を保存できません。ページを閉じるまで有効です。',
    groups: { display: '表示', checks: 'チェック', files: 'ファイル', dictionary: '辞書' },
    reset: '既定値に戻す',
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
    notHere: '次の設定は VS Code についてのもの（ホバー・インライン要約・パネル・開くファイル）なので、このページにはありません。一部は Language Server でも使えます:',
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
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, props: Record<string, unknown> = {}, ...children: (Node | string)[]): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  Object.assign(e, props);
  e.append(...children);
  return e;
}

/** The Markdown of a description, as text and code spans (`code`, **bold**). */
function rich(text: string): Node[] {
  return text.split(/(`[^`]*`|\*\*[^*]*\*\*)/).filter(Boolean).map((part) => {
    if (part.startsWith('`')) return el('code', { textContent: part.slice(1, -1) });
    if (part.startsWith('**')) return el('strong', { textContent: part.slice(2, -2) });
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
  /** Clearing the stored data: asked for, then done. */
  private clearing: 'ask' | 'done' | undefined;

  constructor(dialog: HTMLDialogElement, private host: SettingsHost) {
    this.dialog = dialog;
    dialog.addEventListener('close', () => {
      this.draft = undefined;
      this.status = undefined;
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
      if (e.target === dialog) dialog.close();
    });
  }

  get open(): boolean {
    return this.dialog.open;
  }

  show(): void {
    this.clearing = undefined;
    this.render();
    this.dialog.showModal();
    this.dialog.querySelector<HTMLElement>('.settings-body')?.scrollTo(0, 0);
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
    return el('section', { className: 'settings-group settings-io' },
      el('h3', { textContent: t.io }),
      el('p', { className: 'setting-desc' }, ...rich(t.ioDesc)),
      el('div', { className: 'settings-io-buttons' },
        button('settings-export', t.exportFile, () => this.exportFile()),
        button('settings-copy', t.copy, () => void this.copy()),
        button('settings-import', t.importFile, () => picker.click()),
        picker),
      details, status);
  }

  /** The "Clear stored data" group: a button, then a confirmation in the dialog before anything is removed. */
  private clear(lang: Lang): HTMLElement {
    const t = TEXT[lang];
    const button = (id: string, text: string, fn: () => void) => {
      const b = el('button', { type: 'button', id, textContent: text });
      b.addEventListener('click', fn);
      return b;
    };
    const ask = (state: 'ask' | undefined) => {
      this.clearing = state;
      this.refresh();
      document.getElementById(state ? 'settings-clear-yes' : 'settings-clear')?.focus();
    };
    const status = el('div', { id: 'settings-clear-status', className: 'settings-io-status' });
    status.setAttribute('role', 'status');
    const buttons = this.clearing === 'ask'
      ? [el('span', { textContent: t.clearAsk }), button('settings-clear-yes', t.clearYes, () => {
        this.draft = undefined;
        this.host.clearAll();
        this.clearing = 'done';
        this.refresh();
      }), button('settings-clear-no', t.clearNo, () => ask(undefined))]
      : [button('settings-clear', t.clear, () => ask('ask'))];
    if (this.clearing === 'done') status.append(el('p', { textContent: t.cleared }));
    return el('section', { className: 'settings-group settings-clear' },
      el('h3', { textContent: t.clear }),
      el('p', { className: 'setting-desc', textContent: t.clearDesc }),
      el('div', { className: 'settings-io-buttons' }, ...buttons),
      status);
  }

  private render(): void {
    const lang = this.host.lang();
    const t = TEXT[lang];
    const texts = __SETTING_TEXT__[lang];
    const s = this.host.get();
    const here = settingsFor('web');
    const groups = [...new Set(here.map((x) => x.group))];
    const close = el('button', { type: 'button', className: 'icon-btn settings-x', textContent: '×', title: t.close });
    close.setAttribute('aria-label', t.close);
    close.addEventListener('click', () => this.dialog.close());
    const reset = el('button', { type: 'button', id: 'settings-reset', textContent: t.reset });
    reset.addEventListener('click', () => {
      this.draft = undefined;
      this.host.set(this.host.defaults());
      this.refresh();
    });
    const done = el('button', { type: 'button', id: 'settings-done', textContent: t.close });
    done.addEventListener('click', () => this.dialog.close());
    const elsewhere = SETTINGS.filter((x) => !x.surfaces.includes('web'));
    this.dialog.replaceChildren(
      el('header', { className: 'settings-head' }, el('h2', { id: 'settings-title', textContent: t.title }), close),
      el('div', { className: 'settings-body' },
        el('p', { className: 'settings-intro', textContent: `${t.intro} ${this.host.canSave() ? t.saved : t.unsaved}` }),
        this.io(lang),
        ...groups.map((g) => el('section', { className: 'settings-group' },
          el('h3', { textContent: t.groups[g] }),
          ...here.filter((x) => x.group === g).map((spec) => this.row(spec, s, texts[spec.key] ?? { description: spec.description![lang === 'ja' ? 0 : 1] }, lang)))),
        this.clear(lang),
        el('p', { className: 'settings-elsewhere' }, t.notHere, ' ', ...elsewhere.flatMap((x, i) => [i ? ', ' : '', el('code', { textContent: x.key })])),
      ),
      el('footer', { className: 'settings-foot' }, reset, done),
    );
  }

  private row(spec: SettingSpec, s: Settings, text: SettingText, lang: Lang): HTMLElement {
    const t = TEXT[lang];
    const id = `setting-${spec.key.replace(/\./g, '-')}`;
    const title = spec.title[lang === 'ja' ? 0 : 1];
    const key = el('code', { className: 'setting-key', textContent: `bashExplainer.${spec.key}` });
    const desc = el('p', { className: 'setting-desc', id: `${id}-desc` }, ...rich(text.description));
    const row = el('div', { className: `setting setting-${spec.type}` });
    row.dataset.key = spec.key;
    const value = s[spec.key];
    const describe = (c: HTMLElement) => c.setAttribute('aria-describedby', desc.id);

    if (spec.type === 'boolean') {
      const box = el('input', { type: 'checkbox', id, checked: value as boolean });
      describe(box);
      box.addEventListener('change', () => this.change(spec.key, box.checked));
      row.append(el('div', { className: 'setting-head' }, el('label', { htmlFor: id }, box, ' ', title), key), desc);
      return row;
    }
    row.append(el('div', { className: 'setting-head' }, el('label', { htmlFor: id, id: `${id}-label`, textContent: title }), key), desc);

    if (spec.type === 'string') {
      const labels: Record<string, string> = { ...text.values, ...(spec.key === 'language' ? { auto: t.browser } : {}) };
      const select = el('select', { id });
      describe(select);
      select.append(...spec.enum!.map((v) => new Option(labels[v] && labels[v] !== v ? `${v} — ${labels[v].replace(/`/g, '')}` : v, v, false, v === value)));
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
