/**
 * Integer constants of bash arithmetic (`$(( ))`, `(( ))`, `let`, array subscripts, `${s:off:len}`):
 * decimal, octal (`010`), hexadecimal (`0x1F`) and `base#digits` (`2#1010`, `64#@`).
 */

export type ArithLiteral =
  | { type: 'number'; style: 'decimal' | 'octal' | 'hex' | 'based'; base: number; digits: string; value: string }
  | { type: 'invalid'; reason: 'digit' | 'base' | 'empty' | 'zero-base'; base: number; digit: string };

/** The value of a digit in `base`: 0-9, a-z, A-Z (after the lowercase ones above base 36), `@`, `_`; -1 for anything else. */
function digitValue(ch: string, base: number): number {
  if (ch >= '0' && ch <= '9') return ch.charCodeAt(0) - 48;
  if (ch >= 'a' && ch <= 'z') return ch.charCodeAt(0) - 87;
  if (ch >= 'A' && ch <= 'Z') return ch.charCodeAt(0) - (base <= 36 ? 55 : 29);
  return ch === '@' ? 62 : 63;
}

/**
 * Reads `text` as bash does a word of an arithmetic expression that starts with a digit.
 * Undefined if it is not a constant at all (it does not start with a digit, or has other characters).
 */
export function arithLiteral(text: string): ArithLiteral | undefined {
  if (!/^\d[0-9A-Za-z@_#]*$/.test(text)) return undefined;
  const hash = text.indexOf('#');
  let base = 10;
  let style: 'decimal' | 'octal' | 'hex' | 'based' = 'decimal';
  let digits = text;
  if (hash >= 0) {
    const baseText = text.slice(0, hash);
    digits = text.slice(hash + 1);
    if (digits.includes('#')) return undefined;
    // The base is read as a number of its own: a leading 0 makes it octal, which `0#1` and `00#1` cannot be.
    if (baseText[0] === '0') {
      return /[89]/.test(baseText) ? { type: 'invalid', reason: 'digit', base: 8, digit: baseText.match(/[89]/)![0] } : { type: 'invalid', reason: 'zero-base', base: 0, digit: '' };
    }
    base = Number(baseText);
    if (base < 2 || base > 64) return { type: 'invalid', reason: 'base', base, digit: '' };
    if (!digits) return { type: 'invalid', reason: 'empty', base, digit: '' };
    style = 'based';
  } else if (/^0[xX]/.test(text)) {
    base = 16;
    style = 'hex';
    digits = text.slice(2);
  } else if (text.length > 1 && text[0] === '0') {
    base = 8;
    style = 'octal';
    digits = text.slice(1);
  }
  let value = 0n;
  for (const ch of digits) {
    const d = digitValue(ch, base);
    if (d >= base) return { type: 'invalid', reason: 'digit', base, digit: ch };
    value = value * BigInt(base) + BigInt(d);
  }
  // Like bash, wrap around at 64 bits.
  return { type: 'number', style, base, digits, value: BigInt.asIntN(64, value).toString() };
}

/** The value of a constant with an optional sign (`-5`, `+0x10`, `010`), if it is one bash accepts. */
export function intValue(text: string): number | undefined {
  const m = /^([+-]?)(\d[0-9A-Za-z@_#]*)$/.exec(text.trim());
  const lit = m && arithLiteral(m[2]);
  return lit && lit.type === 'number' ? Number(m![1] === '-' ? '-' + lit.value : lit.value) : undefined;
}

/**
 * The value of an arithmetic expression made only of constants, `+ - * / % **`, unary `+ -` and parentheses
 * (`1+1`, `2**3`, `-2**2`), as bash computes it. Undefined for anything else (variables, other operators,
 * errors such as a division by zero).
 */
export function evalArith(text: string): number | undefined {
  const tokens = text.match(/\s*(\*\*|[0-9][0-9A-Za-z@_#]*|[-+*/%()]|\S)/g)?.map((t) => t.trim());
  if (!tokens) return undefined;
  let pos = 0;
  const fail = Symbol('fail');
  const peek = () => tokens[pos];
  const unary = (): bigint => {
    const t = tokens[pos++];
    if (t === '-') return -unary();
    if (t === '+') return unary();
    if (t === '(') {
      const v = additive();
      if (tokens[pos++] !== ')') throw fail;
      return v;
    }
    const lit = t === undefined ? undefined : arithLiteral(t);
    if (!lit || lit.type !== 'number') throw fail;
    return BigInt(lit.value);
  };
  // `**` binds less tightly than a unary minus (`-2**2` is 4) and groups to the right.
  const power = (): bigint => {
    const base = unary();
    if (peek() !== '**') return base;
    pos++;
    const exp = power();
    // (Too large to compute; bash wraps around at 64 bits, so no one writes this.)
    if (exp < 0n || (exp > 128n && (base > 1n || base < -1n))) throw fail;
    return BigInt.asIntN(64, base ** exp);
  };
  const multiplicative = (): bigint => {
    let v = power();
    while (peek() === '*' || peek() === '/' || peek() === '%') {
      const op = tokens[pos++];
      const r = power();
      if (op === '*') v = BigInt.asIntN(64, v * r);
      else if (r === 0n) throw fail;
      else v = op === '/' ? v / r : v % r;
    }
    return v;
  };
  const additive = (): bigint => {
    let v = multiplicative();
    while (peek() === '+' || peek() === '-') v = BigInt.asIntN(64, tokens[pos++] === '+' ? v + multiplicative() : v - multiplicative());
    return v;
  };
  try {
    const v = additive();
    if (pos < tokens.length) return undefined;
    return Number.isSafeInteger(Number(v)) ? Number(v) : undefined;
  } catch (e) {
    if (e === fail) return undefined;
    /* c8 ignore next */
    throw e;
  }
}
