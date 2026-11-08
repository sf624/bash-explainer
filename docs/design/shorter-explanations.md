# Shorter explanations

Step U13 of [usability-9.md](usability-9.md): the panel's explanations are long. This page measures where the length comes from on the scripts of usability run 3, says what the users said about it, and weighs three ways to cut it. It ends with the prototype to test in run 5 and the questions for the maintainer.

Status: Tracked in #723. A design to decide on (usability-9.md, Q15): nothing is built before the maintainer has chosen an option. By the maintainer's rule of 2026-11-08, the chosen option is prototyped first, tested in a usability run, and polished only if it helps.

## 1. What is long

### 1.1 How it was measured

- **The build:** the web page of main e1174686 (the build run 3 used), built with `npm run build:web -- --channel=next`.
- **The scripts:** run 3's five task scripts: getopts.sh, backup.sh, logins.sh, args.sh and nightly-backup.sh. That is 52 lines that are not blank or a comment.
- **The panel:** a Playwright script opened each script and put the cursor on each line, as a user does (a tap at 390 px, a click at 1280 px). It then read the panel's height and each row's own height, with the "What the program receives" switch on (the default).
- **The phone:** 390 x 844, touch. The sheet's frame there is 393 px tall, and the panel's header and the line's box take part of it. So "views" below (the height over 393) understate the scrolling on a phone.
- **The desktop:** 1280 x 800. The panel's frame is 688 px tall.
- **The characters:** a second script counted the characters of each part of the row model (`panelUpdate`, src/ui/panelView.ts), in English and Japanese.
- **Where to find them:** the scripts and their data are in the test kit, not in the repository (`ut-kit-2xlT/tools/u13/`).

### 1.2 The numbers

The whole panel, summed over the 52 lines:

| View | Total height | Median line | Lines over one view | Lines over two views |
|---|---|---|---|---|
| 390 px, Overview (en) | 28,357 px | 421 px | 29 | 13 |
| 390 px, Overview (ja) | 28,362 px | 433 px | 29 | 13 |
| 390 px, Word by word (en) | 37,166 px (+31%) | 620 px | 37 | 19 |
| 1280 px, Overview (en) | 20,813 px | 324 px | 9 | 1 |
| 1280 px, Word by word (en) | 28,719 px (+38%) | 463 px | 17 | 1 |

The lines the tasks used. Each cell is the panel's height, then how far the answer's row sits below the top of the panel's content:

| Line | 390 Overview | 390 Word by word | 1280 Overview |
|---|---|---|---|
| logins.sh 1 (tasks 3 to 5: grep's row) | 1,907 px, grep at 500 | 1,213 px (the stages fold) | 1,413 px, grep at 346 |
| backup.sh 2 (task 2) | 1,322 px | 1,757 px | 901 px |
| getopts.sh 2 (task 1: `":hv:o:"`) | 835 px, at 417 | 1,226 px, at 493 | 605 px, at 323 |
| nightly-backup.sh 28 (task 8 b) | 1,001 px | 1,251 px | 717 px |
| nightly-backup.sh 33 (task 8 a: `-mtime`) | 1,403 px, at 757 | 1,821 px, at 931 | 939 px, at 526 |

### 1.3 Where the length comes from

On the phone, in Overview (the default), 85% of the panel's height is the rows. The rest is "In short" (7%), the problems box (2%) and the notes (6%). The rows break down as follows. The heights are for 390 px, Overview, English; the characters are for Overview, English.

| Source | Size | Share |
|---|---|---|
| The rows' texts | 13,278 characters | 45% of the characters |
| The number of rows | 233 rows (4.5 a line; 19 on the `find` line). On a phone each row puts its label above its text, so the most common row is 44 px, against 24 px at 1280 | for the same rows, the panel is 28,357 px at 390 and 20,813 px at 1280 |
| Rows that restate the code | 37 rows, 2,064 px: an option's value on a row of its own ("1: Value for `-mindepth`", 11 rows), the letters under combined options (13), parts of a word in Overview ("+: Word `+`", 13) | 7% |
| bash's steps on a word | 40 lines, 1,215 px. 23 of the 40 have the same words ("parameter expansion → no word splitting or globbing → quote removal"). Only 10 come after a first one on the same line (270 px, 1%) | 4% |
| Long texts said again and again | the command substitution's sentence (6 times, 1,173 characters); "Assign a value to variable `x` (no spaces around `=`)" (9 times); the shebang's paragraph (201 characters, on every script) | part of the 45% |
| "In short" saying the row again | on 9 of the 52 lines, "Runs `find` (search a directory tree …)" above a row that says "Search a directory tree …" | 674 characters |
| A loop's idiom note on each of its lines | args.sh lines 9 to 11 show the same 212-character note three times | part of the 6% |
| Word by word only: the role line | 4,325 px | 12% of Word by word at 390 |
| Word by word only: "Double-quoted string: `$vars` and `$(…)` expand …" | 15 times as a row's second text (said once a line by `sayOnce`, but again on every line), 4 times as a text | 1,957 characters |

What this says:

- The length is mostly in the rows' texts and in the number of rows. It is not in "In short" or the problems box.
- Per-word repetition is real, but small in height. Only 1% of the steps lines repeat within one line. The repetition users felt is across lines: they see the same steps line on every line they read.
- A phone pays about a third more height than a desktop for the same rows (28,357 px against 20,813 px), and a row of one line nearly twice as much (44 px against 24 px).

### 1.4 What the participants said

All ten said the length cost them something. For seven it was among their three costliest problems (usability-9.md, 7.3). Their own words, from the kit's reports of run 3:

- **u21** (beginner, 390): "On line 1 of logins.sh the answer is 2-3 screens down with many nested, expandable blocks; about 3-4 swipes each time. Fine at Overview otherwise." And: "the facts I wanted (what the program receives, glob matches) are 1-3 screens down".
- **u22** (beginner, 390): "Line 22/28 panels run 40+ lines of text (every option, every "bash's steps"), needing scrolling; the useful "In short" is at the top, which helps."
- **u23** (LPIC, 390, ja): "the problem box, fix, and the full pipeline tree come before the word I wanted; I scrolled 2-4 screens." And: Word by word "made it longer but collapsed command rows, so I had to tap to open them."
- **u24** (LPIC, 390, ja): "For logins.sh the panel is long (pipeline example, glob tester, then sort/uniq/head) … For short lines it was fine."
- **u25** (sysadmin, 1280): "For a one-line pipeline the panel is long (several screens with the glob example) … for the other lines the explanation fit on about one screen." Also: "the top "In short" talks about uniq/sort, not grep".
- **u26** (sysadmin, 1280): "Pipelines and long lines gave 60+ rows of option/word detail (grep -rn, tar -czf, find) … Overview is long, I wanted a shorter default."
- **u27** (developer, 1280): "Verbosity per word. Every quoted word repeats "bash's steps: parameter expansion → no word splitting … → quote removal" … It is noise for someone who knows the basics, and it makes rows tall." And: ""In short" and the receives chips at the top usually sufficed".
- **u28** (developer, 1280): "the find line spends a row each on "1 / Value for -mindepth", "+ / Word +", plus §-citations and "bash's steps" on every quoted word. As a skimmer, I had to scroll past restated basics to find the one subtle fact (-mtime rounding)." And: ""Collapse all" helps, but then I lose the useful rows too."
- **u29** (UX, 1280): "each row stacks a description, a quoting lecture, a § link, role lines and "bash's steps" … Small grey underlined labels compete with the answer." And: "On the find line, I scrolled past ~20 rows to reach -mtime … Overview is shorter, but then the examples are hidden."
- **u30** (UX, 1280): "Word by word on dense lines (tar, find) runs past one screen and repeats boilerplate … Overview was mostly enough; the chips row answered most questions without scrolling."

Two things recur. First, the top of the panel ("In short", the receives chips) answered most questions. Second, the one fact a user came for (`-mtime`'s rounding, the glob's matches, grep's arguments) was a screen or more down, behind rows that say what the code already shows.

## 2. Three options

Each option was tried on the built page by changing the panel's rows in the measuring script, before measuring. That is a simulation, not the option built. The numbers are for the 52 lines, in Overview. "Two views" counts the lines whose panel is more than twice the frame.

| Option tried | 390 total | Over two views (of 52) | `find` line, 390 | `-mtime` row at | 1280 total | Over one view |
|---|---|---|---|---|---|---|
| Now | 28,357 px | 13 | 1,403 px | 757 px | 20,813 px | 9 |
| 1. Say it once | 27,618 px (−3%) | 13 | 1,234 px | 649 px | 20,308 px (−2%) | 8 |
| Labels beside the text on a phone, alone | 27,520 px (−3%) | 11 | 1,215 px | 694 px | (no change) | 9 |
| 2. One line per row, the rest on a tap | 21,471 px (−24%) | 6 | 1,002 px | 541 px | 15,195 px (−27%) | 2 |
| 2, with labels beside the text on a phone | 17,966 px (−37%; ja −36%) | 2 | 670 px | 385 px | 15,195 px | 2 |
| 2 and 1, labels beside | 17,761 px (−37%) | 2 | 590 px | 332 px | 14,981 px (−28%) | 2 |
| 3. Fold each command to its headline | 18,084 px (−36%) | 2 | 239 px | (folded) | 13,609 px (−35%) | 2 |

The simulations:

- **Option 1** hid the leaf rows of an option's value and of a word's parts, and drew a quoted word's steps on one line.
- **Labels beside the text** let a row's text sit beside its label when the label is short (CSS `flex: 1 1 12em` on the phone).
- **Option 2** cut every row's text to its first drawn line, and hid the steps lines and the § links.
- **Option 3** hid every row under a command's row.

### 2.1 Option 1: say each thing once

What it changes:

- **An option's value joins its option's row in Overview.** `-mindepth 1` becomes one row, "ignore levels shallower than N", and the value keeps its own row in Word by word. The row model knows the link: the reading tree's role "value of `-mindepth`" (`rolesOf`, src/ui/panelRows.ts), which the argument interpreter gives. No new fact.
- **The parts of a word come in at Word by word.** "Word `+`" and "Concatenation" rows move to depth 2 (`ownDepth`). The combined-options row's own text ("Combined short options `-r` `-f`") moves there too; its letters stay in Overview.
- **A quoted word's steps fold to their one-line summary in Overview** (the `StepsLine.summary` that Word by word already has): parameter expansion inside double quotes counts as not acting, for `actingSteps`. The receives chip (‹value of `$dest`›) already shows the word stays one word. This takes back part of usability-9.md, Q4 (U5).
- **"In short" is not said again by the row.** When the line's sentence only names the one command with its gloss (`lineSentence`, src/linesentence.ts, knows the commands it says), the command's row keeps its badge and receives, and drops the gloss.
- No catalog entry changes. The texts stay; fewer rows show them.

What a reader loses: almost nothing. A value's own row and the word parts are one switch away. The quoted word's steps (u27 used them for task 4: "because it is quoted, no word splitting or globbing; then quote removal. So it is exactly one argument") become a one-line summary to open.

What it gains: −3% at 390, −2% at 1280. It answers the specific complaints of u27 and u28 (the restating rows, the steps on every quoted word), but not the length.

### 2.2 Option 2: one line per row, the rest on a tap

What it changes:

- **Each row shows its label and a lead:** the first part of its text, one line. The rest folds under the row: the rest of the text, the steps line, the § links, and in Word by word the role line and the row's second texts. A tap or click on the row's text, or Enter on it, opens it.
- **The row the cursor is on starts open,** with the rows around it on the path (`RowModel.places` gives the row of the token at the cursor). So the word a reader taps in the editor is explained in full, as today.
- **A row with a warning is never cut.** Its warning parts (`TextPart.level`) show whole.
- **On a phone, a short label sits beside its text.** Alone this saves 3%; with rows of one line it saves another 13%, because most rows then fit on one line beside their label.
- **The model and the catalog (for the build, after the run):** a lead becomes a part of a row's text, from the text's source, not cut by the view. `TokenRow` gets a `lead` (tokenRow is the one record of a row: the panel, the hover, Markdown and the CLI read it). The catalog of token texts (src/messages-tokens.ts) writes an entry as a lead and its rest. A spec's description that is longer than a line (find's `-mtime`, `-maxdepth`) gets a short form beside it (src/dict/). A text with no lead shows whole. A guard test lists the texts longer than a line that have no lead, as a known list that may only shrink (docs/design/sources.md, section 1). The CLI and Markdown keep the whole text; the hover's short form could use the lead later.

What a reader loses:

- **The details at a glance.** The parenthetical facts move behind a tap: `-mtime`'s "(`+7` 8 days or more)" (task 8 a, answered from that row by all ten in run 3), `-maxdepth`'s "put it before tests such as `-type`", the steps of a quoted word (task 4).
- **The fix for that:** the row at the cursor is open, so a reader who taps `-mtime` in the editor sees it whole. A reader who taps the line's start, or scans the panel, must open the row.
- **A cut in the wrong place misleads.** The lead must say something true on its own. That is why the build takes leads from the texts' sources, never from a cut by width.

What it gains: −24% alone, −37% with the phone's labels beside the text. On the phone the lines over two views fall from 13 to 2, and the `-mtime` row comes up from 757 px to 385 px. The desktop lines over one view fall from 9 to 2.

### 2.3 Option 3: fold each command to its headline

What it changes:

- **Every command folds in Overview** to its row (badge, gloss) and its receives line, as a pipeline's stages fold in Word by word since U7 (`foldStages`). A tap or click opens it.
- **A fold opens only on the word at the cursor.** By U7's rule, a stage opens when the cursor moves into it. On a line of one command the cursor is always in it, so nothing would fold. So this option opens only the path to the word under the cursor, which changes the rule the maintainer decided on 2026-11-07 (usability-9.md, U7).
- No catalog change.

What a reader loses: every option's and operand's row is behind a tap or a cursor move. A reader who scans for "the one subtle fact" (u28) must first know which part holds it. u28 said of "Collapse all": "then I lose the useful rows too." u23 said of Word by word's folded commands: "I had to tap to open them."

What it gains: the most, −36% at 390 and −35% at 1280. The `find` line is 239 px until opened.

### 2.4 The recommendation

**Prototype option 2, with the phone's labels beside the text.** Leave option 1's changes to the build, and do not take option 3.

- **Option 2 cuts what the measures say is long:** the rows' texts, 45% of the characters, and the phone's height per row. It keeps every row where it is, so the panel still shows the structure of the line, which the explainer is there to teach (CLAUDE.md, "Explanations"). It follows what users did when it worked: they read the top (In short, receives) and went to one row.
- **Option 1 is right but small.** Once rows are one line, it adds only 1% more on the phone. It belongs in the build because it removes rows that restate the code (u28's complaint). It needs no prototype: it hides no fact.
- **Option 3 saves a little more than option 2 at 1280, and as much at 390.** But it hides every part's text, needs a change to U7's rule, and repeats "Collapse all", which users already found too coarse.

## 3. Prototype for run 5

### 3.1 The smallest change that shows option 2

As run 4 does for U10 to U12, the prototype is a draft PR. Its branch is built into the kit's site for run 5 and is not merged.

- **Where:** the web page's panel only (styles under `html.bx-web`, and the web page's rows in media/panel.js). The VS Code panel, the hover, Markdown and the CLI do not change.
- **Which view:** Overview only. Word by word stays as it is, so that the whole explanation is one switch away (question 2).
- **One line per row:** each row's text is cut to its first line in the view (`line-clamp: 1`), with "…". The steps line and the § links fold with the rest. A tap or click on the text, or Enter or Space on it, opens the row's details (`aria-expanded` on the text, which takes focus); a second one folds them.
- **The cursor's row is open:** the row of the token at the cursor, and the rows on its path, start open (`RowModel.places`).
- **Warnings stay whole:** a row with a warning (`ModelRow.level`) is not cut.
- **Phone labels:** on a phone, a row's text sits beside a short label (`flex: 1 1 12em` in place of `flex-basis: 100%`, media/panel.css, the narrow-panel rules).

What can be rough:

- **The cut is by width, not a lead from the source.** It may stop mid-word. The run tests the shape of the panel, not the wording of leads. A key line notes any answer read from a cut text.
- **Untouched:** animation, Collapse all and Copy as Markdown (which keep the whole text), the hover, and the high-contrast themes.
- **Tests:** the existing suites only, plus one web test that a row opens and closes by click and by key. It is not merged.

What must not be rough:

- **Japanese input and keys:** the IME rule and the keys of CLAUDE.md, "Web page and panel UI". A row's details are reachable by Tab and Enter; focus never lands on `<body>`.
- **Screen readers** hear the whole text of a cut row: the cut is visual, and the row says it is folded.
- **Unchanged:** the problems box, "In short", the receives chips and the open glob example (task 5).

### 3.2 What run 5 should measure

Run 5 is set against run 3: the same five personas, two agents per cell, the same scripts and tasks, 7 and 8 included. The length was not tested in run 4.

- **The panel's length, measured again on the prototype's build** with the script of section 1.1. Expected: about −37% at 390 (from 28,357 px), 2 or fewer lines over two views, and the `-mtime` row within 400 px of the top. If the build is far from the simulation, the cause is found before the run.
- **The length as a cost:** named in the top-3 costs by 7 of 10 in run 3. It helped if one user or none names it (measure 4 of usability-9.md, section 6). Also the answers to "The length of the explanation" (10 of 10 "yes" in run 3), read for "how much".
- **No loss on the tasks whose answer moves behind a tap:**
  - task 1 (getopts' string, run 3 easy 10/10);
  - task 4 (`"$USER"` stays one word, 9/10, read from the steps line);
  - task 8 (a) (`-mtime`'s "8 days or more", from the page by 10/10).

  Each must stay as easy (strict) as in run 3 and answered from the page; tasks 1 to 6 stay 60/60 from the page. The driver logs each opened row, so the report can say who opened which row to answer.
- **No wrong fact from a cut text:** a new line in the key for an answer that quotes a cut lead as the whole fact.
- **Time per session and screenshots per task,** against run 3's 2.3 to 6.0 minutes and 20 to 32 screenshots.

**It helped** if the length is named by at most one user, and no task above loses its easy rating or its answer from the page. Then option 2 is built as section 2.2 says (leads from the sources, with option 1's changes, in both panels). **If the length drops as a cost but a task loses,** the rule for which rows start open is revisited before any build. **If neither,** the prototype is dropped and the maintainer decides between option 1 alone and option 3.

## 4. Questions for the maintainer

1. **Which option to prototype.** Recommended: option 2 with the phone's labels beside the text (section 2.4). The alternatives:
   - option 1 alone: small and safe, −3%;
   - option 3: the most cut, but it changes U7's cursor rule and hides every part.
2. **Word by word in the prototype.** Recommended: unchanged, so that the full explanation stays one switch away. The other choice: the same one-line rows there too (its role lines, 12% of its height, would fold).
3. **The prototype's form.** Recommended: a draft PR built into the kit's site for run 5, not merged, as for run 4. The other choice: merged on the web page behind a setting, so that real users could try it before run 5.
