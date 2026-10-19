// The token scanner of the unbash adapter. unbash gives no position for comments, keywords and
// operators (`then`, `fi`, `&&`, `;`…): they lie in the text between the children it does position.
// `scanGap` reads such a stretch of text and gives them back, with their ranges. It skips what is not
// a token of the stretch: quotes, `$( )`, `${ }`, backquotes, line continuations and heredoc bodies.

export interface Piece {
  /** `token`: a keyword or an operator, with its own text; `comment`: `# …` up to the end of the line; `word`: any other word, which only a scan with `words` gives. */
  readonly kind: 'token' | 'comment' | 'word';
  readonly text: string;
  readonly start: number;
  readonly end: number;
}

/** The words that are keywords where a command may start or a list ends. */
export const KEYWORDS: ReadonlySet<string> = new Set([
  'if', 'then', 'elif', 'else', 'fi', 'for', 'select', 'while', 'until', 'do', 'done', 'case', 'esac', 'in',
  'function', 'time', 'coproc', '{', '}', '!', '[[', ']]',
]);

/** Operators, the longest first so that `;;&` is not read as `;;` and `&`. */
const OPERATORS = [
  ';;&', '<<<', '<<-', '&>>', '|&', ';;', ';&', '&&', '||', '<<', '<&', '<>', '>>', '>&', '>|', '&>',
  ';', '&', '|', '(', ')', '<', '>',
];
const OPERATOR_CHARS = new Set([';', '&', '|', '(', ')', '<', '>']);
const isBlank = (c: string): boolean => c === ' ' || c === '\t' || c === '\n' || c === '\r';

/** The index after the quoted or bracketed text that starts at `i` (a quote, `${`, `$(` or backquote), or `to` if it is not closed. */
function skipGroup(text: string, i: number, to: number): number {
  const c = text[i];
  if (c === "'") {
    const q = text.indexOf("'", i + 1);
    return q < 0 || q >= to ? to : q + 1;
  }
  if (c === '"' || c === '`') {
    for (let k = i + 1; k < to; k++) {
      if (text[k] === '\\') k++;
      else if (text[k] === c) return k + 1;
      else if (c === '"' && text[k] === '$' && (text[k + 1] === '(' || text[k + 1] === '{')) k = skipGroup(text, k + 1, to) - 1;
    }
    return to;
  }
  // `(` or `{` after a `$`, with their match, the quotes inside skipped.
  const open = c;
  const close = open === '(' ? ')' : '}';
  let depth = 0;
  for (let k = i; k < to; k++) {
    const d = text[k];
    if (d === '\\') k++;
    else if (d === "'" || d === '"' || d === '`') k = skipGroup(text, k, to) - 1;
    else if (d === open) depth++;
    else if (d === close && --depth === 0) return k + 1;
  }
  return to;
}

/**
 * The comments, keywords and operators in `text[from, to)`, in order. `skip` lists ranges to jump over,
 * such as heredoc bodies, which lie in the text between two statements but are not code. With `stop`,
 * the scan ends after the first piece it accepts. With `words`, the words that are not keywords come too
 * (in a stretch between the children of a node there should be none: it is text the parser dropped).
 */
export function scanGap(
  text: string, from: number, to: number, skip: readonly (readonly [number, number])[] = [], stop?: (piece: Piece) => boolean, words = false,
): Piece[] {
  const out: Piece[] = [];
  let i = from;
  while (i < to && !(stop && out.length && stop(out[out.length - 1]))) {
    const jump = skip.find(([a, b]) => i >= a && i < b);
    if (jump) { i = jump[1]; continue; }
    const c = text[i];
    if (isBlank(c)) { i++; continue; }
    if (c === '\\' && text[i + 1] === '\n') { i += 2; continue; }
    if (c === '\\' && text[i + 1] === '\r' && text[i + 2] === '\n') { i += 3; continue; }
    if (c === '#') {
      let end = text.indexOf('\n', i);
      if (end < 0 || end > to) end = to;
      out.push({ kind: 'comment', text: text.slice(i, end), start: i, end });
      i = end;
      continue;
    }
    if (OPERATOR_CHARS.has(c)) {
      const op = OPERATORS.find((o) => text.startsWith(o, i) && i + o.length <= to)!;
      out.push({ kind: 'token', text: op, start: i, end: i + op.length });
      i += op.length;
      continue;
    }
    // A word: up to a blank or an operator, quotes and expansions in it whole.
    const start = i;
    let word = '';
    while (i < to) {
      const d = text[i];
      if (isBlank(d) || OPERATOR_CHARS.has(d)) break;
      if (d === '\\') {
        // A line continuation inside a word joins its two sides.
        if (text[i + 1] === '\n') { i += 2; continue; }
        word += text.slice(i, i + 2);
        i += 2;
      } else if (d === "'" || d === '"' || d === '`' || (d === '$' && (text[i + 1] === '(' || text[i + 1] === '{'))) {
        const end = skipGroup(text, d === '$' ? i + 1 : i, to);
        word += text.slice(i, end);
        i = end;
      } else { word += d; i++; }
    }
    // `i` may have gone past `to` over an escape at its end.
    i = Math.min(i, to);
    if (KEYWORDS.has(word)) out.push({ kind: 'token', text: word, start, end: i });
    else if (words) out.push({ kind: 'word', text: text.slice(start, i), start, end: i });
  }
  return out;
}
