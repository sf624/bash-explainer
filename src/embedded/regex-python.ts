import { SHORTHANDS } from './regex-escapes';
import type { EmbeddedToken } from './types';

// What the regex reader (src/embedded/regex.ts) knows of Python's `re` beside the paths it shares with PCRE (docs/design/python-regex.md,
// sections 3 and 5): its flags and the options they turn on, its escapes of one letter and what each means under the flags, how it
// reads inline flags and the escapes that name a character, and the releases its version notes say.

/** A flag of a Python pattern as the reader knows it: on, off, or not known (a flags argument that is not names of `re`). */
export type FlagState = boolean | 'unknown';

/**
 * What the flags of a Python pattern turn on (docs/design/python-regex.md, 5.2): from the call's flags argument, then from the
 * pattern's inline flags (`(?i)`, `(?i:…)`). `bytes`: the pattern is a bytes literal (`rb'…'`), whose classes are ASCII.
 */
export interface PythonRegexOptions { ascii: FlagState; ignorecase: FlagState; multiline: FlagState; dotall: FlagState; verbose: FlagState; locale: FlagState; unicode: FlagState; bytes: boolean }

/** The options a flag of Python's `re` turns on. */
export type PythonOption = Exclude<keyof PythonRegexOptions, 'bytes'>;

/** No flags, in a str pattern: what a call with no flags argument compiles. */
export const NO_PYTHON_FLAGS: PythonRegexOptions = { ascii: false, ignorecase: false, multiline: false, dotall: false, verbose: false, locale: false, unicode: false, bytes: false };

/**
 * The flags of Python's `re` (3.15): the long name, the short one, the letter of an inline flag, the value, and the option each
 * turns on. `UNICODE` is what a str pattern has already (only its conflicts with the others are read: `pythonFlagsRefused`), `DEBUG` prints the compiled pattern, `NOFLAG` (3.11) is none. The
 * extractor reads the names (src/hosts/python.ts), the reader the letters; the catalog says what each does (`python-regex-flag`).
 */
export const PYTHON_FLAGS = [
  { name: 'ASCII', short: 'A', letter: 'a', value: 256, option: 'ascii' },
  { name: 'IGNORECASE', short: 'I', letter: 'i', value: 2, option: 'ignorecase' },
  { name: 'LOCALE', short: 'L', letter: 'L', value: 4, option: 'locale' },
  { name: 'MULTILINE', short: 'M', letter: 'm', value: 8, option: 'multiline' },
  { name: 'DOTALL', short: 'S', letter: 's', value: 16, option: 'dotall' },
  { name: 'VERBOSE', short: 'X', letter: 'x', value: 64, option: 'verbose' },
  { name: 'UNICODE', short: 'U', letter: 'u', value: 32, option: 'unicode' },
  { name: 'DEBUG', value: 128 },
  { name: 'NOFLAG', value: 0 },
] as const satisfies readonly { name: string; short?: string; letter?: string; value: number; option?: PythonOption }[];

/**
 * The releases since which the reference (`PYTHON_REFERENCE`, src/python-reference.ts) reads a construct of `re` as it does, where that
 * changed in a release still supported (3.11 to 3.14 on 2026-11-08; docs/design/python-regex.md, section 8): the catalog's texts
 * say them, with the release as a parameter.
 */
export const PYTHON_SINCE = {
  /** Global flags not at the start of the pattern (`a(?i)b`) are an error (a DeprecationWarning before). */
  globalFlagsAtStart: '3.11',
  /** `count` of `sub` and `subn`, and `maxsplit` of `split`, passed by position warn (DeprecationWarning). */
  positionalCount: '3.13',
  /** A backslash a string that is not raw keeps, as it starts no escape (`"\\d"`), warns (SyntaxWarning; a DeprecationWarning before). */
  invalidEscape: '3.12',
  /** `\z`, the end of the text (an error before). */
  endZ: '3.14',
} as const;

/**
 * The `ValueError` Python's `re` raises for flags that do not go together, once it has read the pattern (`fix_flags` of its
 * `re._parser`): the flags of the call's argument and the global inline flags (`(?a)`), by whether the pattern is bytes. None where a
 * flag it rests on is not known.
 */
export function pythonFlagsRefused(py: PythonRegexOptions): { message: string; flags: readonly PythonFlag[] } | undefined {
  if (!py.bytes) {
    if (py.locale === true) return { message: 'cannot use LOCALE flag with a str pattern', flags: ['LOCALE'] };
    if (py.ascii === true && py.unicode === true) return { message: 'ASCII and UNICODE flags are incompatible', flags: ['ASCII', 'UNICODE'] };
    return undefined;
  }
  if (py.unicode === true) return { message: 'cannot use UNICODE flag with a bytes pattern', flags: ['UNICODE'] };
  if (py.locale === true && py.ascii === true) return { message: 'ASCII and LOCALE flags are incompatible', flags: ['ASCII', 'LOCALE'] };
  return undefined;
}

/** A flag of Python's `re`, by its long name. */
export type PythonFlag = (typeof PYTHON_FLAGS)[number]['name'];

/** The flags of the inline letters (`(?i)`), by letter. */
export const FLAG_LETTERS: ReadonlyMap<string, (typeof PYTHON_FLAGS)[number]> = new Map(PYTHON_FLAGS.flatMap((f) => ('letter' in f ? [[f.letter, f] as const] : [])));

/**
 * Python's escapes of one letter (its `re` module, 3.15): those it has (any other ASCII letter is "bad escape"), and the meaning of each
 * where it is not the one of `SHORTHANDS`. Outside a set, and inside one (`inClass`: `\b` is a backspace there). A bytes pattern has
 * no `\u`, `\U` nor `\N` (`pythonLetters`).
 */
const PYTHON_LETTERS = { out: 'abBdDfnrsStvwWAZzxuUN', inClass: 'abdDfnrsStvwWxuUN' };
const BYTES_LETTERS = { out: 'abBdDfnrsStvwWAZzx', inClass: 'abdDfnrsStvwWx' };
export const pythonLetters = (bytes: boolean) => (bytes ? BYTES_LETTERS : PYTHON_LETTERS);
const PYTHON_SHORTHANDS: Record<string, { ja: string; en: string }> = {
  // (A str pattern's classes are Unicode: `re.findall(r'\w+', '日本語 abc')` gives both words. `re.ASCII` makes them ASCII: `PYTHON_CLASSES`.)
  w: { ja: '単語の文字1文字（どの文字体系の文字・数字、またはアンダースコア）', en: 'a word character: a letter or digit of any script, or an underscore' },
  W: { ja: '単語の文字以外の1文字（単語の文字は、どの文字体系の文字・数字とアンダースコア）', en: 'a character that is not a word character (a letter or digit of any script, or an underscore)' },
  d: { ja: '10進数字1文字（どの文字体系のものも。全角の「０」なども）', en: 'a decimal digit of any script (`０`, `١`… too)' },
  D: { ja: '10進数字以外の1文字（どの文字体系の10進数字でもない）', en: 'a character that is not a decimal digit of any script' },
  s: { ja: '空白文字1文字（全角スペースなど Unicode の空白も）', en: 'a whitespace character, Unicode whitespace too (the ideographic space…)' },
  S: { ja: '空白文字以外の1文字（Unicode の空白でもない）', en: 'a character that is not whitespace, Unicode whitespace included' },
  b: { ja: '単語の境界（単語の文字は、どの文字体系の文字・数字とアンダースコア。文字は消費しない）', en: 'a word boundary, where a word character (a letter or digit of any script, or an underscore) meets another character (matches no character)' },
  B: { ja: '単語の境界ではない位置（単語の文字は、どの文字体系の文字・数字とアンダースコア）', en: 'a position that is not a word boundary (word characters of any script)' },
  Z: { ja: '文字列の末尾', en: 'the end of the text' },
  v: { ja: '垂直タブ(VT)', en: 'a vertical tab (VT)' },
};

/**
 * Python's classes of one letter where the flags make them otherwise than Unicode: ASCII (`re.ASCII`, or a bytes pattern), and by the
 * locale (`re.LOCALE`, bytes only: `\w`, `\b` and their negations; `\d` and `\s` stay ASCII).
 */
const PYTHON_CLASSES: Record<'ascii' | 'locale', Record<string, readonly [ja: string, en: string]>> = {
  ascii: {
    w: ['ASCII の英数字またはアンダースコア1文字', 'an ASCII word character (a-z, A-Z, 0-9 or an underscore)'],
    W: ['ASCII の英数字とアンダースコア以外の1文字', 'a character that is not an ASCII word character (a-z, A-Z, 0-9, underscore)'],
    d: ['数字（0〜9）1文字', 'a digit 0-9'],
    D: ['0〜9 以外の1文字', 'a character other than 0-9'],
    s: ['ASCII の空白文字1文字（スペース、タブ、改行、復帰文字、改ページ、垂直タブ）', 'an ASCII whitespace character (space, tab, newline, carriage return, form feed, vertical tab)'],
    S: ['ASCII の空白文字以外の1文字', 'a character that is not ASCII whitespace'],
    b: ['単語の境界（単語の文字は ASCII の英数字とアンダースコア。文字は消費しない）', 'a word boundary, where an ASCII word character (a-z, A-Z, 0-9, underscore) meets another character (matches no character)'],
    B: ['単語の境界ではない位置（単語の文字は ASCII の英数字とアンダースコア）', 'a position that is not a word boundary (ASCII word characters)'],
  },
  locale: {
    w: ['実行時のロケールの英数字またはアンダースコア1文字', 'a word character of the current locale (its letters and digits, or an underscore)'],
    W: ['実行時のロケールの英数字とアンダースコア以外の1文字', 'a character that is not a word character of the current locale'],
    b: ['単語の境界（単語の文字は実行時のロケールの英数字とアンダースコア。文字は消費しない）', 'a word boundary, by the word characters of the current locale (matches no character)'],
    B: ['単語の境界ではない位置（単語の文字は実行時のロケールのもの）', 'a position that is not a word boundary, by the word characters of the current locale'],
  },
};

/** What a text of a Python pattern adds where it depends on a flag whose state is not known (`FlagState`), by the option. */
export const IF_FLAG: Record<'ascii' | 'locale' | 'ignorecase' | 'verbose', readonly [ja: string, en: string]> = {
  ascii: ['（フラグが分からない: `re.ASCII` では ASCII の文字のみ）', ' (only ASCII characters with `re.ASCII`: the flags are not known)'],
  locale: ['（フラグが分からない: `re.LOCALE` では実行時のロケールに従う）', ' (by the current locale with `re.LOCALE`: the flags are not known)'],
  ignorecase: ['（フラグが分からない: `re.IGNORECASE` では大文字小文字を区別しない）', ' (in either case with `re.IGNORECASE`: the flags are not known)'],
  verbose: ['（フラグが分からない: `re.VERBOSE` では空白と `#` からのコメントを無視する）', ' (whitespace and a `#` comment are ignored with `re.VERBOSE`: the flags are not known)'],
};

/** What `.` matches in Python's `re`: no newline, unless `re.DOTALL`; by the flag's state. */
export const PYTHON_DOT: Record<'false' | 'true' | 'unknown', readonly [ja: string, en: string]> = {
  false: ['改行以外の任意の1文字', 'any character except a newline'],
  true: ['任意の1文字（`re.DOTALL` なので改行も）', 'any character, a newline too (`re.DOTALL`)'],
  unknown: ['改行以外の任意の1文字（フラグが分からない: `re.DOTALL` では改行も）', 'any character except a newline (a newline too with `re.DOTALL`: the flags are not known)'],
};

/**
 * What a backslash and a letter mean in Python's `re` under the flags in effect: `PYTHON_SHORTHANDS` where Python reads the letter
 * otherwise than `SHORTHANDS`, and the classes ASCII in a bytes pattern or with `re.ASCII`, by the locale with `re.LOCALE`, or Unicode
 * with a word that says the flags are not known.
 */
export function pythonShorthand(py: PythonRegexOptions, c: string): { ja: string; en: string } | undefined {
  const unicode = PYTHON_SHORTHANDS[c] ?? SHORTHANDS[c];
  if (!'wWdDsSbB'.includes(c)) return unicode;
  const said = (t: readonly [string, string], add?: readonly [string, string]) => ({ ja: t[0] + (add ? add[0] : ''), en: t[1] + (add ? add[1] : '') });
  if (py.bytes) {
    const byLocale = c in PYTHON_CLASSES.locale;
    if (byLocale && py.locale === true) return said(PYTHON_CLASSES.locale[c]);
    return said(PYTHON_CLASSES.ascii[c], byLocale && py.locale === 'unknown' ? IF_FLAG.locale : undefined);
  }
  if (py.ascii === true) return said(PYTHON_CLASSES.ascii[c]);
  return py.ascii === 'unknown' ? said([unicode.ja, unicode.en], IF_FLAG.ascii) : unicode;
}

/** The whitespace of Python's VERBOSE (`re._parser.WHITESPACE`). */
export const VERBOSE_SPACE: ReadonlySet<string> = new Set([' ', '\t', '\n', '\r', '\v', '\f']);

/** Past what VERBOSE skips from `i`: whitespace, and `#` comments to the end of their line. */
export function skipVerbose(src: string, i: number): number {
  for (;;) {
    if (VERBOSE_SPACE.has(src[i] ?? '')) i++;
    else if (src[i] === '#') {
      while (i < src.length && src[i] !== '\n') i++;
    } else return i;
  }
}

/**
 * Python's global flags (`(?i)`): where each group of them stands, and the letters they turn on. They may only start the pattern,
 * one after another, past comments `(?#…)` and, with VERBOSE (`verbose`), whitespace and `#` comments; `(?x)` among them turns
 * VERBOSE on for the whole pattern, which Python then reads again with it. A group `_parse_flags` refuses ends them (the reader says
 * its message), and so does a group's own flags (`(?i:…)`).
 */
export function pythonGlobalFlags(src: string, verbose: boolean, bytes: boolean): { letters: string; at: ReadonlySet<number> } {
  const scan = (skip: boolean) => {
    let letters = '';
    const at = new Set<number>();
    for (let i = 0; ;) {
      if (skip) i = skipVerbose(src, i);
      if (src.startsWith('(?#', i)) {
        const close = src.indexOf(')', i);
        if (close < 0) break;
        i = close + 1;
        continue;
      }
      if (!src.startsWith('(?', i) || !FLAG_LETTERS.has(src[i + 2])) break;
      const read = pythonFlags(src, i, bytes);
      if ('error' in read || read.scoped) break;
      at.add(i);
      letters += read.on;
      i = read.end;
    }
    return { letters, at };
  };
  const first = scan(verbose);
  return !verbose && first.letters.includes('x') ? scan(true) : first;
}

/** The least and the most characters a part of a pattern matches (`Infinity`: no most). */
export type Width = readonly [min: number, max: number];

/** What a part of more than one width may match, as the reader says it: "1 to 2 characters", "1 or more characters". */
export function widthSaid([lo, hi]: Width): readonly [ja: string, en: string] {
  return hi === Infinity ? [`${lo}文字以上`, `${lo} or more characters`] : [`${lo}〜${hi}文字`, `${lo} to ${hi} characters`];
}

/** A width repeated: an item of no width repeated without end is none (`0 * Infinity`). */
const times = (a: number, b: number): number => (a === 0 || b === 0 ? 0 : a * b);

/** The counts of a quantifier as written (`*?`, `{2,}`, `{,3}+`): the least and the most. */
function repeatCount(written: string): Width {
  const q = written.length > 1 && /[?+]$/.test(written) ? written.slice(0, -1) : written;
  if (q === '*') return [0, Infinity];
  if (q === '+') return [1, Infinity];
  if (q === '?') return [0, 1];
  // (`{n}`, `{n,}`, `{,m}` or `{n,m}`: the reader takes no other braces for a quantifier.)
  const [, lo, comma, hi] = /^\{(\d*)(,?)(\d*)\}$/.exec(q)!;
  const min = Number(lo || 0);
  return [min, !comma ? min : hi ? Number(hi) : Infinity];
}

/**
 * The width of the tokens of a sequence of a Python pattern `src`, as `getwidth` of its `re._parser` works it out (a lookbehind must
 * have one width), from the reader's tokens before its literals are merged: one token a character. An anchor, a lookaround, a
 * comment and flags match none, a repeat its counts times its item's, alternatives the least and the most of theirs; a group, and a
 * reference, what the reader worked out for the group (`known`, once each: `(?P=n)` too). Undefined where the reader does not know
 * it: an error, a hole, a group with a hole in it.
 */
export function pythonWidth(tokens: readonly EmbeddedToken[], src: string, known: (t: EmbeddedToken) => Width | undefined): Width | undefined {
  let lo = Infinity;
  let hi = 0;
  let items: Width[] = [];
  const branch = () => {
    lo = Math.min(lo, items.reduce((n, w) => n + w[0], 0));
    hi = Math.max(hi, items.reduce((n, w) => n + w[1], 0));
    items = [];
  };
  for (const t of tokens) {
    if (t.hole || t.kind === 'error') return undefined;
    if (t.kind === 'comment') continue;
    let w: Width | undefined = [1, 1];
    if (t.kind === 'operator' && t.label === '|') {
      branch();
      continue;
    }
    if (t.kind === 'operator') {
      // (A quantifier with nothing to repeat is an error token.)
      const item = items.pop()!;
      const [min, max] = repeatCount(src.slice(t.start, t.end));
      w = [times(item[0], min), times(item[1], max)];
    } else if (t.kind === 'keyword' || (t.kind === 'block' && /^\(\?<?[=!]/.test(src.slice(t.start, t.start + 4)))) w = [0, 0];
    else if (t.kind === 'block' || t.kind === 'variable') w = known(t);
    if (!w) return undefined;
    items.push(w);
  }
  branch();
  return [lo, hi];
}

/** Python's types of pattern flags (`TYPE_FLAGS`): at most one in a pattern, and none turned off. */
const TYPE_LETTERS = 'aLu';

/**
 * The inline flags of Python's `re` in the group that opens at `open` (`(?` and a flag letter or `-`), as `_parse_flags` reads them:
 * the letters turned on and off, whether they are the group's (`(?i:…)`, `scoped`) or global (`(?i)`), and the offset after the
 * `:` or `)`; or its message, at its position.
 */
export function pythonFlags(src: string, open: number, bytes: boolean): { on: string; off: string; scoped: boolean; end: number } | { error: string } {
  const error = (message: string, at: number) => ({ error: `${message} at position ${at}` });
  const isFlag = (c: string | undefined) => c !== undefined && FLAG_LETTERS.has(c);
  // (`k` is past the character read, as the tokenizer's `tell()`; its `isalpha` is Unicode's.)
  const letter = (c: string) => /\p{L}/u.test(c);
  let k = open + 2;
  let c = src[k++];
  let on = '';
  let off = '';
  if (c !== '-') {
    for (;;) {
      if (!bytes && c === 'L') return error("bad inline flags: cannot use 'L' flag with a str pattern", k);
      if (bytes && c === 'u') return error("bad inline flags: cannot use 'u' flag with a bytes pattern", k);
      if (TYPE_LETTERS.includes(c) && [...on].some((x) => TYPE_LETTERS.includes(x) && x !== c)) return error("bad inline flags: flags 'a', 'u' and 'L' are incompatible", k);
      on += c;
      c = src[k++];
      if (c === undefined) return error('missing -, : or )', k - 1);
      if (c === ')' || c === '-' || c === ':') break;
      if (!isFlag(c)) return error(letter(c) ? 'unknown flag' : 'missing -, : or )', k - 1);
    }
  }
  if (c === ')') return { on, off, scoped: false, end: k };
  if (c === '-') {
    c = src[k++];
    if (c === undefined) return error('missing flag', k - 1);
    if (!isFlag(c)) return error(letter(c) ? 'unknown flag' : 'missing flag', k - 1);
    for (;;) {
      if (TYPE_LETTERS.includes(c)) return error("bad inline flags: cannot turn off flags 'a', 'u' and 'L'", k);
      off += c;
      c = src[k++];
      if (c === undefined) return error('missing :', k - 1);
      if (c === ':') break;
      if (!isFlag(c)) return error(letter(c) ? 'unknown flag' : 'missing :', k - 1);
    }
  }
  if ([...on].some((x) => off.includes(x))) return error('bad inline flags: flag turned on and off', k - 1);
  return { on, off, scoped: true, end: k };
}

const isOctalDigit = (c: string | undefined): boolean => c !== undefined && c >= '0' && c <= '7';

/**
 * What a Python escape that names a character stands for at `at` (`\x41`, `\u00e9`, `\U0001F600`, `\N{EM DASH}`, octal `\101`),
 * as `_escape` and `_class_escape` of its `re._parser` read it: its length and its code (none for a name, which no table here
 * holds), or Python's message when it refuses it. Octal takes up to three digits; outside a set (`inClass` false) only after `\0`,
 * or as three digits (`\141`), where `\1` is a group. A bytes pattern (`bytes`) has only `\x` and octal.
 */
export function pythonCode(src: string, at: number, inClass: boolean, bytes: boolean): { length: number; code?: number; name?: string; error?: string } | undefined {
  const c = src[at + 1];
  const hex = (bytes ? { x: 2 } : { x: 2, u: 4, U: 8 })[c as 'x'];
  if (hex) {
    let k = at + 2;
    while (k < at + 2 + hex && /[0-9a-fA-F]/.test(src[k] ?? '')) k++;
    const digits = src.slice(at + 2, k);
    const length = 2 + digits.length;
    if (digits.length < hex) return { length, error: `incomplete escape \\${c}${digits} at position ${at}` };
    const code = parseInt(digits, 16);
    return code > 0x10ffff ? { length, error: `bad escape \\${c}${digits} at position ${at}` } : { length, code };
  }
  if (c === 'N' && !bytes) {
    if (src[at + 2] !== '{') return { length: 2, error: `missing { at position ${at + 2}` };
    const close = src.indexOf('}', at + 3);
    if (close === at + 3 || (close < 0 && src.length === at + 3)) return { length: Math.min(4, src.length - at), error: `missing character name at position ${at + 3}` };
    if (close < 0) return { length: src.length - at, error: `missing }, unterminated name at position ${at + 3}` };
    return { length: close + 1 - at, name: src.slice(at + 3, close) };
  }
  const three = isOctalDigit(c) && isOctalDigit(src[at + 2]) && isOctalDigit(src[at + 3]);
  if (!(c === '0' || (isOctalDigit(c) && (inClass || three)))) return undefined;
  let k = at + 2;
  while (k < at + 4 && isOctalDigit(src[k])) k++;
  const code = parseInt(src.slice(at + 1, k), 8);
  if (code > 0o377) return { length: k - at, error: `octal escape value \\${src.slice(at + 1, k)} outside of range 0-0o377 at position ${at}` };
  return { length: k - at, code };
}

/** A str or bytes value as Python's `repr` writes it: what an example shows, and a name in Python's messages. */
export function pyRepr(value: string | undefined, bytes: boolean): string {
  if (value === undefined) return 'None';
  const q = value.includes("'") && !value.includes('"') ? '"' : "'";
  let out = '';
  for (const ch of value) {
    const code = ch.charCodeAt(0);
    if (ch === '\\' || ch === q) out += `\\${ch}`;
    else if (ch === '\t') out += '\\t';
    else if (ch === '\n') out += '\\n';
    else if (ch === '\r') out += '\\r';
    else if (code < 0x20 || code === 0x7f) out += `\\x${code.toString(16).padStart(2, '0')}`;
    else out += ch;
  }
  return `${bytes ? 'b' : ''}${q}${out}${q}`;
}

/** Python's refusal, thrown where its parser raises it; `at`, where a refusal of the tokenizer itself is (a backslash at the end). */
export class Refusal { constructor(readonly message: string, readonly raises: 're.error' | 'IndexError', readonly at?: number) {} }

/**
 * The tokenizer of Python's `re._parser` over a template or a pattern: `next` is the token after the last taken (a backslash with the
 * character after it, or one character), read one ahead, so that a backslash at the very end is refused as soon as it is reached.
 * `seek` starts it at an offset (the regex reader reads a group's head with it: src/embedded/regex-python-read.ts).
 */
export class Tokens {
  index = 0;
  next: string | undefined;
  constructor(readonly src: string) {}
  /** Reads the next token: the first one, then each after the last taken. */
  advance(): void {
    const { src } = this;
    if (this.index >= src.length) {
      this.next = undefined;
      return;
    }
    if (src[this.index] === '\\' && this.index + 1 >= src.length) throw new Refusal(`bad escape (end of pattern) at position ${src.length - 1}`, 're.error', src.length - 1);
    // (A character, as Python's: one past U+FFFF is two units here.)
    const at = src[this.index] === '\\' ? this.index + 1 : this.index;
    this.next = src.slice(this.index, at + (src.codePointAt(at)! > 0xffff ? 2 : 1));
    this.index += this.next.length;
  }
  get(): string | undefined {
    const t = this.next;
    this.advance();
    return t;
  }
  /** Where the next token starts. */
  tell(): number { return this.index - (this.next?.length ?? 0); }
  seek(index: number): void {
    this.index = index;
    this.advance();
  }
  error(message: string, offset = 0): Refusal { return new Refusal(`${message} at position ${this.tell() - offset}`, 're.error'); }
}

/**
 * Why Python refuses a group's name (`checkgroupname` of its `re._parser`), or undefined: one that is no identifier, or in a bytes
 * pattern or template (`bytes`) one past ASCII, which its message writes as `%a` does (`\xNN`).
 */
export function groupNameRefused(name: string, bytes: boolean): string | undefined {
  if (bytes && /[^\x00-\x7f]/.test(name)) return `bad character in group name ${pyRepr(name, false).replace(/[\x80-\xff]/g, (c) => `\\x${c.charCodeAt(0).toString(16).padStart(2, '0')}`)}`;
  if (!/^[\p{XID_Start}_]\p{XID_Continue}*$/u.test(name)) return `bad character in group name ${pyRepr(name, false)}`;
  return undefined;
}
