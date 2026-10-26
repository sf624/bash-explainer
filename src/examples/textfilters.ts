/**
 * Line-oriented coreutils (sort, uniq, cut, tr, head, tail) and argument-only commands
 * (seq, basename, dirname), simulated with GNU semantics in the C locale.
 */
import { Unsupported as RunnerUnsupported } from './unsupported';

import { type ArgRole, type ArgvParse, interpret } from '../argv/interpret';
import { lookupCommand } from '../dict/aliases';
import { wordTable } from '../wordtable';

export class Unsupported extends RunnerUnsupported {}

/**
 * The options a simulator follows: a name of the option in the command's dictionary spec (any of its names) → the
 * key it has in `Parsed.opts`. The key `_` marks an option whose value the simulator does not read, so it may be not literal.
 */
export type Supported = Record<string, string>;

export interface Parsed {
  /** Options in order: [key, value] (value '' for flags and for an optional value not given). */
  opts: [string, string][];
  /** Operands (files, numbers, names); undefined when not literal. */
  operands: (string | undefined)[];
  /** The index of the word that starts the command this one runs (`xargs … CMD`), if any. */
  command?: number;
}

/** The parse of a command's words with its dictionary spec, as the explanation reads them; a word that is not literal is undefined. */
export function parseWords(cmd: string, words: (string | undefined)[]): ArgvParse {
  return interpret(lookupCommand(cmd)!, words.map((w) => (w === undefined ? {} : { value: w })), { name: cmd, lookup: lookupCommand });
}

/**
 * The options and operands of `cmd`'s words, read with its dictionary spec (`parseWords`): clusters (`-nr`), values
 * attached or in the next word (`-k2`, `-t :`), `--name=value`, a unique prefix of a long name where the tool takes
 * one (`--rev`), and `--`. An option `supported` does not name, one the spec does not know or that is ambiguous, and
 * a value that is missing or not literal throw `Unsupported`. `pattern` gives the key and value of an option the
 * spec recognises by its form (`head -5`: `-n 5`).
 */
export function parseOptions(cmd: string, words: (string | undefined)[], supported: Supported, pattern?: (flag: string) => [string, string]): Parsed {
  const out: Parsed = { opts: [], operands: [] };
  const option = (r: ArgRole, word: number): void => {
    if (r.role === 'pattern-option' && pattern) { out.opts.push(pattern(r.flag)); return; }
    if (r.role !== 'option') throw new Unsupported(`${r.role} ${words[word]}`);
    const key = r.spec.names.map((n) => supported[n]).find((k) => k !== undefined);
    if (key === undefined) throw new Unsupported(r.flag);
    if (r.missing) throw new Unsupported('missing value');
    out.opts.push([key, r.value ? words[word]!.slice(r.value.attached) : '']);
  };
  const parse = parseWords(cmd, words);
  // (A line the tool refuses, `grep -E -F`, runs nothing.)
  if (parse.refused) throw new Unsupported('refused');
  for (const { word, role } of parse.roles) {
    switch (role.role) {
      case 'operand': out.operands.push(words[word]); break;
      case 'end-of-options': break;
      case 'command': out.command = word; break;
      case 'cluster': role.letters.forEach((l) => option(l, word)); break;
      case 'value': {
        const v = words[word];
        // (A value the simulator does not read, key `_`, may be anything: getopt's `-n "$0"`.)
        if (v === undefined && out.opts[out.opts.length - 1][0] !== '_') throw new Unsupported('missing value');
        out.opts[out.opts.length - 1][1] = v ?? '';
        break;
      }
      default: option(role, word);
    }
  }
  return out;
}

/** The short options `-x` of `letters` as keys `x`, and `more`. */
export const shortKeys = (letters: string, more: Supported = {}): Supported => ({ ...Object.fromEntries([...letters].map((c) => [`-${c}`, c])), ...more });

const has = (p: Parsed, c: string) => p.opts.some(([n]) => n === c);
const value = (p: Parsed, c: string) => [...p.opts].reverse().find(([n]) => n === c)?.[1];
const values = (p: Parsed, c: string) => p.opts.filter(([n]) => n === c).map(([, v]) => v);

// ---------------------------------------------------------------- sort

/** The options of sort the simulation follows (`-S`, the buffer size, changes nothing it shows; `-o` only where the output goes). */
const SORT = shortKeys('bdfghinrsuVktS', { '-o': '_' });

/** Whether sort's words give `-u` (`-nu`, `--unique`, `--uniq`); throws Unsupported where the simulation cannot follow them. */
export const sortsUnique = (words: (string | undefined)[]): boolean => has(parseOptions('sort', words, SORT), 'u');

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

/** How `sort -h` orders a key: by the order of its suffix, negative for a negative number (`0K` has none), then by the number. */
function human(s: string): [number, number] {
  // (The suffix follows the number at once: `220 Mar` is 220. Only `k` is also taken in lower case.)
  const m = /^\s*(-?\d*\.?\d+)([kKMGTPEZYRQ]?)/.exec(s);
  if (!m) return [0, 0];
  const n = Number(m[1]);
  return [m[2] ? ('KMGTPEZYRQ'.indexOf(m[2].toUpperCase()) + 1) * Math.sign(n) : 0, n];
}

const humanCmp = (a: string, b: string): number => {
  const [x, y] = [human(a), human(b)];
  return x[0] - y[0] || x[1] - y[1];
};

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
  else if (opts.includes('h')) c = humanCmp(x, y);
  else if (opts.includes('V')) c = versionCmp(x, y);
  else c = strCmp(x, y);
  return opts.includes('r') ? -c : c;
}

export function runSort(words: (string | undefined)[], input: string[]): string[] {
  const p = parseOptions('sort', words, SORT);
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

/** The options of uniq the simulation follows; `--all-repeated` only as `-D` (its method `none`). */
const UNIQ = shortKeys('cdDiufsw', { '--all-repeated': 'D' });

const uniqOptions = (words: (string | undefined)[]): Parsed => {
  const p = parseOptions('uniq', words, UNIQ);
  if (p.opts.some(([k, v]) => k === 'D' && v !== '' && v !== 'none')) throw new Unsupported('--all-repeated');
  return p;
};

export function runUniq(words: (string | undefined)[], input: string[]): string[] {
  const p = uniqOptions(words);
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

/** The options of cut the simulation follows (`-n` changes nothing). */
const CUT = shortKeys('snbcfd', { '--output-delimiter': 'O', '--complement': 'C' });

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
  const p = parseOptions('cut', words, CUT);
  const complement = has(p, 'C');
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

const TR_CLASSES: Record<string, string> = wordTable({
  alpha: 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz', upper: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', lower: 'abcdefghijklmnopqrstuvwxyz',
  digit: '0123456789', alnum: '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz', space: '\t\n\v\f\r ', blank: '\t ',
  punct: '!"#$%&\'()*+,-./:;<=>?@[\\]^_`{|}~', xdigit: '0123456789ABCDEFabcdef',
});

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

/** The options of tr the simulation follows. */
const TR = shortKeys('cdst');

/** tr over the whole text (lines joined with \n), so sets containing \n behave as in tr. */
export function runTr(words: (string | undefined)[], input: string[]): string[] {
  const p = parseOptions('tr', words, TR);
  const sets = p.operands;
  if (sets.some((s) => s === undefined) || !sets.length || sets.length > 2) throw new Unsupported('sets');
  const comp = has(p, 'c');
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

/** The options of head and tail the simulation follows. */
const HEAD = shortKeys('qvznc');
const TAIL = shortKeys('fFqvzncs', { '--follow': 'f' });

/** `head -5`, `tail -5`, `tail +2` (the old forms the specs recognise) are `-n 5`, `-n +2`. */
const lineCount = (flag: string): [string, string] => ['n', flag.startsWith('+') ? flag : flag.slice(1)];

const countOptions = (cmd: 'head' | 'tail', words: (string | undefined)[]): Parsed => parseOptions(cmd, words, cmd === 'head' ? HEAD : TAIL, lineCount);

/** The lines of a text, the last one with or without its newline. */
const linesOf = (text: string): string[] => text.split('\n').filter((l, i, a) => i < a.length - 1 || l !== '');

/** The text `head` prints for the input lines: with `-c`, bytes, which may end without a newline. */
function headText(words: (string | undefined)[], input: string[]): string {
  const p = countOptions('head', words);
  const c = value(p, 'c');
  const text = input.map((l) => l + '\n').join('');
  if (c !== undefined) {
    const n = Number(c);
    return n < 0 || c.startsWith('-') ? text.slice(0, Math.max(0, text.length - Math.abs(n))) : text.slice(0, n);
  }
  const n = value(p, 'n') ?? '10';
  const k = Number(n);
  if (Number.isNaN(k)) throw new Unsupported('-n');
  return (n.startsWith('-') ? input.slice(0, Math.max(0, input.length + k)) : input.slice(0, k)).map((l) => l + '\n').join('');
}

/** The text `tail` prints for the input lines. */
function tailText(words: (string | undefined)[], input: string[]): string {
  const p = countOptions('tail', words);
  const c = value(p, 'c');
  const text = input.map((l) => l + '\n').join('');
  if (c !== undefined) {
    const n = Math.abs(Number(c));
    return c.startsWith('+') ? text.slice(n - 1) : text.slice(Math.max(0, text.length - n));
  }
  const n = value(p, 'n') ?? '10';
  const k = Math.abs(Number(n));
  if (Number.isNaN(k)) throw new Unsupported('-n');
  return (n.startsWith('+') ? input.slice(Math.max(0, k - 1)) : input.slice(Math.max(0, input.length - k))).map((l) => l + '\n').join('');
}

export function runHead(words: (string | undefined)[], input: string[]): string[] {
  return linesOf(headText(words, input));
}

export function runTail(words: (string | undefined)[], input: string[]): string[] {
  return linesOf(tailText(words, input));
}

/**
 * What `head` or `tail` prints for several files: each file's text under a header `==> name <==`, with a newline
 * before each header but the first (a blank line after a file's last line; none after bytes cut without one, `-c`);
 * no header with `-q`, a header for one file too with `-v` (the last of them given wins).
 */
export function perFile(cmd: 'head' | 'tail', files: { name: string; lines: string[] }[], words: (string | undefined)[]): string[] {
  const flags = parseWords(cmd, words).roles.flatMap(({ role }) => (role.role === 'cluster' ? role.letters : [role]))
    .flatMap((r) => (r.role === 'option' ? r.spec.names.filter((n) => n === '-q' || n === '-v') : []));
  const last = flags.pop();
  const headers = last === '-v' || (last !== '-q' && files.length > 1);
  const text = cmd === 'head' ? headText : tailText;
  return linesOf(files.map((f, i) => (headers ? `${i ? '\n' : ''}==> ${f.name} <==\n` : '') + text(words, f.lines)).join(''));
}

// ---------------------------------------------------------------- seq, basename, dirname

export function runSeq(words: (string | undefined)[]): string[] {
  // (A negative number is an operand: the spec says so, as GNU seq reads it.)
  const p = parseOptions('seq', words, shortKeys('wsf'));
  const nums = p.operands;
  // seq needs one to three numbers.
  if (nums.length < 1 || nums.length > 3 || nums.some((n) => n === undefined || !/^-?(\d+\.?\d*|\.\d+)$/.test(n))) throw new Unsupported('seq operands');
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
  const p = parseOptions('basename', words, shortKeys('asz'));
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
  const p = parseOptions('dirname', words, shortKeys('z'));
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

/** cat with no option: what it reads, as it is (an option it has, `-n`, is not followed). */
function runCat(words: (string | undefined)[], input: string[]): string[] {
  parseOptions('cat', words, {});
  return input;
}

export const FILTERS: Record<string, (words: (string | undefined)[], input: string[]) => string[]> = {
  cat: runCat, sort: runSort, uniq: runUniq, cut: runCut, tr: runTr, head: runHead, tail: runTail,
};

const WORDS = ['banana', 'apple', 'cherry', 'grape', 'melon', 'peach'];
const COLUMNS = [WORDS, ['red', 'green', 'blue', 'yellow', 'pink', 'white'], ['tokyo', 'osaka', 'kyoto', 'nara', 'kobe', 'sendai']];

const SORT_EXTRA: Record<string, string[]> = {
  n: ['3', '47', '1000', '18', '250', '6', '81', '12'],
  h: ['3K', '20M', '700', '4G', '15K', '90M', '2M', '8K'],
  V: ['1.5', '3.0', '1.11', '2.1', '1.0', '2.10', '3.2', '1.3'],
  f: ['Date', 'elder', 'Fig', 'grape', 'Honey', 'kiwi', 'Lime', 'mango'],
  s: ['grape', 'melon', 'peach', 'lemon', 'plum', 'kiwi', 'mango', 'fig'],
};
const EXTRA_NAMES = ['dave', 'erin', 'frank', 'grace', 'heidi', 'ivan', 'judy', 'kate', 'leo', 'mia', 'noah', 'olga'];
const EXTRA_CITIES = ['nagoya', 'sapporo', 'kobe', 'nara', 'fukuoka', 'sendai', 'chiba', 'kawasaki', 'hiroshima', 'akita', 'saga', 'kochi'];

/** Input lines that make the options of a filter visible. */
export function sampleInput(cmd: string, words: (string | undefined)[], more = 0): string[] | undefined {
  try {
    switch (cmd) {
      case 'sort': {
        const p = parseOptions('sort', words, SORT);
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
          if (more) return [...(unique ? vals : vals.slice(0, 4)), ...SORT_EXTRA[kindOf(global)].slice(0, more)];
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
        const p = uniqOptions(words);
        if (has(p, 'i')) return ['apple', 'Apple', 'banana', 'apple', 'cherry', 'cherry'];
        if (value(p, 'f')) return ['1 apple', '2 apple', '3 banana', '4 apple', '5 cherry', '6 cherry'];
        return ['apple', 'apple', 'banana', 'apple', 'cherry', 'cherry'];
      }
      case 'cut': {
        const p = parseOptions('cut', words, CUT);
        const list = value(p, 'f') ?? value(p, 'c') ?? value(p, 'b') ?? '1';
        const max = Math.max(...list.split(/[,-]/).filter(Boolean).map(Number));
        if (value(p, 'f') !== undefined) {
          const d = value(p, 'd') ?? '\t';
          const n = Math.max(max + 1, 4);
          const rows = [
            ['1', 'alice', 'tokyo', '30', 'admin', 'x', 'y', 'z'],
            ['2', 'bob', 'osaka', '25', 'user', 'x', 'y', 'z'],
            ['3', 'carol', 'kyoto', '41', 'user', 'x', 'y', 'z'],
            ...Array.from({ length: Math.min(more, EXTRA_NAMES.length) }, (_, i) => [
              String(i + 4), EXTRA_NAMES[i], EXTRA_CITIES[i], String(20 + ((i * 7) % 30)), i % 2 ? 'admin' : 'user', 'x', 'y', 'z']),
          ].map((r) => Array.from({ length: n }, (_, i) => r[i] ?? `f${i + 1}`).join(d));
          return has(p, 's') ? [...rows, 'no delimiter here'] : rows;
        }
        const len = Math.max(max + 3, 12);
        return ['abcdefghijklmnopqrstuvwxyz'.slice(0, len), '0123456789abcdefghijklmn'.slice(0, len)];
      }
      case 'tr': {
        const p = parseOptions('tr', words, TR);
        const set1 = p.operands[0] !== undefined ? expandSet(p.operands[0]) : [];
        // A complement keeps the set and changes everything else, so include other characters.
        if (has(p, 'c')) return ['Hello, World! #123'];
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
        const p = countOptions(cmd, words);
        if (value(p, 'c') !== undefined) return ['abcdefghij', 'klmnopqrst'];
        const n = Math.abs(Number(value(p, 'n') ?? '10'));
        const count = Math.min(Math.max(n + 3, 6), 14) + more;
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
    // (cat's lines are any text; they are not a sample for the stages after it in a pipeline, as `sampleInput` gives.)
    const input = cmd === 'cat' ? ['line 1', 'line 2', 'line 3', 'line 4'] : sampleInput(cmd, words);
    if (!input) return undefined;
    return { input, output: run(words, input) };
  } catch (e) {
    if (e instanceof Unsupported) return undefined;
    // A bug in the simulation: let it show.
    /* c8 ignore next */
    throw e;
  }
}
