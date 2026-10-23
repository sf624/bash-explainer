import { BUILTIN_SECTIONS } from './manual';
import { field, type SyntaxNode } from './syntax/tree';

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
  list: ['3.2.4'],
  extended_test: ['3.2.5.2', '6.4'], arithmetic_command: ['3.2.5.2', '6.5'],
};

/** Other nodes, by type. */
export const NODES: Readonly<Record<string, readonly string[]>> = {
  ...CONSTRUCTS,
  variable_assignment: ['3.4'],
  heredoc_redirect: ['3.6.6'], herestring_redirect: ['3.6.7'],
  expansion: ['3.5.3'],
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
  const sub: Record<string, string> = { '<': '3.6.1', '>': '3.6.2', '>|': '3.6.2', '>>': '3.6.3', '&>': '3.6.4', '>&': '3.6.4', '&>>': '3.6.5', '<>': '3.6.10' };
  return [sub[op] ?? '3.6'];
}

/** `$1` and `$10` (3.4.1), `$?`, `$@`, `$$` and the other special parameters (3.4.2), or a variable (3.5.3). */
function parameterSections(text: string): readonly string[] {
  const name = text.slice(1);
  if (/^\d/.test(name)) return ['3.4.1'];
  if (/^[-*@#?$!_]/.test(name)) return ['3.4.2'];
  return ['3.5.3'];
}

/** The sections a node's token is about, or undefined (a plain word, a program's option…). */
export function nodeSections(n: SyntaxNode): readonly string[] | undefined {
  if (n.type === 'file_redirect') return redirectSections(n);
  if (n.type === 'simple_expansion') return parameterSections(n.text);
  // (A command with no name: assignments only.)
  if (n.type === 'command' && !field(n, 'name')) return NODES.variable_assignment;
  if (n.type === 'comment') return n.startPosition.row === 0 && n.text.startsWith('#!') ? ['3.8'] : undefined;
  return NODES[n.type];
}

/** The sections of a keyword or an operator: its own, or the construct's it belongs to (`then`, `do`, `}`). */
export function anonSections(n: SyntaxNode): readonly string[] | undefined {
  let construct: string | undefined;
  for (let p = n.parent; p && !construct; p = p.parent) if (CONSTRUCTS[p.type]) construct = p.type;
  // (The operators inside `[[ ]]` and `(( ))` are parts of their expressions, not tokens of their own.)
  return OPERATORS[n.type] ?? (construct ? CONSTRUCTS[construct] : undefined);
}

/** A builtin's section, and 4.4 for a special builtin. */
export function builtinSections(name: string, special: boolean): readonly string[] {
  const own = BUILTIN_SECTIONS[name];
  return [...(own ? [own] : []), ...(special ? ['4.4'] : [])];
}
