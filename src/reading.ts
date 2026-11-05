// The reading tree of a line, for the tree view of the panel (docs/design/tree-view/README.md): who reads each part
// of the line, in four layers.
//
// - `bash`: bash parses the line into commands (bash-ast's view: test/command-tokens.test.ts holds every token to one
//   of our commands). A simple command is read as the manual says (3.7.1): its assignments, its redirections, and its
//   words, which bash expands; the first field of the result is the command name, which bash looks up (3.7.2: a
//   function, a builtin, a file in PATH), and the others are its arguments. An alias comes before all that: bash
//   replaces the first word with the alias's text when it reads the line (6.6), so the name it looks up is the first
//   word of that text (`alias ll='ls -l'`: `ll x` runs `ls` with `-l` and `x`). When the first word has an
//   expansion, the name is known only when it runs (`$cmd x`; `e=; $e echo hi` runs `echo`): it is not named here.
//   The arguments of a declaration builtin that are assignments (`local x=$(y)`) are expanded as assignments.
// - `child`: a text bash parses again as a script: the text of a `$( )`, `<( )` or backquotes, which a subshell runs
//   (the commands under a substitution node); or a string a command gives a shell (`Token.origin` `script`): `bash -c`
//   starts another shell, `eval` and `trap` read it again in this shell, `ssh` sends it to a shell on another machine.
//   `ReadingNode.process` says which. A string has the reading a script of that text has (`Token.reading`, `readAgain`).
//   Levels inside levels (`bash -c 'echo $(pwd)'`, a `$( )` in a `$( )`) are all this layer: they are not counted.
// - `command`: each command reads its arguments as its spec says: the tokens of the argument interpreter
//   (`Token.origin` `argv`: options, operands, subcommands, a command it runs, the expression of `test`), under the
//   argument word each is about (or after the words, when one reads several: `-n 5`, `[`'s expression). A test of
//   `[` or `test` has its operators and operands under it (`Token.testParts`), as an expression of `[[ ]]` has them.
// - `language`: a language inside a word, read by its own rules: the tokens of an embedded explainer (`embedded`: a
//   regex, a sed script, a jq filter, a printf format…), grouped by `Token.language`. The command reads it, except the
//   regex of `[[ =~ ]]`, which bash matches itself (its regex library, POSIX ERE).
//
// The layers come from the tree and from `Token.origin`, never from a label or an explanation. The explanations of
// the nodes are those of the tokens about the same text: bash's own (`shell`) for the nodes bash reads.
import { readSaid, tokenSaid, type TokenTextArgs, type TokenTextId } from './messages-tokens';
import { markedText } from './tokenmarks';
import type { Pos, ScriptProcess, Span, Token } from './analyzer-types';
import type { Basis, TryIt } from './basis';
import { binaryTestOperands, binaryTestOps, extendedEqualOps, plainPatternOps, testOperandTexts, unaryTestOperands, unaryTestOps } from './dict/syntax';
import type { Lang } from './i18n';
import type { Shell } from './shellfeatures';
import { anonSections, CONSTRUCTS, expressionHost, isExpression, nodeSections } from './refs';
import { aliasesAfter, type AliasResolution, type NameResolution } from './semantics/names';
import type { NameInfo } from './namefacts';
import { spanWithin } from './noteanchors';
import { type WordStep, wordSteps } from './semantics/wordsteps';
import { type ExpansionStep, STEP_MANUAL, type StepKind, type WordMeaning } from './semantics/words';
import { setsElement, splitElement, stackTilde, staticWordValue } from './staticword';
import { andOrRole, field, fields, isShebang, substitutionForm, type SyntaxNode, type SyntaxTree, withLists } from './syntax/tree';
import { mostOf, pushAll } from './lists';

/** Who reads a part: bash, bash again (a substitution, or a string a command gives a shell), the command, a language. */
export type Layer = 'bash' | 'child' | 'command' | 'language';

/** What a node of bash's reading is (a node of the other layers has its token's kind). */
export type ShellKind =
  | 'line' // the line as bash reads it: the root
  | 'script' // the text of a substitution, as the subshell parses it
  | 'list' // a list of commands (3.2.4): pipelines and AND/OR lists joined by `;` and `&` (and newlines, in a body)
  | 'andList' | 'orList' | 'andOrList' // an AND list (`a && b`), an OR list (`a || b`), or both (`a && b || c`: its first part `a && b` is an AND list)
  | 'pipeline' | 'command' | 'compound' | 'clause' | 'coprocess' | 'function'
  | 'commandName' // the first word of a simple command, when it is the command name as written
  | 'aliasWord' // the first word, when it is an alias: bash replaces it with its text when it reads the line (6.6)
  | 'expandedName' // the first word, when it has an expansion: the name is known only when it runs
  | 'option' // an option of a reserved word, read as written: `time -p` (3.2.3)
  | 'argument' // a word after the command name
  | 'assignmentArgument' // an argument of a declaration builtin that is an assignment (`local x=1`)
  | 'value' // the value of an assignment, a word (not a compound assignment's list): `notes.txt` of `x=notes.txt` (3.4)
  | 'word' | 'name' | 'assignment' | 'redirect' | 'heredoc'
  | 'quote' | 'expansion' | 'substitution' | 'arithmetic' | 'brace'
  | 'operator' | 'keyword' | 'comment'
  | 'shebang' // the first line `#!…`: to bash a comment (3.1.3), which the kernel reads when the file is run as a program
  | 'expression' // an expression of `[[ ]]` (a conditional expression, 6.4) or of arithmetic (6.5), and a number there
  | 'descriptor' // the file descriptor a redirection is about, written before its operator: `2>`, `{fd}>` (3.6)
  | 'delimiter' // the word after `<<`, which ends a here-document: not a word bash expands (3.6.6)
  | 'subscript' // `@` or `*` as the index of an array: all its elements (6.7), no expression
  | 'part'; // another part of a construct: the body of a loop, `do … done`

export interface ReadingNode {
  layer: Layer;
  /**
   * A `ShellKind` in the layers `bash` and `child` (except the parts bash reads in a word that have no node of their
   * own, a glob, an escape, which have their token's `Kind`); in the others, the token's `Kind`, or `language` (the root
   * of a language, labelled with its name).
   */
  kind: string;
  /** The code (its first line, shortened); the language of a `language`. */
  label: string;
  span: Span;
  /** What the explanation says about this part: the text of its token, when one is about it. */
  text?: string;
  /** The sections of the Bash manual it is about. */
  refs?: readonly string[];
  /** In the layers `command` and `language`: who reads it, the name of the command (or `bash`, the regex of `=~`). */
  reader?: string;
  /** In the layer `command`: its reader is a builtin or a function, so the shell that runs it reads it, no program of its own (from the name resolution). */
  inShell?: true;
  /** In the layer `child`: which shell parses it (`ScriptProcess`). */
  process?: ScriptProcess;
  /** On a word a command reads as an operand or a value: how bash changes it first, so the command gets other words (`Token.expands`). */
  expands?: 'glob' | 'split' | 'brace' | 'elements';
  /** On a `commandName`: what bash runs for it (3.7.2), from the name resolution of src/semantics/names.ts. */
  resolves?: NameResolution['kind'];
  /** On a word a command reads as the value of an option: the option (`-f`, `--file`). */
  valueFor?: string;
  /** On a command name (and the reserved word `time`): what the name is, and what else (`Token.name`). */
  name?: NameInfo;
  /** On a word bash does something to: what it does, in its order (3.5; `wordSteps`), and the word's place. */
  steps?: { list: readonly WordStep[]; context: string };
  /** With `text`: what it rests on where it states bash's behaviour, and a command that shows it (`Token.basis`, `Token.tryIt`). */
  basis?: Basis;
  tryIt?: TryIt;
  children: ReadingNode[];
}

/** The text of a token for a node, with its basis and try-it when it has them (docs/design/basis.md, step 4). */
const saidBy = (t: Token): Pick<ReadingNode, 'text' | 'basis' | 'tryIt'> => ({ text: markedText(t), ...(t.basis ? { basis: t.basis } : {}), ...(t.tryIt ? { tryIt: t.tryIt } : {}) });

/** What the reading tree asks of the analyzer. */
export interface ReadingContext {
  lang: Lang;
  /** What bash runs for the command name `name`, written as `word` (src/semantics/names.ts `resolveName`). */
  resolve(name: string, word: SyntaxNode): NameResolution;
  /** What bash does to the word `w` in its context (src/semantics/words.ts `wordMeaning`). */
  meaning(w: SyntaxNode): WordMeaning | undefined;
  /** The text the pattern `w` of `[[ == ]]` matches, where it has no wildcard (src/semantics/globwords.ts `plainPatternText`). */
  plainPattern(w: SyntaxNode): string | undefined;
  /** Whether the array `name` is associative where `at` runs, surely indexed, or either (src/explain/reads.ts `arrayKind`). */
  arrayKind(name: string, at: SyntaxNode): 'assoc' | 'indexed' | 'unknown';
  /** The shell the script is for (bash when absent): what a word spells there (`$'echo'` is `$echo` in dash). */
  shell?: Shell;
}

/** The words of an alias's text, when it is plain words a command name can start (no quotes, no operators, no assignment). */
function plainWords(value: string): string[] | undefined {
  const words = value.trim().split(/\s+/);
  return /^[\w./:@%+,-]+$/.test(words[0]) && words.every((w) => /^[\w./:@%+,=-]+$/.test(w)) ? words : undefined;
}

const SUBSTITUTIONS = new Set(['command_substitution', 'process_substitution']);
/** The parts of a word bash reads: quotes, expansions, substitutions. */
const PARTS = new Set(['string', 'translated_string', 'raw_string', 'ansi_c_string', 'simple_expansion', 'expansion', 'arithmetic_expansion', 'brace_expression', ...SUBSTITUTIONS]);
/** The parts whose text bash reads further, with tokens of their own but no nodes: the escapes of `$'…'`. */
const QUOTES = new Set(['string', 'translated_string', 'raw_string', 'ansi_c_string']);
/** The nodes that are a word to bash. */
const WORDS = new Set(['word', 'number', 'concatenation', 'extglob_pattern', 'regex', 'array', ...PARTS]);
const REDIRECTS = new Set(['file_redirect', 'heredoc_redirect', 'herestring_redirect']);
/** The kinds of token that explain a command: the root of what it reads. */
const READERS = new Set(['command', 'builtin', 'function', 'alias', 'test']);
/** The kinds of token of a command another one runs (`sudo ls`, `builtin cd`): it reads the words after its name itself. */
const RUNS = new Set(['command', 'builtin']);

/** The command that reads a word: its name, and whether it is a part of the shell that runs it (`ReadingNode.inShell`). */
interface Reader { name: string; inShell: boolean }
/** The fields of a node that `reader` reads. */
const readBy = ({ name, inShell }: Reader): Pick<ReadingNode, 'reader' | 'inShell'> => ({ reader: name, ...(inShell ? { inShell } : {}) });
/** What a name resolves to reads in the shell that runs it: a builtin or a function. */
const resolvesInShell = (res: NameResolution | undefined): boolean => res?.kind === 'builtin' || res?.kind === 'function';
/** A builtin that `builtin` or `command` finds runs in this shell, as bash runs a command name; one that another program names is that program's (`sudo cd`). */
const builtinHere = (t: Pick<ReadingNode, 'kind' | 'name'>): boolean => t.kind === 'builtin' && !!t.name && t.name.by === undefined;
/** The kinds of token about a word, or a part of one. */
const WORD_TOKENS = new Set(['string', 'variable', 'expansion', 'substitution', 'number', 'pattern']);
/** The kinds of bash's tokens inside a word that have no node: a glob's parts, an escape, a tilde, a brace expansion. */
const PART_TOKENS = new Set(['string', 'pattern', 'operator', 'expansion', 'variable', 'number']);
/** The clauses of a compound command (3.2.5.2): parts of it, not commands of their own. */
const CLAUSES = new Set(['case_item', 'elif_clause', 'else_clause']);
/** The delimiters of an arithmetic expansion, which are the expansion's own: `$(( ))`, `$[ ]`. */
const DELIMITERS = new Set(['$((', '))', '$[', ']', '${', '}']);
/** Where an arithmetic expression is read, with its parts as children (a number there is not a word). */
const ARITHMETIC = new Set(['arithmetic_command', 'arithmetic_expansion', 'c_style_for_statement']);
/** A substring expansion, `${x:i:n}`, whose offset and length are arithmetic (3.5.3). */
const substring = (n: SyntaxNode): boolean => n.type === 'expansion' && n.children.some((c) => c.type === ':');

const le = (a: Pos, b: Pos): boolean => a.line < b.line || (a.line === b.line && a.character <= b.character);
/** In the order of the text. */
const byStart = (a: { span: Span }, b: { span: Span }): number => a.span.start.line - b.span.start.line || a.span.start.character - b.span.start.character;
const ALIAS = new Set(['alias']);
/** The last of `nodes`, which are in order and do not overlap, that starts at `at` or before it. */
function lastAt<T extends { span: Span }>(nodes: readonly T[], at: Pos): T | undefined {
  let [low, high] = [0, nodes.length];
  while (low < high) {
    const mid = (low + high) >> 1;
    if (le(nodes[mid].span.start, at)) low = mid + 1;
    else high = mid;
  }
  return nodes[low - 1];
}
const point = (row: number, column: number): Pos => ({ line: row, character: column });
const spanOf = (n: SyntaxNode): Span => ({ start: point(n.startPosition.row, n.startPosition.column), end: point(n.endPosition.row, n.endPosition.column) });
/** The place of the offset `i` of the text, in the node `n`. */
function posIn(n: SyntaxNode, i: number): Pos {
  const before = n.text.slice(0, i - n.startIndex);
  const nl = before.lastIndexOf('\n');
  return nl < 0 ? point(n.startPosition.row, n.startPosition.column + before.length) : point(n.startPosition.row + before.split('\n').length - 1, before.length - nl - 1);
}
/** The lines the tokens of a line are on. (Each token once: all the lines of a statement over several lines have the same tokens, whose lines do not change.) */
export function tokenLines(items: readonly Token[]): Set<number> {
  const lines = new Set<number>();
  for (const t of items) {
    let on = linesKept.get(t);
    if (!on) linesKept.set(t, (on = [...new Set(function walk(x: Token): number[] { return [x.span.start.line, ...x.children.flatMap(walk)]; }(t))]));
    for (const l of on) lines.add(l);
  }
  return lines;
}
const linesKept = new WeakMap<Token, readonly number[]>();

export const keyOf = (s: Span): string => `${s.start.line}:${s.start.character}-${s.end.line}:${s.end.character}`;
const same = (a: Span, b: Span): boolean => keyOf(a) === keyOf(b);
const union = (...lists: (readonly string[] | undefined)[]): readonly string[] => [...new Set(lists.flatMap((l) => l ?? []))];

/** The first line of a text, shortened as the panel's labels are. */
export function short(text: string): string {
  const line = text.split('\n')[0];
  return line.length > 60 ? `${line.slice(0, 59)}…` : line;
}

/** The steps of the expansion of a word that no part of it shows (3.5): its parts show the expansions and quotes. */
const UNSHOWN = new Set<StepKind>(['brace', 'tilde', 'split', 'glob']);

/**
 * The sections of what bash does to a word that no part of it shows: brace and tilde expansion, word splitting and
 * filename expansion where they apply (or may: `$x`), and pattern matching where the word is a pattern (3.5.8.1:
 * `case` and `[[ == ]]`, `${x#pat}`). (The word of `${x:-word}` is split and globbed with the word around it, which
 * says so: `inherit`.)
 */
function expansionSections(m: WordMeaning | undefined): readonly string[] {
  if (!m) return [];
  const own = (s: ExpansionStep): boolean => (s.kind !== 'split' && s.kind !== 'glob') || m.rule[s.kind] !== 'inherit';
  const steps = m.steps.filter((s) => UNSHOWN.has(s.kind) && s.applies !== false && own(s)).map((s) => STEP_MANUAL[s.kind]);
  // (A tilde prefix that names an entry of the directory stack, `~1`: 6.8 too.)
  if (m.tildes.some((t) => stackTilde(t.user))) steps.push('6.8');
  return m.rule.match === 'pattern' ? [...steps, '3.5.8.1'] : steps;
}

/** The kind of a construct: a pipeline with a reserved word (3.2.3), a clause, a coprocess (3.2.6), a compound command (3.2.5). */
function constructKind(type: string): ShellKind {
  if (type === 'negated_command' || type === 'time_statement') return 'pipeline';
  if (CLAUSES.has(type)) return 'clause';
  if (type === 'coproc_statement') return 'coprocess';
  return CONSTRUCTS[type] ? 'compound' : 'part';
}

/**
 * The reading tree of the line whose explanation is `items` (`LineExplanation.items`, with their origins), in `tree`:
 * the parts of the tree the tokens cover, read by bash, then by the commands and languages inside them. Undefined when
 * the line has nothing to explain.
 */
export function readingTree(tree: SyntaxTree, items: readonly Token[], cx: ReadingContext): ReadingNode | undefined {
  /** A text of the catalog of token texts, where no token says it: plain, as a node holds its text. */
  const said = <K extends TokenTextId>(id: K, ...params: TokenTextArgs<K>): string => readSaid(tokenSaid(cx.lang, id, ...params)).text;
  if (!items.length) return undefined;
  const range: Span = {
    // (The items are in the order of the text; one before may end later: `cat <<E; echo a` ends with its here-document.)
    start: items[0].span.start,
    end: items.map((t) => t.span.end).reduce((a, b) => (le(a, b) ? b : a)),
  };
  const all: Token[] = [];
  const walk = (t: Token): void => {
    all.push(t);
    t.children.forEach(walk);
  };
  items.forEach(walk);
  // bash's own tokens, by the text they are about.
  const shellAt = new Map<string, Token[]>();
  for (const t of all.filter((x) => x.origin === 'shell')) shellAt.set(keyOf(t.span), [...(shellAt.get(keyOf(t.span)) ?? []), t]);
  // The tokens of the commands, by where they start (one that starts where another does keeps its place), with their place among all: asked for each command of a line that may have many.
  const readers = all.map((token, order) => ({ token, order })).filter(({ token }) => token.origin === 'shell' && READERS.has(token.kind))
    .sort((a, b) => a.token.span.start.line - b.token.span.start.line || a.token.span.start.character - b.token.span.start.character);
  /** The first of the tokens of the commands, among all, that lie in `span`, for which `keep` holds. */
  const readerWithin = (span: Span, keep: (t: Token) => boolean): Token | undefined => {
    let [low, high] = [0, readers.length];
    while (low < high) {
      const mid = (low + high) >> 1;
      if (le(span.start, readers[mid].token.span.start)) high = mid;
      else low = mid + 1;
    }
    let first: typeof readers[number] | undefined;
    for (let k = low; k < readers.length && le(readers[k].token.span.start, span.end); k++) {
      const r = readers[k];
      if ((!first || r.order < first.order) && spanWithin(r.token.span, span) && keep(r.token)) first = r;
    }
    return first?.token;
  };
  // (`last`: the innermost of those about the same text, a redirection's own under the command's: `>f`.)
  const tokenAt = (s: Span, kinds?: Set<string> | ((kind: string) => boolean), last = false): Token | undefined => {
    const found = shellAt.get(keyOf(s))?.filter((t) => !kinds || (typeof kinds === 'function' ? kinds(t.kind) : kinds.has(t.kind))) ?? [];
    return last ? found[found.length - 1] : found[0];
  };
  /** A token about the same text as a command's that is not the command's: a quote, an expansion (`"$@"`). */
  const notReader = (kind: string): boolean => !READERS.has(kind);

  /** A node of bash's reading (or bash's again), with the text and sections of its token if it has one. */
  const shellNode = (n: SyntaxNode, layer: Layer, kind: ShellKind, children: ReadingNode[], tokenKinds?: Set<string> | ((kind: string) => boolean), span = spanOf(n), last = false): ReadingNode => {
    const t = tokenAt(span, tokenKinds, last);
    const refs = t?.refs ?? (n.named ? nodeSections(n) : anonSections(n));
    return {
      layer, kind, label: short(n.text), span, ...(t ? saidBy(t) : {}), ...(refs ? { refs } : {}),
      ...(layer === 'child' ? { process: 'subshell' as const } : {}), ...(t?.name && kind === 'keyword' ? { name: t.name } : {}), children,
    };
  };

  /** The parts of the line in `n` that the explanation covers; `layer`: who reads `n`. */
  const collect = (n: SyntaxNode, layer: Layer): ReadingNode[] => withLists(n).flatMap((c) => {
    const s = spanOf(c);
    // (A redirection of a compound command after its end, on a later line, which the line of its first word says too: `done < f`.)
    if (REDIRECTS.has(c.type) && c.parent!.type === 'redirected_statement' && le(range.end, s.start) && shellAt.has(keyOf(s))) return node(c, layer);
    if (c.endIndex === c.startIndex || le(s.end, range.start) || le(range.end, s.start)) return [];
    if (spanWithin(s, range)) return node(c, layer);
    // A block around the line: its parts on the line. (A statement that is not a block is explained whole, so the
    // tokens cover a substitution in it whole.)
    return collect(c, layer);
  });

  const node = (c: SyntaxNode, layer: Layer): ReadingNode[] => {
    if (!c.named) {
      // A reserved word (3.2.1), or an operator: `;` of a list or of the head of a `for`, `!` in an expression (the
      // expression's: `[[ ! -f a ]]`), and in a word (`${!x}`, `{1..3}`). (Every token is a node: the parser makes none
      // for a newline.)
      const reserved = /^[a-z]|^[{}!]$|^\[\[$|^\]\]$/.test(c.type) && !isExpression(c.parent!) && !PARTS.has(c.parent!.type);
      const n = shellNode(c, layer, reserved ? 'keyword' : 'operator', [], new Set(['keyword', 'operator']));
      if (!n.text && c.parent!.type === 'extended_test' && (c.type === '[[' || c.type === ']]')) n.text = said(c.type === '[[' ? 'test-open' : 'test-close');
      // An operator of a conditional expression in `[[ ]]` (6.4): what it tests. (Its sections are the expression's,
      // src/refs.ts: `&&` there is not a list's.)
      if (isExpression(c.parent!) && c.field === 'operator' && expressionHost(c) === 'extended_test' && !n.text) {
        const op = testOperator(c);
        if (op) n.text = op;
      }
      return [n];
    }
    // An expression of `[[ ]]` or of arithmetic (6.4, 6.5). In arithmetic, a number is no word bash expands, nor is an
    // expansion part of one: bash expands it, then evaluates the expression (`$((1 + $n))`).
    if (isExpression(c)) return [construct(c, layer, 'expression')];
    if (ARITHMETIC.has(c.parent!.type) || (isExpression(c.parent!) && expressionHost(c) !== 'extended_test') || substring(c.parent!)) {
      if (c.type === 'number') return [shellNode(c, layer, 'expression', [])];
      if (PARTS.has(c.type)) return [part(c, layer)];
    }
    switch (c.type) {
      case 'command': return [simple(c, layer)];
      case 'comment': {
        if (!isShebang(c)) return [shellNode(c, layer, 'comment', [])];
        // (The shebang: what its interpreter reads the word after it as, `#!/bin/bash -eu`, which the kernel passes.)
        const reader = /^#![ \t]*(\S*)/.exec(c.text)![1];
        return [shellNode(c, layer, 'shebang', readParts(tokenAt(spanOf(c))!.children, false, { name: reader.slice(reader.lastIndexOf('/') + 1), inShell: false }))];
      }
      case 'variable_name': case 'special_variable_name': return [shellNode(c, layer, 'name', [])];
      case 'subscript': return [subscript(c, layer)];
      case 'command_list': return [construct(c, layer, 'list')];
      // (Nested from the left: `a && b || c` is an AND and OR list whose first part is the AND list `a && b`, which has its own node.)
      case 'list': return [construct(c, layer, andOrRole(c))];
      case 'pipeline': return [construct(c, layer, 'pipeline')];
      case 'redirected_statement': return [redirected(c, layer)];
      case 'function_definition': return [construct(c, layer, 'function')];
      case 'test_operator': {
        // (Only in `[[ ]]`: `-f`, `-eq`.)
        const n = shellNode(c, layer, 'operator', []);
        const op = testOperator(c);
        if (op && !n.text) n.text = op;
        return [n];
      }
    }
    if (REDIRECTS.has(c.type)) return [redirect(c, layer)];
    if (WORDS.has(c.type)) {
      const w = word(c, layer, 'word');
      // A word of a conditional expression in `[[ ]]` (6.4): what it is to its operator (the file `-f` tests).
      const op = !w.text && isExpression(c.parent!) && expressionHost(c) === 'extended_test' ? operandText(c) : undefined;
      return [op ? { ...w, text: op } : w];
    }
    return [construct(c, layer, constructKind(c.type))];
  };

  /**
   * What a word of a conditional expression in `[[ ]]` is to its operator, by the kind of its operands
   * (`unaryTestOperands`, `binaryTestOperands`), or by its side of `=`, `==` and `!=`: the string compared, the pattern
   * (said once, on the first part of a right side in parts: `*"$y"*`). The regex of `=~` is a language of its own.
   */
  const operandText = (c: SyntaxNode): string | undefined => {
    const p = c.parent!;
    const op = field(p, 'operator')?.text;
    // (`[[ ( a ) ]]`: a word alone in parentheses, which `-n` tests.)
    if (!op) return undefined;
    const say = (kind: keyof typeof testOperandTexts): string => testOperandTexts[kind][cx.lang].replace('{op}', op);
    if (p.type === 'unary_expression') return unaryTestOperands[op] && say(unaryTestOperands[op]);
    if (extendedEqualOps[op] || op === '=~') {
      if (c.field !== 'right') return say('compared');
      const first = fields(p, 'right')[0];
      return op === '=~' || c !== first ? undefined : say(cx.plainPattern(c) === undefined ? 'pattern' : 'plain');
    }
    return binaryTestOperands[op] && say(binaryTestOperands[op]);
  };

  /** What the operator of a conditional expression tests (`-f`: is an existing regular file; `==` in `[[ ]]`: a glob match). */
  const testOperator = (c: SyntaxNode): string | undefined => {
    const inDouble = c.parent!.type === 'binary_expression' && ['=', '==', '!='].includes(c.type);
    const op = c.type === 'test_operator' ? c.text : c.type;
    // (A pattern with no wildcard: a plain comparison, said here once.)
    const plain = inDouble && cx.plainPattern(fields(c.parent!, 'right')[0]) !== undefined;
    const text = c.parent!.type === 'unary_expression' && op !== '!' ? unaryTestOps[op] : plain ? plainPatternOps.operator[op] : inDouble ? extendedEqualOps[op] : binaryTestOps[op];
    return text?.[cx.lang];
  };

  /** A compound command, a list, a pipeline, a function: its parts in order, keywords and operators included. */
  const construct = (c: SyntaxNode, layer: Layer, kind: ShellKind): ReadingNode => {
    const children = withLists(c).flatMap((x) => {
      // (The name of a function or of a coprocess, which bash does not expand.)
      if (x.field === 'name' && (kind === 'function' || kind === 'coprocess')) return [shellNode(x, layer, 'name', [])];
      // (`time -p`: the option of the reserved word, which bash reads as written, not a word it expands.)
      if (x.field === 'option' && c.type === 'time_statement') return [{ ...shellNode(x, layer, 'option', [], new Set(['option'])), refs: ['3.2.3'] }];
      // `time` and `!` are parts of the pipeline after them (3.2.3: `[time [-p]] [!] command1 [| command2]…`), as in
      // bash's parser: one pipeline, not one in another (`! a | b`, `time ! a`).
      if (kind === 'pipeline') return node(x, layer).flatMap((p) => (p.kind === 'pipeline' ? p.children : [p]));
      return node(x, layer);
    });
    const n = shellNode(c, layer, kind, children);
    // A skeleton names a compound command better than its first line (`if ‹condition› then … fi`).
    const t = tokenAt(n.span);
    if (t && kind !== 'list' && kind !== 'andList' && kind !== 'orList' && kind !== 'andOrList' && kind !== 'pipeline') n.label = t.label;
    // (A list over several lines, as the labels of the list view say it: `a …`.)
    else if (kind === 'list' && c.text.includes('\n')) n.label = `${n.label} …`;
    return n;
  };

  /**
   * A compound command with redirections (`while …; done < f`, `f() { …; } > log`): the command, with them as its last
   * parts. They are its own, as in bash's parser (3.2.5, 3.6), not around it.
   */
  const redirected = (c: SyntaxNode, layer: Layer): ReadingNode => {
    const body = field(c, 'body')!;
    const [n] = node(body, layer);
    const redirects = withLists(c).filter((x) => x !== body).flatMap((x) => node(x, layer));
    pushAll(n.children, redirects);
    n.span = spanOf(c);
    n.label = [n.label, ...redirects.map((r) => r.label)].join(' ');
    return n;
  };

  /**
   * A simple command as bash reads it (3.7.1): its assignments, its command name, its arguments and its
   * redirections, in order; under each argument, what the command reads of it.
   */
  const simple = (c: SyntaxNode, layer: Layer): ReadingNode => {
    const reads = readingOf(c);
    let reader: Reader | undefined;
    let named = false;
    let dynamic = false;
    let aliases: ReturnType<typeof aliasesAfter> = [];
    const children = c.namedChildren.flatMap((x): ReadingNode[] => {
      if (x.type === 'command_name') {
        named = true;
        const { node: n, runs, res } = commandName(x.namedChildren[0], layer, reads);
        dynamic = n.kind === 'expandedName';
        // (After an alias, the command that reads the words is the one its text runs: `ll x` is `ls -l x`.)
        reader = runs;
        // (Words after it that bash reads as aliases too, when its text ends with a blank: 6.6.)
        if (res) aliases = aliasesAfter(c, res, cx.resolve);
        return [n];
      }
      const alias = aliases.find((a) => a.word === x);
      if (alias) return [aliasWord(x, alias.res, tokenAt(spanOf(x), ALIAS), layer === 'child' ? { process: 'subshell' } : {}, false).node];
      // (The words of a declaration builtin that are assignments are its arguments: bash expands them as assignments.)
      if (x.type === 'variable_assignment') return [assignment(x, layer, named ? 'assignmentArgument' : 'assignment')];
      // After a name known only when it runs, a word is an argument, or the name when the words before expand to nothing.
      if (named && WORDS.has(x.type)) return [word(x, layer, dynamic ? 'word' : 'argument')];
      return node(x, layer);
    });
    // What the command reads of its arguments: under the word each is about, or after the words it reads together.
    // A command it runs (`sudo ls -l`, `xargs grep -n x`) is under the word of its name, and what that command reads
    // under its own words. (Not when its name is known only when it runs: nor is what it reads.)
    const words = children.filter((w) => w.kind !== 'redirect');
    const place = (p: ReadingNode): void => {
      // (The words are in order, and do not overlap: only the last that starts by here can hold it. A command of many words asks for each.)
      const last = lastAt(words, p.span.start);
      const at = last && spanWithin(p.span, last.span) ? last : undefined;
      const head = !at && p.layer === 'command' && RUNS.has(p.kind) && last && le(p.span.start, last.span.start) ? last : undefined;
      if (at) at.children.push(p);
      else if (head) {
        // (A builtin run in this shell: no other command reads it, `builtin cd`. What it reads of the words after it is still its own.)
        const { reader: _, inShell: __, ...own } = p;
        head.children.push(builtinHere(p)
          ? { ...own, layer, kind: 'commandName', resolves: 'builtin', span: head.span, children: [] }
          : { ...p, span: head.span, children: [] });
        p.children.forEach(place);
      } else {
        let i = children.length;
        while (i > 0 && !le(children[i - 1].span.end, p.span.end)) i--;
        children.splice(i, 0, p);
      }
    };
    (reads && !dynamic ? readParts(reads.children, true, reader!) : []).forEach(place);
    const n = shellNode(c, layer, 'command', children, new Set(['redirect']));
    // (`>f` alone: the redirection's text is its own, not the command's too.)
    if (children.some((x) => same(x.span, n.span) && x.text === n.text)) delete n.text;
    // (Its text runs to the end of a here-document, past what follows it on the line: `cat <<E; echo b`.)
    const ends = c.namedChildren.map((x) => ((x.type === 'heredoc_redirect' && x.namedChildren.find((h) => h.type === 'heredoc_start')) || x).endIndex);
    n.label = short(c.text.slice(0, mostOf(ends) - c.startIndex));
    n.refs = union(['3.2.2', '3.7.1'], n.refs);
    return n;
  };

  /** The token of the command `c` (the outermost about it: not one of a command in a substitution inside it). */
  const readingOf = (c: SyntaxNode): Token | undefined => {
    const name = field(c, 'name');
    if (!name) return undefined;
    const subs = c.namedChildren.flatMap(function inner(x: SyntaxNode): Span[] {
      return SUBSTITUTIONS.has(x.type) ? [spanOf(x)] : x.namedChildren.flatMap(inner);
    });
    const span = spanOf(c);
    return readerWithin(span, (x) => !subs.some((s) => spanWithin(x.span, s)));
  };

  /**
   * The first word of a simple command: the command name as written, which bash looks up (3.7.2), with what the
   * explanation says of the command; or, when it has an expansion, a word whose first field is the name when it runs.
   */
  const commandName = (w: SyntaxNode, layer: Layer, t: Token | undefined): { node: ReadingNode; runs?: Reader; res?: AliasResolution } => {
    const name = staticWordValue(w, false, cx.shell);
    const span = spanOf(w);
    const own = tokenAt(span, READERS) ?? t;
    const process = layer === 'child' ? { process: 'subshell' as const } : {};
    if (name === undefined) {
      const n = word(w, layer, 'expandedName');
      n.refs = union(['3.7.1'], n.refs);
      // (What the command's token says, `"$@"`: the word runs what it expands to.)
      if (own) Object.assign(n, saidBy(own));
      return { node: n };
    }
    const res = cx.resolve(name, w);
    if (res.kind === 'alias') return { ...aliasWord(w, res, own, process), res };
    // (`[`: its token is the command's, which has the word in it, so the word is said by itself, as it was when it had a token of its own.)
    const nameSaid = (t: Token) => (t.nameWord ? { text: t.nameWord.text } : saidBy(t));
    const nameSections = (t: Token | undefined) => (t?.nameWord ? t.nameWord.refs : t?.refs);
    return {
      node: {
        layer, kind: 'commandName', label: short(w.text), span, ...(own ? nameSaid(own) : {}),
        refs: union(['3.7.1', '3.7.2'], nameSections(own), expansionSections(cx.meaning(w))), resolves: res.kind, ...(own?.name ? { name: own.name } : {}), ...process, children: wordParts(w, layer),
      },
      // (The name it spells: `"ls"` and `\if` are `ls` and `if`.)
      runs: { name: short(name), inShell: resolvesInShell(res) },
    };
  };

  /**
   * An alias as the first word (6.6): bash replaces it with its text when it reads the line, before it expands the
   * words (3.7.1), so the name it looks up is the first word of that text, and the rest are arguments before those
   * written after the alias. Under it, that text as bash reads it, when it is plain words; `runs`: the command that
   * reads the words after it. A word after an alias whose text ends with a blank (`first` false) may be one too: its
   * text's words are then arguments.
   */
  const aliasWord = (w: SyntaxNode, res: AliasResolution, own: Token | undefined, process: { process?: 'subshell' }, first = true): { node: ReadingNode; runs: Reader } => {
    const span = spanOf(w);
    const layer: Layer = process.process ? 'child' : 'bash';
    const value = res.alias.value;
    let runs: NameResolution | undefined = res;
    while (runs?.kind === 'alias') runs = runs.target;
    const words = plainWords(value);
    // (The analyzer explains an alias over the command of its name, `alias grep='grep --color=auto'`, as that command.)
    const aliasText = own?.refs?.includes('6.6');
    const children: ReadingNode[] = (words ?? []).map((x, i) => ({
      layer, kind: i || !first ? 'argument' : 'commandName', label: x, span, ...process,
      // (A first word of plain text is one the resolution follows: `target`.)
      ...(i || !first ? { refs: ['3.7.1'] } : { refs: ['3.7.1', '3.7.2'], resolves: res.target!.kind, ...(aliasText || !own ? {} : saidBy(own)) }),
      children: [],
    }));
    return {
      node: {
        layer, kind: 'aliasWord', label: short(w.text), span, ...(aliasText ? saidBy(own!) : res.sure ? { text: said('alias-replaced', { name: w.text, value }) } : {}),
        // (Without its own token: bash replaces it only where it is expanded, `res.sure`; elsewhere the node says nothing, a script does not expand aliases unless the shell option is on.)
        // (The token of an alias as the command name has its name's facts: the analyzer resolves it.)
        refs: ['6.6'], ...(own?.name ? { name: own.name } : {}), ...process, children,
      },
      runs: { name: runs?.name ?? short(value), inShell: resolvesInShell(runs) },
    };
  };

  /**
   * Whether `c` is a part of a word bash reads: a quote, an expansion, a brace expression where bash expands it (not
   * in dash, nor in the value of an assignment, `x={a,b}`: there its braces are text).
   */
  const isPart = (c: SyntaxNode): boolean =>
    PARTS.has(c.type) && (c.type !== 'brace_expression' || cx.meaning(c)!.steps.find((s) => s.kind === 'brace')!.applies !== false);

  /** What bash does to the word `w`, on its node (or on an assignment, of its value). */
  const setSteps = (n: ReadingNode, w: SyntaxNode): void => {
    const m = cx.meaning(w);
    const list = m && wordSteps(m);
    if (list) n.steps = { list, context: m.context };
  };

  const word = (w: SyntaxNode, layer: Layer, kind: ShellKind): ReadingNode => {
    // (A word that is one part, a quote or an expansion, has that part under it, with its explanation.)
    const one = isPart(w);
    const n = shellNode(w, layer, kind, wordParts(w, layer), one ? new Set() : WORD_TOKENS);
    // (Braces that bash does not expand here are text: `m=(k {a,b})` of an associative array.)
    if (w.type === 'brace_expression' && !one) delete n.refs;
    // (What bash does to it that no part shows: brace and tilde expansion, splitting, globbing, a pattern's matching.
    // An item of a brace expression is a piece of the word, which cites them.)
    if (w.parent!.type !== 'brace_expression') {
      n.refs = union(kind === 'argument' ? ['3.7.1'] : [], n.refs, expansionSections(cx.meaning(w)));
      setSteps(n, w);
    }
    // A language in a word no command reads, which bash reads itself (the regex of `=~`), is under the word.
    if (w.parent!.type !== 'command' && w.parent!.type !== 'command_name') {
      for (const c of tokenAt(n.span, WORD_TOKENS)?.children ?? []) if (c.origin === 'embedded') language(n.children, c, 'bash');
    }
    return n;
  };

  /** The parts bash reads in a word: the word itself when it is one part; else its parts, and bash's tokens in its text. */
  const wordParts = (w: SyntaxNode, layer: Layer): ReadingNode[] => {
    if (isPart(w)) return [part(w, layer)];
    return withTokens(w, inner(w, layer), layer);
  };

  /** The parts under `n`, outermost first. */
  const inner = (n: SyntaxNode, layer: Layer): ReadingNode[] =>
    n.namedChildren.flatMap((c) => (isPart(c) ? [part(c, layer)] : inner(c, layer)));

  /**
   * `parts` of `n`, with bash's tokens in its text that no part has: the parts of a glob (`*`, `.txt`), the escapes of
   * `$'…'`, a tilde after `=` (`x=~/y`), the start, end and increment of `{1..10..3}`, in the order of the text.
   */
  const withTokens = (n: SyntaxNode, parts: ReadingNode[], layer: Layer): ReadingNode[] => {
    const span = spanOf(n);
    const found: ReadingNode[] = [];
    const look = (ts: readonly Token[]): void => {
      for (const t of ts) {
        // (A token around the word, or the word's own: what is under it. One inside a part: the part's.)
        if (spanWithin(span, t.span)) look(t.children);
        else if (!spanWithin(t.span, span) || parts.some((p) => spanWithin(t.span, p.span))) continue;
        else if (t.origin === 'shell' && PART_TOKENS.has(t.kind)) found.push(partToken(t, layer));
        else look(t.children);
      }
    };
    look(items);
    return [...parts, ...found].sort(byStart);
  };

  /** A token of bash's reading in a word, with the tokens of bash's under it. */
  const partToken = (t: Token, layer: Layer): ReadingNode => ({
    // (They cite no sections of their own: the word, or the quote around them, does.)
    layer, kind: t.kind, label: t.label, span: t.span, ...saidBy(t), ...(layer === 'child' ? { process: 'subshell' as const } : {}),
    children: t.children.filter((c) => c.origin === 'shell').map((c) => partToken(c, layer)),
  });

  const part = (p: SyntaxNode, layer: Layer): ReadingNode => {
    if (SUBSTITUTIONS.has(p.type)) {
      // A subshell parses the text between `$(` (or `<(`, a backquote) and the end.
      const open = p.children[0];
      const close = p.children[p.children.length - 1];
      const span: Span = { start: point(open.endPosition.row, open.endPosition.column), end: point(close.startPosition.row, close.startPosition.column) };
      const text = p.text.slice(open.endIndex - p.startIndex, close.startIndex - p.startIndex);
      // (Its statements, with the lists of commands they make: `$(a; b &)`.)
      const children = withLists(p).filter((c) => c.named || c.type === ';' || c.type === '&').flatMap((c) => node(c, 'child'));
      // (A subshell's environment, 3.7.3; but bash 5.3 runs `${ …; }` and `${| …; }` in this shell, and so what is in
      // them, up to a substitution in them that has a subshell of its own.)
      const same = p.type === 'command_substitution' && substitutionForm(p).startsWith('${');
      const script: ReadingNode = { layer: 'child', kind: 'script', label: short(text.trim()), span, process: 'subshell', ...(same ? {} : { refs: ['3.7.3'] }), children };
      if (same) {
        const here = (n: ReadingNode): void => {
          n.process = 'same';
          n.children.filter((c) => c.layer === 'child' && c.kind !== 'script').forEach(here);
        };
        here(script);
      }
      return shellNode(p, layer, 'substitution', [script]);
    }
    const kind: ShellKind = p.type === 'simple_expansion' || p.type === 'expansion' ? 'expansion'
      : p.type === 'arithmetic_expansion' ? 'arithmetic' : p.type === 'brace_expression' ? 'brace' : 'quote';
    // (The expression of `$(( ))`, as that of `(( ))`: its operators, names and numbers. The parts of `${ }` between
    // its braces (3.5.3): the parameter, the operators, and a word (`${x:-$y}`), a pattern (`${x#*/}`) or the
    // arithmetic of a substring (`${x:i+1:2}`). An element of an array, `${a[i]}`, is read as in an assignment: `subscript`.)
    const parts = kind === 'arithmetic' || p.type === 'expansion'
      ? p.children.filter((x) => !DELIMITERS.has(x.type)).flatMap((x) => node(x, layer))
      // (The braces, `..` and `,` of `{1..10..3}` and `{a,b}`, and the strings of a list; the numbers of a sequence have
      // tokens, as the escapes of `$'…'` do.)
      : kind === 'brace' ? p.children.filter((x) => x.type !== 'number').flatMap((x) => node(x, layer))
      : inner(p, layer);
    // (Not the command's token, when the part is its name: `"$@"`.)
    return shellNode(p, layer, kind, QUOTES.has(p.type) || kind === 'brace' ? withTokens(p, parts, layer) : parts, notReader);
  };

  /**
   * An element of an array, `a[i]` (6.7): its name, `[`, its index and `]`, each a node. Bash reads the index when it
   * runs, by the kind of the array: `index`.
   */
  const subscript = (s: SyntaxNode, layer: Layer): ReadingNode => {
    const ix = field(s, 'index')!;
    const brackets = s.children.filter((c) => !c.named);
    // (What the explanation says of the index with its brackets: `[i+1]` of `${a[i+1]}`.)
    const said = tokenAt({ start: spanOf(brackets[0]).start, end: spanOf(brackets[brackets.length - 1]).end });
    const children = s.children.map((c) => (c === ix ? index(field(s, 'name')!.text, s, ix, layer, said)
      : c.named ? shellNode(c, layer, 'name', []) : shellNode(c, layer, 'operator', [], new Set(['operator']))));
    return shellNode(s, layer, 'name', children);
  };

  /**
   * The index of the array `name` in `owner` (a subscript, or a value `[k]=v`), from `ix` (a node, or a range of the
   * owner's text): `@` and `*` are all the elements; the index of an indexed array is an arithmetic expression (6.7),
   * read as `(( ))` reads one (6.5); that of an associative array, a key, is a word bash expands. Where the kind of the
   * array is not known here, a word, which the explanation says may be either. `said`: what the explanation says of it.
   */
  const index = (name: string, owner: SyntaxNode, ix: SyntaxNode | { start: number; end: number }, layer: Layer, said?: Token): ReadingNode => {
    const at = 'type' in ix ? { start: ix.startIndex, end: ix.endIndex } : ix;
    const text = owner.text.slice(at.start - owner.startIndex, at.end - owner.startIndex);
    const span: Span = { start: posIn(owner, at.start), end: posIn(owner, at.end) };
    if (text === '@' || text === '*') return { layer, kind: 'subscript', label: text, span, ...(said ? saidBy(said) : {}), refs: ['6.7'], children: [] };
    const expr = cx.arrayKind(name, owner) !== 'indexed' ? undefined
      : 'type' in ix && (ix.type === 'number' || isExpression(ix)) ? ix : tree.arithmetic(owner, at.start, at.end);
    if (expr) {
      const [n] = expr.type === 'number' ? [shellNode(expr, layer, 'expression', [])] : PARTS.has(expr.type) ? [part(expr, layer)] : node(expr, layer);
      return { ...n, ...(n.text || !said ? {} : saidBy(said)), refs: union(['6.7', '6.5'], n.refs) };
    }
    if ('type' in ix) {
      const n = word(ix, layer, 'word');
      return { ...n, ...(said ? saidBy(said) : {}), refs: union(['6.7'], n.refs) };
    }
    return { layer, kind: 'word', label: short(text), span, refs: ['6.7'], children: inner(owner, layer).filter((p) => spanWithin(p.span, span)) };
  };

  /**
   * The list of a compound assignment, `( … )` (6.7): its parentheses, and its values, each a word that bash expands
   * (all the expansions, 3.5), or `[k]=v` (`element`).
   */
  const array = (a: SyntaxNode, layer: Layer): ReadingNode =>
    shellNode(a, layer, 'part', a.children.flatMap((c) => (c.named ? element(c, layer) : [shellNode(c, layer, 'operator', [], new Set(['operator']))])));

  /**
   * A value of a compound assignment written `[k]=v` (6.7): the brackets and the index (or key) between them, `=` (or
   * `+=`), and the value, which bash expands as that of an assignment (3.4: no splitting, no globbing). Others are words
   * (and so is `[k]=v` in the list of keys and values of an associative array, `setsElement`, and one bash 5.2
   * brace-expands into values, `[4]={a,b}`).
   */
  const element = (e: SyntaxNode, layer: Layer): ReadingNode[] => {
    const name = field(e.parent!.parent!, 'name')!.text;
    const braced = cx.meaning(e)!.steps.find((s) => s.kind === 'brace')!.applies === true;
    const m = (e.type === 'word' || e.type === 'concatenation') && !braced && setsElement(e, cx.arrayKind(name, e) === 'assoc') ? splitElement(e.text)! : undefined;
    if (!m) {
      // (A key or a value of an associative array, which the explanation says it is: not a plain `Word`.)
      const [n] = node(e, layer);
      const t = tokenAt(n.span, new Set(['argument', 'error']));
      return [t && !n.text && t.explanation !== said('word-plain', { text: e.text }) ? { ...n, ...saidBy(t) } : n];
    }
    const range = (from: number, to: number): Span => ({ start: posIn(e, from), end: posIn(e, to) });
    const op = (from: number, label: string): ReadingNode => ({ layer, kind: 'operator', label, span: range(from, from + label.length), refs: ['6.7'], children: [] });
    const key = e.startIndex + 1;
    const close = key + m.key.length;
    const value = close + m.plus.length + 2;
    const valueSpan = range(value, e.endIndex);
    const parts: ReadingNode[] = [op(e.startIndex, '['), index(name, e, { start: key, end: close }, layer), op(close, ']'), op(close + 1, `${m.plus}=`)];
    if (m.value) {
      parts.push({
        layer, kind: 'word', label: short(m.value), span: valueSpan, refs: expansionSections(cx.meaning(e)),
        children: inner(e, layer).filter((p) => spanWithin(p.span, valueSpan)),
      });
    }
    // (Its text is the explanation's of the element: `Element with index 3: set it to x`.)
    return [shellNode(e, layer, 'word', parts, new Set(['argument']))];
  };

  const assignment = (a: SyntaxNode, layer: Layer, kind: 'assignment' | 'assignmentArgument'): ReadingNode => {
    const value = field(a, 'value');
    // (The list of a compound assignment, `a=(x "$y" *.txt)`: `array`.)
    const parts = !value ? [] : value.type === 'array' ? [array(value, layer)] : isPart(value) ? [part(value, layer)] : withTokens(value, inner(value, layer), layer);
    // (A language bash reads in the value each time it uses it, a prompt string, `PS1='\u@\h'` (6.9), is under the
    // value, which is one part.)
    if (value && value.type !== 'array' && parts.length === 1) for (const c of tokenAt(spanOf(value), WORD_TOKENS)?.children ?? []) if (c.origin === 'embedded') language(parts[0].children, c, 'bash');
    // (Its operator, `=` or `+=`, between the name and the value: 3.4.)
    const op = a.children.find((c) => !c.named && c.type.endsWith('='))!;
    const name = field(a, 'name')!;
    // (A word is the value, whatever its parts are; `array` says what a list is.)
    const said = value && value.type !== 'array' ? [shellNode(value, layer, 'value', parts)] : parts;
    const n = shellNode(a, layer, kind, [name.type === 'subscript' ? subscript(name, layer) : shellNode(name, layer, 'name', []), shellNode(op, layer, 'operator', []), ...said], new Set(['assignment']));
    // (An assignment of a simple command, before its name or with none: 3.7.1 says when it is made. One that is an
    // argument of a declaration builtin, 3.4 says, is expanded as an assignment.)
    if (kind === 'assignment' && a.parent!.type === 'command') n.refs = union(n.refs, ['3.7.1']);
    // (What bash does to its value that no part shows: a tilde after `=` or `:`, `x=~/a:~/b`.)
    if (value && value.type !== 'array') {
      n.refs = union(n.refs, expansionSections(cx.meaning(value)));
      setSteps(n, value);
    }
    return n;
  };

  /**
   * A redirection as bash reads it (3.6): the descriptor written before its operator (`2>`, `{fd}>`), the operator, and
   * the word after it, which bash expands; for a here-document, the delimiter, which it does not, then the body (3.6.6).
   * Its text is its own token's, under that of a command it is all of (`>f`).
   */
  const redirect = (r: SyntaxNode, layer: Layer): ReadingNode => {
    const parts = r.children.flatMap((c): ReadingNode[] => {
      if (!c.named) return [shellNode(c, layer, 'operator', [], new Set(['operator']))];
      if (c.type === 'file_descriptor') return [shellNode(c, layer, 'descriptor', [], new Set())];
      if (c.type === 'heredoc_start') return [shellNode(c, layer, 'delimiter', [], new Set())];
      if (c.type === 'heredoc_body') return [shellNode(c, layer, 'heredoc', inner(c, layer))];
      // (The line that ends a here-document: its delimiter says what it is.)
      if (c.type === 'heredoc_end') return [];
      return [word(c, layer, 'word')];
    });
    // (`cat <<` while typing: a here-document with no delimiter yet, nor a body.)
    const start = r.type === 'heredoc_redirect' ? r.namedChildren.find((c) => c.type === 'heredoc_start') : undefined;
    if (!start) return shellNode(r, layer, 'redirect', parts, new Set(['redirect']), spanOf(r), true);
    // A here-document: the operator and its delimiter on the line, then its body.
    const span: Span = { start: point(r.startPosition.row, r.startPosition.column), end: point(start.endPosition.row, start.endPosition.column) };
    const n = shellNode(r, layer, 'redirect', parts, new Set(['redirect']), span, true);
    n.label = short(r.text.slice(0, start.endIndex - r.startIndex));
    return n;
  };

  /**
   * The tokens under a command's token as layers: what the command reads (`argv`), the languages (`embedded`), and the
   * scripts a command gives a shell (`script`). Bash's parts of a word are already in its layer: their tokens give way to
   * what is under them, but for a substitution, whose commands are under its subshell. `top`: the command's own
   * token's parts, where bash's tokens are its name, assignments and redirections. `reader`: the command that reads.
   * `languages`: false under an assignment a command reads (`export PS1='\u'`), whose value's language is bash's (a
   * prompt string), under the value in bash's layer.
   */
  const readParts = (tokens: readonly Token[], top: boolean, reader: Reader, languages = true): ReadingNode[] => {
    const out: ReadingNode[] = [];
    for (const t of tokens) {
      if (t.origin === 'argv') out.push(tokenNode(t, 'command', reader));
      else if (t.origin === 'embedded') {
        if (languages) language(out, t, reader.name);
      }
      // (A string a shell reads: its own reading, which the string's first token holds, src/explain/scripts.ts.)
      else if (t.origin === 'script') pushAll(out, t.reading ?? []);
      // (At the top, bash's tokens are the command's name, assignments and redirections, and the words it takes as
      // they are, with what is under them: the script of `eval "ls"`.)
      // A quoted word whose text a shell reads again (`eval "ls; echo hi"`) is an operand the command reads as a
      // script, as an unquoted one is (`eval ls`).
      else if (top && t.kind === 'string' && t.children.some((c) => c.origin === 'script')) {
        out.push({ layer: 'command', kind: 'argument', label: t.label, span: t.span, text: said('script-run-again'), ...readBy(reader), children: readParts(t.children, false, reader) });
      } else if (t.kind !== 'substitution' && (!top || WORD_TOKENS.has(t.kind))) pushAll(out, readParts(t.children, false, reader, languages));
    }
    return out;
  };

  /** A token the command reads, and the tokens under it by their own origins. (A command it runs reads what follows.) */
  const tokenNode = (t: Token, layer: Layer, reader: Reader): ReadingNode => ({
    layer, kind: t.kind, label: t.label, span: t.span, ...readBy(reader), ...(t.refs ? { refs: t.refs } : {}), ...(t.name ? { name: t.name } : {}), ...(t.valueFor ? { valueFor: t.valueFor } : {}), ...(t.expands ? { expands: t.expands } : {}),
    // (A word the command reads as a script, which the analyzer says only is a word: `eval ls`.)
    ...(t.explanation === said('word-plain', { text: t.label }) && t.children.some((c) => c.origin === 'script') ? { text: said('script-run-again') } : saidBy(t)),
    children: testPartsIn(t, readParts(t.children, false, RUNS.has(t.kind) ? { name: t.label, inShell: builtinHere(t) } : reader, t.kind !== 'assignment'), layer, reader),
  });

  /** What a token has under it, and if it is a test of `[` or `test`, its operator and its operands, the words bash passes it, as `[[ ]]` has them, in the order of the text. */
  const testPartsIn = (t: Token, children: ReadingNode[], layer: Layer, reader: Reader): ReadingNode[] =>
    (t.testParts ? [...children, ...t.testParts.map((p) => ({ layer, ...p, label: short(p.label), ...readBy(reader), children: [] }))].sort(byStart) : children);

  /** Adds a token of a language to `out`: under the node of its language, which it starts when it is the first. */
  const language = (out: ReadingNode[], t: Token, reader: string): void => {
    const last = out[out.length - 1];
    const node = langNode(t, reader);
    // (The outermost tokens of a language say which it is: `Token.language`.)
    if (last?.kind === 'language' && last.layer === 'language' && last.label === t.language) {
      last.children.push(node);
      last.span = { start: last.span.start, end: t.span.end };
    } else out.push({ layer: 'language', kind: 'language', label: t.language!, span: t.span, reader, children: [node] });
  };
  const langNode = (t: Token, reader: string): ReadingNode => ({
    layer: 'language', kind: t.kind, label: t.label, span: t.span, ...saidBy(t), reader, children: t.children.filter((c) => c.origin === 'embedded').map((c) => langNode(c, reader)),
  });

  const root: ReadingNode = { layer: 'bash', kind: 'line', label: '', span: range, children: collect(tree.root, 'bash') };
  // (A node that cites no section has no `refs`.)
  for (const n of readingNodes(root)) if (n.refs && !n.refs.length) delete n.refs;
  return root;
}

/**
 * A node of the reading of a string a shell reads as a script, as the reading of the line around it has it: what the string's own shell parses
 * is the layer `child`, of `process`, at `span` in the source; what it holds keeps its own reader (a command, a language, a `$( )` of that shell).
 */
export function readAgain(n: ReadingNode, process: ScriptProcess, span: (s: Span) => Span, keep: (c: ReadingNode) => boolean): ReadingNode {
  const children = n.children.filter(keep).map((c) => readAgain(c, process, span, keep));
  return { ...n, ...(n.layer === 'bash' ? { layer: 'child' as const, process } : {}), span: span(n.span), children };
}

/** Every node of a reading tree, depth first. */
export function readingNodes(n: ReadingNode): ReadingNode[] {
  return [n, ...n.children.flatMap(readingNodes)];
}
