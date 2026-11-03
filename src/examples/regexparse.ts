// The structure of a JavaScript regex: what the examples generate lines from (src/examples/regex.ts) and what the guard
// reads before one runs (src/examples/regexguard.ts). It reads what JavaScript reads (but `{,n}`, which the tools
// read as a repeat, and the examples with them; the guard knows), or says `unread`: the guard is only as good as this.

export type Node =
  | { t: 'seq'; items: Node[] }
  | { t: 'alt'; options: Node[] }
  | { t: 'char'; c: string }
  /** `source`: the class as JavaScript reads it (`[a-z]`, `\\d`, `.`). */
  | { t: 'set'; source: string; pick: (v: number) => string | undefined }
  | { t: 'repeat'; node: Node; min: number; max: number; lazy: boolean }
  | { t: 'group'; node: Node; no: number; look?: string }
  /** `name`: of `\k<name>`, whose number is known when the whole pattern is read. */
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

/** Characters for a JS class `[…]`, in a readable order (letters and digits first). */
function classPicker(body: string, negated: boolean): (v: number) => string | undefined {
  const re = new RegExp(`[${negated ? '^' : ''}${body}]`);
  const pool = negated ? 'xyzabc_-.1 ' : `${UPPER}${LETTERS}${DIGITS}-_. :/@,;!#%&=+*?$^()[]{}|<>'"\\~\`\t`;
  const ok = pool.split('').filter((ch) => re.test(ch));
  // Prefer the first characters of each range (`[0-9]` → 0, 1, 2…; `[A-Z]` → A, B…).
  const order = body.match(/(.)-(.)/g)?.flatMap((r) => {
    const lo = r.charCodeAt(0);
    const hi = r.charCodeAt(2);
    return Array.from({ length: Math.min(hi - lo + 1, 26) }, (_, k) => String.fromCharCode(lo + k));
  }) ?? [];
  const chars = [...new Set([...order.filter((ch) => re.test(ch)), ...ok])];
  return (v) => (chars.length ? chars[v % chars.length] : undefined);
}

export class Parser {
  i = 0;
  groups = 0;
  /** The numbers of the named groups. */
  readonly names = new Map<string, number>();
  /** Something it does not read as JavaScript does: modifiers (`(?i:`), `\c` before no letter, a decimal escape of two digits. */
  unread = false;
  constructor(private s: string) {}

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
      let atom = this.atom();
      for (;;) {
        const q = /^(\*|\+|\?|\{(\d*)(,?)(\d*)\})\??/.exec(this.s.slice(this.i));
        if (!q) break;
        this.i += q[0].length;
        let min = 0;
        let max = Infinity;
        if (q[1] === '+') min = 1;
        else if (q[1] === '?') max = 1;
        else if (q[1].startsWith('{')) {
          // {m} → exactly m; {m,} → at least m; {m,n} → m to n; {,n} → at most n.
          min = q[2] ? Number(q[2]) : 0;
          max = !q[3] ? min : q[4] ? Number(q[4]) : Infinity;
        }
        atom = { t: 'repeat', node: atom, min, max, lazy: q[0].length > q[1].length };
      }
      items.push(atom);
    }
    return { t: 'seq', items };
  }

  private atom(): Node {
    const c = this.s[this.i++];
    if (c === '(') {
      let capture = true;
      let look: string | undefined;
      const ext = /^\?(:|=|!|<=|<!|<[A-Za-z_]\w*>)/.exec(this.s.slice(this.i));
      if (ext) {
        this.i += ext[0].length;
        if (ext[1] === ':') capture = false;
        else if (!ext[1].startsWith('<') || ext[1].startsWith('<=') || ext[1].startsWith('<!')) { capture = false; look = ext[1]; }
      }
      else if (this.s[this.i] === '?') this.unread = true;
      const no = capture ? ++this.groups : 0;
      if (ext?.[1].startsWith('<') && capture) this.names.set(ext[1].slice(1, -1), no);
      const node = this.alt();
      this.i++; // ')'
      return { t: 'group', node, no, look };
    }
    if (c === '[') {
      let j = this.i;
      const negated = this.s[j] === '^';
      if (negated) j++;
      let body = '';
      while (j < this.s.length && this.s[j] !== ']') {
        if (this.s[j] === '\\') { body += this.s.slice(j, j + 2); j += 2; continue; }
        body += this.s[j++];
      }
      this.i = j + 1;
      return { t: 'set', source: `[${negated ? '^' : ''}${body}]`, pick: classPicker(body, negated) };
    }
    if (c === '.') return { t: 'set', source: '.', pick: (v) => 'xyzabc'[v % 6] };
    if (c === '^' || c === '$') return { t: 'anchor', kind: c };
    if (c === '\\') {
      const n = this.s[this.i++];
      // (One character to JavaScript: `\x41`, `\u0041`, `\cA`, `\012`.)
      const coded = /^(?:x[\da-fA-F]{2}|u[\da-fA-F]{4}|c[A-Za-z]|0[0-7]{0,2})/.exec(this.s.slice(this.i - 1))?.[0];
      if (coded) {
        this.i += coded.length - 1;
        return { t: 'char', c: String.fromCharCode(n === 'c' ? coded.charCodeAt(1) % 32 : parseInt(coded.slice(n === '0' ? 0 : 1), n === '0' ? 8 : 16)) };
      }
      if (n === 'c' || (/[1-9]/.test(n) && /\d/.test(this.s[this.i] ?? ''))) this.unread = true;
      if (/[1-9]/.test(n)) return { t: 'backref', n: Number(n) };
      if (n === 'k' && this.s[this.i] === '<') {
        const end = this.s.indexOf('>', this.i);
        const name = this.s.slice(this.i + 1, end);
        this.i = end + 1;
        return { t: 'backref', n: 0, name };
      }
      if (n === 'b' || n === 'B') return { t: 'anchor', kind: n };
      if ('dwsDWS'.includes(n)) return { t: 'set', source: `\\${n}`, pick: shorthand(n) };
      const esc: Record<string, string> = { t: '\t', n: '\n', r: '\r', f: '\f', v: '\v' };
      return { t: 'char', c: esc[n] ?? n };
    }
    return { t: 'char', c };
  }
}
