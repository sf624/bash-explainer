// A small lexer of Python for the Python host (docs/design/python-regex.md, 4.2; docs/design/sources.md, row 30): names,
// numbers, operators, comments, the ends of logical lines, and string literals with every prefix, f-strings and t-strings
// nested by the rules of Python 3.12 (PEP 701: a replacement field holds any expression, strings with the same quotes too).
// test/python-lexer.test.ts holds it against Python's own `tokenize`. It reads what the host needs, not Python's grammar:
// no INDENT or DEDENT, and an unterminated string or field is one `error` token.
import { escapeAt } from './pyvalue';

/**
 * The Python release whose rules the host follows (docs/design/python-regex.md, section 8): the tests run that release
 * (`$BASH_EXPLAINER_PYTHON`), and CI installs it. A newer release changes this constant and the CI's `python-version`.
 */
export const PYTHON_REFERENCE = '3.15';

export type PyKind = 'name' | 'number' | 'string' | 'op' | 'comment' | 'newline' | 'error';

/** A token: its kind and its source range [start, end); a string literal has `lit`. */
export interface PyToken { kind: PyKind; start: number; end: number; lit?: PyLiteral }

/** A string literal: its prefix (in lower case) and quotes, where its text is, and the replacement fields of an f-string or a t-string. */
export interface PyLiteral {
  prefix: string;
  raw: boolean;
  bytes: boolean;
  /** An f-string or a t-string: braces start fields. */
  format: boolean;
  /** A t-string: its value is a Template, not a str. */
  template: boolean;
  quote: string;
  contentStart: number;
  contentEnd: number;
  fields: PyField[];
}

/**
 * A replacement field `{…}` [start, end): the tokens of its expression, and where its `=`, `!` and `:` are. `spec` holds the
 * fields nested in the format spec (`{x:>{w}}`).
 */
export interface PyField {
  start: number;
  end: number;
  tokens: PyToken[];
  debug?: number;
  bang?: number;
  conversion?: PyToken;
  colon?: number;
  spec: PyField[];
}

/** The tokens of a file, and for each bracket its partner (-1 when it has none). */
export interface PyLexed { tokens: PyToken[]; pair: number[] }

/** Every valid prefix of a string literal, in lower case (`tokenize._all_string_prefixes()`, case folded). */
const PREFIXES = new Set(['', 'r', 'u', 'b', 'br', 'rb', 'f', 'fr', 'rf', 't', 'tr', 'rt']);

const NAME = /[\p{XID_Start}_][\p{XID_Continue}]*/uy;
const NUMBER = /0[xX](?:_?[0-9a-fA-F])+|0[bB](?:_?[01])+|0[oO](?:_?[0-7])+|(?:\d(?:_?\d)*(?:\.(?:\d(?:_?\d)*)?)?|\.\d(?:_?\d)*)(?:[eE][+-]?\d(?:_?\d)*)?[jJ]?/y;
const OPERATOR = /\*\*=|\/\/=|>>=|<<=|\.\.\.|->|:=|!=|==|<=|>=|\*\*|\/\/|<<|>>|[-+*/%@&|^]=|[-+*/%@&|^~<>()[\]{},:;.=!]/y;

const OPEN = '([{';
const CLOSE = ')]}';

/** Python's limits (its tokenizer's MAXLEVEL and MAXFSTRINGLEVEL): past them, "too many nested parentheses" and "too many nested f-strings or t-strings". */
const MAX_BRACKETS = 200;
const MAX_FORMAT_NESTING = 149;

/** A sticky regex's match at `k`, if any. */
function stuck(re: RegExp, src: string, k: number): number | undefined {
  re.lastIndex = k;
  return re.exec(src) ? re.lastIndex : undefined;
}

class Lexer {
  /** The literals read so far, by their start: each is read once, so that a literal that does not end costs no more than its text. */
  private readonly literals = new Map<number, PyToken>();
  /** The brackets (a field's `{` too) and the f-strings or t-strings open around the scan. */
  private level = 0;
  private formats = 0;

  constructor(readonly src: string) {}

  /**
   * The tokens from `k` on, until a `}` (or `!`, `:`, `=`) at the top level of a replacement field when `field` is set:
   * `end` is where it stopped. Newline tokens only at the top of the file. In a field of a literal in single quotes, a
   * newline ends the scan, in brackets too (Python allows one, but a literal being typed would then read to the end of the
   * file). A bracket past Python's limit is an error token.
   */
  tokens(k: number, field: false | 'single' | 'triple'): { tokens: PyToken[]; end: number } {
    const src = this.src;
    const out: PyToken[] = [];
    let depth = 0;
    let line = false;
    const base = this.level;
    const done = (end: number) => {
      this.level = base;
      return { tokens: out, end };
    };
    for (;;) {
      while (k < src.length && (src[k] === ' ' || src[k] === '\t' || src[k] === '\f' || src[k] === '\r' || (src[k] === '\\' && src[k + 1] === '\n'))) k += src[k] === '\\' ? 2 : 1;
      if (k >= src.length) {
        if (line && !field) out.push({ kind: 'newline', start: k, end: k });
        return done(k);
      }
      const c = src[k];
      if (c === '\n') {
        if (field === 'single') return done(k);
        if (line && depth === 0 && !field) out.push({ kind: 'newline', start: k, end: k + 1 });
        if (depth === 0) line = false;
        k++;
        continue;
      }
      if (c === '#') {
        const end = src.indexOf('\n', k);
        out.push({ kind: 'comment', start: k, end: end < 0 ? src.length : end });
        k = end < 0 ? src.length : end;
        continue;
      }
      if (field && depth === 0 && (c === '}' || c === ':' || (c === '!' && src[k + 1] !== '=') || (c === '=' && src[k + 1] !== '='))) {
        return done(k);
      }
      line = true;
      const name = stuck(NAME, src, k);
      if (name !== undefined) {
        const quote = src[name];
        if ((quote === '"' || quote === "'") && PREFIXES.has(src.slice(k, name).toLowerCase())) {
          const t = this.literal(k, name);
          out.push(t);
          k = t.end;
        } else {
          out.push({ kind: 'name', start: k, end: name });
          k = name;
        }
        continue;
      }
      if (c === '"' || c === "'") {
        const t = this.literal(k, k);
        out.push(t);
        k = t.end;
        continue;
      }
      const number = /[0-9]/.test(c) || (c === '.' && /[0-9]/.test(src[k + 1])) ? stuck(NUMBER, src, k) : undefined;
      if (number !== undefined) {
        out.push({ kind: 'number', start: k, end: number });
        k = number;
        continue;
      }
      const op = stuck(OPERATOR, src, k);
      if (op === undefined) {
        out.push({ kind: 'error', start: k, end: k + 1 });
        k++;
        continue;
      }
      if (OPEN.includes(c)) {
        if (this.level >= MAX_BRACKETS) {
          out.push({ kind: 'error', start: k, end: op });
          k = op;
          continue;
        }
        depth++;
        this.level++;
      } else if (CLOSE.includes(c) && depth > 0) {
        depth--;
        this.level--;
      }
      out.push({ kind: 'op', start: k, end: op });
      k = op;
    }
  }

  /** The string literal whose prefix starts at `at` and whose quote is at `q`: a `string` token, or `error` when it does not end. */
  literal(at: number, q: number): PyToken {
    let t = this.literals.get(at);
    if (!t) {
      t = this.read(at, q);
      this.literals.set(at, t);
    }
    return t;
  }

  /** The literal of `literal`, read. One nested in more f-strings or t-strings than Python allows is an error. */
  read(at: number, q: number): PyToken {
    const src = this.src;
    const prefix = src.slice(at, q).toLowerCase();
    const quote = src.startsWith(src[q].repeat(3), q) ? src[q].repeat(3) : src[q];
    const lit: PyLiteral = {
      prefix, raw: prefix.includes('r'), bytes: prefix.includes('b'), format: prefix.includes('f') || prefix.includes('t'), template: prefix.includes('t'),
      quote, contentStart: q + quote.length, contentEnd: -1, fields: [],
    };
    if (lit.format && this.formats >= MAX_FORMAT_NESTING) return { kind: 'error', start: at, end: this.lineEnd(lit, at) };
    if (lit.format) this.formats++;
    const end = this.content(lit, lit.contentStart, false);
    if (lit.format) this.formats--;
    if (end < 0) return { kind: 'error', start: at, end: this.lineEnd(lit, at) };
    lit.contentEnd = end;
    return { kind: 'string', start: at, end: end + quote.length, lit };
  }

  /** Where an unterminated literal's error ends: its line, or the file for a triple-quoted one. */
  lineEnd(lit: PyLiteral, at: number): number {
    const nl = this.src.indexOf('\n', at);
    return lit.quote.length === 3 || nl < 0 ? this.src.length : nl;
  }

  /**
   * The text of a literal from `k` up to its closing quote (or, in a format spec, `spec`, up to the `}` that ends the
   * field), adding the fields it finds to `into`: the offset of the quote or `}`, or -1 when the literal does not end.
   */
  content(lit: PyLiteral, k: number, spec: boolean, into: PyField[] = lit.fields): number {
    const src = this.src;
    for (; k < src.length;) {
      const c = src[k];
      if (src.startsWith(lit.quote, k)) return spec ? -1 : k;
      if (c === '\n' && lit.quote.length === 1) return -1;
      if (c === '\\') {
        // A backslash keeps a quote, a backslash or a newline after it in the literal; in an f-string, `\N{…}` is no field.
        const esc = lit.format && !lit.raw ? escapeAt(src, k, lit.bytes) : undefined;
        k = esc ? esc.end : src[k + 1] === lit.quote[0] || src[k + 1] === '\\' || src[k + 1] === '\n' ? k + 2 : k + 1;
        continue;
      }
      if (lit.format && c === '{') {
        if (!spec && src[k + 1] === '{') { k += 2; continue; }
        const field = this.field(lit, k);
        if (!field) return -1;
        into.push(field);
        k = field.end;
        continue;
      }
      if (lit.format && c === '}') {
        if (spec) return k;
        k += src[k + 1] === '}' ? 2 : 1;
        continue;
      }
      k++;
    }
    return -1;
  }

  /** The replacement field whose `{` is at `open`, if it ends. */
  field(lit: PyLiteral, open: number): PyField | undefined {
    const src = this.src;
    this.level++;
    const expr = this.tokens(open + 1, lit.quote.length === 3 ? 'triple' : 'single');
    this.level--;
    const field: PyField = { start: open, end: -1, tokens: expr.tokens, spec: [] };
    let k = expr.end;
    if (src[k] === '=') {
      field.debug = k;
      k = this.blank(k + 1);
    }
    if (src[k] === '!') {
      field.bang = k;
      const name = stuck(NAME, src, k + 1);
      if (name === undefined) return undefined;
      field.conversion = { kind: 'name', start: k + 1, end: name };
      k = this.blank(name);
    }
    if (src[k] === ':') {
      field.colon = k;
      k = this.content(lit, k + 1, true, field.spec);
      if (k < 0) return undefined;
    }
    if (src[k] !== '}') return undefined;
    field.end = k + 1;
    return field;
  }

  /** After the blanks at `k`. */
  blank(k: number): number {
    while (k < this.src.length && /[ \t\f\r\n]/.test(this.src[k])) k++;
    return k;
  }
}

/** The tokens of Python source `src`, with the partners of its brackets. */
export function pyLex(src: string): PyLexed {
  const { tokens } = new Lexer(src).tokens(0, false);
  const pair = tokens.map(() => -1);
  const open: number[] = [];
  tokens.forEach((t, i) => {
    if (t.kind !== 'op' || t.end - t.start !== 1) return;
    const c = src[t.start];
    if (OPEN.includes(c)) open.push(i);
    else if (CLOSE.includes(c) && open.length && OPEN.indexOf(src[tokens[open[open.length - 1]].start]) === CLOSE.indexOf(c)) {
      // (Only a bracket of the same kind closes one: in `(]`, neither has a partner.)
      const o = open.pop()!;
      pair[o] = i;
      pair[i] = o;
    }
  });
  return { tokens, pair };
}

/** Whether `t` is the operator `op`. */
export const isOp = (src: string, t: PyToken | undefined, op: string): boolean => t?.kind === 'op' && t.end - t.start === op.length && src.startsWith(op, t.start);

/** Whether `t` is the name `name`. */
export const isName = (src: string, t: PyToken | undefined, name: string): boolean => t?.kind === 'name' && t.end - t.start === name.length && src.startsWith(name, t.start);
