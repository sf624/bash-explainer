// The file the web page's script is (web/file-state.ts): its transitions, and the facts it decides once.
import * as assert from 'assert';
import { FileState } from '../web/file-state';

const never = () => false;
const sample = (text: string) => !text.trim() || text === 'SAMPLE';
const handle = { name: 'a.sh' };

describe('the file state of the web page', () => {
  it('names a script never saved from its kind, then from the name given, and a file by its own name', () => {
    const s = new FileState<{ name: string }>();
    assert.strictEqual(s.name('script.sh'), 'untitled.sh');
    assert.strictEqual(s.named(), false);
    s.rename('deploy.sh');
    assert.deepStrictEqual([s.name('script.sh'), s.named(), s.view('x', never, 'script.sh').dot], ['deploy.sh', true, false]);
    s.opened({ name: 'a.sh', handle }, { eol: '\r\n', bom: true }, 'echo a\n');
    assert.deepStrictEqual([s.name('script.sh'), s.handle(), s.format], ['a.sh', handle, { eol: '\r\n', bom: true }]);
    // A transition that starts a script over (a file opened, a save, a sample) forgets the name given before.
    s.sampleLoaded('SAMPLE');
    assert.deepStrictEqual([s.name('script.sh'), s.file, s.format, s.named()], ['untitled.sh', undefined, { eol: '\n', bom: false }, false]);
  });

  it('has changes not saved while the text differs from the clean one and is the user\'s own', () => {
    const s = new FileState<{ name: string }>();
    s.sampleLoaded('SAMPLE');
    assert.strictEqual(s.unsaved('', sample), false);
    assert.strictEqual(s.unsaved('echo mine', sample), true);
    assert.strictEqual(s.unsaved('SAMPLE', sample), false);
    // A file's text is always its own, even empty; an undo back to the text read counts as clean.
    s.opened({ name: 'a.sh' }, s.format, 'echo a');
    assert.strictEqual(s.own('', sample), true);
    assert.strictEqual(s.unsaved('', sample), true);
    assert.strictEqual(s.unsaved('echo a', sample), false);
    assert.strictEqual(s.view('echo b', sample, 'script.sh').dot, true);
    s.saved({ name: 'a.sh' }, 'echo b');
    assert.strictEqual(s.view('echo b', sample, 'script.sh').dot, false);
    assert.strictEqual(s.view('echo a', sample, 'script.sh').dot, true);
  });

  it('marks a renamed file, drops the handle until the name is the file\'s own again, and a save clears the rename', () => {
    const s = new FileState<{ name: string }>();
    s.opened({ name: 'a.sh', handle }, s.format, 'echo a');
    s.rename('b.sh');
    assert.deepStrictEqual([s.name('script.sh'), s.view('echo a', never, 'script.sh').dot, s.handle()], ['b.sh', true, undefined]);
    // The file keeps its own name and handle underneath: the name back is no rename.
    s.rename('a.sh');
    assert.deepStrictEqual([s.name('script.sh'), s.view('echo a', never, 'script.sh').dot, s.handle()], ['a.sh', false, handle]);
    s.rename('c.sh');
    s.saved({ name: 'c.sh' }, 'echo a');
    assert.deepStrictEqual([s.name('script.sh'), s.view('echo a', never, 'script.sh').dot, s.handle()], ['c.sh', false, undefined]);
  });

  it('forgets the handle of a refused write, and counts every transition', () => {
    const s = new FileState<{ name: string }>();
    const seen = [s.version()];
    s.opened({ name: 'a.sh', handle }, s.format, 'x');
    seen.push(s.version());
    s.refused();
    seen.push(s.version());
    assert.deepStrictEqual([s.file, s.handle()], [{ name: 'a.sh' }, undefined]);
    s.refused();
    s.sampleLoaded('x');
    s.refused(); // no file: nothing to forget
    assert.strictEqual(s.file, undefined);
    s.rename('n.sh');
    seen.push(s.version());
    assert.deepStrictEqual(seen.map((v, i) => i === 0 || v > seen[i - 1]), [true, true, true, true]);
  });

  it('puts back what a sample replaced, with its name, handle, line ends and clean text', () => {
    const s = new FileState<{ name: string }>();
    s.opened({ name: 'a.sh', handle }, { eol: '\r\n', bom: false }, 'echo a');
    s.rename('b.sh');
    const before = s.snapshot();
    s.sampleLoaded('SAMPLE');
    assert.strictEqual(s.name('script.sh'), 'untitled.sh');
    s.restore(before);
    assert.deepStrictEqual([s.name('script.sh'), s.file, s.format, s.clean, s.view('echo a', never, 'script.sh').dot], ['b.sh', { name: 'a.sh', handle }, { eol: '\r\n', bom: false }, 'echo a', true]);
  });
});
