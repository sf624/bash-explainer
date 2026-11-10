# Known values read in the command's language

A variable whose value the script makes known is read in the language of the command that uses it:

```bash
pattern='/^BEGIN/,/^END/p'
sed -n ${pattern} config.txt
```

Line 1 explains the string as a sed script: the range `/^BEGIN/,/^END/` and the command `p`, and says that line 2 reads it. Line 2 reads `${pattern}` as that script, under its value. This page says which values count, what each line shows, how it relates to holes, what it costs, where the facts live, and the steps.

Status: Tracked in #790.

The maintainer decided on 2026-11-10:

- The reading is shown on both lines, the assignment and the use.
- It comes after Python `re` (#759, #748–#753, #760).
- A design document first (this page).

It was dropped as rare on 2026-11-06 ("A known value in a hole", [backlog-archive.md](../backlog-archive.md)). The maintainer asked for it again on 2026-11-09, after two examples from real use (section 1).

## 1. What we say today

Both inputs were run with `npx tsx test/dump.ts FILE en` at e1ae5fa0.

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

Quoted, `grep -E "$pattern" ids.txt` shows the value line and nothing else: a regex that is one hole gives no rows (`readHoles`), and `pattern-from-variable` (src/pitfalls.ts) is left out for a known value with special characters.

## 2. When a value is known

The value is the one Meaning already shows ([expansion-values.md](expansion-values.md)). Nothing new decides it.

- **The value:** `expansionValue(part, model)`, with all of its rules: the trust allow-list (src/semantics/trust.ts, [trust-allow-list.md](trust-allow-list.md)), a state that is the same on every path (`at(n).run`), `settled`, not `dead`, no failure around it. A value it does not give is not read.
- **The form:** a plain copy of a variable, `$x`, `${x}`, `"$x"` or `"${x}"`. Not `${x%.*}` or `${x:-d}` in this plan: their values are known, but no assignment holds their text (section 4).
- **The word:** the expansion is the whole word. A value inside a larger word (`"s/$from/x/"`, `-e"$p"`, `--regexp="$p"`) stays as today (section 8).
- **One assignment:** for the assignment line, the value is the static text of one plain assignment that reaches the use on every path (section 4). The use reads any known value; the assignment shows only what its own text holds.

### 2.1 Quoted and unquoted

What bash makes of the word comes from the word model, not from the quotes: `wordFields(word, model, { files: [] })` (src/semantics/words.ts).

- **One field, equal to the value:** it is read. Quoted, this always holds. Unquoted, it holds when the value has no IFS character (no splitting) and no glob character, as `/^BEGIN/,/^END/p`.
- **A glob:** `files: []` asks the word model what bash gives where no file name matches. With nullglob and failglob off, that is the value itself, and it is read. The assumption is stated once on the line, by the note that is already there (`unquoted-value-as-data`): "a file name that matches it takes its place". The reading adds no text of its own about it (section 10).
- **nullglob, failglob, or either not known:** the word model gives no field, or none surely. Nothing is read.
- **Several fields** (`x='-e s/a/b/'; sed $x`): not read. The note says it is split, as today.

The empty list of files is an assumption asked of the word model explicitly, like the example's environment (`WordEnv`). It never reaches the line's word facts: `Token.value`, `LineExplanation.argv` and the model's fields stay as they are. Only the reading reads the field.

## 3. What the use shows

The use reads the value in the language that its place names, by the same path as a literal argument:

- The spec says which word is a script or a pattern, and in which language (`lang` of an operand or a value in src/dict/). Nothing looks at the command's name.
- The reader is `EMBEDDED[lang]` (src/embedded/registry.ts), with the use's context: the regex flavour (`grep` BRE, `grep -E` ERE, `sed -E`), tr's sets, the letters given, gawk or mawk (`EmbeddedContext`).
- Every place that gives a word to the readers today takes part: an operand (`positional`, src/explain/argv-shared.ts) and an option's value in its own word (`grep -e "$p"`, `sed -e "$s"`: src/explain/argv-options.ts).

### 3.1 The rows

The reading's tokens have no place of their own in the line: every character of the value sits on `${pattern}`. If they were children of the expansion with its span, the hover would land on the first of them (`shown` and `chainAt`, src/ui/hoverParts.ts), and the editor's colours would give one place many roles.

So the reading belongs to the value, not to the source:

- `ValueInfo.reading` (on `Token.value`): the reader's tokens, each labelled with its text in the value.
- The panel draws them under the value line, as it draws a token's children, at the depth a literal's reading has.
- The hover's part card for the expansion lists them as a table of parts under the value line. The hover and the cursor never land on one.
- Markdown and the CLI print them as rows under the `= Value here` line. JSON has them as data.
- The editor's colours take nothing from them.
- `tokenRow` (src/ui/tokenRow.ts) gives each output the field (test/row-source.test.ts).

The panel's look is a prototype first (a screenshot at 390 and 1280 px, light and dark), before the clean PR.

### 3.2 What else changes on the use's line

- `hole-script` ("depends on the value of `$s`") is not said where the value is read.
- The worked example runs on the value, as for a literal: the sed script on a sample input, the matching lines of a regex, the awk and jq examples. It is charged to the use's line (`withinLine`).
- An error the reader finds in the value (an unclosed `[`) is a token at the level `error`, so a problem of the use's line, through `reachedAt` as for a literal.
- `pattern-from-variable` reads the value through `expansionValue`, not `variables.get(…).value` (section 6).

## 4. What the assignment shows

### 4.1 Which assignment

A use names its assignment only when one plain assignment gives the value on every path to the use.

The state already keeps this for values that are not static text: `VariableState.source` is the value word of the plain assignment that gave it, and a merge keeps it only when both paths have the same word (`mergeVariable`, src/semantics/shellstate.ts). The plan sets `source` for every plain assignment, static text too. The word model reads `value` first and `source` only without it, so nothing it gives changes.

An expansion's origin is then that `source`, where:

- `expansionValue` gives the value (section 2);
- the variable's state has a `source`;
- its static text (`staticWordText`) is the value.

`if c; then p=a; else p=a; fi; grep "$p"` has two value words: the use reads `a`, and neither assignment shows a reading. `p=a; p+=b` has no one word: the same.

### 4.2 Which uses decide the language

The assignment line asks for the uses of its value word: the expansions whose origin is that word (section 6, `valueUses`). Each use with a reading (section 3) counts. Uses that read no language (`echo "$p"`) do not.

- **No use with a reading:** the line is as today.
- **One reading:** the string's token gets the reading's tokens as children, placed over the string's characters through its `Literal` (`staticWordText`, `literalOfMapped`), as the prompt strings are (`embeddedValue`, src/explain/assignments.ts). Its text adds which command reads it, and where: "read as a sed script by `sed -n`, line 2".
- **Several uses, one reading:** two readings are one when their tokens are the same (labels, kinds, texts, places in the value). Two `grep -E "$re"` lines are one reading. The text names every line: "by `grep -E`, lines 4 and 9". Past three lines, "lines 4, 9, 12 and 2 more".
- **Several uses, different readings** (`grep "$re"` and `grep -E "$re"`, or sed and awk): no rows on the assignment. Its text names each use and how it reads the value: "read as a basic regex by `grep` (line 4) and as an extended regex by `grep -E` (line 9)". Each use shows its own reading. Two sets of tokens over the same characters cannot share one place in the panel, the hover and the colours.
- **A reading with an error:** no rows on the assignment. Its text says which line reads the value and finds an error there. The problem is said once, at the use, where the command fails.
- **A use before the assignment:** it has another state, so it is not a use of this assignment.
- **A variable bash reads itself** (`PS1`, `PS4`: `variableLanguages`): it keeps bash's reading. Uses add nothing.

The names come from what each line already says: the command as written, the role the spec gives the word, and the reader's note on the flavour (`extended regex (ERE)`). The texts are entries of the catalog of token texts (src/messages-tokens.ts). A line number is written by `lineLabel` (src/i18n.ts), with the document's line in a host file.

### 4.3 The same whichever line comes first

The two lines read one reading, kept for the document. Explaining line 1 before or after line 2 gives the same rows (test/line-order.test.ts). Section 5 says how.

## 5. Cost

The walk and the models charge nothing, so each node is read once ([line-budget.md](line-budget.md), "Reading once").

- **The uses:** `valueUses(model)` is one pass over the script's expansions, kept by the model. Each expansion asks `expansionValue` once.
- **A reading:** `valueReading(use)` reads the value once per use. It is kept by the model, the language of the texts and the options that change a reading, as src/explain/whole.ts keeps a statement's walk. The line that asks first makes it; the other reads it. It has no example, and the readers charge nothing (none calls `guarded`), so it is the same whichever line asks. A reader that needs a limit later uses `guardedApart`, whose refusal does not depend on the line that asked.
- **The assignment line:** it reads the kept readings of its uses and compares them. Over the document, each use is read once, and each assignment looks at its own uses only: linear in the number of uses.
- **The example:** made on the use's line only, charged to its budget, as for a literal.

What may grow: a value of length L used U times costs U readings of length L. The value is text of the script, so this is at most the script's size times the number of uses.

## 6. Where the facts live

Two facts are new. Each gets a source and a guard, and a row in [sources.md](sources.md) section 3, in the PR that adds it.

| Fact | Source | Guard |
| --- | --- | --- |
| Which assignment's text an expansion copies, and the uses of each such text | `valueOrigin(part, model)` and `valueUses(model)` in src/semantics/values.ts, over `VariableState.source` and `expansionValue` | test/value-source.test.ts: no file outside src/semantics/ reads a variable's `value` from the state. Known list (test/fixtures/value-source-known.json): src/explain/reads.ts, `arrayKind` (a nameref's target is a name, not a value). The offender src/pitfalls.ts (`pattern-from-variable`) is fixed in step 2 |
| What a known value means in the language of a use | `valueReading(use, …)` in src/explain/embedded.ts: the reader of the use's spec, with the use's context, kept for the document | The same guard: no file but src/explain/embedded.ts calls `EMBEDDED[` (one call today) |

The reading's context comes from the use's command reading. Today `embeddedTextInner` builds `EmbeddedContext` from the line's `Explainer`. Step 1 builds it from a `CommandContext` instead, so that the assignment line can build it for a use on another line. That `CommandContext` comes from the model's reading of the use's command, `specRuns` (src/pitfalls.ts), which `pattern-from-variable` and `unquoted-value-as-data` already read. Stage SC2 of sources.md moves it to `commandRead(n)`. A test checks that, for every use in the tests, the flavour the use's line reads equals the kept reading's.

The holes are unchanged (`holedContent` in src/staticword.ts, `holeToken` in src/embedded/types.ts, `holeText` in src/explain/holes.ts): a value that is not known stays a hole, with its texts.

## 7. Tests

- **Same as the literal:** for each case, the reading at the use has the rows of the literal form (labels, kinds, texts), and the assignment's rows are the literal's, placed on the string. Cases: sed (addresses, `s`, `-E`), grep (BRE, `-E`, `-F`, `-P`, `-e`), gawk, jq, `find -name`, `printf`, `date +…`, tr.
- **Against the tools:** bash runs the variable form and the literal form on the same input, in a directory of its own, with GNU sed, GNU grep, gawk and jq: the same output and status. The glob cases run in an empty directory, and once more with a matching file, which must differ (the note's case). Through `runContained` (test/support/contained.ts), each table in one process.
- **Nothing read:** a split value, nullglob or failglob on or maybe on, a value set in a loop, by `read`, by `$( )`, in a function called from a trap, an array, a joined word, a blind script, zsh. Each keeps today's explanation.
- **The assignment:** one use, two uses with one reading, two with different readings, an error, a use before the assignment, a value used nowhere, `PS1`, a host file's line numbers.
- **The origin against bash:** in the generated scripts of test/values.test.ts, for each use and origin the model gives, the origin's text is replaced by a marker; bash's xtrace must show the marker at the use.
- test/line-order.test.ts, test/snapshot.ts (step 1 byte-identical), test/row-source.test.ts, the web tests of the panel's rows.

## 8. Out of scope

- Values from `read`, `mapfile`, `$( )`, arithmetic, the environment, or a loop whose passes differ: the model does not know them.
- Positional parameters and function arguments (`"$1"`), and functions called where the walk does not see it: not settled.
- Arrays (`"${a[@]}"`, `${a[0]}`): the state does not follow their values.
- A value inside a larger word (`"s/$from/$to/"`): the reading would mix tokens that have a place in the line and tokens that have none. Its holes stay as today, and each expansion shows its value.
- A value attached to its option (`-e"$p"`, `--regexp="$p"`): unread today for literals too ([backlog-archive.md](../backlog-archive.md)).
- Other forms than a plain copy (`${p%x}`, `${p:-d}`).
- A value split into several words, even where the spec could read each.
- A note that two uses read one value differently (`grep` and `grep -E`).

## 9. Steps

Each step is one PR that keeps every test passing.

1. **The reading's context from a command** (refactor). `EmbeddedContext` is built from a `CommandContext`, the use's word and the model (`embeddedContext`, src/explain/embedded.ts); `regexFlavor`, `trContext`, `given` and the gawk check take a `CommandContext`. Explanations stay byte-identical (test/snapshot.ts). No CHANGELOG entry.
2. **The origin and the uses** (model). `VariableState.source` for every plain assignment; `valueOrigin` and `valueUses` (src/semantics/values.ts); `pattern-from-variable` reads `expansionValue`. The guard test and its known list, the row in sources.md. The origin test against bash. `expansionValue` is stricter than the state's `value` (settled, not dead, nothing failing around it), so `pattern-from-variable` may now be said where a value it skipped is not sure: the PR lists those changes ([sources.md](sources.md), section 2). No other explanation changes, and no CHANGELOG entry unless a user sees one.
3. **The use** (section 3). `valueReading`, kept for the document; `ValueInfo.reading` through `tokenRow` to every output; `hole-script` not said where the value is read; the panel's rows from a prototype first. Tests: same as the literal, against the tools, nothing read. A CHANGELOG bullet under `### New`.
4. **The assignment** (section 4). The rows on the string and the texts naming the uses, one reading or several, errors. Tests: the assignment cases, line order. The CHANGELOG bullet grows to say both lines. The entry "A known value in a hole" in docs/backlog-archive.md says what was built and what stays dropped (section 8). A line in the user guide (docs/guide/explained.md and its Japanese page).
5. **The example on the use** (section 3.2). The worked example on the value; charged to the use's line. Tests: the same example as the literal form, against the tools. Extends step 3's bullet in docs/changes/unreleased.md.

## 10. For the maintainer

- **The glob said three times** (section 1.2). Recommendation: when the reading is shown, keep the note (it has the fix, `"${pattern}"`) and the value line, and drop the glob clause from the argument's row there. In step 3.
- **Different readings of one value** (`grep` and `grep -E`): no rows on the assignment and no warning. Recommendation: as written; a warning only if usability shows it is needed.
