# Shorter explanations

Step U13 of [usability-9.md](usability-9.md): the panel's explanations are long. This page measures where the length comes from on the scripts of usability run 3, says what the users said about it, and weighs three ways to cut it, with a variant of the second. It ends with the prototype to test in run 5 and the maintainer's decisions.

Status: Tracked in #723. The maintainer chose option 2b on 2026-11-08 (section 4); its prototype for run 5 is the draft PR #758, not to be merged. By the maintainer's rule of 2026-11-08, the chosen option is prototyped first, tested in a usability run, and polished only if it helps.

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

On the phone, in Overview (the default), the rows take 75% of the panel's height. The rest:

- "In short" takes 6%, the problems box 2% and the notes 5%.
- About 12% (3,300 px) is the panel's header, the line's box and the gaps between parts.

The table breaks the rows down. The heights are for 390 px, Overview, English; the characters are for Overview, English.

| Source | Size | Share |
|---|---|---|
| The rows' texts | 13,278 characters | 45% of the characters |
| The number of rows | 233 rows (4.5 a line; 19 on the `find` line). On a phone each row puts its label above its text, so the most common row is 44 px, against 24 px at 1280 | for the same rows, the panel is 28,357 px at 390 and 20,813 px at 1280 |
| Rows that only restate the code | about 11 rows, such as "Word `+`", "Word `/etc`" and "Value for `-mindepth`". Hiding them, and drawing a quoted word's steps on one line, saves 739 px | under 3% |
| bash's steps on a word | 40 lines, 1,215 px. 23 of the 40 have the same words ("parameter expansion → no word splitting or globbing → quote removal"). Only 10 come after a first one on the same line (270 px, 1%) | 4% |
| Long texts said again and again | the command substitution's sentence (6 times, 1,173 characters); "Assign a value to variable `x` (no spaces around `=`)" (9 times); the shebang's paragraph (201 characters, on 3 of the 5 scripts) | part of the 45% |
| "In short" saying the row again | on 9 of the 52 lines, "Runs `find` (search a directory tree …)" above a row that says "Search a directory tree …" | 674 characters |
| An idiom note on each line of its loop | getopts.sh shows the same 225-character note on 9 lines (2 to 10); args.sh shows a 212-character note on lines 9 to 11 | part of the 5% |
| Word by word only: the role line | 4,325 px | 12% of Word by word at 390 |
| Word by word only: "Double-quoted string: `$vars` and `$(…)` expand …" | 15 times as a row's second text (said once a line by `sayOnce`, but again on every line), 4 times as a text | 1,957 characters |

Not every short row restates the code:

- The 13 letters under combined options say real things: "create an archive", "gzip".
- So do the 3 `$OPTARG` rows.
- So do several rows of a word's parts: "Positional parameter", a tilde expansion, a variable's value.

What this says:

- The length is mostly in the rows' texts and in the number of rows. It is not in "In short" or the problems box.
- Per-word repetition is real, but small in height. Only 1% of the steps lines repeat within one line. The repetition users felt is across lines: they see the same steps line on every line they read.
- A phone pays about a third more height than a desktop for the same rows (28,357 px against 20,813 px), and a row of one line nearly twice as much (44 px against 24 px).

### 1.4 What the participants said

**In run 3, all ten said the length cost them something.** Seven named it among their three costliest problems (usability-9.md, 7.3). But:

- **It was never anyone's first cost.** It came second or third, mostly "a little" or "moderately". u28: "Short lines (tasks 1–5) were fine." u29: "Moderate cost."
- **The seven named three different causes:**
  - the phone's half-height sheet and its small editor (u21, u23, u24);
  - "In short" being about the wrong commands, and the glob example far down (u25);
  - per-row verbosity (u27, u28, u29). Only these three named the rows' texts.

Their own words, from the kit's reports of run 3:

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

**The same users relied on the details that a shorter panel would hide:**

- **The steps lines.** All ten answered task 4 (`"$USER"` stays one argument) from the steps line under `"$USER"` ("bash's steps: parameter expansion → no word splitting or globbing (quoted) → quote removal"). Some praised the steps lines and the § links outright:
  - u23: "What worked: … "bash の手順: パラメータ展開 → … → クォート除去" on every word";
  - u24 (score 8): "It teaches the grammar the way LPIC wants (what bash does vs what the command gets, steps of expansion, § links)";
  - u25: "What worked: … The "receives:" chips and "bash's steps" lines showing what bash does to a word."
- **The letter rows of getopts.** Five called the per-letter breakdown of `":hv:o:"` (task 1) exactly right. u29: "The per-letter breakdown of the optstring is excellent"; u23, u24, u27 and u28 said the same, and u22 answered from it.
- **The `-mtime` row.** Users reached it by tapping or clicking line 33, or with the driver's `line N` (u21, u24, u25, u26, u28, u29, u30). None tapped `-mtime` itself. They read "+7 8 days or more" in the row's text.
- **The findings of runs 1 and 2.** Answers behind depth 2 or in closed details were a top-3 cost for 8 users (usability-9.md, 2.3). That is why U5 (Q4) brought the steps lines to depth 1.

**Run 4 (u31 to u38) asked the same question** of a build with U10 to U12:

- Two said "Mostly no" (u33, u34; both scored 8). u33's score sentence praised "the chips, "bash が処理", "bash の手順", § links"; u34's praised "bash の手順" and the § links.
- Five said yes, from "slightly" to "moderately": u31, u32, u35, u36, u37 ("The top of the panel (In short, problems, status box) answered almost every task without scrolling. The tree below it is long").
- u38 said "yes, a little": "one row per option value ("Value for -mindepth"). I only needed "In short" and the receives row".
- The length was u37's first cost: "Too much text, and examples I did not need". The examples it names (the worked date example, the glob demo) are not cut by the options below.
- It was u35's and u38's second. u38 named the density: "coloured left bars at several nesting levels, solid and dashed chips, badges, and § links on every row".

Two things recur. First, the top of the panel ("In short", the receives chips, the line's notes) answered most questions. Second, the one fact a user came for (`-mtime`'s rounding, the glob's matches, grep's arguments) sat a screen or more down. But the steps lines and the letter rows that make the panel long are also what users answered from and praised.

## 2. Three options

Each option was tried on the built page by changing the panel's rows in the measuring script, before measuring. That is a simulation, not the option built. The numbers are for the 52 lines, in Overview.

- **Option 1** hid the leaf rows of an option's value and of a word's parts, and drew a quoted word's steps on one line.
- **Labels beside the text:** on a phone, a row's text sits beside its label when the label is short (CSS `flex: 1 1 12em`).
- **Option 2** cut each row's own words to one line, and hid the row's second texts, § links, steps line and value line. As the design says:
  - the receives line stays;
  - the line's first row stays whole, as when a tap puts the cursor at the line's start;
  - a row with a warning stays whole.
- **"Tapped `-mtime`"** keeps the `-mtime` row and the rows around it whole.
- **Option 2b** is option 2 with the steps lines left visible.
- **Option 3** hid every row under a command's row.

An earlier version of this table cut every row, the cursor's and the receives lines included, and overstated option 2. An independent check, re-measured with each line's first row open, found 20,971 px (−26%) at 390 and 16,822 px (−19%) at 1280. The table now keeps the receives lines and the warning rows as the design does.

| Option tried | 390 total | Over two views (of 52) | `find` line, 390 | `-mtime` row at (line start / tapped) | 1280 total | Over one view |
|---|---|---|---|---|---|---|
| Now | 28,357 px | 13 | 1,403 px | 757 px | 20,813 px | 9 |
| 1. Say it once | 27,618 px (−3%) | 13 | 1,234 px | 649 px | 20,308 px (−2%) | 8 |
| Labels beside the text on a phone, alone | 27,520 px (−3%) | 11 | 1,215 px | 694 px | (no change) | 9 |
| 2. One line per row, the rest on a tap | 24,076 px (−15%) | 8 | 1,089 px | 629 px | 17,405 px (−16%) | 5 |
| 2, with labels beside the text | 21,691 px (−24%; ja −23%) | 5 | 802 px | 517 / 575 px | 17,405 px (−16%) | 5 |
| 2b. As 2, steps lines kept, labels beside | 23,035 px (−19%) | 6 | 922 px | 577 / 636 px | 18,257 px (−12%) | 5 |
| 3. Fold each command to its headline | 18,084 px (−36%) | 2 | 239 px | (folded) | 13,609 px (−35%) | 2 |
| 3, with labels beside the text | 18,578 px (−34%) | 2 | 263 px | (folded) | 13,609 px | 2 |

### 2.1 Option 1: say each thing once

What it changes:

- **An option's value joins its option's row in Overview.** `-mindepth 1` becomes one row, "ignore levels shallower than N", and the value keeps its own row in Word by word. The row model knows the link: the reading tree's role "value of `-mindepth`" (`rolesOf`, src/ui/panelRows.ts), which the argument interpreter gives. No new fact.
- **The parts of a word that only restate it come in at Word by word.** "Word `+`" and "Concatenation" rows move to depth 2 (`ownDepth`). Parts that say something ("Positional parameter", a tilde expansion) stay. The combined-options row's own text ("Combined short options `-r` `-f`") moves to depth 2. Its letters stay in Overview, since they say what each letter does.
- **A quoted word's steps fold to their one-line summary in Overview** (the `StepsLine.summary` that Word by word already has): parameter expansion inside double quotes counts as not acting, for `actingSteps`. The receives chip (‹value of `$dest`›) already shows the word stays one word. This takes back part of usability-9.md, Q4 (U5).
- **"In short" is not said again by the row.** When the line's sentence only names the one command with its gloss (`lineSentence`, src/linesentence.ts, knows the commands it says), the command's row keeps its badge and receives, and drops the gloss.
- No catalog entry changes. The texts stay; fewer rows show them.

What a reader loses:

- A value's own row and the word parts that restate the code: they are one switch away.
- The steps of a quoted word become a summary to open. All ten answered task 4 from them in run 3.

What it gains: −3% at 390, −2% at 1280. It answers the specific complaints of u28 and u38 (the "Value for" rows), but not the length.

### 2.2 Option 2: one line per row, the rest on a tap

What it changes:

- **Each row shows its label and a lead:** the first part of its text, one line.
- **The rest folds under the row:** the rest of the text, the steps line, the § links, the value line, and in Word by word the role line and the row's second texts. A tap or click on the row's text, or Enter on it, opens it.
- **The receives line always shows.**
- **A row with a warning is never cut.** Its warning parts (`TextPart.level`) show whole. The simulation keeps such rows whole but does not separate their effect.
- **The row the cursor moves to opens,** with the rows on its path (`RowModel.places` gives the row of the token at the cursor). It must follow U7's rule for stages (usability-9.md, U7): it opens on a move of the cursor with no edit (`PanelLine.moved`), never when the line is drawn anew, so that typing and a paste open nothing. On 2026-11-07 the maintainer replaced an opening that depended on where the cursor was with that rule; this option brings a cursor-dependent opening back, for one row.
- **On a phone, a short label sits beside its text.** Alone this saves 3%. With option 2 it saves another 8% of today's height, because many rows then fit on one line beside their label.
- **The model and the catalog (for the build, after the run):**
  - A lead becomes a part of a row's text, from the text's source, not a cut by the view. `TokenRow` gets a `lead` (tokenRow is the one record of a row: the panel, the hover, Markdown and the CLI read it).
  - The catalog of token texts (src/messages-tokens.ts) writes an entry as a lead and its rest.
  - A spec's description that is longer than a line (find's `-mtime`, `-maxdepth`) gets a short form beside it (src/dict/).
  - A text with no lead shows whole.
  - A guard test lists the texts longer than a line that have no lead, as a known list that may only shrink (docs/design/sources.md, section 1).
  - The CLI and Markdown keep the whole text.

What a reader loses:

- **The steps lines again.** Option 2 folds them back behind a tap. U5 (Q4) brought them to depth 1 after 8 users of runs 1 and 2 named answers behind depth 2 or closed details as a top-3 cost (usability-9.md, 2.3).
  - In task 4 a tap on line 1 puts the cursor at `grep`, so the `"$USER"` row is off the cursor's path: its steps would fold. All ten users of run 3 answered task 4 from that line.
- **The parenthetical facts.** `-mtime`'s "(`+7` 8 days or more)" is the answer to task 8 (a). In run 3 every user who said how they got there reached the row by the line (a tap, a click or `line N` on line 33), and none tapped `-mtime`. So under option 2 that fact would be behind a tap for all of them. The same goes for `-maxdepth`'s "put it before tests such as `-type`".
- **The § links on every row,** which u24, u33 and u34 named as what they came for. u38 named the same links as density.
- **A cut in the wrong place misleads.** The lead must say something true on its own. That is why the build takes leads from the texts' sources, never from a cut by width. A summary that is already looser than its row (the `find` summary "more than "$KEEP_DAYS" days ago", being fixed in #725) would be all a reader sees.

What it gains: −15% alone, −24% with the phone's labels beside the text (ja −23%). On the phone the lines over two views fall from 13 to 5. The `-mtime` row comes up from 757 px to 517 px (575 px when tapped). At 1280 the cut is −16%, and the lines over one view fall from 9 to 5.

### 2.2b Option 2b: one line per row, the steps lines kept

As option 2, but the steps lines stay visible on every row that has one, as do the receives lines and the rows with a warning. Only the rest of a row's text, its § links and its second texts fold. This keeps the answers of task 4 and the U5 decision; the parentheticals (`-mtime`'s rounding) still fold.

What it gains: −19% at 390 with labels beside the text, 6 lines over two views, the `-mtime` row at 577 px (636 px when tapped). At 1280 the cut is −12%.

### 2.3 Option 3: fold each command to its headline

What it changes:

- **Every command folds in Overview** to its row (badge, gloss) and its receives line, as a pipeline's stages fold in Word by word since U7 (`foldStages`). A tap or click opens it.
- **The fold must survive a tap on the line.** By U7's rule, a line is drawn with its stages folded wherever the cursor is, and a stage opens when the reader moves the cursor into it with no edit. A tap or click on a line is such a move, into the line's command. So on every line a reader taps, its command would open, and the cut would be gone. To keep the fold, a move would have to open only the path to the word under the cursor, which changes the rule the maintainer decided on 2026-11-07.
- No catalog change.

What a reader loses: every option's and operand's row is behind a tap or a cursor move, the getopts letters and the steps lines included. A reader who scans for "the one subtle fact" (u28) must first know which part holds it. u28 said of "Collapse all": "then I lose the useful rows too." u23 said of Word by word's folded commands: "I had to tap to open them."

What it gains: the most. −36% at 390 alone, −34% with labels beside the text. At 1280 it is −35%, 19 points more than option 2's −16%. The `find` line is 239 px until opened.

### 2.4 The recommendation

**Prototype option 2 in the form of 2b, with the phone's labels beside the text.** The steps lines, the receives lines and the rows with a warning stay visible. Leave option 1's changes to the build, and do not take option 3.

- **The case for a cut is weaker than the first version of this page said.**
  - The length was a cost for most users but never the first.
  - Its seven mentions in run 3 bundle three causes: the phone's sheet, "In short", and per-row verbosity. Only three users named the rows' texts.
  - The details that make the panel long are what users answered from and praised.
- **Option 2b cuts the rows' texts,** 45% of the characters, and the phone's height per row.
  - It keeps every row where it is, so the panel still shows the structure of the line, which the explainer is there to teach (CLAUDE.md, "Explanations").
  - It keeps the steps lines that carried task 4 and that U5 brought to depth 1.
  - The cut is modest: −19% at 390, −12% at 1280.
- **Option 2 as first written cuts more:** −24% at 390, −16% at 1280. But it folds the steps lines again, against the evidence of runs 1 to 3.
- **Option 1 is right but small.** It belongs in the build, because it removes the rows that only restate the code (u28's and u38's complaint). It needs no prototype: it hides no fact.
- **Option 3 cuts the most,** −34% to −36%. But it hides every part's text, the getopts letters and the steps included. It needs U7's rule changed, and it repeats "Collapse all", which users already found too coarse.

## 3. Prototype for run 5

### 3.1 The smallest change that shows option 2b

As run 4 does for U10 to U12, the prototype is a draft PR. Its branch is built into the kit's site for run 5 and is not merged.

- **Where:** the web page's panel only (styles under `html.bx-web`, and the web page's rows in media/panel.js). The VS Code panel, the hover, Markdown and the CLI do not change.
- **Which view:** Overview only. Word by word stays as it is, so that the whole explanation is one switch away (section 4, decision 2).
- **One line per row:** each row's own words are cut to their first line in the view (`line-clamp: 1`), with "…". The row's second texts, § links and value line fold with the rest. A tap or click on the text, or Enter or Space on it, opens the row's details (`aria-expanded` on the text, which takes focus); a second one folds them.
- **What stays visible:** the receives line, the steps line, and every part of a row with a warning (`ModelRow.level`).
- **The row the cursor moves to opens:** the row of the token at the cursor, and the rows on its path (`RowModel.places`). They open on a move with no edit (`PanelLine.moved`), as U7's stages do. A line drawn anew, by typing or a paste, opens nothing.
- **Phone labels:** on a phone, a row's text sits beside a short label (`flex: 1 1 12em` in place of `flex-basis: 100%`, media/panel.css, the narrow-panel rules).

What can be rough:

- **The cut is by width, not a lead from the source.** It may stop mid-word. The run tests the shape of the panel, not the wording of leads. A key line notes any answer read from a cut text.
- **Untouched:** animation, Collapse all and Copy as Markdown (which keep the whole text), the hover, and the high-contrast themes.
- **Tests:** the existing suites only, plus one web test that a row opens and closes by click and by key. It is not merged.

What must not be rough:

- **Japanese input and keys:** the IME rule and the keys of CLAUDE.md, "Web page and panel UI". A row's details are reachable by Tab and Enter; focus never lands on `<body>`.
- **Screen readers** hear the whole text of a cut row: the cut is visual, and the row says it is folded.
- **Unchanged:** the problems box, "In short", the receives chips and the open glob example (task 5).

What must come first: the `find` summary's fix (#725) must be merged into the build. A summary looser than its row, above a row whose fact is folded, would mislead.

### 3.2 What run 5 should measure

**The baseline.** Run 5's build carries U10 to U12 as well (U11 changes the top of the panel), so run 3 is not a clean baseline for it.

- **For the users' answers:** run 4 (u31 to u38, 46f7b6e0, with the prototypes of U10 to U12).
- **For the panel's length:** the same build as run 5 without the U13 prototype, measured with the kit's script.

Run 3 stays the reference for the counts of the length's causes.

What to measure:

- **The panel's length,** measured again on the prototype's build with the script of section 1.1, against the baseline build. The simulation says about −19% at 390, 6 or fewer lines over two views, and the `-mtime` row near 580 px from the top. If the build is far from the simulation, the cause is found before the run.
- **The length as a cost, by its cause.** Counting "length" as one finding mixes three causes (section 1.4); the phone's sheet in particular is not touched by this prototype. So each mention in the top 3 is sorted:
  - per-row verbosity (run 3: u27, u28, u29; run 4: u35, u37, u38);
  - the phone's sheet and editor;
  - "In short" or the examples.

  The prototype helped if per-row verbosity is named by one user or none. The answers to "The length of the explanation" are also read for "how much".
- **No loss on the tasks whose answer moves behind a tap or stays beside it:**
  - task 1 (the getopts string; run 3 easy 10/10);
  - task 4 (`"$USER"` stays one word; 9/10, from the steps line, which stays visible);
  - task 8 (a) (`-mtime`'s "8 days or more"; from the page for 10/10, a fact that folds).

  Each must stay as easy (strict) as in the baseline and answered from the page; tasks 1 to 6 stay 60/60 from the page. The driver logs each opened row, so the report can say who opened which row to answer.
- **No wrong fact from a cut text:** a new line in the key for an answer that quotes a cut lead as the whole fact.
- **Time per session and screenshots per task,** against the baseline's (run 3: 2.3 to 6.0 minutes, 20 to 32 screenshots).

**It helped** if per-row verbosity is named by at most one user, and no task above loses its easy rating or its answer from the page. Then option 2b is built as sections 2.2 and 2.2b say (leads from the sources, with option 1's changes, in both panels). **If verbosity drops as a cost but a task loses,** the rule for what stays visible is revisited before any build. **If neither,** the prototype is dropped and the maintainer decides between option 1 alone and option 3.

## 4. The maintainer's decisions (2026-11-08)

The maintainer decided the three questions of the first version of this page as follows.

1. **Which option to prototype:** option 2 in the form of 2b, with the phone's labels beside the text (section 2.2b).
   - One line per row, with the rest on a tap.
   - The receives lines, the steps lines and the rows with a warning stay visible.
   - The cursor's row opens on a move only.
   - On a phone, a short label sits beside its text.

   Not chosen: option 1 alone (small and safe, −3%); option 3 (the most cut, but it changes U7's cursor rule and hides every part).
2. **Word by word in the prototype:** unchanged, so that the full explanation stays one switch away. Not chosen: one-line rows there too.
3. **The prototype's form:** a draft PR built only for run 5, not merged (#758). This follows the standing rule: UI changes from usability findings are prototyped first, tested again, and polished only if they helped. The maintainer sees the prototype before anything is merged. Not chosen: merged on the web page behind a setting.
