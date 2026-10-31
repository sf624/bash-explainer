// The Problems strip and list under the editor (docs/design/chrome-redesign.md, C2): "› Problems ⓧ 1 ⚠ 5 ⓘ 6", and at
// the right where the cursor is ("Ln 20 · 1/11") with ‹ › (F8, Shift+F8). The order, the position and the next problem
// are decided in src/ui/problemNav.ts; the levels' marks, colours and words come from the level table (src/levels.ts).
// The list's height and folding are in layout.ts.
import { DocumentIssue, plain } from '../src/document';
import { Lang } from '../src/i18n';
import { levelCounts, LEVELS, levelTally, problemLevel, problemLevels } from '../src/levels';
import { type At, byPlace, problemAt, stepProblem } from '../src/ui/problemNav';
import { $ } from './dom';
import { TEXT } from './text';

/** Text with its `backtick` spans as <code> nodes, as the panel shows them (DOM nodes, never HTML). */
export function withCode(text: string): Node[] {
  return text.split(/(`[^`]+`)/).filter(Boolean).map((part) => {
    if (!(part.startsWith('`') && part.endsWith('`') && part.length > 1)) return document.createTextNode(part);
    return Object.assign(document.createElement('code'), { textContent: part.slice(1, -1) });
  });
}

const span = (cls: string, text: string) => Object.assign(document.createElement('span'), { className: cls, textContent: text });

/** What the strip needs of the page: its language, the cursor, and the way to go to a problem (select it in the editor). */
export interface StripHost {
  lang(): Lang;
  cursor(): At;
  pick(issue: DocumentIssue): void;
}

/** The strip and the list, from the problems the editor shows. */
export class ProblemStrip {
  /** The problems in the order of the script, as the list shows them and the position counts them. */
  private list: DocumentIssue[] = [];
  /** The problem last gone to, which tells apart two problems on one range. */
  private picked: DocumentIssue | undefined;

  constructor(private readonly host: StripHost) {
    // (F8 in the panel's frame: the page adds `keys` there too, each time the frame loads.)
    window.addEventListener('keydown', this.keys, true);
    for (const [id, back] of [['problem-prev', true], ['problem-next', false]] as const) {
      $(id).addEventListener('click', () => this.step(back));
      $(id).addEventListener('keydown', (e) => this.enter(e, () => this.step(back)));
    }
  }

  /** Enter is taken on its own: the focus goes to the editor at once, which would otherwise get the key's line break. */
  private enter(e: KeyboardEvent, go: () => void): void {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    go();
  }

  /**
   * Fills the strip and the list. With no problem the strip says so, and has nothing to open or go to. Each problem is
   * a button, in the Tab order: its level's mark, its line in a column of its own, its message on up to two lines and
   * its rule (from a pane of 520 px); its tooltip has the whole message, its line and its rule.
   */
  show(issues: readonly DocumentIssue[]): void {
    const lang = this.host.lang();
    const t = TEXT[lang];
    this.list = byPlace(issues);
    const levels = problemLevels(this.list.map((i) => i.severity));
    const box = $('problems');
    box.hidden = false;
    box.classList.toggle('empty', !this.list.length);
    $('problems-title').textContent = this.list.length ? t.problems : t.noProblems;
    $('problems-counts').replaceChildren(...levelTally(levels).map(({ level, n }) => {
      const count = span('count', String(n));
      count.prepend(span(`icon ${LEVELS[level].className}`, LEVELS[level].mark));
      return count;
    }));
    // The counts in words for a screen reader, from the same table ("Problems: 1 error, 5 warnings").
    $('problems-said').textContent = this.list.length ? t.problemsSaid(levelCounts(levels, lang)) : t.noProblems;
    // (The compare page's strip has no fold: its list is always open.)
    const toggle = document.getElementById('problems-toggle') as HTMLButtonElement | null;
    if (toggle) toggle.disabled = !this.list.length;
    for (const [id, name, key] of [['problem-prev', t.prevProblem, 'Shift+F8'], ['problem-next', t.nextProblem, 'F8']]) {
      const b = $(id);
      b.hidden = !this.list.length;
      b.setAttribute('aria-label', name);
      b.setAttribute('aria-keyshortcuts', key);
      b.title = `${name} (${key})`;
    }
    $('problem-list').replaceChildren(...this.list.map((i) => this.row(i, lang)));
    this.place();
  }

  private row(i: DocumentIssue, lang: Lang): HTMLLIElement {
    const t = TEXT[lang];
    const li = document.createElement('li');
    const button = Object.assign(document.createElement('button'), { type: 'button', className: 'problem' });
    const message = span('message', '');
    message.append(...withCode(plain(i.message)));
    // (The level's mark, in its colour, and named by the level's word for a screen reader: the level table, src/levels.ts.)
    const level = problemLevel(i.severity);
    const icon = span(`icon ${level.className}`, level.mark);
    icon.setAttribute('role', 'img');
    icon.setAttribute('aria-label', level.name[lang]);
    button.append(icon, span('where', t.line(i.startLine + 1)), message, span('code', i.code));
    button.title = t.problemTip(i.startLine + 1, plain(i.message, { backticks: false }), i.code);
    button.addEventListener('click', () => this.go(i));
    button.addEventListener('keydown', (e) => this.enter(e, () => this.go(i)));
    li.append(button);
    return li;
  }

  /** Shows where the cursor is: "Ln 20 · 1/11" at a problem, nothing elsewhere. */
  place(): void {
    const t = TEXT[this.host.lang()];
    const i = problemAt(this.list, this.host.cursor(), this.picked);
    const at = this.list[i];
    // ("Ln 20 · " is a span of its own: a narrow pane shows "1/11" alone.)
    $('problem-pos-text').replaceChildren(...(at ? [span('pos-ln', t.problemPosLine(at.startLine + 1)), `${i + 1}/${this.list.length}`] : []));
    $('problem-pos-said').textContent = at ? t.problemPosSaid(at.startLine + 1, i + 1, this.list.length) : '';
  }

  /** Goes to the next problem (`back`: the previous one), round from the last to the first; false when there is none. */
  step(back: boolean): boolean {
    const i = stepProblem(this.list, this.host.cursor(), back, this.picked);
    if (i < 0) return false;
    this.go(this.list[i]);
    return true;
  }

  private go(i: DocumentIssue): void {
    this.picked = i;
    this.host.pick(i);
    this.place();
  }

  /** F8 and Shift+F8, from anywhere on the page or in the panel's frame, unless a dialog is open. */
  readonly keys = (e: KeyboardEvent): void => {
    if (e.key !== 'F8' || e.ctrlKey || e.metaKey || e.altKey || document.querySelector('dialog[open]')) return;
    if (this.step(e.shiftKey)) e.preventDefault();
  };
}

/**
 * The room of the page's toast (web/toast.ts): the editor's pane above the Problems strip, which is there whenever the
 * page has its problems (above the pane's bottom before the first check). Undefined without the pane.
 */
export function roomAboveStrip(): { left: number; width: number; bottom: number } | undefined {
  const pane = document.getElementById('source');
  if (!pane) return undefined;
  const box = pane.getBoundingClientRect();
  const problems = document.getElementById('problems');
  const bottom = problems && !problems.hidden ? problems.getBoundingClientRect().top : box.bottom;
  return { left: box.left, width: box.width, bottom };
}

/** Calls `changed` when the strip or the list changes its height (opened, folded, resized) and when the panes move. */
export function watchStrip(changed: () => void): void {
  if (typeof ResizeObserver !== 'function') return;
  const watch = new ResizeObserver(changed);
  for (const id of ['source', 'problems']) {
    const el = document.getElementById(id);
    if (el) watch.observe(el);
  }
}
