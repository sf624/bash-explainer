// The expansions that give one word per element (manual 3.4.2 `@`, 3.5.3): `"$@"`, `"${a[@]}"`, `"${@:2}"`, also
// inside a longer double-quoted string (`"pre$@post"`) and unquoted (where each word is then split further). Read by
// the explanation of words and arguments (src/explain/) and by the argument interpreter's words (src/argv/words.ts).
import { parseExpansion } from '../expansion';
import type { SyntaxNode } from '../syntax/tree';
import type { WordMeaning } from './words';

/**
 * The expansions of a word that give one word per element (`givesElements`), where its context makes fields of it
 * (an argument, a `for` list; 3.5): the word then gives none or more fields, the text before them joined to the first
 * and the text after to the last. Not those nested in another expansion or in a substitution (`$(echo "$@")`), and none
 * for the word of a `${x:-word}`, which is part of the word around it.
 */
export function elementsOf(w: WordMeaning): SyntaxNode[] {
  if (w.rule.fields !== 'many' || w.context === 'param-word') return [];
  const out: SyntaxNode[] = [];
  const visit = (n: SyntaxNode): void => {
    if (n.type === 'simple_expansion' || n.type === 'expansion') {
      if (givesElements(n)) out.push(n);
    } else if (!SUBSTITUTIONS.has(n.type)) n.namedChildren.forEach(visit);
  };
  w.nodes.forEach(visit);
  return out;
}

const SUBSTITUTIONS = new Set(['command_substitution', 'process_substitution', 'arithmetic_expansion']);

/**
 * Whether the expansion `n` gives one word per element (manual 3.4.2, 3.5.3): `$@`, `${a[@]}` and `${!a[@]}`,
 * `${!pre@}`, also with a slice, a pattern or case operator, a transform but `A`, `K` and `k`, or `-`, `:-`, `?`,
 * `:?`; a `${x:-…}` or `${x:+…}` whose word has one. Not a length (`${#a[@]}`), nor a `$( )` (one word). A string
 * holds one when one of its parts is one.
 */
export function givesElements(n: SyntaxNode): boolean {
  if (n.type === 'simple_expansion') return n.text === '$@';
  if (n.type === 'string') return n.namedChildren.some(givesElements);
  if (n.type !== 'expansion') return false;
  const p = parseExpansion(n.text);
  if (!p || p.prefix === '#') return false;
  const all = p.name === '@' || p.subscript === '@';
  const word = () => n.namedChildren.some((c) => c.type !== 'variable_name' && c.type !== 'subscript' && givesElements(c));
  if (p.prefix === '!') return (p.subscript === '@' && !p.op) || (!p.subscript && p.op === '@' && p.parts.length === 3);
  if (!p.op || p.op === '?' || p.op === ':?') return all;
  if (p.op === '-' || p.op === ':-') return all || word();
  if (p.op === '+' || p.op === ':+') return word();
  if (p.op === '=' || p.op === ':=') return false;
  return all && !(p.op === '@' && p.parts.some((x) => x.role === 'transform' && /^[AKk]$/.test(x.text)));
}

