// The value of an expansion where it runs (docs/design/expansion-values.md): `msg=hello; echo $msg` shows `hello` on
// the token of `$msg`, with the words splitting makes of it. The value is the semantic model's
// (src/semantics/values.ts, `expansionValue`: only what it trusts); this module puts it on the token, with its texts
// (src/messages.ts, `valueSaid`), and gives the worked examples the values of the script where the model has them
// (`${#msg}` of `msg="hello world"` is shown with that value, not with a sample).
import type { Token, ValueReading } from '../analyzer-types';
import { readingLead } from '../messages-values';
import { dataValueAt } from '../wordfacts';
import { sameSpan, spanOf } from '../noteanchors';
import { visibleChar } from '../ctlchars';
import type { ParsedExpansion, ScriptValue } from '../expansion';
import { valueSaid } from '../messages';
import { expansionValue, variableValue } from '../semantics/values';
import type { SyntaxNode } from '../syntax/tree';
import type { Explainer } from './context';
import { isBash } from '../shellfeatures';

/** `t`, the token of the expansion `n`, with its value where the model knows it for sure. */
export function withValue(cx: Explainer, n: SyntaxNode, t: Token): Token {
  const v = expansionValue(n, cx.state);
  if (!v) return t;
  // (A command reads the value as data, and bash may glob it first: the value's line says so as the note does, from the same source.)
  const data = dataValueAt(n, cx.state, cx.shell);
  t.value = { ...v, said: valueSaid(cx.lang, v, isBash(cx.state.shell) === 'yes', data && { command: data.command, globs: data.globs }) };
  return t;
}

/**
 * The token of the expansion `part` among `tokens` (and those under them), given the reading of its known value in the language
 * of the command `command` (docs/design/known-values.md, 4.1), with the text above its rows where they are as the command gets
 * the value where no file name matches.
 */
export function withReading(cx: Explainer, tokens: readonly Token[], part: SyntaxNode, reading: ValueReading, command: string): void {
  const at = spanOf(part);
  const all = (ts: readonly Token[]): Token[] => ts.flatMap((t) => [t, ...all(t.children)]);
  // (The word's expansion has its token, with the value the reading read: `withValue` asks `expansionValue` as `knownCopy` does.)
  const t = all(tokens).find((x) => x.value && sameSpan(x.span, at))!;
  const v = t.value!;
  t.value = { ...v, said: { ...v.said, ...(reading.assumes ? { readingLead: readingLead(cx.lang, command) } : {}) }, reading };
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
 * The value the script gives the variable `name` where the expansion `part` runs, when the model knows it for sure
 * and an example can show it as it is (`plainValue`, or empty), whatever bash makes of the word: for the cases of a
 * test, which read the words with it (`x="a b"; [ $x = y ]` fails).
 */
export function shownValue(cx: Explainer, part: SyntaxNode, name: string): string | undefined {
  const v = variableValue(part, name, cx.state);
  return typeof v === 'string' && (v === '' || plainValue(v)) ? v : undefined;
}

/**
 * The text of the word `n` where it runs, when the model knows it for sure: an expansion, or a double-quoted string of
 * plain text and expansions (`"$x y"`), where bash neither splits nor globs the word. For the examples whose subject
 * is such a word: `[[ $x == a* ]]`, `case $x in`, a here-string (a test's cases read the variable's value itself:
 * `shownValue`). Undefined otherwise, or when it cannot be shown as it is.
 */
export function wordValue(cx: Explainer, n: SyntaxNode): string | undefined {
  const one = (x: SyntaxNode): string | undefined => expansionValue(x, cx.state)?.text;
  // (The examples compute what bash does: in sh and dash they keep their samples.)
  if (isBash(cx.state.shell) !== 'yes') return undefined;
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
