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

  it("reads the web page's editor updates: a selection by a key, a click or a tap with no edit is a move", () => {
    const m = new CursorMoves();
    const tr = (event: string | undefined, selection = true) => ({ selection: selection ? {} : undefined, isUserEvent: (e: string) => !!event && (event === e || event.startsWith(e + '.')) });
    const update = (docChanged: boolean, selectionSet: boolean, ...transactions: ReturnType<typeof tr>[]) => {
      m.editorUpdate({ docChanged, selectionSet, transactions });
      return m.take();
    };
    assert.strictEqual(update(false, true, tr('select.pointer')), true, 'a click');
    assert.strictEqual(update(false, true, tr('select')), true, 'a key');
    // (Typing and a paste set a selection too, with the text; the panel's reveal sets one with no event.)
    assert.strictEqual(update(true, true, tr('input.type')), false, 'typing');
    assert.strictEqual(update(true, true, tr('input.paste')), false, 'a paste');
    assert.strictEqual(update(false, true, tr(undefined)), false, "the panel's reveal");
    assert.strictEqual(update(false, true, tr(undefined), tr('select', false)), false, 'no selection of the reader');
    // (An update that neither changes the text nor sets a selection leaves a move to send.)
    m.cursor(true);
    m.editorUpdate({ docChanged: false, selectionSet: false, transactions: [] });
    assert.strictEqual(m.take(), true);
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
