# The hover

What the hover explains, how it looks, the name hints, and why the inline summary was removed. Built from a design study in real VS Code (the prototypes on the branches `proto/hover-inline` and `proto/hover-inline-2`), with the maintainer's choices.

The code: `src/ui/hoverParts.ts` (which part a position explains, and which notes are about it), `src/ui/hoverView.ts` (the Markdown), `src/ui/hover.ts` (VS Code), `cli/lsp.ts` (the Language Server), `web/hover.ts` and `web/hover-markdown.ts` (the web page: "Web page" below). Tests: `test/hover-view.test.ts`, `test/web-hover.test.ts`.

## The rule

Any hover request with a position explains the part at that position. VS Code asks for one position; it does not say whether the mouse or the keyboard asked. So the position decides, never the trigger:

- The part is the innermost token that covers the position. A token that ends exactly there counts too, as an editor finds the word at the cursor: the cursor just after `-rn`, or at the end of the line, explains `-rn`.
- A position on no part (the indentation, a blank between statements) gets a small card: the line's structure as one breadcrumb, and a link "Whole line".
- On a line of a here-document's body, or its closing delimiter, the part is the operator `<<EOF` that starts it (or a part of the body, such as `$USER`). The syntax tree gives the lines of the body (`heredocAt` in src/document.ts), since the operator's token covers only `<<EOF`.
- The hover returns the part's range, cut to the line. VS Code asks again when the mouse leaves it, so moving to the next word explains that word, and the editor highlights what is explained.

The whole line opens only through our command (`Ctrl+K Ctrl+E`, the context menu) and the link "Whole line".

| Trigger | VS Code asks at | The hover shows | Range |
| --- | --- | --- | --- |
| Mouse on a word, an option, an operator (`\|`, `&&`) | that character | the part | the part |
| Mouse on a blank inside a command | that character | the word that ends there, else the command | the part |
| Mouse on the indentation, between statements | that character | the line card | the run of blanks |
| Mouse past the end of the line | (VS Code does not ask) | nothing | |
| `Ctrl+K Ctrl+I` (VS Code's Show Hover) on a word | the cursor | the part | the part |
| `Ctrl+K Ctrl+I` at the end of the line | the end of the line | the last word (it ends there) | the part |
| `Ctrl+K Ctrl+I` in the indentation | the cursor | the line card | the run of blanks |
| `Ctrl+K Ctrl+E`, the context menu (ours) | the cursor | the whole line | the line |
| The link "Whole line" | (moves the cursor to the line, then ours) | the whole line | the line |
| `hover.followCursor` | the cursor | the part | the part |
| A statement over several lines (`\`) | that character | the part on that line; on the `\`, the command | cut to the line |
| A here-document's body or closing line | that character | `<<EOF`, or a part of the body | the line, or the part |
| Language Server `textDocument/hover` | that character | the part, then the whole line below `---` | the part, or the line |

## The views

The part: a breadcrumb of the parts around it with the link "Whole line" beside it, then the part's label coloured by its kind, its name-kind badge and "run by" (a command name), its meaning, "Same name, also", its own parts (one level; deeper ones are counted as "N more in the panel"), and the command it belongs to. Its notes (warnings first, each with its level: [note-levels.md](note-levels.md); which ones: "Notes" below), and the examples of the part, come after, so that the first lines (about 250 px) answer what the part is. The last line before the footer is a link "N more notes on this line" when the line has notes the part does not show.

The line card: the structure as one breadcrumb (`sudo | xargs › sudo · xargs`, each part with its meaning as a tooltip), and the link.

The whole line ("B" of the study): the line, coloured; its structure as a breadcrumb; then one block per command, and per part with commands in it, in the order bash runs them: the label, the badge, "run by", the meaning, where it is ("in: …"), and its arguments two levels deep. Deeper parts are counted as "N more in the panel", with the link. The notes of the line come after the blocks. Examples follow `examples.placement` (`first`: before the block's arguments; `last`: after them; `bottom`: at the end).

The Language Server sends plain Markdown (editors other than VS Code show no HTML) and no command links: the part first, with its notes, then the whole line below `---`, with all of them. On no part, the whole line alone.

## Notes

The part shows only the notes about it and its own parts; the whole line shows every note of the line. A note says something about one part far more often than about the line, and a hover on `rm` in `rm $f; read line` that also says `read` lacks `-r` answers a question the reader did not ask.

- **Where a note is about.** A note found on a node carries its range (`LineExplanation.anchors`, made by `anchored` in src/noteanchors.ts): a word fact (src/wordfacts.ts) or a style check (src/pitfalls.ts) on its node, a dialect issue on its construct, a fact of the catalog that the analyzer says (`say(fact, node)`: the node is required), a status fact (src/statusfacts.ts) on its statement, an idiom on the narrowest statement it was found in, the effect of several redirections on each of them. The notes of a string run as a script (`bash -c '…'`) keep theirs, moved to the line's columns, and a host file's lines move them as they move the tokens (src/hosts/remap.ts). A line's notes are texts beside their data ([note-levels.md](note-levels.md), "Notes as data"), so an anchor is a note's text and a range; a note found on several nodes has several.
- **The rule** (`isAbout` in src/ui/hoverParts.ts). A note is about the part when its range lies within the part or within one of the part's own parts, or when the range is larger and the part starts it. So a note on a whole command shows on its name, not on each argument; a note on a pipeline (`pipefail-missing`) shows on its first command. On `rm $f; read line`: the unquoted-path warning (on `$f`) shows on `$f` and on `rm`, whose argument it is; the `read` caveat (on `read line`) shows on `read`, not on `line`; the `;` shows neither.
- **Notes about the line.** A note with no range is not shown in the part, only counted: the line of a here-document's body or its closing delimiter, a statement that started on an earlier line, the zsh syntax that could not be parsed, and the notes of a host file (a Makefile variable, a CI step), except a bats file's own facts, which are on their statements. Over test/fixtures/sample.sh, 36 of the 38 notes have a range, every warning and caveat among them; the two without are here-document lines.
- **Problems shown above.** VS Code puts the diagnostics at the position above our hover, as plain text that we cannot style. The part leaves out a note that one of them already says (`partNotes`, with the `problems` of `HoverInput`; src/ui/hover.ts reads them with `vscode.languages.getDiagnostics`). The match is by identity, not by text: a note's anchor carries the code of the problem it is (`NoteAnchor.code`: a fact's id, a style check, a dialect issue). The note is left out when a problem at the position has that code, on a range that overlaps the anchor's. With the problems off (`diagnostics.enabled`), or the code in `diagnostics.ignore`, nothing is published, so the part keeps the note. Such a note is not counted in the link either, since the hover shows it. The whole line and the Language Server's hover keep every note.
- **The link.** "N more notes on this line" counts every note of the line the part does not show (about other parts, or about the line), and opens the whole line as the link **Whole line** does. The line card and the whole line are unchanged: the card has no notes, the whole line has them all, warnings first.
- **The look.** A note is a paragraph: the level's icon and word in its colour, then the text ([note-levels.md](note-levels.md)). It is not a quote: VS Code's hover (1.142) gives a `<blockquote>` no bar, only the browser's margins (40 px on each side), so a quoted note stood indented for no visible reason.


## No tree glyphs

The hover once drew the tree with glyphs (`├─ └─ │`) inside `<code>`. The study tried them inside and outside `<code>`, as bars, and as a `<pre>` block. VS Code's hover keeps only a few styles on `<span>` (a colour, a background, `display:inline-block`, `border-radius`, in that order; the test checks the exact pattern of VS Code 1.142), so it cannot set a font or `white-space` itself:

- outside `<code>` the font is proportional, so a glyph and a space are not as wide, and the columns drift;
- inside `<code>` the background of each row breaks the vertical lines between rows;
- an explanation that wraps breaks the lines too, and `<pre>` does not wrap at all.

So the hierarchy is indentation (non-breaking spaces), and the labels are coloured by kind, with no code background. The study used `<samp>` for them, but VS Code does not style `<samp>`: it falls back to the browser's default monospace font, which is Courier on macOS. The labels are plain coloured spans instead, in the hover's font. A label in the narrow first column has a word joiner after each hyphen, so that `-name *.gz -mtime` does not break after a dash.

The structure (lists, pipelines, constructs) is one line, a breadcrumb, instead of the rows of a tree.

## Name hints

An inlay hint after a command name, only where the name does not run what a reader would guess (`src/ui/nameHints.ts`, from the name facts of src/semantics/names.ts): nothing runs; a program runs where bash has only a builtin of the name (`sudo cd`); a function or an alias hides a builtin or a program; a builtin turned off by `enable -n`; an alias that bash does not expand here. A name the reader asked for is not marked: `builtin cd`, `command ls`, `\ls`, a program that `sudo` or `xargs` runs. The study first put a hint after every name and every option of the cursor line; that repeated what the hover says and moved the code as the cursor moved. Hints on surprises only are rare, so they can stay on every line in view.

The hint is plain text (VS Code shows no Markdown in a hint); its tooltip says what runs, who runs it, the other meanings of the name and what it does. A click opens the line in the panel. `bashExplainer.hints.names` turns them off; VS Code's `editor.inlayHints.enabled` turns every hint on, off, or on while `Ctrl+Alt` is held. The Language Server gives the same hints (`textDocument/inlayHint`), with the tooltip and no command.

The web page has no inlay hints of its own, so its editor draws the same hints as CodeMirror widgets (web/name-hints.ts): muted text on a faint tint after the name, inline so that it wraps with the line. Only the lines in view are explained, once per parse, language, shell and settings, after the text has rested (300 ms) or at once on a scroll. Hovering a hint shows its tooltip, with "Click to explain this line in the panel"; a click puts the cursor on the name, so the panel explains the line. The page's settings have `hints.names` too.

VS Code (1.142) keeps a copy of the hints of the line whose hint the mouse is on, and puts it back when the mouse moves off, even after the hints were asked for again. A setting changed in between (the language) left that one hint stale. So for a minute after a refresh, a move of the cursor asks for the hints again.

## Web page

The web page's editor shows VS Code's part hover too: option B of a design study (the prototype on the branch `proto/web-hover`), chosen by the maintainer. The page's panel already explains the line at the cursor, so the panel is its whole line, and the cards are the part and the line card only. There is no whole-line card on the web.

| Trigger | The page shows |
| --- | --- |
| The pointer on a part | the part's card (`partHover`) |
| The pointer on the indentation, on a blank between statements | the line card (`lineCard`) |
| The pointer past the end of the line | nothing |
| The pointer on a name hint | the hint's own tooltip |
| `Ctrl+K Ctrl+I` (`⌘K ⌘I` on a Mac) | the card at the cursor, and the page's live region tells a screen reader that it is shown and how to reach it; pressed again, the focus goes into the card, and Tab reaches its links. Escape, a click outside the editor, an edit or a move of the cursor closes it |
| `Ctrl+K Ctrl+E`, the links "Whole line", "N more notes on this line" and "Open in panel" | no card: the cursor goes to the line (to its first word, unless it is on the line already), so the panel explains it |
| The link "Settings" | the page's settings |
| A touch screen (`hover: none`) | nothing: a tap moves the cursor, and the panel follows it |

- **One source.** A card is hoverView's Markdown, with the extension's commands as its links. `web/hover-markdown.ts` turns it into DOM, as VS Code's hover does. First a reader of the CommonMark that hoverView writes: paragraphs, rules, headings, quotes, fences and HTML blocks (`<table>`); code spans of any length, backslash escapes, entities, raw tags, links with a title, emphasis by the rules of delimiter runs, and `$(icon)`. Then an allow-list: the elements and span styles that VS Code's hover keeps (`test/hover-view.test.ts`), links to the sections of the manual (opened in a new tab), and the extension's commands, which become the page's actions. Scripts, styles, handlers and other links are dropped. **Links.** A link keeps its address only when it is exactly one of the manual's pages (`SECTIONS` in src/manual.ts, the list hoverView builds its links from); any other link, even an `https:` one, keeps its text only, since a script (a share link carries one) must never put a link in a card. `md()` in hoverView, which writes explanations with words of the script in them, also turns every character that Markdown or HTML reads outside code spans into an entity (VS Code gets the same Markdown). The icons are Codicons, from `media/icons.js`. `test/web-hover.test.ts` renders every card of the sample and checks that no Markdown syntax is left in the page.
- **The problem at the pointer.** CodeMirror's lint shows it in the same box, above the card. The card leaves out the notes that it says, as in VS Code ("Problems shown above"): `HoverInput.problems` comes from the lint's diagnostics at the position (`forEachDiagnostic`, by the rule of the lint's own tooltip), with each problem's code. From the keyboard no problem shows, so the card keeps every note.
- **The keys** are bound in a compartment of the highest precedence, and only while `hover.enabled` is on. Off, the page shows no card, and `Ctrl+K` and `Ctrl+E` go to the browser. `Ctrl+I` alone stays CodeMirror's own key (it selects the syntax around the cursor).
- **The setting.** `hover.enabled` is in the page's settings, with a description of its own (`SettingSpec.description`), since the one in package.json is about VS Code's commands. `hover.maxDepth`, `examples.inHover` and `hover.followCursor` stay VS Code's: the page's cards are whole, and its panel already follows the cursor.
- **Inside the pane.** Every tooltip of the editor (the cards, the problems, the name hints) stays inside the editor's pane, 8 px from the window's edges (CodeMirror's `tooltipSpace`). The box is no wider than the pane or 520 px. A long box scrolls as one, the problem above the card with it, as VS Code's hover does: on a narrow pane, a long problem would otherwise leave the card no room. A card near the top no longer covers the top bar.
- **Under the whole line** (docs/design/chrome-redesign.md, decision 10). Long lines wrap (`editor.wrap`), so a card is anchored to the whole line, from the top of its first row to the bottom of its last, at the part's x: it goes under the line, or above its first row when the room under it is short and the room above larger, never over a row of the line. It is at most min(50vh, 420 px) high and no higher than the room on its side; a longer card scrolls inside, with the pointer, and with the keyboard once `Ctrl+K Ctrl+I` has put the focus in it. `cardPlace` in src/ui/cardPlace.ts decides the side and the height from the line's rows, the pane and the window; web/hover.ts measures them.
- **The way to the card.** The pointer on its way from a part to the card crosses the line's later rows, whose words would take the hover over. While it moves from the part towards the card, within 600 ms (`towardCard`, as menus keep a submenu), the editor does not see those moves, and the card stays. When the time is up and the pointer is not on the card, it closes.

## Why the inline summary was removed

The inline summary was a faint line at the end of the cursor line: the line's summary, cut to `inline.maxLength`. The study tried to keep it (the part at the cursor instead of the line, as eldoc does), and found:

- it said one thing about a whole line, which for most lines is the first command, and the hover says the same and more;
- it moved with the cursor, so the end of every line the cursor passed flickered, and a long line pushed it out of view;
- it was off by default, and the study found no case it served that the part hover, `Ctrl+K Ctrl+E` and the name hints do not.

So it was removed rather than kept beside them. Its settings stay, deprecated (`markdownDeprecationMessage`, in both languages), with no effect, and a user who had it on gets a notice once per session until "Don't show again" (`src/ui/inlineNotice.ts`).
