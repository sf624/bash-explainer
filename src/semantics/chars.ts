// Text as the evaluator of words reads it (src/semantics/words.ts). bash counts, cuts, matches and converts the case
// of characters by the locale it runs in (LC_ALL, LC_CTYPE, LANG), which comes from the environment: characters in a
// UTF-8 locale, bytes in the C locale (`e=é; echo ${#e}` prints 1 or 2; `${e^^}` gives `É` or `é`). The model knows
// neither, so beyond copying a value as it is (`$x`, `"${x}"`, the same bytes in every locale), it reads only ASCII
// text, which every locale reads the same.
import { evalArith } from '../arith';
import { parseExpansion } from '../expansion';

/**
 * The characters of IFS that bash counts as IFS whitespace: a run of them around a field is one separator, and they
 * are trimmed at the start and the end (manual 3.5.7 names space, tab and newline; bash tests `isspace`, which in every
 * locale is true of the vertical tab, the form feed and the carriage return too). Word splitting and `read` both.
 */
export const IFS_WHITESPACE = ' \t\n\v\f\r';

/**
 * Characters that bash uses for markers of its own while it expands (CTLESC and CTLNUL): an IFS that holds one splits
 * erratically, even the quoted text of a word with an unquoted expansion, an empty one too (`IFS=$'\x01'; x=;
 * printf '<%s>' $x"b"` prints `<><b>`).
 */
export const IFS_ERRATIC = /[\x01\x7f]/;
/** A character of a field, quoted or not, and whether word splitting may split there (from an unquoted expansion). */
export type Char = { c: string; quoted: boolean; split: boolean };

/**
 * A field as a pattern for globToRegex: quoted characters escaped, a `-`, `^`, `:`, `.` or `=` after an unquoted `[` too
 * (`[a"-"c]`, `['^'a]`; `[[":"alpha:]]` is no class). A backslash from a value before a quoted character is matched as
 * a backslash, as bash does: the character keeps its meaning (`x='\'`: `ls $x"*"` lists the names that start with `\`), or is itself (`ls $x":"*` lists those
 * that start with `\:`; before a letter, a digit or `_`, bash 5.3 reads the backslash as escaping it, and 5.2 does
 * not, which `globField` leaves unknown). bash quotes the characters of IFS in the word's own text too, where the word
 * has an unquoted expansion (`ownChars`).
 */
export function patternOfChars(f: readonly Char[]): string {
  const special = (c: Char, i: number): boolean => /[\\*?[\]()|!@+]/.test(c.c) || (/[\^\-:.=]/.test(c.c) && f.slice(0, i).some((d) => d.c === '[' && !d.quoted));
  return f.map((c, i) => {
    if (c.quoted && special(c, i)) return `\\${c.c}`;
    const next = c.c === '\\' && !c.quoted ? nextChar(f, i) : -1;
    return next >= 0 && f[next].quoted && !special(f[next], next) ? '\\\\' : c.c;
  }).join('');
}

/**
 * Whether a field's pattern depends on the bash release: a backslash of a value before a quoted letter, digit or `_` is
 * matched as a backslash in bash 5.2, and escapes the character in 5.3 (`x='\'; ls $x"b"?` lists `\ba`, or `ba`).
 */
export const releasesDiffer = (f: readonly Char[]): boolean => f.some((c, i) => c.c === '\\' && !c.quoted && f[nextChar(f, i)]?.quoted && /^\w$/.test(f[nextChar(f, i)].c));

/** The index of the character after `i` in the field, past the empty marks of quotes (`""`); -1 at its end. */
export const nextChar = (f: readonly Char[], i: number): number => f.findIndex((d, k) => k > i && d.c !== '');

/**
 * Whether bash's pathname expansion takes `pattern` (a field of `patternOfChars`) as a pattern: an unescaped `*` or
 * `?`, a `[` with a `]` after it in the same name (`[]` too, which is no bracket expression: with nullglob, `x='['; echo
 * :$x]` prints nothing), or, with extglob on, `+(`, `@(` or `!(`. Undefined when that rests on an extglob, with
 * extglob not known.
 */
export function globbedByBash(pattern: string, extglob: 'on' | 'off' | 'unknown'): boolean | undefined {
  let open = false;
  let maybe = false;
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i];
    if (c === '*' || c === '?' || (c === ']' && open)) return true;
    if (c === '[') open = true;
    else if (c === '/') open = false;
    else if ('+@!'.includes(c) && pattern[i + 1] === '(') {
      if (extglob === 'on') return true;
      maybe ||= extglob === 'unknown';
    } else if (c === '\\') i++;
  }
  return maybe ? undefined : false;
}

/**
 * The text a pattern (a field of `patternOfChars`) matches, when nothing in it acts as a wildcard in the matching of a
 * string (`[[ == ]]`, `case`, where `[a/b]` is a bracket expression and `[[ ]]` reads extglobs): no unescaped `*`, `?`,
 * `[`, `]`, `(`, `)` or `|` (a lone `[`, which matches itself, is left as a pattern). Undefined when it may be one.
 */
export function plainPattern(pattern: string): string | undefined {
  return /^(?:[^\\*?[\]()|]|\\[^])*$/.test(pattern) ? pattern.replace(/\\([^])/g, '$1') : undefined;
}

/** A piece of the text of a word: quoted (no split or glob), or unquoted from the source or from an expansion (split). */
export interface Piece { text: string; quoted: boolean; expanded: boolean }

/** The glob characters, whose quoting changes what a pattern matches (and `:`, `.`, `=` after a `[`, `IN_BRACKET`). */
export const GLOB_CHARS = /[*?[\]+@!()|^-]/;
/** The characters whose quoting changes a pattern only after a `[`: they open and close a class (`[[:alpha:]]`), a collating symbol or an equivalence class. */
const IN_BRACKET = /[:.=]/;

/**
 * The characters of the pieces of a word (or of one word of its brace expansion), and where word splitting may split
 * (`splits`: it applies to the word), with the IFS at the word (undefined when not known), whether its context may
 * split (not in an assignment, `[[ ]]` or `case`) and the shell. There bash quotes each character of the word's own
 * unquoted text that is in IFS, so that splitting leaves it. In a word with an unquoted expansion, even an empty one,
 * such a character stays quoted: pathname expansion matches it as itself (`IFS='?'; x=a; ls $x?` lists only `a?`), and
 * a backslash of a value before one is a backslash (`IFS='*'; x='\'; ls $x*` lists the names that start with `\`). In
 * a word with none, bash unquotes every character in IFS, those quoted in the script too (`IFS='*'; ls "*"*` lists
 * every name). So bash 5.2 and 5.3; dash quotes none. With another shell, or an IFS not known, a glob character the
 * rule may change makes the characters not known (undefined): `:`, `.` and `=` too after an unquoted `[` (`IFS=':';
 * ls $x[[:alpha:]]` matches one of `[:alph` and then `]`).
 */
export function ownChars(pieces: readonly Piece[], splits: boolean, at: { ifs?: string; context: boolean | 'unknown'; shell?: string }): Char[] | undefined {
  const { ifs, context, shell } = at;
  const own = (p: Piece, c: string): boolean => !p.quoted && !p.expanded && (ifs === undefined || ifs.includes(c));
  // (Whether bash quotes them, unquotes them all, or neither; and whether that is known.)
  const rule = context === false || shell === 'dash' || shell === 'ash' || ifs === '' || !pieces.some((p) => [...p.text].some((c) => own(p, c))) ? 'none'
    : pieces.some((p) => p.expanded && !p.quoted) ? 'quote' : 'unquote';
  const sure = context === true && (!shell || shell === 'bash') && ifs !== undefined;
  const chars: Char[] = [];
  let bracket = false;
  for (const p of pieces) {
    const split = splits && p.expanded && !p.quoted;
    if (p.quoted && !p.text) chars.push({ c: '', quoted: true, split: false });
    for (const c of p.text) {
      const changes = rule === 'quote' ? own(p, c) : rule === 'unquote' && p.quoted && (ifs === undefined || ifs.includes(c));
      if (changes && !sure && (GLOB_CHARS.test(c) || (bracket && IN_BRACKET.test(c)))) return undefined;
      const quoted = changes && sure ? rule === 'quote' : p.quoted;
      chars.push({ c, quoted, split });
      bracket ||= c === '[' && !quoted;
    }
  }
  return chars;
}

/**
 * The characters that bash keeps quoted in the word's own text (`ownChars`), so that pathname expansion matches them as
 * themselves: those of IFS, where the word has an unquoted expansion and splitting applies (`w`, a word of the model).
 * '' where there are none; undefined where it is not known (the IFS, the context or the shell).
 */
export function quotedIfs(w: { steps: readonly { kind: string; applies: boolean | 'unknown' }[]; ifs: { kind: string; value?: string }; shell?: string }): string | undefined {
  const split = w.steps.find((s) => s.kind === 'split')!;
  if (split.applies === false || w.shell === 'dash' || w.shell === 'ash') return '';
  return w.ifs.kind === 'unknown' || split.applies !== true || (w.shell && w.shell !== 'bash') ? undefined : w.ifs.kind === 'default' ? ' \t\n' : w.ifs.value;
}

/**
 * The text of a plain part of a word (as written, its escapes kept) as bash matches it where it quotes the characters
 * of `ifs` (`quotedIfs`): a backslash put before each glob character of `ifs`, at the places `inserted`, with
 * `offsets` into `written` for each character and the characters `kept`. Undefined where there are none. A character
 * counts where it would mean something: `!`, `@` and `+` before `(`; `!`, `^`, `-`, `:`, `.` and `=` after a `[` (as
 * `patternOfChars`).
 */
export function ifsEscaped(written: string, ifs: string): { text: string; offsets: number[]; inserted: Set<number>; kept: string[] } | undefined {
  let text = '';
  const offsets: number[] = [];
  const inserted = new Set<number>();
  const kept = new Set<string>();
  let open = false;
  // (Each character with its place in the part's text.)
  const put = (s: string, at: number): void => [...s].forEach((c, k) => { text += c; offsets.push(at + k); });
  for (let i = 0; i < written.length; i++) {
    const c = written[i];
    const special = /[*?[\]()|]/.test(c) || (/[!@+]/.test(c) && written[i + 1] === '(') || (/[!^\-:.=]/.test(c) && open);
    if (c === '\\') {
      // (Not a line continuation, which bash removes first: `$x[a\<newline>b]?`.)
      if (written[i + 1] !== '\n') put(written.slice(i, i + 2), i);
      i++;
    } else if (ifs.includes(c) && special) {
      inserted.add(text.length);
      put('\\', i);
      put(c, i);
      kept.add(c);
    } else {
      open ||= c === '[';
      put(c, i);
    }
  }
  return inserted.size ? { text, offsets, inserted, kept: [...kept] } : undefined;
}

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
  if (p?.op === ':' && substringMayFail(part('offset')!, part('length'))) return 'line';
  // (`${!v@}` names the variables whose names start with `v`: no transformation.)
  const t = part('transform');
  return p?.op === '@' && t !== undefined && !TRANSFORMS.has(t) ? 'shell' : undefined;
}

/** `${x^^}`, `${x,,}`, `${x^}`, `${x,}` (no pattern) of an ASCII value: its letters, or its first one, in capitals or in small letters. */
export function caseConverted(op: '^^' | ',,' | '^' | ',', value: string): string {
  const conv = (s: string): string => (op[0] === '^' ? s.toUpperCase() : s.toLowerCase());
  return op.length === 2 ? conv(value) : conv(value.slice(0, 1)) + value.slice(1);
}

/**
 * Word splitting (manual 3.5.7) of characters: `sep` says which are separators (an IFS white space or another IFS
 * character, of an unquoted expansion), `has` whether one surely gives its field text; one that does not (a part that
 * may be empty, fieldshape.ts) makes a field that is there only when it is not empty (`sure: false`).
 */
export function splitOn<T>(chars: readonly T[], sep: (c: T) => 'white' | 'hard' | undefined, has: (c: T) => boolean): { field: T[]; sure: boolean }[] {
  const fields: { field: T[]; sure: boolean }[] = [];
  let cur: T[] = [];
  let sure = false;
  let may = false;
  const white = (k: number): boolean => k < chars.length && sep(chars[k]) === 'white';
  for (let i = 0; i < chars.length; i++) {
    if (!sep(chars[i])) {
      cur.push(chars[i]);
      if (has(chars[i])) sure = true;
      else may = true;
      continue;
    }
    let j = i;
    while (white(j)) j++;
    const hard = j < chars.length && sep(chars[j]) === 'hard';
    if (hard) for (j++; white(j);) j++;
    if (hard || sure || may) fields.push({ field: cur, sure: hard || sure });
    cur = [];
    sure = may = false;
    i = j - 1;
  }
  if (sure || may) fields.push({ field: cur, sure });
  return fields;
}
