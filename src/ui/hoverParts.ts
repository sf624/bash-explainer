// Which part of a line a hover explains (docs/design/hover.md): the part at the position, as an editor finds the word at
// the cursor. Pure code, shared by VS Code's hover and the Language Server's.
import type { Pos, Span, Token } from '../analyzer-types';
import type { HeredocAt } from '../document';

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
