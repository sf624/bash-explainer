// The hover's Markdown (docs/design/hover.md): the part at the position, a small card for a position on no part, and
// the whole line, per command. VS Code's hover keeps only some HTML (see test/hover-view.test.ts): `<span style>` in
// one shape (a colour, a background, display:inline-block, border-radius, in that order), tables, `<small>`, `title`.
// Inside an HTML block (a table) Markdown is not read, so its text is turned into HTML here (`prose`).
import { Example, LineExplanation, Token } from '../analyzer-types';
import { SHELL_NAMES } from '../dialect';
import { Lang } from '../i18n';
import { joinParts, labelParts } from '../label';
import { manualLabel, SECTIONS } from '../manual';
import { isCommand, sameSpan, shown } from './hoverParts';
import { ThemeKind } from './palette';
import { colored, esc, ExamplePlacement, examplesMarkdown, explained, labelMarkdown, lineSegments, noteRefs, placeExamples, refsMarkdown, ui } from './render';

/** What every view of the hover needs. */
export interface HoverInput {
  /** The explanation of the line (examples already left out when the hover shows none). */
  ex: LineExplanation;
  lang: Lang;
  theme: ThemeKind;
  /** The text of the line. */
  lineText: string;
  /** A command URI that opens the line in the panel. */
  panelLink: string;
  /** A command URI that explains the whole line (from the part and the line card). */
  lineLink: string;
  /** The keys of the command that explains the whole line, for the link's tooltip. */
  keys: string;
  placement: ExamplePlacement;
}

/** Text for an attribute (a tooltip): only what would end it or start a tag is escaped, so that it still wraps. */
const attr = (text: string) => text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

const muted = (html: string) => `<span style="color:var(--vscode-descriptionForeground);">${html}</span>`;

/**
 * Text with `code` spans for a Markdown paragraph: a `<` outside the code would start an HTML tag (`<dir>`), which
 * the hover drops with what it holds.
 */
export function md(text: string): string {
  return text.split(/(`+[^`]*?`+)/).map((part, i) => (i % 2 ? part : part.replace(/</g, '&lt;').replace(/>/g, '&gt;'))).join('');
}

/** Text with `code` spans, as HTML (for an HTML block, where Markdown is not read). */
export function prose(text: string): string {
  const e = (s: string) => s.replace(/[&<>"'*_\\[\]~|#$]/g, (c) => `&#${c.charCodeAt(0)};`);
  // split with two groups: [text, fence, code, text, fence, code, …]
  return text.split(/(`+)([^`]*?)\1/).map((part, i) => (i % 3 === 0 ? e(part) : i % 3 === 2 ? `<code>${e(part).replace(/ /g, '&nbsp;')}</code>` : '')).join('');
}

/**
 * A token's label, coloured by its kind (no code background), cut to `max` characters; a placeholder in italics.
 * `nobreak`: a word joiner after each hyphen, so that a label in a narrow column (`-name *.gz -mtime`) does not break after a dash.
 */
function label(tok: Token, theme: ThemeKind, max = 22, nobreak = false): string {
  let left = max;
  return joinParts(labelParts(tok), (p) => {
    if (left <= 0) return '';
    let text = p.text.replace(/\s*\n\s*/g, ' ⏎ ');
    if (text.length > left) text = text.slice(0, Math.max(1, left - 1)) + '…';
    left -= text.length;
    if (nobreak) text = text.replace(/-/g, '-\u2060');
    return p.placeholder ? `<i>${colored(text, 'comment', theme)}</i>` : colored(text, tok.kind, theme);
  });
}

/** The name's kind as a badge in the theme's badge colours, its tooltip saying what the kind is, and who runs it. */
function badge(tok: Token): string {
  const s = tok.name?.said;
  if (!s) return '';
  const b = `<span title="${attr(s.title)}"><span style="color:var(--vscode-badge-foreground);background-color:var(--vscode-badge-background);border-radius:4px;">&nbsp;${esc(s.kind)}&nbsp;</span></span>`;
  return ` ${b}${s.by ? ` ${muted(prose(s.by))}` : ''}`;
}

/** "Same name, also: …", on a line of its own. */
const also = (tok: Token) => (tok.name?.said.also ? `<br><small>${muted(prose(tok.name.said.also))}</small>` : '');

/** The sections of the manual, small, as HTML links. */
function refsHtml(lang: Lang, refs?: readonly string[]): string {
  if (!refs?.length) return '';
  const [first, ...rest] = refs.map((id) => `<a href="${SECTIONS.get(id)!.url}" title="${attr(SECTIONS.get(id)!.title)}">${id}</a>`);
  return ` <small>${[manualLabel(lang, [first]), ...rest].join(', ')}</small>`;
}

/** A part as a row's text: its meaning, badge, sections and other meanings. */
const about = (tok: Token, lang: Lang) => `${prose(tok.explanation)}${badge(tok)}${refsHtml(lang, tok.refs)}${also(tok)}`;

/** The rows of the parts under a token, `depth` levels deep, indented with non-breaking spaces; `stop` keeps a part out (with its own parts). */
function rows(items: Token[], depth: number, stop: (t: Token) => boolean): { rows: { tok: Token; level: number }[]; hidden: number } {
  const out: { tok: Token; level: number }[] = [];
  let hidden = 0;
  const count = (ts: Token[]): number => ts.reduce((n, t) => n + 1 + count(shown(t)), 0);
  const walk = (ts: Token[], level: number) => {
    for (const t of ts.filter((c) => !stop(c))) {
      out.push({ tok: t, level });
      if (level + 1 < depth) walk(shown(t), level + 1);
      else hidden += count(shown(t).filter((c) => !stop(c)));
    }
  };
  walk(items, 0);
  return { rows: out, hidden };
}

function table(list: { tok: Token; level: number }[], x: HoverInput): string[] {
  if (!list.length) return [];
  const row = ({ tok, level }: { tok: Token; level: number }) => `<tr><td>${'&nbsp;'.repeat(4 * level)}${label(tok, x.theme, 22, true)}</td><td>${about(tok, x.lang)}</td></tr>`;
  return ['<table>', ...list.map(row), '</table>', ''];
}

/** A part of the structure with its meaning as a tooltip. */
const crumbPart = (tok: Token, theme: ThemeKind, max = 18) => `<span title="${attr(tok.explanation.replace(/`/g, ''))}">${label(tok, theme, max)}</span>`;

const sep = (s: string) => ` ${muted(s)} `;

/** The structure of a line as one breadcrumb: each part with commands in it, down to its commands (`sudo | xargs › sudo · xargs`). */
export function structureCrumb(items: Token[], theme: ThemeKind): string {
  const hasCommand = (t: Token): boolean => isCommand(t) || shown(t).some(hasCommand);
  const one = (t: Token): string => {
    if (isCommand(t)) return `<b>${crumbPart(t, theme, 14)}</b>`;
    const kids = shown(t).filter(hasCommand);
    return kids.length ? `${crumbPart(t, theme, 14)}${sep('›')}${kids.map(one).join(sep('·'))}` : crumbPart(t, theme, 14);
  };
  return items.map(one).join(sep('·'));
}

/** The link that explains the whole line, with its keys in the tooltip. */
function lineLink(x: HoverInput): string {
  const t = ui[x.lang].hover;
  return `[$(list-tree) ${t.wholeLine}](${x.lineLink} "${t.wholeLineTitle} (${x.keys})")`;
}

/** "Bash Explainer · Line 3 · checked for POSIX sh · for loop (line 2)". */
function where(ex: LineExplanation, lang: Lang, bold: boolean): string {
  const t = ui[lang];
  let h = `${bold ? `**${t.title}**` : t.title} · ${t.line(ex.line + 1)}`;
  if (ex.shell) h += ` · ${t.forShell(SHELL_NAMES[ex.shell])}`;
  if (ex.context.length) h += ' · _' + ex.context.map((c) => `${c.label} (${t.lineShort(c.line + 1)})`).join(' › ') + '_';
  return h;
}

/** The notes of the line, each with the sections of the manual it is about. */
function notes(ex: LineExplanation, lang: Lang): string[] {
  return ex.notes.flatMap((n) => {
    const refs = noteRefs(ex, n);
    return [`> ${md(n)}${refs?.length ? ` <small>${refsMarkdown(lang, refs)}</small>` : ''}`, ''];
  });
}

/** The links at the end: the panel (with how many parts only it shows), the settings. */
function footer(x: HoverInput, opts: { where?: boolean; hidden?: number } = {}): string[] {
  const t = ui[x.lang];
  const open = `[$(comment-discussion) ${opts.hidden ? t.hover.more(opts.hidden) : t.openInPanel}](${x.panelLink})`;
  const links = [open, `[$(gear) ${t.settings}](command:bashExplainer.openSettings)`].join(' &nbsp;·&nbsp; ');
  return ['', '---', opts.where ? `<small>${where(x.ex, x.lang, false)}</small> &nbsp;·&nbsp; ${links}` : links];
}

/** The examples placed on a token (`placeExamples`), looked up by its range in the placed copy. */
function examplesOn(placed: Token[], tok: Token): Example[] | undefined {
  for (const c of placed) {
    if (sameSpan(c.span, tok.span) && c.kind === tok.kind && c.label === tok.label && c.examples?.length) return c.examples;
    const f = examplesOn(c.children, tok);
    if (f) return f;
  }
  return undefined;
}

/**
 * The part at a position (`chain`: the parts around it, outermost first, from `partAt`): a breadcrumb of the parts
 * around it and the link to the whole line, the part with its badge and meaning, its own parts, the command it belongs
 * to, then the notes of the line and the examples of the part, so that the first lines answer what the part is.
 */
export function partHover(x: HoverInput, chain: Token[]): string {
  const part = chain[chain.length - 1];
  const t = ui[x.lang].hover;
  const out: string[] = [];
  const crumbs = chain.slice(0, -1).map((c) => crumbPart(c, x.theme));
  out.push(`${crumbs.length ? `<small>${crumbs.join(sep('›'))}${sep('›')}</small> &nbsp; ` : ''}${lineLink(x)}`, '');
  out.push(`<b>${label(part, x.theme, 48)}</b>${badge(part)}`, '');
  out.push(`${md(part.explanation)}${part.refs?.length ? ` <small>${refsMarkdown(x.lang, part.refs)}</small>` : ''}${also(part)}`, '');
  const own = rows(shown(part), 1, () => false);
  out.push(...table(own.rows, x));
  const command = [...chain].reverse().find((c) => c !== part && isCommand(c));
  if (command) out.push(`<small>${muted(t.command)}${label(command, x.theme)}${badge(command)} — ${md(command.explanation)}</small>`, '');
  out.push(...notes(x.ex, x.lang));
  // Its examples: those of the part and its own parts, else those of the nearest part around it.
  const placed = placeExamples(x.ex).items;
  const below = (tok: Token): Token[] => [tok, ...shown(tok).flatMap(below)];
  const mine = below(part).flatMap((c) => examplesOn(placed, c) ?? []);
  const examples = mine.length ? mine : chain.slice(0, -1).reverse().map((c) => examplesOn(placed, c)).find(Boolean);
  if (examples?.length) out.push(...examplesMarkdown(examples));
  out.push(...footer(x, { where: true, hidden: own.hidden }));
  return out.join('\n');
}

/** A position on no part (the indentation, between statements): the line's structure as one breadcrumb, and the link to the whole line. */
export function lineCard(x: HoverInput): string {
  return [`<small>${structureCrumb(x.ex.items, x.theme)}</small> &nbsp; ${lineLink(x)}`, ...footer(x, { where: true })].join('\n');
}

/**
 * The whole line, per command (Ctrl+K Ctrl+E, the link): the line, its structure as a breadcrumb, then one block per
 * command and per part with commands in it, as bash runs them: its name, badge and meaning, where it is, and its
 * arguments two levels deep; the deeper parts are counted, and left to the panel.
 */
export function wholeLine(x: HoverInput): string {
  const { ex, lang, theme } = x;
  const t = ui[lang];
  const out = [where(ex, lang, true), ''];
  if (x.lineText.trim() && ex.items.length) {
    const segs = lineSegments(x.lineText, ex.line, ex.items);
    while (!segs[0].text.trim()) segs.shift();
    segs[0].text = segs[0].text.trimStart();
    out.push('<code>' + segs.map((g) => (g.kind ? colored(g.text, g.kind, theme) : esc(g.text))).join('') + '</code>', '');
  }
  if (!ex.items.length) {
    out.push(...notes(ex, lang), t.empty);
    return out.join('\n');
  }
  const placed = x.placement === 'bottom' ? undefined : placeExamples(ex);
  const hasCommand = (tok: Token): boolean => isCommand(tok) || shown(tok).some(hasCommand);
  // A block: a top-level part, a command, or a part with commands in it.
  const blocks: { tok: Token; path: Token[] }[] = [];
  const collect = (ts: Token[], path: Token[]) => {
    for (const tok of ts) {
      if (!path.length || hasCommand(tok)) blocks.push({ tok, path });
      collect(shown(tok), [...path, tok]);
    }
  };
  collect(ex.items, []);
  const isBlock = (tok: Token) => blocks.some((b) => b.tok === tok);
  if (blocks.length > 1) out.push(`<small>${structureCrumb(ex.items, theme)}</small>`, '');
  out.push('---', '');
  let hidden = 0;
  for (const { tok, path } of blocks) {
    const at = path.filter((p) => !sameSpan(p.span, tok.span)).map((p) => crumbPart(p, theme)).join(sep('›'));
    out.push(`<b>${label(tok, theme, 40)}</b>${badge(tok)} — ${md(tok.explanation)}${tok.refs?.length ? ` <small>${refsMarkdown(lang, tok.refs)}</small>` : ''}${at ? `<br><small>${muted(t.hover.in)}${at}</small>` : ''}${also(tok)}`, '');
    const r = rows(shown(tok), 2, isBlock);
    hidden += r.hidden;
    const examples = placed && blockExamples(placed.items, tok, r.rows.map((row) => row.tok));
    if (examples && x.placement === 'first') out.push(...examplesMarkdown(examples, undefined, false), '');
    out.push(...table(r.rows, x));
    if (examples && x.placement === 'last') out.push(...examplesMarkdown(examples, undefined, false), '');
  }
  if (ex.notes.length) out.push('---', '', ...notes(ex, lang));
  out.push(...examplesMarkdown(placed ? placed.examples : ex.examples));
  out.push(...footer(x, { hidden }));
  return out.join('\n');
}

/** The examples of a block: those placed on it and on the rows it shows. */
function blockExamples(placed: Token[], tok: Token, shownRows: Token[]): Example[] | undefined {
  const found = [tok, ...shownRows].flatMap((r) => examplesOn(placed, r) ?? []);
  return found.length ? found : undefined;
}

/**
 * The Language Server's hover, in plain Markdown (no HTML, no command links): the part at the position first, then
 * the whole line below a rule. On no part, the whole line only.
 */
export function plainPartHover(ex: LineExplanation, chain: Token[], lang: Lang, whole: string): string {
  if (!chain.length) return whole;
  const part = chain[chain.length - 1];
  const t = ui[lang].hover;
  const flat = (tok: Token) => labelMarkdown(labelParts(tok));
  const out: string[] = [];
  if (chain.length > 1) out.push(chain.slice(0, -1).map(flat).join(' › ') + ' ›', '');
  const s = part.name?.said;
  out.push(`**${flat(part)}**${s ? ` · _${s.kind}_${s.by ? `, ${s.by}` : ''}` : ''}`, '');
  out.push(`${part.explanation}${part.refs?.length ? ` (${refsMarkdown(lang, part.refs)})` : ''}`, '');
  if (s?.also) out.push(`_${s.also}_`, '');
  const kids = shown(part);
  if (kids.length) out.push(...kids.map((k) => `- ${flat(k)} — ${explained(k)}`), '');
  const command = [...chain].reverse().find((c) => c !== part && isCommand(c));
  if (command) out.push(`${t.command}${flat(command)} — ${explained(command)}`, '');
  out.push('---', '', whole);
  return out.join('\n');
}
