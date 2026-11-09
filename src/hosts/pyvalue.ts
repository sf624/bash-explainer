// The value of a Python string literal (docs/design/python-regex.md, 4.2; docs/design/sources.md, row 30): its characters, the
// source range of each and how it is written, its holes and its joined lines, over one table of Python's escapes. The lexer
// (src/hosts/pylex.ts) reads the same table to know where an escape ends, and the writers of src/hosts/python.ts read the
// value of an argument (`argValue`).
import { pushAll } from '../lists';
import type { PyField, PyLiteral, PyToken } from './pylex';

/** The escapes of one character after a backslash (Python's "String and Bytes literals", in str and bytes literals alike). */
const SIMPLE: Readonly<Record<string, string>> = { '\\': '\\', "'": "'", '"': '"', a: '\x07', b: '\b', f: '\f', n: '\n', r: '\r', t: '\t', v: '\v' };

/** The hex digits that `\x`, `\u` and `\U` take, in str literals for the last two. */
const HEX: Readonly<Record<string, number>> = { x: 2, u: 4, U: 8 };

const isOctal = (c: string | undefined) => c !== undefined && c >= '0' && c <= '7';
const isHex = (c: string | undefined) => c !== undefined && /^[0-9a-fA-F]$/.test(c);

/**
 * What the backslash at `k` of a literal that is not raw stands for: `end` is the offset after the escape, and `char` its
 * character; none for a backslash-newline, which joins the lines, and `name` for `\N{…}`, whose character we do not know
 * (no Unicode name table). Undefined when the backslash is not an escape: it stays in the value, as the next character does.
 */
export function escapeAt(src: string, k: number, bytes: boolean): { end: number; char?: string; name?: true } | undefined {
  const e = src[k + 1];
  if (e === '\n') return { end: k + 2 };
  if (e in SIMPLE) return { char: SIMPLE[e], end: k + 2 };
  if (isOctal(e)) {
    let end = k + 1;
    while (end < k + 4 && isOctal(src[end])) end++;
    const code = parseInt(src.slice(k + 1, end), 8);
    // (Above \377 a SyntaxWarning; in bytes the value keeps the low byte.)
    return { char: String.fromCodePoint(bytes ? code & 0xff : code), end };
  }
  const digits = HEX[e];
  if (digits && (e === 'x' || !bytes)) {
    const hex = src.slice(k + 2, k + 2 + digits);
    if (hex.length < digits || ![...hex].every(isHex)) return undefined;
    const code = parseInt(hex, 16);
    return code > 0x10ffff ? undefined : { char: String.fromCodePoint(code), end: k + 2 + digits };
  }
  if (e === 'N' && !bytes && src[k + 2] === '{') {
    // (The name ends at a `}` of the same line.)
    let close = k + 3;
    while (close < src.length && src[close] !== '}' && src[close] !== '\n') close++;
    if (src[close] === '}' && close > k + 3) return { end: close + 1, name: true };
  }
  return undefined;
}

/** A part of a literal's value that is not known from its text: a replacement field of an f-string, or a `\N{…}` escape (with its name). */
export type PyHole = { /** The index in the value where it stands. */ at: number; start: number; end: number } & ({ kind: 'field'; field: PyField } | { kind: 'name'; name: string });

/**
 * How a character of a value is written: as itself, by an escape (`\n`, `\x41`, `{{`), or as the text of a
 * self-documenting field (`{x=}` gives `x=` before the field's value, from the source inside the braces).
 */
export type PyCharKind = 'text' | 'escape' | 'debug';

/**
 * The value of a string literal: each character with its source range [offs[i], ends[i]) and how it is written, the holes
 * between the characters, and the offsets of the backslash-newlines, which give no character (they join the lines).
 */
export interface PyValue { value: string; offs: number[]; ends: number[]; kinds: PyCharKind[]; holes: PyHole[]; joins: number[] }

/**
 * The value of the literal `lit` of `src`. Escapes are undone unless it is raw; in an f-string or a t-string, `{{` and `}}`
 * are one brace, a replacement field is a hole, and a self-documenting field (`{x=}`) adds its text before the hole, as
 * Python does.
 */
export function pyValue(src: string, lit: PyLiteral): PyValue {
  const out: PyValue = { value: '', offs: [], ends: [], kinds: [], holes: [], joins: [] };
  const push = (s: string, from: number, to: number, kind: PyCharKind) => {
    // (A character outside the BMP is two code units, each with the range of the whole.)
    for (const unit of s.split('')) {
      out.value += unit;
      out.offs.push(from);
      out.ends.push(to);
      out.kinds.push(kind);
    }
  };
  let f = 0;
  for (let k = lit.contentStart; k < lit.contentEnd;) {
    const field = lit.fields[f];
    if (field && field.start === k) {
      if (field.debug !== undefined) {
        // `{x = }` shows `x = ` before its value: the text up to the conversion, the spec or the end.
        const to = field.bang ?? field.colon ?? field.end - 1;
        for (let c = field.start + 1; c < to; c++) push(src[c], c, c + 1, 'debug');
      }
      out.holes.push({ at: out.value.length, start: field.start, end: field.end, kind: 'field', field });
      f++;
      k = field.end;
      continue;
    }
    const c = src[k];
    if (lit.format && (c === '{' || c === '}') && src[k + 1] === c) {
      push(c, k, k + 2, 'escape');
      k += 2;
      continue;
    }
    const esc = c === '\\' && !lit.raw ? escapeAt(src, k, lit.bytes) : undefined;
    if (esc) {
      if (esc.name) out.holes.push({ at: out.value.length, start: k, end: esc.end, kind: 'name', name: src.slice(k + 3, esc.end - 1) });
      else if (esc.char !== undefined) push(esc.char, k, esc.end, 'escape');
      else out.joins.push(k);
      k = esc.end;
      continue;
    }
    push(c, k, k + 1, 'text');
    k++;
  }
  return out;
}

/** An argument that starts with string literals, those joined as Python joins adjacent literals. */
export interface PyArg extends PyValue {
  /** The literals, each with the index of the value where it starts. */
  literals: { token: PyToken; at: number }[];
  /** The tokens after the literals (`"…" + x`, `"…".format(…)`): none when the argument is the literals alone. */
  rest: PyToken[];
}

/**
 * The value of the argument `part` (its tokens, comments left out) when it starts with a str or bytes literal or an
 * f-string (not a t-string, whose value is no str): the literals that follow each other are one value (`"a" "b"`, over
 * several lines too).
 */
export function argValue(src: string, part: readonly PyToken[]): PyArg | undefined {
  const out: PyArg = { value: '', offs: [], ends: [], kinds: [], holes: [], joins: [], literals: [], rest: [] };
  let n = 0;
  for (; n < part.length; n++) {
    const lit = part[n].lit;
    if (!lit || lit.template) break;
    const v = pyValue(src, lit);
    const at = out.value.length;
    out.literals.push({ token: part[n], at });
    out.value += v.value;
    pushAll(out.offs, v.offs);
    pushAll(out.ends, v.ends);
    pushAll(out.kinds, v.kinds);
    pushAll(out.holes, v.holes.map((h) => ({ ...h, at: h.at + at })));
    pushAll(out.joins, v.joins);
  }
  if (!n) return undefined;
  out.rest = part.slice(n);
  return out;
}
