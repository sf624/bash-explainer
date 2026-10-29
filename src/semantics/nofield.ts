// Whether a word may give no field at all (manual 3.5.7: "Unquoted implicit null arguments, resulting from the expansion
// of parameters that have no values, are removed"; 3.5.8, nullglob), from the word model (src/semantics/words.ts): each
// word of its brace expansion split as `wordFields` splits it (`braceWords`), with what the model knows of its values,
// and the parts it does not know read as empty, but those that never are (`${#a}`, `$#`, `$?`, `$$`, `$(( ))`, `<( )`).
import type { SyntaxNode } from '../syntax/tree';
import { givesElements } from './elements';
import type { StateModel } from './state';
import { braceWords, type Piece, wordMeaning } from './words';

/** What stands for a part not known here that is never empty: text no IFS removes (a non-blank IFS character still ends a field). */
const SOME: Piece = { text: '1', quoted: false, expanded: false };
/** What stands for `"$@"` or `"${a[@]}"` alone in its quotes: no word when there are no elements, even quoted. */
const ELEMENTS: Piece = { text: '', quoted: false, expanded: true };

/** An expansion whose value is never empty: a length, a count, a status, a PID, arithmetic, a process substitution's path. */
function neverEmpty(n: SyntaxNode): boolean {
  if (n.type === 'arithmetic_expansion' || n.type === 'process_substitution') return true;
  return (n.type === 'simple_expansion' && /^\$[#?$]$/.test(n.text)) || (n.type === 'expansion' && n.text.startsWith('${#'));
}

/** `"$@"`, `"${a[@]}"` alone in double quotes. */
const elementsAlone = (n: SyntaxNode): boolean => n.type === 'string' && n.namedChildren.length === 1 && givesElements(n.namedChildren[0]);

/**
 * Whether the word of `n` (in a word) may give no field where it runs: one that pathname expansion may remove (a glob
 * with nullglob on, or not known off), or each of whose brace words gives no field with the parts not known here empty
 * (or its fields are not known: an IFS not known here). Never in a context of one field, nor where the shell keeps an
 * empty redirection target (dash; bash fails on it), which `braceWords` splits as `wordFields` does.
 */
export function mayGiveNoField(n: SyntaxNode, model: StateModel): boolean {
  // (`n` is in a word: the caller has its meaning.)
  const w = wordMeaning(n, model)!;
  if (w.steps.find((s) => s.kind === 'glob')!.applies !== false && w.glob.nullglob !== 'off') return true;
  // (Brace words that the text after a `$x` lengthens, `$x{b,c}`, are not known here: any may be empty.)
  const words = braceWords(n, model, (part) => (part && neverEmpty(part) ? SOME : part && elementsAlone(part) ? ELEMENTS : ''));
  if (!words) return true;
  // (A word bash fails on, `${x:?}`, has no characters: it is no field, but an error, which other notes say.)
  return words.words.every((x) => !!x.chars && (!x.holed || x.holed.length === 0));
}
