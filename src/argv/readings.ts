// The readings of a command's words for every count of its words that may give other than one word
// (docs/design/count-hedges.md, section 2): the runs of words of unknown text, the count variables (tied where two words
// are one parameter), the coordinates and their domains up to the bound S, the shapes read (the sums of the runs, at real
// sums inside a run and capped elsewhere, at most `SHAPE_CAP`), and one reading of the whole line per shape, with the
// roles given back to the command's words. src/argv/profiles.ts reads it, and `interpret` gives its readings to the
// role of each word.
import { BASH_VARIABLES } from '../semantics/vars';
import { splitEnvString } from './envsplit';
import { type ArgRole, type ArgvParse, type ArgWord, fieldLine, type InterpretContext, readWritten, type RoleAt, subcommand } from './interpret';
import { type Group, lineIndex, optionFields, regroup } from './regroup';
import type { CommandSpec } from './spec';

/** The most shapes read for one command (section 2.8): past it, no shape is read. */
export const SHAPE_CAP = 1024;

/** The words that give one count (section 2.2): a word that may give other than one, or several tied. */
export interface CountVariable {
  /** Its words, indexes in the line (`interpret`'s `line`, with the fields the model knows in place). */
  words: number[];
  /** The fewest words each gives (0 when it may give none), and the most, where known. */
  min: number;
  max?: number;
  /** The most read: `min` and S, or `max` where fewer. Where the word may give more, it stands for that many or more. */
  top: number;
  /** Its count in the line as written: its fewest, one at least; none for the words splitting adds (`ArgWord.parts`). */
  base: number;
  /** It counts a part of a word that comes in several (`ArgWord.parts`), not the whole word. */
  part?: true;
}

/**
 * Words in a row of no known text with at least one flexible word, or one flexible word with a known start (`x$a`,
 * whose first word keeps it: `prefix`, and each of its words where they all do, `each`: `-v*`). The line written out
 * depends only on how many words they give in all.
 */
export interface Run {
  /** Its words, indexes in the line. */
  words: number[];
  prefix?: string;
  each?: true;
  /** How many words its words of a known count give (`"$v"`, `{x,y}`), and how many words of each count variable it holds. */
  fixed: number;
  mult: Map<number, number>;
  /** The fewest words it gives in all, and its top as a coordinate (`fewest` and S): that many or more. */
  fewest: number;
  top: number;
}

/**
 * How a reading ends: every word has a role (`read`); the interpreter knows that the tool refuses the words (`refused`:
 * an option's value that no word gives, `missing`, or operands that no form fits, `unmatched`); or the pattern matcher
 * gave up (`unknown`: `gaveUp`).
 */
export type Outcome = 'read' | 'refused' | 'unknown';

/** The reading of one shape: the line written out, and the parse of it, in the numbers of those words. */
export interface Reading { outcome: Outcome; words: ArgWord[]; parse: ArgvParse }

/**
 * The roles of the command's words where each count variable gives a count: the parse in the numbers of the command's
 * words (`regroup`, as `interpret` gives back), and the role of each word each of them gives (`fields`; none for a word
 * that gives none).
 */
export interface WordsAt { outcome: Outcome; parse: ArgvParse; fields: ArgRole[][] }

/**
 * The contexts of a word (section 2.4), each tuple once: for a word in a run (`run`), the words before it and after it in
 * the run, then the other runs in order; for another, every run. Each coordinate leaves out what the word's own
 * variable gives, and is capped at its top. `own`: its own counts, from one (one or its known number of words for a word
 * that is not flexible).
 */
export interface Contexts {
  run?: number; contexts: number[][]; own: number[];
  /** What each place of a context sums (`Coordinate`), and the context of the line as written (each word its fewest, one at least). */
  coordinates: Coordinate[]; base: number[];
}

/**
 * A place of a word's contexts: the words it sums (indexes in the line; the word's own variable's left out), how many
 * words its words of a known count give, how many words of each count variable it holds, and its cap (that many or more).
 */
export interface Coordinate { words: number[]; fixed: number; mult: Map<number, number>; top: number }

/**
 * A word read at a context and an own count: the shape, how its reading ends, and the role of each of its words, with
 * where each stands in the reading (`places`, the numbers of the reading's words). `owners`: the command's word that each
 * word of the reading comes from, where the shape tells (a word outside the runs, the word itself, a run or the part of
 * its run before or after it that is one word); undefined where it does not (`$n $v` with three words in all).
 */
export interface WordAt { sums: number[]; outcome: Outcome; fields: ArgRole[]; places: number[]; owners: (number | undefined)[] }

export interface ReadingsTable {
  line: ArgWord[];
  /** The command's word that a word of the line stands for. */
  back: (j: number) => number;
  runs: Run[];
  variables: CountVariable[];
  /** The count variable of each word of the line that is flexible. */
  variableOf: (number | undefined)[];
  /** S: the number of words past which every count reads the same, the largest of the specs a reading may visit. */
  bound: number;
  /** The specs a reading may visit: the command's, and those its known words name, as a subcommand or a command. */
  specs: ReadonlySet<CommandSpec>;
  /** The counts of the base shape, the line as written: each word its fewest, one at least. */
  base: number[];
  /** The shapes read, each the sum of each run, in order; undefined past `SHAPE_CAP`, or where a word is `ArgWord.dashes`. */
  shapes: number[][] | undefined;
  /** The count variable of each of the command's words that is flexible. */
  variableAt: (number | undefined)[];
  /** The command's words that come in parts (`ArgWord.parts`), each a word of the line with a count of its own. */
  parted: boolean[];
  /** The reading of a shape (each read once). */
  reading: (sums: readonly number[]) => Reading;
  /**
   * The roles of the command's words where each count variable gives `counts[v]` words: read at those real sums, so it
   * may read a shape that is not in `shapes` (a count past its top). The hedges read through `contexts` and `readAt`,
   * which stay within them.
   */
  at: (counts: readonly number[]) => WordsAt;
  /** The contexts of a command's word and its own counts (section 2.4); undefined past `SHAPE_CAP`. */
  contexts: (k: number) => Contexts | undefined;
  /** The shape of a command's word at one of its contexts with its own count `c` (one of `own`), and the roles of its words there. */
  readAt: (k: number, context: readonly number[], c: number) => WordAt;
  /**
   * The command's words whose role may depend on the counts, as told without reading other shapes (section 2.8): every
   * word from the first flexible one on, and the words before it that are operands as written.
   */
  hedged: () => number[];
}

/** Whether a word may give other than one word, and not an exact number of them (section 2.1). */
export const flexible = (w: ArgWord): boolean => !!w.count && w.count.min !== w.count.max;
const range = (from: number, to: number): number[] => Array.from({ length: to - from }, (_, k) => from + k);

/**
 * S of one spec (section 2.1): past it, every word of the line reads the same for any more words (a repeated item, an
 * extra operand, an argument of the command it runs). Two, the most values an option takes (two: `jq --arg NAME
 * VALUE`; none without options) and the longest pattern of its operands.
 */
export function wordsBound(spec: CommandSpec): number {
  const values = spec.options ? Math.max(1, ...spec.options.map((o) => (Array.isArray(o.value) ? o.value.length : 1))) : 0;
  return 2 + values + Math.max(0, ...(spec.operands ?? []).map((a) => a.pattern.length));
}

/** The roles of a reading, by word, at every level (the words of a subcommand, of a command run). */
export function allRoles(parse: ArgvParse, out = new Map<number, ArgRole>()): Map<number, ArgRole> {
  for (const { word, role } of parse.roles) {
    out.set(word, role);
    if (role.role === 'subcommand' || (role.role === 'command' && role.parse)) allRoles(role.parse!, out);
  }
  return out;
}

/**
 * The specs a reading of `line` may visit: `spec`, the specs its known words name as a command (`lookup`, and the
 * program of a builtin's name), also as words of a string a value splices in (`env -S`), and the subcommands they name
 * under a spec already taken. A reading enters a spec only through a known word.
 */
export function specsReached(spec: CommandSpec, line: readonly ArgWord[], ctx: InterpretContext): Set<CommandSpec> {
  const names = line.flatMap((w) => {
    if (w.value === undefined) return [];
    const split = splitEnvString(w.value);
    return [w.value, ...('words' in split ? split.words.flatMap((x) => (x.value === undefined ? [] : [x.value])) : [])];
  });
  const out = new Set<CommandSpec>([spec]);
  for (const name of names) {
    const found = ctx.lookup?.(name);
    if (found) out.add(found).add(found.program ?? found);
  }
  for (const s of out) for (const name of names) out.add(subcommand(s, name)?.[1] ?? s);
  return out;
}

/**
 * The runs of the line, in order (`Run`, without its counts). The words of a group of `fieldLine` (`grouped`: the words
 * of a word of a known number of words, `"$x"{a,b}`, of no known text) are no part of one: they are that word's.
 */
function runsOf(line: readonly ArgWord[], grouped: ReadonlySet<number>): { words: number[]; prefix?: string; each?: true }[] {
  const runs: { words: number[]; prefix?: string; each?: true }[] = [];
  const unknownText = (j: number): boolean => !grouped.has(j) && line[j].value === undefined && !line[j].prefix;
  for (let i = 0; i < line.length; i++) {
    if (!unknownText(i)) {
      if (flexible(line[i])) runs.push({ words: [i], prefix: line[i].prefix, ...(line[i].prefixEach ? { each: true as const } : {}) });
      continue;
    }
    let j = i;
    while (j < line.length && unknownText(j)) j++;
    if (range(i, j).some((k) => flexible(line[k]))) runs.push({ words: range(i, j) });
    i = j - 1;
  }
  return runs;
}

/**
 * The count variables of the flexible words of the line (section 2.2): two words that are one unquoted expansion of the
 * same parameter (`ArgWord.param`), not one bash changes as it runs (`$RANDOM`), with the same count, share one, unless a
 * word between them may assign it or IFS (`ArgWord.assigns`). `words` are the command's words, `back` gives the command's
 * word of a word of the line.
 */
function variablesOf(line: readonly ArgWord[], words: readonly ArgWord[], back: (j: number) => number, bound: number, tails: ReadonlySet<number>): { variables: CountVariable[]; variableOf: (number | undefined)[] } {
  const variables: CountVariable[] = [];
  const variableOf: (number | undefined)[] = line.map(() => undefined);
  const lineOf = new Map<number, number[]>();
  line.forEach((w, j) => { if (flexible(w)) lineOf.set(back(j), [...lineOf.get(back(j)) ?? [], j]); });
  const last = new Map<string, number>();
  /** The variable of the word `j` of the line, tied or new; `part`: a part of a word that comes in several. */
  const variableAt = (j: number, part: boolean): void => {
    const { min, max } = line[j].count!;
    const param = line[j].param !== undefined && !BASH_VARIABLES[line[j].param!]?.dynamic ? line[j].param : undefined;
    const tied = param === undefined ? undefined : last.get(param);
    if (tied !== undefined && variables[tied].min === min && variables[tied].max === max) {
      variables[tied].words.push(j);
      variableOf[j] = tied;
      return;
    }
    variableOf[j] = variables.length;
    if (param !== undefined) last.set(param, variables.length);
    const base = tails.has(j) ? 0 : Math.max(min, 1);
    variables.push({ words: [j], min, ...(max !== undefined ? { max } : {}), top: Math.min(min + bound, max ?? Infinity), base, ...(part ? { part: true as const } : {}) });
  };
  words.forEach((w, k) => {
    for (const name of w.assigns ?? []) {
      if (name === '*' || name === 'IFS') last.clear();
      else last.delete(name);
    }
    for (const j of lineOf.get(k) ?? []) variableAt(j, !!w.parts);
  });
  return { variables, variableOf };
}

/**
 * The passes of a word in a run (section 2.4): its run, its own variable (-1 for a word of a known count) and its own
 * counts (from one), and what the words before it and after it in the run give but its own variable's (`ties`: how
 * many of these are its own), with their tops.
 */
interface Pass { run: number; own: number; counts: number[]; before: Part; after: Part }
interface Part { mult: Map<number, number>; fixed: number; ties: number; top: number }

/**
 * The contexts of the words (section 2.4) and the shapes of the line (section 2.1). A word outside a run reads every run
 * capped; a word in a run reads the words before it and after it in its run and the other runs, each without its own
 * variable's words and capped, and its own counts from one. Each set of contexts is gathered by a pass over the count
 * variables that keeps the distinct tuples, never by their product. The shapes are the union of the shapes of every
 * context and own count; undefined when a pass or the union holds more than `cap`.
 */
function contextsOf(runs: readonly Run[], variables: readonly CountVariable[], variableOf: readonly (number | undefined)[], fixedOf: (j: number) => number, bound: number, cap: number) {
  const domain = (v: number, from = variables[v].min): number[] => range(from, variables[v].top + 1);
  /** The distinct tuples from `start` with the count of each variable but `skip` added by `add`. */
  const pass = (start: number[], add: (s: number[], v: number, x: number) => number[], skip?: number): number[][] | undefined => {
    let states = new Map([[start.join(), start]]);
    for (let v = 0; v < variables.length; v++) {
      if (v === skip) continue;
      const next = new Map<string, number[]>();
      for (const s of states.values()) for (const x of domain(v)) { const t = add(s, v, x); next.set(t.join(), t); }
      if (next.size > cap) return undefined;
      states = next;
    }
    return [...states.values()];
  };
  /** Sums of runs (all of them, or all but `skip`: `of` gives the run of each place) with `x` words of variable `v` more, each capped at its top. */
  const capped = (s: readonly number[], v: number, x: number, of = (i: number): Run => runs[i]): number[] => s.map((n, i) => Math.min(n + (of(i).mult.get(v) ?? 0) * x, of(i).top));
  const all = pass(runs.map((r) => r.fixed), capped);
  if (!all) return undefined;
  const passes = new Map<number, { pass: Pass; contexts: number[][] }>();
  for (const [r, run] of runs.entries()) {
    const others = runs.filter((_, i) => i !== r);
    for (const [p, w] of run.words.entries()) {
      const own = variableOf[w] ?? -1;
      const part = (ws: number[]): Part => {
        const mult = new Map<number, number>();
        let [fixed, fewest, ties] = [0, 0, 0];
        for (const j of ws) {
          const v = variableOf[j];
          if (v === undefined) fixed += fixedOf(j);
          else if (v === own) ties++;
          else {
            mult.set(v, (mult.get(v) ?? 0) + 1);
            fewest += variables[v].min;
          }
        }
        return { mult, fixed, ties, top: fixed + fewest + bound };
      };
      const [before, after] = [part(run.words.slice(0, p)), part(run.words.slice(p + 1))];
      const step = (s: number[], v: number, x: number): number[] => [
        Math.min(s[0] + (before.mult.get(v) ?? 0) * x, before.top), Math.min(s[1] + (after.mult.get(v) ?? 0) * x, after.top), ...capped(s.slice(2), v, x, (i) => others[i]),
      ];
      const contexts = pass([before.fixed, after.fixed, ...others.map((x) => x.fixed)], step, own);
      if (!contexts) return undefined;
      const counts = own < 0 ? [fixedOf(w)] : domain(own, Math.max(1, variables[own].min));
      passes.set(w, { pass: { run: r, own, counts, before, after }, contexts });
    }
  }
  /** The sums of the runs of a context of a word in a run (`Pass`), with its own count `c`. */
  const shapeOf = ({ run, own, before, after }: Pass, context: readonly number[], c: number): number[] => {
    const others = capped(context.slice(2), own, c, (i) => runs[i < run ? i : i + 1]);
    return [...others.slice(0, run), context[0] + context[1] + (1 + before.ties + after.ties) * c, ...others.slice(run)];
  };
  const shapes = new Map(all.map((shape) => [shape.join(), shape]));
  for (const { pass: x, contexts } of passes.values()) {
    for (const context of contexts) {
      for (const c of x.counts) {
        const shape = shapeOf(x, context, c);
        if (shapes.set(shape.join(), shape).size > cap) return undefined;
      }
    }
  }
  return { all, passes, shapeOf, shapes: [...shapes.values()].sort((x, y) => x.reduce((d, n, i) => d || n - y[i], 0)) };
}

/** How a reading ends (`Outcome`), at every level of it: in the parses of the commands it runs, and of a string a value splices in. */
export function outcomeOf(parse: ArgvParse): Outcome {
  let [refused, unknown] = [false, false];
  const visit = (q: ArgvParse): void => {
    unknown ||= !!q.gaveUp;
    refused ||= q.unmatched.length > 0;
    for (const { role } of q.roles) look(role);
  };
  const look = (r: ArgRole): void => {
    refused ||= (r.role === 'option' && (!!r.missing || !!r.spec.refused)) || (r.role === 'unknown-option' && !!r.refused);
    if (r.role === 'cluster') r.letters.forEach(look);
    // (`env -S'tar -cf'`: the words of the string, and the command they start.)
    for (const { role } of (r.role === 'value' ? r : r.role === 'option' ? r.value : undefined)?.split?.roles ?? []) look(role);
    if ((r.role === 'subcommand' || r.role === 'command') && r.parse) visit(r.parse);
  };
  visit(parse);
  return unknown ? 'unknown' : refused ? 'refused' : 'read';
}

/** The roles of the words of a group (`regroup`'s `inner`), at every level, by their number in it. */
function groupRoles(roles: readonly RoleAt[], out: ArgRole[] = []): ArgRole[] {
  for (const { word, role } of roles) {
    out[word] = role;
    if ((role.role === 'subcommand' || role.role === 'command') && role.parse) groupRoles(role.parse.roles, out);
  }
  return out;
}

/**
 * The table of readings of the words of a command (its arguments, without the name) with its spec, as `interpret`
 * reads them: the line with the fields the model knows in place, its runs and count variables, the bound S, the shapes
 * and a reading of each, read when asked.
 */
export function readingsOf(spec: CommandSpec, words: readonly ArgWord[], ctx: InterpretContext, cap = SHAPE_CAP): ReadingsTable {
  const { line: fielded, groups, own } = fieldLine(words, 'exact');
  // (A word whose words come in parts, `ArgWord.parts`, is a word of the line for each: those after the first of a word
  // of its brace expansion, the words splitting adds, give none as written.)
  const line: ArgWord[] = [];
  const of: number[] = [];
  const tails = new Set<number>();
  fielded.forEach((w, j) => (w.parts ?? [w]).forEach((p) => {
    if (w.parts && !p.prefix) tails.add(line.length);
    of.push(j);
    line.push(p);
  }));
  const fieldBack = lineIndex(groups);
  const back = (j: number): number => fieldBack(of[j]);
  const specs = specsReached(spec, line, ctx);
  const bound = Math.max(...[...specs].map(wordsBound));
  const { variables, variableOf } = variablesOf(line, words, back, bound, tails);
  const fixedOf = (j: number): number => line[j].count?.min ?? 1;
  const grouped = new Set(line.flatMap((_, j) => (groups.some((g) => of[j] >= g.from && of[j] < g.from + g.n) ? [j] : [])));
  const runs: Run[] = runsOf(line, grouped).map(({ words: ws, prefix, each }) => {
    const mult = new Map<number, number>();
    let fixed = 0;
    for (const j of ws) {
      const v = variableOf[j];
      if (v === undefined) fixed += fixedOf(j);
      else mult.set(v, (mult.get(v) ?? 0) + 1);
    }
    const fewest = fixed + [...mult].reduce((n, [v, m]) => n + m * variables[v].min, 0);
    return { words: ws, ...(prefix ? { prefix } : {}), ...(each ? { each } : {}), fixed, mult, fewest, top: fewest + bound };
  });
  const firstOf = new Map(runs.map((r, i) => [r.words[0], i]));
  const inRun = new Set(runs.flatMap((r) => r.words));
  const readings = new Map<string, Reading>();
  const roleMaps = new WeakMap<Reading, Map<number, ArgRole>>();
  /** The roles of a reading's words, at every level (each reading's once). */
  const rolesOf = (r: Reading): Map<number, ArgRole> => {
    if (!roleMaps.has(r)) roleMaps.set(r, allRoles(r.parse));
    return roleMaps.get(r)!;
  };
  const reading = (sums: readonly number[]): Reading => {
    const key = sums.join();
    const seen = readings.get(key);
    if (seen) return seen;
    const written: ArgWord[] = [];
    line.forEach((w, j) => {
      const r = firstOf.get(j);
      if (r !== undefined) for (let i = 0; i < sums[r]; i++) written.push((i === 0 || runs[r].each) && runs[r].prefix ? { prefix: runs[r].prefix } : {});
      else if (!inRun.has(j)) written.push(w);
    });
    const parse = readWritten(spec, written, ctx);
    const out: Reading = { outcome: outcomeOf(parse), words: written, parse };
    readings.set(key, out);
    return out;
  };
  /**
   * Where each command's word stands in the line: its words there (`lines`), and its fields (a group of `fieldLine`), or
   * the one word of the line it is (`at`; none for a word that comes in parts).
   */
  const spans = words.map((): { group?: Group; at?: number; lines: number[] } => ({ lines: [] }));
  for (const g of groups) spans[g.word].group = g;
  line.forEach((_, j) => spans[back(j)].lines.push(j));
  for (const s of spans) if (!s.group && s.lines.length === 1) s.at = s.lines[0];
  const at = (counts: readonly number[]): WordsAt => {
    const n = line.map((_, j) => (variableOf[j] !== undefined ? counts[variableOf[j]!] : inRun.has(j) ? fixedOf(j) : 1));
    const r = reading(runs.map((run) => run.words.reduce((s, j) => s + n[j], 0)));
    const written: Group[] = [];
    let from = 0;
    for (const [k, { group, lines }] of spans.entries()) {
      const size = group ? group.n : lines.reduce((x, j) => x + n[j], 0);
      if (group || size !== 1) written.push({ from, n: size, word: k, shift: size - 1, words: group?.words ?? Array.from({ length: size }, (): ArgWord => ({})) });
      from += size;
    }
    const { parse: regrouped, inner } = regroup(r.parse, written);
    const parse = own.size ? optionFields(regrouped, own, words) : regrouped;
    const roles = allRoles(parse);
    const fields = words.map((_, k) => {
      const g = written.findIndex((x) => x.word === k);
      return g < 0 ? [roles.get(k)!] : groupRoles(inner[g]);
    });
    return { outcome: r.outcome, parse, fields };
  };
  const base = variables.map((v) => v.base);
  const hedged = (): number[] => {
    if (!variables.length) return [];
    const first = Math.min(...variables.map((v) => back(v.words[0])));
    const roles = allRoles(at(base).parse);
    const operand = (r: ArgRole): boolean => r.role === 'operand' || r.role === 'fields' || (r.role === 'command' && !!r.item);
    return range(0, words.length).filter((k) => k >= first || operand(roles.get(k)!));
  };
  // (Nothing is read where a glob may give `--` or `-` past its first word, `ArgWord.dashes`: the words after it may be
  // operands or not, whatever the counts.)
  const found = line.some((w) => w.dashes) ? undefined : contextsOf(runs, variables, variableOf, fixedOf, bound, cap);
  /** Where the word `j` of the line starts in the reading of `sums`. */
  const placeOf = (j: number, sums: readonly number[]): number => {
    let at = 0;
    for (let i = 0; i < j; i++) at += firstOf.has(i) ? sums[firstOf.get(i)!] : inRun.has(i) ? 0 : 1;
    return at;
  };
  /** A coordinate summing `ws` but the words of the variable `own`, capped at `top`. */
  const coordinate = (ws: readonly number[], own: number, top: number): Coordinate => {
    const mult = new Map<number, number>();
    let fixed = 0;
    const kept = ws.filter((j) => variableOf[j] !== own);
    for (const j of kept) {
      const v = variableOf[j];
      if (v === undefined) fixed += fixedOf(j);
      else mult.set(v, (mult.get(v) ?? 0) + 1);
    }
    return { words: kept, fixed, mult, top };
  };
  const parted = spans.map((x) => !x.group && x.lines.length > 1);
  const contexts = (k: number): Contexts | undefined => {
    // (A word in parts has no own count: the hedges of step 4 say only that its role may depend on the counts.)
    if (!found || parted[k]) return undefined;
    const x = spans[k].at === undefined ? undefined : found.passes.get(spans[k].at!);
    const coordinates = x
      ? [
        coordinate(runs[x.pass.run].words.filter((j) => j < spans[k].at!), x.pass.own, x.pass.before.top),
        coordinate(runs[x.pass.run].words.filter((j) => j > spans[k].at!), x.pass.own, x.pass.after.top),
        ...runs.filter((_, i) => i !== x.pass.run).map((r) => coordinate(r.words, x.pass.own, r.top)),
      ]
      : runs.map((r) => coordinate(r.words, -1, r.top));
    const at = coordinates.map((p) => Math.min(p.fixed + [...p.mult].reduce((n, [v, m]) => n + m * base[v], 0), p.top));
    return x ? { run: x.pass.run, contexts: x.contexts, own: x.pass.counts, coordinates, base: at } : { contexts: found.all, own: [spans[k].group?.n ?? 1], coordinates, base: at };
  };
  const readAt = (k: number, context: readonly number[], c: number): WordAt => {
    const x = spans[k].at === undefined ? undefined : found!.passes.get(spans[k].at!);
    const sums = x ? found!.shapeOf(x.pass, context, c) : [...context];
    const r = reading(sums);
    // (In its run, its words come after those of the words before it: theirs, and its own variable's.)
    const from = x ? placeOf(runs[x.pass.run].words[0], sums) + context[0] + x.pass.before.ties * c : placeOf(spans[k].lines[0], sums);
    const roles = rolesOf(r);
    const places = range(from, from + c);
    const owners: (number | undefined)[] = [];
    const own = (ws: readonly number[], n: number): void => { for (let i = 0; i < n; i++) owners.push(ws.length === 1 ? back(ws[0]) : undefined); };
    line.forEach((_, j) => {
      const ri = firstOf.get(j);
      if (ri === undefined) {
        if (!inRun.has(j)) owners.push(back(j));
      } else if (x?.pass.run === ri) {
        const before = context[0] + x.pass.before.ties * c;
        own(runs[ri].words.filter((w) => w < spans[k].at!), before);
        own([spans[k].at!], c);
        own(runs[ri].words.filter((w) => w > spans[k].at!), sums[ri] - before - c);
      } else own(runs[ri].words, sums[ri]);
    });
    return { sums, outcome: r.outcome, fields: places.map((i) => roles.get(i)!), places, owners };
  };
  const variableAt = words.map((_, k) => (spans[k].at === undefined ? undefined : variableOf[spans[k].at!]));
  return { line, back, runs, variables, variableOf, variableAt, parted, bound, specs, base, shapes: found?.shapes, reading, at, hedged, contexts, readAt };
}
