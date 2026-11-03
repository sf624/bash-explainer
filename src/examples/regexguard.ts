// The one way a regex that comes from a script (grep, sed, awk, perl, `[[ =~ ]]`, jq, a glob…) runs on data. JavaScript's
// matcher backtracks and cannot be stopped from the same thread, and `(a+)+$` takes 2^n steps on `aaa…!`, so every product
// would stall on one line. So each run is first walked here, on its own text: a small backtracking matcher over the
// pattern's tree (src/examples/regexparse.ts), which takes the paths JavaScript takes, in that order, keeps no result and
// counts its steps. Past the limit the regex is not run: `RegexRefused`, which every output says as "not computed"
// (`regex-not-computed`, src/messages.ts), never as a match or as none. Under it, JavaScript runs the regex. No clock is
// read: what is computed is the same on every machine.

import { type Node, Parser } from './regexparse';

/** Thrown instead of running a regex that may take too long: not a match, nor no match. */
export class RegexRefused extends Error {}

/**
 * The steps the runs in one `guarded` may take. A whole limit takes the walk about 40 ms, and JavaScript, on what the walk
 * lets through, about a millisecond. Everyday patterns on fifty lines of 80 characters, with the marks and the rerun of a
 * pipeline, take up to about 4e6 (test/examples-regexguard.test.ts, MUST_RUN).
 */
const LIMIT = 5e6;
/** A longer pattern is not read: reading it is recursive, and a pattern this long is no ordinary one. */
const MAX_SOURCE = 2000;
/** To JavaScript, `a{,3}` and `a{}` are plain text, which the parser, for the examples, reads as a repeat. */
const PLAIN_BRACE = /(?<!\\)\{(?=,\d*\}|\})/g;

const enum Op { Char, Split, Jump, Save, Assert, Ref, Reset, Loop, Clear, Round, Look, LookEnd, NotLook, NotLookEnd, Accept }

/** An instruction. `a` to `d`: what `walk` reads for its `op`. `groups`: the capture groups a round of a repeat clears. */
interface Ins { op: Op; a: number; b: number; c: number; d: number; exit: number; groups?: number[] }

const isLineEnd = (c: string) => '\n\r\u2028\u2029'.includes(c);

/** The characters a position matches, by code unit: a class of the regex, tried once for each. */
class CharSet {
  private readonly known = new Int8Array(256);
  private readonly more = new Map<number, boolean>();
  private readonly re: RegExp;
  constructor(source: string, flags: string) {
    this.re = new RegExp(source, flags);
  }

  has(unit: number): boolean {
    const small = unit < 256;
    if (small && this.known[unit]) return this.known[unit] > 0;
    const was = small ? undefined : this.more.get(unit);
    if (was !== undefined) return was;
    const is = this.re.test(String.fromCharCode(unit));
    if (small) this.known[unit] = is ? 1 : -1;
    else this.more.set(unit, is);
    return is;
  }
}

/** The groups of a node, for what a round of a repeat around them clears. */
function groupsIn(n: Node): number[] {
  switch (n.t) {
    case 'seq': return n.items.flatMap(groupsIn);
    case 'alt': return n.options.flatMap(groupsIn);
    case 'group': return [...(n.no ? [n.no] : []), ...groupsIn(n.node)];
    case 'repeat': return groupsIn(n.node);
    default: return [];
  }
}

/** The pattern as instructions for `walk`; throws `RegexRefused` for what it does not follow. Registers: 2 for each group, then those of the repeats and lookarounds. */
class Program {
  readonly code: Ins[] = [];
  readonly sets = new Map<string, number>();
  readonly charSets: CharSet[] = [];
  registers: number;
  anchored: boolean;
  /** The text a whole limit was not enough for: each stage of a pipeline asks again, and the answer is known. */
  tooLongOn?: string;

  constructor(tree: Node, source: string, private readonly groups: number, private readonly names: ReadonlyMap<string, number>, private readonly flags: string) {
    this.registers = 2 * (groups + 1);
    this.anchored = tree.t === 'seq' && source.startsWith('^') && !flags.includes('m');
    this.node(tree, false);
    this.emit(Op.Accept);
  }

  private emit(op: Op, a = 0, b = 0, c = 0, d = 0): Ins {
    const ins: Ins = { op, a, b, c, d, exit: 0 };
    this.code.push(ins);
    return ins;
  }

  private charSet(source: string): number {
    let id = this.sets.get(source);
    if (id === undefined) {
      id = this.charSets.length;
      this.charSets.push(new CharSet(source, this.flags));
      this.sets.set(source, id);
    }
    return id;
  }

  /** `back`: in a lookbehind JavaScript matches from right to left: the items last, and each character before the place. */
  private node(n: Node, back: boolean): void {
    switch (n.t) {
      case 'anchor':
        // (`^` and `$` at the ends of lines too, with the flag `m`: 4 and 5.)
        this.emit(Op.Assert, '^$bB'.indexOf(n.kind) + (this.flags.includes('m') && '^$'.includes(n.kind) ? 4 : 0));
        return;
      case 'char':
        this.emit(Op.Char, this.charSet(`\\u${n.c.charCodeAt(0).toString(16).padStart(4, '0')}`), back ? 1 : 0);
        return;
      case 'set':
        this.emit(Op.Char, this.charSet(n.source), back ? 1 : 0);
        return;
      case 'seq':
        for (const item of back ? [...n.items].reverse() : n.items) this.node(item, back);
        return;
      case 'alt': {
        const ends: Ins[] = [];
        for (const o of n.options.slice(0, -1)) {
          const split = this.emit(Op.Split);
          this.node(o, back);
          ends.push(this.emit(Op.Jump));
          split.a = this.code.length;
        }
        this.node(n.options[n.options.length - 1], back);
        for (const e of ends) e.a = this.code.length;
        return;
      }
      case 'backref':
        // (A group by its name or its number: JavaScript reads a number with no such group as a character, not followed here.)
        if (n.name === undefined ? n.n > this.groups : !this.names.has(n.name)) throw new RegexRefused();
        this.emit(Op.Ref, n.name === undefined ? n.n : this.names.get(n.name)!, back ? 1 : 0);
        return;
      case 'group':
        if (n.look) {
          const not = n.look.endsWith('!');
          const reg = this.registers;
          this.registers += 2;
          const start = this.emit(not ? Op.NotLook : Op.Look, reg);
          this.node(n.node, n.look.startsWith('<'));
          this.emit(not ? Op.NotLookEnd : Op.LookEnd, reg);
          start.b = this.code.length;
          return;
        }
        if (n.no) this.emit(Op.Save, 2 * n.no + (back ? 1 : 0));
        this.node(n.node, back);
        if (n.no) this.emit(Op.Save, 2 * n.no + (back ? 0 : 1));
        return;
      case 'repeat': {
        const count = this.registers++;
        const place = this.registers++;
        this.emit(Op.Reset, count);
        const at = this.code.length;
        const loop = this.emit(Op.Loop, count, n.min, n.max, n.lazy ? 1 : 0);
        this.emit(Op.Save, place);
        const groups = groupsIn(n.node);
        if (groups.length) this.emit(Op.Clear).groups = groups;
        this.node(n.node, back);
        this.emit(Op.Round, place, count, n.min, at);
        loop.exit = this.code.length;
      }
    }
  }
}

/** What `walk` can go back to: a place (the instruction, the place in the text), or a register to set back (-1 - the register, its value). */
let stack = new Int32Array(1 << 12);
let sp = 0;

/** A register changed, to be set back when the walk goes back past this. */
function set(r: number[], reg: number, value: number): void {
  stack[sp++] = -1 - reg;
  stack[sp++] = r[reg];
  r[reg] = value;
}

/**
 * Walks a run of `p` on `text` from `from`, as JavaScript does, and gives the steps it took (one for each instruction and
 * each entry gone back past), and where it matched; refused past `limit`.
 */
function walk(p: Program, text: string, from: number, once: boolean, ignoreCase: boolean, limit: number): { steps: number; match?: [number, number] } {
  const { code, charSets } = p;
  // (What one instruction can push: a place or two, and a round's groups.)
  const margin = 2 * p.registers + 8;
  const length = text.length;
  const r: number[] = new Array(p.registers);
  let steps = 0;
  for (let start = from; start <= length; start++) {
    r.fill(-1);
    let pc = 0;
    let pos = start;
    sp = 0;
    for (;;) {
      if (++steps > limit) throw new RegexRefused();
      if (sp + margin > stack.length) {
        const more = new Int32Array(stack.length * 2);
        more.set(stack);
        stack = more;
      }
      const i = code[pc++];
      let ok = true;
      switch (i.op) {
        case Op.Char: {
          const at = i.b ? pos - 1 : pos;
          if (at >= 0 && at < length && charSets[i.a].has(text.charCodeAt(at))) pos = i.b ? at : at + 1;
          else ok = false;
          break;
        }
        case Op.Split:
          stack[sp++] = i.a;
          stack[sp++] = pos;
          break;
        case Op.Jump:
          pc = i.a;
          break;
        case Op.Save:
          set(r, i.a, pos);
          break;
        case Op.Assert:
          if (i.a === 2 || i.a === 3) ok = (pos > 0 && /\w/.test(text[pos - 1])) !== (pos < length && /\w/.test(text[pos])) === (i.a === 2);
          else if (i.a === 0 || i.a === 4) ok = pos === 0 || (i.a === 4 && isLineEnd(text[pos - 1]));
          else ok = pos === length || (i.a === 5 && isLineEnd(text[pos]));
          break;
        case Op.Ref: {
          const [a, z] = [r[2 * i.a], r[2 * i.a + 1]];
          // (A group that took no part matches nothing, and succeeds.)
          if (a < 0 || z < 0) break;
          const at = i.b ? pos - (z - a) : pos;
          const same = (x: string, y: string) => (ignoreCase ? x.toLowerCase() === y.toLowerCase() : x === y);
          steps += z - a;
          if (at >= 0 && same(text.slice(at, at + z - a), text.slice(a, z))) pos = i.b ? at : at + z - a;
          else ok = false;
          break;
        }
        case Op.Reset:
          set(r, i.a, 0);
          break;
        case Op.Loop: {
          const round = r[i.a];
          if (round >= i.c) pc = i.exit;
          else if (round >= i.b) {
            stack[sp++] = i.d ? pc : i.exit;
            stack[sp++] = pos;
            if (i.d) pc = i.exit;
          }
          break;
        }
        case Op.Clear:
          for (const g of i.groups!) {
            if (r[2 * g] >= 0) set(r, 2 * g, -1);
            if (r[2 * g + 1] >= 0) set(r, 2 * g + 1, -1);
          }
          break;
        case Op.Round:
          // (A round that read nothing, past those the repeat must go, fails: JavaScript's rule.)
          if (pos === r[i.a] && r[i.b] >= i.c) ok = false;
          else {
            set(r, i.b, r[i.b] + 1);
            pc = i.d;
          }
          break;
        case Op.Look:
          set(r, i.a + 1, pos);
          set(r, i.a, sp + 2);
          break;
        case Op.LookEnd: {
          // (A lookaround that matched is not gone back into: only what it set is set back, later.)
          let to = r[i.a];
          steps += (sp - to) >> 1;
          for (let k = to; k < sp; k += 2) {
            if (stack[k] < 0) {
              stack[to++] = stack[k];
              stack[to++] = stack[k + 1];
            }
          }
          sp = to;
          pos = r[i.a + 1];
          break;
        }
        case Op.NotLook:
          set(r, i.a, sp + 2);
          stack[sp++] = i.b;
          stack[sp++] = pos;
          break;
        case Op.NotLookEnd: {
          // (It matched, so the lookaround fails: back to before it, and on from there.)
          const base = r[i.a];
          while (sp > base) {
            const value = stack[--sp];
            const kind = stack[--sp];
            if (kind < 0) r[-1 - kind] = value;
          }
          ok = false;
          break;
        }
        case Op.Accept:
          return { steps, match: [start, pos] };
      }
      if (ok) continue;
      let resumed = false;
      while (sp > 0 && !resumed) {
        steps++;
        const value = stack[--sp];
        const kind = stack[--sp];
        if (kind < 0) r[-1 - kind] = value;
        else {
          pc = kind;
          pos = value;
          resumed = true;
        }
      }
      if (!resumed) break;
    }
    if (once) break;
  }
  return { steps };
}

const programs = new Map<string, Program>();

function programOf(source: string, flags: string): Program {
  // (No Unicode regex is made here, and the walk does not follow them.)
  if (source.length > MAX_SOURCE || /[uv]/.test(flags)) throw new RegexRefused();
  const read = flags.replace(/[^ims]/g, '');
  const key = `${read}/${source}`;
  let p = programs.get(key);
  if (!p) {
    const parser = new Parser(source.replace(PLAIN_BRACE, '\\{'));
    const tree = parser.alt();
    if (parser.unread) throw new RegexRefused();
    p = new Program(tree, source, parser.groups, parser.names, read);
    // (A web page stays open for long, and awk's regexes can be new on each line.)
    if (programs.size >= 500) programs.clear();
    programs.set(key, p);
  }
  return p;
}

let depth = 0;
let left = LIMIT;

/** A RegExp whose runs are walked first; `test`, `replace`, `split` and `matchAll` all run through `exec`. */
class GuardedRegExp extends RegExp {
  private readonly program: Program;

  constructor(pattern: string | RegExp, flags?: string) {
    super(pattern, flags);
    this.program = programOf(this.source, this.flags);
  }

  override exec(text: string): RegExpExecArray | null {
    const searches = !this.sticky;
    const from = this.global || this.sticky ? this.lastIndex : 0;
    const p = this.program;
    if (p.tooLongOn === text) throw new RegexRefused();
    let steps: number;
    try {
      ({ steps } = walk(p, text, from, !searches || p.anchored, this.ignoreCase, left));
    } catch (e) {
      if (left === LIMIT) p.tooLongOn = text;
      throw e;
    } finally {
      if (stack.length > 1 << 20) stack = new Int32Array(1 << 12);
    }
    if (depth) left -= steps;
    return super.exec(text);
  }
}

/**
 * A regex that comes from a script, to run on data: each run throws `RegexRefused` when it would take too many steps on
 * its text, and making it does when the walk does not follow it. Use it within `guarded`, in place of `new RegExp`.
 */
export function scriptRegex(source: string, flags = ''): RegExp {
  return new GuardedRegExp(source, flags);
}

/** What the walk finds of a run from the start of `text`, for the test that compares it with JavaScript's. */
export function walked(source: string, flags: string, text: string): { steps: number; match?: [number, number] } {
  const p = programOf(new RegExp(source, flags).source, flags);
  return walk(p, text, 0, p.anchored, flags.includes('i'), LIMIT);
}

/**
 * What `run` gives, or `refused()` when a regex it runs is refused. The runs in it share one limit (those of a `guarded`
 * inside it as well): a run alone is limited either way, a run of many only here.
 */
export function guarded<T>(run: () => T, refused: () => T): T {
  if (!depth++) left = LIMIT;
  try {
    return run();
  } catch (e) {
    if (e instanceof RegexRefused) return refused();
    throw e;
  } finally {
    depth--;
    if (!depth) left = LIMIT;
  }
}
