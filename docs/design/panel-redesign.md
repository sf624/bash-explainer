# Panel redesign: one view with a depth

The plan that turns prototype B into real PRs, then the usability test. Agreed with the maintainer on 2026-10-27; revised after an independent review of the plan (PR #418).

Status: P1 done (#538), with SB2 of [sources.md](sources.md). P2 done (#543), started early (decided by the maintainer 2026-10-31), beside the three note levels. P3 done (#560), after the levels. P4 done (#563): what each program receives, as data. P5 done (#566): "In short" on every line. P6 done: examples of the whole line and of globs. SB3 comes before P7a.

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
5. **Order.** P1 to P10 start after the roadmap's three note levels are done (changed 2026-10-31, from "items 1 to 7"). Changed again 2026-10-31: P1 and P2 start early, beside the three note levels; P3 onwards waits for them. Studies that can run in parallel may (a measure, a sketch, a prototype that lands nothing).
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
| `failure-reported-as-success`: the no-shebang case | Keep, fix | Kept (decision 8). Landed with oracles.md step 4 (#453): its fix ends with `return 1 2>/dev/null \|\| exit 1`, which returns when the file is sourced and exits when it is run. |
| `globMissReason` (src/examples/shellwords.ts) | Rewrite, done (P6) | Its reasons read the pattern's text (the text after the last wildcard) and named one reason only. Rebuilt as `globMiss`: each reason is lifted through the glob matcher (`globMatches`), and checked against bash's globbing. |
| Pipeline example values (`SAMPLE_VALUES` in src/explain/examples.ts) | Dropped (P6) | The example layer had the values already: `ENVIRONMENT`, the made-up system's environment that `env`'s made-up output prints (src/examples/layouts.ts). The plan's value field on `wellKnownVariables` would have been a second source. |
| "Options only" in src/explain/examples.ts (the regex `/^-[hFEns]+$/`) | Rewrite, done (P6) | Whether grep reads a word as a regex comes from the spec (`regexWords` in src/argv/query.ts: `lang: 'regex'`, `OptionSpec.whole`, `selects`), shared with the caveat `pattern-from-variable`. |
| src/examples/pipeline.ts, src/examples/rerun.ts, src/explain/context.ts (glob examples kept beside the whole-pipeline example) | Kept, done (P6) | A stated rule of CLAUDE.md ("Explanations"), with a test. |
| `trustedFields` (src/semantics/words.ts) | Dropped (P4) | P4 did not need it: what a program receives reads the values of `wordFields`, which the argv capture checks, not only those the trust allows. It never reached main. |
| src/argvline.ts | Rewrite, done (P4, #563) | The idea is right. Its texts are in the catalog (src/messages-argv.ts). It reads the word model only: `wordFields`, and `receivedWords` (src/semantics/fieldshape.ts) for the words with a value known only at run time; it needs no argument interpreter, since roles are not what the program receives. Argv capture in bash checks it (test/argv.test.ts). |
| src/linesummary.ts | Rewrite, done (P5, #566) | It compares names (grep, sort, uniq, tar, echo, wc) and has seven shapes. It keeps its own copy of the test operators (`S.tests`) and calls `pitfallFindings`. Every line needs a sentence: a composition from the specs and the models, and the known shapes as idioms (P5). Rebuilt as src/linesentence.ts; none of its code was kept. |
| src/reading.ts additions (`from`, `steps`, `argv`, `cond`, `summary`, `code`) | Keep the fields, move the texts | Its inline tables `TEXTS` and `OPERANDS` repeat `unaryTestOps` and `binaryTestOps` of src/dict/syntax.ts. One table, used by both (P2, P8). The sentence of the line is not kept here (P5). |
| src/analyzer.ts helpers `variableFrom` | Dropped (P5) | P5 did not need it: the sentence says a variable's value as P4's data does (`argvWords`, src/argvline.ts). It never reached main. |
| src/analyzer.ts helpers `wordExpands`, `wordTildes` | Move | They serve depth 2: to the module of words (P8). |
| src/analyzer.ts `otherLines` | Move | It explains up to 100 more lines, lean, on each request. It moves to src/document.ts, beside the lean explanation of every line that `noteIssues` already makes and caches per tree (`noteIssueCache`). The panel reads the other lines from that cache (P7). |
| src/ui/panel.ts: `service.explain(doc, line, true)` | Rewrite | The prototype builds the reading tree on every request. src/ui decides what to compute from the state; measured (P7, P8). |
| `HEADS` in src/messages.ts, `fixLine` in src/pitfalls.ts | Rewrite | The fix as `Rewrite` data (docs/design/oracles.md, 3.2), not as a string of the whole line (P3, done: the quick fixes read it). A headline per catalog entry and per style check, required by the type (P7b). |
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

What: `viewControl(state, lang)` in src/ui/panelView.ts describes the panel's view control as data (section 6.1). The page draws its view switch from it (today's switch in the top bar; the view slot from C7 of the chrome plan on); the panel draws its own header from it. It still returns Meaning | Reading.

Users: nothing changes. No CHANGELOG line.

Tests: unit tests of `viewControl`. A web test: a press in the page's view switch changes the panel, and the choice is kept after a reload.

Prerequisite (2026-10-31, [sources.md](sources.md), SB2, done in P1's own PR): the Reading step model (`BASH_STEP`, `ownStep`, `measureSteps`, `chipOf`, `readerOf`, `bandOf`, `ROLES`) moves from media/panel.js into a typed, pure module of src/ui, with its unit tests. One `needsReading(state)` replaces the two decisions of `view === 'tree'` (src/ui/panel.ts, web/main.ts; section 6.1). The page's mirror of the panel's header is driven by data, not by a MutationObserver (web/panel-bridge.ts).

Risks: the chrome series edits web/panel-bridge.ts too. P1 starts after the three note levels, like the other steps (decision 5; changed 2026-10-31: P1 and P2 start early, beside the levels). It lands before C7 of [chrome-redesign.md](chrome-redesign.md), which draws the slot from `viewControl`. Keep the PR small.

Done (#538):

- src/ui/panelView.ts: `viewControl(state, lang)` (label; per option its id, an optional icon, short and full name, pressed, the state a press `sets`, and Reading's step names), `needsReading(state)`, and `panelState(kept)`, which reads a kept state (the view; the step, or the layers kept before the steps; `level` written back for an older version). Both hosts read and keep the state through it, and ask `needsReading` what to build.
- src/ui/readingSteps.ts: the step model of media/panel.js (`BASH_STEP`, `ownStep`, `measureSteps`, `aboutKey`, `chipOf`, `readerOf`, `bandOf`, `ROLES`, and the band rule and the arrows' targets), typed and pure, with its unit tests (test/reading-steps.test.ts). `readingView` gives each node of the reading tree its step, chip, reader, band, general text and role, and each step its words and where the arrows go. Over the fixtures and the snippets (5,374 lines, 60,550 nodes, both languages, all eight steps) it gives what main's panel.js computed.
- The update message carries `control` and `reading` (the explanation goes without its tree); media/panel.js draws them, and its view switch from `control`. From chrome C1b (#548) it also carries the line box's `lineParts` and `wrap` (src/ui/lineBox.ts).
- The panel applies a press of its own at once, with no answer from the host: an option is pressed when the state has what it `sets`. `pressed` in the data is for the hosts, which draw from the state they keep (the page's switch, in the top bar and the menu).
- The page's fold and quick reference buttons are drawn from a `header` message, in which the panel says how it draws its own (`HeaderButton`), instead of a MutationObserver on the panel's DOM.
- The full names equal the short ones until P8 (no new tooltip). test/web-tree.test.ts already checks a press in the page's switch and the choice kept after a reload; test/panel-header.test.ts checks the `header` messages.

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

Done (#543):

- Pattern or plain comes from the word model: `plainPatternText(n, model)` (src/semantics/globwords.ts, from `braceWords` of the word model: src/semantics/words.ts is at its length ceiling) gives the text a pattern of `[[ == ]]` or of `case` matches where nothing in it acts as a wildcard once expanded with the values of the model (`plainPattern` of src/semantics/chars.ts) (a quoted `*` does not; `p=1; [[ $x == $p ]]` is plain), and nocasematch is off. src/explain/tests.ts and src/reading.ts (through `ReadingContext.plainPattern`) read it; test/words.test.ts checks it with bash, nocasematch and `[a/b]` included.
- The operand kinds are `unaryTestOperands` and `binaryTestOperands` in src/dict/syntax.ts, with their texts `testOperandTexts`; src/reading.ts reads them for the operands' rows, and src/explain/tests.ts for `-eq` and its kin (`numericTestNote`, whose regex left the command-reading guard's list).
- On main, `[[`, `]]` and the operands already were rows of Reading, with no text of their own (a general text of their kind showed once). P2 gives each its text.
- The text of `HOME` had changed on main since round 11 ("where `cd` with no argument goes, and the value of `~`"); only the Japanese 「のパス」 went, so that both languages name the home directory alike.
- tar's operands: `-A` (archives whose members are appended) has a kind too, which round 11 left out. test/oldstyle-real.test.ts checks each mode with GNU tar.
- Left for later: `quotedPatternNote` (src/explain/tests.ts) still reads quoting from node types (word-source.md, W-P3: `[[ $x == ${q:-"*"} ]]`); the operands of `[ ]` and `test` are a command's arguments, read by their spec, and get no operand text.

### P3. Fixes to copy, as data

What: facts whose fix is mechanical carry `Rewrite` data (oracles.md 3.2): `failure-reported-as-success`, `source-searches-path`, `pattern-from-variable` and `unmatched-glob-runs-once` first. The data and its tests are oracles.md steps 4 to 6 (B2, B3, B4), part of the roadmap's run-based oracles, done before this series (decision 5). `source-searches-path` and `pattern-from-variable` are style checks (`StyleCode` in src/pitfalls.ts), so they need B4. P3 does those steps for these four ids if the run-based oracles have not. The note's text renders its fix from the same data, so the two cannot disagree. VS Code, the Language Server and the web page's editor (web/editor.ts, CodeMirror's lint actions) offer each rewrite as a quick fix (src/fixes.ts).

Two fixes need care:

- **A file that may be sourced.** `exit 1` there ends the caller's shell. The fix ends only the file: `return` where the file may be sourced, `exit` where it is run. Done in the rewrite data (oracles.md 3.2, #453).
- **`source lib.sh`.** `./lib.sh` still depends on the current directory, which the note warns about (cron starts in `$HOME`). The fix names the script's own directory (`"$(dirname "$0")/lib.sh"`, or a form that holds when the file is itself sourced), or there is no quick fix. B3 decides. Decided in P3 (B4 had left both advice checks without rewrites): first `"$(dirname "${BASH_SOURCE[0]}")"/lib.sh`, which holds when the file is sourced; `./lib.sh` second, as an alternative that reads what the search would find after `$PATH`.

CHANGELOG (New): "Quick fixes for a failure reported as success, `source` that searches `$PATH`, a `grep` pattern from a variable, and a loop over a glob that matches nothing."

Tests: oracles.md B2 to B4 for these ids. Each rewrite runs in bash, both when the file is run and when it is sourced: the hazard is gone (the caller sees the failure; the library is read from the script's directory; `-F` matches `a.b` only as written, with GNU grep), the meaning is kept, the caller's shell goes on, `bash -n` passes, and explaining the rewrite raises no note of the same id.

Risks: two of these notes change level with the three levels (decision 4); this step does not depend on it.

Done (#560):

- Every rewrite with edits is a quick fix, not only those of the four ids: the 17 mechanical ids of the catalog and the 11 style checks that carry rewrites. One rule, with no list of ids: a note's place (`NoteAnchor`, src/noteanchors.ts) carries the rewrites the note suggests there (`Fact.rewrite`, `StyleFinding.rewrite`), and `noteIssues` (src/document.ts) turns them into the problem's `fixes` (`rewriteFix` in src/fixes.ts: the edits at their positions, titled with the code the note shows). So a fact on two places gives each problem the fix of its own place. `DocumentIssue.fix` became `fixes`, a list; the first is the one the note recommends (VS Code's and the Language Server's `isPreferred`). The hosts' files carry none (src/hosts/remap.ts), as their facts carry none.
- `source-searches-path`: in bash `"$(dirname "${BASH_SOURCE[0]}")"/lib.sh`, then `./lib.sh`; in sh `"$(dirname "$0")"/lib.sh` only where the file is run (`readAs`: a shebang), else `./lib.sh` alone; typed into a terminal, `./lib.sh` alone. The walls of the corpus runs refuse `source`, so its states run in test/rewrites-advice.test.ts (`IdStates.apart`): a file of the name in `$PATH`, one in the current directory, one beside the script in a directory whose name has a space; run, run by its path, sourced, sourced in a function; bash in POSIX mode; dash.
- `pattern-from-variable`: `grep -F`, in place of an option or a name that selects another mode (GNU grep refuses two: "conflicting matchers specified"); none where a word before the pattern has a value that is not known, nor where grep has other patterns (another word in a pattern's language, or an option that gives the patterns in place of the first operand, `fills`: `-f pats`), which `-F` would read as fixed strings too; the note then says so (`otherPatterns`). Its states run over the corpus with GNU grep on the runs' PATH (it writes no file): the rewrite with `a.b` or `x*` gives what the original gives with the value escaped.
- The note's text renders the code of both from the rewrites. The note on `source lib.sh` suggested `"$(dirname "$0")/lib.sh"` in bash, which names the caller's directory when the file is sourced.
- The web page's tooltip has a button per fix; on a narrow pane the box scrolls to the last one (test/web-quickfix.test.ts, screenshots in English and Japanese at 390 and 1280 px).
- A fix's title is marked text (`Fix.title`, the code as a `codeSpan`); every host gets it from `fixTitle` (src/document.ts), next to `plain`: VS Code and the Language Server keep the backticks, as in their messages; the web page's buttons, which CodeMirror draws as text (`Action.name`, no render hook in @codemirror/lint 6.9), show each code span's code alone. The dialect fixes' titles (`fixFor`) too.

### P4. What the program receives, as data

P4a. Oracles.md step 2 (A1), done (#432; oracles.md 2.6). The run-based oracles did it before this series (decision 5); if it has not, it lands here as its own PR first: argv capture over sample.sh and the fixtures, with a stub program that prints its argv, in a sandbox (cgroup, `FUNCNEST`, a process group killed on timeout). It is a pure test of `wordFields`. Known differences in test/fixtures/argv-known.json, each with a reason. The bugs it finds are fixed in their own PRs, each with a Fixed line.

P4b. src/argvline.ts rebuilt on top. For each simple command: the words its program receives after expansions, quote removal, splitting and globbing (from `wordFields` and `wordMeaning`), placeholders for values known only at run time ("‹current user name›", "‹each name matching *.log›"), and what bash took out (assignments, redirections with their effect). Data on the explanation, not yet drawn.

Users: nothing yet. No CHANGELOG line of its own.

Tests: P4b's data against the capture of P4a, over the same corpus.

Risks: the capture finds old bugs in the word model. They land before P4b.

Done (#563). Where the plan did not fit the code, the plan was changed, as below.

- **The data.** `LineExplanation.argv`, when `ExplainOptions.argv` asks for it (P9's `explainNeeds` will): an `ArgvLine` for each simple command with a name on the line, those in a substitution too, in source order (src/argvline.ts; the types in src/analyzer-types.ts). Its `words`, the name's first, are `ArgvWord`s: the word of the script they come from (`from`), their parts (text, or a placeholder: what it stands for, its code, its label, and `splits` where word splitting by IFS may cut it; not the elements of `"$@"`), a `count` where it is not exactly one word (`{ min: 0, max: 0 }` for a word that gives none; no `max`: any number), and `asWritten` where the program receives the word as it is written (P9 tints it). `removed` lists what bash takes out, in source order: each prefix assignment (what it does, from `assignmentsOf`: for the command only, or it stays; its value's word) and each redirection (what it does, from the dictionary's `redirects`, with the target expanded where it is known; its target's words, or a here-string's). `fails` says where bash fails on a word (`${x:?}`, failglob, an ambiguous redirection; also in an assignment's value, a here-string or a here-document, in the order bash expands them), so that the program does not run. Hosts map the places to the file (src/hosts/remap.ts). Nothing is drawn yet.
- **Where it comes from.** src/argvline.ts reads each word through one entry point of the word layer, `receivedFields` (src/semantics/fieldshape.ts). A word's fields are `wordFields`'s where it knows them (no environment: the script's own values). Otherwise `receivedWords` evaluates the word with the same values, a hole for each part it does not know (`holedWords`), splits it at the separators it knows (`atomsOf`, `splitOn`), and says for each field its parts, its count, and its pattern where its own characters make it one. It has the bail-outs of `wordShapes` (`misread`, a word that may assign IFS, an unquoted `$!`, braces not known), and is for bash only: in another shell, and wherever it gives up, the word is one placeholder, "the words of `…`", any number. The plan named the argument interpreter as a source: what the program receives needs none (the roles are depth 2's).
- **Placeholders** (src/messages-argv.ts, ja and en): a parameter by what it is where that has a short name (`$USER`, "current user name"; `$?`; `$1`, "argument 1"; `"$@"`, "each argument"; `"${a[@]}"`, "each element of `a`"; where the word is one field, an assignment's value or a here-string, "the arguments joined" and "the elements of `a` joined"), else "value of `$x`" or, with an operator, "what `${x:-d}` gives"; "output of `$(…)`", "result of `$((…))`", "file name of `<(…)`", "home directory" (of `bob`), "translation of `$"…"`"; and for a pattern, "each file name matching `*.log`", the whole word as written where it is the only field (`"$d"/*.log`).
- **An assignment given to a declaration builtin** (`local x=$1`): the word model gives it as one word (`declaredWord` in src/semantics/wordcontexts.ts, read by `wordFields` and `receivedWords`): the name and `=` as written, then the value's own fields (`assignment-value`: not split nor globbed). Bash brace-expands the whole word first, and where braces change it, each word they give is an argument like any other: `local x={a,b}$z` with `z='p  q'` gives `x=ap`, `q`, `x=bp`, `q` (split, globbed, a tilde only at its start: `export X=~{a,b}` gives `X=~b`). Behind `command` it is an argument, split.
- **Tests.** test/argvline.test.ts: the shape, each placeholder in both languages, what bash takes out, a host file. test/argv.test.ts: on the capture's runs (the fixtures and the sample of the snippets, both environments), every word given as text is bash's and every placeholder covers what bash put there (test/support/argvline.ts; the known differences of argv-known.json apply, and the counts are pinned there under `lines`). scripts/argv-corpus.ts runs it over all the snippets and 200 fuzz inputs: no difference.
- **`trustedFields`** was not needed (section 4).

### P5. "In short" on every line

What: one sentence for each line with code, at the top of today's Meaning view. A composition from the tree (a list, a pipeline, a loop, a condition), the commands' summaries and their options, and the facts of the models (the status, what `set -e` does, the value an assignment gives, from P4's placeholders). The shapes with a sentence of their own (the "most frequent lines" pipeline, `cmd || echo msg >&2`) become idioms in src/idioms.ts, the agreed home for shapes that compare names. A closing word (`done`, `fi`, `}`) says what it ends and what that construct does.

Where it lives: a field of `LineExplanation`, not of the reading tree as in the prototype. Today's `LineExplanation.summary` (the commands' labels joined; read by tests and the bats host, shown by no view since #318) stays. Both are made from the same command summaries, so neither restates a fact the other owns.

Rules:

- It never states a fact that a problem of the line states. The problem says it once, in the box.
- It never retypes the line: no code span in it holds more than one shell word of the line.

CHANGELOG (New): "The panel starts with one sentence that says what the line does."

Tests: every line of sample.sh and the fixtures gets a sentence, in both languages. The values in it are checked with bash (an assignment's value printed with a fixed `HOME` and a stub `date`). The two rules above, over the corpus. A sentence never says what a row below says alone (round 11's rule).

Risks: a generic sentence can be flat ("Runs `a`, then `b`"). The usability test judges it; idioms add better ones later.

Done (#566). Where the plan did not fit the code, the plan was changed, as below.

- **The data.** `LineExplanation.sentence`, marked text, when `ExplainOptions.sentence` asks for it (the panel's hosts do: src/ui/panel.ts, web/main.ts). A string read as a script has none. The panel draws it at the top of the Meaning view, above the problems, with the label "In short" / 「ひとことで」 (`#short`, media/panel.js); the Reading view has none.
- **Where it is made.** src/linesentence.ts, after the line's notes, so that it knows the line's problems. It walks the line's statements as the explanation does (`isBlockLike`, `intersects`): a statement on the line (or one over several lines that the line is part of), the head of a block that goes on below, the word that closes a block (with the redirections after it), or a word alone on its line that goes on with a block (`then`, `do`, `{`). A closing word says what it ends and repeats what its head says ("`done` ends the `while` loop of line 28: reads `input.txt` one line at a time…").
- **Its data.** What each simple command is: `CommandSaid` (src/explain/commands.ts), recorded where the command's token is made, with the same summary (the spec's, or the deepest subcommand's) and the options given (the option tokens' texts); `Token.summary` is made from the same record. The words: `argvWords` (src/argvline.ts), P4's reading of a word, for an assignment's value (a declaration builtin's from the word it receives), a redirection's target, a here-string, a loop's words and a `case` word, with P4's placeholders. A variable whose attributes change what bash stores (`CHANGING` of src/semantics/walk/temporaries.ts: `-i`, `-l`, `-u`, a nameref, an array), and a declaration with options, get "what `1+1` gives" instead of the text. The status model: a pipeline's status (pipefail on, off; none where it is not known), and `set -e` where it does other than stop the script: an AND or OR list (a command before the last does not stop it), a statement whose failure stops a subshell or a shell not known. Where `set -e` stops the script, as it does on every line under `set -e`, the sentence says nothing: said on every line, it was noise. The redirections are said short (stdin from, stdout to, appended to, to where stderr goes), read with `redirectParts`; any other is the dictionary's text.
- **Pipelines and background jobs** (review of #566). A pipeline over several lines (`cat f | while read l; do`) is said whole on its first line: each stage named (a compound one by its kind, "a `while` loop (lines 1–3)", never by its first token), what each compound stage does and where it runs, from the environment model (`ownSubshells`: a pipeline stage's subshell; the shell itself with `lastpipe`), and the pipeline's facts. The word that closes a stage says the stages it pipes into (`done | sort`). A statement started with `&` is said in the background as a whole ("In the background, …"), read from the status model (`status(n).kind === 'background'`). Whether a statement can fail, for the `set -e` clause, is the status model's `mayFail`. The redirections are said by the kind the dictionary gives each operator (`RedirectOp.kind`, src/dict/syntax.ts) and, for `>&` and `<&`, by `dupTarget` (copy, close, move). `for x in $e` with `e` empty, or `for x in;`, says the body does not run.
- **Idioms** (src/idioms.ts, `idiomSaid`, texts in src/messages-sentence.ts): strict mode, an EXIT trap, a quiet check that a command is installed, `while read … done < file`, an endless loop, `sort | uniq -c | sort -rn [| head]` (the most frequent lines, with how many it keeps), and `echo`/`printf` with `>&2` (a message on stderr). The first five reuse the shapes of the idiom notes.
- **The rules.** A clause about the models carries the sections of the manual it is about (`3.2.3` for a pipeline's status, `4.3.1` for `set -e`); it is left out when a problem of the line cites one of them (`problemSections`: a fact's `refs`, a style check's `STYLE_REFS`). A host's own problems count too (`ExplainOptions.hostProblems`, from src/hosts/remap.ts: a Dockerfile's pipeline without pipefail). Follow-up (with SB3, before P7a): once `Token.facts` holds fact ids, `problemSections` compares fact ids, not sections: a section is coarse, and a problem about one fact of `3.2.3` drops a clause about another. No code span holds more than one shell word of the line: commands are named by their names (`git` `log`), words by what they give, a test as `[ … ]` and `[[ … ]]`. A long sentence drops the options, then what each command does (180 characters in English, 110 in Japanese, not counting the facts).
- **A bats test** says "Defines a bats test (lines 9–13), whose body bats runs in a process of its own" (src/hosts/bats.ts), not the function bats makes of it.
- **Tests.** test/linesentence.test.ts: 172 shapes in both languages, and every snippet and every line cut while typed without failing (a bare `coproc` made the status model fail: fixed); over sample.sh and the fixtures, every line with code has a sentence in both languages, none says `set -e` or a pipeline's status where a problem of the line cites its section, no code span is a stretch of more than one word of the line (the line's words and tokens from the tree), none is a row's text, and the Japanese has a space between code and Japanese; the values of the assignments against bash, on the argv capture's runs (each assignment followed by `: MARK "${x}"`; `HOME` is the run's directory, and `date`, as every command, a recorder that prints nothing). test/web-sentence.test.ts: the web page's panel, at 390 and 1280 px, in both languages, with each code span drawn as one `code` element (also one that holds backticks, `` `date` ``: the panel reads code spans as CommonMark does). test/status.test.ts: `mayFail` against bash.

### P6. Examples of the whole line and of globs

What: the pipeline example runs with example values of variables the script does not set (`$USER` is `alice`, said in its note). The values come from `wellKnownVariables` (src/dict/syntax.ts). They stay in the example layer and never reach `wordFields` or `wordValue`. `wellKnownVariables` is a `Record<string, Text>` today; a value per name changes its shape, which touches src/ui/reference.ts, src/explain/words.ts and src/explain/scripts.ts. A name the table lacks (`LOGNAME`) gets a row first. When grep reads such a value as a regex (from the spec: `lang: 'regex'`, `OptionSpec.whole`), a sample line shows it matching inside a longer word. The glob example adds "Not matching, and why" (a leading dot with `dotglob` off, `*` does not cross `/`, a different ending). Glob examples shown beside the whole-pipeline example are a change of the example rule; CLAUDE.md is updated in the same PR.

CHANGELOG (Changed): "The example of a pipeline runs with an example value of `$USER` and the like. The names a glob example tries say why each one does not match."

Tests: the reasons against bash's globbing in a temporary directory (with `dotglob` and `globstar` on and off: the name matches once the reason is lifted). The grep lines with GNU grep, in test/examples-*.test.ts.

Risks: an example value could be read as the real one. The note says it is an example.

Done. Where the plan did not fit the code, the plan was changed, as below.

- **Where the values come from.** Not from `wellKnownVariables`: the example layer had a table of them, `ENVIRONMENT` in src/examples/layouts.ts, the environment the script's shell gets on the examples' made-up system, which `env`'s made-up output prints (`USER`, `LOGNAME`: `alice`; `HOME`: `/home/alice`; `SHELL`, `LANG`, `TERM`, `PATH`, `PWD`), read with `startValue` and `inheritedAt` as the `env` example does. A value field on `wellKnownVariables` would have been a second source of the same fact; `HOSTNAME`, which bash sets and does not export, has none.
- **Which words.** `pipelineStage` (src/explain/examples.ts) reads a word whose text is not known through the word layer's one reader of what a program receives, `receivedFields` (src/semantics/fieldshape.ts): fields the model knows run as they are (`x=foo; grep "$x" | sort`, which had no example before), and a field with holes gets, for each hole of a plain parameter (`writtenPlain`, shared with the placeholders of P4), the made-up value (`madeUpValue`): only where no command of the script sets the variable (`StateModel.assigned`), nothing the walk does not read ran before (`opaque`), the shell is bash started as a script or a terminal (`startedAs`; not in a slot shell), neither bash nor a builtin may change it unseen (`changedUnseen`: `RANDOM`, `PWD` after `cd`), and splitting by the IFS in effect and pathname expansion leave it whole. The values stay in the example (`Stage.words`); `wordFields`, `wordValue`, `Token.value` and `LineExplanation.argv` never see them.
- **The note.** `Example.note` of the pipeline's example: "Here `$USER` is `alice`: an example value (the real one is known only when the line runs)", each variable once; after a note it already has.
- **Inside a longer word.** Where grep reads such a value as a regex that matches inside longer text (`regexWords` in src/argv/query.ts, which the caveat `pattern-from-variable` now reads too: operands and values in `lang: 'regex'`, with no option given or implied that selects `fixed` or matches `whole` words or lines; `impliedOptions` in src/dict/aliases.ts for `fgrep`), the stage is `inside`, and grep's sample has the value inside a longer word (`malice`), which GNU grep keeps.
- **Why a name does not match.** `globMiss` (src/examples/shellwords.ts): the fewest reasons whose lifting makes the name match, each lifted through the same matcher, `globMatches` (no second matcher): `dot` (dotglob on), `globstar` (globstar on), `slash` (the value matcher of `[[ == ]]`, which also matches a leading dot, so it comes with `dot` where that applies), `end` and `start` (the pattern's literal text at its end or start, `literalEnds`, in place of as few characters of the name as can be). The sections, one for each reason (`missSections` in src/examples/rerun.ts), are in the static example and in the result of the names typed in the panel; a name `GLOBIGNORE` leaves out says so.
- **Glob examples beside the pipeline's.** `examplesReplaced` keeps the examples of kind `glob` of the stages, before the pipeline's; CLAUDE.md ("Explanations") states the rule.
- **Tests.** test/examples-shellwords.test.ts: every name of a tree that 14 globs do not match, with dotglob and globstar off and on: bash does not match it, and matches it once its reasons are lifted, each reason needed; the sections in both languages. test/examples-pipeline.test.ts: 13 lines run in bash with the made-up environment and GNU grep give the example's output, with `malice` exactly where grep reads the value as a regex; the note in both languages; ten lines with no example value; the argv data unchanged; the glob examples kept.
- Folded in from P5: a line number is spaced from the Japanese after it (「行 2 を実行する」, as 「行 1 から」), in `jaSpaced`, with a rule in docs/japanese-style.md and a check over the corpus.

### P7. One view, depth 1

Three PRs:

- **P7a. The row model.** `src/ui/panelRows.ts`: a pure function of the explanation, the depth and the switch. It builds the rows, the text of each depth, the boxes, the role ids, the marks and the Key entries. It takes over `chipOf`, `readerOf`, `bandOf` and `roleOf` of src/ui/readingSteps.ts (P1) rather than writing them again; `ROLES` goes to the one colour table per kind (sources.md, SC10). Data only, drawn by nothing yet, with its tests. It stays under the 1,000 lines of test/file-length.test.ts (split by part if it grows). The basis chips of the roadmap's basis of an explanation ("Not in the manual · checked with bash 5.2", "Try it") are row data here, as they land before P7 (section 8, decision 3).
- **P7b. The problems box, in today's Meaning.** Each warning and caveat gets a headline: one sentence in its catalog entry or style check, required by the type (as test/suggestions.test.ts requires a class), and per params where the text has cases. The box "Problems on this line": each item with its level's mark and word from the catalog, the headline, "more" with the whole text and the fix to copy (P3), and chips that link each row to its problem and back. A line inside a construct gets a pointer to the problem on the construct's line, with the level's word and the line number.
- **Prerequisites of P7a and P7b** (2026-10-31, [sources.md](sources.md), SB3): `Token.role` and `Token.facts` (fact ids); no string notes (`cx.note` with a plain string goes, and the `cmd 2>&1 >file` note of `simulateRedirects` becomes a catalog fact at Info, with the rewrite `>file 2>&1` and none where stdout goes to `/dev/null` before a pipe, as in `cmd 2>&1 >/dev/null | grep …`), so P7b has every warning typed; one row record per token, which all four renderers read (media/panel.js `item()`, src/ui/hoverView.ts, src/ui/render.ts `toPlainMarkdown`, cli/main.ts `textOutput`); the `ui` texts out of render.ts into a module of their own. The guard SA5 then ends with an empty known list.
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

From C7 (chrome-redesign.md): the options of `viewControl` take a `digit` ('1', '2'); then the view control (media/view-control.js) draws the label before the segments, each option's digit, and its name only when it is shown, and its menu says "Depth 1" (`viewControlForms`, src/ui/panelHead.ts). No host changes.

From P1 (review of #538): `PanelState` gains `depth` here. `panelState` must read it back: the round-trip test of test/reading-steps.test.ts fails until it does. The options of `viewControl` say what they `sets` (`{ depth: 2 }`), and `pressed` follows from the one rule of `isPressed` (src/ui/panelView.ts), which media/panel.js applies too; `PANEL_DEFAULTS` gets the default depth.

### P9. "What the program receives"

What: the switch, on by default, remembered once chosen (key W). Under each command, the words its program receives as chips (P4); a word received as written is tinted.

The mark "handled by bash", by one rule: once per construct that no program receives (not in any argv of P4, not a command name), on its first row, at both depths, only with the switch on. An `if … fi` gets one mark, not one on `if`, `then`, `;` and `fi`.

The mark "not in POSIX sh", on the construct only, where it uses a feature of `FEATURES` (src/dialect.ts). The table holds no feature of POSIX sh, so the mark says "not in POSIX sh", not "fails in dash": dash has some of them (`local`). It shows on a bash script too, as a quiet mark (section 8, decision 2); the dialect issues still show only for the target shell.

The Key lists the marks drawn, the level marks included, inline in the panel.

CHANGELOG (New): "A switch shows what each program receives: its words after bash's expansions, and the parts bash handles itself. A mark shows what POSIX sh lacks."

From P1 (review of #538): `needsReading(state)` becomes `explainNeeds(state)`, which returns the explain options a state needs (the reading data at depth 2, argv with the switch on); both hosts pass them to the explanation. `receives` joins `PanelState`, and `panelState` reads it back (the round-trip test fails until it does).

Tests: the rule of "handled by bash" against P4's argv data, over the corpus, with the count per construct (one). The dialect mark against the dash and yash measurements that test/dialect.test.ts already checks; `bash --posix` is no oracle (it runs `[[ ]]`, `==` in `[ ]` and `source`). Chips whole at three widths; the Key's entries equal the marks drawn.

Risks: two marks on one row read as noise. The usability test checks it.

### P10. Clean-up and the last measure

What: the reading tree's fields and helpers that P8 left unread, if any. The speed measure again on the whole series, before (main at P6) and after. docs/design/tree-view/README.md gets status "Replaced by panel-redesign.md". README images re-recorded.

Users: no CHANGELOG line, unless the measure shows a change users see.

Tests: test/file-length.test.ts; the coverage gate.

### 6.1 The view slot contract

The web page's chrome is redesigned beside this plan: [chrome-redesign.md](chrome-redesign.md), from prototype round 8 (`proto/chrome-8`). There, the panel header has a "view slot" of fixed width. It holds one control at every width: "Depth", then segments with digits, the selected one with its short name; below about 240 px of slot, a menu "Depth 1 ⌄". On a phone it is the same control, a 44 px pill in the tabs row (chrome-redesign.md, decision 4, step C7). The two series meet only here:

- **The panel owns the view state.** `PanelState` holds it (`depth`, `receives`; today `view`, `step`). The panel applies it. VS Code keeps it in the extension's `globalState` (src/ui/panel.ts) and in the webview's state; the page keeps it in storage (`STORAGE_KEYS.panel`). Both send it with the existing `panelState` messages, in both directions.
- **The control is data.** `viewControl(state, lang)` gives the label, and for each option its id, icon, short name, full name and pressed state, and optional steps (Reading's eight, until P8). The page draws the slot from it, as segments or as a menu; the VS Code panel draws its own header from it. Never as an icon alone (chrome-redesign.md, decision 11). Which form fits is a list of candidates from src/ui, widest first; each host takes the first that fits (chrome-redesign.md, C7). A press sets the state and sends it. The page never knows what the options mean.
- **What to compute is decided in src/ui, not in the page.** Today the hosts build the reading tree only when `view === 'tree'` (web/panel-bridge.ts, src/ui/panel.ts). A function of src/ui says, from the state, which data the explanation needs (the reading tree at depth 2, argv with the switch on). Both hosts call it.
- **The fit is chrome's; the words are the panel's.** Each short name fits its segment at the slot's widths, in both languages and with the CJK fonts (a web test, from C7 on: before C7 there is no slot, only today's view switch in the top bar). The full name is the tooltip and the accessible name. The switch "What the program receives" and the Key stay in the panel's own row, under the line box, not in the slot.

The panel handles keys 1, 2 and W when the focus is in it. The page binds none of them. The page's Help list of shortcuts names them, "in the panel".

## 7. The usability test

After P10 and the chrome series ([chrome-redesign.md](chrome-redesign.md), C9), as the roadmap's usability test. The users are simulated: agents, not people. So the test shows what an agent can find and do in the panel. It is not a measure of human usability. VS Code is not tested: the users drive the web page.

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
- **Baseline:** the same protocol runs, with other agents, on a pinned commit: the last release tag before P1 and the chrome's C1a land. So it can run at any time. The report sets both side by side.
- **Goal:** every user passes the task gate, and the average score is 9/10 or more. Below it, the findings become explanation bugs or panel PRs, and the test runs again with new agents. After two runs below the goal, the maintainer decides.
- **People:** a short session with real people, if the maintainer can arrange one, before the README claims anything about usability.

## 8. The open questions, answered

The maintainer answered the plan's three open questions on 2026-10-27:

1. **The CLI.** Its output stays as today's list of parts, like Copy as Markdown and the hover (decision 7). It follows neither the depth nor the switch. No step changes it.
2. **"Not in POSIX sh" on a bash script.** The mark shows on a bash script too, as a quiet mark. It is a fact of the construct: useful when moving a script to sh, and for learners. The dialect issues (the problems) still show only for the target shell (P9).
3. **The basis chips before P7.** Yes. The basis chips and "Try it" land before P7, so P7's row model takes its chips as row data (P7a).
