// The command spec: how a program reads its arguments (docs/design: "A: the command spec").
// A spec says which words are options, which take values, what the operands mean, and where
// another command starts. src/argv/interpret.ts reads a command's words with it.
//
// Some fields serve one entry. Each was reviewed (docs/design/refactor.md, D8) and is kept because it states a
// fact of that tool that no general field can, as its comment says; a second tool with the same fact uses it too.
import type { BashVersion } from '../bashversion';
import type { EmbeddedLang } from '../embedded/types';
import type { Shell } from '../dialect';
import type { Text } from '../i18n';
import type { OptionParser } from './parsers';

/** What a builtin ends (`CommandSpec.ends`): a loop, a pass of a loop, a function, the shell. */
export type Ends = 'loop' | 'pass' | 'function' | 'shell';

export interface CommandSpec {
  summary: Text;
  /**
   * Where the program usually is (`/usr/bin/time`), said where the same name is also something else (a builtin, a
   * reserved word): absent, a program found in PATH.
   */
  path?: string;
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
  /**
   * Options the program reads only when the word is its one and only argument (coreutils `echo --help`, `printf
   * --version`; with any other word given, they are text). The word must be known and the only one.
   */
  soleOptions?: OptionSpec[];
  /**
   * With `soleOptions`: an environment variable that, once it is set, makes them text (coreutils echo:
   * `POSIXLY_CORRECT`). The parse keeps the word's role as text too (`ArgvParse.sole`), and the explainer reads it as
   * the environment where the program runs makes it (src/semantics/env.ts, `variableIn`): text where the variable is
   * surely there, the option with a caveat where it may be.
   */
  soleUnlessEnv?: string;
  /** Options recognized by their form (`kill -TERM`, `-15`; `head -5`; `nice -10`), tried when no option has the word as its name. */
  patternOptions?: PatternOption[];
  /** Modes chosen by an option anywhere on the line (`rpm -q`). */
  modes?: ModeSpec[];
  /**
   * The mode is that of the last option given that selects one (`echo -e -E` reads no escapes), not the first of `modes`.
   * (echo: it turns escapes on and off as it reads each letter; xargs: `-I` and `-L` turn each other off. rpm's and
   * kill's modes are chosen by the option, wherever.)
   */
  lastModeWins?: boolean;
  /**
   * Options that select different modes refuse the line, and the text says so (GNU grep: `-E -F` is "conflicting
   * matchers specified", GNU tar: `-c -x` is "You may not specify more than one…", status 2); it is added to the
   * option that selects a mode other than the first one's, and the parse is `refused`.
   */
  conflictingModes?: Text;
  /** Dashless letters in the first word (`tar cvzf`, `ps aux`), or in any word (`ps -p 1 u`). */
  oldStyle?: OldStyleSpec;
  /**
   * What the operands mean: the first alternative whose condition holds and whose pattern fits. Absent: the
   * operands are not described (any number, with no meaning given).
   */
  operands?: OperandAlt[];
  /**
   * What `--` does: end the options (the default), nothing (`echo`), start words of another pattern, or nothing but an
   * error: an option the command refuses, which `refused` explains (procps `ps`: "garbage option").
   */
  dashDash?: 'end-options' | 'literal' | { then: OperandSpec[] } | { refused: Text };
  subcommands?: Record<string, SubcommandSpec>;
  /**
   * A prefix of a subcommand's name (or alias) selects it: a unique one (`true`), or any one, which selects the
   * first subcommand in the list that it starts (`'first'`, as iproute2 reads `ip a` as `ip address` and `ip m`
   * as `ip maddress`).
   */
  subcommandPrefixes?: boolean | 'first';
  /**
   * A word that matches is an operand, even when it starts with a dash, and ends the options and the old-style
   * letters: every word after it is an operand too (procps `ps 1 u`: a bare number starts a list of process IDs,
   * which ends the line; GNU `seq -2 2`: a negative number is the first operand). (procps `ps` and GNU `seq`: each
   * checks the word before its parser reads it, which no preset describes.)
   */
  endsOptions?: RegExp;
  /**
   * The operands are an expression that patterns cannot describe; a parser of its own reads them: find's
   * (src/argv/interpret.ts), or test's (src/testexpr.ts, which the analyzer runs on `test`'s words as on `[ ]`).
   */
  operandParser?: 'find-expression' | 'test-expression';
  /**
   * With `test-expression`: the word its last argument must be, which ends the expression (`[` wants `]`). Without
   * it, the command fails at run time (bash: `[: missing ']'`, status 2).
   */
  closingOperand?: string;
  /** With `operandParser`: the spec the words of the expression are read with (find's tests and actions, `-name x`, `-exec … ;`). */
  expressionSpec?: CommandSpec;
  /**
   * What an option the spec does not list does, when the command refuses every other option (bats `run`: an error;
   * bash when it starts: `invalid option`, status 2). (bats' `run` and bash only: other entries do not list every
   * option, so an unknown one is only "not in the dictionary".)
   */
  unknownOption?: Text;
  /**
   * What a long option after a short one does, with the parser rule `longFirst` (bash: `--: invalid option`). (bash
   * only, the one parser with that rule.)
   */
  lateOption?: Text;
  builtin?: 'special' | 'regular';
  /**
   * How a builtin reads its words where shell options are on (manual 6.11): the first entry whose options are all
   * on at the command replaces these fields of the spec, and its `text` is added to the summary. `kill` in POSIX mode
   * refuses a signal name with `SIG`; `echo` with `xpg_echo` reads escapes by default, and in POSIX mode takes no
   * options at all.
   */
  inShell?: readonly ShellVariant[];
  /**
   * What a builtin ends, where the path goes on after it: `loop`, the loop it runs in (`break`); `pass`, the pass of
   * that loop, which goes on with the next one (`continue`); `function`, the function that runs it or a file that
   * `source` reads (`return`); `shell`, the shell, or the subshell it runs in (`exit`). Outside a loop, `break` and
   * `continue` do nothing (bash says "only meaningful in a … loop", status 0); outside a function and a sourced file,
   * `return` fails ("can only `return' from a function or sourced script", status 2) and the path goes on. So in a
   * trap's action, `return` ends the function the signal interrupted (and the action with it), or fails when no
   * function was running (bash 5.2; `Walker.jump` takes both).
   */
  ends?: Ends;
  /**
   * Where a builtin works, when not anywhere: only in a function (`local`). Outside one it fails and changes nothing
   * (bash: "local: can only be used in a function", status 1; dash: "not in a function"). `except`: the shells where
   * that is not so (zsh's, mksh's and yash's `local` is their `typeset`, which works anywhere; ksh93 has no `local`).
   */
  scope?: { only: 'function'; except: readonly Shell[] };
  /**
   * What a declaration builtin run in a function makes of the names it declares: `unless-g`, local variables of the
   * function unless `-g` is given, which acts on the global ones (`declare`, `typeset`, `local`: bash 5.2's `local -g x`
   * is `declare -g x`). Without it (`export`, `readonly`), the variables visible there, a local one if there is one,
   * else the global one.
   */
  locals?: 'unless-g';
  /** The operand `-` makes the set options local to the function: they come back when it returns (`local -`; bash 5.2 rejects `declare -`). */
  localOptions?: true;
  /**
   * What a builtin does to the shell that runs it: changes its state (`cd`, `set`, `export`, `read`). (Ending it,
   * `exit`, is `ends`.) In a subshell (src/semantics/env.ts), only the subshell. `when`: the calls that do, when not
   * all of them do (`set +o` and `umask` only print).
   */
  shellEffect?: {
    does: 'changes'; when?: (call: BuiltinCall) => boolean;
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
   * spec rather than by the name, so that a path (`/usr/bin/sort`) or a quoted name (`"seq"`) gets it too, and a
   * function of the same name does not. A command that a wrapper runs (`sudo sort -r f`, `env seq 3`) gets none.
   */
  example?: CommandExampleKind;
  /** How it works on several input files when not as one stream (`EachFile`): head and tail print each under a header. */
  eachFile?: EachFile;
  /**
   * It prints what it reads as it is (cat): its worked example is shown only when it joins several streams, and the
   * example of a pipeline shows no step of its own for it before the last.
   */
  copies?: boolean;
  /** Its program can read the name of the file it reads (awk's `FILENAME`): the example tells it the names. */
  fileName?: boolean;
  /**
   * What it prints is made of its words: joined with spaces (`words`: echo), or by its first word as a format (`format`:
   * printf). The example of a brace expansion in its words shows what it prints, and a word bash globs has no known value.
   * (What a command prints from what it reads, in a layout of its own, is `layouts`.)
   */
  prints?: 'words' | 'format';
  /**
   * What it prints, as made-up lines of the real layout (`ps aux`: a header and a row per process), for the examples of
   * the commands after it in a pipeline (src/examples/layouts.ts): the first alternative whose options are exactly the
   * ones given, with no operand. (What a command prints made of its words, as echo, is `prints`.)
   */
  layouts?: LayoutAlt[];
  /**
   * It downloads what the URLs among its operands name, and writes it to its standard output (`stdout`: curl) or to a
   * file named after each URL (`file`: wget). An option value with `io: 'write'` writes it to the file the value
   * names instead, `-` being the standard output (`curl -o f`, `wget -O -`); an option of `elsewhere` writes it to a
   * file it names itself, or fetches nothing to print (`curl -O`, `wget --spider`).
   */
  downloads?: { to: 'stdout' | 'file'; elsewhere: string[] };
  /**
   * What a restricted shell (`bash -r`, `rbash`: Bash manual 6.10) refuses of this builtin, which then fails with
   * status 1 and does nothing (`Restriction`). Absent: nothing.
   */
  restricted?: Restriction;
}

/**
 * The calls of a builtin a restricted shell refuses: every call (`{}`: `cd`), but with an option of `unless` (`pushd
 * -n`) or a word of its own options that `unlessWord` matches (`popd +1`); only with an option of `options`, given
 * its value (`command -p`, `enable -f x`, `history -r`); only one with a word after its options (`command`: `exec cmd`,
 * `command -p ls`, `hash -p /bin/ls ls`); only one whose file is named with a `/` (`slash`): its first operand (`. ./f`,
 * `history -r /tmp/h`), or the value of that option (`hash -p /bin/ls ls`). bash names that file in its message (`.:
 * ./f: restricted`), or the option with `namesOption` (`command: -p: restricted`, but `enable: restricted`). Each
 * checked with bash 5.2 and 5.3.
 */
export interface Restriction { options?: string[]; unless?: string[]; unlessWord?: RegExp; command?: true; slash?: 'operand' | string; namesOption?: true }

/** The layouts of output that src/examples/layouts.ts makes up. */
export type Layout = 'ps' | 'ps-bsd-u' | 'ps-full' | 'ls' | 'ls-long' | 'ls-long-all' | 'ls-long-human' | 'df-human' | 'who' | 'env';

/** One layout of a command's output: `options`, the options given (as their spec names them: `-l`, BSD letters `a` `u` `x`). */
export interface LayoutAlt { options: string[]; layout: Layout }

/**
 * How a command works on several input files (operands and values with `io: 'input'`) when it does not read them as
 * one stream, as cat, sort, sed and jq do (the default); the worked examples follow it (src/examples/source.ts).
 * `headers`: it prints its result for each file apart, under a header `==> a <==` (head, tail). `apart`: it works on
 * each apart (grep puts the name before each line, wc prints a line each and a total, `sed -s` counts the lines and
 * finds `$` in each): the example shows the first file. `in-place`: it rewrites each file with
 * its result (`sed -i`, `perl -i`, kislyuk/yq's `-i`): the example shows the first file and what it becomes.
 * `into-first`: it reads them all and writes its whole result into the first, instead of printing it (mikefarah/yq's
 * `-i`): the example shows each file and what the first becomes.
 */
export type EachFile = 'headers' | 'apart' | 'in-place' | 'into-first';

/** The commands src/examples/commands.ts can run on sample input. */
export type CommandExampleKind = 'printf' | 'xargs' | 'getopt' | 'perl' | 'read' | 'cat' | 'sort' | 'uniq' | 'cut' | 'tr' | 'head' | 'tail' | 'seq' | 'basename' | 'dirname';

/**
 * A call of a builtin, as `shellEffect.when` reads it: the options given (`-p`, `+o`; `--` too), those given
 * without the value they take (`set -o`), and the operands' values (undefined when not known).
 */
export interface BuiltinCall { flags: string[]; bare: string[]; operands: (string | undefined)[] }

export type SubcommandSpec = CommandSpec & { aliases?: string[] };

export interface OptionSpec {
  /**
   * The bash release that brought a builtin's option (`source -p`: 5.3): an earlier bash reports "invalid option",
   * and the dialect check says so in that release (`laterOptions` in src/dialect.ts).
   */
  since?: BashVersion;
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
  /**
   * Written with `+` instead of `-`, it is the same option, not undone (bash's `+c`, `+l`, `+s`, `+D` when it starts:
   * shell.c reads the sign only for the letters of `set`). (bash's invocation only.)
   */
  signless?: boolean;
  /** The mode it selects (`-q` selects 'query'). */
  selects?: string;
  /** Its meaning in a mode (`rpm -i` is information when querying). */
  inMode?: Record<string, Text>;
  /** The words up to one of the terminators form a command (`find -exec … ;`). */
  until?: {
    terminators: string[];
    slot: CommandSlot;
    /**
     * A terminator that ends the command only right after a word holding the given text (find's `+` after `{}`); anywhere
     * else it is a word of the command (`-exec echo a + \;`). The word must be that text alone, and no other word may hold it.
     */
    endsAfter?: Record<string, string>;
  };
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
  /** Given, the command works on its input files so (`EachFile`): `sed -s` reads each apart, `sed -i` and `perl -i` rewrite each. */
  eachFile?: EachFile;
  /**
   * Given, a pattern (an operand or a value in `lang: 'regex'`) matches only a whole word (`grep -w`) or a whole line
   * (`grep -x`), not a part of a longer one.
   */
  whole?: 'word' | 'line';
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
  /** A next word whose text matches is no value: the option has none there (`set -o -e` lists the options, then sets `-e`). */
  notValue?: RegExp;
  /**
   * With `optional`, the rest of a cluster is the value only when it matches; otherwise the letters after the option
   * are options too (perl's `-l0` and `-0777` take octal digits, `-lne` is `-l -n -e`). (perl only: its switches
   * take digits attached and go on with letters; a value of digits followed by letters, `-l0ne`, is not modelled.)
   */
  attachedMatch?: RegExp;
  /** `variable`: a variable name, which the builtin sets as `sets` says; `function`: a function it runs later (`mapfile -C`, `complete -F`). */
  type?: ValueType;
  sets?: VariableSet;
  /** The value is written in another language (`grep -e PATTERN`). */
  lang?: EmbeddedLang;
  /** What the command does with the file the value names (`IoUse`): `sort -o OUT` writes it, `jq --slurpfile NAME FILE` reads it. */
  io?: IoUse;
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
  /**
   * The program reads the value as soon as it reads the option, with the options given so far: an option given after
   * it does not apply to it (sed compiles each `-e` script at once, so `sed -e 's/a+/x/' -E` reads a BRE).
   */
  inOrder?: boolean;
}

/**
 * What a builtin does to the variable a word names (`type: 'variable'`; src/semantics/effects.ts): sets it to a
 * string (`read NAME`, `printf -v NAME`: a name or an element, `a[1]`), to an indexed array (`read -a NAME`), to the
 * lines it reads (`mapfile NAME`: an indexed array, named by a plain name), or to the ID of a job that ended (`wait -p
 * NAME`: bash unsets it first, and sets it only when a job ended).
 */
export type VariableSet = 'string' | 'array' | 'lines' | 'job-id';

/**
 * What a builtin does to the name an operand of `type: 'variable'` gives, beside setting its value (`sets`):
 * `declares`, it declares the name, or assigns it with `NAME=value` (`declare`, `export`, `local`); `unsets`, it
 * removes it (`unset`).
 */
export type VariableAct = 'declares' | 'unsets';

/** What a name of a `VariableAct` operand stands for: a variable, a function, the name reference itself (not the variable it points to). */
export type NameSpace = 'variable' | 'function' | 'nameref';

/**
 * The options that make the names of a `VariableAct` operand stand for something other than a variable
 * (src/argv/query.ts `namespaceOf`): the first one given in this list wins (`unset -fn f`: the function).
 */
export interface NameOptions {
  options: readonly (readonly [flag: string, space: NameSpace])[];
  /** With none of `options`, the variable of that name if there is one, else the function (`unset NAME`). */
  orFunction?: boolean;
  /** Options that cannot be given together: then the builtin fails and acts on no name (`unset -fv`). */
  exclusive?: readonly string[];
}

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
  /**
   * A letter that takes a value takes the rest of its word when there is some (procps `ps opid,comm`, `ps Uroot`, `ps
   * rU root`: the value is `root` there too), else the next word. Not for tar, whose letters take the next words.
   */
  attachedValues?: boolean;
  /**
   * A number (or a comma-separated list) at the end of the word, after the letters. If the last letter takes a value,
   * it is that value (`ps t1`, `ps p1,2`); else it is the value of `option`, a letter of `letters`, that `text` says
   * (procps: `ps u1` is `ps u p1`).
   */
  numbers?: { option: string; text: Text };
}

/**
 * What a command does with a file a word names, which the worked examples follow (src/examples/source.ts): `input`,
 * it reads the data it works on from it, instead of its standard input (`sort FILE`, `jq FILTER FILE`, `xargs -a
 * FILE`); `read`, it reads something else from it (a script, `sed -f FILE`; a variable, `jq --rawfile NAME FILE`);
 * `write`, it writes its output to it, not to its standard output (`sort -o FILE`, `uniq IN OUT`; not `tee FILE`, which copies it there);
 * `run`, it runs the commands the file holds, as a script of its own (`bash FILE`, `source FILE`).
 */
export type IoUse = 'input' | 'read' | 'write' | 'run';

/** A builtin's spec where the options of `set -o` and `shopt` named are all on (`CommandSpec.inShell`). */
export interface ShellVariant {
  set?: readonly string[];
  shopt?: readonly string[];
  /** The fields that change. */
  spec: Partial<CommandSpec>;
  /** What changes, added to the summary. */
  text: Text;
  /** It is about what an error of a special builtin does: not behind `command`, which makes the builtin a regular one. */
  special?: true;
}

/** One way to read the operands: it applies when `when` holds and the pattern fits. */
export interface OperandAlt {
  when?: Condition;
  pattern: OperandSpec[];
  /**
   * `script`: under this alternative, the command reads the script it runs from its standard input, unless an operand
   * with `io: 'run'` names a file other than `-` (`bash`, `sh -s -- a`; not `bash file`, nor `bash -c '…'`).
   */
  stdin?: 'script';
}

export interface OperandSpec {
  /** 'SOURCE', 'DEST', 'DURATION'. */
  name: string;
  text: Text;
  /** As in a regular expression; absent: exactly one. */
  repeat?: '?' | '*' | '+';
  /** As for a value (`ValueSpec.type`, `ValueSpec.sets`): `getopts OPTSTRING NAME` sets the variable NAME. */
  type?: ValueType;
  sets?: VariableSet;
  /**
   * With `type: 'variable'`: what the builtin does to the name (`declare NAME[=VALUE]`, `unset NAME`), and the options
   * that make it name a function or a name reference instead (`names`). A name with a subscript (`a[1]`) is an element
   * of an array; written unquoted, it is a glob pattern first.
   */
  acts?: VariableAct;
  names?: NameOptions;
  lang?: EmbeddedLang;
  /** What the command does with the file the operand names (`IoUse`): `sort FILE` reads its input from it, `uniq IN OUT` writes OUT. */
  io?: IoUse;
  /**
   * The words from here on are a command (`exec` and `current-shell` slots take every word left;
   * a `shell-string` slot is this one word, a script).
   */
  command?: CommandSlot;
  /** The meaning of particular values (`shopt -o errexit`: the names of `set -o`), shown in front of the operand's text. */
  values?: Record<string, Text>;
  /** Only a word whose text matches fits; a word whose text is not known fits too, unless `known`. */
  matches?: RegExp;
  /** With `matches`, a word whose text is not known does not fit: the item says something only a known text shows (`alias a/b=x`). */
  known?: boolean;
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
  /**
   * A name with no `/` is looked for in the directories of `$PATH` while the shell option `shopt` is on, and then in
   * the current directory, except in POSIX mode (bash's `.` and `source`: `sourcepath`); an option of `instead` gives
   * the directories to look in (`source -p`, bash 5.3).
   */
  searchesPath?: { shopt: string; instead: string[] };
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
  /**
   * With `reset`: the variables of the caller's environment that still reach the command, when they are exported
   * (sudo's defaults: `SUDO_KEEPS`, src/dict/types.ts); a name that ends in `*` stands for every name it starts (`LC_*`).
   */
  keeps?: readonly string[];
  /** `command`, `builtin`. */
  lookup?: 'no-functions' | 'builtins-only';
  /**
   * With an option among `options`, `env` is this instead (`su -c`: the environment is kept; with `su -l -c`, it
   * starts afresh). (`su -c` only: a value's slot has no alternatives of operands to put this `when` in.)
   */
  envWith?: { options: string[]; env: 'exported' | 'variables' | 'reset' | 'none'; keeps?: readonly string[] };
  /**
   * The program adds words of its own after the command's arguments when it runs it (`xargs cmd`: the words it reads),
   * so no word of the command is its one argument (`xargs echo --version` prints `--version` and the input). Not so
   * with a replace string (`xargs -I{}`), which says where the input goes, unless a later `-L` or `-l` turns it off
   * (GNU xargs: "ignoring previous --replace value"; a later `-I` turns those off: xargs's modes, `lastModeWins`).
   */
  appends?: boolean;
  /** `exec cmd`: nothing after it runs. */
  replacesShell?: boolean;
  /** With `shell-string`: the operands after the string are its `$0`, `$1`… (`sh -c '…' sh "$msg"`). */
  params?: boolean;
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
