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

# Bug 6 of oracles.md 2.8: the hedge `several` gives the roles of three words; with two, the last is the destination of
# the two-operand form.
cp $pair

# Bug 7: a known value that starts with `-` gives an option, but is explained as an operand.
opt="-r a"
cp $opt d
