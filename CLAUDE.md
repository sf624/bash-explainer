# Notes for Claude Code

README.md ("Contributing") has the commands and the rules for tests, coverage and releases; read it first. This file adds what it does not say about this repository.

## Working tree

- `test/fixtures/sample.sh` is a curated tour of every feature, in sections headed `# --- Title ---`; it is also the web page's shell sample. Keep every line explained correctly (`npx tsx test/dump.ts test/fixtures/sample.sh en`) and every example kind covered. Check the dump after edits.
- `test/fixtures/playground.sh` (gitignored, created from `sample.sh` by the F5 pre-launch task when missing) and `test/fixtures/hosts/*` are the maintainer's playground for trying explanations in VS Code; edits there are theirs.
- Japanese strings in `src/`, and README.ja.md, follow [docs/japanese-style.md](docs/japanese-style.md); a test checks them.

## Tests and coverage

- Every line and branch of `src/` must be taken by the unit tests (`coverage-floors.json` is empty). Measure as CI does: Node.js 24 and `npm run coverage` (it sets `TZ=UTC`), then `npm run coverage:check`.
- Prefer tests that compare with the real tool: GNU sed, gawk, perl, jq, bash, git, GNU coreutils, PyYAML for kislyuk/yq. Most `test/examples-*.test.ts` already hold such tables; add cases there. These tests have found many bugs, so when the tool disagrees, fix the code (with a CHANGELOG line under "Unreleased") rather than the expectation.
- Behaviour that differs between tool releases (jq 1.7 vs 1.7.1, mawk vs gawk) is left out of the comparisons and tested on its own.
- A branch no input can reach is removed (or becomes a non-null assertion when the grammar guarantees the node); a guard against a bug elsewhere gets `/* c8 ignore … */` with a comment. Put `/* c8 ignore start */` before `} catch`, so the catch's own branch is left out too.

## The parser

- Every product parses with the unbash adapter (`src/syntax/adapters/unbash.ts`), and only that file may import unbash (test/syntax-boundary.test.ts); everything else reads the model of `src/syntax/tree.ts`. Tests that explain scripts build the parser with `createUnbashParser()`. tree-sitter was removed (docs/design/syntax-tree.md, step 6).
- No bundle may load or contain wasm; test/offline.test.ts checks it.
- unbash reads `time cmd` as a `time_statement`, `select` as a `select_statement`, `coproc` as a `coproc_statement`, and `(( ))` alone as an `arithmetic_command`. It accepts what bash rejects only at run time (`${x@Z}`, `${#a-b}`, `${(f)var}`: bad substitution), so the analyzer says so itself (`${(f)var}` only when the shell is not zsh; with zsh, the dialect check marks the line as not parsed). It also accepts a bare `echo (`, which bash rejects (a limit, listed in README Limitations).
- A script with CRLF line ends is read with each CR before a LF masked as a space (same length); `SyntaxTree.carriageReturns` lists them and `documentIssues` warns once (`crlf`).
- A statement over several lines that is not a block is explained whole, with no current line (see `sub` in `src/analyzer.ts`).
