// The hedges of an operand whose role depends on how many words the expansions among the operands give
// (src/explain/argv.ts; the roles from `ArgRole` `operand`: `several`, `byCount`, `mixed`, `otherwise`, `none`), and what
// each of the words read in place of one is to the command (the fields of a word, a value `env -S` splits).
import type { Token } from '../analyzer-types';
import { codeSpan } from '../label';
import type { ArgRole, ArgWord, ByCount, MixedRoles, NoneRole, RoleAt, SeveralRoles, ValueRole } from '../argv/interpret';
import type { OperandSpec } from '../argv/spec';
import { splitsIn } from '../argv/words';
import { braceAlternatives, braceTexts } from '../semantics/brace';
import { countIn, fieldsIn } from '../semantics/argwords';
import type { SyntaxNode } from '../syntax/tree';
import type { Explainer } from './context';

/**
 * `desc`, the role `role` of the operand `a` (its text), with the roles it has when an expansion gives more words (`cp "$@"`, `cp
 * *.txt dir`) or none (with `$a` empty, `cp $a b` is `cp b`, and `grep -c $x f` reads `f` as the pattern; `none`, unless the
 * caller puts them after a note of its own, `noneText`).
 */
export function hedged(cx: Explainer, desc: string, a: string, role: Extract<ArgRole, { role: 'operand' }>, nodes: SyntaxNode[], none = true): string {
  let out = desc;
  if (role.several) out = severalText(cx, desc, a, role.several);
  else if (role.byCount) out = byCountText(cx, desc, role.byCount, nodes);
  else if (role.mixed) out = mixedText(cx, desc, role.mixed, nodes);
  else if (role.otherwise) out = uncertainText(cx, desc, cx.t(role.otherwise.text), role.by!, nodes);
  return none ? out + noneText(cx, role.none, nodes) : out;
}

/** The token `t` of a word, with the roles it takes when words before it give none (`ArgRole` `none`). */
export function withNone(cx: Explainer, t: Token, none: readonly NoneRole[] | undefined, nodes: SyntaxNode[]): Token {
  return none ? { ...t, explanation: t.explanation + noneText(cx, none, nodes) } : t;
}

/** The value `v` of an option, as a hedge says it: "value for `-f`", "name for `--arg`" (`jq --arg NAME VALUE`). */
function valueText(cx: Explainer, v: ValueRole): string {
  const flag = dash(v.of);
  if (Array.isArray(v.option?.value) && v.option.value.length === 2) return v.index ? cx.s(`\`${flag}\` の値`, `value for \`${flag}\``) : cx.s(`\`${flag}\` の名前`, `name for \`${flag}\``);
  return /^-/.test(flag) ? cx.s(`\`${flag}\` オプションの値`, `value for \`${flag}\``) : cx.s(`\`${flag}\` の値`, `value for \`${flag}\``);
}

/**
 * The roles a word takes when words before it give none (`ArgRole` `none`), each "; X when `$a` expands to nothing": an
 * operand's (with `$a` empty, `cp $a b` is `cp b`, a source), or an option's value (`tar -cf $a b`: "value for `-f`"), or
 * its first word's where it may give several ("its first word is …"). Equal readings, each after one word, are one: "X
 * when `$n` or `$v` expands to nothing" (`jq --arg $n $v .`); a reading after several words is when they all give none
 * ("when `$a`, `$b` expand to nothing").
 */
export function noneText(cx: Explainer, none: readonly NoneRole[] | undefined, nodes: SyntaxNode[]): string {
  const readings: { then: string; first?: true; words: number[][] }[] = [];
  for (const r of none ?? []) {
    const then = r.spec ? cx.t(r.spec.text) : valueText(cx, r.value);
    const same = r.words.length === 1 ? readings.find((g) => g.then === then && g.first === r.first && g.words[0].length === 1) : undefined;
    if (same) same.words.push(r.words);
    else readings.push({ then, ...(r.first ? { first: r.first } : {}), words: [r.words] });
  }
  return readings.map(({ then, first, words }) => {
    const names = words.map((ws) => ws.map((i) => codeSpan(nodes[i].text)));
    const any = names.length > 1 ? names.map((n) => n[0]) : undefined;
    const ja = any ? any.join(' か ') : names[0].join('・');
    const en = any ? `${any.slice(0, -1).join(', ')} or ${any[any.length - 1]} expands` : `${names[0].join(', ')} ${names[0].length > 1 ? 'expand' : 'expands'}`;
    // (A space before code or a word in Latin letters, as docs/japanese-style.md asks.)
    const role = (/^[`A-Za-z]/.test(then) ? ' ' : '') + then;
    return cx.s(`、${ja} が0語なら${first ? 'この語の最初の語は' : ''}${role}`, `; ${first ? 'its first word is ' : ''}${then} when ${en} to nothing`);
  }).join('');
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
    if (r.from === 1) return cx.s(`${codeSpan(a)} が1語に展開されるなら${desc}`, `${desc} when ${codeSpan(a)} expands to a single word`);
    const { ja, en } = countPhrase(cx, several, j);
    return j ? cx.s(`${ja}なら順に${roles}`, `when it expands to ${en}, they are ${roles}`) : cx.s(`${codeSpan(a)} が${ja}に展開されるなら順に${roles}`, `when ${codeSpan(a)} expands to ${en}, they are ${roles}`);
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
  const w = codeSpan(nodes[by.word].text);
  return by.readings.map((r, j) => {
    const { ja, en } = countPhrase(cx, by.readings, j);
    const text = j ? cx.t(r.spec.text) : desc;
    return j ? cx.s(`${ja}なら${text}`, `${text} when it expands to ${en}`) : cx.s(`${w} が${ja}に展開されるなら${text}`, `${text} when ${w} expands to ${en}`);
  }).join(cx.s('、', '; '));
}

/**
 * The roles the words of an operand may have when it or the other words that may give several give more (`MixedRoles`):
 * `cp $a $b` is, of `$b`, "destination (…) when `$a`, `$b` expand to a single word; when any of them expands to more, each of
 * its words is source or destination directory".
 */
function mixedText(cx: Explainer, desc: string, mixed: MixedRoles, nodes: SyntaxNode[]): string {
  const list = mixed.words.map((i) => codeSpan(nodes[i].text)).join(cx.s('・', ', '));
  const texts = mixed.roles.map((o) => cx.t(o.text));
  const roles = texts.length > 1 ? cx.s(`${texts.join('・')}のどれか`, `${texts.slice(0, -1).join(', ')} or ${texts[texts.length - 1]}`) : texts[0];
  const them = cx.s(mixed.many ? 'この語の各語は' : 'この語は', mixed.many ? 'each of its words is' : 'it is');
  if (!mixed.first) return cx.s(`${list} が展開される語数により、${them}${roles}`, `${them} ${roles}, by how many words ${list} expand to`);
  // (A word that gives two words at least, `{a,b}*`: as few as each gives.)
  const one = mixed.words.every((i) => countIn(nodes[i], cx.state)!.min <= 1);
  return one
    ? cx.s(`${list} が1語に展開されるなら${desc}、どれかが2語以上なら${them}${roles}`, `${desc} when ${list} expand to a single word; when any of them expands to more, ${them} ${roles}`)
    : cx.s(`${list} がそれぞれ最も少ない語数に展開されるなら${desc}、どれかがそれより多いなら${them}${roles}`, `${desc} when ${list} expand to as few words as each can; when any of them expands to more, ${them} ${roles}`);
}

/**
 * The roles an operand may have, which depend on how many words the word `by` gives (`cp *.txt dir`): `desc` when it
 * gives its fewest, `other` when it gives more (`cp {a,b}* f`: "… when `{a,b}*` expands to 2 words").
 */
function uncertainText(cx: Explainer, desc: string, other: string, by: number, nodes: SyntaxNode[]): string {
  const w = codeSpan(nodes[by].text);
  const fewest = Math.max(countIn(nodes[by], cx.state)!.min, 1);
  return cx.s(`${w} が${fewest}語に展開されるなら${desc}、${fewest + 1}語以上なら${other}`, `${desc} when ${w} expands to ${fewest === 1 ? 'a single word' : `${fewest} words`}; ${other} when it expands to more`);
}

/**
 * What each of `words` is to the command that reads them, from its role in `roles` (numbered from 0 in `words`), with the
 * words of the commands it runs: `` `-i` (Start with an empty environment) ``. With `option`, a word read as an option says so
 * (`option: …`), and an operand says its role as `eachText` does, with what `hedge` adds to it.
 */
export function wordItems(cx: Explainer, words: readonly ArgWord[], roles: readonly RoleAt[], option: boolean, hedge?: (desc: string, role: Extract<ArgRole, { role: 'operand' }>) => string, nodes?: SyntaxNode[]): string[] {
  const shown = (k: number): string => {
    const w = words[k];
    return w.value !== undefined ? `\`${w.value}\`` : cx.s(`\`${w.prefix}…\`（\`\${…}\` の値は実行時に決まる）`, `\`${w.prefix}…\` (the value of \`\${…}\` is known at run time)`);
  };
  /**
   * The text of an option, or of a letter of a cluster (`word` empty); with `option`, the word says it is one, with its
   * flag where the word holds more (a letter, a value after it) and its value.
   */
  const optionText = (r: ArgRole, word: string): string => {
    const known = r.role === 'option' || r.role === 'pattern-option';
    const text = known ? cx.t(r.text) : cx.s('辞書にないオプション', 'an option not in the dictionary');
    if (!option) return text;
    const o = r as Extract<ArgRole, { role: 'option' | 'unknown-option' | 'pattern-option' }>;
    const named = dash(o.flag) === word ? '' : ` \`${dash(o.flag)}\``;
    const value = o.role !== 'pattern-option' && o.value ? word.slice(o.value.attached) : undefined;
    const said = known ? cx.s(`オプション${named}: ${text}`, `option${named}: ${text}`) : cx.s(`辞書にないオプション${named}`, `option${named} not in the dictionary`);
    return said + (value !== undefined ? cx.s(`、値 \`${value}\``, `, value \`${value}\``) : '');
  };
  const what = (role: ArgRole, word: string): string => {
    switch (role.role) {
      case 'option': case 'pattern-option': return optionText(role, word);
      case 'cluster': case 'old-style': return role.letters.map((l) => optionText(l, '')).join(cx.s('、', ', '));
      case 'value': return cx.s(`\`${dash(role.of)}\` の値`, `value for \`${dash(role.of)}\``);
      case 'operand':
        if (role.spec?.assignment || role.assignment) return cx.s('コマンドの環境に入れる変数', 'variable for the command');
        if (!role.spec) return option && role.none ? hedge!(cx.s('引数', 'argument'), role) : cx.s('引数', 'argument');
        // `destination (the new name…)` reads `destination: the new name…` in the parentheses.
        return !option ? cx.t(role.spec.text) : hedge!(cx.t(role.spec.text).replace(/（(.*)）$/, ': $1').replace(/ \((.*)\)$/, ': $1'), role);
      case 'command': return cx.s('実行するコマンド', 'the command to run') + (role.spec ? `: ${cx.t(role.spec.summary)}` : '');
      case 'subcommand': return cx.s('サブコマンド', 'subcommand') + `: ${cx.t(role.spec.summary)}`;
      case 'end-of-options': return cx.s('オプションの終わり', 'end of options');
      case 'terminator': return cx.s(`\`${role.of}\` の終わり`, `end of \`${role.of}\``);
      case 'expression': return cx.s('式の語', 'a word of the expression');
      case 'joined': return cx.s('コマンド文字列の語', 'a word of the command string');
      default: return optionText(role, word);
    }
  };
  // (A role other than an operand's, with what it takes when a value before it gives none: an operand's says it in `hedge`.)
  const said = (role: ArgRole, word: string): string => what(role, word) + (role.role !== 'operand' && nodes && 'none' in role ? noneText(cx, role.none, nodes) : '');
  const items: string[] = [];
  const walk = (list: readonly RoleAt[]): void => {
    for (const { word, role } of list) {
      items.push(`${shown(word)}${cx.s(`（${said(role, words[word].value ?? '')}）`, ` (${said(role, words[word].value ?? '')})`)}`);
      if ((role.role === 'command' || role.role === 'subcommand') && role.parse) walk(role.parse.roles);
    }
  };
  walk(roles);
  return items;
}

/** "expands to `a` (X) and `b` (Y)": the words a word gives, each with what it is. */
export function listed(cx: Explainer, items: readonly string[]): string {
  const list = items.length > 1 ? `${items.slice(0, -1).join(cx.s('、', ', '))}${cx.s('と ', ' and ')}${items[items.length - 1]}` : items[0];
  return cx.s(`${list}に展開される`, `expands to ${list}`);
}

export const SHIFTS = (cx: Explainer): string => cx.s('（この語か前の語が展開で 1 語以外になると、番号もずれる）', ' (if this word or one before it expands to more or fewer words, the number shifts)');

/**
 * The positional parameters a function gets from its word `word` (of `nodes`, its words): from the words before it, each
 * as many as the model knows it gives (`x=; f $x d`: `d` is `$1`; `p='a b'; f $p d`: `$1` and `$2`, then `$3`).
 */
export function functionArgs(cx: Explainer, nodes: readonly SyntaxNode[], word: number): string {
  let n = 1;
  let sure = true;
  const gives = (w: SyntaxNode): number | undefined => {
    const c = countIn(w, cx.state);
    return !c ? 1 : c.min === c.max ? c.min : undefined;
  };
  for (const w of nodes.slice(0, word)) {
    const k = gives(w);
    sure &&= k !== undefined;
    n += k ?? 1;
  }
  const own = gives(nodes[word]);
  const names = Array.from({ length: Math.max(own ?? 1, 1) }, (_, k) => `$${n + k}`);
  const fields = (own ?? 1) > 1 ? fieldsIn(nodes[word], cx.state) : undefined;
  const text = fields ? cx.s(`関数への引数 ${fields.map((f, k) => `${names[k]}（\`${f}\`）`).join('、')}`, `Arguments ${fields.map((f, k) => `${names[k]} (\`${f}\`)`).join(', ')} to the function`)
    : cx.s(`関数への引数 ${names[0]}`, `Argument ${names[0]} to the function`);
  return sure && own !== undefined ? text : text + SHIFTS(cx);
}

/**
 * The words a brace expansion gives, each with its role (`cp a{,.bak}`: the source, then the destination); the fields
 * the model knows (`fields`) where an expansion in one of them may split it or give none (`x='p q'; cp {a,$x}`: `a`, `p` and `q`;
 * `x='p q'; y=; cp {$x,$y}`: `p` and `q`, both of `$x`), which an exact count of such a word is (`countIn`), as for a
 * word of no braces (`z=; p='a b'; cp $z $p`: `a` and `b`); a `$N` in a role is the number of its word (`numbers`).
 */
export function eachText(cx: Explainer, a: SyntaxNode, each: OperandSpec[], numbers: readonly { n: number }[], fields: readonly string[] | undefined): string {
  const braces = braceAlternatives([a]);
  const words = !braces || braces.some(splitsIn) ? fields! : braceTexts([a])!;
  // `destination (the new name…)` reads `destination: the new name…` in the parentheses.
  const role = (k: number): string => numbered(cx.t(each[k].text).replace(/（(.*)）$/, ': $1').replace(/ \((.*)\)$/, ': $1'), numbers[k]);
  return listed(cx, words.map((w, k) => `\`${w}\`${cx.s(`（${role(k)}）`, ` (${role(k)})`)}`));
}

/**
 * `text` with its `$N` the number of its word (`number`). (A word of several fields of other roles, or of a brace expansion,
 * comes before the options end, so no word before it has a count that is not known: the number is sure.)
 */
export function numbered(text: string, number: { n: number } | undefined): string {
  return number ? text.replace('`$N`', `\`$${number.n}\``) : text;
}

const dash = (flag: string): string => flag.replace(/^\+/, '-');
