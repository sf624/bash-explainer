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

/** Fills the lists (under the editor, and the phone's sheet tab) and the strip's summary; a click on a problem, or Enter or Space on it, calls `pick`. Each problem is a button, in the Tab order: one line, cut with "…"; its whole text in its tooltip and when it has the focus. */
export function showProblems(list: DocumentIssue[], lang: Lang, pick: (issue: DocumentIssue) => void): void {
  const t = TEXT[lang];
  const c = CHROME[lang];
  $('problems').hidden = list.length === 0;
  $('problems-title').textContent = t.problems;
  const warnings = list.filter((i) => i.severity === 'warning').length;
  const infos = list.length - warnings;
  const part = (cls: string, icon: string, text: string) => {
    const s = Object.assign(document.createElement('span'), { className: `sum ${cls}` });
    s.append(Object.assign(document.createElement('span'), { className: 'icon', textContent: icon }), text);
    return s;
  };
  $('problems-summary').replaceChildren(...(warnings ? [part('warning', '⚠', c.pitfalls(warnings))] : []), ...(infos ? [part('info', 'ⓘ', c.caveats(infos))] : []));
  const count = document.getElementById('tab-problems-count');
  if (count) count.textContent = String(list.length);
  const build = () => list.map((i) => {
    const li = document.createElement('li');
    const button = Object.assign(document.createElement('button'), { type: 'button', className: 'problem' });
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
    button.append(icon, span('where', t.line(i.startLine + 1)), message(plain(i.message)), span('code', i.code));
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

/** The problem after (or before) the line of the cursor, going round. */
export function nextProblem(list: DocumentIssue[], line: number, col: number, back: boolean): DocumentIssue | undefined {
  if (!list.length) return undefined;
  const sorted = [...list].sort((a, b) => a.startLine - b.startLine || a.startCol - b.startCol);
  const after = (i: DocumentIssue) => i.startLine > line || (i.startLine === line && i.startCol > col);
  const before = (i: DocumentIssue) => i.startLine < line || (i.startLine === line && i.startCol < col);
  return back ? ([...sorted].reverse().find(before) ?? sorted[sorted.length - 1]) : (sorted.find(after) ?? sorted[0]);
}
