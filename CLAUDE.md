# Notes for Claude Code

How work on this repository goes. README.md ("Contributing") has the commands and the rules for tests, coverage and releases; read it first. This file adds what it does not say.

## Talking with the maintainer

- Write to the maintainer in Japanese. Code, comments, commit messages, PR descriptions, CHANGELOG and README.md are in English; README.ja.md and Japanese strings in `src/` follow [docs/japanese-style.md](docs/japanese-style.md).
- Leave merging to the maintainer: open PRs, never merge one unless asked for that PR.
- Before opening a PR, fetch and check main: earlier PRs may have been merged meanwhile. Rebase onto the new main first, then check the PR's base and commit count.
- Dependent PRs go in a stack with `gh stack` (`init` / `add` / `submit --auto --open` / `rebase` / `push`); independent ones are plain PRs from main.

## Working tree

- `test/fixtures/sample.sh` and `test/fixtures/hosts/*` are often edited by the maintainer and left uncommitted: never commit them by accident. Add files by name (`git add path…`), not `git add -A` / `-u`; stash them around `gh stack rebase` and pop them after.
- Never commit `.vscode/settings.json` or tokens.

## Tests and coverage

- Every line and branch of `src/` must be taken by the unit tests (`coverage-floors.json` is empty). Measure as CI does: Node.js 24 and `npm run coverage` (it sets `TZ=UTC`), then `npm run coverage:check`.
- Prefer tests that compare with the real tool: GNU sed, gawk, perl, jq, bash, git, GNU coreutils, PyYAML for kislyuk/yq. Most `test/examples-*.test.ts` already hold such tables; add cases there. Writing these tests has found many bugs, so when the tool disagrees, fix the code (and add a CHANGELOG line under "Unreleased") rather than the expectation.
- Behaviour that differs between tool releases (jq 1.7 vs 1.7.1, mawk vs gawk) is left out of the comparisons and tested on its own.
- A branch no input can reach is removed (or made a non-null assertion when the grammar guarantees the node); a guard against a bug elsewhere gets `/* c8 ignore … */` with a comment. Put `/* c8 ignore start */` before `} catch`, so the catch's own branch is left out too.
- tree-sitter-bash quirks worth knowing: `time cmd` is a command named `time`; `select` loops are `for_statement`s; `(( ))` alone is a `compound_statement`; a multi-line statement that is not a block is explained whole with no current line (see `sub` in `src/analyzer.ts`).

## Writing

- Plain, short sentences in English; one idea each. CHANGELOG lines say what users see, then what it was before.
