// The hedges of an operand whose role depends on how many words the words that may give several give (`ArgRole`
// `operand`: `several`, `byCount`, `mixed`, `otherwise`), read from the readings of the operand patterns that the
// argument interpreter (src/argv/interpret.ts, `placeOperands`) makes with each count.
import type { ArgWord, NoneRole, OperandRole } from './interpret';
import type { OperandAlt, OperandSpec } from './spec';

/**
 * The roles, in order, of the words an operand becomes when it gives `from` words (or more: `orMore`),
 * with the other words of the command giving their fewest as `counts` reads them, one at least (`ArgRole` `operand`,
 * `several`; repeated roles once).
 */
export interface SeveralRoles { from: number; orMore?: boolean; roles: OperandSpec[] }

/**
 * The role `spec` of an operand when the word `word` (an index of the command's words) gives `from` words (or more),
 * the others their fewest (`ArgRole` `operand`, `byCount`; the first reading is that of its fewest).
 */
export interface ByCount { word: number; readings: { from: number; orMore?: boolean; spec: OperandSpec }[] }

/**
 * The roles the words of an operand may have when it or another of `words` (indexes of the command's words, the words
 * that may give several, in order) gives more than its fewest (`ArgRole` `operand`, `mixed`). `first`: when each gives
 * its fewest, the operand is one word of its own role (`spec`), not in `roles` unless another count gives it too. `many`:
 * the operand itself may give several.
 */
export interface MixedRoles { words: number[]; first: boolean; many: boolean; roles: OperandSpec[] }

/** The hedges of an operand (`ArgRole` `operand`): at most one of these. */
export type Hedge = { otherwise?: OperandSpec; by?: number; several?: SeveralRoles[]; byCount?: ByCount; mixed?: MixedRoles };

/**
 * The number of words a word gives: fewest (at least one, as the text shows it) and many. A word that may give none
 * (`count.min` 0) is read with one, and apart with none (`placeOperands`).
 */
export const counts = (w: ArgWord): [number, number] => {
  if (!w.count) return [1, 1];
  const low = Math.max(w.count.min, 1);
  return [low, w.count.max === w.count.min ? low : Math.min(w.count.max ?? Infinity, low + 2)];
};

/** A reading of the operands: the pattern that fits them, and the item of each place. */
export interface Fit { alt: OperandAlt; items: number[] }

/**
 * What the hedges are read from: the operand words (`operands`, their indexes among the command's words), the reading
 * where word j gives `many(j)` words (`fit`; the role of each word is that of its reading with each word's fewest), the
 * patterns that may fit (`alts`), and the longest pattern and one (`span`: past it, only the patterns that repeat an item
 * fit, the same for any count).
 */
export interface HedgeInput { words: ArgWord[]; operands: number[]; fit: (many: (k: number) => number) => Fit | undefined; span: number; alts: OperandAlt[] }

/** The hedge of each operand word k, whose role in the reading with each word's fewest is `item`. */
export function hedges({ words, operands, fit, span, alts }: HedgeInput): Hedges {
  // (Every item of every pattern with one role, as `echo`'s arguments or `rm`'s files: the same role for any count.)
  const roles = new Set(alts.flatMap((alt) => alt.pattern.map((o) => o.text.en)));
  if (roles.size === 1) return { hedge: () => ({}), none: () => undefined };
  // Each reading once. A pattern reads of a word only its text (`value`) or, where not known, its start (`prefix`): the
  // words in a row with the same give the same reading whichever of them give how many (`cp $a $b`: `x y` and `z`, or
  // `x` and `y z`), so the readings are kept by those runs.
  const kinds = new Map<string, number>();
  const kind = words.map((w) => {
    const text = w.value !== undefined ? `=${w.value}` : `^${w.prefix ?? ''}`;
    if (!kinds.has(text)) kinds.set(text, kinds.size);
    return kinds.get(text)!;
  });
  const cache = new Map<string, Fit | undefined>();
  /** The items of the places, where word j gives `many(j)` words, and where word k's start (`at`). */
  const readAt = (many: (j: number) => number, k: number): (Fit & { at: number }) | undefined => {
    let key = '';
    let last = -1;
    let run = 0;
    let at = 0;
    words.forEach((_, j) => {
      const n = many(j);
      if (j < k) at += n;
      if (kind[j] === last) run += n;
      else {
        if (last >= 0) key += `${last}:${run},`;
        last = kind[j];
        run = n;
      }
    });
    key += `${last}:${run}`;
    if (!cache.has(key)) {
      const r = fit(many);
      cache.set(key, r && { alt: r.alt, items: r.items });
    }
    const r = cache.get(key);
    return r && { ...r, at };
  };
  /** The items of the words of word k where word j gives `many(j)` words, with their place in their pattern (0 to 1). */
  const itemsOf = (many: (j: number) => number, k: number): { o: OperandSpec; place: number }[] | undefined => {
    const r = readAt(many, k);
    return r && r.items.slice(r.at, r.at + many(k)).map((n) => ({ o: r.alt.pattern[n], place: n / r.alt.pattern.length }));
  };
  /** The roles of the words of word k where word j gives `many(j)` words (repeated roles once). */
  const rolesAt = (many: (j: number) => number, k: number): OperandSpec[] | undefined => {
    const all = itemsOf(many, k)?.map((x) => x.o);
    return all?.filter((o, j) => j === 0 || o.text.en !== all[j - 1].text.en);
  };
  const fewest = (j: number): number => counts(words[j])[0];
  const varies = words.map((w) => counts(w)[0] !== counts(w)[1]);
  /**
   * `cp "$@"`, `cmp $a f`: the roles of the words of word k for each count word v gives (v may be k), the other words
   * their fewest (`counts`): `cp $a` with two words is a source and the destination (a new name or an existing
   * directory), with three or more sources and the destination directory. Read with each count from the fewest to one
   * more than the longest pattern; the last stands for the counts after it, with the counts in a row before it that
   * give the same roles (but one word), where a pattern fits it and bash can give more.
   */
  const readingsOf = (k: number, v: number): SeveralRoles[] => {
    const max = words[v].count!.max ?? Infinity;
    const most = Math.min(max, fewest(v) + span);
    const out: SeveralRoles[] = [];
    let r: OperandSpec[] | undefined;
    for (let c = fewest(v); c <= most; c++) {
      r = rolesAt((j) => (j === v ? c : fewest(j)), k);
      if (r) out.push({ from: c, roles: r });
    }
    if (r && most < max) {
      let j = out.length - 1;
      while (j > 0 && out[j - 1].from > 1 && out[j - 1].from === out[j].from - 1 && key(out[j - 1].roles) === key(out[j].roles)) j--;
      out.splice(j, out.length - j, { ...out[j], orMore: true });
    }
    return out;
  };
  const key = (roles: OperandSpec[]): string => roles.map((o) => o.text.en).join('\n');
  /** The counts word j may give: none when it may, then its fewest up to the longest pattern more (past it, the same). */
  const domain = (j: number): number[] => {
    const top = varies[j] ? Math.min(words[j].count!.max ?? Infinity, fewest(j) + span) : fewest(j);
    return [...(words[j].count?.min === 0 ? [0] : []), ...Array.from({ length: top - fewest(j) + 1 }, (_, n) => fewest(j) + n)];
  };
  /**
   * The numbers of words the words `js` may give in all, each up to the longest pattern and one (`span`; past it a role
   * is the same, only the patterns that repeat an item fit), each with counts of the words that give it.
   */
  const sums = (js: number[], counts: (j: number) => number[] = domain): Map<number, number[]> => {
    let at = new Map<number, number[]>([[0, []]]);
    for (const j of js) {
      const next = new Map<number, number[]>();
      for (const [n, counts_] of at) for (const c of counts(j)) if (!next.has(Math.min(n + c, span))) next.set(Math.min(n + c, span), [...counts_, c]);
      at = next;
    }
    return at;
  };
  /**
   * The roles the words of word k may have for any counts of the words that may give several or none (`MixedRoles`),
   * read for every number of words before it and after it they may give, and every count of its own (`cp $a $b d`: with
   * `$a` empty, `d` is the destination of the two-operand form; `cmp $a f $b` with four words of `$a` and none of `$b`,
   * `f` is an extra operand). A role depends only on the number of words on each side and on its own, the same past
   * the longest pattern. `first`: with each word giving its fewest, word k is one word of one role, the word's own, and
   * the roles are those of the other counts; else they are those of any counts.
   */
  const mixedOf = (k: number, flexible: number[]): MixedRoles => {
    const first = rolesAt(fewest, k)!.length === 1;
    const ahead = words.flatMap((_, j) => (j < k ? [j] : []));
    const behind = words.flatMap((_, j) => (j > k ? [j] : []));
    const [left, right] = [sums(ahead), sums(behind)];
    const fewestAt = (js: number[]): number => Math.min(js.reduce((n, j) => n + fewest(j), 0), span);
    // (Each role with its place in its pattern, from 0 to 1, to list them in the order the patterns have them.)
    const seen = new Map<string, { o: OperandSpec; place: number }>();
    for (const c of domain(k).filter((n) => n > 0)) {
      for (const [b, before] of left) {
        for (const [a, after] of right) {
          if (first && c === fewest(k) && b === fewestAt(ahead) && a === fewestAt(behind)) continue;
          const many = (j: number): number => (j === k ? c : j < k ? before[j] : after[j - k - 1]);
          for (const { o, place } of itemsOf(many, k) ?? []) {
            if (!seen.has(o.text.en) || seen.get(o.text.en)!.place > place) seen.set(o.text.en, { o, place });
          }
        }
      }
    }
    const roles = [...seen.values()].sort((a, b) => a.place - b.place).map((x) => x.o);
    return { words: (varies[k] ? [k, ...flexible].sort((a, b) => a - b) : flexible).map((j) => operands[j]), first, many: varies[k], roles };
  };
  /**
   * What word k (now `item`) may be besides `item`, by how many words the words that may give several give: the roles
   * of its words for each count of its own (`several`), its role for each count of the one other (`byCount`: `cmp $a f`,
   * `f` skips bytes in the first file after two words of `$a`, in the second after three), a role for any count of it
   * but the fewest (`otherwise`, `by`), or the roles its words may have for any counts of two or more words that may
   * give several or none (`mixed`). (One word that may give none and no more is said by the reading without it:
   * `ArgRole` `none`.)
   */
  const hedgeOf = (k: number, item: OperandSpec): Hedge => {
    const flexible = words.flatMap((_, j) => (j !== k && domain(j).length > 1 ? [j] : []));
    if (!varies[k] && (!flexible.length || (flexible.length === 1 && !varies[flexible[0]]))) return {};
    if (flexible.length > (varies[k] ? 0 : 1)) {
      const mixed = mixedOf(k, flexible);
      return !mixed.first || mixed.roles.some((o) => o.text.en !== item.text.en) ? { mixed } : {};
    }
    const v = varies[k] ? k : flexible[0];
    const out = readingsOf(k, v);
    // (One role for every count but the fewest is said by `otherwise`. The fewest of its own of two or more words, as
    // `{a,b}*`, is no single word: its roles are said.)
    const more = out.filter((x) => x.from > fewest(v) || (v === k && x.from > 1));
    if (more.length > 1 || more[0]?.roles.length > 1) return v === k ? { several: out } : { byCount: { word: operands[v], readings: out.map((x) => ({ from: x.from, ...(x.orMore ? { orMore: true } : {}), spec: x.roles[0] })) } };
    return more.length && more[0].roles[0].text.en !== item.text.en ? { otherwise: more[0].roles[0], by: operands[v] } : {};
  };
  /**
   * The role of the first word of word k where the words `drops` give none, for every count of the others (word k's own
   * too, one at least): `cp $a b` with `$a` empty is `cp b`, a source. Undefined where it depends on those counts (`seq
   * $a $b $c` with `$b`, `$c` empty: `seq 11` reads `11` as the last, `seq 11 12` as the first) or no form fits one of
   * them: the hedge of word k then says the roles of all counts.
   */
  const noneOf = (k: number, drops: number[]): OperandSpec | undefined => {
    const counts = (j: number): number[] => (drops.includes(j) ? [0] : domain(j));
    const [left, right] = [sums(words.flatMap((_, j) => (j < k ? [j] : [])), counts), sums(words.flatMap((_, j) => (j > k ? [j] : [])), counts)];
    let then: OperandSpec | undefined;
    for (const c of domain(k).filter((n) => n > 0)) {
      for (const before of left.values()) {
        for (const after of right.values()) {
          const o = itemsOf((j) => (j === k ? c : j < k ? before[j] : after[j - k - 1]), k)?.[0]?.o;
          if (!o || (then && then.text.en !== o.text.en)) return undefined;
          then = o;
        }
      }
    }
    return then;
  };
  return { hedge: hedgeOf, none: noneOf };
}

/**
 * The hedges of the operands (`hedge`), and the role of the first word of an operand where other words give none, the
 * same for any count of the rest (`none`).
 */
export interface Hedges { hedge: (k: number, item: OperandSpec) => Hedge; none: (k: number, drops: number[]) => OperandSpec | undefined }

/**
 * Gives an operand's role its hedge (`uncertain` and the hedge's fields) and its role where other operands give none
 * (`none`, a `NoneRole` of its own), read when first asked: only the explanation of the words asks, and a command's words
 * are interpreted for many other uses, where the readings would be wasted.
 */
export function withHedge(role: OperandRole, hedge: () => Hedge, none: () => NoneRole | undefined): void {
  let h: Hedge | undefined;
  let n: NoneRole[] | undefined | null = null;
  const get = (): Hedge => (h ??= hedge());
  const nones = (): NoneRole[] | undefined => {
    if (n === null) {
      const r = none();
      n = r ? [r] : undefined;
    }
    return n;
  };
  const has = (): boolean => !!(get().otherwise || get().several || get().byCount || get().mixed || nones());
  const field = <K extends keyof Hedge>(key: K) => ({ enumerable: true, get: () => get()[key] });
  Object.defineProperties(role, {
    uncertain: { enumerable: true, get: () => (has() ? true : undefined) },
    otherwise: field('otherwise'), by: field('by'), several: field('several'), byCount: field('byCount'), mixed: field('mixed'),
    none: { enumerable: true, configurable: true, get: nones },
  });
}
