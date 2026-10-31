// The explanation panel in its frame (panel.html, the page of the VS Code panel), and the page's own controls for it.
// The panel says what the user does in it (src/ui/panelView.ts `FromPanel`); the page answers and shows the result.
// The panel's own header is not shown on the page (web/panel-page.css): its shell and yq choices are the setting,
// "Collapse all" and "Quick reference" press the panel's buttons, which keep the state and say how they are drawn
// (`header`), and the view switch is the page's, drawn from `viewControl`: it keeps the state and sends it to the
// panel, as the panel's own switch tells it.
import { Span } from '../src/analyzer';
import { Lang } from '../src/i18n';
import { FromPanel, HeaderButton, needsReading, PanelState, panelState, panelUpdate, viewControl } from '../src/ui/panelView';
import { isPanelQuestion, panelReply } from '../src/ui/panelReply';
import { ui } from '../src/ui/render';
import { on, put } from './dom';
import { drawIcon } from './icons';
import { Theme } from './protocol';
import { readStoredObject, STORAGE_KEYS, writeStored } from './storage';

type Dialect = ReturnType<typeof panelUpdate>['dialect'];

/** What the panel's frame asks of the page around it. */
export interface PanelHost {
  lang(): Lang;
  theme(): Theme;
  /** The panel is ready (or started again): explain the line. */
  update(): void;
  /** "Copy as Markdown". */
  copy(): void;
  /** The shell or yq chosen in the page's own selects. */
  choose(key: 'shell' | 'yq', value: string): void;
  /** The shell or yq chosen in the panel's header ('auto' clears it). */
  override(key: 'shell' | 'yq', value: string): void;
  openSettings(): void;
  /** A click on a part of the explanation: select it in the script. */
  reveal(span: Span, preserveFocus?: boolean): void;
  /** The pointer on a part of the explanation: mark it in the script (null: no longer). */
  highlight(span: Span | null): void;
}

export class PanelBridge {
  private ready = false;
  /** The panel's view and step: from storage, then as the panel says. */
  private state: PanelState = panelState(readStoredObject(STORAGE_KEYS.panel));
  /** The panel's fold and quick reference buttons, as it last said it draws them (none yet: their first names). */
  private header: Record<'toggle' | 'ref', HeaderButton> | undefined;

  /**
   * `frame` is the page's own panel: none on the compare page, whose frames hold copies of this page.
   * `controls` says whether the page has the top bar and menu that stand in for the panel's header (not in panel mode).
   */
  constructor(private readonly host: PanelHost, private readonly frame: HTMLIFrameElement | null, private readonly controls: boolean) {
    // The panel says 'ready' when it starts; it may have done so before this script ran.
    frame?.addEventListener('load', () => this.loaded());
    if (frame?.contentDocument?.readyState === 'complete' && frame.contentWindow?.location.href.endsWith('panel.html')) {
      this.ready = true;
      this.sendState();
    }
    window.addEventListener('message', (e) => this.onMessage(e));
    for (const key of ['shell', 'yq'] as const) {
      for (const id of [key, `${key}-top`]) on(id, 'change', (e) => host.choose(key, (e.target as HTMLSelectElement).value));
    }
    // Below 360px the copy is in the menu only (web/page.css), for the top bar's other buttons to keep their size.
    for (const [id, act] of [['collapse', () => this.button('toggle')?.click()], ['copy-md', () => host.copy()], ['menu-copy', () => host.copy()], ['ref', () => this.button('ref')?.click()]] as const) {
      on(id, 'click', () => {
        // The menu's item closes the menu first, as the others do.
        if (id.startsWith('menu-')) (document.getElementById('drawer') as HTMLDialogElement | null)?.close();
        act();
      });
    }
    // The view switch: in the top bar, on a phone in the menu (the bar has no room for it there).
    for (const group of ['views-top', 'views-menu']) {
      on(group, 'click', (e) => {
        const option = e.target instanceof Element ? (e.target.closest('button[data-option]') as HTMLElement | null)?.dataset.option : undefined;
        if (option) this.press(option);
      });
    }
    this.showView();
  }

  /** An option pressed in the page's view switch: the state it sets is kept and sent to the panel, and the line explained again when it needs other data. */
  private press(id: string): void {
    const option = viewControl(this.state, this.host.lang()).options.find((o) => o.id === id);
    if (!option || option.pressed) return;
    const before = needsReading(this.state);
    this.state = panelState({ ...this.state, ...option.sets });
    writeStored(STORAGE_KEYS.panel, JSON.stringify(this.state));
    this.showView();
    this.sendState();
    if (needsReading(this.state) !== before) this.host.update();
  }

  /** Draws the page's view switch, in the top bar and in the menu, from the view control of the state. */
  private showView(): void {
    const control = viewControl(this.state, this.host.lang());
    for (const where of ['top', 'menu']) {
      const group = document.getElementById(`views-${where}`);
      if (!group) continue;
      if (where === 'top') group.setAttribute('aria-label', control.label);
      const buttons = control.options.map((o) => {
        const id = `view-${o.id}-${where}`;
        const b = document.getElementById(id) ?? Object.assign(document.createElement('button'), { id, type: 'button' });
        b.dataset.option = o.id;
        b.textContent = o.short;
        b.setAttribute('aria-pressed', String(o.pressed));
        // (The full name where it says more than the short one: the tooltip and the accessible name.)
        for (const attr of ['title', 'aria-label']) {
          if (o.full === o.short) b.removeAttribute(attr);
          else b.setAttribute(attr, o.full);
        }
        return b;
      });
      if (buttons.length !== group.children.length || buttons.some((b, i) => group.children[i] !== b)) group.replaceChildren(...buttons);
    }
    put('views-menu-label', control.label);
  }

  private loaded(): void {
    this.ready = true;
    // The panel's ⚙ button opens the settings dialog (it is hidden where there is none: in panel mode).
    if (this.controls) this.frame?.contentDocument?.documentElement.classList.add('bx-settings');
    this.send({ type: 'theme', theme: this.host.theme() });
    this.sendState();
    if (this.controls) this.showActions();
    this.host.update();
  }

  /** The view and step the viewer chose last time (VS Code keeps them in the webview's state, which the frame has not). */
  private sendState(): void {
    this.send({ type: 'panelState', state: this.state });
  }

  /** The view and step the panel shows: what the explanation needs comes from it (`needsReading`). */
  panelState(): PanelState {
    return this.state;
  }

  /** Sends a message to the panel, once it is ready. */
  send(message: unknown): void {
    if (this.ready) this.frame?.contentWindow?.postMessage(message, location.origin);
  }

  /** Starts the panel again (it keeps its quick reference once loaded: needed when the language changes). */
  reload(): void {
    this.ready = false;
    this.header = undefined;
    if (this.frame) this.frame.src = 'panel.html';
  }

  /** Shows what the panel was sent for a line: the page's shell and yq selects follow it. */
  show(message: ReturnType<typeof panelUpdate>): void {
    this.send(message);
    this.showDialect(message.dialect);
  }

  private onMessage(e: MessageEvent): void {
    if (!this.frame || e.source !== this.frame.contentWindow || e.origin !== location.origin) return;
    const m = e.data as FromPanel;
    if (isPanelQuestion(m)) return this.send(panelReply(m, this.host.lang()));
    switch (m.type) {
      case 'ready':
        return this.loaded();
      case 'override':
        return this.host.override(m.key, m.value);
      case 'openSettings':
        return this.host.openSettings();
      case 'highlight':
        return this.host.highlight(m.span);
      case 'reveal':
        return this.host.reveal(m.span, m.preserveFocus);
      case 'copy':
        return this.host.copy();
      case 'header':
        this.header = m.buttons;
        if (this.controls) this.showActions();
        return;
      case 'panelState':
        {
          const before = needsReading(this.state);
          this.state = panelState(m.state);
          writeStored(STORAGE_KEYS.panel, JSON.stringify(this.state));
          this.showView();
          // The tree has to be built for the tree view: explain the line again.
          if (needsReading(this.state) !== before) this.host.update();
        }
        return;
    }
  }

  /** Fills the shell and yq selects of the top bar and the menu the way the panel's header was. */
  private showDialect(d: Dialect): void {
    const tp = ui[this.host.lang()].panel;
    for (const [key, options, value, label] of [['shell', d.shells, d.shell, tp.shell], ['yq', d.yqs, d.yq, tp.yq]] as const) {
      for (const id of [key, `${key}-top`]) {
        const select = document.getElementById(id) as HTMLSelectElement | null;
        if (!select) continue;
        select.replaceChildren(...(options ?? []).map(([v, text]) => new Option(text, v)));
        select.value = value;
        put(`${id}-label`, label);
        select.setAttribute('aria-label', label);
        select.title = label;
      }
      // The yq choice only matters on the lines that run yq.
      for (const id of [`${key}-box`, `${key}-top-box`]) {
        const box = document.getElementById(id);
        if (box && key === 'yq') box.hidden = !options;
      }
    }
  }

  /** A button of the panel's header (it is there, hidden). */
  private button(id: 'toggle' | 'ref'): HTMLElement | null {
    return this.frame?.contentDocument?.getElementById(id) ?? null;
  }

  /**
   * Names the page's fold and quick reference buttons, and draws their icons, as the panel says it draws its own
   * (they turn into "Expand all" and "Back"); and the page's other labels of the panel, in the page's language.
   */
  showActions(): void {
    const tp = ui[this.host.lang()].panel;
    const buttons: [string, HeaderButton][] = [
      ['collapse', this.header?.toggle ?? { name: tp.collapseAll, icon: 'collapse-all' }],
      ['ref', this.header?.ref ?? { name: tp.reference, icon: 'book', pressed: false }],
      ['copy-md', { name: tp.copy, icon: 'copy' }],
    ];
    for (const [id, b] of buttons) {
      const el = document.getElementById(id);
      el?.setAttribute('aria-label', b.name);
      el?.setAttribute('title', b.name);
      if (b.pressed !== undefined) el?.setAttribute('aria-pressed', String(b.pressed));
      // (The page's own icons until the panel has said how it draws its buttons.)
      const svg = el?.querySelector('svg');
      if (this.header && id !== 'copy-md' && svg) drawIcon(svg, b.icon);
    }
    put('menu-copy-label', tp.copy);
    this.showView();
    for (const [key, label] of [['shell', tp.shell], ['yq', tp.yq]]) {
      for (const id of [key, `${key}-top`]) {
        put(`${id}-label`, label);
        document.getElementById(id)?.setAttribute('aria-label', label);
      }
    }
  }
}
