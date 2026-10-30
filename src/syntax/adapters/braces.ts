// The brace scanner of the unbash adapter: where bash finds a brace expansion in a word (manual 3.5.1), and the
// brace expressions the adapter makes of them. unbash marks the outermost candidates of a word (`BraceExpansion`)
// but not the ones inside them, and not which of them bash expands; this scan reads the word's text as bash's brace
// expansion does, with the quotes and expansions of the word (`opaque`) taken as text it does not look into.
// Checked with bash 5.2 (test/fixtures/probes/words.json, test/syntax-adapter-unbash.test.ts).

/** A range of the text. */
export interface Range { readonly pos: number; readonly end: number }

/** A brace expression of a word: a list (`{a,b}`, its top-level commas at `commas`) or a sequence (`{1..3}`). */
export interface BraceSpan extends Range {
  readonly kind: 'list' | 'sequence';
  readonly commas: readonly number[];
}

/** How many lists in one another the adapter makes (unbash nests up to 256 constructs). */
const MAX_DEPTH = 64;

/** How the adapter makes the nodes of a word with braces. */
export interface BraceBuilder<N> {
  readonly text: string;
  /** A named node, under `parent` when given. */
  node(type: string, start: number, end: number, parent?: N): N;
  /** A token at `start`, under `parent`. */
  tok(text: string, start: number, parent: N): N;
  add(parent: N, child: N): void;
  /** The node of a word made of `pieces`: the piece, or a concatenation. */
  joined(pos: number, end: number, pieces: N[]): N;
  /** The node of the quote or expansion that starts at `at`. */
  part(at: number): N;
  /** A run of plain text of the word, outside its brace expressions. */
  plain(start: number, end: number): N;
}

/**
 * The pieces from `from` to `to` of a word with braces: its brace expressions, and the runs of text and the parts
 * (`opaque`) between them. The parts in `nodes` are nodes, also inside braces bash does not expand (`$n` of
 * `{1..$n}`); those of a bracket or an extended glob stay in its text. A run in an item of a list (`depth` > 0) is a
 * word (`1` of `{1,2}`: the numbers of a brace expression are those of a sequence). Past `MAX_DEPTH` lists in one
 * another, the braces are text, so that the tree stays as deep as the readers can walk.
 */
export function bracePieces<N>(b: BraceBuilder<N>, from: number, to: number, opaque: ReadonlyMap<number, Range>, nodes: ReadonlySet<number>, depth = 0): N[] {
  const out: N[] = [];
  const own = (i: number): Range | undefined => (nodes.has(i) ? opaque.get(i) : undefined);
  const runs = (a: number, z: number): void => {
    for (let i = a, j = a; i < z; i = j) {
      const p = own(i);
      while (!p && j < z && !own(j)) j = opaque.get(j)?.end ?? j + 1;
      out.push(p ? b.part(i) : depth ? b.node('word', i, j) : b.plain(i, j));
      if (p) j = p.end;
    }
  };
  let at = from;
  for (let s = depth < MAX_DEPTH ? nextBrace(b.text, at, to, opaque) : undefined; s; s = nextBrace(b.text, at, to, opaque)) {
    runs(at, s.pos);
    out.push(s.kind === 'sequence' ? sequence(b, s) : list(b, s, opaque, nodes, depth + 1));
    at = s.end;
  }
  runs(at, to);
  return out;
}

/** A sequence `{1..10..3}`: its numbers (or letters) between `..` tokens. */
function sequence<N>(b: BraceBuilder<N>, s: BraceSpan): N {
  const n = b.node('brace_expression', s.pos, s.end);
  b.tok('{', s.pos, n);
  for (let start = s.pos + 1; start < s.end;) {
    const dots = b.text.indexOf('..', start);
    const end = dots >= 0 && dots < s.end ? dots : s.end - 1;
    b.node(/^[-+]?\d+$/.test(b.text.slice(start, end)) ? 'number' : 'word', start, end, n);
    b.tok(end === s.end - 1 ? '}' : '..', end, n);
    start = end + (end === s.end - 1 ? 1 : 2);
  }
  return n;
}

/** A list `{a,b}`: its items, each a word (with the braces inside it), between `,` tokens. */
function list<N>(b: BraceBuilder<N>, s: BraceSpan, opaque: ReadonlyMap<number, Range>, nodes: ReadonlySet<number>, depth: number): N {
  const n = b.node('brace_expression', s.pos, s.end);
  b.tok('{', s.pos, n);
  let start = s.pos + 1;
  for (const end of [...s.commas, s.end - 1]) {
    const item = bracePieces(b, start, end, opaque, nodes, depth);
    if (item.length) b.add(n, b.joined(start, end, item));
    b.tok(end < s.end - 1 ? ',' : '}', end, n);
    start = end + 1;
  }
  return n;
}

/** A sequence expression: two integers, or two letters, and an integer increment (bash takes a `+` sign too). */
const SEQUENCE = /^\{(?:[-+]?\d+\.\.[-+]?\d+|[A-Za-z]\.\.[A-Za-z])(?:\.\.[-+]?\d+)?\}$/;

/**
 * The first brace expression bash expands in `text` from `from` to `to`, outside the ranges of `opaque` (each starts
 * where the scan can reach it: quotes and expansions). As bash does, it takes the first `{` that is not quoted,
 * escaped nor after a `$` and has a matching `}`. The braces are a list when a `,` stands between them at their
 * level, a sequence when they hold one. Else the scan goes on after that `{` (`{{a,b}}` is `{a}` and `{b}`), but
 * past the `}` when they hold a `..` (`{x..{1..2}}` stays as it is), unless a comma is deeper inside: then bash
 * drops the braces, as of a list of one word (`{x..{a,b}}` is `x..a` and `x..b`).
 */
export function nextBrace(text: string, from: number, to: number, opaque: ReadonlyMap<number, Range>): BraceSpan | undefined {
  // (Whether the last character the scan read is a `$`, also the last of a part: see `$${`.)
  let dollar = false;
  for (let i = from; i < to; i++) {
    const skip = opaque.get(i)?.end;
    // (A `{` after a `$` starts a parameter expansion, which unbash makes a part: `${a,b}`.)
    if (skip !== undefined || text[i] === '\\') {
      dollar = skip !== undefined && text[skip - 1] === '$';
      i = skip === undefined ? i + 1 : skip - 1;
      continue;
    }
    // bash's scan reads characters, not parts: the `{` after the `$$` of `$${1..2}` starts a parameter expansion
    // to it, whose braces it skips with what they hold (`$${a{b,c}}` has none), up to the end when they stay open.
    if (dollar && text[i] === '{') {
      i = closing(text, i, to, opaque) - 1;
      dollar = false;
      continue;
    }
    dollar = text[i] === '$';
    // (Nor is a `{` at the start, or after a blank, that a `}` follows: `{},a}` stays as it is, as `find`'s `{}` does.)
    if (text[i] !== '{' || (text[i + 1] === '}' && (i === from || /\s/.test(text[i - 1])))) continue;
    const span = braceAt(text, i, to, opaque);
    if (typeof span === 'number') i = span - 1;
    else if (span) return span;
  }
  return undefined;
}

/** Where the braces that open at `open` end (past their `}`, the braces in them counted), or `to` when they are not closed. */
function closing(text: string, open: number, to: number, opaque: ReadonlyMap<number, Range>): number {
  let depth = 0;
  for (let j = open; j < to; j++) {
    const skip = opaque.get(j)?.end;
    if (skip !== undefined || text[j] === '\\') j = skip === undefined ? j + 1 : skip - 1;
    else if (text[j] === '{') depth++;
    else if (text[j] === '}' && --depth === 0) return j + 1;
  }
  return to;
}

/** The brace expression that starts at the `{` at `open`; else the end of braces that stay as they are, when the scan skips them. */
function braceAt(text: string, open: number, to: number, opaque: ReadonlyMap<number, Range>): BraceSpan | number | undefined {
  const commas: number[] = [];
  let depth = 0;
  let plain = true;
  let dots = false;
  let comma = false;
  for (let j = open; j < to; j++) {
    const skip = opaque.get(j)?.end;
    if (skip !== undefined) {
      plain = false;
      comma ||= text.slice(j, skip).includes(',');
      j = skip - 1;
      continue;
    }
    const c = text[j];
    if (c === '\\') {
      plain = false;
      j++;
    } else if (c === '{') depth++;
    else if (c === ',') {
      comma = true;
      if (depth === 1) commas.push(j);
    // (A `..` right before a `}` is no separator: `{..},}` is `..}` and nothing.)
    } else if (c === '.' && text[j + 1] === '.' && text[j + 2] !== '}' && depth === 1) dots = true;
    // (A `}` before the first `,` or `..` of the braces does not close them: `{a}b,c}` is `a}b` and `c`.)
    else if (c === '}' && depth === 1 && !commas.length && !dots) continue;
    else if (c === '}' && --depth === 0) {
      const end = j + 1;
      if (commas.length || (dots && comma)) return { pos: open, end, kind: 'list', commas };
      if (plain && SEQUENCE.test(text.slice(open, end))) return { pos: open, end, kind: 'sequence', commas };
      // (Here they hold a `..`: else the `}` would not have closed them.)
      return end;
    }
  }
  return undefined;
}
