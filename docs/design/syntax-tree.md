# The syntax tree, and the parsers behind it

Bash Explainer reads scripts through a syntax tree of its own: [src/syntax/tree.ts](../../src/syntax/tree.ts). A parser library is wrapped by an *adapter*, which turns that library's output into this tree. Nothing else in the code knows which library parsed the script, so the library can be replaced by writing one new adapter.

This page describes the model, its rules, and the move from tree-sitter-bash to [unbash](https://github.com/webpro-nl/unbash).

## Why

The extension was built on tree-sitter-bash, read through web-tree-sitter. That coupling has costs:

- **Upstream is nearly inactive.** The last commit was in December 2025, and 24 PRs are open. We patch the grammar and build the wasm ourselves (`patches/tree-sitter-bash/`).
- **Some misparses need more than a grammar patch.** Example: a line with `&&` after a pipeline ([tree-sitter-bash#347](https://github.com/tree-sitter/tree-sitter-bash/issues/347)).
- **tree-sitter's names and quirks were all over the code.** About 8 files and 1,000 member accesses depended on them:
  - 53 node types and about 90 token strings;
  - `(( ))` parsed as a `compound_statement`, and `select` as a `for_statement`;
  - wasm memory (`tree.delete()`) and node identity (`node.id`) leaked into the code.

unbash parses more scripts correctly (451 of 451 in a sweep of system scripts, against 426), and recovers better from errors. It is young, though: six major versions in eight months, each changing its AST, with a single maintainer. The adapter keeps such changes, and any later switch, in one place.

## The model

`SyntaxTree` holds the text, the root node, and `errors` (each with a message and a range). `BashParser.parse(text)` is synchronous. Loading a library's wasm or modules happens when the adapter is created.

A `SyntaxNode` has:

| property | meaning |
|---|---|
| `type` | the kind of node, a `NodeType`; for a token, its text (`if`, `&&`, `[[`, `>>`) |
| `named` | `false` for tokens (keywords and operators), `true` otherwise |
| `text` | the source text, always from the original text |
| `startIndex`, `endIndex` | offsets in UTF-16 code units, end exclusive |
| `startPosition`, `endPosition` | `{ row, column }`, zero-based, column in UTF-16 code units (as in VS Code and the browser) |
| `parent`, `children`, `namedChildren` | `children` holds tokens and named nodes in source order |
| `field` | the part this node plays in its parent (`name`, `argument`, `left`, `operator`, `body`…), or `null` |
| `incomplete` | the construct is not closed: the user is still typing (`if x; then` with no `fi`) |

Helpers in the same module (`field`, `fields`, `token`, `ancestor`, `descendants`, `hasError`) are the only ways to walk a tree besides these properties.

### Rules every adapter keeps

1. **Every keyword and operator is a token child**, with its own range. The explanation highlights them, and fixes replace them (`==` → `=`). A library that gives no position for them (unbash gives none for `then`, `fi`, `&&`, `[[`…) gets them from the token scanner. The scanner reads the text between the known children, skipping comments, quotes and line continuations.
2. **Every comment is a `comment` node.** Directives live in comments.
3. **Types follow bash, not the library.** The vocabulary is `NodeType`. An unknown name is a type error, so a library's names cannot leak in by accident. Where tree-sitter-bash differed, the adapter normalizes:

   | bash construct | tree-sitter-bash gave | model |
   |---|---|---|
   | `(( … ))` | `compound_statement` starting with `((` | `arithmetic_command` |
   | `[ … ]` | `test_command` starting with `[` | `test_command` |
   | `[[ … ]]` | `test_command` starting with `[[` | `extended_test` |
   | `select x in …` | `for_statement` starting with `select` | `select_statement` |
   | `time [-p] pipeline` | a command named `time` | `time_statement` (token `time`, `option`, `body`) |
   | `coproc …` | a command named `coproc` | `coproc_statement` |
   | `rm !(*.txt)` | a word and a subshell (masked and parsed again) | one `word` with an `extglob_pattern` |
   | text it cannot read | `ERROR`, or a MISSING token | `error` node, or `incomplete` on the open construct, plus an entry in `errors` |

4. **Text is the original text.** If an adapter masks parts of the text before parsing (as the tree-sitter adapter does for extended globs), node texts still come from the original.
5. **Nodes are plain objects.** Nothing needs to be freed, and the same node is the same object, so `===` tells nodes apart.
6. **Errors do not throw.** `parse` always returns a tree. The parts it read are in the tree; the rest is an `error` node, or `incomplete` on the open construct.

### Not in the model

- **Incremental parsing.** The extension never used it: it re-parses a document when its version changes. unbash parses bash_completion (2,291 lines) in about 2 ms.
- **The grouping of `[ … ]` arguments.** `[ ]` and `test` take words at run time. src/testexpr.ts groups them as bash's `test` does, whatever the tree says.

## Where libraries may be imported

Only `src/syntax/adapters/*` may import `web-tree-sitter`, `unbash` or any other parser library. A test checks this, so the boundary does not erode.

## The move to unbash

The move happens in steps, each a PR with the test suite as the safety net. Most of the tests check the explanations, not the tree: 37 of 46 test files never look at a node.

1. **The model and this page.** This PR.
2. **A tree-sitter adapter.** It turns web-tree-sitter's tree into the model, applying the normalizations above. It also takes over the extended glob masking from src/parser.ts.
3. **The consumers read the model.** These are dialect, fixes, pitfalls, hosts and document, then the analyzer, each in its own step where possible. Explanations do not change, and the tests stay as they are, except about 35 assertions that read nodes directly. The import boundary test is added at the end of this step.
4. **An unbash adapter**, with the token scanner and the comment recovery. Pin unbash to an exact version.
5. **A differential run.** Both adapters explain the same scripts: sample.sh, the test fixtures, and a sweep of real scripts. Every difference is either a fix (tree-sitter misread it) or an adapter bug, and gets fixed or recorded.
6. **The switch.** The extension uses the unbash adapter. Then tree-sitter is removed: the tree-sitter adapter, web-tree-sitter, `patches/`, `grammar/`, `scripts/build-grammar.mjs` and their CI step. tree-sitter-bash's quirks no longer need workarounds; CLAUDE.md and the README limitations are updated.

### Known gaps to cover in the unbash adapter

These come from a survey of unbash 6.0.0. The adapter fills them; most are small.

- **No positions for comments, keywords and operators.** The token scanner recovers them (estimated at 400–700 lines with tests).
- **`[ ]` and `test` are plain commands.** The adapter makes `[ … ]` a `test_command`; testexpr does the grouping.
- **Array elements `[k]=v`, tilde words and `=~` right sides are plain words.** The adapter splits them where the explanations need it.
- **Unclosed compound commands come out with zero width.** For `if x; then`, `{ echo` and `case x in a)`, the adapter extends them to what follows and marks them `incomplete`.
- **`echo a |` drops the whole pipeline**, and a heredoc with no closing line raises no error. These are errors the adapter reports itself.
- **Escaped backquotes inside backquotes** get positions in the decoded text. The adapter maps them back.

### Risks

- **unbash's AST changes with each major version.** Pin the version. An upgrade touches only the adapter, and the differential run and the tests check it.
- **Converting tree-sitter's tree into objects costs time on each parse.** It only matters until the switch.
