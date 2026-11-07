// The words a command replaces with each path or input line before it runs another (find's `{}` of `-exec`, `-execdir`, `-ok` and `-okdir`, xargs's
// `-I%`): the interpreter finds them by their value (`CommandRole.placeholder`, from `PlaceholderSpec`), so `'{}'` and `\{\}` are too.
import type { SyntaxNode } from '../syntax/tree';
import type { Token } from '../analyzer-types';
import type { CommandRole } from '../argv/interpret';
import type { PlaceholderRole } from '../argv/placeholders';
import { spanOf } from '../noteanchors';
import type { Explainer } from './context';
import { sameSpan } from './nodes';

/** The words that the option of `role` replaces, those that are the text alone and those that hold it (`nodes` are the words the role's indices count). */
export interface PlaceholderWords { whole: SyntaxNode[]; within: SyntaxNode[]; role: PlaceholderRole }

/**
 * The words that the option of `role` replaces (`nodes` are the words the role's indices count), made known to the command being explained and to
 * the commands it runs, which read them (`Explainer.command`: `$1` of `sh -c '…' _ {}`).
 */
export function placeholderWords(cx: Explainer, role: CommandRole, nodes: SyntaxNode[]): PlaceholderWords | undefined {
  const p = role.placeholder;
  if (!p) return undefined;
  const found = { whole: p.whole.map((i) => nodes[i]), within: p.within.map((i) => nodes[i]), role: p };
  if (cx.command) {
    const map = (cx.command.placeholders ??= new Map());
    for (const w of found.whole) map.set(w, { by: p.by, text: p.text, with: p.with, within: false });
    for (const w of found.within) map.set(w, { by: p.by, text: p.text, with: p.with, within: true });
  }
  return found;
}

/**
 * Says of the tokens of the words that are the text alone (in `tokens`) that the command around replaces it, and that it reads it, not the one it runs;
 * of a word that holds the text, that it is replaced in it, with what else the word says.
 */
export function markPlaceholders(cx: Explainer, found: PlaceholderWords | undefined, tokens: Token[]): void {
  if (!found) return;
  const { by, text, with: what } = found.role;
  const whole = found.whole.map(spanOf);
  const within = found.within.map(spanOf);
  const mark = (ts: Token[]): void => ts.forEach((t) => {
    if (whole.some((s) => sameSpan(s, t.span))) {
      t.explanation = cx.text('placeholder-replaced', { text, what });
      t.placeholder = what;
      // (Where no operand of the command it runs describes the word, the token is bash's own, a string.)
      t.origin = 'argv';
      t.children = [];
    } else if (within.some((s) => sameSpan(s, t.span))) t.explanation += cx.text('placeholder-within', { text, what, by });
    else mark(t.children);
  });
  mark(tokens);
}
