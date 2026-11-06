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

## Decisions recorded on 2026-11-06

- The three choices that waited on the maintainer (#640): the CLI exits with status 141, quietly, on a closed pipe ("CLI crashes on a closed pipe (EPIPE)", #644); the README choices stay open ("A lighter README for the first visit", #682); the outside-feedback fixes rank between "Usability: "In short" without nesting, and the length measured again" and "Usability: the phone's sheet".
- "Usability toward 9/10" was split into one issue per step (label `usability-9`); U1, U4 and U6 were done (#639, #637, #638).
- The roadmap's heading items ("Readings left after the receives line", "One source per fact, stage SC", "Dialect levels left") were judged by their parts: each part is an issue or an entry above.
