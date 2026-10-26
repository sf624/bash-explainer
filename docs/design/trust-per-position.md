# Trust per position instead of per script

Status: planned. The roadmap's item "Trust per position" ([../roadmap.md](../roadmap.md), "Next"). This page says what each cause of "nothing is trusted" can change in bash, and from where. It gives the rule that replaces "the whole script is blind", the change of the data model, the tests and the steps. It ends with the gain, measured again with a prototype. The gain is smaller than the roadmap expected (section 8). The maintainer decides whether the item keeps its place (section 10).

## 1. Today

Values in Meaning, decided conditions and dead code rest on one predicate, the trust of src/semantics/trust.ts (semantics.md, 4.14; expansion-values.md, 3). The trust is an allow-list read once over the whole text of the script:

- A variable is trusted when every command that may write it is a plain assignment the walk reads (`Trust.variable`).
- A function is closed when every call of it is one the walk sees (`Trust.closed`).
- Nothing is trusted (`Trust.blind`) when the script runs anything the scan cannot read, anywhere: a `source`, an `eval` of text not known, a `$cmd`, and the rest of the list in section 2. Then no value is shown, no condition is decided and nothing is marked dead, in the whole file. The walk also finds such reasons (`Walker.walkAgain`): the script is then walked again, with nothing trusted.

The blind rule is simple and sound, but coarse: a `source` on the last line hides the values of the first line.

## 2. What unknown code can change in bash

A *taint point* is a place where the shell runs text the model does not read, or does something the model cannot follow. Each cause below was checked with bash 5.2 (snippets run through test/support/bash.ts, in a cgroup with `FUNCNEST` set; the results are quoted). Three things matter for each cause: when its effect happens, what it can change, and whether it can jump.

**When.** There are three kinds:

- *Command*: the effect happens when the command runs, after bash expanded all its words and redirections. `$cmd "$x"` expands `$x` before `$cmd` runs, so `$x` there still has the value from before.
- *Expansion*: the effect happens while a word of the statement is expanded. Later words of the same statement see it. `v='a[w=8]'; : "${!v}" "$w"` assigns `w` before the second word is expanded.
- *Later*: the command installs code that runs at points after it (a trap's action, an alias's text, PS4 under `set -x`).

**What.** Unknown code can do anything a script can do. The checks found each of these:

- Assign any variable. A later plain assignment does not make it known again. `readonly x=lib` in a sourced file makes a later `x=1` fail, so `x` stays `lib`. `declare -u x` turns `x=abc` into `ABC`. `declare -i x` turns `x=2+3` into `5`. `declare -n x=y` sends `x=1` to `y`.
- Run code before each later command: `trap 'x=dbg' DEBUG` makes `x=1; echo "$x"` print `dbg`. A RETURN trap with `set -T` runs at each return of a function.
- Define functions with the names of builtins: `exit() { :; }` makes the code after `exit` run. `false() { return 0; }` makes `if false; then …` take its branch. `echo() { …; }` changes what every later `echo` does.
- Change options and IFS: `set -e` stops the script at a later `false`. `IFS=:` changes how every later word is split.
- Define aliases (with `shopt -s expand_aliases`). An alias works only on lines bash reads after the command that defines it runs. It does not work on the rest of the same line. It does not work in a function body read before. It works in a body read after.
- Call any function that is defined at that moment, with any values. A sourced file that runs `x=2; f` calls `f` with `x` = 2, though every call the walk sees gives 1. A sourced file can also install a trap that calls `f` later (`trap f USR1`): `f` then runs at the signal, with the values of that moment. A function removed before (`unset -f f`) cannot be called.
- Jump. A sourced file's `break` inside a loop leaves the loop. So do `eval 'x=e; break'` and `cmd=break; $cmd`. `cmd=return; $cmd` returns from the function. `exit` in a sourced file ends the shell or the subshell. A `return` at the top of a sourced file ends only the `source`, also when the `source` is in a function. A `break` inside a *function* does not leave the caller's loop in bash 5.2: bash says "only meaningful in a loop" and goes on.
- Make locals. A sourced file run inside a function makes `declare x` a local of that function. A plain `x=lib` there is global.

**Where it does not reach.** An effect in a subshell stays there: `( . ./lib.sh )`, `$( . ./lib.sh )`, and a pipeline stage that is a subshell leave `x` as it was. The walk already drops what a subshell changes, and the env model says which commands run in one (semantics.md, 4.8).

**The causes, one by one.** All causes in `blindFor` and `walkAgain` today, with their kind:

| Cause (the `blind` text today) | Kind | What it can do |
| --- | --- | --- |
| `source`, `.`, bats' `load` and `bats_load_library` (a file), `bats_pipe` (a command line) | command | anything; jumps (`break`, `continue`, `exit`; `return` ends the source only) |
| `eval` of text not known | command | anything; every jump |
| A command name not known (`$cmd`, `"$@"`, `$1`) | command | anything (it may be `eval`, `source`, `break`, `return`, `exit`, `declare`, or any function) |
| A builtin given a variable name not known (`read "$v"`, `printf -v "$v"`, `declare "$v=1"`, `unset "$v"`, `getopts`, `wait -p`) | command | assigns that variable; a subscript in the name is arithmetic (`read 'a[x=5]'` sets `x`), and a `$( )` in it runs (in a subshell, which may call any function) |
| A callback not known (`mapfile -C "$f"`) | command | runs any function during `mapfile` (`mapfile -C f` changed `x` through `f`) |
| A nameref whose target is not known, assigned | expansion | writes any variable; the target's subscript is arithmetic |
| Indirection (`${!v}`, `${!1}`) | expansion | the subscript in the name it finds is arithmetic: `v='a[w=8]'; : "${!v}"` sets `w` |
| `${ …; }` (bash 5.3) | expansion | runs a command list in this shell |
| Arithmetic that pastes text not known (`$(( $1 ))`, `` $(( `cmd` )) ``, `${s:$1}`) | expansion | assigns any variable; a subscript's `$( )` runs |
| Arithmetic that reads a variable set to text not known, or never set (from the environment) | expansion | the value runs as an expression: `x='y=5'; (( x ))` sets `y`; `E='y=4'` in the environment does the same; `[[ x -eq 6 ]]` too |
| An integer variable given text not known (`declare -i n; read n`) | expansion (at the assignment) | as above |
| Arithmetic that reads a nameref whose target is not known | expansion | as above, for the variable the nameref names |
| `eval` or a trap of a string the walk does not read (an expansion or a glob in it, or too deep) | command (eval), later (trap) | as `eval` or a trap of text not known |
| A trap of text not known | later | anything, at any later point; every jump from wherever the signal comes |
| A DEBUG or RETURN trap (any text), or a trap whose signals are not known (`trap act "$sig"`) | later | runs before every later command (or return); with `extdebug` it may skip commands |
| A trap's action that may leave what a signal interrupts (`return`, `break`, an error) | later | a jump at any later point |
| A trap's, callback's or foreign text's code that changes options, functions or aliases | later (from the `trap`, `alias` or the command that names the callback) | those changes at any later point |
| A static `eval` string that changes options, functions or aliases (`eval 'shopt -s extglob'`: the scan reads it as foreign text) | none | the walk runs the string where `eval` runs, so this is no cause: step 3 drops it for the strings run where they stand |
| An alias of text not known | later | code at later commands that bash reads after it |
| PS4 that may assign or run a command | expansion (bash expands PS4 for each traced command after its words and before it runs: `set -x; n=1; PS4='+$((n=7)) ' eval 'echo "n=$n"'` prints `n=7`), from the assignment on, when `set -x` may be on (also by `bash -x`) | `PS4='+$((n++)) '` counts each traced command; `PS4='+${d:=dd} '` assigns; a `$( )` in PS4 runs in a subshell (it changes nothing here, but may call any function) |
| Another shell that reads startup files (`bash -l -c`) | the child model's start | anything in that shell (it changes nothing in the script) |
| An array whose subscript is read as a key where it may not be associative | expansion | the subscript is arithmetic after all |
| Too many aliases expanded (a budget) | global | stays whole-script |

**Holes found on the way.** These are not causes today, and the model shows a wrong value for each (bash 5.2; the first three with `$1` = `a[u=2]`, or `$((u=2))` for `@P`; the rest found by the review of this page and checked with bash):

- `u=1; declare -n r=$1; : "$r"; echo "$u"`: the model says `1`, bash prints `2`. Reading a nameref whose target is not known runs the target's subscript. Only an assignment through such a nameref makes the script blind today.
- `u=1; [ -v "$1" ]; echo "$u"` (also `test -v "$1"`, `x=$1; [[ -v $x ]]`): the model says `1`, bash prints `2`. The operand of `-v` is a name, and its subscript is arithmetic. A static operand is read today (`testV`); one not known is not.
- `u=1; : "${1@P}"; echo "$u"` (also `x=$1; : "${x@P}"`, and a static value: `x='$((u=2))'; : "${x@P}"`): the model says `1`, bash prints `2`. Prompt expansion runs `$(( ))` in the value. A value that `quietPrompt` (trust.ts) accepts is safe; any other is a cause.
- `y=1; declare n; (( n )); echo "$y"` with `n='y=5'` in the environment: the model says `1`, bash prints `5`. `declare n` with no value keeps the value from the environment, but the scan counts it as a write ("none"), so "the script never sets it" does not fire, and the walk's `unsetRead` finds an entry. `declare -i n; n+=1` does the same: `+=` on an integer runs the old value as arithmetic.
- `u=1; compgen -W '$((u=2))' >/dev/null; echo "$u"`: the model says `1`, bash prints `2`. `compgen -W` expands its word list in the shell.
- `y=1; fc -s 1=3 y; echo "$y"` (with `set -o history`): bash runs a history line again and prints `3`; the model says `1`. Rare.
- `g() { if [ "$d" = 1 ]; then d=2; g; return; fi; x=2; }; x=1; d=1; g; echo "$x"`: the model says `1`, bash prints `2`. The recursive call returns the state widened by what the body changed in its walk so far (`changes(g)` holds `d` only); `x=2` is walked later, as dead code after `return`. A call past `CALL_DEPTH` has the same flaw. This is a bug of the walk, not of the trust, but it matters here: a taint after the recursion point would be dropped the same way.
- `enable -n exit; exit; echo after`: bash prints `after` ("exit: command not found"); the model marks `echo after` dead.

These are bugs of the model as it is. They are fixed first (step 0, section 6), as causes of blindness (or, for the recursion and `enable -n`, in the walk), and then the causes move to positions with the others.

**What the model assumes of the start.** The script starts in a shell the model does not see. Some of what it inherits could change values anywhere: a PS4 from the environment (bash uses it under `bash -x`: `PS4='+$((n=7)) '` in the environment set `n`), a `BASH_ENV` file, exported functions with the names of commands, an exported `SHELLOPTS`. The model assumes none of these, today and with this plan. A per-position rule cannot lift this assumption either. It is not written down for users today; step 6 adds it to README's Limitations.

## 3. The rule

**T1. A taint at N taints the paths after N.** Let N be a taint point, and S the innermost statement that holds it.

- Command kind: the state after S is tainted. The words of S are not.
- Expansion kind: the state S runs with is tainted too, so its own words are untrusted. (A word of S before the effect could still be trusted; the plan does not try.)
- Later kind: the state after S is tainted. The code it installs runs only after S.

**T2. Taint stays on the path.** A tainted state stays tainted along every path that leaves it, through merges, loops, calls and returns. A subshell drops the taint with its other changes: `( . ./lib.sh ); echo "$x"` keeps the value of `x`.

**T3. Nothing is said in a tainted state.** Where the state is tainted, every name is untrusted: no value is shown and no condition is decided (also `if false` and `while true`: `false` may be a function now). No status is known. Every `exit`, `return`, `break` and `continue`, every error that ends a line or the shell, and every stop by `set -e`, is made and not made ("may"). So no code is marked dead there.

**T4. A scope with a tainted statement gets a tainted exit.** Unknown code may jump out of the loop, the function, the line or the script it runs in, from the taint point or from any later point (a trap's action at a signal). So when some statement of a scope ran with a tainted state, the places a jump out of that scope lands get a tainted state as well, as a "may" path:

- a loop: the state after the loop and the start of the next pass;
- a function body: the state after each call that walked it;
- a line of top-level statements: the state after the line (an expansion error discards the rest of the line);
- the script: its end (an EXIT trap runs there).

T4 matters only where the code after the taint always leaves its scope (`while c; do eval "$e"; exit; done; echo "$x"`: bash may reach `echo` through a `break` in `$e`; the walk without T4 sees `echo` only from the first test of `c`). A subshell is a scope too: its exit status is not known after a tainted statement in it.

**T5. Loops.** A taint in a loop body taints the whole loop on later passes, also the part of the body before the taint. This comes from T2: the walk runs the body until its state at the start settles, and the tainted state at the end of a pass (or at the start of a pass, through T4) reaches the start. `for i in 1 2; do echo "$x"; eval "$c"; done` printed `x=0` and then `x=2`.

**T6. Function bodies that unknown code may call.** Unknown code may call any function defined at that moment, directly or through a trap or an alias it installs, with values the walk does not see. So a function's body is not settled (no value, no decision, no dead code in it), and it is not closed (the env model does not say for sure where it runs), when the function may be defined:

- in the state at a taint point (also one in a subshell: `( . ./lib.sh )` may call `f` there); or
- in a tainted state, which covers definitions made after the taint (on its paths).

"May be defined" means the function's state there is not surely `off`. A function removed before the taint (`unset -f f`) is not affected. A body walked at a call after the taint is tainted anyway (T2); T6 covers the calls the walk does not see.

T6 is what costs most (section 8): with a taint in the main flow, every function defined by then is lost, which in most scripts is every function. No weaker rule is sound. The hidden call runs at a moment when every variable may differ, and even a value the body sets itself may not hold (`readonly` makes the assignment fail; a function named `local` replaces the builtin; a DEBUG trap with `set -T` runs inside).

**T6b. Taints the walk does not carry to where they run.** T1 to T6 assume the walk runs every taint point with the state bash has there. Three approximations of the walk break that, and each needs its own rule:

- A function that is not closed (called through `$cmd` with a known value, `mapfile -C f`, `trap f SIG`, `complete -F f`) runs where the walk does not walk it. `f() { . ./lib.sh; }; cmd=f; x=1; $cmd; echo "$x"` prints `2` with `x=2` in lib.sh, but the walk walks the body only as a body no call reaches, and that walk flows nowhere. Rule: when such a function's closure (it and the functions it calls) holds a taint point, every command that may run it is a taint point itself: command kind for `$cmd` and `mapfile -C`, later kind for `trap f SIG` (the quiet walk of the action already gives this).
- A call the walk does not walk (more than `WALKS_PER_FUNCTION` entry states, recursion, deeper than `CALL_DEPTH`) takes the body's changes as unknown. When the body's closure holds a taint point, the call's exit is tainted (dead-mode code records `OPAQUE` too, so this mostly holds already), and the call counts as a taint point for T6, with the state of the call: a function the taint may call can be defined only there (`g() { . ./lib.sh; }`, called a fifth time after `f` is defined: lib.sh may call `f`).
- An EXIT trap is walked from the end of the script, but a signal, `exit` or an error runs it at any point after the `trap` command. For T6, an EXIT trap whose action holds a taint point counts every function that is not surely `off` in some state after the `trap` command (as `widen(t.st, after)` gives them), not only those of the end: `trap '. ./lib.sh' EXIT; f() { …; }; x=1; f; x=2; kill $$; unset -f f` calls `f` with `x` = 2 when lib.sh says `f`.

**T7. Traps.** A trap's action never gets values or decisions today (4.14), and that stays. A trap of text not known, a DEBUG or RETURN trap, and the other later causes taint after the `trap` command (T1). A trap of text not known set for EXIT only runs when the shell exits, so it could leave the state after it untainted and count only for T6, with every function that may be defined at some point after the `trap` (T6b: a signal may run it early). Step 5 does that; until then it taints like the others.

**T8. Aliases.** An alias of text not known changes what bash reads after the command that defines it runs. Its text runs at later commands. So it taints the state after the `alias` command, like any later cause. A function body read before the `alias` is not changed by the alias, but if it runs after, it runs with a tainted state (T2), and unknown alias text may call it (T6). Nothing more is needed for aliases.

**T9. `set -e` and early exits.** Unknown code may turn on `set -e` (a later failure then ends the shell), or exit. Both end paths; they never make a wrong value. T3 already makes every jump and every `set -e` stop a "may" in a tainted state.

**T10. Another shell.** `bash -c S` gets values from the state at its command. A child's model trusts nothing when that state is tainted. Otherwise it trusts what it trusts today (`withinTrust`: its own trust and the outer variable trust). Its own taints work as in the script.

**What stays as a whole.** The allow-list of variables (`Trust.variable`) stays whole-script: a variable some command anywhere writes otherwise than by a plain assignment is never trusted. Making it per position is a different change (not planned). The budget "too many aliases expanded" keeps the script blind as a whole. The assumptions of section 2 stay.

**Worked examples.** In each, the comment says what the rule shows.

```bash
x=1
echo "$x"            # 1
. ./lib.sh
echo "$x"            # nothing: after the taint
```

```bash
f() { echo "$x"; }   # nothing in f: f is defined at the taint (T6)
x=1; f
eval "$code"         # may call f with another x
```

```bash
x=1
( . ./lib.sh )       # a subshell: its changes stay there
echo "$x"            # 1
```

```bash
p='a[x=9]'
echo "${!p}" "$x"    # nothing for $x: an expansion taint is in the same statement
$cmd "$x"            # (on a path with no taint before) $x has its value: $cmd runs after its words
```

```bash
x=1
while c; do eval "$e"; exit; done
echo "$x"            # nothing: `$e` may break out of the loop (T4)
```

## 4. The data model

The walk already has the flag for it. `ShellState.opaque` is set where the walk runs what it does not read (a sourced file, a string of `eval` or of a trap it does not read, the startup files of another shell). It is kept by merges and dropped by subshells, and `Walker.opaque` records it as a change (`OPAQUE`), so a body walked again, a trap's action and a body no call reaches see it. This plan makes it the taint:

- `ShellState.opaque?: true` becomes `taint?: Taint`, with `Taint = { why: string; at: SyntaxNode }`. The reason is the first taint on the path (a merge keeps the one earlier in the text). The meaning of `opaque` today (a name the script has not set may be set) holds for every taint, so the readers of `opaque` (unbound.ts, the arithmetic evaluator's cache key, `variableText`, `goesOn`, reads.ts) read `taint` instead.
- `widen` and the function and trap walks carry `OPAQUE` as a key of changes, with no reason; the reason of a taint (`Taint.why`) is kept in a side map by its node, and the key stays a plain flag.
- The trust scan does not stop at a cause any more. `blindFor(why)` becomes `taintAt(statement, why, kind)`: it records the innermost statement and goes on. `Trust` gets `taints: ReadonlyMap<SyntaxNode, { why: string; kind: 'command' | 'expansion' | 'later' }>`. `Trust.blind` remains for the budget only. The causes found in `finish()` (arithmetic reading text not known, a command variable, PS4, a nameref) need the statements they come from: the scan keeps the owner statement of each arithmetic text (it keeps it today only for the arithmetic the walk does not run), carried through the closure of names read as arithmetic (`a=b; b=$(cat f); (( a ))` taints at `(( a ))`), of each command named by a variable, of each write of PS4, and the commands that name each callback (for a callback that changes options, functions or aliases, with the `calls` closure).
- Host functions: the walk does not set `opaque` after bats' `load` today (builtins.ts `effects`, `hosted`: "the walk goes on as it was"). Tainting there changes what unbound.ts and reads.ts say after a `load` in bats files: fewer notes, which step 3 checks on the bats tests.
- The walk taints at those statements (T1): `run(n, st)` taints `st` before recording it for an expansion taint, and the state after `n` for the others. The causes the walk finds itself (`walkAgain`: a string it does not read, arithmetic reading a name no path has set, an array that may not be associative, a trap's action that may leave what it interrupts) taint at the statement where they are found, instead of walking the script again blind.
- In a tainted state (T3): `variableText` marks the read as assumed; the places that decide a condition (`list`, `if`, loops, `case`: today `|| this.blind`) do not decide; `jump`'s `maybe` and `abort`'s `ends` read the state's taint as they read `blind` today; `statusOf` gives no status.
- T4: each `Target` (loop, function, unit, program) keeps `wild?: ShellState`, the merge of the tainted states its statements ran with (one merge per tainted statement and open target). When the target closes, `wild` joins its landing states (`breaks`, `continues`, `returns`, `aborts`, `exits`) as one more "may" path.
- T6: after the walk, `Walker.hiddenCalls` is the set of function names that are not surely `off` in a state at a taint point (with the calls T6b counts, and for an EXIT trap every state after its `trap`), or whose definition runs in a tainted state.
- T6b: the walk records, per function, whether its closure holds a taint point (from the scan's taints and the calls it records), and taints at the commands that run a function that is not closed, and at the exit of a call it does not walk. `everywhere(n)` (behind `settled`, `condition` and `dead`) and the `closed` that the env model gets read it, as they read `Trust.closed` today.
- `StateModel`: `blind` keeps its meaning (the budget: nothing anywhere). A new `taintAt(n): string | undefined` gives why nothing is trusted at `n`: the taint of the state `n` runs with, or the body of a hidden call (T6). `trusts(name)` becomes `trusts(name, at)` (semanticFacts.ts, pitfalls.ts, words.ts' trusted evaluator). values.ts asks `taintAt(part)` where it asks `blind` today; unbound.ts and reads.ts likewise. `withinTrust` gets the slot's command (T10).

A list of taint points with a reachability query ("is `n` on a path after N?") would answer the same question. The flag in the state is preferred: the walk's merges, loop passes, calls and subshells already carry it, so no second notion of "after" is needed, and loops and functions come out right without special cases.

**Cost.** A script that is blind today is walked twice (once until the reason is found, once blind). With taints it is walked once. T4 adds a merge per tainted statement and open target, which is small next to the walk. The whole-script scan reads the text once, as before.

## 5. Tests

- **The decisions' generator** (test/support/decisions.ts, used by test/decisions.test.ts and test/values.test.ts). Today a script has a sourced file in 3% of cases and a `$cmd` in 2%, at the start only, and such a script is blind. The generator gets taint statements at random points of any block: `. ./hN.txt`; `read -r -d '' c < hN.txt; eval "$c"`; `read -r cmd < hN.txt; $cmd`; `read -r nm < hN.txt; read "$nm" <<< x`; `p='a[mode=9]'; : "${!p}"`; `x=$(cat hN.txt); (( x ))`; `read -r -d '' a < hN.txt; trap "$a" USR1` (or EXIT), with the `kill -USR1 $$` the generator already has. The model does not read the files; bash does. Their texts are drawn from a pool of what section 2 lists: assign a plain variable (`mode=zz`), give attributes (`readonly mode`, `declare -i flag`, `declare -u v`, `declare -n v=mode`), shadow commands (`true() { return 1; }`, `false() { return 0; }`, `exit() { :; }`), jump (`break`, `continue`, `return 0`, `exit 0`), set options (`set -e`, `set -u`, `set -f`, `IFS=a`, `shopt -s nocasematch`), set traps (`trap 'mode=dbg' DEBUG`, `trap 'flag=t' USR1`, `trap f USR1`, a RETURN trap with `set -T`), define an alias with expand_aliases, and call the script's functions (`mode=$flag; f`). `Script` gets `files` (written next to `s.sh` by `check` and `checkValues`). The checks stay as they are: no decision, value or dead mark that bash contradicts. The test asserts that some scripts have taints and still decide something and show values.
- **The review's cases** as probe rows and unit tests: a taint in a function run through `$cmd` and through `mapfile -C`; a taint after a recursive call; a fifth call (past `WALKS_PER_FUNCTION`) of a function with a taint that may call a function defined after the fourth; an EXIT trap with a taint and `kill $$` before an `unset -f`; a PS4 prefix assignment on an `eval` and a `let`.
- **Unit tests** (test/state.test.ts, test/walk-values.test.ts): for each cause of section 2, a value before it and none after; the words of a command taint have values, those of an expansion taint do not; T4's case; T5's loop; T6 with a function called before the taint only, and one removed by `unset -f` before it; a subshell; a taint in a function called later; a trap set for EXIT only (step 5); the three holes.
- **Probes** (test/fixtures/probes/values.json and state.json, checked against bash): rows with markers before and after each cause, in the main flow, in a loop, in a function, in a subshell. Each row says by its `none` entries why a marker has no value; the rows whose markers before a taint get a value now lose their stale `none` entries (the test fails on a stale entry, so they cannot be forgotten).
- **The corpus** (section 8), each step that changes what users see.

## 6. Order of the work

Each step keeps every test passing. Steps 1 and 2 change nothing users see: every explanation stays byte-identical, since the scan still makes the same scripts blind as a whole (test/snapshot.ts).

0. Close the holes of section 2: as causes of blindness, `-v` of a name not known (`test`, `[`, `[[ ]]`), the reads of a nameref whose target is not known, `${x@P}` of a value `quietPrompt` does not accept, a bare declaration of a name the environment may give (read as arithmetic, or `+=` on an integer), `compgen -W`, `fc`; in the walk, a recursive call (and one past `CALL_DEPTH`) widened by every name its body may write, not only those its walk changed so far, and `exit` after `enable -n exit` not taken as a jump. Each with a probe row against bash. A fix users see: values and dead code that were wrong are no longer shown (CHANGELOG "Fixed").
1. The taint in the state: `opaque` becomes `taint` with its reason; the walk treats tainted states as T3 says and keeps `wild` for T4; the readers ask `taintAt(n)` and `trusts(name, at)`. With every cause still whole-script, nothing changes yet.
2. Hidden calls (T6, T6b): `hiddenCalls`, read by `everywhere` and by the env model's `closed`; the taints at the commands that run a function that is not closed, and at calls not walked. Still nothing changes.
3. Command causes at their positions: `source`, `.`, bats' `load`, `eval` and traps of text not known (and of strings the walk does not read), a command name not known, builtins given a name not known, callbacks not known, aliases of text not known, DEBUG and RETURN traps, foreign changes, PS4. The generator gets its taint statements (section 5). Measure the corpus. Users see values, decisions and dead code before a `source` (CHANGELOG "New" or "Changed"), and docs/design/expansion-values.md section 3 changes its first condition.
4. Expansion causes at their positions: indirection, arithmetic pasting text not known, arithmetic reading a variable set to text not known or never set (by the owner statements the scan now keeps), an integer given text not known, namerefs with a target not known, `${ …; }`, the causes the walk finds (`walkAgain` goes). Measure again.
5. Refinements, each measured on its own: a trap of text not known set for EXIT only taints nothing after it and counts only for T6; a PS4 whose only command is `$( )` (it runs in a subshell) counts only for T6.
6. Update docs/design/expansion-values.md (sections 3 and 6), semantics.md 4.14, README's Limitations (what the model assumes of the start, section 2), the roadmap and this page's status.

## 7. Risks

- **A wrong value is worse than none.** Every step that moves a cause to a position must leave its rows of section 5 passing, and every place the rule is not sure of stays untrusted: an expansion taint taints its whole statement; T4 applies to every scope, whether or not the cause can jump; T6 counts a function that is only maybe defined.
- **Paths the walk does not see.** T1 to T3 are sound only when every state bash can reach after N is tainted in the walk. The walk's own approximations (a loop whose passes did not settle, a function not walked at some call, a body no call reaches) are not settled today, but that covers the bodies only, not the exit states and call states through which a taint inside them leaks: T6b covers those, T4 covers the jumps of unknown code, T6 its calls. The review of this page found the cases of T6b, the recursion bug and the PS4 prefix by trying exactly this. A new kind of hidden control flow would break the rule: the differential test is the guard (section 5), and the reviews should try to find one.
- **Mixed taint and decided branches.** A branch that is dead by a sound decision before N keeps its taint points out of the walk (`if [ "$x" = 2 ]; then eval "$y"; fi` with `x=1`). That is right as long as the decision holds at every call that runs the branch; a call the walk does not walk (recursion, past `WALKS_PER_FUNCTION` or `CALL_DEPTH`) may run it otherwise, which T6b and step 0's fix of recursive calls cover. The decisions' test checks it.
- **Effort.** The taint replaces `opaque` in about ten places, and `blind` in about fifteen (src/semantics/walk/, values.ts, unbound.ts, reads.ts, the tests of the trust). The probes and the generator are most of the work.

## 8. Expected gain, measured again

The research run of October 2026 (536 scripts, 23 repositories) found 60% of the scripts wholly blind and 69 values over 37,674 parameter expansions. Its clones are gone; its results (out.jsonl) say why each expansion has no value, but not where the first cause is. So the gain was measured again with a prototype of steps 1 to 4 (T1 to T6, without T4's scopes, with the arithmetic causes still whole-script), on 361 of the 536 files: those of 18 repositories, downloaded again at their current heads (asdf at v0.15.0, the last release in shell), without kubernetes, node, rust, go and terraform. 358 files are not zsh; they hold 32,439 parameter expansions (`simple_expansion` and `expansion` nodes).

| Measure | Today | Per position (prototype) | Blind ignored (unsound, an upper bound) |
| --- | --- | --- | --- |
| Expansions with a value (`expansionValue`) | 34 | 45 | 103 |
| Files with at least one value | 9 | 19 | |
| Files blind as a whole | 193 (54%) | 57 (arithmetic causes the prototype kept whole) | 57 |
| Conditions decided (`condition`) | 2 | 4 | |
| Statements marked dead (`dead`) | 0 | 9 | |

No file lost a value. The 11 new values were read by hand: each is a constant set before the first taint, on the top level (`CHANNEL=$DEFAULT_CHANNEL_VALUE` in docker's rootless install, `USAGE` in `git-merge-one-file.sh`, `jqt` in docker-library's `apply-templates.sh`).

Where the rest goes, in the 136 files the prototype could place (the 193 blind ones less the 57):

- 90 have a taint in the main flow. The first one is at 35% of the file's lines on average. 27 have taints in functions only, and 19 in subshells only.
- The first taint is a `source` in 72 files, an `eval` of text not known in 18, a command name not known in 16, indirection in 6, other causes in 6.
- With blind ignored, 70 values would appear: 43 on the top level and 27 in functions. Per position keeps 11, all on the top level. T6 removes all 27 in functions; the other 32 top-level ones come after a taint.
- Of 91 reads of a variable assigned once, at the top level, to static text: 10 are on the top level before the first taint, 42 after it, and 39 in functions.

The prototype was also run on the decisions' differential test, with the generator of section 5 (300 scripts, seed 11, 250 of them with taint statements): no decision (82) or dead mark (242) and no value (2,895 shown, 1,677 compared with bash) was contradicted. A run of 1,500 scripts was lost to a crash of the machine; step 3 repeats it.

So the rule works, but the gain is small: about a third more values (34 to 45 here), still about 0.14% of expansions. The roadmap's "651 of ~790 constant reads lost to it only" does not hold as the gain of this item: ignoring blindness altogether gives only 69 more values on this set. Most constant reads are inside functions, where item 6 (constants in functions) is needed too, and where T6 removes them again in any script with a taint in its main flow. Most top-level reads come after the first `source`, which is near the top.

**Metric and target for steps 3 and 4.** The research's file list and the prototype were lost when the machine restarted (they lived in a temporary directory), so step 3 starts by making the corpus reproducible: a measuring script (scripts/, not part of any product or test run) that downloads the 18 repositories above at pinned commits, takes their shell files by a fixed rule (the research's: up to 40 files per repository, by path), reads them as data and runs nothing of them. It reports, before and after the change, the counts of the table: expansions with a value (`expansionValue`), files with a value, files blind as a whole, conditions decided (`condition`), statements marked dead (`dead`), and every new value. The target, relative to that baseline: no file loses a value; at least as many new values, decisions and dead statements as the prototype found here (about a third more values; decisions and dead code from almost none to a few); after step 4, the files blind as a whole fall to those of the budget only; every new value read by hand, none wrong.

## 9. Not in this plan

- **Reading the sourced file.** The first taint is a `source` in 72 of the 136 files. Of the 151 `source` commands in the 95 files blind by `source`, 31 have a static path, 23 a path next to the script (`$0`, `BASH_SOURCE`), 13 a `$DIR/file` form, and 84 something else. Where the file is in the workspace (VS Code has it; the web page and the CLI on stdin do not), the walk could read it as it reads a static `eval` string. That would recover far more than this rule, also inside functions. It is a different design: which paths, which files, and how the explanation says the value comes from another file. It goes under "Not decided" in the roadmap.
- **Variables re-trusted after a taint.** `. ./lib.sh; x=1; echo "$x"` gets no value, since the sourced file may have made `x` readonly, integer, upper-case or a nameref, or set a DEBUG trap. Proving that it did none of these needs the file.
- **Variable trust per position** (a `read x` after the read of `$x` makes `x` untrusted everywhere today).

## 10. For the maintainer

The rule is sound on everything tried, and its steps are independent of other work. But its gain is small on the corpus, and it does not open the way for item 6 in scripts with a taint, as the roadmap assumed. Step 0 fixes wrong values and dead code of today's model (eight cases, section 2) and should be done in any case. For the rest, the maintainer decides: do steps 1 to 4 now, or move the item down and look first at reading sourced files (section 9).
