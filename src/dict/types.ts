import type { CommandSlot, CommandSpec, Condition, EachFile, IoUse, LayoutEnvironment, OperandAlt, OperandSpec, OptionSpec, PatternOption, ValueSpec } from '../argv/spec';
import type { BashVersion } from '../bashversion';
import type { EmbeddedLang } from '../embedded/types';
import { Text, tx } from '../i18n';
export { wordTable } from '../wordtable';

/**
 * `[names, ja, en, flags]` where names is `-r|--recursive` and flags may contain `arg` (a value; `arg2` for two
 * words, as `jq --arg NAME VALUE`), `until` (the words up to `;`, or `+` after a `{}`, are a command: `find -exec`; `until-each`: only up to `;`, `find -ok`), `fills`
 * (the option gives what is otherwise the first operand: `grep -e`), `setenv` and `envfile` (the value gives the
 * command a slot runs an environment variable, or a file of them: `docker run -e`), `attached` (a value only in the same word:
 * `-i.bak`), `next:<regexp>` (an optional value, taken from the next word when it matches: `journalctl -b -1`),
 * `lang:<name>` (the value's language), `io:<use>` (what the command does with the file the value names, `IoUse`:
 * `sort -o` writes it), `each:<how>` (how the command works on its input files when the option is given, `EachFile`:
 * `sed -i` rewrites each), `persistent` (subcommands take it too), `signless` (`+x` is `-x`: `OptionSpec.signless`) and `since:<release>` (the bash release that brought
 * a builtin's option: `OptionSpec.since`). The fifth item gives the meaning of particular
 * values (`set -o pipefail`).
 */
export type OptSpec = [string, string, string, string?] | [string, string, string, string, Record<string, Text>];

/** The option spec of a tuple (see `OptSpec`). */
export function optionOf([names, ja, en, flags = '', values]: OptSpec): OptionSpec {
  const each = /each:([\w-]+)/.exec(flags)?.[1] as EachFile | undefined;
  const since = /since:([\d.]+)/.exec(flags)?.[1] as BashVersion | undefined;
  const opt: OptionSpec = { names: names.split('|'), text: tx(ja, en), ...(flags.includes('persistent') ? { persistent: true } : {}), ...(flags.includes('signless') ? { signless: true } : {}), ...(each ? { eachFile: each } : {}), ...(since ? { since } : {}) };
  const lang = /lang:(\w+)/.exec(flags)?.[1] as EmbeddedLang | undefined;
  const io = /io:(\w+)/.exec(flags)?.[1] as IoUse | undefined;
  const setsEnv = /\bsetenv\b/.test(flags) ? 'variable' : flags.includes('envfile') ? 'file' : undefined;
  const extra: Partial<ValueSpec> = { ...(lang ? { lang } : {}), ...(io ? { io } : {}), ...(values ? { values } : {}), ...(setsEnv ? { setsEnv } : {}), ...(flags.includes('unsetenv') ? { unsetsEnv: true } : {}), ...(flags.includes('in-order') ? { inOrder: true } : {}) };
  const nextIf = /next:(\S+)/.exec(flags)?.[1];
  // (find's `-exec` and `-execdir` end at `;`, or at `+` after a `{}`; `-ok` and `-okdir` only at `;`.)
  if (flags.includes('until-each')) opt.until = { terminators: [';'], slot: { run: 'exec' } };
  else if (flags.includes('until')) opt.until = { terminators: [';', '+'], slot: { run: 'exec' }, endsAfter: { '+': '{}' } };
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
  /** What the command does with the file the operand at each index of `positional` names (`IoUse`); the last one repeats. */
  positionalIo?: (IoUse | undefined)[];
  /**
   * The most operands of `positional` the command takes (`count`; the last text repeats up to it): the words after them
   * are extra operands it refuses (`extra`, from `extraOperand`). With `unless`, only while none of these options is
   * given; with one, the last text repeats with no limit (`diff --from-file`).
   */
  atMost?: { count: number; extra: OperandSpec; unless?: string };
}

/**
 * The item for the words past the operands a command takes (`OperandSpec.extra`): it refuses them before doing
 * anything, printing `says` (and `also`, a second line) and exiting with `status` (coreutils `extra operand`, status 1).
 * With `once`, it is one word, not any number (`tr -d a b` prints the second line for the second word, `tr -d a b c` does not).
 */
export function extraOperand(says: string, status: number, o: { also?: string; once?: boolean } = {}): OperandSpec {
  const printed = o.also ? `\`${says}\` and \`${o.also}\`` : `\`${says}\``;
  const printedJa = o.also ? `\`${says}\` と \`${o.also}\` を` : `\`${says}\` と`;
  return {
    name: 'EXTRA', ...(o.once ? {} : { repeat: '*' as const }), extra: { says, status },
    text: tx(`余分なオペランド（コマンドは受け付けず、${printedJa}表示して何もせずに終了ステータス ${status} で終わる）`,
      `extra operand, which the command refuses (it prints ${printed} and exits with status ${status}, doing nothing)`),
  };
}

/**
 * The item for an operand alone where the command needs one more (`OperandSpec.extra`, as for an extra operand;
 * `tr a`: the command refuses it): it prints `says` with the operand, then `why`, and exits with `status`.
 */
export function lackingOperand(says: string, why: string, status: number): OperandSpec {
  return {
    name: 'LONE', extra: { says, status },
    text: tx(`1つだけの文字集合（コマンドは受け付けず、\`${says}\` とそのオペランド、\`${why}\` を表示して何もせずに終了ステータス ${status} で終わる）`,
      `lone character set, which the command refuses (it prints \`${says}\` and the operand, then \`${why}\`, and exits with status ${status}, doing nothing)`),
  };
}

/** The extra operands of GNU coreutils and of GNU diffutils (`cmp`, `diff`, `sdiff`, `diff3`: status 2). */
export const EXTRA_OPERAND = extraOperand('extra operand', 1);
export const DIFF_EXTRA_OPERAND = extraOperand('extra operand', 2);

/**
 * A dictionary entry: the spec of a command (src/argv/spec.ts). Options are tuples (`OptSpec`) or option specs;
 * the other fields are those of a spec, and `positional`.
 */
export function cmd(ja: string, en: string, opts: (OptSpec | OptionSpec)[] = [], rest: CmdRest = {}): CommandSpec {
  const summary = tx(ja, en);
  const { positional = [], positionalLang = [], positionalIo = [], operands = [], atMost, ...fields } = rest;
  const options = mergeOptions(opts.map((o) => (Array.isArray(o) ? optionOf(o) : o)));
  const fills = opts.flatMap((o) => (Array.isArray(o) && o[3]?.includes('fills') ? o[0].split('|') : []));
  // (With a limit, the operands up to it and the extra ones; with no limit when an option of `unless` is given.)
  const unless = atMost?.unless?.split('|');
  const limited: OperandAlt[] = atMost ? [{ ...(unless ? { when: { not: { option: unless } } } : {}), pattern: [...listed(positional, positionalLang, positionalIo, 0, atMost.count), atMost.extra] }] : [];
  const alts: OperandAlt[] = [
    ...operands,
    ...(fills.length ? [{ when: { option: fills }, pattern: listed(positional, positionalLang, positionalIo, 1) }] : []),
    ...limited,
    ...(positional.length && (!atMost || unless) ? [{ ...(unless ? { when: { option: unless } } : {}), pattern: listed(positional, positionalLang, positionalIo) }] : []),
  ];
  return { summary, options, ...fields, ...(alts.length ? { operands: alts } : {}) };
}

/** `ARG<i+1>`: the operand at index `i`, in the language given for it, and what the command does with the file it names. */
const item = (i: number, text: Text, repeat?: OperandSpec['repeat'], lang?: EmbeddedLang, io?: IoUse): OperandSpec =>
  ({ name: `ARG${i + 1}`, text, ...(repeat ? { repeat } : {}), ...(lang ? { lang } : {}), ...(io ? { io } : {}) });

/**
 * The texts from `from` on: each optional, and the last repeats (up to `most` operands in all, when given); a language
 * applies to its own index only, a use of a file to the repeats too.
 */
function listed(texts: Text[], langs: (EmbeddedLang | undefined)[], ios: (IoUse | undefined)[], from = 0, most?: number): OperandSpec[] {
  const out: OperandSpec[] = [];
  for (let i = from; i < texts.length; i++) {
    if (i < texts.length - 1) out.push(item(i, texts[i], '?', langs[i], ios[i]));
    else if (most !== undefined) for (let j = i; j < most; j++) out.push(item(j, texts[i], '?', j === i ? langs[i] : undefined, ios[i]));
    else if (langs[i]) out.push(item(i, texts[i], '?', langs[i], ios[i]), item(i + 1, texts[i], '*', undefined, ios[i]));
    else out.push(item(i, texts[i], '*', undefined, ios[i]));
  }
  return out;
}

/**
 * Operands by count (`seq 5`, `seq 1 5`; `cp a b` and `cp a b c dir/`): exactly `count` of them, or more with
 * `orMore`; the texts in order, the last one repeating, and `last` for the final one. `when` and `unless` are
 * options (`-t|--target-directory`) given, or not, for the alternative to apply; `langs` the language of each.
 * `extra`: the words after them are extra operands the command refuses (`extraOperand`: `seq 1 2 3 4`).
 */
export function byCount(count: number, texts: Text[], o: { orMore?: boolean; last?: Text; when?: string; unless?: string; langs?: (EmbeddedLang | undefined)[]; extra?: OperandSpec } = {}): OperandAlt {
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
  if (o.extra) pattern.push(o.extra);
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

/**
 * The options every GNU program has. An entry read with the `getopt_long` parser lists them, so that a prefix
 * (`--ver`) is ambiguous where the tool finds it so (`--verbose`, `--version`).
 */
export const GNU_INFO: OptSpec[] = [['--help', 'ヘルプを表示する', 'show help'], ['--version', 'バージョンを表示する', 'print the version']];

export const COMMAND_TEXT = tx('実行するコマンド', 'command to run');

/** The operand from which the words are the command a wrapper runs (`sudo cmd args`), started as `slot` says. */
export const runs = (slot: CommandSlot = { run: 'exec' }): OperandSpec => ({ name: 'COMMAND', text: COMMAND_TEXT, repeat: '?', command: slot });

/**
 * The variables of the caller's environment that sudo passes on by default, although `env_reset` starts the command
 * in a fresh environment (sudoers(5), "Command environment", `env_reset`, `env_check`, `env_keep`; sudo 1.9.15).
 * These are sudo's defaults: a sudoers file may change the lists (RHEL's replaces `env_keep` with its own). The
 * default `env_check` list keeps `COLORTERM`, `LANG`, `LANGUAGE`, `LC_*`, `LINGUAS`, `TERM` and `TZ` when the value
 * is safe (no `%` or `/`; for `TZ`, a zone name or a file of the zoneinfo directory), `TERM` being set to a default
 * otherwise; the default `env_keep` list keeps `COLORS`, `DISPLAY`, `HOSTNAME`, `KRB5CCNAME`, `LS_COLORS`, `PS1`,
 * `PS2`, `XAUTHORITY`, `XAUTHORIZATION` and `XDG_CURRENT_DESKTOP`, and Debian's and Ubuntu's sudo `DPKG_COLORS` (as
 * `sudo -V` lists them to root; the names are in sudoers.so). Not `PATH`, which `secure_path` (set on Debian and
 * Ubuntu) replaces, nor `HOME`, `MAIL`, `SHELL`, `LOGNAME` and `USER`, which are the target user's. With `-i`, these
 * lists still apply (sudoers(5)).
 */
export const SUDO_KEEPS: readonly string[] = [
  'TERM', 'LANG', 'COLORTERM', 'LANGUAGE', 'LC_*', 'LINGUAS', 'TZ',
  'COLORS', 'DISPLAY', 'HOSTNAME', 'KRB5CCNAME', 'LS_COLORS', 'PS1', 'PS2', 'XAUTHORITY', 'XAUTHORIZATION', 'XDG_CURRENT_DESKTOP', 'DPKG_COLORS',
];

/**
 * The variables of the caller's environment that doas passes on: it starts the command in a new environment, with
 * `DISPLAY` and `TERM` from the caller's, and `HOME`, `LOGNAME`, `PATH`, `SHELL` and `USER` set for the target user
 * (doas(1), OpenDoas 6.8). A rule of doas.conf(5) may pass more (`keepenv`, `setenv`): these are its defaults. (doas
 * takes no `NAME=value` words: `doas [-Lns] [-a style] [-C config] [-u user] command [arg ...]`.)
 */
export const DOAS_KEEPS: readonly string[] = ['DISPLAY', 'TERM'];

/**
 * The locales in which ls and df print dates, sizes, messages and the order of names as on the made-up system
 * (`LANG=en_US.UTF-8`, src/examples/layouts.ts): the C locale (an empty value reads as none), and en_US. Another
 * (`ja_JP.UTF-8`: `10月  1 18:02`; `de_DE.UTF-8`: `3,7K`; where coreutils' messages are installed, `合計` for
 * `total`, `ファイルシス` for `Filesystem`) changes them. `LANGUAGE` picks the messages too, outside the C locale:
 * any value but an empty one may change them. (en_US is listed here though the made-up `LANG` is en_US already:
 * `LC_ALL` and the others may name it too, and the dictionary does not read the made-up environment.)
 */
const LOCALES_AS_MADE_UP = ['', 'C', 'POSIX', 'C.UTF-8', 'C.utf8', 'en_US.UTF-8', 'en_US.utf8'];
/** The locale variables `names`, with `LANGUAGE`, which picks the language of messages beside `LC_MESSAGES`. */
const locale = (...names: string[]): LayoutEnvironment => ({ ...Object.fromEntries(names.map((n) => [n, LOCALES_AS_MADE_UP])), LANGUAGE: [''] });
/** The quoting styles of GNU ls that print the made-up names as they are (`c` and `shell-always` quote them). */
const QUOTING_STYLE = ['', 'literal', 'shell', 'shell-escape', 'escape'];

/**
 * The variables that change what GNU ls prints (`LayoutAlt.environment`, checked with coreutils 9.4): the names alone
 * (in a pipe, one a line: `COLUMNS` and `TABSIZE` do not count), `-l` (`TIME_STYLE`, the block size of the sizes and of
 * `total`, `POSIXLY_CORRECT`'s 512-byte blocks, the date of the locale, the word `total` in its language), `-lh` (its
 * sizes ignore the block size, but take the locale's decimal point).
 */
export const LS_ENV: LayoutEnvironment = { QUOTING_STYLE };
export const LS_LONG_ENV: LayoutEnvironment = {
  QUOTING_STYLE, TIME_STYLE: ['locale'], BLOCK_SIZE: [], LS_BLOCK_SIZE: [], BLOCKSIZE: [''], POSIXLY_CORRECT: [], ...locale('LC_ALL', 'LC_TIME', 'LC_MESSAGES', 'LANG'),
};
export const LS_HUMAN_ENV: LayoutEnvironment = { QUOTING_STYLE, TIME_STYLE: ['locale'], ...locale('LC_ALL', 'LC_TIME', 'LC_NUMERIC', 'LC_MESSAGES', 'LANG') };
/** What changes `df -h` (coreutils 9.4): the locale's decimal point, and the language of its header (`-h` ignores the block size). */
export const DF_HUMAN_ENV: LayoutEnvironment = locale('LC_ALL', 'LC_NUMERIC', 'LC_MESSAGES', 'LANG');
/**
 * What changes procps-ng's ps (4.0.4): the width of its lines (`COLUMNS`), the personality (`PS_PERSONALITY=bsd`,
 * `CMD_ENV`), `I_WANT_A_BROKEN_PS` (it reads `-ef` as BSD options), and `PS_FORMAT`, the columns of a bare `ps`.
 */
export const PS_ENV: LayoutEnvironment = { COLUMNS: [''], PS_PERSONALITY: [''], CMD_ENV: [''], I_WANT_A_BROKEN_PS: [], PS_FORMAT: [''] };
export const PS_BSD_ENV: LayoutEnvironment = { COLUMNS: [''], PS_PERSONALITY: [''], CMD_ENV: [''] };
export const PS_FULL_ENV: LayoutEnvironment = { COLUMNS: [''], PS_PERSONALITY: [''], CMD_ENV: [''], I_WANT_A_BROKEN_PS: [] };
/**
 * What changes who (coreutils 9.4): in the C locale, it writes the date as `Mar  3 09:30`; in any other, as on the
 * made-up system, `2026-03-03 09:30`. An empty `LANG` reads as none: the C locale.
 */
const ISO_DATES = ['C.UTF-8', 'C.utf8', 'en_US.UTF-8', 'en_US.utf8'];
export const WHO_ENV: LayoutEnvironment = { LC_ALL: ['', ...ISO_DATES], LC_TIME: ['', ...ISO_DATES], LANG: ISO_DATES };

/** `NAME=value` words before the command: variables for it (`env A=1 cmd`). */
export const ASSIGNMENTS: OperandSpec = { name: 'NAME=VALUE', text: tx('コマンドの環境に入れる変数', 'variable for the command'), assignment: true, repeat: '*' };

/** An operand of a spec, with its text in both languages. */
export const operand = (name: string, ja: string, en: string, rest: Partial<OperandSpec> = {}): OperandSpec => ({ name, text: tx(ja, en), ...rest });
