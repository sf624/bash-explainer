import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';

// Every access to the browser's storage is in web/storage.ts, in one try/catch each: a page without storage
// (a private window) must still work, and a call elsewhere would have to remember that.
const web = path.join(__dirname, '..', 'web');

describe('web storage', () => {
  const files = fs.readdirSync(web).filter((f) => /\.(ts|js)$/.test(f));

  it('finds the sources it checks', () => assert.ok(files.includes('storage.ts') && files.includes('main.ts')));

  it('lets no file but web/storage.ts call localStorage or sessionStorage', () => {
    const calls = files
      .filter((f) => f !== 'storage.ts' && f !== 'theme-init.js')
      .filter((f) => /\b(?:localStorage|sessionStorage)\s*[.[]/.test(fs.readFileSync(path.join(web, f), 'utf8')));
    assert.deepStrictEqual(calls, []);
  });
});
