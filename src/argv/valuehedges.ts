// The readings of the words after an option's value that may give none or several words (`ArgRole` `none` and
// `more`, `ValueRole` `rest`): the line read again without the value, or with each number of words it may give, up to
// the number past which the spec reads the same (src/argv/interpret.ts, `interpret`).
import type { ArgRole, ArgvParse, ArgWord, MoreRole, NoneRole, ThenRole } from './interpret';
import type { CommandSpec, OperandSpec } from './spec';

/**
 * The most words a value need be read with (`valueHedges`): past it, the words after its first fill the most values an
 * option of `spec` takes (two: `jq --arg NAME VALUE`) and the longest pattern of its operands, and one more, so every
 * word of the line after it is past them all, and reads the same for any more (a repeated item, an extra operand, an
 * argument of the command it runs).
 */
export function mostWords(spec: CommandSpec): number {
  // (A spec that reads a value has options.)
  const values = Math.max(1, ...spec.options!.map((o) => (Array.isArray(o.value) ? o.value.length : 1)));
  return 2 + values + Math.max(0, ...(spec.operands ?? []).map((a) => a.pattern.length));
}

/** The roles in `lists`, each once (as `thenRoles` keys them); undefined where one of them is (no hedge names it). */
function union(lists: (ThenRole[] | undefined)[]): ThenRole[] | undefined {
  if (lists.some((l) => !l)) return undefined;
  const all = lists.flat() as ThenRole[];
  return all.filter((r, j) => all.findIndex((x) => keyOf(x) === keyOf(r)) === j);
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
 * `more`): with `$d` empty, `git -C $d log` changes to the directory `log`, and `sudo -u $u ls` runs nothing as the user
 * `ls`. Not an operand's, which says it in its `readings` (src/argv/profiles.ts).
 */
const HEDGED = new Set<ArgRole['role']>(['value', 'option', 'cluster', 'unknown-option', 'pattern-option', 'end-of-options', 'subcommand', 'command']);
type Hedged = Extract<ArgRole, { none?: NoneRole[] }>;

/**
 * The roles a word may take in a reading, as a hedge names them: an operand's, a value's, the operand a command run
 * fills; undefined for a role no hedge names (an option, a subcommand…). (Of a word that may give several, the role of
 * its first word: `MoreRole.first`.)
 */
export function thenRoles(role: ArgRole): ThenRole[] | undefined {
  if (role.role === 'value') return [{ value: role }];
  if (role.role === 'command') return role.item ? [{ spec: role.item }] : undefined;
  if (role.role !== 'operand') return undefined;
  return [role.spec ? { spec: role.spec } : {}];
}

/** What tells two roles a hedge names apart: an operand's text without its parentheses, an option's value, or neither. */
const keyOf = (r: ThenRole): string => (r.spec ? roleText(r.spec) : r.value ? `\0${r.value.of}\0${r.value.index}` : '\0');

/** Whether a word may give more than one word (`*.txt`, `"$@"`; no `max`: any number): a role it takes then is its first word's. */
export const mayGiveSeveral = (w: ArgWord): boolean => !!w.count && !(w.count.max! <= 1);

/**
 * The roles the words after an option's value take when the value, a word of its own that may give none (`count.min`
 * 0), gives none, where they differ (`ArgRole` `none`): with `$a` empty, `tar -cf $a b` is `tar -cf b`, and `b` the
 * archive. Read when first asked, each value once: the line again without it (`without`, in the numbers of `line` but
 * the word left out), the words between giving what they give. The words read are those of the value's command whose
 * roles are `HEDGED`; the role they then take, an operand's or a value's (else nothing is said).
 */
export function valueHedges(parse: ArgvParse, spec: CommandSpec, line: ArgWord[], without: (j: number) => ArgvParse, spread: (j: number, c: number) => ArgvParse, back: (j: number) => number): void {
  const readings = new Map<number, Map<number, ArgRole>>();
  const alt = (j: number): Map<number, ArgRole> => {
    if (!readings.has(j)) readings.set(j, allRoles(without(j)));
    return readings.get(j)!;
  };
  const spreads = new Map<number, Map<number, ArgRole>[]>();
  const most = new Map<number, number>();
  /**
   * The roles of the readings where the value j gives 2, 3… words, up to `most` (`mostWords` of its command; its own
   * most, where fewer), by word of each reading (the words of the line after it `c - 1` places on).
   */
  const wide = (j: number): Map<number, ArgRole>[] => {
    if (!spreads.has(j)) spreads.set(j, Array.from({ length: Math.min(most.get(j)!, line[j].count!.max ?? Infinity) - 1 }, (_, n) => allRoles(spread(j, n + 2))));
    return spreads.get(j)!;
  };
  /** A role of each reading (`at`: the word of that reading, for `c` words of the value), as a hedge names it. */
  const rolesIn = (j: number, at: (c: number) => number[]): { roles: ThenRole[] | undefined; same: (role: ArgRole) => boolean } => {
    const found = wide(j).flatMap((r, n) => at(n + 2).map((i) => r.get(i)!));
    return { roles: union(found.map(thenRoles)), same: (role) => found.every((r) => sameRole(role, r)) };
  };
  /** The roles word k may take where the value j gives several words, when they differ from its role `role`. */
  const moreOf = (role: ArgRole, k: number, j: number): MoreRole | undefined => {
    const { roles, same } = rolesIn(j, (c) => [k + c - 1]);
    // (The same one role as here: `sudo -u $u ls`, `ls` is the command either way.)
    if (!roles || (roles.length === 1 && same(role))) return undefined;
    return { word: back(j), roles, ...(mayGiveSeveral(line[k]) ? { first: true as const } : {}) };
  };
  const lazy = <T>(role: object, key: string, read: () => T | undefined): void => {
    let memo: T | undefined | null = null;
    Object.defineProperty(role, key, { enumerable: true, configurable: true, get: () => (memo === null ? (memo = read()) : memo) });
  };
  const hedge = (role: Hedged, k: number, drops: number[]): void => {
    lazy(role, 'none', () => {
      const more = drops.flatMap((j): NoneRole[] => {
        const then = alt(j).get(k - 1);
        /* c8 ignore next -- every word has a role in a reading (a guard against a bug in it) */
        if (!then) return [];
        if (sameRole(role, then)) return [];
        const first = mayGiveSeveral(line[k]) ? { first: true as const } : {};
        if (then.role === 'operand' && then.spec) return [{ words: [back(j)], spec: then.spec, ...first }];
        return then.role === 'value' ? [{ words: [back(j)], value: then, ...first }] : [];
      });
      return more.length ? more : undefined;
    });
  };
  const visit = (q: ArgvParse, of: CommandSpec | undefined): void => {
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
        // (A value is read only by a spec, which says what takes one.)
        most.set(word, mostWords(of!));
        // (The words after its first, for each count. Where one of them may be an argument the spec does not describe, the
        // words after it, as the text says: `tar -cf $a b`.)
        lazy(role, 'rest', () => {
          const rest = rolesIn(word, (c) => Array.from({ length: c - 1 }, (_, n) => word + 1 + n)).roles;
          return rest?.every((r) => r.spec || r.value) ? rest : [];
        });
      }
      if (role.role === 'subcommand' || (role.role === 'command' && role.parse)) visit(role.parse!, role.spec);
    }
  };
  visit(parse, spec);
}
