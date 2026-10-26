# Reading the files given to `source`

Status: proposed (2026-10-27). Not started. The roadmap's "Next" item "Read a file given to `source` when it is in the workspace" ([../roadmap.md](../roadmap.md)), which the deferred constants in functions wait for ([function-constants.md](function-constants.md), section 7). This page says what bash does with `source` and `.`, which paths the model can resolve honestly and under which assumptions, how the model would read the file, where each part lives (the hosts read files, the model never does), the steps, the tests, the gain measured on three sets, and the risks.

## 1. The problem

Values in Meaning, decided conditions and dead code rest on the trust of src/semantics/trust.ts ([trust-allow-list.md](trust-allow-list.md)). The allow-list row of `source` and `.` is `all`: the file is not read, so it may do anything, and the whole script trusts nothing. The walk takes the state after it as opaque (`WalkBuiltins.effects`, `Walker.opaque`), and keeps the command in `StateModel.sources`, so that `resolveName` can say a name after it "may be a function of the file read" (src/semantics/names.ts, src/explain/commands.ts).

This is the most common first cause of blindness on real scripts:

- In the research set of October 2026 (358 files, [trust-per-position.md](trust-per-position.md), section 8), the first cause was a `source` in 72 of the 136 files that could be placed.
- In [function-constants.md](function-constants.md), section 7 (#406), 55 reads of top-level constants in 14 real scripts were blocked by `source`.
- Trust per position (deferred) cannot help much: most scripts source their libraries near the top, and a sourced file may call any function later.

The walk already runs the static string of an `eval` where it stands (`Walker.evalScript`, semantics.md 4.13). A sourced file is the same thing with a file instead of a string: bash reads it and runs it in the current shell. When the file is in the workspace, the model can read it too.

## 2. What bash does

Each claim was checked with bash 5.2.21 and bash 5.3.0, in a fresh temporary directory per case (`bash --norc --noprofile`, a clean environment, `timeout 10`, `FUNCNEST=100`). The two releases agree on every case; only the wording of two error messages differs. The probe rows of step 0 (section 6) record these cases.

**Finding the file** (manual 4.1, `.`; 4.3.2, `sourcepath`):

| Case | bash |
| --- | --- |
| A name without a slash, `source lib.sh`, with `lib.sh` in a PATH directory and in the current directory | the PATH one runs |
| The same, with no `lib.sh` on PATH | the current directory's runs |
| The PATH file is not executable | it still runs: the search does not need the execute bit |
| `shopt -u sourcepath` | PATH is not searched: only the current directory's file |
| POSIX mode (`set -o posix`, `bash --posix`) | PATH only, never the current directory ("file not found"); the shell then exits (status 1) |
| dash, `. lib.sh` | PATH only ("not found"); dash has no `source` (status 127) |
| A path with a slash, `source ./lib.sh`, run as `bash s/m.sh` from another directory | the current directory's `./lib.sh`, not the one next to the script |

**The script's directory** (the idioms):

| Idiom | bash |
| --- | --- |
| `source "$(dirname "$0")/lib.sh"` | the file next to the script, from any current directory |
| `source "${BASH_SOURCE%/*}/lib.sh"` | the same, but only when the script was started by a path with a slash: `bash m.sh` gives `m.sh/lib.sh: Not a directory` |
| `cd /; source "$(dirname "$0")/lib.sh"`, run as `bash s/m.sh` | fails: a relative `$0` is relative to the current directory, and the `cd` changed it |
| `cd "$(dirname "$0")" && source lib.sh` | the file next to the script |
| `SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)` | an absolute directory, right after any later `cd` |
| A script run through a symlink | `$0` is the link's path: `dirname "$0"` is the link's directory; `dirname "$(readlink -f "$0")"` is the target's |
| A script found through PATH | `$0` and `BASH_SOURCE[0]` are its full path |
| Inside a sourced file | `$0` is still the caller's; `BASH_SOURCE[0]` is the file's path as given to `source` (`l/b.sh l/a.sh m.sh` in nested files) |

**Running it:**

- The file runs in the current shell. Its variables, functions, `set` and `shopt` options, traps (an EXIT trap set there runs at the end of the script), aliases and readonly variables stay after it.
- Arguments: `source f a b` gives the file `$1`=a, `$2`=b, and the caller's are back after it. With no arguments, the file sees the caller's, and a `shift` there shifts the caller's. With arguments, `shift` inside is undone after, but `set -- q` inside is kept (`after: 1 q`): bash restores the caller's parameters only when the file did not set them.
- The status is that of the last command the file ran, 0 for a file with no commands.
- `return N` at the file's top level ends the file, with status N, also when the `source` is inside a function (the function goes on). `return` inside a function of the file returns from that function only. `exit` ends the shell.
- `local` at the file's top level is an error ("can only be used in a function"), unless the `source` runs in a function: then it makes a local of that function. So does `declare`.
- An alias the file defines works on its later lines (with `expand_aliases`): bash reads the file one command at a time.
- A syntax error: the lines before it run, the rest does not, `source` returns 2, and the caller goes on.
- The file is read when the command runs: a file changed by the script before (`echo two > lib.sh; source ./lib.sh`) runs its new text.
- A file sourced twice runs twice (a `readonly k=1` in it then fails the second time). An include guard (`[ -n "$LIB_DONE" ] && return`) makes the second a no-op.
- Recursion: a file that sources itself 300 times ran; `FUNCNEST` does not limit `source`. (No unbounded run was tried.)
- In a subshell (`( . ./lib.sh )`, `. ./lib.sh | cat`), nothing stays.

**Errors:**

- A missing file: "No such file or directory", status 1, and the script goes on. With `set -e` the script ends there (`source ./nofile || …` does not). In POSIX mode the shell ends.
- A directory: "is a directory", status 1.
- A file with a NUL byte is read anyway (the NUL is dropped): `source` does not refuse binary files as running a program does.
- No operand: status 2, with a usage message.

## 3. Which paths the model can resolve

The model never runs anything and never sees the machine the script runs on. So it may read a file only when the path is fixed by the script's text, the file is in the workspace, and the assumptions it needs are ones the user can see.

**R1. The path word.** The word after `source` or `.` (after `--`; 5.3's `-p` makes the call unread) is one of these:

| Form | Example | Resolved against | Assumption |
| --- | --- | --- | --- |
| Static, absolute | `. /opt/app/lib.sh` | itself | the file at run time is the workspace's |
| Static, relative, with a slash | `. ./lib.sh`, `source lib/common.sh` | the current directory | see R2 |
| Static, no slash | `. lib.sh` | PATH, then the current directory | see R2; never read in POSIX mode, sh or dash (PATH only) |
| The script's directory | `"$(dirname "$0")/lib.sh"`, `"${BASH_SOURCE%/*}/lib.sh"`, `"$(dirname "${BASH_SOURCE[0]}")"/lib.sh`, `"$(cd "$(dirname "$0")/.." && pwd)/lib/x.sh"`, `"$(dirname "$(readlink -f "$0")")/lib.sh"` | the script's directory | R3 |
| A variable set once to one of the forms above | `DIR=$(dirname "$0"); . "$DIR/lib.sh"`, `LIB=/opt/app/lib; . "$LIB/x.sh"` | as its value | R4 |
| A ShellCheck directive on the line before | `# shellcheck source=lib/common.sh` | as ShellCheck reads it (to be checked against its manual in step 1) | the user's own statement |
| Anything else | `. "$hook"` in a loop, `. "${BYOBU_PREFIX}/lib/x"`, `. "$HOME/.config/x"`, `source <(cmd)`, `. /dev/stdin` | | not read: `all`, as today |

**R2. The current directory.** bash resolves a relative path against the current directory at run time, not the script's directory. The walk knows that directory only after a `cd` it can read: `cd "$(dirname "$0")"`, `cd "$SCRIPT_DIR"`, `cd -- "${BASH_SOURCE%/*}"` (the walk would keep a symbolic `PWD`: "the script's directory", or not known). Otherwise reading `./lib.sh` from next to the script assumes that the script runs from its own directory. That assumption is common in small projects, but it is an assumption. Two choices (section 11): read it, with the assumption said on the token; or read relative paths only after such a `cd`. A name with no slash also assumes that no PATH directory has a file of that name (git's own scripts run `. git-sh-setup`, found through git's exec-path on PATH).

**R3. The script's directory.** `$0` and `BASH_SOURCE[0]` hold the path the script was started by. The idioms give the script's directory under these conditions, which the walk checks or the token says:

- `$(dirname "$0")` and `${0%/*}`: the script runs as a program or with `bash script`, not sourced (then `$0` is the shell's name). In a sourced file, `$0` is the *main* script's: the directory of the script being explained, not of the library.
- `${BASH_SOURCE%/*}` and `${0%/*}`: the path has a slash (`./m.sh`, an absolute path, or through PATH); `bash m.sh` breaks them. `$(dirname …)` has no such condition.
- `BASH_SOURCE[0]` is the path of the file it is in: in a library, the library's directory.
- A relative `$0` is relative to the directory the script started in: a `cd` that may run before the expansion (on any path, in the walk) makes the form unread, unless the directory was made absolute before it (`$(cd … && pwd)`).
- A symlink: the plain forms give the link's directory, the `readlink -f` and `realpath` forms the target's. The model reads the path of the open document, which is the target when the editor opened it directly. The token says "next to this file".

**R4. Variables.** The pre-resolution (section 4) reads `$DIR/lib.sh` only when `DIR` has one assignment in the script's text, at the top level, to one of the forms of R1. The walk then checks, at the `source`, that the value of `DIR` there comes from that assignment on every path (`VariableState.at`), and that `DIR` is trusted (a plain write; [trust-allow-list.md](trust-allow-list.md)). If not, it walks again with nothing trusted (`Walker.found`), as it does for a precondition of the allow-list.

**R5. The file.** A resolved path is read only when all of these hold:

- It is in a workspace folder of the script (after symlinks are resolved: a link that points out is not followed). No file outside the workspace is read: not `/lib/lsb/init-functions`, not `~/.bashrc`. A file outside is the deploy machine's, which may differ from this one's, and reading it would read the user's files beyond the project.
- It is a text file: no NUL byte, valid UTF-8 (as the editor would open it), under a size cap (1 MB, the measure's).
- The script does not write that path itself before it: a redirection or a spec's `io: write` operand with the same static path (`echo "x=1" > lib.sh; . ./lib.sh`) makes the file not known, since bash reads what the script wrote.
- It exists. A path with no file in the workspace is not read: at run time the file may be there (made by a build step, or on the deploy machine). The token says "not found in the workspace", and the row stays `all`.

**R6. Which documents.** Only shell script documents and bats files (whose `load` is a later step, section 10). Not the shell code of host files: a Dockerfile's `RUN . /etc/os-release` reads the image's file, a Makefile recipe runs in make's directory, and a Markdown block has no directory.

**What the user sees.** The `source` token says which file was read and under what assumption ("Read from `lib/common.sh` in the workspace, as if the script runs from its own directory"), or why not ("`$hook` is known only when it runs", "`/etc/default/x` is outside the workspace", "not found in the workspace", "not read on the web page"). These are catalog messages (src/messages.ts). README's Limitations list the assumptions, as they list those of the default start today.

## 4. How the model reads them

**Two phases.** The model is synchronous and reads no files; the hosts read them, VS Code asynchronously. So:

1. *Pre-resolution* (pure, from the syntax only): `sourceTargets(tree, scriptPath)` in a new module, src/semantics/sourcepath.ts, lists for each `source` and `.` command the path R1 gives, its form and its assumptions, or why none. For the files found it is applied again to their trees (nested sources), up to `NESTED_DEPTH` levels.
2. *Reading* (the host): the host reads the files the list names, as R5 allows, and gives the model a snapshot: `SourceFiles = { script: string | undefined; files: ReadonlyMap<string, { text: string; version: string }> }`.
3. *The model*: `shellState(tree, shell, { …, files })`. The cache key of the model (`models` in src/semantics/state.ts) adds the snapshot's paths and versions, so a change of a sourced file builds a new model of each script that reads it. Every caller of `shellState` for a document (the analyzer, src/highlight.ts, src/bats.ts, src/hosts/remap.ts) passes the same snapshot, so they share one model.

**The walk.** At a `source` or `.` whose path the pre-resolution gives and whose file is in the snapshot, the walk runs the file's tree where the command is, as `evalScript` runs an `eval` string (`Walker.sourceScript`, beside it in src/semantics/walk/walker.ts):

- The tree is parsed once per model and file version (`Scripts.file(path)`, beside `Scripts.read` in state.ts), and shared by every `source` of that file, as a function body is shared by its calls: the states of its nodes merge over the runs.
- It runs from the state at the command, one line at a time (`runScript`): a syntax error stops it there, and the lines before run.
- `return` at its top level ends the file, with a new jump target (`{ kind: 'source' }`, beside the function's); `exit` ends the shell, as today.
- In a function, `local` and `declare` make locals of that function; at the top level, `local` fails ("can only be used in a function") and sets nothing.
- The positional parameters: the model does not follow them (semantics.md 4.7), so nothing changes there; the trust never trusts them.
- The status: the file's last command, 0 for an empty file; a missing file is not read, so no status is guessed.
- Nested sources resolve `$0` to the main script's directory and `BASH_SOURCE[0]` to the file's own (R3).
- Recursion: a file already being run on the walk's stack is taken as a file not known (`all`); bash has no limit, and the walk's guards (`WALKS_PER_FUNCTION`, `CALL_DEPTH`) do not cover files. A file sourced twice, one after the other, runs twice.
- The env model (src/semantics/env.ts) adds no link: `source` runs in the current shell, so the file's root runs where the command does (`WalkFacts.base`, as for an `eval` string).

**The trust.** The scan (src/semantics/trust.ts) visits the file's tree where the command is, as part of the script: `now: true` (it runs there) and *not* foreign. An `eval` string's writes are foreign (not trusted), since a string is data the script builds; a file is code, as the script's own text is, and its plain writes must count as plain, or no variable it sets could have a value. The tree is visited once per `source` command, with that command's context (`fn`: a `source` in a function makes the file's top level part of that function). The allow-list row of `source` and `.` becomes `followed`, with a precondition: the file is known (R1 to R5); otherwise `all`, as today. A file that holds a construct whose row is `all` makes the whole script trust nothing, with a reason that names the file and its line ("`lib.sh`, line 12: a command name not known").

**Positions.** A node of a sourced file is in a tree of its own, of another document. Where the model orders nodes by their place in the document (`docIndex`, `docLine`; names.ts' `sourcedBefore`), a node of a file maps to the range of its `source` command, as a node of an `eval` string maps to its word (`owners`, `rootOwners`). The analyzer explains only the open document: the file's own lines are explained when the user opens it, alone.

**What it gives.**

- Values and decisions after the `source`, where the file's writes are plain (`LIB=/opt/x` there gives `$LIB` a value in the script), and the script's own constants, which are no longer blind.
- Names: a command the file defines is a function ("function, from `lib/common.sh`, line 4"), not "maybe a function of the file read". `StateModel.sources` keeps only the commands whose file is not read.
- Options: `set -euo pipefail` in a common file reaches the status model, so `set -e` notes apply after the `source`.
- A value whose last writer is in another file says so ("Value here, from `lib.sh`, line 4:"), so the user can find it.

**Caching and invalidation.**

- VS Code (src/extension.ts, src/service.ts): before explaining a document, the service runs the pre-resolution, reads the files it names (an open document's text when the file is open, so unsaved edits count; else `vscode.workspace.fs.readFile`, which also works in virtual workspaces and VS Code for the Web), and caches them by URI and version (`mtime` and size, or the document's version). A reverse map gives, for each file read, the documents that read it. A `FileSystemWatcher` over the files read and `onDidChangeTextDocument` of open files invalidate the snapshot, and the documents that read the file are explained again (diagnostics, semantic tokens, the panel), with the delay the extension uses for edits. While the first read is pending, the document is explained as today (blind), then again.
- Language Server (cli/lsp.ts): the same, with Node's `fs` under the client's workspace folders (`rootUri`, `workspaceFolders`) and `workspace/didChangeWatchedFiles` when the client offers it.
- CLI (cli/main.ts): the files under the current directory (the project the CLI runs in), relative to the input file's path; none for stdin, which has no path. A flag turns it off (section 11).
- Web page: no file system, so nothing is read. The token says so. Opening a folder, or several files, is not in this plan (section 10).

**Privacy.** The hosts read files as data, inside the workspace only, and never run them or send them anywhere; no product gains network or process code (test/offline.test.ts). README's Privacy section says that the extension reads the files a script sources, in the workspace. In an untrusted workspace (VS Code's Restricted Mode), reading data is allowed, as for the open document; the maintainer may prefer to read nothing there (section 11).

## 5. Where it lives

| Part | Module |
| --- | --- |
| Pre-resolution: the forms of R1, R3 and R4, the assumptions, ShellCheck's `source=` directive | src/semantics/sourcepath.ts (new) |
| The snapshot type, and `shellState`'s option and cache key | src/semantics/state.ts |
| The file's tree, once per model and version | `Scripts.file` in src/semantics/state.ts |
| The walk of the file, the `source` jump target, the cycle check, the variable precondition of R4 | src/semantics/walk/walker.ts, src/semantics/walk/builtins.ts (`effects`: the file read instead of `opaque`) |
| The trust: the file visited in place; the row of `source` and `.` | src/semantics/trust.ts, src/semantics/allow.ts |
| Names from the file; `sources` of files not read | src/semantics/names.ts, src/semantics/state.ts |
| Positions of a file's nodes | `docIndex`, `docLine`, `owners` in src/semantics/state.ts |
| Reading the files: workspace check, text check, cache, watcher, reverse map | src/service.ts and src/extension.ts (VS Code), cli/lsp.ts, cli/main.ts; a shared, host-free part (`R5` checks on a text and a path) in src/document.ts |
| The token's line, the provenance of a value, the name badge | src/explain/commands.ts, src/explain/values.ts, src/messages.ts |

The semantics never touches a file system: the hosts pass text.

## 6. Steps

Each step keeps every test passing.

0. **Probes with files.** The probe format (test/fixtures/probes/*.json, scripts/record-probes.ts) gets a `files` field: files written in the temporary directory the row runs in, and the path the script is run by (`bash s/m.sh` from a given directory). Rows for every case of section 2, recorded with bash 5.2 and 5.3. The model reads no files yet: each row lists its facts in `gaps`. Nothing users see changes.
1. **Pre-resolution.** src/semantics/sourcepath.ts and its tests: each form of R1 against bash, run from the script's directory, from another directory, through a symlink, as `bash m.sh` without a slash, after a `cd` (section 7). Check ShellCheck's `source=` and `source-path=` against its manual here, or leave the directive out. Nothing users see changes.
2. **The model reads a snapshot.** `shellState`'s option, the cache key, `Scripts.file`, the walk, the trust's row, names, positions. Hosts pass no snapshot yet, so nothing users see changes; the probe rows of step 0 drop their gaps, as the tests give the files. The decisions' generator writes sourced files for a share of its scripts (section 7).
3. **The CLI and the Language Server read files.** Users of the CLI and LSP see values, decisions and function names in scripts with libraries. CHANGELOG ("New").
4. **VS Code reads files**, with the watcher and the reverse map; the setting of section 11. CHANGELOG.
5. **The explanation says it.** The `source` token's line (which file, which assumption, or why not), the provenance of a value from another file, the function badge with its file; the web page's "not read here". CHANGELOG. (Steps 3 to 5 may land together, if the maintainer prefers one CHANGELOG bullet.)
6. **Docs.** README's Limitations and Privacy, semantics.md 4.13 (files beside strings) and 4.14, trust-allow-list.md's row, this page's status, the roadmap.

## 7. Tests

- **Probes against bash with sourced files.** The rows of step 0, in state.json, status.json, names.json and env.json: what stays after the file (variables, functions, options, traps, aliases, readonly), `return` at the top and in a function, `local` in a function and at the top, a syntax error, an empty file, a file sourced twice and the include guard, a subshell, nested files with `BASH_SOURCE`. Each row runs bash in a temporary directory with its files, in a cgroup with `FUNCNEST` set and killed as a process group on a timeout (CLAUDE.md, "Tests that run bash"), since a row may recurse.
- **The resolution against bash.** For each form of R1, test/source-paths.test.ts runs bash in a temporary directory, from the script's directory and from another one, through a symlink, without a slash, after a `cd`, and compares which file bash read (each file prints its name) with what `sourceTargets` gives and the assumption it says. A form must never name a file bash does not read under the stated assumption.
- **The decisions' generator.** test/support/decisions.ts writes a library file for a share of its scripts (a function, a constant, `set -e`, a `return` at the top, an include guard, a nested `source`), and test/decisions.test.ts runs them in bash: no decision, value or dead mark that bash contradicts. Its floors keep counting the scripts without files.
- **Unread forms trust nothing.** test/allow-list.test.ts: `. "$x"`, `. <(cmd)`, a path outside the workspace, a missing file, a file the script writes, a cycle, a file with an `all` construct: each script is blind, with its reason.
- **The hosts.** A service test with a fake workspace: the reverse map, invalidation on change, the R5 checks (outside, symlink out, NUL, size). An LSP test with `didChangeWatchedFiles`. A CLI test with files beside the input and with stdin.
- **The corpus counter** goes to scripts/ (as [trust-per-position.md](trust-per-position.md), section 8, asks): the counts of section 8 here, before and after each step; every new value read by hand.

## 8. Expected gain, measured

**Method.** A counter like that of [trust-allow-list.md](trust-allow-list.md), section 4, in one process at 5b396188, reading files as data and running none. For each file blind first by `source` (the scan's first reason), it classified each `source` path by the forms of R1, resolved the files it could (a relative path against the script's directory, `$0` forms against the main script, `BASH_SOURCE` forms against the file they are in, nested up to 4 levels, no cycle), and put each file's text in place of its command, as `{ text }`. That approximates the walk of section 4: arguments, `return` at the top of a file and the workspace check are ignored, and every file found on this machine is read, also outside any workspace (the workspace rule would read fewer). Then it counted, outside the inserted text: expansions with a value (`expansionValue`), decided conditions, dead statements, and calls of a function that only a sourced file defines.

Three sets:

- (a) the repository's corpus (test/support/corpus.ts: fixtures, host files and test snippets; 1,517 inputs not in zsh);
- (b) the real scripts by the rule of trust-allow-list.md, section 4 (/usr/share/bash-completion, /usr/bin and /usr/sbin with a sh, bash or dash shebang, and /etc): 846 files not in zsh on this machine today (802 then);
- (c) 279 more scripts from /usr/lib, /usr/libexec and /usr/share (not bash-completion, doc, man), with a shebang or a `.sh`/`.bash` name. They include the Linux kernel's perf test suite (86 scripts with libraries next to them, `. "$(dirname $0)"/lib/probe.sh`), the closest thing on this machine to a project in a workspace.

| Measure | (a) corpus | (b) real scripts | (c) more scripts |
| --- | --- | --- | --- |
| Files with a `source` | 5 | 67 | 87 |
| Blind first by `source` | 5 | 57 | 78 |
| Their `source` commands: static absolute / static relative / script's directory / variable set once / other | 0 / 4 / 0 / 0 / 1 | 29 / 0 / 0 / 5 / 92 | 22 / 14 / 24 / 24 / 21 |
| Files with at least one file found | 0 | 21 | 62 |
| Trusted once the files are read | 0 | 3 | 19 |
| Values, before → after | 32 → 32 | 261 → 268 | 124 → 190 |
| Decisions, dead statements | unchanged (25, 9) | unchanged (0, 0) | unchanged (1, 1) |
| Calls of functions a read file defines (files) | 0 | 78 (8) | 228 (44) |

- (a) The snippets of the tests name files that do not exist (`source ./lib.sh`). No gain, as expected.
- (b) System scripts source system libraries, and the libraries are blind themselves: `/lib/lsb/init-functions` (11 init scripts) runs `. $hook` over a `run-parts` list and has a command name not known; bash_completion has an `eval` of text not known; byobu's paths come from `$BYOBU_PREFIX` (the environment), dpkg's from `${DPKG_DATADIR:-…}`. The 3 files trusted: `aa-remove-unknown` (7 values: 6 of its own constants, and `$PARSER` from `rc.apparmor.functions`), `00-header` and `update-info-dir` (no expansion to give). None of these libraries is in a workspace, so the rule of R5 would read none of them. The 55 reads of #406 blocked by `source` (init scripts, byobu, dpkg) stay blocked: their libraries are outside a workspace, and blind or unresolvable.
- (c) The perf tests are where the gain is: 39 of their scripts had a file found, 15 became trusted, and 65 of the 66 new values are theirs (`${sym}` = `noploop`, `$syscall` = `landlock_add_rule`…; read by hand, each is the script's own constant or a library's). Most of the others stay blind for another reason, mostly in the shared library: `-v` of a name not known (21), a nested `source` not resolved (11), an `eval` (7).
- The calls are the larger visible effect: 306 commands in 52 files would show the function they run, with its file, instead of "maybe a function of the file read". That needs no trust: names read the walk's definitions.

**Estimate for workspaces.** The research set of October 2026 (projects from 18 repositories; its files are gone) had 151 `source` commands in 95 files blind by `source`: 31 with a static path, 23 next to the script (`$0`, `BASH_SOURCE`) and 13 `$DIR/file`, so up to 67 (44%) of the forms R1 reads, and 84 others. Its libraries were not measured. If they behave like set (c) (a third of the files with a library found become trusted), reading would trust about 15 to 25 of those 95 files, and give some tens of values, most on the top level; values inside functions need the deferred constants in functions ([function-constants.md](function-constants.md)) as well. This is an estimate: the libraries of those projects could not be measured here (the download was not allowed in this session), and the measuring script of step 6 should repeat it on pinned repositories.

## 9. Risks

- **An assumption that does not hold.** A script run from another directory, through a symlink, or with a library that differs on the deploy machine reads another file, or none, and a value or a decision may then be wrong. Static relative paths carry the largest risk (R2). The token says the assumption; the setting of section 11 can turn relative paths off; files outside the workspace are never read.
- **A file the script changes.** R5 refuses a path the script writes by a redirection or a spec's write operand. A program that writes it in another way (`cp`, `ln`, an installer) is not seen. Rare in libraries, but possible in setup scripts.
- **Cost.** A large library (bash_completion is 77 KB) is parsed and walked in each script that reads it, and its text joins the scan. The tree is cached per file version across documents, the size cap bounds the rest, and a library that makes the script blind ends the scan early.
- **Shared trees.** A file's tree visited from several `source` commands (one at the top level, one in a function) must keep its states and its trust facts per visit where they differ (a `local`), as function bodies do. The decisions' generator is the guard.
- **Stale explanations.** Until the watcher fires, a document shows the model of the old file. The explanation refreshes on the next event, as for an edit.
- **Workspace boundaries.** A multi-root workspace, a script outside any folder (a loose file), a remote workspace: the host decides what "in the workspace" means; a loose file reads nothing.

## 10. Not in this plan

- **Files outside the workspace** (`/lib/lsb/init-functions`, `~/.bashrc`): not read. A setting listing more directories (ShellCheck's `source-path`) could come later, with the same R5 checks.
- **PATH search** for a name with no slash, beyond the current-directory reading of R2.
- **The web page.** It has one editor and no directory. Opening a folder (`showDirectoryPicker`, Chromium only) or several files would let it read sourced files; that is a page design of its own.
- **Explaining a library from its callers** (its `$1`, the values the caller set before the `source`): a library opened alone is explained alone.
- **bats' `load` and `bats_load_library`**: `load x` reads `x.bash` next to the test file (`BATS_TEST_DIRNAME`), with no assumption about the current directory, so it is a good next form ([bats.md](bats.md)); checked against bats-core in test/bats-real.test.ts. **GitHub Actions `run:` steps**, which start in the repository's root, likewise.
- **Trust per position** ([trust-per-position.md](trust-per-position.md)) stays deferred. Reading the files removes most of the `source` taints it would have placed.

## 11. For the maintainer

- **Relative paths (R2).** Read `. ./lib.sh` and `. lib.sh` from next to the script, with the assumption on the token ("as if the script runs from its own directory")? Or read them only after a `cd` to the script's directory, and say on the token why not otherwise? The first gives more (14 of 105 commands in set (c), and many small projects); the second never rests on how the script is started.
- **A setting.** `bashExplainer.sourcedFiles`: `"workspace"` (default: R1 to R5), `"scriptDirectory"` (no relative paths without a `cd`), `"off"`; and the CLI's flag (`--no-source`). Should Restricted Mode read files?
- **ShellCheck's directives.** Honour `# shellcheck source=…` (and `source-path=SCRIPTDIR`) as the user's own statement of the file, also for a path R1 cannot read (`. "$hook"`)?
- **Provenance.** Is "Value here, from `lib.sh`, line 4:" enough, or should the value link to the file?
- **Order.** The measure says the clearest gain is in projects with their own libraries (set (c): +66 values, 19 files trusted) and in function names (306 calls), not in system scripts. Step 0 (probes) and step 1 (pre-resolution) are cheap and useful on their own; steps 2 to 5 are the bulk.
