# Changes since 0.9.0, in detail

The short list is in [CHANGELOG.md](../../CHANGELOG.md#unreleased).

## New

### "In short": one sentence for each line

The Meaning view of the panel, in VS Code and on the web page, starts with one sentence that says what the line does, under the label "In short" / 「ひとことで」. Every line with code has one; the Reading view has none.

- A command: what it is and does, the options given, and its redirections: "Runs `sort` (sort lines) using `-u` (output only unique lines), with stdin (fd 0) from `in.txt`, stdout (fd 1) to `out.txt`."
- An assignment: the value the variable gets, with a placeholder for what is known only when the line runs: "Sets `workdir` to the output of `$(mktemp -d)`", "Sets `x` to ‹home directory›`/bin`".
- A list and a pipeline: "Tests the condition in `[ … ]`; if that succeeds, runs `echo` …", "Pipes `foo` into `bar`; its status is that of `bar`" (with pipefail: "the last command that fails, or 0"), and under `set -e`, that a failure before the last command of a list does not stop the script. A pipeline into a loop or a group says where that stage runs: "Pipes `cat` into a `while` loop (lines 1–3); the `while` loop runs in a subshell: repeats line 2 while `read` succeeds" (with `shopt -s lastpipe`: "in the shell itself"). A statement started with `&` is said in the background as a whole.
- A block: its first line says what it does ("Repeats lines 75–79 while `getopts` … succeeds", "Runs line 26 with `$f` set to each file name matching `*.sh`, one at a time"), and the word that ends it says what it ends ("`done` ends the `while` loop of line 28: …"), and what it pipes into (`done | sort`). A `for` loop whose words give none (`for x in $empty`) says its body does not run.
- Shapes with a sentence of their own: strict mode, an EXIT trap, a quiet check that a command is installed, `while read … done < file` ("Reads `input.txt` one line at a time…"), an endless loop, `sort | uniq -c | sort -rn | head -n 3` ("Counts how often each line … occurs and lists the lines from the most frequent, with their counts (the first 3)"), and `echo … >&2` ("prints a message on stderr").

The sentence never repeats a problem of the line: where a problem is about the line's status or `set -e`, the sentence says nothing of them.

### Quick fixes from the notes

A note that suggests code to write in place of the line's (`Fact.rewrite`, `StyleFinding.rewrite`: docs/design/oracles.md, 3.2) offers it as a quick fix of its problem: the light bulb and Ctrl+. in VS Code, `textDocument/codeAction` in the Language Server, and buttons in the tooltip of the web page's editor. The fix makes the edits of the code the note shows, at the place of that problem (`cp $a b; cp $a c`: each `$a` its own); where the note gives two ways, both are offered, the one it recommends first (preferred, for VS Code's Auto Fix). The title is the code, cut at 60 characters: "Add `[ -e "$f" ] || continue`" where the fix only adds code, "Rewrite as `read -r`" where it changes some. The web page's buttons show it as plain text, without the backticks (CodeMirror draws an action's name as text); VS Code and the Language Server keep them, as in their messages. Each rewrite is run in bash 5.2 and 5.3 (test/rewrites*.test.ts).

The problems with quick fixes: `failure-reported-as-success` (`cp a b || echo failed` → `… || { echo failed >&2; exit 1; }`, `return 1` in a function, `return 1 2>/dev/null || exit 1` in a file that may be sourced), `unmatched-glob-runs-once` (`[ -e "$f" ] || continue`, or `shopt -s nullglob`), `source-searches-path`, `pattern-from-variable`, `declaration-masks-status`, `postfix-increment-status`, the three `*-last-test-*` notes, `wrapper-assignment-expanded-first`, `prefix-assignment-expanded-first`, `unbraced-element`, `regex-backslash-dropped`, `bracket-close-glued`, `find-action-refused`, `unquoted-variable-as-path`, `unquoted-variable-in-test`, `for-over-unquoted-args`, `array-joined-in-assignment`, `nounset-unbound`, and the style checks `bracket-no-space`, `assignment-with-spaces`, `brace-no-space`, `brace-close-no-separator`, `rm-empty-variable-root`, `read-without-r`, `redirect-in-bracket`, `bracket-close-in-word` and `and-or-in-bracket`. None in a string another shell reads (`bash -c '…'`), where the code would need quoting, nor in a Dockerfile, a workflow, a Makefile or another host file, whose shell code is extracted from the file.

Two notes carry their code as data for the first time:

- `source lib.sh` (and `. lib.sh`): first a path from the script's directory, `source "$(dirname "${BASH_SOURCE[0]}")"/lib.sh`, which bash sets to the file being read, also when it is sourced or in a function; then `source ./lib.sh`, which reads the file of the current directory, as the search would after `$PATH`. In a `#!/bin/sh` script, `$0` names the script's directory (`. "$(dirname "$0")"/lib.sh`); in an sh file with no shebang, which may be sourced, and in a code block typed into a terminal, only `./lib.sh`. Run in bash with a file of the name in `$PATH`, one in the current directory and one beside the script (in a directory whose name has a space), the script run, run by its path, sourced, and sourced in a function; and in dash.
- `grep "$x" f`: `grep -F "$x" f`. `-F` takes the place of an option that selects another mode, which it would conflict with (`grep -iE "$x"` → `grep -iF "$x"`, `--extended-regexp` → `-F`; `egrep` → `grep -F`). None where a word before the pattern may be an option (`grep $opts "$x"`): the note then says what to do, as before. None where grep has other patterns (`grep -e 'a.b' -e "$x"`, `-f pats`), which `-F` would read as fixed strings too: the note says so (see Fixed). Run in bash with GNU grep: the rewrite matches a value with `.` or `*` as the original matches it escaped.

### Dockerfile HEALTHCHECK and ONBUILD

- `HEALTHCHECK CMD …` is explained as CMD is, in the shell form (with the shell SHELL sets) and in the exec form, after its options (`--interval`, `--timeout`, `--start-period`, `--start-interval`, `--retries`), also over lines continued with `\`. A note says what its exit status means: 0 healthy, 1 unhealthy. `HEALTHCHECK NONE` has no command. Before, a HEALTHCHECK was not explained.
- An instruction after `ONBUILD` (`ONBUILD RUN npm ci`) is explained as the instruction is, with a note that it runs in the build of another image FROM this one. `ONBUILD SHELL` is left out: it sets the shell of that build, not of this one. Before, ONBUILD lines were not explained.

## Changed

### Errors: a third level of problems

A problem is now an error, a warning or information, as VS Code and SARIF have them. An error is a line that fails every time as written; it starts with ⓧ and the word "Error:" / 「エラー:」, whatever kind of note it is. In VS Code its squiggle and its icon in the Problems panel are the editor's error's, and the file's name turns red in the explorer and its tab. The Language Server gives it severity 1, `--check` prints `error:` (red in a terminal), its JSON `"severity": "error"`, SARIF `"level": "error"`, and the GitHub annotations `::error`, first. The panel, the hover and the web page draw it with VS Code's error icon in the error colour (red); the panel, the hover and the terminal put it before the other notes of the line (the Problems lists keep the order of the lines):

- The panel: the icon and "Error:" in red, and a red left border; the copy of the line underlines it in red. A screen reader says "Error" once (the icon has no name of its own where the word says it). With forced colours, an error's border is double and a warning's dashed.
- The hover: `$(error)` and "Error:" in red.
- The web page: a red wavy underline and the error icon in the gutter, ⓧ in red in the Problems list, and the line's summary for a screen reader counts errors first ("Line 6: …; 1 error, 1 warning").
- The colours are ours where the theme's is too faint as text: #d0020f (light), #fd6358 (dark), #f6937e (high contrast), #9b1c0b (high contrast light). A part of a line that cannot be read (`printf "%y"`) takes them too in high contrast, where it had the theme's.

A problem's text no longer repeats the level after its severity: `--check` prints `file:2:1: error: [ has no ] …`, where it printed `error: Error: [ has no ] …`, and so do the annotations, SARIF, JSON, the Problems panels and the web page's Problems list. A pitfall keeps its word (`warning: Pitfall: …`), and the explanations, the hover and Copy as Markdown keep "Error:".

At error now:

- The notes that say a line fails when it runs: `[` without `]` (`[ -f a`), `]` glued to a word (`[ -d /]`), a `test` it cannot read (`[ 1 -eq ]`), `then` or `do` with no `;` or newline before it (`if true then`), `unset` of a read-only variable, `unset -f -v`, an assignment to a read-only variable, what a restricted shell refuses (`bash -r -c 'cd /'`), `exit` with a word that is no number or with two (`exit x`, `exit 1 2`), a `find` whose actions it refuses (`find . -exec rm {}` with no `;`), and an invalid `# bats test_tags=` line. Each is run in bash in test/error-level.test.ts, directly, with `bash file`, sourced in a function and by an interactive shell, and fails every time.
- A construct the script's shell lacks: `[[ ]]` in a `#!/bin/sh` script (dash lacks it), `${ cmd; }` for bash 5.2.
- CRLF line ends, where a CR ends the `#!` line (run as a program, the interpreter's name ends with a CR, and it is not found), a keyword stands before a CR (`then\r`, `fi\r` are no keywords; the `}` of `${HOME}` is no keyword, and runs), or a CR starts a command: a blank line, or a line that ends in `;`, `&&`, `||`, `|` or `&` (`echo a;\r` runs `$'\r'`: command not found). Otherwise a warning, with a text of its own: `bash file`, and a program whose `#!` line ends in LF, run `echo hi\r` and print `hi` with a CR.
- The pitfalls that fail every time as written: the 29 of the plan, and the cases of `nounset-unbound`, `pipeline-subshell-variable` and `redirect-by-your-shell` that fail every time. Each also runs in bash in test/error-level.test.ts:
  - A function or builtin where it does not exist: `docker run img f`, `sudo f`, `ssh host f`, `bash -c f` with no `export -f f`, `env -i bash -c f`, `su - -c f`, `dash -c f` (`function-not-in-container`, `builtin-or-function-as-program`, `function-not-on-remote`, `function-not-in-new-shell-export`, `function-not-in-new-shell-blocked`, `function-not-in-new-shell`, `function-not-imported`).
  - A variable that is always empty where it is read: `ssh host 'echo $x'`, `env -i bash -c 'echo "$x"'`, `bash -c 'echo "$x"'` with `x` not exported (`variable-not-in-remote-shell`, `variable-not-passed-by-wrapper`, `variable-not-exported`); `sudo x=1 bash -c "echo $x"`, `x=1 echo "$x"` (`wrapper-assignment-expanded-first`, `prefix-assignment-expanded-first`); a variable set in a pipeline and read after it, `echo a | read -r v; echo "$v"` (`pipeline-subshell-variable`); an unset variable under `set -u` (`nounset-unbound`).
  - What a script cannot run: `local` outside a function, an alias defined in the script, a distribution's alias such as `ll`, an extended glob in the block that turns `extglob` on, after `shopt -u extglob` or in a new shell (`bash -c 'echo !(x)'`), `**` in sh, a function named like a special builtin in POSIX mode (`local-outside-function`, `alias-not-expanded-in-script`, `distro-alias-in-script`, `extglob-in-same-block`, `extglob-turned-off`, `extglob-not-in-new-shell`, `globstar-unsupported`, `posix-special-function-name`).
  - `sudo cmd > /etc/x.conf`, which your own shell opens (`redirect-by-your-shell`); a shebang Linux passes as one word that bash refuses (`#!/bin/bash -e -u`, `shebang-refused`) or one after a byte order mark (`shebang-bom`); `\d` in a `[[ =~ ]]` regex (`regex-backslash-dropped`); a Python string run with no shell (`python-string-without-shell`, and the problem `pythonNoShell`).
  - In bats files: code before a test's name on its line, `! cmd` that never fails the test, `run` in a pipeline, `setup_suite` in a test file (`bats-test-line-dropped`, `bats-negation-ignored`, `bats-run-in-pipeline-stage`, `bats-run-in-pipeline`, `bats-setup-suite-in-test-file`).

  Where the line may still work, they stay caveats, as before: a file with no shebang that a function or `.bashrc` may read, `bash -i -c`, a trap's action, after code the explainer does not read (`source`, `eval "$x"`), and a name the environment may give. Such a name in lower case stays a warning, with a clause (`x=1; bash -c 'echo "$x"'`); under `set -u`, a name the environment may give is a warning where the shell stops (`set -u; echo "$HOST"`; before, a caveat in capitals), and a caveat where only the command fails (`set -u; cat < "$F"`). Two warnings become caveats: `pipeline-subshell-variable` where only some paths before it turn `lastpipe` on, and `redirect-by-your-shell` where the explainer does not know the file (`sudo cmd > "/etc/$f"`) or it is read (`sudo cmd < /etc/x`), which fails only when the file is root's. And `set -u; unset f; cat < "$f"`, which fails the command every time, was a caveat. The notes on `((i++))` and `((i--))` under `set -e` stay warnings: the explainer cannot yet tell that the value is 0 on every path.
- The style checks that fail every time as written: `[-f x]` and `[[-f x]]` (a command name), `x = 1` and `x =1` (a command `x`), `{echo` (a command name), `{ echo }` (the group never closes), `[ a > b ]` (a redirection: no comparison is made, and a file `b` is written), `[ a && b ]` (`[` loses its `]`), and `[ -d "$d/"]` (`]` glued to a word that is never empty: `missing ']'`). Each runs in bash in test/error-level.test.ts, as the others. Where the word before `]` may be empty (`[ -n "$x"]`), the note stays a warning: with an empty value the word is `]` alone, and another test runs, which is wrongly true for `-n` but true as meant for `[ -z "$x"]`. With `bashExplainer.notes.pitfalls` off, these errors are said too.
- Two caveats are now warnings (⚠ "Pitfall:", was ⓘ "Caveat:"), and fail `--check` with `--strict`: `cmd || echo failed` where its status matters, at the end of a function or a script, or under `set -e` (`failure-reported-as-success`), since the failure becomes a status of 0 that cron or CI takes for success; and `source lib.sh` with no `/` (`source-searches-path`), since a file of that name in a directory of `$PATH` runs instead.

In a `#!/bin/sh` script, a construct that is not POSIX but that dash and busybox ash run (`local`, `echo -n`, `read -p`, `set -E`) is now information: "ⓘ Portability: `local` is not POSIX sh (dash and busybox ash accept it, but POSIX does not have it)". It fails no check, even with `--strict`. Before, it was a warning and failed `--check`. One that dash or busybox ash lacks (`[[ ]]`, arrays, `${x^^}`) is an error.

The two notes that started with their own "Syntax error:" lose it, since the word now says "Error:": `if true then` says "ⓧ Error: A `;` or a newline is needed before `then`…", and a `}` that does not end `${ …; }` says "ⓧ Error: This `}` is one more argument…". The token of that `}` still says "Syntax error (bash 5.3):".

What fails `--check` and the GitHub Action:

| Problem | Before | Now |
| --- | --- | --- |
| An error | failed (a construct the shell lacks, CRLF), or only with `--strict` (the notes above, which counted as pitfalls) | fails |
| A warning | failed, unless it was a pitfall (then only with `--strict`) | fails only with `--strict` |
| Information | never failed | never fails |

So `[ -f a`, `unset` of a read-only variable, `bash -c f` of a function not exported and the others above now fail without `--strict`. A Python call that runs a string with no shell (`pythonNoShell`) fails as before. And a few warnings that are no pitfall no longer fail without it: a GitHub Actions expression in `run:` (`injection`), a Python string run by a shell (`pythonInjection`), and CRLF line ends with no CR on the `#!` line, no keyword before a CR and no CR where a command starts. The Action's `strict: 'true'` (`--strict`) keeps failing on them.

- `bashExplainer.notes.pitfalls` off no longer hides an error, and `bashExplainer.diagnostics.pitfalls` off leaves the errors of the explanations in the Problems panel: an error is a bug, not advice. Before, `diagnostics.pitfalls` off left out the notes that said a line fails.
- The GitHub Action's `fail-on-warning: 'false'` lets errors pass too. Its new output `errors` counts them; `warnings` counts what fails the step (the errors, and with `strict` the warnings), and `pitfalls` no longer counts errors. The counts come from the command-line tool's new `--counts <file>`, which appends `errors=`, `warnings=`, `infos=`, `pitfalls=` and `failing=` lines (there `warnings` counts the problems at warning level, and `failing` what the Action's `warnings` counts); with an older tool (a `package:` pin), the Action counts its annotations as before, and `errors` is 0.
- SARIF has `error` results. GitHub's code scanning fails its "Code scanning results" check on a new `error` alert by default; it blocks merging where a ruleset or branch protection requires that check.

### Long lines on the web page wrap between shell words

The editor of the web page wraps a long line only between the words bash reads: a word keeps its quotes, `$( )`, `${ }`, `<( )` and backquotes on one row. In `grep -rn "ERROR $USER" ./src 2>&1 | sort -u > errors.txt && echo "done: $(date +%F)" || exit 1`, a row ends before `"done: $(date +%F)"`, never inside it. The rows after the first are indented by the line's own indentation and two more columns, and the gutter marks each of them with ↪. A word wider than a row breaks at its own blanks, and only as a last resort anywhere, so nothing scrolls sideways.

The words come from the syntax tree the explanations use. A line the parser cannot read, a comment, a here-document's text and the lines of a Dockerfile, a workflow or a Makefile that are not shell break at their blanks.

The setting **Wrap long lines** (`editor.wrap`) is now on by default. Before, it was off, and when on, a line broke wherever the browser chose: after the `-` of `sort -u`, at a slash of a path, or at the blank inside `$(date +%F)`. Turn it off to have long lines scroll sideways, as before.

### The explanation's line box wraps between shell words

The line box at the top of the explanation (the line the cursor is on, coloured by its parts) wraps a long line where the editor does: only between the words bash reads, with ↪ on the rows after the first. A word wider than the box breaks at its own blanks, and only as a last resort anywhere. A line of more than three rows shows three, the third fading out; a click, or Enter or Space when the box has the focus, opens it whole, and a click beside its parts (a blank, the margin) folds it again. A click on a part still selects it in the editor. A new line starts folded.

It follows the editor: on the web page, the setting **Wrap long lines** (`editor.wrap`, on by default); in VS Code, `editor.wordWrap` for the file (`off` keeps one row; `on`, `wordWrapColumn` and `bounded` wrap). VS Code has no new setting. Before, the line box was always one row, and a long line scrolled sideways in it.
### The web page: the editor's header and the app bar

- The editor has a header of its own: **Open** and **Save** (with their words when the editor's pane is 481 px wide or more, as icons below), the script's name, and **⋯** with Rename…, Copy the script, Load the sample and Clear the editor. Before, the name of a file opened or saved was in the top bar, and only there once it had one; the sample button was an icon in the top bar.
- The name shows from the start: `untitled.sh` (or the kind's own name, such as `Dockerfile`), muted until the script is saved or opened. A first save suggests it. Before, a first save suggested `script.sh`.
- ● after the name marks a file with changes not saved, in its text or in its name. Save has no dot, in the header or in the menu. An undo back to the saved text, or a rename back to the file's own name, clears it.
- Every place that names the script says the same name: Copy as Markdown and the explanation's file name said `script.sh` while the header said `untitled.sh`.
- A name is at most 255 characters; `.` and `..` are refused. Enter that confirms a conversion of an input method (Japanese, for one) no longer ends the rename. A rename to `test.bats`, `Makefile` or `x.py` changes the file type, as opening a file of that name does.
- When the browser refuses to copy (Safari can, for a link), the toast says so.
- A click on the name, or ⋯ › Rename…, turns it into a field: Enter or a click elsewhere renames, Escape keeps the old name. A name ending in `.zsh` explains the script as zsh, as a file of that name does. The menu's first row is the name too, and renames the same way.
- Copy a link is a button with words in the top bar. After a copy it reads "✓ Copied" for about 2 s, and a screen reader hears "Link copied"; its tooltip says that the script is in the part after `#`, which browsers do not send to the server. Before, a toast said all of it. Under 900 px it showed its icon only until the file type and the view left the top bar; it now has its words at every width beside the editor.
- Install for VS Code shows from 1100 px (before, from 901 px).
- Clear the editor empties it, and the toast offers Undo. An empty editor shows Paste a script, Open a file… and Load the sample, and that a file can be dropped there.
- On a first visit, a row over the sample says "This is a sample: put the cursor on any line.", with Use my own script and Open a file…. It stays closed once closed or used.
- The menu is in groups: Script; Share (on a narrow page, where the top bar has no room for it); Preferences; Help, with the keyboard shortcuts (not on a touch screen); About. Its title is "Bash Explainer".
- A button that gets the focus back after a dialog or a menu closed with the mouse no longer shows a focus ring; after a key it does.

### Messages on the web page: one place, one look

Every message of the web page (a toast) now shows in one place: above the Problems list, inside the editor's pane, so it never covers the explanation or the panel's header. While it shows, the editor keeps the line of the cursor above it. Each has an icon: ↶ when it can be undone (Sample loaded, Detected: Dockerfile), ✓ when something is done (Opened a.sh., Saved a.sh., Link copied.), a dot for a refusal or a note ("a.sh was not opened.", "Opened a.sh. It mixes line ends.").

A message stays 4 seconds, or 8 with a button, and as long as the pointer is on it or the keyboard's focus in it (F6 goes there after the explanation); it goes 2 seconds or more after both leave. Escape closes it and puts the focus back in the editor. Its reason or detail is behind **Why?** or **More** ("a.sh was not opened. Why? It is not a text file in UTF-8."). Before, a message showed at the bottom middle of the window, over the explanation on a wide window, for 6 seconds, with its whole text.

**Load the sample** over your own script replaces it at once and offers Undo, which brings back the text and its file. Over a file you opened and changed since, it asks first, as Open does ("Discard unsaved changes?", Discard and load or Cancel): the Undo goes with the next keystroke, and Ctrl+Z would bring back the text but not the file. Before, the browser asked first.

### Settings on the web page, in sections

The settings come in sections: **Common** first (Language, Theme, Notes on idioms, Pitfalls, Worked examples, Hover, Animations in the panel and Wrap long lines), then **Examples**, **Checks**, **Editor** and **Data** (export and import, and Clear stored data). The sections after Common are folded; a click on a section's heading, or on its link in the row "Jump to: Common · Examples · Checks · Editor · Data" at the top, unfolds it and brings it to the top. A search finds a setting by its title ("version") or its key (`bashExplainer.hints`, `diagnostics.ignore`), and says when nothing matches; Esc clears it. Before, every setting was listed in one long page, under the groups Display, Checks, Files and Dictionary, with the export and import at the top.

Each description shows at most two lines, with "More" right after the last word shown; on a touch screen it shows whole. A value of a list shows its words ("Right under the part they illustrate, …"), and the VS Code names (`bashExplainer.examples.placement`, `first — …`) show only with **Show VS Code setting names**, at the end of the settings; a setting named in a description is then its key, and otherwise its title. The theme is in Common too: the same choice as the menu's. On a touch screen, the Hover setting is left out (the cards show only with a mouse), and every row and control is at least 44 px high.

Side by side, the settings open from the left, over the editor, and are never wider than the editor's pane: the explanation stays in view, and a change shows in it at once, and you can scroll the explanation and click in it while the settings are open (a click there leaves them open; Esc, × and Close shut them). Before, they opened from the right, over the explanation they change. In the narrow layout (a phone, or a window up to 767 px wide) they take the whole screen, as before, and a change shows in the explanation when they close.

The settings come back as they were left, for as long as the page is open: the sections unfolded, the search and the place they were scrolled to. Before, they opened at the top every time.

### The file type and the shell on the web page

One button in the editor's header, before ⋯, shows the file type and the shell: "Shell script · bash (auto)" (「シェルスクリプト · bash（自動）」). "(auto)" means that the shell is read from the script: a ShellCheck directive, the `#!` line, the file name, or bash by default. A shell you chose shows without it ("Shell script · zsh"). Before, the file type was a picker in the top bar (in the menu on a phone), and the shell a select in the top bar from 1200 px wide, else in the menu.

- A click opens one popover with two lists, **File type** and **Shell**, and **yq** under Shell when the cursor's line runs yq. The Shell list starts with "Auto: bash (from #!)" (or "(from the file name)", "(from a ShellCheck directive)", "(default)"). On a phone, and in the narrow layout, it is a sheet from the bottom with 44 px rows and **Done**; a tap beside it or the back gesture closes it.
- The checked file type has the focus when it opens. The arrow keys, Home and End move in a list without choosing; Enter, Space or a click chooses; Tab goes to the other list; Escape closes it, and the focus goes back to the button. A choice keeps it open, and the explanation follows at once; a file type over your own script asks first, as before.
- Where the header has less room, the button gets shorter, step by step: without "(auto)", then "Script · bash", then Open and Save as icons, then "bash" alone, and last the file name leaves the header (it stays the menu's first row). The name keeps about a dozen characters before the button gives way. Before, Open and Save became icons at a fixed width of the editor's pane (481 px).
- The menu's Script group has **File type and shell…**, with the current choice under it; it opens the same lists.
- Settings › Checks › Shell says what Auto reads now: "Auto (now: bash, from #!)" (「自動（今: bash、#! 行から）」). Before, it said how Auto decides ("Auto: Detect from the shebang (#!/bin/sh…), a # shellcheck shell= directive or the file name; bash when unknown"), not what it found.
- In a file with shell code (a Dockerfile, a Makefile, a CI workflow, package.json, Markdown, Python, a Jenkinsfile, a bats file), Auto names the shell the file runs the cursor's part in: "Dockerfile · POSIX sh (auto)", "Auto: POSIX sh (from the file type)", and a step's `shell:`, a Makefile's `SHELL =` or a Markdown block's language where they set it. On a line in no part, when the parts differ, it names none ("Markdown · auto", "Auto: set by each part (from the file type)"). Docker's exec form (`CMD ["npm", "start"]`) and a Python list of arguments run with no shell, and Auto says so: "Dockerfile · no shell", "Auto: no shell (runs directly)" (「シェルなし」「自動: シェルなし（直接実行）」). VS Code's panel says the same in its shell list ("Auto (POSIX sh)"); before, it said "Auto" there.

### The explanation's header on the web page

The explanation has a header of its own, above it, as wide as it: the tabs **Explanation** and **Reference** (the quick reference), the view (**Meaning** | **Reading**), **Collapse** and **Copy**. Before, the view switch and the icons of Collapse all, Copy as Markdown and the quick reference were in the top bar, and on a phone the view and Copy as Markdown were in the menu.

- Collapse and Copy show a word beside their icon; where the explanation is narrow, the word goes under the icon, smaller. Their full names ("Collapse all", "Expand all", "Copy as Markdown") are the tooltip and what a screen reader says.
- The view is two segments where they fit; where they do not, one button that opens them as a menu ("Meaning ⌄"; a screen reader hears "View: Meaning"). Escape closes the menu, and the focus goes back to its button. On a phone the button is a 44 px pill. Where nothing else fits, the Reference tab reads "Ref".
- Nothing in the header moves when you press a view, fold everything or choose a tab: each word is as wide as the longest it can become. On the Reference tab, the view and Collapse keep their room, unseen.
- The tabs are one stop of Tab; the arrow keys move between them. A click on Reference puts the cursor in its search field, as before; the arrow keys leave the focus on the tab.
- In VS Code, the panel's view switch becomes the same menu when the panel is too narrow for it beside the buttons. Its fold button now says "Expand all" as soon as one row is folded. Before, it said so only after Collapse all.

### The Problems strip on the web page

The Problems list under the editor folds into a strip: "› Problems ⓧ 1 ⚠ 5 ⓘ 6", the count of each level with its mark in its colour (a level with no problem is not shown), and "No problems" when there are none. A click opens or folds the list. A screen reader hears the counts in words: "Problems: 1 error, 5 warnings, 6 caveats". Before, the header said "PROBLEMS 12", one count for every level, and disappeared with the last problem.

At the right, the strip says which problem the cursor is at, "Ln 20 · 1/11" (the problem it is in, or the first of its line), with ‹ and › to go to the previous and next one. F8 and Shift+F8 do the same, from the editor or the explanation, and go round from the last problem to the first; right after an edit they go where the problems are now. While an input method composes, F6 and F8 are left to it. Help lists the keys.

The list is open on a first visit (folded on a phone, as before), and stays as you leave it: the page never opens it on its own. Its problems are in the order of the script (before, grouped by kind). Each row has the line in a column of its own, the message on up to two lines, and the rule from a 520 px pane; the tooltip has the line, the whole message and the rule ("Ln 95: Pitfall: if BUILD_DIR is empty … (rm-empty-variable-root)").

The screen reader's summary of a line now counts its caveats too ("Line 3: …; 1 warning, 1 caveat"), from the same table as the strip. Before, it counted errors and warnings only.

### Examples of a whole pipeline and of globs

A pipeline whose words read a variable the script leaves to the environment now has its example of the whole pipeline. It runs with the value the examples' made-up system gives that variable, the same as `env`'s made-up output: `$USER` and `$LOGNAME` are `alice`, `$HOME` is `/home/alice`, `$SHELL` is `/bin/bash`. The example says so under its title: "Here `$USER` is `alice`: an example value (the real one is known only when the line runs)". Before, `grep -h "$USER" /var/log/*.log | sort | uniq -c | sort -rn | head -5` had no such example, only one for each command after grep. The value stays in the example: the rows still say "Current user name", and what the program receives still shows ‹current user name›.

- There is no example value where the script sets the variable before the line (`read -r USER`, a function it calls), after a `source` or an `eval` the explanation does not read, in a string another shell runs (`bash -c '…'`), in an sh script, for a variable bash changes (`$RANDOM`) or `cd` changed (`$PWD`), with an operator (`${USER:-x}`), or where word splitting may change it (`IFS=a; echo $USER | cat`). A value the script gives (`x=foo; grep "$x" | sort`) runs as it is, with no note.
- Where grep reads the value as a regular expression, which matches inside longer text too (no `-F`, `-w` or `-x`: the caveat on a pattern from a variable), the sample input has a line with the value inside a longer word: `malice` for `alice`, which grep keeps.
- The examples of a glob, a brace expansion or a parameter expansion in a stage now stay beside the example of the whole pipeline: `cat *.log | sort` shows the names `*.log` matches, and what the pipeline makes of the files' lines; `echo "${x%%.*}" | cat` keeps the values `${x%%.*}` gives. Before, the pipeline's example took their place.
- In the made-up output of `ps aux | grep "$USER"`, grep's own row shows `grep alice`, as ps would. Before, that row was missing.

A glob example says why each name it tries does not match, a section for each reason. The names typed in the panel's box get them too.

- A leading `.` while `dotglob` is off: "Not matching: a leading `.` (`dotglob` is off)" (`.app.log` for `*.log`).
- `**` without `globstar`: "`**` is `*` (`globstar` is off)" (`src/lib/a.ts` for `**/*.ts`).
- A `/` that `*` and `?` do not match (`src/lib/a.ts` for `src/*.ts`; `.config/sub/a.conf` for `.config/*.conf`, whose dot the pattern spells).
- Another ending or start: "it does not end in `.log`" (`app.txt`), "it does not start with `/var/log/`".
- A name a pattern of `GLOBIGNORE` leaves out says so; a name with none of these reasons is just "Not matching".

Each reason is checked in bash, with `dotglob` and `globstar` off and on: the name does not match, and matches once the reason is lifted (the option on, `[[ == ]]` for a `/`, the name's end or start replaced).

### The explanation as a sheet on a phone

On a phone, and on a touch screen without a mouse held upright up to 1024 px wide (a tablet), the explanation is a sheet over the editor, at three heights: folded (its tabs row alone), half (at first) and full (up to the strip above the editor; the app bar slides away, and comes back below full). Before, the screen was split in two halves with a divider between, and a tablet showed the page as a desktop does. Turned to landscape, a tablet wider than 1024 px, or a phone whose browser asks for the desktop site, keep the page of their width.

- The sheet's header is one row at every height: the tabs **Explanation** with the cursor's line ("Ln 8"), **Problems** with its count per level ("ⓧ2 ⚠4 ⓘ6"; a screen reader hears "Problems: 2 errors, 4 warnings, 6 caveats"; ✓ when there are none) and **Reference**, then the view as a pill. Where the row is short, Reference reads "Ref", then the line goes, then Problems shows its highest level only. On a tablet the row also has Collapse and Copy. On a phone it has no room for them: Collapse is not offered (the explanation's rows fold one by one), and Copy as Markdown is in the menu's Share group. The row's controls keep clear of the screen's edges, where a swipe opens the menu or the settings.
- The whole header moves the sheet: drag it, and it settles on the height nearest to where you let go, or on the next one when you flick it. A tap on the header, or on the tab already chosen, goes folded → half → full → folded; another tab on a folded sheet opens it. With the keyboard, the bar (a slider, before the tabs) takes ↑ ↓, Home, End and Enter, and a screen reader says the new height. The first time the sheet is full, a line under its header says how to change the height.
- Problems is a tab of the sheet, with the list that was under the editor; a problem chosen there shows its line above the sheet and its explanation at half height.
- Messages show just above the sheet's tabs row. The editor ends at the sheet's top (at half or lower), and the line of the cursor stays in view as the sheet moves.
- With reduced motion, the sheet and the app bar move at once. A drag of the sheet never pulls the page to reload it.
- **Read** | **Edit** in the strip above the editor, on a touch screen, replace the keyboard button of the top bar: in Read, a tap on a line places the cursor without the on-screen keyboard. The first-run tip points at Read. The strip has Read | Edit, the file name, the chip and ⋯, each 44 px; Open and Save are in the menu.

## Fixed

### `-F` and the other patterns of grep

The note on a grep pattern that is only a variable said to add `-F` also where grep had other patterns, which `-F` reads as fixed strings too: `grep -E -e "$x" -e 'foo|bar' f` with `-F` no longer matches `foo` lines, and `grep -f pats -e "$x"` reads the lines of `pats` as text. It now says that `-F` applies to every pattern, and offers no quick fix. It spoke of the variable only when it was the first pattern (`grep -e "$x" -e 'a.b'`, not `grep -e 'a.b' -e "$x"`); it does in either order now. Checked with GNU grep (test/rewrites-advice.test.ts).

### Code that holds a backtick, in the panel

The panel reads a code span as Markdown does: a run of backticks up to the next run of as many. Code that holds a backtick, written with two (`` `date` ``, ``x='a`b'``), is one piece of code. Before, the panel cut it at each backtick and showed the rest as text.

### Hover cards on the web page stay off the line

A hover card on the web page now sits under the whole line it explains, or above it when there is no room under it, at the part's place; it never covers a row of the line, also when the line wraps. A line too tall for any room above or below it (a long one-liner in a low window) is the exception: its card goes by the row under the pointer, as before. A word with a problem gets the same place, with the problem above the card in the same box. Moving the pointer from a word to its card, across the line's later rows, keeps the card. The card of `Ctrl+K Ctrl+I` stays while the editor scrolls, and moves to the other side of the line when its side has no room left. A card is at most half the window high (and at most 420 px); a longer card scrolls inside, with the pointer, and with the keyboard after `Ctrl+K Ctrl+I` twice. Before, a card sat above the word and could cover the line's earlier rows.

### Japanese wording on the web page

A new check reads the Japanese in `web/` (the strings of `web/*.ts` and the text of `web/index.html`) against [docs/japanese-style.md](../japanese-style.md), as it already read `src/`. It found one string: the settings dialog's explanation of "Clear stored data" said 消します; it says 削除します now.

### What bash and tar do, in a few explanations

Fixes found by the panel's prototype (step P2 of [docs/design/panel-redesign.md](../design/panel-redesign.md)):

- `if` starts the condition: "Start of the condition: if the last of the commands up to `then` exits 0, the `then` branch runs" (the last one decides: `if false; true; then` runs the branch). Before, "Start a conditional; run the `then` branch if the condition exits 0".
- A `;` before a reserved word ends the commands before it: "End of the list before `then`", and whether the `;` may be left out. Before, it said that bash waits for the commands to end, which it does after every command of a list. Before `}` after a coprocess, it still says that bash does not wait.
- `[[ $x == 1 ]]`: a pattern in which nothing acts as a wildcard matches only itself, so the condition says "strings are equal", and Reading's row of `==` says it is a plain comparison. Before, both said "the right side is a glob pattern". Whether a pattern has a wildcard comes from the word model: a quoted `*` is none, a value the script sets is read (`p=1; [[ $x == $p ]]`), and with `shopt -s nocasematch` it stays a pattern (`a` matches `A`). After code the walk does not read (`eval "$c"`, `source ./x.sh`), which may have set nocasematch or changed `p`, it stays a pattern too.
- Reading gives `[[` and `]]` a row ("Start of the conditional expression"), and each operand of `[[ ]]` says what it is to its operator: "The file `-f` tests", "The string on the left of `==`", "A value `-eq` compares: evaluated as an arithmetic expression".
- tar's operands by mode: with `-c`, `-r` and `-u` they are "files and directories to put into the archive"; with `-x`, `-t` and `-d`, "names in the archive to act on (all when none)"; with `--delete`, "names in the archive to delete" (with no name it deletes nothing); with `-A`, "archives whose members are appended". Before, "Word `~/docs`".
- `failure-reported-as-success` names a long command by its name (`tar`) rather than cutting it in a word (`tar -czf "$backup" ~/docs 2>/…`).
- Japanese: the status of an AND or OR list is 「最後に実行したコマンドのもの」 (before, 「最後に実行したもののもの」); `$HOME` is 「ホームディレクトリ」, as in English.
- `date +%F`: "date as %Y-%m-%d (e.g. 2026-01-31)".

### Words run with no shell: Docker's exec form and Python lists

`CMD ["echo", "$HOME"]`, `ENTRYPOINT ["./run.sh"]`, `RUN ["apt-get", "install", "-y", "curl"]` and `subprocess.run(["ls", "-l"])` run with no shell: the program is found in `$PATH` and gets each string as one word. The explanation now says so:

- The name is a program in `$PATH`. `echo`, `printf`, `kill`, `[` and `time` run the program of their name: "No shell reads these words, so this is the program, not the shell's builtin". Before, `echo` was bash's builtin.
- A builtin with no program (`cd`, `export`, `source`, `exit`, `read`) and a reserved word (`if`) are not found: "The shell's builtin `cd` (Change the current directory). No shell reads these words, so it is looked up in PATH as a program, and there is usually none of this name: the command is not found". Their words are words of no command (`Word /app`). Before, `cd` was bash's builtin, `["if", "x"]` an `if` statement, and `["export", "A=1"]` an assignment.
- Each string says what it is in the file, with its value, and cites no section of bash's manual: "JSON string: `$HOME` goes to the command as one word, as it is. No shell reads its `$`, `*`, quotes or spaces first" (a Python list: "Python string"). A string written with escapes shows its value: `"a\"b"` is `a"b`, `"\u0041"` is `A`. Before, a string with a `$`, a space or a quote was a "Single-quoted string" (§3.1.2.2), the quoting of the text bash was given; `"it's"` was a concatenation of three parts.
- The exec form reads JSON's escapes (`\"`, `\\`, `\/`, `\b`, `\f`, `\n`, `\r`, `\t`, `\uXXXX`). An array with another escape is no JSON, and Docker runs the line in its shell form; it is left out, as any array that does not parse. Before, `\u0041` was read as `u0041`.
- A script passed to a shell (`CMD ["sh", "-c", "echo $HOME"]`) is read by that shell, as before.
- What the program gets is said without a shell: a subcommand is "an argument `apt-get` gets with no shell in between, and interprets itself" (before, "to the shell it is an argument to `apt-get`"); find's `";"` ends `-exec` with no note that it must be escaped from the shell; a path (`ENTRYPOINT ["./docker-entrypoint.sh"]`) is "Run the program or script at `./docker-entrypoint.sh` as it is, with no shell", citing no section (before, bash's command search, §3.7.2).


Each case was run in bash 5.2; each warning is still given where bash fails.

Code the explainer does not read follows one rule. After a file read with `source` or `.`, or an `eval` of text not known here, on a path before the line, such code may turn `expand_aliases` on, or export or set a variable or a function. A check that says one of those is off is then a caveat, with "unless code that runs before it and is not read here … turns `expand_aliases` on" (or "sets it there", "defines it there"). Before that code, or on the same line (bash reads the whole line first), it stays a warning.

- `alias-not-expanded-in-script`: a script run by `#!/bin/bash -i` or `#!/usr/bin/env -S bash -i` is an interactive shell, which expands aliases, so the alias is now explained as expanded. A function of the alias's name (`al() { …; }; alias al=…; al`) runs instead: no warning; one defined on some paths only (`if [ "$1" ]; then al() { …; }; fi; al`) runs on those: a caveat. After code not read (`. ./lib.sh`, `eval "$x"`), a caveat, and the name's hint says "the alias may not be expanded". `alias ll=…; ll; . ./lib.sh` still gets the warning.
- `local-outside-function`: in a trap's action it is a caveat. The action runs where the trap fires: `f() { trap 'local y' RETURN; }` runs `local` in `f`, but an `EXIT` trap runs it after `f` has returned, and a `DEBUG` or `ERR` trap set in `f` stays set after it returns (`f(){ trap 'local y' DEBUG; true; }; f; echo after` fails at `echo`).
- `variable-not-passed-by-wrapper`: sudo sets `HOME`, `MAIL`, `SHELL`, `LOGNAME`, `USER`, `PATH` and the `SUDO_*` variables itself (sudoers(5); with `sudo -E`, the `SUDO_*` ones), doas sets `HOME`, `LOGNAME`, `PATH`, `SHELL`, `USER` and `DOAS_USER`, and `su -l` sets `HOME`, `SHELL`, `USER`, `LOGNAME` and `PATH`. `USER=x; sudo bash -c 'echo $USER'` no longer says that `USER` is not there, and `sudo bash -c 'set -u; echo "$SUDO_USER"'` no longer says it is unset.
- `variable-not-exported`, `variable-not-passed-by-wrapper`, `variable-not-in-remote-shell` and `function-not-in-new-shell-export`: after code not read, in this shell (`foo=1; . ./lib.sh; bash -c 'echo $foo'` prints `1` when `lib.sh` exports `foo`) or in the string before the read (`bash -c '. ./env.sh; echo $foo'`), a caveat. An array still gets the warning: bash exports none.
- `distro-alias-in-script`: in a file with no shebang, `ll` (an alias Ubuntu and others define for interactive shells) is now a caveat, as an interactive shell that reads the file (`.bashrc`) has it; a script still gets the warning. So in `bash -i -c ll` and in a script run by `#!/bin/bash -i`, as an interactive shell reads `.bashrc` first; not with `--norc` or `--rcfile F`, which read none.
- A function that has the name of a program (`ls() { command ls -F "$@"; }`), where the function is not there (`timeout 5 ls /`, `xargs ls`, `bash -c "ls /"`, `sudo ls`, `ssh host ls`, `docker run img ls`): the program of that name runs, and the note says so (`function-shadowed-by-program`). Before, it said "command not found". A caveat when the function runs that program itself (`command ls`, `/bin/ls`, `sudo ls` in its body); a warning when it only has the name, as `install() { cp app /usr/local/bin/; }` with `sudo install` (coreutils' `install` runs: "missing file operand") or `sync() { rsync …; }` with `timeout 300 sync` (the disks are flushed, and nothing is copied). A function that is no program (`sudo myfunc`) is still an error.
- `variable-not-in-remote-shell` and `variable-not-passed-by-wrapper`: sshd sets `HOME`, `LOGNAME`, `MAIL`, `PATH`, `SHELL`, `USER`, `SSH_CLIENT` and `SSH_CONNECTION` (ssh(1)), and a container runtime `HOME`, `HOSTNAME` and `PATH` (`docker run`, `kubectl exec`): no note for those. A variable ssh may send is a caveat: `LANG` and `LC_*`, which Debian's and Ubuntu's ssh_config send (`SendEnv`) and their sshd accepts, and a name given to `-o SendEnv=` (names separated by blanks, patterns with `*` and `?`, as ssh_config(5) says). Only when the variable is exported, or may be: ssh sends its own environment, so `x=1; ssh -o SendEnv=x host 'echo $x'` stays an error.
- `redirect-in-bracket`: a redirection in `[ ]` where no comparison would stand is no problem: `[ "$n" -gt 0 2>"$log" ]` and `[ -t 0 < "$tty" ]` test what they say, with that redirection. Only one where a comparison would be (`[ "$a" > "$b" ]`, `[ 10>$max ]`, `[ -n "$x" -a $a < $b ]`) or to a number (`[ $a 2>5 ]`) is an error.
- `extglob-in-same-block`: in a file with no shebang, `shopt -s extglob` in the same block as its glob is now a caveat. An interactive shell that reads the file (`.bashrc`) often has `extglob` on already: Ubuntu's `.bashrc` loads bash-completion, which turns it on. A script still gets the warning. `extglob-not-in-new-shell` in `bash -i -c 'echo !(x)'` is a caveat too.

### Strings run by `bash -c` in host files

- The commands of a string run by `bash -c` (`RUN bash -c 'echo $HOME'`, `CMD ["env", "bash", "-c", "echo $HOME"]`, `subprocess.run(["bash", "-c", "…"])`, a Makefile recipe, a workflow's `run:`, a Markdown block, a Jenkinsfile `sh` step, a package.json script) are placed on their own text. Before, they were placed from the start of the region's first statement rather than of the file: their spans pointed at line 1 (`1:undefined`) and their labels were taken from there (`FROM node:20`). A script that starts with blank lines had the same fault.

### Heredocs in scripts with CRLF line ends

bash reads the CR after a heredoc's delimiter as part of it: `cat <<EOF` followed by a CR waits for a line `EOF` followed by a CR, which ends it as the author meant. A line `EOF` with LF alone does not end it, nor does `EOF \r`. With `<<'EOF'` the CR is outside the quotes and still part of the delimiter. Before, the explainer read the delimiter as `EOF` without the CR, so the heredoc ran to the end of the file: every line after it was shown as heredoc text, and the CRLF error missed the keywords there (`fi\r`), and said a warning where bash fails.
