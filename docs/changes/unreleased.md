# Changes since 0.9.0, in detail

The short list is in [CHANGELOG.md](../../CHANGELOG.md#unreleased).

## Changed

### Long lines on the web page wrap between shell words

The editor of the web page wraps a long line only between the words bash reads: a word keeps its quotes, `$( )`, `${ }`, `<( )` and backquotes on one row. In `grep -rn "ERROR $USER" ./src 2>&1 | sort -u > errors.txt && echo "done: $(date +%F)" || exit 1`, a row ends before `"done: $(date +%F)"`, never inside it. The rows after the first are indented by the line's own indentation and two more columns, and the gutter marks each of them with ↪. A word wider than a row breaks at its own blanks, and only as a last resort anywhere, so nothing scrolls sideways.

The words come from the syntax tree the explanations use. A line the parser cannot read, a comment, a here-document's text and the lines of a Dockerfile, a workflow or a Makefile that are not shell break at their blanks.

The setting **Wrap long lines** (`editor.wrap`) is now on by default. Before, it was off, and when on, a line broke wherever the browser chose: after the `-` of `sort -u`, at a slash of a path, or at the blank inside `$(date +%F)`. Turn it off to have long lines scroll sideways, as before.

## Fixed

### Hover cards on the web page stay off the line

A hover card on the web page now sits under the whole line it explains, or above it when there is no room under it, at the part's place; it never covers a row of the line, also when the line wraps. Moving the pointer from a word to its card, across the line's later rows, keeps the card. A card is at most half the window high (and at most 420 px); a longer card scrolls inside, with the pointer, and with the keyboard after `Ctrl+K Ctrl+I` twice. Before, a card sat above the word and could cover the line's earlier rows.

### Japanese wording on the web page

A new check reads the Japanese in `web/` (the strings of `web/*.ts` and the text of `web/index.html`) against [docs/japanese-style.md](../japanese-style.md), as it already read `src/`. It found one string: the settings dialog's explanation of "Clear stored data" said 消します; it says 削除します now.
