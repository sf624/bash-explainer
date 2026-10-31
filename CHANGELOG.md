# Changelog

## Unreleased

Details and examples: [docs/changes/unreleased.md](https://github.com/sf624/bash-explainer/blob/main/docs/changes/unreleased.md).

### New

- `--check --counts <file>` appends the numbers of problems of each level to a file, as `$GITHUB_OUTPUT` reads them.
- Quick fixes for the problems whose fix is mechanical, in VS Code, the Language Server and the web page's editor: a failure reported as success, `source` that searches `$PATH`, a `grep` pattern from a variable, a loop over a glob that matches nothing, `read` without `-r`, `[-f x]` and more. Each applies the code the note shows.

### Changed

- Problems have a third level, Error, for a line that fails every time as written (`[ -f a` without `]`, `x = 1`, a construct the script's shell lacks). `--check` and the GitHub Action fail on every error, and on a warning only with `--strict`. **Compatibility:** errors that were pitfalls now fail without `--strict`; a few warnings now fail only with it, and two caveats newly with it (the details list them).
- Errors look different from warnings in every view: the panel, the hover and the terminal show a red ⓧ icon and "Error:", before the other notes, and the web page's editor and Problems list the red icon. A problem's own text no longer repeats "Error:" after its severity (`file:2:1: error: …`).
- In a `#!/bin/sh` script, `local`, `echo -n`, `read -p` and `set -E`, which dash runs, are now information ("Portability") and fail no check. Before, they failed `--check`.
- `bashExplainer.notes.pitfalls` and `bashExplainer.diagnostics.pitfalls` off no longer hide errors. The Action's `fail-on-warning: 'false'` lets errors pass too, and its new output `errors` counts them; `pitfalls` no longer does.
- The web page wraps long lines between shell words, with ↪ on the rows after the first. Wrapping is on by default; before, it was off, and when on, a line broke anywhere.
- The explanation's line box wraps a long line between shell words, up to three rows (click to see it whole). It follows Wrap long lines on the web page and `editor.wordWrap` in VS Code. Before, a long line scrolled sideways.
- The editor on the web page has its own header: Open, Save, the file name (click it to rename; ● marks unsaved changes) and ⋯. Copy a link says "Copied" on its own button.
- Messages on the web page (Opened, Saved, Downloaded) show in one place above the Problems list, with an icon, and stay while the pointer is on them; a reason or more detail is behind **Why?** or **More**. Loading the sample over your script offers Undo instead of asking first (over an opened file with unsaved changes it asks, as Open does).
- Settings on the web page come in sections, with a search and links to each section. On a wide window they open over the editor, so the explanation they change stays in view.
- The explanation on the web page has its own header: the tabs Explanation and Reference, the view (Meaning | Reading), Collapse and Copy, each with a word. Before, the view switch, Collapse, Copy as Markdown and the quick reference were icons and words in the top bar (on a phone, the view and the copy were in the menu).
- Problems on the web page fold into a strip with their count per level. ‹ › and F8 / Shift+F8 go to the next and previous problem, and the strip shows where you are (Ln 20 · 1/11). The list opens on your first visit, and then stays as you left it.

### Fixed

- The note on `source lib.sh` suggests a path from the script's directory that holds when the file is itself sourced (`"$(dirname "${BASH_SOURCE[0]}")"/lib.sh`). Before, it suggested `$0`, which then names the caller.
- The note on a `grep` pattern from a variable no longer suggests `-F` when grep has other patterns (`grep -e 'a.b' -e "$x"`, `-f pats`): `-F` would read them as plain text too. It now says so, whichever pattern comes first.
- Hover cards on the web page no longer cover the line they explain, and a long card scrolls inside.
- The `~` in the operands of `[`, `test` and `[[ ]]` (`[ -f ~/.bashrc ] && . ~/.bashrc`) and in a command name (`~/bin/foo`) is explained as a tilde expansion, as it is in other arguments. Before, it showed no expansion there.
- A worked example now follows a first stage whose words hold a backslash, such as `printf "%s\n" b a | sort`, as bash reads them. Before, it showed made-up lines.
- Japanese wording on the web page follows the project's style (the settings dialog said 消します where the rest says 削除します).
- `[[ $x == 1 ]]` now says the strings are compared plainly (no wildcard in the pattern), `if` says that the last command before `then` decides, and a `;` before `then` says where the list ends. tar's operands are named by mode (`tar -tf a.tar docs/`: names in the archive). Reading names `[[`, `]]` and each operand of `[[ ]]`.
- Fewer false warnings where bash may run the line fine: an interactive shebang (`#!/bin/bash -i`), the variables sudo sets itself, code read with `source`, a trap's action, and a file with no shebang that `.bashrc` may read; some are now caveats.
- In a script with Windows line ends (CRLF), the lines after a heredoc are explained as code again, and the CRLF error sees their keywords. Before, everything after the heredoc was taken for its text.

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
