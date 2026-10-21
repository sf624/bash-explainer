// The command spec: how a program reads its arguments (docs/design: "A: the command spec").
// A spec says which words are options, which take values, what the operands mean, and where
// another command starts. src/argv/interpret.ts reads a command's words with it.
import type { EmbeddedLang } from '../embedded/types';
import type { Text } from '../i18n';

export interface CommandSpec {
  summary: Text;
  /**
   * How options are written. `gnu` (the default): short options cluster (`-xvf`), long ones start with `--`,
   * and options may come after operands. `posix`: the same, but the first operand ends the options.
   * `single-dash`: every option is one word (`-name`, `-var-file=x`) and never clusters. `none`: a word is an
   * option only when each of its letters is a known option, and the first operand ends them (`echo -ne`; `echo -x` prints `-x`).
   */
  style?: 'gnu' | 'posix' | 'single-dash' | 'none';
  /** `+x` turns an option off (`set +e`). */
  plusOptions?: boolean;
  /** A long option may be written as a unique prefix of its name (`--pres` for `--preserve-status`), as getopt_long allows. */
  longPrefixes?: boolean;
  options?: OptionSpec[];
  /** Options recognized by their form (`kill -TERM`, `-15`; `head -5`; `nice -10`), tried when no option has the word as its name. */
  patternOptions?: PatternOption[];
  /** Modes chosen by an option anywhere on the line (`rpm -q`). */
  modes?: ModeSpec[];
  /** Dashless letters in the first word (`tar cvzf`, `ps aux`). */
  oldStyle?: OldStyleSpec;
  /** What the operands mean: the first alternative whose condition holds and whose pattern fits. */
  operands?: OperandAlt[];
  /** What `--` does: end the options (the default), nothing (`echo`), or start words of another pattern. */
  dashDash?: 'end-options' | 'literal' | { then: OperandSpec[] };
  subcommands?: Record<string, SubcommandSpec>;
  /** A unique prefix of a subcommand's name selects it (`ip a` is `ip address`). */
  subcommandPrefixes?: boolean;
  /** The operands are an expression that patterns cannot describe; a parser of its own reads them. */
  operandParser?: 'find-expression';
  builtin?: 'special' | 'regular';
}

export type SubcommandSpec = CommandSpec & { aliases?: string[] };

export interface OptionSpec {
  /** `['-f', '--file']`. */
  names: string[];
  text: Text;
  /** The value the option takes; a list when it takes several words (`jq --arg NAME VALUE`). */
  value?: ValueSpec | ValueSpec[];
  /** Inherited by subcommands (`kubectl -n`). */
  persistent?: boolean;
  /** The mode it selects (`-q` selects 'query'). */
  selects?: string;
  /** Its meaning in a mode (`rpm -i` is information when querying). */
  inMode?: Record<string, Text>;
  /** The words up to one of the terminators form a command (`find -exec … ;`). */
  until?: { terminators: string[]; slot: CommandSlot };
}

export interface ValueSpec {
  /** Shown as a placeholder: ‹FILE›. */
  name: string;
  text?: Text;
  /**
   * Where the value is written. `attached-or-next` (the default): the rest of the word (`-n5`, `--n=5`), or
   * the next word. `attached-only`: only the rest of the word. `next-only`: always the next word unused so far,
   * and the letters after it in a cluster still count (`set -euo pipefail`).
   */
  how?: 'attached-or-next' | 'attached-only' | 'next-only';
  /** The value may be left out (getopt's optional_argument): then it is only taken attached, or from the next word that matches `next`. */
  optional?: boolean;
  /** With `optional`, the next word is the value when it matches (`journalctl -b -1`). */
  next?: RegExp;
  type?: ValueType;
  /** The value is written in another language (`grep -e PATTERN`). */
  lang?: EmbeddedLang;
  /** The meaning of particular values (`set -o pipefail`). */
  values?: Record<string, Text>;
  /** The value is a command (`su -c 'cmd'`). */
  command?: CommandSlot;
}

export type ValueType = 'file' | 'dir' | 'number' | 'duration' | 'signal' | 'pid' | 'job' | 'user'
  | 'variable' | 'function' | 'arith' | 'pattern' | 'shell-option';

export interface PatternOption { pattern: RegExp; text: (m: RegExpMatchArray) => Text }

export interface ModeSpec { name: string; default?: boolean }

export interface OldStyleSpec {
  /** The meaning of each letter. Default: the command's `-x` options. */
  letters?: Record<string, OptionSpec>;
  /** The word must hold at least one of these letters (the operation), which keeps ordinary words out. */
  needs?: string;
  /** What the word is called (default: old-style options). */
  style?: Text;
}

/** One way to read the operands: it applies when `when` holds and the pattern fits. */
export interface OperandAlt { when?: Condition; pattern: OperandSpec[] }

export interface OperandSpec {
  /** 'SOURCE', 'DEST', 'DURATION'. */
  name: string;
  text: Text;
  /** As in a regular expression; absent: exactly one. */
  repeat?: '?' | '*' | '+';
  type?: ValueType;
  lang?: EmbeddedLang;
  /**
   * The words from here on are a command (`exec` and `current-shell` slots take every word left;
   * a `shell-string` slot is this one word, a script).
   */
  command?: CommandSlot;
  /** Only a `NAME=value` word fits: a variable for the command that follows (`env A=1 cmd`). */
  assignment?: boolean;
  /** A `NAME=value` word here is an assignment with this meaning instead (awk's operands). */
  assignmentText?: Text;
}

export type Condition = { option: string[] } | { mode: string } | { not: Condition };

/** How the words of a command slot are run. */
export interface CommandSlot {
  run: 'exec' | 'shell-string' | 'current-shell';
  /** Default 'local'. */
  where?: 'local' | 'remote' | 'container';
  /** What reaches it: exported variables, a clean set (`su -`), nothing. */
  env?: 'exported' | 'reset' | 'none';
  /** `command`, `builtin`. */
  lookup?: 'no-functions' | 'builtins-only';
  /** `exec cmd`: nothing after it runs. */
  replacesShell?: boolean;
  /** ssh joins the words into one string for the remote shell. */
  joinsWords?: boolean;
}
