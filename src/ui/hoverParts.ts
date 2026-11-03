// Which part of a line a hover explains (docs/design/hover.md): the part at the position, as an editor finds the word at
// the cursor. Pure code, shared by VS Code's hover and the Language Server's.
import type { LineExplanation, Pos, Span, Token, ValueInfo } from '../analyzer-types';
import type { HeredocAt } from '../document';
import { spanWithin } from '../noteanchors';

const samePos = (a: Pos, b: Pos) => a.line === b.line && a.character === b.character;
export const sameSpan = (a: Span, b: Span): boolean => samePos(a.start, b.start) && samePos(a.end, b.end);

/** Whether the token covers the position (its end is exclusive). */
export function covers(t: Token, p: Pos): boolean {
  const { start, end } = t.span;
  const afterStart = p.line > start.line || (p.line === start.line && p.character >= start.character);
  const beforeEnd = p.line < end.line || (p.line === end.line && p.character < end.character);
  return afterStart && beforeEnd;
}

/**
 * The parts of a token as a reader sees them: a child with the same range as its parent (a quoted word that is the
 * whole argument) only says the parent again, so its own parts take its place.
 */
export function shown(tok: Token): Token[] {
  return tok.children.flatMap((c) => (sameSpan(c.span, tok.span) ? shown(c) : [c]));
}

/**
 * The value of the expansion a part is (`Token.value`), also when the part is a word made of it alone (`$msg` as an
 * argument): the token of the same range that `shown` leaves out holds it.
 */
export function valueOf(tok: Token): ValueInfo | undefined {
  const same = tok.children.find((c) => sameSpan(c.span, tok.span));
  return tok.value ?? (same && valueOf(same));
}

/** A command a reader thinks of as one unit: a command name of bash (it has name facts), or a command outside an embedded language. */
export const isCommand = (t: Token): boolean => !!t.name || (['command', 'builtin', 'function', 'alias'].includes(t.kind) && t.origin !== 'embedded');

/** The tokens that cover the position, outermost first. */
export function chainAt(items: Token[], at: Pos): Token[] {
  const chain: Token[] = [];
  for (let level = items, t = level.find((c) => covers(c, at)); t; level = shown(t), t = level.find((c) => covers(c, at))) chain.push(t);
  return chain;
}

const isHeredoc = (t: Token) => t.kind === 'redirect' && /^\d*<<(?!<)/.test(t.label);

/** The chain down to the here-document operator `h` (the tree's), or undefined when the explanation has no such token. */
function heredocChain(items: Token[], h: HeredocAt): Token[] | undefined {
  const found: Token[][] = [];
  const visit = (t: Token, path: Token[]) => {
    const here = [...path, t];
    if (isHeredoc(t) && t.span.start.line === h.line) found.push(here);
    shown(t).forEach((c) => visit(c, here));
  };
  items.forEach((t) => visit(t, []));
  return found.sort((a, b) => a[a.length - 1].span.start.character - b[b.length - 1].span.start.character)[h.index];
}

/**
 * The part a hover at `at` explains, as the chain of parts around it (outermost first; empty: no part). The innermost
 * part that covers the position, or one that ends exactly there (the cursor just after a word, as an editor finds the
 * word at the cursor). On a line of a here-document's body or its closing delimiter (`heredoc`, from the syntax tree),
 * the operator `<<EOF` that starts it, or a part of the body (`$USER`).
 */
export function partAt(items: Token[], at: Pos, heredoc?: HeredocAt): Token[] {
  const doc = heredoc && heredocChain(items, heredoc);
  let chain = doc ? [...doc, ...chainAt(shown(doc[doc.length - 1]), at)] : chainAt(items, at);
  if (at.character > 0) {
    const before = { line: at.line, character: at.character - 1 };
    const level = chain.length ? shown(chain[chain.length - 1]) : items;
    const ending = level.find((t) => samePos(t.span.end, at) && covers(t, before));
    if (ending) chain = [...chain, ending, ...chainAt(shown(ending), before)];
  }
  return chain;
}

/** The part's range on line `line` of `length` characters: a part over several lines is cut to the line; one on another line (`<<EOF` for its body) is the whole line. */
export function rangeOnLine(span: Span, line: number, length: number): Span {
  if (span.end.line < line || span.start.line > line) return { start: { line, character: 0 }, end: { line, character: length } };
  return {
    start: span.start.line < line ? { line, character: 0 } : span.start,
    end: span.end.line > line ? { line, character: length } : span.end,
  };
}


/**
 * Whether a note found on the range `at` is about the part (docs/design/hover.md, "Notes"): the range lies within the
 * part or one of its own parts (the arguments of a command), or it is larger and the part starts it (the command name
 * of a command, the first command of a pipeline). So a note on a whole command shows on its name, not on each argument.
 */
export function isAbout(at: Span, part: Token): boolean {
  if (samePos(at.start, part.span.start) && spanWithin(part.span, at)) return true;
  const all = (t: Token): Token[] => [t, ...t.children.flatMap(all)];
  return all(part).some((t) => spanWithin(at, t.span));
}

/** A problem the editor shows in the same hover, above the part (VS Code's diagnostics at the position): its code and range. */
export interface ProblemAt { code: string; span: Span }

const before = (a: Pos, b: Pos) => a.line < b.line || (a.line === b.line && a.character < b.character);
const overlap = (a: Span, b: Span) => before(a.start, b.end) && before(b.start, a.end);

/** Whether a note is one of the problems the hover shows already: one of its ranges is that problem's (the same code, overlapping). */
const shownAsProblem = (ex: LineExplanation, note: string, problems: readonly ProblemAt[]) =>
  problems.some((p) => ex.anchors?.some((a) => a.text === note && a.code === p.code && overlap(a.span, p.span)));

/**
 * The notes of a line that a part's hover shows (`isAbout` one of their ranges, `LineExplanation.anchors`), and the
 * others: those about other parts, and those with no range (about the line), which only the whole line shows. A note
 * the hover shows above as a problem (`problems`) is in neither, so that it is not said twice.
 */
export function partNotes(ex: LineExplanation, part: Token, problems: readonly ProblemAt[] = []): { about: string[]; others: string[] } {
  const notes = ex.notes.filter((n) => !shownAsProblem(ex, n, problems));
  const about = notes.filter((n) => ex.anchors?.some((a) => a.text === n && isAbout(a.span, part)));
  return { about, others: notes.filter((n) => !about.includes(n)) };
}

/** The run of blanks around a position on no part (the indentation, between statements), so that moving onto a part asks again. */
export function blankRange(text: string, at: Pos): Span {
  // (A character that no part covers, not a blank: itself.)
  if (at.character < text.length && /\S/.test(text[at.character])) return { start: at, end: { line: at.line, character: at.character + 1 } };
  let a = Math.min(at.character, text.length);
  let b = a;
  while (a > 0 && /\s/.test(text[a - 1])) a--;
  while (b < text.length && /\s/.test(text[b])) b++;
  return { start: { line: at.line, character: a }, end: { line: at.line, character: b } };
}
