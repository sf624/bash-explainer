# Tree view: prototypes

The panel's **Reading** view (internally the tree view: ids, classes and `panelState` use `tree`) shows who reads each part of a line, in four layers: bash parses the line into commands, and a simple command into its assignments, its command name, its arguments and its redirections (3.7.1); a shell parses a text again as a script (a subshell, the text of each `$( )`, `<( )` and backquotes; another shell, a string `bash -c` runs; this shell, a string `eval` or a trap reads; a remote shell, `ssh host cmd`); each command reads its arguments as its spec says (options, operands, subcommands); and some words hold a language of their own (a regex, a glob, a sed script, a jq filter, a printf format), which the command reads, or bash itself for `[[ =~ ]]`. The prototypes below were made before the layer of bash read simple commands as name and arguments, and before a string read again said which shell reads it. The model is `readingTree` in [src/reading.ts](../../../src/reading.ts); the layers come from the syntax tree, whose commands are bash's own ([syntax-tree.md](../syntax-tree.md), "Command nodes at bash's granularity"), and from `Token.origin` (src/analyzer-types.ts), which the analyzer sets where it makes each token.

## The names of the two views

The panel has two views, named **Meaning** (ja 「意味」) and **Reading** (ja 「読まれ方」). Before, they were List and Tree.

- **Meaning** answers "what does each part mean?". Its units are the explainer's own, and each part is named by its final role: in `grep -rn foo`, `-rn` is the options `-r` and `-n`, and `foo` is the search pattern.
- **Reading** answers "who reads each part, and in what order?". Its layers are those of the manual: bash parses, expands and runs; each command reads its arguments; languages inside words are read by the command. This is closer to a universal tree, which is why the shape is a tree here and the first view is a list of meanings.

Only the labels changed (`ui[lang].panel.listView` / `treeView` in src/ui/render.ts). Identifiers (`panelState` values `'list'` and `'tree'`, CSS ids and classes, storage keys) are unchanged, so a stored choice keeps working.

Three prototypes came before it. The panel follows the folding tree (C). The other two are kept here to be tried again later. They are design documents, not part of the extension or the web page: no bundle includes them (test/offline.test.ts checks what the bundles hold).

The panel's rows were then tried in three looks (draft PR #286: the list's rows; an outline; two columns). The panel follows the outline; see [The panel's look](#the-panels-look) below.

| File | Prototype | What it shows |
| --- | --- | --- |
| [proto-a.html](proto-a.html) | A. Brackets under the code | The line as written, with a row of brackets under it per layer. A dashed line marks where bash's part ends and the commands' reading begins. Hover or tab to a bracket to see who reads that part. |
| [proto-b.html](proto-b.html) | B. Line unfolding | Six steps, played or stepped through: the plain line, its words and operators, its commands, the subshell of `$( )`, each command's options and arguments, the languages inside them. With reduced motion, it shows the last step at once. |
| [proto-c.html](proto-c.html) | C. Folding tree | An indented tree that folds and unfolds, with nested bands for the layers and a toggle that adds them one at a time (bash, + scripts inside, + commands, + languages). It follows the ARIA tree pattern for the keyboard and screen readers. |

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

- `proto-a-1280-light.png`: A, 1280 pixels wide, light theme. The purple brackets are bash's reading (the top rows), the blue ones the subshell's, the green ones the commands' (under the dashed line), the orange ones the regex.
- `proto-b-1280-light.png`: B at its last step, 1280 pixels, light. Each box is a node; a box with a dashed border is what a command reads.
- `proto-c-1280-light.png`: C, 1280 pixels, light: every node unfolded, with a band per layer (purple bash, blue the shell of a script inside, green a command, orange a language) and the band's name at its right.
- `proto-c-360-dark.png`: C, 360 pixels, dark theme: on a phone, the notes after the nodes are left out and the indent is smaller.

The colours are those of the panel's roles: bash is the keyword colour, the shell of a script inside the command colour, a command's reading the argument colour and a language the option colour (media/panel.css).

## The panel's look

The panel draws the folding tree as an outline (media/panel.css, `treeItem` in media/panel.js):

- Each row has the code in a pill, in the colour of its role as in the list, and the kind after it in the layer's colour. The text has a line of its own under them, in the foreground colour, or muted and in italics where it says what the kind is in general. Where a new reader takes over, its name is at the right of the first line, before the manual's links.
- Lines drawn with borders join the rows: a vertical line per group of children, under the middle of the parent's twisty, and an elbow to each child at the middle of its pill. The line stops at the last child's elbow. Every elbow is the same thin, uncoloured line; the band's tint already shows where a new reader takes over.
- The item where a new reader takes over, and everything under it, has a light tint of the layer's colour. The tint is opaque: 6% of the layer's colour mixed with the background, not laid over the tint around it. So a band inside a band has the same tint as one at the top, and text measures the same on every band. The pill has the background's colour, so its code measures as on the page.
- The high contrast themes have no tint: each band has a 1-pixel outline in the layer's colour (an outline takes no room, so the lines stay where they are). With the system's forced colours, the outline and the lines are in `CanvasText`.

Contrast, measured in Chromium on the web page's Light Modern and Dark Modern colours (test/contrast.test.ts checks the tints; test/web-tree.test.ts the geometry):

| Text | Light | Dark |
| --- | --- | --- |
| The kind and the reader's name, on its layer's tint (lowest) | 4.74 (script inside) | 4.97 (script inside) |
| The muted text, on any tint (lowest) | 5.58 | 5.40 |
| The code in its pill (lowest: the command colour) | 5.16 | 5.37 |

Before, the bands were laid over each other at 7% each: a language inside a command's band inside a subshell's had a darker tint at every level, and the kind `literal` measured 3.56 in light and 3.65 in dark; the code was on a code block's grey (4.61 for the command colour).

## Playing the tree (a prototype)

Behind a temporary switch, the panel's tree view can be played as prototype B was: `?treePlay=1` on the web page (or `data-tree-play="1"` on the panel's `<html>`) adds controls at the end of the layer buttons (step back, Play, step forward, replay). Play starts from bash's layer alone and adds the layers one by one, 1.2 seconds a step; the items a step adds grow from their parent, and a new reader's band takes its tint from the band around it. `?treePlay=deep` first unfolds bash's own reading: the line, its lists and pipelines, its commands, their words, inside the words (by depth in the tree). Steps that add nothing to the line are left out. The last step leaves every layer shown, as the layer buttons say.

Play is a toggle button (`aria-pressed`); Space plays or pauses from any of the controls, and the arrows, Home and End step. A polite live region says the step ("Step 2 of 4: scripts inside"). With reduced motion, Play shows the last step at once, and the steps change without motion. A new line, or a layer button, stops the play. The code is `playSteps` and what follows it in media/panel.js; nothing of it runs without the switch.
