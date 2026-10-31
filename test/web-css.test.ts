import * as assert from 'assert';
import * as path from 'path';

// Each rule of the page's style sheets is written once (docs/design/chrome-redesign.md, section 4 "web/page.css" and
// C0): stylelint (a devDependency, MIT; .stylelintrc.json) finds a selector that is written twice in a file and a
// property that is set twice in one block. A rule is merged into the first, not kept twice.
const root = path.join(__dirname, '..');

describe('web style sheets', () => {
  it('write each selector once per file, and each property once per block', async function () {
    this.timeout(60_000);
    const stylelint = (await import('stylelint')).default;
    const result = await stylelint.lint({ files: path.join(root, 'web/*.css'), configFile: path.join(root, '.stylelintrc.json') });
    const found = result.results.flatMap((r) => r.warnings.map((w) => `${path.relative(root, r.source ?? '')}:${w.line}: ${w.text}`));
    assert.deepStrictEqual(found, []);
    assert.ok(result.results.length >= 3, `${result.results.length} files`);
  });

  it('finds a duplicate selector and a duplicate property (the check is not empty)', async function () {
    this.timeout(60_000);
    const stylelint = (await import('stylelint')).default;
    const result = await stylelint.lint({
      code: 'a { color: red; }\na { margin: 0; }\nb { top: 0; top: 1px; }\n',
      configFile: path.join(root, '.stylelintrc.json'),
    });
    assert.deepStrictEqual(result.results[0].warnings.map((w) => w.rule).sort(), ['declaration-block-no-duplicate-properties', 'no-duplicate-selectors']);
  });
});
