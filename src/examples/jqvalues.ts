// The values of the jq runner (src/examples/jq.ts): reading, comparing and printing them, as jq 1.7 does.

export type Json = null | boolean | number | string | Json[] | { [k: string]: Json };

export type Obj = { [k: string]: Json };
export const isObj = (v: Json): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);

export function typeName(v: Json): string {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  return typeof v === 'object' ? 'object' : typeof v;
}

export const ORDER = ['null', 'boolean', 'number', 'string', 'array', 'object'];

/** jq's total order: null < false < true < numbers < strings < arrays < objects. */
export function cmp(a: Json, b: Json): number {
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

export const truthy = (v: Json) => v !== null && v !== false;

/**
 * The JSON values of a text, one after another, as jq reads a file: separated by whitespace, or by nothing where one
 * ends with a bracket or a quote (`{"a":1}{"a":2}`). Throws a SyntaxError where a value is not JSON.
 */
export function parseJsonValues(text: string): Json[] {
  const out: Json[] = [];
  let i = 0;
  const ws = /\s/;
  while (i < text.length) {
    if (ws.test(text[i])) { i++; continue; }
    // The end of the value: where its brackets close, its string ends, or (a number, a literal) whitespace or a bracket begins.
    let depth = 0;
    let j = i;
    for (; j < text.length; j++) {
      const c = text[j];
      // A number or a literal ends where blanks or another value start.
      if (depth === 0 && j > i && (ws.test(c) || '{["'.includes(c))) break;
      if (c === '"') {
        for (j++; j < text.length && text[j] !== '"'; j++) if (text[j] === '\\') j++;
        if (depth === 0) { j++; break; }
      } else if (c === '{' || c === '[') depth++;
      else if (c === '}' || c === ']') {
        depth--;
        if (depth <= 0) { j++; break; }
      }
    }
    out.push(JSON.parse(text.slice(i, j)) as Json);
    i = j;
  }
  return out;
}

/**
 * A value like `v` for the `k`th file of several (from 0, `v` itself): its numbers plus `k`, and its strings with
 * `k + 1` after them, so that each file's output shows apart.
 */
export function varyJson(v: Json, k: number): Json {
  if (k === 0) return v;
  if (typeof v === 'number') return v + k;
  if (typeof v === 'string') return `${v}${k + 1}`;
  if (Array.isArray(v)) return v.map((x) => varyJson(x, k));
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([key, x]) => [key, varyJson(x, k)]));
  return v;
}

/**
 * How jq prints a value: `indent` spaces a level (2 by default; `--indent n`), a tab (`--tab`), or 0 for one line
 * (`-c`, `--indent 0`); `sortKeys`: the keys of every object in order (`-S`).
 */
export interface JqFormat { indent: number | '\t'; sortKeys?: boolean }

/** jq's default: two spaces a level. */
export const JQ_PRETTY: JqFormat = { indent: 2 };

export function sortedKeys(v: Json): Json {
  if (Array.isArray(v)) return v.map(sortedKeys);
  if (isObj(v)) return Object.fromEntries(Object.keys(v).sort().map((k) => [k, sortedKeys(v[k])]));
  return v;
}

/** The lines jq prints for a value in this format (`raw`: a string as it is, with `-r` or `-j`). */
export function jqPrint(v: Json, format: JqFormat, raw = false): string[] {
  if (raw && typeof v === 'string') return v.split('\n');
  const x = format.sortKeys ? sortedKeys(v) : v;
  return (format.indent === 0 ? JSON.stringify(x) : JSON.stringify(x, null, format.indent)).split('\n');
}

/** Compact JSON as `jq -c` prints it. */
export function toJson(v: Json): string {
  return JSON.stringify(v);
}

const sizes = new WeakMap<object, number>();

/** What a value holds, all its depths, a part it holds twice counted twice: what printing it would make. Each object is read once. */
export function sizeOf(v: Json): number {
  if (typeof v === 'string') return v.length;
  if (v === null || typeof v !== 'object') return 1;
  let size = sizes.get(v);
  if (size === undefined) {
    size = 1;
    for (const c of Array.isArray(v) ? v : Object.values(v)) size += sizeOf(c) + 1;
    sizes.set(v, size);
  }
  return size;
}
