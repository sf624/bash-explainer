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
import type { ArgvParse, CommandRole } from '../argv/interpret';
import { interpret } from '../argv/interpret';
import type { CommandSlot, CommandSpec } from '../argv/spec';
import { argWord } from '../argv/words';
import type { Shell } from '../dialect';
import { field, type SyntaxNode } from '../syntax/tree';
import type { ShellState, Tri } from './state';

/** Why a node runs in a subshell. */
export type SubshellReason = 'parentheses' | 'command-substitution' | 'process-substitution' | 'background' | 'coproc' | 'pipeline-stage';

/** A subshell that starts at `at`; `sure: false` when it does on some paths only (lastpipe, or some of a function's calls). */
export interface SubshellLink { readonly kind: 'subshell'; readonly why: SubshellReason; readonly at: SyntaxNode; readonly sure: boolean }
/**
 * A command run through a command slot: `at` is its first word (or the shell string); `via` names the slot (`bash -c`,
 * `sudo`); `assigns`, the variables the slot's command sets for it (`env x=1 cmd`).
 */
export interface SlotLink { readonly kind: 'slot'; readonly slot: CommandSlot; readonly via: string; readonly at: SyntaxNode; readonly assigns: readonly string[] }
/** A function body, which runs where the function is called: in any of `envs` (a merge of different places). */
export interface CallLink { readonly kind: 'call'; readonly def: SyntaxNode; readonly envs: readonly ExecEnv[] }
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
  /** The commands that call each function definition. */
  readonly calls: ReadonlyMap<SyntaxNode, readonly SyntaxNode[]>;
  readonly shell?: Shell;
}

/** The environment of every node of a tree, computed when asked and kept. */
export class EnvModel {
  private readonly memo = new Map<SyntaxNode, ExecEnv>();
  /** The function definitions whose callers are being merged (a recursive call is left out). */
  private readonly merging = new Set<SyntaxNode>();

  constructor(private readonly walk: WalkFacts) {}

  /** Where `n` runs. */
  at(n: SyntaxNode): ExecEnv {
    // (Only a node asked for while the callers of a function are merged has none yet.)
    return this.find(n)!;
  }

  /** Undefined while the callers of a function it depends on are being merged (a recursive call). */
  private find(n: SyntaxNode): ExecEnv | undefined {
    const hit = this.memo.get(n);
    if (hit) return hit;
    const p = n.parent;
    const base = !p ? MAIN_SHELL : p.type === 'function_definition' && n === field(p, 'body') ? this.callers(p) : this.find(p);
    if (!base) return undefined;
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

  /** Where the body of `def` runs: the merge of where it is called (where it is defined, when no call is known). */
  private callers(def: SyntaxNode): ExecEnv | undefined {
    if (this.merging.has(def)) return undefined;
    this.merging.add(def);
    const envs = (this.walk.calls.get(def) ?? []).map((c) => this.find(c)).filter((e): e is ExecEnv => !!e);
    this.merging.delete(def);
    return envs.length ? { links: [{ kind: 'call', def, envs }] } : this.find(def);
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
      // (The places a function is called from are all in the script's shell: none is in another program.)
      const all = l.envs.map(processOf);
      const sub = all.filter((p) => p.kind === 'subshell');
      out = !sub.length ? out : { kind: 'subshell', sure: sub.length === all.length && sub.every((p) => p.sure), link: l };
    } else if (l.kind === 'slot') {
      if (l.slot.run !== 'current-shell') out = { kind: l.slot.run === 'exec' ? 'program' : 'shell', sure: true, link: l };
    } else if (out.kind === 'main' || (out.kind === 'subshell' && !out.sure)) out = { kind: 'subshell', sure: l.sure, link: l };
  }
  return out;
}

/** Where the code runs: on this machine, on a remote one (ssh), or in a container. */
export function whereOf(env: ExecEnv): 'local' | 'remote' | 'container' {
  let where: 'local' | 'remote' | 'container' = 'local';
  for (const l of env.links) if (l.kind === 'slot' && l.slot.where && l.slot.where !== 'local') where = l.slot.where;
  return where;
}

/** How much of a script's functions or variables reaches a process: all of them, the exported ones, or none. */
export type Reach = 'all' | 'exported' | 'none';

/**
 * What of this script reaches the code in `env`: its functions and its variables. A subshell has all of them;
 * a command started by a slot gets the exported ones, unless a link on the way passes no functions (`sudo -E`),
 * or nothing of this script (`env -i`, sudo, `su -c`, a container, another machine): `blocker` is the first such link.
 */
export function reachOf(env: ExecEnv): { functions: Reach; variables: Reach; blocker?: SlotLink } {
  let functions: Reach = 'all';
  let variables: Reach = 'all';
  let blocker: SlotLink | undefined;
  for (const l of env.links) {
    if (l.kind !== 'slot' || l.slot.run === 'current-shell') continue;
    const away = l.slot.where === 'remote' || l.slot.where === 'container';
    const env = l.slot.env ?? 'exported';
    if (functions !== 'none') functions = away || env !== 'exported' ? 'none' : 'exported';
    if (variables !== 'none') variables = away || env === 'reset' || env === 'none' ? 'none' : 'exported';
    if (functions === 'none') blocker ??= l;
  }
  return { functions, variables, ...(blocker ? { blocker } : {}) };
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
    // (`env x=1 cmd`: the assignments come before the command.)
    const assigns: string[] = [];
    for (const { word, role } of p.roles) {
      if (role.role === 'operand' && role.spec?.assignment) assigns.push(words[word].text.slice(0, words[word].text.indexOf('=')));
      else if (role.role === 'subcommand') visit(outer, role.parse, role.spec, words);
      else if (role.role === 'command') {
        const inner = within(outer, { kind: 'slot', slot: role.slot, via: slotName(p, s, role), at: words[word], assigns });
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
