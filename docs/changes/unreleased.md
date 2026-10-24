# Changes since 0.8.0, in detail

The short list is in [CHANGELOG.md](../../CHANGELOG.md#unreleased).

## New

### Pitfalls as problems

The pitfalls that the explanation of a line points out are now problems too. Each has a code, shown in the Problems panel and in the output of `--check`, and its range is the part of the line it is about (the word `$DIR/*`, the `$(ls)` of a `for`, the whole `x = 1`).

```text
script.sh:2:10: warning: Pitfall: the output of $(ls …) is split on spaces and newlines, so file names with spaces break. Use a glob, as in for f in *.txt [for-over-ls-output]
script.sh:3:8: warning: Pitfall: if DIR is empty this becomes rm -r /*, deleting from the root. Write "${DIR:?}"/* to stop when it is empty [rm-empty-variable-root]
script.sh:3:8: info: Pitfall: $DIR/* is not quoted, so a value with spaces or * is split into several arguments or expanded to file names. Write "$DIR"/* [unquoted-variable-as-path]
script.sh:4:1: warning: Pitfall: x =… runs a command named x; it is not an assignment. Write x=… with no spaces around = [assignment-with-spaces]
```

Warnings, for what breaks the script:

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
| `for-over-ls-output` | `for f in $(ls)` |
| `for-over-unquoted-args` | `for a in $*` |
| `redirect-by-your-shell` | `sudo cmd > /etc/x` |
| `nounset-unbound` | `set -u; echo "$dir"` (information when only the command fails: `cat < "$f"`) |
| `shebang-refused` | `#!/bin/bash -e -u` |

Information, for what is frequent and harmless with most values:

| Code | Example |
| --- | --- |
| `unquoted-variable-as-path` | `cp $src /tmp/` |
| `unquoted-variable-in-test` | `[ $a = b ]` |
| `read-without-r` | `read line` |

- They follow the same settings as the other problems: `bashExplainer.diagnostics.ignore` and `# bash-explainer disable=<code>` leave one out. The new `bashExplainer.diagnostics.pitfalls` (default on) leaves all of them out, and so does `bashExplainer.notes.pitfalls` off.
- They follow the script's shell. In zsh, which does not split or glob an unquoted `$var`, `cp $a b` and `for a in $@` have none; `[ -n $x ]` keeps its pitfall, since zsh drops an empty unquoted word too, and says so. A line that zsh syntax leaves unreadable to bash gets none.
- They are found in shell scripts, and in the strings a script runs as scripts (`bash -c 'x = 1'`, `eval '…'`, `trap '…' EXIT`), at their place in the string. The shell code inside other files (Dockerfiles, Makefiles, CI YAML, bats files…) shows them in its explanations, as before, but not yet as problems.
- These are the pitfalls about how a line is written and how its words expand. The others the explanations give (on exit status and `set -e`, `shopt -s extglob`, a variable set in a pipeline, a glob that matches nothing) are not problems yet.
- **Compatibility:** `--check` prints these lines, but its exit status does not change: a warning on a pitfall makes it exit 1 only with the new `--strict`. The GitHub Action has a `strict` input (default `'false'`) for it; with a `package:` pin to a tool without `--strict`, the step fails and says so. Its `warnings` output counts the warnings that fail the step (those on pitfalls only with `strict`), as before; the new `pitfalls` output counts the pitfalls, warnings and notices. The annotations of pitfalls are titled `Bash Explainer (pitfall): <code>`, and `--format github` prints those that fail the check first, since GitHub shows only the first annotations of each kind in a step. SARIF has them as `warning` and `note` results. Before, `--check` reported only what the script's shell lacks and the risks in embedded shell code.

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

The note quotes the message of bash, or of dash (`dir: parameter not set`) in a script for dash. For another shell (sh, ksh, zsh…) it says only that reading the variable is an error. It adds "unless `dir` comes from the environment" except where the script removed the variable on every path before: `unset dir`, or `local dir` (`declare dir` in a function) where the function reads its local one. A `declare dir` outside a function keeps a value from the environment.

It is not said:

- for the forms that test the variable: `${x-w}`, `${x:-w}`, `${x+w}`, `${x=w}`, `${x?w}`, `[[ -v x ]]`, `"${a[@]}"`, `"$@"`, `$*`;
- after a test that reads the same name: in a branch of an `if` or `case`, the body of a loop, or the right side of `&&` or `||`, whose condition reads it (`if [[ -v x ]]; then echo "$x"; fi`, `[ -z "${x:-}" ] || echo "$x"`, `declare -p x >/dev/null && echo "$x"`);
- after a statement before it that tests the name (`-v x`, or `${x-w}`, `${x:-w}`, `${x+w}`, `${x:+w}`, `declare -p x` in a test or a condition) or ends the shell when it is unset (`${x?w}`, `${x:?w}`), in the script or, for a read in a function, anywhere outside the function: such a test is often followed by `exit` or `return` when it fails (`[[ -v x ]] || exit 1`, `if [ -z "${x:-}" ]; then return 1; fi`), and which way the flow goes through it is not followed. So a read after a test that does not stop is not said either, though bash fails there (`[[ -v x ]] && echo "$x"; echo "$x"`);
- for special and positional parameters (`$1`), and for names in capitals, which may come from the environment;
- where the variable is set on some path only (`if …; then x=1; fi`), or in a function called both before and after it is set;
- where the script runs code that cannot be read (`source`, `eval "$s"`, `$cmd`), or arithmetic reads a variable it never sets (`$((n + 1))`: its value may come from the environment), and in a function that may be called from elsewhere (`export -f`, a trap);
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
- **Languages.** A language inside a word, read by its own rules: a regex, a glob, a sed script, a jq filter, a printf format. The command reads it, except the regex on the right of `[[ =~ ]]`, which bash matches itself (POSIX ERE).

The buttons above the tree are its eight steps, each adding one stage: bash's own reading first (1 the line, 2 its lists and pipelines, 3 its commands, 4 their words, 5 what is inside the words: quotes, expansions, the scripts of substitutions), then the other readers (6 the scripts inside, 7 each command's reading of its arguments, 8 the languages). The steps before the one shown keep a light tint, so the row reads as how far the tree is unfolded; a step that adds nothing to the line is dimmed, and the arrow keys and the ◁ ▷ buttons pass it over. The left and right arrows step, Home and End go to either end, and a screen reader hears the step ("Step 4 of 8: words"). The rows a step adds grow from their parent, and those it takes away shrink into it. Where the buttons do not fit (a narrow panel, a phone), they fold into a stepper (◁ 4/8 Words ▾ ▷) whose middle opens the steps as a menu. The controls stay under the line while the tree scrolls. The tree is drawn as an outline: each item has its code in a pill and its text on a line below, and lines join it to its parent. Each reader has its own colour, and a light tint over the part it covers, the same at every depth (in a high-contrast theme, an outline in its colour). The tree folds and moves with the arrow keys, Home, End, Enter and Space, as screen readers expect of a tree; Tab reaches the manual links of the item with the focus. Pointing at a part highlights it in the editor and in the line; a key or a click selects it in the editor and keeps the focus in the tree. In host files (a Makefile, a GitHub Actions workflow), the tree shows the file's own text (`$(CC)`, `${{ github.ref }}`) and says what each placeholder stands for. The panel remembers the view and the step, also after it is closed (on the web page, for your next visit). In a high-contrast theme, the highlights are outlined.

Rows grow from their parent when you unfold them and shrink into it when you fold them (a twisty, a click, the keys, **Collapse all** and **Expand all**), in the Meaning and Reading views, and when a step changes. `bashExplainer.panel.animations: false` turns this off, and so does reduced motion: the system's setting, or VS Code's `workbench.reduceMotion`.

The row you fold or unfold (with its twisty, a click on the row, or the keys) does not move on the screen: not when you click, not while it moves, not at the end. Before, folding a row near the end of the panel pulled the page down, so the row jumped. Near the end, the panel keeps blank room below the content instead, and that room goes as you scroll up, without anything on the screen moving. A step keeps the step buttons and the first row of the tree on the screen in place (the first one the new step still shows); **Collapse all** and **Expand all** keep the first row on the screen that stays. When none on the screen stays (Collapse all far down the page), the row around them that stays comes to the top of the screen, under the line and the controls, so the page never ends up blank. Switching between Meaning and Reading drops the blank room, also with the web page's own switch. This holds with the animations off too. It works the same in VS Code, on the web page and on a phone.

### The bash version

The setting `bashExplainer.bashVersion` says which bash release scripts are explained for: `5.2` (the default, and the release the manual citations follow) or `5.3`. It is on every surface: VS Code, the web page's settings, the command-line tool (`--bash-version 5.3`, `--set bashVersion=5.3`, or the settings file) and the Language Server. A shebang does not tell the release, so the file cannot set it.

A construct of a later release is explained as that release runs it. When the release set lacks it, it is a warning in the Problems panel and a note on the line, with its own code for `diagnostics.ignore`:

```text
script.sh:3:3: warning: ${ …; } (command substitution in the current shell) is bash 5.3 syntax: bash 5.2 reports "bad substitution" and stops there: the rest of the line, and the rest of the if, loop or function around it, do not run (status 1). Under set -e, and in POSIX mode, the shell exits; in a subshell, only the subshell stops. Instead, use $(…) (it runs in a subshell). [funsub]
```

This changes what bash scripts that already use `${ …; }` or `${| …; }` get by default: a warning, and `--check` exits 1. Set `bashVersion` to `5.3` to explain them as bash 5.3 runs them. The GitHub Action takes the release as its `bash-version` input.

The plan, and the list of what else changed in bash 5.3, are in [docs/design/bash-versions.md](../design/bash-versions.md).

### What a command name is

In both views of the panel, every command name has a badge after it: keyword, builtin, function, alias or program (a program's badge has a dashed edge). When another command looks the name up, the badge says so: `sudo echo hi` shows `echo` as a program, run by `sudo`. A subcommand (`git commit`) has none: bash does not look it up.

A name that is also something else gets one muted line, with the code that runs the other meaning:

| Line | Badge | The line under it |
| --- | --- | --- |
| `echo hi` | builtin | Same name, also: a program, usually `/usr/bin/echo` (run with `env echo`) |
| `time sleep 1` | keyword | Same name, also: a program, usually `/usr/bin/time` (run with `command time`, `\time` or `env time`) |
| `sudo echo hi` | program, run by `sudo` | `sudo` looks the name up, so this is the program, not bash's builtin |
| `echo() { :; }; echo hi` | function | Same name, also: bash's builtin (run with `builtin echo` or `command echo`); a program, usually `/usr/bin/echo` (run with `env echo`) |
| `command time ls` | program, run by `command` | Same name, also: a reserved word, where it starts a command unquoted |

The explanations no longer end with "(shell builtin)", and the programs named like builtins say their package: "(from coreutils)" where they said "(the coreutils program)". The hover, Copy as Markdown and the command line's text and Markdown end each such row with the kind instead: " (builtin)", " (program, run by `sudo`)"; the JSON output has a `name` field with the facts. In the Reading view, the badge replaces the kind after "command name" ("command name · builtin" before). An alias is shown as an alias, no longer as a function.

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

## Fixed

### bash 5.3's command substitutions

- `x=${ cmd; }` runs `cmd` in the current shell, not in a subshell, and takes its output (without the trailing newlines). Variables it sets and `cd` stay in effect after it; `local` makes a variable that lasts only inside. `cd` in it is no longer said to change "the subshell of `$( )`".
- `x=${| cmd; }` runs `cmd` in the current shell, and takes the value `cmd` leaves in `REPLY`, trailing newlines and all. `REPLY` is local to it, and the output of `cmd` is printed as usual, not taken.
- As in `$( )`, `set -e` is off inside them (unless `shopt -s inherit_errexit`), and the note now names the form used.
- ksh93 and mksh have `${ cmd; }`, and mksh has `${| cmd; }` too; for the other shells (`sh`, dash, busybox ash, yash, zsh) they are warnings.
- In bash 5.3 mode, a `}` right after a simple command (`${ echo a }`) is a warning (`funsubBrace`): bash reads that `}` as an argument of the command, and reports a syntax error. A `return` in `${ …; }` ends the substitution, and `local` in it is no pitfall.
- Before, both were explained as `$( )`.

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

- `x = 1` is a pitfall only when `x` runs nothing known: not a builtin (`export = x`, `local = x`), a function, an alias, a program the dictionary knows (`echo ==========`, `sed = file`), nor a name a `source`d file may define. Before, all of these were said to be assignments written with spaces.
- `rm -rf $DIR/*` is no warning when the script set `DIR`, on every path to it, to a value with text of its own (`DIR=/opt/app`, `BUILD_DIR="$SCRIPT_DIR/build"`), and nothing else may change it unseen (src/semantics/trust.ts). A value from `$1`, `read`, a branch or a sourced file keeps the warning.
- A command name with a `/` runs that file, never a builtin (3.7.2). `./read x` no longer gets the `read -r` pitfall, nor `./x = 1` the one for `x = 1`, nor `./cd $x` the one for an unquoted path. A function named `read`, or `read` after `enable -n read`, is not the builtin either. A path whose last part is a program the dictionary knows is that program, as its explanation says: `/bin/rm -rf $DIR/*` and `/bin/cp $x y` keep their warnings. `FOO=1 ./x $FOO` now names `./x` in its note. Before, every check read only the last part of the path.

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
