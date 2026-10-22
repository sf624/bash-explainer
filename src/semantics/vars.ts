// What the walk of the shell state (src/semantics/state.ts) and the trust of its decisions (src/semantics/trust.ts)
// both read: declaration commands read with their builtin's spec, the variables bash changes itself, and the names
// an arithmetic text assigns.
import { interpret, type ArgRole, type ArgvParse } from '../argv/interpret';
import { argWord } from '../argv/words';
import { builtins } from '../dict/builtins';
import type { SyntaxNode } from '../syntax/tree';

/** The names an arithmetic text assigns (`x = 1`, `a[i] += 2`, `i++`, `--j`): group 1 (with 2, a subscript), 3 or 4. */
export const ARITH_ASSIGNED = /(?<![\w$])(?:([A-Za-z_]\w*)\s*(\[[^\]]*\])?\s*(?:[-+*/%&^|]|<<|>>)?=(?!=)|([A-Za-z_]\w*)\s*(?:\+\+|--)|(?:\+\+|--)\s*([A-Za-z_]\w*))/g;

/** The variables bash changes by itself as the script runs (their values are never known). */
export const DYNAMIC = /^(?:_|RANDOM|SRANDOM|SECONDS|LINENO|EPOCHSECONDS|EPOCHREALTIME|BASHPID|BASH_COMMAND|BASH_SUBSHELL|BASH_LINENO|BASH_SOURCE|BASH_ARGC|BASH_ARGV|BASH_ARGV0|FUNCNAME|HISTCMD|PIPESTATUS|GROUPS|DIRSTACK)$/;
/** Those of them that are numbers. */
export const NUMERIC_DYNAMIC = /^(?:RANDOM|SRANDOM|SECONDS|LINENO|EPOCHSECONDS|BASHPID|BASH_SUBSHELL|BASH_LINENO|BASH_ARGC|HISTCMD|PIPESTATUS|GROUPS)$/;

export interface Declaration {
  /** The role of each word (the options end at the first name or at `--`). */
  roles: Map<SyntaxNode, ArgRole>;
  /** The letters of the options turned on (`ix` of `declare -ix`), and of those turned off (`x` of `declare +x`). */
  on: string;
  off: string;
}

/** The options of a parse, one per letter of a cluster. */
export const optionRoles = (parse: ArgvParse): Extract<ArgRole, { role: 'option' }>[] =>
  parse.roles.flatMap((r) => (r.role.role === 'cluster' ? r.role.letters : [r.role])).filter((r): r is Extract<ArgRole, { role: 'option' }> => r.role === 'option');

/** The words of a declaration command `builtin` read with its spec. */
export function readDeclarationWords(builtin: string, words: SyntaxNode[]): Declaration {
  const parse = interpret(builtins[builtin], words.map(argWord), { name: builtin });
  const roles = new Map(parse.roles.map(({ word, role }) => [words[word], role]));
  let on = '';
  let off = '';
  for (const r of optionRoles(parse)) {
    if (r.disables) off += r.flag.slice(1);
    else on += r.flag.slice(1);
  }
  return { roles, on, off };
}

const declarations = new WeakMap<SyntaxNode, Declaration>();
/** A declaration command (`declare -ix -- a=1 b`) read with its builtin's spec. */
export function readDeclaration(d: SyntaxNode): Declaration {
  const seen = declarations.get(d);
  if (seen) return seen;
  const out = readDeclarationWords(d.children[0].type, d.namedChildren.filter((c) => !c.type.endsWith('redirect')));
  declarations.set(d, out);
  return out;
}
