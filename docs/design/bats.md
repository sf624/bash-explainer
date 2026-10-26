# bats test files

[bats-core](https://github.com/bats-core/bats-core) runs tests written in bash. A `.bats` file is a bash script with three additions:

- **`@test "description" {`** starts a test. bats' preprocessor rewrites the line into a function definition, `test_description() {`, before bash reads the file. bats then runs each test in a process of its own, with `set -eET`, and the test fails when the function fails.
- **Functions of bats**: `run` (runs a command inside `$( )`, so in a subshell; keeps its status in `$status` and its output in `$output` and `$lines`; returns 0), `load`, `bats_load_library`, `skip`, `bats_require_minimum_version` and `bats_pipe`. Hooks (`setup`, `teardown`, `setup_file`, …) are functions the test file defines and bats calls.
- **Comments with meaning**: `# bats test_tags=…`, `# bats file_tags=…`.

Everything else is bash, so bats needs no new grammar: once `@test` is rewritten, the file is a bash script.

## Design: a host kind

bats is a new host kind (`src/hosts/bats.ts`), like Dockerfile or Makefile. The extractor copies every line as it is, and rewrites `@test "x" {` into the function bats makes of it, with a position map: the function's name stands for `@test "x"`, so tokens map back to the original columns. The region carries the specs of the bats functions (`src/dict/bats.ts`), which the analyzer reads before the dictionary, and the lines of the tests.

Why not the alternatives:

- **A shell dialect** (`Shell = 'bats'`): a dialect says which bash features work (`[[`, arrays…). bats changes no feature of bash; it adds a preprocessing step and functions. A dialect would also need `@test` in the parser.
- **A parser node** (`@test` in the syntax tree): unbash reads bash, and only the adapter may know unbash. A node of our own would have to pass through the adapter, the semantic model and every walk, for a construct that bats removes before bash sees it.

The host kind does what bats does (rewrite, then run bash), so the semantic model reads the script bash really runs.

## What is done

The host kind came in #202; bats' functions became spec effects in #222 (refactor 2.1); the model per test and the hooks came in #381.

- Detection: the `.bats` extension, the language id `bats` (from a bats extension for VS Code), or a `bats` shebang. A `.bats` file opened as a shell script is still a bats file.
- The extractor, and the explanation of the `@test` line: the test as written, the function bats makes of it, and a note on how bats runs it.
- Specs for `run` (`!`, `-N`, `--separate-stderr`, `--keep-empty-lines`, `--`, and the command it runs), `load`, `bats_load_library`, `skip`, `bats_require_minimum_version` and `bats_pipe`. They apply only in a bats file. `run`'s command is a `subshell` slot, a slot kind added for it: the command sees the test's functions and variables, and `processOf` (src/semantics/env.ts) says it runs in a subshell. An option `run` does not know is an error (`CommandSpec.unknownOption`).
- The model reads bats' functions by their specs (`shellState`'s `host`, src/semantics/effects.ts), as builtins: `run` sets `$status`, `$output` and `$lines` (and sets or unsets `$stderr` and `$stderr_lines`), so no condition is decided from them; `load` and `bats_load_library` run a file the model does not read, and `bats_pipe` `eval`s the pipeline it joins in the calling shell (with `lastpipe`, its last stage may set anything): a call of one makes the whole file trust nothing, so no condition of it is decided (src/semantics/trust.ts). `skip` and `bats_require_minimum_version` set nothing it follows. The walk goes on past `load` and `bats_pipe` as it was: the file is taken to define helpers, the pipeline to run tools.
- A line bats rewrites counts as a test only where bash then reads a function definition: bats also rewrites `@test` lines inside a here-document or a quoted string, which bash takes as text.
- Pitfalls, as facts of the catalog (`src/messages.ts`, said by `src/bats.ts`): a `! cmd` that is not the last command of a test, which `set -e` ignores (read from the status model; the fix offered depends on what follows `!`: `run !` for a command, `run ! bats_pipe` for a pipeline, `|| false` always); `run cmd | …`, which pipes run's output (none) and loses `$status` in the pipeline's subshell; and `… | run cmd`, a later stage, which loses them too unless lastpipe runs it in the shell (read from the environment model).
- How bats runs the file (bats-exec-file and bats-exec-test of bats-core 1.13), in the model: the region carries a `HostRun` (`batsRun`, src/hosts/bats.ts), and the walk reads it once the file has run (src/semantics/walk/host.ts). The file starts with `set -eET` (the shebang's options do not apply: bats sources the file). Each test then runs in a process of its own, from the state at the end of the file (bats reads the whole file again there), after `setup` and before `teardown`; a `set -e` or `exit` that ends the test still runs `teardown` (bats calls it from its EXIT trap), with what the test had set. `setup_file` and `teardown_file` run in one more process; what `setup_file` changes of variables and functions is not known in the tests (bats exports to them only what it exports). `teardown` and `teardown_file` are called on the left of `||`: the status model ignores `set -e` in them (`IgnoreReason` `called-by-host`). A hook or a test the file removes (`unset -f`), or a test it defines again, is not called. A test body's chain starts with a host link (src/semantics/env.ts), which `processOf` reads as the script's own shell: the test is a bash that has read the whole file. So a condition in a test is decided from the file's variables and `setup`'s, a variable one test sets does not reach the next, and the notes of `set -e` (`$( )`, `pipefail`) apply in the tests.
- The hooks get a note on their definitions (`bats-hook`): when bats calls each, in which process, and that `set -e` is ignored in `teardown` and `teardown_file`. A `setup_suite` in a test file is a pitfall (`bats-setup-suite-in-test-file`): bats calls it only from `setup_suite.bash`, and warns (BW03).
- `test/bats-real.test.ts` checks these facts with bats-core itself (the devDependency `bats`, run as a program), and the order and the processes of the hooks.

The facts cite the sections of the Bash manual that they rest on (functions, `set -e`, pipelines). The catalog cites only the bash manual, and every renderer links its sections; a second source (the bats-core documentation) would need its own links in each renderer, so it is left for later.

## Not done yet

- bats' functions in the model: partly done (#222). The model reads them by their specs, as builtins ("What is done" above): `run` assigns `$status`, `$output`, `$lines`, `BATS_RUN_COMMAND`, and maybe `$stderr` and `$stderr_lines` (src/dict/bats.ts). What remains: the other `BATS_*` variables; the walk does not read `run eval 'S'` as a script run in `run`'s subshell, as it reads `eval 'S'` (src/semantics/nested.ts), so that string stays one word (test/hosts.test.ts), while `run bash -c 'S'` is read in the new shell, whose slot chain starts with `run`'s subshell; and src/bats.ts still asks `resolveName(…).kind === 'function'` for a file's own `run`.
- What the code outside the tests sees of bats: bats sources the file from a function (`local` works there, `return` ends the file), with its ERR and DEBUG traps set, and with the `BATS_*` variables; the model reads the top level as a script's.
- bats-assert and bats-file helpers (`assert_success`, `assert_output`, …), as specs that apply after `load`/`bats_load_library` of their library.
- Tag comments (`# bats test_tags=…`), and the other form of a test, a function marked with a comment (`f() { # @test`).
- The test names follow a UTF-8 locale (`[[:alnum:]]` keeps `é`); in the C locale bats writes the bytes in hex.
- Citing the bats-core documentation as a source of its own.
