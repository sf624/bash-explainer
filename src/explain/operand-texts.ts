// What a word of a command is for every count of the words that may give other than one word (src/explain/argv.ts;
// an operand's `readings`, src/argv/profiles.ts, said with the texts of src/argv/profiletexts.ts), the hedges of the other
// roles (`ArgRole` `none`, `more`, `ValueRole` `rest`), and what each of the words read in place of one is to the command
// (the fields of a word, a value `env -S` splits).
import type { Token } from '../analyzer-types';
import type { Text } from '../i18n';
import { codeSpan } from '../label';
import type { ArgRole, ArgWord, MoreRole, NoneRole, RoleAt, ThenRole, ValueRole } from '../argv/interpret';
import { type Depends, type Role, squeeze, type WordReadings } from '../argv/profiles';
import { baseText, clausesText, dependsText, type Names } from '../argv/profiletexts';
import type { OperandSpec } from '../argv/spec';
import { splitsIn } from '../argv/words';
import { braceAlternatives, braceTexts } from '../semantics/brace';
import { countIn, fieldsIn } from '../semantics/argwords';
import { field, type SyntaxNode } from '../syntax/tree';
import type { Explainer } from './context';

/**
 * What a command's word `k` (of `nodes`, the command's words) is for every count of the words that may give other than
 * one word (`readings`), with `desc` its role as written: `base`, what it is as written (`desc`, or by place or by own
 * count: "source when `$a` expands to a single word; when it expands to 2 words, they are …"), and `rest`, the clauses
 * of its other classes, each a sentence (". When `$d` and `$a` expand to nothing, it is value for `-t`."), or what they
 * fold into, or that its role may depend on the counts.
 */
export function readingsParts(cx: Explainer, desc: string, readings: WordReadings | Depends | undefined, k: number, nodes: readonly SyntaxNode[]): { base: string; rest: string } {
  if (!readings) return { base: desc, rest: '' };
  // (The command that reads the line, which a role read by it names where another reads the word: "option `-n` of `nice`".)
  const command = field(nodes[0].parent!, 'name')!.text;
  const first = readings.kind === 'read' ? firstRole(readings) : undefined;
  const names = namesFor(nodes, command, first);
  // (Each a sentence of its own: ". When …", "。…なら…".)
  const sentences = (ts: readonly Text[]): string => ts.map((t) => cx.s(`。${t.ja}`, `. ${t.en.charAt(0).toUpperCase()}${t.en.slice(1)}`)).join('');
  if (readings.kind === 'depends') return { base: desc, rest: sentences([dependsText(readings, names)]) };
  const p = readings.base;
  // (One role as written, or a word of a known number of words: `desc` says it.)
  const plain = !p.groups.length || p.counts.length === 1 || (!!p.places && squeeze(p.places).length === 1);
  // (In its profile as written, its role as written is `desc`.)
  return { base: plain ? desc : cx.t(baseText(p, k, namesFor(nodes, command, first, desc))), rest: sentences(clausesText(readings, k, names)) };
}

/** The role of the first word of a word as written (its base profile), if it has one. */
function firstRole(r: WordReadings): Role | undefined {
  return r.base.places?.[0] ?? r.base.groups[0]?.roles[0];
}

/**
 * What the texts of a word's readings name: the command's words, as code; each role in both languages, `desc` (where
 * given) for the role of its first word as written (`base`), and the command that reads it where another command reads
 * that one ("option `-n` (…) of `nice`").
 */
function namesFor(nodes: readonly SyntaxNode[], command: string, base: Role | undefined, desc?: string): Names {
  const path = (r: Role): string => r.by.map((x) => x ?? '?').join(' ');
  return {
    word: (k) => codeSpan(nodes[k].text),
    role: (r) => {
      if (desc !== undefined && r.key === base?.key) return { ja: desc, en: desc };
      const t = roleWords(r.role);
      if (!base || path(r) === path(base)) return t;
      const at = r.by.at(-1);
      const name = !r.by.length ? command : at === undefined ? undefined : nodes[at].text;
      return name === undefined ? { ja: `実行されるコマンドの${spaced(t.ja)}`, en: `${t.en} of the command it runs` } : { ja: `${codeSpan(name)} の${spaced(t.ja)}`, en: `${t.en} of ${codeSpan(name)}` };
    },
  };
}

/**
 * A role as the readings name it, in both languages: an operand's text, an option with its flag, a value… (A reading of
 * the table has no word read as its fields, nor one of unknown text read as an option: an argument.)
 */
function roleWords(r: ArgRole): Text {
  const flags = (rs: readonly ArgRole[]): string[] => rs.map((l) => `\`${dash((l as { flag: string }).flag)}\``);
  switch (r.role) {
    case 'operand': return r.spec?.text ?? { ja: '引数', en: 'argument' };
    case 'value': return valueWords(r);
    case 'option': case 'pattern-option': return { ja: `オプション \`${dash(r.flag)}\`（${r.text.ja}）`, en: `option \`${dash(r.flag)}\` (${r.text.en})` };
    case 'unknown-option': return { ja: `辞書にないオプション \`${dash(r.flag)}\``, en: `option \`${dash(r.flag)}\` not in the dictionary` };
    case 'cluster': case 'old-style': return { ja: `オプション ${flags(r.letters).join('・')}`, en: `options ${flags(r.letters).join(', ')}` };
    case 'end-of-options': return { ja: 'オプションの終わり', en: 'end of options' };
    case 'command': return r.item?.text ?? { ja: '実行するコマンド', en: 'the command to run' };
    case 'subcommand': return { ja: `サブコマンド \`${r.name}\``, en: `subcommand \`${r.name}\`` };
    case 'terminator': return { ja: `\`${r.of}\` の終わり`, en: `end of \`${r.of}\`` };
    case 'expression': return { ja: '式の語', en: 'a word of the expression' };
    case 'joined': return { ja: 'コマンド文字列の語', en: 'a word of the command string' };
    default: return { ja: '引数', en: 'argument' };
  }
}

/** What a hedge reads of a role: the roles when words before it give none (`none`) or several (`more`). */
type Counted = { none?: readonly NoneRole[]; more?: readonly MoreRole[] };

/** The roles a word takes when words before it give several (`more`) or none (`none`), in that order. */
function countsText(cx: Explainer, role: Counted, nodes: SyntaxNode[]): string {
  return moreText(cx, role.more, nodes) + noneText(cx, role.none, nodes);
}

/** The token `t` of a word, with the roles it takes when words before it give several or none (`ArgRole` `more`, `none`). */
export function withNone(cx: Explainer, t: Token, role: Counted | undefined, nodes: SyntaxNode[]): Token {
  return role && (role.none || role.more) ? { ...t, explanation: t.explanation + countsText(cx, role, nodes) } : t;
}

/** A role a hedge names (`ThenRole`): an operand's text, the value of an option, or an argument the spec does not describe. */
const thenText = (cx: Explainer, r: ThenRole): string => (r.spec ? cx.t(r.spec.text) : r.value ? valueText(cx, r.value) : cx.s('引数', 'argument'));

/** Roles as a hedge lists them: "X or Y", "X・Yのどれか". */
function anyOf(cx: Explainer, texts: string[]): string {
  return cx.s(texts.join('・') + (texts.length > 1 ? 'のどれか' : ''), texts.length > 1 ? `${texts.slice(0, -1).join(', ')} or ${texts[texts.length - 1]}` : texts[0]);
}

/** (A space before code or a word in Latin letters after Japanese, as docs/japanese-style.md asks.) */
const spaced = (text: string): string => (/^[`A-Za-z]/.test(text) ? ' ' : '') + text;

/**
 * The roles the words after the first of an option's value `a` take when it gives several words (`ValueRole` `rest`):
 * `head -n $a f`, "…; when `$a` expands to several words, this value is the first word `$a` gives, and each of the
 * others is target file"; or that they are read as the words after it, where the interpreter names no role of theirs.
 */
export function restText(cx: Explainer, rest: readonly ThenRole[] | undefined, a: string): string {
  if (!rest) return '';
  const w = codeSpan(a);
  if (!rest.length) return cx.s(`、${w} が2語以上に展開されるならこの値は最初の語で、残りの語は後に続く引数として読まれる`, `; when ${w} expands to several words, this value is the first word ${w} gives, and the others are read as the words after it`);
  const list = anyOf(cx, rest.map((r) => thenText(cx, r)));
  return cx.s(`、${w} が2語以上に展開されるならこの値は最初の語で、残りの各語は${spaced(list)}`, `; when ${w} expands to several words, this value is the first word ${w} gives, and each of the others is ${list}`);
}

/**
 * The roles a word may take when an option's value before it gives several words (`ArgRole` `more`), each "; X when
 * `$a` expands to several words" (`jq --arg $n $v .`: `$v` is the filter when `$n` gives two words), "X or Y" where
 * they depend on counts, "its first word is …" where the word may give several.
 */
function moreText(cx: Explainer, more: readonly MoreRole[] | undefined, nodes: SyntaxNode[]): string {
  return (more ?? []).map(({ roles, first, word }) => {
    const then = anyOf(cx, roles.map((o) => thenText(cx, o)));
    const name = codeSpan(nodes[word].text);
    return cx.s(`、${name} が2語以上なら${first ? 'この語の最初の語は' : ''}${spaced(then)}`, `; ${first ? 'its first word is ' : ''}${then} when ${name} expands to several words`);
  }).join('');
}

/** The value `v` of an option, as a hedge says it: "value for `-f`", "name for `--arg`" (`jq --arg NAME VALUE`). */
function valueWords(v: ValueRole): Text {
  const flag = dash(v.of);
  if (Array.isArray(v.option?.value) && v.option.value.length === 2) return v.index ? { ja: `\`${flag}\` の値`, en: `value for \`${flag}\`` } : { ja: `\`${flag}\` の名前`, en: `name for \`${flag}\`` };
  return /^-/.test(flag) ? { ja: `\`${flag}\` オプションの値`, en: `value for \`${flag}\`` } : { ja: `\`${flag}\` の値`, en: `value for \`${flag}\`` };
}
const valueText = (cx: Explainer, v: ValueRole): string => cx.t(valueWords(v));

/**
 * The roles a word takes when an option's value before it gives none (`ArgRole` `none`, each of one word), each "; X
 * when `$a` expands to nothing": an operand's (`grep -e $p -e x f`: "file to search"), or an option's value
 * (`grep -e $p -i f`: "value for `-e`"), or its first word's where it may give several ("its first word is …").
 */
export function noneText(cx: Explainer, none: readonly NoneRole[] | undefined, nodes: SyntaxNode[]): string {
  return (none ?? []).map((r) => {
    const then = r.spec ? cx.t(r.spec.text) : valueText(cx, r.value);
    const name = r.words.map((i) => codeSpan(nodes[i].text)).join(cx.s('・', ', '));
    return cx.s(`、${name} が0語なら${r.first ? 'この語の最初の語は' : ''}${spaced(then)}`, `; ${r.first ? 'its first word is ' : ''}${then} when ${name} expands to nothing`);
  }).join('');
}

/**
 * What each of `words` is to the command that reads them, from its role in `roles` (numbered from 0 in `words`), with the
 * words of the commands it runs: `` `-i` (Start with an empty environment) ``. With `option`, a word read as an option says so
 * (`option: …`), and an operand says its role as `eachText` does, numbered by `number` (its `$N`).
 */
export function wordItems(cx: Explainer, words: readonly ArgWord[], roles: readonly RoleAt[], option: boolean, number?: (desc: string, role: Extract<ArgRole, { role: 'operand' }>) => string, nodes?: SyntaxNode[]): string[] {
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
        if (!role.spec) return cx.s('引数', 'argument');
        // `destination (the new name…)` reads `destination: the new name…` in the parentheses.
        return !option ? cx.t(role.spec.text) : number!(cx.t(role.spec.text).replace(/（(.*)）$/, ': $1').replace(/ \((.*)\)$/, ': $1'), role);
      case 'command': return cx.s('実行するコマンド', 'the command to run') + (role.spec ? `: ${cx.t(role.spec.summary)}` : '');
      case 'subcommand': return cx.s('サブコマンド', 'subcommand') + `: ${cx.t(role.spec.summary)}`;
      case 'end-of-options': return cx.s('オプションの終わり', 'end of options');
      case 'terminator': return cx.s(`\`${role.of}\` の終わり`, `end of \`${role.of}\``);
      case 'expression': return cx.s('式の語', 'a word of the expression');
      case 'joined': return cx.s('コマンド文字列の語', 'a word of the command string');
      default: return optionText(role, word);
    }
  };
  // (A role other than an operand's, with what it takes when a value before it gives none or several: an operand's says
  // it in the readings of its word.)
  const said = (role: ArgRole, word: string): string => what(role, word) + (role.role !== 'operand' && nodes && ('none' in role || 'more' in role) ? countsText(cx, role, nodes) : '');
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
