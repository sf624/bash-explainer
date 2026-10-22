// The words of a command as the argument interpreter (src/argv/interpret.ts) takes them: their value after
// quote removal when it is known, the start that is known otherwise, and how many words they become.
import { braceExpand } from '../examples/shellwords';
import { staticWordValue } from '../staticword';
import type { SyntaxNode } from '../syntax/tree';
import type { ArgWord } from './interpret';

/** The text known at the start of a word whose value is not known (`--file=` of `--file=$f`, `-I` of `-I{}`). */
export function prefixOf(n: SyntaxNode): string {
  if (n.type === 'word' || n.type === 'number') return /^(?:\\.|[^\\*?[{~])*/s.exec(n.text)![0].replace(/\\(.)/gs, '$1');
  let out = '';
  if (n.type === 'concatenation') {
    for (const c of n.namedChildren) {
      const v = staticWordValue(c);
      if (v === undefined) return out + prefixOf(c);
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
 * How many words a word gives, when that is not one: a brace expansion its count; a glob at least one;
 * `"$@"`, `"${a[@]}"` and an unquoted expansion an unknown number.
 */
export function countOf(n: SyntaxNode): ArgWord['count'] {
  const parts = n.type === 'concatenation' ? n.namedChildren : [n];
  // (Only in double quotes: `'"$@"'` is text.)
  const many = (c: SyntaxNode): boolean => c.type === 'string' && c.namedChildren.some((e) => e.text === '$@' || /^\$\{[^}]*\[@\]\}$/.test(e.text));
  if (parts.some((c) => UNQUOTED_EXPANSION.has(c.type) || many(c))) return { min: 0 };
  if (parts.every(plainPart)) {
    let words: string[] | undefined;
    try {
      words = braceExpand(n.text);
    } catch {
      // Too many words to list (`{1..100000}`).
      return { min: 1 };
    }
    // (`{a,b}*.txt`: each word is a glob, which gives at least one.)
    if (words && words.length !== 1) return words.some((w) => /(^|[^\\])[*?[]/.test(w)) ? { min: words.length } : { min: words.length, max: words.length };
    if (/(^|[^\\])[*?[]/.test(n.text)) return { min: 1 };
  }
  return undefined;
}

/** A word of the command line as the interpreter reads it. */
export const argWord = (n: SyntaxNode): ArgWord => {
  const value = staticWordValue(n);
  const count = countOf(n);
  return { ...(value !== undefined ? { value } : { prefix: prefixOf(n) }), ...(count ? { count } : {}) };
};
