import { lex, Lex, ParseError } from '../embedded/jq';

/** Raised for jq features the example runner does not implement; no example is shown then. */
class Unsupported extends Error {}

export type Json = null | boolean | number | string | Json[] | { [k: string]: Json };

// ---------------------------------------------------------------- AST

type Node =
  | { t: 'id' } | { t: 'recurse' }
  | { t: 'field'; base: Node; name: string; opt?: boolean }
  | { t: 'index'; base: Node; idx: Node; opt?: boolean }
  | { t: 'slice'; base: Node; from?: Node; to?: Node; opt?: boolean }
  | { t: 'iter'; base: Node; opt?: boolean }
  | { t: 'try'; body: Node; catch?: Node }
  | { t: 'lit'; v: Json }
  | { t: 'str'; parts: (string | Node)[]; fmt?: string }
  | { t: 'fmt'; name: string }
  | { t: 'var'; name: string }
  | { t: 'pipe'; l: Node; r: Node }
  | { t: 'comma'; l: Node; r: Node }
  | { t: 'alt'; l: Node; r: Node }
  | { t: 'bin'; op: string; l: Node; r: Node }
  | { t: 'assign'; op: string; l: Node; r: Node }
  | { t: 'neg'; e: Node }
  | { t: 'array'; e?: Node }
  | { t: 'object'; entries: { key: Node; value: Node }[] }
  | { t: 'call'; name: string; args: Node[] }
  | { t: 'if'; branches: [Node, Node][]; else?: Node }
  | { t: 'reduce'; src: Node; v: string; init: Node; update: Node }
  | { t: 'foreach'; src: Node; v: string; init: Node; update: Node; extract?: Node }
  | { t: 'as'; src: Node; v: string; body: Node }
  | { t: 'def'; name: string; params: string[]; body: Node; rest: Node };

class Parser {
  private p = 0;
  constructor(private src: string, private toks: Lex[]) {}

  get done(): boolean {
    return this.p >= this.toks.length;
  }

  private peek(text?: string): Lex | undefined {
    const t = this.toks[this.p];
    return text === undefined || (t?.text === text && t.type !== 'str') ? t : undefined;
  }

  private next(): Lex {
    const t = this.toks[this.p++];
    if (!t) throw new Unsupported('end');
    return t;
  }

  private expect(text: string): Lex {
    const t = this.next();
    if (t.text !== text) throw new Unsupported(`expected ${text}`);
    return t;
  }

  pipe(): Node {
    if (this.peek('def')) {
      this.p++;
      const name = this.next().text;
      const params: string[] = [];
      if (this.peek('(')) {
        this.p++;
        while (!this.peek(')')) {
          const t = this.next();
          if (t.text !== ';') params.push(t.text);
        }
        this.p++;
      }
      this.expect(':');
      const body = this.pipe();
      this.expect(';');
      return { t: 'def', name, params, body, rest: this.pipe() };
    }
    const l = this.comma();
    if (this.peek('as')) {
      this.p++;
      const v = this.next();
      if (v.type !== 'var') throw new Unsupported('destructuring');
      this.expect('|');
      return { t: 'as', src: l, v: v.text, body: this.pipe() };
    }
    if (this.peek('|')) {
      this.p++;
      return { t: 'pipe', l, r: this.pipe() };
    }
    return l;
  }

  private comma(): Node {
    let l = this.alt();
    while (this.peek(',')) {
      this.p++;
      l = { t: 'comma', l, r: this.alt() };
    }
    return l;
  }

  private alt(): Node {
    const l = this.assign();
    if (this.peek('?//')) throw new Unsupported('?//');
    if (!this.peek('//')) return l;
    this.p++;
    return { t: 'alt', l, r: this.alt() };
  }

  private assign(): Node {
    const l = this.or();
    const t = this.peek();
    if (t?.type === 'op' && ['=', '|=', '+=', '-=', '*=', '/=', '%=', '//='].includes(t.text)) {
      this.p++;
      return { t: 'assign', op: t.text, l, r: this.alt() };
    }
    return l;
  }

  private or(): Node {
    let l = this.and();
    while (this.peek('or')) {
      this.p++;
      l = { t: 'bin', op: 'or', l, r: this.and() };
    }
    return l;
  }

  private and(): Node {
    let l = this.compare();
    while (this.peek('and')) {
      this.p++;
      l = { t: 'bin', op: 'and', l, r: this.compare() };
    }
    return l;
  }

  private compare(): Node {
    const l = this.additive();
    const t = this.peek();
    if (t?.type === 'op' && ['==', '!=', '<', '<=', '>', '>='].includes(t.text)) {
      this.p++;
      return { t: 'bin', op: t.text, l, r: this.additive() };
    }
    return l;
  }

  private additive(): Node {
    let l = this.mult();
    while (this.peek('+') || this.peek('-')) {
      const op = this.next().text;
      l = { t: 'bin', op, l, r: this.mult() };
    }
    return l;
  }

  private mult(): Node {
    let l = this.unary();
    while (this.peek('*') || this.peek('/') || this.peek('%')) {
      const op = this.next().text;
      l = { t: 'bin', op, l, r: this.unary() };
    }
    return l;
  }

  private unary(): Node {
    if (this.peek('-')) {
      this.p++;
      return { t: 'neg', e: this.postfix() };
    }
    return this.postfix();
  }

  private postfix(): Node {
    let n = this.term();
    for (;;) {
      const t = this.toks[this.p];
      if (!t) return n;
      const prevEnd = this.toks[this.p - 1].end;
      const adjacent = t.start === prevEnd;
      if (t.type === 'field' && adjacent) {
        this.p++;
        n = { t: 'field', base: n, name: fieldName(t.text) };
      } else if (t.text === '.' && t.type === 'op' && this.toks[this.p + 1]?.text === '[' && adjacent) {
        this.p++;
      } else if (t.text === '[' && t.type === 'op' && adjacent) {
        n = this.bracket(n);
      } else if (t.text === '?' && t.type === 'op') {
        // After `( … )` the `?` covers the whole group, like try; after a path step only that step.
        const afterGroup = this.toks[this.p - 1].text === ')';
        this.p++;
        n = !afterGroup && (n.t === 'field' || n.t === 'index' || n.t === 'slice' || n.t === 'iter') ? { ...n, opt: true } : { t: 'try', body: n };
      } else return n;
    }
  }

  private bracket(base: Node): Node {
    this.expect('[');
    if (this.peek(']')) {
      this.p++;
      return { t: 'iter', base };
    }
    // Slices: [a:b], [:b], [a:].
    if (this.peek(':')) {
      this.p++;
      const to = this.pipe();
      this.expect(']');
      return { t: 'slice', base, to };
    }
    const idx = this.pipe();
    if (this.peek(':')) {
      this.p++;
      const to = this.peek(']') ? undefined : this.pipe();
      this.expect(']');
      return { t: 'slice', base, from: idx, to };
    }
    this.expect(']');
    return { t: 'index', base, idx };
  }

  private term(): Node {
    const t = this.next();
    switch (t.type) {
      case 'num': return { t: 'lit', v: Number(t.text) };
      case 'str': return { t: 'str', parts: this.stringParts(t) };
      case 'var': return { t: 'var', name: t.text };
      case 'field': return { t: 'field', base: { t: 'id' }, name: fieldName(t.text) };
      case 'fmt':
        if (this.peek()?.type === 'str') return { t: 'str', parts: this.stringParts(this.next()), fmt: t.text };
        return { t: 'fmt', name: t.text };
      case 'ident': {
        if (t.text === 'true' || t.text === 'false') return { t: 'lit', v: t.text === 'true' };
        if (t.text === 'null') return { t: 'lit', v: null };
        const args: Node[] = [];
        if (this.peek('(') && this.toks[this.p].start === t.end) {
          this.p++;
          for (;;) {
            args.push(this.pipe());
            const sep = this.next();
            if (sep.text === ')') break;
            if (sep.text !== ';') throw new Unsupported('args');
          }
        }
        return { t: 'call', name: t.text, args };
      }
      case 'kw':
        return this.keyword(t);
    }
    switch (t.text) {
      case '.': return { t: 'id' };
      case '..': return { t: 'recurse' };
      case '(': {
        const e = this.pipe();
        this.expect(')');
        return e;
      }
      case '[': {
        if (this.peek(']')) { this.p++; return { t: 'array' }; }
        const e = this.pipe();
        this.expect(']');
        return { t: 'array', e };
      }
      case '{': return this.object();
      case '-': return { t: 'neg', e: this.postfix() };
    }
    throw new Unsupported(`unexpected ${t.text}`);
  }

  private stringParts(t: Lex): (string | Node)[] {
    const body = t.text.slice(1, -1);
    const parts: (string | Node)[] = [];
    let lit = '';
    for (let i = 0; i < body.length; i++) {
      if (body[i] === '\\' && body[i + 1] === '(') {
        let depth = 1;
        let j = i + 2;
        while (j < body.length && depth > 0) {
          if (body[j] === '(') depth++;
          else if (body[j] === ')') depth--;
          j++;
        }
        if (lit) parts.push(JSON.parse(`"${lit}"`));
        lit = '';
        const inner = body.slice(i + 2, j - 1);
        const p = new Parser(inner, lex(inner));
        parts.push(p.pipe());
        i = j - 1;
        continue;
      }
      if (body[i] === '\\') { lit += body.slice(i, i + 2); i++; continue; }
      lit += body[i];
    }
    if (lit) parts.push(JSON.parse(`"${lit}"`));
    return parts;
  }

  private object(): Node {
    const entries: { key: Node; value: Node }[] = [];
    while (!this.peek('}')) {
      const k = this.next();
      let key: Node;
      let value: Node | undefined;
      if (k.type === 'var') {
        key = { t: 'lit', v: k.text.slice(1) };
        value = { t: 'var', name: k.text };
      } else if (k.type === 'str') {
        key = { t: 'str', parts: this.stringParts(k) };
      } else if (k.text === '(') {
        key = this.pipe();
        this.expect(')');
      } else if (k.type === 'ident' || k.type === 'kw') {
        key = { t: 'lit', v: k.text };
      } else throw new Unsupported('object key');
      if (this.peek(':')) {
        this.p++;
        value = this.objectValue();
      }
      if (!value) {
        // `{name}` is `{name: .name}`.
        if (key.t !== 'lit' && key.t !== 'str') throw new Unsupported('object shorthand');
        const name = key.t === 'lit' ? String(key.v) : (key.parts.length === 1 && typeof key.parts[0] === 'string' ? key.parts[0] : undefined);
        if (name === undefined) throw new Unsupported('object shorthand');
        value = { t: 'field', base: { t: 'id' }, name };
      }
      entries.push({ key, value });
      if (this.peek(',')) this.p++;
      else if (!this.peek('}')) throw new Unsupported('object');
    }
    this.p++;
    return { t: 'object', entries };
  }

  /** Object values stop at `,` and `}`; a pipe needs parentheses there. */
  private objectValue(): Node {
    let v = this.alt();
    while (this.peek('|')) {
      this.p++;
      v = { t: 'pipe', l: v, r: this.alt() };
    }
    return v;
  }

  private keyword(t: Lex): Node {
    switch (t.text) {
      case 'if': {
        const branches: [Node, Node][] = [];
        let c = this.pipe();
        this.expect('then');
        branches.push([c, this.pipe()]);
        let els: Node | undefined;
        for (;;) {
          if (this.peek('elif')) {
            this.p++;
            c = this.pipe();
            this.expect('then');
            branches.push([c, this.pipe()]);
          } else if (this.peek('else')) {
            this.p++;
            els = this.pipe();
          } else break;
        }
        this.expect('end');
        return { t: 'if', branches, else: els };
      }
      case 'reduce':
      case 'foreach': {
        const src = this.postfix();
        this.expect('as');
        const v = this.next();
        if (v.type !== 'var') throw new Unsupported('destructuring');
        this.expect('(');
        const init = this.pipe();
        this.expect(';');
        const update = this.pipe();
        let extract: Node | undefined;
        if (this.peek(';')) {
          this.p++;
          extract = this.pipe();
        }
        this.expect(')');
        return t.text === 'reduce' ? { t: 'reduce', src, v: v.text, init, update } : { t: 'foreach', src, v: v.text, init, update, extract };
      }
      case 'try': {
        const body = this.postfix();
        if (this.peek('catch')) {
          this.p++;
          return { t: 'try', body, catch: this.postfix() };
        }
        return { t: 'try', body };
      }
    }
    throw new Unsupported(t.text);
  }
}

function fieldName(text: string): string {
  const name = text.slice(1);
  return name.startsWith('"') ? JSON.parse(name) : name;
}

export function parseJq(src: string): Node | undefined {
  try {
    const toks = lex(src);
    const p = new Parser(src, toks);
    const n = p.pipe();
    return p.done ? n : undefined;
  } catch (e) {
    if (e instanceof Unsupported || e instanceof ParseError || e instanceof SyntaxError) return undefined;
    throw e;
  }
}

// ---------------------------------------------------------------- values

class JqError extends Error {
  constructor(readonly value: Json) {
    super(typeof value === 'string' ? value : JSON.stringify(value));
  }
}

type Obj = { [k: string]: Json };
const isObj = (v: Json): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);

function typeName(v: Json): string {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  return typeof v === 'object' ? 'object' : typeof v;
}

const ORDER = ['null', 'boolean', 'number', 'string', 'array', 'object'];

/** jq's total order: null < false < true < numbers < strings < arrays < objects. */
function cmp(a: Json, b: Json): number {
  const ta = ORDER.indexOf(typeName(a));
  const tb = ORDER.indexOf(typeName(b));
  if (ta !== tb) return ta - tb;
  if (typeof a === 'boolean' || typeof a === 'number') return Number(a) - Number(b as number);
  if (typeof a === 'string') return a < (b as string) ? -1 : a > (b as string) ? 1 : 0;
  if (Array.isArray(a)) {
    const bb = b as Json[];
    for (let i = 0; i < Math.min(a.length, bb.length); i++) {
      const c = cmp(a[i], bb[i]);
      if (c) return c;
    }
    return a.length - bb.length;
  }
  if (isObj(a)) {
    const bo = b as Obj;
    const ka = Object.keys(a).sort();
    const kb = Object.keys(bo).sort();
    const c = cmp(ka, kb);
    if (c) return c;
    for (const k of ka) {
      const d = cmp(a[k], bo[k]);
      if (d) return d;
    }
  }
  return 0;
}

const truthy = (v: Json) => v !== null && v !== false;

function add(a: Json, b: Json): Json {
  if (a === null) return b;
  if (b === null) return a;
  if (typeof a === 'number' && typeof b === 'number') return a + b;
  if (typeof a === 'string' && typeof b === 'string') return a + b;
  if (Array.isArray(a) && Array.isArray(b)) return [...a, ...b];
  if (isObj(a) && isObj(b)) return { ...a, ...b };
  throw new JqError(`${typeName(a)} and ${typeName(b)} cannot be added`);
}

function arith(op: string, a: Json, b: Json): Json {
  switch (op) {
    case '+': return add(a, b);
    case '-':
      if (typeof a === 'number' && typeof b === 'number') return a - b;
      if (Array.isArray(a) && Array.isArray(b)) return a.filter((x) => !b.some((y) => cmp(x, y) === 0));
      break;
    case '*':
      if (typeof a === 'number' && typeof b === 'number') return a * b;
      if (isObj(a) && isObj(b)) return deepMerge(a, b);
      if (typeof a === 'string' && typeof b === 'number') return b > 0 ? a.repeat(Math.ceil(b)) : null;
      break;
    case '/':
      if (typeof a === 'number' && typeof b === 'number') {
        if (b === 0) throw new JqError(`${a} and ${b} cannot be divided because the divisor is zero`);
        return a / b;
      }
      if (typeof a === 'string' && typeof b === 'string') return a.split(b);
      break;
    case '%':
      if (typeof a === 'number' && typeof b === 'number') {
        if (Math.trunc(b) === 0) throw new JqError(`${a} and ${b} cannot be divided because the divisor is zero`);
        return Math.trunc(a) % Math.trunc(b);
      }
      break;
  }
  throw new JqError(`${typeName(a)} and ${typeName(b)} cannot be ${op === '-' ? 'subtracted' : op === '*' ? 'multiplied' : 'divided'}`);
}

function deepMerge(a: Obj, b: Obj): Obj {
  const out: Obj = { ...a };
  for (const [k, v] of Object.entries(b)) out[k] = isObj(out[k]) && isObj(v) ? deepMerge(out[k] as Obj, v) : v;
  return out;
}

/** Compact JSON as `jq -c` prints it. */
export function toJson(v: Json): string {
  return JSON.stringify(v);
}

function contains(a: Json, b: Json): boolean {
  if (typeName(a) !== typeName(b)) throw new JqError(`${typeName(a)} and ${typeName(b)} cannot have their containment checked`);
  if (typeof a === 'string') return a.includes(b as string);
  if (Array.isArray(a)) return (b as Json[]).every((x) => a.some((y) => typeName(x) === typeName(y) && contains(y, x)));
  if (isObj(a)) return Object.entries(b as Obj).every(([k, v]) => k in a && typeName(a[k]) === typeName(v) && contains(a[k], v));
  return cmp(a, b) === 0;
}

// ---------------------------------------------------------------- evaluator

type Path = (string | number | { start: number | null; end: number | null })[];

interface Env {
  vars: Map<string, Json>;
  funcs: Map<string, { params: string[]; body: Node; env: Env }>;
  /** Closure arguments of the user function being run. */
  closures?: Map<string, { node: Node; env: Env }>;
}

class Evaluator {
  private steps = 0;

  private tick(): void {
    if (++this.steps > 100000) throw new Unsupported('too many steps');
  }

  ev(n: Node, x: Json, env: Env): Json[] {
    this.tick();
    switch (n.t) {
      case 'id': return [x];
      case 'recurse': return this.recurse(x);
      case 'lit': return [n.v];
      case 'var': {
        if (!env.vars.has(n.name)) throw new Unsupported(`variable ${n.name}`);
        return [env.vars.get(n.name)!];
      }
      case 'field': return this.ev(n.base, x, env).flatMap((b) => this.opt(n.opt, () => [this.field(b, n.name)]));
      case 'index':
        return this.ev(n.base, x, env).flatMap((b) => this.ev(n.idx, x, env).flatMap((i) => this.opt(n.opt, () => [this.index(b, i)])));
      case 'slice':
        return this.ev(n.base, x, env).flatMap((b) => this.opt(n.opt, () => {
          const from = n.from ? this.ev(n.from, x, env)[0] : null;
          const to = n.to ? this.ev(n.to, x, env)[0] : null;
          return [this.slice(b, from, to)];
        }));
      case 'iter': return this.ev(n.base, x, env).flatMap((b) => this.opt(n.opt, () => this.iterate(b)));
      case 'try':
        try {
          return this.ev(n.body, x, env);
        } catch (e) {
          if (!(e instanceof JqError)) throw e;
          return n.catch ? this.ev(n.catch, e.value, env) : [];
        }
      case 'str': {
        let outs = [''];
        for (const part of n.parts) {
          if (typeof part === 'string') { outs = outs.map((o) => o + part); continue; }
          const vals = this.ev(part, x, env).map((v) => (n.fmt ? this.format(n.fmt, v) : typeof v === 'string' ? v : toJson(v)));
          outs = outs.flatMap((o) => vals.map((v) => o + v));
        }
        return outs;
      }
      case 'fmt': return [this.format(n.name, x)];
      case 'pipe': return this.ev(n.l, x, env).flatMap((y) => this.ev(n.r, y, env));
      case 'comma': return [...this.ev(n.l, x, env), ...this.ev(n.r, x, env)];
      case 'alt': {
        let left: Json[] = [];
        try {
          left = this.ev(n.l, x, env).filter(truthy);
        } catch (e) {
          if (!(e instanceof JqError)) throw e;
        }
        return left.length ? left : this.ev(n.r, x, env);
      }
      case 'neg': return this.ev(n.e, x, env).map((v) => {
        if (typeof v !== 'number') throw new JqError(`${typeName(v)} cannot be negated`);
        return -v;
      });
      case 'bin': {
        if (n.op === 'and' || n.op === 'or') {
          return this.ev(n.l, x, env).flatMap((a) => {
            if (n.op === 'and' && !truthy(a)) return [false];
            if (n.op === 'or' && truthy(a)) return [true];
            return this.ev(n.r, x, env).map(truthy);
          });
        }
        // jq evaluates the right operand first, then the left, and outputs every combination.
        return this.ev(n.r, x, env).flatMap((b) => this.ev(n.l, x, env).map((a) => {
          switch (n.op) {
            case '==': return cmp(a, b) === 0;
            case '!=': return cmp(a, b) !== 0;
            case '<': return cmp(a, b) < 0;
            case '<=': return cmp(a, b) <= 0;
            case '>': return cmp(a, b) > 0;
            case '>=': return cmp(a, b) >= 0;
            default: return arith(n.op, a, b);
          }
        }));
      }
      case 'array': return [n.e ? this.ev(n.e, x, env) : []];
      case 'object': {
        let outs: Obj[] = [{}];
        for (const { key, value } of n.entries) {
          const keys = this.ev(key, x, env);
          const vals = this.ev(value, x, env);
          outs = outs.flatMap((o) => keys.flatMap((k) => {
            if (typeof k !== 'string') throw new JqError(`Object keys must be strings`);
            return vals.map((v) => ({ ...o, [k]: v }));
          }));
        }
        return outs;
      }
      case 'if': {
        const run = (i: number, y: Json): Json[] => {
          if (i >= n.branches.length) return n.else ? this.ev(n.else, y, env) : [y];
          const [c, then] = n.branches[i];
          return this.ev(c, y, env).flatMap((cv) => (truthy(cv) ? this.ev(then, y, env) : run(i + 1, y)));
        };
        return run(0, x);
      }
      case 'reduce': {
        let accs = this.ev(n.init, x, env);
        for (const item of this.ev(n.src, x, env)) {
          const inner = { ...env, vars: new Map(env.vars).set(n.v, item) };
          accs = accs.flatMap((a) => this.ev(n.update, a, inner)).slice(-1);
        }
        return accs;
      }
      case 'foreach': {
        let accs = this.ev(n.init, x, env);
        const out: Json[] = [];
        for (const item of this.ev(n.src, x, env)) {
          const inner = { ...env, vars: new Map(env.vars).set(n.v, item) };
          accs = accs.flatMap((a) => this.ev(n.update, a, inner));
          for (const a of accs) out.push(...(n.extract ? this.ev(n.extract, a, inner) : [a]));
        }
        return out;
      }
      case 'as':
        return this.ev(n.src, x, env).flatMap((v) => this.ev(n.body, x, { ...env, vars: new Map(env.vars).set(n.v, v) }));
      case 'def': {
        const inner: Env = { ...env, funcs: new Map(env.funcs) };
        inner.funcs.set(`${n.name}/${n.params.length}`, { params: n.params, body: n.body, env: inner });
        return this.ev(n.rest, x, inner);
      }
      case 'assign': return [this.assign(n, x, env)];
      case 'call': return this.call(n, x, env);
    }
  }

  private opt(optional: boolean | undefined, f: () => Json[]): Json[] {
    if (!optional) return f();
    try {
      return f();
    } catch (e) {
      if (e instanceof JqError) return [];
      throw e;
    }
  }

  private field(b: Json, name: string): Json {
    if (b === null) return null;
    if (!isObj(b)) throw new JqError(`Cannot index ${typeName(b)} with "${name}"`);
    return name in b ? b[name] : null;
  }

  private index(b: Json, i: Json): Json {
    if (typeof i === 'string') return this.field(b, i);
    if (b === null) return null;
    if (typeof i === 'number' && Array.isArray(b)) {
      const k = Math.floor(i < 0 ? b.length + i : i);
      return b[k] ?? null;
    }
    throw new JqError(`Cannot index ${typeName(b)} with ${typeName(i)}`);
  }

  private slice(b: Json, from: Json, to: Json): Json {
    if (b === null) return null;
    if (!Array.isArray(b) && typeof b !== 'string') throw new JqError(`Cannot index ${typeName(b)} with object`);
    const len = b.length;
    const norm = (v: Json, d: number) => {
      if (v === null) return d;
      const n = Math.floor(v as number);
      return Math.max(0, Math.min(len, n < 0 ? len + n : n));
    };
    return b.slice(norm(from, 0), norm(to, len)) as Json;
  }

  private iterate(b: Json): Json[] {
    if (Array.isArray(b)) return b;
    if (isObj(b)) return Object.values(b);
    throw new JqError(`Cannot iterate over ${typeName(b)}`);
  }

  private recurse(x: Json): Json[] {
    const out: Json[] = [x];
    if (Array.isArray(x)) for (const v of x) out.push(...this.recurse(v));
    else if (isObj(x)) for (const v of Object.values(x)) out.push(...this.recurse(v));
    return out;
  }

  private format(name: string, v: Json): string {
    const text = typeof v === 'string' ? v : toJson(v);
    switch (name) {
      case '@text': return text;
      case '@json': return toJson(v);
      case '@base64': return Buffer.from(text, 'utf8').toString('base64');
      case '@base64d': return Buffer.from(text, 'base64').toString('utf8');
      case '@uri': return encodeURIComponent(text).replace(/[!'()*]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase());
      case '@html': return text.replace(/[<>&'"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&#39;', '"': '&quot;' }[c]!));
      case '@sh': {
        const q = (s: Json) => {
          if (typeof s === 'string') return `'${s.replace(/'/g, "'\\''")}'`;
          if (Array.isArray(s) || isObj(s)) throw new JqError(`${typeName(s)} can not be escaped for shell`);
          return toJson(s);
        };
        return Array.isArray(v) ? v.map(q).join(' ') : q(v);
      }
      case '@csv': case '@tsv': {
        if (!Array.isArray(v)) throw new JqError(`${typeName(v)} cannot be ${name.slice(1)}-formatted, only an array can be`);
        return v.map((c) => {
          if (typeof c === 'number') return String(c);
          if (typeof c === 'boolean') return String(c);
          if (c === null) return '';
          if (typeof c !== 'string') throw new JqError(`${typeName(c)} is not valid in a csv row`);
          return name === '@csv' ? `"${c.replace(/"/g, '""')}"` : c.replace(/\\/g, '\\\\').replace(/\t/g, '\\t').replace(/\n/g, '\\n').replace(/\r/g, '\\r');
        }).join(name === '@csv' ? ',' : '\t');
      }
    }
    throw new Unsupported(name);
  }

  // --- paths and assignment

  paths(n: Node, x: Json, env: Env): Path[] {
    this.tick();
    switch (n.t) {
      case 'id': return [[]];
      case 'field': return this.paths(n.base, x, env).flatMap((p) => this.opt2(n.opt, () => { this.field(this.getpath(x, p), n.name); return [[...p, n.name]]; }));
      case 'index': return this.paths(n.base, x, env).flatMap((p) => this.ev(n.idx, x, env).map((i) => {
        if (typeof i !== 'string' && typeof i !== 'number') throw new Unsupported('index path');
        return [...p, i];
      }));
      case 'iter': return this.paths(n.base, x, env).flatMap((p) => {
        const b = this.getpath(x, p);
        if (Array.isArray(b)) return b.map((_, i) => [...p, i]);
        if (isObj(b)) return Object.keys(b).map((k) => [...p, k]);
        if (b === null && n.opt) return [];
        throw new JqError(`Cannot iterate over ${typeName(b)}`);
      });
      case 'pipe': return this.paths(n.l, x, env).flatMap((p) => this.paths(n.r, this.getpath(x, p), env).map((q) => [...p, ...q]));
      case 'comma': return [...this.paths(n.l, x, env), ...this.paths(n.r, x, env)];
      case 'recurse': {
        const out: Path[] = [];
        const walk = (v: Json, p: Path) => {
          out.push(p);
          if (Array.isArray(v)) v.forEach((c, i) => walk(c, [...p, i]));
          else if (isObj(v)) Object.entries(v).forEach(([k, c]) => walk(c, [...p, k]));
        };
        walk(x, []);
        return out;
      }
      case 'if': {
        const run = (i: number): Path[] => {
          if (i >= n.branches.length) return n.else ? this.paths(n.else, x, env) : [[]];
          const [c, then] = n.branches[i];
          return this.ev(c, x, env).flatMap((cv) => (truthy(cv) ? this.paths(then, x, env) : run(i + 1)));
        };
        return run(0);
      }
      case 'call':
        if (n.name === 'select' && n.args.length === 1) return this.ev(n.args[0], x, env).some(truthy) ? [[]] : [];
        if (n.name === 'empty') return [];
        if (n.name === 'recurse' && !n.args.length) return this.paths({ t: 'recurse' }, x, env);
        if (n.name === 'first' && n.args.length === 1) return this.paths(n.args[0], x, env).slice(0, 1);
        break;
    }
    throw new Unsupported(`path of ${n.t}`);
  }

  private opt2(optional: boolean | undefined, f: () => Path[]): Path[] {
    try {
      return f();
    } catch (e) {
      if (optional && e instanceof JqError) return [];
      throw e;
    }
  }

  getpath(x: Json, p: Path): Json {
    let v = x;
    for (const k of p) {
      if (v === null) return null;
      if (typeof k === 'object') throw new Unsupported('slice path');
      v = typeof k === 'number' ? (Array.isArray(v) ? v[k < 0 ? v.length + k : k] ?? null : this.index(v, k)) : this.field(v, k);
    }
    return v;
  }

  setpath(x: Json, p: Path, value: Json): Json {
    if (!p.length) return value;
    const [k, ...rest] = p;
    if (typeof k === 'object') throw new Unsupported('slice path');
    if (typeof k === 'number') {
      const arr = x === null ? [] : Array.isArray(x) ? [...x] : (() => { throw new JqError(`Cannot index ${typeName(x)} with number`); })();
      const i = k < 0 ? arr.length + k : k;
      while (arr.length <= i) arr.push(null);
      arr[i] = this.setpath(arr[i], rest, value);
      return arr;
    }
    const obj = x === null ? {} : isObj(x) ? { ...x } : (() => { throw new JqError(`Cannot index ${typeName(x)} with "${k}"`); })();
    obj[k] = this.setpath(obj[k] ?? null, rest, value);
    return obj;
  }

  private delpaths(x: Json, paths: Path[]): Json {
    // Delete the longest paths first so indexes stay valid.
    const sorted = [...paths].sort((a, b) => cmp(b as Json[], a as Json[]));
    let v = x;
    for (const p of sorted) v = this.delpath(v, p);
    return v;
  }

  private delpath(x: Json, p: Path): Json {
    if (!p.length) return null;
    const [k, ...rest] = p;
    if (x === null) return null;
    if (typeof k === 'object') throw new Unsupported('slice path');
    if (!rest.length) {
      if (Array.isArray(x) && typeof k === 'number') return x.filter((_, i) => i !== (k < 0 ? x.length + k : k));
      if (isObj(x) && typeof k === 'string') {
        const { [k]: _, ...others } = x;
        return others;
      }
      throw new JqError(`Cannot delete field at ${typeName(x)} index`);
    }
    const child = this.getpath(x, [k]);
    return this.setpath(x, [k], this.delpath(child, rest));
  }

  private assign(n: Extract<Node, { t: 'assign' }>, x: Json, env: Env): Json {
    const paths = this.paths(n.l, x, env);
    if (n.op === '|=') {
      let v = x;
      for (const p of paths) {
        const out = this.ev(n.r, this.getpath(v, p), env);
        v = out.length ? this.setpath(v, p, out[0]) : this.delpath(v, p);
      }
      return v;
    }
    if (n.op === '=') {
      const rhs = this.ev(n.r, x, env);
      if (rhs.length !== 1) throw new Unsupported('= with several values');
      return paths.reduce((v, p) => this.setpath(v, p, rhs[0]), x);
    }
    const rhs = this.ev(n.r, x, env);
    if (rhs.length !== 1) throw new Unsupported('arithmetic update with several values');
    return paths.reduce((v, p) => {
      const cur = this.getpath(v, p);
      const nv = n.op === '//=' ? (truthy(cur) ? cur : rhs[0]) : arith(n.op.slice(0, -1), cur, rhs[0]);
      return this.setpath(v, p, nv);
    }, x);
  }

  // --- functions

  private call(n: Extract<Node, { t: 'call' }>, x: Json, env: Env): Json[] {
    const user = env.funcs.get(`${n.name}/${n.args.length}`);
    if (user) {
      const closures = new Map<string, { node: Node; env: Env }>();
      const vars = new Map(user.env.vars);
      user.params.forEach((p, i) => {
        if (p.startsWith('$')) {
          const vals = this.ev(n.args[i], x, env);
          if (vals.length !== 1) throw new Unsupported('$param with several values');
          vars.set(p, vals[0]);
          closures.set(p.slice(1), { node: { t: 'var', name: p }, env: { ...user.env, vars } });
        } else closures.set(p, { node: n.args[i], env });
      });
      return this.ev(user.body, x, { ...user.env, vars, closures, funcs: user.env.funcs });
    }
    const closure = env.closures?.get(n.name);
    if (closure && !n.args.length) return this.ev(closure.node, x, closure.env);
    const a = n.args;
    const one = (i: number) => {
      const v = this.ev(a[i], x, env);
      if (v.length !== 1) throw new Unsupported(`${n.name} argument with several values`);
      return v[0];
    };
    const arr = (v: Json, what = n.name): Json[] => {
      if (!Array.isArray(v)) throw new JqError(`Cannot ${what} ${typeName(v)}`);
      return v;
    };
    const str = (v: Json): string => {
      if (typeof v !== 'string') throw new JqError(`${typeName(v)} cannot be used as a string`);
      return v;
    };
    const by = (f: Node) => (v: Json) => this.ev(f, v, env);
    const sig = `${n.name}/${a.length}`;
    switch (sig) {
      case 'empty/0': return [];
      case 'not/0': return [!truthy(x)];
      case 'error/0': throw new JqError(x);
      case 'error/1': throw new JqError(one(0));
      case 'length/0':
        if (x === null) return [0];
        if (typeof x === 'boolean') throw new JqError('boolean has no length');
        if (typeof x === 'number') return [Math.abs(x)];
        if (typeof x === 'string') return [[...x].length];
        return [Array.isArray(x) ? x.length : Object.keys(x).length];
      case 'utf8bytelength/0': return [Buffer.byteLength(str(x))];
      case 'keys/0': case 'keys_unsorted/0':
        if (Array.isArray(x)) return [x.map((_, i) => i)];
        if (!isObj(x)) throw new JqError(`${typeName(x)} has no keys`);
        return [n.name === 'keys' ? Object.keys(x).sort() : Object.keys(x)];
      case 'values/0': return x === null ? [] : [x];
      case 'has/1': {
        const k = one(0);
        if (isObj(x) && typeof k === 'string') return [k in x];
        if (Array.isArray(x) && typeof k === 'number') return [k >= 0 && k < x.length];
        throw new JqError(`Cannot check whether ${typeName(x)} has a ${typeName(k)} key`);
      }
      case 'in/1': {
        const o = one(0);
        if (isObj(o) && typeof x === 'string') return [x in o];
        if (Array.isArray(o) && typeof x === 'number') return [x >= 0 && x < o.length];
        throw new JqError('in: bad arguments');
      }
      case 'contains/1': return [contains(x, one(0))];
      case 'inside/1': return [contains(one(0), x)];
      case 'select/1': return this.ev(a[0], x, env).filter(truthy).map(() => x);
      case 'map/1': return [this.iterate(x).flatMap(by(a[0]))];
      case 'map_values/1':
        if (Array.isArray(x)) return [x.flatMap((v) => by(a[0])(v).slice(0, 1))];
        if (isObj(x)) return [Object.fromEntries(Object.entries(x).flatMap(([k, v]) => by(a[0])(v).slice(0, 1).map((r) => [k, r])))];
        throw new JqError(`Cannot iterate over ${typeName(x)}`);
      case 'add/0': return [this.iterate(x).reduce<Json>((s, v) => add(s, v), null)];
      case 'any/0': return [arr(x).some(truthy)];
      case 'all/0': return [arr(x).every(truthy)];
      case 'any/1': return [arr(x).some((v) => by(a[0])(v).some(truthy))];
      case 'all/1': return [arr(x).every((v) => by(a[0])(v).every(truthy))];
      case 'flatten/0': case 'flatten/1': {
        const depth = a.length ? (one(0) as number) : 1e9;
        const flat = (v: Json[], d: number): Json[] => v.flatMap((e) => (Array.isArray(e) && d > 0 ? flat(e, d - 1) : [e]));
        return [flat(arr(x), depth)];
      }
      case 'range/1': { const m = one(0) as number; return Array.from({ length: Math.max(0, Math.ceil(m)) }, (_, i) => i); }
      case 'range/2': { const s = one(0) as number; const e = one(1) as number; const out: number[] = []; for (let i = s; i < e && out.length < 1000; i++) out.push(i); return out; }
      case 'floor/0': return [Math.floor(x as number)];
      case 'ceil/0': return [Math.ceil(x as number)];
      case 'round/0': return [Math.round(x as number)];
      case 'sqrt/0': return [Math.sqrt(x as number)];
      case 'fabs/0': case 'abs/0': return [Math.abs(x as number)];
      case 'tostring/0': return [typeof x === 'string' ? x : toJson(x)];
      case 'tonumber/0': {
        if (typeof x === 'number') return [x];
        const v = Number(str(x));
        if (Number.isNaN(v) || str(x).trim() === '') throw new JqError(`Cannot parse '${x}' as JSON`);
        return [v];
      }
      case 'type/0': return [typeName(x)];
      case 'sort/0': return [[...arr(x, 'sort')].sort(cmp)];
      case 'sort_by/1': return [[...arr(x, 'sort')].map((v) => [by(a[0])(v), v] as const).sort((p, q) => cmp(p[0], q[0])).map((p) => p[1])];
      case 'group_by/1': {
        const pairs = [...arr(x)].map((v) => [by(a[0])(v), v] as const).sort((p, q) => cmp(p[0], q[0]));
        const groups: Json[][] = [];
        pairs.forEach((p, i) => {
          if (i === 0 || cmp(p[0], pairs[i - 1][0]) !== 0) groups.push([]);
          groups[groups.length - 1].push(p[1]);
        });
        return [groups];
      }
      case 'unique/0': return [[...arr(x)].sort(cmp).filter((v, i, s) => i === 0 || cmp(v, s[i - 1]) !== 0)];
      case 'unique_by/1': {
        const pairs = [...arr(x)].map((v) => [by(a[0])(v), v] as const).sort((p, q) => cmp(p[0], q[0]));
        return [pairs.filter((p, i) => i === 0 || cmp(p[0], pairs[i - 1][0]) !== 0).map((p) => p[1])];
      }
      case 'min/0': case 'max/0': {
        const v = [...arr(x)].sort(cmp);
        return [v.length ? (n.name === 'min' ? v[0] : v[v.length - 1]) : null];
      }
      case 'min_by/1': case 'max_by/1': {
        const pairs = [...arr(x)].map((v) => [by(a[0])(v), v] as const).sort((p, q) => cmp(p[0], q[0]));
        if (!pairs.length) return [null];
        return [n.name === 'min_by' ? pairs[0][1] : pairs[pairs.length - 1][1]];
      }
      case 'reverse/0': return [typeof x === 'string' ? [...x].reverse().join('') : x === null ? [] : [...arr(x)].reverse()];
      case 'first/0': return [this.index(x, 0)];
      case 'last/0': return [this.index(x, -1)];
      case 'nth/1': return [this.index(x, one(0))];
      case 'first/1': return this.ev(a[0], x, env).slice(0, 1);
      case 'last/1': return this.ev(a[0], x, env).slice(-1);
      case 'limit/2': { const m = one(0) as number; return m > 0 ? this.ev(a[1], x, env).slice(0, m) : []; }
      case 'isempty/1': return [this.ev(a[0], x, env).length === 0];
      case 'recurse/0': return this.recurse(x);
      case 'recurse/1': {
        const out: Json[] = [];
        const go = (v: Json) => {
          out.push(v);
          this.tick();
          for (const c of this.opt(true, () => by(a[0])(v))) go(c);
        };
        go(x);
        return out;
      }
      case 'to_entries/0': {
        if (!isObj(x)) throw new JqError(`${typeName(x)} has no keys`);
        return [Object.entries(x).map(([key, value]) => ({ key, value }))];
      }
      case 'from_entries/0': {
        const o: Obj = {};
        for (const e of arr(x)) {
          if (!isObj(e)) throw new JqError('from_entries: bad entry');
          const k = e.key ?? e.k ?? e.name ?? e.Name ?? e.Key ?? e.K;
          o[typeof k === 'string' ? k : toJson(k ?? null)] = 'value' in e ? e.value : ('v' in e ? e.v : (e.Value ?? null));
        }
        return [o];
      }
      case 'with_entries/1': {
        if (!isObj(x)) throw new JqError(`${typeName(x)} has no keys`);
        const mapped = Object.entries(x).flatMap(([key, value]) => by(a[0])({ key, value }));
        return this.call({ t: 'call', name: 'from_entries', args: [] }, mapped, env);
      }
      case 'paths/0': return this.paths({ t: 'recurse' }, x, env).filter((p) => p.length) as Json[];
      case 'getpath/1': return [this.opt(false, () => [this.getpath(x, one(0) as Path)])[0]];
      case 'setpath/2': return [this.setpath(x, one(0) as Path, one(1))];
      case 'del/1': return [this.delpaths(x, this.paths(a[0], x, env))];
      case 'to_array/0': return [Array.isArray(x) ? x : [x]];
      case 'join/1': {
        const sep = str(one(0));
        return [arr(x).map((v) => (v === null ? '' : typeof v === 'string' ? v : typeof v === 'number' || typeof v === 'boolean' ? String(v) : (() => { throw new JqError(`Cannot join with ${typeName(v)}`); })())).join(sep)];
      }
      case 'split/1': return [str(x).split(str(one(0)))];
      case 'ascii_downcase/0': return [str(x).replace(/[A-Z]/g, (c) => c.toLowerCase())];
      case 'ascii_upcase/0': return [str(x).replace(/[a-z]/g, (c) => c.toUpperCase())];
      case 'ltrimstr/1': { const p = one(0); return [typeof x === 'string' && typeof p === 'string' && x.startsWith(p) ? x.slice(p.length) : x]; }
      case 'rtrimstr/1': { const p = one(0); return [typeof x === 'string' && typeof p === 'string' && x.endsWith(p) && p ? x.slice(0, -p.length) : x]; }
      case 'trim/0': return [str(x).trim()];
      case 'startswith/1': return [str(x).startsWith(str(one(0)))];
      case 'endswith/1': return [str(x).endsWith(str(one(0)))];
      case 'test/1': case 'test/2': {
        const flags = a.length > 1 ? str(one(1)) : '';
        if (/[^gix]/.test(flags)) throw new Unsupported('regex flags');
        return [new RegExp(str(one(0)), flags.replace('g', '').replace('x', '')).test(str(x))];
      }
      case 'ascii/0': return [String.fromCharCode(x as number)];
      case 'explode/0': return [[...str(x)].map((c) => c.codePointAt(0)!)];
      case 'implode/0': return [String.fromCodePoint(...(arr(x) as number[]))];
      case 'tojson/0': return [toJson(x)];
      case 'fromjson/0': try { return [JSON.parse(str(x))]; } catch { throw new JqError(`${x} cannot be parsed as JSON`); }
      case 'indices/1': case 'index/1': case 'rindex/1': {
        const t = one(0);
        let pos: number[] = [];
        if (typeof x === 'string' && typeof t === 'string' && t) {
          for (let i = x.indexOf(t); i >= 0; i = x.indexOf(t, i + 1)) pos.push(i);
        } else if (Array.isArray(x)) {
          const needle = Array.isArray(t) ? t : [t];
          for (let i = 0; i + needle.length <= x.length; i++) if (needle.every((v, j) => cmp(x[i + j], v) === 0)) pos.push(i);
        } else if (x === null) return [null];
        else throw new JqError('Cannot determine indices');
        if (n.name === 'indices') return [pos];
        pos = n.name === 'index' ? pos.slice(0, 1) : pos.slice(-1);
        return [pos.length ? pos[0] : null];
      }
      case 'objects/0': return isObj(x) ? [x] : [];
      case 'arrays/0': return Array.isArray(x) ? [x] : [];
      case 'strings/0': return typeof x === 'string' ? [x] : [];
      case 'numbers/0': return typeof x === 'number' ? [x] : [];
      case 'booleans/0': return typeof x === 'boolean' ? [x] : [];
      case 'nulls/0': return x === null ? [x] : [];
      case 'iterables/0': return Array.isArray(x) || isObj(x) ? [x] : [];
      case 'scalars/0': return !Array.isArray(x) && !isObj(x) ? [x] : [];
      case 'walk/1': {
        const go = (v: Json): Json => {
          const inner = Array.isArray(v) ? v.map(go) : isObj(v) ? Object.fromEntries(Object.entries(v).map(([k, c]) => [k, go(c)])) : v;
          const out = by(a[0])(inner);
          return out.length ? out[0] : null;
        };
        return [go(x)];
      }
      case 'tostream/0': case 'input/0': case 'inputs/0': case 'now/0': case 'env/0': case 'input_filename/0':
      case 'debug/0': case 'stderr/0': case 'halt/0': case 'halt_error/0': case 'halt_error/1':
        throw new Unsupported(n.name);
    }
    throw new Unsupported(`function ${sig}`);
  }
}

/** Run a jq filter on one input; undefined if the filter uses something the runner does not support. */
export function runJq(filter: string, input: Json, vars: Record<string, Json> = {}): { outputs: Json[] } | { error: string } | undefined {
  const node = parseJq(filter);
  if (!node) return undefined;
  const env: Env = { vars: new Map(Object.entries(vars).map(([k, v]) => [`$${k}`, v])), funcs: new Map() };
  env.vars.set('$__loc__', { file: '<stdin>', line: 1 });
  try {
    return { outputs: new Evaluator().ev(node, input, env) };
  } catch (e) {
    if (e instanceof JqError) return { error: e.message };
    if (e instanceof Unsupported) return undefined;
    throw e;
  }
}

// ---------------------------------------------------------------- input shape

/** What the filter expects its input to look like, refined while walking the filter. */
class Shape {
  kind: 'unknown' | 'object' | 'array' | 'number' | 'string' | 'boolean' = 'unknown';
  fields = new Map<string, Shape>();
  elem?: Shape;
  thresholds: number[] = [];
  strings: string[] = [];
  /** Arrays: indexes and slices used, so the example array is long enough to show them. */
  minLength = 0;
  /** The left side of `//`: a second example leaves it out, so the default is used. */
  optional = false;
  /** Values to avoid (the default of `//`), so the example shows the difference. */
  avoid: Json[] = [];
  /** Removed by del(), so other fields are needed for the example to show a change. */
  deleted = false;

  constructor(public name = '') {}

  obj(): Shape {
    if (this.kind === 'unknown') this.kind = 'object';
    return this;
  }

  field(name: string): Shape {
    this.obj();
    let f = this.fields.get(name);
    if (!f) { f = new Shape(name); this.fields.set(name, f); }
    return f;
  }

  arr(): Shape {
    if (this.kind === 'unknown') this.kind = 'array';
    this.elem ??= new Shape(singular(this.name));
    return this.elem;
  }

  set(kind: Shape['kind']): void {
    if (this.kind === 'unknown') this.kind = kind;
  }
}

function singular(name: string): string {
  return name.replace(/ies$/, 'y').replace(/s$/, '');
}

class Inferer {
  private vars = new Map<string, Shape>();
  private defs = new Map<string, Node>();

  run(n: Node, s: Shape): Shape {
    switch (n.t) {
      case 'id': return s;
      case 'recurse': return new Shape();
      case 'field': return this.run(n.base, s).field(n.name);
      case 'index': {
        const b = this.run(n.base, s);
        if (n.idx.t === 'lit' && typeof n.idx.v === 'number') {
          const el = b.arr();
          b.minLength = Math.max(b.minLength, n.idx.v >= 0 ? n.idx.v + 1 : -n.idx.v);
          return el;
        }
        if (n.idx.t === 'str' && n.idx.parts.length === 1 && typeof n.idx.parts[0] === 'string') return b.field(n.idx.parts[0]);
        return new Shape();
      }
      case 'slice': {
        const b = this.run(n.base, s);
        b.arr();
        const lim = (x?: Node) => (x?.t === 'lit' && typeof x.v === 'number' ? Math.abs(x.v) : 0);
        // A slice shows best with a few elements beyond its end.
        b.minLength = Math.max(b.minLength, lim(n.to) + 1, lim(n.from) + 2);
        return b;
      }
      case 'str':
        for (const part of n.parts) if (typeof part !== 'string') this.run(part, s);
        return new Shape();
      case 'def':
        if (!n.params.length) this.defs.set(n.name, n.body);
        return this.run(n.rest, s);
      case 'iter': {
        const b = this.run(n.base, s);
        if (b.kind === 'object') return b.fields.values().next().value ?? new Shape();
        return b.arr();
      }
      case 'try': return this.run(n.body, s);
      case 'pipe': return this.run(n.r, this.run(n.l, s));
      case 'comma': this.run(n.l, s); return this.run(n.r, s);
      case 'alt': {
        const left = this.run(n.l, s);
        if (left !== s && left.name) left.optional = true;
        if (n.r.t === 'lit') left.avoid.push(n.r.v);
        return this.run(n.r, s);
      }
      case 'neg': this.run(n.e, s).set('number'); return new Shape();
      case 'var': return this.vars.get(n.name) ?? new Shape();
      case 'as': {
        this.vars.set(n.v, this.run(n.src, s));
        return this.run(n.body, s);
      }
      case 'bin': {
        const l = this.run(n.l, s);
        const r = this.run(n.r, s);
        const lit = (x: Node) => (x.t === 'lit' ? x.v : x.t === 'str' && x.parts.length === 1 && typeof x.parts[0] === 'string' ? x.parts[0] : undefined);
        for (const [side, other] of [[l, lit(n.r)], [r, lit(n.l)]] as const) {
          if (typeof other === 'number') { side.set('number'); side.thresholds.push(other); }
          if (typeof other === 'string') { side.set('string'); side.strings.push(other); }
          if (typeof other === 'boolean') side.set('boolean');
        }
        if (['-', '*', '/', '%'].includes(n.op)) { l.set('number'); r.set('number'); }
        // `. + $x` with a numeric accumulator adds numbers.
        if (n.op === '+' && (l.kind === 'number' || r.kind === 'number')) { l.set('number'); r.set('number'); }
        if (n.op === 'and' || n.op === 'or') { l.set('boolean'); r.set('boolean'); }
        return new Shape();
      }
      case 'assign': {
        // `.x |= f` runs f on the value at .x; `.x = f` runs f on the whole input.
        const target = this.run(n.l, s);
        this.run(n.r, n.op === '=' ? s : target);
        return s;
      }
      case 'array': { const out = new Shape(); if (n.e) { out.kind = 'array'; out.elem = this.run(n.e, s); } return out; }
      case 'object': {
        const out = new Shape();
        out.kind = 'object';
        for (const e of n.entries) {
          const v = this.run(e.value, s);
          if (e.key.t === 'lit' && typeof e.key.v === 'string') out.fields.set(e.key.v, v);
        }
        return out;
      }
      case 'if':
        for (const [c, b] of n.branches) { this.cond(c, s); this.run(b, s); }
        return n.else ? this.run(n.else, s) : s;
      case 'reduce': case 'foreach': {
        this.vars.set(n.v, this.run(n.src, s));
        const acc = new Shape();
        if (n.init.t === 'lit' && typeof n.init.v === 'number') acc.kind = 'number';
        this.run(n.update, acc);
        return new Shape();
      }
      case 'call': return this.call(n, s);
      default: return new Shape();
    }
  }

  private cond(c: Node, s: Shape): void {
    const r = this.run(c, s);
    // `select(.ok)`: a field used directly as a condition is a boolean.
    if (r !== s && r.name) r.set('boolean');
  }

  private call(n: Extract<Node, { t: 'call' }>, s: Shape): Shape {
    const a = n.args;
    switch (n.name) {
      case 'select': this.cond(a[0], s); return s;
      case 'map': { const el = s.arr(); const out = new Shape(); out.kind = 'array'; out.elem = this.run(a[0], el); return out; }
      case 'map_values': this.run(a[0], s.kind === 'array' ? s.arr() : new Shape()); return s;
      case 'sort_by': case 'group_by': case 'unique_by': case 'min_by': case 'max_by': {
        const el = s.arr();
        const k = this.run(a[0], el);
        if (k.kind === 'unknown' && /^(age|count|price|size|score|total|amount|year|id|rank|qty|quantity|level|priority|value)$/.test(k.name)) k.set('number');
        return n.name.endsWith('_by') && (n.name === 'min_by' || n.name === 'max_by') ? el : s;
      }
      case 'sort': case 'unique': case 'reverse': case 'min': case 'max': case 'first': case 'last': case 'flatten':
        if (!a.length) { const el = s.arr(); return n.name === 'min' || n.name === 'max' || n.name === 'first' || n.name === 'last' ? el : s; }
        return this.run(a[0], s);
      case 'add': { const el = s.arr(); el.set('number'); return el; }
      case 'any': case 'all': if (a.length) this.cond(a[0], s.arr()); else s.arr().set('boolean'); return new Shape();
      case 'join': s.arr().set('string'); return new Shape();
      case 'length': if (s.kind === 'unknown') s.arr(); return new Shape();
      case 'keys': case 'keys_unsorted': case 'to_entries': case 'with_entries': case 'has': s.obj(); return new Shape();
      case 'test': case 'startswith': case 'endswith': case 'ltrimstr': case 'rtrimstr': case 'ascii_downcase': case 'ascii_upcase': case 'split': case 'tonumber':
        s.set('string');
        if (n.name === 'tonumber') s.strings.push('42');
        return new Shape();
      case 'del': this.run(a[0], s).deleted = true; return s;
      case 'not': return new Shape();
      case 'tostring': if (!a.length) s.set('number'); return new Shape();
      default: {
        const def = !a.length ? this.defs.get(n.name) : undefined;
        if (def) return this.run(def, s);
        for (const arg of a) this.run(arg, s);
        return new Shape();
      }
    }
  }
}

const NAMES: Record<string, string[]> = {
  name: ['alice', 'bob', 'carol'], user: ['alice', 'bob', 'carol'], author: ['alice', 'bob', 'carol'],
  email: ['alice@example.com', 'bob@example.com', 'carol@example.com'], city: ['Tokyo', 'Osaka', 'Kyoto'],
  title: ['Intro', 'Guide', 'Notes'], status: ['active', 'inactive', 'active'], type: ['book', 'pen', 'book'],
  id: ['a1', 'b2', 'c3'], tag: ['sale', 'new', 'sale'], url: ['https://example.com/a', 'https://example.com/b', 'https://example.com/c'],
  version: ['1.0.0', '1.2.0', '2.0.0'], date: ['2026-01-15', '2026-03-02', '2026-07-21'], key: ['host', 'port', 'user'],
};
const NUMBERS: Record<string, number[]> = {
  age: [30, 25, 41], price: [80, 150, 120], count: [3, 7, 1], id: [1, 2, 3], score: [72, 95, 88], size: [120, 2048, 512],
  total: [10, 30, 20], year: [2024, 2025, 2026], timeout: [30, 60, 10], port: [8080, 3000, 5432],
};
const BOOLS = /^(ok|enabled|active|done|valid|deleted|published|visible|admin|is_\w+|has_\w+)$/;

/** A JSON value of the given shape; `i` varies values between array elements. `omit` leaves out optional fields. */
function materialize(s: Shape, i: number, depth = 0, omit = false): Json {
  // Pick another variant if this one equals a value to avoid (the default of `//`).
  for (let k = 0; k < 3 && s.avoid.length; k++) {
    const v = materializeOnce(s, i + k, depth, omit);
    if (!s.avoid.some((a) => cmp(a, v) === 0)) return v;
  }
  return materializeOnce(s, i, depth, omit);
}

function materializeOnce(s: Shape, i: number, depth: number, omit: boolean): Json {
  switch (s.kind) {
    case 'object': {
      // An object used only as a whole (keys, to_entries…) still needs some content.
      if (!s.fields.size) return { name: NAMES.name[i % 3], age: NUMBERS.age[i % 3] };
      const obj = Object.fromEntries([...s.fields].filter(([, f]) => !(omit && f.optional)).map(([k, f]) => [k, materialize(f, i, depth + 1, omit)]));
      // del(.x) only shows a change if something else remains.
      if ([...s.fields.values()].every((f) => f.deleted)) return { name: NAMES.name[i % 3], ...obj };
      return obj;
    }
    case 'array': {
      const len = Math.min(Math.max(depth > 1 ? 2 : 3, s.minLength), 8);
      return Array.from({ length: len }, (_, j) => materialize(s.elem ?? new Shape(), j, depth + 1, omit));
    }
    case 'number': {
      if (s.thresholds.length) {
        const t = s.thresholds[0];
        const vals = t === 0 ? [-1, 3, 5] : [Math.round(t * 0.5), Math.round(t * 1.5), Math.round(t * 1.2)];
        return vals[i % 3];
      }
      return (NUMBERS[s.name] ?? [10, 25, 7])[i % 3];
    }
    case 'boolean': return [true, false, true][i % 3];
    case 'string':
      if (s.strings.length) return i % 2 === 0 ? s.strings[0] : (NAMES[s.name]?.[i % 3] ?? `other${i}`);
      return (NAMES[s.name] ?? NAMES[singular(s.name)] ?? [`${s.name || 'value'}1`, `${s.name || 'value'}2`, `${s.name || 'value'}3`])[i % 3];
    case 'unknown':
      if (NUMBERS[s.name]) return NUMBERS[s.name][i % 3];
      if (BOOLS.test(s.name)) return [true, false, true][i % 3];
      if (NAMES[s.name]) return NAMES[s.name][i % 3];
      return depth === 0 ? { name: 'alice', age: 30 } : `${s.name || 'value'}${i + 1}`;
  }
}

export interface JqRun {
  input: Json;
  outputs: string[];
  /** The results as values (up to five). */
  values: Json[];
  error?: string;
}

/**
 * Infer an input that fits the filter, run the filter, and show the outputs (raw strings with -r).
 * With `//`, a second run leaves the optional value out so the default shows.
 */
export function jqExample(filter: string, opts: { raw?: boolean; vars?: Record<string, Json>; nullInput?: boolean } = {}): JqRun[] | undefined {
  const node = parseJq(filter);
  if (!node) return undefined;
  const run = (input: Json): JqRun | undefined => {
    const res = runJq(filter, input, opts.vars);
    if (!res) return undefined;
    if ('error' in res) return { input, outputs: [], values: [], error: res.error };
    const shown = res.outputs.map((v) => (opts.raw && typeof v === 'string' ? v : toJson(v)));
    return { input, outputs: shown.length > 5 ? [...shown.slice(0, 4), '…'] : shown, values: res.outputs.slice(0, 5) };
  };
  if (opts.nullInput) {
    const r = run(null);
    return r && [r];
  }
  const shape = new Shape();
  try {
    new Inferer().run(node, shape);
  } catch {
    return undefined;
  }
  const first = run(materialize(shape, 0));
  if (!first) return undefined;
  const without = materialize(shape, 0, 0, true);
  const second = toJson(without) !== toJson(first.input) ? run(without) : undefined;
  return second && !second.error ? [first, second] : [first];
}
