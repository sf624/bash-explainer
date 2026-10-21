import type { CommandSlot, CommandSpec, Condition, OperandAlt, OperandSpec, OptionSpec, PatternOption, ValueSpec } from '../argv/spec';
import type { EmbeddedLang } from '../embedded/types';
import { Text, tx } from '../i18n';

/**
 * `[names, ja, en, flags]` where names is `-r|--recursive` and flags may contain `arg` (a value; `arg2` for two
 * words, as `jq --arg NAME VALUE`), `until` (the words up to `;` or `+` are a command: `find -exec`), `fills`
 * (the option gives what is otherwise the first operand: `grep -e`), `attached` (a value only in the same word:
 * `-i.bak`), `next:<regexp>` (an optional value, taken from the next word when it matches: `journalctl -b -1`),
 * `lang:<name>` (the value's language) and `persistent` (subcommands take it too). The fifth item gives the
 * meaning of particular values (`set -o pipefail`).
 */
export type OptSpec = [string, string, string, string?] | [string, string, string, string, Record<string, Text>];

/** The option spec of a tuple (see `OptSpec`). */
export function optionOf([names, ja, en, flags = '', values]: OptSpec): OptionSpec {
  const opt: OptionSpec = { names: names.split('|'), text: tx(ja, en), ...(flags.includes('persistent') ? { persistent: true } : {}) };
  const lang = /lang:(\w+)/.exec(flags)?.[1] as EmbeddedLang | undefined;
  const extra: Partial<ValueSpec> = { ...(lang ? { lang } : {}), ...(values ? { values } : {}) };
  const nextIf = /next:(\S+)/.exec(flags)?.[1];
  if (flags.includes('until')) opt.until = { terminators: [';', '+'], slot: { run: 'exec' } };
  else if (flags.includes('arg')) {
    const n = Number(/arg(\d)/.exec(flags)?.[1] ?? 1);
    opt.value = n > 1
      ? Array.from({ length: n }, (_, k): ValueSpec => ({ name: n === 2 ? ['NAME', 'VALUE'][k] : `VALUE${k + 1}`, ...(k === n - 1 ? extra : {}) }))
      : { name: 'VALUE', ...extra };
  } else if (flags.includes('attached')) opt.value = { name: 'VALUE', how: 'attached-only', optional: true, ...extra };
  else if (nextIf) opt.value = { name: 'VALUE', optional: true, next: new RegExp(nextIf), ...extra };
  else if (lang || values) throw new Error(`${names}: a language or values, but no value`);
  return opt;
}

/**
 * A list of options, with `overrides` put over it: a name of `overrides` means what it says there (the option
 * of `list` loses that name). A name given twice in one list is a mistake in the dictionary, and throws.
 */
export function mergeOptions(list: OptionSpec[], overrides: OptionSpec[] = []): OptionSpec[] {
  for (const l of [list, overrides]) {
    const seen = new Set<string>();
    for (const n of l.flatMap((o) => o.names)) {
      if (seen.has(n)) throw new Error(`${n}: an option named twice`);
      seen.add(n);
    }
  }
  const over = new Set(overrides.flatMap((o) => o.names));
  return [...list.flatMap((o) => {
    const names = o.names.filter((n) => !over.has(n));
    return names.length === o.names.length ? [o] : names.length ? [{ ...o, names }] : [];
  }), ...overrides];
}

/** What `cmd` takes besides the summary and the options: any field of a spec, and a shorthand for the operands. */
export interface CmdRest extends Omit<Partial<CommandSpec>, 'summary' | 'options'> {
  /**
   * The operands in order (`ARG1`, `ARG2`…): each optional, and the last one repeats. They are the last
   * alternative of `operands`. An option with the flag `fills` gives the first one (`grep -e PATTERN`): with it,
   * the operands start at the second.
   */
  positional?: Text[];
  /** The language of the operand at each index of `positional` (it does not repeat). */
  positionalLang?: (EmbeddedLang | undefined)[];
}

/**
 * A dictionary entry: the spec of a command (src/argv/spec.ts). Options are tuples (`OptSpec`) or option specs;
 * the other fields are those of a spec, and `positional`.
 */
export function cmd(ja: string, en: string, opts: (OptSpec | OptionSpec)[] = [], rest: CmdRest = {}): CommandSpec {
  const summary = tx(ja, en);
  const { positional = [], positionalLang = [], operands = [], ...fields } = rest;
  const options = mergeOptions(opts.map((o) => (Array.isArray(o) ? optionOf(o) : o)));
  const fills = opts.flatMap((o) => (Array.isArray(o) && o[3]?.includes('fills') ? o[0].split('|') : []));
  const alts: OperandAlt[] = [
    ...operands,
    ...(fills.length ? [{ when: { option: fills }, pattern: listed(positional, positionalLang, 1) }] : []),
    ...(positional.length ? [{ pattern: listed(positional, positionalLang) }] : []),
  ];
  return { summary, options, ...fields, ...(alts.length ? { operands: alts } : {}) };
}

/** `ARG<i+1>`: the operand at index `i`, in the language given for it. */
const item = (i: number, text: Text, repeat?: OperandSpec['repeat'], lang?: EmbeddedLang): OperandSpec =>
  ({ name: `ARG${i + 1}`, text, ...(repeat ? { repeat } : {}), ...(lang ? { lang } : {}) });

/** The texts from `from` on: each optional, and the last repeats; a language applies to its own index only. */
function listed(texts: Text[], langs: (EmbeddedLang | undefined)[], from = 0): OperandSpec[] {
  const out: OperandSpec[] = [];
  for (let i = from; i < texts.length; i++) {
    if (i < texts.length - 1) out.push(item(i, texts[i], '?', langs[i]));
    else if (langs[i]) out.push(item(i, texts[i], '?', langs[i]), item(i + 1, texts[i], '*'));
    else out.push(item(i, texts[i], '*'));
  }
  return out;
}

/**
 * Operands by count (`seq 5`, `seq 1 5`; `cp a b` and `cp a b c dir/`): exactly `count` of them, or more with
 * `orMore`; the texts in order, the last one repeating, and `last` for the final one. `when` and `unless` are
 * options (`-t|--target-directory`) given, or not, for the alternative to apply; `langs` the language of each.
 */
export function byCount(count: number, texts: Text[], o: { orMore?: boolean; last?: Text; when?: string; unless?: string; langs?: (EmbeddedLang | undefined)[] } = {}): OperandAlt {
  const at = (i: number): Text => texts[Math.min(i, texts.length - 1)];
  const it = (i: number, t: Text, repeat?: OperandSpec['repeat']): OperandSpec => item(i, t, repeat, o.langs?.[i]);
  const required = o.last ? count - 1 : count;
  const pattern: OperandSpec[] = [];
  for (let i = 0; i < required; i++) pattern.push(it(i, at(i)));
  if (o.orMore) {
    for (let i = required; i < texts.length - 1; i++) pattern.push(it(i, at(i), '?'));
    pattern.push(it(Math.max(required, texts.length - 1), at(texts.length - 1), '*'));
  }
  if (o.last) pattern.push(it(count - 1, o.last));
  const when: Condition | undefined = o.when ? { option: o.when.split('|') } : o.unless ? { not: { option: o.unless.split('|') } } : undefined;
  return { ...(when ? { when } : {}), pattern };
}

export const pos = (ja: string, en: string): Text => tx(ja, en);

/** `cp a b` copies to `b`, `cp a b c dir` into `dir`: the last argument is the destination, unless an option names it. */
export function lastIsDestination(source: Text, one: Text, several: Text, unless = '-t|--target-directory'): OperandAlt[] {
  return [
    byCount(2, [source], { unless, last: one }),
    byCount(3, [source], { orMore: true, unless, last: several }),
  ];
}

/** The same options, taken by every subcommand too (`kubectl -n`, `systemctl -l`): written once, on the parent. */
export const persistent = (opts: OptSpec[]): OptSpec[] => opts.map(([n, ja, en, flags = '', ...r]): OptSpec => [n, ja, en, `${flags} persistent`.trim(), ...r] as OptSpec);

/** `-N` for `-n N` (`git log -3`): `text` says what N counts; `open` is for `-$n`, whose number is known at run time. */
export const countOption = (text: (n: string) => Text, open: Text): PatternOption => ({ pattern: /^-(\d+)$/, text: ([, n]) => text(n), open });

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
