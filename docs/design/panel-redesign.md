# Panel redesign: one view with a depth

The plan that turns prototype B into real PRs, then the usability test. Agreed with the maintainer on 2026-10-27; revised after an independent review of the plan (PR #418).

Status: planned. No step started.

## 1. Goal

The panel explains the line in one view instead of two tabs. A reader picks how deep to go: what the line does, or how bash reads it. A switch shows what each program receives. The problems of the line come first, each with a fix to copy.

The end point is the roadmap's usability test (section 7): five simulated users (agents, not people) solve the test's tasks and give the panel an average of 9/10 or more.

## 2. What prototype B is

Branch `proto/modes-b11` (34981fe2), round 11 of 11. Against main it touches 33 files, +6,028 lines (`git diff origin/main origin/proto/modes-b11`; a three-dot diff shows 46 files, because the branch merged #417). Most of it is in media/panel.js (+1,850) and media/panel.css (+2,180). The gallery of round 11 is in `~/.cache/explain-bash-tmp/proto-b11/` (not committed).

What it shows:

- **One view.** The tabs "Meaning | Reading" are gone. A Depth control has two steps: 1 "What it does", 2 "How bash reads it". A deeper step only adds rows and lines; nothing moves.
- **A switch "What the program receives"**, on by default. It shows the words each program gets (argv) and its streams.
- **On top:** "In short", one sentence for the line (src/linesummary.ts). Then the box of the line's problems. Each problem has a one-line headline and a "more" with a fix to copy. A chip on the row links to the box, and back. A line inside a construct gets a pointer to the problem on the construct's line.
- **Examples:** "Run the whole line on sample lines" runs one data set through every stage of a pipeline. A glob gets a box of names to try, with why each name does not match.
- **The rows:** a two-column grid (code, text), with a box around each command. At depth 2 each row gets one muted role line ("argument → option · grep reads it §3.7.1"). A word that expands gets bash's steps (brace → tilde → … → quote removal). A pipe is a connector row ("stdout of grep → stdin of sort"). A Key, drawn inline, lists the marks on screen.

### Screenshots, in words

The names: `s1` to `s4` are the four test scripts, `d1` and `d2` the depth, `w` the switch "What the program receives" on, `-full` the whole page rather than one screen. To capture them again, build the web page from `proto/modes-b11` and run the gallery's `tools/capture.ts <site> <out>` through `~/.claude/bin/heavy`, with the CJK fonts (`tools/go.sh` shows the steps; its paths are those of the worktree that made them).

- **s2-d1** (1280 px, `grep -h "$USER" /var/log/*.log | sort | uniq -c | sort -rn | head -5`, depth 1). The toolbar row: Depth [1 What it does | 2 How bash reads it], the switch, "Key ▾". "In short: Shows the 5 most frequent lines mentioning your user name in /var/log/*.log, with their counts." Then "Risks on this line" with one headline and "more". Then a folded "Run the whole line on sample lines". Then the pipeline as a bracket, one box per command (grep, sort, uniq, sort, head) with a "program" badge. Inside grep's box, `"$USER"` has a chip that links to the problem. The panel calls the note a "Risk"; the Problems pane uses the level's own word. Two words for one note.
- **s2-d2-full** (same line, depth 2, switch off). Each row has a muted line under its text: "argument → operand · grep reads it §3.7.1". `"$USER"` has "bash's steps: ~~brace~~, ~~tilde~~ (none) → parameter expansion → ~~word splitting~~, ~~globbing~~ (quoted) → quote removal", then the rule of double quotes. Each `|` is its own row: "stdout of grep → stdin of sort". `-rn` splits into `-r` and `-n`, each "part of -rn". The page is long: 1,361 to 1,505 px at 1280 px wide, and 2,007 to 3,045 px at 390 px, for one line (the gallery's index.html).
- **s4-d2w-full** (`if [[ -f config.ini && $DEBUG == 1 ]]; then source config.ini; fi`, depth 2, switch on). `if`, `;`, `then`, `fi` and `[[ … ]]` each carry the mark "bash only". `[[ ]]` says "No program runs: bash evaluates [[ … ]] itself" and what it evaluates after expansion. `source` says what it receives (`config.ini`, tinted). The persona users read "bash only" on `if` as "a bashism", which is wrong.
- **extra-s3-d1-risk-more** (`tar -czf "$backup" ~/docs 2>/dev/null || echo "failed" >&2`, depth 1, "more" open). Headline: "If tar fails, this line still reports success (status 0)." "more" has the `2>/dev/null` sentence, the sections, and "Fix (the whole line, to copy)" with a Copy button. It lost the cron/CI half that the Problems pane says. The headline also drops the condition of the note: for a file with no shebang, the pane says "if this file is run as a script…", and the headline states it as a fact.

## 3. Decisions already taken

From the maintainer, 2026-10-27:

1. The screenshot-persona rounds stop.
2. Round 11 is the base design. It is rebuilt as a series of real PRs, with the fixes below.
3. Then the roadmap's usability test runs, on an interactive build (section 7).

The answers to the plan's questions, from the maintainer, 2026-10-27:

4. **Note levels.** Three levels will come, in a plan of their own (a revision of docs/design/note-levels.md): Error (red, "fails every time as written"), Warning (yellow: damage that cannot be undone, or the script's own exit status turned into success) and Info (blue). `failure-reported-as-success` and `source-searches-path` become Warning there. This plan depends on none of it: the panel reads each problem's level, mark and word from the catalog.
5. **Order.** P1 to P10 start after roadmap items 1 to 8 are done. Studies that can run in parallel may (a measure, a sketch, a prototype that lands nothing).
6. **Short names in the view slot.** "1 Does" / "2 Reads" (「1 何をする」/「2 読まれ方」). The full names ("What it does", "How bash reads it") are the tooltip and the accessible name.
7. **Copy as Markdown and the hover** stay as today's list of parts. No step changes them.
8. **The no-shebang case** of `failure-reported-as-success` stays: the note keeps that case. A user who does not want it changes the script (a shebang, or a fix). Its fix must not end the caller's shell when the file is sourced (P3).

The fixes, from the last persona round:

- **The mark "bash only"** said "bashism" to readers (on `if`, `for`, `fi`). It becomes "handled by bash" / 「bash が処理」, with the tooltip "bash handles it; the program never sees it". One rule places it, once per construct (step P9). The real bash-vs-POSIX fact (`[[ ]]`, `==` in `[ ]`, `source`) gets a mark of its own, "not in POSIX sh". It comes from the dialect table (`FEATURES` in src/dialect.ts: no feature there is POSIX sh).
- **One word per level.** The panel, its chips, the Key and the Problems pane name a note's level the same way: the level's mark and word from the catalog (src/messages.ts: `MARKS` and the level words), or the note's heading where it has one ("Shell injection risk:"). The icons' accessible names come from the same table; today src/ui/panelView.ts gives them other words. The box is "Problems on this line" / 「この行の問題」, as the Problems pane is named. Each item shows its level's mark. The word "risk" leaves the panel's own texts. The plan names no level: how many levels there are, and which word each has, is the catalog's (decision 4).
- **"more" says all that the Problems text says.** It shows the note's whole text, the same string as the pane. The headline is added above it, never in place of it. Round 11 dropped the cron/CI half of `failure-reported-as-success` and the `shopt -s nullglob` alternative of the loop caveat.
- **A headline keeps the conditions of its text.** A note whose text depends on its params ("if this file is run as a script…") has a headline per case.
- **"In short" on every line** with code, assignments (with the value the variable gets) and `done` included. It never says what a problem of the line says.
- **English and Japanese rows agree.** Both come from the same role ids (`$backup`: "argument → value of -f" in both).
- **Nothing clipped:** no text cut in the names box, no chip split over two lines, role labels at one position on every row.
- **Depth 2 complete but calm.** "bash's steps" fold for a word where no step acts. Arithmetic expansion is named in the steps. The page has a length budget (P8).

## 4. What to keep, what to rewrite

The prototype was built fast. It has hacks and loosened tests. Two web tests were left failing at the end of round 11 (test/web-pipeline-marks.test.ts, test/web-explanation.test.ts; not re-run for this plan). Nothing is merged from the branch as it is. Each step takes the parts it needs and brings them to the bar of section 5.

| Part | Verdict | Why, and how |
| --- | --- | --- |
| Small explanation fixes (`if`, `;` before a reserved word, `[[ $x == 1 ]]` as a plain comparison, AND/OR status wording in Japanese, the `%F` example, the `HOME` text) | Keep | Real fixes. Tests against bash (P2). |
| tar's operands by mode (src/dict/commands.ts) | Keep | Spec data. Checked with GNU tar (P2). |
| Pattern or plain comparison in `[[ ]]` (`isPlainWord && !hasGlob` in src/explain/tests.ts; the regex ``/[*?[$`\\'"]/`` in src/reading.ts) | Rewrite | Decided from the word model (`wordMeaning`), not from the text (P2). |
| `failure-reported-as-success`: a long command named, not cut (src/statusfacts.ts) | Keep | P2. |
| `failure-reported-as-success`: the no-shebang case | Keep, fix | Kept (decision 8). Its fix ends with `exit 1`, which would end the caller's shell when the file is sourced; P3 fixes that. |
| `globMissReason` (src/examples/shellwords.ts) | Keep, test | Each reason checked against bash's globbing (P6). |
| Pipeline example values (`SAMPLE_VALUES` in src/explain/examples.ts) | Move | A table of names in src/explain/ breaks CLAUDE.md. The values go to the example layer, from `wellKnownVariables` in src/dict/syntax.ts (P6). |
| "Options only" in src/explain/examples.ts (the regex `/^-[hFEns]+$/`) | Rewrite | Whether grep reads a word as a regex comes from the spec (`lang: 'regex'`, `OptionSpec.whole`), not from the letters (P6). |
| src/examples/pipeline.ts, src/examples/rerun.ts, src/explain/context.ts (glob examples kept beside the whole-pipeline example) | Review | This changes an example rule of CLAUDE.md ("Explanations"). Kept only as a stated rule with a test (P6). |
| `trustedFields` (src/semantics/words.ts) | Review | A new reader of the word model. Kept only if P4 needs it, with the word probes (P4). |
| src/argvline.ts | Rewrite | The idea is right. Its texts move to the catalog. It reads the argument interpreter and `wordFields` only. Argv capture in bash checks it (P4). |
| src/linesummary.ts | Rewrite | It compares names (grep, sort, uniq, tar, echo, wc) and has seven shapes. It keeps its own copy of the test operators (`S.tests`) and calls `pitfallFindings`. Every line needs a sentence: a composition from the specs and the models, and the known shapes as idioms (P5). |
| src/reading.ts additions (`from`, `steps`, `argv`, `cond`, `summary`, `code`) | Keep the fields, move the texts | Its inline tables `TEXTS` and `OPERANDS` repeat `unaryTestOps` and `binaryTestOps` of src/dict/syntax.ts. One table, used by both (P2, P8). The sentence of the line is not kept here (P5). |
| src/analyzer.ts helpers `variableFrom` | Move | analyzer.ts stays the orchestration (docs/design/analyzer.md). To src/explain/words.ts (P5). |
| src/analyzer.ts helpers `wordExpands`, `wordTildes` | Move | They serve depth 2: to the module of words (P8). |
| src/analyzer.ts `otherLines` | Move | It explains up to 100 more lines, lean, on each request. It moves to src/document.ts, beside the lean explanation of every line that `noteIssues` already makes and caches per tree (`noteIssueCache`). The panel reads the other lines from that cache (P7). |
| src/ui/panel.ts: `service.explain(doc, line, true)` | Rewrite | The prototype builds the reading tree on every request. src/ui decides what to compute from the state; measured (P7, P8). |
| `HEADS` in src/messages.ts, `fixLine` in src/pitfalls.ts | Rewrite | The fix as `Rewrite` data (docs/design/oracles.md, 3.2), not as a string of the whole line (P3). A headline per catalog entry and per style check, required by the type (P7b). |
| `aroundLines` (src/ui/panelView.ts) | Keep, test | The problems of the lines around (the `for` of a loop body). It explains each of those lines again; it reads them from the cache above instead. Unit tests (P7). |
| media/panel.js row building (`buildRows`, `prune`, `repeats`, `splitLong`, `bashOnly`, the Key) | Rewrite in TypeScript | It decides facts by comparing texts and matching "(default: …)" in them. A row model in src/ui/ (covered, section 5) builds the rows from data; panel.js only draws them (P7). |
| src/ui/render.ts (+283 lines: the Key and the chips' texts) | Rewrite | Texts to the catalog, entries from the row model (P7, P9). |
| media/panel.css (+2,180 lines) | Rewrite | Eleven rounds of overrides. Keep the final look; write the rules once, with the colours as roles of the palettes (section 5). |
| web/index.html (`hidden style="display:none"` on the view switch) | Rewrite | Removed for real when the tabs go (P8). |
| test/web-depth-stability.test.ts | Keep | Its "a word says the same on every line" half joins P7. Its "a deeper step only adds" half needs depth 2 and joins P8. It grows with P9. |
| Changed expectations in test/reading.test.ts, lists.test.ts, status.test.ts, oldstyle.test.ts | Review each | A changed expectation stays only as a wanted change, with a test against the real tool. |

## 5. The bar for every step

- Every test passes, web tests included. A web test that fails is fixed, not loosened.
- 100% line and branch coverage of `src/`, measured in CI, at every step. So the logic lives in `src/` (TypeScript, unit-tested), and media/panel.js only draws. Code is removed in the same PR that removes its tests.
- Facts come from the models and the catalog: `wordMeaning`, `wordFields`, the argument interpreter, `resolveName`, the status model, the dialect tables. New notes go in src/messages.ts. No command names compared in src/explain/; no new one-off fields in src/dict/types.ts. The import layering of src/explain/ holds (test/explain-imports.test.ts). A named shape goes in src/idioms.ts, the agreed home for idioms that compare names.
- Each fact the panel adds is checked against the real tool: bash for argv, values, globs and rewrites; GNU grep, GNU tar and coreutils for examples.
- English and Japanese texts come from the same ids. Japanese follows docs/japanese-style.md.
- Each PR lists the text changes of `npx tsx test/snapshot.ts` (main against the branch).
- New colours are roles of the theme palettes (classic, theme, themeLike, high contrast; docs/design/theme-colours.md), checked by test/themeColours.test.ts. A role per level comes from the level table, so a new level adds one.
- Layouts are checked with the CJK fonts of CI at 390, 640 and 1280 px, in both languages, and with long names (CLAUDE.md, "Tests that run bash", last item). Screenshots go with each visual PR.
- Speed: a cursor move on a 2,000-line script stays under a budget (proposed: 50 ms at the 95th percentile on CI's machine), from the step that adds work per request (P7) on.
- A fresh reviewer (a subagent with no context) reviews P3, P4, P5, P7 and P8 before merge.

## 6. Steps

Each step is a PR from the latest main, useful on its own. A step with letters is several PRs, in that order. The CHANGELOG lines are drafts; details go in docs/changes/unreleased.md.

### P1. The view slot contract

What: `viewControl(state, lang)` in src/ui/panelView.ts describes the panel's view control as data (section 6.1). The page draws its view slot from it; the panel draws its own header from it. It still returns Meaning | Reading.

Users: nothing changes. No CHANGELOG line.

Tests: unit tests of `viewControl`. A web test: a press in the page's slot changes the panel, and the choice is kept after a reload.

Risks: the chrome series edits web/panel-bridge.ts too. P1 starts after roadmap items 1 to 8, like the other steps (decision 5). It lands before C7 of [chrome-redesign.md](chrome-redesign.md), which draws the slot from `viewControl`. Keep the PR small.

### P2. Explanation fixes found by the prototype

What: the wording fixes of round 11 in today's views.

- `if` starts the condition.
- `;` before a reserved word ends the commands before it.
- `[[ $x == 1 ]]` with no wildcard is a plain comparison, said once on `==`. Pattern or plain is read from the word model (`wordMeaning`), not from the text.
- `[[`, `]]` and each operand of `[[ ]]` get rows in Reading.
- tar's operands by mode (files to archive, members).
- "the last command run" in the Japanese AND/OR text.
- The `%F` example of `date`, and the text of `HOME`.
- `failure-reported-as-success` names a long command (`tar`) rather than cutting it.

The test operators' operand kinds go in src/dict/syntax.ts, read by src/explain/tests.ts and src/reading.ts.

CHANGELOG (Fixed): "The explanations of `if`, of `;` before a reserved word, of `==` with no wildcard in `[[ ]]`, and of tar's file operands say what bash and tar do."

Tests: test/reading.test.ts and test/lists.test.ts against bash (`[[ $x == 1* ]]`, `[[ $x == "1*" ]]`, `-eq` with arithmetic); tar's operands with GNU tar (`tar -tf` lists what `-c` was given).

Risks: small. The snapshot shows every changed text.

### P3. Fixes to copy, as data

What: facts whose fix is mechanical carry `Rewrite` data (oracles.md 3.2): `failure-reported-as-success`, `source-searches-path`, `pattern-from-variable` and `unmatched-glob-runs-once` first. The data and its tests are oracles.md steps 4 to 6 (B2, B3, B4), part of roadmap item 4, which comes before this series (decision 5). `source-searches-path` and `pattern-from-variable` are style checks (`StyleCode` in src/pitfalls.ts), so they need B4. P3 does those steps for these four ids if item 4 has not. The note's text renders its fix from the same data, so the two cannot disagree. VS Code, the Language Server and the web page's editor (web/editor.ts, CodeMirror's lint actions) offer each rewrite as a quick fix (src/fixes.ts).

Two fixes need care:

- **A file that may be sourced.** `exit 1` there ends the caller's shell. The fix ends only the file: `return` where the file may be sourced, `exit` where it is run.
- **`source lib.sh`.** `./lib.sh` still depends on the current directory, which the note warns about (cron starts in `$HOME`). The fix names the script's own directory (`"$(dirname "$0")/lib.sh"`, or a form that holds when the file is itself sourced), or there is no quick fix. B3 decides.

CHANGELOG (New): "Quick fixes for a failure reported as success, `source` that searches `$PATH`, a `grep` pattern from a variable, and a loop over a glob that matches nothing."

Tests: oracles.md B2 to B4 for these ids. Each rewrite runs in bash, both when the file is run and when it is sourced: the hazard is gone (the caller sees the failure; the library is read from the script's directory; `-F` matches `a.b` only as written, with GNU grep), the meaning is kept, the caller's shell goes on, `bash -n` passes, and explaining the rewrite raises no note of the same id.

Risks: two of these notes change level with the three levels (decision 4); this step does not depend on it.

### P4. What the program receives, as data

P4a. Oracles.md step 2 (A1). Roadmap item 4 does it before this series (decision 5); if it has not, it lands here as its own PR first: argv capture over sample.sh and the fixtures, with a stub program that prints its argv, in a sandbox (cgroup, `FUNCNEST`, a process group killed on timeout). It is a pure test of `wordFields`. Known differences in test/fixtures/argv-known.json, each with a reason. The bugs it finds are fixed in their own PRs, each with a Fixed line.

P4b. src/argvline.ts rebuilt on top. For each simple command: the words its program receives after expansions, quote removal, splitting and globbing (from `wordFields` and `wordMeaning`), placeholders for values known only at run time ("‹current user name›", "‹each name matching *.log›"), and what bash took out (assignments, redirections with their effect). Data on the explanation, not yet drawn.

Users: nothing yet. No CHANGELOG line of its own.

Tests: P4b's data against the capture of P4a, over the same corpus.

Risks: the capture finds old bugs in the word model. They land before P4b.

### P5. "In short" on every line

What: one sentence for each line with code, at the top of today's Meaning view. A composition from the tree (a list, a pipeline, a loop, a condition), the commands' summaries and their options, and the facts of the models (the status, what `set -e` does, the value an assignment gives, from P4's placeholders). The shapes with a sentence of their own (the "most frequent lines" pipeline, `cmd || echo msg >&2`) become idioms in src/idioms.ts, the agreed home for shapes that compare names. A closing word (`done`, `fi`, `}`) says what it ends and what that construct does.

Where it lives: a field of `LineExplanation`, not of the reading tree as in the prototype. Today's `LineExplanation.summary` (the commands' labels joined; read by tests and the bats host, shown by no view since #318) stays. Both are made from the same command summaries, so neither restates a fact the other owns.

Rules:

- It never states a fact that a problem of the line states. The problem says it once, in the box.
- It never retypes the line: no code span in it holds more than one shell word of the line.

CHANGELOG (New): "The panel starts with one sentence that says what the line does."

Tests: every line of sample.sh and the fixtures gets a sentence, in both languages. The values in it are checked with bash (an assignment's value printed with a fixed `HOME` and a stub `date`). The two rules above, over the corpus. A sentence never says what a row below says alone (round 11's rule).

Risks: a generic sentence can be flat ("Runs `a`, then `b`"). The usability test judges it; idioms add better ones later.

### P6. Examples of the whole line and of globs

What: the pipeline example runs with example values of variables the script does not set (`$USER` is `alice`, said in its note). The values come from `wellKnownVariables` (src/dict/syntax.ts). They stay in the example layer and never reach `wordFields` or `wordValue`. `wellKnownVariables` is a `Record<string, Text>` today; a value per name changes its shape, which touches src/ui/reference.ts, src/explain/words.ts and src/explain/scripts.ts. A name the table lacks (`LOGNAME`) gets a row first. When grep reads such a value as a regex (from the spec: `lang: 'regex'`, `OptionSpec.whole`), a sample line shows it matching inside a longer word. The glob example adds "Not matching, and why" (a leading dot with `dotglob` off, `*` does not cross `/`, a different ending). Glob examples shown beside the whole-pipeline example are a change of the example rule; CLAUDE.md is updated in the same PR.

CHANGELOG (Changed): "The example of a pipeline runs with an example value of `$USER` and the like. The names a glob example tries say why each one does not match."

Tests: the reasons against bash's globbing in a temporary directory (with `dotglob` and `globstar` on and off: the name matches once the reason is lifted). The grep lines with GNU grep, in test/examples-*.test.ts.

Risks: an example value could be read as the real one. The note says it is an example.

### P7. One view, depth 1

Three PRs:

- **P7a. The row model.** `src/ui/panelRows.ts`: a pure function of the explanation, the depth and the switch. It builds the rows, the text of each depth, the boxes, the role ids, the marks and the Key entries. Data only, drawn by nothing yet, with its tests. It stays under the 1,000 lines of test/file-length.test.ts (split by part if it grows). The basis chips of roadmap item 2 ("Not in the manual · checked with bash 5.2", "Try it") are row data here, as item 2 lands before P7 (section 8, decision 3).
- **P7b. The problems box, in today's Meaning.** Each warning and caveat gets a headline: one sentence in its catalog entry or style check, required by the type (as test/suggestions.test.ts requires a class), and per params where the text has cases. The box "Problems on this line": each item with its level's mark and word from the catalog, the headline, "more" with the whole text and the fix to copy (P3), and chips that link each row to its problem and back. A line inside a construct gets a pointer to the problem on the construct's line, with the level's word and the line number.
- **P7c. The grid and the boxes.** The Meaning tab becomes depth 1 of the new view: "In short", the problems box, the folded whole-line example, the grid, a box per command. Reading stays as the second tab.

The problems of the lines around need the explanations of other lines. `otherLines` moves to src/document.ts and reads the lean explanations cached per tree there (section 4). The speed benchmark comes in this step, with the budget of section 5.

CHANGELOG (Changed): "The Meaning view starts with the line's problems, each with a fix to copy, and shows each command in a box."

Tests: unit tests of the row model: a word says the same on every line of its statement; a fact is said once per panel; ja and en rows have the same role ids; "more" equals the Problems text for every problem of the corpus; a headline per case of params; no text of the panel's own says "risk" (a note's heading may). The first half of test/web-depth-stability.test.ts ("a word says the same on every line"), and the two failing web tests fixed. Layout tests: the names box clips nothing, no chip breaks, at three widths, in both languages, with long names. The speed benchmark on a 2,000-line script.

Risks: the biggest step, hence the three PRs.

### P8. Depth 2, and the tabs go

What: Reading becomes depth 2 of the same view. Each row gets one role line, at one position ("argument → value of -f · tar reads it §3.7.1"). A word that expands gets bash's steps in bash's order, arithmetic expansion named (`wordExpands`, `wordTildes` move to the module of words); the steps fold to one line where none acts. Each `|` is a connector row; reserved words and operators are rows. The tabs go: the depth control takes the view slot (P1's `viewControl` now returns the depths), in the page and in VS Code's panel header. Keys 1 and 2.

The eight steps go in the same PR, with their tests: `layers`, `PanelState.view` and `step`, the page's stepper, test/web-tree-steps.test.ts and the reading tree's fields no row reads. Each test that goes is replaced by a test of what took its place. A stored view "tree" opens at depth 2.

`bashExplainer.panel.animations` keeps driving the folds (bash's steps, "more", the examples); off, they open at once.

The reading data is now built on every request. The benchmark runs again, under the same budget.

CHANGELOG (Changed): "The panel has one view with a depth: 1 What it does, 2 How bash reads it. Before, it had two tabs, Meaning and Reading, with eight steps." README's "The panel" is rewritten in the same PR.

Tests: depth 2 adds to depth 1 and moves nothing (the second half of test/web-depth-stability.test.ts); every reserved word and operator has a row at depth 2; the word steps against the word probes (test/fixtures/probes/words.json); test/reading-manual.test.ts still passes; the VS Code integration tests. Web tests of the slot at 390, 640 and 1280 px. A length budget: the page at depth 2 for each line of the four test scripts stays under a height at 1280 and 390 px (proposed: half the prototype's, 750 and 1,500 px), as a web test. The speed benchmark.

Risks: users of Reading's eight steps lose them. The changelog says so.

### P9. "What the program receives"

What: the switch, on by default, remembered once chosen (key W). Under each command, the words its program receives as chips (P4); a word received as written is tinted.

The mark "handled by bash", by one rule: once per construct that no program receives (not in any argv of P4, not a command name), on its first row, at both depths, only with the switch on. An `if … fi` gets one mark, not one on `if`, `then`, `;` and `fi`.

The mark "not in POSIX sh", on the construct only, where it uses a feature of `FEATURES` (src/dialect.ts). The table holds no feature of POSIX sh, so the mark says "not in POSIX sh", not "fails in dash": dash has some of them (`local`). It shows on a bash script too, as a quiet mark (section 8, decision 2); the dialect issues still show only for the target shell.

The Key lists the marks drawn, the level marks included, inline in the panel.

CHANGELOG (New): "A switch shows what each program receives: its words after bash's expansions, and the parts bash handles itself. A mark shows what POSIX sh lacks."

Tests: the rule of "handled by bash" against P4's argv data, over the corpus, with the count per construct (one). The dialect mark against the dash and yash measurements that test/dialect.test.ts already checks; `bash --posix` is no oracle (it runs `[[ ]]`, `==` in `[ ]` and `source`). Chips whole at three widths; the Key's entries equal the marks drawn.

Risks: two marks on one row read as noise. The usability test checks it.

### P10. Clean-up and the last measure

What: the reading tree's fields and helpers that P8 left unread, if any. The speed measure again on the whole series, before (main at P6) and after. docs/design/tree-view/README.md gets status "Replaced by panel-redesign.md". README images re-recorded.

Users: no CHANGELOG line, unless the measure shows a change users see.

Tests: test/file-length.test.ts; the coverage gate.

### 6.1 The view slot contract

The web page's chrome is redesigned beside this plan: [chrome-redesign.md](chrome-redesign.md), from prototype round 8 (`proto/chrome-8`). There, the panel header has a "view slot" of fixed width. It holds one control at every width: "Depth", then segments with digits, the selected one with its short name; below about 240 px of slot, a menu "Depth 1 ⌄". On a phone it is the same control, a 44 px pill in the tabs row (chrome-redesign.md, decision 4, step C7). The two series meet only here:

- **The panel owns the view state.** `PanelState` holds it (`depth`, `receives`; today `view`, `step`). The panel applies it. VS Code keeps it in the extension's `globalState` (src/ui/panel.ts) and in the webview's state; the page keeps it in storage (`STORAGE_KEYS.panel`). Both send it with the existing `panelState` messages, in both directions.
- **The control is data.** `viewControl(state, lang)` gives the label, and for each option its id, icon, short name, full name and pressed state, and optional steps (Reading's eight, until P8). The page draws the slot from it, as segments, as a menu or as the icon alone; the VS Code panel draws its own header from it. A press sets the state and sends it. The page never knows what the options mean.
- **What to compute is decided in src/ui, not in the page.** Today the hosts build the reading tree only when `view === 'tree'` (web/panel-bridge.ts, src/ui/panel.ts). A function of src/ui says, from the state, which data the explanation needs (the reading tree at depth 2, argv with the switch on). Both hosts call it.
- **The fit is chrome's; the words are the panel's.** Each short name fits its segment at the slot's widths, in both languages and with the CJK fonts (a web test, from P1 on). The full name is the tooltip and the accessible name. The switch "What the program receives" and the Key stay in the panel's own row, under the line box, not in the slot.

The panel handles keys 1, 2 and W when the focus is in it. The page binds none of them. The page's Help list of shortcuts names them, "in the panel".

## 7. The usability test

After P10 and the chrome series ([chrome-redesign.md](chrome-redesign.md), C9), as roadmap item 11. The users are simulated: agents, not people. So the test shows what an agent can find and do in the panel. It is not a measure of human usability. VS Code is not tested: the users drive the web page.

- **Users:** five simulated users (fresh agents with no project context): a beginner, a certification learner (LPIC/LinuC), a sysadmin, a developer and a UX designer, the personas of the usability test of October 2026. At least two models among them; the report gives the spread by model.
- **Briefing:** each agent gets its persona, the page and the tasks. It is not told the goal score, that the panel was redesigned, or what the earlier rounds found.
- **Build:** the web page built from main (`npm run build:web -- --channel=next`), served locally. Each user drives the running page in a browser: moves the cursor, changes depth, flips the switch, opens examples, copies a fix. No screenshots handed to them. The browser sessions run through `~/.claude/bin/heavy`.
- **Sessions:** at 1280 px and at 390 px; one user works in Japanese.
- **Scripts:** two of the four tuning scripts of the persona rounds, and three scripts none of the rounds used, drawn with a seed from the corpus (test/fixtures/snippets.json and the fixtures). The seed is in the report.
- **Tasks**, the same for everyone. Task 0 has no key; tasks 1 to 6 each have an answer key:
  0. Explore the page for a few minutes, then say what it offers and how to reach each part.
  1. Say what line N does, in one sentence.
  2. Find the problem on line N, and copy its fix.
  3. Say which words `grep` receives, and which part bash handles itself.
  4. Say what bash does to `"$USER"` before grep runs.
  5. Say which file names the glob matches, and why one does not.
  6. Say whether the script runs in POSIX sh, and what would fail.
- **Scoring:** first, task success against the key: each user solves at least 5 of tasks 1 to 6. Second, each user gives an overall score out of 10, with the three things that cost the most.
- **Baseline:** the same protocol runs on today's main (before P1 and the chrome's C1) first, with other agents. The report sets both side by side.
- **Goal:** every user passes the task gate, and the average score is 9/10 or more. Below it, the findings become explanation bugs or panel PRs, and the test runs again with new agents. After two runs below the goal, the maintainer decides.
- **People:** a short session with real people, if the maintainer can arrange one, before the README claims anything about usability.

## 8. The open questions, answered

The maintainer answered the plan's three open questions on 2026-10-27:

1. **The CLI.** Its output stays as today's list of parts, like Copy as Markdown and the hover (decision 7). It follows neither the depth nor the switch. No step changes it.
2. **"Not in POSIX sh" on a bash script.** The mark shows on a bash script too, as a quiet mark. It is a fact of the construct: useful when moving a script to sh, and for learners. The dialect issues (the problems) still show only for the target shell (P9).
3. **Roadmap item 2 before P7.** Yes. Item 2 (the basis chips and "Try it") lands before P7, so P7's row model takes its chips as row data (P7a).
