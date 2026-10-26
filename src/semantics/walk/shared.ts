// What the parts of the walk of the shell state share (src/semantics/walk/walker.ts): the errors that stop a part of
// it, where jumps go, and the parser of the texts it reads (aliases, arithmetic).
import { createUnbashParser } from '../../syntax/adapters/unbash';
import type { BashParser, SyntaxNode } from '../../syntax/tree';
import type { ShellState } from '../shellstate';

export const NAME = /^[A-Za-z_]\w*$/;

export const SUBSTITUTIONS = ['command_substitution', 'process_substitution'];

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
  assign?: { append: boolean; text: string | undefined; array: boolean; source?: SyntaxNode };
}
