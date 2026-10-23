/** A small Perl subset for one-liner examples: perl -n/-p/-l/-a/-F/-i -e '…'. */
import { sprintf } from './awk';
import { JsRegex, regexExamples, toJsRegex } from './regex';
import { Unsupported as RunnerUnsupported } from './unsupported';

class Unsupported extends RunnerUnsupported {}

// ---------------------------------------------------------------- lexer

interface Tok {
  t: 'num' | 'str' | 'istr' | 'var' | 'word' | 'op' | 're' | 'subst' | 'tr' | 'qw';
  v: string;
  /** Regex/substitution parts. */
  pat?: string;
  rep?: string;
  flags?: string;
}

const OPS = ['<=>', '**=', '||=', '//=', '&&=', '...', '**', '++', '--', '+=', '-=', '*=', '/=', '.=', '%=', 'x=', '==', '!=', '<=', '>=', '=~', '!~', '&&', '||', '//', '..', '->', '=>',
  '+', '-', '*', '/', '%', '.', '<', '>', '=', '!', '?', ':', ',', ';', '(', ')', '{', '}', '[', ']', '\\'];
const PAIRS: Record<string, string> = { '{': '}', '(': ')', '[': ']', '<': '>' };

function readDelimited(src: string, i: number, open: string): [string, number] {
  const close = PAIRS[open] ?? open;
  let depth = 1;
  let j = i;
  let out = '';
  while (j < src.length) {
    const c = src[j];
    if (c === '\\' && j + 1 < src.length) {
      // Keep escapes, except an escaped delimiter which becomes the plain character.
      out += src[j + 1] === close || src[j + 1] === open ? (open === '/' ? '\\/' : src[j + 1]) : c + src[j + 1];
      j += 2;
      continue;
    }
    if (open !== close && c === open) depth++;
    else if (c === close && --depth === 0) return [out, j + 1];
    out += c;
    j++;
  }
  throw new Unsupported('unterminated');
}

function lex(src: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  const operandExpected = () => {
    const p = out[out.length - 1];
    if (!p) return true;
    if (p.t === 'op') return !/^[)\]}]$/.test(p.v) && p.v !== '++' && p.v !== '--';
    if (p.t === 'word') return ['if', 'unless', 'and', 'or', 'not', 'split', 'grep', 'return', 'print', 'say', 'while', 'until', 'push', 'join'].includes(p.v);
    return false;
  };
  while (i < src.length) {
    const c = src[i];
    if (/\s/.test(c)) { i++; continue; }
    if (c === '#') { while (i < src.length && src[i] !== '\n') i++; continue; }
    let m: RegExpExecArray | null;
    if ((m = /^\d+(\.\d+)?([eE][-+]?\d+)?/.exec(src.slice(i)))) { out.push({ t: 'num', v: m[0] }); i += m[0].length; continue; }
    if ((m = /^[$@%](\{\w+\}|\w+|[_.,\\/&0!])/.exec(src.slice(i)))) {
      out.push({ t: 'var', v: m[0][0] + m[1].replace(/^\{|\}$/g, '') });
      i += m[0].length;
      continue;
    }
    if (c === "'") { const [s, j] = readDelimited(src, i + 1, "'"); out.push({ t: 'str', v: s.replace(/\\(['\\])/g, '$1') }); i = j; continue; }
    if (c === '"') { const [s, j] = readDelimited(src, i + 1, '"'); out.push({ t: 'istr', v: s }); i = j; continue; }
    if ((m = /^(s|tr|y|m|qr|qw|q|qq)\s*([^\w\s])/.exec(src.slice(i))) && !/\w/.test(src[i - 1] ?? '') && (m[1] !== 'y' || operandExpected() || src[i + 1] !== ' ')) {
      const op = m[1];
      const open = m[2];
      let [a, j] = readDelimited(src, i + m[0].length, open);
      if (op === 's' || op === 'tr' || op === 'y') {
        let b: string;
        if (PAIRS[open]) {
          while (/\s/.test(src[j])) j++;
          [b, j] = readDelimited(src, j + 1, src[j]);
        } else [b, j] = readDelimited(src, j, open);
        const f = /^[a-z]*/.exec(src.slice(j))![0];
        out.push({ t: op === 's' ? 'subst' : 'tr', v: op, pat: a, rep: b, flags: f });
        i = j + f.length;
        continue;
      }
      const f = /^[a-z]*/.exec(src.slice(j))![0];
      if (op === 'qw') out.push({ t: 'qw', v: a });
      else if (op === 'q') out.push({ t: 'str', v: a });
      else if (op === 'qq') out.push({ t: 'istr', v: a });
      else out.push({ t: 're', v: op, pat: a, flags: f });
      i = j + f.length;
      continue;
    }
    if (c === '/' && operandExpected()) {
      const [a, j] = readDelimited(src, i + 1, '/');
      const f = /^[a-z]*/.exec(src.slice(j))![0];
      out.push({ t: 're', v: 'm', pat: a, flags: f });
      i = j + f.length;
      continue;
    }
    if ((m = /^[A-Za-z_]\w*(::\w+)*/.exec(src.slice(i)))) { out.push({ t: 'word', v: m[0] }); i += m[0].length; continue; }
    if (src.startsWith('<>', i) || src.startsWith('<STDIN>', i)) throw new Unsupported('reading input');
    const op = OPS.find((o) => src.startsWith(o, i));
    if (!op) throw new Unsupported(`char ${c}`);
    out.push({ t: 'op', v: op });
    i += op.length;
  }
  return out;
}

// ---------------------------------------------------------------- AST

type E =
  | { k: 'num'; v: number } | { k: 'str'; v: string } | { k: 'istr'; v: string }
  | { k: 'scalar'; name: string } | { k: 'array'; name: string } | { k: 'hash'; name: string }
  | { k: 'elem'; name: string; idx: E } | { k: 'helem'; name: string; key: E }
  | { k: 'match'; target?: E; re: JsRegex; neg: boolean; global: boolean }
  | { k: 'subst'; target?: E; re: JsRegex; rep: string; global: boolean; ret: boolean; evalRep: boolean }
  | { k: 'tr'; target?: E; from: string; to: string; flags: string }
  | { k: 'bin'; op: string; l: E; r: E } | { k: 'un'; op: string; e: E }
  | { k: 'cond'; c: E; a: E; b: E } | { k: 'assign'; op: string; l: E; r: E }
  | { k: 'incr'; op: string; pre: boolean; e: E }
  | { k: 'call'; name: string; args: E[]; block?: S[] } | { k: 'list'; items: E[] };

type S =
  | { k: 'expr'; e: E }
  | { k: 'if'; c: E; t: S[]; f?: S[]; unless?: boolean }
  | { k: 'for'; v?: string; list: E; body: S[] }
  | { k: 'next' } | { k: 'last' };

const NAMED_UNARY = new Set(['length', 'uc', 'lc', 'ucfirst', 'lcfirst', 'chomp', 'chop', 'defined', 'abs', 'int', 'sqrt', 'keys', 'values', 'scalar', 'exists', 'delete', 'chr', 'ord']);
const LIST_FUNCS = new Set(['print', 'say', 'printf', 'join', 'split', 'sprintf', 'substr', 'index', 'push', 'sort', 'reverse', 'die', 'warn', 'lc', 'uc']);

class Parser {
  p = 0;
  constructor(private toks: Tok[]) {}

  private peek(v?: string): Tok | undefined {
    const t = this.toks[this.p];
    return v === undefined || (t && (t.t === 'op' || t.t === 'word') && t.v === v) ? t : undefined;
  }

  private next(): Tok {
    const t = this.toks[this.p++];
    if (!t) throw new Unsupported('end');
    return t;
  }

  private expect(v: string): void {
    if (!this.peek(v)) throw new Unsupported(`expected ${v}`);
    this.p++;
  }

  program(): { begin: S[]; main: S[]; end: S[] } {
    const begin: S[] = [];
    const main: S[] = [];
    const end: S[] = [];
    while (this.p < this.toks.length) {
      if (this.peek(';')) { this.p++; continue; }
      if ((this.peek('BEGIN') || this.peek('END')) && this.toks[this.p + 1]?.v === '{') {
        const which = this.next().v;
        (which === 'BEGIN' ? begin : end).push(...this.block());
        continue;
      }
      main.push(this.statement());
    }
    return { begin, main, end };
  }

  private block(): S[] {
    this.expect('{');
    const body: S[] = [];
    while (!this.peek('}')) {
      if (this.peek(';')) { this.p++; continue; }
      body.push(this.statement());
    }
    this.p++;
    return body;
  }

  /** What follows an `if` block: `elsif (…) {…}` (an `if` in the else part) and `else {…}`. */
  private ifTail(): S[] | undefined {
    if (this.peek('elsif')) {
      this.p++;
      this.expect('(');
      const c = this.expr();
      this.expect(')');
      const t = this.block();
      return [{ k: 'if', c, t, f: this.ifTail(), unless: false }];
    }
    if (this.peek('else')) { this.p++; return this.block(); }
    return undefined;
  }

  private statement(): S {
    const t = this.peek();
    if (t?.t === 'word' && (t.v === 'if' || t.v === 'unless')) {
      this.p++;
      this.expect('(');
      const c = this.expr();
      this.expect(')');
      const then = this.block();
      return { k: 'if', c, t: then, f: this.ifTail(), unless: t.v === 'unless' };
    }
    if (t?.t === 'word' && (t.v === 'for' || t.v === 'foreach')) {
      this.p++;
      let v: string | undefined;
      if (this.peek('my')) this.p++;
      if (this.toks[this.p]?.t === 'var') v = this.next().v.slice(1);
      this.expect('(');
      const list = this.expr();
      this.expect(')');
      return { k: 'for', v, list, body: this.block() };
    }
    let s: S;
    if (this.peek('next')) { this.p++; s = { k: 'next' }; }
    else if (this.peek('last')) { this.p++; s = { k: 'last' }; }
    else s = { k: 'expr', e: this.expr() };
    // Statement modifiers.
    if (this.peek('if') || this.peek('unless')) {
      const kw = this.next().v;
      const c = this.expr();
      s = { k: 'if', c, t: [s], unless: kw === 'unless' };
    } else if (this.peek('for') || this.peek('foreach')) {
      this.p++;
      s = { k: 'for', list: this.expr(), body: [s] };
    }
    if (this.peek(';')) this.p++;
    else if (!this.peek('}') && this.p < this.toks.length) throw new Unsupported('expected ;');
    return s;
  }

  expr(): E {
    let l = this.lowAnd();
    while (this.peek('or')) { this.p++; l = { k: 'bin', op: '||', l, r: this.lowAnd() }; }
    return l;
  }

  private lowAnd(): E {
    let l = this.lowNot();
    while (this.peek('and')) { this.p++; l = { k: 'bin', op: '&&', l, r: this.lowNot() }; }
    return l;
  }

  private lowNot(): E {
    if (this.peek('not')) { this.p++; return { k: 'un', op: '!', e: this.lowNot() }; }
    return this.comma();
  }

  private comma(): E {
    const first = this.assign();
    if (!this.peek(',') && !this.peek('=>')) return first;
    const items = [first];
    while (this.peek(',') || this.peek('=>')) {
      this.p++;
      if (this.atListEnd()) break;
      items.push(this.assign());
    }
    return { k: 'list', items };
  }

  private atListEnd(): boolean {
    const t = this.peek();
    return !t || [';', ')', '}', ']'].includes(t.v) || (t.t === 'word' && ['if', 'unless', 'for', 'foreach', 'or', 'and'].includes(t.v));
  }

  private assign(): E {
    const l = this.ternary();
    const t = this.peek();
    if (t?.t === 'op' && ['=', '+=', '-=', '*=', '/=', '.=', '%=', 'x=', '**=', '||=', '//=', '&&='].includes(t.v)) {
      this.p++;
      return { k: 'assign', op: t.v, l, r: this.assign() };
    }
    return l;
  }

  private ternary(): E {
    const c = this.range();
    if (!this.peek('?')) return c;
    this.p++;
    const a = this.assign();
    this.expect(':');
    return { k: 'cond', c, a, b: this.assign() };
  }

  private range(): E {
    const l = this.oror();
    if (!this.peek('..')) return l;
    this.p++;
    return { k: 'bin', op: '..', l, r: this.oror() };
  }

  private oror(): E {
    let l = this.andand();
    while (this.peek('||') || this.peek('//')) { const op = this.next().v; l = { k: 'bin', op, l, r: this.andand() }; }
    return l;
  }

  private andand(): E {
    let l = this.equality();
    while (this.peek('&&')) { this.p++; l = { k: 'bin', op: '&&', l, r: this.equality() }; }
    return l;
  }

  private equality(): E {
    let l = this.relational();
    for (;;) {
      const t = this.peek();
      if (!t || !['==', '!=', '<=>', 'eq', 'ne', 'cmp'].includes(t.v)) return l;
      this.p++;
      l = { k: 'bin', op: t.v, l, r: this.relational() };
    }
  }

  private relational(): E {
    let l = this.additive();
    for (;;) {
      const t = this.peek();
      if (!t || !['<', '>', '<=', '>=', 'lt', 'gt', 'le', 'ge'].includes(t.v)) return l;
      this.p++;
      l = { k: 'bin', op: t.v, l, r: this.additive() };
    }
  }

  private additive(): E {
    let l = this.multiplicative();
    while (this.peek('+') || this.peek('-') || this.peek('.')) { const op = this.next().v; l = { k: 'bin', op, l, r: this.multiplicative() }; }
    return l;
  }

  private multiplicative(): E {
    let l = this.bind();
    while (this.peek('*') || this.peek('/') || this.peek('%') || this.peek('x')) { const op = this.next().v; l = { k: 'bin', op, l, r: this.bind() }; }
    return l;
  }

  private bind(): E {
    const l = this.unary();
    if (this.peek('=~') || this.peek('!~')) {
      const neg = this.next().v === '!~';
      const r = this.unary();
      if (r.k === 'match') return { ...r, target: l, neg: neg !== r.neg };
      if (r.k === 'subst' && !neg) return { ...r, target: l };
      if (r.k === 'tr' && !neg) return { ...r, target: l };
      throw new Unsupported('dynamic =~');
    }
    return l;
  }

  private unary(): E {
    if (this.peek('!')) { this.p++; return { k: 'un', op: '!', e: this.unary() }; }
    if (this.peek('-')) { this.p++; return { k: 'un', op: '-', e: this.unary() }; }
    if (this.peek('+')) { this.p++; return this.unary(); }
    return this.power();
  }

  private power(): E {
    const l = this.incdec();
    if (this.peek('**')) { this.p++; return { k: 'bin', op: '**', l, r: this.unary() }; }
    return l;
  }

  private incdec(): E {
    if (this.peek('++') || this.peek('--')) { const op = this.next().v; return { k: 'incr', op, pre: true, e: this.primary() }; }
    const e = this.primary();
    if (this.peek('++') || this.peek('--')) { const op = this.next().v; return { k: 'incr', op, pre: false, e }; }
    return e;
  }

  private regex(pat: string, flags: string): JsRegex {
    if (/[^gimsxr]/.test(flags) || flags.includes('x')) throw new Unsupported('regex flags');
    const re = toJsRegex(pat, 'pcre', { ignoreCase: flags.includes('i') });
    if (!re || /\$\w|@\w/.test(pat.replace(/\\./g, '').replace(/\$$/, ''))) throw new Unsupported('regex');
    return { source: re.source, flags: re.flags + (flags.includes('m') ? 'm' : '') + (flags.includes('s') ? 's' : '') };
  }

  private primary(): E {
    const t = this.next();
    switch (t.t) {
      case 'num': return { k: 'num', v: Number(t.v) };
      case 'str': return { k: 'str', v: t.v };
      case 'istr': return { k: 'istr', v: t.v };
      case 'qw': return { k: 'list', items: t.v.trim().split(/\s+/).filter(Boolean).map((v) => ({ k: 'str', v })) };
      case 're': return { k: 'match', re: this.regex(t.pat!, t.flags!), neg: false, global: t.flags!.includes('g') };
      case 'subst':
        if (/[^gimsre]/.test(t.flags!)) throw new Unsupported('s flags');
        return { k: 'subst', re: this.regex(t.pat!, t.flags!.replace(/[re]/g, '')), rep: t.rep!, global: t.flags!.includes('g'), ret: t.flags!.includes('r'), evalRep: t.flags!.includes('e') };
      case 'tr': return { k: 'tr', from: t.pat!, to: t.rep!, flags: t.flags! };
      case 'var': {
        const sigil = t.v[0];
        const name = t.v.slice(1);
        if (sigil === '$' && this.peek('[')) { this.p++; const idx = this.expr(); this.expect(']'); return { k: 'elem', name, idx }; }
        if (sigil === '$' && this.peek('{')) {
          this.p++;
          const kt = this.toks[this.p];
          const key: E = kt?.t === 'word' && this.toks[this.p + 1]?.v === '}' ? (this.p++, { k: 'str', v: kt.v }) : this.expr();
          this.expect('}');
          return { k: 'helem', name, key };
        }
        if (sigil === '@') return { k: 'array', name };
        if (sigil === '%') return { k: 'hash', name };
        return { k: 'scalar', name };
      }
      case 'word': {
        const name = t.v;
        if (name === 'my') return this.primary();
        if (name === 'STDERR' || name === 'STDOUT') throw new Unsupported('filehandle');
        if (name === 'sort' && this.peek('{')) {
          const block = this.block();
          // perl rejects a sort with nothing to sort.
          if (this.atListEnd()) throw new Unsupported('sort without a list');
          return { k: 'call', name, args: [this.comma()], block };
        }
        if (this.peek('(')) {
          this.p++;
          const args = this.peek(')') ? [] : [this.expr()];
          this.expect(')');
          return { k: 'call', name, args: flattenArgs(args) };
        }
        if (NAMED_UNARY.has(name)) {
          if (this.atListEnd() || this.peek('=') || this.peek('.') || this.peek('==') || this.peek('>') || this.peek('<') || this.peek('+') || this.peek('-') || this.peek('?') || this.peek('eq') || this.peek(',')) return { k: 'call', name, args: [] };
          return { k: 'call', name, args: [this.unary()] };
        }
        if (LIST_FUNCS.has(name) || ['next', 'last'].includes(name)) {
          const args = this.atListEnd() ? [] : [this.comma()];
          return { k: 'call', name, args: flattenArgs(args) };
        }
        throw new Unsupported(`function ${name}`);
      }
      case 'op':
        if (t.v === '(') {
          if (this.peek(')')) { this.p++; return { k: 'list', items: [] }; }
          const e = this.expr();
          this.expect(')');
          return e.k === 'list' ? e : { k: 'list', items: [e] };
        }
    }
    throw new Unsupported(`unexpected ${t.v}`);
  }
}

function flattenArgs(args: E[]): E[] {
  return args.length === 1 && args[0].k === 'list' ? args[0].items : args;
}

// ---------------------------------------------------------------- values and evaluation

type V = string | number | undefined;

function num(v: V): number {
  if (typeof v === 'number') return v;
  const m = /^\s*[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?/.exec(v ?? '');
  return m ? Number(m[0]) : 0;
}

function str(v: V): string {
  if (v === undefined) return '';
  if (typeof v === 'number') {
    if (Number.isInteger(v) && Math.abs(v) < 1e15) return String(v);
    return sprintf('%.15g', [v]);
  }
  return v;
}

const truthy = (v: V) => v !== undefined && v !== '' && v !== '0' && v !== 0;

class NextSig {}
class LastSig {}

class Interp {
  scalars = new Map<string, V>();
  arrays = new Map<string, V[]>();
  hashes = new Map<string, Map<string, V>>();
  out = '';
  caps: (string | undefined)[] = [];
  private steps = 0;

  private tick(): void {
    if (++this.steps > 100000) throw new Unsupported('too many steps');
  }

  private arr(name: string): V[] {
    let a = this.arrays.get(name);
    if (!a) { a = []; this.arrays.set(name, a); }
    return a;
  }

  private hash(name: string): Map<string, V> {
    let h = this.hashes.get(name);
    if (!h) { h = new Map(); this.hashes.set(name, h); }
    return h;
  }

  private scalar(name: string): V {
    if (/^\d+$/.test(name) && name !== '0') return this.caps[Number(name)];
    if (name === '&') return this.caps[0];
    return this.scalars.get(name);
  }

  /** "…$x…" with variables, $F[1], $h{k}, @a, escapes and the case escapes \U \L \u \l \E. */
  interpolate(s: string): string {
    const esc: Record<string, string> = { n: '\n', t: '\t', r: '\r', '\\': '\\', '"': '"', $: '$', '@': '@', e: '\x1b', a: '\x07', '0': '\0' };
    // Slices (`"@a[0]"`, `"@h{x}"`) are not followed.
    if (/(^|[^\\])@\w+[[{]/.test(s)) throw new Unsupported('slice in a string');
    // Mark case escapes, substitute values, then apply the case changes.
    const marked = s.replace(/\\([ULulEQ])/g, '\u0001$1').replace(/\\(.)|\$\{(\w+)\}|\$(\w+|&|\.(?!\w))(?:\[(-?\d+|\$\w+)\]|\{(\w+|\$\w+)\})?|@(\w+)/g, (m, e: string, braced: string, name: string, idx: string, key: string, arrName: string) => {
      if (e !== undefined) return esc[e] ?? e;
      if (braced) return str(this.scalar(braced));
      if (arrName) {
        // perl puts nothing for an unknown array (an error under strict): an address such as "a@b.c" is not shown.
        if (!this.arrays.has(arrName)) throw new Unsupported('unknown array in a string');
        return this.arr(arrName).map(str).join(' ');
      }
      if (idx !== undefined) {
        const i = /^\$/.test(idx) ? num(this.scalar(idx.slice(1))) : Number(idx);
        const a = this.arr(name);
        return str(a[i < 0 ? a.length + i : i]);
      }
      if (key !== undefined) return str(this.hash(name).get(/^\$/.test(key) ? str(this.scalar(key.slice(1))) : key));
      return str(this.scalar(name));
    });
    if (!marked.includes('\u0001')) return marked;
    let out = '';
    let mode = '';
    let once = '';
    // A \u or \l counts within \U or \L only right at its start (`"\L\uHELLO"` is "Hello", `"\Lab\uc"` is "abc").
    let fresh = false;
    for (let i = 0; i < marked.length; i++) {
      if (marked[i] === '\u0001') {
        const c = marked[++i];
        if (c === 'U' || c === 'L') { mode = c; fresh = true; }
        else if (c === 'E') mode = '';
        else if ((c === 'u' || c === 'l') && (!mode || fresh)) once = c;
        else if (c === 'Q') throw new Unsupported('\\Q');
        continue;
      }
      let ch = mode === 'U' ? marked[i].toUpperCase() : mode === 'L' ? marked[i].toLowerCase() : marked[i];
      if (once) { ch = once === 'u' ? ch.toUpperCase() : ch.toLowerCase(); once = ''; }
      fresh = false;
      out += ch;
    }
    return out;
  }

  private lvalueSet(e: E, v: V): V {
    switch (e.k) {
      case 'scalar': this.scalars.set(e.name, v); return v;
      case 'elem': { const a = this.arr(e.name); const i = num(this.ev(e.idx)); a[i < 0 ? a.length + i : i] = v; return v; }
      case 'helem': this.hash(e.name).set(str(this.ev(e.key)), v); return v;
    }
    throw new Unsupported('lvalue');
  }

  /** List context. */
  list(e: E): V[] {
    switch (e.k) {
      case 'list': return e.items.flatMap((x) => this.list(x));
      case 'array': return [...this.arr(e.name)];
      case 'hash': return [...this.hash(e.name)].flat();
      case 'call':
        if (e.name === 'keys') return [...this.hashOf(e.args[0]).keys()];
        if (e.name === 'values') return [...this.hashOf(e.args[0]).values()];
        if (e.name === 'split') return this.split(e);
        if (e.name === 'sort') return this.sort(e);
        if (e.name === 'reverse') return e.args.flatMap((a) => this.list(a)).reverse();
        return [this.ev(e)];
      case 'bin':
        if (e.op === '..') {
          const a = num(this.ev(e.l));
          const b = num(this.ev(e.r));
          if (b - a > 1000) throw new Unsupported('long range');
          return Array.from({ length: Math.max(0, b - a + 1) }, (_, k) => a + k);
        }
        return [this.ev(e)];
      case 'match':
        if (e.global) {
          const re = new RegExp(e.re.source, e.re.flags.replace('g', '') + 'g');
          return [...str(e.target ? this.ev(e.target) : this.scalar('_')).matchAll(re)].map((m) => (m.length > 1 ? m[1] : m[0]));
        }
        // In list context a match gives its groups (or 1 without groups), and nothing when it fails.
        if (!truthy(this.ev(e))) return [];
        return this.caps.length > 1 ? this.caps.slice(1) : [1];
      default: return [this.ev(e)];
    }
  }

  private hashOf(e: E | undefined): Map<string, V> {
    if (e?.k !== 'hash') throw new Unsupported('keys of non-hash');
    return this.hash(e.name);
  }

  private split(e: Extract<E, { k: 'call' }>): V[] {
    const [sep, target, limit] = e.args;
    const s = str(target ? this.ev(target) : this.scalar('_'));
    let parts: string[];
    // `split` alone, and `split ' '` or `split " "`, split on runs of blanks and drop leading ones.
    if (!sep || ((sep.k === 'str' || sep.k === 'istr') && sep.v === ' ')) parts = s.replace(/^\s+/, '').split(/\s+/);
    else if (sep.k === 'match') parts = s.split(new RegExp(sep.re.source, sep.re.flags));
    else parts = s.split(str(this.ev(sep)));
    if (limit) throw new Unsupported('split limit');
    while (parts.length && parts[parts.length - 1] === '') parts.pop();
    return parts;
  }

  private sort(e: Extract<E, { k: 'call' }>): V[] {
    const items = e.args.flatMap((a) => this.list(a));
    if (!e.block) return [...items].sort((a, b) => (str(a) < str(b) ? -1 : str(a) > str(b) ? 1 : 0));
    return [...items].sort((a, b) => {
      this.scalars.set('a', a);
      this.scalars.set('b', b);
      let r: V = 0;
      for (const s of e.block!) if (s.k === 'expr') r = this.ev(s.e);
      return num(r);
    });
  }

  ev(e: E): V {
    this.tick();
    switch (e.k) {
      case 'num': return e.v;
      case 'str': return e.v;
      case 'istr': return this.interpolate(e.v);
      case 'scalar': return this.scalar(e.name);
      case 'array': return this.arr(e.name).length;
      case 'hash': return this.hash(e.name).size;
      case 'elem': { const a = this.arr(e.name); const i = num(this.ev(e.idx)); return a[i < 0 ? a.length + i : i]; }
      case 'helem': return this.hash(e.name).get(str(this.ev(e.key)));
      case 'list': { let last: V; for (const x of e.items) last = this.ev(x); return last; }
      case 'match': {
        const s = str(e.target ? this.ev(e.target) : this.scalar('_'));
        const m = new RegExp(e.re.source, e.re.flags.replace('g', '')).exec(s);
        if (m) this.caps = [...m];
        return (!!m !== e.neg) ? 1 : '';
      }
      case 'subst': {
        const target = e.target ?? { k: 'scalar', name: '_' } as E;
        const s = str(this.ev(target));
        let count = 0;
        const re = new RegExp(e.re.source, e.re.flags + (e.global ? 'g' : ''));
        const result = s.replace(re, (...m) => {
          count++;
          const groups = m.slice(0, -2).filter((x) => typeof x === 'string' || x === undefined) as (string | undefined)[];
          this.caps = groups;
          if (e.evalRep) {
            const p = new Parser(lex(e.rep));
            return str(this.ev(p.expr()));
          }
          return this.interpolate(e.rep);
        });
        if (e.ret) return result;
        if (count) this.lvalueSet(target, result);
        return count || '';
      }
      case 'tr': {
        const target = e.target ?? { k: 'scalar', name: '_' } as E;
        if (/[^dsrc]/.test(e.flags) || e.flags.includes('c')) throw new Unsupported('tr flags');
        const expand = (x: string) => x.replace(/(.)-(.)/g, (_, a: string, b: string) => Array.from({ length: b.charCodeAt(0) - a.charCodeAt(0) + 1 }, (__, k) => String.fromCharCode(a.charCodeAt(0) + k)).join(''));
        const from = [...expand(e.from)];
        let to = [...expand(e.to)];
        if (!to.length && !e.flags.includes('d')) to = from;
        let count = 0;
        let out = '';
        // With s, a run of characters translated to the same one becomes one (untranslated ones stay).
        let last: string | undefined;
        for (const ch of str(this.ev(target))) {
          const i = from.indexOf(ch);
          if (i < 0) { out += ch; last = undefined; continue; }
          count++;
          // Without d, a short replacement list repeats its last character.
          const r = i < to.length ? to[i] : e.flags.includes('d') ? undefined : to[to.length - 1];
          if (r === undefined) continue;
          if (e.flags.includes('s') && r === last) continue;
          out += r;
          last = r;
        }
        if (e.flags.includes('r')) return out;
        this.lvalueSet(target, out);
        return count;
      }
      case 'un':
        if (e.op === '!') return truthy(this.ev(e.e)) ? '' : 1;
        return -num(this.ev(e.e));
      case 'cond': return truthy(this.ev(e.c)) ? this.ev(e.a) : this.ev(e.b);
      case 'incr': {
        const old = this.ev(e.e);
        const nv = num(old) + (e.op === '++' ? 1 : -1);
        this.lvalueSet(e.e, nv);
        return e.pre ? nv : num(old);
      }
      case 'assign': {
        if (e.op === '=') {
          if (e.l.k === 'array') { this.arrays.set(e.l.name, this.list(e.r)); return this.arr(e.l.name).length; }
          if (e.l.k === 'list') throw new Unsupported('list assignment');
          return this.lvalueSet(e.l, this.ev(e.r));
        }
        const cur = this.ev(e.l);
        if (e.op === '||=') return truthy(cur) ? cur : this.lvalueSet(e.l, this.ev(e.r));
        if (e.op === '//=') return cur !== undefined ? cur : this.lvalueSet(e.l, this.ev(e.r));
        if (e.op === '&&=') return !truthy(cur) ? cur : this.lvalueSet(e.l, this.ev(e.r));
        return this.lvalueSet(e.l, this.binop(e.op.slice(0, -1), cur, this.ev(e.r)));
      }
      case 'bin':
        if (e.op === '..') throw new Unsupported('flip-flop');
        if (e.op === '&&') { const l = this.ev(e.l); return truthy(l) ? this.ev(e.r) : l; }
        if (e.op === '||') { const l = this.ev(e.l); return truthy(l) ? l : this.ev(e.r); }
        if (e.op === '//') { const l = this.ev(e.l); return l !== undefined ? l : this.ev(e.r); }
        return this.binop(e.op, this.ev(e.l), this.ev(e.r));
      case 'call': return this.call(e);
    }
  }

  private binop(op: string, a: V, b: V): V {
    switch (op) {
      case '+': return num(a) + num(b);
      case '-': return num(a) - num(b);
      case '*': return num(a) * num(b);
      case '/': if (num(b) === 0) throw new Unsupported('division by zero'); return num(a) / num(b);
      case '%': if (Math.trunc(num(b)) === 0) throw new Unsupported('division by zero'); return ((Math.trunc(num(a)) % Math.trunc(num(b))) + Math.trunc(num(b))) % Math.trunc(num(b));
      case '**': return num(a) ** num(b);
      case '.': return str(a) + str(b);
      case 'x': return str(a).repeat(Math.max(0, Math.trunc(num(b))));
      case '==': return num(a) === num(b) ? 1 : '';
      case '!=': return num(a) !== num(b) ? 1 : '';
      case '<': return num(a) < num(b) ? 1 : '';
      case '>': return num(a) > num(b) ? 1 : '';
      case '<=': return num(a) <= num(b) ? 1 : '';
      case '>=': return num(a) >= num(b) ? 1 : '';
      case '<=>': return Math.sign(num(a) - num(b));
      case 'eq': return str(a) === str(b) ? 1 : '';
      case 'ne': return str(a) !== str(b) ? 1 : '';
      case 'lt': return str(a) < str(b) ? 1 : '';
      case 'gt': return str(a) > str(b) ? 1 : '';
      case 'le': return str(a) <= str(b) ? 1 : '';
      case 'ge': return str(a) >= str(b) ? 1 : '';
      // `cmp`
      default: return str(a) < str(b) ? -1 : str(a) > str(b) ? 1 : 0;
    }
  }

  private call(e: Extract<E, { k: 'call' }>): V {
    const a = e.args;
    const one = () => (a.length ? this.ev(a[0]) : this.scalar('_'));
    switch (e.name) {
      case 'print': case 'say': {
        const items = a.length ? a.flatMap((x) => this.list(x)) : [this.scalar('_')];
        this.out += items.map(str).join(str(this.scalars.get(','))) + (e.name === 'say' ? '\n' : str(this.scalars.get('\\')));
        return 1;
      }
      case 'printf': {
        const items = a.flatMap((x) => this.list(x));
        this.out += sprintf(str(items[0]), items.slice(1).map((v) => (typeof v === 'string' && /^\s*-?\d/.test(v) ? v : v) as never));
        return 1;
      }
      case 'sprintf': { const items = a.flatMap((x) => this.list(x)); return sprintf(str(items[0]), items.slice(1) as never); }
      case 'length': return a.length || this.scalar('_') !== undefined ? str(one()).length : undefined;
      case 'uc': return str(one()).toUpperCase();
      case 'lc': return str(one()).toLowerCase();
      case 'ucfirst': { const s = str(one()); return s.charAt(0).toUpperCase() + s.slice(1); }
      case 'lcfirst': { const s = str(one()); return s.charAt(0).toLowerCase() + s.slice(1); }
      case 'chomp': {
        const target = a[0] ?? { k: 'scalar', name: '_' } as E;
        const s = str(this.ev(target));
        if (s.endsWith('\n')) { this.lvalueSet(target, s.slice(0, -1)); return 1; }
        return 0;
      }
      case 'defined': return one() !== undefined ? 1 : '';
      case 'abs': return Math.abs(num(one()));
      case 'int': return Math.trunc(num(one()));
      case 'sqrt': return Math.sqrt(num(one()));
      case 'chr': return String.fromCharCode(num(one()));
      case 'ord': return str(one()).charCodeAt(0) || 0;
      case 'scalar': return a[0]?.k === 'array' ? this.arr(a[0].name).length : this.ev(a[0]);
      // reverse in scalar context reverses the string.
      case 'reverse': return [...(a.length ? a.flatMap((x) => this.list(x)).map(str).join('') : str(this.scalar('_')))].reverse().join('');
      case 'join': { const items = a.flatMap((x) => this.list(x)); return items.slice(1).map(str).join(str(items[0])); }
      case 'substr': {
        const s = str(this.ev(a[0]));
        let off = num(this.ev(a[1]));
        if (off < 0) off = s.length + off;
        return a[2] ? s.substr(off, num(this.ev(a[2]))) : s.slice(off);
      }
      case 'index': return str(this.ev(a[0])).indexOf(str(this.ev(a[1])));
      case 'exists': { const x = a[0]; if (x?.k !== 'helem') throw new Unsupported('exists'); return this.hash(x.name).has(str(this.ev(x.key))) ? 1 : ''; }
      case 'delete': { const x = a[0]; if (x?.k !== 'helem') throw new Unsupported('delete'); const k = str(this.ev(x.key)); const v = this.hash(x.name).get(k); this.hash(x.name).delete(k); return v; }
      case 'push': { if (a[0]?.k !== 'array') throw new Unsupported('push'); const arr = this.arr(a[0].name); arr.push(...a.slice(1).flatMap((x) => this.list(x))); return arr.length; }
      case 'keys': return this.hashOf(a[0]).size;
      case 'split': return this.split(e).length;
      case 'next': throw new NextSig();
      case 'last': throw new LastSig();
    }
    throw new Unsupported(`function ${e.name}`);
  }

  exec(s: S): void {
    this.tick();
    switch (s.k) {
      case 'expr': this.ev(s.e); return;
      case 'next': throw new NextSig();
      case 'last': throw new LastSig();
      case 'if': {
        const c = truthy(this.ev(s.c));
        if (c !== !!s.unless) s.t.forEach((x) => this.exec(x));
        else s.f?.forEach((x) => this.exec(x));
        return;
      }
      case 'for': {
        const items = this.list(s.list);
        const name = s.v ?? '_';
        const save = this.scalars.get(name);
        try {
          for (const it of items) {
            this.scalars.set(name, it);
            // `next` goes on with the next item.
            try {
              s.body.forEach((x) => this.exec(x));
            } catch (sig) {
              if (!(sig instanceof NextSig)) throw sig;
            }
          }
        } catch (sig) {
          if (!(sig instanceof LastSig)) throw sig;
        } finally {
          this.scalars.set(name, save);
        }
      }
    }
  }
}

// ---------------------------------------------------------------- running

export interface PerlOptions {
  loop?: 'n' | 'p';
  chompL?: boolean;
  autosplit?: boolean;
  fieldSep?: string;
}

/** Parse perl's command-line switches; the code comes from -e/-E (joined with newlines). */
export function perlOptions(words: (string | undefined)[]): { opts: PerlOptions; code: string } | undefined {
  const opts: PerlOptions = {};
  const code: string[] = [];
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    if (w === undefined) return undefined;
    if (!w.startsWith('-') || w === '-') break;
    if (w === '--') break;
    for (let k = 1; k < w.length; k++) {
      const c = w[k];
      if (c === 'e' || c === 'E') {
        const v = k + 1 < w.length ? w.slice(k + 1) : words[++i];
        if (v === undefined) return undefined;
        code.push(v);
        break;
      }
      if (c === 'n') opts.loop = opts.loop ?? 'n';
      else if (c === 'p') opts.loop = 'p';
      else if (c === 'l') { opts.chompL = true; if (/^\d/.test(w.slice(k + 1))) return undefined; }
      else if (c === 'a') { opts.autosplit = true; opts.loop = opts.loop ?? 'n'; }
      else if (c === 'F') {
        // -F implies -a and -n (perl 5.20+).
        opts.fieldSep = w.slice(k + 1).replace(/^\/(.*)\/$/, '$1').replace(/^(['"])(.*)\1$/, '$2');
        opts.autosplit = true;
        opts.loop = opts.loop ?? 'n';
        break;
      } else if (c === 'i') { break; }
      else if (c === 'w') continue;
      else return undefined;
    }
  }
  return code.length ? { opts, code: code.join('\n') } : undefined;
}

/** Run perl one-liner code over input lines. */
export function runPerl(code: string, opts: PerlOptions, input: string[]): string[] | undefined {
  let prog;
  try {
    prog = new Parser(lex(code)).program();
  } catch (e) {
    if (e instanceof Unsupported) return undefined;
    // A bug in the parser: let it show.
    /* c8 ignore next */
    throw e;
  }
  const it = new Interp();
  it.scalars.set(',', '');
  it.scalars.set('\\', opts.chompL ? '\n' : '');
  const sep = opts.fieldSep !== undefined ? toJsRegex(opts.fieldSep, 'pcre') : undefined;
  if (opts.fieldSep !== undefined && !sep) return undefined;
  try {
    const run = (ss: S[]) => ss.forEach((s) => it.exec(s));
    run(prog.begin);
    if (opts.loop) {
      for (const [k, line] of input.entries()) {
        it.scalars.set('.', k + 1);
        it.scalars.set('_', opts.chompL ? line : line + '\n');
        if (opts.autosplit) {
          // perl splits $_, with its newline unless -l removed it (a blank, for the default split).
          const parts = sep ? (opts.chompL ? line : line + '\n').split(new RegExp(sep.source, sep.flags)) : line.replace(/^\s+/, '').split(/\s+/);
          while (parts.length && parts[parts.length - 1] === '') parts.pop();
          it.arrays.set('F', parts);
        }
        try {
          run(prog.main);
        } catch (sig) {
          // `last` leaves the loop (END still runs; with -p the line is not printed), `next` goes on.
          if (sig instanceof LastSig) break;
          if (!(sig instanceof NextSig)) throw sig;
        }
        if (opts.loop === 'p') it.out += str(it.scalars.get('_')) + str(it.scalars.get('\\'));
      }
    } else {
      run(prog.main);
    }
    run(prog.end);
  } catch (e) {
    if (e instanceof Unsupported || e instanceof NextSig || e instanceof LastSig) return undefined;
    // A bug in the runner: let it show.
    /* c8 ignore next */
    throw e;
  }
  if (it.out === '') return [];
  const lines = it.out.split('\n');
  if (lines[lines.length - 1] === '') lines.pop();
  return lines;
}

// ---------------------------------------------------------------- example input

/** Input lines that exercise the code: fields of @F around numeric thresholds, regex matches, repeats for counting. */
export function perlExample(code: string, opts: PerlOptions): { input: string[]; output: string[] } | undefined {
  if (!opts.loop) {
    const output = runPerl(code, opts, []);
    return output && { input: [], output };
  }
  let toks: Tok[];
  try {
    toks = lex(code);
  } catch {
    return undefined;
  }
  const regexes: { re: JsRegex; subst: boolean }[] = [];
  for (const t of toks) {
    if ((t.t === 're' || t.t === 'subst') && t.pat) {
      const re = toJsRegex(t.pat, 'pcre', { ignoreCase: t.flags?.includes('i') });
      if (re) regexes.push({ re, subst: t.t === 'subst' });
    }
  }
  // $F[n] and the numbers they are compared with.
  const fieldUse = [...code.matchAll(/\$F\[(\d+)\]/g)].map((m) => Number(m[1]));
  const thresholds = new Map<number, number>();
  for (const m of code.matchAll(/\$F\[(\d+)\]\s*(?:[<>]=?|==|!=)\s*(-?\d+(?:\.\d+)?)/g)) thresholds.set(Number(m[1]), Number(m[2]));
  for (const m of code.matchAll(/\$F\[(\d+)\]\s*(?:[-+*/]|\+=)|(?:\+=|[-+*/])\s*\$F\[(\d+)\]/g)) { const f = Number(m[1] ?? m[2]); if (!thresholds.has(f)) thresholds.set(f, NaN); }
  const counts = /\$\w+\{[^}]+\}\s*\+\+|\+\+\s*\$\w+\{/.test(code);
  // `$sum += $_`, `$_ > 10`: the lines themselves are numbers.
  const numericLines = /(?:[-+*\/]=?|[<>]=?|==)\s*\$_\b|\$_\s*(?:[-+*\/<>]|==)/.test(code);
  // split /,/: lines need the separator.
  const splitRe = toks.findIndex((t, i) => t.t === 're' && toks[i - 1]?.t === 'word' && toks[i - 1].v === 'split');
  let input: string[];
  if (numericLines && !opts.autosplit && !fieldUse.length) {
    input = ['3', '12', '7', '25'];
  } else if (splitRe >= 0 && !opts.autosplit) {
    const re = toJsRegex(toks[splitRe].pat!, 'pcre');
    const sep = re && regexExamples(re, 3)?.matching.find((x) => !/^abc |\sxyz$/.test(x));
    if (!sep) return undefined;
    input = [['apple', 'red', 'tokyo'], ['banana', 'yellow', 'osaka'], ['cherry', 'green', 'kyoto']].map((r) => r.join(sep));
  } else if (opts.autosplit || fieldUse.length) {
    const cols = Math.max(3, ...fieldUse.map((f) => f + 1));
    const sep = opts.fieldSep && opts.fieldSep.length === 1 ? opts.fieldSep : opts.fieldSep ? (/^\\s/.test(opts.fieldSep) ? ' ' : opts.fieldSep[0]) : ' ';
    const words = [['apple', 'banana', 'cherry', 'grape'], ['red', 'yellow', 'green', 'purple'], ['tokyo', 'osaka', 'kyoto', 'nara']];
    input = [0, 1, 2, 3].map((r) => Array.from({ length: cols }, (_, c) => {
      if (thresholds.has(c)) {
        const t = thresholds.get(c)!;
        if (Number.isNaN(t)) return String([3, 12, 7, 25][r]);
        return String(t === 0 ? [-2, 3, 5, 0][r] : Math.round(t * [0.8, 1.2, 1.5, 0.5][r]));
      }
      return words[c % 3][r];
    }).join(sep));
  } else {
    const lines: string[] = [];
    for (const { re, subst } of regexes) {
      const ex = regexExamples(re, 3);
      if (!ex) continue;
      const m = ex.matching.find((x) => !/^abc |\sxyz$/.test(x)) ?? ex.matching[0];
      const second = ex.matching.find((x) => x !== m && !/^abc |\sxyz$/.test(x)) ?? m;
      const atStart = re.source.startsWith('^');
      const atEnd = re.source.endsWith('$') && !re.source.endsWith('\\$');
      // Two matches show what /g changes; anchored patterns get text around them.
      lines.push(!subst ? m : !atStart && !atEnd ? `${m} ${second}` : atStart && !atEnd ? `${m}text` : !atStart ? `text${m}` : m);
    }
    input = ['line one', ...lines, 'line two'];
  }
  // Every kind of input has at least two lines.
  if (counts) input.push(input[1]);
  const output = runPerl(code, opts, input);
  return output && { input, output: output.length > 8 ? [...output.slice(0, 7), '…'] : output };
}
