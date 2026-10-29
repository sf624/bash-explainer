# Changes since 0.8.0, in detail

The short list is in [CHANGELOG.md](../../CHANGELOG.md#unreleased).

## New

### Name hints

A command name gets an inlay hint after it where it does not run what a reader would guess from the name (from the same facts as the panel's badge):

| Script | Hint |
| --- | --- |
| `cd() { builtin cd "$@"; }` then `cd /tmp` | `function, not the builtin` |
| `shopt -s expand_aliases; alias ls='ls -F'` then `ls` | `alias, not the program` |
| `enable -n echo` then `echo hi` | `program: the builtin is off` |
| `alias ls='ls -F'` in a script, then `ls` | `program: the alias is not expanded` |
| `sudo cd /root` | `program, run by sudo: usually there is none` |
| `builtin ls` | `nothing runs` |

A name the reader asked for gets none: `builtin cd`, `command ls`, `\ls`, `sudo echo`, `xargs echo`. The hint's tooltip says what runs, who runs it, what else the name is and what it does; a click opens the line in the panel. `bashExplainer.hints.names` turns the hints off, and VS Code's `editor.inlayHints.enabled` all inlay hints. The Language Server answers `textDocument/inlayHint` with the same hints (and asks the editor to refresh them when the settings change, if it can).

The web page's editor shows the same hints, muted after the name, on the lines in view: hover one for its tooltip, click it to explain its line in the panel. When long lines wrap, a long hint wraps with its line. `bashExplainer.hints.names` is in the page's settings too.

### Dead code faded

A statement the state model says never runs (`dead`) is a hint tagged `Unnecessary`, so the editor fades it:

| Script | Faded |
| --- | --- |
| `if false; then echo x; fi` | `echo x` |
| `x=1` then `if [ "$x" = 2 ]; then …; fi` | the body of the `then` |
| `exit 1` then more statements | the statements after it, as one range |
| `true \|\| echo no` | `echo no` |

The range is the whole statement, over its lines, and nothing inside a faded statement is faded again; statements that follow each other in a body are one range. A script the model cannot trust (a `source`, an `eval`, `$cmd`) has none. VS Code and the Language Server send it as a hint (`DiagnosticTag.Unnecessary`, code `dead-code`), and the web page's editor fades the text (opacity 0.5), with the message in the tooltip. It is not a problem: it is not counted in the Problems panel or list, `--check` or SARIF. `bashExplainer.hints.deadCode` turns it off; so does `# bash-explainer disable=dead-code`. The shell code of other files (a Dockerfile, a workflow) has none yet.

### Warnings and caveats as problems

Every warning (⚠) and caveat (ⓘ) that the explanation of a line points out is now a problem too; a plain fact (ℹ) is not, except the note that bash cannot read zsh syntax (`zshSyntax`), as before. Each has a code, shown in the Problems panel and in the output of `--check`, and its range is the part of the line it is about (the word `$DIR/*`, the `$(ls)` of a `for`, the whole `x = 1`).

```text
script.sh:2:10: info: Caveat: the output of $(ls …) is split on spaces and newlines, so file names with spaces break. Use a glob, as in for f in *.txt [for-over-ls-output]
script.sh:3:8: warning: Pitfall: if DIR is empty this becomes rm -r /*, deleting from the root. Write "${DIR:?}"/* to stop when it is empty [rm-empty-variable-root]
script.sh:3:8: warning: Pitfall: $DIR/* is not quoted, so a value with spaces or * is split into several arguments or expanded to file names, and this command then deletes or overwrites files it should not. Write "$DIR"/* [unquoted-variable-as-path]
script.sh:4:1: warning: Pitfall: x =… runs a command named x; it is not an assignment. Write x=… with no spaces around = [assignment-with-spaces]
```

Warnings, for what breaks the script as written or does damage that cannot be undone (the levels: [docs/design/note-levels.md](../design/note-levels.md)):

| Code | Example |
| --- | --- |
| `assignment-with-spaces` | `x = 1` |
| `bracket-no-space` | `[-f x]` |
| `bracket-close-in-word` | `[ -f $x]` |
| `and-or-in-bracket` | `[ a && b ]` |
| `redirect-in-bracket` | `[ $a < $b ]` |
| `brace-no-space` | `{echo a; }` |
| `brace-close-no-separator` | `{ echo a }` |
| `rm-empty-variable-root` | `rm -rf $DIR/*` |
| `prefix-assignment-expanded-first` | `FOO=1 echo $FOO` |
| `unquoted-variable-as-path` | `rm $f`, `mv $a $b`, `cp $src /tmp/` |
| `redirect-by-your-shell` | `sudo cmd > /etc/x` |
| `nounset-unbound` | `set -u; echo "$dir"` (information when only the command fails, `cat < "$f"`, and for a name in capitals, `echo "$CI"`) |
| `shebang-refused` | `#!/bin/bash -e -u` |
| `download-run-by-shell` | `curl -fsSL URL \| bash`, `sh -c "$(curl URL)"` |

Information, for what goes wrong only with some values, and where the damage is limited:

| Code | Example |
| --- | --- |
| `unquoted-variable-as-path` | `cat $f`, `cd $dir`, `chmod +x $f` |
| `for-over-ls-output` | `for f in $(ls)` |
| `for-over-unquoted-args` | `for a in $*` |
| `unquoted-variable-in-test` | `[ $a = b ]` |
| `read-without-r` | `read line` |
| `trap-goes-on` | `trap 'echo bye' INT` |
| `array-joined-in-assignment` | `args=$@`, `x=${arr[@]}` |
| `source-searches-path` | `source lib.sh` |
| `pattern-from-variable` | `grep "$USER" /etc/passwd` |

The other warnings and caveats of the explanations are problems as well. Among them:

| Code | Example | Level |
| --- | --- | --- |
| `keyword-needs-separator` | `if [ -f a ] then …` | warning |
| `bracket-missing-close`, `bracket-close-glued`, `test-malformed` | `[ -f a`, `[ -f a]`, `[ a b c ]` | warning |
| `unset-readonly`, `unset-function-and-variable` | `readonly x=1; unset x`, `unset -f -v x` | warning |
| `assign-readonly` | `UID=0`, `readonly x=1; x=2` | warning |
| `local-outside-function` | `local x=1` outside a function (information in a file with no shebang) | warning |
| `alias-not-expanded-in-script`, `distro-alias-in-script` | `alias ll='ls -l'` then `ll` in a script with a shebang (`alias-maybe-not-expanded`, information, in a file with no shebang); `ll /tmp` | warning |
| `extglob-turned-off`, `extglob-in-same-block`, `extglob-not-in-new-shell` | `shopt -u extglob`, then `ls !(a)` on a later line | warning |
| `variable-not-exported`, `variable-not-passed-by-wrapper`, `variable-not-in-remote-shell` | `x=1; bash -c 'echo $x'` (information for a name in capitals, which may come from the environment: `FOO=1`) | warning |
| `builtin-or-function-as-program`, `function-not-in-new-shell-export`, `function-not-on-remote`… | `f() { :; }; sudo f` | warning |
| `wrapper-assignment-expanded-first` | `sudo X=1 echo $X` | warning |
| `pipeline-subshell-variable` | `… \| while read -r l; do n=1; done; echo "$n"` | warning |
| `regex-backslash-dropped` | `[[ $x =~ \bfoo ]]` | warning |
| `posix-special-function-name` | `exit() { :; }` in sh | warning |
| `postfix-increment-status`, `postfix-decrement-status` | `set -e; i=0; (( i++ ))` (information without `set -e`) | warning |
| `declaration-masks-status` | `local x=$(false)` | information |
| `pipefail-missing` | `set -e; curl -s x \| sh` | information |
| `extglob-maybe-on`, `globstar-maybe-on` | `ls !(a)`, `ls **/*.sh` with the option turned on on some paths only | information |
| `unmatched-glob-runs-once` | `for f in *.log; do rm "$f"; done` | information |
| `script-last-test-returns-status` | `[ -f x ] && echo found` as the last line of a script with a shebang | information |
| `failure-reported-as-success` | `cp a b \|\| echo "copy failed"` as the last line of a script with a shebang | information |

- They follow the same settings as the other problems: `bashExplainer.diagnostics.ignore` and `# bash-explainer disable=<code>` leave one out. The new `bashExplainer.diagnostics.pitfalls` (default on) leaves all of them out. With `bashExplainer.notes.pitfalls` off, the explanations leave out their pitfalls, and so do the problems; the notes that say a line fails when it runs (`[` without `]`) stay.
- Three caveats stay notes and are not problems: `ssh-local-expansion` (`ssh host "echo $HOME"`: often meant), and `globstar-not-found` and `extglob-not-found` (`ls **/*.sh`, `ls !(a)` with no `shopt -s` before: the file may be read after the option is set). The panel, the hover and the CLI still show them as caveats. (To be confirmed by the maintainer.)
- A problem is said once for each part it is about, however many lines say it (a statement over several lines), and once for each part where it is about several (`cp $a b; cp $a c`). In VS Code and on the web page, the hover then leaves the note out of its card, since the problem above it says it.
- They follow the script's shell. In zsh, which does not split or glob an unquoted `$var`, `cp $a b` and `for a in $@` have none; `[ -n $x ]` keeps its pitfall, since zsh drops an empty unquoted word too, and says so. A line that zsh syntax leaves unreadable to bash gets none.
- The notes that name a host's placeholder (a Makefile's `$(SRC)`, read as `${SRC}`) name it as the file writes it, in the explanations too.
- They are found in shell scripts, in the strings a script runs as scripts (`bash -c 'x = 1'`, `eval '…'`, `trap '…' EXIT`), at their place in the string, and in the shell code inside other files (Dockerfiles, Makefiles, CI YAML, bats files…), at its place in the file (`bashExplainer.diagnostics.embedded` leaves those out).
- The note on a missing `;` before `then` or `do` now cites the manual's sections on loops and conditionals.
- **Compatibility:** `--check` prints these lines, but its exit status does not change: a warning on a pitfall makes it exit 1 only with the new `--strict`. The GitHub Action has a `strict` input (default `'false'`) for it; with a `package:` pin to a tool without `--strict`, the step fails and says so. Its `warnings` output counts the warnings that fail the step (those on pitfalls only with `strict`), as before; the new `pitfalls` output counts the pitfalls, warnings and notices. The annotations of pitfalls are titled `Bash Explainer (pitfall): <code>`, and `--format github` prints those that fail the check first, since GitHub shows only the first annotations of each kind in a step. SARIF has them as `warning` and `note` results. Before, `--check` reported only what the script's shell lacks and the risks in embedded shell code.

### Failures reported as success, files sourced from `$PATH`, patterns from variables

Three caveats asked for in the usability test of October 2026. What each says was checked in bash 5.2 and 5.3, and with GNU grep.

| Written | What it says | What bash or grep does |
| --- | --- | --- |
| `cp a b 2>/dev/null \|\| echo "copy failed"` as the last command of a script with a shebang (or one a host runs: a CI step, a Dockerfile `RUN`), or of a function; any `cmd \|\| echo "msg"` under `set -e` | When `cmd` fails, the script still ends with status 0 (the function returns 0, or `set -e` goes on): the status of `echo`, which succeeds. With `2>/dev/null` (or `&>/dev/null`), the command's own error message is gone too, so only the message says why. Write `… \|\| { echo "msg" >&2; exit 1; }` (`return 1` in a function). | `false 2>/dev/null \|\| echo x; echo $?` prints `x` and `0`; `set -e; false \|\| echo msg; echo after` prints both. |
| `cp a b \|\| echo "copy failed"` as the last command of a file with no shebang | "If this file is run as a script", the same. A file with no shebang may also be sourced, where `exit 1` would end the shell that sources it, so the fix is `… \|\| { echo "copy failed" >&2; return 1 2>/dev/null \|\| exit 1; }`: it returns when the file is sourced, and exits when it is run. The same form under `set -e` in such a file; in a function there, `return 1`, and `set -e` stops at the call. | Run (`bash f.sh`, or `./f.sh` with no shebang), the file ends with status 1; sourced at the top level or inside a function, `source` returns 1 and the shell goes on (bash 5.2 and 5.3, and dash). A README code block typed into a terminal gets no note. |
| `source lib.sh`, `. lib.sh` | bash looks for `lib.sh` in `$PATH` first, and only then in the current directory, which is where the script was started from (cron starts in `$HOME`); in POSIX mode and in sh, only in `$PATH`. Write `source ./lib.sh`, or `source "$(dirname "$0")/lib.sh"`. | With `lib.sh` in a directory of `PATH` and in the current one, `[ -f lib.sh ] && source lib.sh` runs the one in `PATH`; `bash --posix -c '. lib.sh'` fails with "file not found" when only the current directory has it. |
| `grep "$USER" /etc/passwd`, `grep -e "$x" f` | grep reads the value as a regular expression: it matches inside longer text, and `.`, `*`, `[` in it are special. Add `-F` (in place of `-E` or `-P`; `grep -F` in place of `egrep`), and `-w` or `-x` as meant. | `grep bob` prints `bobby:…` too, `grep -Fw bob` only `bob:…`; `grep a.c` matches `abc`. |

Not for `\|\| true` or `\|\| :` (a failure ignored on purpose), a test on the left (`[ -f x ] \|\| echo none`), a function whose output is read by `$( )` (`v=$(cat f \|\| echo none)` gives a value), a line in the middle of a script without `set -e`, or `\|\| { echo msg >&2; exit 1; }`. Not for `source ./lib.sh`, a name whose value is not known, `source -p` (bash 5.3), `shopt -u sourcepath`, or zsh and ksh. Not for `grep -F`, `fgrep`, `grep -w`, `grep -x`, a pattern with text of its own (`"^$USER:"`), `"$1"`, a variable named as a pattern (`"$pattern"`, `"$re"`), or one whose value, set in the script, has regex characters. The fix shows the command on the right in full, and a group on the right whole: `cp a b \|\| { echo a; echo b; }` becomes `… \|\| { { echo a; echo b >&2; }; exit 1; }`. The command that prints the message, the file a builtin looks for in `$PATH`, and the operand read as a regex come from the command specs (`prints`, `searchesPath`, `lang: 'regex'`, and `whole` on `-w` and `-x`), not from names.

### An unset variable under `set -u`

With `set -u` (`set -o nounset`, or `#!/bin/bash -u`), bash fails on a read of an unset variable: it prints `dir: unbound variable` and the shell running the command exits. That is the script, or only the subshell in `$( )`, `( )` or a pipeline, which the pitfall says. A new pitfall says so on the line:

```bash
set -u
echo "$dir"        # ⚠ `dir` is not set here … If it may be unset, write `${dir:-}`
declare x
echo "${#x}"       # ⚠ `x` is not set here … Set it before this line
```

It is said for `$x`, `${x}`, `${#x}`, `${x[0]}`, `${x:1}`, `${x#p}` and the other forms that read the value, and for a name in `$(( ))` or `(( ))` that is read whenever the expression runs (not after `&&`, `||` or `?`). Only the first such read of a statement is named, in the order bash expands a command (its words, then its assignments, then its redirections: `x=$a echo "$y"` fails on `y`): bash expands no more of it. Each statement is said apart, in a branch or after another one (`[ -e f ] && echo "$x"; echo "$y"` names both). A word that bash expands before the command sets the name counts too: `x=$x`, `for x in $x`, `read -r x <<< "$x"`, `declare x="$x"`, `x=1 echo "$x"`. After `${x?w}` or `${x:?w}`, `x` is set: bash ends the script there otherwise.

In a redirection or a here-document of a builtin, a function, a compound command or no command (`read -r v <<E`, `{ …; } > "$f"`), the shell running it exits. In one of a program (`cat < "$f"`, `cat <<E`, `command cat < "$f"`), bash fails in the program's own process: the pitfall says that the command does not run and fails with status 1, and the script goes on (as information). With `set -e` where it is not ignored (`set -euo pipefail; cat < "$f"`), it adds that `set -e` stops the script, as a warning; in a condition (`if cat < "$f"`) it does not. `command -v cat < "$f"` and `exec cat < "$f"` end the script.

The note quotes the message of bash, or of dash (`dir: parameter not set`) in a script for dash. For another shell (sh, ksh, zsh…) it says only that reading the variable is an error. It adds "unless `dir` comes from the environment" except where the script removed the variable on every path before: `unset dir`, or `local dir` (`declare dir` in a function) where the function reads its local one. A `declare dir` outside a function keeps a value from the environment. `local -g y=2`, like `declare -g y=2`, sets the global variable, so `"$y"` after it is set (`local -g y` keeps the global value).

It is not said:

- for the forms that test the variable: `${x-w}`, `${x:-w}`, `${x+w}`, `${x=w}`, `${x?w}`, `[[ -v x ]]`, `"${a[@]}"`, `"$@"`, `$*`;
- after a test that reads the same name: in a branch of an `if` or `case`, the body of a loop, or the right side of `&&` or `||`, whose condition reads it (`if [[ -v x ]]; then echo "$x"; fi`, `[ -z "${x:-}" ] || echo "$x"`, `declare -p x >/dev/null && echo "$x"`);
- after a statement before it that tests the name (`-v x`, or `${x-w}`, `${x:-w}`, `${x+w}`, `${x:+w}`, `declare -p x` in a test or a condition) or ends the shell when it is unset (`${x?w}`, `${x:?w}`), in the script or, for a read in a function, anywhere outside the function: such a test is often followed by `exit` or `return` when it fails (`[[ -v x ]] || exit 1`, `if [ -z "${x:-}" ]; then return 1; fi`), and which way the flow goes through it is not followed. So a read after a test that does not stop is not said either, though bash fails there (`[[ -v x ]] && echo "$x"; echo "$x"`);
- for special and positional parameters (`$1`), and for names in capitals, which may come from the environment;
- where the variable is set on some path only (`if …; then x=1; fi`), or in a function called both before and after it is set;
- where the script runs code that cannot be read (`source`, `eval "$s"`, `$cmd`), or arithmetic reads a variable it never sets or declares without a value outside a function (`$((n + 1))`, `declare n; echo $((n + 1))`: its value may come from the environment), and in a function that may be called from elsewhere (`export -f`, a trap);
- in a here-document or a redirection in a shell other than bash (dash goes on after a here-document, and exits on a redirection of a program);
- in a redirection of `command command cat`, `command exec cat` or `: < "$f"`, nor of a function (`command f` runs no function).

A read the script never reaches (`echo "$a"; echo "$b"` exits at `$a`) is still said for each statement: it fails if the script gets there.

### A shebang whose options bash refuses

Linux passes the rest of the shebang line to bash as one argument, which bash reads as one run of option letters. A new pitfall on line 1 says when bash refuses it, so that the script stops with an error before running anything when it is run directly:

```bash
#!/bin/bash -e -u        # ⚠ … (a blank is not an option) …          bash: "- : invalid option"
#!/bin/bash -o nounset   # ⚠ … (`o` takes the next argument, the script's path, as an option name)
#!/bin/bash -euo pipefail
#!/bin/bash --posix -e   # ⚠ … (no long option has that name)
#!/bin/bash -Oextglob    # ⚠ … (bash has no option `-g`)                bash: "-g: invalid option"
#!/bin/bash -O extglob   # ⚠ … (`O` takes the next argument, the script's path, as a shopt option name)
```

Bash reads the letters left to right: a blank or a letter it does not know is an error at once, `o` takes the next argument at once, and `O` takes it once the letters are read. The options of a refused shebang are not on: neither when it is run directly nor by `bash script`.

It suggests writing the options with `set` on the next line. `#!/bin/bash -eu` and `#!/usr/bin/env -S bash -e -u` work, and get no pitfall.

### Warnings from the usability test of October 2026

New warnings and caveats, agreed after the usability test of October 2026. What each says was checked in bash 5.2 and 5.3.

| Written | Level | What it says | What bash does |
| --- | --- | --- | --- |
| `curl -fsSL URL \| bash`, `wget -qO- URL \| sudo sh -s`, `bash <(curl URL)`, `source <(curl URL)` | warning | The shell runs the download without anyone reading it, each line as it arrives; if the download breaks off, the lines that came still run, the last one perhaps cut short. Download to a file (`curl -o FILE`), check it, then run it. | `{ echo 'touch ran'; …wait for ran…; echo 'echo early'; } \| bash` prints `early`: the first line ran before the rest was sent. `printf 'echo one\necho tw' \| bash` prints `one` and `tw`. |
| `sh -c "$(curl -fsSL URL)"`, `eval "$(curl URL)"` | warning | The same, without "as it arrives": the string is the whole download, run even when it broke off (`eval` suggests `source FILE`). | `sh -c "$(printf 'echo one\necho tw'; exit 18)"` prints `one` and `tw`. |
| `trap 'echo bye' INT` (or `TERM`, `HUP`; `SIGINT`, `int`, `2` too) | information | When the signal comes, bash runs the action and goes on from where it was: the script does not stop. End the action with `exit 130` (128 + the signal's number); for several signals, a trap of each. | `trap 'echo caught' INT; kill -s INT $$; echo after` prints `caught` and `after`; with `exit 130` it ends with status 130. |
| `[ -f x ] && echo found` as the last command of a script with a shebang | information | When the test fails, the script ends with its status, which CI, `make` or `./script && next` sees as a failure. Use `if [ -f x ]; then echo found; fi`, or end with `exit 0`. | Such a script exits with status 1; with `if` or `exit 0` after it, 0. |
| `args=$@`, `a="$@"`, `x=${arr[@]}`, `local x="${arr[@]}"`, `x+=$@` | information | The arguments or elements are joined into one string, separated by spaces (whatever `IFS` is). Assign an array to keep them apart (`args=("$@")`), or write `"$*"` (`"${arr[*]}"`) when one string is meant. | `set -- 'a  b' c; x=$@` gives `x='a  b c'`; `x=("$@")` keeps `a  b` and `c` apart. |

What the shell runs and what downloads come from the command specs, not from names: a shell that reads its script from stdin (`bash`, `sh -s`, `bash -`, also run by `sudo`), a file it runs (`bash FILE`, `source FILE`), a string it runs (`sh -c`, `eval`); a download that goes to stdout (`curl` without `-o` or `-O`, `wget -O -`). No warning for `curl -o f URL | bash`, `wget URL | sh` (wget saves to a file), `curl URL | bash script.sh`, `curl URL | bash < f`, `curl URL > f | bash`, or a function named `curl` or `bash`.

The trap caveat is said only when the action's text is known and surely does not end the shell: not when it runs `exit`, `exec cmd`, `kill … $$` or `kill 0` (the signal again), or a function of the script that does, nor when it calls a name the script does not define (a function of a sourced file). Not for `trap '' INT` (ignore it) or `trap - INT`.

The caveat on a script's last command follows the caveat and the warning on a function's last `test && cmd` (`function-last-test-returns-status`, `function-last-test-stops-script`): the left side is a test (`[ ]`, `[[ ]]`, `(( ))`, `test`, `grep -q`), not a command whose failure is an error (`mkdir d && cd d`). Only in a file with a shebang, which is run as a program; a file that is sourced, such as `.bashrc`, gets none. Nor for a command started with `&`.

The joined array is not said for a count or the keys (`${#a[@]}`, `${!a[@]}`), a slice (`last=${@: -1}`), part of a string (`msg="args: $@"`), `export x=$@` (the environment holds strings), an assignment before a command (`x=$@ cmd`) or to an element (`a[0]=$@`), nor in a shell without arrays (sh, dash).

### The Reading view of the panel

The **Reading** button of the panel shows the current line as a tree of who reads each part; **Meaning** goes back to the explanations of each part. The layers follow the Bash manual:

- **bash.** bash splits the line into commands: lists, pipelines, compound commands and their clauses, coprocesses. A simple command is what 3.7.1 says: its assignments, its redirections, and its words. After expansion, the first word is the **command name**, which bash looks up as 3.7.2 says (a function, a builtin, a file in PATH); the tree says which. The other words are its **arguments**. In `ls -l a`, `ls` is the name and `-l` and `a` are arguments, to bash.
  - An **alias** is replaced before all that, when bash reads the line (6.6). After `alias ll='ls -l'`, the tree shows `ll` with its text under it: in `ll x`, the name bash looks up is `ls`, and `-l` and `x` are its arguments (as `set -x` shows: `+ ls -l x`).
  - When the first word has an expansion (`$cmd a`, `"$@"`), the name is known only when it runs, and the tree does not name one. In `e=; $e echo hi`, `$e` expands to nothing, so bash runs `echo`.
  - The arguments of `local`, `export` and `declare` that are assignments (`local x=$(y)`) are expanded as assignments (3.4). The elements of an array (`a=(1 "$y" *.txt)`) are words.
  - The parts bash reads in a word are under it: quotes, expansions, a glob's `*`, the escapes of `$'…'`, a tilde, braces.
  - In `[[ ]]`, each operator says what it tests (`-f`: is an existing regular file).
- **Scripts inside.** A text that bash parses again as a script: the text of each `$( )`, `<( )` and backquotes, which a subshell runs; or a string that a command gives a shell. `bash -c '…'` starts another shell; `eval '…'` and a trap's action are read again by the shell that runs them, with no new process (in a pipeline or a `$( )`, that shell is a subshell); `ssh host cmd` sends the command to a shell on another machine. Each says which. Levels inside levels (`bash -c 'echo $(pwd)'`) are in the same layer.
- **Commands.** What each command reads of its arguments, as its options, operands and subcommands, under the argument it is about. A command that another runs (`sudo ls -l`, `xargs grep -n x`) is under the word of its name, and what it reads under its own words. When a command reads several arguments together, it comes after them: `[`'s expression `-f x`. The operand of `eval` is a text it reads as a script, quoted or not.
  - A word that is the value of an option is named so, with the option as written: `value of -f` (`tar -czf "$backup"`, `tar -xfa.tar`, `tar --file a.tar`, `tar cf a.tar`, `grep -e foo`, `sort -k2`, `head -n 3`, `ssh -o Name=v`, `find . -name x`). `--file=a.tar` is one word, the option with its value, so it has no word of its own. Any other word the command reads that is not an option is an **operand**, a word that is only a tilde expansion (`tar -czf out.tgz ~/docs`) too; it had no command layer before.
  - A word that bash expands first is named after what the command gets: `operand: each matching file name` for a glob (`grep -h "$USER" /var/log/*.log`), `operand: each word it splits into` for an unquoted expansion (`ls $x`), `operand: each word the braces give` for `f{1,2}.txt`, `operand: each element` for `"$@"`, `"${@:2}"`, `"${a[@]/x/y}"` and `"pre$@post"` (one word per element, none for `"$@"` when there are none); the same for the value of an option (`sort -o out *.txt`, `grep -e "$@"`). A word that is the value of an option and is expanded (`sort -o *.txt`) says that the first word it makes is the value and the others are operands. A quoted word, a glob under `set -f`, and a plain word stay "operand". Before, they were all "operand", as if the command read the word as written. Without a match, bash passes the pattern as it is (no `nullglob` or `failglob`).
- **Languages.** A language inside a word, read by its own rules: a regex, a glob, a sed script, a jq filter, a printf format. The command reads it, except the regex on the right of `[[ =~ ]]`, which bash matches itself (POSIX ERE).

The buttons above the tree are its eight steps, each adding one stage: bash's own reading first (1 the line, 2 its lists and pipelines, 3 its commands, 4 their words, 5 what is inside the words: quotes, expansions, the scripts of substitutions), then the other readers (6 the scripts inside, 7 each command's reading of its arguments, 8 the languages). The steps before the one shown keep a light tint, so the row reads as how far the tree is unfolded; a step that adds nothing to the line is dimmed, and the arrow keys and the ◁ ▷ buttons pass it over. The left and right arrows step, Home and End go to either end, and a screen reader hears the step ("Step 4 of 8: words"). The rows a step adds grow from their parent, and those it takes away shrink into it. Where the buttons do not fit (a narrow panel, a phone), they fold into a stepper (◁ 4/8 Words ▾ ▷) whose middle opens the steps as a menu. The controls stay under the line while the tree scrolls. The tree is drawn as an outline: each item has its code in a pill and its text on a line below, and lines join it to its parent. Each reader has its own colour, and a light tint over the part it covers, the same at every depth. A rule in that colour runs down the left of the part, and a thin line marks its top and its bottom, so two parts next to each other stay apart (in a high-contrast theme, an outline in its colour). The tree folds and moves with the arrow keys, Home, End, Enter and Space, as screen readers expect of a tree; Tab reaches the manual links of the item with the focus. Pointing at a part highlights it in the editor and in the line; a key or a click selects it in the editor, when it is on the line shown, and keeps the focus in the tree. A part on another line (a clause of a `case` inside a `while … do … done` explained from its first line) is only folded: selecting it would move the cursor to that line, and the panel would explain that line instead. The Meaning view does the same. In host files (a Makefile, a GitHub Actions workflow), the tree shows the file's own text (`$(CC)`, `${{ github.ref }}`) and says what each placeholder stands for. The panel remembers the view and the step, also after it is closed (on the web page, for your next visit). In a high-contrast theme, the highlights are outlined.

Rows grow from their parent when you unfold them and shrink into it when you fold them (a twisty, a click, the keys, **Collapse all** and **Expand all**), in the Meaning and Reading views, and when a step changes. `bashExplainer.panel.animations: false` turns this off, and so does reduced motion: the system's setting, or VS Code's `workbench.reduceMotion`.

The row you fold or unfold (with its twisty, a click on the row, or the keys) does not move on the screen: not when you click, not while it moves, not at the end. Before, folding a row near the end of the panel pulled the page down, so the row jumped. Near the end, the panel keeps blank room below the content instead, and that room goes as you scroll up, without anything on the screen moving. A step keeps the step buttons and the first row of the tree on the screen in place (the first one the new step still shows); **Collapse all** and **Expand all** keep the first row on the screen that stays. When none on the screen stays (Collapse all far down the page), the row around them that stays comes to the top of the screen, under the line and the controls, so the page never ends up blank. Switching between Meaning and Reading drops the blank room, also with the web page's own switch. This holds with the animations off too. It works the same in VS Code, on the web page and on a phone.

### The bash version

The setting `bashExplainer.bashVersion` says which bash release scripts are explained for: `5.2` (the default, and the release the manual citations follow) or `5.3`. It is on every surface: VS Code, the web page's settings, the command-line tool (`--bash-version 5.3`, `--set bashVersion=5.3`, or the settings file) and the Language Server. A shebang does not tell the release, so the file cannot set it.

A construct of a later release is explained as that release runs it. When the release set lacks it, it is a warning in the Problems panel and a note on the line, with its own code for `diagnostics.ignore`:

```text
script.sh:3:3: warning: ${ …; } (command substitution in the current shell) is bash 5.3 syntax: bash 5.2 reports "bad substitution" and stops there: the rest of the line, and the rest of the if, loop or function around it, do not run (status 1). Under set -e, and in POSIX mode, the shell exits; in a subshell, only the subshell stops. Instead, use $(…) (it runs in a subshell). [funsub]
```

This changes what bash scripts that already use `${ …; }` or `${| …; }` get by default: a warning, and `--check` exits 1. Set `bashVersion` to `5.3` to explain them as bash 5.3 runs them. The GitHub Action takes the release as its `bash-version` input.

The options that builtins got in bash 5.3 are explained, and are warnings in 5.2 mode (`laterOption`): bash 5.2 says "invalid option", and the builtin does nothing (status 2). `source`, `.` and `trap` are special builtins: in POSIX mode, that error exits the shell.

| Written | Shown now | Shown before |
| --- | --- | --- |
| `source -p "$HOME/lib" util.sh` (and `. -p`) | "bash 5.3: look for the file in the given directories, separated by colons, instead of `$PATH` (the current directory only for an empty entry)" | "`-p`: option not in the dictionary" |
| `compgen -V words -W "a b" -- a` | "bash 5.3: store the candidates in the named indexed array instead of printing them"; `words` is the array it sets | `-V` unknown, and `words` taken for the word to complete |
| `trap -P INT` | "bash 5.3: print only the command set for each signal given"; `INT` is a signal whose command it prints | `-P` unknown, and `INT` said to reset the trap |
| `read -E line` | "bash 5.3: read with Readline line editing and bash's own completion" | `-E` unknown |

The variables and `shopt` options of bash 5.3 are explained in 5.3 mode, and said to be plain variables, or a warning (`laterOption`: "invalid shell option name", status 1), in 5.2 mode:

| Written | bash 5.3 mode | bash 5.2 mode | Before |
| --- | --- | --- | --- |
| `GLOBSORT=-mtime` | "`GLOBSORT`: In bash 5.3, how the results of a glob are sorted: `name` (the default), `numeric` …; a `-` before it sorts in descending order, and `nosort` does not sort" | "A plain variable in bash 5.2 (in bash 5.3, …)" | an assignment to a plain variable |
| `$BASH_TRAPSIG` | "the number of the signal whose trap is running, 2 for `INT`" | a plain variable | "Expands to the value of `BASH_TRAPSIG`" |
| `$BASH_MONOSECONDS` | "the seconds of the system's monotonic clock, each time it is read" | a plain variable | "Expands to the value of `BASH_MONOSECONDS`" |
| `shopt -s array_expand_once`, `shopt -s bash_source_fullpath` | "bash 5.3: evaluate array subscripts only once …; the new name of `assoc_expand_once`", "bash 5.3: put the full path of each file in `BASH_SOURCE`" | the same, and a warning | "option name (e.g. nullglob, globstar, extglob)" |

```text
script.sh:4:8: warning: source -p is a bash 5.3 option: bash 5.2 reports "invalid option", and source does nothing (status 2; an error of a special builtin, so in POSIX mode the shell exits). [laterOption]
```

The plan, and the list of what else changed in bash 5.3, are in [docs/design/bash-versions.md](../design/bash-versions.md).

### Where POSIX mode stops the script

In POSIX mode (`set -o posix`, `#!/bin/bash --posix`, `bash --posix`), an error of a special builtin ends a shell that is not interactive (Bash manual 4.4, 6.11). Where the words written decide it, the line gets a warning (a caveat where POSIX mode is on some paths only), and the code after it is faded when the script's values are trusted. bash goes on where `set -e` would not stop it: in a condition, on the left of `&&` or `||`, after `!`, and in a function called there; behind `command` it is no special builtin. In a subshell, only the subshell ends. Each row was checked with bash 5.2.21 and 5.3, with a script read line by line (test/posix-exits.test.ts, probes/status.json).

| Written, in POSIX mode | bash 5.2 | bash 5.3 | Said now |
| --- | --- | --- | --- |
| `set -Z`, `export -Z x`, `times -x`, `. -Z f` | exits, status 2 ("invalid option") | the same | "here `set` has no option `-Z`, so bash stops the script here (status 2)" |
| `set -o nosuch`, `set -euo nosuch` | exits, status 2 | the same | "`nosuch` is no option name of `set -o`" |
| `exec -a`, `.` or `source` alone, `trap INT`, `trap -- INT` | exits, status 2 (a usage error) | the same | "`-a` has no value", "`.` is given no file to read", "a lone word that is no signal number" |
| `source -p dir f` | exits, status 2 (an option of bash 5.3) | reads `f` | the warning `laterOption` says so in 5.2 mode, and now the note too |
| `export 1x=2`, `readonly a-b`, `export -p a-b`, `export -n 1x`, `unset -v a-b` | "not a valid identifier", status 1, goes on | exits, status 1 | in 5.3 mode, "`1x=2` is not a valid name, so bash stops the script here (status 1; bash 5.3 on: bash 5.2 goes on, with status 1)" |
| `readonly r; unset r` | "cannot unset: readonly variable", status 1, goes on | exits, status 1 | in 5.3 mode, "`r` is a read-only variable" |
| `shift x` | "numeric argument required", status 1, goes on | exits, status 2 | in 5.3 mode, "`x` is no number" |
| `readonly r=1; r=2 :` (an assignment before a special builtin) | exits, status 1, also on the left of `\|\|` | the same | the assignment's note: "in POSIX mode, bash stops the script here, status 1" |
| `a-b() { :; }`, `a.b() { :; }` | "not a valid identifier": exits, status 2, wherever it is | defines the function | in 5.2 mode, "in POSIX mode bash 5.2 refuses a function name that is not a valid name: it stops the script here … (status 2; bash 5.3 defines the function)" |
| `export() { :; }` | "is a special builtin": exits, status 2 | the same | as before; the code after it is faded now |
| `set -Z \|\| :`, `if export 1x; then …`, `command set -Z`, `trap 2`, `unset a-b`, `export -f a-b` | goes on | goes on | nothing |

| `set -o`, `set +o` alone (also `set -eo`, `set -o >/dev/null`), `set -o -e` | lists the options and goes on; with `-e` after it, sets `-e` too | the same | nothing; `set -o -e` reads `-e` as an option, not as a name of `set -o` |
| `export 1x 2>/dev/null`, `exec -a 2>/dev/null` | as without the redirection | the same | the note too (and `exit 256 2>/dev/null` keeps its note) |
| `trap 'set -Z' EXIT` | the trap's action ends the shell, which was ending anyway: only its status changes | the same | the note says so |
| `eval 'export 1x' \|\| :`, `if eval 'set -Z'; then …` | 5.2 exits on the second | goes on | nothing (the walk and the status model read one decision, made where the walk ran the string) |

Not decided from the words, so not said: a file `.` does not find (said by `.` itself), a redirection that fails, `eval` of text with a syntax error, `return x` in a function (bash 5.3 exits), `export a[1]=x`, `set -opipefail` (letters after `o`, which bash reads erratically), and the exits on `export r=2` or `for r in …` of a readonly `r`.

`exit` with words that give it no status, in and out of POSIX mode (checked with bash 5.2.21 and 5.3):

| Written | bash 5.2 | bash 5.3 | Said now | Before |
| --- | --- | --- | --- | --- |
| `exit 1 2`, `exit 3 ""` | "too many arguments", status 1, goes on | status 2, goes on | "`exit` takes one status: given more words, bash says "too many arguments" and does not exit; the shell goes on …", nothing faded | the code after it faded |
| `exit x`, `exit 1x`, `exit x y` | "numeric argument required": exits, status 2 | outside POSIX mode goes on, status 2; in POSIX mode exits, except where `set -e` would not stop it | by release, and the code after is faded where bash exits | always an exit |

The operands bash refuses as names are said so: `export 1x=2`, `readonly -p a-b`, `declare a.b` and `local -n 2r` are "Bash refuses this word: it is not a valid variable name ("not a valid identifier", status 1)". Before, they were "Variable `1x=2`". `local -` (the options made local) and `export x\=1` (bash exports `x`) are not.

In bash 5.3's POSIX mode, a `$( )` does not change `$?` until the command is done, so the walk follows `$?` across it: after `false`, `[ "$(true)$?" = 1 ]` is true there, and the `else` branch is faded in a script that starts in POSIX mode. In bash 5.2, and out of POSIX mode, `$?` there is the substitution's status, not decided.

### What a command name is

In both views of the panel, every command name has a badge after it: keyword, builtin, special builtin, function, alias or program (a program's badge has a dashed edge). A POSIX special builtin (`:`, `.`, `break`, `continue`, `eval`, `exec`, `exit`, `export`, `readonly`, `return`, `set`, `shift`, `source`, `times`, `trap`, `unset`: the list of `enable -s` in bash 5.2) says "special builtin" (`特殊ビルトイン`) where the other builtins say "builtin"; its tooltip says what the class means. The hover, Copy as Markdown and the command line end its row with " (special builtin)". When another command looks the name up, the badge says so: `sudo echo hi` shows `echo` as a program, run by `sudo`. A subcommand (`git commit`) has none: bash does not look it up.

A name that is also something else gets one muted line, with the code that runs the other meaning:

| Line | Badge | The line under it |
| --- | --- | --- |
| `echo hi` | builtin | Same name, also: a program, usually `/usr/bin/echo` (run with `env echo`) |
| `time sleep 1` | keyword | Same name, also: a program, usually `/usr/bin/time` (run with `\time` or `command time`) |
| `function time { …; }; time ls` | keyword | Same name, also: the function of this script (run with `\time`); a program, usually `/usr/bin/time` (run with `command time`) |
| `sudo echo hi` | program, run by `sudo` | `sudo` looks the name up, so this is the program, not bash's builtin |
| `echo() { :; }; echo hi` | function | Same name, also: bash's builtin (run with `builtin echo` or `command echo`); a program, usually `/usr/bin/echo` (run with `env echo`) |
| `command time ls` | program, run by `command` | Same name, also: a reserved word, where it starts a command unquoted |
| `builtin ls` | nothing runs, `builtin` finds no builtin named `ls` | Same name, also: a program in PATH (run with `ls`) |
| `sudo cd /tmp` | program, run by `sudo` | `sudo` looks the name up, so bash's builtin does not run, and there is usually no program of this name |
| `alias ll='ls -l'; ll` (no `shopt -s expand_aliases`) | program | Same name, also: an alias, not expanded here (needs `shopt -s expand_aliases`) |
| `command [[ -f x ]]` | nothing runs, `command` finds no command named `[[` (bash says `[[: command not found`) | Same name, also: a reserved word, where it starts a command unquoted |
| `builtin cd /tmp`, `command echo hi` | builtin (it runs in this shell, as `cd /tmp` would) | |

Of the reserved words, only `time` has a badge: it is also a program. `[[` has none; it is a test, and nothing else has its name.

The code given for each other meaning is what reaches it from where the name is: `\time` reaches the program only where no function `time` is defined, and `env echo` is given only where bash's builtin `echo` comes first.
The explanations no longer end with "(shell builtin)", and the programs named like builtins say their package: "(from coreutils)" where they said "(the coreutils program)". The hover, Copy as Markdown and the command line's text and Markdown end each such row with the kind instead: " (builtin)", " (program, run by `sudo`)"; the JSON output has a `name` field with the facts. In the Reading view, the badge replaces the kind after "command name" ("command name · builtin" before). An alias is shown as an alias, no longer as a function: in the JSON output, its token's `kind` is `alias` (it was `function`).

### The file kind of a pasted script (web page)

On the web page, a paste or a drop of text sets the file kind from what was pasted, when the paste makes 80% or more of the text, or when the editor held only a sample or nothing. The pasted text stays as it is (no sample is loaded), and a toast says "Detected: Dockerfile" with Undo, which goes back to the kind before. A few lines pasted into your own script never change the kind. Before, the kind changed only by hand.

Only clear signals count; otherwise the kind stays:

| Kind | Signal |
| --- | --- |
| Shell script | a shebang of a shell (`#!/bin/sh`, `#!/usr/bin/env bash`), or `# shellcheck shell=…` |
| bats | a bats shebang, or `@test "…" {` |
| Python | a python shebang, or `import subprocess`/`import os` with a call of `subprocess.…()`, `os.system()` or `os.popen()` |
| Dockerfile | `FROM image` as the first instruction (an `ARG` may come before it), and one more instruction |
| GitHub Actions / GitLab CI | `on:` and `jobs:` with `runs-on:` or `steps:`; GitLab's `script:` with `stages:`, `image:`…; CircleCI's `version: 2.1`; Azure's `trigger:`/`pool:`; a composite action |
| Makefile | `.PHONY:`, or a rule followed by a recipe line that starts with a TAB |
| Markdown | a shell code block (`sh`, `bash`, `console`…), or headings and a code block |
| Jenkinsfile | `pipeline {` or `node {` with a `sh` step or `stages {` |
| package.json | a JSON object with `scripts` |

A shell script without a shebang says nothing clear, so pasting one keeps the kind. A Makefile whose recipes are indented with spaces is not one make accepts ("missing separator"), and looks like YAML, so it is detected only with a `.PHONY:` line.

### Opening and saving files (web page)

The web page opens a file from your computer and saves the script to one. The file is read in the browser and uploaded nowhere. Before, the only way in was a paste, and the only way out a copy.

| To | Do |
| --- | --- |
| Open a file | **Open file…** in the menu (☰), `Ctrl+O` (`⌘O` on a Mac), or drop the file on the editor |
| Save | `Ctrl+S` (`⌘S` on a Mac), also with the focus in the explanation, or **Save** in the menu |

- **The kind** comes from the file's name, as in VS Code: `Dockerfile`, `Containerfile`, `Makefile`, `*.mk`, `*.yml`, `package.json`, `*.md`, `*.py`, `Jenkinsfile`, `*.bats` (or a bats shebang). A shell extension (`.sh`, `.bash`, `.zsh`…) makes a shell script. Any other name is read like a paste (the table above), and is a shell script when nothing is clear. A name like `deploy.zsh` also says which shell the script is for.
- **Saving** writes the script back to the file it was opened from, in Chrome and Edge (the browser asks once for the permission to edit it). A script that came from no file opens the browser's Save dialog the first time; later saves write to the same file. Browsers that cannot write files (Firefox, Safari) download the script instead, so each save is a new download. A file that was never opened is named after the kind: `script.sh`, `Dockerfile`, `Makefile`, `ci.yml`, `package.json`, `README.md`, `deploy.py`, `Jenkinsfile`, `test.bats`.
- **Saving** again after the browser could not write to the file (permission refused, a read-only or moved file) asks where to save.
- **The text is kept byte for byte**: UTF-8 as it was, a BOM if there was one, no newline added at the end, and the file's line ends. A file with CRLF line ends is saved with CRLF, and gets the `crlf` warning, as bash would fail on it. A file that mixed CRLF and LF is saved with the more common one, and a toast says so. The BOM is left out of the script, as VS Code does, so a shebang after it is read as one.
- **Changes not saved**: the top bar shows the file's name (the menu's Save on a phone, and the tab's title), with ● after it while there are changes not saved. Opening another file over them asks first; Cancel (or Esc) keeps them. Leaving the page (closing it, reloading it) with them makes the browser ask. Opening a file starts a new undo history, so Undo never brings back the text before it. Loading a sample leaves the file; the toast's Undo brings it back.
- **Refused files**: a file larger than 1 MiB (the page explains the whole text again after every change, and at 1 MiB that already takes about 4 s), a file that is not UTF-8 text (a NUL byte, or bytes that are not UTF-8), and a file with a CR that ends no line (`printf '50%\r'` written with a real CR), which the editor would turn into a line break. The page says why, and keeps the script.

### Hover cards (web page)

The web page's editor shows the cards of VS Code's hover. Before, the page had no hover: only the panel explained the line at the cursor.

| To | Do |
| --- | --- |
| See what a word, an option or an operator is | point at it: its card shows the part, its kind of command, the command it belongs to, its notes and its examples |
| See the line's structure | point at the indentation or a blank between statements |
| See the card at the cursor | `Ctrl+K Ctrl+I` (`⌘K ⌘I` on a Mac); press it again to scroll the card or reach its links with Tab, and Escape to close it |
| Explain the whole line | `Ctrl+K Ctrl+E`, or **Whole line** or **Open in panel** in the card: the cursor goes to the line, and the panel explains it |

- A problem at the pointer shows above the card, in the same box, and the card does not say it again.
- The card stays inside the editor: near the top of the page it opens below the word, and it no longer covers the top bar. A long card scrolls.
- A touch screen shows no card: a tap moves the cursor, and the panel explains the line.
- `bashExplainer.hover.enabled` is in the page's settings (on by default). Off, the page shows no card, and leaves `Ctrl+K` and `Ctrl+E` to the browser. A settings file from VS Code now brings it along; `hover.maxDepth`, `examples.inHover` and `hover.followCursor` stay VS Code's.

### Panel colours from the editor theme

`bashExplainer.panel.colors` (VS Code only) chooses where the panel's colours come from:

- `classic`, the default: the panel's own six colours, as before.
- `theme`: the colour your theme gives each part in the editor, with your `editor.tokenColorCustomizations` and `editor.semanticTokenColorCustomizations`. A part the theme leaves uncoloured, or colours below 4.5:1 (7:1 in a high contrast theme), keeps the panel's own colour. In Dark Modern, `ll` and `grep` are #DCDCAA as in the editor, and `|` and `2>` are both the plain foreground.
- `themeLike`: the theme's colours, except where the theme gives two kinds of part one colour that the panel keeps apart. Then a part takes the colour of its group (`|` takes the keyword's colour, as in the classic palette), or a new colour that suits the theme, with enough contrast. In Dark Modern, redirects and regexes get a teal of their own, and comments are a little lighter, to reach 4.5:1 on a code block.

In a remote window (WSL, SSH, a dev container), VS Code keeps the colour themes on the local side. So the extension now prefers to run there too: installed from a remote window, it goes to your local machine, and the panel follows every theme, Monokai Pro as well as Dark Modern. It needs nothing from the remote machine: it reads the documents VS Code gives it, and starts no program. Before, it ran on the remote side. A copy installed there earlier keeps running there; **Install Locally** in the Extensions view moves it. On a Mac connected to Linux, the hover's link now says `⌘K ⌘E`.

When the extension runs on the remote side (installed there only, or in Codespaces in a browser), the theme extensions are out of its reach. There the panel takes VS Code's default themes (Dark 2026, Light 2026, Dark Modern, Light Modern, Dark+, Light+, Visual Studio Dark and Light, and both high contrast ones) from a copy it carries, so `theme` and `themeLike` work with them. With any other theme, from the Marketplace or one VS Code ships from elsewhere (Monokai, Solarized…), the panel keeps its own colours, and a notice says so once a session, with how to install the extension locally.

The colours follow the theme when it changes. How the theme is read, and how much each choice keeps parts apart, is in [docs/design/theme-colours.md](../design/theme-colours.md).

### The value of an expansion

The token of an expansion says its value where the script fixes it, under its meaning, in the panel (Meaning), the hover, the Markdown output and the command line. An unquoted one also shows the words it is split into, as chips in the panel:

| Script | Shown on the expansion |
| --- | --- |
| `msg="hello world"; echo $msg` | Value here, from the script: `hello world`; unquoted, it is split into 2 words: `hello` `world` |
| `msg="hello world"; echo "$msg"` | Value here, from the script: `hello world` |
| `file=report.tar.gz; echo "${file%.*}" "${#file}"` | `report.tar`; `13` |
| `x=; echo "${x:-default}"` | `default` |
| `empty=; echo $empty` | an empty string; unquoted, it is split and gives no word |
| `pat='*.txt'; ls $pat` | `*.txt`. Unquoted, it is a pattern: bash matches it against file names when the line runs (not done here) |
| `IFS=:; p='a:b c'; echo $p` | `a:b c`, split into `a` and `b c` |
| `f() { echo "$x"; }; x=1; f` | `1` in the body |

Nothing is shown where the value is not sure: a variable the script does not set (it may come from the environment: `$HOME`), one that `read`, `mapfile`, arithmetic, `${x:=…}`, a trap or an `eval` string may set, a loop that changes it, a function called with two values, a branch whose condition is not known, code that never runs, a script that runs `source`, positional parameters, arrays, and strings another shell runs (`bash -c '…'`). Nor is it shown where bash reads the text by the locale (text other than ASCII, beyond a plain copy: `${#e}`, `${e^^}` of `e=é`), after a word of the same command that may fail first (`e=; echo ${e:?} "$e"`), where bash fails (`${x:2:-5}`: "substring expression < 0"), in a script whose `PS4` may assign (`PS4='$((n++))'`, for `bash -x`), or in a function that only uncalled functions call. Nor in a script where bash may change a variable unseen: it reads a nameref whose target is not known (`declare -n r=$1; : "$r"`: with `$1` = `a[u=2]`, the subscript sets `u`), tests `-v` of a name not known (`[ -v "$1" ]`, `[[ -v $x ]]`), expands a value as a prompt that may run code (`${x@P}` of `$((u=2))`, or of `\044((u=2))`, which bash decodes to `$`), runs `compgen -W` with an expansion in the list, or `fc` other than `fc -l`, or reads in arithmetic a variable declared without a value outside a function (`declare n; (( n ))`, `declare -i n; n+=1`: a value from the environment runs as an expression). After a recursive call, what the function changes after the call is not known either (`g() { if [ "$d" = 1 ]; then d=2; g; return; fi; x=2; }`: bash's `x` is 2 after `g`). A part of a longer word (`$x/c`, `a$e`) shows its value only: its words join the text around it (`x='a b'; echo $x/c` gives `a` and `b/c`).

A space at either end of a value is marked, an empty word is shown as `∅`, and a bidi control or zero-width character as its code (`<U+202E>`), named after the value; a long value is cut on a character. In the hover, a value with a backtick reads as it is. The mark of a space is drawn, not typed as a character, in the panel, the web page and VS Code's hover: a real space in a box with a bottom edge (panel), or on the badge background (hover), named "space" (`空白`) for a screen reader or as a tooltip. The symbol for a space (`␠`, U+2420) is a box on a machine with few fonts. In the outputs that are text only (the CLI, the Markdown of the language server and of Copy as Markdown) the mark is `␣` (open box, U+2423), which far more fonts have, and the note says `␣` is a space at an end.

In sh and dash scripts, the POSIX forms show values too: `$x`, `${x}`, `${#x}`, `${x:-w}`, `${x-w}`, `${x:+w}`, `${x+w}`, `${x:?w}` when set, `%`, `%%`, `#`, `##`. `#!/bin/sh` is dash on Debian and Ubuntu and `bash --posix` elsewhere, so a value is shown only where both give it (checked with dash 0.5.12). Nothing is shown for the forms dash rejects ("Bad substitution": `${x/p/r}`, `${x:o:l}`, `${x^^}`), for `[^a]` in a pattern (dash reads `^` as a character), after `local IFS` (dash keeps the caller's value), for text other than ASCII (dash counts bytes), or in a script that uses what dash lacks (`[[ ]]`, `declare`, `$'…'`). zsh and ksh show none.

The worked examples use the script's value where the value line knows it:

| Script | Example now | Example before |
| --- | --- | --- |
| `msg="hello world"; echo ${#msg}` | When `msg="hello world"` → `11` | When `msg=hello` → `5` |
| `x=abc; echo ${x#z}` | When `x=abc` → `abc`, then When `x=zname` → `name` | When `x=zname` → `name` |
| `y=zzz; [ "$y" = abc ]` | the value that makes it false: `y="zzz"` | `y="abcx"` |
| `x=abc; [[ $x == a* ]]` | values that match: `abc` `aapp` `adata` | `aapp` `adata` `aerror` |
| `x=abc; case $x in a*) …;; *c) …;; esac` | `abc` under the first branch, and under "Values that do not" for `*c)` | samples only |
| `x=abc; read -r a b <<< "$x y"` | the line `abc y`: `a="abc"`, `b="y"` | the line `alice 30 tokyo` |

When the script's value shows no effect of the operator, a sample that shows it follows. A value with control characters, a backtick, a space at an end or over 60 characters keeps the samples, and so do sh and dash scripts.

What is shown and why: [docs/design/expansion-values.md](../design/expansion-values.md).

### bats: each test as bats runs it, and the hooks

bats (1.13) reads a test file with `set -eET` on, then runs each test in a process of its own: the process reads the whole file again, calls `setup`, the test, and `teardown`. `setup_file` and `teardown_file` run once, in one more process, before the first test and after the last. The model of a bats file now follows this:

| Script | Now |
| --- | --- |
| `x=1` at the top, then in a test `if [ "$x" = 1 ]` | the condition is always true (before, nothing was decided in a test) |
| `setup() { y=2; }`, then in a test `[ "$y" = 2 ]` | `$y` is `2` in the test |
| `x=1` in one test, `x` read in the next | the next test does not see it: it has the value of the file (`x=0` at the top) |
| `z=$(false; echo a)` in a test | the note that `set -e` is off inside `$( )` |
| `false` in `teardown`, then more commands | bats calls `teardown` as `teardown \|\| …`, so `set -e` is ignored in it: the note on `teardown` says so |
| a variable `setup_file` sets | not known in the tests: only what it exports reaches them |

The definitions of `setup`, `teardown`, `setup_file` and `teardown_file` get a note on when bats calls them and in which process. A `setup_suite` in a test file is a pitfall: bats does not call it there and warns (BW03); it belongs in `setup_suite.bash`. The note on each `@test` adds that the code outside the tests runs again for each test.

### Tag comments and marked functions in bats files

To bash, `# bats test_tags=…` and `# bats file_tags=…` are comments. bats reads them, so the line says both, and which tests get the tags:

| Line | What the explanation says |
| --- | --- |
| `# bats test_tags=a, b:c` | bash ignores it; bats gives the next test only the tags `a` and `b:c`, and runs it with `bats --filter-tags a` |
| `# bats file_tags=slow` | every later test of the file gets `slow`; a later `# bats file_tags=` replaces it, and an empty one cancels it |
| `# bats test_tags=bats:focus` | bats runs only the focused tests, and exits 1 even if they pass (`BATS_NO_FAIL_FOCUS_RUN=1` keeps 0) |
| `# bats test_tags=a,,b`, `a b`, `,b`, ` ` (only spaces), `x²` | a warning: bats refuses the list, so none of the tests of the file runs (`not ok 1 bats-gather-tests`) |

A test has its `test_tags` and the `file_tags` in effect, sorted (`$BATS_TEST_TAGS`); of two `test_tags` lines before one test, the later one counts. A tag is made of `-`, `_`, `:`, letters and digits of any script (`é`, `٣`), as glibc reads `[[:alnum:]]` in a UTF-8 locale, but not `²` or `½`. Only a line that starts with the comment counts; bats reads it also inside a here-document or a string, where the line is text to bash, and the note says so.

The other form of a test, a function marked with a comment, is explained as a test too:

```bash
countdown() { # @test
  true
}
```

bats takes the function for a test named `countdown` and renames it `test_countdown` (so `countdown` is no longer a function; `-` and other characters in the name are written in hex, as for `@test "…"`). The name of `@test "x²"` is now `test_x-b2`, as bats writes it (before, `test_x²`: `²` is no digit to bash's `[[:alnum:]]`). Before, such a function was a plain function with a comment. As for bats, the parentheses and `function` are optional (`countdown { # @test` is a test too), the line needs a blank before the `{` and nothing after `# @test`, and a test defined inside a function counts only when the function runs as the file is read (the same holds for `@test "…"`). bats replaces the whole line with the test's definition, so text before the name, as in `echo hi; f() { # @test`, never runs: a warning says so.

### Helpers of the bats libraries

The functions of bats-support, bats-assert and bats-file are explained in a bats file as what they are: what they check, what they read (`$output`, `$status`, `$lines`, `$stderr` that `run` set), and that on failure they print a report to stderr and return 1, which fails the test (bats runs a test with `set -e`). Before, they were "external commands not in the dictionary".

| Line | Explained as |
| --- | --- |
| `assert_output --partial 'ok'` | `$output` contains `ok`; `--partial` is a substring match |
| `assert_output -` (or `--stdin`) with a here-document | the expected text is read from stdin |
| `assert_line --index 0 'x'` | only the line 0 of `$lines` is compared (empty lines are not in `$lines`) |
| `assert_failure 2` | `$status` has to be 2 (with no argument: any non-zero) |
| `assert_file_exists "$f"` | a regular file exists at the path |
| `dir=$(temp_make -p x)` | makes a directory in `$BATS_TMPDIR` and prints its path |

They are explained only where the file can have the library: a `load` or `bats_load_library` that names it (a path with the component `bats-assert`, `bats-support` or `bats-file`) gives that library; a `load` of anything else (`load 'test_helper/common-setup'`, which may load them) gives all three; with no `load` at all, bats does not define them, and they are programs as before. A function of the file with the same name stays the file's own. The texts come from the libraries' READMEs; they are not tested against the libraries, which are not installed here.

### The input of each stage of a pipeline

A pipeline's worked example shows what each command reads. When the first command prints a table of a known layout, the example starts from made-up lines in that layout (procps-ng 4, GNU coreutils 9), then shows what each later command makes of them. ps lists the commands of the pipeline too, since they run with it: `ps aux | grep nginx` keeps grep's own line. It shows their words after quote removal, the name too (`\head -n 3` as `head -n 3`); a command with a character ps shows as `?` (a tab, `$'\u0085'`) has no row. A quoted name runs the same program: `\env | cat` and `"env" -- | cat` get the made-up environment, unless the script defines a function `env`. Its `_` line is the path bash ran env by: `/usr/bin/env` from the made-up PATH, `/bin/env` when written so or given by `hash -p`; env with an assignment before it (`PATH=/bin env`, `FOO=1 env`), which changes what it prints, gets no made-up environment. A name `hash -p` gave a path runs the program of that path: after `hash -p /usr/bin/tac sort`, `sort` is read as tac, and ps shows `tac` in its CMD column. Any pipeline reads a quoted name so: `printf 'b\na\n' | \sort | 'head' -n 1` shows `a`; before, a pipeline with a quoted name had no worked example.

| Written | Shown now | Shown before |
| --- | --- | --- |
| `ps aux \| grep nginx \| awk '{print $2}'` | "Output of `ps aux` (sample)": `USER PID %CPU …` and a row per process; "After `grep nginx`": the nginx rows and grep's; "Output": their PIDs | awk's example alone, on lines `apple red tokyo` |
| `ps -ef \| grep python`, `ps \| wc -l` | the `UID PID PPID C STIME TTY TIME CMD` and `PID TTY TIME CMD` layouts | no example, or the commands' examples on made-up lines |
| `ls -l \| grep '^d' \| wc -l`, `ls -lh \| sort -k5 -h`, `ls -la`, `ls \| wc -l` | `total 36`, then `drwxr-xr-x 2 alice alice 4096 Mar  3 09:15 docs`…; `ls` alone prints a name a line into a pipe | the same |
| `df -h \| awk '{print $5}'` | `Filesystem Size Used Avail Use% Mounted on` and five file systems: `Use%`, `1%`, `45%`… | the same |
| `who \| cut -d' ' -f1 \| sort -u`, `env \| grep PATH`, `printenv` | `alice    pts/0        2026-03-03 09:30 (192.168.1.20)`; `NAME=value` lines, ending with `_=/usr/bin/env` | the same |

The made-up lines are shown as they are, not in a box to edit: a box wraps long lines, and the columns would no longer line up. Other options or an operand (`ps aux --sort=-%mem`, `ls -l /etc`, `ls -lt`, `df`) get no made-up output, nor does `env` when it runs a command (`env sort | cat`: what sort prints) or starts from an empty environment (`env -`).

The made-up environment holds what the script exports before the pipeline: after `export FOO=bar` (or `declare -x`, or `FOO=bar` under `set -a`), `env | grep FOO` shows `FOO=bar`; `unset HOME` and `export -n TERM` take a variable out. Before, the example said grep prints nothing. The lines come in the order bash passes them (by its hash table), with the `SHLVL` bash sets (2 in a script run from a terminal). env gets no made-up environment when the model cannot tell what it prints: a value not known, an export on some paths only, a removal on some paths only of a variable the made-up environment has (`if [ "$1" ]; then unset HOME; fi`), anything the model does not follow (`source`, `eval`), an exported function or nameref, a local of a function, a variable bash sets itself (`_`, `RANDOM`), a shell another command starts (`env -i bash -c 'env'`), another PATH, which may find another env or none, or a shell that is not bash as a script or a terminal runs it (dash, a Dockerfile's `RUN`, a CI step, a Makefile recipe). A variable that changes a layout drops its made-up output too, set before the command or exported earlier: `TIME_STYLE=long-iso ls -l` (dates as `2026-10-29 02:23`), `PS_FORMAT=pid,comm ps` (`PID COMMAND`), `QUOTING_STYLE=c ls`, `BLOCK_SIZE=K ls -l`, `COLUMNS=40 ps aux`, a locale whose dates or decimal point differ (`LANG=de_DE.UTF-8 ls -l`, `LC_NUMERIC=de_DE.UTF-8 df -h`), `LANGUAGE` or `LC_MESSAGES` where coreutils' messages are installed (`insgesamt` for `total`), and `LC_ALL=C who` (dates as `Mar  3 09:30`). Before, these showed the default layout. So do a nameref (`export r=…` may export one of them), a function that sets one of them where the model does not see every call (`"$@"`), an export on some paths only, a removal on some paths only of `LANG` (the made-up environment has it), and a shell another command starts, which may not get the made-up `LANG`. `LC_ALL=C ls -l` and `TZ=UTC ls -l` keep it: ls prints the same there. A script the model does not follow everywhere (`source`, `read n` then `$(( n * 2 ))`) keeps it too, unless the script itself sets one of these variables where it cannot tell.

The input section of a command's own example names where a pipe brings it from:

| Written | Input label now | Before |
| --- | --- | --- |
| `echo '{"a":1}' \| jq .a` | stdin (output of `echo '{"a":1}'`) | stdin (output of the previous command) |
| `ls -l \| awk '{print $5}' \| paste -sd+` (awk's example) | stdin (sample output of `ls -l`) | stdin (sample output of the previous command), with lines that were not `ls -l`'s |
| `cat a.json \| jq .items[]` | stdin (`a.json` through `cat`, sample contents) | stdin (sample output of the previous command) |
| `curl -s url \| jq .name` | stdin (output of `curl -s url`, not known here: made-up lines) | stdin (sample output of the previous command) |
| `grep x a > f \| sort` | stdin (made-up lines: `grep x a > f` writes its output elsewhere, not to the pipe) | stdin (sample output of the previous command) |

Each section that a later command reads marks what that command reads of it. The mark is a background and an underline, and a screen reader hears what it is ("matched by `grep nginx`", 「`grep nginx` が一致する部分」). Lines the command leaves out are dimmer. The marks are what the real tool does: they are checked against GNU grep, GNU sed, gawk, GNU cut and `sort --debug` on the made-up lines.

| The command after the section | Marked | Dimmer |
| --- | --- | --- |
| `grep nginx`, `grep -i`, `-w`, `-x`, `-E`, `-F`, `-P`, several `-e` | every match on a line grep reads, as `grep -o` prints it (the longest, for a POSIX regex) | the lines it does not print; with `-m N`, the lines after the Nth, which it does not read |
| `grep -v grep` | the matches, on the lines it leaves out for them | those lines |
| `sed -n '/re/p'`, `sed '/re/d'`, `sed '/re/!d'`, `sed 1d`, `sed '$d'` | the first match of the regex | the lines it does not print |
| `sed 's/re/x/'` (with `g` or a number) | what it replaces | with `-n`, the lines it does not print |
| `awk '{print $2}'`, `$NF`, `-F:`, `$3 > 1 {…}` | the fields it reads (not `$0`), while the line is as read | with patterns, the lines no rule selects; the lines after `exit` |
| `awk '/nginx/'`, `awk '!/grep/'` | the first match of the regex, as `match()` finds it | the lines no rule selects |
| `cut -d: -f1`, `-f2-`, `--complement`, `-c1-20` | the fields or characters it prints (a line without the delimiter whole) | with `-s`, the lines without the delimiter |
| `sort -k5 -h`, `-k2,2`, `-t: -k3n` | each key, as `sort --debug` underlines it: with `-n` or `-h`, the number it reads | (none) |

`head`, `tail`, `wc`, `uniq`, `tr`, `sort` without `-k`, and sed and awk programs other than those above get no marks. In the box of a single command's example (`cut -d: -f1 /etc/passwd`, `sort -k2`) and in the editable input of a pipeline, what the command reads is highlighted as a regex match is.

When a section is wider than the panel (`ps aux`, `ls -l` on a phone), it starts scrolled so that its first mark is in view, with the header row, which scrolls with it. An edge fades where more lies beyond it. Text outputs (the CLI, Markdown, the hover) show no marks: a code block cannot, and the section after shows what the command kept.

### The opening (web page)

The web page opens with a full-screen overlay: the logo, and the line `sort -u "$file" | wc -l`, which is read the way the explainer reads it.

1. The plain line appears, and bash's tokens lift one by one, each in a box: `"$file"` is one word with its quotes, and `|` is an operator.
2. The parts take their colours in the order they become known: the pipe and the command names (bash's reading), then the options and the argument (what `sort` and `wc` make of them).
3. When the page is ready, each part gets a label with what the explanation says of it ("Sort lines", "target file", "Pipe"; in Japanese 「行を並べ替える」…). On a phone the labels are a list under the line.

The labels are taken from the explanation when the page is built, so they say what the panel says. The overlay covers the page while it starts; before, the page showed an empty editor and panel for that time. In full it lasts about 2 seconds on a fast connection, about a second longer than the page takes to start. After a slow start it leaves about half a second after the page is ready.

- It plays only on the first load in a browser session. Later loads, and a link to a script (`#z=`), show the editor from the start, also when that tab is reloaded.
- With reduced motion it is a still picture that leaves as soon as the page is ready.
- A key, a click, a tap or the wheel ends it. A key still reaches the page.
- It is hidden from screen readers, and nothing in it takes the focus.
- It is not shown in `?view=panel` (the page embedded as a panel), and not without JavaScript.

### What a note rests on

Most notes say what the Bash manual says, and link its sections. A few say what bash does where the manual is silent. For these, a chip after the note says "Not in the manual · checked with bash 5.2 and 5.3" (「マニュアルに記述なし・bash 5.2・5.3 で確認」). Where the manual says otherwise, it says "Differs from the manual · checked with bash 5.2 and 5.3" (「マニュアルの記述と異なる・bash 5.2・5.3 で確認」). The chip names only the releases the command below it was run in, and printed the same in. Its tooltip says that messages are as with `LC_ALL=C`.

Every note was checked against the Bash 5.2 manual, section by section. Not in the manual:

- `exit 300` gives 44. The manual's sections 2 and 3.7.5 imply it without stating it for `exit`. `return 300` gives 44 too, but section 4.1 states that for `return`, so its note has no chip.
- `unset -fv x f` is an error, and nothing is unset. Section 4.1 describes `-f` and `-v` one at a time.
- `unset` of a read-only variable fails with status 1; the manual says "non-zero".
- `x=1` where `x` is read-only abandons the rest of the line (or the subshell) with status 1.
- A restricted shell (`set -r`, `rbash`) refuses with status 1.
- In POSIX mode, a function named like a special builtin (`eval() { …; }`) stops the script.
- A missing `;` before `then` or `do`, and an extended glob such as `@(a|b)` without `shopt -s extglob`, are syntax errors that stop the script. A shell started by the script (`bash -c`) has `extglob` off again.
- `v=${arr[@]}` joins the elements with spaces, whatever `IFS` is. Section 3.4.2 says it of `v=$@`; section 6.7 only calls `${arr[@]}` "analogous".
- `export` of an array exports nothing. The man page says so under BUGS; the Reference Manual does not.
- In bash 5.3's `${ …; }`, `set -e` is off: only bash 5.3 is named on this chip.

Differs from the manual:

- `[ a b ]` and `[ a b c ]` fail with status 2 ("unary operator expected", "binary operator expected"). Section 4.1 says such tests are false. So does `[ $x = y ]` when `x` is empty, in the caveat on unquoted variables in `[ ]`.
- `x=2 cmd`, where `x` is read-only, still runs `cmd` (status 0). Section 3.7.1 says the command exits with a non-zero status.
- With `set -u`, an unset variable in the redirection of a program (`cat < "$f"`) fails that command with status 1, and the script goes on. Section 4.3.1 says a non-interactive shell exits.
- `$BASH_SUBSHELL` in the words of a simple command of a pipeline is not counted (the new note): `echo $BASH_SUBSHELL | cat` prints 0. Section 5.2 says it is incremented in each subshell. What the command runs counts it: `eval 'echo $BASH_SUBSHELL' | cat` prints 1, and there is no note.

Some notes now link the sections that state what they say: the status of a function or a script ends with that of its last command (3.2.4, 3.3, 6.1), `export x=$(cmd)` hides the failure (4.1), `(( i++ ))` is 1 when `i` is 0 (3.2.5.2), a `then` read as an argument (3.2.1), `[` without `]` fails with status 2 (3.7.5: a builtin used wrongly returns 2).

The explanations of the parts of a line carry the same chip where their text says what bash does beyond the manual: the rows of Meaning and the nodes of Reading, the hover's rows, Copy as Markdown and the command-line tool (its JSON gives the tokens a `basis` and a `tryIt`). They were checked against the manual as the notes were, among the texts of the chapter 5 and 6 audits (below, "Reading as the Bash manual reads it"). Not in the manual:

- `$_` after a command of assignments only is empty (`a=1; echo "$_"`).
- `$COLUMNS` and `$LINES` are not set when bash starts: until a program ends at a terminal, only the environment gives them.
- `$BASH_REMATCH` is empty after a match that fails; `${BASH_SOURCE[0]}` outside a function is the file running; a script has no `$HISTFILE`; `$OPTERR` is 1 at start, and `getopts` prints its messages unless it is 0.
- `RANDOM=7` gives the same numbers each time.
- `FUNCNEST=10`: a deeper call abandons the rest of the command, with status 1 (the manual: "the current command to abort"). In bash 5.3, a `bash -c` string ends there instead; a script file goes on with its next line.
- `PATH=…` makes bash forget the commands `hash` remembered; `PWD=…` changes only the variable; unsetting `POSIXLY_CORRECT` turns POSIX mode off.
- `local RANDOM=3` is a plain variable; bash ignores `LINENO=5` and `BASH_COMMAND=x` (the manual says so of `BASHPID` and others, not of these two).
- An assignment to a read-only variable abandons the rest of the line, or ends a subshell, with status 1.
- `bash -Z` and `bash -x --posix` exit with status 2 (1 after `-e`); a lone `+` among bash's options is skipped.
- `alias a/b=x` and `alias =x` fail with status 1; `a[@]=x` is refused with status 1; `export e[1]` and `declare -p a[1]` fail with status 1.
- bash 5.2 brace-expands `[4]={a,b}` in an array's list, 5.3 does not; after a value with no `[key]=` in an associative array's list, bash 5.3 also abandons the line. These chips name bash 5.2, whose output their try-it shows.
- In POSIX mode: `. ./lib.sh` that finds no file ends the script with status 1; `kill -SIGTERM` fails with status 1; `${!#}` expands to nothing; `trap INT` is a usage error (status 2) that ends the shell. `time` alone prints zero times.
- An arithmetic syntax error (`$((1 +))`) abandons the rest of the line, status 1; `((2 *))` fails with status 1.

Differs from the manual:

- `BASH_XTRACEFD=7` leaves the descriptor named before open. The manual says it is closed when the variable is assigned a new value.
- `x=2 cmd`, where `x` is read-only, still runs `cmd`: the row of `x=2` says so too.
- Of an alias whose text is an alias ending with a blank (`alias t=s s='sudo '`), bash 5.2 does not check the next word; bash 5.3 does, as the manual reads. bash 5.2 keeps a `~` in an associative array's list as written; bash 5.3 expands it, as the manual says of every value of the list. These chips name bash 5.2, whose output their try-it shows.

Under the chip, "Try it in your terminal" (「端末で試す」) opens a command to copy and what it prints:

```
bash -c 'f() { :; }; x=1; unset -fv x f; echo "status $?, x=$x"; type -t f'
bash: line 1: unset: cannot simultaneously unset a function and a variable
status 1, x=1
function
```

The command starts a bash of its own, so it prints the same when typed into zsh or fish. The explainer never runs it. The output is the one recorded by the project's tests, which run the command again in bash 5.2 and 5.3 on every change.

The hover and Copy as Markdown say both on one line in italics. The command-line tool prints them under the note. Its JSON gives each fact a `basis` and a `tryIt`.

The command-line tool's JSON also names the spec a program's explanation comes from: the token of `grep -rn x .` has `"basis": { "kind": "spec", "command": "grep" }`. The name is the dictionary's (`/bin/sed` is `sed`, `egrep` is `grep`, `dash -c`, read with the options of `sh`, is `sh`; bats' `run` is bats'). A command another one runs has its own (`rm` of `sudo rm -rf x`), never that of the command that runs it. An alias has the spec its words are read with (`alias g=grep`: the token of `g -n x f` names `grep`; an alias to a builtin, a function, or with options in its text, as `alias ll='ls -l'`, has none). Builtins, bash's own options, functions, commands the dictionary does not know and those of `bashExplainer.customCommands` have none: their text is the manual's, or the reader's. The tokens the command reads (its options, operands, and the regex of `grep -E`) carry nothing: they rest on the command's token above them, unless they have a basis of their own. No view shows it; the JSON of the project's sample script grows by 0.85%.

`bashExplainer.notes.basis` (on by default; `--set notes.basis=false` for the command-line tool) turns the chips and the try-its off, in every output, the JSON included.

Some warnings and caveats state a fact of bash that bites only with some values, and advise a common habit that rules it out: quote expansions, write `read -r`, `set -o pipefail`. The command-line tool's JSON names that habit, as data: a fact gets a `convention` (`"convention": "declare-then-assign"`), and so does a problem of `--check --format json` (`{"code": "read-without-r", …, "convention": "read-r"}`). No view shows it, and `notes.basis` off leaves it out. The habits, and who states them, are listed in src/conventions.ts:

| `convention` | Habit | Notes |
| --- | --- | --- |
| `quote-expansions` | Quote every expansion (ShellCheck SC2086) | an unquoted variable as a path, or in `[ ]` |
| `quote-all-arguments` | `"$@"` (SC2068, SC2048) | `for a in $@` |
| `array-for-a-list` | An array, or `*` for one string (SC2124) | `v=$@` |
| `no-loop-over-command-output` | A glob, or `find -print0` (SC2045, SC2044) | `for f in $(ls)` |
| `guard-unmatched-glob` | `[ -e "$f" ] \|\| continue`, or `nullglob` | a loop over a glob |
| `read-r` | `read -r` (SC2162) | `read` without `-r` |
| `declare-then-assign` | Declare and assign apart (SC2155) | `local v=$(cmd)` |
| `pipefail` | `set -o pipefail` (Hadolint DL4006) | a pipeline without it; a Dockerfile `RUN` with a pipe |
| `guard-empty-path` | `${v:?}` (SC2115) | `rm -rf $DIR/…` |
| `read-before-run` | Download, read, then run | `curl … \| sh` |
| `source-by-script-path` | A path from the script's directory | `. lib.sh` |
| `grep-fixed-strings` | `grep -F` for plain text | `grep "$pattern"` |
| `quote-for-shell-in-python` | `shlex.quote()`, or a list (Python's documentation) | `subprocess.run(f"…", shell=True)` |
| `actions-expression-through-env` | Pass it through `env:` (GitHub's security hardening guide) | `${{ github.event.issue.title }}` in `run:` |

## Changed

### A new logo

The logo is a speech bubble whose sides are the brackets `[ ]`, with a prompt `>_` inside: a script, explained. Before, it was a dark tile with coloured tokens over a tree of rows.

- The extension's icon (Marketplace, Open VSX, the Extensions view) is the mark on a dark rounded tile.
- The panel's tab icon and the web page's tab icon are drawn on the pixel grid at 16 px, so they stay sharp at that size, and on a 32 px grid when larger. The panel's follows the editor's light or dark theme, the web page's the system's.
- The web page's top bar shows the mark in the colours of the page's theme.
- The README starts with the mark and the name, in a light and a dark version.

### Share links keep the script out of the address bar (web page)

- **Copy link** (the top bar's button and the menu's item) copies the link and does nothing else. Before, it also put the whole `#lang=…&kind=…&z=…` fragment into the address bar.
- A page opened from a link reads the fragment (`lang`, `kind`, `t` or `z`) and removes it from the address bar at once, by replacing the current history entry: no entry is added, so the back button works as before. Other fragments (an anchor such as `#anchor`) stay.
- The fragment is kept in the tab's session storage (not in the settings; gone when the tab closes). A reload or a return through history reads it again, so the script and the language stay; a plain visit of the address in the same tab shows the sample. Without session storage a reload shows the sample.
- Opening a second link in a tab replaces the first. A link pasted into the address bar of the page that is already open (a change of the fragment only) leaves the open page as it is, takes the fragment off the address bar, and is read by the next reload, as it was when the fragment stayed there.
- The compare page and the switch between the release, development and preview pages carry the script in the fragment as before, and take it off the address bar when they open. The copies of the page in the compare page and in the panel get their script by message and change nothing in the address.

### The inline summary was removed

The faint one-line summary at the end of the cursor line (`bashExplainer.inline.enabled`, off by default) was removed. It repeated the start of the hover on every line the cursor passed, and could say only one thing about a line. The hover now explains the part under the mouse, `Ctrl+K Ctrl+E` the whole line, and the name hints mark what a reader could misread.

- `bashExplainer.inline.enabled` and `bashExplainer.inline.maxLength` stay in the settings, marked deprecated, with no effect.
- A user who had `inline.enabled` on gets a notice when VS Code starts, with **Open settings** and **Don't show again**.
- The status bar's choice of display modes lists the hover and the panel only.

### The hover explains the part under the mouse

Any hover with a position explains the part there: a word, an option, an operator, a redirection, a `$var`. A part that ends exactly at the position counts too, as an editor finds the word at the cursor (`Ctrl+K Ctrl+I` at the end of the line explains its last word). The hover's range is that part, so moving to the next word explains that one, and the editor highlights what is explained.

- The part comes first: the parts around it in one line (`sudo | xargs › sudo ›`), its label coloured by its kind, the badge of a command name (keyword, builtin, function, alias, program) with who runs it, its meaning, "Same name, also" (`cd` is also bash's builtin, run with `builtin cd`), its own parts, and the command it belongs to. Its notes and examples come after: only the notes about the part and its own parts (in `rm $f; read line`, the warning on the unquoted `$f` shows on `$f` and on `rm`, the caveat on `read` without `-r` on `read` only, and a note on a whole pipeline on its first command). A last link, such as "1 more note on this line", opens the whole line, which keeps all of them; a note about the line itself (a line of a here-document's body) is only counted there.
- In the indentation or between statements, a small card shows the line's structure (`grep && echo › grep · echo`) and a **Whole line** link.
- On a line of a here-document's body, or its closing line, the hover explains the `<<EOF` that starts it (or a `$var` in the body). Before, it explained the whole statement.
- The whole line opens with `Ctrl+K Ctrl+E`, the context menu's **Explain Bash on Current Line**, or the **Whole line** link: the line, its structure, then one block per command with its badge, where it is, and its arguments two levels deep. Deeper parts are counted ("3 more in the panel").
- The tree has no glyphs (`├─ └─`) any more: the parts are indented, and their labels are coloured without the code background.
- `hover.followCursor` shows the part at the cursor.
- The Language Server's hover (`textDocument/hover`) starts with the part at the position, in plain Markdown, with its notes, then the whole line below a rule, with all of them. Its range is the part.

### Lists of commands

A list (Bash manual 3.2.4) is pipelines separated by `;`, `&`, `&&` or `||`; `&&` and `||` bind tighter than `;` and `&`. Meaning and Reading now show it so:

| Line | Meaning | Reading |
| --- | --- | --- |
| `a; b & c && d \|\| e` | one **List** over `a`, `;`, `b`, `&` and the AND and OR lists `c && d \|\| e`, "read from the left as `(c && d) \|\| e`" | `list` › `a`, `;`, `b`, `&`, `orList` › (`andList` › `c && d`), `\|\|`, `e` |
| `a && b &` | **List of one command ended by `&`**; the `&` says "Run the whole AND list `a && b` in the background" | `list` › `andList`, `&` |
| `a \| b & c` | the `&` runs "the whole pipeline `a \| b`" in the background | |
| `{ a; b; } &` | the list `a; b;` inside the group, and the group with `&` | the same, nested |
| `if a; then b & fi` | the `;` ends the list before `then` (without it, `then` would not be read as a reserved word); `b &` is a list | every `;` and `&` |
| `x=$(a; b &)` | the list in `$( )`, with its `&` (before, the `&` was left out) | the list in the subshell's script |

- `&&` and `||` alone are an **AND list** and an **OR list** (both: "AND and OR lists"); before, a "Command list joined by `&&` or `||`". Reading names them `andList` and `orList`, nested from the left.
- Each `;` says what it waits for: "Separator: wait for `a` to end, then run the next", or, at the end, "End of the list". After `coproc`, it says that the shell does not wait. Before a reserved word (`then`, `do`, `done`, `fi`, `elif`, `else`, `}`, `esac`), it says that without a `;` or a newline the word would not be read as a reserved word, or that it may be left out after a compound command (`if [[ a ]] then`). Before, every `;` said "Command separator; run the next command regardless of the result", and the `;` inside a compound command was not shown.
- In Reading, a string a shell reads again (`bash -c 'a; b | c'`) names its lists and pipelines as bash's own (`list`, `andList`, `orList`, `pipeline`); before, they were operators.
- The `;` of the head of a `for` is the loop's: it ends the words before `do` (or `{`), or separates the three expressions of `(( ))`. Reading shows it too.
- At the top of a script, a newline ends a list: bash reads and runs a script one line at a time. In a body (`{ }`, `( )`, `$( )`, the parts of `if`, `while` and `case`), a newline separates commands as `;` does, and the body's list is shown on the line of the construct in Reading; each line of it shows its own part.

### Reading as the Bash manual reads it

Reading was checked against chapters 3 to 6 of the Bash manual, section by section (3.1 to 3.4 in a first round, 3.5 to 3.7 in a second, the builtins of chapter 4 in a third, the shell variables of chapter 5 in a fourth, the rest of bash's features, chapter 6, in a fifth). Each construct is now named and grouped as the manual does, and cites its section; every reserved word and operator of a statement, of a parameter or brace expansion and of a redirection is a row of its own. Meaning cites the same sections.

| Section | Line | Before | Now |
| --- | --- | --- | --- |
| 3.1.2.1 | `echo \$a b\ c` | the words cited only 3.7.1 | a word with an escape character (or a line continuation) cites 3.1.2.1 |
| 3.1.3 | `# note` | a comment cited no section | 3.1.3 |
| 3.2.1 | `if`, `do`, `{`, `!` | kind "keyword" | "reserved word", with what one is |
| 3.2.2 | `a b` | a simple command cited 3.7.1 | 3.2.2 and 3.7.1 |
| 3.2.3 | `! a \| b`, `time -p ! a \| b` | a pipeline inside a pipeline | one pipeline: `time`, `-p`, `!`, then its commands and `\|`, as bash's parser reads it |
| 3.2.5 | `while …; done < f`, `f() { :; } > log` | an unnamed "part" around the command and its redirections | the compound command, with its redirections as its last parts, as bash's parser keeps them |
| 3.2.5.1 | `for … do … done` | the body cited no section, and appeared only at step 5 | it cites the loop's section and appears with the commands, at step 3 |
| 3.2.5.1, 6.5 | `for ((i = 0; i < 3; i++))` | `i = 0` cited 3.4 (an assignment), the operators only 3.2.5.1 | expressions, citing 3.2.5.1 and 6.5 |
| 3.2.5.2 | `case $x in a\|b)` | the `\|` cited 3.2.3 (a pipe) | 3.2.5.2; a branch with one pattern no longer says what `\|` means |
| 3.2.5.2 | `select v in a b` | `v`: "receives the next value on each iteration" | "set to the chosen word: the one whose number is typed (an empty string when the line is not one of the numbers)", as bash does |
| 3.2.5.2, 6.4 | `[[ ! -f a && b ]]` | unnamed parts, `!` a reserved word, `-f` with no section | expressions; `!` is an operator of the expression; every operator cites 3.2.5.2 and 6.4 |
| 3.2.5.2, 6.5 | `(( x > 1 ))` | unnamed parts; `1` a word that bash expands | expressions citing 6.5; a number is part of the expression |
| 3.3 | `f() { …; }` | the `( )` were left out | they are rows, citing 3.3; the kind is "function definition" |
| 3.4 | `x=1`, `y+=2` | the `=` and `+=` were not shown | an operator row each, citing 3.4 |
| 3.4.1, 3.4.2 | `${10}`, `${#}` | 3.5.3 only | also 3.4.1 (a positional parameter) or 3.4.2 (a special one) |
| 3.5.5 | `$((1 + $n))` | nothing under the expansion but `$n` | its expression, as in `(( ))`; the kind is "arithmetic expansion" |
| 3.5, 3.5.1, 3.5.2, 3.5.7, 3.5.8 | `echo *.txt $x ~/a x=~/b`, `x=~/a:~/b` | the glob cited 3.5.8 only on the command's reading of it; `$x` cited 3.5.3 only; `x=~/b` and the assignment cited no tilde expansion | each word (and an assignment's value) cites what bash does to it that no part shows, as the word model says where it is: brace and tilde expansion, word splitting, filename expansion. `*.txt` cites 3.5.8 (not after `set -f`), `$x` 3.5.7 and 3.5.8 (no 3.5.7 with an empty `IFS`), `"$x"` neither |
| 3.5.8.1 | `case $x in a*)`, `${x#*/}` | the pattern of `${x#…}` cited 3.2.5.2 (a regex) | a word matched as a pattern cites 3.5.8.1 |
| 3.5.1 | `a{1..9..2}b`, `{a,b}{1..2}` | the braces cited no section; `{`, `..`, `,` and `}` were not shown | 3.5.1; an operator row each, and a row for each string of a list |
| 3.5.1 | `echo {a,b} x{c,{d,e}}y {f,"g h",$v}` | a list had rows only next to a sequence: `{a,b}` alone was one word, with no row for its braces and `,` | a brace expression wherever bash expands one: a row for each brace and `,`, and one for each item (a word, a quote, an expansion, a list inside it) |
| 3.5.1 | `x={1..3}` (a plain assignment, or one before a command), `cat <<< {1..2}`, `[[ x == {1..2} ]]`, `echo {1..3}` in a script for dash | the braces and `..` of a sequence were rows | no rows: bash does not expand braces there, so they are text. An assignment given to `declare`, `local`, `export`, `readonly` or `typeset`, and a definition of `alias`, are words bash expands: `declare x={1..3}` keeps its rows |
| 3.5.3 | `${x:-$y}`, `${x//a/b}`, `${!x}`, `${x@Q}`, `${a[@]:i+1:2}` | one row, with only the expansions inside it | the parameter, each operator (citing 3.5.3), the word after it, a pattern (citing 3.5.8.1), or the arithmetic of a substring's offset and length (citing 6.5). `!` there is an operator, not the reserved word |
| 3.5.4 | `echo "$(< f)"` | "runs the command and is replaced by its stdout", and inside it "Redirection applied to the command" | "replaced by the contents of the file `f` (trailing newlines removed), as `$(cat f)`, but without running `cat`", as bash does; `$(3< f)` and `$(< f; < g)`, which print nothing, are as before |
| 3.6 | `cat 2> e {fd}>k <<< "$x"` | one row per redirection | its descriptor (`2`, `{fd}`, citing 3.6), its operator (citing the redirection's section) and its word, a row each |
| 3.6.6 | `cat <<'E'` | the delimiter was not shown, the body cited no section | the delimiter is a row of its own kind, which bash does not expand; the body cites 3.6.6 |
| 3.6.8 | `cat <&f` | 3.6 | 3.6.8: `<&` only duplicates or closes a descriptor |
| 3.7.1 | `> f`, `x=$(ls) 2>/dev/null` | the command had no text, and the redirection said "Redirection applied to the command" (or to the assignments "as a whole") | the command says what bash does with the redirections of a command with no name (see "Tests and redirections as bash runs them"), and the redirection says what it is |
| 3.7.3 | `echo $(a) <(b)` | the script of a substitution cited no section | 3.7.3 (a subshell's environment) |
| 4.1 to 4.4 | `cd x`, `read x`, `set -e`, `shopt -s x`, `export x` | (as now) | each builtin's name cites the section the manual lists it in, and 4.4 for a POSIX special builtin, whose badge's tooltip says so: "a POSIX special builtin: … In POSIX mode, it is found before functions, an error in it exits a non-interactive shell, and the assignments before it stay after it". `source` and `times` are special too, as bash 5.2 runs them (its manual leaves them out of the list of 4.4, bash 5.3's lists them) |
| 4.1, 6.4 | `[ -f a ]`, `test ! -f a -a b` | the name `[` cited no section; the expression of `test` and `[` none | `[` cites 4.1, as `test` does; each expression of bash's builtin cites 4.1 and 6.4 (not that of coreutils' `[`, `env [ -f a ]`) |
| 4.1, 4.2, 3.7.2 | `builtin cd /`, `eval "echo hi"`, `bash -c 'ls'` | the name `builtin` runs cited no section; a name in a string a shell reads again cited only its builtin's | the builtin's section; 3.7.1 and 3.7.2 too, as a name bash reads in the line |
| 4.1 | `exec >log 2>&1`, `exec 3>&1` | "Redirection applied to `exec` … The shell sets this up before the command starts, so the command does not see the redirections" | "Redirections of `exec` with no command: they apply to this shell itself, so its stdout (fd 1) and stderr (fd 2) stay redirected for every command after it", as bash does; `exec cat >log` is as before |
| 4.3.1 | `set -- a b`, `set --`, `set - a`, `set a b` | `--`: "End of options: everything after is a plain argument"; the words: "Word `a`"; `-`: "Word `-`" | `--`: "ends the options; the words after it become the positional parameters `$1`, `$2`…, even those that start with `-` (with none, the positional parameters are unset)"; `a`: "becomes the positional parameter `$1`"; `-`: "ends the options, and turns `-x` and `-v` off; the words after it become the positional parameters (with none, they stay as they are)". From a word that may expand to more or fewer words (`set -- a $x b`), the number adds "(if this word or one before it expands to more or fewer words, the number shifts)", as for the arguments after `bash -c '…' name`, which said `$2` with no such caveat before |
| 5.1, 5.2 | `echo $PATH ${HOME}`, `$((RANDOM % 6))`, `"${BASH_SOURCE[0]}"`, `PATH=/x` | `$PATH` cited 3.5.3 only; the name in `${HOME}`, in arithmetic and of an assignment cited nothing | also the section of chapter 5 that describes the variable (5.1 or 5.2); an element of one cites 6.7 too |
| 5.1, 5.2 | `$CDPATH`, `$PS4`, `$BASHPID`, `$EPOCHSECONDS`, `$TIMEFORMAT`, `$COMP_WORDS`… | 22 of them had a text; the 85 others of the manual's lists said "Expands to the value of `PS4`" | every variable of 5.1 and 5.2 says what it is, as the manual describes it; `$UID`, `$EUID`, `$PPID`, `$BASHOPTS`, `$SHELLOPTS` and `$BASH_VERSINFO` add "(read-only)"; `${BASH_SOURCE[0]}` and `${PIPESTATUS[@]}` say what the array holds |
| 5.1, 5.2 | `$HOME`, `$REPLY`, `$FUNCNAME`, `$BASH_SOURCE`, `$BASH_REMATCH`, `$IFS` | "Home directory"; "Default variable set by `read`"; "Array of function names on the call stack"; "`${BASH_SOURCE[0]}` is the current script"… | as bash sets them: `$HOME` is where `cd` goes and the value of `~`; `$REPLY` is the whole line `read` reads with no name, and the line typed to `select`; `$FUNCNAME` is empty outside a function and ends with `main` in a script; `${BASH_SOURCE[0]}` in a function is the file that defines it; `$BASH_REMATCH` is empty after a match that fails; `$IFS` is also what `read` splits on |
| 5.1, 5.2 | `PATH=/x`, `OPTIND=1`, `HOME=/h`, `CDPATH=…`, `PS4=…`, `GLOBIGNORE=…`, `TIMEFORMAT=…`, `TMOUT=5`, `LC_ALL=C`… | "Assign a value to variable `PATH` (no spaces around `=`)" | also what it changes from there on: commands are looked up in these directories, and bash forgets the paths `hash` remembered; `getopts` starts again at `$1`; `GLOBIGNORE` also turns `dotglob` on; `PWD=…` changes only the variable. Not for one command (`PATH=/x cmd`). 26 variables, each checked with bash 5.2 and 5.3 |
| 5.2 | `BASHPID=1`, `LINENO=5`, `FUNCNAME=x`, `SRANDOM=1` | an assignment | "Bash ignores this assignment (it sets `BASHPID` itself)" |
| 3.4, 5.2 | `UID=0`, `readonly x=1; x=2` | "Assign to the integer variable `UID` (it has `-i`, so the value is evaluated as arithmetic)" | "`UID` is read-only, so this assignment fails and its value stays: bash abandons the rest of the command of the script it is in (the line, or the loop or function call around it), status 1", with a warning (`readonly variable`). In a subshell, the subshell ends there; before a command name (`UID=0 echo hi`), the command still runs. Read-only on some paths only: said so, with no warning |
| 5.2 | `unset RANDOM`, `unset SECONDS` | "Unset the variable `RANDOM` (it becomes undefined)" | also: it loses what bash does with it, even if it is set again (the 17 variables the manual lists so); in `( unset SECONDS )`, in that subshell only. Not for a local of a function (`local RANDOM; unset RANDOM`): the one outside keeps it |
| 5.2 | `f() { local RANDOM=3; }`, `declare SECONDS=100` in a function | (as `RANDOM=3`) | "Here `RANDOM` is a local of the function, a plain variable: bash does nothing special with it": bash prints `3 3` for `$RANDOM $RANDOM` there, and the `RANDOM` outside stays random. `local OPTIND=1`, `local PATH=…` still do what they do |
| 5.2 | `BASH_XTRACEFD=7`, `BASH_XTRACEFD=`, `OPTERR=2` | — | `BASH_XTRACEFD=7` sends the trace there, and the descriptor written to before stays open; an empty value sends it back to stderr and closes that descriptor (even 2, as the manual warns). `getopts` is silent only when `OPTERR` is 0 |
| 6.1 | `bash -a -f -C -k -v … script`, `bash --rcfile f --norc -i`, `bash --version`, `bash -D x.sh` | 14 letters of `set`, `-r`, `-D` and 13 long options: "Option (not in the dictionary)"; `--rcfile f` took `f` as the script, so every word after it was a script argument | every option of `bash --help`: the letters of `set` with `set`'s own texts, the others as 6.1 says (`--rcfile` takes a file, `--version` runs nothing). An option bash does not have: "bash says `invalid option`… (status 2)" |
| 6.1 | `bash -c -e 'echo $-'`, `bash -c - 'cmd'` | `-c`: "run the following string as a command"; the string: "Value for `-c`" | `-c`: "read the commands from the first argument after the options (the command string)…"; the string: "The command string" (bash prints `ehBc`). A lone `-` ends the options |
| 6.1 | `bash -x --posix -c 'echo hi'`, `bash --rcfile=f`, `bash -login` | `--posix` and `--rcfile=f` were options; `-login` was the letters `-l` `-o`… | a long option after a short one: "bash reads long options only before the others… `--: invalid option`" (bash exits with status 2); no `--name=value`; before the others, `-login` is `--login`, as bash reads it. `+c`, `+l`, `+s`, `+D` are their `-` forms, and a lone `+` changes nothing (bash skips it) |
| 6.1 | `bash -O`, `bash +O`, `bash -o` | "enable a `shopt` option by name" | "`-O` alone (no name): list the `shopt` options and their values"; `+O`: as `shopt -u autocd` lines |
| 6.1, 6.2, 6.3.1 | `bash -i`, `bash -l`, `--norc`, `--noprofile`, `-s` | "act as an interactive shell", "do not read the login profile files"… | what each changes: `-i` reads `~/.bashrc` and expands aliases, `$-` has `i`; `-l` reads `/etc/profile` and the first of `~/.bash_profile`, `~/.bash_login`, `~/.profile`, even when not interactive |
| 6.1, 6.10 | `bash -c 'x'`, `exec bash --login`, `rbash -c 'x'` | `bash` cited 3.7.1, 3.7.2; `rbash`: "Run the external command `rbash` (not in the dictionary)" | `bash` also cites 6.1; `rbash` is "the restricted shell (bash started with the name `rbash`: as `bash -r`)", citing 6.1 and 6.10 |
| 3.8, 6.1 | `#!/bin/bash -eu`, `#!/bin/bash --posix`, `#!/bin/bash -r`, `#!/usr/bin/awk -f` | the shebang had no parts | the word after the interpreter, as the interpreter reads it: `-e` and `-u` with their texts; `-f` "(its value is the next argument, the script's path)" |
| 6.3.2 | `case $- in *i*)`, `[ -z "$PS1" ]` | `$-`: "Current shell option flags"; `$PS1`: "(a shell running a script does not set it)" | `$-`: "The letters of the shell options in effect (`e` after `set -e`, `i` in an interactive shell…)"; `$PS1`: unset in a shell that is not interactive, even when the environment gives it. Both also cite 6.3.2 |
| 6.10 | `bash -r`, `--restricted`, `set -r`, and in a script that starts restricted (`#!/bin/bash -r`, `#!/bin/rbash`, `#!/usr/bin/env rbash`, `bash -r -c '…'`): `cd /`, `builtin cd /`, `/bin/echo x`, `"$d/x"`, `echo hi > f`, `exec cmd`, `. ./f`, `. "$d/lib.sh"`, `command -p ls`, `hash -p /bin/ls ls`, `history -r ~/h`, `enable -f x y`, `PATH=/x`, `unset SHELL` | `-r`: "Option (not in the dictionary)"; `set -r`: "An option bash's `set` does not have"; the lines: as in any shell | `-r` says what a restricted shell refuses; each such line warns "This is a restricted shell (`bash -r`, `rbash`), so bash refuses this `cd` (`cd: restricted`)…", and `PATH`, `SHELL`, `ENV`, `BASH_ENV`, `HISTFILE` are read-only there. Not `>&2`, `pushd -n`, `popd +1`, `exec 3<f`, `command -v`, `command -p` alone, a `/` only inside an expansion (`"${tool##*/}"`), a function's own redirection. After `set -r`, the variables stay writable, as in bash 5.2. `shopt -u restricted_shell` changes nothing, as in bash |
| 6.6 | `alias s='sudo '`, then `s ll` | `ll` was a word passed on to `sudo` | `ll` is an alias too: the text of `s` ends with a blank, so bash checks the next word for an alias (`s ll` runs `sudo ls -l`); the definition says so. A quoted word (`"b"`, `"$v"`, `\b`) is not checked and leaves the check to the next one; an unquoted word that is no alias, `$v` or a redirection ends it. An alias whose text is another alias ending with a blank (`alias t=s s='sudo '`): bash 5.3 checks the next word, 5.2 does not, and the text says so |
| 6.6 | `alias a/b=x`, `alias =x` | "an alias definition" | "a definition bash refuses … (`invalid alias name`, status 1)", only where the name is known (`alias "$n=$v"` is a definition); `=x` has no name, so bash looks for an alias `=x` and fails ("not found") |
| 6.7 | `${a[i+1]}`, `a[i+1]=x`, `$((a[i]))`, `${m[$k]}`, `${a[@]}` | one row `a[i+1]` | the name, `[`, the index and `]`: an indexed array's index is an arithmetic expression, with its operators, names and numbers (6.5); an associative array's is a word bash expands, a key; `@` and `*` are a row of their own. Where the kind is not known (after `source`), a word |
| 6.7 | `a=(one $x [5]=five)`, `declare -A m=([k]=v)` | each value one word, citing an empty list; no rows for `(` and `)` | the list, with `(` and `)`, each value a word citing what bash does to it; `[5]=five` is `[`, the index (or key), `]`, `=` and the value |
| 6.7 | `a=([0]=$x [1]=*)`, `declare -A m=(k $x *)` | `$x` "word-split and globbed", `*` "Glob pattern" | a value `[k]=v`, and every value of an associative array's list, is neither split nor globbed; an associative array's has no brace expansion either (`m=(k {a,b})`), and its keys and values say which they are. bash 5.2 brace-expands `[4]={a,b}` into plain values (`[4]=a`, `[4]=b`), 5.3 does not; bash 5.3 expands a `~` in an associative array's list, 5.2 does not: the texts say both |
| 6.7 | `a=(x [3]=y)`, `a+=(z)`, `declare -A m=(k1 v1)` | "Assign a value to variable `a`", "Append to variable `a` (adds elements for arrays)" | an indexed array of the values from index 0, where `[n]=` sets index n and the values after it go on from there; `+=` appends after the last index; an associative array takes `[key]=value`, or keys and values in turn when the first value has no `[key]=` (then `[k]=v` is a key too); a value with none after a first `[k]=v` is refused (bash 5.2 goes on; 5.3 abandons the rest of the line) |
| 6.7 | `a[@]=x`, `unset 'm[@]'` (`m` associative), `unset 'a[-1]'` | "Assign to element `[@]`", "Remove all the elements of the array `m`" | `a[@]=x` is refused ("bad array subscript"); in an associative array, `@` and `*` are keys; a negative index counts back from the end |
| 6.7 | `declare -a x[3]`, `export e[1]`, `declare -p a[1]` | "Element `[3]` of array `x`" | `declare` declares the array `x` and ignores the subscript; `export` and `readonly` refuse the word ("not a valid identifier"); `declare -p` finds no such name |
| 6.7 | `a=(x y); echo $a[1]` | — | a warning: `$a[1]` is `${a[0]}` followed by the text `[1]` (a glob too, where bash globs the word); an element needs braces, `${a[1]}` |
| 3.5.2, 6.8 | `echo ~+1 ~-1 ~2 ~0` | "text to print": the tilde prefixes of the directory stack were not read | "Tilde expansion: `~+1` becomes entry 1 of the directory stack, counted from the left of `dirs` from 0 (what `dirs +1` shows; unchanged if there is no such entry)"; `~-1` from the right; the word cites 6.8 |
| 6.8.1 | `pushd`, `popd` | "Push a directory onto the stack and cd to it"; "Pop the directory stack and cd to it" | also: with no argument, `pushd` exchanges the top two entries; `popd` cds to the new top; both print the stack as `dirs` does |
| 6.9 | `PS1='\u@\h:\w\$ '`, `PS4='+ ${LINENO}: '`, `export PS1="\[\e[1;32m\]\u\[\e[0m\] "` | a single-quoted string, read no further | the value is a prompt string, which bash itself reads each time it prints the prompt: a row per escape (`\u`, `\w`, `\D{%H:%M}`, `\033`, `\[`…), a row per expansion done then (`${LINENO}`), and why the value is single-quoted. PS0, PS1, PS2 and PS4, not PS3; a backslash the expansion removes (`\\$HOME` prints `$HOME`, `\"` prints `"`), and `!` and `!!`, which POSIX mode reads in PS1 and PS2 |
| 6.11 | `set -o posix` then `kill -SIGTERM $pid`, `kill -s SIGTERM $pid` | "Send the signal `TERM`" | bash refuses a name with `SIG` in POSIX mode: `invalid signal specification`, status 1, nothing sent |
| 6.11 | `shopt -s xpg_echo` then `echo -n 'a\tb'`, `echo -E 'a\tb'` | `-n`: "do not print the trailing newline"; `-E`: "(default)" | with `xpg_echo`, `echo` reads escapes unless `-E` is given; in POSIX mode too, it takes no options (`-n` is printed) |
| 6.11 | `set -o posix` then `ulimit -f 1024`, `${!#}`, `trap INT`, `. ./lib.sh`, `time` | "most sizes in KiB"; "the positional parameter numbered `$#` is the last argument"; "signal to reset"; —; "Measure and report the run time of the pipeline" | `-c` and `-f` count blocks of 512 bytes; `${!#}` expands to nothing; `trap INT` is a usage error that ends the shell (`trap - INT` resets); a file `.` does not find ends a script; `time` alone prints the times the shell has used (outside POSIX mode, zero times) |
| 6.11 | `set -o posix`, then on a later line `time -p cmd`, `command kill -SIGTERM 1`, `command . ./lib.sh` | `time` the reserved word; the builtin's text without POSIX mode | `time -p` on a line bash reads in POSIX mode runs the program `time` (not at compatibility level 41); behind `command` or `builtin`, a builtin reads its words as in POSIX mode, but `command .` does not end the shell |
| 6.5 | `echo $((1 +))`, `((2 *))` | "Arithmetic: `1` + `1`" | an arithmetic syntax error (`operand expected`): bash abandons the rest of the line (`(( ))` fails), status 1 |
| 6.12 | `shopt -s compat31 compat44`, `BASH_COMPAT=50` | "compatibility mode: behave as bash 3.1 did where it differs" for each | one change of each level (`compat31`: a quoted right side of `=~` is a regex), and that there is one level at a time: turning one on turns the others off. `BASH_COMPAT` 50 and 51 have no `shopt` option |
| 6.6, 6.9 to 6.12 | `set -o posix`, `shopt -s compat42`, `shopt restricted_shell`, `bash -O compat31`, `BASH_COMPAT=42`, `PS1=…`, `POSIXLY_CORRECT=1`, `$DIRSTACK` | the option's name cited no section; the variables cited 5.1 or 5.2 only | the option's name cites the section of chapter 6 that describes it (6.11, 6.12, 6.10, 6.6, `promptvars` 6.9); the variables cite it after their own (6.9, 6.11, 6.12, 6.8). `set -o posix` also says it sets `POSIXLY_CORRECT` |

The operands and options of the builtins read in chapter 4 are under "Strings, braces and options". The badge of a special builtin still says "builtin": the manual says they differ from the others in POSIX mode only, so its word stays and the tooltip names the class.

Left: quote removal (3.5.9) is not cited (the quotes cite their own sections). Which braces bash expands is checked with bash on a table of words and on random ones (see "Words as bash reads them"). The grouping is checked against bash's own parser (bash-ast), the parts of each redirection too; the `select` text, the expansions of words, `$(< f)`, the redirections of a command with no name, and what bash does with each variable of chapter 5 against bash.

### Note levels

A note says how much it matters, with a mark, a word and a colour:

| Level | Mark and word | When |
| --- | --- | --- |
| Warning | ⚠ Pitfall / 落とし穴 | The line breaks as written, or if it goes wrong the damage cannot be undone: `x = 1`, `[-f x]`, `rm -rf $DIR/*` with an empty `DIR`, a stop under `set -u`. |
| Information | ⓘ Caveat / 注意 | It goes wrong only with some values or systems and the damage is limited, or a failure goes unnoticed: `echo $x`, `read line`, `local x=$(false)`. |
| Information | ⓘ Portability / 移植性 | It works differently in the target shell: dash's `echo` reads `\n`. |
| Note | ℹ (no word) | A fact of how the shell runs the line. |

- The panel shows the level's icon (VS Code's warning and info icons) and its word in bold, in the editor's warning or info colour (ours where the theme's is too light as text), and colours the note's left border. A plain fact keeps the grey border and a muted icon. The panel's copy of the line underlines the line's problems as the editor does.
- The hover shows the same icon and word; the command line colours the mark and the word (yellow, blue); Copy as Markdown keeps the mark and puts the word in bold (`> ⚠ **Pitfall:** …`).
- The web page's editor draws a warning's squiggle in yellow and an information's in blue, the colours of the panel and of the Problems list, in the light and the dark theme. Its gutter shows the panel's icons in those colours (a triangle, a circled i), and the tooltip of a problem starts with the same icon, named "Warning" or "Information" for a screen reader. Before, an information's squiggle was grey, and the gutter showed CodeMirror's own marks: a yellow triangle and a purple square.
- Every view lists the warnings first, then the information, then the plain facts.
- A construct the target shell lacks (`[[ ]]` in sh) stays a warning, with no word: its text says it fails, and where. A note on what works differently started with ℹ before; it is ⓘ Portability now.
- The notes that say a command fails when it runs are warnings now: `[` without `]`, `[ -f x]`, a `[` test it cannot read, `unset` of a read-only variable, `unset -f -v`.
- `(( i++ ))` and `(( i-- ))`, whose status is 1 when `i` is 0, are a warning when `set -e` is on there (the script stops at the first run of a counter that starts at 0), and information otherwise (also where `set -e` may or may not apply, as in a function called both in an `if` and alone). Where `set -e` surely does not apply (`(( i++ )) || true`, `if (( i++ ))`), there is no note, as before.

Problems whose severity changed:

| Code | Now | Before |
| --- | --- | --- |
| `unquoted-variable-as-path` given to `rm`, `mv` or `cp` | warning | information |
| `dockerPipefail` (a Dockerfile `RUN` pipe without pipefail) | information | warning |

`for-over-ls-output` and `for-over-unquoted-args` are information: they break only names with spaces (they are new problems in this release).

### Syntax colouring, on by default (`bashExplainer.highlight.enabled`)

The colours from the explanations' own reading (semantic tokens over VS Code's grammar) are on by default. Before, `bashExplainer.highlight.enabled` was `false`. They are drawn in shell scripts, bats files and the shell code of Makefiles, CI YAML, package.json scripts, Markdown and Jenkinsfiles; not in Python files and Dockerfiles, whose language servers (Pylance, the Docker extension's) would lose their colours.

The setting can be set per language, as VS Code's own settings are:

```json
"[makefile]": { "bashExplainer.highlight.enabled": false },
"[yaml]": { "bashExplainer.highlight.enabled": false }
```

`yaml` covers GitLab CI files, and GitHub workflows when the GitHub Actions extension is not installed (with it, their language is `github-actions-workflow`). To stop explaining a kind of file altogether, leave it out of `bashExplainer.embedded.files`.

What the colours follow now:

- A command name is coloured as what bash runs there, as the panel's badge says it: a function only where it is defined (`f` before `f() { …; }` is a program), an alias (a `macro` token) only where bash expands it (`shopt -s expand_aliases`), a builtin turned off by `enable -n` as a program, `mapfile` as a program in `sh`. A command run by another one is coloured too: `sudo echo` runs the program `echo`, `xargs rm` and `find . -exec rm {} +` the program `rm`, `builtin cd` the builtin. Before, a function was any name the script defined anywhere, and the builtins came from a list of bash's.
- A word the command's spec reads as data is a plain argument, not an option: `-v` in `grep -e -v`, `-x` after `--`, `-i` in `declare x -i`, `-foo` in `find -name -foo`. It takes the grammar's colour of a plain argument (`string.unquoted.argument.shell`, through our token modifier `unquoted`), not that of a quoted string. `test`'s and `[`'s operators (`-f`, `-eq`) stay options.
- A variable is marked `readonly` (the theme's colour of constants) or `exported` (our own modifier, for themes and `editor.semanticTokenColorCustomizations`) where the state says so, as in `readonly R=1; echo "$R"`. Nothing is marked where the model cannot follow the script (after an `eval`, for example). `local` keeps what bash keeps: a local copy of an exported variable is exported too (`export E=1; f() { local E=2; }`), and `local R` of a readonly global variable fails, so `R` stays readonly (a caller's readonly local may be hidden).
- Each shell of a host file (a workflow step, a recipe line, a GitLab job's script) is read with its own state, as the explanations read it: a function of one step is a program in the next.
- The colours follow the shell: changing `bashExplainer.shell`, or the shell in the panel's menu, colours the script again.
- On the web page, the same colours: the shell menu changes them where a name is a builtin in one shell only. A readonly variable is in bold there, an exported one underlined (dotted).
- A range request (the visible lines) reads the names and the specs on those lines only. On a 5,000-line script it takes about 5 ms once the script's model is built, which the panel and the problems share. A script that uses one variable many times is coloured in a time linear in its length (20,000 lines of `x=$i; echo "$x"`: about 0.3 s, where a first version took 2 s).

### The shebang

The first line `#!…` is read by the kernel, not by bash: execve(2) starts the interpreter it names when the file is run as a program (`./script.sh`, or a command found on PATH), with the rest of the line and the script's path as arguments. To bash the line is a comment, so `bash script.sh`, `sh script.sh`, `source script.sh` and `. script.sh` ignore it. The explanation now says so:

> Shebang: when the file is run as a program (`./script.sh`, or a command found on PATH), the kernel (or bash, on a system whose kernel does not) runs `/usr/bin/env bash ./script.sh args…`, and `env` finds `bash` on PATH and runs it. To bash this line is a comment: `bash script.sh`, `sh script.sh`, `source script.sh` and `. script.sh` ignore it. Bash Explainer explains the script as bash, from this line

Before, it said "Shebang: run this script with `/usr/bin/env bash`", whatever ran the file.

- The command the kernel runs is shown with the rest of the line as one argument, as Linux passes it: `#!/usr/bin/env -S bash -e` runs `/usr/bin/env '-S bash -e' ./script.sh args…`, then `env -S` splits it (the notes on `env` without `-S` stay).
- The last sentence says which shell Bash Explainer reads the script as: the one the line names (`#!/bin/sh`: POSIX sh), or the one a ShellCheck directive or a setting chose instead. An interpreter that is no shell (`#!/usr/bin/python3`) gets no such sentence.
- It cites execve(2), "Interpreter scripts", besides sections 3.8 and 3.1.3 of the Bash manual. A manual page is a new kind of reference: the panel links it as `execve(2)` next to `§3.8`, the hover and Copy as Markdown as "Bash manual 3.8, 3.1.3; execve(2)", to its page on man7.org. The web page's hover keeps that link, as it keeps the manual's. The pitfall on a shebang whose options bash refuses cites it too.
- Only `#!` as the first two bytes of the file is a shebang, as the kernel reads it. ` #!/bin/bash` (after a blank) is a comment, as on any later line. A byte order mark before it (`U+FEFF`, from some Windows editors) is a new pitfall: the kernel sees no `#!`, and bash runs the line as a command named `#!/bin/bash`, which fails ("No such file or directory"). The command line and the web page see the mark; VS Code takes it off when it reads the file, so its editor does not show the pitfall.
- Lines that never start the interpreter get a ⚠: `#!bash` (the kernel opens the interpreter as a path from the current directory, not from PATH: "required file not found"), and `#!/usr/bin/env` alone or with only an assignment (`#!/usr/bin/env FOO=1 bash`), where env runs the script's path, which starts itself again without end.
- The JSON output of the command line gives the shebang's token the `kind` `shebang` (it was `comment`), and the text output colours it as a command.
- Colour: the shebang is its own kind, `shebang`, in the panel's Meaning and Reading (labelled "shebang, a comment to bash"), and is drawn in the colour of a command name, the program it names; in the web page's editor too, in italics like a comment. With `bashExplainer.panel.colors` set to `theme`, it takes the editor's colour of the shebang (a comment's, in most themes) where that is readable; with `themeLike`, a command's when the theme draws it as a comment.
- In VS Code it is the semantic token type `shebang`, declared with `superType: comment`: a theme with no rule for it colours it as a comment, as before (through the grammar's scope `meta.shebang.shell`), and `"editor.semanticTokenColorCustomizations": { "rules": { "shebang": "#4ec9b0" } }` gives it a colour of your own. The Language Server sends `shebang` to a client that lists it in its `tokenTypes`, and `comment` to one that does not.

### The words of a brace expansion

The example of a brace expansion shows the words bash makes as chips in a row, each with an edge, so that they read as separate arguments, not as lines of output. Where the command is `echo` or `printf` and its words are known, the output follows:

| Line | Resulting words | Output |
| --- | --- | --- |
| `echo {1..10..3}` | `1` `4` `7` `10` | `1 4 7 10` |
| `touch file{1..3}.txt` | `file1.txt` `file2.txt` `file3.txt` | (none: `touch` prints nothing) |
| `printf '%s\n' {a,b}{1,2}` | `a1` `a2` `b1` `b2` | four lines, `a1` to `b2` |
| `printf -v v '%s,' {a..c}` | `a` `b` `c` | Value stored in `v`: `a,b,c,` |

- The label counts the words: "Resulting words (4 separate arguments of `echo`)".
- A long expansion is cut after 11 words, with "… 100 words in all" (`echo {1..100}`); a long `echo` line is cut at 120 characters.
- A space at an end of a word is drawn as in the values of expansions (`echo {a\ ,b}`), and an empty word is `∅` (`echo {Z..a}` makes one), each said after the words.
- The output is under the last word that expands (`echo x{1..3}y {a,b}`), and not where the command writes to a pipe whose example shows the stages. `echo` with an option or a backslash, and a word with a glob or a `~`, give no output.
- The command-line tool and Markdown write the words on one line as code spans: `` `1` `4` `7` `10` ``. The VS Code hover shows them as code, side by side. In the panel they are a list, named by the label, so a screen reader says how many words there are.
- Before, "Resulting words" listed one word per line, and `printf` had an example of its own that printed the braces as they are (`{a,b}{1,2}`). The examples of `printf` and of pipelines now run the words of the expansion (`echo {a,b} | tr a-z A-Z` shows `A B`), and `printf '%s\n' *.txt` or `printf '%s\n' ~/x` has no example, as the files and the home directory are not known. After `set +B`, braces do not expand, and there is no example.

### The code the status notes suggest

The notes on exit statuses show the code to write for their line. The same data is applied and run in bash 5.2 and 5.3 by a test (docs/design/oracles.md, 3.2).

| Line | The note suggests |
| --- | --- |
| `local x=$(g)` | `local x; x=$(g)` |
| `local u=$(g) \|\| return` | `local u; u=$(g) \|\| return` |
| `export a=$(g) b=$a` | `export a b=$a; a=$(g)`: only the words with `$( )` move. bash expands every word before it declares, so `b=$a` still reads the `a` from before. |
| `true && export q=$(g)` | `true && { export q; q=$(g); }` |
| `((i++))` under `set -e` | `i=$((i+1))`, `((++i))` or `((i++)) \|\| true` (in a group after `&&`) |
| `[ -f x ] && echo y`, last in a function | `if [ -f x ]; then echo y; fi`, or `return 0` after it |
| `[ -f x ] && echo found`, last in a script | `if [ -f x ]; then echo found; fi`, or `exit 0` after it |

- `i=$((i+1))` now comes first: an assignment with no command substitution has status 0 for every value. `((++i))` has status 1 when the new value is 0 (from -1).
- With a here-document, `fi` and `return 0` go before its body: `f() { [[ -f x ]] && cat <<EOF; }` becomes `f() { if [[ -f x ]]; then cat <<EOF; fi; }`.
- Before, the notes said `local x`, then `x=$(…)`, and `if …; then …; fi`.

### The fixes of the notes on words

The notes on words suggest the fix for the line as it is written; a test runs each fix in bash 5.2 and 5.3.

| Written | Before | Now |
| --- | --- | --- |
| `for f in $*`, `select x in $@` | Write `for a in "$@"` (or just `for a`) | Write `for f in "$@"` (or just `for f`); `select x in "$@"` (or just `select x`). With more words in the list (`for a in $@ end`), only `for a in "$@"`, since `for a` would drop them. |
| `FOO=1 echo $FOO` | go through a shell: `FOO=… sh -c '… "$FOO"'` | `FOO=… bash -c 'echo "$FOO"'`, through the shell of the script (`sh -c` in sh, which may be dash: only for a program, or `echo` and `printf` with no option and no `%q` or `%b`; dash's `echo -e` prints `-e`): the command with its words, the expansions of the prefix's variables in double quotes, a word in single quotes in double quotes (`printf '%s\n'` becomes `printf "%s\n"`). Where that shell would not run the same command with the same words, the note still shows `bash -c '… "$FOO"'`: a redirection among the words, another expansion (`$BAR`, `$(…)`), a glob or braces. For a builtin that acts on the shell (`cd`, `read`) or that has no program, a function or an alias, which no other shell has, it says to assign first: `FOO=…; cd … "$FOO"`. |
| `IFS=:` then `t=${a[@]}` | … if one string is meant, write `t="${a[*]}"` | Only the array, `t=("${a[@]}")`. In an assignment bash joins `${a[@]}` with a space; `"${a[*]}"` joins with the first character of `IFS` (`x  y:b`, not `x  y b`). The string is still suggested where the `IFS` is the default or starts with a space. |
| `[ ${x:-'a b'} = y ]` | Write `"${x:-'a b'}"` | No fix: in double quotes, the quotes in the default value are kept as text. As for an unquoted path, the fix is left out where quotes would change the value. |
| `[ $x = a -o $y = b ]` | A caveat on `$x` only, whose fix left `$y` | A caveat on each, each with its fix. |
| `cp $a $b`, `sudo rm -rf $d/x $e` | A note on the first unquoted path only (`$a`, `$d/x`), whose fix left the other | A note on each, each with its fix. The same word twice (`cp $a $a`) is one note, whose fix quotes both. |
| `find . -exec cp $a {} \;`, `find . -type f -execdir rm -- $a {} +` | No note: the command find runs was not followed. | The same note as for `cp $a b`, with its fix (`find . -exec cp "$a" {} \;`): the shell that starts find splits and globs `$a`, so the command gets the words it made (`a="a b"` gives `cp a b FILE`). `{}` and the closing `;` or `+` are find's words, not paths of the command. The same for `-ok` and `-okdir`, and for the other checks of the command (`find . -exec rm -rf $d/x {} \;` warns that an empty `d` deletes from the root). find's own operand (`find $d -name x`) is not a path of a file command. Each command find runs gets its notes (`find . -exec cp $a {} \; -exec mv $b {} \;` has two). Where find refuses all its arguments and runs nothing, the command has no notes (nor the "cannot run a shell function" note, nor a script it would run: `find . -exec bash -c 'rm -rf $d/x' _ {} ;`): an `-exec` that no `\;` or `+` ends (`a=x; find . -exec rm $a {} ;`, where the `;` is the shell's; with one such `-exec` among others, none of them runs), `+` after a word that is not `{}` alone or with another `{}` in the command, and `+` for `-ok` and `-okdir`. A `+` elsewhere is a word of the command, as in find (`-exec echo a + \;`); `-exec \;` with no command is refused too. Those lines get a note (`find-action-refused`) that says what find prints and that nothing runs, with the fix `\;` where the cause is the bare `;` that ends the line, as a word of its own (`{};` becomes `{} \;`, `;# c` becomes `\; # c`; none for `-exec ;`, which has no command); the explanation of the rest of the line (the `-name` pattern and its example) stays as it was. A word whose value is not known here may be the `;` (`-exec "$@"` in a function, `$a` where the script does not set it): then find is not said to refuse, and the command has its notes; a value the script gives is used (`x=';'; find . -exec rm $d/x {} $x` ends at `$x`). A line bash rejects (`find . -exec rm {} ;;`) gets no such note: find never runs. |
| `for i in a b *.c; do …` | When no file matches `*.c`, the loop runs once with `i` set to the text `*.c` itself. Start the body with `[ -e "$i" ] \|\| continue`, or turn on `shopt -s nullglob` | When no file matches `*.c`, the loop still runs once for it, with `i` set to the text `*.c` itself (it runs three times in all: `a`, `b`, `*.c`). Turn on `shopt -s nullglob` before the loop. The test would skip `a` and `b` too, which are no files. In sh, which has no nullglob, the note says what happens and suggests nothing. Where the glob is the whole list (`for f in *.log`), the note is as before, with both fixes. |
| `for i in *.{c,h}; do …` | When no file matches `*.{c,h}`, the loop runs once with `i` set to the text `*.{c,h}` itself | `*.{c,h}` gives the patterns `*.c` and `*.h` before files are matched; for each that no file matches, the loop still runs once, with `i` set to its text itself. bash expands the braces first: with no file, the loop runs twice. The same for `{a,b}*.c` (`a*.c`, `b*.c`), and for a value split into patterns (`x="*.c *.h"; for f in $x`). Where the braces make a word that is no pattern (`{a,*.c}`), the note is about the pattern alone and suggests only `shopt -s nullglob`. |
| `for i in "$d"/*.{c,h}; do …` | When no file matches `"$d"/*.{c,h}`, the loop runs once with `i` set to the text `"$d"/*.{c,h}` itself | The braces are expanded before `$d`, so the count is known even where `$d` is not: `"$d"/*.{c,h}` gives the patterns `"$d"/*.c` and `"$d"/*.h`, and the loop runs once for each that no file matches, with `i` set to its text after its expansions (`sub/*.c` and `sub/*.h` where `d=sub`). With `d=sub` in the script, the note names them `sub/*.c` and `sub/*.h`. Without braces (`"$d"/*.c`), the note says that `i` gets the text of the pattern after its expansions, not the word as written. |
| `for i in {"*",*.c}; do …` | When no file matches `{"*",*.c}`, the loop runs once with `i` set to the text `{"*",*.c}` itself. Start the body with `[ -e "$i" ] \|\| continue`, or turn on `shopt -s nullglob` | A quoted `*` is no pattern: the caveat is about `*.c` alone (the loop runs for `*` too), and suggests only `shopt -s nullglob`, since `[ -e "$i" ] \|\| continue` would skip the `*` that bash always passes. A list with no pattern has no caveat: `{"*",y}.c` (before, the same caveat as `{"*",*.c}`, about `{"*",y}.c`) and `"*".c`. |
| `for i in "${a[@]}"*.c; do …` | When no file matches `"${a[@]}"*.c`, the loop runs once with `i` set to the text `"${a[@]}"*.c` itself. Start the body with `[ -e "$i" ] \|\| continue`, or turn on `shopt -s nullglob` | `"${a[@]}"*.c` may give several words before files are matched; for each of them that is a pattern and that no file matches, the loop still runs once, with `i` set to its text itself. Only `shopt -s nullglob` is suggested: with `a=(x y)`, bash runs the loop over `x` and `y*.c`, and the test would skip `x`. The same for `"$@"/*.c`, `$@*.c`, `"${!a[@]}"*.c`, `"${!prefix@}"*.c`, an indirection (`${!x}*.c`) and a nameref that may point to `a[@]`. `"$*"*.c` and `"${a[*]}"*.c` give one word, as before. |
| `select i in *.c; do …` | When no file matches `*.c`, the loop runs once with `i` set to the text `*.c` itself. Start the body with `[ -e "$i" ] \|\| continue`, or turn on `shopt -s nullglob` | When no file matches `*.c`, the menu still shows it as an entry, and choosing it sets `i` to the text `*.c` itself. Only `shopt -s nullglob` is suggested: then the menu leaves the pattern out (with no entry, `select` runs nothing); the test would only ask again. |

## Fixed

### Conditions and code that never runs

A condition was said to be always true or false, or code to never run, where bash does otherwise (bash 5.2):

| Script | bash | Said before | Said now |
| --- | --- | --- | --- |
| `g() { if [ "$d" = 1 ]; then d=2; g; return; fi; x=2; }; x=1; d=1; g` then `if [ "$x" = 1 ]` | `x` is 2: the recursive call runs `x=2` | always true | nothing |
| the same `g`, with `h` instead of `x=2` | the recursive call runs `h` | the body of `h` never runs | nothing |
| `enable -n exit; exit; echo after` | "exit: command not found", then `after` | `echo after` never runs | nothing |
| `enable -ns exit; exit; echo after` (also `enable -n -s`, `enable -n -a`) | the same | `echo after` never runs | nothing |
| the same `g`, with `readonly x` instead of `x=2`, then `x=5` and `if [ "$x" = 5 ]` | "x: readonly variable": `x` stays empty | always true | nothing |
| `u=1; [ -v "$1" ]` with `$1` = `a[u=2]`, then `if [ "$u" = 1 ]` | `u` is 2: the subscript is arithmetic | always true | nothing |

The same holds after `test -v "$1"`, `[[ -v $x ]]`, `[ "$1" "$2" ]` or `test "$@"` (with `-v` and `a[u=2]`), an unquoted word of `[` or `test` that may split into `-v` and a name (`[ $x ]`, `[ -z $1 ]`), a read of a nameref whose target is not known (`declare -n r=$1; : "$r"`; also through another nameref, `declare -n a=r`, and its assignment or `unset`), `${x@P}` of a value that may run code, `compgen -W '$((u=2))'`, `fc -s`, `declare n; (( n ))` with `n='u=2'` in the environment (also `declare -I n` or `local -I n` in a function, which keep the value from outside), a function defined after `shopt -so allexport` (exported, as after `set -a`), `enable -f` (a builtin loaded from a shared object), `mapfile -C 'x=2; :'` and `readarray -C` (bash runs the callback's text in this shell), `jobs -x eval x=2`, and `ulimit -n` or `-u` (a redirection, even to `/dev/null`, or the pipe of `$( )` may then fail). `enable -d x` reads `x` as the builtin to remove; before, as the value of `-d`. A recursive call may also give or take attributes (`readonly x`, `declare -gi x`). A function called only from code that a recursive call, or a call the model does not follow, may run is no longer said to never run. Past 64 nested calls, what the deeper functions change is taken as not known; before, it was taken as unchanged.

### Redirections that fail, `case … ;;&`, arithmetic of values from the environment, and saved IFS

A value, a decided condition or code that never runs was said where bash does otherwise (bash 5.2 and 5.3):

| Script | bash | Said before | Said now |
| --- | --- | --- | --- |
| `x=1; { x=2; } < ./nofile`, then `if [ "$x" = 2 ]` | "No such file or directory": the group does not run, `x` is 1 | `$x` is 2; always true; the `else` never runs | nothing |
| `x=1; declare x=2 < ./nofile` (also a function called with `> ./no/dir/f`, or defined with `2>&9` while fd 9 is closed) | the same | the same | nothing |
| `x=b; case b in b) x=c ;;& "$x") y=1 ;; *) y=2 ;; esac` | `"$x"` is tested after `x=c`: `y` is 2 | `y` is 1 | nothing |
| `[ -n "$z" ] && n=0; (( n ))`, with `n='u=2'` in the environment | `u` is 2 | `$u` keeps its value | nothing |

The same holds for `n="$n"`, `: "${n:=0}"`, `n+=''`, `a="$n"; n=0; (( a ))` and `export n` before `(( n ))`: arithmetic runs the value from the environment as an expression. A redirection that cannot fail keeps the values: a here-document, a here-string, `/dev/null`, a copy of fd 0, 1 or 2 (`2>&1`) where the script closes none of them, closing another descriptor (`3>&-`), `< <(cmd)`, and assignments alone (`x=2 < ./nofile` sets 2). A script that may close fd 0, 1 or 2 (`exec 1>&-`, `f >&-`, `exec 3>&1-`, `unset BASH_XTRACEFD` after `BASH_XTRACEFD=1`) makes such a copy one that may fail: `exec 1>&-; { x=2; } 2>&1` leaves 1 ("Bad file descriptor"). Under `set -e`, a redirection that fails ends the script, so what comes after it runs only when the command ran: `set -e; x=1; { x=2; } > out.txt` gives 2 after it, as before; where `set -e` is ignored (`if`, `||`, `!`, a function called there), it gives nothing. Static patterns after `;;&` are still decided when the lists before them change no option (`case a in a) echo 1 ;;& b) …`). `IFS=$save`, where `save=$IFS` was set before on every path, no longer makes the whole script trust nothing: `ncurses6-config` shows its values again (`$prefix` is `/usr`). A word of `[` or `test` that IFS may split into `-v` and a name with a subscript gives nothing, with each IFS the script may set (`IFS=v; IFS=:` and `x='-v:'`: `IFS=:` gives `-v`), also one copied through `for`, an array or `$(( ))` (`for s in 0; do :; done; IFS=$s` with `x='-v0'`; `IFS=$((0))`). Arithmetic that reads an element of an array set from the environment's value (`a[0]=$q; q=0; (( a[0] ))`, `a=("$q")`, `a+=("$q")`), or a tilde with `HOME` from the environment (`m=~; (( m ))`), gives nothing either.

### Constructs the model does not follow

The model now looks every construct of a script up in one table ([docs/design/trust-allow-list.md](../design/trust-allow-list.md)): node types, builtins and their options, the options of `set` and `shopt`, bash's own variables, the operators of parameter expansion and of redirections. A construct whose effect the walk does not follow, or one the table does not have, makes the script trust nothing: Meaning gives no value, no condition is decided and no code is said to never run. Before, such a construct was taken to change nothing. Each of these was wrong before (bash 5.2 and 5.3):

| Script | bash | Said before | Said now |
| --- | --- | --- | --- |
| `shopt -s compat42; x=abc; y="${x/b/'q'}"` (also `BASH_COMPAT=42`) | `$y` is `a'q'c` | `aqc` | nothing |
| `shopt -s compat31; x=abc; if [[ $x =~ "a.c" ]]; then y=yes; else y=no; fi` | `then` runs | always false; `y=yes` never runs; `$y` is `no` | nothing |
| `FUNCNEST=1; g() { x=2; }; f() { g; }; x=1; f`, then `echo "$x"` on the next line | 1 ("maximum function nesting level exceeded") | 2 | nothing |
| `shopt -s expand_aliases; BASH_ALIASES[1]="u=2"; u=1`, then a line `1`, then `echo "$u"` | 2 | 1 | nothing |
| `set -k; f() { y=$x; }; x=1; f x=2; echo "$y"` | 2: `x=2` is an assignment for `f` | 1 | nothing |
| `x=1; jobs -x eval x=2; echo "$x"` | 2 | 1 | nothing |
| `u=1; exec {a[u=2]}>/dev/null; echo "$u"` | 2: the subscript is arithmetic | 1 | nothing |
| `u=1; x='\0'; x+='44((u=2))'; : "${x@P}"; echo "$u"` | 2: `+=` joins two quiet texts into `\044((u=2))` | 1 | nothing |
| `#!/bin/bash -k`, or `#!/usr/bin/env -S bash -O compat31`, or `#!/usr/bin/env -S BASH_COMPAT=42 bash`, run as a program | as the rows above | as the rows above | nothing |
| `BASH_COMPAT=31 bash -c '…'` or `bash -O compat31 -c '…'` with the `compat31` script | `then` runs | always false | nothing in that shell |

The same holds for `set -H` and `set -o history` (history expansion may run an earlier line), `set -n`, `set -t`, `set -o posix` turned on in the middle of a script (a script that starts in POSIX mode, `sh` or `#!/bin/bash --posix`, keeps its values), `shopt -s` of `compat31` to `compat44`, `extdebug`, `localvar_inherit` (a plain `local n` keeps the value from outside, which arithmetic would run), `localvar_unset`, `assoc_expand_once` and `array_expand_once`, `shopt -u extquote` or `globasciiranges`, `POSIXLY_CORRECT`, `LANG`, `LC_ALL`, `LC_CTYPE` or `LC_COLLATE` set to a locale other than C (case conversion, character classes and ranges follow it), an option or a word that may be one that `set` or `shopt` does not have (`shopt -s "$opt"`, `set $args`), an option a builtin's spec does not have (`read -Q`), a parameter expansion bash rejects (`${x@Z}`), and text the parser cannot read. It also holds for `SHELLOPTS`, `BASHOPTS` or `POSIX_PEDANTIC` in a shebang's `env -S` line or given to another shell (bash turns on what they list when it starts), a shell started with an option such as `-r`, `-i`, `--login` or `--debugger`, or with `-O "$opt"`, a write through a nameref (`declare -n r=BASH_COMPAT; r=31`), and an empty command name (`cmd=; $cmd eval x=2` runs `eval`). `#!/bin/bash -a` exports the functions defined after it, as `set -a` does. What keeps the values: turning those options off (`set +k`), a locale of `C`, `POSIX`, `C.UTF-8` or empty, an assignment before a program (`LANG=de_DE.UTF-8 sort`: it goes to the program's environment only), `set -C` (a redirection to a file may fail anyway), and another shell started with `LC_ALL=C` or `-o posix`.

### Shell code in host files

A YAML block scalar is read as YAML gives it to the runner: without the indentation of its first line, or of the indicator (`run: |2`). So an indented `EOF` ends a here-document, and `<<-` strips the tabs after the indentation:

```yaml
- run: |
    cat <<EOF > out.txt
    hello
    EOF
    echo done      # before: "part of the here-document started by `<<EOF`", and so was the next step
```

A folded block (`run: >`) joins lines next to each other at the same indentation with a space; the shell gets one line, and a note says so. A blank line, or a more-indented line, keeps the line break. Each join is read as ` \` and a line break, so two cases still differ from YAML, and the note says so: inside a single-quoted string over two lines (`echo 'a` / `b'` is `echo 'a b'` to YAML), and after a comment (YAML joins the next line into the comment: `echo a # c` / `echo b` runs only `echo a`).

A header with a space after it (`run: | `) starts a block too. Before, the `|` was read as the script, and the block's lines were not read.

Each shell the host starts is explained apart: what one sets (`set -euo pipefail`, a variable, a function) does not count in the next.

| File | One shell |
| --- | --- |
| GitHub Actions, CircleCI, Azure Pipelines (`script:`, `bash:`) | each step |
| GitLab CI | a job's `before_script` and `script` together (GitLab joins them into one script); `after_script` apart |
| Bitbucket Pipelines | a step's `script` list |
| Travis CI (a file with `language:`) | a job's `before_script`, `script` and `after_script` |
| Taskfile | each command of `cmds:` |
| Dockerfile | each `RUN` (and `CMD`, `ENTRYPOINT`) |
| Makefile | each recipe line; with `.ONESHELL`, each recipe |
| package.json | each script |
| Jenkinsfile, Python | each `sh` step, each string run |
| Markdown | all the code blocks of the file (typed into one terminal), as before |

Before, a later step got wrong pitfalls ("`f` is not set here: with `set -u` on…"), and a function of one step was taken for a function in the next. The lines of one shell are read in the order of the file: a `script:` written above its `before_script:` is read before it.

Notes that name a line of the script name the line of the document: where a here-document starts, "function `f` defined on line N", "declared a nameref on line N". Before, they counted from the first command: after three blank lines, a here-document of line 4 was said to start "on line 1", and in a host file the count started at its first shell line.

### bash 5.3's command substitutions

- `x=${ cmd; }` runs `cmd` in the current shell, not in a subshell, and takes its output (without the trailing newlines). Variables it sets and `cd` stay in effect after it; `local` makes a variable that lasts only inside. `cd` in it is no longer said to change "the subshell of `$( )`".
- `x=${| cmd; }` runs `cmd` in the current shell, and takes the value `cmd` leaves in `REPLY`, trailing newlines and all. `REPLY` is local to it, and the output of `cmd` is printed as usual, not taken.
- As in `$( )`, `set -e` is off inside them (unless `shopt -s inherit_errexit`), and the note now names the form used.
- ksh93 and mksh have `${ cmd; }`, and mksh has `${| cmd; }` too; for the other shells (`sh`, dash, busybox ash, yash, zsh) they are warnings.
- In bash 5.3 mode, a `}` right after a simple command (`${ echo a }`) is a warning (`funsubBrace`): bash reads that `}` as an argument of the command, and reports a syntax error. A `return` in `${ …; }` ends the substitution, and `local` in it is no pitfall.
- Before, both were explained as `$( )`. Reading said that a subshell runs their commands; it now says this shell does (a `$( )` in them still has its subshell).
- With `bashVersion` 5.3, what they change is followed after them: in `x=0; v=${ x=1; }; if [ "$x" = 1 ]; then echo one; else echo other; fi`, the condition is always true, so `echo other` is faded as code that never runs, and Meaning shows `$x` as `1` after it. A variable made `local` in them, and `REPLY` in `${| cmd; }`, are not kept; `set -e` comes back on after them. `break` or `continue` in them leaves the loop around them once the command is done; an error in an expansion ends only the substitution; one in the redirections of a program runs in that program's process. With 5.2, which stops at them, such a script still decides no condition. Before, a script with one decided no condition and showed no values.

### `test` and `[` in bash 5.3

In a test of more than four words, bash 5.3 reads a parenthesized part of one to four words by the rules for that many words, as POSIX does for a whole test; bash 5.2 reads it by the general grammar. With `bashVersion` 5.3, the explanation follows 5.3:

| Written | bash 5.3 | bash 5.2 |
| --- | --- | --- |
| `[ \( ! -a f \) ]` | `!` and `f` are both not empty: true | NOT (`f` exists) |
| `[ "$a" -o \( x \) ]` | "But bash 5.3 tests here whether the first word of the test, `"$a"`, is not empty, not `x` (a bug of bash 5.3)": false when `$a` is empty | `x` is not empty: true |
| `[ x -a \( x -a \) \) ]` | an error (`x -a` is no test of two words) | true |

Checked with every list of five words over ten words, and 5,000 longer ones with a group, in bash 5.2.21 and 5.3 (test/testexpr.test.ts). The conditions the model decides (an `if` that is always true, dead code) are those both releases read alike.

### printf formats

Each was checked with bash 5.2 and bash 5.3 (test/bash53.test.ts) and, for `env printf`, with coreutils.

| Written | Shown now | Shown before |
| --- | --- | --- |
| `printf '%ld\n' 5`, `%hhd`, `%zx`, `%Lf` | "value 1 as an integer (decimal) (the `l` changes nothing)" | "unknown conversion `l`" |
| `printf '%#q\n' 'a b'` | bash 5.3: "in single quotes: `'a b'`"; bash 5.2: "the `#` changes nothing in bash 5.2" | "with a 0x/0 prefix" |
| `%#x`, `%#o`, `%#f`, `%#g` | "with a 0x prefix (none for 0)", "with a leading 0", "always with a decimal point" (and "trailing zeros kept" for `%#g`) | "with a 0x/0 prefix" for each |
| `printf '%ls\n' "$s"` | bash 5.3: "in a multibyte locale such as UTF-8, the width and precision count characters, not bytes" (`%lc`: the first character, not its first byte); bash 5.2: "the `l` changes nothing in bash 5.2" | "unknown conversion `l`" |
| `printf '%S\n' "$s"`, `%C` | bash 5.3: "the same as `%ls`"; bash 5.2: an error, as bash 5.2 says "invalid format character" and stops with status 1 | "unknown conversion `S`" in both |
| `printf '%.2Q\n' 'a b c'` | "at most 2 bytes of the value, before it is quoted" (bash 5.2 has `%Q` too) | "unknown conversion `Q`" |
| `printf '%.3s'` | "at most 3 bytes" (bash counts bytes; awk's printf counts characters, as before) | "at most 3 characters" |
| `env printf '%#q'`, `%Q`, `%S`, `%(%F)T`, `%5q`, `%-b`, `%#d`, `%05s` | an error: coreutils printf rejects them ("invalid conversion specification") | explained as bash's |
| `%.*f`, `%.*s`, `%.*Q` | "taken from an argument" (bash 5.2 reads the argument of `%.*Q` and ignores it; `%.Q` prints nothing) | "* digits", "at most * characters" |

The examples follow too: `printf '%#q' 'a b'` shows `'a b'` in bash 5.3 and `a\ b` in bash 5.2; `printf '%#.0f' 3` shows `3.` (also in awk); widths and precisions count bytes (`printf '%5s|' é` pads with three spaces); `%q` puts a backslash before `,` and `^` but not before a `#` or `~` inside a word (`a#b`, `a~b`), as bash does. An output that depends on the locale (`%ls` or `%c` of a character that is not ASCII, `%q` of one) or on a release not known (the pipeline examples) is not shown.

### The options of a shebang

A shebang that starts bash with options turns them on, as the kernel passes them: `#!/bin/bash -eu` is `set -e` and `set -u` from the first line, and so is `#!/usr/bin/env -S bash -e -u`. Before, only `--posix` was read from a shebang. `bash script.sh` ignores the options of the shebang: the state is read as a script run directly. The options of a shebang that starts another shell (`#!/bin/sh -e`) are not read.

### Quoting suggested for a path with a glob, `~` or braces

The notes for an unquoted path (`cp $a/*.txt d`) and for `rm -rf $DIR/…` quote only the expansions, and leave the rest of the word as written, so a glob, a `~` or a brace expansion still works:

| Written | Suggested now | Suggested before |
| --- | --- | --- |
| `rm -rf $DIR/*` | `"$DIR"/*` and `"${DIR:?}"/*` | `"$DIR/*"` and `"${DIR:?}/…"` (they name a file `*`) |
| `cp ~/$x/* e` | `~/"$x"/*` | `"~/$x/*"` (no tilde expansion) |
| `cp $x/{a,b}.txt e` | `"$x"/{a,b}.txt` | `"$x/{a,b}.txt"` (no brace expansion) |
| `cp $*/* e` | `"$@"/*` (`"$*"` joins the arguments into one word) | `"$*/*"` |
| `cp ${a[*]}/* e` | `"${a[@]}"/*` | `"${a[*]}/*"` |

A word whose other parts mean the same in quotes is still quoted whole (`cp $a/b.txt e` → `"$a/b.txt"`).

When quotes would change what an expansion gives, the note gives no rewrite: a glob, a `~` or quotes in the value of `${…}` work only outside double quotes (`${x:-*.txt}`, `${x:-~}`, `${x:-'a b'}`, `${x:-$a/*}`, `${x/a/*}`).

### `rm -r` of a path from a variable that may be empty

The warning that an empty variable makes `rm -r` delete from the root:

- now also covers `rm -rf "$DIR"/*`, `"$DIR/"*` and `"$DIR""/x"`;
- suggests `"${DIR:?}"/*` for `$DIR/*`, keeping the glob outside the quotes;
- for an expansion with an operator that may be empty (`${DIR%/}/*`, which is `/*` when `DIR` is `/`; `${DIR:+x}/*`, `${DIR-/a}/x`, `${DIR?}/x`), suggests a check before the line, `[ -n "${DIR%/}" ] || exit 1`, and no longer rewrites it to `${DIR:?}`, which dropped the operator;
- says nothing about an expansion that is never empty: `${#DIR}`, `${DIR:-/tmp/x}`, `${DIR:=/a}`, `${DIR:?}`. Before, `rm -rf ${DIR:-/tmp/x}/*` was told it could become `rm -r /*`.
- treats a default that is empty after quote removal (`${DIR:-''}/a`, `${DIR-""}/a`, `${DIR:-$''}/a`) as an empty value, and suggests `"${DIR:?}"/a`; and says nothing for a literal default written with quotes or a backslash (`${DIR:-"lit"}/a`, `${DIR:-a\ b}/x`);
- when the operator's word has a quote or a backslash and the value may be empty (`${DIR:+''}/a`, `${DIR%'x'}/a`), gives no check line (in `"…"` it would read the word differently) and only says to check;
- now warns about an element or a list that can be empty: `${DIR[0]}/a` (rewrite `"${DIR[0]:?}"/a`), `$@/a`, `"$@"/a` and `$*/a` (check `[ "$#" -gt 0 ] || exit 1`), `${DIR[@]}/a` and `${!DIR[@]}/a` (check `[ "${#DIR[@]}" -gt 0 ] || exit 1`).

### Pitfalls

- `$_` read in a `bash -c` or ssh string gets no pitfall that it is not exported: the new shell sets it itself (`_=1; bash -c 'echo $_'` prints the shell's path). Before, it was said to be empty there.
- `x = 1` is a pitfall only when `x` runs nothing known: not a builtin (`export = x`, `local = x`), a function, an alias, a program the dictionary knows (`echo ==========`, `sed = file`), nor a name a `source`d file may define. Before, all of these were said to be assignments written with spaces.
- `rm -rf $DIR/*` is no warning when the script set `DIR`, on every path to it, to a value with text of its own (`DIR=/opt/app`, `BUILD_DIR="$SCRIPT_DIR/build"`), and nothing else may change it unseen (src/semantics/trust.ts). A value from `$1`, `read`, a branch or a sourced file keeps the warning.
- A command name with a `/` runs that file, never a builtin (3.7.2). `./read x` no longer gets the `read -r` pitfall, nor `./x = 1` the one for `x = 1`, nor `./cd $x` the one for an unquoted path. A function named `read`, or `read` after `enable -n read`, is not the builtin either. A path whose last part is a program the dictionary knows is that program, as its explanation says: `/bin/rm -rf $DIR/*` and `/bin/cp $x y` keep their warnings. `FOO=1 ./x $FOO` now names `./x` in its note. Before, every check read only the last part of the path.
- `local` outside a function is a pitfall only in the shells where it fails: bash, dash, busybox ash and POSIX sh. In dash and busybox ash it says that the script stops there ("local: not in a function"), or, in a subshell (`( local y )`, `$(local y)`), that only the subshell ends (status 2); bash goes on with status 1. zsh, mksh and yash document their `local` as their `typeset`, which works anywhere, and ksh93 has no `local` (its portability warning says so): they get no pitfall. Before, every shell got bash's "can only be used in a function".
- `local` in a function is no pitfall when `eval` runs it there (`f() { eval 'local x'; }`, `f() { x=$(eval 'local y'); }`, `g() { eval 'local x'; }; eval g`); in a shell that `bash -c` starts, or in a trap's action (`f() { trap 'local x' EXIT; }`: it runs after `f` returns), it still is. Before, `local` in an `eval` string was always said to be outside a function.
- The words of an ssh command that this shell expands before sending them are the ones bash expands: `'a'*`, `"a"*`, `a=~/x`, `x=~`, `<(echo hi)` and `>(cat)` now get the pitfall, and a `*` after `set -f` or `set -o noglob` no longer does.
- A variable read in a `bash -c` string that bash cannot parse (`bash -c 'echo ${y'`) no longer gets the pitfall that it is not exported.
- A function of this script that a `bash -c` string calls after it reads a file (`bash -c '. ./lib.sh && f'`, `bash -lc 'source ~/.profile; f'`) gets no pitfall that the new shell lacks it: the file may define it. Called before the file is read (`bash -c 'f; . ./lib.sh'`), it keeps the pitfall. With `-l`, the explanation of `f` names the file too: "only if the files it reads at startup (`-l`, `-i`, `BASH_ENV`), or the file it reads on line 2, define it".
- The note on a distribution's alias or function (`ll`, `remount`) reads "is an alias" and "is a function"; before, it said "is an function". A quoted or escaped name (`"+"`, `"ll" /tmp`, `\ll`) gets none for an alias: bash looks up no alias for it. A function of the system (`"remount"`) still does.
- In `if [ -f a ] then …`, `while [ x ] do …` and `if test -f a then …` (no `;` before `then` or `do`), the note is the syntax error only. Before, the line also said `[` or `test` "fails when it runs"; bash never runs it: `then` is an argument, so the construct has no `then` and bash stops with "syntax error near unexpected token `fi`" (`done` for a loop). `if [[ -f a ]] then` is valid and gets no note.
- A command that another one runs through its command slot gets the checks of a command of its own: `sudo rm -rf $DIR/releases/$line`, `sudo -u deploy rm -rf "$DIR"/*`, `env A=1 rm -rf $DIR/x`, `nice -n 10 nohup rm -rf $DIR/x`, `… | xargs rm -rf $DIR/x` and `command rm -rf $DIR/x` get the warning that an empty `DIR` deletes from the root, and the one on an unquoted path (`sudo cp $a b` too). Before, only `rm` written first, or after `time`, got them. A string another shell runs (`sudo sh -c 'rm -rf $DIR/x'`) and a function named `sudo` are not read so. A command whose name is in quotes or has a backslash gets the checks of the plain name too: quotes and a backslash stop only an alias or a reserved word, and the same command runs. `\read x` gets the `read -r` pitfall (also where an alias `read` adds `-r`: `\read` skips the alias), `'rm' -rf $DIR/*` and `$'rm' -rf $DIR/*` the warning about the root and the one about an unquoted path, `\cp $a b` and `'cp' $a b` the one about an unquoted path, and `\source lib.sh` the caveat that `source` looks in `$PATH`. Before, these checks read the name as written and said nothing (found by the normal-forms table, docs/design/oracles.md, step 7). The checks of the syntax still read the name as written: `"[-f" x]`, `\{echo a;}` and `'[[' -f x ]]` get no note (bash finds no command of that name, and the explanation says so).
- An unquoted path whose value the script sets, on every path, to one word with nothing to glob (`TS=2024; rm -rf /tmp/build-$TS`) is a caveat, not a warning: "(with its value here it stays one argument, `/tmp/build-2024`, but another value breaks it)". A value the script does not know (`read line`, `$1`, `TS=$(date +%s)`, one set in a branch) keeps the warning.
- A shell that a `bash -c` string starts gets what that string exports, also after an `env -i`, `env -u` or sudo before the string: `env -i bash -c 'export X=1; bash -c "echo \$X"'` gets no pitfall that `env` does not pass `X`, nor `env -i bash -c 'f() { …; }; export -f f; bash -c f'` one that the new shell lacks `f`. Before, a link before the first shell was applied to the second one too.
- doas starts the command in a new environment, which keeps only `DISPLAY` and `TERM` of the caller's (doas(1); `keepenv` and `setenv` in doas.conf may pass more): `export X=1; doas bash -c 'echo $X'` gets the pitfall that `doas` does not pass `X`, and `doas myfunc` says that `export -f` does not help. Before, doas was read as passing the exported variables and functions on.
- A wrapper inside a string that a shell runs is judged by its own links: `env -i bash -c 'f() { …; }; export -f f; nice f'` no longer says that `env` passes no exported functions, `… sudo f` names `sudo`, and in `ssh host 'bash -c "ls $HOME"'` the remote shell, not this one, expands `"ls $HOME"`. doas takes no `NAME=value` words (doas(1)): `doas X=1 cmd` runs `X=1` as the command. Before, it was read as setting `X`.

Five pitfalls that bash 5.2 contradicted (found in a review, each checked in bash):

| Written | Before | Now | What bash does |
| --- | --- | --- | --- |
| `alias hi='echo hi'` then `hi`, in a file with no shebang (`.bashrc`, `~/.bash_aliases`) | Warning: "command not found" in a script | Caveat: expanded when an interactive shell reads the file, "command not found" when it runs as a script; the explanation of `hi` says the same. A file with a shebang, a CI step, a Dockerfile `RUN` and a `bash -c` string keep the warning; a README's code block (typed into a terminal) and `bash -i -c` expand it, with no note. `shopt -u expand_aliases` wins everywhere, and then the note says so ("also in an interactive shell"). | `bash -ic 'source f.sh'` prints `hi`; `bash f.sh` says "hi: command not found". |
| `local v=7` outside a function, in a file with no shebang | Warning: it fails | Caveat: it fails, but works when a function reads the file with `source`. A file with a shebang, and a `bash -c` string, keep the warning. | `f() { source lib.sh; }; f` prints `v=7`, status 0; `bash lib.sh` says "can only be used in a function". |
| `FOO=1; bash -c 'echo "$FOO"'` | Warning: empty there | Caveat: empty unless `FOO` was in the environment already, which exports it (also after `local FOO`). `foo=1` (lower case) keeps the warning, with "(unless the environment already has `foo`)". After `unset FOO`, `export -n FOO` or `env -u FOO`, the warning has no clause. An array, even one `export` marks, gets its own warning: bash cannot export an array; pass `"${FOO[*]}"`. After `: "${FOO:?}"`, no note: the variable came from the environment. `TERM=dumb`, `HOME=…` (names the environment almost always has): no note. | `bash s.sh` prints `[]`; `env FOO=x bash s.sh` prints `[1]`, `env foo=x` too; after `unset FOO`, or for `FOO=(a b)`, `[]`. |
| `TERM=dumb; sudo bash -c "echo \$TERM"`, also `TZ`, `LANG`, `LC_*`, `DISPLAY`, `DPKG_COLORS`; `su - -c` with `TERM` | Warning: sudo passes no variable | As without sudo: the rows above. sudo's default lists keep these names (sudoers(5): `env_check`, `env_keep`; a sudoers file may change them), and `su -l` keeps `TERM` (su(1)). Another name keeps the warning, which now names what is kept ("but for a few such as `TERM` and `LANG`", "but for `TERM`"). | — (sudo needs a password here; the names come from sudoers(5) and sudo 1.9.15's defaults.) |
| `[ -n "$x"]` | Warning: "missing `]`" | Warning: when `"$x"` is empty, the word is `]` and closes `[`, and the note says what the shorter test does: `[ -n ]` is true, `[ "$a" = ]` usually an error ("unary operator expected", status 2), `[ ]` false. With a value, "missing `]`". `"$x"\]` is read the same. A word with text of its own before the `]` (`"$x/a"]`), `${#x}`, `${x:-none}`, `${x:?}`, `$((n))`, or a variable set to text, keeps the old note. | `x=""; [ -n "$x"]; echo $?` prints `0` and no error; `[ "$a" = "$b"]` with `b` empty, `2`; with `x=a`, `[: missing ']'` and `2`. |

Whether a variable may come from the environment is now one rule, which `set -u`'s note follows too: a name the environment almost always has (`HOME`, `PATH`, `SHELL`, `LANG`, `TMPDIR`, `TERM`, `USER`, `LOGNAME`) gets no note, and neither does `OLDPWD`, which bash exports from the start; another name in capitals, a caveat; one in lower case, the warning with a clause; one the script removed (`unset`, `local` for its value, `export -n`), or an array, the plain warning. So `set -u; echo "$CI"` is now a caveat (it was no note), and `unset FOO; set -u; echo "$FOO"` a warning. In a host file, the names the host gives are taken as set: its placeholders (`${{ matrix.node }}`, make's `$(OUT)` and `$@`, which bash never reads as variables), the variables a CI sets (`GITHUB_SHA`, `RUNNER_OS`, `CI`), the keys of `env:` and `variables:` maps, and a Dockerfile's `ARG` and `ENV`. Before, make's `$@` got "`make_target` is not set here". `TZ=Asia/Tokyo; date +%T` gets no example, since the zone depends on whether the environment had `TZ` (it said "if the local zone is UTC").

The name kind of an alias that is not expanded reads "not expanded in a script" (it said "not expanded here").

- The pitfall on `sudo cmd > /etc/x` (`redirect-by-your-shell`) leads with what happens and why. For a fixed path under a system directory that only root writes (`/etc`, `/usr`, `/lib`, `/opt`, `/boot`, `/root`, `/sys`, `/proc/sys`) it names the file: "`/etc/resolv.conf` is normally writable only by root: the redirection (`>`) is opened by your own shell with your rights, before sudo starts, so it fails with "Permission denied" and the command does not run. Use `… | sudo tee /etc/resolv.conf`". For any other target (`"/etc/$f"`, `/proc/self/x`) it says "if the file is writable only by root, …". `>>` suggests `sudo tee -a`; `2>` and `&>` suggest `sudo bash -c '… 2> file'`, and `<` (a file only root reads) passing the file as an argument or the same `sudo bash -c`. When the pitfall appears did not change. Before, it only said the redirection is done by your shell and not by sudo, with `sudo tee` for every case.

### What `|| true` masks

`|| true` and `|| :` make a failure a success only when what runs is the builtin, or the program `true`. A function of that name runs instead of the builtin, and its status counts (bash 5.2):

| Written, under `set -e` | bash | Said now | Said before |
| --- | --- | --- | --- |
| `true() { return 1; }` then `x=$(false \|\| true)` | stops at the assignment | the script stops here if it fails | the idiom "`\|\| true`: turns a failure into success" |
| `:() { return 1; }` then `x=$(false \|\| :)` | stops | the same | the same |
| `x=$(false \|\| command true)`, `builtin true`, `/bin/true` | goes on | the idiom, and no note on `$( )` | the script stops here if it fails |
| `x=$(false \|\| : "${u:?}")` | stops (`u` is unset) | the script stops here if it fails | the same |

A word after `true`, a redirection or an assignment before it takes the reading away: they may fail. `while true` is an endless loop under the same rule: after `true() { return 1; }`, the body never runs, and the idiom is gone; `while command true` is one.

### Arithmetic in a `for (( ))` header

- `for (( i = 0; i < 3; i++ ))`: the initializer says "Assign the value of the arithmetic expression to variable `i` (in arithmetic, spaces around `=` are allowed)". Before, it said "(no spaces around `=`)", which holds only outside arithmetic. `(( x = 1 ))`, `$(( y = 2 ))` and `let 'z = 3'` never said it.
- A name in the header is the variable bash reads, as in `(( ))`: `x` in `for ((; !x; ))`, `-x`, `~x`, and `i` and `n` in `i < n`. Before, `x` was "Word `x`", and the names beside an operator were not explained.

### Words as bash reads them

A word is explained with the shell options and the `IFS` in effect where it runs (bash 5.2):

| Written | bash | Said now | Said before |
| --- | --- | --- | --- |
| `ls **/*.sh`, globstar never turned on | `**` is `*`: `d/b.sh`, not `a.sh` or `d/e/c.sh` | "`**` is the same as `*` and matches one level only", with an example of one level | "`**` matches directories at any depth", with an example at every depth |
| `if …; then shopt -s globstar; fi; ls **/*.sh` | any depth on one path, one level on the other | both, and the example says "where globstar is on" | any depth |
| `shopt -s globstar dotglob; ls **/` | directories starting with `.` too | "any depth (zero or more)", and the dotglob note | "not those starting with `.`" |
| `echo "${x%.@(gz\|bz2)}"`, extglob not on | `@(gz\|bz2)` is plain text: `a.gz` stays `a.gz` | "there is no extended glob: `(`, `\|` and `)` are matched as plain characters", one part of plain text | the part `@(gz\|bz2)` was "extended glob, exactly one of the alternatives" |
| `IFS=,; read -r a b <<< "$line"` | splits on `,` | the example's line is `alice,30,tokyo`: `a="alice"`, `b="30,tokyo"` | the line `alice 30 tokyo`, split on spaces |
| `case $x in "$q")` | the value of `q` is literal text (`q='a*'` matches only `a*`) | "the expansion is quoted, so its value is matched as literal text" | "what it expands to is the pattern" |
| `case $x in $p"*")`, `${q:-"*"})` | `$p` is a pattern, `"*"` a `*` | "what the unquoted expansions give is a pattern, and the quoted parts are matched as literal text" | "what it expands to is the pattern" |
| `case $x in $'a*')` | only `a*` matches | a part quoted with `$'…'` | a glob pattern with no parts |
| `x=1 $cmd env`, `cmd` empty | `env` is the command, with `x` set for it; `x=1 $cmd` alone, or `x=1 $cmd $cmd`, sets the shell's `x` | "Environment variable set only for this command"; with only words that may give none after the name, "(if `$cmd` and the words after it expand to no word at all, it stays as a shell variable)" | "(if `$cmd` expands to no word at all, it stays as a shell variable)", also with `env` after it |
| `echo "pre$@post"`, no positional parameters | one word, `prepost` (`a` and `b c` give `prea` and `b cpost`) | "the text before joins the first element, and the text after the last (with no elements, the text alone makes one word)" | "no word at all when there are none" |
| `x=~` | the home directory | "Tilde expansion: `~` becomes the home directory" | "Value `~`" |
| `y=$'\n'` | a newline | "it is the string `␊` (control characters are shown as symbols: `␊` is LF (line feed, newline))"; `$'\t'` and `$'\r'` say what `⇥` and `␍` are | "the string `\n`", like the two characters of `$'\\n'` |
| `${x:?"msg"}`, `${x:?"need $y"}` | prints `x: msg`, `x: need …` | "Exit with error "msg"", "need $y" | `""msg""`, `""need $y""` |
| `${x:?""}` | prints `x: ` (an empty message) | the error "" | the example said "(a default message)" |
| `: "${x:?'a b'}"`, `${x:?$'t\tx'}` | prints `x: a b`; `x: t⇥x`, with a tab for `⇥` | the message "a b", "t⇥x", in the token and the example | the example said `'a b'`; `$'t\tx'` as written |
| `a=(["k"]=w)` | index `$k`: 0 when `k` is not set | "index `k` (an arithmetic expression: the value of the variable `k`, 0 when it is not set)" | "index `k`" |
| `declare -n r=m; declare -A m; r=([k]=v)` | `m` is associative: the key `k` | "key `k` (a string, not evaluated)" | "index `k`" |
| `if …; then declare -A m; fi; m=([k]=v)`, `declare -A "$v"`, after `source ./lib.sh` | a key if `m` is associative there | "subscript `k` (a key if the array is associative, an arithmetic expression otherwise)" | "index `k`" |
| `echo "${s@K}"`, `${a@K}`, `${@@K}` | `'hello'`: quoted, as `@Q` does | "quote it as `@Q` does (only all the elements of an array, `${a[@]@K}`, give keys and values)" | "show it as key/value pairs" |
| `x=s; echo "${!x@K}"`; `x='ia[@]'` | `'hi'`; `0 "p" 1 "q"` | as `@Q` does; key/value pairs (with `x` not known, both) | key/value pairs |
| `x="$(printf '%s\n' "${a[@]}")"`, `f "${a[@]:+x}"`, `f "${y:-$(… "${a[@]}")}"` | one word | the outer string "stays one argument" | it said `"${array[@]}"` gives one word per element, a note for the inner string |
| `x="${a[@]}"`, `local x="${a[@]}"` | one value, the elements joined with spaces | "stays one argument" | one word per element |
| `TARGETS=${HOSTS[@]}`, `local x=${a[@]}`, `t=$@`, `cat <<< ${a[@]}`, `case ${a[@]} in` | one string: the elements joined with a space; `${a[*]}` and `$*` join with the first character of `IFS` (none when it is empty) | "In the value of an assignment there is no word splitting: the elements are joined into one string, separated by a space (quoting does not keep them apart)"; after `IFS=:`, `${a[*]}` is "separated by the first character of `IFS`, `:`" | "all elements of array `HOSTS`", and `[@]` said "(quoted, `"${a[@]}"` keeps each element a separate word)" |
| `shopt -s failglob` (or `nullglob`), then `for f in *.txt; do [ -e "$f" ] \|\| continue; …` | a glob that matches nothing is an error (or goes away), so the loop never gets `*.txt` | no idiom (nor where either may be on) | the idiom "bash keeps `*.txt` as it is and the loop runs once with that text" |
| `for f in "$@"; do [ -e "$f" ] \|\| continue; …` | no glob: nothing is kept as written | no idiom | the same idiom |
| `echo "${x%@(a\|"$q")}"`, extglob not on | runs: `@(…)` in `${x%…}` is plain text (`x=ab` prints `ab`) | no caveat | "extended globs like `@(a\|` are a syntax error unless `shopt -s extglob` comes first" |

| `declare -i n; n+=5`, `declare -ia a; a[0]+=5` | adds: 7 becomes 12 | "if `n` is 7, `+=5` makes 12, not 75"; with `n+=x`, "the value of the arithmetic expression `x` is added" | "if `n` is 7, `+=1` makes 8, not 71", whatever the operand |
| `command declare k=1`, `builtin export q+=x`, `command declare z=$y` | `declare` assigns `k`; bash passes the word as an ordinary argument, so `z=$y` with `y='1 2'` is split (`z=1`, and an error on `2`) | "Assign `1` to the variable `k` (`declare` reads the word as an assignment). To bash it is an ordinary argument, not an assignment…"; with `$y`, "an unquoted expansion in it is split and globbed" | "Variable `k=1`" |
| `for (( c = 0; c < 2; c++ )); do echo $v; done` | the body is commands: `$v` is split and globbed | "Expands to the value of `v` (unquoted, it is word-split and globbed)" | "Expands to the value of `v`": the body was read as arithmetic |
| `a=1; a=2 export a; echo $a`, also `readonly`, `command export` | the prefix assignment stays after the command, exported: `2` | "`export` gets this name, so this assignment stays after the command, exported" | "set only for this command" |
| `s='[section] key'; echo "${s//[/}"`, `${u//[/]/x}` | the pattern ends at the first `/`, also inside brackets: `section] key`; `[` becomes `]/x` | the example of the line, from that pattern | no example, or one of the pattern `[/` |
| `[[ $x == ~ ]]`, `[ "$x" = ~ ]` | `~` is the home directory: `x='~'` makes it false | no example | "True when `x="~"`" |
| `${t//[\!]/x}`, `${t//['a-c']/x}` | a quoted `!` or `-` in brackets is the character: `!`; `a`, `-`, `c` | the example replaces those characters | "any character but…", and the range `a-c` |
| `for f in [$x].txt`, `echo [$d].c`, `ls ["$x"]`, `case $1 in [$x])` | the expansions in a bracket expression are its characters: with `x=ab`, `a.txt` `b.txt`; with `d=x`, `[x].c`; with `x` unset, `[].txt` | `$x` is a variable of the word, and its `[` and `]` are a glob's; no example of file names, which depend on the value | one glob of the text `[$x]` (one of `$` and `x`), with an example of it |
| `ls [a"-"c]*`, `ls [a\-c]*`, `ls ['^'a]*`, `x=-; [[ $x == [a"-"c] ]]` | a quoted or escaped `-` or `^` in brackets is the character: `[a"-"c]` is `a`, `-` or `c`, `['^'a]` is `^` or `a`; a quoted end still ends a range (`[a-"$y"]` with `y=c`) | the file names and the conditions that follow (the `[[ ]]` is true) | the range `a-c` (`b.txt` matched too), or a negation |
| `a=1; declare a=5 b=$a`, `local x=$x` | the words are expanded before the builtin runs: `b` is `1`, and the local `x` gets the caller's value | the values that follow from them (the words of `$b`, the value of `$x`) | `b` was `5`, the local `x` empty |
| ``x=`printf '%s' 'a\$b'` ``, ``x=`eval 'a\$b'` `` | in backquotes bash removes the backslash before `$`, `` ` `` and `\` first: `printf` gets `a$b` | no example; the words are `a$b` (in the values and the conditions the model follows) | the example printed `a\$b`; the word was `a\$b` |
| `echo $DIR/*`, `echo "$DIR"/*`, `echo {a,b}"x"`, `x='a b'; echo $x/c` | other than one word: the files `$DIR/*` matches; `ax` `bx`; `a` `b/c` | "the parts below are joined, but word splitting and globbing may make several words of it", "… but brace expansion makes 2 words of it: `ax` `bx`", "… but word splitting makes 2 words of it: `a` `b/c`" | "Concatenation: the parts below are joined into one word" |
| `echo $a$b`, `IFS=; echo $a$b`, `e=; echo $e$e`, `shopt -s nullglob; echo "$x"*` | no word when nothing is left (an unquoted empty expansion is removed, also with an empty `IFS`; nullglob) | "…, or none", "no word is left" | "joined into one word" |
| `echo $@/x`, `IFS=; echo $@/x` | one word per argument (`1` `2 3/x`), also with an empty `IFS` | "`$@` (one word per element) and globbing may make several words of it" | "joined into one word" |
| `x='a b'; cat > $x/a`, `cat > $HOME/x` | "ambiguous redirect" (or may be) | "word splitting makes other than one word of it, which bash refuses here" ("may make") | "joined into one word" |
| `e=; cat > $e$e`, also after `IFS=`, `set -f` or `set -o posix` | "ambiguous redirect" (dash opens the empty name) | "the parts below all expand to nothing … no word is left, which bash refuses here" | "joined into one word" (after `IFS=` or in POSIX mode) |
| `a=(); b=; echo "${a[@]}"$b` | no word | "with no elements, the text around it makes one word, or none when it expands to nothing too" | "with no elements, the text around it makes one word" |
| `cp $a b`, `grep -c ${x} f`, `cp $e $u c` (the variables empty) | `cp b`: `b` is a source (cp: missing destination file operand); `grep -c f`: `f` is the pattern; `cp c` | "…; source when `$a` expands to nothing", "file to search (default: stdin); search pattern (regex) when `${x}` expands to nothing", "destination directory; source when `$e`, `$u` expand to nothing" (not after `a=1`) | the roles for one word or more only: a destination, a file |
| `cp $a`, `ln -s $a`, `cmp $a`, `chmod {a,b}*`, `cmp {a,b}* f`, `cmp $a f` (`a` of two words or more) | `cp x y`: `y` is the destination of the two-operand form, a new name or an existing directory; with three words, the last must be a directory; `ln -s x y` makes the link `y`; cmp reads a form for each count up to four; `{a,b}*` gives two words at least | "…; when it expands to 2 words, they are source, then destination (the new name, or an existing directory); when it expands to more, they are source, then destination directory", the same for `ln -s` and for each count of `cmp`; "when `{a,b}*` expands to 2 words or more, they are mode (…), then target file"; `f`: "bytes to skip in the first file when `{a,b}*` expands to 2 words; …", and of `cmp $a f` a role for each count | "when it expands to more, they are source, then destination directory", the roles of three words for any count (`cmp` too); "mode when `{a,b}*` expands to a single word", "… when `{a,b}*` expands to a single word"; `f` of `cmp $a f` skipped bytes in the second file for any count |
| `cp $a $b`, `gosu $a $b`, `cmp $a $b`, `mknod $a $b`, `ln -sf $a $b` (`a='x y'`, `b=z`) | `cp x y z`: `z` must be a directory; `gosu x y z` runs `y z`; `cmp x y z` skips `z` bytes in the first file | "destination (…) when `$a`, `$b` expand to a single word; when any of them expands to more, each of its words is source or destination directory" (the roles any counts give) | "destination (the new name, or an existing directory) when `$b` expands to a single word; …", the roles with `$a` one word |
| `x='-r a'; cp $x d`, `x=-r; cp "$x" a b`, `x='-n 2'; head $x f`, `x='-- -r'; cp $x d`, `set {-e,-u}`, `x='commit -m m'; git $x` | the fields of a known value are the command's words: `cp -r a d` (`-r` an option), `head -n 2 f`, `cp -- -r d` (`-r` a source), `set -e -u` (both turned on) | "expands to `-r` (option: copy directories recursively) and `a` (source)", "… `-n` (option: …) and `2` (value for `-n`)", "… `--` (end of options) and `-r` (source)"; `d` is the destination of the two-operand form | "source", and the words after it with the roles of another form (`d` "destination directory"); `set {-e,-u}` "becomes the positional parameter `$1`" |
| `z=; cp $z $p` (`p='a b'`), `z=; cp $z c`, `x=; y=; cp {$x,$y} d`, `y=a; cp $y c` | a known empty word gives none (`cp a b`, `cp c`, `cp d`), and one known field is one word | "expands to no word, so `cp` does not get it"; `$p` "expands to `a` (source) and `b` (destination: …)"; `c` of `cp $y c` "destination (the new name, or an existing directory)", with no hedge | the roles with the empty word as one word ("source"), or as one word or none; "… when `$y` expands to a single word; destination directory when it expands to more" |
| `x=; f $x d`, `p='a b'; f $p d` (`f` a function), `set -- $p d` | `d` is `$1`, then `$3`; `set --` sets `$1=a $2=b $3=d` | "Argument $1 to the function", "Arguments $1 (`a`), $2 (`b`) to the function", "expands to `a` (becomes the positional parameter `$1`) and `b` (… `$2`)" | `d` was "Argument $2"; `$p` "`$1` (… the number shifts)" |

`[[ $x == "$q" ]]` already said that a quoted right side is literal text.

Braces are read as bash 5.2 finds them, where it expands them (compared with bash on random words of braces, commas, dots, quotes and expansions):

| Written | bash | Said now | Said before |
| --- | --- | --- | --- |
| `x={1..3}`, `cat <<< {1..2}{a,b}`, `[[ x == {1..2} ]]`, `a+=b{1,2}` (an assignment of its own, or before a command) | no brace expansion there: `{1..3}` | "Value `{1..3}`"; the words are text | "Brace expansion: `{1..3}` expands to 3 words" |
| `declare x={a,b}`, `local y=p{1..3}`, `export P=/a/{b,c}`, `alias z={a,b}` | words bash expands: `declare x=a x=b` sets `b`, `alias z=a z=b` defines `z` as `b` | "Brace expansion: `{a,b}` expands to 2 words" (as for `{1..3}`), and Reading has the brace's rows; a script for sh is told brace expansion is not POSIX there, and not for `x={1..3}` | `declare x={a,b}` and `export P=/a/{b,c}`: "Value `{a,b}`" |
| `set -o posix`, then `command export x=$v`, `command command alias z=$v` (with `v='a b'`) | an assignment, as if `export` were the command's name: `x` is `a b` (bash 5.2 and 5.3); not after `command -p`, `command --` or `builtin`, nor out of POSIX mode | "In POSIX mode, bash expands it as an assignment after `command` too (no word splitting or globbing)" | "To bash it is an ordinary argument …: an unquoted expansion in it is split and globbed" |
| `echo {a,b}"x" \| cat` | `ax bx` | explained, and the pipeline's example prints `ax bx` | the line had no explanation (an error) |
| `echo x{a,"b c"}y`, `echo {a,$x}` | `xay` and `xb cy`; `a` and the value of `x` | the example's words `xay` `xb cy`; no example of words for `{a,$x}` | `xay` `x"b c"y`; the words `a` `$x` |
| `echo [{a,b}]`, `echo ["{a,b}"]`, `[${v:-a,b}]` | `[a]` `[b]`; the others one word (a quote or an expansion in a bracket hides its commas) | so | (the last two) a brace expansion |
| `echo {1..$n}`, `e{.."$v"}` with `n=3`, `v=V` | `{1..3}`, `e{..V}` | the variable is a part of the word, expanded inside the braces that stay, and the note "is not a range" | the value `{1..$n}`, `e{.."$v"}` as written |
| `echo {+01..3}` | `1 2 3`: only a leading `0` or `-0` pads | no padding note | "a number with a leading 0 pads all of them" |
| `echo {a}b,c}`, `x{},a}`, `{a,{b,c}`, `{+1..3}` | `a}b` `c`; `x}` `xa`; `{a,b` `{a,c`; `1` `2` `3` (a `}` before the first `,` does not close the braces, nor does a `{` that starts the word and a `}` follows open them) | brace expansions, with those words | plain words |
| `echo {x..{a,b}}`, `{x..{1..2}}` | `x..a` `x..b` (braces that hold no sequence go, when a comma is inside them); `{x..{1..2}}` as it is | those words | `{x..a}` `{x..b}`; `{x..1}` `{x..2}` |
| `echo {a,b} > {c,d}` | "ambiguous redirect" | the target shows its words too, as `> {1..2}` did | the note alone |
| `echo {a,b}$x`, `x` empty | `a` `b` | the words are known (in the values and the conditions the model follows) | not known |
| `trap {x,EXIT}`, `trap {y,INT} TERM`, `bash -c {x,y}` | `trap x EXIT`: the action `x` on `EXIT`; `bash -c x y`: `y` is `$0` | "expands to `x` (command to run…) and `EXIT` (signal…)", each word with its role | the braces were the action alone (or the command string), "not explained as a script" |
| `printf '%s,'{a..c}`, `trap "echo "{a,b}`, `cp x"y"{1,2} d` | braces next to a quoted part give a word each: the format `%s,a`, then the values `%s,b` `%s,c`; the action `echo a` on the signal `echo b` (an error); two sources | "expands to `'%s,'a` (format string), `'%s,'b` (value for the format) and `'%s,'c` (value for the format)", each word with its role; `d` is the destination directory | one word: the format alone; the signal alone; `d` the destination of the two-operand form |
| `cp 'a'{,}`, `cp 'x'{a,}` | the braces' empty words stay next to the quoted part: `a` `a`; `xa` `x` | "`{,}` expands to 2 words: `''` `''`", and the two words with their roles | "`{,}` expands to empty words, which are dropped, so nothing is left"; "`{a,}` expands to 1 word"; one source |
| `set +B; cp {a,b} d` | no brace expansion: `{a,b}` is one word, a source, and `d` the destination | so | `d` the destination directory, as if the braces gave two sources |
| `x='p q'; cp {a,$x}`, `cp {a,$(echo b c)}`, `cp {a,"$@"}`, `cp "x"{a,$z}` | an expansion in a word of the braces may split it or give none: `cp a p q` (`q` the destination directory); with `x` empty, `cp a` | "expands to `a` (source), `p` (source) and `q` (destination directory)" where the value is known (`x=p; cp {a,$x} d` keeps two sources), and the hedge of one word or more where it is not; the brace token adds "which the expansions after it may make into more or fewer words" | exactly two words: "expands to `a` (source) and `$x` (destination: the new name, or an existing directory)" |

A tilde before a glob is expanded, then the word is globbed:

| Written | bash | Said now | Said before |
| --- | --- | --- | --- |
| `ls ~/*.txt` | the `.txt` files in the home directory | "The rest, `/*.txt`, has wildcards: the expanded path is then a glob, replaced by the file names it matches", with the parts of the glob | "The rest, `/*.txt`, stays as it is" |
| `set -f; ls ~/*.txt` | `~/*.txt` with the home directory, as written | "stays as it is", and the note on `set -f` | "stays as it is" |
| the example of `ls ~/*.txt`, of `/var/cache/apk/*` | a hidden file is not matched | `~/.app.txt`, `/var/cache/apk/.app` | `.~/app.txt`, `./var/cache/apk/app` |

### Tests and redirections as bash runs them

| Written | bash | Said now | Said before |
| --- | --- | --- | --- |
| `[ 08 -eq 8 ]`, `test 09 -lt 10` | true: `[` reads decimal integers | "`08` is 8 (not octal)" | "`08` is an error (integer expression expected)", which is what `[[ 08 -eq 8 ]]` says |
| `[ -08 -eq -8 ]`, `[ -010 -eq -10 ]` | true | "`-08` is -8 (not octal)" | "`-08` is an error (integer expression expected)", "`-010` is 10" |
| `[ "$a" \< "$b" ]`, `test a '>' b` | compared by byte values, not in the locale's order; `\<` is the operator `<` | "sorts before, compared by byte values, not in the locale's collation order" | "sorts before (lexicographically)"; `[ a \< b ]` was four plain words |
| `[[ a < B ]]` | in the locale's collation order (`LC_COLLATE`: true in en_US.UTF-8), by bytes after `shopt -s compat40` (or `compat31`, `compat32`, or `BASH_COMPAT=40`, `4.0`, `31`…) | "compared in the locale's collation order (`LC_COLLATE`)"; at level 4.0 or lower, "compared by byte values" | "sorts before (lexicographically)" |
| `/usr/bin/test a '<' b`, `env [ a \< b ]` | GNU coreutils' `test` has no `<` nor `>`: "binary operator expected", status 2 | "… But GNU coreutils' `test` has no such operator: it says "binary operator expected" (status 2)" | "sorts before (lexicographically)" |
| `set -o posix`, then `test a '<' B` | bash 5.3: in the locale's order (true in en_US.UTF-8), and `[[ ]]` too whatever the compat level; bash 5.2: by bytes (false) | as `bashVersion` says; in 5.2 mode, that bash 5.3 uses the locale's order there | "sorts before (lexicographically)" |
| `[ 1e3 -eq 1 ]` | an error, in `[[ ]]` too | "`[[ ]]` rejects it too, as arithmetic (value too great for base)" | "`[[ ]]` would read it as arithmetic" |
| `[[ 1e3 -eq 1 ]]`, `[[ 0#1 -eq 1 ]]`, `[[ 1#1 -eq 1 ]]` | value too great for base, invalid number, invalid arithmetic base | "`1e3` is no valid number (`e` is not a digit in base 10): an error (value too great for base)", and bash's message for each | "`1e3` with a leading 0 is octal", and "value too great for base" for all |
| `cat 3<<EOF <&3` | cat prints the here-document | "become file descriptor 3"; "In the end: stdin → the here-document `EOF`, fd 3 → the here-document `EOF`"; its body lines are "started by `3<<EOF`" | "become stdin"; "stdin → the original fd 3"; "started by `<<EOF`" |
| `cat 3<<A 4<<B <&4` | cat prints the body of `B` | "stdin → the here-document `B`, fd 3 → the here-document `A`, fd 4 → the here-document `B`" | "stdin → the original fd 4" |
| `cat 3<<< x <&3` | prints `x` | "becomes file descriptor 3", and no token "file_descriptor" for the `3` | "becomes stdin" |
| `cat <<< x 2>&1 > f` | | "stdin → the here-string" | "stdin → the here-document/string" |
| `cat <<A <<B`, `cat <<<x <<B`, `cat <<A <f` | cat reads only the last one: bash opens the first (and expands its body), then the later one replaces stdin | "`<<A`: … opened as stdin; but the later `<<B` then replaces stdin, so the command does not read them" | both "become stdin" |
| `cat <<A <<B` on line 1, `B` ending on line 6 | | each names its own lines, the body and the end: `<<A` "(lines 2–3)", `<<B` "(lines 4–6)" (an empty one, its end line: "(line 2)") | from the operator's line: "(lines 1–3)", "(lines 1–6)", which covered `A`'s body too |
| `cat <a <b`, `echo hi >a >b`, `>>a >b`, `<>a <b` | `a` is opened (`<a`: it must exist), created or emptied, but not read or written | "But the later `<b` then replaces stdin (fd 0): `a` is opened (it must exist) but not read"; "`a` is created or emptied, but nothing is written to it" | "Read file `a` as stdin", "Write stdout (fd 1) to file `a`" |
| `echo x >a >"$f"`, `>a >b/../a`, `>/tmp/a >a`, `>/dev/null >b` | `a` gets `x` when `f=a`, or when `b` is a directory, or in /tmp; a device (`/dev/null`, `/dev/zero`, `/dev/tty`, `/dev/fd/N`…) is not created or emptied, but another path under /dev is a file (`/dev/shm/data`) | "… nothing is written to it (unless `>"$f"` names the same file, which is then used)"; "`/dev/null` is opened, but nothing is written to it" | |
| `ls x >a 2>&1 >b`, `cat 3<<A <&3 <<B`, `>o1 {v}>&1 >o2`, `>a >/dev/stdout`; `>s >s`, `>s >>s`, `cat <a <a` | `2>&1`, `<&3`, `{v}>&1` and `/dev/stdout` copy the descriptor before it is replaced: `a` gets stderr; the same file is written or read | as before | |
| `echo hi > {a,}` | writes the file `a` | "Write stdout (fd 1) to file `a` (overwrite). Brace expansion makes `{a,}` the one word `a`" | "to file `{a,}`" |
| the same in sh or dash | writes the file `{a,}` (no brace expansion); `> {a,b}` writes `{a,b}` | "to file `{a,}`", with no note | (`> {a,b}`) "Brace expansion makes several words of it" |
| `echo hi > {,}` | "ambiguous redirect" | "Brace expansion leaves no word of it" | "makes several words of it" |
| `echo x 2>&f`, `3>&f`, `<&f`, `{v}>&f`, `2>&/dev/tcp/h/80` | "ambiguous redirect": only `>&f` and `1>&f` write both stdout and stderr to `f` | "`f` is no file descriptor number, so bash reports "ambiguous redirect"" | "Write both stdout and stderr to `f`"; for `<&f`, "a copy of file descriptor f" |
| `exec 3<>/dev/tcp/example.com/80`, `cat < /dev/udp/h/53`, `>&/dev/tcp/h/p`, `{s}<>/dev/tcp/h/p`, `> "/dev/tcp/h/80"` | bash connects (TCP or UDP), and fails if it cannot | "Connect to host `example.com`, port `80`, over TCP, and use the connection for reading and writing as file descriptor 3 (not a file …)" | "Open `/dev/tcp/example.com/80` for reading and writing" |
| `> /dev/tcp/h/80/x`, `> /dev/tcp//80` | an error: no host and port | "The shell takes `/dev/tcp/h/80/x` as a network address (host `h`, port `80/x`), which is no valid host and port: the redirection fails" | the file |
| the same in sh or dash | a path, usually missing ("No such file") | the file, "dash opens `/dev/tcp/…` as an ordinary path, usually missing (POSIX does not define it; bash, yash and ksh93 connect to the network)", and a portability warning | the file, no warning |
| `x=$(ls /none) 2>/dev/null`, `x=$(cat) < f`, `> f` | a command with no name: bash opens the files and closes them again, and the redirections apply to nothing: `ls` still shows its error, and `cat` reads the shell's stdin (bash 5.2 and 5.3; dash applies them to the substitution) | "Redirections of a command with no name: bash opens the files (creating or emptying one for `>`) and closes them again. The shell's own input and output do not change, nor do they apply to the assignments `x=$(ls /none)` …" | "Redirection applied to `x=$(ls /none)` as a whole"; for `> f`, "Redirection applied to the command" |
| `echo "$(< f)"`, `` echo `< f` `` | the contents of `f`; any other command with no name in it (`$(3< f)`, `$(< f; < g)`, `$(< f &)`) prints nothing | "Command substitution `$(< file)`: replaced by the contents of the file `f` (trailing newlines removed), as `$(cat f)`, but without running `cat`" | "runs the command and is replaced by its stdout" |

Examples:

| Written | bash | Shown now | Shown before |
| --- | --- | --- | --- |
| `[[ $x =~ ^"a."c$ ]]`, `^'a.'c$` | only `a.c` matches: the quoted `.` is literal | matches `a.c`; `a.` and `.c` do not | the regex of `c$` alone: `c` and `abc c` "match" |
| `[[ $x =~ a$y ]]` | depends on `$y` | no example | the example of `a` alone |
| `sort <(printf 'b\na\n')` | sorts the lines `b`, `a` that printf writes to the pipe | "Input: output of `printf 'b\na\n'` (through the pipe `<(printf 'b\na\n')` names)": `b`, `a`; output `a`, `b` | "Input: the files `<(printf 'b\na\n')` names (sample contents)": `banana`, `apple`, … |
| `jq . <(curl -s url)`, `sort <(cmd) <(cmd2)` | the command reads the output of `curl` from a pipe (`/dev/fd/63`) | "Input: sample output of `curl -s url` (through the pipe `<(curl -s url)` names)" | "Input: the files `<(curl -s url)` names (sample contents)" |
| `sort < <(cmd)` | stdin is the pipe | "Input: stdin (sample output of `cmd`, through the pipe `<(cmd)` names)" | "Input: stdin (`<(cmd)`, sample contents)" |
| `cut -d: -f1,7 /etc/passwd`, `awk -F: '$3 >= 1000 {print $1}' /etc/passwd`, `cat /etc/group \| cut -d: -f1,4`; also `/etc/shadow`, `/etc/hosts`, `/etc/fstab` | reads the system file | "Input: `/etc/passwd` (sample contents)": lines in its format (`root:x:0:0:root:/root:/bin/bash`, `alice:x:1000:1000:Alice:/home/alice:/bin/bash`…), and the output the tools give for them (`root:/bin/bash`…) | made-up lines (`1:alice:tokyo:30:admin:x:y:z`…) |

The panel's Reading view failed on a here-document with no delimiter yet (`cat <<`, then more lines): a `TypeError`. It now shows the `<<` as a redirection.

### Quote removal in find's expression

find's expression is read from its words as bash passes them, after quote removal. A word whose value is not known (`$x`, an unquoted glob) is read as written.

| Written | find gets | Shown before |
| --- | --- | --- |
| `-name 'a'"b"` | `ab` | `'a'"b"` |
| `-name 'a'b'c'` | `abc` | `a'b'c` |
| `find '\-name' x` | the paths `\-name` and `x` | the test `-name x` |

The pitfall on `sudo cmd > /etc/…` also reads the path after quote removal: `sudo echo 1 > '/proc'/sys/vm/drop_caches` and `> ""/etc/x` are pointed out too.

### zsh

- An unquoted `$var` or `${var}` is no longer said to be "word-split and globbed" in zsh, which does neither by default (`SH_WORD_SPLIT` and `GLOB_SUBST` are off). The pitfall on `cp $a b` is gone there, and so is the one on `for a in $@` (zsh gives each argument as one word). `[`'s explanation says that an empty unquoted variable is dropped, and `[ -n $x ]` keeps its pitfall with that reason.
- `{ echo a }` is not a pitfall in zsh, where `}` closes the group without a `;` unless `IGNORE_CLOSE_BRACES` is set.

### Syntax colouring (`bashExplainer.highlight.enabled`)

- The scope mappings for our semantic tokens (`semanticTokenScopes` in package.json) had one entry for every language, so VS Code applied them to the semantic tokens of all languages, even with the setting off: a TypeScript parameter turned keyword blue, and `keyword` tokens of other languages took the shell grammar's colour. There is now one entry per language we send tokens for: `shellscript`, `makefile`, `yaml`, `github-actions-workflow`, `json` (package.json), `markdown`, `groovy`, `jenkinsfile` and `bats`. A language you add to `bashExplainer.languages` has no entry, so its tokens get VS Code's default mapping of the standard token types (still coloured by the theme's semantic colours, but not as the shell grammar).
- With the setting on, a document with no shell code in it gets no answer from us, not an empty one. Before, the empty answer hid the semantic tokens of other extensions (the language server of a Dockerfile or YAML schema, for example) in those files.
- We send no semantic tokens for Python files and Dockerfiles. VS Code takes the tokens of one provider for the whole file, so ours would have replaced those of Pylance, or of the Docker extension's language server, for the whole file wherever it held shell code; and a scope mapping for `dockerfile` would have remapped the Docker server's tokens even with the setting off. Their shell code keeps the colour of the TextMate grammar and the explanations are unchanged. The Language Server (`cli/lsp.ts`) still sends tokens for every document it explains (an LSP client combines servers itself).
- In host files, a token no longer covers the host syntax that the extraction rewrote: make's `$(wildcard *.tmp)` or `$(CC)` keeps make's colour, and so does `${{ github.ref }}` in a workflow. A token that only partly covers such text is cut at its edge (`"a $(X) b"` gives the tokens `"a ` and ` b"`).

### Examples of `date` and `sed`

The `date +FORMAT` example reads the options and the zone of the line, as GNU date does (compared with GNU date in the tests). Where the line names no zone, date prints in the local zone: the example takes it to be UTC, and says so ("Output (if the local zone is UTC)").

| Written | date prints | Shown now | Shown before |
| --- | --- | --- | --- |
| `date -d '2024-01-02' +%A`, `date --date=@0 '+%F %T'` | `Tuesday`; `1970-01-01 00:00:00` if the local zone is UTC, whenever it runs | "Example (the date given with `-d`)": `Tuesday`; `1970-01-01 00:00:00` | two made-up moments it runs at, and their weekdays (`Tuesday`, `Wednesday`) |
| `date -d 'next friday' '+%A %T'`, `-d yesterday`, `-d '+3 days'`, `-d 10:00`, `-d 'tomorrow 10:30 pm'` | a date that depends on when it runs | "Example (`next friday` depends on when it runs)": made-up moments it runs at, and what the date gives at each (`Friday 00:00:00`, the same time yesterday, `10:00:00`) | the moments it runs at, as if `-d` were not there |
| `date -d "$d" +%F` | the date in `$d` | made-up dates "`-d "$d"` stands for" | the moments it runs at |
| `date -f dates.txt +%A`, `echo 2024-01-02 \| date -f - +%A` | each line of the file, as a date | "Input: `dates.txt` (sample contents)" and the date of each line; the lines echo gives | the moments it runs at |
| `date -r f +%T` | the time `f` was last modified | "Modification time of `f` (made up, UTC)" | "When it runs" |
| `TZ=Asia/Tokyo date '+%T'`, `TZ=:Europe/Paris`, `TZ=EST5EDT`, `TZ=JST-9`, `export TZ=…`, `env TZ=Asia/Tokyo date`, `env -i TZ=… date` | the time in that zone | "Output (the time in the zone `Asia/Tokyo`)": `16:08:09` for `07:08:09` UTC | the time in UTC, `07:08:09` |
| `env -u TZ date`, `env -i date` | the time in the local zone | "Output (if the local zone is UTC)" | the time in UTC |
| `date -u +%T`, `TZ=Asia/Tokyo date -u +%T` | the time in UTC | "Output (the time in UTC)" | the same |
| `date -I +%F`, `date -s … +%F`, `date -d @0 -r f +%F`, `date +%F +%T` | an error: another output format, setting the clock, two dates, an extra operand | no example | the moments it runs at |
| `TZ=$z date +%T`, `TZ=asia/tokyo`, `TZ=JST`, `TZ=PST` (glibc has no such zone and reads them as UTC), `TZ=Japan`, `TZ=Asia/Calcutta` (backward links, which some systems leave out), `TZ=Asia/Tokyo date +%Z` | a zone (or its abbreviation) not known here | no example | the time in UTC, `UTC` |
| `export TZ=Asia/Tokyo; sudo date +%T`, `docker run -e TZ=… img date` | TZ as sudo's policy keeps it, or in the container | no example | the time in UTC |
| `TZ=Asia/Tokyo date -d @-1 +%F`, `date -d @253402300800 +%F`, `date -d 'next friday next friday'`, `-d satday`, `-d 25:00`, `-d '10:00 -3 days'` | a date before 1970 in a named zone (the tz data of systems differ there), a year of five digits (`+10000-01-01`), an error, or `-3` read as the zone of `10:00` | no example | the moments it runs at |

`sed -e 's/a/b/' -e 's/c/d/' f` showed the same example twice, once at each `-e`. sed runs the scripts in order as one script, so there is one example, of the whole script, shown on the command.

The example of a pipeline inside `$( )` or `<( )` was titled with the command around it, or not named: `echo $(echo a | tr a b) | cat` gave "Example for `echo $(echo a | tr a b)` (the whole pipeline)", and `for i in $(seq 3 | sort -r)` gave "Example (the whole pipeline)". It is now "Example for `echo a | tr a b` (the whole pipeline)", also in `x=$(…)`, `[[ $(…) == b ]]` and `for i in $(…)`.

### Names

| Written | Shown now | Shown before |
| --- | --- | --- |
| `builtin cd "$x"`, `command cd /tmp` | `cd`: "Change the current directory", badge builtin; in Reading, a command name under the word `cd`, and `"$x"` read by `cd` | "runs `cd`: Change the current directory", badge "builtin, run by `builtin`"; in Reading, `cd "$x"` read by `builtin` |
| `alias ll='ls -l'; ll -h` | `ll`: "Run the command `ll` (the alias of line 1 is not in effect here)"; `-h` an option of `ll` | "Alias `ll`: list files in long format", the alias of Ubuntu and others, and `-h` "human-readable sizes", an option of `ls` |
| `zsh -c 'echo hi'`, `dash`, `ksh93`, `mksh` | "Run the Z shell (zsh)", "Run dash, a small POSIX shell (`sh` on Debian and Ubuntu)", "Run the Korn shell (ksh93)"… | "Run the POSIX shell" |
| `toString x`, `constructor`, `hasOwnProperty a`, `valueOf`, `__proto__` (bash: not found) | "Run the external command `toString`", badge program | the same text with the badge builtin, also after `builtin`; after `enable -n toString`, "`enable -n` … turned the builtin `toString` off" |
| `set -o constructor`, `cat < constructor`, `echo hi 2> valueOf` | "Value for `-o`"; "Read file `constructor` as stdin (fd 0)" | "constructor: undefined"; "… as stdin (fd 0). undefined" |
| `jq 'constructor' a.json`, `yq '.a \| constructor' a.yaml`, `echo '{"a":1}' \| jq '.toString'` | "a function (built-in or defined with `def`)"; the example prints `null`, as jq does | the line was not explained (an error) |
| `jq -n '{} \| .__proto__ = 3'`, `setpath(["__proto__"]; 5)`, `{} * {"__proto__": {"a": 1}}`, `from_entries`, `jq -n --arg __proto__ v '$__proto__'`, `yq -n '.__proto__ = 3'` | the example prints `{"__proto__": 3}`, `"v"`, as jq and yq do | the key, or the variable, was lost (`{}`) |

The tables the explanations read (the commands, the variables, the functions of jq, yq, awk and perl, the classes of a bracket expression, the words of `date -d`…) are looked up by the words of the script; those that are also the names of what every JavaScript object has found that instead.

`builtin` and `command` look the name up (`builtin` among the builtins only, `command` past aliases and functions), and the builtin they find runs as bash would run it. Their own explanation keeps what they skip. A program that `command` finds (`command ls`) is still "run by `command`".

### Strings, braces and options

| Written | Shown now | Shown before |
| --- | --- | --- |
| `sudo sh -c 'printf "%s\n" "$1" > /etc/motd' sh "$msg"` | `$1`: "Positional parameter: argument #1 of the `sh -c` string (it starts as `"$msg"`)" | "Positional parameter: argument #1" |
| `bash -c 'echo "$0 $1 $2"' name a` | `$0`: "`$0` of the `bash -c` string: the name given after it, `name`"; `$2`: "(none is given, so it starts empty)" | `$0`: the name of the script; `$2`: "argument #2" |
| `{1..10..3}`, `{1..10..-3}`, `{10..1..3}`, `{1..10..4}`, `{01..10}`, `{a..k..2}`, `{1..5..0}` | the start, the end and the increment under the braces: "Increment: `-3` … its sign does not count: the start and the end set the direction", "End: `10` (the steps do not land on it: the last word is `9`)", "Start: `01`; it has a leading 0, so every number is padded with zeros to the same width", "0 counts as 1" | the braces alone, with the words they make |
| `docker run -it`, `docker exec -it`, `screen -dmS name`, `usermod -aG docker alice` | "Combined short options `-i` `-t`", each with its own explanation | one option, `-it` "interactive with a TTY", `-dmS`, `-aG` |
| `complete -u -X '!a*' c`, `compgen -P p -S s -W 'a b'`, `compopt -D -o nospace`, `cd -P -e dir`, `ulimit -R`, `declare -I x` | each option: "user names", "remove the candidates that match the given pattern", "text to put before each candidate", "the default completion…", "with `-P`, fail when the new current directory cannot be determined", "a local variable made in a function starts with the value and attributes of the variable of the same name outside it" (every letter of `help -s` for each builtin, in bash 5.2 and 5.3, but those Linux lacks: `ulimit -k`, `-P`, `-T`, `cd -@`) | "Option (not in the dictionary…)" |
| `cd -@ x`, `ulimit -k`, `declare -Z x`, `kill -Z 1`, `pushd -Z` | an option a builtin does not have: "An option bash's `cd` does not have: bash says `invalid option`, and `cd` fails with status 2, doing nothing (`help cd` lists its options)"; `kill`: "bash reads it as the name of a signal, and there is none: it says `invalid signal specification`…"; `pushd`, `popd`, `dirs`: "… a place in the stack (`-N`), and this is no number: it says `invalid number`…". `true -x` and `: -x` take no options: plain words | "Option (not in the dictionary; see `man cd`)", which has no page for a builtin; `declare -Z`: "Option" |
| `hash -d a b`, `hash a`, `hash -t a`, `hash -p /bin/ls a` | `-d`: "forget the names given", and each name "name to forget"; `a`: "command to look up in PATH now and remember (bash does not look it up again until `hash -r`)", "name whose remembered path to print", "name that gets the path of `-p`" | `-d` took the next word as its value; the names were "Word `a`" |
| `ulimit -n 1024`, `ulimit 0` | "the new limit: a number in the unit of the resource (most sizes in KiB; `ulimit -a` shows the units), or `unlimited`, `soft` or `hard` (the current soft or hard limit); with no option for a resource, the limit of file size (`-f`)" | "Word `1024`" |
| `alias ll='ls -l'`, `alias ll`, `unalias ll`, `enable -n kill`, `enable -p kill`, `help -d cd`, `caller 0`, `pushd /tmp` | "an alias definition: the name before `=` stands for the text after it", "alias whose definition to print (it fails when there is none)", "alias to remove", "builtin to turn off (a program of that name runs instead)", "ignored: with `-p`, `enable` only lists the builtins", "builtin to show the help of (with a glob pattern, every builtin it matches)", "which call to print …", "directory to push onto the stack and cd to" | "Word `ll`" and the like; `ll='ls -l'` had no text of its own |
| `shopt -s checkwinsize histappend`, `shopt -s compat44`, `set -o nolog` | each of the 47 `shopt` options the dictionary lacked, from the manual (4.3.2): "check the window size after each external command, and update `LINES` and `COLUMNS` (on by default)", "compatibility mode: behave as bash 4.4 did where it differs…"; `nolog`: "ignored (bash accepts it and does nothing)" | "option name (e.g. nullglob, globstar, extglob)"; `nolog`: "Value for `-o`" |
| `xargs -d '\n'` | "each item ends at the given character, and quotes and backslashes are not special (with one other than `\n`, the newline `echo` ends with stays in the last item)" | "the newline `echo` ends with stays in the last item" |
| `tar vf a.tar` | "Old-style options (no dash): `v` `f`", `a.tar` the value of `f` (tar reads a first word without a dash as letters, and then asks for an operation) | "Word `vf`": a word with no operation among its letters was not read as letters |
| `ps u1`, `ps aux1,2` | the letters, and "process IDs (a number after BSD letters is a PID list, the same as `p`)" for the number (`ps u1` is `ps u -p 1`) | "Word `u1`" |
| `ps t1`, `ps p1,2` | "Value for `t`": the number is the value of the last letter, when it takes one | "Word `t1`" |
| `ps u1x` | a plain word: `u1x` is an error in ps | a plain word |
| `ps opid,comm`, `ps Uroot`, `ps aopid,comm`, `ps rUroot`, `ps op1` | a letter that takes a value takes the rest of its word, as in procps: `o` with `pid,comm`, `U` with `root` (`ps Uroot` is `ps U root`, `rUroot` is `r` and `U root`); `ps op1` is `o` with `p1`, which ps rejects as a column | `Uroot` was five letters with `U` taking the next word; `opid,comm` was a plain word |
| `ps q1`, `ps aq1 opid` | `q` is a letter with a value (the quick mode, a PID list), so `q1` is `q` with `1` | `q` was not known: the word was a plain word |
| `ps --User root`, `ps --User=root` | `--User` is the real user, as `-U` | `--User` was not known, so `root` was read as BSD letters (`r`, then `o` with `ot`) |
| `ps --`, `ps -ef --`, `ps aux --`, `ps x --`, `ps -- -ef` | `--`: "Not allowed here: procps ps does not take `--`, and fails (exit status 1)" (it prints "error: garbage option" unless an earlier word fails first); the words after it are still options, and `ps -ef -- \| head` no longer shows the `ps -ef` sample output | "End of options: everything after is a plain argument", the `ps -ef` sample, and `-ef` after it a plain word |
| `unset {a,b}`, `unset a{1..3}`, `unset -f {f,g}` in bash | "The braces expand first: unset the variables `a`, `b`" (one name: "the variable `a`"); the model unsets each word the brace step gives, ranges included; where `set +B` may be on (on some paths before), the label says brace expansion may not take place and the model follows both; `{a,$v}b`: the words are not known | "Unset the variable `{a,b}`"; the model left `a` and `b` set |
| `set +B; unset {a,b}`, `unset -v 1a` in bash; `unset {a,b}` in dash | a name no variable can have: bash unsets nothing ("not a valid identifier", status 1, with `-v`); dash fails with "bad variable name" and exits, and the model ends the script there | "Unset the variable `{a,b}`" |
| `local {a,b}`, `declare {c,d}=1` in bash | "The braces expand first, and `local` takes each word: `a`, `b`"; the model declares each word | "Variable `{a,b}`"; the model declared nothing |
| `a=1; unset -n a` | "`a` is not a name reference, so nothing is unset"; the model keeps `a` (bash 5.2 and 5.3) | "Unset the name reference `a` itself"; the model unset `a` |
| `eval {a,b} "$x"` in a script for dash | "known only when it runs" is said of `"$x"`; `{a,b}` is text there | said of `{a,b}` |
| `set +B; echo {a,b}`, `set +B; {echo,hi}` | no brace expansion token: the word stays as it is, as bash prints it (`{a,b}`); where `set +B` is on some paths only, the token adds "(where brace expansion is on: `set +B` turns it off on some paths before, and there the word stays as it is)" | "Brace expansion: `{a,b}` expands to 2 words"; `{echo,hi}` ran `echo` |
| `printf '%s,'{a..c}` (a brace expansion next to a quoted part) | explained; the example takes the word as not known | the line was not explained (an error inside) |
| `trap {x,EXIT} INT` in a script for dash or sh | the action `{x,EXIT}` is a text there, so it is explained as a script of one command | "It holds an expansion, so its text is known only when it runs" |
| `echo {a,b}`, `echo {1..3}`, `cp a{,.bak}`, `for x in {a,b}` in a script for dash, sh or ash | a plain word, as the shell prints it (`cp a{,.bak}`: one source); no example of words; the line's warning says the shell lacks brace expansion. | "Brace expansion: `{a,b}` expands to 2 words", an example of the words, a source and a destination for `cp` |
| `echo {1..3}` in mksh | a plain word (mksh has no ranges; `{a,b}` expands) | "expands to 3 words" |
| `printf '%s\n' $'a\tb'`, `x=$'q'`, `${y:-$'a\tb'}` in a script for dash | dash has no `$'…'`: a `$` that is text, then a single-quoted string, so the value is `$a\tb` (`$q`), as dash prints it; no tokens for the escapes | "backslash escapes such as `\n` are interpreted. After quote removal it is the string `a⇥b`", and that value in Meaning and the examples |
| the same in a script for sh | the value is not known: dash reads `$a\tb`, bash and busybox ash `a⇥b`; the line's warning says that dash lacks it | the same as bash |
| `env $'--' \| cat` in a script for dash or sh | `$'--'` is the command `env` runs (dash runs `$--`) | "End of options" |
| `find . -name $'*.c' -print`, `$'echo' hi`, `IFS=$'\n'` in a script for dash | "if name matches `$*.c`"; the program `$echo` (in the editor's colours and in Reading too); "split on each of `$`, `\` and `n`" | `*.c`; the builtin `echo`; "split on `\n`" |
| `echo $'it\'s'` in a script for dash or sh | the warning: "`$'…'` strings with `\'` in them is not available in dash. Instead, use `printf` (dash ends the quote at the `\'`, and the `'` after it opens another quoted string up to the next `'` of the script, or a syntax error if there is none)"; the string says where dash's quote ends, with no value | the warning on `$'…'`, and the value `it's` |
| `IFS=$'\n\t'`, `IFS=$' \t\n'` (any shell) | "split on each of newline and tab", "each of space, tab and newline"; the first character "newline" | "split on `\n⇥`", "` ⇥\n`" |
| `set -e`, `set -o errexit` | "exit immediately if a command fails (but not in the condition of `if`, `while` or `until`, in a `&&` or `\|\|` list except its last command, in a pipeline except its last command (unless `pipefail` is on), after `!`, or in a function called from those places)" (manual, 4.3.1); `set +e` and `set +o errexit`: "go on when a command fails (the default)" | "exit immediately if a command fails", with no exception; `set +e`: "turn it off again" |
| `ssh -o ConnectTimeout=5 host` | `-o`: "a config option, as `Name=value` (e.g. `ConnectTimeout=5`)" | "config option (e.g. `StrictHostKeyChecking=no`)" |
| `ssh -o StrictHostKeyChecking=no host`, `=off`, `=accept-new`, `-o UserKnownHostsFile=/dev/null` | "connect without checking host keys: the keys of unknown hosts are added silently, and hosts whose key has changed are connected to (with some restrictions), so a man-in-the-middle goes unnoticed (careful)"; `accept-new` "adds the keys of unknown hosts automatically, but refuses hosts whose key has changed" (as `ssh -G` reads them) | "Value for `-o`" |
| `find / -perm -4000`, `-perm /6000`, `-perm -1000`, `-perm 644` | "permissions include all the bits of 4000 (SUID, set-user-ID)", "(SUID, set-user-ID; SGID, set-group-ID)", "(the sticky bit)", "exactly 644 (owner read, write; group read; others read)" | the number alone |
| `find . -perm +4000` | "GNU find rejects this form with "invalid mode"; any of the bits is `/4000`" | "permissions have at least one of the bits of 4000" |
| `sh -o nounset -c 'f'`, `sh -eo pipefail -c :`, `sh -onounset -c f`, `dash -onounset -c f` | `-o` takes the next word, as dash reads it: `-o nounset`, then `-c`; in `sh -onounset -c f`, `-o` takes `-c` as its value, and dash refuses it (`Illegal option -o -c`, status 2) | `-opipefail` was `-o` with `pipefail`, the POSIX way to write it. `zsh`, `ksh`, `mksh`, `yash` and `ash` are not checked and still read it so |
| `/bin/echo --version`, `/bin/echo --help`, `env echo --version`, `enable -n echo` then `echo --version` or `command echo --version` (also through an alias), `xargs -I{} /bin/echo --version`, `find . -exec /bin/echo --version \;` | `--version`: option, "print the version (plain text if `POSIXLY_CORRECT` is in the environment)"; `--help`: "show the usage (…)". coreutils echo reads them as options when one of them is its only argument (coreutils 9.4: `echo (GNU coreutils) 9.4`) | "text to print" |
| `env -i /bin/echo --version`, `env -u POSIXLY_CORRECT /bin/echo --version`, `unset POSIXLY_CORRECT` then `/bin/echo --version` | option, "print the version": the variable cannot be in the program's environment | "text to print" |
| `POSIXLY_CORRECT=1 /bin/echo --version`, `export POSIXLY_CORRECT=y` then `/bin/echo --version`, `POSIXLY_CORRECT=1 find . -exec /bin/echo --version \;`, `env -i bash -c 'export POSIXLY_CORRECT=1; /bin/echo --version'` | "text to print (`POSIXLY_CORRECT` is in its environment, so `--version` is no option)": bash prints `--version`. What a shell sets is not undone by an `env -i` before it starts | "text to print" |
| `docker run img /bin/echo --version`, `ssh host /bin/echo --version` | option, with "(plain text if `POSIXLY_CORRECT` is in the environment)": the image's `ENV` or the remote shell's startup files may set it, unseen here | "text to print" |
| `/usr/bin/printf --version`, `env printf --help`, `/bin/true --version`, `env false --help` | option: "print the version", "show the usage" (only as the one argument; `POSIXLY_CORRECT` does not change it), and no example of what the format prints | printf: "format string", with the example "Output: `--version`"; true, false: "Word `--version`" |

The positional parameters are those the shell starts with: a `shift` or `set --` in the string changes them later. In a function the string defines, `$1` is the function's argument, as before. After a word whose number of words is known only when it runs (`"$@"`, an unquoted `$x`), the words that follow are not named. Options of several letters that tools document as one stay one: `tcpdump -nn`, `ldapsearch -LLL`, `ip -br`, `nmap -sS`.

The Japanese notes of the dialect checks put a space between code and the words after it, as the other Japanese texts do: 「`local` は POSIX sh にない書き方です」, 「プロセス置換 `<(…)` / `>(…)` は…。代わりに一時ファイルや名前付きパイプを使う。」. Before, they read 「`local`は」 and 「代わりに 一時ファイル」. So do `IFS` in 「クォートしないと `IFS` …」 and perl's 「`$F[2] > 100` なら」.

### `sed -n`, `sed -e` before `-E`, `git log --graph`, and a `case` being typed

| Written | GNU sed, git, bash | Shown now | Shown before |
| --- | --- | --- | --- |
| `sed -n '1p;/x/q' f`, `sed --quiet '/x/q' f` | `q` prints nothing | `q`: "quit (with `-n`, the current line is not printed)" | "print the current line and quit" |
| `sed -n 'n;p' f` | `n` does not print the line it leaves | `n`: "read the next line (with `-n`, the current one is not printed)" | "print the line and read the next one" |
| a sed script whose first two characters are `#n` (`#n`, `#no…`; not `#N`) | runs as with `-n` (GNU sed 4.9) | as with `-n`, in the explanation and the example | as without `-n` |
| `sed -e 's/a+/x/' -E f`, `sed --expression='s/a+/<&>/' --regexp-extended f` | the `-e` script is read when sed reads the option, before `-E`: `a+` is a basic regex, an `a` then a `+` (the script operand of `sed 's/a+/x/' -E f` is read after all the options: extended) | `+` is a literal `+`, in the explanation and the example (`echo aa+ \| sed -e 's/a+/x/' -E` shows `ax`); `-E` says it does not apply to the `-e` (or `-f`) script before it; no example where the scripts are read in different flavours (`sed -e 's/a+/x/' -E -e 's/(b)/\1/'`) | `+`: "repeat `a` one or more times"; the pipeline's example showed `x+` |
| `git log --oneline --graph --format='%h %s'` | `* 3f2a9c1 Fix login timeout` | the example's lines start with `* `; a commit's other lines with `\| ` (two spaces for the last), as git draws one line of history | `3f2a9c1 Fix login timeout` |
| `case` (no word yet) | a syntax error | "case statement: match the value (not written yet) against each pattern…", with no empty part for the value | "match `` against each pattern…", and an empty "Value to match" |

### `sort -h`, `sort -k`, `grep -o` and `sed s///`

GNU `sort -h` reads a size suffix only right after the number, and compares the suffix before the number. The example now does too.

| Written | GNU sort | Shown before |
| --- | --- | --- |
| `sort -h` of `8.3K`, `1.5K` | `1.5K`, `8.3K` | in the order read: the numbers were lost beside the suffix |
| `sort -k5 -h` of `ls -lh` lines (`220 Mar`, `1.5K`) | `220` first | `220 Mar` last, as 220 megabytes |
| `sort -h` of `1m` | `1m` is 1 (only `k` is a suffix in lower case) | 1 megabyte |
| `sort -h` of `5.K` | `5.K` is 5K | 5 |
| `sort -k1.2,1.3` of `ab cd` | the key `b ` (a character position runs on past the end of its field) | `b` |

grep and sed find the longest match where a POSIX regex has several at one place, as GNU grep and sed do: `echo ab | grep -o 'a\|ab'` prints `ab`, and `sed 's/a\|ab/X/'` changes `ab` to `X`. Before, the examples took the first alternative: `a`, and `Xb`.

### The package pages show their own version's README

A README on the Marketplace, Open VSX or npm has relative images and links; the page loads them from GitHub at `HEAD`, the newest commit of `main`, not at the commit of the release. So the page of 0.8.0 showed the images of `main` (the Reading view, which was not released), and one image, `images/inline.png`, was missing because `main` no longer had it.

| Page | Shown before | Shown now |
| --- | --- | --- |
| Marketplace and Open VSX (the same `.vsix`) | images and links at `raw/HEAD/…` and `blob/HEAD/…`; `images/inline.png`, deleted on `main`, was a 404 | `raw/v<version>/…` and `blob/v<version>/…`, in the README and the changelog |
| npm (`cli/README.md`) | the image at `raw.githubusercontent.com/…/main/…`; `LICENSE` and `THIRD_PARTY_NOTICES.md` were relative to `cli/`, where the repository does not have the files | the image and the two links at `…/v<version>/…` (the license and the notices at the repository's root) |
| README.md on GitHub | no word that it follows `main` | a note under the badges that it describes the development version, with links to the released one; the packaged README leaves the note out |

The v0.8.0 page was packaged before this and cannot be changed, so `images/demo.gif`, `hover.gif`, `panel.gif` and `inline.png` are back on `main` at the paths that page loads, and they stay: Open VSX keeps a page for every version, and VS Code's details view of an installed 0.8.0 loads them too. The README now uses `images/readme/`. How it works, and the check that fails when a packaged README has a link that is not at the tag: [docs/publishing.md](../publishing.md#the-readme-of-a-package-page-describes-its-version).

### The hover's notes

VS Code puts the problems at the mouse above our hover. The part now leaves out the notes that those problems already say. They are matched by their code, such as `redirect-by-your-shell`, and by their place, not by their text.

| Written, hovered on | Shown now | Shown before |
| --- | --- | --- |
| `sudo echo "nameserver 1.1.1.1" > /etc/resolv.conf`, on `>` | the problem above, then the part: `> /etc/resolv.conf` and what it does | the problem, and the same pitfall again in the part |
| `rm -rf $DIR/*`, on `$DIR` | the two problems above, then `$DIR` | the two problems, and both pitfalls again |
| the same, with `bashExplainer.diagnostics.enabled` off | `$DIR` with both pitfalls (no problem above) | the same |

The notes that stay (on another word, about the line, a plain fact) start at the hover's left edge, with their icon and word in the level's colour. So do the notes of examples ("Control characters are invisible, so the example shows them as symbols"); the Markdown of the command line and the Language Server keep them as quotes. Before, each one was a quote: VS Code's hover draws no bar for a quote, only the browser's margins, so each note was pushed 40 px to the right.

### Long labels in the panel

In the Meaning view, each row has the part's code (its label) and the explanation beside it. The rule is now the same in VS Code and on the web page, at every width:

| Label | Shown now | Shown before |
| --- | --- | --- |
| short (`grep`, `-rn`, `2>&1`) | on one line, with the explanation right after it | the same |
| long enough to leave less than half of the row (60% on a panel narrower than 520px) for the explanation: `grep … \| sort \| uniq -c \| …`, `"${file%.*} ${file%%.*} …"`, `#!/usr/bin/env -S bash -e` on a phone | on a line of its own, whole; the explanation under it, starting in line with the label | beside the explanation, cut with "…" at 45% of the row; on a panel narrower than 520px, the explanation went under it, but started under the fold mark |
| longer than the row (a long pipeline, a long path) | wrapped at its spaces, and anywhere in a word longer than the row (no hyphen added) | cut with "…" |

Which labels share their row is decided as before on a narrow panel; on a wider one, only long labels (in the sample, the ones that were cut) now go above their explanation. The links to the manual (`§3.8 §3.1.3 execve(2)`) go under the explanation, at the right, where beside it they would take its room. The fold mark stays on the label's first line. Reading is unchanged: its code already wraps in its pill, with the text on a line of its own.

### The web page on a phone: the phone layout and the desktop site

The web page keeps the phone layout on a phone at every zoom: zooming out makes the viewport wider in CSS pixels (50% turns 390px into 780px), so a phone is told by its device (a touch screen without hover whose screen is under 600px on its short side), not by the width. A phone once seen is remembered by the shape of its screen, for a page loaded zoomed out. Tablets and desktops follow the window's width (up to 767px: the phone layout).

When the browser asks for the desktop site (Chrome's **Desktop site**, Safari's **Request Desktop Website**), the page shows the desktop layout, as the browser's own choice: the viewport is about 980px wide and the width decides, as on a desktop; the phone's screens are neither used nor recorded. The page tells the mode from `navigator.userAgentData.mobile` (false in Chrome's desktop mode), or, where a browser has no client hints, from a User-Agent that names no phone (none of "Mobi", "iPhone", "iPod", "iPad", "Android"; Safari's desktop mode sends the Macintosh one). The mode is read at every load (the browsers reload the page when you switch it, and a page restored from the back/forward cache is read again), so switching back gives the phone layout again, also zoomed out. Before, a phone in the desktop-site mode kept the phone layout.

### Control characters in values and examples

A control character shown in a value, a note or the lines of an example was a Unicode control picture (`␊`, `␍`, `␛`, `␡`, `␀`…, and `⇥` for a tab). Those pictures are a block of Unicode that many fonts lack (Consolas, Segoe UI and many Linux monospace fonts), so they were empty boxes. Each output now shows the name of the code instead:

| Where | Shown now | Shown before |
| --- | --- | --- |
| the panel and the web page | a small box with the name (`LF`, `CR`, `ESC`, `TAB`, `DEL`, `SOH`…), in a value's chip, in code, in a note and in an example's lines; a screen reader reads what it stands for ("line feed, newline") | the picture |
| the hover (VS Code and the web page's cards) | the name, small, on the badge background, in a value, a note and an example's note | the picture |
| the lines of an example in the hover (a code block draws no HTML), the command line (text and Markdown), the Language Server hover, Copy as Markdown | `<LF>`, `<TAB>`, `<ESC>`: the form of `<U+202E>`, and no other reading of `\n` | the picture |
| JSON of the command line | the picture, as the analyzer says it | the same |

Example: `s=$'a\nb'; printf '\033[1m%s' OK` says "the string `a<LF>b`" in Markdown, and draws `a`, a box `LF` and `b` in the panel. The note that says what the marks stand for follows the same form: "`<LF>` is LF (line feed, newline)". The tab is `TAB`, not its code `HT`; the note says "`<TAB>` is HT (tab)". `␣` (a space at an end) and `∅` (an empty word) are as they were.

### Keyboard and screen reader access (panel and web page)

A keyboard and screen reader test of the web page found these; the panel's part is VS Code's panel too.

| Where | Now | Before |
| --- | --- | --- |
| Meaning view (panel) | Each row with parts has a fold button (▾/▸) in the Tab order, named "Parts of `grep \| sort`" (「`grep \| sort` の内訳」), with its state in `aria-expanded`; Enter or Space folds and unfolds it. | The glyph was a plain mark: only a click folded the row. |
| Problems list (web page) | Each problem is a button: Tab reaches it, Enter or Space puts the cursor on its line and the focus in the editor. Its icon is named (Warning, Information). | Only a click opened a problem; the list was one stop of Tab. |
| Editor (web page) | Named "Script" (「スクリプト」), and described by how to leave it: "To leave the editor, press Escape, then Tab." The hint also shows for a few seconds at the editor's top right when the focus comes in by the keyboard. | Tab indents in the editor, and nothing said how to get out. |
| Moving the cursor (web page) | A polite live region says the line, its first part and its warnings once the cursor rests on another line: "Line 3: (( count++ )), Arithmetic evaluation (( )); 1 warning". | A screen reader heard nothing of the explanation. |
| `F6` (web page) | Goes from the editor (or anywhere on the page) to the explanation, and back: the Reading view's current item, else the explanation itself. **Go to the explanation and back** in the menu does the same, and shows the key next to `Ctrl+O` and `Ctrl+S`. | None. |
| Hover card (web page) | `Ctrl+K Ctrl+I` worked on the built site; now a screen reader is also told that the card is shown, that the keys again move into it, and that Escape closes it. | The card opened without a word, the focus left in the editor. |
| Example input boxes | Named by their label ("Input: `a.txt` (sample contents)"). | No name. |
| Reading view | Arrow keys and Tab keep the focused item's row below the sticky line and steps. | Going up into a large item left its row above the screen, under the line. |
| Forced colours (Windows High Contrast) | The current step of the Reading view is drawn in the system's highlight, and the editor's cursor line has a frame. | Both lost their only mark, a tint. |
| Links to the manual | Their name says where they go and that they open in a new tab (the web page) or in the browser (VS Code): "§3.2.5.2 Compound Commands (opens in a new tab)". | "§3.2.5.2" only. |

### The fix in four notes is the line's own

The notes of `wrapper-assignment-expanded-first`, `regex-backslash-dropped`, `bracket-close-glued` and `unbraced-element` are rendered from the rewrite they carry (docs/design/oracles.md, 3.2), checked in bash 5.2 and 5.3.

| Note | The fix shown | Before |
|---|---|---|
| `sudo v=1 echo got $v` | `sudo v=… bash -c 'echo got $v'`: the command and its arguments become the string of the script's own shell (`sh -c` in sh, which may be dash: not for `echo -e` or `printf '%q'`, which dash's builtins do not take); a quote in it is escaped (`'\''`). With another expansion in the string (`$HOME`, `$(date)`), the note shows it, but the editor offers no edit: the new shell would expand it, not this one. | `sudo v=… sh -c '… "$v"'` |
| `[[ $x =~ \bfoo ]]` | `re='\bfoo'; [[ $x =~ $re ]]`, the variable before the statement that holds the test (before the whole `if` for an `elif`). The name is `re`, or `re2`, `re3`… when the script uses it. | The same line for every script, with `re`. |
| `[[ $x =~ ^\d+$ ]]`, `[[ $x =~ ^[\s]+$ ]]` | `[[ $x =~ ^[0-9]+$ ]]` (`[^0-9]` for `\D`; with `\s` too, in the variable: `re='a\s[0-9]'`). Inside a bracket expression, `[\s]`, no fix: a backslash there is no operator, even from a variable, so the note says to use `[[:space:]]`. | `re='^\d+$'; [[ $x =~ $re ]]`, which matches `ddd` and not `123` (glibc's regexes have no `\d`), and `re='^[\s]+$'`, which matches `s` and `\`. |
| `[ -f a.txt]` | `a.txt ]`. With the `]` escaped, `[ a = b\]`, no fix: `[ a = b\ ]` still misses its `]`, so the note says to end the test with another `]`. | "`]` needs a space before it". |
| `$a[1]` | `${a[1]}`, also for `$a[@]` and `$m[k]`. | The same. |

The style checks show the fix for the line too, rendered from the rewrite they carry and run in bash 5.2 and 5.3 over the states of each check (docs/design/oracles.md, step 6):

| Note | The fix shown | Before |
|---|---|---|
| `[-f x]`, `[[-f x]]` | `[ -f x ]`, `[[ -f x ]]` (the `]` given its space too). With the `]` escaped, `[-f x\]`, the form `[ -f …`. | `[ -f …`, and `[ [-f …` for `[[-f x]]` |
| `x = 1`, `x =1` | `x=1`. With more than one word after `=` (`x = a b`), the form `x=…`: there is no one value. | `x=…` |
| `{echo a;}`, `{echo a}`, `{echo a }` | `{ echo a;}`, `{ echo a; }`. | `{ echo …; }` |
| `{ echo a; echo b }` | `echo b; }` | `{ …; }` |
| `[ $a < $b ]`, `[ 5>3 ]` | `[ $a \< $b ]`, `[ 5 \> 3 ]`, or `[[ ]]`. Where escaping makes no comparison of three words (`[ $a 2>5 ]`), the form `\>`. | `\<` |
| `[ -f $x]` | `$x ]` (none for an escaped `]`, `"$x"\]`) | "`]` needs a space before it" |
| `[ a && b ]` | `[ a ] && [ b ]` | `[ … ] && [ … ]` |
| `rm -rf ${D%/}/*` | `[ -n "${D%/}" ] \|\| exit 1` before it in a script, `… \|\| return 1` in a function, and `… \|\| return 1 2>/dev/null \|\| exit 1` in a file that may be sourced (no `#!` line), as the note on a failure reported as success ends. | `[ -n "${D%/}" ] \|\| exit 1` everywhere |
| `read x` | `read -r` | The same. |

### Read-only declarations

The note on a declaration that hides the status of its `$( )` told to declare first, then assign. For a read-only name, bash refuses that: `readonly x; x=$(g)` says "x: readonly variable". The note now sets the name first:

| Line | The note suggests |
| --- | --- |
| `readonly z=$(g) w=1` | `z=$(g); readonly z w=1` |
| `local -r a=1 b=$(g) c` | `local a=1 b c; b=$(g); readonly a b c` |
| `declare -ri y=$(g)` | `declare -i y; y=$(g); readonly y` |

`readonly` makes the local read-only, and leaves a global of the same name as it was (bash 5.2 and 5.3). First in a list (`readonly r=$(g) || exit`), `||` would test `readonly`: the note shows the list with the assignment first, `r=$(g) || exit; readonly r`, but carries no rewrite. A name the declaration assigns again moves with it, in order (`local x=$(g) x=1` → `local x; x=$(g); x=1`), also with no rewrite. With a here-document, the assignments go before its body (`local x <<EOF; x=$(g)`).

### A name, or an alias to one, changed by `hash -p` or `enable -n`

A name `hash -p` gave a path is read as that file, as when the path is written out: its options, its regex dialect (`egrep`) and its subcommands. Both read the words after an alias with the spec of the program bash runs for the alias's word, and the alias's text says what runs, as the text of the name itself does ("… replaced by `grep` (`hash -p` on line 3 gave `grep` the path `/opt/frob`)"; "… (`enable -n` on line 2 turned the builtin `echo` off)"). Before, the text said only "replaced by `grep`". Both are read as the name itself would be (`type -P grep` after `hash -p /opt/frob grep` is `/opt/frob`; `type -t echo` after `enable -n echo` is `file`).

| Script (separate lines; an alias after `shopt -s expand_aliases`) | Before | Now |
| --- | --- | --- |
| `alias g=grep`, `hash -p /opt/frob grep`, `g -n x f` | `-n`: "show line numbers" (grep's), with grep's examples | `-n`: "A word passed on to `grep`, the text of the alias" (the file is not in the dictionary) |
| `alias g=grep`, `hash -p /usr/bin/egrep grep`, `g -n x f` | grep's spec | the same (egrep is grep's spec) |
| `enable -n echo`, `alias e=echo`, `e -n hi` | no `basis` on the token (a builtin's spec) | `basis: { kind: 'spec', command: 'echo' }`, as for `echo -n hi` after `enable -n echo` |
| `alias a=b b=grep`, `hash -p /opt/frob grep`, `a -n x f` | two brackets: "(`b` is an alias too, for `grep`) (`hash -p` on line 3 …)" | one: "(`b` is an alias too, for `grep`; `hash -p` on line 3 …)" |
| `hash -p /opt/frob grep`, `grep -n x f` | `-n`: "… see `man grep`" | `-n`: "… see `man /opt/frob`", as for `/opt/frob -n x f` |
| `hash -p /usr/bin/egrep grep`, `echo aa \| grep -o 'a+'` | the pattern is a basic regex (BRE) | an extended regex (ERE), as `egrep` reads it: bash prints `aa` |
| `hash -p /usr/bin/git git`, `git log` | "Subcommand `git log`" | "Subcommand `/usr/bin/git log`", as when the path is written out |

bash uses the paths of `hash -p` only while hashing is on. After `set +h` it searches PATH, and `hash` fails with "hashing disabled" (with `-p`, `-r` or `-d` too), so the table stays as it was; `set -h` brings its paths back (bash 5.2). A relative path (one not starting with `/`) is run from the current directory: bash runs `./tac` for `tac`, and `bin/tac` as it is, when it is there, and fails otherwise ("No such file or directory"), except that a `./tac` that is not there is forgotten and PATH searched. An empty path fails the same way. With `shopt -s checkhash`, or in POSIX mode, bash forgets any path it cannot run and searches PATH (an empty one surely); the explanation says so, also for an absolute path (`/nonexistent/tac`), and gives no example. Its words name no manual ("A word passed to the program `hash -p` on line 1 gave `sort`…"; before, "see `man sort`"). Where the table differs with the path taken (a `hash -p`, `hash -d`, `hash -r` or an assignment to PATH in an `if`), or a `set +h` ran on some paths only, the name says what it may run instead and which lines make the command path cache differ, and gets no example of its program; nor does an alias to it, whose words are read with no one spec. The commands inside its words keep their examples. A function that no call reaches, or a trap's action, may run before or after each later change of the table in its own process: every one is named (one a subshell, a `$( )` or a pipeline stage makes is not, unless the trap or the function was set in that subshell). Before, each of these was read as the program of the path, or as the name's own program for sure.

| Script | Before | Now (bash 5.2 prints) |
| --- | --- | --- |
| `hash -p /usr/bin/tac sort; set +h; printf 'b\na\nc\n' \| sort` | `sort` runs `/usr/bin/tac`; the example prints `c a b` | "Sort lines"; the example prints `a b c` (bash: `a b c`) |
| `set +h; hash -p /usr/bin/tac sort; printf … \| sort` | as above | as above (bash: "hash: hashing disabled", then `a b c`) |
| `hash -p tac sort; printf … \| sort` (or `bin/tac`, run as it is) | `sort` runs `tac`; the example prints `c a b` | "Run `tac` from the current directory (… a path that does not start with `/` is not searched in PATH, but run from the current directory)"; no example (bash: "tac: No such file or directory", or `./tac`'s output) |
| `hash -p ./tac sort; printf … \| sort` | as above | as above, and "one that starts with `./` is forgotten when no file there can run, and PATH searched for `sort`"; no example (bash: `a b c` with no `./tac`) |
| `hash -p '' sort; printf … \| sort` | "Run the external command `sort` (… the path ``)"; the example sorts | "Run nothing (… an empty path: bash fails with "No such file or directory" (status 127))"; no example |
| `hash -p "$p" sort; printf … \| sort` | as above | "Run an external command (`hash -p` on line 1 gave `sort` a path known only when it runs)"; no example |
| `if [ -n "$x" ]; then hash -p /usr/bin/tac sort; fi; printf … \| sort` | "Sort lines"; the example prints `a b c` | "Sort lines (if the `hash -p` on line 1 ran, `sort` runs the path `/usr/bin/tac` instead)"; no example |
| `hash -p /usr/bin/tac sort`, `if [ -n "$x" ]; then hash -d sort; fi` (or `hash -r`, `PATH=…`), `sort` | `sort` runs `/usr/bin/tac` | "Sort lines (the command path cache may differ here (lines 1 and 2), so `sort` may run the path `/usr/bin/tac` instead)"; no example |
| `hash -p /usr/bin/tac sort`, `if [ -n "$x" ]; then hash -p /usr/bin/rev sort; fi`, `sort` | `sort` runs `/usr/bin/rev` | "Run an external command (… so `sort` runs the path `/usr/bin/tac` or the path `/usr/bin/rev`)"; no example |
| `hash -p /usr/bin/tac sort; if [ -n "$x" ]; then set +h; fi; printf … \| sort` | `sort` runs `/usr/bin/tac` | "Sort lines (if hashing is on here, `sort` runs the path `/usr/bin/tac` that `hash -p` on line 1 gave it; `set +h` turns hashing off on some paths)"; no example |
| `shopt -s expand_aliases`, `if [ -n "$x" ]; then hash -p /usr/bin/tac sort; fi`, `alias s=sort`, `printf … \| s` | "replaced by `sort`"; the example prints `a b c` | "replaced by `sort` (if the `hash -p` on line 2 ran, `sort` runs the path `/usr/bin/tac` instead)"; no example |
| `if [ -n "$x" ]; then hash -p /usr/bin/egrep grep; fi`, `echo aa \| grep -o 'a+'` | a BRE example of `a+` | no example (egrep prints `aa`) |
| `hash -p /usr/bin/tac sort`, `[ -n "$x" ] && hash -p /usr/bin/tac sort`, `sort` | "`hash -p` on line 2 gave …" | "`hash -p` on lines 1 and 2 gave `sort` the path `/usr/bin/tac`" |
| `shopt -s checkhash`, `hash -p '' sort`, `printf … \| sort` | "Run nothing"; no example | "Sort lines"; the example prints `a b c` (bash: `a b c`) |
| `hash -p test t`, `t -n x` | `-n x`: a condition, read by `test` | `-n`, `x`: words of `./test`, a program the dictionary does not know |

### The quick fix of `[[ ]]`

For a script run by sh or dash, the fix of a `[[ ]]` writes `[ ]`. It now leaves out what `[ ]` tests otherwise (bash 5.2 and 5.3 against dash):

| `[[ ]]` | What `[ ]` would do | Now |
| --- | --- | --- |
| `[[ $a -eq $b ]]`, `-ne`, `-lt`, `-le`, `-gt`, `-ge` | `[[ ]]` reads the operands as arithmetic: `a=1+1` is 2, `010` is 8 (octal), an empty value is 0. `[ ]` reads decimal integers only (status 2 otherwise, and `010` is 10). | No fix, unless both operands are decimal numbers (`0`, or no leading 0) or `$#`: `[[ $# -gt 0 ]]` → `[ "$#" -gt 0 ]`. |
| `[[ -v x ]]`, `[[ -o errexit ]]`, `-a`, `-R`, `-N` | An error in dash: "unexpected operator" | No fix |
| `[[ -k f ]]`, `-O`, `-G` | Not in POSIX `test` | No fix |
| `[[ $f -nt $g ]]`, `-ot` | True in bash when only the first file exists; false in dash | No fix |
| `[[ -t $fd ]]` | False in bash 5.2 when `$fd` is not a number (an error in bash 5.3); an error in dash | No fix (`[[ -t 1 ]]` → `[ -t 1 ]`) |
| `[[ ! ! $x ]]` | dash reads `[ ! ! -n "" ]` as true | No fix |
| `[[ -n $@ ]]`, `[[ "${a[@]}" == x ]]` | `[[ ]]` joins the words into one; `[ ]` gets them apart (`[: a: unexpected operator`) | No fix |
