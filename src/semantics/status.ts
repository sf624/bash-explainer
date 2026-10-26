// Exit status and errexit (docs/design/semantics.md, 4.3 and step B5; manual 3.7.5, 3.2.3, 3.2.4, 4.3.1).
//
// - `statusOf(n)` says what the exit status of a statement is: a command's own, the last command substitution of
//   an assignment, a pipeline's last stage (or with pipefail the last that failed; `!` negates it), the last command
//   a list or a compound command ran, an arithmetic value, a number given to `exit` or `return`, a job's for `wait`.
// - `errexitOf(n)` says whether `set -e` stops the shell when the statement fails: errexit where it runs (bash turns
//   it off in `$( )` unless inherit_errexit, which POSIX mode turns on: the walk, src/semantics/walk/walker.ts, does it),
//   unless bash ignores it there: in the condition of `if`, `while` and `until`, left of `&&` and `||` (every
//   command but the last of the list), after `!`, and in all of a function called from such a place (B2's calls).
//   Lists and compound commands other than `( )` are not checked themselves: their commands are.
import { canonicalName } from '../dict/aliases';
import { builtins } from '../dict/builtins';
import type { Shell } from '../dialect';
import { assignmentsOnly, descendants, field, fields, prefixAssignments, redirectionsOf, type SyntaxNode } from '../syntax/tree';
import { actedNames, declaresNames } from '../argv/query';
import { builtinParse, commandName, wrapped } from './effects';
import { processOf, STATEMENTS } from './env';
import { resolveName, testSpecOf } from './names';
import { commandTest } from '../testexpr';
import { type ErrexitWhy, option, type ShellState, type StateModel, type Tri } from './state';
import { type WordEnv, wordFields, type WordFailure, wordOf } from './words';

/** What the exit status of a statement is (manual 3.7.5). */
export type StatusRule =
  /** Its own: a builtin's or a program's (127 not found, 126 not executable, 128+n killed by signal n); a function's last command. `functions`: the definitions it calls. */
  | { readonly kind: 'command'; readonly functions: readonly SyntaxNode[] }
  /** Only assignments (`x=$(cmd)`): the status of the last command substitution, or 0 without one (`at`). */
  | { readonly kind: 'last-substitution'; readonly at?: SyntaxNode }
  /** A declaration builtin with command substitutions in its assignments (`local x=$(cmd)`): its own status hides theirs. */
  | { readonly kind: 'masked'; readonly by: string; readonly name: string; readonly substitutions: readonly SyntaxNode[] }
  /** A pipeline: its last stage's status, or with pipefail the last one that is not 0; `!` negates it. */
  | { readonly kind: 'pipeline'; readonly stages: readonly SyntaxNode[]; readonly pipefail: Tri; readonly negated: boolean }
  /** `(( ))` and `let`: 1 when the value is 0, else 0. */
  | { readonly kind: 'arith' }
  /**
   * `[[ ]]` and `[ ]`: 0 when true, 1 when false, 2 on an error. `fails`: `test` or `[` surely fails before evaluating
   * anything (status 2): `[` without its `]`, or arguments bash cannot read as an expression (src/testexpr.ts).
   */
  | { readonly kind: 'test'; readonly fails?: true }
  /** Lists, `{ }`, `( )`, `if`, `case`, loops, `time`: the status of the last command run (0 when none ran). */
  | { readonly kind: 'last-run' }
  /**
   * `exit N` and `return N` (what they end, `CommandSpec.ends`: the shell or the function): N modulo 256 (with a word
   * that is not a number, the rule is `command`).
   */
  | { readonly kind: 'given'; readonly ends: 'shell' | 'function'; readonly value: number }
  /** `exit` and `return` with no number: the status of the command before. */
  | { readonly kind: 'previous'; readonly ends: 'shell' | 'function' }
  /** `wait`: the status of the job waited for (`job`, the statement `$!` started, when known); 0 with no operand. */
  | { readonly kind: 'wait'; readonly job?: SyntaxNode; readonly all: boolean }
  /** A statement started with `&` (or a coproc): 0 for the shell that starts it; `job` is its own status, for `wait`. */
  | { readonly kind: 'background'; readonly job: StatusRule }
  /** A function definition: 0. */
  | { readonly kind: 'definition' };

/** Why bash ignores `set -e` for a statement. */
export type IgnoreReason = 'condition' | 'and-or' | 'negated' | 'called-in-condition';

export interface Ignored {
  readonly why: IgnoreReason;
  /** The `if`, `while` or `until`; the list; the `!`; or a call of the function (for `called-in-condition`). */
  readonly at: SyntaxNode;
  /** It is ignored on every path (false: a function called both where it is ignored and where it is not). */
  readonly sure: boolean;
}

/** Whether `set -e` stops the shell when a statement fails (manual 4.3.1). */
export interface ErrexitContext {
  /** errexit where it runs (off in `$( )` unless inherit_errexit). */
  readonly errexit: Tri;
  /**
   * Why errexit has that value: `default` (never turned on: `#!/bin/bash -e` is not read), `set` (a `set -e` before),
   * `off-in-substitution` (bash turns it off in `$( )`), `inherit_errexit` or `posix` (kept in `$( )` by them): the
   * state's `errexitWhy`.
   */
  readonly errexitWhy: 'default' | 'set' | ErrexitWhy;
  readonly ignored?: Ignored;
  /** Whether a failure of it stops the shell: errexit on, and not ignored. */
  readonly active: Tri;
  /**
   * Whether its own status is checked (`true`): simple commands, assignments, tests, `(( ))`, pipelines and `( )`. Else
   * why not: lists, function definitions and the compound commands other than `( )` (`compound`: their commands
   * are checked), a pipeline's stages (`pipeline-stage`: the pipeline is), a statement started with `&` or a coproc
   * (`job`: 0 for the shell), an assignment in a declaration or before a command (`part-of-command`).
   */
  readonly checked: true | { readonly why: 'compound' | 'pipeline-stage' | 'job' | 'part-of-command' };
  /** The shell it stops: the script, a subshell (`( )`, `$( )`, a pipeline stage, a job), or either. */
  readonly stops: 'script' | 'subshell' | 'unknown';
}

/** Statements whose own status `set -e` checks. */
const CHECKED = new Set(['command',
  'extended_test', 'arithmetic_command', 'pipeline', 'negated_command', 'subshell']);

/** A Tri for an option (`default`: off, but in POSIX mode for the options it turns on). */
export function optionOn(st: ShellState, kind: 'set' | 'shopt', name: string): Tri {
  const v = option(st, kind, name);
  return v === 'default' ? 'off' : v;
}

/** The statements of the condition of an `if`, `elif` or `while`/`until` (before `then` or `do`), or undefined. */
export function conditionOf(n: SyntaxNode): SyntaxNode[] | undefined {
  if (n.type === 'while_statement') return fields(n, 'condition').filter((c) => c.named);
  if (n.type !== 'if_statement' && n.type !== 'elif_clause') return undefined;
  const then = n.children.findIndex((c) => c.type === 'then');
  return (then < 0 ? n.children : n.children.slice(0, then)).filter((c) => STATEMENTS.has(c.type));
}

/** Whether `n` is a statement followed by `&`. */
function backgrounded(n: SyntaxNode): boolean {
  const p = n.parent;
  if (!p || !STATEMENTS.has(n.type)) return false;
  const next = p.children[p.children.indexOf(n) + 1];
  return next?.type === '&';
}

/** The command substitutions of `n` that are not inside another one, in source order. */
/** A word that is an assignment as text (`\declare a=$(cmd)`): the name assigned. */
const ASSIGNMENT = /^([A-Za-z_]\w*(?:\[[^\]]*\])?)\+?=/;

function outerSubstitutions(n: SyntaxNode): SyntaxNode[] {
  return descendants(n, ['command_substitution']).filter((s) => {
    for (let x = s.parent; x && x !== n; x = x.parent) if (x.type === 'command_substitution' || x.type === 'process_substitution') return false;
    return true;
  });
}

export interface StatusModel {
  /** The state the model reads (src/semantics/state.ts). */
  readonly state: StateModel;
  status(n: SyntaxNode): StatusRule;
  errexit(n: SyntaxNode): ErrexitContext;
  /**
   * A word of statement `n` (not of a statement or a substitution inside it) on which bash surely fails, given what
   * is known of the environment (`set -u` and a variable that is not set, `${x?}`): that ends the shell whatever
   * `set -e` says, also where it is ignored.
   */
  expansionError(n: SyntaxNode, env?: WordEnv): { word: SyntaxNode; failure: WordFailure } | undefined;
  /** Whether `n` is a `set` (the builtin) that turns errexit on where it was not (from the state before and after it). */
  turnsErrexitOn(n: SyntaxNode): boolean;
  /**
   * Whether pipeline `n` hides a failure: no pipefail, a stage before the last that can fail (not `echo` or `printf`
   * of plain words, nor `cat` of a here-document), and a last stage that reads to the end (not `head`, `grep -q`,
   * `grep -m`, `sed …q`: with pipefail the SIGPIPE of the stages before it would fail the pipeline).
   */
  hidesFailure(n: SyntaxNode): boolean;
  /**
   * Whether command `n` surely has the status 0: what it runs is the builtin `true` or `:`, or a program named `true`
   * (`/bin/true`), also behind `command` and `builtin`, with no word after the name, no redirection and no assignment
   * before it. Not a function or an alias of that name (`true() { return 1; }`), nor a word that may fail (`: ${x:?}`).
   * (`n` is undefined where nothing is written yet: `a ||`.)
   */
  succeeds(n: SyntaxNode | undefined): boolean;
}

const models = new WeakMap<StateModel, StatusModel>();

/** Status rules and errexit contexts of the statements of a script, read from its state model (cached). */
export function statusModel(state: StateModel, shell?: Shell): StatusModel {
  let m = models.get(state);
  if (!m) models.set(state, (m = new Statuses(state, shell)));
  return m;
}

class Statuses implements StatusModel {
  private readonly ignoreMemo = new Map<SyntaxNode, Ignored | null>();
  private readonly errexitMemo = new Map<SyntaxNode, ErrexitContext>();
  private callees: Map<SyntaxNode, SyntaxNode[]> | undefined;

  constructor(readonly state: StateModel, private readonly shell?: Shell) {}

  /** The function definitions a command calls (B2's calls). */
  private calledBy(n: SyntaxNode): SyntaxNode[] {
    if (!this.callees) {
      this.callees = new Map();
      for (const [def, sites] of this.state.calls) for (const at of sites.keys()) this.callees.set(at, [...(this.callees.get(at) ?? []), def]);
    }
    return this.callees.get(n) ?? [];
  }

  succeeds(n: SyntaxNode | undefined): boolean {
    if (n?.type !== 'command' || prefixAssignments(n).length || redirectionsOf(n).length) return false;
    const name = commandName(n);
    if (name === undefined) return false;
    const at = field(n, 'name')!;
    let args = fields(n, 'argument');
    let res = resolveName(this.state, name, at, { shell: this.shell, command: true });
    while (res.kind === 'builtin' && (res.name === 'command' || res.name === 'builtin')) {
      const inner = wrapped(res.name, args);
      if ('lookup' in inner || inner.name === undefined) return false;
      args = inner.args;
      res = resolveName(this.state, inner.name, at, { shell: this.shell, command: true, lookup: res.name === 'command' ? 'no-functions' : 'builtins-only' });
    }
    if (args.length) return false;
    // (A builtin turned off on some paths may be missing there: `enable -n :`.)
    if (res.kind === 'builtin') return !res.disabled && (res.name === 'true' || res.name === ':');
    return res.kind === 'file' && /(^|\/)true$/.test(res.name);
  }

  status(n: SyntaxNode): StatusRule {
    if (backgrounded(n) || n.type === 'coproc_statement') return { kind: 'background', job: this.own(n.type === 'coproc_statement' ? n.namedChildren[n.namedChildren.length - 1] : n) };
    return this.own(n);
  }

  private own(n: SyntaxNode): StatusRule {
    switch (n.type) {
      case 'command': {
        // (A command with no name, `a=$(cmd)`, has the status of its last command substitution, or 0. bash assigns
        // first, then expands the redirections: `>f$(exit 2) a=$(exit 1)` has the status 2.)
        if (assignmentsOnly(n)) {
          const subs = [...prefixAssignments(n), ...redirectionsOf(n)].flatMap(outerSubstitutions);
          return { kind: 'last-substitution', ...(subs.length ? { at: subs[subs.length - 1] } : {}) };
        }
        const name = commandName(n);
        const args = fields(n, 'argument');
        // (B3: a function of that name runs instead of the builtin.)
        const res = name ? resolveName(this.state, name, field(n, 'name')!, { shell: this.shell, command: true }) : undefined;
        if (res?.kind === 'function') return { kind: 'command', functions: [res.fn.def] };
        // (`test` and `[`, the builtins or the programs.)
        const test = res && testSpecOf(res);
        if (test) {
          // (The model does not take the release: what it says holds in bash 5.2 and in 5.3.)
          const read = commandTest(test, args, !!test.builtin && (!this.shell || this.shell === 'bash') && 'both');
          return read.unclosed || read.malformed ? { kind: 'test', fails: true } : { kind: 'test' };
        }
        if (res?.kind !== 'builtin') return { kind: 'command', functions: this.calledBy(n) };
        const spec = builtins[res.name];
        if (spec.ends === 'shell' || spec.ends === 'function') {
          const v = args[0]?.text;
          if (v === undefined) return { kind: 'previous', ends: spec.ends };
          // (`exit $code`: the value is not known here.)
          return /^-?\d+$/.test(v) ? { kind: 'given', ends: spec.ends, value: ((Number(v) % 256) + 256) % 256 } : { kind: 'command', functions: [] };
        }
        if (name === 'let') return { kind: 'arith' };
        // `local x=$(cmd)`, `\local x=$(cmd)`: the declaration's own status, whatever the substitution's (its operands
        // that declare names, `OperandSpec.acts`).
        const assigned = !declaresNames(spec) ? [] : actedNames(builtinParse(res.name, args)).filter((o) => o.acts === 'declares').map(({ word }) => args[word])
          .filter((a) => a.type === 'variable_assignment' || ASSIGNMENT.test(a.text));
        const subs = assigned.flatMap(outerSubstitutions);
        if (subs.length) {
          const a = assigned.find((x) => outerSubstitutions(x).length)!;
          const v = a.type === 'variable_assignment' ? field(a, 'name')!.text : ASSIGNMENT.exec(a.text)![1];
          return { kind: 'masked', by: res.name, name: v, substitutions: subs };
        }
        if (name === 'wait') {
          const all = !args.length;
          const job = args.length === 1 && args[0].text === '$!' ? this.lastJob(n) : undefined;
          return { kind: 'wait', all, ...(job ? { job } : {}) };
        }
        return { kind: 'command', functions: [] };
      }
      case 'extended_test': return { kind: 'test' };
      case 'arithmetic_command': return { kind: 'arith' };
      case 'pipeline': return { kind: 'pipeline', stages: n.namedChildren.filter((c) => STATEMENTS.has(c.type)), pipefail: optionOn(this.state.at(n).run, 'set', 'pipefail'), negated: false };
      case 'negated_command': {
        const inner = n.namedChildren[0];
        const stages = inner?.type === 'pipeline' ? inner.namedChildren.filter((c) => STATEMENTS.has(c.type)) : inner ? [inner] : [];
        return { kind: 'pipeline', stages, pipefail: optionOn(this.state.at(n).run, 'set', 'pipefail'), negated: true };
      }
      case 'redirected_statement': return this.own(field(n, 'body')!);
      case 'function_definition': return { kind: 'definition' };
    }
    return { kind: 'last-run' };
  }

  /** The statement started with `&` before `n` in its list (what `$!` names), if it is in the same block. */
  private lastJob(n: SyntaxNode): SyntaxNode | undefined {
    let job: SyntaxNode | undefined;
    const visit = (x: SyntaxNode): void => {
      for (const c of x.children) {
        if (c.startIndex >= n.startIndex) return;
        if (backgrounded(c)) job = c;
        if (c.type !== 'function_definition') visit(c);
      }
    };
    visit(enclosingBlock(n));
    return job;
  }

  errexit(n: SyntaxNode): ErrexitContext {
    const hit = this.errexitMemo.get(n);
    if (hit) return hit;
    const st = this.state.at(n).run;
    // (The walk of the state turns errexit off in `$( )` and in the functions called there, and says why.)
    const errexit = optionOn(st, 'set', 'errexit');
    const errexitWhy = st.errexitWhy ?? (option(st, 'set', 'errexit') === 'default' ? 'default' : 'set');
    const ignored = this.ignored(n) ?? undefined;
    const active: Tri = errexit === 'off' || ignored?.sure ? 'off' : errexit === 'unknown' || ignored ? 'unknown' : 'on';
    // (The shell that checks a `( )` is the one around it.)
    const p = processOf({ links: this.state.env(n).links.filter((l) => !(l.kind === 'subshell' && l.at === n && l.why === 'parentheses')) });
    const stops = !p.sure ? 'unknown' : p.kind === 'main' ? 'script' : 'subshell';
    const checked: ErrexitContext['checked'] = n.parent?.type === 'pipeline' && STATEMENTS.has(n.type) ? { why: 'pipeline-stage' }
      : backgrounded(n) || n.type === 'coproc_statement' ? { why: 'job' }
      // (An assignment is part of its command: `a=1`, `x=1 cmd`, `local x=1`.)
      : n.type === 'variable_assignment' && n.parent!.type === 'command' ? { why: 'part-of-command' }
      : CHECKED.has(n.type) ? true : { why: 'compound' };
    const ctx: ErrexitContext = { errexit, errexitWhy, ...(ignored ? { ignored } : {}), active, checked, stops };
    this.errexitMemo.set(n, ctx);
    return ctx;
  }

  turnsErrexitOn(n: SyntaxNode): boolean {
    return this.state.setWrites(n).get('errexit') === 'on' && this.errexit(n).errexit !== 'on';
  }

  hidesFailure(n: SyntaxNode): boolean {
    const rule = this.status(n);
    if (rule.kind !== 'pipeline' || rule.negated || rule.pipefail !== 'off') return false;
    return rule.stages.slice(0, -1).some((s) => !cannotFail(s)) && !closesEarly(rule.stages[rule.stages.length - 1]);
  }

  expansionError(n: SyntaxNode, env?: WordEnv): { word: SyntaxNode; failure: WordFailure } | undefined {
    const visit = (x: SyntaxNode): { word: SyntaxNode; failure: WordFailure } | undefined => {
      for (const c of x.children) {
        if (c.type === 'command_substitution' || c.type === 'process_substitution' || STATEMENTS.has(c.type)) continue;
        const w = wordOf(c);
        if (w && w.nodes[0] === c && (c.type === 'simple_expansion' || c.type === 'expansion' || descendants(c, ['simple_expansion', 'expansion']).length)) {
          const f = wordFields(c, this.state, env);
          if (f.failure?.kind === 'fatal' && f.failure.applies === true) return { word: c, failure: f.failure };
          continue;
        }
        const inner = visit(c);
        if (inner) return inner;
      }
      return undefined;
    };
    return visit(n);
  }

  /** Why bash ignores `set -e` for `n`, from where it is (null: it does not). */
  private ignored(n: SyntaxNode): Ignored | null {
    if (this.ignoreMemo.has(n)) return this.ignoreMemo.get(n)!;
    // (A function that calls itself: its calls are not ignored for this.)
    this.ignoreMemo.set(n, null);
    let out: Ignored | null = null;
    if (n.type === 'negated_command') out = { why: 'negated', at: n, sure: true };
    for (let x = n; !out && x.parent; x = x.parent) {
      const p = x.parent;
      if (p.type === 'negated_command') out = { why: 'negated', at: p, sure: true };
      else if (p.type === 'list' && x === p.namedChildren[0]) out = { why: 'and-or', at: p, sure: true };
      else if (conditionOf(p)?.includes(x)) out = { why: 'condition', at: p.type === 'elif_clause' ? p.parent! : p, sure: true };
      else if (p.type === 'function_definition' && x === field(p, 'body')) {
        out = this.inCalls(p);
        break;
      }
    }
    this.ignoreMemo.set(n, out);
    return out;
  }

  /** `set -e` in the body of `def`: ignored when every call is where it is ignored; maybe when some are. */
  private inCalls(def: SyntaxNode): Ignored | null {
    const sites = [...(this.state.calls.get(def)?.keys() ?? [])];
    const ignored = sites.map((at) => [at, this.ignored(at)] as const).filter(([, i]) => i);
    if (!ignored.length) return null;
    return { why: 'called-in-condition', at: ignored[0][0], sure: ignored.length === sites.length && ignored.every(([, i]) => i!.sure) };
  }
}

/** The nearest `( )`, `$( )` or function body around `n` (where `$!` was set), or the program. */
function enclosingBlock(n: SyntaxNode): SyntaxNode {
  // (`n` is never the root: it is a statement or a word.)
  for (let x = n.parent!; ; x = x.parent) {
    if (x.type === 'subshell' || x.type === 'command_substitution' || (x.parent?.type === 'function_definition' && x === field(x.parent, 'body'))) return x;
    if (!x.parent) return x;
  }
}

/** The statements whose status is that of `n` when it ends (the last statements of a body: through lists, groups and `if`). */
export function lastStatements(n: SyntaxNode): SyntaxNode[] {
  if (n.type === 'compound_statement' || n.type === 'subshell' || n.type === 'program') {
    const stmts = n.namedChildren.filter((c) => STATEMENTS.has(c.type));
    return stmts.length ? lastStatements(stmts[stmts.length - 1]) : [];
  }
  if (n.type === 'redirected_statement') return lastStatements(field(n, 'body')!);
  return [n];
}

/** A pipeline stage that cannot fail: `echo` or `printf` of words with no `$( )`, `cat` of a here-document or a here-string. */
function cannotFail(stage: SyntaxNode): boolean {
  if (stage.type !== 'command' || descendants(stage, ['command_substitution', 'process_substitution']).length) return false;
  const name = commandName(stage);
  const redirs = redirectionsOf(stage);
  if (name === 'echo' || name === 'printf') return !redirs.length;
  return name === 'cat' && !fields(stage, 'argument').length && redirs.length > 0
    && redirs.every((r) => r.type === 'heredoc_redirect' || r.type === 'herestring_redirect');
}

/** A last stage that may stop reading before the end: `head`, `grep -q`, `grep -m N`, `sed …q`. */
function closesEarly(stage: SyntaxNode): boolean {
  if (stage.type !== 'command') return false;
  const name = commandName(stage);
  const args = fields(stage, 'argument').map((a) => a.text);
  return name === 'head' || (canonicalName(name ?? '') === 'grep' && args.some((a) => /^-[A-Za-z]*[qm]/.test(a) || /^--(quiet|silent|max-count)/.test(a)))
    || (name === 'sed' && args.some((a) => /q\d*['"]?$/.test(a)));
}
