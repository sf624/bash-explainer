// Whether the reader moved the cursor with no edit since the panel was last sent the line (src/ui/cursorMoves.ts): the panel opens the
// stage of a pipeline the cursor moved into, and typing or a paste opens nothing (usability-9.md, 2.7). integration/extension.itest.ts
// feeds it VS Code's own events; test/web-depth.test.ts, the web page's.
import * as assert from 'assert';
import Module from 'module';
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
    // (A click, a tap and a key are all moves, not told apart: the maintainer's rule of 2026-11-08.)
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

  it('tells a paste of a whole line in VS Code, which carries the cursor down, from a move', () => {
    const m = new CursorMoves();
    const doc = {};
    m.selected(doc, true, [0, 0]);
    m.selected(doc, true, [30, 30]);
    assert.strictEqual(m.take(), true, 'a click');
    // (Ctrl+C with no selection copies the whole line; Ctrl+V with the cursor at 30, on a line that starts at 25, puts `line\n` at 25:
    // the cursor stays on its own text, at 35, out of what the paste put (25–30), and VS Code tells the change of the selection after.)
    m.selected(doc, true, [30, 30]);
    m.take();
    m.edited(doc, [{ rangeOffset: 25, rangeLength: 0, text: 'line\n' }]);
    m.selected(doc, true, [35, 35]);
    assert.strictEqual(m.take(), false, 'a paste of a whole line');
    m.selected(doc, true, [36, 36]);
    assert.strictEqual(m.take(), true, 'a key after it');
    // (Two selections, carried by a paste of the whole lines before each: none moved.)
    m.selected(doc, true, [10, 12, 40, 40]);
    m.edited(doc, [{ rangeOffset: 30, rangeLength: 0, text: 'b\n' }, { rangeOffset: 5, rangeLength: 0, text: 'a\n' }]);
    m.selected(doc, true, [12, 14, 44, 44]);
    assert.strictEqual(m.take(), false, 'a paste of two whole lines');
    // (Delete leaves the cursor where it was, so a key after it is a move, though the ends were carried along.)
    m.edited(doc, [{ rangeOffset: 44, rangeLength: 1, text: '' }]);
    m.selected(doc, true, [45, 45]);
    assert.strictEqual(m.take(), true, 'Delete, then a key');
    // (A cursor more than before, out of what an edit put: a move.)
    m.edited(doc, [{ rangeOffset: 0, rangeLength: 0, text: 'c' }]);
    m.selected(doc, true, [46, 46, 50, 50]);
    assert.strictEqual(m.take(), true, 'a second cursor added after an edit');
  });
});

describe("VS Code's events of the cursor, as followMoves passes them on (a stand-in for `vscode`)", () => {
  type Handler = (e: unknown) => void;
  const handlers: Record<string, Handler[]> = {};
  const on = (name: string) => (h: Handler) => {
    (handlers[name] ??= []).push(h);
    return { dispose: () => { handlers[name] = handlers[name].filter((x) => x !== h); } };
  };
  const fire = (name: string, e: unknown) => (handlers[name] ?? []).forEach((h) => h(e));
  const Kind = { Keyboard: 1, Mouse: 2, Command: 3 };
  const window: { activeTextEditor: unknown; [k: string]: unknown } = {
    activeTextEditor: undefined, onDidChangeTextEditorSelection: on('selection'), onDidChangeActiveTextEditor: on('active'),
  };
  const fake = { TextEditorSelectionChangeKind: Kind, window, workspace: { onDidChangeTextDocument: on('text') } };
  const load = Module as unknown as { _load: (request: string, ...rest: unknown[]) => unknown };
  const original = load._load;
  let followMoves: typeof import('../src/ui/followMoves').followMoves;
  before(() => {
    load._load = function (this: unknown, request: string, ...rest: unknown[]) {
      return request === 'vscode' ? fake : original.call(this, request, ...rest);
    };
    delete require.cache[require.resolve('../src/ui/followMoves')];
    followMoves = require('../src/ui/followMoves').followMoves;
  });
  after(() => {
    load._load = original;
    delete require.cache[require.resolve('../src/ui/followMoves')];
  });

  // (A document whose positions are offsets already; an editor with one cursor at `at`.)
  const docOf = (target = true) => ({ target, offsetAt: (p: number) => p });
  const editorOn = (document: ReturnType<typeof docOf>, at: number) => ({ document, selections: [{ anchor: at, active: at }] });
  const select = (editor: ReturnType<typeof editorOn>, kind: number | undefined, at: number) =>
    fire('selection', { textEditor: editor, kind, selections: [{ anchor: at, active: at }] });
  const follow = (active: unknown) => {
    window.activeTextEditor = active;
    const m = new CursorMoves();
    const subs = followMoves(m, (d) => (d as unknown as { target: boolean }).target);
    return { m, dispose: () => subs.forEach((s) => s.dispose()) };
  };

  it('takes the selection of the editor open, and of one the reader switches to: a paste of a whole line right after is no move', () => {
    // (Ctrl+C on a line with no selection; Ctrl+V with the cursor at 230, on a line that starts at 200: the line goes in before it, and the
    // cursor stays on its own text, at 235, out of what the paste put. Review of 3239402a: the ends were not taken, so it was a move.)
    const a = editorOn(docOf(), 230);
    const { m, dispose } = follow(a);
    try {
      fire('text', { document: a.document, contentChanges: [{ rangeOffset: 200, rangeLength: 0, text: 'line\n' }] });
      select(a, Kind.Keyboard, 235);
      assert.strictEqual(m.take(), false, 'a paste of a whole line in the editor open');
      select(a, Kind.Keyboard, 236);
      assert.strictEqual(m.take(), true, 'a key');
      const b = editorOn(docOf(), 40);
      fire('active', b);
      fire('text', { document: b.document, contentChanges: [{ rangeOffset: 30, rangeLength: 0, text: 'x y\n' }] });
      select(b, Kind.Keyboard, 44);
      assert.strictEqual(m.take(), false, 'a paste of a whole line after a switch');
      select(b, Kind.Mouse, 50);
      assert.strictEqual(m.take(), true, 'a click');
      select(b, Kind.Command, 51);
      assert.strictEqual(m.take(), false, "the panel's reveal");
      // (An editor the panel does not explain, a switch to none, and an event that changes no text leave all as it was.)
      const readme = editorOn(docOf(false), 0);
      fire('active', readme);
      fire('active', undefined);
      select(readme, Kind.Keyboard, 1);
      fire('text', { document: b.document, contentChanges: [] });
      select(b, Kind.Keyboard, 52);
      assert.strictEqual(m.take(), true, 'a key back in the script');
    } finally {
      dispose();
    }
    assert.deepStrictEqual(Object.values(handlers).map((h) => h.length), [0, 0, 0]);
  });

  it('takes no first move where no editor the panel explains is open', () => {
    for (const active of [undefined, editorOn(docOf(false), 0)]) {
      const { m, dispose } = follow(active);
      const s = editorOn(docOf(), 3);
      select(s, Kind.Keyboard, 4);
      assert.strictEqual(m.take(), false, 'the first change seen in a document');
      select(s, Kind.Keyboard, 5);
      assert.strictEqual(m.take(), true);
      dispose();
    }
  });
});
