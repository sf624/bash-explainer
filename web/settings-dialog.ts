// The settings dialog of the web page: the settings of the VS Code extension that have a meaning here
// (src/settings.ts), one control each, applied at once. The page keeps them (localStorage).
import { Lang } from '../src/i18n';
import { checkValue, parseJsonc, Settings, SettingSpec, SettingText, SETTINGS, settingsFor } from '../src/settings';

/** The descriptions from package.json and package.nls*.json, put in by scripts/build-web.ts. */
declare const __SETTING_TEXT__: Record<Lang, Record<string, SettingText>>;

const TEXT = {
  en: {
    title: 'Settings',
    intro: 'The settings of the VS Code extension that apply on this page. They take effect at once.',
    saved: 'They are kept in this browser.',
    unsaved: 'This browser does not let the page keep them: they last until the page is closed.',
    groups: { display: 'Display', checks: 'Checks', files: 'Files', dictionary: 'Dictionary' },
    reset: 'Reset to defaults',
    close: 'Close',
    add: 'Add',
    remove: (v: string) => `Remove ${v}`,
    codePlaceholder: 'a warning code, e.g. dbracket',
    none: 'None.',
    jsonError: (m: string) => `Not applied: ${m}`,
    notHere: 'Not on this page, as they are about VS Code (the hover, the inline summary, the panel, the files it opens); some also apply in the Language Server:',
    browser: 'Follow the browser',
  },
  ja: {
    title: '設定',
    intro: 'VS Code 拡張の設定のうち、このページで使えるものです。変更はすぐに反映されます。',
    saved: '設定はこのブラウザに保存されます。',
    unsaved: 'このブラウザではページが設定を保存できません。ページを閉じるまで有効です。',
    groups: { display: '表示', checks: 'チェック', files: 'ファイル', dictionary: '辞書' },
    reset: '既定値に戻す',
    close: '閉じる',
    add: '追加',
    remove: (v: string) => `${v} を削除`,
    codePlaceholder: '警告のコード（例: dbracket）',
    none: 'なし',
    jsonError: (m: string) => `反映していません: ${m}`,
    notHere: '次の設定は VS Code についてのもの（ホバー・インライン要約・パネル・開くファイル）なので、このページにはありません。一部は Language Server でも使えます:',
    browser: 'ブラウザの言語に合わせる',
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

  constructor(dialog: HTMLDialogElement, private host: SettingsHost) {
    this.dialog = dialog;
    dialog.addEventListener('close', () => {
      this.draft = undefined;
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

  private render(): void {
    const lang = this.host.lang();
    const t = TEXT[lang];
    const texts = __SETTING_TEXT__[lang];
    const s = this.host.get();
    const here = settingsFor('web');
    const groups = [...new Set(here.map((x) => x.group))];
    const close = el('button', { type: 'button', className: 'settings-x', textContent: '×', title: t.close });
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
        ...groups.map((g) => el('section', { className: 'settings-group' },
          el('h3', { textContent: t.groups[g] }),
          ...here.filter((x) => x.group === g).map((spec) => this.row(spec, s, texts[spec.key], lang)))),
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
