# Unreleased changes, in detail

The short list is in [CHANGELOG.md](../../CHANGELOG.md#unreleased).

## New

### Known values read in the command's language

A variable whose value the script makes known is read in the language of the command that uses it (#790, docs/design/known-values.md, step 2: the use).

- **What is read.** A word that is only a copy of a variable, `$x`, `${x}`, `"$x"` or `"${x}"`, where the panel already shows the variable's value ("Value here, from the script"), in a place the command reads in a language of its own: grep's pattern (BRE, `-E`, `-P`, `-e`), sed's script (`sed -n "$s" f`, `sed -e "$s"`), an awk program, a jq filter, a printf format, `date "$fmt"`, tr's sets. The rows of the reading are under the value, in the panel, the hover's card, Markdown, the command line and `--format json`: `re='^[A-Z][0-9]+$'; grep -E "$re" ids.txt` gets the rows of `^`, `[A-Z]`, `[0-9]`, `+` and `$`, as `grep -E '^[A-Z][0-9]+$' ids.txt` does, and the example of matching lines. The role of the word gets the reader's note too ("search pattern (regex) — extended regex (ERE)"). Before, the value was shown but not read, and `sed -n "$s" f` said that what the script does depends on the value of `$s`.
- **Errors.** An error in the value is an Error of the line, in Problems and `--check`, as for the literal: `re='[a'; grep -E "$re" f` says "No `]` closes this `[`: `grep` stops with an error (status 2)".
- **`[[ $x =~ $re ]]`.** An unquoted `$re` or `${re}` on the right of `=~`, where the value is known, is read as the ERE bash reads, as a literal right side is: `re='^[0-9]+$'; [[ $1 =~ $re ]]` gets the rows of `^`, `[0-9]`, `+` and `$` under the value, and the example of matching strings. `[[ ]]` neither splits nor globs, so the value is the regex whatever it holds. An error in it (`re='[a'`) is an Error of the line, as for the literal. The quoted `"$re"` is still text bash looks for as it is, and gets no rows.
- **Unquoted values.** `grep -E $re ids.txt` is read as grep gets it where no file name matches: a line above the rows says so. A value with a space or a tab, a value bash splits (`x='-e s/a/b/'; sed $x f`), an absolute glob (`p='/[A-Z]+/p'; sed -n $p f`), and nullglob or failglob on or maybe on are read as before.
- **Not yet.** A value inside a larger word (`"s/$from/x/"`, `-e"$p"`), another form of expansion (`${p%x}`), a command another command runs (`sudo grep -E "$re" f`, `find -exec grep …`, bats' `run grep …`) and find's own tests (`find -name "$p"`) are read as before. The example is not made yet where it needs another word that is a known value: the `-e` of sed and grep, awk's options, printf's format and tr's sets (the rows are there).
- **The assignment.** The line that sets the value (`re='…'`) does not show the reading yet.

## Changed

### The glob in an unquoted value a command reads

- **Said once.** The caveat on an unquoted value a command reads as data (`re='^[A-Z][0-9]+$'; grep -E $re ids.txt`) says that bash also reads it as a glob pattern, with the parts that make it one (its `[A-Z]`, `[0-9]`), before `grep` gets it; in an sh or dash script, "the shell". The value's line says it the same way, whether the value is read in the command's language or not (`sudo grep -E $re f`, `find . -exec grep -E $re {} +`, `xargs grep -E $re`). The argument's row no longer says it a third time. Before, the three said "it is a glob pattern". Where no note is said (bats' `run grep -E $re f`), the row says it as before.

## Fixed

### Examples under nocasematch

- **Regex.** With `shopt -s nocasematch` on, the example of `[[ $ans =~ ^(y|yes)$ ]]` ignores case as bash does: `Y` and `YES` are in "Matches", not in "Does not match". Where nocasematch may be on (`if …; then shopt -s nocasematch; fi`), there is no example. Before, it matched case-sensitively whatever the option.
- **Patterns.** The same for `[[ $x == pat ]]` and `case`: no example where nocasematch may be on. With it on, `[[:upper:]]` and `[[:lower:]]` in a pattern get no example, since bash does not fold those classes in a pattern (it does in `=~`).
