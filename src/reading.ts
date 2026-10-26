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
//   `ReadingNode.process` says which. Levels inside levels (`bash -c 'echo $(pwd)'`, a `$( )` in a `$( )`) are all
//   this layer: they are not counted.
// - `command`: each command reads its arguments as its spec says: the tokens of the argument interpreter
//   (`Token.origin` `argv`: options, operands, subcommands, a command it runs, the expression of `test`), under the
//   argument word each is about (or after the words, when one reads several: `-n 5`, `[`'s expression).
// - `language`: a language inside a word, read by its own rules: the tokens of an embedded explainer (`embedded`: a
//   regex, a sed script, a jq filter, a printf format…), grouped by `Token.language`. The command reads it, except the
//   regex of `[[ =~ ]]`, which bash matches itself (its regex library, POSIX ERE).
//
// The layers come from the tree and from `Token.origin`, never from a label or an explanation. The explanations of
// the nodes are those of the tokens about the same text: bash's own (`shell`) for the nodes bash reads.
import type { Pos, ScriptProcess, Span, Token } from './analyzer-types';
import { binaryTestOps, extendedEqualOps, unaryTestOps } from './dict/syntax';
import type { Lang } from './i18n';
import { anonSections, CONSTRUCTS, expressionHost, isExpression, nodeSections } from './refs';
import type { NameResolution } from './semantics/names';
import type { NameInfo } from './namefacts';
import { type ExpansionStep, STEP_MANUAL, type StepKind, type WordMeaning } from './semantics/words';
import { staticWordValue } from './staticword';
import { field, isShebang, substitutionForm, type SyntaxNode, type SyntaxTree, withLists } from './syntax/tree';

/** Who reads a part: bash, bash again (a substitution, or a string a command gives a shell), the command, a language. */
export type Layer = 'bash' | 'child' | 'command' | 'language';

/** What a node of bash's reading is (a node of the other layers has its token's kind). */
export type ShellKind =
  | 'line' // the line as bash reads it: the root
  | 'script' // the text of a substitution, as the subshell parses it
  | 'list' // a list of commands (3.2.4): pipelines and AND/OR lists joined by `;` and `&` (and newlines, in a body)
  | 'andList' | 'orList' // an AND list (`a && b`) or an OR list (`a || b`); `a && b || c` is an OR list in which `a && b` is an AND list
  | 'pipeline' | 'command' | 'compound' | 'clause' | 'coprocess' | 'function'
  | 'commandName' // the first word of a simple command, when it is the command name as written
  | 'aliasWord' // the first word, when it is an alias: bash replaces it with its text when it reads the line (6.6)
  | 'expandedName' // the first word, when it has an expansion: the name is known only when it runs
  | 'option' // an option of a reserved word, read as written: `time -p` (3.2.3)
  | 'argument' // a word after the command name
  | 'assignmentArgument' // an argument of a declaration builtin that is an assignment (`local x=1`)
  | 'word' | 'name' | 'assignment' | 'redirect' | 'heredoc'
  | 'quote' | 'expansion' | 'substitution' | 'arithmetic' | 'brace'
  | 'operator' | 'keyword' | 'comment'
  | 'shebang' // the first line `#!…`: to bash a comment (3.1.3), which the kernel reads when the file is run as a program
  | 'expression' // an expression of `[[ ]]` (a conditional expression, 6.4) or of arithmetic (6.5), and a number there
  | 'descriptor' // the file descriptor a redirection is about, written before its operator: `2>`, `{fd}>` (3.6)
  | 'delimiter' // the word after `<<`, which ends a here-document: not a word bash expands (3.6.6)
  | 'part'; // another part of a construct: the body of a loop, `do … done`

export interface ReadingNode {
  layer: Layer;
  /**
   * A `ShellKind` in the layers `bash` and `child` (except under a string a command gives a shell, which has tokens
   * only, and the parts bash reads in a word that have no node of their own: a glob, an escape); in the others, the
   * token's `Kind`, or `language` (the root of a language, labelled with its name).
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
  /** In the layer `child`: which shell parses it (`ScriptProcess`). */
  process?: ScriptProcess;
  /** On a `commandName`: what bash runs for it (3.7.2), from the name resolution of src/semantics/names.ts. */
  resolves?: NameResolution['kind'];
  /** On a word a command reads as the value of an option: the option (`-f`, `--file`). */
  valueFor?: string;
  /** On an `aliasWord`: the alias's text, which bash reads in its place. */
  replacement?: string;
  /** On a command name (and the reserved word `time`): what the name is, and what else (`Token.name`). */
  name?: NameInfo;
  children: ReadingNode[];
}

/** What the reading tree asks of the analyzer. */
export interface ReadingContext {
  lang: Lang;
  /** What bash runs for the command name `name`, written as `word` (src/semantics/names.ts `resolveName`). */
  resolve(name: string, word: SyntaxNode): NameResolution;
  /** What bash does to the word `w` in its context (src/semantics/words.ts `wordMeaning`). */
  meaning(w: SyntaxNode): WordMeaning | undefined;
}

/** The texts the tree says itself, where no token says them. */
const TEXTS = {
  /** An alias the analyzer explains as the command it runs (`alias grep='grep --color=auto'`). */
  alias: { ja: (name: string, value: string) => `エイリアス \`${name}\`: bash は行を読むときに \`${value}\` に置き換える`, en: (name: string, value: string) => `The alias \`${name}\`: bash replaces it with \`${value}\` when it reads the line` },
  /** A string `eval` reads again (the analyzer's own text for the words it joins). */
  again: { ja: 'もう一度読んで実行する文字列', en: 'Text to read and run again' },
  /** The text of the analyzer for a word it says nothing more of (`Analyzer.word`). */
  word: { ja: (w: string) => `文字列 \`${w}\``, en: (w: string) => `Word \`${w}\`` },
};

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
const point = (row: number, column: number): Pos => ({ line: row, character: column });
const spanOf = (n: SyntaxNode): Span => ({ start: point(n.startPosition.row, n.startPosition.column), end: point(n.endPosition.row, n.endPosition.column) });
const keyOf = (s: Span): string => `${s.start.line}:${s.start.character}-${s.end.line}:${s.end.character}`;
const within = (inner: Span, outer: Span): boolean => le(outer.start, inner.start) && le(inner.end, outer.end);
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
      layer, kind, label: short(n.text), span, ...(t ? { text: t.explanation } : {}), ...(refs ? { refs } : {}),
      ...(layer === 'child' ? { process: 'subshell' as const } : {}), ...(t?.name && kind === 'keyword' ? { name: t.name } : {}), children,
    };
  };

  /** The parts of the line in `n` that the explanation covers; `layer`: who reads `n`. */
  const collect = (n: SyntaxNode, layer: Layer): ReadingNode[] => withLists(n).flatMap((c) => {
    const s = spanOf(c);
    if (c.endIndex === c.startIndex || le(s.end, range.start) || le(range.end, s.start)) return [];
    if (within(s, range)) return node(c, layer);
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
      case 'comment': return [shellNode(c, layer, isShebang(c) ? 'shebang' : 'comment', [])];
      case 'variable_name': case 'special_variable_name': return [shellNode(c, layer, 'name', [])];
      case 'command_list': return [construct(c, layer, 'list')];
      // (Nested from the left: `a && b || c` is an OR list whose first part is the AND list `a && b`.)
      case 'list': return [construct(c, layer, c.children.some((x) => x.type === '||') ? 'orList' : 'andList')];
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
    if (WORDS.has(c.type)) return [word(c, layer, 'word')];
    return [construct(c, layer, constructKind(c.type))];
  };

  /** What the operator of a conditional expression tests (`-f`: is an existing regular file; `==` in `[[ ]]`: a glob match). */
  const testOperator = (c: SyntaxNode): string | undefined => {
    const inDouble = c.parent!.type === 'binary_expression' && ['=', '==', '!='].includes(c.type);
    const op = c.type === 'test_operator' ? c.text : c.type;
    const text = c.parent!.type === 'unary_expression' && op !== '!' ? unaryTestOps[op] : inDouble ? extendedEqualOps[op] : binaryTestOps[op];
    return text?.[cx.lang];
  };

  /** A compound command, a list, a pipeline, a function: its parts in order, keywords and operators included. */
  const construct = (c: SyntaxNode, layer: Layer, kind: ShellKind): ReadingNode => {
    const children = withLists(c).flatMap((x) => {
      if (x.field === 'name' && kind === 'function') return [shellNode(x, layer, 'name', [])];
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
    if (t && kind !== 'list' && kind !== 'andList' && kind !== 'orList' && kind !== 'pipeline') n.label = t.label;
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
    n.children.push(...redirects);
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
    let reader = reads?.name;
    let named = false;
    let dynamic = false;
    const children = c.namedChildren.flatMap((x): ReadingNode[] => {
      if (x.type === 'command_name') {
        named = true;
        const { node: n, runs } = commandName(x.namedChildren[0], layer, reads?.token);
        dynamic = n.kind === 'expandedName';
        // (After an alias, the command that reads the words is the one its text runs: `ll x` is `ls -l x`.)
        if (runs) reader = runs;
        return [n];
      }
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
      const at = words.find((w) => within(p.span, w.span));
      const head = !at && p.layer === 'command' && RUNS.has(p.kind) ? words.find((w) => le(w.span.start, p.span.start) && le(p.span.start, w.span.start)) : undefined;
      if (at) at.children.push(p);
      else if (head) {
        // (A builtin that `builtin` or `command` finds runs in this shell, as bash runs a command name: no other
        // command reads it, `builtin cd`. What it reads of the words after it is still its own.)
        const { reader: _, ...own } = p;
        head.children.push(p.kind === 'builtin' && p.name && p.name.by === undefined
          ? { ...own, layer, kind: 'commandName', resolves: 'builtin', span: head.span, children: [] }
          : { ...p, span: head.span, children: [] });
        p.children.forEach(place);
      } else {
        let i = children.length;
        while (i > 0 && !le(children[i - 1].span.end, p.span.end)) i--;
        children.splice(i, 0, p);
      }
    };
    (reads && !dynamic ? readParts(reads.token.children, true, reader!) : []).forEach(place);
    const n = shellNode(c, layer, 'command', children, new Set(['redirect']));
    // (`>f` alone: the redirection's text is its own, not the command's too.)
    if (children.some((x) => same(x.span, n.span) && x.text === n.text)) delete n.text;
    // (Its text runs to the end of a here-document, past what follows it on the line: `cat <<E; echo b`.)
    const ends = c.namedChildren.map((x) => ((x.type === 'heredoc_redirect' && x.namedChildren.find((h) => h.type === 'heredoc_start')) || x).endIndex);
    n.label = short(c.text.slice(0, Math.max(...ends) - c.startIndex));
    n.refs = union(['3.2.2', '3.7.1'], n.refs);
    return n;
  };

  /** The token of the command `c` (the outermost about it: not one of a command in a substitution inside it), and its name. */
  const readingOf = (c: SyntaxNode): { token: Token; name: string } | undefined => {
    const name = field(c, 'name');
    if (!name) return undefined;
    const subs = c.namedChildren.flatMap(function inner(x: SyntaxNode): Span[] {
      return SUBSTITUTIONS.has(x.type) ? [spanOf(x)] : x.namedChildren.flatMap(inner);
    });
    const span = spanOf(c);
    const t = all.find((x) => x.origin === 'shell' && READERS.has(x.kind) && within(x.span, span) && !subs.some((s) => within(x.span, s)));
    // (The name it spells: `"ls"` and `\if` are `ls` and `if`.)
    return t && { token: t, name: short(staticWordValue(name.namedChildren[0]) ?? name.text) };
  };

  /**
   * The first word of a simple command: the command name as written, which bash looks up (3.7.2), with what the
   * explanation says of the command; or, when it has an expansion, a word whose first field is the name when it runs.
   */
  const commandName = (w: SyntaxNode, layer: Layer, t: Token | undefined): { node: ReadingNode; runs?: string } => {
    const name = staticWordValue(w);
    const span = spanOf(w);
    // (`[`: the token of its name, inside that of the test.)
    const own = all.find((x) => x.origin === 'shell' && READERS.has(x.kind) && same(x.span, span)) ?? t;
    const process = layer === 'child' ? { process: 'subshell' as const } : {};
    if (name === undefined) {
      const n = word(w, layer, 'expandedName');
      n.refs = union(['3.7.1'], n.refs);
      // (What the command's token says, `"$@"`: the word runs what it expands to.)
      if (own) n.text = own.explanation;
      return { node: n };
    }
    const res = cx.resolve(name, w);
    if (res.kind === 'alias') return aliasWord(w, res, own, process);
    return {
      node: {
        layer, kind: 'commandName', label: short(w.text), span, ...(own ? { text: own.explanation } : {}),
        refs: union(['3.7.1', '3.7.2'], own?.refs, expansionSections(cx.meaning(w))), resolves: res.kind, ...(own?.name ? { name: own.name } : {}), ...process, children: wordParts(w, layer),
      },
    };
  };

  /**
   * An alias as the first word (6.6): bash replaces it with its text when it reads the line, before it expands the
   * words (3.7.1), so the name it looks up is the first word of that text, and the rest are arguments before those
   * written after the alias. Under it, that text as bash reads it, when it is plain words; `runs`: the command that
   * reads the words after it.
   */
  const aliasWord = (w: SyntaxNode, res: Extract<NameResolution, { kind: 'alias' }>, own: Token | undefined, process: { process?: 'subshell' }): { node: ReadingNode; runs: string } => {
    const span = spanOf(w);
    const layer: Layer = process.process ? 'child' : 'bash';
    const value = res.alias.value;
    let runs: NameResolution | undefined = res;
    while (runs?.kind === 'alias') runs = runs.target;
    const words = plainWords(value);
    // (The analyzer explains an alias over the command of its name, `alias grep='grep --color=auto'`, as that command.)
    const aliasText = own?.refs?.includes('6.6');
    const children: ReadingNode[] = (words ?? []).map((x, i) => ({
      layer, kind: i ? 'argument' : 'commandName', label: x, span, ...process,
      // (A first word of plain text is one the resolution follows: `target`.)
      ...(i ? { refs: ['3.7.1'] } : { refs: ['3.7.1', '3.7.2'], resolves: res.target!.kind, ...(aliasText ? {} : { text: own!.explanation }) }),
      children: [],
    }));
    return {
      node: {
        layer, kind: 'aliasWord', label: short(w.text), span, text: aliasText ? own!.explanation : TEXTS.alias[cx.lang](w.text, value),
        // (The token of an alias always has its name's facts: the analyzer resolves it.)
        refs: ['6.6'], replacement: value, name: own!.name!, ...process, children,
      },
      runs: runs?.name ?? short(value),
    };
  };

  const word = (w: SyntaxNode, layer: Layer, kind: ShellKind): ReadingNode => {
    // (A word that is one part, a quote or an expansion, has that part under it, with its explanation.)
    const one = PARTS.has(w.type);
    const n = shellNode(w, layer, kind, wordParts(w, layer), one ? new Set() : WORD_TOKENS);
    // (What bash does to it that no part shows: brace and tilde expansion, splitting, globbing, a pattern's matching.)
    n.refs = union(kind === 'argument' ? ['3.7.1'] : [], n.refs, expansionSections(cx.meaning(w)));
    // A language in a word no command reads, which bash reads itself (the regex of `=~`), is under the word.
    if (w.parent!.type !== 'command' && w.parent!.type !== 'command_name') {
      for (const c of tokenAt(n.span, WORD_TOKENS)?.children ?? []) if (c.origin === 'embedded') language(n.children, c, 'bash');
    }
    return n;
  };

  /** The parts bash reads in a word: the word itself when it is one part; else its parts, and bash's tokens in its text. */
  const wordParts = (w: SyntaxNode, layer: Layer): ReadingNode[] => {
    if (PARTS.has(w.type)) return [part(w, layer)];
    if (w.type === 'array') return w.namedChildren.flatMap((e) => node(e, layer));
    return withTokens(w, inner(w, layer), layer);
  };

  /** The parts under `n`, outermost first. */
  const inner = (n: SyntaxNode, layer: Layer): ReadingNode[] =>
    n.namedChildren.flatMap((c) => (PARTS.has(c.type) ? [part(c, layer)] : inner(c, layer)));

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
        if (within(span, t.span)) look(t.children);
        else if (!within(t.span, span) || parts.some((p) => within(t.span, p.span))) continue;
        else if (t.origin === 'shell' && PART_TOKENS.has(t.kind)) found.push(partToken(t, layer));
        else look(t.children);
      }
    };
    look(items);
    return [...parts, ...found].sort((a, b) => a.span.start.line - b.span.start.line || a.span.start.character - b.span.start.character);
  };

  /** A token of bash's reading in a word, with the tokens of bash's under it. */
  const partToken = (t: Token, layer: Layer): ReadingNode => ({
    // (They cite no sections of their own: the word, or the quote around them, does.)
    layer, kind: t.kind, label: t.label, span: t.span, text: t.explanation, ...(layer === 'child' ? { process: 'subshell' as const } : {}),
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
    // arithmetic of a substring (`${x:i+1:2}`). An element of an array, `${a[i]}`, is its name, as in an assignment.)
    const parts = kind === 'arithmetic' || p.type === 'expansion'
      ? p.children.filter((x) => !DELIMITERS.has(x.type)).flatMap((x) => (x.type === 'subscript' ? [shellNode(x, layer, 'name', [])] : node(x, layer)))
      // (The braces, `..` and `,` of `{1..10..3}` and `{a,b}`, and the strings of a list; the numbers of a sequence have
      // tokens, as the escapes of `$'…'` do.)
      : kind === 'brace' ? p.children.filter((x) => x.type !== 'number').flatMap((x) => node(x, layer))
      : inner(p, layer);
    // (Not the command's token, when the part is its name: `"$@"`.)
    return shellNode(p, layer, kind, QUOTES.has(p.type) || kind === 'brace' ? withTokens(p, parts, layer) : parts, notReader);
  };

  const assignment = (a: SyntaxNode, layer: Layer, kind: 'assignment' | 'assignmentArgument'): ReadingNode => {
    const value = field(a, 'value');
    // (The elements of an array are words, each expanded: `a=(x "$y" *.txt)`.)
    const parts = !value ? [] : value.type === 'array' ? wordParts(value, layer) : PARTS.has(value.type) ? [part(value, layer)] : withTokens(value, inner(value, layer), layer);
    // (Its operator, `=` or `+=`, between the name and the value: 3.4.)
    const op = a.children.find((c) => !c.named && c.type.endsWith('='))!;
    const n = shellNode(a, layer, kind, [shellNode(field(a, 'name')!, layer, 'name', []), shellNode(op, layer, 'operator', []), ...parts], new Set(['assignment']));
    // (An assignment of a simple command, before its name or with none: 3.7.1 says when it is made. One that is an
    // argument of a declaration builtin, 3.4 says, is expanded as an assignment.)
    if (kind === 'assignment' && a.parent!.type === 'command') n.refs = union(n.refs, ['3.7.1']);
    // (What bash does to its value that no part shows: a tilde after `=` or `:`, `x=~/a:~/b`.)
    if (value && value.type !== 'array') n.refs = union(n.refs, expansionSections(cx.meaning(value)));
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
   */
  const readParts = (tokens: readonly Token[], top: boolean, reader: string): ReadingNode[] => {
    const out: ReadingNode[] = [];
    for (const t of tokens) {
      if (t.origin === 'argv') out.push(tokenNode(t, 'command', reader));
      else if (t.origin === 'embedded') language(out, t, reader);
      else if (t.origin === 'script') out.push(scriptNode(t, t.process ?? 'shell'));
      // (At the top, bash's tokens are the command's name, assignments and redirections, and the words it takes as
      // they are, with what is under them: the script of `eval "ls"`.)
      // A quoted word whose text a shell reads again (`eval "ls; echo hi"`) is an operand the command reads as a
      // script, as an unquoted one is (`eval ls`).
      else if (top && t.kind === 'string' && t.children.some((c) => c.origin === 'script')) {
        out.push({ layer: 'command', kind: 'argument', label: t.label, span: t.span, text: TEXTS.again[cx.lang], reader, children: readParts(t.children, false, reader) });
      } else if (t.kind !== 'substitution' && (!top || WORD_TOKENS.has(t.kind))) out.push(...readParts(t.children, false, reader));
    }
    return out;
  };

  /** A token the command reads, and the tokens under it by their own origins. (A command it runs reads what follows.) */
  const tokenNode = (t: Token, layer: Layer, reader: string): ReadingNode => ({
    layer, kind: t.kind, label: t.label, span: t.span, reader, ...(t.refs ? { refs: t.refs } : {}), ...(t.name ? { name: t.name } : {}), ...(t.valueFor ? { valueFor: t.valueFor } : {}),
    // (A word the command reads as a script, which the analyzer says only is a word: `eval ls`.)
    text: t.explanation === TEXTS.word[cx.lang](t.label) && t.children.some((c) => c.origin === 'script') ? TEXTS.again[cx.lang] : t.explanation,
    children: readParts(t.children, false, RUNS.has(t.kind) ? t.label : reader),
  });

  /** A token of a string a shell reads as a script; `process`: which shell. */
  const scriptNode = (t: Token, process: ScriptProcess): ReadingNode => ({
    layer: 'child', ...scriptKind(t), label: t.label, span: t.span, text: t.explanation, ...(t.refs ? { refs: t.refs } : {}), ...(t.name ? { name: t.name } : {}), process,
    // (What is not the script's is what a command of it reads: `t` is that command.)
    children: t.children.flatMap((c) => (c.origin === 'script' ? [scriptNode(c, process)] : readParts([c], false, t.label))),
  });

  /**
   * What a token of a script is, as the nodes of bash's reading say it: a command's token is its name (an alias, a
   * builtin, a function; a name known only when it runs), and the others have their token's kind.
   */
  const scriptKind = (t: Token): { kind: string; resolves?: NameResolution['kind'] } => {
    // (A list, an AND or OR list, a pipeline: as bash's own nodes are named, not as their tokens' kind, `operator`.)
    if (t.grammar) return { kind: t.grammar };
    if (t.kind === 'builtin') return { kind: 'commandName', resolves: 'builtin' };
    if (t.kind === 'alias') return { kind: 'aliasWord' };
    if (t.kind === 'function') return { kind: 'commandName', resolves: 'function' };
    // (A name that is an expansion cites 3.7.1 alone.)
    if (t.kind === 'command') return { kind: String(t.refs) === '3.7.1' ? 'expandedName' : 'commandName' };
    return { kind: t.kind };
  };

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
    layer: 'language', kind: t.kind, label: t.label, span: t.span, text: t.explanation, reader, children: t.children.map((c) => langNode(c, reader)),
  });

  return { layer: 'bash', kind: 'line', label: '', span: range, children: collect(tree.root, 'bash') };
}

/** Every node of a reading tree, depth first. */
export function readingNodes(n: ReadingNode): ReadingNode[] {
  return [n, ...n.children.flatMap(readingNodes)];
}
