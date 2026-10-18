import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';

// Only the adapters in src/syntax/adapters/ may know a parser library; the rest of src/ reads the model of src/syntax/tree.ts.
const src = path.join(__dirname, '..', 'src');
const adapters = path.join(src, 'syntax', 'adapters');

function sources(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const file = path.join(dir, e.name);
    return e.isDirectory() ? sources(file) : /\.ts$/.test(e.name) ? [file] : [];
  });
}

/** A module name written as an import, a re-export, a `require` or a dynamic or type `import('…')`. */
const LIBRARIES = /(?:\bfrom\s*|\bimport\s*\(\s*|\brequire\s*\(\s*|\bimport\s+)['"](?:web-tree-sitter|unbash|tree-sitter-bash)(?:\/[^'"]*)?['"]/;

describe('syntax tree boundary', () => {
  it('finds the sources it checks', () => assert.ok(sources(src).length > 40 && sources(adapters).length >= 1));

  it('lets no file outside src/syntax/adapters/ import a parser library, as a value or as a type', () => {
    const offenders = sources(src)
      .filter((f) => !f.startsWith(adapters + path.sep))
      .filter((f) => LIBRARIES.test(fs.readFileSync(f, 'utf8')))
      .map((f) => path.relative(src, f));
    assert.deepStrictEqual(offenders, []);
  });

  it('notices every way of importing a library', () => {
    for (const code of [
      `import { Node } from 'web-tree-sitter';`,
      `import type { Node } from "web-tree-sitter";`,
      `import * as TS from 'web-tree-sitter'`,
      `export type { Tree } from 'web-tree-sitter';`,
      `import 'unbash';`,
      `type T = import('web-tree-sitter').Tree;`,
      `const { parse } = require('unbash');`,
      `const m = await import("unbash/dist/index.js");`,
    ]) assert.ok(LIBRARIES.test(code), code);
    assert.ok(!LIBRARIES.test(`import { x } from './syntax/tree'; // not web-tree-sitter`));
  });
});
