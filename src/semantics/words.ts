// What bash does to a word, by where the word is (docs/design/semantics.md, 4.3 "Words", and step B4): the
// expansions of the manual's 3.5, in its order, and the paragraphs that make exceptions to them. A word's
// `WordMeaning` says which steps apply to it (brace, tilde, parameter, command and arithmetic expansion, word
// splitting with the IFS in effect, pathname expansion with the glob options in effect, quote removal), and why
// a step does not; `wordFields` gives the fields the word becomes, when they can be known without running
// anything (or with a stated environment: the probes give bash's).
//
// A step that depends on a state the model has as unknown (`set -f` on some paths, an IFS set to a value not
// known here, an attribute given on some paths) "may" apply: `'unknown'`.
import { evalArith } from '../arith';
import { globToRegex, hasExtglob, hasGlobstar, isGlob } from '../examples/shellwords';
import { patsubMiscounts } from '../bracket';
import type { Shell } from '../dialect';
import { parseExpansion } from '../expansion';
import { ansiCValue, decodedSlice, decodedText, elementClose, plainWords, staticWordValue, substitutionNames, tildeParts, tildeSpots } from '../staticword';
import { ancestor, assignmentsOnly, descendants, field, redirectionsOf, substitutionForm, type SyntaxNode } from '../syntax/tree';
import { caseConverted, sameInEveryLocale, substring } from './chars';
import { bracedWords, braceStep, wordAlternatives } from './brace';
import { DECLARATIONS } from './effects';
import { resolveName } from './names';
import { ARITH_ASSIGNED, attribute, defaultOn, option, type OptionState, type ShellState, type StateModel, type Tri } from './state';
import { changedByBash, setAtStart } from './vars';
import { ARITH, changesDirectory, underscoreValue, unreliableNames } from './wordsites';

export { underscoreValue, unreliableNames };

/** Where a word is: its context decides which expansions it undergoes. */
export type WordContext =
  | 'command-name' | 'argument' | 'assignment-value' | 'declaration-argument' | 'array-element' | 'array-element-assignment' | 'array-element-assoc'
  | 'cond-operand' | 'cond-pattern' | 'cond-regex'                    // [[ ]]
  | 'case-word' | 'case-pattern' | 'for-list'
  | 'redirect-target' | 'heredoc-body' | 'herestring'
  | 'arith' | 'subscript-indexed' | 'subscript-assoc'                // $(( )), (( )), a[i] (arithmetic), m[k] (a key)
  | 'declaration-assignment'                                         // `alias a=$v`: a word of `alias` that is an assignment
  | 'param-word' | 'param-pattern';                                  // ${x:-word}, ${x#pattern}

/** One row of the context table. */
export interface ContextRule {
  brace: boolean;
  /**
   * `start`: a tilde prefix at the start; `assignment`: also after each `:` (and the start is after `=`);
   * `argument`: at the start, and in bash mode after the `=` and the `:` of a word that looks like an assignment;
   * `declaration`: as `argument`, in POSIX mode too (a declaration's assignment).
   */
  tilde: 'none' | 'start' | 'assignment' | 'argument' | 'declaration';
  /** Word splitting and pathname expansion of the unquoted parts (`inherit`: as the expansion around it). */
  split: boolean | 'inherit';
  glob: boolean | 'inherit';
  /** Unquoted parts are a pattern (`case`, `[[ == ]]`, `${x#p}`) or a regex (`[[ =~ ]]`). */
  match?: 'pattern' | 'regex';
  /** How many fields it may become: `one-or-error`, a redirection target (else "ambiguous redirect"). */
  fields: 'many' | 'one' | 'one-or-error';
  /** In POSIX mode, neither split nor globbed (a redirection target of a non-interactive shell). */
  posixLiteral?: boolean;
  /** The section of the Bash manual. */
  manual: string;
}

const ARGUMENT: ContextRule = { brace: true, tilde: 'argument', split: true, glob: true, fields: 'many', manual: '3.5' };
const ONE = { brace: false, split: false, glob: false, fields: 'one' } as const;

/** The context table (manual 3.5, with the exceptions of 3.2.5.2, 3.4, 3.6, 4.2, 6.5 and 6.7). */
export const CONTEXTS: Readonly<Record<WordContext, ContextRule>> = {
  'command-name': { ...ARGUMENT, manual: '3.7.1' },
  argument: ARGUMENT,
  'for-list': { ...ARGUMENT, manual: '3.2.5.1' },
  // (`a=(x=~/y)` keeps its tilde: only an argument that looks like an assignment has one after `=`.)
  'array-element': { ...ARGUMENT, tilde: 'start', manual: '6.7' },
  'array-element-assignment': { brace: true, tilde: 'assignment', split: false, glob: false, fields: 'many', manual: '6.7' }, // `a=([0]=$x [1]=*)` (bash 5.2 brace-expands `[2]={a,b}` to the values `[2]=a`, `[2]=b`)
  'array-element-assoc': { ...ONE, tilde: 'none', manual: '6.7' }, // `m=(k {a,b} $x *)` in an associative array (bash 5.3 expands a tilde there, 5.2 not)
  // A declaration builtin's word that looks like an assignment is one (the parser gives it as such); the others are arguments.
  'declaration-argument': { ...ARGUMENT, manual: '4.2' },
  'assignment-value': { ...ONE, tilde: 'assignment', manual: '3.4' },
  'cond-operand': { ...ONE, tilde: 'argument', manual: '3.2.5.2' },
  'cond-pattern': { ...ONE, tilde: 'argument', match: 'pattern', manual: '3.2.5.2' },
  'cond-regex': { ...ONE, tilde: 'argument', match: 'regex', manual: '3.2.5.2' },
  'case-word': { ...ONE, tilde: 'argument', manual: '3.2.5.2' },
  'case-pattern': { ...ONE, tilde: 'argument', match: 'pattern', manual: '3.2.5.2' },
  'redirect-target': { brace: true, tilde: 'argument', split: true, glob: true, fields: 'one-or-error', posixLiteral: true, manual: '3.6' },
  herestring: { ...ONE, tilde: 'start', manual: '3.6.7' },
  'heredoc-body': { ...ONE, tilde: 'none', manual: '3.6.6' },
  arith: { ...ONE, tilde: 'none', manual: '6.5' },
  'subscript-indexed': { ...ONE, tilde: 'none', manual: '6.7' },
  'subscript-assoc': { ...ONE, tilde: 'none', manual: '6.7' },
  // (bash brace-expands it as a word: `alias z={a,b}` is `alias z=a z=b`.)
  'declaration-assignment': { ...ONE, brace: true, tilde: 'declaration', manual: '4.2' },
  'param-word': { brace: false, tilde: 'start', split: 'inherit', glob: 'inherit', fields: 'many', manual: '3.5.3' },
  'param-pattern': { ...ONE, tilde: 'start', match: 'pattern', manual: '3.5.3' },
};

export type Applies = boolean | 'unknown';
export type StepKind = 'brace' | 'tilde' | 'parameter' | 'command' | 'arithmetic' | 'process' | 'split' | 'glob' | 'quote-removal';
/** Why a step does not apply (or may not). `dialect`: the shell has no brace expansion of the kind the word has (dash and POSIX sh none, mksh no ranges; src/dialect.ts). `zsh`: zsh, without SH_WORD_SPLIT and GLOB_SUBST (its defaults), neither splits nor globs a parameter expansion. */
export type StepWhy = 'context' | 'quoted' | 'noglob' | 'ifs-empty' | 'posix-mode' | 'braceexpand-off' | 'dialect' | 'zsh';

export interface ExpansionStep {
  kind: StepKind;
  applies: Applies;
  why?: StepWhy;
  /** The section of the Bash manual (6.11 when POSIX mode is why). */
  manual: string;
  /** Where it acts in the word (for split and glob: the unquoted expansions, and the words with glob characters). */
  parts: readonly SyntaxNode[];
}

/** The section of the Bash manual of each step. */
export const STEP_MANUAL: Readonly<Record<StepKind, string>> = {
  brace: '3.5.1', tilde: '3.5.2', parameter: '3.5.3', command: '3.5.4', arithmetic: '3.5.5', process: '3.5.6', split: '3.5.7', glob: '3.5.8', 'quote-removal': '3.5.9',
};

/**
 * How bash may fail on a word: `fatal` ends a non-interactive shell (`set -u`, `${x:?}`, failglob), `command` fails the
 * command only (an ambiguous redirection). `applies`: it does, or may (the value is not known here).
 */
export interface WordFailure { kind: 'fatal' | 'command'; applies: true | 'unknown' }

/** A tilde prefix that is expanded: `node.text.slice(start, end)` is the prefix (`~`, `~+`, `~user`), after `after`. */
export interface TildePrefix { node: SyntaxNode; start: number; end: number; user: string; after: '' | '=' | ':' }

/** The IFS where a word is expanded. */
export type IfsState = { kind: 'default' } | { kind: 'value'; value: string; at: SyntaxNode } | { kind: 'unknown'; at: SyntaxNode };

/** The options of pathname expansion where a word is expanded (`default` read as bash's default). */
export interface GlobState {
  noglob: Tri; nullglob: Tri; failglob: Tri; dotglob: Tri; nocaseglob: Tri; extglob: Tri; globstar: Tri; globskipdots: Tri;
  /** GLOBIGNORE: unset (or empty), its value, or not known here. */
  globignore: { value: string } | 'unset' | 'unknown';
}

export interface WordMeaning {
  /** The nodes the word is made of: one, except on the right of `[[ x == $p* ]]`, where the parser gives its parts. */
  nodes: readonly SyntaxNode[];
  context: WordContext;
  /** The row of the table that applies. */
  rule: ContextRule;
  steps: readonly ExpansionStep[];
  tildes: readonly TildePrefix[];
  ifs: IfsState;
  glob: GlobState;
  /** POSIX mode where it runs. */
  posix: Tri;
  /** The run state of the word. */
  state: ShellState;
  /** The text after quote removal, when nothing in it expands: then it is one field (or none, in a redirection, never). */
  value?: string;
  /** How bash may fail on it, whatever the values (`set -u` with an expansion, failglob with a glob, a redirection target that may not be one word). */
  failure?: WordFailure;
}

/** What happens to one expansion of a word (`$x` in `echo a$x`). */
export interface PartMeaning {
  word: WordMeaning;
  /** In double quotes, or a here-document. */
  quoted: boolean;
  split: ExpansionStep;
  glob: ExpansionStep;
}

// ---------------------------------------------------------------------------------------------------
// Finding the word and its context.

const IN_WORD = new Set(['concatenation', 'brace_expression', 'string', 'translated_string', 'heredoc_body']);
const EXPRESSIONS = new Set(['binary_expression', 'unary_expression', 'parenthesized_expression', 'ternary_expression', 'postfix_expression']);
const PATTERN_OPS = new Set(['=', '==', '!=']);

const ASSIGNMENT_WORD = /^[A-Za-z_]\w*(?:\[[^\]]*\])?\+?=/;
/**
 * The context of an argument of a command whose first word is written as a declaration builtin or `alias` (not
 * quoted or escaped, not behind `command`): bash's parser marks it, and expands a word that is an assignment as one
 * (no splitting, no globbing). The model has those of a declaration as `variable_assignment` (their values are
 * `assignment-value`); the others are `declaration-argument`. An alias definition stays a word:
 * `declaration-assignment`.
 */
function declarationContext(c: SyntaxNode, w: SyntaxNode): WordContext | undefined {
  const name = field(c, 'name')!.text;
  if (DECLARATIONS.has(name)) return 'declaration-argument';
  if (name !== 'alias') return undefined;
  return ASSIGNMENT_WORD.test(w.type === 'concatenation' ? w.namedChildren[0].text : w.text) && /^(word|concatenation)$/.test(w.type)
    && (w.type === 'word' || w.namedChildren[0].type === 'word') ? 'declaration-assignment' : undefined;
}

/** The context of a word whose top node is `w` (not inside a concatenation or a string). */
function contextOf(w: SyntaxNode): WordContext | undefined {
  const p = w.parent;
  if (!p) return undefined;
  // (The nearest of these decides: `$( (( $x )) )` is arithmetic, `$(( $(echo $x) ))` is not, nor the body of
  // `for (( ; ; ))`, which holds commands.)
  if (ARITH.has(ancestor(w, (a) => ARITH.has(a.type) || ['command_substitution', 'expansion', 'do_group', 'compound_statement'].includes(a.type))?.type ?? '')) return 'arith';
  switch (p.type) {
    case 'command_name': return 'command-name';
    case 'command': return w.field !== 'argument' ? undefined : declarationContext(p, w) ?? 'argument';
    case 'variable_assignment': return w.field === 'value' ? 'assignment-value' : undefined;
    case 'array': return elementClose(w.text) ? 'array-element-assignment' : 'array-element';
    case 'for_statement': case 'select_statement': return w.field === 'value' ? 'for-list' : undefined;
    case 'case_statement': return w.field === 'value' ? 'case-word' : undefined;
    case 'case_item': return w.field === 'value' ? 'case-pattern' : undefined;
    case 'file_redirect': return w.field === 'destination' ? 'redirect-target' : undefined;
    case 'herestring_redirect': return 'herestring';
    case 'heredoc_redirect': return w.type === 'heredoc_body' ? 'heredoc-body' : undefined;
    case 'subscript': return w.field === 'index' ? 'subscript-indexed' : undefined;
    // (The offset and length of `${x:o:l}` are arithmetic.)
    case 'expansion': return w.type === 'regex' ? 'param-pattern' : w.type === 'variable_name' || w.type === 'subscript' ? undefined
      : parseExpansion(p.text)?.op === ':' ? 'arith' : 'param-word';
    case 'extended_test': return 'cond-operand';
  }
  if (!EXPRESSIONS.has(p.type)) return undefined;
  // (Only `[[ ]]` has expressions of words: `[ ]` has its words as they are, and arithmetic is found above.)
  if (w.field === 'right' && p.type === 'binary_expression') {
    const op = field(p, 'operator')!.text;
    if (op === '=~') return 'cond-regex';
    if (PATTERN_OPS.has(op)) return 'cond-pattern';
  }
  return 'cond-operand';
}

/** Whether bash brace-expands the word that holds `n` where it is (not by the shell or `set +B`): also an assignment given to `declare` (`x={a,b}` is `x=b`). */
export function bracesInContext(n: SyntaxNode): boolean {
  const w = wordOf(n);
  return !!w && (CONTEXTS[w.context].brace || (w.context === 'assignment-value' && w.nodes[0].parent!.field === 'argument'));
}

/** The word that holds `n` (an expansion, a string, a word), with its nodes and context; undefined outside a word. */
export function wordOf(n: SyntaxNode): { nodes: SyntaxNode[]; context: WordContext } | undefined {
  let w = n;
  while (w.parent && IN_WORD.has(w.parent.type)) w = w.parent;
  const context = contextOf(w);
  if (!context) return undefined;
  // `[[ x == $p* ]]`: the right side comes in parts, side by side.
  const siblings = w.parent!.children.filter((c) => c.named);
  let i = siblings.indexOf(w);
  let j = i;
  if (w.field === 'right') {
    while (i > 0 && siblings[i - 1].field === 'right' && siblings[i - 1].endIndex === siblings[i].startIndex) i--;
    while (j + 1 < siblings.length && siblings[j + 1].field === 'right' && siblings[j + 1].startIndex === siblings[j].endIndex) j++;
  }
  return { nodes: siblings.slice(i, j + 1), context };
}

// ---------------------------------------------------------------------------------------------------
// The state where a word is expanded.

const on = (s: OptionState, kind: 'set' | 'shopt', name: string, posix: boolean): Tri =>
  s === 'default' ? (defaultOn(kind, name, posix) ? 'on' : 'off') : s;

/** The IFS of a state. */
export function ifsOf(st: ShellState): IfsState {
  const v = st.variables.get('IFS');
  if (!v || v.set === 'off') return { kind: 'default' };
  return v.set === 'on' && v.value !== undefined ? { kind: 'value', value: v.value, at: v.at } : { kind: 'unknown', at: v.at };
}

function globOf(st: ShellState, posix: boolean): GlobState {
  const opt = (kind: 'set' | 'shopt', name: string): Tri => on(option(st, kind, name), kind, name, posix);
  const gi = st.variables.get('GLOBIGNORE');
  return {
    noglob: opt('set', 'noglob'), nullglob: opt('shopt', 'nullglob'), failglob: opt('shopt', 'failglob'), dotglob: opt('shopt', 'dotglob'),
    nocaseglob: opt('shopt', 'nocaseglob'), extglob: opt('shopt', 'extglob'), globstar: opt('shopt', 'globstar'), globskipdots: opt('shopt', 'globskipdots'),
    globignore: !gi || gi.set === 'off' || gi.value === '' ? 'unset' : gi.set === 'on' && gi.value !== undefined ? { value: gi.value } : 'unknown',
  };
}

// ---------------------------------------------------------------------------------------------------
// The parts of a word.

const EXPANSIONS = ['simple_expansion', 'expansion', 'command_substitution', 'arithmetic_expansion', 'process_substitution'];
const STEP_OF: Record<string, StepKind> = {
  simple_expansion: 'parameter', expansion: 'parameter', command_substitution: 'command', arithmetic_expansion: 'arithmetic', process_substitution: 'process',
};
const QUOTES = new Set(['string', 'raw_string', 'ansi_c_string', 'translated_string']);

/** The expansions of a word, not those nested in another one (`$x` of `$(echo $x)`, of `${y:-$x}`). */
function expansionsOf(nodes: readonly SyntaxNode[]): SyntaxNode[] {
  const out: SyntaxNode[] = [];
  const visit = (m: SyntaxNode): void => {
    if (EXPANSIONS.includes(m.type)) out.push(m);
    else for (const c of m.namedChildren) visit(c);
  };
  nodes.forEach(visit);
  return out;
}

/** Whether the nearest construct around `n` that decides its quoting is a double quote or a here-document. */
function nearestQuote(n: SyntaxNode): boolean {
  let a = n.parent!;
  while (a.type === 'concatenation' || a.type === 'translated_string') a = a.parent!;
  return a.type === 'string' || a.type === 'heredoc_body';
}

/** The tilde prefixes of a word, as its context and the mode read them (manual 3.5.2; src/staticword.ts `tildeSpots`). */
function tildesOf(nodes: readonly SyntaxNode[], rule: ContextRule, posix: Tri): TildePrefix[] {
  if (rule.tilde === 'none') return [];
  const parts = tildeParts(nodes);
  const mode = rule.tilde === 'declaration' ? 'argument' : rule.tilde === 'argument' ? (posix === 'on' ? 'start' : 'argument') : rule.tilde;
  return tildeSpots(parts, mode).map((t) => ({ node: parts[t.part].node, start: t.start, end: t.end, user: t.user, after: t.after }));
}

const cache = new WeakMap<StateModel, WeakMap<SyntaxNode, WordMeaning>>();

/** The meaning of the word that holds `n`, where it runs (undefined outside a word). */
export function wordMeaning(n: SyntaxNode, model: StateModel): WordMeaning | undefined {
  const found = wordOf(n);
  if (!found) return undefined;
  let byNode = cache.get(model);
  if (!byNode) cache.set(model, (byNode = new WeakMap()));
  const known = byNode.get(found.nodes[0]);
  if (known) return known;
  const meaning = build(found.nodes, found.context, model.at(found.nodes[0]).run, model.shell);
  byNode.set(found.nodes[0], meaning);
  return meaning;
}

/** What a word is made of, whatever the state: read once per word (the walk reads its conditions on every pass). */
interface Shape {
  expansions: SyntaxNode[];
  /** The expansions not in double quotes (nor process substitutions), and whether some are in them. */
  unquoted: SyntaxNode[];
  someQuoted: boolean;
  /** The plain words with a brace expansion. */
  braced: SyntaxNode[];
  plain: SyntaxNode[];
  globWords: SyntaxNode[];
  quoted: boolean;
  /** The tilde prefixes, by the context's rule and POSIX mode. */
  tildes: Map<string, TildePrefix[]>;
  /** The meanings the walk read (`wordIn`), by the options they were read with (`optionsOf`), with the state of the first. */
  walked: WeakMap<WordOptions, { meaning: WordMeaning; noIfs?: WordMeaning }>;
  /** The variables the statement may assign before the word is expanded (`unreliableNames`). */
  unreliable: ReadonlySet<string>;
}

const shapes = new WeakMap<SyntaxNode, Shape>();
function shapeOf(nodes: readonly SyntaxNode[]): Shape {
  let shape = shapes.get(nodes[0]);
  if (shape) return shape;
  const expansions = expansionsOf(nodes);
  const plain = plainWords(nodes);
  shape = {
    expansions,
    unquoted: expansions.filter((e) => e.type !== 'process_substitution' && !nearestQuote(e)),
    someQuoted: expansions.some(nearestQuote),
    braced: bracedWords(plain),
    plain,
    globWords: plain.filter((w) => isGlob(w.text)),
    quoted: nodes.some((n) => QUOTES.has(n.type) || descendants(n, [...QUOTES]).length > 0 || /\\/.test(n.text)),
    tildes: new Map(),
    walked: new WeakMap(),
    unreliable: unreliableNames(nodes[0]),
  };
  shapes.set(nodes[0], shape);
  return shape;
}

/** What the meaning of a word reads of its state: POSIX mode, the glob options, the IFS, braceexpand. */
interface WordOptions { posix: Tri; glob: GlobState; ifs: IfsState; braceOpt: Tri; ofShell?: Map<Shell, WordOptions> }
const NONE = {};
type OptionsCache = WeakMap<object, WeakMap<object, WeakMap<object, WeakMap<object, WordOptions>>>>;
const stateOptions: OptionsCache = new WeakMap();
/**
 * The options of `st` that words read: one object for the states that share them (the same `set` and `shopt` maps,
 * IFS and GLOBIGNORE), so that the meanings of a word can be kept by it (`Shape.walked`).
 */
function optionsOf(st: ShellState, shell?: Shell): WordOptions {
  const keys: object[] = [st.set, st.shopt, st.variables.get('IFS') ?? NONE, st.variables.get('GLOBIGNORE') ?? NONE];
  let m = stateOptions as WeakMap<object, unknown>;
  for (const k of keys.slice(0, -1)) {
    let next = m.get(k) as WeakMap<object, unknown> | undefined;
    if (!next) m.set(k, (next = new WeakMap()));
    m = next;
  }
  let o = m.get(keys[3]) as WordOptions | undefined;
  if (!o) {
    const posix = on(option(st, 'set', 'posix'), 'set', 'posix', false);
    o = { posix, glob: globOf(st, posix === 'on'), ifs: ifsOf(st), braceOpt: on(option(st, 'set', 'braceexpand'), 'set', 'braceexpand', false) };
    m.set(keys[3], o);
  }
  // (The shell is part of what a meaning is kept by: the models of one script for two shells share the states.)
  if (!shell || shell === 'bash') return o;
  const ofShell = (o.ofShell ??= new Map<Shell, WordOptions>());
  return ofShell.get(shell) ?? ofShell.set(shell, { ...o, ofShell: undefined }).get(shell)!;
}

/** The meaning of a word where it runs; `whole`: also its `value` and `failure` (the walk's conditions need neither). */
function build(nodes: SyntaxNode[], found: WordContext, st: ShellState, shell: Shell | undefined, whole = true): WordMeaning {
  // A subscript of an associative array is a key; of an indexed one (or one not known as associative), arithmetic. (So
  // is a value in the list of an associative array.)
  const sub = found === 'subscript-indexed' ? nodes[0].parent! : undefined;
  const context: WordContext = sub && attribute(st, field(sub, 'name')!.text, 'A') === 'on' ? 'subscript-assoc' : found.startsWith('array-element') && attribute(st, field(nodes[0].parent!.parent!, 'name')!.text, 'A') === 'on' ? 'array-element-assoc' : found;
  const { posix, glob, ifs, braceOpt } = optionsOf(st);
  const rule = CONTEXTS[context];
  const shape = shapeOf(nodes);
  const { expansions, unquoted, someQuoted, globWords } = shape;
  const key = `${rule.tilde} ${posix}`;
  let tildes = shape.tildes.get(key);
  if (!tildes) shape.tildes.set(key, (tildes = tildesOf(nodes, rule, posix)));
  const steps: ExpansionStep[] = [];
  const braces = context === found ? bracesInContext(nodes[0]) : rule.brace; // (an associative array's list or key: none)
  const brace = braces && shape.braced.length > 0;
  steps.push(mk(braceStep(shape.braced, braces, braceOpt, shell, shape.plain)));
  steps.push(mk({ kind: 'tilde', applies: tildes.length > 0, parts: [...new Set(tildes.map((t) => t.node))] }));
  for (const kind of ['parameter', 'command', 'arithmetic', 'process'] as const) {
    const parts = expansions.filter((e) => STEP_OF[e.type] === kind);
    steps.push(mk({ kind, applies: parts.length > 0, parts }));
  }
  const meaning: WordMeaning = { nodes, context, rule, steps, tildes, ifs, glob, posix, state: st };
  steps.push(mk(splitStep(meaning, unquoted, someQuoted)));
  steps.push(mk(globStep(meaning, [...globWords, ...unquoted].sort((a, b) => a.startIndex - b.startIndex), someQuoted)));
  steps.push(mk({ kind: 'quote-removal', applies: shape.quoted, parts: [] }));
  if (!whole) return meaning;
  const literal = !brace && !tildes.length && !expansions.length && !globWords.length;
  if (literal) meaning.value = nodes.map((x) => staticWordValue(x) ?? '').join('');
  const failure = failureOf(meaning, expansions.some((e) => e.type === 'simple_expansion' || e.type === 'expansion'));
  if (failure) meaning.failure = failure;
  return meaning;
}

/** How bash may fail on a word, from its steps and the options (B5 reads it). */
function failureOf(w: WordMeaning, parameters: boolean): WordFailure | undefined {
  const step = (k: StepKind) => w.steps.find((s) => s.kind === k)!;
  const nounset = on(option(w.state, 'set', 'nounset'), 'set', 'nounset', false);
  if ((parameters && nounset !== 'off') || /\$\{[^}]*:?\?/.test(w.nodes.map((n) => n.text).join(''))
    || (step('glob').applies !== false && w.glob.failglob !== 'off')) return { kind: 'fatal', applies: 'unknown' };
  if (w.rule.fields === 'one-or-error' && ['brace', 'split', 'glob'].some((k) => step(k as StepKind).applies !== false)) return { kind: 'command', applies: 'unknown' };
  return undefined;
}

type Step = Omit<ExpansionStep, 'manual'>;
/** A step with its section of the manual. */
const mk = (s: Step): ExpansionStep => ({ ...s, manual: s.why === 'posix-mode' ? '6.11' : STEP_MANUAL[s.kind] });

/** Whether the context splits or globs: the table's answer, the outer expansion's for `${x:-word}`, and POSIX mode. */
function contextAllows(w: WordMeaning, kind: 'split' | 'glob'): { applies: Applies; why?: StepWhy; quoted?: boolean } {
  const allowed = w.rule[kind];
  if (allowed === 'inherit') {
    const outer = w.nodes[0].parent!;
    const quoted = nearestQuote(outer);
    const word = wordOf(outer);
    if (!word) return { applies: false, why: 'context' };
    const rule = CONTEXTS[word.context];
    const inner = contextFor(rule, w.posix, kind);
    return quoted ? { applies: false, why: 'quoted', quoted } : inner;
  }
  return contextFor(w.rule, w.posix, kind);
}

function contextFor(rule: ContextRule, posix: Tri, kind: 'split' | 'glob'): { applies: Applies; why?: StepWhy } {
  if (rule[kind] === false) return { applies: false, why: 'context' };
  if (rule.posixLiteral && posix !== 'off') return posix === 'on' ? { applies: false, why: 'posix-mode' } : { applies: 'unknown', why: 'posix-mode' };
  return { applies: true };
}

function splitStep(w: WordMeaning, unquoted: SyntaxNode[], someQuoted: boolean): Step {
  const ctx = contextAllows(w, 'split');
  if (ctx.applies === false) return { kind: 'split', applies: false, why: ctx.why, parts: [] };
  if (!unquoted.length) return { kind: 'split', applies: false, ...(someQuoted ? { why: 'quoted' as const } : {}), parts: [] };
  if (w.ifs.kind === 'value' && w.ifs.value === '') return { kind: 'split', applies: false, why: 'ifs-empty', parts: unquoted };
  const applies: Applies = w.ifs.kind === 'unknown' || ctx.applies === 'unknown' ? 'unknown' : true;
  return { kind: 'split', applies, ...(ctx.why ? { why: ctx.why } : {}), parts: unquoted };
}

function globStep(w: WordMeaning, parts: SyntaxNode[], someQuoted: boolean): Step {
  const ctx = contextAllows(w, 'glob');
  if (ctx.applies === false) return { kind: 'glob', applies: false, why: ctx.why, parts: [] };
  if (!parts.length) return { kind: 'glob', applies: false, ...(someQuoted ? { why: 'quoted' as const } : {}), parts: [] };
  if (w.glob.noglob === 'on') return { kind: 'glob', applies: false, why: 'noglob', parts };
  const applies: Applies = w.glob.noglob === 'unknown' ? 'unknown' : ctx.applies;
  return { kind: 'glob', applies, ...(w.glob.noglob === 'unknown' ? { why: 'noglob' as const } : ctx.why ? { why: ctx.why } : {}), parts };
}

/** What happens to the expansion `part` (or a word with glob characters) of its word: quoted, split, globbed. (In zsh, an unquoted parameter expansion is neither split nor globbed: zshexpn, SH_WORD_SPLIT and GLOB_SUBST are off by default; a command substitution is still split.) */
export function partMeaning(part: SyntaxNode, model: StateModel): PartMeaning | undefined {
  const word = wordMeaning(part, model);
  if (!word) return undefined;
  const quoted = nearestQuote(part);
  const step = (kind: 'split' | 'glob'): ExpansionStep => {
    const s = word.steps.find((x) => x.kind === kind)!;
    if (quoted || (model.shell === 'zsh' && (part.type === 'simple_expansion' || part.type === 'expansion'))) return mk({ kind, applies: false, why: quoted ? 'quoted' : 'zsh', parts: [] });
    return s.parts.includes(part) || s.applies === false ? s : mk({ kind, applies: false, parts: [] });
  };
  return { word, quoted, split: step('split'), glob: step('glob') };
}

// ---------------------------------------------------------------------------------------------------
// The fields of a word.

/** What the model does not know of the place a script runs in: the probes give bash's. */
export interface WordEnv {
  /** The environment: a variable the script does not touch has this value, or none (unset). */
  variables?: Readonly<Record<string, string>>;
  /** The current directory (`~+`). */
  pwd?: string;
  /** The files of the current directory and under it (a directory ends with `/`): a pattern elsewhere is not decided from them. */
  files?: readonly string[];
}

/** The fields of a word; `error` when bash fails on it; neither when they are not known here. */
export interface Fields {
  fields?: string[];
  error?: 'ambiguous-redirect' | 'no-match' | 'unbound' | 'parameter-null' | 'substring';
  /** How bash fails on it: surely with `error`; may when the fields are not known and the word may fail (`WordMeaning.failure`). */
  failure?: WordFailure;
}

/** A piece of the text of a word: quoted (no split or glob), or unquoted from the source or from an expansion (split). */
interface Piece { text: string; quoted: boolean; expanded: boolean }
class Failure { constructor(readonly error: NonNullable<Fields['error']>) {} }

/**
 * Where the evaluator of a word reads values: the finished model (`ModelValues`, for `wordFields`), or the walk of
 * the state as it runs (src/semantics/walk/conditions.ts, for its conditions).
 */
export interface ValueSource {
  /** The value of the parameter `name` (a variable, or a special parameter such as `?`): a string, null when unset, undefined when not known here. */
  variable(name: string, node: SyntaxNode): string | null | undefined;
  /** What the tilde prefix `~user` becomes (`~`, `~+`, `~-`), when it is known. */
  tilde(user: string, w: WordMeaning): string | undefined;
  /** Whether the command `name` of the substitution `at` (`$(true)`) runs the builtin: not a function, an alias, nor a program after `enable -n`. */
  builtinRuns(name: string, at: SyntaxNode): boolean;
  /** The value of the arithmetic expansion `n`, when it is known (the walk's arithmetic); without it, of a constant expression only. */
  arith?(n: SyntaxNode): bigint | undefined;
  /** What the `${| …; }` `n` gives (its `REPLY` at the end, bash 5.3), when it is known. */
  reply?(n: SyntaxNode): string | undefined;
}

/** The values the walk's conditions read, and the shell the walk is of (bash when absent). */
export interface WalkSource extends ValueSource {
  shell(): Shell | undefined;
}

/**
 * The values of the model where the word runs, with the environment `env` for what the script does not set.
 * `trusted`: only the values of the variables the model trusts (src/semantics/trust.ts), with no environment: the
 * values Meaning shows (`trustedPart`, for src/semantics/values.ts).
 */
class ModelValues implements ValueSource {
  constructor(private readonly w: WordMeaning, private readonly model: StateModel, private readonly env: WordEnv | undefined,
    private readonly expanding: ReadonlySet<SyntaxNode>, private readonly trusted = false) {}

  variable(name: string, node: SyntaxNode): string | null | undefined {
    if (name === '_') return this.trusted ? undefined : underscoreValue(node, this.model);
    // (Bash changes some values itself: `RANDOM`, `SECONDS`, a readonly `UID`; src/semantics/vars.ts.)
    if (!/^[A-Za-z_]\w*$/.test(name) || changedByBash(name) || (this.trusted && !this.model.trusts(name))) return undefined;
    const st = this.w.state;
    const v = st.variables.get(name);
    if (!v) {
      if (!this.env?.variables) return undefined;
      // (Not in the environment: unset, unless bash sets it at start, or it is in capitals, which may come from elsewhere.)
      return Object.hasOwn(this.env.variables, name) ? this.env.variables[name] : setAtStart(name) || name === name.toUpperCase() ? undefined : null;
    }
    if (v.declared === 'unknown' || v.set === 'unknown') return undefined;
    if (v.set === 'off') return null;
    // (`x=$'\u00e9'` sets `é` in a UTF-8 locale, `\u00E9` in C: src/semantics/chars.ts.)
    if (v.value !== undefined && !sameInEveryLocale(v.value) && /\\[uU]/.test(v.at.text)) return undefined;
    // An array, an associative array or a nameref (also on some paths only): its value is not followed.
    if (['a', 'A', 'n'].some((l) => attribute(st, name, l) !== 'off')) return undefined;
    // Not static text: the word of the assignment, expanded where it ran.
    if (v.value === undefined && v.source && !this.expanding.has(v.source) && ['i', 'l', 'u'].every((l) => attribute(st, name, l) === 'off')) {
      return sourceValue(v.source, this.model, this.env, this.expanding, this.trusted);
    }
    return v.value;
  }

  /** (Not for the values Meaning shows: `REPLY` is not one the decisions trust.) */
  reply = (n: SyntaxNode): string | undefined => (this.trusted ? undefined : this.model.reply(n));

  builtinRuns(name: string, at: SyntaxNode): boolean {
    const r = resolveName(this.model, name, at.namedChildren[0]);
    return r.kind === 'builtin' && !r.missed && !r.disabled;
  }

  /** `~+` and `~-` not after a `cd` anywhere. */
  tilde(user: string): string | undefined {
    const name = user === '' ? 'HOME' : user === '+' ? 'PWD' : user === '-' ? 'OLDPWD' : undefined;
    if (!name || (name !== 'HOME' && changesDirectory(this.w.nodes[0])) || (this.trusted && !this.model.trusts(name))) return undefined;
    if (name === 'PWD') return this.env?.pwd;
    const v = this.w.state.variables.get(name);
    if (v) return v.set === 'on' ? v.value : undefined;
    return this.env?.variables?.[name];
  }
}

/** What a word gives, read from its nodes with the values of a `ValueSource`. */
class Evaluator {
  private readonly unbound: Tri;
  private readonly unreliable: ReadonlySet<string>;
  /** `st`: the state the word is expanded in (the walk's own, for a meaning it keeps from another state with the same options). */
  constructor(private readonly w: WordMeaning, private readonly source: ValueSource, private readonly st = w.state) {
    this.unbound = on(option(st, 'set', 'nounset'), 'set', 'nounset', false);
    this.unreliable = shapeOf(w.nodes).unreliable;
  }

  /** The value of the parameter `name`: a string, null when unset, undefined when not known here. */
  variable(name: string, node: SyntaxNode): string | null | undefined {
    return this.unreliable.has(name) ? undefined : this.source.variable(name, node);
  }

  /** The value of `$name` in an operand of `${…}`: empty when unset (an error under `set -u`), undefined when not known. */
  readonly param = (name: string): string | undefined => {
    const v = this.variable(name, this.w.nodes[0]);
    return v === null ? this.unset((t) => [{ text: t, quoted: false, expanded: true }])?.[0].text : v !== undefined && sameInEveryLocale(v) ? v : undefined;
  };

  /** The pieces of a node of the word, or undefined when they are not known here. */
  pieces(n: SyntaxNode, quoted: boolean): Piece[] | undefined {
    switch (n.type) {
      case 'word': case 'number': case 'extglob_pattern': case 'variable_name': case 'regex':
        return plain(decodedText(n));
      case 'brace_expression': case 'concatenation': {
        // (Braces that are not expanded here are text, around the parts in them: `{a,"b c"}` in dash.)
        const ps = n.children.map((c) => (c.named ? this.pieces(c, quoted) : plain(c.type)));
        return ps.every((p) => p) ? (ps as Piece[][]).flat() : undefined;
      }
      case 'raw_string': return [{ text: decodedText(n).slice(1, -1), quoted: true, expanded: false }];
      case 'ansi_c_string': {
        const v = ansiCValue(decodedText(n).slice(2, -1));
        return v === undefined || !sameInEveryLocale(v) ? undefined : [{ text: v, quoted: true, expanded: false }];
      }
      case 'translated_string': return this.pieces(n.namedChildren[0], quoted);
      case 'string': return this.inner(n, n.startIndex + 1, n.endIndex - 1, /\\([$`"\\\n])/g);
      case 'heredoc_body': {
        // A quoted delimiter: the body is text as it is.
        const start = n.parent!.children.find((c) => c.type === 'heredoc_start')!.text;
        return /['"\\]/.test(start) ? [{ text: decodedText(n), quoted: true, expanded: false }] : this.inner(n, n.startIndex, n.endIndex, /\\([$`\\\n])/g);
      }
      case 'simple_expansion': case 'expansion': return this.expansion(n, quoted);
      case 'command_substitution': {
        // (`$(true)` prints nothing, unless `true` is a function, an alias or a program here; `${| …; }` gives its `REPLY`.)
        const v = substitutionForm(n) === '${|' ? this.source.reply?.(n) : staticWordValue(n);
        return v === undefined || !substitutionNames(n).every((x) => this.source.builtinRuns(x, n)) ? undefined : [{ text: v, quoted, expanded: true }];
      }
      case 'arithmetic_expansion': {
        const inner = decodedText(n).replace(/^\$(?:\(\(|\[)/, '').replace(/(?:\)\)|\])$/, '');
        const v = this.source.arith ? this.source.arith(n) : evalArith(inner);
        return v === undefined ? undefined : [{ text: String(v), quoted, expanded: true }];
      }
    }
    return undefined;
  }

  /**
   * The pieces of a double-quoted string or a here-document between `from` and `to`: the expansions in it, and the
   * text between them, where a backslash quotes only the characters `escapes` lists (and a newline, which goes).
   */
  private inner(n: SyntaxNode, from: number, to: number, escapes: RegExp): Piece[] | undefined {
    const out: Piece[] = [{ text: '', quoted: true, expanded: false }];
    let at = from;
    // (The text is taken as one piece: a backslash before a newline may end one string_content and the newline start the next.)
    const flush = (end: number): void => {
      if (end > at) out.push({ text: decodedSlice(n, at - n.startIndex, end - n.startIndex).replace(escapes, (_, c: string) => (c === '\n' ? '' : c)), quoted: true, expanded: false });
    };
    for (const c of n.namedChildren) {
      if (c.type === 'string_content' || c.type === 'heredoc_content') continue;
      flush(c.startIndex);
      const p = this.pieces(c, true);
      if (!p) return undefined;
      out.push(...p);
      at = c.endIndex;
    }
    flush(to);
    return out;
  }

  /** `$x`, `${x}` and the forms of `${…}` whose value follows from a known value. */
  private expansion(n: SyntaxNode, quoted: boolean): Piece[] | undefined {
    const out = (text: string): Piece[] => [{ text, quoted, expanded: true }];
    if (n.type === 'simple_expansion') {
      const name = n.text.slice(1);
      const v = this.variable(name, n);
      return v === null ? this.unset(out) : v === undefined ? undefined : out(v);
    }
    const p = n.startPosition.row === n.endPosition.row ? parseExpansion(decodedText(n)) : undefined;
    if (!p || p.subscript !== undefined) return undefined;
    if (p.prefix === '!') {
      if (p.op) return undefined;
      const target = this.variable(p.name, n);
      return typeof target === 'string' && /^[A-Za-z_]\w*$/.test(target) ? this.valued(this.variable(target, n), out) : undefined;
    }
    const value = this.variable(p.name, n);
    // (Beyond `${x}`, ASCII text only: src/semantics/chars.ts.)
    if ((p.prefix || p.op) && (!sameInEveryLocale(n.text) || (value && !sameInEveryLocale(value)))) return undefined;
    if (p.prefix === '#') return value === undefined ? undefined : value === null ? this.unset(() => out('0')) : out(String(value.length));
    if (!p.op) return this.valued(value, out);
    const part = (role: string): string => p.parts.find((x) => x.role === role)?.text ?? '';
    const op = p.op;
    if (/^:?[-=+?]$/.test(op)) {
      if (value === undefined) return undefined;
      const missing = value === null || (op[0] === ':' && value === '');
      const word = (): Piece[] | undefined => paramWord(part('word'), quoted, this);
      if (op.endsWith('+')) return missing ? out('') : word();
      if (op.endsWith('?')) return missing ? (() => { throw new Failure('parameter-null'); })() : out(value!);
      return missing ? word() : out(value!);
    }
    if (value === undefined) return undefined;
    if (value === null) return this.unset(out);
    if (op === ':') {
      const got = substring(value, part('offset'), p.parts.find((x) => x.role === 'length')?.text);
      return got === null ? (() => { throw new Failure('substring'); })() : got === undefined ? undefined : out(got);
    }
    if (op[0] === '~') return undefined; // (`~` and `~~` toggle the case: not followed.)
    if (op === '^^' || op === ',,' || op === '^' || op === ',') return part('pattern') ? undefined : out(caseConverted(op, value));
    const pattern = patternOf(part('pattern'), this);
    if (pattern === undefined) return undefined;
    // nocasematch makes `${x/p/r}` ignore case (not `#` and `%`).
    const nocase = op[0] === '/' ? on(option(this.st, 'shopt', 'nocasematch'), 'shopt', 'nocasematch', false) : 'off';
    if (nocase === 'unknown') return undefined;
    const re = globToRegex(pattern, 'value', { nocase: nocase === 'on' });
    /* c8 ignore next -- a guard: a pattern without extended globs always converts. */
    if (!re) return undefined;
    const test = (s: string): boolean => re.test(s);
    const range = (first: number, last: number): number[] => (first <= last ? Array.from({ length: last - first + 1 }, (_, k) => first + k) : Array.from({ length: first - last + 1 }, (_, k) => first - k));
    const len = value.length;
    switch (op) {
      case '#': case '##': {
        const i = range(op === '#' ? 0 : len, op === '#' ? len : 0).find((k) => test(value.slice(0, k)));
        return out(i === undefined ? value : value.slice(i));
      }
      case '%': case '%%': {
        const i = range(op === '%' ? len : 0, op === '%' ? 0 : len).find((k) => test(value.slice(k)));
        return out(i === undefined ? value : value.slice(0, i));
      }
    }
    // `${x/p/r}`, `${x//p/r}`, `${x/#p/r}`, `${x/%p/r}`. An unquoted `&` in the replacement is the match (patsub_replacement).
    const rep = replacementOf(part('replacement'), this);
    // (A pattern that matches nothing at all, like `*`, has rules of its own at the end of the value; `[!]]`: patsubMiscounts.)
    if (rep === undefined || test('') || patsubMiscounts(pattern)) return undefined;
    const at = (k: number): number | undefined => range(len, k).find((e) => test(value.slice(k, e)));
    if (op === '/#') {
      const e = at(0);
      return out(e === undefined ? value : rep + value.slice(e));
    }
    if (op === '/%') {
      const k = range(0, len).find((s) => test(value.slice(s)));
      return out(k === undefined ? value : value.slice(0, k) + rep);
    }
    let result = '';
    for (let k = 0; k < len;) {
      const e = at(k);
      if (e === undefined) result += value[k++];
      else if (op === '/') return out(result + rep + value.slice(e));
      else {
        result += rep;
        k = e;
      }
    }
    return out(result);
  }

  private valued(v: string | null | undefined, out: (t: string) => Piece[]): Piece[] | undefined {
    return v === null ? this.unset(out) : v === undefined ? undefined : out(v);
  }

  /** An unset variable: an error under `set -u`, else empty. */
  private unset(out: (t: string) => Piece[]): Piece[] | undefined {
    if (this.unbound === 'on') throw new Failure('unbound');
    return this.unbound === 'unknown' ? undefined : out('');
  }

  /** What the tilde prefix `~user` becomes (`~`, `~+`, `~-`), when it is known. */
  tilde(user: string): string | undefined {
    return this.source.tilde(user, this.w);
  }
}

/** Unquoted text of a word: a backslash quotes the next character, and a backslash-newline is removed. */
function plain(text: string): Piece[] {
  const out: Piece[] = [];
  const push = (t: string, quoted: boolean): void => {
    const last = out[out.length - 1];
    if (last && last.quoted === quoted) last.text += t;
    else out.push({ text: t, quoted, expanded: false });
  };
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '\\' && i + 1 < text.length) {
      if (text[i + 1] !== '\n') push(text[i + 1], true);
      i++;
    } else push(text[i], false);
  }
  return out;
}

/** A piece of the text of a `${…}` operand: quoted or not, from the source or from an expansion in it. */
interface Seg { text: string; quoted: boolean }

/**
 * The operand of `${x:-word}`, `${x#pattern}` or `${x/p/r}`, read from its text: quotes, backslashes, `$'…'` and
 * `$name` / `${name}` (with `param`). Undefined when it holds another expansion. `quoted`: the `${…}` is in double
 * quotes, where a backslash quotes only `$`, `` ` ``, `"`, `\` and `}`, and a single quote is a plain character.
 */
function operandSegs(text: string, quoted: boolean, param: (name: string) => string | undefined): Seg[] | undefined {
  const out: Seg[] = [];
  const name = /^\$(?:([A-Za-z_]\w*)|\{([A-Za-z_]\w*)\})/;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '$') {
      const m = name.exec(text.slice(i));
      if (m) {
        const v = param(m[1] ?? m[2]);
        if (v === undefined) return undefined;
        out.push({ text: v, quoted });
        i += m[0].length - 1;
        continue;
      }
      if (!quoted && text[i + 1] === "'") {
        const end = text.indexOf("'", i + 2);
        const v = end < 0 ? undefined : ansiCValue(text.slice(i + 2, end));
        if (v === undefined || !sameInEveryLocale(v)) return undefined;
        out.push({ text: v, quoted: true });
        i = end;
        continue;
      }
      return undefined;
    }
    if (c === '`') return undefined;
    if (c === '\\' && i + 1 < text.length) {
      if (quoted && !'$`"\\}'.includes(text[i + 1])) out.push({ text: c, quoted: true });
      out.push({ text: text[++i], quoted: true });
    } else if (c === "'" && !quoted) {
      const end = text.indexOf("'", i + 1);
      if (end < 0) return undefined;
      out.push({ text: text.slice(i + 1, end), quoted: true });
      i = end;
    } else if (c === '"') {
      const end = text.indexOf('"', i + 1);
      if (end < 0) return undefined;
      const inner = operandSegs(text.slice(i + 1, end), true, param);
      if (!inner) return undefined;
      out.push({ text: '', quoted: true }, ...inner);
      i = end;
    } else out.push({ text: c, quoted });
  }
  return out;
}

/** The word of `${x:-word}`: split and globbed where the `${…}` is (an unquoted tilde prefix at its start expands). */
function paramWord(text: string, quoted: boolean, ev: Evaluator): Piece[] | undefined {
  const out: Piece[] = [];
  const m = /^~([^/]*)/.exec(text);
  if (m && !quoted) {
    const home = /[\\'"$`]/.test(m[1]) ? undefined : ev.tilde(m[1]);
    if (home === undefined) return undefined;
    out.push({ text: home, quoted: true, expanded: false });
    text = text.slice(m[0].length);
  }
  const segs = operandSegs(text, quoted, ev.param);
  return segs && [...out, ...segs.map((g) => ({ text: g.text, quoted: g.quoted || quoted, expanded: true }))];
}

/**
 * A pattern of `${x#p}` as a glob for globToRegex: quoted characters escaped (but letters and digits). Its quotes count
 * also when the `${…}` is in double quotes (`"${x#'a'}"` removes an `a`), and so does the pattern `$p` gives (`"${x#$p}"`).
 */
function patternOf(text: string, ev: Evaluator): string | undefined {
  const segs = hasExtglob(text) ? undefined : operandSegs(text, false, ev.param);
  return segs?.map((g) => (g.quoted ? g.text.replace(/\W/g, '\\$&') : g.text)).join('');
}

/** The replacement of `${x/p/r}` (its quotes count as in a pattern); undefined with an unquoted `&` (the match, with patsub_replacement). */
function replacementOf(text: string, ev: Evaluator): string | undefined {
  const segs = operandSegs(text, false, ev.param);
  return !segs || segs.some((g) => !g.quoted && g.text.includes('&')) ? undefined : segs.map((g) => g.text).join('');
}

const DEFAULT_IFS = ' \t\n';

/** How deep the values of assignments are expanded through each other (`a=$b; b=$c; …`); deeper is not known here. */
const MAX_SOURCE_DEPTH = 32;
const NO_ENV = {};
/** The key of the values that only trusted variables give (`ModelValues.trusted`). */
const TRUSTED = {};
const sourceCache = new WeakMap<StateModel, WeakMap<object, Map<SyntaxNode, string | undefined>>>();
/** The value the word of an assignment gave, where it ran: cached per model, environment and word. */
function sourceValue(source: SyntaxNode, model: StateModel, env: WordEnv | undefined, expanding: ReadonlySet<SyntaxNode>, trusted = false): string | undefined {
  let byEnv = sourceCache.get(model);
  if (!byEnv) sourceCache.set(model, (byEnv = new WeakMap()));
  // (The trusted values have no environment: `env` is undefined with them.)
  const key = trusted ? TRUSTED : env ?? NO_ENV;
  let cache = byEnv.get(key);
  if (!cache) byEnv.set(key, (cache = new Map()));
  if (cache.has(source)) return cache.get(source);
  if (expanding.size >= MAX_SOURCE_DEPTH) return undefined;
  const v = fieldsAt(source, model, env, new Set([...expanding, source]), trusted).fields?.[0];
  cache.set(source, v);
  return v;
}

/** The fields of the word that holds `n` where it runs (`fields`), bash's error on it (`error`), or neither when they are not known here. */
export function wordFields(n: SyntaxNode, model: StateModel, env?: WordEnv): Fields {
  return fieldsAt(n, model, env, new Set());
}

/**
 * What the expansion `part` of the word `w` gives with only the values the model trusts (`ModelValues.trusted`): its text, and its
 * fields where `split` (each with whether it has a glob character); undefined when bash fails on it or a value is not known.
 */
export function trustedPart(part: SyntaxNode, w: WordMeaning, model: StateModel, quoted: boolean, split: boolean): { text: string; fields: { text: string; glob: boolean }[] } | undefined {
  let pieces: Piece[] | undefined;
  try {
    pieces = new Evaluator(w, new ModelValues(w, model, undefined, new Set(), true)).pieces(part, quoted);
  } catch (e) {
    /* c8 ignore next -- a rethrow guard, as in `fieldsAt`. */
    if (!(e instanceof Failure)) throw e;
    return undefined;
  }
  if (!pieces) return undefined;
  // (Not split, as in double quotes or with an empty IFS: one text, which may still be globbed.)
  const fields = split ? splitPieces(w, pieces) : [pieces.flatMap((p) => [...p.text].map((c): Char => ({ c, quoted: p.quoted, split: false })))];
  if (!fields) return undefined;
  return { text: pieces.map((p) => p.text).join(''), fields: fields.map((f) => ({ text: f.map((c) => c.c).join(''), glob: isGlob(patternOfChars(f)) })) };
}

/** The variable `name` where the word `w` is expanded, as `trustedPart` reads it: a string, null when unset, undefined when not known. */
export const trustedVariable = (name: string, w: WordMeaning, model: StateModel): string | null | undefined => new Evaluator(w, new ModelValues(w, model, undefined, new Set(), true)).variable(name, w.nodes[0]);
function fieldsAt(n: SyntaxNode, model: StateModel, env: WordEnv | undefined, expanding: ReadonlySet<SyntaxNode>, trusted = false): Fields {
  const w = wordMeaning(n, model);
  if (!w) return {};
  const unknown: Fields = w.failure ? { failure: w.failure } : {};
  const ev = new Evaluator(w, new ModelValues(w, model, env, expanding, trusted));
  try {
    const split = splitFields(w, ev);
    if (!split) return unknown;
    const fields: string[] = [];
    for (const f of split) {
      const g = globField(w, f, env);
      if (!g) return unknown;
      fields.push(...g);
    }
    if (w.rule.fields === 'one-or-error' && fields.length !== 1) return { error: 'ambiguous-redirect', failure: { kind: 'command', applies: true } };
    return { fields };
  } catch (e) {
    // A rethrow guard: only `Failure` is thrown inside (a bug elsewhere must not become a wrong answer).
    /* c8 ignore next */
    if (!(e instanceof Failure)) throw e;
    return { error: e.error, failure: { kind: 'fatal', applies: true } };
  }
}

/** The fields of the word before pathname expansion (brace expansion, the expansions, word splitting); throws a `Failure`. */
function splitFields(w: WordMeaning, ev: Evaluator): Char[][] | undefined {
  const alternatives = wordAlternatives(w);
  if (!alternatives) return undefined;
  const out: Char[][] = [];
  for (const nodes of alternatives) {
    const pieces = piecesOf(w, nodes, ev);
    if (!pieces) return undefined;
    const split = splitPieces(w, pieces);
    if (!split) return undefined;
    out.push(...split);
  }
  return out;
}

/**
 * The word that holds `n` as the walk of the state reads it in a condition (src/semantics/walk/conditions.ts), from the state `st`
 * and the values of `source`: its fields (`[ ]`, `test`, a command name; with no file to match a glob against, and
 * `ifs: false` when the IFS is not to be followed), its one field (`[[ ]]`, `case`), its pattern (`[[ == ]]`, a
 * `case` pattern: quoted characters escaped), or its regex (`[[ =~ ]]`: quoted characters other than letters, digits
 * and `_` escaped with a backslash, as bash does). Undefined when it is not known, or bash fails on it.
 */
export function wordIn(n: SyntaxNode, st: ShellState, source: WalkSource, as: 'fields', ifs: boolean): string[] | undefined;
export function wordIn(n: SyntaxNode, st: ShellState, source: WalkSource, as: 'value' | 'pattern' | 'regex'): string | undefined;
export function wordIn(n: SyntaxNode, st: ShellState, source: WalkSource, as: 'fields' | 'value' | 'pattern' | 'regex', ifs = true): string[] | string | undefined {
  // (Most words of conditions are plain text, which is their field, value, pattern and regex as it is: read at once.
  // `n` is the whole word: the right side of `[[ == ]]` comes in parts only when it starts with an expansion.)
  if ((n.type === 'word' || n.type === 'number') && PLAIN_TEXT.test(n.text)) return as === 'fields' ? [n.text] : n.text;
  const found = wordOf(n);
  /* c8 ignore next -- a guard: the walk reads only words of a command, of `[[ ]]` and of `case` */
  if (!found) return undefined;
  // (The same word is read in many states, most of them with the same options: its meaning is kept, and only the
  // evaluator is given the state.)
  const walked = shapeOf(found.nodes).walked;
  const key = optionsOf(st, source.shell());
  let seen = walked.get(key);
  if (!seen) walked.set(key, (seen = { meaning: build(found.nodes, found.context, st, source.shell(), false) }));
  const w = ifs ? seen.meaning : (seen.noIfs ??= { ...seen.meaning, ifs: { kind: 'unknown', at: found.nodes[0] } });
  try {
    const split = splitFields(w, new Evaluator(w, source, st));
    if (!split) return undefined;
    if (as !== 'fields') {
      // (One field: `[[ ]]` and `case` neither split nor drop an empty word.)
      const f = split[0];
      return as === 'value' ? f.map((c) => c.c).join('') : as === 'regex' ? f.map((c) => (c.quoted && /\W/.test(c.c) ? `\\${c.c}` : c.c)).join('') : patternOfChars(f);
    }
    const fields: string[] = [];
    for (const f of split) {
      const g = globField(w, f, undefined);
      if (!g) return undefined;
      fields.push(...g);
    }
    return fields;
  } catch (e) {
    /* c8 ignore next -- a rethrow guard, as in fieldsAt */
    if (!(e instanceof Failure)) throw e;
    return undefined;
  }
}

/** A word that bash takes as it is written: no expansion, quote, escape, tilde, brace, glob or extended glob. */
const PLAIN_TEXT = /^[\w.,:/@%+=-]+$/;

/** A field as a pattern for globToRegex: quoted characters escaped. */
function patternOfChars(f: readonly Char[]): string {
  return f.map((c) => (c.quoted && /[\\*?[\]()|!@+]/.test(c.c) ? `\\${c.c}` : c.c)).join('');
}

type Char = { c: string; quoted: boolean; split: boolean };

/** The pieces of the word (or of one word of its brace expansion), with its tildes expanded. */
function piecesOf(w: WordMeaning, nodes: (SyntaxNode | string)[], ev: Evaluator): Piece[] | undefined {
  const out: Piece[] = [];
  const parts = nodes.flatMap((n): (SyntaxNode | string)[] => (typeof n !== 'string' && n.type === 'concatenation' ? [...n.namedChildren] : [n]));
  for (let i = 0; i < parts.length; i++) {
    const n = parts[i];
    if (typeof n === 'string') {
      // A word of a brace expansion: its tilde prefix at the start.
      // (A prefix with a quoted character is not one: `{~\\x,y}`.)
      const t = /^~([^/\\'"$`]*)(?=\/|$)/.exec(n);
      if (t && w.rule.tilde !== 'none') {
        const home = ev.tilde(t[1]);
        if (home === undefined) return undefined;
        out.push({ text: home, quoted: true, expanded: false }, ...plain(n.slice(t[0].length)));
      } else out.push(...plain(n));
      continue;
    }
    const tildes = w.tildes.filter((t) => t.node === n);
    if (tildes.length) {
      let at = 0;
      for (const t of tildes) {
        const v = ev.tilde(t.user);
        if (v === undefined) return undefined;
        out.push(...plain(n.text.slice(at, t.start)), { text: v, quoted: true, expanded: false });
        at = t.end;
      }
      out.push(...plain(n.text.slice(at)));
      continue;
    }
    const p = ev.pieces(n, false);
    if (!p) return undefined;
    out.push(...p);
  }
  return out;
}

/** Word splitting (manual 3.5.7): the unquoted results of expansions are split on IFS; empty unquoted results go. */
function splitPieces(w: WordMeaning, pieces: Piece[]): Char[][] | undefined {
  const step = w.steps.find((s) => s.kind === 'split')!;
  const splits = step.applies !== false;
  const chars: Char[] = [];
  for (const p of pieces) {
    const split = splits && p.expanded && !p.quoted;
    if (p.quoted && !p.text) chars.push({ c: '', quoted: true, split: false });
    for (const c of p.text) chars.push({ c, quoted: p.quoted, split });
  }
  if (!splits) {
    // Not split: one field, unless it is only unquoted expansions that gave nothing (`$empty` is no word).
    const kept = chars.length > 0 || w.rule.fields !== 'many';
    return kept ? [chars] : [];
  }
  const ifs = w.ifs.kind === 'default' ? DEFAULT_IFS : w.ifs.kind === 'value' ? w.ifs.value : undefined;
  // (An IFS of other than ASCII is split on by characters or by bytes, by the locale: src/semantics/chars.ts.)
  if ((ifs === undefined || !sameInEveryLocale(ifs)) && chars.some((c) => c.split)) return undefined;
  const sep = ifs ?? '';
  const isSep = (c: Char): boolean => c.split && sep.includes(c.c);
  const white = (c: Char): boolean => isSep(c) && DEFAULT_IFS.includes(c.c);
  const fields: Char[][] = [];
  let cur: Char[] = [];
  let has = false;
  for (let i = 0; i < chars.length; i++) {
    if (!isSep(chars[i])) {
      cur.push(chars[i]);
      has = true;
      continue;
    }
    let j = i;
    while (j < chars.length && white(chars[j])) j++;
    let hard = false;
    if (j < chars.length && isSep(chars[j]) && !white(chars[j])) {
      hard = true;
      j++;
      while (j < chars.length && white(chars[j])) j++;
    }
    if (hard || has) fields.push(cur);
    cur = [];
    has = false;
    i = j - 1;
  }
  if (has) fields.push(cur);
  return fields;
}

/** Pathname expansion of one field (manual 3.5.8): the names it matches, the field itself, none, or unknown. */
function globField(w: WordMeaning, f: Char[], env: WordEnv | undefined): string[] | undefined {
  const text = f.map((c) => c.c).join('');
  const step = w.steps.find((s) => s.kind === 'glob')!;
  if (step.applies === false && step.why !== 'noglob') return [text];
  const pattern = patternOfChars(f);
  if (!isGlob(pattern)) return [text];
  if (step.applies === false) return [text];
  const g = w.glob;
  if (step.applies === 'unknown' || !env?.files || changesDirectory(w.nodes[0])) return undefined;
  if (hasExtglob(pattern) && g.extglob !== 'on') return undefined;
  if ([g.nullglob, g.failglob, g.dotglob, g.nocaseglob, g.globstar, g.extglob, g.globskipdots].includes('unknown') || g.globignore === 'unknown') return undefined;
  // `./*.log`: the names under the current directory, with `./` before them; neither `sub/../*` nor `/var/log/*` is followed.
  const prefix = /^(?:\.\/)*/.exec(pattern)![0];
  const rest = pattern.slice(prefix.length);
  if (rest.startsWith('/') || rest.split('/').some((seg) => seg === '.' || seg === '..') || (g.globskipdots === 'off' && rest.includes('/'))) return undefined;
  const matched = matchFiles(w, rest, env.files);
  if (!matched) return undefined;
  if (prefix && g.globstar === 'on' && rest === '**') matched.unshift('');
  if (matched.length) return matched.map((m) => prefix + m).sort();
  if (g.failglob === 'on') throw new Failure('no-match');
  return g.nullglob === 'on' ? [] : [text];
}

/** The names of `files` (with `.` and `..` when globskipdots is off) that `pattern` matches, without those GLOBIGNORE leaves out. */
function matchFiles(w: WordMeaning, pattern: string, files: readonly string[]): string[] | undefined {
  const g = w.glob;
  const ignore = g.globignore === 'unset' ? [] : (g.globignore as { value: string }).value.split(':').filter(Boolean).map((p) => globToRegex(p, 'file', { dotglob: true }));
  const opts = { dotglob: g.dotglob === 'on', nocase: g.nocaseglob === 'on', globstar: g.globstar === 'on' && hasGlobstar(pattern) };
  const re = globToRegex(pattern, 'file', opts);
  if (!re) return undefined;
  // A directory with its slash: for a pattern that ends with `/`, and for `dir/**` (`**` matches nothing after `dir/`).
  const slashed = pattern.endsWith('/') || (opts.globstar && /.\/\*\*$/.test(pattern));
  const names = files.flatMap((p) => (p.endsWith('/') ? [...(pattern.endsWith('/') ? [] : [p.slice(0, -1)]), ...(slashed ? [p] : [])] : [p]));
  if (g.globskipdots === 'off') names.push('.', '..');
  return names.filter((p) => re.test(p) && !ignore.some((r) => r?.test(p))).sort();
}
