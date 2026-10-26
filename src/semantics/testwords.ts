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

/** What a write gives a variable, as src/semantics/trust.ts reads it (its `Value`). */
export type WrittenValue = 'number' | 'none' | 'kept' | 'unknown' | { names: string[]; text: string; fixed?: true };

/** A value that is a copy of one variable (`$save`, `${IFS}`, quoted or not): its name. */
export const COPY = /^\$\{?([A-Za-z_]\w*)\}?$/;

/**
 * Whether no unquoted expansion of the variables `splits` in a word of `test` or `[` may give `-v` or more words than
 * one, with every IFS the script may set; and when `numbers` (`[ $# -eq 1 ]`), whether no IFS splits a number. Each
 * value the script gives those variables must be text it wrote, split by every such IFS. `writes`: the values each
 * variable is given. IFS may also be a copy of a variable (`IFS=$save`) whose values are such text or copies of IFS
 * (`save=$IFS`), which starts as space, tab and newline. The variables IFS takes copies from (and IFS itself), for the
 * walk to check that each copy reads a value the script set there; undefined when a word may be `-v`.
 */
export function testSplits(writes: (name: string) => readonly WrittenValue[], splits: readonly string[], numbers: boolean): ReadonlySet<string> | undefined {
  const chain = new Set<string>(['IFS']);
  const texts: string[] = [];
  for (const queue = ['IFS']; queue.length;) {
    const name = queue.pop()!;
    const values = writes(name);
    // (A variable the script never sets may come from the environment; IFS does not: bash sets it.)
    if (!values.length && name !== 'IFS') return undefined;
    for (const v of values) {
      if (v === 'none') continue;
      if (typeof v !== 'object') return undefined;
      const copy = COPY.exec(v.text)?.[1];
      // (An empty value is the one value with no `fixed`, but no names either.)
      if (v.fixed || !v.names.length) texts.push(v.text);
      else if (copy && v.names.length === 1) {
        if (copy === 'IFS') texts.push(' \t\n');
        else if (!chain.has(copy)) queue.push(copy);
        chain.add(copy);
      } else return undefined;
    }
  }
  const separators = texts.join('');
  const digits = /[\d-]/.test(separators);
  if (numbers && digits) return undefined;
  // (Text the script gives splits into words it knows, none of them `-v` unless one is: with any blank or IFS
  // character as a separator, a word `-v` stays one. Text with numbers of `$(( ))` in it, which the value leaves
  // out, too. Unset, the variable gives no word.)
  const notV = (v: WrittenValue): boolean => {
    if (v === 'none') return true;
    if (v === 'number') return !digits;
    if (typeof v !== 'object' || (!v.fixed && (v.names.length > 0 || digits)) || /[*?[]/.test(v.text)) return false;
    return !v.text.split(/\s/).some((x) => [...separators].reduce((ws, c) => ws.flatMap((y) => y.split(c)), [x]).includes('-v'));
  };
  for (const name of splits) {
    const values = writes(name);
    if (!values.length || values.some((v) => !notV(v))) return undefined;
  }
  return chain;
}
