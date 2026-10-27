# Panel redesign: one view with a depth

The plan that turns prototype B into real PRs, then the usability test. Agreed with the maintainer on 2026-10-27.

Status: planned. No step started.

## 1. Goal

The panel explains the line in one view instead of two tabs. A reader picks how deep to go: what the line does, or how bash reads it. A switch shows what each program receives. The problems of the line come first, each with a fix to copy.

The end point is the roadmap's usability test: five users give the panel an average of 9/10 or more (section 7).

## 2. What prototype B is

Branch `proto/modes-b11` (34981fe2), round 11 of 11. It touches 33 files, +6,028 lines: most of it in media/panel.js (+1,700) and media/panel.css (+2,200). The gallery of round 11 is in `~/.cache/explain-bash-tmp/proto-b11/` (not committed).

What it shows:

- **One view.** The tabs "Meaning | Reading" are gone. A Depth control has two steps: 1 "What it does", 2 "How bash reads it". A deeper step only adds rows and lines; nothing moves.
- **A switch "What the program receives"**, on by default. It shows the words each program gets (argv) and its streams.
- **On top:** "In short", one sentence for the line (src/linesummary.ts), then the box of the line's problems. Each problem has a one-line headline and a "more" with a fix to copy. A chip on the row ("ⓘ Caveat ↑") links to the box, and back. A line inside a construct gets a pointer "↑ Risk on line N".
- **Examples:** "Run the whole line on sample lines" runs one data set through every stage of a pipeline. A glob gets a box of names to try, with why each name does not match.
- **The rows:** a two-column grid (code, text). A box around each command. At depth 2 each row gets one muted role line ("argument → option · grep reads it §3.7.1"). A word that expands gets bash's steps (brace → tilde → … → quote removal). A pipe is a connector row ("stdout of grep → stdin of sort"). A Key, drawn inline, lists the marks on screen.

### Screenshots, in words

- **s2-d1** (1280 px, `grep -h "$USER" /var/log/*.log | sort | uniq -c | sort -rn | head -5`, depth 1). The toolbar row: Depth [1 What it does | 2 How bash reads it], the switch, "Key ▾". "In short: Shows the 5 most frequent lines mentioning your user name in /var/log/*.log, with their counts." Then "Risks on this line" with one ⓘ headline and "more". Then a folded "Run the whole line on sample lines". Then the pipeline as a bracket, one box per command (grep, sort, uniq, sort, head) with a "program" badge. Inside grep's box, `"$USER"` has a "ⓘ Caveat ↑" chip. The Problems pane says "Caveat:". So the panel says "Risk" and the pane "Caveat" for one note.
- **s2-d2-full** (same line, depth 2, switch off). Each row has a muted line under its text: "argument → operand · grep reads it §3.7.1". `"$USER"` has "bash's steps: ~~brace~~, ~~tilde~~ (none) → parameter expansion → ~~word splitting~~, ~~globbing~~ (quoted) → quote removal", then the rule of double quotes. Each `|` is its own row: "stdout of grep → stdin of sort". `-rn` splits into `-r` and `-n`, each "part of -rn". The page is long: almost two screens for one line.
- **s4-d2w-full** (`if [[ -f config.ini && $DEBUG == 1 ]]; then source config.ini; fi`, depth 2, switch on). `if`, `;`, `then`, `fi` and `[[ … ]]` carry the mark "bash only". `[[ ]]` says "No program runs: bash evaluates [[ … ]] itself" and what it evaluates after expansion. `source` says what it receives (`config.ini`, tinted). The surveyed users read "bash only" on `if` as "a bashism", which is wrong.
- **extra-s3-d1-risk-more** (`tar -czf "$backup" ~/docs 2>/dev/null || echo "failed" >&2`, depth 1, "more" open). Headline: "If tar fails, this line still reports success (status 0)." "more" has the `2>/dev/null` sentence, the sections, and "Fix (the whole line, to copy)" with a Copy button. It lost the cron/CI half that the Problems pane says.

## 3. Decisions already taken

From the maintainer, 2026-10-27:

1. The screenshot-persona rounds stop.
2. Round 11 is the base design. It is rebuilt as a series of real PRs, with the fixes below.
3. Then the roadmap's usability test runs, on an interactive build (section 7).

The fixes, from the last survey round:

- **The mark "bash only"** said "bashism" to readers (on `if`, `for`, `fi`). It becomes "handled by bash" / 「bash が処理」, with the tooltip "bash handles it; the program never sees it". One rule places it (step P9). The real bash-vs-POSIX fact (`[[ ]]`, `==`, `source`) gets a mark of its own, "not in POSIX sh", from the dialect checks.
- **One word per level.** The panel, its chips, the Key and the Problems pane use the note's own label: ⚠ "Pitfall" / 「落とし穴」 for a warning, ⓘ "Caveat" / 「注意」 for info (`NoteLevel` in src/messages.ts), or the note's heading where it has one ("Shell injection risk:"). The box is "Problems on this line" / 「この行の問題」, as the Problems pane is named. Each item shows its level's icon. The word "risk" leaves the panel's own texts.
- **"more" says all that the Problems text says.** It shows the note's whole text, the same string as the pane. The headline is added above it, never in place of it. Round 11 dropped the cron/CI half of `failure-reported-as-success` and the `shopt -s nullglob` alternative of the loop caveat.
- **"In short" on every line** with code, assignments (with the value the variable gets) and `done` included.
- **English and Japanese rows agree.** Both come from the same role ids (`$backup`: "argument → value of -f" in both).
- **Nothing clipped:** no text cut in the names box, no chip split over two lines, role labels at one position on every row.
- **Depth 2 complete but calm.** "bash's steps" fold for a word where no step acts. Arithmetic expansion is named in the steps.

## 4. What to keep, what to rewrite

The prototype was built fast. It has hacks, loosened tests and two failing web tests (test/web-pipeline-marks.test.ts, test/web-explanation.test.ts). Nothing is merged from the branch as it is; each step takes the parts it needs and brings them to the bar of section 5.

| Part | Verdict | Why, and how |
| --- | --- | --- |
| Small explanation fixes (`if`, `;` before a reserved word, `[[ $x == 1 ]]` as a plain comparison, AND/OR status wording in Japanese, `%F` example, `HOME`) | Keep | Real fixes. Tests against bash (P2). |
| tar's operands by mode (src/dict/commands.ts) | Keep | Spec data. Checked with GNU tar (P2). |
| `failure-reported-as-success`: the no-shebang case, a long command named, not cut (src/statusfacts.ts) | Keep | The case is open question 5. |
| `globMissReason` (src/examples/shellwords.ts) | Keep, test | Each reason checked against bash's globbing (P6). |
| Pipeline example values (`SAMPLE_VALUES` in src/explain/examples.ts) | Move | A table of names in src/explain/ breaks CLAUDE.md. The example values go to `wellKnownVariables` in src/dict/syntax.ts (P6). |
| src/argvline.ts | Rewrite | The idea is right. Its texts move to the catalog; it reads the argument interpreter and `wordFields` only; argv capture in bash checks it (P4). |
| src/linesummary.ts | Rewrite | It matches names (grep, sort, uniq, tar, wc) and covers eight shapes. Every line needs a sentence: a composition from the specs and the models, and the known shapes as idioms (P5). |
| src/reading.ts additions (`from`, `steps`, `argv`, `cond`, `summary`, `code`) | Keep the fields, move the texts | Its inline tables `TEXTS` and `OPERANDS` repeat the test operators of src/dict/syntax.ts. One table, used by both (P2, P8). |
| src/analyzer.ts helpers (`variableFrom`, `wordExpands`, `wordTildes`, `otherLines`) | Move | analyzer.ts stays the orchestration (docs/design/analyzer.md). `otherLines` explains up to 100 more lines on each request: cached per document version, and measured (P7, P10). |
| `HEADS` in src/messages.ts, `fixLine` in src/pitfalls.ts | Rewrite | A headline per catalog entry and per style check, and the fix as `Rewrite` data (docs/design/oracles.md, 3.2), not as a string of the whole line (P3). |
| `aroundLines` (src/ui/panelView.ts) | Keep, test | The problems of the lines around (the `for` of a loop body). Covered by unit tests (P7). |
| media/panel.js row building (`buildRows`, `prune`, `repeats`, `splitLong`, `bashOnly`, the Key) | Rewrite in TypeScript | It decides facts by comparing texts and matching "(default: …)" in them. A row model in src/ui/ (covered, section 5) builds the rows from data; panel.js only draws them (P7). |
| media/panel.css (+2,200 lines) | Rewrite | Eleven rounds of overrides. Keep the final look; write the rules once. |
| web/index.html (`hidden style="display:none"` on the view switch) | Rewrite | Removed for real when the tabs go (P8). |
| test/web-depth-stability.test.ts | Keep | It states "a deeper step only adds" and "a word says the same on every line". It joins P7 and grows with P8 and P9. |
| Changed expectations in test/reading.test.ts, lists.test.ts, status.test.ts, oldstyle.test.ts | Review each | A changed expectation stays only as a wanted change, with a test against the real tool. |

## 5. The bar for every step

- Every test passes, web tests included. A web test that fails is fixed, not loosened.
- 100% line and branch coverage of `src/`, measured in CI. So the logic lives in `src/` (TypeScript, unit-tested), and media/panel.js only draws.
- Facts come from the models and the catalog: `wordMeaning`, `wordFields`, the argument interpreter, `resolveName`, the status model, the dialect tables. New notes go in src/messages.ts. No command names compared in src/explain/; no new one-off fields in src/dict/types.ts. The import layering of src/explain/ holds (test/explain-imports.test.ts).
- Each fact the panel adds is checked against the real tool: bash for argv, values, globs and rewrites; GNU grep, GNU tar and coreutils for examples.
- English and Japanese texts come from the same ids. Japanese follows docs/japanese-style.md.
- Each PR lists the text changes of `npx tsx test/snapshot.ts` (main against the branch).
- Layouts are checked with the CJK fonts of CI at 390, 640 and 1280 px, in both languages (CLAUDE.md, "Tests that run bash", last item). Screenshots go with each visual PR.
- A fresh reviewer (a subagent with no context) reviews P4, P7 and P8 before merge.

## 6. Steps

Each step is a PR from the latest main, useful on its own. The CHANGELOG lines are drafts; details go in docs/changes/unreleased.md.

### P1. The view slot contract

What: `viewControl(state, lang)` in src/ui/panelView.ts describes the panel's view control as data (section 6.1). The page draws its view slot from it; the panel draws its own header from it. It still returns Meaning | Reading.

Users: nothing changes. No CHANGELOG line.

Tests: unit tests of `viewControl`. A web test: a press in the page's slot changes the panel, and the choice is kept after a reload.

Risks: the chrome series edits web/panel-bridge.ts at the same time. Keep the PR small, and land it before chrome-8's PRs touch the slot.

### P2. Explanation fixes found by the prototype

What: the wording fixes of round 11 in today's views. `if` starts the condition; `;` before a reserved word ends the commands before it; `[[ $x == 1 ]]` with no wildcard is a plain comparison, said once on `==`; `[[`, `]]` and each operand of `[[ ]]` get rows in Reading; tar's operands by mode (files to archive, members); "the last command run" in the Japanese AND/OR text. The test operators' operand kinds go in src/dict/syntax.ts, read by src/explain/tests.ts and src/reading.ts.

CHANGELOG (Fixed): "The explanations of `if`, of `;` before a reserved word, of `==` with no wildcard in `[[ ]]`, and of tar's file operands say what bash and tar do."

Tests: test/reading.test.ts and test/lists.test.ts against bash (`[[ $x == 1* ]]`, `-eq` with arithmetic); tar's operands with GNU tar (`tar -tf` lists what `-c` was given).

Risks: small. The snapshot shows every changed text.

### P3. Problems with a headline and a fix to copy

What: each warning and caveat gets a headline: one sentence in the catalog entry (or the style check), else the first clause of its text. Facts whose fix is mechanical carry `Rewrite` data (oracles.md 3.2): `failure-reported-as-success`, `source-searches-path`, `pattern-from-variable`, `unmatched-glob-runs-once` first. The note's text renders its fix from the same data, so the two cannot disagree. VS Code and the Language Server offer each rewrite as a quick fix (src/fixes.ts). A note names a long command (`tar`) rather than cutting it. The no-shebang case of `failure-reported-as-success`, if kept (open question 5).

CHANGELOG (New): "Quick fixes for a failure reported as success, `source` that searches `$PATH`, and a `grep` pattern from a variable."

Tests: oracles.md steps B2 and B3 for these ids, and B4 for the style checks among them. Each rewrite runs in bash: the hazard is gone (the caller sees the failure; `./lib.sh` is read; `-F` matches `a.b` only as written, with GNU grep), the meaning is kept, `bash -n` passes, and explaining the rewrite raises no note of the same id. A test that the headline adds to the text and never replaces it.

Risks: the level of two of these notes is open (open question 1); this step does not depend on it.

### P4. What the program receives, as data

What: src/argvline.ts rebuilt. For each simple command: the words its program receives after expansions, quote removal, splitting and globbing (from `wordFields` and `wordMeaning`), placeholders for values known only at run time ("‹current user name›", "‹each name matching *.log›"), and what bash took out (assignments, redirections with their effect). Data on the explanation, not yet drawn.

Users: nothing yet. No CHANGELOG line, unless the test finds bugs (each then a Fixed line).

Tests: this is oracles.md step 2 (A1): argv capture over sample.sh and the fixtures, with a stub program that prints its argv, in a sandbox (cgroup, `FUNCNEST`, a process group killed on timeout). Known differences in test/fixtures/argv-known.json, each with a reason.

Risks: the capture finds old bugs in the word model. Fix them in their own PRs before this one lands.

### P5. "In short" on every line

What: one sentence for each line with code, at the top of today's Meaning view. A composition from the tree (a list, a pipeline, a loop, a condition), the commands' summaries and their options, and the facts of the models (the status, what `set -e` does, the value an assignment gives, from P4's placeholders). The shapes with a sentence of their own (the "most frequent lines" pipeline, `cmd || echo msg >&2`) become idioms in src/idioms.ts with a summary, not name checks. A closing word (`done`, `fi`, `}`) says what it ends and what that construct does.

CHANGELOG (New): "The panel starts with one sentence that says what the line does."

Tests: every line of sample.sh and the fixtures gets a sentence, in both languages. The values in it are checked with bash (an assignment's value printed with a fixed `HOME` and a stub `date`). A sentence never retypes the line, and never says what a row below says alone (round 11's rule).

Risks: a generic sentence can be flat ("Runs `a`, then `b`"). The usability test judges it; idioms add better ones later.

### P6. Examples of the whole line and of globs

What: the pipeline example runs with example values of variables the script does not set (`$USER` is `alice`, said in its note), from `wellKnownVariables`. When grep reads such a value as a regex, a sample line shows it matching inside a longer word. The glob example adds "Not matching, and why" (a leading dot with `dotglob` off, `*` does not cross `/`, a different ending).

CHANGELOG (Changed): "The example of a pipeline runs with an example value of `$USER` and the like. The names a glob example tries say why each one does not match."

Tests: the reasons against bash's globbing in a temporary directory (with `dotglob` and `globstar` on and off: the name matches once the reason is lifted). The grep lines with GNU grep, in test/examples-*.test.ts.

Risks: an example value could be read as the real one. The note says it is an example.

### P7. One view, depth 1

What: the row model, `src/ui/panelRows.ts` (a pure function of the explanation, the depth and the switch). It builds the rows, the text of each depth, the boxes, the role ids, the marks and the Key entries. It takes the place of the prototype's logic in media/panel.js. Then the Meaning tab becomes depth 1 of the new view: "In short", the box "Problems on this line" (each item with its level's icon and label, a headline, "more" with the whole text and the fix to copy), the folded whole-line example, the grid, a box per command, chips that link each row to its problem and back, and "↑ Caveat on line N" on the lines inside a construct. Reading stays as the second tab.

CHANGELOG (Changed): "The Meaning view starts with the line's problems, each with a fix to copy, and shows each command in a box."

Tests: unit tests of the row model: a word says the same on every line of its statement; a fact is said once per panel; ja and en rows have the same role ids; "more" equals the Problems text for every problem of the corpus; no text of the panel's own says "risk" (a note's heading may). test/web-depth-stability.test.ts (from the prototype), and the two failing web tests fixed. Layout tests: the names box clips nothing, no chip breaks, at three widths and in both languages.

Risks: the biggest PR. Split the row model (with its tests, drawn by nothing) from the drawing if the review asks for it. The problems of the lines around need the explanations of other lines: cache them per document version.

### P8. Depth 2, and the tabs go

What: Reading becomes depth 2 of the same view. Each row gets one role line, at one position ("argument → value of -f · tar reads it §3.7.1"). A word that expands gets bash's steps in bash's order, arithmetic expansion named; the steps fold to one line where none acts. Each `|` is a connector row; reserved words and operators are rows. The tabs go: the depth control takes the view slot (P1's `viewControl` now returns the depths), in the page and in VS Code's panel header. Keys 1 and 2. A stored view "tree" opens at depth 2.

CHANGELOG (Changed): "The panel has one view with a depth: 1 What it does, 2 How bash reads it. Before, it had two tabs, Meaning and Reading, with eight steps." README's "The panel" is rewritten in the same PR.

Tests: depth 2 adds to depth 1 and moves nothing; every reserved word and operator has a row at depth 2; the word steps against the word probes (test/fixtures/probes/words.json); test/reading-manual.test.ts still passes; the VS Code integration tests. Web tests of the slot at 390, 640 and 1280 px.

Risks: users of Reading's eight steps lose them. The changelog says so. test/web-tree-steps.test.ts and the tests of the steps go, each replaced by a test of what took its place.

### P9. "What the program receives"

What: the switch, on by default, remembered once chosen (key W). Under each command, the words its program receives as chips (P4); a word received as written is tinted. The mark "handled by bash" by one rule: on the top row of each part that no program receives (not in any argv of P4, not a command name), at both depths, only with the switch on. The mark "not in POSIX sh" where the dialect tables say the construct fails in POSIX sh (`FEATURES`, `featureWorks(id, 'sh')` in src/dialect.ts), on the construct only. The Key lists the marks on screen, inline in the panel.

CHANGELOG (New): "A switch shows what each program receives: its words after bash's expansions, and the parts bash handles itself. A mark shows what POSIX sh lacks."

Tests: the rule of the mark against P4's argv data, over the corpus; the dialect mark runs the construct in dash and in `bash --posix` (it fails there where we mark it); chips whole at three widths; the Key's entries equal the marks drawn.

Risks: two marks on one row read as noise. The usability test checks it.

### P10. Clean-up and speed

What: remove what nothing uses any more: Reading's eight-step machinery (`layers`, `PanelState.view` and `step`), the page's stepper, the reading tree's fields no row reads. Measure a cursor move on a 2,000-line script, before and after: the extra lines explained for a statement stay under a budget (proposed: 50 ms at the 95th percentile on CI's machine). docs/design/tree-view/README.md gets status "Replaced by panel-redesign.md". README images re-recorded.

Users: a faster panel on long scripts, if the measure shows it. Else no CHANGELOG line.

Tests: test/file-length.test.ts; no dead export (coverage).

### 6.1 The view slot contract

The web page's chrome is redesigned in parallel (branches `proto/chrome-7` and `proto/chrome-8`). There, the panel header has a fixed-width "view slot": 160, 136 or 104 px by the panel's width, segments from 430 px, a menu below; on a phone, a 44 px control in the tabs row. The two series meet only here:

- **The panel owns the view state.** `PanelState` holds it (`depth`, `receives`; today `view`, `step`). The panel applies it. VS Code keeps it in the webview's state; the page keeps it in storage (`STORAGE_KEYS.panel`). Both send it with the existing `panelState` messages, in both directions.
- **The control is data.** `viewControl(state, lang)` gives the label, and each option's id, short name, full name and pressed state, and optional steps (Reading's eight, until P8). The page draws the slot from it, as segments or as a menu; the VS Code panel draws its own header from it. A press sets the state and sends it. The page never knows what the options mean.
- **The fit is chrome's; the words are the panel's.** Each short name fits its segment at the slot's widths, in both languages and with the CJK fonts (a web test, from P1 on). The full name is the tooltip and the accessible name. The switch "What the program receives" and the Key stay in the panel's own row, under the line box, not in the slot.

The panel handles keys 1, 2 and W when the focus is in it. The page binds none of them.

## 7. The usability test

After P10, as roadmap item 9.

- **Users:** five fresh agents with no project context: a beginner, a certification learner (LPIC/LinuC), a sysadmin, a developer and a UX designer, as in the survey of October 2026.
- **Build:** the web page built from main (`npm run build:web -- --channel=next`), served locally. Each user drives the running page in a browser: moves the cursor, changes depth, flips the switch, opens examples, copies a fix. No screenshots handed to them.
- **Scripts:** the four of the survey (the loop over `*.txt`, the grep pipeline, the backup with `tar`, the `if [[ ]]` with `source`), and one script none of the rounds used.
- **Tasks**, the same for everyone, each with an answer key:
  1. Say what line N does, in one sentence.
  2. Find the problem on line N, and copy its fix.
  3. Say which words `grep` receives, and which part bash handles itself.
  4. Say what bash does to `"$USER"` before grep runs.
  5. Say which file names the glob matches, and why one does not.
  6. Say whether the script runs in POSIX sh, and what would fail.
- **Scoring:** each user gives an overall score out of 10, with the three things that cost the most. Task answers are checked against the key and reported beside the scores.
- **Goal:** an average of 9/10 or more. Below it, the findings become explanation bugs or panel PRs, and the test runs again with new agents. After two runs below 9, the maintainer decides.

## 8. Open questions for the maintainer

1. **Levels of two caveats.** Should `failure-reported-as-success` and `source-searches-path` be warnings (⚠ Pitfall) instead of info (ⓘ Caveat)? By the rule in src/messages.ts (`info`: "a failure goes unnoticed", or the damage is limited or only on some systems), both are info today. The sysadmin persona asked for a warning in every round. No step depends on the answer: the panel shows each problem's own level.
2. **Order.** The roadmap puts P2 to P10 after items 1 to 7, and the test last. P1 should land now, with the chrome series. Should P2 to P10 go earlier?
3. **Short names in the view slot.** "1 What it does" and "2 How bash reads it" do not fit 160 px. Proposed: "What it does" / "How bash reads it" in segments when they fit, "1 Does" / "2 Reads" (「1 何をする」/「2 読まれ方」) otherwise, the full names in the tooltip.
4. **Copy as Markdown and the hover.** Should they follow the depth, or stay as today's list of parts?
5. **No shebang.** Round 8 added a case of `failure-reported-as-success` for a file with no shebang ("if this file is run as a script…"). A sourced library would get it on its last line. Keep it?
