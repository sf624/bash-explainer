# Changes since the last release, in detail

The short list is in [CHANGELOG.md](../../CHANGELOG.md#unreleased).

## Fixed

### A command's text is read as bash gives it

A text a command reads in a language of its own (a regex, a sed or awk program, a glob, a tr set, awk's `-F` and `-v`, the values of jq's `--arg`), and the words an example of a command runs on (tr's sets, sort's or cut's options) is now what the word model says bash gives the command: after quote removal, and as it is where it is a pattern that matches no file.

- **A `$` before no name is text.** `grep foo$ f` and `grep -e 'a'.b$ f` explain the regex and show an example. Before, the word was not read: an unquoted `$` stopped the reading.
- **`$'…'` in a value.** `awk -F$'\t' '{print $1}' f` and `awk -v x=$'-' …` run their example with the tab or the text. Before, the example was left out. A program written in `$'…'` (`sed $'s/a/b/'`) is still not read: its tokens would lie over escapes that stand for other characters.
- **A tilde bash expands is not text.** `grep ~/a.b f` no longer explains the regex `~/a.b` (with "Literal `~/a`") and its example, and `tr ~ x` no longer shows an example that turns `~` into `x`: bash gives the command the home directory's path. The tilde's own row stays.
- **A pattern under nullglob.** `shopt -s nullglob; grep a*b f` no longer reads `a*b` as the regex, and `shopt -s nullglob; tr [:lower:] [:upper:]` shows no example: where no file matches, bash removes the word. The row says what nullglob does to the pattern.

### The values of a script's words

The model of the script (the variables a loop sets, the names a command runs, the words of `unset`, `trap`, `shopt`, `printf -v` and the like) reads a word's value from the view of the word, as bash expands it there.

- **A `for` list in more forms.** After `for f in $'a'`, `for f in "a"b`, or `for f in {a,b}` under `set +B`, the explanation of `echo "$f"` says that `$f` holds `a`, `ab` or `{a,b}`; after `set -f; for f in *.txt`, that it holds `*.txt`, and `bash -c 'echo "$f"'` gets the note that `f` is not exported.
- **A declaration's value with braces under `set +B`.** After `set +B; export x={a,b}` (or `declare`, `readonly`, `typeset`), `[ "$x" = plain ] && echo same` gets the note that `$x` is `{a,b}` there, so the test always fails. Before, the value was not known. Before, only a list of plain or quoted words was read, and braces were never text.
- **`printf -v` with an empty substitution.** `printf -v $(:)x %s hi` shows its example (the value stored in `x`), as for `printf -v x %s hi`.
- **`$(:)` where `:` is a function.** After `:() { printf x; }`, the line `$(:)echo hi` no longer says it prints its arguments: it says that it runs the expanded value as a command. Before, it was explained as `echo`. (Its texts still say the name becomes `echo`; bash runs `xecho`.)
