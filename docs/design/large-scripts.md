# Large scripts: a cheaper state merge

Status: Done (#829, #831, #832, #833, #834).

On a long script whose functions call each other from many sites, most of the time goes into one place: the merge of the shell states a node ran with (`merge`, src/semantics/shellstate.ts). This page measures it on main at c187a439, compares three ways to make it cheaper, and recommends one (step 1, in two parts). The colours of the lines in view, first planned here, belong to #672 (section 3). Section 4 lists what is left for later, with the lessons of #773 on stale results. Section 5 lists the risks, and section 7 the maintainer's decisions.

## 1. Measurements

### 1.1 Setup

- Code: main at c187a439 (after #827, which added `VariableState.scope`). For comparison, the code of a339bcc4, where the issue was measured.
- Node.js 24.22.0 under tsx, one process, in this order: parse, `shellState(tree, 'bash')`, `shellState(tree, 'sh')`, `documentHighlight(doc, { shells })` of the whole document, then `diagnosticsFor(…, 'web')` (the problems the web page shows). Each run was in a scope capped at 4 GB, through the machine's queue for heavy runs.
- Scripts:
  - nvm.sh from nvm's master branch on 2026-11-11: 6,943 lines, 151 functions; `nvm()` alone is 2,064 lines (sha256 `e7ffd3d1…aa8f6fc4`). The issue measured an older copy of 4,619 lines, so its numbers are not comparable with these. The same file on the code of a339bcc4 is in the table below.
  - Generated dispatchers: N commands, each calling two helpers, all called from one `case` in `main`. In the plain kind, the calls have no prefix assignment. In the prefix kind, every call has one (`MODE=a helper_3 "$1"`), as nvm.sh's calls often do, and each command also calls a helper in a `while read` loop.
- Counts came from a copy of `src/` with counters added (not this branch). The CPU profile (`node --cpu-prof`) came from an unchanged tree. "On the stack" counts a sample once for each function on its stack, so the rows overlap.

### 1.2 Time and memory on nvm.sh

| Phase | main (c187a439) | code of a339bcc4 | prototype of step 1a |
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

With the prototype of step 1a (24.3 s of CPU): the walks are 17.8 s (73%), and the merges inside them 4.6 s (19%), of which the loop of `NameMap.merge` is 3.0 s self. `notWalked` and `widen` take 2.7 s and 1.4 s (11% together, on the stack). `mergeScope` takes 0.5 s (2.2%). The problems take 4.0 s, the colours 0.33 s, and `at()` 0.17 s.

### 1.4 States per node

`Walker.record` keeps each distinct state a node ran with. These are the counts after each walk of the bash model, before any `at()`:

| States at a node | 1 | 2 | 3 | 4 | 5–8 | 9–16 | 17–32 | 33–64 | 65+ | Total | Max |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Walk 1 (ends `short`) | 387 | 44 | 132 | 3,416 | 365 | 2,427 | 872 | 144 | 211 | 100,119 states on 7,998 nodes | 356 |
| Walk 2 | 387 | 44 | 132 | 3,530 | 2,429 | 760 | 475 | 74 | 167 | 83,787 | 285 |

The nodes with most states are in `nvm_ls_remote_index_tab` (356), `nvm_ls_remote` (140), `nvm_resolve_only` (68), `nvm_rc_version` (54) and `nvm_remote_versions` (40). `nvm_ls_remote_index_tab` is called only with a prefix assignment (`NVM_LTS="${NVM_LTS-}" nvm_ls_remote_index_tab node std …`). Such a call takes the path of `call` (src/semantics/walk/walker.ts) that walks the body every time: no walk is reused, and `WALKS_PER_FUNCTION` does not apply. In the plain dispatcher, which has no such calls, no node has more than 4 states.

### 1.5 Calls of `mergeVariable`

Every entry into `mergeVariable`, today and with the prototype of step 1a. These include the recursive calls from `mergeScope` and from `hide` (src/semantics/walk/scopes.ts).

| nvm.sh, bash model | Today | Prototype of step 1a |
| --- | --- | --- |
| The walks | 1,039,956 | 1,039,956 |
| `at()` for the colours (4,032 merges of 43,174 states) | 14,913,639 | 17,277 |
| `at()` for the problems, after them (2,445 merges of 28,738 states) | 10,153,197 | 98,644 |

A merge of the k states in one pass that stays faithful to today's fold (option A below) makes exactly today's calls. Skips would make fewer. Counted another way, as the top-level calls per name on the variables only (no recursion), these are the calls of the faithful fold, and of a fold that skips a value identical to the one before it, or every duplicate:

| Top-level calls on variables | Faithful fold | Skip the same as before | Skip duplicates |
| --- | --- | --- | --- |
| The walks | 977,034 | 531,378 | 508,032 |
| `at()` for the colours | 12,394,040 | 5,147,291 | 5,108,096 |
| `at()` for the problems | 8,442,533 | 3,266,426 | 3,240,996 |

| Generated, prefix kind | Lines | Max states | Walk | Colours' `at()` today → prototype | Problems' `at()` today → prototype | Colours' time |
| --- | --- | --- | --- | --- | --- | --- |
| 40 commands, 3 calls each | 649 | 14 | 60,330 | 111,632 → 3,460 | 73,688 → 440 | 114 → 36 ms |
| 80 commands, 4 calls each | 1,289 | 26 | 313,610 | 534,407 → 9,580 | 344,610 → 1,200 | 353 → 68 ms |

The largest merges in a walk are those of the top-level unit's aborts (`merge([st, ...unit.aborts, ...unit.maybes])` in `Walker.units`) and of the program's exits (`Walker.program`): 441 states on the 40-command script, 1,201 on the 80-command one, 155 on nvm.sh.

### 1.6 What the numbers show

- `at()` is the cost: 63% of the CPU. Each merge it makes folds about 11 states over about 350 names, and calls `mergeVariable` about 3,700 times.
- Almost every name differs between the states of a node. The values are equal, but they are different objects: each walk of a body makes its own. So the identity short-circuits of `NameMap.merge` rarely apply, and a finer map would not help.
- `record` costs nothing. The number of states it keeps is the multiplier, and calls with prefix assignments make most of them on nvm.sh.
- The results of `at()` are kept: `runAt` puts the merged state in place of the node's states. That is the heap of 1.6 GB after the colours and 2.4 GB after the problems. The two models alone take 373 MB.
- Each model is walked twice: the first walk ends `short`, and the second is walked with what the first found. On nvm.sh the trust scan says the model is blind ("an alias of text not known"), and it is still walked twice; the second walk has fewer states (83,787 against 100,119).
- The colours of 40 lines in the middle of nvm.sh take 14 ms once the model is built; the whole document takes 31 s. But the problems read `at()` on every line, so colouring the lines in view alone would not end the freeze.
- Since a339bcc4, `mergeScope` (#827) takes 15% of the CPU, and the colours of nvm.sh became 50% slower. The walks are 6–12% slower (bash 9.3 to 9.9 s, sh 7.6 to 8.5 s).

## 2. Step 1: a cheaper merge

### 2.1 Today

`merge(states)` folds the states pairwise, left to right (`paths.reduce`). Each step makes a new `NameMap` per kind (`NameMap.merge`), with a new `Map` for each bucket that differs, filled from a `Set` of the names of both buckets. For each name whose two values are not the same object, it calls the kind's merge function (`mergeVariable`, `mergeOption`, …). `runAt` merges a node's states the first time it is asked, and keeps the result. So `at()` is already lazy per node.

### 2.2 Three options

**A. A k-way merge per bucket, in one pass, with an identity short-circuit.** For each bucket, read the k sources at once; for each name, fold its k values left to right. This saves the k − 1 intermediate maps and key sets: part of what the loop of `NameMap.merge` takes itself.

It saves no call of the merge functions. A merged value is a new object, so it is never identical to the next source, and a faithful fold makes exactly today's calls. Fewer calls need a skip of values already merged: of a value identical to the one before it, or of every duplicate. Those skips give the same results only if every merge function is idempotent (`f(f(a, b), b)` equals `f(a, b)`) or, for duplicates, also commutative and associative. `mergeVariable` is not idempotent: `f(f(undefined, b), b)` drops `environment` and `atMost` from `attrs.x` when `b` has no `x` (section 7).

**B. `at()` returns a state whose buckets merge on first read.** A reader of a node's state reads a few names: the variables of its words, an option, a function. A bucket whose sources differ is merged only when a name in it is read, and only that name; the whole bucket only when it is iterated. The prototype did this in `runAt` alone. The colours' `at()` went from 14.9 million calls to 17,277; the colours from 31.9 s to 0.36 s; the problems from 27.0 s to 4.0 s; the heap after them from 2.4 GB to 622 MB. The spans and the problems it gave on nvm.sh and on the 120-command plain dispatcher are byte for byte those of main (the JSON of both compared; a review reran nvm.sh and found the same).

**C. A finer persistent map (a HAMT, or 32 × 32 buckets).** A finer map copies less on a change and lets a merge skip more shared parts. But at `at()` nearly every name differs by identity, so a finer map visits as many names as today. `NameMap.with` takes 0.8% of the CPU. It would save little.

### 2.3 Recommendation: B, with the one pass of A as its fold

Build one fold, and use it in two ways.

- **The fold.** For a name and the k sources: start with the first source's value; for each next value, keep the result when the two are the same object, else call the kind's merge function. This is what today's pairwise reduce does for each name. Its shortcuts (two states, two maps or two buckets that are the same object) all mean that every name in them has the same object on both sides. No skip is added (section 7).
- **Step 1a: lazy, in `at()`.** `runAt` gives a state of lazy maps. A bucket whose sources are all the same object stays that object. Any other is a lazy bucket (a `ReadonlyMap`) that folds a name on its first read, and every name on its first iteration. This is the part prototyped, and about 95% of the gain. It touches only `runAt` and src/semantics/shellstate.ts.
- **Step 1b: eager, in the walk.** `merge` folds each bucket whose sources differ in one pass over its k sources (option A, without skips). The walk reads most of what it merges, so laziness would gain little there. It is measured on its own: the loop of `NameMap.merge` is 3.0 s self of the prototype's 24.3 s, which is what 1b can save at most. Measured after step 1a and #830, it saved 4% of the model time, and was dropped (section 6, step 2).
- **Why B.** It is the only option that makes the cost follow what is read rather than what was recorded. It gives the same results by construction, not by a property of the merge functions. It is small: one class and one function in src/semantics/shellstate.ts, and one line in `runAt`. It also covers `mergeScope` at `at()`: in the prototype's profile, `mergeScope` is 0.5 s.
- **Not taken.** A's skips (section 7) and C.

### 2.4 Why the results stay the same

- `NameMap.merge` calls the merge function for each name on its own: no name's result depends on another name.
- For each name that is read, the fold makes the same calls, in the same order, with the same arguments, as today's pairwise reduce. A name that is not read is not merged. That is safe because every merge function is pure. `mergeOption` reads `defaultOn`, and `mergeVariable` reads `exportFromEnvironment`: both are fixed tables. A comment at the fold says so, as `mapped` already requires of its function.
- The values are the same objects or new ones at the same places, so later identity checks find the same pairs. Only buckets and maps may be other objects: today a merge gives back the first bucket when nothing changed (`sameAsX`), and a lazy bucket is a new object. That changes only how often a shortcut applies: the identity checks of `NameMap.merge` and `NameMap.same`, and the memo of `mapped`, which is keyed by bucket (`passedMemo`, src/semantics/walk/shared.ts). Each of them gives the same result per name.

### 2.5 Points of the implementation

- The lazy merge keeps its own copy of the list of sources. `runAt` splices `runStates` in place, and `record` may push to it later.
- When every source is the same state, the lazy merge returns that state itself, as `merge` does.
- `get` memoises each name, absent names too. The first iteration folds the names not read yet and reuses the memoised objects, so a value read before and after the iteration is the same object.
- A lazy bucket drops its sources once it has folded every name. The prototype never dropped them, so its heap numbers are an upper bound.
- `NameMap.size` becomes a getter: a lazy bucket's size is the number of names in the union of its sources, found without a fold.
- The eager one pass of step 1b would still have returned the first source's bucket when nothing changed, as `sameAsX` does. It was measured and dropped (section 6, step 2), so the walk's `merge` stays pairwise.
- Both folds get their merge function through one static method of `NameMap` (the eager `NameMap.merge`, and a `NameMap.mergeAll` for the lazy maps, as in the prototype). The guard below wraps those methods. An ESM binding such as `mergeVariable` cannot be wrapped from a test, and no counter goes into src/.

### 2.6 Tests and guards

- **What pins the results.**
  - The probes compare the models with bash: state, environment, status, words, names, values (test/state-probes.test.ts, env-probes, status-probes, word-probes, names-probes, value-probes). So does test/decisions.test.ts.
  - test/line-budget.test.ts compares the lean explanations with the whole ones over the corpus.
  - test/snapshot.ts over the corpus before and after: the diff must be empty, as in analyzer.md, step 0. The PR says so.
- **A new equality test.** For every model of the corpus snippets and every node, `at()` with the lazy maps equals the eager `merge` of the same states:
  - Deep equality, with syntax nodes compared by identity: they have cycles through their parents.
  - The pattern of identities too: a lazy value is the same object as source j's value exactly when the eager one is.
  - A partial read (`get` of some names) before the iteration, so that the memoised values and the rest are checked together.
  - A body that no call reaches (`uncalled`), where a lazy state enters a walk.
- **A bound on the merge calls.** A generator in test/support makes the prefix dispatcher of section 1.1 (40 commands, 3 calls each, about 650 lines), so no fixture file is needed. The test wraps the merge function at `NameMap.merge` and `NameMap.mergeAll`, as test/line-budget.test.ts already wraps `Walker.runAt`. That counts every kind (options, functions, traps…) and none of the recursive calls. Measured so, on this script:
  - The colours and the problems together: main 185,320, the prototype 3,900. After #830, which walks such calls once per state, main makes 57,655 and step 1a 1,698. Bound: 10,000, which main exceeds more than 5 times and step 1a stays well under.
  - The walk, apart: 60,330 on both. Bound: 120,000, twice that, so that a regression in the walk shows.
  - (On this script the wrapper gives the same counts as the counters of section 1.5: it has no mixed scopes, and only variables differ.)
- **No timing budget.** One was considered on the 80-command dispatcher. It would not fail on a revert of step 1: that script takes 2.1 s on main, mostly in the walk. The count is the guard.
- docs/design/sources.md gets a row for the fold: one source of how states merge, and the guard that holds it.

## 3. The colours of the lines in view: in #672

The colours of the lines in view on the web page were step 2 of this plan. They leave #770 and go to #672 ([one-colour-source.md](one-colour-source.md)), which colours the lines in view from the explanation's tokens (maintainer's decision, 2026-11-11). After step 1, the whole document's colours cost about 0.4 s of a paste of about 14 s on nvm.sh, so here they are not worth a step of their own. There is to be one mechanism for the lines in view, not two.

## 4. Deferred

### 4.1 What is left

After step 1a and #830, a paste of nvm.sh costs about 7 s for the bash model and 4 s for the problems (item 1). These come next, each in its own issue:

1. **The second walk when the model is blind: kept.** A model is walked again when the first walk ends `short`: a call that was not walked took fewer changes of its body as unknown than the body makes (`Walker.short`, `buildModel` in src/semantics/state.ts). Measured on main at fcbe6974 (after step 1a and #830), Node.js 24.22.0, nvm.sh as in section 1.1:
   - The bash model takes 7.1–7.4 s: 3.8–4.1 s for the first walk, 3.1–3.3 s for the second. The sh model takes 6.0–6.4 s (3.1–3.3 s and 2.9–3.0 s). The colours take 0.31–0.34 s, the problems 3.7–4.0 s. No model needs a third walk.
   - In the first walk of the bash model, 518 of the 8,805 calls not walked are short. They are the recursive calls of seven functions: `nvm`, `nvm_version`, `nvm_ls_remote`, `nvm_check_file_permissions`, `nvm_has_system_iojs`, `nvm_ls` and `nvm_resolve_local_alias`. What their bodies change after the call adds up to 859 names for `nvm` alone. Among them are `set errexit`, `set allexport`, `set errtrace`, `IFS`, functions and traps.
   - Walked once when the trust scan says blind (an experiment, not merged): the bash model takes 3.95 s instead of 7.25 s, and the sh model 3.29 s instead of 6.40 s. The heap after the two models is 192 MB instead of 292 MB. The corpus snapshot (test/snapshot.ts, 6,694 lines) is the same byte for byte, and so are the spans and the problems of nvm.sh.
   - But it is not sound. A blind model trusts no decision and no value, yet its states still give the options, `IFS`, the functions, the aliases and the traps, and the lines read them. In `alias a="$x"; set -e; f() { if [ "$1" ]; then f; false; echo reached; return; fi; set +e; }; f 1`, the first walk has `set -e` on at `false`, and the line says the shell stops there. bash runs `set +e` in the inner call and prints `reached`. The second walk takes `errexit` as unknown there.
   - So the second walk stays. test/state.test.ts ("a blind script is walked again too…") holds it: it counts the walks by wrapping `Walker.prototype.program`, and compares with bash. Only the first walk's `changes` and `lastAt` reach the second, so a cheaper first walk would need another way to find what each body changes. That would change results, so it is not planned.
2. **`notWalked` and `widen`: measured.** A CPU profile of the two models, the colours and the problems on nvm.sh, at fcbe6974, takes 18.8 s:

   | Function | On the stack | Self |
   | --- | --- | --- |
   | The walks (four) | 13.1 s (70%) | — |
   | `merge` (in the walks) | 4.0 s (21%) | 0.15 s |
   | The problems (`diagnosticsFor`) | 3.8 s (20%) | — |
   | `notWalked` (src/semantics/walk/widen.ts) | 2.4 s (13%) | 1.2 s |
   | `mergeVariable` | 2.2 s (11.5%) | 1.9 s |
   | The loop of `NameMap.merge` | — | 1.7 s (9%) |
   | `widen` | 1.3 s (6.7%) | 0.9 s |
   | Garbage collection | 0.7 s (3.6%) | 0.7 s |
   | `sameState` | 0.6 s (3.1%) | — |
   | `mergeScope` | 0.4 s (2.0%) | — |
   | The colours (`documentHighlight`) | 0.3 s (1.6%) | — |
   | `runAt` | 0.1 s (0.5%) | — |

   Counted in a copy of src/ with counters, over the four walks: `notWalked` runs 32,888 times and replays 2.95 million keys, about 90 per call. It adds each key to every set of the bodies being walked (`collecting`), 12 to 18 deep on most calls: 38.9 million additions. That is most of its own 1.2 s. `widen` runs 32,972 times over 3.02 million keys; almost every call comes from `notWalked`. Together they are about a fifth of the walks.
   - The sets of the bodies being walked are also each body's `changes`, which a recursive call reads in the middle of the walk. So adding a body's keys to the outer sets only when it ends would change what such a call takes as unknown. A cheaper `notWalked` that keeps the results needs a design of its own, left to #836: after step 1a and #830, the bash model are about 7 s of a paste of about 11 s on nvm.sh, and items 4 and 5 below would end the freeze itself.
3. **Calls with a prefix assignment: #830.** They were walked at every call, without reuse and past `WALKS_PER_FUNCTION`, so their cost grows exponentially with the depth of such calls. A review measured, on main, a chain where each fᵢ calls `X=1 fᵢ₊₁` twice: 14 levels 0.65 s, 16 levels 3.0 s, 18 levels (about 55 lines) 18 s; the same chain without the prefixes takes 4 ms. They make the nodes with the most states on nvm.sh. #830 (#832) made such a call reuse the walks of its body, as a plain call does.
4. **The problems in idle chunks.** `noteIssues` explains every line in one task (4 s on nvm.sh after step 1). It could run in chunks of lines between frames, and show its result when all chunks are done.
5. **The core in a Web Worker.** This would end the freezes themselves: the page would stay responsive, and the results would arrive later. [line-budget.md](line-budget.md) ("Whether counting is enough") lists a worker as a backstop with a time limit, deferred. A worker for responsiveness needs no clock limit, so results stay the same on every machine.

### 4.2 Stale results: the lessons of #773

PR #773 first ran the page's whole-document passes once typing rested. Its reviews found that every result shown during the rest belonged to an older text (issue #770, comment of 2026-11-09). Items 4 and 5 above have the same problem, and so do the lines in view of #672. What went wrong:

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

- **The scope of a variable (#827).** `mergeScope` merges the outer state of a mixed scope with `mergeVariable`, and `sameScope` compares outer states. Step 1 calls the same functions in the same order, so its results do not change, and step 1a removes most of the cost at `at()`. A skip by value could not use `sameVariable` anyway: it ignores `at` and `source`, which the merge keeps. The walks stay 6–12% slower than at a339bcc4; that is left to the measurements of section 4.1.
- **The walk's reuse of function walks.** The walk compares entry states with `sameState` and records `sourcesApart`. Step 1a makes only the results of `runAt` lazy. The walk calls `runAt` in one place: `uncalled` walks a body no call reached from its definition's state, widened. There a lazy state enters a walk. `with` and `withAll` copy the buckets they change and fold them; the other buckets stay shared and lazy; `sameState` folds what it compares. The equality test covers such a body.
- **States recorded after a `runAt`.** `record` may add a state to a node after `runAt` has merged its states (a body walked by `uncalled`). The next `runAt` then folds the merged state and the new ones, in that order, as today. The lazy merge's own copy of its sources keeps the first merge apart from that later push.
- **Child models.** `childModel` (src/semantics/state.ts) starts the walk of another shell from `script.outer.at(first).run`, a lazy state. `childStart` (src/semantics/walk/child.ts) iterates its functions and options, and maps its variables through `passedMemo`, a module-level `WeakMap` keyed by bucket. That is harmless: each child walk takes its values from one `mapped` call, and child models never merge with each other. A lazy bucket is only another key of the memo.
- **Memory.** A lazy state keeps its k sources until each bucket is folded whole. The measured peak was lower (622 MB against 2.4 GB), because most buckets are never folded. A bucket drops its sources once folded whole. If a reader iterated every state, the memory would be about today's plus the sources.
- **The line budget.** `runAt` is already lazy per node; step 1a makes it lazy per name too. That brings no new kind of timing or budget risk. No fold charges anything, and the walk and the models still read each node once ([line-budget.md](line-budget.md), "Reading once"). What a model works out must not depend on the line that asked first: a name's fold is pure and gives the same result whichever reader asks first.

## 6. Steps

1. **1a, `at()` lazy: done (#831).** The fold, the lazy bucket, `NameMap.mergeAll`, `runAt`; the equality test over the corpus and the bound on the merge calls; a row in docs/design/sources.md. test/snapshot.ts diff empty, stated in the PR. One CHANGELOG line under "Fixed" for long scripts that froze the page.
2. **1b, the eager one pass in the walk's `merge`: measured, dropped.** The one pass was built faithful: each bucket's k sources folded a name at a time, with the calls of the pairwise reduce in the same order; a bucket that every source shares kept, and the first source's bucket kept when no step of the fold gave another value; `f` through `NameMap.merge`, so the guard still wraps it. It was measured against main at df7c7d17 (after step 1a and #830), on nvm.sh as in section 1.1, with Node.js 24.22.0, in 14 alternating runs of each (load 1.1–1.8):
   - The bash model: median 7.15 s on main, 6.87 s with the one pass (4.0% less). The sh model: 6.03 s and 5.79 s (4.0%). Both: 13.20 s and 12.69 s (3.9%); the runs ranged over 12.98–13.66 s and 12.48–13.55 s.
   - The heap after the two models: 281 MB on both.
   - A CPU profile of the two models: `merge` on the stack went from 4.0 s to 3.5 s, and the whole from 14.1 s to 13.7 s. What is left in `merge` is mostly the merge functions (`mergeVariable` 2.0–2.1 s on the stack), which a faithful fold calls as often as the pairwise one.
   - Two variants were no faster: a native copy of the first source's bucket, set again where a value changed, and an iteration with `forEach` instead of entries.
   - The spans and the problems of nvm.sh were byte for byte those of main.
   - The gain is under the bar set for this step (a code change only above about 5% of the model time), so it was not merged.
3. **The measurements of section 4.1: done (#833).** The second walk when the model is blind is kept: it is needed for the options, `IFS`, functions and traps, and a test holds it. `notWalked` and `widen` were measured at about a fifth of the walks; a cheaper version that keeps the results is left to #836. #830 (#832) made the calls with a prefix assignment reuse walks.
4. **Later, if still needed:** the problems in idle chunks, a Web Worker, each with the rules of section 4.2. Not part of this plan.

The plan ends here: step 1a and #830 are done, step 1b was dropped, the second walk is kept, `notWalked` and `widen` are left to #836, and the colours of the lines in view to #672 (section 3).

## 7. Decisions of the maintainer (2026-11-11)

- **The colours of the lines in view** go to #672 (section 3): after step 1 they save about 0.4 s of a paste of about 14 s.
- **No skips in the walk's fold.** The fold stays faithful, so the results stay the same by construction. A review found that `mergeVariable` is not idempotent: `f(f(undefined, b), b)` drops `environment` and `atMost` from `attrs.x` when `b` has no `x`. So the skip of a value identical to the one before would change results.
- **Calls with a prefix assignment, walked at every call,** are #830, in Now (section 4.1, item 3).
- **The next measurements** are the second walk when the model is blind, then `notWalked` and `widen` (section 4.1, items 1 and 2).
