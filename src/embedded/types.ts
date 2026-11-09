import type { Kind } from '../analyzer-types';
import type { Lang } from '../i18n';

/** A token inside an embedded language (regex, sed script, jq filter, awk program). */
export interface EmbeddedToken {
  /** Offsets into the embedded source text. */
  start: number;
  end: number;
  kind: Kind;
  explanation: string;
  children: EmbeddedToken[];
  /** Defaults to the source text between start and end. */
  label?: string;
  /** A regex capture group (or a reference to one): its number, so it can be coloured alike everywhere. */
  group?: number;
  /** A token a hole makes (`isHole`), or about one: where it stands, for the text the catalog has (src/explain/embedded.ts). */
  hole?: HoleMark;
}

/** Where a hole stands, in a position of data of its language; each has a text of the catalog (`hole-…`). */
export type HolePlace = 'regex' | 'class' | 'target-package' | 'target-name' | 'query-word' | 'buildozer' | 'repeat' | 'replacement' | 'perl-replacement' | 'sed-text' | 'address' | 'awk-string' | 'glob' | 'date' | 'printf' | 'echo' | 'tr';

export interface HoleMark {
  place: HolePlace;
  /** The delimiter that a character of the value would end the part at (`s/$x/…/`). */
  delimiter?: string;
  /** Perl reads the text first (`$` and `@` in the value). */
  perl?: boolean;
  /** The reading of what stands around the hole rests on the value (a regex: its end, or a group, an anchor before it). */
  around?: boolean;
  /** In an unquoted word of a bazel query expression, which a blank, `+` or `(` in the value would end. */
  query?: boolean;
  /** The hole this token is about, where the token is not the hole (`repeat`), and what the token is written as. */
  of?: string;
  written?: string;
}

/**
 * An expansion in a word whose text a reader reads (`holedContent`, src/staticword.ts) stands in the text as one character,
 * a Unicode noncharacter, "permanently reserved for internal use" (U+FDD0 and U+FDD1 are the marks of src/messages-levels.ts): the parser masks those a script holds (`maskCarried`), and none of the readers' own
 * tokens is one. The same expansion is the same character, so a text interpolated in an explanation can be put back
 * (src/explain/embedded.ts). A reader claims a hole by a token of a hole (`holeToken`), which only readers do that know
 * the position is data; a hole no token claims, or a reading with an error token (`holeStop`), leaves the word unread.
 */
const HOLE_FIRST = 0xfdd2;
export const HOLE_COUNT = 30;
export const holeChar = (k: number): string => String.fromCharCode(HOLE_FIRST + k);
export const isHole = (c: string | undefined): boolean => c !== undefined && c >= '\ufdd2' && c <= '\ufdef';
export const hasHole = (text: string): boolean => /[\ufdd2-\ufdef]/.test(text);
export const HOLES = /[\ufdd2-\ufdef]/g;

/**
 * Sticky: an escape that would take characters of the value of the hole after it, by who reads it. GNU sed: `\\x4$n`, `\\o1$n`,
 * `\\d06$n`, `\\c$x` (its `\\U` and `\\u` are case conversions, its `\\1` one digit). PCRE: `\\x$n`, `\\o$n`, `\\c$x`, `\\1$n`,
 * `\\p$n` and others (its `\\d` is a digit, and `\\U` and the like it refuses). gawk: `\\x4$n`, `\\1$n`. The escapes of `printf` and `echo -e`: `\\x$n`, `\\u$n`, `\\0$n`.
 */
const ESCAPE_INTO_HOLE = {
  sed: /\\(?:x[0-9a-fA-F]?|o[0-7]{0,2}|d\d{0,2}|c)[\ufdd2-\ufdef]/y,
  awk: /\\(?:x[0-9a-fA-F]?|[0-7]{1,2})[\ufdd2-\ufdef]/y,
  pcre: /\\(?:x[0-9a-fA-F]?|o|c|[0-9]{1,3}|[pPNgkuUlL])[\ufdd2-\ufdef]/y,
  format: /\\(?:x[0-9a-fA-F]?|u[0-9a-fA-F]{0,3}|U[0-9a-fA-F]{0,7}|c|[0-7]{1,3})[\ufdd2-\ufdef]/y,
};
export const escapeIntoHole = (src: string, i: number, reader: keyof typeof ESCAPE_INTO_HOLE): boolean => {
  const re = ESCAPE_INTO_HOLE[reader];
  re.lastIndex = i;
  return re.test(src);
};

/** The token of the hole at `at`, whose explanation the catalog gives. */
export const holeToken = (at: number, place: HolePlace, mark: Omit<HoleMark, 'place'> = {}): EmbeddedToken =>
  ({ start: at, end: at + 1, kind: 'variable', explanation: '', children: [], hole: { place, ...mark } });

/** The tokens of the holes in `src` from `from` to `to`. */
export function holeTokens(src: string, from: number, to: number, place: HolePlace, mark: Omit<HoleMark, 'place'> = {}): EmbeddedToken[] {
  const out: EmbeddedToken[] = [];
  for (let k = from; k < to; k++) if (isHole(src[k])) out.push(holeToken(k, place, mark));
  return out;
}

/** What a reader gives where a hole decides the reading: an error token, which leaves the word unread. */
export const holeStop = (at: number): EmbeddedToken => ({ start: at, end: at + 1, kind: 'error', explanation: '', children: [] });

export type EmbeddedLang = 'regex' | 'sed' | 'awk' | 'jq' | 'printf' | 'echo' | 'date' | 'glob' | 'mode' | 'umask' | 'sortkey' | 'cutfields' | 'cutchars' | 'trset' | 'getopts' | 'getoptshort' | 'getoptlong' | 'perl' | 'gitformat' | 'gitdate' | 'yq4' | 'yq3path' | 'arith' | 'prompt' | 'bazeltarget' | 'bazelquery' | 'bazelcquery' | 'bazelaquery' | 'buildozer';

/** Pick the string for the current language. */
export function pick(lang: Lang) {
  return (ja: string, en: string) => (lang === 'ja' ? ja : en);
}

/** Shift every token (and its children) by `delta`. */
export function shift(tokens: EmbeddedToken[], delta: number): EmbeddedToken[] {
  return tokens.map((t) => ({ ...t, start: t.start + delta, end: t.end + delta, children: shift(t.children, delta) }));
}
