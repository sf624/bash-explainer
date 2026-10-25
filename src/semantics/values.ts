// The value of a parameter expansion where it runs, as Meaning shows it (docs/design/expansion-values.md): what the
// script's own assignments give there, only where the model is sure of it. The words are evaluated by the word model
// (src/semantics/words.ts, `trustedPart`), with the values of the variables the decisions trust (src/semantics/trust.ts).
import { ancestor, assignmentsOnly, type SyntaxNode } from '../syntax/tree';
import { shellValueRefused, valueShell } from './shvalues';
import { inAnotherShell, type StateModel } from './state';
import { mayStopAround } from './stops';
import { partMeaning, trustedPart, trustedVariable, wordMeaning, type WordMeaning } from './words';

/** The value of an expansion: the text it gives, and the words that text makes where it is. */
export interface ExpansionValue {
  /** The text the expansion gives (empty: an empty string). */
  text: string;
  /**
   * The words it gives where it is, when it is split (unquoted, in a context that splits): none for an empty value,
   * several for a value with IFS characters. Undefined when it is not split, and for a part of a word with other parts
   * (`joined`).
   */
  words?: string[];
  /** Unquoted where pathname expansion applies, with a glob character in a word: bash matches it against file names (not followed here). */
  glob: boolean;
  /**
   * Unquoted in a word with other parts (`$x/c`, `a$e`, `"$a"$b`): its first and last fields join the text around it
   * (`x='a b'; echo $x/c` gives `a` and `b/c`), so its own words are not said, and a glob makes a pattern of the
   * field it ends up in, not of the value alone.
   */
  joined?: true;
}

/**
 * The value of the parameter expansion `part` (`$x`, `${x}`, `${#x}`, `${x:-w}`, `${x%p}`…) where it runs, when the
 * model knows it for sure: in bash (or in sh and dash, where they read it as bash does: src/semantics/shvalues.ts),
 * outside the strings of another shell, in code that runs and whose states hold wherever it runs
 * (`StateModel.settled`), from variables the model trusts that the script set on every path, never from the
 * environment. Undefined otherwise, and where the shell fails on it.
 */
export function expansionValue(part: SyntaxNode, model: StateModel, around = true): ExpansionValue | undefined {
  const w = shownWord(part, model);
  if (!w) return undefined;
  const meaning = partMeaning(part, model)!;
  if (meaning.split.applies === 'unknown') return undefined;
  const split = meaning.split.applies;
  if (shellValueRefused(part, w, model, meaning.quoted, split)) return undefined;
  const got = trustedPart(part, w, model, meaning.quoted, split);
  if (!got) return undefined;
  // (Nor where another expansion of the statement may fail first: `echo ${e:?} "$e"`; `around`: that is checked.)
  if (around && stopsAround(part, model)) return undefined;
  const glob = meaning.glob.applies !== false && got.fields.some((f) => f.glob);
  if (glob && meaning.glob.applies === 'unknown') return undefined;
  // (Unquoted, and not the whole word: `$x/c`, `a$e`, `"$a"$b`.)
  const joined = !meaning.quoted && !(w.nodes.length === 1 && w.nodes[0] === part);
  return { text: got.text, ...(split && !joined ? { words: got.fields.map((f) => f.text) } : {}), glob, ...(joined ? { joined: true as const } : {}) };
}

/**
 * The value of the variable `name` where the expansion `part` runs (`msg` of `${#msg}`), where the model knows it for
 * sure, as for `expansionValue`: a string, null when it is unset, undefined when it is not known. The worked examples
 * of `${…}` show it (src/explain/values.ts); they compute what bash gives, so only in bash.
 */
export function variableValue(part: SyntaxNode, name: string, model: StateModel): string | null | undefined {
  const w = model.shell === undefined || model.shell === 'bash' ? shownWord(part, model) : undefined;
  return w && !stopsAround(part, model) ? trustedVariable(name, w, model) : undefined;
}

/** Whether another expansion of the statement of `part` may fail before it runs (`echo ${e:?} "$e"`). */
const stopsAround = (part: SyntaxNode, model: StateModel): boolean => mayStopAround(part, model, (e) => !!expansionValue(e, model, false));

/** The meaning of the word of the expansion `part`, when the model may say what `part` gives there (`expansionValue`). */
function shownWord(part: SyntaxNode, model: StateModel): WordMeaning | undefined {
  if ((part.type !== 'simple_expansion' && part.type !== 'expansion') || model.blind !== undefined || !valueShell(model.shell)) return undefined;
  if (inAnotherShell(part) || !model.settled(part)) return undefined;
  for (let x: SyntaxNode | null = part; x; x = x.parent) if (model.dead(x)) return undefined;
  const w = wordMeaning(part, model);
  // (Not one in the word of another expansion, `${x:-$y}`: bash expands it only when the outer one needs it, and the
  // outer one shows what it gives.)
  if (!w || w.context === 'param-word' || w.context === 'param-pattern') return undefined;
  // (A command with no name makes its assignments before it expands its redirections, `a=2 >f$a`: the state the model
  // has there is the one before them.)
  const cmd = ancestor(part, (a) => a.type === 'command');
  return cmd && assignmentsOnly(cmd) && cmd.namedChildren.some((c) => c.field === 'redirect' && c.startIndex <= part.startIndex && part.endIndex <= c.endIndex) ? undefined : w;
}
