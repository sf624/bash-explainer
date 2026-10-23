import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';

// The node names that bash's own parser does not have, and that no producer makes any more
// (step 6 of "Command nodes at bash's granularity" in docs/design/syntax-tree.md). `SyntaxNode.type`
// is `NodeType | string`, so a comparison with one of them would be no type error: this test is the guard.
const REMOVED = ['test_command', 'unset_command', 'declaration_command', 'variable_assignments'];
const src = path.join(__dirname, '..', 'src');

function sources(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const file = path.join(dir, e.name);
    return e.isDirectory() ? sources(file) : /\.ts$/.test(e.name) ? [file] : [];
  });
}

describe('removed node names', () => {
  it('appear nowhere in src/, comments included', () => {
    const files = sources(src);
    assert.ok(files.length > 40);
    const offenders = files.flatMap((f) => {
      const text = fs.readFileSync(f, 'utf8');
      return REMOVED.filter((name) => text.includes(name)).map((name) => `${path.relative(src, f)}: ${name}`);
    });
    assert.deepStrictEqual(offenders, []);
  });
});
