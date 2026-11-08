// The traps of `EXIT` and `ERR` along the walk of the shell state (docs/design/errexit-stop.md, G1): what `trap` sets
// and takes back, what a subshell and a function body start with, and `exec`, after which none runs. The state holds
// them (`ShellState.traps`); the walk (./walker.ts, ./builtins.ts, ./expansions.ts) calls these where they change.
import type { ArgvParse } from '../../argv/interpret';
import { has, operands } from '../../argv/query';
import { staticWordValue } from '../../staticword';
import type { SyntaxNode } from '../../syntax/tree';
import { subshellReasons } from '../env';
import { NESTED_DEPTH, type NestedScript } from '../nested';
import { option, type ShellState, type TrapState, type Tri } from '../shellstate';
import { exitSignal, processIn } from './shared';
import type { Walker } from './walker';
import { widen } from './widen';

/** The traps the state follows. */
export const TRAPPED = ['EXIT', 'ERR'] as const;
export type Trapped = (typeof TRAPPED)[number];

/** The trap a signal word of `trap` names among those followed (`EXIT`, `0`, `exit`, `ERR`, `err`: bash reads the names in any case), or undefined. */
export function trappedName(word: string): Trapped | undefined {
  if (exitSignal(word)) return 'EXIT';
  return word.toUpperCase() === 'ERR' ? 'ERR' : undefined;
}

/**
 * A `trap` command the walk ran that sets or takes back `EXIT` or `ERR` (`StateModel.trapSets`, in the order the walk
 * met them): `at`, the command (of the document, for an alias or a string `eval` runs: the command that runs it);
 * `state`, as `TrapState`'s; `exitOnly`, every signal it names is `EXIT`; `main`, it ran in the main shell, not in a
 * subshell or a trap's action; `dead`, only in code that does not run.
 */
export interface TrapSet {
  readonly at: SyntaxNode;
  readonly names: readonly Trapped[];
  readonly state: Tri;
  readonly script?: NestedScript;
  readonly exitOnly: boolean;
  readonly main: boolean;
  readonly dead: boolean;
}

/**
 * The state after `trap` (its words `args`, read as `parse`; `at`, the command) from `st`. `action`: the word of its
 * action and the script the walk reads in it (none: not read); undefined for `trap - EXIT`, `trap EXIT`, `trap 0`,
 * which take the traps back. `trap '' EXIT` sets one that runs nothing: none runs. A signal word not known here may
 * name either trap.
 */
export function trapCommand(w: Walker, st: ShellState, parse: ArgvParse, args: readonly SyntaxNode[], at: SyntaxNode, action?: { word: SyntaxNode; script?: NestedScript }): ShellState {
  if (has(parse, '-p', '-P', '-l')) return st;
  const words = trapSignals(parse, args);
  const named = new Set(words.map((v) => (v === undefined ? undefined : trappedName(v))).filter((t) => t !== undefined));
  const anyName = words.includes(undefined);
  const state: Tri = !action || action.script?.text === '' ? 'off' : action.script ? 'on' : 'unknown';
  const script = state !== 'off' ? action?.script : undefined;
  const names = TRAPPED.filter((t) => named.has(t) || anyName);
  for (const name of names) {
    const entry: TrapState = { state: named.has(name) ? state : 'unknown', at, ...(script ? { script } : {}) };
    st = w.put(st, 'traps', name, entry);
  }
  // (Once each: a body walked again, or the same `at` for each `trap` in a string `eval` or a trap's action runs.)
  if (names.length && !w.silent && !w.trapSets.some((t) => t.at === at && t.script === script && String(t.names) === String(names) && t.state === state)) {
    const exitOnly = words.every((v) => v !== undefined && exitSignal(v));
    w.trapSets.push({ at, names, state: anyName ? 'unknown' : state, ...(script ? { script } : {}), exitOnly, main: !processIn(w.targets) && !w.targets.some((t) => t.kind === 'trap'), dead: w.mode.dead > 0 });
  }
  return st;
}

/** The signal words of `trap` (`parse` of `args`: its `SIGNAL` operands, not the `-` of `trap - EXIT`), as their values (undefined: not known here). */
export function trapSignals(parse: ArgvParse, args: readonly SyntaxNode[]): (string | undefined)[] {
  return operands(parse, 'SIGNAL').map((o) => staticWordValue(args[o.word]));
}

/** The state after `exec` runs a command at `at`: the shell is replaced, and no trap of `EXIT` runs. */
export function execTraps(w: Walker, st: ShellState, at: SyntaxNode): ShellState {
  return st.traps.get('EXIT')?.state === 'off' ? st : w.put(st, 'traps', 'EXIT', { state: 'off', at });
}

/**
 * The traps a subshell starts with (`( )`, `$( )`, a pipeline stage, a job): bash resets them, so none, but the `ERR`
 * trap where errtrace is on (`set -E`), which it inherits.
 */
export function subshellTraps(st: ShellState): ShellState {
  if (!st.traps.size) return st;
  const err = st.traps.get('ERR');
  const errtrace = option(st, 'set', 'errtrace');
  const kept = !err || errtrace === 'off' || errtrace === 'default' ? undefined : errtrace === 'on' ? err : { ...err, state: 'unknown' as const };
  let traps = st.traps;
  for (const name of TRAPPED) traps = traps.with(name, name === 'ERR' ? kept : undefined);
  return { ...st, traps };
}

/** What `functionEntry` gave for each state and definition, so that `functionExit` finds it again. */
const entries = new WeakMap<ShellState, Map<SyntaxNode, ShellState>>();

/**
 * The state the body of the function `def` starts with from `st`: without errtrace, the caller's `ERR` trap does not
 * run in it (none, `at` the definition), though one the body sets does, and stays set after it (`functionExit`).
 */
export function functionEntry(st: ShellState, def: SyntaxNode): ShellState {
  const err = st.traps.get('ERR');
  const errtrace = option(st, 'set', 'errtrace');
  if (!err || err.state === 'off' || errtrace === 'on') return st;
  let byDef = entries.get(st);
  if (!byDef) entries.set(st, (byDef = new Map()));
  let inner = byDef.get(def);
  if (!inner) byDef.set(def, (inner = { ...st, traps: st.traps.with('ERR', errtrace === 'unknown' ? { ...err, state: 'unknown' } : { state: 'off', at: def }) }));
  return inner;
}

/** The state after the body of `def`, called from `entry`, ended at `end`: the caller's `ERR` trap again, unless the body set or took back one. */
export function functionExit(entry: ShellState, def: SyntaxNode, end: ShellState): ShellState {
  const inner = functionEntry(entry, def);
  if (inner === entry || end.traps.get('ERR') !== inner.traps.get('ERR')) return end;
  return { ...end, traps: end.traps.with('ERR', entry.traps.get('ERR')) };
}

/**
 * Runs the actions of `trap` (`Walker.traps`), for the calls they make: they run later, when a signal comes or (EXIT)
 * when the script ends, so each runs from the state when it was set, with what the script changes after that taken
 * as unknown; an EXIT trap set at the top level, from the state at the end, `end`.
 */
export function runTraps(w: Walker, end: ShellState): void {
  // (An action may set a trap of its own: it is walked in the next round.)
  for (let round = 0; round < NESTED_DEPTH && w.traps.length; round++) for (const t of w.traps.splice(0)) {
    const after = new Set([...w.lastChange].filter(([, i]) => i > t.since).map(([k]) => k));
    const st = t.exit && topLevel(t.host) ? end : widen(w, t.st, after, t);
    w.trapAction(t.script, t.host, st, t.exitOnly, t.dead, t.proc);
  }
}

/** Whether `n` is a statement of the top level, in the main shell. */
function topLevel(n: SyntaxNode): boolean {
  for (let x = n; x.parent; x = x.parent) {
    if (subshellReasons(x).length || (x.parent.parent && x.parent.type !== 'list' && x.parent.type !== 'redirected_statement')) return false;
  }
  return true;
}
