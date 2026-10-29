// The hedges of an operand whose role depends on how many words the expansions among the operands give
// (src/explain/argv.ts; the roles from `ArgRole` `operand`: `several`, `otherwise`, `none`).
import type { ArgRole, ArgvParse, SeveralRoles } from '../argv/interpret';
import { countIn } from '../semantics/argwords';
import type { SyntaxNode } from '../syntax/tree';
import type { Explainer } from './context';

/**
 * `desc`, the role `role` of the operand `a` (its text), with the roles it has when an expansion gives more words (`cp "$@"`, `cp
 * *.txt dir`) or none (with `$a` empty, `cp $a b` is `cp b`, and `grep -c $x f` reads `f` as the pattern).
 */
export function hedged(cx: Explainer, desc: string, a: string, role: Extract<ArgRole, { role: 'operand' }>, parse: ArgvParse, nodes: SyntaxNode[]): string {
  let out = desc;
  if (role.several) out = severalText(cx, desc, a, role.several);
  else if (role.otherwise) out = uncertainText(cx, desc, cx.t(role.otherwise.text), parse, nodes);
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
    // ("More" after the reading before: from the next count on.)
    const ja = r.orMore ? `${r.from}語以上` : `${r.from}語`;
    const en = r.orMore ? (j && several[j - 1].from === r.from - 1 ? 'more' : `${r.from} words or more`) : `${r.from} words`;
    return j ? cx.s(`${ja}なら順に${roles}`, `when it expands to ${en}, they are ${roles}`) : cx.s(`\`${a}\` が${ja}に展開されるなら順に${roles}`, `when \`${a}\` expands to ${en}, they are ${roles}`);
  }).join(cx.s('、', '; '));
}

/**
 * The roles an operand may have, which depend on how many words the expansions among the operands give
 * (`cp *.txt dir`): `desc` when they give one word each, `other` when they give more.
 */
function uncertainText(cx: Explainer, desc: string, other: string, parse: ArgvParse, nodes: SyntaxNode[]): string {
  // (Any word may be the one: `bash -c $cmd _ a`, where the string is unquoted.)
  const many = parse.roles.filter((r) => countIn(nodes[r.word], cx.state)?.max !== countIn(nodes[r.word], cx.state)?.min);
  const list = many.map((r) => `\`${nodes[r.word].text}\``).join(cx.s('・', ', '));
  return cx.s(`${list} が1語に展開されるなら${desc}、2語以上なら${other}`, `${desc} when ${list} expands to a single word; ${other} when it expands to more`);
}
