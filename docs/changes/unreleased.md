# Changes since the last release, in detail

The short list is in [CHANGELOG.md](../../CHANGELOG.md#unreleased).

## Fixed

### A command's text is read as bash gives it

A text a command reads in a language of its own (a regex, a sed or awk program, a glob, a tr set, awk's `-F` and `-v`, the values of jq's `--arg`), and the words an example of a command runs on (tr's sets, sort's or cut's options) is now what the word model says bash gives the command: after quote removal, and as it is where it is a pattern that matches no file.

- **A `$` before no name is text.** `grep foo$ f` and `grep -e 'a'.b$ f` explain the regex and show an example. Before, the word was not read: an unquoted `$` stopped the reading.
- **`$'…'` in a value.** `awk -F$'\t' '{print $1}' f` and `awk -v x=$'-' …` run their example with the tab or the text. Before, the example was left out. A program written in `$'…'` (`sed $'s/a/b/'`) is still not read: its tokens would lie over escapes that stand for other characters.
- **A tilde bash expands is not text.** `grep ~/a.b f` no longer explains the regex `~/a.b` (with "Literal `~/a`") and its example, and `tr ~ x` no longer shows an example that turns `~` into `x`: bash gives the command the home directory's path. The tilde's own row stays.
- **A pattern under nullglob.** `shopt -s nullglob; grep a*b f` no longer reads `a*b` as the regex, and `shopt -s nullglob; tr [:lower:] [:upper:]` shows no example: where no file matches, bash removes the word. The row says what nullglob does to the pattern.

### Command lines a tool refuses

A command line its tool refuses before it reads anything (a usage error: it prints a message and exits, every time) now has a note on the word at fault: what the tool refuses, GNU's message for it (its English text, as GNU's tool prints it in the C locale) and its exit status, and what to write instead where that is known. Other implementations may refuse the same line with other words. Where every implementation refuses the line, the note is an error: a problem in the editor's Problems, on the web page's strip, in the hover and the panel's box, and `--check` fails on it. Where only GNU's tool refuses it (`cut -dé`, `cut -f1 -f2`, `cut -b1 -c1`, `sort -t é`, `grep -E -F`), it is a warning, named as GNU's, which fails only `--check --strict`. The line shows no example; in a pipeline, neither do the stages after such a stage (`cut -d '\t' -f2 f | sort -u`, `cat f | cut -f 0 | sort`), while those before it keep theirs. The word at fault is not read in the tool's language (`sort -k 0` no longer says "the key starts at field 0"). Before, some of these lines showed an example of output the tool never prints (`cut -f 0`, `cut -f 1-0`, `cut -c1 -f1`, `sort -k 0`, and the stage after such a stage), and the others said it only in a row, or not at all.

- **cut.** A delimiter of more than one byte (`cut -d '\t' -f2`: "cut does not read `\t` as a tab… leave out `-d`, or write `-d $'\t'`"; `cut -d ab`; `cut -dé`, GNU's only); a list with field or position 0 (`cut -f 0`, `-f 1,0`, `-c 0`: "fields are numbered from 1") or a range that ends before it starts (`cut -f 3-1`, `-f 1-0`, `-f -0`: "invalid decreasing range"); two lists (`cut -c1 -f1`; a second `-f`, or `-b` with `-c`, GNU's only: "only one list may be specified"); no list at all (`cut f`, `cut -d , f`: "you must specify a list of bytes, characters, or fields").
- **sort and join.** A separator of more than one byte (`sort -t '\t' -k2`, `join -t '\t'`: "multi-character tab", with the hint `-t $'\t'`; `sort -t ''`: "empty tab"), checked before a later `-k` (`sort -t ab -k 0` quotes the separator's message). A key that starts at field 0 or character 0, or ends at field 0 (`sort -k 0`, `-k 1.0`, `-k 1,0`: "field number is zero", status 2).
- **head and tail.** A count with no number (`head -n x`, `head -n ''`, `tail -n +x`, `head -c x`: "invalid number of lines: 'x'").
- **grep and tar.** Options of two modes (`grep -E -F`, `grep -G -E`, GNU's only: "conflicting matchers specified"; `tar -c -x`). Before, the option's row said so, with no level.
- **Operands.** One tr set alone (`tr a`: "missing operand after 'a'"), the operands past those a tool takes (`tr a b c`, `basename a b c`, `date +%F +%T`, `seq 1 2 3 4`, `diff f f f`: "extra operand"), and `date -d now x` ("lacks a leading '+'"). Before, the operand's row said so, with no level. The messages of tools that are not GNU's are named as theirs (procps pgrep, util-linux look and mountpoint, Vim's xxd).
- **Only what holds whatever the values.** Nothing is said where a word at fault is not known (`cut -d "$d"`, `cut -f "$n"`), where a word not known before it may be an option, `--` or `-e` (`cut "$o" -d ab -f1 f`, `grep "$o" -E -F a f`, `grep -E "$@" -F f`, `cut "$o" f`), after `--help` or `--version` (`cut -f 0 --help`, `tar -c --usage -x`), or where `builtin` finds no builtin. A word not known after the word at fault changes nothing where the tool checks the option as it reads it (`cut -d ab -f1 "$f"`, `grep -E -F "$x" f` are said); where it checks it once it has read its options (cut's lists), that word may be `--help`: `cut -f 0 "$f"` refuses the line or prints the help, so it shows no example, and says nothing. After `--`, such a word is an operand: `cut -f 0 -- "$f"` is said. A fault the tool reports with another message (`head -n 5x`, `sort -k x`) is not said yet.

### Tools that work on bytes

GNU tr, `cut -c` and `-b`, and `head -c` and `tail -c` work on bytes in every locale (coreutils 9.4): a character beyond ASCII is two to four bytes of UTF-8. Their examples now do the same. Before, they worked on characters, and showed what the real tool does not print.

- **tr.** `echo 'ａｂｃ' | tr 'ａ-ｚ' 'a-z'` shows `zzczzdzze` (each byte of the range's ends is a member of the set), `echo 'a　b' | tr '　' ' '` shows `a   b` (three spaces, one per byte), and `echo 'abc é xyz é' | tr é x` shows `abc xx xyz xx`. Before, they showed `abc`, `a b` and `abc x xyz x`. Where the bytes tr prints are not UTF-8, as in `echo 'あいう' | tr -d 'い'`, the example says it does not show them. `-c` with text beyond ASCII has an example now: `echo 'aéb' | tr -c 'a-z\n' _` shows `a__b`. An equivalence class of more than one byte, `[=é=]`, has none: tr refuses it.
- **The rows of a tr set.** A character beyond ASCII is said as its bytes, each a member: `tr -d 'い'` says "the 3 bytes `\343 \201 \204` of "い" (each a member)". A range with such an end is said not to be the characters from one end to the other, with the bytes tr reads: `ａ-ｚ` is the bytes `\357 \275`, the bytes from `\201` to `\357`, and the bytes `\275 \232`. Before, they said "い" and "ａ-ｚ". `[é*3]` is read as tr reads it, `[`, the bytes of `é`, `*`, `3`, `]`; before, as `é` three times.
- **A pitfall on the line.** A tr set with a character beyond ASCII (`tr 'ａ-ｚ' 'a-z'`, `tr -d 'い'`, also through a variable the script sets) says that tr works on bytes, how many members each such character is, and that `sed 'y/ａｂ/ab/'` changes such characters in a UTF-8 locale. A set written as escapes (`tr -d '\200-\377'`) gets no pitfall.
- **cut.** `echo 'あいう' | cut -c1-3` shows `あ`. The rows of `-c` and `-b` lists say bytes (`bytes 1 to 3`; before, `characters 1 to 3`), and the row of `-c` says that GNU coreutils as released counts bytes, while some distributions count characters. `cut -dé -f1`, `cut -d ab -f1` and `cut -d '\t' -f2` are command lines cut refuses (below, "Command lines a tool refuses"): `é` is one character of 2 bytes, `ab` two characters, and `\t` a backslash and `t`. Before, the first showed the line unchanged, and the others said nothing of it.
- **head and tail.** `echo 'あいう' | head -c 3` shows `あ`, and `tail -c 4` shows `う`. Before, both showed `あいう`. A size with a suffix is read as GNU head and tail read it (`head -c 1K` is 1024 bytes, `1kB` 1000, `1b` 512), and `tail -c +0` prints everything. Before, `head -c 1K` showed no output, and `tail -c +0` an empty line.

### The values of a script's words

The model of the script (the variables a loop sets, the names a command runs, the words of `unset`, `trap`, `shopt`, `printf -v` and the like) reads a word's value from the view of the word, as bash expands it there.

- **A `for` list in more forms.** After `for f in $'a'`, `for f in "a"b`, or `for f in {a,b}` under `set +B`, the explanation of `echo "$f"` says that `$f` holds `a`, `ab` or `{a,b}`; after `set -f; for f in *.txt`, that it holds `*.txt`, and `bash -c 'echo "$f"'` gets the note that `f` is not exported. Before, only a list of plain or quoted words was read, and braces were never text.
- **A declaration's value with braces under `set +B`.** After `set +B; export x={a,b}` (or `declare`, `readonly`, `typeset`), `[ "$x" = plain ] && echo same` gets the note that `$x` is `{a,b}` there, so the test always fails. Before, that value was not known.
- **`printf -v` with an empty substitution.** `printf -v $(:)x %s hi` shows its example (the value stored in `x`), as for `printf -v x %s hi`.
- **`$(:)` where `:` is a function.** After `:() { printf x; }`, the line `$(:)echo hi` no longer says it prints its arguments: it says that it runs the expanded value as a command. Before, it was explained as `echo`. (Its texts still say the name becomes `echo`; bash runs `xecho`.)

### How many words a word gives

The roles of a command's words (which word is an option, a value, an operand) are read from the view of each word, which says how many words bash makes of it with the options and the IFS in effect.

- **Arithmetic with text.** `cut -c $((n+1))- f` no longer says that the word may give several words, the others being files: a number has no blank of IFS, so it gives one word. (`$((n-1))` alone was one word before too.)
- **No word splitting.** After `IFS=`, `grep --file=$f f` reads every word `--file=$f` may give as the option `--file`: a pattern of `$f` gives names that start with `--file=`. Before, the others were said to be files to search.
- **A command substitution that may print something.** After `:() { printf x; }`, `command $(:)ls -v` no longer says `$(:)ls` runs ls ("List directory contents"), nor that `-v` is ls's `-v`: bash runs `xls`.
- **An indirection in quotes.** `grep "${!x}" f` says what the other words are where `"${!x}"` gives several or none: with `x='a[@]'`, it gives the elements of `a`.
