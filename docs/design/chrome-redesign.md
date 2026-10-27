# Chrome redesign: the web page around the panel

The plan that turns the chrome prototype (round 8) into real PRs. The "chrome" is everything on the web page around the explanation panel: the app bar, the editor's header, the Problems strip, the toasts, the settings, the panel's header and, on a phone, the bottom sheet. Agreed with the maintainer on 2026-10-27.

Status: planned. No step started.

The panel's own content is the panel redesign ([panel-redesign.md](panel-redesign.md)). The two series meet at the view slot (panel-redesign.md, 6.1). Section 7 below says who owns what, and which step must land before which.

## 1. Goal

The page is calm on a desktop and usable with a thumb on a phone. Each control has one place and one name. The file, its type and its shell belong to the editor. The explanation's controls belong to the panel. On a phone the explanation is a sheet over the editor, and typing never hides where you are.

The end point is the roadmap's usability test (panel-redesign.md, section 7). Its users drive this page, at 1280 and 390 px. The chrome must not cost them points.

Measured by a UX reviewer (an agent, from screenshots): today's page scores 5.5 on a desktop, 4 on a phone, 5 overall. Round 8 scores 8, 7.5 and 8.

## 2. What round 8 is

Branches `proto/chrome-1` to `proto/chrome-8`; round 8 is d12ccc26, the base of this plan. It sits on main at 81816d31. Against main it touches 22 files, +8,920 lines (`git diff origin/main...origin/proto/chrome-8 --stat`). Most of it is web/page.css (+5,278), web/main.ts (+1,522), web/settings-dialog.ts (+482), web/chrome-text.ts (351, new), web/panel-bridge.ts (+303), web/word-wrap.ts (265, new) and web/chrome.ts (241, new).

The kit of round 8 describes every screenshot and lists every control: `~/.cache/explain-bash-tmp/chrome-8/kit.md`, with the images, `shots.log` (measured boxes) and `inventory.json` (each control's size and hit area). Today's page has its own kit: `~/.cache/explain-bash-tmp/ux-kit/kit.md`. Neither is committed.

What it shows:

- **A quiet app bar.** ≡, the logo and name, then at the right "Copy a link", ⚙, GitHub and "Install for VS Code". Nothing about the file or the view.
- **An editor header that owns the file.** Open, Save, the file name (muted while never saved; ● after it when there are unsaved changes; a click renames it in place), one chip "Shell script · bash (auto)" and ⋯ (Rename…, Copy the script, Load the sample, Clear the editor). The chip opens one popover with two radio lists, File type and Shell.
- **A Problems strip** under the editor: "› Problems ⚠ 5 ⓘ 6", and at the right "Ln 20 · 1/11" with ‹ › (F8, Shift+F8). A click opens the list.
- **A panel header**: the tabs Explanation and Reference, a view slot of fixed width with the view control, Collapse, and Copy as Markdown.
- **Wrap between shell words** in the editor and in the panel's line box, with ↪ on the rows after the first (web/word-wrap.ts). On by default.
- **Toasts with icons** (↶ Undo, ✓ done, ⓘ a refusal), paused while the pointer is on them.
- **Settings in sections** (Common, then Examples, Checks, Editor, Data), with a search and "Jump to" links.
- **On a phone**, a bottom sheet over the editor with one tabs row at every height (Explanation, Problems, Reference, and the view control), Read | Edit in the strip above the editor, 44 px targets, and care for the on-screen keyboard: the app bar hides, and the sheet folds to a one-line summary of the cursor's line. At full height the app bar slides away.

### Screenshots, in words

Desktop shots are 1280×800; phone shots are an iPhone 13 (390×844 CSS px, 3×). Cursor on line 8 of the sample, `grep -rn "ERROR $USER" ./src 2>&1 | sort -u > errors.txt && echo "done: $(date +%F)" || exit 1`, unless noted.

- **d-rest.** The app bar is 44 px: ≡, logo, then "Copy a link", ⚙, GitHub, "Install for VS Code". The editor header: Open, Save, "untitled.sh" (muted), and the chip "Shell script · bash (auto) ⌄" on a quiet round fill, then ⋯. Line 8 wraps in two rows; the second starts at `"done: $(date +%F)"` with ↪ in the gutter. At the bottom the strip "› Problems ⚠ 5 ⓘ 6" and ‹ ›. The panel header: "Explanation | Reference", the view slot with a dropdown "① What it does ⌄", Collapse as an icon, "Copy as Markdown" in words. The line box "Ln 8" wraps the same way as the editor.
- **d-scope-popover.** The chip clicked, cursor on line 20. A popover under the chip with two columns: FILE TYPE (Shell script, Dockerfile, Makefile, GitHub Actions / GitLab CI, package.json, Markdown, Python, Jenkinsfile, bats) and SHELL ("Auto: bash (from #!)", then bash, POSIX sh, dash, busybox ash, yash, ksh93, mksh, zsh). The checked items are radios. The strip's right end reads "Ln 20 · 1/11".
- **d-settings.** A sheet from the right, 576 px wide, over the panel: "Jump to: Common Examples Checks Editor Data" as links, a search field, then Common (Language, Theme, Notes on idioms, Pitfalls, Worked examples, Hover, Wrap long lines, Animations in the panel). The sheet covers the explanation that these settings change: a fault the review found.
- **p-sheet-half.** The phone, line 8 tapped. The app bar (≡, logo, ⚙), then the strip "[Read | Edit] untitled.sh ✎ … Script · bash ⌄". The editor wraps line 8 in three rows. The sheet starts at y 380. Its header is one 48 px row: "Explanation · 8 | ⚠ 11 | Ref | Depth 1 ⌄". The explanation starts 2 px under it.
- **p-keyboard-summary.** Edit mode, line 20, the keyboard open (emulated: a grey box over the bottom 336 px). No app bar; the strip is at the top. Above the keyboard, one 47 px row: "Ln 20 ⚠ Pitfall: set -e is on here, so the scrip… ⌃". A tap on it closes the keyboard and opens the sheet at half on line 20.

To capture them again: build the page from `proto/chrome-8` with `npx tsx scripts/build-web.ts --outdir=<dir>/site`, then run `scripts/shots.mjs` from the kit's folder through its `scripts/run.sh`. That script sets the test tools' environment (`~/.cache/explain-bash-tools`), the CJK fonts (`FONTCONFIG_FILE`), a memory cap, `FUNCNEST`, and runs through `~/.claude/bin/heavy`. Its paths are those of the session that made them; fix them first. Step C0 commits a capture script, so each later step takes its screenshots the same way.

## 3. Decisions

From the maintainer, 2026-10-27:

1. The prototype rounds stop. Round 8 is the base design.
2. It is rebuilt as a series of real PRs (section 6), with the fixes below. Nothing is merged from the prototype branches as they are.
3. Implementation starts after roadmap items 1 to 7, and fits with the panel redesign's order (section 7). Studies may run in parallel (a measure, a sketch, a prototype that lands nothing).

The fixes of the last review (round 8), part of the design:

4. **One depth control at every width.** "Depth" is always written. The segments carry digits, and only the selected level shows its name: `Depth [1 Does] [2]`. The slot keeps the width of the longer name, so a press moves nothing. Below about 240 px of slot it collapses to "Depth 1 ⌄", a menu with both levels. On a phone it is the same component, in a bordered 44 px pill. The short names are the panel plan's: "1 Does" / "2 Reads", 「1 何をする」/「2 読まれ方」 (panel-redesign.md, decision 6); the full names are the tooltip and the accessible name. Round 8's three forms (segments, a named dropdown, "Depth 1 ⌄") and the stacked 130% form go.
5. **A real peek on a phone.** About 96 px: the tabs row, and under it a one-line summary of the cursor's line. It is the same row as the summary shown above the keyboard (section 2).
6. **The Problems tooltip shows no internal locator.** Round 8's tooltip drew "94:7:rm-empty-variable-root": a 0-based line and column. The cause: web/problem-list.ts keeps each item's identity in `data-key`, and the page's tooltip (web/chrome.ts) draws any `data-key` as a keyboard shortcut. The identity gets an attribute of its own; the tooltip shows "Ln 95: …" and the rule id only.
7. **Settings do not cover the explanation they change.** Side by side, the settings sheet opens over the editor (from the left, as the menu does), and the panel stays in view and live. On a phone, see open question 1.
8. **Two toast placements, one look.** A toast shows next to the control that caused it when that control is far from the editor's bottom (Copy a link: under the button). Every other toast shows above the Problems strip (on a phone, above the sheet's tabs row). Both have the same fill, border, shadow and icon. Round 8's third look (docked in the strip, white with an accent border) goes. A toast never covers the explanation.
9. **The phone tabs' words.** "Explanation" with a quiet "Ln 8" after it (not "· 8"). Problems as its counts by level, "⚠5 ⓘ6", with the accessible name "Problems: 5 warnings, 6 caveats" (the level words from the catalog). Reference as "Ref" where the row is short.
10. **Hover cards have a capped height.** A long card scrolls inside; it never runs off the window. It sits under the whole wrapped line (round 8), never over it.
11. **The panel's tools are labelled.** Collapse and Copy as Markdown always show a word. Where the panel is narrow, the word goes under the icon at a smaller size. Never an icon alone, and never "MD" alone.
12. **One wording for the automatic shell.** A short form, "bash (auto)" / 「bash（自動）」, in the chip. A long form, "Auto: bash (from #!)" / 「自動: bash（#! 行から）」, in the popover and in Settings › Shell. The source is one of "from #!", "from the file name", "default". Both forms come from one function, so the page has one wording. Round 8 had three ("bash (auto)", "Auto: bash (from #!)", "Auto (from #!, file name or default)").

## 4. What to keep, what to rewrite

The prototype was built fast, in eight rounds of overrides. It has hacks and loosened tests. Each step takes the parts it needs and brings them to the bar of section 5.

| Part | Verdict | Why, and how |
| --- | --- | --- |
| The layout and the looks of round 8, with the fixes of section 3 | Keep | The base design (decision 1). The screenshots of each step are compared with the kit's. |
| web/word-wrap.ts: `shellWords`, its own lexer of shell words | Rewrite | A second reader of shell syntax. The word bounds come from the syntax tree (src/syntax/tree.ts), as a pure function in src/ui, unit-tested over the corpus. A line the parser cannot read breaks at blanks only (C1). |
| web/word-wrap.ts: the CodeMirror plugin (`white-space: pre` per word, the hanging indent, the ↪ gutter) | Keep, test | It works. Web tests at three widths, both languages, CJK fonts (C1). |
| The line box's wrap (the page splits the panel's text nodes into `.bx-gap` and `.bx-any` spans) | Rewrite | The page reaches into the panel's DOM. The panel draws its line box (`#line`, filled by media/panel.js) with word spans itself, from the same word bounds sent with the line, and follows the `editor.wrap` setting that the page sends (C1). |
| The row width estimated from the font's average character width | Rewrite | Wrong with a proportional fallback font (the kit's known limit). The plugin measures a row, or leaves the break to the browser inside `pre` runs (C1). |
| web/hover.ts: the card under the whole wrapped line (`lineRows`, `getCoords`) | Keep, test | Plus the capped height (decision 10) (C1). |
| src/settings.ts: `editor.wrap` on by default, its new description | Keep | C1. |
| web/problem-list.ts: the line column, two-line messages, the rule id from a 520 px pane | Keep | Plus the fix of decision 6 (C2). |
| The strip's position "Ln 20 · 1/11", ‹ ›, F8 / Shift+F8 | Keep | C2. |
| Toasts: icons, timers paused on hover or focus, "More" / "Why?" bubbles | Keep | C3. |
| Toasts: three placements and two looks; `splitToast` cutting texts | Rewrite | Two placements, one look (decision 8). The placement rule is a pure function of the toast's cause, in src/ui (C3). |
| "Load the sample" over the user's script: an Undo toast instead of `confirm()` | Keep | C3. |
| App bar, editor header, file name model (muted, ●, rename in place), ⋯ | Keep | C4. |
| web/main.ts (+1,522, to 2,457 lines) | Rewrite | Split by part (file identity, toasts, sheet, keyboard), each module under 1,000 lines (C0 extends test/file-length.test.ts to web/). |
| web/chrome.ts: `popover` (menus and small dialogs, arrows, Escape, focus) | Keep, test | One helper for every popover. A11y web tests (roles, focus return) (C4). |
| `.no-ring`: no focus ring after a pointer close, kept after a key | Keep | C4. |
| web/chrome-text.ts (351 lines of page texts) | Move | Into web/text.ts, the page's one table of texts. Japanese checked by test/ja-style.test.ts, extended to web/ (C0). |
| The chip and its popover; the hidden selects kept for the panel bridge | Keep the control, rewrite the plumbing | The bridge reads the scope from the page's state, not from hidden `<select>`s (C5). |
| The chip's shortening steps (`fitScope`: drop "(auto)", "Script · bash", icons, "bash", the name to the menu) | Rewrite | One pure rule in src/ui that takes the measured widths and gives the form; unit tests of every step; one web test per step (C5). |
| web/settings-dialog.ts: sections, search, Jump to links, "More" inline, 44 px rows on touch | Keep, test | C6. |
| `settingShort` (shorter page copy of some settings, in web/chrome-text.ts) | Move | Into src/settings.ts beside each setting's long text: one source per setting (C6). |
| web/panel-bridge.ts: the slot's proxy that presses the panel's own buttons by id (`tp-back`, `step-menu`) | Drop | The slot is drawn from `viewControl` (panel-redesign.md, P1); a press sends the state (C7). |
| The view control's three forms and their widths (292, 196, 96 px) | Rewrite | One component (decision 4). Its form at each room is a pure rule in src/ui, shared with VS Code's panel header (C7). |
| web/panel-page.css hooks into the panel (`bx-steps-sticky`, `bx-wrap`, `bx-line-clamp`, `--bx-marks`) | Rewrite | The panel owns its DOM. What the page needs (a sticky steps row until P8, the line box's clamp) becomes the panel's own behaviour, driven by state or settings (C1, C7). |
| The phone's sheet: snaps, the grabber as the whole header, the one-time hint, the app bar away at full, 44 px boxes drawn smaller | Keep | C8a. |
| The phone tabs' fit steps (`snug`, `noline`, `icons`, `compact`), measured once per language and text size | Rewrite | One pure rule from measured widths, in src/ui, as for the chip; decision 9's words (C8a). |
| The keyboard (`setUpKeyboard`, the visual viewport, `kb-open`) and the summary row | Keep, test | Both emulations of the kit become web tests (C8b). |
| The summary row's text (the line's first problem, else the first part) | Rewrite | A pure function in src/ui, which P5 and P7b improve (section 7) (C8b). |
| web/page.css (+5,278 lines) | Rewrite | Eight rounds of overrides. Keep the final look; write each rule once, in the step that needs it; colours as roles of web/theme.css. |
| Changed tests: test/web-settings.test.ts, web-phone, web-resize, document-setup | Review each | A changed expectation stays only as a wanted change of that step. |
| The kit's scripts (`shots.mjs`, `probe.mjs` with the hit areas) | Keep, as tools | The capture script in scripts/, the hit-area check in test/support (C0). |

## 5. The bar for every step

- Every test passes, web tests included. A web test that fails is fixed, not loosened. The old web tests that target today's layout are updated in the step that changes it (the table at the end of this section).
- 100% line and branch coverage of `src/`, measured in CI. Coverage does not measure web/ (`.c8rc.json` includes src only). So every decision of the chrome lives in `src/ui/` as a pure function (a form from measured widths, a placement, a text, the word bounds), as src/ui/opening.ts already does for the page; web/ only measures, draws and wires events.
- Texts come from tables: the page's texts from web/text.ts, the facts from the catalog (src/messages.ts: the level marks and words). English and Japanese have the same keys. Japanese follows docs/japanese-style.md; test/ja-style.test.ts reads web/ from C0 on.
- Layouts are checked with the CJK fonts of CI at 390, 640 and 1280 px, in both languages, and with long names (CLAUDE.md, "Tests that run bash", last item). A layout must not depend on how wide words are in a font: each step's fit rule is tested with the fonts of CI and with measured widths in unit tests. Phone steps also check 130% text (a 300 px CSS viewport, as the kit does).
- Web tests type with `keyboard.insertText`, wait for CodeMirror's selection layer, and feed tools through files (CLAUDE.md).
- On a phone, every control's hit area is at least 44×44 px (the hit-area check of C0, from C4 on). Side by side, at least 24×24.
- Each step adds the keyboard path of what it adds (focus order, Escape, focus return), checked by test/web-a11y.test.ts.
- Speed: typing in a 2,000-line script stays fluid. A key press costs the wrap plugin and the chrome under a budget (proposed: 16 ms at the 95th percentile on CI's machine, measured in a web test from C1 on).
- Screenshots go with each visual PR, before and after, taken with C0's capture script. The author looks at them and measures positions before pushing.
- Each step that changes the phone lists the real-device checks it needs (section 8). The maintainer does them before merge.
- A fresh reviewer (a subagent with no context) reviews C1, C7, C8a and C8b before merge.

The old web tests, by the step that changes what they test:

| Test | Step |
| --- | --- |
| test/web-hover.test.ts | C1 |
| test/web-levels.test.ts (the strip's counts and icons) | C2 |
| test/web-files.test.ts, test/web-paste.test.ts (their toasts) | C3, then C4 (the file name) |
| test/web-topbar.test.ts, test/web-menu.test.ts, test/web-share.test.ts, test/web-opening.test.ts | C4 |
| test/web-kind.test.ts (the kind picker), the shell select in test/web-topbar.test.ts | C5 |
| test/web-settings.test.ts | C6 |
| test/web-reference.test.ts, the view switch in test/web-tree.test.ts | C7 |
| test/web-phone.test.ts, test/web-resize.test.ts | C8a |
| test/web-storage.test.ts | each step that adds a stored key |
| test/web-a11y.test.ts | every step |
| test/web-tree-steps.test.ts | kept by C7 (the steps stay in the panel's own row); removed by P8 |

## 6. Steps

Each step is a PR from the latest main, useful on its own. A step with letters is several PRs, in that order. The CHANGELOG lines are drafts; details go in docs/changes/unreleased.md.

### C0. Groundwork for the page's tests

What: test/ja-style.test.ts reads web/ too (and fixes what it finds in web/text.ts). test/file-length.test.ts covers web/*.ts, with web/main.ts at its count today as a ceiling that may only go down. A hit-area check in test/support (each visible control, `elementFromPoint` from its centre, as the kit's inventory measured). A capture script in scripts/ that builds the page and takes the screenshots of a step at the three widths, in both languages, with the CJK fonts (run through `~/.claude/bin/heavy`, with a memory cap).

Users: Japanese wording fixes on the page, if the check finds any. CHANGELOG (Fixed), only then: "Japanese wording on the web page follows the project's style."

Tests: the checks themselves; the hit-area check run on today's page reports today's sizes, not a failure (it gates from C4 on).

Risks: small.

### C1. Wrap between shell words, and hover cards off the line

What: the editor wraps a long line only between shell words, with a hanging indent and ↪ on the rows after the first. The word bounds come from the syntax tree: `wrapRuns(tree, line)` in src/ui gives the runs that must not break (a word with its quotes, `$( )`, `${ }`, `<( )`, backquotes; a comment's words). A run wider than a row breaks at its own inner blanks, and as a last resort anywhere. A line the parser cannot read breaks at blanks. While typing, lines changed since the last tree break at blanks until the next tree. The panel's line box wraps by the same runs, which the explanation carries and media/panel.js draws, up to three rows then a fade; a click opens it whole. `editor.wrap` is on by default; its description says what it covers. Hover cards sit under the whole wrapped line (above it when there is no room), at the part's x, with a capped height (decision 10). docs/design/hover.md, "Web page", says so.

CHANGELOG (Changed): "The web page wraps long lines between shell words, in the editor and in the explanation's line box, with ↪ on the rows after the first. Wrapping is on by default; before, it was off, and when on, a line broke anywhere." (Fixed): "Hover cards on the web page no longer cover the line they explain, and a long card scrolls inside."

Tests: unit tests of `wrapRuns`: over the corpus (sample.sh, the fixtures, snippets.json), no break falls inside a word of the tree. The tree is already checked against bash-ast, so this checks the runs against bash's words. Web tests at 390, 640 and 1280 px, both languages, CJK fonts: no sideways overflow; the rows of line 8 as in the kit; ↪ on each continuation row; the setting off gives one row that scrolls. Hover: the card's top at the line's bottom with the pointer on each row; its height under the cap on a long card. The typing budget on a 2,000-line script.

Risks: the plugin's cost on long scripts (it works on the visible lines only). The line box is the panel's, which P7c restyles; whichever lands second keeps the word spans. VS Code's own panel gets the wrapped line box too; it is a change there, said in the CHANGELOG line if users see it.

### C2. The Problems strip

What: the Problems list folds into a 32 px strip: "› Problems", the count per level with its icon (from the level table, so three levels give three counts), and at the right the position "Ln 20 · 1/11" with ‹ › (F8, Shift+F8). The list opens on a click, with the line in a fixed column and the message on up to two lines; the rule id shows from a 520 px pane. The tooltip has the whole message, "Ln 95: …", and the rule id (decision 6). The editor gets the room of the folded list. Help's list of shortcuts names F8.

CHANGELOG (Changed): "Problems on the web page fold into a strip with their counts. ‹ › and F8 / Shift+F8 go to the next and previous problem, and the strip shows where you are (Ln 20 · 1/11). Before, the list was open under the editor by default."

Tests: the strip's counts equal the problems of the document, per level; F8 from the last problem wraps to the first; the position on a line with two problems; the tooltip of every item has a 1-based line, and no `data-key` of the list reaches a tooltip. Widths and languages as in section 5.

Risks: users who read the list open lose it at first. Whether the open or folded state is remembered is decided here (proposed: remembered).

### C3. Toasts: two placements, one look

What: one toast component with an icon (↶, ✓, ⓘ), one look, and two placements (decision 8). The rule is `toastPlace(cause)` in src/ui: next to the control when the control is far from the editor's bottom, else above the Problems strip. Timers: 4 s, 8 s with an action, paused while the pointer or the focus is on it. A longer text goes behind "More" or "Why?". "Load the sample" over the user's script loads it and offers Undo, instead of asking first.

CHANGELOG (Changed): "Messages on the web page (Link copied, Opened, Saved) show next to what caused them, with an icon, and stay while the pointer is on them. Loading the sample over your script offers Undo instead of asking first."

Tests: each toast of the page placed by the rule, at three widths; never over the panel's frame or the editor's cursor line; the timers with the pointer on and off; Undo restores the text, the file name and the kind. The Undo path with the keyboard.

Risks: an action toast covers the last rows of the editor for 8 s (the kit's known limit). Accepted; it never covers the cursor's line, as tested.

### C4. The app bar and the editor's header

What: the app bar keeps ≡, the logo and name, "Copy a link" (its toast under it), ⚙, GitHub and Install (from 1100 px). The editor's header gets Open, Save (words from a 481 px pane, icons below), the file name model (muted while never saved or opened; ● after it with unsaved changes; no dot on Save; a click or ⋯ › Rename… renames it in place) and ⋯ (Rename…, Copy the script, Load the sample, Clear the editor). The menu is grouped: Script, Share and Explanation (stacked only), Preferences, Help, About; its first row is the file name. The first-run hint and the empty editor's block (Paste, Open, Load the sample) are round 8's. Focus rings follow the input (`.no-ring` after a pointer close). The type and shell pickers stay in the bar until C5; the view switch until C7.

CHANGELOG (Changed): "The web page's top bar is quieter: Copy a link, settings, GitHub and Install. The editor's own header holds Open, Save, the file name (click it to rename; ● marks unsaved changes) and ⋯."

Tests: the old bar's tests rewritten for the new places (the table of section 5); rename with the keyboard and the mouse, Escape restores; ● after an edit, gone after Save; the menu's groups at each width; the hit-area check on a phone; Help's shortcuts.

Risks: the first PR that moves many controls; the screenshots of the three widths go in the PR. The share-link tests change with the button.

### C5. The file type and shell chip

What: one chip right of the file name, "Shell script · bash (auto)", at every width, on a quiet fill. It opens one popover with two radio lists, File type and Shell (and the yq flavour when the script uses yq); a bottom sheet on a phone. The wording of the automatic shell comes from one function (decision 12). The shortening steps come from one rule in src/ui fed with measured widths (drop "(auto)", "Script · bash", Open and Save as icons, "bash", the name to the menu). The kind and shell pickers leave the app bar and the menu. The panel bridge reads the scope from the page's state.

CHANGELOG (Changed): "One button above the editor shows the file type and the shell ("Shell script · bash (auto)") and opens both lists. Before, they were two pickers: the type in the top bar, the shell there only from 1200 px wide, else in the menu."

Tests: unit tests of the shortening rule and of the wording (every source, both languages); web tests: arrows move in each list, the checked item has the focus, Escape returns the focus to the chip; a pick re-explains the line; each step at the width where it starts, en and ja, with long file names; the popover stays on screen in a narrow pane.

Risks: users who chose a shell in the menu look for it there. The menu's Script group keeps a row "File type and shell…" that opens the same control.

### C6. Settings

What: the settings in sections: Common first (with Wrap long lines and Animations in the panel), then Examples, Checks, Editor and Data, folded, each opened by "Jump to". A search. Descriptions of two lines with "More" inline; whole on touch. Option labels in words; the VS Code keys only with "Show VS Code setting names". Side by side, the sheet opens over the editor, and the panel stays live (decision 7). The shorter page copy of some settings moves into src/settings.ts beside the long text.

CHANGELOG (Changed): "Settings on the web page come in sections, with a search and links to each section. On a wide window they open over the editor, so the explanation they change stays in view."

Tests: test/web-settings.test.ts rewritten: each setting still changes what it changed (its existing assertions); a change shows in the panel while the sheet is open, side by side; search finds by title and by key; Jump to opens and scrolls; 44 px rows on touch; the Shell select's wording from decision 12.

Risks: small.

### C7. The panel's header and the depth control

Needs P1 (panel-redesign.md): the slot is drawn from `viewControl`.

What: the panel's header: the tabs Explanation and Reference, the view slot, Collapse and Copy as Markdown, each labelled (decision 11). The slot draws one component from `viewControl` (decision 4). Its form at a given room is `viewControlForm(control, room, lang)` in src/ui, so VS Code's panel header can use the same rule. An option with a digit shows the digit, and its name only when selected; an option without one shows its name. Until P8, `viewControl` returns Meaning | Reading without digits, so the slot shows both names. Reading's eight steps stay in the panel's own row (sticky under the line box, the panel's own behaviour), never in the page's header. The Reference tab hides the line box, and the slot keeps its room, unseen. The view switch leaves the app bar and the menu.

CHANGELOG (Changed): "The explanation's controls are in the panel's own header: the tabs, the view, Collapse and Copy as Markdown, each with a word. Before, the view switch and Copy were in the top bar."

Tests: unit tests of `viewControlForm` (each form at its room, both languages, with and without digits). Web tests: the slot's width is the same in every state of a width (each option selected, Reference); the header does not overflow at 640 to 1440 px, en and ja, CJK fonts; a press changes the panel and is kept after a reload (with P1's test); Collapse and Copy keep a word at every width.

Risks: P8 changes the data to depths; the fit test runs again then. The 240 px threshold is measured with the real short names, not set by hand.

### C8. The phone's sheet and keyboard

Two PRs, released together (no release between them):

- **C8a. The sheet.** On a phone (and a touch screen without hover up to 1024 px held upright), the explanation is a bottom sheet over the editor, with three heights: peek, half and full. Its header is one 48 px row at every height: the tabs (decision 9) and the depth pill (C7's component), the same boxes at every height. The whole header is the grabber: a tap cycles the heights, a drag moves the sheet, arrow keys too; a one-time hint at the first full sheet. At full the app bar slides away and comes back below. The strip above the editor: Read | Edit, the file name and the chip, 44 px boxes. Problems is a tab (the desktop strip is not shown). Toasts sit above the sheet's tabs row. The tabs' fit is one rule in src/ui fed with measured widths.
- **C8b. The keyboard and the peek.** While the keyboard is open over the editor in Edit mode, the app bar hides and the sheet folds to one summary row of the cursor's line, just above the keyboard. The peek is the tabs row and the same summary row (about 96 px; decision 5). A tap on the row opens the sheet at half (and closes the keyboard). The row's text is `summaryRow(explanation, lang)` in src/ui: the line's first problem by level, else the first part's label and summary (section 7 for how P5 and P7b change it).

CHANGELOG (Changed), C8a: "On a phone, the explanation is a sheet over the editor: tap its bar for half or full height. Read and Edit switch between reading and typing. Before, the screen was split into two halves, the editor and the explanation." (New), C8b: "On a phone, a one-line summary of the cursor's line stays above the keyboard and in the folded sheet; a tap shows the explanation."

Tests: the tabs' boxes identical at every height and tab, en, ja and 130%; every hit area at least 44×44 at each height, in the scope sheet, the settings and the menu; the app bar's position at full and half; the editor's cursor line stays in view as the sheet moves. C8b: both keyboard emulations of the kit as web tests (iOS: the visual viewport shrinks; Android: the window shrinks): the summary row's box at the keyboard's top, the cursor's line in view, a tap gives half and no focus in the editor. Unit tests of `summaryRow`.

Risks: the biggest change on a phone, and the emulation is not the device. The maintainer's checks of section 8 gate both PRs.

### C9. Clean-up and the last measure

What: what the steps left unread (old ids, CSS rules, stored keys). README "The web page" rewritten for the new layout, in both languages. The README images re-recorded once, with P10 of the panel plan (whichever lands second does it). The UX reviewer's protocol runs once more on main, as a check before the usability test, with the kit's scripts.

Users: no CHANGELOG line, unless the clean-up changes what users see.

Tests: test/file-length.test.ts; the coverage gate; the README image checks.

## 7. With the panel redesign

Who owns what:

| Part | Owner | Notes |
| --- | --- | --- |
| The view state (`depth`, `receives`; today `view`, `step`) | The panel | panel-redesign.md, 6.1. The page keeps it in storage and sends it. |
| `viewControl(state, lang)`: the label, the options, their words | The panel (P1) | The page never knows what the options mean. |
| The slot's place, its width and its form at each room | The chrome (C7) | From `viewControlForm` in src/ui. |
| Keys 1, 2 and W | The panel | The page binds none; Help names them "in the panel". |
| The line box and its wrap | The panel | Wrapped by C1's runs, following the page's `editor.wrap`. |
| Reading's steps row (until P8) | The panel | Sticky in the panel's frame; never in the page's header. |
| The switch "What the program receives", the Key | The panel | In the panel's own row (6.1). |
| The phone's tabs row and its depth pill | The chrome (C8a) | The pill is C7's component. |
| The summary row's text | src/ui (C8b) | P5 and P7b improve it. |
| Toasts, the strip, the app bar, the editor's header, settings, the sheet | The chrome | |

The order. Both series start after roadmap items 1 to 7. They touch different files (the chrome web/ and src/ui's page rules; the panel's steps P2 to P6 src/ and the dictionary), so they may run side by side. These must hold:

- C0 comes first in the chrome series. The usability test's baseline (panel-redesign.md, section 7) runs on main before C1 and P1, so it measures today's page.
- C1 to C6 need no panel step. They may land before, between or after P1 to P6.
- P1 lands before C7: C7 draws the slot from `viewControl`.
- C7 lands before P8: at P8 the slot shows the depths, through C7's component, in the page and as the same rule in VS Code's header.
- C7 lands before C8a: the phone's depth pill is C7's component.
- C8b's summary row: once P7b lands, the row shows a problem's headline instead of its cut text; once P5 lands, a line with no problem shows its "In short" sentence. P5 and P7b change `summaryRow` and its tests in the same PR.
- C1 and P7c both touch the line box: the second to land keeps the word spans.
- C9 lands with or after P10: one README re-recording for both.

A proposed sequence: C0, then C1 to C6 beside P1 to P6; C7 after P1; C8a and C8b; then P7 to P10; C9. The usability test runs after C9 and P10.

## 8. The phone checks on real devices

The emulations of the kit do not show a real keyboard, a finger's drag or the system's menus. Before C8a and C8b merge, the maintainer checks on an iPhone (Safari) and an Android phone (Chrome), and notes the result in the PR:

1. The keyboard: its real height; the summary row sits right on top of it; the cursor's line stays in view; iOS does not pan the page under a fixed bar.
2. Closing the keyboard (the row's tap, the system's button, a swipe): the sheet comes back as it was.
3. Dragging the sheet with a finger: it follows, settles on a height, and does not scroll the editor under it.
4. A tap on the grabber, the tabs and the pill with a thumb: no wrong target hit.
5. The app bar at full height: it slides away and back without a jump; the browser's own toolbars do not cover the strip.
6. The system's paste menu in the editor, and "Paste" in the empty editor's block (the clipboard permission).
7. Open a file and save one (Files on iOS, the download on Android); rename the file in the strip.
8. The chip's sheet and the settings at full height; Done and the back gesture.
9. Larger text (Android's font size, Safari's page zoom at 130%): the tabs row and the strip fit.
10. Turned to landscape, and an iPad upright and turned (with and without a hardware keyboard).

C1 (the wrap on a phone), C4 (rename on touch) and C5 (the chip's sheet) need checks 6 to 8 where they apply.

## 9. Open questions for the maintainer

1. **Settings on a phone.** The sheet covers the whole screen, so a change to the explanation shows when it closes. Is that acceptable, or should the settings take half the screen over the editor, with the explanation's sheet in view?
2. **Three counts in the phone's tabs row.** With three note levels (roadmap; PR #419), the Problems tab may read "✖1 ⚠4 ⓘ6". If that does not fit the row at 130% text, should the tab show the highest level's count only, with all three in its accessible name?
3. **The word under a narrow tool.** Decision 11 puts a small word under Collapse's and Copy's icons in a narrow panel. Is "Copy MD" / 「MD をコピー」 acceptable there, or should Copy as Markdown move to ⋯ below some width?
4. **The Problems list on the desktop.** Round 8 folds it by default. Should it open by default when the script has a warning (as a first visit shows the sample's problems)?
