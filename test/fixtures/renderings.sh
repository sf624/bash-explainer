#!/usr/bin/env bash
# Inputs of the renderings check (test/support/renderings.ts, docs/design/oracles.md 2.8), which runs this file in bash
# with the other fixtures: words whose explanation states a number of words or a role that bash's argv can contradict,
# in forms the snippets may not keep. Each line is a command bash records, not runs.

# The words of a known value (`Token.value`): two, a source and the destination.
pair="a b"
cp $pair d

# The words of a brace expansion with a quoted part, each with its role at its place.
cp a{,'.bak'}
cp a{,"b c"}
# The words of braces next to a quoted part, each keeping it (bug 4): the format, then its values; two words of `'a'{,}`.
printf '%s,'{a..c}
cp x"y"{1,2} d
cp 'a'{,}

# A word of braces with an expansion in it (found in the review of #481): the expansion may split it or give none, so
# the braces do not give their number of words (`cp a a b`; with `$u` empty, `cp a`); with the value known, its fields.
cp {a,$pair}
cp "x"{a,$pair} d
cp {a,$u}
cp {a,"$@"}
cp {a,$(echo b c)}

# A word that may give no field (bug 5 of oracles.md 2.8): with it empty, the words after it take other roles (`cp b`:
# `b` is a source; `grep -c f`: `f` is the pattern).
cp $a b
grep -c ${x} f
cp $a $a/x
cp $e $u c

# The hedge `several` (bug 6 of oracles.md 2.8): with two words, the last is the destination of the two-operand form
# (`cp a b`, `ln -s a b`: a new name, or an existing directory); with three, of the form of three or more. (The names
# sort after the others, which keep their values in the run with values.)
cp $pair
ln -s $pair
y=1
cp $y{,.bak}
y3="a b c"
cp $y3

# Bug 7: the fields of a known value, read as bash gives them to the command: an option (`cp -r a d`), an option and
# its value (`head -n 2 f`), and the end of options (`cp -- -r d`: `-r` is a source). (Not `set {-e,-u}`: a `set` of a
# word not known as written makes the model trust nothing in the file, src/semantics/trust.ts.)
opt="-r a"
cp $opt d
ov="-n 2"
head $ov f
od="-- -r"
cp $od d

# Braces with brace expansion turned off: one word, the source (`set +B`).
set +B
cp {a,b} d
set -B

# Bug 7 too: a word the model knows is empty gives no word (bash runs `cp a b`: `b` is the destination; `cp c`).
z=""
cp $z $pair
cp $pair $z
cp $z c

# Two words that may give several (review of #484): the roles of each are those any counts give (`cp p q r`: `r` is the
# destination directory; `gosu u ls x`: `x` is an argument of `ls`; `cmp p q r`: `r` skips bytes in the first file),
# and a word after one such word has its role for each count of it (`cmp p q f`).
zp="p q"
zr=r
zu="u ls"
cp $zp $zr
cmp $zp $zr
gosu $zu $zr
cmp $zp f

# An option's value that may give no word (after #482): with it empty, the word after it is the value (`tar -cf b`: `b`
# is the archive; `cp -t c d`, `grep -e f`, `grep -e -i f`), and the words after take other roles (`grep -e -e x f`: `x`
# is a file). (The name sorts after the others, and gets the empty value in the run with values.)
tar -cf $zv b
cp -t $zv c d
grep -e $zv f
grep -e $zv -i f
grep -e $zv -e x f
