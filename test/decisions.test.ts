// The decisions of the state model against bash (docs/design/semantics.md, 4.14): over generated scripts (seeded,
// distinct), no condition the model decides may have another status in bash, no value it read another value, no
// `case` run other items, and no code it marks dead may run. The scripts and probes are in test/support/decisions.ts;
// for a larger run by hand, call `checkAll(scripts(seed, 3000), dir, jobs)` from a script of your own.
import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { checkAll, forModel, scripts } from './support/decisions';

describe('decisions of the state model against bash (test/support/decisions.ts)', () => {
  it('makes none that bash contradicts, over generated scripts', async function () {
    this.timeout(300_000);
    const list = scripts(1, 120);
    assert.strictEqual(new Set(list.map((s) => s.text)).size, list.length);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'decisions-'));
    try {
      const results = await checkAll(list, dir, 6);
      const problems = results.flatMap((r, i) => r.problems.map((p) => `${p}\n${forModel(list[i].text).src}`));
      assert.deepStrictEqual(problems, []);
      // (Enough of them decide something, and some trust nothing.)
      assert.ok(results.reduce((n, r) => n + r.decided, 0) > 50);
      assert.ok(results.reduce((n, r) => n + r.dead, 0) > 200);
      assert.ok(results.some((r) => r.blind));
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
