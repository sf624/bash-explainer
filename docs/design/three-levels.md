# Three note levels

The plan to split today's warnings into errors and warnings, as VS Code and SARIF do. The levels were decided by the maintainer on 2026-10-27. Status: built (the false positives fixed, #424 and #536; step 0 done, #540; step 1a done, #547 and #549; step 1b done, #552; step 2 done, #557; steps 3 and 5 done, #558), but the postfix notes' `zero`, deferred (roadmap "Deferred"); decided 2026-10-27, revised after an independent review (PR #419). It is the roadmap's "Three note levels": next after release 0.9.0 (2026-10-31), before the panel redesign; panel P1–P2 and chrome C0–C6 start beside it (2026-10-31).

[note-levels.md](note-levels.md) is the record of what is built (#320): it had two levels of problems, `warning` and `info`, and the plain fact `note`. This plan added `error` above them. note-levels.md has taken its tables (step 5), and this page stays as the record of the change.

## 1. The levels

| Level | Mark | Word | Squiggle | Problems | When |
| --- | --- | --- | --- | --- | --- |
| `error` | ⓧ | Error / エラー | error (red) | error | The line fails every time as written. |
| `warning` | ⚠ | Pitfall / 落とし穴 | warning (yellow) | warning | Damage that cannot be undone under some values or conditions, or a failure that turns the script's own exit status into success. |
| `info` | ⓘ | Caveat / 注意 | information (blue) | information | Limited damage, only some values or systems, portability. |
| `note` | ℹ | none | none | none | A fact of how the shell runs the line. As today. |

- The word is "Error" / 「エラー」, not 「問題」: 「問題」 is the name of the Problems pane in Japanese VS Code.
- The mark ⓧ is in the same Unicode block as ⓘ, so it has the same fonts and width. It looks like VS Code's error icon (a circle with an x). An open question (section 10).
- The word follows the level at `error`, and the kind below it. Every note at `error` gets "Error:", whatever its kind: a `failure()` fact, a pitfall, a dialect issue. Today `marked()` gives a word only to a pitfall (src/messages.ts), so the `failure()` facts and dialect `unsupported` have none. At `warning` and `info`, only a pitfall gets a word, as today.
- A heading still takes the place of the word ("Shell injection risk:", "System-dependent:"). `NO_HEADING` still shows no word.
- A dialect note on a construct that works differently stays `info`, with the word "Portability" / 「移植性」.

## 2. The rule

Ask three questions, in this order. The first "yes" gives the level.

1. **Does the line fail every time, as written?** Whatever the values of its variables, the environment, the files, how the file is run, and the path taken to it. "Fail" means one of: a syntax error, a non-zero status with an error message, a command that does not run, the shell stops, or the line never does what it is written to do (a variable that is always empty there, a `**` that never reaches into subdirectories, a test that is never evaluated). If yes: **Error**.
2. **Can it do damage that cannot be undone, under some values or conditions?** Files deleted or overwritten, code that nobody read or chose runs (injection, a download run by a shell, a file found in `$PATH`), or the script stops halfway and leaves its work half done. **Or does a failure turn the script's own exit status into success**, so that its caller (cron, CI, `./script && next`) sees 0? If yes: **Warning**.
3. **Otherwise** (the damage is limited, it goes wrong only with some values or on some systems, it works differently in another shell, a failure goes unnoticed inside the script): **Info**.

A note that states how the shell runs the line, with nothing wrong, is a plain `note`.

What question 1 varies:

- **The values.** Unset, empty, with a space, a glob character.
- **The environment.** A name the script reads may come from it, exported, unless the script sets it on every path before.
- **How the file runs.** A file with a shebang is run as a program (`./script`). A file with no shebang may also be run with `bash file`, sourced inside a function, or sourced by an interactive shell (`.bashrc` and the like).

Three Errors rest on an assumed system, not on every system. They are kept for that reason, and their texts name it:

- For `sh`: `/bin/sh` is dash, as on Debian and Ubuntu (on Fedora it is bash, where `[[` works).
- For `sudo` and a path only root writes: the user is not root.
- For CRLF line ends: the file is run directly, as its shebang says. Under `bash file`, `echo hi` still runs (with a CR in its output); it is the shebang and the keywords (`then`, `fi`) that fail.

How to apply it:

- "Every time" is as far as the models know. A note at Error relies only on what the models say holds on every path (`set -u` on every path and no value on every path; `extglob` off on every path; the value `0` on every path). Where only some paths are known, the note is the "maybe" variant, at Info (`extglob-maybe-on`, `posix-special-function-name-maybe`).
- When the level depends on the case, it is a function of the params (as today). Each case is sorted by the same three questions, and the table below says which param decides.
- A note at Error must have a row in the bash test (section 8) that runs it and sees it fail, under every value, environment and way of running above. If no such row can be written, it is not an Error.
- A failure noticed inside the script only (`local x=$(false)`, a pipe without `pipefail`) stays Info. It becomes Warning only when the failure becomes the script's exit status.

## 3. The levels, one by one

Every row of note-levels.md's "Warnings" table goes to Error or Warning, and some go to Info in some cases (by params: the rows say which). Four ids were missing there; they are added (marked *new row*).

### Today's warnings

| Id | Level | Why |
| --- | --- | --- |
| `keyword-needs-separator` | Error | `then` or `do` with no `;` or newline before it is an argument: a syntax error, every time. |
| `bracket-missing-close`, `bracket-close-glued`, `test-malformed` | Error | `[` or `test` fails every time (status 2); the condition is never evaluated. |
| `find-action-refused` | Error | find refuses all its arguments (status 1) and runs nothing, whatever the values (it is not said where a word of the command has a value not known here). Built as a warning until the level exists. |
| `unset-readonly`, `unset-function-and-variable` | Error | `unset` fails every time (status 1); nothing is unset. |
| `local-outside-function` | Error only in a file with a shebang, out of a trap's action; fixed first (below) | Run as a program, `local` fails every time (bash: status 1; dash and ash stop the shell). A file with no shebang may be a library sourced inside a function, where `local` works (`f(){ source lib.sh; }; f`). A trap's action runs where the trap fires, which may be in a function. A false positive, fixed first (below). |
| `posix-special-function-name` | Error | bash stops the script at the definition, every time. |
| `alias-not-expanded-in-script` | Error only in a file with a shebang, with no code the model does not read before it; Info after such code (`unread`); fixed first (below) | A script run as a program never uses the alias: "command not found", every time. A file read by an interactive shell uses it (`bash -ic 'source file'` runs it), and the note's own text says `.bashrc` is fine. A file read with `source` may turn `expand_aliases` on. A false positive on `.bashrc` and on files with no shebang, fixed first (below). |
| `distro-alias-in-script` | By params: Error when the file runs as a script (a shebang, a host's step, a `bash -c` string); Info where `.bashrc` may have run first (`reader`: a file with no shebang, `bash -i -c`) | A script never has the distribution's alias: "command not found", every time (status 127). A file with no shebang may be read by an interactive shell (`.bashrc`), which has it. Found by step 0, fixed in #540. |
| `extglob-in-same-block` | By params: Error when the file runs as a script; Info where `.bashrc` may have run first (`reader`) | A syntax error, every time, in a script. A file with no shebang may be read by an interactive shell, which often has `extglob` on already (Ubuntu's `.bashrc` loads bash-completion, which turns it on). Fixed in #540. |
| `extglob-turned-off` | Error | A syntax error, every time. |
| `extglob-not-in-new-shell` | By params: Error; Info in a shell started with `-i` (`reader`: `interactive`) | A syntax error, every time, in a new shell that reads no `.bashrc`. `bash -i -c` reads it first, where `extglob` is often on. Found in the review of #536 and #540. |
| `globstar-unsupported` | Error | `**` never reaches into subdirectories in that shell. |
| `variable-not-in-remote-shell` | By params: Error; Info after code the model does not read (`unread`) | The variable is empty where the string runs, every time, unless code not read sets it there. |
| `variable-not-passed-by-wrapper` | Error except for the names the wrapper keeps or sets; fixed first (below) | The variable is empty where the string runs. But sudo keeps some names (sudoers(5): `env_reset` keeps `TERM` and `PATH`, `env_check` keeps `TZ`, `LANG` and `LC_*`). The detector skipped `LANG`, `HOME` and `PATH`, not `TERM` or `TZ`, nor the names sudo sets itself (`USER`): false positives, fixed first (below). |
| `variable-not-exported` | Error only when the name cannot come from the environment; fixed first (below) | `FOO=1; bash -c 'echo "[$FOO]"'` prints `[]`, but `[1]` when the parent exported `FOO`: a variable from the environment is already exported. The rule is the one of `nounset-unbound` (its `environment` param); the two disagreed on the same name. Fixed first (below). |
| `function-not-in-container`, `builtin-or-function-as-program`, `function-not-on-remote`, `function-not-in-new-shell-blocked`, `function-not-in-new-shell`, `function-not-imported`, `function-not-in-new-shell-export` | Error (`function-not-in-new-shell-export`: Info after code the model does not read, `unread`) | The function or builtin is not there: "command not found", or no effect, every time. |
| `wrapper-assignment-expanded-first`, `prefix-assignment-expanded-first` | Error | The word never sees the value it was meant to. |
| `pipeline-subshell-variable` | Error; Info when `partial` | Gone after the pipeline, every time. With `partial` (only some paths turn `lastpipe` on), only on the other paths, as `extglob-maybe-on`. **Moves down in that case (decided 2026-10-27, section 10).** |
| `redirect-by-your-shell` | Error with `file`; Info without | With `file` (a path only root writes), "Permission denied" every time it is run as meant (not as root: section 2). Without it, only when the file is root's, and nothing is damaged (`sudo dmesg > out.txt` works). **Moves down in that case (decided 2026-10-27, section 10).** |
| `shebang-refused` | Error | Run directly, the script never starts. |
| `shebang-bom` *new row* | Error | The first line is no shebang, and runs as a command that is not found, every time. |
| `bats-tags-invalid` *new row* | Error | bats runs none of the file's tests, and fails. It is one of the 8 `failure()` facts. |
| `bats-test-line-dropped` *new row* | Error | The code before the test's name never runs. |
| `bats-negation-ignored` | Error | The line never fails the test: the assertion is dead. |
| `bats-run-in-pipeline-stage`, `bats-run-in-pipeline` | Error | `$status` and `$output` are gone, or the pipe reads nothing, every time. |
| `bats-setup-suite-in-test-file` *new row* | Error | bats never calls it (and warns BW03). |
| `regex-backslash-dropped` | Error | The regex never means what is written. |
| `python-string-without-shell` | Error | Python runs the whole string as one program name: FileNotFoundError, every time. |
| `nounset-unbound`, when a shell exits, or the command fails and `set -e` stops the shell | Error; Warning when `environment` | Under `set -u`, the shell stops there every time. With `environment` (the name may come from the environment), only when the environment lacks it: then the script stops halfway. |
| `nounset-unbound`, when only the command fails | Error; Info when `environment` | `set -u; cat < "$f"` says "f: unbound variable", `cat` does not run, and the script goes on. That is a failure every time, by question 1. With `environment`, only when the environment lacks it, and the script goes on: limited damage. **Moves up from Info.** |
| `function-last-test-stops-script` | Warning | Not every time: only when the test is false. Then `set -e` stops the script halfway, and a test is written to be false sometimes. |
| `postfix-increment-status`, `postfix-decrement-status`, when `set -e` surely stops there (`errexit`) | Error when the value is 0 on every path; Warning otherwise. **Not built in step 2** (below, section 7): Warning in every case for now | `set -e; i=0; ((i++)); echo after` stops with status 1 and prints nothing, every time. A new param, `zero`, from the value model, says the value is 0 on every path. Otherwise only when the value is 0 (often the first run); then the script stops halfway. |
| `python-shell-injection`, `actions-script-injection` | Warning | A value can run any command. |
| `unquoted-variable-as-path` given to `rm`, `mv` or `cp` (`destroys`, no `known` value) | Warning | Only some values; a split or globbed path deletes or overwrites other files. |
| Style: `bracket-no-space`, `assignment-with-spaces`, `brace-no-space`, `brace-close-no-separator`, `redirect-in-bracket`, `and-or-in-bracket` | Error | The line does not do what it says, every time (`[-f x]`, `x = 1`, `{echo`, `[ a > b ]` also writes a file `b`). |
| Style: `bracket-close-in-word` | Error only when the part before `]` is never empty; fixed first (below) | The check fires on words whose value is not static (src/pitfalls.ts). With an empty value, `"$x"]` becomes `]`, and the test runs: `x=""; [ -z "$x"]` is true, and `[ -n "$x"]` is wrongly true. So it is an Error only when the model knows the part is not empty on every path. The text's "missing ']'" is wrong for an empty value, and is reworded in the fix (below). |
| Style: `rm-empty-variable-root` | Warning | With an empty variable, `rm -r` deletes from the root. |
| Style: `download-run-by-shell` | Warning | A script nobody read runs (`curl … \| sh`). |
| Dialect: `unsupported` | Error | The construct fails in the target shell, or the bash release lacks it (`laterOption`, `funsubBrace`). For `sh`, as decided in section 10: Error only when dash or busybox ash lacks it, Info ("Portability") where both run it (sections 2 and 10). |
| Problem: `crlf` | Error where it fails every time; Warning otherwise (step 1a, review of #549) | Run directly (section 2), the shebang's interpreter gets a CR; `then` and `fi` before a CR are not found however the file runs; a CR where a command starts (a blank line, or after `;`, `&&`, `\|\|`, `\|` or `&`) is a command, `$'\r'`, not found however the file runs (step 1b, review of #549). A file whose CRs only end words runs (`echo hi\r` prints a CR): `crlfMaybe`, a Warning. |
| Problem: `pythonNoShell` (host code of `python-string-without-shell`) | Error | As the note. |
| Problem: `injection`, `pythonInjection` (host codes) | Warning | As the notes. |

### Five false positives, fixed first

Five checks headed for Error fired where bash does not fail (checked in bash 5.2.21): `bracket-close-in-word`, `alias-not-expanded-in-script`, `local-outside-function`, `variable-not-exported` and `variable-not-passed-by-wrapper`. They were fixed before this plan moves any level: Error only in the cases that fail every time, as the rows above say. The other cases get the level of the three questions, or no note.

- **Fixed by #424** (2026-10-27), the cases the review found: no alias note in a file with no shebang (a caveat instead), `local` in such a file a caveat, the names sudo keeps (`TERM`, `TZ`, `LANG`, `LC_*`…), a variable that may come from the environment exported (a caveat in capitals, a clause in lower case, as `nounset-unbound`), and `"$x"]` that closes `[` when `$x` is empty (its own text). test/pitfall-contradictions.test.ts runs each in bash.
- **Fixed by #536** (2026-10-31), a second pass under the ways of running, the environments and the code a model does not read (section 2): an alias in a `#!/bin/bash -i` script (an interactive shell; the shebang now turns `expand_aliases` on), or with a function of that name (it runs; defined on some paths only, a caveat, param `fn`); `local` in a trap's action, which runs where the trap fires, in a function or not (a caveat, param `trap`: a DEBUG or ERR trap set in a function stays set once it returns); the names sudo, doas and `su -l` set themselves (`CommandSlot.sets`, read by `variableIn` and the child shell's start: `HOME`, `USER`, `SUDO_USER`…, also for `nounset-unbound`; `sudo -E` sets the `SUDO_*` ones). In the same test file.
- **Code the model does not read, one rule (#536, after its review).** A path before here that ran such code (`ShellState.opaque`: a file read with `source` or `.`, an `eval` or a trap's action of text not known, another shell's startup files) may have turned on what the walk read as off. The model says so in one place, `unlessUnread` (src/semantics/shellstate.ts): `off` becomes `unread`. Its readers: `resolveName` marks an alias not expanded, and a function not exported to another shell, as a miss that may not happen (`Missed.maybe`); another shell started after such code is itself `opaque` where the variables reach it (src/semantics/walk/child.ts), so a variable it lacks may be set there, as after its own `source`. Each check headed for Error that says such a thing is off (`alias-not-expanded-in-script`, `variable-not-exported`, `variable-not-passed-by-wrapper`, `variable-not-in-remote-shell`, `function-not-in-new-shell-export`) is then Info, with the shared param `unread` and one clause of the catalog (`unreadClause`, src/messages-common.ts), which the alias's token and the name's hint take too. An array is never exported, whatever that code does: still Error. Before that code, or on the line that runs it (bash reads the whole line first), the check stays at its level.
- **Left, accepted:** `[ -f *]` says "missing `]`", but a file named `]` makes `*]` match it and close `[`; a string run with `BASH_ENV` set reads that file, which the child's model does not walk; a container's image may set any variable (`docker run img sh -c 'echo $x'`). Step 0 decided (below): each keeps its row at Error.

### Info rows that move up

| Id | Level | Why |
| --- | --- | --- |
| `failure-reported-as-success` | Warning | The failure becomes a status of 0: the function's, the script's, or the script goes on past it under `set -e`. |
| Style: `source-searches-path` | Warning | A file of that name in a directory of `$PATH` runs instead: code nobody chose, with the script's rights. |
| `nounset-unbound`, when only the command fails | Error; Info when `environment` | Above. |

Every other Info row of note-levels.md stays Info: `declaration-masks-status`, `pipefail-missing`, `dockerfile-pipefail-missing`, `function-last-test-returns-status`, `script-last-test-returns-status`, `posix-special-function-name-maybe`, the postfix notes without `set -e`, `extglob-maybe-on`, `extglob-maybe-on-trap`, `extglob-not-found`, `globstar-maybe-on`, `globstar-not-found`, `ssh-local-expansion`, `function-not-imported-sh`, `unmatched-glob-runs-once`, `for-over-ls-output`, `for-over-unquoted-args`, `array-joined-in-assignment`, `unquoted-variable-as-path` for other commands, `unquoted-variable-in-test`, the style checks `read-without-r`, `trap-goes-on`, `pattern-from-variable`, and dialect `behaviour`. The three that stay notes (`notProblem`) stay so.

### Plain notes that state a failure

Some plain notes say a command fails: `function-defined-later` with `runs: 'none'` (`main_later` called before its definition: "command not found"), `alias-defined-same-unit` and `alias-defined-later`. They stay plain notes in this plan. A program or builtin of that name may run instead, so the line need not fail. A level by params (no other command of that name known) can come later.

### Counts

| Source | Before | After |
| --- | --- | --- |
| Catalog (65 entries with a level: the 64 of the plan, and `find-action-refused`) | 42 warning, 19 info, 4 by params | 28 error, 4 warning, 18 info, 15 by params |
| Style checks (13) | 9 warning, 4 info | 7 error, 3 warning, 3 info |
| Dialect issues | `unsupported` warning, `behaviour` info, `parse` note | `unsupported` error, `behaviour` info, `parse` note |
| Other problems | `crlf` warning | `crlf` error |

The catalog's levels by params, after: `postfix-increment-status`, `postfix-decrement-status` (error, warning or info), `unquoted-variable-as-path` (warning or info), `nounset-unbound` (error, warning or info), `pipeline-subshell-variable` and `redirect-by-your-shell` (error or info), and the nine whose fix split them into cases (error or info): `local-outside-function`, `alias-not-expanded-in-script`, `distro-alias-in-script`, `extglob-in-same-block`, `extglob-not-in-new-shell`, `variable-not-exported`, `variable-not-passed-by-wrapper`, `variable-not-in-remote-shell`, `function-not-in-new-shell-export`. Before, the first four were warning or info, and the last two always warning.

The 37 errors the plan counted, the 8 `failure()` facts (`find-action-refused`, added on 2026-10-28, among them) and 29 pitfalls, are 28 now: 9 of the 29 pitfalls are by params. The 4 warnings: `function-last-test-stops-script`, `python-shell-injection`, `actions-script-injection`, `failure-reported-as-success`.

The checks fixed first (#424, #536, and `distro-alias-in-script`, `extglob-in-same-block` and `extglob-not-in-new-shell` in #540) are counted by params here: each was split into the cases that fail every time (Error) and the others (Info).

## 4. Where the level comes from

One source per kind of note, as today. What changes in each:

- **The catalog** (src/messages.ts). `NoteLevel` becomes `'error' | 'warning' | 'info' | 'note'`. One table of the levels replaces `MARKS` and `PITFALL_WORD`: per level, its mark, its word (ja/en), its name for the Problems pane and screen readers (エラー・警告・情報・補足 / Error, Warning, Information, Note), its codicon (`error`, `warning`, `info`) and its ANSI colour. Every view reads that table; none has its own list. `failure()` makes a fact at `error`. A pitfall that fails every time keeps its kind and gets the level `error` (`pitfall(refs, text, heading, 'error')`). `marked()` gives the word to every note at `error` (section 1). `severityOf` returns `'error' | 'warning' | 'info'`. The texts that start with their own "Syntax error:" lose it, since the word now says "Error:": `keyword-needs-separator` (src/messages.ts) and `funsubBrace` (src/bashversion.ts, "Syntax error (bash 5.3):"). Both change level in step 1a, so they are reworded there.
- **The style checks** (src/pitfalls.ts): `STYLE_LEVELS` takes the new values.
- **The dialect issues** (src/dialect.ts): `unsupported()` makes a note at `error`, with the word "Error:".
- **Functions of the params**: as listed in section 3. `postfixLevel` gets the new param `zero`. `nounset-unbound`, `pipeline-subshell-variable` and `redirect-by-your-shell` get one each, from params they already have (`environment`, `partial`, `file`).
- **Other problems**: `crlf` (src/document.ts) is an `error`. The host codes take the level of their fact (`severityOf`), as today.
- **Said with the pitfalls off.** An Error is said whatever `notes.pitfalls` says, as a failure is today: `said()` keeps a fact at `error`, and the analyzer runs the style checks at `error` when the pitfalls are off. `diagnostics.pitfalls` off leaves out the Warnings and Infos of the explanations; the Errors stay problems, as the dialect issues do.
- **`DocumentIssue.pitfall`** stays on the Warnings and Infos of the explanations only. It no longer decides what fails `--check` (section 6); it gives the annotations their title.

## 5. Every output

| Output | Today | After |
| --- | --- | --- |
| VS Code squiggles and Problems (src/ui/diagnostics.ts) | Warning or Information | `DiagnosticSeverity.Error` for an error. VS Code then shows the file's name in red in the explorer and its tab (`problems.decorations`). |
| Language Server (cli/lsp.ts) | severity 2 or 3 | 1 for an error |
| Panel (media/panel.js, media/panel.css) | codicon, bold word and left border in the level's colour; icon named 警告・情報・補足 | the `error` codicon, "Error" / 「エラー」 and the border in the error colour. The icon's name comes from the catalog's table; where the word says the same ("Error"), the icon is hidden from screen readers, so the name is said once. With forced colours an error's border is double, a warning's dashed, so all three differ without colour (and by the icon's shape). The copy of the line underlines errors in red (`squiggle-error`). |
| Hover (src/ui/hoverView.ts) | `$(warning)`, `$(info)` in the level's colour | `$(error)` in the error colour |
| Order of notes (`notesByLevel`) | warnings, information, notes | errors first |
| Copy as Markdown, the Language Server's hover | `> ⚠ **Pitfall:** …` | `> ⓧ **Error:** …` |
| CLI explanation (cli/main.ts) | mark and word in yellow (33) or blue (34) | red (31) for an error |
| CLI `--help` (cli/main.ts) | `--check` exits 1 "if there is a warning (other than on a pitfall)"; `--strict` "also … on a pitfall" | on an error; `--strict` also on a warning |
| `--check` text | `file:1:1: warning: … [code]` | `error:` in red |
| `--check` JSON | `severity`: `warning`, `info` | also `error`. The explanation's JSON gives `level: "error"` in `facts`. |
| SARIF | `warning`, `note` | also `error` |
| `--check` exit status | 1 on a warning that is no pitfall, or on any warning with `--strict` | 1 on an error, or on a warning with `--strict` (section 6) |
| GitHub annotations (`--format github`) | `::warning`, `::notice`; title "(pitfall)" on notes | `::error` for an error, shown first. "(pitfall)" stays on the Warnings and Infos of the explanations. |
| GitHub Action (action.yml) | `warnings` counts the `::warning` lines that fail the step; `pitfalls` counts the annotations titled "(pitfall)" | `warnings` counts the `::error` lines, and the `::warning` lines with `strict`. A new output `errors`. `pitfalls` gets smaller: an Error has no "(pitfall)" title, so `x = 1` and the other new Errors no longer count there. The Action knows a CLI that has errors from its `--help` (the new text above), as it already does for `--strict` and `--sarif`; with an older CLI (a `package:` pin) it counts as before. |
| Web page's editor (web/editor.ts) | CodeMirror lint `warning`, `info`; our wavy underline and gutter icon | also `error`, with the `error` codicon (media/icons.js) and `--c-error-level` |
| Web page's Problems list (web/problem-list.ts) | ⚠ and ⓘ, named Warning and Information | ⓧ, named Error / エラー |
| Web page's line summary for screen readers (web/a11y.ts) | "; 2 warnings" | "; 1 error, 2 warnings" / 「エラー 1 件、警告 2 件」 |
| Settings' descriptions (src/settings.ts, package.nls.json, package.nls.ja.json) | two levels; `--check` fails "only with `--strict`" | three levels, and what fails `--check` |
| README, README.ja.md, cli/README.md, action.yml | two levels (README.ja.md: the problems paragraph and the two `pitfalls` settings) | three levels, and what fails `--check` |

### Colours

The error colour is the editor's own, `editorError.foreground`: the colour of its squiggles and of the Problems pane's icon. Where it falls below 4.5:1 as text (7:1 in high contrast), ours, keeping the hue: `LEVEL_COLOURS` in src/ui/palette.ts, `--c-error-level` in media/panel.css, `--vscode-editorError-foreground` in web/theme.css. VS Code 1.143's defaults: #f14c4c dark, #e51400 light, #f48771 high contrast, #b5200d high contrast light.

test/contrast.test.ts measures the levels against every background of a theme kind: in high contrast, black and the code block #1f1f1f.

| Theme kind | Error |
| --- | --- |
| Light | #d0020f, as `ERROR_COLOURS` (#e51400 is 4.23:1 on a code block) |
| Dark | #fd6358, as `ERROR_COLOURS` (#f14c4c is 3.96:1 on a code block, #2b2b2b) |
| High contrast | ours: #f6937e (7.37:1 on #1f1f1f, 9.39:1 on black). The theme's #f48771 is 8.55:1 on black but 6.71:1 on the code block. |
| High contrast light | ours: #9b1c0b (8.19:1 on white, 7.31:1 on #f2f2f2). The theme's #b5200d is 6.61:1 on white. |

The panel's `--c-error` (a part that cannot be read) already has these values in light and dark. In high contrast it has the same gap today, and the test skips it; step 1b gives it the same colour and measures it. The level is not a role of the palettes, so the three modes of `bashExplainer.panel.colors` show it alike ([theme-colours.md](theme-colours.md)).

## 6. Compatibility

Decided: an Error fails `--check` by default, as a dialect issue or `crlf` does today. A Warning fails only with `--strict`. An Info never fails.

What fails `--check` (and the Action) now, without `--strict`, that did not:

- The 8 `failure()` facts: `[` without `]`, `]` glued to a word, `test` it cannot read, `then` or `do` with no separator, `unset` of a readonly variable, `unset -f -v`, `bats-tags-invalid`, and `find-action-refused`. Today they are marked as pitfalls in the problems (`noteIssues`, src/document.ts), so they do not fail.
- The 20 pitfalls of the catalog that move to Error (section 3), the Error cases of the 9 split by params (`local-outside-function`, `alias-not-expanded-in-script`, `distro-alias-in-script`, `extglob-in-same-block`, `extglob-not-in-new-shell`, `variable-not-exported`, `variable-not-passed-by-wrapper`, `variable-not-in-remote-shell`, `function-not-in-new-shell-export`), and the Error cases of `nounset-unbound`, the postfix notes, `pipeline-subshell-variable` and `redirect-by-your-shell`.
- The 7 style checks at Error: `[-f x]`, `x = 1`, `{echo`, `{ echo }`, `[ a > b ]`, `[ -f $x]` (when not empty), `[ a && b ]`.

What no longer fails without `--strict`:

- `injection` (a GitHub Actions expression in `run:`), `pythonInjection` and `pythonNoShell`. They are host problems with no `pitfall` mark, so they failed before 1a. They are Warnings, like the other pitfalls (decided, section 10, item 6), and fail only with `--strict` (the Action's `strict: 'true'`). `pythonNoShell` moved to Error in step 2 (#557), so it fails as before.
- `crlf` where bash runs the file: no CR on the `#!` line, no keyword before a CR and no CR where a command starts (a Warning, step 1a).
- With the `sh` decision of section 10: `local`, `echo -n`, `read -p` and `set -E` in a `#!/bin/sh` script become Info, and fail no more, even with `--strict` (done in step 1a).

Unchanged: every other Warning fails only with `--strict`; Info never fails; dialect `unsupported` where the shell lacks the construct (in `sh`, where dash or busybox ash lacks it), and `crlf` where it fails every time, fail by default, as before.

Other changes users can see:

- `notes.pitfalls` and `diagnostics.pitfalls` off no longer hide an Error.
- The Action's `fail-on-warning: 'false'` lets errors pass too: it sets the step's status to 0 on any failure of `--check` (action.yml).
- The Action's `pitfalls` output gets smaller (section 5). Our own CI pins it (`test "$PITFALLS" = 2` in .github/workflows/test.yml); step 3 changes that job.
- SARIF has `error` results. GitHub's code scanning fails its "Code scanning results" check on a new `error` alert by default (a repository can change the threshold); it blocks merging where a ruleset or branch protection requires that check.
- JSON and the Language Server give `error`.
- VS Code shows a file with an error in red in the explorer and its tab.

### Releases

Proposed: steps 1a to 3 go into one release, with no release between them. Each step changes what fails users' CI, so one release changes it once. Step 1a writes the CHANGELOG note; steps 1b, 2 and 3 complete it. If a release must come between them, each step writes its own line instead.

A draft of the CHANGELOG's compatibility note (step 1a, completed by step 3):

- Problems have three levels: Error (red) for a line that fails every time as written (`[-f x]`, `x = 1`, a construct the shell lacks), Warning (yellow) for a pitfall, Info (blue) for a caveat. `--check` and the GitHub Action fail on every error without `--strict`; a pitfall fails only with `--strict`. Before, errors such as `x = 1` were pitfalls and failed only with `--strict`, and a script injection in a workflow failed without it.
- `bashExplainer.notes.pitfalls` and `bashExplainer.diagnostics.pitfalls` off no longer hide errors. The Action's `fail-on-warning: 'false'` lets errors pass too, and its `pitfalls` output no longer counts them.

## 7. Steps

Each step is one PR that keeps every test passing, with 100% coverage in CI. Each updates note-levels.md for what it builds, and this page's status in docs/design/README.md.

0. **The bash inventory**, before any level moves. It comes after the fix of the five false positives (#424, #536). The bash test of section 8, with a row for every check headed for Error: today's warnings, and the Info cases that move up. Each row runs under the values, the environment and the ways of running of section 2. A row that does not fail every time is a finding: fix the check, or plan a lower level, before step 1a. No level changes, so no CHANGELOG.
   - **Done (#540):** test/error-level.test.ts, 54 rows over the 51 ids of section 3 (`HEADED_FOR_ERROR`; the test fails on an id with no row). Each row is run directly, with `bash file`, sourced in a function and sourced by an interactive bash (`bash --norc -i`) after a stand-in `.bashrc` of what a distribution's gives, its aliases and the `shopt -s extglob progcomp` of bash-completion, and no system file (`/etc/bash.bashrc` would print Ubuntu's banner and install a `command_not_found_handle` that runs Python; `--rcfile` still reads it on Debian and Ubuntu) (two ways for the rows that rest on the shebang, one for `shebang-refused` and `crlf`), with the names it reads unset, empty, `a b`, `*` and `x`, exported; in bash 5.2, and also in bash 5.3 when `$BASH_EXPLAINER_BASH53` is set (not the rows of a 5.3 construct, which rest on bash 5.2). `ssh`, `docker`, `sudo` and `su` are stand-ins that run the command in `env -i` (sudo's with the names it keeps). A row runs only where its program is (dash, bats, python3) and its assumed system holds (`/bin/sh` is dash, the user is not root); no row is a gap. `unsupported` has two rows (`[[` in sh, `${ …; }` for bash 5.2); test/dialect.test.ts runs every feature in every installed shell.
   - **The three cases left, accepted (section 3), decided:** each keeps its row at Error, as none is representative usage. `[ -f *]` fails unless the directory holds a file named `]`. A `BASH_ENV` the script sets is read already: the string's model is then `opaque`, and no note is said; one from the caller's environment is accepted, as any startup file the environment may name. A container's image may set a variable of the same name as the script's (`docker run img sh -c 'echo $x'`): accepted, since the note says the script's value does not reach the container, which holds whatever the image sets.
   - **Findings.** `distro-alias-in-script` fired at Warning in a file with no shebang, where an interactive shell that reads it (`.bashrc`) has `ll`: fixed in #540 (a caveat there, as `local-outside-function`). So did `extglob-in-same-block`, where that shell often has `extglob` on (bash-completion turns it on): fixed in #540 the same way; its shebang row runs the two ways of a program. A new shell started with `-i` reads `.bashrc` first too (`bash -i -c ll`, `bash -i -c 'echo !(x)'`, which run fine): `distro-alias-in-script` and `extglob-not-in-new-shell` are caveats there (`bashrcReader`, param `reader`), and two cases run them every way; `bash --norc -i -c` and `--rcfile F` read none (nothing), and `#!/bin/bash -i` starts the file's own shell interactive (a caveat too). `crlf` in a file with no shebang and no keyword (`echo hi` with CRLF) runs with `bash file` (a CR at the end of the output): the test keeps it as a finding; planned: Error only with a shebang, or a keyword before a CR, and Warning otherwise, decided before step 1a.
1. **The level, on the facts that fail.** Planned in two PRs from the start; each stays green on its own.
   - **1a. The catalog and the problems.** `error` in `NoteLevel`, the table of levels (section 4), the word at `error` for every kind, and the problems: diagnostics, Language Server, CLI (`--check`, JSON, SARIF, annotations, `--help`), the Action (its `--help` check, `errors`). At `error`: the 7 `failure()` facts (`bats-tags-invalid` among them), dialect `unsupported` and `crlf`. The rewording of `keyword-needs-separator` and `funsubBrace`. The new rule of `--check` and the Action, and the settings that no longer hide errors (descriptions, package.nls.json, package.nls.ja.json). The Action's CI job: a script with an error fails without `strict`. CHANGELOG: the compatibility note of section 6.
   - **Added 2026-10-31 ([sources.md](sources.md), SB1):** the table of levels carries every output mapping: the severity of VS Code, the Language Server, SARIF, GitHub annotations and CodeMirror; the ANSI colour, the codicon, the glyph, the rank, the palette variable, the word and the accessible name. Every view reads it (1a builds it, 1b moves the views onto it), and the guard SA4 (level literals outside the table) ends with an empty known list. The CLI emits the counts the Action needs, so action.yml stops counting failures by grepping titles. Chrome C2 starts after it.
   - **Done (#547, #549), in two PRs of a stack.** #547: the level table, src/levels.ts (`LEVELS` per note level, `SEVERITIES` per problem severity, `hint` included), read by every output; the levels of the style checks and the other problems beside the catalog (src/messages-levels.ts); the style sheets' level rules written from the table (scripts/level-css.ts); the SA4 known list empty; no visible change. #549: `error` in the table and at the 11 `failure()` facts of the catalog (the 8 of section 6 and `assign-readonly`, `restricted-refused`, `exit-refused`, each with a new row in the bash test), dialect `unsupported`, and `crlf` (an error where a CR ends the `#!` line or a keyword stands before a CR, a warning with a text of its own otherwise: review of #549, a file whose `#!` line ends in LF runs, with a row in the bash test); in `sh`, Info "Portability" for a construct dash and busybox ash run (step 4, done here: review of #549); the word "Error:" for every kind; the two texts reworded; `said` and the problems keep errors with the pitfalls off; the CLI's exit status (`failsCheck`), `--counts <file>` and its `--help`; the Action's `errors` output and its counts from the CLI (an older CLI: as before); the CI job; the settings' descriptions; CHANGELOG. Until 1b, the error row shares the warning's codicon, class and colour, so the views show an error as a warning (but with ⓧ, "Error:" and its name); the CLI already prints it in red (31).
   - **1b. The views.** Panel, hover, CLI explanation, the web page's editor, Problems list and screen-reader summary, with the colours (high contrast too) and their contrast test. README, README.ja.md, cli/README.md. Between 1a and 1b, a view shows an error as a warning.
     - **Noted in the review of #549, decided:** a problem said its level twice, `file:2:1: error: Error: …` (the CLI), and so did the annotations, SARIF and the Problems panel, which show the severity themselves. The problem outputs (CLI, annotations, SARIF, JSON, the Problems panels, the web page's Problems list) leave out the word of a level that the table says on every note (`problemText`, from `namesLevel`), and the explanations, the hover and Copy as Markdown keep it, where nothing else names the level. "Pitfall:", "Caveat:", "Portability:" and the headings stay. Done in 1b.
     - **Done (#552).** The table's `error` row has its own codicon (`error`, copied into media/icons.js), class (`level-error`) and colour (`--vscode-editorError-foreground`, `--c-error-level`, ours in all four theme kinds: section 5, "Colours"); `ERROR_COLOURS` (src/ui/palette.ts) reads them, so the panel's `--c-error` has them in high contrast too, and test/contrast.test.ts measures both, no kind skipped. With forced colours an error's border is double, a warning's dashed. Where a note's word names its level ("Error:"), the panel's icon has no name (`aria-hidden`), so a screen reader says it once. The panel, the hover, the CLI explanation, the web page's editor (squiggle, gutter, tooltip), its Problems list and its screen-reader summary show it; each has a test that fails on 1a's look. Also from the review of #549: `crlf` is an error where a CR starts a command (a blank line, `echo a;\r`, `a &&\r`: `$'\r': command not found`), with rows in the bash test; a keyword before a CR is a reserved word of a compound command only (the `}` of `${HOME}`, `{a,b}` is a word's: a warning, with rows in the bash test); the text on the `#!` line says the interpreter is not found, with no quoted message (env says `'bash\r': No such file or directory`).
2. **The catalog's pitfalls that fail every time** move to Error: the 29 ids, and the functions of the params of `nounset-unbound`, the postfix notes (`zero`), `pipeline-subshell-variable` and `redirect-by-your-shell`. Each has its row in the bash test from step 0. CHANGELOG: the details file lists them. Between 1a and this step, `pythonNoShell` is a Warning and passes `--check` without `--strict`, where it failed before 1a: so steps 1a to 2 must ship in one release.
   - **Done (#557), but `zero`.** The 20 ids at Error in every case are `broken()` in the catalog (a pitfall at `error`); the 9 split by params, `nounset-unbound` (Error unless the name may come from the environment, `environment` `maybe` or `unlikely`: then Warning where a shell stops, Info where only the command fails), `pipeline-subshell-variable` (Info with `partial`) and `redirect-by-your-shell` (Error with `file`, Info without) are functions of their params; `pythonNoShell` takes the level of its fact. The bash test asserts the level of every row (`error`, but the style checks, for step 3). A name in lower case that the environment may still give (`environment: 'unlikely'`: `x=1; bash -c 'echo "$x"'` prints the environment's `x`) is no Error, by question 1 (section 2), as test/pitfall-contradictions.test.ts shows in bash: `variable-not-exported` keeps its warning with a clause, and `nounset-unbound` takes the levels of a name in capitals.
   - **From the review of #557, fixed in it.** Two cases where bash does not fail: a function that has the name of a program the dictionary knows (`ls() { command ls -F "$@"; }`, then `sudo ls`, `bash -c 'ls /'`, `ssh host ls`): the program runs there, so the note is a caveat of its own, `function-shadowed-by-program`, not one of the four `function-not-*` errors; and the variables the far side sets or may be sent: sshd's `HOME`, `USER`, `LOGNAME`, `MAIL`… and a container runtime's `HOME`, `HOSTNAME`, `PATH` (`CommandSlot.sets`: no note), `LANG` and `LC_*` that Debian's and Ubuntu's ssh sends and accepts, and a name of `ssh -o SendEnv=` (`CommandSlot.maySend`: a caveat, `sent`). The texts of these notes moved to src/messages-wrappers.ts. **From the second review, fixed in it:** the caveat is for a function that runs the program of its name (`runsOwnName`, src/semantics/names.ts); one that only has the name is a warning, as another program runs (`sudo install`, `timeout 300 sync`). ssh sends only exported variables, so `sent` needs one; and the spec of ssh's `-o` reads the names of `SendEnv` (`ValueSpec.sendsEnv`, src/dict/netadmin.ts), separated by blanks as ssh_config(5) says, and checked with `ssh -G`.
   - **Left open: the postfix notes' `zero`.** The state model cannot say that `i` is 0 before `((i++))` on every path: decisions trust no variable whose name is in arithmetic text (docs/design/semantics.md, 4.14, "A variable is trusted"), and a counter always is. Building `zero` needs the trust to allow a name that only arithmetic the walk follows assigns (`(( ))`, `let`, `$(( ))`, `for (( ))`; not a subscript, an offset or an integer's value), with its row in src/semantics/allow.ts and a check in test/decisions.test.ts. Until then the postfix notes keep their levels (Warning under `set -e`, Info otherwise), and their rows in the bash test assert `warning`.
   - **Not in section 3:** three warnings of the catalog came after this plan and have no row there: `posix-function-name` (POSIX mode, bash 5.2), `posix-special-builtin-error` and `unbraced-element`. They stay warnings until they are sorted by the rule, each with a row in the bash test if it moves to Error.
3. **The style checks and the two caveats that move up.** `STYLE_LEVELS`: 7 to Error, `source-searches-path` to Warning; `failure-reported-as-success` to Warning. The style checks at Error run with the pitfalls off. The Action's CI job writes `x = 1` today as the pitfall that passes without `strict`: it fails now, so the job takes `curl -s "$u" | sh` (Warning) and `read line` (Info) instead, and its pinned counts change.
   - **Done (#558).** The 7 style checks are at Error, each with its rows in the bash test (step 0's), which now asserts `error`: `[-f x]` and `[[-f x]]`, `x = 1` and `x =1`, `{echo`, `{ echo }`, `[ a > b ]`, `[ a && b ]` and `[ a || b ]`, and `"$x"]`. `bracket-close-in-word` is an Error only where the part before `]` is never empty, as section 3 says; where it may be empty, a Warning (`STYLE_LEVELS`, src/messages-levels.ts, whose entry is then a function of the check's case, as the catalog's levels are of their params): `[ -z "$x"]` is true with an empty value, as meant (a test in the bash test runs it), so it does not fail every time, but `[ -n "$x"]` is then true too, and can guard what cannot be undone (`[ -n "$d"] && rm -rf "$d"/*`), by question 2. `redirect-in-bracket` is said only where the redirection stands for a comparison (`comparisonAt`, src/pitfalls.ts): to a number, or where the test, read by bash's grammar once it is escaped, has it as a comparison's operator (`operatorFits`, src/testexpr.ts, in either release); elsewhere it is meant (`[ "$n" -gt 0 2>"$log" ]`, `[ -t 0 < "$tty" ]`), and the bash test runs those as written. `source-searches-path` and `failure-reported-as-success` (all its cases, `errexit` too, decision 5) are Warnings. The style checks at Error are said with the pitfalls off (decision 7), by the rule the facts follow: one function, `pitfallSaid` (src/messages.ts). The Action's job: `curl -s "$u" | sh` and `read line` pass without `strict` and fail with it (`errors` 0, `warnings` 1, `pitfalls` 2), and the script with errors takes `x = 1` as a second error beside `unset` of a read-only variable, and `read line` as its pitfall (`errors` 2, `warnings` 2, `pitfalls` 1).
   - **Noted, accepted:** `[ a < b ]` makes no comparison either (it reads the file `b`); when that file exists and `[ a ]` happens to be the meant result, the line's outcome is right by chance. The comparison is still never made, a failure by section 2 ("a test that is never evaluated"), so it stays an Error.
4. **Dialect issues in `sh`** (section 10): Error only where dash or busybox ash lacks the construct, Info ("Portability") where both have it. **Done in step 1a** (review of #549: `local` at Error was a false Error).
5. **The record.** note-levels.md gets the three levels as built; the row in docs/design/README.md says "Built"; the roadmap item moves to "Done lately". **Done (#558),** with step 3.

## 8. Tests

- **The bash test** (new in step 0, test/error-level.test.ts): every id and style check that can be at Error has at least one row, or the test fails (an inventory, like the probes). A row is a short script that our explanation says the note on, at Error. The test runs it in bash 5.2 (and in bash 5.3 from `$BASH_EXPLAINER_BASH53`, when set). It varies three things (section 2):
  - the values of the variables it reads: unset, empty, `a b`, `*`;
  - the environment: each name it reads also exported from the parent;
  - how the file runs: directly (with its shebang), with `bash file`, sourced inside a function, and sourced by `bash -i`. A row whose Error rests on a shebang runs only directly; one that rests on an assumed system (section 2) says so.

  It checks that every run fails: a non-zero status, an error message, the shell stops, or a marker of the effect is missing (`echo x | read v; echo "[$v]"` prints `[]`). Each run is in a temporary directory of its own, in a cgroup (`systemd-run --user --scope -p MemoryMax=… -p TasksMax=…`), with `FUNCNEST` set, spawned detached and killed as a process group on a timeout (CLAUDE.md).
- **Rows that need another program**: dash and busybox ash for the dialect (test/dialect.test.ts already re-checks the installed shells); bats-core for the bats ids (as test/bats-real.test.ts); python3 for `python-string-without-shell`. For `ssh`, `docker` and `sudo`, the string runs in `env -i bash -c`, which lacks what the remote shell, the container or the new shell lacks; sudo's kept names (`TERM`, `TZ`, `LANG`, `LC_*`, `PATH`) are passed in. A row that cannot run is a gap with its reason, and the test pins the number of gaps.
- **The other way**: each row at Warning or Info has a value under which the line works (`rm -rf $DIR/*` with `DIR=/tmp/x`; the test true). So a lower level is no hidden Error.
- test/messages.test.ts pins the catalog's levels; test/note-data.test.ts checks that each note starts with its level's mark (ⓧ too), and that every note at `error` has the word; `plain()` strips ⓧ.
- test/contrast.test.ts measures the error colour in the four theme kinds, on every background, and the panel's `--c-error` in high contrast too.
- The CLI tests: `error:` in the text, `"severity": "error"` in JSON, `"level": "error"` in SARIF, `::error` annotations, the `--help` text, and the exit statuses: an error alone gives 1; a warning alone gives 0, and 1 with `--strict`; an info gives 0.
- The Language Server's test: severity 1. The integration test: `DiagnosticSeverity.Error`. The web tests: the Problems list's icon and its name, the lint class, the colour.

## 9. Risks

- **A false Error.** Red on a line that works is worse than yellow, and now it breaks CI. The review found five (section 3); they are fixed first, and the bash test of step 0 runs every Error under the values, the environment and the ways of running. A note at Error relies only on what the models know on every path, and trust (src/semantics/trust.ts) still applies: a blind script gets no Error from a value it cannot know.
- **CI breaks on upgrade.** Users of the Action or `--check` get failures they did not have. The CHANGELOG says so, and `diagnostics.ignore` or `# bash-explainer disable=` turn a code off.
- **Code scanning blocks merges** on SARIF errors, by GitHub's default threshold (section 6).
- **Red beside red.** The error colour is close to the variable's colour: #d0020f for both in the light classic palette, and #fd6358 beside #ff5c65 in the dark one. The icon and the word tell them apart. To check with screenshots, with forced colours too.
- **Red and yellow for colour-blind users.** The icon's shape and the word differ for each level.
- **"Error: Syntax error: …"**. Texts that name their own error are reworded in step 1a, where they change level.
- **The panel redesign** (#418) touches the same views. Decided 2026-10-27: this plan goes first (the roadmap's three note levels, before the panel redesign; since 2026-10-31, panel P1–P2 and chrome C0–C6 start beside it). The redesign reads the level, the mark and the word from the catalog, so it needs no change either way.

## 10. Decisions

The maintainer decided every question on 2026-10-27, as the review proposed.

1. **The mark.** ⓧ, or another (✖, ⊗)?
   Decided 2026-10-27: ⓧ. It is in the same block as ⓘ (Enclosed Alphanumerics). ✖ (U+2716) can show as an emoji.
2. **`sh` scripts.** "Any POSIX sh" is no one shell: on Fedora it is bash, where every construct works. The options were: Error when dash lacks the construct (dash is `/bin/sh` on Debian and Ubuntu); Info ("Portability") when dash has it but POSIX does not (`local`, `echo -n`, `read -p`, `set -E`). Or Error for all, as today's warning?
   Decided 2026-10-27: Error where dash (and busybox ash) lacks the construct, Info "Portability" otherwise. The Action exists to catch bashisms, so `[[` keeps failing. Dash is the assumed system (section 2). dash 0.5.12 accepts `local` inside a function, `echo -n`, `read -p` and `set -E`.
3. **A stop halfway is a Warning.** `function-last-test-stops-script`, the postfix notes under `set -e`, and `nounset-unbound` with `environment` stop the script only under some values. The plan counts a stop halfway as damage that cannot be undone. Or Info?
   Decided 2026-10-27: Warning. It is the rule's own wording (question 2), and half-done work is the damage. Where the stop is certain, Error (a postfix on a value known to be 0, section 3).
4. **Two rows move down to Info** in one case each: `pipeline-subshell-variable` with `partial`, `redirect-by-your-shell` without a known root path. Or keep them Warning?
   Decided 2026-10-27: both move down. `partial` is a "maybe" case, like `extglob-maybe-on`. Without a root path, nothing is damaged.
5. **`failure-reported-as-success` under `set -e`** (`where: 'errexit'`): the script goes on past the failure. `set -e; false || echo failed; echo done` exits 0, where without the `||` it would stop with 1. So the caller sees success where it would have seen a failure. The whole id moves to Warning, as decided; should this case stay Info?
   Decided 2026-10-27: keep it Warning.
6. **Host injection** (`injection`, `pythonInjection`) fails `--check` by default today. As Warnings, it would fail only with `--strict`. Keep it failing by default?
   Decided 2026-10-27: follow the rule (Warning, fails only with `--strict`), and name it in the CHANGELOG. `python-shell-injection` and `download-run-by-shell` already pass without `--strict`; the host codes were the odd ones.
7. **The pitfalls off.** `notes.pitfalls` and `diagnostics.pitfalls` off no longer hide an Error. Agreed?
   Decided 2026-10-27: yes. An Error is a bug, not advice, as the `failure()` notes are today.
8. **The Action's names.** The input `fail-on-warning` and the output `warnings` keep their names, and mean "what fails the step"; `errors` is new. Rename them in a later major version?
   Decided 2026-10-27: keep them, add `errors`, and rename in a major release. Document that `fail-on-warning: 'false'` lets errors pass too.
9. **`pipefail-missing` at the end of a script**, and `dockerfile-pipefail-missing` (the RUN succeeds): by the Warning rule, a failure becomes the exit status. They stay Info, as decided; a function of the params later?
   Decided 2026-10-27: keep them Info, and add a "Not decided" roadmap item for a level by params. A push towards `pipefail` brings false failures from SIGPIPE (`… | head`).
