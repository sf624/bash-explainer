// The hedges of an operand whose role depends on how many words the expansions among the operands give
// (src/explain/argv.ts; the roles from `ArgRole` `operand`: `several`, `byCount`, `mixed`, `otherwise`, `none`).
import type { ArgRole, ByCount, MixedRoles, SeveralRoles } from '../argv/interpret';
import { countIn } from '../semantics/argwords';
import type { SyntaxNode } from '../syntax/tree';
import type { Explainer } from './context';

/**
 * `desc`, the role `role` of the operand `a` (its text), with the roles it has when an expansion gives more words (`cp "$@"`, `cp
 * *.txt dir`) or none (with `$a` empty, `cp $a b` is `cp b`, and `grep -c $x f` reads `f` as the pattern).
 */
export function hedged(cx: Explainer, desc: string, a: string, role: Extract<ArgRole, { role: 'operand' }>, nodes: SyntaxNode[]): string {
  let out = desc;
  if (role.several) out = severalText(cx, desc, a, role.several);
  else if (role.byCount) out = byCountText(cx, desc, role.byCount, nodes);
  else if (role.mixed) out = mixedText(cx, desc, role.mixed, nodes);
  else if (role.otherwise) out = uncertainText(cx, desc, cx.t(role.otherwise.text), role.by!, nodes);
  if (!role.none) return out;
  const list = role.none.words.map((i) => `\`${nodes[i].text}\``).join(cx.s('・', ', '));
  const then = cx.t(role.none.spec.text);
  return out + cx.s(`、${list} が0語なら${then}`, `; ${then} when ${list} ${role.none.words.length > 1 ? 'expand' : 'expands'} to nothing`);
}

/**
 * The roles of the words of the operand `a` for each count of words (`SeveralRoles`), `desc` when it gives one: `cp $a`
 * is "source when `$a` expands to a single word; when it expands to 2 words, they are source, then destination (…);
 * when it expands to more, they are source, then destination directory".
 */
function severalText(cx: Explainer, desc: string, a: string, several: SeveralRoles[]): string {
  return several.map((r, j) => {
    // (In Japanese the roles are a list, joined with `・`: the `、` after it starts another reading.)
    const roles = r.roles.map((o) => cx.t(o.text)).join(cx.s('・', ', then '));
    if (r.from === 1) return cx.s(`\`${a}\` が1語に展開されるなら${desc}`, `${desc} when \`${a}\` expands to a single word`);
    const { ja, en } = countPhrase(cx, several, j);
    return j ? cx.s(`${ja}なら順に${roles}`, `when it expands to ${en}, they are ${roles}`) : cx.s(`\`${a}\` が${ja}に展開されるなら順に${roles}`, `when \`${a}\` expands to ${en}, they are ${roles}`);
  }).join(cx.s('、', '; '));
}

/** "2 words", "2 words or more", or "more" after the reading before (`readings[j - 1]`), in a hedge of counts. */
function countPhrase(cx: Explainer, readings: { from: number; orMore?: boolean }[], j: number): { ja: string; en: string } {
  const r = readings[j];
  return {
    ja: r.orMore ? `${r.from}語以上` : `${r.from}語`,
    en: r.orMore ? (j && readings[j - 1].from === r.from - 1 ? 'more' : `${r.from} words or more`) : r.from === 1 ? 'a single word' : `${r.from} words`,
  };
}

/**
 * The role of an operand for each count of the one other word that may give several (`ByCount`), `desc` for its
 * fewest: `cmp $a f` is "second file when `$a` expands to a single word; bytes to skip in the first file when it
 * expands to 2 words; bytes to skip in the second file when it expands to more".
 */
function byCountText(cx: Explainer, desc: string, by: ByCount, nodes: SyntaxNode[]): string {
  const w = `\`${nodes[by.word].text}\``;
  return by.readings.map((r, j) => {
    const { ja, en } = countPhrase(cx, by.readings, j);
    const text = j ? cx.t(r.spec.text) : desc;
    return j ? cx.s(`${ja}なら${text}`, `${text} when it expands to ${en}`) : cx.s(`${w} が${ja}に展開されるなら${text}`, `${text} when ${w} expands to ${en}`);
  }).join(cx.s('、', '; '));
}

/**
 * The roles the words of an operand may have when it or the other words that may give several give more (`MixedRoles`):
 * `cp $a $b` is, of `$b`, "destination (…) when `$a`, `$b` expand to a single word; when they expand to more, each of
 * its words is source or destination directory".
 */
function mixedText(cx: Explainer, desc: string, mixed: MixedRoles, nodes: SyntaxNode[]): string {
  const list = mixed.words.map((i) => `\`${nodes[i].text}\``).join(cx.s('・', ', '));
  const texts = mixed.roles.map((o) => cx.t(o.text));
  const roles = cx.s(`${texts.join('・')}のどれか`, texts.length > 1 ? `${texts.slice(0, -1).join(', ')} or ${texts[texts.length - 1]}` : texts[0]);
  const them = cx.s(mixed.many ? 'この語の各語は' : 'この語は', mixed.many ? 'each of its words is' : 'it is');
  if (!mixed.first) return cx.s(`${list} が展開される語数により、${them}${roles}`, `${them} ${roles}, by how many words ${list} expand to`);
  // (A word that gives two words at least, `{a,b}*`: as few as each gives.)
  const one = mixed.words.every((i) => countIn(nodes[i], cx.state)!.min <= 1);
  return one
    ? cx.s(`${list} が1語に展開されるなら${desc}、どれかが2語以上なら${them}${roles}`, `${desc} when ${list} expand to a single word; when they expand to more, ${them} ${roles}`)
    : cx.s(`${list} がそれぞれ最も少ない語数に展開されるなら${desc}、どれかがそれより多いなら${them}${roles}`, `${desc} when ${list} expand to as few words as each can; when they expand to more, ${them} ${roles}`);
}

/**
 * The roles an operand may have, which depend on how many words the word `by` gives (`cp *.txt dir`): `desc` when it
 * gives its fewest, `other` when it gives more (`cp {a,b}* f`: "… when `{a,b}*` expands to 2 words").
 */
function uncertainText(cx: Explainer, desc: string, other: string, by: number, nodes: SyntaxNode[]): string {
  const w = `\`${nodes[by].text}\``;
  const fewest = Math.max(countIn(nodes[by], cx.state)!.min, 1);
  return cx.s(`${w} が${fewest}語に展開されるなら${desc}、${fewest + 1}語以上なら${other}`, `${desc} when ${w} expands to ${fewest === 1 ? 'a single word' : `${fewest} words`}; ${other} when it expands to more`);
}
