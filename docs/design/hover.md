# The hover

What the hover explains, and how it looks. Built from a design study in real VS Code (the prototypes on the branches `proto/hover-inline` and `proto/hover-inline-2`), with the maintainer's choices.

The code: `src/ui/hoverParts.ts` (which part a position explains), `src/ui/hoverView.ts` (the Markdown), `src/ui/hover.ts` (VS Code), `cli/lsp.ts` (the Language Server). Tests: `test/hover-view.test.ts`.

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

The part: a breadcrumb of the parts around it with the link "Whole line" beside it, then the part's label coloured by its kind, its name-kind badge and "run by" (a command name), its meaning, "Same name, also", its own parts (one level; deeper ones are counted as "N more in the panel"), and the command it belongs to. The notes of the line, and the examples of the part, come after, so that the first lines (about 250 px) answer what the part is.

The line card: the structure as one breadcrumb (`sudo | xargs › sudo · xargs`, each part with its meaning as a tooltip), and the link.

The whole line ("B" of the study): the line, coloured; its structure as a breadcrumb; then one block per command, and per part with commands in it, in the order bash runs them: the label, the badge, "run by", the meaning, where it is ("in: …"), and its arguments two levels deep. Deeper parts are counted as "N more in the panel", with the link. The notes of the line come after the blocks. Examples follow `examples.placement` (`first`: before the block's arguments; `last`: after them; `bottom`: at the end).

The Language Server sends plain Markdown (editors other than VS Code show no HTML) and no command links: the part first, then the whole line below `---`. On no part, the whole line alone.

## No tree glyphs

The hover once drew the tree with glyphs (`├─ └─ │`) inside `<code>`. The study tried them inside and outside `<code>`, as bars, and as a `<pre>` block. VS Code's hover keeps only a few styles on `<span>` (a colour, a background, `display:inline-block`, `border-radius`, in that order; the test checks the exact pattern of VS Code 1.142), so it cannot set a font or `white-space` itself:

- outside `<code>` the font is proportional, so a glyph and a space are not as wide, and the columns drift;
- inside `<code>` the background of each row breaks the vertical lines between rows;
- an explanation that wraps breaks the lines too, and `<pre>` does not wrap at all.

So the hierarchy is indentation (non-breaking spaces), and the labels are coloured by kind, with no code background. The study used `<samp>` for them, but VS Code does not style `<samp>`: it falls back to the browser's default monospace font, which is Courier on macOS. The labels are plain coloured spans instead, in the hover's font. A label in the narrow first column has a word joiner after each hyphen, so that `-name *.gz -mtime` does not break after a dash.

The structure (lists, pipelines, constructs) is one line, a breadcrumb, instead of the rows of a tree.
