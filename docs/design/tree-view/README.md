# Tree view: prototypes

The panel's tree view shows who reads each part of a line, in four layers: bash parses the line into commands, and a simple command into its assignments, its command name, its arguments and its redirections (3.7.1); a shell parses a text again as a script (a subshell, the text of each `$( )`, `<( )` and backquotes; another shell, a string `bash -c` runs; this shell, a string `eval` or a trap reads; a remote shell, `ssh host cmd`); each command reads its arguments as its spec says (options, operands, subcommands); and some words hold a language of their own (a regex, a glob, a sed script, a jq filter, a printf format), which the command reads, or bash itself for `[[ =~ ]]`. The prototypes below were made before the layer of bash read simple commands as name and arguments, and before a string read again said which shell reads it. The model is `readingTree` in [src/reading.ts](../../../src/reading.ts); the layers come from the syntax tree, whose commands are bash's own ([syntax-tree.md](../syntax-tree.md), "Command nodes at bash's granularity"), and from `Token.origin` (src/analyzer-types.ts), which the analyzer sets where it makes each token.

Three prototypes came before it. The panel follows the folding tree (C). The other two are kept here to be tried again later. They are design documents, not part of the extension or the web page: no bundle includes them (test/offline.test.ts checks what the bundles hold).

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
