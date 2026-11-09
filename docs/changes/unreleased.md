# Unreleased changes, in detail

The short list is in [CHANGELOG.md](../../CHANGELOG.md#unreleased).

## New

### Database clients

Each option list was compared with the `--help` of the real program: PostgreSQL 16.15 (`psql`, `pg_dump`), MySQL 8.0.46 (`mysql`, `mysqldump`; MariaDB's clients differ in places) and SQLite 3.54.1, recorded in test/fixtures/db/. The SQL (`psql -c`, `mysql -e`, `sqlite3 DB 'SQL'`, a here-document) is not read.

- **psql, pg_dump.** Read as getopt_long does (`psql --vers` is `--version`). `psql` takes `[DBNAME [USERNAME]]`; a connection string or a URI is allowed there and in `-d`, and a password in a URI is said to be visible to other users. Neither has an option for a password (`-W` asks; `PGPASSWORD` or `~/.pgpass` gives it).
- **mysql, mysqldump.** No abbreviations of long options, short options cluster (`-Bse 'select 1'`), and `--skip-NAME` or `--disable-NAME` turn a boolean option off. The password is the optional value of `-p` and `--password`, in the same word only: `-psecret`, `--password=secret`; `-p secret` asks for a password and takes `secret` as the database. `mysqldump` takes a database and its tables, or only databases with `--databases`.
- **sqlite3.** `-name` and `--name` are alike; the first word that is not an option is the database file (created if missing), the words after it run in order as SQL or dot-commands (`.tables`, `.mode json`), and options may come between them.

### bazel target patterns

- **Target patterns.** Each pattern of build, test, coverage, run, fetch and vendor says what it selects, with its parts below it: `//app:main` is "One target, `//app:main`", `//app` the target named like the package (`//app:app`), `//app:all` every rule of the package, `//app:*` and `//app:all-targets` every target (rules and files), `//app/...` every rule of the packages in `app` and below, `//...` every rule of the repository. A wildcard of these commands leaves out the targets tagged `manual`; a pattern that names one takes it. Patterns without `//` are relative to the current directory (`:main`, `legacy:all`, `...`); one with no `:` (`app/main`) names the target of the longest leading part that is a package (`//app:main`). `@repo//…` and `@@canonical//…` name a repository (`@repo` alone is `@repo//:repo`), and `-//app/legacy/...` after `--` takes its targets out of those of the patterns before it. What bazel refuses is marked: `../x:y`, `//app/...:main`, `//app:`, `//app/`. In `"//$pkg/..."` and `"//app:$t"`, the value is said to be read as part of the package's path, or as the target's name (where `all` and `*` are wildcards, a `/` is part of the name, and a `:` is refused). `//:all` names the top package of the repository. Each form was checked with what `bazel query` and `bazel build` take of it in a small workspace.
- **Query expressions.** A word of `bazel query`, `cquery` or `aquery` that is a target pattern (`//app/...`, `@@//app:all`) says what it selects: an aquery's wildcards leave out the `manual` targets as a build's do, a query's and a cquery's take them. The rest of the expression is read in the query language (below).

### bazel query expressions

Each fact was checked with bazel 9.3.2 in a small workspace: about 240 expressions, recorded in test/fixtures/oracles/bazel.json (`expressions`) with their status, their error, and the targets (or an aquery's mnemonics) they gave.

- **The language.** An expression given as one word (`bazel query 'deps(//app:main) except //lib:old'`) gets a row for each function, operator, keyword and word. `except`/`-`, `intersect`/`^` and `union`/`+` bind alike, from the left, and the second operator of a chain says so (`a - b + c` is `(a - b) + c`). `let v = … in …` names `$v`, and `set(a b c)` takes words separated by blanks. Words are target patterns, with their parts below them; a quoted word (`"//app:main"`) is one too.
- **Functions.** `deps`, `rdeps`, `allpaths`, `somepath`, `kind`, `filter`, `attr`, `labels`, `tests`, `executables`, `buildfiles`, `loadfiles`, `siblings`, `some`, `same_pkg_direct_rdeps` and `visible`, each with its arguments (a depth or a count is a whole number). The patterns of `filter`, `kind` and `attr` are Java regexes searched anywhere in the label, the kind (`cc_library rule`, `source file`) or the attribute's value, and get the regex's parts. A regex Java refuses is marked as bazel stops on it (status 7, 1 for cquery and aquery): an unclosed `[` or `(`, a final `\`, an escape Java has not (`\q`, `\U`); `[\w-.]` is no error there, as it is for `grep -P`. cquery adds `config(x, target)`; aquery adds `inputs`, `outputs` and `mnemonic`, whose patterns match a path or a mnemonic whole.
- **Mistakes.** A function the command does not have is marked with bazel's "unknown function": `config` outside cquery, `inputs` outside aquery, `allrdeps` and `rbuildfiles` without `--universe_scope` or `--infer_universe_scope` (and never in cquery or aquery). So is one the command refuses when it runs: `buildfiles`, `loadfiles`, `siblings`, `same_pkg_direct_rdeps` and `visible` in cquery and aquery, and `labels` in aquery (`tests` works in both). Syntax errors are marked where bazel stops: an unclosed `(` or quote, too few or too many arguments, a word where a number goes, `=` outside `let` (`//app:a=b`), a word that starts with `*`, a variable no `let` binds. A `+` between two words with no blank (`//app:a+b`) is still the union: a warning says so, and that a name with `+` is quoted inside the expression. There is no warning where the left word is a wildcard (`//app/...+//lib/...`, `:all`) or the right one starts another pattern (`//`, `@`, `:`), and a word that starts with `@@` keeps its `+`. An expression that ends too soon (`deps(//x) union`) gets one row on its last word, the error.
- **Values in the expression.** In `bazel query "deps($t)"`, the value of `$t` is said to be read as part of the expression (its blanks, `+`, `(` and `,` are the query's syntax). In `"rdeps(//..., //$pkg:all)"`, the value is part of the package's path, and the first such hole of the line says that a blank, `+` or `(` in it would end the word. A value that is a whole number or word argument (`"deps(//app, $DEPTH)"`, `"labels($ATTR, //app)"`) is said to be read as that argument. A value that decides the reading (a function's name, part of a number, an unquoted regex, a variable's name) leaves the expression unread.
- **Several words.** bazel joins the words of an expression with spaces (`bazel query deps '(//x)'`); there only the words that are target patterns are read, as before.

### bazel query in a pipeline

- **The example.** `bazel query 'kind(cc_library, //...)' --output label_kind | awk '{print $3}'` gets an example of the whole pipeline: what the query prints over a made-up C++ workspace (`//app`, `//lib`, `//tools`, `//util`, and `@abseil-cpp`), then what awk makes of it. A note says that the workspace is an example, and the real output lists the targets of the workspace the line runs in. A stage after the query reads those lines in its own example too (`bazel query //... | sort -r`).
- **What it follows.** Target patterns from the top of the repository (`//...`, `//app:all`, `//app:*`, `//lib:greet`, `@abseil-cpp//absl/strings`), the set operators, `let` and `set(…)`, and `deps`, `rdeps`, `allpaths`, `somepath`, `kind`, `filter`, `attr` (`name`, `tags`, `visibility`), `labels` and `tests`. It reads `--output` (`label`, `label_kind`, `package`), `--noimplicit_deps`, and the options that print nothing else (`--noshow_progress`, `--keep_going`…). `bazel cquery` prints each target with its configuration (`//app:main (a7a71fd)`): the hashes are those of one machine, and the note says so. A cquery gets an example for one target pattern, alone or under `kind`, `filter`, `attr` or `tests`, whose output bazel prints sorted. The output was checked with what bazel 9.3.2 printed for 21 commands over that workspace, and with the targets of 69 expressions over a second one.
- **What it does not.** No example where bazel's output is not known for sure: a pattern relative to the current directory (`:main`), a target the workspace has not, the dependencies of an external library (`deps(//app:main)` reaches into @abseil-cpp), a path where bazel could take another (`somepath` with two ways), any other function, option or output format, a cquery that walks the graph (`deps` in cquery) or joins sets (cquery prints `//util:text + //app:main` in an order of its own, `//util:text` first), and a regex in a syntax of Java's own (`[[:digit:]]` is a class of `[`, `:`, `d`… there, `[a-z&&[^l]]` an intersection, and Java refuses `x{,2}`). Where the examples' guard stops the evaluation (a very long expression), the example says it is not computed.

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

### unused_deps

Checked with unused_deps 10.2.0 (bazel-contrib/buildtools; `unused_deps -h`, and the query it runs with no bazel on PATH: test/unused-deps.test.ts).

- **What it does.** It asks bazel for `kind('(kt|java|android)_*', PATTERNS)` (`//...` with no pattern), an unanchored regular expression: rules whose kind has `kt`, `java` or `android` in its name (`java_library`, `java_binary`, `kt_jvm_library`, `android_library`) are checked, the others are skipped. For each dependency the compiler did not use, it prints a buildozer command (`buildozer 'remove deps //lib:x' //app:main`); the summary says it changes nothing itself.
- **Options.** The seven flags of `-h` (`-build_tool`, `-cquery`, `-extra_action_file`, `-extra_build_flags`, `-output_file`, `-disable_symlink_safety`, `-version`), read as Go's `flag` package does, as buildozer's. Each operand is a target pattern, read as for `bazel build`.
- **Not yet said.** The exit status; the output is not shown as an example.

### C and C++ compilers

- **Variants of gcc.** `cc`, `c++`, `g++`, `clang` and `clang++` take gcc's command line. `g++` and `clang++` say they read `.c` files as C++ (g++ links libstdc++); `cc` and `c++` say they are the system's choice (GCC on most Linux systems, Clang on macOS and FreeBSD). Clang's `-Weverything` and `-fcolor-diagnostics` and GCC's `-fanalyzer` and `-fdiagnostics-color` belong to their own compiler only, checked with the real compilers.
- **More options.** `-std`, `-x`, `-E`, `-S`, `-I`, `-L`, `-l`, `-D`, `-U`, `-pedantic`, `-w`, `-v`, `-pthread`, `-fsanitize`, `-fopenmp`, `-march`, `-isystem`, `-include` and the dependency options `-MD`, `-MMD`, `-MP`, `-MF`, `-MT`, for gcc too. A value in the same word is read: `-lm`, `-Iinc`, `-DX=1` (the macro `X` as `1`), `-Wl,…`, `-Wa,…`, `-Wp,…`; `-std` takes its value only so (`-std=c11`), as gcc does. Before, `gcc -lm` was an unknown option.

### Java tools

Checked with Temurin 21.0.13, Apache Maven 3.9.9 and Gradle 8.14.3: every option of their usage texts (`java --help`, `--help-extra`, `javac --help`, `--help-extra`, `keytool -COMMAND -help`, `mvn --help`, `gradle --help`; recorded in test/fixtures/java/) is in the spec, and the rules below were run (test/java-real.test.ts).

- **java.** The JDK's tools take no `-name=value` (`javac -classpath=out` is an invalid flag; `--class-path=out` is fine), and `java -source 21` is not an option (`--source` is). Options of one dash (`-cp`, `-classpath`, `--class-path`, `-jar`, `-m`), `-D<name>[=<value>]`, `-X…` (`-Xmx`, `-Xms`, `-Xss` with their sizes), `-XX:…` and the colon forms (`-ea:pkg...`, `-javaagent:`, `-verbose:gc`). The main class, or the file after `-jar` and the module after `-m`, ends the options: what follows is the program's arguments (`java -jar app.jar --port 80` no longer shows `--port` as an unknown option of java).
- **javac.** The same family of options, `-d`, `-sourcepath`, `-encoding`, `--release`, `-g:…`, `-Xlint:…`, `-proc:…`, `-A<key>=<value>`, `-J<opt>`; the operands are source files and `@argfiles`.
- **keytool.** Its commands, written as options (`-genkeypair`, `-list`, `-importcert`…), and their options; `-storepass` says that the password on the command line can be seen by other users.
- **mvn, mvnw.** The options of `mvn --help` (`--fail-on-severity` and `--raw-streams` are not options of 3.9.9), including the multi-letter short ones (`-pl`, `-am`, `-fae`), `-D…`, `-P…`, `-T…`; operands are lifecycle phases and plugin goals.
- **gradle, gradlew.** The options of `gradle --help`; operands are tasks.
- **Not yet said.** Which phase or task does what; the commands of a goal.

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
