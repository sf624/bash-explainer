// The note of a command line its tool refuses (`ArgvParse.refused`, src/argv/refusals.ts), said once for the command: on
// the word at fault, or on the command where no word is (`cut f`). find's `-exec` without its end has a fact of its own
// (src/explain/find-refusal.ts), and env's string it cannot split is said by its value's token (`splice-refused`).
import type { ArgvParse } from '../argv/interpret';
import { fact } from '../messages';
import type { SyntaxNode } from '../syntax/tree';
import type { Explainer } from './context';

/**
 * Says that the tool of `parse` (or of the subcommand it reads) refuses its line, where the spec gives what it prints. `nodes`
 * are the words the parse read, and `head` the command, or the word that names it (`sudo cut -d ab`: `cut`).
 */
export function refusalNote(cx: Explainer, parse: ArgvParse, nodes: readonly SyntaxNode[], head: SyntaxNode): void {
  let p = parse;
  for (let sub = subcommandOf(p); !p.refused && sub; sub = subcommandOf(p)) p = sub;
  const r = p.refused;
  // (`cut -f 0 "$f"`: refused unless `$f` is `--help`, which the line does not say.)
  if (!r || r.kind === 'until' || r.kind === 'split' || r.unlessInforms) return;
  const program = (p.program ?? p.command.split(' ')[0]).split('/').pop()!;
  const word = r.kind === 'modes' ? r.option : r.kind === 'value' ? r.value : r.kind === 'operand' ? r.operand : undefined;
  const at = r.at === undefined ? head : nodes[r.at];
  // (A warning, where only GNU's tool refuses it, is said only where the shell gets to it, as the error is by its level.)
  if (!cx.reachedAt(at)) return;
  cx.note(fact(cx.lang, 'command-refused', {
    program, kind: r.kind, says: r.says, status: r.status,
    ...(word === undefined ? {} : { word }),
    ...(r.kind === 'modes' ? { after: r.after, ...(r.again ? { again: true } : {}) } : r.kind === 'value' ? { option: r.option } : r.kind === 'needs' ? { options: r.options } : r.as ? { as: r.as } : {}),
    ...(r.bare ? { bare: true } : {}), ...(r.also ? { also: r.also } : {}), ...(r.gnu ? { gnu: true } : {}), ...(r.why ? { why: r.why } : {}),
    ...(r.impl ? { impl: r.impl } : {}), ...(r.ref ? { ref: r.ref } : {}),
  }), at);
}

function subcommandOf(p: ArgvParse): ArgvParse | undefined {
  const sub = p.roles.find(({ role }) => role.role === 'subcommand')?.role;
  return sub?.role === 'subcommand' ? sub.parse : undefined;
}
