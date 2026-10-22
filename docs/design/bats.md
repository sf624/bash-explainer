# bats test files

[bats-core](https://github.com/bats-core/bats-core) runs tests written in bash. A `.bats` file is a bash script with three additions:

- **`@test "description" {`** starts a test. bats' preprocessor rewrites the line into a function definition, `test_description() {`, before bash reads the file. bats then runs each test in a process of its own, with `set -eET`, and the test fails when the function fails.
- **Functions of bats**: `run` (runs a command inside `$( )`, so in a subshell; keeps its status in `$status` and its output in `$output` and `$lines`; returns 0), `load`, `bats_load_library`, `skip`, `bats_require_minimum_version` and `bats_pipe`. Hooks (`setup`, `teardown`, `setup_file`, …) are functions the test file defines and bats calls.
- **Comments with meaning**: `# bats test_tags=…`, `# bats file_tags=…`.

Everything else is bash, so bats needs no new grammar: once `@test` is rewritten, the file is a bash script.

## Design: a host kind

bats is a new host kind (`src/hosts.ts`), like Dockerfile or Makefile. The extractor copies every line as it is, and rewrites `@test "x" {` into the function bats makes of it, with a position map: the function's name stands for `@test "x"`, so tokens map back to the original columns. The region carries the specs of the bats functions (`src/dict/bats.ts`), which the analyzer reads before the dictionary, and the lines of the tests.

Why not the alternatives:

- **A shell dialect** (`Shell = 'bats'`): a dialect says which bash features work (`[[`, arrays…). bats changes no feature of bash; it adds a preprocessing step and functions. A dialect would also need `@test` in the parser.
- **A parser node** (`@test` in the syntax tree): unbash reads bash, and only the adapter may know unbash. A node of our own would have to pass through the adapter, the semantic model and every walk, for a construct that bats removes before bash sees it.

The host kind does what bats does (rewrite, then run bash), so the semantic model reads the script bash really runs.

## This step

- Detection: the `.bats` extension, the language id `bats` (from a bats extension for VS Code), or a `bats` shebang. A `.bats` file opened as a shell script is still a bats file.
- The extractor, and the explanation of the `@test` line: the test as written, the function bats makes of it, and a note on how bats runs it.
- Specs for `run` (`!`, `-N`, `--separate-stderr`, `--keep-empty-lines`, `--`, and the command it runs), `load`, `bats_load_library`, `skip`, `bats_require_minimum_version` and `bats_pipe`. They apply only in a bats file. `run`'s command is a `subshell` slot, a slot kind added for it: the command sees the test's functions and variables, and `processOf` (src/semantics/env.ts) says it runs in a subshell. An option `run` does not know is an error (`CommandSpec.unknownOption`).
- A line bats rewrites counts as a test only where bash then reads a function definition: bats also rewrites `@test` lines inside a here-document or a quoted string, which bash takes as text.
- Pitfalls, as facts of the catalog (`src/messages.ts`, said by `src/bats.ts`): a `! cmd` that is not the last command of a test, which `set -e` ignores (read from the status model; the fix offered depends on what follows `!`: `run !` for a command, `run ! bats_pipe` for a pipeline, `|| false` always); `run cmd | …`, which pipes run's output (none) and loses `$status` in the pipeline's subshell; and `… | run cmd`, a later stage, which loses them too unless lastpipe runs it in the shell (read from the environment model).
- `test/bats-real.test.ts` checks these facts with bats-core itself (the devDependency `bats`, run as a program).

The facts cite the sections of the Bash manual that they rest on (functions, `set -e`, pipelines). The catalog cites only the bash manual, and every renderer links its sections; a second source (the bats-core documentation) would need its own links in each renderer, so it is left for later.

## Later steps

- The semantic model: each test as a process of its own with `set -e` on (so that the status notes see it), and `teardown`, which bats calls on the left of `||`, where bash ignores `set -e`.
- bats' functions known to the model (the walk of src/semantics/state.ts reads only the dictionary today), so that `run` assigns `$status`, `$output`, `$lines`, `$stderr` and `$stderr_lines` (the state model's `assigned`), and the `BATS_*` variables. A review noted that this would also replace the `resolveName(…).kind === 'function'` check of src/bats.ts (a file's own `run` function): the model would say which `run` runs. It would also let the walk read `run eval 'S'` as a script run in `run`'s subshell, as it reads `eval 'S'` (src/semantics/nested.ts); today that string stays one word, while `run bash -c 'S'` is read in the new shell, whose slot chain starts with `run`'s subshell.
- Hooks: `setup`, `teardown`, `setup_file`, `teardown_file`, `setup_suite`, and the order bats calls them in.
- bats-assert and bats-file helpers (`assert_success`, `assert_output`, …), as specs that apply after `load`/`bats_load_library` of their library.
- Tag comments (`# bats test_tags=…`), and the other form of a test, a function marked with a comment (`f() { # @test`).
- The test names follow a UTF-8 locale (`[[:alnum:]]` keeps `é`); in the C locale bats writes the bytes in hex.
- Citing the bats-core documentation as a source of its own.
