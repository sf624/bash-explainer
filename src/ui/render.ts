import { pictureText } from '../ctlchars';
import { Example, ExampleSection, Kind, LineExplanation, Pos, Span, Token, ValueInfo } from '../analyzer-types';
import { SHELL_NAMES } from '../dialect';
import { Lang } from '../i18n';
import { codeSpan, joinParts, LabelPart, labelParts } from '../label';
import { referencesWith } from '../references';
import type { Basis, TryIt } from '../basis';
import { LEVELS } from '../levels';
import { basisSaid, type BasisSaid, type Note } from '../messages';
import type { ReadingNode } from '../reading';
import { errorColour, Role, roleColour, ThemeKind } from './palette';
import { ui } from './texts';

/** (Moved to src/label.ts, which the message catalog reads too.) */
export { codeSpan };

/** The sections of the manual a note cites: those of the fact it says (`LineExplanation.facts`), if it is one. */
export function noteRefs(ex: LineExplanation, note: string): readonly string[] | undefined {
  return ex.facts?.find((f) => f.text === note)?.refs;
}

/** What a view marks on a note that rests on bash's behaviour (docs/design/basis.md, 3): the chip, and the try-it. */
export interface NoteBasis extends BasisSaid { tryIt: { code: string; output: string } }

/**
 * The basis a view marks on a note: on a fact that is `checked` or `differs` only, with its try-it (a try-it with no
 * chip is not shown: docs/design/basis.md, decision 3). None when the setting `notes.basis` is off: the fact has none.
 */
export function noteBasis(ex: LineExplanation, note: string, lang: Lang): NoteBasis | undefined {
  const f = ex.facts?.find((g) => g.text === note);
  return f && partBasis(f, lang);
}

/**
 * The basis a view marks on a fact, a token or a node of Reading (`basis`, `tryIt`: docs/design/basis.md, step 4), as
 * on a note: for `checked` and `differs` only, with the try-it.
 */
export function partBasis(x: { basis?: Basis; tryIt?: TryIt }, lang: Lang): NoteBasis | undefined {
  const said = basisSaid(lang, x.basis);
  if (!said) return undefined;
  // (A basis and its try-it come from the same probe row: one with a basis has a try-it, src/basis.ts.)
  const { code, output } = x.tryIt!;
  return { ...said, tryIt: { code, output } };
}

/** A token or a node of Reading as the panel draws it: with the chip and the try-it of its basis (`partBasis`), if any. */
export type BasisShown<T> = T & { basisShown?: NoteBasis };

/**
 * The explanation as the panel draws it: each token and each node of Reading with its chip and try-it in the language
 * (`basisShown`), where it rests on bash's behaviour rather than the manual.
 */
export function withBasisShown(ex: LineExplanation, lang: Lang): LineExplanation {
  // (A part with nothing to show, and nothing under it, is the same object: the line is sent as it was.)
  const shown = <T extends { basis?: Basis; tryIt?: TryIt; children: T[] }>(x: T): BasisShown<T> => {
    const b = partBasis(x, lang);
    const children = x.children.map(shown);
    return b || children.some((c, i) => c !== x.children[i]) ? { ...x, ...(b ? { basisShown: b } : {}), children } : x;
  };
  const items = ex.items.map(shown);
  const reading = ex.reading && shown<ReadingNode>(ex.reading);
  return items.some((t, i) => t !== ex.items[i]) || reading !== ex.reading ? { ...ex, items, ...(reading ? { reading } : {}) } : ex;
}

/**
 * A note's basis in one line, for the outputs with no chip (the hover, Markdown, the CLI's text): the chip's words,
 * then the try-it, its code and its output (lines joined by ⏎). `code` wraps a code: a code span, or nothing.
 */
export function basisLine(lang: Lang, b: NoteBasis, code: (text: string) => string): string {
  const t = ui[lang].panel;
  return `${b.label} · ${t.tryIt}: ${code(b.tryIt.code)} → ${code(b.tryIt.output.replace(/\n/g, ' ⏎ '))}`;
}

/** The data of a note of the line (`LineExplanation.noteInfo`): its level and its word come from there, never from its text. */
export function noteOf(ex: LineExplanation, note: string): Note {
  return ex.noteInfo[ex.notes.indexOf(note)];
}

/**
 * Notes of the line (`notes`, all of them by default) in the order every output shows them: the warnings, then the
 * information, then the other notes, each in the order found.
 */
export function notesByLevel(ex: LineExplanation, notes: readonly string[] = ex.notes): Note[] {
  return notes.map((n, i) => ({ n: noteOf(ex, n), i })).sort((a, b) => LEVELS[a.n.level].rank - LEVELS[b.n.level].rank || a.i - b.i).map((x) => x.n);
}

/** "Bash manual [3.2.5.2](…), [6.4](…); [execve(2)](…)": the references as Markdown links (src/references.ts). */
export function refsMarkdown(lang: Lang, refs: readonly string[]): string {
  return referencesWith(lang, refs, (r, shown) => `[${shown}](${r.url} "${r.title}")`);
}

/** " (Bash manual 3.7.2; execve(2))", after a row that cites references. */
export function refsText(lang: Lang, refs: readonly string[]): string {
  return ` (${referencesWith(lang, refs, (_, shown) => shown)})`;
}

/**
 * A token's explanation for an output with no badge (the hover, Markdown, the CLI): with the kind of its command name,
 * and who runs it, when it is one (`Token.name`): "Print arguments to stdout (builtin)".
 */
export function explained(tok: Token): string {
  return pictureText(tok.name ? tok.explanation + tok.name.said.short : tok.explanation);
}

/**
 * The value of an expansion where it runs (`Token.value`: the model's), for a row of a Markdown list: a hard line
 * break, then the line, indented by `indent` under the row's text. Empty without a value.
 */
export function valueMarkdown(value: ValueInfo | undefined, indent: string): string {
  return value ? `\\\n${indent}${pictureText(value.said.text)}` : '';
}

/**
 * What a part rests on where it is bash's behaviour rather than the manual (`partBasis`), for a row of a Markdown list:
 * a hard line break, then the chip's words and the try-it in italics, indented by `indent`. Empty without one.
 */
export function basisMarkdown(x: { basis?: Basis; tryIt?: TryIt }, lang: Lang, indent: string): string {
  const b = partBasis(x, lang);
  return b ? `\\\n${indent}_${basisLine(lang, b, codeSpan)}_` : '';
}

/**
 * Where worked examples go: under the token they explain, before (`first`) or after (`last`) the
 * explanations of its parts, or all together at the end (`bottom`).
 */
export type ExamplePlacement = 'first' | 'last' | 'bottom';

function covers(outer: Span, inner: Span): boolean {
  const le = (a: Pos, b: Pos) => a.line < b.line || (a.line === b.line && a.character <= b.character);
  return le(outer.start, inner.start) && le(inner.end, outer.end);
}

/**
 * A copy of the explanation with each example moved onto the token for its anchor
 * (`Token.examples`): the outermost token with exactly that range, else the deepest one covering
 * it. Examples with no such token stay in `examples`, shown at the end.
 */
export function placeExamples(ex: LineExplanation): LineExplanation {
  const copy = (t: Token): Token => ({ ...t, children: t.children.map(copy), examples: undefined });
  const items = ex.items.map(copy);
  const rest: Example[] = [];
  for (const e of ex.examples) {
    let best: { tok: Token; depth: number } | undefined;
    let exact: Token | undefined;
    const visit = (t: Token, depth: number) => {
      if (!e.anchor || !covers(t.span, e.anchor)) return;
      if (!exact && covers(e.anchor, t.span)) exact = t;
      if (!best || depth >= best.depth) best = { tok: t, depth };
      t.children.forEach((c) => visit(c, depth + 1));
    };
    items.forEach((t) => visit(t, 0));
    const target = exact ?? best?.tok;
    if (target) (target.examples ??= []).push(e);
    else rest.push(e);
  }
  return { ...ex, items, examples: rest };
}

/** The colour role of each token kind; the same palette as the panel (media/panel.css). */
const KIND_ROLE: Record<Kind, Role | 'comment' | 'error'> = {
  command: 'command', subcommand: 'command', builtin: 'command', function: 'command', alias: 'command',
  option: 'option',
  argument: 'argument', string: 'argument', number: 'argument',
  operator: 'operator', keyword: 'operator', block: 'operator', test: 'operator',
  redirect: 'redirect', pattern: 'redirect',
  variable: 'variable', expansion: 'variable', substitution: 'variable', assignment: 'variable',
  comment: 'comment',
  // (The shebang names the program that runs the file: drawn as a command name, not as a comment.)
  shebang: 'command',
  error: 'error',
};

/** The CSS colour of a token kind in the hover, in a theme of that kind (src/ui/palette.ts). */
function kindColor(kind: Kind, theme: ThemeKind): string {
  const role = KIND_ROLE[kind];
  if (role === 'comment') return 'var(--vscode-descriptionForeground)';
  if (role === 'error') return errorColour(theme);
  return roleColour(role, theme);
}

/** Escape text for inline HTML inside Markdown (entities also stop `*`, `_` etc. acting as Markdown). */
export function esc(text: string): string {
  return text.replace(/[&<>"'*_`\\[\]~|#$]/g, (c) => `&#${c.charCodeAt(0)};`).replace(/ /g, '&nbsp;');
}

/** Hover HTML only keeps `<span style>` in exactly this shape: `color:<#hex|var(--vscode-…)>;`. */
export function colored(text: string, kind: Kind, theme: ThemeKind): string {
  return `<span style="color:${kindColor(kind, theme)};">${esc(text)}</span>`;
}


/** Split a line into runs, each owned by the deepest token covering it (as the panel does). */
export function lineSegments(text: string, line: number, items: Token[]): { text: string; kind?: Kind }[] {
  const owner: (Token | undefined)[] = new Array(text.length).fill(undefined);
  const depthAt: number[] = new Array(text.length).fill(-1);
  const visit = (tok: Token, depth: number) => {
    const { start, end } = tok.span;
    if (start.line <= line && end.line >= line) {
      const from = start.line < line ? 0 : start.character;
      const to = Math.min(end.line > line ? text.length : end.character, text.length);
      for (let i = from; i < to; i++) {
        if (depth >= depthAt[i]) {
          depthAt[i] = depth;
          owner[i] = tok;
        }
      }
    }
    tok.children.forEach((c) => visit(c, depth + 1));
  };
  items.forEach((t) => visit(t, 0));
  const out: { text: string; kind?: Kind }[] = [];
  for (let i = 0; i < text.length;) {
    let j = i;
    while (j < text.length && owner[j] === owner[i]) j++;
    const part = text.slice(i, j);
    out.push({ text: part, kind: part.trim() ? owner[i]?.kind : undefined });
    i = j;
  }
  return out;
}


/**
 * The words of a section of words (`ExampleSection.words`) on one line: each a code span, so that they read as separate
 * words, then what is said after them; control pictures as `pictureText` writes them.
 */
export function wordsMarkdown(sec: ExampleSection): string {
  const words = sec.lines.length ? sec.lines.map((w) => codeSpan(pictureText(w))).join(' ') : sec.empty!;
  return sec.words?.after ? `${words} ${sec.words.after}` : words;
}

/**
 * Examples as headings with one code block per section, so every line keeps its own row. Without `indent`, as blocks of
 * their own, each after a rule (`rule`); with it, inside a list item. An example's note is a quote, or a paragraph when
 * not `quote` (VS Code's hover gives a quote no bar, only the browser's margins). The control pictures of the lines (a code
 * block draws no marks) are written as `<LF>`; those of the note, as `pictureText` does or as `noteText` says. A section
 * of words is a line of code spans (`wordsMarkdown`), or as `wordsText` writes it.
 */
export function examplesMarkdown(examples: Example[], indent?: string, rule = true, quote = true, noteText: (note: string) => string = pictureText, wordsText: (sec: ExampleSection) => string = wordsMarkdown): string[] {
  const out: string[] = [];
  for (const e of examples) {
    if (indent === undefined) out.push('', ...(rule ? ['---', ''] : []), `#### ${e.title}`);
    else out.push(`${indent}##### ${e.title}`);
    if (e.note) out.push(...(indent === undefined ? ['', `${quote ? '> ' : ''}${noteText(e.note)}`] : [`${indent}> ${noteText(e.note)}`]));
    for (const sec of e.sections) {
      if (sec.words) {
        out.push(...(indent === undefined ? ['', `**${sec.label}**`, '', wordsText(sec)] : [`${indent}**${sec.label}**\\`, `${indent}${wordsText(sec)}`]));
        continue;
      }
      const lines = (sec.lines.length ? sec.lines : [sec.empty ?? '']).map(pictureText);
      // The fence must be longer than any run of backticks inside.
      const longest = Math.max(2, ...lines.map((l) => Math.max(0, ...(l.match(/`+/g) ?? []).map((m) => m.length))));
      const fence = '`'.repeat(longest + 1);
      if (indent === undefined) out.push('', `**${sec.label}**`, '', `${fence}text`, ...lines, fence);
      // A heading and a fence may each interrupt a paragraph, so the label needs no blank line around it.
      else out.push(`${indent}**${sec.label}**`, `${indent}${fence}text`, ...lines.map((l) => indent + l), `${indent}${fence}`);
    }
  }
  return out;
}

/** A label as Markdown: code parts as code spans, placeholders in italics (`if` *condition* `then`). */
export function labelMarkdown(parts: readonly LabelPart[]): string {
  return joinParts(parts, (p) => (p.placeholder ? `*${p.text}*` : codeSpan(p.text.replace(/\s*\n\s*/g, ' ⏎ '))));
}

/**
 * Notes of a line as plain Markdown quotes, warnings first: each keeps its mark, and its word in bold
 * (`> ⚠ **Pitfall:** …`), with the sections of the manual it cites, and, where it rests on bash's behaviour rather
 * than the manual, a line in italics with the chip's words and the try-it (`noteBasis`).
 */
export function plainNotes(ex: LineExplanation, notes: readonly string[], lang: Lang): string[] {
  return notesByLevel(ex, notes).flatMap(({ text, level, label, body }) => {
    const refs = noteRefs(ex, text);
    const basis = noteBasis(ex, text, lang);
    return [`> ${pictureText(label ? `${LEVELS[level].mark} **${label}** ${body}` : text)}${refs?.length ? ` (${refsMarkdown(lang, refs)})` : ''}`,
      ...(basis ? ['>', `> _${basisLine(lang, basis, codeSpan)}_`] : []), ''];
  });
}

/** The explanation as plain Markdown (no HTML), for pasting into reviews and docs. */
export function toPlainMarkdown(ex: LineExplanation, lineText: string, where: string, lang: Lang = 'en'): string {
  const out: string[] = [`**${where}**`, '', '```bash', lineText.trim(), '```', ''];
  const links = (refs: readonly string[] | undefined) => (refs?.length ? ` (${refsMarkdown(lang, refs)})` : '');
  out.push(...plainNotes(ex, ex.notes, lang));
  const walk = (tok: Token, depth: number) => {
    out.push(`${'  '.repeat(depth)}- ${labelMarkdown(labelParts(tok))} — ${explained(tok)}${links(tok.refs)}${valueMarkdown(tok.value, '  '.repeat(depth + 1))}${basisMarkdown(tok, lang, '  '.repeat(depth + 1))}`);
    for (const c of tok.children) walk(c, depth + 1);
  };
  for (const item of ex.items) walk(item, 0);
  out.push(...examplesMarkdown(ex.examples));
  return out.join('\n').trim() + '\n';
}

/**
 * The tree without levels below `maxDepth` (1: only the top level; 0: everything). Examples of
 * a removed token move to the deepest token still shown, since they are placed by source range.
 */
export function pruneDepth(items: Token[], maxDepth: number): Token[] {
  if (!maxDepth || maxDepth < 1) return items;
  const cut = (t: Token, depth: number): Token => ({ ...t, children: depth + 1 >= maxDepth ? [] : t.children.map((c) => cut(c, depth + 1)) });
  return items.map((t) => cut(t, 0));
}
