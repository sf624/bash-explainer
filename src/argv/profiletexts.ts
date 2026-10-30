// The texts of a word's readings (docs/design/count-hedges.md, sections 2.6 and 2.7): its profile as written, a clause
// "when condition, profile" for each other class, the text the classes fold into past the budget, and the text past the
// cap; in Japanese and English, with the names of the words and the texts of the roles from the caller (who can name the
// command that reads a role: `Role.by`). Each clause is a sentence of its own, so the reader sees where a condition ends.
// src/explain/operand-texts.ts renders them (`readingsParts`).
import type { Text } from '../i18n';
import type { Atom, Clause, CountGroup, Depends, Folded, Place, Profile, Role, WordReadings } from './profiles';
import { squeeze } from './profiles';

/** What the texts name: a command's word, as code (`` `$a` ``), and a role. */
export interface Names { word: (k: number) => string; role: (r: Role) => Text }

/** (A space before code or a word in Latin letters after Japanese, as docs/japanese-style.md asks.) */
const spaced = (text: string): string => (/^[`A-Za-z]/.test(text) ? ' ' : '') + text;

/** Words named together: "`$a` and `$b`", "`$a`, `$b` and `$c`"; "`$a`・`$b`". */
function namesOf(words: readonly number[], names: Names): Text {
  const ws = words.map(names.word);
  return { ja: ws.join('・'), en: ws.length > 1 ? `${ws.slice(0, -1).join(', ')} and ${ws.at(-1)}` : ws[0] };
}

/** Roles in a row: "A, then B", "A, B, then C"; "A・B・C". */
function listOf(roles: readonly Role[], names: Names): Text {
  const texts = roles.map(names.role);
  const en = texts.map((t) => t.en);
  return { ja: texts.map((t) => t.ja).join('・'), en: en.length > 1 ? `${en.slice(0, -1).join(', ')}, then ${en.at(-1)}` : en[0] };
}

/** Roles any of which a word may be: "X or Y", "X, Y or Z"; "X・Yのどちらか", "X・Y・Zのどれか". */
function anyOf(roles: readonly Role[], names: Names): Text {
  const texts = roles.map(names.role);
  const en = texts.map((t) => t.en);
  const which = texts.length > 2 ? 'のどれか' : texts.length > 1 ? 'のどちらか' : '';
  return { ja: texts.map((t) => t.ja).join('・') + which, en: en.length > 1 ? `${en.slice(0, -1).join(', ')} or ${en.at(-1)}` : en[0] };
}

/** "gives" after one word, "give" after several. */
const gives = (words: readonly number[]): string => (words.length > 1 ? 'give' : 'gives');

/** The first letter as a capital, for a clause that starts a sentence. */
const sentence = (text: string): string => text.charAt(0).toUpperCase() + text.slice(1);

/**
 * An atom (section 2.5): of one word, "`$a` expands to nothing", "to a single word", "to several words", "to 3 words",
 * "to a word or more"; of a sum, "`$n` and `$v` expand to nothing", "to one word in all", "to 3 words or more in all".
 * `second`: after "and", without the verb ("`$a` to a word or more").
 */
function atomText(place: Place, a: Atom, names: Names, second: boolean): Text {
  const who = namesOf(place.words, names);
  const n = a.from;
  if (place.one) {
    const en = a.to === undefined ? (n === 1 ? 'a word or more' : n === 2 ? 'several words' : `${n} words or more`) : n === 0 ? 'nothing' : n === 1 ? 'a single word' : `${n} words`;
    return { ja: `${who.ja} が${n}語${a.to === undefined ? '以上' : ''}`, en: `${who.en}${second ? '' : ' expands'} to ${en}` };
  }
  const en = a.to === 0 ? 'nothing' : `${n === 1 ? (a.to === undefined ? 'a word' : 'one word') : `${n} words`}${a.to === undefined ? ' or more' : ''} in all`;
  return { ja: a.to === 0 ? `${who.ja} が0語` : `${who.ja} が合わせて${n}語${a.to === undefined ? '以上' : ''}`, en: `${who.en}${second ? '' : ' expand'} to ${en}` };
}

/** A condition: one atom, or two ("`$b` expands to nothing and `$a` to a word or more"; "`$b` が0語で `$a` が1語以上"). */
export function conditionText(places: readonly Place[], atoms: readonly Atom[], names: Names): Text {
  const [a, b] = atoms.map((x, i) => atomText(places[x.place], x, names, i > 0));
  return b ? { ja: `${a.ja}で ${b.ja}`, en: `${a.en} and ${b.en}` } : a;
}

/**
 * Conditions any of which says a clause: "when A, or when B"; "A、または B なら", or "A、または B のときは" before a
 * text with conditions of its own (`nested`), so that the two do not read as one ("`$b` が0語のときは、`$a` が1語に
 * 展開されるなら…").
 */
function whenText(places: readonly Place[], conditions: readonly (readonly Atom[])[], names: Names, nested = false): Text {
  const texts = conditions.map((c) => conditionText(places, c, names));
  return { ja: `${texts.map((t) => t.ja).join('、または ')}${nested ? 'のときは' : 'なら'}`, en: `when ${texts.map((t) => t.en).join(', or when ')}` };
}

/** How many of its own words a group of own counts is: "2 words", "3 words or more", "more words" (after the count before), "1 to 4 words". */
function countText(groups: readonly CountGroup[], j: number): Text {
  const { from, to, orMore } = groups[j];
  if (orMore) return { ja: `${from}語以上`, en: j && groups[j - 1].to === from - 1 ? 'more words' : `${from} words or more` };
  if (from < to) return { ja: `${from}〜${to}語`, en: `${from} to ${to} words` };
  // (One word alone is said by its role: `byCountText`.)
  return { ja: `${from}語`, en: `${from} words` };
}

/**
 * The roles of a word for each group of its own counts, as `cp $a` is said today: "source when `$a` expands to a single
 * word; when it expands to 2 words, they are source, then destination; when it expands to more words, they are …";
 * "`$a` が1語に展開されるならコピー元、2語なら順に …".
 */
function byCountText(groups: readonly CountGroup[], w: string, names: Names): Text {
  const parts = groups.map((g, j): Text => {
    const l = listOf(g.roles, names);
    if (g.from === 1 && g.to === 1) return { ja: `${w} が1語に展開されるなら${spaced(l.ja)}`, en: `${l.en} when ${w} expands to a single word` };
    const c = countText(groups, j);
    return j ? { ja: `${c.ja}なら順に${spaced(l.ja)}`, en: `when it expands to ${c.en}, they are ${l.en}` } : { ja: `${w} が${c.ja}に展開されるなら順に${spaced(l.ja)}`, en: `when ${w} expands to ${c.en}, they are ${l.en}` };
  });
  return { ja: parts.map((x) => x.ja).join('、'), en: parts.map((x) => x.en).join('; ') };
}

/**
 * The profile as written, said first (section 2.6): its role; by place, "X; when `$v` expands to several words, this is
 * the role of the first word `$v` gives, and the others are Y, then Z"; by own count, as `cp $a` is said today. A word
 * of a known number of words (fields the model knows), or one that never gives one word (`{a,b}*`), says each: "its
 * words are X, then Y".
 * Nothing where every own count is refused (`jq --arg $n` as written): the role as written stays.
 */
export function baseText(p: Profile, k: number, names: Names): Text {
  const w = names.word(k);
  if (!p.groups.length) return { ja: '', en: '' };
  if (!p.places) return byCountText(p.groups, w, names);
  const [first, ...rest] = squeeze(p.places);
  const x = names.role(first);
  if (!rest.length) return x;
  if (p.counts.length === 1 || p.counts[0] > 1) {
    const all = listOf(squeeze(p.places), names);
    return { ja: `順に${spaced(all.ja)}`, en: `its words are ${all.en}` };
  }
  const others = squeeze(p.places.slice(1));
  const l = listOf(others, names);
  const ja = `${x.ja}。${w} が2語以上に展開されるときは、その最初の語がこの役割で、`;
  const en = `${x.en}; when ${w} expands to several words, this is the role of the first word ${w} gives, and`;
  return others.length > 1 ? { ja: `${ja}残りの語は順に${spaced(l.ja)}`, en: `${en} the others are ${l.en}` } : { ja: `${ja}残りの各語は${spaced(l.ja)}`, en: `${en} each of the others is ${l.en}` };
}

/**
 * A clause (section 2.6), a sentence: "when C, it is X"; by place, "when C, its words are X, Y, then Z"; by own count,
 * "when C: X when `$a` expands to a single word; when it expands to more words, they are X, then Y".
 */
export function clauseText(r: WordReadings, c: Clause, k: number, names: Names): Text {
  const p = c.profile;
  const when = whenText(r.places, c.conditions, names, !p.places);
  if (!p.places) {
    const by = byCountText(p.groups, names.word(k), names);
    return { ja: `${when.ja}、${by.ja}`, en: `${when.en}: ${by.en}` };
  }
  const roles = squeeze(p.places);
  const l = listOf(roles, names);
  return roles.length > 1 ? { ja: `${when.ja}順に${spaced(l.ja)}`, en: `${when.en}, its words are ${l.en}` } : { ja: `${when.ja}${spaced(l.ja)}`, en: `${when.en}, it is ${l.en}` };
}

/** The classes folded into one text (section 2.5): "it can also be X or Y, by how many words `$a` and `$b` give"; "`$a`・`$b` が展開される語数により、X・Yのどちらかにもなる". */
export function foldedText(f: Folded, names: Names): Text {
  const who = namesOf(f.words, names);
  const roles = anyOf(f.roles, names);
  return { ja: `${who.ja} が展開される語数により、${roles.ja}にもなる`, en: `it can also be ${roles.en}, by how many words ${who.en} ${gives(f.words)}` };
}

/** The text past the cap (section 2.8): "its role may depend on how many words `$a` and `$b` give". */
export function dependsText(d: Depends, names: Names): Text {
  const who = namesOf(d.words, names);
  return { ja: `${who.ja} が展開される語数により役割が変わりうる`, en: `its role may depend on how many words ${who.en} ${gives(d.words)}` };
}

/** What a word's readings say after its profile as written: each clause, or the folded text. */
export function clausesText(r: WordReadings, k: number, names: Names): Text[] {
  return [...r.clauses.map((c) => clauseText(r, c, k, names)), ...(r.folded ? [foldedText(r.folded, names)] : [])];
}

/** What a word's readings say: its profile as written, then each clause or the folded text, each a sentence ("。", ". "). */
export function readingsText(r: WordReadings, k: number, names: Names): Text {
  const parts = [baseText(r.base, k, names), ...clausesText(r, k, names)].filter((x) => x.en);
  return { ja: parts.map((x) => x.ja).join('。'), en: parts.map((x, i) => (i ? sentence(x.en) : x.en)).join('. ') };
}
