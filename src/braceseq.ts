/**
 * The sequence expressions of brace expansion (`{1..10..3}`, `{a..e}`; manual 3.5.1), as bash makes them (braces.c,
 * `expand_seqterm` and `mkseq`), with its `intmax_t` arithmetic: whether bash expands one, and the words it gives.
 * bash leaves the braces as they are (as text) when a number does not fit in an `intmax_t`, and when its checks refuse
 * the sequence, which bash 5.3 changed:
 * - bash 5.2 refuses an increment of -2^63 that must change its sign, a start and an end too far apart for its check
 *   (`SUBOVERFLOW`, with margins), and more than `INT_MAX - 3` steps; it pads a number with zeros as `printf ("%0*d")`
 *   does with the number cut to a C `int`.
 * - bash 5.3 refuses any increment of -2^63, and a start and an end more than 2^63 - 1 apart (`ckd_sub`); it has no
 *   limit on the steps but its memory, and pads a number as it is.
 * Checked with bash 5.2 and 5.3 (test/fixtures/probes/words.json).
 */
import { BASH_VERSIONS, type BashVersion } from './bashversion';

const INTMAX_MAX = (1n << 63n) - 1n;
const INTMAX_MIN = -(1n << 63n);
const INT_MAX = 2147483647n;

/** A sequence bash expands: its first value, its end, the increment with its sign set from them, and the padding width (0: none). */
export interface BraceSequence {
  readonly start: bigint;
  readonly end: bigint;
  /** The increment as written (1 when there is none), and the one bash steps by (its sign from the start and the end). */
  readonly written: bigint;
  readonly step: bigint;
  /** Letters: the values are character codes. */
  readonly letters: boolean;
  /** The width every number is padded to with zeros (a start or an end written with a leading 0), else 0. */
  readonly width: number;
  /** The bash that expands it: how it pads a number past a C `int`. */
  readonly version: BashVersion;
}

const SHAPE = /^(?:([-+]?\d+)\.\.([-+]?\d+)|([A-Za-z])\.\.([A-Za-z]))(?:\.\.([-+]?\d+))?$/;
const fits = (v: bigint): boolean => v >= INTMAX_MIN && v <= INTMAX_MAX;
const abs = (v: bigint): bigint => (v < 0n ? -v : v);
/** `v` as a C `intmax_t` holds it once the arithmetic has wrapped (`imaxabs(INTMAX_MIN)` is INTMAX_MIN). */
const wrapped = (v: bigint): bigint => BigInt.asIntN(64, v);
/** Whether a start or an end written so pads the numbers (`01`, `-01`: a leading zero and more). */
const padding = (s: string): boolean => /^-?0./.test(s);

/** The sequence expression between the braces, `body` (`1..10..3`), when bash `version` expands it; undefined when it leaves the braces as they are. */
export function parseSequence(body: string, version: BashVersion): BraceSequence | undefined {
  const m = SHAPE.exec(body);
  if (!m) return undefined;
  const letters = m[3] !== undefined;
  const start = letters ? BigInt(m[3].charCodeAt(0)) : BigInt(m[1]);
  const end = letters ? BigInt(m[4].charCodeAt(0)) : BigInt(m[2]);
  const written = m[5] === undefined ? 1n : BigInt(m[5]);
  if (![start, end, written].every(fits)) return undefined;
  // mkseq: an increment of 0 is 1, and its sign follows the start and the end.
  let step = written || 1n;
  if (version === '5.2') {
    if (start > end && step > 0n) step = -step;
    else if (start < end && step < 0n) {
      if (step === INTMAX_MIN) return undefined;
      step = -step;
    }
    // (Its check that `end - start` does not overflow, with its margins: SUBOVERFLOW (end, start, INTMAX_MIN+3, INTMAX_MAX-2).)
    if ((start > 0n && end < INTMAX_MIN + 3n + start) || (start < 0n && end > INTMAX_MAX - 2n + start)) return undefined;
    // (The number of steps, in its arithmetic: `imaxabs (end - start) / imaxabs (incr)`, which wraps at INTMAX_MIN; more than INT_MAX - 3 is refused.)
    if (wrapped(abs(end - start)) / wrapped(abs(step)) > INT_MAX - 3n) return undefined;
  } else {
    // (bash 5.3 takes the absolute value of the increment and the distance with `ckd_sub`, and refuses where one overflows.)
    if (step === INTMAX_MIN || abs(end - start) > INTMAX_MAX) return undefined;
    if ((start < end) === (step < 0n)) step = -step;
  }
  const width = !letters && (padding(m[1]) || padding(m[2])) ? Math.max(m[1].length, m[2].length) : 0;
  return { start, end, written, step, letters, width, version };
}

/** Whether bash 5.2 or 5.3 expands the sequence expression `body` (the brace scanner, which does not know the version, makes a sequence of it). */
export const someSequence = (body: string): boolean => BASH_VERSIONS.some((v) => parseSequence(body, v));

/** The words of a sequence, in order; null past `max` words. */
export function sequenceWords(s: BraceSequence, max: number): string[] | null {
  const out: string[] = [];
  for (let n = s.start; ; n += s.step) {
    if (out.length === max) return null;
    out.push(s.letters ? String.fromCharCode(Number(n)) : s.width ? padded(n, s.width, s.version) : String(n));
    const next = n + s.step;
    // (It stops past the end, and where the next value would overflow.)
    if (!fits(next) || (s.step < 0n ? next < s.end : next > s.end)) return out;
  }
}

/** The last value of a sequence: the last step that does not pass the end. */
export const lastValue = (s: BraceSequence): bigint => s.start + ((s.end - s.start) / s.step) * s.step;

/** A number padded with zeros to `width`: bash 5.3 pads it as it is, bash 5.2 as `printf ("%0*d")` does with it cut to a C `int`. */
function padded(n: bigint, width: number, version: BashVersion): string {
  const v = version === '5.2' ? BigInt.asIntN(32, n) : n;
  return v < 0n ? `-${String(-v).padStart(width - 1, '0')}` : String(v).padStart(width, '0');
}
