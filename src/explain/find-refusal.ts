// The note for an action that find refuses (`find . -exec rm {} ;`), apart from src/explain/argv.ts, which reads find's expression.
import type { ArgvParse } from '../argv/interpret';
import type { CommandSpec } from '../argv/spec';
import { fact } from '../messages';
import { replaceRange, textAfter } from '../rewrite';
import { hasError, type SyntaxNode } from '../syntax/tree';
import type { Explainer } from './context';

/**
 * The note for an action that find refuses (`find . -exec rm {} ;`): why, and what find prints. Where the cause is the `;`
 * that ends the line (the shell's list operator, so find never gets it), the rewrite writes `\;` in its place, as a word of
 * its own (`{};` becomes `{} \;`, and a `#` right after it starts a comment again: `\; #`); none when the action has no
 * command. It is noted on the option. None where bash rejects the line (`find . -exec rm {} ;;`): find never runs.
 */
export function findRefusal(cx: Explainer, nodes: SyntaxNode[], spec: CommandSpec, refusal: NonNullable<ArgvParse['refusal']>): void {
  const command = nodes[0].parent!;
  if (rejected(command)) return;
  // (`-exec ;`: no word after the option.)
  const noCommand = refusal.why === 'missing' && refusal.at === nodes.length - 1;
  const semicolon = refusal.why === 'missing' ? /^([ \t]*);(?![;&])([ \t]*)(#.*)?(?:\n|$)/.exec(textAfter(command)) : null;
  const at = semicolon ? command.endIndex + semicolon[1].length : 0;
  // (`{};` is the word `{}` and the operator `;`: `{}\;` would be the one word `{};`. `;#` starts a comment, `\;#` a word.)
  const last = command.children[command.children.length - 1];
  const glued = !!semicolon && !semicolon[1];
  const hash = !!semicolon?.[3] && !semicolon[2];
  const from = glued ? last.startIndex : at;
  const code = `${glued ? `${last.text} ` : ''}\\;${hash ? ' #' : ''}`;
  cx.note(fact(cx.lang, 'find-action-refused', {
    option: refusal.option, why: refusal.why, ...(refusal.word === undefined ? {} : { word: refusal.word }),
    plus: !!spec.options!.find((o) => o.names.includes(refusal.option))?.until?.terminators.includes('+'),
    bare: !!semicolon, noCommand,
    rewrite: semicolon && !noCommand ? [replaceRange(command, from, at + (hash ? 2 : 1), code)] : [],
  }), nodes[refusal.at]);
}

/** Whether bash rejects the line of `n` before it runs any of it: a syntax error in the statement that holds `n`, or on its lines. */
function rejected(n: SyntaxNode): boolean {
  let top = n;
  while (top.parent!.parent) top = top.parent!;
  const root = top.parent!;
  return root.children.some((c) => hasError(c) && c.startPosition.row <= top.endPosition.row && c.endPosition.row >= top.startPosition.row);
}
