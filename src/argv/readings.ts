// The readings of a command's words for every count of its words that may give other than one word
// (docs/design/count-hedges.md, section 2): the runs of words of unknown text, the count variables (tied where two words
// are one parameter), the coordinates and their domains up to the bound S, the shapes read (the sums of the runs, at real
// sums inside a run and capped elsewhere, at most `SHAPE_CAP`), and one reading of the whole line per shape, with the
// roles given back to the command's words. Nothing reads it yet: the hedges are built on it in the later steps.
import { BASH_VARIABLES } from '../semantics/vars';
import { splitEnvString } from './envsplit';
import { type ArgRole, type ArgvParse, type ArgWord, fieldLine, type InterpretContext, readWritten, subcommand } from './interpret';
import { type Group, lineIndex, optionFields, regroup } from './regroup';
import type { CommandSpec } from './spec';
import { allRoles, mostWords } from './valuehedges';

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
}

/**
 * Words in a row of no known text with at least one flexible word, or one flexible word with a known start (`x$a`,
 * whose first word keeps it: `prefix`). The line written out depends only on how many words they give in all.
 */
export interface Run {
  /** Its words, indexes in the line. */
  words: number[];
  prefix?: string;
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
  /** The shapes read, each the sum of each run, in order; undefined past `SHAPE_CAP`. */
  shapes: number[][] | undefined;
  /** The reading of a shape (each read once). */
  reading: (sums: readonly number[]) => Reading;
  /** The roles of the command's words where each count variable gives `counts[v]` words. */
  at: (counts: readonly number[]) => WordsAt;
  /**
   * The command's words whose role may depend on the counts, as told without reading other shapes (section 2.8): every
   * word from the first flexible one on, and the words before it that are operands as written.
   */
  hedged: () => number[];
}

/** Whether a word may give other than one word, and not an exact number of them (section 2.1). */
const flexible = (w: ArgWord): boolean => !!w.count && w.count.min !== w.count.max;
/** Whether nothing is known of a word's text. */
const unknownText = (w: ArgWord): boolean => w.value === undefined && !w.prefix;
const range = (from: number, to: number): number[] => Array.from({ length: to - from }, (_, k) => from + k);

/** S of one spec: `mostWords`, or for a spec without options two and its longest pattern. */
export const wordsBound = (spec: CommandSpec): number => (spec.options ? mostWords(spec) : 2 + Math.max(0, ...(spec.operands ?? []).map((a) => a.pattern.length)));

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

/** The runs of the line, in order (`Run`, without its counts). */
function runsOf(line: readonly ArgWord[]): { words: number[]; prefix?: string }[] {
  const runs: { words: number[]; prefix?: string }[] = [];
  for (let i = 0; i < line.length; i++) {
    if (!unknownText(line[i])) {
      if (flexible(line[i])) runs.push({ words: [i], prefix: line[i].prefix });
      continue;
    }
    let j = i;
    while (j < line.length && unknownText(line[j])) j++;
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
function variablesOf(line: readonly ArgWord[], words: readonly ArgWord[], back: (j: number) => number, bound: number): { variables: CountVariable[]; variableOf: (number | undefined)[] } {
  const variables: CountVariable[] = [];
  const variableOf: (number | undefined)[] = line.map(() => undefined);
  const lineOf = new Map<number, number>();
  line.forEach((w, j) => { if (flexible(w)) lineOf.set(back(j), j); });
  const last = new Map<string, number>();
  words.forEach((w, k) => {
    for (const name of w.assigns ?? []) {
      if (name === '*' || name === 'IFS') last.clear();
      else last.delete(name);
    }
    const j = lineOf.get(k);
    if (j === undefined) return;
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
    variables.push({ words: [j], min, ...(max !== undefined ? { max } : {}), top: Math.min(min + bound, max ?? Infinity) });
  });
  return { variables, variableOf };
}

/**
 * The shapes of the line (section 2.1): the union, over each word of each run, of that run at its real sums (the words
 * before the word and after it, each capped, and its own counts from one) with the other runs at their capped sums, and
 * of every run capped. Gathered by passes over the count variables that keep the distinct tuples of sums, never as their
 * product; undefined when a pass or the union holds more than `cap`.
 */
function shapesOf(runs: readonly Run[], variables: readonly CountVariable[], variableOf: readonly (number | undefined)[], fixedOf: (j: number) => number, bound: number, cap: number): number[][] | undefined {
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
  /** The sums of the runs with `x` words of variable `v` more, each capped at its top. */
  const capped = (s: readonly number[], v: number, x: number, skip = -1): number[] => s.map((n, i) => (i === skip ? n : Math.min(n + (runs[i].mult.get(v) ?? 0) * x, runs[i].top)));
  const all = pass(runs.map((r) => r.fixed), capped);
  if (!all) return undefined;
  const shapes = new Map(all.map((shape) => [shape.join(), shape]));
  for (const [r, run] of runs.entries()) {
    for (const [p, w] of run.words.entries()) {
      const own = variableOf[w] ?? -1;
      /** The words before or after word p in its run: what they give but `own`'s words (`ties`), and their top. */
      const part = (ws: number[]) => {
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
      const [b, a] = [part(run.words.slice(0, p)), part(run.words.slice(p + 1))];
      const step = (s: number[], v: number, x: number): number[] => [Math.min(s[0] + (b.mult.get(v) ?? 0) * x, b.top), Math.min(s[1] + (a.mult.get(v) ?? 0) * x, a.top), ...capped(s.slice(2), v, x, r)];
      const states = pass([b.fixed, a.fixed, ...runs.map((x) => x.fixed)], step, own);
      if (!states) return undefined;
      const counts = own < 0 ? [fixedOf(w)].filter((n) => n > 0) : domain(own, Math.max(1, variables[own].min));
      for (const s of states) {
        for (const c of counts) {
          const shape = capped(s.slice(2), own, c);
          shape[r] = s[0] + s[1] + (1 + b.ties + a.ties) * c;
          if (shapes.set(shape.join(), shape).size > cap) return undefined;
        }
      }
    }
  }
  return [...shapes.values()].sort((x, y) => x.reduce((d, n, i) => d || n - y[i], 0));
}

/** How a reading ends (`Outcome`), at every level of it. */
function outcomeOf(parse: ArgvParse): Outcome {
  const missing = (r: ArgRole): boolean => (r.role === 'option' && !!r.missing) || (r.role === 'cluster' && r.letters.some(missing));
  let refused = false;
  const visit = (q: ArgvParse): boolean => {
    if (q.gaveUp) return true;
    refused ||= q.unmatched.length > 0 || q.roles.some(({ role }) => missing(role));
    return q.roles.some(({ role }) => (role.role === 'subcommand' || role.role === 'command') && !!role.parse && visit(role.parse));
  };
  return visit(parse) ? 'unknown' : refused ? 'refused' : 'read';
}

/** The roles of the words of a group (`regroup`'s `inner`), at every level, by their number in it. */
function groupRoles(roles: readonly { word: number; role: ArgRole }[], out: ArgRole[] = []): ArgRole[] {
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
export function readingsOf(spec: CommandSpec, words: readonly ArgWord[], ctx: InterpretContext = {}, cap = SHAPE_CAP): ReadingsTable {
  const { line, groups, own } = fieldLine(words);
  const back = lineIndex(groups);
  const specs = specsReached(spec, line, ctx);
  const bound = Math.max(...[...specs].map(wordsBound));
  const { variables, variableOf } = variablesOf(line, words, back, bound);
  const fixedOf = (j: number): number => line[j].count?.min ?? 1;
  const runs: Run[] = runsOf(line).map(({ words: ws, prefix }) => {
    const mult = new Map<number, number>();
    let fixed = 0;
    for (const j of ws) {
      const v = variableOf[j];
      if (v === undefined) fixed += fixedOf(j);
      else mult.set(v, (mult.get(v) ?? 0) + 1);
    }
    const fewest = fixed + [...mult].reduce((n, [v, m]) => n + m * variables[v].min, 0);
    return { words: ws, ...(prefix ? { prefix } : {}), fixed, mult, fewest, top: fewest + bound };
  });
  const firstOf = new Map(runs.map((r, i) => [r.words[0], i]));
  const inRun = new Set(runs.flatMap((r) => r.words));
  const readings = new Map<string, Reading>();
  const reading = (sums: readonly number[]): Reading => {
    const key = sums.join();
    const seen = readings.get(key);
    if (seen) return seen;
    const written: ArgWord[] = [];
    line.forEach((w, j) => {
      const r = firstOf.get(j);
      if (r !== undefined) for (let i = 0; i < sums[r]; i++) written.push(i === 0 && runs[r].prefix ? { prefix: runs[r].prefix } : {});
      else if (!inRun.has(j)) written.push(w);
    });
    const parse = readWritten(spec, written, ctx);
    const out: Reading = { outcome: outcomeOf(parse), words: written, parse };
    readings.set(key, out);
    return out;
  };
  /** Where each command's word stands in the line: its fields (a group of `fieldLine`), or one word of the line. */
  const spans = words.map((): { group?: Group; at?: number } => ({}));
  for (const g of groups) spans[g.word].group = g;
  line.forEach((_, j) => { if (!spans[back(j)].group) spans[back(j)].at = j; });
  const at = (counts: readonly number[]): WordsAt => {
    const n = line.map((_, j) => (variableOf[j] !== undefined ? counts[variableOf[j]!] : inRun.has(j) ? fixedOf(j) : 1));
    const r = reading(runs.map((run) => run.words.reduce((s, j) => s + n[j], 0)));
    const written: Group[] = [];
    let from = 0;
    for (const [k, { group, at: j }] of spans.entries()) {
      const size = group ? group.n : n[j!];
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
  const base = variables.map((v) => Math.max(v.min, 1));
  const hedged = (): number[] => {
    if (!variables.length) return [];
    const first = Math.min(...variables.map((v) => back(v.words[0])));
    const roles = allRoles(at(base).parse);
    const operand = (r: ArgRole): boolean => r.role === 'operand' || r.role === 'fields' || (r.role === 'command' && !!r.item);
    return range(0, words.length).filter((k) => k >= first || operand(roles.get(k)!));
  };
  const shapes = shapesOf(runs, variables, variableOf, fixedOf, bound, cap);
  return { line, back, runs, variables, variableOf, bound, specs, base, shapes, reading, at, hedged };
}
