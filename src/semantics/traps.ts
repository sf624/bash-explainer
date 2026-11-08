// The traps of `EXIT` and `ERR` the model follows (docs/design/errexit-stop.md, G1), read at a statement: the trap in
// effect there (`ShellState.traps`, kept by the walk: src/semantics/walk/traps.ts) and, where none is set yet, the
// `trap … EXIT` of the main shell that comes later.
import { ancestor, rootOf, type SyntaxNode } from '../syntax/tree';
import { atTop } from './scriptstops';
import type { StateModel } from './state';
import type { TrapState } from './shellstate';
import type { Trapped, TrapSet } from './walk/traps';

export type { Trapped, TrapSet };
export { trappedName } from './walk/traps';

/** The trap of `name` in effect where `n` runs; undefined: none was ever set on the way there. */
export function trapAt(model: StateModel, n: SyntaxNode, name: Trapped): TrapState | undefined {
  return model.at(n).run.traps.get(name);
}

/**
 * Where no `EXIT` trap was ever set on the way to `n`, a statement of the main shell outside any function (run 4,
 * fix 1): the first `trap … EXIT` that sets an action after it, at the top level of the script (not in a branch, a
 * loop or a function, so that the shell surely gets there once it has got past `n`), in code that runs. A failure at
 * `n` runs no `EXIT` trap: that one is not set yet.
 */
export function laterExitTrap(model: StateModel, n: SyntaxNode): TrapSet | undefined {
  if (trapAt(model, n, 'EXIT') || model.env(n).links.length || ancestor(n, (a) => a.type === 'function_definition')) return undefined;
  let top = n;
  while (top.parent?.parent) top = top.parent;
  return model.trapSets.find((t) => t.state === 'on' && t.script && t.names.includes('EXIT') && t.main && !t.dead
    && rootOf(t.at) === rootOf(n) && t.at.startIndex > top.startIndex && atTop(t.at));
}
