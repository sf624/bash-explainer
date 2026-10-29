// The words of a command as the argument interpreter (src/argv/interpret.ts) takes them: their value after
// quote removal when it is known, the start that is known otherwise, and how many words they become.
import { bracesWork, type Shell } from '../shellfeatures';
import { braceAlternatives, rejoined } from '../semantics/brace';
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
/** The parts of plain text, where a glob character is one. */
const PLAIN = new Set(['word', 'number', 'brace_expression']);
/** A glob character in plain text (`*.txt`; not `\*`, and not in quotes: `'*'` is a part of its own). */
const GLOB = /(^|[^\\])[*?[]/;

type Count = { min: number; max?: number };

/** What the parts of one word of a brace expansion are (the whole word, where its braces do not expand). */
function partsOf(w: readonly (SyntaxNode | string)[]): { split: boolean; text: boolean; glob: boolean } {
  const out = { split: false, text: false, glob: false };
  const visit = (p: SyntaxNode | string): void => {
    if (typeof p === 'string') {
      out.text ||= p !== '';
      out.glob ||= GLOB.test(p);
    } else if (UNQUOTED_EXPANSION.has(p.type)) out.split = true;
    // (Only in double quotes: `'"$@"'` is text. `"${@:2}"`, `"${a[@]/x/y}"` and `"pre$@post"` too: src/semantics/elements.ts.)
    else if (p.type === 'string' && givesElements(p)) {
      out.split = true;
      out.text ||= p.namedChildren.some((e) => e.type === 'string_content');
    } else if (p.type === 'brace_expression' || p.type === 'concatenation') {
      // (The braces and commas of braces that do not expand are text; the parts between them are parts of the word.)
      out.text = true;
      p.namedChildren.forEach(visit);
    } else {
      out.text = true;
      out.glob ||= PLAIN.has(p.type) && GLOB.test(p.text);
    }
  };
  w.forEach(visit);
  return out;
}

/**
 * Whether one word of a brace expansion holds what may make other than one word of it: an unquoted expansion, `"$@"`
 * or `"${a[@]}"`, or a `$` that the braces leave before text bash then reads otherwise (`rejoined`: `{,$x}a` is `$xa`).
 */
export const splitsIn = (w: readonly (SyntaxNode | string)[]): boolean => rejoined(w) || partsOf(w).split;

/**
 * How many words one word of a brace expansion gives (the whole word, where its braces do not expand): with what may
 * split it (`splitsIn`) any number, none or more when nothing else in it is text (`$x`, `"$@"`, `"$@$x"`), one or more
 * otherwise (text in it makes one word of the first element or of nothing: `"pre$@post"` is `prepost`, as an empty
 * string does, `"$@"""`), but none or more where the braces leave a `$` before text; a glob at least one; anything else
 * one. A part of braces that do not expand is text with its parts in it (`set +B; x='p q'; cp {a,$x}` is `{a,p` and `q}`).
 */
function wordCount(w: readonly (SyntaxNode | string)[]): Count {
  const { split, text, glob } = partsOf(w);
  if (rejoined(w)) return { min: 0 };
  if (split) return { min: text ? 1 : 0 };
  return glob ? { min: 1 } : { min: 1, max: 1 };
}

/** The count of words side by side: the sum of each. */
const sum = (counts: Count[]): Count => {
  const max = counts.every((c) => c.max !== undefined) ? counts.reduce((a, c) => a + c.max!, 0) : undefined;
  return { min: counts.reduce((a, c) => a + c.min, 0), ...(max !== undefined ? { max } : {}) };
};

/**
 * How many words a word gives, when that is not one: the sum of what each word of its brace expansion gives
 * (`wordCount`), where `braces` says the step applies (the model's brace step, src/semantics/argwords.ts; without the
 * model, where the `shell` has it, whatever `set +B` says), with its quoted parts (`'%s,'{a..c}` is three words; `'a'{,}`
 * two, `{,}` none); an unquoted expansion an unknown number (`{a,$x}` two or more; `"$@"` none or more).
 */
export function countOf(n: SyntaxNode, shell?: Shell, braces: boolean | 'unknown' = bracesWork(n, shell)): ArgWord['count'] {
  const whole = wordCount(n.type === 'concatenation' ? n.namedChildren : [n]);
  const words = braces === false ? undefined : braceAlternatives([n]);
  // (Too many words to list: `{1..100000}`.)
  const count = words === null ? { min: 1 } : !words ? whole : sum(words.map(wordCount));
  // (With `set -o braceexpand` not known: the word itself, or its words.)
  const either = braces === 'unknown' && words ? (count.min === whole.min && count.max === whole.max ? count : { min: Math.min(count.min, whole.min) }) : count;
  return either.min === 1 && either.max === 1 ? undefined : either;
}

/**
 * The words of the command line as the interpreter reads them, in a script for `shell` (bash when absent); `count` how
 * many words each gives, where the caller knows more than `countOf` (the model's fields, src/semantics/argwords.ts).
 */
export const argWordFor = (shell?: Shell, braces?: (n: SyntaxNode) => boolean | 'unknown', count = (n: SyntaxNode) => countOf(n, shell, braces?.(n))) => (n: SyntaxNode): ArgWord => {
  const value = staticWordValue(n, false, shell);
  const words = count(n);
  return { ...(value !== undefined ? { value } : { prefix: prefixOf(n, shell) }), ...(words ? { count: words } : {}) };
};

/** A word of the command line as the interpreter reads it in bash. */
export const argWord = argWordFor();
