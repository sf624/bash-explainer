/**
 * Line-oriented coreutils (sort, uniq, cut, tr, head, tail) and argument-only commands
 * (seq, basename, dirname), simulated with GNU semantics in the C locale.
 */

export class Unsupported extends Error {}

/** Option names → whether they take a value. Long options map to their short form. */
interface OptSpec {
  flags: string;
  values: string;
  long?: Record<string, string>;
}

export interface Parsed {
  /** Options in order: [name, value] (value '' for flags). */
  opts: [string, string][];
  /** Operands (files, numbers, names); undefined when not literal. */
  operands: (string | undefined)[];
}

/** GNU-style option parsing: combined flags (-nr), attached values (-k2 -t:), --long[=value], and `--`. */
export function parseOptions(words: (string | undefined)[], spec: OptSpec): Parsed {
  const opts: [string, string][] = [];
  const operands: (string | undefined)[] = [];
  let ended = false;
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    if (w === undefined || ended || w === '-' || !w.startsWith('-')) {
      operands.push(w);
      continue;
    }
    if (w === '--') { ended = true; continue; }
    if (w.startsWith('--')) {
      const eq = w.indexOf('=');
      const name = eq < 0 ? w.slice(2) : w.slice(2, eq);
      const short = spec.long?.[name];
      if (!short) throw new Unsupported(`--${name}`);
      if (spec.values.includes(short)) {
        const v = eq < 0 ? words[++i] : w.slice(eq + 1);
        if (v === undefined) throw new Unsupported('missing value');
        opts.push([short, v]);
      } else opts.push([short, '']);
      continue;
    }
    for (let k = 1; k < w.length; k++) {
      const c = w[k];
      if (spec.values.includes(c)) {
        const v = k + 1 < w.length ? w.slice(k + 1) : words[++i];
        if (v === undefined) throw new Unsupported('missing value');
        opts.push([c, v]);
        break;
      }
      if (!spec.flags.includes(c)) throw new Unsupported(`-${c}`);
      opts.push([c, '']);
    }
  }
  return { opts, operands };
}

const has = (p: Parsed, c: string) => p.opts.some(([n]) => n === c);
const value = (p: Parsed, c: string) => [...p.opts].reverse().find(([n]) => n === c)?.[1];
const values = (p: Parsed, c: string) => p.opts.filter(([n]) => n === c).map(([, v]) => v);

// ---------------------------------------------------------------- sort

const SORT: OptSpec = {
  flags: 'bdfghinrsuVM',
  values: 'ktS',
  long: {
    'ignore-leading-blanks': 'b', 'dictionary-order': 'd', 'ignore-case': 'f', 'general-numeric-sort': 'g', 'human-numeric-sort': 'h',
    'numeric-sort': 'n', reverse: 'r', stable: 's', unique: 'u', 'version-sort': 'V', key: 'k', 'field-separator': 't', 'buffer-size': 'S',
  },
};

interface SortKey {
  sf: number; sc: number; ef: number; ec: number;
  opts: string;
}

function parseKey(def: string, global: string): SortKey {
  const m = /^(\d+)(?:\.(\d+))?([bdfghinrV]*)(?:,(\d+)(?:\.(\d+))?([bdfghinrV]*))?$/.exec(def);
  if (!m) throw new Unsupported(`key ${def}`);
  const own = m[3] + (m[6] ?? '');
  return {
    sf: Number(m[1]), sc: m[2] ? Number(m[2]) : 1,
    ef: m[4] ? Number(m[4]) : 0, ec: m[5] ? Number(m[5]) : 0,
    // A key with any ordering option of its own ignores the global ones.
    opts: /[dfghinrV]/.test(own) ? own : own + global,
  };
}

/** Start offsets of fields in `line` (1-based index → offset), GNU style. */
function fieldStarts(line: string, sep: string | undefined): number[] {
  const starts = [0];
  if (sep !== undefined) {
    for (let i = 0; i < line.length; i++) if (line[i] === sep) starts.push(i + 1);
    return starts;
  }
  // Without -t, a field is a run of non-blanks together with the blanks before it.
  for (let i = 1; i < line.length; i++) {
    if (/[ \t]/.test(line[i]) && !/[ \t]/.test(line[i - 1])) starts.push(i);
  }
  return starts;
}

function keyText(line: string, k: SortKey, sep: string | undefined): string {
  const starts = fieldStarts(line, sep);
  const fieldEnd = (f: number) => (f < starts.length ? (starts[f] - (sep !== undefined ? 1 : 0)) : line.length);
  if (k.sf > starts.length) return '';
  let s = starts[k.sf - 1];
  if (k.opts.includes('b')) while (s < line.length && /[ \t]/.test(line[s])) s++;
  s = Math.min(s + k.sc - 1, fieldEnd(k.sf));
  let e: number;
  if (!k.ef) e = line.length;
  else if (k.ef > starts.length) e = line.length;
  else if (!k.ec) e = fieldEnd(k.ef);
  else {
    let fs = starts[k.ef - 1];
    if (k.opts.includes('b')) while (fs < line.length && /[ \t]/.test(line[fs])) fs++;
    e = Math.min(fs + k.ec, fieldEnd(k.ef));
  }
  return e > s ? line.slice(s, e) : '';
}

function numPrefix(s: string): number {
  const m = /^\s*(-?\d*\.?\d+|-?\d+\.?)/.exec(s);
  return m ? Number(m[1]) : 0;
}

function human(s: string): number {
  const m = /^\s*(-?\d*\.?\d+)\s*([KMGTPEZY]?)/i.exec(s);
  if (!m) return 0;
  const mult = 'KMGTPEZY'.indexOf(m[2].toUpperCase()) + 1;
  // GNU compares the sign, then the suffix, then the number (`0K` is zero).
  return (m[2] ? mult * 1e30 * Math.sign(Number(m[1])) : 0) + Number(m[1]);
}

function versionCmp(a: string, b: string): number {
  const split = (s: string) => s.match(/\d+|\D+/g) ?? [];
  const x = split(a);
  const y = split(b);
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const p = x[i] ?? '';
    const q = y[i] ?? '';
    if (/^\d/.test(p) && /^\d/.test(q)) {
      const d = Number(p) - Number(q);
      if (d) return d;
    } else if (p !== q) return p < q ? -1 : 1;
  }
  return 0;
}

const strCmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

function compareKey(a: string, b: string, opts: string): number {
  let x = a;
  let y = b;
  if (opts.includes('d')) { x = x.replace(/[^A-Za-z0-9 \t]/g, ''); y = y.replace(/[^A-Za-z0-9 \t]/g, ''); }
  if (opts.includes('i')) { x = x.replace(/[^\x20-\x7e]/g, ''); y = y.replace(/[^\x20-\x7e]/g, ''); }
  if (opts.includes('f')) { x = x.toUpperCase(); y = y.toUpperCase(); }
  let c: number;
  if (opts.includes('n')) c = numPrefix(x) - numPrefix(y);
  else if (opts.includes('g')) c = (parseFloat(x) || 0) - (parseFloat(y) || 0);
  else if (opts.includes('h')) c = human(x) - human(y);
  else if (opts.includes('V')) c = versionCmp(x, y);
  else c = strCmp(x, y);
  return opts.includes('r') ? -c : c;
}

export function runSort(words: (string | undefined)[], input: string[]): string[] {
  const p = parseOptions(words, SORT);
  if (has(p, 'M')) throw new Unsupported('month sort');
  const global = p.opts.filter(([n]) => 'bdfghinrV'.includes(n)).map(([n]) => n).join('');
  const sep = value(p, 't');
  if (sep !== undefined && [...sep].length !== 1) throw new Unsupported('-t');
  const keys = values(p, 'k').map((k) => parseKey(k, global));
  const allKeys = keys.length ? keys : [{ sf: 1, sc: 1, ef: 0, ec: 0, opts: global }];
  const cmpKeys = (a: string, b: string) => {
    for (const k of allKeys) {
      const c = compareKey(keyText(a, k, sep), keyText(b, k, sep), k.opts);
      if (c) return c;
    }
    return 0;
  };
  const stable = has(p, 's') || has(p, 'u');
  const lastResort = (a: string, b: string) => (stable ? 0 : (global.includes('r') ? -strCmp(a, b) : strCmp(a, b)));
  const sorted = [...input].sort((a, b) => cmpKeys(a, b) || lastResort(a, b));
  if (!has(p, 'u')) return sorted;
  return sorted.filter((l, i) => i === 0 || cmpKeys(sorted[i - 1], l) !== 0);
}

// ---------------------------------------------------------------- uniq

const UNIQ: OptSpec = {
  flags: 'cdDiuz',
  values: 'fsw',
  long: { count: 'c', repeated: 'd', 'all-repeated': 'D', 'ignore-case': 'i', unique: 'u', 'skip-fields': 'f', 'skip-chars': 's', 'check-chars': 'w' },
};

export function runUniq(words: (string | undefined)[], input: string[]): string[] {
  const p = parseOptions(words, UNIQ);
  if (has(p, 'z')) throw new Unsupported('-z');
  const skipF = Number(value(p, 'f') ?? 0);
  const skipC = Number(value(p, 's') ?? 0);
  const width = value(p, 'w') !== undefined ? Number(value(p, 'w')) : Infinity;
  const key = (l: string) => {
    let s = l;
    for (let i = 0; i < skipF; i++) s = s.replace(/^[ \t]*[^ \t]*/, '');
    s = s.slice(skipC).slice(0, width);
    return has(p, 'i') ? s.toLowerCase() : s;
  };
  const groups: string[][] = [];
  for (const l of input) {
    const g = groups[groups.length - 1];
    if (g && key(g[0]) === key(l)) g.push(l);
    else groups.push([l]);
  }
  const out: string[] = [];
  for (const g of groups) {
    if (has(p, 'd') && g.length < 2) continue;
    if (has(p, 'u') && g.length > 1) continue;
    if (has(p, 'D')) { if (g.length > 1) out.push(...g); continue; }
    out.push(has(p, 'c') ? `${String(g.length).padStart(7)} ${g[0]}` : g[0]);
  }
  return out;
}

// ---------------------------------------------------------------- cut

const CUT: OptSpec = {
  flags: 'sn',
  values: 'bcfdO',
  long: { bytes: 'b', characters: 'c', fields: 'f', delimiter: 'd', 'only-delimited': 's', 'output-delimiter': 'O', complement: 'C' },
};

function parseList(list: string): (i: number) => boolean {
  const ranges = list.split(',').map((r) => {
    const m = /^(\d*)(-?)(\d*)$/.exec(r);
    if (!m || (!m[1] && !m[3])) throw new Unsupported(`list ${list}`);
    const a = m[1] ? Number(m[1]) : 1;
    const b = m[2] ? (m[3] ? Number(m[3]) : Infinity) : a;
    return [a, b] as const;
  });
  return (i) => ranges.some(([a, b]) => i >= a && i <= b);
}

export function runCut(words: (string | undefined)[], input: string[]): string[] {
  const complement = words.includes('--complement');
  const p = parseOptions(words.filter((w) => w !== '--complement'), { ...CUT, flags: CUT.flags + 'C' });
  const pick = (sel: (i: number) => boolean) => (i: number) => (complement ? !sel(i) : sel(i));
  const fields = value(p, 'f');
  const chars = value(p, 'c') ?? value(p, 'b');
  if (fields !== undefined) {
    const d = value(p, 'd') ?? '\t';
    if ([...d].length !== 1) throw new Unsupported('-d');
    const od = value(p, 'O') ?? d;
    const sel = pick(parseList(fields));
    return input.flatMap((l) => {
      if (!l.includes(d)) return has(p, 's') ? [] : [l];
      return [l.split(d).filter((_, i) => sel(i + 1)).join(od)];
    });
  }
  if (chars !== undefined) {
    const sel = pick(parseList(chars));
    const od = value(p, 'O');
    return input.map((l) => {
      const cs = [...l];
      if (od === undefined) return cs.filter((_, i) => sel(i + 1)).join('');
      // With --output-delimiter, separate ranges of selected characters.
      let out = '';
      cs.forEach((c, i) => {
        if (!sel(i + 1)) return;
        if (out && !sel(i)) out += od;
        out += c;
      });
      return out;
    });
  }
  throw new Unsupported('cut needs -f, -c or -b');
}

// ---------------------------------------------------------------- tr

const TR_CLASSES: Record<string, string> = {
  alpha: 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz', upper: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', lower: 'abcdefghijklmnopqrstuvwxyz',
  digit: '0123456789', alnum: '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz', space: '\t\n\v\f\r ', blank: '\t ',
  punct: '!"#$%&\'()*+,-./:;<=>?@[\\]^_`{|}~', xdigit: '0123456789ABCDEFabcdef',
};

/** Expand a tr set to its characters; `[c*n]` repeats (n omitted: fill to `fillTo`). */
export function expandSet(set: string, fillTo?: number): string[] {
  const out: string[] = [];
  let fillAt = -1;
  let fillChar = '';
  const esc = (s: string, i: number): [string, number] => {
    const m = /^\\([0-7]{1,3})/.exec(s.slice(i));
    if (m) return [String.fromCharCode(parseInt(m[1], 8)), m[0].length];
    const map: Record<string, string> = { n: '\n', t: '\t', r: '\r', a: '\x07', b: '\b', f: '\f', v: '\v', '\\': '\\' };
    if (s[i] === '\\' && i + 1 < s.length) return [map[s[i + 1]] ?? s[i + 1], 2];
    return [s[i], 1];
  };
  for (let i = 0; i < set.length;) {
    const cls = /^\[:(\w+):\]/.exec(set.slice(i));
    if (cls) {
      if (!TR_CLASSES[cls[1]]) throw new Unsupported(`class ${cls[1]}`);
      out.push(...TR_CLASSES[cls[1]]);
      i += cls[0].length;
      continue;
    }
    const rep = /^\[(\\?.)\*(\d*)\]/.exec(set.slice(i));
    if (rep) {
      const [c] = esc(rep[1], 0);
      if (rep[2] && Number(rep[2]) > 0) out.push(...Array(Number(rep[2])).fill(c));
      else { fillAt = out.length; fillChar = c; }
      i += rep[0].length;
      continue;
    }
    const eqv = /^\[=(.)=\]/.exec(set.slice(i));
    if (eqv) { out.push(eqv[1]); i += eqv[0].length; continue; }
    const [c, n] = esc(set, i);
    if (set[i + n] === '-' && i + n + 1 < set.length) {
      const [d, m] = esc(set, i + n + 1);
      if (d.charCodeAt(0) < c.charCodeAt(0)) throw new Unsupported('reverse range');
      for (let k = c.charCodeAt(0); k <= d.charCodeAt(0); k++) out.push(String.fromCharCode(k));
      i += n + 1 + m;
      continue;
    }
    out.push(c);
    i += n;
  }
  if (fillAt >= 0) out.splice(fillAt, 0, ...Array(Math.max(0, (fillTo ?? out.length) - out.length)).fill(fillChar));
  return out;
}

const TR: OptSpec = { flags: 'cCdst', values: '', long: { complement: 'c', delete: 'd', 'squeeze-repeats': 's', 'truncate-set1': 't' } };

/** tr over the whole text (lines joined with \n), so sets containing \n behave as in tr. */
export function runTr(words: (string | undefined)[], input: string[]): string[] {
  const p = parseOptions(words, TR);
  const sets = p.operands;
  if (sets.some((s) => s === undefined) || !sets.length || sets.length > 2) throw new Unsupported('sets');
  const comp = has(p, 'c') || has(p, 'C');
  const del = has(p, 'd');
  const squeeze = has(p, 's');
  const text = input.map((l) => l + '\n').join('');
  const set1 = expandSet(sets[0]!);
  const in1 = (c: string) => (comp ? !set1.includes(c) : set1.includes(c));
  let out = [...text];
  let squeezeSet: (c: string) => boolean = () => false;
  if (del) {
    out = out.filter((c) => !in1(c));
    if (squeeze) {
      if (sets.length < 2) throw new Unsupported('-ds needs two sets');
      const s2 = expandSet(sets[1]!);
      squeezeSet = (c) => s2.includes(c);
    }
  } else if (sets.length === 2) {
    if (comp) {
      const s2 = expandSet(sets[1]!);
      const last = s2[s2.length - 1];
      if (new Set(s2).size !== 1 || last === undefined) throw new Unsupported('-c with a multi-character set2');
      out = out.map((c) => (in1(c) ? last : c));
      squeezeSet = (c) => c === last;
    } else {
      let from = set1;
      let to = expandSet(sets[1]!, from.length);
      // tr: "when not truncating set1, string2 must be non-empty".
      if (!to.length) throw new Unsupported('empty set2');
      if (has(p, 't')) from = from.slice(0, to.length);
      else if (to.length < from.length) to = [...to, ...Array(from.length - to.length).fill(to[to.length - 1])];
      const map = new Map<string, string>();
      from.forEach((c, i) => map.set(c, to[i]));
      out = out.map((c) => map.get(c) ?? c);
      squeezeSet = (c) => to.includes(c);
    }
  } else if (squeeze) {
    squeezeSet = in1;
  } else {
    throw new Unsupported('tr needs two sets');
  }
  if (squeeze) out = out.filter((c, i) => !(i > 0 && c === out[i - 1] && squeezeSet(c)));
  const joined = out.join('');
  if (joined === '') return [];
  const lines = joined.split('\n');
  if (lines[lines.length - 1] === '') lines.pop();
  return lines;
}

// ---------------------------------------------------------------- head / tail

/** `head -5` / `tail +2` (obsolete forms) become `-n 5` / `-n +2`. */
function normaliseCount(words: (string | undefined)[]): (string | undefined)[] {
  return words.flatMap((w, i) => {
    // `-n -2`: the number is the value of -n, not the obsolete form.
    if (i > 0 && /^(-n|-c|--lines|--bytes)$/.test(words[i - 1] ?? '')) return [w];
    return w && /^-\d+$/.test(w) ? ['-n', w.slice(1)] : w && /^\+\d+$/.test(w) ? ['-n', w] : [w];
  });
}

export function runHead(words: (string | undefined)[], input: string[]): string[] {
  const p = parseOptions(normaliseCount(words), { flags: 'qvz', values: 'nc', long: { lines: 'n', bytes: 'c', quiet: 'q', silent: 'q', verbose: 'v' } });
  const c = value(p, 'c');
  if (c !== undefined) {
    const text = input.map((l) => l + '\n').join('');
    const n = Number(c);
    const part = n < 0 || c.startsWith('-') ? text.slice(0, Math.max(0, text.length - Math.abs(n))) : text.slice(0, n);
    return part.split('\n').filter((l, i, a) => i < a.length - 1 || l !== '');
  }
  const n = value(p, 'n') ?? '10';
  const k = Number(n);
  if (Number.isNaN(k)) throw new Unsupported('-n');
  return n.startsWith('-') ? input.slice(0, Math.max(0, input.length + k)) : input.slice(0, k);
}

export function runTail(words: (string | undefined)[], input: string[]): string[] {
  const p = parseOptions(normaliseCount(words), { flags: 'fFqvz', values: 'ncs', long: { lines: 'n', bytes: 'c', follow: 'f', quiet: 'q', silent: 'q', verbose: 'v' } });
  const c = value(p, 'c');
  if (c !== undefined) {
    const text = input.map((l) => l + '\n').join('');
    const n = Math.abs(Number(c));
    const part = c.startsWith('+') ? text.slice(n - 1) : text.slice(Math.max(0, text.length - n));
    return part.split('\n').filter((l, i, a) => i < a.length - 1 || l !== '');
  }
  const n = value(p, 'n') ?? '10';
  const k = Math.abs(Number(n));
  if (Number.isNaN(k)) throw new Unsupported('-n');
  return n.startsWith('+') ? input.slice(Math.max(0, k - 1)) : input.slice(Math.max(0, input.length - k));
}

// ---------------------------------------------------------------- seq, basename, dirname

export function runSeq(words: (string | undefined)[]): string[] {
  // Negative numbers are operands, not options.
  const fixed = words.map((w) => (w && /^-\d/.test(w) ? `\u0000${w}` : w));
  const p = parseOptions(fixed, { flags: 'w', values: 'sf', long: { 'equal-width': 'w', separator: 's', format: 'f' } });
  const nums = p.operands.map((o) => o?.replace('\u0000', ''));
  if (nums.some((n) => n === undefined || !/^-?(\d+\.?\d*|\.\d+)$/.test(n))) throw new Unsupported('seq operands');
  const [first, inc, last] = nums.length === 1 ? ['1', '1', nums[0]!] : nums.length === 2 ? [nums[0]!, '1', nums[1]!] : [nums[0]!, nums[1]!, nums[2]!];
  const prec = (s: string) => (s.includes('.') ? s.split('.')[1].length : 0);
  const digits = Math.max(prec(first), prec(inc));
  const a = Number(first);
  const d = Number(inc);
  const z = Number(last);
  if (d === 0) throw new Unsupported('zero increment');
  const out: string[] = [];
  for (let k = 0; out.length < 200; k++) {
    const v = a + k * d;
    if (d > 0 ? v > z + 1e-9 : v < z - 1e-9) break;
    out.push(v.toFixed(digits));
  }
  if (out.length >= 200) throw new Unsupported('too long');
  const fmt = value(p, 'f');
  if (fmt !== undefined) throw new Unsupported('-f');
  let lines = out;
  if (has(p, 'w')) {
    // The width includes a minus sign: `seq -w -2 2` gives -2 -1 00 01 02.
    const width = Math.max(...out.map((s) => s.length), z.toFixed(digits).length);
    lines = out.map((s) => (s.startsWith('-') ? '-' + s.slice(1).padStart(width - 1, '0') : s.padStart(width, '0')));
  }
  const sep = value(p, 's');
  return sep === undefined ? lines : [lines.join(sep)];
}

export function runBasename(words: (string | undefined)[]): string[] {
  const p = parseOptions(words, { flags: 'az', values: 's', long: { multiple: 'a', suffix: 's', zero: 'z' } });
  if (p.operands.some((o) => o === undefined) || !p.operands.length) throw new Unsupported('operands');
  const names = p.operands as string[];
  const multiple = has(p, 'a') || has(p, 's');
  const suffix = value(p, 's') ?? (!multiple ? names[1] : undefined);
  const list = multiple ? names : [names[0]];
  return list.map((n) => {
    if (/^\/+$/.test(n)) return '/';
    const base = n.replace(/\/+$/, '').split('/').pop()!;
    return suffix && base !== suffix && base.endsWith(suffix) ? base.slice(0, -suffix.length) : base;
  });
}

export function runDirname(words: (string | undefined)[]): string[] {
  const p = parseOptions(words, { flags: 'z', values: '', long: { zero: 'z' } });
  if (p.operands.some((o) => o === undefined) || !p.operands.length) throw new Unsupported('operands');
  return (p.operands as string[]).map((n) => {
    if (/^\/+$/.test(n)) return '/';
    const trimmed = n.replace(/\/+$/, '');
    const i = trimmed.lastIndexOf('/');
    if (i < 0) return '.';
    const dir = trimmed.slice(0, i).replace(/\/+$/, '');
    return dir === '' ? '/' : dir;
  });
}

// ---------------------------------------------------------------- example input

export const FILTERS: Record<string, (words: (string | undefined)[], input: string[]) => string[]> = {
  sort: runSort, uniq: runUniq, cut: runCut, tr: runTr, head: runHead, tail: runTail,
};

const WORDS = ['banana', 'apple', 'cherry', 'grape', 'melon', 'peach'];
const COLUMNS = [WORDS, ['red', 'green', 'blue', 'yellow', 'pink', 'white'], ['tokyo', 'osaka', 'kyoto', 'nara', 'kobe', 'sendai']];

/** Input lines that make the options of a filter visible. */
export function sampleInput(cmd: string, words: (string | undefined)[]): string[] | undefined {
  try {
    switch (cmd) {
      case 'sort': {
        const p = parseOptions(words, SORT);
        const global = p.opts.filter(([n]) => 'bdfghinrV'.includes(n)).map(([n]) => n).join('');
        const sep = value(p, 't') ?? ' ';
        const keys = values(p, 'k').map((k) => parseKey(k, global));
        const unique = has(p, 'u');
        const kindOf = (opts: string) => (opts.includes('h') ? 'h' : opts.includes('V') ? 'V' : /[ng]/.test(opts) ? 'n' : opts.includes('f') ? 'f' : 's');
        const valuesFor = (kind: string, col: number) => {
          switch (kind) {
            case 'n': return ['10', '9', '100', '25', '9'];
            case 'h': return ['2K', '512', '1G', '10M', '512'];
            case 'V': return ['1.10', '1.2', '1.9', '2.0', '1.2'];
            case 'f': return ['banana', 'Apple', 'cherry', 'apple', 'Apple'];
            default: return [...COLUMNS[col % COLUMNS.length].slice(0, 4), COLUMNS[col % COLUMNS.length][1]];
          }
        };
        if (!keys.length) {
          const vals = valuesFor(kindOf(global), 0);
          return unique ? vals : vals.slice(0, 4);
        }
        const cols = Math.max(...keys.map((k) => Math.max(k.sf, k.ef)), 2);
        const kinds = Array.from({ length: cols }, (_, c) => {
          const k = keys.find((x) => x.sf === c + 1);
          return k ? kindOf(k.opts) : 's';
        });
        const rows = Array.from({ length: unique ? 5 : 4 }, (_, r) => kinds.map((kind, c) => {
          const v = valuesFor(kind, c)[r];
          return kind === 's' && c > 0 ? COLUMNS[c % COLUMNS.length][(r * 2 + c) % 6] : v;
        }));
        if (unique) rows[4] = [...rows[1]];
        return rows.map((r) => r.join(sep));
      }
      case 'uniq': {
        const p = parseOptions(words, UNIQ);
        if (has(p, 'i')) return ['apple', 'Apple', 'banana', 'apple', 'cherry', 'cherry'];
        if (value(p, 'f')) return ['1 apple', '2 apple', '3 banana', '4 apple', '5 cherry', '6 cherry'];
        return ['apple', 'apple', 'banana', 'apple', 'cherry', 'cherry'];
      }
      case 'cut': {
        const p = parseOptions(words.filter((w) => w !== '--complement'), { ...CUT, flags: CUT.flags + 'C' });
        const list = value(p, 'f') ?? value(p, 'c') ?? value(p, 'b') ?? '1';
        const max = Math.max(...list.split(/[,-]/).filter(Boolean).map(Number));
        if (value(p, 'f') !== undefined) {
          const d = value(p, 'd') ?? '\t';
          const n = Math.max(max + 1, 4);
          const rows = [
            ['1', 'alice', 'tokyo', '30', 'admin', 'x', 'y', 'z'],
            ['2', 'bob', 'osaka', '25', 'user', 'x', 'y', 'z'],
            ['3', 'carol', 'kyoto', '41', 'user', 'x', 'y', 'z'],
          ].map((r) => Array.from({ length: n }, (_, i) => r[i] ?? `f${i + 1}`).join(d));
          return has(p, 's') ? [...rows, 'no delimiter here'] : rows;
        }
        const len = Math.max(max + 3, 12);
        return ['abcdefghijklmnopqrstuvwxyz'.slice(0, len), '0123456789abcdefghijklmn'.slice(0, len)];
      }
      case 'tr': {
        const p = parseOptions(words, TR);
        const set1 = p.operands[0] !== undefined ? expandSet(p.operands[0]) : [];
        // A complement keeps the set and changes everything else, so include other characters.
        if (has(p, 'c') || has(p, 'C')) return ['Hello, World! #123'];
        if (set1.includes('\n')) return ['one', 'two', 'three'];
        if (set1.includes('\r')) return ['line 1\r', 'line 2\r'];
        if (has(p, 's') && set1.includes(' ')) return ['too   many    spaces'];
        const letters = set1.every((c) => /[A-Za-z]/.test(c));
        if (letters && set1.length >= 10) return ['Hello World 123'];
        // Make sure characters of the set appear in the text.
        const picks = [...new Set(set1)].filter((c) => c >= ' ').slice(0, 3).join('');
        return [`abc ${picks} xyz ${picks.slice(0, 1)}`];
      }
      case 'head':
      case 'tail': {
        const p = parseOptions(normaliseCount(words), { flags: 'fFqvz', values: 'ncs', long: { lines: 'n', bytes: 'c', follow: 'f' } });
        if (value(p, 'c') !== undefined) return ['abcdefghij', 'klmnopqrst'];
        const n = Math.abs(Number(value(p, 'n') ?? '10'));
        const count = Math.min(Math.max(n + 3, 6), 14);
        return Array.from({ length: count }, (_, i) => `line ${i + 1}`);
      }
    }
  } catch (e) {
    if (e instanceof Unsupported) return undefined;
    // A bug in the simulation: let it show.
    /* c8 ignore next */
    throw e;
  }
  return undefined;
}

export interface CommandExample {
  input?: string[];
  output: string[];
}

/** An example for one of the supported commands, or undefined. */
export function commandExample(cmd: string, words: (string | undefined)[]): CommandExample | undefined {
  try {
    if (cmd === 'seq') return { output: runSeq(words) };
    if (cmd === 'basename') return { output: runBasename(words) };
    if (cmd === 'dirname') return { output: runDirname(words) };
    const run = FILTERS[cmd];
    if (!run) return undefined;
    const input = sampleInput(cmd, words);
    if (!input) return undefined;
    return { input, output: run(words, input) };
  } catch (e) {
    if (e instanceof Unsupported) return undefined;
    // A bug in the simulation: let it show.
    /* c8 ignore next */
    throw e;
  }
}
