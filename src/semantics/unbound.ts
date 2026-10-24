// Where a script reads a variable that is unset under `set -u`, and bash fails ("`x: unbound variable`"): read from
// the shell state (src/semantics/state.ts) and said by src/wordfacts.ts (`nounset-unbound`, src/messages.ts).
// test/fixtures/probes/words.json checks it against bash (each row's `unbound`).
import { parseExpansion } from '../expansion';
import { ancestor, field, type SyntaxNode } from '../syntax/tree';
import { processOf, STATEMENTS } from './env';
import { resolveName } from './names';
import { attribute, option, type StateModel } from './state';
import { unreliableNames } from './words';

/** The nodes an arithmetic name may be in and still be read whenever the expression runs: not after `&&`, `||` or `?`. */
const ARITH_EVERY = new Set(['binary_expression', 'unary_expression', 'postfix_expression', 'parenthesized_expression', 'ternary_expression']);

/** A read that bash fails on under `set -u` (`unboundRead`). */
export interface UnboundRead {
  /** The parameter as bash names it in its error (`x`, `a[0]`), and the variable. */
  shown: string;
  name: string;
  /** The process that exits: the script's shell, a subshell of it (`$( )`, a pipeline's stage), or the shell running it (not known which). */
  exits: 'script' | 'subshell' | 'shell';
}

/** The redirections whose words a command expands. */
const REDIRECTS = new Set(['file_redirect', 'herestring_redirect']);

/**
 * The parameter that `n` surely reads unset under `set -u`, where bash fails ("`x: unbound variable`") and the shell
 * running it exits. `n` is an expansion (`$x`, `${x}`, `${#x}`, `${x[0]}`, `${x:1}`, `${x#p}`…: not `${x-w}`,
 * `${x:+w}`, `${x=w}`, `${x?w}`, `${!x}`, `${a[@]}`, nor a special or positional parameter), or a name read in `$(( ))`
 * or `(( ))` wherever the expression runs. Said only when it is so on every path: `set -u` is on, and the variable has
 * no value there (`declare x`, `unset x`, or set by no command before), the model trusts what it saw (not blind;
 * nothing it does not read ran on the way; a function body only when every call is seen), and the statement does not
 * set it itself (`a=1 b=$a`). A name in capitals, which may come from the environment (as the variables bash sets
 * itself), is left out. So are a here-document, where bash goes on after the error, and a redirection of a command
 * that may run a program, which its own process makes (`cat < "$f"`: that process exits).
 */
export function unboundRead(n: SyntaxNode, model: StateModel): UnboundRead | undefined {
  if (model.blind) return undefined;
  let name: string;
  let shown: string;
  if (n.type === 'simple_expansion') {
    name = shown = n.text.slice(1);
  } else if (n.type === 'expansion') {
    const p = n.startPosition.row === n.endPosition.row ? parseExpansion(n.text) : undefined;
    if (!p || p.prefix === '!' || (p.op && /^:?[-=+?]$/.test(p.op)) || (p.subscript !== undefined && !/^\w+$/.test(p.subscript))) return undefined;
    name = p.name;
    shown = p.subscript === undefined ? name : `${name}[${p.subscript}]`;
  } else {
    let x = n;
    while (x.parent && ARITH_EVERY.has(x.parent.type)) {
      const up = x.parent;
      if (up.type === 'ternary_expression' && up.namedChildren[0] !== x) return undefined;
      const op = up.type === 'binary_expression' ? field(up, 'operator')?.type : undefined;
      if ((op === '&&' || op === '||') && x.field === 'right') return undefined;
      if (op === '=' && x.field === 'left') return undefined;
      x = up;
    }
    if (n.type !== 'variable_name' || !(x.parent?.type === 'arithmetic_expansion' || x.parent?.type === 'arithmetic_command')) return undefined;
    name = shown = n.text;
  }
  if (!/^[A-Za-z_]\w*$/.test(name) || name === name.toUpperCase()) return undefined;
  if (ancestor(n, (a) => a.type === 'heredoc_body')) return undefined;
  const st = model.at(n).run;
  if (option(st, 'set', 'nounset') !== 'on' || st.opaque) return undefined;
  const statement = ancestor(n, (a) => STATEMENTS.has(a.type))!;
  if (model.dead(statement) || model.writes(statement).has(name) || unreliableNames(n).has(name)) return undefined;
  const isFunction = (a: SyntaxNode): boolean => a.type === 'function_definition';
  for (let fn = ancestor(n, isFunction); fn; fn = ancestor(fn, isFunction)) {
    if (!model.closed(field(fn, 'name')!.text) || !model.calls.get(fn)?.size) return undefined;
  }
  const redirect = ancestor(n, (a) => REDIRECTS.has(a.type));
  const command = redirect?.parent?.type === 'command' ? field(redirect.parent, 'name') : undefined;
  if (command) {
    const r = /^[\w./+-]+$/.test(command.text) ? resolveName(model, command.text, command, { command: true }) : undefined;
    if (!((r?.kind === 'builtin' && !r.missed && !r.disabled) || (r?.kind === 'function' && r.sure))) return undefined;
  }
  const v = st.variables.get(name);
  // (Unset on every path. A nameref is left out: what it reads is its target's.)
  if (v && (v.set !== 'off' || attribute(st, name, 'n') !== 'off')) return undefined;
  const p = processOf(model.env(n));
  return { shown, name, exits: !p.sure ? 'shell' : p.kind === 'main' ? 'script' : p.kind === 'subshell' ? 'subshell' : 'shell' };
}
