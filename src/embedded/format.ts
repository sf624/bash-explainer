import type { Lang } from '../i18n';
import { controlSuffix } from '../ctlchars';
import { EmbeddedToken, pick } from './types';

type S = (ja: string, en: string) => string;

const ESCAPES: Record<string, [string, string]> = {
  n: ['改行', 'newline'], t: ['タブ', 'tab'], r: ['復帰文字(CR)', 'carriage return'], '\\': ['バックスラッシュ', 'backslash'],
  a: ['ベル', 'bell'], b: ['バックスペース', 'backspace'], e: ['ESC（エスケープ文字。色付けなどの制御に使う）', 'ESC, the escape character (used for colours)'], E: ['ESC（エスケープ文字。色付けなどの制御に使う）', 'ESC, the escape character (used for colours)'],
  f: ['改ページ', 'form feed'], v: ['垂直タブ', 'vertical tab'],
};
/** What else printf formats and `$'…'` take: a quote, a question mark. */
const QUOTE_ESCAPES: Record<string, [string, string]> = { '"': ['「"」', '"'], "'": ["「'」", "'"], '?': ['「?」', '?'] };

/** Where the escapes are read: a printf format, `echo -e` (octal is `\0NNN`, `\c` stops), `$'…'` (`\cX`). */
type Mode = 'printf' | 'echo' | 'ansic';

/** Runs of plain text between specifiers become one token each. */
function pushText(out: EmbeddedToken[], src: string, start: number, end: number, s: S): void {
  if (end > start) out.push({ start, end, kind: 'string', explanation: s(`そのまま出力する文字列「${src.slice(start, end)}」`, `Literal text "${src.slice(start, end)}"`), children: [] });
}

/** Backslash escape at `i`; returns [token, length, code of the character it stands for] or undefined. */
function escapeAt(src: string, i: number, s: S, mode: Mode = 'printf'): [EmbeddedToken, number, number?] | undefined {
  const c = src[i + 1];
  if (c === undefined) return undefined;
  let m: RegExpExecArray | null;
  if ((m = (mode === 'echo' ? /^\\(0[0-7]{0,3})/ : /^\\([0-7]{1,3})/).exec(src.slice(i)))) {
    const code = parseInt(m[1], 8);
    return [{ start: i, end: i + m[0].length, kind: 'operator', explanation: s(`\`${m[0]}\`: 8進数 ${m[1]} の文字${controlSuffix(code, s)}`, `\`${m[0]}\`: the character with octal code ${m[1]}${controlSuffix(code, s)}`), children: [] }, m[0].length, code];
  }
  if ((m = /^\\x[0-9a-fA-F]{1,2}/.exec(src.slice(i)))) {
    const code = parseInt(m[0].slice(2), 16);
    return [{ start: i, end: i + m[0].length, kind: 'operator', explanation: s(`\`${m[0]}\`: 16進数 ${m[0].slice(2)} の文字${controlSuffix(code, s)}`, `\`${m[0]}\`: the character with hex code ${m[0].slice(2)}${controlSuffix(code, s)}`), children: [] }, m[0].length, code];
  }
  if ((m = /^\\(u[0-9a-fA-F]{1,4}|U[0-9a-fA-F]{1,8})/.exec(src.slice(i)))) {
    const code = parseInt(m[1].slice(1), 16);
    return [{ start: i, end: i + m[0].length, kind: 'operator', explanation: s(`\`${m[0]}\`: Unicode 文字 U+${m[1].slice(1).toUpperCase()}${controlSuffix(code, s)}`, `\`${m[0]}\`: Unicode character U+${m[1].slice(1).toUpperCase()}${controlSuffix(code, s)}`), children: [] }, m[0].length, code];
  }
  if (mode === 'echo' && c === 'c') {
    return [{ start: i, end: i + 2, kind: 'operator', explanation: s('`\\c`: ここで出力を打ち切る（以降の文字と、末尾の改行も出力しない）', '`\\c`: stop the output here (nothing after it is printed, not even the final newline)'), children: [] }, 2];
  }
  if (mode === 'ansic' && c === 'c' && src[i + 2] !== undefined && (src[i + 2] !== '\\' || src[i + 3] === '\\')) {
    const x = src[i + 2];
    const len = x === '\\' ? 4 : 3;
    const code = x === '?' ? 0x7f : x.charCodeAt(0) & 0x1f;
    return [{ start: i, end: i + len, kind: 'operator', explanation: s(`\`${src.slice(i, i + len)}\`: Control-${x.toUpperCase()} の文字${controlSuffix(code, s)}`, `\`${src.slice(i, i + len)}\`: Control-${x.toUpperCase()}, the character with code ${code}${controlSuffix(code, s)}`), children: [] }, len, code];
  }
  const d = ESCAPES[c] ?? (mode === 'echo' ? undefined : QUOTE_ESCAPES[c]);
  if (!d) return undefined;
  return [{ start: i, end: i + 2, kind: 'operator', explanation: `\`\\${c}\`: ${s(d[0], d[1])}`, children: [] }, 2, c === 'e' || c === 'E' ? 0x1b : undefined];
}

/**
 * The escapes of an `echo -e` argument or of a `$'…'` string (`src` is the text between the quotes):
 * a token for each escape, an ANSI sequence over `ESC [ … m`, and each run of other text. Empty when
 * there is no escape, since then there is nothing to break down.
 */
export function explainEscapes(src: string, lang: Lang, mode: 'echo' | 'ansic'): EmbeddedToken[] {
  const s = pick(lang);
  const out: EmbeddedToken[] = [];
  let text = 0;
  let i = 0;
  while (i < src.length) {
    const e = src[i] === '\\' ? escapeAt(src, i, s, mode) : undefined;
    if (!e) { i++; continue; }
    pushText(out, src, text, i, s);
    const ansi = e[2] === 0x1b ? ansiSequence(src, i, i + e[1], [e[0]], s) : undefined;
    out.push(ansi ?? e[0]);
    i = ansi ? ansi.end : i + e[1];
    text = i;
    // `echo -e` prints nothing after `\c`.
    if (mode === 'echo' && src[i - 1] === 'c' && src[i - 2] === '\\') {
      if (i < src.length) out.push({ start: i, end: src.length, kind: 'string', explanation: s('`\\c` で出力が止まるので、ここから先は出力されない', 'Not printed: the output stopped at `\\c`'), children: [] });
      return out;
    }
  }
  if (!out.length) return out;
  pushText(out, src, text, src.length, s);
  return out;
}

/** Names of the SGR parameters that stand alone: `ESC [ 1 m` is bold. */
const SGR: Record<number, [string, string]> = {
  0: ['全属性をリセット', 'reset all'], 1: ['太字', 'bold'], 2: ['薄く表示', 'dim'], 3: ['斜体', 'italic'], 4: ['下線', 'underline'],
  5: ['点滅', 'blink'], 7: ['前景色と背景色を入れ替え', 'reverse video'], 22: ['太字・薄くを解除', 'normal intensity'], 23: ['斜体を解除', 'not italic'],
  24: ['下線を解除', 'not underlined'], 25: ['点滅を解除', 'not blinking'], 27: ['反転を解除', 'not reversed'],
  39: ['文字色を既定に戻す', 'default foreground'], 49: ['背景色を既定に戻す', 'default background'],
};
const COLOR_NAMES: [string, string][] = [['黒', 'black'], ['赤', 'red'], ['緑', 'green'], ['黄', 'yellow'], ['青', 'blue'], ['マゼンタ', 'magenta'], ['シアン', 'cyan'], ['白', 'white']];

/** What the parameters of `ESC [ … m` do, in order; undefined when one is not understood. */
function sgrParts(params: string, s: S): string[] | undefined {
  const nums = params === '' ? [0] : params.split(';').map((p) => (p === '' ? 0 : Number(p)));
  const out: string[] = [];
  for (let k = 0; k < nums.length; k++) {
    const n = nums[k];
    const std = SGR[n];
    if (std) { out.push(s(std[0], std[1])); continue; }
    const base = n >= 30 && n <= 37 ? 30 : n >= 90 && n <= 97 ? 90 : n >= 40 && n <= 47 ? 40 : n >= 100 && n <= 107 ? 100 : 0;
    if (base) {
      const [ja, en] = COLOR_NAMES[n - base];
      const bright = base === 90 || base === 100;
      const fg = base < 40 || base === 90;
      out.push(fg ? s(`文字色を${bright ? '明るい' : ''}${ja}に`, `${bright ? 'bright ' : ''}${en} foreground`) : s(`背景色を${bright ? '明るい' : ''}${ja}に`, `${bright ? 'bright ' : ''}${en} background`));
      continue;
    }
    if (n !== 38 && n !== 48) return undefined;
    const fg = n === 38;
    if (nums[k + 1] === 5 && nums[k + 2] <= 255) {
      out.push(fg ? s(`文字色を 256 色パレットの ${nums[k + 2]} 番に`, `foreground colour ${nums[k + 2]} of the 256-colour palette`) : s(`背景色を 256 色パレットの ${nums[k + 2]} 番に`, `background colour ${nums[k + 2]} of the 256-colour palette`));
      k += 2;
    } else if (nums[k + 1] === 2 && nums.slice(k + 2, k + 5).length === 3 && nums.slice(k + 2, k + 5).every((v) => v <= 255)) {
      const rgb = nums.slice(k + 2, k + 5).join(',');
      out.push(fg ? s(`文字色を RGB(${rgb}) に`, `foreground RGB(${rgb})`) : s(`背景色を RGB(${rgb}) に`, `background RGB(${rgb})`));
      k += 4;
    } else return undefined;
  }
  return out;
}

/** The ANSI escape sequence (`ESC [ params final`) starting at `at`, as a token over [from, end) holding `kids`; undefined when none. */
function ansiSequence(src: string, from: number, at: number, kids: EmbeddedToken[], s: S): EmbeddedToken | undefined {
  const m = /^\[([0-9;?]*)([@-~])/.exec(src.slice(at));
  if (!m) return undefined;
  const end = at + m[0].length;
  const parts = m[2] === 'm' && /^[0-9;]*$/.test(m[1]) ? sgrParts(m[1], s) : undefined;
  const what = parts ? parts.join(s('、', ', ')) : s(`CSI \`${m[0]}\`（カーソルや画面の制御など）`, `CSI \`${m[0]}\` (cursor or screen control, for example)`);
  const text = { start: at, end, kind: 'string' as const, explanation: s(`そのまま出力する文字列「${m[0]}」`, `Literal text "${m[0]}"`), children: [] };
  return { start: from, end, kind: 'operator', explanation: `\`${src.slice(from, end)}\`: ${s('ANSI エスケープシーケンス', 'ANSI escape sequence')}: ${what}`, children: [...kids, text] };
}

// ---------------------------------------------------------------- printf

const CONVERSIONS: Record<string, [string, string]> = {
  s: ['文字列', 'a string'], b: ['文字列（中の `\\n` などのエスケープを解釈する）', 'a string with backslash escapes interpreted'],
  q: ['シェルに再入力できるようクォートした文字列', 'a string quoted for reuse as shell input'],
  d: ['整数（10進数）', 'an integer (decimal)'], i: ['整数（10進数）', 'an integer (decimal)'], u: ['符号なし整数', 'an unsigned integer'],
  o: ['8進数', 'an octal number'], x: ['16進数（小文字）', 'a hexadecimal number (lowercase)'], X: ['16進数（大文字）', 'a hexadecimal number (uppercase)'],
  f: ['小数（固定小数点）', 'a decimal number (fixed point)'], F: ['小数（固定小数点）', 'a decimal number (fixed point)'],
  e: ['指数表記の数（1.5e+03 など）', 'a number in exponent notation (1.5e+03)'], E: ['指数表記の数（大文字の E）', 'a number in exponent notation (capital E)'],
  g: ['小数か指数表記の短い方', 'the shorter of decimal or exponent notation'], G: ['小数か指数表記の短い方（大文字）', 'the shorter of decimal or exponent notation (capital)'],
  c: ['1文字', 'a single character'], a: ['16進の浮動小数点数', 'a hexadecimal floating-point number'], A: ['16進の浮動小数点数（大文字）', 'a hexadecimal floating-point number (capital)'],
};

/**
 * Explain a printf format string: `%[flags][width][.precision]conversion` specifiers, escapes and
 * literal text. `note` describes how the format is reused when there are more arguments.
 */
export function explainPrintf(src: string, lang: Lang): EmbeddedToken[] {
  const s = pick(lang);
  const out: EmbeddedToken[] = [];
  let text = 0;
  let i = 0;
  let argNo = 0;
  while (i < src.length) {
    if (src[i] === '\\') {
      const e = escapeAt(src, i, s);
      if (e) {
        pushText(out, src, text, i, s);
        const ansi = e[2] === 0x1b ? ansiSequence(src, i, i + e[1], [e[0]], s) : undefined;
        out.push(ansi ?? e[0]);
        i = ansi ? ansi.end : i + e[1];
        text = i;
        continue;
      }
    }
    if (src[i] !== '%') { i++; continue; }
    pushText(out, src, text, i, s);
    if (src[i + 1] === '%') {
      out.push({ start: i, end: i + 2, kind: 'operator', explanation: s('`%%`: 文字「%」そのもの', '`%%`: a literal "%"'), children: [] });
      i += 2;
      text = i;
      continue;
    }
    const m = /^%([-+ #0']*)(\*|\d+)?(?:\.(\*|\d*))?(\([^)]*\)T|[a-zA-Z])/.exec(src.slice(i));
    if (!m) {
      out.push({ start: i, end: i + 1, kind: 'error', explanation: s('`%` の後の書式指定が不正', 'Invalid conversion after `%`'), children: [] });
      i++;
      text = i;
      continue;
    }
    out.push(spec(m, i, ++argNo, s));
    i += m[0].length;
    text = i;
  }
  pushText(out, src, text, src.length, s);
  return out;
}

function spec(m: RegExpExecArray, start: number, argNo: number, s: S): EmbeddedToken {
  const [whole, flags, width, precision, conv] = m;
  const parts: string[] = [];
  if (conv.startsWith('(')) {
    const fmt = conv.slice(1, -2);
    return { start, end: start + whole.length, kind: 'variable', explanation: s(`\`${whole}\`: ${argNo} 番目の引数（UNIX 時刻）を日時書式 \`${fmt}\` で表示する（-1 は現在時刻）`, `\`${whole}\`: argument ${argNo} (a UNIX time) formatted with \`${fmt}\` (-1 means now)`), children: [] };
  }
  const what = CONVERSIONS[conv];
  if (!what) return { start, end: start + whole.length, kind: 'error', explanation: s(`\`${whole}\`: 不明な変換文字 \`${conv}\``, `\`${whole}\`: unknown conversion \`${conv}\``), children: [] };
  const numeric = /[diouxXfFeEgGaA]/.test(conv);
  if (width === '*') parts.push(s('幅は引数で指定', 'width taken from an argument'));
  else if (width) parts.push(flags.includes('-') ? s(`幅 ${width} で左寄せ`, `left-aligned in ${width} columns`) : s(`幅 ${width} で右寄せ`, `right-aligned in ${width} columns`));
  else if (flags.includes('-')) parts.push(s('左寄せ', 'left-aligned'));
  if (flags.includes('0') && width && numeric) parts.push(s('空きは 0 で埋める', 'padded with zeros'));
  if (flags.includes('+')) parts.push(s('正の数にも + を付ける', 'always show the sign'));
  if (flags.includes(' ')) parts.push(s('正の数の前に空白を置く', 'a space before positive numbers'));
  if (flags.includes('#')) parts.push(s('0x などの接頭辞を付ける', 'with a 0x/0 prefix'));
  if (flags.includes("'")) parts.push(s('3桁ごとに区切る', 'with thousands separators'));
  if (precision !== undefined) {
    const p = precision === '' ? '0' : precision;
    if (/[fFeEaA]/.test(conv)) parts.push(s(`小数点以下 ${p} 桁`, `${p} digits after the decimal point`));
    else if (/[gG]/.test(conv)) parts.push(s(`有効数字 ${p} 桁`, `${p} significant digits`));
    else if (/[sbq]/.test(conv)) parts.push(s(`最大 ${p} 文字まで`, `at most ${p} characters`));
    else parts.push(s(`最低 ${p} 桁（足りなければ 0 で埋める）`, `at least ${p} digits`));
  }
  const detail = parts.length ? s(`（${parts.join('、')}）`, ` (${parts.join(', ')})`) : '';
  return {
    start, end: start + whole.length, kind: 'variable', children: [],
    explanation: s(`\`${whole}\`: ${argNo} 番目の値を${what[0]}として出力${detail}`, `\`${whole}\`: value ${argNo} as ${what[1]}${detail}`),
  };
}

/** How bash printf behaves with the given number of arguments for `src`. */
export function printfNote(src: string, lang: Lang): string | undefined {
  const s = pick(lang);
  const count = explainPrintf(src, lang).filter((t) => t.kind === 'variable').length;
  if (!count) return undefined;
  return s(`値の指定 ${count} 個。引数がこれより多いと、書式を繰り返し使って残りも出力する`, `${count} value${count > 1 ? 's' : ''} per use; extra arguments reuse the format`);
}

// ---------------------------------------------------------------- date

const DATE: Record<string, [string, string]> = {
  Y: ['西暦（4桁、例: 2026）', 'year (e.g. 2026)'], y: ['西暦の下2桁（例: 26）', 'last two digits of the year'],
  C: ['世紀（例: 20）', 'century'], G: ['ISO 週番号の年', 'ISO week-based year'],
  m: ['月（01〜12）', 'month (01–12)'], d: ['日（01〜31）', 'day of month (01–31)'], e: ['日（空白埋め、 1〜31）', 'day of month, space-padded'],
  H: ['時（00〜23）', 'hour (00–23)'], I: ['時（01〜12）', 'hour (01–12)'], k: ['時（空白埋め、0〜23）', 'hour, space-padded (0–23)'], l: ['時（空白埋め、1〜12）', 'hour, space-padded (1–12)'],
  M: ['分（00〜59）', 'minute (00–59)'], S: ['秒（00〜60）', 'second (00–60)'], N: ['ナノ秒（000000000〜999999999）', 'nanoseconds'],
  p: ['AM / PM', 'AM or PM'], P: ['am / pm', 'am or pm'],
  a: ['曜日の略称（例: Mon）', 'abbreviated weekday (Mon)'], A: ['曜日（例: Monday）', 'full weekday (Monday)'],
  b: ['月の略称（例: Jan）', 'abbreviated month (Jan)'], h: ['月の略称（%b と同じ）', 'abbreviated month (same as %b)'], B: ['月の名前（例: January）', 'full month name (January)'],
  j: ['年内の通し日（001〜366）', 'day of year (001–366)'], u: ['曜日の番号（1=月曜〜7=日曜）', 'day of week (1=Monday … 7)'], w: ['曜日の番号（0=日曜〜6=土曜）', 'day of week (0=Sunday … 6)'],
  U: ['年内の週番号（日曜始まり）', 'week of year (Sunday first)'], W: ['年内の週番号（月曜始まり）', 'week of year (Monday first)'], V: ['ISO 週番号（01〜53）', 'ISO week number'],
  s: ['UNIX 時刻（1970-01-01 からの秒数）', 'seconds since 1970-01-01 (UNIX time)'],
  Z: ['タイムゾーン名（例: JST）', 'time zone abbreviation (JST)'], z: ['UTC からの時差（例: +0900）', 'UTC offset (+0900)'],
  F: ['日付（%Y-%m-%d と同じ。例: 2026-10-16）', 'date as %Y-%m-%d (2026-10-16)'], T: ['時刻（%H:%M:%S と同じ）', 'time as %H:%M:%S'],
  D: ['日付（%m/%d/%y と同じ）', 'date as %m/%d/%y'], R: ['時刻（%H:%M と同じ）', 'time as %H:%M'], r: ['12時間制の時刻（例: 01:30:00 PM）', '12-hour time (01:30:00 PM)'],
  c: ['ロケールに応じた日時', 'locale date and time'], x: ['ロケールに応じた日付', 'locale date'], X: ['ロケールに応じた時刻', 'locale time'],
  n: ['改行', 'a newline'], t: ['タブ', 'a tab'], '%': ['文字「%」そのもの', 'a literal "%"'],
};

/** Explain a `date +FORMAT` (or strftime) format. The leading `+` is part of `src` when present. */
export function explainDate(src: string, lang: Lang): EmbeddedToken[] {
  const s = pick(lang);
  const out: EmbeddedToken[] = [];
  let i = 0;
  if (src[0] === '+') {
    out.push({ start: 0, end: 1, kind: 'operator', explanation: s('`+`: ここから後ろが表示書式', '`+`: introduces the output format'), children: [] });
    i = 1;
  }
  let text = i;
  while (i < src.length) {
    if (src[i] !== '%') { i++; continue; }
    const m = /^%([-_0^#]?)(\d*)(:{0,3}z|[a-zA-Z%])/.exec(src.slice(i));
    if (!m) { i++; continue; }
    pushText(out, src, text, i, s);
    const [whole, flag, width, conv] = m;
    const base = conv.endsWith('z') && conv.length > 1
      ? [s(`UTC からの時差（例: +09${':00'.repeat(conv.length - 1)}）`, `UTC offset with colons (+09${':00'.repeat(conv.length - 1)})`)]
      : DATE[conv] ? [s(DATE[conv][0], DATE[conv][1])] : undefined;
    const extra: string[] = [];
    if (conv === 'N' && width && +width > 0) {
      const w = +width;
      out.push({
        start: i, end: i + whole.length, kind: 'variable', children: [],
        explanation: s(`\`${whole}\`: 秒の小数部の最初の ${w} 桁${w === 3 ? '（ミリ秒）' : w === 6 ? '（マイクロ秒）' : w === 9 ? '（ナノ秒）' : ''}`, `\`${whole}\`: the first ${w} digits of the fractional second${w === 3 ? ' (milliseconds)' : w === 6 ? ' (microseconds)' : w === 9 ? ' (nanoseconds)' : ''}; it is not a field width`),
      });
      i += whole.length;
      text = i;
      continue;
    }
    if (flag === '-') extra.push(s('ゼロ埋めしない', 'no padding'));
    if (flag === '_') extra.push(s('空白で埋める', 'space-padded'));
    if (flag === '0') extra.push(s('0 で埋める', 'zero-padded'));
    if (flag === '^') extra.push(s('大文字にする', 'uppercase'));
    if (flag === '#') extra.push(s('大文字・小文字を反転する', 'opposite case'));
    if (width) extra.push(s(`幅 ${width}`, `width ${width}`));
    out.push({
      start: i, end: i + whole.length, kind: base ? 'variable' : 'error', children: [],
      explanation: base
        ? `\`${whole}\`: ${base[0]}${extra.length ? s(`（${extra.join('、')}）`, ` (${extra.join(', ')})`) : ''}`
        : s(`\`${whole}\`: 不明な書式指定`, `\`${whole}\`: unknown conversion`),
    });
    i += whole.length;
    text = i;
  }
  pushText(out, src, text, src.length, s);
  return out;
}

/** The made-up moments a `date +FORMAT` example is shown for, in UTC. */
export const SAMPLE_DATES = ['2024-03-05 07:08:09', '2025-12-31 23:59:59'];

/** Reads a date and time typed in the panel (`2024-03-05 07:08:09`, optional `T`, seconds or `Z`) as UTC. */
export function parseSampleDate(text: string): Date | undefined {
  const m = /^\s*(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?\s*(?:Z|UTC)?\s*$/i.exec(text);
  if (!m) return undefined;
  const [y, mo, d, h = '0', mi = '0', se = '0'] = m.slice(1);
  const t = Date.UTC(+y, +mo - 1, +d, +h, +mi, +se);
  const date = new Date(t);
  // Reject what Date would roll over (February 30, hour 25…).
  if (date.getUTCMonth() !== +mo - 1 || date.getUTCDate() !== +d || date.getUTCHours() !== +h) return undefined;
  return date;
}

/**
 * A time zone as `date` uses it: its offset from UTC at a moment (in minutes, east positive; not a whole number when
 * the zone's offset has seconds), its abbreviation there (`%Z`), when it is known (src/examples/dates.ts reads `TZ`),
 * and the first moment it is followed from (`since`: the tz data of systems and of `Intl` may differ before 1970).
 */
export interface Zone { offset(t: number): number; abbr(t: number): string | undefined; since?: number }

export const UTC: Zone = { offset: () => 0, abbr: () => 'UTC' };

/**
 * What GNU `date +FORMAT` prints for `when` in `zone` (UTC: `date -u`), in the C locale; undefined when the format
 * uses something this does not reproduce, or the moment is one this does not follow (before the zone's `since`, an
 * offset with seconds, a year not of four digits: GNU writes `%F` as `+10000-01-01`, `%c` of year 1 as `1`).
 * The leading `+` is optional.
 */
export function formatDate(src: string, when: Date, zone: Zone = UTC): string | undefined {
  const fmt = src.startsWith('+') ? src.slice(1) : src;
  const pad = (n: number, w = 2) => String(n).padStart(w, '0');
  const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const off = zone.offset(when.getTime());
  if ((zone.since !== undefined && when.getTime() < zone.since) || !Number.isInteger(off)) return undefined;
  // The fields are those of the wall clock in the zone.
  const wall = new Date(when.getTime() + off * 60000);
  const Y = wall.getUTCFullYear(), mo = wall.getUTCMonth(), d = wall.getUTCDate(), H = wall.getUTCHours(), M = wall.getUTCMinutes(), S = wall.getUTCSeconds();
  if (Y < 1000 || Y > 9999) return undefined;
  const wday = wall.getUTCDay();
  const sign = off < 0 ? '-' : '+', oh = pad(Math.floor(Math.abs(off) / 60)), om = pad(Math.abs(off) % 60);
  const abbr = zone.abbr(when.getTime());
  const yday = Math.floor((Date.UTC(Y, mo, d) - Date.UTC(Y, 0, 1)) / 864e5);
  const h12 = H % 12 || 12;
  // ISO 8601 week: the week with the year's first Thursday is week 1.
  const thursday = new Date(Date.UTC(Y, mo, d + 3 - ((wday + 6) % 7)));
  const isoYear = thursday.getUTCFullYear();
  const isoWeek = 1 + Math.floor((thursday.getTime() - Date.UTC(isoYear, 0, 1)) / (7 * 864e5));
  /** Value of each conversion, and how it is padded by default (`0`, ` ` or not at all). */
  const v: Record<string, [string, '0' | ' ' | '']> = {
    Y: [String(Y), ''], y: [pad(Y % 100), '0'], C: [pad(Math.floor(Y / 100)), '0'],
    m: [pad(mo + 1), '0'], d: [pad(d), '0'], e: [String(d).padStart(2, ' '), ' '], j: [pad(yday + 1, 3), '0'],
    H: [pad(H), '0'], I: [pad(h12), '0'], k: [String(H).padStart(2, ' '), ' '], l: [String(h12).padStart(2, ' '), ' '],
    M: [pad(M), '0'], S: [pad(S), '0'], N: ['000000000', '0'], s: [String(Math.floor(when.getTime() / 1000)), ''],
    p: [H < 12 ? 'AM' : 'PM', ''], P: [H < 12 ? 'am' : 'pm', ''],
    a: [days[wday].slice(0, 3), ''], A: [days[wday], ''], b: [months[mo].slice(0, 3), ''], h: [months[mo].slice(0, 3), ''], B: [months[mo], ''],
    u: [String(wday || 7), ''], w: [String(wday), ''],
    U: [pad(Math.floor((yday + 7 - wday) / 7)), '0'], W: [pad(Math.floor((yday + 7 - ((wday + 6) % 7)) / 7)), '0'],
    V: [pad(isoWeek), '0'], G: [String(isoYear), ''], g: [pad(isoYear % 100), '0'],
    z: [`${sign}${oh}${om}`, ''], ':z': [`${sign}${oh}:${om}`, ''], '::z': [`${sign}${oh}:${om}:00`, ''], ':::z': [`${sign}${oh}${om === '00' ? '' : `:${om}`}`, ''],
    ...(abbr !== undefined ? { Z: [abbr, ''] as [string, ''] } : {}),
    n: ['\n', ''], t: ['\t', ''], '%': ['%', ''],
  };
  const composite: Record<string, string> = { F: '%Y-%m-%d', T: '%H:%M:%S', D: '%m/%d/%y', R: '%H:%M', r: '%I:%M:%S %p', c: '%a %b %e %H:%M:%S %Y', x: '%m/%d/%y', X: '%H:%M:%S' };
  let unknown = false;
  const out = fmt.replace(/%([-_0^#]?)(\d*)(:{1,3}z|[a-zA-Z%])/g, (whole, flag: string, width: string, c: string) => {
    if (composite[c]) {
      if (flag || width) { unknown = true; return whole; }
      return formatDate(composite[c], when, zone)!;
    }
    const entry = v[c];
    if (!entry) { unknown = true; return whole; }
    let [r, padWith] = entry;
    // A width on %N is the number of digits: the first ones, or zeros added on the right (`%3N` is milliseconds).
    if (c === 'N' && flag) { unknown = true; return whole; } // (`-` and `_` strip the zeros of the sample)
    if (c === 'N') return width && +width > 0 ? r.padEnd(+width, '0').slice(0, +width) : r;
    if (flag === '^') r = r.toUpperCase();
    // `#` swaps case: names become upper case, AM/PM and the zone lower case.
    if (flag === '#') r = /[pZ]/.test(c) ? r.toLowerCase() : r.toUpperCase();
    if (flag === '-') return padWith ? r.replace(/^[0 ]+(?=.)/, '') : r;
    if (flag === '_' && padWith) r = r.replace(/^0+(?=.)/, (z) => ' '.repeat(z.length));
    if (flag === '0' && padWith) r = r.replace(/^ +/, (z) => '0'.repeat(z.length));
    if (width && r.length < +width) {
      const fill = flag === '_' ? ' ' : flag === '0' ? '0' : padWith || (/^\d+$/.test(r) ? '0' : ' ');
      r = r.trimStart().padStart(+width, fill);
    }
    return r;
  });
  return unknown ? undefined : out;
}
