// The texts of a word's readings (docs/design/count-hedges.md, sections 2.6 and 2.7): its profile as written, a clause
// "profile when condition" for each other class, the text the classes fold into past the budget, and the text past the
// cap; in Japanese and English, with the names of the words and the texts of the roles from the caller. Nothing reads them
// yet: src/explain/operand-texts.ts renders them from step 4 on.
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

/** Roles any of which a word may be: "X or Y", "X, Y or Z"; "X・Yのどれか". */
function anyOf(roles: readonly Role[], names: Names): Text {
  const texts = roles.map(names.role);
  const en = texts.map((t) => t.en);
  return { ja: texts.map((t) => t.ja).join('・') + (texts.length > 1 ? 'のどれか' : ''), en: en.length > 1 ? `${en.slice(0, -1).join(', ')} or ${en.at(-1)}` : en[0] };
}

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

/** How many of its own words a group of own counts is: "a single word", "2 words", "3 words or more", "more" (after the count before), "2 to 4 words". */
function countText(groups: readonly CountGroup[], j: number): Text {
  const { from, to, orMore } = groups[j];
  if (orMore) return { ja: `${from}語以上`, en: j && groups[j - 1].to === from - 1 ? 'more' : `${from} words or more` };
  if (from < to) return { ja: `${from}〜${to}語`, en: `${from} to ${to} words` };
  return { ja: `${from}語`, en: from === 1 ? 'a single word' : `${from} words` };
}

/**
 * The profile as written, said first (section 2.6): its role; by place, "X; when `$v` expands to several words, this is
 * its first word, and the others are Y, then Z"; by own count, as `cp $a` is said today ("source when `$a` expands to a
 * single word; when it expands to 2 words, they are source, then destination; …"). A word of a known number of words
 * (fields the model knows) says each: "its words are X, then Y". Nothing where every own count is refused (`jq --arg $n`
 * as written): the role as written stays.
 */
export function baseText(p: Profile, k: number, names: Names): Text {
  const w = names.word(k);
  if (!p.groups.length) return { ja: '', en: '' };
  if (p.places) {
    const [first, ...rest] = squeeze(p.places);
    const x = names.role(first);
    if (!rest.length) return x;
    if (p.counts.length === 1) {
      const all = listOf(squeeze(p.places), names);
      return { ja: `順に${spaced(all.ja)}`, en: `its words are ${all.en}` };
    }
    const others = squeeze(p.places.slice(1));
    const l = listOf(others, names);
    return others.length > 1
      ? { ja: `${x.ja}、${w} が2語以上に展開されるならこの語は最初の語で、残りの語は順に${spaced(l.ja)}`, en: `${x.en}; when ${w} expands to several words, this is its first word, and the others are ${l.en}` }
      : { ja: `${x.ja}、${w} が2語以上に展開されるならこの語は最初の語で、残りの各語は${spaced(l.ja)}`, en: `${x.en}; when ${w} expands to several words, this is its first word, and each of the others is ${l.en}` };
  }
  const parts = p.groups.map((g, j): Text => {
    const l = listOf(g.roles, names);
    if (g.from === 1 && g.to === 1) return { ja: `${w} が1語に展開されるなら${spaced(l.ja)}`, en: `${l.en} when ${w} expands to a single word` };
    const c = countText(p.groups, j);
    return j ? { ja: `${c.ja}なら順に${spaced(l.ja)}`, en: `when it expands to ${c.en}, they are ${l.en}` } : { ja: `${w} が${c.ja}に展開されるなら順に${spaced(l.ja)}`, en: `when ${w} expands to ${c.en}, they are ${l.en}` };
  });
  return { ja: parts.map((x) => x.ja).join('、'), en: parts.map((x) => x.en).join('; ') };
}

/**
 * A clause (section 2.6): "X when C"; by place, "when C, its words are X, Y, then Z"; by own count, "when C, it is X with
 * a single word, and they are X, then Y with 2 words or more".
 */
export function clauseText(r: WordReadings, c: Clause, names: Names): Text {
  const when = conditionText(r.places, c.atoms, names);
  const p = c.profile;
  if (p.places) {
    const roles = squeeze(p.places);
    const l = listOf(roles, names);
    return roles.length > 1 ? { ja: `${when.ja}なら順に${spaced(l.ja)}`, en: `when ${when.en}, its words are ${l.en}` } : { ja: `${when.ja}なら${spaced(l.ja)}`, en: `${l.en} when ${when.en}` };
  }
  const parts = p.groups.map((g, j): Text => {
    const l = listOf(g.roles, names);
    const n = countText(p.groups, j);
    const one = g.from === 1 && g.to === 1;
    return { ja: `${j ? '' : 'この語が'}${n.ja}のとき${one ? '' : '順に'}${spaced(l.ja)}`, en: one ? `it is ${l.en} with ${n.en}` : `they are ${l.en} with ${n.en}` };
  });
  const ja = parts.map((x) => x.ja).join('、');
  const en = parts.length > 1 ? `${parts.slice(0, -1).map((x) => x.en).join(', ')}, and ${parts.at(-1)!.en}` : parts[0].en;
  return { ja: `${when.ja}なら、${ja}`, en: `when ${when.en}, ${en}` };
}

/** The classes folded into one text (section 2.5): "X or Y, by how many words `$a` and `$b` give"; "`$a`・`$b` が展開される語数により、X・Yのどれか". */
export function foldedText(f: Folded, names: Names): Text {
  const who = namesOf(f.words, names);
  const roles = anyOf(f.roles, names);
  return { ja: `${who.ja} が展開される語数により、${roles.ja}`, en: `${roles.en}, by how many words ${who.en} give` };
}

/** The text past the cap (section 2.8): "its role may depend on how many words `$a` and `$b` give". */
export function dependsText(d: Depends, names: Names): Text {
  const who = namesOf(d.words, names);
  return { ja: `${who.ja} が展開される語数により役割が変わりうる`, en: `its role may depend on how many words ${who.en} give` };
}

/** What a word's readings say: its profile as written, then each clause, or the folded text. */
export function readingsText(r: WordReadings, k: number, names: Names): Text {
  const parts = [baseText(r.base, k, names), ...r.clauses.map((c) => clauseText(r, c, names)), ...(r.folded ? [foldedText(r.folded, names)] : [])].filter((x) => x.en);
  return { ja: parts.map((x) => x.ja).join('、'), en: parts.map((x) => x.en).join('; ') };
}
