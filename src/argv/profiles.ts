// What a word of a command is for every count of the words that may give other than one word (docs/design/count-hedges.md,
// sections 2.4 and 2.5), read from the table of src/argv/readings.ts: its profile at each of its contexts (its roles for
// each of its own counts, said by place or by own count), the classes of contexts with one profile, and the conditions
// that say each class (at most `CLAUSES` clauses, each of at most `CONDITIONS` conditions of at most two atoms, sound and
// complete), or past them a text without conditions. `interpret` gives them to the operands (`OperandRole.readings`).
import type { ArgRole, ArgvParse } from './interpret';
import type { Coordinate, Outcome, ReadingsTable, WordAt } from './readings';
import { allRoles } from './valuehedges';

/** The most clauses a word says (section 2.5, the budget): past them, its other classes are one text without conditions. */
export const CLAUSES = 4;
/** The most conditions one clause says ("X when A, or when B"): a class that needs more is folded too. */
export const CONDITIONS = 2;

/**
 * A role of one of a word's words in a reading: the role, the commands that read it (`by`: the command's word that names
 * each command run or subcommand it is in, outermost first, none for the command itself; undefined where the shape does
 * not tell which word of a run names it), and what tells two roles apart (`key`).
 */
export interface Role { key: string; role: ArgRole; by: (number | undefined)[] }

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
 * A coordinate as the conditions say it: the words it names (indexes of the command's words, each variable once; `one`,
 * one variable: "`$a` expands to …"; otherwise a sum: "`$n` and `$v` expand to … in all"), and its values in the units the
 * text says (the words of that variable, or of the words named in all; `orMore` at the top). `counted`: the sum counts
 * each named word once; where a variable is in it twice (`cp $a $b $a d`), only "nothing" and "a word or more" are said.
 * `parts`: it holds a part of a word that comes in parts (`ArgWord.parts`: `-v*$x`), which no atom says; the classes it
 * decides fold.
 */
export interface Place { words: number[]; one: boolean; counted: boolean; parts?: true; values: Value[] }
export interface Value { n: number; orMore?: true }

/** A set of values of one place: from `from` to `to`, or `from` and more (no `to`). */
export interface Atom { place: number; from: number; to?: number }

/** A profile, said where any of its conditions holds (each a conjunction of atoms). */
export interface Clause { profile: Profile; conditions: Atom[][] }

/** The roles of the classes folded into one text (`it can also be X or Y, by how many words … give`), and the words it names. */
export interface Folded { roles: Role[]; words: number[] }

/**
 * The readings of a command's word: its places, its contexts and the profile at each, the profile as written (`base`,
 * said first), the clauses of its other classes, or past the budget the text they fold into (`folded`, and no clauses).
 * The contexts where every own count is refused are no class, and a clause may hold there (section 2.5).
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

/** The commands that read each word of a reading: the command's words that name the command runs and subcommands it is in. */
function readers(parse: ArgvParse, owners: readonly (number | undefined)[], path: (number | undefined)[] = [], out = new Map<number, (number | undefined)[]>()): Map<number, (number | undefined)[]> {
  for (const { word, role } of parse.roles) {
    out.set(word, path);
    if ((role.role === 'subcommand' || role.role === 'command') && role.parse) readers(role.parse, owners, [...path, owners[word]], out);
  }
  return out;
}

/**
 * What tells two roles of a word apart (as `sameRole` of src/argv/valuehedges.ts does for the others): an operand's
 * text, its note in parentheses included, the value of the same option, the operand a command run fills, the same
 * option or letters.
 */
export function roleKey(r: ArgRole): string {
  if (r.role === 'operand') return `operand ${r.spec?.text.en ?? ''}`;
  if (r.role === 'value') return `value ${r.of} ${r.index}`;
  if (r.role === 'command') return `command ${r.slot.run} ${r.item?.text.en ?? ''}`;
  if (r.role === 'cluster' || r.role === 'old-style') return `${r.role} ${r.letters.map(roleKey).join(' ')}`;
  return `${r.role} ${'flag' in r ? r.flag : ''}`;
}

/** The roles in a row, each repeated in a row once. */
export const squeeze = (roles: readonly Role[]): Role[] => roles.filter((r, i) => i === 0 || r.key !== roles[i - 1].key);
const keysOf = (roles: readonly Role[]): string => roles.map((r) => r.key).join('\x01');

/** The profile of a word read at each of its own counts `counts` (`WordAt`). */
function profileOf(t: ReadingsTable, counts: readonly number[], read: readonly WordAt[], orMore: boolean, asRead = false): Profile {
  const entries = read.map((x): Entry => {
    if (x.outcome === 'unknown' || (x.outcome === 'refused' && !asRead)) return { outcome: x.outcome };
    const by = readers(t.reading(x.sums).parse, x.owners);
    return {
      outcome: 'read',
      roles: x.fields.map((role, i) => {
        const path = by.get(x.places[i])!;
        return { key: `${path.map((k) => `>${k ?? '?'}`).join('')}\0${roleKey(role)}`, role, by: path };
      }),
    };
  });
  const key = entries.map((e) => (e.roles ? keysOf(e.roles) : `\x02${e.outcome}`)).join('\x03');
  const groups: CountGroup[] = [];
  entries.forEach((e, i) => {
    if (!e.roles) return;
    const roles = squeeze(e.roles);
    const last = groups.at(-1);
    if (last && last.to === counts[i] - 1 && keysOf(last.roles) === keysOf(roles)) last.to = counts[i];
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

interface Candidate { atoms: Atom[]; bits: bigint }

/**
 * The conditions of at most two atoms that lie in `allowed` (a class and the contexts where every own count is refused)
 * and hold somewhere in the class, the largest of them, each with the contexts it holds at.
 */
function candidates(atoms: readonly Candidate[], inside: bigint, allowed: bigint): Candidate[] {
  // (One atom before two: of conditions true at the same contexts, the first is kept.)
  const all = atoms.filter((a) => (a.bits & ~allowed) === 0n && a.bits & inside);
  const seen = new Set(all.map((x) => x.bits));
  for (const [i, a] of atoms.entries()) {
    for (const b of atoms.slice(i + 1)) {
      const bits = a.bits & b.bits;
      if (b.atoms[0].place === a.atoms[0].place || (bits & ~allowed) !== 0n || !(bits & inside) || seen.has(bits)) continue;
      seen.add(bits);
      all.push({ atoms: [...a.atoms, ...b.atoms], bits });
    }
  }
  return all.filter((x) => !all.some((y) => y !== x && (x.bits & ~y.bits) === 0n));
}

/**
 * The fewest conditions (at most `CONDITIONS`, two), then the fewest atoms, whose contexts hold every context of the
 * class `inside`; undefined where none do. Each is a largest candidate, so this is the smallest cover of them.
 */
function cover(found: readonly Candidate[], inside: bigint): Candidate[] | undefined {
  const covers = (bits: bigint): boolean => (inside & ~bits) === 0n;
  // (The candidates are in order of their atoms, one before two: the first that covers alone has the fewest.)
  const one = found.find((x) => covers(x.bits));
  if (one) return [one];
  // (Two conditions, of two atoms in all, then three, then four.)
  for (let atoms = 2; atoms <= 4; atoms++) {
    for (const [i, x] of found.entries()) for (const y of found.slice(i + 1)) if (x.atoms.length + y.atoms.length === atoms && covers(x.bits | y.bits)) return [x, y];
  }
  return undefined;
}

/**
 * Whether every word of every shape read has one role, the same (`echo`'s text, `rm`'s files): then no word's role
 * depends on the counts. Not where no shape is read (past the cap).
 */
function uniform(t: ReadingsTable): boolean {
  if (!t.shapes) return false;
  const keys = new Set<string>();
  for (const sums of t.shapes) {
    const r = t.reading(sums);
    if (r.outcome !== 'read') return false;
    for (const role of allRoles(r.parse).values()) keys.add(roleKey(role));
  }
  return keys.size === 1;
}

/**
 * The readings of the command's word `k` (section 2.4 and 2.5) from the table `t`: undefined where its role as written
 * is all there is to say (past the cap, a word whose role cannot depend on the counts, a word known to give none); `Depends` where it may and is
 * not read (past the cap, or a reading the pattern matcher gave up).
 */
export function wordReadings(t: ReadingsTable, k: number): WordReadings | Depends | undefined {
  const names = (): number[] => [...new Set(t.variables.map((v) => t.back(v.words[0])))];
  const cx = t.contexts(k);
  // (A word in parts has no contexts of its own; it says nothing where no word's role depends on the counts: `echo {1..$n}`.)
  if (!cx) return (t.hedged().includes(k) || t.parted[k]) && !uniform(t) ? { kind: 'depends', words: names() } : undefined;
  // (A word the model knows gives no word has no role to say: `z=; cp $z $u d`.)
  if (cx.own[0] === 0) return undefined;
  const own = t.variableAt[k];
  const orMore = own !== undefined && (t.variables[own].max ?? Infinity) > t.variables[own].top;
  const profiles = cx.contexts.map((context) => profileOf(t, cx.own, cx.own.map((c) => t.readAt(k, context, c)), orMore));
  // (The line as written is the one the explanation says first: where the tool refuses it (`sudo -u $u -Z ls y`), its roles are
  // still the ones said, and the other readings are told from them, as if it were read: unless a word of it is an operand the spec
  // does not describe, where no form fitted (`unmatched`) and there is no role to say. A refused context stays free.)
  const baseAt = cx.contexts.findIndex((context) => context.every((v, i) => v === cx.base[i]));
  const written = cx.own.map((c) => t.readAt(k, cx.contexts[baseAt], c));
  if (profiles[baseAt].entries.every((e) => e.outcome === 'refused') && written.every((x) => x.fields.every((r) => r.role !== 'operand' || r.spec))) {
    profiles[baseAt] = profileOf(t, cx.own, written, orMore, true);
  }
  if (profiles.some((p) => p.entries.some((e) => e.outcome === 'unknown'))) return { kind: 'depends', words: names() };
  const named = cx.coordinates.map((c, i) => ({ c, i })).filter(({ c }) => c.mult.size);
  const places = named.map(({ c, i }): Place => {
    const most = c.fixed + [...c.mult].reduce((n, [v, m]) => n + m * (t.variables[v].max ?? Infinity), 0);
    const words = [...new Set([...c.mult.keys()].map((v) => t.back(c.words.find((j) => t.variableOf[j] === v)!)))];
    const one = c.mult.size === 1;
    const parts = [...c.mult.keys()].some((v) => t.variables[v].part);
    return { words, one, counted: one || [...c.mult.values()].every((m) => m === 1), ...(parts ? { parts: true as const } : {}), values: cx.contexts.map((context) => valueOf(c, context[i], most)) };
  });
  const base = profiles[baseAt];
  const out: WordReadings = { kind: 'read', places, contexts: cx.contexts, profiles, base, clauses: [] };
  // (The classes, in the order of their first context. The base class gets no clause; nor do the contexts where every
  // own count is refused, where a clause may hold.)
  const classes = new Map<string, bigint>();
  let refused = 0n;
  profiles.forEach((p, i) => {
    const bit = 1n << BigInt(i);
    if (!p.entries.some((e) => e.roles)) refused |= bit;
    else if (p.key !== base.key) classes.set(p.key, (classes.get(p.key) ?? 0n) | bit);
  });
  if (!classes.size) return out;
  const atoms: Candidate[] = [];
  const every = (1n << BigInt(cx.contexts.length)) - 1n;
  places.forEach((place, p) => {
    const bitsOf = (atom: Atom): bigint => place.values.reduce((b, x, i) => (holds(atom, x) ? b | (1n << BigInt(i)) : b), 0n);
    const ns = [...new Set(place.values.map((x) => x.n))].sort((a, b) => a - b);
    // (Of a sum that holds a variable twice, "nothing" and "a word or more" only: its count is not the words named.)
    // (Of a part of a word that comes in parts, none: the texts name the word, not the part.)
    const tried = place.parts ? [] : place.counted ? [...ns.map((n): Atom => ({ place: p, from: n, to: n })), ...ns.slice(1).map((n): Atom => ({ place: p, from: n }))] : [{ place: p, from: 0, to: 0 }, { place: p, from: 1 }];
    for (const atom of tried) {
      const bits = bitsOf(atom);
      if (bits && bits !== every && !atoms.some((a) => a.bits === bits)) atoms.push({ atoms: [atom], bits });
    }
  });
  const clauses: Clause[] = [];
  for (const [key, inside] of classes) {
    const found = cover(candidates(atoms, inside, inside | refused), inside);
    if (!found) return fold(out, classes, cx.coordinates, own, t);
    clauses.push({ profile: profiles.find((p) => p.key === key)!, conditions: found.map((x) => x.atoms) });
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
  const words = [...new Set([...vars].map((v) => t.back(t.variables[v].words[0])))].sort((a, b) => a - b);
  return { ...out, folded: { roles, words } };
}
