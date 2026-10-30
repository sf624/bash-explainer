// What a word of a command is for every count of the words that may give other than one word (docs/design/count-hedges.md,
// sections 2.4 and 2.5), read from the table of src/argv/readings.ts: its profile at each of its contexts (its roles for
// each of its own counts, said by place or by own count), the classes of contexts with one profile, and the conditions
// that say each class (at most `CLAUSES` clauses of at most two atoms, sound and complete), or past them a text without
// conditions. Nothing reads it yet: the explanation reads it from step 4 on.
import type { ArgRole, ArgvParse } from './interpret';
import type { Coordinate, Outcome, ReadingsTable, WordAt } from './readings';
import { roleText } from './valuehedges';

/** The most clauses a word says (section 2.5, the budget): past them, its other classes are one text without conditions. */
export const CLAUSES = 4;

/**
 * A role of one of a word's words in a reading: the role, the commands that read it (`reader`: '' for the command
 * itself, `>tar` in a command run, `>log` in a subcommand), and what tells two roles apart (`key`).
 */
export interface Role { key: string; role: ArgRole; reader: string }

/** The reading of a word at one of its own counts: the roles of its words, or how the reading ended otherwise. */
export type Entry = { outcome: 'read'; roles: Role[] } | { outcome: Exclude<Outcome, 'read'>; roles?: undefined };

/** Own counts read in a row whose roles are the same, a role repeated in a row once; `orMore`: the last stands for more. */
export interface CountGroup { from: number; to: number; orMore?: true; roles: Role[] }

/**
 * A word's roles for each of its own counts (section 2.4), at one context: `entries` for `counts`. `places`: the role of
 * each of its words by place, where it is the same for every own count read that has that word (the last stands for
 * every word after); undefined where a place's role depends on the own count. `groups`: the own counts read, grouped.
 * `orMore`: the top own count stands for that many or more. `key`: equal for equal profiles (the counts refused too).
 */
export interface Profile { key: string; counts: readonly number[]; entries: Entry[]; places?: Role[]; groups: CountGroup[]; orMore: boolean }

/**
 * A coordinate as the conditions say it: the words it names (indexes of the command's words; `one`, one word or several
 * of one variable: "`$a` expands to …"; otherwise a sum: "`$n` and `$v` expand to … in all"), and its values in the units
 * the text says (the words of that variable, or of the words named in all; `orMore` at the top).
 */
export interface Place { words: number[]; one: boolean; values: Value[] }
export interface Value { n: number; orMore?: true }

/** A set of values of one place: from `from` to `to`, or `from` and more (no `to`). */
export interface Atom { place: number; from: number; to?: number }

/** A profile, said where every atom holds. */
export interface Clause { profile: Profile; atoms: Atom[] }

/** The roles of the classes folded into one text (`X or Y, by how many words … give`), and the words it names. */
export interface Folded { roles: Role[]; words: number[] }

/**
 * The readings of a command's word: its places, its contexts and the profile at each, the profile as written (`base`,
 * said first), the clauses of its other classes, or past the budget the text they fold into (`folded`, and no clauses).
 * The contexts where every own count is refused get no clause (section 2.5).
 */
export interface WordReadings {
  kind: 'read';
  places: Place[];
  contexts: number[][];
  profiles: Profile[];
  base: Profile;
  clauses: Clause[];
  folded?: Folded;
}

/**
 * A word whose role may depend on the counts, which says only that (section 2.8): past the cap, or where the pattern
 * matcher gave up in a reading. `words`: the words it names, the first of each count variable.
 */
export interface Depends { kind: 'depends'; words: number[] }

/** The commands that read each word of a reading: '' for the command, `>name` for each command run or subcommand in. */
function readers(parse: ArgvParse, path = '', out = new Map<number, string>()): Map<number, string> {
  for (const { word, role } of parse.roles) {
    out.set(word, path);
    if (role.role === 'subcommand') readers(role.parse, `${path}>${role.name}`, out);
    if (role.role === 'command' && role.parse) readers(role.parse, `${path}>${role.name ?? '?'}`, out);
  }
  return out;
}

/** The readers of each reading's words, each reading's once. */
const readersOf = new WeakMap<ArgvParse, Map<number, string>>();

/**
 * What tells two roles of a word apart (as `sameRole` of src/argv/valuehedges.ts): an operand's text without its
 * parentheses, the value of the same option, the operand a command run fills, the same option or letters.
 */
export function roleKey(r: ArgRole): string {
  if (r.role === 'operand') return `operand ${r.spec ? roleText(r.spec) : ''}`;
  if (r.role === 'value') return `value ${r.of} ${r.index}`;
  if (r.role === 'command') return `command ${r.slot.run} ${r.item ? roleText(r.item) : ''}`;
  if (r.role === 'cluster' || r.role === 'old-style') return `${r.role} ${r.letters.map(roleKey).join(' ')}`;
  return `${r.role} ${'flag' in r ? r.flag : ''}`;
}

/** The roles in a row, each repeated in a row once. */
export const squeeze = (roles: readonly Role[]): Role[] => roles.filter((r, i) => i === 0 || r.key !== roles[i - 1].key);

/** The profile of a word read at each of its own counts `counts` (`WordAt`). */
function profileOf(t: ReadingsTable, counts: readonly number[], read: readonly WordAt[], orMore: boolean): Profile {
  const entries = read.map((x): Entry => {
    if (x.outcome !== 'read') return { outcome: x.outcome };
    const parse = t.reading(x.sums).parse;
    if (!readersOf.has(parse)) readersOf.set(parse, readers(parse));
    const by = readersOf.get(parse)!;
    return { outcome: 'read', roles: x.fields.map((role, i) => ({ key: `${by.get(x.places[i])}\0${roleKey(role)}`, role, reader: by.get(x.places[i])! })) };
  });
  const key = entries.map((e) => e.roles?.map((r) => r.key).join('\x01') ?? `\x02${e.outcome}`).join('\x03');
  const groups: CountGroup[] = [];
  entries.forEach((e, i) => {
    if (!e.roles) return;
    const roles = squeeze(e.roles);
    const last = groups.at(-1);
    if (last && last.to === counts[i] - 1 && last.roles.map((r) => r.key).join() === roles.map((r) => r.key).join()) last.to = counts[i];
    else groups.push({ from: counts[i], to: counts[i], roles });
  });
  if (orMore && groups.length && groups.at(-1)!.to === counts.at(-1)) groups.at(-1)!.orMore = true;
  // (By place: the role of each word is that of every own count read that has it.)
  const lists = entries.flatMap((e) => (e.roles ? [e.roles] : []));
  const longest = Math.max(0, ...lists.map((r) => r.length));
  const places = Array.from({ length: longest }, (_, i) => lists.find((r) => r.length > i)![i]);
  const byPlace = lists.every((rs) => rs.every((r, i) => r.key === places[i].key));
  return { key, counts, entries, ...(byPlace ? { places } : {}), groups, orMore };
}

/** A context's value at a place, in the units its text says. */
function valueOf(c: Coordinate, v: number, most: number): Value {
  const m = c.mult.size === 1 ? [...c.mult.values()][0] : 1;
  const n = Math.ceil((v - c.fixed) / m);
  return v === c.top && most > c.top ? { n, orMore: true } : { n };
}

/** Whether an atom holds for a value. */
const holds = (a: Atom, x: Value): boolean => x.n >= a.from && (a.to === undefined || (!x.orMore && x.n <= a.to));

const popcount = (b: bigint): number => {
  let n = 0;
  for (; b; b &= b - 1n) n++;
  return n;
};

/** The conditions of at most two atoms that lie in `inside` and are largest there, each with the contexts it holds at. */
function candidates(atoms: readonly { atom: Atom; bits: bigint }[], inside: bigint): { atoms: Atom[]; bits: bigint }[] {
  // (One atom before two: of conditions true at the same contexts, the first is kept.)
  const all = atoms.filter((a) => (a.bits & ~inside) === 0n).map((a) => ({ atoms: [a.atom], bits: a.bits }));
  const seen = new Set(all.map((x) => x.bits));
  for (const [i, a] of atoms.entries()) {
    for (const b of atoms.slice(i + 1)) {
      const bits = a.bits & b.bits;
      if (b.atom.place === a.atom.place || (bits & ~inside) !== 0n || seen.has(bits)) continue;
      seen.add(bits);
      all.push({ atoms: [a.atom, b.atom], bits });
    }
  }
  return all.filter((x) => !all.some((y) => y !== x && (x.bits & ~y.bits) === 0n));
}

/**
 * The readings of the command's word `k` (section 2.4 and 2.5) from the table `t`: undefined where its role as written
 * is all there is to say (past the cap, a word whose role cannot depend on the counts); `Depends` where it may and is
 * not read (past the cap, or a reading the pattern matcher gave up).
 */
export function wordReadings(t: ReadingsTable, k: number): WordReadings | Depends | undefined {
  const names = (): number[] => t.variables.map((v) => t.back(v.words[0]));
  const cx = t.contexts(k);
  if (!cx) return t.hedged().includes(k) ? { kind: 'depends', words: names() } : undefined;
  const own = t.variableAt[k];
  const orMore = own !== undefined && (t.variables[own].max ?? Infinity) > t.variables[own].top;
  const profiles = cx.contexts.map((context) => profileOf(t, cx.own, cx.own.map((c) => t.readAt(k, context, c)), orMore));
  if (profiles.some((p) => p.entries.some((e) => e.outcome === 'unknown'))) return { kind: 'depends', words: names() };
  const named = cx.coordinates.map((c, i) => ({ c, i })).filter(({ c }) => c.mult.size);
  const places = named.map(({ c, i }): Place => {
    const most = c.fixed + [...c.mult].reduce((n, [v, m]) => n + m * (t.variables[v].max ?? Infinity), 0);
    const one = c.mult.size === 1;
    const words = c.words.filter((j) => t.variableOf[j] !== undefined).map(t.back);
    return { words: one ? words.slice(0, 1) : words, one, values: cx.contexts.map((context) => valueOf(c, context[i], most)) };
  });
  const baseAt = cx.contexts.findIndex((context) => context.every((v, i) => v === cx.base[i]));
  const base = profiles[baseAt];
  const out: WordReadings = { kind: 'read', places, contexts: cx.contexts, profiles, base, clauses: [] };
  // (The classes, in the order of their first context; the base class, and the contexts where every own count is refused, get no clause.)
  const classes = new Map<string, bigint>();
  profiles.forEach((p, i) => {
    if (p.key !== base.key && p.entries.some((e) => e.roles)) classes.set(p.key, (classes.get(p.key) ?? 0n) | (1n << BigInt(i)));
  });
  if (!classes.size) return out;
  const atoms: { atom: Atom; bits: bigint }[] = [];
  places.forEach((place, p) => {
    const bitsOf = (atom: Atom): bigint => place.values.reduce((b, x, i) => (holds(atom, x) ? b | (1n << BigInt(i)) : b), 0n);
    const ns = [...new Set(place.values.map((x) => x.n))].sort((a, b) => a - b);
    const every = (1n << BigInt(cx.contexts.length)) - 1n;
    const tried = [...ns.map((n): Atom => ({ place: p, from: n, to: n })), ...ns.slice(1).map((n): Atom => ({ place: p, from: n }))];
    for (const atom of tried) {
      const bits = bitsOf(atom);
      if (bits && bits !== every && !atoms.some((a) => a.bits === bits)) atoms.push({ atom, bits });
    }
  });
  const clauses: Clause[] = [];
  for (const [key, inside] of classes) {
    const profile = profiles.find((p) => p.key === key)!;
    const found = candidates(atoms, inside);
    let left = inside;
    while (left) {
      const best = found.reduce<{ atoms: Atom[]; bits: bigint } | undefined>((b, x) => (popcount(x.bits & left) > (b ? popcount(b.bits & left) : 0) ? x : b), undefined);
      if (!best) return fold(out, classes, cx.coordinates, own, t);
      clauses.push({ profile, atoms: best.atoms });
      left &= ~best.bits;
    }
  }
  return clauses.length > CLAUSES ? fold(out, classes, cx.coordinates, own, t) : { ...out, clauses };
}

/** The other classes of a word, folded into one text: their roles once each, and the words whose counts decide them. */
function fold(out: WordReadings, classes: Map<string, bigint>, coordinates: readonly Coordinate[], own: number | undefined, t: ReadingsTable): WordReadings {
  const roles: Role[] = [];
  for (const key of classes.keys()) {
    for (const e of out.profiles.find((p) => p.key === key)!.entries) for (const r of e.roles ?? []) if (!roles.some((x) => x.key === r.key)) roles.push(r);
  }
  const vars = new Set(coordinates.flatMap((c) => [...c.mult.keys()]));
  if (own !== undefined) vars.add(own);
  const words = [...vars].map((v) => t.back(t.variables[v].words[0])).sort((a, b) => a - b);
  return { ...out, folded: { roles, words } };
}
