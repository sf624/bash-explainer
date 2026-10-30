/** Simulations of xargs, simple test conditions and `read` word splitting, for worked examples. */
import type { BashVersion } from '../bashversion';
import { IFS_ERRATIC, IFS_WHITESPACE } from '../semantics/chars';
import { globExamples, globMatches } from './shellwords';
import { parseOptions, Parsed, shortKeys, Unsupported } from './textfilters';

// ---------------------------------------------------------------- xargs

/** The options of xargs the examples follow (`-t`, `-x` and `-P` change nothing they show; `-a` only where the items come from). */
const XARGS = shortKeys('0rtxnLIdPil', { '-a': '_' });

/**
 * xargs' options, read with its dictionary spec, and the command it runs (`echo` when none is given). `-i` and `-l`,
 * whose value is only attached (`-i@`, `-l2`), are `-I {}` and `-L 1` without one.
 */
function xargsOptions(words: (string | undefined)[]): { p: Parsed; command: (string | undefined)[] } {
  const p = parseOptions('xargs', words, XARGS);
  p.opts = p.opts.map(([n, v]) => (n === 'i' ? ['I', v || '{}'] : n === 'l' ? ['L', v || '1'] : [n, v]));
  return { p, command: p.command === undefined ? ['echo'] : words.slice(p.command) };
}

/** Split xargs input the default way: blanks and newlines separate, quotes and backslashes group. */
function xargsTokens(text: string): string[] {
  const out: string[] = [];
  let cur = '';
  let inWord = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"' || c === "'") {
      const end = text.indexOf(c, i + 1);
      if (end < 0) throw new Unsupported('unmatched quote');
      cur += text.slice(i + 1, end);
      i = end;
      inWord = true;
    } else if (c === '\\' && i + 1 < text.length) {
      cur += text[++i];
      inWord = true;
    } else if (/\s/.test(c)) {
      if (inWord) out.push(cur);
      cur = '';
      inWord = false;
    } else {
      cur += c;
      inWord = true;
    }
  }
  if (inWord) out.push(cur);
  return out;
}

/** The command lines xargs runs for `input` (the text on its stdin). */
export function runXargs(words: (string | undefined)[], input: string): string[][] {
  const { p, command: cmd } = xargsOptions(words);
  if (cmd.some((w) => w === undefined)) throw new Unsupported('non-literal command');
  const command = cmd as string[];
  const get = (c: string) => [...p.opts].reverse().find(([n]) => n === c)?.[1];
  const replace = get('I');
  const delim = p.opts.some(([n]) => n === '0') ? '\0' : get('d')?.replace(/^\\n$/, '\n').replace(/^\\t$/, '\t');
  let items: string[];
  if (delim !== undefined) {
    items = input.split(delim);
    // (With -d , the newline that ends the input stays in the last item, as in GNU xargs.)
    if (items[items.length - 1] === '') items.pop();
    // With -I, each item is a run of its own (`-0 -I{}`), blanks and empty items kept.
    if (replace !== undefined) return items.map((item) => command.map((w) => w.split(replace).join(item)));
  } else if (replace !== undefined) {
    // Without a delimiter -I takes whole lines, with leading blanks removed and empty lines skipped.
    items = input.split('\n').map((l) => l.replace(/^[ \t]+/, '')).filter((l) => l !== '');
    return items.map((item) => command.map((w) => w.split(replace).join(item)));
  } else if (get('L') !== undefined) {
    const per = Number(get('L'));
    const lines = input.split('\n').filter((l) => l.trim() !== '');
    const out: string[][] = [];
    for (let i = 0; i < lines.length; i += per) out.push([...command, ...xargsTokens(lines.slice(i, i + per).join('\n'))]);
    return out;
  } else {
    items = xargsTokens(input);
  }
  const n = get('n') !== undefined ? Number(get('n')) : Infinity;
  if (!items.length) return p.opts.some(([c]) => c === 'r') ? [] : [command];
  const out: string[][] = [];
  for (let i = 0; i < items.length; i += n === Infinity ? items.length : n) out.push([...command, ...items.slice(i, i + (n === Infinity ? items.length : n))]);
  return out;
}

/** Shell-style display of a command line. */
export function showCommand(words: string[]): string {
  const quote = (w: string) => {
    if (w === '') return "''";
    if (/[\x00-\x1f\x7f]/.test(w)) return `$'${w.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/[\x00-\x1f\x7f]/g, (c) => ({ '\n': '\\n', '\t': '\\t', '\r': '\\r' } as Record<string, string>)[c] ?? `\\x${c.charCodeAt(0).toString(16).padStart(2, '0')}`)}'`;
    return /[^A-Za-z0-9_\-.,:/@%+=]/.test(w) ? `'${w.replace(/'/g, "'\\''")}'` : w;
  };
  return words.map(quote).join(' ');
}

/** Input that shows how xargs groups items, and the commands that result. */
export function xargsExample(words: (string | undefined)[]): { input: string; commands: string[] } | undefined {
  try {
    const { p } = xargsOptions(words);
    const get = (c: string) => p.opts.find(([n]) => n === c)?.[1];
    const files = ['a.txt', 'b.txt', 'c.txt', 'd.txt', 'e.txt'];
    let input: string;
    if (p.opts.some(([n]) => n === '0')) input = files.slice(0, 3).join('\0') + '\0';
    else if (get('d') !== undefined) input = files.slice(0, 3).join(get('d')!.replace(/^\\n$/, '\n')) + '\n';
    else if (get('L') !== undefined) input = 'a.txt b.txt\nc.txt\nd.txt e.txt\n';
    else if (get('I') !== undefined) input = 'a.txt\nmy file.txt\nc.txt\n';
    else input = files.join('\n') + '\n';
    const commands = runXargs(words, input).map(showCommand);
    return { input, commands };
  } catch (e) {
    if (e instanceof Unsupported) return undefined;
    // A bug in the simulation: let it show.
    /* c8 ignore next */
    throw e;
  }
}

// ---------------------------------------------------------------- conditions

export type Operand = { var: string } | { lit: string };

export interface TestCase {
  /** Variable values to set (positional parameters as "1", "2"…). */
  vars: Record<string, string>;
  result: boolean;
}

/**
 * Values that make a simple test true and false. `kind` is `[` (test), `[[` or `((`.
 * Undefined for tests whose result depends on the system (file tests) or on several conditions. `known`: the value
 * the script gives the variable there (as one word), which takes the place of the sample with the same result.
 */
export function testCases(kind: '[' | '[[' | '((', op: string, left: Operand | undefined, right: Operand | undefined, quotedRight = false, known?: string): TestCase[] | undefined {
  const cases = sampleTests(kind, op, left, right, quotedRight);
  // (The model has no values in arithmetic: none for `(( ))`.)
  const truth = cases && known !== undefined && kind !== '((' ? knownTruth(kind, op, left, right, known, quotedRight) : undefined;
  if (truth === undefined) return cases;
  const name = Object.keys(cases![0].vars)[0];
  const i = cases!.findIndex((c) => c.result === truth);
  return cases!.map((c, j) => (j === i ? { vars: { [name]: known! }, result: truth } : c));
}

/** The integer tests, as functions; and the operators of `(( ))` that are the same tests. */
const NUMERIC: Record<string, (a: number, b: number) => boolean> = {
  '-eq': (a, b) => a === b, '-ne': (a, b) => a !== b, '-lt': (a, b) => a < b, '-le': (a, b) => a <= b, '-gt': (a, b) => a > b, '-ge': (a, b) => a >= b,
};
const ARITH_TESTS: Record<string, string> = { '==': '-eq', '!=': '-ne', '<': '-lt', '<=': '-le', '>': '-gt', '>=': '-ge' };

/**
 * Whether the test `sampleTests` has cases for is true with `known` for its variable; undefined when that is not
 * sure here: an integer test of a number that is not a plain decimal integer (`010` is 8 in arithmetic, 10 for `-eq`).
 */
function knownTruth(kind: '[' | '[[', op: string, left: Operand | undefined, right: Operand | undefined, known: string, quotedRight: boolean): boolean | undefined {
  if (left === undefined) return op === '-z' ? known === '' : known !== '';
  const lit = ('lit' in left ? left : right as { lit: string }).lit;
  const f = NUMERIC[op];
  if (f) {
    const plain = (t: string) => /^(0|-?[1-9]\d{0,14})$/.test(t);
    if (!plain(known) || !plain(lit)) return undefined;
    return 'var' in left ? f(Number(known), Number(lit)) : f(Number(lit), Number(known));
  }
  // (In `[[ ]]` the right side is a pattern: one with a glob character is not compared as text, nor is a tilde, which
  // expands; nor the variable's value when it is that side, unquoted: `x='a*'; [[ abc == $x ]]` is true.)
  if (kind === '[[' && (/[*?[]/.test(lit) || lit.startsWith('~') || ('var' in right! && !quotedRight && /[*?[\\]/.test(known)))) return undefined;
  return (known === lit) !== (op === '!=');
}

function sampleTests(kind: '[' | '[[' | '((', op: string, left: Operand | undefined, right: Operand | undefined, quotedRight: boolean): TestCase[] | undefined {
  // Unary string tests.
  if (left === undefined && right && 'var' in right) {
    const v = right.var;
    // `[ -n $x ]` with an empty $x is `[ -n ]`: a one-word test of the text "-n", which is true.
    if (op === '-n' && kind === '[' && !quotedRight) return [{ vars: { [v]: 'abc' }, result: true }, { vars: { [v]: '' }, result: true }];
    if (op === '-z') return [{ vars: { [v]: '' }, result: true }, { vars: { [v]: 'abc' }, result: false }];
    if (op === '-n') return [{ vars: { [v]: 'abc' }, result: true }, { vars: { [v]: '' }, result: false }];
    return undefined;
  }
  if (!left || !right) return undefined;
  const vars = [left, right].filter((o): o is { var: string } => 'var' in o);
  if (vars.length !== 1) return undefined;
  const v = vars[0].var;
  // The other side is the literal.
  const lit = ('lit' in left ? left : right as { lit: string }).lit;
  const varOnLeft = 'var' in left;
  const numOp = kind === '((' ? ARITH_TESTS[op] : NUMERIC[op] ? op : undefined;
  if (numOp) {
    if (!/^-?\d+$/.test(lit)) return undefined;
    const n = Number(lit);
    const f = NUMERIC[numOp];
    const candidates = [n, n + 1, n - 1, n + 10, n - 10];
    const truth = (x: number) => (varOnLeft ? f(x, n) : f(n, x));
    // n and n + 1 always give one of each.
    const t = candidates.find(truth)!;
    const fl = candidates.find((x) => !truth(x))!;
    return [{ vars: { [v]: String(t) }, result: true }, { vars: { [v]: String(fl) }, result: false }];
  }
  if (kind === '((') return undefined;
  if (op === '=' || op === '==' || op === '!=') {
    const neg = op === '!=';
    const other = lit === '' ? 'abc' : lit + 'x';
    return [{ vars: { [v]: neg ? other : lit }, result: true }, { vars: { [v]: neg ? lit : other }, result: false }];
  }
  return undefined;
}

// ---------------------------------------------------------------- read

export interface ReadResult {
  /** Variable name → value; for -a the array elements. */
  vars: [string, string][];
  array?: [string, string[]];
}

/** A character of the line `read` keeps, or null for the mark it puts before one that a backslash escapes. */
type Cell = string | null;

/** IFS whitespace (src/semantics/chars.ts); and space, tab and newline, which `read` alone skips in some places. */
const isSpace = (c: Cell): boolean => c !== null && IFS_WHITESPACE.includes(c);
const isSpcTabNl = (c: Cell): boolean => c !== null && ' \t\n'.includes(c);

/**
 * bash's `read [-r] [-a arr] [name…]` splitting of one line with the given IFS, as `version` does it (bash 5.2 when it is
 * not given); undefined for an IFS that holds byte 1 or 127, which bash uses as marks of its own (it splits erratically).
 * bash skips IFS whitespace before each field, but only space, tab and newline at the start of the line and right after
 * a separator; at the end of the last variable's text, bash 5.3 removes IFS whitespace, bash 5.2 only space, tab and
 * newline (`IFS=$'\v' read -r a b` of `x\v\vy\v\v`: `b` is `\vy\v\v` in 5.2, `\vy` in 5.3). With no name, `REPLY` gets
 * the whole line. Checked against both releases: test/examples-runtime.test.ts.
 */
export function runRead(line: string, names: string[], opts: { ifs: string; raw: boolean; array?: string; version?: BashVersion }): ReadResult | undefined {
  const ifs = opts.ifs;
  if (IFS_ERRATIC.test(ifs)) return undefined;
  // The line, up to its first newline; without -r a backslash keeps the next character (a mark before it), and a
  // backslash before a newline goes away with it. bash marks the bytes 1 and 127 of the line too.
  const buf: Cell[] = [];
  let escape = false;
  for (const c of line) {
    if (escape) {
      escape = false;
      if (c === '\n') buf.pop();
      else buf.push(c);
    } else if (c === '\\' && !opts.raw) {
      escape = true;
      buf.push(null);
    } else if (c === '\n') break;
    else buf.push(...(c === '\x01' || c === '\x7f' ? [null, c] : [c]));
  }
  if (escape) buf.pop();
  const isIfs = (c: Cell): boolean => c !== null && ifs.includes(c);
  // (A mark at the end, left by the trim below, stays as the byte 1.)
  const text = (cells: Cell[]): string => cells.map((c, k) => c ?? (k === cells.length - 1 ? '\x01' : '')).join('');
  // The end of the text of a field from `i`: the next separator that is not escaped.
  const fieldEnd = (i: number): number => {
    while (i < buf.length && !isIfs(buf[i])) i += buf[i] === null ? 2 : 1;
    return i;
  };
  // Where the next field starts after the separator at `j`: IFS whitespace (`white`) after it, and one separator that is
  // not whitespace after whitespace, with the whitespace after that.
  const skipSeparator = (j: number, white: (c: Cell) => boolean): number => {
    const first = isSpace(buf[j]);
    j++;
    while (j < buf.length && white(buf[j]) && isIfs(buf[j])) j++;
    if (j < buf.length && first && isIfs(buf[j]) && !isSpace(buf[j])) {
      j++;
      while (j < buf.length && isSpace(buf[j]) && isIfs(buf[j])) j++;
    }
    return j;
  };
  if (opts.array) {
    // As word splitting does it: IFS whitespace around the fields goes, and a separator that is not whitespace after
    // an empty field gives an empty element.
    const fields: string[] = [];
    let i = 0;
    while (i < buf.length && isIfs(buf[i]) && isSpace(buf[i])) i++;
    while (i < buf.length) {
      const j = fieldEnd(i);
      if (j > i || !isSpace(buf[j])) fields.push(text(buf.slice(i, j)));
      i = j < buf.length ? skipSeparator(j, isSpace) : j;
    }
    return { vars: [], array: [opts.array, fields] };
  }
  if (!names.length) return { vars: [['REPLY', text(buf)]] };
  // A field from `i`: its text, and where the rest of the line starts.
  const field = (i: number): { cells: Cell[]; next: number } => {
    while (i < buf.length && isSpace(buf[i]) && isIfs(buf[i])) i++;
    const j = fieldEnd(i);
    return { cells: buf.slice(i, j), next: j < buf.length ? skipSeparator(j, isSpcTabNl) : j };
  };
  let i = 0;
  while (i < buf.length && isSpcTabNl(buf[i]) && isIfs(buf[i])) i++;
  const vars = names.slice(0, -1).map((n): [string, string] => {
    const f = field(i);
    i = f.next;
    return [n, text(f.cells)];
  });
  // The last variable gets its field when nothing follows it, else the rest of the line, less IFS whitespace at its end.
  const f = field(i);
  let rest = f.cells;
  if (f.next < buf.length) {
    const trailing = opts.version === '5.3' ? isSpace : isSpcTabNl;
    let e = buf.length - 1;
    // (An escaped space, tab or newline at the end goes too: bash looks back over the mark before it.)
    while (e > i && ((trailing(buf[e]) && isIfs(buf[e])) || (buf[e] === null && isSpcTabNl(buf[e + 1])))) e--;
    rest = buf.slice(i, e + 1);
  }
  vars.push([names[names.length - 1], text(rest)]);
  return { vars };
}

/** A line that shows how read splits it: one field more than there are names, joined by the first character of IFS. */
export function readSampleLine(names: number, ifs: string, array: boolean): string {
  const words = ['alice', '30', 'tokyo', 'admin', 'extra'];
  if (ifs === '') return '  hello   world  ';
  // (A newline would end the line: the next character, or a space that IFS does not split on.)
  const sep = [...ifs].find((c) => c !== '\n') ?? ' ';
  const count = array ? 3 : Math.min(names + 1, 5);
  return words.slice(0, count).join(sep);
}
