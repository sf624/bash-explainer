# Unreleased changes, in detail

The short list is in [CHANGELOG.md](../../CHANGELOG.md#unreleased).

## New

### Known values read in the command's language

A variable whose value the script makes known is read in the language of the command that uses it (#790, docs/design/known-values.md, step 2: the use).

- **What is read.** A word that is only a copy of a variable, `$x`, `${x}`, `"$x"` or `"${x}"`, where the panel already shows the variable's value ("Value here, from the script"), in a place the command reads in a language of its own: grep's pattern (BRE, `-E`, `-P`, `-e`), sed's script (`sed -n "$s" f`, `sed -e "$s"`), an awk program, a jq filter, a printf format, `date "$fmt"`, tr's sets. The rows of the reading are under the value, in the panel, the hover's card, Markdown, the command line and `--format json`: `re='^[A-Z][0-9]+$'; grep -E "$re" ids.txt` gets the rows of `^`, `[A-Z]`, `[0-9]`, `+` and `$`, as `grep -E '^[A-Z][0-9]+$' ids.txt` does, and the example of matching lines. The role of the word gets the reader's note too ("search pattern (regex) — extended regex (ERE)"). Before, the value was shown but not read, and `sed -n "$s" f` said that what the script does depends on the value of `$s`.
- **Errors.** An error in the value is an Error of the line, in Problems and `--check`, as for the literal: `re='[a'; grep -E "$re" f` says "No `]` closes this `[`: `grep` stops with an error (status 2)".
- **Unquoted values.** `grep -E $re ids.txt` is read as grep gets it where no file name matches: a line above the rows says so. The caveat on the unquoted value says that bash also reads it as a glob pattern (its `[A-Z]`, `[0-9]`) before `grep` gets it, and so does the value's line; the argument's row no longer says it a third time. Before, the three said "it is a glob pattern". A value with a space or a tab, a value bash splits (`x='-e s/a/b/'; sed $x f`), an absolute glob (`p='/[A-Z]+/p'; sed -n $p f`), and nullglob or failglob on or maybe on are read as before.
- **Not yet.** A value inside a larger word (`"s/$from/x/"`, `-e"$p"`), another form of expansion (`${p%x}`), a command another command runs (`sudo grep -E "$re" f`, `find -exec grep …`, bats' `run grep …`) and find's own tests (`find -name "$p"`) are read as before. The example is not made yet where it needs another word that is a known value: the `-e` of sed and grep, awk's options, printf's format and tr's sets (the rows are there).
- **The assignment.** The line that sets the value (`re='…'`) does not show the reading yet.
