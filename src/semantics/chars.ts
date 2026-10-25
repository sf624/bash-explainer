// Text as the evaluator of words reads it (src/semantics/words.ts). bash counts, cuts, matches and converts the case
// of characters by the locale it runs in (LC_ALL, LC_CTYPE, LANG), which comes from the environment: characters in a
// UTF-8 locale, bytes in the C locale (`e=é; echo ${#e}` prints 1 or 2; `${e^^}` gives `É` or `é`). The model knows
// neither, so beyond copying a value as it is (`$x`, `"${x}"`, the same bytes in every locale), it reads only ASCII
// text, which every locale reads the same.
import { evalArith } from '../arith';
import { parseExpansion } from '../expansion';

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

/**
 * Whether bash may fail on `${x:offset:length}` whatever `x` holds: an offset or a length that is not a constant
 * number (`${x:08}`: "value too great for base", `${x:1/0}`), or a negative length, whose end may fall before the
 * offset ("substring expression < 0"). The error discards the rest of the line.
 */
export function substringMayFail(offsetText: string, lengthText: string | undefined): boolean {
  const num = (t: string): number | undefined => (t === '' ? 0 : evalArith(t));
  const length = lengthText === undefined ? 0 : num(lengthText);
  return num(offsetText) === undefined || length === undefined || length < 0;
}

/** The transformations of `${x@op}` (manual 3.5.3); another letter is a bad substitution, which ends the shell. */
export const TRANSFORMS = new Set([...'QEPAKakUuL']);

/**
 * How bash may fail on the expansion `${…}` of the text `text` whatever the variable holds: `line` for a substring
 * whose numbers may fail (`substringMayFail`), `shell` for a transformation bash lacks (`${x@Z}`).
 */
export function expansionFailure(text: string): 'line' | 'shell' | undefined {
  const p = parseExpansion(text);
  const part = (role: string): string | undefined => p?.parts.find((x) => x.role === role)?.text;
  if (p?.op === ':' && substringMayFail(part('offset') ?? '', part('length'))) return 'line';
  // (`${!v@}` names the variables whose names start with `v`: no transformation.)
  const t = part('transform');
  return p?.op === '@' && t !== undefined && !TRANSFORMS.has(t) ? 'shell' : undefined;
}

/** `${x^^}`, `${x,,}`, `${x^}`, `${x,}` (no pattern) of an ASCII value: its letters, or its first one, in capitals or in small letters. */
export function caseConverted(op: '^^' | ',,' | '^' | ',', value: string): string {
  const conv = (s: string): string => (op[0] === '^' ? s.toUpperCase() : s.toLowerCase());
  return op.length === 2 ? conv(value) : conv(value.slice(0, 1)) + value.slice(1);
}
