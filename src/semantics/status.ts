// Exit status and errexit (docs/design/semantics.md, 4.3 and step B5; manual 3.7.5, 3.2.3, 3.2.4, 4.3.1).
//
// - `statusOf(n)` says what the exit status of a statement is: a command's own, the last command substitution of
//   an assignment, a pipeline's last stage (or with pipefail the last that failed; `!` negates it), the last command
//   a list or a compound command ran, an arithmetic value, a number given to `exit` or `return`, a job's for `wait`.
// - `errexitOf(n)` says whether `set -e` stops the shell when the statement fails: errexit where it runs (bash turns
//   it off in `$( )` unless inherit_errexit, which POSIX mode turns on: the walk of src/semantics/state.ts does it),
//   unless bash ignores it there: in the condition of `if`, `while` and `until`, left of `&&` and `||` (every
//   command but the last of the list), after `!`, and in all of a function called from such a place (B2's calls).
//   Lists and compound commands other than `( )` are not checked themselves: their commands are.
import type { Shell } from '../dialect';
import { descendants, field, fields, type SyntaxNode } from '../syntax/tree';
import { processOf, STATEMENTS } from './env';
import { option, type ShellState, type StateModel, type Tri } from './state';
import { type WordEnv, wordFields, type WordFailure, wordOf } from './words';

/** What the exit status of a statement is (manual 3.7.5). */
export type StatusRule =
  /** Its own: a builtin's or a program's (127 not found, 126 not executable, 128+n killed by signal n); a function's last command. `functions`: the definitions it calls. */
  | { readonly kind: 'command'; readonly functions: readonly SyntaxNode[] }
  /** Only assignments (`x=$(cmd)`): the status of the last command substitution, or 0 without one (`at`). */
  | { readonly kind: 'last-substitution'; readonly at?: SyntaxNode }
  /** A declaration builtin with command substitutions in its assignments (`local x=$(cmd)`): its own status hides theirs. */
  | { readonly kind: 'masked'; readonly by: string; readonly substitutions: readonly SyntaxNode[] }
  /** A pipeline: its last stage's status, or with pipefail the last one that is not 0; `!` negates it. */
  | { readonly kind: 'pipeline'; readonly stages: readonly SyntaxNode[]; readonly pipefail: Tri; readonly negated: boolean }
  /** `(( ))` and `let`: 1 when the value is 0, else 0. */
  | { readonly kind: 'arith' }
  /** `[[ ]]` and `[ ]`: 0 when true, 1 when false, 2 on an error. */
  | { readonly kind: 'test' }
  /** Lists, `{ }`, `( )`, `if`, `case`, loops, `time`: the status of the last command run (0 when none ran). */
  | { readonly kind: 'last-run' }
  /** `exit N` and `return N`: N modulo 256 (with a word that is not a number, the rule is `command`). */
  | { readonly kind: 'given'; readonly by: 'exit' | 'return'; readonly value: number }
  /** `exit` and `return` with no number: the status of the command before. */
  | { readonly kind: 'previous'; readonly by: 'exit' | 'return' }
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
  readonly ignored?: Ignored;
  /** Whether a failure of it stops the shell: errexit on, and not ignored. */
  readonly active: Tri;
  /**
   * Whether its own status is checked: simple commands, assignments, tests, `(( ))`, pipelines and `( )`. Lists and
   * the other compound commands are not (their commands are), nor a pipeline's stages (the pipeline is), nor a
   * statement started with `&` (0 for the shell).
   */
  readonly checked: boolean;
  /** The shell it stops: the script, a subshell (`( )`, `$( )`, a pipeline stage, a job), or either. */
  readonly stops: 'script' | 'subshell' | 'unknown';
}

/** Declaration builtins: their status is their own, even with `$( )` in their assignments. */
const DECLARATIONS = new Set(['declare', 'typeset', 'local', 'export', 'readonly']);

/** Statements whose own status `set -e` checks. */
const CHECKED = new Set(['command', 'declaration_command', 'unset_command', 'variable_assignment', 'variable_assignments', 'test_command',
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
function outerSubstitutions(n: SyntaxNode): SyntaxNode[] {
  return descendants(n, ['command_substitution']).filter((s) => {
    for (let x = s.parent; x && x !== n; x = x.parent) if (x.type === 'command_substitution' || x.type === 'process_substitution') return false;
    return true;
  });
}

/** The static name of a simple command (`exit`, `wait`), or undefined. */
function commandName(n: SyntaxNode): string | undefined {
  const name = field(n, 'name');
  return name && /^[\w.:-]+$/.test(name.text) ? name.text : undefined;
}

export interface StatusModel {
  status(n: SyntaxNode): StatusRule;
  errexit(n: SyntaxNode): ErrexitContext;
  /**
   * A word of statement `n` (not of a statement or a substitution inside it) on which bash surely fails, given what
   * is known of the environment (`set -u` and a variable that is not set, `${x?}`): that ends the shell whatever
   * `set -e` says, also where it is ignored.
   */
  expansionError(n: SyntaxNode, env?: WordEnv): { word: SyntaxNode; failure: WordFailure } | undefined;
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

  constructor(private readonly state: StateModel, private readonly shell?: Shell) {}

  /** The function definitions a command calls (B2's calls). */
  private calledBy(n: SyntaxNode): SyntaxNode[] {
    if (!this.callees) {
      this.callees = new Map();
      for (const [def, sites] of this.state.calls) for (const at of sites.keys()) this.callees.set(at, [...(this.callees.get(at) ?? []), def]);
    }
    return this.callees.get(n) ?? [];
  }

  status(n: SyntaxNode): StatusRule {
    if (backgrounded(n) || n.type === 'coproc_statement') return { kind: 'background', job: this.own(n.type === 'coproc_statement' ? n.namedChildren[n.namedChildren.length - 1] : n) };
    return this.own(n);
  }

  private own(n: SyntaxNode): StatusRule {
    switch (n.type) {
      case 'command': {
        const name = commandName(n);
        const args = fields(n, 'argument');
        if (name === 'exit' || name === 'return') {
          const v = args[0]?.text;
          if (v === undefined) return { kind: 'previous', by: name };
          // (`exit $code`: the value is not known here.)
          return /^-?\d+$/.test(v) ? { kind: 'given', by: name, value: ((Number(v) % 256) + 256) % 256 } : { kind: 'command', functions: [] };
        }
        if (name === 'let') return { kind: 'arith' };
        if (name === 'wait') {
          const all = !args.length;
          const job = args.length === 1 && args[0].text === '$!' ? this.lastJob(n) : undefined;
          return { kind: 'wait', all, ...(job ? { job } : {}) };
        }
        return { kind: 'command', functions: this.calledBy(n) };
      }
      case 'declaration_command': {
        const subs = n.namedChildren.filter((c) => c.type === 'variable_assignment').flatMap(outerSubstitutions);
        return subs.length ? { kind: 'masked', by: n.children[0].text, substitutions: subs } : { kind: 'command', functions: [] };
      }
      case 'variable_assignment': case 'variable_assignments': {
        const subs = outerSubstitutions(n);
        return { kind: 'last-substitution', ...(subs.length ? { at: subs[subs.length - 1] } : {}) };
      }
      case 'test_command': case 'extended_test': return { kind: 'test' };
      case 'arithmetic_command': return { kind: 'arith' };
      case 'pipeline': return { kind: 'pipeline', stages: n.namedChildren.filter((c) => STATEMENTS.has(c.type)), pipefail: optionOn(this.state.at(n).run, 'set', 'pipefail'), negated: false };
      case 'negated_command': {
        const inner = n.namedChildren[0];
        const stages = inner?.type === 'pipeline' ? inner.namedChildren.filter((c) => STATEMENTS.has(c.type)) : inner ? [inner] : [];
        return { kind: 'pipeline', stages, pipefail: optionOn(this.state.at(n).run, 'set', 'pipefail'), negated: true };
      }
      case 'redirected_statement': {
        const body = field(n, 'body');
        return body ? this.own(body) : { kind: 'last-substitution' };
      }
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
    const errexit = optionOn(st, 'set', 'errexit');
    const ignored = this.ignored(n) ?? undefined;
    const active: Tri = errexit === 'off' || ignored?.sure ? 'off' : errexit === 'unknown' || ignored ? 'unknown' : 'on';
    // (The shell that checks a `( )` is the one around it.)
    const p = processOf({ links: this.state.env(n).links.filter((l) => !(l.kind === 'subshell' && l.at === n && l.why === 'parentheses')) });
    const stops = !p.sure ? 'unknown' : p.kind === 'main' ? 'script' : 'subshell';
    const stage = n.parent?.type === 'pipeline' && STATEMENTS.has(n.type);
    // (An assignment in a declaration, before a command or among others is part of that statement.)
    const part = n.type === 'variable_assignment' && ['declaration_command', 'command', 'variable_assignments'].includes(n.parent!.type);
    const checked = CHECKED.has(n.type) && !stage && !part && !backgrounded(n);
    const ctx: ErrexitContext = { errexit, ...(ignored ? { ignored } : {}), active, checked, stops };
    this.errexitMemo.set(n, ctx);
    return ctx;
  }

  expansionError(n: SyntaxNode, env?: WordEnv): { word: SyntaxNode; failure: WordFailure } | undefined {
    const visit = (x: SyntaxNode): { word: SyntaxNode; failure: WordFailure } | undefined => {
      for (const c of x.children) {
        if (c.type === 'command_substitution' || c.type === 'process_substitution' || (STATEMENTS.has(c.type) && c !== n)) continue;
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
  for (let x = n.parent; x; x = x.parent) {
    if (x.type === 'subshell' || x.type === 'command_substitution' || (x.parent?.type === 'function_definition' && x === field(x.parent, 'body'))) return x;
    if (!x.parent) return x;
  }
  /* c8 ignore next */
  return n;
}

/** The statements whose status is that of `n` when it ends (the last statements of a body: through lists, groups and `if`). */
export function lastStatements(n: SyntaxNode): SyntaxNode[] {
  if (n.type === 'compound_statement' || n.type === 'subshell' || n.type === 'program') {
    const stmts = n.namedChildren.filter((c) => STATEMENTS.has(c.type));
    return stmts.length ? lastStatements(stmts[stmts.length - 1]) : [];
  }
  if (n.type === 'redirected_statement') {
    const body = field(n, 'body');
    return body ? lastStatements(body) : [n];
  }
  return [n];
}

/** Whether `n` is a `set` command that turns errexit on (`set -e`, `set -euo pipefail`, `set -o errexit`). */
export function setsErrexit(n: SyntaxNode): boolean {
  if (n.type !== 'command' || commandName(n) !== 'set') return false;
  const words = fields(n, 'argument').map((w) => w.text);
  // (Options end at the first word that is not one: `set -- -e` sets the positional parameters.)
  const end = words.findIndex((w, i) => !/^-[A-Za-z]/.test(w) && !/^[-+][A-Za-z]*o$/.test(words[i - 1] ?? ''));
  const options = end < 0 ? words : words.slice(0, end);
  // (`errexit` is never the first: the options start with `-`.)
  return options.some((w, i) => /^-[A-Za-z]*e/.test(w) || (w === 'errexit' && /^-[A-Za-z]*o$/.test(options[i - 1]!)));
}
