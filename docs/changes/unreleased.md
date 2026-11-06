# Unreleased changes, in detail

The short list is in [CHANGELOG.md](../../CHANGELOG.md#unreleased).

## New

### The hint toward POSIX sh

- **When.** The web page shows it for a script whose shell is bash from `#!/usr/bin/env bash` or from no shebang. Not for `#!/bin/bash` (it says bash on purpose), a ShellCheck directive, a file name that says bash, a shell chosen in the chip, a bats file or another file with shell code in it, and not in VS Code (its panel shows the quiet "not portable to sh" marks).
- **What.** One line after the list, or after "No problems": how many constructs of the script POSIX sh lacks or runs differently ("2 constructs not in POSIX sh"; the dialect issues for sh, with the codes and comments you turned off left out), and a button **Check as POSIX sh** that makes the choice the chip's popover makes. Choose Auto in the chip to go back. The line stays when the list is folded. On a phone it is the last line of the Problems tab.
- **What the number is not.** It is not the length of the list after the button. The list of a sh script also has the notes sh's explanations add (`globstar-unsupported`…), and the notes the list already has for bash. For the web page's sample, the list shows 13 problems as bash, the line says 36 constructs, and the list as sh has 50.
- **Not a problem.** The Problems counts, the list, the squiggles, `--check` and the Action do not include it.

## Changed

### The hover card and the Legend

- **The card on the web page.** The pointer that rests where you clicked opens no card: the click already shows the line in the panel. A pointer that moves on to another part of the script opens its card as before, and so does one that comes back to the part later. The card closes on a click, a paste, typing, and Escape, wherever the focus is (the editor, the page, the panel). Before, a click on line 1 could leave a card of 500 px over the lines below, and a click on one of them failed.
- **The Legend.** It opens under its button over the explanation, as wide as the panel and no higher than the room below it (it scrolls inside), and the explanation under it stays where it is. Escape closes it and the focus goes back to its button; so does a click outside it, the focus leaving the panel (a click in the editor), and a new line. Before, it opened in the flow of the panel, up to 400 px high, and stayed open on the next line. On a line with nothing to explain there is no Legend button; before, an open Legend drew an empty box.

### How sh fails, in the note on a bash-only form

In a `sh`, `dash` or `ash` script, a bash-only form that fails with a status, a syntax error or a stop of the shell says how. Each sentence was measured in dash 0.5.12 and busybox 1.36 ash, and a test (`test/dialect-dash.test.ts`) runs them in both. Where the two differ, the note names the shell. Before, it said "it fails in dash and busybox ash".

| Form | In dash and busybox ash |
|---|---|
| `[[ -f x ]]` (dash only; busybox ash has it) | `[[` is run as a command: "not found", status 127. In an `if`, the condition is false. With an unquoted `(` or `)` in it (`[[ $1 =~ ^(yes\|y)$ ]]`, `[[ ( a = b ) ]]`, `[[ a == *(b) ]]`), a syntax error, status 2, as the shell reads the line. |
| `a=(1 2)`, `cat <<< x`, `echo a \|& cat`, `for ((;;))`, `select`, `;&`, `@(a\|b)`; dash only: `<(cmd)` | A syntax error, status 2: the shell stops as it reads the line, even where the line would never run. The lines before it have run. |
| dash only: `function f { …; }` | `function` is a command name: "not found", status 127, and the `}` or `()` after it is a syntax error, status 2. The shell stops at the syntax error, or sooner under `set -e`; at the top level the lines before it, even the body, may have run. |
| `${x^^}`, `${!x}`, `${x@Q}`, `${a[-1]}`, `${ cmd; }`; dash only: `${x/a/b}`, `${x:1}` | "bad substitution", status 2, and the shell stops there. In `$( )`, `( )` or a stage of a pipeline, only that subshell stops, and the script goes on unless `set -e` stops it (`y=$(echo "${x^^}"); echo $?` prints 2; under `set -e` the script stops); the same for `export -f`, `set -o pipefail` and an unset variable that stops a subshell. |
| `(( i++ ))`, `if (( x > 0 ))` | Two nested subshells, and the text inside runs as a command: "not found", status 127. A `>` in it redirects: `(( x > 0 ))` creates a file `0`. The condition is false. |
| `declare`, `typeset`, `shopt`, `pushd`, `coproc`, `mapfile`, `print`, `whence`; `source` and `let` in dash | "not found", status 127. |
| `a+=2` | `a+=2` is taken for a command name: "not found", status 127. |
| `read -a`; dash: `read -n`, `-s`, `-t`, `-d`, `wait -n`, `printf -v` | The builtin rejects the option: "illegal option", status 2. |
| `export -f`; dash: `set -o pipefail` | "illegal option", status 2, and the shell stops (a special builtin). |
| `printf %q` | dash: status 2; busybox ash: status 1. |
| `>/dev/tcp/host/port` | The redirection fails, as there is no `/dev/tcp` directory: dash status 2; busybox ash status 1. At a special builtin (`exec 3<>/dev/tcp/host/port`, `: </dev/tcp/host/port`) the shell stops there, and nothing after it runs. |
| dash: `[ a == b ]` | `[` reports "unexpected operator", status 2: the test is false. |
| dash: `type -t ls` | `-t` is taken for a name: `-t: not found`, status 127. |
| dash: `trap … ERR` | "bad trap", status 1. |
| dash: `$'a\'b'` | A syntax error, status 2, unless a later `'` in the script closes the string. |

When a note names one shell (the script is for `dash` or `ash`), the sentence does not name the shell again.

### `=~` in sh

There is no rewrite that fits every regex, so the note names three ways and their limits:

- `case` takes a glob pattern only. `^[0-9]+$` has no glob, but its negation is `''|*[!0-9]*`: `case $s in ''|*[!0-9]*) echo no;; *) echo yes;; esac`.
- `expr "$s" : '[0-9][0-9]*$'` takes a basic regex and matches it from the start of the string, so `a12` does not match `[0-9]`, where `[[ a12 =~ [0-9] ]]` does.
- `printf '%s\n' "$s" | grep -Eq '^[0-9]+$'` takes an extended regex.

The test compares the three with `[[ =~ ]]` on the same strings, in dash and in busybox ash.

### The fix in the box of a line's problems is the whole line

In the panel, in VS Code and on the web page, a problem with a fix shows it under its headline, no longer under **More**: the line with the fix made, the part the fix changed marked, and a button **Copy fix** / 「修正をコピー」 that copies the whole line. A fix over several lines shows them all (a statement continued with `\`, a loop whose body gets a line).

- `tar -czf "$backup" ~/docs 2>/dev/null || echo "failed" >&2` shows `tar -czf "$backup" ~/docs 2>/dev/null || { echo "failed" >&2; exit 1; }`, with `{ echo "failed" >&2; exit 1; }` marked. Before, the box showed and copied only `{ echo "failed" >&2; exit 1; }`, the right side of `||`.
- In a file with no shebang, which may be run or sourced, the fix ends with `return 1 2>/dev/null || exit 1`, as before, and now says why: "`return` if sourced, `exit` if run".
- `cp $a b; cp $a c` gives one fix for both places: `cp "$a" b; cp "$a" c`.
- A long fix wraps between words, and the blank before a word moves to the next row with it. Before, a wrap could hide the blank (`2>/dev/null|| exit`).

The quick fixes in the editors do not change. The note's own text still names the part to write.

### Bash's steps at depth 1, and the glob's example

In the panel, in VS Code and on the web page:

- At depth 1, a word that a step of bash changes shows the steps in one line, as depth 2 does: `"$USER"` says "bash's steps: parameter expansion → no word splitting or globbing (quoted) → quote removal", `~/docs` "tilde expansion", `$a` "parameter expansion → word splitting → globbing", `*.txt` "globbing". A word no step changes (`plain`, `"q"`) shows nothing more; at depth 2 its steps still fold to one line. A word that had a row only at depth 2 has one at depth 1 when a step changes it: an operand of `[`, `[[` or `case` (`[ -f "$f" ]`), a redirection's target (`> $out`, `<<< "$name"`), an element of an array (`arr=(*.txt)`). Before, the steps were only at depth 2.
- The pieces of a pattern that the parser splits each show the steps that act on that piece: in `[[ ":$PATH:" = *":$d:"* ]]`, `":$d:"` shows parameter expansion and quote removal, and each `*` shows none. Before, at depth 2, each `*` showed the whole word's steps ("parameter expansion → … → quote removal").
- The example of a glob's names ("Example for … (glob /var/log/*.log)") starts open when it is the line's only example, or when the cursor is on its command (`grep … /var/log/*.log | sort`: open with the cursor on `grep …`, closed on `sort`; in `if ls *.txt; then ls *.md; fi`, the one of the `ls` the cursor is on). An example you open or close stays so on that line. Before, it always started closed.
- Names typed in the example stay, with their result, when the depth changes and when the cursor moves on the same line. Before, a redraw put back the example's own names.

### The Copy buttons say what they copy

The web page's panel header says **Copy as Markdown** / 「Markdown でコピー」 beside its icon, and **Markdown** under it where the header is narrow. Before, it said **Copy**, like the fix's button. **Copy a link** does not change.

### The depths' names, and the headline's word

In the panel, in VS Code and on the web page (docs/design/usability-9.md, Q1 and 2.6):

- The depth control shows **Overview** and **Word by word** (「概要」「単語ごと」), both names at once; where the header is narrow, a menu whose button says the depth shown ("Overview ⌄"). Before, it showed "Depth [1 Does] [2]" at depth 1 and "Depth [1] [2 Reads]" at depth 2, and its menu "Depth 1 ⌄".
- Each name's tooltip says the full name and the key: "What it does (key 1 in the panel)", "How bash reads it, word by word (key 2 in the panel)" (「何をするか（パネルの中ではキー 1）」, 「bash が単語ごとにどう読むか（パネルの中ではキー 2）」). The keys 1 and 2 still work only with the focus in the panel; in the editor they type the digits, as before. A screen reader hears each option by the name it shows, and the depth chosen as "Depth: Overview (What it does)".
- A problem's headline starts with the note's own label, as the Problems list starts its text: "Portability" for `echo -e` in a sh script, a warning. Before, the headline said "Pitfall" there, the word of the warning level. A note whose text names no word ("In `[[ =~ ]]`, an unquoted `\d` loses its backslash") keeps its level's word, "Error".

### A new script on the web page

Clear, a whole script pasted into an empty editor or over the sample, and Open start a new script (docs/design/usability-9.md, Q8). The depth stays.

- **Clear** empties the editor and makes the script an untitled shell script, with the shell back to Auto: "Sample cleared. File type set to Shell script. Shell set back to Auto." Undo brings back the text, the file it was (its name, where Save writes), its file type and the shell. Before, a file opened stayed the file, with its type: test.bats cleared, then a script pasted, was still "test.bats ●", a bats file.
- **A paste** into an empty editor or over the sample takes its file type from the text, a shell script when nothing in it says another, names the script untitled, and puts the shell back to Auto: "Detected: Dockerfile. Shell set back to Auto.", or "File type set to Shell script." after the bats sample. Undo puts back the file type, the file and the shell; the text stays as pasted. A paste into your own script changes the file type only when it is most of the text and says another type, as before, and resets nothing else.
- **Open** takes the file's name and type, as before, and puts the shell back to Auto: "Opened test.bats. Shell set back to Auto." Undo chooses the shell again.
- A toast says nothing of what did not change: with the shell at Auto, Clear says "Editor cleared", and an empty untitled shell script at Auto stays as it is.

## Fixed

### The cases of a test's example

The example of a simple test ("True when", "False when") now reads the test's words with each value as bash does, from the word model, and evaluates the test as bash's `test` does, or matches the pattern as `[[ == ]]` does:

- Unquoted in `[ ]` or `test`, a value is split and globbed, and an empty one is no word: `[ $x = "" ]` is `[ = "" ]` for `x=""` ("unary operator expected"), and `[ $x = "a b" ]` and `[ $x = a\ b ]` are never true, as `x="a b"` gives `[: too many arguments` (status 2). A new section, "Error (status 2) when" (「エラーになる値（終了ステータス 2）」), lists one such value: `[ $x = y ]` shows `x=""`, `[ -n $x ]` shows `x="a b"`, and the script's own value when it fails (`x="a b"` or `x=` before `[ $x = y ]`). Before, the example said "True when `x=""`" and "True when `x="a b"`", and kept its samples after such a value of the script.
- On the right of `[[ = ]]`, `==` or `!=`, an unquoted value is a pattern: `[[ a\\b = $x ]]` is true for `x='a\\b'` and false for `x='a\b'`, and `[[ "[ab]" == $x ]]` is true for `x='\[ab\]'`. Before, the example said "True when" the value was the text of the left side.
- The script's own value is placed by what bash does with it: `x='a*'; [[ abc == $x ]]` shows `x="a*"` under "True when", `n=010; [ "$n" -gt 2 ]` shows `n="010"` (10 for `test`), and `x=abc; [ "$x" -eq 3 ]` shows `x="abc"` under "Error (status 2) when". Before, those kept the samples.

### Values before a `source`

A script that runs what the explainer does not read (`source lib.sh`, `eval "$(cmd)"`, a command named by a variable that may be a function) may change any variable from there on. Since 0.10.0 the explainer took no value of the script anywhere in such a script. Now the lines before the first statement that does it keep the values: bash runs the statements of the top level in turn, so `msg="hello world"` then `echo "$msg" | tr a-z A-Z` shows `HELLO WORLD` again, and `rm -rf $catdir` after `catdir=/tmp/cat` is a Caveat that says the value stays one argument, not a Pitfall. A function body (which may run at a later call), a loop or a group that holds that statement, and a script with CR LF line ends keep no value, as before.

### Makefile recipe lines that make runs without a shell

GNU make runs a recipe line directly as a program, with no shell, when the line (after make has expanded its variables) holds none of the characters `#;"*?[]&|<>(){}$`^~!` outside single quotes (a backslash escapes one) and its first word is not one of make's list of shell builtins (`cd`, `export`, `test`, `if`, `read`, `set`, `trap`…, but not `echo`, `printf`, `true`, `source`). The explanation follows make's rule, measured with GNU make 4.3 (`test/make-real.test.ts` runs it against the real make, as a separate program):

- `@echo -e '\033[32mOK\033[0m'` is the program `/bin/echo` (from coreutils), which reads `-e`: the line is "no shell" in the chip, `echo` is "program" (not "builtin"), and the warning about dash's `echo -e` is gone. `echo -e x;` goes through `/bin/sh`: dash's builtin, and the warning stays. Before, both lines were dash's builtin.
- `echo a\\tb` passes `a\tb` to `/bin/echo`, which prints it as it is; through dash it would print a tab.
- The line says it in a note, with the way to the other reading: adding a `;`, a `"`, a `$` or a `|` sends the line through `/bin/sh`.
- A line with a make variable (`echo $(NAME)`) is decided by the variable's value: the note says so where the first word is a builtin's name (`echo`, `printf`, `true`). The automatic variables (`$@`, `$<`, `$^`, `$?`, `$*`) are taken as file names with no shell characters.
- Not on the line, whatever the other rules say: `SHELL` set to anything but `/bin/sh` or `.SHELLFLAGS` to anything but `-c` or `-ec` (so `-eu -c`, `-xc` and `-euc` count; anywhere in the file, in a rule too), an `IFS` set in the makefile, and a rule of several lines under `.ONESHELL`. The lines are explained as before there. A rule of one line under `.ONESHELL` is run like any other.
- A line continued with a backslash is read as make joins it: a single quote keeps the backslash and the newline, anywhere else they vanish.
- The first word of such a line is a program, never a keyword of bash: `time make` runs `/usr/bin/time`, and `until false` runs a program named `until` (make says it is not found). Docker's exec form reads its first word the same way.
- An unquoted `$@` or `$<` in such a line is not advised to be quoted (the pitfall about splitting and globbing): no shell reads it, and `"$@"` would send the line through one. Its note says "expanded by make before the line runs", not "before the shell runs".

### `xargs` options that cancel each other

`-n`, `-L`/`-l` and `-I`/`-i` do not combine; GNU xargs (findutils 4.9) keeps one. The explainer reads them in order, as xargs does, marks the ignored option on its row ("Ignored: the later `-I` takes over"), and the worked example follows the one in effect:

- A later option wins and the earlier one is ignored, with a warning on stderr: `-n1 -I{}` and `-L1 -I{}` run once per line, replacing `{}` (xargs: "options --max-args and --replace/-I/-i are mutually exclusive, ignoring previous --max-args value"); `-I{} -L1` runs `echo {} a b` (the replacement is not done; before, the example showed it done); `-n1 -L1` takes `-L` and `-L1 -n1` takes `-n`, so the second runs `echo X a`, `echo X b`… (before, the example showed `echo X a b`).
- `-I{} -n1` warns nothing and changes nothing (`-I` already runs one argument per command): no row is marked. Any other count after `-I` wins: `-I{} -n2` runs `echo X {} a b` (the replacement is dropped; xargs: "options --replace and --max-args/-n are mutually exclusive, ignoring previous --replace value"), and the row of `-I` says it is ignored. Before, the row of `-n2` was not marked and the example replaced `{}`.
- `-I{} -n1 -L1` takes `-L`.

### The `{}` of `find -exec`

The placeholder of `find -exec`, `-execdir`, `-ok` and `-okdir` is the word whose value is `{}`: also quoted or escaped (`'{}'`, `"{}"`, `\{\}`), as `find`'s manual writes it. `find` replaces it with each path before it runs the command, so:

- **Depth 2.** The role line reads "argument → placeholder for the path" (「プレースホルダー（パスに置き換わる）」), and the second name opens to "find reads it, not bash". Before, for `find . -exec rm {} \;` it read "argument → operand" and "rm reads it", as if `rm` got the word `{}`. This holds with `sudo` or `env` in between, and the other words of the command (`-f`, `644`) stay read by that command. Before, a quoted or escaped `{}` was an operand of `rm`, and `\{\}` had no note that `find` replaces it.
- **`$1` of `sh -c`.** In `find . -exec sh -c 'echo "$1"' _ {} \;`, the row of `$1` says "`-exec` passes the path it found in place of `{}`" (and `$0`, when `{}` directly follows the string, that `-exec` replaces it). Before, it said "it starts as `{}`", which is false.
- Not covered: `{}` inside a longer word (`{}.bak`, which GNU `find` also replaces), and the replace string of `xargs -I{} rm {}`, which can be any text.
