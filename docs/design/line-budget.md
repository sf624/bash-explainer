# One line must not stop the whole tool

Status: done (roadmap item of 2026-11-03). Every product runs the explanations synchronously, on the extension's or the page's only thread, and JavaScript cannot stop its own code from outside. So what a line costs must be bounded from inside, and a failure on a line must stay on that line.

## What a failure does

`src/failures.ts` has one function for an exception nothing was meant to throw: `contained(where, run, instead)`.

| Boundary | Where | What is said |
| --- | --- | --- |
| An example | `exampleRun` (src/examples/commands.ts), for every example of a line; `rerun` for what the panel runs again | the example with the note `example-failed`, in place of its output |
| A line | `Analyzer.explainLine`, and `explainDocumentLine` for what a host file adds | one token of the line's text, and the note `line-not-explained` |
| A document | `allIssues`, `deadCodeHints`, `documentHighlight` | nothing of what failed: the lines' own problems stay |

A refusal of the budget is no failure: `guarded` catches it where it is said. A failure goes to a sink each product chooses (`failuresGoTo`): an output channel made on the first failure (VS Code), `window/logMessage` (Language Server), standard error (the command-line tool), the console (web page). Each is told once per stack (`loggedOnce`).

The command-line tool prints what it can and exits with status 2, the status it had when it stopped with a stack: the failure is no finding about the script, and a check that could not read a line has not passed.

This must not hide bugs. `.mocharc.cjs` loads `test/support/failures-throw.ts`, which turns the boundaries off (`failuresThrow(true)`), so an unexpected throw fails its test, in the corpus and fuzz tests as anywhere. test/line-budget.test.ts plants a throw and shows both sides. The boundaries of a run with `--no-config` are on: run the whole suite, or set them in the test, before believing a clean run of one file.

The first run of the corpus and the table with the boundaries on found `jq -R 'test("^(?i)foo")'`: a regex of Oniguruma's syntax, which `new RegExp` rejects. It is unsupported now, no example, as other syntax the runner lacks.

## What a line may cost

All costs are in the steps of the regex engine (`walk`, src/examples/regexguard.ts), and no clock is read: what is computed is the same on every machine. A step takes 3 to 9 ns, by the kind of pattern.

| Limit | Value | Of what |
| --- | --- | --- |
| `LIMIT` | 1e7 | one `guarded` (one example) |
| `LINE_LIMIT` | 3e7 | all the examples of one line (`withinLine`) and, again, all the results of their panels (`guardedResult`) |
| `DOCUMENT_LIMIT` | 2e9 | the examples of all lines: a line's limit is a share of it, by the document's lines of code |
| `MODEL_LIMIT` | 1e7 | one thing a model works out (`guardedApart`) |
| `DOCUMENT_MODEL_LIMIT` | 6e7 | a share of it for each place one can be: a `${`, a test's `==`, a `)`, a line. Never less than 2e4, what an ordinary `${f%.*}` takes: past that, a very long script costs by its size. An expansion refused once is not run again with the same values (`ValueSource.refused`) |
| `VALUE_LIMIT` | 65536 characters | a variable's value in the model: past it, not known. `DOCUMENT_VALUE_LIMIT`, 4e7, shares it among the same places, down to 1024 |

Why these parts:

- **The models have their own limit, charged to nothing.** What they work out is kept for the whole document (`sourceValue`, `wordMeaning`, a status), so a refusal that depended on the line asking first would stay for every other line: the forward and backward runs would differ. So a model's `guardedApart` depends only on its input and on the document's size. The cost is bounded by the number of places, not by a line's account, and a value past its limit is "not known", no more.
- **The examples share a line's account, and the examples never feed the models.** So `lean` (no examples, `noteIssues`) gives the same notes as the whole explanation: test/line-budget.test.ts compares them over the corpus.
- **A document's share comes from its text, not from what ran.** A counter that ran down over a document would make a line's explanation depend on the lines asked before it: the hover and the panel would differ. A share is a function of the document's size only, so a line is explained the same in every product and in any order. Adding lines to a long script can make a line's limit smaller; it says why (`budget-not-computed`).
- **A result of the panel has its own account.** `interactive.result` is the example run again. It ran inside the example's limit, so `x=a…a!`, `[[ $x =~ (a+)+$ ]]` showed the example, and "Not computed" in the panel. Now it is apart: where the line's results have no more left, there is no `interactive`, and the panel shows the example as it is. A refusal there never touches the example.

What the corpus costs: the examples of a line take 564 steps at the 90th percentile, 24,276 at the 99.9th, and 183,057 at most, and their panels' results about as much; a document of 5,000 lines of code leaves each line 4e5.

## Runners

| Runner | Steps | Size |
| --- | --- | --- |
| jq | each node, 1e5 a run | what each node makes (`sizeOf`: all its depths, a part held twice counted twice, as printing it would make), the items of a `range`, a `.[n] = v` past the end, a string's `*` |
| awk | each statement and expression, 2e5 a run | a concatenation, what is printed, `split`'s elements, `$n` and `NF` past the end |
| perl | each statement and expression, 1e5 a run | `.`, `x`, what is printed. `1..n` was limited already |
| sed | no loops: `b` and `t` are not run | what `s` makes |

The bounds a run had before stay, but they say so now (`steps-not-computed`), where the example just went away. Each step and each character is charged to the same limit as the regexes, `STEP_COST` a step.

A process abort is out of reach of `try`: charging the size before a value is made is what makes it impossible. The table of test/support/line-budget-table.ts runs in a child under a memory cap, and fails on a run that aborts, or that takes long.

## What it costs

Measured under tsx, on the maintainer's machine, before and after:

| Case | Before | After |
| --- | --- | --- |
| 30 refused greps on a line | 1.7 s | 0.35 s |
| 11 refused expansions on a line | 0.9 s | 0.7 s |
| 12 examples at a limit each, with their results | | 0.4 s |
| `x=$x$x` × 24 | 54 s, 1.9 GB | 0.23 s |
| `jq -n '[range(1e9)] \| length'`, `reduce range(28) … .+.` | process abort | 50 ms |
| 5000 lines, a different adversarial grep on each: problems; all lines' explanations | over 90 s; not finished | 7 s; 19 s |
| 5000 lines, a different adversarial expansion on each: problems; all lines' explanations | | 5 s; 10 s |
| 3000 ordinary lines of 90 characters: problems; all lines' explanations | 17 s; 13 s | 9 s; 10 s |
| the corpus, en and ja | 20 s | 16 s, byte-identical |

So a line costs at most 3e7 steps of examples, 3e7 of results and its share of 6e7 of the models: 0.1 to 1 s by the kind of pattern, on top of the explanation itself. No line of the corpus is refused.

## What it does not bound

The explanation of a line without its examples: the walk of its nodes, the pitfalls and the rest, about 2 to 5 ms a line (under tsx). It grows with the line's size and is not refused. The worst measured: one line of 3000 expansions, 60 KB, takes about 20 s, and 40 s more for the panel's Reading tree (`all.find` for each command in src/reading.ts).
