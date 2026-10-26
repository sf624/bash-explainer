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

### Pitfalls as problems

The pitfalls that the explanation of a line points out are now problems too. Each has a code, shown in the Problems panel and in the output of `--check`, and its range is the part of the line it is about (the word `$DIR/*`, the `$(ls)` of a `for`, the whole `x = 1`).

```text
script.sh:2:10: info: Caveat: the output of $(ls …) is split on spaces and newlines, so file names with spaces break. Use a glob, as in for f in *.txt [for-over-ls-output]
script.sh:3:8: warning: Pitfall: if DIR is empty this becomes rm -r /*, deleting from the root. Write "${DIR:?}"/* to stop when it is empty [rm-empty-variable-root]
script.sh:3:8: warning: Pitfall: $DIR/* is not quoted, so a value with spaces or * is split into several arguments or expanded to file names. Write "$DIR"/* [unquoted-variable-as-path]
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
| `nounset-unbound` | `set -u; echo "$dir"` (information when only the command fails: `cat < "$f"`) |
| `shebang-refused` | `#!/bin/bash -e -u` |

Information, for what goes wrong only with some values, and where the damage is limited:

| Code | Example |
| --- | --- |
| `unquoted-variable-as-path` | `cat $f`, `cd $dir`, `chmod +x $f` |
| `for-over-ls-output` | `for f in $(ls)` |
| `for-over-unquoted-args` | `for a in $*` |
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

The note quotes the message of bash, or of dash (`dir: parameter not set`) in a script for dash. For another shell (sh, ksh, zsh…) it says only that reading the variable is an error. It adds "unless `dir` comes from the environment" except where the script removed the variable on every path before: `unset dir`, or `local dir` (`declare dir` in a function) where the function reads its local one. A `declare dir` outside a function keeps a value from the environment. `local -g y=2`, like `declare -g y=2`, sets the global variable, so `"$y"` after it is set (`local -g y` keeps the global value).

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

### What a command name is

In both views of the panel, every command name has a badge after it: keyword, builtin, function, alias or program (a program's badge has a dashed edge). When another command looks the name up, the badge says so: `sudo echo hi` shows `echo` as a program, run by `sudo`. A subcommand (`git commit`) has none: bash does not look it up.

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

Nothing is shown where the value is not sure: a variable the script does not set (it may come from the environment: `$HOME`), one that `read`, `mapfile`, arithmetic, `${x:=…}`, a trap or an `eval` string may set, a loop that changes it, a function called with two values, a branch whose condition is not known, code that never runs, a script that runs `source`, positional parameters, arrays, and strings another shell runs (`bash -c '…'`). Nor is it shown where bash reads the text by the locale (text other than ASCII, beyond a plain copy: `${#e}`, `${e^^}` of `e=é`), after a word of the same command that may fail first (`e=; echo ${e:?} "$e"`), where bash fails (`${x:2:-5}`: "substring expression < 0"), in a script whose `PS4` may assign (`PS4='$((n++))'`, for `bash -x`), or in a function that only uncalled functions call. A part of a longer word (`$x/c`, `a$e`) shows its value only: its words join the text around it (`x='a b'; echo $x/c` gives `a` and `b/c`).

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
| `# bats test_tags=a,,b`, `a b`, `,b` | a warning: bats refuses the list, so none of the tests of the file runs (`not ok 1 bats-gather-tests`) |

A test has its `test_tags` and the `file_tags` in effect, sorted (`$BATS_TEST_TAGS`). Only a line that starts with the comment counts; bats reads it also inside a here-document, where the line is text to bash.

The other form of a test, a function marked with a comment, is explained as a test too:

```bash
countdown() { # @test
  true
}
```

bats takes the function for a test named `countdown` and renames it `test_countdown` (so `countdown` is no longer a function; `-` and other characters in the name are written in hex, as for `@test "…"`). Before, such a function was a plain function with a comment. A line is a test only with parentheses or `function`, a blank before the `{` and nothing after `# @test`.

## Changed

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

## Fixed

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
- Before, both were explained as `$( )`.

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
| `a=1; declare a=5 b=$a`, `local x=$x` | the words are expanded before the builtin runs: `b` is `1`, and the local `x` gets the caller's value | the values that follow from them (the words of `$b`, the value of `$x`) | `b` was `5`, the local `x` empty |

`[[ $x == "$q" ]]` already said that a quoted right side is literal text.

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

Examples:

| Written | bash | Shown now | Shown before |
| --- | --- | --- | --- |
| `[[ $x =~ ^"a."c$ ]]`, `^'a.'c$` | only `a.c` matches: the quoted `.` is literal | matches `a.c`; `a.` and `.c` do not | the regex of `c$` alone: `c` and `abc c` "match" |
| `[[ $x =~ a$y ]]` | depends on `$y` | no example | the example of `a` alone |
| `sort <(printf 'b\na\n')` | sorts the lines `b`, `a` that printf writes to the pipe | "Input: output of `printf 'b\na\n'` (through the pipe `<(printf 'b\na\n')` names)": `b`, `a`; output `a`, `b` | "Input: the files `<(printf 'b\na\n')` names (sample contents)": `banana`, `apple`, … |
| `jq . <(curl -s url)`, `sort <(cmd) <(cmd2)` | the command reads the output of `curl` from a pipe (`/dev/fd/63`) | "Input: sample output of `curl -s url` (through the pipe `<(curl -s url)` names)" | "Input: the files `<(curl -s url)` names (sample contents)" |
| `sort < <(cmd)` | stdin is the pipe | "Input: stdin (sample output of `cmd`, through the pipe `<(cmd)` names)" | "Input: stdin (`<(cmd)`, sample contents)" |

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
| `xargs -d '\n'` | "each item ends at the given character, and quotes and backslashes are not special (with one other than `\n`, the newline `echo` ends with stays in the last item)" | "the newline `echo` ends with stays in the last item" |
| `tar vf a.tar` | "Old-style options (no dash): `v` `f`", `a.tar` the value of `f` (tar reads a first word without a dash as letters, and then asks for an operation) | "Word `vf`": a word with no operation among its letters was not read as letters |
| `ps u1`, `ps aux1,2` | the letters, and "process IDs (a number after BSD letters is a PID list, the same as `p`)" for the number (`ps u1` is `ps u -p 1`) | "Word `u1`" |
| `ps t1`, `ps p1,2` | "Value for `t`": the number is the value of the last letter, when it takes one | "Word `t1`" |
| `ps u1x`, `ps op1` | a plain word: `u1x` is an error in ps, and in `op1` the rest of the word is the value of `o` | a plain word |
| `echo {a,b}`, `echo {1..3}`, `cp a{,.bak}`, `for x in {a,b}` in a script for dash, sh or ash | a plain word, as the shell prints it (`cp a{,.bak}`: one source); no example of words; the line's warning says the shell lacks brace expansion | "Brace expansion: `{a,b}` expands to 2 words", an example of the words, a source and a destination for `cp` |
| `echo {1..3}` in mksh | a plain word (mksh has no ranges; `{a,b}` expands) | "expands to 3 words" |

The positional parameters are those the shell starts with: a `shift` or `set --` in the string changes them later. In a function the string defines, `$1` is the function's argument, as before. After a word whose number of words is known only when it runs (`"$@"`, an unquoted `$x`), the words that follow are not named. Options of several letters that tools document as one stay one: `tcpdump -nn`, `ldapsearch -LLL`, `ip -br`, `nmap -sS`.

### `sed -n`, `git log --graph`, and a `case` being typed

| Written | GNU sed, git, bash | Shown now | Shown before |
| --- | --- | --- | --- |
| `sed -n '1p;/x/q' f`, `sed --quiet '/x/q' f` | `q` prints nothing | `q`: "quit (with `-n`, the current line is not printed)" | "print the current line and quit" |
| `sed -n 'n;p' f` | `n` does not print the line it leaves | `n`: "read the next line (with `-n`, the current one is not printed)" | "print the line and read the next one" |
| a sed script whose first two characters are `#n` (`#n`, `#no…`; not `#N`) | runs as with `-n` (GNU sed 4.9) | as with `-n`, in the explanation and the example | as without `-n` |
| `git log --oneline --graph --format='%h %s'` | `* 3f2a9c1 Fix login timeout` | the example's lines start with `* `; a commit's other lines with `\| ` (two spaces for the last), as git draws one line of history | `3f2a9c1 Fix login timeout` |
| `case` (no word yet) | a syntax error | "case statement: match the value (not written yet) against each pattern…", with no empty part for the value | "match `` against each pattern…", and an empty "Value to match" |

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
