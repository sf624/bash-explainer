# Where `set -e` stops the script (usability-9, U11)

Status: Tracked in #721. The prototype (#730) was tested in usability run 4 (section 9), and the questions are decided (section 10): the line note, with the three fixes run 4 found. Step U11 of [usability-9.md](usability-9.md).

The maintainer decided on 2026-11-08: on each line whose command can stop the script under `set -e`, one sentence says that if it fails, the script stops here, which trap runs then (and its line), and the status the script ends with. This page says which lines get it, what it says in each case, where it shows, what the models lack for it, how it is tested, and the steps.

## 1. Why

Run 3 of the usability test (the kit's RESULTS.md, R3.1 and R3.4, finding 1) gave ten users `nightly-backup.sh`: `set -euo pipefail` on line 3, `trap cleanup EXIT` on line 19, and `tar` on line 28, in a `for` loop. Task 8 (b) asked what happens if `tar` fails. All ten answered right: the script stops at `tar`, `cleanup` runs, and the status is not 0. Nine said they answered from their own knowledge, and nine put it in their top three costs.

What the page shows today, checked on main (e1174686) with `test/dump.ts` and the line's sentence:

- Line 28's "In short" is "Runs `tar` (create or extract tar archives)." Its only `set -e` text is on `$(dirname …)`: "If it fails, `set -e` does not stop the script (the status is that of `tar`)". Four users quoted it.
- Line 3's `-e` row says what `set -e` does in general; line 19's idiom note says the trap runs "when the script exits, however it exits".
- Line 17 (`rm`, in `cleanup`) is the only line whose "In short" says `set -e` stops something: "if it fails, `set -e` stops the shell it runs in (the script or a subshell)".
- No line says the exit status. Nothing ties line 28 to lines 3 and 19.

"In short" says nothing where `set -e` stops the script, by design: panel-redesign.md, P5, found it noise when said on every line. The maintainer's decision reverses that. The cost is length, which all ten users of run 3 also paid ([usability-9.md](usability-9.md), 2.7). So the sentence has to be short, and must not repeat what the line already says.

## 2. What bash does

Each case below ran in bash 5.2.21 and in bash 5.3.0, in a cgroup (`systemd-run --user --scope -p MemoryMax=1G`, `FUNCNEST=50`). Both versions gave the same results. `sh -c 'exit N'` stands for a command that fails with status N. `T` is the output of an EXIT trap.

| Case | Script (after `set -e`) | Status | Output |
| --- | --- | --- | --- |
| A command at the top | `trap "echo T" EXIT; sh -c "exit 3"; echo after` | 3 | T |
| In a `for` loop | `for i in 1 2 3; do echo i$i; sh -c "exit $((i-1))"; done; echo after` | 1 | i1 i2 T |
| In a function called at the top | `f() { sh -c "exit 4"; echo inf; }; f; echo after` | 4 | T |
| A pipeline, with pipefail | `sh -c "exit 2" \| sh -c "exit 3" \| true` | 3 (the last stage that fails) | T |
| A pipeline, without pipefail | `false \| true; echo after` | 0 | after T |
| An assignment of `$( )` | `x=$(sh -c "exit 6"); echo after` | 6 | T |
| `local x=$( )` | `f() { local x=$(sh -c "exit 6"); echo inf; }; f` | 0 | inf after |
| `$( )` without inherit_errexit | `x=$(sh -c "exit 3"; echo y)` | 0 | after y |
| `[[ ]]`, `(( ))` at the top | `[[ -d /nope ]]`; `i=0; ((i++))` | 1 | |
| A command not found | `no_such_cmd` | 127 | the error, T |
| `echo` to a closed stdout | `echo hi >&-` | 1 | write error, T |
| In a condition, left of `&&`, after `!`, `\|\| true` | `if f; then …`, `false && x`, `! true`, `false \|\| true` | 0 | goes on |
| A function called left of `\|\|`, then alone | `f \|\| echo or; f` | 3 | (the first call goes on) |
| In `( )` | `( sh -c "exit 3"; echo insub ); echo after` | 3 | T, once: the subshell does not run the main shell's EXIT trap |
| A trap set after the failure | `sh -c "exit 3"; trap "echo T" EXIT` | 3 | nothing |
| A trap taken back, or set on some paths | `trap … EXIT; trap - EXIT` (also `trap EXIT`, `trap "" EXIT`); `if [ -n "$X" ]; then trap …; fi` | 3 | nothing |
| In a pipeline stage, with pipefail | `true \| { sh -c "exit 3"; echo in; } \| cat` | 3 | T, once (the main shell's) |
| A trap set in a function, or in `( )` | `g() { trap "echo T" EXIT; }; g; …` / `( trap "echo T" EXIT ); …` | 3 | T / T (the subshell's own, at its end) |
| The trap's function defined after the `trap` | `trap cleanup EXIT; cleanup() { echo C; }; sh -c "exit 3"` | 3 | C |
| The trap's function never defined | `trap cleanup EXIT; sh -c "exit 3"` | 127 | command not found |
| The trap sees the status | `trap "echo st=\$?" EXIT; sh -c "exit 3"` | 3 | st=3 |
| The trap fails (set -e is on in it) | `c() { sh -c "exit 7"; echo inc; }; trap c EXIT; sh -c "exit 3"` | 7 | (`inc` does not print) |
| The trap fails, the script did not | same, then `true` | 7 | |
| The trap fails, kept | `trap "false \|\| :" EXIT` / `trap "set +e; false" EXIT` | 3 | |
| The trap calls `exit 5` | `trap "exit 5" EXIT; sh -c "exit 3"` | 5 | |
| An ERR trap | `trap "echo ERR" ERR; trap "echo T" EXIT; sh -c "exit 3"` | 3 | ERR T |
| An ERR trap and a function | `trap "echo ERR" ERR; f() { false; }; f` | 1 | nothing; with `set -E`: ERR |
| An ERR trap and `( )` | `trap "echo ERR" ERR; ( false; echo in )` | 1 | ERR once, the main shell's for `( )`; with `set -E`, twice |
| The ERR trap calls `exit 9` | `trap "exit 9" ERR; sh -c "exit 3"` | 9 | |
| `set -u`, a variable not set (a script file) | `echo "$nope"`, with or without `-e` | 1 | the error, T |
| A sourced file | `. ./s.sh` where s.sh fails | 3 | T |

What follows for the sentence:

- The script stops at the failing command. Nothing after it runs: not the rest of the loop, not the lines below.
- A failure in a function's body stops the whole script, not only the function.
- The EXIT trap that runs is the one set when the command fails: not one set later, taken back, or set in a subshell. A subshell does not run the main shell's EXIT trap. The ERR trap runs first, but not in a function unless `set -E` is on.
- The status is the command's (a pipeline's, by pipefail; an assignment's last `$( )`'s). The EXIT trap can change it. `set -e` is still on in the trap, so a command that fails there ends the trap and gives its own status; an `exit N` there gives N. So "with `tar`'s status" holds only while the trap does not fail.

## 3. Which lines

**The rule.** Statement `n` gets the sentence where the status model says a failure of it stops a shell and that it can fail:

- `statusModel(state).errexit(n)`: `active === 'on'`, `checked === true`. This already leaves out conditions, the left of `&&` and `||`, `!`, `$( )` without inherit_errexit, functions called from those places, a pipeline's stages (the pipeline is checked), jobs, and assignments that are part of a command.
- `mayFail(n)`. This already leaves out `:`, `true`, `exit N`, `return N`, an assignment with no `$( )`, a function definition, and a job.
- The line is reached: nothing when the shell surely stops before it (`Explainer.reachedAt`) or when the statement runs only in dead code (`.dead(n)`).
- No problem of the line already says what `set -e` does there. Those are the catalog entries whose `says` holds `errexit`: `postfix-increment-status`, `pipefail-missing`, `failure-reported-as-success`, `function-last-test-stops-script`, `declaration-masks-status`… This is the check "In short" makes today (`clausesOf`).

**What the model lacks.** Five things, each designed in section 6:

1. **G1, the traps in effect at a point.** Nothing says which EXIT or ERR trap is set at `n`. The walk keeps the trap actions in order to run them later (`Walker.traps`, src/semantics/walk/walker.ts), and `runsAtExit` (src/semantics/scriptstops.ts) scans the script for later `trap` and `exec` commands, by name. Neither one gives the state at a point.
2. **G2, builtins that fail only on a usage or write error.** `mayFail` is true for `continue`, `trap cleanup EXIT`, `set -euo pipefail`, `export X`, `echo …`. A sentence there is noise. `succeeds` and `cannotFail` (src/semantics/status.ts) decide nearby facts by comparing names (`true`, `:`, `echo`, `printf`, `cat`).
3. **G3, a call of a function whose failures all stop inside it.** For `log "…"` (lines 24, 30 and 34), `mayFail` is true. But a failure of `logger` or `echo` in `log` stops the script on line 12 or 13, not at the call. The call itself fails only when the body returns non-zero without stopping (`return 1`, a last `test && cmd`).
4. **G4, a command in a trap's action.** For line 17, `stops` is `unknown`, because the action runs through the trap's slot. bash runs it in the shell that set the trap. A failure there ends the trap, and the script exits with that status (section 2).
5. **G5, what the trap's action does to the status.** Whether the action may fail, or calls `exit`. This is `mayFail` over the action's statements, plus an `exit` among them.

**Counted** with today's model, the rule above and an estimate of G2 (a draft list of 15 builtins), by a probe script that is not committed:

| Corpus | Lines with code | Get the sentence | Left out by G2 | Stop another shell |
| --- | --- | --- | --- | --- |
| test/fixtures/sample.sh (`set -euo pipefail` on line 4) | 108 | 65 | 20 | 4 |
| nightly-backup.sh | 23 | 10; 7 with G3 (8, 12, 21, 27, 28, 29, 33) | 3 (13, 19, 25) | 1 (17) |
| the kit's other scripts (backup, logins, args, getopts) | 17 | 0 | 0 | 0 |
| test/fixtures/snippets.json (2,075 snippets) | 2,409 | 3 | 0 | 0 |

The corpus has almost no `set -e`, so the step adds snippets (section 7). On sample.sh, more than half the lines get the sentence. That is the decision's cost: it is said on every such line.

## 4. What it says

One sentence, from one catalog fact, `errexit-stops-here` (src/messages-facts-status.ts). It cites 4.3.1 The Set Builtin, 4.1 Bourne Shell Builtins (`trap`) and 3.7.5 Exit Status, and 3.2.3 Pipelines for a pipeline. Its level is `note` (section 5). Its params come from the models only:

- `what`: the command's name; `$( )` for an assignment's substitution; "the pipeline"; or the test (`[[ … ]]`, `(( … ))`). With several stopping statements on the line, their names (up to three).
- `stops`: `script`, `subshell`, `trap` (G4) or `unknown`.
- `err`, `exit`: the ERR and EXIT traps in effect (G1): none; set, with the line of the `trap` and its action's name (a function, or the start of the string); or maybe, with the line. For EXIT also `later`: none yet, but the main shell sets one after this line (run 4, fix 1), with its line and action.
- `stops: 'test'` in a bats test (G6): a failure fails the test, not the script (run 4, fix 2).
- `status`: the command's, the pipeline's, or the substitution's. `changes`: the action may fail, or calls `exit` (G5).

Drafts (`line 19` from `lineLabel`; the Japanese follows docs/japanese-style.md):

| Case | English | Japanese |
| --- | --- | --- |
| No trap | If `mkdir` fails, `set -e` stops the script here, with `mkdir`'s exit status. | `mkdir` が失敗すると、`set -e` でスクリプトはここで終わり、`mkdir` の終了ステータスで終了する。 |
| An EXIT trap (line 28) | If `tar` fails, `set -e` stops the script here: the EXIT trap of line 19 runs `cleanup`, and the script exits with `tar`'s status (or `cleanup`'s, if it fails). | `tar` が失敗すると、`set -e` でスクリプトはここで終わり、行 19 の EXIT トラップの `cleanup` が実行され、`tar` の終了ステータスで終了する（`cleanup` が失敗したときはそのステータス）。 |
| The action cannot fail | … and the script exits with `tar`'s status. | …、`tar` の終了ステータスで終了する。 |
| The action calls `exit` | … the EXIT trap of line 19 runs `cleanup`, which sets the exit status with `exit`. | … 行 19 の EXIT トラップの `cleanup` が実行され、その `exit` が終了ステータスを決める。 |
| A trap set on some paths | If `tar` fails, `set -e` stops the script here, with `tar`'s status; the EXIT trap of line 19 runs first if it was set. | `tar` が失敗すると、`set -e` でスクリプトはここで終わり、`tar` の終了ステータスで終了する（行 19 の EXIT トラップが設定されていれば、先にそれが実行される）。 |
| An ERR trap too | … here: the ERR trap of line 4 runs, then the EXIT trap of line 19 runs `cleanup`, … | … 行 4 の ERR トラップ、行 19 の EXIT トラップの `cleanup` の順に実行され、… |
| A pipeline | If the pipeline fails, `set -e` stops the script here, with the pipeline's status. | パイプラインが失敗すると、… パイプラインの終了ステータスで終了する。 |
| `$( )` in an assignment (line 27) | If `basename` in `$( )` fails, `set -e` stops the script here, with `basename`'s status. (`$( )` alone when it holds more than one command.) | `$( )` の中の `basename` が失敗すると、… `basename` の終了ステータスで終了する。 |
| Before the trap is set (line 8; run 4, fix 1) | If `date` in `$( )` fails, `set -e` stops the script here, with `date`'s status; no EXIT trap is set yet, so `cleanup` (line 19) does not run. | `$( )` の中の `date` が失敗すると、`set -e` でスクリプトはここで終わり、`date` の終了ステータスで終了する（EXIT トラップはまだ設定されていないので、行 19 の `cleanup` は実行されない）。 |
| In a bats test (G6; run 4, fix 2) | If `cat` fails, the test fails here: its remaining lines do not run, `teardown` runs, and bats goes on with the next test. | `cat` が失敗すると、テストはここで失敗する。残りの行は実行されず、`teardown` が実行され、bats は次のテストに進む。 |
| A test | If `[[ … ]]` is false, `set -e` stops the script here, with status 1. | `[[ … ]]` が偽だと、… 終了ステータス 1 で終了する。 |
| A subshell | If `x` fails, `set -e` ends the subshell here, with `x`'s status. | `x` が失敗すると、`set -e` でサブシェルはここで終わる（終了ステータスは `x` のもの）。 |
| Not known which | If `x` fails, `set -e` stops the shell it runs in (the script or a subshell). | today's clause, unchanged |
| In the EXIT trap (line 17, G4) | If `rm` fails, `set -e` ends the EXIT trap here, and the script exits with `rm`'s status. | `rm` が失敗すると、`set -e` で EXIT トラップはここで終わり、スクリプトは `rm` の終了ステータスで終了する。 |

The sentence does not add "the rest of the loop does not run": "stops the script here" already says that nothing after it runs, and a loop clause costs about a line on a phone (Q3). In a function body, "here" is right: the script stops at that line, whichever call ran it (section 2).

## 5. Where it shows

**A line note, at the level `note`.** Not `info`: an `info` note is a problem (the Problems pane, a blue squiggle, `--check`, SARIF; [three-levels.md](three-levels.md), section 1). That would put a problem on 65 lines of sample.sh. A note at `note` level is "a fact of how the shell runs the line": it has the mark ℹ, no squiggle, and no entry in Problems.

It is anchored on the statement (`cx.note(fact(…), n)`). It is made in src/explain/status.ts beside `substitutionStatus`, today's source of the `set -e` texts on tokens, so both read the same `errexit` context. The panel draws `#notes` right under "In short" and the problems box (src/ui/panelView.ts). On line 28, which has no problem, the note is the second thing the reader sees. It shows at depths 1 and 2.

**What it replaces, so nothing is said twice:**

- "In short" drops `S.errexit`, its clause for a statement that stops a subshell or a shell not known: the note now says that, as on line 17. It keeps `errexitList`: in an AND or OR list, only the last command stops the shell, which is about the list, not about a failure. The clause name `errexit` stays for the `says` check.
- The token text of `$( )` in an assignment with no command (line 27) loses "Under `set -e` the script stops here if it fails". It keeps why the status is the substitution's: "a command with no name … takes the status of its last command substitution". Line 27's note says the stop.
- The token text "If it fails, `set -e` does not stop the script (the status is that of `tar`)" (line 28's `$(dirname …)`) stays. It says a different fact, and line 28's note now says what `tar`'s status does.
- Line 3's `-e` row and line 19's idiom note stay: they are general.

**The `trap … EXIT` texts (run 4, fix 3).** Line 19's idiom note says the trap "runs clean-up when the script exits, however it exits" (`idiom-exit-trap`, src/messages-idioms.ts), and its "In short" says "registers a command that runs when the script exits, however it exits" (`exitTrap`, src/messages-sentence.ts). Neither is true of SIGKILL (u37). Measured in bash 5.2, `trap 'echo T' EXIT`, then:

| How the shell ends | The trap runs | Status |
| --- | --- | --- |
| The end, `exit`, a failure under `set -e` | yes | (section 2) |
| `kill -TERM $$`, `-INT`, `-HUP` | yes | 143, 130, 129 |
| `kill -QUIT $$` | (bash ignores SIGQUIT and goes on) | |
| `kill -KILL $$` | no | 137 |
| `exec true` | no: the shell is replaced | 0 |
| `exec 3>/dev/null` (redirections only) | yes: the shell goes on | 0 |

Both texts become, in U11b: "runs when the script exits: at its end, on `exit`, on an error, or on a signal such as SIGTERM or SIGINT; not when it is killed with SIGKILL, nor when `exec` replaces the shell with a command (`exec cmd`)" (ja: 「スクリプトが終わるとき（最後まで実行したとき、`exit`、エラー、SIGTERM や SIGINT などのシグナル）に実行する。SIGKILL で殺されたときと、`exec cmd` でシェルがコマンドに置き換わったときは実行されない」). The short form in "In short" keeps the first half only: "registers a command that runs when the script exits (not on SIGKILL)".

**The cost, measured** in the web page with CI's fonts (IPAGothic, WenQuanYi), on nightly-backup.sh at depth 1, with the drafts above drawn in `#notes` (the second row of the table in section 4, 170 characters in English and 105 in Japanese, by a measuring test that is not committed):

| Width | Line 28's page | + the note | + the same as a clause of "In short" |
| --- | --- | --- | --- |
| 390, en | 1,064 px | +76 px | +59 px |
| 390, ja | 1,047 px | +95 px | +39 px |
| 1280, en | 776 px | +57 px | +19 px |
| 1280, ja | 737 px | +76 px | +20 px |

At depth 2 the figures are the same within 1 px. On lines 21 and 27 they are the same as on line 28. Scripts without `set -e` gain nothing: s1 to s4 of test/web-depth.test.ts have none, so their budgets do not move (s2 included). On a phone, the sheet at half height shows 336 px of the panel, so the note costs about a quarter of the view. The case "no trap" is 70 characters: two lines at 390, about 40 px (estimated, not measured). As a clause of "In short", the sentence costs less but reaches only the panels (below), and it makes "In short" run on, which U7 just removed (2.7).

## 6. Outputs, and what the models need

**Outputs.** A line note is read by every output: the VS Code panel and the web panel (`#notes`), the hover's line card, Copy as Markdown, and the CLI's explanation and JSON (`facts`, with the id). "In short" reaches only the two panels and the phone's summary row. The note is no problem, so none of the following change: `--check`, SARIF, the GitHub annotations, the Problems pane and the web page's Problems list.

**G1: traps in the state** (src/semantics/state.ts, the walk). `ShellState.traps` holds, for `EXIT` and `ERR`, one of: none; set, by a `trap` command (node, action); maybe (set on some paths: a join of states that differ); or unknown (a signal list or an action the walk cannot read).

- The walk's `trap` builtin (src/semantics/walk/builtins.ts, where it already reads the signals) writes it. `trap - EXIT` and `trap EXIT` take it back. `trap '' EXIT` sets "nothing runs".
- A subshell, `$( )` and a pipeline stage start with none: bash resets the traps there (section 2).
- A function body reads the join of its calls' states. For ERR, a function body, a subshell and `$( )` start with none unless errtrace is on (`set -E`).
- `runsAtExit` (src/semantics/scriptstops.ts) then reads the state at the end of the script instead of scanning for `trap` and `exec` by name. That is one source for both.
- The probe table test/fixtures/probes/state.json gets rows for each case of section 2, compared with bash. The marker is `trap -p EXIT`, printed at a point. In a subshell, `trap -p` still prints the main shell's trap (measured), so the subshell rows check what the trap prints when the shell exits instead.
- A row in docs/design/sources.md (the fact and its source), and a guard: the readers of `trap` by name outside the walk, as a known list that may only shrink.

**G2: a spec field** in src/dict/types.ts for builtins: `fails: 'usage'`, "fails only when its words are refused or its output cannot be written". It goes on `continue`, `break`, `trap`, `set`, `shopt`, `export`, `readonly`, `alias`, `unset`, `echo` and `umask`. It also goes on `local`, `declare` and `typeset`, but only without `$( )`: their `$( )` has the `declaration-masks-status` pitfall. `mayFail` reads it (it is a spec field, not a name in src/semantics/), and `cannotFail` and `succeeds` read the same field instead of their name checks where they mean the same. `printf` (a bad number fails), `cd`, `read`, `shift` (with no arguments left), `source`, `wait`, `test` and `[` can fail in normal use and do not get it. This is a field of the spec, not a name check, as CLAUDE.md ("Design") asks.

**G3: calls.** `mayFail` of a call of a function is whether its body can end with a non-zero status that `set -e` did not stop. That happens with a `return` whose status may not be 0, or a last statement where `set -e` is ignored there (`test && cmd`, `cmd || other`). statusfacts.ts's `function-last-test-*` already finds the second case for its pitfalls: one function, `returnsFailure(def)` in src/semantics/status.ts, serves both. On nightly-backup.sh, this takes the sentence off lines 24, 30 and 34.

**G4: `stops: 'trap'`** for a statement that runs only in an EXIT trap's action, whose trap was set by the main shell: the env's slot link with `later` (as `posixExit` reads it today). A function called both from the trap and elsewhere stays `unknown`.

**G5** is `mayFail` over the action's statements (a function's body, or the string's statements, which the walk already parses), plus an `exit` among them. It is memoized per trap.

**G1, `later` (run 4, fix 1).** Where the EXIT trap is none at `n`, the first `trap … EXIT` of the main shell after `n` on its path, read from the walk's trap list (`Walker.traps`, in the order the walk met them), with its line and action. A trap set only in a branch after `n` gives no `later`.

**G6: bats tests (run 4, fix 2).** In a bats file the region carries how bats runs it (`HostRun`, `batsRun` in src/hosts/bats.ts), and the walk calls each test function from it. Checked with bats-core 1.13 (the devDependency):
- A failing command in a `@test` fails that test (`not ok`), and the test's remaining lines do not run.
- `teardown` runs, and bats goes on with the next test.
- `run false` does not fail the test: `run` returns 0 and keeps the status in `$status`. `run -1 true` and `run ! true` do fail it (`run -N`, `run !`).

So:
- `stops` is `test` for a statement whose shell is a test's process (the env's host link to a test function). The note then says the test fails, never "the script".
- `run`'s spec gets the status rule of a wrapper whose status is 0 unless `-N` or `!` is given. `mayFail` reads it, so a plain `run cmd` gets no note. That is the fact the row below `run` already says (test.bats line 10).
- Outside a test (`setup_file`, the file's top level), the note follows the same rule as a script only where the walk knows the process. Elsewhere there is no note: `teardown` and `teardown_file` ignore `set -e` (docs/design/bats.md).

**The line budget.** Nothing new is walked: `errexit`, `mayFail` and the traps are memoized per node or per trap, and the note is made once per statement. No recursive call sits inside `s(ja, en)` ([line-budget.md](line-budget.md)).

## 7. Tests

- **Against bash: the note's claims.** A probe table, test/fixtures/probes/errexit-stop.json, with the cases of section 2 and the corpus's shapes (a loop, a function, a pipeline with and without pipefail, an assignment, a test, a subshell, traps set before, after, on some paths, in a function, in `( )`; an action that fails, that calls `exit`; ERR with and without `-E`). Each row is a script with one marked failing command (`sh -c 'exit N'`).
  - The test reads the note's params on that line: whether there is a note, `stops`, the traps and their lines, the status.
  - It runs the script in bash (`runContained`, test/support/contained.ts), with markers. A marker after the command must not print. Each trap's action prints its own marker, and only those named must print. The exit status must be N, or the action's where `changes` says so.
  - It also checks the other way: on a line with no note, bash goes on after the failure.
  - It runs with bash 5.2, and with 5.3 from `$BASH_EXPLAINER_BASH53`.
  - Rows for run 4's fix 1: a failure before `trap … EXIT` (no marker of the trap, and the note names the later trap), and after it.
- **Against bats-core (G6).** test/bats-real.test.ts gets a test file with a failing command in a test, `run false`, `run -1 true` and `run ! true`, and a `teardown` that prints a marker. The notes' claims (the test fails, `teardown` runs, the next test runs; no note on a plain `run`) are checked against what bats prints.
- **The `trap … EXIT` texts (fix 3).** A row per way of ending of section 5's table, run in bash.
- **The corpus.**
  - Over sample.sh, the fixtures and the snippets: every note satisfies the rule of section 3, and no line has both the note and a problem whose `says` holds `errexit`.
  - test/linesentence.test.ts loses its `set -e` cases of `S.errexit`; those cases move to the note's test.
  - The probe rows become snippets, so `scripts/extract-snippets.ts` and the counts the snippets pin (argv-known.json, command-tokens-known.json) are regenerated.
  - The `test/dump.ts` output of sample.sh is checked for the new notes.
- **The guards.** note-strings (a catalog fact, no inline text), note-levels (the level from the table), explain-imports (no command name compared in src/explain/: G2 is a spec field), the Japanese style test, problem-heads (a `note` needs no headline), and test/state-probes.test.ts for G1.
- **Web.** test/web-sentence.test.ts or a neighbour: line 28 of a `set -e` script with a trap shows the note in `#notes` right after `#short`, at 390 and 1280, in both languages, with each code span drawn as one `code` element. The accessibility tree reads the note as text with its ℹ named. The budgets of test/web-depth.test.ts do not change (no `set -e` in s1 to s4). nightly-backup.sh line 28 gets a budget of its own at depth 1, from CI's figures.

## 8. Steps

1. **U11a, the model (no change users see).** G1 (the traps in the state, `later` included, its probes, `runsAtExit` reading it, the sources.md row and its guard), G2 (the spec field, read by `mayFail`, `cannotFail` and `succeeds`), G3 (`returnsFailure`), G4, G5 and G6 (`stops: 'test'` in bats, and `run`'s status rule). Its tests are probes and unit tests; the explanations do not change, except where `cannotFail` reads the spec field. That PR lists those changes, if any.
2. **U11b, the note.** The catalog fact with its drafts, the cases of run 4's fixes 1 and 2 included; the `trap … EXIT` texts of fix 3; `errexitStopNote` in src/explain/status.ts; `S.errexit` dropped from "In short"; the token text of line 27 shortened; the probe table against bash, the corpus checks, the web test; CHANGELOG bullets: one under "New" ("Under `set -e`, a line whose command can fail says that the script stops there, which trap runs, and its exit status") and one under "Fixed" ("`trap … EXIT` no longer says it runs however the script exits: not on SIGKILL"), with the examples in docs/changes/unreleased.md; [usability-9.md](usability-9.md) and this page's status updated.

Decided while building U11a:

- G4 and G6 are a field of their own, `ErrexitContext.within` (`exit-trap`, `test`, `host`), not new values of `stops`. `stops` keeps saying the shell (the script, a subshell, or either), which ten readers take as it is; `within` says what a failure there ends besides it.
- A function called from an `EXIT` trap is found by its calls: the walk makes them at the `trap` command (`StateModel.calls`), so the body's chain has a call link whose sites are that command, not a slot link.
- The trap rows are checked by what runs, in test/errexit-traps.test.ts (each trap's action prints a word of its own, bash 5.2 and 5.3, one process in a cgroup), not by `trap -p` rows in state.json: in a subshell `trap -p` prints the main shell's trap, and in a function body without errtrace it prints the caller's `ERR` trap, which does not run there.
- `later` is given only to a statement of the main shell outside any function: a function may also be called after the `trap`.
- bash takes for `EXIT` the name in any case and a number that is 0 (`00`, `+0`), and refuses `SIGEXIT` (measured): `exitSignal` (src/semantics/walk/shared.ts) follows that, and the idiom `trap … EXIT` reads its words through the same reader.
- `runsAtExit` reads the trap in effect at each end of the script (`StateModel.ends`: its end, each `exit` and failure under `set -e`) that got past the `trap`; `exec cmd` takes the `EXIT` trap back in the state.
- The token texts and "In short" do not change in U11a: `mayFail` changes only where "In short" says a subshell stops, and no line of the corpus has such a statement that G2 or G3 leaves out.

Two PRs, because U11a is a foundation and gets its own review before the text is built on it (CLAUDE.md, "Delegating"). They can go as one stack.

## 9. Prototype for run 4

Since 2026-11-08, the maintainer prototypes the UI and wording changes that come from usability findings, and tests them in a new usability run before a polished PR. So U11 got a prototype first: draft PR #730 (branch `usability-9-u11-proto`, never merged), with the variant (b) behind the web page's `?u11=clause`. Its results are at the end of this section.

**The smallest change.** It lives on a branch of its own (`usability-9-u11-proto`), is never merged, and is built with `npm run build:web` into the kit's site for run 4.

- The note of section 5, from one catalog fact with the drafts of section 4 (en and ja). It is made in src/explain/status.ts for each statement that the rule of section 3 lets through.
- "In short" drops `S.errexit`, and the token text of line 27 drops its "stops here" part, as in section 5. The reader then sees the sentence once, as the build would show it.

**What may be rough.** The prototype only has to be right on the scripts of run 4: nightly-backup.sh, and sample.sh for a look.

- G1: the EXIT trap in effect is found by a scan for `trap … EXIT` with static words, at the top level, before the line. ERR is ignored.
- G2: a short list of names in place of the spec field.
- G3: calls of functions get no note.
- G4: line 17 keeps today's text.
- G5: the hedge "(or `cleanup`'s, if it fails)" is said whenever a trap is set.
- No probe table, no coverage, no snippets regenerated. The guards may fail (explain-imports for the names, note-strings): the branch needs no green CI.
- The checks: `test/dump.ts` of nightly-backup.sh and sample.sh in en and ja, read line by line against section 2; a look at line 28 and line 8 at 390 and 1280 px, with screenshots.

**What run 4 measures.** Run 3's task 8 (b) cannot tell the page from the users' knowledge: every agent knows `set -e`, and nine of ten answered from their own. So run 4 keeps 8 (b) and adds a question whose answer depends on this script's lines:

- 8 (c): "If `date` on line 8 fails, does `cleanup` run? And if `mkdir` on line 21 fails?" The answers are no (the trap is set on line 19, after line 8) and yes. Line 8's note names no trap; line 21's names the trap of line 19.
- Bars, against run 3:
  - At least 8 of 10 answer 8 (b) and 8 (c) right, and say they took it from the page (run 3: 1 of 10 for 8 (b)).
  - The length is not named as a cost by more users at task 8 than in run 3 (7 of 10).
  - No user puts the note among their top three costs as noise or repetition.
- Optionally, for Q1: half of the users (one agent of each pair of a cell) get the sentence as a clause of "In short" instead of the note, from a second build of the branch. Each form is then judged on the bars above and on the length.

**Run 4's results** (2026-11-08, eight users, four on each variant):

- 8 (b) answered from the page: 8 of 8 (run 3: 1 of 8 in the same cells). 8 (c): 8 of 8 right.
- The `set -e` cost of task 8 is still in 6 of 8 top-three lists, but now on line 8 (partly because 8 (c) is new). Run 3's finding in substance, that no line says what a failing command does, went from 7 users to 1 (u36's first cost).
- Seven users named the U11 sentence as what worked (u31, u32, u33, u35, u36, u37, u38; not u34).
- The note against the clause of "In short" (four users each): no difference overall, in the answers or in the length. Nobody called either long or noise.
- The one measured difference leans to the clause: line 8 was among the top three costs of 4 of 4 users with the note, and of 2 of 4 with the clause. That cost comes from the sentence's silence about the trap that is not set yet (fix 1 below), which the design fixes in both forms.
- The maintainer decided the form on 2026-11-08: the line note (section 10).

Three problems found, each fixed in the design:

1. Line 8 is before `trap … EXIT`, and its note said nothing of the trap. All eight users had to infer that `cleanup` does not run there. u35: "for a reviewer that is the key fact"; u34: 「トラップはまだ設定されていない」. On a line before the trap is set, the note now says that no EXIT trap is set yet, and names the one that comes later (section 4, G1 `later`).
2. In bats, test.bats line 10 said 「`run` が失敗すると、`set -e` でスクリプトはここで終わり…」, while the row below says `run` returns 0. In a test, `run` returns 0 unless `-N` or `!` is given, and a failing command fails the test, not the script (section 6, G6).
3. "`trap … EXIT` … however it exits" is wrong for SIGKILL (u37). The idiom note and "In short" of `trap` change (section 5).

## 10. Decisions

Decided on 2026-11-08, after run 4. The maintainer decided Q1; Q2 to Q8 are the recommended answers, since nothing in run 4 spoke against them.

- **Q1. Where: the line note** at the level `note`, under "In short", in every output (the maintainer's decision). Run 4 found no difference overall between the note and the clause. Its one difference (line 8's cost: 4 of 4 with the note, 2 of 4 with the clause) leans to the clause, but it comes from the silence about the trap not yet set, which fix 1 removes in both forms. The note reaches the CLI and the hover, and carries the manual's sections. The variant `?u11=clause` stays only on the prototype's branch.
- **Q2.** Builtins that fail only on a usage or write error (`continue`, `trap …`, `set …`, `export`, `echo`…) get no sentence, through the spec field G2.
- **Q3.** No loop clause: "stops the script here" says it.
- **Q4.** No sentence on a call of a function whose failures stop inside it (G3).
- **Q5.** The hedge "(or that of `cleanup`, if it fails)" where the action may fail.
- **Q6.** The ERR trap is in, as the same field of the state.
- **Q7.** Line 17, in the EXIT trap (G4), in U11b: "ends the EXIT trap here, and the script exits with `rm`'s status".
- **Q8.** sample.sh keeps `set -euo pipefail` on its line 4.

Still open for the maintainer: the wording of the bats case (fix 2, section 4) and of the `trap … EXIT` texts (fix 3, section 5). Both are drafts and are shown in U11b's PR.

## 11. Left out (rare corners)

For docs/backlog-archive.md if they come up:

- A script that turns `set -e` on only on some paths (`active: 'unknown'`) gets no note.
- `bash -c` exits with 127, not 1, on a variable not set under `set -u` without `-e` (section 2: in a script file, 1). The `unbound` fact already says the script exits.
- A file sourced by another script: "the script" is the shell that sources it.
- `trap` with a signal list in a variable (G1 `unknown`): the sentence names no trap and gives the status with "after the traps set before, if any".
