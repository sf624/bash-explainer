import type { NoteLevel } from './levels';

// The levels of the notes that are no fact of the catalog (src/messages.ts has each fact's): the style checks' and the
// other problems'. With the catalog, the one source of a note's level; what a level looks like is the level table's
// (src/levels.ts).

/**
 * The level of the problems that are no fact of the catalog: a dialect issue on a construct the target shell lacks
 * (`unsupported`) or that works differently there (`behaviour`, "Portability"), src/dialect.ts; a script with CRLF line
 * ends (`crlf`, src/document.ts), an error when the file has a shebang or a keyword just before a CR (run directly, the
 * interpreter is not found; `fi` is read as `fi\r`, every time), a warning otherwise (`crlfMaybe`: `bash file` runs
 * `echo hi`, with a CR at the end of its output).
 */
export const PROBLEM_LEVELS = { unsupported: 'error', behaviour: 'info', crlf: 'error', crlfMaybe: 'warning' } as const satisfies Record<string, NoteLevel>;

/** The codes of the style checks of src/pitfalls.ts, as diagnostics show them (`# bash-explainer disable=<code>`). */
export type StyleCode = 'bracket-no-space' | 'assignment-with-spaces' | 'brace-no-space' | 'brace-close-no-separator'
  | 'rm-empty-variable-root' | 'read-without-r' | 'redirect-in-bracket' | 'bracket-close-in-word' | 'and-or-in-bracket'
  | 'download-run-by-shell' | 'trap-goes-on' | 'source-searches-path' | 'pattern-from-variable';

/**
 * The level of each style check (src/pitfalls.ts): `warning` when the line breaks as written, `info` when
 * it breaks only with some input (`read` without `-r` and a backslash).
 */
export const STYLE_LEVELS: Record<StyleCode, NoteLevel> = {
  'bracket-no-space': 'warning', 'assignment-with-spaces': 'warning', 'brace-no-space': 'warning', 'brace-close-no-separator': 'warning',
  'rm-empty-variable-root': 'warning', 'read-without-r': 'info', 'redirect-in-bracket': 'warning', 'bracket-close-in-word': 'warning',
  'and-or-in-bracket': 'warning', 'download-run-by-shell': 'warning', 'trap-goes-on': 'info', 'source-searches-path': 'info',
  'pattern-from-variable': 'info',
};
