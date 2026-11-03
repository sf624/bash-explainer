// What a jq filter shows on made-up input (split from src/examples/jq.ts): the shape of the input a filter expects, a sample of it, the steps of a pipe, and the example.
import { cmp, type JqFormat, jqPrint, type Json, toJson, varyJson } from './jqvalues';
import { lex } from '../embedded/jq';
import { pushAll } from '../lists';
import { chargeSize, chargeWalk } from './regexguard';
import { type Node, parseJq, type Pat, patVars, runJq, SLOT, Unsupported } from './jq';

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

/** The builtins the inferer reads with their argument, which jq does not define without one. */
const ONE_ARGUMENT = new Set(['select', 'map', 'map_values', 'sort_by', 'group_by', 'unique_by', 'min_by', 'max_by', 'index', 'rindex', 'indices', 'contains', 'inside', 'del']);

class Inferer {
  private vars = new Map<string, Shape>();
  private defs = new Map<string, Node>();

  /** `inputs`: the shape of the values `input` and `inputs` read. */
  constructor(private inputs = new Shape()) {}

  run(n: Node, s: Shape): Shape {
    // (Each call of a definition reads it again: `def b: a|a; def c: b|b; …`.)
    chargeWalk(SLOT);
    switch (n.t) {
      case 'id': return s;
      case 'recurse': return new Shape();
      case 'field': return this.run(n.base, s).field(n.name);
      case 'index': {
        const b = this.run(n.base, s);
        if (n.idx.t === 'lit' && typeof n.idx.v === 'number') {
          const el = b.arr();
          // `.[-2]` is a negation, not a literal: the index is 0 or more.
          b.minLength = Math.max(b.minLength, n.idx.v + 1);
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
      // `@csv` and `@tsv` format an array.
      case 'fmt': if (n.name === '@csv' || n.name === '@tsv') s.arr(); return new Shape();
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
        this.bindShapes(n.pats, this.run(n.src, s));
        return this.run(n.body, s);
      }
      case 'label': return this.run(n.body, s);
      case 'bin': {
        const l = this.run(n.l, s);
        const r = this.run(n.r, s);
        const lit = (x: Node) => (x.t === 'lit' ? x.v : x.t === 'str' && x.parts.length === 1 && typeof x.parts[0] === 'string' ? x.parts[0] : undefined);
        for (const [side, other] of [[l, lit(n.r)], [r, lit(n.l)]] as const) {
          if (typeof other === 'number') { side.set('number'); side.thresholds.push(other); }
          if (typeof other === 'string') { side.set('string'); side.strings.push(other); }
          if (typeof other === 'boolean') side.set('boolean');
        }
        // `. + [1]`, `. - [1]`, `. + {"a": 1}`: the other side has the kind of the literal array or object.
        for (const [side, other] of [[l, n.r], [r, n.l]] as const) {
          if (n.op === '+' || n.op === '-') { if (other.t === 'array') side.arr(); else if (other.t === 'object' && n.op === '+') side.obj(); }
        }
        if (['-', '*', '/', '%'].includes(n.op) && n.l.t !== 'array' && n.r.t !== 'array') { l.set('number'); r.set('number'); }
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
        this.bindShapes(n.pats, this.run(n.src, s));
        const acc = new Shape();
        if (n.init.t === 'lit' && typeof n.init.v === 'number') acc.kind = 'number';
        this.run(n.update, acc);
        return new Shape();
      }
      case 'call': return this.call(n, s);
      default: return new Shape();
    }
  }

  /** `. as [$a, $b]` expects an array; `{k: $v}` an object with the field `k`; the variables get the shapes of their places. */
  private bindShapes(pats: Pat[], s: Shape): void {
    const walk = (p: Pat, at: Shape): void => {
      if (p.k === 'var') { this.vars.set(p.name, at); return; }
      if (p.k === 'arr') {
        const el = at.arr();
        at.minLength = Math.max(at.minLength, p.items.length);
        p.items.forEach((item) => walk(item, el));
        return;
      }
      for (const e of p.entries) {
        const key = e.key.t === 'lit' && typeof e.key.v === 'string' ? e.key.v : e.key.t === 'str' && e.key.parts.length === 1 && typeof e.key.parts[0] === 'string' ? e.key.parts[0] : undefined;
        const field = key === undefined ? new Shape() : at.field(key);
        if (e.bind) this.vars.set(e.bind, field);
        if (e.pat) walk(e.pat, field);
      }
    };
    if (pats.length === 1) walk(pats[0], s);
    else for (const name of patVars(pats)) this.vars.set(name, new Shape());
  }

  private cond(c: Node, s: Shape): void {
    const r = this.run(c, s);
    // `select(.ok)`: a field used directly as a condition is a boolean.
    if (r !== s && r.name) r.set('boolean');
  }

  private call(n: Extract<Node, { t: 'call' }>, s: Shape): Shape {
    const a = n.args;
    // jq has these only with an argument: `select` alone is not defined (`jq: error: select/0 is not defined`).
    if (!a.length && ONE_ARGUMENT.has(n.name)) throw new Unsupported(`${n.name}/0`);
    switch (n.name) {
      case 'input': case 'inputs': return this.inputs;
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
      case 'index': case 'rindex': case 'indices': {
        // `index(",")` finds a piece of text; `index(1)` an element of an array.
        const arg = a[0];
        if (arg.t === 'str' && arg.parts.length === 1 && typeof arg.parts[0] === 'string') { s.set('string'); s.strings.push(arg.parts[0]); }
        else s.arr();
        return new Shape();
      }
      case 'contains': case 'inside': {
        // The input has the kind of the literal it is compared with, and holds it.
        const arg = a[0];
        if (arg.t === 'str' && arg.parts.length === 1 && typeof arg.parts[0] === 'string') { s.set('string'); s.strings.push(arg.parts[0]); }
        else if (arg.t === 'array') { const el = s.arr(); const only = arg.e?.t === 'str' && arg.e.parts.length === 1 ? arg.e.parts[0] : undefined; if (typeof only === 'string') { el.set('string'); el.strings.push(only); } }
        else if (arg.t === 'object') s.obj();
        return new Shape();
      }
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

const NAMES: Record<string, string[]> = Object.assign(Object.create(null), {
  name: ['alice', 'bob', 'carol'], user: ['alice', 'bob', 'carol'], author: ['alice', 'bob', 'carol'],
  email: ['alice@example.com', 'bob@example.com', 'carol@example.com'], city: ['Tokyo', 'Osaka', 'Kyoto'],
  title: ['Intro', 'Guide', 'Notes'], status: ['active', 'inactive', 'active'], type: ['book', 'pen', 'book'],
  id: ['a1', 'b2', 'c3'], tag: ['sale', 'new', 'sale'], url: ['https://example.com/a', 'https://example.com/b', 'https://example.com/c'],
  version: ['1.0.0', '1.2.0', '2.0.0'], date: ['2026-01-15', '2026-03-02', '2026-07-21'], key: ['host', 'port', 'user'],
});
const NUMBERS: Record<string, number[]> = Object.assign(Object.create(null), {
  age: [30, 25, 41], price: [80, 150, 120], count: [3, 7, 1], id: [1, 2, 3], score: [72, 95, 88], size: [120, 2048, 512],
  total: [10, 30, 20], year: [2024, 2025, 2026], timeout: [30, 60, 10], port: [8080, 3000, 5432],
});
const BOOLS = /^(ok|enabled|active|done|valid|deleted|published|visible|admin|is_\w+|has_\w+)$/;

/** A JSON value of the given shape; `i` varies values between array elements. `omit` leaves out optional fields. */
/** How deep the arrays of a made-up input have more than one item: past it, one shows as much. */
const SAMPLE_DEPTH = 6;

function materialize(s: Shape, i: number, depth = 0, omit = false): Json {
  // (What it makes is multiplied at each level: `.[].[].[]…`.)
  chargeSize(SLOT);
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
      const len = Math.min(Math.max(depth > SAMPLE_DEPTH ? 1 : depth > 1 ? 2 : 3, s.minLength), 8);
      return Array.from({ length: len }, (_, j) => materialize(s.elem!, j, depth + 1, omit));
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

/** One stage of a top-level pipe chain: its text, and every value it leaves. */
export interface JqStep {
  text: string;
  values: Json[];
}

/**
 * Split a filter at its top-level pipes and run the stages one after another, keeping the
 * values after each. Undefined when there is no top-level pipe, when a piece is not a filter on
 * its own (`. as $x | …`, `def f: …; …`), when a stage cannot be run here, or when the pieces
 * together do not give what the whole filter gives.
 */
export function jqSteps(filter: string, input: Json, vars: Record<string, Json> = {}): JqStep[] | undefined {
  // (Callers have run the filter, so it lexes.)
  const toks = lex(filter);
  const pieces: string[] = [];
  let depth = 0;
  let from = 0;
  for (const t of toks) {
    if (t.type === 'str') continue;
    if (['(', '[', '{', 'if'].includes(t.text)) depth++;
    else if ([')', ']', '}', 'end'].includes(t.text)) depth--;
    else if (t.text === '|' && t.type === 'op' && depth === 0) {
      pieces.push(filter.slice(from, t.start).trim());
      from = t.end;
    }
  }
  if (!pieces.length) return undefined;
  pieces.push(filter.slice(from).trim());
  let values: Json[] = [input];
  const steps: JqStep[] = [];
  for (const text of pieces) {
    const next: Json[] = [];
    for (const v of values) {
      const res = runJq(text, v, vars);
      if (!res || 'error' in res) return undefined;
      pushAll(next, res.outputs);
    }
    values = next;
    steps.push({ text, values });
  }
  // A guard against a split that changes the meaning: no filter known gives a different result.
  const whole = runJq(filter, input, vars);
  /* c8 ignore next */
  if (!whole || 'error' in whole || toJson(whole.outputs) !== toJson(values)) return undefined;
  return steps;
}

export interface JqRun {
  input: Json;
  /** The values after each stage of a top-level pipe chain (see jqSteps). */
  steps?: JqStep[];
  outputs: string[];
  /** The results as values (up to five). */
  values: Json[];
  error?: string;
  /** `-s`: the filter reads all the input values as one array, so `input` is that array and the file holds its elements. */
  slurp?: boolean;
}

/** What the flags of jq change in an example. */
export interface JqFlags {
  raw?: boolean;
  /** `-j`: raw strings, and no newline after any output. */
  join?: boolean;
  /** `-s` */
  slurp?: boolean;
  /** How the results are printed (`-c`, `--tab`, `--indent`, `-S`); one line each when not given. */
  format?: JqFormat;
}

/**
 * The lines jq prints for its results: in `format`, one after another (with `-j` with no newline between them);
 * `raw` (`-r`, `-j`) prints strings as they are. `cap`: at most this many results, then `…`.
 */
export function jqOutputLines(values: Json[], opts: JqFlags, cap = Infinity): string[] {
  const format = opts.format ?? { indent: 0 };
  const raw = !!(opts.raw || opts.join);
  if (opts.join) return values.length ? values.map((v) => jqPrint(v, format, raw).join('\n')).join('').split('\n') : [];
  const shown = values.length > cap ? values.slice(0, cap - 1) : values;
  return [...shown.flatMap((v) => jqPrint(v, format, raw)), ...(shown.length < values.length ? ['…'] : [])];
}

/** The jq function of the filter that reads more inputs (`input`, `inputs`), if any. */
export function jqReadsInputs(filter: string): 'input' | 'inputs' | undefined {
  let found: 'input' | 'inputs' | undefined;
  // A call anywhere in the parse, whatever node holds it.
  const walk = (x: unknown): void => {
    if (found || !x || typeof x !== 'object') return;
    const n = x as { t?: string; name?: string; args?: unknown[] };
    if (n.t === 'call' && (n.name === 'input' || n.name === 'inputs') && !n.args!.length) found = n.name;
    else for (const v of Object.values(x)) walk(v);
  };
  walk(parseJq(filter));
  return found;
}

/**
 * Sample input of a filter, as jq reads it from a file: the `k`th value (from 0), like the others with its numbers
 * and strings changed (`varyJson`). `nullInput`: the values `input` and `inputs` read, as `.` is null; `rawInput`
 * (`-R`): lines, which jq reads as strings. Undefined when the filter cannot be read.
 */
export function jqSample(filter: string, opts: { nullInput?: boolean; rawInput?: boolean } = {}): ((k: number) => Json) | undefined {
  const node = parseJq(filter);
  // (The analyzer asks for filters its explanation has read: a guard.)
  /* c8 ignore next */
  if (!node) return undefined;
  const shape = new Shape();
  const inputs = opts.nullInput ? new Shape() : shape;
  try {
    new Inferer(inputs).run(node, shape);
  } catch (e) {
    if (e instanceof Unsupported) return undefined;
    /* c8 ignore next */
    throw e;
  }
  if (opts.rawInput) {
    // A line is a string: one the filter fits, or plain text.
    return inputs.kind === 'string' ? (k) => materialize(inputs, k) : (k) => `line ${k + 1}`;
  }
  const first = materialize(inputs, 0);
  return (k) => varyJson(first, k);
}

/** The sample file of a slurped example: the values the filter's array is made of, one per line. */
export function slurpLines(input: Json): string[] {
  return (input as Json[]).map(toJson);
}

/**
 * Infer an input that fits the filter, run the filter, and show the outputs (raw strings with -r).
 * With `//`, a second run leaves the optional value out so the default shows.
 */
export function jqExample(filter: string, opts: JqFlags & { vars?: Record<string, Json>; nullInput?: boolean } = {}): JqRun[] | undefined {
  const node = parseJq(filter);
  if (!node) return undefined;
  const run = (input: Json): JqRun | undefined => {
    const res = runJq(filter, input, opts.vars);
    if (!res) return undefined;
    if ('error' in res) return { input, outputs: [], values: [], error: res.error };
    // `-j` prints the outputs one right after another, with no newline at all.
    const outputs = jqOutputLines(res.outputs, opts, 5);
    const steps = opts.join ? undefined : jqSteps(filter, input, opts.vars);
    return { input, ...(steps ? { steps } : {}), ...(opts.slurp ? { slurp: true } : {}), outputs, values: res.outputs.slice(0, 5) };
  };
  if (opts.nullInput) {
    const r = run(null);
    return r && [r];
  }
  const shape = new Shape();
  try {
    new Inferer().run(node, shape);
  } catch (e) {
    // (A filter jq refuses, `select` with no argument: no example. Anything else is a bug, which shows.)
    if (e instanceof Unsupported) return undefined;
    /* c8 ignore next */
    throw e;
  }
  // With `-s` the filter sees an array of the values in the file.
  const sample = (v: Json): Json => (opts.slurp && !Array.isArray(v) ? [v] : v);
  const first = run(sample(materialize(shape, 0)));
  if (!first) return undefined;
  const without = sample(materialize(shape, 0, 0, true));
  const second = toJson(without) !== toJson(first.input) ? run(without) : undefined;
  return second && !second.error ? [first, second] : [first];
}
