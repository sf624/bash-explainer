// What the parts of the walk of the shell state share (src/semantics/walk/walker.ts): the errors that stop a part of
// it, where jumps go, the frames of the functions it runs, what reaches another shell, and the parser of the texts it
// reads (aliases, arithmetic).
import { createUnbashParser } from '../../syntax/adapters/unbash';
import { type BashParser, descendants, substitutionForm, type SyntaxNode } from '../../syntax/tree';
import { evalArithWrapping } from '../../arith';
import type { NameMap, OptionState, ShellState, VariableState } from '../shellstate';

export const NAME = /^[A-Za-z_]\w*$/;

export const SUBSTITUTIONS = ['command_substitution', 'process_substitution'];

/** Whether the command substitution `c` is bash 5.3's `${ …; }` or `${| …; }`, which runs in the shell itself (docs/design/bash-versions.md, 4.1). */
export const inShell = (c: SyntaxNode): boolean => c.type === 'command_substitution' && substitutionForm(c).startsWith('${');

/**
 * Whether the words of `n` hold a `${ …; }` (bash 5.3): its words are then expanded in states that change on the way,
 * so a status read from the state before `n` may be wrong.
 */
export const changesWords = (n: SyntaxNode): boolean => descendants(n, ['command_substitution']).some(inShell);

/** The change (see `Walker.put`) of a path that ran what the walk does not read (`Walker.opaque`). */
export const OPAQUE = 'opaque';

let textParser: BashParser | undefined;
/** The parser of the texts the model reads besides the script: strings, aliases, arithmetic. */
export const parser = (): BashParser => (textParser ??= createUnbashParser());

/** Thrown when the walk finds a reason to trust nothing (`Walker.found`): what it found so far is dropped. */
export class WalkAgain {}
/** An error in arithmetic (a division by 0, a readonly variable): bash stops the expression there; `st` has what was assigned before it. */
export class ArithError {
  constructor(readonly st: ShellState) {}
}
/**
 * An error in an expansion: `$(( 1/0 ))` discards the rest of the line (see `abort`), `${x?}` on an unset `x` ends the
 * shell (`exit`). `st` has what was assigned before it; `sure`: the values that make it are trusted.
 */
export class ExpansionError {
  constructor(readonly st: ShellState, readonly sure: boolean, readonly exit = false) {}
}
/**
 * What arithmetic does is not known here: a text pasted or a value read that is not known, text the parser may read
 * otherwise than bash (a syntax error: bash has made the assignments before it), too long or too deep to follow.
 */
export class ArithUnknown {
  /** `deep`: past `ARITH_DEPTH`; `limit`: past another limit, which depends on what ran before. */
  constructor(readonly why?: 'deep' | 'limit') {}
}

/** A word that declares or assigns a name: `x`, `x=1`, `x+=1`, `a[1]=x`, `a=(1 2)`, as a node or as static text. */
export interface Operand {
  node: SyntaxNode;
  name: string;
  subscript: boolean;
  assign?: { append: boolean; text: string | undefined; array: boolean; source?: SyntaxNode; kept?: boolean };
}

/** A function being run: the outer values of its locals (restored when it returns), and its set options with `local -`. */
export interface Frame { def: SyntaxNode; saved: Map<string, VariableState | undefined>; options?: NameMap<OptionState>; proc?: Target }

/**
 * Where `break`, `continue`, `return` and `exit` go (innermost last): a loop, a function body, the script; a
 * subshell ends them (`maybe`: a pipeline's last stage that may run in the shell or in a subshell). `dead` is the
 * depth of dead code where it was entered: a jump from deeper dead code is not collected.
 */
export type Target =
  | { kind: 'loop'; dead: number; breaks: ShellState[]; continues: ShellState[] }
  | { kind: 'function'; dead: number; returns: ShellState[]; proc?: Target }
  | { kind: 'program'; dead: number; exits: ShellState[] }
  /**
   * A line of top-level statements, or of a string `eval` or a trap runs: an expansion error discards the rest of it
   * (`aborts`, see `abort`); one that may happen (`maybes`) may discard it, or the rest of a line around it.
   */
  | { kind: 'unit'; dead: number; aborts: ShellState[]; maybes: ShellState[] }
  /**
   * bash 5.3's `${ …; }` or `${| …; }`, run in the shell itself (docs/design/bash-versions.md, 4.1): `return` ends it
   * (`returns`), and so does an error in an expansion (`aborts`, or `maybes` when it may happen), as in a subshell.
   * `exit` goes through it. `break` and `continue` that the loops inside it do not take, with a loop around it, end it
   * too, and leave that loop once the statement that holds it is done (`jumps`; `Walker.statement`).
   */
  | { kind: 'substitution'; dead: number; returns: ShellState[]; aborts: ShellState[]; maybes: ShellState[]; jumps: Deferred[] }
  /** `at`: the statement that runs in a subshell of its own (`( )`, `&`), when the target is its. */
  | { kind: 'subshell' | 'maybe'; at?: SyntaxNode }
  /**
   * A trap's action (`exitOnly`: of EXIT alone): a signal may run it between any two statements, so an error that may
   * end the line around it, or a `return`, `break` or `continue` it does not hold, may leave any of them (see `escape`).
   */
  | { kind: 'trap'; exitOnly: boolean; proc?: Target };

/**
 * The process the walk is in (`targets`): the innermost subshell it entered (`( )`, `&`, `$( )`, a pipeline stage), or
 * the process of a trap's action or a function body walked after the rest (`proc`: the one it was set in), or
 * undefined for the shell itself; `ended`: a statement whose own subshell is over (a widening after it is the shell's).
 * What a subshell changes, a trap or a function of another process never sees.
 */
export function processIn(targets: readonly Target[], ended?: SyntaxNode): Target | undefined {
  for (let i = targets.length - 1; i >= 0; i--) {
    const t = targets[i];
    if (t.kind === 'subshell' && (!ended || t.at !== ended)) return t;
    if ((t.kind === 'trap' || t.kind === 'function') && t.proc) return t.proc;
  }
  return undefined;
}

/** Where a body that runs later was set (a trap, a function definition): the number of the change then, and the process. */
export interface SetAt {
  readonly since: number;
  readonly proc: Target | undefined;
}

/** A `break` or `continue` made in a `${ …; }` (from `st`), which bash makes once the statement that holds it is done. */
export interface Deferred { readonly ends: 'loop' | 'pass'; readonly count: number | undefined; readonly st: ShellState }

/**
 * The statement being run, for its `${ …; }`: the jumps they made (`deferred`), and the state before the first of
 * them (`before`), where an error in a word before it leaves the shell (bash expands the words in order).
 */
export interface Statement { deferred: Deferred[]; before?: ShellState }

/** What the slots on the way give another shell besides the script's exported names (`childModel`). */
export interface ChildPass {
  readonly given: readonly string[];
  readonly removed: ReadonlySet<string>;
  readonly invocation: readonly { readonly flag: string; readonly value?: string }[];
}

export const passedMemo = new WeakMap<object, ReadonlyMap<string, VariableState>>();
/**
 * What of a variable of the script reaches another shell (`childStart`, ./child.ts): undefined when it does not (not
 * exported, unset, an array, or IFS, which a shell sets itself when it starts). Kept per bucket of the script's
 * variables, which the states along the script share, so that many strings cost little (`NameMap.mapped`).
 */
export function passed(name: string, v: VariableState): VariableState | undefined {
  const x = v.attrs.x?.state ?? 'off';
  const array = ['a', 'A'].map((l) => v.attrs[l]?.state ?? 'off');
  if (x === 'off' || v.set === 'off' || array.includes('on') || name === 'IFS') return undefined;
  return x === 'on' && v.set === 'on' && !array.includes('unknown')
    ? { declared: 'on', set: 'on', attrs: { x: v.attrs.x! }, ...(v.value !== undefined ? { value: v.value } : {}), at: v.at }
    : { declared: 'unknown', set: 'unknown', attrs: { x: { state: 'unknown', at: v.attrs.x!.at } }, at: v.at };
}

/**
 * Whether the arithmetic expansion `e` cannot fail, though its value is not known: a length (`${#x}`, `${#a[@]}`) is
 * always a number, and with each taken as 1 the expression is a constant that has no `/`, `%` or `**` (`$(( ${#a[@]} * 2 ))`).
 */
export function numberOfLengths(e: SyntaxNode): boolean {
  const text = e.text.replace(/^\$\(\(|\)\)$/g, '');
  if (/[/%]|\*\*/.test(text)) return false;
  const ones = text.replace(/\$\{#[A-Za-z_]\w*(?:\[[@*]\])?\}/g, '1');
  return ones !== text && evalArithWrapping(ones) !== undefined;
}
