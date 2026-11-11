# Design documents

Design documents and plans for Bash Explainer. The code is the authority: when a page and the code disagree, the code is right, and the page needs a fix. A page holds decisions and steps, not progress: the status of open work lives on the board ([../roadmap.md](../roadmap.md)), so an open plan links its issue, and a finished one says once which PRs did it.

The pages are in three groups. **Reference** pages describe what is built and are kept true. **Open plans** have steps left, each tracked in an issue. **Records** are finished plans, or plans whose last steps were dropped ([../backlog-archive.md](../backlog-archive.md)), whose decisions still explain the code; they are not edited for progress.

## Reference

Living pages: the design of what the code does now.

| Document | Covers |
| --- | --- |
| [syntax-tree.md](syntax-tree.md) | The syntax tree of our own, the adapter around the parser (unbash), and bash's granularity for commands |
| [semantics.md](semantics.md) | Command specs and the semantic model of bash (state, environment, words, names, status, conditions), and the bash-ast test |
| [bash-versions.md](bash-versions.md) | Explaining a script as bash 5.3 runs it, beside the 5.2 reference |
| [line-budget.md](line-budget.md) | One line must not stop the whole tool: what a failure does (`src/failures.ts`), and what a line and a document may cost (`src/examples/regexguard.ts`) |
| [theme-colours.md](theme-colours.md) | The panel's colours from the editor theme (`bashExplainer.panel.colors`): reading the theme as VS Code does, and "themeLike", which keeps the panel's distinctions |
| [trust-allow-list.md](trust-allow-list.md) | What decisions and values may rely on, as a strict allow-list: every construct (node types, builtins and their options, `set` and `shopt` options, bash's own variables, expansion operators) has an effect in a table, and one the table does not have makes the script trust nothing; the holes this closes, the tables, the cost measured with a prototype, the tests and the steps |
| [note-levels.md](note-levels.md) | How much a note matters (error, warning, info, note): the definition, the level of every pitfall, and how the panel, the hover, the CLI and the problems show it |
| [bats.md](bats.md) | bats test files as a host kind |

## Open plans

Steps left. Their status and order are on the board, in the issues linked here.

| Document | Covers | Issues |
| --- | --- | --- |
| [sources.md](sources.md) | Every fact and its one source: the diagnosis (a source exists, nothing forces callers to use it), design before wording (the model is the source; a text changes rather than the model growing a special case), the table of facts with their sources, guard tests, offenders and stages, the machinery kept only for a wording, the stages (SA: guard tests now; SB: prerequisites inside the UX steps; SC: the migrations after 0.10.0), and the rule for new facts | #674, #675, #676, #677, #678, #679 (stage SC) |
| [word-source.md](word-source.md) | One source for what bash makes of a word (fields, count, quoting per character, globbing, literal start, tildes, braces): the inventory of the 25 places that decide it again outside src/semantics/words.ts, the one view they should read, a test that fails on a new one, the steps, and which of them can wait until after the UX work | #674 |
| [one-colour-source.md](one-colour-source.md) | The editors' colours from the explanation's tokens, the panel's own source: which tokens, one table of role to colour (and every table that still decides one), what a line and a script cost and a bound per line, the lines in view in slices with the tree as the cache, host files and lines that cannot be read, VS Code's semantic tokens, what goes from src/highlight.ts | #672 |
| [python-regex.md](python-regex.md) | The patterns of Python's `re` calls in `.py` files: the first part of a host file that is not shell code (`Extracted.languages`, the seam in `explainDocumentLine`, a line's explanation without a shell tree, Problems, the chip, the setting), the `python` flavor, the pattern literal and its places, flags and functions, examples, the tests against python3, the version notes, what is left out, the steps | #763, #759, #748, #760, #749, #750, #751, #752, #753 |
| [usability-9.md](usability-9.md) | Usability toward 9/10: the findings of the usability test of 2026-11-06, each reproduced on main at the release, with its cause in the code and its cost, ranked; the fixes from the existing sources, the steps U1 to U11 as PRs (U8, the phone's sheet, needs a check on a real device; U12 and U13 dropped), the maintainer's questions, how the test runs again, and the results of run 3 (2026-11-08: the goal is not met) | label `usability-9`: #647, #648, #649, #650, #659, #660, #720, #721, #761 |

## Records

Finished plans. The code and its tests cite their sections, so they stay where they are.

| Document | Covers | Done |
| --- | --- | --- |
| [large-scripts.md](large-scripts.md) | Long scripts whose functions call each other from many sites: the measurements on nvm.sh and generated dispatchers (where the time goes, the states per node, the merge calls), a cheaper merge of the states a node ran with (one fold, lazy in `at()`, and why its results stay the same; the eager one pass in the walk measured and dropped), the guards, what was measured or left out (the second walk, kept; `notWalked` and `widen`, #836; calls with prefix assignments, #830; idle chunks, a Web Worker, stale results), the risks, the steps and the maintainer's decisions (the colours of the lines in view go to #672) | Done (#829, #831, #832, #833, #834) |
| [known-values.md](known-values.md) | A variable's known value read in the language of the command that uses it (`p='/^BEGIN/,/^END/p'; sed -n $p f`): what we say today and why, when a value is known (the values of Meaning, one field by the word model, a glob where no file matches), one reading of the command for both lines, the reading on the use (under its value line), `[[ $x =~ $re ]]`, the reading on the assignment (one reading, several, errors), cost, the new facts and their guards, tests against the tools, what is left out, the steps | Done (#818, #821, #822, #824, #825) |
| [errexit-stop.md](errexit-stop.md) | Step U11 of usability-9.md: on each line whose command can stop the script under `set -e`, one note that says it stops there, which EXIT and ERR traps run (with their lines) and the exit status; what bash does (measured in 5.2 and 5.3), which lines, the texts, where they show and what they replace, the length on the panel, what the models lack (the traps in effect at a point, builtins that fail only on a usage error, calls, a trap's action), the tests and the steps | #767, #774 |
| [analyzer.md](analyzer.md) | Thinning `src/analyzer.ts` into modules in `src/explain/` | Done (#275, #308, #324, #325, #327, #329, #330, #333, #334, #338, #339, #340, #348, #349, #354) |
| [panel-redesign.md](panel-redesign.md) | One view with a depth instead of the tabs Meaning and Reading (prototype B, round 11): "In short", the problems first with a fix to copy, what each program receives; what to keep of the prototype, the steps as PRs, the view slot shared with the web page's chrome, and the usability test | Done (P1 to P10: #538, #543, #560, #563, #566, #568, #589, #595, #600, #604, #605, #606, #609) |
| [chrome-redesign.md](chrome-redesign.md) | The web page around the panel (prototype round 8, `proto/chrome-8`): a quiet app bar, the editor's header with the file and one chip for its type and shell, the Problems strip, toasts in one place, settings, the panel's header with one depth control, and the phone's sheet and keyboard; what to keep of the prototype, the steps as PRs, how they fit with the panel redesign, and the checks on real phones | Done (C0 to C9: #531, #539, #548, #555, #545, #544, #562, #546, #561, #567, #571, #611, #613) |
| [basis.md](basis.md) | The basis of an explanation as data (the manual's sections, bash's behaviour checked by a probe, behaviour that differs from the manual, another tool's spec, a convention): where it comes from (the probe rows, with a try-it each, copied for the explanations), the chip and the folded "Try it in your terminal", the setting, and the steps | Done (#441, #442, #447, #448, #450, #452, #451, #460) |
| [basis-spec-convention.md](basis-spec-convention.md) | Step 5 of basis.md: what `spec` and `convention` mean as data, where they come from and what carries them; the size of the CLI's JSON; the audit of every style check and catalog pitfall (fact, convention, or both); the steps and the decisions | Done (#450, #452, #451) |
| [hover.md](hover.md) | What the hover explains at a position (the part, a line card, the whole line), its views without tree glyphs, the Language Server's hover, and the web page's cards | Done (#317, #359) |
| [name-kind.md](name-kind.md) | What a command name is (keyword, builtin, function, alias, program): the badge in both panel views, and the other meanings of the same name | Done |
| [expansion-values.md](expansion-values.md) | The value of an expansion where the script fixes it, in Meaning: which forms, when the model may say it (the trust of the decisions), how each output shows it, and the tests against bash | Done (#356); the rest dropped 2026-11-06 |
| [highlighting.md](highlighting.md) | Syntax colouring from the tree and the models: what is coloured, semantic tokens over a TextMate injection, one provider per document, the switch per language, speed; the shebang's own token type | Done (#321) |
| [tree-view/README.md](tree-view/README.md) | The Reading view: names, the panel's look, motion and anchoring | Replaced by [panel-redesign.md](panel-redesign.md) (P8) |
| [three-levels.md](three-levels.md) | Three levels of problems, as VS Code and SARIF have: Error (fails every time as written), Warning (damage that cannot be undone, or a failure turned into success) and Info; the rule, the level of every check, every output, what fails `--check`, the steps (step 0: a bash inventory first) and the tests against bash | Done (#424, #536, #540, #547, #549, #552, #557, #558, #602) |
| [oracles.md](oracles.md) | Checks against real bash for the layers above the syntax: argv capture, suggestion verification, normalization audit | Done (steps 1 to 9: #273 to #485); step 10 dropped 2026-11-06 |
| [count-hedges.md](count-hedges.md) | The hedges of words whose count is not known (an unquoted `$a` gives none, one or several words): every count of every such word read together, classes of readings, conditions that hold for every count they name; the cases today's hedges get wrong, checked with the tools; the cost, the alternatives, the steps | Done (steps 1 to 5: #499, #500, #502, #505, #516); steps 6–7 dropped 2026-11-06 |
| [trust-fields.md](trust-fields.md) | When a builtin's words that expand at run time (`printf $x u 2`, `declare $x`, `getopts -- $o`) may be trusted: one rule from what each field of a word may be (its literal start and end, its count, the kinds of its holes), asked of the builtin's spec reader, with the values a variable may have and the facts of time and scope stated apart; the special cases of #498 and #501 it replaces, each past counterexample under the rule, the gain measured, the steps | Done (step 0: #504; step 1: #506); the rest dropped 2026-11-06 |
| [trust-per-position.md](trust-per-position.md) | What decisions and values may rely on, per position instead of per script: what each cause of blindness can change in bash, the rule (a taint on the paths after it, loops, hidden calls of functions, subshells, traps, jumps), the data model, the tests, and the gain measured again | Done (step 0: #382); steps 1–4 dropped 2026-11-06 |

## Removed

Deleted from the tree; the history keeps each one at its last commit:

- [refactor.md](https://github.com/sf624/bash-explainer/blob/5efa326aa187cce038224f4e984e146c467786ee/docs/design/refactor.md): one source per fact, the 55 review findings of October 2026 and the steps that fixed them (all done, last #253). The plan now is [sources.md](sources.md).
- [function-constants.md](https://github.com/sf624/bash-explainer/blob/9ba27ecd0aff4ed83f73dd52dd6f3dfbbb73e810/docs/design/function-constants.md): values inside function bodies the walk does not follow at every call. Deferred 2026-10-27, no gain measured; not built.
- [source-files.md](https://github.com/sf624/bash-explainer/blob/b8723398acf3f1286bfc5a56aefc8268ee8bca1b/docs/design/source-files.md): reading the files given to `source` and `.`. Deferred 2026-10-27, low gain measured (3 of 846 scripts); not built.
- [tree-view prototypes](https://github.com/sf624/bash-explainer/tree/ba115e963cd42c13f352d743f3f2aeba951ba81e/docs/design/tree-view): the three prototypes (A, B, C) of the Reading view, their data and screenshots, removed with the view in P8; [tree-view/README.md](tree-view/README.md) keeps what still holds.
