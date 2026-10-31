// The script's name on the web page (src/ui/fileName.ts): muted until saved, ● for changes not saved, renamed in place.
import * as assert from 'assert';
import { fileNameView, nameParts, stemEnd, typedName, untitledName } from '../src/ui/fileName';

describe('the file name of the web page', () => {
  it('names a script never saved "untitled" with the kind\'s extension, and keeps the names a tool fixes', () => {
    assert.strictEqual(untitledName('script.sh'), 'untitled.sh');
    assert.strictEqual(untitledName('deploy.py'), 'untitled.py');
    assert.strictEqual(untitledName('test.bats'), 'untitled.bats');
    assert.strictEqual(untitledName('.github/workflows/ci.yml'), 'untitled.yml');
    for (const fixed of ['Dockerfile', 'Makefile', 'Jenkinsfile', 'package.json', 'README.md']) assert.strictEqual(untitledName(fixed), fixed);
    // A name with no extension, or only a leading dot, gets no extension.
    assert.strictEqual(untitledName('script'), 'untitled');
    assert.strictEqual(untitledName('.bashrc'), 'untitled');
  });

  it('mutes a script never saved or opened, with no dot, and shows the name given to it', () => {
    const facts = { renamed: false, dirty: false, kindName: 'script.sh' };
    assert.deepStrictEqual(fileNameView(facts), { name: 'untitled.sh', muted: true, dot: false });
    // Changes to it have no file to differ from: still no dot (muted already says it is not saved).
    assert.deepStrictEqual(fileNameView({ ...facts, dirty: true }), { name: 'untitled.sh', muted: true, dot: false });
    assert.deepStrictEqual(fileNameView({ ...facts, draft: 'deploy.sh', renamed: true }), { name: 'deploy.sh', muted: true, dot: false });
    assert.deepStrictEqual(fileNameView({ ...facts, kindName: 'Dockerfile' }), { name: 'Dockerfile', muted: true, dot: false });
  });

  it('shows a file opened or saved in the normal colour, with ● while its text or its name is not saved', () => {
    const facts = { file: 'a.sh', renamed: false, dirty: false, kindName: 'script.sh' };
    assert.deepStrictEqual(fileNameView(facts), { name: 'a.sh', muted: false, dot: false });
    assert.deepStrictEqual(fileNameView({ ...facts, dirty: true }), { name: 'a.sh', muted: false, dot: true });
    assert.deepStrictEqual(fileNameView({ ...facts, file: 'b.sh', renamed: true }), { name: 'b.sh', muted: false, dot: true });
    // The file's name wins over a name given before it was opened.
    assert.deepStrictEqual(fileNameView({ ...facts, draft: 'old.sh' }), { name: 'a.sh', muted: false, dot: false });
  });

  it('reads a rename: trimmed, without slashes or control characters; nothing, or the same name, changes nothing', () => {
    assert.strictEqual(typedName('  deploy.sh ', 'untitled.sh'), 'deploy.sh');
    assert.strictEqual(typedName('a/b\\c.sh', 'untitled.sh'), 'abc.sh');
    assert.strictEqual(typedName('x\ty\u007f.sh', 'untitled.sh'), 'xy.sh');
    assert.strictEqual(typedName('名前.sh', 'untitled.sh'), '名前.sh');
    assert.strictEqual(typedName('   ', 'untitled.sh'), undefined);
    assert.strictEqual(typedName('//', 'untitled.sh'), undefined);
    assert.strictEqual(typedName(' untitled.sh', 'untitled.sh'), undefined);
    // The directory itself and its parent are no names.
    for (const dots of ['.', '..', ' . ', ' .. ']) assert.strictEqual(typedName(dots, 'untitled.sh'), undefined, dots);
    assert.strictEqual(typedName('...', 'untitled.sh'), '...');
    // At most 255 characters (not code units: a name of astral characters is cut between them).
    assert.strictEqual(typedName('a'.repeat(300), 'untitled.sh'), 'a'.repeat(255));
    assert.strictEqual([...typedName('😀'.repeat(300), 'untitled.sh')!].length, 255);
    assert.strictEqual(typedName('a'.repeat(254) + ' ' + 'b', 'untitled.sh'), 'a'.repeat(254));
  });

  it('selects the stem in the rename field and cuts a long name in its stem, keeping the extension', () => {
    assert.strictEqual(stemEnd('deploy.sh'), 6);
    assert.strictEqual(stemEnd('archive.tar.gz'), 11);
    assert.strictEqual(stemEnd('Dockerfile'), 10);
    assert.strictEqual(stemEnd('.bashrc'), 7);
    assert.deepStrictEqual(nameParts('a-very-long-name.sh'), ['a-very-long-name', '.sh']);
    assert.deepStrictEqual(nameParts('Makefile'), ['Makefile', '']);
    assert.deepStrictEqual(nameParts('.bashrc'), ['.bashrc', '']);
  });
});
