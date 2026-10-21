// The shell state along a script (docs/design/semantics.md, 4.3 and step B1): the options of `set` and
// `shopt`, the variables and their attributes, the functions and the aliases that apply at each node.
//
// One walk over the tree, in source order, carries a `ShellState`. Commands that change the state (`set`,
// `shopt`, `alias`, `unalias`, `unset`, the declaration builtins, `read`, `mapfile`, assignments, function
// definitions and calls) are read with their builtin's spec (src/argv/), not with regular expressions.
//
// - A subshell gets the state and drops what it changes: `( )`, `$( )`, `<( )`, a background job, a coproc,
//   and every stage of a pipeline but the last one with lastpipe on and job control off.
// - The branches of `if`, `case`, `&&` and `||` start from the same state and are merged after; a value that
//   differs becomes `unknown`. A loop body is walked until its state no longer changes, then merged with the
//   state before the loop (it may not run).
// - A function body is walked once, at its definition, from the state there, with every function of the
//   script known (it runs later, when it is called). What it changes outside its locals is applied where the
//   function is called.
// - bash reads a whole line, or a whole compound command, before it runs any of it: aliases and extglob count
//   from the next such unit on (`parse`), the other options from the next command (`run`).
//
// The model is built once per tree (and shell) and cached.
import { evalArith } from '../arith';
import { interpret, type ArgRole } from '../argv/interpret';
import { argWord } from '../argv/words';
import type { Shell } from '../dialect';
import { builtins } from '../dict/builtins';
import { staticWordValue } from '../staticword';
import { descendants, field, fields, type SyntaxNode, type SyntaxTree } from '../syntax/tree';

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
  /** Whether it is set (or declared): `off` after `unset`, `unknown` when only some paths set it. */
  readonly set: Tri;
  readonly attrs: Readonly<Record<string, Attribute>>;
  /** Its value, when it is a scalar whose text is known here. */
  readonly value?: string;
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
}

export interface AliasState {
  readonly state: Tri;
  /** What it stands for: the text after `=`, without its quotes. */
  readonly value: string;
  /** The `alias` command. */
  readonly at: SyntaxNode;
}

/** The state of the shell at a place. A name not in a map has not been changed by the script. */
export interface ShellState {
  /** `set -o` options, by long name (`errexit`, `noglob`, `posix`…). */
  readonly set: ReadonlyMap<string, OptionState>;
  /** `shopt` options. */
  readonly shopt: ReadonlyMap<string, OptionState>;
  readonly variables: ReadonlyMap<string, VariableState>;
  readonly functions: ReadonlyMap<string, FunctionState>;
  readonly aliases: ReadonlyMap<string, AliasState>;
}

export interface StateModel {
  /** `run`: the state before `n` runs; `parse`: the state when bash read the unit that holds it. */
  at(n: SyntaxNode): { run: ShellState; parse: ShellState };
  /** The state at the end of the script. */
  readonly end: ShellState;
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
/** The shells that start in POSIX mode (for what the model follows: assignments before special builtins). */
const POSIX_SHELLS = new Set<Shell>(['sh', 'dash', 'ash', 'yash', 'ksh', 'mksh']);

/** Statements: what a list of commands is made of. */
const STATEMENTS = new Set(['command', 'declaration_command', 'unset_command', 'variable_assignment', 'variable_assignments', 'negated_command',
  'redirected_statement', 'pipeline', 'list', 'time_statement', 'coproc_statement', 'compound_statement', 'subshell', 'if_statement', 'case_statement',
  'for_statement', 'select_statement', 'c_style_for_statement', 'while_statement', 'function_definition', 'arithmetic_command', 'test_command', 'extended_test']);
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

const declarations = new WeakMap<SyntaxNode, Declaration>();
/** A declaration command (`declare -ix -- a=1 b`) read with its builtin's spec. */
export function readDeclaration(d: SyntaxNode): Declaration {
  const seen = declarations.get(d);
  if (seen) return seen;
  const words = d.namedChildren.filter((c) => !c.type.endsWith('redirect'));
  const parse = interpret(builtins[d.children[0].type], words.map(argWord), { name: d.children[0].type });
  const roles = new Map(parse.roles.map(({ word, role }) => [words[word], role]));
  let on = '';
  let off = '';
  for (const { role } of parse.roles) {
    for (const r of role.role === 'cluster' ? role.letters : [role]) {
      if (r.role !== 'option') continue;
      if (r.disables) off += r.flag.slice(1);
      else on += r.flag.slice(1);
    }
  }
  const out = { roles, on, off };
  declarations.set(d, out);
  return out;
}

// ---------------------------------------------------------------------------------------------------
// States: immutable; a change makes a new one that shares the maps it does not change.

type Kind = keyof ShellState;
type Entry<K extends Kind> = ShellState[K] extends ReadonlyMap<string, infer V> ? V : never;

const EMPTY: ShellState = { set: new Map(), shopt: new Map(), variables: new Map(), functions: new Map(), aliases: new Map() };

function put<K extends Kind>(st: ShellState, kind: K, name: string, value: Entry<K>): ShellState {
  const map = new Map(st[kind] as ReadonlyMap<string, Entry<K>>);
  map.set(name, value);
  return { ...st, [kind]: map };
}

const later = (a: SyntaxNode, b: SyntaxNode): SyntaxNode => (b.startIndex > a.startIndex ? b : a);
const tri = (a: Tri, b: Tri): Tri => (a === b ? a : 'unknown');

function mergeOption(kind: 'set' | 'shopt', name: string, a: OptionState, b: OptionState, posix: boolean): OptionState {
  if (a === b) return a;
  // Turned to its default value on one path, left alone on the other: still the default.
  const def = defaultOn(kind, name, posix) ? 'on' : 'off';
  if ((a === 'default' && b === def) || (b === 'default' && a === def)) return 'default';
  return 'unknown';
}

function mergeVariable(a: VariableState | undefined, b: VariableState | undefined): VariableState {
  // Set on one path only: its attributes are those it has where it is set.
  if (!a || !b) {
    const v = (a ?? b)!;
    return v.set === 'unknown' ? v : { ...v, set: 'unknown', value: undefined };
  }
  const attrs: Record<string, Attribute> = {};
  for (const l of new Set([...Object.keys(a.attrs), ...Object.keys(b.attrs)])) {
    const x = a.attrs[l];
    const y = b.attrs[l];
    attrs[l] = x && y ? { state: tri(x.state, y.state), at: later(x.at, y.at) } : { state: tri((x ?? y)!.state, 'off'), at: (x ?? y)!.at };
  }
  return { set: tri(a.set, b.set), attrs, value: a.value === b.value ? a.value : undefined, at: later(a.at, b.at) };
}

function mergeFunction(a: FunctionState | undefined, b: FunctionState | undefined): FunctionState {
  if (!a || !b) {
    const f = (a ?? b)!;
    return { ...f, state: tri(f.state, 'off') };
  }
  return { state: tri(a.state, b.state), def: later(a.def, b.def), exported: tri(a.exported, b.exported) };
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
  return states.reduce((a, b) => {
    if (a === b) return a;
    const out: Record<Kind, Map<string, unknown>> = { set: new Map(), shopt: new Map(), variables: new Map(), functions: new Map(), aliases: new Map() };
    for (const kind of ['set', 'shopt'] as const) {
      for (const name of new Set([...a[kind].keys(), ...b[kind].keys()])) out[kind].set(name, mergeOption(kind, name, option(a, kind, name), option(b, kind, name), posix));
    }
    for (const name of new Set([...a.variables.keys(), ...b.variables.keys()])) {
      const x = a.variables.get(name);
      const y = b.variables.get(name);
      out.variables.set(name, x === y ? x : mergeVariable(x, y));
    }
    for (const name of new Set([...a.functions.keys(), ...b.functions.keys()])) {
      const x = a.functions.get(name);
      const y = b.functions.get(name);
      out.functions.set(name, x === y ? x : mergeFunction(x, y));
    }
    for (const name of new Set([...a.aliases.keys(), ...b.aliases.keys()])) {
      const x = a.aliases.get(name);
      const y = b.aliases.get(name);
      out.aliases.set(name, x === y ? x : mergeAlias(x, y));
    }
    return out as unknown as ShellState;
  });
}

/** Whether two states say the same (the nodes where things changed aside). */
function sameState(a: ShellState, b: ShellState): boolean {
  if (a === b) return true;
  const key = (st: ShellState): string => JSON.stringify([
    [...st.set], [...st.shopt],
    [...st.variables].map(([k, v]) => [k, v.set, v.value, Object.entries(v.attrs).map(([l, x]) => [l, x.state])]),
    [...st.functions].map(([k, f]) => [k, f.state, f.def.startIndex, f.exported]),
    [...st.aliases].map(([k, x]) => [k, x.state, x.value]),
  ]);
  return key(a) === key(b);
}

// ---------------------------------------------------------------------------------------------------
// The walk.

/** What a function changes in the shell that calls it: the entries of its body's end state that differ from its start. */
type Effects = { [K in Kind]: [string, Entry<K>][] };

/** The function whose body is being walked: its local variables. */
interface Frame { locals: Set<string> }

class Walker {
  readonly runAt = new Map<SyntaxNode, ShellState>();
  readonly parseAt = new Map<SyntaxNode, ShellState>();
  private readonly effects = new Map<SyntaxNode, Effects>();
  readonly functionDefs = new Map<string, SyntaxNode[]>();
  readonly aliasDefs = new Map<string, SyntaxNode[]>();
  private frame: Frame | undefined;
  private readonly bash: boolean;

  constructor(private readonly shell: Shell | undefined, private readonly posix: boolean) {
    this.bash = !shell || shell === 'bash';
  }

  initial(): ShellState {
    let st = EMPTY;
    if (this.posix) {
      for (const kind of ['set', 'shopt'] as const) for (const name of POSIX_ON[kind]) st = put(st, kind, name, 'on');
    } else if (this.shell && POSIX_SHELLS.has(this.shell)) {
      st = put(st, 'set', 'posix', 'on');
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
    return this.sequence(root.children, this.initial(), (t, st) => {
      if (unitStart.get(t) === t) this.parseAt.set(t, st);
      else this.parseAt.set(t, this.parseAt.get(unitStart.get(t)!)!);
    });
  }

  /** Runs the statements among `nodes`, in order; one followed by `&` runs in the background (a subshell). */
  private sequence(nodes: readonly SyntaxNode[], st: ShellState, before?: (n: SyntaxNode, st: ShellState) => void): ShellState {
    nodes.forEach((n, i) => {
      if (!STATEMENTS.has(n.type)) return;
      before?.(n, st);
      if (nodes[i + 1]?.type === '&') this.run(n, st);
      else st = this.run(n, st);
    });
    return st;
  }

  /** The children of `n` after its token `from` and before the first child of a type in `to`. */
  private part(n: SyntaxNode, from: string, to: string[]): SyntaxNode[] {
    const kids = n.children;
    const out: SyntaxNode[] = [];
    for (let i = kids.findIndex((c) => !c.named && c.type === from) + 1; i < kids.length && !to.includes(kids[i].type); i++) out.push(kids[i]);
    return out;
  }

  /** The state after `n` runs from `st`. */
  run(n: SyntaxNode, st: ShellState): ShellState {
    this.runAt.set(n, st);
    switch (n.type) {
      case 'command': return this.command(n, st);
      case 'declaration_command': return this.declaration(n, st);
      case 'unset_command': return this.unset(n, st);
      case 'variable_assignment':
        this.substitutions(n, st);
        return this.defaults(n, this.assign(n, st));
      case 'variable_assignments':
        for (const a of n.namedChildren) {
          this.runAt.set(a, st);
          this.substitutions(a, st);
          st = this.defaults(a, this.assign(a, st));
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
      case 'subshell':
        this.sequence(n.children, st);
        return st;
      case 'coproc_statement':
        this.sequence(n.children, st);
        return st;
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
    const visit = (x: SyntaxNode): void => {
      for (const c of x.children) {
        if (SUBSTITUTIONS.includes(c.type)) this.sequence(c.children, st);
        else if (!STATEMENTS.has(c.type) || c.parent?.type === 'command' || c.parent?.type === 'declaration_command' || c.parent?.type === 'variable_assignments') visit(c);
      }
    };
    if (SUBSTITUTIONS.includes(n.type)) this.sequence(n.children, st);
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
    stages.slice(0, -1).forEach((s) => this.run(s, st));
    const last = stages[stages.length - 1];
    // zsh and ksh run the last stage in the shell; bash with lastpipe on, when job control is off.
    const here: Tri = this.shell === 'zsh' || this.shell === 'ksh' ? 'on'
      : option(st, 'set', 'monitor') === 'on' ? 'off'
      : (({ on: 'on', unknown: 'unknown' } as Record<string, Tri>)[option(st, 'shopt', 'lastpipe')] ?? 'off');
    const after = this.run(last, st);
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
   * changes (the states recorded inside are those of that last pass). A `while` ends after its condition; a
   * `for`, after the body or before it (an empty list).
   */
  private loop(st: ShellState, cond: (s: ShellState) => ShellState, body: (s: ShellState) => ShellState, endsWithCondition: boolean): ShellState {
    let entry = st;
    for (let pass = 0; pass < 5; pass++) {
      const next = merge([st, body(cond(entry))], this.posix);
      if (sameState(next, entry)) break;
      entry = next;
    }
    return endsWithCondition ? cond(entry) : entry;
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
    const end = this.loop(st, (s) => s, (s) => this.sequence(field(n, 'body')?.children ?? [], assign(s, each)), false);
    return known ? assign(end, words[words.length - 1]) : end;
  }

  private functionDefinition(n: SyntaxNode, st: ShellState): ShellState {
    const name = field(n, 'name')!.text;
    const prev = st.functions.get(name);
    st = put(st, 'functions', name, { state: 'on', def: n, exported: prev?.exported ?? 'off' });
    // The body runs when the function is called, after the rest of the script's functions may be defined.
    let start = st;
    for (const [fn, defs] of this.functionDefs) {
      if (!start.functions.has(fn) || start.functions.get(fn)!.state === 'off') start = put(start, 'functions', fn, { state: 'unknown', def: defs[defs.length - 1], exported: 'off' });
    }
    const outer = this.frame;
    this.frame = { locals: new Set() };
    // (`f() ( … )` runs its body in a subshell; `f()` while typing has none yet.)
    const body = field(n, 'body');
    const run = body ? this.run(body, start) : start;
    const end = body?.type === 'subshell' ? start : run;
    const locals = this.frame.locals;
    this.frame = outer;
    const effects = { set: [], shopt: [], variables: [], functions: [], aliases: [] } as unknown as Effects;
    for (const kind of Object.keys(effects) as Kind[]) {
      for (const [k, v] of end[kind]) {
        if ((start[kind] as ReadonlyMap<string, unknown>).get(k) !== v && !(kind === 'variables' && locals.has(k))) (effects[kind] as [string, unknown][]).push([k, v]);
      }
    }
    this.effects.set(n, effects);
    return st;
  }

  /** The state after a call of the function `fn`: what its body changes outside its locals. */
  private call(fn: FunctionState, st: ShellState): ShellState {
    const effects = this.effects.get(fn.def);
    // (A call inside the function's own body, before its effects are known.)
    if (!effects) return st;
    let after = st;
    for (const kind of Object.keys(effects) as Kind[]) for (const [k, v] of effects[kind]) after = put(after, kind, k, v as never);
    return fn.state === 'on' ? after : merge([st, after], this.posix);
  }

  /** The name of a command, when it is known (`''`: it expands to nothing, as `$(:)` does). */
  private commandName(c: SyntaxNode): string | undefined {
    return staticWordValue(field(c, 'name')!.namedChildren[0]);
  }

  private command(n: SyntaxNode, st: ShellState): ShellState {
    this.substitutions(n, st);
    const name = this.commandName(n);
    const nameNode = field(n, 'name')!;
    const assignments = n.namedChildren.filter((c) => c.type === 'variable_assignment' && c.startIndex < nameNode.startIndex);
    const before = st;
    // With no command name, the assignments are the shell's.
    if (name === '') {
      for (const a of assignments) {
        this.runAt.set(a, st);
        st = this.assign(a, st);
      }
      return this.defaults(n, st);
    }
    st = this.defaults(n, st);
    // In POSIX mode, the assignments before a special builtin stay after it, exported.
    const posix = option(before, 'set', 'posix');
    if (assignments.length && name && builtins[name]?.builtin === 'special' && (posix === 'on' || posix === 'unknown')) {
      let kept = st;
      for (const a of assignments) kept = this.exportVariable(this.assign(a, kept), field(a, 'name')!.text, a);
      st = posix === 'on' ? kept : merge([st, kept], this.posix);
    }
    if (name === undefined) return st;
    const fn = st.functions.get(name);
    if (fn && fn.state !== 'off') return this.call(fn, st);
    const args = fields(n, 'argument');
    const parse = builtins[name] && this.bashBuiltin(name) ? interpret(builtins[name], args.map(argWord), { name }) : undefined;
    if (!parse) return st;
    const operands = parse.roles.filter((r) => r.role.role === 'operand').map((r) => args[r.word]);
    const valueOf = (flag: string): SyntaxNode | undefined => {
      const r = parse.roles.find((x) => x.role.role === 'value' && x.role.of === flag);
      return r ? args[r.word] : undefined;
    };
    const letters = parse.roles.flatMap((r) => (r.role.role === 'cluster' ? r.role.letters : [r.role])).filter((r): r is Extract<ArgRole, { role: 'option' }> => r.role === 'option');
    const has = (flag: string): boolean => letters.some((l) => l.flag === flag);
    switch (name) {
      case 'set': return this.setCommand(n, st, parse.roles.map((r) => r.role), args);
      case 'shopt': {
        const on = has('-s') ? 'on' : has('-u') ? 'off' : undefined;
        if (!on) return st;
        for (const o of operands) {
          const opt = staticWordValue(o);
          if (opt) st = put(st, has('-o') ? 'set' : 'shopt', opt, on);
        }
        return st;
      }
      case 'alias':
        for (const a of args) {
          const def = this.aliasOf(a);
          if (def) st = put(st, 'aliases', def.name, { state: 'on', value: def.value, at: n });
        }
        return st;
      case 'unalias':
        if (has('-a')) {
          for (const k of st.aliases.keys()) st = put(st, 'aliases', k, { ...st.aliases.get(k)!, state: 'off' });
        }
        for (const o of operands) {
          const a = staticWordValue(o);
          const prev = a ? st.aliases.get(a) : undefined;
          if (prev) st = put(st, 'aliases', a!, { ...prev, state: 'off' });
        }
        return st;
      case 'read': {
        const array = valueOf('-a');
        if (array) return this.giveAttribute(this.setVariable(st, array.text, n, undefined), array.text, 'a', n);
        for (const o of operands.length ? operands : []) st = this.setVariable(st, o.text, n, undefined);
        return st;
      }
      case 'mapfile': case 'readarray': {
        const array = operands[0]?.text ?? 'MAPFILE';
        return this.giveAttribute(this.setVariable(st, array, n, undefined), array, 'a', n);
      }
      case 'printf': {
        const v = valueOf('-v');
        return v ? this.setVariable(st, v.text, n, undefined) : st;
      }
      case 'getopts': {
        if (operands[1]) st = this.setVariable(st, operands[1].text, n, undefined);
        return this.setVariable(this.setVariable(st, 'OPTIND', n, undefined), 'OPTARG', n, undefined);
      }
    }
    return st;
  }

  /** Whether `name` is read here as bash's builtin (the others are programs, or other shells' builtins). */
  private bashBuiltin(name: string): boolean {
    return this.bash || !['shopt', 'mapfile', 'readarray'].includes(name);
  }

  /** `alias name=value`: the name and what it stands for (static, or the text without its outer quotes). */
  private aliasOf(a: SyntaxNode): { name: string; value: string } | undefined {
    const m = /^([\w.:@%+-]+)=(['"]?)([\s\S]*)\2$/.exec(a.text);
    if (!m) return undefined;
    const v = staticWordValue(a);
    return { name: m[1], value: v !== undefined ? v.slice(v.indexOf('=') + 1) : m[3] };
  }

  private setCommand(n: SyntaxNode, st: ShellState, roles: ArgRole[], args: SyntaxNode[]): ShellState {
    const turn = (name: string, on: boolean): void => {
      if (name === 'posix') {
        // POSIX mode turns these on; leaving it turns expand_aliases and shift_verbose off (not inherit_errexit).
        for (const s of POSIX_ON.shopt) if (this.bash && (on || s !== 'inherit_errexit')) st = put(st, 'shopt', s, on ? 'on' : 'off');
        st = on ? this.setVariable(st, 'POSIXLY_CORRECT', n, 'y') : put(st, 'variables', 'POSIXLY_CORRECT', { set: 'off', attrs: {}, at: n });
      }
      st = put(st, 'set', name, on ? 'on' : 'off');
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

  private declaration(n: SyntaxNode, st: ShellState): ShellState {
    this.substitutions(n, st);
    const builtin = n.children[0].type;
    const { roles, on, off } = readDeclaration(n);
    if (on.includes('p')) return st;
    const operands = n.namedChildren.filter((c) => roles.get(c)?.role === 'operand');
    // `export -f f`, `declare -fx f`: the names are functions.
    if (/[fF]/.test(on)) {
      const exported: Tri | undefined = (builtin === 'export' && !on.includes('n')) || on.includes('x') ? 'on' : (builtin === 'export' || off.includes('x')) ? 'off' : undefined;
      for (const o of operands) {
        const fn = st.functions.get(o.text);
        if (fn && exported) st = put(st, 'functions', o.text, { ...fn, exported });
      }
      return st;
    }
    const gives = builtin === 'export' ? (on.includes('n') ? '' : 'x') : builtin === 'readonly' ? 'r' : [...on].filter((l) => ATTRIBUTE_LETTERS.has(l)).join('');
    const removes = builtin === 'export' && on.includes('n') ? 'x' : [...off].filter((l) => ATTRIBUTE_LETTERS.has(l)).join('');
    const local = this.frame && (builtin === 'local' || ((builtin === 'declare' || builtin === 'typeset') && !on.includes('g')));
    for (const o of operands) {
      const nameNode = o.type === 'variable_assignment' ? field(o, 'name') : o.type === 'variable_name' ? o : undefined;
      if (!nameNode || nameNode.type !== 'variable_name') continue;
      const name = nameNode.text;
      // A local variable starts afresh, hiding the one outside.
      if (local && !this.frame!.locals.has(name)) {
        this.frame!.locals.add(name);
        st = put(st, 'variables', name, { set: 'on', attrs: {}, at: n });
      }
      const prev = st.variables.get(name);
      const attrs: Record<string, Attribute> = { ...(prev?.attrs ?? {}) };
      for (const l of gives) attrs[l] = { state: 'on', at: n };
      for (const l of removes) attrs[l] = { state: 'off', at: n };
      // `declare -A m` on an indexed array is an error; `declare -a` on one stays as it is.
      st = put(st, 'variables', name, { set: 'on', attrs, value: prev?.value, at: n });
      if (o.type === 'variable_assignment') {
        this.runAt.set(o, st);
        st = this.assign(o, st, on.includes('n'));
      }
    }
    return this.defaults(n, st);
  }

  private unset(n: SyntaxNode, st: ShellState): ShellState {
    this.substitutions(n, st);
    const words = n.namedChildren.map((w) => ({ node: w, text: staticWordValue(w) ?? w.text }));
    const flags = words.filter((w) => /^-[fvn]+$/.test(w.text)).map((w) => w.text).join('');
    for (const { node, text } of words) {
      if (/^-/.test(text)) continue;
      if (flags.includes('f')) {
        const fn = st.functions.get(text);
        if (fn) st = put(st, 'functions', text, { ...fn, state: 'off' });
        continue;
      }
      // `unset 'a[1]'` removes an element.
      if (text.includes('[')) continue;
      // With no -v, a name with no variable is a function.
      const fn = st.functions.get(text);
      if (!flags.includes('v') && !st.variables.has(text) && fn && fn.state !== 'off') st = put(st, 'functions', text, { ...fn, state: 'off' });
      else st = put(st, 'variables', text, { set: 'off', attrs: {}, at: node });
    }
    return st;
  }

  /** `name=value`, `name+=value`, `name[i]=value`, `name=(…)`; `nameref`: the assignment of a `declare -n`. */
  private assign(a: SyntaxNode, st: ShellState, nameref = false): ShellState {
    const nameNode = field(a, 'name')!;
    const value = field(a, 'value');
    const append = a.children.some((c) => c.type === '+=');
    if (nameNode.type === 'subscript') {
      const name = field(nameNode, 'name')!.text;
      st = this.setVariable(st, name, a, undefined);
      return attribute(st, name, 'A') === 'off' ? this.giveAttribute(st, name, 'a', a) : st;
    }
    let name = nameNode.text;
    const prev = st.variables.get(name);
    // Assigning to a nameref assigns to the variable it names.
    if (!nameref && prev?.attrs.n?.state === 'on') {
      if (prev.value === undefined || !/^[A-Za-z_]\w*$/.test(prev.value)) return st;
      name = prev.value;
    }
    const target = st.variables.get(name);
    if (value?.type === 'array') {
      st = this.setVariable(st, name, a, undefined);
      return attribute(st, name, 'A') === 'off' ? this.giveAttribute(st, name, 'a', a) : st;
    }
    let text = value ? staticWordValue(value) : '';
    const is = (l: string): boolean => target?.attrs[l]?.state === 'on';
    if (is('a') || is('A')) text = undefined;
    else if (is('i') && text !== undefined) {
      const v = evalArith(text);
      const old = target?.value !== undefined ? evalArith(target.value) : append ? undefined : 0;
      text = v === undefined || old === undefined ? undefined : String(append ? old + v : v);
    } else if (append) text = target?.value !== undefined && text !== undefined ? target.value + text : undefined;
    if (text !== undefined && is('l')) text = text.toLowerCase();
    if (text !== undefined && is('u')) text = text.toUpperCase();
    return this.setVariable(st, name, a, text);
  }

  /** Sets `name` (to `value`, when known), exporting it under `set -a`. */
  private setVariable(st: ShellState, name: string, at: SyntaxNode, value: string | undefined): ShellState {
    const prev = st.variables.get(name);
    st = put(st, 'variables', name, { set: 'on', attrs: prev?.attrs ?? {}, value, at });
    const all = option(st, 'set', 'allexport');
    if (all === 'on' || (all === 'unknown' && prev?.attrs.x?.state !== 'on')) {
      const v = st.variables.get(name)!;
      st = put(st, 'variables', name, { ...v, attrs: { ...v.attrs, x: { state: all === 'on' ? 'on' : 'unknown', at } } });
    }
    return st;
  }

  private giveAttribute(st: ShellState, name: string, letter: string, at: SyntaxNode): ShellState {
    const v = st.variables.get(name)!;
    return put(st, 'variables', name, { ...v, attrs: { ...v.attrs, [letter]: { state: 'on', at } } });
  }

  private exportVariable(st: ShellState, name: string, at: SyntaxNode): ShellState {
    return this.giveAttribute(st, name, 'x', at);
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
  const model: StateModel = {
    end,
    definitions: { functions: w.functionDefs, aliases: w.aliasDefs },
    at(n) {
      let run: ShellState | undefined;
      let top = n;
      for (let x: SyntaxNode | null = n; x; x = x.parent) {
        run ??= w.runAt.get(x);
        if (x.parent) top = x;
      }
      return { run: run ?? initial, parse: w.parseAt.get(top) ?? initial };
    },
  };
  byKey.set(key, model);
  return model;
}
