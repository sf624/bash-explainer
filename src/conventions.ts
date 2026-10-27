// The habits of shell scripts that some notes recommend (docs/design/basis-spec-convention.md, section 2). A note
// sorted "both" states a fact of bash, or of the program it names, that bites only with input, values or a setup the
// line does not control; its advice is a common habit that rules the case out beyond this line. The habit is not what
// the note rests on (its basis stays the fact's: src/basis.ts), so it is a field of its own, `convention`, an id into
// this table: a catalog entry names it with `withConvention` (src/messages.ts), a style check in `STYLE_CONVENTIONS`
// (src/pitfalls.ts).
//
// Data only: no view shows it, and the CLI's JSON gives only the id. `sources` name who states the habit, as plain
// strings: ShellCheck's and Hadolint's codes, Python's and GitHub's documentation. Nothing is fetched, linked, run or
// bundled (ShellCheck is GPL, and only cited). Each code was checked against its page on the tool's wiki
// (github.com/koalaman/shellcheck/wiki/SC…, github.com/hadolint/hadolint/wiki/DL…), whose title the comment quotes
// or says; a habit with no source we could check has none.

/** A habit: what it is, in a few words, and who states it. */
export interface Convention {
  habit: string;
  sources: readonly string[];
}

export const CONVENTIONS = {
  // SC2086: "Double quote to prevent globbing and word splitting."
  'quote-expansions': { habit: 'Double-quote every expansion: "$x", not $x', sources: ['ShellCheck SC2086'] },
  // SC2068: "Double quote array expansions to avoid re-splitting elements." SC2048: "Use "$@" (with quotes) to
  // prevent whitespace problems." (the one for `$*`).
  'quote-all-arguments': { habit: 'Pass the arguments on as "$@"', sources: ['ShellCheck SC2068', 'ShellCheck SC2048'] },
  // SC2124: "Assigning an array to a string! Assign as array, or use * instead of @ to concatenate."
  'array-for-a-list': { habit: 'Keep a list in an array; join it with * only when one string is meant', sources: ['ShellCheck SC2124'] },
  // SC2045: "Iterating over ls output is fragile. Use globs." SC2044: "For loops over find output are fragile. Use
  // find -exec or a while read loop."
  'no-loop-over-command-output': { habit: 'Loop over a glob, or over find -print0 with a while read loop, not over the output of ls or find', sources: ['ShellCheck SC2045', 'ShellCheck SC2044'] },
  // (The wiki page of SC2045 mentions nullglob for the same case, but no code states this habit itself.)
  'guard-unmatched-glob': { habit: 'Skip a pattern that matched nothing: [ -e "$f" ] || continue, or nullglob', sources: [] },
  // SC2162: "read without -r will mangle backslashes."
  'read-r': { habit: 'Always write read -r', sources: ['ShellCheck SC2162'] },
  // SC2155: "Declare and assign separately to avoid masking return values."
  'declare-then-assign': { habit: 'Declare a variable and assign it a command substitution apart', sources: ['ShellCheck SC2155'] },
  // DL4006, on a Dockerfile: set the SHELL option -o pipefail before a RUN with a pipe. No ShellCheck code
  // asks for `set -o pipefail` in a script.
  'pipefail': { habit: 'Turn pipefail on: set -o pipefail, or a SHELL instruction with -o pipefail', sources: ['Hadolint DL4006'] },
  // SC2115: "Use "${var:?}" to ensure this never expands to /* ."
  'guard-empty-path': { habit: 'Write ${var:?} where an empty value would make the path start at /', sources: ['ShellCheck SC2115'] },
  'read-before-run': { habit: 'Download a script, read it, then run it', sources: [] },
  'source-by-script-path': { habit: 'Name a sourced file by a path from the script\'s directory', sources: [] },
  'grep-fixed-strings': { habit: 'Give grep -F for text that is not meant as a pattern', sources: [] },
  // (The "Security Considerations" of the subprocess module's page, and `shlex.quote`.)
  'quote-for-shell-in-python': { habit: 'Quote values with shlex.quote(), or pass a list without shell=True', sources: ['Python documentation: subprocess, Security Considerations'] },
  // (GitHub's guide recommends an intermediate environment variable for an untrusted expression.)
  'actions-expression-through-env': { habit: 'Pass an expression to a script through env:, and use it as "$VAR"', sources: ['GitHub Docs: Security hardening for GitHub Actions'] },
} as const satisfies Record<string, Convention>;

/** A habit of the table, by its id. */
export type ConventionId = keyof typeof CONVENTIONS;
