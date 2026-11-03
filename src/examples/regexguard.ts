// The engine of every regex that comes from a script (grep, sed, awk, perl, `[[ =~ ]]`, jq, a glob…): JavaScript's own
// matcher cannot be stopped from its thread, and `(a+)+$` takes it 2^n steps on `aaa…!`, so it never runs one. This one
// takes the same paths in the same order, on an explicit stack, and counts what it does. Its result is the result: past
// the limit there is none, `RegexRefused`, which every output says as "not computed" (`regex-not-computed`,
// src/messages.ts), never as a match or as none. No clock is read: what is computed is the same on every machine.

import { inRanges, LINE_ENDS, type Node, Parser, type Ranges, WORD } from './regexparse';

/** Thrown instead of a result that would take too long to find: not a match, nor no match. */
export class RegexRefused extends Error {}

/**
 * Thrown instead of the digits of a number that depend on the machine (bash's and coreutils' printf read a `long double`,
 * src/examples/floatdigits.ts): no output, which the example says (`digits-not-computed`).
 */
export class MachineDigits extends Error {}

/** The note of the catalog (src/messages.ts) that an example says in place of its result. */
export type NotComputedId = 'regex-not-computed' | 'digits-not-computed';

/**
 * What the runs in one `guarded` may cost, in the walk's steps: a whole limit takes 30 to 90 ms, by the kind of pattern.
 * A line has one for each example and expansion, not one for all (docs/roadmap.md, "One line must not stop the whole tool").
 * Ordinary patterns on fifty lines of 90 characters take up to about 3e6, for all the runs of their line
 * (test/examples-regexguard.test.ts, MUST_RUN).
 */
const LIMIT = 1e7;
/** A longer pattern is not read: reading it is recursive, and a pattern this long is no ordinary one. */
const MAX_SOURCE = 2000;
/**
 * What else costs, in steps: a regex made (`NEW`, and a step per character of its pattern to look it up) and, the first
 * time in a limit, compiled (per character, whether or not it is kept from before: a refusal does not depend on what ran before); a
 * run; a match's result, each of its captures (an array slot and a string), and a step per character of what they hold.
 * Measured against the steps of a walk: each is about what it takes in time.
 */
const NEW = 64;
const COMPILE = 128;
const RUN = 24;
const MATCH = 64;
const CAPTURE = 8;
/** What the instructions of the patterns kept may come to. */
const MAX_KEPT = 1e5;

const enum Op { Unit, Fold, Set, Split, Jump, Save, Assert, Ref, Reset, Loop, Clear, Round, Look, LookEnd, NotLook, NotLookEnd, Accept }
/** What `Op.Assert` checks: `^`, `$`, `\b`, `\B`, and `^`, `$` at the ends of lines too (the flag `m`). */
const enum At { Start, End, Word, NotWord, LineStart, LineEnd }

/** An instruction. `a` to `d`: what `walk` reads for its `op`. */
interface Ins { op: Op; a: number; b: number; c: number; d: number; exit: number }

const WORD_UNITS = Uint8Array.from({ length: 128 }, (_, c) => (inRanges(WORD, c) ? 1 : 0));
const isWord = (c: number) => WORD_UNITS[c] === 1;

/** Each unit's canonical form with the flag `i`, as the specification's Canonicalize has it without `u`, and the units that share one. */
let canon: Uint16Array | undefined;
const sharing = new Map<number, number[]>();

function canonicalTable(): Uint16Array {
  if (!canon) {
    canon = new Uint16Array(0x10000);
    for (let unit = 0; unit < 0x10000; unit++) {
      const upper = String.fromCharCode(unit).toUpperCase();
      const to = upper.length === 1 ? upper.charCodeAt(0) : unit;
      const form = unit >= 128 && to < 128 ? unit : to;
      canon[unit] = form;
      const same = sharing.get(form);
      if (same) same.push(unit);
      else sharing.set(form, [unit]);
    }
  }
  return canon;
}

/** A class of a pattern, by code unit, with what the units below 256 gave so far. */
class CharSet {
  /** 1 in it, -1 not, 0 not known. */
  private readonly known = new Int8Array(256);
  /** What finding out for a unit above those costs, in steps. */
  readonly cost: number;
  constructor(private readonly ranges: Ranges, private readonly negated: boolean, private readonly fold: Uint16Array | undefined) {
    this.cost = 8 + 2 * ranges.length;
  }

  has(unit: number): boolean {
    if (unit >= 256) return this.find(unit);
    if (!this.known[unit]) this.known[unit] = this.find(unit) ? 1 : -1;
    return this.known[unit] > 0;
  }

  private find(unit: number): boolean {
    // (With the flag `i`: when a member has the unit's canonical form, in or out by `negated` after that.)
    const found = this.fold ? sharing.get(this.fold[unit])!.some((u) => inRanges(this.ranges, u)) : inRanges(this.ranges, unit);
    return found !== this.negated;
  }
}

/** All that decides how a walk of a program goes, and what it had left. */
interface LongRun { text: string; from: number; once: boolean; longest: boolean; left: number }

/** The pattern as instructions for `walk`. Registers: 2 for each group (the first for the whole match), then those of the repeats and lookarounds. */
class Program {
  readonly code: Ins[] = [];
  readonly sets = new Map<string, number>();
  readonly charSets: CharSet[] = [];
  readonly fold: Uint16Array | undefined;
  private readonly multiline: boolean;
  private readonly dotAll: boolean;
  registers: number;
  anchored: boolean;
  /**
   * The character of a pattern that starts with `x*` or `x+`, when no back-reference can tell where it started. A start that
   * fails has tried all the places that repeat reaches, so a later start within the run of `x` reaches none that is new:
   * `.*foo` looks through a line once, not once from each of its characters.
   */
  run?: Ins;
  private hasRef = false;
  /** Whether a node reads at least a character on every path, once for each node: a pattern can be 1000 repeats deep. */
  private readonly reading = new Map<Node, boolean>();

  constructor(tree: Node, source: string, readonly groups: number, readonly names: ReadonlyMap<string, number>, flags: string) {
    this.fold = flags.includes('i') ? canonicalTable() : undefined;
    this.multiline = flags.includes('m');
    this.dotAll = flags.includes('s');
    this.registers = 2 * (groups + 1);
    this.anchored = tree.t === 'seq' && source.startsWith('^') && !this.multiline;
    this.node(tree, false);
    this.emit(Op.Accept);
    if (!this.hasRef) this.run = this.leadingRun(tree);
  }

  private leadingRun(n: Node): Ins | undefined {
    if (n.t === 'seq' && n.items.length) return this.leadingRun(n.items[0]);
    if (n.t === 'group' && !n.look) return this.leadingRun(n.node);
    if (n.t !== 'repeat' || n.min > 1 || n.max !== Infinity || (n.node.t !== 'char' && n.node.t !== 'set')) return undefined;
    return this.one(n.node, false);
  }

  /** The instruction of one character. */
  private one(n: Node & { t: 'char' | 'set' }, back: boolean): Ins {
    if (n.t === 'set') return this.ins(Op.Set, this.charSet(n), back ? 1 : 0);
    const unit = n.c.charCodeAt(0);
    return this.fold ? this.ins(Op.Fold, this.fold[unit], back ? 1 : 0) : this.ins(Op.Unit, unit, back ? 1 : 0);
  }

  private ins(op: Op, a = 0, b = 0, c = 0, d = 0): Ins {
    return { op, a, b, c, d, exit: 0 };
  }

  private emit(op: Op, a = 0, b = 0, c = 0, d = 0): Ins {
    const ins = this.ins(op, a, b, c, d);
    this.code.push(ins);
    return ins;
  }

  private consumes(n: Node): boolean {
    let known = this.reading.get(n);
    if (known === undefined) {
      known = this.reads(n);
      this.reading.set(n, known);
    }
    return known;
  }

  private reads(n: Node): boolean {
    switch (n.t) {
      case 'char': case 'set': return true;
      case 'seq': return n.items.some((x) => this.consumes(x));
      case 'alt': return n.options.every((x) => this.consumes(x));
      case 'group': return !n.look && this.consumes(n.node);
      case 'repeat': return n.min > 0 && this.consumes(n.node);
      default: return false;
    }
  }

  /** What starts a round of a repeat: clearing the groups in it, which are numbered in a row. */
  private clear(n: Node & { t: 'repeat' }): void {
    if (n.lastGroup >= n.firstGroup) this.emit(Op.Clear, n.firstGroup, n.lastGroup);
  }

  private charSet(n: Node & { t: 'set' }): number {
    let id = this.sets.get(n.source);
    if (id === undefined) {
      id = this.charSets.length;
      this.charSets.push(n.dot && this.dotAll ? new CharSet([[0, 0xffff]], false, this.fold) : new CharSet(n.ranges, n.negated, this.fold));
      this.sets.set(n.source, id);
    }
    return id;
  }

  /** `back`: in a lookbehind the match goes from right to left: the items last, and each character before the place. */
  private node(n: Node, back: boolean): void {
    switch (n.t) {
      case 'anchor': {
        const kinds = { '^': this.multiline ? At.LineStart : At.Start, $: this.multiline ? At.LineEnd : At.End, b: At.Word, B: At.NotWord };
        this.emit(Op.Assert, kinds[n.kind]);
        return;
      }
      case 'char':
      case 'set':
        this.code.push(this.one(n, back));
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
        // (The parser and `new RegExp` have seen that it names a group.)
        this.hasRef = true;
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
        if (this.consumes(n.node) && ((n.min <= 1 && n.max === Infinity) || (n.min === 0 && n.max === 1))) {
          this.plainRepeat(n, back);
          return;
        }
        const count = this.registers++;
        const place = this.registers++;
        this.emit(Op.Reset, count);
        const at = this.code.length;
        const loop = this.emit(Op.Loop, count, n.min, n.max, n.lazy ? 1 : 0);
        this.emit(Op.Save, place);
        this.clear(n);
        this.node(n.node, back);
        this.emit(Op.Round, place, count, n.min, at);
        loop.exit = this.code.length;
      }
    }
  }

  /** `*`, `+` or `?` of what reads something each round: no count, and no round that reads nothing to look for. */
  private plainRepeat(n: Node & { t: 'repeat' }, back: boolean): void {
    const at = this.code.length;
    const round = () => {
      this.clear(n);
      this.node(n.node, back);
    };
    if (n.min === 1) {
      round();
      const split = this.emit(Op.Split, at);
      if (n.lazy) return;
      this.emit(Op.Jump, at);
      split.a = this.code.length;
      return;
    }
    const split = this.emit(Op.Split);
    const out = n.lazy ? this.emit(Op.Jump) : split;
    if (n.lazy) split.a = this.code.length;
    round();
    if (n.max === Infinity) this.emit(Op.Jump, at);
    out.a = this.code.length;
  }
}

/** What `walk` can go back to: a place (the instruction, the place in the text), or a register to set back (-1 - the register, its value). */
let stack = new Int32Array(1 << 12);
let sp = 0;
/** The registers of the run that goes on; backing all the way out of a start leaves them as they were, all -1. */
let registers = new Int32Array(1 << 8);

/** A register changed, to be set back when the walk goes back past this. */
function set(reg: number, value: number): void {
  stack[sp++] = -1 - reg;
  stack[sp++] = registers[reg];
  registers[reg] = value;
}

/**
 * The last run of each pattern past the limit: run again with no more left, it gets as far and no further. A line asks again
 * for each stage and example. `MAX_LONG_TEXT` is the longest text kept, and `MAX_LONG_CHARS` the characters of all kept.
 */
const longRuns = new Map<Program, LongRun>();
let longChars = 0;
const MAX_LONG_TEXT = 1e6;
const MAX_LONG_CHARS = 4e6;

let depth = 0;
let left = LIMIT;
/** The patterns whose compilation the runs of this limit paid for, kept or not: what a run costs is the same whatever ran before it in the process. */
const compiled = new Set<string>();

/** A whole limit, for what runs next. */
function fresh(): void {
  left = LIMIT;
  compiled.clear();
}

function refuse(): never {
  left = 0;
  throw new RegexRefused();
}

/** Past the limit in a walk. */
function tooLong(p: Program, text: string, from: number, once: boolean, longest: boolean, had: number): never {
  // (A text this long is not kept, and past a total of them none is: a text of 16 million characters is made by a loop of 24 doublings.)
  if (text.length <= MAX_LONG_TEXT) {
    const before = longRuns.get(p);
    longChars += text.length - (before ? before.text.length : 0);
    if (longChars > MAX_LONG_CHARS) {
      longRuns.clear();
      longChars = text.length;
    }
    longRuns.set(p, { text, from, once, longest, left: had });
  }
  refuse();
}

/**
 * Takes what a part of a run costs from what is left. A tool charges so what it makes of a match, when that can be many
 * times its size (four times with sed's `&&&&`): strings are made without a limit but memory, and running out of it cannot be caught.
 */
export function charge(cost: number): void {
  if (!depth) fresh();
  if ((left -= cost) < 0) refuse();
}

/**
 * Walks `p` on `text` from `from`, as JavaScript does, and gives the registers of the match, or nothing. `once`: from `from`
 * only. `longest`: of the matches at the first place that has one, the longest, and of those the one JavaScript's order
 * comes to first, as a POSIX tool wants it. It costs one step for each instruction and each entry gone back past.
 */
function walk(p: Program, text: string, from: number, once: boolean, longest: boolean): Int32Array | undefined {
  if (!depth) fresh();
  const { code, charSets, fold, run: repeated } = p;
  const runCost = repeated?.op === Op.Set ? charSets[repeated.a].cost : 1;
  // (What one instruction can push: a place or two, and a round's groups.)
  const margin = 2 * p.registers + 8;
  const length = text.length;
  // (Setting a register is far less than a step.)
  charge(RUN + (p.registers >> 3));
  const known = longRuns.get(p);
  if (known && left <= known.left && known.from === from && known.once === once && known.longest === longest && known.text === text) refuse();
  if (registers.length < p.registers) registers = new Int32Array(p.registers);
  const r = registers;
  r.fill(-1, 0, p.registers);
  const limit = left;
  let steps = 0;
  let best: Int32Array | undefined;
  sp = 0;
  // (How deep the stack was paid for. Its memory is slower than its steps: a new page, a copy.)
  let paid = Math.max(1 << 12, 2 * margin);
  if (stack.length < paid) stack = new Int32Array(paid);
  for (let start = from; start <= length; start++) {
    let pc = 0;
    let pos = start;
    for (;;) {
      if (++steps > limit) tooLong(p, text, from, once, longest, limit);
      if (sp + margin > paid) {
        paid *= 2;
        steps += paid >> 2;
        if (stack.length < paid) {
          const more = new Int32Array(paid);
          more.set(stack);
          stack = more;
        }
      }
      const i = code[pc++];
      let ok = true;
      switch (i.op) {
        case Op.Unit: {
          // (Out of the text, `charCodeAt` gives NaN, which equals nothing.)
          const at = i.b ? pos - 1 : pos;
          if (text.charCodeAt(at) === i.a) pos = i.b ? at : at + 1;
          else ok = false;
          break;
        }
        case Op.Fold: {
          const at = i.b ? pos - 1 : pos;
          if (fold![text.charCodeAt(at)] === i.a) pos = i.b ? at : at + 1;
          else ok = false;
          break;
        }
        case Op.Set: {
          const at = i.b ? pos - 1 : pos;
          const unit = text.charCodeAt(at);
          if (unit !== unit) {
            ok = false;
            break;
          }
          const chars = charSets[i.a];
          if (unit >= 256) steps += chars.cost;
          if (chars.has(unit)) pos = i.b ? at : at + 1;
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
          set(i.a, pos);
          break;
        case Op.Assert:
          switch (i.a) {
            case At.Start: ok = pos === 0; break;
            case At.End: ok = pos === length; break;
            case At.LineStart: ok = pos === 0 || inRanges(LINE_ENDS, text.charCodeAt(pos - 1)); break;
            case At.LineEnd: ok = pos === length || inRanges(LINE_ENDS, text.charCodeAt(pos)); break;
            default: ok = isWord(text.charCodeAt(pos - 1)) !== isWord(text.charCodeAt(pos)) === (i.a === At.Word);
          }
          break;
        case Op.Ref: {
          const a = r[2 * i.a];
          const z = r[2 * i.a + 1];
          // (A group that took no part matches nothing, and succeeds.)
          if (a < 0 || z < 0) break;
          const size = z - a;
          const at = i.b ? pos - size : pos;
          ok = at >= 0 && at + size <= length;
          for (let k = 0; ok && k < size; k++) {
            steps++;
            const x = text.charCodeAt(a + k);
            const y = text.charCodeAt(at + k);
            ok = fold ? fold[x] === fold[y] : x === y;
          }
          if (ok) pos = i.b ? at : at + size;
          break;
        }
        case Op.Reset:
          set(i.a, 0);
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
          steps += 2 * (i.b - i.a + 1);
          for (let g = i.a; g <= i.b; g++) {
            if (r[2 * g] >= 0) set(2 * g, -1);
            if (r[2 * g + 1] >= 0) set(2 * g + 1, -1);
          }
          break;
        case Op.Round:
          // (A round that read nothing, past those the repeat must go, fails: JavaScript's rule.)
          if (pos === r[i.a] && r[i.b] >= i.c) ok = false;
          else {
            set(i.b, r[i.b] + 1);
            pc = i.d;
          }
          break;
        case Op.Look:
          set(i.a + 1, pos);
          set(i.a, sp + 2);
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
          set(i.a, sp + 2);
          stack[sp++] = i.b;
          stack[sp++] = pos;
          break;
        case Op.NotLookEnd: {
          // (It matched, so the lookaround fails: back to before it, and on from there.)
          const base = r[i.a];
          steps += (sp - base) >> 1;
          while (sp > base) {
            const value = stack[--sp];
            const kind = stack[--sp];
            if (kind < 0) r[-1 - kind] = value;
          }
          ok = false;
          break;
        }
        case Op.Accept:
          r[0] = start;
          r[1] = pos;
          if (!longest || pos === length) {
            left -= steps;
            return r;
          }
          if (!best || pos > best[1]) {
            steps += p.registers;
            best = r.slice(0, 2 * (p.groups + 1));
          }
          ok = false;
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
    if (best || once || p.anchored) break;
    while (repeated && start < length) {
      const unit = text.charCodeAt(start);
      steps += unit < 256 ? 1 : runCost;
      if (steps > limit) tooLong(p, text, from, once, longest, limit);
      const inRun = repeated.op === Op.Unit ? unit === repeated.a : repeated.op === Op.Fold ? fold![unit] === repeated.a : charSets[repeated.a].has(unit);
      if (!inRun) break;
      start++;
    }
  }
  left -= steps;
  return best;
}

/** The result of a match, as `RegExp.prototype.exec` gives it; what it holds is charged before it is made. */
function resultOf(p: Program, text: string, r: Int32Array, withIndices: boolean): RegExpExecArray {
  const n = p.groups + 1;
  let cost = MATCH + n * CAPTURE;
  for (let k = 0; k < n; k++) if (r[2 * k + 1] >= 0) cost += r[2 * k + 1] - r[2 * k];
  charge(cost);
  const m = new Array(n) as RegExpExecArray;
  const pairs = new Array(n) as [number, number][];
  for (let k = 0; k < n; k++) {
    const taken = r[2 * k] >= 0 && r[2 * k + 1] >= 0;
    m[k] = (taken ? text.slice(r[2 * k], r[2 * k + 1]) : undefined)!;
    pairs[k] = (taken ? [r[2 * k], r[2 * k + 1]] : undefined)!;
  }
  m.index = r[0];
  m.input = text;
  const groups = <T>(all: T[]) => {
    if (!p.names.size) return undefined;
    const out = Object.create(null) as Record<string, T>;
    for (const [name, no] of p.names) out[name] = all[no];
    return out;
  };
  m.groups = groups(m);
  if (withIndices) (m as unknown as { indices: unknown }).indices = Object.assign(pairs, { groups: groups(pairs) });
  return m;
}

/** A run of `p`: what it matched, or null. */
function run(p: Program, text: string, from: number, once: boolean, withIndices: boolean, longest: boolean): RegExpExecArray | null {
  try {
    const r = walk(p, text, from, once, longest);
    return r ? resultOf(p, text, r, withIndices) : null;
  } finally {
    if (stack.length > 1 << 20) stack = new Int32Array(1 << 12);
  }
}

const programs = new Map<string, Program>();
let kept = 0;

function programOf(source: string, flags: string): Program {
  // (No Unicode regex is made here, and the engine does not read them.)
  if (source.length > MAX_SOURCE || flags.includes('u') || flags.includes('v')) throw new RegexRefused();
  const read = [...flags].filter((f) => 'ims'.includes(f)).join('');
  const key = `${read}/${source}`;
  if (!compiled.has(key)) charge(COMPILE * source.length);
  let p = programs.get(key);
  if (!p) {
    const parser = new Parser(source);
    const tree = parser.alt();
    if (parser.unread) throw new RegexRefused();
    p = new Program(tree, source, parser.groups, parser.names, read);
    // (A web page stays open for long, and awk's regexes can be new on each line.)
    if (kept > MAX_KEPT) {
      programs.clear();
      longRuns.clear();
      longChars = 0;
      kept = 0;
    }
    kept += p.code.length;
    programs.set(key, p);
  }
  compiled.add(key);
  return p;
}

/**
 * A RegExp that this engine runs. Its own matcher is never run: making one only checks the pattern's syntax, as before. All
 * that `replace`, `split`, `match`, `matchAll`, `search` and `test` do by the specification goes through `exec`, on this
 * class (the species), so they need nothing else: results, `lastIndex`, and an empty match's next place stay theirs.
 */
class GuardedRegExp extends RegExp {
  private readonly program: Program;
  private readonly moves: boolean;
  private readonly withIndices: boolean;

  constructor(pattern: string | RegExp, flags?: string) {
    super(pattern, flags);
    charge(NEW + this.source.length);
    this.program = programOf(this.source, this.flags);
    this.moves = this.global || this.sticky;
    this.withIndices = this.flags.includes('d');
  }

  override exec(text: string): RegExpExecArray | null {
    const m = run(this.program, text, this.moves ? this.lastIndex : 0, this.sticky, this.withIndices, false);
    if (this.moves) this.lastIndex = m ? m.index + m[0].length : 0;
    return m;
  }

  /** What a POSIX tool finds from `at` on (`walk`, `longest`). */
  longest(text: string, at: number): RegExpExecArray | null {
    return run(this.program, text, at, this.sticky, this.withIndices, true);
  }
}

/**
 * A regex that comes from a script, to run on data: each run throws `RegexRefused` when it would cost too much on its
 * text, and making it does when the engine does not read it. Use it within `guarded`, in place of `new RegExp`.
 */
export function scriptRegex(source: string, flags = ''): RegExp {
  return new GuardedRegExp(source, flags);
}

/** The match of a regex from `at` on that a POSIX tool finds: the leftmost and, of those there, the longest, with its groups. */
export function longestExec(source: string, flags: string, text: string, at: number): RegExpExecArray | null {
  return new GuardedRegExp(source, flags).longest(text, at);
}

/**
 * A string too long for JavaScript (of what a tool makes of matches), or a stack too deep: one more thing that costs too
 * much. No other RangeError: a precision no number method takes or a code point out of range is a bug of what threw it.
 */
function tooBigForJavaScript(e: unknown): boolean {
  return e instanceof RangeError && /Invalid string length|Maximum call stack/.test(e.message);
}

/**
 * What `run` gives, or `refused(id)` when a regex it runs is refused (or the digits it prints depend on the machine), with the
 * note to say instead. The runs in it share one limit (those of a `guarded` inside it as well): a run alone is limited
 * either way, a run of many only here.
 */
export function guarded<T>(run: () => T, refused: (id: NotComputedId) => T): T {
  if (!depth++) fresh();
  try {
    return run();
  } catch (e) {
    if (e instanceof MachineDigits) return refused('digits-not-computed');
    if (e instanceof RegexRefused || tooBigForJavaScript(e)) return refused('regex-not-computed');
    throw e;
  } finally {
    depth--;
  }
}

/** The characters of the texts kept to be refused again, for the tests. */
export function keptChars(): number {
  return longChars;
}

/** What the runs in `run` cost, for the tests and the figures of the limit. */
export function costOf(run: () => void): number {
  return guarded(() => {
    const before = left;
    run();
    return before - left;
  }, () => Infinity);
}
