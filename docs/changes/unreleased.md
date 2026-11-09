# Unreleased changes, in detail

The short list is in [CHANGELOG.md](../../CHANGELOG.md#unreleased).

## New

### bazel target patterns

- **Target patterns.** Each pattern of build, test, coverage, run, fetch and vendor says what it selects, with its parts below it: `//app:main` is "One target, `//app:main`", `//app` the target named like the package (`//app:app`), `//app:all` every rule of the package, `//app:*` and `//app:all-targets` every target (rules and files), `//app/...` every rule of the packages in `app` and below, `//...` every rule of the repository. A wildcard of these commands leaves out the targets tagged `manual`; a pattern that names one takes it. Patterns without `//` are relative to the current directory (`:main`, `legacy:all`, `...`); one with no `:` (`app/main`) names the target of the longest leading part that is a package (`//app:main`). `@repo//…` and `@@canonical//…` name a repository (`@repo` alone is `@repo//:repo`), and `-//app/legacy/...` after `--` takes its targets out of those of the patterns before it. What bazel refuses is marked: `../x:y`, `//app/...:main`, `//app:`, `//app/`. In `"//$pkg/..."` and `"//app:$t"`, the value is said to be read as part of the package's path, or as the target's name (where `all` and `*` are wildcards, a `/` is part of the name, and a `:` is refused). `//:all` names the top package of the repository. Each form was checked with what `bazel query` and `bazel build` take of it in a small workspace.
- **Query expressions.** A word of `bazel query`, `cquery` or `aquery` that is a target pattern (`//app/...`, `@@//app:all`) says what it selects: an aquery's wildcards leave out the `manual` targets as a build's do, a query's and a cquery's take them. The rest of the expression (`deps(//app:main)`) is still a plain argument.

### buildifier

Checked with buildifier 10.2.0 (bazel-contrib/buildtools; `buildifier -help`, and runs on small BUILD files: test/buildifier.test.ts).

- **The line.** `buildifier -mode=check -lint=warn -r .` reads each option with its value (`check`, `diff`, `fix`, `print_if_changed`; `off`, `warn`, `fix`; the file types of `-type`; `text`, `json`, `sarif`), and `.` as the directory it looks through.
- **How buildifier reads its words.** Go's `flag` package: `-mode=check`, `-mode check` and `--mode=check` are the same, and the first file ends the options, so in `buildifier BUILD -mode=check` the second word is a file name (buildifier fails opening it).
- **`-format`.** With any `-format` (even `text`), `-mode=check` prints the report on stdout and exits 0; without it, the list of files goes to stderr and the status is 4. `-format` with another mode is a usage error (status 2).
- **Not yet said.** The exit status (0 success, 1 a syntax error in an input, 2 a usage error, 3 a file error, 4 when check or `-lint=warn` finds something) is in the option texts only where it depends on an option.

## Changed

### Invalid regexes are Errors

A pattern that grep, sed, awk or Perl refuses stops the program with an error every time it runs, and bash's `[[ =~ ]]` gives status 2. Such a pattern is now an Error of the line: in Problems, in the box of the line's problems, and for `--check`. The regex's part says what is wrong and what the program does, as before, and is marked as an Error. Each kind was checked with GNU grep 3.11 (`-G`, `-E`, `-P`), GNU sed 4.9, gawk, mawk, Perl 5.38 and bash 5.2 (test/regex-errors-real.test.ts).

- **A `[` that no `]` closes.** `grep -E '[a' f`: "No `]` closes this `[`: `grep` stops with an error (status 2)". `[[ $x =~ a[ ]]`: "`[[ … ]]` gives status 2, with no message". The same in `awk '/[a/'` and `perl -ne '/[a/'`.
- **A group that no `)` closes.** `grep -E '(a'`, `sed 's/\(a/x/'` ("No `\)` closes this group: `sed` stops with an error (status 1)"), `grep -P '(?:a'`. Before, the group's text ended "(missing closing parenthesis)".
- **A `\` at the end.** `grep 'a\'`: "Nothing follows the final `\`".
- **A bad `\{…\}` in a basic regex.** `grep 'a\{'`, `sed 's/a\{x\}/y/'`. A `\{` with nothing before it to repeat (`sed 's/\{1\}/x/'`, `s/^\{/x/`) is an Error in sed only ("Invalid preceding regular expression"): GNU grep reads it as the character `{`.
- **What `grep -P` refuses and Perl takes.** `[\d-z]` (a set at an end of a range), `\U`, `\L`, `\u`, `\l`, `\F`, and a letter PCRE2 has no escape of (`\q`). In `perl -ne` the same patterns are no Error.
- **Not an Error.** A pattern with an expansion that could mend it (`grep -E "[$x" f`), and a line the shell does not get to (after `exit 0`): there the part says the same, without the mark. Some patterns the programs refuse are not found yet: `grep -E 'a{}'`, `sed -E 's/a{/x/'`, `grep 'a\{2,1\}'`, and an unclosed `[` in a sed command, which the sed reader says ("Unterminated `s` command").

## Fixed

### Brackets in a sed regex, and a `\{` with nothing before it

- **sed.** GNU sed reads a bracket expression whole when it looks for the end of a regex, so a `/` in it ends nothing: `sed 's/[/]/x/'` replaces a slash, and `sed '/[^/]/p'` prints lines with a character other than `/`. Before, the regex ended at that `/`: `s/[/]/x/` was read as the regex `[` (and called unclosed), the replacement `]` and the flags `x/`.
- **grep.** In a basic regex, GNU grep reads a `\{` with nothing before it to repeat (at the start, after `^`, `\(`, `\|` or an anchor such as `\<`) as the character: `grep '\{1\}'` matches the text `{1}`. Before, it was read as "repeat the previous item exactly 1 times", and `grep '^\{'` was an error. `x\{,\}` repeats `x` 0 or more times, as in grep and sed; before, it was an error too.
