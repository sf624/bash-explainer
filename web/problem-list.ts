// The Problems list under the editor (its size and folding are in layout.ts).
import { DocumentIssue, plain } from '../src/document';
import { Lang } from '../src/i18n';
import { $ } from './dom';
import { TEXT } from './text';

/** Text with its `backtick` spans as <code> nodes, as the panel shows them (DOM nodes, never HTML). */
export function withCode(text: string): Node[] {
  return text.split(/(`[^`]+`)/).filter(Boolean).map((part) => {
    if (!(part.startsWith('`') && part.endsWith('`') && part.length > 1)) return document.createTextNode(part);
    return Object.assign(document.createElement('code'), { textContent: part.slice(1, -1) });
  });
}

/** Fills the list; a click on a problem, or Enter or Space on it, calls `pick`. Each problem is a button, in the Tab order. */
export function showProblems(list: DocumentIssue[], lang: Lang, pick: (issue: DocumentIssue) => void): void {
  const t = TEXT[lang];
  $('problems').hidden = list.length === 0;
  $('problems-title').textContent = t.problems;
  $('problems-count').textContent = String(list.length);
  $('problem-list').replaceChildren(...list.map((i) => {
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
    button.addEventListener('click', () => pick(i));
    // Enter is taken on its own: the focus goes to the editor at once, which would otherwise get the key's line break.
    button.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return;
      e.preventDefault();
      pick(i);
    });
    li.append(button);
    return li;
  }));
}
