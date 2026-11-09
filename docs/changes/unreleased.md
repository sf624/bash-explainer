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
- **Not yet said.** The exit status (0 success, 1 a syntax error in an input, 2 a usage error, 3 a file error, 4 when check or `-lint=warn` finds something) is in the option texts only where it depends on an option, and in the note on `set -e` (see "Exit statuses that are no error" below).

### buildozer

Checked with buildozer 10.2.0 (bazel-contrib/buildtools; `buildozer -help`, and runs on a small workspace: test/buildozer.test.ts).

- **Commands and labels.** Each operand is a command when its first word is one of buildozer's 31 commands (`add`, `remove`, `set`, `new`, `print`, `dict_set`, `use_repo_add`…), else a label; they may come in any order. A command says what it does, and each argument its role: `add deps //lib:x` is the attribute `deps` and the value `//lib:x`; `print kind label` names the special attributes; `set kind java_library` changes the rule's kind; `add tags:expr FOO` writes the value as an expression.
- **Labels.** `//app:main` is the rule `main` in the BUILD file of `app`, `//app` the rule named like the package, `app:main` and `main` are from the current directory (`main` is the rule `main` there, not bazel's longest package), `//lib/...:*` every rule of every BUILD file below `lib`, `//app:%cc_library` every rule of that kind, `//app:%3` the rule that starts on line 3, `//app:__pkg__` and `//app/BUILD` the package itself, `-:main` the rule `main` of the BUILD file on stdin, written back to stdout.
- **What buildozer refuses.** A command with too few or too many arguments (`'add deps'`, status 1, before any file changes), an empty command, a word that is no command (`'ad deps x'` is read as a label), `set_if_absent kind`, an attribute type other than `expr`, `//lib/...` with no name, and a label of another repository.
- **Options.** Go's `flag` package, as for buildifier: the first operand ends the options (`'print kind' -quiet` takes `-quiet` for a label). The flags that are on by default (`-shorten_labels`, `-eol-comments`…) say that `=false` turns them off.
- **`set -e`.** buildozer exits with 3 when no file needed a change, which it counts as a success. Under `set -e`, a warning says that the script then stops there, so that a second run stops at that line, and suggests `… || [ $? -eq 3 ]`. Not with `-stdout`, nor when every command only prints.
- **Not yet said.** A label with an expansion in it (`"//app:$t"`), and the commands of a `-f` file.

## Changed

### Invalid regexes are Errors

A pattern that grep, sed, awk or Perl refuses stops the program with an error every time it runs, and bash's `[[ =~ ]]` gives status 2. Such a pattern is now an Error of the line: in Problems, in the box of the line's problems, and for `--check`. The regex's part says what is wrong and what the program does, as before, and is marked as an Error. Each kind was checked with GNU grep 3.11 (`-G`, `-E`, `-P`), GNU sed 4.9, gawk, mawk, Perl 5.38 and bash 5.2 (test/regex-errors-real.test.ts).

- **A `[` that no `]` closes.** `grep -E '[a' f`: "No `]` closes this `[`: `grep` stops with an error (status 2)". `[[ $x =~ a[ ]]`: "`[[ … ]]` gives status 2, with no message". The same in `awk '/[a/'` and `perl -ne '/[a/'`.
- **A group that no `)` closes.** `grep -E '(a'`, `sed 's/\(a/x/'` ("No `\)` closes this group: `sed` stops with an error (status 1)"), `grep -P '(?:a'`. Before, the group's text ended "(missing closing parenthesis)".
- **A `\` at the end.** `grep 'a\'`: "Nothing follows the final `\`".
- **A bad `\{…\}` in a basic regex.** `grep 'a\{'`, `sed 's/a\{x\}/y/'`. A `\{` with nothing before it to repeat (`sed 's/\{1\}/x/'`, `s/^\{/x/`) is an Error in sed only ("Invalid preceding regular expression"): GNU grep reads it as the character `{`.
- **What `grep -P` refuses and Perl takes.** `[\d-z]` (a set at an end of a range), `\U`, `\L`, `\u`, `\l`, `\F`, and a letter PCRE2 has no escape of (`\q`). In `perl -ne` the same patterns are no Error.
- **The right side of `=~`, in parts.** A right side made of quoted and plain parts is one regex, and is checked whole: `[[ $ext =~ ^("jpg"|"png")$ ]]` and `[[ $x =~ ^[a-z" "]+$ ]]` are fine (each part's row says that no `)` or `]` closes it in that part), and `[[ $x =~ "a"[b ]]` is an Error, said once on the test. A `[[ ]]` that bash cannot parse (`[[ $x =~ (a ]]`) has its syntax error, not the regex's.
- **Not an Error.** A pattern with an expansion whose value may close what it opens: `grep -E "[$x" f`, `[[ $x =~ ^($a|$b)$ ]]`, `[[ $x =~ ^[$chars]+$ ]]`, and a variable Perl puts into its regex (`perl -ne 'print if /[a$x/'`, where `$x` may be `]`). Nor a line the shell does not get to (after `exit 0`): there the part says the same, without the mark. Some patterns the programs refuse are not found yet: `grep -E 'a{}'`, `sed -E 's/a{/x/'`, `grep 'a\{2,1\}'`, and an unclosed `[` in a sed command, which the sed reader says ("Unterminated `s` command"); docs/backlog-archive.md lists them.

### Exit statuses that are no error

- **Under `set -e`.** To bash, any status other than 0 is a failure. The note on where the script stops says so, with what the tool means by its status: "If `grep` exits with a status other than 0 (1: no line matched), `set -e` stops the script here". `grep` exits with 1 when no line matched (with `-v`, when every line matched), `diff` with 1 when the files differ, `buildifier` with 4 when a file needs formatting or the lint found a warning (with `-mode=check`, `-d` or `-lint=warn`, and not with `-format`). Before, it said only "If `grep` fails".

## Fixed

### Brackets in a sed regex, and a `\{` with nothing before it

- **sed.** GNU sed reads a bracket expression whole when it looks for the end of a regex, so a `/` in it ends nothing: `sed 's/[/]/x/'` replaces a slash, and `sed '/[^/]/p'` prints lines with a character other than `/`. Before, the regex ended at that `/`: `s/[/]/x/` was read as the regex `[` (and called unclosed), the replacement `]` and the flags `x/`.
- **grep.** In a basic regex, GNU grep reads a `\{` with nothing before it to repeat (at the start, after `^`, `\(`, `\|` or an anchor such as `\<`) as the character: `grep '\{1\}'` matches the text `{1}`. Before, it was read as "repeat the previous item exactly 1 times", and `grep '^\{'` was an error. `x\{,\}` repeats `x` 0 or more times, as in grep and sed; before, it was an error too.
