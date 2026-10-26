// Brace expansion in the word model (src/semantics/words.ts reads it): which words of a word have one, and whether
// the step applies in the shell the model is of (the manual's 3.5.1; the shells, src/dialect.ts).
import { type Shell, bracesWork } from '../dialect';
import { braceExpand } from '../examples/shellwords';
import type { SyntaxNode } from '../syntax/tree';
import type { Tri } from './state';
import type { Applies, ExpansionStep } from './words';

/** The plain words of a word that have a brace expansion bash expands (`{a,b}`, `{1..3}`). */
export function bracedWords(plain: readonly SyntaxNode[]): SyntaxNode[] {
  return plain.filter((n) => {
    try {
      return braceExpand(n.text) !== undefined;
    } catch {
      return true;
    }
  });
}

/**
 * The brace step of a word whose plain words `braced` have a brace expansion, in a context that has it or not
 * (`context`), with `set -o braceexpand` as `braceOpt` says. The shell must have each kind of brace expansion of
 * the word: none of them in dash and POSIX sh, no ranges in mksh (`dialect`); a shell that has some of them: not known.
 */
export function braceStep(braced: readonly SyntaxNode[], context: boolean, braceOpt: Tri, shell: Shell | undefined, plain: SyntaxNode[]): Omit<ExpansionStep, 'manual'> {
  const works = braced.filter((b) => bracesWork(b.text, shell)).length;
  const dialect: Applies = works === braced.length ? true : works === 0 ? false : 'unknown';
  const brace = context && braced.length > 0;
  const applies: Applies = !brace || dialect === false ? false : braceOpt === 'unknown' || dialect === 'unknown' ? 'unknown' : braceOpt === 'on';
  const why = brace && dialect === false ? 'dialect' : brace && braceOpt !== 'on' ? 'braceexpand-off' : !context ? 'context' : undefined;
  return { kind: 'brace', applies, ...(why ? { why } : {}), parts: brace ? plain : [] };
}
