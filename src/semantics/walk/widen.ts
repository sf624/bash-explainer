// What the walk of the shell state (src/semantics/walk/walker.ts) takes as unknown where it does not follow what runs:
// a call not walked, a body no call reached, a trap's action (from when it was set); and the bodies that such a
// call runs with states no walk saw.
import type { SyntaxNode } from '../../syntax/tree';
import type { Attribute, Entry, Kind, ShellState, VariableState } from '../shellstate';
import { hashEntry, hashOutcomes } from '../shellstate';
import { ATTRIBUTE_LETTERS } from './builtins';
import { OPAQUE, processIn, type SetAt } from './shared';
import type { Walker } from './walker';

/** The prefix of the key of a change of a variable's attributes (`Walker.put`): `attrs x`, beside `variables x`. */
export const ATTRS = 'attrs ';

/** Whether a variable's attributes differ between `a` and `b` (none: not set, no attributes). */
export function attributesChange(a: VariableState | undefined, b: VariableState | undefined): boolean {
  const x = a?.attrs ?? {};
  const y = b?.attrs ?? {};
  return [...new Set([...Object.keys(x), ...Object.keys(y)])].some((l) => (x[l]?.state ?? 'off') !== (y[l]?.state ?? 'off'));
}

/**
 * `st` with the names in `keys` (`kind name`) taken as unknown, and the attributes of the variables in `attrs name`
 * keys; but a function surely defined by the top level (`Walker.sureLater`) is defined. `from`: where the body that
 * runs later was set, when known (the table of `hash -p` then gathers what each change after it in its process leaves).
 */
export function widen(w: Walker, st: ShellState, keys: ReadonlySet<string>, from?: SetAt): ShellState {
  const changes = { set: new Map(), shopt: new Map(), variables: new Map(), functions: new Map(), aliases: new Map(), disabled: new Map(), hashed: new Map() } as { [K in Kind]: Map<string, Entry<K>> };
  let opaque = st.opaque;
  for (const key of keys) {
    if (key === OPAQUE) {
      opaque = true;
      continue;
    }
    if (key.startsWith(ATTRS)) continue;
    const kind = key.slice(0, key.indexOf(' ')) as Kind;
    const name = key.slice(kind.length + 1);
    if (kind === 'set' || kind === 'shopt') {
      if (st[kind].get(name) !== 'unknown') changes[kind].set(name, 'unknown');
    } else if (kind === 'variables') {
      const v = st.variables.get(name);
      const at = v?.at ?? w.lastAt.get(key)!;
      // (Each attribute too, where what runs changes them: it may give one, `readonly x`, or take it off; but not
      // take off `readonly`.)
      let attrs: Record<string, Attribute> = v?.attrs ?? {};
      let same = true;
      if (keys.has(`${ATTRS}${name}`)) {
        attrs = {};
        for (const l of ATTRIBUTE_LETTERS) attrs[l] = l === 'r' && v?.attrs.r?.state === 'on' ? v.attrs.r : { state: 'unknown', at: v?.attrs[l]?.at ?? at };
        same = !!v && [...ATTRIBUTE_LETTERS].every((l) => v.attrs[l]?.state === attrs[l].state);
      }
      if (!v) changes.variables.set(name, { declared: 'unknown', set: 'unknown', attrs, at });
      else if (v.declared !== 'unknown' || v.set !== 'unknown' || v.value !== undefined || !same) changes.variables.set(name, { ...v, declared: 'unknown', set: 'unknown', value: undefined, attrs });
    } else if (kind === 'functions') {
      const f = st.functions.get(name);
      const defs = w.functionDefs.get(name)!;
      const sure = w.sureLater.get(name);
      if (sure) {
        if (f?.state !== 'on') changes.functions.set(name, { state: 'on', def: f?.def ?? sure, exported: f?.exported ?? 'unknown', readonly: f?.readonly ?? 'unknown' });
      } else if (!f) changes.functions.set(name, { state: 'unknown', def: defs[defs.length - 1], exported: 'unknown', readonly: 'unknown' });
      else if (f.state !== 'unknown') changes.functions.set(name, { ...f, state: 'unknown' });
    } else if (kind === 'hashed') {
      // (What it was, or what a change in the same process leaves: each one after `from` (a function no call reaches,
      // a trap's action, in the process they were set in), else the last one in the process the walk is in. One made
      // only in another process changes nothing here.)
      const e = st.hashed.get(name);
      const proc = from ? from.proc : processIn(w.targets);
      const puts = w.builtins.hashPuts.filter((p) => p.name === name && p.proc === proc && (!from || p.count > from.since)).map((p) => p.entry);
      const later = from ? puts : puts.slice(-1);
      if (later.length) changes.hashed.set(name, hashEntry(later.at(-1)!, [...hashOutcomes(e), ...later.flatMap(hashOutcomes)]));
    } else if (kind === 'disabled') {
      const e = st.disabled.get(name);
      if (e?.state !== 'unknown') changes.disabled.set(name, { state: 'unknown', at: e?.at ?? w.lastAt.get(key)! });
    } else {
      const a = w.aliases.unknown(name, st.aliases.get(name));
      if (a) changes.aliases.set(name, a);
    }
  }
  // (The status, and whether the path gets here, stay.)
  return {
    ...st,
    ...(opaque ? { opaque } : {}),
    set: st.set.withAll(changes.set), shopt: st.shopt.withAll(changes.shopt), variables: st.variables.withAll(changes.variables),
    functions: st.functions.withAll(changes.functions), aliases: st.aliases.withAll(changes.aliases),
    disabled: st.disabled.withAll(changes.disabled), hashed: st.hashed.withAll(changes.hashed),
  };
}

/**
 * The state after a call of `def` that the walk does not walk (recursive, too deep, past the walks of a body): what
 * its body changes is not known, and is a change of the body that calls it too (`Walker.short` checks it was all).
 */
export function notWalked(w: Walker, def: SyntaxNode, st: ShellState): ShellState {
  const keys = w.changes.get(def) ?? new Set<string>();
  w.changes.set(def, keys);
  w.widened.push({ def, size: keys.size });
  for (const key of [...keys]) {
    w.lastChange.set(key, ++w.changeCount);
    for (const c of w.collecting) c.add(key);
  }
  return widen(w, st, keys);
}

/**
 * The function definitions called from the body of one that a call did not walk (`notWalked`: that call runs them
 * with states no walk saw), and those they call, in turn.
 */
export function unsettledBodies(w: Walker): ReadonlySet<SyntaxNode> {
  const bad = new Set(w.widened.map((x) => x.def));
  const inside = (site: SyntaxNode): boolean => {
    for (let x = site.parent; x; x = x.parent) if (bad.has(x)) return true;
    return false;
  };
  for (let more = true; more;) {
    more = false;
    for (const [def, sites] of w.calls) {
      if (!bad.has(def) && [...sites.keys()].some(inside)) {
        bad.add(def);
        more = true;
      }
    }
  }
  return bad;
}
