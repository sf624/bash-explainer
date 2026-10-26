// The syntax tree the rest of the extension reads: our own model of a bash script, the same whichever
// parser library built it. Only the adapters in src/syntax/adapters/ may import a parser library; see
// docs/design/syntax-tree.md for the model and its rules.

/** A place in the text: zero-based line, and column in UTF-16 code units (as in VS Code and the browser). */
export interface Point {
  readonly row: number;
  readonly column: number;
}

/**
 * The kinds of named node. They follow bash's grammar, not a parser library's: an adapter that gets
 * something else from its library turns it into one of these.
 */
export type NodeType =
  // The script, and what can stand for a statement
  | 'program'
  | 'comment'
  | 'command'
  | 'command_name'
  | 'variable_assignment' // before a command's name, in a command with no name (`a=1`), or (field `argument`) an argument of a declaration builtin: `declare a=1`
  | 'negated_command' // ! pipeline
  | 'redirected_statement' // a compound statement with redirections (or `time >o`); a simple command's redirections are its children
  | 'pipeline'
  | 'list' // an AND or OR list (3.2.4): && and ||, nested from the left (`a && b || c` is a list in a list)
  // A list of commands (3.2.4): pipelines and AND/OR lists joined by `;` and `&`. Never in the tree, whose bodies hold
  // their statements and those tokens as children; `commandLists` makes one over them (see there).
  | 'command_list'
  | 'time_statement' // time [-p] pipeline
  | 'coproc_statement'
  // Compound statements
  | 'compound_statement' // { …; }
  | 'subshell' // ( … )
  | 'do_group'
  | 'if_statement'
  | 'elif_clause'
  | 'else_clause'
  | 'case_statement'
  | 'case_item'
  | 'for_statement'
  | 'select_statement'
  | 'c_style_for_statement'
  | 'while_statement' // also until, told apart by its first token
  | 'function_definition'
  | 'arithmetic_command' // (( … ))
  | 'extended_test' // [[ … ]]
  // Words and their parts
  | 'word'
  | 'concatenation'
  | 'string' // "…"
  | 'string_content'
  | 'raw_string' // '…'
  | 'ansi_c_string' // $'…'
  | 'translated_string' // $"…"
  | 'number'
  | 'extglob_pattern'
  | 'regex' // the right side of =~
  | 'brace_expression' // {1..3}
  | 'array' // ( … ) on the right of an assignment
  // Expansions
  | 'simple_expansion' // $v
  | 'expansion' // ${…}
  | 'variable_name'
  | 'special_variable_name'
  | 'subscript'
  | 'command_substitution'
  | 'process_substitution'
  | 'arithmetic_expansion'
  // Expressions, in tests and arithmetic
  | 'binary_expression'
  | 'unary_expression'
  | 'parenthesized_expression'
  | 'ternary_expression'
  | 'postfix_expression'
  | 'test_operator'
  // Redirections
  | 'file_redirect'
  | 'file_descriptor'
  | 'heredoc_redirect'
  | 'heredoc_start'
  | 'heredoc_body'
  | 'heredoc_content'
  | 'heredoc_end'
  | 'herestring_redirect'
  // Text the parser could not read; see `SyntaxTree.errors`
  | 'error';

/** The names under which a node can be one of its parent's parts. */
export type FieldName =
  | 'name' | 'value' | 'argument' | 'operator' | 'left' | 'right' | 'body' | 'condition'
  | 'descriptor' | 'destination' | 'index' | 'variable' | 'redirect' | 'option'
  | 'initializer' | 'update' | 'alternative' | 'consequence' | 'operand'
  | 'fallthrough' | 'termination'; // the `;&` / `;;&` and `;;` that end a case item

/**
 * A node of the tree, or a token: a keyword or operator (`if`, `then`, `&&`, `[[`, `=~`, `>>`…), which
 * has `named: false` and its own text as `type`. Tokens are children like the rest, in source order,
 * so that each part of a line has a place to highlight.
 */
export interface SyntaxNode {
  readonly type: NodeType | string;
  readonly named: boolean;
  /** The source text of the node, always taken from the original text (never from a masked one). */
  readonly text: string;
  /** Offsets in the text, in UTF-16 code units; `end` is exclusive. */
  readonly startIndex: number;
  readonly endIndex: number;
  readonly startPosition: Point;
  readonly endPosition: Point;
  readonly parent: SyntaxNode | null;
  /** All children, named and tokens, in source order. */
  readonly children: readonly SyntaxNode[];
  readonly namedChildren: readonly SyntaxNode[];
  /** The name this node has in its parent, if any. */
  readonly field: FieldName | null;
  /** The construct is not closed (`if x; then` with no `fi`, `"abc` with no end): the user is typing. */
  readonly incomplete: boolean;
}

export interface SyntaxError {
  /** `missing`: a token the grammar expects is not there (see `incomplete`); `unreadable`: text the parser could not read (see the `error` node). */
  readonly kind: 'missing' | 'unreadable';
  readonly message: string;
  readonly startIndex: number;
  readonly endIndex: number;
}

export interface SyntaxTree {
  readonly text: string;
  readonly root: SyntaxNode;
  /** What the parser could not read. Each one also has an `error` node, or an `incomplete` node, in the tree. */
  readonly errors: readonly SyntaxError[];
  /**
   * Where the text had a CR before a LF (Windows line ends), as indexes into the text the tree was built from.
   * An adapter that reads such text masks each of these CRs as a space of the same length, so `text` has a space there
   * and every position stays. Undefined when there were none (or the adapter does not mask).
   */
  readonly carriageReturns?: readonly number[];
}

/** What every adapter provides. Parsing is synchronous. */
export interface BashParser {
  parse(text: string): SyntaxTree;
}

// Helpers, the only ways the rest of the code walks a tree besides the properties above.

/** The child under `name`, or undefined. */
export function field(n: SyntaxNode, name: FieldName): SyntaxNode | undefined {
  return n.children.find((c) => c.field === name);
}

/** All children under `name`, in order. */
export function fields(n: SyntaxNode, name: FieldName): SyntaxNode[] {
  return n.children.filter((c) => c.field === name);
}

/**
 * The assignments of a simple command made before its name runs (`x=1 cmd`, or all of them with no name), not the
 * arguments of a declaration builtin that are assignments (`declare a=1`, field `argument`).
 */
export function prefixAssignments(n: SyntaxNode): SyntaxNode[] {
  return n.namedChildren.filter((c) => c.type === 'variable_assignment' && c.field !== 'argument');
}

/**
 * The redirections of a command, in source order: of a simple command, all of them, wherever they are written
 * (`>o echo a 2>e`); of a `redirected_statement` (around a compound command, or `time >o`), those after its body.
 */
export function redirectionsOf(n: SyntaxNode): SyntaxNode[] {
  return fields(n, 'redirect');
}

/**
 * The text of a simple command up to its last word (its name or last argument), without the redirections after it:
 * `[ a = b ]` of `[ a = b ] >o`. (Those before or among the words stay: `>o [ a ]`, `[ -f x 2>/dev/null ]`.)
 */
export function wordsText(n: SyntaxNode): string {
  const words = n.children.filter((c) => c.field === 'name' || c.field === 'argument');
  return n.text.slice(0, words[words.length - 1].endIndex - n.startIndex);
}

/** A simple command with no name: assignments and redirections only (`a=1`, `a=1 >f b=2`, `>f`). */
export function assignmentsOnly(n: SyntaxNode): boolean {
  return n.type === 'command' && !field(n, 'name');
}

/**
 * The children of a command with no name from its first assignment to its last, with the redirections between them
 * (`a=1 >f b=2`), and the redirections outside them (`>f a=1 2>g`; all of them when there is no assignment, `>f`).
 */
export function assignmentSpan(n: SyntaxNode): { inner: SyntaxNode[]; outer: SyntaxNode[] } {
  const assigns = prefixAssignments(n);
  const from = assigns.length ? assigns[0].startIndex : Infinity;
  const to = assigns.length ? assigns[assigns.length - 1].endIndex : -Infinity;
  const inner = n.namedChildren.filter((c) => c.startIndex >= from && c.startIndex < to);
  return { inner, outer: n.namedChildren.filter((c) => !inner.includes(c)) };
}

/** The first token child with this text (`then`, `&&`…), or undefined. */
export function token(n: SyntaxNode, text: string): SyntaxNode | undefined {
  return n.children.find((c) => !c.named && c.type === text);
}

/**
 * Whether `n` is the shebang: a comment `#!…` at the very start of the text. The kernel reads it only when `#!` are
 * the file's first two bytes (execve(2)): not after a blank or a byte order mark, nor on a later line.
 */
export function isShebang(n: SyntaxNode): boolean {
  return n.type === 'comment' && n.startIndex === 0 && n.text.startsWith('#!');
}

/** The nearest ancestor (not `n` itself) that satisfies `test`. */
export function ancestor(n: SyntaxNode, test: (a: SyntaxNode) => boolean): SyntaxNode | undefined {
  for (let a = n.parent; a; a = a.parent) if (test(a)) return a;
  return undefined;
}

/**
 * The nodes of these types under `n` (`n` included), in source order; with `rows`, only the nodes that
 * overlap those lines (inclusive), skipping the subtrees outside them.
 */
export function descendants(n: SyntaxNode, types: readonly string[], rows?: { from: number; to: number }): SyntaxNode[] {
  const out: SyntaxNode[] = [];
  const visit = (m: SyntaxNode): void => {
    if (rows && (m.endPosition.row < rows.from || m.startPosition.row > rows.to)) return;
    if (types.includes(m.type)) out.push(m);
    for (const c of rows ? childrenOnRows(m.children, rows.from, rows.to) : m.children) visit(c);
  };
  visit(n);
  return out;
}

/** For a long list of children: the last row any of them up to each one reaches (`childrenOnRows`). */
const reaches = new WeakMap<readonly SyntaxNode[], number[]>();

/**
 * The children in `list` (a node's `children` or `namedChildren`) that may lie on rows `from` to `to`: from the first
 * that reaches `from` (it or one before it ends there or later) to the last that starts by `to`. Children are in the
 * order of their starts, so the statements of a long script are not each looked at for every line explained (the walks
 * of one line: `descendants` with rows, the style checks, the word facts, the dialect).
 */
export function childrenOnRows(list: readonly SyntaxNode[], from: number, to: number): readonly SyntaxNode[] {
  if (list.length < 16) return list;
  let reach = reaches.get(list);
  if (!reach) {
    let max = -1;
    reach = list.map((c) => (max = Math.max(max, c.endPosition.row)));
    reaches.set(list, reach);
  }
  let lo = 0;
  let hi = list.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (reach[mid] < from) lo = mid + 1;
    else hi = mid;
  }
  let end = lo;
  while (end < list.length && list[end].startPosition.row <= to) end++;
  return list.slice(lo, end);
}

/** Does the word expand the variable (`$NAME`, `${NAME}`, `${NAME:-…}`, also inside `"…"` or `$( )`), as the tree reads it? */
export function readsVariable(word: SyntaxNode, name: string): boolean {
  // (`${NAME[1]}` holds the name in its subscript.)
  const named = (c: SyntaxNode): SyntaxNode | undefined => (c.type === 'subscript' ? c.namedChildren[0] : c);
  return descendants(word, ['simple_expansion', 'expansion']).some((e) => e.namedChildren.some((c) => named(c)?.type === 'variable_name' && named(c)!.text === name));
}

/**
 * How a command substitution is written: `$(…)`, backquotes, or bash 5.3's `${ …; }` and `${| …; }`, which run
 * in the current shell (the second gives the value of `REPLY`).
 */
export function substitutionForm(n: SyntaxNode): '$(' | '`' | '${' | '${|' {
  return n.children[0].type as '$(' | '`' | '${' | '${|';
}

/**
 * How the shell reads the `}` that ends a `${ …; }` or `${| …; }` (`n`) when only blanks part it from the command
 * before it, since `}` is a reserved word only where a command can start (after `;`, `&`, a newline, or a compound
 * command): after a simple command, as one more word of it (`${ echo a }`); after the redirections of a compound
 * command or a bare `time`, as a token out of place (`${ { a; } >f }`). Undefined: it ends the substitution. unbash
 * ends it there.
 */
export function braceTakenAsWord(n: SyntaxNode): 'argument' | 'misplaced' | undefined {
  const close = n.children[n.children.length - 1];
  if (!substitutionForm(n).startsWith('${') || close.type !== '}') return undefined;
  let last: SyntaxNode | undefined = n.children[n.children.length - 2];
  if (!last.named || last.type === 'comment' || /[\n;&]/.test(n.text.slice(last.endIndex - n.startIndex, close.startIndex - n.startIndex))) return undefined;
  // (The last command of a list, a pipeline, `!`, `time` or `coproc` is the one before the `}`; a bare `time` has none.)
  while (last && ['list', 'pipeline', 'negated_command', 'time_statement', 'coproc_statement'].includes(last.type)) last = last.namedChildren[last.namedChildren.length - 1];
  return last?.type === 'command' ? 'argument' : !last || last.type === 'redirected_statement' ? 'misplaced' : undefined;
}

/**
 * `if [ -f a ] then …`, `while [ x ] do …`, `for x in a b do …` (`n`): with no `;` or newline before it, `then` / `do` is
 * an ordinary word of the condition (or of the list), so the construct lacks its keyword and bash stops with a syntax
 * error. Returns that keyword, or undefined when `n` is not such a construct.
 */
export function strayKeyword(n: SyntaxNode): 'then' | 'do' | undefined {
  if (!n.incomplete) return undefined;
  const kw = n.type === 'if_statement' || n.type === 'elif_clause' ? 'then' : n.type === 'while_statement' || n.type === 'for_statement' || n.type === 'select_statement' ? 'do' : undefined;
  if (!kw) return undefined;
  const head = strayHead(n);
  return head.some((h) => [h, ...descendants(h, ['word'])].some((w) => w.type === 'word' && w.text === kw)) ? kw : undefined;
}

function strayHead(n: SyntaxNode): readonly SyntaxNode[] {
  return n.type === 'for_statement' || n.type === 'select_statement' ? n.namedChildren : n.namedChildren.slice(0, 1);
}

/**
 * Whether `n` lies in the condition of a construct that lacks its `then` / `do` for this reason (`strayKeyword`). Bash
 * rejects the whole construct when it reads it, so nothing in that condition runs, and a note on what a command there
 * does "when it runs" would be false.
 */
export function inStrayHead(n: SyntaxNode): boolean {
  for (let c = n; c.parent; c = c.parent) {
    const p = c.parent;
    if (strayKeyword(p) && strayHead(p).some((h) => h.startIndex === c.startIndex && h.endIndex === c.endIndex && h.type === c.type)) return true;
  }
  return false;
}

// Lists of commands (3.2.4). The tree keeps the statements of a script or a body, and the `;` and `&` between and
// after them, as children of that node, as the semantic models read them. The manual reads them as lists: pipelines
// separated by `;`, `&` and newlines, where `&&` and `||` bind tighter (an AND/OR list, the model's `list`, is one
// part), and `&` applies to the part before it alone (bash's parser regroups `a; b &` so). `commandLists` gives those
// lists as nodes of their own, for the explanations: a node whose children are the parts (the statements, their `;`
// and `&`, and the comments between them), which keep their own parent. In a body (`{ }`, `( )`, `$( )`, the parts of
// `if`, `while`, `case`), a newline separates as `;` does, and the whole body is one list. At the top of a script, a
// newline ends the list: bash reads and runs the script one line at a time ("Bash always reads at least one complete
// line of input … before executing any of the commands on that line", 6.6), and a compound command over several
// lines is one part of the list of the line where it ends.

/** The nodes whose statements make lists: a script, and the bodies of the compound commands and substitutions. */
const LIST_HOLDERS = new Set<string>([
  'program', 'compound_statement', 'subshell', 'do_group', 'if_statement', 'elif_clause', 'else_clause', 'while_statement', 'case_item',
  'command_substitution', 'process_substitution',
]);
/** The nodes that can be a part of a list: a pipeline (a command, compound or not, is one of a single stage) or an AND/OR list. */
const LIST_PARTS = new Set<string>([
  'command', 'pipeline', 'list', 'negated_command', 'redirected_statement', 'time_statement', 'coproc_statement', 'compound_statement',
  'subshell', 'if_statement', 'case_statement', 'for_statement', 'select_statement', 'c_style_for_statement', 'while_statement',
  'function_definition', 'arithmetic_command', 'extended_test',
]);

/** Whether `n` is a part of a list of commands: a pipeline or an AND/OR list among the statements of a script or a body. */
export function isListPart(n: SyntaxNode): boolean {
  return n.named && LIST_PARTS.has(n.type) && !!n.parent && LIST_HOLDERS.has(n.parent.type);
}

/** Whether only blanks and line continuations lie between offsets `from` and `to` of the text of `holder` (no newline). */
function sameLine(holder: SyntaxNode, from: number, to: number): boolean {
  return !/\n/.test(holder.text.slice(from - holder.startIndex, to - holder.startIndex).replace(/\\\n/g, ''));
}

interface Run { parts: SyntaxNode[]; elements: SyntaxNode[] }

/** The runs of `holder`'s children that make one list each (one part alone, with no `&`, included). */
function runsOf(holder: SyntaxNode): Run[] {
  if (!LIST_HOLDERS.has(holder.type)) return [];
  const runs: Run[] = [];
  let run: Run | undefined;
  let pending: SyntaxNode[] = [];
  let after = false;
  for (const c of holder.children) {
    const last = run?.parts[run.parts.length - 1];
    if (c.named && LIST_PARTS.has(c.type)) {
      // A part goes on the list after a `;` or `&` or a newline in a body; at the top, not after a newline.
      // (Two parts with neither between them are on two lines.)
      const goesOn = run && (holder.type !== 'program' || (after && sameLine(holder, Math.min(last!.endIndex, c.startIndex), c.startIndex)));
      if (!goesOn) {
        run = { parts: [], elements: [] };
        runs.push(run);
      } else run!.parts.push(...pending);
      run!.parts.push(c);
      run!.elements.push(c);
      pending = [];
      after = false;
    } else if (!c.named && (c.type === ';' || c.type === '&') && run && !after && !pending.length) {
      run.parts.push(c);
      after = true;
    } else if (c.type === 'comment' && run && holder.type !== 'program') pending.push(c);
    else {
      run = undefined;
      pending = [];
      after = false;
    }
  }
  return runs;
}

/** The lists of a holder, made once: its lists of commands, and where each child is (its run, its place in it, its list). */
interface Lists { lists: SyntaxNode[]; at: Map<SyntaxNode, { run: Run; index: number; list?: SyntaxNode }>; grouped?: readonly SyntaxNode[] }
const listCache = new WeakMap<SyntaxNode, Lists>();

function listsOf(holder: SyntaxNode): Lists {
  let found = listCache.get(holder);
  if (found) return found;
  const made: Lists = { lists: [], at: new Map() };
  for (const run of runsOf(holder)) {
    const list = run.elements.length > 1 || run.parts.some((p) => p.type === '&') ? listNode(holder, run) : undefined;
    if (list) made.lists.push(list);
    run.parts.forEach((p, index) => made.at.set(p, { run, index, list }));
  }
  listCache.set(holder, made);
  return made;
}

/**
 * The lists of commands among the children of `holder` that are more than one part alone: two parts or more, or a
 * part with `&` (`a &`, which bash's parser makes a list too; `a;` is just `a`). Each is a `command_list` node over
 * its parts, made once (the same object every time), whose parent is `holder`; its children keep `holder` as theirs.
 */
export function commandLists(holder: SyntaxNode): SyntaxNode[] {
  return listsOf(holder).lists;
}

function listNode(holder: SyntaxNode, r: Run): SyntaxNode {
  const first = r.parts[0];
  const last = r.parts.reduce((a, p) => (p.endIndex > a.endIndex ? p : a));
  return {
    type: 'command_list', named: true, field: null, incomplete: false, parent: holder,
    text: holder.text.slice(first.startIndex - holder.startIndex, last.endIndex - holder.startIndex),
    startIndex: first.startIndex, endIndex: last.endIndex, startPosition: first.startPosition, endPosition: last.endPosition,
    children: r.parts, namedChildren: r.parts.filter((p) => p.named),
  };
}

/**
 * The children of `n`, with the parts of each of its lists of commands (`commandLists`) in one `command_list` node:
 * the same array every time (`childrenOnRows` keeps what it reads of an array).
 */
export function withLists(n: SyntaxNode): readonly SyntaxNode[] {
  const found = listsOf(n);
  if (found.grouped) return found.grouped;
  if (!found.lists.length) return (found.grouped = n.children);
  const out: SyntaxNode[] = [];
  for (const c of n.children) {
    const l = found.at.get(c)?.list;
    if (!l) out.push(c);
    else if (l.children[0] === c) out.push(l);
  }
  return (found.grouped = out);
}

/** The parts of a list of commands, without the operators and comments: its pipelines and AND/OR lists. */
export function listElements(l: SyntaxNode): SyntaxNode[] {
  return l.namedChildren.filter((c) => c.type !== 'comment');
}

/** Whether a newline separates two parts of the list `l` (in a body: `{ a⏎ b; }`), as `;` does. */
export function listOverLines(l: SyntaxNode): boolean {
  const parts = l.children.filter((c) => c.type !== 'comment');
  return parts.some((p, i) => i > 0 && !sameLine(l.parent!, Math.min(parts[i - 1].endIndex, p.startIndex), p.startIndex));
}

/**
 * What a `;` or `&` among the statements of a script or a body is to its list: the part it follows, and the part after
 * it in the same list (none: it ends the list). Undefined for a `;` that is not a list's (`for x in a; do`, `(( ; ; ))`).
 * (`op` is a token: the callers pass only `;` and `&`.)
 */
export function listOperator(op: SyntaxNode): { part: SyntaxNode; next?: SyntaxNode } | undefined {
  const at = listsOf(op.parent!).at.get(op);
  if (!at) return undefined;
  const part = at.run.parts[at.index - 1];
  const next = at.run.parts.slice(at.index + 1).find((p) => p.named && p.type !== 'comment');
  return next ? { part, next } : { part };
}

/** Whether the statement `n` is run in the background: a `&` follows it in its list. */
export function inBackground(n: SyntaxNode): boolean {
  const at = n.parent && isListPart(n) ? listsOf(n.parent).at.get(n) : undefined;
  return !!at && at.run.parts[at.index + 1]?.type === '&';
}

/** Whether `n` or anything under it is an `error` node or incomplete. */
export function hasError(n: SyntaxNode): boolean {
  return n.type === 'error' || n.incomplete || n.children.some(hasError);
}
