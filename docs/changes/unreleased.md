# Changes since 0.9.0, in detail

The short list is in [CHANGELOG.md](../../CHANGELOG.md#unreleased).

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

In a `#!/bin/sh` script, a construct that is not POSIX but that dash and busybox ash run (`local`, `echo -n`, `read -p`, `set -E`) is now information: "ⓘ Portability: `local` is not POSIX sh (dash and busybox ash accept it, but POSIX does not have it)". It fails no check, even with `--strict`. Before, it was a warning and failed `--check`. One that dash or busybox ash lacks (`[[ ]]`, arrays, `${x^^}`) is an error.

The two notes that started with their own "Syntax error:" lose it, since the word now says "Error:": `if true then` says "ⓧ Error: A `;` or a newline is needed before `then`…", and a `}` that does not end `${ …; }` says "ⓧ Error: This `}` is one more argument…". The token of that `}` still says "Syntax error (bash 5.3):".

What fails `--check` and the GitHub Action:

| Problem | Before | Now |
| --- | --- | --- |
| An error | failed (a construct the shell lacks, CRLF), or only with `--strict` (the notes above, which counted as pitfalls) | fails |
| A warning | failed, unless it was a pitfall (then only with `--strict`) | fails only with `--strict` |
| Information | never failed | never fails |

So `[ -f a`, `unset` of a read-only variable and the others above now fail without `--strict`. And a few warnings that are no pitfall no longer fail without it: a GitHub Actions expression in `run:` (`injection`), a Python string run by a shell (`pythonInjection`), a Python call that runs a string with no shell (`pythonNoShell`), and CRLF line ends with no CR on the `#!` line, no keyword before a CR and no CR where a command starts. The Action's `strict: 'true'` (`--strict`) keeps failing on them.

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
- Copy a link is a button with words in the top bar. After a copy it reads "✓ Copied" for about 2 s, and a screen reader hears "Link copied"; its tooltip says that the script is in the part after `#`, which browsers do not send to the server. Before, a toast said all of it. Under 900 px it shows its icon only, until the file type and the view leave the top bar.
- Install for VS Code shows from 1100 px (before, from 901 px).
- Clear the editor empties it, and the toast offers Undo. An empty editor shows Paste a script, Open a file… and Load the sample, and that a file can be dropped there.
- On a first visit, a row over the sample says "This is a sample: put the cursor on any line.", with Use my own script and Open a file…. It stays closed once closed or used.
- The menu is in groups: Script; Share and Explanation (on a narrow page, where the top bar has no room for them); Preferences; Help, with the keyboard shortcuts (not on a touch screen); About. Its title is "Bash Explainer".
- A button that gets the focus back after a dialog or a menu closed with the mouse no longer shows a focus ring; after a key it does.

### Messages on the web page: one place, one look

Every message of the web page (a toast) now shows in one place: above the Problems list, inside the editor's pane, so it never covers the explanation or the panel's header. While it shows, the editor keeps the line of the cursor above it. Each has an icon: ↶ when it can be undone (Sample loaded, Detected: Dockerfile), ✓ when something is done (Opened a.sh., Saved a.sh., Link copied.), a dot for a refusal or a note ("a.sh was not opened.", "Opened a.sh. It mixes line ends.").

A message stays 4 seconds, or 8 with a button, and as long as the pointer is on it or the keyboard's focus in it (F6 goes there after the explanation); it goes 2 seconds or more after both leave. Escape closes it and puts the focus back in the editor. Its reason or detail is behind **Why?** or **More** ("a.sh was not opened. Why? It is not a text file in UTF-8."). Before, a message showed at the bottom middle of the window, over the explanation on a wide window, for 6 seconds, with its whole text.

**Load the sample** over your own script replaces it at once and offers Undo, which brings back the text and its file. Over a file you opened and changed since, it asks first, as Open does ("Discard unsaved changes?", Discard and load or Cancel): the Undo goes with the next keystroke, and Ctrl+Z would bring back the text but not the file. Before, the browser asked first.

## Fixed

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

### Warnings that fired where bash runs the line fine

Each case was run in bash 5.2; each warning is still given where bash fails.

Code the explainer does not read follows one rule. After a file read with `source` or `.`, or an `eval` of text not known here, on a path before the line, such code may turn `expand_aliases` on, or export or set a variable or a function. A check that says one of those is off is then a caveat, with "unless code that runs before it and is not read here … turns `expand_aliases` on" (or "sets it there", "defines it there"). Before that code, or on the same line (bash reads the whole line first), it stays a warning.

- `alias-not-expanded-in-script`: a script run by `#!/bin/bash -i` or `#!/usr/bin/env -S bash -i` is an interactive shell, which expands aliases, so the alias is now explained as expanded. A function of the alias's name (`al() { …; }; alias al=…; al`) runs instead: no warning; one defined on some paths only (`if [ "$1" ]; then al() { …; }; fi; al`) runs on those: a caveat. After code not read (`. ./lib.sh`, `eval "$x"`), a caveat, and the name's hint says "the alias may not be expanded". `alias ll=…; ll; . ./lib.sh` still gets the warning.
- `local-outside-function`: in a trap's action it is a caveat. The action runs where the trap fires: `f() { trap 'local y' RETURN; }` runs `local` in `f`, but an `EXIT` trap runs it after `f` has returned, and a `DEBUG` or `ERR` trap set in `f` stays set after it returns (`f(){ trap 'local y' DEBUG; true; }; f; echo after` fails at `echo`).
- `variable-not-passed-by-wrapper`: sudo sets `HOME`, `MAIL`, `SHELL`, `LOGNAME`, `USER`, `PATH` and the `SUDO_*` variables itself (sudoers(5); with `sudo -E`, the `SUDO_*` ones), doas sets `HOME`, `LOGNAME`, `PATH`, `SHELL`, `USER` and `DOAS_USER`, and `su -l` sets `HOME`, `SHELL`, `USER`, `LOGNAME` and `PATH`. `USER=x; sudo bash -c 'echo $USER'` no longer says that `USER` is not there, and `sudo bash -c 'set -u; echo "$SUDO_USER"'` no longer says it is unset.
- `variable-not-exported`, `variable-not-passed-by-wrapper`, `variable-not-in-remote-shell` and `function-not-in-new-shell-export`: after code not read, in this shell (`foo=1; . ./lib.sh; bash -c 'echo $foo'` prints `1` when `lib.sh` exports `foo`) or in the string before the read (`bash -c '. ./env.sh; echo $foo'`), a caveat. An array still gets the warning: bash exports none.
- `distro-alias-in-script`: in a file with no shebang, `ll` (an alias Ubuntu and others define for interactive shells) is now a caveat, as an interactive shell that reads the file (`.bashrc`) has it; a script still gets the warning. So in `bash -i -c ll` and in a script run by `#!/bin/bash -i`, as an interactive shell reads `.bashrc` first; not with `--norc` or `--rcfile F`, which read none.
- `extglob-in-same-block`: in a file with no shebang, `shopt -s extglob` in the same block as its glob is now a caveat. An interactive shell that reads the file (`.bashrc`) often has `extglob` on already: Ubuntu's `.bashrc` loads bash-completion, which turns it on. A script still gets the warning. `extglob-not-in-new-shell` in `bash -i -c 'echo !(x)'` is a caveat too.
