// The note for an action that find refuses (`find . -exec rm {} ;`), apart from src/explain/argv.ts, which reads find's expression.
import type { ArgvParse } from '../argv/interpret';
import type { CommandSpec } from '../argv/spec';
import { type Fact, fact } from '../messages';
import { replaceRange, textAfter } from '../rewrite';
import type { SyntaxNode } from '../syntax/tree';
import type { Explainer } from './context';

/**
 * The note for an action that find refuses (`find . -exec rm {} ;`): why, and what find prints. Where the cause is the `;`
 * that ends the line (the shell's list operator, so find never gets it), the rewrite writes `\;` in its place.
 */
export function findRefusal(cx: Explainer, nodes: SyntaxNode[], spec: CommandSpec, refusal: NonNullable<ArgvParse['refusal']>): Fact {
  const command = nodes[0].parent!;
  const semicolon = refusal.why === 'missing' ? /^([ \t]*)(;)(?![;&])[ \t]*(?:#.*)?(?:\n|$)/.exec(textAfter(command)) : null;
  const at = semicolon ? command.endIndex + semicolon[1].length : 0;
  return fact(cx.lang, 'find-action-refused', {
    option: refusal.option, why: refusal.why, ...(refusal.word === undefined ? {} : { word: refusal.word }),
    plus: !!spec.options!.find((o) => o.names.includes(refusal.option))?.until?.terminators.includes('+'),
    bare: !!semicolon,
    rewrite: semicolon ? [replaceRange(command, at, at + 1, '\\;')] : [],
  });
}
