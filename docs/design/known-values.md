# Known values read in the command's language

A variable whose value the script makes known is read in the language of the command that uses it:

```bash
pattern='/^BEGIN/,/^END/p'
sed -n ${pattern} config.txt
```

Line 1 explains the string as a sed script: the range `/^BEGIN/,/^END/` and the command `p`, and says that line 2 reads it. Line 2 reads `${pattern}` as that script, under its value. This page says which values count, how the command is read, what each line shows, how it relates to holes, what it costs, where the facts live, and the steps.

Status: Tracked in #790.

The maintainer decided on 2026-11-10:

- The reading is shown on both lines, the assignment and the use.
- It comes after Python `re` (#759, #748–#753, #760).
- A design document first (this page).

It was dropped as rare on 2026-11-06 ("A known value in a hole", [backlog-archive.md](../backlog-archive.md)). The maintainer asked for it again on 2026-11-09, after two examples from real use (section 1).

## 1. What we say today

The inputs were run with `npx tsx test/dump.ts FILE en` at e1ae5fa0.

### 1.1 `sed -n ${pattern} config.txt`

```text
- [argument] ${pattern} — sed script (e.g. `s/foo/bar/g` replaces all foo with bar)
  - [variable] ${pattern} — Value of `pattern` (braces delimit the name)
    = Value here, from the script: `/^BEGIN/,/^END/p`
```

The value is known and shown, but not read: no rows for the range and `p`, no example. The literal form, `sed -n '/^BEGIN/,/^END/p' config.txt`, gets the rows of the script (the range, each regex, `p`) and an example with input and output. Line 1 says only "Single-quoted string: taken literally".

Why: `embedded()` (src/explain/embedded.ts) reads a word through `literalContent` (no expansion at all) or `holedWord` (expansions in double quotes, as holes). An unquoted `${pattern}` gives neither, so the reader never runs. The value of the token (`expansionValue`, src/semantics/values.ts) is never given to the reader.

Quoted, `sed -n "$s" config.txt` is read with the whole script as one hole. The sed reader cannot read a script that is only a hole, so the row says "What this script does depends on the value of `$s`: `sed` reads it as code" (`hole-script`). The value line under it shows that value. The two lines contradict each other in tone: the value is known one line up.

### 1.2 `grep -E ${pattern} ids.txt`

With `pattern='^[A-Z]{3}-[0-9]+$'`:

```text
note: ⓘ Caveat: `${pattern}` is not quoted, so its value `^[A-Z]{3}-[0-9]+$` may not reach the command as it is: it is a glob pattern, and a file name that matches it takes its place. To pass the value as it is, write `"${pattern}"`
- [argument] ${pattern} — search pattern (regex); unquoted, `${pattern}` is a glob pattern, so a file name that matches it takes its place; where several match, the first is this role, and each of the others is file to search (default: stdin)
  - [variable] ${pattern} — Value of `pattern` (braces delimit the name)
    = Value here, from the script: `^[A-Z]{3}-[0-9]+$`. Unquoted, it is a glob pattern: bash matches it against file names when the line runs (not done here)
```

Each statement is true. `[A-Z]` and `[0-9]` make the value a glob pattern. In a directory with a file named `^Q{3}-1+$`, bash 5.2 passes that name, and `grep -E` finds nothing (status 1). Where no file matches, the usual case, grep gets the value as written. Checked with bash 5.2.21, GNU grep 3.11 and GNU sed 4.9.

What looks wrong:

- The line says three times that the regex "is a glob pattern" (the note, the argument's row, the value line). It never reads the regex. A reader takes it for a regex mistaken for a glob.
- The literal form, `grep -E '^[A-Z]{3}-[0-9]+$' ids.txt`, gets seven rows (`^`, `[A-Z]`, `{3}`, `-`, `[0-9]`, `+`, `$`) and an example of matching lines. The variable form gets none of them.

Why no rows: the word is unquoted, so neither `literalContent` nor `holedWord` gives it a text (`holedWord` also refuses a word that may give several words, `countIn`, which a glob may). The note is `unquoted-value-as-data` (src/wordfacts.ts); the argument's row is the glob clause of src/argv/profiletexts.ts.

Quoted, `grep -E "$pattern" ids.txt` shows the value line and nothing else. A regex that is one hole gives no rows (`readHoles`). `pattern-from-variable` (src/pitfalls.ts) is left out twice over: the variable is named like a pattern (`PATTERN_NAME`), and its known value has special characters.

### 1.3 `[[ $1 =~ $re ]]`

With `re='^[0-9]+$'`, the row of `$re` says "Unquoted here, its value is read as a regex", and the value line shows `^[0-9]+$`. The regex is not read. A literal right side (`[[ $1 =~ ^[0-9]+$ ]]`) is read by `regexNode` (src/explain/tests.ts) through `explainRegex`, not through `EMBEDDED[`. The manual (3.2.5.2) recommends storing the regex in a variable, so this is representative usage.

## 2. When a value is known

The value is the one Meaning already shows ([expansion-values.md](expansion-values.md)). Nothing new decides it.

- **The value:** `expansionValue(part, model)`, with all of its rules: the trust allow-list (src/semantics/trust.ts, [trust-allow-list.md](trust-allow-list.md)), a state that is the same on every path (`at(n).run`), `settled`, not `dead`, no failure around it. A value it does not give is not read.
- **The form:** a plain copy of a variable, `$x`, `${x}`, `"$x"` or `"${x}"`. Not `${x%.*}` or `${x:-d}` in this plan: their values are known, but no assignment holds their text (section 6).
- **The word:** the expansion is the whole word. A value inside a larger word (`"s/$from/x/"`, `-e"$p"`, `--regexp="$p"`, `date +"$fmt"`) stays as today (section 10).
- **One assignment:** for the assignment line, the value is the static text of one plain assignment that reaches the use on every path (section 6). The use reads any known value; the assignment shows only what its own text holds.

### 2.1 Quoted and unquoted

What bash makes of the word comes from the word model, not from the quotes: `wordFields(word, model, { files: [] })` (src/semantics/words.ts).

- **One field, equal to `expansionValue`'s text:** it is read. Both are needed. With an environment given, the word model drops its own refusals (`blindAt` and the set of refused expansions are skipped when `env` is set), so `wordFields` with `files: []` does not by itself say the value is known. `expansionValue` says that; `wordFields` says only what bash does to it.
- **Quoted:** the field is the value.
- **Unquoted, no IFS character and no glob character** (`/^BEGIN/,/^END/p`): the field is the value.
- **Unquoted, a glob:** `files: []` asks the word model what bash gives where no file name matches. With nullglob and failglob off, that is the value itself, and it is read on that assumption. The reading carries the mark `assumes: 'no-match'` (section 4.1).
- **A glob the word model does not decide with an empty list:** an absolute pattern (`p='/[A-Z]+/p'; sed -n $p`), a pattern with a `.` or `..` segment, any word of a script that changes its directory anywhere (`cd`, `pushd`, `popd`: `changesDirectory`, src/semantics/wordsites.ts). The word model gives no field, so nothing is read. `p='/[A-Z]+/p'; sed -n $p` stays unread, as today.
- **nullglob, failglob, or either not known:** no field, or none surely. Nothing is read.
- **Several fields** (`x='-e s/a/b/'; sed $x`): not read. The note says it is split, as today.

The empty list of files is an assumption asked of the word model explicitly, like the example's environment (`WordEnv`). It never reaches the line's word facts: `Token.value`, `LineExplanation.argv` and the model's fields stay as they are.

## 3. One reading of the command

The reading needs the use's command: its spec, its parse, and what the reader asks of them. Today the two places that read a command decide it differently:

- The use's line reads through `readArgs` (src/explain/argv.ts) with `specFor` (src/explain/reads.ts): the `customCommands` setting, the host's commands (bats' `run`), the dictionary; then `soleRead` and `respec` (a builtin's variant, a builtin turned off).
- `specRuns` (src/pitfalls.ts) uses `lookupCommand` only.

A command with a custom spec, or a bats `run …` line, would get a reading on one line and none on the other. So step 1 makes one reading of a command on the model, a slice of stage SC2's `commandRead(n)` ([sources.md](sources.md), section 4):

- `commandReading(cmd, model, lookup)`: the resolved spec, the parse with `argWordIn(model)`, `soleRead` and `respec`, as `readArgs` does today. `lookup` holds the inputs of the spec's lookup: the custom commands and the host's commands.
- It is kept by the model and those inputs.
- `readArgs` reads it, and so does the reading of a use on another line. `specRuns` reads it too, or keeps its own lookup until SC2, with a test that both give the same spec and parse for every command of the tests.

If that slice cannot be made in step 1, the fallback is a guard: the use's line shows the kept reading only where its own language and flavour equal the kept reading's, and a test fails on any case where they differ.

What step 1 found:

- `readArgs` did not decide the spec: the head of the command did (`headOf` in src/explain/commands.ts: the alias, a builtin turned off, `hash -p`, the setting, the host, a system's alias), then yq's flavour and a builtin's variant (`commandTail`), each beside its text. Step 1 moved those decisions to the model (`headFacts`, src/semantics/commandhead.ts); the explanation reads them and keeps only the texts and notes. `lookup` also holds what tells the three yq apart besides the text (the document's host, the `yqFlavor` setting) and the bash release (a brace expansion's limits): `CommandLookup`, keyed by content. The text is that of the command's tree (`treeTextOf`, src/semantics/state.ts).
- `specRuns` keeps its own lookup. test/command-read.test.ts holds it to the same spec and parse on the commands of the tests: it differs on 14 of about 2300, and the test pins the count of each reason (10 `off`, 2 `path`, 2 `variant`). `/bin/kill` is read by the checks with the builtin's spec, for one.
- A command a slot runs (`sudo grep -E "$re" f`, `find . -exec grep -E "$re" {} +`) is read inside its wrapper's parse (`role.parse`), but its words are read again on the line (`ownWords` and `findExpression`, src/explain/argv.ts, with the line's `slotEnvs`). Step 2 needs that reading on the model too for such a use, or leaves those uses unread. `ownWords` also decides again, for such a command, what `headFacts` decides for a command's own name: a builtin turned off with `enable -n` (its program's spec) and a builtin's variant for the shell options. `programBasis` (src/explain/reads.ts) asks the setting and the host's commands again, for the basis of a token; it serves the commands a slot runs too, which have no `HeadFacts`.
- The document's part of `invalid` and `reached` (3.1) is the document's only for a node of the asking line's own region. In a host file `stopsFrom` is set per line (`shellStart(region, line)`, src/hosts/remap.ts; for bats, the line's own `@test`, src/hosts/scripts.ts), and `script` and `host` come with the line's options. Step 1 has no asker on another line, so it holds there. Step 2 must take `stopsFrom` (and the rest) from the use's region, not from the line that asks.

What step 2 found:

- The use is read only where the command's reading is the model's (`CommandContext.onModel`: `readArgs` and the subcommands of its parse). A command a slot runs (`sudo grep -E "$re" f`, `find . -exec grep …`, bats' `run grep …`) and find's own expression (`find -name "$p"`) are read again on the line (`ownWords`, `findExpression`), so their uses stay unread until that reading is on the model (SC2).
- Whether the caveat `unquoted-value-as-data` is about a word is one fact, `dataValues` (src/wordfacts.ts): the caveat, the word's row (which then drops its glob clause) and the value's line (which then says the glob as bash's step before the command, decision 12) read it, with the glob parts from the word model (`globParts`, src/semantics/chars.ts). It reads `specRuns`, which knows no host command: bats' `run grep -E $re f` has no caveat, so its row keeps the clause.
- The `customCommands` setting has no `lang`: a custom spec can only take a language away (`grep` with a custom spec reads no regex), and the use then reads nothing, as the literal does.
- The kept reading is keyed by the `script`, `host` and `stopsFrom` of the line that asks. In step 2 only a line of the use's own statement reaches the use's word, so they are those of the use's region. Step 5, where the assignment's line asks, must pass the use's region's values (`shellStart` of the use's line), not its own.
- A line that sets flags of its own reading (`unread`, `unsure`, `sometimes`, `unreached`: a string read as a script, a trap's action) reads the value afresh with them, as it reads a literal, and keeps nothing. The value is rarely known there (`expansionValue` refuses the strings of another shell).

### 3.1 What the reader reads

`EmbeddedContext` (src/embedded/registry.ts) is built today from the asking line's `Explainer` (`embeddedTextInner`, src/explain/embedded.ts). Its inputs:

| Input | Today | At the use, for a kept reading |
| --- | --- | --- |
| `flavor` | `regexFlavor(cx, word)`: the command's name and parse | The command reading |
| `trSet` | `trContext(cx, a)`: the command's words and parse | The command reading |
| `letters`, `given`, `joined`, `records`, `awkGnu` | The command's parse and name | The command reading |
| `bash` | The spec (`builtin`) and `opts.bashVersion` | The spec, and the version in the key |
| `shell`, `lang` | The context | In the key |
| `invalid` | `cx.evidenceAt(a)`: `readAs` or `hostReadAs`, and the line's `opts` (`unread`, `unsure`, `sometimes`, `host`, `stopsFrom`, `script`) | Facts of the document at the use's node, not of the asking line |
| `reached` | `cx.reachedAt(a)`: `stopAt` and the line's `opts` (`unreached`, `sometimes`, `quiet`, `stopsFrom`, `host`) | The same |

`invalid` and `reached` decide an error's level. If they came from the asking line, the level would depend on which line asked first. So step 1 splits each into its document part (`readAs`, `stopAt` at the use's node, with the `script`, `host` and `stopsFrom` of the use's region: in step 1 the asking line's, which is the use's own line; step 2 must take them from the use's region) and its line part (the flags a line sets for itself: `unread`, `unreached`, `sometimes`, `quiet`). The kept reading takes the document part only. The use's line applies its own line part on its copy, as for a literal.

The kept reading is keyed by every input it reads: the model, the use's node, the language of the texts, the shell, the bash version, the lookup's inputs.

## 4. What the use shows

The use reads the value in the language its place names, by the same path as a literal argument:

- The spec says which word is a script or a pattern, and in which language (`lang` of an operand or a value in src/dict/). Nothing looks at the command's name.
- The reader is `EMBEDDED[lang]` (src/embedded/registry.ts), with the context of section 3.1.
- Every place that gives a word to the readers today takes part: an operand (`positional`, src/explain/argv-shared.ts) and an option's value in its own word (`grep -e "$p"`, `sed -e "$s"`: src/explain/argv-options.ts).

### 4.1 The rows

The reading's tokens have no place of their own in the line: every character of the value sits on `${pattern}`. If they were children of the expansion with its span, the hover would land on the first of them (`shown` and `chainAt`, src/ui/hoverParts.ts), and the editor's colours would give one place many roles.

So the reading belongs to the value, not to the source:

- `ValueInfo.reading` (on `Token.value`): the reader's tokens, each labelled with its text in the value, and `assumes: 'no-match'` where the word globs (section 2.1).
- The panel draws them under the value line, as it draws a token's children, at the depth a literal's reading has.
- The hover's part card for the expansion lists them as a table of parts under the value line. The hover and the cursor never land on one.
- Markdown and the CLI print them as rows under the `= Value here` line. JSON has them as data.
- The editor's colours take nothing from them.
- `tokenRow` (src/ui/tokenRow.ts) gives each output the field (test/row-source.test.ts).

`reading` is for display only. No check, decision or model reads it. An error in the value reaches Problems as a literal's does: `tokenErrors` (src/linefinish.ts), the one walk that makes problems of the tokens' errors, walks the reading's tokens too (section 4.2).

The tokens are finished when the reading is made, as a line finishes its own (`finishedApart`, src/linefinish.ts: the ids of their texts, their labels' echoes, their roles), then kept. A line marks nothing on them, so it shows them as they are and needs no copy.

In the panel the rows are the first parts of the row that holds the value. For an unquoted `$re` that row is the argument's (the variable's token has the argument's range), so the rows have the depth of a literal's reading. For `"$re"` the value is on the row of `$re`, a part of the argument's row, so the rows are one level deeper than the literal's (measured at 1280 px: 103 px against 86 px; at 390 px: 78 px against 68 px).

The panel's look is a prototype first (a screenshot at 390 and 1280 px, light and dark), before the clean PR.

### 4.2 What else changes on the use's line

- `hole-script` ("depends on the value of `$s`") is not said where the value is read.
- The worked example runs on the value, as for a literal (`guardedEmbeddedExample`): the sed script on a sample input, the matching lines of a regex, the awk and jq examples. It is charged to the use's line (`withinLine`). For sed with several `-e`, `sedScripts` takes a known value from `expansionValue`.
- An error the reader finds in the value (an unclosed `[`) is a token at the level `error`, so a problem of the use's line, as for a literal.
- `pattern-from-variable` reads the value through `expansionValue`, not `variables.get(…).value` (section 8).

## 5. `[[ $x =~ $re ]]`

The right side of `=~` is an ERE that bash reads itself. Its reader is `explainRegex` through `regexNode` (src/explain/tests.ts), with no command and no spec.

- **Unquoted** `$re` or `${re}` with a known value: read as an ERE, as a literal right side is. `[[ ]]` does not split or glob, so the field is the value (the word model says so: `wordFields` in a `[[ ]]` context).
- **Quoted** `"$re"`: bash matches it as a literal string, not a regex. It stays out: no regex reading.
- The rows go under the value line (section 4.1). The assignment line counts this use as a reading in the ERE of bash (section 6).
- No `CommandContext`: the context is bash's, the ERE flavour and the use's node.

It is a step of its own (section 11), small, after the use.

## 6. What the assignment shows

### 6.1 Which assignment

A use names its assignment only when one plain assignment gives the value on every path to the use.

The state already keeps this for values that are not static text: `VariableState.source` is the value word of the plain assignment that gave it, and a merge keeps it only when both paths have the same word (`mergeVariable`, src/semantics/shellstate.ts). The plan sets `source` for every plain assignment, static text too: `x=…`, `local x=…`, `declare x=…`, `declare -r x=…`, `readonly X=…`, `export x=…`. The word model and src/semantics/shvalues.ts read `value` first and `source` only without it, so nothing they give changes.

An expansion's origin is then that `source`, where:

- `expansionValue` gives the value (section 2);
- the variable's state has a `source`;
- its static text (`staticWordText`) is the value.

`if c; then p=a; else p=a; fi; grep "$p"` has two value words: the use reads `a`, and neither assignment shows a reading. `p=a; p+=b` has no one word: the same.

### 6.2 Which uses decide the language

The assignment line asks for the uses of its value word: the expansions whose origin is that word (`valueUses`, an index from origin word to uses, built once). Each use with a reading (sections 4 and 5) counts. Uses that read no language (`echo "$p"`) do not.

- **No use with a reading:** the line is as today.
- **One reading:** the string's token gets the reading's tokens as children, placed over the string's characters through its `Literal` (`staticWordText`, `literalOfMapped`), as the prompt strings are (`embeddedValue`, src/explain/assignments.ts). Its text adds which command reads it, and where: "read as a sed script by `sed -n`, line 2".
- **Several uses, one reading:** two readings are one when their tokens are the same (labels, kinds, texts, places in the value). Two `grep -E "$re"` lines are one reading. The text names every line: "by `grep -E`, lines 4 and 9". Past three lines, "lines 4, 9, 12 and 2 more".
- **Several uses, different readings** (`grep "$re"` and `grep -E "$re"`, or sed and awk): no rows on the assignment. Its text names each use and its flavour: "read as a basic regex by `grep` (line 4) and as an extended regex by `grep -E` (line 9)". Each use shows its own reading. Two sets of tokens over the same characters cannot share one place in the panel, the hover and the colours.
- **A reading with an error:** no rows on the assignment. Its text says which line reads the value and finds an error there. The problem is said once, at the use, where the command fails.
- **A use whose state does not carry this source** (a use before the assignment runs, a value changed between them): not a use of this assignment. Text order does not decide it. `f() { grep -E "$re" f; }; re='^a'; f`: the use is above the assignment and is a use of it, so a "line N" text may name a line before the assignment.
- **A variable bash reads itself** (`PS1`, `PS4`: `variableLanguages`): it keeps bash's reading. Uses add nothing.
- **A backslash bash takes away** (`re="a\\.b"`, which gives `a\.b`): the `embedded-backslash-removed` text goes on the assignment line, where the quotes are. The use's value has no quotes of its own.

The names come from what each line already says: the command as written, the role the spec gives the word, and the reader's note on the flavour (`extended regex (ERE)`). The texts are entries of the catalog of token texts (src/messages-tokens.ts). A line number is written by `lineLabel` (src/i18n.ts), with the document's line in a host file.

### 6.3 The same whichever line comes first

The two lines read one reading, kept for the document. Explaining line 1 before or after line 2 gives the same rows (test/line-order.test.ts). Section 7 says how.

## 7. Cost

The walk and the models charge nothing, so each node is read once ([line-budget.md](line-budget.md), "Reading once").

- **The uses:** `valueUses(model)` is one pass over the script's expansions, kept by the model: an index from each origin word to its uses. Each expansion asks `expansionValue` once.
- **A reading:** `valueReading(use)` reads the value once per use. It is kept by every input it reads (section 3.1), as src/explain/whole.ts keeps a statement's walk. The line that asks first makes it; the other reads it. It has no example, and the readers charge nothing (none calls `guarded`). A reader that needs a limit later uses `guardedApart`, whose refusal does not depend on the line that asked.
- **Copies:** the kept reading is finished and frozen when it is made (`finishedApart`, `keep`, src/tokenkept.ts). No line marks its tokens (they are no part of a line's tree), so none takes a copy, and none changes what another line reads.
- **The assignment line:** it reads the kept readings of its uses and compares them. Over the document, each use is read once, and each assignment looks at its own uses only: linear in the number of uses.
- **The example:** made on the use's line only, charged to its budget, as for a literal.

What may grow: a value of length L used U times costs U readings of length L. The value is text of the script, so this is at most the script's size times the number of uses.

## 8. Where the facts live

Three facts are new or moved. Each gets a source and a guard, and a row in [sources.md](sources.md) section 3, in the PR that adds it.

| Fact | Source | Guard |
| --- | --- | --- |
| How a command reads its words, for a use on another line | `commandReading` (section 3), a slice of SC2's `commandRead(n)`, read by `readArgs` and by `valueReading` | test/command-reading.test.ts as today; a test that `specRuns` and `commandReading` agree on every command of the tests, until SC2 |
| Which assignment's text an expansion copies, and the uses of each such text | `valueOrigin(part, model)` and `valueUses(model)` in src/semantics/values.ts, over `VariableState.source` and `expansionValue` | test/value-source.test.ts: no file outside src/semantics/ reads a variable's `value` or `source` from the state. Known list (test/fixtures/value-source-known.json): src/explain/reads.ts, `arrayKind` (a nameref's target is a name, not a value). The offender src/pitfalls.ts (`pattern-from-variable`) is fixed in the step of the origin |
| What a known value means in the language of a use | `valueReading(use, …)` in src/explain/embedded.ts: the reader of the use's spec, with the context of section 3.1, kept for the document; for `=~`, the same function with bash's ERE | The same test file: no file but src/explain/embedded.ts calls `EMBEDDED[`, and no file of src/explain/ but embedded.ts and tests.ts (`regexNode`) calls `explainRegex` (the readers of src/embedded/ call it inside a text they read); `valueReading` is the only caller that passes a value's text |

The holes are unchanged (`holedContent` in src/staticword.ts, `holeToken` in src/embedded/types.ts, `holeText` in src/explain/holes.ts): a value that is not known stays a hole, with its texts.

## 9. Tests

- **Same as the literal:** for each case, the reading at the use has the rows of the literal form (labels, kinds, texts), and the assignment's rows are the literal's, placed on the string. Cases: sed (addresses, `s`, `-E`), grep (BRE, `-E`, `-F`, `-P`, `-e`), gawk, jq, `find -name`, `printf`, `fmt='+%F'; date "$fmt"`, tr, `[[ $x =~ $re ]]`; a program over several lines (`prog='…'` for awk and jq).
- **Against the tools:** bash runs the variable form and the literal form on the same input, in a directory of its own, with GNU sed, GNU grep, gawk and jq: the same output and status. The glob cases run in an empty directory, and once more with a matching file, which must differ (the note's case). Through `runContained` (test/support/contained.ts), each table in one process.
- **The assignments:** `readonly RE=…`, `declare -r`, `local x=…` in a function, `export p=…`, `re="a\\.b"` (the backslash text on the assignment line).
- **Nothing read:** a split value, nullglob or failglob on or maybe on, an absolute glob (`p='/[A-Z]+/p'; sed -n $p`), a value set in a loop, by `read`, by `$( )`, in a function called from a trap, an array, a joined word, `[[ $x =~ "$re" ]]`, a blind script, zsh. Each keeps today's explanation.
- **The assignment line:** one use, two uses with one reading, two with different readings, an error, a use before the assignment in the text that is a use of it (`f() { grep -E "$re" f; }; re='^a'; f`), a use whose state does not carry the source, a value used nowhere, `PS1`, a host file's line numbers.
- **One command reading:** a custom spec with `lang` (the `customCommands` setting), a bats `run grep -E "$re" f` line: the use's line and the assignment line give the same reading.
- **The level of an error:** the same whichever line is explained first, in a script where the use may not be reached.
- **The origin against bash:** in the generated scripts of test/values.test.ts, for each use and origin the model gives, the origin's text is replaced by a marker; bash's xtrace must show the marker at the use.
- test/line-order.test.ts, test/snapshot.ts (step 1 byte-identical), test/row-source.test.ts, the web tests of the panel's rows.

## 10. Out of scope

- Values from `read`, `mapfile`, `$( )`, arithmetic, the environment, or a loop whose passes differ: the model does not know them.
- Positional parameters and function arguments (`"$1"`), and functions called where the walk does not see it: not settled.
- Arrays (`"${a[@]}"`, `${a[0]}`): the state does not follow their values.
- A value inside a larger word (`"s/$from/$to/"`, `date +"$fmt"`): the reading would mix tokens that have a place in the line and tokens that have none. Its holes stay as today, and each expansion shows its value.
- A value attached to its option (`-e"$p"`, `--regexp="$p"`): unread today for literals too ([backlog-archive.md](../backlog-archive.md)).
- Other forms than a plain copy (`${p%x}`, `${p:-d}`).
- A value split into several words, even where the spec could read each.
- A note that two uses read one value differently (`grep` and `grep -E`).

## 11. Steps

Each step is one PR that keeps every test passing. The use comes before the origin: it needs no `valueOrigin` or `valueUses`.

1. **One command reading and its context** (refactor). `commandReading` (section 3), read by `readArgs`; `EmbeddedContext` built from it and the use's node (`embeddedContext`, src/explain/embedded.ts), with `invalid` and `reached` split into their document and line parts (section 3.1); `regexFlavor`, `trContext`, `given` and the gawk check take the command reading. Explanations stay byte-identical (test/snapshot.ts). No CHANGELOG entry.
2. **The use** (section 4). `valueReading`, kept for the document; `ValueInfo.reading` through `tokenRow` to every output; `hole-script` not said where the value is read; the panel's rows from a prototype first. The worked example on the value, as for a literal (`guardedEmbeddedExample`), with `sedScripts` taking known values from `expansionValue`; it may go in a step 2b if the PR is large. Tests: same as the literal, against the tools, nothing read, one command reading, the level of an error. A CHANGELOG bullet under `### New`.
   - **2b. The examples that need other known words.** The example of a use is made as a literal's is, but some examples read other words of the command, which `literalContent` gives only for a literal: the `-e` scripts of sed (`sedScripts`, from `expansionValue`) and the `-e` patterns of grep (`optionValues`), awk's options (`awkOptions`), printf's arguments and tr's sets. Until then those uses get the rows and no example.
3. **`[[ $x =~ $re ]]`** (section 5). Tests: the literal right side's rows, bash's own match against the literal form, the quoted form left out. Extends the bullet's entry in docs/changes/unreleased.md.
4. **The origin and the uses** (model). `VariableState.source` for every plain assignment; `valueOrigin` and `valueUses` (src/semantics/values.ts); `pattern-from-variable` reads `expansionValue`. The guard test and its known list, the row in sources.md. The origin test against bash. `expansionValue` is stricter than the state's `value` (settled, not dead, nothing failing around it), so `pattern-from-variable` may now be said where a value it skipped is not sure: the PR lists those changes ([sources.md](sources.md), section 2). No CHANGELOG entry unless a user sees a change.
5. **The assignment** (section 6). The rows on the string and the texts naming the uses, one reading or several, errors. Tests: the assignment cases, line order. The CHANGELOG bullet grows to say both lines. The entry "A known value in a hole" in docs/backlog-archive.md says what was built and what stays dropped (section 10). A line in the user guide (docs/guide/explained.md and its Japanese page).

An option: the assignment's rows need no new UI structure (they are children of the string, as for `PS1`), while the use's rows are a new kind of row. So steps 4 and 5 could ship before step 2, if the panel's prototype for step 2 takes long. Step 5 then needs the reading of a use without showing it on the use's line.

## 12. Decisions

The maintainer decided on 2026-11-10:

- **The plan and its step order** (section 11): approved.
- **The glob said once** (section 1.2), independent of the reading:
  - The argument's row loses its glob clause wherever the `unquoted-value-as-data` note is said for that word.
  - The note and the value line say "bash also reads it as a glob pattern (its `[A-Z]`, `[0-9]`) before grep gets it", in place of "it is a glob pattern".
  - Above the rows of a reading that assumes no match: "read below as grep gets it where no file name matches".
- **Different readings of one value** (`grep` and `grep -E`): no rows on the assignment and no warning; the text names each use and its flavour (section 6.2).
