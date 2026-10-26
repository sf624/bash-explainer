// The opening of the web page: an overlay with the logo and one line of shell, shown from the first paint until the
// page is ready (web/theme-init.js decides how, web/opening.ts ends it, web/page.css draws it). The line's tokens
// lift in turn and show their bounds, as bash cuts the line; then its parts take their colours in the order they are
// known (the operator and the command names, from bash; then options and arguments, from each command), and each
// part gets a label with what the explanation says of it. The labels are the analyzer's, taken when the page is built
// (scripts/build-web.ts), so that they cannot drift from the explanation.
import type { Analyzer } from '../analyzer';
import type { Kind, Token } from '../analyzer-types';
import type { Lang } from '../i18n';
import type { SyntaxTree } from '../syntax/tree';
import { esc } from './render';

/** The line of the opening. */
export const OPENING_LINE = 'sort -u "$file" | wc -l';

/** The kinds of part the opening colours, as the panel does. */
type PartKind = 'command' | 'option' | 'argument' | 'operator';

export interface OpeningPart {
  text: string;
  kind: PartKind;
  /** When the part is known: 0 an operator and 1 a command name (bash's reading), 2 an option or an argument (the command's). */
  role: 0 | 1 | 2;
  /** What the explanation says of it, in each language. */
  label: Record<Lang, string>;
  /** The variables inside the part, as [start, end] offsets in its text. */
  variables: Array<[number, number]>;
}

const KINDS: Partial<Record<Kind, PartKind>> = { command: 'command', option: 'option', argument: 'argument', operator: 'operator' };
const ROLES: Record<PartKind, 0 | 1 | 2> = { operator: 0, command: 1, option: 2, argument: 2 };

/**
 * The label of a part: its explanation up to the first " — " (what comes after is about the word's syntax), and of an
 * explanation of the form "Name: what it does" (an operator's), the name.
 */
export function openingLabel(explanation: string): string {
  const first = explanation.split(' — ')[0];
  return /^([^:(（]{1,20}): /.exec(first)?.[1] ?? first;
}

/**
 * The parts of `line` as the analyzer explains it in each language: the words between the blanks, each with the
 * outermost token of a kind the opening colours that starts there with a one-word label (the command of a name, not
 * its pipeline; the argument of a quoted word, not its string). Throws if a word has none, so that a build fails
 * rather than show a part without its explanation.
 */
export function openingParts(line: string, tree: SyntaxTree, analyzers: Record<Lang, Analyzer>): Array<string | OpeningPart> {
  const tokens = (lang: Lang) => {
    const found = new Map<number, Token>();
    const variables: Array<[number, number]> = [];
    const walk = (t: Token) => {
      const at = t.span.start.character;
      if (KINDS[t.kind] && line.startsWith(t.label, at) && !/\s/.test(t.label) && !found.has(at)) found.set(at, t);
      if (t.kind === 'variable') variables.push([at, t.span.end.character]);
      t.children.forEach(walk);
    };
    analyzers[lang].explainLine(tree, 0, 'bash').items.forEach(walk);
    return { found, variables };
  };
  const en = tokens('en');
  const ja = tokens('ja');
  const parts: Array<string | OpeningPart> = [];
  for (const m of line.matchAll(/(\s+)|(\S+)/g)) {
    if (m[1]) {
      parts.push(m[1]);
      continue;
    }
    const at = m.index;
    const t = en.found.get(at);
    if (!t) throw new Error(`The opening's line has no explanation for "${m[2]}"`);
    // Both languages explain the same tree, with the same tokens.
    const tj = ja.found.get(at)!;
    const kind = KINDS[t.kind]!;
    parts.push({
      text: m[2],
      kind,
      role: ROLES[kind],
      label: { en: openingLabel(t.explanation), ja: openingLabel(tj.explanation) },
      variables: en.variables.filter(([s, e]) => s >= at && e <= at + m[2].length).map(([s, e]) => [s - at, e - at]),
    });
  }
  return parts;
}

/**
 * The overlay's markup, for web/index.html (`<!--opening-->`): the logo (the page's own, from its header), the name,
 * the line with a label in each language on each part, and the same labels as a list, which a phone shows instead.
 * Each part carries its order (`--k`) and its role (`--role`), from which page.css times it.
 */
export function openingHtml(parts: Array<string | OpeningPart>, logo: string): string {
  const both = (label: Record<Lang, string>) => `<span class="l-en" lang="en">${esc(label.en)}</span><span class="l-ja" lang="ja">${esc(label.ja)}</span>`;
  let k = 0;
  const line: string[] = [];
  const list: string[] = [];
  for (const p of parts) {
    if (typeof p === 'string') {
      line.push(p);
      continue;
    }
    let ink = '';
    let from = 0;
    for (const [s, e] of p.variables) {
      ink += `${esc(p.text.slice(from, s))}<span class="k-variable">${esc(p.text.slice(s, e))}</span>`;
      from = e;
    }
    ink += esc(p.text.slice(from));
    line.push(
      `<span class="part k-${p.kind}" style="--k:${k};--role:${p.role}"><span class="plain">${esc(p.text)}</span><span class="ink">${ink}</span><span class="chip">${both(p.label)}</span></span>`,
    );
    list.push(`<li class="k-${p.kind}" style="--k:${k}"><code>${esc(p.text)}</code> ${both(p.label)}</li>`);
    k++;
  }
  return [
    '<div id="opening" class="opening" aria-hidden="true">',
    '  <div class="opening-stage">',
    `    <div class="opening-brand">${logo}<span class="opening-name">Bash Explainer</span></div>`,
    `    <pre class="opening-line">${line.join('')}</pre>`,
    `    <ul class="opening-list">${list.join('')}</ul>`,
    '  </div>',
    '</div>',
  ].join('\n');
}
