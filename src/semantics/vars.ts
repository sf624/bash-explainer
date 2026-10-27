// What the walk of the shell state (src/semantics/walk/) and the trust of its decisions (src/semantics/trust.ts)
// both read: declaration commands read with their builtin's spec, the catalog of the variables bash sets, and the names
// an arithmetic text assigns.
import { interpret, type ArgRole, type ArgvParse } from '../argv/interpret';
import { argWord } from '../argv/words';
import { builtins } from '../dict/builtins';
import type { SyntaxNode } from '../syntax/tree';
import { blinds, followed, none, type Row } from './allow';

/** The names an arithmetic text assigns (`x = 1`, `a[i] += 2`, `i++`, `--j`): group 1 (with 2, a subscript), 3 or 4. */
export const ARITH_ASSIGNED = /(?<![\w$])(?:([A-Za-z_]\w*)\s*(\[[^\]]*\])?\s*(?:[-+*/%&^|]|<<|>>)?=(?!=)|([A-Za-z_]\w*)\s*(?:\+\+|--)|(?:\+\+|--)\s*([A-Za-z_]\w*))/g;

/** What bash does with a variable of its own (GNU Bash manual, 5.1 "Bourne Shell Variables" and 5.2 "Bash Variables"). */
export interface BashVariable {
  /**
   * Bash gives it a value when it starts a script, also with an empty environment, with these attributes (as
   * `declare -p` shows them: `--`, `-i`, `-ar`…). test/bash-variables.test.ts compares them with bash's.
   */
  start?: string;
  /** Bash changes its value as the script runs (`RANDOM`, `LINENO`), or ignores what the script assigns (`GROUPS`). */
  dynamic?: true;
  /** Its value (each element of an array) is always a decimal integer: arithmetic that reads it runs no code. */
  numeric?: true;
  /** The text the script assigns to it is read as arithmetic, as for `declare -i` (`OPTIND='x=5'` sets x). */
  arithmetic?: true;
  /** The environment usually has it, exported (`HOME`, set at login): a shell the script starts gets it. */
  environment?: true;
  /** Bash ignores what the script assigns to it: it keeps its own value (`BASHPID`, `LINENO`). */
  ignored?: true;
  /**
   * Unset, it loses its special behaviour, even if it is set again (the manual's "loses its special properties"):
   * `unset RANDOM; RANDOM=5` is a plain variable.
   */
  unsetEnds?: true;
  /** What sets it without the script naming it: a builtin (`read` sets REPLY), a construct (`[[ =~ ]]`), the shell itself. */
  setBy?: readonly string[];
  /** What a write of it does to bash, for the trust (its row of the allow-list, src/semantics/allow.ts). */
  effect: Row;
}

const CD = ['cd', 'pushd', 'popd'];
const COMPLETION = ['programmable completion'];
const BIND = ['bind -x'];

// The effects of a write (docs/design/trust-allow-list.md, section 2, "Variables of bash").
/** It changes nothing a value or a decision reads (`PATH`: commands run in child processes). */
const NONE = none();
/** Bash sets it, or keeps its own: never trusted (`changedUnseen`). */
const BASH_SETS = followed(['test/bash-variables.test.ts: marks readonly, numeric and dynamic variables as bash treats an assignment to them']);
/** The word model splits with it (src/semantics/words.ts), and the test words check it (src/semantics/trust.ts). */
const IFS = followed(['words#ifs-colon', 'values#ifs-values']);
/** `set -x` expands it before each command: it must be a quiet prompt. */
const PS4 = followed(['values#xtrace-ps4', 'test/trust.test.ts: trusts nothing where bash may run a subscript, a prompt, a word list or a history line, or an inherited value']);
/** Bash reads its text as arithmetic. */
const OPTIND = followed(["test/trust.test.ts: reads bash's own variables from the catalog (src/semantics/vars.ts), as bash treats them"]);
/** The value of `~`. */
const HOME = followed(['words#home-tilde']);
/** Read by another shell the script starts (its model's start: `bash -c`, `sh -c`). */
const SHELL_START = followed(['test/nested.test.ts: starts another shell with its options, without what a slot removes, and with what its startup files may set']);
/** A locale: case conversion, character classes and ranges follow it. Followed for `C`, `POSIX`, `C.UTF-8` or empty (`localeKept`); else all. */
const LOCALE = followed(['values#locale-c', 'values#locale-other']);
/** What bash does after it, the walk does not follow: nothing is trusted. */
const later = (why: string): Row => blinds(why);

/**
 * The variables bash knows, each with what bash does with it: every variable of the manual's two lists (bash 5.2),
 * `TERM` and `COPROC_PID`, which bash also sets (`TERM` at start; `COPROC` stands for the name of a coprocess), bash
 * 5.3's `GLOBSORT`, `BASH_MONOSECONDS` and `BASH_TRAPSIG`, and `TEXTDOMAIN` and `TEXTDOMAINDIR` (`$"…"`, 3.1.2.5).
 */
export const BASH_VARIABLES: Readonly<Record<string, BashVariable>> = {
  // 5.1 Bourne Shell Variables.
  CDPATH: { effect: NONE }, HOME: { effect: HOME, environment: true }, IFS: { effect: IFS, start: '--' }, MAIL: { effect: NONE }, MAILPATH: { effect: NONE },
  OPTARG: { effect: BASH_SETS, setBy: ['getopts'] }, OPTIND: { effect: OPTIND, start: '-i', numeric: true, arithmetic: true, setBy: ['getopts'] },
  PATH: { effect: NONE, start: '--' }, PS1: { effect: NONE }, PS2: { effect: NONE },
  // 5.2 Bash Variables.
  _: { effect: BASH_SETS, start: '--', dynamic: true },
  BASH: { effect: NONE, start: '--' },
  BASHOPTS: { effect: BASH_SETS, start: '-r', dynamic: true },
  BASHPID: { effect: BASH_SETS, start: '-i', dynamic: true, numeric: true, ignored: true, unsetEnds: true },
  BASH_ALIASES: { effect: later('`BASH_ALIASES` may define an alias'), start: '-A', setBy: ['alias', 'unalias'], unsetEnds: true },
  BASH_ARGC: { effect: BASH_SETS, start: '-a', dynamic: true, numeric: true },
  BASH_ARGV: { effect: BASH_SETS, start: '-a', dynamic: true },
  BASH_ARGV0: { effect: NONE, start: '--', unsetEnds: true },
  BASH_CMDS: { effect: BASH_SETS, start: '-A', dynamic: true, unsetEnds: true },
  BASH_COMMAND: { effect: BASH_SETS, start: '--', dynamic: true, ignored: true, unsetEnds: true },
  BASH_COMPAT: { effect: later('`BASH_COMPAT` changes how bash reads the script') }, BASH_ENV: { effect: SHELL_START }, BASH_EXECUTION_STRING: { effect: NONE },
  BASH_LINENO: { effect: BASH_SETS, start: '-a', dynamic: true, numeric: true },
  BASH_LOADABLES_PATH: { effect: NONE, start: '--' },
  BASH_REMATCH: { effect: BASH_SETS, setBy: ['[[ =~ ]]'] },
  BASH_SOURCE: { effect: BASH_SETS, start: '-a', dynamic: true },
  BASH_SUBSHELL: { effect: BASH_SETS, start: '--', dynamic: true, numeric: true, unsetEnds: true },
  BASH_VERSINFO: { effect: BASH_SETS, start: '-ar' },
  BASH_VERSION: { effect: NONE, start: '--' },
  BASH_XTRACEFD: { effect: NONE }, CHILD_MAX: { effect: NONE },
  COLUMNS: { effect: BASH_SETS, setBy: ['checkwinsize'] },
  COMP_CWORD: { effect: BASH_SETS, setBy: COMPLETION }, COMP_LINE: { effect: BASH_SETS, setBy: COMPLETION }, COMP_POINT: { effect: BASH_SETS, setBy: COMPLETION },
  COMP_TYPE: { effect: BASH_SETS, setBy: COMPLETION }, COMP_KEY: { effect: BASH_SETS, setBy: COMPLETION },
  COMP_WORDBREAKS: { effect: NONE, start: '--', unsetEnds: true },
  COMP_WORDS: { effect: BASH_SETS, setBy: COMPLETION }, COMPREPLY: { effect: NONE },
  COPROC: { effect: BASH_SETS, setBy: ['coproc'] }, COPROC_PID: { effect: BASH_SETS, setBy: ['coproc'] },
  DIRSTACK: { effect: BASH_SETS, start: '-a', dynamic: true, unsetEnds: true },
  EMACS: { effect: NONE }, ENV: { effect: SHELL_START },
  EPOCHREALTIME: { effect: BASH_SETS, start: '--', dynamic: true, ignored: true, unsetEnds: true },
  EPOCHSECONDS: { effect: BASH_SETS, start: '--', dynamic: true, numeric: true, ignored: true, unsetEnds: true },
  EUID: { effect: BASH_SETS, start: '-ir', numeric: true },
  EXECIGNORE: { effect: NONE }, FCEDIT: { effect: NONE }, FIGNORE: { effect: NONE },
  FUNCNAME: { effect: BASH_SETS, dynamic: true, ignored: true, unsetEnds: true },
  FUNCNEST: { effect: later('`FUNCNEST` may stop a function call') }, GLOBIGNORE: { effect: NONE },
  GROUPS: { effect: BASH_SETS, start: '-a', dynamic: true, numeric: true, ignored: true, unsetEnds: true },
  HISTCMD: { effect: BASH_SETS, start: '-i', dynamic: true, numeric: true, arithmetic: true, ignored: true, unsetEnds: true },
  HISTCONTROL: { effect: NONE }, HISTFILE: { effect: NONE }, HISTFILESIZE: { effect: NONE }, HISTIGNORE: { effect: NONE }, HISTSIZE: { effect: NONE }, HISTTIMEFORMAT: { effect: NONE }, HOSTFILE: { effect: NONE },
  HOSTNAME: { effect: NONE, start: '--' }, HOSTTYPE: { effect: NONE, start: '--' },
  IGNOREEOF: { effect: NONE }, INPUTRC: { effect: NONE }, INSIDE_EMACS: { effect: NONE },
  LANG: { effect: LOCALE, environment: true }, LC_ALL: { effect: LOCALE }, LC_COLLATE: { effect: LOCALE }, LC_CTYPE: { effect: LOCALE }, LC_MESSAGES: { effect: NONE }, LC_NUMERIC: { effect: NONE }, LC_TIME: { effect: NONE },
  LINENO: { effect: BASH_SETS, start: '--', dynamic: true, numeric: true, ignored: true, unsetEnds: true },
  LINES: { effect: BASH_SETS, setBy: ['checkwinsize'] },
  MACHTYPE: { effect: NONE, start: '--' },
  MAILCHECK: { effect: NONE },
  MAPFILE: { effect: BASH_SETS, setBy: ['mapfile', 'readarray'] },
  OLDPWD: { effect: BASH_SETS, setBy: CD },
  OPTERR: { effect: NONE, start: '--' },
  OSTYPE: { effect: NONE, start: '--' },
  PIPESTATUS: { effect: BASH_SETS, dynamic: true, numeric: true },
  POSIXLY_CORRECT: { effect: later('`POSIXLY_CORRECT` turns on POSIX mode') },
  PPID: { effect: BASH_SETS, start: '-ir', numeric: true },
  PROMPT_COMMAND: { effect: NONE }, PROMPT_DIRTRIM: { effect: NONE }, PS0: { effect: NONE }, PS3: { effect: NONE },
  PS4: { effect: PS4, start: '--' },
  PWD: { effect: BASH_SETS, start: '-x', setBy: CD },
  RANDOM: { effect: BASH_SETS, start: '-i', dynamic: true, numeric: true, arithmetic: true, unsetEnds: true },
  READLINE_ARGUMENT: { effect: BASH_SETS, setBy: BIND }, READLINE_LINE: { effect: BASH_SETS, setBy: BIND }, READLINE_MARK: { effect: BASH_SETS, setBy: BIND }, READLINE_POINT: { effect: BASH_SETS, setBy: BIND },
  REPLY: { effect: BASH_SETS, setBy: ['read', 'select'] },
  SECONDS: { effect: BASH_SETS, start: '-i', dynamic: true, numeric: true, unsetEnds: true },
  SHELL: { effect: NONE, start: '--' },
  SHELLOPTS: { effect: BASH_SETS, start: '-r', dynamic: true },
  SHLVL: { effect: NONE, start: '-x' },
  SRANDOM: { effect: BASH_SETS, start: '-i', dynamic: true, numeric: true, arithmetic: true, ignored: true, unsetEnds: true },
  TERM: { effect: NONE, start: '--' },
  TIMEFORMAT: { effect: NONE }, TMOUT: { effect: NONE }, TMPDIR: { effect: NONE, environment: true }, histchars: { effect: NONE },
  // Not in the lists of bash 5.2's manual: bash 5.3's (GLOBSORT orders the words of a glob; the others are dynamic there:
  // DYNAMIC_SINCE_53), and the variables of `$"…"` (3.1.2.5).
  GLOBSORT: { effect: NONE }, BASH_MONOSECONDS: { effect: BASH_SETS }, BASH_TRAPSIG: { effect: BASH_SETS },
  TEXTDOMAIN: { effect: NONE }, TEXTDOMAINDIR: { effect: NONE },
  UID: { effect: BASH_SETS, start: '-ir', numeric: true },
};

const known = (name: string): BashVariable | undefined => (Object.hasOwn(BASH_VARIABLES, name) ? BASH_VARIABLES[name] : undefined);

/** What a write of the variable `name` does to bash (a variable of the script's own: nothing). */
export const writeEffect = (name: string): Row => known(name)?.effect ?? NONE;

/** Whether `name` sets the locale of case conversion, character classes or ranges (`LANG`, `LC_ALL`…): its row is `LOCALE`. */
export const localeVariable = (name: string): boolean => writeEffect(name) === LOCALE;

/**
 * The values of a locale variable that change nothing a value or a decision reads: C (its synonyms), and empty, which
 * leaves the locale to the next variable or to the environment (README, Limitations).
 */
const C_LOCALES = new Set(['', 'C', 'POSIX', 'C.UTF-8', 'C.utf8']);
export const cLocale = (value: string): boolean => C_LOCALES.has(value);

/** Whether bash sets `name` when it starts a script, whatever the environment. */
export const setAtStart = (name: string): boolean => known(name)?.start !== undefined;

/** Whether the text assigned to `name` is read as arithmetic (`OPTIND`, `RANDOM`: integers from the start). */
export const assignsArithmetic = (name: string): boolean => !!known(name)?.arithmetic;

/** The variables bash makes integers when it starts, whose text it reads as arithmetic (`OPTIND`, `RANDOM`…). */
export const INTEGERS_AT_START: readonly string[] = Object.keys(BASH_VARIABLES).filter(assignsArithmetic);

/** Whether `name` is readonly from the start (`UID`): what the script assigns to it fails. */
export const readonlyAtStart = (name: string): boolean => known(name)?.start?.includes('r') ?? false;

/**
 * Whether a shell the script starts has `name` whatever the script does: bash sets it at start, or it is set without
 * the script naming it, or the environment usually has it (`HOME`).
 */
export const givenToEveryShell = (name: string): boolean => setAtStart(name) || changedUnseen(name) || !!known(name)?.environment;

/** Whether bash ignores what the script assigns to `name` (`BASHPID`, `LINENO`): it keeps its own value. */
export const assignmentIgnored = (name: string): boolean => !!known(name)?.ignored;

/** Whether `name` loses its special behaviour once unset, even if it is set again (`RANDOM`, `SECONDS`). */
export const unsetEndsSpecial = (name: string): boolean => !!known(name)?.unsetEnds;

/** The variables readonly from the start (`UID`, `SHELLOPTS`…), each with the attribute letters bash gives it (`ir`). */
export const READONLY_AT_START: readonly (readonly [string, string])[] = Object.keys(BASH_VARIABLES).filter(readonlyAtStart).map((name) => [name, BASH_VARIABLES[name].start!.slice(1)]);

/**
 * The variables bash 5.3 changes as the script runs (docs/design/bash-versions.md, 3.3), which are plain ones in 5.2:
 * the model does not know which bash runs the script.
 */
export const DYNAMIC_SINCE_53: ReadonlySet<string> = new Set(['BASH_MONOSECONDS', 'BASH_TRAPSIG']);

/**
 * Whether the value of `name` is never known here: bash changes it as the script runs (`RANDOM`, `LINENO`; in 5.3,
 * `BASH_MONOSECONDS`), or keeps its own (a readonly variable such as `UID`).
 */
export const changedByBash = (name: string): boolean => !!known(name)?.dynamic || readonlyAtStart(name) || DYNAMIC_SINCE_53.has(name);

/** Whether the value of `name` is always a number, so that arithmetic reading it runs no code (`RANDOM`, `UID`, `OPTIND`). */
export const alwaysNumeric = (name: string): boolean => !!known(name)?.numeric;

/**
 * Whether something the walk does not follow may change `name` (src/semantics/trust.ts): bash itself (`changedByBash`),
 * or a builtin or construct that sets it without naming it (`read` sets REPLY, `cd` PWD).
 */
export const changedUnseen = (name: string): boolean => changedByBash(name) || !!known(name)?.setBy;

export interface Declaration {
  /** The role of each word (the options end at the first name or at `--`). */
  roles: Map<SyntaxNode, ArgRole>;
  /** The letters of the options turned on (`ix` of `declare -ix`), and of those turned off (`x` of `declare +x`). */
  on: string;
  off: string;
}

/** The options of a parse, one per letter of a cluster. */
export const optionRoles = (parse: ArgvParse): Extract<ArgRole, { role: 'option' }>[] =>
  parse.roles.flatMap((r) => (r.role.role === 'cluster' ? r.role.letters : [r.role])).filter((r): r is Extract<ArgRole, { role: 'option' }> => r.role === 'option');

/** The words of a declaration command `builtin` read with its spec. */
export function readDeclarationWords(builtin: string, words: SyntaxNode[]): Declaration {
  const parse = interpret(builtins[builtin], words.map(argWord), { name: builtin });
  const roles = new Map(parse.roles.map(({ word, role }) => [words[word], role]));
  let on = '';
  let off = '';
  for (const r of optionRoles(parse)) {
    if (r.disables) off += r.flag.slice(1);
    else on += r.flag.slice(1);
  }
  return { roles, on, off };
}
