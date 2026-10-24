/**
 * Names of the ASCII control characters, shared by every explanation that says "the character with
 * code …" and by the note that explains the control pictures (␛ ⇥) in examples.
 */

/** [abbreviation, English name, Japanese name] for the codes people meet; other codes have the abbreviation only. */
const NAMED: Record<number, [string, string, string]> = {
  0x00: ['NUL', 'null', 'ヌル文字'],
  0x07: ['BEL', 'bell', 'ベル'],
  0x08: ['BS', 'backspace', 'バックスペース'],
  0x09: ['HT', 'tab', 'タブ'],
  0x0a: ['LF', 'line feed, newline', '改行'],
  0x0b: ['VT', 'vertical tab', '垂直タブ'],
  0x0c: ['FF', 'form feed', '改ページ'],
  0x0d: ['CR', 'carriage return', '復帰文字'],
  0x1b: ['ESC', 'escape', 'エスケープ文字'],
  0x7f: ['DEL', 'delete', '削除文字'],
};

/** Abbreviations of the codes 0 to 31. */
const ABBREVIATIONS = ['NUL', 'SOH', 'STX', 'ETX', 'EOT', 'ENQ', 'ACK', 'BEL', 'BS', 'HT', 'LF', 'VT', 'FF', 'CR', 'SO', 'SI',
  'DLE', 'DC1', 'DC2', 'DC3', 'DC4', 'NAK', 'SYN', 'ETB', 'CAN', 'EM', 'SUB', 'ESC', 'FS', 'GS', 'RS', 'US'];

type S = (ja: string, en: string) => string;

/** The abbreviation of a control character code (0 to 31, 127), or undefined for any other code. */
export function controlAbbr(code: number): string | undefined {
  if (code === 0x7f) return 'DEL';
  return ABBREVIATIONS[code];
}

/** " (ESC, escape)" for a control character code, "" for any other code. `s` picks the language. */
export function controlSuffix(code: number, s: S): string {
  const abbr = controlAbbr(code);
  if (!abbr) return '';
  const n = NAMED[code];
  if (!n) return s(`（${abbr}）`, ` (${abbr})`);
  return s(`（${abbr}、${n[2]}）`, ` (${abbr}, ${n[1]})`);
}

/** The control character a picture stands for (␛ → 0x1b, ⇥ → tab, ␡ → DEL), or undefined. */
export function pictureCode(ch: string): number | undefined {
  if (ch === '⇥') return 0x09;
  if (ch === '␡') return 0x7f;
  const c = ch.codePointAt(0)! - 0x2400;
  return c >= 0 && c < 0x20 ? c : undefined;
}

const PICTURES = /[␀-␟␡⇥]/gu;

/**
 * The note for an example whose lines show control characters as pictures: what each picture
 * stands for, once. Undefined when the lines hold none.
 */
export function pictureNote(lines: string[], s: S): string | undefined {
  const list = pictureList(lines, s);
  return list && s(`制御文字は目に見えないので、例では記号で表している: ${list}`, `Control characters are invisible, so the example shows them as symbols: ${list}`);
}

/** What each control picture in `lines` stands for, once (`` `⇥` is HT (tab) ``); undefined when they hold none. */
export function pictureList(lines: string[], s: S): string | undefined {
  const seen: string[] = [];
  for (const l of lines) for (const m of l.matchAll(PICTURES)) if (!seen.includes(m[0])) seen.push(m[0]);
  if (!seen.length) return undefined;
  return seen.map((p) => {
    const code = pictureCode(p)!;
    const n = NAMED[code];
    const what = n ? s(`${NAMED[code][0]}（${n[2]}）`, `${n[0]} (${n[1]})`) : controlAbbr(code)!;
    return `\`${p}\` ${s('は', 'is')} ${what}`;
  }).join(s('、', ', '));
}

/** The character a code stands for, when it is a visible ASCII one: ` ("A")` or `（「A」）`, else the control name. */
export function codeSuffix(code: number, s: S): string {
  const c = controlSuffix(code, s);
  if (c || code < 0x20 || code > 0x7e) return c;
  return s(`（「${String.fromCharCode(code)}」）`, ` ("${String.fromCharCode(code)}")`);
}

/** A GNU sed escape that stands for one character. */
export interface SedEscape {
  length: number;
  /** The byte it stands for. */
  code: number;
  /** The explanation, without the leading `\esc`: . */
  text: (s: S) => string;
}

const SED_LETTERS: Record<string, [number, string, string]> = {
  a: [0x07, 'ベル', 'a bell'], f: [0x0c, '改ページ', 'a form feed'], n: [0x0a, '改行', 'a newline'],
  r: [0x0d, '復帰文字', 'a carriage return'], t: [0x09, 'タブ', 'a tab'], v: [0x0b, '垂直タブ', 'a vertical tab'],
};

/**
 * The GNU sed escape at `i` (`\a \f \n \r \t \v`, `\xHH`, `\oNNN`, `\dNNN`, `\cX`), or undefined.
 * GNU sed turns these into the character before it reads the regex or the replacement.
 */
export function sedEscapeAt(src: string, i: number): SedEscape | undefined {
  if (src[i] !== '\\') return undefined;
  const l = SED_LETTERS[src[i + 1]];
  if (l) return { length: 2, code: l[0], text: (s) => `${s(l[1], l[2])}${s(`（${controlAbbr(l[0])}）`, ` (${controlAbbr(l[0])})`)}` };
  const m = /^\\(?:x([0-9a-fA-F]{1,2})|o([0-7]{1,3})|d([0-9]{1,3})|c([^\\]))/.exec(src.slice(i));
  if (!m) return undefined;
  const code = (m[1] !== undefined ? parseInt(m[1], 16) : m[2] !== undefined ? parseInt(m[2], 8) : m[3] !== undefined ? parseInt(m[3], 10) : m[4].toUpperCase().charCodeAt(0) ^ 0x40) & 0xff;
  const suffix = (s: S) => codeSuffix(code, s);
  const text = (s: S) => m[1] !== undefined ? s(`16進数 ${m[1]} の文字${suffix(s)}`, `the character with hex code ${m[1]}${suffix(s)}`)
    : m[2] !== undefined ? s(`8進数 ${m[2]} の文字${suffix(s)}`, `the character with octal code ${m[2]}${suffix(s)}`)
      : m[3] !== undefined ? s(`10進数 ${m[3]} の文字${suffix(s)}`, `the character with decimal code ${m[3]}${suffix(s)}`)
        : s(`Control-${m[4].toUpperCase()} の文字${suffix(s)}`, `Control-${m[4].toUpperCase()}: the character with code ${code}${suffix(s)}`);
  return { length: m[0].length, code, text };
}

/** Tabs as ⇥ and other control characters as their Unicode pictures (CR → ␍), so examples show them. */
export function visible(line: string): string {
  return line.replace(/\t/g, '⇥').replace(/[\x00-\x08\x0b-\x1f\x7f]/g, (c) => (c === '\x7f' ? '␡' : String.fromCharCode(0x2400 + c.charCodeAt(0))));
}
