/** Brace expansion, glob matching examples and printf, as bash does them. */
import { sprintf } from './awk';

class Unsupported extends Error {}

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

/** Expand braces in an unquoted word; undefined when the word has no brace expansion. */
export function braceExpand(word: string): string[] | undefined {
  const words = expand(word);
  // Words that end up empty are dropped, as bash drops empty unquoted words.
  return words?.map((w) => w.replace(/\\(.)/g, '$1')).filter((w) => w !== '');
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

/** Whether a word contains unquoted glob characters. */
export function isGlob(word: string): boolean {
  return /(^|[^\\])([*?]|\[[^\]]+\])/.test(word);
}

/** A `**` that is a whole path segment: with globstar it matches any depth of directories. */
export function hasGlobstar(pattern: string): boolean {
  return /(^|\/)\*\*(\/|$)/.test(pattern);
}

/**
 * A regex for a glob: in `file` mode `*` and `?` do not match `/` nor (without `dotglob`) a leading
 * `.` of a name, and with `globstar` a `**` segment matches any number of directories. Otherwise `**`
 * is the same as `*`.
 */
export function globToRegex(pattern: string, mode: GlobMode, opts: GlobOpts = {}): RegExp | undefined {
  const globstar = !!opts.globstar;
  if (/[?*+@!]\(/.test(pattern)) return undefined;
  let out = '';
  const file = mode === 'file';
  const any = file ? '[^/]' : '[\\s\\S]';
  // In file mode, a name (at the start or after `/`) starting with `.` is only matched by a literal dot.
  const noDot = (i: number) => (file && !opts.dotglob && (i === 0 || pattern[i - 1] === '/') ? '(?!\\.)' : '');
  // nocaseglob ignores case only in path segments with glob characters: bash looks up the others as they are.
  const segStarts = [...pattern.matchAll(/(?:^|\/)([^/]*)/g)].map((m) => ({ from: m.index! + (m[0].startsWith('/') ? 1 : 0), glob: isGlob(m[1]) }));
  const ci = (i: number) => !!opts.nocase && file && !!segStarts.filter((g) => g.from <= i).pop()?.glob;
  const lit = (i: number, ch: string) => (ci(i) && /[a-zA-Z]/.test(ch) ? `[${ch.toLowerCase()}${ch.toUpperCase()}]` : ch.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&'));
  // `.` and `..` are never matched, even with dotglob.
  const dirs = file && opts.dotglob ? '(?!\\.\\.?(?:/|$))' : '';
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i];
    if (c === '\\' && i + 1 < pattern.length) { i++; out += lit(i, pattern[i]); continue; }
    if (c === '*' && file && globstar && pattern.startsWith('**', i) && (i === 0 || pattern[i - 1] === '/')) {
      const seg = `${noDot(i)}${dirs}[^/]+`;
      if (pattern[i + 2] === '/') { out += `(?:${seg}/)*`; i += 2; continue; }
      if (i + 2 === pattern.length) { out += `(?:${seg}/)*${noDot(i)}${dirs}[^/]*`; i += 1; continue; }
    }
    if (c === '*') {
      out += `${noDot(i)}${file && (i === 0 || pattern[i - 1] === '/') ? dirs : ''}${any}*`;
      while (pattern[i + 1] === '*') i++;
      continue;
    }
    if (c === '?') { out += noDot(i) + any; continue; }
    if (c === '[') {
      const end = pattern.indexOf(']', i + 2);
      if (end > 0) {
        let set = pattern.slice(i + 1, end);
        const neg = set[0] === '!' || set[0] === '^';
        if (neg) set = set.slice(1);
        set = set.replace(/\[:(\w+):\]/g, (_, n: string) => ({ digit: '0-9', alpha: 'A-Za-z', alnum: 'A-Za-z0-9', upper: 'A-Z', lower: 'a-z', space: '\\s' } as Record<string, string>)[n] ?? '').replace(/\\/g, '\\\\').replace(/\]/g, '\\]');
        if (ci(i)) set += set.toUpperCase() + set.toLowerCase();
        out += `${noDot(i)}[${neg ? '^' : ''}${set}]`;
        i = end;
        continue;
      }
    }
    out += lit(i, c);
  }
  try {
    return new RegExp(`^${out}$`, opts.nocase && !file ? 'i' : '');
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
  const make = (v: number) => {
    let out = '';
    for (let i = 0; i < pattern.length; i++) {
      const c = pattern[i];
      if (c === '\\' && i + 1 < pattern.length) { out += pattern[++i]; continue; }
      if (deep && pattern.startsWith('**', i) && (i === 0 || pattern[i - 1] === '/')) {
        if (pattern[i + 2] === '/') { out += DIRS[v % DIRS.length]; i += 2; continue; }
        if (i + 2 === pattern.length) { out += DIRS[v % DIRS.length] + STARS[v % STARS.length]; i += 1; continue; }
      }
      if (c === '*') {
        while (pattern[i + 1] === '*') i++;
        out += v === 3 ? '' : STARS[v % STARS.length];
        continue;
      }
      if (c === '?') { out += 'abc1'[v % 4]; continue; }
      if (c === '[') {
        const end = pattern.indexOf(']', i + 2);
        if (end > 0) {
          const re = new RegExp(`^${globToRegex(pattern.slice(i, end + 1), 'value')!.source.slice(1, -1)}$`);
          const pool = 'abcxyz0123456789ABC-_defghijklmnopqrstuvwDEFGHIJKLMNOPQRSTUVWXYZ.+@%,=~';
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
  const ext = /\.[^./]+$/.exec(pattern)?.[0];
  const candidates = [
    ext ? base.slice(0, -ext.length) + (ext === '.txt' ? '.md' : '.txt') : base + '.bak',
    // `**` without globstar is one level only; with it, hidden directories are still skipped.
    ...(hasGlobstar(pattern) && mode === 'file' ? [deep ? `.cache/${base}` : `src/${base}`] : []),
    mode === 'file' ? '.' + base : base.toUpperCase(),
    base.slice(0, -1), base.slice(1), 'x' + base, base + 'x', base.toUpperCase(),
  ];
  const nonMatching = [...new Set(candidates)].filter((n) => n && n !== base && !globMatches(pattern, n, mode, opts)).slice(0, 2);
  return { matching, nonMatching };
}

function swapCase(s: string): string {
  return s.replace(/[a-zA-Z]/g, (c) => (c === c.toLowerCase() ? c.toUpperCase() : c.toLowerCase()));
}

// ---------------------------------------------------------------- printf

const ESC: Record<string, string> = { n: '\n', t: '\t', r: '\r', a: '\x07', b: '\b', e: '\x1b', E: '\x1b', f: '\f', v: '\v', '\\': '\\', '"': '"', "'": "'" };

/** Backslash escapes as printf interprets them in the format (and %b in arguments). Returns [text, stop]. */
function unescape(s: string, inB: boolean): [string, boolean] {
  let out = '';
  for (let i = 0; i < s.length; i++) {
    if (s[i] !== '\\' || i + 1 >= s.length) { out += s[i]; continue; }
    const rest = s.slice(i + 1);
    let m: RegExpExecArray | null;
    if (inB && rest[0] === 'c') return [out, true];
    if ((m = (inB ? /^0[0-7]{0,3}/ : /^[0-7]{1,3}/).exec(rest))) { out += String.fromCharCode(parseInt(m[0], 8)); i += m[0].length; continue; }
    if ((m = /^x([0-9a-fA-F]{1,2})/.exec(rest))) { out += String.fromCharCode(parseInt(m[1], 16)); i += m[0].length; continue; }
    if ((m = /^u([0-9a-fA-F]{1,4})/.exec(rest)) || (m = /^U([0-9a-fA-F]{1,8})/.exec(rest))) { out += String.fromCodePoint(parseInt(m[1], 16)); i += m[0].length; continue; }
    if (ESC[rest[0]] !== undefined && (inB || rest[0] !== "'" )) { out += ESC[rest[0]]; i++; continue; }
    out += '\\';
  }
  return [out, false];
}

/** printf %q: quote so the shell reads the word back unchanged. */
function shellQuote(s: string): string {
  if (s === '') return "''";
  if (/[\x00-\x1f\x7f]/.test(s)) throw new Unsupported('%q with control characters');
  return s.replace(/[^A-Za-z0-9_\-.,:/@%+=^]/g, '\\$&');
}

function numberArg(a: string | undefined): number {
  if (a === undefined || a === '') return 0;
  if (/^['"]/.test(a)) return a.length > 1 ? a.codePointAt(1)! : 0;
  const s = a.trim();
  if (/^[-+]?0[xX][0-9a-fA-F]+$/.test(s)) return parseInt(s, 16);
  if (/^[-+]?0[0-7]+$/.test(s)) return parseInt(s, 8);
  if (/^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/.test(s)) return Number(s);
  throw new Unsupported('invalid number');
}

/** The output of bash's `printf FORMAT ARGS…` (the format is reused while arguments remain). */
export function bashPrintf(format: string, args: string[]): string {
  let out = '';
  let ai = 0;
  for (let round = 0; round < 50; round++) {
    const startAi = ai;
    let i = 0;
    let stopped = false;
    while (i < format.length) {
      const c = format[i];
      if (c === '\\') {
        const m = /^\\(0[0-7]{0,3}|[0-7]{1,3}|x[0-9a-fA-F]{1,2}|u[0-9a-fA-F]{1,4}|U[0-9a-fA-F]{1,8}|.)/.exec(format.slice(i));
        out += unescape(m![0], false)[0];
        i += m![0].length;
        continue;
      }
      if (c !== '%') { out += c; i++; continue; }
      const m = /^%([-+ #0']*)(\*|\d+)?(?:\.(\*|\d*))?([diouxXeEfFgGcsbq%])/.exec(format.slice(i));
      if (!m) throw new Unsupported('format');
      i += m[0].length;
      const [, flags, w, p, conv] = m;
      if (conv === '%') { out += '%'; continue; }
      const width = w === '*' ? numberArg(args[ai++]) : w;
      const prec = p === '*' ? numberArg(args[ai++]) : p;
      const spec = `%${flags.replace("'", '')}${width ?? ''}${prec !== undefined ? '.' + prec : ''}`;
      const arg = args[ai++];
      if (conv === 'b') {
        const [text, stop] = unescape(arg ?? '', true);
        out += sprintf(`${spec}s`, [text]);
        if (stop) { stopped = true; break; }
        continue;
      }
      if (conv === 'q') { out += sprintf(`${spec}s`, [shellQuote(arg ?? '')]); continue; }
      if (conv === 's') { out += sprintf(`${spec}s`, [arg ?? '']); continue; }
      if (conv === 'c') { out += sprintf(`${spec}s`, [(arg ?? '').slice(0, 1)]); continue; }
      out += sprintf(`${spec}${conv}`, [numberArg(arg)]);
    }
    if (stopped) return out;
    // Reuse the format only while it consumed arguments and some remain.
    if (ai >= args.length || ai === startAi) return out;
  }
  throw new Unsupported('too many rounds');
}

export { Unsupported as ShellWordsUnsupported };
