// The shell state the walk carries (src/semantics/walk/walker.ts; the model, src/semantics/state.ts): the options, variables, functions, aliases and command
// entries at a place, as persistent maps, and how the states of several paths merge.
import type { SyntaxNode } from '../syntax/tree';
import type { Shell } from '../dialect';
import { usualEnvironment } from '../dict/syntax';
import { usuallyInEnvironment } from './vars';

/** On, off, or decided at run time (a branch, a loop, a function that may be defined). */
export type Tri = 'on' | 'off' | 'unknown';
/**
 * An option: on or off on every path to here; `default` when the script has not changed it (bash's default for
 * a script, unless a file read with `source` changes it); `unknown` when only some paths change it.
 */
export type OptionState = Tri | 'default';

/** An attribute of a variable (a letter of `declare -p`: a, A, i, n, r, x, l, u, t) and the node that last gave or removed it. */
/**
 * The state of an attribute, and the node that set it. `environment`, of the export attribute (`x`) only: the
 * script had neither set nor declared the variable before (no `unset`, `local`, `export -n` on the way), so it may be
 * the variable the shell got from the environment, which is exported (`environmentHas`: how likely); the state is
 * then `unknown`, or `off` for a name the environment is unlikely to have (one in lower case). `atMost`: on some
 * paths the script removed it or its export (`if …; then unset HOME; fi`, see `merge`), so it is exported at most
 * when the environment had it, not always then.
 */
export interface Attribute { readonly state: Tri; readonly at: SyntaxNode; readonly environment?: Exclude<FromEnvironment, 'no'>; readonly atMost?: true }

export interface VariableState {
  /** Whether it exists (`declare -p` shows it): declared, with or without a value. */
  readonly declared: Tri;
  /** Whether it has a value (`declare x` and `local x` declare it without one; `unset` removes both). */
  readonly set: Tri;
  readonly attrs: Readonly<Record<string, Attribute>>;
  /** Its value, when it is a scalar whose text is known here (for a nameref, the name it refers to). */
  readonly value?: string;
  /**
   * When the value is not static text, the value word of the plain assignment (`x=$y`, `declare x=$y`) that gave it, on
   * every path to here: src/semantics/words.ts expands it where it ran.
   */
  readonly source?: SyntaxNode;
  /**
   * Its value may be text the script did not write: on a path where the script had not set it (from the environment),
   * or made from such a value (`a="$b"`, `n+=1`, `${n:=0}`). Arithmetic must not read it (`Walker.unsetRead`).
   */
  readonly kept?: true;
  /** The node that last changed it (after a merge, the latest in the source). */
  readonly at: SyntaxNode;
}

export interface FunctionState {
  /** `unknown`: defined on some paths only. */
  readonly state: Tri;
  /** The definition in effect (after a merge, the latest in the source). */
  readonly def: SyntaxNode;
  /** `export -f`. */
  readonly exported: Tri;
  /** `readonly -f`. */
  readonly readonly: Tri;
  /** The `unset -f` that removed it (with `state` off). */
  readonly removed?: SyntaxNode;
  /**
   * In another shell, a function of the script it may have: given to `sh`, which may be dash (`sh`), or one only its
   * startup files would define (`startup`).
   */
  readonly imported?: 'sh' | 'startup';
}

export interface AliasState {
  readonly state: Tri;
  /** What it stands for: the text after `=`, without its quotes. */
  readonly value: string;
  /** The `alias` command. */
  readonly at: SyntaxNode;
}

/** A name the command search treats apart: a builtin turned off (`enable -n`), or a path remembered (`hash -p`). */
export interface CommandEntry {
  readonly state: Tri;
  /** `hash -p`: the path (empty when it is known only at run time, `hash -p "$p" x`). */
  readonly value: string;
  /** The command that made it so. */
  readonly at: SyntaxNode;
}


// ---------------------------------------------------------------------------------------------------
// Persistent maps: a change copies one bucket, and a merge visits only the buckets that differ.

const BUCKETS = 32;
const bucketOf = (k: string): number => {
  let h = 0;
  for (let i = 0; i < k.length; i++) h = (h * 31 + k.charCodeAt(i)) | 0;
  return (h >>> 0) % BUCKETS;
};

/** An immutable map of names; one that shares buckets with another is cheap to compare and merge with it. */
export class NameMap<V> implements ReadonlyMap<string, V> {
  private constructor(private readonly buckets: readonly (ReadonlyMap<string, V> | undefined)[], readonly size: number) {}

  static empty<V>(): NameMap<V> {
    return new NameMap<V>(new Array(BUCKETS).fill(undefined), 0);
  }

  get(k: string): V | undefined {
    return this.buckets[bucketOf(k)]?.get(k);
  }

  has(k: string): boolean {
    return !!this.buckets[bucketOf(k)]?.has(k);
  }

  /** The map with `k` set to `v` (or removed, when `v` is undefined). */
  with(k: string, v: V | undefined): NameMap<V> {
    const i = bucketOf(k);
    const old = this.buckets[i];
    // (No value is undefined: a name that is not there and one to remove are the same.)
    if (old?.get(k) === v) return this;
    const b = new Map(old ?? []);
    const had = b.has(k);
    if (v === undefined) b.delete(k);
    else b.set(k, v);
    const buckets = this.buckets.slice();
    buckets[i] = b.size ? b : undefined;
    return new NameMap(buckets, this.size + (v === undefined ? -1 : had ? 0 : 1));
  }

  /** The map with every name of `changes` set to its value. */
  withAll(changes: ReadonlyMap<string, V>): NameMap<V> {
    if (!changes.size) return this;
    const buckets = this.buckets.slice();
    const copied = new Set<number>();
    let size = this.size;
    for (const [k, v] of changes) {
      const i = bucketOf(k);
      if (!copied.has(i)) {
        copied.add(i);
        buckets[i] = new Map(buckets[i] ?? []);
      }
      const b = buckets[i] as Map<string, V>;
      if (!b.has(k)) size++;
      b.set(k, v);
    }
    return new NameMap(buckets, size);
  }

  *entries(): MapIterator<[string, V]> {
    for (const b of this.buckets) if (b) yield* b;
  }

  *keys(): MapIterator<string> {
    for (const [k] of this.entries()) yield k;
  }

  *values(): MapIterator<V> {
    for (const [, v] of this.entries()) yield v;
  }

  [Symbol.iterator](): MapIterator<[string, V]> {
    return this.entries();
  }

  forEach(f: (v: V, k: string, m: ReadonlyMap<string, V>) => void): void {
    for (const [k, v] of this.entries()) f(v, k, this);
  }

  /**
   * The map of the values `f` gives (a name it gives none of is left out). `memo` keeps what each bucket gives, so
   * maps that share buckets share the work and the result; `f` must depend on its arguments only.
   */
  mapped<W>(f: (k: string, v: V) => W | undefined, memo: WeakMap<object, ReadonlyMap<string, W>>): NameMap<W> {
    let size = 0;
    const buckets = this.buckets.map((b) => {
      if (!b) return undefined;
      let m = memo.get(b);
      if (!m) {
        const out = new Map<string, W>();
        for (const [k, v] of b) {
          const w = f(k, v);
          if (w !== undefined) out.set(k, w);
        }
        memo.set(b, (m = out));
      }
      size += m.size;
      return m.size ? m : undefined;
    });
    return new NameMap(buckets, size);
  }

  /** The two maps merged with `f` for the names whose values are not the same object. */
  static merge<V>(a: NameMap<V>, b: NameMap<V>, f: (k: string, x: V | undefined, y: V | undefined) => V): NameMap<V> {
    if (a === b) return a;
    let size = 0;
    const buckets = a.buckets.map((x, i) => {
      const y = b.buckets[i];
      if (x === y) {
        size += x?.size ?? 0;
        return x;
      }
      const m = new Map<string, V>();
      let sameAsX = true;
      for (const k of new Set([...(x?.keys() ?? []), ...(y?.keys() ?? [])])) {
        const vx = x?.get(k);
        const vy = y?.get(k);
        const v = vx === vy ? vx! : f(k, vx, vy);
        if (v !== vx) sameAsX = false;
        m.set(k, v);
      }
      size += m.size;
      return sameAsX && x && x.size === m.size ? x : m;
    });
    return new NameMap(buckets, size);
  }

  /** Whether the two maps hold equal values (by `eq`) under the same names. */
  static same<V>(a: NameMap<V>, b: NameMap<V>, eq: (x: V, y: V) => boolean): boolean {
    if (a === b) return true;
    if (a.size !== b.size) return false;
    return a.buckets.every((x, i) => {
      const y = b.buckets[i];
      if (x === y) return true;
      if (!x || !y || x.size !== y.size) return false;
      for (const [k, v] of x) {
        const w = y.get(k);
        if (w === undefined || !eq(v, w)) return false;
      }
      return true;
    });
  }
}

/** The state of the shell at a place. A name not in a map has not been changed by the script. */
export interface ShellState {
  /** `set -o` options, by long name (`errexit`, `noglob`, `posix`…). */
  readonly set: NameMap<OptionState>;
  /** `shopt` options. */
  readonly shopt: NameMap<OptionState>;
  readonly variables: NameMap<VariableState>;
  readonly functions: NameMap<FunctionState>;
  readonly aliases: NameMap<AliasState>;
  /** The builtins `enable -n` turned off (`on`: off as a builtin). */
  readonly disabled: NameMap<CommandEntry>;
  /** The names `hash -p` gave a path (assigning PATH, `hash -r` and `hash -d` forget them). */
  readonly hashed: NameMap<CommandEntry>;
  /** The exit status of the last command run (`$?`), when it is known (docs/design/semantics.md, 4.14). */
  readonly status?: number;
  /**
   * Why errexit has its value in the command substitution this state runs in, when that comes from the `$( )` and
   * not from a `set` in it (manual 4.3.1, 6.11): bash turned it off there (`off-in-substitution`), or kept it on
   * because inherit_errexit is on (`inherit_errexit`, or `posix`: POSIX mode turned it on). Function bodies called
   * there carry it too; a `set -e` or `set +e` clears it.
   */
  readonly errexitWhy?: ErrexitWhy;
  /**
   * Set on the state of a path that never gets here: after `break`, `continue`, `return` or `exit` (and an error
   * under `set -e`). What runs from it is dead code; merging drops it.
   */
  readonly unreachable?: true;
  /**
   * Set on the state of a path that ran what the walk does not read (a sourced file, a string of `eval` or a trap's
   * action that is not static text, the startup files of another shell): there a name the script has not set may be
   * set. Merging keeps it: such a path may have been taken.
   */
  readonly opaque?: true;
}

/** Why errexit has its value in a `$( )` (`ShellState.errexitWhy`). */
export type ErrexitWhy = 'off-in-substitution' | 'inherit_errexit' | 'posix';

/** The options bash has on in a script (`bash --norc script`), and the ones POSIX mode adds. */
const DEFAULT_ON = {
  set: new Set(['braceexpand', 'hashall', 'interactive-comments']),
  shopt: new Set(['checkwinsize', 'cmdhist', 'complete_fullquote', 'extquote', 'force_fignore', 'globasciiranges', 'globskipdots', 'hostcomplete',
    'interactive_comments', 'patsub_replacement', 'progcomp', 'promptvars', 'sourcepath']),
};
export const POSIX_ON = { set: ['posix'], shopt: ['expand_aliases', 'inherit_errexit', 'shift_verbose'] };

/** Whether bash has option `name` on when a script starts (in POSIX mode with `posix`). */
export function defaultOn(kind: 'set' | 'shopt', name: string, posix = false): boolean {
  return DEFAULT_ON[kind].has(name) || (posix && POSIX_ON[kind].includes(name));
}

/** The state of option `name` (`default` when the script has not changed it). */
export function option(st: ShellState, kind: 'set' | 'shopt', name: string): OptionState {
  return st[kind].get(name) ?? 'default';
}

/**
 * The state of bash's `shopt` option `name` in the shell `shell` (bash when absent). zsh always reads `**` at any
 * depth (globstar is on), ksh93 has it as `set -o globstar`; the other options, and the other shells, have none
 * (`unsupported`).
 */
export function shoptIn(st: ShellState, name: string, shell: Shell | undefined): OptionState | 'unsupported' {
  if (!shell || shell === 'bash') return option(st, 'shopt', name);
  if (name === 'globstar' && shell === 'zsh') return 'on';
  if (name === 'globstar' && shell === 'ksh') return option(st, 'set', 'globstar');
  return 'unsupported';
}

/**
 * Whether a variable may come from the environment, and how likely: `usually`, a name the environment almost always
 * has (bash's `HOME`, `PATH`, `TERM`: `BashVariable.environment`; and `USER`: `usualEnvironment`); `maybe`, another name in capitals, which by custom is the
 * environment's; `unlikely`, a name with lower case, which POSIX leaves to the script's own variables (bash still
 * passes `env foo=x`); `no`, the script removed it (`unset`, `local`, `export -n`) or it is an array, which is never
 * exported.
 */
export type FromEnvironment = 'usually' | 'maybe' | 'unlikely' | 'no';

/** How likely the environment has a variable named `name`, by its name alone (`FromEnvironment`). */
export function environmentHas(name: string): Exclude<FromEnvironment, 'no'> {
  return usuallyInEnvironment(name) || usualEnvironment.has(name) ? 'usually' : /^[A-Z_][A-Z0-9_]*$/.test(name) ? 'maybe' : 'unlikely';
}

/** The export attribute a variable the script had neither set nor declared gets when it first sets it, at `at` (`Attribute.environment`). */
export function exportFromEnvironment(name: string, at: SyntaxNode): Attribute {
  const environment = environmentHas(name);
  return { state: environment === 'unlikely' ? 'off' : 'unknown', at, environment };
}

/**
 * Whether the variable `name` may come from the environment in `st`, and how likely (`FromEnvironment`): the only
 * source of this fact. Two facts are kept apart: its `value`, where the script gave it none (`set -u`'s unset reads:
 * not after `unset` or `local`; `declare x` keeps the environment's), and its `export` attribute, where the script set
 * it without exporting it (`local FOO` keeps the export of the environment's `FOO`, not its value). A name the host
 * gives (`StateModel.provides`: a CI's `GITHUB_SHA`, a Dockerfile's `ARG`, a placeholder) is `usually` the
 * environment's, unless the script removed it.
 */
export function fromEnvironment(name: string, st: ShellState, what: 'value' | 'export', provides: (name: string) => boolean = () => false): FromEnvironment {
  const v = st.variables.get(name);
  const has = provides(name) ? 'usually' : environmentHas(name);
  if (!v) return has;
  if (['a', 'A'].some((l) => (v.attrs[l]?.state ?? 'off') !== 'off')) return 'no';
  if (what === 'value') return v.kept && v.set !== 'on' ? has : 'no';
  return v.attrs.x?.environment ? (provides(name) ? 'usually' : v.attrs.x.environment) : 'no';
}

/**
 * The value of `name` in the environment of a program the shell starts in `st`, when the shell got `inherited(name)`
 * from its own environment (undefined: none; null: not known): undefined when the program gets none (not exported,
 * `export -n`, `unset`, an array, or exported with no value: `declare -x OLDPWD`), null when that is not known
 * (exported on some paths only, removed on some paths only, a value not known here, a nameref, which exports the
 * variable it names). A variable the script set without exporting it is exported when the shell got it from its
 * environment (`PATH=/bin`: `fromEnvironment`); `set -a` exports it.
 */
export function exportedValue(st: ShellState, name: string, inherited: (name: string) => string | undefined | null): string | undefined | null {
  const v = st.variables.get(name);
  const got = inherited(name);
  if (!v) return got;
  const array = ['a', 'A'].map((l) => v.attrs[l]?.state ?? 'off');
  if (array.includes('on')) return undefined;
  if (array.includes('unknown') || (v.attrs.n?.state ?? 'off') !== 'off') return null;
  const x = v.attrs.x?.state ?? 'off';
  if (x === 'off') return undefined;
  if (x === 'unknown') {
    // (Exported on some paths only; or, `atMost`, removed on some paths only: `if …; then unset HOME; fi`, see `merge`.)
    if (fromEnvironment(name, st, 'export') === 'no' || got === null) return null;
    if (got === undefined) return undefined;
    if (v.attrs.x!.atMost) return null;
  }
  // (Unset on some paths, and left as the shell started on others: the environment's, when it has one.)
  if (v.set === 'off') return v.kept && got !== undefined ? null : undefined;
  return v.set === 'on' && v.value !== undefined ? v.value : null;
}

/** The state of attribute `letter` of variable `name`. */
export function attribute(st: ShellState, name: string, letter: string): Tri {
  return st.variables.get(name)?.attrs[letter]?.state ?? 'off';
}

export type Kind = Exclude<keyof ShellState, 'status' | 'unreachable' | 'errexitWhy' | 'opaque'>;
export type Entry<K extends Kind> = ShellState[K] extends NameMap<infer V> ? V : never;

export const EMPTY: ShellState = {
  set: NameMap.empty(), shopt: NameMap.empty(), variables: NameMap.empty(), functions: NameMap.empty(), aliases: NameMap.empty(), disabled: NameMap.empty(), hashed: NameMap.empty(),
};

/** `st` with the status `status` (undefined: not known). */
export const withStatus = (st: ShellState, status: number | undefined): ShellState => (st.status === status ? st : { ...st, status });

/** `st` as the state of a path that never gets further (see `ShellState.unreachable`). */
export const unreachable = (st: ShellState): ShellState => ({ ...st, status: undefined, unreachable: true });

/** `st` as a path that gets here (for walking dead code from it). */
export const reached = (st: ShellState): ShellState => {
  if (!st.unreachable) return st;
  const { unreachable: _, ...rest } = st;
  return rest;
};

const later = (a: SyntaxNode, b: SyntaxNode): SyntaxNode => (b.startIndex > a.startIndex ? b : a);
export const tri = (a: Tri, b: Tri): Tri => (a === b ? a : 'unknown');

export function mergeOption(kind: 'set' | 'shopt', name: string, a: OptionState | undefined, b: OptionState | undefined, posix: boolean): OptionState {
  const x = a ?? 'default';
  const y = b ?? 'default';
  if (x === y) return x;
  // Turned to its default value on one path, left alone on the other: still the default.
  const def = defaultOn(kind, name, posix) ? 'on' : 'off';
  if ((x === 'default' && y === def) || (y === 'default' && x === def)) return 'default';
  return 'unknown';
}

function mergeVariable(name: string, a: VariableState | undefined, b: VariableState | undefined): VariableState {
  // Changed on one path only: the other left it as the shell started, set and exported only when the environment had
  // it (`kept`, `exportFromEnvironment`), so the merge is set at most where either path sets it, and exported at most
  // where either exports it: where the changed path removed it or its export, at most when the environment had it.
  if (!a || !b) {
    const v = (a ?? b)!;
    const attrs: Record<string, Attribute> = {};
    for (const [l, x] of Object.entries(v.attrs)) attrs[l] = { state: tri(x.state, 'off'), at: x.at, ...(x.environment ? { environment: x.environment } : {}), ...(x.atMost ? { atMost: true as const } : {}) };
    const start = exportFromEnvironment(name, v.at);
    const x = v.attrs.x;
    // (`if …; then unset Y; fi`: on neither path is `Y` exported unless the environment had it, as after a first `Y=1`.)
    if (start.state !== 'off' && (!x || x.state === 'off')) attrs.x = { state: 'unknown', at: x?.at ?? v.at, environment: start.environment!, atMost: true };
    return { declared: tri(v.declared, 'off'), set: tri(v.set, 'off'), attrs, at: v.at, kept: true };
  }
  const attrs: Record<string, Attribute> = {};
  for (const l of new Set([...Object.keys(a.attrs), ...Object.keys(b.attrs)])) {
    const x = a.attrs[l];
    const y = b.attrs[l];
    // (From the environment only when it may be on both paths.)
    attrs[l] = x && y ? { state: tri(x.state, y.state), at: later(x.at, y.at), ...(x.environment && y.environment ? { environment: x.environment, ...(x.atMost || y.atMost ? { atMost: true as const } : {}) } : {}) } : { state: tri((x ?? y)!.state, 'off'), at: (x ?? y)!.at };
  }
  const source = a.source === b.source ? a.source : undefined;
  return { declared: tri(a.declared, b.declared), set: tri(a.set, b.set), attrs, value: a.value === b.value ? a.value : undefined, ...(source ? { source } : {}), at: later(a.at, b.at), ...(a.kept || b.kept ? { kept: true as const } : {}) };
}

function mergeFunction(a: FunctionState | undefined, b: FunctionState | undefined): FunctionState {
  if (!a || !b) {
    const f = (a ?? b)!;
    return { ...f, state: tri(f.state, 'off'), exported: tri(f.exported, 'off'), readonly: tri(f.readonly, 'off') };
  }
  return { state: tri(a.state, b.state), def: later(a.def, b.def), exported: tri(a.exported, b.exported), readonly: tri(a.readonly, b.readonly) };
}

function mergeAlias<T extends AliasState | CommandEntry>(a: T | undefined, b: T | undefined): T {
  if (!a || !b) {
    const x = (a ?? b)!;
    return { ...x, state: tri(x.state, 'off') };
  }
  const newer = later(a.at, b.at) === a.at ? a : b;
  return { ...newer, state: a.value === b.value ? tri(a.state, b.state) : 'unknown' };
}

/** The state after one of several paths, when any of them may have been taken. */
export function merge(states: ShellState[], posix = false): ShellState {
  // (A path that never gets here adds nothing; when none does, the result never gets here either.)
  const paths = states.filter((s) => !s.unreachable);
  if (!paths.length) return states[0];
  return paths.reduce((a, b) => (a === b ? a : {
    set: NameMap.merge(a.set, b.set, (k, x, y) => mergeOption('set', k, x, y, posix)),
    shopt: NameMap.merge(a.shopt, b.shopt, (k, x, y) => mergeOption('shopt', k, x, y, posix)),
    variables: NameMap.merge(a.variables, b.variables, (k, x, y) => mergeVariable(k, x, y)),
    functions: NameMap.merge(a.functions, b.functions, (_k, x, y) => mergeFunction(x, y)),
    aliases: NameMap.merge(a.aliases, b.aliases, (_k, x, y) => mergeAlias(x, y)),
    disabled: NameMap.merge(a.disabled, b.disabled, (_k, x, y) => mergeAlias(x, y)),
    hashed: NameMap.merge(a.hashed, b.hashed, (_k, x, y) => mergeAlias(x, y)),
    ...(a.status === b.status && a.status !== undefined ? { status: a.status } : {}),
    ...mergeErrexitWhy(a.errexitWhy, b.errexitWhy),
    ...(a.opaque || b.opaque ? { opaque: true as const } : {}),
  }));
}

/** `st` without a reason for errexit from a `$( )`. */
export function withoutErrexitWhy(st: ShellState): ShellState {
  if (!st.errexitWhy) return st;
  const { errexitWhy: _, ...rest } = st;
  return rest;
}

/**
 * The reason errexit has its value after paths that give `a` and `b`: the same, or `off-in-substitution` when one
 * of them is (a function called both in `$( )` and outside it); otherwise none.
 */
export function mergeErrexitWhy(a: ErrexitWhy | undefined, b: ErrexitWhy | undefined): { errexitWhy?: ErrexitWhy } {
  const why = a === b ? a : a === 'off-in-substitution' || b === 'off-in-substitution' ? 'off-in-substitution' : undefined;
  return why ? { errexitWhy: why } : {};
}

/** Whether two states say the same (the nodes where things changed aside). */
export function sameState(a: ShellState, b: ShellState): boolean {
  const attrs = (x: VariableState, y: VariableState): boolean => {
    const k = Object.keys(x.attrs);
    return k.length === Object.keys(y.attrs).length && k.every((l) => x.attrs[l].state === y.attrs[l]?.state && x.attrs[l].environment === y.attrs[l]?.environment);
  };
  return a === b || (a.status === b.status && !a.unreachable === !b.unreachable && !a.opaque === !b.opaque && a.errexitWhy === b.errexitWhy && NameMap.same(a.set, b.set, (x, y) => x === y) && NameMap.same(a.shopt, b.shopt, (x, y) => x === y)
    && NameMap.same(a.variables, b.variables, (x, y) => x === y || (x.declared === y.declared && x.set === y.set && x.value === y.value && !x.kept === !y.kept && attrs(x, y)))
    && NameMap.same(a.functions, b.functions, (x, y) => x === y || (x.state === y.state && x.def === y.def && x.exported === y.exported && x.readonly === y.readonly))
    && NameMap.same(a.aliases, b.aliases, (x, y) => x === y || (x.state === y.state && x.value === y.value))
    && NameMap.same(a.disabled, b.disabled, (x, y) => x === y || x.state === y.state)
    && NameMap.same(a.hashed, b.hashed, (x, y) => x === y || (x.state === y.state && x.value === y.value)));
}
