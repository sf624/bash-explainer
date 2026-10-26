// What a write gives a variable, as the trust of the decisions reads it (src/semantics/trust.ts): text the script
// wrote, with the names in it, or a value not known; and the names in a text that arithmetic reads.
import { staticWordValue, substitutionNames, tildeParts, tildeSpots } from '../staticword';
import type { SyntaxNode } from '../syntax/tree';

/** The names in an arithmetic text or a value read as one (not the digits of `0x1f` or `16#ff`, nor `${#x}`'s). */
const IDENTIFIERS = /(?<![\w#@.])[A-Za-z_]\w*/g;
export const identifiers = (text: string): string[] => text.match(IDENTIFIERS) ?? [];

/**
 * What a write gives a variable, as src/semantics/trust.ts reads it (its `Value`): text with `names` in it (`fixed`:
 * known in full); `each`: the texts it may take in turn (a `for` variable, the elements of an array); `arith`: with
 * the number of a `$(( ))` in it, which `text` leaves out (digits, maybe a `-`); `appended`: added with `+=` to the
 * value the variable had.
 */
export type WrittenValue = 'number' | 'none' | 'kept' | 'unknown' | { names: string[]; text: string; fixed?: true; each?: string[]; arith?: true; appended?: true };

/**
 * The values of several words given in turn (a list of `for`, the elements of an array): each of their texts, which
 * `$x` may give (`for s in 0; do :; done; IFS=$s` makes IFS `0`), joined by blanks.
 */
export const joined = (values: WrittenValue[]): WrittenValue => {
  if (!values.every((v): v is Extract<WrittenValue, object> => typeof v === 'object')) return 'unknown';
  const each = values.flatMap((v) => v.each ?? [v.text]);
  return { names: values.flatMap((v) => v.names), text: each.join(' '), each, ...(values.some((v) => v.arith) ? { arith: true as const } : {}) };
};

/** A value that is a copy of one variable (`$save`, `${IFS}`, quoted or not): its name. */
export const COPY = /^\$\{?([A-Za-z_]\w*)\}?$/;

/**
 * What the word `v` assigns (undefined: the empty value): text with the names in it, or `unknown`.
 * `renamed`: whether `$(name)` may print something (a function or an alias of `true`: `$(true)` prints nothing only
 * when `true` is the builtin).
 */
export function writtenValue(v: SyntaxNode | undefined, renamed: (name: string) => boolean): WrittenValue {
  if (!v) return { names: [], text: '' };
  const s = substitutionNames(v).some(renamed) ? undefined : staticWordValue(v, true);
  if (s !== undefined) return { names: identifiers(s), text: s, fixed: true };
  // (A tilde gives the value of HOME, `~user` a home not known: `m=~; (( m ))` runs a HOME from the environment.)
  const tildes = tildeSpots(tildeParts([v]), 'assignment');
  if (tildes.some((t) => t.user !== '')) return 'unknown';
  const names: string[] = tildes.length ? ['HOME'] : [];
  const parts: string[] = [];
  let arith = false;
  const known = (n: SyntaxNode): boolean => {
    switch (n.type) {
      case 'word': case 'number': case 'raw_string': case 'string_content':
        parts.push(n.text);
        names.push(...identifiers(n.text));
        return true;
      case 'string': case 'concatenation': return n.namedChildren.every(known);
      case 'simple_expansion': case 'expansion': {
        const m = /^\$\{?([A-Za-z_]\w*)\}?$/.exec(n.text);
        if (m) names.push(m[1]);
        parts.push(n.text);
        return !!m;
      }
      // (A number, which the text leaves out.)
      case 'arithmetic_expansion':
        arith = true;
        return true;
    }
    return false;
  };
  return known(v) ? { names, text: parts.join(''), ...(arith ? { arith: true as const } : {}) } : 'unknown';
}
