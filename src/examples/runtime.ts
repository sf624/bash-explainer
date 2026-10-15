/** Simulations of xargs, simple test conditions and `read` word splitting, for worked examples. */
import { globExamples, globMatches } from './shellwords';
import { parseOptions, Unsupported } from './textfilters';

// ---------------------------------------------------------------- xargs

const XARGS = {
  flags: '0rtpx',
  values: 'nLIdPsE',
  long: { null: '0', 'no-run-if-empty': 'r', verbose: 't', interactive: 'p', exit: 'x', 'max-args': 'n', 'max-lines': 'L', replace: 'I', delimiter: 'd', 'max-procs': 'P', 'max-chars': 's', eof: 'E' },
};

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
  // xargs options end at the first non-option word (the command).
  const firstCmd = words.findIndex((w, i) => w === undefined || (!w.startsWith('-') && !/^-[nLIdPsE]$/.test(words[i - 1] ?? '')));
  const optWords = firstCmd < 0 ? words : words.slice(0, firstCmd);
  const p = parseOptions(optWords, XARGS);
  if (p.operands.length) throw new Unsupported('unexpected operand');
  const cmd = firstCmd < 0 ? ['echo'] : words.slice(firstCmd);
  if (cmd.some((w) => w === undefined)) throw new Unsupported('non-literal command');
  const command = cmd as string[];
  const get = (c: string) => [...p.opts].reverse().find(([n]) => n === c)?.[1];
  if (get('s') !== undefined || get('E') !== undefined || p.opts.some(([n]) => n === 'p')) throw new Unsupported('xargs option');
  const replace = get('I');
  const delim = p.opts.some(([n]) => n === '0') ? '\0' : get('d')?.replace(/^\\n$/, '\n').replace(/^\\t$/, '\t');
  let items: string[];
  if (replace !== undefined) {
    // -I takes whole lines, with leading blanks removed.
    items = input.split('\n').map((l) => l.replace(/^[ \t]+/, '')).filter((l) => l !== '');
    return items.map((item) => command.map((w) => w.split(replace).join(item)));
  }
  if (delim !== undefined) {
    items = input.split(delim);
    if (items[items.length - 1] === '' || (delim !== '\n' && items[items.length - 1] === '\n')) items.pop();
    if (delim !== '\0' && items.length && items[items.length - 1].endsWith('\n') && delim !== '\n') items[items.length - 1] = items[items.length - 1].slice(0, -1);
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
  return words.map((w) => (w === '' ? "''" : /[^A-Za-z0-9_\-.,:/@%+=]/.test(w) ? `'${w.replace(/'/g, "'\\''")}'` : w)).join(' ');
}

/** Input that shows how xargs groups items, and the commands that result. */
export function xargsExample(words: (string | undefined)[]): { input: string; commands: string[] } | undefined {
  try {
    const p = parseOptions(words.slice(0, Math.max(0, words.findIndex((w, i) => w === undefined || (!w.startsWith('-') && !/^-[nLIdPsE]$/.test(words[i - 1] ?? ''))))) as string[], XARGS);
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
 * Undefined for tests whose result depends on the system (file tests) or on several conditions.
 */
export function testCases(kind: '[' | '[[' | '((', op: string, left: Operand | undefined, right: Operand | undefined, quotedRight = false): TestCase[] | undefined {
  // Unary string tests.
  if (left === undefined && right && 'var' in right) {
    const v = right.var;
    if (op === '-z') return [{ vars: { [v]: '' }, result: true }, { vars: { [v]: 'abc' }, result: false }];
    if (op === '-n') return [{ vars: { [v]: 'abc' }, result: true }, { vars: { [v]: '' }, result: false }];
    return undefined;
  }
  if (!left || !right) return undefined;
  const vars = [left, right].filter((o): o is { var: string } => 'var' in o);
  if (vars.length !== 1) return undefined;
  const v = vars[0].var;
  const litSide = 'lit' in left ? left : right;
  const lit = 'lit' in litSide ? litSide.lit : '';
  const varOnLeft = 'var' in left;
  const numeric: Record<string, (a: number, b: number) => boolean> = {
    '-eq': (a, b) => a === b, '-ne': (a, b) => a !== b, '-lt': (a, b) => a < b, '-le': (a, b) => a <= b, '-gt': (a, b) => a > b, '-ge': (a, b) => a >= b,
  };
  const arith: Record<string, string> = { '==': '-eq', '!=': '-ne', '<': '-lt', '<=': '-le', '>': '-gt', '>=': '-ge' };
  const numOp = kind === '((' ? arith[op] : numeric[op] ? op : undefined;
  if (numOp) {
    if (!/^-?\d+$/.test(lit)) return undefined;
    const n = Number(lit);
    const f = numeric[numOp];
    const candidates = [n, n + 1, n - 1, n + 10, n - 10];
    const truth = (x: number) => (varOnLeft ? f(x, n) : f(n, x));
    const t = candidates.find(truth);
    const fl = candidates.find((x) => !truth(x));
    if (t === undefined || fl === undefined) return undefined;
    return [{ vars: { [v]: String(t) }, result: true }, { vars: { [v]: String(fl) }, result: false }];
  }
  if (kind === '((') return undefined;
  if (op === '=' || op === '==' || op === '!=') {
    const neg = op === '!=';
    // In [[ ]], an unquoted right side of == / != is a glob pattern.
    if (kind === '[[' && varOnLeft && !quotedRight && /[*?[]/.test(lit)) {
      const ex = globExamples(lit, 'value');
      if (!ex?.nonMatching.length) return undefined;
      const yes = ex.matching[0];
      const no = ex.nonMatching.find((x) => !globMatches(lit, x, 'value'))!;
      return [{ vars: { [v]: neg ? no : yes }, result: true }, { vars: { [v]: neg ? yes : no }, result: false }];
    }
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

const IFS_WS = /[ \t\n]/;

/** bash's `read [-r] [-a arr] name…` splitting of one line with the given IFS. */
export function runRead(line: string, names: string[], opts: { ifs: string; raw: boolean; array?: string }): ReadResult {
  // Without -r a backslash escapes the next character (and protects it from splitting).
  const chars: { c: string; escaped: boolean }[] = [];
  for (let i = 0; i < line.length; i++) {
    if (!opts.raw && line[i] === '\\' && i + 1 < line.length) chars.push({ c: line[++i], escaped: true });
    else if (!opts.raw && line[i] === '\\') continue;
    else chars.push({ c: line[i], escaped: false });
  }
  const ifs = opts.ifs;
  const isIfs = (x: { c: string; escaped: boolean }) => !x.escaped && ifs.includes(x.c);
  const isWs = (x: { c: string; escaped: boolean }) => isIfs(x) && IFS_WS.test(x.c);
  // Leading and trailing IFS whitespace is removed.
  let s = 0;
  let e = chars.length;
  while (s < e && isWs(chars[s])) s++;
  while (e > s && isWs(chars[e - 1])) e--;
  const body = chars.slice(s, e);
  const text = (xs: typeof body) => xs.map((x) => x.c).join('');
  const fields: string[] = [];
  const starts: number[] = [];
  let i = 0;
  if (ifs === '') {
    fields.push(text(body));
    starts.push(0);
  } else {
    while (i < body.length) {
      starts.push(i);
      let j = i;
      while (j < body.length && !isIfs(body[j])) j++;
      fields.push(text(body.slice(i, j)));
      // Skip one non-whitespace delimiter (with whitespace around it) or a run of whitespace.
      let k = j;
      while (k < body.length && isWs(body[k])) k++;
      if (k < body.length && isIfs(body[k]) && !isWs(body[k])) {
        k++;
        while (k < body.length && isWs(body[k])) k++;
      }
      if (k >= body.length && j < body.length && isIfs(body[j]) && !isWs(body[j])) {
        // A trailing non-whitespace delimiter ends the last field without starting a new one.
      }
      i = k;
    }
  }
  if (opts.array) return { vars: [], array: [opts.array, fields] };
  const out: [string, string][] = [];
  names.forEach((n, k) => {
    if (k < names.length - 1) out.push([n, fields[k] ?? '']);
    else {
      // The last name gets the rest of the line, delimiters included.
      if (k >= fields.length) out.push([n, '']);
      else {
        let rest = text(body.slice(starts[k]));
        // A single trailing non-whitespace delimiter is dropped when exactly one field remains.
        if (k === fields.length - 1 && rest.length && ifs.includes(rest[rest.length - 1]) && !IFS_WS.test(rest[rest.length - 1])) rest = rest.slice(0, -1);
        out.push([n, rest]);
      }
    }
  });
  return { vars: out };
}

/** A line that shows how read splits it: one field more than there are names. */
export function readSampleLine(names: number, ifs: string, array: boolean): string {
  const words = ['alice', '30', 'tokyo', 'admin', 'extra'];
  if (ifs === '') return '  hello   world  ';
  const sep = /^[ \t\n]*$/.test(ifs) ? ' ' : [...ifs].find((c) => !IFS_WS.test(c))!;
  const count = array ? 3 : Math.min(names + 1, 5);
  return words.slice(0, count).join(sep);
}
