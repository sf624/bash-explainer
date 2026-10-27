// Whether a plain run of text of a word is an extended glob pattern, as the adapter (./unbash.ts) builds the model's
// nodes: a choice of its own, kept from the grammar used before.

/** A number, as the adapter makes a `number` node of it. */
export const NUMBER = /^-?\d+$/;

/**
 * Whether a plain run of text is an `extglob_pattern` rather than a word in the model. The choice follows
 * the scanner of the grammar used before (tree-sitter-bash), so that the explanations stay the same: it takes a
 * run that starts with a letter or a glob character, whose second character goes on as a word, and that has
 * something besides letters, dots and backslashes in it.
 * `alone` is a run that is a whole pattern. A run before a `|` is always one.
 */
export function extglobLike(t: string, alone: boolean, alternative: boolean, closedByParen: boolean): boolean {
  // The scanner starts only on a letter or one of these.
  if (!/^[A-Za-z?*+@!\\\-).[]/.test(t)) return false;
  // A backslash starts it only before a blank or a quote.
  if (t[0] === '\\' && !/^\\["\s]/.test(t)) return false;
  if (/[*?[]/.test(t)) return t.length < 2 || t[0] === '[' || /[A-Za-z0-9("[?/\\_*|]/.test(t[1]);
  if (alternative) return true;
  if (!alone || NUMBER.test(t)) return false;
  if (t.length === 1) return closedByParen ? !/[A-Za-z]/.test(t) : true;
  if (!/[A-Za-z0-9("[?/\\_*]/.test(t[1])) return false;
  return !/[A-Za-z]/.test(t[0]) || [...t.slice(1)].some((c) => !/[A-Za-z.\\]/.test(c));
}
