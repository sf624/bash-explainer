# Changes since 0.9.1, in detail

The short list is in [CHANGELOG.md](../../CHANGELOG.md#unreleased).

## New

### "In short": one sentence for each line

The panel, in VS Code and on the web page, starts with one sentence that says what the line does, under the label "In short" / 「ひとことで」. Every line with code has one, at both depths.

- A command: what it is and does, the options given, and its redirections: "Runs `sort` (sort lines) using `-u` (output only unique lines), with stdin (fd 0) from `in.txt`, stdout (fd 1) to `out.txt`."
- An assignment: the value the variable gets, with a placeholder for what is known only when the line runs: "Sets `workdir` to the output of `$(mktemp -d)`", "Sets `x` to ‹home directory›`/bin`".
- A list and a pipeline: "Tests the condition in `[ … ]`; if that succeeds, runs `echo` …", "Pipes `foo` into `bar`; its status is that of `bar`" (with pipefail: "the last command that fails, or 0"), and under `set -e`, that a failure before the last command of a list does not stop the script. A pipeline into a loop or a group says where that stage runs: "Pipes `cat` into a `while` loop (lines 1–3); the `while` loop runs in a subshell: repeats line 2 while `read` succeeds" (with `shopt -s lastpipe`: "in the shell itself"). A statement started with `&` is said in the background as a whole.
- A block: its first line says what it does ("Repeats lines 75–79 while `getopts` … succeeds", "Runs line 26 with `$f` set to each file name matching `*.sh`, one at a time"), and the word that ends it says what it ends ("`done` ends the `while` loop of line 28: …"), and what it pipes into (`done | sort`). A `for` loop whose words give none (`for x in $empty`) says its body does not run.
- Shapes with a sentence of their own: strict mode, an EXIT trap, a quiet check that a command is installed, `while read … done < file` ("Reads `input.txt` one line at a time…"), an endless loop, `sort | uniq -c | sort -rn | head -n 3` ("Counts how often each line … occurs and lists the lines from the most frequent, with their counts (the first 3)"), and `echo … >&2` ("prints a message on stderr").

The sentence never repeats a problem of the line: where a problem is about the line's status or `set -e`, the sentence says nothing of them.

### What the program receives

A switch under the panel's line box, "What the program receives" / 「プログラムが受け取るもの」, is on by default and remembered once chosen (key `W` when the focus is in the panel).

- Under each command, its words after bash's expansions, quote removal, splitting and globbing, as chips: `grep -h "$USER" /var/log/*.log` receives `grep`, `-h`, ‹current user name›, ‹each file name matching `/var/log/*.log`, else the pattern itself› ("else no word" with `nullglob`, "else the command does not run" with `failglob`). A word received as written is tinted, here and on its row; a value known only when the line runs is in ‹ ›, dashed where it is not always one word. A statement continued on other lines says it of each command it shows.
- A builtin or a function runs inside bash, with no first word of its name ("runs inside bash, gets:"; `pwd`, "gets no arguments"). `sort` alone "receives only its name"; `{,}` leaves no word, so nothing runs. An alias's words are its text, not its name. Where bash stops first (`x=; ls ${x:?}`), the line says so: the program does not run.
- After a file read or a text not known (`. ./s.sh`, `eval "$y"`, also `declare -c`, `c=f; $c`), a variable is a value known only when the line runs, not the value the script gave it: `x=1; . ./s.sh; ls $x` receives ‹value of `$x`›. A name the dictionary does not know is "a program, or a function of the file read". With `set -k`, `ls a=b c` receives `ls`, `c`.
- Such a script (a file read with `. file`, `eval` of text the tool cannot read, `c=f; $c`, CR LF line ends) is read as a whole, wherever the `.` stands: no value of a variable is taken as known anywhere in it, also before the `.`. Its chips and sentences say ‹value of `$dir`› instead of the value (`dir=/srv/cache; . ./lib.sh; rm -rf $dir/old`), and the worked examples that would use the real value are left out (they use made-up data). `rm`, `mv` and `cp` on an unquoted variable rise from a Caveat ("with its value here it stays one argument") to a Pitfall, since the value is not known: `--check --strict` can newly fail on such a script (25 of 1,427 scripts of a corpus did); the default `--check` is unaffected, as a Caveat or a Pitfall does not fail it.
- In a script of another shell, a builtin it lacks is a program there: `declare x=1` in sh "receives" `declare`, `x=1`, as dash says "not found". `[[ a ]]` and `time a` are no constructs of that shell (dash runs `/usr/bin/time`), and `$"hi"` gives `$hi`.
- A word a host pastes before the shell reads the line is any number of words, in quotes and under bash too: `"${{ env.Y }}"` is ‹the words of `"${{ env.Y }}"`›.
- In a file with CR LF line ends, the last word of a line holds the CR, as bash reads it: `ls a` receives `a␍`, not tinted.
- The mark "handled by bash" / 「bash が処理」 is on what no program receives, once per construct, on its first row, at both depths: one on `if … fi`, one on a pipeline, one on each redirection and prefix assignment, none on a word however bash expands it. In a script of another shell it says "handled by the shell". Before, nothing in the panel told what reaches the program from what bash keeps.
- The mark "not portable to sh" / 「sh に移植できない」 is on the construct only (`[[ ]]`, `==` in `[ ]`, `source`, `local`, `<<<`, `{a,b}`), with the switch on or off, in a bash script too, as a fact of the construct: the problems still show only for the script's own shell. A press opens what the problems of a sh script say of it (which `/bin/sh` fails on it, and what to write instead). A string another shell reads has no marks yet.
- The button **Key** beside the switch lists, inline in the panel, what each mark on screen means, the levels' marks included, and only those.

### Quick fixes from the notes

A note that suggests code to write in place of the line's (`Fact.rewrite`, `StyleFinding.rewrite`: docs/design/oracles.md, 3.2) offers it as a quick fix of its problem: the light bulb and Ctrl+. in VS Code, `textDocument/codeAction` in the Language Server, and buttons in the tooltip of the web page's editor. The fix makes the edits of the code the note shows, at the place of that problem (`cp $a b; cp $a c`: each `$a` its own); where the note gives two ways, both are offered, the one it recommends first (preferred, for VS Code's Auto Fix). The title is the code, cut at 60 characters: "Add `[ -e "$f" ] || continue`" where the fix only adds code, "Rewrite as `read -r`" where it changes some. The web page's buttons show it as plain text, without the backticks (CodeMirror draws an action's name as text); VS Code and the Language Server keep them, as in their messages. Each rewrite is run in bash 5.2 and 5.3 (test/rewrites*.test.ts).

The problems with quick fixes: `failure-reported-as-success` (`cp a b || echo failed` → `… || { echo failed >&2; exit 1; }`, `return 1` in a function, `return 1 2>/dev/null || exit 1` in a file that may be sourced), `unmatched-glob-runs-once` (`[ -e "$f" ] || continue`, or `shopt -s nullglob`), `source-searches-path`, `pattern-from-variable`, `declaration-masks-status`, `postfix-increment-status`, the three `*-last-test-*` notes, `wrapper-assignment-expanded-first`, `prefix-assignment-expanded-first`, `unbraced-element`, `regex-backslash-dropped`, `bracket-close-glued`, `find-action-refused`, `unquoted-variable-as-path`, `unquoted-variable-in-test`, `for-over-unquoted-args`, `array-joined-in-assignment`, `nounset-unbound`, and the style checks `bracket-no-space`, `assignment-with-spaces`, `brace-no-space`, `brace-close-no-separator`, `rm-empty-variable-root`, `read-without-r`, `redirect-in-bracket`, `bracket-close-in-word` and `and-or-in-bracket`. None in a string another shell reads (`bash -c '…'`), where the code would need quoting, nor in a Dockerfile, a workflow, a Makefile or another host file, whose shell code is extracted from the file.

Two notes carry their code as data for the first time:

- `source lib.sh` (and `. lib.sh`): first a path from the script's directory, `source "$(dirname "${BASH_SOURCE[0]}")"/lib.sh`, which bash sets to the file being read, also when it is sourced or in a function; then `source ./lib.sh`, which reads the file of the current directory, as the search would after `$PATH`. In a `#!/bin/sh` script, `$0` names the script's directory (`. "$(dirname "$0")"/lib.sh`); in an sh file with no shebang, which may be sourced, and in a code block typed into a terminal, only `./lib.sh`. Run in bash with a file of the name in `$PATH`, one in the current directory and one beside the script (in a directory whose name has a space), the script run, run by its path, sourced, and sourced in a function; and in dash.
- `grep "$x" f`: `grep -F "$x" f`. `-F` takes the place of an option that selects another mode, which it would conflict with (`grep -iE "$x"` → `grep -iF "$x"`, `--extended-regexp` → `-F`; `egrep` → `grep -F`). None where a word before the pattern may be an option (`grep $opts "$x"`): the note then says what to do, as before. None where grep has other patterns (`grep -e 'a.b' -e "$x"`, `-f pats`), which `-F` would read as fixed strings too: the note says so (see Fixed). Run in bash with GNU grep: the rewrite matches a value with `.` or `*` as the original matches it escaped.

### A summary of the line on a phone

On a phone (and a tablet held upright), one row says what the cursor's line is: "Ln 20 ⚠ Pitfall: set -e is on here, so the script stops…". It shows the line's first problem in the Problems list, errors first, then pitfalls, then caveats, with its level's mark, in the list's words; on a line with no problem, its "In short" sentence; on a comment or the shebang, what that is. The row is cut at the screen's end; a screen reader hears it whole, with the level's name ("Line 20: Warning. Pitfall: …").

- While you type in the editor and the on-screen keyboard is open, the app bar goes and the sheet folds to this row alone, just above the keyboard; the line you type stays in view above it. When the keyboard closes, the sheet and the bar come back as they were.
- The folded sheet is its tabs row and this row under it (about 96 px). Before, it was the tabs row alone. There, the row leaves out "Ln 20" when the tabs row shows it.
- A tap on the row (or Enter) closes the keyboard and shows the explanation at half height, from any tab; the focus goes to the sheet's bar, not back to the editor. Escape on the row goes back to the editor.

### Dockerfile HEALTHCHECK and ONBUILD

- `HEALTHCHECK CMD …` is explained as CMD is, in the shell form (with the shell SHELL sets) and in the exec form, after its options (`--interval`, `--timeout`, `--start-period`, `--start-interval`, `--retries`), also over lines continued with `\`. A note says what its exit status means: 0 healthy, 1 unhealthy. `HEALTHCHECK NONE` has no command. Before, a HEALTHCHECK was not explained.
- An instruction after `ONBUILD` (`ONBUILD RUN npm ci`) is explained as the instruction is, with a note that it runs in the build of another image FROM this one. `ONBUILD SHELL` is left out: it sets the shell of that build, not of this one. Before, ONBUILD lines were not explained.

## Changed

### The errors of a part of a line are problems

A part of a line can say that the command fails every time it runs, with ⓧ on its row. Those errors stopped at the row: the Problems strip said "no problems", VS Code showed no squiggle, and `--check` exited 0. Now they are notes of the line, and go where every note goes: the panel, the hover, Markdown, the Problems lists of VS Code, the Language Server and the web page, `--check` in every format (`text`, `github`, `json`, `sarif`), and the GitHub Action.

- `arith-invalid-number`: `echo $((09))`, `$((2#2))`, `let x=09`, `(( 08 ))`, `bash -c 'echo $((09))'`. Not `$((10#09))`, `[ 09 -eq 9 ]` (`[` reads a decimal) or `${a[09]}`.
- `shebang-env-one-argument`: `#!/usr/bin/env bash -e`, which fails with status 127 on Linux when the file is run as a program (`bash file` ignores the line and runs the script; macOS splits the line, and it works there). `#!/usr/bin/env -S bash -e` is fine, and a `#!` that is no first line of a script (a Markdown block, a workflow's `run:`) is a comment.
- `shebang-env-string-refused`, `shebang-env-loop`, `splice-refused`.

**Compatibility.** `--check` and the Action fail (exit 1, the output `errors`) on these lines, which passed before. To keep one, write `# bash-explainer disable=<code>` above it, or add the code to `bashExplainer.diagnostics.ignore`. In a sample of 103,267 lines (this repository's fixtures, and 700 shell scripts of a Linux system), no line changes; among the 2,607 lines of the tests' snippets, written to try odd cases, 2 change: `#!/usr/bin/env bash --posix` and `let x=09`, and each fails in env and bash.

A part's warning stays on its row, and is no problem (`#!bash`, `${x:-$((09))}`, `terraform -foo plan`): whether it fails depends on the files there, the options or the path taken.

### The box of the line's problems

At both depths, the problems of the line come first, under "Problems on this line" / 「この行の問題」, errors first. Each says its level and one sentence with what happens, written for it and by case (`((i++))` says "the script stops" only under `set -e`). "More" holds the whole text, the same as the Problems lists, what it cites, and each fix with a copy button. A click on the sentence goes to the row it is about, and a chip on the row comes back. Other notes stay below it, as they were.

On a line inside a construct, the box points to the problems on the construct's line: "↑ Pitfall on line 3: …" goes there. A problem you silenced (`# bash-explainer disable=<code>`, `diagnostics.ignore`) leaves the box and shows below it as a plain note; its row keeps its mark.

### A syntax error is a problem, where it is positively known

A checker that passed `echo ok )` had a hole: `--check` exited 0, and the web page's Problems strip said "No problems" beside a red row. Now such a line is a problem of a plain shell script, in every Problems list, in `--check` and in the Action. It takes `# bash-explainer disable=<code>` and `diagnostics.ignore`, as other problems do.

- How the file is known to be a script decides its level. With a first line, a ShellCheck directive, `--shell`, `-e` or on the web page, where the reader chooses the shell: an Error, code `syntax-error`. With only a name (`.sh`, `.bash`, `.bashrc`…), `--kind` or an editor's language, which another shell's file may have too (`aliases.sh`, sourced by zsh, with `a=(${(f)"$(x)"})` or `for f (a b) echo $f`): a warning, code `syntax-error-if-bash`, with the same text. It is in the box and the Problems list, and only `--strict` fails on it.

- **Compatibility:** `--check` and the Action now fail on the Error, where nothing before it may end the script with status 0 or change how it is read. Hosts are not reported, nor code after an `exit`, a `source` or the other words below, even in a function.
- It is on the text bash stops at, or on the opening of what is left open: `)` in `echo ok )`, `if` in `if true; then` with no `fi`, `'a` in `echo 'a`.
- It says what is true, by what bash and dash do, on the path the script takes: if the shell reaches this line, it stops reading there, having run the commands it read in full before; the command it is in, and the others on the line where it starts, do not run. It states no status: `x=(1 2` exits 1, and a file sourced returns to the script that sources it. It says "the shell", as dash runs `#!/bin/sh`, and `-e` has no file.
- A script in strict mode is checked as any other (`set -e`, `set -u`, `set -euo pipefail`, `#!/bin/bash -e`, `#!/usr/bin/env -S bash -eu`): they stop a script only with a failing status, so a script that works never holds such a line. A script that stops before the line gets the Error all the same, and has already failed.
- One problem for a file, the first: bash stops there. No second problem where another says the same: `{ a }`, `f() { a }`, `{echo a;}`, `if a then b; fi`.
- Not said where `bash -n` accepts it: a here-document that ends with the file (bash warns, and runs it), an error in a here-document's body or in backticks (read when they run, and the script goes on), `!` alone, `${ …; }` with bash 5.2 (its own problem says so). In a `#!/bin/sh` script it follows `dash -n`: `[[ a b ]]`, `f() b`, `$(( ) ))` are no syntax errors to dash (`[[` has its own problem). `time -- :`, which bash runs, no longer reads as an error.
- Not said where the code may never be read, as `bash -n` cannot know: a command before it named `exit`, `exec`, `eval`, `alias`, `trap`, `source`, `.`, `shopt`, `kill`, `logout`, `mapfile` or `readarray` with `-C`, or `set` with `-n` or `-t` (also behind `command` or `builtin`, or read only when it runs, `$cmd`), wherever it is. So a self-extracting script, pip's `'''exec'` wrapper, and `exit 1` in a usage function before a real error are all silent. A script with a real syntax error after such a word gets nothing.
- Not said where the file may not be a script: a first line that names another program (`#!/usr/bin/env node`), or a shell with `-n`, `-t`, `-s`, `-c` or a long option that may leave the file unread (`#!/bin/bash -s` reads stdin, not the file, and exits 0; `--version`, `--help`); with no first line, a name that is no shell's (`--kind`, `--shell` and an editor's language say it is one), or a name of another shell (`.fish`, `.csh`, `.cshrc`, `.tcsh`, `.tcshrc`, `.zsh-theme`, `.yashrc`, all in VS Code's language for shell scripts, whatever else says it is one); a template marker anywhere (`<%`, `{{`, `@VAR@`, `<< parameters.`); CRLF line ends; a NUL anywhere (bash calls it a binary file, status 126, with one on the first line); and a string read as a script (`bash -c '…'`).
- A file with no first line that is named `.sh` or `.bash` counts as a script by its name alone, so a text that is no script gets the warning (a Debian doc-base control file named `bash-doc.bash`, 1 of 46 such files on one machine; bash does reject it). It fails only `--strict`.
- Not said in another file, for now: a Dockerfile, a Makefile, a bats file, GitHub Actions, CircleCI, Markdown, an npm script, a string of Python or Groovy, any other YAML. What runs that code can be another program, or the text is not all of it.
- "In short" says it on every line of the command the shell refuses that holds code: "The shell stops with a syntax error (`fi` is missing)." Before, it said what the line seemed to do: "If `a` succeeds, runs …". A line after that command still says what it does. The row of what it stops at says the same words: "Syntax error: `)` cannot stand here".
- It names a token only where `bash -n` and `dash -n` name that token, by a table of more than 2,000 shapes of a fault in test/syntax-error.test.ts: a reserved word or an operator it stops at, what is missing at the end of a file. `echo (hello)` names `hello`, as bash reads `word (` as a function definition, and says that parentheses meant as text need quotes; before, it said that `)` cannot stand there. Elsewhere it says "The shell cannot read this command" (`for x in (a b); do c; done`, `case x y in`).
- `${(f)var}` and `${#x:-a}` are problems only where a run surely gets to them: the same conditions, and not in a function, a branch, a loop or after `&&` or `||`, as a guard for zsh (`if [ -n "$ZSH_VERSION" ]; then a=(${(f)x}); fi`) runs fine in bash. An Error, code `bad-substitution-always`; with only a name, a warning, code `bad-substitution-if-bash`, as above. Elsewhere the row has a warning's mark and says "if this runs".

### One view with a depth

The panel has one view instead of the tabs Meaning and Reading, and a control **Depth** in its header (on the web page, in the explanation's header): **1 What it does**, **2 How bash reads it**, or the keys `1` and `2` when the focus is in the panel. It remembers the depth; a Reading kept from before opens at depth 2, a Meaning at depth 1. The eight steps of Reading are gone, and so are its colour bands and its tree's arrow keys: the rows are reached with Tab, as in Meaning.

Depth 2 only adds: the rows of depth 1 stay, in the same order, saying the same, and the first row on the screen stays where it is.

- Each row has one role line, at one place: what the part is to each reader and who reads it last (`argument → value of -f · tar reads it`), A name on the line is a button: a click, a tap or Enter opens under the line what the kind is and who reads it, as Reading said in words, with the sections of the manual its text does not cite. The line is one stop of the Tab order, and the arrows go from name to name. The line as a whole has its own ("bash reads the line"), under the rows, and a here-document's body has one on its redirection. A role says where the part stands in bash's reading: the value of `x=notes.txt` says "value"; a pipeline with `!` or `time` says "pipeline"; a piece of a word (`/cache` of `$d/cache`) says nothing, as the word has the role.
- The role line says where a part stands in bash's reading, or nothing. A string a shell reads (`sh -c`, `eval`, a trap, `ssh`) has the roles the same code has at the top level, and says which shell reads it. A token inside a language has no line of its own: the language's name is on its word.
- A name opens to who reads the word: a program, "`grep` reads it, not bash"; a builtin or a function, "`eval` reads it, inside the shell"; `bash -c`, "a new bash reads it, not this shell".
- A pipe says what goes where: "stdout of `grep` → stdin of `sort`" (with `|&`, and stderr).
- A word that expands shows bash's steps in bash's order: `parameter expansion → no word splitting or globbing (quoted) → quote removal`, with arithmetic expansion and process substitution named. Where no step acts (`"failed"`), the line folds to "bash's steps: nothing expands". A word that only is its text (`-h`) has none.
- `[[`, `]]` and each operator of `[[ ]]` have rows, and so do the parts of a redirection (`2`, `>`, `/dev/null`) and of an assignment. A row whose parts all come at depth 2 starts folded, so that the parts of `2>/dev/null` or of a glob are one press away.
- What double quotes do is said once on a line, and so is a general text that differs only by a name ("Expands to the value of `e`", "Redirection applied to `x`").
- A screen reader hears the depth when it changes. The focus of the keyboard marks its row and that row's characters in the line, as a pointer does; when its row goes with the depth, the focus moves to the row that owns it.
- On the first line of a loop over several lines, Reading drew the whole loop, the other lines as kinds with no text. Depth 2 shows that line's rows; the others are one move of the cursor away.

`bashExplainer.panel.animations` drives the folds of the rows, the steps, "More" and the examples. A row's fold moves everything it hides, its parts and its examples together, for as long as the two are high together: 220 ms for a short box, 120 ms plus half its height in px for a taller one, at most 400 ms. A folded example keeps its title. The margins, padding and borders of a box that moves go to nothing and come back with it, so that nothing below it jumps by them.

Depth 1 now keeps what changes what a line means, which it hid before: awk's "classic dedupe idiom" on its rule, "expands to 3 words" on `project/{src,test,docs}`, and a row of `${s:$i:2}` that says what it takes, also where no example is drawn. It leaves out what the row above already shows: "Variable `s`" under `${s:$i:2}`, and "Value `notes.txt`" under `x=notes.txt`, as for `a=1`. `time >o` says what `time` does there on its top row, and its own row names only the word. In the Hover and the CLI too, `time` where there is no pipeline now says "The reserved word `time`"; before, "Measure and report the run time of the pipeline". A glob's example is folded under its title at both depths.

### The rows at depth 1

Depth 1 shows what each command does, in two columns: the code, and what it means, at one place on every row. A word's own parts (`"…"`, a number, a pattern, a variable that only expands) and bash's reserved words and separators (`then`, `;`, `do`, `|`) have no row of their own there, unless they have something to say: a warning, a value, an example. Depth 2 has all of them.

- A box goes around each simple command and compound command (`if`, `[[ ]]`, a function), and a bracket at the left of a pipeline or a list. `sudo ls` is one box: to bash, `ls` is an argument of `sudo`. A screen reader hears a box with parts as a group named by its code.
- The example of a whole pipeline is folded above the rows, under its title; the setting `examples.placement` puts it at the end with `last` or `bottom`. One inside a construct (`for …; do a | b; done`) stays under its row.
- A warning on a row has its level's icon and colour.
- On a phone or a narrow pane, each text goes under its code. In any width, a word longer than the code column (a long path) keeps its row and its text goes under it.
- The copy of the line at the top keeps its colours for every part, also those with no row: pointing at one lights the row around it.

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
- `--counts` does not write through a symbolic link at the last part of the path it is given, as `--sarif` does not: the tool says so and exits with status 2. A link earlier in the path is followed.

### Dialect issues in sh, as dash and busybox ash run them

An Error says that a line fails, and `--check` fails on it. In a script for `sh`, `dash` or `ash`, the dialect checks said Error for everything the shell lacks, with "it fails in dash". Each one has now been run in dash and in busybox ash, and `sh` names the shell each result is about:

- A variable the shell does not set (`$RANDOM`, `$SECONDS`, `$UID`, `$EUID`, `$HOSTNAME`, `$FUNCNAME`, `$PIPESTATUS`, `$BASH_VERSION`, `$BASH`, `$OSTYPE`, `$HOSTTYPE`, `$MACHTYPE`, `$REPLY`, `$EPOCHSECONDS`…): a warning, as the environment may set it (`env UID=7 dash u.sh`), "dash does not set it, so it expands to nothing"; `$((RANDOM % 5))` is one too, "it counts as 0". busybox ash sets `$RANDOM`, `$EPOCHSECONDS`, `$FUNCNAME` and `$HOSTNAME`, so only dash is named. Before, an Error that said it fails.
- The words say what follows where it is unset, still at a warning: `[ "$UID" -ne 0 ]`, `[ $UID = 0 ]`, `test $UID -eq 0` (status 2, and the script goes on as if the test were false), `${UID:?need}`, `$(($RANDOM % 5))`, and under `set -u`, unless a test of the name comes first ("the shell stops here"; "that subshell stops here" for `set -u; cd "$(dirname "$BASH_SOURCE")"`).
- Nothing where the word gives the value: `${UID:-0}`, `${UID:-$(id -u)}`, `${BASH_SOURCE:-$0}`. Before, "expands to nothing".
- Status 0 with another result: a warning with what the shell does. `echo -e` prints `-e`; `{a,b}` and `{1..3}` keep their braces; `$'a'` is a `$` and a quoted string; `cmd &>f` is `cmd &` and `>f`, which empties the file; `**` is `*`, in every shell that has no globstar.
- Nothing of a variable the script sets itself (`[ -z "$RANDOM" ] && RANDOM=…`), of a command it defines before the line (`print() { …; }`; `shopt -s x` before `shopt() { :; }` still fails), or of a name that is none of bash's (`$BASH_TSTOUT`, `$BASH_COMPLETION_VERSINFO`, which looked like one).
- `test a == b` now says what `[ a == b ]` says: status 2 in dash. A literal `==` as an operand says nothing (`[ "$1" = == ]`). `printf %q` is read in the format alone: `printf '%d%%quality\n' 90` and `printf '%s\n' '50%quota'` say nothing.

What the shell refuses while it reads the file stays an Error wherever it is written, as it fails even where it never runs: `a=(1)`, `<<<`, `|&`, `for ((`, `select`, `;&`, `;;&`, `@(a|b)` in dash and busybox ash, `function g {` and `<( )` in dash, `&>>` in busybox ash, also in a function never called or in `if false`. It is a warning after a stop that may come first, and nothing after a sure one; a string in `sh -c` follows the command that runs it, as it is read only when it runs.

Anything else that fails is an Error only where the shell surely gets to it, in any shell. After `. ./lib`, a nested `exit` (`if [ -z "$BASH" ]; then exit; fi`) or `eval`, and in a branch, a loop's body, after `&&` or `||` or in a function, it is a warning with the same words: `[ -n "$BASH_VERSION" ] && shopt -s x`, `type shopt && shopt -s x`, `if a; then shopt -s x; fi`, `if a; then sh -c '[[ a ]]'; fi`. Only `--strict` fails on it. After a command that surely stops the script, nothing is said, `**` included. The same in a release of bash and in the shells not run: `read -E`, `source -p`, `compgen -V` and `trap -P` with bash 5.2, `${ …; }` in a function, after `trap`, after `. lib` or on the right of `&&`, `declare` in mksh.

A script that probes its shell discards the message: that is a warning where the failure leaves it going, a status or anything in a subshell: `if (set -o pipefail) 2>/dev/null`, `(set -o pipefail) 2>/dev/null && …`, `shopt -s x 2>/dev/null || true`, `if shopt -q x 2>/dev/null`, `if (echo "${x:1}") >/dev/null 2>&1`, `if (eval "a=(1)") 2>/dev/null`. An Error stays where it is true: `set -o pipefail 2>/dev/null || true` and `if echo "${x:1}" 2>&1 >/dev/null` stop dash, and `set -e` stops the shell at `shopt -s x 2>/dev/null`.

A string is surely run only where nothing may leave it out: `eval`, `sh -c`, also through `env`, `timeout`, `nice`, `sudo` and other wrappers, and `trap '…' EXIT`. A trap's action for another signal (`trap '[[ -f "$tmp" ]] && rm -f "$tmp"; exit 1' INT TERM`), `find -exec`, `xargs`, `flock`, `watch`, `ssh`, `docker run` and `sh -n -c` may not run it: what fails there is a warning, and so is a fault of its text (`trap 'x = 1' INT`).

`${x:?}` and `${x?}` may stop the script, as `exit` in a branch does: after `: "${BASH_VERSION:?needs bash}"`, `shopt -s x` is a warning.

So the default `--check` catches a bashism where it surely fails; `--strict` is what catches one in a function, in a branch or after a command that may stop the script.

A row `translated` says a `$"…"` string is not POSIX sh: dash and busybox ash keep the `$`, and POSIX leaves it unspecified. `$'…'`, `;&`, `set -o pipefail` and `read -d` are in POSIX.1-2024 (2.2.4, 2.9.4.3, 2.9.2, `read`): "`set -o pipefail` is POSIX only since 2024 (it fails in dash)". `read -n`, `-s` and `-t` stay "not POSIX sh". The words of these sentences read as one thing now: "a here-string `<<<` is not POSIX sh", before "here-strings `<<<` is not POSIX sh".

A builtin a shell lacks is explained as a program in its scripts, where the table says so: `declare`, `typeset`, `pushd` (neither dash nor busybox ash has them), `let`, `source` (dash has not; in `sh`, not counted on), so `declare x=1; echo "$x"` no longer takes `x` as set. Bash's `print` and `whence`, which only ksh, mksh and zsh have, the same. `local`, in both, stays a builtin.

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

Side by side, the settings are a third column at the right, as the gear is there: a third of the window, at most 640 px. The editor and the explanation stay in view and in use beside them and share what is left in the ratio you set with the divider, so a change shows at once, and you can type, scroll and click while the settings are open (a click there leaves them open; Esc in the settings or the explanation, ×, Close and the gear shut them; Esc in the editor keeps its own use). The divider still moves, down to about 190 px for the editor and 200 px for the explanation, and closing gives back the widths from before. They slide in while the panes shrink with them, and the row you are reading and the cursor's line stay in view though the text rewraps. The panel keeps the text you read in place at any new width: the divider, the window, and VS Code's panel when it is resized. In an editor this narrow, the Problems strip keeps what fits and drops the rest whole: the word "Problems" first, then the counts of the lowest levels, then the place ("1/11"), and the highest level's count last, which stays wherever it fits beside the mark and the arrows (a screen reader still hears them all), and the ⋯ menu stays inside the window. On the compare page the script and the two copies share what is left in the same way; up to 1000 px wide, where the script lies above them, the settings take the whole window. Before, they covered the explanation they change. In the narrow layout (a phone, or a window up to 767 px wide) they take the whole screen, as before, and a change shows in the explanation when they close.

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

The explanation has a header of its own, above it, as wide as it: the tabs **Explanation** and **Reference** (the quick reference), the depth, **Collapse** and **Copy**. Before, the view switch and the icons of Collapse all, Copy as Markdown and the quick reference were in the top bar, and on a phone the view and Copy as Markdown were in the menu.

- Collapse and Copy show a word beside their icon; where the explanation is narrow, the word goes under the icon, smaller. Their full names ("Collapse all", "Expand all", "Copy as Markdown") are the tooltip and what a screen reader says.
- The depth is two segments where they fit (`Depth [1 Does] [2]`); where they do not, one button that opens them as a menu ("Depth 1 ⌄"; a screen reader hears "Depth: 1 What it does"). Escape closes the menu, and the focus goes back to its button. On a phone the button is a 44 px pill. Where nothing else fits, the Reference tab reads "Ref".
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

On a phone, and on a touch screen without a mouse held upright up to 1024 px wide (a tablet), the explanation is a sheet over the editor, at three heights: folded (its tabs row and a summary of the line, see above), half (at first) and full (up to the strip above the editor; the app bar slides away, and comes back below full). Before, the screen was split in two halves with a divider between, and a tablet showed the page as a desktop does. Turned to landscape, a tablet wider than 1024 px, or a phone whose browser asks for the desktop site, keep the page of their width.

- The sheet's header is one row at every height: the tabs **Explanation** with the cursor's line ("Ln 8"), **Problems** with its count per level ("ⓧ2 ⚠4 ⓘ6"; a screen reader hears "Problems: 2 errors, 4 warnings, 6 caveats"; ✓ when there are none) and **Reference**, then the view as a pill. Where the row is short, Reference reads "Ref", then Problems shows its highest level only ("ⓧ2"; a screen reader still hears every count), then the line goes. On a tablet the row also has Collapse and Copy. On a phone it has no room for them: Collapse is not offered (the explanation's rows fold one by one), and Copy as Markdown is in the menu's Share group. The row's controls keep clear of the screen's edges, where a swipe opens the menu or the settings.
- The whole header moves the sheet: drag it, and it settles on the height nearest to where you let go, or on the next one when you flick it. A tap on the header, or on the tab already chosen, goes folded → half → full → folded; another tab on a folded sheet opens it. With the keyboard, the bar (a slider, before the tabs) takes ↑ ↓, Home, End and Enter, and a screen reader says the new height. The first time the sheet is full, a line under its header says how to change the height.
- Problems is a tab of the sheet, with the list that was under the editor; a problem chosen there shows its line above the sheet and its explanation at half height.
- Messages show just above the sheet's tabs row. The editor ends at the sheet's top (at half or lower), and the line of the cursor stays in view as the sheet moves.
- With reduced motion, the sheet and the app bar move at once. A drag of the sheet never pulls the page to reload it.
- **Read** | **Edit** in the strip above the editor, on a touch screen, replace the keyboard button of the top bar: in Read, a tap on a line places the cursor without the on-screen keyboard. The first-run tip points at Read. The strip has Read | Edit, the file name, the chip and ⋯, each 44 px; Open and Save are in the menu.
- The first visit on a touch screen shows one message and starts in **Read** while a sample shows and no mode was chosen: the banner "Tap a line to read it, or tap Edit to type." and the button **Use my own script**, one row of 48 px, and the first tap on a line shows its explanation at half height instead of folding the sheet behind the keyboard. In Edit the banner says "This is a sample: put the cursor on any line.". The tip under the switch shows only in Edit, for a script from a link. A mode you chose with the switch is kept; a pasted, typed or opened script never changes it. With no mode chosen, an empty editor (Use my own script, Clear the editor) is in Edit, and a tap raises the keyboard; the sample back goes back to Read. A Read you chose stays on an empty editor too. The compare page has no switch and always takes the keyboard. The cursor's line (all its rows) is above the sheet on load, below the banner; closing the banner leaves a reader who scrolled away where they are. A desktop, and a touch screen with a stored mode, are as before.
- Problems on a phone's sheet: the rule's code ("postfix-increment-status") goes under the message, so the message keeps the row's width (293 of 390 px, from 110). A sheet wider than 520 px (a tablet) keeps it in its column.
- The empty editor's three buttons stand in a row on a phone's sheet, 64 px high, so that the message "Sample cleared" with Undo, above the sheet, covers none of them, and they do not move when it goes; on a phone held sideways they stand right of the message. Where the editor's pane is too narrow to read a message in (the divider at 15% of 768 px: it was 79 x 262 px, a letter on each row), the message is 240 px wide and goes over the pane's edge, inside the window.

### The order of redirections, and `2>&1` before `>file`

The note on the order of a command's redirections ("Redirections apply left to right. In the end: stdout → build.log, stderr → the original stdout") is a fact of the catalog now, `redirections-in-order`. `2>&1` before a redirection of stdout to a file is a fact of its own, `stderr-to-original-stdout`: a caveat (Information, "Caveat:" / 「注意:」), a problem in the editors. Before, it was a sentence inside the plain note ("Note: `2>&1` comes before the file redirection…"), no problem.

It names both things the order may mean: "`2>&1` comes before `>/dev/null`, so stderr goes where stdout went before stdout was discarded. To hide both, write `>/dev/null 2>&1`; to keep only the errors, `>/dev/null` is enough", and for a file: "… not to the file. To send both to the file, write `>build.log 2>&1`; to send only stdout there, `>build.log` is enough". It offers no quick fix: either rewrite changes what the line does, and only its author knows which is meant.

It is no caveat where the command's stdout goes somewhere known: a pipe (`find / -name x 2>&1 >/dev/null | grep -v denied`, `diff <(make 2>&1 >/dev/null) expected`, a group or a loop piped on, a string a shell runs), a command substitution (`err=$(make 2>&1 >/dev/null)`, bash 5.3's `err=${ make 2>&1 >/dev/null; }`), or a redirection around it (`{ make 2>&1 >/dev/null; } > errors.log`, `f > errors.log`), also for a function all of whose calls are so. That order is the way to send the errors alone there, and the note says so: "(only the error messages go into the pipe)", "(only the error messages make the substitution's value)", "(only the error messages go where a redirection around the command sends stdout)". The last stage of a pipeline writes into no pipe of its own, and gets the caveat.

`|&` sends stderr into the pipe after the command's own redirections (3.2.3): in `make 2>&1 >build.log |& tee e.log`, stderr goes to `build.log` too, and nothing reaches the pipe. The note now says "stdout → build.log, stderr → build.log", also for `make >build.log |& tee e.log`, which had no note. Before, it said stderr goes to the original stdout.

### A mark on every note

The notes that were plain text now start with ℹ, as the notes on facts do, and are facts of the catalog with an id (in the JSON output, `facts`):

- an idiom (`Idiom: …` / 「定番の書き方: …」), each its own fact (`idiom-strict-mode`, `idiom-read-file-loop`, …), with the sections of the manual it is about;
- a line in a here-document or at its end, and a statement continued from an earlier line;
- the order of redirections (above);
- which yq a command is explained as, and which yq runs it;
- `read` with an IFS of separators that are not whitespace;
- a host file's notes: a Dockerfile's `SHELL`, `ONBUILD`, `HEALTHCHECK` and exec form, a Jenkinsfile's `"…"` that Groovy fills in, a Python call's list or string, a YAML folded block, what a substitution of the host means (`$(CC)`, `${{ github.ref }}`), and GitHub's files (`$GITHUB_OUTPUT`);

The note on zsh syntax a line cannot be read with starts with ⓘ, as information: the level it always had in the Problems list.

### The JSON field `spoken` of a command name

In `--format json`, the `said` of a command name (`items[].name.said`, also in `children`) has `kind`, `title`, `by`, `also` and `short`. Before, it had `spoken` too: the kind and `by` joined with a comma (`program, run by sudo`), with the backticks left out, for a screen reader. Nothing in the panel or the page read it. To get it, join `kind` and `by` (when there is one) and remove the backticks.

### `[` is shown as the command it is

`[ -a file ]` has the shape of `test -a file`: one row for the command, labelled `[`, with its badge and the line on the program of that name, and its arguments one level below, `]` last. Before, a row of the whole test held a row for `[` beside `-a file` and `]`, drawn like the keyword `[[`, and the row of `[` said "Command `[` (an alias of `test`)" beside the row of the whole, which said the paragraph.

- The one row says what the two rows said: "Command `[` (an alias of `test`): evaluates the condition in its arguments…", citing 4.1 and 6.4 as before. At depth 2 the reading of the word `[` keeps its own short text, "Command `[` (an alias of `test`)", and its sections.
- The colour of the top row is that of a builtin (a command, for a program `[`: `/usr/bin/[`, after `enable -n [`), not that of a test. `[[ … ]]` is unchanged: it is syntax, with no program and no words received.
- What is said around it is unchanged: "In short" ("Tests the condition in `[ … ]`; if that succeeds, runs …"), the summary of a line (`test [ -a file ]`), the label of a pipeline's connector ("stdout of `[ -f c ]` → stdin of `cat`") and of a list or a redirection.
- `--format json`: the top part of the command has `kind` `builtin` (`command` for a program) and `label` `[`, with the arguments and `]` in `children`. Before: `kind` `test`, `label` the whole test (`[ -a file ]`), and a part for `[` under it.

## Fixed

### AND and OR lists that mix `&&` and `||`

`grep x | sort && echo || exit` showed the role "OR list" alone on its row, and `a || b && c` "AND list" alone, since the role came from the outermost operator. The role reads all the operators now, those of the lists nested on its left too: `a && b || c`, `a || b && c` and `a && b || c && d` are an "AND and OR list" (「AND・OR リスト」); `a && b`, `a && b && c`, `a || b` and `a || b || c` stay an AND list and an OR list. The text of the part says "AND and OR list, read from the left as …" (before: "lists"). In `--format json`, the `grammar` of such a part is `andOrList` (before: `orList`, or `andList`).

### A host file's own text in the explanation

In a Makefile, a workflow file and the other host files, a row's text, a role's text and the sentence "In short" named the script made from the file: `echo a > "$(OUT)"` said file `"${OUT}"`, and `> "$@"` said `"${make_target}"`, where the row's code said `"$@"`. They now say what the file says, as the notes do.

### Errors after a command that may stop the script

`--check` failed pip's wrapper, a `#!/bin/sh` header followed by Python (`x = 1` was `assignment-with-spaces`), and every Error after an `exit`. What may stop a script is now one table, of two kinds:

- After a command that surely stops it, nothing is said: `exit`, `logout`, `return`, `exec` with a command (also `command exec x`), `eval 'exec perl -S $0'` and `set -n` as statements of the script; deeper, an `exec`, `eval` or `set` that hands the script over (`[ -z "$BASH" ] && exec bash "$0"`, `if a; then exec python3 "$self"; fi`) or that a line the parser cannot read follows; and code that never runs, where the tool knows it does not (`if true; then exit; fi`, `if false; then y = 1; fi`). In a host, in the same shell: `RUN exit 0; x = 1` says nothing, the next `RUN` does. A Markdown fence and a bats test are shells of their own.
- After a command that may stop it, what says the shell reads the text wrongly is a warning, with the same words: an `exit` in a function or a branch, any other `exec` there (`exec echo "$usage"`), `trap`, `source`, `eval "$x"`, `alias`, `shopt`, `kill`, `$cmd a`. So `source ./lib.sh`, then `[-f x] && y` or a stray `fi`, is a warning (it was nothing since the first syntax error check), and `trap 'rm -f t' EXIT`, then `x = 1`, too (it was an Error). `[` without `]`, `print` in `#!/bin/sh` and the other Errors of a command stay Errors: they fail whenever they run.

`exec 3>&1`, `set -- "$x"` and `command -v "$x"` stop nothing. The Errors that say the shell reads the text wrongly are `assignment-with-spaces`, `brace-no-space`, `brace-close-no-separator`, `bracket-no-space`, `redirect-in-bracket`, `bracket-close-in-word` (when its word is never empty), `and-or-in-bracket`, `keyword-needs-separator`, `bracket-close-glued`, `$((09))`, `${(f)x}` and a syntax error. They are a warning too where only a name says the file is a script (`.sh`), or the text comes from standard input with no first line, and nothing in a file nobody says is a script. `env -S'"a' s` and `sh -c '[[ a = a ]]'` after an `exit` said an Error; now nothing. A syntax error at the end of a file (`f()`, then blank lines) was pointed at the first line, also after an `exit`; now at its own.

### The code under the phone's sheet

On a phone, dragging the explanation sheet down left the part of the editor it uncovered blank until the finger lifted; lifting the finger on the way up turned the code about to be covered blank at once, for the quarter of a second the sheet took to settle. The editor now goes on under the sheet at every height, so the code is there through the whole move, also after a fling or a cancelled drag.

- The scroll stays as it was: the text under a moving sheet does not jump when the sheet comes to rest. The last line can scroll up to the top of a half sheet, also while the sheet is folded, as an editor scrolls past its end.
- The sheet moves more smoothly on a slow phone: a move no longer lays out the page on each frame.
- A finger on the sheet's header now drags it from the very edge of the screen, in every browser.

### "bad substitution", when it happens

`echo ${x@Z}` said that bash reports "bad substitution". It does so only with a value to transform, even an empty one: the shell then stops (status 1). With none (`x` unset, an element that is not there, no positional parameters), the line prints an empty line. Now the row says so, with the mark of a warning. `${x@w}` too; this is a mark of the row, of which `--check` says nothing. `${(f)var}` and `${#x:-a}` fail whatever `x` is: bash reports "bad substitution", drops the rest of what it read with that line, and goes on to the next line, so `|| x` does not run, and a function or a loop stops whole. So the text states no status.

`nohup let x=09` and `sudo let x=09` said "arithmetic error", but `let` is no program, so they fail to run it (`nohup: failed to run command 'let'`) and read nothing. The problem that says so stays. The words of another builtin behind a wrapper changed too: `sudo source lib.sh` and `timeout 5 cd /tmp` show `/tmp` as "Word `/tmp`", as a program's operand, and `time -p -- ls` has a row for `--`.

### A part that fails every time, marked as an error

A row of the explanation marks a warning inside its text. It marked every one with `⚠`, also where the line fails every time as written, which the three levels call an error. These now have `ⓧ`, in the panel, the hover, Markdown and the command line's text, and `level: error` in `--format json`:

- `echo $((09))`: below.
- `env -S'"a' s`: env refuses the string, with status 125.
- In a shebang: `#!/usr/bin/env bash -e` (status 127, on Linux: macOS splits the line), `#!/usr/bin/env -S"a` (status 125), `#!/usr/bin/env` (the script starts itself again, without end).

### An invalid number in arithmetic, shell by shell

`$((09))` said "bash stops" wherever it stood. It now says what holds whenever the command runs, in bash, dash and busybox ash, compared with each: "The shell reports an arithmetic error, and this command does not do its work". This holds for `echo $((09))`, `x=$((09))`, `(( 09 ))`, `let x=09`, `for ((i=09;;))`, `cat < $((09))`, `ls /nonexistent 2> $((09))` and a here-document's text. It says nothing of what follows the command, which differs between the shells.

- The mark is about the command: `true || echo $((09))` is an error, since that `echo` fails whenever it runs. It is a warning ("If the shell reads it…") where the same command can run without reading the number: after the parameter in `${x:-…}`, `${x#…}`, `${x/…/…}`, `${x:…}`, after `&&` or `||` in `[[ ]]`, in a later `case` pattern, in the update of a C-style `for`.
- zsh, ksh93 and mksh read a leading 0 as decimal (`$((09))` is 9, `$((010))` is 10), and yash reads `09` as 9: no message, and `010` is not called octal there.
- `base#digits` differs between shells (`1#1` is 49 in mksh, `2#` is 0 in zsh, and dash and yash have none): out of bash, only a good constant up to base 36 is explained.
- Beside an expansion a literal is no constant: `x=1; echo $(( ${x}09 ))` prints 109, and nothing is said of the `09`.

### terraform's options before the subcommand

`terraform -install-autocomplete` and `terraform -uninstall-autocomplete` are in HashiCorp's CLI documentation as commands to run, and were said to stop terraform. They are options now. Any other option there keeps its warning, which says "mostly": terraform is not at hand to compare with, and `terraform -foo -version` may pass.

### What bash expands in an option's attached value

`make -j"$(nproc)"` showed `-j` and its value, and nothing of the `$(nproc)` in it, which bash runs. The value now has its parts, as a separate value has: the substitution and the command `nproc`. So do the long form (`make --jobs=$(nproc)`, `--jobs="$(nproc)"`, `ls --color="$(x)"`), a value that is a separate part only (`sed -i"$x"`, `sort -k$n,$n`), and an option in quotes (`make -"j$(nproc)"`, `make "-j$(nproc)"`, whose value was labelled `j$(nproc)"`).

### A redirection on the closing line of a block

With the cursor on `done < file`, the redirection now says what it says on the loop's first line: that it applies to the whole loop, and how its commands share the input.

### A `then` or a `do` with no `;` before it

`if [ -f a ] then …` says its syntax error once, in the note; its row said it too. "In short" now says "The shell stops with a syntax error (`then` needs a `;` or a newline before it)"; it said `If its condition () succeeds, tests the condition in [ … ]`. So does `for x in a b do …`, which it read as a loop over `a`, `b`, `do` and `c`.

### A command named like a JavaScript method

`printf 'a\n' | valueOf` stopped the explanation with an error, and the command-line tool with it, also with `--check`: the examples' table of text filters was an object, so the word found a method of `Object`. `printf 'a\n' | toString` and `constructor` did not stop it, but their stage ran the method. `awk -v __proto__=1 'BEGIN{print __proto__}'` printed an empty line in its example, where gawk prints `1`. Tables read with a word of the script now have no prototype.

### "In short" and the status of a pipeline

The sentence of a line leaves out what a problem of the line says. It compared the sections of the manual the problems cite, so a problem about one thing of a section left out a clause about another: `cat f | while read -r l; do n=$l; done` (its problem: `n` is set in a subshell, section 3.2.3) lost "its status is that of the `while` loop" (also 3.2.3). It now compares what the problems say: a clause on a pipeline's status is left out for a pipeline without pipefail, one on `set -e` for the problems that say whether `set -e` stops there.

### `2>&1 >o 2>e`

`make 2>&1 >o 2>e` sends stderr to `e`. The note on the order said so in its table, but added that stderr goes to the original stdout. It no longer does.

### A regex that would take too long is not run

`echo "aaa…a!" | grep -E "(a+)+$"` with 30 `a`s did not return: every product runs the examples synchronously, with JavaScript's backtracking matcher, and this pattern takes 2^n steps on n characters. The same went for `sed`, `awk`, `perl`, `[[ =~ ]]`, jq's `test`, for extended globs and globs with many `*` (`[[ $x == +(a|a) ]]`, `${x%%*a*a*a…}`), and for what is typed in the panel's boxes.

Now the regexes of a script run on an engine of our own, which gives what JavaScript gives and counts all it does. Past 10 million steps for one example, 30 to 90 ms measured for each kind of pattern, the example says "Not computed…" / 「結果は計算しない…」 and shows no result: not a match, not a failure, and nothing for the stages after it. The rest of the line is explained as before. No clock is read, so the same text gives the same answer on every machine, and whatever was explained before it. The limit is for each example and each expansion, not for the line yet: a line of many refused patterns takes a limit for each (30 different ones on a line, under 2 s).

- Usual patterns are computed, on fifty lines of 90 characters too: a strict IPv4 pattern, `s/.*from ([0-9.]+).*/\1/`, `.*foo.*bar`, `^(\w+ ?)+$`, and `s/,+/;/g` on a line of 1500 characters.
- A pattern that can take very long still runs on a short text, where it does not: `(a+)+$` on `aaa`. Limits on the text: `(a+)+$` up to about 18 characters, `a*a*b` up to about 2000, `a*b` and `.*foo` over a million.
- Not run at all, as the engine does not read them: a pattern over 2000 characters, inline modifiers (`(?i:a)`), a group name that is not plain, or a name given twice.
- What a match gives counts too, so a process cannot run out of memory: thousands of matches with a thousand empty groups each (`awk -F 'a|()()…'`), `s/.*/&&&&…/` on a long line. Those say the same.
- Making example lines of a pattern is limited too: `grep -E '(ab{1000}){1000}' file` says the same.
- The values the model follows through `case`, `[[ == ]]` and `${x%…}` are "not known" where the pattern is not run, so nothing is said to be decided from them.
- `${x//b/c}`, `${x##*/}` and `${x/#a/b}` find where a match ends with one walk of the pattern, so a long value costs little: a value of 3000 characters takes under 2 ms of the limit, and it was 1.1 s before.

### A line that grows without end, and a failure in one line

Every product runs the examples on its only thread, so what an example costs is now bounded from inside, and a failure stays on its line ([design](../design/line-budget.md)).

- All the examples of a line share one budget, and a long file shares one among its lines, by its size alone, so a line is explained the same in the hover, in the panel and in the command-line tool. 30 refused `grep`s on a line took 1.7 s and take 0.4 s. A file of 5,000 such lines made the problems take over 90 s and takes 7 s: finding problems no longer runs any example.
- What it says: why. "the values this makes may get too large" (`jq -n 'reduce range(28) as $i ("a"; .+.)'`, which ended the process, awk's doubling and `split`), "this takes too many steps, and may never end" (`awk 'BEGIN{while(1);}'`, `jq -n 'def f: f; f'`, which said "pattern" with no pattern), "this may take more than what is left for the examples of this line". Before, a loop too long showed no example and did not say why.
- `x=$x$x` 24 times took over 20 s, and takes 0.3 s: a variable's value past 65,536 characters is not known to the model.
- With `x=aaaaaaaaaaaaaaaaa!`, `[[ $x =~ (a+)+$ ]]` showed its example and said "Not computed" in the panel. The panel's result has its own budget now; where that runs out, the panel shows the example without its input box.
- Nesting that was read twice at each level is read once: `echo ${x:-${x:-…}}` 18 levels deep took 11 s and exited with status 2, and 20 levels took over 45 s; 60 levels take under 100 ms. The same for `x=${x:-…`, `[[ ${x:-…`, `case ${x:-…`, `a > ${x:-…`, `${x:-$(echo …`, `$(echo ${x:-…`, `${x/a/${x/a/…`, `[[ a && a && … ]]` and `||` (20 operands took 5 s, 24 took 80 s; 40 take milliseconds), and `find . -not -not …` (25 levels took 18 s). `bash -c 'bash -c …'` 10 levels deep took over 25 s, and takes about 1 s.
- A huge number: `echo a | cut -f 1000000000`, `sort -k 1000000000` ended the process (out of memory), and `uniq -f 1000000000` took over 90 s. The made-up input is as wide as the command asks, up to 4,096 columns (`cut -f70` shows `f70`); past that, the example says it was not computed. `tr a '[b*999999]'` says it takes too many steps.
- `jq`'s own operations are charged before they run, with what they walk: `-`, `del`, `sort`, `group_by`, `unique`, `paths`, `to_entries`, `flatten`, `implode`, `add`, `.[] = 1`, comparing values, and object and string products (`{a:range(1000),b:range(1000),c:range(1000),d:range(1000)}` ended the process). `[range(90000)]-[range(90000)]` took over 90 s, and takes 10 ms: `-` of simple values uses a set.
- Output of 100,000 rows (`jq -n '[range(99999)]'`, 250,000 lines of a script) overflowed the stack: empty output and status 2, and in the Language Server an error, or the end of the server. The command-line tool also writes each line as it goes, so a long file does not have to fit in one string.
- A text nested deeper than the parser's stack (`echo "$("$(…` 500 deep, `coproc coproc …`, `! ! ! …` 100,000 times) lost every file on the command line, and ended the Language Server. The file now says "This file could not be read" in one line, the other files are read, `--check` reports it as a warning on line 1, in no count of findings, and the status is 2. A line the parser reads but the walk cannot follow says "This line could not be explained: it nests too deep". Neither says "a bug", and neither is logged as one.
- A line nested too deep to walk (`echo $(echo …` 200 levels, which bash runs) says "This line could not be explained", a limit of the tool and no error in the script: a warning on that line, in no count of findings, and the command-line tool exits with status 2, so the Action stops there too. The other lines are explained.
- A statement over several lines takes one walk, for all its lines: 4,000 lines of `\` continuations took 64 s for the problems, and take 0.5 s. Each line still shows the statement whole.
- Limits that remain: a line's own walk grows with its size (about 1 ms a word; one statement over hundreds of lines with a problem on each grows with the square of its lines: `rm \<newline> $a0 \<newline> …` takes 0.4 s at 500 lines and 4 s at 2,000), and the output of the command-line tool holds a statement once for each of its lines. No time or memory limit stands behind them.
- `eval 'a;'`, 100,000 times, made every line of the file say "could not be explained". The lines keep their explanations: nothing is trusted where the scan goes too deep.
- Long commands read their words once: `sed -e … -e …` 400 times took 9 s, and takes 0.3 s. Past 16 commands that each run the next (`sudo sudo sudo …`, `command command …`), the words are read as words, and say that this tool does not read them.
- A regex with `jq`'s own syntax that JavaScript lacks (`test("^(?i)foo")`) lost the whole explanation; it has no example now.
- `jq`'s `range(a; b)` stopped at 1,000 numbers in its example; it counts as jq does.
- A bug that throws while an example is computed drops that example: "Not shown: computing this example failed, a bug of Bash Explainer". One that throws while a line is explained leaves a line that says so, and the other lines are explained. The problems the lines do not say, the colours and the faded code are left out the same way. The bug goes to the "Bash Explainer" output channel in VS Code, to `window/logMessage` in the Language Server, to the console on the web page, and to standard error in `bash-explainer`, which prints what it can and exits with status 2.

### The digits of `printf` and awk

The examples compute the digits of a number from its exact value, as C does, to 10000 digits: a precision or a width past 10000 has no example. A number written with more than 1000 digits, or with a power of ten past 1000 (`1e-300000000`), is not worked out either, and it is said as below. (Without a limit, the powers of ten of such a number took seconds to compute, or threw.) Before, `printf '%.200f' 1` and awk's `%.101f` failed; `%f` of 1e21 gave `1e+21`; `%g` of 999999.5 gave `1000000`, where the tools print `1e+06`; `%d` of 2^70 gave `1.1805916207174113e+21`.

- `printf` of bash and coreutils reads a `long double`, whose size depends on the machine, so `printf '%.20f' 0.1` prints `0.10000000000000000000` on x86-64 and `0.10000000000000000555` where it is a double, and `printf '%.1f' 0.15` is `0.2` or `0.1`. These now have no example, and say why in its place ("The last digit of this number depends on the machine's floating-point type, so no output is shown" / 「この数の最後の桁は、機械の浮動小数点型によって変わるため、出力は示さない」), for the whole example, even when only one number of a format gives it (`printf '%s %.2f\n' a 1.5 b 2.675`); before, they showed the digits of a double. awk and perl print doubles, so their digits are the same on every machine and are shown. Digits that are the same on every machine are shown as before.
- `printf '%f' 010` is 10, not 8: only `%d` and the like read octal. A negative precision from `*` counts as none (`printf '%.*f' -1 3.14`).
- gawk's `+inf` and `-inf` take no width or flags, and `%x` of an infinite number prints them too (in capitals for `%X`, `%E`, `%F` and `%G`: `+INF`); a NaN has no example, as gawk prints its sign. Negative widths and precisions from `*` are read as in C.
- perl's `printf "%s %s\n", "a"` goes on with an empty string (or 0) for the argument it lacks, as perl does (`a `); gawk stops with an error, so awk has no example there. A field past 10000 gives no example in perl either.
- perl prints `Inf` and `NaN` as itself; `printf` with one of them has no example, and `"a" x 9**9**9` is empty.
- jq's `implode` gives U+FFFD for a number out of range, as jq does, and its error for what is no number (`nan` too) or no array. Before, it failed or read `null` as 0.

### awk takes the longest match

POSIX says that a regex matches the longest string at the leftmost place; grep and sed already did so in the examples, and awk now does in `sub`, `gsub`, `match`, `split` and a regex `FS` (or `-F`). `echo cab | awk '{gsub(/c|cab/, "X"); print}'` prints `X` (before: `Xab`), and `match("cab", /c|cab/)` sets `RLENGTH` to 3 (before: 1). `~` and `!~` only tell whether there is a match, so they never differed.

- A regex that splits (`split`, `FS`) separates nothing at an empty match, as gawk does (`-F 'x*'` on `abc` is one field), and a group in it adds no field (`-F '(a|b)'` on `xaybz` is three). An empty separator (`FS = ""`, `-F ''`, `split(s, a, "")`, `split(s, a, //)`) gives every character, and the marks of the fields follow the same split.
- In a string, a backslash before a character awk has no escape for is dropped, as gawk does: `"\&"` is `&` (the matched text in `gsub`), `"\."` is `.`. `"\\&"` is a literal `&` in a replacement, `"\\\\&"` a backslash and the match, `"\\\\\\&"` a backslash and `&`. `\f`, `\v` and `\x41` are escapes too. The value of `-v`, a `name=value` operand and `-F` is read the same way (`-v 'x=a\.b'` is `a.b`), where before an escape such as `\q` gave no example.
- `gsub(/a*/, "X")` on `baaac` gives `XbXcX`: an empty match right after another match is none, as in sed.
- perl stays leftmost-first (`s/c|cab/X/` on `cab` gives `Xab`), as perl does.

### `-F` and the other patterns of grep

The note on a grep pattern that is only a variable said to add `-F` also where grep had other patterns, which `-F` reads as fixed strings too: `grep -E -e "$x" -e 'foo|bar' f` with `-F` no longer matches `foo` lines, and `grep -f pats -e "$x"` reads the lines of `pats` as text. It now says that `-F` applies to every pattern, and offers no quick fix. It spoke of the variable only when it was the first pattern (`grep -e "$x" -e 'a.b'`, not `grep -e 'a.b' -e "$x"`); it does in either order now. Checked with GNU grep (test/rewrites-advice.test.ts).

### The explanation when a line's problems arrive

A line's problems arrive a moment after the line is explained, and they used to draw every row again. A button acts on Space when the key is released, on the element it went down on, so a Space held across that moment did nothing. What was typed in an example's box went, and with it the focus; the focus on a fold button or a link came back, on a new element, which a screen reader can say again. Now only the squiggles of the line change.

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
- `[[ $x == 1 ]]`: a pattern in which nothing acts as a wildcard matches only itself, so the condition says "strings are equal", and the row of `==` at depth 2 says it is a plain comparison. Before, both said "the right side is a glob pattern". Whether a pattern has a wildcard comes from the word model: a quoted `*` is none, a value the script sets is read (`p=1; [[ $x == $p ]]`), and with `shopt -s nocasematch` it stays a pattern (`a` matches `A`). After code the walk does not read (`eval "$c"`, `source ./x.sh`), which may have set nocasematch or changed `p`, it stays a pattern too.
- Depth 2 gives `[[` and `]]` a row ("Start of the conditional expression"), and each operand of `[[ ]]` says what it is to its operator: "The file `-f` tests", "The string on the left of `==`", "A value `-eq` compares: evaluated as an arithmetic expression".
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

### The parser update: unbash 6.0.3

unbash 6.0.2 and 6.0.3 read more of bash's syntax as bash does, and the explanation follows.

- A process substitution after `<<<`: `cat <<<>(f)` passes the text of the process substitution (`/dev/fd/63`) to `cat` as a here-string; `cat` reads nothing else. The explanation shows one here-string redirection, with the substitution as its word. Before, `>(f)` was an argument of `cat`, and the note said that `cat` reads a file and ignores its stdin. The worked example of `sort <<< <(printf 'b\na\n')` shows `/dev/fd/63` as the input and the output, as bash prints (it showed sample lines, sorted); `jq . <<< <(f)` shows the error jq gives for it (it showed a made-up result).
- `${x#)}` in a `$( )` (`a=$(echo ${x#)})`, bash prints the value): the `)` is pattern text. Before, the line said "Syntax error: this part could not be parsed". The same for `<<` in the pattern of an expansion, and in a `$( )` or `<( )` over several lines (`$((1<<2))` there started a heredoc), and for `${x:-<<EOF}`.
- `cat <$''` names the target `$''` (an empty file name; bash says "No such file or directory"). Before, the note said "Read file `` as stdin".
- `<<$'E\0F'`: the heredoc ends at the line `E`, where the delimiter ends at the NUL, as bash reads it. Before, it ran to the end of the file. (The note still words the delimiter as written: roadmap, "Deferred".)

### A backslash in a double-quoted word, or in a plain one

In double quotes bash takes a backslash away only before `$`, a backtick, `"`, `\` and a newline (manual 3.1.2.3); `\1`, `\.`, `\d` and `\n` reach the program as they are. A word with a backslash had no known value for the readers of sed, grep, awk, perl, jq, `tr`, `printf`, `date` and the rest, so it got no breakdown and no example. Now it has the value bash passes, and its parts lie over the source text (the part for `$1` of `awk "{print \$1}"` covers `\$1`).

- Before: `sed "s/\./x/"`, `sed -E "s/(a)/\1/g"`, `sed -E "s#^//([^:]*):#\1/#; s#^/##"`, `grep "a\.b" f`, `grep -E "\.txt$"`, `awk "{print \$1}" f`, `awk "/a\.b/ {print}" f`, `awk -F "\t"`, `perl -pe "s/\d/x/"`, `tr "\n" " "`, `echo -e "a\\nb"` showed the string and nothing in it. Now each reads like the single-quoted line with the same value, with the same worked example.
- Where bash removes a backslash, the argument says so once, with each escape: `grep "a\\.b"` hands grep `a\.b` ("`\\` → `\`"). Where the backslash stays, nothing is added.
- An unquoted backslash is the same: `grep a\.b f` hands grep `a.b` (any character), which the explanation reads and says; `find . -name \*.py` hands find `*.py`, and `awk \$1 f` hands awk `$1`.
- Words with a quote in the middle (`sed 's/a/'"\1"'/'`, `date +"%F\n"`, `git log --pretty=format:"%h\t%s"`, `awk -v OFS="\t"`) are read too, and `--regexp="a\.b"` and `sed --expression="s/\./x/"`.
- `echo -e "\\e"` hands echo `\e`, which `-e` turns into ESC: it is read now. Before, it was left alone.

### A word with an expansion in double quotes

`sed "s/$old/$new/g"`, `grep "$x\.log" f`, `find . -name "$p*.txt"`, `date +"%F $x"` are read as the command reads them, with each expansion as a piece whose value is not known. The expansion's own row stays what it was, under the row of what the command makes of it. No worked example: it would need a value made up.

- In a regex (`grep`, sed's pattern and `/address/`, awk's `/…/`, perl's `s///` and `/…/`) the value is read as a regex: `.`, `*`, `[` have their meaning. A delimiter in the value ends the part early (`/` in `s/$old/…/`, `|` in `s|$k|…|`), and so does a newline, except in perl. What stands after the value, or a group or an anchor before it, is read as if the value were a complete regex with no group, no alternation (`|`) and, in `grep`, no newline of its own: with `a='a|c'`, `grep -E "^$a"` also matches `b/c`, and the row says what it assumes. `$x*` repeats the last item of the value, not the whole value. `[$x]` adds the value's characters to the set.
- In a replacement of sed, `&` and `\` of the value are special, and a delimiter or a newline ends it; in perl's, `$`, `@` and `\`. Before a value, sed's `\U`, `\u`, `\L`, `\l` and PCRE's `\d` are read as they are; an escape that takes characters of the value is not (`\x4$n`, `\d06$n`, `\1$n` in PCRE). In the text of `a`, `i`, `c` a newline of the value ends the text. A value alone where sed takes an address (`sed -n "${n}p"`) is said to be one, and that another value makes another command; `1,5` is named only where the value is the whole address, not beside a comma (`sed "1,${n}d"` with `n=1,2` fails).
- In find's patterns, `*`, `?` and `[` of the value are wildcards, and `\` makes the next character plain: with `x='a\'`, `find . -name "$x*"` matches only the name `a*`. In `date`'s and `printf`'s formats, `%` is a conversion, and what follows the value is read as if it held none (`date +"$x%F"` with `x=%` prints `%F`); in `printf`'s, `\` is an escape too. With `echo -e`, `\` is an escape; in `tr`'s sets, `a-z` and `[:upper:]` work. In an awk string, `"` and a newline end the string.
- A first operand that starts with the expansion and goes on says that a value starting with `-` is an option, for a command that reads such a word so: `grep "$x\.log" f`, the builtin `printf "$f\n"`. Not `echo -e "$a\n"` and `env printf "$a\n"`, where a word is an option only if each of its letters is one. A word that is only the expansion (`tr "$a" z`, `find . -name "$p"`) says it on the word's row, beside bash's `$x`; a regex that is only the expansion (`grep "$x" f`) stays as it was, with the caveat on what its value does.
- Each risk is said once on a line, by the first expansion of its kind: a later one has a short row (`The value of $c, read like $a`), and a part with only an expansion in it, as `s/$a/`, has one row with what it says. `sed "s/$a/$b/;s/$c/$d/"` has 21 rows, not 25.
- Where the value decides what the command is, the word stays unread, with one note: `sed "$x"`, `sed "s/a/b/$flags"`, `sed "y/$a/b/"`, `awk "$prog"`, `awk "{print \$$n}"`, `awk "BEGIN { x = $n }"`, `jq ".$key"`, `perl -e "$a; print"`: "What this script does depends on the value of `$x`", with `awk -v` and `jq --arg` as the way to pass a value as data.
- Without a note, as before: a word that gives one word per element (`"$@"`, `"${a[@]}"`; `"$*"` and `"${a[*]}"` give one, and are read), an unquoted expansion (`sed s/$a/b/`), a backslash just before the expansion (`"\\$x"`), a hole in a count (`a{$n}`), a class (`[[:$c:]]`), `\Q$x\E`, or a conversion (`%$x`). Also not read: `--regexp="$x"`, `-e"s/$a/b/"`, and git's formats.

### Also fixed on the way

- `find . -name 'a?(b)'` said "extended glob". find has none: it looks for `a`, one character, `(b)`.
- A script that holds a noncharacter of U+FDD2 to U+FDEF shows it as U+FFFD, as U+FDD0 and U+FDD1 already did.
