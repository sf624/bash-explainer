import type { NoteLevel } from './levels';

// The levels of the notes that are no fact of the catalog (src/messages.ts has each fact's): the style checks' and the
// other problems'. With the catalog, the one source of a note's level; what a level looks like is the level table's
// (src/levels.ts).

/** A text a token says (the catalog of token texts, src/messages-tokens.ts): in Japanese and English, and, for a warning inside a row's sentence, its level. */
export interface TokenEntry<P> {
  text: (p: P) => readonly [ja: string, en: string];
  level?: NoteLevel;
}

/** A token's text. */
export function tokenText<P = Record<string, never>>(text: (p: P) => readonly [string, string]): TokenEntry<P> {
  return { text };
}

/** A text that warns: a row draws the level's mark before it, and has its level. */
export function tokenWarning<P = Record<string, never>>(text: (p: P) => readonly [string, string]): TokenEntry<P> {
  return { text, level: 'warning' };
}

/**
 * The characters that carry a text's id while a line is explained (src/messages-tokens.ts, `carried`): a noncharacter and a character of the
 * private use area that open a text, and a noncharacter that closes it.
 */
export const OPEN_TEXT = '\uFDD0';
export const CLOSE_TEXT = '\uFDD1';
export const CARRIED = /\uFDD0([\uE000-\uF8FF])|\uFDD1/g;

/**
 * A script's text with its own OPEN_TEXT and CLOSE_TEXT masked by U+FFFD (the same length, so every position holds): the
 * tree's text and every token's label and explanation are made from it, and a raw one would forge a mark there (`echo
 * $((0<U+FDD1>9))` read "Word `09`"). bash reads either as a word character. Only the script's raw text is masked: a
 * mark that a decoded `$'\uFDD0'` or the output of `printf` or `jq` would make is not in the text, and can still show. The
 * parser (src/syntax/adapters/unbash.ts) and the readers of a document's text (the host files, `openDocument`) mask the
 * text as they take it.
 */
export const maskCarried = (text: string): string => text.replace(/[\uFDD0\uFDD1]/g, '\uFFFD');

/** A text without the ids it carries: for code that looks at its first or last character. */
export const plainOf = (text: string): string => text.replace(CARRIED, '');

/** `text` with `more` inside the closing bracket it ends with (`close`), or undefined if it does not end with one. */
export function insideLastBracket(text: string, close: string, more: string): string | undefined {
  const closes = /\uFDD1*$/.exec(text)!;
  if (!text.slice(0, closes.index).endsWith(close)) return undefined;
  return `${text.slice(0, closes.index - close.length)}${more}${close}${closes[0]}`;
}

/**
 * The level of the problems that are no fact of the catalog: a dialect issue on a construct the target shell lacks
 * (`unsupported`) or that works differently there (`behaviour`, "Portability"), src/dialect.ts; a script with CRLF line
 * ends (`crlf`, src/document.ts), an error when a CR ends the `#!` line or a keyword stands just before a CR (run as
 * a program, the interpreter is not found; `fi` is read as `fi\r`, every time), a warning otherwise (`crlfMaybe`:
 * `bash file` runs `echo hi`, with a CR at the end of its output); zsh syntax a line of a zsh script cannot be read with
 * (`parse`, src/dialect.ts), information: the line is not explained (a problem of that severity, as it always was).
 */
export const PROBLEM_LEVELS = { unsupported: 'error', behaviour: 'info', parse: 'info', crlf: 'error', crlfMaybe: 'warning' } as const satisfies Record<string, NoteLevel>;

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
