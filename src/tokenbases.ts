// What the text of a token rests on, where it states bash's behaviour that the Bash manual does not state, or states
// otherwise (docs/design/basis.md, step 4). As a fact of the message catalog names its basis (src/messages.ts,
// `withBasis`), a text of a token does: by the id of what it says, in this table, with the probe row that checks it
// and gives a try-it (src/basis-probes.json). Where the text is chosen, it carries that id: a text of a dictionary
// with `based` (the token's own data: `wellKnownVariables.COLUMNS`), a text of an explanation with `Explainer.rests`.
// The analyzer then gives each token whose text holds such a text its basis and try-it (`withTokenBases`), with
// `notes.basis` on. Each entry says what the manual's sections say and do not say (the bash 5.2 manual of the
// bash-doc package); test/basis.test.ts pins the kind of each, with a line that shows it.
import type { Token } from './analyzer-types';
import { basisOf, type BasisSpec } from './basis';
import type { Text } from './i18n';

export const TOKEN_BASES = {
  // 5.2 `_`: "expands to the last argument to the previous simple command executed in the foreground, after
  // expansion". A command of assignments only has no argument: that `$_` is then empty, the manual does not say.
  'underscore-after-assignment': { kind: 'checked', probe: 'words#underscore-after-assignment' },
  // 5.2 `COLUMNS`: "Automatically set if the checkwinsize option is enabled (see The Shopt Builtin), or in an
  // interactive shell upon receipt of a SIGWINCH"; 4.3.2 `checkwinsize`: "Bash checks the window size after each
  // external (non-builtin) command and, if necessary, updates the values of LINES and COLUMNS". That bash does not
  // set them when it starts (only the environment gives them until then), the manual does not say. (At a terminal, a
  // program that ends sets them: checked with a terminal, not in CI.)
  'columns-from-environment': { kind: 'checked', probe: 'state#columns-at-start' },
  // 5.2 `BASH_REMATCH`, 3.2.5.2: the members are "assigned by the ‘=~’ binary operator"; nothing of a match that fails.
  'rematch-empty-after-failure': { kind: 'checked', probe: 'state#rematch-failed' },
  // 5.2 `BASH_XTRACEFD`: "The file descriptor is closed when BASH_XTRACEFD is unset or assigned a new value." bash
  // leaves the descriptor it named before open when it is given a new value.
  'xtracefd-old-stays-open': { kind: 'differs', probe: 'state#xtracefd-old-open' },
  // 5.2 `FUNCNEST`: "Function invocations that exceed this nesting level will cause the current command to abort." The
  // status, 1, is not said.
  'funcnest-status': { kind: 'checked', probe: 'state#funcnest-abandons' },
  // 5.1 `PATH`, 3.7.2 and 4.1 `hash` say what the table of remembered commands is, not that an assignment to `PATH`
  // empties it.
  'path-forgets-hash': { kind: 'checked', probe: 'state#path-hash' },
  // 5.2 `PWD`: "The current working directory as set by the cd builtin." Not what an assignment to it does.
  'pwd-variable-only': { kind: 'checked', probe: 'state#pwd-assign' },
  // 5.2 `POSIXLY_CORRECT`: "If it is set while the shell is running, Bash enables POSIX mode, as if the command
  // set -o posix had been executed." That unsetting it turns POSIX mode off, the manual does not say.
  'posixly-correct-unset': { kind: 'checked', probe: 'state#posixly-correct-unset' },
  // 4.2 `local`, 5.2: a local variable, and what bash does with each of its variables; not that a local of one of
  // them (`local RANDOM`) is a plain variable.
  'local-special-plain': { kind: 'checked', probe: 'state#local-random' },
  // 5.2 says it of `BASHPID`, `EPOCHREALTIME`, `EPOCHSECONDS`, `FUNCNAME`, `GROUPS`, `HISTCMD` and `SRANDOM`
  // ("Assignments to BASHPID have no effect", "… are ignored"), not of `LINENO` and `BASH_COMMAND`: the keys
  // `ignored.<name>` (`ignoredAssignment`).
  'ignored.LINENO': { kind: 'checked', probe: 'state#ignored-lineno' },
  'ignored.BASH_COMMAND': { kind: 'checked', probe: 'state#ignored-lineno' },
  // 4.1 `readonly`: "The values of these names may not be changed by subsequent assignment"; 3.7.1: "If any of the
  // assignments attempts to assign a value to a readonly variable, an error occurs, and the command exits with a
  // non-zero status." What bash abandons, and the status 1, it does not say (as the fact `assign-readonly`); before a
  // command name, bash runs the command, status 0.
  'readonly-abandons': { kind: 'checked', probe: 'state#readonly-abandons' },
  'readonly-subshell': { kind: 'checked', probe: 'state#readonly-abandons' },
  'readonly-prefix-runs': { kind: 'differs', probe: 'state#readonly-prefix' },
  // 6.1 lists bash's options; not what bash does with one it does not have, or with a long option after a short one,
  // beyond "multi-character options must appear on the command line before the single-character options to be
  // recognized". The statuses (2; 1 after `-e`) are not said.
  'bash-refuses-option': { kind: 'checked', probe: 'state#bash-invalid-option' },
  // 6.1: nothing of a lone `+`.
  'bash-lone-plus': { kind: 'checked', probe: 'state#bash-lone-plus' },
  // 6.6: "The characters ‘/’, ‘$’, ‘`’, ‘=’ and any of the shell metacharacters or quoting characters listed above may
  // not appear in an alias name"; 4.1 `alias`: "alias returns true unless a name is given for which no alias has been
  // defined". The status 1 of a refused name, and that a word `=x` is looked for as a name, are not said.
  'alias-invalid-name': { kind: 'checked', probe: 'state#alias-refused' },
  'alias-no-name': { kind: 'checked', probe: 'state#alias-refused' },
  // 6.6: "If the last character of the alias value is a blank, then the next command word following the alias is also
  // checked for alias expansion." Of an alias whose text is an alias ending with a blank, nothing: bash 5.2 does not
  // check the next word, bash 5.3 does.
  'alias-in-alias-blank': { kind: 'checked', probe: 'state#alias-in-alias', also: ['state#alias-in-alias-53'] },
  // 6.7: "The ‘@’ and ‘*’ subscripts …" expand to all the members; that an assignment to `a[@]` is refused, with
  // status 1, it does not say.
  'array-at-subscript': { kind: 'checked', probe: 'state#array-at-assign' },
  // 6.7: "The syntax declare -a name[subscript] is also accepted; the subscript is ignored." Not what `export`,
  // `readonly` and `declare -p` do with such a word (4.1, 4.2: "non-zero" at most).
  'export-subscript-refused': { kind: 'checked', probe: 'state#subscript-words' },
  'declare-p-subscript': { kind: 'checked', probe: 'state#subscript-words' },
  // 6.7 says how the list of an associative array is read (keys and values in turn, or `[key]=value`), not what bash
  // does with a value with no `[key]=` after one with it.
  'assoc-missing-subscript': { kind: 'checked', probe: 'state#assoc-missing-subscript', also: ['state#assoc-missing-subscript-53'] },
  // 6.7, 3.5.1: nothing of a brace expansion in a value `[4]={a,b}` (bash 5.2 makes plain values of it, 5.3 does not).
  'array-brace-value': { kind: 'checked', probe: 'state#array-brace-value', also: ['state#array-brace-value-53'] },
  // 6.7, 3.5.2: nothing of a `~` in the list of an associative array (bash 5.2 keeps it, 5.3 expands it).
  'assoc-tilde': { kind: 'checked', probe: 'state#assoc-tilde', also: ['state#assoc-tilde-53'] },
  // 6.11: "The kill builtin does not accept signal names with a ‘SIG’ prefix." The status, 1, is not said.
  'kill-posix-sig': { kind: 'checked', probe: 'state#kill-posix-sig' },
  // 6.11: "While variable indirection is available, it may not be applied to the ‘#’ and ‘?’ special parameters." What
  // `${!#}` then expands to (nothing), it does not say.
  'posix-indirect-hash': { kind: 'checked', probe: 'state#posix-indirect-hash' },
  // 6.11: "The trap builtin doesn’t check the first argument for a possible signal specification and revert the signal
  // handling to the original disposition if it is, unless that argument consists solely of digits". That `trap INT` is
  // then a usage error (status 2) that ends the shell, it does not say.
  'trap-posix-signal': { kind: 'checked', probe: 'state#trap-posix' },
  // 3.2.3 says what `time` prints for a pipeline; 6.11: "The time reserved word may be used by itself as a command."
  // What `time` alone prints (zero times; in POSIX mode, the shell's), it does not say.
  'time-alone': { kind: 'checked', probe: 'state#time-alone' },
  // 6.5, 3.5.5: "If the expression is invalid, Bash prints a message indicating failure and no substitution occurs."
  // That bash abandons the rest of the command, status 1, it does not say.
  'arith-syntax-abandons': { kind: 'checked', probe: 'state#arith-syntax-error' },
} as const satisfies Record<string, BasisSpec>;

/** What a text of a token rests on: an entry of `TOKEN_BASES`. */
export type TokenBasisId = keyof typeof TOKEN_BASES;

/** A text that states bash's behaviour, with the entry that says what it rests on. */
export type BasedText = Text & { readonly basis: TokenBasisId };

/** `text`, which states what the entry `id` says: a token that shows it gets that basis. */
export const based = (text: Text, id: TokenBasisId): BasedText => ({ ...text, basis: id });

/** A part of a command spec (an operand, an option) whose text states what the entry `id` says. */
export const basedSpec = <T extends { text: Text }>(spec: T, id: TokenBasisId): T => ({ ...spec, text: based(spec.text, id) });

/** Whether `text` carries a basis (`based`). */
export const isBased = (text: Text): text is BasedText => 'basis' in text;

/** The entry `<table>.<name>` if there is one (`ignored.LINENO`): a text chosen by a variable's name, keyed so. */
export function tokenBasisOf(table: string, name: string): TokenBasisId | undefined {
  const id = `${table}.${name}`;
  return Object.hasOwn(TOKEN_BASES, id) ? (id as TokenBasisId) : undefined;
}

/** A text said on a line, and the entry of what it rests on (`Explainer.rests`, `Explainer.t`). */
export interface RestingText { text: string; id: TokenBasisId }

/**
 * The tokens of a line (and those under them) with the basis and the try-it of a text they show: the first of
 * `rested` (said on the line, in order) that the token's explanation holds. A basis of the manual gives only a try-it,
 * as a fact's does (`basisOf`).
 */
export function withTokenBases(tokens: Token[], rested: readonly RestingText[]): void {
  if (!rested.length) return;
  const walk = (t: Token) => {
    const found = rested.find((r) => t.explanation.includes(r.text));
    // (Every entry names a probe row with a try-it; its basis is `checked` or `differs`.)
    if (found) Object.assign(t, basisOf(TOKEN_BASES[found.id]));
    t.children.forEach(walk);
  };
  tokens.forEach(walk);
}
