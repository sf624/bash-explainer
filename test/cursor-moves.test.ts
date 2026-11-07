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
    m.editorUpdate({ docChanged: true, selectionSet: false, transactions: [] });
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

  it("tells VS Code's selection changes apart: a key's or a pointer's in the document of the change before, out of the text an edit put since, is a move", () => {
    const m = new CursorMoves();
    const doc = {};
    // (The first change seen in a document, or a document opened: no move.)
    m.selected(doc, true, [3, 3]);
    assert.strictEqual(m.take(), false);
    m.selected(doc, true, [4, 4]);
    assert.strictEqual(m.take(), true, 'a key');
    // (Typing `x` at 4: VS Code tells the edit, then the change of the selection it makes, to 5, in the text it put.)
    m.selected(doc, true, [4, 4]);
    m.edited(doc, [{ rangeOffset: 4, rangeLength: 0, text: 'x' }]);
    assert.strictEqual(m.take(), false, 'an edit drops a move not sent');
    m.selected(doc, true, [5, 5]);
    assert.strictEqual(m.take(), false, 'typing');
    // (Delete at 5 leaves the cursor in place: VS Code makes no change of the selection; the next key is a move, the way it goes.)
    m.edited(doc, [{ rangeOffset: 5, rangeLength: 1, text: '' }]);
    m.selected(doc, true, [6, 6]);
    assert.strictEqual(m.take(), true, 'Delete, then a key right');
    m.edited(doc, [{ rangeOffset: 6, rangeLength: 1, text: '' }]);
    m.selected(doc, true, [5, 5]);
    assert.strictEqual(m.take(), true, 'Delete, then a key left');
    // (A paste over a selection, `ab` over 2–5: the cursor at its end. Backspace: at the start of what it took.)
    m.edited(doc, [{ rangeOffset: 2, rangeLength: 3, text: 'ab' }]);
    m.selected(doc, true, [4, 4]);
    assert.strictEqual(m.take(), false, 'a paste');
    m.edited(doc, [{ rangeOffset: 3, rangeLength: 1, text: '' }]);
    m.selected(doc, true, [3, 3]);
    assert.strictEqual(m.take(), false, 'Backspace');
    // (Two cursors typing, each in the text it put: the changes' ranges are in the text before the edit, the later first.)
    m.edited(doc, [{ rangeOffset: 10, rangeLength: 0, text: 'yy' }, { rangeOffset: 1, rangeLength: 0, text: 'yy' }]);
    m.selected(doc, true, [3, 3, 14, 14]);
    assert.strictEqual(m.take(), false, 'typing with two cursors');
    m.edited(doc, [{ rangeOffset: 10, rangeLength: 0, text: 'z' }, { rangeOffset: 1, rangeLength: 0, text: 'z' }]);
    m.selected(doc, true, [2, 2, 20, 20]);
    assert.strictEqual(m.take(), true, 'a cursor out of what they put: a move');
    // (A format after typing, before the change of the selection: what typing put, moved by what the format put before it and around it.)
    m.edited(doc, [{ rangeOffset: 8, rangeLength: 0, text: '(' }]);
    m.edited(doc, [{ rangeOffset: 0, rangeLength: 2, text: '    ' }, { rangeOffset: 7, rangeLength: 3, text: 'ab' }, { rangeOffset: 20, rangeLength: 4, text: '' }]);
    m.selected(doc, true, [11, 11]);
    assert.strictEqual(m.take(), false, 'typing, then a format');
    // (In the other order, the change of the selection before the edit, the edit drops the move it was taken for.)
    m.selected(doc, true, [12, 12]);
    m.edited(doc, [{ rangeOffset: 11, rangeLength: 0, text: 'w' }]);
    assert.strictEqual(m.take(), false, 'the selection first');
    // (A selection set by a command, the panel's reveal: no move, and it is the edit's change all the same.)
    m.selected(doc, false, [12, 12]);
    assert.strictEqual(m.take(), false);
    // (Another document: no move until a move in it; an edit of the document the cursor is not in changes nothing.)
    const other = {};
    m.selected(other, true, [0, 0]);
    assert.strictEqual(m.take(), false);
    m.edited(doc, [{ rangeOffset: 0, rangeLength: 0, text: 'v' }]);
    m.selected(other, true, [1, 1]);
    assert.strictEqual(m.take(), true, 'an edit of another document');
  });
});
