import { BUILTIN_SECTIONS } from './manual';
import { field, isShebang, type SyntaxNode } from './syntax/tree';

// The sections of the Bash manual (src/manual.ts) a token is about, from its node: a construct, an operator, a
// quote, an expansion or a redirection. The command tokens take theirs from the name resolution (the analyzer's
// `commandHeadFor`), and the facts from the message catalog (src/messages.ts).

/** Constructs, and the keywords and operators inside them. */
export const CONSTRUCTS: Readonly<Record<string, readonly string[]>> = {
  if_statement: ['3.2.5.2'], elif_clause: ['3.2.5.2'], else_clause: ['3.2.5.2'],
  case_statement: ['3.2.5.2'], case_item: ['3.2.5.2'], select_statement: ['3.2.5.2'],
  for_statement: ['3.2.5.1'], c_style_for_statement: ['3.2.5.1'], while_statement: ['3.2.5.1'],
  compound_statement: ['3.2.5.3'], subshell: ['3.2.5.3'],
  function_definition: ['3.3'],
  coproc_statement: ['3.2.6'],
  time_statement: ['3.2.3'], pipeline: ['3.2.3'], negated_command: ['3.2.3'],
  list: ['3.2.4'], command_list: ['3.2.4'],
  extended_test: ['3.2.5.2', '6.4'], arithmetic_command: ['3.2.5.2', '6.5'],
};

/** Other nodes, by type. */
export const NODES: Readonly<Record<string, readonly string[]>> = {
  ...CONSTRUCTS,
  variable_assignment: ['3.4'],
  heredoc_redirect: ['3.6.6'], herestring_redirect: ['3.6.7'],
  // (The descriptor before a redirection operator, `2>` or `{fd}>`, and a here-document's delimiter and body.)
  file_descriptor: ['3.6'], heredoc_start: ['3.6.6'], heredoc_body: ['3.6.6'],
  expansion: ['3.5.3'], brace_expression: ['3.5.1'],
  command_substitution: ['3.5.4'], arithmetic_expansion: ['3.5.5'], process_substitution: ['3.5.6'],
  string: ['3.1.2.3'], raw_string: ['3.1.2.2'], ansi_c_string: ['3.1.2.4'], translated_string: ['3.1.2.5'],
  array: ['6.7'], subscript: ['6.7'],
  regex: ['3.2.5.2'], extglob_pattern: ['3.5.8.1'],
};

/** Operators, by their own type: their meaning does not depend on where they are. */
export const OPERATORS: Readonly<Record<string, readonly string[]>> = {
  '|': ['3.2.3'], '|&': ['3.2.3'],
  '&&': ['3.2.4'], '||': ['3.2.4'], '&': ['3.2.4'], ';': ['3.2.4'],
  ';;': ['3.2.5.2'], ';&': ['3.2.5.2'], ';;&': ['3.2.5.2'],
  function: ['3.3'], coproc: ['3.2.6'],
};

/** A redirection's subsection, from its operator and target (`2>&1` duplicates, `2>&-` closes, `>&file` is 3.6.4). */
function redirectSections(n: SyntaxNode): readonly string[] {
  const op = n.children.find((c) => !c.named)!.type;
  const dest = field(n, 'destination')?.text ?? '';
  if ((op === '>&' || op === '<&') && /^(\d+-?|-|\$\w+|\$\{\w+\})$/.test(dest)) return [/^\d+-$/.test(dest) ? '3.6.9' : '3.6.8'];
  // (`<&word` only duplicates or closes: a word that is not a descriptor is an error, 3.6.8.)
  if (op === '<&') return ['3.6.8'];
  // (Every other operator the parser gives a file redirection: unbash's `RedirectOperator`, and `&>>` of `&>> >(tee)`.)
  const sub: Record<string, string> = { '<': '3.6.1', '>': '3.6.2', '>|': '3.6.2', '>>': '3.6.3', '&>': '3.6.4', '>&': '3.6.4', '&>>': '3.6.5', '<>': '3.6.10' };
  return [sub[op]];
}

/**
 * `$1` and `$10` (3.4.1), `$?`, `$@`, `$$` and the other special parameters (3.4.2), `$_` (bash 5.2's manual lists
 * it with the Bash variables, 5.2), or a variable (3.5.3; `$_x` too).
 */
function parameterSections(text: string): readonly string[] {
  const name = text.slice(1);
  if (/^\d/.test(name)) return ['3.4.1'];
  if (name === '_') return ['5.2'];
  if (/^[-*@#?$!]/.test(name)) return ['3.4.2'];
  return ['3.5.3'];
}

/** The nodes of an expression, of `[[ ]]` (6.4) or of arithmetic (6.5). */
const EXPRESSIONS = new Set(['binary_expression', 'unary_expression', 'parenthesized_expression', 'ternary_expression', 'postfix_expression']);

/**
 * Where an expression is read, and the sections of it: `[[ ]]` reads a conditional expression (6.4); `(( ))`, the
 * head of `for (( ))`, `$(( ))`, the offset and length of `${x:i:n}` and an array's index, an arithmetic one (6.5).
 */
const EXPRESSION_HOSTS: Readonly<Record<string, readonly string[]>> = {
  extended_test: CONSTRUCTS.extended_test, arithmetic_command: CONSTRUCTS.arithmetic_command,
  c_style_for_statement: ['3.2.5.1', '6.5'], arithmetic_expansion: ['3.5.5', '6.5'], expansion: ['3.5.3', '6.5'], subscript: ['6.7', '6.5'],
};
/** The tokens of the head of `for (( ))` that are arithmetic's: around its expressions, and the `,` between two. */
const ARITH_HEAD = new Set(['((', '))', ',']);

/** Whether `n` is a part of an expression: an expression, or an assignment in the head of `for (( ))` (`i = 0`). */
export function isExpression(n: SyntaxNode): boolean {
  return EXPRESSIONS.has(n.type) || (n.type === 'variable_assignment' && n.parent!.type === 'c_style_for_statement');
}

/** Where the expression `n` is in is read: the type of its host (`EXPRESSION_HOSTS`), `extended_test` for `[[ ]]`. */
export function expressionHost(n: SyntaxNode): string {
  // (The parser makes expressions only in these.)
  let p = n.parent!;
  while (!EXPRESSION_HOSTS[p.type]) p = p.parent!;
  return p.type;
}

/** The sections of the expression `n` is in: those of where it is read. */
export function expressionSections(n: SyntaxNode): readonly string[] {
  return EXPRESSION_HOSTS[expressionHost(n)];
}

/** A word with a backslash that is not in quotes: an escape character, or a line continuation (3.1.2.1). */
function escaped(n: SyntaxNode): boolean {
  if (n.type === 'concatenation') return n.namedChildren.some(escaped);
  return n.type === 'word' && n.text.includes('\\');
}

/** The sections a node's token is about, or undefined (a plain word, a program's option…). */
export function nodeSections(n: SyntaxNode): readonly string[] | undefined {
  if (n.type === 'file_redirect') return redirectSections(n);
  if (isExpression(n) || n.type === 'test_operator') return expressionSections(n);
  // (The body of a loop: `do … done`.)
  if (n.type === 'do_group') return CONSTRUCTS[n.parent!.type];
  if (escaped(n)) return ['3.1.2.1'];
  // (The pattern of `${x#pat}` or `${x/pat/s}` is a word of the parameter expansion; the word-meaning model adds what
  // reads it as a pattern, 3.5.8.1.)
  if (n.type === 'regex' && n.parent!.type === 'expansion') return NODES.expansion;
  if (n.type === 'simple_expansion') return parameterSections(n.text);
  // (`${10}`, `${#}`: a positional or special parameter in braces, which the manual says to write so, 3.4.1.)
  const braced = n.type === 'expansion' && /^\$\{(\d+|[-*@#?$!_])\}$/.exec(n.text);
  if (braced) return [...parameterSections(`$${braced[1]}`), '3.5.3'];
  // (A command with no name: its tokens have the sections of its assignments; around them, redirections have none.)
  if (n.type === 'command' && !field(n, 'name')) return undefined;
  // (The shebang: what the kernel does with it, and to bash a comment.)
  if (n.type === 'comment') return isShebang(n) ? ['3.8', '3.1.3', 'execve(2)'] : ['3.1.3'];
  return NODES[n.type];
}

const REDIRECTS = new Set(['file_redirect', 'heredoc_redirect', 'herestring_redirect']);
const HEADS = new Set(['for_statement', 'select_statement', 'c_style_for_statement']);

/** The sections of a keyword or an operator: its own, or the construct's it belongs to (`then`, `do`, `}`). */
export function anonSections(n: SyntaxNode): readonly string[] | undefined {
  const parent = n.parent!;
  // An operator of an expression is the expression's, not a list's or a pipeline's (`[[ a && b ]]`, `$((1 + 2))`).
  if (isExpression(parent) || parent.type === 'arithmetic_expansion' || (parent.type === 'c_style_for_statement' && ARITH_HEAD.has(n.type))) return expressionSections(n);
  // (`=` and `+=` of an assignment, 3.4; the operators of a parameter expansion, `:-` or `#`, 3.5.3; the braces and
  // `..` of a brace expansion, 3.5.1; the operator of a redirection, as the redirection, 3.6.)
  if (parent.type === 'variable_assignment' || parent.type === 'expansion' || parent.type === 'brace_expression' || REDIRECTS.has(parent.type)) return nodeSections(parent);
  // (The `|` between the patterns of a `case` clause: not a pipe.)
  if (n.type === '|' && parent.type === 'case_item') return CONSTRUCTS.case_item;
  let construct: string | undefined;
  for (let p = n.parent; p && !construct; p = p.parent) if (CONSTRUCTS[p.type]) construct = p.type;
  // (A `;` in the head of a `for` is the loop's, not a list's: `for x in a; do`, `for ((i = 0; i < 3; i++))`.)
  if (n.type === ';' && construct && HEADS.has(n.parent!.type)) return CONSTRUCTS[construct];
  return OPERATORS[n.type] ?? (construct ? CONSTRUCTS[construct] : undefined);
}

/** A builtin's section, and 4.4 for a special builtin. */
export function builtinSections(name: string, special: boolean): readonly string[] {
  const own = BUILTIN_SECTIONS[name];
  return [...(own ? [own] : []), ...(special ? ['4.4'] : [])];
}
