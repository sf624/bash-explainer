import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';

// Only src/syntax/adapters/unbash.ts may import unbash; the rest of src/, and cli/ and web/,
// read the model of src/syntax/tree.ts and make their parser with the adapter's export.
const base = path.join(__dirname, '..');
const src = path.join(base, 'src');
const adapter = path.join(src, 'syntax', 'adapters', 'unbash.ts');

function sources(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const file = path.join(dir, e.name);
    return e.isDirectory() ? sources(file) : /\.ts$/.test(e.name) ? [file] : [];
  });
}

/** A module name written as an import, a re-export, a `require` or a dynamic or type `import('…')`. */
const LIBRARIES = /(?:\bfrom\s*|\bimport\s*\(\s*|\brequire\s*\(\s*|\bimport\s+)['"`]unbash(?:\/[^'"`]*)?['"`]/;

describe('syntax tree boundary', () => {
  it('finds the sources it checks', () => assert.ok(sources(src).length > 40 && fs.existsSync(adapter)));

  it('lets no file other than src/syntax/adapters/unbash.ts import unbash, as a value or as a type', () => {
    const files = ['src', 'cli', 'web'].flatMap((d) => sources(path.join(base, d)).filter((f) => !f.includes(`${path.sep}node_modules${path.sep}`) && !f.includes(`${path.sep}dist${path.sep}`)));
    assert.ok(files.some((f) => f.includes(`${path.sep}cli${path.sep}`)) && files.some((f) => f.includes(`${path.sep}web${path.sep}`)));
    const offenders = files
      .filter((f) => f !== adapter)
      .filter((f) => LIBRARIES.test(fs.readFileSync(f, 'utf8')))
      .map((f) => path.relative(base, f));
    assert.deepStrictEqual(offenders, []);
  });

  it('notices every way of importing unbash', () => {
    for (const code of [
      `import { parse } from 'unbash';`,
      `import type { Script } from "unbash";`,
      `import * as U from 'unbash'`,
      `export type { Script } from 'unbash';`,
      `import 'unbash';`,
      `type T = import('unbash').Script;`,
      `const { parse } = require('unbash');`,
      `const m = await import("unbash/dist/index.js");`,
      'const m = await import(`unbash`);',
    ]) assert.ok(LIBRARIES.test(code), code);
    assert.ok(!LIBRARIES.test(`import { x } from './syntax/tree'; // not unbash`));
  });
});
