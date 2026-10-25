// The value of a parameter expansion where it runs, as Meaning shows it (docs/design/expansion-values.md): what the
// script's own assignments give there, only where the model is sure of it. The words are evaluated by the word model
// (src/semantics/words.ts, `trustedPart`), with the values of the variables the decisions trust (src/semantics/trust.ts).
import { ancestor, assignmentsOnly, type SyntaxNode } from '../syntax/tree';
import { inAnotherShell, type StateModel } from './state';
import { mayStopAround } from './stops';
import { partMeaning, trustedPart, wordMeaning } from './words';

/** The value of an expansion: the text it gives, and the words that text makes where it is. */
export interface ExpansionValue {
  /** The text the expansion gives (empty: an empty string). */
  text: string;
  /**
   * The words it gives where it is, when it is split (unquoted, in a context that splits): none for an empty value,
   * several for a value with IFS characters. Undefined when it is not split.
   */
  words?: string[];
  /** Unquoted where pathname expansion applies, with a glob character in a word: bash matches it against file names (not followed here). */
  glob: boolean;
}

/**
 * The value of the parameter expansion `part` (`$x`, `${x}`, `${#x}`, `${x:-w}`, `${x%p}`…) where it runs, when the
 * model knows it for sure: in bash, outside the strings of another shell, in code that runs and whose states hold
 * wherever it runs (`StateModel.settled`), from variables the model trusts that the script set on every path, never
 * from the environment. Undefined otherwise, and where bash fails on it.
 */
export function expansionValue(part: SyntaxNode, model: StateModel, around = true): ExpansionValue | undefined {
  if ((part.type !== 'simple_expansion' && part.type !== 'expansion') || model.blind !== undefined || (model.shell !== undefined && model.shell !== 'bash')) return undefined;
  if (inAnotherShell(part) || !model.settled(part)) return undefined;
  for (let x: SyntaxNode | null = part; x; x = x.parent) if (model.dead(x)) return undefined;
  const w = wordMeaning(part, model);
  // (Not one in the word of another expansion, `${x:-$y}`: bash expands it only when the outer one needs it, and the
  // outer one shows what it gives.)
  if (!w || w.context === 'param-word' || w.context === 'param-pattern') return undefined;
  // (A command with no name makes its assignments before it expands its redirections, `a=2 >f$a`: the state the model
  // has there is the one before them.)
  const cmd = ancestor(part, (a) => a.type === 'command');
  if (cmd && assignmentsOnly(cmd) && cmd.namedChildren.some((c) => c.field === 'redirect' && c.startIndex <= part.startIndex && part.endIndex <= c.endIndex)) return undefined;
  const meaning = partMeaning(part, model)!;
  if (meaning.split.applies === 'unknown') return undefined;
  const split = meaning.split.applies;
  const got = trustedPart(part, w, model, meaning.quoted, split);
  if (!got) return undefined;
  // (Nor where another expansion of the statement may fail first: `echo ${e:?} "$e"`; `around`: that is checked.)
  if (around && mayStopAround(part, model, (e) => !!expansionValue(e, model, false))) return undefined;
  const glob = meaning.glob.applies !== false && got.fields.some((f) => f.glob);
  if (glob && meaning.glob.applies === 'unknown') return undefined;
  return { text: got.text, ...(split ? { words: got.fields.map((f) => f.text) } : {}), glob };
}
