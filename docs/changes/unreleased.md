# Changes since 0.9.0, in detail

The short list is in [CHANGELOG.md](../../CHANGELOG.md#unreleased).

## New

### Quick fixes from the notes

A note that suggests code to write in place of the line's (`Fact.rewrite`, `StyleFinding.rewrite`: docs/design/oracles.md, 3.2) offers it as a quick fix of its problem: the light bulb and Ctrl+. in VS Code, `textDocument/codeAction` in the Language Server, and buttons in the tooltip of the web page's editor. The fix makes the edits of the code the note shows, at the place of that problem (`cp $a b; cp $a c`: each `$a` its own); where the note gives two ways, both are offered, the one it recommends first (preferred, for VS Code's Auto Fix). The title is the code, cut at 60 characters: "Add `[ -e "$f" ] || continue`" where the fix only adds code, "Rewrite as `read -r`" where it changes some. Each rewrite is run in bash 5.2 and 5.3 (test/rewrites*.test.ts).

The problems with quick fixes: `failure-reported-as-success` (`cp a b || echo failed` → `… || { echo failed >&2; exit 1; }`, `return 1` in a function, `return 1 2>/dev/null || exit 1` in a file that may be sourced), `unmatched-glob-runs-once` (`[ -e "$f" ] || continue`, or `shopt -s nullglob`), `source-searches-path`, `pattern-from-variable`, `declaration-masks-status`, `postfix-increment-status`, the three `*-last-test-*` notes, `wrapper-assignment-expanded-first`, `prefix-assignment-expanded-first`, `unbraced-element`, `regex-backslash-dropped`, `bracket-close-glued`, `find-action-refused`, `unquoted-variable-as-path`, `unquoted-variable-in-test`, `for-over-unquoted-args`, `array-joined-in-assignment`, `nounset-unbound`, and the style checks `bracket-no-space`, `assignment-with-spaces`, `brace-no-space`, `brace-close-no-separator`, `rm-empty-variable-root`, `read-without-r`, `redirect-in-bracket`, `bracket-close-in-word` and `and-or-in-bracket`. None in a string another shell reads (`bash -c '…'`), where the code would need quoting, nor in a Dockerfile, a workflow, a Makefile or another host file, whose shell code is extracted from the file.

Two notes carry their code as data for the first time:

- `source lib.sh` (and `. lib.sh`): first a path from the script's directory, `source "$(dirname "${BASH_SOURCE[0]}")"/lib.sh`, which bash sets to the file being read, also when it is sourced or in a function; then `source ./lib.sh`, which reads the file of the current directory, as the search would after `$PATH`. In a `#!/bin/sh` script, `$0` names the script's directory (`. "$(dirname "$0")"/lib.sh`); in an sh file with no shebang, which may be sourced, and in a code block typed into a terminal, only `./lib.sh`. Run in bash with a file of the name in `$PATH`, one in the current directory and one beside the script (in a directory whose name has a space), the script run, run by its path, sourced, and sourced in a function; and in dash.
- `grep "$x" f`: `grep -F "$x" f`. `-F` takes the place of an option that selects another mode, which it would conflict with (`grep -iE "$x"` → `grep -iF "$x"`, `--extended-regexp` → `-F`; `egrep` → `grep -F`). None where a word before the pattern may be an option (`grep $opts "$x"`): the note then says what to do, as before. Run in bash with GNU grep: the rewrite matches a value with `.` or `*` as the original matches it escaped.

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
- Copy a link is a button with words in the top bar. After a copy it reads "✓ Copied" for about 2 s, and a screen reader hears "Link copied"; its tooltip says that the script is in the part after `#`, which browsers do not send to the server. Before, a toast said all of it. Under 900 px it shows its icon only, until the file type and the view leave the top bar.
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
- A function that has the name of a program (`ls() { command ls -F "$@"; }`), where the function is not there (`timeout 5 ls /`, `xargs ls`, `bash -c "ls /"`, `sudo ls`, `ssh host ls`, `docker run img ls`): the program of that name runs, and the note says so (`function-shadowed-by-program`). Before, it said "command not found". A caveat when the function runs that program itself (`command ls`, `/bin/ls`, `sudo ls` in its body); a warning when it only has the name, as `install() { cp app /usr/local/bin/; }` with `sudo install` (coreutils' `install` runs: "missing file operand") or `sync() { rsync …; }` with `timeout 300 sync` (the disks are flushed, and nothing is copied). A function that is no program (`sudo myfunc`) is still an error.
- `variable-not-in-remote-shell` and `variable-not-passed-by-wrapper`: sshd sets `HOME`, `LOGNAME`, `MAIL`, `PATH`, `SHELL`, `USER`, `SSH_CLIENT` and `SSH_CONNECTION` (ssh(1)), and a container runtime `HOME`, `HOSTNAME` and `PATH` (`docker run`, `kubectl exec`): no note for those. A variable ssh may send is a caveat: `LANG` and `LC_*`, which Debian's and Ubuntu's ssh_config send (`SendEnv`) and their sshd accepts, and a name given to `-o SendEnv=` (names separated by blanks, patterns with `*` and `?`, as ssh_config(5) says). Only when the variable is exported, or may be: ssh sends its own environment, so `x=1; ssh -o SendEnv=x host 'echo $x'` stays an error.
- `redirect-in-bracket`: a redirection in `[ ]` where no comparison would stand is no problem: `[ "$n" -gt 0 2>"$log" ]` and `[ -t 0 < "$tty" ]` test what they say, with that redirection. Only one where a comparison would be (`[ "$a" > "$b" ]`, `[ 10>$max ]`, `[ -n "$x" -a $a < $b ]`) or to a number (`[ $a 2>5 ]`) is an error.
- `extglob-in-same-block`: in a file with no shebang, `shopt -s extglob` in the same block as its glob is now a caveat. An interactive shell that reads the file (`.bashrc`) often has `extglob` on already: Ubuntu's `.bashrc` loads bash-completion, which turns it on. A script still gets the warning. `extglob-not-in-new-shell` in `bash -i -c 'echo !(x)'` is a caveat too.

### Heredocs in scripts with CRLF line ends

bash reads the CR after a heredoc's delimiter as part of it: `cat <<EOF` followed by a CR waits for a line `EOF` followed by a CR, which ends it as the author meant. A line `EOF` with LF alone does not end it, nor does `EOF \r`. With `<<'EOF'` the CR is outside the quotes and still part of the delimiter. Before, the explainer read the delimiter as `EOF` without the CR, so the heredoc ran to the end of the file: every line after it was shown as heredoc text, and the CRLF error missed the keywords there (`fi\r`), and said a warning where bash fails.
