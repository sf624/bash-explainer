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
  const seen: string[] = [];
  for (const l of lines) for (const m of l.matchAll(PICTURES)) if (!seen.includes(m[0])) seen.push(m[0]);
  if (!seen.length) return undefined;
  const list = seen.map((p) => {
    const code = pictureCode(p)!;
    const n = NAMED[code];
    const what = n ? s(`${NAMED[code][0]}（${n[2]}）`, `${n[0]} (${n[1]})`) : controlAbbr(code)!;
    return `\`${p}\` ${s('は', 'is')} ${what}`;
  }).join(s('、', ', '));
  return s(`制御文字は目に見えないので、例では記号で表している: ${list}`, `Control characters are invisible, so the example shows them as symbols: ${list}`);
}
