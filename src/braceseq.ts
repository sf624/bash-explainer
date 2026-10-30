/**
 * The sequence expressions of brace expansion (`{1..10..3}`, `{a..e}`; manual 3.5.1), as bash 5.2 makes them
 * (braces.c, `expand_seqterm` and `mkseq`), with its `intmax_t` arithmetic: whether bash expands one, and the words
 * it gives. bash leaves the braces as they are (as text) when a number does not fit in an `intmax_t`, and when its
 * checks refuse the sequence: an increment of -2^63 that must change its sign, a start and an end too far apart for
 * them, or more than `INT_MAX - 3` steps. Checked with bash 5.2 (test/fixtures/probes/words.json). bash 5.3 checks
 * these otherwise (it refuses any increment of -2^63, allows a start and an end up to 2^63 - 1 apart, and has no
 * limit on the steps but its memory), and pads a number past a C `int` with zeros as it is, where bash 5.2 prints it
 * cut to an `int`: rows of bash 5.3 in the same table, as gaps.
 */

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
}

const SHAPE = /^(?:([-+]?\d+)\.\.([-+]?\d+)|([A-Za-z])\.\.([A-Za-z]))(?:\.\.([-+]?\d+))?$/;
const fits = (v: bigint): boolean => v >= INTMAX_MIN && v <= INTMAX_MAX;
const abs = (v: bigint): bigint => (v < 0n ? -v : v);
/** `v` as a C `intmax_t` holds it once the arithmetic has wrapped (`imaxabs(INTMAX_MIN)` is INTMAX_MIN). */
const wrapped = (v: bigint): bigint => BigInt.asIntN(64, v);
/** Whether a start or an end written so pads the numbers (`01`, `-01`: a leading zero and more). */
const padding = (s: string): boolean => /^-?0./.test(s);

/** The sequence expression between the braces, `body` (`1..10..3`), when bash expands it; undefined when it leaves the braces as they are. */
export function parseSequence(body: string): BraceSequence | undefined {
  const m = SHAPE.exec(body);
  if (!m) return undefined;
  const letters = m[3] !== undefined;
  const start = letters ? BigInt(m[3].charCodeAt(0)) : BigInt(m[1]);
  const end = letters ? BigInt(m[4].charCodeAt(0)) : BigInt(m[2]);
  const written = m[5] === undefined ? 1n : BigInt(m[5]);
  if (![start, end, written].every(fits)) return undefined;
  // mkseq: an increment of 0 is 1, and its sign follows the start and the end.
  let step = written || 1n;
  if (start > end && step > 0n) step = -step;
  else if (start < end && step < 0n) {
    if (step === INTMAX_MIN) return undefined;
    step = -step;
  }
  // (bash 5.2's check that `end - start` does not overflow, with its margins: SUBOVERFLOW (end, start, INTMAX_MIN+3, INTMAX_MAX-2).)
  if ((start > 0n && end < INTMAX_MIN + 3n + start) || (start < 0n && end > INTMAX_MAX - 2n + start)) return undefined;
  // (The number of steps, in its arithmetic: `imaxabs (end - start) / imaxabs (incr)`, which wraps at INTMAX_MIN; more than INT_MAX - 3 is refused.)
  const steps = wrapped(abs(end - start)) / wrapped(abs(step));
  if (steps > INT_MAX - 3n) return undefined;
  const width = !letters && (padding(m[1]) || padding(m[2])) ? Math.max(m[1].length, m[2].length) : 0;
  return { start, end, written, step, letters, width };
}

/** The words of a sequence, in order; null past `max` words. */
export function sequenceWords(s: BraceSequence, max: number): string[] | null {
  const out: string[] = [];
  for (let n = s.start; ; n += s.step) {
    if (out.length === max) return null;
    out.push(s.letters ? String.fromCharCode(Number(n)) : s.width ? padded(n, s.width) : String(n));
    const next = n + s.step;
    // (It stops past the end, and where the next value would overflow.)
    if (!fits(next) || (s.step < 0n ? next < s.end : next > s.end)) return out;
  }
}

/** A number padded with zeros to `width`, as bash 5.2's `printf ("%0*d")` of it cut to a C `int` does. */
function padded(n: bigint, width: number): string {
  const v = BigInt.asIntN(32, n);
  return v < 0n ? `-${String(-v).padStart(width - 1, '0')}` : String(v).padStart(width, '0');
}
