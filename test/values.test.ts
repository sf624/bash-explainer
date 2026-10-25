// The values Meaning shows against bash (docs/design/expansion-values.md), over the generated scripts of the
// decisions' test: no value the model gives may be another word than bash had, at any run. The scripts and probes are
// in test/support/values.ts; for a larger run by hand, call `checkAllValues(scripts(seed, 3000).map(…), dir, jobs)`.
import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { forModel, scripts } from './support/decisions';
import { checkAllValues, traceWords, withWords } from './support/values';

describe('values of expansions against bash (test/support/values.ts)', () => {
  it('reads the words of an xtrace line', () => {
    assert.deepStrictEqual(traceWords(`a '' 'b c' $'x\\ty' d\\ e 'it'\\''s'`), ['a', '', 'b c', 'x\ty', 'd e', "it's"]);
  });

  it('gives none that bash contradicts, over generated scripts', async function () {
    this.timeout(300_000);
    const list = scripts(2, 120);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'values-'));
    try {
      const results = await checkAllValues(list, dir, 6);
      const problems = results.flatMap((r, i) => r.problems.map((p) => `${p}\n${forModel(withWords(list[i]).text).src}`));
      assert.deepStrictEqual(problems, []);
      // (Enough values are given, and compared.)
      assert.ok(results.reduce((n, r) => n + r.compared, 0) > 300);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
