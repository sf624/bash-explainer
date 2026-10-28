// The patterns of a word of a `for` or `select` list, from the word model (src/semantics/words.ts): what the loop runs
// over when no file matches (manual 3.5.1, brace expansion first; 3.5.8, a field with a glob character that is not
// quoted is a pattern, and stays as it is when nothing matches it).
import { isGlob } from '../examples/shellwords';
import type { SyntaxNode } from '../syntax/tree';
import type { StateModel } from './state';
import { braceWords, type Char, patternOfChars } from './words';

/** A field of a word that pathname expansion reads as a pattern: its text after quote removal, and as a pattern (quoted characters escaped); neither where not known. */
export interface FieldPattern { text?: string; pattern?: string }

/** One word of a word's brace expansion (the word itself where it has none), as pathname expansion reads it. */
export interface BracePatterns {
  /** The word as written: `"$d"/*.c` of `"$d"/*.{c,h}`. */
  written: string;
  /** Its fields that are patterns, in order. */
  patterns: FieldPattern[];
  /** How many of its fields are no patterns; `unknown` where an expansion not known here may give some, or make one a pattern. */
  others: number | 'unknown';
}

/** What stands for a part of a word not known here. */
const HOLE = '\0';

/**
 * The words that the word `n` of a `for` or `select` list gives by brace expansion, each with its fields that pathname
 * expansion reads as patterns where it runs. The words and their patterns are known from the syntax where a value is
 * not: `"$d"/*.{c,h}` gives two, `"$d"/*.c` and `"$d"/*.h`, each a pattern whatever `$d` is; a quoted `*` is none
 * (`{"*",*.c}`). A word that holds an expansion not known here is a pattern only for a glob character of its own text;
 * then its text is not known, and a value that word splitting would split is not followed (`$d/*.c` is one pattern).
 * Undefined where the words are not known here (`set +B` on some paths only).
 */
export function wordPatterns(n: SyntaxNode, model: StateModel): BracePatterns[] | undefined {
  const found = braceWords(n, model, HOLE);
  if (!found) return undefined;
  const globs = found.w.steps.find((s) => s.kind === 'glob')!.applies !== false;
  const pattern = (f: readonly Char[]): boolean => globs && isGlob(patternOfChars(f));
  return found.words.map(({ written, fields, chars }): BracePatterns => {
    if (fields) {
      const patterns = fields.filter(pattern);
      return { written, patterns: patterns.map((f) => ({ text: f.map((c) => c.c).join(''), pattern: patternOfChars(f) })), others: fields.length - patterns.length };
    }
    // (A pattern only where it is one whatever the parts not known give, nothing or text: brackets around such a part
    // make a bracket expression only when it gives a character. A part not quoted may hold a glob character, or be
    // split. No characters: bash fails on the word, `${x:?}` with `x` unset.)
    const open = !chars || chars.some((c) => c.c === HOLE && !c.quoted);
    const as = (text: string): Char[] => chars!.map((c) => (c.c === HOLE ? { ...c, c: text } : c)).filter((c) => c.c);
    return chars && pattern(as('')) && pattern(as('x')) ? { written, patterns: [{}], others: 0 } : { written, patterns: [], others: open ? 'unknown' : 1 };
  });
}
