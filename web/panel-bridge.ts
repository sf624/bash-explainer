// The explanation panel in its frame (panel.html, the page of the VS Code panel), and the page's own controls for it.
// The panel says what the user does in it (src/ui/panelView.ts `FromPanel`); the page answers and shows the result.
// The panel's own header is not shown on the page (web/panel-page.css): its shell and yq choices are the settings,
// which the editor header's chip (web/scope-chip.ts) and the settings sheet show; the page draws the rest above the
// frame (web/panel-head.ts). Its view control keeps the state and sends it to the panel, as the panel's own control
// tells it; its tools send the state they want (`tools`: folded, the quick reference open), and the panel says the
// state it has (`header`).
import { Span } from '../src/analyzer';
import { Lang } from '../src/i18n';
import { FromPanel, needsReading, PanelState, panelState, panelUpdate, viewControl } from '../src/ui/panelView';
import { isPanelQuestion, panelReply } from '../src/ui/panelReply';
import { PanelHead } from './panel-head';
import { Theme } from './protocol';
import { readStoredObject, STORAGE_KEYS, writeStored } from './storage';

/** What the panel's frame asks of the page around it. */
export interface PanelHost {
  lang(): Lang;
  theme(): Theme;
  /** The panel is ready (or started again): explain the line. */
  update(): void;
  /** "Copy as Markdown". */
  copy(): void;
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
  /** The panel's header on the page (none in panel mode, or on the compare page). */
  private readonly head: PanelHead | undefined;

  /**
   * `frame` is the page's own panel: none on the compare page, whose frames hold copies of this page.
   * `controls` says whether the page has the controls that stand in for the panel's header (not in panel mode).
   */
  constructor(private readonly host: PanelHost, private readonly frame: HTMLIFrameElement | null, private readonly controls: boolean) {
    // The panel says 'ready' when it starts; it may have done so before this script ran.
    frame?.addEventListener('load', () => this.loaded());
    if (frame?.contentDocument?.readyState === 'complete' && frame.contentWindow?.location.href.endsWith('panel.html')) {
      this.ready = true;
      this.sendState();
    }
    window.addEventListener('message', (e) => this.onMessage(e));
    const head = controls ? document.getElementById('panel-head') : null;
    this.head = head ? new PanelHead(head, {
      lang: host.lang,
      control: () => viewControl(this.state, host.lang()),
      press: (sets) => this.press(sets),
      tools: (want) => this.send({ type: 'tools', ...want }),
      copy: host.copy,
    }) : undefined;
  }

  /** An option pressed in the page's view control: the state it sets is kept and sent to the panel, and the line explained again when it needs other data. */
  private press(sets: PanelState): void {
    this.keep(panelState({ ...this.state, ...sets }));
    this.sendState();
  }

  /** Keeps the panel's state (storage), draws the view control from it, and explains the line again when it needs other data. */
  private keep(state: PanelState): void {
    const before = needsReading(this.state);
    this.state = state;
    writeStored(STORAGE_KEYS.panel, JSON.stringify(this.state));
    this.head?.draw();
    // The tree has to be built for the tree view: explain the line again.
    if (needsReading(this.state) !== before) this.host.update();
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
    // (A new panel starts with nothing folded and the explanation shown.)
    this.head?.show(false, false);
    if (this.frame) this.frame.src = 'panel.html';
  }

  /** Shows what the panel was sent for a line. */
  show(message: ReturnType<typeof panelUpdate>): void {
    this.send(message);
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
        return this.head?.show(m.folded, m.reference);
      case 'panelState':
        return this.keep(panelState(m.state));
    }
  }

  /** The page's labels of the panel, in the page's language: its header. */
  showActions(): void {
    this.head?.draw();
  }
}
