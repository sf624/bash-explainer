import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { REGIONS, regionLines, withRegions } from '../scripts/level-css';

// The style sheets' rules of the note levels are written from the level table (src/levels.ts) by scripts/level-css.ts, in
// regions between two comments; the guard of test/note-levels.test.ts leaves the regions out, so they must be what the
// table gives.
const root = path.join(__dirname, '..');

describe('the level table in the style sheets (scripts/level-css.ts)', () => {
  for (const file of Object.keys(REGIONS)) {
    it(`${file}: every region is the level table's`, () => {
      const text = fs.readFileSync(path.join(root, file), 'utf8');
      assert.strictEqual(withRegions(file, text), text, `${file} is stale: run npx tsx scripts/level-css.ts`);
      // (Each region the script knows is in the file.)
      for (const name of Object.keys(REGIONS[file])) assert.ok(text.includes(`scripts/level-css.ts): ${name} */`), `${file} has no region ${name}`);
    });
  }

  it('writes a region at the indentation of its comment, and refuses an unknown or unclosed one', () => {
    const open = (name: string) => `    /* level table (src/levels.ts, scripts/level-css.ts): ${name} */`;
    const out = withRegions('web/theme.css', `a {\n${open('dark')}\n    --old: 1;\n    /* end of the level table */\n}`);
    assert.strictEqual(out, `a {\n${open('dark')}\n    --vscode-editorWarning-foreground: #cca700;\n    --vscode-editorInfo-foreground: #3794ff;\n    /* end of the level table */\n}`);
    assert.deepStrictEqual([...regionLines(out)], [3, 4]);
    assert.throws(() => withRegions('web/theme.css', `${open('nothing')}\n/* end of the level table */`), /no region "nothing"/);
    assert.throws(() => withRegions('web/theme.css', open('dark')), /not closed/);
  });
});
