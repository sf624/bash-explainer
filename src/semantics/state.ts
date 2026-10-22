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
import { builtins } from '../dict/builtins';
import { staticWordValue } from '../staticword';
import { createUnbashParser } from '../syntax/adapters/unbash';
import { descendants, field, fields, hasError, type BashParser, type SyntaxNode, type SyntaxTree } from '../syntax/tree';
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
  /** The `unset -f` that removed it (with `state` off). */
  readonly removed?: SyntaxNode;
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
  /** The `source` and `.` commands that run (their files are not read). */
  readonly sources: readonly SyntaxNode[];
  /** The first statement of the unit bash reads at once that holds `n`: a line of top-level statements, or a compound command. */
  unit(n: SyntaxNode): SyntaxNode;
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
/** The simple commands: they expand their words before their redirections. */
const SIMPLE = ['command', 'declaration_command', 'unset_command', 'variable_assignment', 'variable_assignments'];
/** Where an expression is arithmetic: an arithmetic expansion in it is run with the expression. */
const ARITH_HOSTS = ['arithmetic_expansion', 'arithmetic_command', 'c_style_for_statement'];
/** The assignment operators of arithmetic (6.5). */
const ARITH_ASSIGN = new Set(['=', '+=', '-=', '*=', '/=', '%=', '<<=', '>>=', '&=', '^=', '|=']);
/** The names an arithmetic expression may assign (`x = 1`, `a[i] += 2`, `i++`, `--j`): its name in group 1, 3 or 4, a subscript in group 2. */
export const ARITH_ASSIGNED = /(?<![\w$])(?:([A-Za-z_]\w*)\s*(\[[^\]]*\])?\s*(?:[-+*/%&^|]|<<|>>)?=(?!=)|([A-Za-z_]\w*)\s*(?:\+\+|--)|(?:\+\+|--)\s*([A-Za-z_]\w*))/g;
const wrap = (v: bigint): bigint => BigInt.asIntN(64, v);
/** An error in arithmetic (a division by 0, a readonly variable): bash stops the expression there; `st` has what was assigned before it. */
class ArithError {
  constructor(readonly st: ShellState) {}
}
/** An error in an expansion (`$(( 1/0 ))`): bash discards the rest of the command; `st` has what was assigned before it. */
class ExpansionError {
  constructor(readonly st: ShellState) {}
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
/** Variables whose values bash changes itself (when they are read, or as time goes): not known here. */
export const DYNAMIC = /^(?:RANDOM|SRANDOM|SECONDS|LINENO|EPOCHSECONDS|EPOCHREALTIME|BASHPID|BASH_COMMAND|BASH_SUBSHELL|BASH_LINENO|BASH_SOURCE|BASH_ARGC|BASH_ARGV|BASH_ARGV0|FUNCNAME|HISTCMD|PIPESTATUS|GROUPS|DIRSTACK)$/;
/** Those of `DYNAMIC` whose values are numbers (`EPOCHREALTIME` has a dot). */
const NUMERIC_DYNAMIC = /^(?:RANDOM|SRANDOM|SECONDS|LINENO|EPOCHSECONDS|BASHPID|BASH_SUBSHELL|BASH_LINENO|BASH_ARGC|HISTCMD|PIPESTATUS|GROUPS)$/;
/** The key of `set -u` among the reads of a value (no variable has this name). */
const NOUNSET = '-u';
/** What a value read as an expression has read so far: the variables (and `set -u`), whether it can be remembered, how deep it went. */
interface ArithReads { deps: Map<string, unknown>; pure: boolean; depth: number; unsure: boolean }
/**
 * A value read as an expression, remembered with what it read and how deep it went: its value; or `unknown` (`deep`:
 * it went deeper than `ARITH_DEPTH` from where it was read, `depth` is then at least what it needs); `unsure`: it read
 * a value not known.
 */
interface ArithRemembered { deps: ReadonlyMap<string, unknown>; depth: number; value?: bigint; unknown: false | 'always' | 'deep'; unsure: boolean }

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

const EMPTY: ShellState = {
  set: NameMap.empty(), shopt: NameMap.empty(), variables: NameMap.empty(), functions: NameMap.empty(), aliases: NameMap.empty(), disabled: NameMap.empty(), hashed: NameMap.empty(),
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
  return states.reduce((a, b) => (a === b ? a : {
    set: NameMap.merge(a.set, b.set, (k, x, y) => mergeOption('set', k, x, y, posix)),
    shopt: NameMap.merge(a.shopt, b.shopt, (k, x, y) => mergeOption('shopt', k, x, y, posix)),
    variables: NameMap.merge(a.variables, b.variables, (_k, x, y) => mergeVariable(x, y)),
    functions: NameMap.merge(a.functions, b.functions, (_k, x, y) => mergeFunction(x, y)),
    aliases: NameMap.merge(a.aliases, b.aliases, (_k, x, y) => mergeAlias(x, y)),
    disabled: NameMap.merge(a.disabled, b.disabled, (_k, x, y) => mergeAlias(x, y)),
    hashed: NameMap.merge(a.hashed, b.hashed, (_k, x, y) => mergeAlias(x, y)),
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

/** How many times a function body is walked with different states before the rest of its calls are guessed. */
const WALKS_PER_FUNCTION = 4;
/** How deep calls are followed (deeper ones are guessed). */
const CALL_DEPTH = 64;

let aliasParser: BashParser | undefined;
const aliasTrees = new Map<string, SyntaxTree>();

class Walker {
  /** The states each node was run with (more than one in a loop or a function called more than once); merged when asked. */
  private readonly runStates = new Map<SyntaxNode, ShellState[]>();
  /** The `set` commands, with the options they turn on or off (on any walk). */
  readonly setWrites = new Map<SyntaxNode, Map<string, 'on' | 'off'>>();
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
  private readonly traps: { text: string; host: SyntaxNode; st: ShellState; since: number; exit: boolean }[] = [];
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
    const unset = new Set([...descendants(root, ['unset_command']).flatMap((u) => u.namedChildren),
      ...descendants(root, ['command']).filter((c) => this.commandName(c) === 'unset').flatMap((c) => fields(c, 'argument'))].map((w) => staticWordValue(w) ?? w.text));
    for (const def of descendants(root, ['function_definition'])) {
      // (At the top level, or first in a list there: `f() { …; } && complete -F f x` always defines it.)
      let x = def;
      while (x.parent?.type === 'list' && x.parent.namedChildren[0] === x) x = x.parent;
      const name = field(def, 'name')!.text;
      if (x.parent === root && !unset.has(name) && !subshellReasons(x).length) this.sureLater.set(name, def);
    }
    // The units bash reads at once: the top-level statements that share a line.
    const tops = root.namedChildren.filter((c) => STATEMENTS.has(c.type));
    const unitStart = this.unitStart;
    tops.forEach((t, i) => unitStart.set(t, i > 0 && tops[i - 1].endPosition.row === t.startPosition.row ? unitStart.get(tops[i - 1])! : t));
    const end = this.sequence(root.children, this.initial(), (t, st) => {
      const unit = unitStart.get(t)!;
      this.parseAt.set(t, unit === t ? st : this.parseAt.get(unit)!);
      this.expand = this.parseAt.get(t)!;
    });
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
    for (const t of this.traps.splice(0)) {
      const after = new Set([...this.lastChange].filter(([, i]) => i > t.since).map(([k]) => k));
      const st = t.exit && this.topLevel(t.host) ? end : this.widen(t.st, after);
      this.expand = st;
      this.runText(t.text, t.host, st);
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
    return {
      set: st.set.withAll(changes.set), shopt: st.shopt.withAll(changes.shopt), variables: st.variables.withAll(changes.variables),
      functions: st.functions.withAll(changes.functions), aliases: st.aliases.withAll(changes.aliases),
      disabled: st.disabled.withAll(changes.disabled), hashed: st.hashed.withAll(changes.hashed),
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
    } catch (e) {
      // (An expansion error discards the rest of the command; the rest of its line too, which is not followed.)
      if (e instanceof ExpansionError) return subshellReasons(n).length ? st : e.st;
      /* c8 ignore next -- only an expansion error is thrown on purpose */
      throw e;
    } finally {
      this.node = outer;
    }
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
        return this.assignNode(n, this.defaults(n, st));
      case 'variable_assignments':
        for (const a of n.namedChildren) {
          this.record(a, st);
          this.substitutions(a, st);
          st = this.assignNode(a, this.defaults(a, st));
        }
        return st;
      case 'test_command': case 'extended_test':
        this.substitutions(n, st);
        return this.defaults(n, st);
      case 'arithmetic_command':
        this.substitutions(n, st);
        return this.arithRun((s) => this.arithScript(n.namedChildren, s).st, this.defaults(n, st));
      case 'negated_command': case 'time_statement': case 'compound_statement':
        return this.sequence(n.children, st);
      case 'redirected_statement': {
        // A compound command makes its redirections first; a simple command expands its words first (see `redirections`),
        // and assignments alone are made before them.
        for (const r of fields(n, 'redirect')) this.substitutions(r, st);
        const body = field(n, 'body');
        const simple = !!body && SIMPLE.includes(body.type);
        // (A subshell makes them in its own process: `( : ) > $(( n = 3 ))` leaves n.)
        if (!simple) st = this.expandAll(fields(n, 'redirect'), st, body?.type === 'subshell' ? 'on' : 'off');
        st = this.sequence(n.children.filter((c) => c.field !== 'redirect'), st);
        return body?.type.startsWith('variable_assignment') ? this.expandAll(fields(n, 'redirect'), st, 'off') : st;
      }
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
        st = this.defaults(field(n, 'value')!, st);
        // The patterns are expanded in turn until one matches: the first one always, the others may be.
        const items = n.namedChildren.filter((c) => c.type === 'case_item');
        items.flatMap((item) => fields(item, 'value')).forEach((v, i) => {
          this.substitutions(v, st);
          const after = this.defaults(v, st);
          st = i === 0 || after === st ? after : merge([st, after], this.posix);
        });
        const ends: ShellState[] = [];
        let always = false;
        for (const item of items) {
          ends.push(this.sequence(item.children, st));
          // A `*)` branch takes every value that reaches it.
          if (fields(item, 'value').some((v) => v.text === '*')) always = true;
        }
        return merge(always ? ends : [st, ...ends], this.posix);
      }
      case 'while_statement': {
        const body = field(n, 'body');
        const cond = n.children.filter((c) => c !== body);
        return this.loop(n, st, (s) => this.sequence(cond, s), (s) => this.sequence(body?.children ?? [], s), true);
      }
      case 'for_statement': case 'select_statement': return this.forStatement(n, st);
      case 'c_style_for_statement': {
        // The initializer, then the condition, the body and the update, again and again; the loop ends after a condition.
        for (const c of n.namedChildren) if (c.type !== 'do_group') this.substitutions(c, st);
        const part = (f: 'initializer' | 'condition' | 'update') => (s: ShellState): ShellState => this.arithRun((x) => this.arithScript(fields(n, f), x).st, s);
        return this.loop(n, part('initializer')(st), part('condition'), (s) => part('update')(this.sequence(field(n, 'body')?.children ?? [], s)), true);
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
        try {
          after = this.arithScript(e.namedChildren, st).st;
        } catch (err) {
          /* c8 ignore next -- only an arithmetic error is thrown on purpose */
          if (!(err instanceof ArithError)) throw err;
          throw new ExpansionError(maybe ? merge([st, err.st], this.posix) : err.st);
        }
      } else after = this.defaultOf(e, st);
      st = maybe && after !== st ? merge([st, after], this.posix) : after;
    }
    return st;
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
    return this.expandAll([...n.namedChildren.filter((c) => c.field === 'redirect'), ...outer], st, program);
  }

  /**
   * Whether the simple command `c` runs a program (not a builtin or a function), in a process of its own, where its
   * redirections are made; `unknown` when its name is not known here. `command cat` runs `cat` (`command -v` only
   * looks it up), and never a function.
   */
  private runsProgram(c: SyntaxNode, st: ShellState): Tri {
    let name = this.commandName(c);
    let args = fields(c, 'argument');
    let fn = true;
    while (name === 'command') {
      const i = args.findIndex((a) => !/^-/.test(staticWordValue(a) ?? '-'));
      if (i < 0 || args.slice(0, i).some((a) => /^-\w*[vV]/.test(a.text))) return 'off';
      name = staticWordValue(args[i]);
      args = args.slice(i + 1);
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
  private arithScript(nodes: readonly SyntaxNode[], st: ShellState): { st: ShellState; value?: bigint } {
    return nodes.length ? this.arithGuard(arithSource(nodes), st, nodes[0], () => this.arithEval(nodes, st)) : { st, value: 0n };
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
   * count of its steps of its own. When what it does is not known, see `mayAssign`.
   */
  private arithGuard(source: string, st: ShellState, at: SyntaxNode, run: () => { st: ShellState; value?: bigint }): { st: ShellState; value?: bigint } {
    this.arithSteps = 0;
    this.unsure = false;
    try {
      if (this.arithWalkSteps > ARITH_WALK_STEPS) throw new ArithUnknown('limit');
      return run();
    } catch (e) {
      // (A text nested too deeply for the stack of JavaScript, in the parser or here, is not followed either.)
      if (!(e instanceof ArithUnknown) && !(e instanceof RangeError)) throw e;
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
        const name = /^\$\{?([A-Za-z_]\w*)\}?$/.exec(p.text)?.[1];
        const text = name === undefined ? undefined : this.variableText(st, name);
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
    operands.forEach((o, i) => {
      const text = texts[i];
      if (text === undefined) {
        // (What its `$(( ))` assign was made with the words.)
        st = this.mayAssign(descendants(o, ['arithmetic_expansion']).reduce((t, a) => t.replace(a.text, ''), o.text), st, o);
        return;
      }
      const from = st;
      st = this.arithGuard(o.text, st, o, () => this.arithText(text, from, o, true)).st;
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
    if (!v) return /^[A-Z_][A-Z0-9_]*$/.test(target) || this.opaque ? undefined : unset;
    if (v.declared === 'unknown' || v.set === 'unknown' || ['a', 'A'].some((l) => (v.attrs[l]?.state ?? 'off') !== 'off')) return undefined;
    return v.set === 'off' ? unset : v.value;
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
    const assoc = attribute(st, field(target, 'name')!.text, 'A');
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
      return { st, value: seen.value };
    }
    // A name read again with nothing changed since leads back to itself for ever: bash fails at its recursion
    // limit. (With something changed, `x='i++ < 5 ? x : 0'`, it may end: followed so deep only.)
    if (this.arithReading.some((r) => r.name === name && r.st === st)) throw new ArithError(st);
    if (this.arithReading.length >= ARITH_DEPTH) throw new ArithUnknown('deep');
    const from = this.arithReading.length;
    const reads: ArithReads = { deps: new Map(), pure: true, depth: 1, unsure: false };
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
        up.depth = Math.max(up.depth, reads.depth + 1);
      }
    }
    if (r.st === st && reads.pure) this.remember(name, reads, r.value, false);
    return r;
  }

  private remember(name: string, reads: ArithReads, value: bigint | undefined, unknown: ArithRemembered['unknown']): void {
    const list = this.arithMemo.get(name) ?? [];
    list.unshift({ deps: reads.deps, depth: reads.depth, value, unknown, unsure: reads.unsure });
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
      const lexed = incDecText(text);
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
  private loop(n: SyntaxNode, st: ShellState, cond: (s: ShellState) => ShellState, body: (s: ShellState) => ShellState, endsWithCondition: boolean, atLeastOnce = false): ShellState {
    const before = this.loopDepth ? this.loopsWalked.get(n) : undefined;
    let entry = st;
    if (before) {
      const was = { ...st };
      for (const key of before.keys) {
        const kind = key.slice(0, key.indexOf(' ')) as Kind;
        const name = key.slice(kind.length + 1);
        (was as Record<Kind, NameMap<unknown>>)[kind] = (was[kind] as NameMap<unknown>).with(name, before.entry[kind].get(name));
      }
      entry = merge([st, was], this.posix);
    }
    const keys = new Set<string>();
    this.collecting.push(keys);
    this.loopDepth++;
    let end = st;
    for (let pass = 0; pass < 5; pass++) {
      end = body(cond(entry));
      const next = merge([st, end], this.posix);
      if (sameState(next, entry)) break;
      entry = next;
    }
    this.loopDepth--;
    this.collecting.pop();
    this.loopsWalked.set(n, { keys, entry });
    return endsWithCondition ? cond(entry) : atLeastOnce ? end : entry;
  }

  private forStatement(n: SyntaxNode, st: ShellState): ShellState {
    const values = fields(n, 'value');
    for (const v of values) {
      this.substitutions(v, st);
      st = this.defaults(v, st);
    }
    const variable = field(n, 'variable');
    const assign = (s: ShellState, value: string | undefined): ShellState => (variable ? this.setVariable(s, variable.text, variable, value) : s);
    // `for x in a b c`: x is each word in turn, then stays the last; with no `in`, the positional parameters.
    const words = values.map((v) => (v.type === 'word' || v.type === 'number' || v.type === 'raw_string' || v.type === 'string' ? staticWordValue(v) : undefined));
    const known = n.type === 'for_statement' && values.length > 0 && words.every((w) => w !== undefined);
    const each = known && new Set(words).size === 1 ? words[0] : undefined;
    // (A list of known words runs the body at least once.)
    const end = this.loop(n, st, (s) => s, (s) => this.sequence(field(n, 'body')?.children ?? [], assign(s, each)), false, known);
    return known ? assign(end, words[words.length - 1]) : end;
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
    // A `local GLOBIGNORE` going out of scope sets GLOBIGNORE again, or unsets it: dotglob follows, as for an assignment or `unset`.
    if (frame.saved.has('GLOBIGNORE') && this.bash) {
      const gi = frame.saved.get('GLOBIGNORE');
      end = !gi || gi.set === 'off' ? this.put(end, 'shopt', 'dotglob', 'off') : this.globignore(end, gi.set === 'on' ? gi.value : undefined);
    }
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
    // With no command name, the assignments are the shell's, made before the redirections.
    if (name === '') {
      for (const a of assignments) {
        this.record(a, st);
        st = this.assignNode(a, this.defaults(a, st));
      }
      return this.redirections(n, st, 'off');
    }
    // The words are expanded, then the values of the assignments, then the redirections are made.
    const before = st;
    st = this.expandAll(n.namedChildren.filter((c) => !assignments.includes(c) && c.field !== 'redirect'), st);
    st = this.redirections(n, this.expandAll(assignments, st), this.runsProgram(n, st));
    // A prefix assignment to PATH empties the table of remembered paths too.
    if (assignments.some((a) => field(a, 'name')!.text === 'PATH')) st = this.forgetHashed(st);
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
    const fn = this.functionCalled(name, st);
    if (fn) return this.call(fn, st, assignments);
    return this.builtin(name, fields(n, 'argument'), n, st);
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
      if (next === undefined || args.slice(0, i).some((a) => /^-\w*[vV]/.test(a.text))) return st;
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
        // (A trap that runs something may run between any two commands.)
        if (name === 'eval' || (words.length && text.some((t) => t !== '' && t !== '-'))) this.turnOpaque();
        if (!words.length || text.some((t) => t === undefined)) return st;
        if (name === 'eval') this.runText(text.join(' '), n, st);
        else {
          const signals = parse.roles.filter((r) => r.role.role === 'operand' && r.role.spec?.name !== 'ACTION').map((r) => staticWordValue(args[r.word]) ?? '');
          this.traps.push({ text: text.join(' '), host: this.aliasHost ?? n, st, since: this.changeCount, exit: signals.some((x) => /^(SIG)?EXIT$|^0$/i.test(x)) });
        }
        return st;
      }
      case 'let': return this.arithRun((s) => this.letCommand(operands, s), st);
      case 'source': case '.':
        // (The file is not read: what it defines is not known here.)
        this.sources.push(this.aliasHost ?? n);
        this.turnOpaque();
        return st;
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
      const writes = this.setWrites.get(this.node!) ?? new Map<string, 'on' | 'off'>();
      this.setWrites.set(this.node!, writes.set(name, on ? 'on' : 'off'));
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
    sources: w.sources,
    unit(n) {
      let top = n;
      while (top.parent?.parent) top = top.parent;
      return w.unitStart.get(top) ?? top;
    },
    setWrites: (n) => w.setWrites.get(n) ?? new Map(),
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
