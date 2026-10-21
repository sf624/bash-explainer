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

## Explanations

- An explanation that contradicts bash or the tool (a label, a role, a note, an example) is a bug: fix it now, with a test against the real tool. A missing explanation is acceptable for a rare edge case, but representative usage (tutorials, LPIC/LinuC material) should be explained.
- Conventions and the language both count. Where the syntax does not change whether a line is correct, follow the convention and add a short note on the syntax (a subcommand is shown as a command, with "to the shell it is an argument"). Where it does, show the syntax (`[` is a command and `]` its last argument; a wrapper runs its command as a separate program).
- The reference for the language is the GNU Bash Reference Manual (bash 5.2). Check coverage section by section, not with a few examples.

## Design

- [docs/design/semantics.md](docs/design/semantics.md) is the plan: A, command specs read by one argument interpreter (`src/argv/`); B, a semantic model after the manual (`src/semantics/`); C, the bash-ast test. Do not add one-off fields to `src/dict/types.ts` or name checks to `src/analyzer.ts`; extend the spec or the model instead, or say why not.


- Every product parses with the unbash adapter (`src/syntax/adapters/unbash.ts`), and only that file may import unbash (test/syntax-boundary.test.ts); everything else reads the model of `src/syntax/tree.ts`. Tests that explain scripts build the parser with `createUnbashParser()`. tree-sitter was removed (docs/design/syntax-tree.md, step 6).
- No bundle may load or contain wasm; test/offline.test.ts checks it.
- unbash reads `time cmd` as a `time_statement`, `select` as a `select_statement`, `coproc` as a `coproc_statement`, and `(( ))` alone as an `arithmetic_command`. It accepts what bash rejects only at run time (`${x@Z}`, `${#a-b}`, `${(f)var}`: bad substitution), so the analyzer says so itself (`${(f)var}` only when the shell is not zsh; with zsh, the dialect check marks the line as not parsed). It also accepts a bare `echo (`, which bash rejects (a limit, listed in README Limitations).
- A script with CRLF line ends is read with each CR before a LF masked as a space (same length); `SyntaxTree.carriageReturns` lists them and `documentIssues` warns once (`crlf`).
- A statement over several lines that is not a block is explained whole, with no current line (see `sub` in `src/analyzer.ts`).
- `test/bash-ast.test.ts` compares our tree with bash's own parser, through [bash-ast](https://github.com/cv/bash-ast) found in `$BASH_AST` or on `PATH` (skipped without it; CI runs it with the pinned release v0.3.3, and `BASH_EXPLAINER_BASH_AST=1` makes a missing binary fail). bash-ast is GPL-3.0: only run it as a separate program; never vendor, link or bundle it, add it to `package.json`, copy its code, or publish its binary. Accepted differences are in `test/fixtures/bash-ast-known.json`, each with a reason; the test also fails on a stale entry.
- The fuzz test is seeded, and its inputs come from the corpus: adding snippets changes them and can expose a latent adapter bug. Fix the bug (with a test of the input); do not reseed.

## Tests that run bash

- To check whether something runs in a subshell, compare `$BASHPID` with `$$`; `$BASH_SUBSHELL` stays 0 in some subshells (`echo $BASH_SUBSHELL | cat`).
- Feed a tool's stdin through `test/support/run.ts` (a file, not a pipe), so a tool that stops reading early cannot fail with EPIPE.
- In the web tests, type with `keyboard.insertText` (keys typed one by one can arrive out of order in CI), and wait for CodeMirror's selection layer, which is drawn on the next frame.

## Stacked PRs

- `test/fixtures/snippets.json` is generated from the tests: when PRs are stacked, regenerate it at every level, since CI checks each level.

## The semantic model

- The shell state along a script (set and shopt options, variables and their attributes, functions, aliases) comes from `shellState(tree, shell).at(node)` in `src/semantics/state.ts`, with a `run`, a `parse` and an `expand` state (aliases in `$( )`); `assigned` lists the variables some command sets. The analyzer does not scan the script for state. test/state-probes.test.ts compares it with bash on `test/fixtures/probes/state.json`; a fact it does not follow goes in the row's `gaps`, with the reason.
- Where a node runs comes from `shellState(tree, shell).env(node)` (`src/semantics/env.ts`): a chain of subshell, slot and call links, read with `processOf`, `whereOf` and `reachOf`; `slotEnvs` gives the chains of the commands a command's words run. The analyzer does not decide by itself what is a subshell; the walk and the chains share `subshellReasons` and `lastStageInShell`. test/env-probes.test.ts compares it with bash on `test/fixtures/probes/env.json` (a marker is a call of an exported function).
- What bash does to a word in its context (brace, tilde, splitting with the IFS in effect, globbing with the glob options in effect) comes from `wordMeaning(n, state)` and `partMeaning` in `src/semantics/words.ts`, and its fields from `wordFields`; the analyzer does not decide it from node types. test/word-probes.test.ts compares `wordFields` with bash on `test/fixtures/probes/words.json` (gaps as in state.json).
- What a command name runs comes from `resolveName(model, name, at, opts)` in `src/semantics/names.ts` (alias, keyword, function, builtin, file, with the definitions that do not apply and why), and what a prefix assignment does from `assignmentsOf`; the analyzer renders them and does not look up names itself. test/names-probes.test.ts compares it with `type -t` on `test/fixtures/probes/names.json`, gaps in each row's `gaps`.
- A statement's exit status and whether `set -e` stops the shell there come from `statusModel(state).status(n)` and `.errexit(n)` in `src/semantics/status.ts` (it turns errexit off in `$( )` without inherit_errexit, and in the functions called there; the walk of the state does not), and its notes from `src/statusfacts.ts`, once per script; the analyzer does not decide them from node types. test/status-probes.test.ts runs `test/fixtures/probes/status.json` on an evaluator that reads the model (gaps as in state.json).
