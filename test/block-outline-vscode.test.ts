// What the VS Code side of the block mark (src/ui/blockOutline.ts) hands to the editor, against a stand-in for the
// `vscode` module: the rows of the block at the cursor, one decoration type for the setting `bar` and another for
// `tint` (theme colours, whole lines), nothing and no work for `off`, and a change of the setting at once.
import * as assert from 'assert';
import Module from 'module';
import { openDocument } from '../src/document-setup';
import type { BlockOutline } from '../src/settings';
import { createUnbashParser } from '../src/syntax/adapters/unbash';

type Handler = (e: any) => void;
interface Type { options: any; disposed: boolean }

/** The little of `vscode` the controller uses. */
function standIn() {
  const handlers: Record<string, Handler[]> = {};
  const on = (name: string) => (h: Handler) => {
    (handlers[name] ??= []).push(h);
    return { dispose: () => { handlers[name] = handlers[name].filter((x) => x !== h); } };
  };
  const types: Type[] = [];
  const editors: any[] = [];
  const vscode = {
    ThemeColor: class { constructor(public id: string) {} },
    Range: class { constructor(public startLine: number, public startCharacter: number, public endLine: number, public endCharacter: number) {} },
    window: {
      createTextEditorDecorationType: (options: any) => {
        const t: Type = { options, disposed: false };
        types.push(t);
        return Object.assign(t, { dispose: () => { t.disposed = true; editors.forEach((e) => { e.marks.delete(t); }); } });
      },
      onDidChangeTextEditorSelection: on('selection'),
      onDidChangeActiveTextEditor: on('active'),
      onDidChangeVisibleTextEditors: on('visible'),
      get visibleTextEditors() { return editors; },
    },
    workspace: { onDidChangeTextDocument: on('text') },
  };
  return { vscode, handlers, types, editors };
}

const parser = createUnbashParser();
/** An editor on a script, with the cursor at `line`, `character`; what it was handed is in `marks`. */
function editorOn(text: string, line: number, character = 0, target = true) {
  const document = { text, target, version: 1 };
  const editor = {
    document, selection: { active: { line, character } }, marks: new Map<any, number[]>(),
    setDecorations(type: any, ranges: any[]) { this.marks.set(type, ranges.map((r) => r.startLine)); },
  };
  return editor;
}

describe('the block mark of VS Code', () => {
  let fake: ReturnType<typeof standIn>;
  let BlockOutlineController: typeof import('../src/ui/blockOutline').BlockOutlineController;
  const load = Module as unknown as { _load: (request: string, ...rest: unknown[]) => unknown };
  const original = load._load;
  let mode: BlockOutline;
  const documents: string[] = [];
  const service = {
    get settings() { return { blockOutline: mode } as any; },
    isTarget: (d: any) => d.target,
    document: (d: any) => { documents.push(d.text); return openDocument(d.text, 'shell', (t) => parser.parse(t)); },
  } as any;

  before(() => {
    fake = standIn();
    load._load = function (request: string, ...rest: unknown[]) {
      return request === 'vscode' ? fake.vscode : original.call(this, request, ...rest);
    };
    delete require.cache[require.resolve('../src/ui/blockOutline')];
    BlockOutlineController = require('../src/ui/blockOutline').BlockOutlineController;
  });
  after(() => {
    load._load = original;
    delete require.cache[require.resolve('../src/ui/blockOutline')];
  });
  beforeEach(() => {
    fake.types.length = 0;
    fake.editors.length = 0;
    Object.keys(fake.handlers).forEach((k) => delete fake.handlers[k]);
    documents.length = 0;
    mode = 'bar';
  });

  const SCRIPT = 'echo a\nfor f in a; do\n  if x; then\n    y\n  fi\ndone\necho b';
  const rowsOf = (e: any, t: Type) => e.marks.get(t);
  const fire = (name: string, e: unknown) => (fake.handlers[name] ?? []).forEach((h) => h(e));

  it('marks the rows of the block at the cursor with a bar of a theme colour, and moves it with the cursor', () => {
    const e = editorOn(SCRIPT, 3);
    fake.editors.push(e);
    const c = new BlockOutlineController(service);
    assert.strictEqual(fake.types.length, 1);
    const t = fake.types[0];
    assert.deepStrictEqual(JSON.parse(JSON.stringify(t.options)), { isWholeLine: true, borderStyle: 'solid', borderWidth: '0 0 0 2px', borderColor: { id: 'bashExplainer.blockBar' } });
    assert.deepStrictEqual(rowsOf(e, t), [2, 3, 4]);
    e.selection.active = { line: 5, character: 1 };
    fire('selection', { textEditor: e });
    assert.deepStrictEqual(rowsOf(e, t), [1, 2, 3, 4, 5]);
    e.selection.active = { line: 0, character: 1 };
    fire('selection', { textEditor: e });
    assert.deepStrictEqual(rowsOf(e, t), []);
    assert.strictEqual(c.lookups, 3);
    c.dispose();
    assert.ok(t.disposed);
  });

  it('marks a faint background of a theme colour for `tint`', () => {
    mode = 'tint';
    const e = editorOn(SCRIPT, 1);
    fake.editors.push(e);
    new BlockOutlineController(service);
    assert.deepStrictEqual(JSON.parse(JSON.stringify(fake.types[0].options)), { isWholeLine: true, backgroundColor: { id: 'bashExplainer.blockTint' } });
    assert.deepStrictEqual(rowsOf(e, fake.types[0]), [1, 2, 3, 4, 5]);
  });

  it('does nothing, and makes no type, for `off`', () => {
    mode = 'off';
    const e = editorOn(SCRIPT, 1);
    fake.editors.push(e);
    const c = new BlockOutlineController(service);
    for (const name of ['selection', 'active', 'visible', 'text']) fire(name, name === 'selection' ? { textEditor: e } : name === 'visible' ? [e] : name === 'text' ? { document: e.document } : e);
    assert.strictEqual(fake.types.length, 0);
    assert.strictEqual(e.marks.size, 0);
    assert.strictEqual(c.lookups, 0);
    assert.deepStrictEqual(documents, []);
    // (A change of the text sets no timer either.)
    c.dispose();
  });

  it('draws again at once when the setting changes, in either direction, with the old marks gone', () => {
    const e = editorOn(SCRIPT, 3);
    fake.editors.push(e);
    const c = new BlockOutlineController(service);
    const [bar] = fake.types;
    mode = 'tint';
    c.settingsChanged();
    assert.ok(bar.disposed && !e.marks.has(bar));
    assert.strictEqual(fake.types.length, 2);
    assert.deepStrictEqual(rowsOf(e, fake.types[1]), [2, 3, 4]);
    // The same value again changes nothing.
    c.settingsChanged();
    assert.strictEqual(fake.types.length, 2);
    mode = 'off';
    c.settingsChanged();
    assert.ok(fake.types[1].disposed);
    assert.strictEqual(e.marks.size, 0);
    const before = c.lookups;
    fire('selection', { textEditor: e });
    assert.strictEqual(c.lookups, before);
    mode = 'bar';
    c.settingsChanged();
    assert.strictEqual(fake.types.length, 3);
    assert.deepStrictEqual(rowsOf(e, fake.types[2]), [2, 3, 4]);
  });

  it('draws in the editor that becomes active or visible, and not in a document that is not shell code', () => {
    const c = new BlockOutlineController(service);
    const shell = editorOn(SCRIPT, 3);
    const other = editorOn(SCRIPT, 3, 0, false);
    fake.editors.push(shell, other);
    fire('active', undefined);
    fire('visible', [shell, other]);
    const t = fake.types[0];
    assert.deepStrictEqual(rowsOf(shell, t), [2, 3, 4]);
    assert.deepStrictEqual(rowsOf(other, t), []);
    const third = editorOn(SCRIPT, 1);
    fake.editors.push(third);
    fire('active', third);
    assert.deepStrictEqual(rowsOf(third, t), [1, 2, 3, 4, 5]);
    c.dispose();
  });

  it('looks the block up again once the text has rested, in the editors of that document only', () => {
    const e = editorOn(SCRIPT, 3);
    const other = editorOn(SCRIPT, 3);
    fake.editors.push(e, other);
    const c = new BlockOutlineController(service);
    const t = fake.types[0];
    const lookups = c.lookups;
    e.document.text = 'for f in a; do\n  x\ndone\n' + SCRIPT;
    e.selection.active = { line: 4, character: 1 };
    fire('text', { document: e.document });
    fire('text', { document: e.document });
    assert.strictEqual(c.lookups, lookups);
    return new Promise<void>((resolve) => setTimeout(() => {
      // (Once, whatever the number of changes: the timer starts again at each.)
      assert.strictEqual(c.lookups, lookups + 1);
      assert.deepStrictEqual(rowsOf(e, t), [4, 5, 6, 7, 8]);
      c.dispose();
      resolve();
    }, 300));
  });
});
