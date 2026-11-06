# Usability toward 9/10

The plan for the roadmap item "Usability toward 9/10". The usability test of 2026-11-06 rated the web page and its panel 7.6/10 after two runs, below the goal of 9 ([panel-redesign.md](panel-redesign.md), section 7, "Results (2026-11-06)"). This page takes its findings one by one: whether each is still there on main, where it comes from in the code, what it cost, and how to fix it. Then the steps as PRs, the maintainer's questions, and how the test runs again.

Status: planned (2026-11-06, #636), revised after an independent review the same day. The maintainer decided the eleven questions as recommended on 2026-11-06 (section 5). Nothing built; U1 is next.

## 1. The evidence

The test kit and its data are not in the repository (the maintainer's machine, `~/.cache/explain-bash-tmp/ut-kit-2xlT`). Ten sessions on main count here: run 1 (u1 to u5, main e39afae0) and run 2 (u11 to u15, main 71cac086). u6 to u10 are the baseline (v0.9.1). Each run had the same five personas: a beginner (u1, u11) and an LPIC learner in Japanese (u2, u12) at 390 px; a sysadmin (u3, u13), a developer (u4, u14) and a UX designer (u5, u15) at 1280 px.

What the measures said:

- **Scores** barely move: run 1 7, 8, 7, 7, 7; run 2 8, 8, 8, 7, 7. Agents anchor on 7. A finding's effect on the score can only be read from what users name as their three costliest problems.
- **Answered from the page**: 30/30 on main in both runs (the baseline 25/30). It no longer separates anything on main.
- **Rated easy**: 19/30 in run 1, 22/30 in run 2 (the baseline 10/30). This is the measure that still moves. In the ten sessions, 19 task answers were not easy: task 6 (portability) 9 times, task 2 (the fix) 5, task 4 (`"$USER"`) 3, task 3 and task 5 once each. Six more were easy only with a condition: "easy at depth 2" or "once found" (u3, u5, u13 and u15 on task 4, u15 on task 5, u14 on task 6).

Every finding below was reproduced on main at b14a1da8 (the release 0.10.0), built as the repository builds the page (`npm run build:web -- --channel=next`), driven with the kit's Playwright driver and with a measuring script. The screenshots are not in the repository either; PR #636 says where they are. File and line references are to b14a1da8.

## 2. The findings, ranked

Ranked by their expected effect: first the tasks they made "not easy", then how many users named them among their three costliest problems. "Top 3" counts users of the ten who named it there.

| # | Finding | Still on main | Not easy | Top 3 | Users |
|---|---|---|---|---|---|
| 1 | Nothing hints to check POSIX sh | Yes | Task 6: 9/10; u14 "easy once found" | 7 | all ten |
| 2 | The copied fix is a fragment, under "More", beside two other "Copy" | Yes | Task 2: 5/10 | 7 | all ten |
| 3 | Answers behind depth 2 or closed details | Yes | Task 4: 3/10; task 5: 1/10; five more easy only "at depth 2" or "once found" | 4 | u1, u3, u4, u5, u11, u13, u14, u15 |
| 4 | The hover card on a click; the Legend stays open | Yes | (none directly) | 7 | u1, u3, u4, u5, u11, u13, u15 |
| 5 | The phone's drag bar and full height | Yes | Task 6, in part: u12 | 2, both as the first | u2, u12 |
| 6 | Names that do not agree | Yes | (the wrong Copy of row 2) | 5 | u1–u5, u11, u12, u13, u15 |
| 7 | The length; run-on "In short"; the phone's half height and small fold arrows | Yes | Task 3: u2 | 4 | all ten said "yes" to length |
| 8 | The sh problems do not say what fails (new) | Yes | Task 6, in part | 3 | u2, u4, u12, u14, u15 |
| 9 | The shell and the depth stay set, with no reminder (new) | Yes | (crossed tasks for u4) | 1, as the first | u4 |
| 10 | The depth keys type "1" into the editor | Yes | (none) | 1, as the first | u14 |
| 11 | Smaller ones, and what is not planned | Yes | (none) | 3 | see 2.11 |

### 2.1 Nothing hints to check POSIX sh

**Seen.** With `#!/usr/bin/env bash`, args.sh shows "No problems" in the Problems strip. The `[[ … ]]` row of line 4 carries the quiet mark "not portable to sh", but only that row, and only in the panel. A user must think of opening the chip "Shell script · bash (auto)" and picking POSIX sh. Then two warnings appear.

**Cause.** The dialect issues are made only for the target shell: `dialectIssues` and `issuesFound` (src/dialect.ts:632, :646) give sh's issues for a sh script only. That is a decision (panel-redesign.md, section 8, question 2: the problems show only for the target shell; the mark is quiet on a bash script). The empty strip is web/problem-list.ts:67 and :74 (`t.noProblems`); the phone's tab, web/panel-head.ts. Nothing counts the issues sh would have.

**Cost.** Task 6 was not easy for 9 of 10 users, the largest single cost. u1, u3, u4, u5, u11, u13 and u14 put it in their top three.

**Fix.** One count, from the source of the strip's own sh problems: `dialectIssues(tree, 'sh', …)`, through the same call the strip makes for a sh script (`documentIssues`, src/document.ts), with the shell set to sh. Not the quiet marks' `collectFeatures` and `notPosixOn` (src/dialect.ts:186, :198): the problems add the behaviours (`collectBehaviours`), drop the variable rows the script assigns and the names that are functions, skip rows with no message, and lower or drop issues through `stopAt`. So only this count agrees with what the strip then lists. Where the shell is bash and the count is not zero, the strip says so: "2 problems in POSIX sh" with a button "Check as POSIX sh". The button makes the same choice as the chip's popover (`setChoice('shell', 'sh')`, web/main.ts), and the chip then shows it, so the way back is where the user expects it. On a phone the Problems tab shows the same line. Decided (Q2): the hint shows only where the shell comes from `#!/usr/bin/env bash` or no shebang. It puts sh on the strip of a bash script, which goes further than the quiet mark of section 8, question 2. A bats file is left out: bats always runs bash.

**Products.** The web page. VS Code: its panel already shows the quiet mark, and it gets no hint for now (Q3). The CLI has `--shell`.

**Tests.** Unit: the hint's count for the sample and the kit's scripts. Web: the strip's line and its button, en and ja, at 1280 and 390; after the button, the chip says POSIX sh, and the strip lists as many problems as the hint said. The cost of the second pass on a bash script is measured (nvm.sh, as P10 did).

### 2.2 The copied fix is a fragment

**Seen.** backup.sh line 2: `tar -czf "$backup" ~/docs 2>/dev/null || echo "failed" >&2`. The panel's problem box shows a headline and "More". Under "More", "Fix `{ echo "failed" >&2; return 1 2>/dev/null || exit 1; }`" and a button "Copy". The clipboard gets that group only, the right side of `||`. The hover card's button "Rewrite as { echo … }" is the quick fix: it applies the edit, but its title shows the same fragment. The panel's header has another "Copy" (Copy as Markdown); the app bar has "Copy a link". Users who pressed the header's "Copy" got the whole explanation as Markdown (u3, u5, u13); the kit's driver, asked for "Copy", found three.

**Cause.** A rewrite is `{ code, edits }` (src/rewrite.ts:21): `code` is what the edits put in place, and `edits` are ranges of the document. The VS Code quick fix and the web editor's fix apply the edits, so they are right. The panel keeps only the code: src/ui/panelProblems.ts:73 maps each rewrite to `r.code`, and media/panel.js `fixLine` (:399) draws and copies that string. Two functions apply edits to text today, and neither serves the panel: `edited` (src/pitfalls.ts:267, used by `editSpan`) makes a style check's rewrite from a span, and the tests' `applied` (test/support/rewrites.ts:28) checks rewrites. The Fix sits inside the closed `details` "More" (media/panel.js:422). The fragment's own rewrite is src/statusfacts.ts:326 (`replaceNode(right, …)`).

A smaller one: u1 saw `2>/dev/null|| exit` without its space. media/panel.js `shellWords` (:496) draws each word as an inline block, with the blanks as text between them, in a box with `overflow-wrap: anywhere`; at a wrap the blank can drop out of sight.

**Cost.** Task 2 was not easy for 5 of 10 (u1, u3, u5, u11, u13). Every user copied a fragment. u3 and u13 named the Copy buttons as their costliest problem, u5 the duplicate controls.

**Fix.**

- One function applies edits to text: `applyRewrite(text, rewrite)` in src/rewrite.ts, beside `Rewrite`. It replaces both `edited` in src/pitfalls.ts and the tests' `applied`, so there is one applier.
- `BoxProblem.fixes` carries the fixed statement: the lines the edits touch, with the edits applied, and the span of what changed. The note's text keeps the fragment, as today ("write `… || { … }`").
- The Fix box shows the whole fixed line with the changed part marked, and copies the whole line. A statement over several lines copies all its lines. A rewrite with no edits (it shows code only) keeps today's box.
- The Fix and its Copy show under the headline when the problem has a fix, not inside "More". "More" keeps the note's whole text.
- The button says "Copy fix" / 「修正をコピー」; the header's button says "Markdown" under its icon where it is narrow, "Copy as Markdown" where there is room (Q5).
- The blanks of `shellWords` belong to a word's span, so a wrap never hides one.

**Products.** The VS Code panel and the web panel (media/panel.js is shared). The quick fixes do not change; their title ("Rewrite as …", src/fixes.ts:21) may keep the fragment, since it names what the edit puts in place.

**Tests.** Unit: `applyRewrite` gives what the edits give in the editor, for every rewrite of the corpus (test/rewrites-corpus.test.ts reaches it through test/support/rewrites.ts) and for every style check that `editSpan` serves today (their texts stay byte for byte); the panel model's fix is a whole line for `failure-reported-as-success`, a style check and a rewrite over two lines. Web: the clipboard after "Copy fix" is the whole line; the line pasted over the old one parses and has no problem of that id.

### 2.3 Answers behind depth 2 or closed details

**Seen.** logins.sh line 1, at 1280 px. At depth 1, `"$USER"` is "Current user name" and nothing more; "bash's steps: parameter expansion → no word splitting or globbing (quoted) → quote removal" is only at depth 2 (checked: the text "quote removal" is absent at depth 1). The glob tester is in "Example for grep -h "$USER" /var/log/*.log (glob /var/log/*.log)", closed at both depths. A problem's fix is under "More" (2.2). Names typed in the tester are lost when the depth changes (u3, u13).

**Cause.** The reading tree exists only at depth 2: src/ui/panelRows.ts:523 (`options.depth === 2 && ex.reading ? rolesOf(…)`), and `explainNeeds` (src/ui/panelView.ts:63) asks for the reading only at depth 2; a row's `steps` need a role range from it. The glob example is folded by rule: src/ui/panelRows.ts:217 (`e.kind === 'glob' ? { ...e, folded: true }`). The panel redraws every row on an update (media/panel.js), and the tester's text is not among what it keeps per line (`openExamples`, `foldChoices`).

**Cost.** Task 4 was not easy for u1, u11 and u14, and easy only "at depth 2" for u3, u5, u13 and u15. Task 5 was not easy for u5 (the closed example), and easy only "once found" for u15; u1 and u11 said the example is hard to find too. u11 put it first ("the default view looks complete but is not"), u1 and u14 second, u15 third.

**Fix.**

- Depth 1 shows bash's steps on a word where a step changes it (an expansion, splitting, a glob, a tilde), in one line, from the same `StepsLine` (src/ui/panelSteps.ts) that depth 2 shows. Depth 2 keeps the tree of parts and the grammar. This needs `explainNeeds` to ask for the reading at depth 1 too; its cost is measured (P10's figures: p95 under 8 ms on nvm.sh). Which steps depth 1 shows is decided in Q4.
- The glob example is open when it is the line's only example, or when it belongs to the stage the cursor is on (Q4).
- The tester's text is kept per line, with the open state, across a depth switch and a redraw.

**Products.** The VS Code panel and the web panel.

**Tests.** Unit (row model): at depth 1, `"$USER"` has a steps line; a plain literal has none; the glob example's `folded` follows the rule. Web: type names, switch depth, the names stay. The length budget is measured again (2.7).

### 2.4 The hover card and the Legend

**Seen.** A click on line 1 at 1280 px, with the pointer left where it clicked, opens a hover card of 518 x 590 px under the line. It covers lines 2 and below, and it blocks a click on them: after a paste of args.sh, the driver's click on line 4 failed ("something else is on top: div.cm-bx-hover"). The card repeats what the panel already shows for that line. The Legend opens in the flow of the panel, up to 411 px high (logins.sh line 1, depth 2). It stays open on the next line, and Escape does not close it, with the focus in the editor or in the panel. On a line with nothing to explain, an open Legend draws an empty box (2.11).

**Cause.** The card is CodeMirror's `hoverTooltip` (web/hover.ts:351, `hoverTime: 250`). It opens when the pointer rests, whether it got there by a click or not, and no `hideOnChange` closes it on a click, a paste or typing. Its place, under the whole line, is `cardPlace` (src/ui/cardPlace.ts:36), a decision of the chrome's C1a. The Legend's open state is a plain variable, `keyOpen` (media/panel.js:1532), never reset; the panel's only key handler (media/panel.js:1599) knows 1, 2 and W, not Escape; the box `#key` is in the flow (media/panel.css).

**Cost.** Seven users named one or the other in their top three. The hover card: first for u15, second for u4, u5 and u13, third for u3 (five of the six desktop users). The Legend: u1 (first, with the panel's size), u11 (second, "the Legend I opened stayed open"), u3 and u13.

**Fix.**

- On the web page the hover card does not open from a resting pointer after a click on the same line: the click already shows the line in the panel. It closes on a click, a paste and typing (`hideOnChange`), and on Escape wherever the focus is. A pointer that moves on to another word opens it as today (Q6).
- The Legend becomes a popover over the panel: it never pushes the answer down, it is capped in height, and it closes on Escape, on a click outside it and on a new line. Its entries stay those of `keyEntries` (src/ui/panelRows.ts). With no entry, the button is not shown.

**Products.** The web page (the card); the VS Code panel and the web panel (the Legend). VS Code's own hover does not change.

**Tests.** Web: click a line and leave the pointer: no card; move to another word: a card; paste: no card; Escape closes it. Legend: open, move the cursor, it is closed; Escape closes it; the tree's top does not move when it opens.

### 2.5 The phone's drag bar and full height

**Seen** (390 x 844, an Android user agent, as the kit's driver). The sheet starts at half: its top at y = 380, 464 px high. Its header row is 390 x 48 px, and the drag bar drawn in it is 36 x 4 px. Only about 10% of the header's points are free to grab (120 of 1,164 sample points; the tabs, the depth menu and the tools take the rest). A flick of 66 px up on the header sends the sheet to full: its top at y = 108, the editor hidden, the app bar slid away. The file name ("untitled.sh", a button that opens the rename box) then sits right above the sheet's edge, at y = 64 to 108.

**Cause.** src/ui/sheet.ts: `FLING = 0.5` px/ms (:18), so a short flick is a fling to the next height, and `tapped` (:102) cycles the heights on a tap. The drag listens on the whole header (web/sheet.ts:389), but a press on a tab or a control is not a drag. The full height reaches the editor's header strip (`snapHeights`, src/ui/sheet.ts), whose file name is a rename button (web/file-name.ts). While a drag is in flight, the sheet can cover the app bar's lower part before the bar slides away (u2 tapped ☰ and missed).

**Cost.** u12 put it first: "a swipe in the panel made it full-screen and hid the editor and the 貼り付け button … tapping near it opened the file-name rename box", and it cost task 6 some of its effort. u2 put the panel's height first, with the ☰ button covered after a drag. The other two phone users (u1, u11) named the half height and the panel's length, not the drag: that is 2.7.

**Fix.** Extend the sheet's own constants and its one heights function; add no second gesture model.

- A grab area that a thumb finds: a grab strip of its own, 44 px high, above the tabs row, around the bar drawn at 48 x 5 px; no control overlaps it (Q7).
- A fling needs more speed and distance (`FLING` to about 1 px/ms, and a minimum travel), so a short flick does not jump a height.
- Full stops 8 px below the editor's header strip, so a tap just above the sheet is not a rename, and on a phone the rename opens from the pencil only (Q7).
- The app bar is never under the sheet during a drag: the drag's top is clamped at the bar's bottom until the snap settles.
- The first height stays half; the peek is kept.

**Products.** The phone layout only. This step needs the maintainer's check on a real device (chrome-redesign.md, section 8).

**Tests.** Unit: `snapHeights` and the fling rule (src/ui/sheet.ts is pure). Web, at 390 and 360 px, en and ja, with the CJK fonts: the free grab area is at least 44 x 44 px; a 66 px flick moves one height at most; the sheet never overlaps `#menu-open` during a drag; at full, the file name is at least 8 px above the sheet.

### 2.6 Names that do not agree

**Seen.**

- The depth control shows "1 Does" and "2" at depth 1, "1" and "2 Reads" at depth 2; its menu and tooltips say "What it does" and "How bash reads it". Users took them for different things, or did not know what "Reads" means (u1, u3, u4, u5, u11, u15).
- In POSIX sh, the Problems strip says "Portability: `[[ ]]` is not POSIX sh…", and the panel's box for the same note says "Pitfall `[[ ]]` is not POSIX sh." (u5, u15).
- After "Clear the editor" and a paste of a script with no shebang, the editor keeps the last file type and name: test.bats, then logins.sh pasted, shows "untitled.bats" and "bats · bash (auto)". Users saw "test.bats ●" stay for every script (u2, u4, u5, u12, u15), and Copy as Markdown headed the text "test.bats:2".
- Three buttons say "Copy" (2.2).

**Cause.**

- The depth names are `depths` in src/ui/texts.ts:209 (`short: 'Does'`, `full: 'What it does'`; `short: 'Reads'`, `full: 'How {shell} reads it'`), a decision (panel-redesign.md, section 3, decision 6).
- The panel's headline uses the level's word: `word: … levelWord(n.level, lang)` (src/ui/panelProblems.ts:69), "Pitfall" from `LEVELS` (src/levels.ts:118). The strip uses the note's label, which is the heading `PORTABILITY` (src/messages-levels.ts:87) for a dialect note. The panel's "More" uses the label too (src/ui/panelProblems.ts:72). The decided rule names a level "by the level's mark and word, or the note's heading where it has one" (panel-redesign.md, section 3, "One word per level"): the headline breaks it.
- `clearEditor` (web/main.ts:624) keeps the file ("A file opened stays the file"). A paste re-detects the kind only when it finds one (web/kinds.ts:115: `if (!found || found.kind === this.kind) return`), so a script without a shebang keeps bats.

**Cost.** u5 put the duplicate controls and the names first, u15 second ("each makes me doubt what I see"), u12 the file name second, u2 third with the other small inconsistencies, u3 the depth labels third.

**Fix.**

- One name per depth, the short form a part of the long one (Q1).
- The panel's headline takes the note's heading where it has one, as the strip does: one source, the note's `label`.
- What Clear and a new script reset is decided in Q8 (the kind, the name and the shell chosen; see 2.9).
- The Copy labels as in 2.2.

**Products.** The web page and the VS Code panel (the headline, the depth names); the web page only (the file).

**Tests.** Unit: the panel headline's word equals the strip's label for every dialect note and every fact with a heading (the corpus). Web: clear, paste logins.sh after test.bats: the kind and name of Q8; the depth control's names at every width (the existing tests of `viewControlForms`).

### 2.7 The length, "In short", and the phone's half height

**Seen.** At 1280 px, logins.sh line 1 makes the panel 1,042 px at depth 1 and 1,437 px at depth 2, for a view of 688 px; an open Legend adds 411 px. The accepted budget is 1,420 px at 1280 (panel-redesign.md, P10): depth 2 is at the budget. backup.sh line 2: 863 and 1,289 px. On a phone the half-height sheet shows 336 px of the panel; logins.sh's panel is about 1,500 px at depth 1 (at full height, 655 px of view). "In short" for getopts.sh line 2: "Repeats lines 3–8 while getopts (parse script options one at a time (used as while getopts …; do case … esac; done; $OPTIND tracks the position)) succeeds." The `while` node says lines 2–9 (u2). test.bats line 16 (`run ! cat /no/such/file`): "In short Runs run." (the grader, from u3's screenshot). The shebang's row is a paragraph on every script, and a pitfall's text under "More" is a paragraph (u14, u15). On a phone, a part's fold arrow is a small target, and a tap on a part's name folded it (u11).

**Cause.** Depth 2 gives every token a row (src/ui/panelRows.ts, `rowsOf`), each with its role line and steps; `foldDeep` (:444) folds only rows whose children are all depth 2. The phone's half height is `HALF_SHARE = 0.55` (src/ui/sheet.ts:16). "In short" is src/linesentence.ts: `noun` (:551) puts a command's gloss in parentheses (src/messages-sentence.ts:86), and getopts' gloss has parentheses of its own (src/dict/builtins.ts:583); `bodyLines` (:372) names the body's lines, where the node names its own; a bats function with no gloss gives only its name. The fold arrow, `button.twisty`, is 0.8em wide (media/panel.css:1071). The name's tap is to be confirmed in U8.

**Cost.** All ten users paid for the length (u12 "a little"). It was first for u1 (the small phone panel, much scrolling, the open Legend), second for u11 ("the panel fills half the phone screen … the arrows are small tap targets"), third for u14 ("wordy prose": "In short", the shebang paragraph, the tar pitfall's paragraph); u2's first cost was the phone panel's height as well as its drag (2.5). "In short" was named by u2, u4, u5, u14 and u15.

**Fix.**

- At depth 2, a pipeline opens the stage the cursor is on and folds the others to their headline and their receives line; a click opens one. This extends `foldDeep` with the cursor's stage (`RowModel.places` gives the row of a token). The Legend's popover (2.4) takes it out of the flow.
- "In short" never nests parentheses: `noun` drops a gloss that has its own (Q10). The range says what it counts ("its body, lines 3–8").
- "Runs run." gets the function's gloss from its spec (src/dict/bats.ts), as a program's does.
- The shebang's row says one line at depth 1 and its paragraph at depth 2.
- On a touch screen, the fold arrow's target is 44 px; a tap on a name does what a click does on a desktop (part of U8).
- The phone's half height stays at 55%: with the stages folded, a line's first answer fits in it (measured again in U8).
- The length budget is measured again after these steps.

**Products.** The VS Code panel and the web panel; "In short" also where the CLI prints it; the phone (the arrows).

**Tests.** Unit: no sentence of the corpus has nested parentheses (a guard over the snippets); the getopts and bats lines. Web: the panel's height for logins.sh line 1 at depth 2 under the budget.

### 2.8 The sh problems do not say what fails (new)

**Seen.** In POSIX sh, line 4 of args.sh says "`[[ ]]` is not POSIX sh (it fails in dash). Instead, use `[ ]`." It does not say what happens: dash prints `[[: not found` and the status is 127 (measured), so the `elif` is false and the `else` branch runs. The `=~` warning already names `expr` and `grep -E` as the ways; u4's point was that "use `[ ]`" does not cover the regex.

**Cause.** A FEATURES row with no `dash` entry (src/shellfeatures.ts:77 for `dbracket`) means "fails with a status where it runs" (`Feature.dash`, :52), so `doingText` (src/dialect.ts:433) says only "it fails in dash". Other rows already say more (`dash: 'stops'`, `'refused'`, or a sentence of their own).

**Cost.** Not in the roadmap's list, but five users raised it (u2 second, u12 third, u4 third; u14 and u15 for task 6): the run-time effect was their own knowledge in every answer to task 6.

**Fix.** Where a row fails with a status, the text says how: the message and the status, and, where the form is a command in a condition, that the condition is false. The table's existing `Does` form carries it. A failure is not the same everywhere: dash says `[[: not found` with status 127, but `[ a == b ]` says "unexpected operator" with status 2. So every text is measured in dash and in busybox ash before it is written, by test/dialect-dash.test.ts, which already runs every row in both. A fix for `=~` in sh is decided in Q9.

**Products.** Every output that shows the dialect issues: the web page, VS Code, the CLI, the Action.

**Tests.** test/dialect-dash.test.ts: each new text against what dash and busybox ash do (the status, the message).

### 2.9 The shell and the depth stay set, with no reminder (new)

**Seen.** A shell chosen in the chip stays chosen for the next script pasted or opened; the depth stays too. The chip shows the shell ("Shell script · POSIX sh"), but nothing says that the choice was made for another script.

**Cause.** The shell choice is a setting of the page (`setChoice`, web/main.ts), not of the file; Clear and a paste keep it (web/main.ts:624, web/kinds.ts:115). The depth is the panel's state (`PanelState`, src/ui/panelView.ts), kept on purpose.

**Cost.** u4 put it first: after POSIX sh for task 6, logins.sh pasted again showed sh's reading, which "looked wrong and made me doubt the output"; depth 2 stayed from task 0. Run 1's remarks on the method list it too.

**Fix.** The shell chosen for a script belongs to that script: a new script (Clear, a paste of a whole script, Open) goes back to Auto, with a toast that says so and an Undo. The depth stays, as a view's preference. This is part of Q8.

**Products.** The web page.

**Tests.** Web: choose POSIX sh, clear, paste: the chip says Auto and the toast offers Undo.

### 2.10 The depth keys type "1" into the editor

**Seen.** With the cursor in the editor, the keys 1 and 2 type "12" into the script; the depth does not change. u14 found out only from a "Discard unsaved changes" dialog later.

**Cause.** By design the panel handles 1, 2 and W only when the focus is in it (media/panel.js:1599; panel-redesign.md, 6.1: "The page binds none of them"). But the control draws the digit beside each depth (`digit`, src/ui/panelView.ts:77), which reads as a shortcut that works anywhere. Help lists "1, 2: Choose the depth, in the panel" (web/text.ts:160).

**Cost.** One user, but as the first cost: the script changed without a sign.

**Fix.** Decided (Q1): keep the keys in the panel, and draw no bare digit on the control; the tooltip says "1 or 2 in the panel". The page keeps binding no digit in the editor.

**Products.** The web page and the VS Code panel (the control is shared).

**Tests.** The existing `viewControlForms` tests; a web test that "1" typed in the editor changes the text and not the depth (it documents the rule).

### 2.11 Smaller ones, and what is not planned

Planned with a step:

- **An empty Legend.** On a line with nothing to key (a blank line, a bats line read as nothing), an open Legend draws an empty bordered box (seen on main). Fixed with 2.4 (U4).
- **Typed names lost** on a depth switch: in 2.3 (U5).
- **The fix's idiom.** `return 1 2>/dev/null || exit 1` looked "over-engineered for a plain script" to u4, u11, u13 and u14. It is not a choice of the fix's code: `stopCommand` (src/rewrite.ts:65) already writes `exit 1` in a file read as a script, and the kit's backup.sh has no shebang, so the file may be sourced (panel-redesign.md, decision 8). Question Q11.

Not planned, with the reason:

- **The same commands in ☰, ⋯ and the toolbar** (u5, first cost with the names). By design: ☰ holds every command, ⋯ the file's own, the toolbar the frequent ones (chrome-redesign.md, C4). The names of the copies are fixed with 2.2 and 2.6; the places stay.
- **"Collapse" that turns into "Expand"** (u5). The button names what it will do, as VS Code's do. One user.
- **The pitfall's paragraph under "More"** (u14, u15: "dense"). "More" shows the note's whole text by decision (panel-redesign.md, section 3: "more says all that the Problems text says"). With 2.2 the fix leaves "More", so only a reader who wants the reasons opens it.
- **A problem's text cut** with "…" in the Problems list (u11). The strip shows two lines by design; the full text is one click away.
- **`backup`, not defined in the script,** is shown as "not in the dictionary", with nothing on whether it may not exist (u1, u2, u5; the baseline too). It is a fact of the names model (`resolveName`), not of the UI: a roadmap item if the maintainer wants it.

## 3. The steps

Each step is one PR and keeps every test passing. The order puts the largest effect at the lowest cost first, and keeps the phone's layout in one step of its own. "Phone" marks a step that changes the phone's layout: it waits on the maintainer's check on a real device before the next run of the test.

| Step | What | Findings | Products | Phone |
|---|---|---|---|---|
| U1 | The fix as a whole line: `applyRewrite` (in place of `edited` and the tests' `applied`), the Fix box with the line and its changed part, out of "More", "Copy fix", the header's "Copy as Markdown", the blanks of `shellWords` | 2.2, part of 2.6 | VS Code panel, web panel | No |
| U2 | The hint toward POSIX sh, as Q2 decided: the count from `dialectIssues` for sh, the strip's line and its button | 2.1 | Web page (VS Code: Q3) | The tab's line only, no layout |
| U3 | Names and state: the depth names and their digits, the panel's headline from the note's label, what Clear and a new script reset (the kind, the name, the shell) | 2.6, 2.9, 2.10 | Web page, VS Code panel | No |
| U4 | The hover card after a click, and the Legend as a popover (with the empty one). Done in #637 | 2.4, 2.11 | Web page, VS Code panel | No |
| U5 | Depth 1 shows bash's steps where a step acts; the glob example open by the rule; the tester's text kept | 2.3 | VS Code panel, web panel | No |
| U6 | How sh fails where a form fails with a status, in the FEATURES table, each text measured in dash and busybox ash | 2.8 | Every output | No |
| U7 | "In short" without nesting, with its range named; the bats functions' gloss; the shebang's row; the pipeline's other stages folded at depth 2; the length measured again | 2.7 | VS Code panel, web panel, CLI | No |
| U8 | The phone's sheet: the grab area, the fling, the full height below the file name, the app bar during a drag; the fold arrows' targets and a name's tap; the half height measured again | 2.5, part of 2.7 | Phone | Yes |
| U9 | The test again, with new agents (section 6) | all | — | — |

U1 to U4 are independent of each other and may go in any order, or in parallel where their files do not meet (U1 and U3 both touch the Copy labels in src/ui/texts.ts: U1 first). U5 and U7 both touch src/ui/panelRows.ts: U5 first. U8 can start at any time, but its device check should be done before U9. CHANGELOG: each step adds its own bullets under "Unreleased" (what users see).

## 4. What does not change, and what does

- The quick fixes in VS Code and in the web editor (they already apply the whole edit).
- The CLI's output, Copy as Markdown and the hover's list of parts (panel-redesign.md, decision 7), except where a text they share changes (2.7, 2.8).
- The problems still show only for the target shell, and the hint is not a problem: it does not count in `--check` or the Action. But the hint does put sh on the strip of a bash script, which goes further than the quiet mark of panel-redesign.md, section 8, question 2. Q2 decided how far: only for `#!/usr/bin/env bash` or no shebang.
- The three note levels and their words.

## 5. The maintainer's decisions

The maintainer decided all eleven questions as recommended, on 2026-11-06. The other sections name the question (Qn) where a choice was asked; the decision is here.

- **Q1. The depth names.** "Overview" / "Word by word", with the long forms "What it does" / "How bash reads it, word by word" (ja 「概要」/「単語ごと」, 「何をするか」/「bash が単語ごとにどう読むか」). The digit is only in the tooltip. This changes the names of decision 6 of panel-redesign.md.
- **Q2. When the web page hints at POSIX sh.** Only when the shell comes from `#!/usr/bin/env bash` or from no shebang, not from `#!/bin/bash`; never on a bats file. One line after the list (or in place of "No problems"), never a problem. Not chosen: always, or a one-time tip.
- **Q3. The hint in VS Code.** Not now: VS Code's panel shows the quiet marks, and the web page is where the test saw the cost.
- **Q4. What depth 1 shows.** Bash's steps in one line on a word a step changes (expansions, splitting, globbing, tildes). The glob example is open when it is the line's only example, or the cursor's stage has it. Not chosen: a "Steps" toggle beside the depth.
- **Q5. The Copy labels.** "Copy fix" / 「修正をコピー」 on the fix. "Copy as Markdown" / 「Markdown でコピー」 on the panel's header, "Markdown" under the icon where it is narrow. "Copy a link" stays.
- **Q6. The hover card on the web page.** No card from a resting pointer after a click. A click, a paste, typing and Escape close it; a pointer that moves to a word opens it as today. Not chosen: no hover card while the panel is shown.
- **Q7. The phone's grab area and the full height.** A grab strip of 44 px of its own above the tabs row. The full height stops 8 px below the editor's header. On a phone the rename opens from the pencil only.
- **Q8. What a new script resets.** Clear, a whole-script paste into an empty or untouched editor (`untouched`, web/kinds.ts:24) and Open start a new script: the kind from the text (the plain Shell script without a signal), the name untitled, the shell back to Auto, with a toast and Undo. The depth stays.
- **Q9. A fix for `=~` in sh.** No rewrite: no form fits every regex. The text names `case` (only where the regex has a glob form; `^[0-9]+$` has none, though its negation has: `''|*[!0-9]*`) and `expr` (a BRE anchored at the start: `expr "$1" : '[0-9][0-9]*$'`, measured in dash), with those limits.
- **Q10. "In short" for a gloss with parentheses.** A gloss that has parentheses of its own is dropped; the name stays, and the rest of the panel says it. Not chosen: a short gloss for each such command.
- **Q11. A file with no shebang.** It still counts as one that may be sourced: decision 8 of panel-redesign.md stays, and so does the fix `return 1 2>/dev/null || exit 1` there (`stopCommand`, src/rewrite.ts:65, already writes `exit 1` in a file read as a script). The Fix box says in a few words why ("`return` if sourced, `exit` if run").

## 6. How success is measured

The test runs again after U1 to U8 (step U9), with the kit (`ut-kit-2xlT`): new agents with no project context, the same five personas, models, widths and languages, so that each session can be set against its pair in runs 1 and 2.

Changes to the protocol:

- **The tasks stay in one session**, as in runs 1 and 2, so that state kept from one task to the next (2.9) is still tested. One task is added for it: after task 6, paste logins.sh again and say what grep receives.
- **A longer script**: one task on a script of 20 to 40 lines, so that the length and the moves between lines are tested. The new tasks are reported apart from tasks 1 to 6, so that the runs stay comparable.
- **Two agents per cell** (ten users), if the budget allows. With one agent per cell, a cell is one answer, and run 1 to run 2 moved 3 of 30 with no change of the UI: a bar of 27/30 against 22/30 would be close to that noise.

The measures, in the order they decide:

1. **The gate:** every user solves at least 5 of tasks 1 to 6 (both runs: 6/6).
2. **Rated easy** on tasks 1 to 6: at least 90% (27/30, or 54/60 with two agents per cell; run 1 19/30, run 2 22/30). Task 6 easy for at least 80% of the users, task 2 for all. This is the measure the findings move.
3. **Answered from the page:** 30/30 on tasks 1 to 6. As an extra, not in keys/KEYS.md today: whether task 6's run-time effect (falls to `else`) came from the page; it is added to the key as an extra before the run, not as a condition to pass.
4. **The top-3 costs:** no finding of section 2 named by two users or more.
5. **The score:** an average of 9 or more, the goal of panel-redesign.md, section 7. As before, agents anchor on 7, so a run that meets 2 to 4 and scores 8 goes to the maintainer with that evidence.

The baseline is run 2 (main 71cac086). Below the goal, the maintainer decides what follows, as panel-redesign.md, section 7, says.
