// The readings of the words after an option's value that may give none or several words (`ArgRole` `none` and
// `more`, `ValueRole` `rest`): the line read again without the value, or with the value as its first word and a word
// that gives the rest (src/argv/interpret.ts, `interpret`).
import type { ArgRole, ArgvParse, ArgWord, MoreRole, NoneRole, ThenRole } from './interpret';
import type { OperandSpec } from './spec';

/** The words after the first of a word that gives several: one or more, one fewer than it at most, their text not known. */
export const restOf = (w: ArgWord): ArgWord => ({ count: { min: 1, ...(w.count!.max === undefined ? {} : { max: w.count!.max - 1 }) } });

/** The roles of a reading, by word, at every level (the words of a subcommand, of a command run). */
export function allRoles(parse: ArgvParse, out = new Map<number, ArgRole>()): Map<number, ArgRole> {
  for (const { word, role } of parse.roles) {
    out.set(word, role);
    if (role.role === 'subcommand' || (role.role === 'command' && role.parse)) allRoles(role.parse!, out);
  }
  return out;
}

/**
 * An operand's role, without what is said of it in parentheses: the same role in another form, with more said of it, is
 * not another (`ln -s $a $b`: `$a` is the target either way, "target (the link is made in the current directory…)" when
 * `$b` gives none).
 */
export const roleText = (o: OperandSpec): string => o.text.en.replace(/ \(.*\)$/, '');

/** Whether two roles of a word say the same: the same option or letters, the value of the same option, the same operand. */
export function sameRole(a: ArgRole, b: ArgRole): boolean {
  const flags = (r: ArgRole): string => (r.role === 'cluster' ? r.letters.map(flags).join(' ') : (r as { flag: string }).flag);
  if (a.role === 'operand' && b.role === 'operand') return (a.spec && roleText(a.spec)) === (b.spec && roleText(b.spec));
  if (a.role === 'value' && b.role === 'value') return a.of === b.of && a.index === b.index;
  return a.role === b.role && flags(a) === flags(b);
}

/**
 * The roles of a word that say what it takes when an option's value before it gives none or several (`ArgRole` `none`,
 * `more`): with `$d` empty, `git -C $d log` changes to the directory `log`, and `sudo -u $u ls` runs nothing as the user `ls`.
 */
const HEDGED = new Set<ArgRole['role']>(['operand', 'value', 'option', 'cluster', 'unknown-option', 'pattern-option', 'end-of-options', 'subcommand', 'command']);
type Hedged = Extract<ArgRole, { none?: NoneRole[] }>;

/**
 * The roles a word may take in a reading, as a hedge names them: an operand's and those of its hedges, a value's, the
 * operand a command run fills; undefined for a role no hedge names (an option, a subcommand…),
 * and for a value or a command name that may give several words (the words after its first are read otherwise: `rest`
 * of the reading where it does, which this one has not read).
 */
export function thenRoles(role: ArgRole, word: ArgWord): ThenRole[] | undefined {
  if (role.role === 'value') return mayGiveSeveral(word) ? undefined : [{ value: role }];
  if (role.role === 'command') return role.item && !mayGiveSeveral(word) ? [{ spec: role.item }] : undefined;
  if (role.role !== 'operand') return undefined;
  if (!role.spec) return [{}];
  const specs = [role.spec, ...(role.otherwise ? [role.otherwise] : []), ...(role.several ?? []).flatMap((r) => r.roles), ...(role.byCount?.readings ?? []).map((r) => r.spec), ...role.mixed?.roles ?? []];
  const all: ThenRole[] = [...specs.map((spec) => ({ spec })), ...(role.none ?? []).map((r): ThenRole => (r.spec ? { spec: r.spec } : { value: r.value! }))];
  const key = (r: ThenRole): string => (r.spec ? roleText(r.spec) : `\0${r.value!.of}\0${r.value!.index}`);
  return all.filter((r, j) => all.findIndex((x) => key(x) === key(r)) === j);
}

/** Whether a word may give more than one word (`*.txt`, `"$@"`; no `max`: any number): a role it takes then is its first word's. */
export const mayGiveSeveral = (w: ArgWord): boolean => !!w.count && !(w.count.max! <= 1);

/**
 * The roles the words after an option's value take when the value, a word of its own that may give none (`count.min`
 * 0), gives none, where they differ (`ArgRole` `none`): with `$a` empty, `tar -cf $a b` is `tar -cf b`, and `b` the
 * archive. Read when first asked, each value once: the line again without it (`without`, in the numbers of `line` but
 * the word left out), the words between giving what they give. The words read are those of the value's command whose
 * roles are `HEDGED`; the role they then take, an operand's or a value's (else nothing is said).
 */
export function valueHedges(parse: ArgvParse, line: ArgWord[], without: (j: number) => ArgvParse, spread: (j: number) => ArgvParse, back: (j: number) => number): void {
  const readings = new Map<number, Map<number, ArgRole>>();
  const alt = (j: number): Map<number, ArgRole> => {
    if (!readings.has(j)) readings.set(j, allRoles(without(j)));
    return readings.get(j)!;
  };
  const spreads = new Map<number, Map<number, ArgRole>>();
  /** The roles of the reading where the value j gives several words, by word of `line` (the rest of word j at j + 1). */
  const wide = (j: number): Map<number, ArgRole> => {
    if (!spreads.has(j)) spreads.set(j, allRoles(spread(j)));
    return spreads.get(j)!;
  };
  /** The roles word k may take where the value j gives several words, when they differ from its role `role`. */
  const moreOf = (role: ArgRole, k: number, j: number): MoreRole | undefined => {
    const then = wide(j).get(k + 1);
    /* c8 ignore next -- every word has a role in a reading (a guard against a bug in it) */
    if (!then) return undefined;
    const roles = thenRoles(then, line[k]);
    // (The same one role as here, where nothing here depends on counts: `head -n $a f`, `f` is a file either way.)
    const counted = role.role === 'operand' && !!(role.otherwise || role.several || role.byCount || role.mixed);
    if (!roles || (roles.length === 1 && sameRole(role, then) && !counted)) return undefined;
    return { word: back(j), roles, ...(mayGiveSeveral(line[k]) ? { first: true as const } : {}) };
  };
  const lazy = <T>(role: object, key: string, read: () => T | undefined): void => {
    let memo: T | undefined | null = null;
    Object.defineProperty(role, key, { enumerable: true, configurable: true, get: () => (memo === null ? (memo = read()) : memo) });
  };
  const hedge = (role: Hedged, k: number, drops: number[]): void => {
    // (Its own, read when asked: an operand's, a getter of `withHedge`.)
    const own = Object.getOwnPropertyDescriptor(role, 'none');
    let memo: NoneRole[] | undefined | null = null;
    const read = (): NoneRole[] | undefined => {
      const more = drops.flatMap((j): NoneRole[] => {
        const then = alt(j).get(k - 1);
        /* c8 ignore next -- every word has a role in a reading (a guard against a bug in it) */
        if (!then) return [];
        if (sameRole(role, then)) return [];
        const first = mayGiveSeveral(line[k]) ? { first: true as const } : {};
        if (then.role === 'operand' && then.spec) return [{ words: [back(j)], spec: then.spec, ...first }];
        return then.role === 'value' ? [{ words: [back(j)], value: then, ...first }] : [];
      });
      const mine = own?.get?.call(role) as NoneRole[] | undefined;
      return mine || more.length ? [...mine ?? [], ...more] : undefined;
    };
    Object.defineProperty(role, 'none', { enumerable: true, configurable: true, get: () => (memo === null ? (memo = read()) : memo) });
  };
  const visit = (q: ArgvParse): void => {
    const drops: number[] = [];
    const wides: number[] = [];
    for (const { word, role } of q.roles) {
      if (drops.length && HEDGED.has(role.role)) hedge(role as Hedged, word, [...drops]);
      if (wides.length && HEDGED.has(role.role)) {
        const from = [...wides];
        lazy(role, 'more', () => {
          const more = from.flatMap((j) => moreOf(role, word, j) ?? []);
          return more.length ? more : undefined;
        });
      }
      if (role.role === 'value' && role.attached === undefined && line[word].count?.min === 0) drops.push(word);
      if (role.role === 'value' && role.attached === undefined && mayGiveSeveral(line[word])) {
        wides.push(word);
        // (Where one of the others may be an argument the spec does not describe, the words after it, as the text says:
        // `tar -cf $a b`.)
        lazy(role, 'rest', () => {
          const rest = thenRoles(wide(word).get(word + 1)!, restOf(line[word]));
          return rest?.every((r) => r.spec || r.value) ? rest : [];
        });
      }
      if (role.role === 'subcommand' || (role.role === 'command' && role.parse)) visit(role.parse!);
    }
  };
  visit(parse);
}
