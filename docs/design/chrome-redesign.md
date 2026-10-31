# Chrome redesign: the web page around the panel

The plan that turns the chrome prototype (round 8) into real PRs. The "chrome" is everything on the web page around the explanation panel: the app bar, the editor's header, the Problems strip, the toasts, the settings, the panel's header and, on a phone, the bottom sheet. Agreed with the maintainer on 2026-10-27, and revised after an independent review the same day.

Status: C0 is done (#531), C1a too (#539). C1b to C6 started early (decided by the maintainer 2026-10-31), beside the three note levels; C7 on wait for the levels. [sources.md](sources.md), stage SB: C2 waits for the level table (SB1), C5 for `detectShell`'s source (SB4); the other early steps go ahead.

The panel's own content is the panel redesign ([panel-redesign.md](panel-redesign.md)). The two series meet at the view slot (panel-redesign.md, 6.1). Section 7 below says who owns what, and which step must land before which.

## 1. Goal

The page is calm on a desktop and usable with a thumb on a phone. Each control has one place and one name. The file, its type and its shell belong to the editor. The explanation's controls belong to the panel. On a phone the explanation is a sheet over the editor, and typing never hides where you are.

The end point is the roadmap's usability test (panel-redesign.md, section 7). Its users drive this page, at 1280 and 390 px. The chrome must not cost them points.

Measured by a UX reviewer (an agent, from screenshots): today's page scores 5.5 on a desktop, 4 on a phone, 5 overall. Round 8 scores 8, 7.5 and 8.

## 2. What round 8 is

Branches `proto/chrome-1` to `proto/chrome-8`; round 8 is d12ccc26, the base of this plan. It branched from main at 81816d31. Against main it touches 22 files: 8,920 lines added and 274 removed (`git diff --numstat origin/main...origin/proto/chrome-8`). Most of it is:

- web/page.css: +5,272 −6, to 7,349 lines (2,083 on main);
- web/main.ts: +1,424 −98, to 2,261 lines (935 on main);
- web/settings-dialog.ts: +426 −56;
- web/panel-bridge.ts: +273 −30;
- web/panel-page.css: +262;
- new files: web/chrome-text.ts (351 lines), web/word-wrap.ts (265) and web/chrome.ts (241).

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

- **d-rest.** The app bar is 44 px: ≡, logo, then "Copy a link", ⚙, GitHub, "Install for VS Code". The editor header: Open, Save, "untitled.sh" (muted), and the chip "Shell script · bash (auto) ⌄" on a quiet round fill, then ⋯. Line 8 wraps in two rows; the second starts at `"done: $(date +%F)"` with ↪ in the gutter. At the bottom the strip "› Problems ⚠ 5 ⓘ 6" and ‹ ›. The panel header (panel 633 px): "Explanation | Reference", the view slot (196 px) with a dropdown "① What it does ⌄", Collapse as an icon, "Copy as Markdown" in words (157 px). The line box "Ln 8" wraps the same way as the editor.
- **d-scope-popover.** The chip clicked, cursor on line 20. A popover under the chip with two columns: FILE TYPE (Shell script, Dockerfile, Makefile, GitHub Actions / GitLab CI, package.json, Markdown, Python, Jenkinsfile, bats) and SHELL ("Auto: bash (from #!)", then bash, POSIX sh, dash, busybox ash, yash, ksh93, mksh, zsh). The checked items are radios. The strip's right end reads "Ln 20 · 1/11".
- **d-settings.** A sheet from the right, 576 px wide, over the panel: "Jump to: Common Examples Checks Editor Data" as links, a search field, then Common (Language, Theme, Notes on idioms, Pitfalls, Worked examples, Hover, Wrap long lines, Animations in the panel). The sheet covers the explanation that these settings change: a fault the review found.
- **d-toast-share-link.** "Copy a link" clicked. The toast "✓ Link copied. The script is in the part after #, …" (420×49) lies under the button, at (607, 46). It covers the panel's header (tabs, view slot, Collapse) and the editor header's chip: a fault the plan's review found (decision 8).
- **p-sheet-half.** The phone, line 8 tapped. The app bar (≡, logo, ⚙), then the strip "[Read | Edit] untitled.sh ✎ … Script · bash ⌄". The editor wraps line 8 in three rows. The sheet starts at y 380. Its header is one 48 px row: "Explanation · 8 | ⚠ 11 | Ref | Depth 1 ⌄". The explanation starts 2 px under it.
- **p-keyboard-summary.** Edit mode, line 20, the keyboard open (emulated: a grey box over the bottom 336 px). No app bar; the strip is at the top. Above the keyboard, one 47 px row: "Ln 20 ⚠ Pitfall: set -e is on here, so the scrip… ⌃". A tap on it closes the keyboard and opens the sheet at half on line 20.

To capture them again: build the page from `proto/chrome-8` with `npx tsx scripts/build-web.ts --outdir=<dir>/site`, then run `scripts/shots.mjs` from the kit's folder through its `scripts/run.sh`. That script sets the test tools' environment (`~/.cache/explain-bash-tools`), the CJK fonts (`FONTCONFIG_FILE`), a memory cap, `FUNCNEST`, and runs through `~/.claude/bin/heavy`. Its paths are those of the session that made them; fix them first. Step C0 commits a capture script with no such paths, so each later step takes its screenshots the same way.

## 3. Decisions

From the maintainer, 2026-10-27:

1. The prototype rounds stop. Round 8 is the base design.
2. It is rebuilt as a series of real PRs (section 6), with the fixes below. Nothing is merged from the prototype branches as they are.
3. Implementation starts after the roadmap's three note levels (C2 reads the level table; changed 2026-10-31, from "items 1 to 7"). Changed again 2026-10-31: C0 to C6 start early, beside the levels; C7 on wait for them. It fits with the panel redesign's order (section 7). Studies may run in parallel (a measure, a sketch, a prototype that lands nothing).

The fixes of the last review (round 8), part of the design. Decisions 4 and 6 to 12 were revised after the plan's review:

4. **One depth control at every width.** It is one component. Its label and its options come from `viewControl` (panel-redesign.md, 6.1). From P8 on, the label is "Depth" and the options are the two depths. Before P8, the options are Meaning | Reading, without digits, and the label is not "Depth" (C7). An option with a digit shows the digit; only the selected option also shows its name: `Depth [1 Does] [2]`. The slot keeps the width of the longer name, so a press moves nothing. Below about 240 px of slot, the control is a menu, "Depth 1 ⌄", with both levels. On a phone it is the same component, in a bordered 44 px pill. The short names are the panel plan's: "1 Does" / "2 Reads", 「1 何をする」/「2 読まれ方」 (panel-redesign.md, decision 6). The full names are the tooltip and the accessible name. Round 8's three forms go (segments, a named dropdown, "Depth 1 ⌄"), and so does its stacked 130% form.
5. **A real peek on a phone.** About 96 px: the tabs row, and under it a one-line summary of the cursor's line. It is the same row as the summary shown above the keyboard (section 2).
6. **The Problems tooltip shows no internal locator.** Round 8's tooltip drew "94:7:rm-empty-variable-root": a 0-based line and column. The cause: round 8's web/problem-list.ts keeps each item's identity in `data-key`, and its tooltip (web/chrome.ts) draws any `data-key` as a keyboard shortcut. The leak is in the prototype only: main has no web/chrome.ts, and its problem list sets no `data-key`. So it needs no CHANGELOG line. The fix: the tooltip reads the shortcut from `aria-keyshortcuts`, which round 8 already sets beside `data-key` (and shows it as "Ctrl", not "Control"). That is one source, and no `data-key` (the list's, the settings rows') can reach a tooltip. The tooltip shows "Ln 95: …" and the rule id only.
7. **Settings do not cover the explanation they change.** Side by side, the settings sheet opens over the editor (from the left, as the menu does), and the panel stays in view and live. The sheet is never wider than the editor's pane: at the narrowest side-by-side width, round 8's 576 px is capped to the pane. On a phone the settings take the whole screen (section 9, 1).
8. **One toast placement, one look.** Every toast shows above the Problems strip (on a phone, above the sheet's tabs row). Every toast has the same fill, border, shadow and icon. Round 8's other two placements go: docked in the strip (white, with an accent border), and under the "Copy a link" button. That last toast lay over the panel's header (d-toast-share-link). Instead, "Copy a link" confirms in place: its button reads "✓ Copied" for about 2 s, and the screen reader hears "Link copied". The privacy sentence ("The script is in the part after #, which browsers do not send to the server.") is the button's tooltip and accessible description. A toast never covers the explanation or the panel's header. It never hides the editor's cursor line either (C3).
9. **The phone tabs' words.** "Explanation" with a quiet "Ln 8" after it (not "· 8"). Problems as its counts by level, "⚠5 ⓘ6", with the accessible name "Problems: 5 warnings, 6 caveats" (the level words from the catalog). A level with no problem is not shown. When the counts still do not fit, the tab shows only the highest level that has problems, its mark and count (section 9, 2). The accessible name always has every count. Reference as "Ref" where the row is short.
10. **Hover cards have a capped height.** A card is at most min(50vh, 420 px) high (420 px is today's cap, in web/hover.ts). A longer card scrolls inside, with the pointer and with the keyboard; it never runs off the window. It sits under the whole wrapped line (round 8), never over it. The card stays while the pointer moves toward it across the line's later rows (a short grace period, as menus have). Round 8 lost it there: the second row's words took the hover over (the kit's known limit).
11. **The panel's tools are labelled.** Collapse and Copy as Markdown always show a word. Where the panel is narrow, the word goes under the icon at a smaller size: "Collapse" and "Copy" / 「コピー」 (section 9, 3). "Copy as Markdown" stays the tooltip and the accessible name. Never an icon alone, never "MD", and never moved into ⋯.
12. **One wording for the automatic shell.** A short form, "bash (auto)" / 「bash（自動）」, in the chip. A long form, "Auto: bash (from #!)" / 「自動: bash（#! 行から）」, in the popover, which is about this file. Settings › Shell is a preference for every script (the `shell` setting), so it reads "Auto (now: bash, from #!)", with the Japanese from the same function (docs/japanese-style.md). The source is one of "from #!", "from the file name", "default". Every form comes from one function, so the page has one wording. Round 8 had three ("bash (auto)", "Auto: bash (from #!)", "Auto (from #!, file name or default)").

## 4. What to keep, what to rewrite

The prototype was built fast, in eight rounds of overrides. It has hacks and loosened tests. Each step takes the parts it needs and brings them to the bar of section 5.

| Part | Verdict | Why, and how |
| --- | --- | --- |
| The layout and the looks of round 8, with the fixes of section 3 | Keep | The base design (decision 1). The screenshots of each step are compared with the kit's. |
| web/word-wrap.ts: `shellWords`, its own lexer of shell words | Rewrite | A second reader of shell syntax. The word bounds come from the syntax tree (src/syntax/tree.ts), as a pure function in src/ui, unit-tested over the corpus. A line the parser cannot read breaks at blanks only (C1a). |
| web/word-wrap.ts: the CodeMirror plugin (`white-space: pre` per word, the hanging indent, the ↪ gutter) | Keep, test | It works. Web tests at three widths, both languages, CJK fonts (C1a). |
| The line box's wrap (the page splits the panel's text nodes into `.bx-gap` and `.bx-any` spans) | Rewrite | The page reaches into the panel's DOM. The panel draws its line box (`#line`, filled by media/panel.js) with word spans itself, from the runs sent in the panel's update (C1b). |
| The row width estimated from the font's average character width | Rewrite | Wrong with a proportional fallback font (the kit's known limit). The plugin measures a row, or leaves the break to the browser inside `pre` runs (C1a). |
| web/hover.ts: the card under the whole wrapped line (`lineRows`, `getCoords`) | Keep, test | Plus the cap and the grace period (decision 10). The placement is a pure function in src/ui (C1a). |
| src/settings.ts: `editor.wrap` on by default, its new description | Keep | C1a. |
| web/problem-list.ts: the line column, two-line messages, the rule id from a 520 px pane | Keep | Plus the fix of decision 6 (C2). |
| The strip's position "Ln 20 · 1/11", ‹ ›, F8 / Shift+F8 | Keep | The next and previous problem, with wrap-around, and the position text are a pure function in src/ui (C2). |
| Toasts: icons, timers paused on hover or focus, "More" / "Why?" bubbles | Keep | The timers are a pure state in src/ui (C3). |
| Toasts: three placements and two looks; `splitToast` cutting texts | Rewrite | One placement, one look (decision 8). Copy a link confirms in its own button (C3, C4). |
| "Load the sample" over the user's script: an Undo toast instead of `confirm()` | Keep | C3. |
| App bar, editor header, file name model (muted, ●, rename in place), ⋯ | Keep | The file name's state is a pure function in src/ui (C4). |
| web/main.ts (935 lines on main; 2,261 in the prototype) | Rewrite | Split by part (file identity, toasts, sheet, keyboard), each module under 1,000 lines (C0 extends test/file-length.test.ts to web/). |
| web/chrome.ts: `popover` (menus and small dialogs, arrows, Escape, focus) | Keep, test | One helper for every popover. A11y web tests (roles, focus return) (C4). |
| web/chrome.ts: the tooltip | Keep, fix | It reads the shortcut from `aria-keyshortcuts`, not from `data-key` (decision 6; C2). |
| `.no-ring`: no focus ring after a pointer close, kept after a key | Keep | C4. |
| web/chrome-text.ts (the prototype's 351 lines of page texts; main has none, its texts are in web/text.ts, 168 lines) | Move | Into web/text.ts, the page's one table of texts. Japanese checked by test/ja-style.test.ts, extended to web/ (C0). |
| The chip and its popover; the hidden selects kept for the panel bridge | Keep the control, rewrite the plumbing | The bridge reads the scope from the page's state, not from hidden `<select>`s (C5). |
| The chip's shortening steps (`fitScope`: drop "(auto)", "Script · bash", icons, "bash", the name to the menu) | Rewrite | One fit rule in src/ui gives the candidate forms in order, widest first; the page takes the first that fits. Unit tests of the list; one web test per step (C5). |
| web/settings-dialog.ts: sections, search, Jump to links, "More" inline, 44 px rows on touch | Keep, test | C6. |
| `settingShort` (shorter page copy of some settings, in web/chrome-text.ts) | Move | Into src/settings.ts beside each setting's long text: one source per setting (C6). |
| web/panel-bridge.ts: the slot's proxy that presses the panel's own buttons by id (`tp-back`, `step-menu`) | Drop | The slot is drawn from `viewControl` (panel-redesign.md, P1); a press sends the state (C7). |
| The view control's three forms and their widths (292, 196, 96 px) | Rewrite | One component (decision 4). Its candidate forms come from a fit rule in src/ui, used by the page and by VS Code's panel header (C7). |
| web/panel-page.css hooks into the panel (`bx-steps-sticky`, `bx-wrap`, `bx-line-clamp`, `--bx-marks`) | Rewrite | The panel owns its DOM. What the page needs (a sticky steps row until P8, the line box's clamp) becomes the panel's own behaviour, driven by state or settings (C1b, C7). |
| The phone's sheet: snaps, the grabber as the whole header, the one-time hint, the app bar away at full, 44 px boxes drawn smaller | Keep | The snap after a drag (position and speed → peek, half or full) is a pure function in src/ui (C8a). |
| The phone tabs' fit steps (`snug`, `noline`, `icons`, `compact`), measured once per language and text size | Rewrite | One fit rule in src/ui gives the candidate forms in order, as for the chip; decision 9's words (C8a). |
| The keyboard (`setUpKeyboard`, the visual viewport, `kb-open`) and the summary row | Keep, test | Whether the keyboard is open, from the visual viewport's numbers, is a pure function in src/ui. Both emulations of the kit become web tests (C8b). |
| The summary row's text (the line's first problem, else the first part) | Rewrite | A pure function in src/ui, which P5 and P7b improve (section 7) (C8b). |
| web/page.css (2,083 lines on main; 7,349 in the prototype, +5,272) | Rewrite | Eight rounds of overrides. Keep the final look; write each rule once, in the step that needs it (checked by stylelint from C0); colours as roles of web/theme.css. |
| Changed tests: test/web-settings.test.ts, web-phone, web-resize, document-setup | Review each | A changed expectation stays only as a wanted change of that step. Round 8 loosened at least one: `if (await yes.count()) await yes.click();` in web-settings. |
| The kit's scripts (`shots.mjs`, `probe.mjs` with the hit areas) | Keep, as tools | The capture script in scripts/, the hit-area check in test/support (C0). |

## 5. The bar for every step

- Every test passes, web tests included. A web test that fails is fixed, not loosened. The old web tests that target today's layout are updated in the step that changes it (the table at the end of this section).
- 100% line and branch coverage of `src/`, measured in CI. Coverage does not measure web/ (`.c8rc.json` includes src only). So every decision of the chrome lives in `src/ui/` as a pure function, as src/ui/opening.ts already does for the page. web/ only measures, draws and wires events. The pure functions:
  - the word runs of a line (C1a);
  - the hover card's place and height, from the line's rows and the window (C1a);
  - the next and previous problem with wrap-around (F8, Shift+F8), and the position text "Ln 20 · 1/11" (C2);
  - the toast's timer: 4 s, 8 s with an action, paused while the pointer or the focus is on it, at least 2 s more after both leave (C3);
  - the file name's state: muted, ●, renamed (C4);
  - the automatic shell's wording (C5);
  - the snap after a drag, from the position and the speed (C8a);
  - whether the keyboard is open, from the visual viewport (C8b);
  - the summary row's text (C8b).
- Every fit rule (the chip, the view control, the phone's tabs) is data: a function in src/ui gives the candidate forms in order, widest first. Each host measures them and takes the first that fits. The list and its order are covered by unit tests. The loop that measures and picks is about five lines, in web/ and in media/panel.js (plain JS, copied as is by scripts/build-web.ts, so it cannot import src/ui). A report of web/'s coverage from Playwright's JS coverage may come later, as a report, not a gate.
- Texts come from tables: the page's texts from web/text.ts, the facts from the catalog (src/messages.ts: the level marks and words). English and Japanese have the same keys. Japanese follows docs/japanese-style.md; test/ja-style.test.ts reads web/ from C0 on.
- Layouts are checked with the CJK fonts of CI at 390, 640 and 1280 px, in both languages, and with long names (CLAUDE.md, "Tests that run bash", last item). A layout must not depend on how wide words are in a font: each step's fit rule is tested with the fonts of CI and with measured widths in unit tests. Phone steps also check 130% text (a 300 px CSS viewport, as the kit does). To keep CI's time down, a test file opens one page per width and reuses it.
- Web tests type with `keyboard.insertText`, wait for CodeMirror's selection layer, and feed tools through files (CLAUDE.md).
- Hit areas: on a phone, every control's hit area is at least 44×44 px; side by side, at least 24×24. The hit-area check of C0 gates from C0 on. Today's smaller controls are in an allow-list (test/fixtures/hit-areas.json), which may only shrink, as test/fixtures/file-length.json does. A new control is never on it.
- Each step adds the keyboard path of what it adds (focus order, Escape, focus return), checked by test/web-a11y.test.ts.
- Speed is gated by structure: the wrap plugin decorates only the lines in the viewport, and its work per key press does not grow with the script. A web test checks this on a 2,000-line script (the lines it touches per key press). The time per key press is reported beside main's, measured in the same run (proposed budget: 16 ms at the 95th percentile). The time is not a gate: CI's shared machines make it flaky.
- Screenshots go with each visual PR, before and after, taken with C0's capture script. The author looks at them and measures positions before pushing.
- Each step that changes the phone lists the real-device checks it needs (section 8). The maintainer does them before merge.
- A fresh reviewer (a subagent with no context) reviews C1a, C1b, C7, C8a and C8b before merge.

The old web tests, by the step that changes what they test. Built from a grep of the selectors of the controls that move (`#kind`, `#shell`, `#problems`, `#share`, `#drawer`, `#menu-*`, `#views-top`, `#collapse`, `#copy-md`, `#ref`, `#readmode`, `#splitter`, `#status`, `#settings-open`, `editor.wrap`, `selectOption`, and the helpers of test/support/site.ts):

| Step | Tests | What they target |
| --- | --- | --- |
| C0 | test/support/site.ts | It already has `pickKind` (`#kind`), `choose` (the menu's selects: `#shell`, `#lang`, `#theme`, `#channel`), `menuItem` (`#menu-open`, `#drawer`) and `chooseView` (`#views-top`, `#view-*-menu`). C0 adds `setShell` and `openProblems`, and moves the tests' direct uses of these controls into the helpers. Later steps then change a helper, not many tests. |
| C1a | test/document-setup.test.ts | `editor.wrap` is false by default (line 233). |
| C1a | test/web-hover.test.ts, web-anchor, web-label-width, web-name-hints | Boxes in the editor, which wrapping on by default can move; web-name-hints sets `editor.wrap`. |
| C2 | test/web-levels.test.ts | The list's counts, icons and tooltips (`#problem-list`). |
| C2 | test/web-dead-code, web-pages, web-offline, web-files, web-topbar, web-settings, web-a11y | `#problems`, `#problem-list`, `#problems-count`: the list is open today and folds in C2 (through `openProblems`). |
| C2, C8a | test/web-resize.test.ts | `#problems-toggle`, `#problems-resize` (C2), `#splitter` (C8a). |
| C3 | test/web-files, web-paste, web-kind, web-menu | Toasts (`#status`). |
| C4 | test/web-topbar, web-menu | The bar and the menu: `#share`, `#github`, `#install`, `#sample`, `#settings-open`, `#menu-*`, `#drawer`. |
| C4 | test/web-files.test.ts | `#file-label`, `#menu-open-file`, `#menu-save*`, `#drop-target`, `#sample`. |
| C4 | test/web-share, web-opening, web-pages, web-offline, web-kind, web-a11y | `#share`, `#menu-share`, `#menu-copy`, `#menu-install`, `#menu-panes`, `#editor-hint`, the menu. |
| C5 | test/web-explanation, web-files, web-kind, web-offline, web-paste, web-phone, web-settings, web-share, web-topbar | The kind and shell selects: `#kind`, `#kind-menu`, `#shell`, `#shell-top` (`selectOption`, `pickKind`, `choose`). C5 removes the hidden selects. |
| C6 | test/web-settings, web-menu, web-hover, web-phone | `#settings-dialog`, `#settings-open`. |
| C7 | test/web-reference, web-tree, web-topbar, web-menu, web-explanation, web-kind | `#ref`, `#views-top`, `#view-*-top`, `#views-menu`, `#collapse`, `#copy-md`. |
| C7 | test/web-a11y, web-anchor, web-label-width, web-name-kinds, web-tree-steps | `chooseView` (the helper changes). web-tree-steps is kept by C7 (the steps stay in the panel's own row) and removed by P8. |
| C8a, C8b | test/web-phone.test.ts | `#readmode`, `#readtip`, `#splitter`, `#problems-toggle`, `#views-top`, `#view-*-menu`. |
| Each step that adds a stored key | test/web-storage.test.ts | The stored keys. |
| Every step | test/web-a11y.test.ts | The keyboard paths. |
| None | test/web-example-words, web-pipeline-marks, web-values | The panel's content only. |

## 6. Steps

Each step is a PR from the latest main, useful on its own. A step with letters is several PRs, in that order. The CHANGELOG lines are drafts; details go in docs/changes/unreleased.md.

### C0. Groundwork for the page's tests

Done in #531 (2026-10-31). What it did, and what the design did not say:

- test/ja-style.test.ts reads web/ too: single-quoted and backquoted strings in web/*.ts, and the text of web/index.html. It fixes what it finds.
- test/file-length.test.ts covers web/*.ts. Every web/*.ts file is under 1,000 lines today, so none is listed.
- A hit-area check in test/support: each visible control, `elementFromPoint` from its centre, as the kit's inventory measured. It gates from C0 on, with today's smaller controls in an allow-list that may only shrink (section 5). What the check does, as built (test/support/hit-areas.ts):
  - It measures where a pointer finds the control, probing outwards from the centre of the control's first box (a link that wraps over lines has several; the centre of the bounding box may lie between them), up to 60 px each way. A size of 121 therefore means "at least". A control covered by another measures as what is left of it, down to 0x0.
  - What is inside a closed `<details>`, but its summary, is not on the page (it measured 0x0). Controls inside the editor are not measured: the editor is one control. The file kind's picker is hidden on a narrow page (the menu has the kind there), so the kind list is measured only where the picker shows.
  - It measures the page, the panel's frame, the menu, the settings dialog and the file kinds' list, at 390 px (44x44 bar, a phone with touch) and at 640 and 1280 px (24x24), in both languages. The list has one entry set per width and language.
  - Only a dimension under the bar is gated: a size on the list is written as at most the bar, so a wide control that gets narrower and stays above the bar is no step back, and the list does not depend on the fonts of the machine. A dimension under the bar may differ by 3 px from the list (fonts, rounding).
  - A key is the control's id (a family such as `setting-examples-disabled-*` is one key); a control with no id is keyed by its tag, role and first two classes, and the controls of one such key are one entry, the smallest. A new control without an id is caught only if it is smaller than its group's smallest: give a new control an id.
  - The test cannot stop a hand edit that adds an entry for a new control or lowers a listed size. The reviewer holds that: `UPDATE_HIT_AREAS=1` writes the file from the page (with CI's CJK fonts through `FONTCONFIG_FILE`), and its diff is read.
- stylelint (MIT, a devDependency) on web/*.css, with `no-duplicate-selectors` and `declaration-block-no-duplicate-properties`. It enforces "each rule once" (section 4, web/page.css). Today's duplicates are fixed here.
- test/support/site.ts gets the helpers of section 5's table, and the tests use them.
- A capture script in scripts/ that builds the page and takes the screenshots of a step at the three widths, in both languages. It hard-codes no path of this machine. The CJK fonts come from `FONTCONFIG_FILE`, the browser from Playwright's own variables. It also takes `--themes light,dark`, closes the phone's first-run tip of the read-mode switch before the shots (the tip is a state of its own, `tip`), and names the files `NAME-WIDTH-LANG-THEME-STATE.png`. A memory cap and a limit on parallel heavy runs are the caller's wrapper; README "Contributing" says how to run it.

Users: Japanese wording fixes on the page, if the check finds any. CHANGELOG (Fixed), only then: "Japanese wording on the web page follows the project's style."

Tests: the checks themselves. The hit-area check on today's page passes with the allow-list.

Risks: small.

### C1. Wrap between shell words, and hover cards off the line

Two PRs. C1a is the web page's editor. C1b is the panel's line box, in both hosts.

**C1a. The editor and the hover cards (web only).**

Done in #539 (2026-10-31). What the design did not say: `wrapRuns(doc)` gives the runs of every line of a document at once (once per tree, as the colours are), not of one line; a run is also any text between blanks (an operator, a comment's word), so that every character but a blank is in one run. A substitution over several lines (`x=$(` … `)`) is read line by line, as commands; a word not closed yet, and a line with text the parser cannot read, break at their blanks. The widths are measured with a canvas in the editor's font. On a key press only the changed lines are marked again; the speed test types into a 2,000-line script and reports the time to the next frame beside the editor without the wrap. A card goes below the line unless the room there is under 200 px and the room above larger. A line that leaves under 120 px on both sides (a long one-liner in a low pane) gets its card by the hovered row, over the line's other rows, at least 120 px high, as before C1a. The way to the card has 600 ms, and only moves that leave the part's row towards the card, with no button pressed, are kept from the editor: a move along the row reaches another word, a drag selects, and a pointer that rests on another word before the card gets that word's card. The card opens before the lint's problem (250 ms against 300), since CodeMirror's one hover box keeps the side of the tooltip that opened it. The keyboard's card is not held to its side: when the editor scrolls that side away, it moves to the other side of the line.

Follow-up of C1a (not built): a run too wide for a row breaks at every blank in it, those inside quotes too. `result=$(curl -s "…" | jq -r '.items[] | select(.name == "x y") | .id')` may split its jq program over two rows, though the program alone fits. The fix is a second level of runs from `wrapRuns`: the words inside a substitution on one line (as it already reads a substitution over several lines), used before the plain blank split. test/wrap-runs.test.ts pins today's fallback.

What:

- The editor wraps a long line only between shell words. Rows after the first get a hanging indent and ↪.
- The word bounds come from the syntax tree. `wrapRuns(tree, line)` in src/ui gives the runs that must not break: a word with its quotes, `$( )`, `${ }`, `<( )`, backquotes, a comment's words.
- A run wider than a row breaks at its own inner blanks. As a last resort it breaks anywhere.
- A line the parser cannot read breaks at blanks.
- The tree trails typing by 150 ms (web/main.ts). Until the next tree, the runs of the last tree are mapped through the changes (`mapPos`), and only the new text breaks at blanks. So typing at the end of a wrapped line does not move its earlier rows.
- These cases are named and tested: a heredoc's body, a line inside a quoted string over several lines (one word across lines), the lines of a host kind that are not shell (Dockerfile, YAML, Makefile, Markdown) and a shell region's offsets in it, and CRLF line ends (the CR masked as a space).
- `editor.wrap` is on by default. Its description says what it covers.
- Hover cards sit under the whole wrapped line (above it when there is no room), at the part's x. They have the cap and the grace period of decision 10. Their place and height come from a pure function in src/ui. docs/design/hover.md, "Web page", says so.

CHANGELOG (Changed): "The web page wraps long lines between shell words, with ↪ on the rows after the first. Wrapping is on by default; before, it was off, and when on, a line broke anywhere." (Fixed): "Hover cards on the web page no longer cover the line they explain, and a long card scrolls inside."

Tests:

- Unit tests of `wrapRuns` over the corpus (sample.sh, the fixtures, snippets.json): no break falls inside a word of the tree. The tree is already checked against bash-ast, so this checks the runs against bash's words. The named cases above are in the corpus.
- Typing at the end of a wrapped line keeps its earlier rows, before and after the next tree.
- Web tests at 390, 640 and 1280 px, both languages, CJK fonts: no sideways overflow; the rows of line 8 as in the kit; ↪ on each continuation row; the setting off gives one row that scrolls.
- Hover: the card's top at the line's bottom, with the pointer on each row; its height under the cap on a long card; the pointer's path from row 1 to the card keeps the card; the card scrolls with the keyboard.
- Speed: the structural check of section 5 on a 2,000-line script.

Risks: the plugin's cost on long scripts (it works on the visible lines only).

**C1b. The panel's line box (both hosts).**

What:

- The panel's line box (`#line` in media/panel.js and media/panel.css) wraps by the same runs. The runs travel inside the panel's update message, so media/panel.js draws word spans without parsing.
- Up to three rows, then a fade; a click opens it whole.
- On the web page, the line box follows `editor.wrap`.
- In VS Code, the line box follows VS Code's own `editor.wordWrap` for the document: off gives today's single row that scrolls sideways (`white-space: pre; overflow: auto`); any other value wraps. src/ui/panel.ts reads it and sends it with the update. VS Code users get no new setting.

CHANGELOG (Changed): "The explanation's line box wraps a long line between shell words, up to three rows (click to see it whole). It follows Wrap long lines on the web page and `editor.wordWrap` in VS Code. Before, a long line scrolled sideways."

Tests: unit tests of the runs in the update; web tests of the line box at the three widths; a VS Code panel test with `editor.wordWrap` on and off.

Risks: the line box is the panel's, which P7c restyles. Whichever lands second keeps the word spans.

### C2. The Problems strip

What:

- The Problems list folds into a 32 px strip: "› Problems", and the count per level with its icon. The counts come from the level table, so three levels give three counts.
- At the right, the position "Ln 20 · 1/11" with ‹ › (F8, Shift+F8). The next and previous problem wrap around. Both come from a pure function in src/ui.
- The list opens on a click. The line is in a fixed column, and the message takes up to two lines. The rule id shows from a 520 px pane.
- The tooltip has the whole message, "Ln 95: …", and the rule id (decision 6).
- The list is open on the very first visit (nothing stored), so the sample's problems show. After that, the user's choice is remembered. The page never opens it on its own, for example when a warning appears (section 9, 4).
- The editor gets the room of the folded list. Help's list of shortcuts names F8.

Prerequisite (2026-10-31, [sources.md](sources.md), SB1): C2 starts after step 1 of [three-levels.md](three-levels.md) has built the level table with every output mapping; the strip's counts, icons and accessible names read it.

CHANGELOG (Changed): "Problems on the web page fold into a strip with their counts. ‹ › and F8 / Shift+F8 go to the next and previous problem, and the strip shows where you are (Ln 20 · 1/11). The list opens on your first visit, and then stays as you left it."

Tests: the strip's counts equal the problems of the document, per level; F8 from the last problem wraps to the first; the position on a line with two problems; the tooltip of every item has a 1-based line, and no tooltip text matches `/\d+:\d+:/`; open on a first visit, then the stored choice after a reload; a new warning while typing does not open it. Widths and languages as in section 5.

Risks: users who kept the list open lose it once, after their first visit with this step.

### C3. Toasts: one placement, one look

What:

- One toast component with an icon (↶, ✓, ⓘ) and one look.
- One placement: above the Problems strip (decision 8).
- While a toast shows, CodeMirror's bottom scroll margin (`EditorView.scrollMargins`) grows by the toast's height, and the cursor is scrolled into view. So a toast never hides the cursor's line.
- Timers: 4 s, 8 s with an action, paused while the pointer or the focus is on it. The timer is a pure state in src/ui.
- A longer text goes behind "More" or "Why?".
- "Load the sample" over the user's script loads it and offers Undo, instead of asking first.

CHANGELOG (Changed): "Messages on the web page (Opened, Saved) show in one place above the Problems strip, with an icon, and stay while the pointer is on them. Loading the sample over your script offers Undo instead of asking first."

Tests: each toast of the page above the strip, at three widths; never over the panel; with the cursor on the editor's last visible row, that row stays in view above the toast; unit tests of the timer, and web tests with the pointer on and off; Undo restores the text, the file name and the kind; the Undo path with the keyboard.

Risks: an action toast covers the last rows of the editor for 8 s (the kit's known limit). Accepted: the scroll margin keeps the cursor's line in view.

### C4. The app bar and the editor's header

What:

- The app bar keeps ≡, the logo and name, "Copy a link", ⚙, GitHub and Install (from 1100 px).
- "Copy a link" confirms in place: "✓ Copied" for about 2 s, with the privacy sentence as its tooltip (decision 8).
- The editor's header gets Open and Save (words from a 481 px pane, icons below), the file name and ⋯ (Rename…, Copy the script, Load the sample, Clear the editor).
- The file name is muted while never saved or opened, with ● after it when there are unsaved changes; Save has no dot. A click or ⋯ › Rename… renames it in place. Its state is a pure function in src/ui.
- The menu is grouped: Script, Share and Explanation (stacked only), Preferences, Help, About. Its first row is the file name.
- The first-run hint and the empty editor's block (Paste, Open, Load the sample) are round 8's.
- Focus rings follow the input (`.no-ring` after a pointer close).
- The type and shell pickers stay in the bar until C5, and the view switch until C7. So the CHANGELOG line says only what C4 does.

CHANGELOG (Changed): "The editor on the web page has its own header: Open, Save, the file name (click it to rename; ● marks unsaved changes) and ⋯. Copy a link says "Copied" on its own button."

Tests: the old bar's tests rewritten for the new places (the table of section 5); Copy a link's confirmation and its tooltip; rename with the keyboard and the mouse, Escape restores; ● after an edit, gone after Save; unit tests of the file name's state; the menu's groups at each width; the hit-area check on a phone; Help's shortcuts.

Risks: the first PR that moves many controls; the screenshots of the three widths go in the PR. The share-link tests change with the button.

### C5. The file type and shell chip

What:

- One chip right of the file name, "Shell script · bash (auto)", at every width, on a quiet fill.
- It opens one popover with two radio lists, File type and Shell (and the yq flavour when the script uses yq). On a phone it is a bottom sheet.
- The wording of the automatic shell comes from one function (decision 12). Prerequisite (2026-10-31, [sources.md](sources.md), SB4): `detectShell` (src/dialect.ts) gives its source (a ShellCheck directive, the shebang, the file name, the default), and the `auto (bash)` text of src/ui/panelView.ts comes from the same function.
- The shortening is a fit rule in src/ui. It gives the candidate forms in order: the whole chip, then without "(auto)", "Script · bash", Open and Save as icons, "bash" alone, and the name moved to the menu. The page takes the first that fits.
- The kind and shell pickers leave the app bar and the menu. The hidden selects go. The panel bridge reads the scope from the page's state.

CHANGELOG (Changed): "One button above the editor shows the file type and the shell ("Shell script · bash (auto)") and opens both lists. Before, they were two pickers: the type in the top bar, the shell there only from 1200 px wide, else in the menu."

Tests: unit tests of the candidate list and of the wording (every source, both languages); web tests: arrows move in each list, the checked item has the focus, Escape returns the focus to the chip; a pick re-explains the line; each form at the width where it starts, en and ja, with long file names; the popover stays on screen in a narrow pane.

Risks: users who chose a shell in the menu look for it there. The menu's Script group keeps a row "File type and shell…" that opens the same control.

### C6. Settings

What:

- The settings in sections: Common first (with Wrap long lines and Animations in the panel), then Examples, Checks, Editor and Data, folded, each opened by "Jump to". A search.
- Descriptions of two lines with "More" inline; whole on touch.
- Option labels in words; the VS Code keys only with "Show VS Code setting names".
- Side by side, the sheet opens over the editor, and the panel stays live (decision 7). It is capped to the editor pane's width.
- On a phone, the settings take the whole screen. A change shows in the explanation when they close. The sheet keeps its scroll position (section 9, 1).
- The shorter page copy of some settings moves into src/settings.ts beside the long text.

CHANGELOG (Changed): "Settings on the web page come in sections, with a search and links to each section. On a wide window they open over the editor, so the explanation they change stays in view."

Tests: test/web-settings.test.ts rewritten: each setting still changes what it changed (its existing assertions); a change shows in the panel while the sheet is open, side by side; at the narrowest side-by-side width (about 640 px, no touch), the sheet is no wider than the editor's pane; search finds by title and by key; Jump to opens and scrolls; 44 px rows on touch; on a phone, the scroll position is kept after closing and opening again; the Shell setting's wording from decision 12.

Risks: small.

### C7. The panel's header and the depth control

Needs P1 (panel-redesign.md): the slot is drawn from `viewControl`.

What:

- The panel's header: the tabs Explanation and Reference, the view slot, Collapse and Copy as Markdown, each labelled (decision 11).
- The slot draws one component from `viewControl` (decision 4). Its label too comes from `viewControl`.
- Its forms come from `viewControlForms(control, lang)` in src/ui: the candidates in order, widest first. The page measures them and takes the first that fits. VS Code's panel header uses the same list, with the same few lines of measuring in media/panel.js (from P8 on, when it has a depth control).
- An option with a digit shows the digit, and its name only when selected. An option without one shows its name. Until P8, `viewControl` returns Meaning | Reading without digits, so the slot shows both names.
- Reading's eight steps stay in the panel's own row (sticky under the line box, the panel's own behaviour), never in the page's header. This edits media/panel.js and media/panel.css.
- From P1 (review of #538): the drawing of the view buttons is in two copies today, media/panel.js `drawViews` and web/panel-bridge.ts `showView`. C7's one component replaces both; it does not add a third. The `header` message that P1 added carries the panel's buttons as drawn (names and icons): C7 sends their state instead (folded, reference open), and both hosts take the names and icons from src/ui. The page's Collapse and Quick reference still press the panel's buttons in the frame (`button('toggle')`, `button('ref')`); C7 makes them send the state.
- The Reference tab hides the line box, and the slot keeps its room, unseen.
- The view switch leaves the app bar and the menu.
- At 1280 px (the usability test's width, a panel of about 630 px), the expected form is: the tabs, the segments in a 240 px slot, then Collapse and "Copy" with their words beside the icons. In d-rest the panel had 633 px with a 196 px slot, Collapse as an icon and "Copy as Markdown" (157 px); the short word "Copy" (section 9, 3) frees the room. C7 measures it in both languages. If the segments do not fit at 1280, the header is sized so that they do.

CHANGELOG (Changed): "The explanation's controls are in the panel's own header: the tabs, the view, Collapse and Copy as Markdown, each with a word. Before, the view switch and Copy were in the top bar."

Tests: unit tests of `viewControlForms` (the candidates and their order, both languages, with and without digits). Web tests: the slot's width is the same in every state of a width (each option selected, Reference); the header does not overflow at 640 to 1440 px, en and ja, CJK fonts; the form at 1280 is the segments, en and ja; a press changes the panel and is kept after a reload (with P1's test); Collapse and Copy keep a word at every width.

Risks: P8 changes the data to depths; the fit test runs again then. The 240 px threshold is measured with the real short names, not set by hand.

### C8. The phone's sheet and keyboard

Two PRs, released together (no release between them).

**C8a. The sheet.**

- On a phone (and a touch screen without hover up to 1024 px held upright), the explanation is a bottom sheet over the editor.
- It has three heights: peek, half and full. After a drag, the sheet settles on a height from its position and speed (a pure function in src/ui).
- Its header is one 48 px row at every height: the tabs (decision 9) and the depth pill (C7's component). The boxes are the same at every height.
- The whole header is the grabber: a tap cycles the heights, a drag moves the sheet, and arrow keys too. A one-time hint shows at the first full sheet.
- The sheet sets `overscroll-behavior: contain`, so dragging it down does not pull the page to refresh.
- At full height the app bar slides away; it comes back below full. With reduced motion, the sheet and the bar move without animation.
- The strip above the editor: Read | Edit, the file name and the chip, 44 px boxes.
- Problems is a tab (the desktop strip is not shown). Toasts sit above the sheet's tabs row.
- The tabs' fit is a rule in src/ui that gives the candidate forms in order, with decision 9's words.

**C8b. The keyboard and the peek.**

- While the keyboard is open over the editor in Edit mode, the app bar hides, and the sheet folds to one summary row of the cursor's line, just above the keyboard.
- Whether the keyboard is open comes from the visual viewport's numbers, through a pure function in src/ui.
- The peek is the tabs row and the same summary row (about 96 px; decision 5).
- A tap on the row opens the sheet at half (and closes the keyboard).
- The row's text is `summaryRow(explanation, lang)` in src/ui: the line's first problem by level, else the first part's label and summary. Section 7 says how P5 and P7b change it.

CHANGELOG (Changed), C8a: "On a phone, the explanation is a sheet over the editor: tap its bar for half or full height. Read and Edit switch between reading and typing. Before, the screen was split into two halves, the editor and the explanation." (New), C8b: "On a phone, a one-line summary of the cursor's line stays above the keyboard and in the folded sheet; a tap shows the explanation."

Tests, C8a: the tabs' boxes identical at every height and tab, en, ja and 130%; every hit area at least 44×44 at each height, in the scope sheet, the settings and the menu; the app bar's position at full and half; the editor's cursor line stays in view as the sheet moves; unit tests of the snap; reduced motion.

Tests, C8b: both keyboard emulations of the kit as web tests (iOS: the visual viewport shrinks; Android: the window shrinks): the summary row's box at the keyboard's top, the cursor's line in view, a tap gives half and no focus in the editor. The iOS emulation stubs the visual viewport's API, so it tests the wiring only; the real behaviour is checked on devices (section 8). Unit tests of the keyboard test and of `summaryRow`.

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
| The slot's place and width, and its candidate forms | The chrome (C7) | From `viewControlForms` in src/ui. Each host takes the first form that fits. |
| Keys 1, 2 and W | The panel | The page binds none; Help names them "in the panel". |
| The line box and its wrap | The panel | Wrapped by C1b's runs. It follows `editor.wrap` on the page and `editor.wordWrap` in VS Code. |
| Reading's steps row (until P8) | The panel | Sticky in the panel's frame; never in the page's header. |
| The switch "What the program receives", the Key | The panel | In the panel's own row (6.1). |
| The phone's tabs row and its depth pill | The chrome (C8a) | The pill is C7's component. |
| The summary row's text | src/ui (C8b) | P5 and P7b improve it. |
| Toasts, the strip, the app bar, the editor's header, settings, the sheet | The chrome | |

The order. Both series start after the roadmap's three note levels (C2 reads the level table; changed 2026-10-31, from "items 1 to 7"), except C0 to C6 and P1 to P2, which started early (2026-10-31). They mostly touch different files: the chrome web/ and src/ui's page rules; the panel's steps P2 to P6 src/ and the dictionary. So they may run side by side. These must hold:

- C0 comes first in the chrome series.
- The usability test's baseline (panel-redesign.md, section 7) is pinned to a commit: the last release tag before C1a and P1 land. So it can run at any time, and needs no place in the order.
- P1 is the first panel step. It is small and changes nothing users see, so C7 can follow C6 without waiting.
- C1a to C6 need no panel step. They may land before, between or after P1 to P6.
- P1 lands before C7: C7 draws the slot from `viewControl`.
- C7 lands before P8: at P8 the slot shows the depths, through C7's component, in the page and with the same candidate list in VS Code's header.
- C7 lands before C8a: the phone's depth pill is C7's component.
- C8b's summary row: once P7b lands, the row shows a problem's headline instead of its cut text; once P5 lands, a line with no problem shows its "In short" sentence. P5 and P7b change `summaryRow` and its tests in the same PR.
- C9 lands with or after P10: one README re-recording for both.

Files that both series, or several steps, edit. The second PR to land rebases on the first:

| File | Steps |
| --- | --- |
| The line box: media/panel.js, media/panel.css | C1b, C7 (the sticky steps row), P7c, P8, P9 |
| web/panel-bridge.ts | P1, C5, C7 |
| src/ui/panelView.ts | P1, C1b (the runs in the update), P7 |
| web/storage.ts, `STORAGE_KEYS` | C2 (the list's state), C8a (the sheet and its hint), P9 (W) |
| web/text.ts (Help lists the panel's keys) | C4, P8 |
| test/support/site.ts, `chooseView` | P1, C7, P8 |
| README "The web page" and "The panel" | C9, P8 |

A proposed sequence: C0 and P1; then C1a to C6 beside P2 to P6; C7 after P1; C8a and C8b; then P7 to P10; C9. The usability test runs after C9 and P10.

## 8. The phone checks on real devices

The emulations of the kit do not show a real keyboard, a finger's drag or the system's menus. Before C8a and C8b merge, the maintainer checks on an iPhone (Safari) and an Android phone (Chrome), and notes the result in the PR:

1. The keyboard: its real height; the summary row sits right on top of it; the cursor's line stays in view; iOS does not pan the page under a fixed bar.
2. Closing the keyboard (the row's tap, the system's button, a swipe): the sheet comes back as it was.
3. Dragging the sheet with a finger: it follows, settles on a height, and does not scroll the editor under it. On Android, dragging it down does not pull the page to refresh.
4. A tap on the grabber, the tabs and the pill with a thumb: no wrong target hit.
5. The app bar at full height: it slides away and back without a jump; the browser's own toolbars do not cover the strip.
6. The safe-area insets, and Safari's bottom address bar expanded and collapsed: the peek row and the toasts above the sheet stay in view.
7. The system's paste menu in the editor, and "Paste" in the empty editor's block (the clipboard permission).
8. Open a file and save one (Files on iOS, the download on Android); rename the file in the strip.
9. The chip's sheet and the settings at full height; Done and the back gesture.
10. Larger text (Android's font size, Safari's page zoom at 130%): the tabs row and the strip fit.
11. Turned to landscape, and an iPad upright and turned (with and without a hardware keyboard).
12. On iOS, a wrapped line: the caret, the selection handles, and moving the caret across rows.
13. Reduced motion on: the sheet and the app bar move without animation.
14. A quick pass with VoiceOver and TalkBack: the sheet, the tabs (with the Problems tab's full counts) and the chip.

C1a (the wrap on a phone: check 12), C4 (rename on touch) and C5 (the chip's sheet) need checks 7 to 9 and 12 where they apply.

## 9. The open questions, answered

The maintainer decided the plan's four open questions on 2026-10-27, as the plan's review proposed:

1. **Settings on a phone.** Decided 2026-10-27: the settings take the whole screen on a phone. Two stacked sheets in 844 px with 44 px rows would be cramped. A change shows in the explanation when the settings close, and the sheet keeps its scroll position (C6).
2. **Three counts in the phone's tabs row.** Decided 2026-10-27: the Problems tab hides the levels with no problem. If the rest still does not fit (at 130% text, for example), it shows only the highest level that has problems: its mark and count. The accessible name always has every count. The candidates come from the tabs' fit rule (decision 9, C8a).
3. **The word under a narrow tool.** Decided 2026-10-27: "Copy" / 「コピー」 under the icon, with "Copy as Markdown" as the tooltip and the accessible name. "Copy MD" would be jargon for beginners. It is never moved into ⋯ (decision 11, C7).
4. **The Problems list on the desktop.** Decided 2026-10-27: it is open on the very first visit (nothing stored), so the sample's problems show. After that, the user's choice is remembered. The page never opens it on its own, for example when a warning appears, since that would move the layout while typing (C2).
