// The words of a command as the argument interpreter (src/argv/interpret.ts) takes them: their value after
// quote removal when it is known, the start that is known otherwise, and how many words they become.
import { bracesWork, type Shell } from '../shellfeatures';
import { braceTexts } from '../semantics/brace';
import { givesElements } from '../semantics/elements';
import { staticWordValue } from '../staticword';
import type { SyntaxNode } from '../syntax/tree';
import type { ArgWord } from './interpret';

/** The text known at the start of a word whose value is not known (`--file=` of `--file=$f`, `-I` of `-I{}`), in a script for `shell`. */
export function prefixOf(n: SyntaxNode, shell?: Shell): string {
  if (n.type === 'word' || n.type === 'number') return /^(?:\\.|[^\\*?[{~])*/s.exec(n.text)![0].replace(/\\(.)/gs, '$1');
  let out = '';
  if (n.type === 'concatenation') {
    for (const c of n.namedChildren) {
      const v = staticWordValue(c, false, shell);
      if (v === undefined) return out + prefixOf(c, shell);
      out += v;
    }
  }
  if (n.type === 'string') {
    for (const c of n.namedChildren) {
      if (c.type !== 'string_content') return out;
      out += c.text;
    }
  }
  return out;
}

const UNQUOTED_EXPANSION = new Set(['simple_expansion', 'expansion', 'command_substitution', 'arithmetic_expansion']);
const plainPart = (c: SyntaxNode): boolean => c.type === 'word' || c.type === 'number' || c.type === 'brace_expression';

/**
 * How many words a word gives, when that is not one: a brace expansion its count (where the `shell` has it); a glob
 * at least one; `"$@"`, `"${a[@]}"` and an unquoted expansion an unknown number (none or more; one or more with
 * text beside them).
 */
export function countOf(n: SyntaxNode, shell?: Shell): ArgWord['count'] {
  const parts = n.type === 'concatenation' ? n.namedChildren : [n];
  // (Only in double quotes: `'"$@"'` is text. `"${@:2}"`, `"${a[@]/x/y}"` and `"pre$@post"` too: src/semantics/elements.ts.)
  const many = (c: SyntaxNode): boolean => c.type === 'string' && givesElements(c);
  // No word at all only when every part may give none: an unquoted expansion, or a string of expansions alone (`"$@"`,
  // `"$@$x"`); text in it makes one word of the first element or of nothing (`"pre$@post"` is `prepost`), as an empty
  // string does (`"$@"""`).
  const none = (c: SyntaxNode): boolean => UNQUOTED_EXPANSION.has(c.type) || (c.type === 'string' && c.namedChildren.length > 0 && !c.namedChildren.some((e) => e.type === 'string_content'));
  if (parts.some((c) => UNQUOTED_EXPANSION.has(c.type) || many(c))) return { min: parts.every(none) ? 0 : 1 };
  if (parts.every(plainPart)) {
    const words = bracesWork(n, shell) ? braceTexts([n]) : undefined;
    // (Too many words to list: `{1..100000}`.)
    if (words === null) return { min: 1 };
    // (`{a,b}*.txt`: each word is a glob, which gives at least one.)
    if (words && words.length !== 1) return words.some((w) => /(^|[^\\])[*?[]/.test(w)) ? { min: words.length } : { min: words.length, max: words.length };
    if (/(^|[^\\])[*?[]/.test(n.text)) return { min: 1 };
  }
  return undefined;
}

/** The words of the command line as the interpreter reads them, in a script for `shell` (bash when absent). */
export const argWordFor = (shell?: Shell) => (n: SyntaxNode): ArgWord => {
  const value = staticWordValue(n, false, shell);
  const count = countOf(n, shell);
  return { ...(value !== undefined ? { value } : { prefix: prefixOf(n, shell) }), ...(count ? { count } : {}) };
};

/** A word of the command line as the interpreter reads it in bash. */
export const argWord = argWordFor();
