// The words a word of `test` or `[` gives, as src/semantics/trust.ts reads them: bash decides which word is an
// operator after expansion, so a word that may give `-v` (or several words) may test a name not known.
import { staticWordValue } from '../staticword';
import type { SyntaxNode } from '../syntax/tree';

/**
 * How many words a word of `test` or `[` that is not static text gives: one (`"$x"`, `x"$y"`, `~/a`); `glob`: one
 * or more names of files (`/tmp/*`); `number`: one, a number, unless IFS splits it (`$#`); `variable`: an unquoted
 * `$x`, which splits as its value does; `split`: words not known (`"$@"`, `$x$y`, `$(cmd)`, `{a,b}`).
 */
export function testWordShape(word: SyntaxNode): 'one' | 'glob' | 'number' | 'split' | { variable: string } {
  if (/^\$(?:[#?$!]|\{(?:#[A-Za-z_]\w*|[#?$!])\}|\(\(.*\)\))$/s.test(word.text)) return 'number';
  const variable = /^\$\{?([A-Za-z_]\w*)\}?$/.exec(word.text);
  if (variable) return { variable: variable[1] };
  const parts = word.type === 'concatenation' ? word.namedChildren : [word];
  let shape: 'one' | 'glob' = 'one';
  for (const p of parts) {
    if (p.type === 'string') {
      // (`"$@"`, `"${a[@]}"` and `"${!p@}"` give a word per element.)
      if (/\$\{?[!#]?(?:@|[A-Za-z_]\w*\[@\])|\$\{![A-Za-z_]\w*@\}/.test(p.text)) return 'split';
    } else if (p.type === 'word' || p.type === 'number') {
      // (A brace expansion gives several words; a glob, names of files; a tilde, one word.)
      if (staticWordValue(p) !== undefined) continue;
      if (p.text.includes('{')) return 'split';
      if (/[*?[]/.test(p.text)) shape = 'glob';
    } else if (p.type !== 'raw_string' && p.type !== 'ansi_c_string') return 'split';
  }
  return shape;
}
