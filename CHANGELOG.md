# Changelog

## Unreleased

Details and examples: [docs/changes/unreleased.md](https://github.com/sf624/bash-explainer/blob/main/docs/changes/unreleased.md).

### New

- The pitfalls the explanations point out (`x = 1`, `rm -rf $DIR/*`, `for f in $(ls)`…) are also problems, with a code each, in the Problems panel, `--check`, SARIF and the GitHub Action. Turn them off with `bashExplainer.diagnostics.pitfalls`.
- A pitfall says when a variable is read while it is unset under `set -u`: `set -u; echo "$dir"` stops bash with "dir: unbound variable". It is said only where the variable is unset on every path, at the first read of a statement that bash fails on, and not after a test of the same name (`[[ -v dir ]] || exit 1; echo "$dir"`). In a redirection of a program (`cat < "$f"`) only the command fails, unless `set -e` then stops the script.
- A pitfall says when bash refuses the options of a shebang, so that the script never starts when run directly: `#!/bin/bash -e -u`, `#!/bin/bash -o nounset` and `#!/bin/bash -Oextglob` reach bash as one argument.
- The panel has a **Reading** view of the line: who reads each part, from bash's own reading (command name, arguments, redirections) to what each command and each language inside a word reads.
- A new setting, `bashExplainer.bashVersion` (`--bash-version` on the command line), says which bash scripts are explained for: `5.2` (the default) or `5.3`; the GitHub Action takes it as `bash-version`. With `5.2`, a construct of bash 5.3 is a warning. So by default, a bash script that uses `${ …; }` or `${| …; }` now gets a warning, and `--check` exits 1; set `bashVersion` to `5.3` to explain it as bash 5.3 runs it.

### Changed

- The panel's header in VS Code is a toolbar, like those of VS Code's own views: the line, the shell's dropdown and the Meaning/Reading switch, then icon buttons with tooltips for Collapse all, Copy as Markdown, Quick reference and Settings. Before, the buttons were text links.
- On the web page, the Meaning/Reading switch is in the top bar, or in the menu on a phone.
- The panel's Reading view is drawn as an outline: the code in a pill, its text on a line below, and lines joining each item to its parent. Each reader's part has a light tint that is the same at every depth. Before, nested parts got darker, and some kind names were hard to read on them.
- The quick reference's search box has rounded corners like the panel's other controls, and a focus ring. Before, it was square.
- The web page on a phone opens with the Problems list folded (its header shows the count; tap it to unfold). Before, the sample's nine problems took a third of the editor. Wider screens, and a fold you chose yourself, are unchanged.
- On the web page, changing the file kind loads the new kind's sample when the editor holds a sample or nothing. When it holds your own script, the page asks whether to replace it with the sample (and offers Undo) or keep it. Before, the text always stayed.
- **Compatibility:** `--check` prints the pitfalls but exits as before: their warnings fail it only with the new `--strict` (the Action's `strict: 'true'`). The Action's `warnings` output still counts only what fails the step; the new `pitfalls` output counts the pitfalls.

### Fixed

- The web page keeps the phone layout on a phone at every zoom. Before, zooming out far enough switched it to the desktop layout, with the editor and the explanation side by side.
- The `set` options of a shebang count: `#!/bin/bash -eu` turns on `set -e` and `set -u` for the script.
- bash 5.3's `${ cmd; }` and `${| cmd; }` are explained as bash 5.3 runs them: in the current shell, with no subshell. Before, they were explained as `$( )`. bash 5.2 rejects them ("bad substitution"), which the warning says. In bash 5.3 mode, `${ echo a }` (no `;` before the `}`) is a warning, as bash 5.3 rejects it; `return` in `${ …; }` ends the substitution, and `local` there is no pitfall.
- Fewer wrong pitfalls: `echo ===`, `sed = f` and `export = x` are not taken for `x = 1`, and `rm -rf $DIR/*` is no warning when the script set `DIR` to a path. A path runs that file, not a builtin: `./read x` and a function named `read` no longer get the `read -r` pitfall.
- zsh scripts: an unquoted variable is no longer said to be split and globbed, and `for a in $@` and `{ echo a }` are no longer pitfalls there. Before, the explanation said both that zsh does not split `$a` and that it does.
- The notes for an unquoted path and for `rm -rf $DIR/…` quote only the variable, so a glob, `~` or braces in the word still work (`"$DIR"/*`, `"${DIR:?}"/*`). `rm -rf "$DIR"/*` is now warned about too.
- The warning that an empty variable makes `rm -r` delete from the root no longer fires for forms that are never empty (`${DIR:-/tmp/x}/*`), and for `${DIR%/}` and similar it gives a check line before the command instead of a rewrite that dropped the operator. It also covers `${DIR:-''}`, `${DIR[0]}`, `$@` and `${DIR[@]}`.
- A long pipeline is explained at once. Before, each stage doubled the time: a line of 20 `grep -e x f` stages took about 30 seconds.
- find's expression reads each word as bash passes it, after quote removal: `find . -name 'a'"b"` matches `ab`. Before, the quotes stayed in (`'a'"b"`, or `a'b'c` for `'a'b'c'`), and `find '\-name' x` was read as the test `-name`.

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
