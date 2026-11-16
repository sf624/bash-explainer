// Values GNU's tools refuse before they read anything (`ValueSpec.refuses`, src/argv/spec.ts), shared by the entries of
// several tools. Each says only what the tool surely refuses, as GNU coreutils 9.4 reads the value (test/refused-lines.test.ts
// runs each with the real tool); a value it may take, or refuse with another message, gives nothing.
import type { Refused } from '../argv/spec';
import { tx } from '../i18n';

/** The C escapes GNU's tools write for these bytes in their quotes of a word (`'a\tb'`). */
const ESCAPES: Readonly<Record<number, string>> = { 7: 'a', 8: 'b', 9: 't', 10: 'n', 11: 'v', 12: 'f', 13: 'r', 39: "'", 92: '\\' };

/**
 * A word as GNU's tools quote it in a message in the C locale (gnulib's `quote`): in `'…'`, with a backslash before a quote or
 * a backslash, C escapes for controls, and the octal escape of each byte beyond ASCII (`é` is `'\303\251'`).
 */
export function cQuoted(v: string): string {
  let out = '';
  for (const b of new TextEncoder().encode(v)) {
    const e = ESCAPES[b];
    out += e !== undefined ? `\\${e}` : b >= 0x20 && b < 0x7f ? String.fromCharCode(b) : `\\${b.toString(8).padStart(3, '0')}`;
  }
  return `'${out}'`;
}

/**
 * `head -n x`, `tail -c x`: GNU head and tail drop one `-` before the count (head: all but the last; tail: the last), then
 * read a number, after optional blanks and `+`; a value with no digit there is "invalid number of lines" (or bytes), with the
 * rest after the `-` quoted, status 1. A number with a suffix it does not know (`5x`) is refused too, but is left out: the
 * suffixes are many (`1k`, `2MiB`). (`\s` takes more blanks than the C locale's: such a value is not said.)
 */
export const countRefused = (unit: 'lines' | 'bytes', ref: string) => (v: string): Refused | undefined => {
  const rest = v.startsWith('-') ? v.slice(1) : v;
  return /^\s*\+?\d/.test(rest) ? undefined : { says: `invalid number of ${unit}: ${cQuoted(rest)}`, status: 1, ref };
};

/**
 * A count of a field spec of GNU sort, as it reads one (the blanks of the C locale, then a `+` or not, then digits): its digits
 * and length. (Not `\s`: a full-width space is no blank to sort, which then says "invalid number at field start".)
 */
const COUNT = /^[ \t\n\v\f\r]*\+?(\d+)/;

/**
 * `sort -k 0`, `-k 1.0`, `-k 1,0`: GNU sort refuses a key that starts at field 0 or at character 0 of a field, or that ends at
 * field 0, as it reads the option (status 2). A key it cannot read up to there gives nothing.
 */
export function sortKeyRefused(v: string): Refused | undefined {
  const zero = (what: string): Refused => ({ says: `${what} is zero: invalid field specification ${cQuoted(v)}`, status: 2, ref: 'coreutils-sort-invocation' });
  const start = COUNT.exec(v);
  if (!start) return undefined;
  if (/^0+$/.test(start[1])) return zero('field number');
  let rest = v.slice(start[0].length);
  if (rest.startsWith('.')) {
    const char = COUNT.exec(rest.slice(1));
    if (!char) return undefined;
    if (/^0+$/.test(char[1])) return zero('character offset');
    rest = rest.slice(1 + char[0].length);
  }
  rest = rest.replace(/^[bdfgiMhnRrV]*/, '');
  if (!rest.startsWith(',')) return undefined;
  const end = COUNT.exec(rest.slice(1));
  return end && /^0+$/.test(end[1]) ? zero('field number') : undefined;
}

/**
 * `sort -t '\t'`, `join -t ab`: GNU sort and join take a separator of one byte (or `\0`, the NUL byte), and refuse a longer
 * one as they read the option ("multi-character tab"; sort also an empty one, "empty tab"). Neither reads `\t` as a tab,
 * nor splits on tabs by default: the way out is `-t $'\t'`. One character of several bytes is GNU's own refusal.
 */
export const tabRefused = (tool: 'sort' | 'join', status: number, ref: string) => (v: string): Refused | undefined => {
  if (v === '' && tool === 'sort') return { says: 'empty tab', status, ref };
  if (new TextEncoder().encode(v).length <= 1 || v === '\\0') return undefined;
  const why = v === '\\t'
    ? tx(`${tool} は \`\\t\` をタブとして読まない（バックスラッシュと \`t\` の2文字）。タブで区切るには \`-t $'\\t'\` と書く`,
      `${tool} does not read \`\\t\` as a tab: it is a backslash and \`t\`. To split on tabs, write \`-t $'\\t'\``)
    : undefined;
  return { says: `multi-character tab ${cQuoted(v)}`, status, ref, ...(why ? { why } : {}), ...([...v].length === 1 ? { gnu: true as const } : {}) };
};
