// The value of an expansion where it runs (docs/design/expansion-values.md): `msg=hello; echo $msg` shows `hello` on
// the token of `$msg`, with the words splitting makes of it. The value is the semantic model's
// (src/semantics/values.ts, `expansionValue`: only what it trusts); this module puts it on the token, with its texts
// (src/messages.ts, `valueSaid`), and gives the worked examples the values of the script where the model has them
// (`${#msg}` of `msg="hello world"` is shown with that value, not with a sample).
import type { Token } from '../analyzer-types';
import { visibleChar } from '../ctlchars';
import type { ParsedExpansion, ScriptValue } from '../expansion';
import { valueSaid } from '../messages';
import { expansionValue, variableValue } from '../semantics/values';
import type { SyntaxNode } from '../syntax/tree';
import type { Explainer } from './context';

/** `t`, the token of the expansion `n`, with its value where the model knows it for sure. */
export function withValue(cx: Explainer, n: SyntaxNode, t: Token): Token {
  const v = expansionValue(n, cx.state);
  const shell = cx.state.shell;
  if (v) t.value = { ...v, said: valueSaid(cx.lang, v, !shell || shell === 'bash') };
  return t;
}

/** The longest value an example shows as it is (the value line cuts longer ones: src/messages.ts). */
const EXAMPLE_VALUE_MAX = 60;

/**
 * Whether an example can show the text `t` as it is, on one line: no control or invisible character (the value line
 * shows them with symbols), no backtick (it would end the code span) and no space at an end (Markdown would drop it).
 */
export function plainValue(t: string): boolean {
  const chars = [...t];
  return chars.length <= EXAMPLE_VALUE_MAX && !/^\s|\s$/.test(t) && chars.every((c) => c !== '`' && c !== '\n' && visibleChar(c) === c);
}

/**
 * The value the script gives the variable of the expansion `n` (`${#msg}`: `msg`) where it runs, and what `n` gives
 * with it when the model knows that too, for its worked example (src/expansion.ts, `exampleFor`): from the model, as
 * on the value line. Undefined when the model is not sure of the value, the variable is unset, or it or the result
 * cannot be shown as they are.
 */
export function scriptValue(cx: Explainer, n: SyntaxNode, p: ParsedExpansion): ScriptValue | undefined {
  const value = variableValue(n, p.name, cx.state);
  const result = expansionValue(n, cx.state)?.text;
  if (typeof value !== 'string' || !plainValue(value) || (result !== undefined && result !== '' && !plainValue(result))) return undefined;
  return result === undefined ? { value } : { value, result };
}

/**
 * The text of the word `n` where it runs, when the model knows it for sure and bash keeps it as one word: an
 * expansion (not split into several words nor globbed), or a double-quoted string of plain text and such expansions
 * (`"$x y"`). For the examples whose subject is a word: `[[ $x == a* ]]`, `case $x in`, `[ "$x" = a ]`, a
 * here-string. Undefined otherwise, or when it cannot be shown as it is.
 */
export function wordValue(cx: Explainer, n: SyntaxNode): string | undefined {
  const one = (x: SyntaxNode): string | undefined => {
    const v = expansionValue(x, cx.state);
    return v && !v.glob && (!v.words || (v.words.length === 1 && v.words[0] === v.text)) ? v.text : undefined;
  };
  // (The examples compute what bash does: in sh and dash they keep their samples.)
  if (cx.state.shell !== undefined && cx.state.shell !== 'bash') return undefined;
  let text: string | undefined;
  if (n.type === 'simple_expansion' || n.type === 'expansion') text = one(n);
  else if (n.type === 'string') {
    text = '';
    let at = n.startIndex + 1;
    for (const c of [...n.namedChildren.filter((x) => x.type !== 'string_content'), undefined]) {
      // (The text between the expansions, with no backslash or other substitution in it.)
      const between = n.text.slice(at - n.startIndex, (c?.startIndex ?? n.endIndex - 1) - n.startIndex);
      const v = c && one(c);
      if (/[\\$`]/.test(between) || (c && v === undefined)) return undefined;
      text += between + (v ?? '');
      if (c) at = c.endIndex;
    }
  }
  return text !== undefined && (text === '' || plainValue(text)) ? text : undefined;
}
