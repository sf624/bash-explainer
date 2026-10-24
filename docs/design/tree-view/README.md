# Tree view: prototypes

The panel's tree view shows who reads each part of a line, in four layers: bash parses the line into commands, and a simple command into its assignments, its command name, its arguments and its redirections (3.7.1); a shell parses a text again as a script (a subshell, the text of each `$( )`, `<( )` and backquotes; another shell, a string `bash -c` runs; this shell, a string `eval` or a trap reads; a remote shell, `ssh host cmd`); each command reads its arguments as its spec says (options, operands, subcommands); and some words hold a language of their own (a regex, a glob, a sed script, a jq filter, a printf format), which the command reads, or bash itself for `[[ =~ ]]`. The prototypes below were made before the layer of bash read simple commands as name and arguments, and before a string read again said which shell reads it. The model is `readingTree` in [src/reading.ts](../../../src/reading.ts); the layers come from the syntax tree, whose commands are bash's own ([syntax-tree.md](../syntax-tree.md), "Command nodes at bash's granularity"), and from `Token.origin` (src/analyzer-types.ts), which the analyzer sets where it makes each token.

Three prototypes came before it. The panel follows the folding tree (C). The other two are kept here to be tried again later. They are design documents, not part of the extension or the web page: no bundle includes them (test/offline.test.ts checks what the bundles hold).

The panel's rows were then tried in three looks (draft PR #286: the list's rows; an outline; two columns). The panel follows the outline; see [The panel's look](#the-panels-look) below.

| File | Prototype | What it shows |
| --- | --- | --- |
| [proto-a.html](proto-a.html) | A. Brackets under the code | The line as written, with a row of brackets under it per layer. A dashed line marks where bash's part ends and the commands' reading begins. Hover or tab to a bracket to see who reads that part. |
| [proto-b.html](proto-b.html) | B. Line unfolding | Six steps, played or stepped through: the plain line, its words and operators, its commands, the child bash in `$( )`, each command's options and arguments, the languages inside them. With reduced motion, it shows the last step at once. |
| [proto-c.html](proto-c.html) | C. Folding tree | An indented tree that folds and unfolds, with nested bands for the layers and a toggle that adds them one at a time (bash, + child bash, + commands, + languages). It follows the ARIA tree pattern for the keyboard and screen readers. |

Each one is a single HTML file with no library, about 8–9 KB gzipped, and works offline, light and dark, down to phone width. Open it in a browser; `?ex=1` shows the second line, and `proto-b.html?step=5` the last step.

## Their data

The prototypes show two lines: `x=$(grep -c foo f) && [ "$x" -gt 0 ]` and `find . -name '*.sh' | xargs grep -n 'set -e'`. Their data, [viz-data.json](viz-data.json), is the reading tree of each line from the model, in the shape the prototypes were written for (layers `bash`, `child`, `cmd`, `lang`; offsets `s`, `e`; a `note` per node). [vizdata.ts](vizdata.ts) makes it, and [build.mjs](build.mjs) inlines it, with the shared [src/common.css](src/common.css) and [src/common.js](src/common.js), into each prototype from its source in [src/](src/). From the root of the repository:

```sh
npx tsx docs/design/tree-view/vizdata.ts > docs/design/tree-view/viz-data.json
node docs/design/tree-view/build.mjs
```

(The first versions were made from a converter that guessed the layers from the tokens' labels. The model replaced it.)

## Screenshots

[screenshots/](screenshots/) has one picture of each prototype, taken in headless Chromium from the files above, on the first line, with the four layers shown:

- `proto-a-1280-light.png`: A, 1280 pixels wide, light theme. The purple brackets are bash's reading (the top rows), the blue ones the child bash's, the green ones the commands' (under the dashed line), the orange ones the regex.
- `proto-b-1280-light.png`: B at its last step, 1280 pixels, light. Each box is a node; a box with a dashed border is what a command reads.
- `proto-c-1280-light.png`: C, 1280 pixels, light: every node unfolded, with a band per layer (purple bash, blue child bash, green a command, orange a language) and the band's name at its right.
- `proto-c-360-dark.png`: C, 360 pixels, dark theme: on a phone, the notes after the nodes are left out and the indent is smaller.

The colours are those of the panel's roles: bash is the keyword colour, the child bash the command colour, a command's reading the argument colour and a language the option colour (media/panel.css).

## The panel's look

The panel draws the folding tree as an outline (media/panel.css, `treeItem` in media/panel.js):

- Each row has the code in a pill, in the colour of its role as in the list, and the kind after it in the layer's colour. The text has a line of its own under them, in the foreground colour, or muted and in italics where it says what the kind is in general. Where a new reader takes over, its name is at the right of the first line, before the manual's links.
- Lines drawn with borders join the rows: a vertical line per group of children, under the middle of the parent's twisty, and an elbow to each child at the middle of its pill. The line stops at the last child's elbow. Where a new reader takes over, the elbow is 2 pixels thick, in the layer's colour.
- The item where a new reader takes over, and everything under it, has a light tint of the layer's colour. The tint is opaque: 6% of the layer's colour mixed with the background, not laid over the tint around it. So a band inside a band has the same tint as one at the top, and text measures the same on every band. The pill has the background's colour, so its code measures as on the page.
- The high contrast themes have no tint: each band has a 1-pixel outline in the layer's colour (an outline takes no room, so the lines stay where they are). With the system's forced colours, the outline and the lines are in `CanvasText`.

Contrast, measured in Chromium on the web page's Light Modern and Dark Modern colours (test/contrast.test.ts checks the tints; test/web-tree.test.ts the geometry):

| Text | Light | Dark |
| --- | --- | --- |
| The kind and the reader's name, on its layer's tint (lowest) | 4.74 (child shell) | 4.97 (child shell) |
| The muted text, on any tint (lowest) | 5.58 | 5.40 |
| The code in its pill (lowest: the command colour) | 5.16 | 5.37 |

Before, the bands were laid over each other at 7% each: a language inside a command's band inside a child shell's had a darker tint at every level, and the kind `literal` measured 3.56 in light and 3.65 in dark; the code was on a code block's grey (4.61 for the command colour).
