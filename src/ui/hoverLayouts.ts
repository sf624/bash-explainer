// PROTOTYPE (design study, not for merging): other layouts of the hover, within what VS Code's hover sanitizer keeps
// (span style: color, background-color, display:inline-block, border-radius, in that order; span class: codicons;
// tables with colspan; details/summary; dl/dd; small; title attributes).
import { LineExplanation, Pos, Span, Token } from '../analyzer-types';
import { SHELL_NAMES } from '../dialect';
import { Lang } from '../i18n';
import { joinParts, labelParts } from '../label';
import { colored, contains, esc, ExamplePlacement, examplesMarkdown, lineSegments, noteRefs, placeExamples, refsMarkdown, toMarkdown, ui } from './render';
import { ThemeKind } from './palette';

export type HoverLayout = 'list' | 'tree' | 'commands' | 'token' | 'details';

export interface LayoutInput {
  ex: LineExplanation;
  lang: Lang;
  at?: Pos;
  panelLink?: string;
  lineText?: string;
  placement?: ExamplePlacement;
  theme: ThemeKind;
}

/** Prose with `code` spans, as HTML (inside an HTML block, Markdown is not read). */
function prose(text: string): string {
  const e = (s: string) => s.replace(/[&<>"'*_\\[\]~|#$]/g, (c) => `&#${c.charCodeAt(0)};`);
  return text.split(/(`+)([^`]*?)\1/).reduce<string[]>((out, part, i) => {
    // split with two groups: [text, fence, code, text, fence, code, …]
    const r = i % 3;
    if (r === 0) out.push(e(part));
    else if (r === 2) out.push(`<code>${e(part).replace(/ /g, '&nbsp;')}</code>`);
    return out;
  }, []).join('');
}

const muted = (html: string) => `<span style="color:var(--vscode-descriptionForeground);">${html}</span>`;

/** The name kind as a badge: the theme's badge colours, rounded; its tooltip says what the kind is. */
function badge(tok: Token): string {
  const s = tok.name?.said;
  if (!s) return '';
  const b = `<span title="${esc(s.title)}" style="color:var(--vscode-badge-foreground);background-color:var(--vscode-badge-background);border-radius:4px;">&nbsp;${esc(s.kind)}&nbsp;</span>`;
  return ` ${b}${s.by ? ` ${muted(prose(s.by))}` : ''}`;
}

const alsoLine = (tok: Token) => (tok.name?.said.also ? `<br><small>${muted(prose(tok.name.said.also))}</small>` : '');

function label(tok: Token, theme: ThemeKind, max = 22): string {
  let left = max;
  return joinParts(labelParts(tok), (p) => {
    let text = p.text.replace(/\s*\n\s*/g, ' ⏎ ');
    if (left <= 0) return '';
    if (text.length > left) text = text.slice(0, Math.max(1, left - 1)) + '…';
    left -= text.length;
    return p.placeholder ? `<i>${colored(text, 'comment', theme)}</i>` : colored(text, tok.kind, theme);
  });
}

const same = (a: Span, b: Span) => a.start.line === b.start.line && a.start.character === b.start.character && a.end.line === b.end.line && a.end.character === b.end.character;

/** The children, with a child that only restates its parent (the same span: a quoted word that is the whole argument) replaced by its own children. */
function shown(tok: Token): Token[] {
  return tok.children.flatMap((c) => (same(c.span, tok.span) ? shown(c) : [c]));
}

/** A command a reader thinks of as one unit: a command name of bash (it has name facts), or a command, outside an embedded language. */
const isCard = (t: Token) => !!t.name || (['command', 'builtin', 'function', 'alias'].includes(t.kind) && t.origin !== 'embedded');

function header(ex: LineExplanation, lang: Lang): string {
  const t = ui[lang];
  let h = `**${t.title}** · ${t.line(ex.line + 1)}`;
  if (ex.shell) h += ` · ${t.forShell(SHELL_NAMES[ex.shell])}`;
  if (ex.context.length) h += ' · _' + ex.context.map((c) => `${c.label} (${t.lineShort(c.line + 1)})`).join(' › ') + '_';
  return h;
}

function codeLine(ex: LineExplanation, lineText: string | undefined, theme: ThemeKind, mark?: Token): string | undefined {
  if (!lineText?.trim() || !ex.items.length) return undefined;
  const segs = lineSegments(lineText, ex.line, mark ? [mark] : ex.items);
  while (segs.length && !segs[0].text.trim()) segs.shift();
  if (segs.length) segs[0].text = segs[0].text.trimStart();
  return '<code>' + segs.map((g) => (g.kind ? colored(g.text, g.kind, theme) : esc(g.text))).join('') + '</code>';
}

function notes(ex: LineExplanation, lang: Lang): string[] {
  const small = (refs: readonly string[] | undefined) => (refs?.length ? ` <small>${refsMarkdown(lang, refs)}</small>` : '');
  return ex.notes.flatMap((n) => [`> ${n}${small(noteRefs(ex, n))}`, '']);
}

function footer(lang: Lang, panelLink?: string, more?: number): string[] {
  const t = ui[lang];
  const ja = lang === 'ja';
  const open = panelLink && `[$(comment-discussion) ${more ? (ja ? `ほか ${more} 項目はパネルで` : `${more} more in the panel`) : t.openInPanel}](${panelLink})`;
  return ['', '---', [open, `[$(gear) ${t.settings}](command:bashExplainer.openSettings)`].filter(Boolean).join(' &nbsp;·&nbsp; ')];
}

const refsSmall = (lang: Lang, refs?: readonly string[]) => (refs?.length ? ` <small>${refsMarkdown(lang, refs).replace(/\[([^\]]+)\]\(([^ )]+) "([^"]+)"\)/g, (_m, id, url, title) => `<a href="${url}" title="${esc(title)}">${id}</a>`).replace(/`/g, '')}</small>` : '');

const GLYPH = { mid: '├─', last: '└─', pipe: '│ ', none: '  ' };

interface Row { tok: Token; prefix: string }

/** The rows of a tree under `items`, each with its tree glyphs (├─ └─ │). `keep` stops the walk below a token. */
function treeRows(items: Token[], keep: (t: Token, depth: number) => boolean, depth = 0, lead = ''): { rows: Row[]; hidden: number } {
  const rows: Row[] = [];
  let hidden = 0;
  items.forEach((tok, i) => {
    const last = i === items.length - 1;
    const prefix = depth === 0 ? '' : lead + (last ? GLYPH.last : GLYPH.mid);
    rows.push({ tok, prefix });
    const kids = shown(tok);
    if (!kids.length) return;
    if (!keep(tok, depth)) {
      hidden += count(kids);
      return;
    }
    const sub = treeRows(kids, keep, depth + 1, depth === 0 ? '' : lead + (last ? GLYPH.none : GLYPH.pipe));
    rows.push(...sub.rows);
    hidden += sub.hidden;
  });
  return { rows, hidden };
}

const count = (ts: Token[]): number => ts.reduce((n, t) => n + 1 + count(shown(t)), 0);

function rowHtml(r: Row, x: LayoutInput): string {
  const strong = x.at && contains(r.tok, x.at);
  const lab = `${muted(esc(r.prefix))}${label(r.tok, x.theme)}`;
  const left = `<code>${strong ? `<strong>${lab}</strong>` : lab}</code>`;
  return `<tr><td>${left}</td><td>${prose(r.tok.explanation)}${badge(r.tok)}${refsSmall(x.lang, r.tok.refs)}${alsoLine(r.tok)}</td></tr>`;
}

/** A. Tree: one table, the tree drawn with glyphs in a monospace column, the explanation beside each row. */
function tree(x: LayoutInput): string {
  const ex = x.ex;
  const out = [header(ex, x.lang), ''];
  const line = codeLine(ex, x.lineText, x.theme);
  if (line) out.push(line, '');
  out.push(...notes(ex, x.lang));
  const { rows } = treeRows(ex.items, () => true);
  out.push('<table>', ...rows.map((r) => rowHtml(r, x)), '</table>', '');
  out.push(...examplesMarkdown(ex.examples));
  out.push(...footer(x.lang, x.panelLink));
  return out.join('\n');
}

/**
 * B. Commands: the structure of the line (lists, pipelines, substitutions, constructs) as a short tree, then one block per
 * command, as bash runs them: its name, badge and meaning as a heading, and its arguments two levels deep; the rest is
 * counted and left to the panel.
 */
function commands(x: LayoutInput): string {
  const ex = x.ex;
  const out = [header(ex, x.lang), ''];
  const line = codeLine(ex, x.lineText, x.theme);
  if (line) out.push(line, '');
  // The structure: tokens that are not commands, down to the commands (each command is a row that points below).
  const cards: { tok: Token; path: Token[] }[] = [];
  // Every command, in the order of the line, with the parts around it; a command another runs (`sudo find`) is one too.
  const collect = (ts: Token[], path: Token[]) => {
    for (const t of ts) {
      if (isCard(t)) cards.push({ tok: t, path });
      collect(shown(t), [...path, t]);
    }
  };
  collect(ex.items, []);
  const structure = treeRows(ex.items, (t) => !isCard(t));
  const ja = x.lang === 'ja';
  const frameRows = structure.rows.filter((r) => !isCard(r.tok) || r.prefix || ex.items.length > 1 || cards.length > 1);
  let hidden = 0;
  if (cards.length > 1 || !(ex.items.length === 1 && isCard(ex.items[0]))) {
    out.push(`<table>`, ...frameRows.map((r) => (isCard(r.tok)
      ? `<tr><td><code>${muted(esc(r.prefix))}${label(r.tok, x.theme)}</code></td><td>${badge(r.tok)} ${muted('↓')}</td></tr>`
      : rowHtml(r, x))), '</table>', '');
  }
  for (const { tok, path } of cards) {
    const lab = label(tok, x.theme, 40);
    const where = path.filter((p) => !same(p.span, tok.span)).map((p) => `<code>${label(p, x.theme, 18)}</code>`).join(' › ');
    out.push('---', '');
    out.push(`<code>${x.at && contains(tok, x.at) ? `<strong>${lab}</strong>` : lab}</code>${badge(tok)} — ${prose(tok.explanation)}${refsSmall(x.lang, tok.refs)}${where ? `<br><small>${muted(ja ? '場所: ' : 'in: ')}${where}</small>` : ''}${alsoLine(tok)}`, '');
    // Its arguments: two levels; a command inside them has its own block.
    const args = shown(tok).filter((c) => !isCard(c));
    const r = treeRows(args, (t, depth) => depth < 2 && !isCard(t), 1, "");
    const rows = r.rows.filter((row) => !isCard(row.tok));
    hidden += r.hidden;
    if (rows.length) out.push('<table>', ...rows.map((row) => rowHtml(row, x)), '</table>', '');
  }
  if (ex.notes.length) out.push('---', '', ...notes(ex, x.lang));
  out.push(...examplesMarkdown(ex.examples));
  out.push(...footer(x.lang, x.panelLink, hidden));
  return out.join('\n');
}

/** The chain of tokens under the position, outermost first (a token that restates its parent is left out). */
export function chainAt(items: Token[], at: Pos): Token[] {
  const chain: Token[] = [];
  let level = items;
  for (;;) {
    const t = level.find((c) => contains(c, at));
    if (!t) return chain;
    chain.push(t);
    level = shown(t);
  }
}

/**
 * C. Token: the part under the mouse, not the whole line. A breadcrumb of the parts around it (each with its meaning as a
 * tooltip), the part itself with its badge, meaning and parts, and the command it belongs to. Without a position (the
 * keyboard command), the whole line as in B.
 */
function token(x: LayoutInput): string {
  if (!x.at) return commands(x);
  const ex = x.ex;
  const chain = chainAt(ex.items, x.at);
  if (!chain.length) return commands(x);
  const target = chain[chain.length - 1];
  const ja = x.lang === 'ja';
  const out = [header(ex, x.lang), ''];
  const line = codeLine(ex, x.lineText, x.theme, target);
  if (line) out.push(line, '');
  const crumbs = chain.slice(0, -1).map((t) => `<span title="${esc(t.explanation.replace(/`/g, ''))}"><code>${label(t, x.theme, 18)}</code></span>`);
  if (crumbs.length) out.push(`<small>${crumbs.join(' › ')} ›</small>`, '');
  out.push(`### <code>${label(target, x.theme, 48)}</code>${badge(target)}`, '', `${prose(target.explanation)}${refsSmall(x.lang, target.refs)}${alsoLine(target)}`, '');
  const kids = shown(target);
  if (kids.length) {
    const r = treeRows(kids, (_t, d) => d < 1, 1, '');
    out.push('<table>', ...r.rows.map((row) => rowHtml(row, { ...x, at: undefined })), '</table>', '');
  }
  // The command this part belongs to, in one line, when it is not the part itself.
  const card = [...chain].reverse().find((t) => isCard(t) && t !== target);
  if (card) out.push(`<small>${muted(ja ? 'コマンド: ' : 'Command: ')}<code>${label(card, x.theme)}</code>${badge(card)} — ${prose(card.explanation)}</small>`, '');
  out.push(...notes(ex, x.lang));
  const exs = placeExamples(ex);
  const own = [...chain].reverse().map((t) => findCopy(exs.items, t)?.examples).find((e) => e?.length);
  if (own) out.push(...examplesMarkdown(own));
  out.push(...footer(x.lang, x.panelLink));
  out.push('', `<small>${muted(ja ? '行全体: Ctrl+K Ctrl+E' : 'Whole line: Ctrl+K Ctrl+E')}</small>`);
  return out.join('\n');
}

function findCopy(items: Token[], t: Token): Token | undefined {
  for (const c of items) {
    if (same(c.span, t.span) && c.kind === t.kind && c.label === t.label) return c;
    const f = findCopy(c.children, t);
    if (f) return f;
  }
  return undefined;
}

/** D. Details: each part with parts of its own folds (details/summary), indented with dl/dd; everything starts folded. */
function details(x: LayoutInput): string {
  const ex = x.ex;
  const out = [header(ex, x.lang), ''];
  const line = codeLine(ex, x.lineText, x.theme);
  if (line) out.push(line, '');
  out.push(...notes(ex, x.lang));
  const one = (t: Token): string => {
    const head = `<code>${label(t, x.theme)}</code>${badge(t)} — ${prose(t.explanation)}${refsSmall(x.lang, t.refs)}`;
    const kids = shown(t);
    if (!kids.length) return `<div>${head}${alsoLine(t)}</div>`;
    return `<details><summary>${head}</summary>${alsoLine(t) ? `<div>${alsoLine(t).replace(/^<br>/, '')}</div>` : ''}<dl><dd>${kids.map(one).join('')}</dd></dl></details>`;
  };
  // (The sanitizer drops `open`, so a details element always starts folded: the top level is shown open, as plain rows.)
  const top = (t: Token): string => {
    const head = `<code>${label(t, x.theme)}</code>${badge(t)} — ${prose(t.explanation)}${refsSmall(x.lang, t.refs)}${alsoLine(t)}`;
    const kids = shown(t);
    return `<div>${head}</div>${kids.length ? `<dl><dd>${kids.map(one).join('')}</dd></dl>` : ''}`;
  };
  out.push(`<div>${ex.items.map(top).join('')}</div>`, '');
  out.push(...examplesMarkdown(ex.examples));
  out.push(...footer(x.lang, x.panelLink));
  return out.join('\n');
}

export function layoutMarkdown(layout: HoverLayout, x: LayoutInput): string {
  if (layout === 'list' || !x.ex.items.length) return toMarkdown(x.ex, x.lang, x.at, x.panelLink, x.lineText, x.placement, x.theme);
  return { tree, commands, token, details }[layout](x);
}

/** The range the hover is for: the part under the mouse in the token layout (moving off it asks again), else the line. */
export function hoverSpan(layout: HoverLayout, ex: LineExplanation, at?: Pos): Span | undefined {
  if (layout !== 'token' || !at) return undefined;
  const chain = chainAt(ex.items, at);
  return chain[chain.length - 1]?.span;
}
