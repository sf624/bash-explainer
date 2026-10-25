import { wordTable } from './wordtable';
/**
 * Bracket expressions in shell patterns (`[abc]`, `[!a-c]`, `[]]`, `[\^a]`, `[[:alpha:]_]`): where one ends,
 * what it holds, and the regular expression for it. The rules are those of bash's `case` and `[[ == ]]`.
 */

/** One thing in a bracket expression: a character, a range of characters or a named class (`[:alpha:]`). */
export type BracketItem = { type: 'char'; ch: string } | { type: 'range'; from: string; to: string } | { type: 'class'; name: string };

/** The characters of the POSIX classes bash knows, as the inside of a JS character class. */
const CLASSES: Record<string, string> = wordTable({
  digit: '0-9', alpha: 'A-Za-z', alnum: 'A-Za-z0-9', upper: 'A-Z', lower: 'a-z', space: ' \t\n\r\f\v', blank: ' \t',
  xdigit: '0-9A-Fa-f', punct: '!-/:-@\\[-`{-~', cntrl: '\u0000-\u001f\u007f', graph: '!-~', print: ' -~',
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

/** What is inside a bracket expression (the text between the brackets), and whether it is negated (`!` or `^` first). */
export function bracketItems(body: string): { negated: boolean; items: BracketItem[] } {
  const negated = body[0] === '!' || body[0] === '^';
  let i = negated ? 1 : 0;
  /** One character (an escaped one, or a `[.x.]` / `[=x=]` element) or one class; an equivalence class `[=x=]` cannot start a range. */
  const read = (): { item: BracketItem; rangeable: boolean } => {
    if (body[i] === '[' && /^[:.=]$/.test(body[i + 1])) {
      const close = body.indexOf(`${body[i + 1]}]`, i + 2);
      if (close > 0) {
        const name = body.slice(i + 2, close);
        const kind = body[i + 1];
        i = close + 2;
        return { item: kind === ':' ? { type: 'class', name } : { type: 'char', ch: name }, rangeable: kind !== '=' };
      }
    }
    if (body[i] === '\\' && i + 1 < body.length) i++;
    return { item: { type: 'char', ch: body[i++] }, rangeable: true };
  };
  const items: BracketItem[] = [];
  while (i < body.length) {
    const { item, rangeable } = read();
    // A `-` that is not last makes a range with the next character (a range that ends in a class matches nothing).
    if (item.type === 'char' && rangeable && body[i] === '-' && i + 1 < body.length) {
      i++;
      const hi = read().item;
      if (hi.type === 'char') items.push({ type: 'range', from: item.ch, to: hi.ch });
    } else items.push(item);
  }
  return { negated, items };
}

const escapeInClass = (c: string): string => c.replace(/[\\\]\[^-]/, '\\$&');

/** The JS character class for the text between the brackets. */
export function bracketRegex(body: string): string {
  const { negated, items } = bracketItems(body);
  const set = items.map((item) => {
    if (item.type === 'class') return CLASSES[item.name] ?? '';
    if (item.type === 'char') return escapeInClass(item.ch);
    // (A range out of order matches nothing in bash.)
    return item.from <= item.to ? `${escapeInClass(item.from)}-${escapeInClass(item.to)}` : '';
  }).join('');
  return `[${negated ? '^' : ''}${set}]`;
}
