import { wordTable } from './wordtable';
/**
 * Bracket expressions in shell patterns (`[abc]`, `[!a-c]`, `[]]`, `[\^a]`, `[[:alpha:]_]`): where one ends,
 * what it holds, and the regular expression for it. The rules are those of bash's `case` and `[[ == ]]`
 * (manual 3.5.8.1), in the C locale; what bash reads in a way that is unclear or depends on the locale is not read.
 */

/** One thing in a bracket expression: a character, a range of characters or a named class (`[:alpha:]`). */
export type BracketItem = { type: 'char'; ch: string } | { type: 'range'; from: string; to: string } | { type: 'class'; name: string };

/** The characters of the classes bash knows (POSIX's, and bash's `word` and `ascii`), as the inside of a JS character class. */
const CLASSES: Record<string, string> = wordTable({
  digit: '0-9', alpha: 'A-Za-z', alnum: 'A-Za-z0-9', upper: 'A-Z', lower: 'a-z', space: ' \t\n\r\f\v', blank: ' \t',
  xdigit: '0-9A-Fa-f', punct: '!-/:-@\\[-`{-~', cntrl: '\u0000-\u001f\u007f', graph: '!-~', print: ' -~',
  word: 'A-Za-z0-9_', ascii: '\u0000-\u007f',
});

/**
 * The `]` that closes the bracket expression opened at `open` (a `]` first, a `[:class:]` inside and a
 * backslash-escaped `]` do not close it), or -1 when it never closes: the `[` is then an ordinary character.
 */
export function bracketEnd(pattern: string, open: number, to = pattern.length): number {
  let j = open + 1;
  if (pattern[j] === '!' || pattern[j] === '^') j++;
  if (pattern[j] === ']') j++;
  for (; j < to; j++) {
    const c = pattern[j];
    if (c === '\\') j++;
    else if (c === '[' && /^[:.=]$/.test(pattern[j + 1])) {
      const close = pattern.indexOf(`${pattern[j + 1]}]`, j + 2);
      if (close > 0 && close < to) j = close + 1;
    } else if (c === ']') return j;
  }
  return -1;
}

/**
 * What is inside a bracket expression (the text between the brackets), and whether it is negated (`!` or `^` first).
 * Undefined where bash's reading is unclear or depends on the locale: a `[:`, `[.` or `[=` that is not closed (bash
 * then drops or keeps the `[` by rules of its own), a class name that is not a word, a collating symbol of more than
 * one character (`[.space.]` is a name from bash's own table), an equivalence class (`[=a=]`: which characters are
 * equivalent depends on the locale), a range with a collating symbol at an end (compared with the locale's order) and
 * a range that ends in a class (`[a-[:digit:]]` matches nothing at all in bash, not even the `a`).
 */
export function bracketItems(body: string): { negated: boolean; items: BracketItem[] } | undefined {
  const negated = body[0] === '!' || body[0] === '^';
  let i = negated ? 1 : 0;
  /** One character (an escaped one, or a `[.x.]` element) or one class; undefined when it is not read (see above). */
  const read = (): { item: BracketItem; symbol?: boolean } | undefined => {
    if (body[i] === '[' && /^[:.=]$/.test(body[i + 1])) {
      const kind = body[i + 1];
      const close = body.indexOf(`${kind}]`, i + 2);
      const name = body.slice(i + 2, close);
      // (`[.\.]`: bash's count of a match in `${x/p/r}` reads the backslash as an escape; see patsubMiscounts.)
      if (close < 0 || kind === '=' || (kind === '.' && (name.length !== 1 || name === '\\')) || (kind === ':' && !/^\w+$/.test(name))) return undefined;
      i = close + 2;
      return kind === ':' ? { item: { type: 'class', name } } : { item: { type: 'char', ch: name }, symbol: true };
    }
    if (body[i] === '\\' && i + 1 < body.length) i++;
    return { item: { type: 'char', ch: body[i++] } };
  };
  const items: BracketItem[] = [];
  while (i < body.length) {
    const got = read();
    if (!got) return undefined;
    const { item } = got;
    // A `-` that is not last makes a range with the next character (a `\-` is the character itself).
    if (item.type === 'char' && body[i] === '-' && i + 1 < body.length) {
      i++;
      const hi = read();
      if (!hi || hi.item.type !== 'char' || got.symbol || hi.symbol) return undefined;
      items.push({ type: 'range', from: item.ch, to: hi.item.ch });
    } else items.push(item);
  }
  return { negated, items };
}

const escapeInClass = (c: string): string => c.replace(/[\\\]\[^-]/, '\\$&');

/** The JS character class for the text between the brackets; undefined where `bracketItems` does not read it. */
export function bracketRegex(body: string): string | undefined {
  const read = bracketItems(body);
  if (!read) return undefined;
  const set = read.items.map((item) => {
    if (item.type === 'class') return CLASSES[item.name] ?? '';
    if (item.type === 'char') return escapeInClass(item.ch);
    // (A range out of order matches nothing in bash.)
    return item.from <= item.to ? `${escapeInClass(item.from)}-${escapeInClass(item.to)}` : '';
  }).join('');
  return `[${read.negated ? '^' : ''}${set}]`;
}

/**
 * Whether bash's `${x/p/r}` (`//`, `/#`, `/%`) may miscount the pattern `p` (a glob, quoted characters escaped). For a
 * pattern without `*`, bash first counts the characters a match takes, and then tries only matches of that length. Its
 * count ends a bracket expression at the first `]` after its first character, also after a `!` or `^`: `[!]]` and
 * `[!]a]` count two and three, though they match one character, and the unclosed `[!]` counts one, though it matches
 * the three characters `[!]`; such a pattern matches nothing there, though `#` and `%` find it. The count also runs
 * over an unclosed `[` to the end, where a `*` counts as one character and `[:`, `[.` or `[=` as one: `${x//[a*b/y}`
 * replaces only `[a`, one character and `b`. The matchers here do not follow that count, so such a pattern is not read.
 */
export function patsubMiscounts(pattern: string): boolean {
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i];
    if (c === '\\') i++;
    else if (c === '[') {
      if ((pattern[i + 1] === '!' || pattern[i + 1] === '^') && pattern[i + 2] === ']') return true;
      if (bracketEnd(pattern, i) < 0 && /\*|\[[:.=]/.test(pattern.slice(i + 1))) return true;
    }
  }
  return false;
}
