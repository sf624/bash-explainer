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
//
// The walk is in src/semantics/walk/ (walker.ts and its parts); the state it carries, in src/semantics/shellstate.ts.
import type { Shell } from '../dialect';
import { ancestor, field, type SyntaxNode, type SyntaxTree } from '../syntax/tree';
import { EnvModel, type ExecEnv, MAIN_SHELL, type SlotLink } from './env';
import { NESTED_DEPTH, type NestedScript, type NotRead, scriptSourceIndex, scriptText, slotShell } from './nested';
import type { ShellState } from './shellstate';
import { BLIND, type HostCommands, NO_HOST, scriptTrust, type StringTrees, type Trust, withinTrust } from './trust';
import { type MappedText } from '../staticword';
import { parser, WalkAgain } from './walk/shared';
import { Walker } from './walk/walker';

export {
  attribute, type AliasState, type Attribute, type CommandEntry, defaultOn, type ErrexitWhy, type FunctionState, merge, NameMap, option,
  type OptionState, type ShellState, type Tri, type VariableState,
} from './shellstate';
export { ARITH_ASSIGNED, readDeclaration, type Declaration } from './vars';
export { lastStageInShell } from './env';

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
 * its own shell (`eval`, a trap's action), by root: the walk runs them, so their nodes are in this model. The trust
 * scan reads the same trees (`StringTrees`): each string is parsed once.
 */
export class Scripts implements StringTrees {
  readonly byWord = new Map<SyntaxNode, NestedScript | NotRead>();
  readonly byRoot = new Map<SyntaxNode, NestedScript>();
  /** The text and tree of each string, by its first word (none: not static text); the trees of the texts of `alias`, by word. */
  private readonly parsed = new Map<SyntaxNode, { text: MappedText; tree: SyntaxTree } | undefined>();
  private readonly aliases = new Map<SyntaxNode, SyntaxNode>();
  model!: StateModel;
  constructor(readonly depth: number) {}

  /** The text of the string `words` make, and its tree. */
  private parse(words: readonly SyntaxNode[]): { text: MappedText; tree: SyntaxTree } | undefined {
    if (this.parsed.has(words[0])) return this.parsed.get(words[0]);
    const text = scriptText(words);
    const out = text && { text, tree: parser().parse(text.text) };
    this.parsed.set(words[0], out);
    return out;
  }

  script(words: readonly SyntaxNode[]): SyntaxNode | undefined {
    return this.parse(words)?.tree.root;
  }

  alias(word: SyntaxNode, text: string): SyntaxNode {
    let root = this.aliases.get(word);
    if (!root) {
      this.aliases.set(word, (root = parser().parse(text).root));
    }
    return root;
  }

  /** The string of `words`, read as a script of `kind`, run where `env` says, by the shell `shell` says. */
  read(words: readonly SyntaxNode[], kind: NestedScript['kind'], env: () => ExecEnv, shell: { shell: Shell | undefined; known: boolean }): NestedScript | NotRead {
    const hit = this.byWord.get(words[0]);
    if (hit) return hit;
    let root = words[0];
    while (root.parent) root = root.parent;
    // (A string in a string that this shell runs is one level deeper than that string.)
    const depth = (this.byRoot.get(root)?.depth ?? this.depth) + 1;
    const parsed = this.parse(words);
    let out: NestedScript | NotRead;
    if (!parsed) out = { why: 'not-static' };
    else if (depth > NESTED_DEPTH) out = { why: 'too-deep' };
    else {
      const { text, tree } = parsed;
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

const models = new WeakMap<SyntaxTree, Map<string, StateModel>>();

/**
 * Whether the shebang of the script starts bash in POSIX mode: `#!/bin/bash --posix` (the kernel passes the rest of
 * the line as one argument, so `#!/bin/bash --posix -e` is an error, not POSIX mode), or through `env -S` (env splits
 * it, as one word `-S`): `bash --posix` (bash reads its long options before the others), `bash -o posix`, or
 * `POSIXLY_CORRECT=… bash`.
 */
export function shebangPosix(root: SyntaxNode): boolean {
  const m = /^#![ \t]*(\S+)[ \t]*([^\n]*?)[ \t]*(?:\n|$)/.exec(root.text);
  if (!m) return false;
  const base = (path: string): string => path.slice(path.lastIndexOf('/') + 1);
  if (base(m[1]) === 'bash') return m[2] === '--posix';
  const words = m[2].split(/[ \t]+/);
  if (base(m[1]) !== 'env' || words[0] !== '-S') return false;
  let i = 1;
  let posix = false;
  for (; /^\w+=/.test(words[i] ?? ''); i++) posix ||= words[i].startsWith('POSIXLY_CORRECT=');
  if (base(words[i] ?? '') !== 'bash') return false;
  for (i++; words[i]?.startsWith('--') && words[i] !== '--'; i++) posix ||= words[i] === '--posix';
  // (Then the short options: each `o` of a cluster takes the next word, `-ox posix` too.)
  for (; /^[-+][a-zA-Z]+$/.test(words[i] ?? ''); i++) {
    const cluster = words[i];
    for (const letter of cluster.slice(1)) if (letter === 'o' && words[++i] === 'posix') posix = cluster[0] === '-';
  }
  return posix;
}

/**
 * The shell state along `tree`, for `shell` (bash when absent; `posix`: `bash --posix`, read from the shebang when
 * absent (`shebangPosix`); `host`: the functions the file's host defines, bats' `run`…, which the walk reads by their
 * specs, as builtins: src/semantics/effects.ts). Cached per tree. The tree of a string read as a script
 * (`StateModel.script`) has the model of that script: the outer one for `eval`.
 */
export function shellState(tree: SyntaxTree, shell?: Shell, opts: { posix?: boolean; host?: HostCommands } = {}): StateModel {
  const owner = owners.get(tree);
  if (owner) return owner.model;
  const host = opts.host ?? NO_HOST;
  const names = Object.keys(host);
  const posix = opts.posix ?? ((!shell || shell === 'bash') && shebangPosix(tree.root));
  const key = `${shell ?? 'bash'}${posix ? ' --posix' : ''}${names.length ? ` host:${names.sort().join(' ')}` : ''}`;
  let byKey = models.get(tree);
  if (!byKey) models.set(tree, (byKey = new Map()));
  const hit = byKey.get(key);
  if (hit) return hit;
  const model = buildModel(tree, shell, posix, 0, MAIN_SHELL, (w) => w.initial(tree.root), undefined, host);
  byKey.set(key, model);
  return model;
}

/** What the decisions of each model trust (src/semantics/trust.ts): another shell's model trusts no more than its outer one. */
const modelTrusts = new WeakMap<StateModel, Trust>();

/**
 * The model of `tree`, whose root runs in `base`, from the state `start` gives; `depth` levels of strings deep;
 * `outer`: what the model of the script that starts this shell trusts; `host`: as for `shellState`.
 */
function buildModel(tree: SyntaxTree, shell: Shell | undefined, posix: boolean, depth: number, base: ExecEnv, start: (w: Walker) => ShellState, outer?: Trust, host = NO_HOST): StateModel {
  const scripts = new Scripts(depth);
  const own = scriptTrust(tree.root, scripts, host);
  const trust = outer ? withinTrust(own, outer) : own;
  let w = new Walker(shell, posix, scripts, trust, host);
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
    w = new Walker(shell, posix, scripts, BLIND, host);
    initial = start(w);
    end = w.program(tree.root, initial);
  }
  // (The model's `at` is defined below; the environments ask for it only later.)
  const envs = new EnvModel({
    run: (n) => model.at(n).run, calls: w.calls, shell,
    // (A walk that found a reason to trust nothing on the way trusts no function either.)
    closed: (name) => !found && trust.closed(name),
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
    definitions: { functions: w.functionDefs, aliases: w.aliases.defs },
    sources: w.sources,
    unit(n) {
      let top = n;
      while (top.parent?.parent) top = top.parent;
      return w.unitStart.get(top) ?? top;
    },
    setWrites: (n) => w.setWrites.get(n) ?? new Map(),
    writes: (n) => w.varWrites.get(n) ?? new Set(),
    condition: (n) => w.conditions.decision(n),
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
