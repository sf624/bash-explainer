// The Problems list under the editor (its size and folding are in layout.ts).
import { DocumentIssue, plain } from '../src/document';
import { Lang } from '../src/i18n';
import { $ } from './dom';
import { CHROME } from './chrome-text';
import { TEXT } from './text';

/** Text with its `backtick` spans as <code> nodes, as the panel shows them (DOM nodes, never HTML). */
export function withCode(text: string): Node[] {
  return text.split(/(`[^`]+`)/).filter(Boolean).map((part) => {
    if (!(part.startsWith('`') && part.endsWith('`') && part.length > 1)) return document.createTextNode(part);
    return Object.assign(document.createElement('code'), { textContent: part.slice(1, -1) });
  });
}

/**
 * Fills the lists (under the editor, and the phone's sheet tab) and the strip's summary; a click on a problem, or Enter
 * or Space on it, calls `pick`. Each problem is a button, in the Tab order: its message on up to two lines, its rule id
 * muted at the right (under the message in a narrow pane), never cut; its whole text in its tooltip. The strip is always
 * there: "Problems ⚠ 5 ⓘ 6", or "✓ No problems" (muted); it is tinted while pitfalls are found.
 */
export function showProblems(list: DocumentIssue[], lang: Lang, pick: (issue: DocumentIssue) => void): void {
  const t = TEXT[lang];
  const c = CHROME[lang];
  const box = document.getElementById('problems');
  const summary = document.getElementById('problems-summary');
  if (box) box.hidden = !summary && list.length === 0; // (the compare page's list hides when empty, as before)
  const title = document.getElementById('problems-title');
  if (title) title.textContent = summary && !list.length ? c.noProblems : t.problems;
  const oldCount = document.getElementById('problems-count');
  if (oldCount) oldCount.textContent = String(list.length);
  const warnings = list.filter((i) => i.severity === 'warning').length;
  const infos = list.length - warnings;
  const part = (cls: string, icon: string, n: number) => {
    const s = Object.assign(document.createElement('span'), { className: `sum ${cls}` });
    s.append(Object.assign(document.createElement('span'), { className: 'icon', textContent: icon }), String(n));
    s.setAttribute('aria-hidden', 'true');
    return s;
  };
  summary?.replaceChildren(...(warnings ? [part('warning', '⚠', warnings)] : []), ...(infos ? [part('info', 'ⓘ', infos)] : []));
  box?.classList.toggle('none', list.length === 0);
  box?.classList.toggle('pitfalls', warnings > 0);
  const toggle = document.getElementById('problems-toggle');
  if (toggle && summary) {
    const said = [warnings ? c.pitfalls(warnings) : '', infos ? c.caveats(infos) : ''].filter(Boolean).join(', ');
    toggle.setAttribute('aria-label', list.length ? `${t.problems}: ${said}` : c.noProblems);
    // Nothing to open while there is nothing.
    if (!list.length && toggle.getAttribute('aria-expanded') === 'true') toggle.click();
    toggle.toggleAttribute('disabled', list.length === 0);
  }
  for (const id of ['problem-prev', 'problem-next']) document.getElementById(id)?.toggleAttribute('disabled', list.length === 0);
  const count = document.getElementById('tab-problems-count');
  if (count) count.textContent = list.length ? String(list.length) : '';
  const build = () => list.map((i) => {
    const li = document.createElement('li');
    const button = Object.assign(document.createElement('button'), { type: 'button', className: 'problem' });
    button.dataset.line = String(i.startLine);
    button.dataset.key = `${i.startLine}:${i.startCol}:${i.code}`;
    const span = (cls: string, text: string) => Object.assign(document.createElement('span'), { className: cls, textContent: text });
    const message = (text: string) => {
      const m = span('message', '');
      m.append(...withCode(text));
      return m;
    };
    // (The icon is named by the level's word, for a screen reader.)
    const icon = span(`icon ${i.severity}`, i.severity === 'warning' ? '⚠' : 'ⓘ');
    icon.setAttribute('role', 'img');
    icon.setAttribute('aria-label', t.levels[i.severity]);
    const text = span('text', '');
    text.append(message(plain(i.message)), span('code', i.code));
    button.append(icon, span('where', t.line(i.startLine + 1)), text);
    button.title = `${t.line(i.startLine + 1)}: ${plain(i.message).replace(/`/g, '')} (${i.code})`;
    button.addEventListener('click', () => pick(i));
    // Enter is taken on its own: the focus goes to the editor at once, which would otherwise get the key's line break.
    button.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return;
      e.preventDefault();
      pick(i);
    });
    li.append(button);
    return li;
  });
  $('problem-list').replaceChildren(...build());
  document.getElementById('sheet-problem-list')?.replaceChildren(...build());
}

/** The order the strip counts the problems in: by place in the script. */
const byPlace = (a: DocumentIssue, b: DocumentIssue) => a.startLine - b.startLine || a.startCol - b.startCol;

/**
 * The strip's position "3 / 11": the problem the cursor is in (or on the line of), of all of them; "– / 11" when the
 * cursor is on none. The items of the cursor's line are marked in the lists.
 */
export function showPosition(list: DocumentIssue[], line: number, col: number, lang: Lang): void {
  const c = CHROME[lang];
  const sorted = [...list].sort(byPlace);
  const inside = (i: DocumentIssue) => (i.startLine < line || (i.startLine === line && i.startCol <= col)) && (i.endLine > line || (i.endLine === line && i.endCol >= col));
  const at = sorted.findIndex(inside) >= 0 ? sorted.findIndex(inside) : sorted.findIndex((i) => i.startLine === line);
  const pos = document.getElementById('problem-pos');
  if (pos) {
    pos.textContent = !list.length ? '' : at >= 0 ? c.pos(at + 1, list.length) : c.pos(0, list.length).replace(/^0/, '–');
    pos.setAttribute('aria-label', at >= 0 ? c.posLabel(at + 1, list.length) : c.posNone(list.length));
    pos.classList.toggle('none', at < 0);
  }
  for (const b of document.querySelectorAll<HTMLElement>('.problem-list .problem')) b.classList.toggle('here', b.dataset.line === String(line));
}

/** The problem after (or before) the line of the cursor, going round. */
export function nextProblem(list: DocumentIssue[], line: number, col: number, back: boolean): DocumentIssue | undefined {
  if (!list.length) return undefined;
  const sorted = [...list].sort((a, b) => a.startLine - b.startLine || a.startCol - b.startCol);
  const after = (i: DocumentIssue) => i.startLine > line || (i.startLine === line && i.startCol > col);
  const before = (i: DocumentIssue) => i.startLine < line || (i.startLine === line && i.startCol < col);
  return back ? ([...sorted].reverse().find(before) ?? sorted[sorted.length - 1]) : (sorted.find(after) ?? sorted[0]);
}
