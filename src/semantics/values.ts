// The value of a parameter expansion where it runs, as Meaning shows it (docs/design/expansion-values.md): what the
// script's own assignments give there, only where the model is sure of it. The words are evaluated by the word model
// (src/semantics/words.ts, `trustedPart`), with the values of the variables the decisions trust (src/semantics/trust.ts).
import { ancestor, assignmentsOnly, descendants, field, fields, type SyntaxNode } from '../syntax/tree';
import { staticWordText } from '../staticword';
import { shellValueRefused, valueShell } from './shvalues';
import { inAnotherShell, type StateModel } from './state';
import { mayStopAround } from './stops';
import { partMeaning, trustedPart, trustedVariable, wordFields, wordMeaning, type WordMeaning } from './words';
import { isBash } from '../shellfeatures';

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
 * environment. Undefined otherwise, and where the shell fails on it. `around` false: only whether the value is known,
 * for the check of the other expansions of the statement (one bash may leave unexpanded cannot fail either).
 */
export function expansionValue(part: SyntaxNode, model: StateModel, around = true): ExpansionValue | undefined {
  const w = shownWord(part, model, around);
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
 * The name of the variable the expansion `part` copies as it is: `$x` or `${x}` (docs/design/known-values.md, 2). Not
 * another form (`${x%.*}`, `${x:-d}`), a positional or special parameter (`$1`, `$@`), nor a name split by a line
 * continuation.
 */
export function copiedName(part: SyntaxNode): string | undefined {
  if (part.type === 'simple_expansion' && /^\$[A-Za-z_]\w*$/.test(part.text)) return part.text.slice(1);
  return part.type === 'expansion' && /^\$\{[A-Za-z_]\w*\}$/.test(part.text) ? part.text.slice(2, -1) : undefined;
}

/**
 * The expansion the word `word` is made of alone, where it is a plain copy of a variable: `$x`, `${x}`, `"$x"` or `"${x}"`
 * (`copiedName`). Not one inside a larger word.
 */
export function plainCopy(word: SyntaxNode): SyntaxNode | undefined {
  const inner = word.type === 'string' && word.namedChildren.length === 1 && word.text === `"${word.namedChildren[0].text}"` ? word.namedChildren[0] : word;
  return copiedName(inner) !== undefined ? inner : undefined;
}

/** The word of which the expansion `part` is a plain copy (`plainCopy`): the string `"$x"` around it, or `part` itself. */
export function copyingWord(part: SyntaxNode): SyntaxNode {
  const p = part.parent!;
  return plainCopy(p)?.startIndex === part.startIndex ? p : part;
}

/**
 * The assignment word whose text the expansion `part` copies (docs/design/known-values.md, 6.1): the value word of the
 * one plain assignment that gave the variable its value on every path to `part` (`VariableState.source`: `x='^a'`,
 * `local x=…`, `declare -r x=…`, `readonly X=…`, `export x=…`), where `part` is a plain copy (`copiedName`),
 * `expansionValue` gives its value, and the word's static text is that value. None after two paths with two words
 * (`if c; then p=a; else p=a; fi`), after `p+=b`, where the value is made of other words (`p=$q`), or for a variable a
 * function call reached with another word than the walk it reused (`StateModel.mixedSources`). Which assignment
 * reaches `part` is the walk's, not the text's order: `f() { grep -E "$re" file; }; re='^a'; f` copies `'^a'`.
 */
export function valueOrigin(part: SyntaxNode, model: StateModel): SyntaxNode | undefined {
  const name = copiedName(part);
  // (Not a variable a reused walk of a function may hold another call's word of: `StateModel.mixedSources`.)
  const value = name === undefined || model.mixedSources.has(name) ? undefined : expansionValue(part, model);
  if (!value) return undefined;
  // (The state the word model read the variable in, as `expansionValue` did: `part` is in a word, and the variable is
  // in the state, since one the script never set has no value there.)
  const source = wordMeaning(part, model)!.state.variables.get(name!)!.source;
  const text = source && staticWordText(source, model.shell)?.text;
  return text === value.text ? source : undefined;
}

const usesKept = new WeakMap<StateModel, ReadonlyMap<SyntaxNode, readonly SyntaxNode[]>>();

/**
 * The uses of each assignment word (docs/design/known-values.md, 6.2 and 7): the expansions of the model's tree whose
 * `valueOrigin` it is, in the order of the text. One pass over the tree, kept by the model. Not those of a string
 * another shell, or `eval`, runs: they are in a tree of their own.
 */
export function valueUses(model: StateModel): ReadonlyMap<SyntaxNode, readonly SyntaxNode[]> {
  let uses = usesKept.get(model);
  if (!uses) {
    const index = new Map<SyntaxNode, SyntaxNode[]>();
    for (const part of descendants(model.root, ['simple_expansion', 'expansion'])) {
      const origin = valueOrigin(part, model);
      if (!origin) continue;
      const list = index.get(origin);
      if (list) list.push(part);
      else index.set(origin, [part]);
    }
    usesKept.set(model, (uses = index));
  }
  return uses;
}

/**
 * The value the word `word` passes to its command as it is, where the model knows it (docs/design/known-values.md, 2): the
 * word is a plain copy of a variable (`plainCopy`), `expansionValue` gives its value, and bash makes one field of the word
 * that is that value, where no file name matches it (`wordFields` with no files). `assumes`: the value is a glob pattern, so
 * it is the value only where no file name matches (nullglob and failglob off: the word model says so). Not where the word
 * model decides nothing with no files (an absolute pattern, a `.` segment, a script that changes its directory), nor for a
 * value it splits into several fields.
 */
export function knownCopy(word: SyntaxNode, model: StateModel): { part: SyntaxNode; value: ExpansionValue; quoted: boolean; assumes?: 'no-match' } | undefined {
  const part = plainCopy(word);
  const value = part && expansionValue(part, model);
  // (The whole word: never joined to other text.)
  if (!value || (value.words && value.words.length !== 1)) return undefined;
  const { fields } = wordFields(word, model, { files: [] });
  if (fields?.length !== 1 || fields[0] !== value.text) return undefined;
  // (Quoted: from the word model, which also decides what bash does to the part.)
  return { part: part!, value, quoted: partMeaning(part!, model)!.quoted, ...(value.glob ? { assumes: 'no-match' as const } : {}) };
}

/**
 * The value of the variable `name` where the expansion `part` runs (`msg` of `${#msg}`), where the model knows it for
 * sure, as for `expansionValue`: a string, null when it is unset, undefined when it is not known. The worked examples
 * of `${…}` show it (src/explain/values.ts); they compute what bash gives, so only in bash.
 */
export function variableValue(part: SyntaxNode, name: string, model: StateModel): string | null | undefined {
  const w = isBash(model.shell) === 'yes' ? shownWord(part, model) : undefined;
  return w && !stopsAround(part, model) ? trustedVariable(name, w, model) : undefined;
}

/** Whether another expansion of the statement of `part` may fail before it runs (`echo ${e:?} "$e"`). */
const stopsAround = (part: SyntaxNode, model: StateModel): boolean => mayStopAround(part, model, (e) => !!expansionValue(e, model, false));

/** The meaning of the word of the expansion `part`, when the model may say what `part` gives there (`expansionValue`). */
function shownWord(part: SyntaxNode, model: StateModel, skips = true): WordMeaning | undefined {
  if ((part.type !== 'simple_expansion' && part.type !== 'expansion') || model.blind !== undefined || !valueShell(model.shell)) return undefined;
  if (inAnotherShell(part) || !model.settled(part)) return undefined;
  for (let x: SyntaxNode | null = part; x; x = x.parent) if (model.dead(x) || (skips && maySkip(x))) return undefined;
  const w = wordMeaning(part, model);
  // (Not one in the word of another expansion, `${x:-$y}`: bash expands it only when the outer one needs it, and the
  // outer one shows what it gives.)
  if (!w || w.context === 'param-word' || w.context === 'param-pattern') return undefined;
  // (A command with no name makes its assignments before it expands its redirections, `a=2 >f$a`: the state the model
  // has there is the one before them.)
  const cmd = ancestor(part, (a) => a.type === 'command');
  return cmd && assignmentsOnly(cmd) && cmd.namedChildren.some((c) => c.field === 'redirect' && c.startIndex <= part.startIndex && part.endIndex <= c.endIndex) ? undefined : w;
}

/**
 * Whether bash may leave `n` unexpanded where the walk does not follow it: the right side of `&&` or `||` in `[[ ]]`
 * (`[[ $x = *.txt || $x = *.sh ]]` reads the second `$x` only when the first test fails), and a pattern of `case`
 * after the first (`case $x in a) …;; $y) …;; esac` expands `$y` only when `a` does not match).
 */
function maySkip(n: SyntaxNode): boolean {
  const p = n.parent;
  if (p?.type === 'binary_expression' && field(p, 'right') === n) return ['&&', '||'].includes(field(p, 'operator')!.text);
  if (p?.type !== 'case_item' || !fields(p, 'value').includes(n)) return false;
  return p.parent!.namedChildren.find((c) => c.type === 'case_item') !== p || fields(p, 'value')[0] !== n;
}
