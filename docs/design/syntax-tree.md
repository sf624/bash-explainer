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

`SyntaxTree` holds the text, the root node, and `errors` (each with a `kind`, a message and a range). The `kind` is `missing` (a token the grammar expects is not there; the open construct is `incomplete`, and the error is a place of no width) or `unreadable` (text the parser could not read; there is an `error` node over it). An adapter lists a place once: tree-sitter's empty `ERROR` leaf after a trailing `\` is not an error entry. `BashParser.parse(text)` is synchronous. Loading a library's wasm or modules happens when the adapter is created.

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
   | `[ … ]` | `test_command` starting with `[`, holding binary, unary and parenthesized expressions | `test_command`: the tokens `[` and `]`, and between them a flat list of words (`word`, `string`, `raw_string`, `expansion`, `concatenation`…); operators and parentheses (`-f`, `=`, `-a`, `(`) are `word`s too |
   | `[[ … ]]` | `test_command` starting with `[[` | `extended_test` |
   | `select x in …` | `for_statement` starting with `select` | `select_statement` |
   | `time [-p] pipeline` | a command named `time` | `time_statement` (token `time`, `option`, `body`) |
   | `coproc [NAME] command` | a command named `coproc` | `coproc_statement`: the token `coproc`, the `name` (a `word`, if there is one) and the `body` (a command, or a compound command such as `{ …; }`) |
   | `rm !(*.txt)` | a word and a subshell (masked and parsed again) | one `word` |
   | text it cannot read | `ERROR`, or a MISSING token | `error` node, or `incomplete` on the open construct, plus an entry in `errors` |

4. **Text is the original text.** If an adapter masks parts of the text before parsing (as the tree-sitter adapter does for extended globs), node texts still come from the original.
5. **Nodes are plain objects.** Nothing needs to be freed, and the same node is the same object, so `===` tells nodes apart.
6. **Errors do not throw.** `parse` always returns a tree. The parts it read are in the tree; the rest is an `error` node, or `incomplete` on the open construct.

### Not in the model

- **Incremental parsing.** The extension never used it: it re-parses a document when its version changes. unbash parses bash_completion (2,291 lines) in about 2 ms.
- **The grouping of `[ … ]` arguments.** `[ ]` and `test` take words at run time, so a `test_command` has no binary, unary or parenthesized expression: the tree-sitter adapter opens tree-sitter's groups. src/testexpr.ts groups the words as bash's `test` does, and the analyzer and pitfalls read only that. (`[[ … ]]` keeps its expressions.)
- **What `time` binds.** A `time_statement` has a `body`, which is a command or the whole pipeline after `time`, as in bash. The commands in it are explained, and checked for dialect and pitfalls, like any other.

## Known tree-sitter residue

The tree-sitter adapter leaves these as tree-sitter gives them, and the analyzer still has code for them. The unbash adapter does not need to reproduce them, and the code can go with tree-sitter:

- **A command with a name of no width** for `FOO=1 2>/dev/null` (the analyzer's `commandToken`). It is explained as an assignment in the shell.
- **`$"…"` as a `$` token and a `string`** (the analyzer's `string`), where the model has `translated_string`. The analyzer joins the two for the label and the range.
- **Redirections with no children**, the residue of a MISSING operator (`[range(2)] | x`). The analyzer's `redirected` leaves them out.
- **A command name with no word** in `echo a |` (the analyzer's `pipelineExample` accepts a `command_name` with no named child).
- **A `[ ]` with no `]`** (`bracketTest` takes the `]` only if it is there).
- **`>&-` and `<&-` as one operator** (the analyzer's `redirectParts` splits them into `>&` and `<&` to `-`).
- **`${` after a space inside a string**, which tree-sitter starts at the space (the analyzer's `expansion` trims it and moves the range).
- **A `time` with nothing to time before a pipe** (`time | wc`) stays a command named `time` (the analyzer's `timeAlone`).

## Where libraries may be imported

Only `src/syntax/adapters/*` may import `web-tree-sitter`, `unbash` or any other parser library; `cli/` and `web/` make their parser with the adapters' exports. A test checks this, so the boundary does not erode.

## The move to unbash

The move happens in steps, each a PR with the test suite as the safety net. Most of the tests check the explanations, not the tree: 37 of 46 test files never look at a node.

1. **The model and this page.** This PR.
2. **A tree-sitter adapter.** It turns web-tree-sitter's tree into the model, applying the normalizations above. It also takes over the extended glob masking from src/parser.ts.
3. **The consumers read the model.** These are dialect, fixes, pitfalls, hosts and document, then the analyzer, each in its own step where possible. Explanations do not change, and the tests stay as they are, except about 35 assertions that read nodes directly. The import boundary test is added at the end of this step.
4. **An unbash adapter**, with the token scanner and the comment recovery. Pin unbash to an exact version.
5. **A differential run.** Both adapters explain the same scripts: sample.sh, the test fixtures, and a sweep of real scripts. Every difference is either a fix (tree-sitter misread it) or an adapter bug, and gets fixed or recorded.
6. **The switch.** Part 1 is done: the extension, the language server, the command-line tool and the web page use the unbash adapter, no bundle loads wasm, and the tests that explain scripts build the unbash parser (the items under "To do at the switch" are done, below). Part 2 removes tree-sitter: the tree-sitter adapter, web-tree-sitter, `patches/`, `grammar/`, `scripts/build-grammar.mjs` and their CI step. tree-sitter-bash's quirks no longer need workarounds; CLAUDE.md and the README limitations are updated.

### Known gaps to cover in the unbash adapter

These come from a survey of unbash 6.0.0. The adapter fills them; most are small.

- **No positions for comments, keywords and operators.** The token scanner recovers them (estimated at 400–700 lines with tests).
- **`[ ]` and `test` are plain commands.** The adapter makes `[ … ]` a `test_command` with its words as a flat list; testexpr does the grouping.
- **Array elements `[k]=v`, tilde words and `=~` right sides are plain words.** The adapter splits them where the explanations need it.
- **Unclosed compound commands come out with zero width.** For `if x; then`, `{ echo` and `case x in a)`, the adapter extends them to what follows and marks them `incomplete`.
- **`echo a |` drops the whole pipeline**, and a heredoc with no closing line raises no error. These are errors the adapter reports itself.
- **Escaped backquotes inside backquotes** get positions in the decoded text. The adapter maps them back.

### The unbash adapter

`src/syntax/adapters/unbash.ts` builds the model from unbash's AST, and `src/syntax/adapters/tokens.ts` finds what unbash does not position (comments, keywords, operators) in the text between the nodes it does. unbash is a dependency of every bundle since the switch (step 6, part 1). How it is checked:

- **The oracle** (test/syntax-adapter-unbash.test.ts, with test/support/oracle.ts): both adapters build the model of the shell code of the fixtures and of the snippets the tests pass to the parser or the analyzer (test/fixtures/snippets.json, made by scripts/extract-snippets.ts), and the trees are compared node for node. `npx tsx scripts/syntax-oracle.ts` runs it by hand (`-v` for the first difference of each input, `--causes` to group them, `-e 'script'` or file names for other input).
- **The differences are listed** in that test, with their reasons, and the test fails if one is no longer there. Where tree-sitter is wrong (#347, `for i do`, `coproc`, `<<-` with tabs, a here string after `}`, unfinished input…), the test holds the tree unbash must give.
- **Soundness**: every tree, also of text that is not bash, has children inside their parent and in order, and texts and positions that fit the source.

What the adapter does beyond a change of names:

- **Positions of tokens.** A node's gaps (the stretches between its children) are scanned for tokens and comments. A heredoc body is skipped. For a `` `…` `` with escapes in it, unbash parses the text without the escapes; the adapter parses that with a converter of its own and maps the positions back.
- **Statements as bash reads them, not as tree-sitter's grammar nests them.** The redirections after the last command of a pipeline or list belong to that command (`echo A && echo B > f` redirects only `echo B`); `!` negates the whole pipeline (`negated_command` over the `pipeline`); `time` is a keyword only at the start of a pipeline (`a | time b` runs the program). A redirection after a compound command belongs to it (`{ …; } > f`). What follows `<<EOF` on its line is parsed as usual: more redirections and arguments belong to the command, and `| cmd`, `&& cmd`, `; cmd` go on as stages and statements. The tree-sitter adapter rebuilds its tree to this shape (`createTreeSitterParser(wasm, { reshape: false })` keeps tree-sitter's own, for tests).
- **A `heredoc_redirect` ends with its body**, which comes after the rest of its line, so the nodes of that line lie inside its range without being its children. It is the only overlap the model allows: the leaves outside bodies are in text order, and no leaf but a body's lies in a body (test/support/oracle.ts, `invariants`). An `else`, an `elif` or a `case` item still ends with the newline of its last statement, and a string is cut into lines.
- **Errors.** Every error of unbash reaches `errors`: text it dropped (`a | | b`, a stray `)`) is an `error` node and an `unreadable` entry; what it found missing (`a >` has no target, `{ }` no command, `if a; fi` no `then`) is a `missing` entry with the construct `incomplete`. A test fuzzes both adapters with prefixes, cuts and words removed from the fixtures (test/support/fuzz.ts): no throw, sound trees, no text left out, and linear time.
- **Unfinished input.** An open construct gets `incomplete` and an error of kind `missing`, and ends where its content ends. For `echo a |` and `echo a &&` the adapter puts the operator back, in a `pipeline` or `list` with `incomplete` and no right side, since unbash drops it. A heredoc with no closing line is `incomplete`, an array with no `)` too. A token unbash drops (`unexpected token ')'`) becomes an `error` node and an error of kind `unreadable`.
- **`[k]=v` in an array, `~/x`, and `$"…"`** are a `word` and a `translated_string` (a `$` and a `string`): the explanations do not need more.

Not reproduced, because tree-sitter's shape is an accident of its scanner, and the consumers cope with both:

- **`extglob_pattern` or `word`** for a plain pattern after `=`/`==` in a test and in a `case` item: tree-sitter's external scanner decides (`y` is a pattern, `ab` a word, `*.txt` a word, `a*` a pattern). The adapter copies its rule as far as it could work it out, so most agree, but not all. The consumers read both types as a pattern.
- **A word cut at `{ } [ ]`**: tree-sitter makes `{src,test}`, `*.[ch]` and `{}` (of `find -exec`) concatenations of single-character words; the adapter keeps one `word`.
- **`{1..10..3}`**: a `brace_expression` with the step (tree-sitter does not read it).
- **A space before an expansion in a string** (see the residue above), **`>&-` as one operator**, **a redirection alone in a substitution**, and **`time` before a pipe with a redirection** (`time a >f | b`).

What unbash does not give, which the adapter does not repair: `echo (` is accepted without an error, and `x=(a b` reports an "unterminated extended glob".

### Risks

- **unbash's AST changes with each major version.** Pin the version. An upgrade touches only the adapter, and the differential run and the tests check it.
- **Converting tree-sitter's tree into objects costs time on each parse.** It only matters until the switch.

### To do at the switch (done in part 1)

Found in the review of the unbash adapter; they needed the analyzer or the build, not the adapter, and waited for step 6. What was done:

- **`echo ${x@Z}`** is explained as a bad substitution, as bash reports it (the letter is an `error` token). `${#a-b}` too, which unbash reads as `$#` with an operator.
- **web/tsconfig.json** no longer overrides `moduleResolution`, so `tsc -p web` finds unbash.
- **CRLF.** The adapter masks each CR before a LF as a space of the same length (`SyntaxTree.carriageReturns` holds where), so a CRLF script is explained as an LF one, and `documentIssues` warns once (`crlf`): bash reads the CR as part of the last word of the line (`fi\r`). A here-document in such a script has no closing line, as in bash.
- **`coproc_statement`** is a feature of dialect.ts.
- **`declare a[1]` and `declare a[@]`** are `subscript` nodes in the adapter, so "Element `[1]` of array `a`" stays.
- **`[ ( a = b ) -o c = d ]`** (a syntax error in bash) is no longer a test; the tests use `\( \)`, which the analyzer groups (and compares with bash).
- **`cat <<EOF; cmd`** is covered in test/analyzer.test.ts as well as in the adapter test.
