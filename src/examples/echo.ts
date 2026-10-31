// What `echo` prints is known from its words only where it prints them as they are. The one place this is decided.

/**
 * Whether what `echo` prints is known from its (already unquoted) words. `escapes`: its reading of backslashes is
 * other than plain, or not known to be: another shell's (dash prints `\t` as a TAB, and stops at `\c`; zsh, mksh and
 * ksh read them too), or bash with `shopt -s xpg_echo` (`echoMayReadEscapes`, src/explain/reads.ts). Then a word with
 * a backslash has no known output; without one, every shell's echo prints the words as they are.
 */
export function echoWordsKnown(words: readonly string[], escapes: boolean): boolean {
  return !escapes || !words.some((w) => w.includes('\\'));
}
