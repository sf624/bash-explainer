# Large scripts: a cheaper state merge, and the colours of the lines in view

Status: Tracked in #770. Design only; no step is built. The maintainer asked for this design to be reviewed before any code (2026-11-09), because the walk and the shell state are the foundation.

On a long script whose functions call each other from many sites, most of the time goes into one place: the merge of the shell states a node ran with (`merge`, src/semantics/shellstate.ts). This page measures it on today's main, compares three ways to make it cheaper, and recommends one (step 1). Step 2 colours only the lines in view on the web page. Step 3 lists what is left for later, with the lessons of #773 on stale results. Section 5 lists the risks.

## 1. Measurements

### 1.1 Setup

- Code: main at c187a439 (after #827, which added `VariableState.scope`). For comparison, the code of a339bcc4, where the issue was measured.
- Node.js 24.22.0 under tsx, one process, in this order: parse, `shellState(tree, 'bash')`, `shellState(tree, 'sh')`, `documentHighlight(doc, { shells })` of the whole document, then `diagnosticsFor(…, 'web')` (the problems the web page shows). Each run was in a scope capped at 4 GB, through the machine's queue for heavy runs.
- Scripts:
  - nvm.sh from nvm's master branch on 2026-11-11: 6,943 lines, 151 functions; `nvm()` alone is 2,064 lines (sha256 `e7ffd3d1…aa8f6fc4`). The issue measured an older copy of 4,619 lines, so its numbers are not comparable with these. The same file on the code of a339bcc4 is in the table below.
  - Generated dispatchers: N commands, each calling two helpers, all called from one `case` in `main`. In the plain kind, the calls have no prefix assignment. In the prefix kind, every call has one (`MODE=a helper_3 "$1"`), as nvm.sh's calls often do, and each command also calls a helper in a `while read` loop.
- Counts came from a copy of `src/` with counters added (not this branch). The CPU profile (`node --cpu-prof`) came from an unchanged tree. "On the stack" counts a sample once for each function on its stack, so the rows overlap.

### 1.2 Time and memory on nvm.sh

| Phase | main (c187a439) | code of a339bcc4 | prototype of step 1 |
| --- | --- | --- | --- |
| Parse | 0.2 s | 0.2 s | 0.2 s |
| bash model (two walks) | 9.8–10.4 s | 9.3 s | 9.9 s |
| sh model (two walks) | 8.5–8.7 s | 7.6 s | 8.5 s |
| Colours of the whole document | 31.2–31.9 s | 21.0 s | 0.36 s |
| Problems (`diagnosticsFor`, web) | 26.1–27.0 s | 22.3 s | 4.0 s |
| Heap after the two models | 373 MB | 394 MB | 373 MB |
| Heap after the colours | 1,613 MB | 1,272 MB | 489 MB |
| Heap after the problems | 2,445 MB | 2,073 MB | 622 MB |

The web page does not build the sh model for a script of this size (`SH_COUNT_COMMANDS`, src/document.ts). A paste of nvm.sh on the page therefore pays the bash model, the colours and the problems: about 67 s in Node on main, and about 14 s with the prototype. Main is about 50% slower than a339bcc4 in the colours on the same file.

### 1.3 Where the time goes (main, 80.3 s of CPU)

| Function | On the stack | Self |
| --- | --- | --- |
| `merge` (shellstate.ts) | 55.4 s (69%) | 1.4 s |
| `StateModel.at` → `Walker.runAt` | 50.8 s (63%) | — |
| `mergeVariable` | 35.5 s (44%) | 27.9 s (35%) |
| The colours (`documentHighlight`) | 30.0 s (37%) | — |
| The problems (`noteIssues`) | 25.0 s (31%) | — |
| `NameMap.merge`, its loop over a bucket's names | — | 19.9 s (25%) |
| The walks (`shellState`, four walks) | 18.3 s (23%) | — |
| `mergeScope` (from #827) | 11.8 s (15%) | 2.5 s |
| Garbage collection | 5.3 s (6.5%) | 5.3 s |
| `sameScope` | — | 2.0 s |
| `sameState` | 0.7 s (0.9%) | 0.4 s |
| `Walker.record` | 0.09 s (0.1%) | — |

With the prototype of step 1 (24.3 s of CPU): the walks are 17.8 s (73%), and the merges inside them 4.6 s (19%). `notWalked` and `widen` take 2.7 s and 1.4 s. The problems take 4.0 s, the colours 0.33 s, and `at()` 0.17 s.

### 1.4 States per node

`Walker.record` keeps each distinct state a node ran with. These are the counts after each walk of the bash model, before any `at()`:

| States at a node | 1 | 2 | 3 | 4 | 5–8 | 9–16 | 17–32 | 33–64 | 65+ | Total | Max |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Walk 1 (ends `short`) | 387 | 44 | 132 | 3,416 | 365 | 2,427 | 872 | 144 | 211 | 100,119 states on 7,998 nodes | 356 |
| Walk 2 | 387 | 44 | 132 | 3,530 | 2,429 | 760 | 475 | 74 | 167 | 83,787 | 285 |

The nodes with most states are in `nvm_ls_remote_index_tab` (356), `nvm_ls_remote` (140), `nvm_resolve_only` (68), `nvm_rc_version` (54) and `nvm_remote_versions` (40). `nvm_ls_remote_index_tab` is called only with a prefix assignment (`NVM_LTS="${NVM_LTS-}" nvm_ls_remote_index_tab node std …`). Such a call takes the path of `call` (src/semantics/walk/walker.ts) that walks the body every time: no walk is reused, and `WALKS_PER_FUNCTION` does not apply. In the plain dispatcher, which has no such calls, no node has more than 4 states.

### 1.5 Calls of `mergeVariable`

The calls today, and what a merge of the k states in one pass (option A below) would make: faithful to today's fold, skipping a value identical to the one before it, or skipping every duplicate. The last column is the prototype of step 1.

| nvm.sh, bash model | Today | One pass | One pass, skip the same as before | One pass, skip duplicates | Prototype |
| --- | --- | --- | --- | --- | --- |
| The walks | 1,039,956 | 977,034 | 531,378 | 508,032 | 1,039,956 |
| `at()` for the colours (4,032 merges of 43,174 states) | 14,913,639 | 12,394,040 | 5,147,291 | 5,108,096 | 17,277 |
| `at()` for the problems, after them (2,445 merges of 28,738 states) | 10,153,197 | 8,442,533 | 3,266,426 | 3,240,996 | 98,644 |

| Generated, prefix kind | Lines | Max states | Walk | Colours' `at()` today → prototype | Problems' `at()` today → prototype | Colours' time |
| --- | --- | --- | --- | --- | --- | --- |
| 40 commands, 3 calls each | 649 | 14 | 60,330 (7,012 skipping the same as before) | 111,632 → 3,460 | 73,688 → 440 | 114 → 36 ms |
| 80 commands, 4 calls each | 1,289 | 26 | 313,610 (19,070) | 534,407 → 9,580 | 344,610 → 1,200 | 353 → 68 ms |

The largest merges in a walk are those of the top-level unit's aborts (`merge([st, ...unit.aborts, ...unit.maybes])` in `Walker.units`) and of the program's exits (`Walker.program`): 441 states on the 40-command script, 1,201 on the 80-command one, 155 on nvm.sh.

### 1.6 What the numbers show

- `at()` is the cost: 63% of the CPU. Each merge it makes folds about 11 states over about 350 names, and calls `mergeVariable` about 3,700 times.
- Almost every name differs between the states of a node. The values are equal, but they are different objects: each walk of a body makes its own. So the identity short-circuits of `NameMap.merge` rarely apply, and a finer map would not help.
- `record` costs nothing. The number of states it keeps is the multiplier, and calls with prefix assignments make most of them on nvm.sh.
- The results of `at()` are kept: `runAt` puts the merged state in place of the node's states. That is the heap of 1.6 GB after the colours and 2.4 GB after the problems. The two models alone take 373 MB.
- Each model is walked twice: the first walk ends `short`, and the second is walked with what the first found. On nvm.sh the trust scan says the model is blind ("an alias of text not known"), and it is still walked twice; the second walk has fewer states (83,787 against 100,119).
- The colours of 40 lines in the middle of nvm.sh take 14 ms once the model is built; the whole document takes 31 s. But the problems read `at()` on every line, so colouring the lines in view alone would not end the freeze.
- Since a339bcc4, `mergeScope` (#827) takes 15% of the CPU, and the colours of nvm.sh became 50% slower.

## 2. Step 1: a cheaper merge

### 2.1 Today

`merge(states)` folds the states pairwise, left to right (`paths.reduce`). Each step makes a new `NameMap` per kind (`NameMap.merge`), with a new `Map` for each bucket that differs, filled from a `Set` of the names of both buckets. For each name whose two values are not the same object, it calls the kind's merge function (`mergeVariable`, `mergeOption`, …). `runAt` merges a node's states the first time it is asked, and keeps the result.

### 2.2 Three options

**A. A k-way merge per bucket, in one pass, with an identity short-circuit.** For each bucket, read the k sources at once; for each name, fold its k values left to right. This saves the k − 1 intermediate maps and key sets: most of the 25% that `NameMap.merge` takes itself. It does not save calls of `mergeVariable`: a merged value is a new object, so it is never identical to the next source (one pass: 12.4 million calls in the colours' `at()`, against 14.9 million). Fewer calls need a skip of values already merged: of a value identical to the one before it (5.1 million), or of every duplicate (5.1 million). Those skips give the same results only if every merge function is idempotent (`f(f(a, b), b)` equals `f(a, b)`) or, for duplicates, also commutative and associative. That holds or not by the code of each function; it is not true by construction.

**B. `at()` returns a state whose buckets merge on first read.** A reader of a node's state reads a few names: the variables of its words, an option, a function. A bucket whose sources differ is merged only when a name in it is read, and only that name; the whole bucket only when it is iterated. The prototype did this in `runAt` alone. The colours' `at()` went from 14.9 million calls to 17,277; the colours from 31.9 s to 0.36 s; the problems from 27.0 s to 4.0 s; the heap after them from 2.4 GB to 622 MB. The spans and the problems it gave on nvm.sh and on the 120-command plain dispatcher are byte for byte those of main (the JSON of both compared).

**C. A finer persistent map (a HAMT, or 32 × 32 buckets).** A finer map copies less on a change and lets a merge skip more shared parts. But at `at()` nearly every name differs by identity, so a finer map visits as many names as today. `NameMap.with` takes 0.8% of the CPU. It would save little.

### 2.3 Recommendation: B, with the one pass of A as its fold

Build one fold, and use it in two ways.

- **The fold.** For a name and the k sources: start with the first source's value; for each next value, keep the result when the two are the same object, else call the kind's merge function. This is what today's pairwise reduce does for each name. Its shortcuts (two states, two maps or two buckets that are the same object) all mean that every name in them has the same object on both sides.
- **Eager, in the walk.** `merge` folds each bucket whose sources differ in one pass over its k sources (option A, without skips). The walk reads most of what it merges, so laziness would gain little there and add risk. This part was not prototyped: it saves the intermediate maps, not merge calls.
- **Lazy, in `at()`.** `runAt` gives a state of lazy maps. A bucket whose sources are all the same object stays that object. Any other is a lazy bucket (a `ReadonlyMap`): `get` folds that name on its first read and keeps it; the first iteration folds every name, in today's order (the names of the sources in order, each at its first place), and then drops the sources. `size` is the number of names in the union of the sources; it needs no fold. Every method of `NameMap` reads buckets through `ReadonlyMap`, so `with`, `withAll`, `mapped`, `differing` and `same` work unchanged, and fold what they read. The status, `errexitWhy` and `opaque` are folded at once, as today.
- **Why B.** It is the only option that makes the cost follow what is read rather than what was recorded. It gives the same results by construction, not by a property of the merge functions. It is small: one class and one function in src/semantics/shellstate.ts, and one line in `runAt`.
- **Not now.** A's skips (section 4, item 3) and C. Both can come later, measured, if the walk still dominates.

### 2.4 Why the results stay the same

- `NameMap.merge` calls the merge function for each name on its own: no name's result depends on another name.
- For each name that is read, the fold makes the same calls, in the same order, with the same arguments, as today's pairwise reduce. A name that is not read is not merged. That is safe because every merge function is pure. `mergeOption` reads `defaultOn`, and `mergeVariable` reads `exportFromEnvironment`: both are fixed tables. A comment at the fold says so, as `mapped` already requires of its function.
- The values are the same objects or new ones at the same places, so later identity checks find the same pairs. Only buckets and maps may be other objects: today a merge gives back the first bucket when nothing changed (`sameAsX`). That changes only how often a shortcut applies, and a shortcut gives the same result per name.
- What pins it:
  - The probes compare the models with bash: state, environment, status, words, names, values (test/state-probes.test.ts, env-probes, status-probes, word-probes, names-probes, value-probes). So does test/decisions.test.ts.
  - test/line-budget.test.ts compares the lean explanations with the whole ones over the corpus.
  - A new test: for every model of the corpus snippets and every node, `at()` with the lazy maps, fully iterated, equals the eager `merge` of the same states (deep equality).
  - test/snapshot.ts over the corpus before and after: the diff must be empty, as in analyzer.md, step 0. The PR says so.

### 2.5 New guards

- **A bound on the merge calls.** A generator in test/support makes the prefix dispatcher of section 1.1 (40 commands, 3 calls each, about 650 lines), so no fixture file is needed. The test counts the merge function's calls by wrapping it in `NameMap.merge` and in the new lazy merge from the test, as test/line-budget.test.ts already wraps `Walker.runAt`; no counter goes into src/. It bounds two numbers:
  - The colours and the problems together: at most 20,000 calls. Main makes 185,320 (more than 9 times the bound). The prototype makes 3,900 (a fifth of it).
  - The walk, apart: at most 120,000 calls, twice the 60,330 measured, so that a regression in the walk shows.
- **A timing budget.** Generous, as in test/highlight-speed.test.ts, and skipped under coverage: the 80-command dispatcher (about 1,300 lines), its bash model, colours and problems, in under 6 s. Main takes 2.1 s, the prototype 1.6 s. It is a backstop for a large regression only. The count above is the real guard; no test asserts a ratio of times.
- docs/design/sources.md gets a row for the fold: one source of how states merge, and the guard that holds it.

## 3. Step 2: the colours of the lines in view

### 3.1 Today

The web page colours the whole document once per parse: `Editor.spansOf` (web/editor.ts) calls `documentHighlight(doc, { shells })`, and keeps the result for that document and shell. VS Code already asks for a range: `semanticTokens(doc, { lines })` passes `lines` to `documentHighlight`, which reads the models on those lines only. The model of a script is still built whole, once per tree.

### 3.2 Design

- The page asks for the lines it draws: CodeMirror's viewport (the lines on screen and a margin around them), in blocks of 100 lines.
- The spans of each block are kept per document and shell, where today the page keeps the whole document's (`shadings`). A scroll colours only the blocks that come into view. The decorations are built from all the blocks coloured so far.
- After an edit, CodeMirror maps the old decorations through the change, as today, until the new document's blocks are coloured, 100 ms after the last change.
- A block's spans belong to one document (one parse). The page applies them only while that document is still the current one. That is the first use of the version tag of section 4.2.
- The wrap runs (`runsOf`) stay whole: they read no model.

### 3.3 With #672

The plan of [one-colour-source.md](one-colour-source.md) (#672) also colours only the lines in view, from the explanation's tokens and in slices. Step 2 builds that mechanism on today's colours: the viewport, the blocks, the cache by document. Step 1 of #672 then changes the source of the spans, not the mechanism. If #672 is taken first, step 2 becomes part of it. There is to be one mechanism for the lines in view, not two.

### 3.4 Tests

- Over the corpus (test/support/corpus.ts) and the host fixtures: for each document, the spans of each block, of single lines, of ranges that cut a statement over several lines or a here-document, and of a range past the end, equal the whole document's spans on those lines. test/semanticTokens.test.ts checks this on sample.sh only today.
- A web test: on a long script, scroll to the end; the lines in view have the colours of the whole document's spans there.
- The checklist of CLAUDE.md for the web page: nothing changes in focus or the accessibility tree; only the colours of lines out of view come later.

### 3.5 What it gains

After step 1, the whole document's colours cost 0.36 s on nvm.sh, on top of a 10 s model. So step 2 saves little there. Its value is a bound: the colours cost what the screen shows, whatever the size of the script. Without step 1, it would save the colours' 31 s but not the problems' 27 s.

## 4. Step 3: deferred

### 4.1 What is left

After step 1, a paste of nvm.sh costs about 10 s for the bash model and 4 s for the problems. These items are measured first and planned in their own issues:

1. **The second walk.** A model is walked again when the first walk ends `short`: a call that was not walked took fewer changes of its body as unknown than the body makes (`Walker.short`, `buildModel` in src/semantics/state.ts). This happens on nvm.sh even though the trust scan says the model is blind, and it doubles the walk of each model. A blind model trusts no decision and no value, but its states still give names, options and traps. Before changing anything, measure: walk once when the model is blind, and diff test/snapshot.ts over the corpus. Then decide with the list of differences.
2. **Calls with prefix assignments.** They are walked at every call, without reuse and past `WALKS_PER_FUNCTION`. They make the nodes with the most states on nvm.sh. A reuse keyed by the entry state with its temporaries and the frame would give the same results, if the key is complete. Applying the cap to them would give other results (a guess instead of a walk), and would need the probes again.
3. **Skips in the walk's fold.** Skipping a value identical to the one before it would halve the walk's merge calls on nvm.sh (1,039,956 to 531,378) and cut them by eight on the prefix dispatcher. It is correct only if each merge function is idempotent. That would be checked by a test over every merge the corpus makes, not by construction. Section 5 says why `mergeScope` makes this harder.
4. **The problems in idle chunks.** `noteIssues` explains every line in one task (4 s on nvm.sh after step 1). It could run in chunks of lines between frames, and show its result when all chunks are done.
5. **The core in a Web Worker.** This would end the freezes themselves: the page would stay responsive, and the results would arrive later. [line-budget.md](line-budget.md) ("Whether counting is enough") lists a worker as a backstop with a time limit, deferred. A worker for responsiveness needs no clock limit, so results stay the same on every machine.

### 4.2 Stale results: the lessons of #773

PR #773 first ran the page's whole-document passes once typing rested. Its reviews found that every result shown during the rest belonged to an older text (issue #770, comment of 2026-11-09). Items 4 and 5 above have the same problem, and so does step 2 in a small way. What went wrong:

- A quick fix applied an issue's old line and column to the new text, while CodeMirror had moved the squiggle. The Problems strip kept old line numbers.
- Clear, Undo of a paste, Open and Load sample kept the cost and the counts of the old large script for seconds.
- The panel's reveal, its highlight and Copy as Markdown used old positions (`RangeError: Invalid line number 4000 in 3995-line document`).
- Edits that are not typing (Alt+↑) ran the pass at once.
- Two tests that asserted when a pass starts, in page time, were flaky.
- Rare corners: a stale fix swallowed the click; zero-width problems moved or lost their fixes; the name hints' offsets came from the old parse; the shell chip read the old parse.
- A test relied on stale state: test/web-problems.test.ts ("lays the strip out on one row") passes only because the sample's stale counts give three levels for a moment. Give it a warning line (`source lib.sh`) when the timing changes.

The rules for any result computed apart from the current text:

- Tag every result with the version of the text it was computed on: the CodeMirror `Text`, or a counter bumped on each change. This covers the problems, the spans, the explanations, the hints and the panel's update.
- Drop or map a result whose version is not the current one, in one place that every consumer reads through, not in each feature.
- Measure with the harness of #773 (the long tasks after a paste; keys 150 ms apart), not with timing assertions in the suite.

## 5. Risks

- **The scope of a variable (#827).** `mergeScope` merges the outer state of a mixed scope with `mergeVariable`, and `sameScope` compares outer states. This made merges dearer (15% of the CPU on nvm.sh) and makes more values differ by identity: a mixed scope merged twice from the same inputs is equal but not the same object. Step 1 calls the same functions in the same order, so its results do not change. But a skip by value (section 4.1, item 3) could not use `sameVariable`: it ignores `at` and `source`, which the merge keeps. A skip by identity misses the equal copies. Any such skip must be checked against the scope cases of test/state.test.ts, the value probes (test/fixtures/probes/values.json) and the state probes.
- **The walk's reuse of function walks.** The walk compares entry states with `sameState` and records `sourcesApart`. Step 1 makes only the results of `runAt` lazy. The walk calls `runAt` in one place: `uncalled` walks a body no call reached from its definition's state, widened. There a lazy state enters a walk. `with` and `withAll` copy the buckets they change and fold them; the other buckets stay shared and lazy; `sameState` folds what it compares. A test covers a body that no call reaches.
- **States recorded after a `runAt`.** `record` may add a state to a node after `runAt` has merged its states (a body walked by `uncalled`). The next `runAt` then folds the merged state and the new ones, in that order, as today.
- **Memory.** A lazy state keeps its k sources until each bucket is folded whole. The measured peak was lower (622 MB against 2.4 GB), because most buckets are never folded. A bucket drops its sources once folded whole. If a reader iterated every state, the memory would be about today's plus the sources.
- **The line budget.** The walk and the models charge nothing, so they must read each node once ([line-budget.md](line-budget.md), "Reading once"). The lazy fold reads no node. What a model works out must not depend on the line that asked first. A name's fold is pure and gives the same result whichever reader asks first, so that holds. Nothing changes for the examples' budget.
- **Range colours (step 2).** A range reads the models on its lines only. If the colours of a line ever depended on reading another line first, the range spans would differ from the whole document's. The corpus test of section 3.4 would catch it.

## 6. Steps

1. **The fold, eager and lazy** (step 1): the fold, the lazy bucket, `runAt` lazy, `merge` in one pass; the corpus equality test; the merge-call bound and the timing budget; a row in docs/design/sources.md. test/snapshot.ts diff empty, stated in the PR. No CHANGELOG entry beyond one line under "Fixed" for long scripts that froze the page.
2. **The colours of the lines in view on the web page** (step 2), unless #672 takes it.
3. **Measure the second walk and the calls with prefix assignments** (section 4.1, items 1 and 2), then decide on them. Issues of their own.
4. **Later, if still needed:** the skips in the walk's fold, the problems in idle chunks, a Web Worker, each with the rules of section 4.2.

## 7. Open questions for the maintainer

1. After step 1, the walk is about 70% of a paste of nvm.sh (10 s). Step 2 saves about 0.4 s there. Should the measurement of section 4.1 (items 1 and 2) come before step 2? The proposal is: step 1, then those measurements, then step 2 together with #672.
2. The skips in the walk's fold (section 4.1, item 3) would give the same results only if the merge functions are idempotent, checked by a test over the corpus rather than by construction. Is such a check acceptable for the foundation, or should the walk keep the faithful fold?
