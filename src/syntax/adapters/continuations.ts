// The line continuations that bash removes inside a word before it reads the word (manual 3.1.2.1: a backslash-newline
// "is treated as a line continuation (that is, it is removed from the input stream and effectively ignored)"):
// `$y\<newline>a` is `$ya`, `$\<newline>y` is `$y`, `~\<newline>/x` is `~/x`, and `declare\<newline>x=1` assigns
// `declarex`. unbash keeps them in the word and reads the word around them. The unbash adapter (./unbash.ts) has it
// read the text with them removed (`Joined.text`), and puts each node back where it is written (`Joined.span`), as
// it does with the CR of a CRLF. A node keeps its text as written, so a name may hold one
// (`variable_name` `y\<newline>a`). It works on the shape of unbash's AST only, since only ./unbash.ts may import unbash.

import type { AstNode, Children } from './rereads';

/**
 * The nodes in which a line continuation stays: quotes in which a backslash is itself (`'a\<newline>b'`,
 * `$'a\<newline>b'`), and the script of a substitution outside its words, where a comment ends at its newline.
 */
const KEEPS = new Set(['SingleQuoted', 'AnsiCQuoted', 'Script']);

/**
 * Where the backslashes are of the line continuations that bash removes in `text`, which unbash read as `script`:
 * those in a word (or an assignment) and not in a part of it that keeps them (the innermost decides). Those
 * between words unbash reads as blanks already; those in a here-document's body are not in a word.
 */
export function continuations(script: AstNode, children: Children, text: string): number[] {
  const places: number[] = [];
  for (let i = text.indexOf('\\\n'); i >= 0; i = text.indexOf('\\\n', i + 1)) {
    // (Not a backslash that another one escapes: `\\` and a newline.)
    let k = i;
    while (k > 0 && text[k - 1] === '\\') k--;
    if ((i - k) % 2 === 0) places.push(i);
  }
  const removes = new Map<number, boolean>();
  const visit = (n: AstNode): void => {
    const kind = n.type === 'Word' || n.type === 'Assignment' ? true : KEEPS.has(n.type) ? false : undefined;
    if (kind !== undefined) for (const i of places) if (i >= n.pos && i < n.end) removes.set(i, kind);
    children(n, visit);
  };
  visit(script);
  return places.filter((i) => removes.get(i));
}

/** A text with some line continuations removed, and where each of its characters is written. */
export interface Joined {
  readonly text: string;
  /** Where a range of `text` is written: from its first character to right after its last one. */
  span(r: { startIndex: number; endIndex: number }): { startIndex: number; endIndex: number };
  /** Where the written offset `i` is in `text`, when no continuation was removed in the written range from `i` to `to`. */
  inText(i: number, to: number): number | undefined;
}

/** `written` with the line continuations whose backslashes are at `places` (in order) removed. */
export function joined(written: string, places: readonly number[]): Joined {
  const origin: number[] = [];
  let text = '';
  for (let i = 0, p = 0; i < written.length; i++) {
    if (places[p] === i) {
      p++;
      i++;
      continue;
    }
    origin.push(i);
    text += written[i];
  }
  origin.push(written.length);
  return {
    text,
    span: ({ startIndex: a, endIndex: z }) => ({ startIndex: origin[a], endIndex: z > a ? origin[z - 1] + 1 : origin[a] }),
    inText: (i, to) => {
      if (places.some((x) => x >= i && x < to)) return undefined;
      // (The offsets in `origin` grow: the first one at `i` or past it.)
      let lo = 0;
      let hi = origin.length - 1;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (origin[mid] < i) lo = mid + 1;
        else hi = mid;
      }
      return lo;
    },
  };
}

/**
 * The text that unbash reads for `text`, and where its characters are written. bash would read the CR of a CRLF as
 * part of the last word of the line (`fi\r` is no `fi`). That is not what the author meant, and the document issues
 * say so: the tree is built as if each CR were a blank (`masked`, of the same length; the CRs at `carriageReturns`).
 * And bash removes the line continuations in words (`joins`, when there are some), which unbash reads as they are.
 */
export function prepared(text: string, parse: (text: string) => AstNode, children: Children): { masked: string; carriageReturns: number[]; joins?: Joined } {
  const carriageReturns = [...text.matchAll(/\r(?=\n)/g)].map((m) => m.index!);
  const masked = text.replace(/\r(?=\n)/g, ' ');
  const places = masked.includes('\\\n') ? continuations(parse(masked), children, masked) : [];
  return { masked, carriageReturns, ...(places.length ? { joins: joined(masked, places) } : {}) };
}
