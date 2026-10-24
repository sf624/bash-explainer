// The explanation panel in its frame (panel.html, the page of the VS Code panel), and the page's own controls for it.
// The panel says what the user does in it (src/ui/panelView.ts `FromPanel`); the page answers and shows the result.
// The panel's own header is not shown on the page (web/panel-page.css): its shell and yq choices are the setting,
// "Collapse all" and "Quick reference" press the panel's buttons, which keep the state, and the view switch (List or
// Tree) is the page's: it keeps the view and sends it to the panel, as the panel's own switch tells it.
import { Span } from '../src/analyzer';
import { Lang } from '../src/i18n';
import { FromPanel, PanelState, panelUpdate } from '../src/ui/panelView';
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
  private state: PanelState = readStoredObject<PanelState>(STORAGE_KEYS.panel);
  private watcher: MutationObserver | undefined;
  private watched: Document | undefined;

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
    for (const where of ['top', 'menu']) {
      for (const v of ['list', 'tree'] as const) on(`view-${v}-${where}`, 'click', () => this.setView(v));
    }
    this.showView();
  }

  /** The view chosen in the page's switch: kept, sent to the panel, and the line explained again (the tree is built for the tree view only). */
  private setView(view: 'list' | 'tree'): void {
    if (this.view() === view) return;
    this.state = { ...this.state, view };
    writeStored(STORAGE_KEYS.panel, JSON.stringify(this.state));
    this.showView();
    this.sendState();
    this.host.update();
  }

  /** The page's view switch shows the view chosen. */
  private showView(): void {
    for (const where of ['top', 'menu']) {
      for (const v of ['list', 'tree']) document.getElementById(`view-${v}-${where}`)?.setAttribute('aria-pressed', String(this.view() === v));
    }
  }

  private loaded(): void {
    this.ready = true;
    // The panel's ⚙ button opens the settings dialog (it is hidden where there is none: in panel mode).
    if (this.controls) this.frame?.contentDocument?.documentElement.classList.add('bx-settings');
    this.send({ type: 'theme', theme: this.host.theme() });
    this.sendState();
    if (this.controls) this.watch();
    this.host.update();
  }

  /** The view and step the viewer chose last time (VS Code keeps them in the webview's state, which the frame has not). */
  private sendState(): void {
    this.send({ type: 'panelState', state: this.state });
  }

  /** The view the panel shows: the tree is built only for the tree view. */
  view(): 'list' | 'tree' {
    return this.state.view === 'tree' ? 'tree' : 'list';
  }

  /** Sends a message to the panel, once it is ready. */
  send(message: unknown): void {
    if (this.ready) this.frame?.contentWindow?.postMessage(message, location.origin);
  }

  /** Starts the panel again (it keeps its quick reference once loaded: needed when the language changes). */
  reload(): void {
    this.ready = false;
    if (this.frame) this.frame.src = 'panel.html';
  }

  /** Shows what the panel was sent for a line: the page's shell and yq selects follow it. */
  show(message: ReturnType<typeof panelUpdate>): void {
    this.send(message);
    if (this.controls) this.watch();
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
      case 'panelState':
        {
          const before = this.view();
          this.state = m.state;
          writeStored(STORAGE_KEYS.panel, JSON.stringify(m.state));
          this.showView();
          // The tree has to be built for the tree view: explain the line again.
          if (this.view() !== before) this.host.update();
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

  /** Names the fold and quick reference buttons, and draws their icons, as the panel's own buttons do (they turn into "Expand all" and "Back"). */
  showActions(): void {
    const tp = ui[this.host.lang()].panel;
    const open = this.frame?.contentDocument?.getElementById('reference')?.hidden === false;
    const names: [string, string][] = [
      ['collapse', this.button('toggle')?.getAttribute('aria-label') || tp.collapseAll],
      ['ref', this.button('ref')?.getAttribute('aria-label') || tp.reference],
      ['copy-md', tp.copy],
    ];
    for (const [button, name] of names) {
      document.getElementById(button)?.setAttribute('aria-label', name);
      document.getElementById(button)?.setAttribute('title', name);
    }
    for (const [button, theirs] of [['collapse', 'toggle'], ['ref', 'ref']] as const) {
      const icon = this.button(theirs)?.querySelector('svg')?.getAttribute('data-icon');
      const svg = document.querySelector(`#${button} svg`);
      if (icon && svg) drawIcon(svg, icon);
    }
    document.getElementById('ref')?.setAttribute('aria-pressed', String(open));
    put('menu-copy-label', tp.copy);
    put('views-menu-label', tp.views);
    document.getElementById('views-top')?.setAttribute('aria-label', tp.views);
    for (const where of ['top', 'menu']) {
      put(`view-list-${where}`, tp.listView);
      put(`view-tree-${where}`, tp.treeView);
    }
    for (const [key, label] of [['shell', tp.shell], ['yq', tp.yq]]) {
      for (const id of [key, `${key}-top`]) {
        put(`${id}-label`, label);
        document.getElementById(id)?.setAttribute('aria-label', label);
      }
    }
  }

  /** The panel's buttons change their own names; follow them. */
  private watch(): void {
    const doc = this.frame?.contentDocument;
    if (!doc || doc === this.watched || !doc.getElementById('toggle')) return;
    this.watched = doc;
    this.watcher?.disconnect();
    this.watcher = new MutationObserver(() => this.showActions());
    for (const id of ['toggle', 'ref']) this.watcher.observe(doc.getElementById(id)!, { attributeFilter: ['aria-label'] });
    this.showActions();
  }
}
