# Notes for Claude Code

README.md ("Contributing") has the commands and the rules for tests, coverage and releases; read it first. This file adds what it does not say about this repository.

## Working tree

- `test/fixtures/sample.sh` and `test/fixtures/hosts/*` are the maintainer's playground for trying explanations in VS Code (F5 opens `sample.sh`); edits there are usually theirs and stay uncommitted.
- Japanese strings in `src/`, and README.ja.md, follow [docs/japanese-style.md](docs/japanese-style.md); a test checks them.

## Tests and coverage

- Every line and branch of `src/` must be taken by the unit tests (`coverage-floors.json` is empty). Measure as CI does: Node.js 24 and `npm run coverage` (it sets `TZ=UTC`), then `npm run coverage:check`.
- Prefer tests that compare with the real tool: GNU sed, gawk, perl, jq, bash, git, GNU coreutils, PyYAML for kislyuk/yq. Most `test/examples-*.test.ts` already hold such tables; add cases there. These tests have found many bugs, so when the tool disagrees, fix the code (with a CHANGELOG line under "Unreleased") rather than the expectation.
- Behaviour that differs between tool releases (jq 1.7 vs 1.7.1, mawk vs gawk) is left out of the comparisons and tested on its own.
- A branch no input can reach is removed (or becomes a non-null assertion when the grammar guarantees the node); a guard against a bug elsewhere gets `/* c8 ignore … */` with a comment. Put `/* c8 ignore start */` before `} catch`, so the catch's own branch is left out too.

## tree-sitter-bash quirks

- `time cmd` is a command named `time`; `select` loops are `for_statement`s; `(( ))` alone is a `compound_statement`.
- A statement over several lines that is not a block is explained whole, with no current line (see `sub` in `src/analyzer.ts`).
