# Unreleased changes, in detail

The short list is in [CHANGELOG.md](../../CHANGELOG.md#unreleased).

## New

### A placeholder pasted into a shell string

`find -exec` (and `-execdir`, `-ok`, `-okdir`) replaces `{}` inside a word, and `xargs -I` replaces its text anywhere in a word, before the command runs. When that word is a string a shell reads as code (`sh -c`, `bash -c`, the remote command of `ssh`), the path or the item becomes code: `printf 'a;echo pwn\n' | xargs -I{} sh -c 'echo {}'` prints `a`, then `pwn`. ShellCheck calls this SC2156.

- **The warning.** "⚠ Shell injection risk: `-I` pastes the input item in place of `{}` in the command string before the shell reads it, so an item with `;`, `$(…)` or a quote in it (such as `x;rm -rf ~`) runs as code. Pass it as an argument of the shell, which gets it as data: `sh -c '… "$1" …' _ {}`" (「⚠ シェルインジェクションの危険: `-I` が入力の1件をコマンド文字列の中の `{}` に埋め込んでから、シェルがその文字列を読みます。…」). For `find` it says "the path it found" and "a file name". It is a warning: code that nobody chose runs, with some names (docs/design/three-levels.md, question 2). The fix names the shell of the line (`bash -c` for `bash -c`) and the text (`%` for `-I%`); `ssh host 'cat {}'` gets no fix, as ssh passes no arguments after the string. It is said once for the string, also where the string is not explained as a script (`x=1; xargs -I{} sh -c "echo {} $x"`). There is no **Copy fix**: rewriting the string needs its quotes and its other `$1`, `$2`… read again.
- **Inside the string.** The part where the text stands keeps what it is to the command there, and adds that the tool puts the path or item there first: `{}` of `sh -c 'wc -l {}'` is "target file. `-exec` puts the path that was found here before the shell reads the string (explained here as a name with no blanks or special characters)". At depth 2 it reads "placeholder for the path" (or "for the input item"). A part that holds the text among other text (`{}.bak`) says "in place of `{}` in it". Before, `{}` was read as a plain word, "text to print", with nothing more.
- **Silent.** `sh -c 'echo "$1"' _ {}` (the shell gets the path as `$1`), `find . -exec echo {} \;` and `xargs -I{} echo {}` (no shell reads it), `xargs -I{} sh -c {}` (the item is the whole string, run as a command on purpose), and `find . -exec sh -c 'echo {}' +`, which find refuses (the error already says so).

### The hint toward POSIX sh

- **When.** The web page shows it for a script whose shell is bash from `#!/usr/bin/env bash` or from no shebang. Not for `#!/bin/bash` (it says bash on purpose), a ShellCheck directive, a file name that says bash, a shell chosen in the chip, a bats file or another file with shell code in it, and not in VS Code (its panel shows the quiet "not portable to sh" marks).
- **What.** One line after the list, or after "No problems": how many constructs of the script POSIX sh lacks or runs differently ("2 constructs not in POSIX sh"; the dialect issues for sh, with the codes and comments you turned off left out), and a button **Check as POSIX sh** that makes the choice the chip's popover makes. Choose Auto in the chip to go back. The line stays when the list is folded. On a phone it is the last line of the Problems tab.
- **What the number is not.** It is not the length of the list after the button. The list of a sh script also has the notes sh's explanations add (`globstar-unsupported`…), and the notes the list already has for bash. For the web page's sample, the list shows 13 problems as bash, the line says 36 constructs, and the list as sh has 50.
- **Not a problem.** The Problems counts, the list, the squiggles, `--check` and the Action do not include it.

## Changed

### The hover card and the Legend

- **The card on the web page.** The pointer that rests where you clicked opens no card: the click already shows the line in the panel. A pointer that moves on to another part of the script opens its card as before, and so does one that comes back to the part later. The card closes on a click, a paste, typing, and Escape, wherever the focus is (the editor, the page, the panel). Before, a click on line 1 could leave a card of 500 px over the lines below, and a click on one of them failed.
- **The Legend.** It opens under its button over the explanation, as wide as the panel and no higher than the room below it (it scrolls inside), and the explanation under it stays where it is. Escape closes it and the focus goes back to its button; so does a click outside it, the focus leaving the panel (a click in the editor), and a new line. Before, it opened in the flow of the panel, up to 400 px high, and stayed open on the next line. On a line with nothing to explain there is no Legend button; before, an open Legend drew an empty box.

### A pipeline sample with distinct lines

- **What.** When a stage after the first is `uniq` or `sort -u`, the made-up input has the duplicates it needs.
  - A `sed` that has one line to show also gets a second line that its pattern matches and whose output differs from the first line's (`cde=za` beside `a=x`; for `s/a/b/`, `abc a xyz` beside `a a`). If no such line exists (`s/.*/x/`, `s/[0-9]+/N/g`), or the sample already has 8 lines, the sample is as it was.
  - The copies that make duplicates are copies of both, and the copies of a line follow each other, so `uniq` alone collapses them too. This holds for every source (grep, awk, cut, sed…).
- **Before.** `sed -E 's/^([a-z]+)=(.*)$/\2=\1/' conf.txt | sort -u` read `a=x` four times and printed `x=a` four times. The sample of `sed 's/a/b/' f | uniq` was `a a` four times.
- **After.** Input `a=x`, `cde=za`, `cde=za`, `a=x`, `a=x`; after the sed `x=a`, `za=cde`, `za=cde`, `x=a`, `x=a`; after `sort -u` `x=a`, `za=cde`.
- **Other sources.** `awk '{print $1}' log | uniq -c` shows `2 grape`, `2 apple` where it showed `1 grape`, `1 apple`, `1 grape`, `1 apple` (the copies were apart, so `uniq` collapsed nothing).
- **Not changed.** The sample of `sed` on its own (the README's `a=x` -> `x=a`), and the samples of awk, perl and grep, which already have several lines.

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

Clear, a whole script pasted over the untouched sample, and Open start a new script (docs/design/usability-9.md, Q8). The depth stays.

- **Clear** empties the editor and makes the script an untitled shell script, with the shell back to Auto: "Sample cleared. File type set to Shell script. Shell set back to Auto." Ctrl+Z, or the toast's Undo, brings back the text, the file it was (its name, where Save writes), its file type and the shell; Ctrl+Shift+Z clears again. A file changed since it was opened is asked about first, as **Load the sample** asks ("Discard and clear"). Before, a file opened stayed the file, with its type: test.bats cleared, then a script pasted, was still "test.bats ●", a bats file.
- **A paste** that replaces the whole of the untouched sample, with no file open, takes its file type from the text, a shell script when nothing in it says another, names the script untitled, and puts the shell back to Auto: "Detected: Dockerfile. Shell set back to Auto.", or "File type set to Shell script." over the bats sample. Undo puts back the file type and the shell, the text as pasted; Ctrl+Z takes back the paste and its reset together. Any other paste resets nothing, as before: a line added to the sample, a paste into an editor that Clear emptied (a shell chosen since stays), a paste into a file open, and a paste into your own script, which changes the file type only when it is most of the text and says another type.
- **Open** takes the file's name and type, as before, and puts the shell back to Auto: "Opened test.bats. Shell set back to Auto." Undo chooses the shell again.
- A toast says nothing of what did not change: with the shell at Auto, Clear says "Editor cleared", and an empty untitled shell script at Auto stays as it is.

## Fixed

### A blank, or a value with a space at both ends, shown visibly

A value made only of spaces and tabs looks empty in a code span, so the explanation names it. One function, `codeShown` in `src/messages-values.ts` (beside `shownWord`), writes the code with `codeSpan` and, for a blank, its name in parentheses after it: "a space", "2 spaces", "a tab" (Japanese "空白", "空白2文字", "タブ"); a tab in the code is `⇥`. The names come from one table (`blankWord`), which the `IFS` note, the `tr` sets and the label of the space mark read too; Japanese says 空白 everywhere (before, `tr` said スペース). The sites that quote a value call it: the sentences of `${…}`, its pattern, replacement and default tokens, the child token of a glob pattern, the subject of a regex quantifier, the option value after quote removal, and the `s` command of sed and perl. A new reader of a value should call it too; a few places still write the code by hand (see `docs/backlog-archive.md`, "A blank in a value").

- **Both ends.** A value that starts and ends with a space (`${x//,/ - }`, `sed 's/,/ | /g'`) is written with one more space on each side inside the span, since CommonMark takes one off each end (`codeSpan`). Before, it showed as `-`.
- **Empty.** An empty pattern is said in words: ``${a[@]/#/ }`` is "Replace an empty string at the start of `a[@]` with ` ` (a space)". Before, it was an empty span, two backticks. An empty replacement keeps its own text ("Delete every match of …").
- **One parenthesis.** The name and a remark join: ``Pattern ` ` (a space; no wildcards, so it matches exactly this text)``, ``Replacement ` ` (a space; `$1`… are the groups)``.

| Where | Before | After |
|---|---|---|
| `${x//:/ }`, its sentence and the replacement token | ``Replace every match of `:` in `x` with ` ` ``; ``Replacement ` ` `` | ``… with ` ` (a space)``; ``Replacement ` ` (a space)`` |
| `${x//,/ - }` | ``Replacement ` - ` `` (shown as `-`) | ``Replacement `  -  ` `` (shown as ` - `) |
| `${x:- }` (and `-`, `:=`, `:+`…) | ``Default ` `: used instead of `x` `` | ``Default ` ` (a space): …`` |
| `${x// /_}`: the pattern, and its child token | ``Pattern ` ` (no wildcards, …)``; ``The text ` ` itself`` | ``Pattern ` ` (a space; no wildcards, …)``; ``The text ` ` (a space) itself`` |
| `${a[@]/#/ }` | ``Replace `` at the start of …`` | ``Replace an empty string at the start of …`` |
| `sed 's/  */ /g'`, `sed -E 's/ +/ /g'`, `grep -E '^ +'` | ``repeat ` ` zero or more times`` | ``repeat ` ` (a space) zero or more times`` |
| `cut -d' '`, `awk -F' '`, `paste -d' '`, `sort -t' '` | ``Value for `-d` (` ` after quote removal)`` | ``Value for `-d` (a space after quote removal)`` |
| `sed 's/,/ /g'`, `perl -pe 's/,/ /g'`: the sentence, the pattern and the replacement | ``… with ` ` `` | ``… with ` ` (a space)`` |
| `tr ' ' _`, `[:blank:]` (Japanese) | スペース | 空白 |

### The phone's header row

On a phone held upright (a sheet's row under 600 px), the explanation's header has the tabs and the depth's control only, in every language: whether Collapse and Markdown fit no longer depends on how wide the words are. Copy as Markdown is in the menu (☰), and Collapse is left out, as in English before. A row where the depth's control or a tool would lie over the grab bar takes the next, narrower form. The depth's menu button and its segments are drawn 32 px high, as the file type's chip, each in a 44 px target, and on hover too. The ends of those pills, and of the chip, are half circles, as Read | Edit's are; in forced colours each has a thin edge, and the option shown the system's selection colour. Each segment's label, the depth's and Read | Edit's, is centred between the pill's edge and the divider (「概要」 was 4 px from the edge and 13 px from the divider). Before, in Japanese at 430 px and wider with an empty editor, the row took Collapse and Markdown, and the depth's menu (「単語ごと ▾」, 42 px high) lay over the grab bar; the chip's ends were 22 px across and 16 px down, and a mouse over the menu drew it 44 px high with grey bands.

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

### The `{}` of `find -exec` and the replace string of `xargs -I`

The placeholder of `find -exec`, `-execdir`, `-ok` and `-okdir` is the word whose value is `{}`: also quoted or escaped (`'{}'`, `"{}"`, `\{\}`), as `find`'s manual writes it. `find` replaces it with each path before it runs the command, so:

- **Depth 2.** The role line reads "argument → placeholder for the path" (「プレースホルダー（パスに置き換わる）」), and the second name opens to "find reads it, not bash". Before, for `find . -exec rm {} \;` it read "argument → operand" and "rm reads it", as if `rm` got the word `{}`. This holds with `sudo` or `env` in between, and the other words of the command (`-f`, `644`) stay read by that command. Before, a quoted or escaped `{}` was an operand of `rm`, and `\{\}` had no note that `find` replaces it.
- **`$1` of `sh -c`.** In `find . -exec sh -c 'echo "$1"' _ {} \;`, the row of `$1` says "`-exec` passes the path it found in place of `{}`" (and `$0`, when `{}` directly follows the string, that `-exec` replaces it). Before, it said "it starts as `{}`", which is false.
- **Inside a longer word.** `find` replaces `{}` also in `{}.bak` and in `sh -c 'echo {}'` (before `;`; with `+` only a lone `{}` before it is replaced). The word keeps its own explanation, and gets "`-exec` replaces `{}` in it with the path that was found before it runs the command". A word that is `{}` alone keeps its own explanation too, and gets "`-exec` replaces it with the path that was found before it runs the command". Before, nothing said so. For `find . -exec sh -c 'echo {}' \;` this is the place where a file name becomes shell code.
- **`xargs -I`.** The replace string is the value of `-I` (`-I{}`, `-I %`) or of `-i` (default `{}`; `--replace=@`), any text; the last one given is in effect. It is replaced in the arguments of the command, not in its name (GNU xargs runs `xargs -I% % x` as the program `%`), with the input item: a line, or what `-0` or `-d` ends (which may hold a newline). At depth 2, a word that is that text alone reads "placeholder for the input item" (「プレースホルダー（入力の1件に置き換わる）」). At depth 1 every word keeps what it is to the command that gets it (`{}` of `cp {} dest/` is still the source) and the row adds "`-I` replaces it with the input item before it runs the command"; a word that holds the text (`%.bak`) gets "`-I` replaces `%` in it with the input item before it runs the command". Quoted forms (`'%'`, `\%`) count as the text. `$1` of `xargs -I% sh -c '…' _ %` is "the input item in place of `%`". Before, `{}` was "source" with nothing more at depth 1 and "operand · cp reads it" at depth 2, and `%.bak` was an operand with no note.
- With `-I{} -n2`, `-I{} -L1` the replace string is not in effect (the option is marked as ignored), so `{}` is an ordinary operand again; `-I{} -n1` keeps it.
- The texts of `-I` and `-i`, in English and Japanese, say where the input goes: "every occurrence of it in the arguments of the command is replaced with the input item" (before, only the Japanese text of `-I` did; the English one said "runs once per input"). The worked example no longer replaces the string in the command's name.
- Not covered: a replace string inside a word with an expansion (`"$d/%"`).

### The `/bin/sh` of a Dockerfile's base image

A shell-form `RUN`, `CMD` or `ENTRYPOINT` runs with `/bin/sh -c`, and which sh that is depends on the image. The stage's `FROM` (the last one above the line) now says it, for Docker Hub's official images:

- `alpine`, `busybox`, and the `-alpine` tags of the other official images (`node:20-alpine`, `python:3.12-alpine3.20`, built FROM alpine): busybox ash. `RUN [[ -n "$V" ]] && echo ok` has no note (busybox ash runs `[[ ]]`); `RUN a=(1 2)` is an Error that names busybox ash ("it is a syntax error with status 2"). Before, `[[ ]]` was an Error "in dash `[[` is run as a command, is not found and gives status 127", and `--check` failed on a Dockerfile that builds.
- `debian` and `ubuntu`, with any tag: dash. `[[ ]]` stays an Error, now "`[[ ]]` is not available in dash"; what dash runs but POSIX does not have (`local`, `echo -n`) has no "Portability" note.
- A build argument in the tag is read by what is written around it: `golang:${GO_VERSION}-alpine` and `node:$NODE_VERSION-alpine` are busybox ash, `debian:${CODENAME}-slim` dash.
- Any other image (`node:20`, `myorg/alpine`, `ghcr.io/…`, `${BASE}`, `node:${TAG}`): any POSIX sh, as before, with the Error where dash or busybox ash fails.
- `sh` named explicitly is the image's sh too: `SHELL ["/bin/sh", "-eo", "pipefail", "-c"]`, and the exec form `RUN ["/bin/sh", "-c", "…"]`. Another shell named (`SHELL ["/bin/bash", "-c"]`) is that shell, as before.
- A stage FROM an earlier stage (`FROM build`) starts with the shell that stage ended with, its `SHELL` (and `pipefail`) too: the image keeps them. Before, every `FROM` started again with `/bin/sh`.
- The shell chip says it: "busybox ash" or "dash" for such a line, instead of "POSIX sh".

What dash 0.5.12 and busybox 1.36.1 do with each construct is measured in `test/dialect-dash.test.ts`, which now also runs `RUN` lines under `FROM alpine` and `FROM debian` in the real shell.
