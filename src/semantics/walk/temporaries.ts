// The prefix assignments of a command with a name (`a=2 b=$a cmd`), for the walk of the shell state
// (src/semantics/walk/walker.ts): bash makes them after it expands the words, from left to right, as variables of
// the command alone (each sees those before it); `export` and `readonly` of one keep it in the shell.
import { field, type SyntaxNode } from '../../syntax/tree';
import { keptPrefixes } from '../names';
import type { ShellState, VariableState } from '../shellstate';
import type { Walker } from './walker';

/** The attributes that change what bash keeps of a prefix assignment (`declare -i n; n=2+3 export n` keeps 5). */
const CHANGING = ['i', 'l', 'u', 'n', 'a', 'A'];

/**
 * Records at each prefix assignment of a command the state its value is expanded in: the one after the words (`st`),
 * with the assignments before it (`a=2 b=$a cmd`: `$a` is 2). The walk itself is not changed (`Walker.scratch`): a
 * function call or `eval` makes them for its own run. Gives the state with them all, for `kept`. (Not one to an
 * element, `n[0]=5 cmd`, which bash refuses.)
 */
export function temporaries(w: Walker, assignments: readonly SyntaxNode[], st: ShellState): ShellState {
  w.scratch++;
  try {
    for (const a of assignments) {
      w.record(a, st);
      if (field(a, 'name')!.type !== 'subscript') st = w.builtins.assignNode(a, st, false, true);
    }
  } finally {
    w.scratch--;
  }
  return st;
}

/**
 * What stays of the prefix assignments of the builtin `n`, after it ran (`after`; `temps`: the state with them, from
 * `temporaries`): those its builtin surely keeps (`keptPrefixes`: `a=2 export a` leaves the variable `a` in scope set
 * to 2, exported), unless an attribute changes the value (`declare -i n; n=2+3 export n` keeps 5); the variables of
 * those it may keep are not known after it. Not when the builtin is turned off (`enable -n export`: a program runs).
 */
export function kept(w: Walker, n: SyntaxNode, temps: ShellState, after: ShellState): ShellState {
  const { builtin, names } = keptPrefixes(n, (word) => w.conditions.staticText(word, after), w.shell);
  const off = builtin ? after.disabled.get(builtin)?.state ?? 'off' : 'off';
  if (off === 'on') return after;
  for (const [v, sure] of names) {
    const t = temps.variables.get(v)!;
    const now = after.variables.get(v) ?? t;
    const changes = [now, t].some((x) => CHANGING.some((l) => (x.attrs[l]?.state ?? 'off') !== 'off'));
    after = w.put(after, 'variables', v, sure && off === 'off' && !changes && t.set === 'on' ? keptValue(now, t) : unknown(now));
  }
  return after;
}

/** `v` with the value of the prefix assignment `t`, exported as the variable of a command is (`a=2 readonly a` exports `a`). */
function keptValue(v: VariableState, t: VariableState): VariableState {
  const { source: _source, value: _value, ...rest } = v;
  return {
    ...rest, declared: 'on', set: 'on', attrs: { ...v.attrs, x: { state: 'on', at: t.at } },
    ...(t.value !== undefined ? { value: t.value } : {}), ...(t.source ? { source: t.source } : {}), at: t.at,
  };
}

/** `v`, not known whether set or to what. */
function unknown(v: VariableState): VariableState {
  const { source: _source, value: _value, ...rest } = v;
  return { ...rest, declared: 'unknown', set: 'unknown' };
}
