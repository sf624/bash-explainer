# Panel colours from the editor theme

The panel colours each part of a line with a role: command, option, argument, keyword, redirect, variable. Its own palette ("classic") has six hues, taken from the theme's chart colours and made readable (src/ui/palette.ts, test/contrast.test.ts). It keeps every kind of part apart, but it does not look like the editor next to it.

The setting `bashExplainer.panel.colors` lets the panel follow the editor's colour theme instead. VS Code only: the web page has no editor theme to follow and keeps its own palettes.

| Value | What the panel shows |
| --- | --- |
| `classic` (default) | The panel's own palette, as before. |
| `theme` | Each role in the colour the theme gives it in the editor. A role the theme leaves in the foreground, or colours below 4.5:1 on a surface of the panel, keeps the classic colour. In a high contrast theme the bar is 7:1, so the panel's own 7:1 colours stay unless the theme's colour passes too. |
| `themeLike` | The theme's colours where they keep the panel's distinctions; where the theme gives two groups one colour (or leaves one in the foreground), a colour made to suit the theme. Readable on every surface. |

The code: src/ui/themeTokens.ts reads a theme and resolves the roles (pure), src/ui/themePalette.ts makes the palettes (pure), src/ui/colour.ts has the colour arithmetic, src/ui/themeColours.ts finds and reads the theme in VS Code, and src/ui/panel.ts and media/panel.js carry the messages.

## Reading the theme as VS Code does

VS Code has no API for a theme's token colours. The extension finds the theme in use and reads its files:

- The theme's name: `workbench.colorTheme`, or `workbench.preferred{Dark,Light,HighContrast,HighContrastLight}ColorTheme` when `window.autoDetectColorScheme` or `window.autoDetectHighContrast` is on.
- The file: the extension whose `contributes.themes` has that `id` (or label, when the theme has no id), among the extensions of the extension host the extension runs in (`vscode.extensions.all` lists only those).
- In a remote window (WSL, SSH, a dev container, Codespaces) the theme extensions are on the local side: VS Code ships none of them with its server, and installs a theme from the Marketplace locally. So the extension prefers the local side too (`"extensionKind": ["ui", "workspace"]`, see "Where the extension runs" below), and there it finds every theme. When it runs on the remote side (installed there only, under development with F5 from a remote window, or in Codespaces in a browser), no theme is found. VS Code's default themes (its extension theme-defaults: Dark 2026, Light 2026, Dark Modern, Light Modern, Dark+, Light+, Visual Studio Dark and Light, both high contrast ones) are then read from a copy: src/ui/vscodeThemes.json, made by scripts/vscode-themes.ts from the VS Code in `.vscode-test`, with only the `include`s, the rules that give a foreground and the semantic rules (58 KB). They are Microsoft's, under the MIT license of microsoft/vscode (THIRD_PARTY_NOTICES.md). The names VS Code gave them before (`Default Dark Modern`, `Default Dark+`…) find them too. The other themes VS Code ships (Monokai, Solarized, Abyss…) come from elsewhere under other terms, and are not copied.
- A theme that cannot be read either way leaves the panel's own colours, and VS Code shows a notice once a session for that theme: the panel cannot read it; on the remote side of a window (`ExtensionContext.extension.extensionKind` is `Workspace`), only the default themes can be, and installed on the local side it reads them all.
- The rules: the file and the files it `include`s (the included first), as JSON with comments; `tokenColors` may name a `.tmTheme` (a property list), and a theme may itself be a `.tmTheme`.
- The user's `editor.tokenColorCustomizations` (the shorthands `comments`, `strings`, `keywords`…, and `textMateRules`) and `editor.semanticTokenColorCustomizations` (`enabled`, `rules`), for every theme and then for this one (`"[Name]"`, `"[A][B]"`, `"[Dark*]"`).

Each role is then resolved as the editor colours that part of the line:

- With semantic highlighting (our `bashExplainer.highlight.enabled`, and `editor.semanticHighlighting.enabled` true, or left to a theme that turns it on): the theme's `semanticTokenColors` for our token (src/semanticTokens.ts: a builtin is `function.defaultLibrary`), then the theme's rules for the scopes our package.json gives the token type (`semanticTokenScopes`, read from the extension at run time, so a change there is followed), then VS Code's own default scopes for the type.
- Otherwise, or when nothing matched: the theme's rules for the scopes of VS Code's shell grammar, `source.shell` outermost. Each scope pushed takes the colour of the rule that matches it best, and keeps the outer one's when none does: an option (`string.unquoted.argument.shell constant.other.option.shell`) is a string's colour in a theme with no rule for options.
- A selector matches and ranks as in vscode-textmate (checked against its code in VS Code 1.142): split at single spaces, the last segment a prefix of the innermost scope, the others outer scopes in order (`>`: the very next one); a deeper last segment wins, then the longer parent segment, innermost first, then more parents, then the later rule. A colour that is not hex is dropped. An exclusion (`keyword - keyword.operator`, as in the `keywords` shorthand) matches nothing there, so it matches nothing here.
- When the theme has no semantic rule for a token, every default rule that matches it counts, the most specific first: VS Code's own (`parameter` is `variable.parameter`, `function.defaultLibrary` is `support.function`) and ours; the first whose scopes the theme colours gives the colour.

Checked against the editor: in VS Code 1.142 the colours of `ll`, `-a`, `+%Y`, `2>`, `|` and `=~` on a test line match the resolver for Dark Modern, Light Modern, Dark 2026, Light 2026 and both high contrast themes (computed colours of the editor's spans). A unit test pins Dark Modern's thirteen roles.

What the panel draws on comes from the webview itself: when the host asks (`themeWatch`), media/panel.js reports the editor's background, a code block's and a hovered row's, the editor's foreground, and the classic colour of each role (read from the panel's CSS with the theme's colours taken off), now and whenever VS Code changes the theme (`themeBase`). The host answers with the CSS variables (`themeColours`). Each role has a variable of its own (`--c-builtin`, `--c-string`, `--c-assignment`…), which defaults to its group's, so the classic palette is unchanged.

## Where the extension runs

In a remote window VS Code has two extension hosts: a local one (UI), next to the window, and a remote one (workspace), next to the files. An extension runs in one of them, and `vscode.extensions.all` lists the extensions of that host only. VS Code picks the host from the manifest's `extensionKind` and from where the extension is installed: with `["ui", "workspace"]`, the local host when it is installed locally (also when it is installed on both sides), else the remote host. Installing it from a remote window puts it on the local side; a copy installed on the remote side before keeps running there (VS Code offers "Install Locally" for it). Checked in VS Code 1.143.1 (`pickExtensionHostKind` and `getExtensionKind` in the workbench).

The extension needs nothing from the remote machine. It reads the documents VS Code gives it (on either side, as `vscode-remote:` documents), its settings, and its own files; it starts no process and reads no file of the workspace (test/offline.test.ts: `src/` imports only `vscode` and unbash, and the bundles require only `vscode`; the web bundle is built from the same entry). File names are cut at both `/` and `\`, so a Windows host finds a remote path's base name alike. What changes on the local side:

- The hover's key hint (`Ctrl+K Ctrl+E` or `⌘K ⌘E`) follows the platform of the window, not the remote one's.
- The sample commits of `git log` examples show times in the local time zone (they are made up, relative to now).
- The work is done on the local machine: 2,000 lines of test/fixtures/sample.sh take about 210 ms to parse and check after an edit (diagnostics, at most once in 500 ms), 36 ms for the semantic tokens of the whole file and 1 ms for a screen of them, and 2 ms to explain a line (Node 22, WSL2). In a local window the extension shares its host with every other extension already.

VS Code for the Web is unchanged: there the manifest's kinds get `web` added after them, and the browser's host picks `workspace` before `web`, so in Codespaces in a browser the extension runs in the codespace, as before; on vscode.dev it runs in the browser. VS Code takes `extensionKind` as a list since 1.40; the minimum is 1.85.

A user can also choose the side: `"remote.extensionKind": { "shun-fujioka.bash-explainer": ["ui"] }`.

## Which roles are frequent

Counted over the corpus (test/fixtures/sample.sh, the 1400 snippets of test/fixtures/snippets.json, test/fixtures/hosts/*): the kinds of the coloured segments of the panel's line (a run of characters under one innermost token).

| Kind | Segments | % | Characters | % |
| --- | ---: | ---: | ---: | ---: |
| string | 1185 | 13.6 | 2407 | 9.3 |
| command | 1106 | 12.7 | 4350 | 16.8 |
| argument | 1059 | 12.2 | 3516 | 13.6 |
| builtin | 738 | 8.5 | 2608 | 10.1 |
| variable | 712 | 8.2 | 2189 | 8.5 |
| operator | 700 | 8.0 | 1059 | 4.1 |
| keyword | 648 | 7.4 | 1598 | 6.2 |
| option | 631 | 7.2 | 2316 | 9.0 |
| pattern | 293 | 3.4 | 557 | 2.2 |
| test | 291 | 3.3 | 948 | 3.7 |
| block | 218 | 2.5 | 233 | 0.9 |
| expansion | 207 | 2.4 | 427 | 1.7 |
| redirect | 169 | 1.9 | 889 | 3.4 |
| assignment | 161 | 1.8 | 468 | 1.8 |
| number | 155 | 1.8 | 179 | 0.7 |
| function | 152 | 1.7 | 666 | 2.6 |
| substitution | 121 | 1.4 | 192 | 0.7 |
| error | 56 | 0.6 | 174 | 0.7 |
| subcommand | 49 | 0.6 | 216 | 0.8 |
| comment | 44 | 0.5 | 829 | 3.2 |
| alias | 20 | 0.2 | 38 | 0.1 |

By role (a role holds the kinds the panel colours alike): command 15.2% of the segments (with functions, subcommands, aliases), operator 13.8 (with `[[ ]]` and `{ }`), string 13.6, argument 12.2, variable 12.0 (with expansions and `$( )`), builtin 8.5, keyword 7.4, option 7.2; then pattern 3.4, redirect 1.9, assignment 1.8, number 1.8, comment 0.5. The eight roles at 5% or more are the frequent ones (`FREQUENT`); together they are 90% of the segments.

## themeLike

The panel's distinctions are its groups, the roles its own palette colours alike: command (with builtin), option, text (argument, string, number), keyword (with operator), redirect (with pattern), variable (with assignment), comment. Text the theme leaves in the foreground counts as text.

1. The foreground is placed first, as text.
2. In order of frequency, each role takes the theme's colour, made readable if needed (its lightness moved in OKLCH, hue and chroma kept, until it reaches 4.5:1, or 7:1, on every surface). It keeps it unless that colour is closer than ΔE<sub>OK</sub> 8 (×100) to a role of another group placed before it; for a frequent role the bar is 5, so that a theme's command colour stays even when it is near the foreground (Dark Modern's #DCDCAA against #CCCCCC is 7.5).
3. A role that does not keep its colour takes the colour of a group mate that kept one (an operator in the foreground takes the keyword's colour, as in the classic palette).
4. A group with no colour left gets a new one: lightness and chroma within the range of the theme's own chromatic colours (C ≥ 0.04), the hue (every 5°) that is farthest from all colours in use (the largest smallest ΔE<sub>OK</sub>), readable on every surface; the range widens in lightness, towards more contrast, until some colour is readable.
5. The surfaces are the backgrounds and, outside high contrast, the Reading view's tints, which the palette makes itself (6% of the layer colour), with a hovered row or a code block over each; the palette is worked out again on its own tints until it no longer changes (at most four rounds).

Within a group the theme's choice stays: in Dark Modern a builtin is the command's #DCDCAA, as in the editor (the name's badge says builtin).

In Dark Modern, the result keeps the theme's colours for command, builtin, option, argument, string, keyword and variable; the number (#B5CEA8, near the command's #DCDCAA) takes the argument's #CE9178, and the operator the keyword's #C586C0 (the theme draws it in the foreground); the comment's #6A9955 becomes #73A25E (it was 4.4:1 on a code block); redirect and pattern, foreground and near the string in the theme, get a new teal #4BC9BB.

## Distinctness and contrast

Measured over the themes' own files (test/support/themes.ts: VS Code's defaults where a theme leaves a colour out), with the grammar's colours (semantic highlighting off, our default). ΔE<sub>OK</sub> is the smallest difference between two roles of different groups (×100, the foreground counted as text), with the pair; ΔE2000 the smallest CIEDE2000 between such pairs; contrast the smallest of any role on the surfaces (the backgrounds, the tints, and a hovered row or a code block over a tint), with the role that is lowest on the backgrounds.

| Theme | classic | theme | themeLike |
| --- | --- | --- | --- |
| Dark Modern | 8.4 (option/redirect) · 12.9 · 4.52 (command) | 0.0 (operator/redirect) · 0.0 · 4.71 (option) | 7.5 (foreground/command) · 17.2 · 4.66 (comment) |
| Light Modern | 0.0 (foreground/comment) · 0.0 · 4.61 (command) | 0.0 (operator/redirect) · 0.0 · 4.54 (comment) | 8.7 (argument/redirect) · 15.9 · 4.64 (number) |
| Dark 2026 | 9.1 (foreground/redirect) · 14.8 · 4.00 (comment) | 0.0 (argument/pattern) · 0.0 · 3.94 (comment) | 6.7 (builtin/operator) · 5.8 · 4.64 (comment) |
| Light 2026 | 10.3 (redirect/comment) · 16.5 · 3.91 (command) | 0.0 (argument/pattern) · 0.0 · 3.92 (number) | 10.0 (builtin/comment) · 7.4 · 4.53 (builtin) |
| Default High Contrast | 11.5 (option/variable) · 17.5 · 9.03 (keyword) | 0.0 (option/argument) · 0.0 · 7.51 (comment) | 6.7 (command/operator) · 9.2 · 7.38 (option) |
| Default High Contrast Light | 0.0 (foreground/comment) · 0.0 · 7.91 (command) | 0.0 (option/argument) · 0.0 · 7.93 (number) | 10.0 (number/comment) · 10.2 · 7.20 (keyword) |
| Monokai | 8.4 (option/redirect) · 14.7 · 3.57 (command) | 0.0 (foreground/variable) · 0.0 · 3.62 (keyword) | 11.0 (command/argument) · 14.4 · 4.51 (option) |
| Solarized Dark | 3.0 (foreground/comment) · 3.4 · 3.76 (command) | 3.0 (foreground/comment) · 3.4 · 3.76 (command) | 10.7 (keyword/comment) · 19.0 · 4.57 (option) |
| Solarized Light | 3.5 (foreground/comment) · 9.5 · 3.77 (comment) | 3.5 (foreground/comment) · 9.5 · 3.77 (comment) | 10.7 (variable/comment) · 12.1 · 4.53 (command) |
| One Dark Pro | 0.0 (foreground/comment) · 0.0 · 4.03 (command) | 0.0 (foreground/operator) · 0.0 · 4.11 (keyword) | 9.1 (foreground/builtin) · 13.7 · 4.53 (variable) |
| Dracula | 8.4 (option/redirect) · 14.7 · 3.55 (command) | 0.0 (argument/pattern) · 0.0 · 3.51 (keyword) | 9.2 (variable/comment) · 13.1 · 4.53 (option) |
| GitHub Dark Default | 8.4 (option/redirect) · 14.7 · 2.82 (comment) | 0.0 (foreground/variable) · 0.0 · 2.79 (comment) | 8.0 (builtin/argument) · 7.0 · 4.57 (comment) |
| GitHub Light Default | 11.8 (option/redirect) · 16.5 · 4.18 (command) | 0.0 (foreground/variable) · 0.0 · 4.22 (comment) | 11.5 (command/keyword) · 12.6 · 4.50 (keyword) |
| Night Owl | 8.4 (option/redirect) · 14.7 · 2.67 (command) | 0.0 (builtin/variable) · 0.0 · 2.67 (command) | 8.0 (variable/comment) · 11.8 · 4.51 (number) |
| Tokyo Night | 6.1 (option/redirect) · 12.7 · 2.14 (comment) | 0.0 (command/variable) · 0.0 · 2.09 (comment) | 7.2 (command/operator) · 6.7 · 4.68 (comment) |
| Catppuccin Mocha | 0.0 (foreground/comment) · 0.0 · 4.46 (variable) | 0.0 (foreground/variable) · 0.0 · 4.77 (comment) | 7.0 (argument/operator) · 8.9 · 4.77 (comment) |
| Catppuccin Latte | 0.0 (foreground/comment) · 0.0 · 3.72 (command) | 0.0 (foreground/variable) · 0.0 · 3.72 (command) | 8.8 (builtin/number) · 8.8 · 4.58 (argument) |

What the table says:

- `theme` merges groups in every theme (an operator and a redirect are one colour in Dark Modern, both the foreground), as the editor does. Its contrast is the classic palette's where it falls back, so it is below 4.5:1 where the classic colours are (the chart colours and the muted comment colour on the backgrounds of Monokai, Night Owl, Tokyo Night and others).
- `themeLike` keeps every pair of groups at least 5 apart (a colour kept from the theme is 8 from those before it unless its role is frequent; a colour made is as far as it can be, not bounded) and every role readable, 4.5:1 or 7:1, in all 46 themes the tests read (VS Code's and the six extensions'), with and without semantic highlighting.
- The classic palette's own minimum is often the comment, which is the theme's muted `descriptionForeground` and the foreground in several themes (ΔE 0).

## Screenshots

Each theme in VS Code 1.142, the editor and the panel side by side on a line with a command, a builtin, an alias, a function, options, a redirect, a pipe, a variable, a string, `$( )` and a regex, in classic, theme and themeLike, in both views. They were looked at for the pull request that added the setting, and are not kept in the repository. The third-party themes were installed from Open VSX into the test instance only (all MIT): One Dark Pro 3.20.3, Dracula 2.25.1, GitHub Theme 6.3.5, Night Owl 2.1.1, Tokyo Night 1.1.2, Catppuccin 3.19.0.

## Tests

- test/themeColours.test.ts: the colour arithmetic; reading a theme (includes, `.tmTheme`, customizations); selectors and their ranking; the resolution of the roles; the palettes, and their guarantees as properties over every theme the tests can read: VS Code's bundled themes from `.vscode-test` (in this checkout or a folder above it) and the extensions unpacked in `$BASH_EXPLAINER_THEMES`. Without them those tests are skipped; no theme file is in the repository.
- test/panel-theme.test.ts: the panel's messages in headless Chromium.
- The copy of the default themes (test/themeColours.test.ts): it is what scripts/vscode-themes.ts makes from the VS Code it names, and gives every role the colour the theme's own files give it, with and without semantic highlighting (when that VS Code is in `.vscode-test`). The integration test (integration/extension.itest.ts) reads the default theme, Light Modern and Default High Contrast with no extension at all, as a remote window does, and gets the colours it reads from their extension; and Monokai, read there, is named as a theme the panel cannot read.
- A remote window, simulated in VS Code 1.143.1: the extension installed from its .vsix and given an extension host of its own with `extensions.experimental.affinity` (ignored for an extension under development), so that theme-defaults is in another one. Before the copy, `theme` and `themeLike` left the panel in its classic colours, in user and workspace settings, set before the window opened or while the panel was open; with it, the panel's colours are those of a local window.
- A real remote window, in VS Code 1.143.1: the VS Code server of the same commit, run on 127.0.0.1 with data and extension folders of its own, and a test resolver (the proposed API `resolvers`, enabled with `--enable-proposed-api`) that connects the window to it. With Monokai Pro (a Marketplace theme, installed locally) and `theme`: installed locally, or on both sides, the extension ran in the local host (its log says so) and the panel took Monokai Pro's colours, also with `themeLike`; installed on the remote side only, or loaded for development from a remote path (as F5 from a Remote - WSL window does), it ran in the remote host and showed the notice.

## Limits

- While themes are previewed in the theme picker, VS Code does not write `workbench.colorTheme`, so the panel keeps the token colours of the theme set, on the previewed theme's backgrounds, until one is chosen.
- The probe scopes stand for the grammar's: a theme rule for a `meta.*` scope around a command is not seen.
- When the extension runs on the remote side of a window (installed there only, under development, Codespaces in a browser), only VS Code's default themes can be read, as of the VS Code the copy was made from (src/ui/vscodeThemes.json names it); with another theme, the panel keeps its own colours and says so. When VS Code changes a default theme, run `npx tsx scripts/vscode-themes.ts` with that VS Code in `.vscode-test`.
