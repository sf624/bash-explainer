// What the walk of the shell state (src/semantics/walk/) and the trust of its decisions (src/semantics/trust.ts)
// both read: declaration commands read with their builtin's spec, the catalog of the variables bash sets, and the names
// an arithmetic text assigns.
import { interpret, type ArgRole, type ArgvParse } from '../argv/interpret';
import { argWord } from '../argv/words';
import { builtins } from '../dict/builtins';
import type { SyntaxNode } from '../syntax/tree';

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
  /** What sets it without the script naming it: a builtin (`read` sets REPLY), a construct (`[[ =~ ]]`), the shell itself. */
  setBy?: readonly string[];
}

const CD = ['cd', 'pushd', 'popd'];
const COMPLETION = ['programmable completion'];
const BIND = ['bind -x'];

/**
 * The variables bash knows, each with what bash does with it: every variable of the manual's two lists (bash 5.2),
 * and `TERM` and `COPROC_PID`, which bash also sets (`TERM` at start; `COPROC` stands for the name of a coprocess).
 */
export const BASH_VARIABLES: Readonly<Record<string, BashVariable>> = {
  // 5.1 Bourne Shell Variables.
  CDPATH: {}, HOME: {}, IFS: { start: '--' }, MAIL: {}, MAILPATH: {},
  OPTARG: { setBy: ['getopts'] }, OPTIND: { start: '-i', numeric: true, arithmetic: true, setBy: ['getopts'] },
  PATH: { start: '--' }, PS1: {}, PS2: {},
  // 5.2 Bash Variables.
  _: { start: '--', dynamic: true },
  BASH: { start: '--' },
  BASHOPTS: { start: '-r', dynamic: true },
  BASHPID: { start: '-i', dynamic: true, numeric: true },
  BASH_ALIASES: { start: '-A', setBy: ['alias', 'unalias'] },
  BASH_ARGC: { start: '-a', dynamic: true, numeric: true },
  BASH_ARGV: { start: '-a', dynamic: true },
  BASH_ARGV0: { start: '--' },
  BASH_CMDS: { start: '-A', dynamic: true },
  BASH_COMMAND: { start: '--', dynamic: true },
  BASH_COMPAT: {}, BASH_ENV: {}, BASH_EXECUTION_STRING: {},
  BASH_LINENO: { start: '-a', dynamic: true, numeric: true },
  BASH_LOADABLES_PATH: { start: '--' },
  BASH_REMATCH: { setBy: ['[[ =~ ]]'] },
  BASH_SOURCE: { start: '-a', dynamic: true },
  BASH_SUBSHELL: { start: '--', dynamic: true, numeric: true },
  BASH_VERSINFO: { start: '-ar' },
  BASH_VERSION: { start: '--' },
  BASH_XTRACEFD: {}, CHILD_MAX: {},
  COLUMNS: { setBy: ['checkwinsize'] },
  COMP_CWORD: { setBy: COMPLETION }, COMP_LINE: { setBy: COMPLETION }, COMP_POINT: { setBy: COMPLETION },
  COMP_TYPE: { setBy: COMPLETION }, COMP_KEY: { setBy: COMPLETION },
  COMP_WORDBREAKS: { start: '--' },
  COMP_WORDS: { setBy: COMPLETION }, COMPREPLY: {},
  COPROC: { setBy: ['coproc'] }, COPROC_PID: { setBy: ['coproc'] },
  DIRSTACK: { start: '-a', dynamic: true },
  EMACS: {}, ENV: {},
  EPOCHREALTIME: { start: '--', dynamic: true },
  EPOCHSECONDS: { start: '--', dynamic: true, numeric: true },
  EUID: { start: '-ir', numeric: true },
  EXECIGNORE: {}, FCEDIT: {}, FIGNORE: {},
  FUNCNAME: { dynamic: true },
  FUNCNEST: {}, GLOBIGNORE: {},
  GROUPS: { start: '-a', dynamic: true, numeric: true },
  HISTCMD: { start: '-i', dynamic: true, numeric: true, arithmetic: true },
  HISTCONTROL: {}, HISTFILE: {}, HISTFILESIZE: {}, HISTIGNORE: {}, HISTSIZE: {}, HISTTIMEFORMAT: {}, HOSTFILE: {},
  HOSTNAME: { start: '--' }, HOSTTYPE: { start: '--' },
  IGNOREEOF: {}, INPUTRC: {}, INSIDE_EMACS: {},
  LANG: {}, LC_ALL: {}, LC_COLLATE: {}, LC_CTYPE: {}, LC_MESSAGES: {}, LC_NUMERIC: {}, LC_TIME: {},
  LINENO: { start: '--', dynamic: true, numeric: true },
  LINES: { setBy: ['checkwinsize'] },
  MACHTYPE: { start: '--' },
  MAILCHECK: {},
  MAPFILE: { setBy: ['mapfile', 'readarray'] },
  OLDPWD: { setBy: CD },
  OPTERR: { start: '--' },
  OSTYPE: { start: '--' },
  PIPESTATUS: { dynamic: true, numeric: true },
  POSIXLY_CORRECT: {},
  PPID: { start: '-ir', numeric: true },
  PROMPT_COMMAND: {}, PROMPT_DIRTRIM: {}, PS0: {}, PS3: {},
  PS4: { start: '--' },
  PWD: { start: '-x', setBy: CD },
  RANDOM: { start: '-i', dynamic: true, numeric: true, arithmetic: true },
  READLINE_ARGUMENT: { setBy: BIND }, READLINE_LINE: { setBy: BIND }, READLINE_MARK: { setBy: BIND }, READLINE_POINT: { setBy: BIND },
  REPLY: { setBy: ['read', 'select'] },
  SECONDS: { start: '-i', dynamic: true, numeric: true },
  SHELL: { start: '--' },
  SHELLOPTS: { start: '-r', dynamic: true },
  SHLVL: { start: '-x' },
  SRANDOM: { start: '-i', dynamic: true, numeric: true, arithmetic: true },
  TERM: { start: '--' },
  TIMEFORMAT: {}, TMOUT: {}, TMPDIR: {}, histchars: {},
  UID: { start: '-ir', numeric: true },
};

const known = (name: string): BashVariable | undefined => (Object.hasOwn(BASH_VARIABLES, name) ? BASH_VARIABLES[name] : undefined);

/** Whether bash sets `name` when it starts a script, whatever the environment. */
export const setAtStart = (name: string): boolean => known(name)?.start !== undefined;

/** Whether the text assigned to `name` is read as arithmetic (`OPTIND`, `RANDOM`: integers from the start). */
export const assignsArithmetic = (name: string): boolean => !!known(name)?.arithmetic;

/** Whether `name` is readonly from the start (`UID`): what the script assigns to it fails. */
export const readonlyAtStart = (name: string): boolean => known(name)?.start?.includes('r') ?? false;

/**
 * Whether the value of `name` is never known here: bash changes it as the script runs (`RANDOM`, `LINENO`), or keeps
 * its own (a readonly variable such as `UID`).
 */
export const changedByBash = (name: string): boolean => !!known(name)?.dynamic || readonlyAtStart(name);

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

const declarations = new WeakMap<SyntaxNode, Declaration>();
/** A declaration command (`declare -ix -- a=1 b`) read with its builtin's spec. */
export function readDeclaration(d: SyntaxNode): Declaration {
  const seen = declarations.get(d);
  if (seen) return seen;
  const out = readDeclarationWords(d.children[0].type, d.namedChildren.filter((c) => !c.type.endsWith('redirect')));
  declarations.set(d, out);
  return out;
}
