// The patterns of a word of a `for` or `select` list, from the word model (src/semantics/words.ts): what the loop runs
// over when no file matches (manual 3.5.1, brace expansion first; 3.5.8, a field with a glob character that is not
// quoted is a pattern, and stays as it is when nothing matches it).
import { isGlob } from '../examples/shellwords';
import { parseExpansion, type ParsedExpansion } from '../expansion';
import { decodedText } from '../staticword';
import { nameText, type SyntaxNode } from '../syntax/tree';
import { attribute, type ShellState, type StateModel } from './state';
import { braceWords, type Char, patternOfChars, wordMeaning } from './words';

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

/** What stands for a part of a word not known here, and for one that may give several fields (`severalFields`). */
const HOLE = '\0';
const SEVERAL = '\x01';

/**
 * Whether the variable `name` may be a nameref to every element of an array (`declare -n r='a[@]'`, or to such a
 * nameref): where it is one whose target is not known here, or on a path that ran what the walk does not read.
 */
function mayRefer(name: string, st: ShellState, inQuotes: boolean, seen: ReadonlySet<string> = new Set()): boolean {
  if (!/^[A-Za-z_]\w*$/.test(name) || seen.has(name)) return false;
  const v = st.variables.get(name);
  // (A name the script has not set may be one after an opaque `source`. Here, not in `attribute`: its other readers would
  // then say that `$@` may be an array, or that a later `x=1` may fail as read-only.)
  if (!v) return !!st.opaque;
  const ref = attribute(st, name, 'n');
  if (ref === 'off') return false;
  if (ref !== 'on' || v.value === undefined) return true;
  const all = /\[([@*])\]$/.exec(v.value);
  return all ? all[1] === '@' || !inQuotes : mayRefer(v.value, st, inQuotes, new Set([...seen, name]));
}

/**
 * Whether the part `n` of a word may give several fields, whatever IFS holds (manual 3.4.2, 3.5.3, 6.7): `"$@"`,
 * `"${a[@]}"`, `"${!a[@]}"`, `"${!x@}"` and their other forms (`${a[@]#x}`, `${@:2}`), quoted or not; `$*`,
 * `${a[*]}`, `${!a[*]}` and `${!x*}` outside double quotes; an indirection (`x='a[@]'`, `${!x}`, also `${!a[0]}`) and a variable that
 * may be a nameref (`declare -n r='a[@]'`, `$r`), whose target may be such an array. Not in a command substitution,
 * whose output is text.
 */
function severalFields(n: SyntaxNode, st: ShellState, quoted = false): boolean {
  if (n.type === 'command_substitution' || n.type === 'process_substitution' || n.type === 'arithmetic_expansion') return false;
  const inQuotes = quoted || n.type === 'string';
  if (n.type === 'simple_expansion' || n.type === 'expansion') {
    const p: Pick<ParsedExpansion, 'name' | 'subscript' | 'prefix' | 'op'> | undefined = n.type === 'simple_expansion' ? { name: nameText(n).slice(1) } : parseExpansion(decodedText(n));
    // (Not read: an indirection with an operator, `${!x:-y}`, which may give the elements of `x='a[@]'` too.)
    if (!p) return true;
    const { name, subscript, prefix, op } = p;
    const all = (c?: string): boolean => c === '@' || (c === '*' && !inQuotes);
    // (`${!…}` gives names or keys, or is an indirection, `${!x}` or `${!a[0]}`: one field only for the `*` forms in quotes.)
    if (prefix === '!' ? !(inQuotes && (op === '*' || subscript === '*')) : prefix !== '#' && (all(subscript) || (subscript === undefined && all(name)))) return true;
    if (!prefix && mayRefer(name, st, inQuotes)) return true;
  }
  return n.namedChildren.some((c) => severalFields(c, st, inQuotes));
}

/**
 * The words that the word `n` of a `for` or `select` list gives by brace expansion, each with its fields that pathname
 * expansion reads as patterns where it runs. The words and their patterns are known from the syntax where a value is
 * not: `"$d"/*.{c,h}` gives two, `"$d"/*.c` and `"$d"/*.h`, each a pattern whatever `$d` is; a quoted `*` is none
 * (`{"*",*.c}`). A word that holds an expansion not known here is a pattern only for a glob character of its own text;
 * then its text is not known, and a value that word splitting would split is not followed (`$d/*.c` is one pattern).
 * Undefined where the words are not known here (`set +B` on some paths only).
 */
export function wordPatterns(n: SyntaxNode, model: StateModel): BracePatterns[] | undefined {
  // (A word of a list is always one.)
  const st = wordMeaning(n, model)!.state;
  const found = braceWords(n, model, (part) => (part && severalFields(part, st) ? SEVERAL : HOLE));
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
    if (!chars) return { written, patterns: [], others: 'unknown' };
    const as = (cs: readonly Char[], text: string): Char[] => cs.map((c) => (c.c === HOLE ? { ...c, c: text } : c)).filter((c) => c.c);
    const sure = (cs: readonly Char[]): boolean => pattern(as(cs, '')) && pattern(as(cs, 'x'));
    // A part that may give several fields makes as many words, which the text around it begins and ends
    // (`"${a[@]}"*.c` gives `x` and `y*.c` with `a=(x y)`): one of them is a pattern where the text between two such
    // parts, or before the first or after the last, is one by itself; the others are not known.
    const at = chars.flatMap((c, i) => (c.c === SEVERAL ? [i] : []));
    if (at.length) {
      const pieces = [-1, ...at].map((from, i) => chars.slice(from + 1, at[i] ?? chars.length));
      return { written, patterns: pieces.some(sure) ? [{}] : [], others: 'unknown' };
    }
    const open = chars.some((c) => c.c === HOLE && !c.quoted);
    return sure(chars) ? { written, patterns: [{}], others: 0 } : { written, patterns: [], others: open ? 'unknown' : 1 };
  });
}
