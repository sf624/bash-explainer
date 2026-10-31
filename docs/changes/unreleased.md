# Changes since 0.9.0, in detail

The short list is in [CHANGELOG.md](../../CHANGELOG.md#unreleased).

## Changed

### Long lines on the web page wrap between shell words

The editor of the web page wraps a long line only between the words bash reads: a word keeps its quotes, `$( )`, `${ }`, `<( )` and backquotes on one row. In `grep -rn "ERROR $USER" ./src 2>&1 | sort -u > errors.txt && echo "done: $(date +%F)" || exit 1`, a row ends before `"done: $(date +%F)"`, never inside it. The rows after the first are indented by the line's own indentation and two more columns, and the gutter marks each of them with ↪. A word wider than a row breaks at its own blanks, and only as a last resort anywhere, so nothing scrolls sideways.

The words come from the syntax tree the explanations use. A line the parser cannot read, a comment, a here-document's text and the lines of a Dockerfile, a workflow or a Makefile that are not shell break at their blanks.

The setting **Wrap long lines** (`editor.wrap`) is now on by default. Before, it was off, and when on, a line broke wherever the browser chose: after the `-` of `sort -u`, at a slash of a path, or at the blank inside `$(date +%F)`. Turn it off to have long lines scroll sideways, as before.

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
