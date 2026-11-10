# Backlog archive

Items of the old roadmap that were dropped or merged into another item when the roadmap moved to GitHub Issues on 2026-11-06, and every item dropped since. The board (see [roadmap.md](roadmap.md)) holds the work that is planned; this file holds what was judged and left, with the reason, so that a bug that comes back finds the earlier judgement.

Search it before you fix a rare bug or propose a refactor: `grep -n -i "<a word of the input>" docs/backlog-archive.md` (a command name, an option, an expansion such as `${!`, a file such as `panelRows`). An entry is dropped (rare corner, YAGNI, or no effect users see) or merged into an issue, which then carries its text. Reviving one means an issue on the board, with the reason that changed.

The old roadmap, with its "Done lately" list of finished work, is kept at its last commit: [docs/roadmap.md at 28e8a754](https://github.com/sf624/bash-explainer/blob/28e8a754255316700b99050a1c1f6a4bf9abd4ae/docs/roadmap.md). Each entry links its line there. One entry, "Source guards, stage SA", links the version at 8d278ab6 instead: that item was finished and had left the list before 28e8a754.

Each entry names its kind by the label an issue of that kind gets. For `bug`, `crash` and `missing-explanation`, the entry keeps the input and what was wrong.

## From the roadmap's Now and Next

### Source guards, stage SA

- **Verdict:** dropped, 2026-11-06. Kind: `test-infra`.
- **Reason:** Done: all five guards are on main. The standing rule ("a new fact gets a source and a guard") belongs in sources.md or CLAUDE.md, not in an issue.
- **Old roadmap:** [Now, line 15](https://github.com/sf624/bash-explainer/blob/8d278ab6506cc46b5793e482266e69201865b949/docs/roadmap.md#L15)

### Small explanation fixes from outside feedback (container)

- **Verdict:** merged into "xargs: options that cancel each other (`-n`, `-L`, `-I`)", "A blank replacement shown visibly (`${x//:/ }`, `cut -d' '`)" and "A pipeline sample with distinct lines" (#656, #657, #658), 2026-11-06.
- **Reason:** Each fix is its own PR.
- **Old roadmap:** [Next, line 21](https://github.com/sf624/bash-explainer/blob/28e8a754255316700b99050a1c1f6a4bf9abd4ae/docs/roadmap.md#L21)

### CHANGELOG bullets for the outside-feedback fixes

- **Verdict:** merged into "xargs: options that cancel each other (`-n`, `-L`, `-I`)", "A blank replacement shown visibly (`${x//:/ }`, `cut -d' '`)" and "A pipeline sample with distinct lines" (#656, #657, #658), 2026-11-06. Kind: `documentation`.
- **Reason:** Each PR writes its own bullet.
- **Old roadmap:** [Next, line 25](https://github.com/sf624/bash-explainer/blob/28e8a754255316700b99050a1c1f6a4bf9abd4ae/docs/roadmap.md#L25)

## From the roadmap's Deferred

### F6 on a phone profile with a hardware keyboard

- **Verdict:** dropped, 2026-11-06. Kind: `ui`.
- **Reason:** Rare: a phone with a hardware keyboard.
- **Old roadmap:** [Deferred, line 31](https://github.com/sf624/bash-explainer/blob/28e8a754255316700b99050a1c1f6a4bf9abd4ae/docs/roadmap.md#L31)

### Panel can shrink to 108 px at 768 px

- **Verdict:** dropped, 2026-11-06. Kind: `ui`.
- **Reason:** One width, cosmetic.
- **Old roadmap:** [Deferred, line 33](https://github.com/sf624/bash-explainer/blob/28e8a754255316700b99050a1c1f6a4bf9abd4ae/docs/roadmap.md#L33)

### Tap on the peek summary lost after a drag

- **Verdict:** merged into "Usability: the phone's sheet" (#659), 2026-11-06. Kind: `ui`.
- **Reason:** The phone's sheet. U8 checks on a device anyway.
- **Old roadmap:** [Deferred, line 34](https://github.com/sf624/bash-explainer/blob/28e8a754255316700b99050a1c1f6a4bf9abd4ae/docs/roadmap.md#L34)

### Smooth scroll cut short when the settings settle

- **Verdict:** dropped, 2026-11-06. Kind: `ui`.
- **Reason:** Rare timing corner.
- **Old roadmap:** [Deferred, line 35](https://github.com/sf624/bash-explainer/blob/28e8a754255316700b99050a1c1f6a4bf9abd4ae/docs/roadmap.md#L35)

### Wrap off, scrolled sideways: settings reset the scroll

- **Verdict:** dropped, 2026-11-06. Kind: `ui`.
- **Reason:** Rare combination.
- **Old roadmap:** [Deferred, line 36](https://github.com/sf624/bash-explainer/blob/28e8a754255316700b99050a1c1f6a4bf9abd4ae/docs/roadmap.md#L36)

### Block bar scrolls out sideways with wrap off; only the innermost block

- **Verdict:** dropped, 2026-11-06. Kind: `ui`.
- **Reason:** Wrap off only. The innermost mark is a design choice.
- **Old roadmap:** [Deferred, line 37](https://github.com/sf624/bash-explainer/blob/28e8a754255316700b99050a1c1f6a4bf9abd4ae/docs/roadmap.md#L37)

### Divider drag beside the settings hides the cursor row

- **Verdict:** dropped, 2026-11-06. Kind: `ui`.
- **Reason:** Rare combination.
- **Old roadmap:** [Deferred, line 38](https://github.com/sf624/bash-explainer/blob/28e8a754255316700b99050a1c1f6a4bf9abd4ae/docs/roadmap.md#L38)

### Toggling wrap beside the settings moves the row

- **Verdict:** dropped, 2026-11-06. Kind: `ui`.
- **Reason:** Rare combination.
- **Old roadmap:** [Deferred, line 39](https://github.com/sf624/bash-explainer/blob/28e8a754255316700b99050a1c1f6a4bf9abd4ae/docs/roadmap.md#L39)

### Settings-sheet mode decided in four places

- **Verdict:** dropped, 2026-11-06. Kind: `refactor`.
- **Reason:** No user effect, and its symptoms ("Smooth scroll cut short when the settings settle" (backlog-archive.md), "Wrap off, scrolled sideways: settings reset the scroll" (backlog-archive.md), "Divider drag beside the settings hides the cursor row" (backlog-archive.md), "Toggling wrap beside the settings moves the row" (backlog-archive.md)) are dropped.
- **Note:** dropped with its symptoms ("Smooth scroll cut short when the settings settle" (backlog-archive.md), "Wrap off, scrolled sideways: settings reset the scroll" (backlog-archive.md), "Divider drag beside the settings hides the cursor row" (backlog-archive.md), "Toggling wrap beside the settings moves the row" (backlog-archive.md)). The same fact is decided in four places, which is the design smell to watch if more settings-layout bugs come.
- **Old roadmap:** [Deferred, line 40](https://github.com/sf624/bash-explainer/blob/28e8a754255316700b99050a1c1f6a4bf9abd4ae/docs/roadmap.md#L40)

### Phone: a sheet move pulls back a reader who scrolled

- **Verdict:** merged into "Usability: the phone's sheet" (#659), 2026-11-06. Kind: `ui`.
- **Reason:** The same sheet work as U8.
- **Old roadmap:** [Deferred, line 41](https://github.com/sf624/bash-explainer/blob/28e8a754255316700b99050a1c1f6a4bf9abd4ae/docs/roadmap.md#L41)

### Remove the unused `TINT_ROLES`

- **Verdict:** dropped, 2026-11-06. Kind: `refactor`.
- **Reason:** Nothing is coloured by them. Taking them out risks colour shifts, for no gain.
- **Old roadmap:** [Deferred, line 43](https://github.com/sf624/bash-explainer/blob/28e8a754255316700b99050a1c1f6a4bf9abd4ae/docs/roadmap.md#L43)

### Fold-all's last jumps (about 3 px)

- **Verdict:** dropped, 2026-11-06. Kind: `ui`.
- **Reason:** Tiny. The fix changes the resting layout.
- **Old roadmap:** [Deferred, line 44](https://github.com/sf624/bash-explainer/blob/28e8a754255316700b99050a1c1f6a4bf9abd4ae/docs/roadmap.md#L44)

### `source` in sh: badge "program from PATH"

- **Verdict:** merged into "A per-shell builtin table in name resolution" (#652), 2026-11-06. Kind: `bug`.
- **Reason:** The per-shell builtin table in name resolution.
- **Old roadmap:** [Deferred, line 49](https://github.com/sf624/bash-explainer/blob/28e8a754255316700b99050a1c1f6a4bf9abd4ae/docs/roadmap.md#L49)

### `(. ./lib)` then `helper a`: "a function of the file read"

- **Verdict:** dropped, 2026-11-06. Kind: `bug`.
- **Reason:** Rare: sourcing in a subshell, then calling outside it.
- **Input and contradiction (as the roadmap had it):** `(. ./lib)` then `helper a` says "a function of the file read", though a subshell's functions do not persist.
- **Old roadmap:** [Deferred, line 50](https://github.com/sf624/bash-explainer/blob/28e8a754255316700b99050a1c1f6a4bf9abd4ae/docs/roadmap.md#L50)

### sh: `$"hi"` chip says `$hi`

- **Verdict:** dropped, 2026-11-06. Kind: `bug`.
- **Reason:** Rare: locale strings in sh.
- **Input and contradiction (as the roadmap had it):** `#!/bin/sh`, `printf '%s\n' $"hi"`: the chip says `$hi`, the example output says `hi`.
- **Old roadmap:** [Deferred, line 52](https://github.com/sf624/bash-explainer/blob/28e8a754255316700b99050a1c1f6a4bf9abd4ae/docs/roadmap.md#L52)

### Chips on dead code

- **Verdict:** dropped, 2026-11-06. Kind: `bug`.
- **Reason:** Needs a constant condition, which real guards rarely have.
- **Input and contradiction (as the roadmap had it):** Chips on dead code: `x=1; [ a = b ] || exit 0; x=2; rec $x` shows chips on lines that never run (the review of panel P9).
- **Old roadmap:** [Deferred, line 54](https://github.com/sf624/bash-explainer/blob/28e8a754255316700b99050a1c1f6a4bf9abd4ae/docs/roadmap.md#L54)

### Syntax errors the parser accepts (`echo (`, `f(`)

- **Verdict:** dropped, 2026-11-06. Kind: `bug`.
- **Reason:** Rare. Already in README Limitations.
- **Input and contradiction (as the roadmap had it):** Syntax errors that no problem says, as the parser accepts them and bash does not (test/fixtures/syntax-errors.json, `onlyBash`): `echo (`, `f(`, `echo $[1+`, `for x { :; }`. Also, accepted as rare: "Runs `cat`" for `cat <<E` whose body has a syntax error in `$( )`, where bash drops the command.
- **Old roadmap:** [Deferred, line 57](https://github.com/sf624/bash-explainer/blob/28e8a754255316700b99050a1c1f6a4bf9abd4ae/docs/roadmap.md#L57)

### Syntax problems in host files

- **Verdict:** dropped, 2026-11-06. Kind: `enhancement`.
- **Reason:** No demand. The deny-list attempt failed CI on working code.
- **Old roadmap:** [Deferred, line 58](https://github.com/sf624/bash-explainer/blob/28e8a754255316700b99050a1c1f6a4bf9abd4ae/docs/roadmap.md#L58)

### `(exit 1)` counted as a stop of the script

- **Verdict:** dropped, 2026-11-06. Kind: `bug`.
- **Reason:** Rare. Only the level differs.
- **Input and contradiction (as the roadmap had it):** What may stop a script is one table now (three-levels.md, "Where a shell stops"). Left: a stop in a subshell (`(exit 1)`) counts as one that may stop the script, though bash goes on after the subshell, so what follows is a warning where an Error would be true. A hand-written `if … exit … else … exit … fi` or `&& { py; exit; }` before Python the parser cannot read keeps the second group's Errors (25 `distro-alias-in-script` and the like in 15 of 150 files behind `"""":`), where `dead` trusts nothing and the table says `may`. An advice (`source-searches-path`) is not held to a sure stop at all.
- **Old roadmap:** [Deferred, line 59](https://github.com/sf624/bash-explainer/blob/28e8a754255316700b99050a1c1f6a4bf9abd4ae/docs/roadmap.md#L59)

### A very long line blocks the thread

- **Verdict:** merged into "A worker with time and memory limits" (#673), 2026-11-06. Kind: `crash`.
- **Reason:** The worker bounds it. Per-site speedups only if measured to matter.
- **Old roadmap:** [Deferred, line 62](https://github.com/sf624/bash-explainer/blob/28e8a754255316700b99050a1c1f6a4bf9abd4ae/docs/roadmap.md#L62)

### An `error` row stays red with no problem beside it

- **Verdict:** dropped, 2026-11-06. Kind: `bug`.
- **Reason:** Only in hosts, after `exit`, or in unsure files.
- **Input and contradiction (as the roadmap had it):** A row of the kind `error` can still be red with no problem beside it (`Token.kind`), where `syntax-error` keeps silent as it cannot be sure: in a host, after an `exit`, in a file not surely a script (found in P7b; a plain script's syntax errors and `${(f)var}` are problems since #597). To decide: the parser's own limits may make such a row wrong where bash reads the line, so whether it should stay red.
- **Old roadmap:** [Deferred, line 63](https://github.com/sf624/bash-explainer/blob/28e8a754255316700b99050a1c1f6a4bf9abd4ae/docs/roadmap.md#L63)

### `globMiss` cost for a long typed name

- **Verdict:** dropped, 2026-11-06. Kind: `refactor`.
- **Reason:** Not measured to matter.
- **Old roadmap:** [Deferred, line 68](https://github.com/sf624/bash-explainer/blob/28e8a754255316700b99050a1c1f6a4bf9abd4ae/docs/roadmap.md#L68)

### `assign-readonly` with `then: 'runs'`

- **Verdict:** dropped, 2026-11-06. Kind: `bug`.
- **Reason:** Vague, no failing case given. `then: 'runs'` is in the catalog's type.
- **Note:** dropped as vague: no failing case was given. One with a case comes back as an issue.
- **Input and contradiction (as the roadmap had it):** `assign-readonly` with `then: 'runs'` (from the review of step 1a of the three note levels): not handled yet.
- **Old roadmap:** [Deferred, line 69](https://github.com/sf624/bash-explainer/blob/28e8a754255316700b99050a1c1f6a4bf9abd4ae/docs/roadmap.md#L69)

### `restricted-refused` from an rbash shebang

- **Verdict:** dropped, 2026-11-06. Kind: `missing-explanation`.
- **Reason:** Superseded: src/explain/reads.ts reads `rbash` and `#!/bin/bash -r`. No failing case given.
- **Note:** dropped as vague: no failing case was given. One with a case comes back as an issue.
- **Input and contradiction (as the roadmap had it):** `restricted-refused` from an rbash shebang (same review): not handled yet.
- **Old roadmap:** [Deferred, line 70](https://github.com/sf624/bash-explainer/blob/28e8a754255316700b99050a1c1f6a4bf9abd4ae/docs/roadmap.md#L70)

### Cost of `diagnostics.pitfalls` off

- **Verdict:** dropped, 2026-11-06. Kind: `refactor`.
- **Reason:** Not measured, no complaint.
- **Note:** dropped as vague: no failing case was given. One with a case comes back as an issue.
- **Old roadmap:** [Deferred, line 71](https://github.com/sf624/bash-explainer/blob/28e8a754255316700b99050a1c1f6a4bf9abd4ae/docs/roadmap.md#L71)

### CRLF: heredoc being typed fails `invariants`

- **Verdict:** dropped, 2026-11-06. Kind: `bug`.
- **Reason:** Transient while typing, no crash.
- **Input and contradiction (as the roadmap had it):** CRLF: while a heredoc with no delimiter yet is typed (`cat << \r\n`), the tree fails `invariants` (a `heredoc_body` outside its redirect: `seal` trims the redirect's end at the masked CR); no crash.
- **Old roadmap:** [Deferred, line 72](https://github.com/sf624/bash-explainer/blob/28e8a754255316700b99050a1c1f6a4bf9abd4ae/docs/roadmap.md#L72)

### CRLF: `<<word` in a comment keeps a CR

- **Verdict:** dropped, 2026-11-06. Kind: `bug`.
- **Reason:** Rare.
- **Input and contradiction (as the roadmap had it):** CRLF: a `<<word` inside a comment or string keeps the CR of the next line equal to `word`, which can misread a code line such as `fi\r` (`heredocCarriageReturns`, src/syntax/adapters/continuations.ts).
- **Old roadmap:** [Deferred, line 73](https://github.com/sf624/bash-explainer/blob/28e8a754255316700b99050a1c1f6a4bf9abd4ae/docs/roadmap.md#L73)

### `sudo x="$x" bash -c "echo $x"` false Error

- **Verdict:** dropped, 2026-11-06. Kind: `bug`.
- **Reason:** The roadmap calls it rare.
- **Note:** each is rare, but a false Error is red and fails `--check`. Dropped by the approved triage.
- **Input and contradiction (as the roadmap had it):** `x=it; sudo x="$x" bash -c "echo $x"` (found in the review of #557): `wrapper-assignment-expanded-first` is an error, but the line works, as `$x` is expanded here to the value the wrapper sets. Rare; to read the assigned value against the one expanded.
- **Old roadmap:** [Deferred, line 74](https://github.com/sf624/bash-explainer/blob/28e8a754255316700b99050a1c1f6a4bf9abd4ae/docs/roadmap.md#L74)

### `HOME` replaced inside a container

- **Verdict:** dropped, 2026-11-06. Kind: `missing-explanation`.
- **Reason:** Rare.
- **Input and contradiction (as the roadmap had it):** A value the script sets that the far side replaces (second review of #557): `HOME=/srv/app; docker run img sh -c 'ls $HOME'` now has no note; the accurate one is "the container has its own `HOME`" (`CommandSlot.sets`).
- **Old roadmap:** [Deferred, line 75](https://github.com/sf624/bash-explainer/blob/28e8a754255316700b99050a1c1f6a4bf9abd4ae/docs/roadmap.md#L75)

### `ssh -o "$OPTS"`

- **Verdict:** dropped, 2026-11-06. Kind: `missing-explanation`.
- **Reason:** Rare.
- **Input and contradiction (as the roadmap had it):** `ssh -o "$OPTS"` (same review): a value not known may send any name, so every remote variable is a caveat.
- **Old roadmap:** [Deferred, line 76](https://github.com/sf624/bash-explainer/blob/28e8a754255316700b99050a1c1f6a4bf9abd4ae/docs/roadmap.md#L76)

### `ssh -o SetEnv` and `SendEnv=""` not read

- **Verdict:** dropped, 2026-11-06. Kind: `missing-explanation`.
- **Reason:** Rare.
- **Input and contradiction (as the roadmap had it):** `ssh -o SetEnv=NAME=value` is not read (same review), nor `-o 'SendEnv=""'`, which clears the names of ssh_config (`ssh -G` shows none; `-o SendEnv=` with no name is a usage error in OpenSSH 9.6): `LANG` and `LC_*` then stay caveats, where they are errors.
- **Old roadmap:** [Deferred, line 77](https://github.com/sf624/bash-explainer/blob/28e8a754255316700b99050a1c1f6a4bf9abd4ae/docs/roadmap.md#L77)

### `ssh -o 'SendEnv=A -A'`

- **Verdict:** dropped, 2026-11-06. Kind: `bug`.
- **Reason:** Rare.
- **Input and contradiction (as the roadmap had it):** `ssh -o 'SendEnv=A -A'` sends no `A` (a `-` pattern removes the names before it that match), but the model keeps `A` as maybe sent (review of #557).
- **Old roadmap:** [Deferred, line 78](https://github.com/sf624/bash-explainer/blob/28e8a754255316700b99050a1c1f6a4bf9abd4ae/docs/roadmap.md#L78)

### `runsOwnName` misses indirect wrappers

- **Verdict:** dropped, 2026-11-06. Kind: `bug`.
- **Reason:** Rare (`du(){ "$(type -P du)"; }`).
- **Input and contradiction (as the roadmap had it):** `runsOwnName` (src/semantics/names.ts) misses indirect wrappers (review of #557): `df(){ bash -c 'df -h'; }`, `du(){ "$(type -P du)"; }`, `ls(){ _ls; }; _ls(){ command ls; }`. Such a function is then taken as one that only has the program's name, and its warning ("another program runs, not the function's steps") is wrong: the function runs that program too.
- **Old roadmap:** [Deferred, line 79](https://github.com/sf624/bash-explainer/blob/28e8a754255316700b99050a1c1f6a4bf9abd4ae/docs/roadmap.md#L79)

### `export -n LANG; ssh` is an Error

- **Verdict:** dropped, 2026-11-06. Kind: `bug`.
- **Reason:** Rare.
- **Note:** each is rare, but a false Error is red and fails `--check`. Dropped by the approved triage.
- **Input and contradiction (as the roadmap had it):** `export -n LANG=C; ssh host 'echo $LANG'` is an Error (review of #557), though sshd or PAM often sets `LANG` on the server (`/etc/default/locale`): a caveat would fit.
- **Old roadmap:** [Deferred, line 80](https://github.com/sf624/bash-explainer/blob/28e8a754255316700b99050a1c1f6a4bf9abd4ae/docs/roadmap.md#L80)

### `ssh -t` sends `TERM`

- **Verdict:** dropped, 2026-11-06. Kind: `missing-explanation`.
- **Reason:** Rare.
- **Input and contradiction (as the roadmap had it):** `ssh -t` sends `TERM` (ssh_config(5), `SendEnv`), which is not modelled (same review).
- **Old roadmap:** [Deferred, line 81](https://github.com/sf624/bash-explainer/blob/28e8a754255316700b99050a1c1f6a4bf9abd4ae/docs/roadmap.md#L81)

### `$HOSTNAME` in `docker run … sh -c`

- **Verdict:** dropped, 2026-11-06. Kind: `bug`.
- **Reason:** Rare.
- **Input and contradiction (as the roadmap had it):** The dialect check says `$HOSTNAME` expands to nothing (a Warning, since #603) in `docker run img sh -c 'echo $HOSTNAME'` (same review), though the runtime sets it: `CONTAINER_SETS` could feed it.
- **Old roadmap:** [Deferred, line 82](https://github.com/sf624/bash-explainer/blob/28e8a754255316700b99050a1c1f6a4bf9abd4ae/docs/roadmap.md#L82)

### Opacity as a point, not a flag

- **Verdict:** dropped, 2026-11-06. Kind: `refactor`.
- **Reason:** Rare forms after `source`. Only levels change.
- **Old roadmap:** [Deferred, line 83](https://github.com/sf624/bash-explainer/blob/28e8a754255316700b99050a1c1f6a4bf9abd4ae/docs/roadmap.md#L83)

### Heredoc delimiter written `<<$'EOF'`

- **Verdict:** dropped, 2026-11-06. Kind: `bug`.
- **Reason:** Still wrong on main (verified), but rare.
- **Input and contradiction (as the roadmap had it):** The delimiter of a here-document written with `$'…'` (found in the review of #578; already so on unbash 6.0.1): `delimiter` (src/explain/redirections.ts) strips the quotes of `<<$'EOF'` badly and the note says "a line containing only `$'EOF`" where bash's delimiter is `EOF`; `<<$'E\0F'` says `$'E\0F` where bash ends the delimiter at the NUL (`E`). The delimiter should come from the same reading as an ANSI-C word (`ansiCWordValue`).
- **Old roadmap:** [Deferred, line 84](https://github.com/sf624/bash-explainer/blob/28e8a754255316700b99050a1c1f6a4bf9abd4ae/docs/roadmap.md#L84)

### `((i++))` under `set -e` at Error

- **Verdict:** dropped, 2026-11-06. Kind: `bug`.
- **Reason:** Level only: the text is right (verified), but the Error level and the sorting of three later warnings are open.
- **Input and contradiction (as the roadmap had it):** `((i++))` under `set -e` at Error where the value is 0 on every path (the param `zero` of three-levels.md, section 3; left open in step 2, #557): the state model would need to trust a variable that only arithmetic it follows assigns (`(( ))`, `let`, `$(( ))`, `for (( ))`), which decisions do not today (semantics.md, 4.14). Until then the note is a warning, as before. Also to sort by the rule: `posix-function-name`, `posix-special-builtin-error` and `unbraced-element`, warnings that came after the plan.
- **Old roadmap:** [Deferred, line 85](https://github.com/sf624/bash-explainer/blob/28e8a754255316700b99050a1c1f6a4bf9abd4ae/docs/roadmap.md#L85)

### `[[ ]]` plain-vs-pattern leftovers

- **Verdict:** dropped, 2026-11-06. Kind: `bug`.
- **Reason:** Rare.
- **Input and contradiction (as the roadmap had it):** `[[ ]]` plain-vs-pattern: a known value is lost under `&&`, `||` or `!` inside `[[ ]]` (says pattern, safe); `[[ abc == a{b,c} ]]` is called a pattern though `[[ ]]` does no brace expansion.
- **Old roadmap:** [Deferred, line 86](https://github.com/sf624/bash-explainer/blob/28e8a754255316700b99050a1c1f6a4bf9abd4ae/docs/roadmap.md#L86)

### SC6: table of shell behaviours, three-valued `isBash`

- **Verdict:** merged into "A per-shell builtin table in name resolution" (#652), 2026-11-06. Kind: `refactor`.
- **Reason:** The structural side of the per-shell builtin table.
- **Old roadmap:** [Deferred, line 95](https://github.com/sf624/bash-explainer/blob/28e8a754255316700b99050a1c1f6a4bf9abd4ae/docs/roadmap.md#L95)

### SC7: one shebang `Opening`

- **Verdict:** merged into "One source: declarations, the shebang's opening, the bash 5.2/5.3 differences" (#677), 2026-11-06. Kind: `refactor`.
- **Reason:** One issue for the remaining second sources.
- **Old roadmap:** [Deferred, line 96](https://github.com/sf624/bash-explainer/blob/28e8a754255316700b99050a1c1f6a4bf9abd4ae/docs/roadmap.md#L96)

### SC9: named 5.2/5.3 differences

- **Verdict:** merged into "One source: declarations, the shebang's opening, the bash 5.2/5.3 differences" (#677), 2026-11-06. Kind: `refactor`.
- **Reason:** One issue for the remaining second sources.
- **Old roadmap:** [Deferred, line 97](https://github.com/sf624/bash-explainer/blob/28e8a754255316700b99050a1c1f6a4bf9abd4ae/docs/roadmap.md#L97)

### SC10: one colour table per token kind

- **Verdict:** merged into "One colour source for the editors" (#672), 2026-11-06. Kind: `refactor`.
- **Reason:** The same work as the one colour source.
- **Old roadmap:** [Deferred, line 98](https://github.com/sf624/bash-explainer/blob/28e8a754255316700b99050a1c1f6a4bf9abd4ae/docs/roadmap.md#L98)

### SC11: copies of the view switch

- **Verdict:** dropped, 2026-11-06. Kind: `refactor`.
- **Reason:** YAGNI: rare, or no measured gain (maintainer, 2026-11-06).
- **Old roadmap:** [Deferred, line 99](https://github.com/sf624/bash-explainer/blob/28e8a754255316700b99050a1c1f6a4bf9abd4ae/docs/roadmap.md#L99)

### Count hedges, steps 6 and 7

- **Verdict:** dropped, 2026-11-06. Kind: `refactor`.
- **Reason:** YAGNI: rare, or no measured gain (maintainer, 2026-11-06).
- **Old roadmap:** [Deferred, line 100](https://github.com/sf624/bash-explainer/blob/28e8a754255316700b99050a1c1f6a4bf9abd4ae/docs/roadmap.md#L100)

### Open after #492: other words read as one each

- **Verdict:** dropped, 2026-11-06. Kind: `bug`.
- **Reason:** Rare (`jq --arg $n $v .` with an empty `$n`).
- **Input and contradiction (as the roadmap had it):** Open, after #492: the readings after a value still read the other words of the line as one word each, so a condition on one word can be contradicted by another's count (`jq --arg $n $v .` with `$n` empty and two words of `$v`: `.` is the filter, said the value; `cp -t $d $a b` with both empty: `b` is the directory, said a source; `cut -d $a -f $b f` with both empty: `-f` is the value of `-d`, and `f` is said the value of `-f`). Also left: the words a command run or a subcommand reads after it (`sudo -u $u tar -cf x y`: `x`), a value written in its option's word (`head -n$a f`), find's expression (`find . -name $n -print`, src/embedded/find.ts reads no counts), and two words of one variable read as independent (`cp $a $a/x`). Planned in [design/count-hedges.md](https://github.com/sf624/bash-explainer/blob/main/docs/design/count-hedges.md) (steps 6–7, the entry above).
- **Old roadmap:** [Deferred, line 101](https://github.com/sf624/bash-explainer/blob/28e8a754255316700b99050a1c1f6a4bf9abd4ae/docs/roadmap.md#L101)

### Open after #498 and #501: nameref and trust leftovers

- **Verdict:** dropped, 2026-11-06. Kind: `bug`.
- **Reason:** Rare.
- **Input and contradiction (as the roadmap had it):** Open, after #498 and #501 (the redesign that replaces their special cases is "Trust of a builtin's words from their fields", deferred below; a word whose values the scan does not list walks again with nothing trusted: `read -r y; printf $y u 2`, values from `for`, `x[0]=`, `${x:=}`, `mapfile`, `select`, `declare -l`, namerefs, `REPLY`, `OPTARG`, `_`, `$1`, past the readings; docs/design/trust-allow-list.md, section 6): a nameref's target is not read even where the walk knows it is unset (`x=-v; declare -n r=x; unset r; printf $x u 2` decides nothing: the walk does not follow every write through a nameref); a word that no value could make set anything is still taken as one that may, where its values are not listed (`declare -f "$g"` with `g` from the environment, `printf "$line\n"` after `read`, `printf "${red}err\n"` with `red=$(tput setaf 1)`, and `printf "$1\n"`, whose positional parameters the walk does not follow, decide nothing); where the values of such a word differ from path to path, the walk trusts nothing rather than read each; the trust scan reads the words of `unset`, `shopt` and `enable` as written (`x=a; unset $x` trusts nothing); the exit statuses of the declarations (src/semantics/status.ts) and the explanation's reads of `declare -g`/`-p` (src/explain/argv.ts) read the words as written; the environments of the commands run in the fields of a word (src/semantics/env.ts, `x='ls -l'; sudo $x`). The examples give none where a word is read as fields that are options or values (`x='-n 3'; head $x f`, `readsFields`), rather than read it as written; building them from the fields is left.
- **Old roadmap:** [Deferred, line 102](https://github.com/sf624/bash-explainer/blob/28e8a754255316700b99050a1c1f6a4bf9abd4ae/docs/roadmap.md#L102)

### Trust of a builtin's words from their fields

- **Verdict:** dropped, 2026-11-06. Kind: `refactor`.
- **Reason:** YAGNI: rare, or no measured gain (maintainer, 2026-11-06).
- **Old roadmap:** [Deferred, line 103](https://github.com/sf624/bash-explainer/blob/28e8a754255316700b99050a1c1f6a4bf9abd4ae/docs/roadmap.md#L103)

### Run-based oracles, step 10 (scenario ids)

- **Verdict:** dropped, 2026-11-06. Kind: `test-infra`.
- **Reason:** No user effect.
- **Old roadmap:** [Deferred, line 104](https://github.com/sf624/bash-explainer/blob/28e8a754255316700b99050a1c1f6a4bf9abd4ae/docs/roadmap.md#L104)

### `src/semantics/hash.ts`

- **Verdict:** dropped, 2026-11-06. Kind: `refactor`.
- **Reason:** YAGNI: rare, or no measured gain (maintainer, 2026-11-06).
- **Old roadmap:** [Deferred, line 105](https://github.com/sf624/bash-explainer/blob/28e8a754255316700b99050a1c1f6a4bf9abd4ae/docs/roadmap.md#L105)

### `hash name` searches PATH again

- **Verdict:** dropped, 2026-11-06. Kind: `bug`.
- **Reason:** Rare.
- **Input and contradiction (as the roadmap had it):** `hash name` without `-p` searches PATH again: `hash -p /usr/bin/tac sort; hash sort; sort` sorts (we say tac).
- **Old roadmap:** [Deferred, line 106](https://github.com/sf624/bash-explainer/blob/28e8a754255316700b99050a1c1f6a4bf9abd4ae/docs/roadmap.md#L106)

### `a && hash -p … || hash -p …` hedged

- **Verdict:** dropped, 2026-11-06. Kind: `bug`.
- **Reason:** Rare.
- **Input and contradiction (as the roadmap had it):** `a && hash -p X n || hash -p X n` is hedged though certain (does the walker give the `||` side the then-branch state of the `&&` condition?).
- **Old roadmap:** [Deferred, line 107](https://github.com/sf624/bash-explainer/blob/28e8a754255316700b99050a1c1f6a4bf9abd4ae/docs/roadmap.md#L107)

### Multi-word alias and a sure `hash -p`

- **Verdict:** dropped, 2026-11-06. Kind: `missing-explanation`.
- **Reason:** Rare.
- **Input and contradiction (as the roadmap had it):** A multi-word alias (`alias s='sort -r'`) does not mention a sure `hash -p` of the word it runs.
- **Old roadmap:** [Deferred, line 108](https://github.com/sf624/bash-explainer/blob/28e8a754255316700b99050a1c1f6a4bf9abd4ae/docs/roadmap.md#L108)

### Words of a name a `hash -p` path may run

- **Verdict:** dropped, 2026-11-06. Kind: `bug`.
- **Reason:** Rare.
- **Input and contradiction (as the roadmap had it):** The words of a name that may run a path of `hash -p` are still read with the name's spec (`grep -o 'a+'` after a conditional `hash -p /usr/bin/egrep grep` reads a BRE).
- **Old roadmap:** [Deferred, line 109](https://github.com/sf624/bash-explainer/blob/28e8a754255316700b99050a1c1f6a4bf9abd4ae/docs/roadmap.md#L109)

### `command` and `exec` ignore the hash table

- **Verdict:** dropped, 2026-11-06. Kind: `bug`.
- **Reason:** Rare.
- **Input and contradiction (as the roadmap had it):** `command sort` and `exec sort` ignore the table (bash uses it).
- **Old roadmap:** [Deferred, line 110](https://github.com/sf624/bash-explainer/blob/28e8a754255316700b99050a1c1f6a4bf9abd4ae/docs/roadmap.md#L110)

### Trap that changes the table before a subshell

- **Verdict:** dropped, 2026-11-06. Kind: `bug`.
- **Reason:** Rare.
- **Input and contradiction (as the roadmap had it):** A trap's action that changes the table, set in the shell, is taken to have maybe run before a subshell that sends its signal (`trap 'hash -p /usr/bin/tac sort' USR1; ( kill -USR1 $$; sort )`): true only for a signal from elsewhere; the subshell's own `kill` reaches the shell after the fork.
- **Old roadmap:** [Deferred, line 111](https://github.com/sf624/bash-explainer/blob/28e8a754255316700b99050a1c1f6a4bf9abd4ae/docs/roadmap.md#L111)

### `x=ls; $x -Z` read as the command it expands to

- **Verdict:** dropped, 2026-11-06. Kind: `missing-explanation`.
- **Reason:** Rare: needs a known value at the top level.
- **Input and contradiction (as the roadmap had it):** Read a command word at the top level from the model: as the word after a wrapper is (`x=ls; sudo $x -Z` reads `ls`'s `-Z`; `x=ls; $x -Z` is still "Run the expanded value as a command", and its `-Z` says only that the expansion decides who reads it). `headOf` (src/explain/commands.ts) would take the value from `argWordIn(cx.state)` and explain the word as that command, with the variable's tokens kept; with `x=` the first word that is left is the command (`x=; $x -Z`: "-Z: command not found", status 127, checked with bash). The same for a glob (`f* -x`).
- **Old roadmap:** [Deferred, line 112](https://github.com/sf624/bash-explainer/blob/28e8a754255316700b99050a1c1f6a4bf9abd4ae/docs/roadmap.md#L112)

### Leftovers of the Reading audit (`mapfile -C`, `BASH_ALIASES[k]`)

- **Verdict:** dropped, 2026-11-06. Kind: `missing-explanation`.
- **Reason:** Rare.
- **Input and contradiction (as the roadmap had it):** The leftovers of the Reading audit against the Bash Reference Manual (chapters 3 to 6 are done, see "Done lately"). Left from chapter 4: the strings `mapfile -C`, `bind -x` and `complete -C` run are not read as scripts (`trap`'s and `eval`'s are). Left from chapter 5: `BASH_ALIASES[k]` and `BASH_CMDS[k]` are read as an indexed array's elements, since the state model does not start them with `-A` (src/semantics/walk/walker.ts `initial`, and the baseline of test/state-probes.test.ts). Left from chapter 6: indexes bash rejects (`${a[]}`, `${a[1+]}`) and a comma expression in an index are explained as arithmetic or a word; `source -p DIR` refused by bash 5.3 in a restricted shell, and the 5.2/5.3 differences listed in [design/bash-versions.md](https://github.com/sf624/bash-explainer/blob/main/docs/design/bash-versions.md) (the model follows 5.2 there, and the texts say what 5.3 does); the rare 6.11 items left (aliases in `$( )` at parse time, and the exits [design/bash-versions.md](https://github.com/sf624/bash-explainer/blob/main/docs/design/bash-versions.md) 3.4 lists as left).
- **Old roadmap:** [Deferred, line 113](https://github.com/sf624/bash-explainer/blob/28e8a754255316700b99050a1c1f6a4bf9abd4ae/docs/roadmap.md#L113)

### Three argv-corpus findings (`cp -v*$x d`)

- **Verdict:** dropped, 2026-11-06. Kind: `bug`.
- **Reason:** Rare.
- **Input and contradiction (as the roadmap had it):** Three rare findings of `scripts/argv-corpus.ts` (render check "SHOWN", found 2026-10-31, before 0.9.0): `cp -v*$x d` and `cp -v{a,b}$x d` (test/readings.test.ts) are read as "Options known only at run time", where bash gives a cluster or an operand; `z=; find . -name x $z -print` (test/argv-fixes.test.ts) counts 1 word, where bash gives 0.
- **Old roadmap:** [Deferred, line 114](https://github.com/sf624/bash-explainer/blob/28e8a754255316700b99050a1c1f6a4bf9abd4ae/docs/roadmap.md#L114)

### Real failures at a Warning (`[[ (a) ]]`, `coproc`)

- **Verdict:** dropped, 2026-11-06. Kind: `bug`.
- **Reason:** Rare forms. Only the level differs.
- **Input and contradiction (as the roadmap had it):** Too low, a real failure at a Warning: `if false; then [[ a =~ (a) ]]; fi`, `[[ (a) ]]`, `coproc { a; }`; `f() { [[ a =~ (a) ]]; }`; `#!/bin/sh -e` then `shopt -s x 2>/dev/null` (the first line's `-e` is not read); `set -e; y=$(shopt -s x 2>/dev/null)`; `set -e; test -n "$BASH_VERSION"` before a row.
- **Old roadmap:** [Deferred, line 116](https://github.com/sf624/bash-explainer/blob/28e8a754255316700b99050a1c1f6a4bf9abd4ae/docs/roadmap.md#L116)

### `"${x:-@(a)}"` gets an extglob Warning

- **Verdict:** dropped, 2026-11-06. Kind: `bug`.
- **Reason:** Rare.
- **Input and contradiction (as the roadmap had it):** A false Warning: `"${x:-@(a)}"` gets `extglob`.
- **Old roadmap:** [Deferred, line 118](https://github.com/sf624/bash-explainer/blob/28e8a754255316700b99050a1c1f6a4bf9abd4ae/docs/roadmap.md#L118)

### `exec 2>/dev/null` vs `2>&-` levels

- **Verdict:** dropped, 2026-11-06. Kind: `bug`.
- **Reason:** Rare.
- **Input and contradiction (as the roadmap had it):** Not the same: `exec 2>/dev/null` then `shopt`, and `shopt -s x 2>&-`, are Errors where `2>/dev/null` is a Warning.
- **Old roadmap:** [Deferred, line 119](https://github.com/sf624/bash-explainer/blob/28e8a754255316700b99050a1c1f6a4bf9abd4ae/docs/roadmap.md#L119)

### Templated `.sh` (`{% if bash %}`)

- **Verdict:** dropped, 2026-11-06. Kind: `missing-explanation`.
- **Reason:** Rare.
- **Input and contradiction (as the roadmap had it):** A `.sh` with a template (`{% if bash %}`): `plainText` is not read for dialect rows.
- **Old roadmap:** [Deferred, line 120](https://github.com/sf624/bash-explainer/blob/28e8a754255316700b99050a1c1f6a4bf9abd4ae/docs/roadmap.md#L120)

### `while :` before a refused row stays an Error

- **Verdict:** dropped, 2026-11-06. Kind: `bug`.
- **Reason:** Rare.
- **Input and contradiction (as the roadmap had it):** `while :` before a refused row, when the model trusts nothing, stays an Error.
- **Old roadmap:** [Deferred, line 122](https://github.com/sf624/bash-explainer/blob/28e8a754255316700b99050a1c1f6a4bf9abd4ae/docs/roadmap.md#L122)

### Dialect issues in yash, ksh, mksh, zsh

- **Verdict:** dropped, 2026-11-06. Kind: `bug`.
- **Reason:** Shells rarely targeted. Needs running each.
- **Input and contradiction (as the roadmap had it):** Dialect issues in the shells not run (found with #603, three-levels.md, section 10, item 2): `yash`, `ksh`, `mksh` and `zsh` still say Error for all they lack where it is reached (`$SECONDS`, `{1..3}` in mksh), though these do not fail. It waits on running each row in them, as test/dialect-dash.test.ts does in dash and busybox ash.
- **Old roadmap:** [Deferred, line 123](https://github.com/sf624/bash-explainer/blob/28e8a754255316700b99050a1c1f6a4bf9abd4ae/docs/roadmap.md#L123)

### Dialect faults in functions surely called

- **Verdict:** dropped, 2026-11-06. Kind: `missing-explanation`.
- **Reason:** Measured: 0 of 17 Warnings would change.
- **Input and contradiction (as the roadmap had it):** Reading a function surely called at the top level, so that a dialect fault in its body is an Error (from #603's review): a function body is left out today, called or not. Measured on the corpus: 8 of 1,545 functions, +0.06% of commands, and 0 of 17 Warnings flip, so not now. Rare too: `for x in a; do [[ a ]]; done` is a Warning, as a loop's body may run no time, though dash fails every time.
- **Old roadmap:** [Deferred, line 125](https://github.com/sf624/bash-explainer/blob/28e8a754255316700b99050a1c1f6a4bf9abd4ae/docs/roadmap.md#L125)

### `read` with no name in dash

- **Verdict:** merged into "Common bashisms are silent in sh" (#653), 2026-11-06. Kind: `bug`.
- **Reason:** In `#!/bin/sh` it shows "Values stored: REPLY=…", where dash gives `read: arg count`, status 2 (fact-check).
- **Old roadmap:** [Deferred, line 126](https://github.com/sf624/bash-explainer/blob/28e8a754255316700b99050a1c1f6a4bf9abd4ae/docs/roadmap.md#L126)

### Tilde on the right of `[[ == ]]` and `=~`

- **Verdict:** merged into "Tilde expansion as bash and dash do it" (#663), 2026-11-06. Kind: `bug`.
- **Reason:** One reading of tildes in the word model.
- **Old roadmap:** [Deferred, line 128](https://github.com/sf624/bash-explainer/blob/28e8a754255316700b99050a1c1f6a4bf9abd4ae/docs/roadmap.md#L128)

### No tilde token after `sudo` or `command`

- **Verdict:** merged into "Tilde expansion as bash and dash do it" (#663), 2026-11-06. Kind: `missing-explanation`.
- **Reason:** The same.
- **Old roadmap:** [Deferred, line 129](https://github.com/sf624/bash-explainer/blob/28e8a754255316700b99050a1c1f6a4bf9abd4ae/docs/roadmap.md#L129)

### Values of a whole word, arrays, per-call values

- **Verdict:** dropped, 2026-11-06. Kind: `enhancement`.
- **Reason:** The corpus shows little gain.
- **Old roadmap:** [Deferred, line 130](https://github.com/sf624/bash-explainer/blob/28e8a754255316700b99050a1c1f6a4bf9abd4ae/docs/roadmap.md#L130)

### Trust per position, steps 1 to 4

- **Verdict:** dropped, 2026-11-06. Kind: `enhancement`.
- **Reason:** Small measured gain (34 → 45 values), deferred by the maintainer 2026-10-26. #646 carries the part users see.
- **Note:** dropped, since #646 is its own Now item. These steps come back as an issue only if the fix of #646 needs them.
- **Old roadmap:** [Deferred, line 131](https://github.com/sf624/bash-explainer/blob/28e8a754255316700b99050a1c1f6a4bf9abd4ae/docs/roadmap.md#L131)

### `arrayKind` reads the trust reason's text

- **Verdict:** dropped, 2026-11-06. Kind: `refactor`.
- **Reason:** No user case given.
- **Old roadmap:** [Deferred, line 132](https://github.com/sf624/bash-explainer/blob/28e8a754255316700b99050a1c1f6a4bf9abd4ae/docs/roadmap.md#L132)

### `eval "$(ssh-agent -s)"` makes the rest opaque

- **Verdict:** dropped, 2026-11-06. Kind: `enhancement`.
- **Reason:** Only fewer values are shown, nothing wrong.
- **Note:** common in tutorials, but only fewer values are shown, so it was dropped.
- **Old roadmap:** [Deferred, line 133](https://github.com/sf624/bash-explainer/blob/28e8a754255316700b99050a1c1f6a4bf9abd4ae/docs/roadmap.md#L133)

### `shopt -s extglob; echo !(x)` on one line: Info

- **Verdict:** dropped, 2026-11-06. Kind: `bug`.
- **Reason:** Rare.
- **Input and contradiction (as the roadmap had it):** `shopt -s extglob; echo !(x)` on one top-level line is Info `extglob-not-found`; bash rejects it (a syntax error). `extglob-in-same-block` misses a top-level `;` list (already on main).
- **Old roadmap:** [Deferred, line 134](https://github.com/sf624/bash-explainer/blob/28e8a754255316700b99050a1c1f6a4bf9abd4ae/docs/roadmap.md#L134)

### `export "$1"` not opaque

- **Verdict:** dropped, 2026-11-06. Kind: `bug`.
- **Reason:** Rare.
- **Input and contradiction (as the roadmap had it):** `export "$1"` does not make the state `opaque`, so `foo=1; export "$1"; bash -c 'echo $foo'` still says `foo` is not exported (found in the review of #536).
- **Old roadmap:** [Deferred, line 135](https://github.com/sf624/bash-explainer/blob/28e8a754255316700b99050a1c1f6a4bf9abd4ae/docs/roadmap.md#L135)

### Trap action opaque from the `trap` line on

- **Verdict:** dropped, 2026-11-06. Kind: `bug`.
- **Reason:** Rare. Only the levels change.
- **Input and contradiction (as the roadmap had it):** A trap's action of text not known makes the state `opaque` from the `trap` command on, though an `EXIT` trap cannot fire before the lines that follow it, so checks after it become caveats too early (found in the review of #536).
- **Old roadmap:** [Deferred, line 136](https://github.com/sf624/bash-explainer/blob/28e8a754255316700b99050a1c1f6a4bf9abd4ae/docs/roadmap.md#L136)

### POSIX-mode `time --` forms

- **Verdict:** dropped, 2026-11-06. Kind: `bug`.
- **Reason:** Rare.
- **Input and contradiction (as the roadmap had it):** POSIX-mode `time` forms left from the review of #587 (`set -o posix`): `time -- 2>&1`, `time -x >f`, `time -- c >f`, `time -- x=1 c`, `time -- -x c`, `time --`, `time --; c` and `time -p a | b` are read wrongly (lost redirect or assignment, `-x` called an option, a syntax error bash does not give); `--` has no token.
- **Old roadmap:** [Deferred, line 138](https://github.com/sf624/bash-explainer/blob/28e8a754255316700b99050a1c1f6a4bf9abd4ae/docs/roadmap.md#L138)

### U+FDD0 in `$'…'` shows a mark

- **Verdict:** dropped, 2026-11-06. Kind: `bug`.
- **Reason:** Rare.
- **Input and contradiction (as the roadmap had it):** A decoded `$'…'` that holds U+FDD0 or U+FDD1 can still show a mark (`alias a=$'\uFDD0…'`), and so can the output of `printf` and `jq` in the Output lines (found in the review of #587).
- **Old roadmap:** [Deferred, line 139](https://github.com/sf624/bash-explainer/blob/28e8a754255316700b99050a1c1f6a4bf9abd4ae/docs/roadmap.md#L139)

### Nested heredoc in `<<-`

- **Verdict:** dropped, 2026-11-06. Kind: `bug`.
- **Reason:** Rare.
- **Input and contradiction (as the roadmap had it):** A nested heredoc in `<<-`: `cat <<-EOF` with the body `\t$(cat <<X`, `\tq`, `\tX`, `\t)` and the end `\tEOF` reports `Missing "heredoc_end"`, though bash strips the tabs first and prints `q` (found in the review of #586).
- **Old roadmap:** [Deferred, line 140](https://github.com/sf624/bash-explainer/blob/28e8a754255316700b99050a1c1f6a4bf9abd4ae/docs/roadmap.md#L140)

### perl `printf '%d'` of 2^70

- **Verdict:** dropped, 2026-11-06. Kind: `bug`.
- **Reason:** Rare.
- **Input and contradiction (as the roadmap had it):** perl `printf '%d'` of 2^70 prints the digits where real perl prints `-1` (found in the review of #581).
- **Old roadmap:** [Deferred, line 141](https://github.com/sf624/bash-explainer/blob/28e8a754255316700b99050a1c1f6a4bf9abd4ae/docs/roadmap.md#L141)

### awk examples differ from gawk on `\y` and others

- **Verdict:** dropped, 2026-11-06. Kind: `bug`.
- **Reason:** Rare.
- **Input and contradiction (as the roadmap had it):** awk examples differ from gawk on `\y` and `\>` (`gsub(/\y/, "X")` on `a`), on a side-effect target (`gsub(/a/, "X", $(i++))` evaluates it twice), on a no-match `gsub` on a field past NF (`$5` should grow NF), and on `.` with a newline in a string (`s = "a\nb"; gsub(/./, "Y", s)`: gawk `YYY`, ours `Y\nY`); also `"\777"`, `"\xe9"`, `"\é"`, `length()` of an emoji, `FS="\\"`, and a trailing backslash of `-v 'x=a\'` (gawk drops it, we keep it) (found in the review of #588).
- **Old roadmap:** [Deferred, line 142](https://github.com/sf624/bash-explainer/blob/28e8a754255316700b99050a1c1f6a4bf9abd4ae/docs/roadmap.md#L142)

### Three leftovers of the settings column

- **Verdict:** dropped, 2026-11-06. Kind: `ui`.
- **Reason:** Rare and transient.
- **Old roadmap:** [Deferred, line 143](https://github.com/sf624/bash-explainer/blob/28e8a754255316700b99050a1c1f6a4bf9abd4ae/docs/roadmap.md#L143)

### Panel takes a late `focus` message

- **Verdict:** dropped, 2026-11-06. Kind: `ui`.
- **Reason:** Rare and harmless, by the roadmap's own words.
- **Old roadmap:** [Deferred, line 144](https://github.com/sf624/bash-explainer/blob/28e8a754255316700b99050a1c1f6a4bf9abd4ae/docs/roadmap.md#L144)

### `read \$x` gets an example

- **Verdict:** dropped, 2026-11-06. Kind: `bug`.
- **Reason:** Rare (verified still so).
- **Input and contradiction (as the roadmap had it):** `read \$x` and `read '$x'` get an example of values stored, though bash refuses the name.
- **Old roadmap:** [Deferred, line 145](https://github.com/sf624/bash-explainer/blob/28e8a754255316700b99050a1c1f6a4bf9abd4ae/docs/roadmap.md#L145)

### A known value in a hole (`s='s/a/b/'; sed "$s"`)

- **Verdict:** dropped, 2026-11-06. Kind: `missing-explanation`.
- **Reason:** Rare.
- **Input and contradiction (as the roadmap had it):** A value the model knows for certain could stand in a hole of a word a command reads: `s='s/a/b/'; sed "$s"` stays unread, with the note on the script.
- **Old roadmap:** [Deferred, line 147](https://github.com/sf624/bash-explainer/blob/28e8a754255316700b99050a1c1f6a4bf9abd4ae/docs/roadmap.md#L147)

### `--regexp="$x"` and `-e"s/$a/b/"` unread

- **Verdict:** dropped, 2026-11-06. Kind: `missing-explanation`.
- **Reason:** Rare spellings.
- **Input and contradiction (as the roadmap had it):** `--regexp="$x"`, `--expression="…$x"` and `-e"s/$a/b/"` stay unread: `equalsToken` and the attached path read the word with `literalContent`, not with holes.
- **Old roadmap:** [Deferred, line 148](https://github.com/sf624/bash-explainer/blob/28e8a754255316700b99050a1c1f6a4bf9abd4ae/docs/roadmap.md#L148)

### `${!w}` and a nameref to `a[@]`

- **Verdict:** dropped, 2026-11-06. Kind: `bug`.
- **Reason:** Rare.
- **Input and contradiction (as the roadmap had it):** `grep "x${!w}" f` with `w='a[@]'`, and a nameref to `a[@]`, give 2 words in bash but are read as one hole.
- **Old roadmap:** [Deferred, line 149](https://github.com/sf624/bash-explainer/blob/28e8a754255316700b99050a1c1f6a4bf9abd4ae/docs/roadmap.md#L149)

### Multi-row `$( )` in a hole: raw newline in a code span

- **Verdict:** dropped, 2026-11-06. Kind: `bug`.
- **Reason:** Rare.
- **Input and contradiction (as the roadmap had it):** A `$( )` of several rows in a hole puts a raw newline in a note's code span.
- **Old roadmap:** [Deferred, line 151](https://github.com/sf624/bash-explainer/blob/28e8a754255316700b99050a1c1f6a4bf9abd4ae/docs/roadmap.md#L151)

### Overstatements in words with expansions (`sed "s/$a/x/"`)

- **Verdict:** dropped, 2026-11-06. Kind: `bug`.
- **Reason:** Each is a rare value or spelling. The common `sed "s/$old/$new/g"` reads right.
- **Input and contradiction (as the roadmap had it):** Reading words with expansions: known overstatements (#615), none fixed: `sed "s/$a/x/"` says `/` ends the pattern though `a\/b` and `[/]` do not; `perl -pe "s'$a'$b'"` says perl expands though `'` delimiters do not; `sed "${n}q"` shows a range `1,5` (sed takes one address); `sed "0,$n d"`; `sed "s/[\x4$n]/y/"` (`escapeIntoHole` does not cover classes); `tr "a$b" x` with `b=-z`; an example shown with a holed second script (`sed -e 's/a/b/' -e "s/$c/d/"`, also on main, see above); `sed "s/${x@Z}/b/"` has no Error note. Omissions: gawk `printf \"$a\"` with `%`, `sub(…,\"$a\")` with `&`, perl `s{$a}{$b}` with `}`, `s/[$x]/` with a newline (sed) or a `/` (perl).
- **Old roadmap:** [Deferred, line 152](https://github.com/sf624/bash-explainer/blob/28e8a754255316700b99050a1c1f6a4bf9abd4ae/docs/roadmap.md#L152)

### Here-documents in lists (#623)

- **Verdict:** dropped, 2026-11-06. Kind: `bug`.
- **Reason:** Rare.
- **Input and contradiction (as the roadmap had it):** Here-documents in lists (#623): a here-document with a quoted delimiter in backquotes, `` y=`cat <<\E | b⏎x⏎E⏎` `` (valid in bash), reads `b`, `x` and `E` as stray text (an Error); `if a || b &; then c; fi` (bash rejects it) reports nothing. In the shape comparison with bash-ast, a here-document in `$( )` (`x=$(cat <<E⏎x⏎E⏎)`) gives the command another line than bash-ast does (1 against 4); not looked into.
- **Old roadmap:** [Deferred, line 153](https://github.com/sf624/bash-explainer/blob/28e8a754255316700b99050a1c1f6a4bf9abd4ae/docs/roadmap.md#L153)

### PCRE and `tr` gaps

- **Verdict:** dropped, 2026-11-06. Kind: `bug`.
- **Reason:** Rare.
- **Input and contradiction (as the roadmap had it):** PCRE and `tr`: known gaps (left by the review of #622). `\Qab\E+` binds the `+` to `b` only; `\N{U+263A}` is read as `\N` and text; `\x{}` (real grep -P exits 2) is read as a NUL; `\g+1` and `\g{+1}`; `(?|(a))\1` and `(?|a[)]b)c`, which are unread groups that end at the first `)`; `[\Qa-z\E]` and `[\g]` in a class; `(?x)` is not read, and its pattern gets no example; `(?m)` at the start is dropped from the example's flags (perl `/^$/m` also differs: JavaScript's `^` matches after a final newline). `sed 's/\>/x/'` shows an example `x1` where real sed gives `1x`; `` \` `` and `\'` in awk and sed; `perl /\K/` mentions `grep -o`; `sed 's/\xe3/x/'` is read by character, not by byte. For `tr`: `tr -c a-z '[:upper:]'` is not refused; `tr -c a-z xy` repeats the last character for the rest, which the note does not say; `[=a=]`; `[a*]` in string1; `[x*0]` and `[x*010]` (the count is octal, 0 means as many as needed); `[\*]`; the `[\101*]` example; `\1` with no group before it is explained as a back-reference to a missing group, which is true but incomplete (grep -P exits 2).
- **Old roadmap:** [Deferred, line 154](https://github.com/sf624/bash-explainer/blob/28e8a754255316700b99050a1c1f6a4bf9abd4ae/docs/roadmap.md#L154)

## From the roadmap's Not decided

### How a file is read: edge cases

- **Verdict:** dropped, 2026-11-06. Kind: `bug`.
- **Reason:** Rare (a bats `local`, a README block with a shebang).
- **Input and contradiction (as the roadmap had it):** How a file is read (`StateModel.read`: script, terminal, unknown) for the other checks: `script-last-test-returns-status` still reads the shebang itself (src/statusfacts.ts), and ignores hosts (a CI step is run as a script); `failure-reported-as-success` reads it since #453. Edge cases of `fileRead`: bats sources a test file inside a function, so a top-level `local` works there (now a warning); a README code block that starts with `#!/bin/bash` is taken as typed into a terminal; a file with a shebang that a function sources is taken as run (a convention, as capitals are for the environment); `distro-alias-in-script` (`ll`) still takes a file with no shebang as a script. From the review of #424.
- **Old roadmap:** [Not decided, line 166](https://github.com/sf624/bash-explainer/blob/28e8a754255316700b99050a1c1f6a4bf9abd4ae/docs/roadmap.md#L166)

### Brace expansion leftovers

- **Verdict:** dropped, 2026-11-06. Kind: `bug`.
- **Reason:** Rare (`{1..99999999999999999999}`, `$${a,b}`).
- **Input and contradiction (as the roadmap had it):** Brace expansion, left from #430's review: sequences past the range of a 64-bit number stay text in bash (`{1..99999999999999999999}`); `$${a,b}` (the `{` after the `$$` opens `${`); a comma escaped inside quotes (`{"\,"..x}`); a `{` after a line continuation and a `}` (`a\` newline `{},b}`); `a=([3]={c,d})` (bash 5.2 expands it, 5.3 does not); `{Z..a}` makes an empty argument, not a `\`; braces with a `..` that hold no sequence, which bash 5.3 reads otherwise than 5.2 (`{x..{a,b}}` is `x..a` `x..b` in 5.2, `{x..a}` `{x..b}` in 5.3; the parser follows 5.2); the scanner is quadratic on `{a}{a}…,` (0.6 s at 20,000 characters); one place for where bash brace-expands, as nodes in every role read by the word model, instead of the adapter's roles and the model's contexts.
- **Old roadmap:** [Not decided, line 167](https://github.com/sf624/bash-explainer/blob/28e8a754255316700b99050a1c1f6a4bf9abd4ae/docs/roadmap.md#L167)

### A third language

- **Verdict:** dropped, 2026-11-06. Kind: `refactor`.
- **Reason:** Nobody has asked, and the user base is near zero. Revive when someone offers a language.
- **Note:** dropped, as no one has offered a language. It comes back when someone does.
- **Old roadmap:** [Not decided, line 172](https://github.com/sf624/bash-explainer/blob/28e8a754255316700b99050a1c1f6a4bf9abd4ae/docs/roadmap.md#L172)

## From the review of the POSIX sh hint (#688)

### The hint's room in the Problems box is a fixed number (Japanese, a very narrow pane)

- **Verdict:** dropped (YAGNI), 2026-11-06. Kind: `ui`.
- **Reason:** Rare: the line must wrap to two lines, which needs a pane well under 300 px with the Japanese text.
- **Input and what is wrong:** The web page in Japanese with a `#!/usr/bin/env bash` script that has `[[ ]]` and problems, and the divider dragged far left (or a large font). The hint line "POSIX sh にない書き方が N 件" and its button wrap to two lines (about 57 px), but `#problems` gets `max-height: calc(30% + 29px)` (web/page.css; 45 px when narrow), so the list is a little shorter than the 30% it would have. Nothing overflows; the list scrolls.

### `env -u X bash` and `env -C dir bash` shebangs

- **Verdict:** dropped (YAGNI), 2026-11-06. Kind: `bug`.
- **Reason:** Rare: an `env` option that takes a value before the shell, in a shebang. Already on main before #688 (`readShell` read the first word that is not an option as the program), which the hint inherits.
- **Input and what is wrong:** `#!/usr/bin/env -u X bash`: the program is read as `X` (and `-C dir` as `dir`), so the shell is none and the script is read as bash by default. The hint then shows for a script that says bash through `env`, which is correct by luck; for `#!/usr/bin/env -C dir sh` the shell is wrongly bash, and the hint shows for a sh script.

## From the review of bash's steps at depth 1 (#687)

### No glob example for the words of `for` and `select`

- **Verdict:** dropped (YAGNI), 2026-11-06. Kind: `missing-explanation`.
- **Reason:** Rare: the row of the words already says what the glob does.
- **Input and what is missing:** `for f in *.txt; do …; done`, `select f in *.a; do …; done`: the words after `in` get no glob example (the names the pattern matches), as an argument's glob does (`ls *.txt`).

### No glob example for a redirection's target

- **Verdict:** dropped (YAGNI), 2026-11-06. Kind: `missing-explanation`.
- **Reason:** Rare: a glob as a redirection's target.
- **Input and what is missing:** `done < *.f`: the target gets no glob example (the names the pattern matches), as an argument's glob does.

### No steps for a value in an associative array's list

- **Verdict:** dropped (YAGNI), 2026-11-06. Kind: `missing-explanation`.
- **Reason:** Rare: an expansion as a value in the list of an associative array.
- **Input and what is missing:** `declare -A m=([k]=$v)`: `$v` shows no bash's steps at either depth. A value of an indexed array (`a=($v)`) shows them.

## From the review of names and state (#694)

### A kind chosen by hand is not in the undo history

- **Verdict:** dropped (YAGNI), 2026-11-07. Kind: `ui`.
- **Reason:** Main does the same; only Clear and a paste over the sample put their reset of the kind into the history.
- **Input and what is wrong:** On the web page, a kind chosen in the chip is not a step of the editor's history. Across Ctrl+Z and Ctrl+Shift+Z the kind stays as chosen, so the kind and the text can get out of step.

### Clear's toast covers "Load the sample" on a phone

- **Verdict:** dropped (YAGNI), 2026-11-07. Kind: `ui`.
- **Reason:** It lasts a few seconds, and the toast's place is a decision of the toasts (chrome-redesign.md, C3).
- **Input and what is wrong:** At 390 px, Clear's toast lies over most of the empty editor's **Load the sample** button and the drop hint until it goes.

## From the review of the test examples (#695)

### `[[ $x -gt 08 ]]` says "True when x=9"

- **Verdict:** dropped (YAGNI), 2026-11-07. Kind: `bug`.
- **Reason:** Rare: an integer of `[[ ]]` with a leading zero and a digit 8 or 9. The model decides only decimal integers without a leading zero (`extendedTestInteger`); the samples keep their own result there.
- **Input and what is wrong:** `[[ $x -gt 08 ]]`: the example says "True when x=9", but bash fails, "value too great for base", since `08` is octal in arithmetic.

### The script's value of a test is not placed where the model does not show it

- **Verdict:** dropped (YAGNI), 2026-11-07. Kind: `missing-explanation`.
- **Reason:** Rare, and a value missed, not a wrong one: the samples stay.
- **Input and what is missing:** `n=' 3 '; [ "$n" -eq 3 ]` (a value with spaces at its ends, which an example line cannot show as it is) and `x=7; [[ $x -eq 3 ]]` (a value read by arithmetic, which the value line does not show either): the example keeps its samples and does not show the script's value in its section.

## From the review of the values before a `source` (#693)

Each is a value the explainer does not take where bash has it, never a wrong one (`StateModel.blindAt` reads the first statement of the top level that holds what the model does not read).

### A file sourced in a subshell blinds the script after it

- **Verdict:** dropped (YAGNI), 2026-11-07. Kind: `missing-explanation`.
- **Reason:** Rare: what a subshell reads cannot change the parent, but the scan does not tell where the construct runs.
- **Input and what is missing:** `( . lib )` and `x=$(source lib)`: the lines after them take no value of the script, though the file runs in a subshell.

### A function that sources a file blinds the script from its definition

- **Verdict:** dropped (YAGNI), 2026-11-07. Kind: `missing-explanation`.
- **Reason:** Rare: the body runs only at a call, but the scan places the reason at the definition.
- **Input and what is missing:** `f() { . lib; }`: the lines after the definition and before the first call of `f` take no value of the script.

### A heredoc whose first line holds `; source`

- **Verdict:** dropped (YAGNI), 2026-11-07. Kind: `missing-explanation`.
- **Reason:** Rare: the body comes after `source lib` in the text, so it is placed after it, though it belongs to `cat`, which runs first.
- **Input and what is missing:** `cat <<EOF; source lib` with a body: the body's expansions take no value of the script, though bash expands them before `source` runs.

## From the review of the `which` description (#696)

### `which` options differ between implementations

- **Verdict:** dropped (YAGNI), 2026-11-07. Kind: `missing-explanation`.
- **Reason:** Rare: the spec of `which` has only `-a|--all`, and the implementations disagree, so one spec cannot be right for all of them.
- **Input and what is missing:** `which --all ls` (debianutils `which` rejects `--all` with status 2; GNU which has it) and `which -s ls` (debianutils, BSD and macOS `which` have `-s`; GNU which has no `-s`): the explanation does not say which implementation takes the option.

## From the Makefile lines that make runs without a shell (#685)

### Makefile no-shell lines: corners that err on the safe side

- **Verdict:** dropped (YAGNI), 2026-11-07. Kind: `missing-explanation`.
- **Reason:** Rare, and each errs on the safe side: the line is explained as a shell line, as before, never wrongly as "no shell".
- **Input and what is missing:** `'A=b' cmd` (make sees `=` in the quoted word and sends it to the shell; we read the first word's text, so it is the same); a whitespace-only `IFS` (make may run the line directly; any `IFS` in the makefile sends every line to the shell here); `SHELL ?= /bin/dash` (the default is already defined, so make ignores it and runs directly; any `SHELL` other than `/bin/sh` sends the file to the shell here); a `SHELL` reset to `/bin/sh` later in the file, or set for one target only (the whole file is read as shell); `$(CC) -c a.c` and other lines with a variable (the value decides; only a builtin's name gets the note); a file name with shell characters or spaces in `$@` (taken as plain); BSD make (not checked; only GNU make 4.3 is measured); a whitespace-only tab line under `.ONESHELL` (counted as a recipe line); the name-unquoted note (`'echo' x`, `p'ro'be`) is skipped on a line without a shell.

## From the pipeline sample with distinct lines (#658)

### Samples of a sed without `s` or with an odd second line

- **Verdict:** dropped (YAGNI), 2026-11-07. Kind: `missing-explanation`.
- **Reason:** Rare, and the sample is valid: it shows less than it could.
- **Input and what is missing:** `sed -n '/e/p' | sort -u` keeps one line (the second line is made only for an `s` pattern); `y/abc/xyz/ | uniq` keeps four copies of one line; the second line of an `s` pattern can start with a space (`s/^user=//p` gives ` xyz`).

## From the blank shown visibly (#657)

### A blank in a value: forms still shown as written

- **Verdict:** dropped (YAGNI), 2026-11-07. Kind: `missing-explanation`.
- **Reason:** Rare, and the written form still shows the blank. The common cases (`${x//:/ }`, `${x:- }`, `cut -d' '`, `sed 's/,/ /g'`) are named.
- **Input and what is missing:** `${x:? }` (the message is shown in quotes, `Error message " "`); `"${y:-\ }"` (the written form `\ `); `${x:-" "}`, which keeps its quotes where `${x//:/" "}` unquotes them; a note (not a token) that quotes a blank, such as the one on `IFS`; a regex literal child (`Literal " "`), which has its quotes.

## From the placeholder of xargs -I (#703)

### Placeholders in nested wrappers, the command's name, and an empty replace string

- **Verdict:** dropped (YAGNI), 2026-11-07. Kind: `missing-explanation`.
- **Reason:** Rare, and the tool's own error or the plain operand reading is not wrong, only without the note that the word is replaced.
- **Input and what is missing:** `xargs -I{} find {} -exec echo {} \;` (the `{}` of `echo` is find's, the first is xargs's); `find . -exec xargs -I{} echo {} \;`; `find . -exec {} \;` (find replaces the command's name too); quotes in the input lines of the worked example with `-I`; `xargs -I ''` (an empty replace string: the explanation marks nothing).

## From the `/bin/sh` of a Dockerfile's base image (#654)

### Base images whose sh is not read

- **Verdict:** dropped (YAGNI), 2026-11-07. Kind: `bug`.
- **Reason:** Each stays "any POSIX sh" (dash or busybox ash, the worse of the two), the reading before #654: no false Error where dash fails too, at most a level or a "Portability" note more than the image's own sh gives.
- **Input and what is missing:**
  - `ARG BASE=alpine:3.20` then `FROM ${BASE}`: the default of the ARG is not read, so the stage is `sh`.
  - The Debian-based official images (`node:20`, `python:3.12-slim`, `golang:1.22-bookworm`): their sh is dash, read as `sh`.
  - An image of another registry or namespace (`myorg/alpine`, `ghcr.io/…/alpine`, `public.ecr.aws/docker/library/alpine`): read as `sh`.
  - The shell chip says "(from the file type)" for a shell that the `FROM` line chose.
  - The busybox measured is Ubuntu's busybox-static 1.36.1, not Alpine's own build (whose config could differ in a few applets or options).
  - The chip says "(from the file type)" also where the FROM line chose the shell ("Auto: dash (from the file type)" on the web page's Dockerfile sample): a source of its own ("from the base image") needs a new `ShellSource`, a field on `ShellRegion` and `autoShellAt` to read it.
  - Under `FROM debian`, `SHELL ["/bin/sh", "-o", "pipefail", "-c"]` makes every later RUN fail (dash 0.5.12: "Illegal option -o pipefail", status 2), and nothing says so: the dialect check reads `set -o pipefail`, not a shell's own options in SHELL.
  - `FROM bash` (the official bash image is Alpine-based: its `/bin/sh` is busybox ash) is read as `sh`.
  - A local image of one name (`myapp:1-alpine`) is taken for an official one: its `-alpine` tag makes it busybox ash.
  - Two stages of the same name: the later one's shell is used for `FROM name` after it, whatever Docker does with the duplicate.
  - `type -p` under dash (dash 0.5.12: "-p: not found", status 127) gets no note.
  - An `ONBUILD` trigger runs in a build FROM this image, in that build's shell; it is read with this stage's shell.

## From the placeholder pasted into a shell string (#709)

### Placeholders in a shell's code: forms the warning leaves out

- **Verdict:** dropped (YAGNI), 2026-11-07. Kind: `missing-explanation`.
- **Reason:** Rare forms of the anti-pattern; the line is explained, only without the injection warning or the hole in the string's reading.
- **Input and what is missing:** a placeholder alone among the words `ssh` joins for the remote shell (`find . -exec ssh host rm {} \;`: the remote shell reads the path as code too) and `xargs ssh host rm` without `-I`; a string whose value is not known here (`xargs -I{} sh -c "echo {} $x"` with `x` not set in the script: no placeholder is found, as since #707); a replace string that spans parts of the inner script (`-I'a b'`, `sh -c 'echo a b'`: the row of the whole command `echo a b` says where the item goes); the state model of the inner script still sees the text `{}` as a literal word (no decision was found that it gets wrong).
- **The fix where `$1` is taken:** the note suggests `"$1"` and `_ {}` even when the string already uses `$1` or that slot is taken (`sh -c 'echo "$1" {}' sh {}`).
- **No fix for `su -c`:** `find . -exec su -c 'rm {}' \;` gets the warning without a safe form, as su passes no arguments to the string.
- **find's `once` refusal:** `find . -exec sh -c 'echo {}' {} +` is refused for two `{}`, and its error still says to use `\;`, the injectable form; only the `alone` case (`sh -c 'echo {}' +`) gives the safe form. A string of `su -c` or `ssh` before `+` keeps the `\;` advice too, as neither passes arguments to the string.

## From the review of the builtins each shell has (#718)

### Builtins a shell lacks: corners the review left

- **Verdict:** dropped (YAGNI), 2026-11-08. Kind: `bug`.
- **Reason:** Rare combinations; the usual lines (`source ./lib.sh`, `let i=1`, `caller` in a `#!/bin/sh` script) are said right since #718.
- **Input and what is wrong:**
  - An alias named like a builtin in a sh script (`alias let=…; let x`) gets a false portability warning: `measuredReading` (src/dialect.ts) skips functions of the name but not aliases. On main before #718 too, for `let`.
  - `builtin eval 'x'` in sh: `eval` is still shown as a special builtin, though dash and busybox ash have no `builtin` and never run it.
  - `local` in ksh: `scope.except` of `local` (src/dict/builtins.ts), the shells where it works outside a function, lists ksh, which has no `local` builtin at all (the row `local` of FEATURES leaves ksh out).
  - `command source x` in sh gets no dialect problem, while `source x` gets one (dash: `source: not found`).
  - `setopt` and `print` in a bash script get no problem, though bash fails on them with status 127 (`print` is a ksh, mksh and zsh builtin).

## From the reviews of the find ages (#725)

### `find -mtime` and `-mmin`: fractions, rounding, odd signs

- **Verdict:** dropped (YAGNI), 2026-11-09. Kind: `bug`.
- **Reason:** Rare spellings; the usual `-mtime +7` and `-mmin -30` are said right.
- **Input and what is wrong:**
  - `find . -mtime 1.5`: GNU find 4.9 accepts fractions and matched about [1.5, 2.5) days; the text is now the neutral "as `1.5` says" (before: "exactly 1.5 days ago"). `+1.5` says "more than 1.5 whole days".
  - `find . -mmin 5` says "exactly 5 minutes ago"; GNU matches an age in (4, 5] minutes (rounded up; `-mmin 1` matched 10 s and 50 s, not 70 s). The manual says "exactly n minutes". Older than #725.
  - `-mtime +-1` (GNU matches everything) and `-mtime " 7"` (GNU accepts it) are not explained further.
  - `find . -mtime +\`echo 3\``: the parenthetical's code span breaks on the backtick inside the word.
  - `find . -mtime '+'"$K"` shows as `+''"$K"`, and `\+"$K"` as `+\"$K"` (the display rewrite of the sign).
  - `s=+; find . -mtime "$s$K"` gets the neutral form today (true); if the model learns the start of `$s`, the rewrite would count the sign twice (latent).
  - `DAYS=30; find . -mtime +"$DAYS"` says "(`"$DAYS"` + 1)" instead of 31 (true, less helpful).
  - The `-mmin +"$M"` text has no code span, while the `-mtime` variable texts do (pinned in test/find.test.ts).

## From the reviews of the sh dialect (#718, #719, #728)

### Arithmetic and redirections that dash reads differently

- **Verdict:** dropped (YAGNI), 2026-11-09. Kind: `bug`.
- **Reason:** Rare spellings; the usual portability notes are shown.
- **Input and what is wrong:**
  - `$((echo a); echo b)` is a syntax error in dash and busybox, and fine in bash, yash, ksh, mksh and zsh; it needs a row of its own.
  - `echo $((i++ + 1))`, `$((i+++j))`: dash reads `i + + + 1` (2, status 0, `i` unchanged) and does not fail; we say it fails and stops (should be a Warning).
  - `echo $((--1))`: bash and dash both give 1, yet it gets the preIncrement Warning.
  - `( echo a 2>/dev/null >&f )`: dash expands all redirections first, so its message still shows; we call the line quiet (Warning).
  - `>&/dev/tcp/…` under sh gets both dupFile and netRedirect; the netRedirect sentence is busybox-only there.
  - `echo hi >&10`: dash fails ("Bad fd number") and stops; not flagged (POSIX allows only fds 0 to 9).

### Declarations and options that dash refuses

- **Verdict:** dropped (YAGNI), 2026-11-09. Kind: `bug`.
- **Reason:** Rare options and forms.
- **Input and what is wrong:**
  - `set -o errtrace` / `+o errtrace` in dash 0.5.12 is refused, `set -E` is accepted; the errtrace row says dash runs both (Info).
  - `local a[0]=1` / `export a[0]=1` in dash: "bad variable name" and the shell stops; the arrayElement row says "not found, status 127".

### Words under sh: shapes that follow bash

- **Verdict:** dropped (YAGNI), 2026-11-09. Kind: `bug`.
- **Reason:** Rare in sh scripts; the chip and the example follow bash's reading, and a portability warning is shown where there is one.
- **Input and what is wrong:**
  - dash reads `[^a]` with `^` as a plain character; `wordFields` with a file list follows bash's matching (the shapes still hold).
  - `~+` under `sh` is explained as "current directory" (bash's reading); the chip shows nothing.
  - `#!/bin/dash` + `echo $[1+1]`: the chip shows `echo 2` and there is no dialect note; dash prints `$[1+1]`. A FEATURES row for `$[` in src/dialect.ts would give the note and replace `readsAsBash`'s text check.
  - `#!/bin/sh` + `shopt -s nullglob dotglob; ls *.c`: the chip still says "else the pattern itself" and the example says `.app.c` does not match; bash --posix gives no word / matches it (the shopt line has an Error).
  - `#!/bin/dash` + `ls .*`: the glob example omits `.` and `..`, which dash matches.
  - `#!/bin/sh` + `echo a{b,c}`: the chip shows one literal word; bash --posix expands it (the portability warning is shown).
  - Design note: which shells the model follows is decided by `wordsFollowed(shell)`, `COMMON_SH.includes(shell)` and `shell === 'sh'`; consistent, but easy to misread.

### Builtins in sh: more corners after #718's re-review

- **Verdict:** dropped (YAGNI), 2026-11-09. Kind: `bug`.
- **Reason:** Rare combinations; see also "Builtins a shell lacks: corners the review left".
- **Input and what is wrong:**
  - `#!/bin/sh` + `set -e`, then `shopt -s nullglob` / `logout` / `builtin …`: dash and ash stop with 127 there; a later fault is now an Error (`STOPS` leaves out `-e` by rule).
  - `command source x` in sh: the inner token is still kind `builtin` and "runs `source`…", while its badge says "program: usually no program of this name".
  - `builtin exit 0` in sh still explains `exit` as a special builtin with its arguments.
  - `logout` at the top of a bash script is a `sure` stop; real bash prints "not login shell" and goes on (older than #718).
  - `. /nonexist` in sh: dash and ash both stop for sure; we say `may` (conservative).

## From the build of the variables' token texts (#757)

### Variables bash sets, in other shells (with `$_` in sh, #769)

- **Verdict:** dropped (YAGNI), 2026-11-09. Kind: `bug`.
- **Reason:** Rare in sh scripts, or unmeasured (no mksh installed); the texts and src/semantics/vars.ts are bash's for every shell.
- **Input and what is wrong:**
  - `#!/bin/sh` `echo $SHLVL`: "Nesting level of bash"; dash does not set or increment it (inherited).
  - `#!/bin/sh` `RANDOM=3`: "Assigning a number seeds the generator"; not in dash (ash does).
  - `#!/bin/sh` `echo $LINENO`: bash's text; Ubuntu dash leaves it empty.
  - `#!/bin/mksh` `$BASHPID` / `$EPOCHREALTIME`: the token says "mksh does not set it" (repeats the existing Error note); mksh likely sets both (unverified).
  - `SRANDOM`, `OPTERR`, `HISTCMD` in `setByBash` carry 'ykmz' (yash, ksh, mksh and zsh set them): unmeasured, probably false for SRANDOM in ksh93; the same effect as before.
  - A bash 5.3 variable (`bash53Variable`) in sh does not get the new token form.
  - (#769) `$_` in sh: interactive `dash -i` and `busybox ash -i` do set it to the last argument; the "not set" claim holds for script files.
  - (#769) `sh script.sh` run from bash: `$_` is the shell's own path (bash exports `_`), so the shared note "expands to nothing" is imprecise (same template as SHLVL); the token text is accurate.

## From the reviews of the bazel preset (#755)

### Bazel option values and spellings

- **Verdict:** dropped (YAGNI), 2026-11-09. Kind: `bug`.
- **Reason:** Rare spellings; the usual `--keep_going`, `--nokeep_going` and `--keep_going=false` are said right.
- **Input and what is wrong** (bazel 9.3.2, checked with canonicalize-flags):
  - `--keep_going=f`, `=n`, `=FALSE`: bazel reads off (BooleanConverter ignores case and takes t/y/f/n); we say on. The fix is `/^(?:false|no|0|f|n)$/i` in `booleanOff` (src/argv/parsers.ts) and the same words in `tristate()`, as one shared constant.
  - `--cache_test_results=FALSE`: bazel reads off; we show the value with no meaning.
  - `--keep_going=maybe`, `--keep_going=`, `--cache_test_results=maybe`: bazel errors "'…' is not a boolean"; we say on, or show the value, with no warning.
  - `bazel --home_rc=false build`, `--batch=false`: startup booleans refuse `=value` in bazel; we accept it.
  - `--nostamp=1` ("Unexpected value after boolean option") and `-t=no` ("Invalid options syntax"): we say "not in the dictionary" and not that bazel refuses them.
  - `--nocompilation_mode`: we say "not in the dictionary"; bazel says "Illegal use of 'no' prefix".
  - `bazel --help build`, `bazel -h build`: bazel prints the help of `build`; we call `--help` an unlisted startup option.

## From the review of the Python `re` design (#754)

### Python 3.12 `re` and f-string forms not planned

- **Verdict:** dropped (YAGNI), 2026-11-09. Kind: `missing-explanation`.
- **Reason:** Rare in the patterns people write; see [design/python-regex.md](design/python-regex.md).
- **Input and what is missing** (Python 3.12.3): scoped inline flags `(?x:…)` and `(?-x:…)`; `re.DEBUG` and `re.U`; `match` under `re.M` anchors at the string start only; PEP 701 nested quotes in an f-string pattern and `{x!r:>10}`.

## From the review of the scripts bats runs (#726)

### Signals and `run` flags

- **Verdict:** dropped (YAGNI), 2026-11-09. Kind: `bug`.
- **Reason:** Rare (bash 5.2.21, bats 1.13.0).
- **Input and what is wrong:**
  - A script started with `&` from a non-interactive shell ignores SIGINT and SIGQUIT (an outside SIGINT did nothing; the trap ran at the normal end, status 0).
  - A failed `exec nosuchcmd` runs the EXIT trap (127).
  - `run` flags (`run -1`, `run !`) are not read as bats < 1.5 would.

## From the review of the web page's file kinds (#727)

### Kind change, select-all paste, `ask` while open

- **Verdict:** dropped (YAGNI), 2026-11-09. Kind: `ui`.
- **Reason:** Rare paths.
- **Input and what is wrong:**
  - "Name set back to untitled." is said even when the new kind's untitled name is its own (the bar reads "Dockerfile", muted).
  - Ctrl+A, Ctrl+X, Ctrl+V over an open file is a paste into an empty editor: it asks "Discard and paste" and untitles the file.
  - `ask` called while a question is open would resolve the first as cancel and call `showModal()` on an open dialog; unreachable today (the modal makes the page inert).

## From the review of the POSIX sh hint (#762)

### Shebang read for the sh hint

- **Verdict:** dropped (YAGNI), 2026-11-09. Kind: `bug`.
- **Reason:** Rare spellings; the usual shebang and `# shellcheck shell=` directives are read right.
- **Input and what is wrong:**
  - `#!/bin/bash` plus `# shellcheck shell=bogus`: `readShell` reads the unknown name as `default`, so the POSIX sh hint shows despite the bash shebang.

## From the reviews of the bazel target patterns (#765)

### Bazel target patterns: what the query-word reader does not say

- **Verdict:** dropped (YAGNI), 2026-11-09. Kind: `bug`. Two inputs are `missing-explanation`.
- **Reason:** Rare spellings; the usual `//pkg:target`, `//pkg/...` and `:all` are read right (bazel 9.3.2).
- **Input and what is wrong:**
  - `manual` targets: the reader does not know the command, so it says nothing about them (aquery leaves them out of wildcards; query and cquery include them). Missing explanation.
  - A wildcard next to a target literally named `all` or `all-targets`: bazel's precedence is not modelled. Missing explanation.
  - `.bazelignore` directories and the symlink rule of `/...` are not said. Missing explanation.
  - A hole whose value holds `:` or `...` inside a package path: the hole's text names the risk; the parts around it are read as written.
  - `"//$PKG/..."`: the package part's token "The directory `$PKG`…" assumes the value holds no `:`.
  - `bazel build app/` (tab completion's trailing `/`): we quote "invalid package name"; bazel says "invalid target name 'app/': target names may not end with '/'". The refusal is right, the quoted message is not.
  - `bazel build ./app`: we say "invalid package name"; bazel says "target names may not contain '.' as a path segment".
  - `bazel build //app:foo/...` is read as one target named `foo/...`; bazel's reading is not checked.

## From the review of buildifier (#766)

### buildifier: statuses and option lists

- **Verdict:** dropped (YAGNI), 2026-11-09. Kind: `bug`.
- **Reason:** Rare invocations (buildifier 10.2.0); the usual `buildifier file`, `-mode=check` and `-lint=warn` are said right.
- **Input and what is wrong:**
  - `-warnings=foo` (unknown name) exits 1 with a Go log line; we say status 2.
  - With `-format`, a missing file gives status 3 with `"success":true` and an empty file list.

## From the review of buildozer (#781)

### buildozer: words left unread, rare label forms

- **Verdict:** dropped (YAGNI), 2026-11-09. Kind: `bug`.
- **Reason:** Rare forms (buildozer 10.2.0); the usual `buildozer 'cmd args' //pkg:rule`, `//pkg:*`, `//pkg:%kind`, `//pkg/...:*` and `-:name` are said right.
- **Input and what is wrong:**
  - `buildozer 'add deps x' "//app:$t"`: a label with an expansion is left unread (no text for a hole in a label).
  - `buildozer '' //a:b`: the empty word is not marked; buildozer stops with "empty command list" (status 1). A word of blanks only is marked.
  - `buildozer 'print label' -//app:main`: says nothing; buildozer reads the package `-/app` and fails (status 2).
  - `buildozer 'print label' -:`: not explained; buildozer reads it as no stdin package. `app:` (a relative package with no name) is not explained; buildozer reads it as the rule `app` of the current directory.
  - `//BUILD`, `BUILD` alone: not explained (buildozer fails: "file not found").
  - `buildozer -f cmds.txt`: the commands of the file are not read, and a file of print commands only still gets the warning on status 3.
  - `buildozer -stdout=false …`: the option says what `-stdout` does, with "value: `false`".
  - `buildozer 'print nosuch' //app:main`: the attribute's text does not say that `(missing)` is printed on stdout (and a warning on stderr).

### Exit statuses that are no error: where the note does not name them

- **Verdict:** dropped (YAGNI), 2026-11-09. Kind: `bug`.
- **Reason:** The note on where `set -e` stops says "fails" there, which is still true to bash.
- **Input and what is wrong:**
  - `set -e; x=$(grep a f)`: the note on the substitution does not name grep's status 1.
  - `set -e; grep a f; diff b c`: a line with several stopping commands keeps the generic "If `grep` or `diff` fails".
  - `grep $opts x f`: the statuses are read as if `$opts` were not `-v` ("no line matched").

## From the reviews of the traps and set -e (#767, #774)

### Traps: order of definitions, unknown values, `trap -`

- **Verdict:** dropped (YAGNI), 2026-11-09. Kind: `bug`.
- **Reason:** Rare (a trap set inside a function that is defined before another trap of the same signal; data that is bad at run time).
- **Input and what is wrong:**
  - `f() { trap 'echo B' EXIT; }`, then `trap 'echo A' EXIT`, then `f`: `runsAtExit` uses text order, so the model says A runs; bash runs only B. The old name scan had the same bug. Fix: walk order of `trapSets`.
  - `fails: 'usage'` on words whose value is not known (`umask "$m"`, `export "$name=1"`, `trap x "$sig"`): these fail on bad data, not only on script mistakes.
  - `within: exit-trap` is still given after `trap - EXIT` takes the trap back (harmless).
  - `f() { set +e; false; return; }; set -e; f`: the call's note stays, but bash runs ERR and goes on (errexit is off when `f` returns).

### shopt, exec and `cannotFail`: statuses that stop `set -e`

- **Verdict:** dropped (YAGNI), 2026-11-09. Kind: `bug`.
- **Reason:** Rare options, typos and forms; most err cautious, a few say too little where bash stops.
- **Input and what is wrong:**
  - `shopt -q extglob | grep x`: `cannotFail` (src/semantics/status.ts:628) checks whether `fails` is set, not `failsOnly`, so the stage counts as one that cannot fail (matters only without pipefail).
  - `shopt -s array_expand_once` in 5.2 mode (a 5.3-only name): returns 1 and stops `set -e`; the error note says "status 1" but `mayFail` is false, so no stop sentence stands beside it.
  - `shopt -s nosuchopt` (a typo) gets no error token; bash returns 1 and `set -e` stops.
  - `shopt -s execfail; exec /nonexistent || true` under `set -e`: bash exits 127 despite `|| true`.
  - `exec "$@"` when `$1` starts with `-` (usage error): bash prints ERR and EXIT, exits 2 (`set -e` stops); the model says `fails: 'never'`, no note.
  - `command exec "$@"` and `command exec /bin/app`: the note says "If `command` fails, `set -e` stops…"; bash never stops there (apart from a redirection).
  - `exit 3 2>/nonexist/x`: bash runs ERR and EXIT and exits 1; the `given` rule returns before the redirection check, so no note (while `exit "$rc" 2>/nonexist/x` gets one).

### `exit`, `return` and masks under `set -e`

- **Verdict:** dropped (YAGNI), 2026-11-09. Kind: `bug`.
- **Reason:** Rare forms, or bash 5.3 only (the default reference is 5.2).
- **Input and what is wrong:**
  - `x=$(a || b && true)`: the `|| true` mask sees `||` and a last command that succeeds, so it says the line cannot fail; bash: status 1, the script stops. Fix: require the operator right before the last command to be `||`.
  - bash 5.3 `exit x` (non-numeric) fails, runs ERR and goes on without `set -e` (status 0); 5.2 exits 2, no ERR.
  - bash 5.3 `exit "$rc"` with a non-number goes on with status 2, so `set -e` stops and ERR runs; the model's `ends: 'shell'` holds only in 5.2 (5.3 mode gives no note).
  - A top-level `return` in a script that is run (not sourced) fails with 2: ERR and EXIT run, `set -e` stops; no note (as for `return 0`).
  - `true | exit 3` has no note, but bash stops (ERR, EXIT, status 3).
  - `[[ x =~ $re ]]` with an invalid regex exits 2, but the note says "status 1".
  - A function named anywhere as an argument becomes "not closed" (src/semantics/env.ts:61/226: `echo build`, `ssh host deploy`), so its body's stop note says "the shell it runs in" and loses the trap. Fix: close only on arguments of commands that can run a shell function.

## From the review of the regex errors (#779)

### Regexes: errors not found, and readings that differ from the tool

- **Verdict:** dropped (YAGNI), 2026-11-09. Kind: `bug`.
- **Reason:** Rare patterns. None gives a false Error: each is a pattern the tool refuses that we say nothing of, an error with the wrong reason, or a rare reading.
- **Input and what is wrong:**
  - `grep '\`\{'`: we say `regex-interval-incomplete`, but GNU grep takes `` \` `` as an anchor and the `\{` after it as the character (status 1). sed refuses it too, with "Invalid preceding regular expression", not "Unmatched \{". `` \` `` and `\'` are no `keyword` tokens of the BRE reader, so `nothingBefore` does not see them.
  - `awk '/a\/'`, `perl -ne 'print if /a\/'`: the right status, the wrong reason. The `\/` escapes the delimiter, so the regex is not terminated (gawk "unterminated regexp", Perl "Search pattern not terminated"); we say "Nothing follows the final `\`".
  - Refused, and we say nothing: `grep -E 'a{}'` ("Invalid content of \{\}"), `sed -E 's/a{/x/'` ("Unmatched \{"; grep -E takes `a{`), `grep 'a\{2,1\}'` (a range that goes down), `grep -P 'a)'` (unmatched closing parenthesis), `grep -P '[\K]'` (an escape a class cannot hold: "not valid in a class", with no level), `grep -P '(?#x'` (a comment not closed).
  - `sed 's/[a/x/'`: since sed reads a bracket expression whole, an unclosed `[` leaves the `s` command unterminated, which the sed reader says in its own text ("Unterminated `s` command"), with no level: the sed reader's errors are not in the catalog.
  - `grep -E 'a{,}'`: grep reads `{,}` as `{0,}` (it matches `aaa`); we read the text `{,}`.
  - `grep '[[.].]'`: the collating symbol `[.].]` is read as `[`, `.`, then a `]` that closes the class; GNU grep reads a class of `]`. (sed's end of the regex reads it whole.)
  - `[[ a || x =~ [ ]]`: an Error, though bash reads the regex only when `a` is false, so the `[[` does not fail every time (no "sometimes read" form, as `arith-invalid-number-if-read` has).

## From the review of the bazel query language (#780)

### bazel query expressions: corners the reader does not follow

- **Verdict:** dropped (YAGNI), 2026-11-09. Kind: `bug`. Inputs marked "missing" are `missing-explanation`.
- **Reason:** Rare spellings (bazel 9.3.2). The usual expressions (`deps(…)`, `rdeps(…)`, `kind(…)`, `filter(…)`, `attr(…)`, the operators, `let`) are read right, and none of these gives a false Error.
- **Input and what is wrong:**
  - `kind("*", //app:*)`: Java refuses the regex ("Dangling meta character '*'", status 7); the PCRE reader takes `*` at the start as a repetition and says nothing. Missing (test/bazel-query.test.ts, `REGEX_MISSED`).
  - `filter("a{,3}", …)`: Java refuses it ("Illegal repetition", status 7); we read `{,3}`. Missing.
  - Java and PCRE know different escapes (`\K`, `\C`, `\g`, `\o{…}` are PCRE's, not Java's): a pattern with one is read as PCRE reads it.
  - `bazel aquery 'inputs(".*", //x)' --skyframe_state`: with `--skyframe_state` aquery's filters take one argument; we still mark one argument as a mistake (the option is not in the spec).
  - `bazel query "kind($k, //x)"`: a value in an unquoted regex argument leaves the word unread, where a text could say that a blank, `,` or `)` in the value ends the argument. Missing.
  - `bazel query "kind('$k', //x)"`: a `'` in the value would end the quoted word; the regex hole's text does not say so.
  - `bazel query '//app:main-//app:main'`: `-` inside a word is a character of the word, so this is one word, `main-//app:main`, which bazel refuses ("invalid target name … may not contain '//'"); we read a target named `main-//app:main`. Missing.
  - `bazel query 'deps(//)'`: bazel refuses `//` ("invalid target name '': empty target name"); we say "A target pattern". Missing.
  - `bazel query "@@rules+//$pkg/..."`: the hole's text lists `+` among what ends the word, though a word that starts with `@@` keeps its `+`.
  - `bazel query "deps('//$a:all') + //$b:all"`: the sentence on what ends a word is said once per line, keyed by the hole's place, so where the first hole of the line is in a quoted word of the expression (which says nothing of it), the later unquoted one does not say it either.
  - `bazel query "deps($a) $b"`: an expression of several words with holes is left unread; only the words that are target patterns are read.

## From the review of the bazel query runner (#786)

### bazel query in a pipeline: corners the runner does not follow

- `shopt -s nullglob; bazel query //app:* | wc -l`: bash expands the unquoted `//app:*` as a glob (to nothing under nullglob, an error under failglob, the word itself when nothing matches); the runner takes the literal word.
- `bazel cquery //...` on a server where earlier commands built with other options: cquery also prints the configurations those left (more `(hash)` lines than the example shows). The note could say so.
- Nested `let` copies the variables' map at each level (`new Map([...env, …])`): quadratic in the depth, and the copies are not charged to the guard.
- Startup options before the command are not checked: `bazel --bazelrc=x.rc query //...` may read options (an `--output`) from the rc file; the example takes the defaults.
- The note that the workspace is made up stays on the whole-pipeline example: the lines a later stage reads in its own example (`bazel query //... | while read t; do …; done`) do not carry it.
- `RunnerKind` holds the source runners only; the first runner of a filter (M6) will need its own kind, or a split of the type.
- `queryTree` runs the whole token reader of src/embedded/bazelquery.ts (with the texts of every token) to get the tree.

## From the review of the Python lexer (#794)

### Python files: corners the lexer and the shell writer do not follow

- `bug`: a newline in a replacement field of an f-string in single quotes, in brackets or not. Python 3.12 and later accept `f"{\n x\n}"` and `f"{f(a,\n b)}"`; the lexer ends the field at the newline (so that a literal being typed reads no further than its line), so such a call is not explained, and the rest of its line is read as code: in `x = f"{a\n} os.system('fake')"` the `os.system('fake')` is explained.
- `bug`: control characters from escapes reach the shell text as they are: `os.system("echo \0")` writes a NUL (Python raises ValueError: embedded null character), and `\r` and `\v` give a CR and a VT in the word.
- `missing-explanation`: an import after `:` is not read (`if x: import subprocess`, `try: import subprocess`), so the calls it names are not found.
- `missing-explanation`: an item of an argument list over several lines (`run(["a",\n "b"\n "c"])`, the literals of one item on two lines): the call is not explained.
- `bug`: the lexer accepts what Python rejects in f-strings: a single `}` (`f"a}b"`) and an empty field (`f"{}"`).
- `bug`: a rebinding of an imported name is not followed: `run = print; run("x")` is explained as `subprocess.run`.
- `bug`: an escaped newline after `then`, `do`, `{`, `&&`, `||` or `|` is written as `;`: `os.system("if true; then\necho a\nfi")` becomes `if true; then;echo a;fi`, a syntax error, where sh reads a newline.
- `bug`: a backslash-newline of the Python source inside the shell's single quotes is written as a shell continuation: in `os.system("echo 'a\<newline>b'")` Python's value is `echo 'ab'`, and our text has `'a\` at the end of the line, which sh keeps in the quotes.
- `missing-explanation`: of two calls on one line (`os.system("cd x"); os.system("make all")`), only the first is explained: a line of shell text holds one call.

## From the review of the Python regex seam (#800)

### Python patterns: corners the `python` flavor does not follow

- **Verdict:** dropped (YAGNI), 2026-11-10. Kind: `bug` unless marked. Python 3.15.
- **Reason:** Rare patterns and files. None gives a false Error: each is a refusal we do not say, a rare reading, or a note left out. Python's refusals that step 3 of docs/design/python-regex.md (#760) reads were removed from this list when it read them.
- **Input and what is wrong:**
  - `a{,}`: Python reads `{,}` as 0 or more (`re.fullmatch('a{,}', 'aaa')` matches); we say `Literal "a{,}"`.
  - A pattern over several lines: Python's message ends with the line and column (`unbalanced parenthesis at position 2 (line 2, column 1)`); ours has the position only.
  - `(?>…)` and `a++` (since 3.11) have no note of the release they need: 3.11 is the oldest release still supported (`\z`, since 3.14, has one since #760). (`missing-explanation`)
  - `r'\ '`: the token is right (`Literal " "`), but its label is `\` (`shorten` trims the space).
  - `[\b]`: "Character class: one of a backspace" reads badly; a set of one character could say "a backspace".
  - `from re import *` then `search('a', s)`: the call is not found. (`missing-explanation`)
  - `def re(x): …` after `import re`: `re.search('a', s)` is still read as the `re` module's.
  - No Python control flow: a pattern after `sys.exit()` or under `if False:` still gets its tokens and its Error (the design says so, section 9).

## From the review of the Python regex flags (#749)

### Python flags: corners the `python` flavor does not follow

- **Verdict:** dropped (YAGNI), 2026-11-10. Kind: `bug` unless marked. Python 3.15.
- **Reason:** Rare flags and patterns. None gives a false Error: each is a word "in either case" too many or too few, a refusal we do not say, or a note left out. The refusals that step 3 of docs/design/python-regex.md (#760) reads were removed from this list when it read them.
- **Input and what is wrong:**
  - `re.compile('é', re.I | re.A)`: with `re.ASCII`, only ASCII letters match in either case, so `é` matches only itself; we say "in either case". The same for a ligature with `re.I`, `ﬀ`, which matches only itself: we say "in either case".
  - `[a-z]` with `re.I` also matches `ſ` (U+017F) and the Kelvin sign `K` (U+212A); we say only that its letters match in either case.
  - An escape read as a literal under `re.I` (`\xe9`, `\x41`) does not say "in either case", where a letter written as it is does.
  - `caseText` on a set strips only a backslash and one character, so `[\x2d]` ("-") wrongly says "in either case".
  - A backreference under `re.I` (`(a)\1`) matches its group's text in either case; we do not say so.
  - `re.TEMPLATE` (`re.T`) is read as a name not known, a term of no flag; since 3.13 it is an `AttributeError`.
  - A duplicate argument, `re.search('a', s, string=t)` (`TypeError`: multiple values for `string`), still gives a region.
  - `rb'é'`: Python refuses a non-ASCII character in a bytes literal (SyntaxError); we read it as a pattern.
  - Of the 13 out-of-scope misses of the review's differential, `\N{EM  DASH}` (two spaces) is left: Python refuses the name ("undefined character name"), which is not checked (no table of Unicode names). The others it named (`(?é)`, `(?`, `(?x)(?P< n>a)`, `(?x)(? :a)`, `[a- z]` with `re.X`, `(?a)(?u)`, `(?u)` with `re.A`) are refused as Python refuses them since #760, by its validity differential.
  - The positional `count` or `maxsplit` without flags (`re.sub(p, r, s, 1)`) warns since 3.13 (DeprecationWarning); we say it only with the pitfall of a flag in that slot. (`missing-explanation`)

## From the Python regex errors (#760)

### Python and PCRE patterns: corners the errors do not follow

- **Verdict:** dropped (YAGNI), 2026-11-10. Kind: `bug` unless marked. Python 3.15, GNU grep 3.11 (PCRE2).
- **Reason:** Rare patterns. Only one gives a false Error, a `)` in a comment of grep -P's extended mode (`(?x)`), which grep patterns rarely use; the others are a refusal we do not say, a message other than Python's where a pattern has two errors, or a reading of a rare form.
- **Input and what is wrong:**
  - A range with an end named by `\N{…}`: `[\N{EM DASH}-a]` ("bad character range \N-a") is no Error, as the name's code is not known.
  - Flags that do not go together through the pattern's inline flags (`(?a)(?u)a`) are said only where no other refusal of the pattern comes first; Python says them before a `)` that closes no group, and so do we, but after a refusal that the parser stops at, we say only that one. The flags argument's (`re.L` with a str pattern) is said whatever the pattern holds.
  - A final `\`: Python's tokenizer reads a token ahead, so it refuses the `\` before or after the token before it, by where that token's refusal is raised (`?\` is "bad escape (end of pattern)", `(?u)\` with bytes "bad inline flags"); we say both, in the order of the text.
  - `grep -P`: a backreference to a group the pattern has not (`(a)\2`, `\k<n>`) and a lookbehind of more than one width (`(?<=a+)x`) are no Errors; grep -P refuses them ("reference to non-existent subpattern", "lookbehind assertion is not fixed length"). A conditional on such a group is one since #760.
  - `grep -P`: a recursion test (`(?(R)…)`, `(?(R1)…)`), `(?(DEFINE)…)`, `(?(VERSION>=10)…)`, a relative number (`(?(+1)…)`) or an assertion (`(?(?=a)…)`) as a condition is "a PCRE construct this explainer does not read". (`missing-explanation`)
  - `grep -P '(?x) a # b)'`: PCRE2 compiles it (the `)` is in a comment of extended mode); we say "unmatched closing parenthesis". The reader does not follow `(?x)` in PCRE: `(?x)#(?<=` is an unclosed group to us, and compiles too.
  - Perl `(?('n')a)` or `(?(<n>)a)` with no group `n`: Perl refuses it ("Reference to nonexistent named group"); we explain the conditional and say no Error.
  - Python stops at the first `)` that closes no group (its parser raises there); we read on and say what follows too: `a)\e` adds "bad escape \e at position 2" after "unbalanced parenthesis at position 1", and `(?a){9)(?(1) ` with `re.U` adds the refusals after the `)`. The first Error is Python's.
  - An escape of a character past U+FFFF (`a\😀`, every flavor) is read as two halves of the character ("Literal" of each surrogate); the regex reads one character.
  - `grep -P 'x{,2}{,3}'`: before PCRE2 10.43 it is the text "x{,2}{,3}", and from 10.43 a repeat right after another (an error); we say that the second `{,3}` repeats the "}" of the text `{,2}` before 10.43.

## From the review of the Python regex literal (#750)

### Python strings: corners of the escapes and fields of a pattern

- **Verdict:** dropped (YAGNI), 2026-11-10. Kind: `bug` unless marked. Python 3.15.
- **Reason:** Rare strings and patterns. None gives a false Error: each is a wording that is wrong for one rare input, a Warning said twice, or a note left out.
- **Input and what is wrong:**
  - `re.search("\56", s)`: the octal pitfall says the pattern "matches that character U+002E there, not what group 56 matched", but the regex reads the `.` as any character.
  - VERBOSE with an octal or `\b` escape: `re.compile("a\12b", re.X)` says "matches that character", but the newline it gives is whitespace VERBOSE ignores; `re.compile("a # \b\1 here", re.X)` warns twice for escapes in a comment, which the regex never reads.
  - `"\18"`: the octal pitfall says "not what group 1 matched", but `r"\18"` refers to group 18.
  - `[{re.escape(x)}]` with an empty value gives `[]`, an unterminated set (a Python error); the text of the class does not say it. (`missing-explanation`)
  - The repeat after `{re.escape(x)}` (`{re.escape(x)}+`) says "the last item of the value (a character, a set or a group)"; only a character is possible there.
  - Control characters shown raw in the rows of literals: `re.search("\bword\b", s)` has the row `Literal "^Hword^H"` with backspaces in it (already on main before #750).
  - With Perl's `/x`, the whitespace and `#` of an interpolated value are read as the pattern's too (`perl -ne 'print if /a$x b/x'`); the hole's text says so only for Python's `re.VERBOSE`. (`missing-explanation`)
  - The box of the panel (`matchMarks`, src/examples/rerun.ts) steps past an empty match as JavaScript does, not as `sre` does (`must_advance`): for `|a` on `a`, it marks `''` at 0 and at 1, where Python's `finditer` also finds `'a'` at 0. Only the highlights differ; the examples' own results follow `sre` (`pythonMatches`).

## From the Python templates and compiled patterns (#752)

### Python's `re`: corners of the templates and of the names linked to a compile

- **Verdict:** dropped (YAGNI), 2026-11-10. Kind: `missing-explanation` unless marked. Python 3.15.
- **Reason:** Rare files. None gives a false Error: each leaves a call unlinked or a template's groups unchecked where the rule cannot be sure.
- **Input and what is wrong:**
  - A pattern with a construct the reader does not read (`(?P<é>a)`, a group name past ASCII) has groups not known: its template gets no Error for a group it lacks (`re.sub(r'(?P<é>a)', r'\2', s)` raises "invalid group reference 2").
  - A capture of a `case` pattern (`case P:`) is not counted as a binding: `P = re.compile(…)` and a `match` that binds `P` again still link `P.sub(…)` to the compile.
  - A compile in a class body (`class C: P = re.compile(…)`) is never linked, even for a call in the class body itself, where Python sees `P`.
  - A name bound once in a branch (`if x: P = re.compile(…)`) is not linked: the statement starts with `if`, not with the name.
  - `re.sub(r'(a)', f'{x}\\1', s)`: the row of `\1` says "what group 1 matched", but a value of `x` that ends in an odd number of backslashes changes how it reads (`x = '\\'` gives the text `\1`).
  - `re.sub(r'(a)', '<\12>', s)` warns that the string makes a character and says to write it raw, but raw `\12` is "invalid group reference 12" (one group); the same for `'\1'` with a pattern without groups. (`bug`)
  - Two Errors where Python stops at the first: `re.sub(r'(a))', r'\2', s)` says the pattern's and the template's; so does `P = re.compile(r'(a))')` then `P.sub(r'\2', s)`.
  - The line of a method says nothing where Python raises TypeError for an argument the method does not take: `P.search(s, flags=re.I)`, `P.sub('x', s, pos=1)`.
  - With `endpos`, the row of `fullmatch` still says "matched against the whole string" (`P.fullmatch(s, 0, 3)` matches `s[:3]`).
  - An argument of an outer call on a line that a call inside it holds is shown nowhere: in `x = re.sub(r'a', 'b',` above `re.sub(r'c', 'd', s), flags=re.I)`, line 2 is the inner call's, and `flags=re.I` has no row there (#813).
  - Two calls of a line whose texts start with the same 40 characters get the same example title ("Example for `re.sub(r'…`").
  - A call of `re` inside a field of an f-string (`f"{re.sub(r'a', 'b', s)}"`) is not found.

## From the shell-behaviour table (#756)

### `~N` in ksh93, mksh and yash: the word model reads it as bash does

- **Verdict:** dropped (YAGNI), 2026-11-10. Kind: `bug`.
- **Reason:** A rare input: `~N` (the directory stack) in a script for one of three rarely used shells, measured in the real shells by test/shell-behaviours.test.ts (`dirTilde`). `dirTilde` lists only the shells that expand none of `~+`, `~-` and `~N` (dash and busybox ash).
- **Input and what is wrong:**
  - `echo ~1`, `~+1`, `~-1` in a ksh93 or mksh script: neither shell expands `~N`, so each word stays as written; the word model reads the directory stack's entry as bash does.
  - `echo ~1` in a yash script: yash expands only `~+N` and `~-N`, so `~1` stays as written; the model reads it as bash does (for `~+1` and `~-1` it agrees).

### Web page: Python detection by content, two rare corners (#753)

- **Verdict:** dropped (YAGNI), 2026-11-10. Kind: `bug`.
- **Reason:** Rare inputs; the `import` line rule is shared with the `subprocess`/`os` rule of `detectKind`.
- **Input and what is wrong:**
  - `try:\n    import re\nexcept: pass\nre.search('a', s)`: the import is indented, so the text is not detected as Python.
  - A shell script with no shebang that holds a Python heredoc with `import re` and an `re.` call (`python3 - <<'EOF' … EOF`) is taken as Python.

## From known values, step 2 (#790)

### Markdown: a value set in one fence is read in the next

- **Verdict:** dropped (YAGNI), 2026-11-11. Kind: `bug`.
- **Reason:** Rare: a value of a fenced block used in a later block of the same Markdown file. `expansionValue` already carried values across fences before #821; the reading only makes it visible.
- **Input and what is wrong:** In a `.md` file, a fence with `re='[a'`, then another fence with `grep -E "$re" f`: the second fence's line shows the value `[a`, reads it, and says an Error ("No `]` closes this `[`"). The blocks are separate snippets, which a reader runs apart: the value is not known there.

### Values the model refuses that bash would pass as they are

- **Verdict:** dropped (YAGNI), 2026-11-11. Kind: `missing-explanation`.
- **Reason:** Rare forms; the model is right not to be sure in general, and the use keeps today's explanation.
- **Input and what is wrong:**
  - `re=' ^a'; grep -E $re f`: bash splits off the leading space and grep gets `^a`, but no value is shown and nothing is read.
  - `re=(x y); re='^a'; grep -E "$re" f`: `re` is an array whose element 0 is `^a`, which `"$re"` gives; no value is shown and nothing is read.

## From known values, step 3 (#790)

All three predate the PR; they are in the explanation of `[[ =~ ]]` for a literal right side too.

### compat31 and a quoted right side of `=~`

- **Verdict:** dropped (YAGNI), 2026-11-11. Kind: `contradiction` in a rare combination.
- **Input and what is wrong:** With `shopt -s compat31` or `BASH_COMPAT=31`, `[[ abc =~ "$re" ]]` and `[[ abc =~ "a.c" ]]` are regex matches in bash (status 0), but `quotedPatternNote` (src/explain/tests.ts) says the quoted right side is literal text. `BASH_COMPAT=32` is not affected.

### Regex errors of glibc the reader does not flag

- **Verdict:** dropped (YAGNI), 2026-11-11. Kind: `contradiction` in a rare combination.
- **Input and what is wrong:** bash gives status 2 for `a{`, `a{1`, `a{1,2`, `{1}`, `\1` with no group, `[[:alpha:]-z]`, `*a`, `^*a`, `a|*b`, `(*a)`, `a{2,1}`, `[z-a]` and `[[:foo:]]` (as a literal right side or a known value), but the ERE reader flags none of them as an error. Some of them also get an example that matches literally.

### nocasematch and a range in a bracket

- **Verdict:** dropped for now, 2026-11-11 (a PR of its own may fix the example). Kind: `contradiction` in a rare combination.
- **Input and what is wrong:** With `shopt -s nocasematch`, `[[ x =~ ^[a\-z]$ ]]` gives status 2 under REG_ICASE in glibc, but we show an example.

## Decisions recorded on 2026-11-06

- The three choices that waited on the maintainer (#640): the CLI exits with status 141, quietly, on a closed pipe ("CLI crashes on a closed pipe (EPIPE)", #644); the README choices stay open ("A lighter README for the first visit", #682); the outside-feedback fixes rank between "Usability: "In short" without nesting, and the length measured again" and "Usability: the phone's sheet".
- "Usability toward 9/10" was split into one issue per step (label `usability-9`); U1, U4 and U6 were done (#639, #637, #638).
- The roadmap's heading items ("Readings left after the receives line", "One source per fact, stage SC", "Dialect levels left") were judged by their parts: each part is an issue or an entry above.
