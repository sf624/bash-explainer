// The panel's header on the web page (docs/design/chrome-redesign.md, decisions 4 and 11, step C7): above the panel's
// frame, the tabs Explanation and Reference, the view control, Collapse and Copy as Markdown, each with a word. The
// view control is the component the VS Code panel draws too (media/view-control.js), from the panel's data
// (src/ui/panelView.ts `viewControl`). The header takes the first of its forms (src/ui/panelHead.ts `panelHeaderForms`)
// that fits its row. Each press says the state it wants (web/panel-bridge.ts sends it to the panel); nothing here
// presses the panel's own buttons.
// On a phone the header is the bottom sheet's (web/sheet.ts; step C8a): one 48 px row with the tabs Explanation (with
// the cursor's line, "Ln 8"), Problems (its counts by level) and Reference, and the view control as a pill; its forms
// come from src/ui/sheet.ts `sheetForms` (decision 9). The Problems tab shows the page's own list in the sheet.
import '../media/view-control.js';
import type { Lang } from '../src/i18n';
import { levelCounts, LEVELS, type NoteLevel } from '../src/levels';
import { panelHeaderForms, panelTools, ViewForm } from '../src/ui/panelHead';
import type { PanelState, ViewControl } from '../src/ui/panelView';
import { NO_PROBLEMS, problemCounts, type SheetForm, sheetForms } from '../src/ui/sheet';
import { drawIcon } from './icons';
import { narrow } from './layout';
import { focusBack } from './popover';
import { sheetLayout } from './sheet';
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
  /** The Problems tab is chosen (the sheet's layout only): the page's list shows instead of the panel. */
  private problems = false;
  /** The level of each problem, for the Problems tab's counts. */
  private levels: NoteLevel[] = [];
  /** The cursor's line (from 0), for the Explanation tab's "Ln 8". */
  private line = 0;
  /** The form the sheet's row took last. */
  private sheetForm: SheetForm | undefined;

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
      // (The tabs shown: Problems is a tab of the sheet only.)
      const tabs = this.tabs.filter((t) => t.getClientRects().length);
      const at = tabs.indexOf(document.activeElement as HTMLElement);
      const to = ({ ArrowRight: at + 1, ArrowLeft: at - 1, Home: 0, End: tabs.length - 1 } as Record<string, number>)[k];
      if (at < 0 || to === undefined) return;
      e.preventDefault();
      const tab = tabs[(to + tabs.length) % tabs.length];
      tab.focus();
      this.pick(tab, false);
    });
    head.querySelector('#collapse')?.addEventListener('click', () => host.tools({ folded: !this.folded }));
    head.querySelector('#copy-md')?.addEventListener('click', () => host.copy());
    new ResizeObserver(() => {
      if (head.clientWidth !== this.width) this.fit();
    }).observe(head);
    // Out of the sheet, the Problems tab goes (the list is under the editor again), and the row takes its forms again.
    narrow.addEventListener('change', () => {
      if (!sheetLayout()) this.problems = false;
      this.draw();
    });
    this.draw();
  }

  /** The problems' levels changed: the Problems tab counts them (a tab of the sheet only: the rest of the header stays). */
  counts(levels: NoteLevel[]): void {
    this.levels = levels;
    this.nameProblems();
    this.refit();
  }

  /**
   * The sheet's row takes its form again after a text in it changed (the counts, the line). Not while the view's menu
   * is open: trying a form closes it. The texts are then drawn in the form shown, and the form is taken at the next fit.
   */
  private refit(): void {
    if (!sheetLayout()) return;
    if (this.head.querySelector('.view-slot[data-open="true"]') && this.sheetForm) this.drawCounts(this.sheetForm.counts);
    else this.fit();
  }

  /** The Problems tab's name and tooltip: every count in words ("Problems: 5 warnings, 6 caveats"). */
  private nameProblems(): void {
    const t = TEXT[this.host.lang()];
    const problems = this.head.querySelector<HTMLElement>('#tab-problems');
    const said = this.levels.length ? t.problemsSaid(levelCounts(this.levels, this.host.lang())) : t.noProblems;
    problems?.setAttribute('aria-label', said);
    if (problems) problems.title = said;
  }

  /** The cursor moved to another line: the Explanation tab says it (on a phone, where its width may change the row's form). */
  cursor(line: number): void {
    if (line === this.line) return;
    this.line = line;
    const shown = this.head.querySelector('#tab-explain .tab-line');
    if (shown) shown.textContent = TEXT[this.host.lang()].line(line + 1);
    this.refit();
  }

  /** Shows the Explanation tab (in the sheet, after a problem was chosen in the Problems tab). */
  explain(): void {
    this.problems = false;
    if (this.reference) this.host.tools({ reference: false });
    this.draw();
  }

  /** The tools' state, as the panel says it (`header`). */
  show(folded: boolean, reference: boolean): void {
    this.folded = folded;
    this.reference = reference;
    this.draw();
  }

  /** A tab chosen: the quick reference opens or closes; the Problems tab is the page's own. */
  private pick(tab: HTMLElement, byPointer: boolean): void {
    const problems = tab.id === 'tab-problems';
    const reference = tab.id === 'tab-ref';
    if (problems !== this.problems) {
      this.problems = problems;
      this.draw();
    }
    if (!problems && reference !== this.reference) this.host.tools({ reference, focus: reference && byPointer });
  }

  /** Draws the header in the page's language and the panel's state, and takes the form that fits. */
  draw(): void {
    const lang = this.host.lang();
    const t = TEXT[lang];
    const tools = panelTools(lang);
    // (Each tab's word in full and short, the form showing one: its accessible name is the full word.)
    const span = (className: string, textContent: string) => Object.assign(document.createElement('span'), { className, textContent });
    const explain = this.head.querySelector<HTMLElement>('#tab-explain');
    // (The Explanation tab is named by its words, the line too where it shows: `fit`; Reference by its full word.)
    explain?.replaceChildren(span('tab-full', t.tabExplanation), span('tab-short', t.tabExplanation), span('tab-line', t.line(this.line + 1)));
    const ref = this.head.querySelector<HTMLElement>('#tab-ref');
    ref?.setAttribute('aria-label', tools.ref.open.word);
    ref?.replaceChildren(span('tab-full', tools.ref.open.word), span('tab-short', tools.ref.open.short));
    this.nameProblems();
    this.head.querySelector('[role="tablist"]')?.setAttribute('aria-label', t.panelTabs);
    const chosen = this.problems ? 'tab-problems' : this.reference ? 'tab-ref' : 'tab-explain';
    this.tabs.forEach((tab) => {
      const on = tab.id === chosen;
      tab.setAttribute('aria-selected', String(on));
      tab.tabIndex = on ? 0 : -1;
      if (on && !this.problems) document.getElementById('panel-body')?.setAttribute('aria-labelledby', tab.id);
    });
    // The quick reference and the Problems tab have no view: the view control keeps its room, unseen, and so do the tools.
    this.head.classList.toggle('reference', this.reference || this.problems);
    this.head.closest('.panel-pane')?.toggleAttribute('data-problems', this.problems);
    const toggle = this.folded ? tools.toggle.unfold : tools.toggle.fold;
    const otherToggle = this.folded ? tools.toggle.fold : tools.toggle.unfold;
    for (const [id, b, other] of [['collapse', toggle, otherToggle.word], ['copy-md', tools.copy, '']] as const) {
      const el = document.getElementById(id);
      if (!el) continue;
      el.setAttribute('aria-label', b.name);
      el.title = b.name;
      const svg = el.querySelector('svg');
      if (svg) drawIcon(svg, b.icon);
      // The word, drawn over the other word the button may say (unseen): its box keeps the width of the longer.
      const shown = Object.assign(document.createElement('span'), { textContent: b.word });
      const size = Object.assign(document.createElement('span'), { className: 'vc-size', textContent: other });
      document.getElementById(`${id}-word`)?.replaceChildren(shown, ...(other ? [size] : []));
    }
    this.fit();
  }

  /** The Problems tab's counts in a form of the sheet's row: each level's mark in its colour and its number ("⚠5 ⓘ6"). */
  private drawCounts(counts: SheetForm['counts']): void {
    const tally = problemCounts(this.levels, counts);
    this.head.querySelector('#tab-problems')?.replaceChildren(...(tally.length ? tally.map(({ level, n }) => {
      const count = Object.assign(document.createElement('span'), { className: 'count', textContent: String(n) });
      count.prepend(Object.assign(document.createElement('span'), { className: `icon ${LEVELS[level].className}`, textContent: LEVELS[level].mark }));
      return count;
    }) : [NO_PROBLEMS]));
  }

  /** Takes the first form of the header that fits its row; when none does, its groups wrap (in the sheet: the Explanation tab's word is cut). */
  private fit(): void {
    this.width = this.head.clientWidth;
    const control = this.host.control();
    const t = TEXT[this.host.lang()];
    const explain = this.head.querySelector('#tab-explain');
    this.head.classList.remove('wrap');
    delete this.head.dataset.squeeze;
    if (sheetLayout()) {
      for (const form of sheetForms(control)) {
        this.view.draw(control, form.view);
        this.head.dataset.tools = form.tools;
        this.head.dataset.tabs = form.ref;
        this.head.dataset.line = String(form.line);
        explain?.setAttribute('aria-label', form.line ? `${t.tabExplanation} ${t.line(this.line + 1)}` : t.tabExplanation);
        this.drawCounts(form.counts);
        this.sheetForm = form;
        if (this.head.scrollWidth <= this.head.clientWidth) return;
      }
      this.head.dataset.squeeze = '';
      return;
    }
    delete this.head.dataset.line;
    explain?.setAttribute('aria-label', t.tabExplanation);
    for (const form of panelHeaderForms(control)) {
      this.view.draw(control, form.view);
      this.head.dataset.tools = form.tools;
      this.head.dataset.tabs = form.tabs;
      if (this.head.scrollWidth <= this.head.clientWidth) return;
    }
    this.head.classList.add('wrap');
  }
}
