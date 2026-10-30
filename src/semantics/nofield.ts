// Whether a word may give no field at all (manual 3.5.7: "Unquoted implicit null arguments, resulting from the expansion
// of parameters that have no values, are removed"; 3.5.8, nullglob), from the word model (src/semantics/words.ts): each
// word of its brace expansion split as `wordFields` splits it (`braceWords`), with what the model knows of its values,
// and the parts it does not know read as empty, but those that never are (`${#a}`, `$#`, `$?`, `$$`, `$(( ))`, `<( )`).
import { parseExpansion } from '../expansion';
import type { SyntaxNode } from '../syntax/tree';
import { givesElements } from './elements';
import { attribute, refTarget, type ShellState, type StateModel } from './state';
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

/**
 * `${n:=w}` of an integer `n` in `st`: never empty, since bash assigns it a number where it is unset or empty
 * (`declare -i n; ${n:=b=5}` gives `5`), and a number gives a field with any IFS. Not where the value it holds may be
 * other text, given before the attribute (`n=' '; declare -i n; ${n:=5}` gives no field).
 */
function integerDefault(n: SyntaxNode, st: ShellState): boolean {
  const p = n.type === 'expansion' ? parseExpansion(n.text) : undefined;
  if (!p || p.op !== ':=' || p.prefix || p.subscript !== undefined) return false;
  const target = refTarget(st, p.name);
  const v = st.variables.get(target);
  return attribute(st, target, 'i') === 'on' && !!v && v.declared === 'on' && (v.set === 'off' || (v.set === 'on' && v.value !== undefined && /^(-?\d+)?$/.test(v.value)));
}

/**
 * Whether the word `n` is a lone `${n:=w}` of an integer (`integerDefault`) where the IFS holds no digit and no `-`: one
 * field, the number (with IFS `-5`, `-5` gives two).
 */
export function givesOneNumber(n: SyntaxNode, model: StateModel): boolean {
  if (n.type !== 'expansion') return false;
  const w = wordMeaning(n, model)!;
  return integerDefault(n, w.state) && (w.ifs.kind === 'default' || (w.ifs.kind === 'value' && !/[\d-]/.test(w.ifs.value)));
}

/**
 * `"$@"`, `"${a[@]}"` alone in double quotes, also with a slice, a pattern, case or transform operator, or `${@:+x}`:
 * nothing when there are no elements. Not with `-`, `:-` (the word instead, quoted), `?`, `:?` (an error), nor a
 * `${x:+"$@"}` (the word's elements are those of a word in quotes: `"${x:+"$@"}"` is one word).
 */
function elementsAlone(n: SyntaxNode): boolean {
  const e = n.type === 'string' && n.namedChildren.length === 1 ? n.namedChildren[0] : undefined;
  if (!e) return false;
  if (/^\$\{(@|[A-Za-z_]\w*\[@\]):?\+/.test(e.text)) return true;
  if (!givesElements(e) || e.type !== 'expansion') return givesElements(e);
  const op = parseExpansion(e.text)!.op;
  return !['-', ':-', '?', ':?', '+', ':+'].includes(op ?? '');
}

/**
 * Whether the word of `n` (in a word) may give no field where it runs: one that pathname expansion may remove (a glob
 * with nullglob on, or not known off), or each of whose brace words gives no field with the parts not known here empty
 * (or its fields are not known: an IFS not known here), with brace expansion or without where that is not known. Never in a context of one field, nor where the shell keeps an
 * empty redirection target (dash; bash fails on it), which `braceWords` splits as `wordFields` does.
 */
export function mayGiveNoField(n: SyntaxNode, model: StateModel): boolean {
  // (`n` is in a word: the caller has its meaning.)
  const w = wordMeaning(n, model)!;
  if (w.steps.find((s) => s.kind === 'glob')!.applies !== false && w.glob.nullglob !== 'off') return true;
  // (Brace expansion on some paths only, `if c; then set +B; fi`: none where either reading may give none.)
  const applies = w.steps[0].applies;
  return (applies === 'unknown' ? [false, true] : [applies]).some((braces) => {
    // (Brace words that the text after a `$x` lengthens, `$x{b,c}`, are not known here: any may be empty.)
    const words = braceWords(n, model, (part) => (part && (neverEmpty(part) || integerDefault(part, w.state)) ? SOME : part && elementsAlone(part) ? ELEMENTS : ''), braces);
    // (A word bash fails on, `${x:?}`, has no characters: it is no field, but an error, which other notes say.)
    return !words || words.words.every((x) => !!x.chars && (!x.holed || x.holed.length === 0));
  });
}
