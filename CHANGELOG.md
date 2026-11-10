# Changelog

## Unreleased

Details and examples: [docs/changes/unreleased.md](https://github.com/sf624/bash-explainer/blob/main/docs/changes/unreleased.md).

### New

- A variable the script sets is read in the language of the command that uses it: in `re='^[A-Z][0-9]+$'; grep -E "$re" ids.txt`, the value of `$re` gets the parts of the regex under its value, and the example, as `grep -E '^[A-Z][0-9]+$'` does. An error in the value (`re='[a'`) is an Error of the line; before, the value was shown but not read.

## 0.13.0

Python scripts that import `re` get their regex patterns explained, with examples checked against Python and Errors for patterns Python refuses. `grep -P` reads named backreferences and conditionals, and `sed`, `grep` and `gawk` no longer show an example for a script that is not known.

Details and examples: [docs/changes/0.13.0.md](https://github.com/sf624/bash-explainer/blob/v0.13.0/docs/changes/0.13.0.md).

### New

- In a `.py` file that imports `re`, the pattern of `re.search`, `re.compile`, `re.sub` and the other `re` functions is explained in the panel and the hover, part by part, with its flags (`re.I | re.M`, `(?i)`, VERBOSE comments). The fields of an f-string are read as holes (`rf"^{prefix}\d+$"`). A pattern Python refuses (`re.compile('*.txt')`, `(?P<n>a)(?P<n>b)`) or flags it refuses (`re.compile('a', re.L)`) is an Error with Python's message, `[[:alpha:]]` is a Warning (Python reads a set and then `]`), and a flag passed as `count` (`re.sub(p, r, s, re.I)`) or an escape that a string without `r` makes a character (`"\bword\b"`, a backspace; `"(a)\1"`, U+0001) is a Warning.
- On the web page, a pasted or opened Python script with `import re` and a call of `re.search(…)` or the like is taken as Python, so its patterns are explained. A shell script that only mentions `re.sub` stays a shell script.
- The replacement of `re.sub` and `re.subn` is explained: `\1` and `\g<name>` say which group's text they put in, a group the pattern lacks is an Error (`invalid group reference`), and the example applies the replacement. A method of a compiled pattern (`EMAIL = re.compile(…)`, then `EMAIL.findall(s)`) says on which line its pattern was compiled, and gets that pattern's example.
- A pattern of `re.search`, `re.fullmatch`, `re.sub`, `re.split`, `re.findall` and the other `re` functions gets an example, checked against Python: strings that match and do not, or what the call gives back for its subject, as Python prints it (`re.split(r'(,)|(;)', 'a,b;c')` gives `['a', ',', None, 'b', None, ';', 'c']`).

- `grep -P` explains a backreference by name, `(?P=q)`, and conditionals, `(?(1)b|c)`; before, "a PCRE construct this explainer does not read". A conditional of three branches, or on a group the pattern lacks, is an Error, and so is a repeat or a `)` PCRE2 refuses (`grep -P '*.txt'`, `a**`, `a)`); before, these were explained as repeats or a literal `)`.

### Fixed

- The example of `sed -e … -e "$x"` (or with `-f`), of `grep -e … -e "$x"` and of `gawk -e … -e …` no longer shows the output of one script or pattern alone; with a script or pattern that is not known, there is no example.
- In `.py` files, Python's string escapes are read as Python reads them (`"\a"`, octal `"\012"`), and in a command string an escaped newline is what sh reads there (a newline in quotes, a line continuation after `\`). Before, `"\012"` was read as a NUL followed by `12`, and every escaped newline as `;`.

[All changes](https://github.com/sf624/bash-explainer/compare/v0.12.0...v0.13.0)

## 0.12.0

bazel command lines are read further: target patterns, the query language of `query`, `cquery` and `aquery`, and examples of their output, plus buildifier, buildozer and unused_deps. C++ compilers, Java tools, database clients, `rg`, `pv`, `socat` and `sshpass` are explained too. An unquoted variable used as a pattern gets a caveat, and an invalid regex in a script is now an Error.

Details and examples: [docs/changes/0.12.0.md](https://github.com/sf624/bash-explainer/blob/v0.12.0/docs/changes/0.12.0.md).

### New

- Each target pattern on a bazel command line says what it selects (`//app:main`, `//app/...`, `:all`, `-//app/legacy/...`), in `bazel query`, `cquery` and `aquery` too. A pattern bazel refuses (`//app/...:main`, `//app:`) is marked.
- The expression of `bazel query`, `cquery` and `aquery` is read in bazel's query language: `deps(//app:main) except //lib:old` gets its functions, operators, `let … in` and target patterns. A function the command lacks or refuses (`config` in `query`, `siblings` in `cquery`), a syntax error, and a `+` inside an unquoted word are marked.
- A pipeline that starts with `bazel query`, `cquery` or `aquery` gets an example: `bazel query 'kind(cc_library, //...)' --output label_kind | awk '{print $3}'` shows the query's output over a made-up C++ workspace, and what awk makes of it; `bazel aquery 'mnemonic("CppCompile", //...)' | grep Target` shows its recorded actions. A note says the workspace is an example.
- buildifier commands are explained: `buildifier -mode=check -lint=warn -r .` gets every option and its values, and a word after the first file is a file name, as buildifier reads it.
- buildozer commands are explained: in `buildozer 'add deps //lib:x' //app:main`, the command, its arguments and each label say what they do. Under `set -e`, a warning says that buildozer's status 3 (no file changed) stops the script.
- unused_deps commands are explained: in `unused_deps //app:main`, the target pattern says what it selects, and the summary says that it checks only Java rules and prints buildozer commands, changing nothing itself.
- `cc`, `c++`, `g++`, `clang` and `clang++` are explained as `gcc` is, with the difference of each. `g++ -std=c++17 -O2 -lm -Iinc -DX=1 main.cpp -o app` gets `-std`, `-l`, `-I` and `-D`, also with the value in the same word. Before, only `gcc` was known, and `-lm` and `-Iinc` were unknown options there too.
- Java tools are explained: `javac -d out -cp 'lib/*' -Xlint:all A.java`, `java -Xmx512m -Dfoo=bar -jar app.jar --port 80` (the words after the JAR are the program's), `keytool -genkeypair …`, `mvn -DskipTests -pl :app -am clean package` and `./gradlew build --no-daemon` get their options and operands.
- Database clients are explained: `psql`, `pg_dump`, `mysql`, `mysqldump` and `sqlite3` get their options and operands, as in `psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" <<-EOSQL` of a Docker entrypoint. `mysql -psecret` and `mysqldump -p…` say that a password on the command line can be seen by other users.
- `rg`, `pv`, `sponge`, `expect`, `socat` and `sshpass` are explained: `rg -n -A3 -g '*.ts' TODO src` and `pv -L 1M big.iso | gzip` get their options and operands, `sshpass -p` warns that the password can be seen by other users, `socat` reads its two addresses as operands, and the command after `sshpass` is explained as a command.

### Changed

- Under `set -e`, the note on where the script stops says what a status other than 0 means for `grep` (no line matched), `diff` (the files differ) and `buildifier -mode=check` (a file to format): bash stops on those too.
- An unquoted variable used as a pattern or a program, whose value bash would glob or split, gets a caveat that suggests quoting it: `grep -E $pattern ids.txt` with `pattern='^[A-Z]{3}-[0-9]+$'` suggests `"$pattern"`. Its argument says that a file name that matches would take its place.
- An invalid regex in a shell script is now an Error in Problems and `--check`: `grep -E '[a'`, `sed 's/\(a/x/'`, `grep -P '\q'`, `[[ $x =~ a[ ]]`. Before, only the regex's part of the explanation said so.

### Fixed

- A `/` inside `[…]` no longer ends a sed regex (`sed 's/[/]/x/'` replaces a slash), and `grep '\{1\}'` reads `{1}` as text, as GNU sed and grep do.

[All changes](https://github.com/sf624/bash-explainer/compare/v0.11.0...v0.12.0)

## 0.11.0

Under `set -e`, a line whose command can fail now says where the script stops and which trap runs. A new warning catches shell injection through `find -exec sh -c` and `xargs sh -c`, and bazel command lines are explained. The box of a line's problems shows each fix as the whole line, the depths are named Overview and Word by word, and `sh` scripts are read closer to how dash and busybox ash run them. On the web page, a large script freezes the page about half as long.

Details and examples: [docs/changes/0.11.0.md](https://github.com/sf624/bash-explainer/blob/v0.11.0/docs/changes/0.11.0.md).

### New

- Under `set -e`, a line whose command can fail has a note: if it fails, the script stops there, which EXIT or ERR trap runs then (with its line), and the exit status. In a bats test, it says that the test fails there.
- New warning "Shell injection risk" on `find . -exec sh -c 'echo {}' \;` and `xargs -I{} sh -c 'echo {}'`: the path or item becomes shell code. It shows the safe form, `sh -c '… "$1" …' _ {}`.
- On the web page, a script with no shebang gets a line under the Problems strip, "2 constructs not in POSIX sh", with a button **Check as POSIX sh**. It is only a hint: the Problems counts, `--check` and the Action leave it out, and VS Code, bats files and scripts with a shebang (bash's too) do not show it.
- bazel command lines are explained: the startup options, the command, about 90 common options with their `--no` forms (`--nostamp`), the target patterns, and the program's arguments of `bazel run //x -- …`. An option on the wrong side of the command, which bazel refuses, is flagged.

### Changed

- The box of a line's problems shows each fix under its headline, as the whole line fixed with the changed part marked, and **Copy fix** copies that line; before, the fix was under **More**, and its Copy took only the part that changed. The web page's header button now says **Copy as Markdown**.
- The panel's depths are named **Overview** and **Word by word** (「概要」「単語ごと」), with the key that chooses each in the tooltip, and a problem's headline starts with the word the Problems list uses ("Portability"). Before, the depths read "1 Does" and "2 Reads", and the headline said "Pitfall" for a portability note.
- At depth 1, the panel shows bash's steps on a word that a step changes (`"$USER"`, `~/docs`, `*.txt`), and a glob's example of names starts open when it is the line's only example or the cursor is on its command; names typed in it stay. Before, the steps were only at depth 2, and the example started closed.
- At depth 2, every stage of a pipeline starts folded to its own row, examples included, and opens when you move the cursor into it or click its row; ▸ folds it again. The shebang's row says in one line what runs, and what bash and the kernel make of `#!` comes at depth 2.
- **In short** gives each command a short summary with no nested parentheses (`grep` (print lines matching a pattern)), names a loop's body by its lines ("repeats the body on lines 3–8"), and says what the functions of bats do (`run`, `load`, `assert_success`). Before, it named bats' functions alone.
- In a `sh`, `dash` or `ash` script, the note on a bash-only form says how it fails there: the status, the message, and whether the shell stops (`[[ ]]` is "not found" with status 127, so the condition is false; `a=(1)` is a syntax error). Before, it said only "it fails in dash".
- On the web page, the card over the script no longer opens where you clicked, and it closes on a click, a paste, typing and Escape. The Legend is a popover over the explanation that Escape closes, with no button on a line with nothing to explain; before, it pushed the explanation down and stayed open on the next line.
- On the web page, Clear, Open and a paste that replaces the whole script start a new script: its file type from the text, untitled, the shell back to Auto, with a toast and Undo. Before, test.bats and a shell chosen in the chip or with "Check as POSIX sh" stayed for every script pasted after it.
- On a phone, the explanation's sheet has a strip of its own above its tabs to grab, a short flick up from half no longer opens it to full height, and at full height it stops below the file name and leaves the ☰ button free. The file name opens the rename box from its pencil only, and a part's fold arrow takes a tap 44 px wide and high.
- A pipeline's sample for `uniq` or `sort -u` now shows lines that really collapse: after `sed`, two different lines instead of one line copied, and the copies of a line come one after the other, so a bare `uniq` collapses them too.
- `which` now says that it looks only in PATH, and that `type` or `command -v` tells what bash runs (a builtin, function or alias too).
- The README is shorter: a quick start, then links to the new user guide in `docs/guide/` (English and Japanese), which holds the rest. Its logo is readable in dark themes in VS Code.

### Fixed

- On the web page, a large script freezes the page for about half as long: pasting nvm.sh (4,600 lines) blocks it for 8 s instead of 17 s. The POSIX sh hint does not check a script that large.
- In a script that sources a file or runs text the explainer cannot read, the lines before that point use the values the script gives again: their worked examples run on the real data, and their notes read the value (`rm -rf $dir` with `dir=/tmp/cat` is a Caveat). In 0.10.0 they had made-up examples and stronger warnings.
- A Dockerfile's `RUN` is checked for the `/bin/sh` of its stage's base image: busybox ash under `FROM alpine`, dash under `FROM debian` or `ubuntu`. Before, `RUN [[ -f x ]]` under `FROM alpine` was an Error, and failed `--check`.
- In a `sh` or `dash` script, more bash-only forms are now problems: `a[0]=1` (also in `ash`), `$((i++))`, `$((2**3))`, `>& file`, `set +o pipefail` and `read` with no name. Builtins that dash lacks (`source`, `let`) are no longer called builtins, and variables that dash or busybox ash do not set (`$RANDOM`, `$UID`) are plain variables there, as the line's warning says.
- In a script checked as POSIX sh, `~/dir` and a glob now say which words the program receives, as in bash; before, they said "not always one word".
- The example of a test reads each value as bash does: unquoted in `[ ]`, an empty value or one with a space makes bash fail, and a new section "Error (status 2) when" lists it, the script's own value too. Before, `[ $x = "" ]` said "True when `x=""`".
- `find` and `xargs` lines are read as the tools run them: the `{}` of `find -exec rm {} \;` and the replace string of `xargs -I{} cp {} dest/` are placeholders, not operands, and of two `xargs` options that cancel each other (`-n1 -I{}`, `-L1 -n1`) the earlier is marked as ignored, with the example following the one that wins. Before, both options were listed as in effect, and some of those examples were wrong.
- `find -mtime +"$DAYS"` (a value read at run time) is summarized like `-mtime +7`: "at least (`"$DAYS"` + 1) days ago", not "more than `"$DAYS"` days ago". `-mtime -1` says "1 day", not the plural.
- A Makefile recipe line that make runs without a shell (no `;`, `$`, `|` or the like) is explained as a program make runs: `@echo -e '\033[32mOK\033[0m'` is `/bin/echo`, and the chip says "no shell". Before, it was dash's builtin, with a wrong warning about dash's `echo -e`.
- A value made only of spaces or tabs is now named (`${x//:/ }` says "with ` ` (a space)"), and a value with a space at both ends (`${x//,/ - }`) keeps them in its code span. Before, such a code span looked empty or lost its spaces.
- The note on `trap … EXIT` no longer says that it runs however the script exits: it does not run on SIGKILL, nor after `exec cmd`.
- On a phone, the explanation's header shows the same controls in Japanese as in English, its pills are drawn at one height with round ends, and the depth's menu no longer lies over the grab bar. A tap right after a swipe or a drag of the sheet is no longer lost, and moving the sheet no longer scrolls the editor back to the cursor when you have scrolled away from it.
- The command-line tool exits quietly with status 141 (what a shell reports for a program killed by SIGPIPE) when its output is closed early, as in `bash-explainer script.sh | head -1`. Before, it printed an `EPIPE` stack trace and exited with status 1.

[All changes](https://github.com/sf624/bash-explainer/compare/v0.10.0...v0.11.0)

## 0.10.0

The panel has one view with a depth. It starts with one sentence that says what the line does and a box of the line's problems, and a switch shows what each program receives. Problems have a third level, Error, and `--check` fails on errors. The web page has a new layout around the editor; on a phone, the explanation is a sheet over it.

Details and examples: [docs/changes/0.10.0.md](https://github.com/sf624/bash-explainer/blob/v0.10.0/docs/changes/0.10.0.md).

### New

- The panel starts with **In short**: one sentence that says what the line does, on every line with code.
- A switch in the panel, on by default (key W), shows what each program receives: its words after bash's expansions, and the parts bash handles itself. A quiet mark shows what is not portable to sh, in a bash script too; the Legend lists the marks on screen.
- Problems have a third level, Error, for a line that fails every time as written: `[ -f a` without `]`, `x = 1`, `echo $((09))`, `#!/usr/bin/env bash -e`, a construct the script's shell lacks where the shell surely meets it. Errors show a red ⓧ and "Error:" in every view, before the other notes.
- **Compatibility:** `--check` and the GitHub Action fail on every error, and on a warning only with `--strict`. Errors that were pitfalls now fail without `--strict`; a few warnings now fail only with it, and two caveats newly fail with it (the details list them).
- Quick fixes for the problems whose fix is mechanical, in VS Code, the Language Server and the web page's editor: a failure reported as success, `source` that searches `$PATH`, a `grep` pattern from a variable, a loop over a glob that matches nothing, `read` without `-r`, `[-f x]` and more. Each applies the code the note shows.
- A command over several lines (a loop, an `if`, a `case`, a function, a pipeline, a here-document) is marked in the editor with a bar at the left of its lines while the cursor is in it, in VS Code and on the web page. `bashExplainer.blockOutline` chooses `bar` (the default), `tint` (a faint background) or `off`.
- Words with an expansion in double quotes are read by the command's own reader: `sed "s/$old/$new/g"`, `grep "$x\.log" f`, `find . -name "$p*.txt"`, `date +"%F $x"`. A note says what a value's characters do there, and where the value decides what the command is (`awk "{print \$$n}"`, `jq ".$key"`).
- Dockerfile `HEALTHCHECK CMD …` is explained, in the shell and the exec form, and so is an instruction after `ONBUILD`.
- `--format json` gives each part of a line its colour role (`role`), the ids of the facts said about it (`facts`), and where its marks are, with their `level` (`marks`).
- `--check --counts <file>` appends the number of problems of each level to a file, as `$GITHUB_OUTPUT` reads them. It does not write through a symbolic link at the last part of the path.

### Changed

- The panel has one view with a depth: 1 What it does, 2 How bash reads it (keys 1 and 2); depth 2 adds to the same rows who reads each part, bash's steps on a word, and a row for each reserved word and operator. Before, it had two tabs, Meaning and Reading; a Reading kept from before opens at depth 2.
- The panel shows each line in two columns, the code and what it means, with a box around each command. Bash's own punctuation and the parts of a word come at depth 2, unless they have something to say; the example of a whole pipeline is folded above the rows, and a glob's under its title.
- The panel starts with a box of the line's problems: each with its level and one sentence, **More** with the whole text and the fix to copy, and a chip that links it to its row and back. A line inside a loop or an `if` points to the problems on that line.
- `[ -f a ]` shows as the command it is, like `test -f a`: one row for `[`, with its arguments and `]` below it. At depth 2 its condition unfolds to its operator and operands (`!`, `\( \)`, `-a` and `-o` between two conditions), as one of `[[ ]]` does.
- The example of a pipeline runs with an example value of `$USER` and the like. The names a glob's example tries say why each one does not match.
- Long lines wrap between shell words, with ↪ on the rows after the first: on the web page, where wrapping is now on by default (before, it was off, and when on, a line broke anywhere), and in the explanation's line box, up to three rows (click to see it whole). The line box follows `editor.wordWrap` in VS Code; before, it scrolled sideways.
- The editor on the web page has its own header: Open, Save, the file name (click it to rename; ● marks unsaved changes), one button for the file type and the shell ("Shell script · bash (auto)"), and ⋯. Before, the type and the shell were two pickers, in the top bar or the menu.
- The explanation on the web page has its own header: the tabs Explanation and Reference, Depth, Collapse and Copy, each with a word. Before, they were icons in the top bar, or in the menu on a phone.
- Problems on the web page fold into a strip with their count per level. ‹ › and F8 / Shift+F8 go to the next and previous problem, and the strip shows where you are (Ln 20 · 1/11).
- On a phone, the explanation is a sheet over the editor: tap or drag its bar for a folded, half or full sheet, with Problems as one of its tabs. Before, the screen was split into the editor and the explanation.
- On a phone, the folded sheet and the space above the keyboard show a one-line summary of the cursor's line, and Read and Edit above the editor switch between reading and typing.
- Messages on the web page (Opened, Saved, Downloaded) show in one place above the Problems list, with **Why?** or **More** for detail. Loading the sample over your script offers Undo instead of asking first.
- Settings on the web page come in sections, with a search. On a wide window they are a column at the right, and the editor and the explanation stay in use beside them.
- A line the shell cannot read (`echo ok )`, `if true; then` with no `fi`, `echo 'a`) is an Error in a shell script with a first line (`syntax-error`), or a warning where only the file's name says so (`syntax-error-if-bash`). **Compatibility:** `--check` and the Action now fail on that Error, where nothing before the line may end the script with status 0 or change how it is read (`exit`, `source`…, even in a function).
- In a `sh`, `dash` or `ash` script, an Error now means what really fails: what the shell refuses while it reads the file (`a=(1)`, `<<<`, also in a function never called), and what fails where it surely gets to it. `$RANDOM`, `$UID`, `echo -e`, `{a,b}`, `&>` and `**`, and a construct the shell lacks in a function, in a branch or after `source`, are warnings that say what the shell does; `--strict` fails on them.
- In a script for bash, ksh, mksh, yash or zsh, what that shell or the chosen bash release lacks is a warning where it may not run: in a function, in a branch, on the right of `&&`, after `trap` or `. ./lib` (`read -E`, `source -p`, `${ …; }` with bash 5.2). Before, it was an Error.
- In a `#!/bin/sh` script, `local`, `echo -n`, `read -p` and `set -E`, which dash runs, are now information ("Portability") and fail no check. Before, they failed `--check`.
- In a script for `sh`, `$'…'`, `;&`, `set -o pipefail` and `read -d` say they are POSIX only since 2024, with what fails in dash or busybox ash. Before, they said "not POSIX sh".
- `cmd 2>&1 >file` is a problem at the Information level, and says both things the order may mean: how to send both to the file, and how to send only stdout there. Where stdout is a pipe, `$( )` or a redirection around the command, which then gets only the errors (`err=$(cmd 2>&1 >/dev/null)`), it is no problem.
- **Compatibility:** `bashExplainer.notes.pitfalls` and `bashExplainer.diagnostics.pitfalls` off no longer hide errors. The Action's `fail-on-warning: 'false'` lets errors pass too; its new output `errors` counts them (with a command-line tool 0.10.0 or later), and `pitfalls` no longer does.
- **Compatibility:** in `--format json`, a part's `explanation` no longer holds the `⚠` before a warning (read `marks`; the line's `summary` keeps it), and a command name's `said` no longer has `spoken` (read `kind` and `by`).
- **Compatibility:** `[ … ]` is now a part of kind `builtin` (`command` for a program), labelled with the word as written (`[`, `/usr/bin/[`) and with its arguments and `]` as `children`, in `--format json` and in the text and Markdown formats. Before, it was kind `test`, labelled with the whole test.

### Fixed

- In a bats file, `run`, `load`, `skip` and the other functions of bats are badged "function", not "program", in the panel, the hover and the editor's colours.
- In a script for sh, dash or busybox ash, a builtin that shell lacks (`declare`, `let`, `source`) is explained as a program, and `$"hi"` as `$hi`; in bash, so are `print` and `whence`. With another shell than bash, the panel says "the shell" where it said "bash", and line 1's shebang note says where the chosen shell came from.
- Lists, tests and keywords: `a && b || c` is an "AND and OR list" (`andOrList` in `--format json`), `[[ $x == 1 ]]` says the strings are compared plainly, `if` says that the last command before `then` decides, and `done < file` says that the redirection applies to the whole loop. `if [ -f a ] then …` says its error once, and "In short" says that the shell stops with a syntax error.
- Expansions: the `~` of `[ -f ~/.bashrc ]` and of a command name (`~/bin/foo`) is a tilde expansion, and what bash expands in an option's attached value (`make -j"$(nproc)"`, `ls --color="$(x)"`) has its own row. `${x@Z}`, `${(f)var}` and `${#x:-a}` say when bash reports "bad substitution", and `$((09))` fails only where the shell rejects the number (not in zsh, ksh93, mksh or yash, nor in `$(( ${x}09 ))`).
- A script or pattern with a backslash in double quotes, or unquoted, is read as the program gets it: `sed -E "s#^//([^:]*):#\1/#"`, `grep "a\.b"`, `awk "{print \$1}"` and `awk -F "\t"` show their parts and the example, as the single-quoted form does.
- Redirections: `cmd 2>&1 >o 2>e` and `cmd 2>&1 >o |& tee x` no longer say that stderr goes to the original stdout. `cat <<<>(f)` is a here-string, and the example of `sort <<< <(…)` gives the command the file name `/dev/fd/63` that bash passes.
- Lines that stopped the explanation, or showed a false syntax error, are explained as bash reads them: a here-document followed by more of its line (`a && cat <<E || b`, `if ! grep -q a <<E; then c; fi`), `$(a && b)` in a here-document, `${x#)}` or `<<` in a `$( )` over several lines, a command named `valueOf` after a pipe, `set -o posix` then `time -p $x`, and an alias used on a later line. In a script with CRLF line ends, the lines after a here-document are code again.
- In a Makefile, a workflow and the other host files, a row's text and "In short" name what the file says (`"$(OUT)"`, `"$@"`), and the commands of a `bash -c '…'` string are placed on their own text. Docker's exec form (`CMD ["echo", "$HOME"]`) and a Python list of arguments are explained as a program run with no shell.
- Nothing is taken as known in a script that reads a file with `. file` or runs text with `eval` that the tool cannot read, runs a function through a variable (`c=f; $c`), or has CR LF line ends. Rules on `rm`, `mv` and `cp` with an unquoted variable then give a Pitfall, not a Caveat.
- Fewer false warnings where bash may run the line fine: an interactive shebang (`#!/bin/bash -i`), the variables sudo sets itself, code read with `source`, a trap's action, and a file with no shebang that `.bashrc` may read; some are now caveats.
- `--check` no longer fails on what comes after a command that surely stops the script, such as pip's `exec` wrapper or `exit 0` before a payload. After one that only may stop it (`source`, `trap`, an `exit` in a function), `x = 1`, `[-f x]` and a syntax error are warnings.
- Worked examples print as the tools do: the digits of `printf` and awk, up to 10000 (`printf '%.200f' 1`; where they depend on the machine, the example says so), the longest match at the leftmost place in awk's `sub`, `gsub`, `match` and `split`, and a first stage whose words hold a backslash (`printf "%s\n" b a | sort`).
- `grep -oP 'a=\K\S+'` explains `\K` and the other PCRE escapes, and each tool's own escapes are read as that tool reads them (`awk '/\t/'`), and `tr -dc 'a-z'` says it keeps those characters and deletes the rest.
- `^` and `$` in `[[ =~ ]]`, awk and Perl say the start or end of the text; grep and sed still say the line.
- The note on `source lib.sh` suggests a path from the script's directory that holds when the file is itself sourced (`"$(dirname "${BASH_SOURCE[0]}")"/lib.sh`), and the note on a `grep` pattern from a variable no longer suggests `-F` when grep has other patterns.
- `terraform -install-autocomplete` and `-uninstall-autocomplete` are explained as options terraform takes. Before, they were said to stop it.
- A line whose regex or example would take very long (`grep -E '(a+)+$'` on a long text, a value that keeps doubling, a long `jq` sort) no longer stalls the editor or a CI job: a note says the result was not computed, and why, and the rest of the line is explained.
- A file nested too deep to read, a line too deep to follow, or a bug of the tool on one line stays in that line or file: the explanation says so, the rest is explained, and `bash-explainer` exits with status 2. Before, a file nested too deep stopped it with an empty output.
- In the panel, a blank line no longer draws an empty grey box, code that holds a backtick is one piece of code, and the box of a space at an end of a word stands on the line of the text, with its name. In VS Code, the text you read stays in place when the panel's width changes.
- The explanation stays as it is when a line's problems arrive a moment after the line: a fold held with Space still folds, and what you typed in an example's box stays.
- On the web page, "Clear stored data" resets the depth and the switch at once, the opening animation follows the Language setting, and hover cards no longer cover the line they explain. On a phone, the editor's code stays in view while you drag the explanation sheet.
- The panel reads messages only from its own origin, and shows a reference as a link only when its address is https.

[All changes](https://github.com/sf624/bash-explainer/compare/v0.9.1...v0.10.0)

## 0.9.1

Details and examples: [docs/changes/0.9.1.md](https://github.com/sf624/bash-explainer/blob/v0.9.1/docs/changes/0.9.1.md).

### Fixed

- The GitHub Action installs and runs the tool outside the checked-out repository. Its registry is the one your workflow or machine configures; npm settings kept in the repository no longer apply to it.
- The command-line tool shows control characters in a script visibly (`<ESC>`) instead of sending them to the terminal, and a newline in a file name (`<LF>`). Text that a CI log would read as a command (`##[`) is written `##\[`.
- `--sarif` does not write through a symbolic link at the last part of its path, and the GitHub Action writes the SARIF file only inside the workspace or the runner's temp directory when its path is in one of them. A path that leads elsewhere through a link fails with exit status 2.
- The GitHub Action checks only files inside the workspace. Any other file that `files:` matches, by its path or through a symbolic link, is skipped with a notice that names it.
- After `--`, a file named `--lsp` or `-` is read as a file.

[All changes](https://github.com/sf624/bash-explainer/compare/v0.9.0...v0.9.1)

## 0.9.0

Every warning the explanations give is now a problem with a code, a command name that does not run what it suggests gets a hint, code that never runs is faded, and the panel shows how bash reads the line, as the Bash manual does. Scripts can be explained for bash 5.3.

Details and examples: [docs/changes/0.9.0.md](https://github.com/sf624/bash-explainer/blob/v0.9.0/docs/changes/0.9.0.md).

### New

- Every warning and caveat the explanations point out (`x = 1`, `rm -rf $DIR/*`, `local x=$(cmd)`…) is also a problem with a code, in the Problems panel, `--check`, SARIF and the GitHub Action, also in the shell code of other files. Turn them off with `bashExplainer.diagnostics.pitfalls`.
- New warnings and caveats, among them: `curl … | bash`, a variable read while it is unset under `set -u`, a shebang whose options bash refuses (`#!/bin/bash -e -u`), `find . -exec rm {} ;`, a `trap` on `INT` that does not exit, an assignment to a read-only variable, and `cmd || echo "msg"` that turns a failure into success.
- A command name that does not run what it suggests gets a hint after it: a function or an alias that hides a builtin or a program, a builtin turned off by `enable -n`, `sudo cd`. Turn the hints off with `bashExplainer.hints.names`. In the panel, every command name has a badge: keyword, builtin, function, alias or program.
- Code that never runs is faded in the editor: a branch whose condition the script has already decided (`if false; then …`), the skipped side of `&&` or `||`, and what follows `exit` or `return`. In POSIX mode, a line where bash stops the script is a warning. Turn the fading off with `bashExplainer.hints.deadCode`.
- The new setting `bashExplainer.bashVersion` (`--bash-version`, the Action's `bash-version`) explains scripts for bash `5.2` (the default) or `5.3`: `${ cmd; }`, `${| cmd; }`, and what bash 5.3 changes in builtins, variables, `printf` and `[ ]`. **Compatibility:** with the default `5.2`, a bash 5.3 construct (`${ …; }`, `${| …; }`, `shopt -s array_expand_once`) is now a warning, and `--check` exits 1; set `bashExplainer.bashVersion` to `5.3` to explain it as bash 5.3 runs it.
- The panel has a **Reading** view: who reads each part of the line, from bash's own reading to each command and each language inside a word, built up in eight steps.
- Meaning shows the value an expansion has where the script sets it for sure (`msg="hello world"; echo $msg`), and the worked examples use it. A brace sequence names its start, end and increment, and `$1` in a string another shell runs says which word it starts as.
- A note that rests on bash's behaviour rather than the Bash manual says so with a chip, with a command to try in your terminal; turn the chips off with `bashExplainer.notes.basis`. A new note says that `$BASH_SUBSHELL` does not count the subshell of a pipeline stage.
- The new setting `bashExplainer.panel.colors` colours the panel like your editor theme. In a remote window (WSL, SSH, a container), Bash Explainer now runs on your local machine, where the themes are.
- Rows in the panel grow and shrink as you fold them, and the row you fold stays where it is on the screen. Turn the motion off with `bashExplainer.panel.animations`.
- The web page opens and saves files (`Ctrl+O`, a drop, `Ctrl+S`), shows a word's card on hover as VS Code does, and sets the file kind of a pasted script from its content. It opens with its logo and a line of shell read as the explainer reads it.
- In bats files, each test is explained as bats runs it (in a process of its own, with `set -e`, after `setup`), with the tag comments, functions marked `# @test`, and the helpers of bats-support, bats-assert and bats-file.
- Worked examples of pipelines start from made-up lines in the real layout of `ps aux`, `ls -l`, `df -h` and others, name the command their input comes from, and mark what the next command reads.

### Changed

- Notes say how much they matter: ⚠ **Pitfall**, ⓘ **Caveat** or ⓘ **Portability**, in the editor's warning or info colour. Some squiggles change colour: an unquoted path given to `rm` is now a warning, and a Dockerfile pipe without pipefail is now information.
- The hover explains the part under the mouse; the whole line opens with `Ctrl+K Ctrl+E` or the hover's **Whole line** link. The Language Server's hover starts with the part too.
- **Compatibility:** the inline summary at the end of the cursor line was removed, and `bashExplainer.inline.*` no longer has an effect. Use the hover, `Ctrl+K Ctrl+E` and the name hints instead.
- **Compatibility:** `bashExplainer.highlight.enabled` is now `true` by default, also in the Language Server (before, `false`). Syntax colouring follows the explanations (aliases, read-only variables, words read as data), and leaves Python files and Dockerfiles to their own language servers.
- **Compatibility:** `--check` prints the new pitfalls but exits as before: their warnings fail it only with the new `--strict` (the Action's `strict: 'true'`), the Action's `warnings` output still counts only what fails the step, and its new `pitfalls` output counts the pitfalls. In the JSON output, an alias's token `kind` is now `alias` (it was `function`).
- Meaning and Reading show lists as the manual reads them: the commands joined by `;` and `&` make one list. Reading also names and groups each construct as the Bash manual does and cites its section (`time` and `!` start one pipeline), with a row for every reserved word and operator. Every variable of bash's says what it is; before, 85 had no explanation.
- The fixes that notes suggest are written for your line, not as a pattern: `local x; x=$(cmd)`, `re='\bfoo'; [[ $x =~ $re ]]`, `for f in "$@"`, `"$DIR"/*`.
- Some explanations read more clearly: `IFS=$'\n\t'` names its characters one by one, a brace expansion's words are chips, a special builtin's badge says so, and the shebang says it works only when the file is run as a program.
- A new logo, a speech bubble of `[ ]` around `>_`, on the extension, the panel, the web page and the README. The panel's header is a toolbar of icon buttons, as in VS Code's own views, and the web page has the same icons.
- On the web page, the address bar no longer shows the script (share links still work), changing the file kind loads its sample (and asks first when the editor holds your own script), the Problems list starts folded on a phone, and the release page's menu no longer has the Version switch.

### Fixed

- Words are expanded as bash does in more places: with the shell options and the `IFS` in effect (`**` without `globstar`), in `case` patterns, a tilde after `:`, sequences past the limits of the bash release, line continuations. In scripts for dash, POSIX sh and busybox ash, `{a,b}` is plain text, as those shells print it; dash also prints `$'…'` as text, and in sh its value is not known, and zsh scripts are no longer said to split an unquoted variable.
- Tests, redirections and builtins are explained as bash runs them: `[ 08 -eq 8 ]` is true, `cat <<A <<B` reads only `B`, `exec >log 2>&1` applies to the shell, `exit 1 2` goes on, and `builtin cd` is the builtin itself. Every option of bash's builtins, and every `shopt` option, is explained.
- Meaning gives no value, and decides no condition, where bash may skip a command or the script does what the model does not follow (`shopt -s compat31`, `set -k`, a redirection that fails, `[ -v "$1" ]`). Before, it could show a wrong value or say that code never runs.
- Fewer wrong pitfalls: `echo ===` is not taken for `x = 1`, `rm -rf $DIR/*` is no warning when the script set `DIR`, and an `alias` in a file with no shebang (it may be sourced) or a variable that may come from the environment gets a caveat, not a warning. Each unquoted variable gets its own note, and pitfalls are found under `sudo`, `xargs` and a quoted command name too.
- Options and operands are read as each tool reads them: `docker run -it` is `-i -t`, `tar vf`, `ps u1`, `git log --format %H` (a value only after `=`), `sed -e … -E`, `sudo -c`. A word past the operands (`diff a b c`) is an extra operand the command refuses, and find reads its words after quote removal and refuses a path after its expression.
- Worked examples follow the line and print as the tools do: `date -d 2024-01-02 +%A`, `TZ=… date`, `sort -h`, `printf '%s\n' {a,b}`, `git log --graph`, `sed -n` with `q` or `n`, and a quoted command name (`\sort`).
- Shell code in other files: a YAML block (`run: |`) is read without its indentation, each workflow step, Dockerfile `RUN` and Makefile recipe line is a shell of its own, and notes name the right line. Before, an indented `EOF` did not end a here-document, and `set -u` in one step counted in the next.
- The panel and the web page work with the keyboard and a screen reader: Meaning folds with buttons, a problem opens with Enter, and `F6` goes between the editor and the explanation.
- In the panel, a long label no longer squeezes its explanation, a click on a row of another line only folds it, and the hover no longer repeats a problem VS Code shows above it. A control character in a value is a box with its name (`LF`, `TAB`). The quick reference lists every command; before, it stopped after 300.
- Other languages' semantic colours are no longer changed by ours (a TypeScript parameter was drawn in keyword blue). The web page keeps the phone layout at every zoom, and its tab icon is legible in a dark browser theme.
- The Marketplace, Open VSX and npm pages show the images and links of the version they describe. Before, they showed the newest images from `main`, and one was missing.
- A long pipeline is explained at once; before, 20 stages took about 30 seconds. Lines being typed (`echo > >g`, `cat <<`) and words such as `toString` no longer make the explanation fail.

[All changes](https://github.com/sf624/bash-explainer/compare/v0.8.0...v0.9.0)

## 0.8.0

Strings that a command runs as a script and bats test files are explained, conditions that the script's own values decide say which code never runs, and worked examples read and print as the tools do.

### New

- A string that a command runs as a script is explained as one: `bash -c '…'`, `sh -c`, `eval`, a trap's action, `su -c`, `ssh host '…'` and `watch '…'`, also under `sudo`, `xargs`, `find -exec`, `docker exec` and `kubectl exec`. Its commands and expansions appear at their own characters, its notes are those of the shell that runs it (an `sh -c` string gets the POSIX checks), and the Problems list shows its dialect issues. What a static `eval` string or a trap's action sets counts after it. A string with an expansion (`eval "$cmd"`) says its text is known only when it runs. Before, such a string was one opaque argument.
- New notes on conditions that the values the script set decide: "`$mode` is `fast` here, so this condition is always false: the commands after its `then` never run", or "so only `fast)` of this `case` runs". Expansions such as `${x:-default}`, `${x#prefix}` and `$(( ))` are read as bash expands them. Conditions of literals only (`while true`, `if false`) say nothing more.
- bats test files (`.bats`, or a `bats` shebang) are explained: `@test "…" {`, `run`, `load`, `skip` and the other bats commands, with pitfalls for a `! cmd` that cannot fail a test and for `run` in a pipeline. VS Code, the Language Server, the command-line tool (`--kind bats`) and the web page (with a bats sample) recognise them. Before, `@test` was a syntax error and `run` an unknown command.
- `env -S` is read as GNU env reads it. A shebang `#!/usr/bin/env -S bash -e` runs `bash -e` with the script. `#!/usr/bin/env bash -e` warns that Linux passes `bash -e` to env as one word, which fails. An `env -S` string is split as GNU env splits it (quotes, `\_`, `#` comments, `${NAME}`), and a string env refuses gets a warning that it exits with status 125.
- `ksh93`, `mksh`, `lksh`, `pdksh`, `oksh`, `posh`, `yash` and `ash` (also by path) take the options of `sh`: `mksh -c '…'` runs the string as a script. Before, such a name was an unknown command.
- A note says when a command does not read the standard input the line gives it, because it reads the files it names: `jq . a.json < b.json` reads only `a.json`.
- The command-line tool takes `--sarif <file>` with `--check`: it also writes the problems to that file as SARIF. The GitHub Action uses it, so it checks the scripts once for both the annotations and the SARIF file.

### Changed

- **VS Code settings:** a setting set below its minimum (`bashExplainer.inline.maxLength` under 20, `bashExplainer.hover.maxDepth` or `hover.followDelay` under 0) now uses its default, as the command-line tool already did. Before, VS Code used the number as given.
- A branch that cannot run, because the script's own values decide its condition, no longer changes how later lines are explained: after `x=1; if [ "$x" = 2 ]; then set -f; fi`, a glob is a glob again. Code after `break`, `continue`, `return` or `exit` no longer counts either. Before, both sides of every branch counted, so such lines said "may" or "on some paths". In a script that runs code that cannot be read (`source`, `eval "$s"`, `$cmd`, `${!v}`), both sides still count.
- The worked examples' sections say what the command reads and where from: "Input: `a.json` (sample contents)", "Input: stdin (sample output of the previous command)", "Input: files matching `*.json`". A section that is not read is no longer called input: `date +%F` says "When it runs (made up, UTC)". Before, every such section was called "Input" (or "Date and time (UTC)").
- The colours of the parts of a line (command, option, variable…) are readable as text: light themes use darker colours of the same hues (at least 4.5:1), high contrast themes their own (7:1), and errors a red that passes too. The web page has the same colours. Before, they were VS Code's chart colours, as low as 2.9:1 on white.
- On the web page, changing the file kind keeps the text, also an untouched sample. "Load the sample" loads the current kind's sample, with an "Undo" button when it replaces your own text. Before, choosing a kind replaced an untouched sample, and "Load the sample" could be undone only with Ctrl+Z.

### Fixed

- Worked examples print the output as the tools print it. jq uses two spaces a level (one line with `-c`; `--tab`, `--indent n` and `-S` are followed), and reads `-R`, `input` and `inputs`. mikefarah/yq prints JSON as yq does, reads a `.json` file as JSON, prints strings bare with `-r`, and shows with `-i` what the first file becomes. awk gives `FILENAME` the name of each file. `sort -o` and `uniq in out` show what is written to the file. Before, jq and yq printed every result on one line, and `FILENAME` was empty.
- Worked examples read what the command really reads. A here-string, a here-document or a pipe of known text is the input itself (`echo '{"a":1}' | jq .a`). `jq -n` and an awk program of `BEGIN` rules only show no input. Several files (`sort a b`, `head -n 1 a b`) show a section each. `cat` and `nawk` get real examples. Before, the example made up one input for all.
- Worked examples follow the command's options. `grep -e -v foo` searches for `-v`, `sed -ie 's/a/b/' -e 's/c/d/' f` runs only `s/c/d/`, and `find … -exec cmd {} '+'` runs the command once. A line the tool refuses (`grep -E -F`, `tar -c -x`, `seq 1 -w 3`) says so and gets no example. A function or alias of the script named like a program (`sort() { tac; }`) no longer shows that program's output. Before, these examples showed what the tool does not do.
- Options are read as each tool reads them. GNU tools (`grep`, `sed`, coreutils, `diff`, `gzip`, `tar`) accept a long option's unique prefix (`ls --almost` is `--almost-all`) and know every long option of their `--help`. `test` reads no options, `xargs --max-lines echo` runs `echo`, `perl -0ne` is `-0 -n -e`, and `bash -O extglob -c '…'` and `bash --posix` are known. Global options are told apart from a subcommand's (`docker -H h run`, `kubectl -o yaml get pods`). Before, many of these were "not in the dictionary" or taken for values.
- Explanations match bash in more places: `x=1 ''` does not set `x`, `exec {fd}>file`, `wait -p var` and `coproc name` set their variables, and a division by 0 in `$(( ))` discards the rest of the line. `unset f` removes the function when there is no variable `f`. `exec cmd` in `( )` ends only the subshell. `cmd &> >(tee log)` sends both outputs to the process substitution; before, it was read as an argument, or as a syntax error after a block or a loop. In the body of `for (( i = 0; … ))`, `$_` is no longer said to be empty.
- `[`, `unset` and declarations are explained as what bash runs, however they are written: `\[ -f x ]`, `command [ -f x ]`, `x=1 unset x`, `\declare a=$v`. `[ -f x` with no `]`, and words `test` cannot read (`[ a b c d ]`), say that the command fails with status 2. `unset 'a[1]'` removes an element, and an unquoted `a[1]` is a glob first. Where aliases are expanded, an alias named like a builtin runs the alias. Before, these forms were "not in the dictionary" or explained as working, and `unset` of a read-only variable said it removed it.
- Redirections are read wherever they are written: before the command's name, among its words, and between assignments (`a=1 >f b=2`). A command of only redirections and assignments has the status of the last `$( )` in its redirections, so `x=1 >f$(false)` fails. A pipeline stage that sends its output to a file (`>out grep x in | sort`) gets no example of the whole pipeline. Before, a line such as `a=1 >f b=2` left the whole script unexplained, and such commands had the status 0.
- The ⚠ notes follow what bash does here. After `IFS=; set -f`, `cp $a b` no longer says `$a` is split. A variable set by `printf -v` or `mapfile` at the end of a pipeline is reported as lost. The pitfall for a variable another shell does not have sees `\$n` in `bash -c "echo \$n"`, and knows that `env -u x` removes `x`. `egrep -q` counts as `grep -q`, and an alias of `rm` as `rm`.
- The "Idiom" notes are read from the commands, not from the text, so other spacing, order and quoting are found (`while  true ; do`, `done <f`, `trap cleanup 0`). They are no longer given where bash does something else: `trap - EXIT` sets no clean-up, `while [ $# > 0 ]` writes to a file named `0`, and text in quotes is not run.
- The shell a script runs in is read in more places. In a GitHub Actions workflow, `shell:` counts above `run:`, and `defaults:` or `runs-on:` count after the steps. A Dockerfile or Makefile `SHELL` and a Python `executable=` are read as the same shell everywhere: `SHELL ["/bin/dash","-c"]` is dash. Busybox shells (`RUN ["busybox", "sh", "-c", …]`, `# shellcheck shell=busybox`) are ash. Before, these were ignored or misread, and the script was explained as bash or sh.
- A script is in POSIX mode only when its shebang really starts bash in it (`#!/bin/bash --posix`, or `env -S` with `bash --posix`). Before, `--posix` anywhere on the shebang line counted, also in `#!/usr/bin/env bash --posix`, where bash does not start.
- With `notes.pitfalls` off, more ⚠ notes are hidden: those for distribution aliases, `\b` in `[[ =~ ]]`, a Dockerfile `RUN` without `pipefail`, Python `subprocess`, GitHub Actions `${{ … }}` injection and bats files. Before, these ignored the setting.
- Quick fixes are offered in every language of the `bashExplainer.languages` setting, as the hover is. Before, they were offered in `shellscript` documents only.
- On the web page's compare view, the Problems list shows the script's problems. Before, it stayed empty and the page raised an error.
- Scripts that assign an element before a function (`n[0]=5 f`) are explained; before, explaining them failed. A long chain of functions that call each other in `$( )` is explained at once; before, 40 of them froze the explanation for about a minute.

[All changes](https://github.com/sf624/bash-explainer/compare/v0.7.0...v0.8.0)

## 0.7.0

Explanations follow the script as bash runs it and cite the Bash manual; the web page is redesigned for phones and gets the extension's settings.

### New

- Explanations cite the GNU Bash Reference Manual (bash 5.2): a "Bash manual 3.7.2" link in VS Code's hover, a "§3.7.2" link in the panel and on the web page, and the section numbers in the command-line tool's text, Markdown and JSON output.
- The shell state is followed in the order the script runs: `set` and `shopt` options, variables (also those set by arithmetic, such as `(( i++ ))` and `let`, with their values when known), functions and aliases. A subshell keeps its changes, a function's body counts where it is called, and an option set only in a branch "may" be on. Before, anything earlier in the text counted, even in a subshell or a function that never ran.
- New notes on which command really runs: a function that replaces a builtin or a program (and how to reach the other with `builtin` or `command`), `enable -n`, `hash -p`, special builtins in POSIX mode, names that may come from a `source`d file, and functions defined in a subshell or removed with `unset -f`.
- New notes on subshells and other shells: `cd`, `set -e` or `exit` in a subshell only change the subshell, and `$$` there is still the script's PID. Code run by `bash -c`, `sudo`, `su -c`, `ssh` or `docker exec` gets a pitfall when it uses a variable or function of the script that the new shell does not have, with the fix (`export`, `export -f`, or passing `declare -f`).
- New `set -e` notes: `x=$(cmd)` stops the script on failure but `local x=$(cmd)` does not; a pipeline without `pipefail` hides a failure; a function ending in `test && cmd` returns the test's failure; and the places where bash ignores `set -e`.
- Idiom notes for `getopts`, `getopt` with `eval set --`, `while [ $# -gt 0 ]`, `read -d ''`, `find -print0` / `xargs -0`, `mapfile`, `read -p`, and `while read … done < file`, whose redirection is now explained on the loop's first line.
- Syntax colouring from the same tree as the explanations. The web page uses it always, in the explanation panel's colours, so a word has the same colour in the editor and in the explanation; VS Code and the Language Server send it as semantic tokens with the new setting `bashExplainer.highlight.enabled` (off by default). Heredocs end where bash ends them, so the code after one is no longer coloured as a string.
- The command-line tool reads a settings file with the keys of VS Code's `settings.json` (`--config`, `$BASH_EXPLAINER_CONFIG` or `~/.config/bash-explainer/settings.json`), with `--set key=value`, `--no-config` and `--print-config`. The Language Server takes every setting that applies to it, and reads the same file. Before, only the language, the shell and the examples could be set.
- The web page has a settings sheet (the gear) with the extension's settings that apply there, including notes, warnings, kinds of examples and your own commands. Settings can be exported as a `settings.json` file for VS Code or the command-line tool, and imported back; "Clear stored data" forgets everything the page keeps in the browser.
- On a touch screen, the web page has a read mode: taps move the cursor without opening the keyboard (a tip points to it the first time). A new "Wrap long lines" setting avoids sideways scrolling, and the Problems list can be resized and folded.

### Changed

- **Your own commands:** `bashExplainer.customCommands` now takes options as a list (each with its `names`) and operands as a list (with `"repeat"`), plus an optional `style` and `subcommands`. The old shape still works but is deprecated, and a later release drops it. A custom command now follows only what the setting says: one named `head` no longer reads `-5` as `-n 5`.
- Markdown code blocks tagged `sh` or `shell` are read as bash unless they start with a shebang, so they no longer get POSIX sh warnings. To check a block as POSIX sh, start it with `#!/bin/sh`.
- The web page is redesigned: it fits the window, with the editor and the explanation in panes and a draggable divider between them. A compact top bar replaces the toolbar and footer; a menu slides in from the left and the settings from the right (also with swipes), and slide out again when closed with ×, Esc or a tap beside them. The explanation panel's header moved to the page: "Collapse all", "Quick reference" and "Copy as Markdown" are buttons in the top bar, and the shell and yq are in the menu (and the top bar on a wide window). The file kind is a compact button with a list in the top bar. On a phone the top bar shows the logo and the name "Bash Explainer", and the file kind, the copy and the link are in the menu; on a touch screen the quick reference no longer opens the on-screen keyboard (VS Code's panel is unchanged).
- The web page remembers the language, shell and yq you chose. Before, they were reset on each visit.
- In the panel, the current line stays at the top while the explanation scrolls. Clicking a row of an `if` or a loop no longer moves the cursor to its last line, and clicking a row scrolls a long line sideways to that part.

### Fixed

- Explanations match bash in more places: `~` after `=` and `:` in assignments and assignment-like arguments, `nullglob` / `failglob` / `GLOBIGNORE`, `set -f` on some paths, ambiguous redirection targets (`> *.log`), no globbing in `x=*.txt`, no word splitting in `<<< $x` or `${s:$i}`, unquoted patterns in `case` and `[[ ]]`, `a=(x)y`, and `$_`.
- Words a command passes to another command are read as that command reads them: `ssh host ls -l`, `flock f -n true`, `bash -ex script.sh -x`, `sh -s -- --prefix x`, `env -S`, `sudo -i cmd` and `watch cmd`. Options written with quotes or expansions (`ls "-l"`, `ls -$opts`) are options; abbreviated long options are read when the tool accepts them, and ambiguous ones are shown as such.
- Options of specific tools are read as the tools read them, among them `git`'s global options, `ip`'s abbreviations, `ps`, `kill`, `trap`, `declare`, `pushd`, `exit -1`, `command -v`, `timeout`, `locate -r`, `ar` and `/bin/echo` or other builtins run by path.
- Editing an example's input in the VS Code panel updates the output again when the command has a variable (such as `"$f"`). The `xargs -0 -I{}` example runs once per name, and `jq 'def g(x'` no longer stops the explanation.
- A Dockerfile `RUN` warns about a pipe without `pipefail` unless `set -o pipefail` runs before the pipe; before, the word `pipefail` anywhere in the `RUN`, even in a comment, silenced it.
- On the web page, the Problems list shows `code` as code instead of raw backticks.

[All changes](https://github.com/sf624/bash-explainer/compare/v0.6.0...v0.7.0)

## 0.6.0

Wrappers and builtins are read correctly, labels show a construct's shape, and the web page gets a theme switch, a development version and a better phone layout.

### New

- Notes on wrappers (`sudo`, `env`, `timeout`, `xargs`, `find -exec` and others): they start a separate program, so a builtin such as `cd` or a function of the script cannot run there, with the fix. Also new: `FOO=1 echo $FOO` expands `$FOO` first, `ssh host ls $HOME/*.log` is expanded locally, and `{ echo a; echo b }` lacks a `;`.
- New notes: `((i++))` with `i` at 0 fails under `set -e`, `exit 256` wraps to 0, `local` outside a function fails, and a missing `;` before `then` or `do` is a syntax error. `[ ]` gets pitfalls for `[-f x]`, `[ -f x]`, `[ $a < $b ]` and `[ a && b ]`, and `[[ $x =~ \bfoo ]]` warns that bash removes the backslash.
- The example of a jq or yq filter with pipes shows the data after each stage, as shell pipelines do.
- Escape sequences are named (`\033` is ESC), and `printf` colour codes are explained as ANSI sequences ("bold, green foreground"), also in `echo -e`, `$'…'` and sed.
- GitHub Actions: about 50 `github.event.…` fields and more contexts are explained, and the script injection warning covers more fields.
- The web page has a theme switch (Auto, Light, Dark), a development version at <https://sf624.github.io/bash-explainer/next/> with a "Version" switch, and a page that compares two versions side by side.

### Changed

- Labels show a construct's shape instead of its text cut short: `if` *condition* `then` *commands* `fi`, `for` `f` `in` *words* `do` *commands* `done`. A simple command is labelled with its name, and an explanation no longer repeats its label.
- A subcommand (`git log`, `docker run`) is a token of its own, coloured as a command, with a note that to the shell it is an argument.
- `[ … ]` is shown as the command `[`, with `]` as its last argument, and `[[ ]]` as shell syntax.
- A glob is explained the same way everywhere (arguments, `case`, `[[ ]]`, `${x#pat}`, `find -name`), part by part, with matching and non-matching values.
- Positional arguments are described by their count (`seq 5` vs `seq 2 5`, the destination of `cp`), and options say "the given directory" instead of "this directory".
- The example of a whole pipeline picks sample lines so that every stage changes something.
- In the panel, a click anywhere on a row folds it, folds survive a redraw, and guide lines join items of the same level.
- On a phone, tapping the explanation no longer opens the keyboard, the toolbar fits in three rows, and long labels are no longer cut in a narrow panel.

### Fixed

- The command a wrapper runs is found correctly: `bash -c '…' a b` (`a` is `$0`), `kubectl exec pod -- ls`, `docker run image cmd`, `timeout 5 cmd`, `env A=1 cmd`, `nice -10 make` and `su - user`.
- Builtin options are complete and read correctly (`kill -TERM`, `wait -p`, `read -N`, `export -n`, `declare +x`, job specs like `%1`), and so are declarations, aliases, special builtins, `>&` and `test`.
- Shell-language explanations were audited against bash 5.2: `"$@"` is one word per element, `${1:=x}` fails, and here-documents, `{ }` in pipelines and IFS are among those corrected.
- Options of external commands are read correctly in more places (`kubectl logs -f`, `git tag -a`, `rpm -ivh`, `date -Iseconds`…), including values glued on and partly quoted (`awk -F'|'`, `cut -d','`).
- jq: every option is known (`--arg` no longer takes the filter's place), `-s` and `-j` change the example, and destructuring and `label` are explained.
- Examples match GNU sed, awk, `printf`, `find` and `date` in more cases, for example `s/x*/-/g`, `-mtime +7`, `-size -1M` and `%3N`.
- On the web page, a selection within the current line is highlighted.

[All changes](https://github.com/sf624/bash-explainer/compare/v0.5.0...v0.6.0)

## 0.5.0

A new parser makes the extension smaller and faster and reads scripts as bash does; about 400 more commands are explained.

### New

- About 400 more commands, with their frequent options: those in the LPIC-1/2 and LinuC-1/2 objectives (`fdisk`, `lvextend`, `rpm`, `nmcli`, `firewall-cmd`…), basic ones (`man`, `locate`, `tmux`…) and common macOS tools (`open`, `pbcopy`, `launchctl`…). Options that only some implementations have say which.
- Options written without a dash are explained letter by letter: `tar cvzf a.tgz dir`, `ps aux`, `ar rcs`.
- A script with Windows line endings (CRLF) gets a `crlf` warning: bash reads the CR as part of each line's last word.
- More of bash is explained: `{fd}>file`, `n>&m-`, `coproc`, `${s~~}`, `${!prefix@}`, `local -n`, `PIPESTATUS` and `BASH_REMATCH`, `;&` and `;;&` in `case`, numbers in other bases, the comma operator, `declare -i`, `let`, `~` in arguments, and brace expansion.
- New notes: the `IFS` an expansion splits on, `[ ]` reading only integers for `-eq` while `[[ ]]` does arithmetic, `z=2 echo $z`, and `$[…]` being obsolete.

### Changed

- The parser is now [unbash](https://github.com/webpro-nl/unbash) instead of tree-sitter-bash. The `.vsix` is a quarter smaller (703 KB, was 947 KB), the web page downloads 1.5 MB less, large scripts parse about three times faster, and an unfinished script is explained with the parts it has.
- A command with redirections shows the command and each redirection side by side, so the description and example are on the command itself.
- An alias or function applies only after its definition runs, as in bash. Before, it applied to the whole file.
- `set -f` turns off glob explanations until `set +f`, and `=` in `[ ]` is explained as a plain string comparison (the glob note is only for `[[ ]]`).

### Fixed

- Scripts the old parser misread are read as bash reads them: `cat <<EOF; cmd`, `for i do`, `<<-` with tabs, a redirection after the last command of a pipeline (it belongs to that command), `! a | b`, `time cat f | sort`, code after a here-document's delimiter, and multi-line `case` patterns.
- `set -eou pipefail` keeps every option, and the "strict mode" note is found in any order.
- Parameter expansions are explained correctly in many more forms, among them `${#}`, `${*: -1}`, `${!#}`, `${p//\//_}`, `${u-'x'}`, `${a[@]@K}` and `"$@"x`.
- Patterns and quoting: bracket expressions like `[]a]`, extglobs in `${…}`, a quoted right side of `==` or `=~` (literal text), backquotes inside double quotes, and words such as `e\cho` that spell a command.
- Arrays: keys with spaces or quotes, `a[1]+=x`, and associative keys versus evaluated indexes.
- Explanations that used to fail or show a wrong output no longer do: `${x@Z}` is a bad substitution, and `seq` alone or `printf` with raw bytes gets no example.
- Builtins read options only up to the first operand (`echo a -n`), and `printf` values such as `-0` are values.

[All changes](https://github.com/sf624/bash-explainer/compare/v0.4.0...v0.5.0)

## 0.4.0

Pitfalls for globs, pipes and aliases, CI variables, and examples that match the real tools more often.

### New

- Pitfalls: `for f in *.log` runs once with the pattern when nothing matches; a variable set after a pipe (`… | while read`) is lost; aliases need `shopt -s expand_aliases` in scripts; `**` needs `shopt -s globstar`.
- Extended globs (`!(*.txt)`, `*.@(jpg|png)`) are explained part by part, with a pitfall when `shopt -s extglob` is missing or comes too late.
- Glob examples follow `dotglob`, `nocaseglob` and `nocasematch` when the script sets them, and `shopt` options are explained.
- Variables of CI systems (GitHub Actions, GitLab CI/CD, CircleCI, Jenkins, Bitbucket, Azure Pipelines), GitHub Actions contexts, Azure macros and Jenkins' `${env.X}`.
- `time` is explained as bash's keyword; it was an unknown command.
- About 70 more commands that distributions install by default (`flock`, `journalctl`, `ping`, `lsof`, `crontab`…).
- Aliases that distributions define for interactive shells (Ubuntu's `ll`, Fedora's `l.`…), with a note that scripts do not have them.
- The web page's sample is a tour of every feature.

### Fixed

- `[ ]` with `-a` and `-o`, and `[[ ]]` with `=`, `=~` and `!` next to `&&` and `||`, are grouped as bash groups them; `${s:$i}` is no longer a syntax error.
- `${a[@]:1:2}` takes elements, not characters; `FOO=1 2>/dev/null` is an assignment; `exec 3>&-` closes the descriptor; `$"…"` and `unset` are explained.
- Examples match GNU sed, gawk, perl, jq, grep, sort, `git log` and `printf` in more cases, and get no example where the real tool would fail.
- Host files: a Jenkinsfile `sh` step's shebang, a GitHub Actions step's own `shell:`, Dockerfile exec-form strings with `\n`, and Python calls with comments are read correctly.
- The `rm -rf "$DIR"/…` pitfall no longer fires on `$$`, and `select` and `read -n1` are noted in shells that lack them.

[All changes](https://github.com/sf624/bash-explainer/compare/v0.3.0...v0.4.0)

## 0.3.0

About 145 more commands, pitfalls pointed out where they appear, and more CI systems.

### New

- About 100 more commands and builtins, chosen from a survey of shell scripts, Dockerfiles and workflows in popular repositories: package managers (`apt-get`, `apk`, `dnf`, `brew`, `pip`), users and groups, services (`systemctl`), signatures and checksums (`gpg`, `openssl`), compression (`xz`, `zstd`), toolchains (`go`, `cargo`, `node`), `gh`, `shellcheck` and more, plus frequent options of known ones.
- About 45 more from a second survey of operations and cloud scripts: `kubectl`, `helm`, `terraform`, `aws`, `gcloud`, `az`, `podman`, `envsubst`, `dd`, `iptables`, `ssh-keygen`, `pnpm`, macOS's `defaults` and more. Across both surveys, about 90% of the commands met are now explained.
- Pitfalls are pointed out where they appear, with how to avoid them: `x = 1`, `rm -rf $DIR/…` with an empty `DIR`, unquoted variables, `for f in $(ls)`, `read` without `-r`, `local x=$(cmd)` and `sudo cmd > /etc/…`. Turn them off with `bashExplainer.notes.pitfalls`.
- More CI systems: Jenkinsfile `sh` steps, CircleCI `run:` steps with `command:`, and Azure Pipelines `script:` and `bash:` steps (`$(variable)` macros are not command substitution). The web version and the command-line tool (`--kind jenkinsfile`) read Jenkinsfiles too.

### Changed

- `date +FORMAT` gets a worked example at two fixed moments (in UTC), instead of the note "right now this prints…", so the same line always gets the same explanation. Turn it off with the `date` kind in `bashExplainer.examples.disabled`.
- Code that is not shell is no longer explained as shell: `actions/github-script`, `run:` steps on Windows runners (unless `shell: bash`), and Dockerfile stages that use PowerShell or cmd.
- The parser is updated to tree-sitter-bash 0.25.1. Explanations of bash scripts stay the same; syntax it cannot read, such as zsh-only code, may be split up differently.

### Fixed

- `terraform -var-file=x` and `go test -count=1` (single-dash long options with `=value`), `head -1` and `git log -3` (read as `-n N`), and `sed -i.bak` (a backup suffix) are read correctly.
- `gawk`, `mawk` and `nawk` are explained as `awk`; a step's `shell:` written after `- run:` is taken into account; Dockerfile `SHELL` applies until the next `FROM`.

[All changes](https://github.com/sf624/bash-explainer/compare/v0.2.0...v0.3.0)

## 0.2.0

A command-line tool, a Language Server and a GitHub Action.

### New

- A command-line tool, the npm package [`bash-explainer`](cli/README.md): `npx bash-explainer deploy.sh:12` explains lines in the terminal (text, Markdown or JSON), and `--check` reports what the script's shell lacks, as compilers print warnings.
- A Language Server for other editors: `bash-explainer --lsp` gives Neovim, Helix, Emacs and others the same hovers, warnings and quick fixes (see the CLI's README for the set-up).
- Checks in CI: `bash-explainer --check --format github` (annotations on the pull request) or `--format sarif` (code scanning), and the repository as a GitHub Action, `uses: sf624/bash-explainer@v0`.
- Works in VS Code for the Web: on [vscode.dev](https://vscode.dev) and [github.dev](https://github.dev).
- The web version now links to the licenses of the software it includes (CodeMirror and others), listed in THIRD_PARTY_NOTICES.md.

[All changes](https://github.com/sf624/bash-explainer/compare/v0.1.1...v0.2.0)

## 0.1.1

### New

- A [web version](https://sf624.github.io/bash-explainer/) to try Bash Explainer without installing it: paste a script and see the explanations, worked examples and warnings in the browser, for shell scripts and the other files the extension reads. It runs in the browser alone, like the extension, and can share a script as a link.
- The extension itself behaves as in 0.1.0. It is now tested in VS Code 1.85 (the oldest it supports) and the latest, on Linux and Windows, with checks that it opens no connection and starts no process.

[All changes](https://github.com/sf624/bash-explainer/compare/v0.1.0...v0.1.1)

## 0.1.0

First release.

### Explanations

- Line-by-line explanations of shell scripts in English and Japanese: commands and options (about 120 commands and builtins, with combined flags, option values and subcommands), operators, redirections and their order, `${…}` expansions part by part, control flow, and well-known idioms.
- The languages inside arguments: regular expressions (BRE, ERE, PCRE), sed scripts, awk programs, jq and yq filters, perl one-liners, `printf` and `date` formats, `find` expressions, `chmod` modes, `sort -k` / `cut -f` / `tr` sets, `getopts` / `getopt` option strings, and `git log --pretty` / `--date` formats.
- Worked examples with sample input and output, for regexes, sed, awk, jq, yq, perl, text filters, whole pipelines, expansions, `printf`, globs, tests, `xargs`, `read`, `getopt` and `git log`. They are computed by built-in code that the tests check against the real tools.
- Your own commands, described in `bashExplainer.customCommands`.

### Ways to show them

- A hover for the line under the mouse, or for the cursor line with `Ctrl+K Ctrl+E` (`Cmd+K Cmd+E` on macOS).
- A panel that follows the cursor, inspired by regex101: edit an example's input and watch the output change, with matches and capture groups highlighted; fold the tree, copy it as Markdown, switch the shell or yq for the file, and search a quick reference.
- An inline one-line summary at the end of the cursor line.

### Other shells and other files

- Constructs that POSIX sh, dash, ash, yash, ksh, mksh or zsh do not support are pointed out, and behaviour that differs from bash is noted. The shell is detected from the shebang, a `# shellcheck shell=` line or the file name.
- Shell code inside Dockerfiles, Makefiles, GitHub Actions and GitLab CI YAML, `package.json` scripts, Markdown code blocks and Python `subprocess` / `os.system` calls is explained too, with warnings about script injection, Docker `RUN` pipes without `pipefail` and Python commands passed without `shell=True`.
- yq commands are recognised as mikefarah/yq v4, kislyuk/yq or mikefarah/yq v3, with the first v4 release that has what the command uses.

### Problems panel

- Warnings in the Problems panel, with quick fixes where the rewrite keeps the meaning (`[[ ]]` → `[ ]`, `==` → `=`, `source` → `.`, `&>` → `> … 2>&1`, and more).
- `# bash-explainer disable=<code>` and `disable-file=<code>` comments, and `bashExplainer.diagnostics.ignore`, to silence them.

### Privacy

- Works offline by design: no network access, no AI, no telemetry, no external processes. A CI check keeps it that way.

[All changes](https://github.com/sf624/bash-explainer/commits/v0.1.0)
