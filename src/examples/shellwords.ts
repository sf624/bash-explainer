/** Brace expansion, glob matching examples and printf, as bash does them. */
import { coreutilsRejects, type PrintfReader } from '../embedded/format';
import { sprintf } from './awk';
import { bracketEnd, bracketRegex } from '../bracket';
import { Unsupported as RunnerUnsupported } from './unsupported';

class Unsupported extends RunnerUnsupported {}

// ---------------------------------------------------------------- brace expansion

/** Index of the `}` matching the `{` at `open`, skipping escaped characters. */
function matchBrace(s: string, open: number): number {
  let depth = 0;
  for (let i = open; i < s.length; i++) {
    if (s[i] === '\\') { i++; continue; }
    if (s[i] === '{') depth++;
    else if (s[i] === '}' && --depth === 0) return i;
  }
  return -1;
}

/** Top-level comma positions inside braces `s[open..close]`. */
function commas(s: string, open: number, close: number): number[] {
  const out: number[] = [];
  let depth = 0;
  for (let i = open + 1; i < close; i++) {
    if (s[i] === '\\') { i++; continue; }
    if (s[i] === '{') depth++;
    else if (s[i] === '}') depth--;
    else if (s[i] === ',' && depth === 0) out.push(i);
  }
  return out;
}

function sequence(body: string): string[] | undefined {
  const num = /^(-?\d+)\.\.(-?\d+)(?:\.\.(-?\d+))?$/.exec(body);
  if (num) {
    const [a, b] = [Number(num[1]), Number(num[2])];
    const step = Math.abs(Number(num[3] ?? 1)) || 1;
    // A leading zero on either end pads every number to the same width.
    const pad = /^-?0\d/.test(num[1]) || /^-?0\d/.test(num[2]) ? Math.max(num[1].length, num[2].length) : 0;
    const out: string[] = [];
    for (let v = a; a <= b ? v <= b : v >= b; v += a <= b ? step : -step) {
      out.push(pad ? (v < 0 ? '-' + String(-v).padStart(pad - 1, '0') : String(v).padStart(pad, '0')) : String(v));
      if (out.length > 500) throw new Unsupported('too long');
    }
    return out;
  }
  const chr = /^([A-Za-z])\.\.([A-Za-z])(?:\.\.(-?\d+))?$/.exec(body);
  if (chr) {
    const [a, b] = [chr[1].charCodeAt(0), chr[2].charCodeAt(0)];
    const step = Math.abs(Number(chr[3] ?? 1)) || 1;
    const out: string[] = [];
    for (let v = a; a <= b ? v <= b : v >= b; v += a <= b ? step : -step) out.push(String.fromCharCode(v));
    return out;
  }
  return undefined;
}

/**
 * Expand braces in an unquoted word; undefined when the word has no brace expansion. `raw`: keep the backslashes
 * (quote removal comes later, after the other expansions).
 */
export function braceExpand(word: string, raw = false): string[] | undefined {
  const words = expand(word);
  // Words that end up empty are dropped, as bash drops empty unquoted words.
  // (A backslash left at the end of a word, as the one `{Z..a}` makes, is removed with quote removal: an empty argument that stays.)
  return words?.filter((w) => w !== '').map((w) => (raw ? w : w.replace(/\\(.|$)/g, '$1')));
}

function expand(word: string): string[] | undefined {
  for (let i = 0; i < word.length; i++) {
    if (word[i] === '\\') { i++; continue; }
    if (word[i] !== '{' || word[i - 1] === '$') continue;
    const close = matchBrace(word, i);
    if (close < 0) return undefined;
    const body = word.slice(i + 1, close);
    const prefix = word.slice(0, i);
    const suffix = word.slice(close + 1);
    const cs = commas(word, i, close);
    let parts: string[] | undefined;
    if (cs.length) {
      parts = [];
      let from = i + 1;
      for (const c of [...cs, close]) {
        parts.push(word.slice(from, c));
        from = c + 1;
      }
    } else {
      parts = sequence(body);
    }
    if (!parts) continue;
    const rest = expand(suffix) ?? [suffix];
    const out: string[] = [];
    for (const part of parts) {
      for (const p of expand(part) ?? [part]) for (const r of rest) out.push(prefix + p + r);
    }
    if (out.length > 500) throw new Unsupported('too long');
    return out;
  }
  return undefined;
}

// ---------------------------------------------------------------- globs

export type GlobMode = 'file' | 'value';

/** Shell options that change how globs match (bash's `shopt`; zsh always has `globstar`). */
export interface GlobOpts {
  /** `**` as a whole path segment matches directories at any depth. */
  globstar?: boolean;
  /** `*`, `?` and `[…]` also match a leading `.` of a file name. */
  dotglob?: boolean;
  /** Case-insensitive: `nocaseglob` for file names, `nocasematch` for `case` and `[[ == ]]`. */
  nocase?: boolean;
}

/** Whether a word contains unquoted glob characters, extended globs (`!(…)`, `@(…)`…) included. */
export function isGlob(word: string): boolean {
  for (let i = 0; i < word.length; i++) {
    const c = word[i];
    if (c === '\\') i++;
    else if (c === '*' || c === '?' || (c === '[' && bracketEnd(word, i) > 0) || ('+@!'.includes(c) && word[i + 1] === '(')) return true;
  }
  return false;
}

/** Whether a word contains an extended glob: `?(…)`, `*(…)`, `+(…)`, `@(…)` or `!(…)`. */
export function hasExtglob(word: string): boolean {
  return /(^|[^\\])[?*+@!]\(/.test(word);
}

/** A `**` that is a whole path segment: with globstar it matches any depth of directories. */
export function hasGlobstar(pattern: string): boolean {
  return /(^|\/)\*\*(\/|$)/.test(pattern);
}

/** The index of the `)` closing the `(` at `open`, or -1. */
export function closingParen(pattern: string, open: number): number {
  let depth = 0;
  for (let k = open; k < pattern.length; k++) {
    if (pattern[k] === '\\') k++;
    else if (pattern[k] === '(') depth++;
    else if (pattern[k] === ')' && --depth === 0) return k;
  }
  return -1;
}

/** The alternatives of an extended glob, `a|b` between `from` and `to`, as [start, end] ranges. */
export function alternatives(pattern: string, from: number, to: number): [number, number][] {
  const out: [number, number][] = [];
  let depth = 0;
  let start = from;
  for (let k = from; k < to; k++) {
    if (pattern[k] === '\\') k++;
    else if (pattern[k] === '(') depth++;
    else if (pattern[k] === ')') depth--;
    else if (pattern[k] === '|' && depth === 0) { out.push([start, k]); start = k + 1; }
  }
  out.push([start, to]);
  return out;
}

/** The extended globs of a pattern (not those nested in another), with their alternatives. */
export function extglobs(pattern: string): { op: string; text: string; alts: string[] }[] {
  const out: { op: string; text: string; alts: string[] }[] = [];
  for (let i = 0; i < pattern.length; i++) {
    if (pattern[i] === '\\') { i++; continue; }
    if (!'?*+@!'.includes(pattern[i]) || pattern[i + 1] !== '(') continue;
    const end = closingParen(pattern, i + 1);
    if (end < 0) break;
    out.push({ op: pattern[i], text: pattern.slice(i, end + 1), alts: alternatives(pattern, i + 2, end).map(([a, b]) => pattern.slice(a, b)) });
    i = end;
  }
  return out;
}

class Unmatchable extends Error {}

/**
 * A regex for a glob: in `file` mode `*` and `?` do not match `/` nor (without `dotglob`) a leading
 * `.` of a name, and with `globstar` a `**` segment matches any number of directories. Otherwise `**`
 * is the same as `*`. Extended globs are read as with `shopt -s extglob`.
 */
export function globToRegex(pattern: string, mode: GlobMode, opts: GlobOpts = {}): RegExp | undefined {
  const globstar = !!opts.globstar;
  const file = mode === 'file';
  const any = file ? '[^/]' : '[\\s\\S]';
  const segStart = (i: number) => i === 0 || pattern[i - 1] === '/';
  // In file mode, a name (at the start or after `/`) starting with `.` is only matched by a literal dot.
  const noDot = (i: number) => (file && !opts.dotglob && segStart(i) ? '(?!\\.)' : '');
  // nocaseglob ignores case only in path segments with glob characters: bash looks up the others as they are.
  const segStarts = [...pattern.matchAll(/(?:^|\/)([^/]*)/g)].map((m) => ({ from: m.index! + (m[0].startsWith('/') ? 1 : 0), glob: isGlob(m[1]) }));
  const ci = (i: number) => !!opts.nocase && file && !!segStarts.filter((g) => g.from <= i).pop()?.glob;
  const lit = (i: number, ch: string) => (ci(i) && /[a-zA-Z]/.test(ch) ? `[${ch.toLowerCase()}${ch.toUpperCase()}]` : ch.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&'));
  // `.` and `..` are never matched, even with dotglob.
  const dirs = file && opts.dotglob ? '(?!\\.\\.?(?:/|$))' : '';
  const convert = (from: number, to: number): string => {
    let out = '';
    for (let i = from; i < to; i++) {
      const c = pattern[i];
      if (c === '\\' && i + 1 < to) { i++; out += lit(i, pattern[i]); continue; }
      if ('?*+@!'.includes(c) && pattern[i + 1] === '(') {
        const end = closingParen(pattern, i + 1);
        if (end > 0 && end < to) {
          const inner = alternatives(pattern, i + 2, end).map(([a, b]) => convert(a, b)).join('|');
          if (c === '!') {
            // Anything (in this name) but the alternatives, followed by the rest: only at the top level.
            if (to !== pattern.length) throw new Unmatchable();
            // A rest of varying length (`!(a)*`) lets bash end `!(…)` anywhere, which a lookahead cannot say.
            if (/(^|[^\\])(\*|[?+@!]\()/.test(pattern.slice(end + 1, to))) throw new Unmatchable();
            const rest = convert(end + 1, to);
            return `${out}(?!(?:${inner})${rest}$)${noDot(i)}${any}*${rest}`;
          }
          out += `${c === '@' || c === '?' ? noDot(i) : ''}(?:${inner})${{ '@': '', '?': '?', '*': '*', '+': '+' }[c]}`;
          i = end;
          continue;
        }
      }
      if (c === '*' && file && globstar && pattern.startsWith('**', i) && segStart(i)) {
        const seg = `${noDot(i)}${dirs}[^/]+`;
        if (pattern[i + 2] === '/') { out += `(?:${seg}/)*`; i += 2; continue; }
        if (i + 2 === pattern.length) { out += `(?:${seg}/)*${noDot(i)}${dirs}[^/]*`; i += 1; continue; }
      }
      if (c === '*') {
        out += `${noDot(i)}${file && segStart(i) ? dirs : ''}${any}*`;
        while (pattern[i + 1] === '*' && pattern[i + 2] !== '(') i++;
        continue;
      }
      if (c === '?') { out += noDot(i) + any; continue; }
      if (c === '[') {
        const end = bracketEnd(pattern, i, to);
        if (end > 0) {
          let set = bracketRegex(pattern.slice(i + 1, end));
          // (One that bash reads by rules of its own or by the locale, `[[.space.]]`, `[[=a=]]`: no regex.)
          if (set === undefined) throw new Unmatchable();
          // (`nocaseglob`: both cases of every letter in the set.)
          if (ci(i)) set = set.replace(/\]$/, `${set.slice(1, -1).toUpperCase()}${set.slice(1, -1).toLowerCase()}]`);
          out += `${noDot(i)}${set}`;
          i = end;
          continue;
        }
      }
      out += lit(i, c);
    }
    return out;
  };
  try {
    return new RegExp(`^${convert(0, pattern.length)}$`, opts.nocase && !file ? 'i' : '');
  } catch {
    return undefined;
  }
}

export function globMatches(pattern: string, name: string, mode: GlobMode, opts: GlobOpts = {}): boolean {
  return globToRegex(pattern, mode, opts)?.test(name) ?? false;
}

const STARS = ['app', 'data', 'error', 'x'];
const DIRS = ['', 'src/', 'src/lib/'];

/** Names that match the glob and near misses that do not, verified with the same matcher. */
export function globExamples(pattern: string, mode: GlobMode, opts: GlobOpts = {}): { matching: string[]; nonMatching: string[] } | undefined {
  if (!globToRegex(pattern, mode, opts)) return undefined;
  const deep = mode === 'file' && !!opts.globstar && hasGlobstar(pattern);
  // A name for the pattern between `from` and `to`, varied by `v`; `miss` picks what extended globs exclude.
  const make = (v: number, from = 0, to = pattern.length, miss = false): string => {
    let out = '';
    for (let i = from; i < to; i++) {
      const c = pattern[i];
      if (c === '\\' && i + 1 < to) { out += pattern[++i]; continue; }
      if ('?*+@!'.includes(c) && pattern[i + 1] === '(') {
        const end = closingParen(pattern, i + 1);
        if (end > 0 && end < to) {
          const alts = alternatives(pattern, i + 2, end);
          const alt = (k: number) => make(v, ...alts[k % alts.length], miss);
          if (c === '!') {
            const inner = alts.map(([a, b]) => globToRegex(pattern.slice(a, b), 'value')!.source.slice(1, -1)).join('|');
            out += miss ? make(v, ...alts[v % alts.length]) : (STARS.map((_, k) => STARS[(v + k) % STARS.length]).find((s) => !new RegExp(`^(?:${inner})$`).test(s)) ?? 'zz');
          } else if (c === '@') {
            const inner = new RegExp(`^(?:${alts.map(([a, b]) => globToRegex(pattern.slice(a, b), 'value')!.source.slice(1, -1)).join('|')})$`);
            out += miss ? (['txt', 'bak', 'zz'].find((x) => !inner.test(x)) ?? 'zz') : alt(v);
          }
          else if (c === '?') out += v % 2 && !miss ? '' : alt(v);
          else if (c === '*') out += miss ? 'zz' : alt(v).repeat(v % 3);
          else out += miss ? '' : alt(v).repeat(1 + (v % 2));
          i = end;
          continue;
        }
      }
      if (deep && pattern.startsWith('**', i) && (i === 0 || pattern[i - 1] === '/')) {
        if (pattern[i + 2] === '/') { out += DIRS[v % DIRS.length]; i += 2; continue; }
        if (i + 2 === pattern.length) { out += DIRS[v % DIRS.length] + STARS[v % STARS.length]; i += 1; continue; }
      }
      if (c === '*') {
        while (pattern[i + 1] === '*' && pattern[i + 2] !== '(') i++;
        out += STARS[v % STARS.length];
        continue;
      }
      if (c === '?') { out += 'abc1'[v % 4]; continue; }
      if (c === '[') {
        const end = bracketEnd(pattern, i, to);
        if (end > 0) {
          const re = new RegExp(`^${bracketRegex(pattern.slice(i + 1, end))!}$`);
          const pool = 'abcxyz0123456789ABC-_defghijklmnopqrstuvwDEFGHIJKLMNOPQRSTUVWXYZ.+@%,=~]!^\\';
          const ok = pool.split('').filter((ch) => re.test(ch));
          out += ok[v % Math.max(ok.length, 1)] ?? 'a';
          i = end;
          continue;
        }
      }
      out += c;
    }
    return out;
  };
  const matching: string[] = [];
  for (let v = 0; v < 6 && matching.length < 3; v++) {
    const n = make(v);
    if (n && !matching.includes(n) && globMatches(pattern, n, mode, opts)) matching.push(n);
  }
  if (!matching.length) return undefined;
  const base = matching[0];
  // Show what the options add: a hidden file, or the other case.
  const lastSeg = base.lastIndexOf('/') + 1;
  const extra = [opts.dotglob && mode === 'file' ? base.slice(0, lastSeg) + '.' + base.slice(lastSeg) : '', opts.nocase ? base.slice(0, lastSeg) + swapCase(base.slice(lastSeg)) : ''].filter((n) => n && n !== base && globMatches(pattern, n, mode, opts));
  if (extra.length) matching.splice(Math.max(1, 3 - extra.length), Infinity, ...extra);
  const ext = /\.[^./()|]+$/.exec(pattern)?.[0];
  const candidates = [
    // What an extended glob leaves out: `keep.log` for `!(keep).log`.
    ...(hasExtglob(pattern) ? [0, 1].map((v) => make(v, 0, pattern.length, true)) : []),
    ext ? base.slice(0, -ext.length) + (ext === '.txt' ? '.md' : '.txt') : base + '.bak',
    // `**` without globstar is one level only; with it, hidden directories are still skipped.
    ...(hasGlobstar(pattern) && mode === 'file' ? [deep ? `.cache/${base}` : `src/${base}`] : []),
    // (A hidden file in the same directory: `~/.app.txt` for `~/*.txt`, its last name starting with a dot.)
    mode === 'file' ? base.replace(/(^|\/)([^/]+)(\/*)$/, '$1.$2$3') : base.toUpperCase(),
    base.slice(0, -1), base.slice(1), 'x' + base, base + 'x', base.toUpperCase(),
  ];
  const nonMatching = [...new Set(candidates)].filter((n) => n && n !== base && !globMatches(pattern, n, mode, opts)).slice(0, 2);
  return { matching, nonMatching };
}

function swapCase(s: string): string {
  return s.replace(/[a-zA-Z]/g, (c) => (c === c.toLowerCase() ? c.toUpperCase() : c.toLowerCase()));
}

// ---------------------------------------------------------------- printf

const ESC: Record<string, string> = { n: '\n', t: '\t', r: '\r', a: '\x07', b: '\b', e: '\x1b', E: '\x1b', f: '\f', v: '\v', '\\': '\\' };
/** Escapes only the format has: `%b` leaves `\"`, `\'` and `\?` as they are. */
const FORMAT_ESC: Record<string, string> = { '"': '"', "'": "'", '?': '?' };

/**
 * The backslash escape at `s[i]` (a backslash) as printf interprets it, in the format or, with `inB`, in a `%b` argument.
 * Returns the text, the length of the escape and whether `\c` stops the output.
 * Escapes that make a raw byte (not UTF-8) or that bash rejects are unsupported.
 */
function escapeAt(s: string, i: number, inB: boolean): { text: string; length: number; stop: boolean } {
  const rest = s.slice(i + 1);
  let m: RegExpExecArray | null;
  if (inB && rest[0] === 'c') return { text: '', length: 2, stop: true };
  if ((m = (inB ? /^0[0-7]{0,3}/ : /^[0-7]{1,3}/).exec(rest))) return { text: byteChar(parseInt(m[0], 8)), length: 1 + m[0].length, stop: false };
  if ((m = /^x([0-9a-fA-F]{1,2})/.exec(rest))) return { text: byteChar(parseInt(m[1], 16)), length: 1 + m[0].length, stop: false };
  if (rest[0] === 'x') throw new Unsupported('\\x without digits');
  if ((m = /^u([0-9a-fA-F]{1,4})/.exec(rest)) || (m = /^U([0-9a-fA-F]{1,8})/.exec(rest))) {
    const cp = parseInt(m[1], 16);
    if (cp > 0x10ffff || (cp >= 0xd800 && cp < 0xe000)) throw new Unsupported('not a character');
    return { text: String.fromCodePoint(cp), length: 1 + m[0].length, stop: false };
  }
  if (rest[0] === 'u' || rest[0] === 'U') throw new Unsupported('\\u without digits');
  const single = ESC[rest[0]] ?? (inB ? undefined : FORMAT_ESC[rest[0]]);
  if (single !== undefined) return { text: single, length: 2, stop: false };
  // A lone backslash at the end, or before a character that means nothing, prints as it is.
  return { text: '\\', length: 1, stop: false };
}

/** A byte from an octal or hex escape: bash wraps it to 8 bits, and a byte of 0x80 or more is not text. */
function byteChar(code: number): string {
  if ((code & 0xff) >= 0x80) throw new Unsupported('raw byte');
  return String.fromCharCode(code & 0xff);
}

/** Backslash escapes as printf interprets them in a `%b` argument. Returns [text, stop]. */
function unescape(s: string): [string, boolean] {
  let out = '';
  for (let i = 0; i < s.length; ) {
    if (s[i] !== '\\') { out += s[i++]; continue; }
    const e = escapeAt(s, i, true);
    if (e.stop) return [out, true];
    out += e.text;
    i += e.length;
  }
  return [out, false];
}

/** The characters `printf %q` puts a backslash before, wherever they are. */
const QUOTED = /[ !"$&'()*,;<>?[\\\]^`{|}]/g;

/**
 * printf %q: quote so the shell reads the word back unchanged, with backslashes; with `single` (bash 5.3's `%#q`), in
 * single quotes. `#` is quoted at the start of the word, `~` there and after `:` or `=`. A character that is not ASCII
 * is quoted by the locale, and a control character with `$'…'`; neither is shown.
 */
function shellQuote(s: string, single = false): string {
  if (s === '') return "''";
  if (/[\x00-\x1f\x7f]/.test(s)) throw new Unsupported('%q with control characters');
  if (/[^\x00-\x7f]/.test(s)) throw new Unsupported('%q of a character that is not ASCII');
  if (single) return s === "'" ? "\\'" : `'${s.replace(/'/g, "'\\''")}'`;
  return s.replace(QUOTED, '\\$&').replace(/^#/, '\\#').replace(/(^|[:=])~/g, '$1\\~');
}

const encoder = new TextEncoder();
const bytes = (s: string) => encoder.encode(s).length;

/**
 * A string in a field of `width` bytes (left-aligned for a negative one or with `-`), cut to `prec` bytes first, as
 * bash's printf counts them; a cut through a character would print a broken one, which is not shown.
 */
function stringField(text: string, flags: string, width: number | undefined, prec: number | undefined): string {
  if (prec !== undefined && prec >= 0 && prec < bytes(text)) {
    const cut = encoder.encode(text).slice(0, prec);
    text = new TextDecoder().decode(cut);
    if (bytes(text) !== prec) throw new Unsupported('precision cuts a character');
  }
  const pad = ' '.repeat(Math.max(0, Math.abs(width ?? 0) - bytes(text)));
  return flags.includes('-') || (width ?? 0) < 0 ? text + pad : pad + text;
}

/**
 * A numeric printf argument as bash reads it. `integer`: for %d %i %o %u %x %X, which take only integers
 * (`1.5` and `1e3` are "invalid number"; floats are for %e %f %g). Leading blanks are allowed, trailing ones are not.
 */
function numberArg(a: string | undefined, integer = false): number {
  if (a === undefined || a === '') return 0;
  if (/^['"]/.test(a)) return a.length > 1 ? a.codePointAt(1)! : 0;
  const s = a.replace(/^\s+/, '');
  let n: number;
  if (/^[-+]?0[xX][0-9a-fA-F]+$/.test(s)) n = (s.startsWith('-') ? -1 : 1) * parseInt(s.replace(/^[-+]/, ''), 16);
  else if (/^[-+]?0[0-7]+$/.test(s)) n = (s.startsWith('-') ? -1 : 1) * parseInt(s.replace(/^[-+]/, ''), 8);
  else if (/^[-+]?\d+$/.test(s) || (!integer && /^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/.test(s))) n = Number(s);
  else throw new Unsupported('invalid number');
  // Beyond 2^53 a JavaScript number is no longer exact (and bash clamps at 2^63 with a warning).
  if (integer && Math.abs(n) > Number.MAX_SAFE_INTEGER) throw new Unsupported('out of range');
  return n;
}

/**
 * The output of bash's `printf FORMAT ARGS…` (the format is reused while arguments remain), for `reader` (the bash
 * release whose builtin runs, or the coreutils program). What depends on what is not given (the release, the program
 * or the locale) is not shown: bash 5.3's `%#q`, `%S` and `%C`, and `%ls` or `%lc` of a character that is not ASCII.
 */
export function bashPrintf(format: string, args: string[], reader?: PrintfReader): string {
  let out = '';
  let ai = 0;
  for (let round = 0; round < 50; round++) {
    const startAi = ai;
    let i = 0;
    let stopped = false;
    while (i < format.length) {
      const c = format[i];
      if (c === '\\') {
        const e = escapeAt(format, i, false);
        out += e.text;
        i += e.length;
        continue;
      }
      if (c !== '%') { out += c; i++; continue; }
      if (format[i + 1] === '%') { out += '%'; i += 2; continue; }
      const m = /^%([-+ #0']*)(\*|\d+)?(?:\.(\*|\d*))?([hjlLtz]*)([diouxXeEfFgGcsbqQSC])/.exec(format.slice(i));
      if (!m) throw new Unsupported('format');
      i += m[0].length;
      const [, flags, w, p, length, written] = m;
      // (coreutils quotes in another way, and has no `%Q`, `%S` or `%C`; bash 5.2 has no `%S` or `%C`.)
      if (reader === 'coreutils' && (/[qQSC]/.test(written) || coreutilsRejects(flags, w, p, length, written))) throw new Unsupported(`coreutils %${written}`);
      if (/[SC]/.test(written) && reader !== '5.3') throw new Unsupported(`%${written}`);
      const conv = written === 'S' ? 's' : written === 'C' ? 'c' : written;
      const wide = length.includes('l') || conv !== written;
      const width = w === '*' ? numberArg(args[ai++], true) : w === undefined ? undefined : Number(w);
      const prec = p === '*' ? numberArg(args[ai++], true) : p === undefined ? undefined : Number(p || 0);
      // (`%Q`: bash 5.2 reads the argument of a `*` precision and ignores it; `%.Q` prints nothing, in both.)
      if (written === 'Q' && p === '*' && reader !== '5.2' && reader !== '5.3') throw new Unsupported('%.*Q');
      if (written === 'Q' && p === '' && w !== undefined) throw new Unsupported('%N.Q');
      const arg = args[ai++];
      if (wide && /[sc]/.test(conv) && /[^\x00-\x7f]/.test(arg ?? '')) throw new Unsupported('a wide string');
      if (conv === 'b') {
        const [text, stop] = unescape(arg ?? '');
        out += stringField(text, flags, width, prec);
        if (stop) { stopped = true; break; }
        continue;
      }
      if (conv === 'q' || conv === 'Q') {
        // bash 5.3's `#` quotes in single quotes; bash 5.2 ignores it.
        if (flags.includes('#') && reader !== '5.2' && reader !== '5.3' && arg) throw new Unsupported('%#q');
        const single = flags.includes('#') && reader === '5.3';
        // `%Q` cuts the value before it quotes it, and prints all of the quoted text.
        if (conv === 'Q' && p === '') continue;
        const cut = p === '*' && reader === '5.2' ? undefined : prec;
        if (conv === 'Q') out += stringField(shellQuote(stringField(arg ?? '', '', undefined, cut), single), flags, width, undefined);
        else out += stringField(shellQuote(arg ?? '', single), flags, width, prec);
        continue;
      }
      if (conv === 's') { out += stringField(arg ?? '', flags, width, prec); continue; }
      // An empty argument prints a NUL byte; a character that is not ASCII would print its first byte.
      if (conv === 'c') {
        if (/^[^\x00-\x7f]/.test(arg ?? '')) throw new Unsupported('%c of a character that is not ASCII');
        // (bash 5.3's `%lc` takes the precision: 0 prints nothing.)
        out += stringField((arg ?? '').slice(0, 1) || '\0', flags, width, wide && reader === '5.3' ? prec : undefined);
        continue;
      }
      const spec = `%${flags.replace("'", '')}${width ?? ''}${prec !== undefined ? '.' + prec : ''}`;
      out += sprintf(`${spec}${conv}`, [numberArg(arg, /[diouxX]/.test(conv))]);
    }
    if (stopped) return out;
    // Reuse the format only while it consumed arguments and some remain.
    if (ai >= args.length || ai === startAi) return out;
  }
  throw new Unsupported('too many rounds');
}

export { Unsupported as ShellWordsUnsupported };
