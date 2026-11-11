// The scopes of function calls, for the walk of the shell state (src/semantics/walk/walker.ts): bash's dynamic scoping
// (manual 3.3). A call's frame (`Frame.saved`) holds what its locals and prefix assignments hide, and each variable's
// state says whose it is (`VariableState.scope`), so that a local made, or removed by `unset`, on some paths only is
// followed on each: `f() { [ -t 0 ] && local x=2; x=9; }` leaves `x` as 9 after the call, or as it was.
import { type Frame } from './shared';
import { merge, mergeVariable, type Scope, type ShellState, type VariableState } from '../shellstate';
import type { Walker } from './walker';

/**
 * Whose the variable `v` is, for the frame at `depth`: a local of that call (`this`), a prefix assignment of it
 * (`temporary`: `x=1 f`), another call's or the shell's own (`other`), or not known (`mixed`: maybe this call's).
 */
export function whose(v: VariableState | undefined, depth: number): 'this' | 'temporary' | 'other' | 'mixed' {
  const s = v?.scope;
  if (s && 'mixed' in s) return s.mixed >= depth ? 'mixed' : 'other';
  if (!s || s.depth !== depth) return 'other';
  return s.temporary ? 'temporary' : 'this';
}

/** Whether `v` is a local of a call, or its prefix assignment, on every path (`StateModel.local`: a write that is the call's). */
export const ofCall = (v: VariableState | undefined): boolean => !!v?.scope && 'depth' in v.scope;

/**
 * `value` put in place of `prev`: in the scope of `prev`, unless it says one of its own (a key `scope`, even
 * undefined). Where `prev` is mixed, the value is put on the other paths too, in what the variable is there.
 */
export function inScope(prev: VariableState | undefined, value: VariableState): VariableState {
  const s = prev?.scope;
  if (!s || Object.hasOwn(value, 'scope')) return value;
  if (!('mixed' in s) || !s.outer) return { ...value, scope: s };
  return { ...value, scope: { mixed: s.mixed, outer: { v: s.outer.v ? inScope(s.outer.v, value) : value } } };
}

/** `v` as the walk does not know it: whether it is set, and to what, also on the paths where it is another call's. */
export function notKnown(v: VariableState): VariableState {
  const { value: _value, source: _source, ...rest } = v;
  const s = v.scope;
  const outer = s && 'mixed' in s && s.outer ? { outer: { v: s.outer.v && notKnown(s.outer.v) } } : {};
  return { ...rest, declared: 'unknown', set: 'unknown', ...(s && 'mixed' in s ? { scope: { mixed: s.mixed, ...outer } } : {}) };
}

/** What the variable `v`, mixed at `depth`, is on the paths where it is not that call's (none: there are none). */
export function outerOf(v: VariableState): { v: VariableState | undefined } | undefined {
  return (v.scope as Extract<Scope, { mixed: number }>).outer;
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
  if (!s || 'mixed' in s || (s.depth === depth && !s.temporary)) return undefined;
  const frame = w.frames[s.depth - 1];
  /* c8 ignore next -- a variable is in the scope of a frame on the stack: leaving a frame restores those of its scope */
  if (!frame) return undefined;
  const hidden = frame.saved.get(name);
  return { hidden: hidden && { ...hidden, scope: hidden.scope } };
}

/**
 * `end` as the function (or `${ …; }`) of `frame`, at `depth`, returns: what its locals and prefix assignments hide
 * is restored, where they are still its own (not where an `unset` removed them, or on paths where it made none:
 * merged where that is not known, and no longer this call's), and its `local -` options. A `local GLOBIGNORE` going
 * out of scope sets GLOBIGNORE again, or unsets it: dotglob follows, as for an assignment or `unset`. (Each path of the
 * body that returns is left on its own: a `return` before the `local` leaves the caller's variable as it was.)
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
    const v = end.variables.get(name);
    const k = whose(v, depth);
    if (k === 'this' || k === 'temporary' || (k === 'mixed' && !outerOf(v!))) sure.push(name);
    else if (k === 'mixed') maybe.push(name);
  }
  end = restore(end, sure);
  // (Mixed: what the frame hides on its paths, and on the others what the variable is there.)
  if (maybe.length) {
    let others = end;
    for (const name of maybe) others = { ...others, variables: others.variables.with(name, outerOf(end.variables.get(name)!)!.v) };
    end = merge([restore(end, maybe), others], w.posix);
  }
  return frame.options ? { ...end, set: frame.options } : end;
}
