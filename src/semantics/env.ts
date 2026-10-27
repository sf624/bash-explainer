// Execution environments (docs/design/semantics.md, 4.3 and step B2; manual 3.7.3): which process runs each
// node, as a chain of links from the outermost to the innermost.
//
// - A subshell link comes from the node's place in the tree: `( )`, `$( )` and backquotes, `<( )` and `>( )`, a
//   statement followed by `&`, a coproc's command, and every stage of a pipeline but the last one. The last stage
//   is a subshell unless lastpipe is on and job control off, which the shell state where the pipeline runs says
//   (`sure: false` when only some paths turn lastpipe on). The walk of the state (src/semantics/walk/) drops the changes
//   of the same subshells, with the same rules (`subshellReasons`, `lastStageInShell`).
// - A function body runs where the function is called (the walk records the calls): its chain starts with a
//   `call` link that holds the chains of its calls. A function no call reaches runs where it is defined.
// - A slot link comes from a command slot (src/argv/spec.ts) that runs a command: a program (`sudo cmd`, `xargs
//   cmd`), another shell (`bash -c`, `su -c`, `ssh host cmd`), the current shell again (`eval`, `command`) or a
//   subshell of it (bats `run`).
// - A host link: a function the host calls once the script has run, bats' tests and hooks, in a process of its own
//   (src/semantics/walk/host.ts): a bash that has read the whole script, like the script's own shell.
//   What reaches the command is what every link on the way passes on (`env -i bash -c f`: no function).
import type { ArgRole, ArgvParse, ArgWord, CommandRole, RoleAt, ValueRole } from '../argv/interpret';
import { interpret } from '../argv/interpret';
import type { BuiltinCall, CommandSlot, CommandSpec } from '../argv/spec';
import { argWordFor } from '../argv/words';
import { shellFromName } from '../dialect';
import type { Shell } from '../dialect';
import { field, isShebang, substitutionForm, type SyntaxNode } from '../syntax/tree';
import { staticWordValue } from '../staticword';
import type { HostId } from '../hosts';
import type { ShellState, Tri } from './state';
import type { HostCall } from './walk/host';

/** Why a node runs in a subshell. */
export type SubshellReason = 'parentheses' | 'command-substitution' | 'process-substitution' | 'background' | 'coproc' | 'pipeline-stage';

/** A subshell that starts at `at`; `sure: false` when it does on some paths only (lastpipe, or some of a function's calls). */
export interface SubshellLink { readonly kind: 'subshell'; readonly why: SubshellReason; readonly at: SyntaxNode; readonly sure: boolean }
/** The shell a `shell-string` slot starts, from the program's name (`unknown`: `su -c`, ssh, a path or a name not known). */
export type ShellKind = Shell | 'unknown';

/**
 * A command run through a command slot: `at` is its first word (or the shell string); `via` names the slot (`bash -c`,
 * `sudo`); `assigns`, the variables the slot's command sets for it (`env x=1 cmd`, `docker run -e x`; `*` for a
 * file of them); `unsets`, those it removes (`env -u x cmd`); `env`, what reaches it (the slot's, or the one its options
 * give); `shell`, the shell a string runs in, and `invocation`, the options that shell is started with (`bash -e -O
 * extglob -c`), as written: each flag (`-e`, `+O`), with its value (`extglob`, undefined when not known here).
 */
export interface SlotLink {
  readonly kind: 'slot'; readonly slot: CommandSlot; readonly via: string; readonly at: SyntaxNode; readonly assigns: readonly string[];
  readonly unsets?: readonly string[];
  readonly env: NonNullable<CommandSlot['env']>; readonly shell?: ShellKind;
  readonly invocation?: readonly { readonly flag: string; readonly value?: string }[];
}
/** A place a function is called from: the command, where it runs, and whether the function is surely defined there. */
export interface CallSite { readonly at: SyntaxNode; readonly env: ExecEnv; readonly sure: boolean }
/**
 * A function body, which runs where the function is called: at any of `sites`. `unsure`: it may also be called from
 * where the model does not see (`WalkFacts.closed`: exported, named as an argument, `bash -c f`, in a trap's action),
 * or it is never called (then the links before this one are where it is defined).
 */
export interface CallLink { readonly kind: 'call'; readonly def: SyntaxNode; readonly sites: readonly CallSite[]; readonly unsure: boolean }
/** A function body the host calls (and nothing else does), in a process of its own: bats' tests and hooks. */
export interface HostLink { readonly kind: 'host'; readonly def: SyntaxNode; readonly call: HostCall }
export type EnvLink = SubshellLink | SlotLink | CallLink | HostLink;

/** Where a node runs: the links from the main shell to it, outermost first (none: the main shell). */
export interface ExecEnv { readonly links: readonly EnvLink[] }

export const MAIN_SHELL: ExecEnv = { links: [] };

/** Statements: what a list of commands is made of. */
export const STATEMENTS = new Set(['command', 'negated_command',
  'redirected_statement', 'pipeline', 'list', 'time_statement', 'coproc_statement', 'compound_statement', 'subshell', 'if_statement', 'case_statement',
  'for_statement', 'select_statement', 'c_style_for_statement', 'while_statement', 'function_definition', 'arithmetic_command', 'extended_test']);

/** The statements of each node followed by `&` (found once per node). */
const backgrounds = new WeakMap<SyntaxNode, Set<SyntaxNode>>();
function backgrounded(p: SyntaxNode): Set<SyntaxNode> {
  let set = backgrounds.get(p);
  if (!set) {
    set = new Set();
    const kids = p.children;
    for (let i = 0; i + 1 < kids.length; i++) if (kids[i + 1].type === '&' && STATEMENTS.has(kids[i].type)) set.add(kids[i]);
    backgrounds.set(p, set);
  }
  return set;
}

/** The last stage of a pipeline. */
export function lastStage(p: SyntaxNode): SyntaxNode {
  const stages = p.namedChildren.filter((c) => STATEMENTS.has(c.type));
  return stages[stages.length - 1];
}

/**
 * Why `n` runs in a subshell, by its place in the tree, outermost first (`( a ) &`: background, then
 * parentheses). The last stage of a pipeline is not here: it depends on the state (`lastStageInShell`). A
 * `${ …; }` is no subshell (docs/design/bash-versions.md, 4.1).
 */
export function subshellReasons(n: SyntaxNode): SubshellReason[] {
  const out: SubshellReason[] = [];
  const p = n.parent;
  if (p && STATEMENTS.has(n.type)) {
    if (backgrounded(p).has(n)) out.push('background');
    if (p.type === 'pipeline' && n !== lastStage(p)) out.push('pipeline-stage');
    if (p.type === 'coproc_statement') out.push('coproc');
  }
  if (n.type === 'subshell') out.push('parentheses');
  // (bash 5.3's `${ …; }` and `${| …; }` run in the current shell.)
  else if (n.type === 'command_substitution' && !substitutionForm(n).startsWith('${')) out.push('command-substitution');
  else if (n.type === 'process_substitution') out.push('process-substitution');
  return out;
}

/**
 * Whether the last stage of a pipeline runs in the shell itself: always in zsh and ksh; in bash with lastpipe on
 * and job control (`set -m`) off.
 */
export function lastStageInShell(st: ShellState, shell?: Shell): Tri {
  if (shell === 'zsh' || shell === 'ksh') return 'on';
  if (shell && shell !== 'bash') return 'off';
  const monitor = st.set.get('monitor') ?? 'default';
  const lastpipe = st.shopt.get('lastpipe') ?? 'default';
  if (monitor === 'on' || lastpipe === 'off' || lastpipe === 'default') return 'off';
  return lastpipe === 'on' && monitor !== 'unknown' ? 'on' : 'unknown';
}

/** What the environment model needs from the walk of the shell state. */
export interface WalkFacts {
  /** The run state of a node. */
  run(n: SyntaxNode): ShellState;
  /** The commands that call each function definition, and whether it is surely defined there. */
  readonly calls: ReadonlyMap<SyntaxNode, ReadonlyMap<SyntaxNode, boolean>>;
  /** The function definitions the host calls once the script has run, and how. */
  readonly hostCalls: ReadonlyMap<SyntaxNode, HostCall>;
  readonly shell?: Shell;
  /** Whether every call of the function `name` is one the walk sees (src/semantics/trust.ts, `Trust.closed`). */
  closed(name: string): boolean;
  /** Where the root of a tree runs: the model's own (a string another shell runs: the slot's chain), or that of a string `eval` runs. */
  base(root: SyntaxNode): ExecEnv;
}

/** The function definition whose body holds `n`, if any. */
function enclosingFunction(n: SyntaxNode): SyntaxNode | undefined {
  for (let x = n; x.parent; x = x.parent) if (x.parent.type === 'function_definition' && x === field(x.parent, 'body')) return x.parent;
  return undefined;
}

/** The environment of every node of a tree, computed when asked and kept. */
export class EnvModel {
  private readonly memo = new Map<SyntaxNode, ExecEnv>();
  /** The strongly connected components of the call graph (functions that call each other), by definition. */
  private components: Map<SyntaxNode, Set<SyntaxNode>> | undefined;

  constructor(private readonly walk: WalkFacts) {}

  /** Where `n` runs. */
  at(n: SyntaxNode): ExecEnv {
    const hit = this.memo.get(n);
    if (hit) return hit;
    const p = n.parent;
    const base = !p ? this.walk.base(n) : p.type === 'function_definition' && n === field(p, 'body') ? this.body(p) : this.at(p);
    const own = this.own(n);
    const env = own.length ? { links: [...base.links, ...own] } : base;
    this.memo.set(n, env);
    return env;
  }

  private own(n: SyntaxNode): SubshellLink[] {
    const links: SubshellLink[] = subshellReasons(n).map((why) => ({ kind: 'subshell', why, at: n, sure: true }));
    const p = n.parent;
    if (p?.type === 'pipeline' && STATEMENTS.has(n.type) && n === lastStage(p)) {
      const here = lastStageInShell(this.walk.run(p), this.walk.shell);
      if (here !== 'on') links.unshift({ kind: 'subshell', why: 'pipeline-stage', at: n, sure: here === 'off' });
    }
    return links;
  }

  /** The subshell links from `n` up to the body of the function that holds it (not that body's base). */
  private within(n: SyntaxNode, def: SyntaxNode): SubshellLink[] {
    const links: SubshellLink[] = [];
    for (let x: SyntaxNode = n; x !== def; x = x.parent!) links.unshift(...this.own(x));
    return links;
  }

  /**
   * Where the body of `def` runs: at each of its calls. The functions that call each other (a component of the
   * call graph) run where a call from outside the component runs, with the subshells of the calls inside it on
   * top (`f() { g | cat; }`). A function no call reaches runs where it is defined, but `unsure`; one only the host
   * calls, in the process the host starts for it.
   */
  private body(def: SyntaxNode): ExecEnv {
    const host = this.walk.hostCalls.get(def);
    if (host && !this.walk.calls.get(def)?.size) return { links: [{ kind: 'host', def, call: host }] };
    const component = this.component(def);
    // The calls into the component from outside it: where they run is known without it.
    const entries: CallSite[] = [];
    for (const member of component) {
      for (const [at, sure] of this.walk.calls.get(member) ?? []) {
        const caller = enclosingFunction(at);
        if (!caller || !component.has(caller)) entries.push({ at, env: this.at(at), sure });
      }
    }
    const sites: CallSite[] = [];
    for (const [at, sure] of this.walk.calls.get(def) ?? []) {
      const caller = enclosingFunction(at);
      if (!caller || !component.has(caller)) sites.push({ at, env: this.at(at), sure });
      else {
        // A call from inside the component: wherever the component is entered, with the subshells around the call.
        const inner = this.within(at, caller);
        for (const e of entries) sites.push({ at, env: inner.length ? { links: [...e.env.links, ...inner] } : e.env, sure: sure && e.sure });
      }
    }
    const unsure = !sites.length || !!host || !this.walk.closed(field(def, 'name')!.text);
    const link: CallLink = { kind: 'call', def, sites, unsure };
    return { links: sites.length ? [link] : [...this.at(def).links, link] };
  }

  /** The functions that call `def`, directly or not, and that it calls (Tarjan's algorithm, over every definition at once). */
  private component(def: SyntaxNode): Set<SyntaxNode> {
    if (!this.components) {
      this.components = new Map();
      const callees = new Map<SyntaxNode, SyntaxNode[]>();
      for (const [callee, sites] of this.walk.calls) {
        for (const at of sites.keys()) {
          const caller = enclosingFunction(at);
          if (caller) callees.set(caller, [...(callees.get(caller) ?? []), callee]);
        }
      }
      const index = new Map<SyntaxNode, number>();
      const low = new Map<SyntaxNode, number>();
      const stack: SyntaxNode[] = [];
      const visit = (v: SyntaxNode): void => {
        index.set(v, index.size);
        low.set(v, index.get(v)!);
        stack.push(v);
        for (const w of callees.get(v) ?? []) {
          if (!index.has(w)) {
            visit(w);
            low.set(v, Math.min(low.get(v)!, low.get(w)!));
          } else if (stack.includes(w)) low.set(v, Math.min(low.get(v)!, index.get(w)!));
        }
        if (low.get(v) === index.get(v)) {
          const set = new Set<SyntaxNode>();
          for (let w = stack.pop()!; ; w = stack.pop()!) {
            set.add(w);
            this.components!.set(w, set);
            if (w === v) break;
          }
        }
      };
      for (const v of new Set([...this.walk.calls.keys(), ...callees.keys()])) if (!index.has(v)) visit(v);
    }
    return this.components.get(def) ?? new Set([def]);
  }
}

/** `env` with one more link. */
export const within = (env: ExecEnv, link: EnvLink): ExecEnv => ({ links: [...env.links, link] });

// ---------------------------------------------------------------------------------------------------
// What an environment means.

/** The kind of process: the main shell, a subshell of it, another shell, or a program started by a slot. */
export type ProcessKind = 'main' | 'subshell' | 'shell' | 'program';
type Process = { readonly kind: ProcessKind; readonly sure: boolean; readonly link?: EnvLink };

/** `processOf` of each environment, and `callSites` of each call link (both are never changed once made). */
const processes = new WeakMap<ExecEnv, Process>();
const callProcesses = new WeakMap<CallLink, CallSites>();

/**
 * The process that runs code in `env`: the innermost link that starts one (a `current-shell` slot starts none).
 * `sure: false` when it is a subshell on some paths only, and the main shell on the others; `link` is the link
 * that starts it.
 */
export function processOf(env: ExecEnv): Process {
  const hit = processes.get(env);
  if (hit) return hit;
  let out: Process = { kind: 'main', sure: true };
  for (const l of env.links) {
    if (l.kind === 'call') {
      // (A function is called from the script's own shells: none is in another program.)
      if (out.kind === 'subshell' && out.sure) continue;
      const calls = callSites(l);
      // (A function called only from another shell, `bash -c 'f() { …; }; f'`, runs in that shell.)
      out = calls.shell ? { kind: 'shell', sure: !l.unsure, link: l }
        : !calls.some ? { kind: 'main', sure: out.sure && !l.unsure }
        : { kind: 'subshell', sure: calls.all && !l.unsure, link: l };
    } else if (l.kind === 'host') {
      // (A test runs in a bash of its own that has read the whole file: as the script's shell is, to what runs in it.)
      out = { kind: 'main', sure: true };
    } else if (l.kind === 'slot') {
      if (l.slot.run === 'subshell') out = { kind: 'subshell', sure: true, link: l };
      else if (l.slot.run !== 'current-shell') out = { kind: l.slot.run === 'exec' ? 'program' : 'shell', sure: true, link: l };
    } else if (out.kind === 'main' || out.kind === 'subshell') {
      // (The innermost subshell gives the reason: `( cd ) &` is in `( )`.)
      out = { kind: 'subshell', sure: l.sure || (out.kind === 'subshell' && out.sure), link: l };
    }
  }
  processes.set(env, out);
  return out;
}

/**
 * The calls of a function: whether some run in a subshell, whether all surely do, and whether all run in another
 * shell (a function that string defines). Kept per link, as
 * `processOf` is per environment: the chains of a function's calls hold those of its callers' calls, which would be
 * read again at each (a chain of functions, each called in `$( )` and also plainly, doubles them at each step).
 */
type CallSites = { some: boolean; all: boolean; shell: boolean };
function callSites(l: CallLink): CallSites {
  let hit = callProcesses.get(l);
  if (!hit) {
    const all = l.sites.map((x) => processOf(x.env));
    const sub = all.filter((p) => p.kind === 'subshell');
    hit = { some: sub.length > 0, all: sub.length === all.length && sub.every((p) => p.sure), shell: all.length > 0 && all.every((p) => p.kind === 'shell') };
    callProcesses.set(l, hit);
  }
  return hit;
}

/** Where the code runs: on this machine, on a remote one (ssh), or in a container. */
export function whereOf(env: ExecEnv): 'local' | 'remote' | 'container' {
  let where: 'local' | 'remote' | 'container' = 'local';
  for (const l of env.links) if (l.kind === 'slot' && l.slot.where && l.slot.where !== 'local') where = l.slot.where;
  return where;
}

/**
 * What a slot does to the environment of the command it runs: `kept`, the variables that reach it pass on (`env`,
 * `nice`, `sudo -E`); `reset`, it starts afresh or passes none (`env -i`, sudo's policy, ssh); and whether the command
 * runs on this machine.
 */
export function slotEnvironment(link: SlotLink): { kept: boolean; here: boolean } {
  return { kept: link.env === 'exported' || link.env === 'variables', here: (link.slot.where ?? 'local') === 'local' };
}

/** How much of a script's functions, variables, options or aliases reaches a process: all of them, the exported ones, or none. */
export type Reach = 'all' | 'exported' | 'none';

/**
 * What of this script reaches the code in `env`. A subshell has all of it; a command started by a slot gets the
 * exported functions and variables, unless a link on the way passes no functions (`sudo -E`), or nothing of this
 * script (`env -i`, sudo, `su -l -c`, a container, another machine): `blocker` is the first such link. The set
 * options reach another shell only through an exported `SHELLOPTS` (`shellopts`); aliases never do.
 */
export function reachOf(env: ExecEnv, shellopts = false): { functions: Reach; variables: Reach; options: Reach; aliases: Reach; blocker?: SlotLink } {
  let functions: Reach = 'all';
  let variables: Reach = 'all';
  let options: Reach = 'all';
  let aliases: Reach = 'all';
  let blocker: SlotLink | undefined;
  for (const l of env.links) {
    // (The current shell, or a subshell of it, has all of it.)
    if (l.kind !== 'slot' || l.slot.run === 'current-shell' || l.slot.run === 'subshell') continue;
    const away = l.slot.where === 'remote' || l.slot.where === 'container';
    if (functions !== 'none') functions = away || l.env !== 'exported' ? 'none' : 'exported';
    if (variables !== 'none') variables = away || l.env === 'reset' || l.env === 'none' ? 'none' : 'exported';
    options = variables === 'none' || !shellopts || (options as Reach) === 'none' ? 'none' : 'exported';
    aliases = 'none';
    if (functions === 'none') blocker ??= l;
  }
  return { functions, variables, options, aliases, ...(blocker ? { blocker } : {}) };
}

/**
 * The first link on the way to code in `env` that does not pass on the exported variable `name` (`reachOf`: one that
 * runs it on another machine or in a container, or resets the environment), unless it keeps that name
 * (`CommandSlot.keeps`: sudo keeps `TERM`, `TZ`, `LANG`…); undefined when the variable reaches it.
 */
export function droppedBy(env: ExecEnv, name: string): SlotLink | undefined {
  const kept = (l: SlotLink): boolean => !!l.slot.keeps?.some((k) => (k.endsWith('*') ? name.startsWith(k.slice(0, -1)) : k === name));
  return env.links.find((l): l is SlotLink => l.kind === 'slot'
    && (l.slot.where === 'remote' || l.slot.where === 'container' || ((l.env === 'reset' || l.env === 'none') && !kept(l))));
}

/**
 * How a shell reads a file of code: `script`, run as a program by a shell that is not interactive (it has a shebang,
 * or a host hands it to a shell: a CI step, a Dockerfile `RUN`, a recipe, an npm script, a bats file), so aliases are
 * not expanded and `local` fails outside a function; `terminal`, typed into an interactive shell (the code blocks of a
 * README); `unknown`, a file with no shebang, which may be run (`bash f.sh`), or read with `source` by an interactive
 * shell (`.bashrc`) or by a function.
 */
export type FileRead = 'script' | 'terminal' | 'unknown';

/** How the file whose tree is `root` is read (`FileRead`), as part of `host` when it is one. */
export function fileRead(root: SyntaxNode, host?: HostId): FileRead {
  if (host) return host.kind === 'markdown' ? 'terminal' : 'script';
  const first = root.namedChildren[0];
  return first && isShebang(first) ? 'script' : 'unknown';
}

/**
 * How the shell that runs code in `env` reads it, in a file read as `file`: another shell started for it (`bash -c
 * '…'`, `sudo bash -c`) reads its string as a script; the file's own shell, and its subshells, read it as the file is.
 */
export function readAs(env: ExecEnv, file: FileRead): FileRead {
  const p = processOf(env);
  return p.kind === 'shell' || p.kind === 'program' ? 'script' : file;
}

/** The subshell links `n` itself starts (a pipeline stage, `( )`, `&`…). */
export function ownSubshells(env: ExecEnv, n: SyntaxNode): SubshellLink[] {
  return env.links.filter((l): l is SubshellLink => l.kind === 'subshell' && l.at === n);
}

/**
 * Whether code in `env` runs in the body of a function: a call link, with no link after it that starts another shell
 * or a program (`f() { bash -c 'local x'; }` runs `local` outside any function; `eval`, `( )` and `$( )` stay in it),
 * or that runs it later (a trap's action: `f() { trap 'local x' EXIT; }` runs it after `f` has returned). A RETURN
 * trap, or an ERR or DEBUG trap that fires while the function runs, does run in it; the link does not say the signal,
 * so such a trap counts as outside too.
 */
export function inFunction(env: ExecEnv): boolean {
  for (let i = env.links.length - 1; i >= 0; i--) {
    const l = env.links[i];
    if (l.kind === 'call' || l.kind === 'host') return true;
    if (l.kind === 'slot' && (l.slot.later || (l.slot.run !== 'current-shell' && l.slot.run !== 'subshell'))) return false;
  }
  return false;
}

/** The statements that hold a `{ }` group in the same process: a list, a redirection, `!`, a pipeline, a coproc. */
const GROUP_HOLDERS = new Set(['list', 'redirected_statement', 'negated_command', 'pipeline', 'coproc_statement']);

/**
 * The subshell a `{ }` group `n` runs in (`env` is where it runs): one that the group, or a statement that holds it
 * in the same list, starts (a stage of a pipeline, a coproc, or `&`: a pipeline stage or a coproc before `&`, as
 * in `{ a; } | b &`). Undefined when it runs in the shell that runs that list.
 */
export function groupSubshellLink(env: ExecEnv, n: SyntaxNode): SubshellLink | undefined {
  for (let x = n; ; x = x.parent!) {
    const own = ownSubshells(env, x);
    const link = own.find((l) => l.why !== 'background') ?? own[0];
    if (link) return link;
    if (!GROUP_HOLDERS.has(x.parent!.type)) return undefined;
  }
}

// ---------------------------------------------------------------------------------------------------
// Command slots.

/** How a slot is named in the explanations: the command, and the option that takes the command (`bash -c`, `su -c`). */
export function slotName(parse: ArgvParse, spec: CommandSpec, role: CommandRole): string {
  const name = parse.command.split('/').pop()!;
  // (`bash -c`: the string is the operand that `-c` makes a command.)
  const of = role.of ?? (role.slot.run === 'shell-string' && !role.slot.joinsWords ? '-c' : undefined);
  const option = of ? spec.options?.find((o) => o.names.includes(of)) : undefined;
  return option ? `${name} ${option.names[0]}` : name;
}

const NO_SPEC: CommandSpec = { summary: { ja: '', en: '' } };

/**
 * The words the roles of a parse are numbered in: the command's own, or the words split from an `env -S` value,
 * which have no node of their own: `node` is then the word that holds the value.
 */
interface Words { readonly args: readonly ArgWord[]; node(i: number): SyntaxNode; text(i: number): string }
/** A role of a parse, with the words it is numbered in; `split`, when they are split from an `env -S` value. */
interface Item { readonly word: number; readonly role: ArgRole; readonly w: Words; readonly split?: boolean }

/** The words an `env -S` value of the role is split into, with their roles. */
function splitOf(role: ArgRole): ValueRole['split'] {
  const value = role.role === 'value' ? role : role.role === 'option' ? role.value : undefined;
  if (value) return value.split;
  return role.role === 'cluster' ? role.letters.map((l) => (l.role === 'option' ? l.value?.split : undefined)).find((s) => s) : undefined;
}

/**
 * The roles of a parse, each followed by the roles of the words its `env -S` value splices in (`env -S'-i bash
 * -e' -c s`: `-S`, then `-i` and `bash`; `-c` and `s`, which bash reads, are roles of the line after them).
 */
function items(roles: readonly RoleAt[], w: Words, split?: boolean): Item[] {
  return roles.flatMap((r) => {
    const s = splitOf(r.role);
    const own: Item = { ...r, w, ...(split ? { split } : {}) };
    if (!s) return [own];
    const node = w.node(r.word);
    return [own, ...items(s.roles, { args: s.words, node: () => node, text: (i) => s.words[i].value! }, true)];
  });
}

/**
 * Whether a slot runs a string as a script (docs/design/semantics.md, 4.13): another shell's (`bash -c`, ssh), or this
 * shell's, now (`eval`) or later (a trap's action). `sudo -s cmd` escapes its words, which are then a command.
 */
export function runsString(slot: CommandSlot): boolean {
  return !slot.escapesWords && (slot.run === 'shell-string' || !!slot.later || (slot.run === 'current-shell' && !!slot.joinsWords));
}

/**
 * Where each command that a command's words run through a slot runs (`sudo env -i bash -c 'f'`: `env` under
 * sudo, `bash` under env, and the string under `bash -c`), keyed by its first word (or its string). `env` is
 * where the command itself runs; `parse` reads its words `nodes` with `spec`; `lookup` gives the spec of a
 * command a slot runs, for find's expression. `strings` gets the words of each string a slot runs as a script
 * (`runsString`): one word, or the words it joins (`eval a b`, `ssh host ls -l`), by the first. A command named in an
 * `env -S` value has no word of its own, so it is not a key, but what it runs is (`env -S'-i bash -c' 'f'`: the
 * string, under bash under env).
 */
export function slotEnvs(env: ExecEnv, parse: ArgvParse, spec: CommandSpec, nodes: readonly SyntaxNode[], shell: Shell | undefined, lookup?: (name: string) => CommandSpec | undefined, strings?: Map<SyntaxNode, SyntaxNode[]>): Map<SyntaxNode, ExecEnv> {
  const out = new Map<SyntaxNode, ExecEnv>();
  const visit = (outer: ExecEnv, p: ArgvParse, s: CommandSpec, all: readonly Item[]): void => {
    // A command named in an `env -S` value reads the rest of the line: the roles after it are its own.
    const k = all.findIndex((i) => i.split && i.role.role === 'command');
    const list = k < 0 ? all : all.slice(0, k + 1);
    // (`env x=1 cmd`, `docker run -e x img cmd`: the assignments come before the command.)
    const assigns: string[] = [];
    const unsets: string[] = [];
    const flags = list.flatMap((r) => (r.role.role === 'cluster' ? r.role.letters : [r.role])).flatMap((r) => (r.role === 'option' ? [r.flag, ...r.spec.names] : []));
    for (const [idx, { word, role, w, split }] of list.entries()) {
      // (`-e x`, or `--env=x` in the option's word.)
      const value = role.role === 'value' ? role : role.role === 'option' ? role.value : undefined;
      if (value?.spec?.setsEnv) {
        const text = w.args[word].value?.slice(value.attached);
        assigns.push(value.spec.setsEnv === 'file' || text === undefined ? '*' : text.replace(/=[\s\S]*$/, ''));
      }
      if (value?.spec?.unsetsEnv) {
        const text = w.args[word].value?.slice(value.attached);
        if (text !== undefined) unsets.push(text);
      }
      if (role.role === 'operand' && role.spec?.assignment) {
        // (By its value where it is static: `env 'BASH_COMPAT=31' bash -c …`.)
        const text = w.args[word].value ?? w.text(word);
        assigns.push(text.slice(0, text.indexOf('=')));
      } else if (role.role === 'subcommand') visit(outer, role.parse, role.spec, items(role.parse.roles, w, split));
      else if (role.role === 'command') {
        const env = role.slot.envWith && flags.some((f) => role.slot.envWith!.options.includes(f)) ? role.slot.envWith.env : role.slot.env ?? 'exported';
        const program = (role.slot.run === 'shell-string' ? p.command.split(' ')[0].split('/').pop()! : '');
        const shell: ShellKind | undefined = role.slot.run !== 'shell-string' ? undefined : role.slot.shell ?? (!role.slot.joinsWords ? shellFromName(program) : undefined) ?? 'unknown';
        // (The options of a shell started by its name: not those of `su -l -c` or of `watch`.)
        const invocation = shell && shell !== 'unknown' && !role.slot.shell ? shellInvocation(all) : [];
        const inner = within(outer, { kind: 'slot', slot: role.slot, via: slotName(p, s, role), at: w.node(word), assigns, env, ...(unsets.length ? { unsets } : {}),
          ...(shell ? { shell } : {}), ...(invocation.length ? { invocation } : {}) });
        if (!split) out.set(w.node(word), inner);
        // (The words a slot joins are those after it that it marks `joined`.)
        if (!split && runsString(role.slot)) strings?.set(w.node(word), [w.node(word), ...(role.slot.joinsWords ? all.slice(idx + 1).filter((i) => i.role.role === 'joined').map((i) => w.node(i.word)) : [])]);
        // (A command named in an `env -S` value also reads the rest of the line.)
        if (role.parse) visit(inner, role.parse, role.spec ?? NO_SPEC, [...items(role.parse.roles, w, split), ...(split ? all.slice(k + 1) : [])]);
      } else if (role.role === 'expression' && word === p.expression && s.expressionSpec) {
        // find's expression: its actions (`-exec cmd ;`) run commands.
        const part: Words = { args: w.args.slice(word, p.end), node: (i) => w.node(word + i), text: (i) => w.text(word + i) };
        const q = interpret(s.expressionSpec, [...part.args], { name: p.command, lookup });
        visit(outer, q, s.expressionSpec, items(q.roles, part, split));
      }
    }
  };
  visit(env, parse, spec, items(parse.roles, { args: nodes.map(argWordFor(shell)), node: (i) => nodes[i], text: (i) => nodes[i].text }));
  return out;
}

/**
 * The options a shell is started with (`bash -e -o pipefail -O extglob -c S`): each option of its parse (`all`,
 * with the words of the line it reads after an `env -S` value) as written, with the value it takes (`-o NAME`), and
 * those its spec does not know (`bash -k`: a letter of `set`).
 */
function shellInvocation(all: readonly Item[]): { flag: string; value?: string }[] {
  const out: { flag: string; value?: string }[] = [];
  for (const { word, role, w } of all) {
    for (const r of role.role === 'cluster' ? role.letters : [role]) {
      if ((r.role === 'option' && !r.spec.value) || r.role === 'unknown-option') out.push({ flag: r.flag });
      else if (r.role === 'option' && r.value) out.push({ flag: r.flag, value: w.args[word].value?.slice(r.value.attached) });
      else if (r.role === 'value') out.push({ flag: r.of, value: w.args[word].value });
    }
  }
  return out;
}

/**
 * What a call of a builtin does to the shell that runs it: `changes` it (`CommandSpec.shellEffect`), `exits` it
 * (`ends: 'shell'`), or nothing (`set +o`, `umask`, `declare -p` only print). `roles` are its words with their roles. A
 * command slot that replaces the shell (`exec cmd`: `CommandSlot.replacesShell`) ends it.
 */
export function shellEffectOf(spec: CommandSpec | undefined, roles: readonly (readonly [SyntaxNode, ArgRole])[]): 'changes' | 'exits' | undefined {
  if (spec?.ends === 'shell' || roles.some(([, r]) => r.role === 'command' && r.slot.replacesShell)) return 'exits';
  const effect = spec?.shellEffect;
  if (!effect?.when) return effect?.does;
  const call: BuiltinCall = { flags: [], bare: [], operands: [] };
  for (const [w, role] of roles) {
    for (const r of role.role === 'cluster' ? role.letters : [role]) {
      if (r.role === 'option' || r.role === 'unknown-option' || r.role === 'pattern-option') {
        call.flags.push(r.flag);
        if (r.role === 'option' && r.missing) call.bare.push(r.flag);
      } else if (r.role === 'end-of-options') call.flags.push('--');
      else if (r.role === 'operand') call.operands.push(staticWordValue(w));
    }
  }
  return effect.when(call) ? 'changes' : undefined;
}
