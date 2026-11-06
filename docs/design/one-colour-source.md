# One colour source: the editor's colours from the explanation's tokens

Status: tracked in #672. Planned for a release after 0.10.0 (decided by the maintainer 2026-11-06). A proof of concept for the web editor is kept for reference on the branch `one-colour-source` (PR #627, closed, not merged); VS Code and the Language Server are designed here only. This document is the result of the proof of concept and of an independent review of it; the work to do before the steps follow from that review.

The maintainer agreed on the direction (2026-11-06): the editors (the web page's CodeMirror editor, VS Code, the Language Server's clients) take the colour of each part of the shell code from the tokens of its explanation, the same source as the panel's colours, instead of deciding it from the syntax tree themselves. The editor will then colour inside regular expressions and formats too, as the panel does.

## Decisions of the maintainer (2026-11-06)

- Plain arguments are green in the editor too: the panel's colour for an argument, from the one table.
- A line that cannot be explained (a bug, or too deep) gets no colour in the editor: the plain text colour, not an `error` token. (The panel is not changed by this; it keeps saying that the line could not be explained.)
- The editor-only `readonly` bold and `exported` underline are dropped. A readonly or exported variable is coloured as any variable.
- The body of a here-document gets a string token in the explanation, so the panel colours it too (it takes the redirect's token today).
- Not in release 0.10.0: planned for a later release (#672).

The sections below are written with these decisions applied.

## The problem: two sources of the same facts

Today the editors are coloured by src/highlight.ts (`highlight`, `documentHighlight`, `hostedHighlight`): the tree's node types, a guess of options from a leading `-` (`isOption`), of globs (`isPattern`, `glob`) and of the operands of builtins (`operandKind`), with src/semanticFacts.ts painted over it (what a name runs, options by the specs). The panel colours its line from the explanation's tokens (`panelUpdate(...).lineRuns`, src/ui/panelView.ts). The two read the same line apart:

| Line | Editor (highlight.ts) | Panel (tokens) |
| --- | --- | --- |
| `git log --pretty=format:'%h %an' --date=short` | `--pretty=format:` plain, `=short` plain, `%h` a string | the option's value an option, `format:` a keyword of git's format, `%h` a variable (the command's own language, from git's spec) |
| `grep -E '^a+'` | `'^a+'` a string | `^` and `+` operators of the regex |
| `sed 's/a/b/'` | a string | `s` a command of sed, `/` its delimiters |
| `cat <<EOF` … | the body a string | the body the redirect's |
| `make > build.log` | `build.log` plain | the redirect's target, the redirect's |

Measured with the comparison of characters (each character not blank, its colour in the editor against the panel's, in the light and the dark theme of the web page; scripts/colour-agreement.ts on the branch `one-colour-source`): on main, 1,786 of 3,067 characters of test/fixtures/sample.sh agree (58%), and 20 of its 123 lines (16%); over the 2,051 snippets of the test corpus, 21,959 of 32,856 characters (67%) and 557 of 2,545 lines (22%). The editor leaves plain arguments in the foreground, which the panel colours (445 characters of the sample); without those, 27% of the sample's characters and 21% of the snippets' still differ.

The table of kind to role to colour is written many times. The first list, as on main today: `KIND_ROLES` (src/roles.ts), `KIND_ROLE` (src/ui/render.ts, the hover), `PANEL_KIND_ROLE`, `CLASSIC_ROLE` and `CLASSIC_COLOURS` (web/editor-colors.ts, on main), `TOKEN_OF` (src/semanticTokens.ts, a highlight kind to a semantic token type), `ROLE_PROBES` (src/ui/themeTokens.ts, a role to the token type a theme is read with), and the `.kind-*` rules of media/panel.css. The review of the proof of concept found more on main that still decide a kind, a role or a colour, and are not in that list:

- `ANSI` in cli/main.ts (about line 299): the text output's colour of each token kind, as ANSI codes.
- `THEME_ROLES` in media/panel.js (about line 114): the roles whose colour the panel reads from the theme.
- src/ui/palette.ts: the six roles (`Role`), their colours per theme kind and `roleColour`, with `CHART_VARIABLE`; media/panel.css (`body.vscode-*`) and web/theme.css repeat its values (test/contrast.test.ts compares them).
- On main, the editor italicises comments and shebangs (web/editor.ts, the `comment` tag and the `.cm-bx-comment` and `.cm-bx-shebang` rules); the panel does not. A surface-only rule is a second source: decide it once (in the table, for both) or drop it.
- The proof of concept (branch `one-colour-source`, not on main) added `ROLE_COLOURS` in web/editor-colors.ts, which repeats what media/panel.css gives each `.kind-*` (a test compares them), and kept the italic in an `ITALIC` set. In the built version `ROLE_COLOURS` is generated from the one table, not repeated.

The inventory for the steps is therefore these, not six: every one of them is read from the one table (steps 2a and 2b below).

## What gives the colours

Every token of the line's explanation (`LineExplanation.items`, at every depth), each character taking the role of the deepest token over it: `lineOwners` (src/ui/render.ts), which the panel's line box already uses (`lineRuns`). Not the rows of depth 1: the depth control chooses the panel's rows, and the line box colours by the deepest token whatever the depth, so that `%h` is a variable inside the option's value. `lineColours` (src/ui/lineColours.ts: new, as in the proof of concept; it is not on main) gives the runs of a line with their roles; a blank no token covers has none.

One mapping, in two steps:

1. Kind to role: `KIND_ROLES` (src/roles.ts), the one table (docs/design/sources.md, SB3a). `lineColours` reads it; the panel's `.kind-*` rules are checked against it (test/token-facts.test.ts).
2. Role to colour, per surface:
   - The web page (editor, panel, hover): the CSS colour of the role. The proof of concept (not on main) has `ROLE_COLOURS` (web/editor-colors.ts), which test/editorColours.test.ts compares with what media/panel.css gives each `.kind-*` through the variables of body. The step writes media/panel.css's role variables, web's, media/panel.js's `THEME_ROLES`, src/ui/palette.ts and the CLI's `ANSI` from one table, as scripts/level-css.ts does for the levels, and the hover's `KIND_ROLE` goes.
   - VS Code and the Language Server: the role's semantic token type, the `token` of `ROLE_PROBES` (src/ui/themeTokens.ts). That is the type the panel reads the theme's colour with when `bashExplainer.panel.colors` follows the theme, so a theme colours a part in the editor as the panel shows it. `TOKEN_OF` and the highlight kinds go.

The kinds and spans of the tokens depend neither on the language nor on the options the problems leave out (examples, idioms, the reading tree, the argv, the POSIX notes). Measured on every non-empty line of sample.sh, coverage.sh and the snippets (2,850 lines): the runs of `lineOwners` are the same in Japanese and in English (0 lines differ), and the same with the problems' lean options as with the panel's (0 lines differ). So the colours read the lean explanations the problems already make (`noteIssues`): `leanExplanation` (src/document.ts; to be added, as in the proof of concept: it is not on main) keeps them per tree, language, shells and options, and the problems and the colours share them, whichever asks first.

## Cost

Measured in Node.js (tsx, the machine of the maintainer under WSL; medians of 5 runs; examples off, as the problems and the colours read the lines). The 1,500-line script is sample.sh, coverage.sh and renderings.sh followed by the snippets that parse alone and stop nothing (no `exit`, `exec`, `return` or here-document), until 1,500 lines.

| | sample.sh (128 lines) | 1,500 lines |
| --- | --- | --- |
| Parse | 4.7 ms | 58 ms |
| `documentHighlight` (today's colours, whole script) | 29 ms | 201 ms |
| `shellState` (the run model, once per tree) | 17 ms | 137 ms |
| The status model, once the state is built | 0.0 ms | 0.0 ms |
| One line, median (models built) | 1.1 ms | 0.7 ms |
| One line, 95th percentile / slowest | 3.4 / 5.5 ms | 2.7 / 12 ms |
| 40 lines in the middle, on a fresh tree (models included) | 76 ms | 193 ms |
| Every line, lean, fresh tree | 145 ms | 1,260 ms |
| `documentIssues` (the problems; the page runs it on every change today) | 148 ms | 1,433 ms |

- Explaining a line does not rebuild the models of the whole script. `shellState`, the status model, the trust scan and the argv of commands are kept per tree (`WeakMap`s on the tree or the model): only the first line explained on a tree pays for them, and they are shared with the problems, the panel and the hover. A line explained alone on a fresh 1,500-line tree took 196-224 ms; the next one 0.4-0.7 ms.
- What dominates after an edit: on a long script, the model, which is linear in the script (0.09 ms a line: `shellState` is 137 of the 200 ms of the first line); on a short one, the lines in view (1-2.5 ms each, 40 on a screen).
- The problems' pass explains every line on each change (1.4 s on 1,500 lines, in one task); the colours, sharing its explanations, add nothing to it. It is the main blocker of the page's main thread on long scripts, colours or not (see the measurements in the browser).
- One line has no time bound. A slice explains at least one whole line, and the first slice also builds the models, so a long line is one task. The review measured a line of 1,000 pairs `"a0" $x0` (12.8k characters): 1,714 ms for the line (`documentHighlight` of today's colours: 63 ms); 3,000 pairs: 18.4 s. Main shows its colours before such a freeze; the proof of concept shows none until after it. Reading the explanation's tokens makes the per-line cost the explanation's, which grows with the words of the line, so the colours need a bound per line (relates to [line-budget.md](line-budget.md) and #673, which bounds a very long line): a line over its budget has no colour (the plain text colour, as for a line that cannot be explained), and the colours of the other lines come first.

## Strategy

As built in the proof of concept (web/token-colours.ts on the branch `one-colour-source`), and kept for the built version:

- **Only the lines in view**: those on the screen first (`visibleRanges`), then the rest of what CodeMirror draws (its viewport, a margin around the screen). On a scroll, the lines that come into view at once.
- **After typing**: the marks move with the text (mapped through the changes), and the lines in view are coloured again 100 ms after the last change, as today's colours were. A line out of view keeps its moved marks until it comes into view.
- **In slices**: at most 12 ms of explaining per task, then the page gets the main thread back (`setTimeout(0)`); the first slice also builds the models of the script, which cannot be split. A change while the slices run drops the rest (the change schedules its own). A slice always explains one whole line, so the 12 ms is not a bound on a long line (see "Cost": a per-line bound is needed).
- **The linter waits for the colours.** The problems' pass is one long task (2.4 s on 1,500 lines with the CPU slowed 4 times).
  - In the proof of concept it runs 300 ms after the change, between the colour slices, and holds the last slices back.
  - In the built version it starts only when the colour slices of the lines in view are done, and not at all while slices are pending.
  - The colours come first, the problems after.
- **Each painted line replaces its own marks**, so a line keeps its old colours until its new ones come, never a blank.
- **The cache is the tree.** Each change makes a new tree. A line is explained once per tree, language, shells and options (`leanExplanation`).
  - The review found no staleness: the key covers the options, the language, the shells and the tree.
  - But the key holds more options than the colours need. The kinds and spans depend on none of the problems' lean options (measured above), so a change of such an option recolours for nothing. The key of the colours should hold only what the colours read.
  - A key per line (its text) would be wrong: an edit above a line changes how bash reads it.
  - Measured on sample.sh, inserting one line at its top changes the colours of later lines: `shopt -s expand_aliases; alias grep=ls` 4 of 122, a function `grep() { :; }` 4, an unclosed `cat <<EOF` 121, an unclosed `echo "` 122, an unclosed `if true; then` 1 (`alias ll=ls` without `expand_aliases`, `set -o posix` and `readonly HOME` none).
  - A key per line that is right would hold every fact of the state the line reads: aliases, functions, options, open here-documents and quotes, the statement over several lines it is in.
  - The tree is the key that is always right. What it costs is measured above.
- **First paint**: on load, the lines in view at once (no debounce).
- **Shared with the problems**: the problems' pass, started after the colours' slices (above), finds the lines in view explained.

## Lines that cannot be explained, and host files

- **Text bash cannot read while typing** (an unclosed quote, `if` without `fi`): the tree still has the nodes the parser made, and the explanation tokens for them, an `error` token inside the line only where bash cannot read that part, never over a whole line. An unclosed `"` makes the rest of the script a string, as bash reads it; the panel shows the same. Nothing else colours these lines.
- **A line that the line's budget or a bug stops** (`lineNotExplained`, src/analyzer.ts): no colour in the editor, the plain text colour (decided 2026-11-06), not the panel's `error` token over the whole line. `lineColours` gives such a line no runs. In VS Code, a line without tokens shows what the TextMate grammar colours (below); on the web page, the plain text colour. The panel keeps its row saying that the line could not be explained.
- **Host files** (Markdown, Makefile, Dockerfile, YAML, bats…): `explainDocumentLine` already explains a host's line from its region's own tree, with the tokens mapped back to the document (src/hosts/remap.ts), so the colours need no `hostedHighlight`. A line outside the shell code has no tokens; the host's own mode colours it (the CodeMirror legacy modes on the web page; the language's grammar in VS Code), as today.
- **No fallback from highlight.ts.** Nothing from the tree is drawn before the tokens, not even comments and strings: a second source of those would differ from the tokens where they differ today (the body of a here-document, an unclosed quote), and the only moment without colours is the first paint of a script, or a jump to lines never shown, for the time measured below. What stays of src/highlight.ts is nothing that names a part; the wrap runs (src/ui/wrapRuns.ts) are where long lines may break, not colours, and the faded dead code comes from the model's diagnostics.

## VS Code and the Language Server

Today VS Code colours shell scripts with its own TextMate grammar (the built-in `shellscript` grammar), and our semantic tokens over it: a `DocumentSemanticTokensProvider` and a `DocumentRangeSemanticTokensProvider` (src/ui/semanticTokens.ts) send the spans of `documentHighlight`, as standard token types and modifiers (`TOKEN_OF`), which package.json's `semanticTokenScopes` map to scopes of that grammar ([highlighting.md](highlighting.md)). The Language Server sends the same tokens (`full` and `range`, cli/lsp.ts).

The design:

- The same two providers and the same legend; the spans of a line are `lineColours` of its lean explanation, from the service's cache per document version (the diagnostics' pass fills it, src/service.ts `diagnosticsFor`), each role sent as the token type of `ROLE_PROBES`. `semanticTokenScopes` keeps one entry per type, as now (a test checks that every type sent has one).
- The range provider answers for the visible range (VS Code asks it first, and on scrolls), explaining only those lines; the full provider answers from the same cache, and explains the lines the diagnostics have not (a whole-document request costs what the problems' pass costs, and is shared with it). Both stop between lines when VS Code cancels the request. To check in that step: whether VS Code then still asks for the full document of a long file, or whether the range provider alone is better there.
- The extension host is not the window's thread, but it also answers the panel and the hover: the providers explain no more than they are asked for, and the panel's line comes first.
- The theme: [theme-colours.md](theme-colours.md). With `bashExplainer.panel.colors` set to follow the theme, the panel takes the theme's colour of each role from the same token types (`ROLE_PROBES`), so the editor and the panel show the same colour for each part. With the panel's own palette (the default), the colours differ by design, but the parts do not: what is one role in the panel is one token type in the editor. `themeLike`, which keeps the roles distinct where the theme colours two alike, changes only the panel.
- The `argument` role has no token type of its own in `ROLE_PROBES` (the theme's colour of a plain argument is the grammar's): it is sent as `string` with our modifier `unquoted`, which `semanticTokenScopes` maps to the grammar's plain argument, as `TOKEN_OF` sends a word read as data today. The review found that this is a second source of the argument's colour: a theme with a `semanticTokenColors.string` rule colours the editor's arguments by it, while the panel (which reads `ROLE_PROBES.argument`, with no token type) does not, so the two differ for that theme. Settle it in step 3: give `argument` a token type of its own in `ROLE_PROBES`, or have the panel read `string` for it.
- `redirect` and `operator` both send the token type `operator` (`ROLE_PROBES`), so the editor cannot colour them apart where the panel does. Either give `redirect` its own type (a custom type with a fallback to `operator`), or accept that they share a colour in the editor and state it.
- **With a theme that turns semantic highlighting off** (`editor.semanticHighlighting.enabled: false`, or a theme that sets it so), VS Code shows only the TextMate grammar: the grammar is the editor's source of colours there, as it is for any editor that does not read semantic tokens, and the colours then differ from the panel's. This design does not change that; it should be said in the user documentation of `bashExplainer.highlight.enabled`.
- **A line that cannot be explained** has no tokens in VS Code, and shows the colours of the grammar beneath (not the plain text colour as on the web page).
- **Cost on the extension host, to re-measure before step 3.** [theme-colours.md](theme-colours.md) ("Where the extension runs") justifies the local UI host by small costs: 36 ms for the semantic tokens of 2,000 lines of the whole file. A provider that explains every line costs about what the problems' pass costs (1.26 s for 1,500 lines in Node, lean, fresh tree, from the review), not 36 ms. The range provider (the visible range, 1-2.5 ms a line) is small; the full provider is not, and the host is shared with every other extension and runs on the user's machine or, in a remote window, locally. Either re-measure and answer the argument there (on the UI host the cost is on the user's own machine, in a task of its own; a cancelled request stops between lines), or let the full provider answer from the lines already explained and leave the others to the range provider.

## What is removed

When VS Code and the Language Server read the tokens too:

- src/highlight.ts: `highlight`, `documentHighlight`, `hostedHighlight`, `lineSpans`, `isOption`, `isPattern`, `operandKind`, `glob`, `HighlightKind`, `HIGHLIGHT_KINDS`. src/semanticFacts.ts, whose facts the explanation already has (what a name runs, `resolveName`; options by the specs, `interpret`); its `readonly` and `exported` modifiers go with it (dropped, 2026-11-06).
- src/semanticTokens.ts keeps the encoding (`encodeTokens`, `LEGEND`, `SUPER_TYPES`), with the roles' token types in place of `TOKEN_OF`.
- Tests: test/highlight.test.ts and test/semanticFacts.test.ts go (their cases that state what bash reads move to the explanation's tests where they are not there yet); test/highlight-speed.test.ts becomes a speed test of the colours of a range of lines; test/semanticTokens.test.ts and test/semantic-scopes.test.ts read the roles.
- On main, replaced in the proof of concept (branch `one-colour-source`) and to go in step 1: web/editor-colors.ts's `CLASSIC_COLOURS`, `CLASSIC_ROLE`, `PANEL_KIND_ROLE` and `kindColour`, and the web editor's use of `documentHighlight`. Later: the hover's `KIND_ROLE` (src/ui/render.ts), and the other tables of the inventory above where one table replaces them.

## What users see change

- The editor colours what the panel colours: an option's value (`--date=short`), the command's own language (a regex's operators, sed's commands, a format's directives), the body of a here-document and the target of a redirection (the redirect's colour), the whole of an assignment.
- Plain arguments take the panel's colour (green) instead of the foreground.
- A readonly variable is no longer bold, an exported one no longer underlined.
- The body of a here-document is coloured as a string, in the editor and in the panel.
- A line that cannot be explained has no colour in the editor (before, it had the colours of the tree).

## Steps

Each keeps every test green. A proof of concept of step 1 exists on the branch `one-colour-source` (PR #627, closed) and is not merged; it is the reference for the steps, not their first PR.

Step 0 is five changes, each a PR of its own, in this order (findings of the review of the proof of concept):

- 0a. The here-document body's string token in the explanation (decision of 2026-11-06). This changes explanations: the snapshots (test/snapshot.ts), the pinned counts in test/fixtures/command-tokens-known.json and the bash-ast test (test/bash-ast.test.ts, test/fixtures/bash-ast-known.json) may change in this PR, and the panel's tests with them.
- 0b. A per-line time bound for the colours (above, "Cost"), with a test on a line of 1,000 pairs `"a0" $x0` and one of 3,000: the line is skipped, the others coloured, and no task is longer than the bound plus one slice.
- 0c. A line that cannot be explained or is over its bound: no colours in the editors (decision of 2026-11-06).
- 0d. The problems' pass waits for the colour slices (above, "Strategy"), measured again with the CPU slowed 4 times on 1,500 lines (main: about 1.1 s to the final colours; the proof of concept: 3.5 s).
- 0e. The cache key of the colours holds only the options the colours read.

Then:

1. The web editor from the tokens of the lines in view, with the lean explanations shared with the problems (`leanExplanation`), as in the proof of concept.
2. The one table.
   - 2a. `KIND_ROLES` and the colours of the web page: media/panel.css, `ROLE_COLOURS` generated from the table (not repeated), media/panel.js's `THEME_ROLES`; the editor's italic comments decided once for the editor and the panel (or dropped). The hover's `KIND_ROLE` goes.
   - 2b. The other tables of the inventory read from it: src/ui/palette.ts and the CLI's `ANSI`.
3. VS Code and the Language Server, with the points of that section settled first: the cost of the full provider (re-measure), the token type of `argument` and of `redirect`, what a theme with semantic highlighting off and a line not explained show.
   - 3a. The range provider: semantic tokens from `lineColours` for the visible range, in VS Code and the Language Server (`range`). An integration test that a theme colours each token as the panel's `theme` palette reads it.
   - 3b. The full provider and the Language Server's `full`, from the lines the diagnostics have explained and the rest as measured.
4. src/highlight.ts and src/semanticFacts.ts removed, with their tests (above).

Outside the colours, measured here: the problems' pass explains every line of the script in one task after each change (1.4 s on 1,500 lines). Slicing it, or a worker, is a step of its own (#673, "A worker with time and memory limits").

## Measurements in the browser

(Measured on the proof of concept, branch `one-colour-source`.) The proof of concept in Chromium (Playwright's headless shell, 1280x800), on the web page built from the PR, at full speed and with the CPU slowed 4 times (CDP `Emulation.setCPUThrottlingRate`); medians of 5 keystrokes (a letter typed at the end of a line in the middle of the script, with that part in view). The page marks its work with User Timing (`bx-colours-slice`, `bx-colours-done`, `bx-problems`, `bx-panel`), which the script reads. The machine was shared with other test runs; two runs a few minutes apart differed by up to 30%.

| After a keystroke | sample.sh | sample.sh, CPU / 4 | 1,500 lines | 1,500 lines, CPU / 4 |
| --- | --- | --- | --- | --- |
| First colours (the debounce of 100 ms, then the first slice) | 121 ms | 191 ms | 218 ms | 883 ms |
| Final colours of the lines in view | 157 ms | 767 ms | 229 ms | 3,512 ms |
| First slice (with the models of the script) | 13 ms | 52 ms | 76 ms | 471 ms |
| Longest slice of the colours | 14 ms | 52 ms | 76 ms | 471 ms |
| Slices | 4 | 8 | 2 | 3 |
| The problems' pass (`diagnosticsFor`, one task) | 21 ms | 236 ms | 421 ms | 2,391 ms |
| Longest task on the main thread | under 50 ms | 249 ms | 429 ms | 2,426 ms |
| Total blocking time, 3 s after the keystroke | 0 ms | 366 ms | 457 ms | 3,094 ms |

| Other moments | sample.sh | sample.sh, CPU / 4 | 1,500 lines | 1,500 lines, CPU / 4 |
| --- | --- | --- | --- | --- |
| Load to the first colours (the page's own sample) | 657 ms | 2,601 ms | (same page) | (same page) |
| A scroll to the end: the new lines in view coloured | 26 ms | 66 ms | 31 ms | 72 ms |
| The whole script pasted: final colours | 143 ms | 631 ms | 5,708 ms | 26,240 ms |
| The whole script pasted: longest task | 122 ms | 546 ms | 4,651 ms | 21,895 ms |

- The colours themselves block the page for one slice: 12 ms and less at full speed, except the first slice after a change, which builds the models of the script (76 ms on 1,500 lines, 471 ms with the CPU slowed 4 times).
- The long tasks are the problems' pass, which explains every line in one task (`bx-problems`), as it does on main. When the CPU is slow, it runs (300 ms after the change) between the colours' slices and holds back the last ones: the final colours of a 1,500-line script come 3.5 s after the keystroke, the first ones after 0.9 s. On main the final colours of the same script, same slowed CPU, came after about 1.1 s: the proof of concept's final colours come later than main's on a slow CPU, because of that ordering (a step 0 item: the colour slices finish before the problems' pass starts).
- Pasting a whole 1,500-line script blocks the page for 4.7 s at full speed. The colours' longest slice there is 135 ms (603 ms slowed); the long task is other work on the new text, which main has too (4.6 s; 22.0 s slowed).
- On main (same machine and scripts, measured right after): the longest task after a keystroke 53, 322, 426 and 2,321 ms, the total blocking time 3, 502, 479 and 3,210 ms (in the order of the table's columns). So the colours from the tokens block the page no more than today's colours (their final colours may come later on a slow CPU, as said above; and a single long line freezes the page before any colour, which main does not, see "Cost"): on main, the first long task after a keystroke on 1,500 lines is, by its time, the shading of `documentHighlight` (130-184 ms at full speed, 716-1,009 ms slowed), where the proof of concept has its first slice (76 ms, 471 ms).

## Agreement with the panel

The comparison of characters run on the proof of concept: the editor's colour of each character (from the lean explanation, in English) against the panel's (from its full explanation, in Japanese, with what the panel's default state needs), in the light and the dark theme. Every character agrees: 33,472 characters on 1,808 lines of sample.sh, coverage.sh, renderings.sh and the 1,500-line script, and 32,856 characters on the 2,545 lines of the snippets. By construction: the two read the same tokens through the same table. So the agreement shows that the editor and the panel agree, not that the colours are right (a token of the wrong kind is wrong in both); the correctness of the tokens is the explanation's tests, against bash and the tools.

## Open questions

None of the earlier four is open (decided 2026-11-06, above). Left to the steps: the points of "VS Code and the Language Server" that the review raised (the cost of the full provider, the token types of `argument` and `redirect`), and whether the italic of comments stays.
