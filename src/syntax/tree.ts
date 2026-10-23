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
  | 'list' // && and ||
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
    for (const c of m.children) visit(c);
  };
  visit(n);
  return out;
}

/** Whether `n` or anything under it is an `error` node or incomplete. */
export function hasError(n: SyntaxNode): boolean {
  return n.type === 'error' || n.incomplete || n.children.some(hasError);
}
