// Where bash stops expanding a statement: a parameter expansion that fails (`${x:?}` of an empty `x`, a parameter
// not set under `set -u`) ends a non-interactive shell there, before the statement runs, and bash expands nothing
// more of it. So the other words of the statement give no value (src/semantics/values.ts).
import { parseExpansion } from '../expansion';
import { ancestor, descendants, type SyntaxNode } from '../syntax/tree';
import { STATEMENTS } from './env';
import { option, type StateModel } from './state';

/** The operators of `${x…}` that give a word when `x` is not set: no error under `set -u`. */
const DEFAULTS = new Set(['-', ':-', '=', ':=', '+', ':+']);
/** The special parameters that are always set (`$@` and `$*` count as set under `set -u`, also with no arguments). */
const ALWAYS_SET = new Set(['@', '*', '?', '$', '#', '-', '0']);

/** The statement whose words hold `n`: the innermost one around it (every word is in one). */
const statementOf = (n: SyntaxNode): SyntaxNode => ancestor(n, (x) => STATEMENTS.has(x.type))!;

/**
 * Whether bash may fail on the expansion `e` where nounset is `nounset`: `${x?w}` and `${x:?w}`, and under `set -u`
 * a parameter with no default (`$x`, `${#x}`, `${x%p}`, `$1`, `$!`), unless the model knows its value (`known`).
 */
function mayFail(e: SyntaxNode, nounset: boolean, known: (e: SyntaxNode) => boolean): boolean {
  const p = e.type === 'expansion' ? parseExpansion(e.text) : { name: e.text.slice(1), op: undefined, subscript: undefined };
  const fails = !p || p.op === '?' || p.op === ':?' || (nounset && !DEFAULTS.has(p.op ?? '') && (!ALWAYS_SET.has(p.name) || p.subscript !== undefined));
  return fails && !known(e);
}

/** `mayFail` of each expansion, per model (the words of a statement ask for each other). */
const failing = new WeakMap<StateModel, WeakMap<SyntaxNode, boolean>>();

/**
 * Whether another expansion of the statement that holds `part` may fail (`mayFail`), so that bash may not get to
 * `part`, or not run the statement: `echo ${e:?} "$e"`, `x=${e:?} cmd "$e"` (the words are expanded first, but the
 * command does not run). Not those in nested statements (`$( )`, a body), which end only there or run apart, nor
 * those inside `part` or around it, which its own value accounts for.
 */
export function mayStopAround(part: SyntaxNode, model: StateModel, known: (e: SyntaxNode) => boolean): boolean {
  const top = statementOf(part);
  const nounset = option(model.at(top).run, 'set', 'nounset');
  let cache = failing.get(model);
  if (!cache) failing.set(model, (cache = new WeakMap()));
  const fails = (e: SyntaxNode): boolean => {
    let v = cache.get(e);
    if (v === undefined) cache.set(e, (v = mayFail(e, nounset !== 'off' && nounset !== 'default', known)));
    return v;
  };
  const inside = (a: SyntaxNode, b: SyntaxNode): boolean => a.startIndex >= b.startIndex && a.endIndex <= b.endIndex;
  return descendants(top, ['simple_expansion', 'expansion']).some((e) => !inside(e, part) && !inside(part, e) && statementOf(e) === top && fails(e));
}

