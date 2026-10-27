import type { Lang } from './i18n';
import { wordTable } from './wordtable';

// The GNU Bash Reference Manual, as the explanations cite it: by the section numbers of bash 5.2, with a link to its
// page on gnu.org. The texts are our own words; the manual (GFDL) is cited, never quoted.
//
// gnu.org serves only the manual of the current release (5.3 since July 2025), in one page per node. Every page
// cited here has the same name in 5.2 and 5.3 (their bashref.texi, compared section by section); only the number of
// "Bash POSIX Mode" moved (6.11 in 5.2, 6.11.2 in 5.3). test/manual.test.ts checks this table against the 5.2
// bashref.texi when a bash git checkout is given in BASH_SOURCE_DIR.

/** The bash release whose manual the section numbers follow. */
export const MANUAL_VERSION = '5.2';
const BASE = 'https://www.gnu.org/software/bash/manual/html_node/';

/**
 * The sections of chapters 3 to 7, and the builtins of chapters 8 and 9: number, title, page (the node's file name,
 * as makeinfo writes it), and the anchor of a section that shares its node's page (the redirections).
 */
const TABLE: readonly (readonly [string, string, string, string?])[] = [
  ['3', 'Basic Shell Features', 'Basic-Shell-Features'],
  ['3.1', 'Shell Syntax', 'Shell-Syntax'],
  ['3.1.1', 'Shell Operation', 'Shell-Operation'],
  ['3.1.2', 'Quoting', 'Quoting'],
  ['3.1.2.1', 'Escape Character', 'Escape-Character'],
  ['3.1.2.2', 'Single Quotes', 'Single-Quotes'],
  ['3.1.2.3', 'Double Quotes', 'Double-Quotes'],
  ['3.1.2.4', 'ANSI-C Quoting', 'ANSI_002dC-Quoting'],
  ['3.1.2.5', 'Locale-Specific Translation', 'Locale-Translation'],
  ['3.1.3', 'Comments', 'Comments'],
  ['3.2', 'Shell Commands', 'Shell-Commands'],
  ['3.2.1', 'Reserved Words', 'Reserved-Words'],
  ['3.2.2', 'Simple Commands', 'Simple-Commands'],
  ['3.2.3', 'Pipelines', 'Pipelines'],
  ['3.2.4', 'Lists of Commands', 'Lists'],
  ['3.2.5', 'Compound Commands', 'Compound-Commands'],
  ['3.2.5.1', 'Looping Constructs', 'Looping-Constructs'],
  ['3.2.5.2', 'Conditional Constructs', 'Conditional-Constructs'],
  ['3.2.5.3', 'Grouping Commands', 'Command-Grouping'],
  ['3.2.6', 'Coprocesses', 'Coprocesses'],
  ['3.2.7', 'GNU Parallel', 'GNU-Parallel'],
  ['3.3', 'Shell Functions', 'Shell-Functions'],
  ['3.4', 'Shell Parameters', 'Shell-Parameters'],
  ['3.4.1', 'Positional Parameters', 'Positional-Parameters'],
  ['3.4.2', 'Special Parameters', 'Special-Parameters'],
  ['3.5', 'Shell Expansions', 'Shell-Expansions'],
  ['3.5.1', 'Brace Expansion', 'Brace-Expansion'],
  ['3.5.2', 'Tilde Expansion', 'Tilde-Expansion'],
  ['3.5.3', 'Shell Parameter Expansion', 'Shell-Parameter-Expansion'],
  ['3.5.4', 'Command Substitution', 'Command-Substitution'],
  ['3.5.5', 'Arithmetic Expansion', 'Arithmetic-Expansion'],
  ['3.5.6', 'Process Substitution', 'Process-Substitution'],
  ['3.5.7', 'Word Splitting', 'Word-Splitting'],
  ['3.5.8', 'Filename Expansion', 'Filename-Expansion'],
  ['3.5.8.1', 'Pattern Matching', 'Pattern-Matching'],
  ['3.5.9', 'Quote Removal', 'Quote-Removal'],
  ['3.6', 'Redirections', 'Redirections'],
  ['3.6.1', 'Redirecting Input', 'Redirections', 'Redirecting-Input'],
  ['3.6.2', 'Redirecting Output', 'Redirections', 'Redirecting-Output'],
  ['3.6.3', 'Appending Redirected Output', 'Redirections', 'Appending-Redirected-Output'],
  ['3.6.4', 'Redirecting Standard Output and Standard Error', 'Redirections', 'Redirecting-Standard-Output-and-Standard-Error'],
  ['3.6.5', 'Appending Standard Output and Standard Error', 'Redirections', 'Appending-Standard-Output-and-Standard-Error'],
  ['3.6.6', 'Here Documents', 'Redirections', 'Here-Documents'],
  ['3.6.7', 'Here Strings', 'Redirections', 'Here-Strings'],
  ['3.6.8', 'Duplicating File Descriptors', 'Redirections', 'Duplicating-File-Descriptors'],
  ['3.6.9', 'Moving File Descriptors', 'Redirections', 'Moving-File-Descriptors'],
  ['3.6.10', 'Opening File Descriptors for Reading and Writing', 'Redirections', 'Opening-File-Descriptors-for-Reading-and-Writing'],
  ['3.7', 'Executing Commands', 'Executing-Commands'],
  ['3.7.1', 'Simple Command Expansion', 'Simple-Command-Expansion'],
  ['3.7.2', 'Command Search and Execution', 'Command-Search-and-Execution'],
  ['3.7.3', 'Command Execution Environment', 'Command-Execution-Environment'],
  ['3.7.4', 'Environment', 'Environment'],
  ['3.7.5', 'Exit Status', 'Exit-Status'],
  ['3.7.6', 'Signals', 'Signals'],
  ['3.8', 'Shell Scripts', 'Shell-Scripts'],
  ['4', 'Shell Builtin Commands', 'Shell-Builtin-Commands'],
  ['4.1', 'Bourne Shell Builtins', 'Bourne-Shell-Builtins'],
  ['4.2', 'Bash Builtin Commands', 'Bash-Builtins'],
  ['4.3', 'Modifying Shell Behavior', 'Modifying-Shell-Behavior'],
  ['4.3.1', 'The Set Builtin', 'The-Set-Builtin'],
  ['4.3.2', 'The Shopt Builtin', 'The-Shopt-Builtin'],
  ['4.4', 'Special Builtins', 'Special-Builtins'],
  ['5', 'Shell Variables', 'Shell-Variables'],
  ['5.1', 'Bourne Shell Variables', 'Bourne-Shell-Variables'],
  ['5.2', 'Bash Variables', 'Bash-Variables'],
  ['6', 'Bash Features', 'Bash-Features'],
  ['6.1', 'Invoking Bash', 'Invoking-Bash'],
  ['6.2', 'Bash Startup Files', 'Bash-Startup-Files'],
  ['6.3', 'Interactive Shells', 'Interactive-Shells'],
  ['6.3.1', 'What is an Interactive Shell?', 'What-is-an-Interactive-Shell_003f'],
  ['6.3.2', 'Is this Shell Interactive?', 'Is-this-Shell-Interactive_003f'],
  ['6.3.3', 'Interactive Shell Behavior', 'Interactive-Shell-Behavior'],
  ['6.4', 'Bash Conditional Expressions', 'Bash-Conditional-Expressions'],
  ['6.5', 'Shell Arithmetic', 'Shell-Arithmetic'],
  ['6.6', 'Aliases', 'Aliases'],
  ['6.7', 'Arrays', 'Arrays'],
  ['6.8', 'The Directory Stack', 'The-Directory-Stack'],
  ['6.8.1', 'Directory Stack Builtins', 'Directory-Stack-Builtins'],
  ['6.9', 'Controlling the Prompt', 'Controlling-the-Prompt'],
  ['6.10', 'The Restricted Shell', 'The-Restricted-Shell'],
  ['6.11', 'Bash POSIX Mode', 'Bash-POSIX-Mode'],
  ['6.12', 'Shell Compatibility Mode', 'Shell-Compatibility-Mode'],
  ['7', 'Job Control', 'Job-Control'],
  ['7.1', 'Job Control Basics', 'Job-Control-Basics'],
  ['7.2', 'Job Control Builtins', 'Job-Control-Builtins'],
  ['7.3', 'Job Control Variables', 'Job-Control-Variables'],
  ['8.6', 'Programmable Completion', 'Programmable-Completion'],
  ['8.7', 'Programmable Completion Builtins', 'Programmable-Completion-Builtins'],
  ['9.2', 'Bash History Builtins', 'Bash-History-Builtins'],
  ['9.3', 'History Expansion', 'History-Interaction'],
];

export interface ManualSection { id: string; title: string; url: string }

/** The sections by number ('3.7.2'). */
export const SECTIONS: ReadonlyMap<string, ManualSection> = new Map(TABLE.map(([id, title, page, anchor]) =>
  [id, { id, title, url: `${BASE}${page}.html${anchor ? `#${anchor}` : ''}` }]));

/** The page of a section. */
export function manualUrl(id: string): string {
  return SECTIONS.get(id)!.url;
}

/** "Bash manual 3.7.2, 6.11": how a token or a note names its sections. */
export function manualLabel(lang: Lang, ids: readonly string[]): string {
  return `${lang === 'ja' ? 'Bash マニュアル' : 'Bash manual'} ${ids.join(', ')}`;
}

/** The section that describes each builtin (its `@btindex` in the manual). */
export const BUILTIN_SECTIONS: Readonly<Record<string, string>> = wordTable({
  ':': '4.1',
  '.': '4.1',
  break: '4.1',
  cd: '4.1',
  continue: '4.1',
  eval: '4.1',
  exec: '4.1',
  exit: '4.1',
  export: '4.1',
  getopts: '4.1',
  hash: '4.1',
  pwd: '4.1',
  readonly: '4.1',
  return: '4.1',
  shift: '4.1',
  test: '4.1',
  '[': '4.1',
  times: '4.1',
  trap: '4.1',
  umask: '4.1',
  unset: '4.1',
  alias: '4.2',
  bind: '4.2',
  builtin: '4.2',
  caller: '4.2',
  command: '4.2',
  declare: '4.2',
  echo: '4.2',
  enable: '4.2',
  help: '4.2',
  let: '4.2',
  local: '4.2',
  logout: '4.2',
  mapfile: '4.2',
  printf: '4.2',
  read: '4.2',
  readarray: '4.2',
  source: '4.2',
  type: '4.2',
  typeset: '4.2',
  ulimit: '4.2',
  unalias: '4.2',
  set: '4.3.1',
  shopt: '4.3.2',
  dirs: '6.8.1',
  popd: '6.8.1',
  pushd: '6.8.1',
  bg: '7.2',
  fg: '7.2',
  jobs: '7.2',
  kill: '7.2',
  wait: '7.2',
  disown: '7.2',
  suspend: '7.2',
  compgen: '8.7',
  complete: '8.7',
  compopt: '8.7',
  fc: '9.2',
  history: '9.2',
});

/** The sections that describe a program the manual is about: bash itself (6.1 Invoking Bash), and bash as `rbash` (6.10). */
export const PROGRAM_SECTIONS: Readonly<Record<string, readonly string[]>> = wordTable({
  bash: ['6.1'],
  rbash: ['6.1', '6.10'],
});

/**
 * Parameters that a section besides their own tells how to read: `$-` and `PS1`, which 6.3.2 ("Is this Shell
 * Interactive?") tests in a startup file (`case $- in *i*)`, `[ -z "$PS1" ]`): `$-` holds `i` in an interactive
 * shell, and `PS1` is unset in a shell that is not.
 */
export const PARAMETER_ALSO: Readonly<Record<string, string>> = wordTable({
  '-': '6.3.2',
  PS1: '6.3.2',
});


/**
 * The options of `set -o` and `shopt` whose effect a section of chapter 6 describes: the word that names one, as the
 * value of `set -o` or `bash -O` or an operand of `shopt`, cites it (`set -o posix`: 6.11). The others are described
 * where `set` and `shopt` list them (4.3.1, 4.3.2), which the builtin cites.
 */
export const OPTION_SECTIONS: Readonly<Record<string, string>> = wordTable({
  expand_aliases: '6.6', promptvars: '6.9', restricted_shell: '6.10', posix: '6.11',
  compat31: '6.12', compat32: '6.12', compat40: '6.12', compat41: '6.12', compat42: '6.12', compat43: '6.12', compat44: '6.12',
});

/**
 * The section of chapter 6 that describes what a variable of chapter 5 does, after the section of its item there:
 * the prompt strings (6.9), the directory stack (6.8), POSIX mode (6.11) and the compatibility level (6.12).
 */
export const VARIABLE_FEATURE_SECTIONS: Readonly<Record<string, string>> = wordTable({
  DIRSTACK: '6.8', PROMPT_COMMAND: '6.9', PS0: '6.9', PS1: '6.9', PS2: '6.9', PS4: '6.9', POSIXLY_CORRECT: '6.11', BASH_COMPAT: '6.12',
});

/**
 * The section that describes each variable of chapter 5 (an item of its variable table): 5.1 "Bourne Shell
 * Variables" and 5.2 "Bash Variables". test/reading-manual.test.ts checks the lists against the manual.
 */
export const VARIABLE_SECTIONS: Readonly<Record<string, string>> = wordTable(Object.fromEntries([
  ['5.1', 'CDPATH HOME IFS MAIL MAILPATH OPTARG OPTIND PATH PS1 PS2'],
  ['5.2', '_ BASH BASHOPTS BASHPID BASH_ALIASES BASH_ARGC BASH_ARGV BASH_ARGV0 BASH_CMDS BASH_COMMAND BASH_COMPAT BASH_ENV '
    + 'BASH_EXECUTION_STRING BASH_LINENO BASH_LOADABLES_PATH BASH_REMATCH BASH_SOURCE BASH_SUBSHELL BASH_VERSINFO BASH_VERSION '
    + 'BASH_XTRACEFD CHILD_MAX COLUMNS COMP_CWORD COMP_LINE COMP_POINT COMP_TYPE COMP_KEY COMP_WORDBREAKS COMP_WORDS COMPREPLY '
    + 'COPROC DIRSTACK EMACS ENV EPOCHREALTIME EPOCHSECONDS EUID EXECIGNORE FCEDIT FIGNORE FUNCNAME FUNCNEST GLOBIGNORE GROUPS '
    + 'histchars HISTCMD HISTCONTROL HISTFILE HISTFILESIZE HISTIGNORE HISTSIZE HISTTIMEFORMAT HOSTFILE HOSTNAME HOSTTYPE '
    + 'IGNOREEOF INPUTRC INSIDE_EMACS LANG LC_ALL LC_COLLATE LC_CTYPE LC_MESSAGES LC_NUMERIC LC_TIME LINENO LINES MACHTYPE '
    + 'MAILCHECK MAPFILE OLDPWD OPTERR OSTYPE PIPESTATUS POSIXLY_CORRECT PPID PROMPT_COMMAND PROMPT_DIRTRIM PS0 PS3 PS4 PWD '
    + 'RANDOM READLINE_ARGUMENT READLINE_LINE READLINE_MARK READLINE_POINT REPLY SECONDS SHELL SHELLOPTS SHLVL SRANDOM '
    + 'TIMEFORMAT TMOUT TMPDIR UID'],
].flatMap(([section, names]) => names.split(' ').map((name) => [name, section]))));
