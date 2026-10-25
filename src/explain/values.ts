// The value of an expansion where it runs (docs/design/expansion-values.md): `msg=hello; echo $msg` shows `hello` on
// the token of `$msg`, with the words splitting makes of it. The value is the semantic model's
// (src/semantics/values.ts, `expansionValue`: only what it trusts); this module puts it on the token, with its texts
// (src/messages.ts, `valueSaid`).
import type { Token } from '../analyzer-types';
import { valueSaid } from '../messages';
import { expansionValue } from '../semantics/values';
import type { SyntaxNode } from '../syntax/tree';
import type { Explainer } from './context';

/** `t`, the token of the expansion `n`, with its value where the model knows it for sure. */
export function withValue(cx: Explainer, n: SyntaxNode, t: Token): Token {
  const v = expansionValue(n, cx.state);
  if (v) t.value = { ...v, said: valueSaid(cx.lang, v) };
  return t;
}
