# Run-based checks: bash as the oracle for the layers above the syntax

An external review made this point. `test/bash-ast.test.ts` shows that our tree has bash's skeleton: the same commands, words and redirections. It does not show that the explanations are right. The value of the explainer is in the layers above the tree: expansion, shell state, the explanations and the suggested fixes. Those layers should be checked against real bash wherever a run can decide.

The review proposed three checks:

- **A. Argv capture.** Run each line with its commands replaced by a stub that prints the arguments it received. Compare them with what the explanation says about how each word splits and expands.
- **B. Suggestion verification.** Every note that says "write X instead" gives X in a form a test can read. A test runs the original and the rewrite in bash over a set of states, and checks that the rewrite keeps the meaning and removes the hazard.
- **C. Normalization audit.** Each function that maps several spellings to one key must not merge forms that bash treats differently. Pin it with runs: forms bash treats the same, and near-misses it does not.

This page checks what exists, takes an inventory for each check, and plans the work in steps. Each step is a PR that keeps every test passing and 100% coverage of `src/`.

Status: step 1 (the inventory of B) is done (#273), step 2 (argv capture over the fixtures, A1) is done (#432; section 2.6), and step 3 (the snippets and the fuzz inputs, A2) is done (#449; section 2.7). Step 4 (rewrite data) is done (#453, #454, #STATUS, #WORDS): `Fact.rewrite` exists (section 3.2), and all 17 mechanical ids carry it. Steps 5 to 10 are not started: there is no normal-forms table yet (section 6). The panel redesign builds on step 2 (its P4a) and on steps 4–6 for four notes (its P3; [panel-redesign.md](panel-redesign.md)).

## 1. What runs bash today

As of #273, when this page was written.

| test | what it compares | input | bash at test time |
|---|---|---|---|
| test/word-probes.test.ts | `wordFields` with the fields bash printed at each marker | test/fixtures/probes/words.json, hand-written rows | no: a recorded table, rechecked by test/probe.test.ts |
| test/state-probes.test.ts, env-, names-, status-probes | the state, environments, name resolution, status | probes/*.json, hand-written rows | no (recorded) |
| test/decisions.test.ts | conditions the model decides, dead code | 120 generated scripts, seed 1 | yes |
| test/fixes.test.ts | quick fixes of the dialect check: before and after give the same result | 15 hand-written cases, bash and dash | yes |
| test/wordfacts.test.ts, test/pitfalls.test.ts (PR #271) | the quoted path the pitfall suggests | 10 words, 2 rewrites | yes |
| test/word-notes.test.ts, test/facts-from-model.test.ts | notes about words, facts from the model | hand-written cases | yes |
| test/examples-*.test.ts | examples of sed, awk, jq, perl, coreutils… | tables of cases | yes (the tools) |
| test/bash-ast.test.ts, test/command-tokens.test.ts | the tree, and tokens inside commands | the whole corpus | bash-ast, not bash |

So the word model is checked against bash on rows written for it (words.json). There is no corpus-wide differential of the argv: the corpus (test/fixtures/sample.sh and the other fixtures, the 1,220 snippets of the tests, the fuzz inputs) reaches bash only through bash-ast, which parses and never expands.

## 2. A: argv capture over the corpus

### 2.1 What the explanation states

The explanation of a word comes from the word model. `wordMeaning` says which steps apply (brace, tilde, splitting with the IFS in effect, globbing with the glob options in effect), and the tokens say it ("unquoted, it is word-split and globbed", "brace expansion: expands to 2 words"). `wordFields` gives the fields when the model knows them. The argument interpreter then gives each word a role. So the claim to check is `wordFields`, for every word of every simple command, with a known environment. The renderings come from the same `WordMeaning`; a later step checks that they agree with the fields (2.5).

Measured on the corpus at 27280b5 (1,236 inputs: the fixtures and the snippets): 1,896 simple commands, 4,814 words in names and arguments. With the probe environment (`PROBE_ENV`, `FILES`, `BOX` of test/support/probe.ts), the model gives fields for 4,573 words (95%), no fields for 232, and an error (failglob, `set -u`, ambiguous redirection) for 9. In 1,701 commands every word is known. The model side takes 0.7 s.

### 2.2 How a line is run

Reuse the probe harness (test/support/probe.ts). It already runs bash 5.2 in a fresh directory with known files, a known environment and `LC_ALL=C`, with a function `__probe` given in the environment that writes the fields of its arguments to a log, NUL-separated. A row of words.json is a snippet with markers: `@PROBE:x@ "$a" *.txt` becomes `__probe x "$a" *.txt`.

The corpus check makes those markers itself:

1. Parse the input. For each simple command with a name, insert `__probe ID ` at the start of its name (after the prefix assignments). The command does not run; `__probe` logs its name and arguments as bash expanded them. Redirections stay on the command, so their targets are expanded too (words.json already checks those).
2. Do not insert a marker before:
   - keywords, compound commands and lone assignments (nothing to capture);
   - calls of the script's own functions (their bodies are instrumented and must run, or the state that follows is not the model's);
   - the builtins that change state the model follows: `set`, `shopt`, `declare`, `typeset`, `local`, `export`, `readonly`, `unset`, `shift`, `alias`, `unalias`, `read`, `mapfile`, `readarray`, `let`, `return`, `exit`, `break`, `continue`. A declaration builtin cannot run inside a function without changing its meaning (`local` and `declare` would be local to `__probe`).
3. The pure builtins `[`, `test`, `true`, `false`, `:` and `printf -v` get a marker of a second kind: the probe logs the fields, then runs the builtin (`builtin "$@"`) and returns its status, so conditions take the branches the model decides.
4. Every other command (externals, `echo`, `eval`, `source`, `exec`, `trap`, `kill`, `cd`, `command`, `builtin`…) is replaced by the probe. Its status is 0. The model trusts no external status anyway (src/semantics/trust.ts), and a script that runs `cd` already has its globs unknown.
5. Commands inside `$( )`, `<( )` and backquotes are instrumented the same way. Their output is then empty. The model gives command output as unknown, so nothing it states changes.

### 2.3 Comparing

The comparison is the one of test/word-probes.test.ts, with the same rules:

- A word the model knows: its fields must be what bash logged, on every run of the marker.
- An error the model states (failglob, `set -u`, `${x:?}`, an ambiguous redirection): the marker must not have run.
- A word the model calls unknown: the known words before it and after it must still match bash's head and tail of the argv (the alignment rule of word-probes).

What to do with unknown words:

- An unknown word is never a failure by itself. Saying "may" is allowed; saying something wrong is not.
- The explanation of an unknown word must not state a field count. A check reads its tokens: no "expands to N words" and no single role where the count is unknown.
- The number of unknown words is pinned in a known-findings file (as test/fixtures/command-tokens-known.json pins its counts). It may go down; when the corpus changes, the count is updated in the same PR.
- A word that is unknown to the model but gives the same fields in bash on every run and in every environment variant is listed as a candidate the model could know. It is reported, not failed.

Each input runs in two environments: the probe environment, and the same with the variables the corpus reads most and does not set (`x`, `f`, `DIR`, `file`, `name`…) given values with a space, a `*` and an empty one. `WordEnv.variables` takes both, so the model sees what bash sees.

Accepted differences go in a known file with a reason each, as for bash-ast: `test/fixtures/argv-known.json`. A stale entry fails the test.

### 2.4 Safety

The scripts are generated from the corpus and the fuzz inputs, so they run as CLAUDE.md "Tests that run bash" says:

- One `systemd-run --user --scope -p MemoryMax=3G -p MemorySwapMax=0 -p TasksMax=500` for the whole batch, when `systemd-run --user --scope true` works; one scope per input would add a systemd call to every run. Without systemd (some CI runners), `ulimit -u`, `ulimit -v` and `ulimit -f` in the driver instead.
- `FUNCNEST=100`, `ulimit -f 20000`, a timeout per input, and each bash spawned `detached` and stopped with `process.kill(-pid)`, as test/support/decisions.ts does.
- No real command may run. Three walls, from the inside out:
  1. The instrumentation replaces every command that is not on the allow-list of 2.2.
  2. After the probe is set up, `PATH` is an empty directory, and `command_not_found_handle` writes `ESCAPED name` to the log and exits 99. Any command that reaches a `PATH` search fails the test loudly, with its name.
  3. `enable -n` turns off the builtins that reach outside the shell and are not on the allow-list (`exec`, `kill`, `trap`, `ulimit`, `umask`, `source`, `.`, `eval`, `enable`, `wait`, `disown`, `suspend`), so a word that escaped the instrumentation (an alias text, an `eval` string) falls through to wall 2.
- `HOME` and the current directory are inside a fresh `mkdtemp` directory; the script file is outside it; stdin is `/dev/null`.
- An input the model cannot follow (an `eval` of unknown text, `source` of a file) is skipped, with the reason counted.

### 2.5 Later: the renderings and the roles

Two checks build on 2.3:

- **The renderings.** For each word with known fields, the tokens must agree with them: "stays one argument" when there is one field, "expands to N words" with N fields, a glob example only when the glob step applies.
- **The roles.** The argument interpreter reads words, not fields (`cp $x d` gives `$x` one role). Where the fields are known and a word gives several, feed the interpreter bash's argv and compare the roles with the ones the explanation shows. A role that changes with the field count must be explained with that hedge (`{1,2}` in `cp` already says "when it expands to a single word").

### 2.6 As built (step 2)

test/support/argv.ts makes the markers and runs the batch; test/argv.test.ts checks the fixtures. Where it differs from 2.2 to 2.4:

- **Inputs.** sample.sh and coverage.sh; each section of sample.sh alone, in place (under its `set -e`, the whole file stops at the `[[ … ]]` of its last section); and the shell code of each host fixture that bash runs, with the model the explanation builds for it (its region's `provided` variables, `fileRead`). posix.sh, ksh.ksh, the regions of sh and bats are not run: they need dash or bats around the script.
- **Markers.** `__probe ID` replaces a command; `__probe_r ID` logs the words and then runs `[`, `test`, `true`, `false`, `:` or `printf -v`. A recorded command in the condition of a `while` returns 0 the first time and 1 after (`__probe_w`), and in an `until` the other way round (`__probe_u`), so that such a loop runs its body once. `getopts` runs as it is, with the builtins of 2.2 that change state. A call of a function gets no marker when the model is sure it is defined and its definition is in the script's tree; one that `eval` would define gets a marker, since `eval` is recorded.
- **Redirections.** Every file redirection goes to `/dev/null`, so the run reads and writes no file and opens no `/dev/tcp`. On a recorded command, the target moves into the argv between the words `@@R@@` and `@@E@@`, where bash expands it as it would for the redirection; where the model says a target is ambiguous, bash must give other than one field. Duplications (`2>&1`, `<&3`), process substitutions and redirections before the name stay out of the comparison.
- **Environments.** `probe`: PATH a directory that does not exist, HOME and the current directory the run's directory (BOX), `LC_ALL=C`, `FUNCNEST=100`. `values`: also every variable the input reads that bash and its host do not set gets `a b`, `*.txt` or an empty value in turn (also those the script sets, which the model reads the same way), two positional parameters (`a b`, `*`), and three lines on stdin, so that a `read` under `set -e` does not stop the script. The variables a host sets get a value the model does not know, in both.
- **Walls.** As 2.4. Wall 2 does not catch a command named by a path (`/bin/rm`), which bash runs without a PATH search: those rely on wall 1. A marker that runs 50 times in one shell stops that shell, for a loop no recorder ends. Without `systemd-run --user`, the driver sets `ulimit -v`, and `ulimit -u` a few hundred above the user's processes.
- **Result.** In each environment, 365 commands get a marker; 99 and 209 of them run, with 345 and 676 words the model knows and 11 and 37 it does not. No difference: test/fixtures/argv-known.json pins these counts and lists no finding. The batch takes about half a second.

A first run over the snippets, by hand (the input of step 3: 1,588 snippets that parse, both environments, 13 s), found these differences. The first three were bugs of the model, now fixed; the last two are accepted:

1. Backquotes: bash removes the backslash of `\$`, `` \` `` and `\\` before it reads the command inside (`` x=`eval 'a\$b'` `` runs `eval` with `a$b`); the model kept `a\$b`. Fixed in #435: the word model reads the text bash reads (`decodedSlice`).
2. A recursive function that changes a variable before it calls itself (`g() { if [ "$d" = 1 ]; then d=2; g; return; fi; }; d=1; g`): the model gave `$d` the value 1 in the body, which the second call sees as 2. Fixed in #433: a recursive call merges its state into the entry the body is walked again from.
3. A glob in another directory (`$D/*` with `D=''`, `/var/log/*.log`): given the files of the current directory (`WordEnv.files`, which only the tests give), the model took it as matching nothing and kept it as written; it should be unknown. Fixed in #434: a pattern from the root is not known.
4. A CR before a LF: the model reads the masked text (`crlf`); bash gives the word with its CR. An accepted difference.
5. `a\` at the end of the input: unbash keeps the backslash (README Limitations; test/fixtures/bash-ast-known.json).

### 2.7 As built (step 3)

test/argv.test.ts also runs a sample of the snippets in CI; scripts/argv-corpus.ts runs all of them and 200 fuzz inputs, by hand. Where it differs from 2.3, 2.4 and step 3:

- **Inputs.** The snippets that parse with no error (1,611 of test/fixtures/snippets.json at #449), each read as bash with no host. The CI sample is a fixed share (19%, 300 snippets at #449) chosen by a hash of each snippet's text and a seed (`SNIPPET_SAMPLE`), not a seeded draw: a new snippet then changes the sample by itself only, and the pinned counts by its own commands. The fuzz inputs are the first 200 by the same hash among those of test/support/fuzz.ts that parse and are not snippets, leaving out those cut after a backslash (the difference 5 of 2.6): they change with every snippet, too often for entries in a file.
- **A fourth wall.** The script runs as a restricted shell (`bash -r`; the restrictions start after the set-up read through BASH_ENV). A command the markers miss, in text bash reads as code at run time (a subscript in arithmetic, `${!x}` of `a[$(cmd)]`, a here-document), cannot be named by a path, PATH cannot be changed, and no file can be opened for output. So the redirections go to a descriptor the set-up opened on /dev/null (`>&97`, `toNull`), and the log is written to another (`>&96`). An assignment to PATH is then an error that ends its line; no snippet has one.
- **Counts.** test/fixtures/argv-known.json pins the counts of the fixtures and of the sample (`counts.fixtures`, `counts.snippets`), and its entries are matched by the input's name (a fixture's, or a snippet's text). An entry is stale when its input ran and no longer differs; the script also reports entries whose input is in no set.
- **Could know.** The script lists the words the model gives no fields while bash gave them the same fields on every run in both environments, in commands with one unknown word (the fields between the known head and tail). A word with a command or process substitution, or with `$?`, is left out: the recorders decide its value (empty output, status 0). A report, not a failure.
- **Result** (at #449). The sample: in each environment 339 commands get a marker and 303 run, with 731 and 736 words the model knows and 39 and 32 it does not. All the snippets: 1,717 commands, 1,574 and 1,582 run, 3,833 and 3,888 words known, 179 and 134 unknown. The fuzz inputs: 222 commands, 214 and 215 run, 552 and 560 words known, 10 and 4 unknown. The differences are the three of 2.6 still open and one of the harness, listed in argv-known.json: a CR before a LF (2.6, 4), a backslash at the end of the input (2.6, 5), and an alias that expands to `command ` before an alias that runs `declare` (the recorder replaces the first alias, so the second is not expanded; the model is right). No command reached a PATH search. The could-know report lists 37 words: values the model leaves unknown on purpose (a variable a host sets, `$PWD`, a glob from the root such as `$D/*` with `D` empty, `$0`, `${BASH_SOURCE[0]}`), long brace expansions (`{1..1000}`, which the model does not expand past its limit), and a few worth a look later (`"$f"` after `for f in *.log`, `$(( $p * 2 ))`, `${a[-1]}` of an empty array).
- **Time.** The CI sample takes 1.5 s (300 snippets, 600 runs on 4 batches at once), the fixtures 0.3 s. The script takes about 9 s (fixtures 0.2 s, snippets 7.2 s, fuzz 0.9 s, on 4 jobs).

## 3. B: suggestion verification

### 3.1 Inventory

Every note that tells the user to write something else, classified by how a run can check it:

- **mechanical**: the rewrite follows from the span the note is about. A test can rewrite the script and run both forms over a set of states.
- **scenario**: a run can check it, but needs a set-up of its own: a stub for `ssh`, `sudo` or `docker`, a new shell, bats.
- **prose**: no run can check it ("use another name", "write out its body", "use `find`"), or it is about another language (Python, a Dockerfile, a workflow).

| source | entries | suggest a rewrite | mechanical | scenario | prose | already run in bash |
|---|---|---|---|---|---|---|
| src/messages.ts (the catalog; used by src/wordfacts.ts, src/statusfacts.ts, src/analyzer.ts) | 104 | 56 | 17 | 25 | 14 | `unquoted-variable-as-path` (PR #271); `failure-reported-as-success`, `unmatched-glob-runs-once` (test/rewrites.test.ts); `wrapper-assignment-expanded-first`, `unbraced-element`, `regex-backslash-dropped`, `bracket-close-glued` (test/rewrites-misc.test.ts); `declaration-masks-status`, `postfix-increment-status`, the three `*-last-test-*` ids (test/rewrites-status.test.ts); the six word ids (test/rewrites-words.test.ts) |
| src/pitfalls.ts (style checks, no ids) | 9 | 9 | 9 | 0 | 0 | the `rm -rf "${DIR:?}"/*` rewrite (PR #271) |
| src/dialect.ts (`altEn` of the features) | 33 | 33 | 7 with a quick fix, 8 more | 0 | 18 | the 7 quick fixes (test/fixes.test.ts, bash and dash) |
| inline texts in src/analyzer.ts | 4 | 4 | 1 (`'a[1]'` for `unset a[1]`) | 2 (`env -S` in a shebang) | 1 (`eval`, `seq` for `{1..$n}`) | none |

The catalog's classification is in test/suggestions.test.ts (#273), one line per entry; its type makes a new entry fail to compile until it is classified. The counts are those it pins (the first inventory had 82 entries and 13 mechanical ones; entries added since brought `script-last-test-returns-status`, `unbraced-element` and `array-joined-in-assignment`). The catalog's mechanical entries:

| id | the rewrite | states to run |
|---|---|---|
| `unquoted-variable-as-path` | `$x` → `"$x"`, only the expansions quoted (`"$d"/*`); none where quotes change the value (`${x:-*.txt}`) | values with a space, a `*`, empty; files present and absent |
| `unquoted-variable-in-test` | `[ $x = y ]` → `[ "$x" = y ]`; none where quotes change the value (`${x:-'a b'}`) | empty, unset, a space, `-n`, `=` |
| `for-over-unquoted-args` | `for a in $@` → `for a in "$@"`, or `for a` where `$@` is the whole list (also `select`) | arguments with spaces, empty, a `*` |
| `prefix-assignment-expanded-first` | `v=1 cmd $v` → `v=1 bash -c 'cmd "$v"'`, through the shell of the script (`sh -c` in sh, which may be dash: there only a program, or `echo` and `printf` with no option and no `%q` or `%b`), where it runs the same command with the same words (a program, or a builtin that is one too; plain words, the prefix's variables, quotes that go in double quotes); else the form, no edits; for `cd`, a function or an alias, `v=…; cmd … "$v"`, no edits | `v` set before, unset |
| `wrapper-assignment-expanded-first` | `sudo v=1 cmd $v` → `sudo v=1 sh -c 'cmd $v'` (no edits where the string has another expansion), sudo stubbed by `env` | as above |
| `declaration-masks-status` | `local x=$(f)` → `local x; x=$(f)` (only the words with `$( )` move); read-only names are set first: `x=$(f); readonly x`, and `local -r x=$(f)` → `local x; x=$(f); readonly x`; in a group after `&&` or in a pipeline | `f` fails, succeeds; with `set -e` |
| `postfix-increment-status` | `((i++))` → `i=$((i+1))` (0 for every value), `((++i))` (1 when the new value is 0); with `set -e`, also `((i++)) \|\| true`; no assignment where the subscript acts (`a[i++]`) | `i` 0, 1, unset; with `set -e` |
| `function-last-test-returns-status`, `-stops-script` | `a && b` last → `if a; then b; fi`; `return 0` after it (both before the bodies of here-documents) | `a` fails, succeeds; with `set -e` |
| `failure-reported-as-success` | `a \|\| echo m` → `a \|\| { echo m >&2; exit 1; }` (`return 1` in a function; `return 1 2>/dev/null \|\| exit 1` in a file that may be sourced, 3.2) | `a` fails, succeeds; last of a script, of a function; with `set -e`; the file run, sourced, sourced in a function |
| `unmatched-glob-runs-once` | `[ -e "$f" ] \|\| continue` first; `shopt -s nullglob` | matching files, none |
| `regex-backslash-dropped` | `[[ $x =~ \bfoo ]]` → `re='\bfoo'; [[ $x =~ $re ]]`; `\d` → `[0-9]`, `\D` → `[^0-9]` (no POSIX regex has them, even from a variable); none for an escape in a bracket expression (`[\s]`) | strings that match and do not |
| `nounset-unbound` | `$x` → `${x:-}` (when the analyzer gives `fix`) | unset, empty, set; with `set -u` |
| `bracket-close-glued` | `[ -f a.txt]` → `[ -f a.txt ]` (with a variable, `[ -f $x]`, the style check of src/pitfalls.ts says it; none when the `]` is escaped, `b\]`) | file present, absent |
| `script-last-test-returns-status` | `[ -f x ] && cmd` last → `if [ -f x ]; then cmd; fi`; `exit 0` after it | the test true, false |
| `unbraced-element` | `$a[1]` → `${a[1]}` | an array of two elements; files that match `$a[1]` as a glob |
| `array-joined-in-assignment` | `x=$@` → `x=("$@")`, or `x="$*"` when one string is meant (only where the IFS starts with a space: `"$*"` joins with its first character) | arguments with spaces, none |

The style checks of src/pitfalls.ts are mechanical: `[-f x]` → `[ -f x ]`, `x = 1` → `x=1`, `{echo a;}` → `{ echo a; }`, `}` after a command → `; }`, `rm -rf $D/…` → `"${D:?}"/…`, `read x` → `read -r x`, `<` in `[ ]` → `\<`, `$x]` → `$x ]`, `&&` in `[ ]` → `] && [`. Two give advice instead, whose rewrite changes what runs as meant: `source lib.sh` → `source ./lib.sh` (another file when `$PATH` has one of the name), and a regex pattern that is a variable → `-F`, `-w` or `-x`.

### 3.2 The data

A fact (and a style check) that suggests a mechanical rewrite carries it (src/rewrite.ts, src/messages.ts):

```ts
// src/rewrite.ts
export interface TextEdit { start: number; end: number; text: string }   // offsets in the text explained
export interface Rewrite { code: string; edits: readonly TextEdit[] }
// src/messages.ts
export interface Fact { id: FactId; /* … */ rewrite?: readonly Rewrite[] }
```

- **A list of alternatives.** Each `Rewrite` is complete in itself: its edits, applied together, make the rewritten script. The first is the one the note recommends; the others are other ways to the same end. `unmatched-glob-runs-once` has two: `[ -e "$f" ] || continue` first in the body, and `shopt -s nullglob` before the statement that holds the loop (none in sh, and none before a loop that is a function's body).
- **One source.** The params of the fact carry the rewrites (`rewrite`), its text renders their `code` (the code the edits add or put in place, as the user would type it), and `fact()` copies them to `Fact.rewrite` (`Entry.rewrite`, set by `suggests`). The emitter builds the edits from the same `code` (`replaceNode`, `statementBefore`), so the note and the edits cannot disagree.
- **A file that may be sourced.** A fix that ends the script must not end the shell that sources the file. `failure-reported-as-success` reads how the file is read (`StateModel.read`, `readAs` for the node): in a function, `return 1`; in a file run as a script (a shebang, or a host that runs it: a CI step, a Dockerfile `RUN`), `exit 1`; in a file with no shebang, which may be run or sourced, `return 1 2>/dev/null || exit 1`, which returns when the file is sourced and exits when it is run (in a function there, `return 1`: where `set -e` is on, it then stops at the call). Both forms were run in bash 5.2 and 5.3 (and dash): run as `bash f.sh` and as `./f.sh`, sourced at the top level, sourced inside a function; the caller sees status 1 each time, and a shell that sources the file goes on. Under `set -e` in a sourced file, `source` returning 1 stops the shell that sourced it, as the failure would without `||`.
- **Strings read as scripts.** In a string another command reads as a script (`bash -c '…'`), the code would need quoting to go back in: the rewrite has no edits there, the note still shows its code, and the fact carries none.
- **Host files.** In a Dockerfile, a workflow, a Makefile and the other hosts, the edits would be offsets in the extracted shell text, and the code in its syntax (`${MSG}` for make's `$(MSG)`, `$f` for `$$f`; a new line inside a `RUN` that a backslash continues ends the instruction). The facts of a host carry no rewrites (src/hosts/remap.ts); the note still shows the code as the shell reads it, as before (in a Makefile, `$f` where the recipe needs `$$f`: left).

The style checks get ids, as the catalog's entries have, so that the test can name them; they stay in src/pitfalls.ts. Quick fixes for these notes in the editor are then a small step (src/fixes.ts already turns `Edit`s into code actions), but that is a feature of its own and not part of this plan (the panel redesign's P3).

### 3.3 The test

For each mechanical id, a few inputs (from the corpus where it fires, and hand-written ones). For each input, the test takes the rewrite from the fact, applies it, and runs both scripts in bash over the id's states (3.1). Each id has an oracle with two parts:

- **The meaning is kept.** The rewrite in a hazardous state does what the original does in a benign one. "Benign" is the state the author had in mind: a value without spaces, a non-empty one, files that match. This is the check PR #271 added for `unquoted-variable-as-path`: the quoted form with `a b` must give the same words as the original with `ab`.
- **The hazard is gone.** In the hazardous states the rewrite shows none of the hazard's signs: no extra or missing argument, no `*` left as text, no `unary operator expected`, no status that `set -e` stops on.

Two cheap checks for every rewrite, scenario ones included: the rewrite parses (`bash -n`), and explaining the rewrite raises no fact of the same id.

The inventory test grows with it: every fact of a mechanical id that the corpus raises must carry a rewrite. Step 4 listed the ids still without one, and the list shrank to empty (#WORDS).

Scenario ids follow with stubs: `ssh host cmd` and `sudo cmd` as `env -i bash -c`, `docker run … cmd` as the same, bats through test/bats-real.test.ts, and `shebang-refused` by running a file whose shebang carries the options, before and after the rewrite.

## 4. C: normalization audit

### 4.1 Inventory

Every function that maps several spellings to one key, what it identifies, and the near-misses to run:

| function | where | what it makes the same | near-misses to run |
|---|---|---|---|
| `aliasOf`, `canonicalName`, `impliedWords` | src/dict/aliases.ts | `egrep` = `grep -E`, `fgrep` = `grep -F`, `gawk`, `mawk`, `nawk` = `awk`, `python` = `python3`, any path's basename | GNU grep 3.8 and later warns on stderr for `egrep`; `mawk` and `gawk` differ (CLAUDE.md keeps those out of the comparisons); `python` may be Python 2 |
| `lookupCommand` | src/dict/aliases.ts | `/bin/kill`, `/usr/bin/printf`, `/bin/echo` read with the program's spec, a bare name with the builtin's | `kill -l` of procps and of bash; `/bin/echo -e`; `\kill` is still the builtin |
| `commandName` (`text.split('/').pop()`) | src/pitfalls.ts, also read by src/wordfacts.ts | `rm`, `/bin/rm`, `./rm`, `x/rm` | `./read x` runs a script named `read`, but gets the `read -r` pitfall (checked while writing this page); `./rm` likewise |
| `nameOf`, `commandIs` (`staticWordValue` of the name) | src/idioms.ts | `cd`, `\cd`, `'cd'`, `c""d` | a function or alias named `true`, `cd` or `trap` (idioms do not ask `resolveName`); `command cd` |
| `staticWordValue`, `unquoteWord`, `staticWordText`, `decodedText` | src/staticword.ts | every quoting of the same text (`h\i` = `hi`, `"a"'b'` = `ab`, `$'\x24HOME'` = `$HOME`) | `$'a\0b'` (bash stops at the NUL), `$'\cA'`, `$'é'` under `LC_ALL=C`, `$"…"`, `"\a"` keeps its backslash, a backslash-newline in each quoting |
| `unquote` | src/embedded/find.ts | `'('`, `"("`, `\(` as `(` for find's expression | `'a'"b"` stays with its quotes (find gets `ab`); `'a'b'` becomes `a'b` (checked while writing this page) |
| `wordText`, `writtenAsBracket`, `bracketShape` | src/testexpr.ts | `[ … ]`, `test …`, `\[`, `command [`; `\(` as `(` | `==` in `[` (bash yes, dash no); `-a` and `-o` with four or more words; `[ "(" ]` |
| `outputsOf` | src/idioms.ts | `>/dev/null 2>&1`, `&>/dev/null`, `>&/dev/null` as a quiet command | `2>&1 >/dev/null` leaves stderr on the terminal; `>/dev/null 2>&1` after a `{fd}` redirection |
| `lookupOption` (long prefixes), bundles, attached values | src/argv/interpret.ts | `ls --almost` = `--almost-all`, `-abc` = `-a -b -c`, `-F'\|'` = `-F '\|'`, `--x=v` = `--x v` | an ambiguous prefix; an optional value (`--color` vs `--color auto`, `date -I`, `sed -i` vs `sed -i.bak`); tools that take no prefixes |
| `shellFromName` | src/dialect.ts | `bash`, `bash5`, `/bin/bash`; `sh`, `dash`, `ash` | `sh` is dash on Debian, bash elsewhere; bash started as `sh` is in POSIX mode |
| text-keyed caches | src/semantics/state.ts (`shared` alias trees), src/semantics/walk/arith.ts (`arithTrees`, `constants`) | two places with the same text read as one tree | an alias text whose parse depends on `extglob` at that point; an arithmetic text read as a subscript and in `$(( ))` |
| `testChain` | src/fixes.ts | `[[ … ]]` and the `[ … ]` it writes | already run in bash and dash (test/fixes.test.ts) |

Several are already compared with real tools in places: the option forms in test/options-fixes.test.ts and the examples tests, the `[ ]` forms in test/testexpr.test.ts, the aliases of commands in test/aliases.test.ts. None pins both directions for a whole table.

### 4.2 The test

One table, `test/fixtures/oracles/normal-forms.json`. Each row names a normalizer, a group of forms, what to observe (stdout, stderr, status, or the files left), and whether bash treats the forms the same:

```json
{ "normalizer": "canonicalName", "same": ["grep -E 'a|b' f", "egrep 'a|b' f"], "observe": ["stdout", "status"] }
{ "normalizer": "outputsOf", "differ": ["command -v x >/dev/null 2>&1", "command -v x 2>&1 >/dev/null"], "observe": ["stdout", "stderr"] }
```

The test checks both sides of each row:

- **The normalizer**: forms in `same` get one key; each form in `differ` gets a key of its own (or the explanation differs, for normalizers that have no key of their own, such as `commandName`).
- **bash** (or the tool): the `same` forms give the same observations in the sandbox of 2.4; the `differ` forms give different ones. A `differ` row bash runs the same is stale and fails.

Then a generator, seeded, makes more forms of each word than a table can hold: quoting variants (`'x'`, `"x"`, `\x`, `x""`, `$'x'`), path prefixes (`/bin/`, `./`), option spellings (bundled, split, attached, `=`). It groups them by the normalizer's key and runs each group in bash. A group whose forms bash runs differently is a false merge: a failure, with the forms. A form bash runs the same as a group it is not in is a missed match: reported, not failed (it is a missing explanation, not a wrong one).

## 5. What each would have caught

| check | past bugs of its kind |
|---|---|
| A | The "which expansions apply" group of semantics.md, section 1 (about 14): `x=*.txt` shown as a glob, `${a[$k]}` said split, `"$@"` said one argument, `[ -n $x ]`. The 0.8.0 fixes: `cp $a b` said split after `IFS=; set -f`; `~` after `=` and `:`; no splitting in `<<< $x` and `${s:$i}`; an ambiguous redirection to `> *.log`. Each is a word whose fields differ from bash's in a simple command; most of those inputs are in the corpus now. A would not catch wrong wording with the right fields. |
| B | PR #271: the note for `rm -rf $DIR/*` said to write `"$DIR/*"`, which removes a file named `*`; the empty-`DIR` pitfall had the same problem with `"${DIR:?}/…"`. The quick fixes have been run in bash and dash since they were added, which is why none of them had such a bug. |
| C | The 0.8.0 idiom fixes: idioms were read from the text and fired where bash does something else (`trap - EXIT` taken for a clean-up, `while [ $# > 0 ]` taken for a test while it writes a file named `0`, text in quotes taken as code). Missed matches of the same functions: `egrep -q` was not `grep -q`, an alias of `rm` was not `rm`, `\[ -f x ]` and `\declare` were not `[` and `declare`; `bash5` was not bash (a review fix). New, found while writing this page: `./read x` gets the `read -r` pitfall, and find's `unquote` keeps the quotes of `'a'"b"`. |

## 6. Steps

Each step is a PR. Each keeps every test passing and 100% coverage of `src/`. The order puts the cheap, high-value ones first. Steps 1 to 4 are done; steps 5 to 10 are not started.

1. **B1, inventory.** Done (#273). This page, and test/suggestions.test.ts: every catalog entry classified, checked against its English text, and the counts pinned.
2. **A1, argv over sample.sh and the fixtures.** Done (#432; 2.6). test/support/argv.ts makes the markers of 2.2 and reuses the probe harness and the alignment rule of word-probes (`alignRuns`, moved to test/support/probe.ts so that both use it). test/argv.test.ts runs the fixtures (not the snippets yet) in one sandboxed batch. Known differences go in test/fixtures/argv-known.json, with the counts; the fixtures show none. Bugs it finds are fixed in their own PRs, each with a CHANGELOG line. The panel redesign's P4a ([panel-redesign.md](panel-redesign.md)).
3. **A2, the snippets and the fuzz inputs.** Done (#449; 2.7). The same test over a seeded sample of the snippets in CI, and over all the snippets and 200 fuzz inputs in a script run by hand (scripts/argv-corpus.ts; section 7), with the two environments of 2.3, the pinned count of unknown words, and the "could know" report. It starts with the differences of 2.6. The check of 2.3 that an unknown word's tokens state no field count is left to step 9, with the other renderings.
4. **B2, rewrite data for the catalog.** `Fact.rewrite` (3.2) for the 17 mechanical ids; the notes render their suggestion from it. src/wordfacts.ts, src/statusfacts.ts and src/explain/ emit it. Each id's rewrites are run in bash as they land (test/rewrites.test.ts: the oracle of 3.3 on hand-written inputs, 5.2 and 5.3, with recorders for the commands that would act), and test/suggestions.test.ts lists the mechanical ids still without them. Started (#453): the type, the plumbing, `failure-reported-as-success` and `unmatched-glob-runs-once`, which the panel redesign's P3 needs first (with B4 for two style checks). Then (#454) `wrapper-assignment-expanded-first`, `unbraced-element`, `regex-backslash-dropped` and `bracket-close-glued` (test/rewrites-misc.test.ts). Then (#STATUS) `declaration-masks-status`, `postfix-increment-status`, `function-last-test-returns-status`, `function-last-test-stops-script` and `script-last-test-returns-status` (test/rewrites-status.test.ts). Done (#WORDS) with `unquoted-variable-as-path`, `unquoted-variable-in-test`, `for-over-unquoted-args`, `prefix-assignment-expanded-first`, `array-joined-in-assignment` and `nounset-unbound` (test/rewrites-words.test.ts): test/suggestions.test.ts now finds no mechanical id without rewrites.
5. **B3, run the rewrites.** test/rewrites.test.ts: the states and oracles of 3.3 for each mechanical id, and the two cheap checks for all. The inventory test then requires a rewrite on every mechanical fact.
6. **B4, the style checks.** Ids and rewrite data for the nine checks of src/pitfalls.ts, then the same test.
7. **C1, the normal-forms table.** test/fixtures/oracles/normal-forms.json with rows for each normalizer of 4.1, and the two-sided test. It starts with the near-misses of 4.1; those that bash runs differently from what we say are fixed in their own PRs.
8. **C2, the generator.** Seeded forms per normalizer, grouped by key and run (4.2).
9. **A3, renderings and roles (2.5).**
10. **B5, scenario ids**, with the stubs of 3.3, one group per PR (wrappers and remote shells, extglob and aliases, bats).

## 7. Cost in CI

The Node 24 job takes about 6 minutes. The new checks must stay cheap; where they would not, they are sampled with a fixed seed, and the full run is a script to run by hand (as test/decisions.test.ts does with `checkAll`).

A bash run costs about 15 ms here (measured on this machine, WSL 2, both when Node spawns it and in a bash loop); Linux CI runners are likely faster, but the estimates use 15 ms. So the number of bash processes is what counts, and each check keeps it small.

| step | bash processes | estimate |
|---|---|---|
| B1 | none | under 0.1 s |
| A1 | about 20 inputs (the fixtures) × 2 environments | under 1 s |
| A2, full | 1,236 inputs × 2 environments, plus 200 fuzz inputs: about 2,700 | 40 s serial, 10 s on 4 jobs: too slow for every push |
| A2, in CI | the fixtures and 300 snippets (fixed seed) × 2 environments: about 640 | about 2.5 s on 4 jobs |
| B3 | about 12 ids × 5 inputs; the states of one input run in one bash, each in a subshell | about 1 s |
| C1 | about 100 rows | about 1.5 s |
| C2 | 500 generated forms (fixed seed), one bash per group of forms | about 1.5 s |

In total about 7 s in CI. The model side is small: `wordFields` over the whole corpus takes 0.7 s. The full A2 run is a script to run by hand before a release (as test/decisions.test.ts offers `checkAll` for a larger run); the sample's seed is fixed, so CI is deterministic.

## 8. Risks and open questions

- **Stubbing changes the run.** External commands return 0 and print nothing, so later values that depend on them differ from a real run. The model gives those values as unknown, so the comparison stays sound; but a bug in what the model calls unknown could hide. The "could know" report shows where the model is more cautious than it needs to be.
- **systemd-run in CI.** GitHub's runners may not offer a user scope. The fallback is `ulimit` (2.6); the test gives the same counts with and without the scope.
- **Bash versions.** The probes need bash 5.2 (`probeSkipReason`). CI has it; a developer without it skips the run-based tests, as today.
- **The corpus changes the inputs.** Adding snippets can expose a latent bug, as with the fuzz test. Fix the bug; do not drop the input.
- **Oracles of B are written by hand.** A wrong oracle can accept a wrong rewrite. Each oracle is small and states the benign state it compares with; a review checks them.
