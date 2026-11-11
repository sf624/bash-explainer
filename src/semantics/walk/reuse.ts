// The walks of function bodies, for the walk of the shell state (src/semantics/walk/walker.ts): a call made again from
// the same state reuses the walk of the first (each state once: a body that calls a function twice would otherwise
// double the walks at each level of calls, `f2() { f1; f1; }`, `f2() { x=1 f1; x=1 f1; }`), and past
// `WALKS_PER_FUNCTION` walks the body's changes are not known.
import type { SyntaxNode } from '../../syntax/tree';
import { pushAll } from '../../lists';
import { sameState, type ShellState, sourcesApart, type VariableState } from '../shellstate';
import { restoredFor, sameSaved } from './scopes';
import type { Frame } from './shared';
import { notWalked } from './widen';
import type { Walker } from './walker';

/** How many times a function body is walked with different states before the rest of its calls are guessed. */
const WALKS_PER_FUNCTION = 4;

/**
 * A walk of a function body: the state it was called with (`entry`, with the call's prefix assignments) and what its
 * frame hid (`saved`), the state after it, the modes it was made in (`how`, see `key`), the states where an error in
 * it ended or may end the line, what it changed, and the bodies it ran (itself, and those it called).
 */
interface Walk {
  entry: ShellState; saved: ReadonlyMap<string, VariableState | undefined>; exit: ShellState; how: string;
  aborts: ShellState[]; maybes: ShellState[]; changed: ReadonlySet<string>; inside: ReadonlySet<SyntaxNode>;
}

/** Whether a state the walk gives after the call (its end, or where an error ends the line) holds the word its entry gave `name`. */
function wordAfter(walk: Walk, name: string): boolean {
  const word = walk.entry.variables.get(name)?.source;
  for (const st of [walk.exit, ...walk.aborts, ...walk.maybes]) if (st.variables.get(name)?.source === word) return true;
  return false;
}

export class WalkReuse {
  /** The walks of each function body (a call with the same entry and frame reuses one, `call`). */
  readonly walks = new Map<SyntaxNode, Walk[]>();
  /** The bodies each walk being made has run (`Walk.inside`). */
  private readonly insides: Set<SyntaxNode>[] = [];

  constructor(private readonly w: Walker) {}

  /** The body of `def` is being walked: the walks being made have run it. */
  entered(def: SyntaxNode): void {
    for (const inside of this.insides) inside.add(def);
  }

  /**
   * The state after the body of `def` runs from `entry` with `frame` (what the call's prefix assignments hide, `x=1 f`;
   * `st`: the state before them). A walk made from the same entry, with the same frame and in the same modes, is
   * reused.
   */
  call(def: SyntaxNode, st: ShellState, entry: ShellState, frame: Frame): ShellState {
    const w = this.w;
    const walks = this.walks.get(def) ?? [];
    if (!w.silent) this.walks.set(def, walks);
    const how = this.key();
    const seen = walks.find((x) => x.how === how && (x.entry === entry || sameState(x.entry, entry)) && sameSaved(x.saved, frame.saved));
    // (A walk reused gives again the states where an error in it ended the line, see `abort`, and makes its changes
    // again here, for what collects them: a loop, the body that calls it, a trap's action.)
    const unit = w.unitTarget();
    if (seen) {
      // (It holds the value words of its own entry: those that differ here are no origin of a value, `valueOrigin`. The
      // word of a prefix assignment stays in the bodies the walk ran, unless a state it gives after the call holds it.
      // What the call restores is this call's.)
      for (const name of sourcesApart(seen.entry, entry)) {
        if (frame.saved.has(name) && !wordAfter(seen, name)) this.mixedIn(name, seen.inside);
        else w.mixedSources.set(name, 'everywhere');
      }
      const { exit, apart } = restoredFor(seen.exit, seen.saved, frame.saved);
      for (const name of apart) w.mixedSources.set(name, 'everywhere');
      for (const inside of this.insides) for (const d of seen.inside) inside.add(d);
      if (unit && unit.dead === w.mode.dead) pushAll(unit.aborts, seen.aborts);
      for (const m of seen.maybes) w.abort(m, false);
      for (const key of seen.changed) {
        w.lastChange.set(key, ++w.changeCount);
        for (const c of w.collecting) c.add(key);
      }
      return exit;
    }
    if (walks.length >= WALKS_PER_FUNCTION) {
      // (From the state before the prefix assignments, which are gone after the call: what the body changes is not known.)
      const exit = notWalked(w, def, st);
      w.unwalked.add(def);
      w.abort(st, false);
      return exit;
    }
    const from = unit?.aborts.length ?? 0;
    const maybesFrom = unit?.maybes.length ?? 0;
    const changed = new Set<string>();
    const saved = new Map(frame.saved);
    const inside = new Set<SyntaxNode>();
    w.collecting.push(changed);
    this.insides.push(inside);
    const reveals = w.reveals;
    let exit: ShellState;
    try {
      exit = w.walkBody(def, entry, frame);
    } finally {
      w.collecting.pop();
      this.insides.pop();
    }
    // (One that showed what a caller's frame hides, `revealed`, is not reused: another caller's frame hides another.)
    if (!w.silent) walks.push({ entry, saved, inside, exit, how: w.reveals === reveals ? how : `${how} ${w.reveals}`, aborts: [...new Set(unit?.aborts.slice(from))], maybes: [...new Set(unit?.maybes.slice(maybesFrom))], changed });
    return exit;
  }

  /** `name` holds another word than the one a reused walk gives it in the bodies `inside` (`mixedSources`). */
  private mixedIn(name: string, inside: ReadonlySet<SyntaxNode>): void {
    const was = this.w.mixedSources.get(name);
    if (was === 'everywhere') return;
    const next = new Set(was);
    for (const d of inside) next.add(d);
    this.w.mixedSources.set(name, next);
  }

  /**
   * What a walk of a function body depends on besides its entry state: each mode of the walk (`mode`: in it or not),
   * and whether an error ends a line there or a subshell (see `abort`). A walk is reused where these are the same
   * (`call`). (A trap's action walked only for what it changes, `silent`, records nothing, and changes nothing a walk
   * gives: it reuses the others.)
   */
  private key(): string {
    return [...Object.values(this.w.mode).map((depth) => depth > 0), !!this.w.unitTarget()].join(' ');
  }
}
