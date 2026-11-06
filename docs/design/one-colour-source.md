# One colour source: the editor's colours from the explanation's tokens

Status: proposed. The web editor is coloured this way in a proof of concept (#627, web only); VS Code and the Language Server are designed here, not built.

The maintainer agreed on the direction (2026-11-06): the editors (the web page's CodeMirror editor, VS Code, the Language Server's clients) take the colour of each part of the shell code from the tokens of its explanation, the same source as the panel's colours, instead of deciding it from the syntax tree themselves. The editor will then colour inside regular expressions and formats too, as the panel does.

## The problem: two sources of the same facts

Today the editors are coloured by src/highlight.ts (`highlight`, `documentHighlight`, `hostedHighlight`): the tree's node types, a guess of options from a leading `-` (`isOption`), of globs (`isPattern`, `glob`) and of the operands of builtins (`operandKind`), with src/semanticFacts.ts painted over it (what a name runs, options by the specs). The panel colours its line from the explanation's tokens (`panelUpdate(...).lineRuns`, src/ui/panelView.ts). The two read the same line apart:

| Line | Editor (highlight.ts) | Panel (tokens) |
| --- | --- | --- |
| `git log --pretty=format:'%h %an' --date=short` | `--pretty=format:` plain, `=short` plain, `%h` a string | the option's value an option, `format:` a keyword of git's format, `%h` a variable (the command's own language, from git's spec) |
| `grep -E '^a+'` | `'^a+'` a string | `^` and `+` operators of the regex |
| `sed 's/a/b/'` | a string | `s` a command of sed, `/` its delimiters |
| `cat <<EOF` … | the body a string | the body the redirect's |
| `make > build.log` | `build.log` plain | the redirect's target, the redirect's |

Measured with the comparison of characters (each character not blank, its colour in the editor against the panel's, in the light and the dark theme of the web page; script in the PR): on main, 1,786 of 3,067 characters of test/fixtures/sample.sh agree (58%), and 20 of its 123 lines (16%); over the 2,051 snippets of the test corpus, 21,959 of 32,856 characters (67%) and 557 of 2,545 lines (22%). The editor leaves plain arguments in the foreground, which the panel colours (445 characters of the sample); without those, 27% of the sample's characters and 21% of the snippets' still differ.

The table of kind to colour is written six times: `KIND_ROLES` (src/roles.ts), `KIND_ROLE` (src/ui/render.ts, the hover), `PANEL_KIND_ROLE` and `CLASSIC_ROLE` (web/editor-colors.ts), `TOKEN_OF` (src/semanticTokens.ts, a highlight kind to a semantic token type), `ROLE_PROBES` (src/ui/themeTokens.ts, a role to the token type a theme is read with), and the `.kind-*` rules of media/panel.css.

## What gives the colours

Every token of the line's explanation (`LineExplanation.items`, at every depth), each character taking the role of the deepest token over it: `lineOwners` (src/ui/render.ts), which the panel's line box already uses (`lineRuns`). Not the rows of depth 1: the depth control chooses the panel's rows, and the line box colours by the deepest token whatever the depth, so that `%h` is a variable inside the option's value. `lineColours` (src/ui/lineColours.ts, new) gives the runs of a line with their roles; a blank no token covers has none.

One mapping, in two steps:

1. Kind to role: `KIND_ROLES` (src/roles.ts), the one table (docs/design/sources.md, SB3a). `lineColours` reads it; the panel's `.kind-*` rules are checked against it (test/token-roles.test.ts).
2. Role to colour, per surface:
   - The web page (editor, panel, hover): the CSS colour of the role, `ROLE_COLOURS` (web/editor-colors.ts), which test/editorColours.test.ts compares with what media/panel.css gives each `.kind-*` through the variables of body. A later step writes the panel's role variables from this table, as scripts/level-css.ts does for the levels, and the hover's `KIND_ROLE` goes.
   - VS Code and the Language Server: the role's semantic token type, the `token` of `ROLE_PROBES` (src/ui/themeTokens.ts). That is the type the panel reads the theme's colour with when `bashExplainer.panel.colors` follows the theme, so a theme colours a part in the editor as the panel shows it. `TOKEN_OF` and the highlight kinds go.

The kinds and spans of the tokens depend neither on the language nor on the options the problems leave out (examples, idioms, the reading tree, the argv, the POSIX notes). Measured on every non-empty line of sample.sh, coverage.sh and the snippets (2,850 lines): the runs of `lineOwners` are the same in Japanese and in English (0 lines differ), and the same with the problems' lean options as with the panel's (0 lines differ). So the colours read the lean explanations the problems already make (`noteIssues`): `leanExplanation` (src/document.ts) keeps them per tree, language, shells and options, and the problems and the colours share them, whichever asks first.

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

## Strategy

As built in the proof of concept (web/token-colours.ts):

- **Only the lines in view**: those on the screen first (`visibleRanges`), then the rest of what CodeMirror draws (its viewport, a margin around the screen). On a scroll, the lines that come into view at once.
- **After typing**: the marks move with the text (mapped through the changes), and the lines in view are coloured again 100 ms after the last change, as today's colours were. A line out of view keeps its moved marks until it comes into view.
- **In slices**: at most 12 ms of explaining per task, then the page gets the main thread back (`setTimeout(0)`); the first slice also builds the models of the script, which cannot be split. A change while the slices run drops the rest (the change schedules its own).
- **Each painted line replaces its own marks**, so a line keeps its old colours until its new ones come, never a blank.
- **The cache is the tree**: each change makes a new tree, and a line is explained once per tree, language, shells and options (`leanExplanation`). A key per line (its text) would be wrong: an edit above a line changes how bash reads it. Measured on sample.sh, inserting one line at its top changes the colours of later lines: `shopt -s expand_aliases; alias grep=ls` 4 of 122, a function `grep() { :; }` 4, an unclosed `cat <<EOF` 121, an unclosed `echo "` 122, an unclosed `if true; then` 1 (`alias ll=ls` without `expand_aliases`, `set -o posix` and `readonly HOME` none). A key per line that is right would hold every fact of the state the line reads (aliases, functions, options, open here-documents and quotes, the statement over several lines it is in); the tree is the key that is always right, and what it costs is measured above.
- **First paint**: on load, the lines in view at once (no debounce).
- **Shared with the problems**: the problems' pass, 300 ms after a change, finds the lines in view explained.

## Lines that cannot be explained, and host files

- **Text bash cannot read while typing** (an unclosed quote, `if` without `fi`): the tree still has the nodes the parser made, and the explanation tokens for them, an `error` token where bash cannot read the text. An unclosed `"` makes the rest of the script a string, as bash reads it; the panel shows the same. Nothing else colours these lines.
- **A line that the line's budget or a bug stops** (`lineNotExplained`, src/analyzer.ts): one `error` token over the whole line, so the whole line takes the error's colour in the editor, as in the panel. An open question below.
- **Host files** (Markdown, Makefile, Dockerfile, YAML, bats…): `explainDocumentLine` already explains a host's line from its region's own tree, with the tokens mapped back to the document (src/hosts/remap.ts), so the colours need no `hostedHighlight`. A line outside the shell code has no tokens; the host's own mode colours it (the CodeMirror legacy modes on the web page; the language's grammar in VS Code), as today.
- **No fallback from highlight.ts.** Nothing from the tree is drawn before the tokens, not even comments and strings: a second source of those would differ from the tokens where they differ today (the body of a here-document, an unclosed quote), and the only moment without colours is the first paint of a script, or a jump to lines never shown, for the time measured below. What stays of src/highlight.ts is nothing that names a part; the wrap runs (src/ui/wrapRuns.ts) are where long lines may break, not colours, and the faded dead code comes from the model's diagnostics.

## VS Code and the Language Server

Today VS Code colours shell scripts with its own TextMate grammar (the built-in `shellscript` grammar), and our semantic tokens over it: a `DocumentSemanticTokensProvider` and a `DocumentRangeSemanticTokensProvider` (src/ui/semanticTokens.ts) send the spans of `documentHighlight`, as standard token types and modifiers (`TOKEN_OF`), which package.json's `semanticTokenScopes` map to scopes of that grammar ([highlighting.md](highlighting.md)). The Language Server sends the same tokens (`full` and `range`, cli/lsp.ts).

The design:

- The same two providers and the same legend; the spans of a line are `lineColours` of its lean explanation, from the service's cache per document version (the diagnostics' pass fills it, src/service.ts `diagnosticsFor`), each role sent as the token type of `ROLE_PROBES`. `semanticTokenScopes` keeps one entry per type, as now (a test checks that every type sent has one).
- The range provider answers for the visible range (VS Code asks it first, and on scrolls), explaining only those lines; the full provider answers from the same cache, and explains the lines the diagnostics have not (a whole-document request costs what the problems' pass costs, and is shared with it). Both stop between lines when VS Code cancels the request. To check in that step: whether VS Code then still asks for the full document of a long file, or whether the range provider alone is better there.
- The extension host is not the window's thread, but it also answers the panel and the hover: the providers explain no more than they are asked for, and the panel's line comes first.
- The theme: [theme-colours.md](theme-colours.md). With `bashExplainer.panel.colors` set to follow the theme, the panel takes the theme's colour of each role from the same token types (`ROLE_PROBES`), so the editor and the panel show the same colour for each part. With the panel's own palette (the default), the colours differ by design, but the parts do not: what is one role in the panel is one token type in the editor. `themeLike`, which keeps the roles distinct where the theme colours two alike, changes only the panel.
- The `argument` role has no token type of its own in `ROLE_PROBES` (the theme's colour of a plain argument is the grammar's): it is sent as `string` with our modifier `unquoted`, which `semanticTokenScopes` maps to the grammar's plain argument, as `TOKEN_OF` sends a word read as data today.

## What is removed

When VS Code and the Language Server read the tokens too:

- src/highlight.ts: `highlight`, `documentHighlight`, `hostedHighlight`, `lineSpans`, `isOption`, `isPattern`, `operandKind`, `glob`, `HighlightKind`, `HIGHLIGHT_KINDS`. src/semanticFacts.ts, whose facts the explanation already has (what a name runs, `resolveName`; options by the specs, `interpret`); its `readonly` and `exported` modifiers move to the tokens if they are kept (below).
- src/semanticTokens.ts keeps the encoding (`encodeTokens`, `LEGEND`, `SUPER_TYPES`), with the roles' token types in place of `TOKEN_OF`.
- Tests: test/highlight.test.ts and test/semanticFacts.test.ts go (their cases that state what bash reads move to the explanation's tests where they are not there yet); test/highlight-speed.test.ts becomes a speed test of the colours of a range of lines; test/semanticTokens.test.ts and test/semantic-scopes.test.ts read the roles.
- Already in the proof of concept: web/editor-colors.ts's `CLASSIC_COLOURS`, `CLASSIC_ROLE`, `PANEL_KIND_ROLE` and `kindColour`, and the web editor's use of `documentHighlight`. Later: the hover's `KIND_ROLE` (src/ui/render.ts).

## What users see change

- The editor colours what the panel colours: an option's value (`--date=short`), the command's own language (a regex's operators, sed's commands, a format's directives), the body of a here-document and the target of a redirection (the redirect's colour), the whole of an assignment.
- Plain arguments take the panel's colour (green) instead of the foreground.
- A readonly variable is no longer bold, an exported one no longer underlined (the proof of concept drops them; below).

## Steps

Each keeps every test green.

1. The proof of concept (this PR): the web editor from the tokens of the lines in view; the lean explanations shared with the problems (`leanExplanation`); `ROLE_COLOURS`, one table of role to colour for the web page, checked against media/panel.css.
2. The hover's colours from `KIND_ROLES` and the same role colours (`KIND_ROLE` of src/ui/render.ts goes); the panel's role variables written from the table.
3. If kept: `readonly` and `exported` on the tokens of variables, from the model's trust (`trusts()`, as src/semanticFacts.ts reads it now), and the web editor's classes for them again.
4. VS Code and the Language Server: semantic tokens from `lineColours`, as above; an integration test that a theme colours each token as the panel's `theme` palette reads it.
5. src/highlight.ts and src/semanticFacts.ts removed, with their tests (above).

Outside the colours, measured here: the problems' pass explains every line of the script in one task after each change (1.4 s on 1,500 lines). Slicing it, or a worker, is a step of its own.

## Measurements in the browser

The proof of concept in Chromium (Playwright's headless shell, 1280x800), on the web page built from the PR, at full speed and with the CPU slowed 4 times (CDP `Emulation.setCPUThrottlingRate`); medians of 5 keystrokes (a letter typed at the end of a line in the middle of the script, with that part in view). The page marks its work with User Timing (`bx-colours-slice`, `bx-colours-done`, `bx-problems`, `bx-panel`), which the script reads. The machine was shared with other test runs; two runs a few minutes apart differed by up to 30%.

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
- The long tasks are the problems' pass, which explains every line in one task (`bx-problems`), as it does on main. When the CPU is slow, it runs (300 ms after the change) between the colours' slices and holds back the last ones: the final colours of a 1,500-line script come 3.5 s after the keystroke, the first ones after 0.9 s.
- Pasting a whole 1,500-line script blocks the page for 4.7 s at full speed. The colours' longest slice there is 135 ms (603 ms slowed); the long task is other work on the new text, which main has too (4.6 s; 22.0 s slowed).
- On main (same machine and scripts, measured right after): the longest task after a keystroke 53, 322, 426 and 2,321 ms, the total blocking time 3, 502, 479 and 3,210 ms (in the order of the table's columns). So the colours from the tokens block the page no more than today's colours: on main, the first long task after a keystroke on 1,500 lines is, by its time, the shading of `documentHighlight` (130-184 ms at full speed, 716-1,009 ms slowed), where the proof of concept has its first slice (76 ms, 471 ms).

## Agreement with the panel

The comparison of characters run on the proof of concept: the editor's colour of each character (from the lean explanation, in English) against the panel's (from its full explanation, in Japanese, with what the panel's default state needs), in the light and the dark theme. Every character agrees: 33,472 characters on 1,808 lines of sample.sh, coverage.sh, renderings.sh and the 1,500-line script, and 32,856 characters on the 2,545 lines of the snippets. By construction: the two read the same tokens through the same table.

## Open questions

- Plain arguments: green in the editor too (one table, as built), or the foreground in the editor only (a rule of the surface, as before)?
- A line the budget or a bug stops is one `error` token: the whole line in the error's colour, in the editor too. Keep it, or leave such a line uncoloured in the editor?
- `readonly` and `exported`: keep them (step 3) or drop them?
- The body of a here-document takes the redirect's colour (its token is the redirect's). Should the explanation give the body a token of its own (a string), which the panel would then show too?
