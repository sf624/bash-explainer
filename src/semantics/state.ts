// The shell state along a script (docs/design/semantics.md, 4.3, 4.7 and step B1): the options of `set` and
// `shopt`, the variables and their attributes, the functions and the aliases that apply at each node.
//
// One walk over the tree, in source order, carries a `ShellState`. Commands that change the state (`set`,
// `shopt`, `alias`, `unalias`, `unset`, the declaration builtins, `read`, `mapfile`, `getopts`, `printf -v`,
// assignments, function definitions and calls) are read with their builtin's spec (src/argv/). The assignments of
// arithmetic (`(( i++ ))`, `let x=1`, `for (( ))`, `$(( n = 3 ))`) are run with their values, when known.
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
import { arithLiteral, evalArith, evalArithWrapping } from '../arith';
import { interpret, type ArgRole, type ArgvParse } from '../argv/interpret';
import { argWord, prefixOf } from '../argv/words';
import type { Shell } from '../dialect';
import { BASH_ONLY_BUILTINS, builtins } from '../dict/builtins';
import { ansiCValue, staticWordValue } from '../staticword';
import { createUnbashParser } from '../syntax/adapters/unbash';
import { ancestor, descendants, field, fields, hasError, type BashParser, type SyntaxNode, type SyntaxTree } from '../syntax/tree';
import { compareIntegers, patternMatches, patternText, testStatus, type TestEnv, unaryTest } from './conditions';
import { builtinParse, commandName, DECLARATIONS, SET_LETTERS, setOptionWrites, variableWrites, wrapped } from './effects';
import { EnvModel, type ExecEnv, lastStageInShell, MAIN_SHELL, reachOf, type SlotLink, slotEnvs, STATEMENTS, subshellReasons } from './env';
import { NESTED_DEPTH, type NestedScript, type NotRead, scriptSourceIndex, scriptText, slotShell } from './nested';
import { BLIND, scriptTrust, type Trust, withinTrust } from './trust';
import { ARITH_ASSIGNED, DYNAMIC, NUMERIC_DYNAMIC, optionRoles, readDeclaration, readDeclarationWords, type Declaration } from './vars';

export { ARITH_ASSIGNED, DYNAMIC, readDeclaration, type Declaration };

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
  /** `hash -p`: the path. */
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
   * Set on the state of a path that never gets here: after `break`, `continue`, `return` or `exit` (and an error
   * under `set -e`). What runs from it is dead code; merging drops it.
   */
  readonly unreachable?: true;
}

/** What a condition always decides here (on every walk), and the variables it read: name → value (null: unset). */
export interface Decision {
  /**
   * `if`, `elif`, `&&`, `||`: `true` when the condition (the left side) always succeeds, `false` when it always fails.
   * A loop: `false` when it stops at its first test, `true` when it holds at every test. `case`: the indexes of the
   * items whose lists run, in order, joined by commas (empty: none).
   */
  outcome: string;
  reads: ReadonlyMap<string, string | null>;
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
  /** The options a `set` command turns on or off (`set -e`: errexit on), on any walk; empty for another node. */
  setWrites(n: SyntaxNode): ReadonlyMap<string, 'on' | 'off'>;
  /** The variables the statement `n` sets itself, on any walk (`n=1`, `read n`, `((n++))`, `printf -v n`); not those of the statements inside it. */
  writes(n: SyntaxNode): ReadonlySet<string>;
  /** The `source` and `.` commands that run (their files are not read). */
  readonly sources: readonly SyntaxNode[];
  /** The first statement of the unit bash reads at once that holds `n`: a line of top-level statements, or a compound command. */
  unit(n: SyntaxNode): SyntaxNode;
  /**
   * The string `words` hold (one word, or words joined with spaces), read as the script that the slot at the end of
   * `env` runs (docs/design/semantics.md, 4.13): its tree and the model its nodes are in. Kept by its first word.
   */
  script(words: readonly SyntaxNode[], env: ExecEnv): NestedScript | NotRead;
  /** What the condition of `n` (an `if`, an `elif`, a loop, an `&&` or `||` list, a `case`) always decides, if anything. */
  condition(n: SyntaxNode): Decision | undefined;
  /** Why no condition of the script is decided, if so (src/semantics/trust.ts): `source`, `$cmd`… */
  readonly blind: string | undefined;
  /**
   * Whether the statement `n` runs only in code that never runs here: a branch whose condition is decided, or after
   * `break`, `continue`, `return` or `exit`.
   */
  dead(n: SyntaxNode): boolean;
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

/** The attributes the declaration builtins give with their options. */
const ATTRIBUTE_LETTERS = new Set(['a', 'A', 'i', 'l', 'n', 'r', 't', 'u', 'x']);
/** The shells that start in POSIX mode (for what the model follows: assignments before special builtins). */
const POSIX_SHELLS = new Set<Shell>(['sh', 'dash', 'ash', 'yash', 'ksh', 'mksh']);
const NAME = /^[A-Za-z_]\w*$/;

const SUBSTITUTIONS = ['command_substitution', 'process_substitution'];
/** The simple commands: they expand their words before their redirections. */
const SIMPLE = ['command', 'declaration_command', 'unset_command', 'variable_assignment', 'variable_assignments'];
/** Where an expression is arithmetic: an arithmetic expansion in it is run with the expression. */
const ARITH_HOSTS = ['arithmetic_expansion', 'arithmetic_command', 'c_style_for_statement'];
/** The assignment operators of arithmetic (6.5). */
const ARITH_ASSIGN = new Set(['=', '+=', '-=', '*=', '/=', '%=', '<<=', '>>=', '&=', '^=', '|=']);
const wrap = (v: bigint): bigint => BigInt.asIntN(64, v);
/** Thrown when the walk finds a reason to trust nothing (`Walker.found`): what it found so far is dropped. */
class WalkAgain {}
/** An error in arithmetic (a division by 0, a readonly variable): bash stops the expression there; `st` has what was assigned before it. */
class ArithError {
  constructor(readonly st: ShellState) {}
}
/**
 * An error in an expansion: `$(( 1/0 ))` discards the rest of the line (see `abort`), `${x?}` on an unset `x` ends the
 * shell (`exit`). `st` has what was assigned before it; `sure`: the values that make it are trusted.
 */
class ExpansionError {
  constructor(readonly st: ShellState, readonly sure: boolean, readonly exit = false) {}
}
/**
 * What arithmetic does is not known here: a text pasted or a value read that is not known, text the parser may read
 * otherwise than bash (a syntax error: bash has made the assignments before it), too long or too deep to follow.
 */
class ArithUnknown {
  /** `deep`: past `ARITH_DEPTH`; `limit`: past another limit, which depends on what ran before. */
  constructor(readonly why?: 'deep' | 'limit') {}
}
/** How deep the values of variables are run in arithmetic, each as an expression (`y=x`, `x='z + 1'`): deeper is not followed (bash fails past 1024). */
const ARITH_DEPTH = 100;
/** How many steps an expression may take here (`v1='v0+v0'`, `v2='v1+v1'`… doubles at each level): more is not followed. */
const ARITH_STEPS = 10_000;
/** How many steps all the arithmetic of a script may take here: past them, what the rest of it assigns may be set, to values not known. */
const ARITH_WALK_STEPS = 500_000;
/** How deeply operators may nest in arithmetic here, through the values read (`v1='((v0))'`…): deeper is not followed. */
const ARITH_NESTING = 1000;
/** How many values of a variable read as an expression are remembered, each with what it read (`arithValue`). */
const ARITH_MEMO = 8;
/** What may be pasted into an arithmetic expression; bash expands it first. (A single-quoted text is not: it is an error.) */
const PASTES = ['simple_expansion', 'expansion', 'arithmetic_expansion', 'command_substitution', 'process_substitution', 'string', 'ansi_c_string', 'translated_string'];
/** The key of `set -u` among the reads of a value (no variable has this name). */
const NOUNSET = '-u';
/** What a value read as an expression has read so far: the variables (and `set -u`), whether it can be remembered, how deep it went. */
interface ArithReads { deps: Map<string, unknown>; pure: boolean; depth: number; unsure: boolean; assumed: boolean }
/**
 * A value read as an expression, remembered with what it read and how deep it went: its value; or `unknown` (`deep`:
 * it went deeper than `ARITH_DEPTH` from where it was read, `depth` is then at least what it needs); `unsure`: it read
 * a value not known; `assumed`: it read a name the script has not set, taken as unset.
 */
interface ArithRemembered { deps: ReadonlyMap<string, unknown>; depth: number; value?: bigint; unknown: false | 'always' | 'deep'; unsure: boolean; assumed: boolean }

/**
 * `text` with each `++` and `--` that bash reads as a sign followed by another one spaced apart, as bash's lexer
 * reads them: after a name (and its subscript), `x++` increments it; before a name (spaces aside), `++x` does;
 * elsewhere it is a sign, and the second character is read again (`5--3` is `5- -3`, 8; `7 ---3` is `7 - - -3`, 4;
 * `1 +++x` is `1 + ++x`). Gives how many are left outside subscripts, or undefined where bash fails (`++x++`).
 */
function incDecText(text: string): { text: string; ops: number } | undefined {
  const name = /[A-Za-z_]\w*/y;
  const number = /\d[\w@#]*/y;
  let out = '';
  let ops = 0;
  let depth = 0;
  // What came before: a name (or its subscript), a name after `++` or `--`, those, or anything else.
  let prev: 'name' | 'counted' | 'incdec' | 'other' = 'other';
  for (let i = 0; i < text.length;) {
    const c = text[i];
    const m = /\d/.test(c) ? number : name;
    m.lastIndex = i;
    const word = m.exec(text)?.[0];
    if (word !== undefined) {
      out += word;
      i += word.length;
      prev = m === number ? 'other' : prev === 'incdec' ? 'counted' : 'name';
    } else if ((c === '+' || c === '-') && text[i + 1] === c) {
      // (bash fails on `++x++`: once incremented, `x` is a number.)
      if (prev === 'counted') return undefined;
      if (prev === 'name' || /^\s*[A-Za-z_]/.test(text.slice(i + 2))) {
        out += c + c;
        i += 2;
        if (!depth) ops++;
        prev = prev === 'name' ? 'other' : 'incdec';
      } else {
        out += `${c} `;
        i += 1;
        prev = 'other';
      }
    } else {
      out += c;
      i += 1;
      if (c === '[') depth++;
      else if (c === ']' && depth) depth--;
      if (!/\s/.test(c)) prev = c === ']' ? 'name' : 'other';
    }
  }
  return { text: out, ops };
}

/** Whether each `(` of `text` is closed by a `)` after it, and each `)` closes one. */
function balanced(text: string): boolean {
  let depth = 0;
  for (const c of text) {
    if (c === '(') depth++;
    else if (c === ')' && --depth < 0) return false;
  }
  return depth === 0;
}

/** Whether `v` is a nameref, or may be one. */
const isNameref = (v: VariableState | undefined): boolean => v?.attrs.n !== undefined && v.attrs.n.state !== 'off';

/** How many `++` and `--` the parser read in `n`, outside subscripts. */
function incDecCount(n: SyntaxNode): number {
  if (n.type === 'subscript') return 0;
  const own = (n.type === 'postfix_expression' || n.type === 'unary_expression') && n.children.some((c) => !c.named && (c.type === '++' || c.type === '--')) ? 1 : 0;
  return n.namedChildren.reduce((sum, c) => sum + incDecCount(c), own);
}

/** The source text from the first of `nodes` to the end of the last one. */
function arithSource(nodes: readonly SyntaxNode[]): string {
  let root = nodes[0];
  while (root.parent) root = root.parent;
  return root.text.slice(nodes[0].startIndex - root.startIndex, nodes[nodes.length - 1].endIndex - root.startIndex);
}
/** Whether `op` with the right side `r` is an error in bash. */
const arithError = (op: string, r: bigint): boolean => ((op === '/' || op === '%') && r === 0n) || (op === '**' && r < 0n);
/** Whether a shift by `b` is the same on every machine. */
const shifts = (b: bigint): boolean => b >= 0n && b <= 63n;
/** The binary operators of arithmetic, as bash computes them (after `arithError`); undefined for a result not followed here (it depends on the machine, or is too large to compute). */
const ARITH_OPS: Record<string, (a: bigint, b: bigint) => bigint | undefined> = {
  '+': (a, b) => a + b, '-': (a, b) => a - b, '*': (a, b) => a * b,
  '/': (a, b) => a / b, '%': (a, b) => a % b,
  '**': (a, b) => (b > 128n && (a > 1n || a < -1n) ? undefined : a ** b),
  '<<': (a, b) => (shifts(b) ? a << b : undefined), '>>': (a, b) => (shifts(b) ? a >> b : undefined),
  '&': (a, b) => a & b, '|': (a, b) => a | b, '^': (a, b) => a ^ b,
  '<': (a, b) => BigInt(a < b), '>': (a, b) => BigInt(a > b), '<=': (a, b) => BigInt(a <= b), '>=': (a, b) => BigInt(a >= b),
  '==': (a, b) => BigInt(a === b), '!=': (a, b) => BigInt(a !== b),
};

// ---------------------------------------------------------------------------------------------------
// Declarations, read with their builtin's spec.

// ---------------------------------------------------------------------------------------------------
// Merging states.

type Kind = Exclude<keyof ShellState, 'status' | 'unreachable'>;
type Entry<K extends Kind> = ShellState[K] extends NameMap<infer V> ? V : never;

const EMPTY: ShellState = {
  set: NameMap.empty(), shopt: NameMap.empty(), variables: NameMap.empty(), functions: NameMap.empty(), aliases: NameMap.empty(), disabled: NameMap.empty(), hashed: NameMap.empty(),
};

/**
 * Whether the redirection `r` cannot fail: to or from `/dev/null`, or a copy of fd 1 or 2 (`2>&1`, `>&2`), with an fd
 * given as a number if any.
 */
function safeRedirect(r: SyntaxNode): boolean {
  if (r.type !== 'file_redirect' || (field(r, 'descriptor') && field(r, 'descriptor')!.type !== 'file_descriptor')) return false;
  const op = r.children.find((c) => !c.named)?.type;
  const to = field(r, 'destination');
  const target = to && staticWordValue(to);
  if (target === '/dev/null') return ['>', '>>', '&>', '&>>', '>|', '<'].includes(op!);
  return op === '>&' && (target === '1' || target === '2');
}

/** Text as written, without its backslashes (each quotes the character after it; one before a newline goes with it). */
const unescape = (text: string): string => text.replace(/\\\n/g, '').replace(/\\(.)/gs, '$1');

const INTEGER_TESTS = new Set(['-eq', '-ne', '-lt', '-le', '-gt', '-ge']);

/** `st` with the status `status` (undefined: not known). */
/** The statements whose failure stops the shell under `set -e` (a compound command stops in the command that fails). */
const ERREXIT_STOPS = new Set(['command', 'test_command', 'extended_test', 'arithmetic_command', 'subshell', 'pipeline']);

const withStatus = (st: ShellState, status: number | undefined): ShellState => (st.status === status ? st : { ...st, status });

/** `st` as the state of a path that never gets further (see `ShellState.unreachable`). */
const unreachable = (st: ShellState): ShellState => ({ ...st, status: undefined, unreachable: true });

/** `st` as a path that gets here (for walking dead code from it). */
const reached = (st: ShellState): ShellState => {
  if (!st.unreachable) return st;
  const { unreachable: _, ...rest } = st;
  return rest;
};

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
    variables: NameMap.merge(a.variables, b.variables, (_k, x, y) => mergeVariable(x, y)),
    functions: NameMap.merge(a.functions, b.functions, (_k, x, y) => mergeFunction(x, y)),
    aliases: NameMap.merge(a.aliases, b.aliases, (_k, x, y) => mergeAlias(x, y)),
    disabled: NameMap.merge(a.disabled, b.disabled, (_k, x, y) => mergeAlias(x, y)),
    hashed: NameMap.merge(a.hashed, b.hashed, (_k, x, y) => mergeAlias(x, y)),
    ...(a.status === b.status && a.status !== undefined ? { status: a.status } : {}),
  }));
}

/** Whether two states say the same (the nodes where things changed aside). */
function sameState(a: ShellState, b: ShellState): boolean {
  const attrs = (x: VariableState, y: VariableState): boolean => {
    const k = Object.keys(x.attrs);
    return k.length === Object.keys(y.attrs).length && k.every((l) => x.attrs[l].state === y.attrs[l]?.state);
  };
  return a === b || (a.status === b.status && !a.unreachable === !b.unreachable && NameMap.same(a.set, b.set, (x, y) => x === y) && NameMap.same(a.shopt, b.shopt, (x, y) => x === y)
    && NameMap.same(a.variables, b.variables, (x, y) => x === y || (x.declared === y.declared && x.set === y.set && x.value === y.value && attrs(x, y)))
    && NameMap.same(a.functions, b.functions, (x, y) => x === y || (x.state === y.state && x.def === y.def && x.exported === y.exported && x.readonly === y.readonly))
    && NameMap.same(a.aliases, b.aliases, (x, y) => x === y || (x.state === y.state && x.value === y.value))
    && NameMap.same(a.disabled, b.disabled, (x, y) => x === y || x.state === y.state)
    && NameMap.same(a.hashed, b.hashed, (x, y) => x === y || (x.state === y.state && x.value === y.value)));
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

/**
 * Where `break`, `continue`, `return` and `exit` go (innermost last): a loop, a function body, the script; a
 * subshell ends them (`maybe`: a pipeline's last stage that may run in the shell or in a subshell). `dead` is the
 * depth of dead code where it was entered: a jump from deeper dead code is not collected.
 */
type Target =
  | { kind: 'loop'; dead: number; breaks: ShellState[]; continues: ShellState[] }
  | { kind: 'function'; dead: number; returns: ShellState[] }
  | { kind: 'program'; dead: number; exits: ShellState[] }
  /**
   * A line of top-level statements, or of a string `eval` or a trap runs: an expansion error discards the rest of it
   * (`aborts`, see `abort`); one that may happen (`maybes`) may discard it, or the rest of a line around it.
   */
  | { kind: 'unit'; dead: number; aborts: ShellState[]; maybes: ShellState[] }
  | { kind: 'subshell' | 'maybe' }
  /**
   * A trap's action (`exitOnly`: of EXIT alone): a signal may run it between any two statements, so an error that may
   * end the line around it, or a `return`, `break` or `continue` it does not hold, may leave any of them (see `escape`).
   */
  | { kind: 'trap'; exitOnly: boolean };

/** How many times a function body is walked with different states before the rest of its calls are guessed. */
const WALKS_PER_FUNCTION = 4;
/** How deep calls are followed (deeper ones are guessed). */
const CALL_DEPTH = 64;

let aliasParser: BashParser | undefined;
/** Trees of alias texts, least recently used first; bounded, as a long-lived process (LSP, web) sees many texts. */
const aliasTrees = new Map<string, SyntaxTree>();
const ALIAS_TREES = 256;

/** The nested script whose tree each tree is (docs/design/semantics.md, 4.13): `shellState` gives its model. */
const owners = new WeakMap<SyntaxTree, NestedScript>();
/** The same, by the tree's root. */
const rootOwners = new WeakMap<SyntaxNode, NestedScript>();

const rootOf = (n: SyntaxNode): SyntaxNode => {
  let r = n;
  while (r.parent) r = r.parent;
  return r;
};

/**
 * Where `n` starts (with `end`, ends) in the text of the document: a node of a string read as a script (4.13) is
 * mapped through the strings it is read from. Nodes of different trees are compared, and lines are said, so.
 */
export function docIndex(n: SyntaxNode, end = false): number {
  let i = end ? n.endIndex : n.startIndex;
  for (let s = rootOwners.get(rootOf(n)); s; s = rootOwners.get(rootOf(s.words[0]))) i = scriptSourceIndex(s, i, end);
  return i;
}

const lineStarts = new WeakMap<SyntaxNode, number[]>();
/** The line (from 0) of the document where `n` starts. */
export function docLine(n: SyntaxNode): number {
  let root = rootOf(n);
  for (let s = rootOwners.get(root); s; s = rootOwners.get(root)) root = rootOf(s.words[0]);
  let starts = lineStarts.get(root);
  if (!starts) {
    starts = [];
    for (let i = root.text.indexOf('\n'); i >= 0; i = root.text.indexOf('\n', i + 1)) starts.push(i);
    lineStarts.set(root, starts);
  }
  const i = docIndex(n);
  let lo = 0;
  let hi = starts.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (starts[mid] < i) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/**
 * The strings a model reads as scripts (`StateModel.script`), by their first word, and the trees of those that run in
 * its own shell (`eval`, a trap's action), by root: the walk runs them, so their nodes are in this model.
 */
class Scripts {
  readonly byWord = new Map<SyntaxNode, NestedScript | NotRead>();
  readonly byRoot = new Map<SyntaxNode, NestedScript>();
  model!: StateModel;
  constructor(readonly depth: number) {}

  /** The string of `words`, read as a script of `kind`, run where `env` says, by the shell `shell` says. */
  read(words: readonly SyntaxNode[], kind: NestedScript['kind'], env: () => ExecEnv, shell: { shell: Shell | undefined; known: boolean }): NestedScript | NotRead {
    const hit = this.byWord.get(words[0]);
    if (hit) return hit;
    let root = words[0];
    while (root.parent) root = root.parent;
    // (A string in a string that this shell runs is one level deeper than that string.)
    const depth = (this.byRoot.get(root)?.depth ?? this.depth) + 1;
    const text = scriptText(words);
    let out: NestedScript | NotRead;
    if (!text) out = { why: 'not-static' };
    else if (depth > NESTED_DEPTH) out = { why: 'too-deep' };
    else {
      aliasParser ??= createUnbashParser();
      const tree = aliasParser.parse(text.text);
      const scripts = this;
      let model: StateModel | undefined;
      let where: ExecEnv | undefined;
      const script: NestedScript = {
        kind, words, text: text.text, starts: text.starts, ends: text.ends, tree, ...shell, depth,
        get outer() { return scripts.model; },
        get env() { return (where ??= env()); },
        get model() { return kind === 'child' ? (model ??= childModel(script)) : scripts.model; },
      };
      owners.set(tree, script);
      rootOwners.set(tree.root, script);
      if (kind !== 'child') this.byRoot.set(tree.root, script);
      out = script;
    }
    this.byWord.set(words[0], out);
    return out;
  }
}

/**
 * The model of a string another shell runs: a walk of its tree for that shell, from what reaches it of the script
 * where the slot runs (exported variables and functions, the names the slots set, the set options with an exported
 * SHELLOPTS). Its root runs where the slot does.
 */
function childModel(script: NestedScript): StateModel {
  const first = script.words[0];
  const outer = script.outer.at(first).run;
  // (The string is a word of the command whose slot runs it: `bash -c S`, `sudo sh -c S`.)
  const cmd = ancestor(first, (x) => x.type === 'command')!;
  const name = field(cmd, 'name')!;
  // The names the command's assignments and its slots give, but those a slot after them does not pass on
  // (`x=1 env -i bash -c …`: `x` is not there; `env -i x=1 bash -c …`: it is), and those a slot removes (`env -u x`).
  const given = new Set(cmd.namedChildren.filter((c) => c.type === 'variable_assignment' && c.startIndex < name.startIndex).map((c) => field(c, 'name')!.text));
  const removed = new Set<string>();
  // (The links after the command's own place are its slots.)
  const links = script.env.links.slice(script.outer.env(cmd).links.length) as SlotLink[];
  for (const l of links) {
    if (l.slot.run === 'current-shell') continue;
    if (l.env === 'reset' || l.env === 'none' || (l.slot.where ?? 'local') !== 'local') given.clear();
    for (const u of l.unsets ?? []) {
      given.delete(u);
      removed.add(u);
    }
    for (const g of l.assigns) {
      given.add(g);
      removed.delete(g);
    }
  }
  const pass = { given: [...given], removed, invocation: links[links.length - 1].invocation ?? [] };
  return buildModel(script.tree, script.shell, false, script.depth, script.env, (w) => w.childStart(outer, script.env, pass, first), modelTrusts.get(script.outer));
}

/** What the slots on the way give another shell besides the script's exported names (`childModel`). */
interface ChildPass {
  readonly given: readonly string[];
  readonly removed: ReadonlySet<string>;
  readonly invocation: readonly { readonly flag: string; readonly value?: string }[];
}

const passedMemo = new WeakMap<object, ReadonlyMap<string, VariableState>>();
/**
 * What of a variable of the script reaches another shell (`Walker.childStart`): undefined when it does not (not
 * exported, unset, an array, or IFS, which a shell sets itself when it starts). Kept per bucket of the script's
 * variables, which the states along the script share, so that many strings cost little (`NameMap.mapped`).
 */
function passed(name: string, v: VariableState): VariableState | undefined {
  const x = v.attrs.x?.state ?? 'off';
  const array = ['a', 'A'].map((l) => v.attrs[l]?.state ?? 'off');
  if (x === 'off' || v.set === 'off' || array.includes('on') || name === 'IFS') return undefined;
  return x === 'on' && v.set === 'on' && !array.includes('unknown')
    ? { declared: 'on', set: 'on', attrs: { x: v.attrs.x! }, ...(v.value !== undefined ? { value: v.value } : {}), at: v.at }
    : { declared: 'unknown', set: 'unknown', attrs: { x: { state: 'unknown', at: v.attrs.x!.at } }, at: v.at };
}

class Walker {
  /** The states each node was run with (more than one in a loop or a function called more than once); merged when asked. */
  private readonly runStates = new Map<SyntaxNode, ShellState[]>();
  /** The `set` commands, with the options they turn on or off (on any walk). */
  readonly setWrites = new Map<SyntaxNode, Map<string, 'on' | 'off'>>();
  /** The variables each statement sets itself (on any walk), not those of the statements inside it, and not locals. */
  readonly varWrites = new Map<SyntaxNode, Set<string>>();
  readonly parseAt = new Map<SyntaxNode, ShellState>();
  readonly functionDefs = new Map<string, SyntaxNode[]>();
  readonly aliasDefs = new Map<string, SyntaxNode[]>();
  /** The commands that call each function definition, and whether it is surely defined there on every walk. */
  readonly calls = new Map<SyntaxNode, Map<SyntaxNode, boolean>>();
  /** The `source` and `.` commands run. */
  readonly sources: SyntaxNode[] = [];
  /** The first top-level statement of the unit of each top-level statement. */
  readonly unitStart = new Map<SyntaxNode, SyntaxNode>();
  /**
   * The functions surely defined once the script has run its top level: defined by a top-level statement of the
   * main shell (not in a branch, a subshell or a function), and never named by `unset`. A body that runs later
   * (no call reaches it, a trap's action) has them.
   */
  private sureLater = new Map<string, SyntaxNode>();
  /** The actions of `trap`, run after the top level (an EXIT trap with its state at the end). */
  private readonly traps: { script: NestedScript; host: SyntaxNode; st: ShellState; since: number; exit: boolean; exitOnly: boolean; dead: boolean }[] = [];
  /** The command whose alias, `eval` string or trap action is being run (its nodes are in their own tree). */
  private aliasHost: SyntaxNode | undefined;
  /** The walks of each function body: the state it was called with, and the state after it. */
  private readonly walks = new Map<SyntaxNode, { entry: ShellState; exit: ShellState; how: string; aborts: ShellState[]; maybes: ShellState[] }[]>();
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
  /** How deep the walk is in code that does not run here (a branch whose condition is decided): see `deadRun`. */
  private dead = 0;
  /** The nodes run on some walk that is not in dead code. */
  readonly live = new Set<SyntaxNode>();
  /** What each condition decided on each walk ('?': nothing), and the variables it read (`mixed`: with other values on other walks). */
  private readonly decisions = new Map<SyntaxNode, { outcomes: Set<string>; reads: Map<string, string | null>; mixed: boolean }>();
  /** The variables read by the conditions being decided, with their values (see `variableText`). */
  private readonly reading: Map<string, string | null>[] = [];
  /**
   * The function definitions whose body a call did not walk (more entry states than `WALKS_PER_FUNCTION`, a recursive
   * or too deep call) and the loops whose passes did not settle: the conditions in them are not decided.
   */
  private readonly unwalked = new Set<SyntaxNode>();
  /** Whether the expression being run has read a name the script has not set, taken as unset (see `variableText`). */
  private assumed = false;
  /** Where jumps go (see `Target`). */
  private readonly targets: Target[] = [];
  /** How deep the walk is in a place where `set -e` does not stop the shell (a condition, the left side of `&&`, `!`). */
  private quiet = 0;
  /** Nothing is trusted (src/semantics/trust.ts): no condition is decided, and every jump may be made or not. */
  private readonly blind: boolean;
  /**
   * Why nothing should be trusted, found on the way: arithmetic read a variable that no path has set (its value may
   * come from the environment, as text bash runs, which may assign anything). The script is then walked again, blind.
   */
  found: string | undefined;

  /** Sets `found`, and stops the walk (`WalkAgain`): it is made again, with nothing trusted. */
  private walkAgain(why: string): never {
    this.found = why;
    throw new WalkAgain();
  }

  /** The names the actions of the traps set so far change (not EXIT's): a signal may run them between any two later statements. */
  private readonly trapKeys = new Set<string>();
  /**
   * Set while a trap's action is walked only for what it changes (`trap`): its nodes, the calls and the walks of the
   * bodies it calls are not recorded (the action runs later, with the state of then).
   */
  private silent = 0;

  constructor(private readonly shell: Shell | undefined, private readonly posix: boolean, private readonly scripts: Scripts, private readonly trust: Trust) {
    this.bash = !shell || shell === 'bash';
    this.blind = trust.blind !== undefined;
  }

  private put<K extends Kind>(st: ShellState, kind: K, name: string, value: Entry<K> | undefined): ShellState {
    const key = `${kind} ${name}`;
    this.lastChange.set(key, ++this.changeCount);
    this.lastAt.set(key, this.node!);
    // (A local of a function being run is gone when it returns: not a write of the shell's own.)
    if (kind === 'variables' && !this.frames.some((f) => f.saved.has(name))) {
      const set = this.varWrites.get(this.node!) ?? new Set<string>();
      this.varWrites.set(this.node!, set.add(name));
    }
    for (const c of this.collecting) c.add(key);
    return { ...st, [kind]: (st[kind] as NameMap<Entry<K>>).with(name, value) };
  }

  private record(n: SyntaxNode, st: ShellState): void {
    if (this.silent) return;
    if (!this.dead) this.live.add(n);
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

  /**
   * The state another shell starts with (`bash -c`, docs/design/semantics.md 4.13): the variables of `outer` that
   * reach it through `env` (exported, with a value: an array is not passed), and those the slots set (`given`); the
   * exported functions, when it is bash and every link passes them; the set options with an exported SHELLOPTS, the
   * shopt options with an exported BASHOPTS (bash); then the options it is started with (`bash -e -O extglob -c`). A
   * shell that reads startup files (`-l`, `-i`, an exported BASH_ENV) may have any name the script has.
   */
  childStart(outer: ShellState, env: ExecEnv, pass: ChildPass, at: SyntaxNode): ShellState {
    let st = this.initial();
    const exported = (name: string): boolean => (outer.variables.get(name)?.attrs.x?.state ?? 'off') === 'on';
    const reach = reachOf(env, exported('SHELLOPTS'));
    // (`sh` may be bash, which reads exported functions, SHELLOPTS and BASHOPTS, or dash, which reads none.)
    const bashLike: Tri = this.bash ? 'on' : this.shell === 'sh' ? 'unknown' : 'off';
    if (reach.variables !== 'none') {
      let vars = outer.variables.mapped(passed, passedMemo);
      for (const name of pass.removed) vars = vars.with(name, undefined);
      st = { ...st, variables: vars };
    }
    // (`env -i x=1 bash -c …` passes `x`.)
    for (const name of pass.given) if (NAME.test(name)) st = { ...st, variables: st.variables.with(name, { declared: 'on', set: 'on', attrs: { x: { state: 'on', at } }, at }) };
    if (reach.functions === 'exported' && bashLike !== 'off') {
      const fns = new Map<string, FunctionState>();
      for (const [name, f] of outer.functions) {
        if (f.state === 'off' || f.exported === 'off') continue;
        fns.set(name, { state: f.state === 'on' && f.exported === 'on' && bashLike === 'on' ? 'on' : 'unknown', def: f.def, exported: 'on', readonly: 'off', ...(bashLike === 'unknown' ? { imported: 'sh' as const } : {}) });
        // (Its body is walked where this shell calls it.)
        this.collectDefinitions(f.def);
      }
      st = { ...st, functions: st.functions.withAll(fns) };
    }
    // (bash turns on the options SHELLOPTS and BASHOPTS name; it turns none off.)
    const inherit = (kind: 'set' | 'shopt', on: boolean): void => {
      if (!on || bashLike === 'off') return;
      const opts = new Map<string, OptionState>();
      for (const [name, o] of outer[kind]) if (o === 'on' || o === 'unknown') opts.set(name, o === 'on' && bashLike === 'on' ? 'on' : 'unknown');
      st = { ...st, [kind]: st[kind].withAll(opts) };
    };
    // The options it is started with: `-e`, `+x`, `-o pipefail`, `-O extglob` (bash), `--posix`; `-l` and `-i` read
    // startup files.
    let startup = false;
    for (const { flag, value } of pass.invocation) {
      const on = flag[0] === '-';
      const letter = flag.slice(1);
      if (flag === '--posix') st = this.setPosix(st, true, at);
      else if (['-l', '--login', '-i'].includes(flag)) startup = true;
      else if (/^[-+]o$/.test(flag) && value) st = value === 'posix' ? this.setPosix(st, on, at) : { ...st, set: st.set.with(value, on ? 'on' : 'off') };
      else if (/^[-+]O$/.test(flag) && value) st = { ...st, shopt: st.shopt.with(value, on ? 'on' : 'off') };
      else if (SET_LETTERS[letter]) st = { ...st, set: st.set.with(SET_LETTERS[letter], on ? 'on' : 'off') };
    }
    // (Then bash turns on the options an exported SHELLOPTS and BASHOPTS name, also those turned off above.)
    inherit('set', reach.options !== 'none');
    inherit('shopt', reachOf(env, exported('BASHOPTS')).options !== 'none');
    // bash runs the file an exported BASH_ENV names before the string: what it sets is not known here, as for the
    // startup files.
    const bashEnv = st.variables.get('BASH_ENV');
    if (this.bash && bashEnv && bashEnv.set !== 'off' && bashEnv.value !== '') startup = true;
    if (startup) {
      this.turnOpaque();
      // (What they run is not read: nothing is trusted.)
      if (!this.blind) this.walkAgain('another shell runs its startup files first');
      const vars = new Map<string, VariableState>();
      for (const [name, v] of outer.variables) if (!st.variables.has(name)) vars.set(name, { declared: 'unknown', set: 'unknown', attrs: {}, at: v.at });
      const fns = new Map<string, FunctionState>();
      for (const [name, f] of outer.functions) if (!st.functions.has(name)) fns.set(name, { state: 'unknown', def: f.def, exported: 'unknown', readonly: 'off', imported: 'startup' });
      st = { ...st, variables: st.variables.withAll(vars), functions: st.functions.withAll(fns) };
    }
    return st;
  }

  /** Records the function definitions and the `alias` commands under `root`. */
  private collectDefinitions(root: SyntaxNode): void {
    for (const f of descendants(root, ['function_definition'])) {
      const name = field(f, 'name')!.text;
      const defs = this.functionDefs.get(name) ?? [];
      if (!defs.includes(f)) this.functionDefs.set(name, [...defs, f]);
    }
    for (const c of descendants(root, ['command'])) {
      if (commandName(c) !== 'alias') continue;
      for (const a of fields(c, 'argument')) {
        const name = this.aliasOf(a)?.name;
        const defs = name ? this.aliasDefs.get(name) ?? [] : [];
        if (name && !defs.includes(c)) this.aliasDefs.set(name, [...defs, c]);
      }
    }
  }

  /**
   * What the trust scan found of the statement `n`: the script's scan for its own statements, the scan of a string
   * (src/semantics/trust.ts reads the string as foreign text, whose nodes are not the walk's) for those of a string.
   */
  private facts(n: SyntaxNode): Trust {
    if (this.blind) return this.trust;
    const root = rootOf(n);
    // (Read to its end: a string's scan may find a reason to trust nothing, but its facts still hold.)
    return root === this.root ? this.trust : scriptTrust(root, false);
  }

  /** The root of the tree the walk starts from. */
  private root: SyntaxNode | undefined;

  program(root: SyntaxNode, start: ShellState): ShellState {
    this.root = root;
    this.collectDefinitions(root);
    const unset = new Set([...descendants(root, ['unset_command']).flatMap((u) => u.namedChildren),
      ...descendants(root, ['command']).filter((c) => commandName(c) === 'unset').flatMap((c) => fields(c, 'argument'))].map((w) => staticWordValue(w) ?? w.text));
    for (const def of descendants(root, ['function_definition'])) {
      // (At the top level, or first in a list there: `f() { …; } && complete -F f x` always defines it.)
      let x = def;
      while (x.parent?.type === 'list' && x.parent.namedChildren[0] === x) x = x.parent;
      const name = field(def, 'name')!.text;
      if (x.parent === root && !unset.has(name) && !subshellReasons(x).length) this.sureLater.set(name, def);
    }
    // The units bash reads at once: the top-level statements that share a line.
    const program: Target = { kind: 'program', dead: 0, exits: [] };
    this.targets.push(program);
    let end = this.units(root.namedChildren.filter((c) => STATEMENTS.has(c.type)), start).end;
    this.targets.pop();
    // (The script also ends at an `exit`.)
    end = merge([end, ...program.exits], this.posix);
    this.runTraps(end);
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
          // (It may be called from outside the script, with any values: its conditions are not decided.)
          this.unwalked.add(def);
          const since = this.changeAtDefinition.get(def)!;
          const after = new Set([...this.lastChange].filter(([, i]) => i > since).map(([k]) => k));
          this.walks.set(def, []);
          this.walkBody(def, this.widen(at, after), { def, saved: new Map() });
        }
      }
    }
  }

  /**
   * The actions of `trap`, for the calls they make: they run later, when a signal comes or (EXIT) when the script
   * ends, so each runs from the state when it was set, with what the script changes after that taken as unknown;
   * an EXIT trap set at the top level, from the state at the end.
   */
  private runTraps(end: ShellState): void {
    // (An action may set a trap of its own: it is walked in the next round.)
    for (let round = 0; round < NESTED_DEPTH && this.traps.length; round++) for (const t of this.traps.splice(0)) {
      const after = new Set([...this.lastChange].filter(([, i]) => i > t.since).map(([k]) => k));
      const st = t.exit && this.topLevel(t.host) ? end : this.widen(t.st, after);
      this.trapAction(t.script, t.host, st, t.exitOnly, t.dead);
    }
  }

  /** Whether `n` is a statement of the top level, in the main shell. */
  private topLevel(n: SyntaxNode): boolean {
    for (let x = n; x.parent; x = x.parent) {
      if (subshellReasons(x).length || (x.parent.parent && x.parent.type !== 'list' && x.parent.type !== 'redirected_statement')) return false;
    }
    return true;
  }


  /**
   * `st` with the names in `keys` (`kind name`) taken as unknown; but a function surely defined by the top level
   * (`sureLater`) is defined.
   */
  private widen(st: ShellState, keys: Set<string>): ShellState {
    const changes = { set: new Map(), shopt: new Map(), variables: new Map(), functions: new Map(), aliases: new Map(), disabled: new Map(), hashed: new Map() } as { [K in Kind]: Map<string, Entry<K>> };
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
        const sure = this.sureLater.get(name);
        if (sure) {
          if (f?.state !== 'on') changes.functions.set(name, { state: 'on', def: f?.def ?? sure, exported: f?.exported ?? 'unknown', readonly: f?.readonly ?? 'unknown' });
        } else if (!f) changes.functions.set(name, { state: 'unknown', def: defs[defs.length - 1], exported: 'unknown', readonly: 'unknown' });
        else if (f.state !== 'unknown') changes.functions.set(name, { ...f, state: 'unknown' });
      } else if (kind === 'disabled' || kind === 'hashed') {
        const e = st[kind].get(name);
        if (e?.state !== 'unknown') changes[kind].set(name, { state: 'unknown', value: e?.value ?? '', at: e?.at ?? this.lastAt.get(key)! });
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
    // (The status, and whether the path gets here, stay.)
    return {
      ...st,
      set: st.set.withAll(changes.set), shopt: st.shopt.withAll(changes.shopt), variables: st.variables.withAll(changes.variables),
      functions: st.functions.withAll(changes.functions), aliases: st.aliases.withAll(changes.aliases),
      disabled: st.disabled.withAll(changes.disabled), hashed: st.hashed.withAll(changes.hashed),
    };
  }

  /**
   * Runs `statements` (top-level ones, of the script or of a string it runs), a line at a time: the statements that
   * share a line are read at once (their aliases and extglob count from the next line), and an expansion error
   * discards the rest of the line (see `abort`). `sure`: the shell surely got to the last statement (see `sequence`).
   */
  private units(statements: readonly SyntaxNode[], st: ShellState): { end: ShellState; sure: boolean } {
    let sure = true;
    for (let i = 0; i < statements.length;) {
      let j = i + 1;
      while (j < statements.length && statements[j - 1].endPosition.row === statements[j].startPosition.row) j++;
      const unit: Target = { kind: 'unit', dead: this.dead, aborts: [], maybes: [] };
      this.targets.push(unit);
      const first = statements[i];
      for (const t of statements.slice(i, j)) {
        this.unitStart.set(t, first);
        this.parseAt.set(t, t === first ? reached(st) : this.parseAt.get(first)!);
        this.expand = this.parseAt.get(t)!;
        if (t !== statements[0] && !this.goesOn(st)) sure = false;
        st = this.run(t, st);
      }
      this.targets.pop();
      if (unit.aborts.length || unit.maybes.length) {
        st = merge([st, ...unit.aborts, ...unit.maybes], this.posix);
        sure = false;
      }
      i = j;
    }
    return { end: st, sure };
  }

  /**
   * Runs the statements among `nodes`, in order. Their status is the last one's, when the shell surely gets to it
   * (see `goesOn`); else it is not known.
   */
  private sequence(nodes: readonly SyntaxNode[], st: ShellState): ShellState {
    let ran = false;
    let sure = true;
    for (const n of nodes) {
      if (!STATEMENTS.has(n.type)) continue;
      if (ran && !this.goesOn(st)) sure = false;
      st = this.run(n, st);
      ran = true;
    }
    return ran && sure ? st : withStatus(st, undefined);
  }

  /**
   * Whether the shell surely goes on to the next statement after the one that left `st`: its status is known, and is 0
   * where `set -e` may be on or a trap may be set (an ERR trap may exit). (A statement that may leave otherwise, `exit`,
   * `return`, a function, has no known status.)
   */
  private goesOn(st: ShellState): boolean {
    if (st.status === undefined) return false;
    const errexit = option(st, 'set', 'errexit');
    // (Where the status is tested, `set -e` does not stop the shell.)
    return st.status === 0 || ((errexit === 'off' || errexit === 'default' || this.quiet > 0) && !this.opaque);
  }

  /** Runs `nodes` from `st` as code that does not run here: for the states of their nodes; what they change is dropped, and their conditions are not recorded. */
  private deadRun(nodes: readonly SyntaxNode[], st: ShellState): void {
    this.dead++;
    try {
      this.sequence(nodes, st);
    } finally {
      this.dead--;
    }
  }

  /**
   * `break` or `continue` (`count`: their N, undefined when not known), `return` or `exit`, run from `st`: the state
   * goes where the jump leads (the end of a loop or of its pass, of a function body, of the script), and the path does
   * not go on. A jump that may fail (no loop, a count not known), may be made in a subshell, or is not `sure` (an
   * error from values not trusted), or anywhere when nothing is trusted (`exit` may be a function a sourced file
   * defined), is both made and not.
   */
  private jump(kind: 'break' | 'continue' | 'return' | 'exit', count: number | undefined, st: ShellState, sure = true): ShellState {
    st = withStatus(st, undefined);
    const collect = (t: { dead: number }, to: ShellState[]): void => {
      if (t.dead === this.dead) to.push(st);
    };
    let maybe = !sure || this.blind;
    if (kind === 'break' || kind === 'continue') {
      // The loops it can leave: those of this function body and process (bash: "only meaningful in a loop" otherwise).
      const loops: Extract<Target, { kind: 'loop' }>[] = [];
      let surely = 0;
      let trap: Extract<Target, { kind: 'trap' }> | undefined;
      for (const t of [...this.targets].reverse()) {
        if (t.kind === 'maybe') maybe = true;
        else if (t.kind === 'unit') continue;
        else if (t.kind === 'trap') {
          trap = t;
          break;
        } else if (t.kind !== 'loop') break;
        else {
          loops.push(t);
          if (!maybe) surely++;
        }
      }
      // (More loops than the trap's action holds: it may leave those a signal interrupts.)
      if (trap && (count === undefined || count > loops.length)) this.escape(trap);
      const to = (t: Extract<Target, { kind: 'loop' }>): ShellState[] => (kind === 'break' ? t.breaks : t.continues);
      // (`break 5` in two loops leaves both.)
      const at = count === undefined ? undefined : Math.min(count, loops.length);
      if (at !== undefined && at > 0 && at <= surely) {
        collect(loops[at - 1], to(loops[at - 1]));
        return unreachable(st);
      }
      for (const t of loops) collect(t, to(t));
      return st;
    }
    for (let i = this.targets.length - 1; i >= 0; i--) {
      const t = this.targets[i];
      if (t.kind === 'maybe') maybe = true;
      else if (t.kind === 'trap' && kind === 'return') {
        this.escape(t);
        return st;
      } else if (t.kind === 'subshell') {
        // It ends the subshell: `return` only in a function (else it fails, and the subshell goes on).
        if (kind === 'return' && !this.targets.slice(0, i).some((x) => x.kind === 'function')) return st;
        return maybe ? st : unreachable(st);
      } else if (t.kind === 'function' && kind === 'return') {
        collect(t, t.returns);
        return maybe ? st : unreachable(st);
      } else if (t.kind === 'program') {
        if (kind === 'return') return st;
        collect(t, t.exits);
        return maybe ? st : unreachable(st);
      }
    }
    // (Outside the script's walk: a trap's action, a body no call reached.)
    return kind === 'return' || maybe ? st : unreachable(st);
  }

  /**
   * An error in an expansion (`$(( 1 / 0 ))`, from `st`): bash discards the rest of the line of top-level statements
   * that holds it (`unit`), also from a function it calls, or ends the subshell. One that is not `sure` (from values
   * not trusted, or that may not be expanded) may happen or not.
   */
  private abort(st: ShellState, sure: boolean): ShellState {
    st = withStatus(st, undefined);
    const ends = sure && !this.blind;
    // (An error that may happen in a string `eval` runs may end the line of `eval` too: bash does so for an integer
    // given text that is no expression, or a subscript that fails.)
    for (let i = this.targets.length - 1; i >= 0; i--) {
      const t = this.targets[i];
      // (A last stage of a pipeline that may run in a subshell: it ends that, or the line.)
      if (t.kind === 'subshell') return ends ? unreachable(st) : st;
      if (t.kind === 'trap') {
        this.escape(t);
        return st;
      }
      if (t.kind === 'unit') {
        if (t.dead === this.dead) (ends ? t.aborts : t.maybes).push(st);
        if (ends) return unreachable(st);
      }
    }
    // (Outside the script's walk: a trap's action, a body no call reached.)
    return ends ? unreachable(st) : st;
  }

  /** The line an error here would end (see `abort`): none in a subshell, or outside the script's walk. */
  private unitTarget(): Extract<Target, { kind: 'unit' }> | undefined {
    for (let i = this.targets.length - 1; i >= 0; i--) {
      const t = this.targets[i];
      if (t.kind === 'subshell') return undefined;
      if (t.kind === 'unit') return t;
    }
    return undefined;
  }

  /** Runs `run` where `set -e` does not stop the shell (a condition, the left side of `&&` or `||`, after `!`). */
  private quietly<T>(run: () => T): T {
    this.quiet++;
    try {
      return run();
    } finally {
      this.quiet--;
    }
  }

  /** Runs `run` (a condition), with the variables it reads. */
  private reads<T>(run: () => T): { value: T; reads: Map<string, string | null> } {
    const reads = new Map<string, string | null>();
    this.reading.push(reads);
    try {
      return { value: run(), reads };
    } finally {
      this.reading.pop();
    }
  }

  /** Records what the condition of `n` decided on this walk (undefined: nothing), with what it read. */
  private decide(n: SyntaxNode, outcome: string | undefined, reads: ReadonlyMap<string, string | null>): void {
    if (this.dead) return;
    let d = this.decisions.get(n);
    if (!d) this.decisions.set(n, (d = { outcomes: new Set(), reads: new Map(), mixed: false }));
    d.outcomes.add(outcome ?? '?');
    for (const [k, v] of reads) {
      if (d.reads.has(k) && d.reads.get(k) !== v) d.mixed = true;
      d.reads.set(k, v);
    }
  }

  /** What the condition of `n` decided on every walk, if anything; `reads` is empty when its values differed between walks. */
  decision(n: SyntaxNode): Decision | undefined {
    const d = this.decisions.get(n);
    if (!d || d.outcomes.size !== 1 || d.outcomes.has('?') || !this.everywhere(n)) return undefined;
    return { outcome: [...d.outcomes][0], reads: d.mixed ? new Map() : d.reads };
  }

  /**
   * Whether what the walks found at `n` holds wherever it runs: not when nothing is trusted, in a function body that
   * may run where the walk does not see it (src/semantics/trust.ts: `closed`), in one not walked at some call, or in
   * a loop whose passes did not settle.
   */
  everywhere(n: SyntaxNode): boolean {
    /* c8 ignore next -- a guard: with nothing trusted, no condition is decided and no path ends, so nothing asks */
    if (this.blind) return false;
    // (A definition itself runs where it stands: its body is what may run elsewhere.)
    let root = n;
    for (let x: SyntaxNode | null = n.type === 'function_definition' ? n.parent : n; x; x = x.parent) {
      if (this.unwalked.has(x) || (x.type === 'function_definition' && !this.trust.closed(field(x, 'name')!.text))) return false;
      root = x;
    }
    // (Nor in a trap's action, or a string it runs: a signal, an error or `exit` may run it at any point, with values
    // the walk does not see there.)
    for (let s = this.scripts.byRoot.get(root); s; s = this.scripts.byRoot.get(rootOf(s.words[0]))) if (s.kind === 'later') return false;
    return true;
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
    // (After a jump, the rest is dead code: walked from the state there, for the states of its nodes.)
    if (st.unreachable) {
      this.dead++;
      try {
        this.run(n, reached(st));
      } finally {
        this.dead--;
      }
      return st;
    }
    this.record(n, st);
    // (Arithmetic the walk does not run: a subscript, an offset, `[[ x -eq y ]]`; a key of an array that must be
    // associative here, else it is arithmetic too. One that may fail may discard the rest of the line: see `abort`.)
    const facts = this.facts(n);
    for (const name of facts.arithNames(n) ?? []) this.unsetRead(st, name);
    if (facts.mayFail(n)) this.abort(st, false);
    for (const name of facts.associative(n) ?? []) {
      if (!this.dead && !this.blind && attribute(st, name, 'A') !== 'on') this.walkAgain(`\`${name}\` may not be associative where its subscript is read`);
    }
    const outer = this.node;
    this.node = n;
    const reasons = subshellReasons(n);
    if (reasons.length) this.targets.push({ kind: 'subshell' });
    try {
      const ran = this.runStatement(n, st);
      const after = withStatus(ran, this.statusOf(n, st, ran));
      // (A job and a coproc are started: 0.)
      const out = this.errexit(n, st, reasons.length ? withStatus(st, reasons.includes('background') || reasons.includes('coproc') ? 0 : after.status) : after);
      // (A trap's action may run after any statement, when its signal comes.)
      return this.trapKeys.size ? this.widen(out, this.trapKeys) : out;
    } catch (e) {
      // (An expansion error in a subshell of its own, `$((1/0)) &`, ends it there.)
      if (e instanceof ExpansionError) return reasons.length ? withStatus(st, undefined) : e.exit ? this.jump('exit', undefined, e.st, e.sure) : this.abort(e.st, e.sure);
      /* c8 ignore next -- only an expansion error is thrown on purpose */
      throw e;
    } finally {
      if (reasons.length) this.targets.pop();
      this.node = outer;
    }
  }

  /**
   * The state after the statement `n`, run from `st` and leaving `after`: under `set -e` (surely on), a command that
   * surely fails, where its status is not tested, ends the shell (the subshell).
   */
  private errexit(n: SyntaxNode, st: ShellState, after: ShellState): ShellState {
    if (this.quiet || !after.status || !ERREXIT_STOPS.has(n.type) || option(st, 'set', 'errexit') !== 'on') return after;
    // (The last stage of a pipeline: the pipeline's status counts.)
    if (n.parent?.type === 'pipeline') return after;
    return this.jump('exit', undefined, after);
  }

  private runStatement(n: SyntaxNode, st: ShellState): ShellState {
    switch (n.type) {
      case 'command': return this.command(n, st);
      case 'declaration_command': {
        // Its words are expanded, then its redirections are made, then it runs.
        this.substitutions(n, st);
        st = this.redirections(n, this.defaults(n, st), 'off');
        const words = n.namedChildren.filter((c) => !c.type.endsWith('redirect'));
        return this.orFunction(n.children[0].type, st, (s) => this.declare(n.children[0].type, words, readDeclaration(n), n, s));
      }
      case 'unset_command':
        this.substitutions(n, st);
        st = this.redirections(n, this.defaults(n, st), 'off');
        return this.orFunction('unset', st, (s) => this.unset(n.namedChildren, n, s));
      case 'variable_assignment':
        this.substitutions(n, st);
        return this.assignNode(n, this.defaults(n, st), true);
      case 'variable_assignments':
        for (const a of n.namedChildren) {
          this.record(a, st);
          this.substitutions(a, st);
          st = this.assignNode(a, this.defaults(a, st), true);
        }
        return st;
      case 'test_command': case 'extended_test':
        this.substitutions(n, st);
        return this.defaults(n, st);
      case 'arithmetic_command': {
        this.substitutions(n, st);
        // (`(( ))` with nothing in it is not decided.)
        const r = this.arithStatus(n.namedChildren, this.defaults(n, st));
        return withStatus(r.st, n.namedChildren.length ? r.status : undefined);
      }
      case 'negated_command': return this.quietly(() => this.sequence(n.children, st));
      case 'time_statement': case 'compound_statement':
        return this.sequence(n.children, st);
      case 'redirected_statement': {
        // A compound command makes its redirections first; a simple command expands its words first (see `redirections`),
        // and assignments alone are made before them.
        for (const r of fields(n, 'redirect')) this.substitutions(r, st);
        const body = field(n, 'body');
        const simple = !!body && SIMPLE.includes(body.type);
        // (A subshell makes them in its own process: `( : ) > $(( n = 3 ))` leaves n.)
        if (!simple) st = this.fdVariables(fields(n, 'redirect'), this.expandAll(fields(n, 'redirect'), st, body?.type === 'subshell' ? 'on' : 'off'));
        st = this.sequence(n.children.filter((c) => c.field !== 'redirect'), st);
        return body?.type.startsWith('variable_assignment') ? withStatus(this.fdVariables(fields(n, 'redirect'), this.expandAll(fields(n, 'redirect'), st, 'off')), st.status) : st;
      }
      case 'subshell':
        return this.sequence(n.children, st);
      case 'coproc_statement': {
        // `NAME` (`COPROC`) is an array of the coprocess's fds, and `NAME_PID` its PID; bash unsets them when the
        // coprocess has ended (may be).
        const name = field(n, 'name')?.text ?? 'COPROC';
        st = this.sequence(n.children, st);
        return merge([st, this.setVariable(this.giveAttribute(this.setVariable(st, name, n, undefined, false, true), name, 'a', n), `${name}_PID`, n, undefined)], this.posix);
      }
      case 'pipeline': return this.pipeline(n, st);
      case 'list': {
        // (`a &&` while typing has no right side yet.)
        const [left, right] = n.namedChildren;
        if (!right) return this.run(left, st);
        // The right side runs when the left one succeeds (`&&`) or fails (`||`); when that is known, the other path is dead.
        const and = n.children.some((c) => c.type === '&&');
        const { value: after, reads } = this.reads(() => this.quietly(() => this.run(left, st)));
        const ok = after.status === undefined || this.blind ? undefined : after.status === 0;
        this.decide(n, ok === undefined ? undefined : String(ok), reads);
        if (ok !== undefined && ok !== and) {
          this.deadRun([right], after);
          return after;
        }
        const r = this.run(right, after);
        return ok === undefined ? merge([after, r], this.posix) : r;
      }
      case 'if_statement': return this.ifStatement(n, st);
      case 'case_statement': {
        const before = st;
        this.substitutions(field(n, 'value')!, st);
        st = this.defaults(field(n, 'value')!, st);
        // The patterns are expanded in turn until one matches: the first one always, the others may be.
        const items = n.namedChildren.filter((c) => c.type === 'case_item');
        items.flatMap((item) => fields(item, 'value')).forEach((v, i) => {
          this.substitutions(v, st);
          // (Like a word that may not be expanded: an error there may not happen.)
          const after = this.defaults(v, st, i === 0 ? 'off' : 'unknown');
          st = i === 0 || after === st ? after : merge([st, after], this.posix);
        });
        const runs = this.caseRuns(n, items, before);
        if (runs) {
          // The lists that run, in order, each from the state the one before left; the others are dead.
          let cur = withStatus(st, 0);
          items.forEach((item, i) => {
            if (runs.includes(i)) cur = this.sequence(item.children, cur);
            else this.deadRun(item.children, st);
          });
          return cur;
        }
        const ends: ShellState[] = [];
        let always = false;
        // A list may start from the entry state (its pattern is tested), from the end of the list just before it when
        // that one ends with `;&` (bash runs the next list), or from the end of any list before it that ends with `;;&`
        // (bash goes on testing the patterns after it).
        const tested: ShellState[] = [];
        let fallen: ShellState | undefined;
        for (const item of items) {
          const from = [...tested, ...(fallen ? [fallen] : [])];
          const end = this.sequence(item.children, from.length ? merge([st, ...from], this.posix) : st);
          ends.push(end);
          const term = item.children.find((c) => c.type === ';&' || c.type === ';;&')?.type;
          if (term === ';;&') tested.push(end);
          fallen = term === ';&' ? end : undefined;
          // A `*)` branch takes every value that reaches it.
          if (fields(item, 'value').some((v) => v.text === '*')) always = true;
        }
        return merge(always ? ends : [withStatus(st, 0), ...ends], this.posix);
      }
      case 'while_statement': {
        const body = field(n, 'body');
        const cond = n.children.filter((c) => c !== body);
        // (`until` goes on while its condition fails.)
        const until = n.children[0].type === 'until';
        return this.loop(n, st, { cond: (s) => this.sequence(cond, s), body: (s) => this.sequence(body?.children ?? [], s), endsWithCondition: true,
          holds: (status) => (status === undefined ? undefined : (status === 0) !== until) });
      }
      case 'for_statement': case 'select_statement': return this.forStatement(n, st);
      case 'c_style_for_statement': {
        // The initializer, then the condition, the body and the update, again and again; the loop ends after a condition.
        for (const c of n.namedChildren) if (c.type !== 'do_group') this.substitutions(c, st);
        // (When the initializer may fail, bash runs neither the condition nor the update: what they assign may be.)
        let unsure = false;
        const part = (f: 'initializer' | 'update') => (s: ShellState): ShellState => this.arithRun((x) => this.arithScript(fields(n, f), x, unsure).st, s);
        // (An empty condition is true.)
        const condition = (s: ShellState): ShellState => {
          const nodes = fields(n, 'condition');
          if (!nodes.length) return withStatus(s, 0);
          const r = this.arithStatus(nodes, s, unsure);
          return withStatus(r.st, r.status);
        };
        this.unsure = false;
        const init = part('initializer')(st);
        unsure = this.unsure;
        return this.loop(n, init, { cond: condition, body: (s) => this.sequence(field(n, 'body')?.children ?? [], s), update: part('update'), endsWithCondition: true,
          holds: (status) => (status === undefined ? undefined : status === 0) });
      }
      case 'function_definition': return this.functionDefinition(n, st);
    }
    /* c8 ignore next 2 -- every statement type is handled above */
    return st;
  }

  /** The state a command substitution `c` starts with: bash turns `set -e` off in it, unless inherit_errexit is on. */
  private substitutionState(c: SyntaxNode, st: ShellState): ShellState {
    const errexit = option(st, 'set', 'errexit');
    const inherit = option(st, 'shopt', 'inherit_errexit');
    if (c.type !== 'command_substitution' || !this.bash || errexit === 'off' || errexit === 'default' || inherit === 'on') return st;
    return { ...st, set: st.set.with('errexit', inherit === 'unknown' ? 'unknown' : 'off') };
  }

  /** Walks the command and process substitutions in `n` (not those of statements under it): each is a subshell. */
  private substitutions(n: SyntaxNode, st: ShellState): void {
    const sub = (c: SyntaxNode): void => {
      this.record(c, st);
      // A command substitution is read again when it runs: its aliases are those of the state then.
      const outer = this.expand;
      if (c.type === 'command_substitution') this.expand = st;
      this.targets.push({ kind: 'subshell' });
      try {
        this.sequence(c.children, this.substitutionState(c, st));
      } finally {
        this.targets.pop();
        this.expand = outer;
      }
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

  /**
   * `${x:=word}` and `${x=word}` in the words of `n` set `x` (to a value not known here); an arithmetic expansion
   * runs its assignments (`$(( n = 3 ))`), unless it is in an arithmetic expression, which runs it. Some run only
   * when bash gets to them, so what they assign may be: in an operand of `${…}` (`${s:$(( k = 1 ))}`), on the right
   * of `&&` or `||` in `[[ ]]`. The redirections of a program are expanded in its own process (`program`: whether
   * `n` is one of them). An error in an arithmetic expansion discards the rest of the command (`ExpansionError`).
   */
  private defaults(n: SyntaxNode, st: ShellState, program: Tri = 'off'): ShellState {
    let found = descendants(n, ['expansion', 'arithmetic_expansion']);
    // An assignment expands its value before its subscript (`a[$(( i++ ))]=$(( j = i ))` gives j=0; not with `declare`).
    const value = n.type === 'variable_assignment' ? field(n, 'value') : undefined;
    if (value) {
      const inValue = (e: SyntaxNode): boolean => e.startIndex >= value.startIndex && e.endIndex <= value.endIndex;
      found = [...found.filter(inValue), ...found.filter((e) => !inValue(e))];
    }
    for (const e of found) {
      let skip = false;
      let maybe = false;
      for (let x = e; x !== n; x = x.parent!) {
        const up = x.parent!;
        if (SUBSTITUTIONS.includes(up.type) || (e.type === 'arithmetic_expansion' && ARITH_HOSTS.includes(up.type))) skip = true;
        if ((e.type === 'arithmetic_expansion' && up.type === 'expansion') || (up.type === 'binary_expression' && x.field === 'right' && ['&&', '||'].includes(field(up, 'operator')!.type))) maybe = true;
      }
      if (skip || program === 'on') continue;
      if (program === 'unknown') maybe = true;
      let after: ShellState;
      if (e.type === 'arithmetic_expansion') {
        // (Whether it read values decisions do not trust: see `markAssumed`.)
        const assumed = this.assumed;
        this.assumed = false;
        try {
          const r = this.arithScript(e.namedChildren, st);
          after = r.st;
          // (A value not known may come from an error: a division by 0, text that is no expression.)
          if (r.value === undefined || this.unsure) this.abort(st, false);
        } catch (err) {
          /* c8 ignore next -- only an arithmetic error is thrown on purpose */
          if (!(err instanceof ArithError)) throw err;
          throw new ExpansionError(maybe ? merge([st, err.st], this.posix) : err.st, !maybe && !this.assumed);
        } finally {
          this.assumed ||= assumed;
        }
      } else {
        this.unsetError(e, st, maybe);
        after = this.defaultOf(e, st);
      }
      st = maybe && after !== st ? merge([st, after], this.posix) : after;
    }
    return st;
  }

  /**
   * `${x?word}` of an unset `x` (`${x:?word}`: or empty) ends the shell (bash: "parameter null or not set"), when the
   * state knows it is so; when that is not sure (a value decisions do not trust, a word that may not be expanded),
   * the shell may end there.
   */
  private unsetError(e: SyntaxNode, st: ShellState, maybe: boolean): void {
    const name = e.namedChildren[0];
    const colon = e.children.some((c) => c.type === ':?');
    if (name?.type !== 'variable_name' || !(colon || e.children.some((c) => c.type === '?'))) return;
    const target = this.resolve(st, name.text);
    const v = target === undefined ? undefined : st.variables.get(target);
    if (!v || !(v.set === 'off' || (colon && v.set === 'on' && v.value === '')) || v.declared === 'unknown') return;
    if (!maybe && this.trust.variable(name.text) && this.trust.variable(target!)) throw new ExpansionError(st, true, true);
    this.jump('exit', undefined, st, false);
  }

  /** `${x:=word}` sets `x`. */
  private defaultOf(e: SyntaxNode, st: ShellState): ShellState {
    const name = e.namedChildren[0];
    return e.children.some((c) => c.type === ':=' || c.type === '=') && name?.type === 'variable_name' ? this.setVariable(st, name.text, e, undefined) : st;
  }

  /** `defaults` of each of `nodes`, in turn. */
  private expandAll(nodes: readonly SyntaxNode[], st: ShellState, program: Tri = 'off'): ShellState {
    for (const r of nodes) st = this.defaults(r, st, program);
    return st;
  }

  /**
   * The redirections of the simple command `n`, made after its words are expanded: its own, and those of the
   * `redirected_statement` it is the body of (`program`: whether they are made in a process of its own).
   */
  private redirections(n: SyntaxNode, st: ShellState, program: Tri): ShellState {
    const outer = n.field === 'body' && n.parent!.type === 'redirected_statement' ? fields(n.parent!, 'redirect') : [];
    const all = [...n.namedChildren.filter((c) => c.field === 'redirect'), ...outer];
    return this.fdVariables(all, this.expandAll(all, st, program));
  }

  /**
   * `{name}>file` puts the number of the fd it opens in `name`: set, to a value not known here (may be: a program makes
   * its redirections in its own process).
   */
  private fdVariables(redirects: readonly SyntaxNode[], st: ShellState): ShellState {
    for (const r of redirects) {
      const name = /^\{([A-Za-z_]\w*)\}$/.exec(field(r, 'descriptor')?.text ?? '')?.[1];
      if (name) st = merge([st, this.setVariable(st, name, r, undefined)], this.posix);
    }
    return st;
  }

  /**
   * Whether the simple command `c` runs a program (not a builtin or a function), in a process of its own, where its
   * redirections are made; `unknown` when its name is not known here. `command cat` runs `cat` (`command -v` only
   * looks it up), and never a function.
   */
  private runsProgram(c: SyntaxNode, st: ShellState): Tri {
    let name = commandName(c);
    let args = fields(c, 'argument');
    let fn = true;
    while (name === 'command') {
      const inner = wrapped(name, args);
      if ('lookup' in inner) return 'off';
      ({ name, args } = inner);
      fn = false;
    }
    if (name === undefined) return 'unknown';
    if (!name || (fn && st.functions.has(name))) return 'off';
    if (!builtins[name] || !this.bashBuiltin(name)) return 'on';
    // A builtin turned off (`enable -n echo`) runs the program of its name.
    return st.disabled.get(name)?.state ?? 'off';
  }

  /**
   * Runs an arithmetic expression of the script (`(( ))`, a part of `for (( ))`, `$(( ))`), whose parts are `nodes`:
   * first its expansions, as bash does (`$x`, `${x}`, `$(( ))` and double quotes; `$x` is the value before the
   * expression runs, and a `$(( ))` in it runs then), then the text they give. Gives the state after it, and its value
   * when known; throws `ArithError` where bash fails. When what it does is not known here (`ArithUnknown`), the names
   * it seems to assign may be set, to values not known (`mayAssign`).
   */
  private arithScript(nodes: readonly SyntaxNode[], st: ShellState, unsure = false): { st: ShellState; value?: bigint } {
    return nodes.length ? this.arithGuard(arithSource(nodes), st, nodes[0], () => this.arithEval(nodes, st), unsure) : { st, value: 0n };
  }

  /** How many steps the expression being run has taken (`ARITH_STEPS`), and all the arithmetic of the script (`ARITH_WALK_STEPS`). */
  private arithSteps = 0;
  private arithWalkSteps = 0;
  /** How deeply the operators being run nest (`ARITH_NESTING`). */
  private arithNesting = 0;
  /**
   * Whether the expression being run has read a value not known here (`HOME`, an element of an array): bash runs it as
   * an expression too, which may fail, so what the expression assigns after it may be (`n='z = 9'` would also set z).
   */
  private unsure = false;

  /** Sets `unsure`, also for the value being read, if any. */
  private markUnsure(): void {
    this.unsure = true;
    const top = this.arithReads[this.arithReads.length - 1];
    if (top) top.unsure = true;
  }

  /**
   * Runs `run`, an expression whose text is `source`, from `st`: each expression of the script starts here, with a
   * count of its steps of its own. When what it does is not known, see `mayAssign`; `unsure` is then set, since it may
   * have failed. `unsure`: whether an expression before it in the same command may have failed (see `unsure`).
   */
  private arithGuard(source: string, st: ShellState, at: SyntaxNode, run: () => { st: ShellState; value?: bigint }, unsure = false): { st: ShellState; value?: bigint } {
    this.arithSteps = 0;
    this.unsure = unsure;
    try {
      if (this.arithWalkSteps > ARITH_WALK_STEPS) throw new ArithUnknown('limit');
      return run();
    } catch (e) {
      // (A text nested too deeply for the stack of JavaScript, in the parser or here, is not followed either.)
      if (!(e instanceof ArithUnknown) && !(e instanceof RangeError)) throw e;
      this.unsure = true;
      return { st: this.mayAssign(source, st, at) };
    }
  }

  /** `arithScript` with no guard: `ArithUnknown` goes up to the expression of the script that holds it. */
  private arithEval(nodes: readonly SyntaxNode[], st: ShellState): { st: ShellState; value?: bigint } {
    if (!nodes.length) return { st, value: 0n };
    const x = this.arithExpand(nodes, st, false);
    return this.arithText(x.text, x.st, nodes[0], false);
  }

  /**
   * The text of the expression `nodes` with its expansions done (`brackets`: only those in a subscript, as in a text
   * read as arithmetic: the others are an error there, when bash gets to them). Throws `ArithUnknown` when a text
   * pasted is not known.
   */
  private arithExpand(nodes: readonly SyntaxNode[], st: ShellState, brackets: boolean): { st: ShellState; text: string } {
    const source = arithSource(nodes);
    const from = nodes[0].startIndex;
    const pastes: SyntaxNode[] = [];
    const visit = (x: SyntaxNode): void => {
      if (PASTES.includes(x.type)) pastes.push(x);
      else x.children.forEach(visit);
    };
    nodes.forEach(visit);
    let text = '';
    let at = from;
    // How many brackets are open before the expansion: in `a[$i] + $j`, `$i` is in a subscript (depth 1), `$j` is not (0).
    let depth = 0;
    for (const p of pastes) {
      const plain = source.slice(at - from, p.startIndex - from);
      for (const c of plain) depth += c === '[' ? 1 : c === ']' ? -1 : 0;
      text += plain;
      at = p.endIndex;
      if (brackets && depth <= 0) {
        text += p.text;
        continue;
      }
      // (bash expands a subscript when it reads it: after what the text assigns before it, which is not followed when
      // the expansion may read it.)
      const reads = /^\$\{?([A-Za-z_]\w*)\}?$/.exec(p.text)?.[1];
      if (brackets && [...text.matchAll(ARITH_ASSIGNED)].some((m) => reads === undefined || (m[1] ?? m[3] ?? m[4]) === reads)) throw new ArithUnknown();
      const r = this.pasteText(p, st);
      st = r.st;
      text += r.text;
    }
    return { st, text: text + source.slice(at - from) };
  }

  /** The text that `p` (`$x`, `${x}`, `$(( ))`, `"…"`) pastes into an arithmetic expression; throws `ArithUnknown` when not known. */
  private pasteText(p: SyntaxNode, st: ShellState): { st: ShellState; text: string } {
    switch (p.type) {
      case 'simple_expansion': case 'expansion': {
        const name = /^\$\{?([A-Za-z_]\w*|\?)\}?$/.exec(p.text)?.[1];
        const text = name === undefined ? undefined : name === '?' ? this.lastStatus(st) : this.variableText(st, name);
        if (name !== undefined && name !== '?') this.unsetRead(st, name);
        if (text === undefined) throw new ArithUnknown();
        return { st, text: text ?? '' };
      }
      case 'arithmetic_expansion': {
        const r = this.arithEval(p.namedChildren, st);
        if (r.value === undefined) throw new ArithUnknown();
        return { st: r.st, text: String(r.value) };
      }
      case 'string': {
        let text = '';
        for (const c of p.namedChildren) {
          // (A backslash in double quotes is not followed here.)
          if (c.type === 'string_content' && !c.text.includes('\\')) text += c.text;
          else if (c.type === 'string_content') throw new ArithUnknown();
          else {
            const r = this.pasteText(c, st);
            st = r.st;
            text += r.text;
          }
        }
        return { st, text };
      }
    }
    // (Command output, `$'…'`: not known here.)
    throw new ArithUnknown();
  }

  /**
   * The text of `o`, an argument of `let`, once expanded; throws `ArithUnknown` when it is not known here (also when an
   * unquoted expansion may be split or globbed).
   */
  private letText(o: SyntaxNode, st: ShellState): { st: ShellState; text: string } {
    // (A `$(( ))` in it ran with the words of the command: its value is not kept.)
    if (descendants(o, ['arithmetic_expansion']).length) throw new ArithUnknown();
    let text = '';
    for (const p of o.type === 'concatenation' ? o.namedChildren : [o]) {
      const plain = staticWordValue(p) ?? (p.type === 'word' && !/[$`'"\\]/.test(p.text) ? p.text : undefined);
      const r = plain !== undefined ? { st, text: plain } : this.pasteText(p, st);
      if (plain === undefined && p.type !== 'string' && /[\s*?[]/.test(r.text)) throw new ArithUnknown();
      st = r.st;
      text += r.text;
    }
    return { st, text };
  }

  /**
   * `let` with the arguments `operands`: they are expanded (an error there discards the command, see `defaults`), then
   * each is run as an expression (`x*=3` is one, unless a file matches it). What one whose text is not known here
   * seems to assign may be set.
   */
  private letCommand(operands: readonly SyntaxNode[], st: ShellState): ShellState {
    const texts = operands.map((o) => {
      try {
        const x = this.letText(o, st);
        st = x.st;
        return x.text;
      } catch (e) {
        /* c8 ignore next -- `letText` throws `ArithUnknown` only */
        if (!(e instanceof ArithUnknown)) throw e;
        return undefined;
      }
    });
    // (bash stops at the first operand that fails: once one may have, what those after it assign may be.)
    let unsure = false;
    operands.forEach((o, i) => {
      const text = texts[i];
      if (text === undefined) {
        // (What its `$(( ))` assign was made with the words.)
        st = this.mayAssign(descendants(o, ['arithmetic_expansion']).reduce((t, a) => t.replace(a.text, ''), o.text), st, o);
        unsure = true;
        return;
      }
      const from = st;
      st = this.arithGuard(o.text, st, o, () => this.arithText(text, from, o, true), unsure).st;
      unsure = this.unsure;
    });
    return st;
  }

  /** The value of the variable `name` as text; null when it is unset (and `set -u` is off), undefined when not known here. */
  private variableText(st: ShellState, name: string): string | null | undefined {
    this.noteRead(st, name);
    const target = this.resolve(st, name);
    if (!target || DYNAMIC.test(target)) return undefined;
    const v = st.variables.get(target);
    const unset = ['off', 'default'].includes(option(st, 'set', 'nounset')) ? null : undefined;
    // (A name the script has not set may come from the environment: by custom, those are in capitals. Once a file
    // was sourced, a string run with `eval` or a trap set, it may come from there.)
    if (!v) {
      if (/^[A-Z_][A-Z0-9_]*$/.test(target) || this.opaque) return undefined;
      // (Taken as unset here, but not for deciding conditions: see `markAssumed`.)
      this.markAssumed();
      return unset;
    }
    if (v.declared === 'unknown' || v.set === 'unknown' || ['a', 'A'].some((l) => (v.attrs[l]?.state ?? 'off') !== 'off')) return undefined;
    const text = v.set === 'off' ? unset : v.value;
    // (Decisions read only the variables the script cannot change unseen: see src/semantics/trust.ts. A read in dead
    // code is no reason for a decision.)
    if (!this.trust.variable(name) || !this.trust.variable(target)) this.markAssumed();
    else if (text !== undefined && !this.dead) for (const r of this.reading) r.set(name, text);
    return text;
  }

  /**
   * Arithmetic reads `name` from `st`: when no path has set it (nor bash: `RANDOM`…), its value may come from the
   * environment, as text bash runs as an expression, which may assign any variable: nothing is trusted (see `found`).
   */
  private unsetRead(st: ShellState, name: string): void {
    if (this.dead || this.blind) return;
    const target = this.resolve(st, name) ?? name;
    if (!st.variables.get(target) && !NUMERIC_DYNAMIC.test(target)) this.walkAgain(`arithmetic reads \`${target}\`, which the script may not have set`);
  }

  /**
   * Sets `assumed`: the value was read from a name the script has not set, taken as unset, or from a variable that
   * decisions do not trust (src/semantics/trust.ts); good enough for the state, but not to decide a condition. Also for
   * the value being read as an expression, if any.
   */
  private markAssumed(): void {
    this.assumed = true;
    const top = this.arithReads[this.arithReads.length - 1];
    if (top) top.assumed = true;
  }

  /**
   * The names `text` seems to assign (`x = 1`, `i++`), also through the values of the variables it names (`x='i = 1'`),
   * which may be set from `st`, to values not known here.
   */
  private mayAssign(text: string, st: ShellState, at: SyntaxNode): ShellState {
    const targets = new Set<string>();
    for (const m of text.matchAll(ARITH_ASSIGNED)) targets.add(`${m[1] ?? m[3] ?? m[4]}${m[2] ? '[' : ''}`);
    for (const name of new Set(text.match(/[A-Za-z_]\w*/g))) for (const t of this.valueAssigns(st, name)) targets.add(t);
    let after = st;
    for (const t of targets) after = this.assign(after, t.replace('[', ''), t.endsWith('['), { append: false, text: undefined, array: false }, at, false);
    return after === st ? st : merge([st, after], this.posix);
  }

  /** What the values reached from the variable `name` seem to assign, each remembered with the variables it read. */
  private assignsMemo = new Map<string, { deps: ReadonlyMap<string, unknown>; targets: ReadonlySet<string> }>();

  /**
   * What the value of the variable `name` seems to assign, read as an expression, and the values of the variables it
   * names, in turn (see `mayAssign`): each name, followed by `[` for an element.
   */
  private valueAssigns(st: ShellState, name: string): ReadonlySet<string> {
    const hit = this.assignsMemo.get(name);
    if (hit && this.sameReads(st, hit.deps)) return hit.targets;
    const deps = new Map<string, unknown>([[NOUNSET, option(st, 'set', 'nounset')]]);
    const targets = new Set<string>();
    const texts: string[] = [];
    const seen = new Set<string>();
    let pure = true;
    const read = (n: string): void => {
      if (seen.has(n)) return;
      seen.add(n);
      const v = st.variables.get(n);
      deps.set(n, v);
      // (A nameref reads other variables: not remembered.)
      if (isNameref(v)) pure = false;
      const text = this.variableText(st, n);
      if (text) texts.push(text);
    };
    read(name);
    for (let t = texts.pop(); t !== undefined; t = texts.pop()) {
      for (const m of t.matchAll(ARITH_ASSIGNED)) targets.add(`${m[1] ?? m[3] ?? m[4]}${m[2] ? '[' : ''}`);
      for (const n of t.match(/[A-Za-z_]\w*/g) ?? []) read(n);
    }
    if (pure) this.assignsMemo.set(name, { deps, targets });
    return targets;
  }

  /** Whether the variables (and `set -u`) in `deps` are the same in `st`. */
  private sameReads(st: ShellState, deps: ReadonlyMap<string, unknown>): boolean {
    for (const [k, v] of deps) if ((k === NOUNSET ? option(st, 'set', 'nounset') : st.variables.get(k)) !== v) return false;
    return true;
  }

  /** Runs arithmetic (`run`) from `st`: an error stops it, with what was assigned before it. */
  private arithRun(run: (st: ShellState) => ShellState, st: ShellState): ShellState {
    try {
      return run(st);
    } catch (e) {
      if (e instanceof ArithError) return e.st;
      /* c8 ignore next -- only an arithmetic error is thrown on purpose */
      throw e;
    }
  }

  /** Runs `run`, a side of an expression bash may not take: an error in it may not happen, so it is not known. */
  private unsureSide(run: () => { st: ShellState; value?: bigint }): { st: ShellState; value?: bigint } {
    try {
      return run();
    } catch (e) {
      throw e instanceof ArithError ? new ArithUnknown() : e;
    }
  }

  /** Runs the arithmetic expressions `nodes` in turn, at `at` (see `arith`). */
  private arithList(nodes: readonly SyntaxNode[], st: ShellState, at: SyntaxNode): ShellState {
    for (const e of nodes) st = this.arith(e, st, at).st;
    return st;
  }

  /**
   * Runs the arithmetic expression `e` (6.5) from `st`: its assignments (`x = 1`, `y += 2`, `i++`), in the order bash
   * makes them, with their values when they are known. `e` is read from text whose expansions are done (`arithText`):
   * one left is an error, as are quotes. `at`: the node the assignments are made at. Gives the state after it, and its
   * value when known; throws `ArithError` where bash fails, `ArithUnknown` where it is not known.
   */
  private arith(e: SyntaxNode, st: ShellState, at: SyntaxNode): { st: ShellState; value?: bigint } {
    if (++this.arithSteps > ARITH_STEPS || ++this.arithWalkSteps > ARITH_WALK_STEPS || this.arithNesting >= ARITH_NESTING) throw new ArithUnknown('limit');
    this.arithNesting++;
    try {
      return this.arithNode(e, st, at);
    } finally {
      this.arithNesting--;
    }
  }

  /** `arith` of `e`, once its steps are counted. */
  private arithNode(e: SyntaxNode, st: ShellState, at: SyntaxNode): { st: ShellState; value?: bigint } {
    const sub = (x: SyntaxNode, s: ShellState): { st: ShellState; value?: bigint } => this.arith(x, s, at);
    switch (e.type) {
      case 'number': return { st, value: this.literal(e.text, st) };
      case 'variable_name': return this.arithValue(st, e.text, at);
      case 'word':
        // A name in `for (( ))`; an index the parser keeps as text (`a[i++]`), read again. Anything else is text the
        // parser could not read (`ArithUnknown`).
        if (NAME.test(e.text)) return this.arithValue(st, e.text, at);
        if (e.field === 'index') return this.arithText(e.text, st, at, false);
        throw new ArithUnknown();
      // An element of an array, once its index has run: its value is not followed (see `unsure`).
      case 'subscript': {
        const after = this.subscriptIndex(e, st, at);
        this.markUnsure();
        return { st: after };
      }
      case 'parenthesized_expression': {
        // (Its expressions are separated by commas: the last one gives the value.)
        let r: { st: ShellState; value?: bigint } = { st };
        for (const x of e.namedChildren) r = this.arith(x, r.st, at);
        return r;
      }
      case 'postfix_expression': case 'unary_expression': {
        const op = e.children.find((c) => !c.named)!.type;
        const operand = e.namedChildren[0];
        if (op === '++' || op === '--') {
          // (`incDecText` leaves no `++` or `--` before or after what is not a name: bash reads those as signs, or fails.)
          /* c8 ignore next */
          if (!['variable_name', 'subscript', 'word'].includes(operand.type)) throw new ArithUnknown();
          // `i++` is the value before, `++i` the value after.
          const r = this.arithAssign(operand, op === '++' ? '+=' : '-=', 1n, st, at);
          return { st: r.st, value: e.type === 'postfix_expression' ? r.old : r.value };
        }
        const r = sub(operand, st);
        const v = r.value;
        return { st: r.st, value: v === undefined ? undefined : op === '-' ? wrap(-v) : op === '!' ? BigInt(v === 0n) : op === '~' ? ~v : v };
      }
      case 'ternary_expression': {
        const consequence = field(e, 'consequence');
        const alternative = field(e, 'alternative');
        // (An operand missing is a syntax error: `1 ? 2 :`.)
        if (!consequence || !alternative) throw new ArithUnknown();
        const c = sub(field(e, 'condition')!, st);
        if (c.value !== undefined) return sub(c.value !== 0n ? consequence : alternative, c.st);
        // (Not known which branch: what either assigns may be.)
        const a = this.unsureSide(() => sub(consequence, c.st));
        const b = this.unsureSide(() => sub(alternative, c.st));
        return { st: merge([a.st, b.st], this.posix), value: a.value === b.value ? a.value : undefined };
      }
      case 'binary_expression': {
        const op = field(e, 'operator')!.type;
        const left = field(e, 'left')!;
        const right = field(e, 'right');
        // (An operand missing is a syntax error: `1 +`.)
        if (!right) throw new ArithUnknown();
        if (ARITH_ASSIGN.has(op)) return this.arithAssign(left, op, right, st, at);
        const l = sub(left, st);
        if (op === '&&' || op === '||') {
          // The right side runs only when the left one does not decide.
          if (l.value !== undefined && (l.value !== 0n) === (op === '||')) return { st: l.st, value: BigInt(op === '||') };
          const r = l.value === undefined ? this.unsureSide(() => sub(right, l.st)) : sub(right, l.st);
          if (l.value === undefined) return { st: r.st === l.st ? l.st : merge([l.st, r.st], this.posix) };
          return { st: r.st, value: r.value === undefined ? undefined : BigInt(r.value !== 0n) };
        }
        const r = sub(right, l.st);
        if (r.value !== undefined && arithError(op, r.value)) throw new ArithError(r.st);
        const v = l.value === undefined || r.value === undefined ? undefined : ARITH_OPS[op]?.(l.value, r.value);
        return { st: r.st, value: v === undefined ? undefined : wrap(v) };
      }
    }
    // An expansion left (`$z` from a value), quotes: bash fails, but where is not followed (`ArithUnknown`).
    throw new ArithUnknown();
  }

  /** The value of a constant (`010` is 8, `2#101` is 5); an invalid one (`08`, `0xG`) is an error. */
  private literal(text: string, st: ShellState): bigint | undefined {
    const lit = arithLiteral(text);
    if (lit?.type === 'invalid') throw new ArithError(st);
    return lit && wrap(BigInt(lit.value));
  }

  /** Runs the index of `target` (`a[i++]`): arithmetic, unless the array is associative (`m[i++]` is a key). */
  private subscriptIndex(target: SyntaxNode, st: ShellState, at: SyntaxNode): ShellState {
    const name = field(target, 'name')!.text;
    // (Whether the index runs depends on the array: a value read that reads it is remembered with it.)
    this.noteRead(st, name);
    const assoc = attribute(st, name, 'A');
    if (assoc === 'on') return st;
    if (assoc === 'unknown') {
      const after = this.unsureSide(() => ({ st: this.arithList(fields(target, 'index'), st, at) })).st;
      return after === st ? st : merge([st, after], this.posix);
    }
    return this.arithList(fields(target, 'index'), st, at);
  }

  /**
   * `target op right` (`x = 1`, `a[i] += 2`), or `++`/`--` of `target` (`right` is 1): the old value is read before the
   * right side runs, as bash does (not for `=`). `at`: see `arith`. Gives the new value and the old one, when known.
   */
  private arithAssign(target: SyntaxNode, op: string, right: SyntaxNode | bigint, st: ShellState, at: SyntaxNode): { st: ShellState; value?: bigint; old?: bigint } {
    const subscript = target.type === 'subscript';
    const name = subscript ? field(target, 'name')!.text : target.text;
    // Assigning to what is no variable (`(i = 1) = 2`, `x >= c /= 2`) is an error, once it has run.
    if (!NAME.test(name)) throw new ArithError(this.arith(target, st, at).st);
    let old: bigint | undefined;
    if (subscript) st = this.subscriptIndex(target, st, at);
    else if (op !== '=') ({ st, value: old } = this.arithValue(st, name, at));
    const r: { st: ShellState; value?: bigint } = typeof right === 'bigint' ? { st, value: right } : this.arith(right, st, at);
    st = r.st;
    if (r.value !== undefined && arithError(op.slice(0, -1), r.value)) throw new ArithError(st);
    // (Assigning a readonly variable is an error.)
    const resolved = this.resolve(st, name);
    if (resolved && attribute(st, resolved, 'r') === 'on') throw new ArithError(st);
    const by = op === '=' ? undefined : ARITH_OPS[op.slice(0, -1)];
    const v = r.value === undefined ? undefined : !by ? r.value : old === undefined ? undefined : by(old, r.value);
    const value = v === undefined ? undefined : wrap(v);
    const after = this.assign(st, name, subscript, { append: false, text: value === undefined ? undefined : String(value), array: false }, at, false);
    return { st: this.unsure && after !== st ? merge([st, after], this.posix) : after, value, old };
  }

  /** The variables whose values are being read as expressions, with the state each was read in. */
  private readonly arithReading: { name: string; st: ShellState }[] = [];
  /** The values read as expressions that are constants (`1 + 2`), or null. */
  private readonly constants = new Map<string, bigint | null>();
  /** What each value being read as an expression has read so far (see `arithValue`). */
  private readonly arithReads: ArithReads[] = [];
  /** The values of variables read as expressions, by name, with what each read (`ARITH_MEMO`, most recent first). */
  private arithMemo = new Map<string, ArithRemembered[]>();
  /** Whether a file was sourced, a string run with `eval` or a trap set: a name the script has not set may be set. */
  private opaque = false;

  /** `opaque` from now on: what was remembered of values read as expressions may be otherwise. */
  private turnOpaque(): void {
    if (this.opaque) return;
    this.opaque = true;
    this.arithMemo = new Map();
    this.assignsMemo = new Map();
  }

  /** Notes that the value being read as an expression (if any) depends on the variable `name` and on `set -u`. */
  private noteRead(st: ShellState, name: string): void {
    const top = this.arithReads[this.arithReads.length - 1];
    if (!top) return;
    const v = st.variables.get(name);
    top.deps.set(name, v);
    top.deps.set(NOUNSET, option(st, 'set', 'nounset'));
    // (A nameref reads other variables: not remembered.)
    if (isNameref(v)) top.pure = false;
  }

  /** The value of `name` remembered for `st`: one whose reads are the same in `st`. */
  private remembered(st: ShellState, name: string): ArithRemembered | undefined {
    return this.arithMemo.get(name)?.find((m) => this.sameReads(st, m.deps));
  }

  /**
   * The value of the variable `name` in arithmetic: an unset or empty one is 0; a value is an expression, run where
   * it is read (`y=x` gives x's value, `y='z = 4'` sets z), with the expansions in its subscripts. `at`: where its
   * assignments are made. A value read that changes nothing is remembered with what it read, so that a value read
   * again (`v2='v1 + v1'`) is not run again, unless those have changed.
   */
  private arithValue(st: ShellState, name: string, at: SyntaxNode): { st: ShellState; value?: bigint } {
    const value = this.variableText(st, name);
    this.unsetRead(st, name);
    if (value === undefined) {
      // A value not known is an expression too, unless it is surely a number (see `unsure`).
      const target = this.resolve(st, name);
      if (!target || !(NUMERIC_DYNAMIC.test(target) || attribute(st, target, 'i') === 'on')) this.markUnsure();
      return { st };
    }
    const text = (value ?? '').trim();
    if (text === '') return { st, value: 0n };
    let constant = this.constants.get(text);
    if (constant === undefined) this.constants.set(text, (constant = evalArithWrapping(text)?.value ?? null));
    if (constant !== null) return { st, value: constant };
    const seen = this.remembered(st, name);
    const up = this.arithReads[this.arithReads.length - 1];
    const fits = seen && this.arithReading.length + seen.depth <= ARITH_DEPTH;
    if (seen && (seen.unknown !== 'deep' || !fits)) {
      if (up) {
        for (const [k, v] of seen.deps) up.deps.set(k, v);
        up.depth = Math.max(up.depth, seen.depth + 1);
      }
      if (seen.unknown === 'always') throw new ArithUnknown();
      if (!fits) throw new ArithUnknown('deep');
      if (seen.unsure) this.markUnsure();
      if (seen.assumed) this.markAssumed();
      return { st, value: seen.value };
    }
    // A name read again with nothing changed since leads back to itself for ever: bash fails at its recursion
    // limit. (With something changed, `x='i++ < 5 ? x : 0'`, it may end: followed so deep only.)
    if (this.arithReading.some((r) => r.name === name && r.st === st)) throw new ArithError(st);
    if (this.arithReading.length >= ARITH_DEPTH) throw new ArithUnknown('deep');
    const from = this.arithReading.length;
    const reads: ArithReads = { deps: new Map(), pure: true, depth: 1, unsure: false, assumed: false };
    this.arithReading.push({ name, st });
    this.arithReads.push(reads);
    this.noteRead(st, name);
    let r: { st: ShellState; value?: bigint };
    try {
      r = this.arithText(text, st, at, true);
    } catch (e) {
      // What is not known stays so with the same reads, from as deep (`deep`); not when steps so far made it so.
      if (e instanceof ArithUnknown && e.why !== 'limit') {
        if (e.why === 'deep') reads.depth = ARITH_DEPTH - from + 1;
        this.remember(name, reads, undefined, e.why === 'deep' ? 'deep' : 'always');
      }
      throw e;
    } finally {
      this.arithReading.pop();
      this.arithReads.pop();
      if (up) {
        for (const [k, v] of reads.deps) up.deps.set(k, v);
        up.pure &&= reads.pure;
        up.unsure ||= reads.unsure;
        up.assumed ||= reads.assumed;
        up.depth = Math.max(up.depth, reads.depth + 1);
      }
    }
    if (r.st === st && reads.pure) this.remember(name, reads, r.value, false);
    return r;
  }

  private remember(name: string, reads: ArithReads, value: bigint | undefined, unknown: ArithRemembered['unknown']): void {
    const list = this.arithMemo.get(name) ?? [];
    list.unshift({ deps: reads.deps, depth: reads.depth, value, unknown, unsure: reads.unsure, assumed: reads.assumed });
    if (list.length > ARITH_MEMO) list.pop();
    this.arithMemo.set(name, list);
  }

  /** Each arithmetic text read, once per model: its text for the parser (`incDecText`), its nodes, whether bash reads them so; null when bash fails on it. */
  private readonly arithTrees = new Map<string, { text: string; cmd: readonly SyntaxNode[]; valid: boolean } | null>();

  /**
   * Runs an arithmetic expression given as text, at `at`; `brackets`: its subscripts are still to be expanded (a
   * variable's value, an argument of `let`). Text the parser may read otherwise than bash (a syntax error, a `++` it
   * splits otherwise) is not known: bash makes the assignments before the error.
   */
  private arithText(text: string, st: ShellState, at: SyntaxNode, brackets: boolean): { st: ShellState; value?: bigint } {
    let tree = this.arithTrees.get(text);
    if (tree === undefined) {
      // (Parentheses left open would be closed by the `))` around the text: `((x` fails in bash, where it is 2 here.)
      const lexed = balanced(text) ? incDecText(text) : undefined;
      if (lexed) {
        aliasParser ??= createUnbashParser();
        const cmd = aliasParser.parse(`(( ${lexed.text} ))`).root.namedChildren;
        tree = { text: lexed.text, cmd, valid: cmd.length === 1 && cmd[0].type === 'arithmetic_command' && !hasError(cmd[0]) && incDecCount(cmd[0]) === lexed.ops };
      } else tree = null;
      this.arithTrees.set(text, tree);
    }
    if (!tree) throw new ArithUnknown();
    const { cmd } = tree;
    if (brackets && cmd.length === 1 && cmd[0].type === 'arithmetic_command' && cmd[0].namedChildren.length) {
      const x = this.arithExpand(cmd[0].namedChildren, st, true);
      if (x.text !== tree.text) return this.arithText(x.text, x.st, at, false);
    }
    if (!tree.valid) throw new ArithUnknown();
    let r: { st: ShellState; value?: bigint } = { st, value: 0n };
    for (const e of cmd[0].namedChildren) r = this.arith(e, r.st, at);
    return r;
  }

  private pipeline(n: SyntaxNode, st: ShellState): ShellState {
    const stages = n.namedChildren.filter((c) => STATEMENTS.has(c.type));
    // (The stages but the last one are subshells.)
    const statuses = stages.slice(0, -1).map((s) => this.run(s, st).status);
    const here = lastStageInShell(st, this.shell);
    // (A jump in the last stage, when it runs in a subshell, ends that subshell.)
    if (here !== 'on') this.targets.push({ kind: here === 'off' ? 'subshell' : 'maybe' });
    let after: ShellState;
    try {
      after = this.run(stages[stages.length - 1], st);
    } finally {
      if (here !== 'on') this.targets.pop();
    }
    statuses.push(after.status);
    // Its status is the last stage's; with pipefail, the last one that is not 0.
    const last = after.status;
    const failed = statuses.some((x) => x === undefined) ? undefined : statuses.filter((x) => x !== 0).pop() ?? 0;
    const pipefail = option(st, 'set', 'pipefail');
    const status = pipefail === 'on' ? failed : pipefail === 'unknown' ? (failed === last ? last : undefined) : last;
    return withStatus(here === 'on' ? after : here === 'unknown' ? merge([st, after], this.posix) : st, status);
  }

  /**
   * `if`: each condition in turn, until one holds. A condition whose status is known makes the other path dead: its
   * `then` branch when it fails, the branches after it when it holds. With no `else`, the path where no condition held
   * has status 0.
   */
  private ifStatement(n: SyntaxNode, st: ShellState): ShellState {
    const ends: ShellState[] = [];
    const branches = [{ at: n, cond: this.part(n, 'if', ['then']), body: this.part(n, 'then', ['elif_clause', 'else_clause', 'fi']) },
      ...n.namedChildren.filter((c) => c.type === 'elif_clause').map((c) => ({ at: c, cond: this.part(c, 'elif', ['then']), body: this.part(c, 'then', []) }))];
    let cur = st;
    // Whether a path gets past the conditions so far.
    let open = true;
    for (const b of branches) {
      if (!open) {
        this.deadRun([...b.cond, ...b.body], cur);
        continue;
      }
      const { value: after, reads } = this.reads(() => this.quietly(() => this.sequence(b.cond, cur)));
      const holds = after.status === undefined || this.blind ? undefined : after.status === 0;
      this.decide(b.at, holds === undefined ? undefined : String(holds), reads);
      if (holds === false) this.deadRun(b.body, after);
      else ends.push(this.sequence(b.body, after));
      if (holds === true) open = false;
      cur = after;
    }
    const otherwise = n.namedChildren.find((c) => c.type === 'else_clause');
    if (otherwise && open) ends.push(this.sequence(otherwise.children, cur));
    else if (otherwise) this.deadRun(otherwise.children, cur);
    else if (open) ends.push(withStatus(cur, 0));
    return merge(ends, this.posix);
  }

  /** For each loop walked, what its passes changed and the state they started from in the end (see `loop`). */
  private readonly loopsWalked = new Map<SyntaxNode, { keys: Set<string>; entry: ShellState }>();
  /** How many loops are being walked. */
  private loopDepth = 0;

  /**
   * The loop `n`: the condition, then the body, again and again until the state at the start of the body no longer
   * changes. A `while` ends after its condition; a `for`, after the body or before it (an empty list). A loop walked
   * before in a loop being walked starts from what it changed then, as it was in the end: in nested loops, whose
   * values change at each pass, each walk then takes one pass, not as many as the loops around it take.
   */
  private loop(n: SyntaxNode, st: ShellState, { cond, body, update = (s) => s, endsWithCondition, atLeastOnce = false, holds, exit = (s) => s }: {
    cond: (s: ShellState) => ShellState; body: (s: ShellState) => ShellState; update?: (s: ShellState) => ShellState; endsWithCondition: boolean;
    atLeastOnce?: boolean; holds?: (status: number | undefined) => boolean | undefined; exit?: (s: ShellState) => ShellState;
  }): ShellState {
    const before = this.loopDepth ? this.loopsWalked.get(n) : undefined;
    let entry = st;
    if (before) {
      // (With the status the passes started from, `$?`, which the body may change too.)
      const was = { ...st, status: before.entry.status };
      for (const key of before.keys) {
        const kind = key.slice(0, key.indexOf(' ')) as Kind;
        const name = key.slice(kind.length + 1);
        (was as Record<Kind, NameMap<unknown>>)[kind] = (was[kind] as NameMap<unknown>).with(name, before.entry[kind].get(name));
      }
      entry = merge([st, was], this.posix);
    }
    // `break` leaves the loop (the states there are merged into the one after it); `continue` ends the pass.
    const target: Extract<Target, { kind: 'loop' }> = { kind: 'loop', dead: this.dead, breaks: [], continues: [] };
    // A condition whose status is known (`holds`) is recorded at each test; one that stops the loop at its first test
    // makes the body dead.
    const test = (s: ShellState): { st: ShellState; holds?: boolean } => {
      if (!holds) return { st: cond(s) };
      const { value, reads } = this.reads(() => this.quietly(() => cond(s)));
      const h = this.blind ? undefined : holds(value.status);
      this.decide(n, h === undefined ? undefined : String(h), reads);
      return { st: value, holds: h };
    };
    const pass = (s: ShellState): ShellState => update(merge([body(s), ...target.continues.splice(0)], this.posix));
    const keys = new Set<string>();
    this.collecting.push(keys);
    this.targets.push(target);
    this.loopDepth++;
    let end = st;
    let settled = false;
    let stopped: ShellState | undefined;
    let normal: ShellState;
    try {
      for (let i = 0; i < 5; i++) {
        const c = test(entry);
        if (i === 0 && c.holds === false) {
          this.dead++;
          try {
            pass(c.st);
          } finally {
            this.dead--;
          }
          stopped = c.st;
          settled = true;
          break;
        }
        end = pass(c.st);
        const next = merge([st, end], this.posix);
        if (sameState(next, entry)) {
          settled = true;
          break;
        }
        entry = next;
      }
      if (stopped) normal = stopped;
      else if (endsWithCondition) {
        // (A condition that holds at every test never ends the loop: only a jump does.)
        const last = test(entry);
        normal = settled && last.holds === true ? unreachable(last.st) : last.st;
      } else normal = atLeastOnce ? end : entry;
    } finally {
      this.loopDepth--;
      this.targets.pop();
      this.collecting.pop();
    }
    // (Passes that did not settle may not cover every state the loop runs with: its conditions are not decided.)
    if (!settled) this.unwalked.add(n);
    this.loopsWalked.set(n, { keys, entry });
    return merge([exit(normal), ...target.breaks, ...target.continues], this.posix);
  }

  private forStatement(n: SyntaxNode, st: ShellState): ShellState {
    const values = fields(n, 'value');
    for (const v of values) {
      this.substitutions(v, st);
      st = this.defaults(v, st);
    }
    const variable = field(n, 'variable');
    // (A readonly variable: bash fails at the first word, and the body does not run; it may be.)
    const readonly = variable ? attribute(st, this.resolve(st, variable.text) ?? variable.text, 'r') : 'off';
    // (An integer runs each word, which may fail: see `assignmentError`.)
    if (variable && attribute(st, this.resolve(st, variable.text) ?? variable.text, 'i') !== 'off') this.abort(st, false);
    const assign = (s: ShellState, value: string | undefined): ShellState => (variable && readonly !== 'on' ? this.setVariable(s, variable.text, variable, value) : s);
    // `for x in a b c`: x is each word in turn, then stays the last; with no `in`, the positional parameters.
    const words = values.map((v) => (v.type === 'word' || v.type === 'number' || v.type === 'raw_string' || v.type === 'string' ? staticWordValue(v) : undefined));
    const known = n.type === 'for_statement' && values.length > 0 && words.every((w) => w !== undefined) && readonly === 'off';
    const each = known && new Set(words).size === 1 ? words[0] : undefined;
    // (A list of known words runs the body at least once.)
    return this.loop(n, st, { cond: (s) => s, body: (s) => this.sequence(field(n, 'body')?.children ?? [], assign(s, each)), endsWithCondition: false, atLeastOnce: known,
      exit: (s) => (known ? assign(s, words[words.length - 1]) : s) });
  }

  private functionDefinition(n: SyntaxNode, st: ShellState): ShellState {
    const name = field(n, 'name')!.text;
    const prev = st.functions.get(name);
    // A readonly function cannot be defined again; in POSIX mode, nor can one named like a special builtin (bash
    // stops the script there).
    if (prev?.state === 'on' && prev.readonly === 'on') return st;
    if (builtins[name]?.builtin === 'special' && option(st, 'set', 'posix') === 'on') return st;
    this.changeAtDefinition.set(n, this.changeCount);
    // Under `set -a`, a function defined is exported.
    const all = option(st, 'set', 'allexport');
    const exported: Tri = all === 'on' ? 'on' : all === 'unknown' ? tri(prev?.exported ?? 'off', 'on') : prev?.exported ?? 'off';
    return this.put(st, 'functions', name, { state: 'on', def: n, exported, readonly: prev?.readonly ?? 'off' });
  }

  /** The state after a call of `fn`, with the prefix assignments `temporaries` (`x=1 f`) set while it runs. */
  private call(fn: FunctionState, st: ShellState, temporaries: SyntaxNode[]): ShellState {
    const def = fn.def;
    // (`$?` in the body is not followed: the walks are remembered by the state without it.)
    st = withStatus(st, undefined);
    const site = this.aliasHost ?? this.node!;
    const sites = this.calls.get(def) ?? new Map<SyntaxNode, boolean>();
    if (!this.silent) {
      this.calls.set(def, sites);
      sites.set(site, (sites.get(site) ?? true) && fn.state === 'on');
    }
    let exit: ShellState;
    if (this.stack.includes(def) || this.stack.length >= CALL_DEPTH) {
      // A recursive call: what the body changed in its walks so far may change, and it may end the line (see `abort`).
      exit = this.widen(st, this.changes.get(def) ?? new Set());
      this.unwalked.add(def);
      this.abort(st, false);
    } else if (temporaries.length) {
      const frame: Frame = { def, saved: new Map() };
      let entry = st;
      for (const a of temporaries) {
        const name = field(a, 'name')!.text;
        if (!frame.saved.has(name)) frame.saved.set(name, entry.variables.get(name));
        // (bash exports them to the commands the body runs.)
        entry = this.giveAttribute(this.assignNode(a, entry), name, 'x', a);
      }
      exit = this.walkBody(def, entry, frame);
    } else {
      const walks = this.walks.get(def) ?? [];
      if (!this.silent) this.walks.set(def, walks);
      // (A walk is reused only as it was made: in dead code or not, where `set -e` stops the shell or not, where an
      // error ends a line or a subshell.)
      const how = `${!!this.dead} ${!!this.quiet} ${!!this.unitTarget()}`;
      const seen = walks.find((w) => w.how === how && (w.entry === st || sameState(w.entry, st)));
      // (A walk reused gives again the states where an error in it ended the line: see `abort`.)
      const unit = this.unitTarget();
      if (seen) {
        exit = seen.exit;
        if (unit && unit.dead === this.dead) unit.aborts.push(...seen.aborts);
        for (const m of seen.maybes) this.abort(m, false);
      } else if (walks.length >= WALKS_PER_FUNCTION) {
        exit = this.widen(st, this.changes.get(def)!);
        this.unwalked.add(def);
        this.abort(st, false);
      } else {
        const from = unit?.aborts.length ?? 0;
        const maybesFrom = unit?.maybes.length ?? 0;
        exit = this.walkBody(def, st, { def, saved: new Map() });
        if (!this.silent) walks.push({ entry: st, exit, how, aborts: unit?.aborts.slice(from) ?? [], maybes: unit?.maybes.slice(maybesFrom) ?? [] });
      }
    }
    return fn.state === 'on' ? exit : merge([st, exit], this.posix);
  }

  /** Walks the body of `def` from `entry`; its locals (in `frame`) and its `local -` options are restored after it. */
  private walkBody(def: SyntaxNode, entry: ShellState, frame: Frame): ShellState {
    if (!this.walks.has(def) && !this.silent) this.walks.set(def, []);
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
    // (`return` ends the body: the states there are merged into the one at its end.)
    const target: Target = { kind: 'function', dead: this.dead, returns: [] };
    this.targets.push(target);
    let end: ShellState;
    try {
      end = this.run(body, entry);
    } finally {
      this.targets.pop();
    }
    end = merge([end, ...target.returns], this.posix);
    this.frames.pop();
    this.stack.pop();
    this.expand = outer;
    this.collecting.pop();
    // (`f() ( … )` runs its body in a subshell.)
    if (body.type === 'subshell') return entry;
    for (const [name, v] of frame.saved) end = { ...end, variables: end.variables.with(name, v) };
    // A `local GLOBIGNORE` going out of scope sets GLOBIGNORE again, or unsets it: dotglob follows, as for an assignment or `unset`.
    if (frame.saved.has('GLOBIGNORE') && this.bash) {
      const gi = frame.saved.get('GLOBIGNORE');
      end = !gi || gi.set === 'off' ? this.put(end, 'shopt', 'dotglob', 'off') : this.globignore(end, gi.set === 'on' ? gi.value : undefined);
    }
    if (frame.options) end = { ...end, set: frame.options };
    return end;
  }

  private command(n: SyntaxNode, st: ShellState): ShellState {
    this.substitutions(n, st);
    const name = commandName(n);
    const nameNode = field(n, 'name')!;
    const assignments = n.namedChildren.filter((c) => c.type === 'variable_assignment' && c.startIndex < nameNode.startIndex);
    // With no command name, the assignments are the shell's, made before the redirections; their status is that of
    // the last command substitution. (A quoted empty name is a command: `x=1 ''` is "command not found".)
    const word = nameNode.namedChildren[0];
    if (name === '' && !descendants(word, ['string', 'raw_string', 'ansi_c_string']).length && !['string', 'raw_string', 'ansi_c_string'].includes(word.type)) {
      for (const a of assignments) {
        this.record(a, st);
        st = this.assignNode(a, this.defaults(a, st), true);
      }
      return withStatus(this.redirections(n, st, 'off'), undefined);
    }
    // The words are expanded, then the values of the assignments, then the redirections are made.
    const before = st;
    st = this.expandAll(n.namedChildren.filter((c) => !assignments.includes(c) && c.field !== 'redirect'), st);
    st = this.redirections(n, this.expandAll(assignments, st), this.runsProgram(n, st));
    // A prefix assignment to PATH empties the table of remembered paths too.
    if (assignments.some((a) => field(a, 'name')!.text === 'PATH')) st = this.forgetHashed(st);
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
    if (name === undefined) return withStatus(st, this.simpleStatus(n, before));
    const fn = this.functionCalled(name, st);
    if (fn) return withStatus(this.call(fn, st, assignments), undefined);
    return withStatus(this.builtin(name, fields(n, 'argument'), n, st), this.simpleStatus(n, before));
  }

  /**
   * The status of the simple command `n` run from `st`, when known: `true`, `:` and `false` (also as the value of a
   * variable: `$debug`), `test`. Not with prefix assignments (one may fail), a redirection that may fail, or a word
   * whose value is not known (its expansion may fail).
   */
  private simpleStatus(n: SyntaxNode, st: ShellState): number | undefined {
    if (!this.bash || n.namedChildren.some((c) => c.type === 'variable_assignment') || !fields(n, 'redirect').every(safeRedirect)) return undefined;
    const name = this.condFields(field(n, 'name')!.namedChildren[0], st);
    if (name?.length !== 1 || st.functions.get(name[0]) || st.disabled.get(name[0])) return undefined;
    const args = fields(n, 'argument');
    if (name[0] === 'test') return this.testCommand(args, st);
    if (!['true', 'false', ':'].includes(name[0]) || args.some((a) => !this.condFields(a, st))) return undefined;
    return name[0] === 'false' ? 1 : 0;
  }

  /**
   * The status of assignments alone (`x=1`, `assignments` of `n`) run from `st`: 0, when none of them can fail (no
   * `$( )`, whose status it would be; no readonly or integer target, no `${x?}`, no expansion under `set -u`).
   */
  private assignmentStatus(n: SyntaxNode, assignments: readonly SyntaxNode[], st: ShellState): number | undefined {
    if (descendants(n, SUBSTITUTIONS).length || descendants(n, ['expansion']).some((e) => e.children.some((c) => c.type === '?' || c.type === ':?'))) return undefined;
    const nounset = option(st, 'set', 'nounset');
    if (nounset !== 'off' && nounset !== 'default' && descendants(n, ['simple_expansion', 'expansion']).length) return undefined;
    for (const a of assignments) {
      const name = field(a, 'name')!.text;
      const target = NAME.test(name) ? this.resolve(st, name) : undefined;
      if (!target || attribute(st, target, 'r') !== 'off' || attribute(st, target, 'i') !== 'off') return undefined;
    }
    return 0;
  }

  /**
   * The status of the statement `n`, run from `st` and leaving `after`, when known (docs/design/semantics.md, 4.14).
   * Simple commands, `(( ))`, lists, `if`, `case` and pipelines set it themselves; a sequence of statements gives its
   * last one's (see `sequence`).
   */
  private statusOf(n: SyntaxNode, st: ShellState, after: ShellState): number | undefined {
    switch (n.type) {
      case 'command': case 'arithmetic_command': case 'list': case 'if_statement': case 'case_statement': case 'pipeline':
      case 'compound_statement': case 'subshell': case 'time_statement':
        return after.status;
      case 'negated_command': return after.status === undefined ? undefined : Number(after.status === 0);
      case 'redirected_statement': return fields(n, 'redirect').every(safeRedirect) ? after.status : undefined;
      case 'test_command': return st.functions.get('[') || st.disabled.get('[') ? undefined : this.testCommand(n.namedChildren, st);
      case 'extended_test': {
        const v = this.bash && n.namedChildren.length === 1 ? this.condExpr(n.namedChildren[0], st) : undefined;
        return v === undefined ? undefined : Number(!v);
      }
      case 'variable_assignment': return this.assignmentStatus(n, [n], st);
      case 'variable_assignments': return this.assignmentStatus(n, n.namedChildren, st);
    }
    return undefined;
  }

  /** `(( ))` or the condition of `for (( ))` (`nodes`) run from `st`: the state after it, and its status when known. */
  private arithStatus(nodes: readonly SyntaxNode[], st: ShellState, unsure = false): { st: ShellState; status?: number } {
    this.assumed = false;
    try {
      const r = this.arithScript(nodes, st, unsure);
      // (Not when it read what it is unsure of, or a name the script has not set: see `variableText`; nor in a shell
      // other than bash, where `(( ))` may not be arithmetic.)
      return { st: r.st, status: !this.bash || r.value === undefined || this.unsure || this.assumed ? undefined : Number(r.value === 0n) };
    } catch (e) {
      if (e instanceof ArithError) return { st: e.st };
      /* c8 ignore next -- only an arithmetic error is thrown on purpose */
      throw e;
    }
  }

  /** The status of `test` or `[` with the words `words` (without the `]`), run from `st`, when their values are known. */
  private testCommand(words: readonly SyntaxNode[], st: ShellState): number | undefined {
    if (!this.bash) return undefined;
    const args: string[] = [];
    for (const w of words) {
      const f = this.condFields(w, st);
      if (!f) return undefined;
      args.push(...f);
    }
    return testStatus(args, this.testEnv(st));
  }

  /** The options of `st`, for the decisions of src/semantics/conditions.ts. */
  private testEnv(st: ShellState): TestEnv {
    return {
      // (`-o name` only for an option the script set: a default may differ, `bash -e script`.)
      option: (name) => {
        const o = st.set.get(name);
        return o === 'on' ? true : o === 'off' ? false : undefined;
      },
    };
  }

  /** Whether the expression `e` of `[[ ]]` is true, when it is known from `st`. */
  private condExpr(e: SyntaxNode, st: ShellState): boolean | undefined {
    switch (e.type) {
      case 'parenthesized_expression': return this.condExpr(e.namedChildren[0], st);
      case 'unary_expression': {
        const op = field(e, 'operator')!;
        const operand = e.namedChildren.filter((c) => c !== op)[0];
        if (op.type === '!') {
          const v = this.condExpr(operand, st);
          return v === undefined ? undefined : !v;
        }
        const value = this.condValue(operand, st);
        return value === undefined ? undefined : unaryTest(op.text, value, this.testEnv(st));
      }
      case 'binary_expression': {
        const op = field(e, 'operator')!.text;
        const left = field(e, 'left');
        const right = field(e, 'right');
        if (op === '&&' || op === '||') {
          // The right side is read only when the left one does not decide.
          const decides = op === '||';
          const l = this.condExpr(left!, st);
          if (l === decides) return decides;
          const r = this.condExpr(right!, st);
          return l === undefined && r !== decides ? undefined : r;
        }
        const value = this.condValue(left, st);
        if (value === undefined) return undefined;
        if (op === '==' || op === '=' || op === '!=') {
          const nocase = option(st, 'shopt', 'nocasematch');
          const pattern = nocase === 'off' || nocase === 'default' ? this.condPattern(right, st) : undefined;
          const m = pattern === undefined ? undefined : patternMatches(value, pattern);
          return m === undefined ? undefined : m === (op !== '!=');
        }
        if (op === '=~') {
          // Only a regex of plain characters, maybe anchored: `^abc`, `abc$`, `abc`; not under nocasematch, which it follows.
          const nocase = option(st, 'shopt', 'nocasematch');
          const m = right && (nocase === 'off' || nocase === 'default') && ['regex', 'word', 'number'].includes(right.type) ? /^(\^?)([A-Za-z0-9_ ,:/-]*)(\$?)$/.exec(right.text) : null;
          if (!m) return undefined;
          return m[1] && m[3] ? value === m[2] : m[1] ? value.startsWith(m[2]) : m[3] ? value.endsWith(m[2]) : value.includes(m[2]);
        }
        if (INTEGER_TESTS.has(op)) {
          // Arithmetic: decimal integers only (`010` is octal there, `x` a variable), with spaces, tabs and newlines around.
          const other = this.condValue(right, st);
          const int = (t: string | undefined): bigint | undefined => {
            const m = t === undefined ? null : /^[ \t\n]*([+-]?(?:0|[1-9]\d{0,17}))[ \t\n]*$/.exec(t);
            return m ? BigInt(m[1]) : undefined;
          };
          const a = int(value);
          const b = int(other);
          return a === undefined || b === undefined ? undefined : compareIntegers(op, a, b);
        }
        // `<` and `>` (the locale's order), the tests of files.
        return undefined;
      }
    }
    // A word alone: true when it is not empty.
    const value = this.condValue(e, st);
    return value === undefined ? undefined : value !== '';
  }

  /**
   * The pieces of the word `w` of a condition, when its value is known from `st`: literal text as written
   * (`raw`: its backslashes still quote), quoted text, and the values of `$name`, `${name}` and `$?`.
   */
  private condPieces(w: SyntaxNode | undefined, st: ShellState, quoted = false): { text: string; quoted: boolean; raw: boolean }[] | undefined {
    if (!w) return undefined;
    switch (w.type) {
      case 'word': case 'extglob_pattern': case 'number':
        // (Quotes and expansions are nodes of their own; text with them left is not followed, nor a tilde, which
        // expands at the start and after `=` or `:`.)
        return /[$`'"~]/.test(w.text) ? undefined : [{ text: w.text, quoted, raw: !quoted }];
      case 'raw_string': return [{ text: w.text.slice(1, -1), quoted: true, raw: false }];
      case 'ansi_c_string': {
        const v = ansiCValue(w.text.slice(2, -1));
        return v === undefined ? undefined : [{ text: v, quoted: true, raw: false }];
      }
      case 'string': {
        const out: { text: string; quoted: boolean; raw: boolean }[] = [{ text: '', quoted: true, raw: false }];
        for (const c of w.namedChildren) {
          if (c.type === 'string_content') out.push({ text: c.text.replace(/\\\n/g, '').replace(/\\([$`"\\])/g, '$1'), quoted: true, raw: false });
          else {
            const p = c.type === 'simple_expansion' || c.type === 'expansion' ? this.condPieces(c, st, true) : undefined;
            if (!p) return undefined;
            out.push(...p);
          }
        }
        return out;
      }
      case 'simple_expansion': case 'expansion': {
        const name = /^\$(?:([A-Za-z_]\w*|\?)|\{([A-Za-z_]\w*|\?)\})$/.exec(w.text);
        this.assumed = false;
        const v = !name ? undefined : (name[1] ?? name[2]) === '?' ? this.lastStatus(st) : this.variableText(st, name[1] ?? name[2]);
        // (Not a name the script has not set: see `variableText`.)
        return v === undefined || this.assumed ? undefined : [{ text: v ?? '', quoted, raw: false }];
      }
      case 'concatenation': {
        const out: { text: string; quoted: boolean; raw: boolean }[] = [];
        for (const c of w.namedChildren) {
          const p = this.condPieces(c, st, quoted);
          if (!p) return undefined;
          out.push(...p);
        }
        return out;
      }
    }
    // Command substitution, arithmetic, the other parameters and expansions: not known here.
    return undefined;
  }

  /** `$?` in the statement being run, from `st`; not known in a statement with a substitution, which changes it. */
  private lastStatus(st: ShellState): string | undefined {
    if (st.status === undefined || descendants(this.node!, SUBSTITUTIONS).length) return undefined;
    if (!this.dead) for (const r of this.reading) r.set('?', String(st.status));
    return String(st.status);
  }

  /** The value of the word `w` in `[[ ]]` or of `case` (not split, not globbed), when known from `st`. */
  private condValue(w: SyntaxNode | undefined, st: ShellState): string | undefined {
    const pieces = this.condPieces(w, st);
    return pieces?.map((p) => (p.raw ? unescape(p.text) : p.text)).join('');
  }

  /** The pattern of the word `w` (`[[ x == w ]]`, a `case` pattern), for `patternMatches`, when known from `st`. */
  private condPattern(w: SyntaxNode | undefined, st: ShellState): string | undefined {
    const pieces = this.condPieces(w, st);
    // (Literal text keeps its backslashes, and so does the value of an unquoted `$p`: both are patterns.)
    return pieces && patternText(pieces.map((p) => ({ text: p.text, quoted: p.quoted })));
  }

  /**
   * The words the word `w` of `test` or `[` gives, when known from `st`: an unquoted expansion is split (with the
   * default IFS only) and may give none; a glob, a brace or a tilde is not followed.
   */
  private condFields(w: SyntaxNode, st: ShellState): string[] | undefined {
    const pieces = this.condPieces(w, st);
    if (!pieces) return undefined;
    const out: string[] = [];
    let cur = '';
    let has = false;
    for (const p of pieces) {
      if (p.raw) {
        // (Nor an extended glob, which `shopt -s extglob` makes one: `@(a)`.)
        if (/(^|[^\\])(\\\\)*[*?[{]/.test(p.text) || /[@!+]\(/.test(p.text)) return undefined;
        cur += unescape(p.text);
        has = true;
      } else if (p.quoted) {
        cur += p.text;
        has = true;
      } else {
        // (An IFS the script set, or may set where the walk does not see it, is not followed; the value of an
        // expansion may be a glob.)
        if (st.variables.get('IFS') || !this.trust.variable('IFS') || /[*?[]/.test(p.text)) return undefined;
        for (const c of p.text) {
          if (c !== ' ' && c !== '\t' && c !== '\n') {
            cur += c;
            has = true;
          } else if (has) {
            out.push(cur);
            cur = '';
            has = false;
          }
        }
      }
    }
    if (has) out.push(cur);
    return out;
  }

  /**
   * The items of the `case` statement `n` whose lists run, in order, when the word and the patterns tried are known from
   * `st` (bash: the patterns are tried in turn; `;;` ends, `;&` runs the next list, `;;&` tries the patterns after it).
   */
  private caseRuns(n: SyntaxNode, items: readonly SyntaxNode[], st: ShellState): number[] | undefined {
    const nocase = option(st, 'shopt', 'nocasematch');
    const { value: runs, reads } = this.reads((): number[] | undefined => {
      const word = this.bash && !this.blind && (nocase === 'off' || nocase === 'default') ? this.condValue(field(n, 'value')!, st) : undefined;
      if (word === undefined) return undefined;
      const out: number[] = [];
      for (let i = 0; i < items.length;) {
        let found = -1;
        for (let j = i; j < items.length && found < 0; j++) {
          for (const v of fields(items[j], 'value')) {
            const pattern = this.condPattern(v, st);
            const m = pattern === undefined ? undefined : patternMatches(word, pattern);
            if (m === undefined) return undefined;
            if (m) {
              found = j;
              break;
            }
          }
        }
        if (found < 0) break;
        let k = found;
        out.push(k);
        const end = (item: SyntaxNode): string | undefined => item.children.find((c) => c.type === ';&' || c.type === ';;&')?.type;
        while (end(items[k]) === ';&' && k + 1 < items.length) out.push(++k);
        if (end(items[k]) !== ';;&') break;
        i = k + 1;
      }
      return out;
    });
    this.decide(n, runs?.join(','), reads);
    return runs;
  }

  /**
   * A function named like the builtin `name` (`export() { …; }; export x`) runs instead of it, unless POSIX mode
   * finds the special builtin first; `builtin` runs the builtin.
   */
  private orFunction(name: string, st: ShellState, builtin: (st: ShellState) => ShellState): ShellState {
    const fn = this.functionCalled(name, st);
    if (!fn) return builtin(st);
    const called = this.call(fn, st, []);
    return fn.state === 'on' ? called : merge([called, builtin(st)], this.posix);
  }

  /** The function a command named `name` calls in `st`: none when POSIX mode finds a special builtin of that name first. */
  private functionCalled(name: string, st: ShellState): FunctionState | undefined {
    const fn = st.functions.get(name);
    if (!fn || fn.state === 'off') return undefined;
    return builtins[name]?.builtin === 'special' && option(st, 'set', 'posix') === 'on' ? undefined : fn;
  }

  /**
   * Runs a string this shell reads (`eval`, a trap's action) from `st`, from `host` (its calls are made there): bash
   * reads it when it runs (its parse state is `st`), one line at a time, so the lines before a syntax error run.
   */
  private runScript(script: NestedScript, host: SyntaxNode, st: ShellState): ShellState {
    const outer = this.aliasHost;
    const expand = this.expand;
    this.aliasHost ??= host;
    const { root, text, errors } = script.tree;
    const stop = errors.length ? text.slice(0, Math.min(...errors.map((e) => e.startIndex))).split('\n').length - 1 : Infinity;
    const statements = root.children.filter((c) => c.endPosition.row < stop && STATEMENTS.has(c.type));
    const { end, sure } = this.units(statements, st);
    this.aliasHost = outer;
    this.expand = expand;
    return statements.length && sure ? end : withStatus(end, undefined);
  }

  /** Runs a trap's action from `st` (see `runScript`), inside its `trap` target. */
  private trapAction(script: NestedScript, host: SyntaxNode, st: ShellState, exitOnly: boolean, dead = false): void {
    this.targets.push({ kind: 'trap', exitOnly });
    // (A trap set in code that never runs is never set: its action is walked as dead code.)
    if (dead) this.dead++;
    try {
      this.runScript(script, host, st);
    } finally {
      this.targets.pop();
      if (dead) this.dead--;
    }
  }

  /**
   * What leaves a trap's action at `t` otherwise than by `exit`: the signal may come anywhere, so nothing is trusted
   * (the walk is made again, blind). An EXIT trap's action runs as the shell ends: nothing is left to run.
   */
  private escape(t: Extract<Target, { kind: 'trap' }>): void {
    if (!t.exitOnly && !this.dead && !this.blind) this.walkAgain("a trap's action may end what a signal interrupts (an error, `return`, `break` or `continue`)");
  }

  /**
   * `eval`'s string, run where eval runs. The assignments before `eval` are its temporaries in bash mode: the string
   * sees them, exported, and they are gone after it (what the string assigns to them too); in POSIX mode they stay.
   */
  private evalScript(script: NestedScript, n: SyntaxNode, st: ShellState): ShellState {
    // (`n` is the command that runs eval: `eval s`, `builtin eval s`.)
    const name = field(n, 'name')!;
    const temps = n.namedChildren.filter((c) => c.type === 'variable_assignment' && c.startIndex < name.startIndex);
    if (!temps.length || option(st, 'set', 'posix') === 'on') return this.runScript(script, n, st);
    const saved = new Map<string, VariableState | undefined>();
    let entry = st;
    for (const a of temps) {
      const v = field(a, 'name')!.text;
      if (!saved.has(v)) saved.set(v, entry.variables.get(v));
      entry = this.giveAttribute(this.assignNode(a, entry), v, 'x', a);
    }
    let after = this.runScript(script, n, entry);
    for (const [v, was] of saved) after = this.put(after, 'variables', v, was);
    return after;
  }

  /** The string of `words`, which this shell runs: now (`eval`) or later (a trap's action). */
  private script(words: SyntaxNode[], kind: 'current' | 'later', n: SyntaxNode, parse: ArgvParse, args: SyntaxNode[]): NestedScript | NotRead {
    const name = parse.command;
    const script = this.scripts.read(words, kind, () => slotEnvs(this.scripts.model.env(n), parse, builtins[name], args).get(words[0])!, { shell: this.shell, known: true });
    if (!('why' in script)) this.collectDefinitions(script.tree.root);
    return script;
  }

  private parseText(text: string): SyntaxTree {
    let tree = aliasTrees.get(text);
    if (tree) aliasTrees.delete(text);
    else {
      aliasParser ??= createUnbashParser();
      tree = aliasParser.parse(text);
      if (aliasTrees.size >= ALIAS_TREES) aliasTrees.delete(aliasTrees.keys().next().value!);
    }
    aliasTrees.set(text, tree);
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
    return alias.state === 'on' && expands === 'on' ? after : merge([withStatus(st, undefined), after], this.posix);
  }

  /** The builtin `name` run with `args`, when it changes the state. */
  private builtin(name: string, args: SyntaxNode[], n: SyntaxNode, st: ShellState): ShellState {
    if (!builtins[name] || !this.bashBuiltin(name)) return st;
    // `command set -f`, `builtin shopt -s x`: the builtin runs (`command -v` only looks it up).
    if (name === 'command' || name === 'builtin') {
      const inner = wrapped(name, args);
      return 'lookup' in inner || inner.name === undefined ? st : this.builtin(inner.name, inner.args, n, st);
    }
    if (DECLARATIONS.has(name)) return this.declare(name, args, readDeclarationWords(name, args), n, st);
    if (name === 'unset') return this.unset(args, n, st);
    const parse = builtinParse(name, args);
    // The variables it sets (`read`, `printf -v`, `mapfile`, `getopts`, `wait -p`), as its spec says.
    for (const v of variableWrites(builtins[name], parse, args)) {
      if (v.sets === 'lines') st = v.name && NAME.test(v.name) ? this.giveAttribute(this.setVariable(st, v.name, n, undefined), v.name, 'a', n) : st;
      else if (v.sets === 'job-id') st = merge([st, this.setNamed(st, v.name, n, false)], this.posix);
      else st = this.setNamed(st, v.name, n, v.sets === 'array');
    }
    const operands = parse.roles.filter((r) => r.role.role === 'operand').map((r) => args[r.word]);
    const valueOf = (flag: string): SyntaxNode | undefined => {
      const r = parse.roles.find((x) => x.role.role === 'value' && x.role.of === flag);
      return r ? args[r.word] : undefined;
    };
    const letters = optionRoles(parse);
    const has = (flag: string): boolean => letters.some((l) => l.flag === flag);
    switch (name) {
      case 'eval': case 'trap': {
        // A static string of `eval` runs here, in this shell; a trap's action runs later, when the signal comes
        // (docs/design/semantics.md, 4.13). A string not known here may set any name, and call any function: nothing
        // is trusted then (src/semantics/trust.ts; also a string too deep, or one with a glob, which the walk does not read).
        const at = parse.roles.find((r) => r.role.role === 'command');
        if (!at) return st;
        const words = name === 'eval' ? args.slice(at.word) : [args[at.word]];
        const script = this.script(words, name === 'eval' ? 'current' : 'later', n, parse, args);
        if ('why' in script) {
          this.turnOpaque();
          if (!this.dead && !this.blind) this.walkAgain(`\`${name}\` of a string the walk does not read`);
          return st;
        }
        if (name === 'eval') return this.evalScript(script, n, st);
        const signals = parse.roles.filter((r) => r.role.role === 'operand').map((r) => staticWordValue(args[r.word]) ?? '');
        const exit = (x: string) => /^(SIG)?EXIT$|^0$/i.test(x);
        if (!this.silent) this.traps.push({ script, host: this.aliasHost ?? n, st, since: this.changeCount, exit: signals.some(exit), exitOnly: signals.every(exit), dead: this.dead > 0 });
        // (What it changes, it may change after any later statement; an EXIT trap runs at the end only.)
        if (!signals.every(exit)) {
          const keys = new Set<string>();
          this.collecting.push(keys);
          this.silent++;
          this.trapAction(script, this.aliasHost ?? n, st, false);
          this.silent--;
          this.collecting.pop();
          for (const k of keys) this.trapKeys.add(k);
        }
        return st;
      }
      case 'cd': case 'pushd': case 'popd': {
        // They set PWD and OLDPWD (when they succeed), to values not followed.
        const moved = this.setVariable(this.setVariable(st, 'PWD', n, undefined), 'OLDPWD', n, undefined);
        return merge([st, moved], this.posix);
      }
      case 'let': return this.arithRun((s) => this.letCommand(operands, s), st);
      case 'break': case 'continue': {
        // `break N`: N loops (a count not known, or not a number above 0, may fail).
        const words = args.filter((a, i) => i > 0 || a.text !== '--');
        const count = words.length ? staticWordValue(words[0]) : '1';
        return this.jump(name, words.length < 2 && count !== undefined && /^0*[1-9]\d{0,8}$/.test(count) ? Number(count) : undefined, st);
      }
      case 'return': case 'exit': return this.jump(name, undefined, st);
      case 'source': case '.':
        // (The file is not read: what it defines is not known here.)
        if (!this.silent) this.sources.push(this.aliasHost ?? n);
        this.turnOpaque();
        return st;
      case 'set': return this.setCommand(st, parse, args);
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
      case 'enable': {
        // (`enable -f`, `-d`: loadable builtins, not followed.)
        if (has('-f') || has('-d') || has('-p') || has('-a') || has('-s')) return st;
        for (const o of operands) {
          const b = staticWordValue(o);
          if (b) st = this.put(st, 'disabled', b, { state: has('-n') ? 'on' : 'off', value: '', at: n });
        }
        return st;
      }
      case 'hash': {
        if (has('-r')) st = this.forgetHashed(st);
        const path = valueOf('-p');
        const forget = valueOf('-d');
        if (forget) st = this.unhash(st, forget, n);
        for (const o of operands) {
          const b = staticWordValue(o);
          if (!b) continue;
          if (path) st = this.put(st, 'hashed', b, { state: 'on', value: staticWordValue(path) ?? '', at: n });
          else if (has('-d')) st = this.unhash(st, o, n);
        }
        return st;
      }
      case 'getopts': {
        // OPTARG is set, or unset when the option takes no value.
        st = this.setVariable(st, 'OPTIND', n, undefined);
        const prev = st.variables.get('OPTARG');
        return this.put(st, 'variables', 'OPTARG', { declared: 'unknown', set: 'unknown', attrs: prev?.attrs ?? {}, at: n });
      }
    }
    return st;
  }

  /** Every path `hash -p` gave is forgotten (`hash -r`, an assignment to PATH). */
  private forgetHashed(st: ShellState): ShellState {
    for (const [k, e] of st.hashed) if (e.state !== 'off') st = this.put(st, 'hashed', k, { ...e, state: 'off' });
    return st;
  }

  private unhash(st: ShellState, w: SyntaxNode, at: SyntaxNode): ShellState {
    const name = staticWordValue(w);
    const e = name ? st.hashed.get(name) : undefined;
    return e ? this.put(st, 'hashed', name!, { ...e, state: 'off', at }) : st;
  }

  /** Whether `name` is read here as bash's builtin (the others are programs, or other shells' builtins). */
  private bashBuiltin(name: string): boolean {
    return this.bash || !BASH_ONLY_BUILTINS.has(name);
  }

  /** Sets the variable `name` names (`v`, `a[1]`: an element), to a value not known here. */
  private setNamed(st: ShellState, name: string | undefined, at: SyntaxNode, array: boolean): ShellState {
    const m = /^([A-Za-z_]\w*)(\[.*\])?$/s.exec(name ?? '');
    if (!m) return st;
    // (An integer runs the text it is given, which may fail: see `assignmentError`.)
    if (attribute(st, this.resolve(st, m[1]) ?? m[1], 'i') !== 'off') this.abort(st, false);
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

  private setCommand(st: ShellState, parse: ArgvParse, args: SyntaxNode[]): ShellState {
    for (const { name, on } of setOptionWrites(parse, args, this.shell)) {
      if (!name) continue;
      const writes = this.setWrites.get(this.node!) ?? new Map<string, 'on' | 'off'>();
      this.setWrites.set(this.node!, writes.set(name, on ? 'on' : 'off'));
      st = name === 'posix' ? this.setPosix(st, on, this.node!) : this.put(st, 'set', name, on ? 'on' : 'off');
    }
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
    // (An option the spec does not know, `declare -c`, may change the values assigned: they are not known.)
    const unknown = words.some((w) => roles.get(w)?.role === 'unknown-option');
    for (let o of operands) {
      if (unknown && o.assign) o = { ...o, assign: { ...o.assign, text: undefined, source: undefined } };
      // `declare a[1]=x` makes `a` an array.
      if (o.subscript) {
        st = this.assign(st, o.name, true, o.assign ?? { append: false, text: undefined, array: false }, o.node, false, true);
        continue;
      }
      const name = o.name;
      // A local variable starts afresh, hiding the one outside, from here to the end of the function.
      if (local && !frame.saved.has(name)) {
        frame.saved.set(name, st.variables.get(name));
        // (With localvar_inherit, it starts with the value and attributes of the one it hides: not followed.)
        const inherit = option(st, 'shopt', 'localvar_inherit');
        st = this.put(st, 'variables', name, { declared: 'on', set: inherit === 'off' || inherit === 'default' ? 'off' : 'unknown', attrs: {}, at: n });
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
    // (The state of an assignment in a declaration has the attributes the declaration gives. A value that may not be a
    // valid expression, given to an integer, may discard the rest of the line: see `assignmentError`.)
    if (o.node.type === 'variable_assignment') this.record(o.node, st);
    if ((attrs.i?.state ?? 'off') !== 'off' && !o.subscript && (o.assign.text === undefined || evalArith(o.assign.text) === undefined)) this.abort(st, false);
    return this.assign(st, name, false, o.assign, o.node, nameref, true);
  }

  private unset(words: readonly SyntaxNode[], n: SyntaxNode, st: ShellState): ShellState {
    // The options and the names, read with unset's spec.
    const ws = words.filter((w) => !w.type.endsWith('redirect'));
    const parse = interpret(builtins.unset, ws.map(argWord), { name: 'unset' });
    const flags = optionRoles(parse).map((r) => r.flag.slice(1)).join('');
    const all = parse.roles.filter((r) => r.role.role === 'operand').map(({ word }) => ({ node: ws[word], text: (ws[word].type === 'variable_name' ? ws[word].text : staticWordValue(ws[word])) ?? ws[word].text }));
    // (`unset -fv` is an error: nothing is unset.)
    if (flags.includes('f') && flags.includes('v')) return st;
    for (const { node, text } of all) {
      if (node.type !== 'variable_name' && staticWordValue(node) === undefined) {
        // A name not known here: a variable that `${u:=u}` in it sets may be the one it names.
        for (const e of descendants(node, ['expansion'])) {
          const name = e.namedChildren[0];
          if (!e.children.some((c) => c.type === ':=' || c.type === '=') || name?.type !== 'variable_name' || flags.includes('f') || attribute(st, name.text, 'r') === 'on') continue;
          st = merge([st, this.put(st, 'variables', name.text, { declared: 'off', set: 'off', attrs: {}, at: node })], this.posix);
        }
        continue;
      }
      const fn = st.functions.get(text);
      if (flags.includes('f')) {
        if (fn) st = this.put(st, 'functions', text, { ...fn, state: 'off', removed: n });
        continue;
      }
      // `unset 'a[1]'` removes an element.
      if (text.includes('[')) continue;
      const v = st.variables.get(text);
      // With no -v, a name with no variable is a function.
      if (!flags.includes('v') && (!v || v.declared === 'off') && fn && fn.state !== 'off') {
        st = this.put(st, 'functions', text, { ...fn, state: 'off', removed: n });
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

  /** The assignment `a`; `statement`: one with no command (`x=1`, not `x=1 cmd`), where an error discards the rest of the line. */
  private assignNode(a: SyntaxNode, st: ShellState, statement = false): ShellState {
    const nameNode = field(a, 'name')!;
    const value = field(a, 'value');
    const subscript = nameNode.type === 'subscript';
    const name = subscript ? field(nameNode, 'name')!.text : nameNode.text;
    const text = value ? staticWordValue(value, true) : '';
    if (statement) this.assignmentError(st, name, value?.type === 'array' ? '' : text);
    return this.assign(st, name, subscript, { append: a.children.some((c) => c.type === '+='), text, array: value?.type === 'array', source: value }, a, false);
  }

  /**
   * An assignment statement to a readonly variable, or of text that may not be a valid expression to an integer
   * variable (`declare -i n; n=1/0`), is an error that discards the rest of the line, as an expansion error does
   * (see `abort`): surely when the variable surely is readonly, else it may.
   */
  private assignmentError(st: ShellState, name: string, text: string | undefined): void {
    const target = this.resolve(st, name);
    const v = target === undefined ? undefined : st.variables.get(target);
    const readonly = v?.attrs.r?.state ?? 'off';
    if (readonly === 'on') throw new ExpansionError(st, true);
    if (readonly === 'unknown' || ((v?.attrs.i?.state ?? 'off') !== 'off' && (text === undefined || evalArith(text) === undefined))) this.abort(st, false);
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
    // Assigning PATH empties the table of remembered paths.
    if (name === 'PATH') st = this.forgetHashed(st);
    if (name === 'POSIXLY_CORRECT' && !plain && this.bash && option(st, 'set', 'posix') !== 'on') st = this.setPosix(st, true, at, true);
    if (name === 'GLOBIGNORE' && this.bash) st = this.globignore(st, value);
    const all = option(st, 'set', 'allexport');
    if (!array && (all === 'on' || (all === 'unknown' && prev?.attrs.x?.state !== 'on'))) {
      const v = st.variables.get(name)!;
      st = this.put(st, 'variables', name, { ...v, attrs: { ...v.attrs, x: { state: all === 'on' ? 'on' : 'unknown', at } } });
    }
    return st;
  }

  /** GLOBIGNORE set to `value` (undefined: not known here): one that is not empty turns dotglob on, until it is unset; an empty one leaves it as it is. */
  private globignore(st: ShellState, value: string | undefined): ShellState {
    return value !== '' && option(st, 'shopt', 'dotglob') !== 'on' ? this.put(st, 'shopt', 'dotglob', value === undefined ? 'unknown' : 'on') : st;
  }

  private giveAttribute(st: ShellState, name: string, letter: string, at: SyntaxNode): ShellState {
    const v = st.variables.get(name)!;
    return this.put(st, 'variables', name, { ...v, attrs: { ...v.attrs, [letter]: { state: 'on', at } } });
  }
}

const models = new WeakMap<SyntaxTree, Map<string, StateModel>>();

/**
 * The shell state along `tree`, for `shell` (bash when absent; `posix`: `bash --posix`; `host`: the functions the
 * file's host defines, which the walk does not read, so that a call of one trusts nothing: src/semantics/trust.ts).
 * Cached per tree. The tree of a string read as a script (`StateModel.script`) has the model of that script: the
 * outer one for `eval`.
 */
export function shellState(tree: SyntaxTree, shell?: Shell, opts: { posix?: boolean; host?: readonly string[] } = {}): StateModel {
  const owner = owners.get(tree);
  if (owner) return owner.model;
  const host = opts.host ?? [];
  const key = `${shell ?? 'bash'}${opts.posix ? ' --posix' : ''}${host.length ? ` host:${[...host].sort().join(' ')}` : ''}`;
  let byKey = models.get(tree);
  if (!byKey) models.set(tree, (byKey = new Map()));
  const hit = byKey.get(key);
  if (hit) return hit;
  const model = buildModel(tree, shell, !!opts.posix, 0, MAIN_SHELL, (w) => w.initial(), undefined, host);
  byKey.set(key, model);
  return model;
}

/** What the decisions of each model trust (src/semantics/trust.ts): another shell's model trusts no more than its outer one. */
const modelTrusts = new WeakMap<StateModel, Trust>();

/**
 * The model of `tree`, whose root runs in `base`, from the state `start` gives; `depth` levels of strings deep;
 * `outer`: what the model of the script that starts this shell trusts; `host`: as for `shellState`.
 */
function buildModel(tree: SyntaxTree, shell: Shell | undefined, posix: boolean, depth: number, base: ExecEnv, start: (w: Walker) => ShellState, outer?: Trust, host: readonly string[] = []): StateModel {
  const scripts = new Scripts(depth);
  const own = scriptTrust(tree.root, true, host);
  const trust = outer ? withinTrust(own, outer) : own;
  let w = new Walker(shell, posix, scripts, trust);
  let initial!: ShellState;
  let end!: ShellState;
  try {
    initial = start(w);
    end = w.program(tree.root, initial);
  } catch (e) {
    /* c8 ignore next -- only `WalkAgain` is thrown out of a walk on purpose */
    if (!(e instanceof WalkAgain)) throw e;
  }
  // (Arithmetic read text not known on the way, or a string the walk does not read: walked again, with nothing trusted.)
  const found = w.found;
  if (found) {
    w = new Walker(shell, posix, scripts, BLIND);
    initial = start(w);
    end = w.program(tree.root, initial);
  }
  // (The model's `at` is defined below; the environments ask for it only later.)
  const envs = new EnvModel({
    run: (n) => model.at(n).run, calls: w.calls, root: tree.root, shell,
    // (The root of a string this shell runs, `eval`'s, runs where the slot does; any other, where this tree does: a
    // function another shell imports.)
    base: (root) => scripts.byRoot.get(root)?.env ?? base,
  });
  const model: StateModel = {
    script(words, env) {
      const hit = scripts.byWord.get(words[0]);
      if (hit) return hit;
      const link = env.links[env.links.length - 1] as SlotLink;
      // The walk reads the strings this shell runs (`eval`, a trap's action) where it reaches them, and it reaches
      // every command: one it has not read is run by no shell (`sudo eval s` starts no shell, so nothing runs it).
      if (link.slot.run !== 'shell-string') return { why: 'not-run' };
      return scripts.read(words, 'child', () => env, slotShell(link));
    },
    end,
    blind: found ?? trust.blind,
    env: (n) => envs.at(n),
    calls: w.calls,
    assigned: new Set([...w.lastChange.keys()].filter((k) => k.startsWith('variables ')).map((k) => k.slice('variables '.length))),
    definitions: { functions: w.functionDefs, aliases: w.aliasDefs },
    sources: w.sources,
    unit(n) {
      let top = n;
      while (top.parent?.parent) top = top.parent;
      return w.unitStart.get(top) ?? top;
    },
    setWrites: (n) => w.setWrites.get(n) ?? new Map(),
    writes: (n) => w.varWrites.get(n) ?? new Set(),
    condition: (n) => w.decision(n),
    dead: (n) => w.runAt(n) !== undefined && !w.live.has(n) && w.everywhere(n),
    at(n) {
      let run: ShellState | undefined;
      let expand: ShellState | undefined;
      let top = n;
      let root = n;
      for (let x: SyntaxNode | null = n; x; x = x.parent) {
        run ??= w.runAt(x);
        if (x.type === 'command_substitution' && x !== n) expand ??= w.runAt(x);
        if (x.parent) top = x;
        root = x;
      }
      // (A node of an `eval` or trap string the walk did not run, as after a syntax error: the state of its command.
      // Some callers ask for a node that may be missing: `case x in` with no pattern.)
      const script = run ? undefined : scripts.byRoot.get(root);
      if (script) return model.at(script.words[0]);
      const parse = w.parseAt.get(top) ?? initial;
      return { run: run ?? initial, parse, expand: expand ?? parse };
    },
  };
  scripts.model = model;
  modelTrusts.set(model, found ? BLIND : trust);
  return model;
}
