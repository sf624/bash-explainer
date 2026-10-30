// The fields a word may give where some of its parts are not known (docs/design/trust-fields.md, 2.2 and 2.3): the
// domain F of that page. A part is known (a text, or unset) or a hole of a kind; the word model (src/semantics/words.ts)
// gives the pieces of each word of the brace expansion, and this file splits them and expands them as pathnames as
// bash does (manual 3.5.7, 3.5.8), with the holes kept abstract: a field is described by its known literal start and
// end, and a word by the count of its fields. Nothing here asks where a value comes from (V) or what a builtin does
// with the fields (E). test/fieldshape.test.ts checks it against bash on generated words.
import { isGlob } from '../examples/shellwords';
import { parseExpansion } from '../expansion';
import { decodedText } from '../staticword';
import { descendants, type SyntaxNode } from '../syntax/tree';
import { sameInEveryLocale } from './chars';
import { severalFields } from './globwords';
import { attribute, option } from './shellstate';
import type { StateModel } from './state';
import { changedByBash } from './vars';
import { holedWords, patternOfChars, type Piece, splitOn, type ValueSource, wordMeaning, type WordMeaning } from './words';

/**
 * What a hole may give: `text`, any text; `digits`, digits (`$#`, `$?`, `$$`, `${#x}`; `$!`, also nothing before any
 * `&`); `integer`, digits after an optional `-` (`$(( ))`); `elements`, no field or any number of fields of any text
 * (`"$@"`, `"${a[@]}"`, `$*` unquoted).
 */
export type HoleKind = 'text' | 'digits' | 'integer' | 'elements';

/** A part of a word whose value is not known: its kind, whether it is in double quotes, and whether it may be empty. */
export interface Hole { kind: HoleKind; quoted: boolean; empty: boolean }

/**
 * A field. Where `text` is undefined, it is any text that starts with `start`, ends with `end` and is at least as long
 * as both together. `head`: the hole it starts with, where `start` is empty; when that hole is never empty, its kind
 * bounds the first character (a digit, or `-` for `integer`). `tail` likewise for the last character. `pattern`, only
 * before pathname expansion (`wordShapes(…, { glob: false })`): the field as a glob pattern (quoted characters escaped),
 * where it is one and its text is known; `true` where it may be one.
 */
export interface Field { text?: string; start: string; end: string; head?: Hole; tail?: Hole; pattern?: string | true }

/**
 * The fields of one word of a brace expansion: an exact count, each field described; or a count from `min` (to `max`,
 * none: no bound), where the first field is `first`, the last `last` (one field: both), and every field between `middle`.
 */
export type Shape = { fields: Field[] } | { min: number; max?: number; first: Field; middle: Field; last: Field };

/**
 * What a word may give: one list of shapes (one shape per word of its brace expansion, in order) for each case that is
 * not known (braces on or off, each tuple of the values enumerated); `mayFail`: bash may fail on it (`set -u`,
 * `${x:?}`, failglob), and then no field reaches the command.
 */
export interface WordShapes { cases: Shape[][]; mayFail: boolean }

/** The values a parameter may have where the word expands (a text, or null: unset); a parameter not listed is a hole. */
export type Values = ReadonlyMap<string, readonly (string | null)[]>;

/** At most this many tuples of values (and `${x:+w}` readings) are read for one word; past it, the parameters left are holes (trust-fields.md, 6). */
export const TUPLES = 16;

interface Ch { c: string; quoted: boolean; sep?: 'white' | 'hard' }
interface Ho { hole: Hole; splits?: boolean }
/** A character of a field (`c` empty: a quoted empty string, which makes a field), or a hole. */
type Atom = Ch | Ho;
/** A run of fields that each fit `atoms`: from `min` to `max` (none: no bound). */
interface Item { atoms: Atom[]; min: number; max?: number }

const ANY: Ho = { hole: { kind: 'text', quoted: false, empty: true } };
const isHole = (a: Atom): a is Ho => 'hole' in a;
const WHITE = ' \t\n';

/**
 * Holes in double quotes with `"$@"` (or another part that gives elements): empty, they give no field, as `"$@"` gives
 * none with no element (`"$@$x"` with `x` empty). A tilde prefix with a glob character (`~*`): no user has that name,
 * so it stays as written and is globbed, but not split.
 */
const unkept = new WeakSet<Hole>();
const unsplit = new WeakSet<Hole>();
/** Holes of a `${…}` whose word has quotes (`${x+"$y"}`): not quoted, they may still give an empty field, the quoted null. */
const nulls = new WeakSet<Hole>();

/** The hole that stands for `part` (a string: a tilde prefix not known). */
function holeOf(part: SyntaxNode | string, quoted: boolean, w: WordMeaning): Hole {
  if (typeof part === 'string') {
    if (!/[*?[]/.test(part)) return { kind: 'text', quoted: true, empty: true };
    const h: Hole = { kind: 'text', quoted: false, empty: false };
    unsplit.add(h);
    return h;
  }
  const h: Hole = { ...kindOf(part, quoted, w), quoted: quoted || part.type === 'process_substitution' };
  if (quoted && part.parent!.type === 'string' && part.parent!.namedChildren.some((c) => severalFields(c, w.state, true))) unkept.add(h);
  if (part.type === 'expansion' && /['"]/.test(part.text)) nulls.add(h);
  return h;
}

/** The kind of the hole of `part`, and whether it may be empty. */
function kindOf(part: SyntaxNode, quoted: boolean, w: WordMeaning): Pick<Hole, 'kind' | 'empty'> {
  if (part.type === 'simple_expansion' || part.type === 'expansion') {
    const p = parseExpansion(part.type === 'simple_expansion' ? `\${${part.text.slice(1)}}` : decodedText(part));
    // (`$#`, `$?`, `$$` and a length are digits, also behind an operator that keeps a value that is set; `$!` may be
    // empty. Any other operator over them gives text: `${#:+-v}`, `${#/#/-}`; `${##1}` with one element is empty.)
    if (p?.prefix === '#' && !p.op) return { kind: 'digits', empty: false };
    if (p && !p.prefix && p.subscript === undefined) {
      if (/^[#?$]$/.test(p.name) && [undefined, '-', ':-', '=', ':=', '?', ':?'].includes(p.op)) return { kind: 'digits', empty: false };
      if (p.name === '!' && !p.op) return { kind: 'digits', empty: true };
    }
    if (severalFields(part, w.state, quoted)) return { kind: 'elements', empty: true };
  }
  if (part.type === 'arithmetic_expansion') return { kind: 'integer', empty: false };
  return { kind: 'text', empty: part.type !== 'process_substitution' };
}

/** The values the evaluator reads: those of one tuple, and a reading of each `${x:+w}` over a hole (by its node: the name it reads, and the value). */
class TupleValues implements ValueSource {
  constructor(private readonly given: ReadonlyMap<string, string | null>, private readonly chosen: ReadonlyMap<SyntaxNode, readonly [string, string | null]>) {}
  variable(name: string, node: SyntaxNode): string | null | undefined {
    const c = this.chosen.get(node);
    return c?.[0] === name ? c[1] : this.given.get(name);
  }
  tilde = (): undefined => undefined;
  /** (Arithmetic is a hole: after `"$@"`, even `$((1))` is split.) */
  arith = (): undefined => undefined;
  /** (No command is taken to print nothing: a `$( )` is a hole.) */
  builtinRuns = (): boolean => false;
}

/**
 * Whether the variable `name` takes the values given where `w` expands: not a special or positional parameter (a hole;
 * `"$@"` gives elements), not one bash sets itself (`RANDOM`, `LINENO`, `_`), and not an array, a nameref (`r` of
 * `declare -n r='a[@]'` gives elements) or one whose attributes change what is stored (`-i`, `-l`, `-u`), also on some
 * paths, or after a `source` the walk does not read.
 */
function valued(name: string, w: WordMeaning): boolean {
  return /^[A-Za-z_]\w*$/.test(name) && name !== '_' && !changedByBash(name) && !w.state.opaque && ['a', 'A', 'n', 'i', 'l', 'u'].every((l) => attribute(w.state, name, l) === 'off');
}

/** The expansions of a word, each with what `parseExpansion` reads of it (a name alone for `$x`). */
const expansionsOf = (w: WordMeaning): (readonly [SyntaxNode, { name: string } | ReturnType<typeof parseExpansion>])[] =>
  w.nodes.flatMap((n) => descendants(n, ['simple_expansion', 'expansion'])).map((e) => [e, e.type === 'simple_expansion' ? { name: e.text.slice(1) } : parseExpansion(decodedText(e))] as const);

/**
 * What the word itself may assign as it expands: `names`; `any`, any variable; `ifs`, whether IFS may change, and to
 * what (`integer`: only by arithmetic, which assigns integers). Bash splits the whole word with the IFS it has after
 * its expansions: `${IFS=:}$x` splits `$x` at `:` (F88). An assignment is `${x=w}` or `${x:=w}` (to the target of an
 * indirection or a nameref: any; of a variable with `-i`, `w` is arithmetic), or arithmetic: `$(( ))`, a subscript, an
 * offset or a length (`${z:x=1}$x`, F87). Arithmetic that reads a name or an expansion may assign any variable: a value
 * read is an expression in its turn (`y='IFS=1'; $((y))`), and so is the subscript of an indirection's or a nameref's
 * target (`y='a[IFS=1]'; ${!y}`, F89). `${x@P}` runs the arithmetic in the value of `x` (F89).
 */
interface SelfAssigned { names: Set<string>; any: boolean; ifs: 'no' | 'integer' | 'any' }
function selfAssigned(w: WordMeaning): SelfAssigned {
  const out: SelfAssigned = { names: new Set(), any: false, ifs: 'no' };
  const integer = (): void => { if (out.ifs === 'no') out.ifs = 'integer'; };
  const anything = (ifs: 'integer' | 'any'): void => {
    out.any = true;
    if (ifs === 'any') out.ifs = 'any';
    else integer();
  };
  // (Arithmetic with no letter, `_` or expansion names no variable: `$((-1))`.)
  const arith = (text: string): void => { if (/[A-Za-z_$`]/.test(text)) anything('integer'); };
  for (const a of w.nodes.flatMap((n) => descendants(n, ['arithmetic_expansion']))) arith(a.text.replace(/^\$\(\(|\)\)$|^\$\[|\]$/g, ''));
  for (const [e, q] of expansionsOf(w)) {
    // (An expansion not parsed here, `${!x@Q}`, may be an indirection; with `=`, `${!y=1}`, or `@P`, may assign anything.)
    if (!q) {
      anything(/=|P\}$/.test(e.text) ? 'any' : 'integer');
      continue;
    }
    const nameref = attribute(w.state, q.name, 'n') !== 'off';
    // (`$x` is a name alone.)
    const p: Partial<NonNullable<ReturnType<typeof parseExpansion>>> = q;
    if (p.subscript !== undefined && !/^[@*]$/.test(p.subscript)) arith(p.subscript);
    if (p.op === ':') for (const x of p.parts!) if (x.role === 'offset' || x.role === 'length') arith(x.text);
    if (p.op === '@' && !p.prefix && p.parts!.find((x) => x.role === 'transform')!.text === 'P') anything('any');
    // (`${!x*}` and `${!x@}` list names, `${!a[@]}` keys: no indirection.)
    const lists = p.subscript === undefined ? p.op === '*' || p.op === '@' : /^[@*]$/.test(p.subscript);
    if ((p.prefix === '!' && !lists) || nameref) anything('integer');
    if (p.op === '=' || p.op === ':=') {
      if (nameref) anything('any');
      else if (attribute(w.state, q.name, 'i') !== 'off') anything('integer');
      out.names.add(q.name);
      if (q.name === 'IFS') out.ifs = 'any';
    }
  }
  return out;
}

/**
 * The readings of the word's parameters: each tuple of the values `values` lists for the parameters the word reads,
 * and for each `${x:+w}` or `${x+w}` whose `x` is a hole, `w` or nothing; at most TUPLES, the dimensions past them left as holes.
 */
function readings(w: WordMeaning, values: Values | undefined, self: SelfAssigned): TupleValues[] {
  const dims: { name: string; node?: SyntaxNode; options: readonly (string | null)[] }[] = [];
  const parsed = expansionsOf(w);
  for (const [e, p] of parsed) {
    if (!p) continue;
    // (A variable the word may assign, `${x:=a}$x`, `${z:x=1}$x`, is a hole: it may have another value after.)
    const listed = valued(p.name, w) && !self.any && !self.names.has(p.name) ? values?.get(p.name) : undefined;
    if (listed) {
      if (!dims.some((d) => !d.node && d.name === p.name)) dims.push({ name: p.name, options: listed });
      // (Only where `w` expands nothing: the evaluator reads the parameters of `w` by the same node.)
    } else if ('op' in p && (p.op === '+' || p.op === ':+') && !p.prefix && p.subscript === undefined && /^[A-Za-z_]\w*$/.test(p.name) && !/[$`]/.test(p.parts.map((x) => x.text).join(''))) {
      dims.push({ name: p.name, node: e, options: ['x', null] });
    }
  }
  let size = 1;
  const kept = dims.filter((d) => (size * d.options.length <= TUPLES ? ((size *= d.options.length), true) : false));
  let tuples: [typeof dims[number], string | null][][] = [[]];
  for (const d of kept) tuples = tuples.flatMap((t) => d.options.map((o) => [...t, [d, o] as [typeof d, string | null]]));
  return tuples.map((t) => new TupleValues(new Map(t.filter(([d]) => !d.node).map(([d, o]) => [d.name, o])), new Map(t.filter(([d]) => d.node).map(([d, o]) => [d.node!, [d.name, o] as const]))));
}

/** The atoms of a word's pieces, the separators marked where word splitting applies (`ifs`: undefined where not known). */
function atomsOf(pieces: readonly Piece[], splits: boolean, ifs: string | undefined, elementsSplit: boolean): Atom[] {
  const out: Atom[] = [];
  const holeSplits = (h: Hole): boolean => (h.kind === 'elements' ? elementsSplit
    : !h.quoted && splits && !unsplit.has(h) && (ifs === undefined || (h.kind === 'text' ? ifs !== '' : new RegExp(`[${h.kind === 'digits' ? '' : '-'}0-9]`).test(ifs))));
  for (const p of pieces) {
    if (p.hole) out.push({ hole: p.hole, splits: holeSplits(p.hole) });
    else if (p.quoted && !p.text) out.push({ c: '', quoted: true });
    else if (p.expanded && !p.quoted && splits && ifs === undefined) {
      // (An IFS not known: the text may split anywhere.)
      if (p.text) out.push({ hole: ANY.hole, splits: true });
    } else {
      for (const c of p.text) out.push({ c, quoted: p.quoted, ...(p.expanded && !p.quoted && splits && ifs!.includes(c) ? { sep: WHITE.includes(c) ? 'white' as const : 'hard' as const } : {}) });
    }
  }
  return out;
}

/** Whether an atom surely gives a field its own text: a character, a quoted hole (but in quotes with `"$@"`), a hole never empty; never a hole that may split. */
const content = (a: Atom): boolean => !isHole(a) || (!a.splits && a.hole.kind !== 'elements' && ((a.hole.quoted && !unkept.has(a.hole)) || !a.hole.empty));
const isSep = (a: Atom): boolean => !isHole(a) && !!a.sep;

/** Word splitting with no hole that may split (`splitOn`): the fields; one that only holes that may be empty give is there when they are not. */
function splitExact(atoms: readonly Atom[]): Item[] {
  // (A field one hole alone may give is there when that hole is not empty, unless it may give a quoted null.)
  const alone = (f: Atom[]): boolean => f.length === 1 && !nulls.has((f[0] as Ho).hole);
  return splitOn(atoms, (a) => (isHole(a) ? undefined : a.sep), content)
    .map(({ field, sure }) => ({ atoms: !sure && alone(field) ? [{ hole: { ...(field[0] as Ho).hole, empty: false } }] : field, min: sure ? 1 : 0, max: 1 }));
}

/** How pathname expansion may read a field. */
interface Globbing { applies: boolean; nullglob: boolean; nocase: boolean; extglob: boolean; globstar: boolean }

/** The field as a glob pattern (quoted characters escaped, as `patternOfChars`), with `fill` for each hole (`open`, if given, for one that may hold a glob character). */
function patternText(atoms: readonly Atom[], fill: string, open = fill): string {
  return patternOfChars(atoms.map((a) => (isHole(a) ? { c: globby(a.hole) ? open : fill, quoted: false, split: false } : { c: a.c, quoted: a.quoted, split: false })));
}

/** Whether a hole may hold a glob character, or a `\\` that quotes the character after it. */
const globby = (h: Hole): boolean => !h.quoted && (h.kind === 'text' || h.kind === 'elements');

/** Whether a field may be a pattern: a glob character of its own, or an unquoted hole that may hold one. */
function mayBePattern(atoms: readonly Atom[]): boolean {
  return atoms.some((a) => isHole(a) && globby(a.hole)) || isGlob(patternText(atoms, '')) || isGlob(patternText(atoms, 'x'));
}

/**
 * What the names a pattern matches have in common with it (manual 3.5.8.1): the text before its first character that
 * may be special, and after its last, read in the pattern as bash makes it (quoted characters escaped; an unquoted `\`
 * of a value quotes the next character: `\-v*` matches `-vu`, and `\` before a quoted `*` is a backslash: `\\*`). A
 * bracket expression runs to a `]` that may close it; with extglob, `!(`, `@(`, `+(`, parentheses and `|` are special;
 * with nocaseglob, a letter may match either case, so the text stops there too.
 */
function matched(atoms: readonly Atom[], g: Globbing): Atom[] {
  const p = patternText(atoms, '\0', '\x01');
  const letter = (c: string): boolean => g.nocase && c.toLowerCase() !== c.toUpperCase();
  const lit: (string | undefined)[] = [];
  for (let i = 0; i < p.length; i++) {
    const c = p[i];
    const hole = (k: number): boolean => p[k] === '\0' || p[k] === '\x01';
    if (c === '\x01') {
      // (A `\` at the end of the value quotes the character after it: the `\` that quotes a quoted `*` is then a
      // backslash, and the `*` is special, `\` and `\*`.)
      lit.push(undefined);
      if (p[i + 1] === '\\') i += 2;
    } else if (c === '\\') {
      // (A backslash before a hole quotes its first character. Only the text before the first `[` and after the last `]` is
      // kept, so what a bracket expression holds is never read.)
      lit.push(i + 1 === p.length || hole(i + 1) || letter(p[i + 1]) ? undefined : p[i + 1]);
      if (!hole(i + 1)) i++;
    } else lit.push(c === '\0' || '*?[]'.includes(c) || letter(c) || (g.extglob && ('()|'.includes(c) || ('!@+'.includes(c) && p[i + 1] === '('))) ? undefined : c);
  }
  // (With globstar, `**/` may match nothing, its `/` too: `d/**/x` matches `d/x`, `**/x` matches `x`, F94. So a `/`
  // next to a special character is special.)
  if (g.globstar) {
    const special = lit.map((c) => c === undefined);
    lit.forEach((c, i) => { if (c === '/' && ((i > 0 && special[i - 1]) || special[i + 1])) lit[i] = undefined; });
  }
  const chars = (cs: (string | undefined)[]): Ch[] => cs.map((c) => ({ c: c!, quoted: true }));
  const first = lit.indexOf(undefined);
  if (first < 0) return chars(lit);
  return [...chars(lit.slice(0, first)), ANY, ...chars(lit.slice(lit.lastIndexOf(undefined) + 1))];
}

/** The known characters a field starts with (`from: 'end'`: ends with), up to its first hole. */
function known(atoms: readonly Atom[], from: 'start' | 'end'): string {
  const list = from === 'start' ? atoms : [...atoms].reverse();
  const i = list.findIndex(isHole);
  const s = (i < 0 ? list : list.slice(0, i)).map((a) => (a as Ch).c).join('');
  return from === 'start' ? s : [...s].reverse().join('');
}

/** The fewest characters of a field. */
const shortest = (atoms: readonly Atom[]): number => atoms.reduce((n, a) => n + (isHole(a) ? (a.hole.empty ? 0 : 1) : a.c.length), 0);

/** A description of the fields of `a` and of `b` (their known start and end in common). */
function join(a: Atom[], b: Atom[]): Atom[] {
  const key = (x: Atom[]): string => JSON.stringify(x.map((y) => (isHole(y) ? [y.hole.kind, y.hole.empty] : y.c)));
  if (key(a) === key(b)) return a;
  if (a.length === 1 && b.length === 1 && isHole(a[0]) && isHole(b[0])) {
    const [h, k] = [a[0].hole, b[0].hole];
    const kind = h.kind === k.kind ? h.kind : [h.kind, k.kind].every((x) => x === 'digits' || x === 'integer') ? 'integer' : 'text';
    return [{ hole: { kind, quoted: false, empty: h.empty || k.empty } }];
  }
  const [sa, sb, ea, eb] = [known(a, 'start'), known(b, 'start'), known(a, 'end'), known(b, 'end')];
  let p = 0;
  while (p < sa.length && p < sb.length && sa[p] === sb[p]) p++;
  let s = 0;
  while (s < ea.length && s < eb.length && ea[ea.length - 1 - s] === eb[eb.length - 1 - s]) s++;
  const room = Math.min(shortest(a), shortest(b));
  s = Math.min(s, room - Math.min(p, room));
  p = Math.min(p, room);
  const chars = (t: string): Ch[] => [...t].map((c) => ({ c, quoted: true }));
  return [...chars(sa.slice(0, p)), ANY, ...chars(ea.slice(ea.length - s))];
}

/** The public description of a field. */
function fieldOf(atoms: readonly Atom[], pattern?: string | true): Field {
  const list = atoms.filter((a) => isHole(a) || a.c);
  const extra = pattern === undefined ? {} : { pattern };
  if (!list.some(isHole)) {
    const text = list.map((a) => (a as Ch).c).join('');
    return { text, start: text, end: text, ...extra };
  }
  const [start, end] = [known(list, 'start'), known(list, 'end')];
  const edge = (a: Atom, s: string): { hole: Hole } | undefined => (isHole(a) && !s ? { hole: { ...a.hole } } : undefined);
  return { start, end, ...(edge(list[0], start) && { head: edge(list[0], start)!.hole }), ...(edge(list[list.length - 1], end) && { tail: edge(list[list.length - 1], end)!.hole }), ...extra };
}

/** Pathname expansion of a run of fields: a pattern gives the names it matches, itself where none does, or nothing with nullglob. */
function globbed(item: Item, g: Globbing): Item {
  if (!g.applies || !mayBePattern(item.atoms)) return item;
  return { atoms: join(item.atoms, matched(item.atoms, g)), min: g.nullglob ? 0 : item.min };
}

/** The shape of runs of fields: exact where each run is one field, else a count with the first, middle and last joined. */
function shapeOfItems(items: Item[], pattern?: (atoms: Atom[]) => string | true | undefined): Shape {
  if (items.every((i) => i.min === 1 && i.max === 1)) return { fields: items.map((i) => fieldOf(i.atoms, pattern?.(i.atoms))) };
  const joined = (from: number, to: number): Field => ((a) => fieldOf(a, pattern?.(a)))(items.slice(from, to).map((i) => i.atoms).reduce(join));
  const sure = items.flatMap((i, k) => (i.min > 0 ? [k] : []));
  const max = items.some((i) => i.max === undefined) ? undefined : items.reduce((n, i) => n + i.max!, 0);
  return {
    min: items.reduce((n, i) => n + i.min, 0), ...(max === undefined ? {} : { max }),
    first: joined(0, (sure[0] ?? items.length - 1) + 1), middle: joined(0, items.length), last: joined(sure[sure.length - 1] ?? 0, items.length),
  };
}

/**
 * The shape of one word of a brace expansion from its pieces (manual 3.5.7, 3.5.8): split where IFS characters of
 * unquoted expansions are, and where a hole may hold one; then each field that may be a pattern read as the names it
 * may match. A hole that may split leaves the count open: the first field keeps the text before it, the last the text after.
 */
function shapeOfWord(w: WordMeaning, pieces: readonly Piece[], glob: boolean, split: boolean, ifsChanged: boolean): Shape | undefined {
  const step = w.steps.find((s) => s.kind === 'split')!;
  const ifsText = w.ifs.kind === 'default' ? WHITE : w.ifs.kind === 'value' && sameInEveryLocale(w.ifs.value) ? w.ifs.value : undefined;
  // (Where the word's arithmetic may assign IFS, it splits by an IFS not known. That IFS holds digits and `-` at most
  // besides, so the checks of glob characters and `\\` in IFS below stay as they are.)
  const splitIfs = ifsChanged ? undefined : ifsText;
  // (Bash quotes a character of the word's text that IFS holds as it expands; text before the assignment that the new
  // IFS holds is then split too: `a1b$((IFS=1))` gives `a` and `b`, F95. Such a word is not known here.)
  if (ifsChanged && pieces.some((p) => !p.hole && !p.expanded && !p.quoted && /[-0-9]/.test(p.text))) return undefined;
  // (`"$@"` makes fields where the context splits, also with an empty IFS or no unquoted part.)
  const elementsSplit = !(step.applies === false && (step.why === 'context' || step.why === 'posix-mode'));
  // (Word splitting may apply or not by POSIX mode, a redirection: an IFS not known stands for both.)
  // (Not known here, until the word model splits them as bash does: an IFS with a control character but tab and newline,
  // `$'\v'`; one with a glob character, where a value has a backslash.)
  if (step.applies !== false && ifsText !== undefined && (/[\0-\x08\x0b-\x1f\x7f]/.test(ifsText)
    || (/[*?[\]]/.test(ifsText) && pieces.some((p) => p.expanded && !p.quoted && p.text.includes('\\'))))) return undefined;
  // (Nor, where IFS holds or may hold a glob character and `set -f` is not on, one with a quoted glob character
  // that IFS holds, or with a quoted part not known: bash then globs it, `'*'*` with `IFS='*'` matches every name, F81.
  // Nor, where IFS holds or may hold `\\`, one with `"$@"` and a quoted backslash or part not known: bash splits there
  // too, `"$@\\n"`, F83.)
  const may = (c: string): boolean => ifsText === undefined || ifsText.includes(c);
  const unknownQuoted = pieces.some((p) => p.hole?.quoted && p.hole.kind === 'text');
  const quoted = (chars: string): boolean => pieces.some((p) => !p.hole && p.quoted && [...p.text].some((c) => chars.includes(c) && may(c)));
  if (w.rule.glob !== false && w.glob.noglob !== 'on' && [...'*?[]'].some(may) && (unknownQuoted || quoted('*?[]'))) return undefined;
  if (pieces.some((p) => p.hole?.kind === 'elements') && may('\\') && (unknownQuoted || quoted('\\'))) return undefined;
  // (Nor, in a word that expands something, one whose text has a character special in a pattern that IFS holds or may
  // hold: bash quotes it, `*b$x` with `IFS='*'` matches nothing, F96; `-` and `^` count where the text has a `[`.)
  const text = pieces.filter((p) => !p.hole && !p.quoted && !p.expanded).map((p) => p.text).join('');
  const specials = text.includes('[') ? '*?[]()|!@+-^' : '*?[]()|!@+';
  if (w.rule.glob !== false && w.glob.noglob !== 'on' && pieces.some((p) => p.hole || p.expanded) && [...text].some((c) => specials.includes(c) && may(c))) return undefined;
  const atoms = atomsOf(pieces, split && elementsSplit, step.applies === 'unknown' ? undefined : splitIfs, elementsSplit);
  const gs = w.steps.find((s) => s.kind === 'glob')!;
  const g: Globbing = { applies: glob && gs.applies !== false, nullglob: w.glob.nullglob !== 'off', nocase: w.glob.nocaseglob !== 'off', extglob: w.glob.extglob !== 'off', globstar: w.glob.globstar !== 'off' };
  const pattern = (a: Atom[]): string | true | undefined => (gs.applies === false || !mayBePattern(a) ? undefined : a.some(isHole) ? true : patternText(a, ''));
  if (w.rule.fields === 'one') return { fields: [fieldOf(atoms)] };
  if (!atoms.some((a) => isHole(a) && a.splits)) return shapeOfItems(splitExact(atoms).map((i) => globbed(i, g)), glob ? undefined : pattern);
  // A field between separators that surely has text of its own stays a field (unless nullglob may remove it).
  const segments: Atom[][] = [[]];
  for (const a of atoms) {
    if (isSep(a)) segments.push([]);
    else segments[segments.length - 1].push(a);
  }
  const stays = (seg: Atom[]): boolean => seg.some(content) && !(g.applies && g.nullglob && mayBePattern(seg));
  const end = (seg: Atom[], from: 'start' | 'end'): Atom[] => {
    const list = from === 'start' ? seg : [...seg].reverse();
    const k = list.findIndex((a) => isHole(a) && a.splits);
    const lead = k < 0 ? list : [...list.slice(0, k), ANY];
    if (!stays(seg) || !lead.slice(0, k < 0 ? lead.length : k).some(content)) return [ANY];
    const f = from === 'start' ? lead : lead.reverse();
    return g.applies && mayBePattern(f) ? join(f, matched(f, g)) : f;
  };
  // (Fields between may be empty where IFS may hold a character that is not white space, or a part may be empty in quotes.)
  const empty = splitIfs === undefined || /[^ \t\n]/.test(splitIfs) || atoms.some((a) => (isHole(a) ? a.hole.kind === 'elements' || nulls.has(a.hole) || (a.hole.quoted && a.hole.empty) : a.c === ''));
  const marked = (a: Atom[]): Field => fieldOf(a, glob ? undefined : pattern(a));
  return { min: segments.filter(stays).length, first: marked(end(segments[0], 'start')), middle: marked([{ hole: { kind: 'text', quoted: false, empty } }]), last: marked(end(segments[segments.length - 1], 'end')) };
}

/** The transformations of `${x@…}` in bash 5.2 (another letter is a bad substitution). */
const TRANSFORMS = /^[QEPAKaUuLk]$/;

/**
 * Whether bash may fail on the expansion `p` (also where it gives no field): an offset, an indirection, a subscript
 * (arithmetic); `${x:=w}` on a parameter it cannot assign (special, positional, read-only, one bash keeps, `FUNCNAME`
 * outside a function, F86; an element of `x[@]`), or may refuse `w` (`-i`: arithmetic; a nameref); a case operator on a
 * special parameter (`${#^^}`); a transformation it does not have (`${x@Z}`, `${x@}`: not parsed, nor is a length with an
 * operator, `${#x@Q}`). `${!x@}` and `${!x*}`, the names that start with `x`, never fail (F85).
 */
function risky(p: ReturnType<typeof parseExpansion>, w: WordMeaning): boolean {
  if (!p || p.op === ':' || (p.prefix === '!' && p.op !== '*' && p.op !== '@') || (p.subscript !== undefined && !/^[@*]$/.test(p.subscript))) return true;
  if (p.op === '=' || p.op === ':=') return !/^[A-Za-z_]\w*$/.test(p.name) || p.subscript !== undefined || changedByBash(p.name) || ['r', 'i', 'n'].some((l) => attribute(w.state, p.name, l) !== 'off');
  // (`${x@}` is not parsed: an `@` with no prefix has its letter.)
  if (p.op === '@') return p.prefix === '!' ? p.subscript !== undefined : !TRANSFORMS.test(p.parts.find((x) => x.role === 'transform')!.text);
  return /^[\^,~]/.test(p.op ?? '') && /^[#?$!-]$/.test(p.name);
}

/**
 * Words the word model reads otherwise than bash (trust-fields.md, 7), not known here until it reads them as bash
 * does: a line continuation after a tilde prefix (`~\<newline>` is `~`, also after `=` or `:`), after `$`
 * (`$\<newline>@` is `$@`) or in a parameter's name (`$y\<newline>a` is `$ya`); `$_` before a brace expression (`$_{a,b}` gives `$_a`); a process substitution joined to other text (`a<(:)`
 * is one word, which the parser reads as two, or as text: `1<(:)`); a brace expression after `$$` (`$${1..2}`, not
 * expanded); a range of characters across a backslash (`{Z..a}`, `{Z..a..+2}`); plain text with a quote or an expansion in
 * it, as the adapter keeps an extglob group (`x@(${x})y`); a `${ cmd; }` of bash 5.3.
 */
function misread(w: WordMeaning): boolean {
  const text = w.nodes.map((x) => x.text).join('');
  // (Also a tilde after `=` or `:`, `a=~\<newline>/x`, and `$` before any line continuation: `$\<newline>@` is `$@`, F90; a `+` step, F91.)
  if (/~[^/]*\\\n/.test(text) || /\$_\{/.test(text) || /\$\w*(?:\\\n)+[\w{]/.test(text) || /\$\\\n/.test(text) || /(?:^|[^$\\])(?:\$\$)+\{/.test(text)) return true;
  const crosses = (m: RegExpMatchArray): boolean => Math.min(m[1].charCodeAt(0), m[2].charCodeAt(0)) <= 92 && Math.max(m[1].charCodeAt(0), m[2].charCodeAt(0)) >= 92;
  if ([...text.matchAll(/\{([^\d.{}])\.\.([^\d.{}])(?:\.\.[-+]?\d+)?\}/g)].some(crosses)) return true;
  // (A process substitution joined to other parts: with an expansion, bash splits its name, `<(:)$x` with `IFS=/` gives
  // ``, `dev`, `fd`, `63`.)
  if (w.nodes.some((x) => descendants(x, ['word']).some((d) => /[<>]\(/.test(d.text)) || descendants(x, ['process_substitution']).some((p) => p !== x))) return true;
  // (Text the adapter keeps as plain with quotes or expansions in it: an extglob group, `x@(${x})y` is split, F92;
  // `@(a'|'b)` is the pattern `@(a\|b)`. And a `${ cmd; }` of bash 5.3, which runs in the shell and may set IFS, F93.)
  // (Not in the operand of an expansion, which the evaluator reads from its text: `"${x:-'a'}"`.)
  const outer = (d: SyntaxNode, top: SyntaxNode): boolean => {
    for (let x = d; x !== top; x = x.parent!) if (!['concatenation', 'string', 'brace_expression'].includes(x.parent!.type)) return false;
    return true;
  };
  const plainText = (top: SyntaxNode) => (d: SyntaxNode): boolean => /['"$`]/.test(d.text.replace(/\\[^]/g, '')) && outer(d, top);
  if (w.nodes.some((x) => descendants(x, ['word', 'extglob_pattern']).some(plainText(x)) || descendants(x, ['command_substitution']).some((e) => e.text.startsWith('${')))) return true;
  const top = w.nodes[0];
  const sibs = top.parent!.namedChildren;
  const i = sibs.indexOf(top);
  // (Also across a line continuation, `<(:)\<newline>$@`.)
  const between = (a: SyntaxNode, b: SyntaxNode): string => top.parent!.text.slice(a.endIndex - top.parent!.startIndex, b.startIndex - top.parent!.startIndex);
  const touches = (o: SyntaxNode | undefined, before: boolean): boolean => !!o && /^(?:\\\n)*$/.test(before ? between(o, top) : between(top, o));
  return [touches(sibs[i - 1], true) && sibs[i - 1], touches(sibs[i + 1], false) && sibs[i + 1]].some((o) => o && [o.type, top.type].includes('process_substitution'));
}

/**
 * The fields the word that holds `n` may give where it runs, as bash 5.2 expands it (trust-fields.md, 2.3): with the
 * values `values` lists (each tuple of them, up to TUPLES), and every other parameter a hole; with no `values`, every
 * part is a hole (shape first, 2.1). `glob: false`: before pathname expansion, each field with its `pattern`.
 * Undefined outside a word, for a shell other than bash, where the words of its brace expansion are not known (`{,$x}a`),
 * and for the words the word model reads otherwise than bash (`misread`; an IFS with a control character),
 * or that may assign IFS other than by arithmetic (`${IFS=:}$x`, F88).
 */
export function wordShapes(n: SyntaxNode, model: StateModel, values?: Values, opts: { glob?: boolean } = {}): WordShapes | undefined {
  const w = model.shell && model.shell !== 'bash' ? undefined : wordMeaning(n, model);
  if (!w || misread(w)) return undefined;
  // (A word that may assign IFS other than by arithmetic, `${IFS=:}$x`, is not known here: it splits by the new IFS, F88.)
  const self = selfAssigned(w);
  if (self.ifs === 'any') return undefined;
  const brace = w.steps[0].applies;
  const cases: Shape[][] = [];
  const keys = new Set<string>();
  // (Also where an expansion bash may fail on is in another one: `$((${#x}))` under `set -u`; an arithmetic error,
  // `$((x))` with `x='a b'`; an indirection to a name that is not one, a subscript, an offset.)
  const nested = w.nodes.flatMap((x) => descendants(x, ['simple_expansion', 'expansion', 'arithmetic_expansion']));
  let mayFail = !!w.failure || (nested.length > 0 && ['on', 'unknown'].includes(option(w.state, 'set', 'nounset')))
    || nested.some((e) => e.type === 'arithmetic_expansion' || (e.type === 'expansion' && risky(parseExpansion(decodedText(e)), w)));
  // (An empty `$!`, before any `&`, last of the expansions of a word turns word splitting off for the word, F73:
  // `${x-a b}$!` is one field. Such a word is read both ways.)
  const bang = nested.some((e) => e.text === '$!' && e.parent!.type !== 'string');
  for (const braces of brace === 'unknown' ? [false, true] : [brace]) {
    for (const source of readings(w, values, self)) {
      const got = holedWords(n, model, source, (part, quoted) => [{ text: '', quoted, expanded: !quoted, hole: holeOf(part, quoted, w) }], braces);
      if (!got) return undefined;
      if (got.words.some((p) => !p)) {
        mayFail = true;
        continue;
      }
      for (const split of bang ? [true, false] : [true]) {
        const shapes = got.words.map((p) => shapeOfWord(w, p!, opts.glob !== false, split, self.ifs === 'integer'));
        if (shapes.includes(undefined)) return undefined;
        const key = JSON.stringify(shapes);
        if (!keys.has(key)) cases.push(shapes as Shape[]);
        keys.add(key);
      }
    }
  }
  return { cases, mayFail };
}

// ---------------------------------------------------------------------------------------------------
// The questions asked of a field (trust-fields.md, 2.2), and whether fields fit a description.

/** The characters a hole that is never empty may start with, and end with. */
const FIRST: Record<HoleKind, RegExp> = { text: /^/, elements: /^/, digits: /^[0-9]/, integer: /^[-0-9]/ };
const LAST: Record<HoleKind, RegExp> = { text: /$/, elements: /$/, digits: /[0-9]$/, integer: /[0-9]$/ };
const sure = (h?: Hole): h is Hole => !!h && !h.empty;

/** Whether the text `s` may be the field `f` (the question "may it equal t?"). */
export function fieldHolds(f: Field, s: string): boolean {
  if (f.text !== undefined) return s === f.text;
  if (!s.startsWith(f.start) || !s.endsWith(f.end) || s.length < f.start.length + f.end.length) return false;
  if (!f.start && sure(f.head) && (s.length <= f.end.length || !FIRST[f.head.kind].test(s))) return false;
  return !(!f.end && sure(f.tail) && (s.length <= f.start.length || !LAST[f.tail.kind].test(s)));
}

/** Whether the field `f` may start with `prefix` (`-`, `+`). */
export function mayStartWith(f: Field, prefix: string): boolean {
  if (f.text !== undefined) return f.text.startsWith(prefix);
  if (f.start.length >= prefix.length) return f.start.startsWith(prefix);
  return prefix.startsWith(f.start) && (!!f.start || !sure(f.head) || FIRST[f.head.kind].test(prefix));
}

/** A name of a variable, also with a subscript (`a[i]`). */
const NAME = /^[A-Za-z_]\w*(?:\[.*\])?$/s;
const ASSIGNMENT = /^[A-Za-z_]\w*(?:\[.*\])?\+?=/s;
/** Whether a field that starts with a hole cannot start with a letter or `_`. */
const numeric = (f: Field): boolean => !f.start && sure(f.head) && (f.head.kind === 'digits' || f.head.kind === 'integer');

/** Whether the field `f` may be the name of a variable (an identifier, or one with a subscript). */
export function mayBeName(f: Field): boolean {
  if (f.text !== undefined) return NAME.test(f.text);
  if (numeric(f)) return false;
  if (f.start && !/^[A-Za-z_]\w*(?:\[|$)/.test(f.start)) return false;
  // (Its end is all of word characters, unless it ends a subscript.)
  return !f.end || /^\w+$|\]$/.test(f.end);
}

/** Whether the field `f` may be an assignment given to a declaration (`name=…`, `name+=…`, `name[…]=…`); its end does not matter. */
export function mayBeAssignment(f: Field): boolean {
  if (f.text !== undefined) return ASSIGNMENT.test(f.text);
  if (numeric(f)) return false;
  return !f.start || /^[A-Za-z_]\w*(?:$|[=[]|\+$|\+=)/.test(f.start);
}

/** Whether the field `f` may name a function (bash 5.2 takes names a variable cannot have: `f.`): any field but an empty one. */
export const mayNameFunction = (f: Field): boolean => f.text !== '';

/** Whether the fields `fields` may be the shape `s`: their count, and each where it stands (`fits`: `fieldHolds`, or a check of the caller's). */
function shapeHolds(s: Shape, fields: readonly string[], fits: (f: Field, t: string) => boolean): boolean {
  if ('fields' in s) return s.fields.length === fields.length && s.fields.every((f, i) => fits(f, fields[i]));
  const n = fields.length;
  if (n < s.min || (s.max !== undefined && n > s.max)) return false;
  if (n === 0) return true;
  return fits(s.first, fields[0]) && fits(s.last, fields[n - 1]) && fields.slice(1, -1).every((t) => fits(s.middle, t));
}

/** Whether the fields `fields` may be what a word gives in one of its cases (the brace words' fields one after another). */
export function shapesHold(ws: WordShapes, fields: readonly string[], fits: (f: Field, t: string) => boolean = fieldHolds): boolean {
  return ws.cases.some((shapes) => {
    let at = new Set([0]);
    for (const s of shapes) {
      const next = new Set<number>();
      for (const i of at) for (let j = i; j <= fields.length; j++) if (shapeHolds(s, fields.slice(i, j), fits)) next.add(j);
      at = next;
    }
    return at.has(fields.length);
  });
}

/** Whether the word may give no field at all (in some case, every word of its brace expansion none). */
export const mayGiveNone = (ws: WordShapes): boolean => ws.cases.some((c) => c.every((s) => ('fields' in s ? s.fields.length : s.min) === 0));
