// The words a word of `test` or `[` gives, as src/semantics/trust.ts reads them: bash decides which word is an
// operator after expansion, so a word that may give `-v` (or several words) may test a name not known.
import { staticWordValue } from '../staticword';
import type { SyntaxNode } from '../syntax/tree';
import { COPY, type WrittenValue } from './written';

/** Whether `n` is in `[[ ]]` (where `-eq` and the others read arithmetic; in `test` and `[`, integers only). */
export function inExtendedTest(n: SyntaxNode): boolean {
  let x: SyntaxNode | null = n.parent;
  while (x && (x.type === 'binary_expression' || x.type === 'unary_expression' || x.type === 'parenthesized_expression')) x = x.parent;
  return x?.type === 'extended_test';
}

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
      // (A glob gives names of files; a tilde, one word. A brace expansion, a node of its own, gives several words.)
      if (staticWordValue(p) !== undefined) continue;
      if (/[*?[]/.test(p.text)) shape = 'glob';
    } else if (p.type !== 'raw_string' && p.type !== 'ansi_c_string') return 'split';
  }
  return shape;
}

const hasDigits = (text: string): boolean => /[\d-]/.test(text);

/**
 * Whether no unquoted expansion of the variables `splits` in a word of `test` or `[` may give `-v` or more words than
 * one, with each IFS the script may set; and when `numbers` (`[ $# -eq 1 ]`), whether no IFS splits a number. Each
 * value the script gives those variables must be text it wrote, split by each such IFS in turn (not by all of them
 * at once: `IFS=v` and `IFS=:` split `-v:` apart, but `IFS=:` alone gives `-v`). `writes`: the values each variable
 * is given (`appended`: made with `+=`). IFS may also be a copy of a variable
 * (`IFS=$save`) whose values are such text or copies of IFS (`save=$IFS`); it starts as space, tab and newline. The
 * variables IFS takes copies from (and IFS itself), for the walk to check that each copy reads a value the script set
 * there; undefined when a word may be `-v`.
 */
export function testSplits(writes: (name: string) => readonly WrittenValue[], splits: readonly string[], numbers: boolean): ReadonlySet<string> | undefined {
  const chain = new Set<string>(['IFS']);
  // (Each value IFS may have, and whether it has the number of a `$(( ))` in it, which may be any digits or `-`;
  // unset, it splits as the first one does.)
  const values: { text: string; arith?: true }[] = [{ text: ' \t\n' }];
  for (const queue = ['IFS']; queue.length;) {
    const name = queue.pop()!;
    const written = writes(name);
    // (A variable the script never sets may come from the environment; IFS does not: bash sets it.)
    if (!written.length && name !== 'IFS') return undefined;
    for (const v of written) {
      if (v === 'none') continue;
      // (`IFS+=x` adds to a value: then IFS may be any of them together.)
      if (typeof v !== 'object' || v.appended) return undefined;
      const copy = COPY.exec(v.text)?.[1];
      // (An empty value is the one value with no `fixed`, but no names either; a copy of IFS is one of its own values.)
      if (v.fixed || !v.names.length) values.push(...(v.each ?? [v.text]).map((text) => ({ text, ...(v.arith ? { arith: v.arith } : {}) })));
      else if (copy && v.names.length === 1) {
        if (!chain.has(copy)) queue.push(copy);
        chain.add(copy);
      } else return undefined;
    }
  }
  const digits = values.some((ifs) => ifs.arith || hasDigits(ifs.text));
  if (numbers && digits) return undefined;
  // (Text the script gives splits into words it knows, none of them `-v` unless one is: split by each value of IFS,
  // and by blanks (more than bash may split, so a `-v` it gives is found). With digits or `-` that an IFS of a
  // number may split, it may give any word: not known. Text with numbers of `$(( ))` in it, which the value leaves
  // out, too. Unset, the variable gives no word.)
  const pieces = (t: string, ifs: string): string[] => [...ifs].reduce((ws, c) => ws.flatMap((y) => y.split(c)), t.split(/\s/));
  const splitsTo = (t: string, ifs: { text: string; arith?: true }): boolean => (ifs.arith && hasDigits(t)) || pieces(t, ifs.text).includes('-v');
  const notV = (v: WrittenValue): boolean => {
    if (v === 'none') return true;
    if (v === 'number') return !digits;
    if (typeof v !== 'object' || (!v.fixed && v.names.length > 0) || (v.arith && digits) || /[*?[]/.test(v.text)) return false;
    return (v.each ?? [v.text]).every((t) => values.every((ifs) => !splitsTo(t, ifs)));
  };
  // (`x+=v` adds to the value `x` had: with no `-` in any value, no `-v` can come of them. That `x` was set before, and
  // not from the environment, the walk checks: `Trust.copied`.)
  const dash = (v: WrittenValue): boolean => typeof v !== 'object' ? v !== 'none' : v.arith || (v.each ?? [v.text]).some((t) => t.includes('-'));
  for (const name of splits) {
    const written = writes(name);
    if (!written.length || written.some((v) => !notV(v))) return undefined;
    if (written.some((v) => typeof v === 'object' && v.appended) && written.some(dash)) return undefined;
  }
  return chain;
}
