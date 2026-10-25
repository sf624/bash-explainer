# Note levels

How much a note matters, and how every output shows it. Built in #320; the prototype was commit 8371ef7 (branch `proto/note-levels`).

## The levels

A note has one of three levels (`NoteLevel` in [src/messages.ts](../../src/messages.ts)):

| Level | Mark | Word | Squiggle | When |
| --- | --- | --- | --- | --- |
| `warning` | ⚠ | Pitfall / 落とし穴 | warning (yellow) | The line breaks as written, or if it goes wrong the damage cannot be undone: `x = 1`, `[-f x]`, `rm -rf $DIR/*` with an empty `DIR`, a stop under `set -u`. |
| `info` | ⓘ | Caveat / 注意 | information (blue) | It goes wrong only with some values or systems and the damage is limited, or a failure goes unnoticed: `echo $x`, `read line`, `local x=$(false)`. |
| `note` | ℹ | none | none | A fact of how the shell runs the line. |

- A dialect note on a construct that works differently in the target shell is `info`, with the word "Portability" / 「移植性」 (`ⓘ Portability: dash's echo interprets \t…`).
- A dialect note on a construct the target shell lacks (`[[ ]]` in POSIX sh, a bash 5.3 construct with bash 5.2) is a `warning` with no word: its first words already say that it fails, and in which shell.
- A pitfall with a heading of its own shows the heading in place of the word: "Shell injection risk:", "Script injection risk:", "System-dependent:". A few name their problem in their first words and have none (`regex-backslash-dropped`, the Dockerfile and Python notes).
- A level that depends on the case is a function of the params: `unquoted-variable-as-path` (the command the word is given to) and `nounset-unbound` (how far the failure reaches) and `postfix-increment-status` / `postfix-decrement-status` (whether `set -e` stops the shell there: the `errexit` param, from the status model).

## Where the level comes from

One source per kind of note:

- The message catalog (src/messages.ts): `pitfall()` is a warning, `caveat()` a pitfall at the level `info`, `failure()` a fact that says the line fails when it runs (a note at the level `warning`), `note()` a plain fact. `fact()` gives the level with the text (`Fact.level`).
- The style checks (src/pitfalls.ts): `STYLE_LEVELS`.
- The dialect issues (src/dialect.ts): `unsupported` is a warning, `behaviour` information, `parse` (zsh syntax bash cannot read) a plain fact (`Issue.note`).
- A note with no mark (an idiom, where a line is in a here-document or a statement) is a plain fact (`plainNote`).
- A diagnostic's severity is `severityOf(level)`: `warning` is a warning, the others information (src/document.ts, src/hosts/remap.ts). The old list of pitfalls shown as warnings (`PITFALL_WARNINGS`) and `WordFinding.mild` are gone.

### Notes as data

A note is made as data where it is said (`Note` in src/messages.ts): its text, its level, the word after its mark ("Pitfall:", "Caveat:", a heading; empty when there is none), the rest of the text, and the code of the problem it is (a fact's id, a style check, a dialect issue). `marked(lang, level, body, …)` makes a note with a mark, `plainNote(text)` one without; a fact (`fact()`) is a note with its id as its code. A line gives its notes as texts (`LineExplanation.notes`) and their data in the same order (`LineExplanation.noteInfo`); the analyzer records the data where each note is said (`say`, `note`, `anchored` in src/explain/context.ts), the notes of a string run as a script come with theirs (`adopt`), and a host file adds the data of its own notes (src/hosts/remap.ts). The views read the level and the word from the data (`noteOf`, `notesByLevel` in src/ui/render.ts), never from the mark; test/note-data.test.ts checks over the corpus that the data agrees with the mark each text starts with.

This replaced a bridge: the views read the level back from the mark (`noteLevel(text)`, `splitNote(text, lang)`), which is gone. A note found on a node has its range beside its text (`LineExplanation.anchors`), which the part hover reads to show only the notes about the part ([hover.md](hover.md), "Notes"). Until the next step, the problems are the pitfalls of src/pitfalls.ts and src/wordfacts.ts, as before (roadmap, "Now").

## The views

Every view shows the notes in the same order: the warnings, then the information, then the plain facts, each in the order found (`notesByLevel` in src/ui/render.ts).

- **Panel** (media/panel.js, media/panel.css): the level's codicon (`warning`, `info`) in place of the mark, then the word in bold, both in the level's colour, and the quote's left border in that colour. A plain fact keeps the quote's border and has the info icon in the muted colour, with no word. The icon has an `aria-label` (警告・情報・補足 / Warning, Information, Note). With forced colours, the icon and the word take `CanvasText`, and a warning's border is double, so that it differs from the others without colour. The copy of the line at the top underlines the line's problems as the editor does (`marks`, from `lineMarks`).
- **Hover** (src/ui/hoverView.ts, `noteMarkdown`: the part, the whole line): `$(warning)` or `$(info)`, and the word in bold, in a `<span style="color:…">` of the level's colour; a plain fact has `$(info)` in `descriptionForeground`.
- **CLI** (cli/main.ts): the mark and the word in the level's ANSI colour (33 yellow, 34 blue), bold; a plain fact's mark dim.
- **Plain Markdown** (Copy as Markdown, the Language Server's hover): the mark, and the word in bold: `> ⚠ **Pitfall:** …`.
- **Problems** (VS Code, the Language Server, `--check`, SARIF, the GitHub Action, the web page's Problems list): the severity of the level. SARIF has `warning` and `note`. The web page's list shows ⚠ and ⓘ in the level's colour.
- **Web page's editor** (web/editor.ts, CodeMirror's lint): the squiggle is a wavy underline in the level's colour (CodeMirror's own is an image of a fixed colour, grey for information), the gutter shows the level's codicon from media/icons.js as a mask over that colour (CodeMirror makes the marker element, so CSS draws it), and the problem's tooltip starts with the icon, with the `aria-label` of the panel. The gutter is hidden from screen readers by CodeMirror (`aria-hidden`), so the label is in the tooltip and the Problems list. The colours are `--c-warning` and `--c-info` (web/page.css, from theme.css); with forced colours, the icons take `CanvasText`.

### Colours

The level's colour is the editor's own: `editorWarning.foreground` and `editorInfo.foreground`, the colours of its squiggles and of the Problems panel's icons. Where they fall below 4.5:1 as text (7:1 in high contrast), ours, keeping the hue (`LEVEL_COLOURS` in src/ui/palette.ts; `--c-warning`, `--c-info` in media/panel.css; web/theme.css has the light and dark values). test/contrast.test.ts measures them.

| Theme kind | Warning | Info |
| --- | --- | --- |
| Light | #855f00 (Light Modern's #bf8803 is 3.12:1 on white) | #005fb8 (#1a85ff is 3.59:1) |
| Dark | the theme's (Dark Modern #cca700) | the theme's (Dark Modern #3794ff) |
| High contrast | the theme's (#ffd370) | #6badff (#3794ff is 6.84:1 on black) |
| High contrast light | #704500 (#895503 is 6.24:1 on white) | #0f4a85 (#1a85ff is 3.59:1) |

## The levels, one by one

Every pitfall and failure note of the catalog, every style check and every dialect issue, against the definition above. test/messages.test.ts pins the catalog's levels.

### Warnings

| Id | Why |
| --- | --- |
| `function-last-test-stops-script` | `set -e` stops the script whenever the test fails, which is what a test is written for. |
| `keyword-needs-separator` | `then` or `do` with no `;` or newline before it is an argument: a syntax error, every time. |
| `bracket-missing-close`, `bracket-close-glued`, `test-malformed` | `[` or `test` fails every time it runs (status 2), and the condition is never evaluated. |
| `unset-readonly`, `unset-function-and-variable` | `unset` fails every time (status 1), and nothing is unset. |
| `local-outside-function` | `local` fails every time outside a function. |
| `posix-special-function-name` | bash stops the script at the definition. |
| `alias-not-expanded-in-script` | The alias is "command not found" in a script. |
| `extglob-in-same-block`, `extglob-turned-off`, `extglob-not-in-new-shell` | A syntax error, every time. |
| `globstar-unsupported` | `**` never reaches into subdirectories in that shell. |
| `variable-not-in-remote-shell`, `variable-not-passed-by-wrapper`, `variable-not-exported` | The variable is empty where the string runs, every time. |
| `function-not-in-container`, `builtin-or-function-as-program`, `function-not-on-remote`, `function-not-in-new-shell-blocked`, `function-not-in-new-shell`, `function-not-imported`, `function-not-in-new-shell-export` | The function or builtin is not there: "command not found", or no effect. |
| `wrapper-assignment-expanded-first`, `prefix-assignment-expanded-first` | The word never sees the value it was meant to. |
| `pipeline-subshell-variable` | The variable set in the pipeline is gone after it, every time (also when only some paths turn `lastpipe` on: the others lose it). |
| `redirect-by-your-shell` | The redirection is "Permission denied" unless your shell is root already. |
| `shebang-refused` | Run directly, the script never starts. |
| `bats-negation-ignored` | The test never fails on that line: the assertion is dead. |
| `bats-run-in-pipeline-stage`, `bats-run-in-pipeline` | `$status` and `$output` are gone, or the pipe reads nothing, every time. |
| `regex-backslash-dropped` | The regex never means what is written. |
| `distro-alias-in-script` | "command not found" in a script, on every system. |
| `python-string-without-shell` | Python runs the whole string as one program name: FileNotFoundError. |
| `python-shell-injection`, `actions-script-injection` | A value can run any command: damage that cannot be undone. |
| `unquoted-variable-as-path` given to `rm`, `mv` or `cp` | A split or globbed path deletes or overwrites other files: it cannot be undone. |
| `postfix-increment-status`, `postfix-decrement-status`, when `set -e` is on there and the statement is not ignored (`statusModel(state).errexit(n).active` is `on`) **(changed: was a caveat)** | `set -e` stops the script (or the subshell) at the first run of a counter that starts at 0: it breaks as written. |
| `nounset-unbound`, when a shell exits | Under `set -u`, the script (or the subshell) stops there, every time; also when only the command fails and `set -e` then stops the script. |
| Style: `bracket-no-space`, `assignment-with-spaces`, `brace-no-space`, `brace-close-no-separator`, `redirect-in-bracket`, `bracket-close-in-word`, `and-or-in-bracket` | The line does not do what it says, every time (`[ a > b ]` also writes a file `b`). |
| Style: `rm-empty-variable-root` | With an empty variable, `rm -r` deletes from the root. |
| Dialect: `unsupported` | The construct fails in the target shell. |

### Caveats (information)

| Id | Why |
| --- | --- |
| `declaration-masks-status` | A failure in `$( )` goes unnoticed. |
| `pipefail-missing`, `dockerfile-pipefail-missing` | A failure before the last command of a pipeline goes unnoticed. |
| `function-last-test-returns-status` | Only the script's exit status is wrong, and only when the test fails. |
| `posix-special-function-name-maybe` | Only on the paths that turn POSIX mode on. |
| `postfix-increment-status`, `postfix-decrement-status`, when `set -e` is not surely on there | Only when the value is 0, and only the status. |
| `extglob-maybe-on`, `extglob-maybe-on-trap` | A syntax error only on some paths, or if the signal comes early. |
| `extglob-not-found`, `globstar-maybe-on`, `globstar-not-found` | Fine when the option is turned on elsewhere (a file read with `source`); `**` then matches fewer files, not more. |
| `ssh-local-expansion` | Often meant: the remote command gets the local values. |
| `function-not-imported-sh` | Only where sh is dash (Debian, Ubuntu). |
| `unmatched-glob-runs-once` | Only when nothing matches, and the body then gets a name that is no file: a command given it fails, or creates a file of that name; nothing is deleted. |
| `for-over-ls-output`, `for-over-unquoted-args` | Only names or arguments with spaces (or glob characters) are split. |
| `unquoted-variable-as-path` given to another command (`cat`, `cd`, `chmod`…) | Only values with spaces or glob characters; the command fails or acts on another file, which can be undone. |
| `unquoted-variable-in-test` | Only an empty value or one with spaces breaks the test. |
| `nounset-unbound`, when only the command fails | A redirection of a program (`cat < "$f"`): that command fails with status 1, and the script goes on. |
| Style: `read-without-r` | Only input with a backslash. |
| Dialect: `behaviour` | The construct works, differently, in some shells ("Portability"). |

## Changes from the prototype

- `unquoted-variable-as-path` is a warning when the word is given to `rm`, `mv` or `cp` (param `destroys`); the prototype had it information everywhere.
- `for-over-ls-output` and `for-over-unquoted-args` are caveats: they break only names with spaces. The prototype kept them warnings.
- `dockerfile-pipefail-missing` is a caveat, like `pipefail-missing`; it was a warning.
- `unset-function-and-variable` is a failure note (a warning), like `unset-readonly`.
- High Contrast Light's warning colour is ours (#704500): the theme's #895503 is 6.24:1 on white.
- The web page's theme (web/theme.css) defines the editor's warning and info colours, and its Problems list uses them, with ⓘ for information.
