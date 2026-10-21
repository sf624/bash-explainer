import type { CommandSlot, CommandSpec, OperandSpec, OptionSpec, ValueSpec } from '../argv/spec';
import type { EmbeddedLang } from '../embedded/types';
import { Text, tx } from '../i18n';

export interface OptDoc {
  text: Text;
  /** The option consumes the next word (or the rest of a combined word) as its value. */
  arg?: boolean;
  /** The number of words the option consumes when it is not 1 (`jq --arg NAME VALUE`: 2). */
  argCount?: number;
  /** After this option the remaining operands are described by this text (`jq --args`: positional strings, not files). */
  restOperands?: Text;
  /** Explanations for specific option values (e.g. `set -o pipefail`). */
  values?: Record<string, Text>;
  /** The option consumes words up to a terminator such as `;` or `+` (e.g. `find -exec`). */
  untilTerminator?: boolean;
  /** The option's value is written in an embedded language (e.g. `grep -e PATTERN`). */
  lang?: EmbeddedLang;
  /** The option supplies what is otherwise the first positional argument (`grep -e`, `sed -e`). */
  fillsPositional?: boolean;
  /** The option takes the next word as its value only when that word matches this pattern (`journalctl -b -1`). */
  nextIf?: string;
  /** The option takes a value only when it is attached (`-i.bak`, `-F:`); it never consumes the next word. */
  attachedOnly?: boolean;
}

/**
 * What the positional arguments mean for a given number of them (`seq 5`, `seq 1 5`, `seq 1 2 10`; `cp a b` and
 * `cp a b c dir/`). The first entry that fits replaces `positional`.
 */
export interface PositionalBy {
  /** The number of positional arguments: exactly this many, or at least this many with `orMore`. */
  count: number;
  orMore?: boolean;
  /** Applies only when one of these options is given (`--reference=RFILE`, after which every operand is a file). */
  when?: string;
  /** Does not apply when one of these options is given (`-t|--target-directory`, which names the destination). */
  unless?: string;
  /** Descriptions in order; the last repeats. */
  texts: Text[];
  /** Describes the final argument instead of `texts`. */
  last?: Text;
}

export interface CommandDoc {
  summary: Text;
  options?: Record<string, OptDoc>;
  /** Descriptions of positional arguments in order; the last one repeats. */
  positional?: Text[];
  /** Descriptions that depend on how many positional arguments there are; the first that fits wins over `positional`. */
  positionalBy?: PositionalBy[];
  /** Embedded language of positional arguments, by index (does not repeat). */
  positionalLang?: (EmbeddedLang | undefined)[];
  subcommands?: Record<string, CommandDoc>;
  /** Options are single words that never combine (find, java-style `-name`). */
  longSingleDash?: boolean;
  /**
   * The command spec, written directly (`native`): the analyzer reads the arguments with it, and the fields
   * above, other than `summary` and `subcommands`, are not used. Builtins are written this way (`builtin`).
   */
  spec?: CommandSpec;
}

/** `[names, ja, en, flags]` where names is `-r|--recursive` and flags may contain `arg`, `until`, `fills`, `attached`, `next:<regexp>`, `lang:<name>`. */
export type OptSpec = [string, string, string, string?] | [string, string, string, string, Record<string, Text>];

export function cmd(
  ja: string,
  en: string,
  opts: OptSpec[] = [],
  extra: Partial<Omit<CommandDoc, 'summary' | 'options'>> = {},
): CommandDoc {
  const options: Record<string, OptDoc> = {};
  for (const [names, oja, oen, flags = '', values] of opts) {
    const doc: OptDoc = { text: tx(oja, oen) };
    if (flags.includes('arg')) doc.arg = true;
    const count = /arg(\d)/.exec(flags)?.[1];
    if (count) doc.argCount = Number(count);
    if (flags.includes('until')) doc.untilTerminator = true;
    if (flags.includes('fills')) doc.fillsPositional = true;
    if (flags.includes('attached')) doc.attachedOnly = true;
    const nextIf = /next:(\S+)/.exec(flags)?.[1];
    if (nextIf) doc.nextIf = nextIf;
    const lang = /lang:(\w+)/.exec(flags)?.[1];
    if (lang) doc.lang = lang as EmbeddedLang;
    if (values) doc.values = values;
    for (const n of names.split('|')) options[n] = doc;
  }
  return { summary: tx(ja, en), options, ...extra };
}

export const pos = (ja: string, en: string): Text => tx(ja, en);

/** `cp a b` copies to `b`, `cp a b c dir` into `dir`: the last argument is the destination, unless an option names it. */
export function lastIsDestination(source: Text, one: Text, several: Text, unless = '-t|--target-directory'): PositionalBy[] {
  return [
    { count: 2, unless, texts: [source], last: one },
    { count: 3, orMore: true, unless, texts: [source], last: several },
  ];
}

/** An option of a spec from the tuple form of `cmd`: `arg` takes a value, `attached` only a value in the same word. */
function optionOf([names, ja, en, flags = '', values]: OptSpec): OptionSpec {
  const value: ValueSpec | undefined = flags.includes('attached') ? { name: 'VALUE', how: 'attached-only', optional: true }
    : flags.includes('arg') ? { name: 'VALUE', ...(values ? { values } : {}) } : undefined;
  return { names: names.split('|'), text: tx(ja, en), ...(value ? { value } : {}) };
}

/**
 * A dictionary entry written as a command spec (src/argv/spec.ts), not converted from the fields above.
 * Options are tuples, as for `cmd`, or option specs.
 */
export function native(ja: string, en: string, opts: (OptSpec | OptionSpec)[], rest: Omit<Partial<CommandSpec>, 'summary' | 'options'> = {}): CommandDoc {
  const summary = tx(ja, en);
  // A name given twice (lists put together: `[...composeOpts, ...dockerRun]`) means what it means last, as with `cmd`.
  const seen = new Set<string>();
  const options = opts.map((o) => (Array.isArray(o) ? optionOf(o) : o)).reverse().flatMap((o) => {
    const names = o.names.filter((n) => !seen.has(n));
    names.forEach((n) => seen.add(n));
    return names.length ? [{ ...o, names }] : [];
  }).reverse();
  return { summary, spec: { summary, options, ...rest } };
}

/** The meanings of dashless letters (`tar xzf`, `ar rcs`), written like options but without the dash: `['c', 'ja', 'en']`. */
export function letters(opts: OptSpec[]): Record<string, OptionSpec> {
  return Object.fromEntries(opts.map((o) => [o[0], optionOf(o)]));
}

/** The same letters as options with a dash (`ar -rcs`). */
export const dashed = (opts: OptSpec[]): OptSpec[] => opts.map(([n, ...r]): OptSpec => ['-' + n, ...r] as OptSpec);

/** Operands written in order: each optional, and the last one repeats (unless the item says otherwise). */
export function args(...items: OperandSpec[]): Pick<CommandSpec, 'operands'> {
  return { operands: [{ pattern: items.map((o, i) => ({ repeat: i === items.length - 1 ? '*' : '?', ...o })) }] };
}

export const COMMAND_TEXT = tx('実行するコマンド', 'command to run');

/** The operand from which the words are the command a wrapper runs (`sudo cmd args`), started as `slot` says. */
export const runs = (slot: CommandSlot = { run: 'exec' }): OperandSpec => ({ name: 'COMMAND', text: COMMAND_TEXT, repeat: '?', command: slot });

/** `NAME=value` words before the command: variables for it (`env A=1 cmd`). */
export const ASSIGNMENTS: OperandSpec = { name: 'NAME=VALUE', text: tx('コマンドの環境に入れる変数', 'variable for the command'), assignment: true, repeat: '*' };

/** An operand of a spec, with its text in both languages. */
export const operand = (name: string, ja: string, en: string, rest: Partial<OperandSpec> = {}): OperandSpec => ({ name, text: tx(ja, en), ...rest });
