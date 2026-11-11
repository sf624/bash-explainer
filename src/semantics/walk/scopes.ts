// The scopes of function calls, for the walk of the shell state (src/semantics/walk/walker.ts): bash's dynamic scoping
// (manual 3.3). A call's frame (`Frame.saved`) holds what its locals and prefix assignments hide, and each variable's
// state says whose it is (`VariableState.scope`), so that a local made, or removed by `unset`, on some paths only is
// followed on each: `f() { [ -t 0 ] && local x=2; x=9; }` leaves `x` as 9 after the call, or as it was.
import { type Frame } from './shared';
import { merge, mergeVariable, type ShellState, type VariableState } from '../shellstate';
import type { Walker } from './walker';

/**
 * Whose the variable `v` is, for the frame at `depth`: a local of that call (`this`), a prefix assignment of it
 * (`temporary`: `x=1 f`), another call's or the shell's own (`other`), or not known (`mixed`).
 */
export function whose(v: VariableState | undefined, depth: number): 'this' | 'temporary' | 'other' | 'mixed' {
  const s = v?.scope;
  if (s === 'mixed') return 'mixed';
  if (!s || s.depth !== depth) return 'other';
  return s.temporary ? 'temporary' : 'this';
}

/** `value` put in place of `prev`: in the scope of `prev`, unless it says one of its own (a key `scope`, even undefined). */
export function inScope(prev: VariableState | undefined, value: VariableState): VariableState {
  return prev?.scope !== undefined && !Object.hasOwn(value, 'scope') ? { ...value, scope: prev.scope } : value;
}

/** `v` as the walk does not know it: whether it is set, to what, and whose. */
export function notKnown(v: VariableState): VariableState {
  const { value: _value, source: _source, ...rest } = v;
  return { ...rest, declared: 'unknown', set: 'unknown', scope: 'mixed' };
}

/**
 * The frame makes `name` local where it was `hidden`: what it restores when it returns is that (merged with what it
 * hid on another path, where a local was made there first).
 */
export function hide(frame: Frame, name: string, hidden: VariableState | undefined): void {
  if (!frame.saved.has(name)) frame.saved.set(name, hidden);
  else {
    const was = frame.saved.get(name);
    frame.saved.set(name, was || hidden ? mergeVariable(name, was, hidden) : undefined);
  }
}

/**
 * What an `unset` of `name` in the call at `depth` shows, where bash removes a variable that is not this call's own
 * local: a caller's local, or a prefix assignment of a call (`x=1 f`, also of this one): the variable it hides. bash
 * 5.2 and 5.3 do so without `localvar_unset` (manual 4.2, `unset`; the trust allow-list refuses the option). Undefined
 * where `unset` removes the variable itself (the shell's own, or this call's local, which stays local and unset).
 */
export function revealed(w: Walker, v: VariableState | undefined, name: string, depth: number): { hidden: VariableState | undefined } | undefined {
  const s = v?.scope;
  if (typeof s !== 'object' || (s.depth === depth && !s.temporary)) return undefined;
  const frame = w.frames[s.depth - 1];
  /* c8 ignore next -- a variable is in the scope of a frame on the stack: leaving a frame restores those of its scope */
  if (!frame) return undefined;
  const hidden = frame.saved.get(name);
  return { hidden: hidden && { ...hidden, scope: hidden.scope } };
}

/**
 * `end` as the function (or `${ …; }`) of `frame`, at `depth`, returns: what its locals and prefix assignments hide
 * is restored, where they are still its own (not where an `unset` removed them, or on paths where it made none:
 * merged where that is not known), and its `local -` options. A `local GLOBIGNORE` going out of scope sets GLOBIGNORE
 * again, or unsets it: dotglob follows, as for an assignment or `unset`.
 */
export function leaveFrame(w: Walker, frame: Frame, end: ShellState, depth: number): ShellState {
  const restore = (st: ShellState, names: readonly string[]): ShellState => {
    for (const name of names) {
      const v = frame.saved.get(name);
      st = { ...st, variables: st.variables.with(name, v) };
      if (name === 'GLOBIGNORE' && w.bash) st = !v || v.set === 'off' ? w.put(st, 'shopt', 'dotglob', 'off') : w.builtins.globignore(st, v.set === 'on' ? v.value : undefined);
    }
    return st;
  };
  const sure: string[] = [];
  const maybe: string[] = [];
  for (const name of frame.saved.keys()) {
    const k = whose(end.variables.get(name), depth);
    if (k === 'this' || k === 'temporary') sure.push(name);
    else if (k === 'mixed') maybe.push(name);
  }
  end = restore(end, sure);
  if (maybe.length) end = merge([end, restore(end, maybe)], w.posix);
  return frame.options ? { ...end, set: frame.options } : end;
}
