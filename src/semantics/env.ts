// Execution environments (docs/design/semantics.md, 4.3 and step B2; manual 3.7.3): which process runs each
// node, as a chain of links from the outermost to the innermost.
//
// - A subshell link comes from the node's place in the tree: `( )`, `$( )` and backquotes, `<( )` and `>( )`, a
//   statement followed by `&`, a coproc's command, and every stage of a pipeline but the last one. The last stage
//   is a subshell unless lastpipe is on and job control off, which the shell state where the pipeline runs says
//   (`sure: false` when only some paths turn lastpipe on). The walk of src/semantics/state.ts drops the changes
//   of the same subshells, with the same rules (`subshellReasons`, `lastStageInShell`).
// - A function body runs where the function is called (the walk records the calls): its chain starts with a
//   `call` link that holds the chains of its calls. A function no call reaches runs where it is defined.
// - A slot link comes from a command slot (src/argv/spec.ts) that runs a command: a program (`sudo cmd`, `xargs
//   cmd`), another shell (`bash -c`, `su -c`, `ssh host cmd`) or the current shell again (`eval`, `command`).
//   What reaches the command is what every link on the way passes on (`env -i bash -c f`: no function).
import type { ArgRole, ArgvParse, CommandRole } from '../argv/interpret';
import { interpret } from '../argv/interpret';
import type { BuiltinCall, CommandSlot, CommandSpec } from '../argv/spec';
import { argWord } from '../argv/words';
import type { Shell } from '../dialect';
import { field, type SyntaxNode } from '../syntax/tree';
import type { ShellState, Tri } from './state';

/** Why a node runs in a subshell. */
export type SubshellReason = 'parentheses' | 'command-substitution' | 'process-substitution' | 'background' | 'coproc' | 'pipeline-stage';

/** A subshell that starts at `at`; `sure: false` when it does on some paths only (lastpipe, or some of a function's calls). */
export interface SubshellLink { readonly kind: 'subshell'; readonly why: SubshellReason; readonly at: SyntaxNode; readonly sure: boolean }
/** The shell a `shell-string` slot starts, from the program's name (`unknown`: `su -c`, ssh, a path or a name not known). */
export type ShellKind = 'bash' | 'sh' | 'dash' | 'zsh' | 'ksh' | 'unknown';

/**
 * A command run through a command slot: `at` is its first word (or the shell string); `via` names the slot (`bash -c`,
 * `sudo`); `assigns`, the variables the slot's command sets for it (`env x=1 cmd`, `docker run -e x`; `*` for a
 * file of them); `env`, what reaches it (the slot's, or the one its options give); `shell`, the shell a string runs in.
 */
export interface SlotLink {
  readonly kind: 'slot'; readonly slot: CommandSlot; readonly via: string; readonly at: SyntaxNode; readonly assigns: readonly string[];
  readonly env: NonNullable<CommandSlot['env']>; readonly shell?: ShellKind;
}
/** A place a function is called from: the command, where it runs, and whether the function is surely defined there. */
export interface CallSite { readonly at: SyntaxNode; readonly env: ExecEnv; readonly sure: boolean }
/**
 * A function body, which runs where the function is called: at any of `sites`. `unsure`: it may also be called from
 * where the model does not see (its name is a word the walk did not take for a call, `bash -c f`), or it is never
 * called (then the links before this one are where it is defined).
 */
export interface CallLink { readonly kind: 'call'; readonly def: SyntaxNode; readonly sites: readonly CallSite[]; readonly unsure: boolean }
export type EnvLink = SubshellLink | SlotLink | CallLink;

/** Where a node runs: the links from the main shell to it, outermost first (none: the main shell). */
export interface ExecEnv { readonly links: readonly EnvLink[] }

export const MAIN_SHELL: ExecEnv = { links: [] };

/** Statements: what a list of commands is made of. */
export const STATEMENTS = new Set(['command', 'declaration_command', 'unset_command', 'variable_assignment', 'variable_assignments', 'negated_command',
  'redirected_statement', 'pipeline', 'list', 'time_statement', 'coproc_statement', 'compound_statement', 'subshell', 'if_statement', 'case_statement',
  'for_statement', 'select_statement', 'c_style_for_statement', 'while_statement', 'function_definition', 'arithmetic_command', 'test_command', 'extended_test']);

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
 * parentheses). The last stage of a pipeline is not here: it depends on the state (`lastStageInShell`).
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
  else if (n.type === 'command_substitution') out.push('command-substitution');
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
  readonly root: SyntaxNode;
  readonly shell?: Shell;
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
  /** How many times each word appears in the script (not in comments): a function's name that is not a call it saw. */
  private words: Map<string, number> | undefined;

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
   * top (`f() { g | cat; }`). A function no call reaches runs where it is defined, but `unsure`.
   */
  private body(def: SyntaxNode): ExecEnv {
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
    const name = field(def, 'name')!.text;
    // (Each call is one word of the name; the definition is another.)
    const unsure = !sites.length || this.count(name) > 1 + new Set(sites.map((x) => x.at)).size;
    const link: CallLink = { kind: 'call', def, sites, unsure };
    return { links: sites.length ? [link] : [...this.at(def).links, link] };
  }

  private count(name: string): number {
    if (!this.words) {
      this.words = new Map();
      const visit = (n: SyntaxNode): void => {
        if (n.type === 'comment') return;
        if (!n.children.length) for (const w of n.text.match(/[^\s'"`$;|&(){}<>=]+/g) ?? []) this.words!.set(w, (this.words!.get(w) ?? 0) + 1);
        n.children.forEach(visit);
      };
      visit(this.walk.root);
    }
    // (The definition's own name is one of the words.)
    return this.words.get(name)!;
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

/**
 * The process that runs code in `env`: the innermost link that starts one (a `current-shell` slot starts none).
 * `sure: false` when it is a subshell on some paths only, and the main shell on the others; `link` is the link
 * that starts it.
 */
export function processOf(env: ExecEnv): { kind: ProcessKind; sure: boolean; link?: EnvLink } {
  let out: { kind: ProcessKind; sure: boolean; link?: EnvLink } = { kind: 'main', sure: true };
  for (const l of env.links) {
    if (l.kind === 'call') {
      // (A function is called from the script's own shells: none is in another program.)
      if (out.kind === 'subshell' && out.sure) continue;
      const all = l.sites.map((x) => processOf(x.env));
      const sub = all.filter((p) => p.kind === 'subshell');
      out = !sub.length ? { kind: 'main', sure: out.sure && !l.unsure }
        : { kind: 'subshell', sure: sub.length === all.length && sub.every((p) => p.sure) && !l.unsure, link: l };
    } else if (l.kind === 'slot') {
      if (l.slot.run !== 'current-shell') out = { kind: l.slot.run === 'exec' ? 'program' : 'shell', sure: true, link: l };
    } else if (out.kind === 'main' || out.kind === 'subshell') {
      // (The innermost subshell gives the reason: `( cd ) &` is in `( )`.)
      out = { kind: 'subshell', sure: l.sure || (out.kind === 'subshell' && out.sure), link: l };
    }
  }
  return out;
}

/** Where the code runs: on this machine, on a remote one (ssh), or in a container. */
export function whereOf(env: ExecEnv): 'local' | 'remote' | 'container' {
  let where: 'local' | 'remote' | 'container' = 'local';
  for (const l of env.links) if (l.kind === 'slot' && l.slot.where && l.slot.where !== 'local') where = l.slot.where;
  return where;
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
    if (l.kind !== 'slot' || l.slot.run === 'current-shell') continue;
    const away = l.slot.where === 'remote' || l.slot.where === 'container';
    if (functions !== 'none') functions = away || l.env !== 'exported' ? 'none' : 'exported';
    if (variables !== 'none') variables = away || l.env === 'reset' || l.env === 'none' ? 'none' : 'exported';
    options = variables === 'none' || !shellopts || (options as Reach) === 'none' ? 'none' : 'exported';
    aliases = 'none';
    if (functions === 'none') blocker ??= l;
  }
  return { functions, variables, options, aliases, ...(blocker ? { blocker } : {}) };
}

/** The subshell links `n` itself starts (a pipeline stage, `( )`, `&`…). */
export function ownSubshells(env: ExecEnv, n: SyntaxNode): SubshellLink[] {
  return env.links.filter((l): l is SubshellLink => l.kind === 'subshell' && l.at === n);
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
 * Where each command that a command's words run through a slot runs (`sudo env -i bash -c 'f'`: `env` under
 * sudo, `bash` under env, and the string under `bash -c`), keyed by its first word (or its string). `env` is
 * where the command itself runs; `parse` reads its words `nodes` with `spec`; `lookup` gives the spec of a
 * command a slot runs, for find's expression.
 */
export function slotEnvs(env: ExecEnv, parse: ArgvParse, spec: CommandSpec, nodes: readonly SyntaxNode[], lookup?: (name: string) => CommandSpec | undefined): Map<SyntaxNode, ExecEnv> {
  const out = new Map<SyntaxNode, ExecEnv>();
  const visit = (outer: ExecEnv, p: ArgvParse, s: CommandSpec, words: readonly SyntaxNode[]): void => {
    // (`env x=1 cmd`, `docker run -e x img cmd`: the assignments come before the command.)
    const assigns: string[] = [];
    const flags = p.roles.flatMap((r) => (r.role.role === 'cluster' ? r.role.letters : [r.role])).flatMap((r) => (r.role === 'option' ? [r.flag, ...r.spec.names] : []));
    for (const { word, role } of p.roles) {
      // (`-e x`, or `--env=x` in the option's word.)
      const value = role.role === 'value' ? role : role.role === 'option' ? role.value : undefined;
      if (value?.spec?.setsEnv) {
        const text = argWord(words[word]).value?.slice(value.attached);
        assigns.push(value.spec.setsEnv === 'file' || text === undefined ? '*' : text.replace(/=[\s\S]*$/, ''));
      }
      if (role.role === 'operand' && role.spec?.assignment) assigns.push(words[word].text.slice(0, words[word].text.indexOf('=')));
      else if (role.role === 'subcommand') visit(outer, role.parse, role.spec, words);
      else if (role.role === 'command') {
        const env = role.slot.envWith && flags.some((f) => role.slot.envWith!.options.includes(f)) ? role.slot.envWith.env : role.slot.env ?? 'exported';
        const program = (role.slot.run === 'shell-string' ? p.command.split(' ')[0].split('/').pop()! : '');
        const shell: ShellKind | undefined = role.slot.run !== 'shell-string' ? undefined : role.slot.shell ?? (/^(bash|sh|dash|zsh|ksh)$/.test(program) && !role.slot.joinsWords ? program as ShellKind : 'unknown');
        const inner = within(outer, { kind: 'slot', slot: role.slot, via: slotName(p, s, role), at: words[word], assigns, env, ...(shell ? { shell } : {}) });
        out.set(words[word], inner);
        if (role.parse) visit(inner, role.parse, role.spec ?? NO_SPEC, words);
      } else if (role.role === 'expression' && word === p.expression && s.expressionSpec) {
        // find's expression: its actions (`-exec cmd ;`) run commands.
        const part = words.slice(word, p.end);
        visit(outer, interpret(s.expressionSpec, part.map(argWord), { name: p.command, lookup }), s.expressionSpec, part);
      }
    }
  };
  visit(env, parse, spec, nodes);
  return out;
}

/**
 * What a call of a builtin does to the shell that runs it (`CommandSpec.shellEffect`): `changes` it, `exits` it,
 * or nothing (`set +o`, `umask`, `declare -p` only print). `roles` are its words with their roles.
 */
export function shellEffectOf(spec: CommandSpec | undefined, roles: readonly (readonly [SyntaxNode, ArgRole])[]): 'changes' | 'exits' | undefined {
  const effect = spec?.shellEffect;
  if (!effect?.when) return effect?.does;
  const call: BuiltinCall = { flags: [], bare: [], operands: [] };
  for (const [w, role] of roles) {
    for (const r of role.role === 'cluster' ? role.letters : [role]) {
      if (r.role === 'option' || r.role === 'unknown-option' || r.role === 'pattern-option') {
        call.flags.push(r.flag);
        if (r.role === 'option' && r.missing) call.bare.push(r.flag);
      } else if (r.role === 'end-of-options') call.flags.push('--');
      else if (r.role === 'operand') call.operands.push(argWord(w).value);
    }
  }
  return effect.when(call) ? 'changes' : undefined;
}
