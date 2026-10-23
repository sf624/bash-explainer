// The command spec: how a program reads its arguments (docs/design: "A: the command spec").
// A spec says which words are options, which take values, what the operands mean, and where
// another command starts. src/argv/interpret.ts reads a command's words with it.
//
// Some fields serve one entry. Each was reviewed (docs/design/refactor.md, D8) and is kept because it states a
// fact of that tool that no general field can, as its comment says; a second tool with the same fact uses it too.
import type { EmbeddedLang } from '../embedded/types';
import type { Shell } from '../dialect';
import type { Text } from '../i18n';
import type { OptionParser } from './parsers';

export interface CommandSpec {
  summary: Text;
  /** The family of option parser the program uses: a preset of src/argv/parsers.ts (default `gnu`). */
  parser?: OptionParser;
  /**
   * The first operand ends the options: a word after it is an operand too (`timeout 5 cmd -x`). getopt_long with an
   * optstring that starts with `+` (timeout, env, nice, xargs), POSIX getopt (bash's builtins), cobra's
   * `SetInterspersed(false)` (`docker run IMAGE CMD`).
   */
  optionsFirst?: boolean;
  /** `+x` turns an option off (`set +e`). */
  plusOptions?: boolean;
  options?: OptionSpec[];
  /** Options recognized by their form (`kill -TERM`, `-15`; `head -5`; `nice -10`), tried when no option has the word as its name. */
  patternOptions?: PatternOption[];
  /** Modes chosen by an option anywhere on the line (`rpm -q`). */
  modes?: ModeSpec[];
  /**
   * The mode is that of the last option given that selects one (`echo -e -E` reads no escapes), not the first of `modes`.
   * (echo only: it turns escapes on and off as it reads each letter; rpm's and kill's modes are chosen by the option, wherever.)
   */
  lastModeWins?: boolean;
  /** Dashless letters in the first word (`tar cvzf`, `ps aux`), or in any word (`ps -p 1 u`). */
  oldStyle?: OldStyleSpec;
  /**
   * What the operands mean: the first alternative whose condition holds and whose pattern fits. Absent: the
   * operands are not described (any number, with no meaning given).
   */
  operands?: OperandAlt[];
  /** What `--` does: end the options (the default), nothing (`echo`), or start words of another pattern. */
  dashDash?: 'end-options' | 'literal' | { then: OperandSpec[] };
  subcommands?: Record<string, SubcommandSpec>;
  /**
   * A prefix of a subcommand's name (or alias) selects it: a unique one (`true`), or any one, which selects the
   * first subcommand in the list that it starts (`'first'`, as iproute2 reads `ip a` as `ip address` and `ip m`
   * as `ip maddress`).
   */
  subcommandPrefixes?: boolean | 'first';
  /**
   * A word that matches is an operand and ends the options and the old-style letters: every word after it is an
   * operand too (procps `ps 1 u`: a bare number starts a list of process IDs, which ends the line). (procps `ps`
   * only: its own parser, which no preset describes.)
   */
  endsOptions?: RegExp;
  /**
   * The operands are an expression that patterns cannot describe; a parser of its own reads them: find's
   * (src/argv/interpret.ts), or test's (src/testexpr.ts, which the analyzer runs on `test`'s words as on `[ ]`).
   */
  operandParser?: 'find-expression' | 'test-expression';
  /** With `operandParser`: the spec the words of the expression are read with (find's tests and actions, `-name x`, `-exec … ;`). */
  expressionSpec?: CommandSpec;
  /**
   * What an option the spec does not list does, when the command refuses every other option (bats `run`: an error).
   * (bats' `run` only: other entries do not list every option, so an unknown one is only "not in the dictionary".)
   */
  unknownOption?: Text;
  builtin?: 'special' | 'regular';
  /**
   * What a builtin does to the shell that runs it: changes its state (`cd`, `set`, `export`, `read`) or ends it
   * (`exit`). In a subshell (src/semantics/env.ts), only the subshell. `when`: the calls that do, when not all of
   * them do (`set +o` and `umask` only print).
   */
  shellEffect?: {
    does: 'changes' | 'exits'; when?: (call: BuiltinCall) => boolean;
    /** The variable it sets when no word names one (a value or an operand with `sets`): `read` sets REPLY, `mapfile` the array MAPFILE. */
    byDefault?: { name: string; sets: VariableSet };
    /**
     * Variables it sets whatever its words (bats' `run`: `status`, `output`, `lines`); `maybe`: or leaves as they were, or
     * unsets (`run` sets `stderr` only with `--separate-stderr`).
     */
    always?: { name: string; sets: VariableSet; maybe?: boolean }[];
    /**
     * It runs in this shell what the model does not read: a file (`source`, bats' `load`), or a command line it builds
     * from its words (bats' `bats_pipe`, which `eval`s the pipeline it joins: with `lastpipe` its last stage runs here).
     */
    runsUnread?: 'file' | 'command-line';
    /** What it changes that the model follows besides variables: the shell's options (`set`, `shopt`), its aliases, the builtins enabled. */
    alters?: ('options' | 'aliases' | 'builtins')[];
  };
  /**
   * The program of a builtin's name (coreutils echo, procps kill): a path (`/bin/kill`) or a wrapper that starts
   * a program (`env echo`) runs it, and its options may differ from the builtin's.
   */
  program?: CommandSpec;
  /**
   * The worked example of a run of the command (src/examples/commands.ts): the simulation of that tool, chosen by the
   * spec rather than by the name, so that a path, an alias of the dictionary or a wrapped command gets it too, and a
   * function of the same name does not.
   */
  example?: CommandExampleKind;
}

/** The commands src/examples/commands.ts can run on sample input. */
export type CommandExampleKind = 'printf' | 'xargs' | 'getopt' | 'perl' | 'read' | 'sort' | 'uniq' | 'cut' | 'tr' | 'head' | 'tail' | 'seq' | 'basename' | 'dirname';

/**
 * A call of a builtin, as `shellEffect.when` reads it: the options given (`-p`, `+o`; `--` too), those given
 * without the value they take (`set -o`), and the operands' values (undefined when not known).
 */
export interface BuiltinCall { flags: string[]; bare: string[]; operands: (string | undefined)[] }

export type SubcommandSpec = CommandSpec & { aliases?: string[] };

export interface OptionSpec {
  /** `['-f', '--file']`. */
  names: string[];
  text: Text;
  /** What it does written with a `+` (`declare +x`, `set +f`), with the command's `plusOptions`, when that differs from turning it on. */
  offText?: Text;
  /**
   * What it does when no word gives the value it takes (`set -o` alone lists the settings); `offText` written with a `+`
   * (`set +o`). (`set -o` only: getopt makes a missing value an error, bash's `set` does not.)
   */
  noValue?: { text: Text; offText: Text };
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
  /**
   * The operands after this option that the pattern gives to its last, repeating item are these instead
   * (`jq '.' in.json --args a`: `in.json` is a file, `a` a positional value). (jq's `--args` and `--jsonargs` only.
   * An operand alternative with `when` cannot say it: the option changes only the operands after it, by position on
   * the line, and the pattern's items do not know where the option stood.)
   */
  laterOperands?: OperandSpec;
  /** Giving this option marks the line with this name (`kill -s`: a signal is given). */
  marks?: string;
  /** Once the line is marked with this name, a word that looks like this option is an operand (`kill -9 -1`: `-1` is a PID). */
  unlessMarked?: string;
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
  /** `variable`: a variable name, which the builtin sets as `sets` says; `function`: a function it runs later (`mapfile -C`, `complete -F`). */
  type?: ValueType;
  sets?: VariableSet;
  /** The value is written in another language (`grep -e PATTERN`). */
  lang?: EmbeddedLang;
  /** The meaning of particular values (`set -o pipefail`). */
  values?: Record<string, Text>;
  /**
   * The meaning of particular values given to the option written with a `+`, when that differs from undoing them
   * (`set +o noglob`). (`set +o` only, the one option with values that takes a `+`.)
   */
  offValues?: Record<string, Text>;
  /** The value is a command, read as a `command` role (`su -c 'cmd'`). */
  command?: CommandSlot;
  /**
   * The value gives the command a slot runs an environment variable (`docker run -e NAME[=VALUE]`), or a file
   * of them (`--env-file`).
   */
  setsEnv?: 'variable' | 'file';
  /**
   * The value is split into words that are read in its place, before the words after it, as more of the
   * command's own words (`env -S'-i A=1 bash -e'`: GNU env's rules, src/argv/envsplit.ts). (env only; the value
   * names the splitting rules, so another tool's would be another value.)
   */
  splice?: 'env';
  /** The value removes an environment variable from what the command a slot runs gets (`env -u NAME`). */
  unsetsEnv?: boolean;
}

/**
 * What a builtin does to the variable a word names (`type: 'variable'`; src/semantics/effects.ts): sets it to a
 * string (`read NAME`, `printf -v NAME`: a name or an element, `a[1]`), to an indexed array (`read -a NAME`), to the
 * lines it reads (`mapfile NAME`: an indexed array, named by a plain name), or to the ID of a job that ended (`wait -p
 * NAME`: bash unsets it first, and sets it only when a job ended).
 */
export type VariableSet = 'string' | 'array' | 'lines' | 'job-id';

export type ValueType = 'file' | 'dir' | 'number' | 'duration' | 'signal' | 'pid' | 'job' | 'user'
  | 'variable' | 'function' | 'arith' | 'pattern' | 'shell-option';

export interface PatternOption {
  pattern: RegExp;
  text: (m: RegExpMatchArray) => Text;
  /** The text for a `-` followed by an expansion (`head -$n`, `kill -$sig`), whose value is known only at run time. */
  open?: Text;
  marks?: string;
  unlessMarked?: string;
  /** Its text in a mode, as for `OptionSpec.inMode` (`kill -l -15`: the signal is not sent). */
  inMode?: Record<string, Text>;
}

export interface ModeSpec { name: string; default?: boolean }

export interface OldStyleSpec {
  /** The meaning of each letter. Default: the command's `-x` options. */
  letters?: Record<string, OptionSpec>;
  /** The word must hold at least one of these letters (the operation), which keeps ordinary words out. */
  needs?: string;
  /** What the word is called (default: old-style options). */
  style?: Text;
  /** Any word that is not an option or a value may be such letters, not only the first (procps reads `ps -p 1 u` as `ps u -p 1`). */
  anywhere?: boolean;
}

/** One way to read the operands: it applies when `when` holds and the pattern fits. */
export interface OperandAlt { when?: Condition; pattern: OperandSpec[] }

export interface OperandSpec {
  /** 'SOURCE', 'DEST', 'DURATION'. */
  name: string;
  text: Text;
  /** As in a regular expression; absent: exactly one. */
  repeat?: '?' | '*' | '+';
  /** As for a value (`ValueSpec.type`, `ValueSpec.sets`): `getopts OPTSTRING NAME` sets the variable NAME. */
  type?: ValueType;
  sets?: VariableSet;
  lang?: EmbeddedLang;
  /**
   * The words from here on are a command (`exec` and `current-shell` slots take every word left;
   * a `shell-string` slot is this one word, a script).
   */
  command?: CommandSlot;
  /** The meaning of particular values (`shopt -o errexit`: the names of `set -o`), shown in front of the operand's text. */
  values?: Record<string, Text>;
  /** Only a word whose text matches fits; a word whose text is not known fits too. */
  matches?: RegExp;
  /** Only a `NAME=value` word fits: a variable for the command that follows (`env A=1 cmd`). */
  assignment?: boolean;
  /**
   * A `NAME=value` word here is an assignment with this meaning instead (awk's operands; awk only so far). (Not
   * `assignment`, which makes only such a word fit the item: awk's item takes files and assignments mixed, in any
   * order, and `matches` would only filter, not give the other meaning.)
   */
  assignmentText?: Text;
  /** Only a word that names this option of the command fits, and it is read as that option (`flock FILE -c CMD`). */
  option?: string;
}

/**
 * When an alternative applies: an option is given, the mode is chosen, an operand (by its index among the
 * operands) has a known value that matches (`trap 1 2`: a number first makes every word a signal), an option
 * whose value splices words was given with a value that could not be split (`env -S"$cmd"`: not known;
 * `env -S'"a'`: refused), or not.
 */
export type Condition = { option: string[] } | { mode: string } | { operand: number; matches: RegExp } | { unsplit: string[] } | { not: Condition };

/** How the words of a command slot are run. */
export interface CommandSlot {
  /**
   * A program (`exec`), a new shell reading a string (`shell-string`), the current shell (`current-shell`: eval,
   * command), or a subshell of it (`subshell`: bats `run`, which runs its command in `$( )`: the command sees the
   * shell's functions and variables, and what it changes is gone when it ends).
   */
  run: 'exec' | 'shell-string' | 'current-shell' | 'subshell';
  /** Default 'local'. */
  where?: 'local' | 'remote' | 'container';
  /**
   * What reaches it: the exported variables and functions (the default), the exported variables but no
   * functions (`sudo -E`: sudo's policy removes values that start with `()`), a clean set (`su -`, `env -i`,
   * sudo), nothing. A slot inside another one gets only what each slot on the way passes on (`env -i bash -c f`).
   */
  env?: 'exported' | 'variables' | 'reset' | 'none';
  /** `command`, `builtin`. */
  lookup?: 'no-functions' | 'builtins-only';
  /**
   * With an option among `options`, `env` is this instead (`su -c`: the environment is kept; with `su -l -c`, it
   * starts afresh). (`su -c` only: a value's slot has no alternatives of operands to put this `when` in.)
   */
  envWith?: { options: string[]; env: 'exported' | 'variables' | 'reset' | 'none' };
  /** `exec cmd`: nothing after it runs. */
  replacesShell?: boolean;
  /**
   * The words left are joined into one string for the shell (ssh): with `shell-string`, the slot takes every
   * word left, like `exec`, instead of one word.
   */
  joinsWords?: boolean;
  /**
   * With `joinsWords`: each word is escaped before they are joined, so the shell reads the same words
   * (`sudo -s cmd args`), which are then read as a command; otherwise the shell reads the joined text afresh.
   * (sudo's `-s` and `-i` only. `joinsWords` alone says the shell reads the joined text afresh, as ssh's remote
   * shell does; sudo quotes each word first, which changes what runs, so the slot needs to say which it is.)
   */
  escapesWords?: boolean;
  /**
   * The string runs later, in the current shell (`trap 'cmd' INT`: when the signal comes). Like a `shell-string`
   * slot, it takes one word, so the words after it stay operands.
   */
  later?: boolean;
  /** The shell a `shell-string` slot starts, when the program's name does not say it (procps `watch` runs `sh -c`). */
  shell?: Shell;
}
