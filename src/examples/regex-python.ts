// A pattern of Python's `re` as JavaScript, for the worked examples (docs/design/python-regex.md, section 6). Every construct whose
// meaning differs is written out: no JavaScript `m` or `s` flag is set, since JavaScript's line ends include `\r`, U+2028 and
// U+2029 and Python's only `\n`. VERBOSE whitespace and comments are left out as Python's parser skips them (`{1, 3}` is no count),
// and named groups become numbered ones. What JavaScript cannot say, or says otherwise on the made-up ASCII texts of an example,
// is refused (undefined): atomic groups, possessive quantifiers, conditionals, `\N{…}`, a backreference to a group that may not take
// part, `re.LOCALE`, a flag not known, case folding of a character past ASCII, and a group's own `(?i:…)`.
import { FLAG_LETTERS, pythonCode, pythonFlags, type PythonRegexOptions } from '../embedded/regex-python';
import { type Node, Parser } from './regexparse';

/** A pattern in JavaScript syntax (the `JsRegex` of src/examples/regex.ts). */
interface Js { source: string; flags: string }

/** The whitespace Python's VERBOSE skips (`WHITESPACE` of its `re._parser`). */
const WHITESPACE = ' \t\n\r\v\f';

/** The flags in effect at a place of the pattern: case, `^` and `$` at lines, `.` and newlines, VERBOSE. */
interface Scope { i: boolean; m: boolean; s: boolean; x: boolean }

/**
 * The anchors and `.` of Python as JavaScript, by the flags in effect. Each is a negative lookaround, so that a made-up text
 * (`regexExamples`) gets no character from it: `$` is "no character follows but a final newline" (`(?=\n?(?![\s\S]))`), with
 * MULTILINE "no character but a newline follows".
 */
export const PY_START = '(?<![\\s\\S])';
export const PY_END = '(?![\\s\\S])';
const LINE_START = '(?<![^\\n])';
const END_OR_FINAL_NEWLINE = '(?![^\\n]|\\n[\\s\\S])';
const LINE_END = '(?![^\\n])';

/** The one-letter escapes outside a set, as JavaScript: the classes and anchors, and the characters. */
const LETTERS: Record<string, string> = {
  A: PY_START, Z: PY_END, z: PY_END, b: '\\b', B: '\\B', d: '\\d', D: '\\D', s: '\\s', S: '\\S', w: '\\w', W: '\\W',
  a: '\\x07', f: '\\f', n: '\\n', r: '\\r', t: '\\t', v: '\\v',
};
/** The same inside a set, where `\b` is a backspace: a class (`set`) or a character's code. */
const CLASS_LETTERS: Record<string, string | number> = { d: '\\d', D: '\\D', s: '\\s', S: '\\S', w: '\\w', W: '\\W', a: 7, b: 8, f: 12, n: 10, r: 13, t: 9, v: 11 };

/** A character's code as a JavaScript escape. */
const unit = (code: number): string => `\\u${code.toString(16).padStart(4, '0')}`;

/** Skips VERBOSE whitespace and `#` comments from `i`. */
function skipVerbose(src: string, i: number): number {
  for (;;) {
    if (WHITESPACE.includes(src[i] ?? 'x')) i++;
    else if (src[i] === '#') {
      while (i < src.length && src[i] !== '\n') i++;
    } else return i;
  }
}

/** The letters of the global flags that start the pattern (`(?i)(?#c)(?m)`), after VERBOSE whitespace and comments where it is on. */
function globalLetters(src: string, verbose: boolean): string {
  let letters = '';
  for (let i = 0; ;) {
    if (verbose) i = skipVerbose(src, i);
    if (src.startsWith('(?#', i)) {
      const close = src.indexOf(')', i);
      if (close < 0) return letters;
      i = close + 1;
      continue;
    }
    const m = /^\(\?([aiLmsux]+)\)/.exec(src.slice(i));
    if (!m) return letters;
    letters += m[1];
    i += m[0].length;
  }
}

/** A member of a set: a character's code, or a class of one letter (`\d`). Undefined for one Python refuses or JavaScript cannot have. */
function classMember(src: string, i: number, bytes: boolean): { code?: number; set?: string; length: number } | undefined {
  if (src[i] !== '\\') return { code: src.charCodeAt(i), length: 1 };
  const code = pythonCode(src, i, true, bytes);
  if (code) return code.code === undefined || code.error ? undefined : { code: code.code, length: code.length };
  const c = src[i + 1];
  if (c === undefined) return undefined;
  const letter = CLASS_LETTERS[c];
  if (letter !== undefined) return typeof letter === 'number' ? { code: letter, length: 2 } : { set: letter, length: 2 };
  return /[A-Za-z0-9]/.test(c) ? undefined : { code: c.charCodeAt(0), length: 2 };
}

/**
 * The set that opens at `at` as a JavaScript class, and where it ends, as `_parse` reads it: `]` first is a member, a `[` is one
 * too (`[[:alpha:]]` is the set `[:alph` and a `]` after it), and `-` before `]` or first is itself. Every member is written by its code.
 */
function pythonClass(src: string, at: number, bytes: boolean, wide: (code: number) => void): [string, number] | undefined {
  let i = at + 1;
  let out = '[';
  if (src[i] === '^') { out += '^'; i++; }
  for (let first = true; ; first = false) {
    if (i >= src.length) return undefined;
    if (src[i] === ']' && !first) return [out + ']', i + 1];
    const a = classMember(src, i, bytes);
    if (!a) return undefined;
    i += a.length;
    if (src[i] === '-' && src[i + 1] !== ']' && i + 1 < src.length) {
      const b = classMember(src, i + 1, bytes);
      if (!b || a.code === undefined || b.code === undefined || b.code < a.code) return undefined;
      wide(b.code);
      out += `${unit(a.code)}-${unit(b.code)}`;
      i += 1 + b.length;
      continue;
    }
    if (a.code !== undefined) wide(a.code);
    out += a.set ?? unit(a.code!);
  }
}

/**
 * The pattern `src` of Python's `re`, compiled with the flags `py`, as a JavaScript pattern that matches the same texts of ASCII
 * without `\r` (docs/design/python-regex.md, section 6), or undefined. JavaScript checks its syntax afterwards (`toJsRegex`).
 */
export function pythonToJs(src: string, py: PythonRegexOptions): Js | undefined {
  const flags = [py.ascii, py.ignorecase, py.multiline, py.dotall, py.verbose, py.locale];
  // (A flag not known changes what the pattern means; the locale is the machine's. A character past U+FFFF is two in JavaScript.)
  if (flags.includes('unknown') || py.locale || /[\ud800-\udfff]/.test(src)) return undefined;
  let letters = globalLetters(src, py.verbose === true);
  // (Python reads the whole pattern again with VERBOSE when `(?x)` turns it on, so whitespace before the flags is skipped too.)
  if (!py.verbose && letters.includes('x')) letters = globalLetters(src, true);
  if (letters.includes('L')) return undefined;
  const on = (f: boolean | 'unknown', l: string) => f === true || letters.includes(l);
  const top: Scope = { i: on(py.ignorecase, 'i'), m: on(py.multiline, 'm'), s: on(py.dotall, 's'), x: on(py.verbose, 'x') };
  const scopes: Scope[] = [top];
  const names = new Map<string, number>();
  let groups = 0;
  let pastAscii = false;
  const wide = (code: number) => { pastAscii ||= code > 0x7f; };
  let out = '';
  // (Whether what was read last can be repeated: not an anchor, nor a repeat; Python says "nothing to repeat" or "multiple repeat".)
  let repeatable = false;
  const quantified = (i: number): number | undefined => {
    // (A lazy `?` follows at once; a possessive `+` (3.11) has no JavaScript counterpart.)
    if (!repeatable || src[i] === '+') return undefined;
    repeatable = false;
    if (src[i] === '?') { out += '?'; return i + 1; }
    return i;
  };
  for (let i = 0; i < src.length;) {
    const sc = scopes[scopes.length - 1];
    const c = src[i];
    if (sc.x && (WHITESPACE.includes(c) || c === '#')) {
      i = skipVerbose(src, i);
      continue;
    }
    if (c === '(') {
      const rest = src.slice(i + 1);
      const named = /^\?P<(\w+)>/.exec(rest);
      const ref = /^\?P=(\w+)\)/.exec(rest);
      const plain = /^\?(?::|=|!|<=|<!)/.exec(rest);
      if (rest.startsWith('?#')) {
        const close = src.indexOf(')', i);
        if (close < 0) return undefined;
        i = close + 1;
      } else if (named) {
        names.set(named[1], ++groups);
        scopes.push(sc);
        repeatable = false;
        out += '(';
        i += 1 + named[0].length;
      } else if (ref) {
        const n = names.get(ref[1]);
        if (n === undefined) return undefined;
        out += `(?:\\${n})`;
        repeatable = true;
        i += 1 + ref[0].length;
      } else if (plain) {
        scopes.push(sc);
        repeatable = false;
        out += `(${plain[0]}`;
        i += 1 + plain[0].length;
      } else if (rest[0] === '?' && (FLAG_LETTERS.has(rest[1]) || rest[1] === '-')) {
        const read = pythonFlags(src, i, py.bytes);
        if ('error' in read) return undefined;
        i = read.end;
        // (Global flags are at the start, read above.)
        if (!read.scoped) continue;
        const has = (l: string, was: boolean) => (read.on.includes(l) ? true : read.off.includes(l) ? false : was);
        const inner: Scope = { i: has('i', sc.i), m: has('m', sc.m), s: has('s', sc.s), x: has('x', sc.x) };
        // (JavaScript has one case flag for the whole pattern; `L` is the locale's.)
        if (inner.i !== sc.i || read.on.includes('L')) return undefined;
        scopes.push(inner);
        repeatable = false;
        out += '(?:';
      } else if (rest[0] === '?') {
        // (Atomic groups, conditionals, and what Python refuses.)
        return undefined;
      } else {
        groups++;
        scopes.push(sc);
        repeatable = false;
        out += '(';
        i++;
      }
      continue;
    }
    if (c === ')') {
      if (scopes.length === 1) return undefined;
      scopes.pop();
      repeatable = true;
      out += ')';
      i++;
      continue;
    }
    if (c === '[') {
      const cls = pythonClass(src, i, py.bytes, wide);
      if (!cls) return undefined;
      out += cls[0];
      repeatable = true;
      i = cls[1];
      continue;
    }
    if (c === '*' || c === '+' || c === '?') {
      out += c;
      const next = quantified(i + 1);
      if (next === undefined) return undefined;
      i = next;
      continue;
    }
    if (c === '{') {
      // (A count is read from the text as it is: `{1, 3}` in VERBOSE is the text "{1,3}"; `{}` is too, and `{,}` is `*`.)
      const m = src[i + 1] === '}' ? undefined : /^\{(\d*)(?:(,)(\d*))?\}/.exec(src.slice(i));
      if (!m) {
        out += '\\{';
        repeatable = true;
        i++;
        continue;
      }
      out += `{${m[1] || '0'}${m[2] ? `,${m[3]}` : ''}}`;
      const next = quantified(i + m[0].length);
      if (next === undefined) return undefined;
      i = next;
      continue;
    }
    // (What follows can be repeated but an anchor and `|`.)
    repeatable = !'^$|'.includes(c);
    if (c === '.') out += sc.s ? '[\\s\\S]' : '[^\\n]';
    else if (c === '^') out += sc.m ? LINE_START : PY_START;
    else if (c === '$') out += sc.m ? LINE_END : END_OR_FINAL_NEWLINE;
    else if (c === '|') out += '|';
    else if (c === '\\') {
      const code = pythonCode(src, i, false, py.bytes);
      if (code) {
        // (`\N{…}`: no table of Unicode's names.)
        if (code.code === undefined || code.error) return undefined;
        wide(code.code);
        out += unit(code.code);
        i += code.length;
        continue;
      }
      const n = src[i + 1];
      if (n === undefined) return undefined;
      const group = /^[1-9]\d?/.exec(src.slice(i + 1));
      if (group) {
        if (Number(group[0]) > groups) return undefined;
        out += `(?:\\${group[0]})`;
        i += 1 + group[0].length;
        continue;
      }
      if (/[A-Za-z0-9]/.test(n)) {
        if (!(n in LETTERS)) return undefined;
        repeatable = !'AZzbB'.includes(n);
        out += LETTERS[n];
      } else {
        wide(n.charCodeAt(0));
        out += unit(n.charCodeAt(0));
      }
      i += 2;
      continue;
    } else {
      wide(c.charCodeAt(0));
      out += /[A-Za-z0-9_ ]/.test(c) ? c : /[!-~]/.test(c) ? `\\${c}` : unit(c.charCodeAt(0));
    }
    i++;
  }
  if (scopes.length !== 1) return undefined;
  // (Python folds the case of a character past ASCII by Unicode's rules, which JavaScript's `i` does not follow: `K` and KELVIN SIGN.)
  if (top.i && pastAscii) return undefined;
  return trustedGroups(out) ? { source: out, flags: top.i ? 'i' : '' } : undefined;
}

/** Whether a node can match an empty string. */
function nullable(n: Node): boolean {
  switch (n.t) {
    case 'char': case 'set': return false;
    case 'seq': return n.items.every(nullable);
    case 'alt': return n.options.some(nullable);
    case 'repeat': return n.min === 0 || nullable(n.node);
    case 'group': return n.look !== undefined || nullable(n.node);
    default: return true;
  }
}

/**
 * Whether every backreference names a group sure to have taken part: JavaScript matches a reference to a group that did not as an
 * empty string, where Python fails. A group is sure where nothing on the way to it is a choice, an optional repeat or a lookaround.
 */
function trustedGroups(source: string): boolean {
  const facts = groupFacts(source);
  return facts.refs.every((n) => facts.sure.has(n));
}

/**
 * What the capture groups of a JavaScript pattern are: those sure to take part in a match, those whose text is that of Python
 * (`agree`), the groups backreferences name, and how many groups there are. JavaScript clears a repeated group's captures at each
 * repetition, and fails a repetition that matches nothing, where Python keeps the last: a group under a repeat of more than once
 * agrees only where it is sure in each repetition, and the repetition cannot be empty.
 */
export function groupFacts(source: string): { count: number; sure: Set<number>; agree: boolean; refs: number[] } {
  const p = new Parser(source);
  const tree = p.alt();
  const sure = new Set<number>();
  const refs: number[] = [];
  let agree = true;
  let count = 0;
  const walk = (n: Node, certain: boolean, repeated: 'no' | 'sure' | 'unsure') => {
    switch (n.t) {
      case 'seq': n.items.forEach((x) => walk(x, certain, repeated)); return;
      case 'alt': n.options.forEach((x) => walk(x, false, repeated === 'no' ? 'no' : 'unsure')); return;
      case 'repeat': {
        const many = n.max > 1;
        // (Once unsure, a group stays so in a repeat inside: an outer repetition clears it too.)
        const inner = many && repeated !== 'unsure' ? (nullable(n.node) ? 'unsure' : 'sure') : repeated === 'sure' && n.min === 0 ? 'unsure' : repeated;
        walk(n.node, certain && n.min > 0, inner);
        return;
      }
      case 'group':
        if (n.no) {
          count = Math.max(count, n.no);
          if (certain && !n.look) sure.add(n.no);
          if (repeated === 'unsure') agree = false;
        }
        walk(n.node, certain && !n.look, n.look && repeated !== 'no' ? 'unsure' : repeated);
        return;
      case 'backref': refs.push(n.n); return;
      default: return;
    }
  };
  walk(tree, true, 'no');
  return { count, sure, agree, refs };
}
