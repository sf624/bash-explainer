// The words an option replaces with each path before it runs a command (find's `{}` of `-exec`, `-execdir`, `-ok` and `-okdir`): the interpreter
// finds them by their value (`CommandRole.placeholders`, from the option's `until.placeholder`), so `'{}'` and `\{\}` are too.
import type { SyntaxNode } from '../syntax/tree';
import type { Token } from '../analyzer-types';
import type { CommandRole } from '../argv/interpret';
import { spanOf } from '../noteanchors';
import type { Explainer } from './context';
import { sameSpan } from './nodes';

/**
 * The words that the option of `role` replaces (`nodes` are the words the role's indices count), made known to the command being explained and to
 * the commands it runs, which read them (`Explainer.command`: `$1` of `sh -c '…' _ {}`).
 */
export function placeholderWords(cx: Explainer, role: CommandRole, nodes: SyntaxNode[]): SyntaxNode[] {
  const words = (role.placeholders ?? []).map((i) => nodes[i]);
  if (cx.command) for (const w of words) (cx.command.placeholders ??= new Map()).set(w, role.of!);
  return words;
}

/** Says of the tokens of `words` (in `tokens`) that the option replaces them, and that it reads them, not the command it runs. */
export function markPlaceholders(cx: Explainer, words: readonly SyntaxNode[], tokens: Token[]): void {
  const spans = words.map(spanOf);
  const mark = (ts: Token[]): void => ts.forEach((t) => {
    if (spans.some((s) => sameSpan(s, t.span))) {
      t.explanation = cx.text('find-exec-placeholder');
      t.placeholder = true;
      // (Where no operand of the command it runs describes the word, the token is bash's own, a string.)
      t.origin = 'argv';
      t.children = [];
    } else mark(t.children);
  });
  mark(tokens);
}
