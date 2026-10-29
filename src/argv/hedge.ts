// The hedges of an operand whose role depends on how many words the words that may give several give (`ArgRole`
// `operand`: `several`, `byCount`, `mixed`, `otherwise`), read from the readings of the operand patterns that the
// argument interpreter (src/argv/interpret.ts, `placeOperands`) makes with each count.
import type { ArgWord } from './interpret';
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

/**
 * A reading of the operands: each operand word repeated as many times as it gives words (`at`, the word of each place;
 * `first`, where each word starts), the pattern that fits them, and the item of each place.
 */
export interface Fit { at: number[]; first: number[]; alt: OperandAlt; index: number; items: number[] }

/**
 * What the hedges are read from: the operand words (`operands`, their indexes among the command's words), the reading
 * with each word's fewest (`primary`), the readings with other counts (`fit`), and the longest pattern and one
 * (`span`: past it, only the patterns that repeat an item fit, the same for any count).
 */
export interface HedgeInput { words: ArgWord[]; operands: number[]; primary: Fit; fit: (many: (k: number) => number) => Fit | undefined; span: number }

/** The hedge of each operand word k, whose role in the reading `primary` is `item`. */
export function hedges({ words, operands, primary, fit, span }: HedgeInput): (k: number, item: OperandSpec) => Hedge {
  /** The roles of the words of word k in the reading `r` (repeated roles once). */
  const rolesIn = (r: Fit, k: number): OperandSpec[] => {
    const all = r.at.flatMap((x, p) => (x === k ? [r.alt.pattern[r.items[p]]] : []));
    return all.filter((o, j) => j === 0 || o.text.en !== all[j - 1].text.en);
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
    let r: Fit | undefined;
    for (let c = fewest(v); c <= most; c++) {
      r = c === fewest(v) ? primary : fit((j) => (j === v ? c : fewest(j)));
      if (r) out.push({ from: c, roles: rolesIn(r, k) });
    }
    if (r && most < max) {
      let j = out.length - 1;
      while (j > 0 && out[j - 1].from > 1 && out[j - 1].from === out[j].from - 1 && key(out[j - 1].roles) === key(out[j].roles)) j--;
      out.splice(j, out.length - j, { ...out[j], orMore: true });
    }
    return out;
  };
  const key = (roles: OperandSpec[]): string => roles.map((o) => o.text.en).join('\n');
  /**
   * The roles the words of word k may have when it or another word that may give several (`others`) gives more than
   * its fewest: each other word with one or two more, and all of them, with each count of word k (`cp $a $b`: with
   * `x y` and `z`, `z` is the destination directory, with `x` and `y z` a source and the destination directory).
   * `first`: the reading where each gives its fewest is one role, the word's own (`spec`); else it is among them.
   */
  const mixedOf = (k: number, others: number[]): MixedRoles => {
    const own = varies[k] ? Math.min(words[k].count!.max ?? Infinity, fewest(k) + span) : fewest(k);
    const first = rolesIn(primary, k).length === 1;
    const steps = [new Map<number, number>(), ...others.flatMap((j) => [1, 2].map((d) => new Map([[j, d]]))), ...[1, 2].map((d) => new Map(others.map((j) => [j, d])))];
    // (Each role with its place in its pattern, from 0 to 1, to list them in the order the patterns have them.)
    const seen = new Map<string, { o: OperandSpec; at: number }>();
    for (let c = fewest(k); c <= own; c++) {
      for (const step of steps) {
        if (first && c === fewest(k) && !step.size) continue;
        const r = fit((j) => (j === k ? c : Math.min(fewest(j) + (step.get(j) ?? 0), words[j].count?.max ?? Infinity)));
        r?.at.forEach((x, p) => {
          if (x !== k) return;
          const o = r.alt.pattern[r.items[p]];
          const at = r.items[p] / r.alt.pattern.length;
          if (!seen.has(o.text.en) || seen.get(o.text.en)!.at > at) seen.set(o.text.en, { o, at });
        });
      }
    }
    const roles = [...seen.values()].sort((a, b) => a.at - b.at).map((x) => x.o);
    return { words: (varies[k] ? [k, ...others].sort((a, b) => a - b) : others).map((j) => operands[j]), first, many: varies[k], roles };
  };
  /**
   * What word k (now `item`) may be besides `item`, by how many words the words that may give several give: the roles
   * of its words for each count of its own (`several`), its role for each count of the one other (`byCount`: `cmp $a f`,
   * `f` skips bytes in the first file after two words of `$a`, in the second after three), a role for any count of it
   * but the fewest (`otherwise`, `by`), or the roles its words may have for any counts of two or more such words
   * (`mixed`).
   */
  const hedgeOf = (k: number, item: OperandSpec): Hedge => {
    const others = words.flatMap((_, j) => (j !== k && varies[j] ? [j] : []));
    if (!varies[k] && !others.length) return {};
    if (others.length > (varies[k] ? 0 : 1)) {
      const mixed = mixedOf(k, others);
      return !mixed.first || mixed.roles.some((o) => o.text.en !== item.text.en) ? { mixed } : {};
    }
    const v = varies[k] ? k : others[0];
    const out = readingsOf(k, v);
    // (One role for every count but the fewest is said by `otherwise`. The fewest of its own of two or more words, as
    // `{a,b}*`, is no single word: its roles are said.)
    const more = out.filter((x) => x.from > fewest(v) || (v === k && x.from > 1));
    if (more.length > 1 || more[0]?.roles.length > 1) return v === k ? { several: out } : { byCount: { word: operands[v], readings: out.map((x) => ({ from: x.from, ...(x.orMore ? { orMore: true } : {}), spec: x.roles[0] })) } };
    return more.length && more[0].roles[0].text.en !== item.text.en ? { otherwise: more[0].roles[0], by: operands[v] } : {};
  };
  return hedgeOf;
}
