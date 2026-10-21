// The shell state along a script (docs/design/semantics.md, 4.3, 4.7 and step B1): the options of `set` and
// `shopt`, the variables and their attributes, the functions and the aliases that apply at each node.
//
// One walk over the tree, in source order, carries a `ShellState`. Commands that change the state (`set`,
// `shopt`, `alias`, `unalias`, `unset`, the declaration builtins, `read`, `mapfile`, `getopts`, `printf -v`,
// assignments, function definitions and calls) are read with their builtin's spec (src/argv/).
//
// - A subshell gets the state and drops what it changes: `( )`, `$( )`, `<( )`, a background job, a coproc,
//   and every stage of a pipeline but the last one with lastpipe on and job control off.
// - The branches of `if`, `case`, `&&` and `||` start from the same state and are merged after; a value that
//   differs becomes `unknown`. A loop body is walked until its state no longer changes, then merged with the
//   state before the loop (it may not run).
// - A function body is walked where the function is called, from the caller's state (once per state: the
//   walks are remembered); its locals and its temporaries (`x=1 f`) are restored when it returns. A function
//   that no call reaches is walked from its definition's state, with what the script changes after the
//   definition taken as unknown. A node of a body walked more than once has the merge of its states.
// - bash reads a whole line, or a whole compound command, before it runs any of it: aliases and extglob count
//   from the next such unit on (`parse`), the other options from the next command (`run`). A command
//   substitution is read again when it runs, so its aliases are those of its run state (`expand`).
//
// The model is built once per tree (and shell) and cached.
import { evalArith } from '../arith';
import { interpret, type ArgRole, type ArgvParse } from '../argv/interpret';
import { argWord, prefixOf } from '../argv/words';
import type { Shell } from '../dialect';
import { builtins } from '../dict/builtins';
import { staticWordValue } from '../staticword';
import { createUnbashParser } from '../syntax/adapters/unbash';
import { descendants, field, fields, type BashParser, type SyntaxNode, type SyntaxTree } from '../syntax/tree';
import { EnvModel, type ExecEnv, lastStageInShell, STATEMENTS, subshellReasons } from './env';

export { lastStageInShell } from './env';

/** On, off, or decided at run time (a branch, a loop, a function that may be defined). */
export type Tri = 'on' | 'off' | 'unknown';
/**
 * An option: on or off on every path to here; `default` when the script has not changed it (bash's default for
 * a script, unless a file read with `source` changes it); `unknown` when only some paths change it.
 */
export type OptionState = Tri | 'default';

/** An attribute of a variable (a letter of `declare -p`: a, A, i, n, r, x, l, u, t) and the node that last gave or removed it. */
export interface Attribute { readonly state: Tri; readonly at: SyntaxNode }

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
}

export interface AliasState {
  readonly state: Tri;
  /** What it stands for: the text after `=`, without its quotes. */
  readonly value: string;
  /** The `alias` command. */
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
}

export interface StateModel {
  /**
   * `run`: the state before `n` runs; `parse`: the state when bash read the unit that holds it (extglob);
   * `expand`: the state its aliases come from (`parse`, or the run state of the command substitution that holds it).
   */
  at(n: SyntaxNode): { run: ShellState; parse: ShellState; expand: ShellState };
  /** The state at the end of the script. */
  readonly end: ShellState;
  /** The variables some command of the script sets, wherever it runs. */
  readonly assigned: ReadonlySet<string>;
  /** Where `n` runs (src/semantics/env.ts): the main shell, a subshell, or a command run through slots. */
  env(n: SyntaxNode): ExecEnv;
  /**
   * The commands that call each function definition (those its state reaches; through an alias, `eval` or a trap,
   * the command that runs it), and whether the function is surely defined there.
   */
  readonly calls: ReadonlyMap<SyntaxNode, ReadonlyMap<SyntaxNode, boolean>>;
  /** The commands of the script that define each function and alias, in source order, wherever they run. */
  readonly definitions: { readonly functions: ReadonlyMap<string, readonly SyntaxNode[]>; readonly aliases: ReadonlyMap<string, readonly SyntaxNode[]> };
}

/** The options bash has on in a script (`bash --norc script`), and the ones POSIX mode adds. */
const DEFAULT_ON = {
  set: new Set(['braceexpand', 'hashall', 'interactive-comments']),
  shopt: new Set(['checkwinsize', 'cmdhist', 'complete_fullquote', 'extquote', 'force_fignore', 'globasciiranges', 'globskipdots', 'hostcomplete',
    'interactive_comments', 'patsub_replacement', 'progcomp', 'promptvars', 'sourcepath']),
};
const POSIX_ON = { set: ['posix'], shopt: ['expand_aliases', 'inherit_errexit', 'shift_verbose'] };

/** Whether bash has option `name` on when a script starts (in POSIX mode with `posix`). */
export function defaultOn(kind: 'set' | 'shopt', name: string, posix = false): boolean {
  return DEFAULT_ON[kind].has(name) || (posix && POSIX_ON[kind].includes(name));
}

/** The state of option `name` (`default` when the script has not changed it). */
export function option(st: ShellState, kind: 'set' | 'shopt', name: string): OptionState {
  return st[kind].get(name) ?? 'default';
}

/** The state of attribute `letter` of variable `name`. */
export function attribute(st: ShellState, name: string, letter: string): Tri {
  return st.variables.get(name)?.attrs[letter]?.state ?? 'off';
}

/** `set` letters and the options they stand for. */
const SET_LETTERS: Record<string, string> = {
  a: 'allexport', b: 'notify', e: 'errexit', f: 'noglob', h: 'hashall', k: 'keyword', m: 'monitor', n: 'noexec', p: 'privileged',
  t: 'onecmd', u: 'nounset', v: 'verbose', x: 'xtrace', B: 'braceexpand', C: 'noclobber', E: 'errtrace', H: 'histexpand', P: 'physical', T: 'functrace',
};
/** The attributes the declaration builtins give with their options. */
const ATTRIBUTE_LETTERS = new Set(['a', 'A', 'i', 'l', 'n', 'r', 't', 'u', 'x']);
const DECLARATIONS = new Set(['declare', 'typeset', 'local', 'export', 'readonly']);
/** The shells that start in POSIX mode (for what the model follows: assignments before special builtins). */
const POSIX_SHELLS = new Set<Shell>(['sh', 'dash', 'ash', 'yash', 'ksh', 'mksh']);
const NAME = /^[A-Za-z_]\w*$/;

const SUBSTITUTIONS = ['command_substitution', 'process_substitution'];

// ---------------------------------------------------------------------------------------------------
// Declarations, read with their builtin's spec.

export interface Declaration {
  /** The role of each word (the options end at the first name or at `--`). */
  roles: Map<SyntaxNode, ArgRole>;
  /** The letters of the options turned on (`ix` of `declare -ix`), and of those turned off (`x` of `declare +x`). */
  on: string;
  off: string;
}

/** The words of a declaration command `builtin` read with its spec. */
function readDeclarationWords(builtin: string, words: SyntaxNode[]): Declaration {
  const parse = interpret(builtins[builtin], words.map(argWord), { name: builtin });
  const roles = new Map(parse.roles.map(({ word, role }) => [words[word], role]));
  let on = '';
  let off = '';
  for (const r of optionRoles(parse)) {
    if (r.disables) off += r.flag.slice(1);
    else on += r.flag.slice(1);
  }
  return { roles, on, off };
}

const declarations = new WeakMap<SyntaxNode, Declaration>();
/** A declaration command (`declare -ix -- a=1 b`) read with its builtin's spec. */
export function readDeclaration(d: SyntaxNode): Declaration {
  const seen = declarations.get(d);
  if (seen) return seen;
  const out = readDeclarationWords(d.children[0].type, d.namedChildren.filter((c) => !c.type.endsWith('redirect')));
  declarations.set(d, out);
  return out;
}

/** The options of a parse, one per letter of a cluster. */
const optionRoles = (parse: ArgvParse): Extract<ArgRole, { role: 'option' }>[] =>
  parse.roles.flatMap((r) => (r.role.role === 'cluster' ? r.role.letters : [r.role])).filter((r): r is Extract<ArgRole, { role: 'option' }> => r.role === 'option');

// ---------------------------------------------------------------------------------------------------
// Merging states.

type Kind = keyof ShellState;
type Entry<K extends Kind> = ShellState[K] extends NameMap<infer V> ? V : never;

const EMPTY: ShellState = { set: NameMap.empty(), shopt: NameMap.empty(), variables: NameMap.empty(), functions: NameMap.empty(), aliases: NameMap.empty() };

const later = (a: SyntaxNode, b: SyntaxNode): SyntaxNode => (b.startIndex > a.startIndex ? b : a);
const tri = (a: Tri, b: Tri): Tri => (a === b ? a : 'unknown');

function mergeOption(kind: 'set' | 'shopt', name: string, a: OptionState | undefined, b: OptionState | undefined, posix: boolean): OptionState {
  const x = a ?? 'default';
  const y = b ?? 'default';
  if (x === y) return x;
  // Turned to its default value on one path, left alone on the other: still the default.
  const def = defaultOn(kind, name, posix) ? 'on' : 'off';
  if ((x === 'default' && y === def) || (y === 'default' && x === def)) return 'default';
  return 'unknown';
}

function mergeVariable(a: VariableState | undefined, b: VariableState | undefined): VariableState {
  // Changed on one path only (the other may have it from the environment): nothing about it is sure.
  if (!a || !b) {
    const v = (a ?? b)!;
    const attrs: Record<string, Attribute> = {};
    for (const [l, x] of Object.entries(v.attrs)) attrs[l] = { state: tri(x.state, 'off'), at: x.at };
    return { declared: tri(v.declared, 'off'), set: tri(v.set, 'off'), attrs, at: v.at };
  }
  const attrs: Record<string, Attribute> = {};
  for (const l of new Set([...Object.keys(a.attrs), ...Object.keys(b.attrs)])) {
    const x = a.attrs[l];
    const y = b.attrs[l];
    attrs[l] = x && y ? { state: tri(x.state, y.state), at: later(x.at, y.at) } : { state: tri((x ?? y)!.state, 'off'), at: (x ?? y)!.at };
  }
  const source = a.source === b.source ? a.source : undefined;
  return { declared: tri(a.declared, b.declared), set: tri(a.set, b.set), attrs, value: a.value === b.value ? a.value : undefined, ...(source ? { source } : {}), at: later(a.at, b.at) };
}

function mergeFunction(a: FunctionState | undefined, b: FunctionState | undefined): FunctionState {
  if (!a || !b) {
    const f = (a ?? b)!;
    return { ...f, state: tri(f.state, 'off'), exported: tri(f.exported, 'off'), readonly: tri(f.readonly, 'off') };
  }
  return { state: tri(a.state, b.state), def: later(a.def, b.def), exported: tri(a.exported, b.exported), readonly: tri(a.readonly, b.readonly) };
}

function mergeAlias(a: AliasState | undefined, b: AliasState | undefined): AliasState {
  if (!a || !b) {
    const x = (a ?? b)!;
    return { ...x, state: tri(x.state, 'off') };
  }
  const newer = later(a.at, b.at) === a.at ? a : b;
  return { ...newer, state: a.value === b.value ? tri(a.state, b.state) : 'unknown' };
}

/** The state after one of several paths, when any of them may have been taken. */
export function merge(states: ShellState[], posix = false): ShellState {
  return states.reduce((a, b) => (a === b ? a : {
    set: NameMap.merge(a.set, b.set, (k, x, y) => mergeOption('set', k, x, y, posix)),
    shopt: NameMap.merge(a.shopt, b.shopt, (k, x, y) => mergeOption('shopt', k, x, y, posix)),
    variables: NameMap.merge(a.variables, b.variables, (_k, x, y) => mergeVariable(x, y)),
    functions: NameMap.merge(a.functions, b.functions, (_k, x, y) => mergeFunction(x, y)),
    aliases: NameMap.merge(a.aliases, b.aliases, (_k, x, y) => mergeAlias(x, y)),
  }));
}

/** Whether two states say the same (the nodes where things changed aside). */
function sameState(a: ShellState, b: ShellState): boolean {
  const attrs = (x: VariableState, y: VariableState): boolean => {
    const k = Object.keys(x.attrs);
    return k.length === Object.keys(y.attrs).length && k.every((l) => x.attrs[l].state === y.attrs[l]?.state);
  };
  return a === b || (NameMap.same(a.set, b.set, (x, y) => x === y) && NameMap.same(a.shopt, b.shopt, (x, y) => x === y)
    && NameMap.same(a.variables, b.variables, (x, y) => x === y || (x.declared === y.declared && x.set === y.set && x.value === y.value && attrs(x, y)))
    && NameMap.same(a.functions, b.functions, (x, y) => x === y || (x.state === y.state && x.def === y.def && x.exported === y.exported && x.readonly === y.readonly))
    && NameMap.same(a.aliases, b.aliases, (x, y) => x === y || (x.state === y.state && x.value === y.value)));
}

// ---------------------------------------------------------------------------------------------------
// The walk.

/** A function being run: the outer values of its locals (restored when it returns), and its set options with `local -`. */
interface Frame { def: SyntaxNode; saved: Map<string, VariableState | undefined>; options?: NameMap<OptionState> }

/** A word that declares or assigns a name: `x`, `x=1`, `x+=1`, `a[1]=x`, `a=(1 2)`, as a node or as static text. */
interface Operand {
  node: SyntaxNode;
  name: string;
  subscript: boolean;
  assign?: { append: boolean; text: string | undefined; array: boolean; source?: SyntaxNode };
}

/** How many times a function body is walked with different states before the rest of its calls are guessed. */
const WALKS_PER_FUNCTION = 4;
/** How deep calls are followed (deeper ones are guessed). */
const CALL_DEPTH = 64;

let aliasParser: BashParser | undefined;
const aliasTrees = new Map<string, SyntaxTree>();

class Walker {
  /** The states each node was run with (more than one in a loop or a function called more than once); merged when asked. */
  private readonly runStates = new Map<SyntaxNode, ShellState[]>();
  readonly parseAt = new Map<SyntaxNode, ShellState>();
  readonly functionDefs = new Map<string, SyntaxNode[]>();
  readonly aliasDefs = new Map<string, SyntaxNode[]>();
  /** The commands that call each function definition, and whether it is surely defined there on every walk. */
  readonly calls = new Map<SyntaxNode, Map<SyntaxNode, boolean>>();
  /** The command whose alias, `eval` string or trap action is being run (its nodes are in their own tree). */
  private aliasHost: SyntaxNode | undefined;
  /** The walks of each function body: the state it was called with, and the state after it. */
  private readonly walks = new Map<SyntaxNode, { entry: ShellState; exit: ShellState }[]>();
  /** What the walks of each function body changed. */
  private readonly changes = new Map<SyntaxNode, Set<string>>();
  /** The bodies being walked (a call of one of these is recursive). */
  private readonly stack: SyntaxNode[] = [];
  private readonly frames: Frame[] = [];
  /** The changes (`kind name`): how many so far, the number of the last change of each name and the node that made it, and the count at each definition. */
  private changeCount = 0;
  readonly lastChange = new Map<string, number>();
  private readonly lastAt = new Map<string, SyntaxNode>();
  private readonly changeAtDefinition = new Map<SyntaxNode, number>();
  /** The sets of the bodies being walked, which collect what they change. */
  private readonly collecting: Set<string>[] = [];
  /** The statement being run, and the state its aliases come from. */
  private node: SyntaxNode | undefined;
  private expand: ShellState = EMPTY;
  /** The aliases being expanded (an alias is not expanded again inside itself). */
  private readonly expanding = new Set<string>();
  private readonly bash: boolean;

  constructor(private readonly shell: Shell | undefined, private readonly posix: boolean) {
    this.bash = !shell || shell === 'bash';
  }

  private put<K extends Kind>(st: ShellState, kind: K, name: string, value: Entry<K> | undefined): ShellState {
    const key = `${kind} ${name}`;
    this.lastChange.set(key, ++this.changeCount);
    this.lastAt.set(key, this.node!);
    for (const c of this.collecting) c.add(key);
    return { ...st, [kind]: (st[kind] as NameMap<Entry<K>>).with(name, value) };
  }

  private record(n: SyntaxNode, st: ShellState): void {
    const states = this.runStates.get(n);
    if (!states) this.runStates.set(n, [st]);
    else if (!states.includes(st)) states.push(st);
  }

  /** The state `n` runs with: the merge of those it was run with. */
  runAt(n: SyntaxNode): ShellState | undefined {
    const states = this.runStates.get(n);
    if (states && states.length > 1) states.splice(0, states.length, merge(states, this.posix));
    return states?.[0];
  }

  initial(): ShellState {
    let st = EMPTY;
    if (this.posix) {
      for (const kind of ['set', 'shopt'] as const) for (const name of POSIX_ON[kind]) st = { ...st, [kind]: st[kind].with(name, 'on') };
    } else if (this.shell && POSIX_SHELLS.has(this.shell)) {
      st = { ...st, set: st.set.with('posix', 'on') };
    }
    return st;
  }

  program(root: SyntaxNode): ShellState {
    for (const f of descendants(root, ['function_definition'])) {
      const name = field(f, 'name')?.text;
      if (name) this.functionDefs.set(name, [...(this.functionDefs.get(name) ?? []), f]);
    }
    for (const c of descendants(root, ['command'])) {
      if (this.commandName(c) !== 'alias') continue;
      for (const a of fields(c, 'argument')) {
        const name = this.aliasOf(a)?.name;
        if (name) this.aliasDefs.set(name, [...(this.aliasDefs.get(name) ?? []), c]);
      }
    }
    // The units bash reads at once: the top-level statements that share a line.
    const tops = root.namedChildren.filter((c) => STATEMENTS.has(c.type));
    const unitStart = new Map<SyntaxNode, SyntaxNode>();
    tops.forEach((t, i) => unitStart.set(t, i > 0 && tops[i - 1].endPosition.row === t.startPosition.row ? unitStart.get(tops[i - 1])! : t));
    const end = this.sequence(root.children, this.initial(), (t, st) => {
      const unit = unitStart.get(t)!;
      this.parseAt.set(t, unit === t ? st : this.parseAt.get(unit)!);
      this.expand = this.parseAt.get(t)!;
    });
    this.uncalled();
    return end;
  }

  /**
   * The bodies no call reached: each is walked from its definition's state, with what the script changes after
   * the definition taken as unknown (it may be called from anywhere after it).
   */
  private uncalled(): void {
    for (let found = true; found;) {
      found = false;
      for (const defs of this.functionDefs.values()) {
        for (const def of defs) {
          const at = this.runAt(def);
          if (!at || this.walks.has(def)) continue;
          found = true;
          const since = this.changeAtDefinition.get(def)!;
          const after = new Set([...this.lastChange].filter(([, i]) => i > since).map(([k]) => k));
          this.walks.set(def, []);
          this.walkBody(def, this.widen(at, after), { def, saved: new Map() });
        }
      }
    }
  }

  /** `st` with the names in `keys` (`kind name`) taken as unknown. */
  private widen(st: ShellState, keys: Set<string>): ShellState {
    const changes = { set: new Map(), shopt: new Map(), variables: new Map(), functions: new Map(), aliases: new Map() } as { [K in Kind]: Map<string, Entry<K>> };
    for (const key of keys) {
      const kind = key.slice(0, key.indexOf(' ')) as Kind;
      const name = key.slice(kind.length + 1);
      if (kind === 'set' || kind === 'shopt') {
        if (st[kind].get(name) !== 'unknown') changes[kind].set(name, 'unknown');
      } else if (kind === 'variables') {
        const v = st.variables.get(name);
        if (!v) changes.variables.set(name, { declared: 'unknown', set: 'unknown', attrs: {}, at: this.lastAt.get(key)! });
        else if (v.declared !== 'unknown' || v.set !== 'unknown' || v.value !== undefined) changes.variables.set(name, { ...v, declared: 'unknown', set: 'unknown', value: undefined });
      } else if (kind === 'functions') {
        const f = st.functions.get(name);
        const defs = this.functionDefs.get(name)!;
        if (!f) changes.functions.set(name, { state: 'unknown', def: defs[defs.length - 1], exported: 'unknown', readonly: 'unknown' });
        else if (f.state !== 'unknown') changes.functions.set(name, { ...f, state: 'unknown' });
      } else {
        const a = st.aliases.get(name);
        const defs = this.aliasDefs.get(name);
        const def = defs?.[defs.length - 1];
        const value = def ? fields(def, 'argument').map((w) => this.aliasOf(w)).find((x) => x?.name === name)?.value : undefined;
        if (a) {
          if (a.state !== 'unknown') changes.aliases.set(name, { ...a, state: 'unknown' });
        } else if (def && value !== undefined) changes.aliases.set(name, { state: 'unknown', value, at: def });
      }
    }
    return {
      set: st.set.withAll(changes.set), shopt: st.shopt.withAll(changes.shopt), variables: st.variables.withAll(changes.variables),
      functions: st.functions.withAll(changes.functions), aliases: st.aliases.withAll(changes.aliases),
    };
  }

  /** Runs the statements among `nodes`, in order. */
  private sequence(nodes: readonly SyntaxNode[], st: ShellState, before?: (n: SyntaxNode, st: ShellState) => void): ShellState {
    for (const n of nodes) {
      if (!STATEMENTS.has(n.type)) continue;
      before?.(n, st);
      st = this.run(n, st);
    }
    return st;
  }

  /** The children of `n` after its token `from` and before the first child of a type in `to`. */
  private part(n: SyntaxNode, from: string, to: string[]): SyntaxNode[] {
    const kids = n.children;
    const out: SyntaxNode[] = [];
    for (let i = kids.findIndex((c) => !c.named && c.type === from) + 1; i < kids.length && !to.includes(kids[i].type); i++) out.push(kids[i]);
    return out;
  }

  /**
   * The state after `n` runs from `st`. A subshell (`( )`, `&`, a coproc's command, a pipeline stage but the last
   * one: src/semantics/env.ts) drops what it changes.
   */
  run(n: SyntaxNode, st: ShellState): ShellState {
    this.record(n, st);
    const outer = this.node;
    this.node = n;
    try {
      const after = this.runStatement(n, st);
      return subshellReasons(n).length ? st : after;
    } finally {
      this.node = outer;
    }
  }

  private runStatement(n: SyntaxNode, st: ShellState): ShellState {
    switch (n.type) {
      case 'command': return this.command(n, st);
      case 'declaration_command': {
        this.substitutions(n, st);
        const words = n.namedChildren.filter((c) => !c.type.endsWith('redirect'));
        return this.defaults(n, this.declare(n.children[0].type, words, readDeclaration(n), n, st));
      }
      case 'unset_command':
        this.substitutions(n, st);
        return this.unset(n.namedChildren, n, st);
      case 'variable_assignment':
        this.substitutions(n, st);
        return this.defaults(n, this.assignNode(n, st));
      case 'variable_assignments':
        for (const a of n.namedChildren) {
          this.record(a, st);
          this.substitutions(a, st);
          st = this.defaults(a, this.assignNode(a, st));
        }
        return st;
      case 'test_command': case 'extended_test': case 'arithmetic_command':
        this.substitutions(n, st);
        return this.defaults(n, st);
      case 'negated_command': case 'time_statement': case 'compound_statement':
        return this.sequence(n.children, st);
      case 'redirected_statement':
        for (const r of fields(n, 'redirect')) this.substitutions(r, st);
        return this.sequence(n.children.filter((c) => c.field !== 'redirect'), st);
      case 'subshell': case 'coproc_statement':
        return this.sequence(n.children, st);
      case 'pipeline': return this.pipeline(n, st);
      case 'list': {
        // (`a &&` while typing has no right side yet.)
        const [left, right] = n.namedChildren;
        const after = this.run(left, st);
        return right ? merge([after, this.run(right, after)], this.posix) : after;
      }
      case 'if_statement': return this.ifStatement(n, st);
      case 'case_statement': {
        this.substitutions(field(n, 'value')!, st);
        const ends: ShellState[] = [];
        let always = false;
        for (const item of n.namedChildren.filter((c) => c.type === 'case_item')) {
          for (const v of fields(item, 'value')) this.substitutions(v, st);
          ends.push(this.sequence(item.children, st));
          // A `*)` branch takes every value that reaches it.
          if (fields(item, 'value').some((v) => v.text === '*')) always = true;
        }
        return merge(always ? ends : [st, ...ends], this.posix);
      }
      case 'while_statement': {
        const body = field(n, 'body');
        const cond = n.children.filter((c) => c !== body);
        return this.loop(st, (s) => this.sequence(cond, s), (s) => this.sequence(body?.children ?? [], s), true);
      }
      case 'for_statement': case 'select_statement': return this.forStatement(n, st);
      case 'c_style_for_statement': {
        for (const c of n.namedChildren) if (c.type !== 'do_group') this.substitutions(c, st);
        const init = field(n, 'initializer');
        const name = init?.type === 'variable_assignment' ? field(init, 'name')?.text : undefined;
        if (name && init) st = this.setVariable(st, name, init, undefined);
        return this.loop(st, (s) => s, (s) => this.sequence(field(n, 'body')?.children ?? [], s), false);
      }
      case 'function_definition': return this.functionDefinition(n, st);
    }
    /* c8 ignore next 2 -- every statement type is handled above */
    return st;
  }

  /** Walks the command and process substitutions in `n` (not those of statements under it): each is a subshell. */
  private substitutions(n: SyntaxNode, st: ShellState): void {
    const sub = (c: SyntaxNode): void => {
      this.record(c, st);
      // A command substitution is read again when it runs: its aliases are those of the state then.
      const outer = this.expand;
      if (c.type === 'command_substitution') this.expand = st;
      this.sequence(c.children, st);
      this.expand = outer;
    };
    const visit = (x: SyntaxNode): void => {
      for (const c of x.children) {
        if (SUBSTITUTIONS.includes(c.type)) sub(c);
        else if (!STATEMENTS.has(c.type) || c.parent?.type === 'command' || c.parent?.type === 'declaration_command' || c.parent?.type === 'variable_assignments') visit(c);
      }
    };
    if (SUBSTITUTIONS.includes(n.type)) sub(n);
    else visit(n);
  }

  /** `${x:=word}` and `${x=word}` in the words of `n` set `x` (to a value not known here). */
  private defaults(n: SyntaxNode, st: ShellState): ShellState {
    for (const e of descendants(n, ['expansion'])) {
      if (!e.children.some((c) => c.type === ':=' || c.type === '=')) continue;
      let inner = false;
      for (let x = e.parent; x && x !== n; x = x.parent) if (SUBSTITUTIONS.includes(x.type)) inner = true;
      if (inner) continue;
      const name = e.namedChildren[0];
      if (name?.type === 'variable_name') st = this.setVariable(st, name.text, e, undefined);
    }
    return st;
  }

  private pipeline(n: SyntaxNode, st: ShellState): ShellState {
    const stages = n.namedChildren.filter((c) => STATEMENTS.has(c.type));
    // (The stages but the last one are subshells.)
    stages.slice(0, -1).forEach((s) => this.run(s, st));
    const here = lastStageInShell(st, this.shell);
    const after = this.run(stages[stages.length - 1], st);
    return here === 'on' ? after : here === 'unknown' ? merge([st, after], this.posix) : st;
  }

  private ifStatement(n: SyntaxNode, st: ShellState): ShellState {
    const ends: ShellState[] = [];
    let cur = this.sequence(this.part(n, 'if', ['then']), st);
    ends.push(this.sequence(this.part(n, 'then', ['elif_clause', 'else_clause', 'fi']), cur));
    let hasElse = false;
    for (const c of n.namedChildren) {
      if (c.type === 'elif_clause') {
        cur = this.sequence(this.part(c, 'elif', ['then']), cur);
        ends.push(this.sequence(this.part(c, 'then', []), cur));
      } else if (c.type === 'else_clause') {
        hasElse = true;
        ends.push(this.sequence(c.children, cur));
      }
    }
    if (!hasElse) ends.push(cur);
    return merge(ends, this.posix);
  }

  /**
   * A loop: the condition, then the body, again and again until the state at the start of the body no longer
   * changes. A `while` ends after its condition; a `for`, after the body or before it (an empty list).
   */
  private loop(st: ShellState, cond: (s: ShellState) => ShellState, body: (s: ShellState) => ShellState, endsWithCondition: boolean, atLeastOnce = false): ShellState {
    let entry = st;
    let end = st;
    for (let pass = 0; pass < 5; pass++) {
      end = body(cond(entry));
      const next = merge([st, end], this.posix);
      if (sameState(next, entry)) break;
      entry = next;
    }
    return endsWithCondition ? cond(entry) : atLeastOnce ? end : entry;
  }

  private forStatement(n: SyntaxNode, st: ShellState): ShellState {
    const values = fields(n, 'value');
    for (const v of values) this.substitutions(v, st);
    const variable = field(n, 'variable');
    const assign = (s: ShellState, value: string | undefined): ShellState => (variable ? this.setVariable(s, variable.text, variable, value) : s);
    // `for x in a b c`: x is each word in turn, then stays the last; with no `in`, the positional parameters.
    const words = values.map((v) => (v.type === 'word' || v.type === 'number' || v.type === 'raw_string' || v.type === 'string' ? staticWordValue(v) : undefined));
    const known = n.type === 'for_statement' && values.length > 0 && words.every((w) => w !== undefined);
    const each = known && new Set(words).size === 1 ? words[0] : undefined;
    // (A list of known words runs the body at least once.)
    const end = this.loop(st, (s) => s, (s) => this.sequence(field(n, 'body')?.children ?? [], assign(s, each)), false, known);
    return known ? assign(end, words[words.length - 1]) : end;
  }

  private functionDefinition(n: SyntaxNode, st: ShellState): ShellState {
    const name = field(n, 'name')!.text;
    const prev = st.functions.get(name);
    // A readonly function cannot be defined again.
    if (prev?.state === 'on' && prev.readonly === 'on') return st;
    this.changeAtDefinition.set(n, this.changeCount);
    // Under `set -a`, a function defined is exported.
    const all = option(st, 'set', 'allexport');
    const exported: Tri = all === 'on' ? 'on' : all === 'unknown' ? tri(prev?.exported ?? 'off', 'on') : prev?.exported ?? 'off';
    return this.put(st, 'functions', name, { state: 'on', def: n, exported, readonly: prev?.readonly ?? 'off' });
  }

  /** The state after a call of `fn`, with the prefix assignments `temporaries` (`x=1 f`) set while it runs. */
  private call(fn: FunctionState, st: ShellState, temporaries: SyntaxNode[]): ShellState {
    const def = fn.def;
    const site = this.aliasHost ?? this.node!;
    const sites = this.calls.get(def) ?? new Map<SyntaxNode, boolean>();
    this.calls.set(def, sites);
    sites.set(site, (sites.get(site) ?? true) && fn.state === 'on');
    let exit: ShellState;
    if (this.stack.includes(def) || this.stack.length >= CALL_DEPTH) {
      // A recursive call: what the body changed in its walks so far may change.
      exit = this.widen(st, this.changes.get(def) ?? new Set());
    } else if (temporaries.length) {
      const frame: Frame = { def, saved: new Map() };
      let entry = st;
      for (const a of temporaries) {
        const name = field(a, 'name')!.text;
        if (!frame.saved.has(name)) frame.saved.set(name, entry.variables.get(name));
        entry = this.assignNode(a, entry);
      }
      exit = this.walkBody(def, entry, frame);
    } else {
      const walks = this.walks.get(def) ?? [];
      this.walks.set(def, walks);
      const seen = walks.find((w) => w.entry === st || sameState(w.entry, st));
      if (seen) exit = seen.exit;
      else if (walks.length >= WALKS_PER_FUNCTION) exit = this.widen(st, this.changes.get(def)!);
      else {
        exit = this.walkBody(def, st, { def, saved: new Map() });
        walks.push({ entry: st, exit });
      }
    }
    return fn.state === 'on' ? exit : merge([st, exit], this.posix);
  }

  /** Walks the body of `def` from `entry`; its locals (in `frame`) and its `local -` options are restored after it. */
  private walkBody(def: SyntaxNode, entry: ShellState, frame: Frame): ShellState {
    if (!this.walks.has(def)) this.walks.set(def, []);
    const body = field(def, 'body');
    if (!body) return entry;
    let top = def;
    while (top.parent?.parent) top = top.parent;
    const outer = this.expand;
    // Its aliases are those of when the definition was read.
    this.expand = this.parseAt.get(top) ?? entry;
    this.stack.push(def);
    this.frames.push(frame);
    const changes = this.changes.get(def) ?? new Set<string>();
    this.changes.set(def, changes);
    this.collecting.push(changes);
    let end = this.run(body, entry);
    this.frames.pop();
    this.stack.pop();
    this.expand = outer;
    this.collecting.pop();
    // (`f() ( … )` runs its body in a subshell.)
    if (body.type === 'subshell') return entry;
    for (const [name, v] of frame.saved) end = { ...end, variables: end.variables.with(name, v) };
    if (frame.options) end = { ...end, set: frame.options };
    return end;
  }

  private commandName(c: SyntaxNode): string | undefined {
    return staticWordValue(field(c, 'name')!.namedChildren[0]);
  }

  private command(n: SyntaxNode, st: ShellState): ShellState {
    this.substitutions(n, st);
    const name = this.commandName(n);
    const nameNode = field(n, 'name')!;
    const assignments = n.namedChildren.filter((c) => c.type === 'variable_assignment' && c.startIndex < nameNode.startIndex);
    // With no command name, the assignments are the shell's.
    if (name === '') {
      for (const a of assignments) {
        this.record(a, st);
        st = this.assignNode(a, st);
      }
      return this.defaults(n, st);
    }
    const before = st;
    st = this.defaults(n, st);
    const word = nameNode.namedChildren[0];
    const alias = name !== undefined && word.type === 'word' && word.text === name && !this.expanding.has(name) ? this.expand.aliases.get(name) : undefined;
    const expands = !this.bash ? 'on' : option(this.expand, 'shopt', 'expand_aliases');
    if (alias && alias.state !== 'off' && (expands === 'on' || expands === 'unknown')) return this.expandAlias(n, nameNode, name!, alias, expands, st);
    // In POSIX mode, the assignments before a special builtin stay after it, exported.
    const posix = option(before, 'set', 'posix');
    if (assignments.length && name && builtins[name]?.builtin === 'special' && (posix === 'on' || posix === 'unknown')) {
      let kept = st;
      for (const a of assignments) kept = this.giveAttribute(this.assignNode(a, kept), field(a, 'name')!.text, 'x', a);
      st = posix === 'on' ? kept : merge([st, kept], this.posix);
    }
    if (name === undefined) return st;
    const fn = st.functions.get(name);
    if (fn && fn.state !== 'off') return this.call(fn, st, assignments);
    return this.builtin(name, fields(n, 'argument'), n, st);
  }

  /** Runs `text` as a script for the calls it makes, from `host` (an `eval`, a `trap`); the state it leaves is dropped. */
  private runText(text: string, host: SyntaxNode, st: ShellState): void {
    const outer = this.aliasHost;
    this.aliasHost ??= host;
    this.sequence(this.parseText(text).root.children, st);
    this.aliasHost = outer;
  }

  private parseText(text: string): SyntaxTree {
    let tree = aliasTrees.get(text);
    if (!tree) {
      aliasParser ??= createUnbashParser();
      tree = aliasParser.parse(text);
      aliasTrees.set(text, tree);
    }
    return tree;
  }

  /** A command whose name is an alias: the alias's text, then the rest of the command, read and run instead. */
  private expandAlias(n: SyntaxNode, nameNode: SyntaxNode, name: string, alias: AliasState, expands: OptionState, st: ShellState): ShellState {
    const tree = this.parseText(alias.value + n.text.slice(nameNode.endIndex - n.startIndex));
    this.expanding.add(name);
    const host = this.aliasHost;
    this.aliasHost ??= n;
    const after = this.sequence(tree.root.children, st);
    this.aliasHost = host;
    this.expanding.delete(name);
    return alias.state === 'on' && expands === 'on' ? after : merge([st, after], this.posix);
  }

  /** The builtin `name` run with `args`, when it changes the state. */
  private builtin(name: string, args: SyntaxNode[], n: SyntaxNode, st: ShellState): ShellState {
    if (!builtins[name] || !this.bashBuiltin(name)) return st;
    // `command set -f`, `builtin shopt -s x`: the builtin runs (`command -v` only looks it up).
    if (name === 'command' || name === 'builtin') {
      const i = args.findIndex((a) => !/^-/.test(staticWordValue(a) ?? '-'));
      const next = i < 0 ? undefined : staticWordValue(args[i]);
      if (next === undefined || args.slice(0, i).some((a) => /^-[^p]*[vV]/.test(a.text))) return st;
      return this.builtin(next, args.slice(i + 1), n, st);
    }
    if (DECLARATIONS.has(name)) return this.declare(name, args, readDeclarationWords(name, args), n, st);
    if (name === 'unset') return this.unset(args, n, st);
    const parse = interpret(builtins[name], args.map(argWord), { name });
    const operands = parse.roles.filter((r) => r.role.role === 'operand').map((r) => args[r.word]);
    const valueOf = (flag: string): SyntaxNode | undefined => {
      const r = parse.roles.find((x) => x.role.role === 'value' && x.role.of === flag);
      return r ? args[r.word] : undefined;
    };
    const letters = optionRoles(parse);
    const has = (flag: string): boolean => letters.some((l) => l.flag === flag);
    switch (name) {
      case 'eval': case 'trap': {
        // A static string of `eval`, or a trap's action: the functions it calls are called here (or when the trap
        // runs, from the shell that set it). Its changes to the state are not followed.
        const words = name === 'eval' ? args.filter((a, i) => i > 0 || a.text !== '--') : parse.roles.filter((r) => r.role.role === 'operand' && r.role.spec?.name === 'ACTION').map((r) => args[r.word]);
        const text = words.map((w) => staticWordValue(w));
        if (words.length && text.every((t) => t !== undefined)) this.runText(text.join(' '), n, st);
        return st;
      }
      case 'set': return this.setCommand(st, parse.roles.map((r) => r.role), args);
      case 'shopt': {
        const on = has('-s') ? 'on' : has('-u') ? 'off' : undefined;
        if (!on) return st;
        for (const o of operands) {
          const opt = staticWordValue(o);
          if (opt === 'posix' && has('-o')) st = this.setPosix(st, on === 'on', n);
          else if (opt) st = this.put(st, has('-o') ? 'set' : 'shopt', opt, on);
        }
        return st;
      }
      case 'alias':
        for (const a of args) {
          const def = this.aliasOf(a);
          if (def) st = this.put(st, 'aliases', def.name, { state: 'on', value: def.value, at: n });
        }
        return st;
      case 'unalias':
        if (has('-a')) for (const [k, a] of st.aliases) st = this.put(st, 'aliases', k, { ...a, state: 'off' });
        for (const o of operands) {
          const a = staticWordValue(o);
          const prev = a ? st.aliases.get(a) : undefined;
          if (prev) st = this.put(st, 'aliases', a!, { ...prev, state: 'off' });
        }
        return st;
      case 'read': {
        const array = valueOf('-a');
        if (array) return this.setNamed(st, array, n, true);
        if (!operands.length) return this.setVariable(st, 'REPLY', n, undefined);
        for (const o of operands) st = this.setNamed(st, o, n, false);
        return st;
      }
      case 'mapfile': case 'readarray': {
        const array = operands[0] ? staticWordValue(operands[0]) : 'MAPFILE';
        return array && NAME.test(array) ? this.giveAttribute(this.setVariable(st, array, n, undefined), array, 'a', n) : st;
      }
      case 'printf': {
        const v = valueOf('-v');
        return v ? this.setNamed(st, v, n, false) : st;
      }
      case 'getopts': {
        if (operands[1]) st = this.setNamed(st, operands[1], n, false);
        // OPTARG is set, or unset when the option takes no value.
        st = this.setVariable(st, 'OPTIND', n, undefined);
        const prev = st.variables.get('OPTARG');
        return this.put(st, 'variables', 'OPTARG', { declared: 'unknown', set: 'unknown', attrs: prev?.attrs ?? {}, at: n });
      }
    }
    return st;
  }

  /** Whether `name` is read here as bash's builtin (the others are programs, or other shells' builtins). */
  private bashBuiltin(name: string): boolean {
    return this.bash || !['shopt', 'mapfile', 'readarray'].includes(name);
  }

  /** Sets the variable a word names (`v`, `a[1]`: an element), to a value not known here. */
  private setNamed(st: ShellState, w: SyntaxNode, at: SyntaxNode, array: boolean): ShellState {
    const m = /^([A-Za-z_]\w*)(\[.*\])?$/s.exec(staticWordValue(w) ?? '');
    if (!m) return st;
    st = this.setVariable(st, m[1], at, undefined);
    return (array || m[2]) && attribute(st, m[1], 'A') === 'off' ? this.giveAttribute(st, m[1], 'a', at) : st;
  }

  /** `alias name=value` (or `'name=value'`): the name and what it stands for (static, or the text without its outer quotes). */
  private aliasOf(a: SyntaxNode): { name: string; value: string } | undefined {
    const v = staticWordValue(a);
    const text = v ?? a.text;
    const m = /^([\w.:@%+-]+)=(['"]?)([\s\S]*)\2$/.exec(text);
    if (!m) return undefined;
    return { name: m[1], value: v !== undefined ? v.slice(v.indexOf('=') + 1) : m[3] };
  }

  /**
   * POSIX mode turned on or off (`set -o posix`, `POSIXLY_CORRECT`): on turns expand_aliases, inherit_errexit and
   * shift_verbose on; leaving it turns expand_aliases and shift_verbose off. `variable`: the change comes from
   * POSIXLY_CORRECT itself (which `set -o posix` sets and `set +o posix` unsets otherwise).
   */
  private setPosix(st: ShellState, on: boolean, at: SyntaxNode, variable = false): ShellState {
    const now = option(st, 'set', 'posix');
    if (!this.bash) return this.put(st, 'set', 'posix', on ? 'on' : 'off');
    // Leaving a mode bash is not in changes nothing else.
    if (!on && (now === 'off' || now === 'default')) return this.put(st, 'set', 'posix', 'off');
    let out = this.put(st, 'set', 'posix', on ? 'on' : 'off');
    for (const s of POSIX_ON.shopt) if (on || s !== 'inherit_errexit') out = this.put(out, 'shopt', s, on ? 'on' : 'off');
    if (!variable) out = on ? this.setVariable(out, 'POSIXLY_CORRECT', at, 'y', true) : this.put(out, 'variables', 'POSIXLY_CORRECT', { declared: 'off', set: 'off', attrs: {}, at });
    return !on && now === 'unknown' ? merge([st, out], this.posix) : out;
  }

  private setCommand(st: ShellState, roles: ArgRole[], args: SyntaxNode[]): ShellState {
    const turn = (name: string, on: boolean): void => {
      st = name === 'posix' ? this.setPosix(st, on, this.node!) : this.put(st, 'set', name, on ? 'on' : 'off');
    };
    roles.forEach((role, i) => {
      for (const r of role.role === 'cluster' ? role.letters : [role]) {
        if (r.role === 'option' || r.role === 'unknown-option') {
          // (ksh's `set -G` is not in bash's spec.)
          const letter = r.flag.slice(1);
          const name = letter === 'G' && this.shell === 'ksh' ? 'globstar' : SET_LETTERS[letter];
          if (name) turn(name, r.flag[0] === '-');
        } else if (r.role === 'value') {
          const name = staticWordValue(args[i]);
          if (name) turn(name, r.of !== '+o');
        }
      }
    });
    return st;
  }

  /** The names a declaration's words declare or assign. */
  private operands(words: SyntaxNode[], roles: Map<SyntaxNode, ArgRole>): Operand[] {
    const out: Operand[] = [];
    for (const w of words) {
      if (roles.get(w)?.role !== 'operand') continue;
      if (w.type === 'variable_assignment') {
        const nameNode = field(w, 'name')!;
        const value = field(w, 'value');
        const subscript = nameNode.type === 'subscript';
        out.push({ node: w, name: subscript ? field(nameNode, 'name')!.text : nameNode.text, subscript,
          assign: { append: w.children.some((c) => c.type === '+='), text: value ? staticWordValue(value, true) : '', array: value?.type === 'array', source: value } });
        continue;
      }
      // A word: `x`, or `y=2` in `x=1 declare y=2`, where the parser sees a plain command; `"c"=$x` (whose value is not known here).
      const text = w.type === 'variable_name' || w.type === 'subscript' ? w.text : staticWordValue(w);
      const m = /^([A-Za-z_]\w*)(\[.*?\])?(?:(\+?=)(.*))?$/s.exec(text ?? prefixOf(w).replace(/=.*/s, '=')) ;
      if (!m || (text === undefined && !m[3])) continue;
      out.push({ node: w, name: m[1], subscript: !!m[2], ...(m[3] ? { assign: { append: m[3] === '+=', text: text === undefined ? undefined : m[4], array: false } } : {}) });
    }
    return out;
  }

  private declare(builtin: string, words: SyntaxNode[], { roles, on, off }: Declaration, n: SyntaxNode, st: ShellState): ShellState {
    if (on.includes('p')) return st;
    const operands = this.operands(words, roles);
    // `export -f f`, `declare -fx f`, `readonly -f f`: the names are functions.
    if (/[fF]/.test(on)) {
      const exported: Tri | undefined = (builtin === 'export' && !on.includes('n')) || on.includes('x') ? 'on' : (builtin === 'export' || off.includes('x')) ? 'off' : undefined;
      const ro = builtin === 'readonly' || on.includes('r');
      for (const o of operands) {
        const fn = st.functions.get(o.name);
        if (fn && fn.state !== 'off') st = this.put(st, 'functions', o.name, { ...fn, ...(exported ? { exported } : {}), ...(ro ? { readonly: 'on' as Tri } : {}) });
      }
      return st;
    }
    // `local` works only in a function (`declare` there is local too, unless `-g`): outside one it fails, and
    // changes nothing; its words are still read as in a function (a line taken from one).
    if (builtin === 'local' && !this.frames.length) {
      this.frames.push({ def: n, saved: new Map() });
      this.declare(builtin, words, { roles, on, off }, n, st);
      this.frames.pop();
      return st;
    }
    // `local -`: the set options come back when the function returns.
    const frame = this.frames[this.frames.length - 1];
    if (builtin === 'local' && words.some((w) => staticWordValue(w) === '-')) frame.options ??= st.set;
    const local = this.frames.length > 0 && (builtin === 'local' || ((builtin === 'declare' || builtin === 'typeset') && !on.includes('g')));
    const gives = builtin === 'export' ? (on.includes('n') ? '' : 'x') : builtin === 'readonly' ? 'r' : [...on].filter((l) => ATTRIBUTE_LETTERS.has(l)).join('');
    const removes = builtin === 'export' && on.includes('n') ? 'x' : [...off].filter((l) => ATTRIBUTE_LETTERS.has(l)).join('');
    for (const o of operands) {
      // `declare a[1]=x` makes `a` an array.
      if (o.subscript) {
        st = this.assign(st, o.name, true, o.assign ?? { append: false, text: undefined, array: false }, o.node, false, true);
        continue;
      }
      const name = o.name;
      // A local variable starts afresh, hiding the one outside, from here to the end of the function.
      if (local && !frame.saved.has(name)) {
        frame.saved.set(name, st.variables.get(name));
        st = this.put(st, 'variables', name, { declared: 'on', set: 'off', attrs: {}, at: n });
      }
      // `declare -g x` while `x` is local: the global one.
      const global = on.includes('g') ? this.frames.find((f) => f.saved.has(name)) : undefined;
      const scope = global ? { ...st, variables: st.variables.with(name, global.saved.get(name)) } : st;
      let next = this.declareOne(scope, name, gives, removes, o, n, on.includes('n'));
      if (global) {
        global.saved.set(name, next.variables.get(name));
        next = { ...next, variables: next.variables.with(name, st.variables.get(name)) };
      }
      st = next;
    }
    return st;
  }

  private declareOne(st: ShellState, name: string, gives: string, removes: string, o: Operand, n: SyntaxNode, nameref: boolean): ShellState {
    const prev = st.variables.get(name);
    const attrs: Record<string, Attribute> = { ...(prev?.attrs ?? {}) };
    for (const l of gives) {
      // bash refuses to make an indexed array associative, and keeps an associative one so.
      if ((l === 'A' && attrs.a?.state === 'on') || (l === 'a' && attrs.A?.state === 'on')) continue;
      attrs[l] = { state: 'on', at: n };
    }
    for (const l of removes) attrs[l] = { state: 'off', at: n };
    // (A name the script has not set may come from the environment: by custom, those are in capitals.)
    const set: Tri = prev ? prev.set : /^[A-Z_][A-Z0-9_]*$/.test(name) ? 'unknown' : 'off';
    st = this.put(st, 'variables', name, { declared: 'on', set, attrs, value: prev?.value, at: n });
    // (A variable readonly before the declaration keeps its value; `readonly r=1` sets it.)
    if (!o.assign || prev?.attrs.r?.state === 'on') return st;
    // (The state of an assignment in a declaration has the attributes the declaration gives.)
    if (o.node.type === 'variable_assignment') this.record(o.node, st);
    return this.assign(st, name, false, o.assign, o.node, nameref, true);
  }

  private unset(words: readonly SyntaxNode[], n: SyntaxNode, st: ShellState): ShellState {
    const all = words.map((w) => ({ node: w, text: (w.type === 'variable_name' ? w.text : staticWordValue(w)) ?? w.text }));
    const flags = all.filter((w) => /^-[fvn]+$/.test(w.text)).map((w) => w.text).join('');
    // (`unset -fv` is an error: nothing is unset.)
    if (flags.includes('f') && flags.includes('v')) return st;
    for (const { node, text } of all) {
      if (/^-/.test(text)) continue;
      const fn = st.functions.get(text);
      if (flags.includes('f')) {
        if (fn) st = this.put(st, 'functions', text, { ...fn, state: 'off' });
        continue;
      }
      // `unset 'a[1]'` removes an element.
      if (text.includes('[')) continue;
      const v = st.variables.get(text);
      // With no -v, a name with no variable is a function.
      if (!flags.includes('v') && (!v || v.declared === 'off') && fn && fn.state !== 'off') {
        st = this.put(st, 'functions', text, { ...fn, state: 'off' });
        continue;
      }
      // A readonly variable stays; `unset r` of a nameref unsets the variable it names (`unset -n r`: the nameref).
      const target = flags.includes('n') ? text : this.resolve(st, text);
      if (!target || attribute(st, target, 'r') === 'on') continue;
      // The local of a calling function: unset removes it, and the variable outside shows again (it is no longer restored).
      const top = this.frames[this.frames.length - 1];
      const outer = this.frames.find((f) => f !== top && f.saved.has(target));
      if (outer && !top.saved.has(target)) {
        st = this.put(st, 'variables', target, outer.saved.get(target));
        outer.saved.delete(target);
        continue;
      }
      if (target === 'POSIXLY_CORRECT' && this.bash) st = this.setPosix(st, false, node, true);
      // Unsetting GLOBIGNORE turns dotglob off (setting it turned it on).
      if (target === 'GLOBIGNORE' && this.bash) st = this.put(st, 'shopt', 'dotglob', 'off');
      st = this.put(st, 'variables', target, { declared: 'off', set: 'off', attrs: {}, at: node });
    }
    return st;
  }

  /** The variable that `name` stands for, following namerefs; undefined when it is not known. */
  private resolve(st: ShellState, name: string): string | undefined {
    const seen = new Set<string>();
    for (let v = st.variables.get(name); v?.attrs.n?.state === 'on' && v.set === 'on'; v = st.variables.get(name)) {
      if (v.value === undefined || !NAME.test(v.value) || seen.has(v.value)) return undefined;
      seen.add(name);
      name = v.value;
    }
    return name;
  }

  private assignNode(a: SyntaxNode, st: ShellState): ShellState {
    const nameNode = field(a, 'name')!;
    const value = field(a, 'value');
    const subscript = nameNode.type === 'subscript';
    return this.assign(st, subscript ? field(nameNode, 'name')!.text : nameNode.text, subscript,
      { append: a.children.some((c) => c.type === '+='), text: value ? staticWordValue(value, true) : '', array: value?.type === 'array', source: value }, a, false);
  }

  /** `name=value`, `name+=value`, `name[i]=value`, `name=(…)`; `nameref`: the assignment of a `declare -n`. */
  private assign(st: ShellState, name: string, subscript: boolean, how: NonNullable<Operand['assign']>, at: SyntaxNode, nameref: boolean, declaring = false): ShellState {
    // Assigning to a nameref assigns to the variable it names.
    const target = nameref ? name : this.resolve(st, name);
    if (!target) return st;
    const prev = st.variables.get(target);
    // A readonly variable keeps its value.
    if (prev?.attrs.r?.state === 'on' && !declaring) return st;
    if (subscript || how.array) {
      st = this.setVariable(st, target, at, undefined, false, true);
      return attribute(st, target, 'A') === 'off' ? this.giveAttribute(st, target, 'a', at) : st;
    }
    let text = how.text;
    const is = (l: string): boolean => prev?.attrs[l]?.state === 'on';
    if (is('a') || is('A')) text = undefined;
    else if (is('i') && text !== undefined) {
      const v = evalArith(text);
      const old = prev?.value !== undefined ? evalArith(prev.value) : how.append ? undefined : 0;
      text = v === undefined || old === undefined ? undefined : String(how.append ? old + v : v);
    } else if (how.append) text = prev?.set === 'on' && prev.value !== undefined && text !== undefined ? prev.value + text : prev?.set === 'off' ? text : undefined;
    if (text !== undefined && is('l')) text = text.toLowerCase();
    if (text !== undefined && is('u')) text = text.toUpperCase();
    // An empty nameref (`declare -n r; r=x`) takes the name as its value; bash refuses one that is no name.
    if (is('n') && !nameref && (text === undefined || !NAME.test(text))) return st;
    // (An integer or a case attribute changes the value: then the word alone does not give it.)
    const source = text === undefined && !how.append && !['i', 'l', 'u'].some(is) ? how.source : undefined;
    return this.setVariable(st, target, at, text, false, is('a') || is('A'), source);
  }

  /** Sets `name` (to `value`, when known), exporting it under `set -a` (not an array: bash cannot export one). */
  private setVariable(st: ShellState, name: string, at: SyntaxNode, value: string | undefined, plain = false, array = false, source?: SyntaxNode): ShellState {
    const prev = st.variables.get(name);
    st = this.put(st, 'variables', name, { declared: 'on', set: 'on', attrs: prev?.attrs ?? {}, value, ...(source ? { source } : {}), at });
    if (name === 'POSIXLY_CORRECT' && !plain && this.bash && option(st, 'set', 'posix') !== 'on') st = this.setPosix(st, true, at, true);
    // A GLOBIGNORE that is not empty turns dotglob on, until GLOBIGNORE is unset (an empty one leaves it as it is).
    if (name === 'GLOBIGNORE' && this.bash && value !== '' && option(st, 'shopt', 'dotglob') !== 'on') st = this.put(st, 'shopt', 'dotglob', value === undefined ? 'unknown' : 'on');
    const all = option(st, 'set', 'allexport');
    if (!array && (all === 'on' || (all === 'unknown' && prev?.attrs.x?.state !== 'on'))) {
      const v = st.variables.get(name)!;
      st = this.put(st, 'variables', name, { ...v, attrs: { ...v.attrs, x: { state: all === 'on' ? 'on' : 'unknown', at } } });
    }
    return st;
  }

  private giveAttribute(st: ShellState, name: string, letter: string, at: SyntaxNode): ShellState {
    const v = st.variables.get(name)!;
    return this.put(st, 'variables', name, { ...v, attrs: { ...v.attrs, [letter]: { state: 'on', at } } });
  }
}

const models = new WeakMap<SyntaxTree, Map<string, StateModel>>();

/** The shell state along `tree`, for `shell` (bash when absent; `posix`: `bash --posix`). Cached per tree. */
export function shellState(tree: SyntaxTree, shell?: Shell, opts: { posix?: boolean } = {}): StateModel {
  const key = `${shell ?? 'bash'}${opts.posix ? ' --posix' : ''}`;
  let byKey = models.get(tree);
  if (!byKey) models.set(tree, (byKey = new Map()));
  const hit = byKey.get(key);
  if (hit) return hit;
  const w = new Walker(shell, !!opts.posix);
  const initial = w.initial();
  const end = w.program(tree.root);
  // (The model's `at` is defined below; the environments ask for it only later.)
  const envs = new EnvModel({ run: (n) => model.at(n).run, calls: w.calls, root: tree.root, shell });
  const model: StateModel = {
    end,
    env: (n) => envs.at(n),
    calls: w.calls,
    assigned: new Set([...w.lastChange.keys()].filter((k) => k.startsWith('variables ')).map((k) => k.slice('variables '.length))),
    definitions: { functions: w.functionDefs, aliases: w.aliasDefs },
    at(n) {
      let run: ShellState | undefined;
      let expand: ShellState | undefined;
      let top = n;
      for (let x: SyntaxNode | null = n; x; x = x.parent) {
        run ??= w.runAt(x);
        if (x.type === 'command_substitution' && x !== n) expand ??= w.runAt(x);
        if (x.parent) top = x;
      }
      const parse = w.parseAt.get(top) ?? initial;
      return { run: run ?? initial, parse, expand: expand ?? parse };
    },
  };
  byKey.set(key, model);
  return model;
}
