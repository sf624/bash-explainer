// The structure of a JavaScript regex: what the examples generate lines from (src/examples/regex.ts) and what the engine
// runs (src/examples/regexguard.ts). It reads what JavaScript reads, annex B included, of a pattern that `new RegExp`
// accepts, or says `unread`.

/** Code units, from and to. */
export type Ranges = readonly (readonly [number, number])[];

export type Node =
  | { t: 'seq'; items: Node[] }
  | { t: 'alt'; options: Node[] }
  | { t: 'char'; c: string }
  /** `source`: the class as written (`[a-z]`, `\\d`, `.`). A unit is in it when it is in `ranges`, or, with `negated`, when it is not. `dot`: `.`, which the flag `s` changes. */
  | { t: 'set'; source: string; ranges: Ranges; negated: boolean; pick: (v: number) => string | undefined; dot?: boolean }
  | { t: 'repeat'; node: Node; min: number; max: number; lazy: boolean }
  | { t: 'group'; node: Node; no: number; look?: string }
  /** `name`: of `\\k<name>`, whose number is known when the whole pattern is read. */
  | { t: 'backref'; n: number; name?: string }
  | { t: 'anchor'; kind: '^' | '$' | 'b' | 'B' };

const DIGITS = '1234567890';
const LETTERS = 'abcdefghijklmnopqrstuvwxyz';
const UPPER = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

function shorthand(c: string): (v: number) => string | undefined {
  switch (c) {
    case 'd': return (v) => DIGITS[v % 9];
    case 'w': return (v) => LETTERS[v % 26];
    case 's': return () => ' ';
    case 'D': return (v) => LETTERS[v % 26];
    case 'W': return () => '-';
    // \S
    default: return (v) => LETTERS[v % 26];
  }
}

/** Whether a unit is in the ranges. */
export const inRanges = (ranges: Ranges, unit: number): boolean => ranges.some(([from, to]) => unit >= from && unit <= to);

/** All the units that are not in sorted, separate ranges. */
function complement(ranges: Ranges): Ranges {
  const out: [number, number][] = [];
  let at = 0;
  for (const [from, to] of ranges) {
    if (from > at) out.push([at, from - 1]);
    at = to + 1;
  }
  out.push([at, 0xffff]);
  return out;
}

const DIGIT: Ranges = [[0x30, 0x39]];
export const WORD: Ranges = [[0x30, 0x39], [0x41, 0x5a], [0x5f, 0x5f], [0x61, 0x7a]];
const SPACE: Ranges = [[0x09, 0x0d], [0x20, 0x20], [0xa0, 0xa0], [0x1680, 0x1680], [0x2000, 0x200a], [0x2028, 0x2029], [0x202f, 0x202f], [0x205f, 0x205f], [0x3000, 0x3000], [0xfeff, 0xfeff]];
/** What `.` does not read, without the flag `s`. */
export const LINE_ENDS: Ranges = [[0x0a, 0x0a], [0x0d, 0x0d], [0x2028, 0x2029]];
const SHORTHAND: Record<string, Ranges> = { d: DIGIT, D: complement(DIGIT), w: WORD, W: complement(WORD), s: SPACE, S: complement(SPACE) };

/** Characters for a JS class `[…]`, in a readable order (letters and digits first). */
function classPicker(body: string, negated: boolean, ranges: Ranges): (v: number) => string | undefined {
  let chars: string[] | undefined;
  const list = () => {
    const isIn = (ch: string) => inRanges(ranges, ch.charCodeAt(0)) !== negated;
    const pool = negated ? 'xyzabc_-.1 ' : `${UPPER}${LETTERS}${DIGITS}-_. :/@,;!#%&=+*?$^()[]{}|<>'"\\~\`\t`;
    const ok = pool.split('').filter(isIn);
    // Prefer the first characters of each range (`[0-9]` → 0, 1, 2…; `[A-Z]` → A, B…).
    const order = body.match(/(.)-(.)/g)?.flatMap((r) => {
      const lo = r.charCodeAt(0);
      const hi = r.charCodeAt(2);
      return Array.from({ length: Math.min(hi - lo + 1, 26) }, (_, k) => String.fromCharCode(lo + k));
    }) ?? [];
    return [...new Set([...order.filter(isIn), ...ok])];
  };
  return (v) => {
    chars ??= list();
    return chars.length ? chars[v % chars.length] : undefined;
  };
}

/** The number of capture groups of a pattern, and whether one has a name: the reading of `\12` and `\k` depends on them. */
function capturesOf(s: string): { total: number; named: boolean } {
  let total = 0;
  let named = false;
  let inClass = false;
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '\\') i++;
    else if (inClass) inClass = s[i] !== ']';
    else if (s[i] === '[') inClass = true;
    else if (s[i] === '(') {
      const name = s[i + 1] === '?' && s[i + 2] === '<' && s[i + 3] !== '=' && s[i + 3] !== '!';
      if (s[i + 1] !== '?' || name) total++;
      named ||= name;
    }
  }
  return { total, named };
}

export class Parser {
  i = 0;
  groups = 0;
  /** The numbers of the named groups. */
  readonly names = new Map<string, number>();
  /** Something it does not read: modifiers (`(?i:`), a name that is not plain, a name given twice. */
  unread = false;
  /** A `{,n}` or `{}`: text to JavaScript and to PCRE2 before 10.43, a repeat to later ones and to perl 5.34. */
  openBrace = false;
  private readonly total: number;
  private readonly named: boolean;
  constructor(private s: string) {
    ({ total: this.total, named: this.named } = capturesOf(s));
  }

  alt(): Node {
    const options = [this.seq()];
    while (this.s[this.i] === '|') {
      this.i++;
      options.push(this.seq());
    }
    return options.length === 1 ? options[0] : { t: 'alt', options };
  }

  private seq(): Node {
    const items: Node[] = [];
    while (this.i < this.s.length && this.s[this.i] !== '|' && this.s[this.i] !== ')') {
      const atom = this.atom();
      // (`{` that starts no such repeat is text, which `atom` reads: `a{,3}`, `a{}`, `a{1`.)
      const q = /^(\*|\+|\?|\{(\d+)(,?)(\d*)\})\??/.exec(this.s.slice(this.i));
      if (!q) {
        items.push(atom);
        continue;
      }
      this.i += q[0].length;
      let min = 0;
      let max = Infinity;
      if (q[1] === '+') min = 1;
      else if (q[1] === '?') max = 1;
      else if (q[2]) {
        min = Number(q[2]);
        max = !q[3] ? min : q[4] ? Number(q[4]) : Infinity;
      }
      items.push({ t: 'repeat', node: atom, min, max, lazy: q[0].length > q[1].length });
    }
    return { t: 'seq', items };
  }

  private group(): Node {
    let capture = true;
    let look: string | undefined;
    const ext = /^\?(:|=|!|<=|<!|<[A-Za-z_$][\w$]*>)/.exec(this.s.slice(this.i));
    if (ext) {
      this.i += ext[0].length;
      if (!ext[1].startsWith('<') || ext[1].startsWith('<=') || ext[1].startsWith('<!')) {
        capture = false;
        if (ext[1] !== ':') look = ext[1];
      }
    } else if (this.s[this.i] === '?') this.unread = true;
    const no = capture ? ++this.groups : 0;
    if (ext && capture) {
      const name = ext[1].slice(1, -1);
      if (this.names.has(name)) this.unread = true;
      this.names.set(name, no);
    }
    const node = this.alt();
    this.i++; // ')'
    return { t: 'group', node, no, look };
  }

  /** A class, from after its `[`. Between two members, `-` is a range when both are one character, and otherwise itself. */
  private set(): Node {
    const negated = this.s[this.i] === '^';
    if (negated) this.i++;
    const from = this.i;
    const ranges: (readonly [number, number])[] = [];
    const add = (m: number | Ranges) => { if (typeof m === 'number') ranges.push([m, m]); else ranges.push(...m); };
    while (this.i < this.s.length && this.s[this.i] !== ']') {
      const a = this.member();
      if (this.s[this.i] === '-' && this.s[this.i + 1] !== ']') {
        this.i++;
        const b = this.member();
        if (typeof a === 'number' && typeof b === 'number') ranges.push([a, b]);
        else [a, b, 0x2d].forEach(add);
      } else add(a);
    }
    const body = this.s.slice(from, this.i);
    this.i++;
    return { t: 'set', source: `[${negated ? '^' : ''}${body}]`, ranges, negated, pick: classPicker(body, negated, ranges) };
  }

  /** What a place of a class holds: one unit, or a shorthand. */
  private member(): number | Ranges {
    const c = this.s.charCodeAt(this.i++);
    if (c !== 0x5c) return c;
    const n = this.s[this.i];
    if (n in SHORTHAND) {
      this.i++;
      return SHORTHAND[n];
    }
    if (n === 'b') {
      this.i++;
      return 8;
    }
    if (n === 'c') {
      // (In a class a digit and `_` count too; before anything else the backslash is itself.)
      const x = this.s[this.i + 1] ?? '';
      if (!/^\w$/.test(x)) return 0x5c;
      this.i += 2;
      return x.charCodeAt(0) % 32;
    }
    return this.unit();
  }

  /** The unit of an escape of one character, from after its backslash. */
  private unit(): number {
    const rest = this.s.slice(this.i);
    const coded = /^(?:x[\da-fA-F]{2}|u[\da-fA-F]{4})/.exec(rest)?.[0];
    if (coded) {
      this.i += coded.length;
      return parseInt(coded.slice(1), 16);
    }
    const octal = /^(?:[0-3][0-7]{0,2}|[4-7][0-7]?)/.exec(rest)?.[0];
    if (octal) {
      this.i += octal.length;
      return parseInt(octal, 8);
    }
    const esc: Record<string, number> = { t: 9, n: 10, v: 11, f: 12, r: 13 };
    const unit = esc[this.s[this.i]] ?? this.s.charCodeAt(this.i);
    this.i++;
    return unit;
  }

  private atom(): Node {
    const c = this.s[this.i++];
    if (c === '(') return this.group();
    if (c === '[') return this.set();
    if (c === '.') return { t: 'set', source: '.', ranges: LINE_ENDS, negated: true, dot: true, pick: (v) => 'xyzabc'[v % 6] };
    if (c === '^' || c === '$') return { t: 'anchor', kind: c };
    if (c === '{' && /^(?:,\d*)?\}/.test(this.s.slice(this.i))) this.openBrace = true;
    if (c !== '\\') return { t: 'char', c };
    const n = this.s[this.i];
    if (n === 'b' || n === 'B') {
      this.i++;
      return { t: 'anchor', kind: n };
    }
    if (n in SHORTHAND) {
      this.i++;
      return { t: 'set', source: `\\${n}`, ranges: SHORTHAND[n], negated: false, pick: shorthand(n) };
    }
    // (A number no greater than the groups of the whole pattern is one of them; any other is an octal escape, or a digit.)
    const number = /^[1-9]\d*/.exec(this.s.slice(this.i))?.[0];
    if (number && Number(number) <= this.total) {
      this.i += number.length;
      return { t: 'backref', n: Number(number) };
    }
    // (`new RegExp` has seen that a name follows, if there are named groups.)
    const end = n === 'k' && this.named ? this.s.indexOf('>', this.i) : -1;
    if (end >= 0) {
      const name = this.s.slice(this.i + 2, end);
      this.i = end + 1;
      return { t: 'backref', n: 0, name };
    }
    if (n === 'c') {
      const x = this.s[this.i + 1] ?? '';
      if (!/^[A-Za-z]$/.test(x)) return { t: 'char', c: '\\' };
      this.i += 2;
      return { t: 'char', c: String.fromCharCode(x.charCodeAt(0) % 32) };
    }
    return { t: 'char', c: String.fromCharCode(this.unit()) };
  }
}
