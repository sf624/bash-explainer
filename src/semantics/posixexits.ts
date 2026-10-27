// What ends a shell that is not interactive in POSIX mode (manual 4.4, 6.11), as far as the words written decide it: a
// function definition bash refuses, and the errors of a special builtin that bash makes fatal there. Each was checked
// with bash 5.2.21 and 5.3 in scripts of several lines (test/fixtures/probes/status.json, test/posix-exits.test.ts);
// what other errors do is left out (a file `.` does not find, a redirection that fails: the words do not decide them).
//
// - A definition: a function named like a special builtin ("is a special builtin"), and in bash 5.2 a name that is
//   not a valid name ("not a valid identifier"; bash 5.3 accepts it). bash exits wherever it runs, status 2.
// - A special builtin's usage error (bash's EX_USAGE): an option it does not have (also one of a later release), an
//   option without its value, a name `set -o` does not have, `.` with no file, and in POSIX mode a lone `trap WORD`
//   that is no signal number; status 2, in both releases.
// - An assignment to a readonly variable, alone or before a special builtin (status 1), anywhere.
// - From bash 5.3 (`POSIX_EXITS_SINCE`): a name `export`, `readonly` or `unset -v` refuses, `unset` of a readonly
//   variable (status 1), and `shift` of a word that is no number (status 2). bash 5.2 goes on there, with status 1.
// A builtin's error ends the shell only where `set -e` would stop it: not in a condition, on the left of `&&` or `||`,
// after `!`, nor in a function called there; behind `command` or `builtin` it is no special builtin.
import { builtinParse } from './effects';
import { earlier, POSIX_EXITS_SINCE, POSIX_FUNCTION_NAMES_SINCE, type BashVersion } from '../bashversion';
import type { Shell } from '../dialect';
import { builtins, shellOptions } from '../dict/builtins';
import { givenOptions } from '../argv/query';
import { staticWordValue } from '../staticword';
import { field, prefixAssignments, type SyntaxNode } from '../syntax/tree';
import { attribute, type ShellState } from './shellstate';

export type PosixExitWhy = 'special-function-name' | 'function-name' | 'invalid-option' | 'option-value' | 'option-name' | 'no-file'
  | 'trap-word' | 'identifier' | 'readonly' | 'numeric' | 'readonly-assignment';

export interface PosixExit {
  readonly why: PosixExitWhy;
  /** The word bash refuses: the function's name, or an argument (the command's name for `no-file`). */
  readonly at: SyntaxNode;
  /** Its text as bash reads it. */
  readonly word: string;
  /** The status the shell exits with. */
  readonly status: number;
  /** A builtin's error, which ends the shell only where `set -e` would stop it (false: a definition, anywhere). */
  readonly ignorable: boolean;
  /** The first release that exits there (bash 5.2 goes on with status 1), when not every release does. */
  readonly since?: BashVersion;
}

/** The special builtins that read their options as getopt does: an option they do not have is a usage error. */
const GETOPT = new Set(['.', 'source', 'eval', 'exec', 'export', 'readonly', 'set', 'times', 'trap', 'unset']);

const NAME = /^[A-Za-z_]\w*$/;

/** Whether `text` is a name bash takes for a variable or, in POSIX mode, a function: letters, digits and `_`. */
export const validName = (text: string): boolean => NAME.test(text);

/** A status `exit` and `shift` take: a decimal number, with a sign and blanks around it (bash's `legal_number`). */
const NUMBER = /^\s*[-+]?\d+\s*$/;

/**
 * What `exit` does with the words `args` that give it no status, in bash `version` (checked with bash 5.2.21 and 5.3,
 * in and out of POSIX mode, in scripts): a first word that is no number (`exit x`), "numeric argument required", status
 * 2: bash 5.2 exits anywhere (`exits`); bash 5.3 goes on, but in POSIX mode it is an error of a special builtin
 * (`builtinExit`); more than one word (`exit 1 2`), "too many arguments": the shell goes on, status 1 in bash 5.2, 2 in
 * bash 5.3. `unknown` where a word not known decides it; undefined where `exit` exits as usual.
 */
export function exitRefusal(args: readonly SyntaxNode[], version: BashVersion): { why: 'numeric' | 'too-many'; at: SyntaxNode; word: string; status: number; exits: boolean } | 'unknown' | undefined {
  const words = args.length && staticWordValue(args[0]) === '--' ? args.slice(1) : args;
  if (!words.length) return undefined;
  const first = staticWordValue(words[0]);
  if (first !== undefined && !NUMBER.test(first)) return { why: 'numeric', at: words[0], word: first, status: 2, exits: version === '5.2' };
  if (words.length < 2) return undefined;
  return first === undefined ? 'unknown' : { why: 'too-many', at: words[1], word: staticWordValue(words[1]) ?? words[1].text, status: version === '5.2' ? 1 : 2, exits: false };
}

/** What bash `version` does in POSIX mode with the function definition `def`: exits, or nothing (undefined). */
export function definitionExit(def: SyntaxNode, version: BashVersion): PosixExit | undefined {
  const at = field(def, 'name')!;
  const why = builtins[at.text]?.builtin === 'special' ? 'special-function-name'
    : earlier(version, POSIX_FUNCTION_NAMES_SINCE) && !validName(at.text) ? 'function-name' : undefined;
  return why && { why, at, word: at.text, status: 2, ignorable: false };
}

/**
 * An assignment of command `n` (one of assignments alone, or before a special builtin) to a variable that is surely
 * readonly in `st`: bash exits in POSIX mode wherever it is (status 1).
 */
export function assignmentExit(n: SyntaxNode, st: ShellState): PosixExit | undefined {
  const at = prefixAssignments(n).find((a) => attribute(st, field(a, 'name')!.text, 'r') === 'on');
  return at && { why: 'readonly-assignment', at, word: field(at, 'name')!.text, status: 1, ignorable: false };
}

/**
 * The error of the special builtin `name` (called as written, at `n`) with the words `args`, from `st`, that ends the
 * shell in POSIX mode in bash `version`; undefined when the words decide none.
 */
export function builtinExit(n: SyntaxNode, name: string, args: readonly SyntaxNode[], st: ShellState, version: BashVersion, shell: Shell | undefined): PosixExit | undefined {
  if (builtins[name]?.builtin !== 'special') return undefined;
  const assigned = assignmentExit(n, st);
  if (assigned) return assigned;
  const parse = builtinParse(name, args, shell);
  const make = (why: PosixExitWhy, at: SyntaxNode, word: string, status = 2): PosixExit | undefined => {
    const since = POSIX_EXITS_SINCE[why];
    if (since && earlier(version, since)) return undefined;
    return { why, at, word, status, ignorable: true, ...(since ? { since } : {}) };
  };
  const options = givenOptions(parse);
  const flags = new Set(options.map((o) => o.role.flag.replace(/^\+/, '-')));
  const operands = parse.roles.filter((r) => r.role.role === 'operand').map((r) => args[r.word]);
  // (`set -oposix`: letters after `o` in its word, which bash reads erratically: it goes on there, or exits with status
  // 1, after listing the options. Nothing is said.)
  if (name === 'set' && args.some((a) => /^[-+][^-+]*o./.test(staticWordValue(a) ?? ''))) return undefined;
  if (GETOPT.has(name)) {
    for (const { word, role } of options) {
      const since = role.role === 'option' ? role.spec.since : undefined;
      if (role.role === 'unknown-option' || (since && earlier(version, since))) return make('invalid-option', args[word], role.flag);
      // (`set -o` alone lists the options: no error, `noValue`.)
      if (role.missing && !role.spec.noValue) return make('option-value', args[word], role.flag);
    }
    // (`set -o NAME`, `set +o NAME`: the names of `shellOptions`.)
    for (const { word, role } of parse.roles) {
      const value = role.role === 'value' && role.spec?.values === shellOptions ? staticWordValue(args[word]) : undefined;
      if (value !== undefined && !Object.hasOwn(shellOptions, value)) return make('option-name', args[word], value);
    }
    if ((name === '.' || name === 'source') && !operands.length) return make('no-file', field(n, 'name')!, name);
    // (In POSIX mode, `trap WORD` alone resets nothing: a usage error unless WORD is a number.)
    const lone = name === 'trap' && operands.length === 1 && parse.roles.filter((r) => r.role.role !== 'end-of-options').length === 1 ? staticWordValue(operands[0]) : undefined;
    if (lone !== undefined && !/^\d+$/.test(lone)) return make('trap-word', operands[0], lone);
  }
  if (name === 'export' || name === 'readonly' || name === 'unset') {
    // (`export -f`, `readonly -f` and `unset -f` or `-n` work on other names; `unset` alone tries a function when the
    // name is no variable's.)
    if (flags.has('-f') || (name === 'unset' && flags.has('-n'))) return undefined;
    for (const a of operands) {
      const text = staticWordValue(a);
      const nm = text === undefined ? undefined : /^[^=]*?(?=\+?=|$)/.exec(text)![0];
      if (nm === undefined || nm.includes('[')) continue;
      if (!validName(nm)) {
        if (name !== 'unset' || flags.has('-v')) return make('identifier', a, text!, 1);
      } else if (name === 'unset' && attribute(st, nm, 'r') === 'on') return make('readonly', a, nm, 1);
    }
  }
  if (name === 'shift' && operands.length === 1) {
    const count = staticWordValue(operands[0]);
    if (count !== undefined && !NUMBER.test(count)) return make('numeric', operands[0], count);
  }
  // (`exit x` in bash 5.3: in POSIX mode an error of a special builtin; bash 5.2 exits anywhere, `exitRefusal`.)
  const refused = name === 'exit' ? exitRefusal(args, version) : undefined;
  if (typeof refused === 'object' && refused.why === 'numeric') return make('numeric', refused.at, refused.word);
  return undefined;
}
