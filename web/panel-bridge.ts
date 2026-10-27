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
import { CHROME } from './chrome-text';
import { on, put } from './dom';
import { drawIcon } from './icons';
import { Theme } from './protocol';
import { readStoredObject, STORAGE_KEYS, writeStored } from './storage';
import { wrapLineBox } from './word-wrap';

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
      for (const id of [key, `${key}-top`, `scope-${key}`]) on(id, 'change', (e) => host.choose(key, (e.target as HTMLSelectElement).value));
    }
    // The panel's own header has these buttons (shown on the page, web/panel-page.css); the menu, the share menu and
    // the phone's bottom sheet press the same ones, which keep the state.
    for (const [id, act] of [['copy-md', () => host.copy()], ['menu-copy', () => host.copy()], ['pane-copy', () => host.copy()],
      ['menu-collapse', () => this.pressToggle()], ['pane-collapse', () => this.pressToggle()], ['menu-ref', () => this.pressRef()]] as const) {
      on(id, 'click', () => {
        // The menu's item closes the menu first, as the others do.
        if (id.startsWith('menu-')) (document.getElementById('drawer') as HTMLDialogElement | null)?.close();
        act();
      });
    }
    // The view switch: in the panel header's view slot, and in the phone's row over the explanation.
    for (const where of ['top', 'phone']) {
      for (const v of ['list', 'tree'] as const) {
        on(`view-${v}-${where}`, 'click', () => this.setView(v));
        // Round 4: the same choice as a dropdown ("View: Meaning ▾") where the slot is narrow, and on a phone.
        on(`view-pick-${v}-${where}`, 'click', () => this.setView(v));
      }
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
    const c = CHROME[this.host.lang()];
    // Round 8: the view slot holds a mock of the coming depth control: "1 What it does | 2 How bash reads it" (the
    // segments on the desktop; "Depth 1 ⌄" and a menu of the two where the slot is narrow, and on a phone). Until the
    // panel has depths, 1 shows the current Meaning view and 2 the Reading view.
    const depth = this.view() === 'list' ? 1 : 2;
    const lang = this.host.lang();
    // (The nodes are made once per language: a click on one of them is still going up through it while this runs, and
    // the menu closes on that click.)
    const fill = (box: Element | null | undefined, n: number) => {
      if (!box || (box as HTMLElement).dataset.lang === lang) return;
      (box as HTMLElement).dataset.lang = lang;
      box.replaceChildren(...segment(n));
    };
    const segment = (n: number) => {
      const digit = Object.assign(document.createElement('span'), { className: 'dg', textContent: String(n) });
      // (Both texts in the bold weight too, hidden: the segment keeps one width, pressed or not.)
      const name = Object.assign(document.createElement('span'), { className: 'dn', textContent: c.depthNames[n - 1] });
      name.dataset.text = c.depthNames[n - 1];
      return [digit, name];
    };
    for (const where of ['top', 'phone']) {
      for (const v of ['list', 'tree']) {
        const n = v === 'list' ? 1 : 2;
        const seg = document.getElementById(`view-${v}-${where}`);
        if (seg) {
          fill(seg, n);
          seg.setAttribute('aria-pressed', String(depth === n));
          seg.setAttribute('aria-label', `${c.depth} ${n}: ${c.depthNames[n - 1]}`);
        }
        const pick = document.getElementById(`view-pick-${v}-${where}`);
        pick?.setAttribute('aria-checked', String(depth === n));
        if (pick?.lastElementChild) {
          fill(pick.lastElementChild, n);
          pick.lastElementChild.className = 'depth-item';
        }
      }
      document.getElementById(`views-${where}`)?.setAttribute('aria-label', c.depthLabel);
      const drop = document.getElementById(`view-drop-${where}`);
      if (drop) {
        drop.querySelector('.vd-prefix')!.textContent = c.depth;
        drop.querySelector('.vd-value')!.textContent = String(depth);
        // (A mid-width desktop slot shows the depth's name: both names are laid out in one cell, the other unseen, so
        // the control keeps one width.)
        const names = drop.querySelector<HTMLElement>('.vd-name');
        if (names && names.dataset.lang !== lang) {
          names.dataset.lang = lang;
          names.replaceChildren(...[1, 2].map((n) => {
            const name = document.createElement('span');
            name.append(...segment(n));
            return name;
          }));
        }
        names?.querySelectorAll(':scope > span').forEach((x, i) => x.classList.toggle('on', i + 1 === depth));
        // (The visible words lead the name: "Depth 1", then what it is.)
        drop.setAttribute('aria-label', `${c.depth} ${depth}: ${c.depthNames[depth - 1]}`);
        drop.title = `${c.depthLabel}: ${depth} ${c.depthNames[depth - 1]}`;
        document.getElementById(`view-menu-${where}`)?.setAttribute('aria-label', c.depthLabel);
      }
    }
  }

  /**
   * Round 4: the phone's sheet tells the frame how much room it has: below full (`bx-compact`) the line box goes (the
   * editor shows the line just above, and the tab names it); with the view row over the frame's top (`bx-lead`) the
   * explanation starts below it, so that the row scrolls away with it.
   */
  private sheetMarks = { compact: false, lead: false };
  markSheet(compact: boolean, lead: boolean): void {
    this.sheetMarks = { compact, lead };
    this.markPhone();
  }

  private loaded(): void {
    this.ready = true;
    // The panel's ⚙ button opens the settings dialog (it is hidden where there is none: in panel mode).
    this.markPhone();
    this.send({ type: 'theme', theme: this.host.theme() });
    this.sendState();
    if (this.controls) this.watch();
    this.host.update();
  }

  /** The view and step the viewer chose last time (VS Code keeps them in the webview's state, which the frame has not). */
  private sendState(): void {
    this.send({ type: 'panelState', state: this.state });
  }

  /** Tells the panel's frame whether it is in the phone's bottom sheet (its header then keeps only the view switch). */
  markPhone(): void {
    const root = this.frame?.contentDocument?.documentElement;
    if (!root) return;
    // The panel's ⚙ button opens the settings dialog (it is hidden where there is none: in panel mode); its header is
    // the pane's header on the editor page. (Also when the frame was ready before this script: no `load` then.)
    if (this.controls) root.classList.add('bx-settings', 'bx-head');
    const phone = document.documentElement.classList.contains('narrow');
    root.classList.toggle('bx-phone', phone);
    root.classList.toggle('bx-compact', phone && this.sheetMarks.compact);
    root.classList.toggle('bx-lead', phone && this.sheetMarks.lead);
    root.classList.toggle('bx-wrap', this.wrap);
    this.watchLine();
  }

  /** Round 7: whether the line box wraps between shell words (the `editor.wrap` setting, on by default). */
  private wrap = true;
  setWrap(on: boolean): void {
    this.wrap = on;
    this.markPhone();
    this.wrapLine();
  }

  private lineWatched: HTMLElement | undefined;
  private lineObserver: MutationObserver | undefined;
  private lineResize: ResizeObserver | undefined;
  private lineWidth = -1;
  /** The line box is drawn again by the panel at each line: wrap it each time, and when its width changes. */
  private watchLine(): void {
    const pre = this.frame?.contentDocument?.getElementById('line');
    if (!pre || pre === this.lineWatched) return;
    this.lineWatched = pre;
    this.lineObserver?.disconnect();
    this.lineResize?.disconnect();
    const w = this.frame!.contentWindow! as Window & typeof globalThis;
    this.lineObserver = new w.MutationObserver(() => {
      // A new line: the box is closed again (three rows at most).
      pre.classList.remove('bx-line-open');
      this.wrapLine();
    });
    this.lineObserver!.observe(pre, { childList: true });
    this.lineResize = new w.ResizeObserver(() => {
      if (Math.abs(pre.clientWidth - this.lineWidth) > 1) this.wrapLine();
    });
    this.lineResize!.observe(pre);
    // A tap on a box cut at three rows opens it whole (the parts can be tapped then).
    pre.addEventListener('click', (e) => {
      if (!pre.classList.contains('bx-line-clamp') || pre.classList.contains('bx-line-open')) return;
      e.preventDefault();
      e.stopPropagation();
      pre.classList.add('bx-line-open');
    }, true);
  }

  /** Splits the line box's text at the blanks between shell words (web/word-wrap.ts) and marks its rows after the first with ↪. */
  wrapLine(): void {
    const pre = this.lineWatched;
    const doc = this.frame?.contentDocument;
    if (!pre || !doc || !pre.isConnected) return;
    const w = doc.defaultView!;
    this.lineObserver?.disconnect();
    try {
      if (!this.wrap || !pre.getClientRects().length) {
        pre.classList.remove('bx-line-clamp');
        pre.style.removeProperty('--bx-marks');
        // (Hidden: wrapped again when it shows, at whatever width.)
        this.lineWidth = -1;
        return;
      }
      const cs = w.getComputedStyle(pre);
      const ctx = doc.createElement('canvas').getContext('2d');
      if (!ctx) return;
      ctx.font = `${cs.fontSize} ${cs.fontFamily}`;
      const cw = ctx.measureText('M'.repeat(20)).width / 20 || 8;
      this.lineWidth = pre.clientWidth;
      const room = Math.floor((pre.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight) - 1) / cw) + 2;
      wrapLineBox(pre, room);
      const lh = parseFloat(cs.lineHeight) || 20;
      const rows = Math.max(1, Math.round((pre.scrollHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom)) / lh));
      pre.classList.toggle('bx-line-clamp', rows > 3);
      pre.style.setProperty('--bx-marks', rows > 1 ? `"${Array(rows - 1).fill('↪').join('\\A ')}"` : '""');
    } finally {
      this.lineObserver?.observe(pre, { childList: true });
    }
  }

  /**
   * The line the panel explains, at the left of its line box ("Ln 8"), drawn by web/panel-page.css from the box's
   * `data-ln`; undefined: an empty script, whose panel shows no line box and says where to start (`bx-blank`).
   */
  markLine(label: string | undefined): void {
    const doc = this.frame?.contentDocument;
    const line = doc?.getElementById('line');
    if (!doc || !line) return;
    if (label) line.dataset.ln = label;
    else delete line.dataset.ln;
    // Round 5: the label is a fixed cell at the left of the box (web/panel-page.css draws it on the box's container).
    const top = doc.getElementById('top');
    if (top && label) top.dataset.ln = label;
    else if (top) delete top.dataset.ln;
    doc.documentElement.classList.toggle('bx-blank', label === undefined);
    this.showEmptyExtra(doc, label === undefined);
  }

  /** Round 6: what the empty panel adds under its message (desktop): a one-line preview and "Try the sample". */
  onEmpty: (() => { preview: string; link: string; run: () => void }) | undefined;
  private showEmptyExtra(doc: Document, blank: boolean): void {
    const empty = doc.getElementById('empty');
    let extra = doc.getElementById('bx-empty-more');
    if (!blank || !this.onEmpty || !empty) {
      extra?.remove();
      return;
    }
    const { preview, link } = this.onEmpty();
    if (!extra) {
      extra = doc.createElement('div');
      extra.id = 'bx-empty-more';
      const p = doc.createElement('p');
      p.className = 'bx-empty-preview';
      const a = doc.createElement('button');
      a.type = 'button';
      a.className = 'bx-empty-sample';
      a.addEventListener('click', () => this.onEmpty?.().run());
      extra.append(p, a);
    }
    if (extra.previousElementSibling !== empty) empty.after(extra);
    extra.querySelector('.bx-empty-preview')!.textContent = preview;
    extra.querySelector('.bx-empty-sample')!.textContent = link;
  }

  /** Round 4: how far down the empty panel's message starts (px), level with the empty editor's block. */
  setEmptyTop(px: number): void {
    const doc = this.frame?.contentDocument;
    const main = doc?.getElementById('main');
    if (!doc || !main) return;
    // What lies above the message in the frame (the box at its top, empty then) is taken off, so that the message's own
    // top is at `px`.
    // (Measured from the box above it: the message's margin collapses through #main, so #main's own top moves with it.)
    const above = (doc.getElementById('top')?.getBoundingClientRect().bottom ?? 0) + parseFloat(getComputedStyle(main).paddingTop);
    doc.documentElement.style.setProperty('--bx-empty-top', `${Math.max(0, Math.round(px - above))}px`);
  }

  /** The frame's window (round 4: the phone's view row follows its scroll). */
  frameWindow(): Window | null {
    return this.frame?.contentWindow ?? null;
  }

  /** Presses the panel's "Collapse all" (or "Expand all"). */
  pressToggle(): void {
    this.button('toggle')?.click();
  }

  /** Presses the panel's "Quick reference" (or "Back"). */
  pressRef(): void {
    this.button('ref')?.click();
  }

  /** Whether the quick reference is open in the panel. */
  refOpen(): boolean {
    return this.frame?.contentDocument?.getElementById('reference')?.hidden === false;
  }

  /** Called when the panel's buttons change their names (the quick reference opened or closed, the tree folded). */
  onActions: (() => void) | undefined;

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
    this.markPhone();
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
      for (const id of [key, `${key}-top`, `scope-${key}`]) {
        const select = document.getElementById(id) as HTMLSelectElement | null;
        if (!select) continue;
        select.replaceChildren(...(options ?? []).map(([v, text]) => new Option(text, v)));
        select.value = value;
        put(`${id}-label`, label);
        select.setAttribute('aria-label', label);
        select.title = label;
      }
      // The yq choice only matters on the lines that run yq.
      for (const id of [`${key}-box`, `${key}-top-box`, `scope-${key}-box`]) {
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
    const c = CHROME[this.host.lang()];
    const toggleName = this.button('toggle')?.getAttribute('aria-label') || tp.collapseAll;
    // Round 5: one name for copying the explanation, the panel's own ("Copy as Markdown"), here and in the phone's menu.
    for (const [button, name] of [['pane-collapse', toggleName], ['pane-copy', tp.copy]]) {
      document.getElementById(button)?.setAttribute('aria-label', name);
      document.getElementById(button)?.setAttribute('title', name);
    }
    put('menu-collapse-label', toggleName);
    put('menu-ref-label', this.button('ref')?.getAttribute('aria-label') || tp.reference);
    // Collapse all is two chevrons that meet; Expand all, two that part (the page's own glyphs: the panel's codicon
    // read as a second "copy" beside Copy). With a wide panel they have short words: "Collapse", "Copy".
    const expand = this.button('toggle')?.querySelector('svg')?.getAttribute('data-icon') === 'expand-all';
    for (const button of ['pane-collapse', 'menu-collapse']) document.querySelector(`#${button} use`)?.setAttribute('href', expand ? '#i-expand' : '#i-collapse');
    put('pane-collapse-label', expand ? c.expandShort : c.collapseShort);
    // Round 8: the words are the whole name, "Copy as Markdown", from a 560px panel; below it the icon with "MD" under it.
    put('pane-copy-label', tp.copy);
    put('pane-copy-md', c.copyMdShort);
    const icon = this.button('ref')?.querySelector('svg')?.getAttribute('data-icon');
    const refSvg = document.querySelector('#menu-ref svg');
    if (icon && refSvg) drawIcon(refSvg, icon);
    document.getElementById('menu-ref')?.setAttribute('aria-pressed', String(open));
    put('views-menu-label', tp.views);
    this.onActions?.();
    this.showView();
    for (const [key, label] of [['shell', tp.shell], ['yq', tp.yq]]) {
      for (const id of [key, `${key}-top`, `scope-${key}`]) {
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
