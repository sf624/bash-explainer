// What the trust of a model's decisions gives its readers (src/semantics/trust.ts computes it; docs/design/
// semantics.md, 4.14): which variables and functions decisions may rely on, and the facts of statements the walk
// checks where it runs them.
import type { CommandSpec } from '../argv/spec';
import type { SyntaxNode } from '../syntax/tree';
import type { DeferredPlan } from './deferred';

export interface Trust {
  /** Why nothing is trusted (no decision at all), when so. */
  readonly blind: string | undefined;
  /** Whether a decision may read the variable `name`. */
  variable(name: string): boolean;
  /** Whether every call of the function `name` is one the walk sees (a plain call in the script). */
  closed(name: string): boolean;
  /**
   * The names that the statement `n` reads as arithmetic where the walk does not run it (a subscript, an offset,
   * `[[ x -eq y ]]`, the value of an integer variable): each must have a value there (else it may come from the
   * environment, as text bash runs).
   */
  arithNames(n: SyntaxNode): readonly string[] | undefined;
  /**
   * The variables whose values the statement `n` copies into IFS (`IFS=$save`), or splits in a word of `test` (`[ $x ]`),
   * which the trust follows (see `testSplits`): each must have a value there that the script wrote.
   */
  copied(n: SyntaxNode): readonly string[] | undefined;
  /** The arrays whose subscripts in the statement `n` are taken as keys (the script declares them associative): each must be so there. */
  associative(n: SyntaxNode): readonly string[] | undefined;
  /**
   * Whether the statement `n` has arithmetic the walk does not run that may fail: a subscript or an offset that is not
   * a plain number (`a[i]=x`, `${s:i}`). An error there discards the rest of the line.
   */
  mayFail(n: SyntaxNode): boolean;
  /**
   * Whether the script may close fd 0, 1 or 2 somewhere (`exec 2>&-`, `f >&-`, `exec 3>&1-`, `>&$x`, `unset
   * BASH_XTRACEFD`): a copy of one of them (`2>&1`) may then fail, as a copy of any other descriptor may.
   */
  readonly fdsMayClose: boolean;
  /**
   * What the scan read of the word `w` of a builtin, whose fields may change what the builtin sets and whose value is
   * not known where it stands (`x=-e; set $x` as `set -e`, or as `set` where `x` is unset): src/semantics/deferred.ts.
   * The walk reads it as its fields where it knows them (`valuesKnown`), and walks again with nothing trusted where
   * they give the builtin what the scan did not read, or where it does not know them, unless the scan read every
   * value it may have and each gives what the word as written gives (`written`).
   */
  deferred(w: SyntaxNode): DeferredPlan | undefined;
  /**
   * Whether every value of the variable `name` is one the walk follows where it is made: text a plain assignment
   * gives in full, or none (`unset x`, `local x`); not where a trap or a callback may set it. The walk reads the
   * fields of a builtin's words (`deferred`) from those alone.
   */
  valuesKnown(name: string): boolean;
}

/** The functions a file's host defines (bats' `run`, `load`…), by name, with their specs (src/dict/bats.ts). */
export type HostCommands = Readonly<Record<string, CommandSpec>>;
export const NO_HOST: HostCommands = {};

/**
 * The trees of the strings the scan reads as part of the script: those of the model (`Scripts` in
 * src/semantics/state.ts), whose walk runs them. So each string is parsed once, and the facts of its statements are
 * the scan's.
 */
export interface StringTrees {
  /** The root of the string that `words` make (`eval a b`, a trap's action); undefined when its text is not known. */
  script(words: readonly SyntaxNode[]): SyntaxNode | undefined;
  /** The root of `text`, the value the word `word` of `alias` gives, read alone (for an alias no command names). */
  alias(word: SyntaxNode, text: string): SyntaxNode;
  /**
   * The root of the alias text `text` with the rest of the simple command `command` (from the offset `rest`, the end of
   * its name unless bash read the words after it as aliases too: `aliasTexts`): the tree the walk runs where it expands
   * the alias there. Past the trees a model makes one per command (`ALIAS_TREES`), a tree shared by the commands of the
   * same text, and `capped` is set.
   */
  expansion(command: SyntaxNode, text: string, rest: number): SyntaxNode;
  /**
   * The root of `text`, a value that a declaration reads again as a compound assignment (`declare -a 'a=(…)'`), read
   * alone as the assignment `name=text`. The walk does not run it: the scan reads it as foreign text, for the
   * declaration.
   */
  compound(name: string, text: string): SyntaxNode;
  readonly capped: boolean;
}

/** Nothing trusted: for a walk that found, as it went, arithmetic reading text not known (see `Walker`). */
export const BLIND: Trust = {
  blind: 'arithmetic reads text not known', variable: () => false, closed: () => false, arithNames: () => undefined, copied: () => undefined, associative: () => undefined, mayFail: () => false,
  fdsMayClose: true, deferred: () => undefined, valuesKnown: () => false,
};

/**
 * What another shell's model trusts (`bash -c S`): its own script's trust, and no more than the outer model's, whose
 * values reach it (exported variables). Nothing, when the outer model trusts nothing.
 */
export function withinTrust(own: Trust, outer: Trust): Trust {
  if (outer.blind !== undefined) return { ...BLIND, blind: outer.blind };
  return {
    ...own, variable: (name) => own.variable(name) && outer.variable(name), valuesKnown: (name) => own.valuesKnown(name) && outer.valuesKnown(name),
    fdsMayClose: own.fdsMayClose || outer.fdsMayClose,
  };
}
