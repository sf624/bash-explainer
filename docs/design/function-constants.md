# Values of top-level constants inside functions

Status: deferred: no gain measured (2026-10-27). Not built; kept as the record. The roadmap had it as the item "Values of top-level constants inside functions"; the maintainer moved reading sourced files into its place ([../roadmap.md](../roadmap.md), "Next" and "Done lately"). This page says where function bodies get no value today, what bash does there, the rule that would give one, where the rule lives, the steps, the tests, and the gain measured on the corpus and on real scripts. The gain is zero on both sets today (section 7). Section 10 has the question and the decision.

## 1. Today

The roadmap's text says that a function body gets no value, even for a variable set once at the top level before any call. That holds only for some bodies. Where the walk walks every call of a body, the body already gets values (src/semantics/walk/walker.ts, `call`; checked with the model on these scripts):

```bash
dir=/tmp/x
f() { echo "$dir"; }     # value /tmp/x today
f; f                     # (also: one call, calls from main(), calls in a loop)
```

The value is said where `StateModel.settled(n)` holds (src/semantics/values.ts, `shownWord`; the walk's `everywhere`). A body is not settled, and gets no value at all, in these cases:

| Case | Why the walk gives up | Example |
| --- | --- | --- |
| More than four calls with different states | `WALKS_PER_FUNCTION` = 4: the fifth state is not walked (`notWalked`), and the body goes into `unwalked` | `log() { echo "$dir: $1"; }`, called five times with a counter changed between the calls |
| Recursion, or deeper than `CALL_DEPTH` | the recursive call is not walked | `f() { echo "$dir"; [ "$1" = 2 ] \|\| f 2; }; f 1` |
| No call reaches the body | walked from its definition, with the later changes taken as unknown (`uncalled`) | a library of functions |
| A call from a body that is not settled | `unsettledBodies` | `g` called only from a recursive `f` |
| The function is not closed | it may run where the walk does not see it (`Trust.closed`): exported, named as an argument (`trap f EXIT`, `complete -F f`, `mapfile -C f`), called from a trap's text | `cleanup() { rm -rf "$dir"; }; trap cleanup EXIT` |
| The script is blind | nothing is trusted anywhere (`Trust.blind`) | any `source`, `eval "$x"`, `$cmd` |

In the examples of the table, the state the walk has at `$dir` in the body already holds `/tmp/x`, the merge of the walks it made (checked for every row but the fourth and the last). The walk drops the value because the body may also run with states it did not see. For a variable that only the top level sets, those unseen states have the same value. This page is about that.

The last row is not this item. A blind script has no value anywhere; [trust-per-position.md](trust-per-position.md) (deferred) and reading sourced files ("Not decided" in the roadmap) are about it.

## 2. What bash does

Each claim below was checked with bash 5.2.21, one fresh `bash -c` per snippet, in a cgroup with `FUNCNEST` set. The output follows the arrow (`|` separates lines).

**A function sees the variable of its caller, not of its definition (dynamic scoping).** So a local in any caller hides the top-level value from every function it calls:

- `x=top; g() { echo "g:$x"; }; f() { local x=loc; g; }; f; g` → `g:loc|g:top`
- `x=top; f() { declare x=d; echo "f:$x"; }; f; echo "after:$x"` → `f:d|after:top` (`declare` in a function makes a local)
- `x=7; f() { echo "f:$x"; }; g() { declare -i x; f; }; g` → `f:` (a bare declaration in a caller makes an unset local)
- `x=1; f() { echo "f:[$x]"; }; g() { local x; f; }; g` → `f:[]`
- `x="a b"; f() { printf "<%s>" $x; echo; }; g() { local IFS=; f; }; g; f` → `<a b>|<a><b>` (IFS too)
- `x=a; f() { echo ${x/a/&&}; }; g() { shopt -u patsub_replacement; f; }; f; g` → `aa|&&` (and the options a caller sets)

**Other writers anywhere change it for the calls after them.**

- `x=1; f() { echo "f:$x"; }; x=2 f; f` → `f:2|f:1` (a prefix assignment, for that call only)
- `x=1; f() { echo "f:$x"; }; ( x=2; f ); f` → `f:2|f:1` (in a subshell, for the calls in it)
- `x=1; f() { echo "f:$x"; }; g() { x=2; f; }; g` → `f:2` (a write in another function)
- `x=1; f() { echo "f:$x"; }; for x in a; do :; done; f` → `f:a`
- `x=1; f() { echo "f:$x"; }; g() { declare -n r=x; r=2; }; g; f` → `f:2`
- `x=1; f() { echo "f:$x"; }; f; eval "x=2"; f` → `f:1|f:2`
- `x=1; f() { echo "f:[$x]"; }; g() { unset x; f; }; g` → `f:[]`
- `x=1; unset x; f() { echo "f:[${x-unset}]"; }; f` → `f:[unset]`
- `x=1; f() { echo "f:$x"; }; . ./lib` with lib holding `x=lib` → `f:lib`

**A call before the assignment sees the value before it**, also when the call is hidden in a trap or a background job that the script starts before it:

- `f() { echo "f:[$x]"; }; f; x=1; f` → `f:[]|f:[1]`
- `f() { echo "f:[$x]"; }; [ -n "$HOME" ] || x=1; f` → `f:[]` (an assignment that does not run)
- `trap f EXIT; f() { echo "f:[$x]"; }; exit 0; x=1` → `f:[]`
- `f() { echo "f:[$x]"; }; trap f USR1; kill -USR1 $$; x=1; kill -USR1 $$` → `f:[]|f:[1]`
- `f() { sleep 0.2; echo "f:[$x]"; }; f & x=1; wait` → `f:[]` (the subshell copied the state when it started)
- `f() { echo "f:[$x]"; }; coproc { sleep 0.2; f; }; x=1; cat <&${COPROC[0]}` → `f:[]`

**A call after it sees it, wherever the call runs in this shell or its subshells:**

- `x=1; f() { echo "f:$x"; }; f & wait; echo "$(f)"; f | cat` → `f:1|f:1|f:1`
- `f() { echo "f:[$x]"; }; x=1; trap f EXIT; exit 0` → `f:[1]` (a trap set after it)
- `x=1; f() { echo "f$1:$x"; [ "$1" = 2 ] || f 2; }; f 1` → `f1:1|f2:1` (recursion)
- `x=1; f() { echo "f:$x"; }; for i in 1 2 3 4 5 6; do f; done | sort -u` → `f:1`
- `x=1; x=$x/b; f() { echo "f:$x"; }; f` → `f:1/b` (the last of several writers at the top level)
- `f() { echo "f:[$x]"; }; if true; then x=1; fi; f` → `f:[1]` (a writer inside a top-level compound command)

**But not in another bash**, which gets only what is exported:

- `x=1; f() { echo "f:[$x]"; }; export -f f; bash -c f` → `f:[]`
- `export x=1; f() { echo "f:[$x]"; }; export -f f; bash -c f` → `f:[1]`
- `x=1; f() { bash -c "echo c:[\$x]"; }; f` → `c:[]`

**Attributes and errors.**

- `x=abc; declare -u x; echo "[$x]"` → `[abc]`: a case attribute changes later assignments only. (The trust does not trust `x` after `declare -u` anyway.)
- `x=1; f() { echo "f:$x"; }; readonly x; export x; f` → `f:1`; `export -n x` too: `-r` and `-x` do not change the value.
- `local x=1` at the top level → `local: can only be used in a function`, status 1, `x` not set. A top-level `local` is not an assignment.
- `x=1` (line 1), `s=abc; : ${s:0:-9}; x=2` (line 3), `f` (line 4) → `substring expression < 0|f:1`: an error discards the rest of its line, and the next line runs with the value before.
- IFS does not come from the environment: `env IFS=: bash -c 'printf "[%q]" "$IFS"; x=a:b; printf "<%s>" $x'` → `[$' \t\n']|<a:b>`. bash sets it at start.
- `shopt -s nocasematch; x=ABC; echo "${x#a}" "${x/a/z}"` → `ABC zBC`: `nocasematch` changes `${x/p/r}` but not `${x#p}`. The word model reads the options each form needs from the state; this rule only decides which options that state knows.

## 3. The rule

A *key* is a variable, or an option of `set` or `shopt` (the kinds of `ShellState` the values read). A *writer* of a key is a command that changes it on some walk: an assignment, a declaration (`local` too), `unset`, `read`, `for`, `set`, `shopt`; a prefix assignment for a function or a builtin. (`local -` restores the options of `set` at a return; the `set` in the function that changed them is a writer already.)

**F1. A fixed key.** A key `k` is *fixed* when:

- the script is not blind, and for a variable, the trust trusts it (`StateModel.trusts`: every writer is a plain assignment the walk reads; no `read`, arithmetic, nameref, `eval` text, trap text, callback; not a variable bash changes itself); for an option, the allow-list already makes the script blind where the walk cannot follow a write of it;
- every writer of `k` is in a statement of the top level of the script's own text (wherever it runs inside that statement: a branch, a loop, a subshell): none in a function body, none in the text of a trap or an alias. (A writer in an `eval` string that a top-level statement runs counts as that statement's; a variable written there is not trusted anyway.)

Its *last unit* `U(k)` is the unit (src/semantics/walk/walker.ts, `units`: the top-level statements of one line) of the last top-level statement that holds a writer; for a key with no writer, the start of the script. Its *value* is the one the walk has at the start of the unit after `U(k)` (`at(first statement of that unit).run`), which merges the paths where an error discarded the rest of the line. A key with no writer has the walk's starting value: the options of the shebang, bash's IFS. A variable with no writer is never known (it may come from the environment), as today.

**F2. Runs after.** A node `n` *runs only after* the unit `U` when every way bash may run it starts after `U` ends:

- `n` is in the main text, outside every function body: its top-level statement is in a later unit than `U`.
- `n` is in the body of a function: the body's call link (`env(n)`, src/semantics/env.ts, `CallLink`) is not `unsure` (the function is closed and some call reaches it), and every call site in it runs only after `U`. The env model already gives the call sites from outside a group of functions that call each other (Tarjan's components), so recursion needs no case of its own.
- `n` is in a string the walk runs where it stands (`eval`), or in an alias's text: its command runs only after `U`.
- `n` is in a trap's action, or under a host link (bats): not in this plan (section 9).

**F3. The view.** Where `n` is not settled, the *fixed view* at `n` is the state in which every key fixed at `n` (fixed, with `n` running only after its last unit) has its value, and every other key is not known: every other variable absent (the trusted evaluator reads an absent variable as not known), every other option `unknown`, the functions and aliases not known. The value of an expansion in a body that is not settled is the one the word model gives with this state, under the other conditions of [expansion-values.md](expansion-values.md), section 3 (the code runs; bash expands it there; no other expansion of the statement may fail first, read with the same view).

Why F1 to F3 are sound:

- Dynamic scoping cannot hide the value: a local is a writer in a function body, so a variable some function makes local is not fixed (F1). The same for `local IFS`, and for `local -` with `set` or `shopt` in a function, for options.
- After `U(k)` ends, no command of the script changes `k` in the main shell or in a subshell started after it: every writer is in a unit up to `U(k)`, and the trust leaves no hidden writer (a sourced file, an unknown `eval` or `$cmd` make the script blind). A subshell started after `U(k)` copies the main shell's value.
- Every run of `n` starts after `U(k)` (F2): the calls the walk sees are the call sites, and the env model marks every function with other calls `unsure` (exported, named as an argument, called from a trap's text). A trap set before `U(k)` that calls `f` makes its `trap` command a call site before `U(k)`.
- The value at the start of the next unit is the walk's main-flow state, which is settled (the top level is not in a function body; a top-level loop that did not settle makes the value unknown, not wrong).

What stays without a value, on purpose:

- A value that differs between calls (`x=1; f; x=2; f`): `x` has a writer after the first call, so the call site of the first `f` is in a unit before `U(x)`. These are the per-call values of the roadmap's item "Values of a whole word, arrays, and per-call values in functions".
- A variable set in a function, even one called once at the top level (`init() { dir=/x; }; init; …`). See section 9.
- Code in a body that no walk ran outside dead code. The fixed view asks that some walk ran `n` live (`Walker.live`); a node only a dead-mode walk reached gets nothing. A node that a walk ran live because a condition was not decided may still be one bash never runs: that is the same as today in settled code, where an undecided condition gives values in both branches.

## 4. Where it lives

The rule is a read-only view over what the walk and the trust already found. The walk does not change, and nothing but the values reads the view.

What exists:

- `StateModel.trusts(name)` and `blind` (src/semantics/trust.ts): who may write a variable, and that nothing writes it unseen.
- `StateModel.env(n)` with `CallLink.sites` and `unsure` (src/semantics/env.ts): every place a body runs from, with recursion folded into components.
- `StateModel.unit(n)` and `at(n).run`: the units of the top level and the states at their starts.
- `StateModel.settled(n)` (the walk's `everywhere`): values.ts is its only reader today.

What is missing:

- **The writers of each key.** `StateModel.writes(n)` gives the variables a statement sets itself, but not its locals, and `setWrites(n)` only the options of `set`. `Walker.put` sees every change of every key (variables, locals, `set` and `shopt` options, also at a call's prefix assignments). It records today only the last node per key (`lastAt`). It would also record every node per key (`keyWriters: Map<string, Set<SyntaxNode>>`, on any walk, also in dead code and in the walks of uncalled bodies, which walk every statement at least once).
- **Whether a node ran live.** `Walker.live`, exposed as `StateModel.live(n)` (today only `dead` reads it).
- **The view.** A module src/semantics/fixed.ts: `fixedKeys(model)` computes once per model, for each key, whether it is fixed, its last unit and its state there; `fixedView(model, n)` gives the state of F3 (memoised per node), or undefined when `n` runs in no view (blind, another shell's string, a trap's action, not live). `StateModel.sure(n)` gives the state that holds wherever `n` runs: `at(n).run` where `settled(n)`, else the fixed view.
- **The word model with a given state.** `wordMeaning(n, model)` and `partMeaning` read `model.at(n).run`. They get an optional state (and a cache key per state), so that values.ts can ask with `sure(part)`. src/semantics/stops.ts (`mayStopAround`) reads the same state for the other expansions of the statement.

Nothing in src/explain/ changes: src/explain/values.ts asks `expansionValue` and `variableValue` as before. The worked examples follow (they use `variableValue`).

**Considered and not chosen: a summary walk.** Instead of a view, the walk could walk a fifth call (and a recursive one) once more from a widened entry (the merge of the entries, with the body's changes unknown), and mark the body settled. That would also give decisions and dead code in such bodies. But it changes the states every reader of the walk sees (unbound variables, names, status, the env model), and it does not cover hidden calls or uncalled bodies. The view touches the values only, and keeps the walk as it is.

## 5. Steps

Each step keeps every test passing.

0. **Probes and the counter.** Rows in test/fixtures/probes/values.json for the cases of section 2: five calls with different states, recursion, a call from a recursive function, a trap set before the assignment and one set after it (`trap f EXIT`), a background job started before it, a local, a `declare`, `local IFS` and `shopt` in a caller, a prefix assignment, a write in another function, a write in a subshell, `unset` at the top level, several top-level writers, a writer in a top-level `if`, an error that discards the rest of the line, an exported function. Today each lists its marker in `none` with the reason. The counter of section 7 goes to scripts/measure-values.ts (read as data, nothing run; the corpus of test/support/corpus.ts and a list of files), as [trust-per-position.md](trust-per-position.md), section 8, asks.
1. **The writers and the view, not used yet.** `Walker.keyWriters`, `StateModel.live`, src/semantics/fixed.ts and `StateModel.sure`. Unit tests (test/fixed-keys.test.ts) on the snippets of the probe rows: which keys are fixed at the markers, and why not. No output changes; the corpus snapshot (test/snapshot.ts) is byte-identical.
2. **Values from the view.** `wordMeaning` and `partMeaning` with a given state; `shownWord` and `stopsAround` use `sure(part)` instead of `settled(part)`. The probe rows of step 0 lose their `none` entries where bash agrees (the test fails on a stale entry). The decisions' generator (test/support/decisions.ts) calls its functions more often (more than four different states) and sets traps that call them, so that test/values.test.ts compares view values with bash. [expansion-values.md](expansion-values.md), section 3, says the new condition. Users see values inside functions that the walk could not follow at every call: CHANGELOG "New", one bullet, the examples in docs/changes/unreleased.md.
3. **Optional: hidden calls after the last unit.** A function named by `trap f SIG`, called from a trap's static text, or named by `mapfile -C`, where every such command runs only after `U(k)`: its body may run at any later moment, but always after `U(k)`. Needs the trust to give the commands that name each callback (`Scan.callbacks` keeps names only). Exported functions stay out (a child bash sees only exported variables, and may run before or after). This is the `trap cleanup EXIT` case.

## 6. Tests

- **Probes against bash** (test/value-probes.test.ts, test/fixtures/probes/values.json, recorded by scripts/record-probes.ts): every row of step 0. Where the model gives a value, every run of the marker in bash gave it; where it gives none, the row says why.
- **The differential test** (test/values.test.ts, test/support/decisions.ts): generated scripts run in bash, every value the model gives compared with what bash printed. The generator gets functions called five or more times with different states, recursion it already has (`rc`), and traps that call functions. The test asserts that some values come from the fixed view (not only from settled code), so that the view is exercised.
- **Unit tests** of src/semantics/fixed.ts: a key is not fixed with a writer in a function (a local, `declare`, a `local -` with `set -f`), in a trap's text, or with a variable the trust does not trust; `U(k)` is the last unit with a writer; a key with no writer starts from the walk's start; a node in a body whose link is `unsure` gets no view; a call site in the same unit as the last writer, or before it, gives no view.
- **Coverage**: every branch of fixed.ts is reached by those unit tests (coverage-floors.json stays empty).
- **The corpus snapshot** (test/snapshot.ts): step 1 changes nothing; step 2 changes only lines with values in function bodies, each read by hand.

## 7. Expected gain, measured

Measured at 5b396188 with a counter of the values of the model over two sets, read as data and never run (as [trust-allow-list.md](trust-allow-list.md), section 4, did): (a) the repository's corpus (test/support/corpus.ts: the fixtures, the host files and the snippets of the tests, 1,517 inputs not in zsh); (b) the 802 real scripts of that section (616 files of /usr/share/bash-completion, 142 of /usr/bin and /usr/sbin, 44 of /etc). Counted: the parameter expansions (`simple_expansion`, `expansion`) inside function bodies, and for each one with no value why not. Then, for each read of a variable the rule would fix (one writer, a top-level assignment, known there, every call after it), whether `expansionValue` gives a value once the node is taken as settled.

| Measure | (a) corpus | (b) real scripts |
| --- | --- | --- |
| Files blind as a whole | 213 of 1,517 | 667 of 802 (83%) |
| Expansions in function bodies | 24 | 17,050 |
| … in files that are not blind | 17 | 459 |
| … with a value today | 1 | 0 |
| … without one, in a settled body (variable not set by the script, or not trusted) | 1 | 169 |
| … without one, the function not closed | 0 | 274 |
| … without one, no call reaches the body | 15 | 14 |
| … without one, a call not walked | 0 | 2 |
| Reads of a fixed variable without a value today | 0 | 5 |
| **New values with the rule (steps 1–2)** | **0** | **0** |

The 5 reads in (b) are `trap cleanup EXIT` handlers (step 3) in add-shell, remove-shell and update-shells: `tmpfile="${file}.tmp"` with `file="$DPKG_ROOT/etc/shells"`, a value from the environment. They get no value with any rule. Taking every body of a closed function with calls as settled (unsound, an upper bound for any rule of this kind) gives no value beyond today's: 1 in (a), 0 in (b).

So in the files that are not blind, the walk is not what hides the values in bodies. What hides them is blindness. A count from the syntax alone, ignoring blindness (a variable with one writer in the file, a top-level assignment of static text, read in a function whose every call by name comes after it), finds in (b):

- 180 such reads in 27 files, all of them in blind files: 107 in 7 files blind by an `eval` of text not known (ucf, blkdeactivate, apt-key…), 55 in 14 files blind by `source` (the init scripts, byobu, dpkg), 10 in 4 by `-v` of a name not known, 6 in 1 by a command name not known, 2 in 1 by arithmetic.
- 16 more in functions called only through `trap` or another command that names them, after the assignment (step 3).
- 130 more in functions that nothing calls by name (libraries).
- None with a call before the assignment.

In blind files the rule cannot help, and neither can trust per position: a sourced file or an unknown `eval` may write the variable, or call the function, at any later point (trust-per-position.md, T2 and T6). Those 180 reads would need the sourced file read (the init scripts source `/lib/lsb/init-functions`; byobu and dpkg source files of their own package, through a variable; all outside a workspace), or the `eval` text known.

The research corpus of 536 scripts (expansion-values.md, section 6) and the 361 files of trust-per-position.md, section 8, are gone. That section found 39 reads of a top-level constant in functions on 358 files, all in blind files; with blindness ignored, 27 values in functions, all of which its rule T6 removes again. So the result is the same on three sets: on real scripts, the gain of this item alone is zero.

Where the rule does help is short hand-written scripts that are not blind: a `log` function called five times, a recursive function, a trap handler (step 3). These are common in tutorials and in what people paste into the web page, but neither set has them.

## 8. Risks

- **A hidden way to run a body.** F2 relies on the env model's `unsure` and the trust's `closed` to list every call bash may make. A new kind of hidden call (a builtin that runs a function by name, not in the allow-list) would make a view wrong. The allow-list of trust-allow-list.md makes such a builtin blind the script today; the differential test is the guard, and the reviews should try to find one.
- **A hidden writer.** F1 relies on the trust for variables and on the walk's `put` for options. A write the walk does not see (a builtin option the allow-list misses) would break it as it breaks every value today; the allow-list fails toward blind.
- **The walk's live marks.** A node that only a widened walk reached is taken as one that may run. That gives a value in code bash may never run, as an undecided condition does in settled code today. It never gives a value that contradicts a run.
- **Units.** Taking the state at the start of the next unit, and asking call sites to be in a later unit, loses `x=1; f` on one line. That keeps the rule simple; refine only if the probes show it matters.
- **Effort.** About 150 lines (fixed.ts, the walk's writers, `sure`, the state argument of `wordMeaning`), the probe rows and the generator. The view is memoised per node; `fixedKeys` is one pass over the writers.

## 9. Not in this plan

- **Per-call values** (`x=1; f; x=2; f`: "`1` at line 3, `2` at line 5"): the roadmap's item "Values of a whole word, arrays, and per-call values in functions".
- **Variables set inside a function that only the top level calls** (`init() { DIR=/x; }; init; main`): the writer is in a body. A later rule could count a function's writers as its call sites' when every call site is at the top level.
- **Decisions and dead code in bodies that are not settled.** The fixed view could decide a condition that reads only fixed keys (`[ "$mode" = debug ]` in a `log` function). But dead code also needs the status and the jumps of every call, which the view does not have.
- **Trap actions** (their own text, not the functions they call) and **bats' host calls**: values never shown there today (expansion-values.md, section 3); out of this plan.
- **Blind scripts**: [trust-per-position.md](trust-per-position.md) and reading sourced files.

## 10. For the maintainer

- The rule is sound on every bash check of section 2, and it is small: a view in values only, no change of the walk. But it gives no new value on the corpus or on the 802 real scripts, and the earlier sets gave the same. The bodies that would gain are in blind scripts, where only reading sourced files (or `eval` text) would help.
- So: build steps 0 to 2 now for the short hand-written scripts (a `log` function called five times, recursion, the web page), or leave the item after reading sourced files ("Not decided"), with step 0's probe rows as the record?
- Step 3 (`trap cleanup EXIT`) is the case users meet most in hand-written scripts. Include it with step 2, or keep it optional?

**Decided** (2026-10-27): steps 0 to 2 are not built now; this page stays as the record. Reading a file given to `source` in the workspace takes the item's place in the roadmap, since the bodies that would gain are in scripts blind by `source` or `eval`.
