// The panel's budget for a move of the cursor (docs/design/panel-redesign.md, section 5: 50 ms at the 95th percentile, on a script of
// 2,000 lines). scripts/panel-speed.ts measures the same on real scripts, which are not in this repository.
import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { panelMoves, percentile } from './support/panel-speed';

describe('the panel: a move of the cursor', () => {
  for (const depth of [1, 2] as const) {
    it(`stays under the budget on a script of 2,000 lines, at depth ${depth}`, function () {
      this.timeout(300000);
      const sample = fs.readFileSync(path.join(__dirname, 'fixtures/sample.sh'), 'utf8');
      const text = sample.repeat(Math.ceil(2000 / sample.split('\n').length));
      const moves = panelMoves(text, 200, depth);
      assert.ok(moves.lines >= 2000, `${moves.lines} lines`);
      const p95 = percentile(moves, 0.95);
      assert.ok(p95 < 50, `${p95.toFixed(1)} ms at the 95th percentile`);
    });
  }
});
