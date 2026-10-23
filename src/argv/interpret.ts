// The generic reader of a command's words: which are options, option values, operands, subcommands
// and wrapped commands, according to the command's spec (src/argv/spec.ts).
//
// It works in four passes: split the words into options and operands, choose the mode, match the
// operands with the spec's patterns, and read the words of a command slot as a command of its own.
import { isExpressionStart } from '../embedded/find';
import type { Text } from '../i18n';
import { EnvSplitError, splitEnvString } from './envsplit';
import { type ParserRules, rulesOf } from './parsers';
import type { CommandSlot, CommandSpec, Condition, OperandAlt, OperandSpec, OptionSpec, PatternOption, SubcommandSpec, ValueSpec } from './spec';

/** A word of the command line, as the program will see it. */
export interface ArgWord {
  /** Its text after quote removal, when that is known without running anything (`-F'|'` is `-F|`). */
  value?: string;
  /** Otherwise, the text known at its start (`--file=` of `--file=$f`, `-I` of `-I{}`), if any. */
  prefix?: string;
  /**
   * How many words it becomes, when that is not one: `{a,b}` is 2; `*.txt` at least 1 and `"$@"` at
   * least 0 (`max` absent: not known).
   */
  count?: { min: number; max?: number };
}

export type ArgRole =
  /**
   * An option, alone or as a letter of a cluster; `flag` is as written (`+x` for `set +x`, with `disables`).
   * `value` is a value written in the same word (`-n5`, `--file=x`); `missing`, a value it needs that no word gives.
   */
  | { role: 'option'; flag: string; spec: OptionSpec; text: Text; part?: Range; value?: ValueRole; disables?: boolean; missing?: boolean }
  /** A word of several short options (`-xvf`, `-rn5`): one role per letter, in order, with their parts. */
  | { role: 'cluster'; letters: ArgRole[] }
  /** An option recognized by its form (`kill -TERM`, `head -5`); `open` for `-` and an expansion (`head -$n`). */
  | { role: 'pattern-option'; flag: string; pattern: PatternOption; text: Text; open?: boolean }
  /** `ambiguous`: the long options a prefix could be (`timeout --v`), which the tool refuses. */
  | { role: 'unknown-option'; flag: string; part?: Range; value?: ValueRole; ambiguous?: string[] }
  /** An option whose letters are known only at run time (`-$opts`, `-r$x`): `prefix` is what is known. */
  | { role: 'open-option'; prefix: string }
  | ValueRole
  /** Dashless letters in the first word (`tar cvf`). */
  | { role: 'old-style'; letters: ArgRole[] }
  | { role: 'end-of-options' }
  /**
   * An operand; `spec` is absent when the spec does not describe the operands, or none of its patterns fits
   * (see `ArgvParse.unmatched`). `uncertain`: the role depends on how many words an expansion gives, and
   * `otherwise` is the other role it may have. `each`: the role of each word it becomes, when they are known
   * and differ (`cp a{,.bak}`: the source, then the destination). `several`: the roles, in order, of the words it
   * becomes when it gives more than one, when they differ (`cp "$@"`: sources, then the destination).
   */
  | { role: 'operand'; spec?: OperandSpec; index: number; assignment?: boolean; uncertain?: boolean; otherwise?: OperandSpec; each?: OperandSpec[]; several?: OperandSpec[] }
  /** The rest of the words are read with the subcommand's spec. */
  | { role: 'subcommand'; name: string; spec: CommandSpec; parse: ArgvParse }
  /**
   * The first word of a command run by this one; `parse` reads the words after it. A shell string (`bash -c 'cmd'`,
   * `su -c 'cmd'`) has no `parse`; nor has a string joined from the words (`joined`). `of` is the option whose
   * value or words it is (`su -c`, `find -exec`); `item`, the operand it fills (`bash -c`, `ssh host cmd`).
   */
  | { role: 'command'; slot: CommandSlot; name?: string; spec?: CommandSpec; parse?: ArgvParse; of?: string; item?: OperandSpec }
  /** The word that ends an option's command (`;` of `find -exec … ;`), and its text (one of the option's `until.terminators`). */
  | { role: 'terminator'; text: string }
  /** A word of the shell string that a `command` role before it joins from the words (`ssh host ls -l`). */
  | { role: 'joined' }
  /** A word of the expression that `operandParser` reads (`find . -name x`). */
  | { role: 'expression' };

export type CommandRole = Extract<ArgRole, { role: 'command' }>;

/**
 * The value of an option: `of` is the option's `flag` as written (`-f`, `--file`, `f` of `tar cf`), `index`
 * which of its values; `attached` is where it starts in the word, when it is written in the option's word.
 */
export interface ValueRole {
  role: 'value'; of: string; option?: OptionSpec; spec?: ValueSpec; index: number; attached?: number;
  /**
   * A value that splices words (`env -S'-i bash -e'`): the words it is split into, and their roles, numbered
   * from 0 in `words`. The words of the line after it are read after them (a command started in the string
   * takes them as its arguments), and keep their roles in the parse.
   */
  split?: { words: ArgWord[]; roles: RoleAt[] };
  /** Why the program refuses to split it (`env -S'"a'`: no closing quote), with the text at fault. */
  refused?: { error: EnvSplitError; at: string };
}

/** Offsets in a word's text: start, and end (exclusive). */
export type Range = [number, number];

export interface RoleAt { word: number; role: ArgRole }

export interface ArgvParse {
  /** 'git branch'. */
  command: string;
  mode?: string;
  /** One role per word, in order. Words of a subcommand or of a command slot are in the `parse` of its role. */
  roles: RoleAt[];
  /** The end of the words it reads (exclusive): those of a subcommand or a command run end with their parent's, or at a terminator. */
  end: number;
  /** Operands that fit no pattern of the spec (too many, too few): shown as plain words. */
  unmatched: number[];
  /** The index in `spec.operands` of the alternative the operands fit. */
  alternative?: number;
  /** The matcher stopped at its work cap: `unmatched` says it could not tell, not that nothing fits. */
  gaveUp?: boolean;
  /** Where an expression read by `operandParser` starts (`find . -name x`: the index of `-name`). */
  expression?: number;
}

export interface InterpretContext {
  /** The command's name, for `ArgvParse.command`. */
  name?: string;
  /** The spec of a command named in a command slot. */
  lookup?: (name: string) => CommandSpec | undefined;
  /** A guard on the work of the operand matcher for one pattern (default 100000 steps). */
  maxSteps?: number;
}

const EMPTY: CommandSpec = { summary: { ja: '', en: '' } };
const ASSIGNMENT = /^[A-Za-z_]\w*=/;
/** What is known of a word's text: all of it, or its start. */
const ambiguous = (r: { candidates?: string[] }): { ambiguous?: string[] } => (r.candidates ? { ambiguous: r.candidates } : {});
const known = (w: ArgWord): string => w.value ?? w.prefix ?? '';

/** Reads the words of a command (its arguments, without the name) with its spec. */
export function interpret(spec: CommandSpec, words: ArgWord[], ctx: InterpretContext = {}): ArgvParse {
  return new Reader(words, ctx, new Set()).read(spec, 0, words.length, ctx.name ?? '', [], false, []);
}

const valuesOf = (o: OptionSpec): ValueSpec[] => (o.value === undefined ? [] : Array.isArray(o.value) ? o.value : [o.value]);
/**
 * An item that takes every word left: an `exec` or `current-shell` command, or a shell string joined from the words
 * (ssh). A `shell-string` slot and a `later` one (trap's action) take one word.
 */
const takesRest = (o: OperandSpec): boolean => !!o.command && (o.command.joinsWords || (o.command.run !== 'shell-string' && !o.command.later));
/** The number of words a word gives: fewest (at least one, as the text shows it) and many. */
const counts = (w: ArgWord): [number, number] => {
  if (!w.count) return [1, 1];
  const low = Math.max(w.count.min, 1);
  return [low, w.count.max === w.count.min ? low : Math.min(w.count.max ?? Infinity, low + 2)];
};

class Reader {
  private readonly maxSteps: number;
  /** `spliced`: the words (the last of an option and its value) whose words this reader has spliced in after them. */
  constructor(private readonly words: ArgWord[], private readonly ctx: InterpretContext, private readonly spliced: Set<number>) {
    this.maxSteps = ctx.maxSteps ?? 100000;
  }

  /**
   * `cobra`: the parent finds subcommands as cobra does (the `cobra` parser), so this spec does too; `before`:
   * the words the parents read before their subcommands (options and values), which cobra searches again.
   */
  read(spec: CommandSpec, from: number, to: number, command: string, inherited: OptionSpec[], cobra: boolean, before: number[]): ArgvParse {
    const rules = rulesOf(spec, cobra);
    const isCobra = cobra || rules.cobra;
    let options = [...(spec.options ?? []), ...inherited];
    const search = options;
    const found = isCobra && spec.subcommands ? this.cobraSubcommand(spec, search, before, from, to) : undefined;
    // cobra reads every option with the flags of the command it runs: before the subcommand, its own (its name
    // wins) and the persistent ones, but not the others of this level (`gh --version pr`: unknown flag).
    if (found?.at !== undefined) options = [...found.options ?? [], ...options.filter((o) => o.persistent)];
    const roles = new Map<number, ArgRole>();
    const given: Given = { specs: [], flags: [], marks: new Set(), later: [], unsplit: [] };
    const operands: number[] = [];
    const parse: ArgvParse = { command, roles: [], unmatched: [], end: to };
    let endOpts = false;
    let afterDashes: number | undefined;
    let end = to;
    const st: OptionState = { spec, rules, options, roles, given, end, guess: isCobra && !!spec.subcommands, search };
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
        for (let j = i; j < to; j++) roles.set(j, { role: 'expression' });
        end = i;
        break;
      }
      if (!endOpts && spec.oldStyle && (i === from || spec.oldStyle.anywhere)) {
        const used = this.oldStyle(st, i);
        if (used >= 0) { i = used; continue; }
      }
      if (!endOpts) {
        const used = this.option(st, i);
        if (used >= 0) {
          const split = this.splice(st, i, used);
          // The words of the string are read in its place: the line is read again with them.
          if (split) {
            const composite = [...this.words.slice(0, used + 1), ...split, ...this.words.slice(used + 1)];
            const parse = new Reader(composite, this.ctx, new Set([...this.spliced, used])).read(spec, from, to + split.length, command, inherited, cobra, before);
            return unsplice(parse, used, split);
          }
          i = this.cobraValue(st, i, used);
          continue;
        }
      }
      // An operand. The first one may name a subcommand, whose spec reads the rest (or the one cobra finds,
      // when its search did not stop at a word not known).
      const sub = (found ? i === found.at : !operands.length) && value !== undefined ? subcommand(spec, value) : undefined;
      if (sub) {
        const inherit = [...inherited, ...(spec.options ?? []).filter((o) => o.persistent)];
        roles.set(i, { role: 'subcommand', name: sub[0], spec: sub[1], parse: this.read(sub[1], i + 1, to, `${command} ${sub[0]}`, inherit, isCobra, isCobra ? [...before, ...range(from, i)] : []) });
        end = i + 1;
        break;
      }
      // Options end at the first operand (`optionsFirst`), or where a command starts.
      if (rules.optionsFirst || this.startsCommand(st, [...operands, i]) || (spec.endsOptions && value !== undefined && spec.endsOptions.test(value))) endOpts = true;
      operands.push(i);
    }
    parse.mode = chooseMode(spec, given);
    if (spec.operands) {
      const words = operands.map((i) => this.words[i]);
      const alts = spec.operands.flatMap((alt, index) => (conditionHolds(alt.when, given, parse.mode, words) ? [{ alt, index }] : []));
      this.placeOperands(parse, st, operands, alts, end, true);
    } else operands.forEach((i, index) => roles.set(i, { role: 'operand', index }));
    if (afterDashes !== undefined && afterDashes < to) {
      const rest = Array.from({ length: to - afterDashes }, (_, k) => afterDashes! + k);
      this.placeOperands(parse, st, rest, [{ alt: { pattern: (spec.dashDash as { then: OperandSpec[] }).then }, index: -1 }], to, false);
    }
    for (const [word, role] of [...roles].sort((a, b) => a[0] - b[0])) parse.roles.push({ word, role: inMode(role, parse.mode) });
    return parse;
  }

  /**
   * Gives each operand its item of the first pattern that fits, and reads the commands of command slots.
   * A word that may give several words (`*.txt`, `"$@"`) is matched as one word and as several; where
   * the two readings differ, the role is the first one, marked `uncertain`.
   */
  private placeOperands(parse: ArgvParse, st: OptionState, operands: number[], alts: { alt: OperandAlt; index: number }[], end: number, record: boolean): void {
    const { roles } = st;
    const words = operands.map((i) => this.words[i]);
    /** The operands with each word repeated as many times as it gives words; `first[k]` is where word k starts. */
    const expand = (high: boolean) => {
      const at: number[] = [];
      const first: number[] = [];
      words.forEach((w, k) => {
        first.push(at.length);
        for (let n = counts(w)[high ? 1 : 0]; n > 0; n--) at.push(k);
      });
      return { at, first };
    };
    const fit = (high: boolean) => {
      const x = expand(high);
      for (const { alt, index } of alts) {
        const r = match(alt.pattern, x.at.map((k) => words[k]), this.maxSteps, st.options);
        if (r.gaveUp) parse.gaveUp = true;
        if (r.items) return { ...x, alt, index, items: r.items };
      }
      return undefined;
    };
    const variable = words.some((w) => counts(w)[0] !== counts(w)[1]);
    const low = fit(false);
    const high = variable ? fit(true) : low;
    const primary = low ?? high;
    if (!primary) {
      operands.forEach((i, index) => roles.set(i, { role: 'operand', index }));
      parse.unmatched.push(...operands);
      return;
    }
    if (record) parse.alternative = primary.index;
    const other = primary === low ? high : low;
    const pattern = primary.alt.pattern;
    for (let k = 0; k < operands.length; k++) {
      const i = operands[k];
      const pos = primary.first[k];
      const n = primary.items[pos];
      const item = pattern[n];
      if (item.command) {
        if (!takesRest(item)) { roles.set(i, { role: 'command', slot: item.command, item }); continue; }
        for (const j of [...roles.keys()]) if (j > i && j < end) roles.delete(j);
        // ssh: the words are joined into one string for the remote shell, which reads it as a script.
        // (`sudo -s` escapes each word first: the shell reads the same words, a command.)
        if (item.command.joinsWords && !item.command.escapesWords) {
          roles.set(i, { role: 'command', slot: item.command, item });
          for (let j = i + 1; j < end; j++) roles.set(j, { role: 'joined' });
        } else roles.set(i, { ...this.command(item.command, i, end), item });
        return;
      }
      if (item.option) {
        const opt = findOption(st.options, item.option, false)!;
        roles.set(i, { role: 'option', flag: words[k].value!, spec: opt, text: opt.text });
        continue;
      }
      // Copies of one word with different meanings, or another meaning when the words are more: not certain.
      const copies = primary.at.flatMap((x, p) => (x === k ? [pattern[primary.items[p]]] : []));
      const elsewhere = other ? [other.alt.pattern[other.items[other.first[k]]]] : [];
      const count = words[k].count;
      const each = count?.min === count?.max && copies.some((o) => o.text.en !== item.text.en) ? copies : undefined;
      const otherwise = each ? undefined : [...copies, ...elsewhere].find((o) => o.text.en !== item.text.en);
      // `cp "$@"`: when the word gives more words, they take these roles, in order.
      const theirs = other && other !== primary && primary === low ? other.at.flatMap((x, p) => (x === k ? [other.alt.pattern[other.items[p]]] : [])) : [];
      const several = theirs.filter((o, j) => j === 0 || o.text.en !== theirs[j - 1].text.en);
      // `jq . in.json --args a`: after the option, the operands of the repeating last item are something else.
      const last = n === pattern.length - 1 && (item.repeat === '*' || item.repeat === '+');
      const later = last ? st.given.later.filter((l) => l.word < i).pop()?.spec : undefined;
      const spec = later ?? item;
      const assignment = (spec.assignment || (spec.assignmentText && ASSIGNMENT.test(known(words[k])))) || undefined;
      roles.set(i, { role: 'operand', spec, index: k, ...(assignment ? { assignment } : {}), ...(otherwise ? { uncertain: true, otherwise } : {}), ...(each ? { each } : {}), ...(several.length > 1 ? { uncertain: true, several } : {}) });
    }
  }

  /** The role of the first word of a command run by this one, with the words up to `end` read by its spec. */
  private command(slot: CommandSlot, at: number, end: number, of?: string): CommandRole {
    const name = this.words[at].value;
    const found = name === undefined ? undefined : this.ctx.lookup?.(name);
    // A slot that starts a program runs the program of a builtin's name (`env echo`: coreutils echo).
    const spec = slot.run === 'exec' && found?.program ? found.program : found;
    return { role: 'command', slot, name, spec, parse: this.read(spec ?? EMPTY, at + 1, end, name ?? '', [], false, []), ...(of ? { of } : {}) };
  }

  /**
   * cobra's search for the subcommand (`stripFlags`): skip options, and the next word after an option that
   * takes a value or is not known here (unless written with `=`, or as several letters), then the first word left
   * is the subcommand, if it names one. cobra searches the words its parents read before their subcommands
   * (`before`) again, with this level's options (`gh --version pr list`: `pr` does not know `--version`, which
   * takes `list`). Where the subcommand is, and its own options, to read the words before it with; `{}` when
   * there is none (`kubectl -- get`, a first word that names none); `undefined` when a word not known stops the search.
   */
  private cobraSubcommand(spec: CommandSpec, options: OptionSpec[], before: number[], from: number, to: number): { at?: number; options?: OptionSpec[] } | undefined {
    const list = [...before, ...range(from, to)];
    for (let k = 0; k < list.length; k++) {
      const w = this.words[list[k]].value;
      if (w === undefined) return undefined;
      // `--` ends the search; cobra skips empty words.
      if (w === '--') return {};
      if (w === '') continue;
      if (w.startsWith('-')) {
        if (cobraTakesNext(w, options)) k++;
        continue;
      }
      const sub = list[k] >= from ? subcommand(spec, w) : undefined;
      // (A subcommand among the parents' words would be read before its parent: it is not shown as one.)
      return sub ? { at: list[k], options: sub[1].options } : {};
    }
    return {};
  }

  /**
   * After the option at `i` (its last word `used`): cobra takes the next word as the value of an option it
   * does not know, before the subcommand. Returns the last word used.
   */
  private cobraValue(st: OptionState, i: number, used: number): number {
    const role = st.roles.get(i);
    const w = this.words[i].value;
    if (!st.guess || used !== i || i + 1 >= st.end || role?.role !== 'unknown-option' || w === undefined || !cobraTakesNext(w, st.search)) return used;
    st.roles.set(i + 1, { role: 'value', of: role.flag, index: 0 });
    return i + 1;
  }

  /**
   * The words of an option's value that splices words (`env -S'…'`), when it is known and not spliced yet. A
   * value not known, or refused, is recorded for the condition `unsplit`.
   */
  private splice(st: OptionState, i: number, used: number): ArgWord[] | undefined {
    if (this.spliced.has(used)) return undefined;
    const role = st.roles.get(i)!;
    for (const o of role.role === 'cluster' ? role.letters : [role]) {
      if (o.role !== 'option' || !valuesOf(o.spec)[0]?.splice) continue;
      const value = o.value ?? (used > i ? st.roles.get(used) as ValueRole : undefined);
      const text = o.value ? this.words[i].value?.slice(o.value.attached) : used > i ? this.words[used].value : undefined;
      const r = text === undefined ? undefined : splitEnvString(text);
      if (r && 'words' in r) return r.words;
      if (r && 'error' in r && value) value.refused = r;
      st.given.unsplit.push(...o.spec.names);
    }
    return undefined;
  }

  /** Whether the last of these operands would start a command, which ends the options (`ssh host ls -l`). */
  private startsCommand(st: OptionState, operands: number[]): boolean {
    const mode = chooseMode(st.spec, st.given);
    const words = operands.map((i) => this.words[i]);
    return (st.spec.operands ?? []).some((alt) => {
      const k = alt.pattern.findIndex(takesRest);
      if (k < 0 || !conditionHolds(alt.when, st.given, mode, words)) return false;
      return match(alt.pattern, words, this.maxSteps, st.options).items?.[words.length - 1] === k;
    });
  }

  /**
   * Reads the word `i` as an option (with the values it takes) and records it. Returns the index of the
   * last word used, or -1 when the word is not an option.
   */
  private option(st: OptionState, i: number): number {
    const { spec, rules, options, roles, given } = st;
    const w = this.words[i];
    const open = w.value === undefined;
    const written = w.value ?? w.prefix;
    if (written === undefined) return -1;
    const disables = !!spec.plusOptions && /^\+./.test(written);
    const text = disables ? '-' + written.slice(1) : written;
    const blocked = (o: { unlessMarked?: string }): boolean => !!o.unlessMarked && given.marks.has(o.unlessMarked);
    const mark = (o: { marks?: string }): void => { if (o.marks) given.marks.add(o.marks); };
    if (!open) {
      const exact = findOption(options, text, rules.longPrefixes);
      if (exact) {
        if (blocked(exact)) return -1;
        const role: ArgRole = { role: 'option', flag: written, spec: exact, text: exact.text, ...(disables ? { disables } : {}) };
        roles.set(i, role);
        given.specs.push(exact);
        given.flags.push(text);
        mark(exact);
        if (exact.laterOperands) given.later.push({ word: i, spec: exact.laterOperands });
        return this.separateValues(st, exact, written, i, 0, role);
      }
    }
    for (const p of spec.patternOptions ?? []) {
      const m = open ? null : p.pattern.exec(text);
      if (!m && !(open && p.open && text === '-')) continue;
      if (blocked(p)) return -1;
      roles.set(i, m ? { role: 'pattern-option', flag: written, pattern: p, text: p.text(m) } : { role: 'pattern-option', flag: written, pattern: p, text: p.open!, open: true });
      given.flags.push(written);
      mark(p);
      return i;
    }
    // `-$opts`, `-$n`: the program sees an option, which is known only at run time.
    const openOption = (): number => { roles.set(i, { role: 'open-option', prefix: written }); return i; };
    if (open && (text === '-' || text === '--')) return openOption();
    if (text.length < 2 || text[0] !== '-' || text === '--') return -1;
    // `echo`: a word is an option only when every letter is one.
    if (rules.letters) return open ? openOption() : this.cluster(st, i, written, text, false, disables, true);
    // `--name=value`, and `-name=value` for single-dash options.
    const eq = text.indexOf('=');
    const long = text.startsWith('--');
    if (eq > 0 && ((long && rules.longEquals) || (rules.singleDash && findOption(options, text.slice(0, eq), false)))) {
      const flag = text.slice(0, eq);
      const opt = findOption(options, flag, rules.longPrefixes);
      const value: ValueRole = { role: 'value', of: flag, ...(opt ? { option: opt, spec: valuesOf(opt)[0] } : {}), index: 0, attached: eq + 1 };
      given.flags.push(flag);
      if (!opt) { roles.set(i, { role: 'unknown-option', flag, value, ...ambiguous(lookupOption(options, flag, rules.longPrefixes)) }); return i; }
      roles.set(i, { role: 'option', flag, spec: opt, text: opt.text, value });
      given.specs.push(opt);
      mark(opt);
      return this.separateValues(st, opt, flag, i, 1);
    }
    if (long || rules.singleDash || !rules.shortClusters) {
      if (open) return openOption();
      roles.set(i, { role: 'unknown-option', flag: text, ...ambiguous(lookupOption(options, text, rules.longPrefixes)) });
      given.flags.push(text);
      return i;
    }
    const used = this.cluster(st, i, written, text, open, disables);
    return used >= 0 ? used : openOption();
  }

  /** `-xvf a.tar`, `-n5`, `-F:`: letters, each an option; a letter with a value takes the rest of the word or the next word. */
  private cluster(st: OptionState, i: number, written: string, text: string, open: boolean, disables: boolean, strict = false): number {
    const letters: ArgRole[] = [];
    const given: OptionSpec[] = [];
    const flags: string[] = [];
    let last = i;
    let valued = false;
    for (let k = 1; k < text.length; k++) {
      const flag = '-' + text[k];
      const as = written[0] + text[k];
      const part: Range = [k, k + 1];
      const opt = findOption(st.options, flag, false);
      flags.push(flag);
      if (!opt) {
        if (strict) return -1;
        letters.push({ role: 'unknown-option', flag: as, part });
        continue;
      }
      const role: ArgRole = { role: 'option', flag: as, spec: opt, text: opt.text, part, ...(disables ? { disables } : {}) };
      letters.push(role);
      given.push(opt);
      const values = valuesOf(opt);
      if (!values.length) continue;
      const first = values[0];
      // `set -euo pipefail`: the value is the next word, and the letters after it still count.
      if (first.how === 'next-only') { last = this.separateValues(st, opt, as, last, 0, role); continue; }
      if (k + 1 < text.length || open) {
        // `dpkg-query -f=FORMAT`: the value starts after the `=`.
        const at = st.rules.shortEquals && text[k + 1] === '=' ? k + 2 : k + 1;
        role.value = { role: 'value', of: as, option: opt, spec: first, index: 0, attached: at };
        valued = true;
        last = this.separateValues(st, opt, as, last, 1, role);
      } else if (first.how !== 'attached-only') last = this.separateValues(st, opt, as, last, 0, role);
      break;
    }
    // `-x$y`: what follows the letters is not known, so it may be more letters; unless a letter takes it as its value, the option is open.
    if (open && !valued) return -1;
    st.given.specs.push(...given);
    st.given.flags.push(...flags);
    st.roles.set(i, letters.length === 1 ? letters[0] : { role: 'cluster', letters });
    return last;
  }

  /**
   * The values of `opt` written in the words after `last`, from its value number `from` on (the ones before
   * were attached). Records them and returns the index of the last word used; a value it needs that no word
   * gives makes the option's role `missing`. Words up to a terminator form a command for an option with `until`.
   */
  private separateValues(st: OptionState, opt: OptionSpec, flag: string, last: number, from: number, role?: { missing?: boolean }): number {
    if (opt.until) {
      const { terminators, slot } = opt.until;
      let j = last + 1;
      while (j < st.end && !terminators.includes(this.words[j].value ?? '')) j++;
      if (j > last + 1) st.roles.set(last + 1, this.command(slot, last + 1, j, flag));
      if (j < st.end) { st.roles.set(j, { role: 'terminator', text: this.words[j].value! }); return j; }
      return st.end - 1;
    }
    const values = valuesOf(opt);
    for (let index = from; index < values.length; index++) {
      const v = values[index];
      if (v.how === 'attached-only') break;
      const next = this.words[last + 1];
      if (last + 1 >= st.end) {
        if (!v.optional && role) role.missing = true;
        break;
      }
      if (v.optional && !(v.next && next.value !== undefined && v.next.test(next.value))) break;
      last++;
      st.roles.set(last, v.command ? { role: 'command', slot: v.command, of: flag } : { role: 'value', of: flag, option: opt, spec: v, index });
    }
    return last;
  }

  /** `tar cvf a.tar`, `ps aux`: a word as letters without a dash. Returns the last word used, or -1. */
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
        st.roles.set(last, { role: 'value', of: ch, option: opt, spec: v, index });
      }
      return { role: 'option', flag: ch, spec: opt, text: opt.text, part: [k, k + 1] };
    });
    st.roles.set(i, { role: 'old-style', letters });
    return last;
  }
}

/**
 * The options given so far, the flags as written (unknown ones too: a condition may name them), the marks they
 * set, the options that change the operands after them, and the options whose value could not be split (`unsplit`).
 */
interface Given { specs: OptionSpec[]; flags: string[]; marks: Set<string>; later: { word: number; spec: OperandSpec }[]; unsplit: string[] }

interface OptionState {
  spec: CommandSpec;
  /** How the program reads options (its parser's rules). */
  rules: ParserRules;
  options: OptionSpec[];
  roles: Map<number, ArgRole>;
  given: Given;
  /** The end of the words this command reads. */
  end: number;
  /** cobra, before the subcommand: an option not known here takes the next word as its value. */
  guess: boolean;
  /** The options cobra knows while it searches for the subcommand (this level's). */
  search: OptionSpec[];
}

const range = (from: number, to: number): number[] => Array.from({ length: to - from }, (_, k) => from + k);

/** Whether cobra takes the word after this option as its value while it looks for the subcommand. */
function cobraTakesNext(w: string, options: OptionSpec[]): boolean {
  if (w.includes('=') || (!w.startsWith('--') && w.length !== 2)) return false;
  const o = findOption(options, w);
  return !o || valuesOf(o).some((v) => !v.optional);
}

/**
 * The parse of a line into which the words `split` were spliced after the word `at`, in the numbers of the
 * words without them: the roles of the split words go to the value's `split`, numbered from 0, and the words
 * after them that a role started in the string reads (a command's arguments) come back to the line.
 */
function unsplice(parse: ArgvParse, at: number, split: ArgWord[]): ArgvParse {
  const s = at + 1;
  const e = s + split.length;
  const inSplit = (j: number): boolean => j >= s && j < e;
  /** The number of a word not in the split words (a parse of the line ends after them too). */
  const back = (j: number): number => (j < s ? j : j - split.length);
  const splitRoles: RoleAt[] = [];
  const withParse = (role: ArgRole, f: (q: ArgvParse) => ArgvParse): ArgRole =>
    (role.role === 'subcommand' || (role.role === 'command' && role.parse) ? { ...role, parse: f(role.parse!) } as ArgRole : role);
  const line = (q: ArgvParse): ArgvParse => {
    const roles: RoleAt[] = [];
    for (const { word, role } of q.roles) {
      if (inSplit(word)) splitRoles.push({ word: word - s, role: inString(role, roles) });
      else roles.push({ word: back(word), role: withParse(role, line) });
    }
    roles.sort((a, b) => a.word - b.word);
    // (Only env splices, so no find expression is read here.)
    return { ...q, roles, end: back(q.end), unmatched: q.unmatched.filter((j) => !inSplit(j)).map(back) };
  };
  const inString = (role: ArgRole, hoist: RoleAt[]): ArgRole => withParse(role, (q) => {
    const roles: RoleAt[] = [];
    for (const { word, role: r } of q.roles) {
      if (inSplit(word)) roles.push({ word: word - s, role: inString(r, hoist) });
      else hoist.push({ word: back(word), role: withParse(r, line) });
    }
    return { ...q, roles, end: Math.min(q.end, e) - s, unmatched: q.unmatched.filter(inSplit).map((j) => j - s) };
  });
  const out = line(parse);
  splitRoles.sort((a, b) => a.word - b.word);
  const value = (v: ValueRole): ValueRole => ({ ...v, split: { words: split, roles: splitRoles } });
  out.roles = out.roles.map((r) => {
    if (r.word !== at) return r;
    const role = r.role;
    if (role.role === 'value') return { word: at, role: value(role) };
    // (Else the value is in the option's word: `-S'…'`, `--split-string=…`, or the last letter of a cluster.)
    if (role.role === 'option') return { word: at, role: { ...role, value: value(role.value!) } };
    const letters = (role as Extract<ArgRole, { role: 'cluster' }>).letters;
    return { word: at, role: { role: 'cluster', letters: letters.map((l) => (l.role === 'option' && l.value && valuesOf(l.spec)[0]?.splice ? { ...l, value: value(l.value) } : l)) } };
  });
  return out;
}

/**
 * The option named `flag`. With `prefixes`, a long option of which `flag` is a unique prefix (`--pres`), or
 * with `'first'`, the first option with a name that `flag` (or `flag` without one of two dashes) starts.
 * `candidates`: when a prefix starts several long options (`timeout --v`), one name of each, which the tool refuses.
 */
function lookupOption(options: OptionSpec[], flag: string, prefixes: ParserRules['longPrefixes'] = false): { option?: OptionSpec; candidates?: string[] } {
  if (prefixes === 'first') {
    const word = flag.startsWith('--') ? flag.slice(1) : flag;
    // (A lone `-` starts every option, so it is the first one: iproute2's `ip - 3 link` is `ip -loops 3 link`.)
    return { option: word[0] !== '-' ? undefined : options.find((o) => o.names.some((n) => n.startsWith(word))) };
  }
  const exact = options.find((o) => o.names.includes(flag));
  if (exact || !prefixes || !flag.startsWith('--') || flag.length < 3) return { option: exact };
  const found = options.filter((o) => o.names.some((n) => n.startsWith(flag)));
  return found.length === 1 ? { option: found[0] } : found.length > 1 ? { candidates: found.map((o) => o.names.find((n) => n.startsWith(flag))!) } : {};
}

const findOption = (options: OptionSpec[], flag: string, prefixes: ParserRules['longPrefixes'] = false): OptionSpec | undefined => lookupOption(options, flag, prefixes).option;

/** The subcommand a word names: its name and spec. */
function subcommand(spec: CommandSpec, word: string): [string, CommandSpec] | undefined {
  const subs = Object.entries(spec.subcommands ?? {});
  const names = ([name, s]: [string, SubcommandSpec]): string[] => [name, ...(s.aliases ?? [])];
  if (spec.subcommandPrefixes === 'first') return word ? subs.find((s) => names(s).some((n) => n.startsWith(word))) : undefined;
  const exact = subs.find((s) => names(s).includes(word));
  if (exact || !spec.subcommandPrefixes || !word) return exact;
  const found = subs.filter(([name]) => name.startsWith(word));
  return found.length === 1 ? found[0] : undefined;
}

/** The mode of the line: the first of the spec's modes that a given option selects (or the last option given, with `lastModeWins`), or the default one. */
function chooseMode(spec: CommandSpec, given: Given): string | undefined {
  const modes = spec.modes ?? [];
  if (spec.lastModeWins) {
    const last = given.specs.filter((o) => o.selects).pop()?.selects;
    if (last) return last;
  }
  return modes.find((m) => given.specs.some((o) => o.selects === m.name))?.name ?? modes.find((m) => m.default)?.name;
}

function conditionHolds(c: Condition | undefined, given: Given, mode: string | undefined, operands: ArgWord[]): boolean {
  if (c === undefined) return true;
  if ('not' in c) return !conditionHolds(c.not, given, mode, operands);
  if ('mode' in c) return c.mode === mode;
  if ('unsplit' in c) return given.unsplit.some((n) => c.unsplit.includes(n));
  if ('operand' in c) {
    const value = operands[c.operand]?.value;
    return value !== undefined && c.matches.test(value);
  }
  return given.flags.some((f) => c.option.includes(f)) || given.specs.some((o) => o.names.some((n) => c.option.includes(n)));
}

/** An option's text in the mode (`rpm -qi`: `-i` shows information). */
function inMode(role: ArgRole, mode: string | undefined): ArgRole {
  if (role.role === 'cluster' || role.role === 'old-style') return { ...role, letters: role.letters.map((l) => inMode(l, mode)) };
  if (mode === undefined) return role;
  if (role.role === 'pattern-option') return role.pattern.inMode?.[mode] ? { ...role, text: role.pattern.inMode[mode] } : role;
  if (role.role !== 'option' || !role.spec.inMode?.[mode]) return role;
  return { ...role, text: role.spec.inMode[mode] };
}

export interface MatchResult {
  /** The index of the item each word takes, when the pattern fits. */
  items?: number[];
  /** The work passed the cap before an answer: not the same as "does not fit". */
  gaveUp?: boolean;
}

/**
 * Matches the operands with a pattern, as a regular expression over the list: greedy quantifiers with
 * backtracking, memoized on (item, word), so the work is at most items × words × words. An `exec` command
 * item takes every word left; an `option` item takes only a word that names that option of `options`.
 */
export function match(pattern: OperandSpec[], words: ArgWord[], maxSteps: number, options: OptionSpec[] = []): MatchResult {
  let steps = 0;
  let gaveUp = false;
  const memo = new Map<number, number[] | null>();
  const fits = (item: OperandSpec, w: ArgWord): boolean => {
    if (item.assignment) return ASSIGNMENT.test(known(w));
    if (item.option) return w.value !== undefined && !!findOption(options, item.option, false)?.names.includes(w.value);
    return !item.matches || w.value === undefined || item.matches.test(w.value);
  };
  const from = (it: number, at: number): number[] | null => {
    const key = it * (words.length + 1) + at;
    const seen = memo.get(key);
    if (seen !== undefined) return seen;
    if (++steps > maxSteps) { gaveUp = true; return null; }
    let out: number[] | null = null;
    if (it === pattern.length) out = at === words.length ? [] : null;
    else {
      const item = pattern[it];
      const min = item.repeat === '?' || item.repeat === '*' ? 0 : 1;
      if (takesRest(item) && at < words.length) out = words.slice(at).map(() => it);
      else {
        const max = item.repeat === '*' || item.repeat === '+' ? Infinity : 1;
        let n = 0;
        while (n < max && at + n < words.length && fits(item, words[at + n])) n++;
        for (let k = n; k >= min && !out; k--) {
          const rest = from(it + 1, at + k);
          if (rest) out = [...Array<number>(k).fill(it), ...rest];
        }
      }
    }
    memo.set(key, out);
    return out;
  };
  const items = from(0, 0);
  return items ? { items } : gaveUp ? { gaveUp } : {};
}
