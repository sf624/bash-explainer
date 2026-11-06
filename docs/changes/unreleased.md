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
