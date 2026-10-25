// Text as the evaluator of words reads it (src/semantics/words.ts). bash counts, cuts, matches and converts the case
// of characters by the locale it runs in (LC_ALL, LC_CTYPE, LANG), which comes from the environment: characters in a
// UTF-8 locale, bytes in the C locale (`e=é; echo ${#e}` prints 1 or 2; `${e^^}` gives `É` or `é`). The model knows
// neither, so beyond copying a value as it is (`$x`, `"${x}"`, the same bytes in every locale), it reads only ASCII
// text, which every locale reads the same.
import { evalArith } from '../arith';

/** Whether every locale reads `text` the same: it is ASCII. */
export function sameInEveryLocale(text: string): boolean {
  return !/[^\x00-\x7f]/.test(text);
}

/**
 * `${x:offset:length}` (manual 3.5.3) of an ASCII value, from the texts of its offset and length (constant arithmetic;
 * an empty one is 0): a negative offset counts from the end, and one before the start or past the end gives an empty
 * string; a negative length is an end counted from the end. Null where bash fails ("substring expression < 0": the
 * end falls before the offset); undefined when it is not known here (an expression that is not constant, `${x:}`).
 */
export function substring(value: string, offsetText: string, lengthText: string | undefined): string | null | undefined {
  const num = (t: string): number | undefined => (t === '' ? 0 : evalArith(t));
  const offset = num(offsetText);
  const length = lengthText === undefined ? value.length : num(lengthText);
  // (`${x:}` is a bad substitution.)
  if (offset === undefined || length === undefined || (offsetText === '' && lengthText === undefined)) return undefined;
  const start = offset < 0 ? value.length + offset : offset;
  if (start < 0 || start > value.length) return '';
  const end = length < 0 ? value.length + length : Math.min(start + length, value.length);
  return end < start ? null : value.slice(start, end);
}

/** `${x^^}`, `${x,,}`, `${x^}`, `${x,}` (no pattern) of an ASCII value: its letters, or its first one, in capitals or in small letters. */
export function caseConverted(op: '^^' | ',,' | '^' | ',', value: string): string {
  const conv = (s: string): string => (op[0] === '^' ? s.toUpperCase() : s.toLowerCase());
  return op.length === 2 ? conv(value) : conv(value.slice(0, 1)) + value.slice(1);
}
