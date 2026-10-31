// The settings of the web page: the settings of the VS Code extension that have a meaning here (src/settings.ts), one
// control each, applied at once, and kept by the page (localStorage). They come in sections (src/ui/settingsPage.ts):
// Common first, then Examples, Checks, Editor and Data, folded, each opened by its heading or its "Jump to" link; a
// search finds a setting by its title or its key. A description shows two lines, with "More" after the last word shown;
// on a touch screen it shows whole. Side by side the sheet lies over the editor, never wider than the editor's pane, so
// that the explanation the settings change stays in view (page.css); in the narrow layout it takes the whole screen.
// It comes back as it was left: the sections open, the search and the scroll (docs/design/chrome-redesign.md, C6).
import { closeSheet, reopenSheet } from './layout';
import { Lang } from '../src/i18n';
import { checkValue, exportSettings, Ignored, importSettings, parseJsonc, Settings, SettingSpec, SettingText, SETTINGS, settingsFor } from '../src/settings';
import { cutPoints, lastFit, pageSections, SETTINGS_SECTIONS, SettingsSection, settingMatches } from '../src/ui/settingsPage';
import { Theme, THEMES } from './protocol';
import { readStored, STORAGE_KEYS, writeStored } from './storage';
import { SETTINGS_FILE, SETTINGS_TEXT as TEXT, TEXT as PAGE_TEXT } from './text';

/** The descriptions from package.json and package.nls*.json, put in by scripts/build-web.ts. */
declare const __SETTING_TEXT__: Record<Lang, Record<string, SettingText>>;

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
  /** The page's theme: the same choice as the menu's. */
  theme(): Theme;
  setTheme(t: Theme): void;
  /** The editor's pane, which the sheet covers side by side and is never wider than. */
  pane(): HTMLElement | null;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, props: Record<string, unknown> = {}, ...children: (Node | string)[]): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  Object.assign(e, props);
  e.append(...children);
  return e;
}

const pick = (lang: Lang, pair: [string, string]) => pair[lang === 'ja' ? 0 : 1];
/** A touch screen: descriptions show whole, and a setting named in one is plain text (a link in a sentence is no 44 px target). */
const coarse = () => window.matchMedia('(pointer: coarse)').matches;
/** No pointer that hovers: the settings that need one are left out. */
const hovers = () => !window.matchMedia('(hover: none)').matches;
/** "Show VS Code setting names": the keys under the titles, in the options and in the descriptions. */
const keysShown = () => readStored(STORAGE_KEYS.settingNames) === '1';

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
  /** The text of the search, the sections unfolded and the scroll: kept from one opening to the next. */
  private query = '';
  private unfolded = new Set<SettingsSection>();
  private scroll = 0;
  /** Each description's own nodes, kept whole while `fitDescs` cuts what it shows. */
  private whole = new WeakMap<HTMLElement, Node[]>();

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
    // The width follows the editor's pane, and the cut of the descriptions the width.
    const fit = () => {
      if (!this.dialog.open) return;
      this.fitWidth();
      this.fitDescs();
    };
    window.addEventListener('resize', fit);
    const pane = host.pane();
    if (pane && typeof ResizeObserver === 'function') new ResizeObserver(fit).observe(pane);
  }

  get open(): boolean {
    return this.dialog.open;
  }

  show(): void {
    if (reopenSheet(this.dialog)) return;
    this.clearing = undefined;
    this.render();
    this.fitWidth();
    this.dialog.showModal();
    this.fitDescs();
    this.body().scrollTop = this.scroll;
  }

  /** Draws the dialog again, after a change made in it or elsewhere (keeping the focus and the scroll). */
  refresh(): void {
    if (!this.dialog.open) return;
    const focused = document.activeElement?.id;
    const scroll = this.scroll;
    this.render();
    this.body().scrollTop = scroll;
    if (focused) document.getElementById(focused)?.focus();
  }

  private body(): HTMLElement {
    return this.dialog.querySelector<HTMLElement>('.settings-body')!;
  }

  /** Side by side, the sheet is never wider than the editor's pane (page.css reads `--pane-w`). */
  private fitWidth(): void {
    const pane = this.host.pane();
    if (pane) this.dialog.style.setProperty('--pane-w', `${Math.floor(pane.getBoundingClientRect().width)}px`);
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
    const a = el('a', { href: url, download: SETTINGS_FILE });
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

  /**
   * The Markdown of a description, as text and code spans (`code`, **bold**), with VS Code's own syntax read as well:
   * `#bashExplainer.key#` (a link to a setting, also inside a code span) is the setting's title, or its key with "Show VS
   * Code setting names", and a link that goes to it when the dialog has it (plain text on a touch screen);
   * `[text](https://…)` is a link, and `[text](command:…)` (which only VS Code can follow) is its text.
   */
  private rich(text: string, lang: Lang): Node[] {
    const setting = (key: string): Node => {
      const spec = settingsFor('web').find((x) => x.key === key);
      const name = !spec || keysShown() ? el('code', { textContent: `bashExplainer.${key}` }) : el('span', { className: 'setting-name', textContent: pick(lang, spec.title) });
      if (!spec || coarse()) return name;
      const a = el('a', { href: `#${rowId(key)}`, className: 'setting-link' }, name);
      a.addEventListener('click', (e) => {
        e.preventDefault();
        this.goTo(key);
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

  /** Goes to a setting named in a description: its section unfolds, and its control takes the focus. */
  private goTo(key: string): void {
    const row = this.dialog.querySelector<HTMLElement>(`.setting[data-key="${key}"]`);
    const section = row?.closest<HTMLElement>('[data-section]')?.dataset.section as SettingsSection | undefined;
    if (!row || !section) return;
    if (row.hidden) this.clearSearch();
    this.unfolded.add(section);
    this.showSections();
    row.scrollIntoView({ block: 'center' });
    row.querySelector<HTMLElement>('input, select, textarea, fieldset')?.focus({ preventScroll: true });
  }

  /** "Jump to": clears the search, unfolds the section and brings its heading to the top, with the focus on it. */
  private jump(id: SettingsSection): void {
    this.clearSearch();
    this.unfolded.add(id);
    this.showSections();
    const section = this.dialog.querySelector<HTMLElement>(`#settings-section-${id}`)!;
    section.scrollIntoView({ block: 'start' });
    section.querySelector<HTMLElement>('.settings-fold, h3[tabindex]')!.focus({ preventScroll: true });
  }

  private clearSearch(): void {
    if (!this.query) return;
    this.query = '';
    this.dialog.querySelector<HTMLInputElement>('#settings-search')!.value = '';
    this.filter();
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
    const part = el('div', { className: 'settings-part settings-io' },
      el('h4', { id: 'settings-io-title', textContent: t.io }),
      this.descLine(el('p', { className: 'setting-desc', id: 'settings-io-desc' }, ...this.rich(t.ioDesc, lang)), t.io, lang),
      el('div', { className: 'settings-io-buttons' },
        button('settings-export', t.exportFile, () => this.exportFile()),
        button('settings-copy', t.copy, () => void this.copy()),
        button('settings-import', t.importFile, () => picker.click()),
        picker),
      details, status);
    part.dataset.title = t.io;
    return part;
  }

  /** "Clear stored data": a button, then a confirmation in the dialog before anything is removed. */
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
    const part = el('div', { className: 'settings-part settings-clear' },
      el('h4', { textContent: t.clear }),
      this.descLine(el('p', { className: 'setting-desc', id: 'settings-clear-desc', textContent: t.clearDesc }), t.clear, lang),
      el('div', { className: 'settings-io-buttons' }, ...buttons),
      status);
    part.dataset.title = t.clear;
    return part;
  }

  private render(): void {
    const lang = this.host.lang();
    const t = TEXT[lang];
    const texts = __SETTING_TEXT__[lang];
    const s = this.host.get();
    const close = el('button', { type: 'button', id: 'settings-close', className: 'icon-btn settings-x', textContent: '×', title: t.close });
    close.setAttribute('aria-label', t.close);
    close.addEventListener('click', () => closeSheet(this.dialog));
    const reset = el('button', { type: 'button', id: 'settings-reset', textContent: t.reset });
    reset.addEventListener('click', () => {
      this.draft = undefined;
      this.host.set(this.host.defaults());
      this.refresh();
    });
    const done = el('button', { type: 'button', id: 'settings-done', textContent: t.close });
    done.addEventListener('click', () => this.dialog.close());
    const search = el('input', { type: 'search', id: 'settings-search', placeholder: t.searchHint, value: this.query, autocomplete: 'off', spellcheck: false });
    search.setAttribute('aria-label', t.search);
    search.addEventListener('input', () => {
      this.query = search.value;
      this.filter();
    });
    // Esc in a search with text clears it; in an empty one, it closes the sheet.
    search.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape' || !search.value) return;
      e.preventDefault();
      e.stopPropagation();
      this.clearSearch();
    });
    // "Jump to": plain links in a row (not tabs), which scroll the one page of settings.
    const nav = el('nav', { className: 'settings-nav', id: 'settings-nav' }, el('span', { className: 'settings-jump', textContent: t.jumpTo }),
      ...SETTINGS_SECTIONS.map((id) => {
        const a = el('a', { href: `#settings-section-${id}`, id: `settings-jump-${id}`, textContent: t.sections[id] });
        a.addEventListener('click', (e) => {
          e.preventDefault();
          this.jump(id);
        });
        return a;
      }));
    nav.setAttribute('aria-label', t.sectionNav);
    const rowOf = (spec: SettingSpec) => this.row(spec, s, spec.description ? { ...texts[spec.key], description: pick(lang, spec.description) } : texts[spec.key], lang);
    const sections = pageSections(settingsFor('web'), hovers()).map(({ section, specs }) => {
      const rows = specs.map(rowOf);
      // The theme comes after the language; Data holds the page's own parts.
      if (section === 'common') rows.splice(1, 0, this.themeRow(lang));
      if (section === 'data') rows.push(this.io(lang), this.clear(lang));
      return this.section(section, rows, lang);
    });
    const none = el('p', { className: 'settings-nomatch', id: 'settings-nomatch', textContent: t.noMatch, hidden: true });
    none.setAttribute('role', 'status');
    const elsewhere = SETTINGS.filter((x) => !x.surfaces.includes('web'));
    const body = el('div', { className: 'settings-body' },
      el('p', { className: 'settings-intro', textContent: this.host.canSave() ? t.introSaved : t.introUnsaved }),
      search, none,
      ...sections,
      this.namesSwitch(lang),
      el('p', { className: 'settings-elsewhere' }, t.notHere, ' ', ...elsewhere.flatMap((x, i) => [i ? ', ' : '', el('code', { textContent: x.key })])));
    body.addEventListener('scroll', () => {
      this.scroll = body.scrollTop;
    }, { passive: true });
    this.dialog.replaceChildren(
      el('header', { className: 'settings-head' }, el('h2', { id: 'settings-title', textContent: t.title }), close),
      nav,
      body,
      el('footer', { className: 'settings-foot' }, reset, done),
    );
    this.filter();
  }

  /** A section: Common shows its rows; the others fold under their heading, a button. */
  private section(id: SettingsSection, rows: HTMLElement[], lang: Lang): HTMLElement {
    const name = TEXT[lang].sections[id];
    const items = el('div', { className: 'settings-items', id: `settings-items-${id}` }, ...rows);
    let heading: HTMLElement;
    if (id === 'common') {
      // (Focusable from "Jump to" only.)
      heading = el('h3', { className: 'settings-major', id: 'settings-head-common', tabIndex: -1, textContent: name });
    } else {
      const fold = el('button', { type: 'button', id: `settings-fold-${id}`, className: 'settings-fold' }, el('span', { className: 'fold-chev', textContent: '›' }), name);
      fold.firstElementChild!.setAttribute('aria-hidden', 'true');
      fold.setAttribute('aria-controls', items.id);
      fold.addEventListener('click', () => {
        if (this.unfolded.has(id)) this.unfolded.delete(id);
        else this.unfolded.add(id);
        this.showSections();
      });
      heading = el('h3', { className: 'settings-major' }, fold);
    }
    const section = el('section', { className: 'settings-group', id: `settings-section-${id}` }, heading, items);
    section.dataset.section = id;
    return section;
  }

  /** Unfolds the sections opened, and every section while a search is typed. */
  private showSections(): void {
    const searching = !!this.query.trim();
    for (const section of this.dialog.querySelectorAll<HTMLElement>('.settings-group')) {
      const id = section.dataset.section as SettingsSection;
      const open = id === 'common' || searching || this.unfolded.has(id);
      section.querySelector<HTMLElement>('.settings-items')!.hidden = !open;
      section.querySelector('.settings-fold')?.setAttribute('aria-expanded', String(open));
      section.classList.toggle('open', open);
    }
    this.fitDescs();
  }

  /** Hides the rows (and the sections) that the search does not find. */
  private filter(): void {
    const q = this.query.trim();
    let found = 0;
    for (const section of this.dialog.querySelectorAll<HTMLElement>('.settings-group')) {
      let any = false;
      for (const row of section.querySelectorAll<HTMLElement>('.setting, .settings-part')) {
        row.hidden = !settingMatches(q, row.dataset.title!, row.dataset.key);
        any ||= !row.hidden;
      }
      section.hidden = !any;
      if (any) found++;
    }
    this.dialog.querySelector<HTMLElement>('#settings-nomatch')!.hidden = found > 0;
    for (const e of this.dialog.querySelectorAll<HTMLElement>('.settings-elsewhere, .settings-show-keys')) e.hidden = !!q;
    this.showSections();
  }

  /** "Show VS Code setting names": off by default; the names are for those who copy settings to VS Code. */
  private namesSwitch(lang: Lang): HTMLElement {
    const box = el('input', { type: 'checkbox', id: 'settings-show-keys', checked: keysShown() });
    box.setAttribute('role', 'switch');
    box.addEventListener('change', () => {
      // When storage refuses, the names stay as they are.
      writeStored(STORAGE_KEYS.settingNames, box.checked ? '1' : '0');
      this.refresh();
    });
    return el('label', { className: 'settings-show-keys', htmlFor: box.id }, box, ' ', TEXT[lang].showKeys);
  }

  /** A description in two lines at most, with "More" after the last word shown when it is longer (`fitDescs`). */
  private descLine(desc: HTMLElement, title: string, lang: Lang): HTMLElement {
    const t = TEXT[lang];
    const more = el('button', { type: 'button', id: `${desc.id}-more`, className: 'link-btn desc-more', textContent: t.more });
    more.setAttribute('aria-expanded', 'false');
    more.setAttribute('aria-label', t.moreAbout(title));
    more.addEventListener('click', () => {
      const open = !desc.classList.contains('open');
      desc.classList.toggle('open', open);
      more.textContent = open ? t.less : t.more;
      more.setAttribute('aria-label', open ? t.lessAbout(title) : t.moreAbout(title));
      more.setAttribute('aria-expanded', String(open));
      this.fitDescs();
      more.focus();
    });
    desc.classList.add('clamp');
    desc.dataset.more = more.id;
    return el('div', { className: 'desc-line' }, desc, more);
  }

  /**
   * Cuts each description shown to two lines, with "… More" right after the last word shown, at the last place where
   * both fit (src/ui/settingsPage.ts: before a blank, after a Japanese character, before a code span); the rest stays for
   * a screen reader (visually hidden). An open one shows whole, with "Less" after it. On a touch screen every description
   * shows whole, with no "More".
   */
  fitDescs(): void {
    if (!this.dialog.open) return;
    const touch = coarse();
    for (const desc of this.dialog.querySelectorAll<HTMLElement>('.setting-desc.clamp')) {
      const more = this.dialog.querySelector<HTMLElement>(`#${desc.dataset.more}`)!;
      if (!this.whole.has(desc)) this.whole.set(desc, [...desc.childNodes]);
      const whole = this.whole.get(desc)!;
      desc.replaceChildren(...whole);
      desc.after(more);
      // (A description in a folded section or a row the search hides is measured when it shows.)
      if (!desc.clientWidth) continue;
      const lh = parseFloat(getComputedStyle(desc).lineHeight);
      // (Within half a line: a code span or the button may make a line a little taller than the line height.)
      const fits = () => desc.scrollHeight <= lh * 2.5;
      more.hidden = touch || fits();
      if (more.hidden) continue;
      if (desc.classList.contains('open')) {
        desc.append(' ', more);
        continue;
      }
      const cuts = cutPoints(whole.map((n) => (n.nodeType === Node.TEXT_NODE ? (n as Text).data : null)));
      const rest = el('span', { className: 'sr-only' });
      const ell = el('span', { className: 'desc-ell', textContent: '… ' });
      ell.setAttribute('aria-hidden', 'true');
      const cutAt = (c: number) => {
        const [i, k] = cuts[Math.max(0, c)] ?? [whole.length, 0];
        const n = whole[i];
        const text = n?.nodeType === Node.TEXT_NODE ? (n as Text).data : undefined;
        const head = text === undefined ? [] : [document.createTextNode(text.slice(0, k).trimEnd())];
        rest.replaceChildren(...(text === undefined ? whole.slice(i) : [document.createTextNode(text.slice(k)), ...whole.slice(i + 1)]));
        desc.replaceChildren(...whole.slice(0, i), ...head, ell, more, rest);
        return fits();
      };
      cutAt(lastFit(cuts.length, cutAt));
    }
  }

  /** The theme: the same choice as the menu's. */
  private themeRow(lang: Lang): HTMLElement {
    const t = TEXT[lang];
    const id = 'setting-theme';
    const select = el('select', { id });
    select.append(...THEMES.map((x) => new Option(PAGE_TEXT[lang].themes[x], x, false, x === this.host.theme())));
    select.addEventListener('change', () => {
      this.host.setTheme(select.value as Theme);
      this.refresh();
    });
    const desc = el('p', { className: 'setting-desc', id: `${id}-desc`, textContent: t.themeDesc });
    select.setAttribute('aria-describedby', desc.id);
    // (Not a setting of VS Code: no key to show or to search for.)
    const row = el('div', { className: 'setting setting-string', id: `${id}-row` }, el('div', { className: 'setting-head' }, el('label', { htmlFor: id, textContent: t.theme })), this.descLine(desc, t.theme, lang), select);
    row.dataset.title = t.theme;
    return row;
  }

  private row(spec: SettingSpec, s: Settings, text: SettingText, lang: Lang): HTMLElement {
    const t = TEXT[lang];
    const id = rowId(spec.key);
    const title = pick(lang, spec.title);
    const keys = keysShown();
    const key = keys ? [el('p', { className: 'setting-key', textContent: `bashExplainer.${spec.key}` })] : [];
    const desc = el('p', { className: 'setting-desc', id: `${id}-desc` }, ...this.rich(text.description, lang));
    const row = el('div', { className: `setting setting-${spec.type}`, id: `${id}-row` });
    row.dataset.key = spec.key;
    row.dataset.title = title;
    const value = s[spec.key];
    const describe = (c: HTMLElement) => c.setAttribute('aria-describedby', desc.id);

    if (spec.type === 'boolean') {
      const box = el('input', { type: 'checkbox', id, checked: value as boolean });
      describe(box);
      box.addEventListener('change', () => this.change(spec.key, box.checked));
      row.append(el('div', { className: 'setting-head' }, el('label', { htmlFor: id }, box, ' ', title)), ...key, this.descLine(desc, title, lang));
      return row;
    }
    row.append(el('div', { className: 'setting-head' }, el('label', { htmlFor: id, id: `${id}-label`, textContent: title })), ...key, this.descLine(desc, title, lang));

    if (spec.type === 'string') {
      // Each value in words; its own name before them only with "Show VS Code setting names".
      const labels: Record<string, string> = { ...text.values, ...(spec.key === 'language' ? { auto: t.browser } : {}) };
      const words = (v: string) => (labels[v] && labels[v] !== v ? labels[v].replace(/`/g, '') : v);
      const select = el('select', { id });
      describe(select);
      select.append(...spec.enum!.map((v) => new Option(keys && words(v) !== v ? `${v} — ${words(v)}` : words(v), v, false, v === value)));
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
        return el('label', { htmlFor: box.id }, box, ' ', el('code', { textContent: v }), ...(label && label !== v ? [' ', ...this.rich(label, lang)] : []));
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

/** The id of a setting's control (`setting-hints-names`). */
const rowId = (key: string) => `setting-${key.replace(/\./g, '-')}`;
