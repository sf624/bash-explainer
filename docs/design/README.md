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
| [analyzer.md](analyzer.md) | Thinning `src/analyzer.ts` into modules in `src/explain/` | In progress. Step 0 (guards and snapshot, #275) and step 1 (facts the models own, #308) done; steps 2–9 not started |
| [oracles.md](oracles.md) | Checks against real bash for the layers above the syntax: argv capture, suggestion verification, normalization audit | In progress. Step 1 (inventory) done (#273); steps 2–10 not started |
| [bash-versions.md](bash-versions.md) | Explaining a script as bash 5.3 runs it, beside the 5.2 reference | In progress. Step 1 (setting, `${ }` and `${| }`) done (#283); steps 2–7 not started |

## Features

| Document | Covers | Status |
| --- | --- | --- |
| [bats.md](bats.md) | bats test files as a host kind | In progress. Host kind (#202) and bats functions as specs (#222) built; per-test model, hooks, bats-assert and tags not done |
| [tree-view/README.md](tree-view/README.md) | The Reading view: names, colours, the eight steps, motion and anchoring | Built. Records the prototypes and the choices made |
| [theme-colours.md](theme-colours.md) | The panel's colours from the editor theme (`bashExplainer.panel.colors`): reading the theme as VS Code does, and "themeLike", which keeps the panel's distinctions | Built |
| [name-kind.md](name-kind.md) | What a command name is (keyword, builtin, function, alias, program): the badge in both panel views, and the other meanings of the same name | Built. Records the three options and why C |
