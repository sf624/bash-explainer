// The hover's Markdown (docs/design/hover.md): the part at the position, a small card for a position on no part, and
// the whole line, per command. VS Code's hover keeps only some HTML (see test/hover-view.test.ts): `<span style>` in
// one shape (a colour, a background, display:inline-block, border-radius, in that order), tables, `<small>`, `title`.
// Inside an HTML block (a table) Markdown is not read, so its text is turned into HTML here (`prose`).
import { Example, ExampleSection, LineExplanation, Token } from '../analyzer-types';
import { SHELL_NAMES } from '../dialect';
import { Lang } from '../i18n';
import { joinParts, labelParts } from '../label';
import { referencesWith } from '../references';
import { pictureLabel, pictureText, splitPictures } from '../ctlchars';
import { isCommand, partNotes, ProblemAt, sameSpan, shown, valueOf } from './hoverParts';
import { type NoteLevel, SPACE_MARK, type SpaceEnds, splitNote, type ValueSaid } from '../messages';
import { levelColour, ThemeKind } from './palette';
import { colored, esc, ExamplePlacement, examplesMarkdown, explained, labelMarkdown, lineSegments, noteRefs, notesByLevel, placeExamples, plainNotes, refsMarkdown, ui, valueMarkdown } from './render';

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
  /** The problems the editor shows above the part in the same hover (the diagnostics at the position): the part leaves out their notes. */
  problems?: readonly ProblemAt[];
}

/** Text for an attribute (a tooltip): only what would end it or start a tag is escaped, so that it still wraps. */
const attr = (text: string) => text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

const muted = (html: string) => `<span style="color:var(--vscode-descriptionForeground);">${html}</span>`;

/** Where the code span that opens with `ticks` backticks at `from` closes (the next run of exactly as many), or -1. */
function closingTicks(s: string, from: number, ticks: number): number {
  for (let i = from; i < s.length;) {
    if (s[i] !== '`') {
      i++;
      continue;
    }
    let j = i;
    while (s[j] === '`') j++;
    if (j - i === ticks) return i;
    i = j;
  }
  return -1;
}

/**
 * Text with `code` spans for a Markdown paragraph. The text can carry words of the script, so outside the code spans
 * (found as CommonMark finds them: a run of backticks closes at the next run of the same length) every character that
 * Markdown or HTML reads is written as an entity (`<dir>` would start a tag, `[x](url)` a link, `*x*` emphasis), and
 * a line break is a space. A run of backticks with no closing run is text.
 */
export function md(text: string): string {
  const flat = text.replace(/\s*\n\s*/g, ' ').trimStart();
  const lit = (s: string) => splitPictures(s).map((part, i) => (i % 2 ? pictureMark(part) : part.replace(/[&<>*_`\\[\]~|#$]/g, (c) => (c === '<' ? '&lt;' : c === '>' ? '&gt;' : `&#${c.charCodeAt(0)};`)))).join('');
  let out = '';
  let plain = '';
  for (let i = 0; i < flat.length;) {
    if (flat[i] !== '`') {
      plain += flat[i++];
      continue;
    }
    let j = i;
    while (flat[j] === '`') j++;
    const end = closingTicks(flat, j, j - i);
    if (end < 0) {
      plain += flat.slice(i, j);
      i = j;
    } else {
      // (A span with a control picture is HTML, where the picture can be drawn as a mark.)
      out += lit(plain) + (splitPictures(flat.slice(j, end)).length > 1 ? codeHtml(flat.slice(j, end)) : flat.slice(i, end + (j - i)));
      plain = '';
      i = end + (j - i);
    }
  }
  // (At the start of the paragraph, a `-`, `+`, `=` or `1.` would make a list, a rule or a heading.)
  return (out + lit(plain)).replace(/^(?:([-+=])|(\d+)([.)]))/, (_m, mark?: string, n?: string, dot?: string) => (mark ? `&#${mark.charCodeAt(0)};` : `${n}&#${dot!.charCodeAt(0)};`));
}

/** Text for an HTML block, where Markdown is not read: what Markdown would take for markup is escaped. */
const escapeHtml = (text: string) => text.replace(/[&<>"'*_\\[\]~|#$]/g, (c) => `&#${c.charCodeAt(0)};`);

/**
 * A control picture in a hover: its name (`LF`) small, on the badge background, as a mark of a space is. A glyph for it is a
 * box where no font has the block of control pictures (src/ctlchars.ts, `pictureLabel`).
 */
const pictureMark = (picture: string) => `<span style="color:var(--vscode-badge-foreground);background-color:var(--vscode-badge-background);border-radius:2px;"><small>&nbsp;${pictureLabel(picture)}&nbsp;</small></span>`;

/** Text for an HTML block, its control pictures drawn as marks. */
const textInner = (text: string) => splitPictures(text).map((part, i) => (i % 2 ? pictureMark(part) : escapeHtml(part))).join('');

/** The text of a `<code>` element: its spaces kept, its control pictures drawn as marks. */
const codeInner = (text: string) => splitPictures(text).map((part, i) => (i % 2 ? pictureMark(part) : escapeHtml(part).replace(/ /g, '&nbsp;'))).join('');

/** Text as a `<code>` element, its spaces kept. */
const codeHtml = (text: string) => `<code>${codeInner(text)}</code>`;

/**
 * `text` (Markdown) with its control pictures drawn as marks: a code span that holds one becomes a `<code>` element (a code
 * span shows its text as it is), the others are replaced where they stand.
 */
export function pictureSpans(text: string): string {
  return text.replace(/(`+)([^`]*?)\1|[␀-␟␡⇥]/gu, (all, ticks?: string, code?: string) => (ticks === undefined ? pictureMark(all) : splitPictures(code!).length > 1 ? codeHtml(code!) : all));
}

/** Text with `code` spans, as HTML (for an HTML block, where Markdown is not read). */
export function prose(text: string): string {
  // split with two groups: [text, fence, code, text, fence, code, …]
  return text.split(/(`+)([^`]*?)\1/).map((part, i) => (i % 3 === 0 ? textInner(part) : i % 3 === 2 ? codeHtml(part) : '')).join('');
}

/**
 * A mark of a space in a hover: a real (non-breaking) space on the badge background, with the name of the mark as its
 * tooltip. A hover keeps only a few styles on a span (`colored`), and a glyph for a space (`␠`) is a box where no font has it.
 */
const spaceMark = (label: string) => `<span style="background-color:var(--vscode-badge-background);border-radius:2px;" title="${attr(label)}">&nbsp;</span>`;

/** The shown text of a value, or of a word of it, as `<code>`: the marks at its ends (`SpaceEnds`) are drawn as `spaceMark`. */
function valueCode(text: string, [lead, trail]: SpaceEnds, mark: string): string {
  const middle = [...text].slice(lead, [...text].length - trail).join('');
  return `<code>${mark.repeat(lead)}${codeInner(middle)}${mark.repeat(trail)}</code>`;
}

/**
 * The line of a value (`ValueSaid`) as HTML, made of its parts: the value and the words are code as they are, not
 * found again in the Markdown text, where a backtick in a value is ambiguous with a fence.
 */
export function valueHtml(said: ValueSaid): string {
  const mark = spaceMark(said.spaceLabel ?? '');
  const split = said.split ? `${prose(said.split.said)}${said.split.words.map((w, i) => ` ${valueCode(w, said.split!.wordEnds[i], mark)}`).join('')}` : '';
  // (The note that names the mark shows it the same way.)
  const tail = said.tail ? prose(said.tail).replace(`<code>${SPACE_MARK}</code>`, `<code>${mark}</code>`) : '';
  return `${escapeHtml(said.lead)} ${said.value !== undefined ? valueCode(said.value, said.valueEnds!, mark) : escapeHtml(said.empty!)}${split}${tail}`;
}

/**
 * The words of a section of words (`ExampleSection.words`, a brace expansion) as HTML: each a `<code>`, as the words of
 * a value (`valueHtml`), so that they read as separate words; the marks of a space drawn as `spaceMark`.
 */
export function wordsHtml(sec: ExampleSection): string {
  const w = sec.words!;
  const mark = spaceMark(w.spaceLabel ?? '');
  const words = sec.lines.length ? sec.lines.map((l, i) => valueCode(l, w.ends[i], mark)).join(' ') : escapeHtml(sec.empty!);
  return w.after ? `${words} ${prose(w.after).replace(`<code>${SPACE_MARK}</code>`, `<code>${mark}</code>`)}` : words;
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

/** The value of an expansion where it runs (`Token.value`: the model's), on a line of its own. */
const value = (tok: Token) => {
  const v = valueOf(tok);
  return v ? `<br><small>${valueHtml(v.said)}</small>` : '';
};

/** The references (the manual's sections, manual pages), small, as HTML links. */
function refsHtml(lang: Lang, refs?: readonly string[]): string {
  if (!refs?.length) return '';
  return ` <small>${referencesWith(lang, refs, (r, shown) => `<a href="${r.url}" title="${attr(r.title)}">${shown}</a>`)}</small>`;
}

/** A part as a row's text: its meaning, badge, sections and other meanings. */
const about = (tok: Token, lang: Lang) => `${prose(tok.explanation)}${badge(tok)}${refsHtml(lang, tok.refs)}${also(tok)}${value(tok)}`;

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

/** The link that explains the whole line (`text`: "Whole line" by default), with its keys in the tooltip. */
function lineLink(x: HoverInput, text = ui[x.lang].hover.wholeLine): string {
  const t = ui[x.lang].hover;
  return `[$(list-tree) ${text}](${x.lineLink} "${t.wholeLineTitle} (${x.keys})")`;
}

/** "Bash Explainer · Line 3 · checked for POSIX sh · for loop (line 2)". */
function where(ex: LineExplanation, lang: Lang, bold: boolean): string {
  const t = ui[lang];
  let h = `${bold ? `**${t.title}**` : t.title} · ${t.line(ex.line + 1)}`;
  if (ex.shell) h += ` · ${t.forShell(SHELL_NAMES[ex.shell])}`;
  if (ex.context.length) h += ' · _' + ex.context.map((c) => `${c.label} (${t.lineShort(c.line + 1)})`).join(' › ') + '_';
  return h;
}

/** The codicon of each level, as the Problems panel shows it; a plain note has the info icon in the muted colour. */
const LEVEL_ICON: Record<NoteLevel, string> = { warning: 'warning', info: 'info', note: 'info' };

/**
 * A note: the level's codicon in the level's colour, and its word in bold ("**Pitfall:**"), in place of the mark it
 * starts with (src/messages.ts). The word and the icon's shape say the level without the colour.
 */
function noteMarkdown(note: string, lang: Lang, theme: ThemeKind): string {
  const { level, label, body } = splitNote(note, lang);
  const colour = level === 'note' ? 'var(--vscode-descriptionForeground)' : levelColour(level, theme);
  const icon = `<span style="color:${colour};">$(${LEVEL_ICON[level]})</span>`;
  return `${icon} ${label ? `<span style="color:${colour};"><strong>${esc(label)}</strong></span> ` : ''}${md(body)}`;
}

/**
 * Notes of the line (all of them by default), warnings first, each with its level and the sections of the manual it is
 * about. Paragraphs, not quotes: VS Code's hover gives a quote no bar, only the browser's margins (40 px on each side).
 */
function notes(ex: LineExplanation, lang: Lang, theme: ThemeKind, list: readonly string[] = ex.notes): string[] {
  return notesByLevel(list).flatMap((n) => {
    const refs = noteRefs(ex, n);
    return [`${noteMarkdown(n, lang, theme)}${refs?.length ? ` <small>${refsMarkdown(lang, refs)}</small>` : ''}`, ''];
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
 * to, then its notes and its examples, so that the first lines answer what the part is. The other notes of the line
 * (about other parts, or about the line) are counted in a link to the whole line, at the end. `chain` is not empty: on
 * no part, the providers show `lineCard` (VS Code) or the whole line (`plainPartHover`, the Language Server).
 */
export function partHover(x: HoverInput, chain: Token[]): string {
  const part = chain[chain.length - 1];
  const t = ui[x.lang].hover;
  const out: string[] = [];
  const crumbs = chain.slice(0, -1).map((c) => crumbPart(c, x.theme));
  out.push(`${crumbs.length ? `<small>${crumbs.join(sep('›'))}${sep('›')}</small> &nbsp; ` : ''}${lineLink(x)}`, '');
  out.push(`<b>${label(part, x.theme, 48)}</b>${badge(part)}`, '');
  out.push(`${md(part.explanation)}${part.refs?.length ? ` <small>${refsMarkdown(x.lang, part.refs)}</small>` : ''}${also(part)}`, '');
  const v = valueOf(part);
  if (v) out.push(valueHtml(v.said), '');
  const own = rows(shown(part), 1, () => false);
  out.push(...table(own.rows, x));
  const command = [...chain].reverse().find((c) => c !== part && isCommand(c));
  if (command) out.push(`<small>${muted(t.command)}${label(command, x.theme)}${badge(command)} — ${md(command.explanation)}</small>`, '');
  const { about, others } = partNotes(x.ex, part, x.problems);
  out.push(...notes(x.ex, x.lang, x.theme, about));
  // Its examples: those of the part and its own parts, else those of the nearest part around it.
  const placed = placeExamples(x.ex).items;
  const below = (tok: Token): Token[] => [tok, ...shown(tok).flatMap(below)];
  const mine = below(part).flatMap((c) => examplesOn(placed, c) ?? []);
  const examples = mine.length ? mine : chain.slice(0, -1).reverse().map((c) => examplesOn(placed, c)).find(Boolean);
  if (examples?.length) out.push(...examplesMarkdown(examples, undefined, true, false, pictureSpans, wordsHtml));
  if (others.length) out.push('', lineLink(x, t.moreNotes(others.length)));
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
    out.push(...notes(ex, lang, theme), t.empty);
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
    if (examples && x.placement === 'first') out.push(...examplesMarkdown(examples, undefined, false, false, pictureSpans, wordsHtml), '');
    out.push(...table(r.rows, x));
    if (examples && x.placement === 'last') out.push(...examplesMarkdown(examples, undefined, false, false, pictureSpans, wordsHtml), '');
  }
  if (ex.notes.length) out.push('---', '', ...notes(ex, lang, theme));
  out.push(...examplesMarkdown(placed ? placed.examples : ex.examples, undefined, true, false, pictureSpans, wordsHtml));
  out.push(...footer(x, { hidden }));
  return out.join('\n');
}

/** The examples of a block: those placed on it and on the rows it shows. */
function blockExamples(placed: Token[], tok: Token, shownRows: Token[]): Example[] | undefined {
  const found = [tok, ...shownRows].flatMap((r) => examplesOn(placed, r) ?? []);
  return found.length ? found : undefined;
}

/**
 * The Language Server's hover, in plain Markdown (no HTML, no command links): the part at the position first, with
 * its notes (`partNotes`), then the whole line below a rule, with all of them. On no part, the whole line only.
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
  out.push(`${pictureText(part.explanation)}${part.refs?.length ? ` (${refsMarkdown(lang, part.refs)})` : ''}`, '');
  if (s?.also) out.push(`_${s.also}_`, '');
  const v = valueOf(part);
  if (v) out.push(pictureText(v.said.text), '');
  const kids = shown(part);
  if (kids.length) out.push(...kids.map((k) => `- ${flat(k)} — ${explained(k)}${valueMarkdown(valueOf(k), '  ')}`), '');
  const command = [...chain].reverse().find((c) => c !== part && isCommand(c));
  if (command) out.push(`${t.command}${flat(command)} — ${explained(command)}`, '');
  out.push(...plainNotes(ex, partNotes(ex, part).about, lang));
  out.push('---', '', whole);
  return out.join('\n');
}
