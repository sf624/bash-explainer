// What a command name runs (docs/design/semantics.md, 4.3 and step B3; the Bash manual, 3.7.2 and 6.11), and what
// the assignments before it do (3.7.1, 3.7.4).
//
// bash looks a name up in this order: a reserved word (only the first word, unquoted: the parser decides), an
// alias (unquoted, when aliases are expanded where the line was read), a special builtin in POSIX mode, a
// function, a builtin (unless `enable -n` turned it off), a path remembered by `hash -p`, and a file found in
// PATH. A name with a `/` is a path and is not searched. `command` skips aliases and functions, `builtin` looks
// at the builtins only. A command run by another program (`sudo f`, `xargs f`) is a file; a string run by
// another shell (`bash -c f`) sees the functions exported to it, when that shell reads them (dash does not).
//
// The model reads the shell state of src/semantics/state.ts at the place of the name, and the environment of
// src/semantics/env.ts. It does not know the file system: a name that is none of the others is a file to search.
import type { Shell } from '../dialect';
import { BASH_ONLY_BUILTINS, builtins } from '../dict/builtins';
import { field, type SyntaxNode } from '../syntax/tree';
import { type ExecEnv, reachOf, type SlotLink, subshellReasons } from './env';
import { type AliasState, type CommandEntry, type FunctionState, option, type ShellState, type StateModel, type Tri } from './state';
import { docIndex } from './state';

/** bash's reserved words: keywords where a command name may start (3.2, and `[[ ]]`). */
export const RESERVED = new Set(['!', '[[', ']]', '{', '}', 'case', 'coproc', 'do', 'done', 'elif', 'else', 'esac', 'fi', 'for', 'function', 'if', 'in',
  'select', 'then', 'time', 'until', 'while']);

/** `[` is the builtin `test`, written with a closing `]`. */
const SAME_AS: Record<string, string> = { '[': 'test' };

/** Why a definition of the name does not apply where it is used. */
export type MissReason =
  | 'later'            // defined after this runs (a function), or read after it (an alias)
  | 'same-unit'        // an alias defined on the line, or in the compound command, that holds this
  | 'subshell'         // defined in a subshell, which has ended
  | 'in-function'      // defined by a function that has not run before this
  | 'never-runs'       // defined in code that never runs: a branch decided against it, or after a jump (docs/design/semantics.md, 4.14)
  | 'unset'            // removed by `unset -f` (or `unalias`)
  | 'expand_aliases'   // aliases are not expanded in a bash script without `shopt -s expand_aliases`
  | 'quoted'           // a quoted or escaped name is not an alias (`\\ls`, `"ls"`)
  | 'command'          // `command` skips functions and aliases
  | 'builtin'          // `builtin` looks at the builtins only
  | 'posix-special'    // a special builtin comes before a function in POSIX mode
  | 'program'          // run by another program (`sudo`, `xargs`), which has no shell functions
  | 'not-exported'     // another shell gets only the exported functions (`export -f`)
  | 'not-passed'       // a link on the way passes no functions (`env -i`, sudo, a container)
  | 'not-imported';    // the other shell does not read exported functions (dash; `sh` may be dash)

/** A definition of the name, a function or an alias, that does not run here. */
export interface Missed {
  kind: 'function' | 'alias';
  /** The definition (a `function_definition`, or the `alias` command). */
  def: SyntaxNode;
  why: MissReason;
  /** `unset`: the `unset -f`; `subshell`, `in-function`: the subshell or the function that holds the definition. */
  by?: SyntaxNode;
  /** `not-passed`, `not-imported`, `program`: the slot that runs the command. */
  slot?: SlotLink;
}

/** What a command name runs, in bash's order (3.7.2). */
export type NameResolution =
  | { kind: 'keyword'; name: string }
  /**
   * An alias that is expanded here: `sure` when it is defined, and aliases expanded, on every path; otherwise
   * `otherwise` is what runs when it is not. `target` is what the first word of its text runs (`alias a=b`, `alias
   * b='echo B'`: the alias `b`, then the builtin `echo`), when that word is plain text.
   */
  | { kind: 'alias'; name: string; alias: AliasState; sure: boolean; target?: NameResolution; otherwise?: NameResolution }
  /**
   * A function defined here: `sure` when it is on every path (else `otherwise` runs on the others). `shadows`: the
   * builtin or the program of the same name that it hides.
   */
  | {
    kind: 'function'; name: string; fn: FunctionState; sure: boolean; shadows?: 'builtin' | 'program'; otherwise?: NameResolution; missed?: Missed;
    /**
     * Not sure because a definition before here is on some paths only (`branch`), or comes after it in the text, in a
     * body that runs later (`later`); in another shell, because `sh` may be dash, which reads no exported function
     * (`import`), or because only its startup files would define it (`startup`: `bash -l`, BASH_ENV).
     */
    maybe?: 'branch' | 'later' | 'import' | 'startup';
  }
  /** A builtin; `special` for the POSIX special builtins. `disabled`: `enable -n` on some paths only. */
  | { kind: 'builtin'; name: string; special: boolean; missed?: Missed; disabled?: CommandEntry }
  /**
   * A file: searched in PATH (`known` when the dictionary describes a program of that name), given as a path, or
   * remembered by `hash -p` (`hashed`). `disabled`: the builtin of that name turned off by `enable -n`.
   */
  | {
    kind: 'file'; name: string; path: 'search' | 'given' | 'hashed'; known: boolean; hashed?: CommandEntry; disabled?: CommandEntry; missed?: Missed;
    /** A name the dictionary does not know, after a `source` or `.` (this command): it may be a function of the file read. */
    sourced?: SyntaxNode;
  }
  /** Nothing runs: `builtin x` where `x` is not a builtin. */
  | { kind: 'none'; name: string; why: 'not-a-builtin'; missed?: Missed };

export interface ResolveOptions {
  /** The script's shell (bash when absent). */
  shell?: Shell;
  /** The name is quoted or escaped (`\ls`, `"ls"`): no alias, no reserved word. */
  quoted?: boolean;
  /** The parser has read it as a command name already: it is not a reserved word. */
  command?: boolean;
  /** `command` (no functions, no aliases) or `builtin` (builtins only). */
  lookup?: 'no-functions' | 'builtins-only';
  /** Where it runs, when another command runs it (`bash -c f`, `sudo f`): the chain of src/semantics/env.ts. */
  env?: ExecEnv;
  /** Whether the dictionary describes a program of this name. */
  program?: (name: string) => boolean;
}

// (Nodes of strings read as scripts are compared by where they are in the document: docIndex.)
const contains = (a: SyntaxNode, b: SyntaxNode): boolean => docIndex(a) <= docIndex(b) && docIndex(b, true) <= docIndex(a, true);
const before = (a: SyntaxNode, b: SyntaxNode): boolean => docIndex(a, true) <= docIndex(b);

/**
 * Why the function `name` the script defines somewhere is not defined at `at` (`fn`: its state there, absent or
 * off), or undefined when the script has no definition of it that could have run before.
 */
function missedFunction(model: StateModel, name: string, at: SyntaxNode, fn: FunctionState | undefined): Missed | undefined {
  if (fn?.removed) return { kind: 'function', def: fn.def, why: 'unset', by: fn.removed };
  const defs = model.definitions.functions.get(name);
  if (!defs) return undefined;
  const earlier = defs.filter((d) => before(d, at));
  if (!earlier.length) return { kind: 'function', def: defs[0], why: 'later' };
  const def = earlier[earlier.length - 1];
  for (let x: SyntaxNode | null = def; x && !contains(x, at); x = x.parent) {
    if (subshellReasons(x).length) return { kind: 'function', def, why: 'subshell', by: x };
    if (x !== def && x.type === 'function_definition') return { kind: 'function', def, why: 'in-function', by: x };
  }
  if (model.dead(def)) return { kind: 'function', def, why: 'never-runs' };
  /* c8 ignore next 2 -- a definition that ran before, in this shell, is in the state (on, unknown, or removed) */
  return undefined;
}

/** Why the alias `name` the script defines somewhere does not apply at `at`, or undefined. */
function missedAlias(model: StateModel, name: string, at: SyntaxNode, alias: AliasState | undefined, unit: number): Missed | undefined {
  if (alias && alias.state === 'off') return { kind: 'alias', def: alias.at, why: 'unset' };
  const defs = model.definitions.aliases.get(name);
  if (!defs || alias) return undefined;
  if (defs.every((d) => docIndex(d, true) > unit)) return { kind: 'alias', def: defs[0], why: docIndex(defs[0]) < docIndex(at) ? 'same-unit' : 'later' };
  return undefined;
}

/** A `source` or `.` that may have run before `at`: before it in the text, or anywhere when `at` is in a function body. */
function sourcedBefore(model: StateModel, at: SyntaxNode): { sourced?: SyntaxNode } {
  let body = false;
  for (let x = at.parent; x; x = x.parent) if (x.type === 'function_definition') body = true;
  const s = model.sources.find((c) => body || docIndex(c) < docIndex(at));
  return s ? { sourced: s } : {};
}

/** `PATH=… cmd`: an assignment to PATH before the name of the command `c`. */
const pathPrefix = (c: SyntaxNode): boolean => c.type === 'command' && c.namedChildren.some((a) => a.type === 'variable_assignment' && field(a, 'name')!.text === 'PATH');

/** How a shell run through a slot takes the functions exported to it: bash does, the others (dash, zsh, ksh…) do not; `sh` may be dash. */
function imports(shell: SlotLink['shell']): Tri {
  return shell === 'sh' ? 'unknown' : shell === 'bash' || shell === 'unknown' ? 'on' : 'off';
}

/** Where a name is looked up: the slot that runs it, if any, and what that allows. */
interface Place {
  /** The innermost slot of `opts.env`. */
  slot?: SlotLink;
  /** A program started by a slot (`sudo f`): it runs a file, with no alias, function or builtin. */
  exec: boolean;
  /** Another shell (`bash -c f`): none of this script's aliases, and only the functions it is given. */
  shellString: boolean;
  lookup?: 'no-functions' | 'builtins-only';
  /** The shell that looks it up has bash's builtins. */
  bash: boolean;
  st: ShellState;
  /** A `source` that may have run before (its file may define functions). */
  sourced?: SyntaxNode;
  /** `PATH=… cmd`: the command is looked up with that PATH, and the paths of `hash -p` are forgotten. */
  pathPrefix: boolean;
}

/**
 * What the command name `name` runs at `at` (a command, or a word of one), from the state there (src/semantics/
 * state.ts) and where it runs (`opts.env`).
 */
export function resolveName(model: StateModel, name: string, at: SyntaxNode, opts: ResolveOptions = {}): NameResolution {
  const slot = opts.env?.links.filter((l): l is SlotLink => l.kind === 'slot').pop();
  const shellString = slot?.slot.run === 'shell-string';
  const place: Place = {
    ...(slot ? { slot } : {}),
    exec: slot?.slot.run === 'exec',
    shellString,
    lookup: opts.lookup ?? (slot?.slot.run === 'current-shell' ? slot.slot.lookup : undefined),
    bash: shellString ? slot!.shell === 'bash' || slot!.shell === 'unknown' : !opts.shell || opts.shell === 'bash',
    st: model.at(at).run,
    ...sourcedBefore(model, at),
    pathPrefix: pathPrefix(at.type === 'command_name' ? at.parent! : at),
  };
  return resolve(model, name, at, opts, place, new Set());
}

function resolve(model: StateModel, name: string, at: SyntaxNode, opts: ResolveOptions, place: Place, expanding: Set<string>): NameResolution {
  const { slot, exec, shellString, lookup, st } = place;
  if (!opts.quoted && !opts.command && !exec && RESERVED.has(name)) return { kind: 'keyword', name };
  let missed: Missed | undefined;

  // Aliases: from the state when the line was read; bash expands them in a script only with expand_aliases.
  if (!lookup && !exec && !shellString && !expanding.has(name)) {
    const parse = model.at(at).expand;
    const alias = parse.aliases.get(name);
    const option_ = option(parse, 'shopt', 'expand_aliases');
    const expands: Tri = !opts.shell || opts.shell === 'bash' ? (option_ === 'on' || option_ === 'unknown' ? option_ : 'off') : 'on';
    // (A quoted name is not an alias: `\ls` runs `ls` itself.)
    if (opts.quoted) {
      if (alias && alias.state !== 'off' && expands !== 'off') missed = { kind: 'alias', def: alias.at, why: 'quoted' };
    } else if (alias && alias.state !== 'off' && expands !== 'off') {
      const inner = new Set([...expanding, name]);
      const sure = alias.state === 'on' && expands === 'on';
      // (An alias whose text starts with an assignment, a quote or an expansion has no plain first word.)
      const first = /^\s*([^\s;|&<>()'"`$\\=]+)(?=$|[\s;|&<>()])/.exec(alias.value)?.[1];
      const target = first !== undefined ? resolve(model, first, at, opts, place, inner) : undefined;
      return { kind: 'alias', name, alias, sure, ...(target ? { target } : {}), ...(sure ? {} : { otherwise: resolve(model, name, at, opts, place, inner) }) };
    }
    else missed = alias && alias.state !== 'off' ? { kind: 'alias', def: alias.at, why: 'expand_aliases' } : missedAlias(model, name, at, alias, docIndex(model.unit(at)));
  }

  // Functions: not for `command` and `builtin`, nor in a program; in another shell, only those it gets.
  const fn = st.functions.get(name);
  const defined = fn && fn.state !== 'off' ? fn : undefined;
  if (!defined) {
    const why = missedFunction(model, name, at, fn);
    // (After a `source`, a function defined later in the script may come from the file read.)
    if (why && !(why.why === 'later' && place.sourced)) missed ??= why;
    return builtinOrFile(name, opts, place, missed);
  }
  const miss = (why: MissReason, by?: SlotLink): NameResolution => builtinOrFile(name, opts, place, { kind: 'function', def: defined.def, why, ...(by ? { slot: by } : {}) });
  if (exec) return miss('program', slot);
  if (lookup) return miss(lookup === 'builtins-only' ? 'builtin' : 'command');
  let sure = defined.state === 'on';
  if (shellString) {
    // Another shell has the functions exported to it, if every link passes them and it reads them.
    const reach = reachOf(opts.env!);
    const imported = imports(slot!.shell);
    if (reach.functions === 'none') return miss('not-passed', reach.blocker);
    if (defined.exported === 'off') return miss('not-exported', slot);
    if (imported === 'off') return miss('not-imported', slot);
    sure &&= defined.exported === 'on' && imported === 'on';
    // (`sh` may be dash.)
    if (imported === 'unknown') missed = { kind: 'function', def: defined.def, why: 'not-imported', slot: slot! };
  }
  // POSIX mode: a special builtin is found before a function.
  const builtin = builtinOrFile(name, opts, place, undefined);
  const special = builtin.kind === 'builtin' && builtin.special ? option(st, 'set', 'posix') : 'off';
  if (special === 'on') return miss('posix-special');
  if (special === 'unknown') sure = false;
  const shadows = builtin.kind === 'builtin' ? 'builtin' as const : opts.program?.(name) ? 'program' as const : undefined;
  // (Not sure: defined on some paths before here, or only after it in the text, in a body that runs later.)
  // (In another shell, a function of the script that `sh` may not read, or that only its startup files would define.)
  const maybe = sure ? {} : { maybe: defined.imported === 'sh' ? 'import' as const : defined.imported ? 'startup' as const
    : model.definitions.functions.get(name)!.some((d) => before(d, at)) ? 'branch' as const : 'later' as const };
  return { kind: 'function', name, fn: defined, sure, ...maybe, ...(shadows ? { shadows } : {}), ...(sure ? {} : { otherwise: builtin }), ...(missed ? { missed } : {}) };
}

/** The builtin or the file `name` runs, past aliases and functions. */
function builtinOrFile(name: string, opts: ResolveOptions, { exec, lookup, bash, st, sourced, pathPrefix }: Place, missed: Missed | undefined): NameResolution {
  const spec = name.includes('/') || exec || (!bash && BASH_ONLY_BUILTINS.has(name)) ? undefined : builtins[SAME_AS[name] ?? name];
  const disabled = spec ? st.disabled.get(name) : undefined;
  const m = missed ? { missed } : {};
  if (spec && disabled?.state !== 'on') return { kind: 'builtin', name, special: spec.builtin === 'special', ...m, ...(disabled?.state === 'unknown' ? { disabled } : {}) };
  if (lookup === 'builtins-only') return { kind: 'none', name, why: 'not-a-builtin', ...m };
  const off = disabled ? { disabled } : {};
  if (name.includes('/')) return { kind: 'file', name, path: 'given', known: !!opts.program?.(name), ...m };
  const hashed = exec || pathPrefix ? undefined : st.hashed.get(name);
  if (hashed && hashed.state === 'on') return { kind: 'file', name, path: 'hashed', known: !!opts.program?.(hashed.value), hashed, ...off, ...m };
  // (A builtin turned off runs the program of its name, which the dictionary describes with it.)
  const known = !!opts.program?.(name) || !!spec?.program;
  return { kind: 'file', name, path: 'search', known, ...off, ...m, ...(sourced && !known && !missed && !exec && !opts.env ? { sourced } : {}) };
}

/** What an assignment before a command name does (3.7.1, 3.7.4, 6.11). */
export interface AssignmentMeaning {
  node: SyntaxNode;
  name: string;
  /**
   * `shell`: there is no command, so it sets a shell variable. `command`: the command gets it in its environment,
   * and it is gone after (also for a function, and in POSIX mode: bash 5.2). `persists`: it stays after the
   * command, exported (a special builtin in POSIX mode).
   */
  scope: 'shell' | 'command' | 'persists';
  /**
   * False when it depends on run time: `persists` when POSIX mode is on on some paths only; `command` when the
   * name is an expansion that may give no word (`x=1 $cmd`: then the assignment is the shell's).
   */
  sure: boolean;
}

/**
 * The meaning of the assignments before the name of `command` (a `command` node), which runs `res`: undefined when
 * it has no name, `dynamic` when the name is known only at run time and may expand to nothing.
 */
export function assignmentsOf(model: StateModel, command: SyntaxNode, res: NameResolution | 'dynamic' | undefined): AssignmentMeaning[] {
  const name = field(command, 'name');
  const assignments = command.namedChildren.filter((c) => c.type === 'variable_assignment' && (!name || c.startIndex < name.startIndex));
  const posix = option(model.at(command).run, 'set', 'posix');
  const stays = res !== 'dynamic' && res?.kind === 'builtin' && res.special && (posix === 'on' || posix === 'unknown');
  return assignments.map((a) => ({
    node: a,
    name: (field(field(a, 'name')!, 'name') ?? field(a, 'name')!).text,
    scope: !res ? 'shell' : stays ? 'persists' : 'command',
    sure: res === 'dynamic' ? false : !stays || posix === 'on',
  }));
}

/**
 * Whether the function definition `def` fails because POSIX mode is on and its name is a special builtin's
 * (bash says "is a special builtin" and stops the script; dash, "Bad function name"): `unknown` when POSIX
 * mode is on on some paths only.
 */
export function definitionFails(model: StateModel, def: SyntaxNode): Tri {
  if (builtins[field(def, 'name')!.text]?.builtin !== 'special') return 'off';
  const posix = option(model.at(def).run, 'set', 'posix');
  return posix === 'on' || posix === 'unknown' ? posix : 'off';
}
