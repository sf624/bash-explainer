import { lex, Lex } from '../embedded/awk';
import { JsRegex, regexExamples, toJsRegex } from './regex';
import { Unsupported as RunnerUnsupported } from './unsupported';
import { parseWords } from './textfilters';
import { has } from '../argv/query';

/** Raised for awk features the example runner does not implement; no example is shown then. */
class Unsupported extends RunnerUnsupported {}

// ---------------------------------------------------------------- AST

type Expr =
  | { k: 'num'; v: number }
  | { k: 'str'; v: string }
  | { k: 're'; re: JsRegex }
  | { k: 'var'; name: string }
  | { k: 'idx'; name: string; subs: Expr[] }
  | { k: 'field'; e: Expr }
  | { k: 'call'; name: string; args: Expr[] }
  | { k: 'unary'; op: string; e: Expr }
  | { k: 'bin'; op: string; l: Expr; r: Expr }
  | { k: 'cond'; c: Expr; a: Expr; b: Expr }
  | { k: 'assign'; op: string; target: Expr; e: Expr }
  | { k: 'incr'; op: string; prefix: boolean; target: Expr }
  | { k: 'in'; subs: Expr[]; name: string }
  | { k: 'group'; list: Expr[] };

type Stmt =
  | { k: 'block'; body: Stmt[] }
  | { k: 'expr'; e: Expr }
  | { k: 'print'; args: Expr[]; printf: boolean }
  | { k: 'if'; c: Expr; t: Stmt; f?: Stmt }
  | { k: 'while'; c: Expr; body: Stmt }
  | { k: 'do'; body: Stmt; c: Expr }
  | { k: 'for'; init?: Stmt; c?: Expr; inc?: Stmt; body: Stmt }
  | { k: 'forin'; v: string; arr: string; body: Stmt }
  | { k: 'next' } | { k: 'exit'; e?: Expr } | { k: 'break' } | { k: 'continue' }
  | { k: 'return'; e?: Expr }
  | { k: 'delete'; name: string; subs?: Expr[] };

interface Rule {
  begin?: boolean;
  end?: boolean;
  pattern?: Expr;
  pattern2?: Expr;
  action?: Stmt;
  active?: boolean;
}

interface Program {
  rules: Rule[];
  funcs: Map<string, { params: string[]; body: Stmt }>;
}

const BUILTINS = new Set(['length', 'substr', 'index', 'split', 'sub', 'gsub', 'match', 'sprintf', 'tolower', 'toupper', 'int', 'sqrt', 'exp', 'log', 'sin', 'cos', 'atan2']);
const UNSUPPORTED_FUNCS = new Set(['rand', 'srand', 'system', 'close', 'fflush', 'strftime', 'systime', 'gensub', 'asort', 'asorti', 'mktime']);

// ---------------------------------------------------------------- parser

class Parser {
  private p = 0;

  constructor(private toks: Lex[]) {}

  private peek(off = 0): Lex | undefined {
    return this.toks[this.p + off];
  }

  private is(text: string, off = 0): boolean {
    const t = this.peek(off);
    return !!t && t.type !== 'str' && t.type !== 'regex' && t.text === text;
  }

  private next(): Lex {
    const t = this.toks[this.p++];
    if (!t) throw new Unsupported('unexpected end');
    return t;
  }

  private expect(text: string): void {
    if (!this.is(text)) throw new Unsupported(`expected ${text}`);
    this.p++;
  }

  private skipNl(): void {
    while (this.peek()?.type === 'nl') this.p++;
  }

  private skipTerminators(): void {
    while (this.peek()?.type === 'nl' || this.is(';')) this.p++;
  }

  program(): Program {
    const prog: Program = { rules: [], funcs: new Map() };
    for (;;) {
      this.skipTerminators();
      const t = this.peek();
      if (!t) return prog;
      if (t.text === 'function' || t.text === 'func') {
        this.p++;
        const name = this.next().text;
        this.expect('(');
        const params: string[] = [];
        while (!this.is(')')) {
          params.push(this.next().text);
          if (this.is(',')) this.p++;
          this.skipNl();
        }
        this.p++;
        this.skipNl();
        prog.funcs.set(name, { params, body: this.block() });
        continue;
      }
      const rule: Rule = {};
      if (t.text === 'BEGIN' || t.text === 'END') {
        this.p++;
        rule[t.text === 'BEGIN' ? 'begin' : 'end'] = true;
      } else if (t.text === 'BEGINFILE' || t.text === 'ENDFILE') {
        throw new Unsupported('BEGINFILE');
      } else if (!this.is('{')) {
        rule.pattern = this.expr();
        if (this.is(',')) {
          this.p++;
          this.skipNl();
          rule.pattern2 = this.expr();
        }
      }
      if (this.is('{')) rule.action = this.block();
      else if (rule.begin || rule.end) throw new Unsupported('BEGIN without action');
      prog.rules.push(rule);
    }
  }

  private block(): Stmt {
    this.expect('{');
    const body: Stmt[] = [];
    for (;;) {
      this.skipTerminators();
      if (this.is('}')) {
        this.p++;
        return { k: 'block', body };
      }
      body.push(this.statement());
    }
  }

  /** A statement followed by its terminator (`;`, newline, or the closing brace). */
  private statement(): Stmt {
    const t = this.peek();
    if (!t) throw new Unsupported('eof');
    if (this.is('{')) return this.block();
    if (t.type === 'kw') {
      switch (t.text) {
        case 'if': {
          this.p++;
          this.expect('(');
          const c = this.expr();
          this.expect(')');
          this.skipNl();
          const then = this.statement();
          const save = this.p;
          this.skipTerminators();
          if (this.is('else')) {
            this.p++;
            this.skipNl();
            return { k: 'if', c, t: then, f: this.statement() };
          }
          this.p = save;
          return { k: 'if', c, t: then };
        }
        case 'while': {
          this.p++;
          this.expect('(');
          const c = this.expr();
          this.expect(')');
          if (this.is(';')) { this.p++; return { k: 'while', c, body: { k: 'block', body: [] } }; }
          this.skipNl();
          return { k: 'while', c, body: this.statement() };
        }
        case 'do': {
          this.p++;
          this.skipNl();
          const body = this.statement();
          this.skipTerminators();
          this.expect('while');
          this.expect('(');
          const c = this.expr();
          this.expect(')');
          this.end();
          return { k: 'do', body, c };
        }
        case 'for': {
          this.p++;
          this.expect('(');
          if (this.peek()?.type === 'ident' && this.is('in', 1) && this.peek(2)?.type === 'ident' && this.is(')', 3)) {
            const v = this.next().text;
            this.p++;
            const arr = this.next().text;
            this.p++;
            this.skipNl();
            return { k: 'forin', v, arr, body: this.statement() };
          }
          const init = this.is(';') ? undefined : { k: 'expr' as const, e: this.expr() };
          this.expect(';');
          this.skipNl();
          const c = this.is(';') ? undefined : this.expr();
          this.expect(';');
          this.skipNl();
          const inc = this.is(')') ? undefined : { k: 'expr' as const, e: this.expr() };
          this.expect(')');
          if (this.is(';')) { this.p++; return { k: 'for', init, c, inc, body: { k: 'block', body: [] } }; }
          this.skipNl();
          return { k: 'for', init, c, inc, body: this.statement() };
        }
        case 'print':
        case 'printf': {
          this.p++;
          const args: Expr[] = [];
          if (!this.atEnd()) {
            args.push(this.expr(true));
            while (this.is(',')) {
              this.p++;
              this.skipNl();
              args.push(this.expr(true));
            }
          }
          if (this.is('>') || this.is('>>') || this.is('|') || this.is('|&')) throw new Unsupported('output redirection');
          // `print (a, b)` is a parenthesised argument list.
          const flat = args.length === 1 && args[0].k === 'group' ? args[0].list : args;
          this.end();
          return { k: 'print', args: flat, printf: t.text === 'printf' };
        }
        case 'next': this.p++; this.end(); return { k: 'next' };
        case 'nextfile': throw new Unsupported('nextfile');
        case 'break': this.p++; this.end(); return { k: 'break' };
        case 'continue': this.p++; this.end(); return { k: 'continue' };
        case 'exit': {
          this.p++;
          const e = this.atEnd() ? undefined : this.expr();
          this.end();
          return { k: 'exit', e };
        }
        case 'return': {
          this.p++;
          const e = this.atEnd() ? undefined : this.expr();
          this.end();
          return { k: 'return', e };
        }
        case 'delete': {
          this.p++;
          const name = this.next().text;
          let subs: Expr[] | undefined;
          if (this.is('[')) {
            this.p++;
            subs = this.exprList(']');
          }
          this.end();
          return { k: 'delete', name, subs };
        }
        case 'getline': throw new Unsupported('getline');
      }
    }
    const e = this.expr();
    this.end();
    return { k: 'expr', e };
  }

  private atEnd(): boolean {
    const t = this.peek();
    return !t || t.type === 'nl' || this.is(';') || this.is('}') || this.is('>') || this.is('>>') || this.is('|');
  }

  private end(): void {
    if (this.peek()?.type === 'nl' || this.is(';')) this.p++;
    else if (!this.is('}') && this.peek()) throw new Unsupported('expected end of statement');
  }

  private exprList(close: string): Expr[] {
    const list = [this.expr()];
    while (this.is(',')) {
      this.p++;
      list.push(this.expr());
    }
    this.expect(close);
    return list;
  }

  // ---------------------------------------------------------------- expressions (lowest to highest)

  /** `noGt`: inside print arguments, a bare `>` is output redirection, not a comparison. */
  expr(noGt = false): Expr {
    const left = this.ternary(noGt);
    const t = this.peek();
    if (t?.type === 'op' && ['=', '+=', '-=', '*=', '/=', '%=', '^='].includes(t.text) && isLvalue(left)) {
      this.p++;
      this.skipNl();
      return { k: 'assign', op: t.text, target: left, e: this.expr(noGt) };
    }
    return left;
  }

  private ternary(noGt: boolean): Expr {
    const c = this.or(noGt);
    if (!this.is('?')) return c;
    this.p++;
    this.skipNl();
    const a = this.expr(noGt);
    this.skipNl();
    this.expect(':');
    this.skipNl();
    return { k: 'cond', c, a, b: this.expr(noGt) };
  }

  private or(noGt: boolean): Expr {
    let l = this.and(noGt);
    while (this.is('||')) {
      this.p++;
      this.skipNl();
      l = { k: 'bin', op: '||', l, r: this.and(noGt) };
    }
    return l;
  }

  private and(noGt: boolean): Expr {
    let l = this.inExpr(noGt);
    while (this.is('&&')) {
      this.p++;
      this.skipNl();
      l = { k: 'bin', op: '&&', l, r: this.inExpr(noGt) };
    }
    return l;
  }

  private inExpr(noGt: boolean): Expr {
    let l = this.match(noGt);
    while (this.is('in')) {
      this.p++;
      const name = this.next().text;
      l = { k: 'in', subs: l.k === 'group' ? l.list : [l], name };
    }
    return l;
  }

  private match(noGt: boolean): Expr {
    let l = this.rel(noGt);
    while (this.is('~') || this.is('!~')) {
      const op = this.next().text;
      l = { k: 'bin', op, l, r: this.rel(noGt) };
    }
    return l;
  }

  private rel(noGt: boolean): Expr {
    const l = this.concat();
    const t = this.peek();
    if (t?.type === 'op' && ['<', '<=', '>=', '==', '!='].includes(t.text) || (t?.text === '>' && t.type === 'op' && !noGt)) {
      this.p++;
      return { k: 'bin', op: t!.text, l, r: this.concat() };
    }
    return l;
  }

  private concat(): Expr {
    let l = this.additive();
    for (;;) {
      const t = this.peek();
      // Juxtaposition concatenates; a leading - or ! would be read as subtraction or negation instead.
      const starts = t && (t.type === 'num' || t.type === 'str' || t.type === 'ident' || (t.type === 'op' && (t.text === '$' || t.text === '(')));
      if (!starts) return l;
      l = { k: 'bin', op: 'concat', l, r: this.additive() };
    }
  }

  private additive(): Expr {
    let l = this.mul();
    while ((this.is('+') || this.is('-'))) {
      const op = this.next().text;
      l = { k: 'bin', op, l, r: this.mul() };
    }
    return l;
  }

  private mul(): Expr {
    let l = this.unary();
    while (this.is('*') || this.is('/') || this.is('%')) {
      const op = this.next().text;
      l = { k: 'bin', op, l, r: this.unary() };
    }
    return l;
  }

  private unary(): Expr {
    if (this.is('!') || this.is('-') || this.is('+')) {
      const op = this.next().text;
      return { k: 'unary', op, e: this.unary() };
    }
    return this.power();
  }

  private power(): Expr {
    const base = this.postfix();
    if (!this.is('^')) return base;
    this.p++;
    // Right-associative, and the exponent may be negated: 2^-1.
    const exp = this.is('-') || this.is('+') || this.is('!') ? this.unary() : this.power();
    return { k: 'bin', op: '^', l: base, r: exp };
  }

  private postfix(): Expr {
    if (this.is('++') || this.is('--')) {
      const op = this.next().text;
      const target = this.primary();
      if (!isLvalue(target)) throw new Unsupported('bad ++');
      return { k: 'incr', op, prefix: true, target };
    }
    const e = this.primary();
    if ((this.is('++') || this.is('--')) && isLvalue(e)) {
      const op = this.next().text;
      return { k: 'incr', op, prefix: false, target: e };
    }
    return e;
  }

  private primary(): Expr {
    const t = this.next();
    switch (t.type) {
      case 'num': return { k: 'num', v: Number(t.text) };
      case 'str': return { k: 'str', v: unescapeAwk(t.text.slice(1, -1)) };
      case 'regex': {
        const re = toJsRegex(t.text.slice(1, -1).replace(/\\\//g, '/'), 'ere', { sedEscapes: true });
        if (!re) throw new Unsupported('regex');
        return { k: 're', re };
      }
      case 'ident': {
        const name = t.text;
        if (this.is('(') && this.peek()!.start === t.end) {
          this.p++;
          const args = this.is(')') ? (this.p++, []) : this.exprList(')');
          if (UNSUPPORTED_FUNCS.has(name)) throw new Unsupported(name);
          return { k: 'call', name, args };
        }
        if (name === 'length') return { k: 'call', name, args: [] };
        if (this.is('[')) {
          this.p++;
          return { k: 'idx', name, subs: this.exprList(']') };
        }
        return { k: 'var', name };
      }
      case 'kw':
        if (t.text === 'getline') throw new Unsupported('getline');
        throw new Unsupported(`unexpected ${t.text}`);
      case 'op':
        if (t.text === '$') {
          // `$NF-1` is ($NF)-1 and `$i++` is ($i)++: the operand binds tightly.
          if (this.is('++') || this.is('--')) throw new Unsupported('$++');
          if (this.is('-')) { this.p++; return { k: 'field', e: { k: 'unary', op: '-', e: this.primary() } }; }
          return { k: 'field', e: this.primary() };
        }
        if (t.text === '(') {
          const first = this.expr();
          if (this.is(',')) {
            const list = [first];
            while (this.is(',')) {
              this.p++;
              list.push(this.expr());
            }
            this.expect(')');
            return { k: 'group', list };
          }
          this.expect(')');
          return first;
        }
        if (t.text === '-' || t.text === '!' || t.text === '+') return { k: 'unary', op: t.text, e: this.unary() };
    }
    throw new Unsupported(`unexpected ${t.text}`);
  }
}

function isLvalue(e: Expr): boolean {
  return e.k === 'var' || e.k === 'idx' || e.k === 'field';
}

function unescapeAwk(s: string): string {
  return s.replace(/\\([nt"\\/rab]|[0-7]{1,3})/g, (_, c: string) => {
    if (/^[0-7]/.test(c)) return String.fromCharCode(parseInt(c, 8));
    return ({ n: '\n', t: '\t', '"': '"', '\\': '\\', '/': '/', r: '\r', a: '\x07', b: '\b' } as Record<string, string>)[c];
  });
}

// ---------------------------------------------------------------- values

/** A string that came from input (a field, split result…): compared as a number if it looks like one. */
class StrNum {
  constructor(readonly s: string) {}
}

type Val = number | string | StrNum | undefined;

const NUMERIC = /^\s*[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?\s*$/;

function toNum(v: Val): number {
  if (typeof v === 'number') return v;
  const s = v === undefined ? '' : typeof v === 'string' ? v : v.s;
  const m = /^\s*[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?/.exec(s);
  return m ? Number(m[0]) : 0;
}

function fmtNumber(n: number, fmt = '%.6g'): string {
  if (Number.isInteger(n) && Math.abs(n) < 1e16) return String(n === 0 ? 0 : n);
  return sprintf(fmt, [n]);
}

function toStr(v: Val): string {
  if (v === undefined) return '';
  if (typeof v === 'number') return fmtNumber(v);
  return typeof v === 'string' ? v : v.s;
}

function looksNumeric(v: Val): boolean {
  return v === undefined || typeof v === 'number' || (v instanceof StrNum && NUMERIC.test(v.s));
}

function truthy(v: Val): boolean {
  if (v === undefined) return false;
  if (typeof v === 'number') return v !== 0;
  if (typeof v === 'string') return v !== '';
  return NUMERIC.test(v.s) ? toNum(v) !== 0 : v.s !== '';
}

function compare(a: Val, b: Val): number {
  if (looksNumeric(a) && looksNumeric(b)) {
    const x = toNum(a);
    const y = toNum(b);
    return x < y ? -1 : x > y ? 1 : 0;
  }
  const x = toStr(a);
  const y = toStr(b);
  return x < y ? -1 : x > y ? 1 : 0;
}

/** C-style printf formatting for %d %i %o %x %X %u %c %s %e %E %f %F %g %G %%. */
export function sprintf(fmt: string, args: Val[]): string {
  let ai = 0;
  // gawk stops with a fatal error when the format wants more arguments than it got.
  const nextArg = () => {
    if (ai >= args.length) throw new Unsupported('not enough arguments');
    return args[ai++];
  };
  return fmt.replace(/%([-+ #0]*)(\*|\d+)?(?:\.(\*|\d*))?([diouxXcseEfFgG%])/g, (whole, flags: string, w: string | undefined, p: string | undefined, conv: string) => {
    if (conv === '%') return '%';
    const width = w === '*' ? toNum(nextArg()) : w ? Number(w) : 0;
    const prec = p === '*' ? toNum(nextArg()) : p !== undefined ? Number(p || 0) : undefined;
    const v = nextArg();
    let body: string;
    let sign = '';
    switch (conv) {
      case 'd': case 'i': {
        const n = Math.trunc(toNum(v));
        sign = n < 0 ? '-' : flags.includes('+') ? '+' : flags.includes(' ') ? ' ' : '';
        body = prec === 0 && n === 0 ? '' : String(Math.abs(n)); // (a zero precision prints no digits for 0)
        if (prec !== undefined) body = body.padStart(prec, '0');
        break;
      }
      case 'o': case 'x': case 'X': case 'u': {
        // Unsigned: a negative number prints as its 64-bit two's complement, as in C.
        const n = Math.trunc(toNum(v));
        const u = n < 0 ? BigInt.asUintN(64, BigInt(n)) : BigInt(n);
        body = u.toString(conv === 'u' ? 10 : conv === 'o' ? 8 : 16);
        if (prec === 0 && u === 0n) body = '';
        if (conv === 'X') body = body.toUpperCase();
        if (prec !== undefined) body = body.padStart(prec, '0');
        // `#`: a leading 0 for octal, 0x for a non-zero hexadecimal number.
        if (flags.includes('#') && conv === 'o' && body[0] !== '0') body = '0' + body;
        if (flags.includes('#') && (conv === 'x' || conv === 'X') && u !== 0n) sign = '0' + conv;
        break;
      }
      case 'c': body = typeof v === 'number' ? String.fromCharCode(v) : toStr(v).slice(0, 1); break;
      case 's': body = toStr(v); if (prec !== undefined) body = body.slice(0, prec); break;
      default: {
        const n = toNum(v);
        sign = n < 0 || Object.is(n, -0) ? '-' : flags.includes('+') ? '+' : flags.includes(' ') ? ' ' : '';
        body = formatFloat(Math.abs(n), conv, prec ?? 6, flags.includes('#'));
      }
    }
    let out = sign + body;
    if (out.length < width) {
      if (flags.includes('-')) out = out.padEnd(width);
      else if (flags.includes('0') && /[diouxXeEfFgG]/.test(conv) && !(prec !== undefined && /[diouxX]/.test(conv))) out = sign + body.padStart(width - sign.length, '0');
      else out = out.padStart(width);
    }
    void whole;
    return out;
  });
}

function expFix(s: string): string {
  return s.replace(/e([+-])(\d)$/, 'e$10$2');
}

/**
 * toFixed with C's rounding: an exact tie (2.25 → 1 digit) goes to the even digit (2.2), where
 * JavaScript rounds up (2.3). Only ties differ, since both otherwise round the exact binary value.
 */
function toFixedC(n: number, prec: number): string {
  const s = n.toFixed(prec);
  if (prec > 60) return s;
  const exact = n.toFixed(Math.min(100, prec + 40));
  const dot = exact.indexOf('.');
  const tail = exact.slice(dot + 1 + prec);
  if (!/^50*$/.test(tail)) return s;
  const digits = s.replace(/^-/, '').replace('.', '');
  if (Number(digits[digits.length - 1]) % 2 === 0) return s;
  // toFixed went up to an odd digit; the even neighbour is the truncated value.
  const truncated = exact.slice(0, prec ? dot + 1 + prec : dot);
  return truncated;
}

/** toExponential with C's rounding of an exact tie (12345 to 3 digits is 1.234e+04, not 1.235e+4). */
function toExponentialC(n: number, prec: number): string {
  const s = n.toExponential(prec);
  if (prec > 60) return s;
  const exact = n.toExponential(Math.min(100, prec + 40));
  const [mant, exp] = exact.split('e');
  if (s.split('e')[1] !== exp) return s; // the carry made the last digit 0
  const digits = mant.replace('.', '');
  if (!/^50*$/.test(digits.slice(prec + 1))) return s;
  if (Number(digits[prec]) % 2 === 1) return s;
  return digits.slice(0, 1) + (prec ? '.' + digits.slice(1, prec + 1) : '') + 'e' + exp;
}

function formatFloat(n: number, conv: string, prec: number, alt: boolean): string {
  const upper = conv === conv.toUpperCase();
  let s: string;
  if (conv === 'f' || conv === 'F') s = toFixedC(n, prec);
  else if (conv === 'e' || conv === 'E') s = expFix(toExponentialC(n, prec));
  else {
    const p = prec === 0 ? 1 : prec;
    const e = n === 0 ? 0 : Math.floor(Math.log10(n));
    if (e < -4 || e >= p) {
      s = expFix(toExponentialC(n, p - 1));
      if (!alt) s = s.replace(/\.?0+e/, 'e');
    } else {
      s = toFixedC(n, Math.max(0, p - 1 - e));
      if (!alt && s.includes('.')) s = s.replace(/\.?0+$/, '');
    }
  }
  return upper ? s.toUpperCase() : s;
}

// ---------------------------------------------------------------- interpreter

class NextSig {}
class ExitSig {}
class BreakSig {}
class ContinueSig {}
class ReturnSig {
  constructor(readonly v: Val) {}
}

class Interp {
  vars = new Map<string, Val>();
  arrays = new Map<string, Map<string, Val>>();
  fields: string[] = [''];
  out: string[] = [];
  private steps = 0;
  private locals: Map<string, Val | Map<string, Val>>[] = [];

  constructor(private prog: Program) {
    this.vars.set('FS', ' ');
    this.vars.set('OFS', ' ');
    this.vars.set('ORS', '\n');
    this.vars.set('SUBSEP', '\x1c');
    this.vars.set('NR', 0);
    this.vars.set('FNR', 0);
    this.vars.set('RSTART', 0);
    this.vars.set('RLENGTH', -1);
    this.vars.set('FILENAME', '');
  }

  private tick(): void {
    if (++this.steps > 200000) throw new Unsupported('too many steps');
  }

  // --- variables, arrays and fields

  private getVar(name: string): Val {
    const local = this.locals[this.locals.length - 1];
    if (local?.has(name)) {
      const v = local.get(name);
      if (v instanceof Map) throw new Unsupported('array as scalar');
      return v;
    }
    if (name === 'NF') return this.fields.length - 1;
    if (this.arrays.has(name)) throw new Unsupported('array as scalar');
    return this.vars.get(name);
  }

  private setVar(name: string, v: Val): void {
    const local = this.locals[this.locals.length - 1];
    if (local?.has(name)) { local.set(name, v); return; }
    if (name === 'NF') {
      const n = Math.max(0, Math.trunc(toNum(v)));
      while (this.fields.length - 1 < n) this.fields.push('');
      this.fields.length = n + 1;
      this.rebuild();
      return;
    }
    // The runner reads lines: another record separator, or a number-to-string format, would change what it shows.
    if ((name === 'RS' && toStr(v) !== '\n') || name === 'CONVFMT') throw new Unsupported(name);
    this.vars.set(name, v);
  }

  private array(name: string): Map<string, Val> {
    const local = this.locals[this.locals.length - 1];
    if (local?.has(name)) {
      let v = local.get(name);
      if (!(v instanceof Map)) { v = new Map(); local.set(name, v); }
      return v;
    }
    let a = this.arrays.get(name);
    if (!a) { a = new Map(); this.arrays.set(name, a); }
    return a;
  }

  private key(subs: Expr[]): string {
    return subs.map((s) => toStr(this.eval(s))).join(toStr(this.vars.get('SUBSEP')));
  }

  setRecord(line: string): void {
    this.fields = [line, ...this.split(line, toStr(this.vars.get('FS')))];
  }

  /** Split like awk: " " means runs of blanks, one other character is literal, anything longer is a regex. */
  private split(s: string, fs: string | RegExp): string[] {
    if (fs instanceof RegExp) return s === '' ? [] : s.split(fs);
    if (fs === ' ') {
      const t = s.replace(/^[ \t\n]+|[ \t\n]+$/g, '');
      return t ? t.split(/[ \t\n]+/) : [];
    }
    if (s === '') return [];
    if (fs.length === 1 && fs !== '\\') return s.split(fs);
    const re = toJsRegex(fs, 'ere', { sedEscapes: true });
    if (!re) throw new Unsupported('FS');
    return s.split(new RegExp(re.source, re.flags));
  }

  private rebuild(): void {
    this.fields[0] = this.fields.slice(1).join(toStr(this.vars.get('OFS')));
  }

  private getField(i: number): Val {
    if (i < 0) throw new Unsupported('negative field');
    if (i === 0) return new StrNum(this.fields[0]);
    return new StrNum(this.fields[i] ?? '');
  }

  private setField(i: number, v: Val): void {
    if (i < 0) throw new Unsupported('negative field');
    if (i === 0) { this.setRecord(toStr(v)); return; }
    while (this.fields.length <= i) this.fields.push('');
    this.fields[i] = toStr(v);
    this.rebuild();
  }

  private assignTo(target: Expr, v: Val): Val {
    if (target.k === 'var') this.setVar(target.name, v);
    else if (target.k === 'idx') this.array(target.name).set(this.key(target.subs), v);
    else if (target.k === 'field') this.setField(Math.trunc(toNum(this.eval(target.e))), v);
    return v;
  }

  private regexOf(e: Expr): RegExp {
    if (e.k === 're') return new RegExp(e.re.source, e.re.flags);
    const re = toJsRegex(toStr(this.eval(e)), 'ere', { sedEscapes: true });
    if (!re) throw new Unsupported('dynamic regex');
    return new RegExp(re.source, re.flags);
  }

  // --- expressions

  eval(e: Expr): Val {
    this.tick();
    switch (e.k) {
      case 'num': return e.v;
      case 'str': return e.v;
      case 're': return this.regexOf(e).test(this.fields[0]) ? 1 : 0;
      case 'var': return this.getVar(e.name);
      case 'idx': {
        const a = this.array(e.name);
        const k = this.key(e.subs);
        if (!a.has(k)) a.set(k, undefined);
        return a.get(k);
      }
      case 'field': return this.getField(Math.trunc(toNum(this.eval(e.e))));
      // `(a, b)` is only a subscript list (`(a, b) in arr`); gawk rejects it as a value.
      case 'group': throw new Unsupported('list as a value');
      case 'in': return this.array(e.name).has(this.key(e.subs)) ? 1 : 0;
      case 'cond': return truthy(this.eval(e.c)) ? this.eval(e.a) : this.eval(e.b);
      case 'unary': {
        const v = this.eval(e.e);
        if (e.op === '!') return truthy(v) ? 0 : 1;
        return e.op === '-' ? -toNum(v) : toNum(v);
      }
      case 'assign': {
        if (e.op === '=') return this.assignTo(e.target, this.eval(e.e));
        const r = toNum(this.eval(e.e));
        const l = toNum(this.eval(e.target));
        return this.assignTo(e.target, arith(e.op.slice(0, -1), l, r));
      }
      case 'incr': {
        const old = toNum(this.eval(e.target));
        const nv = e.op === '++' ? old + 1 : old - 1;
        this.assignTo(e.target, nv);
        return e.prefix ? nv : old;
      }
      case 'bin': {
        switch (e.op) {
          case '&&': return truthy(this.eval(e.l)) && truthy(this.eval(e.r)) ? 1 : 0;
          case '||': return truthy(this.eval(e.l)) || truthy(this.eval(e.r)) ? 1 : 0;
          case '~': case '!~': {
            const hit = this.regexOf(e.r).test(toStr(this.eval(e.l)));
            return (e.op === '~') === hit ? 1 : 0;
          }
          case 'concat': return toStr(this.eval(e.l)) + toStr(this.eval(e.r));
          case '<': return compare(this.eval(e.l), this.eval(e.r)) < 0 ? 1 : 0;
          case '<=': return compare(this.eval(e.l), this.eval(e.r)) <= 0 ? 1 : 0;
          case '>': return compare(this.eval(e.l), this.eval(e.r)) > 0 ? 1 : 0;
          case '>=': return compare(this.eval(e.l), this.eval(e.r)) >= 0 ? 1 : 0;
          case '==': return compare(this.eval(e.l), this.eval(e.r)) === 0 ? 1 : 0;
          case '!=': return compare(this.eval(e.l), this.eval(e.r)) !== 0 ? 1 : 0;
          default: return arith(e.op, toNum(this.eval(e.l)), toNum(this.eval(e.r)));
        }
      }
      case 'call': return this.call(e.name, e.args);
    }
  }

  private call(name: string, args: Expr[]): Val {
    const user = this.prog.funcs.get(name);
    if (user) {
      const frame = new Map<string, Val | Map<string, Val>>();
      user.params.forEach((p, i) => {
        const a = args[i];
        // Arrays are passed by reference, scalars by value.
        if (a && a.k === 'var' && (this.arrays.has(a.name) || this.locals[this.locals.length - 1]?.get(a.name) instanceof Map)) frame.set(p, this.array(a.name));
        else frame.set(p, a ? this.eval(a) : undefined);
      });
      this.locals.push(frame);
      try {
        this.exec(user.body);
        return undefined;
      } catch (sig) {
        if (sig instanceof ReturnSig) return sig.v;
        throw sig;
      } finally {
        this.locals.pop();
      }
    }
    // gawk stops when a built-in lacks an argument.
    const v = (i: number) => {
      if (!args[i]) throw new Unsupported(`${name} without argument ${i + 1}`);
      return this.eval(args[i]);
    };
    switch (name) {
      case 'length': {
        if (!args.length) return this.fields[0].length;
        const a = args[0];
        if (a.k === 'var' && this.arrays.has(a.name)) return this.arrays.get(a.name)!.size;
        return toStr(v(0)).length;
      }
      case 'substr': {
        const s = toStr(v(0));
        // As gawk and mawk do: both truncated, and a start before 1 counts from 1 (`substr("hello", 0, 2)` is "he").
        const from = Math.max(Math.trunc(toNum(v(1))), 1);
        const to = Math.min(args.length > 2 ? from + Math.trunc(toNum(v(2))) : Infinity, s.length + 1);
        return to > from ? s.slice(from - 1, to - 1) : '';
      }
      case 'index': return toStr(v(0)).indexOf(toStr(v(1))) + 1;
      case 'split': {
        // (The 4th argument, an array for the separators, is GNU awk only.)
        if (args[1]?.k !== 'var' || args.length > 3) throw new Unsupported('split target');
        const sep = args.length > 2 ? (args[2].k === 're' ? this.regexOf(args[2]) : toStr(v(2))) : toStr(this.vars.get('FS'));
        const parts = this.split(toStr(v(0)), sep);
        const arr = this.array(args[1].name);
        arr.clear();
        parts.forEach((p, i) => arr.set(String(i + 1), new StrNum(p)));
        return parts.length;
      }
      case 'sub': case 'gsub': {
        const re = this.regexOf(args[0]);
        const target = args[2] ?? { k: 'field', e: { k: 'num', v: 0 } } as Expr;
        if (!isLvalue(target)) throw new Unsupported('sub target');
        const repl = toStr(v(1));
        let count = 0;
        const g = new RegExp(re.source, re.flags + (name === 'gsub' ? 'g' : ''));
        const result = toStr(this.eval(target)).replace(g, (m) => {
          count++;
          // As gawk and mawk: `\\&` is a backslash and the match, `\&` a literal &, other backslashes stay.
          return repl.replace(/\\\\&|\\&|&/g, (x) => (x === '&' ? m : x === '\\&' ? '&' : `\\${m}`));
        });
        if (count) this.assignTo(target, result);
        return count;
      }
      case 'match': {
        const m = this.regexOf(args[1]).exec(toStr(v(0)));
        this.vars.set('RSTART', m ? m.index + 1 : 0);
        this.vars.set('RLENGTH', m ? m[0].length : -1);
        return m ? m.index + 1 : 0;
      }
      case 'sprintf': return sprintf(toStr(v(0)), args.slice(1).map((a) => this.eval(a)));
      case 'tolower': return toStr(v(0)).toLowerCase();
      case 'toupper': return toStr(v(0)).toUpperCase();
      case 'int': return Math.trunc(toNum(v(0)));
      case 'sqrt': return Math.sqrt(toNum(v(0)));
      case 'exp': return Math.exp(toNum(v(0)));
      case 'log': return Math.log(toNum(v(0)));
      case 'sin': return Math.sin(toNum(v(0)));
      case 'cos': return Math.cos(toNum(v(0)));
      case 'atan2': return Math.atan2(toNum(v(0)), toNum(v(1)));
    }
    throw new Unsupported(`function ${name}`);
  }

  // --- statements

  exec(s: Stmt): void {
    this.tick();
    switch (s.k) {
      case 'block': for (const x of s.body) this.exec(x); return;
      case 'expr': this.eval(s.e); return;
      case 'print': {
        const ors = toStr(this.vars.get('ORS'));
        if (s.printf) {
          if (!s.args.length) throw new Unsupported('printf without format');
          this.write(sprintf(toStr(this.eval(s.args[0])), s.args.slice(1).map((a) => this.eval(a))));
          return;
        }
        const text = s.args.length
          ? s.args.map((a) => {
            const v = this.eval(a);
            return typeof v === 'number' ? fmtNumber(v, toStr(this.vars.get('OFMT')) || '%.6g') : toStr(v);
          }).join(toStr(this.vars.get('OFS')))
          : this.fields[0];
        this.write(text + ors);
        return;
      }
      case 'if': if (truthy(this.eval(s.c))) this.exec(s.t); else if (s.f) this.exec(s.f); return;
      case 'while':
        while (truthy(this.eval(s.c))) {
          try { this.exec(s.body); } catch (sig) {
            if (sig instanceof BreakSig) break;
            if (!(sig instanceof ContinueSig)) throw sig;
          }
        }
        return;
      case 'do':
        do {
          try { this.exec(s.body); } catch (sig) {
            if (sig instanceof BreakSig) break;
            if (!(sig instanceof ContinueSig)) throw sig;
          }
        } while (truthy(this.eval(s.c)));
        return;
      case 'for':
        if (s.init) this.exec(s.init);
        while (!s.c || truthy(this.eval(s.c))) {
          try { this.exec(s.body); } catch (sig) {
            if (sig instanceof BreakSig) break;
            if (!(sig instanceof ContinueSig)) throw sig;
          }
          if (s.inc) this.exec(s.inc);
        }
        return;
      case 'forin':
        for (const k of [...this.array(s.arr).keys()]) {
          this.setVar(s.v, new StrNum(k));
          try { this.exec(s.body); } catch (sig) {
            if (sig instanceof BreakSig) break;
            if (!(sig instanceof ContinueSig)) throw sig;
          }
        }
        return;
      case 'next': throw new NextSig();
      case 'exit': throw new ExitSig();
      case 'break': throw new BreakSig();
      case 'continue': throw new ContinueSig();
      case 'return': throw new ReturnSig(s.e ? this.eval(s.e) : undefined);
      case 'delete':
        if (s.subs) this.array(s.name).delete(this.key(s.subs));
        else this.array(s.name).clear();
        return;
    }
  }

  private write(text: string): void {
    this.out.push(text);
  }

  /** Whether a main rule's pattern selects the current record. */
  selects(r: Rule): boolean {
    if (!r.pattern) return true;
    if (!r.pattern2) return truthy(this.eval(r.pattern));
    if (r.active) {
      if (truthy(this.eval(r.pattern2))) r.active = false;
      return true;
    }
    if (truthy(this.eval(r.pattern))) {
      r.active = !truthy(this.eval(r.pattern2));
      return true;
    }
    return false;
  }
}

function arith(op: string, a: number, b: number): number {
  switch (op) {
    case '+': return a + b;
    case '-': return a - b;
    case '*': return a * b;
    case '/': if (b === 0) throw new Unsupported('division by zero'); return a / b;
    case '%': if (b === 0) throw new Unsupported('division by zero'); return a % b;
    // `^`
    default: return a ** b;
  }
}

export function parseAwk(src: string): Program | undefined {
  try {
    return new Parser(lex(src)).program();
  } catch (e) {
    if (e instanceof Unsupported) return undefined;
    // A bug in the parser: let it show.
    /* c8 ignore next */
    throw e;
  }
}

/** FS (`-F`), `-v name=value` (set before BEGIN) and `name=value` operands (set when awk reaches them, after BEGIN). */
export interface AwkRunOptions {
  fs?: string;
  vars?: Record<string, string>;
  assigns?: Record<string, string>;
}

/**
 * The value of `-v`, `-F` or a `name=value` operand, with its escape sequences processed as awk does
 * (`\t` is a tab, `\\` a backslash). Undefined for a sequence whose meaning differs between awks.
 * `regexFs`: other escaped punctuation stays escaped, so `-F '\|'` is a regex matching a bar.
 */
export function awkUnescape(s: string, regexFs = false): string | undefined {
  const simple: Record<string, string> = { '\\': '\\', '"': '"', '/': '/', a: '\x07', b: '\b', f: '\f', n: '\n', r: '\r', t: '\t', v: '\v' };
  let out = '';
  for (let i = 0; i < s.length; i++) {
    if (s[i] !== '\\') { out += s[i]; continue; }
    const n = s[++i];
    if (n === undefined) { out += '\\'; break; }
    const oct = /^[0-7]{1,3}/.exec(s.slice(i));
    if (oct) { out += String.fromCharCode(parseInt(oct[0], 8)); i += oct[0].length - 1; continue; }
    if (n in simple) { out += simple[n]; continue; }
    if (regexFs && /[^A-Za-z0-9]/.test(n)) { out += '\\' + n; continue; }
    return undefined;
  }
  return out;
}

export interface AwkInvocation extends AwkRunOptions {
  vars: Record<string, string>;
  assigns: Record<string, string>;
  /** The program word (absent with -f). */
  program?: string;
  /** Why the example runner cannot follow this command line. */
  unsupported?: string;
}

/**
 * Read the options before the program and the `name=value` operands after it, with awk's dictionary spec (as the
 * explanation reads them). A word that is not literal is undefined.
 */
export function awkInvocation(words: (string | undefined)[]): AwkInvocation {
  const r: AwkInvocation = { vars: {}, assigns: {} };
  const bad = (why: string) => { r.unsupported ??= why; };
  // The value of `-F` or `-v` (undefined: missing or not literal).
  const take = (flag: string, v: string | undefined): void => {
    if (flag === '-F') {
      // `-F'\t'` is a tab; `-Ft` is the letter t in gawk and mawk alike.
      const fs = v === undefined ? undefined : awkUnescape(v, true);
      if (fs === undefined) bad('-F'); else r.fs = fs;
    } else if (flag === '-v') {
      const eq = v?.indexOf('=') ?? -1;
      const value = v === undefined || eq < 1 ? undefined : awkUnescape(v.slice(eq + 1));
      if (v === undefined || value === undefined) bad('-v'); else r.vars[v.slice(0, eq)] = value;
    }
  };
  const parse = parseWords('awk', words);
  const rest: (string | undefined)[] = [];
  // In the order of the words, so that the first reason is the one given.
  for (const { word, role } of parse.roles) {
    for (const x of role.role === 'cluster' ? role.letters : [role]) {
      // Options awk has more of (`--posix`, `-W …`) do not change what the example shows; the caller decides.
      if (x.role === 'unknown-option') bad(`awk ${words[word]}`);
      else if (x.role === 'option' && (x.value || x.missing)) take(x.flag, x.value && words[word]!.slice(x.value.attached));
      else if (x.role === 'value') take(x.of, words[word]);
      else if (x.role === 'operand') { if (words[word] === undefined) bad('non-literal'); rest.push(words[word]); }
    }
  }
  if (!has(parse, '-f')) r.program = rest.shift();
  let seenFile = false;
  for (const w of rest) {
    if (w === undefined) continue;
    const m = /^([A-Za-z_]\w*)=([^]*)$/.exec(w);
    if (!m) seenFile = true;
    else if (seenFile) bad('assignment after a file');
    else {
      const value = awkUnescape(m[2]);
      if (value === undefined) bad('assignment'); else r.assigns[m[1]] = value;
    }
  }
  return r;
}

/** Run an awk program on input lines; undefined if it uses something the runner does not support. */
export function runAwk(src: string, input: string[], opts: AwkRunOptions = {}): string[] | undefined {
  const prog = parseAwk(src);
  if (!prog) return undefined;
  const it = new Interp(prog);
  if (opts.fs !== undefined) it.vars.set('FS', opts.fs);
  for (const [k, v] of Object.entries(opts.vars ?? {})) it.vars.set(k, new StrNum(v));
  // (-v RS=… and RS=… operands are set directly, without setVar.)
  for (const o of [opts.vars, opts.assigns]) if (o && ('CONVFMT' in o || ('RS' in o && o.RS !== '\n'))) return undefined;
  const assign = () => { for (const [k, v] of Object.entries(opts.assigns ?? {})) it.vars.set(k, new StrNum(v)); };
  try {
    let exited = false;
    try {
      for (const r of prog.rules) if (r.begin) it.exec(r.action!);
    } catch (sig) {
      if (!(sig instanceof ExitSig)) throw sig;
      exited = true;
    }
    const main = prog.rules.filter((r) => !r.begin && !r.end);
    const hasEnd = prog.rules.some((r) => r.end);
    if (!exited && (main.length || hasEnd)) {
      assign();
      try {
        input.forEach((line, k) => {
          it.vars.set('NR', k + 1);
          it.vars.set('FNR', k + 1);
          it.setRecord(line);
          try {
            for (const r of main) {
              if (!it.selects(r)) continue;
              if (r.action) it.exec(r.action);
              else it.out.push(it.fields[0] + toStr(it.vars.get('ORS')));
            }
          } catch (sig) {
            if (!(sig instanceof NextSig)) throw sig;
          }
        });
      } catch (sig) {
        if (!(sig instanceof ExitSig)) throw sig;
      }
    }
    try {
      for (const r of prog.rules) if (r.end) it.exec(r.action!);
    } catch (sig) {
      if (!(sig instanceof ExitSig)) throw sig;
    }
  } catch (e) {
    if (e instanceof Unsupported) return undefined;
    if (e instanceof NextSig || e instanceof BreakSig || e instanceof ContinueSig || e instanceof ReturnSig) return undefined;
    /* c8 ignore next 2 */
    // Anything else is a bug in the runner, not an input it cannot run: let it surface.
    throw e;
  }
  const text = it.out.join('');
  return text === '' ? [] : text.replace(/\n$/, '').split('\n');
}

// ---------------------------------------------------------------- example input

interface Usage {
  maxField: number;
  usesNF: boolean;
  /** Fields used as numbers, with thresholds they are compared against. */
  numeric: Map<number, number[]>;
  /** Regexes tested against fields (0 = the whole line). */
  regexes: Map<number, JsRegex[]>;
  /** Something is counted per key (seen[$0]++, count[$1]++), so repeated keys are interesting. */
  counts: boolean;
  fsAssigned?: string;
}

function analyse(prog: Program): Usage {
  const u: Usage = { maxField: 0, usesNF: false, numeric: new Map(), regexes: new Map(), counts: false };
  const fieldNo = (e: Expr): number | undefined => (e.k === 'field' && e.e.k === 'num' ? e.e.v : undefined);
  const markNumeric = (e: Expr, threshold?: number) => {
    const f = fieldNo(e);
    if (f === undefined || f === 0) return;
    const list = u.numeric.get(f) ?? [];
    if (threshold !== undefined) list.push(threshold);
    u.numeric.set(f, list);
  };
  const addRegex = (f: number, re: JsRegex) => u.regexes.set(f, [...(u.regexes.get(f) ?? []), re]);
  /** Whether a user function does arithmetic with its parameter `name`. */
  const paramNumeric = (body: Stmt, name: string): boolean => {
    let hit = false;
    const isParam = (e: Expr) => e.k === 'var' && e.name === name;
    const ve = (e: Expr | undefined): void => {
      if (!e || hit) return;
      if (e.k === 'bin' && ['+', '-', '*', '/', '%', '^', '<', '>', '<=', '>='].includes(e.op) && (isParam(e.l) || isParam(e.r))) hit = true;
      for (const v of Object.values(e)) if (v && typeof v === 'object' && 'k' in v) ve(v as Expr);
      if (e.k === 'call') e.args.forEach(ve);
    };
    const vs = (s: Stmt | undefined): void => {
      if (!s || hit) return;
      for (const v of Object.values(s)) {
        if (Array.isArray(v)) v.forEach((x) => ('k' in x && ['block', 'expr', 'print', 'if', 'while', 'do', 'for', 'forin', 'return', 'exit', 'delete'].includes(x.k) ? vs(x as Stmt) : ve(x as Expr)));
        else if (v && typeof v === 'object' && 'k' in v) (['block', 'expr', 'print', 'if', 'while', 'do', 'for', 'forin', 'return'].includes((v as Stmt).k) && !('op' in v) ? vs(v as Stmt) : ve(v as Expr));
      }
    };
    vs(body);
    return hit;
  };
  const visitE = (e: Expr | undefined, top = false): void => {
    if (!e) return;
    switch (e.k) {
      case 'field': {
        const f = fieldNo(e);
        if (f !== undefined) u.maxField = Math.max(u.maxField, f);
        if (e.e.k === 'var' && e.e.name === 'NF') u.usesNF = true;
        visitE(e.e);
        return;
      }
      case 'var': if (e.name === 'NF') u.usesNF = true; return;
      case 're': if (top) addRegex(0, e.re); return;
      case 'bin': {
        if (['<', '<=', '>', '>=', '==', '!='].includes(e.op)) {
          if (e.r.k === 'num') markNumeric(e.l, e.r.v);
          if (e.l.k === 'num') markNumeric(e.r, e.l.v);
        } else if (['+', '-', '*', '/', '%', '^'].includes(e.op)) {
          markNumeric(e.l);
          markNumeric(e.r);
        } else if ((e.op === '~' || e.op === '!~') && e.r.k === 're') {
          // `$NF ~ /re/` tests the last field (-1).
          addRegex(e.l.k === 'field' && e.l.e.k === 'var' && e.l.e.name === 'NF' ? -1 : fieldNo(e.l) ?? 0, e.r.re);
        }
        visitE(e.l);
        visitE(e.r);
        return;
      }
      case 'assign':
        if (e.op !== '=') markNumeric(e.e);
        if (e.target.k === 'var' && e.target.name === 'FS' && e.e.k === 'str') u.fsAssigned = e.e.v;
        visitE(e.target);
        visitE(e.e);
        return;
      case 'incr':
        if (e.target.k === 'idx' && e.target.subs.some((s) => s.k === 'field')) u.counts = true;
        visitE(e.target);
        return;
      case 'idx': e.subs.forEach((s) => visitE(s)); return;
      case 'call': {
        // A field passed to a user function that does arithmetic with it is a number.
        const fn = prog.funcs.get(e.name);
        if (fn) e.args.forEach((a, i) => { if (fn.params[i] && paramNumeric(fn.body, fn.params[i])) markNumeric(a); });
        e.args.forEach((a) => visitE(a));
        return;
      }
      case 'unary': visitE(e.e, top && e.op === '!'); return;
      case 'cond': visitE(e.c); visitE(e.a); visitE(e.b); return;
      case 'in': e.subs.forEach((s) => visitE(s)); return;
      case 'group': e.list.forEach((x) => visitE(x)); return;
    }
  };
  const visitS = (s: Stmt | undefined): void => {
    if (!s) return;
    switch (s.k) {
      case 'block': s.body.forEach(visitS); return;
      case 'expr': visitE(s.e); return;
      case 'print': {
        // printf "%5.1f", $2: arguments for numeric conversions are numbers.
        if (s.printf && s.args[0]?.k === 'str') {
          const convs = [...s.args[0].v.matchAll(/%[-+ #0]*(?:\*|\d+)?(?:\.\d*)?([a-zA-Z%])/g)].map((m) => m[1]).filter((c) => c !== '%');
          convs.forEach((c, i) => { if (/[dioxXeEfFgGu]/.test(c) && s.args[i + 1]) markNumeric(s.args[i + 1]); });
        }
        s.args.forEach((a) => visitE(a));
        return;
      }
      case 'if': visitE(s.c, true); visitS(s.t); visitS(s.f); return;
      case 'while': case 'do': visitE(s.c, true); visitS(s.body); return;
      case 'for': visitS(s.init); visitE(s.c); visitS(s.inc); visitS(s.body); return;
      case 'forin': visitS(s.body); return;
      case 'exit': case 'return': visitE(s.e); return;
      case 'delete': s.subs?.forEach((x) => visitE(x)); return;
    }
  };
  for (const r of prog.rules) {
    visitE(r.pattern, true);
    visitE(r.pattern2, true);
    visitS(r.action);
  }
  for (const f of prog.funcs.values()) visitS(f.body);
  return u;
}

const WORDS = [
  ['apple', 'banana', 'cherry', 'grape'],
  ['red', 'yellow', 'green', 'purple'],
  ['tokyo', 'osaka', 'kyoto', 'nara'],
  ['alpha', 'beta', 'gamma', 'delta'],
  ['north', 'south', 'east', 'west'],
  ['one', 'two', 'three', 'four'],
];

function numbersAround(thresholds: number[]): number[] {
  if (!thresholds.length) return [3, 12, 7, 25];
  const t = thresholds[0];
  if (t === 0) return [-2, 3, 5, 0];
  const scale = [0.8, 1.2, 1.5, 0.5].map((f) => t * f);
  return Number.isInteger(t) ? scale.map(Math.round) : scale.map((x) => Math.round(x * 100) / 100);
}

export interface AwkExample {
  input: string[];
  output: string[];
}

/** Make up input lines that fit the program (fields, numbers around thresholds, regex matches) and run it. */
export function awkExample(src: string, opts: AwkRunOptions = {}): AwkExample | undefined {
  const prog = parseAwk(src);
  if (!prog) return undefined;
  const u = analyse(prog);
  const onlyBegin = prog.rules.every((r) => r.begin);
  const fs = opts.fs ?? u.fsAssigned ?? ' ';
  const sep = fs === ' ' ? ' ' : fs === '\\t' || fs === '\t' ? '\t' : fs.length === 1 ? fs : /^\[(.)/.exec(fs)?.[1] ?? /^\\([^A-Za-z0-9])$/.exec(fs)?.[1] ?? ' ';
  let input: string[];
  if (onlyBegin) {
    input = [];
  } else if (u.maxField === 0 && !u.usesNF) {
    // Whole lines only: mix lines that match the program's regexes with ordinary ones.
    const lines: string[] = [];
    for (const re of u.regexes.get(0) ?? []) {
      const ex = regexExamples(re, 2);
      if (ex) lines.push(...ex.matching.filter((m) => !m.startsWith('abc ')).slice(0, 1));
    }
    // Lines of different lengths also exercise conditions such as length($0) > 10.
    input = ['line one', ...lines, 'a somewhat longer line of text', 'line two'];
    if (u.counts) input.push(input[1]);
  } else {
    const cols = Math.min(Math.max(u.maxField, 3), 6);
    const rows = 4;
    const grid: string[][] = [];
    for (let r = 0; r < rows; r++) {
      const row: string[] = [];
      for (let c = 1; c <= cols; c++) {
        row.push(u.numeric.has(c) ? String(numbersAround(u.numeric.get(c)!)[r]) : WORDS[c - 1][r]);
      }
      grid.push(row);
    }
    // Put regex matches into rows 1 and 3 of the tested column (column 1 for whole-line regexes).
    for (const [f, res] of u.regexes) {
      // Whole-line regexes anchored at the end belong in the last column, others in the first.
      const anchoredEnd = /\$$/.test(res[0].source) && !/\\\$$/.test(res[0].source);
      const col = f === -1 || (f === 0 && anchoredEnd) ? cols - 1 : Math.max(f, 1) - 1;
      if (col >= cols) continue;
      const ex = regexExamples(res[0], 3);
      if (!ex) continue;
      const fits = ex.matching.filter((m) => !m.includes(sep) && !m.startsWith('abc '));
      if (fits[0]) grid[0][col] = fits[0];
      if (fits[1] ?? fits[0]) grid[2][col] = fits[1] ?? fits[0];
    }
    input = grid.map((row) => row.join(sep));
    if (u.counts) input.push(input[0]);
  }
  const output = runAwk(src, input, opts);
  if (!output) return undefined;
  return { input, output: output.length > 6 ? [...output.slice(0, 5), '…'] : output };
}
