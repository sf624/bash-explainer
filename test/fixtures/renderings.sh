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

# Bug 6 of oracles.md 2.8: the hedge `several` gives the roles of three words; with two, the last is the destination of
# the two-operand form.
cp $pair

# Bug 7: a known value that starts with `-` gives an option, but is explained as an operand.
opt="-r a"
cp $opt d

# Braces with brace expansion turned off: one word, the source (`set +B`).
set +B
cp {a,b} d
set -B
