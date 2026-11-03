// The digits C's printf gives of a number: of its exact value, rounded to the even digit on a tie, for any precision.
// JavaScript's `toFixed` and `toExponential` stop at 100 digits, round a tie up, and `toFixed` gives `1e+21` from there on.

/** A value not below 0, as a fraction. */
export interface Exact {
  num: bigint;
  den: bigint;
}

const float = new DataView(new ArrayBuffer(8));

/** The exact value of a finite double not below 0. */
export function exactOfDouble(n: number): Exact {
  float.setFloat64(0, n);
  const bits = float.getBigUint64(0);
  const stored = Number(bits >> 52n);
  const fraction = bits & ((1n << 52n) - 1n);
  const num = stored ? fraction | (1n << 52n) : fraction;
  const power = (stored || 1) - 1075;
  return power >= 0 ? { num: num << BigInt(power), den: 1n } : { num, den: 1n << BigInt(-power) };
}

/** The whole number nearest `num / den`; of two, the even one. */
function nearest(num: bigint, den: bigint): bigint {
  const q = num / den;
  const twice = 2n * (num % den);
  return twice > den || (twice === den && q % 2n === 1n) ? q + 1n : q;
}

/** `%.{prec}f`. */
function fixed(x: Exact, prec: number): string {
  const digits = nearest(x.num * 10n ** BigInt(prec), x.den).toString().padStart(prec + 1, '0');
  return prec ? `${digits.slice(0, -prec)}.${digits.slice(-prec)}` : digits;
}

/** `10 ** k <= x`, the largest `k`, of an `x` above 0: the difference of their lengths, or one below. */
function exponentOf(x: Exact): number {
  const k = x.num.toString().length - x.den.toString().length;
  return (k >= 0 ? x.num < x.den * 10n ** BigInt(k) : x.num * 10n ** BigInt(-k) < x.den) ? k - 1 : k;
}

/** `%.{prec}e`, with its exponent, which rounding can raise: `9.5` to no digits is `1e+01`. */
function exponential(x: Exact, prec: number): { text: string; exponent: number } {
  let exponent = x.num ? exponentOf(x) : 0;
  const shift = prec - exponent;
  let digits = (shift >= 0 ? nearest(x.num * 10n ** BigInt(shift), x.den) : nearest(x.num, x.den * 10n ** BigInt(-shift))).toString();
  if (digits.length > prec + 1) {
    digits = digits.slice(0, -1);
    exponent++;
  }
  digits = digits.padEnd(prec + 1, '0');
  const power = `e${exponent < 0 ? '-' : '+'}${String(Math.abs(exponent)).padStart(2, '0')}`;
  return { text: `${digits[0]}${prec ? '.' + digits.slice(1) : ''}${power}`, exponent };
}

/** `%f`, `%e` or `%g`, or those in capitals. `alt`: the flag `#`. */
export function floatText(x: Exact, conv: string, prec: number, alt: boolean): string {
  let s: string;
  if (conv === 'f' || conv === 'F') s = fixed(x, prec);
  else if (conv === 'e' || conv === 'E') s = exponential(x, prec).text;
  else {
    const p = prec === 0 ? 1 : prec;
    const e = exponential(x, p - 1);
    if (e.exponent < -4 || e.exponent >= p) {
      s = e.text;
      if (!alt) s = s.replace(/\.?0*e/, 'e');
    } else {
      s = fixed(x, p - 1 - e.exponent);
      if (!alt && s.includes('.')) s = s.replace(/\.?0+$/, '');
    }
  }
  // (`#`: always a decimal point: `%#.0f` of 3 is `3.`, `%#.0e` is `3.e+00`.)
  return (alt && !s.includes('.') ? s.replace(/^(\d+)/, '$1.') : s)[conv === conv.toUpperCase() ? 'toUpperCase' : 'toString']();
}

/** The most digits, and the largest power of ten, of a number written in decimal that is worked out exactly: a BigInt grows with them. */
const MAX_DECIMAL = 1000;

const DECIMAL = /^(\d*)\.?(\d*)(?:[eE]([-+]?\d+))?$/;

/**
 * The value of a number written in decimal, as bash's and coreutils' printf read it, not below 0: `12`, `1.5`, `.5e3`.
 * `undefined` when it is not written so (hexadecimal), `null` when it is too long or too large to work out (`1e-300000000`).
 */
function exactOfDecimal(text: string): Exact | undefined | null {
  const m = DECIMAL.exec(text);
  if (!m) return undefined;
  const power = Number(m[3] ?? 0) - m[2].length;
  if (m[1].length + m[2].length > MAX_DECIMAL || Math.abs(power) > MAX_DECIMAL) return null;
  const digits = BigInt(m[1] + m[2]);
  return power >= 0 ? { num: digits * 10n ** BigInt(power), den: 1n } : { num: digits, den: 10n ** BigInt(-power) };
}

/**
 * Whether what bash's or coreutils' printf prints of `text` is the same in every C library, and what the double `n` gives.
 * They read a `long double`, which has 64 bits on x86-64, 113 on Linux for arm64 and 53 on macOS for arm64, so `printf %.1f
 * 0.15` is `0.2` or `0.1`, and `%.20f` of 0.1 differs. The digits are shown when they do not depend on it: the number is
 * exact in a double (`1`, `0.25`), or the digits are the same at both ends of what any of those can round it to.
 */
export function sameInEveryLibrary(text: string, n: number, conv: string, prec: number, alt: boolean): boolean {
  if (!Number.isFinite(n)) return false;
  const abs = Math.abs(n);
  const double = exactOfDouble(abs);
  const written = text.replace(/^\s*[-+]?/, '');
  // (A double of 0 is a number that is 0 or that underflows; the power of ten of a written one is not worked out.)
  const zero = abs === 0 && DECIMAL.exec(written);
  if (zero) return !/[1-9]/.test(zero[1] + zero[2]);
  const x = exactOfDecimal(written);
  if (x === null) return false;
  // (Hexadecimal, or a character: a whole number, which has its bits in a double or not.)
  if (!x) return Number.isSafeInteger(n);
  if (x.num * double.den === double.num * x.den) return true;
  // (Half a unit of the last of 53 bits, at most, from a number not below 2^-1022; and a whole unit, below that.)
  const whole = 1n << 1074n;
  const away = (x.num << 1022n) + x.den;
  const den = x.den * whole;
  const low: Exact = { num: x.num * whole - away, den };
  const high: Exact = { num: x.num * whole + away, den };
  return low.num > 0n && floatText(low, conv, prec, alt) === floatText(high, conv, prec, alt);
}
