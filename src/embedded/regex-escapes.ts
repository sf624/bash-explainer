// The escapes of the regex reader's flavors (src/embedded/regex.ts): the letters each flavor has and what they mean, PCRE's own,
// what JavaScript reads for them in the examples (src/examples/regex.ts), and the escapes that name a character by its code.

/**
 * `\w`, `\d`… Whether each is available in each flavor (GNU tools support some in BRE/ERE), and what a JavaScript RegExp
 * reads for it in PCRE (`js`: `=` the same escape, else the JavaScript text; none, when JavaScript reads it otherwise).
 * The worked examples (src/examples/regex.ts) take their JavaScript from here and from PCRE_ONLY, never from a table of their own.
 */
export const SHORTHANDS: Record<string, { ja: string; en: string; gnu: boolean; js?: string }> = {
  w: { ja: '英数字またはアンダースコア1文字', en: 'a word character (letter, digit or underscore)', gnu: true, js: '=' },
  W: { ja: '英数字とアンダースコア以外の1文字', en: 'a non-word character', gnu: true, js: '=' },
  s: { ja: '空白文字1文字', en: 'a whitespace character', gnu: true, js: '=' },
  S: { ja: '空白以外の1文字', en: 'a non-whitespace character', gnu: true, js: '=' },
  d: { ja: '数字1文字', en: 'a digit', gnu: false, js: '=' },
  D: { ja: '数字以外の1文字', en: 'a non-digit', gnu: false, js: '=' },
  b: { ja: '単語の境界（文字は消費しない）', en: 'a word boundary (matches no character)', gnu: true, js: '=' },
  B: { ja: '単語の境界ではない位置', en: 'a position that is not a word boundary', gnu: true, js: '=' },
  '<': { ja: '単語の先頭', en: 'the start of a word', gnu: true },
  '>': { ja: '単語の末尾', en: 'the end of a word', gnu: true },
  A: { ja: '文字列の先頭', en: 'the start of the text', gnu: false, js: '^' },
  z: { ja: '文字列の末尾', en: 'the end of the text', gnu: false, js: '$' },
  Z: { ja: '文字列の末尾（末尾の改行の前も可）', en: 'the end of the text (or before a final newline)', gnu: false, js: '$' },
  t: { ja: 'タブ', en: 'a tab', gnu: false, js: '=' },
  n: { ja: '改行', en: 'a newline', gnu: false, js: '=' },
  r: { ja: '復帰文字(CR)', en: 'a carriage return', gnu: false, js: '=' },
  f: { ja: '改ページ', en: 'a form feed', gnu: false, js: '=' },
  e: { ja: 'ESC 文字', en: 'an escape character (ESC)', gnu: false, js: '\\x1b' },
  a: { ja: 'ベル文字(BEL)', en: 'a bell character (BEL)', gnu: false, js: '\\x07' },
  h: { ja: '水平方向の空白（タブなど）1文字', en: 'a horizontal whitespace character (space, tab…)', gnu: false, js: '[ \\t]' },
  H: { ja: '水平方向の空白以外の1文字', en: 'a character that is not horizontal whitespace', gnu: false, js: '[^ \\t]' },
  v: { ja: '垂直方向の空白（改行、改ページなど）1文字', en: 'a vertical whitespace character (newline, form feed…)', gnu: false },
  V: { ja: '垂直方向の空白以外の1文字', en: 'a character that is not vertical whitespace', gnu: false },
};

/** PCRE escapes that no other flavor has, and that mean nothing inside `[…]`. */
export const PCRE_ONLY: Record<string, { ja: string; en: string; kind: 'keyword' | 'pattern'; js?: string }> = {
  K: { ja: 'ここまでに一致した部分を、報告する一致から外す（`grep -o` はこの後ろだけを表示する。文字は消費しない）', en: 'keep what has matched so far out of the reported match (`grep -o` prints only what follows; consumes nothing)', kind: 'keyword' },
  G: { ja: '前の一致の終わりの位置（最初は先頭）', en: 'the position where the previous match ended (the start at first)', kind: 'keyword' },
  R: { ja: '改行1つ（`\\r\\n`、`\\n`、`\\r` など）', en: 'one line break (`\\r\\n`, `\\n`, `\\r`…)', kind: 'pattern' },
  N: { ja: '改行以外の1文字', en: 'any one character except a newline', kind: 'pattern', js: '[^\\n]' },
  X: { ja: '見た目の1文字（結合文字を含む）', en: 'one extended grapheme cluster (a character with its combining marks)', kind: 'pattern' },
};

/** Letters PCRE2 accepts after a backslash; any other letter makes `grep -P` stop with an error. */
export const PCRE_ESCAPE_LETTERS = 'aAbBcCdDeEfgGhHkKnNopPQrRsStvVwWxXzZ';

/** Perl's case escapes (`\U…\E`), which it applies before the regex is compiled; PCRE2 has none (`grep -P` stops). */
export const PERL_CASE = 'ULFul';

/**
 * What a JavaScript RegExp reads for the PCRE escape `\c` (not in a class: `inClass` false), when it means what PCRE means:
 * the JavaScript text. In a class only the escapes that are one set of characters (`\d`, `\h`…) qualify. Undefined when no
 * JavaScript text means the same, so no example is made. The one place that decides it for the reader's tables.
 */
export function pcreJs(c: string, inClass: boolean): string | undefined {
  const js = SHORTHANDS[c]?.js ?? PCRE_ONLY[c]?.js;
  if (js === undefined) return undefined;
  if (js === '=') return `\\${c}`;
  if (!inClass) return js;
  // (A class of one escape: `\h` is `[ \t]` outside a class and ` \t` inside; a negated one, or an anchor, cannot be inside.)
  return js.startsWith('[') && !js.startsWith('[^') ? js.slice(1, -1) : undefined;
}

/** The character code `\x41`, `\x{263a}`, `\101`, `\o{101}` or `\cA` stands for at `at` in a PCRE source, and its length. */
export function pcreCharCode(src: string, at: number, inClass: boolean): { length: number; code: number } | undefined {
  const e = codeEscape(src, at, inClass);
  return e?.code === undefined ? undefined : { length: e.length, code: e.code };
}

export const hexOf = (code: number) => `0x${code.toString(16).toUpperCase().padStart(2, '0')}`;

/** `\x41`, `\x{263a}`, `\012`, `\o{101}`, `\cA`, `\p{L}`: the PCRE escapes that name a character or a property. In a class `\101` is octal too. */
export function codeEscape(src: string, at: number, inClass = false): { length: number; code?: number; text: (s: (ja: string, en: string) => string) => string } | undefined {
  const rest = src.slice(at);
  const charOf = (code: number, s: (ja: string, en: string) => string) => {
    const hex = hexOf(code);
    return code < 32 || code === 127 || code > 0x10ffff ? s(`文字コード ${hex} の文字`, `the character with code ${hex}`)
      : s(`文字コード ${hex} の文字「${String.fromCodePoint(code)}」`, `the character with code ${hex} ("${String.fromCodePoint(code)}")`);
  };
  let m: RegExpExecArray | null;
  if ((m = /^\\x(?:\{([0-9A-Fa-f]+)\}|([0-9A-Fa-f]{0,2}))/.exec(rest))) { const code = parseInt(m[1] ?? (m[2] || '0'), 16); return { length: m[0].length, code, text: (s) => charOf(code, s) }; }
  if ((m = (inClass ? /^\\(?:([0-7]{1,3})|o\{([0-7]+)\})/ : /^\\(?:0([0-7]{0,2})|o\{([0-7]+)\})/).exec(rest))) { const code = parseInt(m[1] ?? m[2]!, 8) || 0; return { length: m[0].length, code, text: (s) => charOf(code, s) }; }
  if ((m = /^\\c([\x20-\x7e])/.exec(rest))) { const code = m[1].toUpperCase().charCodeAt(0) ^ 0x40; return { length: m[0].length, code, text: (s) => s(`制御文字 Ctrl-${m![1].toUpperCase()}`, `the control character Ctrl-${m![1].toUpperCase()}`) }; }
  if ((m = /^\\([pP])(?:\{(\^?)([\w &]+)\}|(\w))/.exec(rest))) {
    const not = (m[1] === 'P') !== (m[2] === '^');
    const prop = m[3] ?? m[4];
    return { length: m[0].length, text: (s) => (not ? s(`Unicode の性質 \`${prop}\` を持たない1文字`, `a character without the Unicode property \`${prop}\``) : s(`Unicode の性質 \`${prop}\` を持つ1文字`, `a character with the Unicode property \`${prop}\``)) };
  }
  return undefined;
}

/** A character by its code, as the escapes that name one say it. */
export function charOfCode(code: number, s: (ja: string, en: string) => string): string {
  const hex = hexOf(code);
  return code < 32 || code === 127 || code > 0x10ffff ? s(`文字コード ${hex} の文字`, `the character with code ${hex}`)
    : s(`文字コード ${hex} の文字「${String.fromCodePoint(code)}」`, `the character with code ${hex} ("${String.fromCodePoint(code)}")`);
}

/** `\N{name}`: the character of that name, if Unicode has one (there is no table of the names here, so it is not checked). */
export const namedChar = (name: string, s: (ja: string, en: string) => string): string => s(`名前が ${name} の文字（Unicode にその名前があれば）`, `the character named ${name}, if that is a Unicode name`);
