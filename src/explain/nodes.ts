// The helpers on syntax nodes, tokens and positions that the explanation of every part uses (docs/design/analyzer.md,
// 2.3): which nodes a line explains, how a token is labelled and ordered, where an offset is, and where a token of an
// embedded explainer is in the source.
import type { Pos, Span, Token, TokenOrigin } from '../analyzer-types';
import type { EmbeddedToken } from '../embedded/types';
import { labelText, shorten, skeleton } from '../label';
import { type Literal, sourceIndex } from '../staticword';
import { descendants } from '../syntax/tree';
import type { NodeType, SyntaxNode } from '../syntax/tree';

/** A set of node types, checked against the model's: a name that is not a NodeType does not compile. */
const types = (...names: NodeType[]): ReadonlySet<string> => new Set<string>(names);
/** Constructs that own a body; when they span lines, each line explains only its own part. */
const BLOCKS = types(
  'for_statement', 'c_style_for_statement', 'while_statement', 'if_statement', 'elif_clause',
  'else_clause', 'case_statement', 'case_item', 'function_definition', 'compound_statement',
  'subshell', 'do_group', 'error', 'arithmetic_command', 'select_statement',
);
/** Nodes that just combine statements; they count as blocks only when they contain one. */
const WRAPPERS = types('list', 'pipeline', 'redirected_statement', 'negated_command', 'program', 'time_statement');

export const effEndRow = (n: SyntaxNode) =>
  n.endPosition.column === 0 && n.endPosition.row > n.startPosition.row ? n.endPosition.row - 1 : n.endPosition.row;
const isMultiline = (n: SyntaxNode) => effEndRow(n) > n.startPosition.row;
export const intersects = (n: SyntaxNode, line: number) => n.startPosition.row <= line && effEndRow(n) >= line;

/** Whether each line of the node explains only its own part (a block over several lines); otherwise `sub` explains it whole. */
export function isBlockLike(n: SyntaxNode): boolean {
  if (BLOCKS.has(n.type)) return isMultiline(n);
  if (WRAPPERS.has(n.type)) return n.namedChildren.some(isBlockLike);
  return false;
}

export const same = (a: SyntaxNode | null | undefined, b: SyntaxNode | null | undefined) => !!a && a === b;
/** The nodes of these types under `n` that overlap `line`; one that ends where the line starts does not. */
export const onLine = (n: SyntaxNode, types: string[], line: number): SyntaxNode[] =>
  descendants(n, types, { from: line, to: line }).filter((m) => m.endPosition.row > line || m.endPosition.column > 0);
/** The sibling `by` places away (-1: the one before), or undefined. */
export const sibling = (n: SyntaxNode, by: number): SyntaxNode | undefined => {
  const kids = n.parent!.children;
  return kids[kids.indexOf(n) + by];
};
export const has = (list: readonly SyntaxNode[], n: SyntaxNode) => list.some((x) => x === n);

/** Gives `t` the skeleton of `n` as its label; with `onlyIfCut`, only when it has a placeholder (else the label is the text). */
export function skeletal(t: Token, n: SyntaxNode, onlyIfCut = false): Token {
  const parts = skeleton(n);
  if (onlyIfCut && !parts.some((p) => p.placeholder)) return t;
  t.labelParts = parts;
  t.label = labelText(parts);
  return t;
}

export function summaryOf(t: Token): string {
  return t.summary ?? t.explanation;
}

export function sortTokens(ts: Token[]): Token[] {
  return ts.sort((a, b) => a.span.start.line - b.span.start.line || a.span.start.character - b.span.start.character);
}

/** Whether an ancestor of `n` satisfies `test`. */
export function ancestorOf(n: SyntaxNode, test: (a: SyntaxNode) => boolean): boolean {
  for (let a = n.parent; a; a = a.parent) if (test(a)) return true;
  return false;
}

/** The offset of the start of each line of `text` (kept for the last few texts). */
const lineStartCache = new Map<string, number[]>();
export function lineStarts(text: string): number[] {
  let starts = lineStartCache.get(text);
  if (!starts) {
    starts = [0];
    for (let i = text.indexOf('\n'); i >= 0; i = text.indexOf('\n', i + 1)) starts.push(i + 1);
    if (lineStartCache.size > 16) lineStartCache.clear();
    lineStartCache.set(text, starts);
  }
  return starts;
}

/** The position of offset `i`, given the starts of the lines. */
export function posOf(starts: number[], i: number): Pos {
  let lo = 0;
  let hi = starts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (starts[mid] <= i) lo = mid;
    else hi = mid - 1;
  }
  return { line: lo, character: i - starts[lo] };
}

export const sameSpan = (a: Span, b: Span): boolean => a.start.line === b.start.line && a.start.character === b.start.character && a.end.line === b.end.line && a.end.character === b.end.character;

/** A token of an embedded explainer, placed in the source; `origin`: who reads it (`shell`: bash's own globs and escapes). */
export function fromEmbedded(t: EmbeddedToken, node: SyntaxNode, lit: Literal, origin: TokenOrigin): Token {
  const text = node.text;
  const at = (offset: number, isEnd = false): Pos => {
    const idx = sourceIndex(lit, offset, isEnd);
    const before = text.slice(0, idx);
    const nl = before.lastIndexOf('\n');
    const rows = before.split('\n').length - 1;
    return rows === 0
      ? { line: node.startPosition.row, character: node.startPosition.column + idx }
      : { line: node.startPosition.row + rows, character: idx - nl - 1 };
  };
  const label = t.label ?? text.slice(sourceIndex(lit, t.start, false), sourceIndex(lit, t.end, true));
  return {
    kind: t.kind, label: shorten(label), explanation: t.explanation,
    span: { start: at(t.start), end: at(t.end, true) },
    children: t.children.map((c) => fromEmbedded(c, node, lit, origin)),
    origin,
    ...(t.group ? { group: t.group } : {}),
  };
}
