// Code that never runs, as a hint the editors fade (`deadCodeHints` in src/document.ts, from the state model's
// `dead`; docs/design/highlighting.md): its ranges, the settings that turn it off, and that it is no problem.
import * as assert from 'assert';
import { deadCodeHints, diagnosticsFor } from '../src/document';
import { openDocument, shellsOf } from '../src/document-setup';
import { defaultSettings, mergeSettings } from '../src/settings';
import { createUnbashParser } from '../src/syntax/adapters/unbash';

const parser = createUnbashParser();
const parse = (text: string) => parser.parse(text);

/** The ranges as `line:col-line:col`, from 0. */
function ranges(text: string, ignore: string[] = []): string[] {
  const doc = openDocument(text, 'shell', parse);
  return deadCodeHints(doc, 'en', shellsOf(doc.lines, 'a.sh', undefined), ignore).map((r) => `${r.startLine}:${r.startCol}-${r.endLine}:${r.endCol}`);
}

describe('code that never runs, faded in the editors', () => {
  it('marks the body of an if whose condition is decided, over its lines, as one range', () => {
    assert.deepStrictEqual(ranges('if false; then echo x; fi'), ['0:15-0:21']);
    assert.deepStrictEqual(ranges('if false; then\n  echo a\n  # kept\n  echo b\nfi\necho c'), ['1:2-3:8']);
  });

  it('marks what a value the script set decides', () => {
    assert.deepStrictEqual(ranges('x=1\nif [ "$x" = 2 ]; then\n  echo a\nelse\n  echo b\nfi'), ['2:2-2:8']);
    assert.deepStrictEqual(ranges('x=1\nif [ "$x" = 1 ]; then\n  echo a\nelse\n  echo b\nfi'), ['4:2-4:8']);
  });

  it('marks the statements after exit, and the side of && or || that is skipped', () => {
    assert.deepStrictEqual(ranges('echo a\nexit 1\necho b\nfoo; bar\n'), ['2:0-3:8']);
    assert.deepStrictEqual(ranges('true || echo no'), ['0:8-0:15']);
  });

  it('marks a statement of several lines whole, and none inside it', () => {
    assert.deepStrictEqual(ranges('exit\nwhile read l; do\n  echo "$l"\n  if true; then :; else :; fi\ndone < f\n'), ['1:0-4:8']);
  });

  it('marks nothing in a script the model cannot trust, or where nothing is dead', () => {
    assert.deepStrictEqual(ranges('source ./lib.sh\nif false; then echo x; fi'), []);
    assert.deepStrictEqual(ranges('eval "$cmd"\nexit\necho b'), []);
    assert.deepStrictEqual(ranges('echo a\nif [ -f x ]; then echo b; fi\n'), []);
  });

  it('is left out by the ignore list and by a disable comment', () => {
    assert.deepStrictEqual(ranges('if false; then echo x; fi', ['dead-code']), []);
    assert.deepStrictEqual(ranges('# bash-explainer disable-file=dead-code\nif false; then echo x; fi'), []);
  });

  it('is none for the shell code of another file', () => {
    const doc = openDocument('FROM a\nRUN if false; then echo x; fi\n', 'dockerfile', parse);
    assert.deepStrictEqual(deadCodeHints(doc, 'en', shellsOf(doc.lines, 'Dockerfile', undefined)), []);
  });

  it('says it in the language', () => {
    const doc = openDocument('if false; then echo x; fi', 'shell', parse);
    const [en] = deadCodeHints(doc, 'en', shellsOf(doc.lines, 'a.sh', undefined));
    const [ja] = deadCodeHints(doc, 'ja', shellsOf(doc.lines, 'a.sh', undefined));
    assert.match(en.message, /^This never runs/);
    assert.match(ja.message, /^ここは実行されない/);
  });

  it('comes apart from the problems, where the surface draws it and hints.deadCode is on', () => {
    const doc = openDocument('if false; then echo x; fi', 'shell', parse);
    const shells = shellsOf(doc.lines, 'a.sh', undefined);
    const get = (s = defaultSettings(), surface: 'vscode' | 'web' | 'lsp' | 'cli' = 'lsp') => diagnosticsFor(() => doc, () => shells, 'en', s, surface);
    assert.strictEqual(get().faded.length, 1);
    assert.deepStrictEqual(get().shown, []);
    assert.deepStrictEqual(get().all, []);
    assert.strictEqual(get(defaultSettings(), 'vscode').faded.length, 1);
    assert.strictEqual(get(defaultSettings(), 'web').faded.length, 1);
    assert.deepStrictEqual(get(defaultSettings(), 'cli').faded, []);
    assert.deepStrictEqual(get(mergeSettings({ 'hints.deadCode': false })).faded, []);
    assert.deepStrictEqual(get(mergeSettings({ 'diagnostics.ignore': ['dead-code'] })).faded, []);
    // (Not tied to `diagnostics.enabled`: the fading is no warning.)
    assert.strictEqual(get(mergeSettings({ 'diagnostics.enabled': false })).faded.length, 1);
  });
});
