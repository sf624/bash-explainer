import type { Lang } from './i18n';
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
 * The value of an arithmetic expression made only of constants, `+ - * / % **`, `<< >>`, unary `+ -` and parentheses
 * (`1+1`, `2**3`, `-2**2`, `1<<4`), as bash computes it. Undefined for anything else (variables, other operators,
 * errors such as a division by zero). `wrapped`: a step overflowed 64 bits and wrapped around, as bash's integers do.
 */
export function evalArithWrapping(text: string): { value: bigint; wrapped: boolean } | undefined {
  const tokens = text.match(/\s*(\*\*|<<|>>|[0-9][0-9A-Za-z@_#]*|[-+*/%()]|\S)/g)?.map((t) => t.trim());
  if (!tokens) return undefined;
  let pos = 0;
  let wrapped = false;
  const fail = Symbol('fail');
  const peek = () => tokens[pos];
  const wrap = (v: bigint): bigint => {
    const w = BigInt.asIntN(64, v);
    if (w !== v) wrapped = true;
    return w;
  };
  const unary = (): bigint => {
    const t = tokens[pos++];
    if (t === '-') return wrap(-unary());
    if (t === '+') return unary();
    if (t === '(') {
      const v = shift();
      if (tokens[pos++] !== ')') throw fail;
      return v;
    }
    const lit = t === undefined ? undefined : arithLiteral(t);
    if (!lit || lit.type !== 'number') throw fail;
    return wrap(BigInt(lit.value));
  };
  // `**` binds less tightly than a unary minus (`-2**2` is 4) and groups to the right.
  const power = (): bigint => {
    const base = unary();
    if (peek() !== '**') return base;
    pos++;
    const exp = power();
    // (Too large to compute; bash wraps around at 64 bits, so no one writes this.)
    if (exp < 0n || (exp > 128n && (base > 1n || base < -1n))) throw fail;
    return wrap(base ** exp);
  };
  const multiplicative = (): bigint => {
    let v = power();
    while (peek() === '*' || peek() === '/' || peek() === '%') {
      const op = tokens[pos++];
      const r = power();
      if (op === '*') v = wrap(v * r);
      else if (r === 0n) throw fail;
      else v = wrap(op === '/' ? v / r : v % r);
    }
    return v;
  };
  const additive = (): bigint => {
    let v = multiplicative();
    while (peek() === '+' || peek() === '-') v = wrap(tokens[pos++] === '+' ? v + multiplicative() : v - multiplicative());
    return v;
  };
  const shift = (): bigint => {
    let v = additive();
    while (peek() === '<<' || peek() === '>>') {
      const left = tokens[pos++] === '<<';
      const count = additive();
      // (What a shift by a negative count or by 64 or more does depends on the machine.)
      if (count < 0n || count > 63n) throw fail;
      v = wrap(left ? v << count : v >> count);
    }
    return v;
  };
  try {
    const v = shift();
    if (pos < tokens.length) return undefined;
    return { value: v, wrapped };
  } catch (e) {
    if (e === fail) return undefined;
    /* c8 ignore next */
    throw e;
  }
}

/** The value of a constant arithmetic expression (see `evalArithWrapping`), when it is a safe integer. */
export function evalArith(text: string): number | undefined {
  const r = evalArithWrapping(text);
  return r && Number.isSafeInteger(Number(r.value)) ? Number(r.value) : undefined;
}

/** A constant of an arithmetic expression in words: its base and value, or why bash rejects it. */
export function describeArithLiteral(text: string, lit: ArithLiteral, lang: Lang): string {
  const s = (ja: string, en: string): string => (lang === 'ja' ? ja : en);
  if (lit.type === 'invalid') {
    const octal = lit.base === 8 && !text.includes('#');
    const why = lit.reason === 'base'
      ? s(`基数 ${lit.base} は使えない（2〜64）`, `${lit.base} is not a base bash has (2 to 64)`)
      // (The grammar does not read `2#` as a number, so only the unit tests of arithLiteral get here.)
      /* c8 ignore next */
      : lit.reason === 'empty' ? s('\`#\` の後に数字がない', 'no digits follow the `#`')
      : lit.reason === 'zero-base' ? s('基数が 0 で始まっている', 'the base starts with 0')
      : octal ? s(`先頭が 0 の数は 8 進数として読まれ、数字 \`${lit.digit}\` は使えない`, `a number starting with 0 is read as octal, and \`${lit.digit}\` is not an octal digit`)
      : s(`基数 ${lit.base} では数字 \`${lit.digit}\` は使えない`, `\`${lit.digit}\` is not a digit in base ${lit.base}`);
    return s(`⚠ 不正な数 \`${text}\`: ${why}。bash は算術エラーで止まる`, `⚠ Invalid number \`${text}\`: ${why}. bash stops with an arithmetic error`);
  }
  const name: Record<number, [string, string]> = { 2: ['2進数', 'binary'], 8: ['8進数', 'octal'], 16: ['16進数', 'hexadecimal'] };
  const [ja, en] = name[lit.base] ?? [`${lit.base}進数`, `base ${lit.base}`];
  const how = lit.style === 'octal' ? s('先頭が 0 の数は 8 進数として読まれる', 'a number starting with 0 is read as octal')
    : lit.style === 'hex' ? s('`0x` で始まる数は 16 進数', 'a number starting with `0x` is hexadecimal')
    : s(`\`基数#数字\` の形（基数は 2〜64）`, 'written as `base#digits` (base 2 to 64)');
  const high = lit.base > 36 ? s('。基数 36 より大きいと、数字は 0-9, a-z（10〜35）, A-Z（36〜61）, `@`（62）, `_`（63）', '. Above base 36, the digits are 0-9, a-z (10-35), A-Z (36-61), `@` (62) and `_` (63)') : '';
  return s(`${ja}の \`${text}\`（${how}）= 10 進数で ${lit.value}${high}`, `${en[0].toUpperCase()}${en.slice(1)} number \`${text}\` (${how}) = ${lit.value} in decimal${high}`);
}
