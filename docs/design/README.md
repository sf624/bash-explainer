# Design documents

Design documents and plans for Bash Explainer. The code is the authority: when a page and the code disagree, the code is right, and the page needs a fix. When a document's status changes, update its row here too. The order in which the plans are taken up is in [../roadmap.md](../roadmap.md).

## Foundations

| Document | Covers | Status |
| --- | --- | --- |
| [syntax-tree.md](syntax-tree.md) | The syntax tree of our own, the adapter around the parser (unbash), and bash's granularity for commands | Built. Tree-sitter removed (#90, #91); command nodes at bash's granularity (#257, #259, #260, #262–#265) |
| [semantics.md](semantics.md) | Command specs and the semantic model of bash (state, environment, words, names, status, conditions), and the bash-ast test | Built. Its "As built" sections say where the code differs from the design |

## Plans

| Document | Covers | Status |
| --- | --- | --- |
| [refactor.md](refactor.md) | One source per fact: the 55 review findings and the steps that fixed them | Built. All steps done (last: #253); kept as the record |
| [analyzer.md](analyzer.md) | Thinning `src/analyzer.ts` into modules in `src/explain/` | Built. All steps done (last: step 9, the dispatch, #354): `src/analyzer.ts` is the orchestration only (100 lines); kept as the record of the moves |
| [oracles.md](oracles.md) | Checks against real bash for the layers above the syntax: argv capture, suggestion verification, normalization audit | In progress. Step 1 (inventory) done (#273); steps 2–10 not started |
| [bash-versions.md](bash-versions.md) | Explaining a script as bash 5.3 runs it, beside the 5.2 reference | In progress. Step 1 (setting, `${ }` and `${| }`) done (#283), steps 2 (printf), 4 (builtin options), 5 (variables, shopt options), 6 for `test`, and 7 (the 5.3 manual) done; step 3 and the rest of 6 not started |

## Features

| Document | Covers | Status |
| --- | --- | --- |
| [bats.md](bats.md) | bats test files as a host kind | In progress. Host kind (#202), bats functions as specs (#222), the model per test and the hooks (#381) built; bats-assert and tags not done |
| [tree-view/README.md](tree-view/README.md) | The Reading view: names, colours, the eight steps, motion and anchoring | Built. Records the prototypes and the choices made |
| [theme-colours.md](theme-colours.md) | The panel's colours from the editor theme (`bashExplainer.panel.colors`): reading the theme as VS Code does, and "themeLike", which keeps the panel's distinctions | Built |
| [hover.md](hover.md) | What the hover explains at a position (the part, a line card, the whole line), its views without tree glyphs, the Language Server's hover, and the web page's cards | Built (#317; the web page: #359) |
| [name-kind.md](name-kind.md) | What a command name is (keyword, builtin, function, alias, program): the badge in both panel views, and the other meanings of the same name | Built. Records the three options and why C |
| [note-levels.md](note-levels.md) | How much a note matters (warning, info, note): the definition, the level of every pitfall, and how the panel, the hover, the CLI and the problems show it | Built (#320). Notes are data with their level, which the views read, and every warning and caveat is a problem ("Notes as data", "Notes as problems") |
| [expansion-values.md](expansion-values.md) | The value of an expansion where the script fixes it, in Meaning: which forms, when the model may say it (the trust of the decisions), how each output shows it, and the tests against bash | Built (#356); the maintainer's decisions and a corpus in section 6; what is left is in the roadmap |
| [highlighting.md](highlighting.md) | Syntax colouring from the tree and the models: what is coloured, semantic tokens over a TextMate injection, one provider per document, the switch per language, speed; the shebang's own token type | Built (#321, on by default). Dead code not faded yet |
| [trust-per-position.md](trust-per-position.md) | What decisions and values may rely on, per position instead of per script: what each cause of blindness can change in bash, the rule (a taint on the paths after it, loops, hidden calls of functions, subshells, traps, jumps), the data model, the tests, and the gain measured again | Deferred (2026-10-26): steps 1–4 moved to the end of the roadmap's "Next", for their small gain; step 0 (wrong values and dead code of today's model) done in #382 |
| [trust-allow-list.md](trust-allow-list.md) | What decisions and values may rely on, as a strict allow-list: every construct (node types, builtins and their options, `set` and `shopt` options, bash's own variables, expansion operators) has an effect in a table, and one the table does not have makes the script trust nothing; the holes this closes, the tables, the cost measured with a prototype, the tests and the steps | In progress: step 1 done (2026-10-26) |
