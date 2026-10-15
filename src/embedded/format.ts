import type { Lang } from '../i18n';
import { EmbeddedToken, pick } from './types';

type S = (ja: string, en: string) => string;

const ESCAPES: Record<string, [string, string]> = {
  n: ['改行', 'newline'], t: ['タブ', 'tab'], r: ['復帰文字(CR)', 'carriage return'], '\\': ['バックスラッシュ', 'backslash'],
  a: ['ベル', 'bell'], b: ['バックスペース', 'backspace'], e: ['エスケープ文字（色付けなどの制御に使う）', 'escape character (used for colours)'],
  f: ['改ページ', 'form feed'], v: ['垂直タブ', 'vertical tab'], '"': ['「"」', '"'], "'": ["「'」", "'"],
};

/** Runs of plain text between specifiers become one token each. */
function pushText(out: EmbeddedToken[], src: string, start: number, end: number, s: S): void {
  if (end > start) out.push({ start, end, kind: 'string', explanation: s(`そのまま出力する文字列「${src.slice(start, end)}」`, `Literal text "${src.slice(start, end)}"`), children: [] });
}

/** Backslash escape at `i`; returns [token, length] or undefined. */
function escapeAt(src: string, i: number, s: S): [EmbeddedToken, number] | undefined {
  const c = src[i + 1];
  if (c === undefined) return undefined;
  let m: RegExpExecArray | null;
  if ((m = /^\\(0[0-7]{0,3}|[0-7]{1,3})/.exec(src.slice(i)))) {
    return [{ start: i, end: i + m[0].length, kind: 'operator', explanation: s(`\`${m[0]}\`: 8進数 ${m[1]} の文字`, `\`${m[0]}\`: the character with octal code ${m[1]}`), children: [] }, m[0].length];
  }
  if ((m = /^\\x[0-9a-fA-F]{1,2}/.exec(src.slice(i)))) {
    return [{ start: i, end: i + m[0].length, kind: 'operator', explanation: s(`\`${m[0]}\`: 16進数 ${m[0].slice(2)} の文字`, `\`${m[0]}\`: the character with hex code ${m[0].slice(2)}`), children: [] }, m[0].length];
  }
  if ((m = /^\\(u[0-9a-fA-F]{1,4}|U[0-9a-fA-F]{1,8})/.exec(src.slice(i)))) {
    return [{ start: i, end: i + m[0].length, kind: 'operator', explanation: s(`\`${m[0]}\`: Unicode 文字 U+${m[1].slice(1).toUpperCase()}`, `\`${m[0]}\`: Unicode character U+${m[1].slice(1).toUpperCase()}`), children: [] }, m[0].length];
  }
  const d = ESCAPES[c];
  if (!d) return undefined;
  return [{ start: i, end: i + 2, kind: 'operator', explanation: `\`\\${c}\`: ${s(d[0], d[1])}`, children: [] }, 2];
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
        out.push(e[0]);
        i += e[1];
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

/** What `date +FORMAT` prints right now, e.g. `2026-10-16T09:30:00`, computed in JavaScript. */
export function sampleDate(src: string, now = new Date()): string | undefined {
  const fmt = src.startsWith('+') ? src.slice(1) : src;
  if (/%[-_0^#]?\d*(:{0,3}z|[cxXZUVWGCNsrIlkpPh])/.test(fmt)) return undefined;
  const pad = (n: number, w = 2) => String(n).padStart(w, '0');
  const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const v: Record<string, string> = {
    Y: String(now.getFullYear()), y: pad(now.getFullYear() % 100), m: pad(now.getMonth() + 1), d: pad(now.getDate()), e: String(now.getDate()).padStart(2, ' '),
    H: pad(now.getHours()), M: pad(now.getMinutes()), S: pad(now.getSeconds()), a: days[now.getDay()].slice(0, 3), A: days[now.getDay()],
    b: months[now.getMonth()].slice(0, 3), B: months[now.getMonth()], j: pad(Math.floor((now.getTime() - new Date(now.getFullYear(), 0, 0).getTime()) / 864e5), 3),
    u: String(now.getDay() || 7), w: String(now.getDay()), n: '\n', t: '\t', '%': '%',
  };
  v.F = `${v.Y}-${v.m}-${v.d}`;
  v.T = `${v.H}:${v.M}:${v.S}`;
  v.D = `${v.m}/${v.d}/${v.y}`;
  v.R = `${v.H}:${v.M}`;
  return fmt.replace(/%([-_0^#]?)(\d*)([a-zA-Z%])/g, (_, flag: string, _w: string, c: string) => {
    let r = v[c] ?? '';
    if (flag === '-') r = r.replace(/^[0 ]+(?=.)/, '');
    if (flag === '^') r = r.toUpperCase();
    return r;
  });
}
