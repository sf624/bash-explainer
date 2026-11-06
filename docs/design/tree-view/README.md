# Tree view: the reading tree and the panel's look

Status: replaced by [panel-redesign.md](../panel-redesign.md). The Reading view, its eight steps and its tabs are gone since P8 (one view with a depth); this page records the choices made that still hold (the names, the look, the motion and the anchoring). `readingTree` (src/reading.ts) is still the model of depth 2.

The panel's **Reading** view (internally the tree view: ids, classes and `panelState` use `tree`) shows who reads each part of a line, in four layers: bash parses the line into commands, and a simple command into its assignments, its command name, its arguments and its redirections (3.7.1); a shell parses a text again as a script (a subshell, the text of each `$( )`, `<( )` and backquotes; another shell, a string `bash -c` runs; this shell, a string `eval` or a trap reads; a remote shell, `ssh host cmd`); each command reads its arguments as its spec says (options, operands, subcommands); and some words hold a language of their own (a regex, a glob, a sed script, a jq filter, a printf format), which the command reads, or bash itself for `[[ =~ ]]`. The model is `readingTree` in [src/reading.ts](../../../src/reading.ts); the layers come from the syntax tree, whose commands are bash's own ([syntax-tree.md](../syntax-tree.md), "Command nodes at bash's granularity"), and from `Token.origin` (src/analyzer-types.ts), which the analyzer sets where it makes each token.

## The names of the two views

The panel has two views, named **Meaning** (ja 「意味」) and **Reading** (ja 「読まれ方」). Before, they were List and Tree.

- **Meaning** answers "what does each part mean?". Its units are the explainer's own, and each part is named by its final role: in `grep -rn foo`, `-rn` is the options `-r` and `-n`, and `foo` is the search pattern.
- **Reading** answers "who reads each part, and in what order?". Its layers are those of the manual: bash parses, expands and runs; each command reads its arguments; languages inside words are read by the command. This is closer to a universal tree, which is why the shape is a tree here and the first view is a list of meanings.

Only the labels changed (`ui[lang].panel.listView` / `treeView` in src/ui/render.ts). Identifiers (`panelState` values `'list'` and `'tree'`, CSS ids and classes, storage keys) are unchanged, so a stored choice keeps working.

Three prototypes (A, brackets under the code; B, line unfolding; C, a folding tree) came before the panel, which follows the folding tree (C). Their files, data and screenshots were removed; they are kept in the repository history ([the folder at its last commit](https://github.com/sf624/bash-explainer/tree/ba115e963cd42c13f352d743f3f2aeba951ba81e/docs/design/tree-view)).

The panel's rows were then tried in three looks (draft PR #286: the list's rows; an outline; two columns). The panel follows the outline; see [The panel's look](#the-panels-look) below.

## The panel's look

The panel draws the folding tree as an outline (media/panel.css, `treeItem` in media/panel.js):

- Each row has the code in a pill, in the colour of its role as in the list, and the kind after it in the layer's colour. The text has a line of its own under them, in the foreground colour, or muted and in italics where it says what the kind is in general. Where a new reader takes over, its name is at the right of the first line, before the manual's links.
- Lines drawn with borders join the rows: a vertical line per group of children, under the middle of the parent's twisty, and an elbow to each child at the middle of its pill. The line stops at the last child's elbow. Every elbow is the same thin, uncoloured line; the band's tint already shows where a new reader takes over.
- The item where a new reader takes over, and everything under it, has a light tint of the layer's colour. The tint is opaque: 6% of the layer's colour mixed with the background, not laid over the tint around it. So a band inside a band has the same tint as one at the top, and text measures the same on every band. The pill has the background's colour, so its code measures as on the page.
- The band's edges show where it starts and ends, since a 6% tint alone is faint: a 2-pixel rule in the layer's colour down its left side, and a 1-pixel hairline at its top and its bottom, 80% of the layer's colour mixed with the background. There is no edge on the right, where nested bands end together. The edges are borders, with negative margins that give back their room, so the content and the outline's lines stay where they are; a shadow inside the band would be painted over by the row under the pointer. Two bands next to each other (`find`'s `.` and `-name *.log`) are two brackets, not one bar. The rule measures as the layer's text (4.5:1 and more), and the hairline at least 3:1 against the background and every layer's tint (test/contrast.test.ts); test/web-tree.test.ts checks the borders and that the lines did not move.
- The high contrast themes have no tint and no such edges: each band has a 1-pixel outline in the layer's colour (an outline takes no room, so the lines stay where they are). With the system's forced colours, the outline and the lines are in `CanvasText`.

Contrast, on the web page's Light Modern and Dark Modern colours: the texts measured in Chromium, the edges computed from the colours (test/contrast.test.ts checks the tints and the edges; test/web-tree.test.ts the geometry):

| Text | Light | Dark |
| --- | --- | --- |
| The kind and the reader's name, on its layer's tint (lowest) | 4.74 (script inside) | 4.97 (script inside) |
| The muted text, on any tint (lowest) | 5.58 | 5.40 |
| The code in its pill (lowest: the command colour) | 5.16 | 5.37 |
| A band's left rule, on the background or any tint (lowest) | 4.66 | 4.77 |
| A band's hairline (80% of its colour), on the background or any tint (lowest) | 3.23 | 3.48 |

Three edges were tried on the 6% tint (screenshots in the PR): a 1-pixel outline all round, a 3-pixel rule on the left alone, and the rule with hairlines at the top and the bottom. The outline drew a box for every band, and nested boxes shared their right edge, which made it heavy. The rule alone did not show where a band ends, and two bands of the same colour next to each other looked like one. The rule with the hairlines shows both ends and stays light; it is the one kept.

Before, the bands were laid over each other at 7% each: a language inside a command's band inside a subshell's had a darker tint at every level, and the kind `literal` measured 3.56 in light and 3.65 in dark; the code was on a code block's grey (4.61 for the command colour).

## Motion

Rows grow from their parent when they are unfolded and shrink into it when they are folded, in both views: a twisty or a click, the keys, Collapse all and Expand all, and a step (`fold` in media/panel.js; 220 ms, longer for a tall box up to 400 ms (`motionMs`), height and opacity, the margins of its children inside it while it moves, a row's examples folding with its parts, clipped only top and bottom so the outline's lines show). The state changes at once (the class, `hidden`, `aria-expanded`), so the keys, screen readers and tests see the new state; a box that folds is still drawn (`data-closing`) until it has shrunk. Only the outermost boxes of a change move, and those inside follow, so Collapse all moves one box per branch and nothing jumps at the end. A step back shrinks the rows it takes away before the tree is drawn again; a step forward grows the new rows (one after the other, 30 ms apart) and a new reader's band takes its tint and its edges from the band around it. A fold started while another runs starts from where that one is.

`bashExplainer.panel.animations` (default on; VS Code and the web page) turns the motion off; so does `prefers-reduced-motion: reduce`, and VS Code's `workbench.reduceMotion` (VS Code puts the class `vscode-reduce-motion` on the webview's body). Without motion, rows appear and go at once.

## Anchoring

The row the viewer acted on does not move on the screen: not when the change starts, not during the motion, not at its end (`hold` in media/panel.js).

- A fold or an unfold (a twisty, a click on the row, the keys) holds the row clicked. Collapse all and Expand all hold the first row on the screen that stays drawn.
- A fold does not change the line explained. A click on a row (in both views), Enter or Space also selects the part in the editor, but only when it lies on the line the panel explains (`reveal`). A statement over several lines is explained from its first line (a `while … do … done` with a `case` inside), and its tree has rows on the lines after it: selecting one of those (`v) verbose=$OPTARG ;;`) moved the cursor to that line, the panel explained that line instead, and the tree the viewer was folding was gone. Pointing at any row still highlights its range in the editor. test/web-anchor.test.ts checks it in VS Code's panel and on the web page (wide, a phone, without motion): the clause folds and unfolds, the row stays, the line stays, and a row on the line is still selected.
- A step holds the first row of the tree on the screen, below the control row, that the new step still shows (`firstRowKept`); the control row itself is sticky and stays. When no row on the screen stays, the nearest row around the first one that stays is held.

Before the change, the panel notes where the row is on the screen. After it (in a microtask, before anything is drawn), at each frame of the motion (a frame's callback runs after the animations have stepped and before the frame is drawn), and when a move ends, it scrolls by how far the row has moved. A scroll by the viewer meanwhile is kept: the row moves with it. The row is found again each time by its path, since a step draws the tree anew. Without motion, only the first correction is needed.

The browser's own scroll anchoring is turned off (`overflow-anchor: none` on `html`). It chooses its own anchor node, it differs between engines, and it does nothing where the page gets shorter at its end.

That case needs room: when the content below the row shrinks while the page is scrolled to its end, the browser would clamp the scroll position and pull the page down. So the panel first holds the page with a spacer, a blank box placed absolutely from the top of the page (`#scroll-spacer`), as tall as the bottom of the screen; once the row's new place is known, only what is needed stays. As the viewer scrolls up, the part of the spacer below the screen is taken away: the scroll range narrows and nothing on the screen moves. The spacer is gone once the content reaches the bottom of the screen again. It is also dropped with a new line (the content is drawn anew), another view, and the quick reference; the next fold or step starts from it and keeps only what that change needs.

The panel scrolls as a page in all its hosts: VS Code's webview, the web page's frame beside the editor, and the same frame under the editor on a phone. test/web-anchor.test.ts checks the three, in both views, with motion and without, and near the end of the page and in its middle.
