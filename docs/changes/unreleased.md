# Changes since the last release, in detail

The short list is in [CHANGELOG.md](../../CHANGELOG.md#unreleased).

## Changed

### "In short" says what a command does with its words

The sentence at the top of the panel, "In short" (「ひとことで」), says what a command does with its words where the explanation reads all of them in one clause, in place of what the command does in general (#843). It is the reading the row of the expression or the program gives, without its label ("Condition:", "Rule:", "Substitute:") and without its asides, which stay in the row.

- **find's expression.** `find . \( -name '*.log' -o -name '*.tmp' \) -mtime +7 -print` says "Runs `find`: if (name matches *.log; or name matches *.tmp) and modified at least 8 days ago: print it." (「`find` を実行し、（名前が *.log に一致、または 名前が *.tmp に一致） かつ 8日以上前に更新なら表示。」). How find counts the days ("`+7` means more than 7 whole days") stays in the row. Before, it said "Runs `find` (search a directory tree for files matching conditions)."
- **A sed script of one command.** `sed -E 's/^([a-z]+)=(.*)$/\2=\1/' config.ini` says "Runs `sed` using `-E` (use extended regex): replace the first match of `^([a-z]+)=(.*)$` on each line with `\2=\1`." That is a substitution with no flag but `g` or a number, `d`, and `p` with `-n` (`sed -n '/^BEGIN/,/^END/p'`), where the command is the whole of what the script does.
- **An awk program of one pattern.** `awk '!seen[$0]++' list.txt` says "Runs `awk`: print the first occurrence of each line." (「`awk` を実行し、初めて出てきた行を出力する。」).
- **A test of one unary operator.** `if [ -z "${1:-}" ]; then` says "If `"${1:-}"` is an empty string, runs what follows `then`; …" (「`"${1:-}"` が空文字列であるなら、`then` 以下を実行する。…」); `[[ -f $f ]] && echo "$f"` says "Tests whether `$f` is an existing regular file; if that succeeds, …". Before, "If the test `[ … ]` succeeds" and "Tests the condition in `[[ … ]]`".
- **Where it stays as before.** A test that compares two words (`[ "$n" -gt 10 ]`), a negation or `-a`/`-o`; a script or a program of several commands (`sed -e a -e b`, `1d;$d`), or with an expansion in it (`sed "s/$a/b/"`); a jq or yq filter, a perl one-liner, an awk rule with an action; a find expression with a word not known (`-name "$p"`), a primary it does not read, or one find refuses; a `[` whose `]` may be missing. A sentence that would grow past its length says what the commands do in general, as before.

### The POSIX sh hint switches the shell, and says so

The web page's hint toward POSIX sh (a script with no shebang, read as bash, that has constructs POSIX sh lacks) has a button that sets the page's shell to POSIX sh, as the shell chip's popover does (#746).

- **The button.** It says "Switch to POSIX sh" (Japanese: 「POSIX sh に切り替え」). Before, it said "Check as POSIX sh" (「POSIX sh として確認」), and testers took it for a one-off check, not a change of the page's shell.
- **After it.** The chip in the editor's header shows "POSIX sh" and lights up in the accent colour for a moment. A toast says "Shell set to POSIX sh." with Undo, which sets the shell back to what it was (Auto). The toast goes when the shell is chosen again, in the chip or in the settings, since its Undo would then take back that choice. Before, only the chip's words changed.
- **The strip.** With no problem in bash, the strip says "No problems in bash" (「bash では問題なし」) above the hint's line, "2 constructs not in POSIX sh". Before, it said "No problems" above that line, which read as a contradiction. Once the hint goes, the strip says "No problems" again.
