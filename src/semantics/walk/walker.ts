// The walk of the shell state (docs/design/semantics.md, 4.3, 4.7, B1; src/semantics/state.ts builds the model from it):
// the statements in the order bash runs them, the branches and loops merged, function bodies walked where they are
// called. Its parts: arithmetic (./arith.ts), conditions (./conditions.ts), builtins (./builtins.ts), aliases (./aliases.ts),
// expansions (./expansions.ts), the state another shell starts with (./child.ts).
import type { ArgvParse } from '../../argv/interpret';
import type { Ends } from '../../argv/spec';
import type { Shell } from '../../dialect';
import { builtins } from '../../dict/builtins';
import { staticWordValue } from '../../staticword';
import { assignmentsOnly, descendants, field, fields, prefixAssignments, redirectionsOf, type SyntaxNode } from '../../syntax/tree';
import { commandName } from '../effects';
import { lastStageInShell, slotEnvs, STATEMENTS, subshellReasons } from '../env';
import { NESTED_DEPTH, type NestedScript, type NotRead } from '../nested';
import {
  attribute, EMPTY, type Entry, type FunctionState, type Kind, environmentHas, merge, NameMap, option,
  POSIX_ON, reached, type ShellState, sameState, tri, type Tri, unreachable, type VariableState, withStatus,
} from '../shellstate';
import type { Scripts } from '../state';
import { type HostCommands, NO_HOST, type Trust } from '../trust';
import { alwaysNumeric, changedByBash, EXPORTED_AT_START, INTEGERS_AT_START, READONLY_AT_START } from '../vars';
import { WalkAliases } from './aliases';
import { WalkArith } from './arith';
import { temporariesUnset } from '../names';
import { WalkBuiltins } from './builtins';
import { WalkConditions } from './conditions';
import { WalkExpansions } from './expansions';
import { kept, temporaries } from './temporaries';
import { type HostCall, hostRun, type HostRun } from './host';
import { ATTRS, attributesChange, notWalked, unsettledBodies, widen } from './widen';
import { changesWords, ExpansionError, type Frame, OPAQUE, type Statement, type Target, WalkAgain } from './shared';

export type { ChildPass, Frame, Target } from './shared';

/** The shells that start in POSIX mode (for what the model follows: assignments before special builtins). */
const POSIX_SHELLS = new Set<Shell>(['sh', 'dash', 'ash', 'yash', 'ksh', 'mksh']);
/** The statements whose failure stops the shell under `set -e` (a compound command stops in the command that fails). */
const ERREXIT_STOPS = new Set(['command', 'extended_test', 'arithmetic_command', 'subshell', 'pipeline']);

const rootOf = (n: SyntaxNode): SyntaxNode => {
  let r = n;
  while (r.parent) r = r.parent;
  return r;
};

/** How many times a function body is walked with different states before the rest of its calls are guessed. */
const WALKS_PER_FUNCTION = 4;
/** How deep calls are followed (deeper ones are guessed). */
const CALL_DEPTH = 64;

/**
 * Whether the assignment before a command name makes a variable for it: not one to an element (`n[0]=5 f`), which
 * bash refuses ("not a valid identifier") before it runs the command, assigning nothing.
 */
const temporary = (a: SyntaxNode): boolean => field(a, 'name')!.type !== 'subscript';

/** The walk of a tree (`program`), with its parts. */
export class Walker {
  readonly arith = new WalkArith(this);
  readonly conditions = new WalkConditions(this);
  readonly builtins = new WalkBuiltins(this);
  readonly aliases = new WalkAliases(this);
  readonly expansions = new WalkExpansions(this);

  /** The states each node was run with (more than one in a loop or a function called more than once); merged when asked. */
  private readonly runStates = new Map<SyntaxNode, ShellState[]>();
  /** The `set` commands, with the options they turn on or off (on any walk). */
  readonly setWrites = new Map<SyntaxNode, Map<string, 'on' | 'off'>>();
  /** The variables each statement sets itself (on any walk), not those of the statements inside it: the shell's own, and the locals of a function being run (`local RANDOM=3`, or `RANDOM=3` after it), gone when it returns. */
  readonly varWrites = { shell: new Map<SyntaxNode, Set<string>>(), local: new Map<SyntaxNode, Set<string>>() };
  readonly parseAt = new Map<SyntaxNode, ShellState>();
  readonly functionDefs = new Map<string, SyntaxNode[]>();
  /** The commands that call each function definition, and whether it is surely defined there on every walk. */
  readonly calls = new Map<SyntaxNode, Map<SyntaxNode, boolean>>();
  /** The functions the host calls once the script has run (./host.ts), and how. */
  readonly hostCalls = new Map<SyntaxNode, HostCall>();
  /** The `source` and `.` commands run. */
  readonly sources: SyntaxNode[] = [];
  /** The first top-level statement of the unit of each top-level statement. */
  readonly unitStart = new Map<SyntaxNode, SyntaxNode>();
  /**
   * The functions surely defined once the script has run its top level: defined by a top-level statement of the
   * main shell (not in a branch, a subshell or a function), and never named by `unset`. A body that runs later
   * (no call reaches it, a trap's action) has them.
   */
  readonly sureLater = new Map<string, SyntaxNode>();
  /** The actions of `trap`, run after the top level (an EXIT trap with its state at the end). */
  readonly traps: { script: NestedScript; host: SyntaxNode; st: ShellState; since: number; exit: boolean; exitOnly: boolean; dead: boolean }[] = [];
  /** The command whose alias, `eval` string or trap action is being run (its nodes are in their own tree). */
  aliasHost: SyntaxNode | undefined;
  /** The walks of each function body: the state it was called with, and the state after it. */
  private readonly walks = new Map<SyntaxNode, { entry: ShellState; exit: ShellState; how: string; aborts: ShellState[]; maybes: ShellState[]; changed: ReadonlySet<string> }[]>();
  /** What the walks of each function body changed (from the start: what an earlier walk of the script found, `seed`'s). */
  readonly changes = new Map<SyntaxNode, Set<string>>();
  /**
   * The calls not walked (recursive, too deep, past `WALKS_PER_FUNCTION`), each with how many changes of the body it
   * took as unknown: a body that changes more by the end of the walk (`x=2` after the recursive call of
   * `g() { …; g; return; fi; x=2; }`) makes the walk short (`short`).
   */
  readonly widened: { def: SyntaxNode; size: number }[] = [];
  /** The state each body being walked started with, and the one to walk it again from (see `recurse`). */
  private readonly bodyEntries = new Map<SyntaxNode, ShellState>();
  private readonly recursed = new Map<SyntaxNode, ShellState>();
  /** The bodies being walked (a call of one of these is recursive). */
  private readonly stack: SyntaxNode[] = [];
  readonly frames: Frame[] = [];
  /** The changes (`kind name`): how many so far, the number of the last change of each name and the node that made it, and the count at each definition. */
  changeCount = 0;
  readonly lastChange = new Map<string, number>();
  readonly lastAt = new Map<string, SyntaxNode>();
  private readonly changeAtDefinition = new Map<SyntaxNode, number>();
  /** The sets of the bodies being walked, which collect what they change. */
  readonly collecting: Set<string>[] = [];
  /** The `break` and `continue` the `${ …; }` of the statement being run made (see `Target`). */
  statement: Statement = { deferred: [] };
  /** The statement being run, and the state its aliases come from. */
  node: SyntaxNode | undefined;
  expand: ShellState = EMPTY;

  readonly bash: boolean;
  /**
   * The modes of the walk, each as how deep it is in it: `dead`, in code that does not run here (a branch whose
   * condition is decided: see `deadRun`), where it records no decision; `quiet`, where `set -e` does not stop the shell
   * (a condition, the left side of `&&`, `!`). A walk of a function body made in some modes is reused only in the same
   * (`reuseKey`).
   */
  readonly mode = { dead: 0, quiet: 0 };
  /** The nodes run on some walk that is not in dead code. */
  readonly live = new Set<SyntaxNode>();

  /**
   * The function definitions whose body a call did not walk (more entry states than `WALKS_PER_FUNCTION`, a recursive
   * or too deep call) and the loops whose passes did not settle: the conditions in them are not decided.
   */
  private readonly unwalked = new Set<SyntaxNode>();
  /**
   * The function bodies called from a place where what the walks found may not hold (`g` in
   * `rc() { …; rc; return; fi; g; }`: the recursive call, not walked, runs `g`): see `everywhere`.
   */
  private unsettled: ReadonlySet<SyntaxNode> | undefined;
  /** Whether the expression being run has read a name the script has not set, taken as unset (see `variableText`). */
  assumed = false;
  /** Where jumps go (see `Target`). */
  readonly targets: Target[] = [];
  /** Nothing is trusted (src/semantics/trust.ts): no condition is decided, and every jump may be made or not. */
  readonly blind: boolean;
  /**
   * Why nothing should be trusted, found on the way: arithmetic read a variable that no path has set (its value may
   * come from the environment, as text bash runs, which may assign anything). The script is then walked again, blind.
   */
  found: string | undefined;

  /** Sets `found`, and stops the walk (`WalkAgain`): it is made again, with nothing trusted. */
  walkAgain(why: string): never {
    this.found = why;
    throw new WalkAgain();
  }

  /** The names the actions of the traps set so far change (not EXIT's): a signal may run them between any two later statements. */
  readonly trapKeys = new Set<string>();
  /**
   * Set while a trap's action is walked only for what it changes (`trap`): its nodes, the calls and the walks of the
   * bodies it calls are not recorded (the action runs later, with the state of then).
   */
  silent = 0;
  /** Set while what `put` gives is only worked out, not a change of the walk (`temporaries`). */
  scratch = 0;
  /** Set while a body no call reached is walked (`uncalled`). */
  private outside = 0;

  constructor(readonly shell: Shell | undefined, readonly posix: boolean, readonly scripts: Scripts, readonly trust: Trust,
    readonly host: HostCommands = NO_HOST, readonly hosted?: HostRun, seed?: Walker) {
    this.bash = !shell || shell === 'bash';
    this.blind = trust.blind !== undefined;
    // (With the nodes of those changes, for a call widened before the walk makes them.)
    for (const [def, keys] of seed?.changes ?? []) this.changes.set(def, new Set(keys));
    for (const [key, at] of seed?.lastAt ?? []) this.lastAt.set(key, at);
  }

  /**
   * Whether a call not walked took fewer changes of its body as unknown than the body makes: then the script is
   * walked again, with what this walk found each body changes (`seed`).
   */
  get short(): boolean {
    return this.widened.some((w) => this.changes.get(w.def)!.size > w.size);
  }

  put<K extends Kind>(st: ShellState, kind: K, name: string, value: Entry<K> | undefined): ShellState {
    const key = `${kind} ${name}`;
    // (Not a change while the temporaries of a command are worked out: src/semantics/walk/temporaries.ts.)
    if (this.scratch) return { ...st, [kind]: (st[kind] as NameMap<Entry<K>>).with(name, value) };
    // (A change of attributes is a change of its own, `attrs name`: what `widen` takes as unknown where it is made.)
    for (const k of kind === 'variables' && attributesChange(st.variables.get(name), value as VariableState | undefined) ? [key, `${ATTRS}${name}`] : [key]) {
      this.lastChange.set(k, ++this.changeCount);
      this.lastAt.set(k, this.node!);
      for (const c of this.collecting) c.add(k);
    }
    const writes = kind === 'variables' ? this.varWrites[this.frames.some((f) => f.saved.has(name)) ? 'local' : 'shell'] : undefined;
    writes?.set(this.node!, (writes.get(this.node!) ?? new Set<string>()).add(name));
    return { ...st, [kind]: (st[kind] as NameMap<Entry<K>>).with(name, value) };
  }

  record(n: SyntaxNode, st: ShellState): void {
    if (this.silent) return;
    if (!this.mode.dead) this.live.add(n);
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

  /**
   * The state a shell starts with, as set at `at` (the root): bash's own integers (`OPTIND`, `RANDOM`…: what the script
   * assigns them is arithmetic, `OPTIND='x=5'` sets x) and readonly ones (`UID`); in POSIX mode, its options and
   * POSIXLY_CORRECT (`bash --posix` sets it to `y`).
   */
  initial(at: SyntaxNode): ShellState {
    let st = EMPTY;
    if (this.bash) {
      const attrs = { i: { state: 'on' as const, at } };
      st = { ...st, variables: st.variables.withAll(new Map(INTEGERS_AT_START.map((name) => [name, { declared: 'on', set: 'on', attrs, at }]))) };
      for (const [name, letters] of [...READONLY_AT_START, ...EXPORTED_AT_START.map((n) => [n, 'x'] as const)]) st = { ...st, variables: st.variables.with(name, { declared: 'on', set: letters === 'x' ? 'off' : 'on', attrs: Object.fromEntries([...letters].map((l) => [l, { state: 'on' as const, at }])), at }) };
    }
    if (this.posix) {
      for (const kind of ['set', 'shopt'] as const) for (const name of POSIX_ON[kind]) st = { ...st, [kind]: st[kind].with(name, 'on') };
      st = { ...st, variables: st.variables.with('POSIXLY_CORRECT', { declared: 'on', set: 'on', attrs: {}, value: 'y', at }) };
    } else if (this.shell && POSIX_SHELLS.has(this.shell)) {
      st = { ...st, set: st.set.with('posix', 'on') };
    }
    return st;
  }

  /** Records the function definitions and the `alias` commands under `root`; gives the nodes of `types` there. */
  collectDefinitions(root: SyntaxNode, types = ['function_definition', 'command']): SyntaxNode[] {
    const nodes = descendants(root, types);
    for (const f of nodes) {
      if (f.type !== 'function_definition') continue;
      const name = field(f, 'name')!.text;
      const defs = this.functionDefs.get(name) ?? [];
      if (!defs.includes(f)) this.functionDefs.set(name, [...defs, f]);
    }
    this.aliases.collect(nodes);
    return nodes;
  }

  program(root: SyntaxNode, start: ShellState): ShellState {
    // (One pass over the tree: the definitions, and the names `unset` may remove.)
    const nodes = this.collectDefinitions(root, ['function_definition', 'command']);
    const unset = new Set(nodes.filter((c) => c.type === 'command' && commandName(c) === 'unset').flatMap((c) => fields(c, 'argument')).map((w) => staticWordValue(w) ?? w.text));
    for (const def of nodes.filter((d) => d.type === 'function_definition')) {
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
    // (Then what the host calls, bats' tests: ./host.ts.)
    hostRun(this, root, end);
    this.uncalled();
    return end;
  }

  /**
   * The bodies no call reached: each is walked from its definition's state, with what the script changes after
   * the definition taken as unknown (it may be called from anywhere after it). So may the bodies they call that no
   * call of the script reached (`outside`).
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
          this.outside++;
          this.walkBody(def, widen(this, at, after), { def, saved: new Map() });
          this.outside--;
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
      const st = t.exit && this.topLevel(t.host) ? end : widen(this, t.st, after);
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
   * Runs `statements` (top-level ones, of the script or of a string it runs), a line at a time: the statements that
   * share a line are read at once (their aliases and extglob count from the next line), and an expansion error
   * discards the rest of the line (see `abort`). `sure`: the shell surely got to the last statement (see `sequence`).
   */
  private units(statements: readonly SyntaxNode[], st: ShellState): { end: ShellState; sure: boolean } {
    let sure = true;
    for (let i = 0; i < statements.length;) {
      let j = i + 1;
      while (j < statements.length && statements[j - 1].endPosition.row === statements[j].startPosition.row) j++;
      const unit: Target = { kind: 'unit', dead: this.mode.dead, aborts: [], maybes: [] };
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
  sequence(nodes: readonly SyntaxNode[], st: ShellState): ShellState {
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
    return st.status === 0 || ((errexit === 'off' || errexit === 'default' || this.mode.quiet > 0) && !st.opaque);
  }

  /** Runs `nodes` from `st` as code that does not run here: for the states of their nodes; what they change is dropped, and their conditions are not recorded. */
  private deadRun(nodes: readonly SyntaxNode[], st: ShellState): void {
    this.mode.dead++;
    try {
      this.sequence(nodes, st);
    } finally {
      this.mode.dead--;
    }
  }

  /**
   * What `break`, `continue` (`count`: their N, if known), `return` or `exit` ends (`CommandSpec.ends`), run from `st`:
   * the state goes where the jump leads (the end of a loop or of its pass, of a function body, of the script), and the
   * path does not go on. A jump that may fail (no loop, a count not known, `return` in a trap's action), may be made in
   * a subshell, or is not `sure`, or anywhere when nothing is trusted (`exit` may be a sourced function), is made and not.
   */
  jump(ends: Ends, count: number | undefined, st: ShellState, sure = true): ShellState {
    st = withStatus(this.expansions.beforeWords(st), undefined);
    const collect = (t: { dead: number }, to: ShellState[]): void => {
      if (t.dead === this.mode.dead) to.push(st);
    };
    let maybe = !sure || this.blind;
    if (ends === 'loop' || ends === 'pass') {
      // The loops it can leave: those of this function body and process (bash: "only meaningful in a loop" otherwise).
      const loops: Extract<Target, { kind: 'loop' }>[] = [];
      let surely = 0;
      let trap: Extract<Target, { kind: 'trap' }> | undefined;
      for (let i = this.targets.length - 1; i >= 0; i--) {
        const t = this.targets[i];
        if (t.kind === 'maybe') maybe = true;
        else if (t.kind === 'unit') continue;
        else if (t.kind === 'substitution') {
          // (One the loops in the `${ …; }` take, or with no loop around it, stays in it. Else it ends it, and the loop
          // around it is left once the statement that holds it is done: see `run`. Those in it may be left too.)
          if ((count !== undefined && count <= loops.length) || !this.loopAround(i)) break;
          t.jumps.push({ ends, count, st });
          collect(t, t.returns);
          for (const l of loops) collect(l, ends === 'loop' ? l.breaks : l.continues);
          return maybe || loops.length ? st : unreachable(st);
        } else if (t.kind === 'trap') {
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
      const to = (t: Extract<Target, { kind: 'loop' }>): ShellState[] => (ends === 'loop' ? t.breaks : t.continues);
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
      else if (t.kind === 'trap' && ends === 'function') {
        this.escape(t);
        return st;
      } else if (t.kind === 'subshell') {
        // It ends the subshell: `return` only in a function or a `${ …; }` (else it fails, and the subshell goes on).
        if (ends === 'function' && !this.targets.slice(0, i).some((x) => x.kind === 'function' || x.kind === 'substitution')) return st;
        return maybe ? st : unreachable(st);
      } else if ((t.kind === 'function' || t.kind === 'substitution') && ends === 'function') {
        collect(t, t.returns);
        return maybe ? st : unreachable(st);
      } else if (t.kind === 'program') {
        if (ends === 'function') return st;
        collect(t, t.exits);
        return maybe ? st : unreachable(st);
      }
    }
    // (Outside the script's walk: a trap's action, a body no call reached.)
    return ends === 'function' || maybe ? st : unreachable(st);
  }

  /**
   * Whether a loop of this function body and process is around the target at `i` (see `jump`). (A walk always has a
   * target that ends the search: the script's, a function body's, a trap's action's, a test's of bats.)
   */
  private loopAround(i: number): boolean {
    return this.targets.slice(0, i).reverse().find((t) => !['maybe', 'unit', 'substitution'].includes(t.kind))!.kind === 'loop';
  }

  /**
   * An error in an expansion (`$(( 1 / 0 ))`, from `st`): bash discards the rest of the line of top-level statements
   * that holds it (`unit`), also from a function it calls, or ends the subshell or the `${ …; }`. One that is not
   * `sure` (from values not trusted, or that may not be expanded) may happen or not.
   */
  abort(st: ShellState, sure: boolean): ShellState {
    // (dash ends the shell on such errors: an arithmetic error, an assignment to a readonly variable.)
    if (!this.bash) return this.jump('shell', undefined, st, sure);
    st = withStatus(this.expansions.beforeWords(st), undefined);
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
      if (t.kind === 'unit' || t.kind === 'substitution') {
        if (t.dead === this.mode.dead) (ends ? t.aborts : t.maybes).push(st);
        if (ends) return unreachable(st);
        // (bash 5.3 ends a `${ …; }` there, not the line around it.)
        if (t.kind === 'substitution') return st;
      }
    }
    // (Outside the script's walk: a trap's action, a body no call reached.)
    return ends ? unreachable(st) : st;
  }

  /** The line or the `${ …; }` an error here would end (see `abort`): none in a subshell, or outside the script's walk. */
  private unitTarget(): Extract<Target, { kind: 'unit' | 'substitution' }> | undefined {
    for (let i = this.targets.length - 1; i >= 0; i--) {
      const t = this.targets[i];
      if (t.kind === 'subshell') return undefined;
      if (t.kind === 'unit' || t.kind === 'substitution') return t;
    }
    return undefined;
  }

  /** Runs `run` where `set -e` does not stop the shell (a condition, the left side of `&&` or `||`, after `!`). */
  quietly<T>(run: () => T): T {
    this.mode.quiet++;
    try {
      return run();
    } finally {
      this.mode.quiet--;
    }
  }

  /**
   * Whether what the walks found at `n` holds wherever it runs: not when nothing is trusted, in a function body that
   * may run where the walk does not see it (src/semantics/trust.ts: `closed`), in one not walked at some call, or
   * called from such a place (`unsettled`), or in a loop whose passes did not settle. (Asked once the walk is done.)
   */
  everywhere(n: SyntaxNode): boolean {
    /* c8 ignore next -- a guard: with nothing trusted, no condition is decided and no path ends, so nothing asks (the callers of `StateModel.settled` check `blind` first) */
    if (this.blind) return false;
    return this.holds(n, this.unsettled ??= unsettledBodies(this));
  }

  /** `everywhere`, with `bad` the function definitions whose bodies are not settled. */
  private holds(n: SyntaxNode, bad: ReadonlySet<SyntaxNode>): boolean {
    // (A definition itself runs where it stands: its body is what may run elsewhere.)
    let root = n;
    for (let x: SyntaxNode | null = n.type === 'function_definition' ? n.parent : n; x; x = x.parent) {
      if (this.unwalked.has(x) || (x.type === 'function_definition' && (bad.has(x) || !this.trust.closed(field(x, 'name')!.text)))) return false;
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
      this.mode.dead++;
      try {
        this.run(n, reached(st));
      } finally {
        this.mode.dead--;
      }
      return st;
    }
    this.record(n, st);
    // (Arithmetic the walk does not run: a subscript, an offset, `[[ x -eq y ]]`; a key of an array that must be
    // associative here, else it is arithmetic too. One that may fail may discard the rest of the line: see `abort`.
    // The trust scan read the trees of the strings and of the aliases the walk runs too: `StringTrees`.)
    for (const name of this.trust.arithNames(n) ?? []) this.unsetRead(st, name);
    // (A copy into IFS that the trust follows, `IFS=$save`, and a variable a word of `test` splits, `[ $x ]`.)
    for (const name of this.trust.copied(n) ?? []) this.unsetRead(st, name, 'IFS or a word of `test` reads');
    if (this.trust.mayFail(n)) this.abort(st, false);
    for (const name of this.trust.associative(n) ?? []) {
      if (!this.mode.dead && !this.blind && attribute(st, name, 'A') !== 'on') this.walkAgain(`\`${name}\` may not be associative where its subscript is read`);
    }
    const outer = this.node;
    const statement = this.statement;
    this.node = n;
    this.statement = { deferred: [] };
    const reasons = subshellReasons(n);
    if (reasons.length) this.targets.push({ kind: 'subshell' });
    try {
      const ran = this.runStatement(n, st);
      const after = withStatus(ran, this.conditions.statusOf(n, st, ran));
      // (A job and a coproc are started: 0.)
      let out = this.errexit(n, st, reasons.length ? withStatus(st, reasons.includes('background') || reasons.includes('coproc') ? 0 : after.status) : after);
      // (A `break` or `continue` in a `${ …; }` of the statement: bash leaves the loop now, from a state between the one
      // there and the one after the statement, of which it runs only some. The path also goes on, as the jump may not be made.)
      // (Its words are expanded by then.)
      this.statement.before = undefined;
      for (const j of this.statement.deferred) this.jump(j.ends, j.count, merge([out, j.st], this.posix), false);
      // (A trap's action may run after any statement, when its signal comes.)
      return this.trapKeys.size ? widen(this, out, this.trapKeys) : out;
    } catch (e) {
      // (An expansion error in a subshell of its own, `$((1/0)) &`, ends it there.)
      if (e instanceof ExpansionError) return reasons.length ? withStatus(st, undefined) : e.exit ? this.jump('shell', undefined, e.st, e.sure) : this.abort(e.st, e.sure);
      /* c8 ignore next -- only an expansion error is thrown on purpose */
      throw e;
    } finally {
      if (reasons.length) this.targets.pop();
      this.node = outer;
      this.statement = statement;
    }
  }

  /**
   * The state after the statement `n`, run from `st` and leaving `after`: under `set -e` (surely on), a command that
   * surely fails, where its status is not tested, ends the shell (the subshell).
   */
  private errexit(n: SyntaxNode, st: ShellState, after: ShellState): ShellState {
    if (this.mode.quiet || !after.status || !ERREXIT_STOPS.has(n.type) || option(st, 'set', 'errexit') !== 'on') return after;
    // (The last stage of a pipeline: the pipeline's status counts.)
    if (n.parent?.type === 'pipeline') return after;
    return this.jump('shell', undefined, after);
  }

  private runStatement(n: SyntaxNode, st: ShellState): ShellState {
    switch (n.type) {
      case 'command': return assignmentsOnly(n) ? this.assignments(n, st) : this.command(n, st);
      case 'extended_test':
        return this.expansions.defaults(n, this.expansions.substitutions(n, st));
      case 'arithmetic_command': {
        st = this.expansions.substitutions(n, st);
        // (`(( ))` with nothing in it is not decided, nor one whose words a `${ …; }` changes.)
        const r = this.conditions.arithStatus(n.namedChildren, this.expansions.defaults(n, st));
        return withStatus(r.st, n.namedChildren.length && !changesWords(n) ? r.status : undefined);
      }
      case 'negated_command': return this.quietly(() => this.sequence(n.children, st));
      case 'time_statement': case 'compound_statement':
        return this.sequence(n.children, st);
      case 'redirected_statement': {
        // A compound command makes its redirections first; a simple command, whose redirections are its own, expands its
        // words first (see `redirections`), and assignments alone are made before them (see `assignments`).
        const redirs = redirectionsOf(n);
        // (A subshell makes them in its own process: `( : ) > $(( n = 3 ))` leaves n.)
        const own = field(n, 'body')!.type === 'subshell' ? 'on' : 'off';
        st = this.expansions.fdVariables(redirs, this.expansions.expandAll(redirs, this.expansions.redirectSubstitutions(redirs, st, own), own));
        return this.conditions.mayNotRun(redirs, st, this.sequence(n.children.filter((c) => c.field !== 'redirect'), st));
      }
      case 'subshell':
        return this.sequence(n.children, st);
      case 'coproc_statement': {
        // `NAME` (`COPROC`) is an array of the coprocess's fds, and `NAME_PID` its PID; bash unsets them when the
        // coprocess has ended (may be).
        const name = field(n, 'name')?.text ?? 'COPROC';
        st = this.sequence(n.children, st);
        return merge([st, this.builtins.setVariable(this.builtins.giveAttribute(this.builtins.setVariable(st, name, n, undefined, false, true), name, 'a', n), `${name}_PID`, n, undefined)], this.posix);
      }
      case 'pipeline': return this.pipeline(n, st);
      case 'list': {
        // (`a &&` while typing has no right side yet.)
        const [left, right] = n.namedChildren;
        if (!right) return this.run(left, st);
        // The right side runs when the left one succeeds (`&&`) or fails (`||`); when that is known, the other path is dead.
        const and = n.children.some((c) => c.type === '&&');
        const { value: after, reads } = this.conditions.reads(() => this.quietly(() => this.run(left, st)));
        const ok = after.status === undefined || this.blind ? undefined : after.status === 0;
        this.conditions.decide(n, ok === undefined ? undefined : String(ok), reads);
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
        st = this.expansions.defaults(field(n, 'value')!, this.expansions.substitutions(field(n, 'value')!, st));
        // The patterns are expanded in turn until one matches: the first one always, the others may be.
        const items = n.namedChildren.filter((c) => c.type === 'case_item');
        items.flatMap((item) => fields(item, 'value')).forEach((v, i) => {
          st = this.expansions.substitutions(v, st, i > 0);
          // (Like a word that may not be expanded: an error there may not happen.)
          const after = this.expansions.defaults(v, st, i === 0 ? 'off' : 'unknown');
          st = i === 0 || after === st ? after : merge([st, after], this.posix);
        });
        const runs = this.conditions.caseRuns(n, items, before);
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
          // (After a list that ends with `;;&`, bash tests the patterns in the state it leaves: they are expanded there too.)
          if (tested.length) {
            const at = merge([st, ...tested], this.posix);
            for (const v of fields(item, 'value')) {
              const after = this.expansions.defaults(v, at, 'unknown');
              if (after !== at) st = merge([st, after], this.posix);
            }
          }
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
        // (Those of the condition and the update run at each pass: what a `${ …; }` there changes may be.)
        for (const c of n.namedChildren) if (c.type !== 'do_group') st = this.expansions.substitutions(c, st, c.field !== 'initializer');
        // (When the initializer may fail, bash runs neither the condition nor the update: what they assign may be.)
        let unsure = false;
        const part = (f: 'initializer' | 'update') => (s: ShellState): ShellState => this.arith.arithRun((x) => this.arith.arithScript(fields(n, f), x, unsure).st, s);
        // (An empty condition is true.)
        const condition = (s: ShellState): ShellState => {
          const nodes = fields(n, 'condition');
          if (!nodes.length) return withStatus(s, 0);
          const r = this.conditions.arithStatus(nodes, s, unsure);
          return withStatus(r.st, r.status);
        };
        this.arith.unsure = false;
        const init = part('initializer')(st);
        unsure = this.arith.unsure;
        return this.loop(n, init, { cond: condition, body: (s) => this.sequence(field(n, 'body')?.children ?? [], s), update: part('update'), endsWithCondition: true,
          holds: (status) => (status === undefined ? undefined : status === 0) });
      }
      case 'function_definition': return this.functionDefinition(n, st);
    }
    /* c8 ignore next 2 -- every statement type is handled above */
    return st;
  }
  /** The value of the variable `name` as text; null when it is unset (and `set -u` is off), undefined when not known here. */
  variableText(st: ShellState, name: string): string | null | undefined {
    this.arith.noteRead(st, name);
    const target = this.builtins.resolve(st, name);
    if (!target || changedByBash(target)) return undefined;
    const v = st.variables.get(target);
    const unset = ['off', 'default'].includes(option(st, 'set', 'nounset')) ? null : undefined;
    // (A name the script has not set may come from the environment: by custom, those are in capitals. Once a file
    // was sourced, a string run with `eval` or a trap set, it may come from there.)
    if (!v) {
      if (environmentHas(target) !== 'unlikely' || st.opaque) return undefined;
      // (Taken as unset here, but not for deciding conditions: see `markAssumed`.)
      this.markAssumed();
      return unset;
    }
    if (v.declared === 'unknown' || v.set === 'unknown' || ['a', 'A'].some((l) => (v.attrs[l]?.state ?? 'off') !== 'off')) return undefined;
    const text = v.set === 'off' ? unset : v.value;
    // (Decisions read only the variables the script cannot change unseen: see src/semantics/trust.ts. A read in dead
    // code is no reason for a decision.)
    if (!this.trust.variable(name) || !this.trust.variable(target)) this.markAssumed();
    else if (text !== undefined && !this.mode.dead) for (const r of this.conditions.reading) r.set(name, text);
    return text;
  }

  /**
   * Arithmetic reads `name` from `st`: when no path has set it (nor bash: `RANDOM`…), its value may come from the
   * environment, as text bash runs as an expression, which may assign any variable: nothing is trusted (see `found`).
   */
  unsetRead(st: ShellState, name: string, what = 'arithmetic reads'): void {
    if (this.mode.dead || this.blind) return;
    const target = this.builtins.resolve(st, name) ?? name;
    // (Also one set on some paths only, or to a value made of one the script may not have written.)
    const v = st.variables.get(target);
    if ((!v || v.kept) && !alwaysNumeric(target)) this.walkAgain(`${what} \`${target}\`, which the script may not have set`);
  }

  /**
   * Sets `assumed`: the value was read from a name the script has not set, taken as unset, or from a variable that
   * decisions do not trust (src/semantics/trust.ts); good enough for the state, but not to decide a condition. Also for
   * the value being read as an expression, if any.
   */
  markAssumed(): void {
    this.assumed = true;
    const top = this.arith.arithReads[this.arith.arithReads.length - 1];
    if (top) top.assumed = true;
  }

  /**
   * `st` on a path that ran what the walk does not read (`ShellState.opaque`). It counts as a change (`OPAQUE`): what
   * may run after it, a body no call reached, a trap's action, a function walked again, may run on such a path too.
   */
  opaque(st: ShellState): ShellState {
    this.lastChange.set(OPAQUE, ++this.changeCount);
    for (const c of this.collecting) c.add(OPAQUE);
    return st.opaque ? st : { ...st, opaque: true };
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
      const { value: after, reads } = this.conditions.reads(() => this.quietly(() => this.sequence(b.cond, cur)));
      const holds = after.status === undefined || this.blind ? undefined : after.status === 0;
      this.conditions.decide(b.at, holds === undefined ? undefined : String(holds), reads);
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
        if (key === OPAQUE || key.startsWith(ATTRS)) continue;
        const kind = key.slice(0, key.indexOf(' ')) as Kind;
        const name = key.slice(kind.length + 1);
        (was as Record<Kind, NameMap<unknown>>)[kind] = (was[kind] as NameMap<unknown>).with(name, before.entry[kind].get(name));
      }
      entry = merge([st, was], this.posix);
    }
    // `break` leaves the loop (the states there are merged into the one after it); `continue` ends the pass.
    const target: Extract<Target, { kind: 'loop' }> = { kind: 'loop', dead: this.mode.dead, breaks: [], continues: [] };
    // A condition whose status is known (`holds`) is recorded at each test; one that stops the loop at its first test
    // makes the body dead.
    const test = (s: ShellState): { st: ShellState; holds?: boolean } => {
      if (!holds) return { st: cond(s) };
      const { value, reads } = this.conditions.reads(() => this.quietly(() => cond(s)));
      const h = this.blind ? undefined : holds(value.status);
      this.conditions.decide(n, h === undefined ? undefined : String(h), reads);
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
          this.mode.dead++;
          try {
            pass(c.st);
          } finally {
            this.mode.dead--;
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
      st = this.expansions.defaults(v, this.expansions.substitutions(v, st));
    }
    const variable = field(n, 'variable');
    // (A readonly variable: bash fails at the first word, and the body does not run; it may be.)
    const readonly = variable ? attribute(st, this.builtins.resolve(st, variable.text) ?? variable.text, 'r') : 'off';
    // (An integer runs each word, which may fail: see `assignmentError`.)
    if (variable && attribute(st, this.builtins.resolve(st, variable.text) ?? variable.text, 'i') !== 'off') this.abort(st, false);
    const assign = (s: ShellState, value: string | undefined): ShellState => (variable && readonly !== 'on' ? this.builtins.setVariable(s, variable.text, variable, value) : s);
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
    // (A body that only one no call reached calls: its conditions are not decided either, see `uncalled`.)
    if (this.outside && !this.walks.has(def)) this.unwalked.add(def);
    const site = this.aliasHost ?? this.node!;
    const sites = this.calls.get(def) ?? new Map<SyntaxNode, boolean>();
    if (!this.silent) {
      this.calls.set(def, sites);
      sites.set(site, (sites.get(site) ?? true) && fn.state === 'on');
    }
    let exit: ShellState;
    if (this.stack.includes(def) || this.stack.length >= CALL_DEPTH) {
      // A recursive call: what the body changes may change, and it may end the line (see `abort`).
      exit = notWalked(this, def, st);
      this.recurse(def, st);
      this.unwalked.add(def);
      this.abort(st, false);
    } else if (temporaries.length) {
      const frame: Frame = { def, saved: new Map() };
      let entry = st;
      for (const a of temporaries.filter(temporary)) {
        const name = field(a, 'name')!.text;
        if (!frame.saved.has(name)) frame.saved.set(name, entry.variables.get(name));
        // (bash exports them to the commands the body runs.)
        entry = this.builtins.giveAttribute(this.builtins.assignNode(a, entry, false, true), name, 'x', a);
      }
      exit = this.walkBody(def, entry, frame);
    } else {
      const walks = this.walks.get(def) ?? [];
      if (!this.silent) this.walks.set(def, walks);
      const how = this.reuseKey();
      const seen = walks.find((w) => w.how === how && (w.entry === st || sameState(w.entry, st)));
      // (A walk reused gives again the states where an error in it ended the line, see `abort`, and makes its changes
      // again here, for what collects them: a loop, the body that calls it, a trap's action.)
      const unit = this.unitTarget();
      if (seen) {
        exit = seen.exit;
        if (unit && unit.dead === this.mode.dead) unit.aborts.push(...seen.aborts);
        for (const m of seen.maybes) this.abort(m, false);
        for (const key of seen.changed) {
          this.lastChange.set(key, ++this.changeCount);
          for (const c of this.collecting) c.add(key);
        }
      } else if (walks.length >= WALKS_PER_FUNCTION) {
        exit = notWalked(this, def, st);
        this.unwalked.add(def);
        this.abort(st, false);
      } else {
        const from = unit?.aborts.length ?? 0;
        const maybesFrom = unit?.maybes.length ?? 0;
        const changed = new Set<string>();
        this.collecting.push(changed);
        try {
          exit = this.walkBody(def, st, { def, saved: new Map() });
        } finally {
          this.collecting.pop();
        }
        if (!this.silent) walks.push({ entry: st, exit, how, aborts: unit?.aborts.slice(from) ?? [], maybes: unit?.maybes.slice(maybesFrom) ?? [], changed });
      }
    }
    return fn.state === 'on' ? exit : merge([st, exit], this.posix);
  }

  /**
   * What a walk of a function body depends on besides its entry state: each mode of the walk (`mode`: in it or not),
   * and whether an error ends a line there or a subshell (see `abort`). A walk is reused where these are the same
   * (`call`). (A trap's action walked only for what it changes, `silent`, records nothing, and changes nothing a walk
   * gives: it reuses the others.)
   */
  private reuseKey(): string {
    return [...Object.values(this.mode).map((depth) => depth > 0), !!this.unitTarget()].join(' ');
  }

  /**
   * A recursive call of `def` with `st`: the body runs again from that state (`g() { …; d=2; g; …; }` runs it with `d`
   * as 2), so when the entry the body was walked from does not hold for it, the entry merged with it, for `walkBody`
   * to walk again.
   */
  private recurse(def: SyntaxNode, st: ShellState): void {
    const entry = this.recursed.get(def) ?? this.bodyEntries.get(def);
    if (!entry) return;
    const both = merge([entry, st], this.posix);
    if (!sameState(both, entry)) this.recursed.set(def, both);
  }

  /**
   * Walks the body of `def` from `entry` (`walkBodyOnce`). A recursive call in it, which is not walked, may run the
   * body from another state (`f() { cmd; x=$(f); }`: bash runs `cmd` with errexit on and off; `d=2; g` runs it with
   * another `d`): then the body is walked again from `entry` merged with that state, until that adds nothing. Those
   * walks only add run states to the nodes of the body: the state after the call is the one of the walk from the
   * call's own entry.
   */
  walkBody(def: SyntaxNode, entry: ShellState, frame: Frame): ShellState {
    const saved = new Map(frame.saved);
    let end: ShellState | undefined;
    try {
      for (;;) {
        this.bodyEntries.set(def, entry);
        this.recursed.delete(def);
        const once = this.walkBodyOnce(def, entry, end ? { def, saved: new Map(saved) } : frame);
        end ??= once;
        const again = this.recursed.get(def);
        if (!again) return end;
        entry = again;
      }
    } finally {
      // (A body is not walked inside its own walk: a call there is recursive.)
      this.recursed.delete(def);
      this.bodyEntries.delete(def);
    }
  }

  /** Walks the body of `def` from `entry`; its locals (in `frame`) and its `local -` options are restored after it. */
  private walkBodyOnce(def: SyntaxNode, entry: ShellState, frame: Frame): ShellState {
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
    const target: Target = { kind: 'function', dead: this.mode.dead, returns: [] };
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
    return this.leaveFrame(frame, end);
  }

  /** `end` as the function (or `${ …; }`) of `frame` returns: its locals and its `local -` options are restored. */
  leaveFrame(frame: Frame, end: ShellState): ShellState {
    for (const [name, v] of frame.saved) end = { ...end, variables: end.variables.with(name, v) };
    // A `local GLOBIGNORE` going out of scope sets GLOBIGNORE again, or unsets it: dotglob follows, as for an assignment or `unset`.
    if (frame.saved.has('GLOBIGNORE') && this.bash) {
      const gi = frame.saved.get('GLOBIGNORE');
      end = !gi || gi.set === 'off' ? this.put(end, 'shopt', 'dotglob', 'off') : this.builtins.globignore(end, gi.set === 'on' ? gi.value : undefined);
    }
    if (frame.options) end = { ...end, set: frame.options };
    return end;
  }

  /**
   * A command with no name (`a=1`, `a=$(cmd) b=$a`): its assignments are the shell's, made from left to right; then its
   * redirections are made (their command substitutions run first). Its status is set by `statusOf`.
   */
  private assignments(n: SyntaxNode, st: ShellState): ShellState {
    for (const r of redirectionsOf(n)) st = this.expansions.substitutions(r, st);
    for (const a of prefixAssignments(n)) {
      this.record(a, st);
      st = this.builtins.assignNode(a, this.expansions.defaults(a, this.expansions.substitutions(a, st)), true);
    }
    return withStatus(this.expansions.redirections(n, st, 'off'), st.status);
  }

  private command(n: SyntaxNode, st: ShellState): ShellState {
    // (Those of its redirections when they are made, below.)
    const redirs = redirectionsOf(n);
    st = this.expansions.substitutions(n, st, false, redirs);
    const name = commandName(n);
    const nameNode = field(n, 'name')!;
    const assignments = prefixAssignments(n);
    // With no command name, the assignments are the shell's, made before the redirections; their status is that of
    // the last command substitution. (A quoted empty name is a command: `x=1 ''` is "command not found".)
    const word = nameNode.namedChildren[0];
    if (name === '' && !descendants(word, ['string', 'raw_string', 'ansi_c_string']).length && !['string', 'raw_string', 'ansi_c_string'].includes(word.type)) {
      for (const a of assignments) {
        this.record(a, st);
        st = this.builtins.assignNode(a, this.expansions.defaults(a, st), true);
      }
      return withStatus(this.expansions.redirections(n, this.expansions.redirectSubstitutions(redirs, st, 'off'), 'off'), undefined);
    }
    // The words are expanded, then the values of the assignments, then the redirections are made.
    const before = st;
    st = this.expansions.expandAll(n.namedChildren.filter((c) => !assignments.includes(c) && c.field !== 'redirect'), st);
    const temps = temporaries(this, assignments, st);
    const program = this.builtins.runsProgram(n, st);
    st = this.expansions.redirections(n, this.expansions.redirectSubstitutions(redirs, this.expansions.expandAll(assignments, st), program), program);
    const unrun = st;
    // A prefix assignment to PATH empties the table of remembered paths too.
    if (assignments.some((a) => field(a, 'name')!.text === 'PATH')) st = this.builtins.forgetHashed(st);
    const expanded = this.aliases.expand(n, st);
    if (expanded) return expanded;
    // In POSIX mode, the assignments before a special builtin stay after it, exported.
    const posix = option(before, 'set', 'posix');
    const special = assignments.length > 0 && !!name && builtins[name]?.builtin === 'special' && (posix === 'on' || posix === 'unknown');
    if (special) {
      let kept = st;
      // (`x=1 unset x` removes the temporary `x`, which then does not stay.)
      const unset = temporariesUnset(name!, fields(n, 'argument'), n, this.shell);
      for (const a of assignments.filter((a) => temporary(a) && !unset.has(field(a, 'name')!.text))) kept = this.builtins.giveAttribute(this.builtins.assignNode(a, kept), field(a, 'name')!.text, 'x', a);
      st = posix === 'on' ? kept : merge([this.builtins.appendArith(assignments, n, st), kept], this.posix);
    }
    if (name === undefined) return withStatus(st, this.conditions.simpleStatus(n, before));
    const fn = this.functionCalled(name, st);
    // (`declare() { …; }; declare b=(1 2)`: bash assigns the array, and passes the name.)
    const called = fn && withStatus(this.call(fn, this.builtins.markedArrays(name, fields(n, 'argument'), n, st), assignments), undefined);
    if (called && fn.state === 'on') return this.conditions.mayNotRun(redirectionsOf(n), unrun, called);
    if (!special) st = this.builtins.appendArith(assignments, n, st);
    const ran = withStatus(kept(this, n, temps, this.builtins.builtin(name, fields(n, 'argument'), n, st, true)), this.conditions.simpleStatus(n, before));
    // (A function defined on some paths only: on the others, the builtin or the program runs.)
    return this.conditions.mayNotRun(redirectionsOf(n), unrun, called ? merge([called, ran], this.posix) : ran);
  }

  /** The function a command named `name` calls in `st`: none when POSIX mode finds a special builtin of that name first. */
  functionCalled(name: string, st: ShellState): FunctionState | undefined {
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
  trapAction(script: NestedScript, host: SyntaxNode, st: ShellState, exitOnly: boolean, dead = false): void {
    this.targets.push({ kind: 'trap', exitOnly });
    // (A trap set in code that never runs is never set: its action is walked as dead code.)
    if (dead) this.mode.dead++;
    try {
      this.runScript(script, host, st);
    } finally {
      this.targets.pop();
      if (dead) this.mode.dead--;
    }
  }

  /**
   * What leaves a trap's action at `t` otherwise than by `exit`: the signal may come anywhere, so nothing is trusted
   * (the walk is made again, blind). An EXIT trap's action runs as the shell ends: nothing is left to run.
   */
  private escape(t: Extract<Target, { kind: 'trap' }>): void {
    if (!t.exitOnly && !this.mode.dead && !this.blind) this.walkAgain("a trap's action may end what a signal interrupts (an error, `return`, `break` or `continue`)");
  }

  /**
   * `eval`'s string, run where eval runs. The assignments before `eval` are its temporaries in bash mode: the string
   * sees them, exported, and they are gone after it (what the string assigns to them too); in POSIX mode they stay.
   */
  evalScript(script: NestedScript, n: SyntaxNode, st: ShellState): ShellState {
    // (`n` is the command that runs eval: `eval s`, `builtin eval s`.)
    const temps = prefixAssignments(n);
    if (!temps.length || option(st, 'set', 'posix') === 'on') return this.runScript(script, n, st);
    const saved = new Map<string, VariableState | undefined>();
    let entry = st;
    for (const a of temps.filter(temporary)) {
      const v = field(a, 'name')!.text;
      if (!saved.has(v)) saved.set(v, entry.variables.get(v));
      entry = this.builtins.giveAttribute(this.builtins.assignNode(a, entry, false, true), v, 'x', a);
    }
    let after = this.runScript(script, n, entry);
    for (const [v, was] of saved) after = this.put(after, 'variables', v, was);
    return after;
  }

  /** The string of `words`, which this shell runs: now (`eval`) or later (a trap's action). */
  script(words: SyntaxNode[], kind: 'current' | 'later', n: SyntaxNode, parse: ArgvParse, args: SyntaxNode[]): NestedScript | NotRead {
    const name = parse.command;
    const script = this.scripts.read(words, kind, () => slotEnvs(this.scripts.model.env(n), parse, builtins[name], args, this.shell).get(words[0])!, { shell: this.shell, known: true });
    if (!('why' in script)) this.collectDefinitions(script.tree.root);
    return script;
  }
}
