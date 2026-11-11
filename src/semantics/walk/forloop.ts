// The loops over words, `for x in a b c` and `select x in …`, for the walk of the shell state
// (src/semantics/walk/walker.ts): what the loop variable is in the body and after the loop.
import { staticWordValue } from '../../staticword';
import { field, fields, type SyntaxNode } from '../../syntax/tree';
import { attribute, type ShellState, type VariableState } from '../shellstate';
import type { Walker } from './walker';

/**
 * `for x in a b c`: x is each word in turn, then stays the last; with no `in`, the positional parameters; `select`,
 * what the user types. After the loop, x is the last word only where every path of the body left it as the pass gave
 * it (`given`): `for x in a; do x=z; done` leaves `z`, and `unset x` in the body leaves it unset.
 */
export function forStatement(w: Walker, n: SyntaxNode, st: ShellState): ShellState {
  const values = fields(n, 'value');
  for (const v of values) st = w.expansions.defaults(v, w.expansions.substitutions(v, st));
  const variable = field(n, 'variable');
  // (A readonly variable: bash fails at the first word, and the body does not run; it may be.)
  const readonly = variable ? attribute(st, w.builtins.resolve(st, variable.text) ?? variable.text, 'r') : 'off';
  // (An integer runs each word, which may fail: see `assignmentError`.)
  if (variable && attribute(st, w.builtins.resolve(st, variable.text) ?? variable.text, 'i') !== 'off') w.abort(st, false);
  const given = new Set<VariableState | undefined>();
  const assign = (s: ShellState, value: string | undefined): ShellState => {
    const to = variable && readonly !== 'on' ? w.builtins.setVariable(s, variable.text, variable, value) : s;
    given.add(variable && to.variables.get(variable.text));
    return to;
  };
  const words = values.map((v) => (v.type === 'word' || v.type === 'number' || v.type === 'raw_string' || v.type === 'string' ? staticWordValue(v) : undefined));
  const known = n.type === 'for_statement' && values.length > 0 && words.every((x) => x !== undefined) && readonly === 'off';
  const each = known && new Set(words).size === 1 ? words[0] : undefined;
  // (A list of known words runs the body at least once.)
  return w.loop(n, st, { cond: (s) => s, body: (s) => w.sequence(field(n, 'body')?.children ?? [], assign(s, each)), endsWithCondition: false, atLeastOnce: known,
    exit: (s) => (known && given.has(s.variables.get(variable!.text)) ? assign(s, words[words.length - 1]) : s) });
}
