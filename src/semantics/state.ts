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
import type { BashVersion } from '../bashversion';
import type { Shell } from '../dialect';
import { ancestor, field, type SyntaxNode, type SyntaxTree } from '../syntax/tree';
import { SET_LETTERS } from './effects';
import { EnvModel, type ExecEnv, fileRead, type FileRead, MAIN_SHELL, type SlotLink } from './env';
import { NESTED_DEPTH, type NestedScript, type NotRead, scriptSourceIndex, scriptText, slotShell } from './nested';
import type { ShellState } from './shellstate';
import { childOpening, HARMLESS_START, type Opening, openingBlinds } from './opening';
import { BLIND, type HostCommands, NO_HOST, scriptTrust, type StringTrees, type Trust, withinTrust } from './trust';
import { type MappedText, staticWordValue } from '../staticword';
import { parser, WalkAgain } from './walk/shared';
import { type HostCall, type HostRun, hostRunKey } from './walk/host';
import { Walker } from './walk/walker';
import { childStart } from './walk/child';

export {
  attribute, type AliasState, type Attribute, type CommandEntry, defaultOn, type ErrexitWhy, type FunctionState, merge, NameMap, option,
  type OptionState, type ShellState, shoptIn, type Tri, type VariableState,
} from './shellstate';
export { ARITH_ASSIGNED, type Declaration } from './vars';
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
  /** The shell the model is of (bash when absent). */
  readonly shell: Shell | undefined;
  /**
   * How the file is read (src/semantics/env.ts, `fileRead`; `readAs` for a node): run as a script, typed into a
   * terminal, or not known. The model of a string another shell runs has its file's.
   */
  readonly read: FileRead;
  /**
   * Whether the host gives the script the variable `name` (`ShellRegion.provided`, and its placeholders): read by
   * `fromEnvironment` as one the environment has. None outside a host file.
   */
  provides(name: string): boolean;
  /**
   * Whether what the model says of the variable `name` may be relied on (src/semantics/trust.ts): every command that
   * may write it is one the walk reads, and nothing makes the model blind.
   */
  trusts(name: string): boolean;
  /** The variables some command of the script sets, wherever it runs. */
  readonly assigned: ReadonlySet<string>;
  /** Where `n` runs (src/semantics/env.ts): the main shell, a subshell, or a command run through slots. */
  env(n: SyntaxNode): ExecEnv;
  /**
   * The commands that call each function definition (those its state reaches; through an alias, `eval` or a trap,
   * the command that runs it), and whether the function is surely defined there.
   */
  readonly calls: ReadonlyMap<SyntaxNode, ReadonlyMap<SyntaxNode, boolean>>;
  /** The function definitions the host calls once the script has run (bats' tests and hooks), and how (src/semantics/walk/host.ts). */
  readonly hostCalls: ReadonlyMap<SyntaxNode, HostCall>;
  /** The commands of the script that define each function and alias, in source order, wherever they run. */
  readonly definitions: { readonly functions: ReadonlyMap<string, readonly SyntaxNode[]>; readonly aliases: ReadonlyMap<string, readonly SyntaxNode[]> };
  /** The options a `set` command turns on or off (`set -e`: errexit on), on any walk; empty for another node. */
  setWrites(n: SyntaxNode): ReadonlyMap<string, 'on' | 'off'>;
  /** The variables the statement `n` sets itself, on any walk (`n=1`, `read n`, `((n++))`, `printf -v n`); not those of the statements inside it. */
  writes(n: SyntaxNode): ReadonlySet<string>;
  /**
   * Whether the statement around `n` sets `name` only as a local of the function that runs it, on every walk that sets
   * it (`local RANDOM=3`, or `RANDOM=3` and `unset RANDOM` after it): a local of bash's own variables is a plain one.
   */
  local(n: SyntaxNode, name: string): boolean;
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
  /** Whether every call of the function `name` is one the walk sees (src/semantics/trust.ts), so its body's states are those of its calls. */
  closed(name: string): boolean;
  /**
   * Whether the statement `n` runs only in code that never runs here: a branch whose condition is decided, or after
   * `break`, `continue`, `return` or `exit`.
   */
  dead(n: SyntaxNode): boolean;
  /**
   * Whether what the walks found at `n` holds wherever `n` runs (the walk's `everywhere`): not when nothing is
   * trusted, in a function body that may run where the walk does not see it, in one not walked at some call, in a
   * loop whose passes did not settle, nor in a trap's action. The values shown in Meaning ask it
   * (src/semantics/values.ts, `expansionValue`).
   */
  settled(n: SyntaxNode): boolean;
  /** What the `${| …; }` `n` gives (bash 5.3: its `REPLY` at the end), when every walk of it gives the same known text. */
  reply(n: SyntaxNode): string | undefined;
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

/** Whether `n` is in a string another shell runs (`bash -c S`, also through the strings around it), which has a model of its own. */
export function inAnotherShell(n: SyntaxNode): boolean {
  for (let s = rootOwners.get(rootOf(n)); s; s = rootOwners.get(rootOf(s.words[0]))) if (s.kind === 'child') return true;
  return false;
}

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
/** The root of the document `n` is in: of the script, also for a node of a string read as a script (4.13). */
export function documentRoot(n: SyntaxNode): SyntaxNode {
  let root = rootOf(n);
  for (let s = rootOwners.get(root); s; s = rootOwners.get(root)) root = rootOf(s.words[0]);
  return root;
}

/** The line (from 0) of the document where `n` starts. */
export function docLine(n: SyntaxNode): number {
  const root = documentRoot(n);
  let starts = lineStarts.get(root);
  if (!starts) {
    starts = [];
    for (let i = root.text.indexOf('\n'); i >= 0; i = root.text.indexOf('\n', i + 1)) starts.push(i);
    lineStarts.set(root, starts);
  }
  // (The root's text starts at its first statement: after blank lines, or the lines of a host file around its shell code.)
  const i = docIndex(n) - root.startIndex;
  let lo = 0;
  let hi = starts.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (starts[mid] < i) lo = mid + 1;
    else hi = mid;
  }
  return lo + root.startPosition.row;
}

/**
 * How many trees of aliases expanded at commands a model makes, one per command (`Scripts.expansion`): each alias
 * whose text names another doubles them at each command that names it, and each tree is kept.
 */
export const ALIAS_TREES = 20_000;

/** How many times a script is walked again for its recursive functions (`Walker.short`), before nothing is trusted. */
const REWALKS = 4;

/**
 * The strings a model reads as scripts (`StateModel.script`), by their first word, and the trees of those that run in
 * its own shell (`eval`, a trap's action), by root: the walk runs them, so their nodes are in this model. Also the trees
 * of the aliases the walk expands (an alias's text with the rest of a command). The trust scan reads the same trees
 * (`StringTrees`): each string is parsed once.
 */
export class Scripts implements StringTrees {
  readonly byWord = new Map<SyntaxNode, NestedScript | NotRead>();
  readonly byRoot = new Map<SyntaxNode, NestedScript>();
  /** The text and tree of each string, by its first word (none: not static text); the trees of the texts of `alias`, by word. */
  private readonly parsed = new Map<SyntaxNode, { text: MappedText; tree: SyntaxTree } | undefined>();
  private readonly aliases = new Map<SyntaxNode, SyntaxNode>();
  /** The trees of the aliases expanded at each command, by the command and the alias's text. */
  private readonly expansions = new Map<SyntaxNode, Map<string, SyntaxNode>>();
  private expansionCount = 0;
  /** Past `ALIAS_TREES`, one tree per text (the alias's with the rest of the command), whatever the command. */
  private readonly shared = new Map<string, SyntaxNode>();
  capped = false;
  model!: StateModel;
  constructor(readonly depth: number, private readonly shell: Shell | undefined) {}

  /** The text of the string `words` make, and its tree. */
  private parse(words: readonly SyntaxNode[]): { text: MappedText; tree: SyntaxTree } | undefined {
    if (this.parsed.has(words[0])) return this.parsed.get(words[0]);
    const text = scriptText(words, this.shell);
    const out = text && { text, tree: parser().parse(text.text) };
    this.parsed.set(words[0], out);
    return out;
  }

  script(words: readonly SyntaxNode[]): SyntaxNode | undefined {
    return this.parse(words)?.tree.root;
  }

  alias(word: SyntaxNode, text: string): SyntaxNode {
    let root = this.aliases.get(word);
    if (!root) this.aliases.set(word, (root = parser().parse(text).root));
    return root;
  }

  expansion(command: SyntaxNode, text: string): SyntaxNode {
    let byText = this.expansions.get(command);
    if (!byText) this.expansions.set(command, (byText = new Map()));
    let root = byText.get(text);
    if (!root) {
      // (The rest of the command: what follows its name, read with the alias's text, as bash reads it.)
      const full = text + command.text.slice(field(command, 'name')!.endIndex - command.startIndex);
      if (this.expansionCount >= ALIAS_TREES) {
        // (The walk still runs what the alias does, in a tree it shares with the other commands of the same text;
        // the trust scan, which tells the trees apart, trusts nothing then.)
        this.capped = true;
        root = this.shared.get(full);
        if (!root) this.shared.set(full, (root = parser().parse(full).root));
        return root;
      }
      this.expansionCount++;
      byText.set(text, (root = parser().parse(full).root));
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
  // (What the shell is started with goes through the allow-list of the trust: `bash -O compat31 -c`, `BASH_COMPAT=31
  // bash -c`. A row of `all` walks it again with nothing trusted.)
  // (The values given, where they are static text: `LC_ALL=C bash -c`, `env LC_ALL=C bash -c`; not the words after the
  // string, its positional parameters.)
  const values = new Map<string, string | undefined>();
  for (const c of cmd.namedChildren) {
    if (c.type === 'variable_assignment') {
      const value = field(c, 'value');
      values.set(field(c, 'name')!.text, value ? staticWordValue(value) : '');
      continue;
    }
    const m = c.startIndex < first.startIndex ? /^([A-Za-z_]\w*)=(.*)$/s.exec(staticWordValue(c) ?? '') : null;
    if (m) values.set(m[1], m[2]);
  }
  const start = (w: Walker): ShellState => {
    let st = childStart(w, outer, script.env, pass, first);
    // (An interactive shell, `bash -i -c`, expands aliases.)
    if (w.bash && pass.invocation.some((f) => f.flag === '-i')) st = { ...st, shopt: st.shopt.with('expand_aliases', 'on') };
    // (SHELLOPTS and BASHOPTS not given are bash's own: an exported one passes options the outer model has read.)
    const vars = [...st.variables].filter(([name]) => given.has(name) || !['SHELLOPTS', 'BASHOPTS'].includes(name))
      .map(([name, v]) => [name, given.has(name) ? { set: 'on', value: values.get(name) } : v] as const)
      // (`env -S`'s or `docker run --env-file`'s names not known: `*`.)
      .concat(given.has('*') ? [['*', { set: 'on', value: undefined }] as const] : []);
    const why = w.blind ? undefined : openingBlinds(childOpening(pass.invocation, vars, st.set.get('posix') === 'on'));
    return why ? w.walkAgain(why) : st;
  };
  return buildModel(script.tree, script.shell, false, script.depth, script.env, start, script.outer, modelTrusts.get(script.outer), undefined, undefined, undefined, modelVersions.get(script.outer));
}

const models = new WeakMap<SyntaxTree, Map<string, StateModel>>();

/**
 * What the shebang of a script gives the shell it starts: POSIX mode, the `set` options of its letters (`-eu`), and
 * through `env -S`, `shopt` options (`-O extglob`), those SHELLOPTS and BASHOPTS list, and the other variables it
 * assigns (`BASH_COMPAT=42 bash`); `others`, what else it gives that the allow-list does not have (`-r`, `--login`,
 * an `env -S` line not read in full).
 */
interface ShebangStart { posix: boolean; set: Map<string, 'on' | 'off'>; shopt: Map<string, 'on' | 'off'>; variables: Map<string, string>; others: string[] }

/**
 * What the shebang starts bash with: the kernel passes the rest of the line as one argument, so `#!/bin/bash -eu`
 * turns on `errexit` and `nounset`, `#!/bin/bash --posix` is POSIX mode, and `#!/bin/bash --posix -e` is an error,
 * not POSIX mode. Through `env -S` (env splits it, as one word `-S`): `bash --posix` (bash reads its long options
 * before the others), `bash -o posix`, `POSIXLY_CORRECT=… bash`, the letters and `-o` names of `set` (`-e -u`,
 * `-o nounset`), the `-O` names of `shopt`, and the other variables assigned (`BASH_COMPAT=42 bash`). Undefined when
 * the shebang does not start bash.
 */
function shebangStart(root: SyntaxNode): ShebangStart | undefined {
  const m = /^#![ \t]*(\S+)[ \t]*([^\n]*?)[ \t]*(?:\n|$)/.exec(root.text);
  if (!m) return undefined;
  const base = (path: string): string => path.slice(path.lastIndexOf('/') + 1);
  const start: ShebangStart = { posix: false, set: new Map(), shopt: new Map(), variables: new Map(), others: [] };
  const letters = (cluster: string): void => {
    for (const letter of cluster.slice(1)) {
      if (SET_LETTERS[letter]) start.set.set(SET_LETTERS[letter], cluster[0] === '-' ? 'on' : 'off');
      else if (letter !== 'o' && letter !== 'O') start.others.push(`${cluster[0]}${letter}`);
    }
  };
  // (A long option: POSIX mode, one that changes nothing here, or one the table does not have: `--debugger`.)
  const long = (option: string): void => {
    if (option === '--posix') start.posix = true;
    else if (!HARMLESS_START.has(option)) start.others.push(option);
  };
  if (base(m[1]) === 'bash') {
    // (Not when bash refuses them: then no option is on, run directly or by `bash script`.)
    if (!m[2] || shebangRefused(root.text)) return start;
    if (/^[-+][a-zA-Z]+$/.test(m[2])) letters(m[2]);
    else if (m[2].startsWith('-')) long(m[2]);
    else start.others.push(m[2]);
    return start;
  }
  const words = m[2].split(/[ \t]+/);
  if (base(m[1]) !== 'env') return undefined;
  // (`env -S` with options of its own, or joined to its value: `-S -u LANG bash`, `-Sbash`.)
  if (words[0] !== '-S') return /^-[^-]*S/.test(words[0]) ? { ...start, others: [m[2]] } : undefined;
  let i = 1;
  for (; /^\w+=/.test(words[i] ?? ''); i++) {
    const at = words[i].indexOf('=');
    const [name, value] = [words[i].slice(0, at), words[i].slice(at + 1)];
    // (bash turns on the options SHELLOPTS and BASHOPTS list when it starts.)
    if (name === 'POSIXLY_CORRECT') start.posix = true;
    else if (name === 'SHELLOPTS') for (const o of value.split(':').filter(Boolean)) o === 'posix' ? (start.posix = true) : start.set.set(o, 'on');
    else if (name === 'BASHOPTS') for (const o of value.split(':').filter(Boolean)) start.shopt.set(o, 'on');
    else start.variables.set(name, value);
  }
  if (words[i]?.startsWith('-')) return { ...start, others: [m[2]] };
  if (base(words[i] ?? '') !== 'bash') return undefined;
  for (i++; words[i]?.startsWith('--') && words[i] !== '--'; i++) long(words[i]);
  // (Then the short options: each `o` or `O` of a cluster takes the next word, `-ox posix` too.)
  for (; /^[-+][a-zA-Z]+$/.test(words[i] ?? ''); i++) {
    const cluster = words[i];
    letters(cluster);
    for (const letter of cluster.slice(1)) {
      if (letter !== 'o' && letter !== 'O') continue;
      const name = words[++i];
      const state = cluster[0] === '-' ? 'on' : 'off';
      if (name === undefined) start.others.push(cluster);
      else if (letter === 'O') start.shopt.set(name, state);
      else if (name === 'posix') start.posix = state === 'on';
      else start.set.set(name, state);
    }
  }
  // (A word left, before the script's path: bash reads it as the script.)
  if (words[i] !== undefined) start.others.push(words[i]);
  return start;
}

/** The letters bash takes as options when it starts (`set`'s, and `-c`, `-i`, `-l`, `-r`, `-s`, `-D`, `-o`, `-O`). */
const BASH_LETTERS = /^[abefhkmnprtuvxBCDEHPTcilsoO]$/;

/** Why bash refuses the options of a shebang (`shebangRefused`). */
export type ShebangRefusal = { rest: string; why: 'blank' | 'name' | 'shopt' | 'long' } | { rest: string; why: 'letter'; letter: string };

/**
 * The options of a shebang that bash refuses, so that the script never starts when it is run directly: the kernel
 * passes the rest of the line as one argument, which bash reads as one run of letters, left to right. A blank in it
 * is no option (`#!/bin/bash -e -u`: "- : invalid option"), nor is a letter bash does not know (`-Oextglob`: "-g:
 * invalid option"); `o` takes the next argument, the script's path, as an option name at once (`#!/bin/bash -eo`,
 * `-o nounset`: "invalid option name"), and `O` as a shopt name once the letters are read (`-O`, `-Oe`: "invalid
 * shell option name"); `--posix -e` is no long option bash knows. Undefined when bash takes the shebang's options (or
 * the shebang does not start bash directly).
 */
export function shebangRefused(text: string): ShebangRefusal | undefined {
  const m = /^#![ \t]*(\S+)[ \t]+([-+][^\n]*?)[ \t]*(?:\n|$)/.exec(text);
  if (!m || m[1].slice(m[1].lastIndexOf('/') + 1) !== 'bash') return undefined;
  const rest = m[2];
  if (rest.startsWith('--')) return /[ \t]/.test(rest) ? { rest, why: 'long' } : undefined;
  for (const letter of rest.slice(1)) {
    if (letter === 'o') return { rest, why: 'name' };
    if (!BASH_LETTERS.test(letter)) return /[ \t]/.test(letter) ? { rest, why: 'blank' } : { rest, why: 'letter', letter };
  }
  return rest.includes('O') ? { rest, why: 'shopt' } : undefined;
}

/** Whether the shebang of the script starts bash in POSIX mode (`shebangStart`). */
export function shebangPosix(root: SyntaxNode): boolean {
  return shebangStart(root)?.posix ?? false;
}

/**
 * The shell state along `tree`, for `shell` (bash when absent; `posix`: `bash --posix`, read from the shebang when
 * absent (`shebangPosix`); `host`: the functions the file's host defines, bats' `run`…, which the walk reads by their
 * specs, as builtins: src/semantics/effects.ts; `run`: what the host runs of the script, bats' tests, src/semantics/walk/
 * host.ts, whose options replace the shebang's; `read`: how the file is read, `fileRead`, from its shebang when absent:
 * bash expands aliases when it is typed into a terminal, and may when a file with no shebang may be `.bashrc`). Cached per tree. The tree of a string read as a script
 * (`StateModel.script`) has the model of that script: the outer one for `eval`.
 */
export function shellState(tree: SyntaxTree, shell?: Shell, opts: { posix?: boolean; host?: HostCommands; run?: HostRun; version?: BashVersion; read?: FileRead; provided?: readonly string[] } = {}): StateModel {
  const owner = owners.get(tree);
  if (owner) return owner.model;
  const host = opts.host ?? NO_HOST;
  const names = Object.keys(host);
  const run = opts.run;
  const read = opts.read ?? fileRead(tree.root);
  const posix = opts.posix ?? ((!shell || shell === 'bash') && !run && shebangPosix(tree.root));
  const key = `${shell ?? 'bash'}${posix ? ' --posix' : ''}${names.length ? ` host:${names.sort().join(' ')}` : ''}${run ? hostRunKey(run) : ''}${opts.version === '5.3' ? ' 5.3' : ''} ${read}${opts.provided?.length ? ` given:${[...opts.provided].sort().join(' ')}` : ''}`;
  let byKey = models.get(tree);
  if (!byKey) models.set(tree, (byKey = new Map()));
  const hit = byKey.get(key);
  if (hit) return hit;
  // (The `set` and `shopt` options of the shebang, `#!/bin/bash -eu`, when the script is bash's; what it starts bash
  // with goes through the allow-list of the trust, `Opening`.)
  const shebang = run || (shell && shell !== 'bash') ? undefined : shebangStart(tree.root);
  const set = run ? new Map(run.set.map((o) => [o, 'on' as const])) : shebang?.set;
  const shopt = shebang?.shopt;
  // (An interactive shell expands aliases: one that commands are typed into, and maybe one that reads a file with no
  // shebang, `.bashrc`. bash only: the other shells always expand them.)
  const aliases = (!shell || shell === 'bash') && !posix && read !== 'script' ? new Map([['expand_aliases', read === 'terminal' ? 'on' as const : 'unknown' as const]]) : undefined;
  const start = (w: Walker): ShellState => {
    let st = w.initial(tree.root);
    if (aliases) st = { ...st, shopt: st.shopt.withAll(aliases) };
    return { ...st, ...(set?.size ? { set: st.set.withAll(set) } : {}), ...(shopt?.size ? { shopt: st.shopt.withAll(shopt) } : {}) };
  };
  const model = buildModel(tree, shell, posix, 0, MAIN_SHELL, start, { read, provides: provider(opts.provided ?? []) }, undefined, host, run, { set, shopt, variables: shebang?.variables, others: shebang?.others }, opts.version);
  byKey.set(key, model);
  return model;
}

/** Whether a name is among `names`, or starts one of them that ends in `*` (`StateModel.provides`). */
function provider(names: readonly string[]): (name: string) => boolean {
  const exact = new Set(names.filter((n) => !n.endsWith('*')));
  const prefixes = names.filter((n) => n.endsWith('*')).map((n) => n.slice(0, -1));
  return (name) => exact.has(name) || prefixes.some((x) => name.startsWith(x));
}

/** What the decisions of each model trust (src/semantics/trust.ts): another shell's model trusts no more than its outer one. */
const modelTrusts = new WeakMap<StateModel, Trust>();
/** The bash release each model is of (another bash it starts is of the same one). */
const modelVersions = new WeakMap<StateModel, BashVersion | undefined>();

/**
 * The model of `tree`, whose root runs in `base`, from the state `start` gives; `depth` levels of strings deep;
 * `outer`: what the model of the script that starts this shell trusts; `host`: as for `shellState`; `opening`: what the
 * shebang starts it with.
 */
function buildModel(tree: SyntaxTree, shell: Shell | undefined, posix: boolean, depth: number, base: ExecEnv, start: (w: Walker) => ShellState, file: Pick<StateModel, 'read' | 'provides'>, outer?: Trust, host = NO_HOST, run?: HostRun, opening?: Opening, version?: BashVersion): StateModel {
  const scripts = new Scripts(depth, shell);
  const own = scriptTrust(tree.root, scripts, host, opening, shell, version);
  const trust = outer ? withinTrust(own, outer) : own;
  let w = new Walker(shell, posix, scripts, trust, host, run);
  let initial!: ShellState;
  let end!: ShellState;
  try {
    initial = start(w);
    end = w.program(tree.root, initial);
  } catch (e) {
    /* c8 ignore next -- only `WalkAgain` is thrown out of a walk on purpose */
    if (!(e instanceof WalkAgain)) throw e;
  }
  // (A call not walked took less as changed than its body changes: walked again, with what each body changes. Each
  // walk again finds more; past `REWALKS`, nothing is trusted.)
  for (let round = 0; !w.found && w.short; round++) {
    /* c8 ignore start -- a guard on the cost: each walk again adds what the one before found, and none in the tests needs more than one */
    if (round === REWALKS) {
      w.found = 'a recursive function changes more than its walk follows';
      break;
    }
    /* c8 ignore stop */
    w = new Walker(shell, posix, scripts, trust, host, run, w);
    try {
      initial = start(w);
      end = w.program(tree.root, initial);
    } catch (e) {
      /* c8 ignore next -- only `WalkAgain` is thrown out of a walk on purpose */
      if (!(e instanceof WalkAgain)) throw e;
    }
  }
  // (Arithmetic read text not known on the way, or a string the walk does not read: walked again, with nothing trusted.)
  const found = w.found;
  if (found) {
    w = new Walker(shell, posix, scripts, BLIND, host, run);
    initial = start(w);
    end = w.program(tree.root, initial);
  }
  // (A walk that found a reason to trust nothing on the way trusts no function either.)
  const closed = (name: string): boolean => !found && trust.closed(name);
  // (The model's `at` is defined below; the environments ask for it only later.)
  const envs = new EnvModel({
    run: (n) => model.at(n).run, calls: w.calls, hostCalls: w.hostCalls, shell,
    closed,
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
    shell,
    read: file.read,
    provides: file.provides,
    trusts: (name) => !found && trust.variable(name),
    blind: found ?? trust.blind,
    closed,
    env: (n) => envs.at(n),
    calls: w.calls,
    hostCalls: w.hostCalls,
    assigned: new Set([...w.lastChange.keys()].filter((k) => k.startsWith('variables ')).map((k) => k.slice('variables '.length))),
    definitions: { functions: w.functionDefs, aliases: w.aliases.defs },
    sources: w.sources,
    unit(n) {
      let top = n;
      while (top.parent?.parent) top = top.parent;
      return w.unitStart.get(top) ?? top;
    },
    setWrites: (n) => w.setWrites.get(n) ?? new Map(),
    writes: (n) => w.varWrites.shell.get(n) ?? new Set(),
    local(n, name) {
      for (let x: SyntaxNode | null = n; x; x = x.parent) {
        const local = w.varWrites.local.get(x)?.has(name);
        const shell = w.varWrites.shell.get(x)?.has(name);
        if (local || shell) return !shell;
      }
      return false;
    },
    condition: (n) => w.conditions.decision(n),
    dead: (n) => w.runAt(n) !== undefined && !w.live.has(n) && w.everywhere(n),
    settled: (n) => w.everywhere(n),
    reply(n) {
      // (None for one the walk did not run.)
      const all = w.expansions.replies.get(n) ?? [];
      return all.every((v) => v === all[0]) ? all[0] : undefined;
    },
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
  modelVersions.set(model, version);
  return model;
}
