// The line continuations that bash removes before it reads the text (manual 3.1.2.1: a backslash-newline "is treated
// as a line continuation (that is, it is removed from the input stream and effectively ignored)"): `$y\<newline>a`
// is `$ya`, `$\<newline>y` is `$y`, `~\<newline>/x` is `~/x`, `declare\<newline>x=1` assigns `declarex`, `&\<newline>&`
// is `&&` and `f\<newline>i` is `fi`. It keeps them in single quotes, in `$'…'`, in a comment (which ends at that
// newline) and in the body of a heredoc whose delimiter is quoted (3.6.6). unbash keeps them in a word and reads the
// word around them. The unbash adapter (./unbash.ts) has it read the text with them removed (`Joined.text`), and puts
// each node back where it is written (`Joined.span`), as it does with the CR of a CRLF. A node keeps its text as
// written, so a name may hold one (`variable_name` `y\<newline>a`). It works on the shape of unbash's AST only, since
// only ./unbash.ts may import unbash.

import { walk, type AstNode, type Children } from './rereads';

/** What becomes of a line continuation at a place, by the innermost node around it that decides. */
const enum Kind { Gap, Removed, Kept }

/** The nodes in which bash keeps a line continuation: quotes in which a backslash is itself (`'a\<newline>b'`, `$'a\<newline>b'`). */
const KEPT = new Set(['SingleQuoted', 'AnsiCQuoted']);
/** The nodes in which bash removes one: words, and the expression of `(( ))`, which has no comment. */
const REMOVED = new Set(['Word', 'Assignment', 'ArithmeticCommand']);
/** The nodes whose range holds all of their subtree: those of the other kinds end before their heredocs' bodies. */
const WHOLE = new Set([...REMOVED, ...KEPT, 'Script']);
/** The nodes in which a `#` starts no comment (`a#b`, `$#`, `'#'`, `(( $# ))`, a heredoc body). */
const HOLDS = new Set(['Word', 'ArithmeticCommand', 'HereDocBody', ...KEPT]);
const blank = (c: string | undefined): boolean => c === undefined || c === ' ' || c === '\t' || c === '\n';

/** The first index of `sorted` whose value is `x` or more. */
function lowerBound(sorted: readonly number[], x: number): number {
  let lo = 0;
  let hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (sorted[mid] < x) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/**
 * Where the backslashes are of the line continuations that bash removes in `text`, which unbash read as `script`, and
 * which change what unbash reads: those in a word or in `(( ))`, those in an unquoted heredoc body, and those between
 * tokens that they split (`&\<newline>&`, `f\<newline>i`), not in a comment. One between words (`a \<newline> b`), or
 * at the end of a word before a blank, unbash reads as a blank already, so the first reading stands when there are
 * only such ones. Only the words that hold a continuation are visited.
 */
export function continuations(script: AstNode, children: Children, text: string): number[] {
  const places: number[] = [];
  for (let i = text.indexOf('\\\n'); i >= 0; i = text.indexOf('\\\n', i + 1)) {
    // (Not a backslash that another one escapes: `\\` and a newline.)
    let k = i;
    while (k > 0 && text[k - 1] === '\\') k--;
    if ((i - k) % 2 === 0) places.push(i);
  }
  if (!places.length) return [];
  const kinds: Kind[] = places.map(() => Kind.Gap);
  // The innermost node that decides the place, when it is a word: its range.
  const words: (AstNode | undefined)[] = places.map(() => undefined);
  const mark = (from: number, to: number, kind: Kind, node?: AstNode): void => {
    for (let p = lowerBound(places, from); p < places.length && places[p] < to; p++) {
      kinds[p] = kind;
      words[p] = node;
    }
  };
  const visit = (n: AstNode): void => {
    // (The script of a backquote with escapes is read apart, at positions in the text without them: its word decides.)
    if (n.type === 'Script' && n !== script && n.source !== undefined) return;
    // (A word with no continuation in its range has nothing to say. A command's range ends before its heredocs' bodies.)
    if (WHOLE.has(n.type)) {
      const first = lowerBound(places, n.pos);
      if (first === places.length || places[first] >= n.end) return;
    }
    if (REMOVED.has(n.type)) {
      const value = (n as unknown as { value?: AstNode }).value;
      if (n.type === 'Assignment' && value?.type === 'ArrayValue') {
        // (An array's elements are words, with comments between them: `a=(1 # c \<newline> 2)`. Its head is part of a word.)
        mark(n.pos, value.pos + 1, Kind.Removed);
        mark(value.pos + 1, n.end, Kind.Gap);
      } else mark(n.pos, n.end, Kind.Removed, n.type === 'Word' ? n : undefined);
    } else if (KEPT.has(n.type)) mark(n.pos, n.end, Kind.Kept);
    else if (n.type === 'Script') mark(n.pos, n.end, Kind.Gap);
    else if (n.type === 'HereDoc') {
      const h = n as unknown as { delimiter?: { quoted: boolean }; body: AstNode };
      mark(h.body.pos, h.body.end, h.delimiter?.quoted ? Kind.Kept : Kind.Removed);
      return;
    } else if (n.type === 'ArithmeticFor') {
      // (Its head, up to the `))` after its last expression; the body is a list of commands.)
      const f = n as unknown as { initialize?: AstNode; test?: AstNode; update?: AstNode };
      const head = text.indexOf('))', f.update?.end ?? f.test?.end ?? f.initialize?.end ?? n.pos);
      // (With none, an error, it marks nothing.)
      mark(n.pos, head + 2, Kind.Removed);
    }
    children(n, visit);
  };
  visit(script);
  // The previous and next characters that bash reads around place `p`, past the continuations next to it.
  const before = (p: number): string | undefined => {
    let q = p;
    while (q > 0 && places[q - 1] === places[q] - 2) q--;
    return places[q] > 0 ? text[places[q] - 1] : undefined;
  };
  const after = (p: number): string | undefined => {
    let q = p;
    while (q + 1 < places.length && places[q + 1] === places[q] + 2) q++;
    return text[places[q] + 2];
  };
  return places.filter((i, p) => {
    if (kinds[p] === Kind.Kept) return false;
    if (kinds[p] === Kind.Removed) {
      // (At the end of a word, before a blank: `a\<newline> b`.)
      const w = words[p];
      return !(w && i + 2 === w.end && blank(after(p)));
    }
    // Between tokens: it matters only where it splits one, outside a comment.
    return !blank(before(p)) && !blank(after(p)) && !inComment(script, children, text, i);
  });
}

/**
 * Whether the backslash at `i`, outside any word, is in a comment: after a `#` on its line that no word holds (a
 * comment ends at the newline of a line continuation). Asked only of a continuation that splits a token, which is rare.
 * The words are looked for in the whole tree: a construct unbash could not read may have an empty range (`case $# in
 * 0) :;\<newline>; esac` before `;;` is joined).
 */
function inComment(script: AstNode, children: Children, text: string, i: number): boolean {
  const holds = (n: AstNode, h: number): boolean => {
    const here = n.pos <= h && h < n.end;
    if (HOLDS.has(n.type) && here) return true;
    if (WHOLE.has(n.type) && !here) return false;
    let found = false;
    children(n, (c) => {
      found ||= holds(c, h);
    });
    return found;
  };
  for (let h = text.lastIndexOf('\n', i - 1) + 1; h < i; h++) if (text[h] === '#' && !holds(script, h)) return true;
  return false;
}

/**
 * A command name `w` that unbash ends after a line continuation that follows it (`declare\<newline> x`), up to before it.
 * (One that splits the name is removed before unbash reads it. A plain word has no parts to keep; unbash computes the
 * parts of a word when they are read.)
 */
export function nameBefore<W extends AstNode & { readonly parts?: unknown }>(w: W, text: string): W {
  let end = w.end;
  if (!w.parts) while (text.slice(end - 2, end) === '\\\n') end -= 2;
  return end === w.end ? w : { ...w, end };
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
  const pieces: string[] = [];
  let from = 0;
  for (const p of places) {
    pieces.push(written.slice(from, p));
    for (let i = from; i < p; i++) origin.push(i);
    from = p + 2;
  }
  pieces.push(written.slice(from));
  for (let i = from; i < written.length; i++) origin.push(i);
  origin.push(written.length);
  return {
    text: pieces.join(''),
    span: ({ startIndex: a, endIndex: z }) => ({ startIndex: origin[a], endIndex: z > a ? origin[z - 1] + 1 : origin[a] }),
    inText: (i, to) => {
      const p = lowerBound(places, i);
      if (p < places.length && places[p] < to) return undefined;
      // (The offsets in `origin` grow: the first one at `i` or past it.)
      return lowerBound(origin, i);
    },
  };
}

/** The text that unbash reads for a script, where its characters are written, and unbash's reading of it when that is the first one. */
export interface Prepared<S extends AstNode> {
  readonly masked: string;
  readonly carriageReturns: number[];
  readonly joins?: Joined;
  /** unbash's reading of `masked`, when no line continuation is removed. */
  readonly script?: S;
}

/**
 * The text that unbash reads for `text`, and where its characters are written. bash would read the CR of a CRLF as
 * part of the last word of the line (`fi\r` is no `fi`). That is not what the author meant, and the document issues
 * say so: the tree is built as if each CR were a blank (`masked`, of the same length; the CRs at `carriageReturns`),
 * but for those that end a heredoc where bash does (`heredocCarriageReturns`). And bash removes the line continuations
 * that ./continuations.ts finds (`joins`, when there are some), which unbash reads as they are. When there are none,
 * unbash's reading of `masked` is given back (`script`), to be used as is.
 */
export function prepared<S extends AstNode>(text: string, parse: (text: string) => S, children: Children): Prepared<S> {
  const carriageReturns = [...text.matchAll(/\r(?=\n)/g)].map((m) => m.index!);
  let masked = carriageReturns.length ? text.replace(/\r(?=\n)/g, ' ') : text;
  let script: S | undefined;
  if (carriageReturns.length && masked.includes('<<')) ({ masked, script } = heredocCarriageReturns(text, masked, parse, children));
  if (!masked.includes('\\\n')) return script ? { masked, carriageReturns, script } : { masked, carriageReturns };
  script ??= parse(masked);
  const places = continuations(script, children, masked);
  return places.length ? { masked, carriageReturns, joins: joined(masked, places) } : { masked, carriageReturns, script };
}

/** A heredoc redirection of unbash's AST, as far as this module reads it. */
interface HereDoc extends AstNode {
  readonly operator: string;
  readonly delimiter: { readonly end: number; readonly value: string };
  readonly body: { readonly pos: number };
}

/**
 * `masked` with the CRs of `text` kept where bash reads them in a heredoc's delimiter (3.6.6). The CR right after the
 * delimiter is part of the word (`<<E\r`, `<<'E'\r`: the delimiter is `E\r`), and bash ends the body at the first
 * line that is `E\r` (after its leading tabs with `<<-`); a line `E` does not end it. Masked, the delimiter would be
 * `E` and that line `E `, which unbash does not take for the end either: so both CRs stay, and unbash reads them as
 * bash does. (The tree leaves them out of the words: the adapter's `seal`.) Each heredoc that is fixed so may hold or
 * move the ones after it, so they are found one at a time, the first one in the text first, in unbash's new reading.
 */
function heredocCarriageReturns<S extends AstNode>(text: string, masked: string, parse: (text: string) => S, children: Children): { masked: string; script: S } {
  for (;;) {
    const script = parse(masked);
    // (A CR that unbash reads is in the delimiter, so one right after it is masked. The walk goes in the order of
    // the text, and a heredoc in a body that runs on comes after the one whose body it is.)
    let first: HereDoc | undefined;
    walk(script, children, (n) => {
      if (!first && n.type === 'HereDoc' && text[(n as HereDoc).delimiter.end] === '\r') first = n as HereDoc;
    });
    if (!first) return { masked, script };
    const kept = [first.delimiter.end];
    const want = first.delimiter.value + '\r';
    for (let p = first.body.pos, nl = text.indexOf('\n', p); nl >= 0; p = nl + 1, nl = text.indexOf('\n', p)) {
      const line = text.slice(p, nl);
      if ((first.operator === '<<-' ? line.replace(/^\t+/, '') : line) !== want) continue;
      kept.push(nl - 1);
      break;
    }
    for (const i of kept) masked = masked.slice(0, i) + '\r' + masked.slice(i + 1);
  }
}
