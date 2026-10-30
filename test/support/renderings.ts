// The renderings and the roles (docs/design/oracles.md, 2.5, 2.8 and step 9): on top of the argv capture
// (test/support/argv.ts), what the explanation shows of each word is compared with the argv bash gave the recorder.
//
// - **Renderings.** Some parts of the explanation state how many words bash makes of a word (`claimsOf`): the value of
//   an expansion and the words it splits into (`Token.value`), a brace expansion (its token and its example), a
//   double-quoted string that "stays one argument", a concatenation "joined into one word" (or into N, or none), and the token of an argument
//   with no `Token.expands` (the panel shows it as one argument). Each must be the number of fields bash gave the word,
//   in every run. Where the model knows the word's fields, they are bash's (the argv check confirmed them); where it
//   does not (2.3: then the explanation must state no count bash can contradict), bash's are those between the known
//   words around it, when it is the only word not known (`wordCounts`). A glob example is shown only where the model
//   says the glob step may apply.
// - **Roles.** The argument interpreter (src/argv/) reads the fields the model knows of a word, and the words it does not
//   know as written. Where the model knows the fields of every word and some word gives other than one, the interpreter
//   reads bash's argv, and the role of each field must be one the explanation shows on its word: the same option, the
//   value of the same option, or an operand whose text from the spec the word's token says (alone, in the list of its
//   fields, "expands to `-r` (option: …) and `a` (source)", or in the readings of the word (the texts of src/argv/profiletexts.ts,
//   read by `readingsSay`, on the token of any role): its profile as written, by place or by own count, unless a clause
//   "When `$x` expands to nothing, it is …" holds for the counts, or a folded text "It can also be …").
//
// The counts come from the facts the tokens carry (`Token.value`, `Token.expands`, `Token.origin`, the refs and the
// words of a brace expansion, the sections of an example); only the string and the concatenation are told by their
// sentence, which is the one thing that differs between their two forms, a glob example with no interactive spec by its
// title, and the roles by the spec's texts (`Token` has no fact id or count of words yet: oracles.md 2.8). Differences
// are listed in test/fixtures/renderings-known.json with their reasons, as in argv-known.json.
import * as path from 'path';
import { Analyzer, type Example, type Span, type Token } from '../../src/analyzer';
import { type ArgRole, interpret } from '../../src/argv/interpret';
import { lookupCommand } from '../../src/dict/aliases';
import { isGlob } from '../../src/examples/shellwords';
import { braceExpansion } from '../../src/explain/words';
import { spanOf } from '../../src/noteanchors';
import { resolveName } from '../../src/semantics/names';
import { type StateModel } from '../../src/semantics/state';
import { type Fields, wordFields, wordMeaning } from '../../src/semantics/words';
import { descendants, field, type SyntaxNode } from '../../src/syntax/tree';
import { type ArgvEnvName, ARGV_ENVS, type ArgvInput, type ArgvMarker, type ArgvPlanRun, compareMarker, runEnv, splitTargets } from './argv';

// ---------------------------------------------------------------------------------------------------
// What the explanation shows of each word.

/** The tokens and the examples of an input's explanation, by their span (`spanKey`). */
export interface Shown { tokens: Map<string, Token[]>; examples: Map<string, Example[]> }

export const spanKey = (s: Span): string => `${s.start.line}:${s.start.character}-${s.end.line}:${s.end.character}`;

const allTokens = (ts: readonly Token[]): Token[] => ts.flatMap((t) => [t, ...allTokens(t.children)]);

/** Explains every line of an input in English, as the extension does (a host's region with its options). */
export function explainInput(input: ArgvInput, analyzer = new Analyzer('en')): Shown {
  const shown: Shown = { tokens: new Map(), examples: new Map() };
  const add = <T>(map: Map<string, T[]>, k: string, v: T): void => { map.set(k, [...(map.get(k) ?? []), v]); };
  const rows = input.tree.root.endPosition.row + 1;
  for (let row = 0; row < rows; row++) {
    const e = analyzer.explainLine(input.tree, row, input.explain?.shell ?? 'bash', input.explain?.opts ?? {});
    for (const t of allTokens(e.items)) add(shown.tokens, spanKey(t.span), t);
    for (const x of e.examples) if (x.anchor) add(shown.examples, spanKey(x.anchor), x);
  }
  return shown;
}

/** Where a count of words is said: see the head of this file. */
export type ClaimSource = 'value' | 'brace' | 'brace-example' | 'string' | 'argument' | 'concatenation';

/** A number of words the explanation says bash makes of a word. */
export interface Claim { source: ClaimSource; count: number }

const BRACE_REF = '3.5.1';

/**
 * The numbers of words the explanation says bash makes of the word `w` (its tokens and examples over the whole word):
 * - `value`: the value of an expansion that is the whole word, and the words it splits into; none where bash then globs it;
 * - `brace`: the token of a brace expansion, where the model says the braces expand, none of the words is a glob, and
 *   it does not say that the expansions in them may then make more or fewer words (`{a,$x}`);
 * - `brace-example`: the words of the example of a brace expansion ("N separate arguments"), unless cut;
 * - `string`: a double-quoted string that "stays one argument" (not the one of `"$@"`, one word per element);
 * - `concatenation`: a word of several parts that are "joined into one word" (not one with `"$@"` in it, which says
 *   it is not one word, nor one that may be none or several), or that brace expansion or word splitting make N words of,
 *   or none;
 * - `argument`: the token of an argument or an option's value with no `Token.expands`, which the panel shows as one argument.
 */
export function claimsOf(w: SyntaxNode, shown: Shown, input: ArgvInput): Claim[] {
  const key = spanKey(spanOf(w));
  const out: Claim[] = [];
  const steps = wordMeaning(w, input.model)?.steps ?? [];
  const applies = (k: string) => steps.find((s) => s.kind === k)?.applies;
  for (const t of shown.tokens.get(key) ?? []) {
    if (t.value && !t.value.glob && !t.value.joined) out.push({ source: 'value', count: t.value.words?.length ?? 1 });
    if (t.kind === 'expansion' && t.refs?.includes(BRACE_REF) && applies('brace') === true) {
      const words = braceExpansion(w);
      // (Not one that says the expansions in its words may then make other words of them, `{a,$x}`.)
      if (words && !words.some(isGlob) && !t.explanation.includes('which the expansions after it may make')) out.push({ source: 'brace', count: words.length });
    }
    // (The rendered sentence: which of the two `string` of src/explain/words.ts chose.)
    if (t.kind === 'string' && t.explanation.includes('(stays one argument)')) out.push({ source: 'string', count: 1 });
    if (t.kind === 'argument' && t.origin === 'argv' && !t.expands) out.push({ source: 'argument', count: 1 });
    if (t.kind === 'argument' && t.origin === 'shell') {
      // (A concatenation is one word only where bash surely makes one of it; else the count where it is known, or none.)
      const many = /^Concatenation: the parts below are joined, but .* makes? (\d+) words of it/.exec(t.explanation);
      if (/^Concatenation: the parts below are joined into one word(?!, or none)/.test(t.explanation)) out.push({ source: 'concatenation', count: 1 });
      else if (many) out.push({ source: 'concatenation', count: Number(many[1]) });
      else if (t.explanation.startsWith('Concatenation: the parts below all expand to nothing')) out.push({ source: 'concatenation', count: 0 });
    }
  }
  for (const x of shown.examples.get(key) ?? []) {
    const words = x.kind === 'glob' ? x.sections.find((s) => s.words) : undefined;
    if (words && !words.words!.after) out.push({ source: 'brace-example', count: words.lines.length });
  }
  return out;
}

/** Whether the explanation shows an example of the files a glob matches on the word `w` (not one of a brace expansion). */
export function globExampleOn(w: SyntaxNode, shown: Shown): boolean {
  // (Not the example of a pattern a command matches, find's `-name '*.log'`: the files are those of a glob alone.)
  return (shown.examples.get(spanKey(spanOf(w))) ?? []).some((x) => x.kind === 'glob' && !x.sections.some((s) => s.words)
    && (x.interactive ? x.interactive.spec.kind === 'glob' && x.interactive.spec.mode === 'file' : x.title.startsWith('Example (glob ')));
}

/**
 * What may make other than one word of `w`, from the model and the syntax, not from the explanation: the steps of brace
 * expansion, word splitting and globbing that apply to it or may (`wordMeaning`), and whether a part gives one word
 * per element (`"$@"`, `"${@:2}"`, `"${a[@]}"`, `"${!a[@]}"`, and unquoted `$@/a`, `${a[@]}x`, which are also split
 * further; written so, whatever bash then gives).
 */
export interface WordCauses { steps: ('brace' | 'split' | 'glob')[]; perElement: boolean }

/** An expansion that gives one word per element (in double quotes; unquoted, each is split further). */
const PER_ELEMENT = /^\$(@|\{!?@|\{!?[A-Za-z_]\w*\[@\]|\{![A-Za-z_]\w*@\})/;

export function wordCauses(w: SyntaxNode, model: StateModel): WordCauses {
  const steps = (wordMeaning(w, model)?.steps ?? []).filter((s) => (s.kind === 'brace' || s.kind === 'split' || s.kind === 'glob') && s.applies !== false);
  return { steps: steps.map((s) => s.kind as WordCauses['steps'][number]), perElement: descendants(w, ['simple_expansion', 'expansion']).some((e) => PER_ELEMENT.test(e.text)) };
}

// ---------------------------------------------------------------------------------------------------
// Comparing.

/**
 * A difference: the input, the environment, the command, the word, which check, and what differs; for a count, what
 * may make other than one word of the word (`causes`), which a class of known differences may require.
 */
export interface RenderFinding { input: string; env: ArgvEnvName; command: string; word: string; check: 'count' | 'glob-example' | 'role'; source?: ClaimSource; causes?: WordCauses; what: string }

/**
 * What the checks went over, in each environment: the words with a count said and bash's known (`words`; `unknown`: of
 * them, those the model gives no fields), the counts compared (`claims`), the glob examples, and the commands whose
 * argv the interpreter read again (`roleCommands`) with the fields compared (`roleFields`).
 */
export interface RenderCounts { words: number; unknown: number; claims: number; globExamples: number; roleCommands: number; roleFields: number }

/**
 * The number of fields bash gave each word of a marker in one run (`argv`), where it is known: the model's, with the
 * run's environment, for a word it knows; for the only word it does not know, what lies between the known words
 * around it. Undefined where more than one word is not known.
 */
export function wordCounts(results: readonly Fields[], argv: readonly string[]): (number | undefined)[] {
  const unknown = results.filter((r) => !r.fields).length;
  const known = results.reduce((n, r) => n + (r.fields?.length ?? 0), 0);
  return results.map((r) => r.fields?.length ?? (unknown === 1 ? argv.length - known : undefined));
}

/** `-x` as the texts write it (`+x` of `set +x`). */
const dash = (flag: string): string => flag.replace(/^\+/, '-');
/** A text with its `$N` numbers made alike (`$3` in a token, `$N` in the spec). */
const plain = (s: string): string => s.replace(/`\$(\d+|N)`/g, '`$N`');

/** Where a field lies among the fields of the marker: its text, its place in its word (`at` of `of`), and the number of fields each word of the marker gave, by its text. */
export interface FieldPlace { text: string; at: number; of: number; counts: ReadonlyMap<string, number> }

/** The flags of an option's role, as written (one per letter of a cluster or of old-style letters), with their texts. */
function flagsOf(role: ArgRole): { flag: string; text?: string }[] {
  switch (role.role) {
    case 'option': case 'pattern-option': return [{ flag: role.flag, text: role.text.en }];
    case 'unknown-option': return [{ flag: role.flag }];
    case 'cluster': case 'old-style': return role.letters.flatMap(flagsOf);
    default: return [];
  }
}

/**
 * Whether an option's token shows the flag: its text from the spec, the flag in backquotes (as a cluster lists its
 * letters, and `+x` says `-x`), or the flag as the token's label.
 */
const showsFlag = (t: Token, { flag, text }: { flag: string; text?: string }): boolean => t.kind === 'option'
  && ((!!text && t.explanation.includes(text)) || [flag, dash(flag)].some((f) => t.explanation.includes(`\`${f}\``) || t.label === f));

/**
 * The roles in a row of the words of one count, "A, then B, then C" (a role repeated in a row once), that a field at
 * `at` of `of` may be: the first the first, the last the last, and any of them between.
 */
function inRow(list: string, at: number, of: number): string[] {
  const roles = list.split(', then ');
  if (at === 0) return [roles[0]];
  if (at === of - 1) return [roles[roles.length - 1]];
  return roles;
}

/**
 * The roles by place, "A, then B, then C" (a role repeated in a row once, the last for every word after), that the field
 * at `at` may be: the first the first, and any of the first `at + 1` after.
 */
const inPlaces = (list: string, at: number): string[] => list.split(', then ').slice(0, at + 1);

/**
 * A profile by own count (src/argv/profiletexts.ts, `byCountText`): "X when `$a` expands to a single word", then "when it
 * expands to 2 words (2 words or more, 1 to 3 words, more words), they are Y, then Z", where "more words" is from the
 * count after the group before; the first may name the word ("when `$a` expands to 2 words, …"). Each group, its counts
 * and its roles; undefined for a text in another form.
 */
function countGroups(e: string): { from: number; to?: number; text: string }[] | undefined {
  const out: { from: number; to?: number; text: string }[] = [];
  for (const [j, part] of e.split('; ').entries()) {
    const one = j ? null : /^(.*) when `[^`]+` expands to a single word$/.exec(part);
    if (one) { out.push({ from: 1, to: 1, text: one[1] }); continue; }
    const m = new RegExp(`^when ${j ? 'it' : '`[^`]+`'} expands to (?:(more words)|(\\d+) to (\\d+) words|(\\d+) words( or more)?), they are (.*)$`).exec(part);
    if (!m) return undefined;
    const before = out[out.length - 1]?.to;
    if (m[1] && before === undefined) return undefined;
    const from = m[1] ? before! + 1 : Number(m[2] ?? m[4]);
    out.push({ from, to: m[1] || m[5] ? undefined : Number(m[3] ?? m[4]), text: m[6] });
  }
  return out.length > 1 || out[0].from > 1 ? out : undefined;
}

/**
 * The roles a profile (src/argv/profiletexts.ts) says the field at `place` may have: by own count (`countGroups`, the
 * group that holds the number of fields its word gave); by place, "X; when `$a` expands to several words, this is the
 * role of the first word `$a` gives, and the others are Y, then Z" (or "each of the others is Y"), the last for every
 * word after; "its words are X, then Y"; or one role. Undefined where a group holds no such count, or for a condition in
 * another form.
 */
function profileSays(e: string, place: FieldPlace): string[] | undefined {
  const groups = countGroups(e);
  if (groups) {
    const g = groups.find((c) => c.from <= place.of && place.of <= (c.to ?? Infinity));
    return g && (g.from === 1 && g.to === 1 ? [g.text] : inRow(g.text, place.at, place.of));
  }
  const byPlace = /^(.*?); when `[^`]+` expands to several words, this is the role of the first word `[^`]+` gives, and (?:the others are|each of the others is) (.*)$/.exec(e);
  if (byPlace) return place.at === 0 ? [byPlace[1]] : inPlaces(byPlace[2], place.at - 1);
  const words = /^its words are (.*)$/.exec(e);
  if (words) return inPlaces(words[1], place.at);
  // (A condition in a form not read here: a finding.)
  return /when `[^`]+` expands? to /.test(e) ? undefined : [e];
}

/** One atom of a condition (src/argv/profiletexts.ts, `atomText`): the words it names, and the numbers of words in all it holds for. */
interface ParsedAtom { names: string[]; from: number; to?: number }

/**
 * The conditions at the start of a clause, "When C, or when D, …" (each "A" or "A and B"), and the text after them:
 * an atom of one word, "`$a` expands to nothing", "to a single word", "to several words", "to 3 words", "to 3 words or
 * more", "to a word or more"; of a sum, "`$n` and `$v` expand to nothing", "to one word in all", "to 3 words or more
 * in all"; the second of a condition without its verb ("`$a` to a word or more"). Undefined for another form.
 */
function conditionsOf(e: string): { conditions: ParsedAtom[][]; rest: string } | undefined {
  const atom = /^((?:`[^`]+`)(?:(?:, | and )`[^`]+`)*)(?: expands?)? to (nothing|a single word|several words|a word or more|one word in all|a word or more in all|(\d+) words( or more)?(?: in all)?)/;
  const conditions: ParsedAtom[][] = [];
  let rest = e;
  for (;;) {
    const condition: ParsedAtom[] = [];
    for (;;) {
      const m = atom.exec(rest);
      if (!m) return undefined;
      const names = [...m[1].matchAll(/`([^`]+)`/g)].map((x) => x[1]);
      const v = m[2];
      const range = v === 'nothing' ? [0, 0] : v === 'a single word' || v === 'one word in all' ? [1, 1] : v === 'several words' ? [2] : v.startsWith('a word or more') ? [1] : m[4] ? [Number(m[3])] : [Number(m[3]), Number(m[3])];
      condition.push({ names, from: range[0], to: range[1] });
      rest = rest.slice(m[0].length);
      if (condition.length === 1 && rest.startsWith(' and ')) rest = rest.slice(5);
      else break;
    }
    conditions.push(condition);
    if (!rest.startsWith(', or when ')) return { conditions, rest };
    rest = rest.slice(', or when '.length);
  }
}

/** Whether a condition holds for the counts of the words it names (undefined where one of them has none). */
function holdsAt(condition: readonly ParsedAtom[], counts: ReadonlyMap<string, number>): boolean | undefined {
  let all: boolean | undefined = true;
  for (const a of condition) {
    const ns = a.names.map((x) => counts.get(x));
    if (ns.some((n) => n === undefined)) return undefined;
    const n = ns.reduce((x, y) => x! + y!, 0)!;
    all &&= n >= a.from && (a.to === undefined || n <= a.to);
  }
  return all;
}

/**
 * The roles the readings of a word (src/argv/profiletexts.ts) say the field at `place` may have, each a text that names
 * one or more roles: its profile as written, unless a clause "When C, it is X" (", its words are X, then Y"; ": by own
 * count") holds for the counts of the words it names; with the roles of "It can also be X or Y, by how many words …
 * give" too. `loose`: "Its role may depend on how many words … give", where another role is a missing explanation, not
 * a wrong one; `clause`: a clause holds. Undefined where the explanation is in no such form, or names a word with no count.
 */
export function readingsSay(explanation: string, place: FieldPlace): { roles: string[]; loose?: true; clause?: true } | undefined {
  const [base, ...sentences] = explanation.split(/\. (?=When |It can also be |Its role may depend on how many words )/);
  let roles = profileSays(base, place);
  let loose: true | undefined;
  let held = false;
  for (const s of sentences) {
    if (s.startsWith('Its role may depend')) { loose = true; continue; }
    const also = /^It can also be (.*), by how many words .* give$/.exec(s);
    if (also) { roles = [...roles ?? [], also[1]]; continue; }
    const c = conditionsOf(s.slice('When '.length));
    if (!c || !/^(, it is |, its words are |: )/.test(c.rest)) return undefined;
    const holds = c.conditions.map((x) => holdsAt(x, place.counts));
    if (holds.some((h) => h === undefined)) return undefined;
    if (held || !holds.some(Boolean)) continue;
    held = true;
    const it = /^, it is (.*)$/.exec(c.rest);
    const words = /^, its words are (.*)$/.exec(c.rest);
    const counted = /^: (.*)$/.exec(c.rest);
    roles = it ? [it[1]] : words ? inPlaces(words[1], place.at) : counted ? profileSays(counted[1], place) : undefined;
  }
  return roles && { roles, ...(loose ? { loose } : {}), ...(held ? { clause: true as const } : {}) };
}

/**
 * Whether the explanation of a token says the operand's role `texts` (the spec's text, as written or as `eachText`
 * writes it) for the field at `place`: in its readings (`readingsSay`), the role of its profile as written or of the
 * clause that holds; in the words of a brace expansion or the fields the model knows ("expands to `a` (X) and `b` (Y)"),
 * the role after the field's own text, with its clauses.
 */
export function saysOperand(explanation: string, texts: readonly string[], place: FieldPlace): boolean | undefined {
  const whole = plain(explanation);
  // (A role of no note is not one with a note: "last" is not "last (counting from 1)", nor "target" the target of
  // `ln -s t`, "target (the link is made in the current directory…)".)
  const has = (part: string): boolean => texts.some((x) => {
    const p = plain(x);
    for (let i = part.indexOf(p); i >= 0; i = part.indexOf(p, i + 1)) if (/\)$/.test(p) || !part.startsWith(' (', i + p.length)) return true;
    return false;
  });
  const said = readingsSay(whole, place);
  // (A text in a form not read here: a finding, so that a new wording is seen.)
  if (!said) return false;
  const list = said.roles.length === 1 ? listItem(said.roles[0], place) : undefined;
  // ("argument": an operand of a command the readings do not know, the command a word of `$s` names in `timeout -s $s 5 ls`.)
  const ok = list !== undefined ? has(list) : said.roles.some((x) => has(x) || /^argument(?: of |$)/.test(x));
  return ok || (said.loose ? undefined : false);
}

/**
 * The part of a list of the words a word gives ("expands to `a` (X) and `b` (Y)", of a brace expansion or of the fields
 * the model knows, src/explain/argv.ts `eachText`, `fieldsToken`) that says the field at `place`: its text, then its role. Undefined
 * where the explanation is no such list, or lists another number of words. (The words as `braceTexts` writes them, with
 * their quotes, or the fields.)
 */
function listItem(e: string, place: FieldPlace): string | undefined {
  if (!e.startsWith('expands to `')) return undefined;
  const starts = [...e.matchAll(/`[^`]*` \(/g)];
  if (starts.length !== place.of) return undefined;
  return e.slice(starts[place.at].index, starts[place.at + 1]?.index ?? e.length);
}

/**
 * Whether one of the tokens shown on a word shows the role bash's argv gives one of its fields: an option as an
 * option's token that shows its flag, the value of an option as that option's value, an operand as a token whose text
 * says the spec's text of it (at its place in its readings), and an operand the spec does not describe as one that says
 * none of the spec's operands. A token whose clause holds for the counts (`readingsSay`) says the role that clause
 * names, not its own. Undefined for the roles not compared (a command another runs, a subcommand, a terminator…), and
 * where the role is not shown but a token says only that its role may depend on the counts (a missing explanation).
 */
export function showsRole(role: ArgRole, tokens: readonly Token[], place: FieldPlace, operands: readonly string[]): boolean | undefined {
  // (No token of an argument or an option on the word: a missing explanation, not one that contradicts bash.)
  if (!tokens.length) return undefined;
  // (The parts of the lists of the fields of the word, "expands to `-n` (option: …) and `2` (value for `-n`)", that say this field.)
  const items = tokens.flatMap((t) => listItem(plain(t.explanation), place) ?? []);
  // (What the readings of each token say of the field: `grep -e $p -i f`, of `-i`, "… When `$p` expands to nothing, it is
  // value for `-e`". A token whose clause holds says that clause's roles; the others, their own role.)
  const read = tokens.map((t) => ({ t, said: readingsSay(plain(t.explanation), place) }));
  const clauses = read.flatMap((x) => (x.said?.clause ? x.said.roles : []));
  const own = read.filter((x) => !x.said?.clause).map((x) => x.t);
  // (A field after the first of a word read by place or by own count: the roles its profile as written says of it, where
  // that is not the token's own text: `head -n $a f` with `a='1 g'`, "… and each of the others is target file".)
  const later = place.at > 0 ? read.flatMap((x) => (x.said && !x.said.clause && x.said.roles[0] !== plain(x.t.explanation) ? x.said.roles : [])) : [];
  const loose = read.some((x) => x.said?.loose);
  const shown = ((): boolean | undefined => {
    switch (role.role) {
      case 'option': case 'cluster': case 'pattern-option': case 'unknown-option': case 'old-style':
        // (Or in the list of the fields of its word: "expands to `-r` (option: …) and `a` (source)".)
        return flagsOf(role).every((f) => own.some((t) => showsFlag(t, f)) || [...items, ...clauses, ...later].some((e) => showsFlag({ kind: 'option', explanation: e } as Token, f)));
      case 'end-of-options':
        return own.some((t) => t.kind === 'option') || items.some((e) => e.includes('(end of options)')) || [...clauses, ...later].some((e) => e.includes('end of options'));
      case 'value': {
        const names = [`value for \`${dash(role.of)}\``, `name for \`${dash(role.of)}\``];
        if (clauses.length) return clauses.some((x) => names.some((n) => x.includes(n)));
        // (A later field of a value read by place: `jq --arg $n $v .`, of `$v`.)
        if (later.length) return later.some((x) => names.some((n) => x.includes(n)));
        return own.some((t) => t.valueFor === dash(role.of)) || items.some((e) => e.includes(`(value for \`${dash(role.of)}\`)`));
      }
      case 'operand': {
        if (role.spec?.assignment || role.assignment) return undefined;
        // (The tokens of an argument, and those whose clause holds: a subcommand's, `git -C $d log`.)
        const speak = read.filter((x) => x.said?.clause || x.t.kind === 'argument');
        // (An operand the spec does not describe: a role said that names none of them, "argument" when `$d` expands to
        // several words.)
        if (!role.spec) return speak.some((x) => x.said?.roles.some((r) => !operands.some((o) => r.includes(plain(o)))));
        const texts = [role.spec.text.en, role.spec.text.en.replace(/ \((.*)\)$/, ': $1')];
        const says = speak.map((x) => saysOperand(x.t.explanation, texts, place));
        return says.includes(true) || (says.includes(undefined) ? undefined : false);
      }
      default:
        return undefined;
    }
  })();
  return shown === false && loose ? undefined : shown;
}

/** The role as the report says it. */
function roleName(role: ArgRole): string {
  switch (role.role) {
    case 'option': return `option ${role.flag}`;
    case 'value': return `value of ${role.of}`;
    case 'operand': return role.spec ? `operand "${role.spec.text.en}"` : 'operand';
    default: return role.role;
  }
}

/**
 * The roles of the fields of a marker whose words the model all knows, with some word giving other than one field:
 * the interpreter reads bash's argv (`fields`, per word) with the spec of its command, and each field's role must be
 * shown on its word. Nothing for a command of no spec, a function, a name that is not one field.
 */
function compareRoles(m: ArgvMarker, fields: readonly string[][], input: ArgvInput, shown: Shown, counts: RenderCounts): { word: string; what: string }[] {
  if (fields.every((f) => f.length === 1) || fields[0].length < 1) return [];
  const name = fields[0][0];
  // (`[` and `test` read their words as an expression, src/explain/tests.ts, not with the interpreter.)
  if (name === '[' || name === 'test') return [];
  const resolved = resolveName(input.model, name, field(m.command, 'name')!, { command: true });
  if (resolved.kind !== 'builtin' && resolved.kind !== 'file') return [];
  const spec = lookupCommand(name);
  if (!spec) return [];
  const argv = fields.flat().slice(1);
  // (The word of each field, and its place in its word.)
  const owner = fields.flatMap((f, k) => f.map((_, j) => ({ k, at: j }))).slice(1);
  const wordCountsByText = new Map(m.words.map((w, k) => [w.text, fields[k].length]));
  const operands = [...new Set((spec.operands ?? []).flatMap((a) => a.pattern.map((o) => o.text.en)))];
  const tokensOf = (w: SyntaxNode): Token[] => (shown.tokens.get(spanKey(spanOf(w))) ?? []).filter((t) => t.kind === 'argument' || t.kind === 'option');
  const parse = interpret(spec, argv.map((value) => ({ value })), { name, lookup: lookupCommand });
  counts.roleCommands++;
  const out: { word: string; what: string }[] = [];
  for (const { word, role } of parse.roles) {
    // (The words a name gives after the first, `{ls,-l}`: the token of the name says what it runs.)
    if (owner[word].k === 0) continue;
    const w = m.words[owner[word].k];
    const ok = showsRole(role, tokensOf(w), { text: argv[word], at: owner[word].at, of: fields[owner[word].k].length, counts: wordCountsByText }, operands);
    if (ok === undefined) continue;
    counts.roleFields++;
    if (!ok) out.push({ word: w.text, what: `bash gives it \`${argv[word]}\`, ${roleName(role)}; shown: ${JSON.stringify(tokensOf(w).map((t) => t.explanation))}` });
  }
  return out;
}

/**
 * Compares what the explanation shows with bash's runs (`plans`, from `runArgv`): the counts said, the glob examples,
 * and the roles. A marker whose argv differs from the model's (the argv check reports it) is left out.
 */
export function checkRenderings(plans: readonly ArgvPlanRun[]): { found: RenderFinding[]; counts: Record<ArgvEnvName, RenderCounts> } {
  const counts = Object.fromEntries(ARGV_ENVS.map((e) => [e, { words: 0, unknown: 0, claims: 0, globExamples: 0, roleCommands: 0, roleFields: 0 }])) as Record<ArgvEnvName, RenderCounts>;
  const found: RenderFinding[] = [];
  const analyzer = new Analyzer('en');
  const explained = new Map<ArgvInput, Shown>();
  for (const p of plans) {
    const shown = explained.get(p.input) ?? explainInput(p.input, analyzer);
    explained.set(p.input, shown);
    const env = runEnv(p);
    const c = counts[p.env];
    for (const m of p.inst.markers) {
      const records = p.run.records.get(m.id) ?? [];
      const scratch = { commands: 0, ran: 0, words: 0, unknown: 0, failing: 0 };
      if (!records.length || compareMarker(m, p.input.model, env, records, scratch).length || scratch.failing) continue;
      const push = (word: string, check: RenderFinding['check'], what: string, source?: ClaimSource, causes?: WordCauses): void => {
        found.push({ input: p.input.name, env: p.env, command: m.command.text, word, check, ...(source ? { source } : {}), ...(causes ? { causes } : {}), what });
      };
      const results = m.words.map((w) => wordFields(w, p.input.model, env));
      const argvs = records.map((r) => splitTargets(r).argv);
      m.words.forEach((w, k) => {
        if (globExampleOn(w, shown)) {
          c.globExamples++;
          const glob = wordMeaning(w, p.input.model)?.steps.find((s) => s.kind === 'glob');
          if (glob?.applies === false) push(w.text, 'glob-example', `a glob example where the glob step does not apply (${glob.why})`);
        }
        const claims = claimsOf(w, shown, p.input);
        const got = [...new Set(argvs.map((a) => wordCounts(results, a)[k]))];
        if (!claims.length || got.includes(undefined)) return;
        c.words++;
        if (!wordFields(w, p.input.model).fields) c.unknown++;
        for (const claim of claims) {
          c.claims++;
          const other = got.find((g) => g !== claim.count);
          if (other !== undefined) push(w.text, 'count', `${claim.source} says ${claim.count}, bash gave ${other}`, claim.source, wordCauses(w, p.input.model));
        }
      });
      if (results.every((r) => r.fields)) {
        for (const r of compareRoles(m, results.map((r) => r.fields!), p.input, shown, c)) push(r.word, 'role', r.what);
      }
    }
  }
  return { found, counts };
}

// ---------------------------------------------------------------------------------------------------
// The accepted differences (test/fixtures/renderings-known.json).

/**
 * The classes of differences an entry with no input may accept, each with the condition that tells its cause:
 * - `fields-step`: a count of a word that brace expansion, word splitting or globbing may make other than one word of
 *   (`$DIR/*`, `$x/a`, `{a,b}"x"`), with no part that gives one word per element (`"$@"/a`, whose explanation says
 *   it is not one word; `$@/a`).
 */
export const RENDER_CLASSES = {
  'fields-step': (f: RenderFinding): boolean => !!f.causes && f.causes.steps.length > 0 && !f.causes.perElement,
} satisfies Record<string, (f: RenderFinding) => boolean>;

export type RenderClass = keyof typeof RENDER_CLASSES;

/**
 * An accepted difference: the input (its name), the command, the word, the check, the source of the count (`count`),
 * the environment (both when absent), why. An entry with no input is a class (`when`): it accepts the differences of its
 * check and source that meet the condition of the class (`RENDER_CLASSES`), and it is stale when none of the inputs
 * run has one. A class needs a source and a condition: one without them would accept every difference of its check.
 */
export interface RenderKnown { input?: string; command?: string; word?: string; check: RenderFinding['check']; source?: ClaimSource; when?: RenderClass; env?: ArgvEnvName; reason: string }

/** The known differences and the pinned counts of each set of inputs the test runs (`fixtures`, `snippets`: the sample). */
export interface RenderKnownFile { counts: Record<string, Record<ArgvEnvName, RenderCounts>>; known: RenderKnown[] }

export const RENDER_KNOWN = path.join(__dirname, '..', 'fixtures', 'renderings-known.json');

/**
 * The differences no entry of `known` accepts, the entries of an input that are stale (those of an input in `inputs`
 * that accept no difference; entries of inputs not run are neither), and the entries of a class that accepted one
 * (`classes`, their indices: one is stale when no set of inputs used it).
 */
export function matchRenderKnown(found: readonly RenderFinding[], known: readonly RenderKnown[], inputs: readonly ArgvInput[]): { unexplained: string[]; stale: string[]; classes: number[] } {
  const broad = known.filter((e) => e.input === undefined && (!e.source || !e.when || !Object.hasOwn(RENDER_CLASSES, e.when)));
  if (broad.length) throw new Error(`a class of known differences needs a source and a condition (when: ${Object.keys(RENDER_CLASSES).join(', ')}): ${broad.map((e) => `${e.check} ${e.source ?? ''} ${e.when ?? ''}`).join('; ')}`);
  const used = new Set<number>();
  const accepts = (e: RenderKnown, f: RenderFinding): boolean => e.check === f.check && (!e.source || e.source === f.source) && (!e.env || e.env === f.env)
    && (e.input === undefined ? RENDER_CLASSES[e.when!](f) : e.input === f.input && e.command === f.command && e.word === f.word);
  const unexplained = found.filter((f) => {
    const k = known.findIndex((e) => accepts(e, f));
    if (k >= 0) used.add(k);
    return k < 0;
  }).map((f) => `${JSON.stringify(f.input)} (${f.env}): ${f.command} [${f.word}, ${f.check}]\n    ${f.what}`);
  const names = new Set(inputs.map((i) => i.name));
  const stale = known.filter((e, k) => e.input !== undefined && names.has(e.input) && !used.has(k)).map((e) => `${JSON.stringify(e.input)}: ${e.command} [${e.word}, ${e.check}]`);
  return { unexplained, stale, classes: [...used].filter((k) => known[k].input === undefined) };
}

/** The entries of a class that no set used (`matchRenderKnown`'s `classes` of each set). */
export function staleClasses(known: readonly RenderKnown[], used: Iterable<number>): string[] {
  const all = new Set(used);
  return known.flatMap((e, k) => (e.input === undefined && !all.has(k) ? [`${e.check} ${e.source ?? ''} when ${e.when ?? ''}`] : []));
}
