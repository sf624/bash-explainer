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

## Steps and Play

The tree view unfolds in eight steps (`STEPS` in media/panel.js). Steps 1 to 5 are bash's own reading, by the kind of each node: 1 the line, 2 its lists and pipelines, 3 its commands (simple and compound, clauses, functions), 4 their words (the command name, arguments, assignments, redirections, operators and reserved words), 5 inside the words (quotes, expansions, and what bash reads in a substitution). Steps 6 to 8 add the other readers: the scripts inside (a child shell), each command's reading of its arguments, and the languages. A node appears at its own step or its parent's, whichever is later, so each step shows the one before it and more. The panel keeps the step as the viewer's choice (`PanelState.step`; `level`, which it kept before, is read as the last step of that layer).

A step that adds nothing to the line is kept (the buttons do not change from line to line) but dimmed, with "adds nothing on this line" in its name; the arrows, the step buttons ◁ ▷ and Play pass it over. Play starts from the line alone (or goes on from a step chosen by hand), shows each step for 1.2 s, and ends at step 8; a step chosen by hand, a new line or another view stops it. The text a kind has in general ("A simple command: …") goes on the first node of that kind to appear, by step and then in order, so it stays on the same row from step to step instead of moving down as earlier rows appear.

### The control: three layouts compared

Eight steps do not fit as buttons in a 300 px VS Code panel or on a 390 px phone. Three layouts were built and compared (screenshots at 1280, 600, 300 px as VS Code's panel and 390 px as the web page on a phone, light and dark):

| Layout | Wide (1280) | 600 px | 300 / 390 px | Keyboard and ARIA |
| --- | --- | --- | --- | --- |
| **Segments** (the default) | one row: a numbered button per step, in its reader's colour, the steps before the current one lightly tinted | folds into a stepper `◁ 4/8 Words ▾ ▷` (one line, 30 px) | the same stepper; its middle opens the steps as a menu | buttons, one Tab stop (the current step, `aria-current="step"`); the arrows step and the focus follows; the menu button has `aria-expanded`, Escape closes it |
| Slider | a range with the step numbers under its stops and the current name beside it | one line (46 px) | wraps to two or three lines (75–107 px) | the range's own keys; `aria-valuetext` says "Step 4 of 8: words" |
| Readers + depth | the four readers' buttons, and in bash's a `− 4/5 +` depth stepper | wraps to two lines (59 px) | three or four lines (88–136 px) | two kinds of control to learn; the depth is hidden inside one reader |

Segments is the default: on a wide panel it shows every step at once (a click jumps anywhere, and the tints read as progress); on a narrow one it stays one line high, which matters because the control row is sticky; and the steps are always one list, in one order, with one set of keys. The slider has no names for its stops where it is narrow, and the readers' layout splits one sequence into two controls and grows to several lines. The other two are kept for comparison behind a temporary switch: `data-step-layout="slider"` or `"layers"` on the panel's `<html>`, or `?stepLayout=` on the web page. They are to be removed once the choice is final.

Before the stepper, the label "Show" and Play's text go (`.tight`); the stepper takes over only when the row still does not fit (`fitControls`, measured, so it follows the language and the panel's width). Every control is at least 24 px (VS Code), and 40 px on a touch screen and on the web page at phone widths. Step back and forward flank the steps; Play (a toggle, `aria-pressed`) and Replay are at the end. A polite live region says each step ("Step 2 of 8: lists and pipelines"), and "Paused".

The control row sticks under the line at the top (`#layers`, `top: var(--line-h)`); `--controls-h` keeps a row reached with the keys below both. While Play adds rows below the fold, the panel scrolls to the first one, under the controls.

## Motion

Rows grow from their parent when they are unfolded and shrink into it when they are folded, in both views: a twisty or a click, the keys, Collapse all and Expand all, and a step (`fold` in media/panel.js; 220 ms, height and opacity, clipped only top and bottom so the outline's lines show). The state changes at once (the class, `hidden`, `aria-expanded`), so the keys, screen readers and tests see the new state; a box that folds is still drawn (`data-closing`) until it has shrunk. Only the outermost boxes of a change move, and those inside follow, so Collapse all moves one box per branch and nothing jumps at the end. A step back shrinks the rows it takes away before the tree is drawn again; a step forward grows the new rows (one after the other, 30 ms apart) and a new reader's band takes its tint from the band around it. A fold started while another runs starts from where that one is.

`bashExplainer.panel.animations` (default on; VS Code and the web page) turns the motion off; so does `prefers-reduced-motion: reduce`, and VS Code's `workbench.reduceMotion` (VS Code puts the class `vscode-reduce-motion` on the webview's body). Without motion, rows appear and go at once, and Play still steps.
