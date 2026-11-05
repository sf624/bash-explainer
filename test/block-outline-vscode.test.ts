// What the VS Code side of the block mark (src/ui/blockOutline.ts) hands to the editor, against a stand-in for the
// `vscode` module: the rows of the block at the cursor, one decoration type for the setting `bar` and another for
// `tint` (theme colours, whole lines), nothing and no work for `off`, and a change of the setting at once.
import * as assert from 'assert';
import * as fs from 'fs';
import Module from 'module';
import * as path from 'path';
import * as ts from 'typescript';
import { openDocument } from '../src/document-setup';
import type { BlockOutline } from '../src/settings';
import { failuresGoTo, failuresThrow } from '../src/failures';
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
let documentCount = 0;
/** An editor on a script, with the cursor at `line`, `character`; what it was handed is in `marks`. */
function editorOn(text: string, line: number, character = 0, target = true) {
  const document = { text, target, version: 1, uri: `file:${++documentCount}` };

  const editor = {
    document, selection: { active: { line, character } }, marks: new Map<any, number[]>(),
    // (The rows a range of whole lines covers, end included; `ranges` is what the editor was handed.)
    ranges: [] as number[][],
    setDecorations(type: any, ranges: any[]) {
      this.ranges = ranges.map((r) => [r.startLine, r.endLine]);
      this.marks.set(type, ranges.flatMap((r) => Array.from({ length: r.endLine - r.startLine + 1 }, (_, i) => r.startLine + i)));
    },
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
  /** The versions of the documents that were parsed (the service's cache hits on a version it has seen). */
  const parsed = new Set<string>();
  const service = {
    get settings() { return { blockOutline: mode } as any; },
    isTarget: (d: any) => d.target,
    document: (d: any) => { documents.push(d.text); parsed.add(`${d.uri ?? ''}@${d.version}`); return openDocument(d.text, 'shell', (t) => parser.parse(t)); },
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
    parsed.clear();
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

  /** A keystroke as VS Code reports it: a new version of the text, the text event, and then the selection event. */
  function type(e: any, text: string, active: { line: number; character: number }): void {
    e.document.text = text;
    e.document.version++;
    e.selection.active = active;
    fire('text', { document: e.document });
    fire('selection', { textEditor: e });
  }

  const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

  it('parses the text once it rests, not at each key: a key fires the selection event too, and the timer draws', async () => {
    const e = editorOn(SCRIPT, 3);
    fake.editors.push(e);
    const c = new BlockOutlineController(service);
    const t = fake.types[0];
    assert.deepStrictEqual(rowsOf(e, t), [2, 3, 4]);
    assert.deepStrictEqual([...parsed], [`${e.document.uri}@1`]);
    // Six keys in a row: nothing is parsed, and the marks stay.
    for (let i = 0; i < 6; i++) type(e, 'for f in a; do\n  x\ndone\n' + SCRIPT, { line: 4, character: 1 + i });
    assert.deepStrictEqual([...parsed], [`${e.document.uri}@1`], 'no new version is parsed by a key');
    assert.strictEqual(c.lookups, 1);
    assert.deepStrictEqual(rowsOf(e, t), [2, 3, 4]);
    await wait(300);
    // Once, for the last version, whatever the number of keys.
    assert.deepStrictEqual([...parsed], [`${e.document.uri}@1`, `${e.document.uri}@7`]);
    assert.strictEqual(c.lookups, 2);
    assert.deepStrictEqual(rowsOf(e, t), [4, 5, 6, 7, 8]);
    // A move of the cursor on the version drawn is drawn at once, with no new parse.
    e.selection.active = { line: 1, character: 0 };
    fire('selection', { textEditor: e });
    assert.deepStrictEqual(rowsOf(e, t), [0, 1, 2]);
    assert.strictEqual(parsed.size, 2);
    c.dispose();
  });

  it('draws again for every document changed within the delay, not only the last', async () => {
    const a = editorOn(SCRIPT, 3);
    const b = editorOn(SCRIPT, 3);
    const c = new BlockOutlineController(service);
    fake.editors.push(a, b);
    const t = fake.types[0];
    fire('visible', [a, b]);
    type(a, 'x\n' + SCRIPT, { line: 4, character: 0 });
    type(b, 'y\n' + SCRIPT, { line: 4, character: 0 });
    await wait(300);
    assert.deepStrictEqual(rowsOf(a, t), [3, 4, 5]);
    assert.deepStrictEqual(rowsOf(b, t), [3, 4, 5]);
    // (The timer does not draw an editor of a document that did not change.)
    const c2 = editorOn(SCRIPT, 3);
    fake.editors.push(c2);
    const before = c.lookups;
    type(a, 'z\n' + SCRIPT, { line: 4, character: 0 });
    await wait(300);
    assert.strictEqual(c.lookups, before + 1);
    c.dispose();
  });

  it('hands the editor one range of whole lines for the block, and none outside any', () => {
    const e = editorOn(SCRIPT, 3);
    fake.editors.push(e);
    const c = new BlockOutlineController(service);
    assert.deepStrictEqual(e.ranges, [[2, 4]]);
    e.selection.active = { line: 0, character: 0 };
    fire('selection', { textEditor: e });
    assert.deepStrictEqual(e.ranges, []);
    c.dispose();
  });

  it('draws again, for the same setting, when the configuration changes: the languages decide which documents are marked', () => {
    const e = editorOn(SCRIPT, 3, 0, false);
    fake.editors.push(e);
    const c = new BlockOutlineController(service);
    assert.deepStrictEqual(rowsOf(e, fake.types[0]), []);
    // The document is a target now (the `languages` setting), and the extension calls settingsChanged.
    e.document.target = true;
    c.settingsChanged();
    assert.strictEqual(fake.types.length, 1);
    assert.deepStrictEqual(rowsOf(e, fake.types[0]), [2, 3, 4]);
    e.document.target = false;
    c.settingsChanged();
    assert.deepStrictEqual(rowsOf(e, fake.types[0]), []);
    c.dispose();
  });

  it('leaves the marks and the extension alone when a lookup throws (a boundary of its own)', () => {
    const e = editorOn(SCRIPT, 3);
    fake.editors.push(e);
    const wasThrowing = failuresThrow(false);
    const told: string[] = [];
    const before = failuresGoTo((f) => { told.push(f.where); });
    try {
      const broken = Object.assign(Object.create(service), { document: () => { throw new Error('boom'); } });
      // (The constructor draws once: it must not throw, or the activation of the extension stops.)
      const c = new BlockOutlineController(broken);
      assert.strictEqual(told.length, 1);
      assert.match(told[0], /the block mark/);
      assert.strictEqual(e.marks.size, 0);
      fire('selection', { textEditor: e });
      c.dispose();
    } finally {
      failuresGoTo(before);
      failuresThrow(wasThrowing);
    }
  });

  it('uses the colours package.json declares, with a default for every kind of theme', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
    const declared = new Map<string, Record<string, string>>(pkg.contributes.colors.map((c: any) => [c.id, c.defaults]));
    for (const [m, key] of [['bar', 'borderColor'], ['tint', 'backgroundColor']] as const) {
      mode = m;
      fake.types.length = 0;
      new BlockOutlineController(service).dispose();
      const id = fake.types[0].options[key].id;
      assert.ok(declared.has(id), `${id} is declared in contributes.colors`);
      assert.deepStrictEqual(Object.keys(declared.get(id)!).sort(), ['dark', 'highContrast', 'highContrastLight', 'light']);
    }
  });

  it('is told of a change of the configuration by the extension, after the service forgets its documents', () => {
    const source = ts.createSourceFile('extension.ts', fs.readFileSync(path.join(__dirname, '..', 'src', 'extension.ts'), 'utf8'), ts.ScriptTarget.Latest, true);
    let handler: ts.Node | undefined;
    const find = (n: ts.Node): void => {
      if (ts.isCallExpression(n) && n.expression.getText(source) === 'vscode.workspace.onDidChangeConfiguration') handler = n.arguments[0];
      ts.forEachChild(n, find);
    };
    find(source);
    assert.ok(handler, 'the extension listens for the configuration');
    const text = handler!.getText(source);
    const at = (needle: string) => { const i = text.indexOf(needle); assert.ok(i >= 0, needle); return i; };
    assert.ok(at('outline.settingsChanged()') > at('service.settingsChanged()'));
    assert.ok(at('outline.settingsChanged()') > at('service.forget(d)'));
    assert.ok(at('outline.settingsChanged()') > at("e.affectsConfiguration('bashExplainer.languages')"));
  });
});
