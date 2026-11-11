# One line must not stop the whole tool

Status: built (roadmap item of 2026-11-03, #590 and #596); what stays linear in a document's size is in "What it does not bound". Every product runs the explanations synchronously, on the extension's or the page's only thread, and JavaScript cannot stop its own code from outside. So what a line costs must be bounded from inside, and a failure on a line must stay on that line.

## What a failure does

`src/failures.ts` has one function for an exception nothing was meant to throw: `contained(where, run, instead)`.

| Boundary | Where | What is said |
| --- | --- | --- |
| An example | `exampleRun` (src/examples/commands.ts), for every example of a line; `rerun` for what the panel runs again | the example with the note `example-failed`, in place of its output |
| A line | `Analyzer.explainLine`, and `explainDocumentLine` for what a host file adds | one token of the line's text, and the note `line-not-explained` |
| A document | `allIssues`, `deadCodeHints`, `documentHighlight`; what a timer runs: the Language Server's `publish`, the extension's diagnostics and panel | nothing of what failed: the lines' own problems stay |
| A file | `openDocument`, for every product; each file of the command-line tool | a tree that says it was not read (`unread: 'failed'`), and the note `file-not-read` |

A refusal of the budget is no failure: `guarded` catches it where it is said. A failure goes to a sink each product chooses (`failuresGoTo`): an output channel made on the first failure (VS Code), `window/logMessage` (Language Server), standard error (the command-line tool), the console (web page). Each is told once per stack (`loggedOnce`).

The command-line tool prints what it can and exits with status 2, the status it had when it stopped with a stack: the failure is no finding about the script, and a check that could not read a line has not passed. It writes each line as it is made: all the lines of a long file may not fit in one string.

This must not hide bugs. `.mocharc.cjs` loads `test/support/failures-throw.ts`, which turns the boundaries off (`failuresThrow(true)`), so an unexpected throw fails its test, in the corpus and fuzz tests as anywhere. test/line-budget.test.ts plants a throw and shows both sides. The boundaries of a run with `--no-config` are on: run the whole suite, or set them in the test, before believing a clean run of one file.

### The stack

The stack running out is no bug, so it is told to no sink (`stackFull`). It is what a text nested too deep does, and it is caught at three depths:

- **The parser.** `createUnbashParser().parse` never throws for it: it gives a tree with `unread: 'too-deep'`, whose root holds a parse error, so that a string read so makes nothing trusted. The parser keeps nothing from one text to the next. Every line of the file says `file-not-read`, the document has one problem at its first line, and the command-line tool says so once and exits with status 2. A string read as a script that the parser cannot follow is `too-deep`, as a string nested too deep is. This boundary holds for every product, since all of them parse there.
- **A line.** `Analyzer.explainLine` says `line-too-deep`, a problem at the line. What goes deep is the line's own walk, about 50 frames for each level of `$( )`, so a level costs more here than in the parser: `echo "$("$(…` is read and not walked at 200 levels. No one writes that.
- **The trust scan.** `scriptTrust` trusts nothing (`eval 'a;'` 100,000 times); the lines keep their explanations.

How deep the stack goes depends on what the engine has optimised so far, so the exact level is not part of what a line says; the tests stay far from it. Bash runs such scripts: `echo $(echo …` 200 levels prints `a`, and it segfaults only past 3,000 levels of `"$(`. So `line-too-deep` and `file-not-read` are the limit of the tool, and say so. They are no errors, which say that a line fails every time, with a row in the bash test: they are warnings, in no count of `--counts` (`isNotRead`, src/messages.ts), no pitfalls, whatever the pitfalls settings say, and the command-line tool exits with status 2, in text and with `--check`, also with `--strict`; the Action then stops with its annotation, a warning, first among them.

The parser's limit is the stack, and low for a cold engine: `"$(` is read at 200 levels and not at 300 on the first parse of a process, and at 1,500 once the code is optimised; `$(`, `(`, `{` at 10,000. With `node --stack-size=4000` it reads past 5,000. A longer stack in a worker, or an iterative walk, would raise that; not built, as no one writes such a line.

In the extension host a throw from a provider, or from a timer, is logged by VS Code and stops nothing, as far as VS Code's own handler goes; the timers have the boundary too. What it does not protect from is what stops the thread or fills the memory, and for those it has only what this document says about the core, which it shares.

The first run of the corpus and the table with the boundaries on found `jq -R 'test("^(?i)foo")'`: a regex of Oniguruma's syntax, which `new RegExp` rejects. It is unsupported now, no example, as other syntax the runner lacks.

## What a line may cost

All costs are in the steps of the regex engine (`walk`, src/examples/regexguard.ts), and no clock is read: what is computed is the same on every machine. A step takes 3 to 9 ns, by the kind of pattern.

| Limit | Value | Of what |
| --- | --- | --- |
| `LIMIT` | 1e7 | one `guarded` (one example) |
| `LINE_LIMIT` | 3e7 | all the examples of one line, or of one statement over several lines, which is walked once (`withinLine`), and, again, all the results of their panels (`guardedResult`). The calls of a line of a host file's part in another language share it: each call, explained once, has `LINE_LIMIT / crowd`, `crowd` being the number of calls on its most crowded line (`LanguageRegion.crowd`, src/hosts/python.ts) |
| `DOCUMENT_LIMIT` | 2e9 | the examples of all lines: a line's limit is a share of it, by the document's lines of code |
| `MODEL_LIMIT` | 1e7 | one thing a model works out (`guardedApart`) |
| `DOCUMENT_MODEL_LIMIT` | 6e7 | a share of it for each place one can be: a `${`, a test's `==`, a `)`, a line. Never less than 2e4, what an ordinary `${f%.*}` takes: past that, a very long script costs by its size. An expansion refused once is not run again with the same values (`ValueSource.refused`) |
| `VALUE_LIMIT` | 65536 characters | a variable's value in the model: past it, not known. `DOCUMENT_VALUE_LIMIT`, 4e7, shares it among the same places, down to 1024 |

Why these parts:

- **The models have their own limit, charged to nothing.** What they work out is kept for the whole document (`sourceValue`, `wordMeaning`, a status), so a refusal that depended on the line asking first would stay for every other line: the forward and backward runs would differ. So a model's `guardedApart` depends only on its input and on the document's size. The cost is bounded by the number of places, not by a line's account, and a value past its limit is "not known", no more.
- **The examples share a line's account, and the examples never feed the models.** So `lean` (no examples, `noteIssues`) gives the same notes as the whole explanation: test/line-budget.test.ts compares them over the corpus.
- **A document's share comes from its text, not from what ran.** A counter that ran down over a document would make a line's explanation depend on the lines asked before it: the hover and the panel would differ. A share is a function of the document's size only, so a line is explained the same in every product and in any order. Adding lines to a long script can make a line's limit smaller; it says why (`budget-not-computed`).
- **A call of a part in another language has its own account, a share of a line's.** A call of Python's `re` over several lines is explained once, and a line may hold several calls (`re.sub(r'a', 'b', re.sub(r'c', 'd', s))`): its example must not depend on which of its lines asked first, nor on the calls beside it. So each call runs in an account of its own (`withinOwnLine`, with `parts`), of `1 / crowd` of the line's, `crowd` a function of the document only: the calls of any line cost no more together than one line may, and the document's share counts each line once (`languageLines`). test/python-lines.test.ts counts the steps of a line of 30 costly calls, and asks the lines of a call in both orders.
- **A result of the panel has its own account.** `interactive.result` is the example run again. It ran inside the example's limit, so `x=a…a!`, `[[ $x =~ (a+)+$ ]]` showed the example, and "Not computed" in the panel. Now it is apart: where the line's results have no more left, there is no `interactive`, and the panel shows the example as it is. A refusal there never touches the example.

What the corpus costs: the examples of a line take 564 steps at the 90th percentile, 24,276 at the 99.9th, and 183,057 at most, and their panels' results about as much; a document of 5,000 lines of code leaves each line 4e5.

## Runners

| Runner | Steps | Size |
| --- | --- | --- |
| jq | each node, 1e5 a run, and what its own operations walk (`chargeWalk`): the comparisons of a sort, the copy a `del` or a `.[] = v` makes for each path, what `-`, `contains`, `indices`, `==` and `add` read | what each node makes (`sizeOf`: all its depths, a part held twice counted twice, as printing it would make), the items of a `range`, a `.[n] = v` past the end, a string's `*`, a product of objects or strings, a made-up input |
| awk | each statement and expression, 2e5 a run | a concatenation, what is printed, `split`'s elements, `$n` and `NF` past the end |
| perl | each statement and expression, 1e5 a run | `.`, `x`, what is printed. `1..n` was limited already |
| sed | no loops: `b` and `t` are not run | what `s` makes |
| coreutils | the sets of `tr` searched for each character | a set of `tr`. A number from the script sizes nothing past the input: `uniq -f` stops at the end of the line. A made-up input has the columns the command asks for (`cut -f`, `sort -k`, perl's `$F[n]`), up to 4,096 (`sampleColumns`); past that no sample is made, and the example says so (`size-not-computed`) |
| git log | | the padding of `%<(n)` |

A cost is charged before the value is made, and a cost a script's values worked out that is no number, or below zero, gives nothing back (`charge`). Where a better algorithm is cheap, there is one: `-` of simple values uses a set.

The bounds a run had before stay, but they say so now (`steps-not-computed`), where the example just went away. Each step and each character is charged to the same limit as the regexes, `STEP_COST` a step.

What is said twice for a language must not be worked out twice: `s(\`not (${describe(c)})\`, …)` with a recursive call in each language's text is 2^n, as `find . -not -not …` was. A list that grows with the input is not spread into a call: about 120,000 items fill the stack (src/lists.ts; a test looks for it).

A process abort is out of reach of `try`: charging the size before a value is made is what makes it impossible. The table of test/support/line-budget-table.ts runs in a child under a memory cap, and fails on a run that aborts, or that takes long; so do the command-line tool on files that each once stopped it, and a Language Server (test/support/line-budget-lsp.ts). With a number of lines, it measures documents as well, by hand: each takes the whole bound of a document.

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

So a line, or a statement over several lines (one walk, one budget), costs at most 3e7 steps of examples, 3e7 of results and its share of 6e7 of the models: 0.1 to 1 s by the kind of pattern, on top of the explanation itself. The total stays bounded because the limit is a share of the document's, by its lines of code: a statement has at least one, so all the statements together stay within `DOCUMENT_LIMIT` (2e9) for the examples and again for the results. No line of the corpus is refused.

## Reading once

The explanation of a line, without its examples, charges nothing. So what it does must be linear in what it reads. Where it was not:

| Shape | Why | Before | After |
| --- | --- | --- | --- |
| `echo ${x:-${x:-…a…}}` | a `${…}` walks what is nested for its summary, and again for its parts: now the token of the first walk (`explain`, for one line, one command) | 18 levels 11 s, 20 levels past 45 s | 200 levels 1 s |
| `find . -not -not …` | `describe` in each language's text | 25 levels 18 s | 400 levels 70 ms |
| `alias c='b; b'`, 40 levels | each expansion expands the next | past 15 s | at most 20,000 expansions, then nothing is trusted |
| `f2() { f1; f1; }`, 1000 levels | the states an error may end in doubled | past 15 s | 1 s: each state once |
| `f2() { X=1 f1; X=1 f1; }` | a call with a prefix assignment walked the body at every call, without reuse or `WALKS_PER_FUNCTION` | 16 levels 3 s, 18 levels 18 s | 30 levels 12 ms: each state once, as without the prefix. A walk is reused for the same entry (with the prefix assignments) and the same frame (what they hide, which the call restores): `walkOrReuse`, src/semantics/walk/walker.ts |
| `a && a && …` 2,000 times, and the lines around it | the walk ran out of stack, and was built again for each line | each line failed | one model that knows nothing, built once; that line says it is too deep, the others stand |
| `[[ a && a && … ]]`, `\|\|`, `[ a -a a -a … ]` | each level walked its operands twice (`binary`, src/explain/tests.ts) | 20 operands 5 s, 24 operands 80 s | 40 operands in milliseconds: each operand once |
| `sudo sudo …`, `command command …` | each reads all the words after it | 400 levels 14 s | past 16 commands that each run the next (the 17th says so, for `command` as for `sudo`), the words are only words, and say that this tool does not read them. (The model's own walk past `command` and `builtin` stops at 8 levels, `MAX_WRAPPERS`, and knows no command name there; that says nothing.) The limit costs what it reads: 400 levels 1.2 s at 16, 2.2 s at 64, no 2^n |
| `eval eval …` | a string read in a string | past 15 s at 4,000 | as deep as the walk reads strings (8), then nothing is trusted |
| `sed -e … -e …` | each makes the example of the whole script | 400 times 9 s | 4,000 times 2 s |
| `bash -c 'bash -c …'`, `'a'\''b'…` | the parts of a word looked at for each part | 10 levels past 25 s | 1 s |
| `a b c …`, `a; b; c`, `"$x$x…"`, a heredoc's `${y:-b}` | each word looks at the others: `wordOf`, `placeOperands`, `listOperator`, `mayStopAround`, `holeOf`, the Reading tree | 8,000 words 40 s | linear, about 1 ms a word |
| 4,000 lines of `\` continuations, or of a here-document | each line of a statement explains all of it | problems 64 s, first line 27 s | all lines 0.5 s, one walk: each line reads the statement's explanation, kept for the document (`Whole`, below) |
| A host file of 1,000 lines | each line looked for its region, its pipes, its names and its bats tests over the whole file | 30 s | 4 s |

### A statement over several lines

A statement over several lines that is not a block is explained whole by each of its lines, and it must stay so: its command, what it does, where it started. A first answer to the square that makes, explaining each line past 64 lines only its part, lost that for 16% of real scripts over 64 lines: raw node names on the lines of a long here-document, no sentence on any line of a long loop, nothing on line 40 of an `awk '`. So nothing depends on a statement's size. What ended the square is that the lines read one walk:

- `Explainer.whole` asks for the statement's `Whole` (src/explain/whole.ts), kept by the node, on the script's model and what else a walk reads (`lang`, the shell, the options that change it). It is walked once, in a context of its own and on a budget of its own, so that it is the same whichever line asks first. What fails (too deep) fails the same way, and is not walked again.
- Its token is finished there and frozen (`keep`, src/tokenkept.ts). It is an item of the line (`flatten`, at no node being explained), or lies under a token of the line that is made at no node being explained: the pattern of a `case` branch (`casePattern`). A block's own first line, and a string read as a script, still walk theirs, as they change what they hold. Whatever walks the tokens of a line stops at a kept token and writes nothing to it or under it (`eachOwn`: the marks of the texts, the bases, the label echo, the origin; `markTokens`), so a line never changes what the lines after it read. Tests: test/line-order.test.ts moves one `Analyzer` through the lines of the documents of the corpus forwards, backwards and shuffled, and compares each line with a new `Analyzer`'s on a tree read again.
- A line of nothing else adds what is its own (statement-continued, what finds its problems at nodes that start on it) to what the `Whole` holds, worked out once: its notes, facts, anchors, examples, and the sentence, when all the line says is that statement. A fact of the line about a token is on a copy of that token and those above it (`markTokens`). A line that says a text the statement says too is worked out in full, as its rewrites must join: it takes a string read as a script to get there.
- What else each line read again of the statement is kept by its node too: the idioms, the argv, the options of a builtin that a version lacks; the problems read each anchor once; a host file's copy of the token is made once.

The results are those of walking each line, on all the sh and bash scripts over 64 lines of /usr and /etc (246 files, 64,185 rows: tokens, notes, facts, sentence, reading, argv, problems), with two exceptions that no such file reaches, both for two statements that meet on a line: a token of one gets its basis only from the texts of its own statement, and each has a budget of its own for its examples.

The output of the command-line tool is what it was: a statement's token is printed on each of its lines, so its text or JSON is the square of the statement's size in bytes (`arr=(` of 5,000 items: 740 MB of text in 27 s).

## What it does not bound

The walk of a line, with no examples, is not refused, and the models and the problems run over all the lines. That grows with the size of the text, on purpose: about 1 ms for each word of a line (under tsx), so a line of 4,000 words takes seconds, `a&` 100,000 times (200 KB) about 30 s, and each of 250,000 lines 1 to 2 ms. A very long line, or a very long file, keeps the thread that long. It is linear but for the squares known and left, and nothing proves there are no others, as nothing charges the walk. One: the readings of a command's words that may give no word (src/argv/readings.ts, `contexts`) read the run's words for each word, so `echo $a0 $a1 …` of 4,000 such words takes 8 s, in the one walk of the statement. Another: a problem on every line of one statement, `rm \<newline> $a0 \<newline> …`, takes 0.4 s at 500 lines, 4 s at 2,000, and 8,000 did not finish in 200 s (the argv interpreter's reading of the other operands, `tokenErrorNotes`, `markTokens`; the roadmap, Deferred, lists them).

### Whether counting is enough

The attack of #596, about 1,500 lines from families not listed before (big numbers in 90 tools, long and nested forms in 180 shapes, hosts), found 23 more holes. Three were in what the budget charges: a charge below zero that gave back (`.[] = 1`), perl's `$F[n]`, git's `%<(n)`. Twenty were in what no budget charges, the walk and the models: 2^n from something read twice (4), squares from reading all the words or lines again for each (14), a model that failed and was built again for each line (1), and a spread (1). Each was fixed where it was, and that makes its shape linear for good.

So counting steps is the right design for the runners: it is deterministic, the same in every product and order, and there it held. It does not bound the walk, and more shapes like these may exist. If that matters, the next line of defence is a hard limit from outside: the core in a worker, with a time and a memory limit, killed and started again on a line that exceeds them, and that line says so.

| Product | A worker with a limit |
| --- | --- |
| Command-line tool | Easy: `worker_threads`, `resourceLimits`, `terminate()`. Its loop becomes asynchronous. |
| Language Server | Easy: requests are asynchronous already, and a heap limit in the worker keeps the server alive. |
| VS Code desktop | Feasible: the extension host is Node.js and the providers may return promises; one more bundle, and the trees and the models live in the worker. |
| vscode.dev | Hard: the extension host is itself a web worker. A nested worker needs a script it may load under the host's CSP. `terminate()` works; there is no memory limit. |
| Web page | Feasible: a Web Worker and `terminate()`; no memory limit, and a worker that fills the memory may take the tab. |

It would cost what the products have now from being synchronous (a hover that answers at once with a whole explanation), and a limit by the clock would make a line's explanation depend on the machine, which the budget avoids. So the budget stays for what it bounds, and a worker would only be a backstop. Not built: in the roadmap's "Deferred", after 0.10.0.
