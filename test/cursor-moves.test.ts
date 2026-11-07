// Whether the reader moved the cursor with no edit since the panel was last sent the line (src/ui/cursorMoves.ts): the panel opens the
// stage of a pipeline the cursor moved into, and typing or a paste opens nothing (usability-9.md, 2.7). integration/extension.itest.ts
// feeds it VS Code's own events; test/web-depth.test.ts, the web page's.
import * as assert from 'assert';
import { CursorMoves } from '../src/ui/cursorMoves';

describe('the moves of the cursor the panel opens a stage for', () => {
  it('takes a move once, and none after an edit or a selection the page made (the web page)', () => {
    const m = new CursorMoves();
    assert.strictEqual(m.take(), false);
    m.cursor(true);
    assert.deepStrictEqual([m.take(), m.take()], [true, false]);
    m.cursor(true);
    m.edited();
    assert.strictEqual(m.take(), false);
    m.cursor(true);
    m.cursor(false);
    assert.strictEqual(m.take(), false);
  });

  it("tells VS Code's selection changes apart by the document's version: a key's or a pointer's with none since is a move", () => {
    const m = new CursorMoves();
    const doc = { version: 1 };
    // (The first change seen in a document, or a document opened: no version to compare with, no move.)
    m.selected(doc, true);
    assert.strictEqual(m.take(), false);
    m.selected(doc, true);
    assert.strictEqual(m.take(), true);
    // (Typing: the version goes up, whichever event comes first.)
    doc.version = 2;
    m.edited();
    m.selected(doc, true);
    assert.strictEqual(m.take(), false);
    m.selected(doc, true);
    doc.version = 3;
    m.edited();
    assert.strictEqual(m.take(), false);
    m.selected(doc, true);
    assert.strictEqual(m.take(), false);
    // (A selection set by a command, the panel's reveal: no move. Another document: none either, until a move in it.)
    m.selected(doc, false);
    assert.strictEqual(m.take(), false);
    const other = { version: 3 };
    m.selected(other, true);
    assert.strictEqual(m.take(), false);
    m.selected(other, true);
    assert.strictEqual(m.take(), true);
  });
});
