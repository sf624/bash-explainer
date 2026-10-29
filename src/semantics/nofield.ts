// Whether a word may give no field at all (manual 3.5.7: "Unquoted implicit null arguments, resulting from the expansion
// of parameters that have no values, are removed"; 3.5.8, nullglob), from the word model (src/semantics/words.ts): each
// word of its brace expansion, with what the model knows of its values, and the parts it does not know read as possibly
// empty, but those that never are (`${#a}`, `$#`, `$?`, `$$`, `$(( ))`, `<( )`).
import type { SyntaxNode } from '../syntax/tree';
import { type BraceAlternative, wordAlternatives } from './brace';
import type { StateModel } from './state';
import { braceWords, type Char, wordMeaning } from './words';

/** What stands for a part not known here that is never empty: not a blank, so no IFS removes it. */
const SOME = '\x01';
const QUOTED = new Set(['string', 'raw_string', 'ansi_c_string', 'translated_string']);
const BLANKS = ' \t\n';

/** An expansion whose value is never empty: a length, a count, a status, a PID, arithmetic, a process substitution's path. */
function neverEmpty(n: SyntaxNode): boolean {
  if (n.type === 'arithmetic_expansion' || n.type === 'process_substitution') return true;
  return (n.type === 'simple_expansion' && /^\$[#?$]$/.test(n.text)) || (n.type === 'expansion' && n.text.startsWith('${#'));
}

/** Whether a word of a brace expansion has a quoted part: then it is a field, even when empty (`""`, `"$e"`). */
function quoted(alternative: BraceAlternative): boolean {
  return alternative.flatMap((n): readonly (SyntaxNode | string)[] => (typeof n !== 'string' && n.type === 'concatenation' ? n.namedChildren : [n]))
    .some((n) => (typeof n === 'string' ? /['"\\]/.test(n) : QUOTED.has(n.type)));
}

/**
 * Whether the word of `n` (in a word) may give no field where it runs: a word of many fields or a redirection target (where none
 * is an ambiguous redirection), each of whose brace words may expand to nothing, or blanks of the IFS alone, and has
 * no quoted part; or one that pathname expansion may remove (a glob with nullglob on, or not known off).
 */
export function mayGiveNoField(n: SyntaxNode, model: StateModel): boolean {
  // (`n` is in a word: the caller has its meaning.)
  const w = wordMeaning(n, model)!;
  if (w.rule.fields === 'one') return false;
  const step = (kind: string) => w.steps.find((s) => s.kind === kind)!.applies !== false;
  if (step('glob') && w.glob.nullglob !== 'off') return true;
  // (Brace words that the text after a `$x` lengthens, `$x{b,c}`, are not known here: any may be empty.)
  const words = braceWords(n, model, (part) => (part && neverEmpty(part) ? SOME : ''));
  if (!words) return true;
  const alternatives = wordAlternatives(w)!;
  // (The blanks that splitting removes: those of the IFS, any where it is not known.)
  const ifs = w.ifs.kind === 'default' ? BLANKS : w.ifs.kind === 'value' ? w.ifs.value : BLANKS;
  const removed = (c: Char): boolean => step('split') && c.split && BLANKS.includes(c.c) && ifs.includes(c.c);
  // (A word bash fails on, `${x:?}`, has no characters: it is no field, but an error, which other notes say.)
  return words.words.every((x, i) => !quoted(alternatives[i]) && !!x.chars && x.chars.every(removed));
}
