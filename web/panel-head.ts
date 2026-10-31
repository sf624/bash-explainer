// The panel's header on the web page (docs/design/chrome-redesign.md, decisions 4 and 11, step C7): above the panel's
// frame, the tabs Explanation and Reference, the view control, Collapse and Copy as Markdown, each with a word. The
// view control is the component the VS Code panel draws too (media/view-control.js), from the panel's data
// (src/ui/panelView.ts `viewControl`). The header takes the first of its forms (src/ui/panelHead.ts `panelHeaderForms`)
// that fits its row. Each press says the state it wants (web/panel-bridge.ts sends it to the panel); nothing here
// presses the panel's own buttons.
import '../media/view-control.js';
import type { Lang } from '../src/i18n';
import { panelHeaderForms, panelTools, ViewForm } from '../src/ui/panelHead';
import type { PanelState, ViewControl } from '../src/ui/panelView';
import { drawIcon } from './icons';
import { focusBack } from './popover';
import { TEXT } from './text';

/** The component of media/view-control.js, loaded with this module. */
interface ViewControlComponent {
  draw(control: ViewControl, form: ViewForm): void;
}
type Create = (root: HTMLElement, prefix: string, press: (sets: PanelState) => void, focus?: (el: HTMLElement) => void) => ViewControlComponent;
const createViewControl = (): Create => (globalThis as unknown as { BashExplainerViewControl: { create: Create } }).BashExplainerViewControl.create;

/** What a press in the header asks of the page around. */
export interface PanelHeadHost {
  lang(): Lang;
  /** The view control for the state kept. */
  control(): ViewControl;
  /** An option of the view control pressed: what it sets. */
  press(sets: PanelState): void;
  /** The tools' state wanted: everything folded or not, the quick reference open or not (`focus`: its search field takes the focus). */
  tools(want: { folded?: boolean; reference?: boolean; focus?: boolean }): void;
  copy(): void;
}

export class PanelHead {
  private readonly view: ViewControlComponent;
  private readonly tabs: HTMLElement[];
  /** The panel's tools as it last said (`header`): something folded, the quick reference open. */
  private folded = false;
  private reference = false;
  /** The header's width when its form was taken: it is taken again when the width changes. */
  private width = -1;

  constructor(private readonly head: HTMLElement, private readonly host: PanelHeadHost) {
    this.view = createViewControl()(head.querySelector<HTMLElement>('.view-slot')!, 'slot', (sets) => host.press(sets), focusBack);
    this.tabs = [...head.querySelectorAll<HTMLElement>('[role="tab"]')];
    for (const tab of this.tabs) {
      // (A click's `detail` counts the pointer's clicks: 0 when a key pressed the tab, which keeps the focus on it.)
      tab.addEventListener('click', (e) => this.pick(tab, e.detail > 0));
    }
    // The tabs as one stop of Tab: the arrows, Home and End move between them and show the one they reach.
    head.querySelector('[role="tablist"]')?.addEventListener('keydown', (e) => {
      const k = (e as KeyboardEvent).key;
      const at = this.tabs.indexOf(document.activeElement as HTMLElement);
      const to = ({ ArrowRight: at + 1, ArrowLeft: at - 1, Home: 0, End: this.tabs.length - 1 } as Record<string, number>)[k];
      if (at < 0 || to === undefined) return;
      e.preventDefault();
      const tab = this.tabs[(to + this.tabs.length) % this.tabs.length];
      tab.focus();
      this.pick(tab, false);
    });
    head.querySelector('#collapse')?.addEventListener('click', () => host.tools({ folded: !this.folded }));
    head.querySelector('#copy-md')?.addEventListener('click', () => host.copy());
    new ResizeObserver(() => {
      if (head.clientWidth !== this.width) this.fit();
    }).observe(head);
    this.draw();
  }

  /** The tools' state, as the panel says it (`header`). */
  show(folded: boolean, reference: boolean): void {
    this.folded = folded;
    this.reference = reference;
    this.draw();
  }

  /** A tab chosen: the quick reference opens or closes. */
  private pick(tab: HTMLElement, byPointer: boolean): void {
    const reference = tab.id === 'tab-ref';
    if (reference !== this.reference) this.host.tools({ reference, focus: reference && byPointer });
  }

  /** Draws the header in the page's language and the panel's state, and takes the form that fits. */
  draw(): void {
    const lang = this.host.lang();
    const t = TEXT[lang];
    const tools = panelTools(lang);
    // (Each tab's word in full and short, the form showing one: its accessible name is the full word.)
    const words: [HTMLElement | undefined, string, string][] = [[this.tabs[0], t.tabExplanation, t.tabExplanation], [this.tabs[1], t.tabReference, t.tabReferenceShort]];
    for (const [el, full, short] of words) {
      if (!el) continue;
      el.setAttribute('aria-label', full);
      el.replaceChildren(Object.assign(document.createElement('span'), { className: 'tab-full', textContent: full }), Object.assign(document.createElement('span'), { className: 'tab-short', textContent: short }));
    }
    this.head.querySelector('[role="tablist"]')?.setAttribute('aria-label', t.panelTabs);
    this.tabs.forEach((tab) => {
      const on = (tab.id === 'tab-ref') === this.reference;
      tab.setAttribute('aria-selected', String(on));
      tab.tabIndex = on ? 0 : -1;
      if (on) document.getElementById('panel-body')?.setAttribute('aria-labelledby', tab.id);
    });
    // The quick reference has no view: the view control keeps its room, unseen, and so does the fold.
    this.head.classList.toggle('reference', this.reference);
    const toggle = this.folded ? tools.toggle.unfold : tools.toggle.fold;
    for (const [id, b, word, other] of [['collapse', toggle, this.folded ? t.toolExpand : t.toolCollapse, this.folded ? t.toolCollapse : t.toolExpand], ['copy-md', tools.copy, t.toolCopy, '']] as const) {
      const el = document.getElementById(id);
      if (!el) continue;
      el.setAttribute('aria-label', b.name);
      el.title = b.name;
      const svg = el.querySelector('svg');
      if (svg) drawIcon(svg, b.icon);
      // The word, drawn over the other word the button may say (unseen): its box keeps the width of the longer.
      const shown = Object.assign(document.createElement('span'), { textContent: word });
      const size = Object.assign(document.createElement('span'), { className: 'vc-size', textContent: other });
      document.getElementById(`${id}-word`)?.replaceChildren(shown, ...(other ? [size] : []));
    }
    this.fit();
  }

  /** Takes the first form of the header that fits its row; when none does, its groups wrap. */
  private fit(): void {
    this.width = this.head.clientWidth;
    const control = this.host.control();
    this.head.classList.remove('wrap');
    for (const form of panelHeaderForms(control)) {
      this.view.draw(control, form.view);
      this.head.dataset.tools = form.tools;
      this.head.dataset.tabs = form.tabs;
      if (this.head.scrollWidth <= this.head.clientWidth) return;
    }
    this.head.classList.add('wrap');
  }
}
