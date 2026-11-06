# Usability toward 9/10

The plan for the roadmap item "Usability toward 9/10". The usability test of 2026-11-06 rated the web page and its panel 7.6/10 after two runs, below the goal of 9 ([panel-redesign.md](panel-redesign.md), section 7, "Results (2026-11-06)"). This page takes its findings one by one: whether each is still there on main, where it comes from in the code, what it cost, and how to fix it. Then the steps as PRs, the maintainer's questions, and how the test runs again.

Status: planned (2026-11-06). Nothing built. The steps wait on the maintainer's answers (section 5).

## 1. The evidence

The test kit and its data are not in the repository (the maintainer's machine, `~/.cache/explain-bash-tmp/ut-kit-2xlT`). Ten sessions on main count here: run 1 (u1 to u5, main e39afae0) and run 2 (u11 to u15, main 71cac086). u6 to u10 are the baseline (v0.9.1). Each run had the same five personas: a beginner (u1, u11) and an LPIC learner in Japanese (u2, u12) at 390 px; a sysadmin (u3, u13), a developer (u4, u14) and a UX designer (u5, u15) at 1280 px.

What the measures said:

- **Scores** barely move: run 1 7, 8, 7, 7, 7; run 2 8, 8, 8, 7, 7. Agents anchor on 7. A finding's effect on the score can only be read from what users name as their three costliest problems.
- **Answered from the page**: 30/30 on main in both runs (the baseline 25/30). It no longer separates anything on main.
- **Rated easy**: 19/30 in run 1, 22/30 in run 2 (the baseline 10/30). This is the measure that still moves. In the ten sessions, 19 task answers were not easy: task 6 (portability) 9 times, task 2 (the fix) 5, task 4 (`"$USER"`) 3, task 3 and task 5 once each. Four more were "easy once found" or "easy at depth 2" (u13, u14, u15).

Every finding below was reproduced on main at b14a1da8 (the release 0.10.0), built as the repository builds the page (`npm run build:web -- --channel=next`), driven with the kit's Playwright driver and with a measuring script. The screenshots are not in the repository either; the report of the PR that added this page gives their folder.

## 2. The findings, ranked

Ranked by their expected effect: first the tasks they made "not easy", then how many users named them among their three costliest problems. "Top 3" counts users of the ten who named it there.

| # | Finding | Still on main | Not easy | Top 3 | Users |
|---|---|---|---|---|---|
| 1 | Nothing hints to check POSIX sh | Yes | Task 6: 9/10 | 7 | all ten |
| 2 | The copied fix is a fragment, under "More", beside two other "Copy" | Yes | Task 2: 5/10 | 7 | all ten |
| 3 | The phone panel: drag bar, full height | Yes | Task 3: u2; task 6, in part: u12 | 4 of 4 phone users (3 as the first) | u1, u2, u11, u12 |
| 4 | Answers behind depth 2 or closed details | Yes | Task 4: 3/10; task 5: 1/10 | 4 | u1, u3, u4, u5, u11, u13, u14, u15 |
| 5 | The hover card on a click; the Legend stays open | Yes | (none directly) | 6 | u1, u3, u4, u5, u11, u13, u15 |
| 6 | Names that do not agree | Yes | Task 2 (the wrong Copy, 3 users) | 5 | u1–u5, u11, u12, u13, u15 |
| 7 | The sh problems do not say what fails (new) | Yes | Task 6 (part of it) | 3 | u2, u4, u12, u14, u15 |
| 8 | The length at depth 2; run-on "In short" | Yes | (none directly) | 1 | all ten said "yes" to length; "In short": u2, u4, u5, u14, u15 |
| 9 | The depth keys type "1" into the editor | Yes | (none) | 1 (as the first) | u14 |
| 10 | Smaller ones (new) | Yes | (none) | 0 | see 2.10 |

### 2.1 Nothing hints to check POSIX sh

**Seen.** With `#!/usr/bin/env bash`, args.sh shows "No problems" in the Problems strip. The `[[ … ]]` row of line 4 carries the quiet mark "not portable to sh", but only that row, and only in the panel. A user must think of opening the chip "Shell script · bash (auto)" and picking POSIX sh. Then two warnings appear.

**Cause.** The dialect issues are made only for the target shell: `issuesFound` in src/dialect.ts gives sh's features for a sh script only. That is a decision (panel-redesign.md, section 8, question 2: the problems show only for the target shell; the mark is quiet on a bash script). The empty strip is web/problem-list.ts:67 and :74 (`t.noProblems`); the phone's tab, web/panel-head.ts. Nothing counts the marks over the document.

**Cost.** Task 6 was not easy for 9 of 10 users, the largest single cost. u1, u3, u4, u5, u11, u13 and u14 put it in their top three.

**Fix.** One count, from the source of the marks: `collectFeatures` (src/dialect.ts:186) over the whole document, filtered as `notPosixOn` (:198) filters, gives the forms a sh lacks. Where the shell is bash and the count is not zero, the Problems strip says so after its list (or in place of "No problems"): "No problems in bash. 2 forms are not in POSIX sh" with a button "Check as POSIX sh". The button makes the same choice as the chip's popover (`setChoice('shell', 'sh')`, web/main.ts), and the chip then shows it, so the way back is where the user expects it. On a phone the Problems tab shows the same line. No new table: the FEATURES table (src/shellfeatures.ts) stays the one source of what sh lacks.

**Products.** The web page. VS Code: its panel already shows the mark; whether VS Code also gets a hint is question Q2. The CLI has `--shell`.

**Tests.** Unit: the count is the number of marks the panel shows over the document, for the sample and the kit's scripts (one source, tested as one). Web: the strip's line and its button, en and ja, at 1280 and 390; after the button, the chip says POSIX sh and the strip lists the warnings.

### 2.2 The copied fix is a fragment

**Seen.** backup.sh line 2: `tar -czf "$backup" ~/docs 2>/dev/null || echo "failed" >&2`. The panel's problem box shows a headline and "More". Under "More", "Fix `{ echo "failed" >&2; return 1 2>/dev/null || exit 1; }`" and a button "Copy". The clipboard gets that group only, the right side of `||`. The hover card's button "Rewrite as { echo … }" is the quick fix: it applies the edit, but its title shows the same fragment. The panel's header has another "Copy" (Copy as Markdown); the app bar has "Copy a link". Users who pressed the header's "Copy" got the whole explanation as Markdown (u3, u5, u13); the kit's driver, asked for "Copy", found three.

**Cause.** A rewrite is `{ code, edits }` (src/rewrite.ts:21): `code` is what the edits put in place, and `edits` are ranges of the document. The VS Code quick fix and the web editor's fix apply the edits, so they are right. The panel keeps only the code: src/ui/panelProblems.ts:73 maps each rewrite to `r.code`, and media/panel.js `fixLine` (:399) draws and copies that string. Nothing in src/ applies a rewrite to a line's text; only the tests do (`applied`, test/support/rewrites.ts:28; test/fixes.test.ts). The Fix sits inside the closed `details` "More" (media/panel.js:422). The fragment's own rewrite is src/statusfacts.ts:326 (`replaceNode(right, …)`).

A smaller one: u1 saw `2>/dev/null|| exit` without its space. media/panel.js `shellWords` (:496) draws each word as an inline block, with the blanks as text between them, in a box with `overflow-wrap: anywhere`; at a wrap the blank can drop out of sight.

**Cost.** Task 2 was not easy for 5 of 10 (u1, u3, u5, u11, u13). Every user copied a fragment. u3 and u13 named the Copy buttons as their costliest problem, u5 the duplicate controls.

**Fix.**

- One function applies a rewrite to text: `applyRewrite(text, rewrite)` in src/rewrite.ts, beside `Rewrite`. The tests' `applied` becomes a call of it (one source).
- `BoxProblem.fixes` carries the fixed statement: the lines the edits touch, with the edits applied, and the span of what changed. The note's text keeps the fragment, as today ("write `… || { … }`").
- The Fix box shows the whole fixed line with the changed part marked, and copies the whole line. A statement over several lines copies all its lines. A rewrite with no edits (it shows code only) keeps today's box.
- The Fix and its Copy show under the headline when the problem has a fix, not inside "More". "More" keeps the note's whole text.
- The button says "Copy fix" / 「修正をコピー」; the header's button says "Markdown" under its icon where it is narrow, "Copy as Markdown" where there is room (question Q4).
- The blanks of `shellWords` belong to a word's span, so a wrap never hides one.

**Products.** The VS Code panel and the web panel (media/panel.js is shared). The quick fixes do not change; their title ("Rewrite as …", src/fixes.ts:21) may keep the fragment, since it names what the edit puts in place.

**Tests.** Unit: `applyRewrite` gives what the edits give in the editor, for every rewrite of the corpus (test/rewrites-corpus.test.ts applies them through test/support/rewrites.ts, which then calls the one function); the panel model's fix is a whole line for `failure-reported-as-success`, a style check and a rewrite over two lines. Web: the clipboard after "Copy fix" is the whole line; the line pasted over the old one parses and has no problem of that id.

### 2.3 The phone panel

**Seen** (390 x 844, an Android user agent, as the kit's driver). The sheet starts at half: its top at y = 380, 464 px high. Its header row is 390 x 48 px, and the drag bar drawn in it is 36 x 4 px. Only about 10% of the header's points are free to grab (120 of 1,164 sample points; the tabs, the depth menu and the tools take the rest). A flick of 66 px up on the header sends the sheet to full: its top at y = 108, the editor hidden, the app bar slid away. The file name ("untitled.sh", a button that opens the rename box) then sits right above the sheet's edge, at y = 64 to 108. At full, logins.sh's panel is 1,518 px for a view of 655 px.

**Cause.** src/ui/sheet.ts: `HALF_SHARE = 0.55` (:16), `FLING = 0.5` px/ms (:18), so a short flick is a fling to the next height, and `tapped` (:102) cycles the heights on a tap. The drag listens on the whole header (web/sheet.ts:389), but a press on a tab or a control is not a drag. The full height reaches the editor's header strip (`snapHeights`, src/ui/sheet.ts), whose file name is a rename button (web/file-name.ts). While a drag is in flight, the sheet can cover the app bar's lower part before the bar slides away (u2 tapped ☰ and missed).

**Cost.** Every phone user named it: first for u1, u2 and u12, second for u11. u12: "a swipe in the panel made it full-screen and hid the editor and the 貼り付け button … tapping near it opened the file-name rename box".

**Fix.** Extend the sheet's own constants and its one heights function; add no second gesture model.

- A grab area that a thumb finds: the bar drawn at 48 x 5 px, and a hit area of at least 44 px high around it that no control overlaps (the header row's middle, between the tabs and the depth menu, or a strip of its own above the row; question Q6).
- A fling needs more speed and distance (`FLING` to about 1 px/ms, and a minimum travel), so a scroll-like flick does not jump two heights' worth.
- Full stops below the editor's header strip with a margin of 8 px, so a tap just above the sheet is not a rename; or the rename opens from the pencil only on a phone (question Q6).
- The app bar is never under the sheet during a drag: the drag's top is clamped at the bar's bottom until the snap settles.
- The first height stays half; the peek is kept.

**Products.** The phone layout only. This step needs the maintainer's check on a real device (chrome-redesign.md, section 8).

**Tests.** Unit: `snapHeights` and the fling rule (src/ui/sheet.ts is pure). Web, at 390 and 360 px, en and ja, with the CJK fonts: the free grab area is at least 44 x 44 px; a 66 px flick moves one height at most; the sheet never overlaps `#menu-open` during a drag; at full, the file name is at least 8 px above the sheet.

### 2.4 Answers behind depth 2 or closed details

**Seen.** logins.sh line 1, at 1280 px. At depth 1, `"$USER"` is "Current user name" and nothing more; "bash's steps: parameter expansion → no word splitting or globbing (quoted) → quote removal" is only at depth 2 (checked: the text "quote removal" is absent at depth 1). The glob tester is in "Example for grep -h "$USER" /var/log/*.log (glob /var/log/*.log)", closed at both depths. A problem's fix is under "More" (2.2). Names typed in the tester are lost when the depth changes (u3, u13).

**Cause.** The reading tree exists only at depth 2: src/ui/panelRows.ts:523 (`options.depth === 2 && ex.reading ? rolesOf(…)`), and `explainNeeds` (src/ui/panelView.ts) builds the reading only at depth 2; a row's `steps` need a role range from it. The glob example is folded by rule: src/ui/panelRows.ts:217 (`e.kind === 'glob' ? { ...e, folded: true }`). The panel redraws every row on an update (media/panel.js), and the tester's text is not among what it keeps per line (`openExamples`, `foldChoices`).

**Cost.** Task 4 was not easy for u1, u11 and u14, and "easy at depth 2" for u13 and u15. Task 5 was not easy for u5 (the closed example); u1, u11 and u15 said the example is hard to find. u11 put it first: "the default view looks complete but is not".

**Fix.**

- Depth 1 shows bash's steps on a word where a step changes it (an expansion, splitting, a glob, a tilde), in one line, from the same `StepsLine` (src/ui/panelSteps.ts) that depth 2 shows. Depth 2 keeps the tree of parts and the grammar. This needs `explainNeeds` to ask for the reading at depth 1 too; its cost is measured (P10's figures: p95 under 8 ms on nvm.sh). Which steps depth 1 shows is question Q3.
- The glob example is open when the cursor's line has one glob example and it belongs to the stage the cursor is on, or when it is the line's only example (question Q3).
- The tester's text is kept per line, with the open state, across a depth switch and a redraw.

**Products.** The VS Code panel and the web panel.

**Tests.** Unit (row model): at depth 1, `"$USER"` has a steps line; a plain literal has none; the glob example's `folded` follows the rule. Web: type names, switch depth, the names stay. The length budget is measured again (2.8).

### 2.5 The hover card and the Legend

**Seen.** A click on line 1 at 1280 px, with the pointer left where it clicked, opens a hover card of 518 x 590 px under the line. It covers lines 2 and below, and it blocks a click on them: after a paste of args.sh, the driver's click on line 4 failed ("something else is on top: div.cm-bx-hover"). The card repeats what the panel already shows for that line. The Legend opens in the flow of the panel, up to 411 px high (logins.sh line 1, depth 2). It stays open on the next line and Escape does not close it, with the focus in the editor or in the panel. On a line with nothing to explain, an open Legend draws an empty box (new, below).

**Cause.** The card is CodeMirror's `hoverTooltip` (web/hover.ts:351, `hoverTime: 250`). It opens when the pointer rests, whether it got there by a click or not, and no `hideOnChange` closes it on a click, a paste or typing. Its place, under the whole line, is `cardPlace` (src/ui/cardPlace.ts:36), a decision of the chrome's C1a. The Legend's open state is a plain variable, `keyOpen` (media/panel.js:1532), never reset; the panel's only key handler (media/panel.js:1598) knows 1, 2 and W, not Escape; the box `#key` is in the flow (media/panel.css).

**Cost.** The hover card is the costliest problem of u15, second for u4, u5 and u13, third for u3: five of the six desktop users. The Legend: u1 (first, with the panel's size), u3, u13; u11 too ("the Legend I opened stayed open").

**Fix.**

- On the web page the hover card does not open from a resting pointer after a click on the same line: the click already shows the line in the panel. It closes on a click, a paste and typing (`hideOnChange`), and on Escape wherever the focus is. A pointer that moves on to another word opens it as today (question Q5).
- The Legend becomes a popover over the panel: it never pushes the answer down, it is capped in height, and it closes on Escape, on a click outside it and on a new line. Its entries stay those of `keyEntries` (src/ui/panelRows.ts). With no entry, the button is not shown.

**Products.** The web page (the card); the VS Code panel and the web panel (the Legend). VS Code's own hover does not change.

**Tests.** Web: click a line and leave the pointer: no card; move to another word: a card; paste: no card; Escape closes it. Legend: open, move the cursor, it is closed; Escape closes it; the tree's top does not move when it opens.

### 2.6 Names that do not agree

**Seen.**

- The depth control shows "1 Does" and "2" at depth 1, "1" and "2 Reads" at depth 2; its menu and tooltips say "What it does" and "How bash reads it". Users took them for different things, or did not know what "Reads" means (u1, u3, u4, u5, u11, u15).
- In POSIX sh, the Problems strip says "Portability: `[[ ]]` is not POSIX sh…", and the panel's box for the same note says "Pitfall `[[ ]]` is not POSIX sh." (u5, u15).
- After "Clear the editor" and a paste of a script with no shebang, the editor keeps the last file type and name: test.bats, then logins.sh pasted, shows "untitled.bats" and "bats · bash (auto)". Users saw "test.bats ●" stay for every script (u2, u4, u5, u12, u15), and Copy as Markdown headed the text "test.bats:2".
- Three buttons say "Copy" (2.2).

**Cause.**

- The depth names are `depths` in src/ui/texts.ts:209 (`short: 'Does'`, `full: 'What it does'`; `short: 'Reads'`, `full: 'How {shell} reads it'`), a decision (panel-redesign.md, section 3, decision 6).
- The panel's headline uses the level's word: `word: levelWord(n.level, lang)` (src/ui/panelProblems.ts:61), "Pitfall" from `LEVELS` (src/levels.ts:118). The strip uses the note's label, which is the heading `PORTABILITY` (src/messages-levels.ts:87) for a dialect note. The panel's "More" uses the label too (src/ui/panelProblems.ts:70). The decided rule says a level is named "by the level's mark and word, or the note's heading where it has one" (panel-redesign.md, section 3, "One word per level"): the headline breaks it.
- `clearEditor` (web/main.ts:624) keeps the file ("A file opened stays the file"). A paste re-detects the kind only when it finds one (web/kinds.ts:115: `if (!found || found.kind === this.kind) return`), so a script without a shebang keeps bats.

**Cost.** u5 put the duplicate controls and the names first, u15 second ("each makes me doubt what I see"), u12 the file name second, u3 the depth labels third.

**Fix.**

- One name per depth, the short form a part of the long one (question Q1).
- The panel's headline takes the note's heading where it has one, as the strip does: one source, the note's `label`.
- "Clear the editor" starts a new untitled file of the plain Shell script kind; a whole-script paste into an empty or untouched editor (`untouched`, web/kinds.ts:24) with no kind signal sets the plain kind back, with the same "Detected" toast and Undo as today (question Q7).
- The Copy labels as in 2.2.

**Products.** The web page and the VS Code panel (the headline, the depth names); the web page only (the file name).

**Tests.** Unit: the panel headline's word equals the strip's label for every dialect note and every fact with a heading (the corpus). Web: clear, paste logins.sh after test.bats: "untitled.sh", "Shell script"; the depth control's names at every width (the existing tests of `viewControlForms`).

### 2.7 The sh problems do not say what fails (new)

**Seen.** In POSIX sh, line 4 of args.sh says "`[[ ]]` is not POSIX sh (it fails in dash). Instead, use `[ ]`." It does not say what happens: dash prints `[[: not found` and the status is 127, so the `elif` is false and the `else` branch runs. "Use `[ ]`" does not cover `=~` (u4).

**Cause.** The FEATURES table (src/shellfeatures.ts:77) has no entry of how `dbracket` fails in dash, so `doingText` (src/dialect.ts:433) falls back to "it fails in dash". Other rows already say more (`dash: 'stops'`, `'refused'`, or a sentence of their own).

**Cost.** Not in the roadmap's list, but five users raised it (u2 second, u12 third, u4 third; u14 and u15 for task 6): the run-time effect was their own knowledge in every answer to task 6.

**Fix.** Extend the FEATURES rows with what each sh does where the row has nothing (a command not found, status 127; and where it sits in a condition, that the condition is false), in the table's existing `Does` form. A fix for `=~` in sh (`case` or `expr`) where the pattern allows it is question Q8.

**Products.** Every output that shows the dialect issues: the web page, VS Code, the CLI, the Action.

**Tests.** test/dialect-dash.test.ts runs dash: each new text is checked against what dash does (the status, the message).

### 2.8 The length, and "In short"

**Seen.** At 1280 px, logins.sh line 1 makes the panel 1,042 px at depth 1 and 1,437 px at depth 2, for a view of 688 px; an open Legend adds 411 px. The accepted budget is 1,420 px at 1280 (panel-redesign.md, P10): depth 2 is at the budget. backup.sh line 2: 863 and 1,289 px. "In short" for getopts.sh line 2: "Repeats lines 3–8 while getopts (parse script options one at a time (used as while getopts …; do case … esac; done; $OPTIND tracks the position)) succeeds." The `while` node says lines 2–9 (u2). test.bats line 16 (`run ! cat /no/such/file`): "In short Runs run." (the grader, from u3's screenshot).

**Cause.** Depth 2 gives every token a row (src/ui/panelRows.ts, `rowsOf`), each with its role line and steps; `foldDeep` (:444) folds only rows whose children are all depth 2. "In short" is src/linesentence.ts. `noun` (:551) puts a command's gloss in parentheses (src/messages-sentence.ts:86), and getopts' gloss has parentheses of its own (src/dict/builtins.ts:583). `bodyLines` (:372) names the body's lines, where the node names its own. A bats function with no gloss gives only its name.

**Cost.** All ten users paid for the length (u12 "a little"), but as a first cost only with the phone's size (u1). "In short" was third for u14, and named by u4, u5, u15, u2.

**Fix.**

- At depth 2, a pipeline opens the stage the cursor is on and folds the others to their headline and their receives line; a click opens one. This extends `foldDeep` with the cursor's stage (`RowModel.places` gives the row of a token). The Legend's popover (2.5) takes it out of the flow.
- "In short" never nests parentheses: `noun` drops a gloss that has its own, or the gloss gets a short form (`CommandSaid.what`; question Q9). The range says what it counts ("its body, lines 3–8").
- "Runs run." gets the function's gloss from its spec (src/dict/bats.ts), as a program's does.
- The length budget is measured again after these steps.

**Products.** The VS Code panel and the web panel; "In short" also where the CLI prints it.

**Tests.** Unit: no sentence of the corpus has nested parentheses (a guard over the snippets); the getopts and bats lines. Web: the panel's height for logins.sh line 1 at depth 2 under the budget.

### 2.9 The depth keys type "1" into the editor

**Seen.** With the cursor in the editor, the keys 1 and 2 type "12" into the script; the depth does not change. u14 found out only from a "Discard unsaved changes" dialog later.

**Cause.** By design the panel handles 1, 2 and W only when the focus is in it (media/panel.js:1598; panel-redesign.md, 6.1: "The page binds none of them"). But the control draws the digit beside each depth (`digit`, src/ui/panelView.ts:76), which reads as a shortcut that works anywhere. Help lists "1, 2: Choose the depth, in the panel" (web/text.ts:160).

**Cost.** One user, but as the first cost: the script changed without a sign.

**Fix.** Question Q1 decides the label. Recommended: keep the keys in the panel, and draw no bare digit on the control; the tooltip says "1 or 2 in the panel". The page keeps binding no digit in the editor.

**Products.** The web page and the VS Code panel (the control is shared).

**Tests.** The existing `viewControlForms` tests; a web test that "1" typed in the editor changes the text and not the depth (it documents the rule).

### 2.10 Smaller ones (new)

- **An empty Legend.** On a line with nothing to key (a blank line, a bats line read as nothing), an open Legend draws an empty bordered box (seen on main). Fixed with 2.5.
- **The fix is clever.** `return 1 2>/dev/null || exit 1` is "over-engineered for a plain script" (u4, u11, u13, u14). It is decided (panel-redesign.md, decision 8: the fix must not end the caller's shell when the file is sourced). Question Q10.
- **Typed names lost** on a depth switch: in 2.4.
- **A problem's text cut** with "…" in the Problems list (u11). The strip shows two lines by design; the full text is one click away. Not planned.
- **`backup`, not defined in the script,** is shown as "not in the dictionary", with nothing on whether it may not exist (u1, u2, u5; the baseline too). It is a fact of the names model (`resolveName`), not of the UI. Not in this plan; a roadmap item if the maintainer wants it.

## 3. The steps

Each step is one PR and keeps every test passing. The order puts the largest effect at the lowest cost first, and keeps the phone's layout in one step of its own. "Phone" marks a step that changes the phone's layout: it waits on the maintainer's check on a real device before the next run of the test.

| Step | What | Findings | Products | Phone |
|---|---|---|---|---|
| U1 | The fix as a whole line: `applyRewrite`, the Fix box with the line and its changed part, out of "More", "Copy fix", the header's "Copy as Markdown", the blanks of `shellWords` | 2.2, part of 2.6 | VS Code panel, web panel | No |
| U2 | The hint toward POSIX sh: the count from `collectFeatures`, the strip's line and its button | 2.1 | Web page (VS Code: Q2) | The tab's line only, no layout |
| U3 | Names: the depth names and their digits, the panel's headline from the note's label, the file after Clear and after a paste | 2.6, 2.9 | Web page, VS Code panel | No |
| U4 | The hover card after a click, and the Legend as a popover (with the empty one) | 2.5, 2.10 | Web page, VS Code panel | No |
| U5 | Depth 1 shows bash's steps where a step acts; the glob example open by the rule; the tester's text kept | 2.4 | VS Code panel, web panel | No |
| U6 | What sh does where a form fails, in the FEATURES table, checked with dash | 2.7 | Every output | No |
| U7 | "In short" without nesting, with its range named; the bats functions' gloss; the pipeline's other stages folded at depth 2; the length measured again | 2.8 | VS Code panel, web panel, CLI | No |
| U8 | The phone's sheet: the grab area, the fling, the full height below the file name, the app bar during a drag | 2.3 | Phone | Yes |
| U9 | The test again, with new agents (section 6) | all | — | — |

U1 to U4 are independent of each other and may go in any order, or in parallel where their files do not meet (U1 and U3 both touch the Copy labels in src/ui/texts.ts: U1 first). U5 and U7 both touch src/ui/panelRows.ts: U5 first. U8 can start at any time, but its device check should be done before U9. CHANGELOG: each step adds its own bullets under "Unreleased" (what users see).

## 4. What does not change

- The quick fixes in VS Code and in the web editor (they already apply the whole edit).
- The CLI's output, Copy as Markdown and the hover's list of parts (panel-redesign.md, decision 7), except where a text they share changes (2.7, 2.8).
- The rule that the problems show only for the target shell (panel-redesign.md, section 8, question 2): the hint of 2.1 is not a problem, and it does not count in `--check`.
- The three note levels and their words.

## 5. Questions for the maintainer

Each has a recommendation. Nothing here is decided until the maintainer answers.

- **Q1. The depth names.** Today "1 Does" / "2 Reads", with "What it does" / "How bash reads it" in the menu (decision 6 of panel-redesign.md). Recommended: "Overview" / "Word by word", with the long forms "What it does" / "How bash reads it, word by word" (ja 「概要」/「単語ごと」, 「何をするか」/「bash が単語ごとにどう読むか」), the digit only in the tooltip. Alternatives: keep the names and drop only the digits; or "What it does" / "How bash reads it" at every width that has room.
- **Q2. The hint in VS Code.** Recommended: not now. VS Code users choose a shell in settings, and its panel shows the quiet marks; the web page is where the test saw the cost. Alternative: an Info item in the panel's header ("2 forms not in POSIX sh").
- **Q3. What depth 1 shows.** Recommended: bash's steps in one line on a word a step changes (expansions, splitting, globbing, tildes); the glob example open when it is the line's only example or the cursor's stage has it. Alternative: a "Steps" toggle beside the depth.
- **Q4. The Copy labels.** Recommended: "Copy fix" / 「修正をコピー」 on the fix; "Copy as Markdown" / 「Markdown でコピー」 on the panel's header, "Markdown" under the icon where it is narrow; "Copy a link" stays.
- **Q5. The hover card on the web page.** Recommended: no card from a resting pointer after a click; closed by a click, a paste, typing and Escape; open as today when the pointer moves to a word. Alternative: no hover card at all while the panel is shown (`hover.enabled` off by default on the page).
- **Q6. The phone's grab area and the full height.** Recommended: a grab strip of 44 px of its own above the tabs row (the sheet's edge, as on iOS and Android sheets), the full height 8 px below the editor's header, and the rename from the pencil only on a phone. Alternative: keep the row as it is and make only the bar's middle third a grab area.
- **Q7. Clear and paste.** Recommended: Clear starts a new untitled Shell script (with Undo); a paste without a signal into an empty editor sets the plain kind back. Alternative: keep the file and its kind, and show the kind in the "Detected" toast only.
- **Q8. A fix for `=~` in sh.** Recommended: no rewrite (a regex does not map to `case` in general); the text names `case` and `expr` as the ways.
- **Q9. "In short" for a gloss with parentheses.** Recommended: drop a gloss that has parentheses of its own (the name stays, the rest of the panel says it). Alternative: a short gloss for each such command in its spec.
- **Q10. The fix of `failure-reported-as-success`.** Recommended: keep `return 1 2>/dev/null || exit 1` where the file may be sourced (no shebang, or a name such as `.bashrc`), and `exit 1` where it has a shebang and is run. This changes decision 8 of panel-redesign.md only for scripts that are clearly run; the note's text says why.

## 6. How success is measured

The test runs again after U1 to U8 (step U9), with the kit (`ut-kit-2xlT`): new agents with no project context, the same five personas, models, widths and languages, so that each session can be set against its pair in runs 1 and 2. The briefs are unchanged except two fixes of the method (run 1's remarks): the page is reset between tasks (sticky depth and shell crossed tasks for u4), and one script of 20 to 40 lines is added, so that the length and the moves between lines are tested.

The measures, in the order they decide:

1. **The gate:** every user solves at least 5 of tasks 1 to 6 (both runs: 6/6).
2. **Rated easy:** at least 27/30 (run 1 19/30, run 2 22/30). Task 6 easy for at least 4 of 5; task 2 for 5 of 5. This is the measure the findings move.
3. **Answered from the page:** 30/30, and task 6's run-time effect from the page too (none in runs 1 and 2).
4. **The top-3 costs:** no finding of section 2 named by two users or more.
5. **The score:** an average of 9 or more, the goal of panel-redesign.md, section 7. As before, agents anchor on 7, so a run that meets 2 to 4 and scores 8 goes to the maintainer with that evidence.

The baseline is run 2 (main 71cac086). Below the goal, the maintainer decides what follows, as panel-redesign.md, section 7, says.
