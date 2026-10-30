// What a word of a command is for every count of the words that may give other than one word (src/explain/argv.ts;
// the `readings` of its role, src/argv/profiles.ts, said with the texts of src/argv/profiletexts.ts), and what each of the
// words read in place of one is to the command (the fields of a word, a value `env -S` splits).
import type { Token } from '../analyzer-types';
import type { Text } from '../i18n';
import { codeSpan } from '../label';
import { isPlainWord } from '../staticword';
import type { ArgRole, ArgWord, FieldsRole, OperandRole, Readings, RoleAt, ValueRole } from '../argv/interpret';
import { type Role, squeeze, type WordReadings } from '../argv/profiles';
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
export function readingsParts(cx: Explainer, desc: string | undefined, readings: Readings | undefined, k: number, nodes: readonly SyntaxNode[]): { base: string; rest: string } {
  if (!readings) return { base: desc!, rest: '' };
  // (The command that reads the line, which a role read by it names where another reads the word: "option `-n` of `nice`".)
  const command = field(nodes[0].parent!, 'name')!.text;
  const first = readings.kind === 'read' ? firstRole(readings) : undefined;
  const names = namesFor(nodes, command, first);
  // (Each a sentence of its own: ". When …", "。…なら…".)
  const sentences = (ts: readonly Text[]): string => ts.map((t) => cx.s(`。${t.ja}`, `. ${t.en.charAt(0).toUpperCase()}${t.en.slice(1)}`)).join('');
  if (readings.kind === 'depends') return { base: desc!, rest: sentences([dependsText(readings, names)]) };
  const p = readings.base;
  // (One role as written, or a word of a known number of words: `desc` says it.)
  const plain = desc !== undefined && (!p.groups.length || p.counts.length === 1 || (!!p.places && squeeze(p.places).length === 1));
  // (In its profile as written, its role as written is `desc`; not in a list of its words, "its words are X, then Y".)
  const list = !!p.places && p.counts[0] > 1;
  return { base: plain ? desc : cx.t(baseText(p, k, namesFor(nodes, command, first, list ? undefined : desc))), rest: sentences(clausesText(readings, k, names)) };
}

/**
 * The token `t` of the command's word `k` (of `nodes`), with what it is for every count of the words that may give other
 * than one word (`readings`): its explanation as its role as written, then the clauses (`grep -e $p -i f`, of `-i`:
 * ". When `$p` expands to nothing, it is value for `-e`"; `head -n $a f`, of `$a`: "…; when `$a` expands to several
 * words, this is the role of the first word `$a` gives, and each of the others is target file").
 */
export function withReadings(cx: Explainer, t: Token, readings: Readings | undefined, k: number, nodes: readonly SyntaxNode[]): Token {
  const { base, rest } = readingsParts(cx, t.explanation, readings, k, nodes);
  return base === t.explanation && !rest ? t : { ...t, explanation: base + rest };
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
      if (name === undefined) return { ja: `実行されるコマンドの${spaced(t.ja)}`, en: `${t.en} of the command it runs` };
      // (A command named by a word of the expansion, `sudo -u $u ls` with two words of `$u`: the command a word of `$u` names.)
      if (at !== undefined && !isPlainWord(nodes[at])) return { ja: `${codeSpan(name)} の語が指すコマンドの${spaced(t.ja)}`, en: `${t.en} of the command a word of ${codeSpan(name)} names` };
      // ("`sudo` が実行するコマンド": a role that says what the command does.)
      return { ja: `${codeSpan(name)} ${/^実行する/.test(t.ja) ? 'が' : 'の'}${spaced(t.ja)}`, en: `${t.en} of ${codeSpan(name)}` };
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
    case 'unknown-option': return { ja: `オプション \`${dash(r.flag)}\`（辞書に未登録）`, en: `option \`${dash(r.flag)}\` (not in the dictionary)` };
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

/** (A space before code or a word in Latin letters after Japanese, as docs/japanese-style.md asks.) */
const spaced = (text: string): string => (/^[`A-Za-z]/.test(text) ? ' ' : '') + text;

/** The value `v` of an option, as the readings name it: "value for `-f`", "name for `--arg`" (`jq --arg NAME VALUE`). */
function valueWords(v: ValueRole): Text {
  const flag = dash(v.of);
  if (Array.isArray(v.option?.value) && v.option.value.length === 2) return v.index ? { ja: `\`${flag}\` の値`, en: `value for \`${flag}\`` } : { ja: `\`${flag}\` の名前`, en: `name for \`${flag}\`` };
  return /^-/.test(flag) ? { ja: `\`${flag}\` オプションの値`, en: `value for \`${flag}\`` } : { ja: `\`${flag}\` の値`, en: `value for \`${flag}\`` };
}
/**
 * What each of `words` is to the command that reads them, from its role in `roles` (numbered from 0 in `words`), with the
 * words of the commands it runs: `` `-i` (Start with an empty environment) ``. With `option`, a word read as an option says so
 * (`option: …`), and an operand says its role as `eachText` does, numbered by `number` (its `$N`).
 */
export function wordItems(cx: Explainer, words: readonly ArgWord[], roles: readonly RoleAt[], option: boolean, number?: (desc: string, role: Extract<ArgRole, { role: 'operand' }>) => string): string[] {
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
      // (`jq --arg "$x"{a,b}`: the name, then the value.)
      case 'value': return Array.isArray(role.option?.value) && role.option.value.length === 2 ? cx.t(valueWords(role)) : cx.s(`\`${dash(role.of)}\` の値`, `value for \`${dash(role.of)}\``);
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
  const items: string[] = [];
  const walk = (list: readonly RoleAt[]): void => {
    for (const { word, role } of list) {
      items.push(`${shown(word)}${cx.s(`（${what(role, words[word].value ?? '')}）`, ` (${what(role, words[word].value ?? '')})`)}`);
      if ((role.role === 'command' || role.role === 'subcommand') && role.parse) walk(role.parse.roles);
    }
  };
  walk(roles);
  return items;
}

/**
 * What the word `a` (of `nodes`, the command's words) read as its fields says (`FieldsRole`): what each field is to the
 * command ("expands to `-r` (option: …) and `a` (source)"; the words of a brace expansion whose texts are not known as
 * written, `"$x"{a,b}`: `"$x"a`, `"$x"b`), each operand numbered by `number`, then the clauses of its readings; a word
 * that gives its fewest words or more (`"$x"{a,b}$y`) says its words for each count, from its readings.
 */
export function fieldsText(cx: Explainer, role: FieldsRole, a: SyntaxNode, nodes: readonly SyntaxNode[], number: (desc: string, role: OperandRole) => string): string {
  const texts = role.words.some((w) => w.value === undefined) ? braceTexts([a], false, cx.bashVersion) : undefined;
  const words = texts?.length === role.words.length ? texts.map((value) => ({ value })) : role.words;
  const many = role.readings?.kind === 'read' && role.readings.base.counts.length > 1;
  const said = many ? undefined : listed(cx, wordItems(cx, words, role.roles, true, number));
  const { base, rest } = readingsParts(cx, said, role.readings, nodes.indexOf(a), nodes);
  return base + rest;
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
  const version = cx.bashVersion;
  const braces = braceAlternatives([a], false, version);
  const words = !braces || braces.some(splitsIn) ? fields! : braceTexts([a], false, version)!;
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
