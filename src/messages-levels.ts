import type { NoteLevel } from './levels';

// The levels of the notes that are no fact of the catalog (src/messages.ts has each fact's): the style checks' and the
// other problems'. With the catalog, the one source of a note's level; what a level looks like is the level table's
// (src/levels.ts).

/**
 * The level of the problems that are no fact of the catalog: a dialect issue on a construct the target shell lacks
 * (`unsupported`) or that works differently there (`behaviour`, "Portability"), src/dialect.ts; a script with CRLF line
 * ends (`crlf`, src/document.ts), an error when a CR ends the `#!` line or a keyword stands just before a CR (run as
 * a program, the interpreter is not found; `fi` is read as `fi\r`, every time), a warning otherwise (`crlfMaybe`:
 * `bash file` runs `echo hi`, with a CR at the end of its output); zsh syntax a line of a zsh script cannot be read with
 * (`parse`, src/dialect.ts), a plain note, though a problem: the line is not explained.
 */
export const PROBLEM_LEVELS = { unsupported: 'error', behaviour: 'info', parse: 'note', crlf: 'error', crlfMaybe: 'warning' } as const satisfies Record<string, NoteLevel>;

/** The codes of the style checks of src/pitfalls.ts, as diagnostics show them (`# bash-explainer disable=<code>`). */
export type StyleCode = 'bracket-no-space' | 'assignment-with-spaces' | 'brace-no-space' | 'brace-close-no-separator'
  | 'rm-empty-variable-root' | 'read-without-r' | 'redirect-in-bracket' | 'bracket-close-in-word' | 'and-or-in-bracket'
  | 'download-run-by-shell' | 'trap-goes-on' | 'source-searches-path' | 'pattern-from-variable';

/** What a style check found that its level depends on (`STYLE_LEVELS`): `maybeEmpty`, the part before a `]` may be empty. */
export interface StyleCase { maybeEmpty?: boolean }

/**
 * The level of each style check (src/pitfalls.ts), by the rule of docs/design/three-levels.md (section 2): `error`
 * when the line fails every time as written (`[-f x]`, `x = 1`, `{echo`, `{ echo }`, `[ a > b ]`, `[ a && b ]`,
 * `[ -d "$d/"]`, whose word before `]` is never empty); `warning` when it can do damage that cannot be undone
 * (`rm -rf $DIR/`, a download run by a shell, a file of `$PATH` read by `source`); `info` when it goes wrong only with
 * some input (`read` without `-r` and a backslash). Each at `error` has a row in test/error-level.test.ts that runs it
 * in bash. As in the catalog, a level that depends on the case is a function of it: `"$x"]` when `$x` may be empty is
 * `]` alone then, which closes `[` and makes another test (`[ -n "$x"]` is `[ -n ]`, true), and fails only with a
 * value (`missing ']'`); not every time, but a test that is wrongly true can guard what cannot be undone
 * (`[ -n "$d"] && rm -rf "$d"/*`): a `warning` (three-levels.md, section 2, question 2).
 */
export const STYLE_LEVELS: Record<StyleCode, NoteLevel | ((c: StyleCase) => NoteLevel)> = {
  'bracket-no-space': 'error', 'assignment-with-spaces': 'error', 'brace-no-space': 'error', 'brace-close-no-separator': 'error',
  'rm-empty-variable-root': 'warning', 'read-without-r': 'info', 'redirect-in-bracket': 'error',
  'bracket-close-in-word': ({ maybeEmpty }) => (maybeEmpty ? 'warning' : 'error'),
  'and-or-in-bracket': 'error', 'download-run-by-shell': 'warning', 'trap-goes-on': 'info', 'source-searches-path': 'warning',
  'pattern-from-variable': 'info',
};
