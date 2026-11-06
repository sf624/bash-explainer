# Unreleased changes, in detail

The short list is in [CHANGELOG.md](../../CHANGELOG.md#unreleased).

## Changed

### The hover card and the Legend

- **The card on the web page.** The pointer that rests where you clicked opens no card: the click already shows the line in the panel. A pointer that moves on to another part of the script opens its card as before, and so does one that comes back to the part later. The card closes on a click, a paste, typing, and Escape, wherever the focus is (the editor, the page, the panel). Before, a click on line 1 could leave a card of 500 px over the lines below, and a click on one of them failed.
- **The Legend.** It opens under its button over the explanation, as wide as the panel and no higher than the room below it (it scrolls inside), and the explanation under it stays where it is. Escape closes it and the focus goes back to its button; so does a click outside it, the focus leaving the panel (a click in the editor), and a new line. Before, it opened in the flow of the panel, up to 400 px high, and stayed open on the next line. On a line with nothing to explain there is no Legend button; before, an open Legend drew an empty box.
