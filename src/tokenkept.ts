// A token that can no longer change: the one a statement over several lines keeps for the document (src/explain/whole.ts). Each line of
// the statement reads it, so a line must never write to it, or to anything under it: the writers that walk a line's tokens (src/tokenmarks.ts,
// src/tokenbases.ts) stop at one, and what a line adds to one is on a copy of it and of the tokens above it (`markTokens`).
import type { Token } from './analyzer-types';

/** Whether `t` is a kept token (and so is everything under it): it is read, not written. */
export const isKept = (t: Token): boolean => Object.isFrozen(t);

/** Keeps `t` and the tokens under it. */
export function keep(t: Token): void {
  Object.freeze(t);
  Object.freeze(t.children);
  t.children.forEach(keep);
}

/**
 * Calls `visit` for `t` and the tokens under it that are not kept, first to last. A kept token, and what is under it, is not visited: it was
 * finished when it was made, and is the same for every line that reads it.
 */
export function eachOwn(t: Token, visit: (t: Token) => void): void {
  if (isKept(t)) return;
  visit(t);
  t.children.forEach((c) => eachOwn(c, visit));
}
