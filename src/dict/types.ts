import type { EmbeddedLang } from '../embedded/types';
import { Text, tx } from '../i18n';

export interface OptDoc {
  text: Text;
  /** The option consumes the next word (or the rest of a combined word) as its value. */
  arg?: boolean;
  /** Explanations for specific option values (e.g. `set -o pipefail`). */
  values?: Record<string, Text>;
  /** The option consumes words up to a terminator such as `;` or `+` (e.g. `find -exec`). */
  untilTerminator?: boolean;
  /** The option's value is written in an embedded language (e.g. `grep -e PATTERN`). */
  lang?: EmbeddedLang;
  /** The option supplies what is otherwise the first positional argument (`grep -e`, `sed -e`). */
  fillsPositional?: boolean;
  /** What the option means instead when one of these options is given (`-i` is `--info` with `-q`). */
  inMode?: { when: string; text: Text };
  /** The option takes the next word as its value only when that word matches this pattern (`journalctl -b -1`). */
  nextIf?: string;
  /** The option takes a value only when it is attached (`-i.bak`, `-F:`); it never consumes the next word. */
  attachedOnly?: boolean;
}

/**
 * The first argument may be options bundled without a dash (`tar xzf a.tgz`, `ps aux`, `ar rcs lib.a x.o`).
 * It is read that way only when it is made of nothing but known letters (and digits).
 */
export interface BundleDoc {
  /** Meaning of each letter as written without a dash. Default: the command's `-x` options. */
  options?: Record<string, OptDoc>;
  /** The word must hold at least one of these letters (the operation), which keeps ordinary words out. */
  needs?: string;
  /** What the bundle is called (default: old-style options). */
  style?: Text;
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
  builtin?: boolean;
  options?: Record<string, OptDoc>;
  /** Descriptions of positional arguments in order; the last one repeats. */
  positional?: Text[];
  /** Descriptions that depend on how many positional arguments there are; the first that fits wins over `positional`. */
  positionalBy?: PositionalBy[];
  /** Descriptions of the positional arguments when one of these options is given (`kill -l 15`: a signal, not a PID). */
  positionalWith?: Record<string, Text[]>;
  /** Embedded language of positional arguments, by index (does not repeat). */
  positionalLang?: (EmbeddedLang | undefined)[];
  /** After its own options, the remaining words form another command (sudo, xargs, env…). */
  wraps?: boolean;
  /** Positional operands before the wrapped command (`timeout 5 cmd`, `chroot dir cmd`, `docker run image cmd`). */
  wrapSkip?: number;
  /** The words after `--` form the wrapped command (`kubectl exec pod -- cmd`). */
  afterDashes?: boolean;
  /** `NAME=value` words before the wrapped command set variables for it (`env`, `sudo`, `doas`). */
  assigns?: boolean;
  /** A shell: with `-c`, the words after the command string are `$0`, `$1`…; otherwise the script and its arguments. */
  shellC?: boolean;
  subcommands?: Record<string, CommandDoc>;
  /** Options are single words that never combine (find, java-style `-name`). */
  longSingleDash?: boolean;
  /** The first argument may be dashless bundled options. A letter with `arg` takes the following words in order. */
  bundle?: BundleDoc;
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

/** The meanings of dashless letters, written like options but without the dash: `['c', 'ja', 'en']`. */
export function letters(opts: OptSpec[]): Record<string, OptDoc> {
  return cmd('', '', opts).options!;
}

export const pos = (ja: string, en: string): Text => tx(ja, en);

/** `cp a b` copies to `b`, `cp a b c dir` into `dir`: the last argument is the destination, unless an option names it. */
export function lastIsDestination(source: Text, one: Text, several: Text, unless = '-t|--target-directory'): PositionalBy[] {
  return [
    { count: 2, unless, texts: [source], last: one },
    { count: 3, orMore: true, unless, texts: [source], last: several },
  ];
}
