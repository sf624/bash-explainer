# The values of expansions in Meaning

`msg="hello world"; echo $msg`: the token of `$msg` says what bash puts there, `hello world`, and that unquoted it becomes two words, `hello` and `world`. The roadmap's "Now" item ([../roadmap.md](../roadmap.md)). This page says which expansions get a value, when the value may be said, how it is shown, and how it is tested.

Status: the first set is built (this PR). What is left out is listed in "Not yet", with the open questions.

## 1. What a value is

The value is the semantic model's, not bash's output. The model reads the script's own assignments along the paths that reach the expansion (src/semantics/state.ts), and the word model reads what bash does to the expansion there (src/semantics/words.ts). Nothing is run. So the line says where the value comes from: "Value here, from the script:" / 「スクリプトから分かるここでの値:」. It is said on the token of the expansion, under its meaning, not as a note: it is not a fact of how bash reads the line, but of what the script put in the variable.

`expansionValue(part, model)` (src/semantics/values.ts, with `trustedPart` of src/semantics/words.ts) gives it, as `{ text, words?, glob }`:

- `text`: what the expansion gives (empty: an empty string).
- `words`: where the expansion is split (unquoted, in a context that splits: an argument, a `for` list, a redirection target), the fields it gives, by the IFS in effect (the word model's `splitPieces`). None for an empty value or one of IFS characters only; several for a value with IFS characters. Absent where it is not split (double quotes, an assignment, `[[ ]]`, `case`, a here-document, an empty IFS).
- `glob`: unquoted where pathname expansion applies (`set -f` off), with a glob character in a word. bash matches it against file names when the line runs; the model does not (it does not know the files), and the line says so.

The token (`Token.value`, src/analyzer-types.ts) has the value and its texts (`ValueSaid`, from `valueSaid` in src/messages.ts). src/explain/values.ts puts it on the token of the expansion; the dispatch calls it for every `simple_expansion` and `expansion` node (src/explain/dispatch.ts). No scan of the script in src/explain/.

## 2. Which expansions

The model already evaluates these for the word probes (the `Evaluator` of src/semantics/words.ts, checked against bash by test/fixtures/probes/words.json), and they get a value:

| Form | Example | Value |
| --- | --- | --- |
| `$x`, `${x}`, `"$x"` | `x='a b'` | `a b` (unquoted: `a`, `b`) |
| `${#x}` | `x=report.tar.gz` | `13` |
| `${x:-w}`, `${x-w}`, `${x:+w}`, `${x+w}`, `${x:?w}` (set) | `x=` | `${x:-d}` gives `d`, `${x-d}` an empty string |
| `${x%p}`, `${x%%p}`, `${x#p}`, `${x##p}` | `x=report.tar.gz` | `${x%.*}` gives `report.tar` |
| `${x/p/r}`, `${x//p/r}`, `${x/#p/r}`, `${x/%p/r}` | `x=banana` | `${x//a/o}` gives `bonono` |
| `${x:o}`, `${x:o:l}` with constant numbers | `x=abcdef` | `${x: -2}` gives `ef` |
| `${x^^}`, `${x,,}`, `${x^}`, `${x,}` (no pattern) | `x='hello World'` | `${x^^}` gives `HELLO WORLD` |

The operands may hold quotes and plain `$y` (`${x:-"$y"}`), read with the same values.

Left out, for now:

- Positional and special parameters (`$1`, `$@`, `$#`, `$?`, `$$`), and variables bash sets itself (`RANDOM`, `SECONDS`, `PWD`, `REPLY`, `BASH_*`): the trust rule never trusts them (src/semantics/trust.ts).
- Arrays and their elements (`${a[0]}`, `${a[@]}`, `$a` of an array), namerefs, indirection (`${!v}`, which makes the model trust nothing): the state does not follow array values.
- `${x@Q}` and the other transformations, `${x/p/&}` (`&` is the match with patsub_replacement), patterns with extended globs, offsets that are not constant numbers: the evaluator does not follow them.
- `${x:=w}`: it assigns, so `x` is not trusted.
- An expansion inside the word of another one (`$y` in `${x:-$y}`): bash expands it only when the outer one needs it; the outer one shows what it gives.
- Command substitution (`$(cmd)`, except `$(true)`-like constants), arithmetic (`$((…))`; a name read by arithmetic is not trusted).
- Shells other than bash: dash and zsh differ (no `${x/p/r}`, no splitting in zsh). An open question below.

## 3. When the value may be said

A wrong value is a bug. Where the model is not sure, it says nothing. The rule is the one the decisions of conditions use (semantics.md, 4.14), with the same allow-list (src/semantics/trust.ts), so a value is said only when all of these hold:

- Nothing makes the model blind (`StateModel.blind`): no `source`, no `eval` or trap of text not known, no `$cmd` that may be anything, no indirection, no DEBUG trap.
- Every variable the expansion reads (also through the assignments it was set from: `b=$a`) is trusted (`StateModel.trusts`): every command that may write it is a plain assignment (`x=w`, `x+=w`, `local`, `declare`, `export`, `readonly` with no option but `-r`, `-x`, `-g`), and no arithmetic, `read`, `mapfile`, `printf -v`, `${x:=w}`, array, nameref, trap action, `eval` string or callback writes it.
- The state there is the same on every path (`at(n).run`): set on every path to one known value. A value that differs between paths, between passes of a loop, or between the calls of a function is not known. A variable the script does not set may come from the environment: it is never known (also `HOME` for `~`).
- What the walk found there holds wherever the code runs (`StateModel.settled`, the walk's `everywhere`): not in a function that may be called where the walk does not see it (exported, named as an argument, called from a trap), not in a body no call reaches, not in a loop whose passes did not settle, not in a trap's action.
- The code runs (`StateModel.dead`): not in a branch whose condition is never met, not after `exit`, `return`, `break` or `continue`.
- The expansion is bash's, in the script's own shell or a string it runs itself (`eval`): not in a string another shell runs (`bash -c '…'`), whose values come from the environment it gets.
- It is not in a redirection of a command with no name (`a=1; a=2 >f$a` writes `f2`): bash makes the assignments first there, and the state the model has for the redirection is the one before them (an open gap of the word model too: `wordFields` gives `f1`).
- bash does not fail on it (`set -u` with an unset variable, `${x:?}`), and its splitting and globbing are known (an IFS not known, `set -f` on some paths, give nothing).

## 4. How it is shown

Meaning only, on the token of the expansion; Reading is unchanged.

- Panel (VS Code and the web page, media/panel.js `valueLine`): a line under the meaning, the lead muted, then the value and its words as chips with an edge, so that two words read as two and a space inside a word stays visible. `msg="hello world"; echo $msg`:

  `$msg` Expands to the value of `msg` (unquoted, it is word-split and globbed)
  Value here, from the script: [hello world]; unquoted, it is split into 2 words: [hello] [world]

  A quoted one shows the value alone; an empty one says "an empty string" ("…; unquoted, it is split and gives no word"); a glob says "Unquoted, it is a pattern: bash matches it against file names when the line runs (not done here)". Control characters are shown as pictures (`⇥`, `␊`), with what each one is; a value is cut at 80 characters, and a split one shows its first 12 words. This is the look the brace-expansion item of the roadmap wants for separate words (chips).
- The hover's part card: the line as a paragraph under the meaning; in the tables of parts, a small line under the row's text. A part that is the expansion alone (`$msg` as an argument) shows the value of its expansion (`valueOf`, src/ui/hoverParts.ts).
- Markdown (CLI `--format markdown`), the Language Server's hover: the line after a hard line break, under the row.
- CLI text: a line `= Value here, from the script: …` under the row, with the backticks kept (they show where each word starts and ends).
- JSON: `Token.value` as data (`text`, `words`, `glob`, `said`).

The worked examples of `${x%.*}` and the others keep their own sample values ("When `x=report.tar.gz`"); the value line is the script's.

## 5. Tests

- test/fixtures/probes/values.json (a probe kind, recorded by scripts/record-probes.ts and checked against bash by test/probe.test.ts) and test/value-probes.test.ts: each marker has one word, an expansion. Where the model gives a value, every run of the marker in bash gave those words; a value where bash did not run the marker fails. Where it gives none, the row lists the marker in `none` with the reason (a stale entry fails). The rows cover the forms above, splitting with the default IFS, a set one and an empty one, values with spaces and control characters, globs and `set -f`, prefix assignments and declarations, functions (called once, twice, never, exported), loops, subshells, pipelines, `$( )`, conditions decided and not, dead code, `read`, `source`, `eval`, traps, arithmetic, the environment, arrays, namerefs, indirection, `set -u` and `bash -c`.
- test/values.test.ts (test/support/values.ts): the generated scripts of the decisions' test, with words after each marker (`: Mk "$mode" "${#mode}" "${v%a}" … $v`); bash prints them through xtrace at every run, and every value the model gives must be bash's word. 120 scripts in the test; by hand, 1,500 scripts (seed 7) gave 38,426 values, 15,344 of them compared with a run, and no difference.
- test/expansion-values.test.ts: the cases where nothing is said, the texts in both languages, and each output.

The probes found two bugs of the models, fixed here: the words of a declaration were expanded after its earlier assignments (`a=1; declare a=5 b=$a` sets `b` to 1 in bash; the model had 5, and `local x=$x` read the new local), and the words in the body of `for (( ; ; ))` were taken as arithmetic (not split, no glob note).

## 6. Not yet, and open questions

- Shells other than bash: POSIX forms (`$x`, `${x:-w}`, `${x%p}`, `${#x}`) are the same in dash; show them in `sh` scripts too? zsh does not split.
- The worked examples could use the script's value when it is known, instead of a sample ("When `x=report.tar.gz`" while the script sets `x=a.txt`).
- A word made of several parts (`"$dir/$f"`): show the value of the whole word on the argument, not only of each part?
- Arrays (`"${a[@]}"`, the elements as chips) need the state to follow array values.
- In a function called with different values, show the values per call ("`1` at line 3, `2` at line 5")?
- Values in a string another shell runs: the exported variables that reach it are known (`export y=2; bash -c 'echo $y'`), but a variable already exported by the environment the script starts in also reaches it; left out until the model says which.
