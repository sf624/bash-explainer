import * as assert from 'assert';
import { explainMode, explainUmask } from '../src/embedded/mode';

describe('chmod modes', () => {
  it('reads octal modes digit by digit', () => {
    const r = explainMode('755', 'en')!;
    assert.strictEqual(r.note, 'rwxr-xr-x');
    assert.deepStrictEqual(r.tokens.map((t) => t.start), [0, 1, 2]);
    assert.match(r.tokens[0].explanation, /owner may read\/write\/execute \(4=read, 2=write, 1=execute, added up\)/);
    assert.match(r.tokens[1].explanation, /group may read\/execute$/);
  });

  it('explains special bits', () => {
    const r = explainMode('4755', 'en')!;
    assert.strictEqual(r.note, 'rwsr-xr-x');
    assert.match(r.tokens[0].explanation, /setuid/);
    assert.ok(!/sticky/.test(r.tokens[0].explanation), 'only the bits that are set');
    assert.strictEqual(explainMode('1777', 'en')!.note, 'rwxrwxrwt');
  });

  it('reads symbolic clauses', () => {
    const r = explainMode('u+rwX,go-w', 'en')!;
    assert.deepStrictEqual(r.tokens.map((t) => [t.start, t.end]), [[0, 5], [6, 10]]);
    assert.match(r.tokens[0].explanation, /for the owner, add read, write, execute \(directories/);
    assert.match(r.tokens[1].explanation, /for the group and others, remove write/);
    assert.match(explainMode('+x', 'en')!.tokens[0].explanation, /everyone \(minus what umask removes\)/);
    assert.match(explainMode('o=u', 'en')!.tokens[0].explanation, /for others, set the same permissions as the owner/);
    assert.match(explainMode('a=', 'en')!.tokens[0].explanation, /remove all permissions/);
    assert.strictEqual(explainMode('u+q', 'en'), undefined);
  });
});

describe('umask', () => {
  it('computes the resulting permissions for new files and directories', () => {
    assert.strictEqual(explainUmask('022', 'en')!.note, 'new files get 644 (rw-r--r--), directories 755 (rwxr-xr-x)');
    assert.strictEqual(explainUmask('077', 'en')!.note, 'new files get 600 (rw-------), directories 700 (rwx------)');
    assert.match(explainUmask('022', 'en')!.tokens[1].explanation, /removed from group: write/);
  });
});
