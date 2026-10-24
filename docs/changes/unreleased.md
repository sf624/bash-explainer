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
| `time sleep 1` | keyword | Same name, also: a program, usually `/usr/bin/time` (run with `\time` or `command time`) |
| `function time { …; }; time ls` | keyword | Same name, also: the function of this script (run with `\time`); a program, usually `/usr/bin/time` (run with `command time`) |
| `sudo echo hi` | program, run by `sudo` | `sudo` looks the name up, so this is the program, not bash's builtin |
| `echo() { :; }; echo hi` | function | Same name, also: bash's builtin (run with `builtin echo` or `command echo`); a program, usually `/usr/bin/echo` (run with `env echo`) |
| `command time ls` | program, run by `command` | Same name, also: a reserved word, where it starts a command unquoted |
| `builtin ls` | nothing runs, `builtin` finds no builtin named `ls` | Same name, also: a program in PATH (run with `ls`) |
| `sudo cd /tmp` | program, run by `sudo` | `sudo` looks the name up, so bash's builtin does not run, and there is usually no program of this name |
| `alias ll='ls -l'; ll` (no `shopt -s expand_aliases`) | program | Same name, also: an alias, not expanded here (needs `shopt -s expand_aliases`) |
| `command [[ -f x ]]` | nothing runs, `command` finds no command named `[[` (bash says `[[: command not found`) | Same name, also: a reserved word, where it starts a command unquoted |

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

### Panel colours from the editor theme

`bashExplainer.panel.colors` (VS Code only) chooses where the panel's colours come from:

- `classic`, the default: the panel's own six colours, as before.
- `theme`: the colour your theme gives each part in the editor, with your `editor.tokenColorCustomizations` and `editor.semanticTokenColorCustomizations`. A part the theme leaves uncoloured, or colours below 4.5:1 (7:1 in a high contrast theme), keeps the panel's own colour. In Dark Modern, `ll` and `grep` are #DCDCAA as in the editor, and `|` and `2>` are both the plain foreground.
- `themeLike`: the theme's colours, except where the theme gives two kinds of part one colour that the panel keeps apart. Then a part takes the colour of its group (`|` takes the keyword's colour, as in the classic palette), or a new colour that suits the theme, with enough contrast. In Dark Modern, redirects and regexes get a teal of their own, and comments are a little lighter, to reach 4.5:1 on a code block.

The colours follow the theme when it changes. How the theme is read, and how much each choice keeps parts apart, is in [docs/design/theme-colours.md](../design/theme-colours.md).

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
- `local` in a function is no pitfall when `eval` runs it there (`f() { eval 'local x'; }`, `f() { x=$(eval 'local y'); }`, `g() { eval 'local x'; }; eval g`); in a shell that `bash -c` starts, or in a trap's action (`f() { trap 'local x' EXIT; }`: it runs after `f` returns), it still is. Before, `local` in an `eval` string was always said to be outside a function.
- The words of an ssh command that this shell expands before sending them are the ones bash expands: `'a'*`, `"a"*`, `a=~/x`, `x=~`, `<(echo hi)` and `>(cat)` now get the pitfall, and a `*` after `set -f` or `set -o noglob` no longer does.
- A variable read in a `bash -c` string that bash cannot parse (`bash -c 'echo ${y'`) no longer gets the pitfall that it is not exported.

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

`[[ $x == "$q" ]]` already said that a quoted right side is literal text.

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
