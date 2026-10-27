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
  // With none, ‹ › go (the strip says "✓ No problems" alone).
  for (const id of ['problem-prev', 'problem-next']) {
    const b = document.getElementById(id);
    if (b) b.hidden = summary ? list.length === 0 : false;
    b?.toggleAttribute('disabled', list.length === 0);
  }
  const count = document.getElementById('tab-problems-count');
  // Round 8: the phone's tab is "⚠ 11", and "⚠ 0" (muted) when there are none, never a bare icon.
  if (count) {
    count.textContent = String(list.length);
    count.classList.toggle('zero', list.length === 0);
  }
  // Round 8: the phone's tab shows "⚠ 11"; its name says it: "Problems, 11".
  document.getElementById('tab-problems')?.setAttribute('aria-label', c.problemsTab(list.length));
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
 * The strip's position "Ln 20 · 1/11": the problem the cursor is in (or on the line of), with its line, of all of
 * them; nothing when the cursor is on none (the count is at the strip's left). The items of the cursor's line are marked in the lists.
 */
export function showPosition(list: DocumentIssue[], line: number, col: number, lang: Lang): void {
  const c = CHROME[lang];
  const sorted = [...list].sort(byPlace);
  const inside = (i: DocumentIssue) => (i.startLine < line || (i.startLine === line && i.startCol <= col)) && (i.endLine > line || (i.endLine === line && i.endCol >= col));
  const at = sorted.findIndex(inside) >= 0 ? sorted.findIndex(inside) : sorted.findIndex((i) => i.startLine === line);
  const pos = document.getElementById('problem-pos');
  if (pos) {
    // (Round 4: one count, at the left; the right says where the cursor is only when it is on a problem.)
    const text = !list.length || at < 0 ? '' : c.posAt4(sorted[at].startLine + 1, at + 1, list.length);
    // Round 6: the line apart from the count, so that a narrow strip with a toast in it keeps only "1/11".
    const cut = text.lastIndexOf(' · ');
    pos.replaceChildren(...(cut < 0 ? [text] : [Object.assign(document.createElement('span'), { className: 'pos-ln', textContent: text.slice(0, cut + 3) }), text.slice(cut + 3)]));
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
