# bash versions: 5.2 and 5.3

bash 5.2 stays the reference of the explanations. The explainer can also explain a script as bash 5.3 reads and runs it. This document says where the version comes from, how it reaches the explanations and the models, which differences of 5.3 we explain, and how they are tested.

Status: steps 1 (#283) and 2 of section 7 are done. Steps 3 to 7 are not started.

## 1. Why

- Our parser, unbash, reads bash 5.3 syntax (node_modules/unbash/README.md). So it accepts `${ cmd; }` and `${| cmd; }`, which bash 5.2 rejects when it runs them.
- Before this work, both forms were explained as the ordinary `$( )`. That is wrong for both versions. bash 5.3 runs them in the current shell, with no subshell. bash 5.2 fails with "bad substitution" and stops there: the rest of the line, and the rest of the `if`, loop or function around it, do not run, and the status is 1. Under `set -e`, and in POSIX mode, the shell exits; in a subshell, only the subshell stops.
- bash 5.3 was released in July 2025, and gnu.org serves its manual. Ubuntu 24.04, our CI and the bash-doc package have 5.2. Readers have both.

## 2. The version dimension

### 2.1 Where it comes from

- One setting, `bashExplainer.bashVersion`: `"5.2"` (the default) or `"5.3"`. It is in src/settings.ts, so every surface has it: VS Code (package.json, with the texts in package.nls.json and package.nls.ja.json), the web page's settings dialog, the command-line tool (`--bash-version 5.3`, `--set bashVersion=5.3`, or the settings file, where the number `5.3` is read as the release too) and the Language Server.
- The GitHub Action (action.yml) takes it as the input `bash-version`, passed as `--bash-version` when the tool's `--help` lists it, as `strict` is; with an older tool pinned by `package`, the step fails and says so.
- The file does not say it. A shebang names a program (`#!/usr/bin/env bash`), not a release. A ShellCheck directive (`# shellcheck shell=bash`) has no version either. A name such as `#!/usr/local/bin/bash5.3` is rare, and `shellFromName` already strips the digits; we do not read a version from it.
- A file-level directive of our own (`# bash-explainer bash=5.3`, beside `# bash-explainer disable=`) is possible later. It is left out until someone needs it.
- `BASH_COMPAT=52` or `shopt -s compat52` in a script does not make bash 5.3 a bash 5.2: the syntax of 5.3 stays (a `${ cmd; }` still runs). They change only the few behaviours listed in COMPAT. We do not read them.
- The version matters only for bash. A script for another shell (`sh`, `dash`, `zsh`…) is checked against that shell, as before.

### 2.2 How it flows

- `ExplainOptions.bashVersion` carries it to the analyzer (`explainOptions(settings)`), like `yqFlavor`.
- `documentIssues` and `diagnosticsFor` take it for the problems of a document (`diagnosticsFor` reads it from the settings).
- The dialect check takes it: `dialectIssues` and `dialectNotes` get the version, and for bash they report the constructs that version lacks (`versionIssues` in src/bashversion.ts).
- The semantic model does not take it yet. When step 3 needs it, it becomes one more part of the model's key in `shellState(tree, shell, { version })`, beside `posix` and `host`. Step 1 did not need it (see 4.2).

### 2.3 A construct of the other version

The rule is the one of the other shells' dialect checks: explain the construct as it is, and say where it does not work.

- The tokens say what the construct does in the version that has it, and name that version: "Command substitution `${ …; }` (bash 5.3): runs the commands in the current shell…".
- When the version set lacks it, a dialect issue says so, with what that version does instead: "⚠ `${ …; }` (command substitution in the current shell) is bash 5.3 syntax: bash 5.2 reports "bad substitution" and stops there: the rest of the line, and the rest of the `if`, loop or function around it, do not run (status 1). Under `set -e`, and in POSIX mode, the shell exits; in a subshell, only the subshell stops. Instead, use `$(…)` (it runs in a subshell)". It is a note on the line and a warning in the Problems panel, with the construct's code (`funsub`, `valsub`), which `diagnostics.ignore` can turn off.
- The version that has the construct can still reject a use of it. unbash ends `${ echo a }` at the `}`, but bash 5.3 reads that `}` as an argument of `echo` (a `}` ends the substitution only where a reserved word can be: after `;`, `&`, a newline or a compound command), then looks for another `}` or reports a syntax error; after a compound command's redirections (`${ { a; } >f }`) or a bare `time`, the `}` is a syntax error. `braceTakenAsWord` (src/syntax/tree.ts) finds both; the token is a syntax error, and in a version that has the construct, a dialect issue says so (`funsubBrace`). In 5.2 mode, the issue of 5.2 is enough.
- The table of when each construct came is in src/bashversion.ts (`SINCE`). Its ids are those of `FEATURES` in src/dialect.ts. `FEATURES` keeps its letters measured with bash 5.2 (a feature of 5.3 has no `b`), so the other shells' checks stay as they are.
- A construct that bash 5.3 removes or changes (none in the syntax so far) would get an `UNTIL` table the same way.

## 3. Inventory: from 5.2 to 5.3

From NEWS, CHANGES (5.3-alpha to 5.3-rc2) and COMPAT of the bash-5.3 tarball, each checked with a bash 5.3 built from it and with the bash 5.2.21 of CI. "Today" is what the explainer said before step 1 (#283); step 1 did the rows of 3.1, and the other rows are still as "Today" says. Priority: 1 is representative usage (tutorials, scripts people write), 3 is rare or interactive only.

### 3.1 Syntax

| Change | Today | Needed | Prio |
| --- | --- | --- | --- |
| `${ cmd; }`: command substitution in the current shell; output captured, trailing newlines removed; `local` and `return` work as in a function; side effects stay (`cd`, variables, `exit` exits the shell). bash 5.2: "bad substitution", status 1, and the rest of the line and of the `if`, loop or function around it does not run. ksh93 and mksh have it; zsh 5.9, dash, busybox ash and yash do not. | Explained as `$( )`, "runs in the subshell of `$( )`" | Its own explanation; issue in 5.2 mode; `FEATURES` entry for the other shells; the model: no subshell (done in step 1), and the walk keeps what it changes (step 3) | 1 |
| `${| cmd; }`: runs `cmd` in the current shell and expands to `$REPLY`, which is local to it (trailing newlines kept); the output of `cmd` is not captured. bash 5.2 as above. mksh has it. | Explained as `$( )` | As above, plus: its value is `REPLY`; stdout goes where the shell's goes (pipeline and example readers must not take it for captured output) | 1 |
| `}` of `${ …; }` may be joined to the rest of the word (`${ echo a;}b`) | Parsed by unbash | Nothing beyond the above; covered by the tests of step 1 | 2 |

### 3.2 Builtins and their options

| Change | Today | Needed | Prio |
| --- | --- | --- | --- |
| `source -p PATH file` (and `. -p`): look for the file in PATH, not `$PATH`. 5.2: "invalid option", status 2. | "`-p`: option not in the dictionary" | Option in the spec of `source`/`.`, gated by version (a spec field `since`, read by the argument interpreter); issue in 5.2 mode | 2 |
| `compgen -V var`: store the completions in the array `var`. 5.2: "invalid option", status 2. | `-V` unknown, and the words after it are taken for the word to complete (wrong) | Option in the spec, gated | 2 |
| `trap -P sig`: print the action of each signal. 5.2: "invalid option". | `-P` unknown; `INT` is said to reset the trap (wrong with `-P`) | Option in the spec, gated | 2 |
| `read -E`: read with readline and bash's completion. 5.2: "invalid option". | `-E` unknown | Option in the spec, gated | 3 |
| `printf %#q` and `%#Q`: the alternate form forces single quotes (`'a b'`). In 5.2 the `#` has no effect (`a\ b`). | "with a 0x/0 prefix": wrong in both versions | Done in step 2: the meaning by version, also in the example | 1 |
| `printf %ls`, `%lc` (`%S`, `%C`): wide strings and characters in a multibyte locale. 5.2 also accepts `%ls` (the `l` is ignored); `%S` and `%C` are "invalid format character" there, status 1. | "unknown conversion `l`": wrong in both versions | Done in step 2: the length modifiers of C are read (`%ld` was wrong too), the meaning by version; no example of a character that is not ASCII (it depends on the locale) | 2 |
| `command declare a=(…)` keeps the assignment parsing of `declare` (POSIX). | Not checked | Check with both versions; the reading of `command`'s operands | 3 |
| `test` with more than 4 arguments and parentheses: a parenthesized part of 4 or fewer arguments is read with the POSIX rules (as coreutils does). `BASH_COMPAT=52` restores the old algorithm. | src/testexpr.ts reads the 5.2 way | Compare src/testexpr.ts with both versions on generated expressions; differ only where they differ | 3 |
| `[[ =~ ]]` prints an error when the regex does not compile | Status only | A note in 5.3 mode, if the regex reader can tell | 3 |
| `type -a -P` reports hashed paths and the `$PATH` search; `umask` POSIX additions; `wait -n` returns process substitutions and notified jobs; `bind -p/-P` names; `complete -o fullquote` | Generic or none | Option descriptions where a spec exists; nothing for job control | 3 |
| `MULTIPLE_COPROCS` on by default | Nothing said about several coprocs | Check whether any note assumes one coproc | 3 |

### 3.3 Variables and shell options

| Change | Today | Needed | Prio |
| --- | --- | --- | --- |
| `GLOBSORT`: how globs are sorted (`name`, `size`, `blocks`, `mtime`, `atime`, `ctime`, `numeric`, `none`, `-` for descending). | A plain variable | Describe it (5.3); glob examples sort by it when set; in 5.2 it is a plain variable (no effect) | 2 |
| `BASH_TRAPSIG`: the signal number of the trap running. | "Expands to the value of `BASH_TRAPSIG`" | Describe it; in 5.2 it is unset | 2 |
| `BASH_MONOSECONDS`: the monotonic clock. | Generic | Describe it; in 5.2 it is unset | 3 |
| `shopt -s array_expand_once` (replaces `assoc_expand_once`, which stays as a synonym). 5.2: "invalid shell option name", status 1. | "option name" | The shopt names of the model by version; issue in 5.2 mode | 2 |
| `shopt -s bash_source_fullpath`: full paths in `BASH_SOURCE`. 5.2 as above. | "option name" | As above | 3 |
| `$TIMEFORMAT` precision up to 6 digits (`%6R`) | Nothing said | Describe the format when we describe `TIMEFORMAT` | 3 |
| `patsub_replacement`: its default can be chosen when bash is built (still on by default) | On, as 5.2 | Nothing | – |

### 3.4 POSIX mode and status

| Change | Today | Needed | Prio |
| --- | --- | --- | --- |
| In POSIX mode, a function name need not be an identifier (`a-b() { …; }`). 5.2 in POSIX mode: "not a valid identifier", and the shell exits. | Nothing said | The name check of the model in POSIX mode, by version | 3 |
| In POSIX mode, a command substitution sets `$?` only in a command made only of assignments. | The status model follows 5.2 | The status model in POSIX mode, by version | 3 |
| In POSIX mode, `test`'s `<` and `>` compare in the locale | Nothing said | A note in POSIX mode | 3 |
| `exit` and `return` with no status in a trap: interp 1602 | The status model of traps follows 5.2 | Check with both versions | 3 |
| Special builtins exit the shell in POSIX mode on more errors | Nothing said | Check what the status model says | 3 |

Left out: readline and completion changes, job notifications, messages, `$BASH` for `su`, the loadable builtins (`kv`, `strptime`, `fltexpr`), build options.

## 4. The semantic model

### 4.1 What a `${ }` is to the model

- It is a command substitution: `set -e` is off inside it, unless `inherit_errexit` (checked with bash 5.3), and a command made only of assignments takes its status, as with `$( )`. The note on `set -e` names the form used.
- It runs in the current shell. src/semantics/env.ts gives it no subshell link (`subshellReasons`), so `processOf` says the main shell and the analyzer does not say "runs in the subshell of `$( )`".
- What it changes stays: variables (not `local` ones), `cd`, options, traps, functions. `exit` exits the shell; `return` ends the substitution, also in a function (the function goes on). So `local` in it is no pitfall, and `return` is explained as ending it (`scopeOf` in src/substitution-tokens.ts). In a ksh93 or mksh script, the tokens leave out what only bash 5.3 is checked to do.

### 4.2 Steps for the model

- Step 1 (done, #283): no subshell in the environment model, and the decisions trust nothing in a script that has one (src/semantics/trust.ts makes the script blind). The walk still drops what it changes, as for `$( )`; with nothing trusted, no condition or dead code is decided from that.
- Step 3 (not started): the walk runs a `${ }` in the current shell with a function-like scope (locals, `return`), and keeps the state after it; `${| }` gives `REPLY`'s value. Then the trust rule can be lifted. src/semantics/walk/walker.ts is at its length ceiling, so this needs the substitution walk moved out first.
- Bash 5.2 mode does not change the model: the explanation of the construct is the one of 5.3, and the issue says what bash 5.2 does instead. Modelling the failure (the rest of the line and of the compound command around it is skipped, status 1, the shell exits under `set -e` and in POSIX mode) is left out: a script for bash 5.2 with this construct is broken anyway, and the issue says so.

## 5. Manual citations

- src/manual.ts keeps the section numbers of bash 5.2 and links to gnu.org, which serves the 5.3 manual. One table serves both versions.
- Every section the inventory needs exists in both manuals, under the same node name: Command Substitution (3.5.4) describes `${ }` and `${| }` in 5.3; Bash Variables (section 5.2), The Shopt Builtin (4.3.2), Bourne Shell Builtins (4.1) and Bash Builtins (4.2) list the new variables, options and flags; Filename Expansion (3.5.8) points to `GLOBSORT`.
- The 5.3 manual moves "Bash POSIX Mode" from 6.11 to 6.11.2 and adds 6.11.1 "What is POSIX?". We cite 6.11 by its 5.2 number; nothing cites the new node.
- A fact true only in 5.3 cites the same sections, and its text names the version ("bash 5.3"). If a 5.3-only node is ever needed, it gets an entry with its 5.3 number and a note that 5.2 has no such section.
- test/manual.test.ts checks the table against the 5.2 bashref.texi (`BASH_SOURCE_DIR`). A second run against the 5.3 bashref.texi would check that every page name still exists there; that is a later step.

## 6. Testing

- A real bash 5.3 is run as a separate program, found in `$BASH_EXPLAINER_BASH53` (a path). test/bash53.test.ts runs each case with it and with the bash 5.2 on `PATH`, and checks what we say against both: the explanation in 5.3 mode, and the issue in 5.2 mode ("bad substitution", status 1). Without the binary, the 5.3 half is skipped, as test/bash-ast.test.ts is; `BASH_EXPLAINER_BASH53_REQUIRED=1` makes a missing binary fail.
- CI builds bash 5.3 from the release tarball (pinned by its SHA-256; from ftpmirror.gnu.org, else mirrors.kernel.org, else ftp.gnu.org, each download checked; the job has a 15-minute limit), with `./configure --without-bash-malloc && make`, in `$RUNNER_TEMP`, in a job of its own (`bash53`, like `bash-ast`), and runs test/bash53.test.ts there with `BASH_EXPLAINER_BASH53_REQUIRED=1`. The build takes about a minute. It is not cached: the repository keeps no copy of a GPL binary (6.1). Coverage does not depend on it: the 5.3 half checks bash, not new branches of src/.
- The probes of the models (test/state-probes, env-probes, status-probes…) run bash 5.2. A row about a 5.3 construct goes in test/bash53.test.ts, not in the 5.2 probe files, until the probe runners take a version.
- test/dialect.test.ts probes `FEATURES` in the installed shells; the probes of `funsub` and `valsub` print "ok" only where the construct works (ksh93 and mksh; mksh for `${| }`; and a bash on `PATH` of a release that has it, as `SINCE` says).

### 6.1 The GPL rules

bash is GPL-3.0. We run it only as a separate program. We never vendor, link or bundle it, never copy its code or its manual's text, never add it to package.json, and never store or publish its binary (no artifact, cache, commit, release or bundle), as for bash-ast. NEWS, CHANGES, COMPAT and bashref.texi are read to write this inventory in our own words.

## 7. Steps

Each step is a PR that keeps every test green and coverage at 100%.

1. Done (#283). The setting on every surface; `${ }` and `${| }` explained as bash 5.3 runs them, with the issue in 5.2 mode; their `FEATURES` entries; no subshell in the environment model and no decision in a script that has one; test/bash53.test.ts; CI builds bash 5.3.
2. Done. Fixes that hold in both versions, found by the inventory: `printf %#q` (5.2: the `#` does nothing), `printf %ls` and `%lc`. The embedded explainers get the release whose builtin reads the text (`EmbeddedContext.bash()`; undefined for a program), and `explainPrintf` and `bashPrintf` a reader (`PrintfReader`: a bash release or coreutils; awk's printf as before). Found on the way, in both releases: `%Q` (bash 5.2 has it too), the length modifiers of C (`%ld`), precisions and widths in bytes, and what `%q` quotes (`,` and `^`; `#` and `~` only at the start of a word); and in coreutils printf, no `%#q`, `%Q`, `%S`, `%C` or `%(…)T`.
3. The walk runs `${ }` in the current shell and keeps its changes (4.2); `${| }` gives `REPLY`.
4. Version-gated options in the command specs (`since` on an option, read by the argument interpreter, with the issue in 5.2 mode): `source -p`, `compgen -V`, `trap -P`, `read -E`.
5. Variables and shell options: `GLOBSORT` (and the glob examples), `BASH_TRAPSIG`, `BASH_MONOSECONDS`, `array_expand_once`, `bash_source_fullpath`.
6. POSIX-mode and `test` differences, checked with generated cases against both versions.
7. test/manual.test.ts against the 5.3 bashref.texi too.
