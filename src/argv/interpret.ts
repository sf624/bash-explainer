// The generic reader of a command's words: which are options, option values, operands, subcommands
// and wrapped commands, according to the command's spec (src/argv/spec.ts).
//
// It works in four passes: split the words into options and operands, choose the mode, match the
// operands with the spec's patterns, and read the words of a command slot as a command of its own.
import { isExpressionStart } from '../embedded/find';
import type { Text } from '../i18n';
import type { CommandSlot, CommandSpec, Condition, OperandSpec, OptionSpec, PatternOption, ValueSpec } from './spec';

/** A word of the command line, as the program will see it. */
export interface ArgWord {
  /** Its text after quote removal, when that is known without running anything (`-F'|'` is `-F|`). */
  value?: string;
  /** Otherwise, the text known at its start (`--file=` of `--file=$f`, `-I` of `-I{}`), if any. */
  prefix?: string;
}

export type ArgRole =
  /** An option, alone or as a letter of a cluster. `value` is a value written in the same word (`-n5`, `--file=x`). */
  | { role: 'option'; flag: string; spec: OptionSpec; text: Text; part?: Range; value?: ValueRole; disables?: boolean }
  /** A word of several short options (`-xvf`, `-rn5`): one role per letter, in order, with their parts. */
  | { role: 'cluster'; letters: ArgRole[] }
  /** An option recognized by its form (`kill -TERM`, `head -5`). */
  | { role: 'pattern-option'; flag: string; pattern: PatternOption; text: Text }
  | { role: 'unknown-option'; flag: string; part?: Range; value?: ValueRole }
  | ValueRole
  /** Dashless letters in the first word (`tar cvf`). */
  | { role: 'old-style'; letters: ArgRole[] }
  | { role: 'end-of-options' }
  /** An operand; `spec` is absent when no pattern of the spec fits the operands (see `ArgvParse.unmatched`). */
  | { role: 'operand'; spec?: OperandSpec; index: number; assignment?: boolean }
  /** The rest of the words are read with the subcommand's spec. */
  | { role: 'subcommand'; name: string; spec: CommandSpec; parse: ArgvParse }
  /** The first word of a command run by this one; `parse` reads the words after it (absent for a shell string). */
  | { role: 'command'; slot: CommandSlot; name?: string; spec?: CommandSpec; parse?: ArgvParse }
  /** The word that ends an option's command (`;` of `find -exec … ;`). */
  | { role: 'terminator' };

/** The value of an option; `attached` is where it starts in the word, when it is written in the option's word. */
export interface ValueRole { role: 'value'; of: string; spec?: ValueSpec; index: number; attached?: number }

/** Offsets in a word's text: start, and end (exclusive). */
export type Range = [number, number];

export interface RoleAt { word: number; role: ArgRole }

export interface ArgvParse {
  /** 'git branch'. */
  command: string;
  mode?: string;
  /** One role per word, in order. Words of a subcommand or of a command slot are in the `parse` of its role. */
  roles: RoleAt[];
  /** Operands that matched no alternative (too many, too few): shown as plain words. */
  unmatched: number[];
  /** Where an expression read by `operandParser` starts (`find . -name x`: the index of `-name`). */
  expression?: number;
}

export interface InterpretContext {
  /** The command's name, for `ArgvParse.command`. */
  name?: string;
  /** The spec of a command named in a command slot. */
  lookup?: (name: string) => CommandSpec | undefined;
  /** The work the operand matcher may do for one pattern before it gives up (default 10000 steps). */
  maxSteps?: number;
}

const EMPTY: CommandSpec = { summary: { ja: '', en: '' } };
const ASSIGNMENT = /^[A-Za-z_]\w*=/;
/** What is known of a word's text: all of it, or its start. */
const known = (w: ArgWord): string => w.value ?? w.prefix ?? '';

/** Reads the words of a command (its arguments, without the name) with its spec. */
export function interpret(spec: CommandSpec, words: ArgWord[], ctx: InterpretContext = {}): ArgvParse {
  return new Reader(words, ctx).read(spec, 0, words.length, ctx.name ?? '', []);
}

const valuesOf = (o: OptionSpec): ValueSpec[] => (o.value === undefined ? [] : Array.isArray(o.value) ? o.value : [o.value]);
/** An item that takes every word left: the command of an `exec` or `current-shell` slot. */
const takesRest = (o: OperandSpec): boolean => !!o.command && o.command.run !== 'shell-string';

class Reader {
  constructor(private readonly words: ArgWord[], private readonly ctx: InterpretContext) {}

  read(spec: CommandSpec, from: number, to: number, command: string, inherited: OptionSpec[]): ArgvParse {
    const options = [...(spec.options ?? []), ...inherited];
    const style = spec.style ?? 'gnu';
    const roles = new Map<number, ArgRole>();
    const given: Given = { specs: [], flags: [] };
    const operands: number[] = [];
    const parse: ArgvParse = { command, roles: [], unmatched: [] };
    let endOpts = false;
    let afterDashes: number | undefined;
    let end = to;
    const state: OptionState = { spec, options, roles, given, end };
    for (let i = from; i < end; i++) {
      const w = this.words[i];
      const value = w.value;
      if (!endOpts && value === '--' && spec.dashDash !== 'literal') {
        roles.set(i, { role: 'end-of-options' });
        endOpts = true;
        if (typeof spec.dashDash === 'object') { afterDashes = i + 1; break; }
        continue;
      }
      if (spec.operandParser === 'find-expression' && isExpressionStart(known(w)) && !findOption(options, value ?? '', false)) {
        parse.expression = i;
        end = i;
        break;
      }
      if (!endOpts && i === from && spec.oldStyle) {
        const used = this.oldStyle(state, i);
        if (used >= 0) { i = used; continue; }
      }
      if (!endOpts) {
        const used = this.option(state, i);
        if (used >= 0) { i = used; continue; }
      }
      // An operand. The first one may name a subcommand, whose spec reads the rest.
      const sub = !operands.length && value !== undefined ? subcommand(spec, value) : undefined;
      if (sub) {
        const inherit = [...inherited, ...(spec.options ?? []).filter((o) => o.persistent)];
        roles.set(i, { role: 'subcommand', name: sub[0], spec: sub[1], parse: this.read(sub[1], i + 1, to, `${command} ${sub[0]}`, inherit) });
        end = i + 1;
        break;
      }
      // Options end at the first operand (posix), or where a command starts (gnu).
      if (style === 'posix' || style === 'none' || this.startsCommand(spec, given, [...operands, i])) endOpts = true;
      operands.push(i);
    }
    parse.mode = chooseMode(spec, given);
    const alts = (spec.operands ?? []).filter((a) => conditionHolds(a.when, given, parse.mode));
    this.placeOperands(parse, roles, operands, alts.map((a) => a.pattern), end);
    if (afterDashes !== undefined && afterDashes < to) {
      const rest = Array.from({ length: to - afterDashes }, (_, k) => afterDashes! + k);
      this.placeOperands(parse, roles, rest, [(spec.dashDash as { then: OperandSpec[] }).then], to);
    }
    for (const [word, role] of [...roles].sort((a, b) => a[0] - b[0])) parse.roles.push({ word, role: inMode(role, parse.mode) });
    return parse;
  }

  /** Gives each operand its item of the first pattern that fits, and reads the commands of command slots. */
  private placeOperands(parse: ArgvParse, roles: Map<number, ArgRole>, operands: number[], patterns: OperandSpec[][], end: number): void {
    const words = operands.map((i) => this.words[i]);
    let items: number[] | undefined;
    let pattern: OperandSpec[] = [];
    for (const p of patterns) {
      items = match(p, words, this.ctx.maxSteps ?? 10000);
      if (items) { pattern = p; break; }
    }
    if (!items) {
      operands.forEach((i, index) => roles.set(i, { role: 'operand', index }));
      parse.unmatched.push(...operands);
      return;
    }
    for (let k = 0; k < operands.length; k++) {
      const i = operands[k];
      const item = pattern[items[k]];
      if (item.command) {
        if (!takesRest(item)) { roles.set(i, { role: 'command', slot: item.command }); continue; }
        for (const j of [...roles.keys()]) if (j > i) roles.delete(j);
        roles.set(i, this.command(item.command, i, end));
        return;
      }
      const assignment = (item.assignment || (item.assignmentText && ASSIGNMENT.test(known(words[k])))) || undefined;
      roles.set(i, { role: 'operand', spec: item, index: k, ...(assignment ? { assignment } : {}) });
    }
  }

  /** The role of the first word of a command run by this one, with the words up to `end` read by its spec. */
  private command(slot: CommandSlot, at: number, end: number): ArgRole {
    const name = this.words[at].value;
    const spec = name === undefined ? undefined : this.ctx.lookup?.(name);
    return { role: 'command', slot, name, spec, parse: this.read(spec ?? EMPTY, at + 1, end, name ?? '', []) };
  }

  /** In the gnu style, whether the last of these operands would start a command, which ends the options (`flock F cmd -x`). */
  private startsCommand(spec: CommandSpec, given: Given, operands: number[]): boolean {
    const mode = chooseMode(spec, given);
    const words = operands.map((i) => this.words[i]);
    return (spec.operands ?? []).some((alt) => {
      const k = alt.pattern.findIndex(takesRest);
      if (k < 0 || !conditionHolds(alt.when, given, mode)) return false;
      return match(alt.pattern, words, this.ctx.maxSteps ?? 10000)?.[words.length - 1] === k;
    });
  }

  /**
   * Reads the word `i` as an option (with the values it takes) and records it. Returns the index of the
   * last word used, or -1 when the word is not an option.
   */
  private option(st: OptionState, i: number): number {
    const { spec, options, roles } = st;
    const w = this.words[i];
    const open = w.value === undefined;
    let text = w.value ?? w.prefix;
    if (text === undefined) return -1;
    let disables = false;
    if (spec.plusOptions && /^\+./.test(text)) { disables = true; text = '-' + text.slice(1); }
    const style = spec.style ?? 'gnu';
    if (!open) {
      const exact = findOption(options, text, !!spec.longPrefixes);
      if (exact) {
        roles.set(i, { role: 'option', flag: text, spec: exact, text: exact.text, ...(disables ? { disables } : {}) });
        st.given.specs.push(exact);
        st.given.flags.push(text);
        return this.separateValues(st, exact, text, i, 0);
      }
      for (const p of spec.patternOptions ?? []) {
        const m = p.pattern.exec(text);
        if (m) { roles.set(i, { role: 'pattern-option', flag: text, pattern: p, text: p.text(m) }); st.given.flags.push(text); return i; }
      }
    }
    if (text.length < 2 || text[0] !== '-' || text === '--') return -1;
    // With no option grammar (`echo`), a word is an option only when every letter is one.
    if (style === 'none') return open ? -1 : this.cluster(st, i, text, false, disables, true);
    // `--name=value`, and `-name=value` for single-dash options.
    const eq = text.indexOf('=');
    const long = text.startsWith('--');
    if (eq > 0 && (long || (style === 'single-dash' && findOption(options, text.slice(0, eq), false)))) {
      const flag = text.slice(0, eq);
      const opt = findOption(options, flag, !!spec.longPrefixes);
      const value: ValueRole = { role: 'value', of: flag, spec: opt && valuesOf(opt)[0], index: 0, attached: eq + 1 };
      st.given.flags.push(flag);
      if (!opt) { roles.set(i, { role: 'unknown-option', flag, value }); return i; }
      roles.set(i, { role: 'option', flag, spec: opt, text: opt.text, value });
      st.given.specs.push(opt);
      return this.separateValues(st, opt, flag, i, 1);
    }
    if (long || style === 'single-dash') {
      if (open) return -1;
      roles.set(i, { role: 'unknown-option', flag: text });
      st.given.flags.push(text);
      return i;
    }
    return this.cluster(st, i, text, open, disables);
  }

  /** `-xvf a.tar`, `-n5`, `-F:`: letters, each an option; a letter with a value takes the rest of the word or the next word. */
  private cluster(st: OptionState, i: number, text: string, open: boolean, disables: boolean, strict = false): number {
    const letters: ArgRole[] = [];
    const given: OptionSpec[] = [];
    const flags: string[] = [];
    let last = i;
    let valued = false;
    for (let k = 1; k < text.length; k++) {
      const flag = '-' + text[k];
      const part: Range = [k, k + 1];
      const opt = findOption(st.options, flag, false);
      flags.push(flag);
      if (!opt) {
        if (strict) return -1;
        letters.push({ role: 'unknown-option', flag, part });
        continue;
      }
      const role: ArgRole = { role: 'option', flag, spec: opt, text: opt.text, part, ...(disables ? { disables } : {}) };
      letters.push(role);
      given.push(opt);
      const values = valuesOf(opt);
      if (!values.length) continue;
      const first = values[0];
      // `set -euo pipefail`: the value is the next word, and the letters after it still count.
      if (first.how === 'next-only') { last = this.separateValues(st, opt, flag, last, 0); continue; }
      const rest = k + 1 < text.length || open;
      if (rest) {
        role.value = { role: 'value', of: flag, spec: first, index: 0, attached: k + 1 };
        valued = true;
        last = this.separateValues(st, opt, flag, last, 1);
      } else if (first.how !== 'attached-only') last = this.separateValues(st, opt, flag, last, 0);
      break;
    }
    // `-x$y`: what follows the letters is not known, so it may be more letters or a value; unless a letter takes it as its value, the word stays an operand.
    if (open && !valued) return -1;
    st.given.specs.push(...given);
    st.given.flags.push(...flags);
    st.roles.set(i, letters.length === 1 ? letters[0] : { role: 'cluster', letters });
    return last;
  }

  /**
   * The values of `opt` written in the words after `last`, from its value number `from` on (the ones before
   * were attached). Records them and returns the index of the last word used. Words up to a terminator form
   * a command for an option with `until`.
   */
  private separateValues(st: OptionState, opt: OptionSpec, flag: string, last: number, from: number): number {
    if (opt.until) {
      const { terminators, slot } = opt.until;
      let j = last + 1;
      while (j < st.end && !terminators.includes(this.words[j].value ?? '')) j++;
      if (j > last + 1) st.roles.set(last + 1, this.command(slot, last + 1, j));
      if (j < st.end) { st.roles.set(j, { role: 'terminator' }); return j; }
      return st.end - 1;
    }
    const values = valuesOf(opt);
    for (let index = from; index < values.length; index++) {
      const v = values[index];
      const next = this.words[last + 1];
      if (last + 1 >= st.end || v.how === 'attached-only') break;
      if (v.optional && !(v.next && next.value !== undefined && v.next.test(next.value))) break;
      last++;
      st.roles.set(last, { role: 'value', of: flag, spec: v, index });
    }
    return last;
  }

  /** `tar cvf a.tar`, `ps aux`: the first word as letters without a dash. Returns the last word used, or -1. */
  private oldStyle(st: OptionState, i: number): number {
    const old = st.spec.oldStyle!;
    const text = this.words[i].value;
    const look = (ch: string): OptionSpec | undefined => (old.letters ? old.letters[ch] : findOption(st.options, '-' + ch, false));
    if (text === undefined || !/^[A-Za-z0-9]+$/.test(text) || ![...text].every(look)) return -1;
    if (old.needs && ![...text].some((ch) => old.needs!.includes(ch))) return -1;
    let last = i;
    const letters: ArgRole[] = [...text].map((ch, k) => {
      const opt = look(ch)!;
      st.given.specs.push(opt);
      // Each letter with a value takes the next word not used yet, in order (`tar cfC a.tar dir`).
      for (const [index, v] of valuesOf(opt).entries()) {
        if (v.optional || v.how === 'attached-only' || last + 1 >= st.end) break;
        last++;
        st.roles.set(last, { role: 'value', of: ch, spec: v, index });
      }
      return { role: 'option', flag: ch, spec: opt, text: opt.text, part: [k, k + 1] };
    });
    st.roles.set(i, { role: 'old-style', letters });
    return last;
  }
}

/** The options given so far, and the flags as written (unknown ones too: a condition may name them). */
interface Given { specs: OptionSpec[]; flags: string[] }

interface OptionState {
  spec: CommandSpec;
  options: OptionSpec[];
  roles: Map<number, ArgRole>;
  given: Given;
  /** The end of the words this command reads. */
  end: number;
}

/** The option named `flag`; with `prefixes`, a long option of which `flag` is a unique prefix (`--pres`). */
function findOption(options: OptionSpec[], flag: string, prefixes: boolean): OptionSpec | undefined {
  const exact = options.find((o) => o.names.includes(flag));
  if (exact || !prefixes || !flag.startsWith('--') || flag.length < 3) return exact;
  const found = options.filter((o) => o.names.some((n) => n.startsWith(flag)));
  return found.length === 1 ? found[0] : undefined;
}

/** The subcommand a word names: its name and spec. */
function subcommand(spec: CommandSpec, word: string): [string, CommandSpec] | undefined {
  const subs = Object.entries(spec.subcommands ?? {});
  const exact = subs.find(([name, s]) => name === word || s.aliases?.includes(word));
  if (exact || !spec.subcommandPrefixes || !word) return exact;
  const found = subs.filter(([name]) => name.startsWith(word));
  return found.length === 1 ? found[0] : undefined;
}

/** The mode of the line: the first of the spec's modes that a given option selects, or the default one. */
function chooseMode(spec: CommandSpec, given: Given): string | undefined {
  const modes = spec.modes ?? [];
  return modes.find((m) => given.specs.some((o) => o.selects === m.name))?.name ?? modes.find((m) => m.default)?.name;
}

function conditionHolds(c: Condition | undefined, given: Given, mode: string | undefined): boolean {
  if (c === undefined) return true;
  if ('not' in c) return !conditionHolds(c.not, given, mode);
  if ('mode' in c) return c.mode === mode;
  return given.flags.some((f) => c.option.includes(f)) || given.specs.some((o) => o.names.some((n) => c.option.includes(n)));
}

/** An option's text in the mode (`rpm -qi`: `-i` shows information). */
function inMode(role: ArgRole, mode: string | undefined): ArgRole {
  if (role.role === 'cluster' || role.role === 'old-style') return { ...role, letters: role.letters.map((l) => inMode(l, mode)) };
  if (role.role !== 'option' || mode === undefined || !role.spec.inMode?.[mode]) return role;
  return { ...role, text: role.spec.inMode[mode] };
}

/**
 * Matches the operands with a pattern, as a regular expression over the list: greedy quantifiers with
 * backtracking. Returns the index of the item each word takes, or undefined when the pattern does not fit
 * (or the work passes `maxSteps`). An `exec` command item takes every word left.
 */
export function match(pattern: OperandSpec[], words: ArgWord[], maxSteps: number): number[] | undefined {
  let steps = 0;
  const fits = (item: OperandSpec, w: ArgWord): boolean => !item.assignment || ASSIGNMENT.test(known(w));
  const from = (it: number, at: number): number[] | undefined => {
    if (++steps > maxSteps) return undefined;
    if (it === pattern.length) return at === words.length ? [] : undefined;
    const item = pattern[it];
    const min = item.repeat === '?' || item.repeat === '*' ? 0 : 1;
    if (takesRest(item) && at < words.length) return words.slice(at).map(() => it);
    const max = item.repeat === '*' || item.repeat === '+' ? Infinity : 1;
    let n = 0;
    while (n < max && at + n < words.length && fits(item, words[at + n])) n++;
    for (let k = n; k >= min; k--) {
      const rest = from(it + 1, at + k);
      if (rest) return [...Array<number>(k).fill(it), ...rest];
    }
    return undefined;
  };
  return from(0, 0);
}
