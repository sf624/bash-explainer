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
import type { CommandSpec } from '../argv/spec';
import { BASH_ONLY_BUILTINS, builtins } from '../dict/builtins';
import { staticWordValue } from '../staticword';
import type { ArgvParse } from '../argv/interpret';
import { actedNames, actsOnNames } from '../argv/query';
import { field, fields, prefixAssignments, type SyntaxNode } from '../syntax/tree';
import { aliasExpandsNext, builtinParse, wordsAfterAlias, wrapped } from './effects';
import { type ExecEnv, reachOf, type SlotLink, subshellReasons } from './env';
import { type AliasState, type CommandEntry, type FunctionState, option, type ShellState, type StateModel, type Tri } from './state';
import { docIndex } from './state';

/** bash's reserved words: keywords where a command name may start (3.2, and `[[ ]]`). */
export const RESERVED = new Set(['!', '[[', ']]', '{', '}', 'case', 'coproc', 'do', 'done', 'elif', 'else', 'esac', 'fi', 'for', 'function', 'if', 'in',
  'select', 'then', 'time', 'until', 'while']);

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
    /** With `startup`: a `source` or `.` before it in that shell, whose file may define it too. */
    sourced?: SyntaxNode;
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
  /** Nothing runs: `builtin x` where `x` is not a builtin; `disabled`: the builtin `x` turned off by `enable -n`. */
  | { kind: 'none'; name: string; why: 'not-a-builtin'; missed?: Missed; disabled?: CommandEntry };

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
const pathPrefix = (c: SyntaxNode): boolean => c.type === 'command' && prefixAssignments(c).some((a) => field(a, 'name')!.text === 'PATH');

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

/** An alias that is expanded here (`NameResolution`). */
export type AliasResolution = Extract<NameResolution, { kind: 'alias' }>;

/**
 * The words after the name of the simple command `c` that bash reads as aliases (6.6): when the text of the alias the
 * name is (`first`) ends with a blank, the next word if it is an alias there (`resolve`: as a command name), and so on
 * while the text of the one found ends with a blank too. `alias s='sudo '`: `s ll` runs `sudo ls -l`. (Not after an
 * alias whose text is another alias ending so, `alias a=s`: bash 5.2 checks no word after `a`; 5.3 does.)
 */
export function aliasesAfter(c: SyntaxNode, first: AliasResolution, resolve: (name: string, at: SyntaxNode) => NameResolution): { word: SyntaxNode; res: AliasResolution }[] {
  const out: { word: SyntaxNode; res: AliasResolution }[] = [];
  let res = first;
  for (const word of wordsAfterAlias(c)) {
    if (!aliasExpandsNext(res.alias.value)) break;
    const next = resolve(word.text, word);
    if (next.kind !== 'alias') break;
    out.push({ word, res: next });
    res = next;
  }
  return out;
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
  const sourced = 'maybe' in maybe && maybe.maybe === 'startup' && place.sourced ? { sourced: place.sourced } : {};
  return { kind: 'function', name, fn: defined, sure, ...maybe, ...sourced, ...(shadows ? { shadows } : {}), ...(sure ? {} : { otherwise: builtin }), ...(missed ? { missed } : {}) };
}

/** The builtin or the file `name` runs, past aliases and functions. */
function builtinOrFile(name: string, opts: ResolveOptions, { exec, lookup, bash, st, sourced, pathPrefix }: Place, missed: Missed | undefined): NameResolution {
  const spec = name.includes('/') || exec || (!bash && BASH_ONLY_BUILTINS.has(name)) ? undefined : builtins[name];
  const disabled = spec ? st.disabled.get(name) : undefined;
  const m = missed ? { missed } : {};
  if (spec && disabled?.state !== 'on') return { kind: 'builtin', name, special: spec.builtin === 'special', ...m, ...(disabled?.state === 'unknown' ? { disabled } : {}) };
  const off = disabled ? { disabled } : {};
  if (lookup === 'builtins-only') return { kind: 'none', name, why: 'not-a-builtin', ...m, ...off };
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
   * command, exported (a special builtin in POSIX mode, or `export` or `readonly` of its name: `named`).
   */
  scope: 'shell' | 'command' | 'persists';
  /** The builtin that keeps it, in any mode, because it gets its name (`a=2 export a`: `export`; see `keptPrefixes`). */
  named?: string;
  /**
   * False when it depends on run time: `persists` when POSIX mode is on on some paths only; `command` when the
   * name is an expansion that may give no word, and so may every word after it (`x=1 $cmd`: then the assignment is
   * the shell's). A word after it that surely gives one is the command then (`x=1 $cmd env` runs `env` with `x`).
   */
  sure: boolean;
}

/**
 * The meaning of the assignments before the name of `command` (a `command` node), which runs `res`: undefined when
 * it has no name, `dynamic` when the name is known only at run time and may expand to nothing.
 */
export function assignmentsOf(model: StateModel, command: SyntaxNode, res: NameResolution | 'dynamic' | undefined): AssignmentMeaning[] {
  const assignments = prefixAssignments(command);
  const posix = option(model.at(command).run, 'set', 'posix');
  const stays = res !== 'dynamic' && res?.kind === 'builtin' && res.special && (posix === 'on' || posix === 'unknown');
  // (`x=1 unset x` removes that `x`: it does not stay.)
  const unset = res !== 'dynamic' && res?.kind === 'builtin' ? temporariesUnset(res.name, fields(command, 'argument'), command, model.shell) : undefined;
  // (A word of known text gives one word: `x=1 $cmd env`.)
  const named = res === 'dynamic' && fields(command, 'argument').some((w) => staticWordValue(w) !== undefined);
  const exported = res !== 'dynamic' && res?.kind === 'builtin' ? keptPrefixes(command, staticWordValue, model.shell) : undefined;
  return assignments.map((a) => {
    const name = (field(field(a, 'name')!, 'name') ?? field(a, 'name')!).text;
    if (exported?.names.get(name)) return { node: a, name, scope: 'persists', sure: true, named: exported.builtin };
    const kept = stays && !unset?.has(name);
    return { node: a, name, scope: !res ? 'shell' : kept ? 'persists' : 'command', sure: res === 'dynamic' ? named : !kept || posix === 'on' };
  });
}

/** The builtins that make a variable of a name they get: what they do to a prefix assignment of it (`keptPrefixes`). */
const DECLARING = new Set(['export', 'readonly', 'declare', 'typeset', 'local']);

/**
 * The prefix assignments of the command `n` that its builtin may keep in the shell (also behind `command` and
 * `builtin`), by name: bash's `export a` and `readonly a` act on the variable of the command, which then stays
 * (`a=2 export a` leaves `a` set to 2, exported; `a=2 b=3 export a` keeps only `a`): `true`. Named with an option,
 * after a word not known (`text` gives none), or by `declare`, `typeset` or `local` (which make a variable of their
 * own in a function, and give `a=7` to the variable of the command): `false`, it may stay or not. With the name of
 * the builtin.
 */
export function keptPrefixes(n: SyntaxNode, text: (w: SyntaxNode) => string | undefined, shell: Shell | undefined): { builtin?: string; names: Map<string, boolean> } {
  let name = field(n, 'name')?.text;
  let args = fields(n, 'argument');
  const out = new Map<string, boolean>();
  while (name === 'command' || name === 'builtin') {
    const inner = wrapped(name, args, shell);
    if ('lookup' in inner) return { names: out };
    ({ name, args } = inner);
  }
  const names = new Set(prefixAssignments(n).filter((a) => field(a, 'name')!.type !== 'subscript').map((a) => field(a, 'name')!.text));
  if (!name || !DECLARING.has(name) || !names.size) return { names: out };
  let exact = name === 'export' || name === 'readonly';
  let ended = false;
  for (const arg of args) {
    const t = arg.type === 'variable_assignment' ? arg.text : text(arg);
    if (t === undefined) {
      for (const v of names) out.set(v, false);
      break;
    }
    if (!ended && /^[-+]/.test(t)) {
      ended = t === '--';
      exact &&= ended;
      continue;
    }
    ended = true;
    // (`a=2 export a=7` gives `a` 7, the builtin's own assignment.)
    const v = /^[A-Za-z_]\w*/.exec(t)?.[0];
    if (v && names.has(v) && (v === t || !exact)) out.set(v, exact);
  }
  if (!exact) for (const [v] of out) out.set(v, false);
  return { builtin: name, names: out };
}

/**
 * The variables that the builtin `name` with the words `words` (read as `parse`, when given) unsets among the
 * temporary ones that the assignments before the command `n` make (`x=1 unset x`), by its operands that unset names
 * (`OperandSpec.acts`): bash removes that `x`, and the one from before stays, in POSIX mode too.
 */
export function temporariesUnset(name: string, words: readonly SyntaxNode[], n: SyntaxNode, shell: Shell | undefined, parse?: ArgvParse): Set<string> {
  const prefix = new Set(prefixAssignments(n).map((a) => field(a, 'name')!.text));
  if (!prefix.size || !(builtins[name] && actsOnNames(builtins[name], 'unsets'))) return new Set();
  const ws = words.filter((w) => !w.type.endsWith('redirect'));
  const names = actedNames(parse ?? builtinParse(name, ws, shell)).filter((o) => o.acts === 'unsets' && o.space !== 'function' && o.space !== 'none');
  return new Set(names.map(({ word }) => staticWordValue(ws[word])).filter((v): v is string => v !== undefined && prefix.has(v)));
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

/**
 * The spec of `test` when `name` runs it (the builtin, or with `program` the coreutils program): `test` and `[`,
 * which read their words as a conditional expression (src/testexpr.ts); `[` wants a last `]` (`closingOperand`).
 * A path runs the program of its last part (`/usr/bin/[`).
 */
export function testSpec(name: string, program: boolean): CommandSpec | undefined {
  const base = name.slice(name.lastIndexOf('/') + 1);
  const builtin = Object.hasOwn(builtins, base) ? builtins[base] : undefined;
  const spec = program || base !== name ? builtin?.program : builtin;
  return spec?.operandParser === 'test-expression' ? spec : undefined;
}

/**
 * Whether what a command name runs (`res`) is `test` or `[`, and its spec: the builtin, or the program (after
 * `enable -n`, through `env`, by its path). A function or an alias of that name is a plain call: undefined.
 * This is the one place that decides it from the model; the analyzer, the status model and the facts ask it.
 */
export function testSpecOf(res: NameResolution): CommandSpec | undefined {
  if (res.kind === 'builtin') return testSpec(res.name, false);
  if (res.kind === 'file') return testSpec(res.path === 'hashed' ? res.hashed!.value : res.name, true);
  return undefined;
}

/** `testSpecOf` for the simple command `n` (a `command` node) where it is; undefined when its name is not known here. */
export function testSpecAt(model: StateModel, n: SyntaxNode, shell?: Shell): CommandSpec | undefined {
  const nameNode = field(n, 'name');
  const word = nameNode?.namedChildren[0];
  const name = word && staticWordValue(word);
  if (name === undefined) return undefined;
  return testSpecOf(resolveName(model, name, nameNode!, { shell, command: true, quoted: word!.type !== 'word' || word!.text !== name }));
}

/** What a command name is, as the panel's badge says it (docs/design/name-kind.md): a `file` is a program. */
export type NameKind = 'keyword' | 'alias' | 'function' | 'builtin' | 'program' | 'none';

/** Another meaning of the same name, and the code that runs it in place of this one. */
export interface NameOther {
  kind: NameKind;
  /**
   * Code that runs it (`command time`, `builtin echo`): what the bare name runs first decides it. None for a reserved
   * word, which is one where it starts a command unquoted, a builtin turned off, and an alias that is not expanded.
   */
  reach: string[];
  /** A builtin turned off by `enable -n` here: `enable NAME` turns it on again. */
  off?: boolean;
  /** An alias that bash does not expand here: a bash script without `shopt -s expand_aliases`. */
  unexpanded?: boolean;
  /** A program's usual path, from the dictionary (the model does not know the file system): absent, one in PATH. */
  path?: string;
}

/** What a command name runs here, who looks it up, and what else the same name is (`nameFacts`). */
export interface NameFacts {
  /** The name as bash looks it up (quotes removed). */
  name: string;
  runs: NameKind;
  /**
   * The command that looks the name up in place of bash's usual order: a program (`sudo`, `xargs`, `env`), or
   * `command` and `builtin` when they find no builtin (`command ls`, `builtin ls`). A builtin they find runs in this
   * shell, as bash runs it: no `by` (`builtin cd`).
   */
  by?: string;
  /**
   * `runs` `none`: why nothing runs. `not-a-builtin`: `builtin` finds no builtin of the name. `not-found`: a reserved
   * word looked up as a command (`command [[`, `\if`), which no program is named (bash: "command not found").
   */
  why?: 'not-a-builtin' | 'not-found';
  /** A program runs where bash has a builtin of the name, and the dictionary knows no program of it (`sudo cd`). */
  noProgram?: boolean;
  /** The other meanings of the name, in bash's order (3.7.2): empty when it has none. */
  also: NameOther[];
  /** It runs a POSIX special builtin (4.4): in POSIX mode, it differs from the other builtins. */
  special?: true;
}

/** What the name `NAME` resolves to written in place of the command name, plain or as `\NAME` or `command NAME` (`nameFacts`). */
export type NameLookup = (opts: Pick<ResolveOptions, 'quoted' | 'command' | 'lookup'>) => NameResolution;

/**
 * What the command name of `res` is (3.7.2): what runs, who looks it up (the slot of `env` that runs it), and the
 * other meanings of the same name, with code that reaches each. That code is read from what the name resolves to
 * where it is (`lookup`), bare (`NAME`), quoted (`\NAME`: no alias, no reserved word) and with `command` (no
 * function either); without `lookup`, from a script that defines nothing. A program of the name comes from the
 * dictionary (`program`, and the program a builtin's entry describes), never from the file system; `path` gives
 * its usual path, when the dictionary has one. A path names no other meaning.
 */
export function nameFacts(res: NameResolution, opts: {
  program?: (name: string) => boolean; path?: (name: string) => string | undefined; env?: ExecEnv; shell?: Shell; lookup?: NameLookup;
} = {}): NameFacts {
  const last = opts.env?.links[opts.env.links.length - 1];
  const slot = last?.kind === 'slot' && (last.slot.run === 'exec' || last.slot.lookup) ? last : undefined;
  // (`builtin cd`, `command echo`: the builtin runs in this shell, as bash would run it: no other command runs it.)
  const by = slot && !(slot.slot.run === 'current-shell' && res.kind === 'builtin') ? { by: slot.via } : {};
  const { name } = res;
  const bash = !opts.shell || opts.shell === 'bash' || !BASH_ONLY_BUILTINS.has(name);
  const builtin = Object.hasOwn(builtins, name) && bash ? builtins[name] : undefined;
  const program = !!builtin?.program || !!opts.program?.(name);
  // (A reserved word looked up as a file: no program has its name, `command [[` is "command not found".)
  const notFound = res.kind === 'file' && res.path === 'search' && RESERVED.has(name) && !program;
  const runs: NameKind = notFound ? 'none' : res.kind === 'file' ? 'program' : res.kind;
  const why = notFound ? { why: 'not-found' as const } : res.kind === 'none' ? { why: res.why } : {};
  const noProgram = runs === 'program' && builtin && !program && !name.includes('/') ? { noProgram: true } : {};
  if (name.includes('/')) return { name, runs, ...by, also: [] };
  // (`builtins-only` is asked only of a name that has a builtin.)
  const look: NameLookup = opts.lookup ?? ((o) => (!o.quoted && !o.command && RESERVED.has(name) ? { kind: 'keyword', name }
    : builtin ? { kind: 'builtin', name, special: builtin.builtin === 'special' } : { kind: 'file', name, path: 'search', known: program }));
  const bare = look({});
  const quoted = look({ quoted: true });
  const command = look({ command: true, lookup: 'no-functions' });
  const also: NameOther[] = [];
  const add = (o: NameOther): void => void (o.kind !== runs && also.push(o));
  if (RESERVED.has(name)) add({ kind: 'keyword', reach: [] });
  const aliasMissed = (bare as { missed?: Missed }).missed;
  if (bare.kind === 'alias') add({ kind: 'alias', reach: [name] });
  else if (aliasMissed?.kind === 'alias' && aliasMissed.why === 'expand_aliases') add({ kind: 'alias', reach: [], unexpanded: true });
  // (A keyword or an alias before it: quoted, the name skips both.)
  if (bare.kind === 'function') add({ kind: 'function', reach: [name] });
  else if (quoted.kind === 'function') add({ kind: 'function', reach: [`\\${name}`] });
  if (builtin) {
    const off = look({ command: true, lookup: 'builtins-only' }).kind === 'none';
    add(off ? { kind: 'builtin', reach: [], off: true } : {
      kind: 'builtin', reach: bare.kind === 'builtin' ? [name] : quoted.kind === 'builtin' ? [`\\${name}`, `command ${name}`] : [`builtin ${name}`, `command ${name}`],
    });
  }
  // (Where a builtin of the name is on, `command` and a quoted name find it first: only `env` starts the program.)
  if (program) {
    const reach = bare.kind === 'file' ? [name] : [...(quoted.kind === 'file' ? [`\\${name}`] : []), ...(command.kind === 'file' ? [`command ${name}`] : [])];
    const path = opts.path?.(name);
    add({ kind: 'program', reach: reach.length ? reach : [`env ${name}`], ...(path ? { path } : {}) });
  }
  return { name, runs, ...by, ...why, ...noProgram, also, ...(res.kind === 'builtin' && res.special ? { special: true as const } : {}) };
}
