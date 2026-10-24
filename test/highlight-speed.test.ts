// A guard on the time of our semantic tokens on a long script (5,000 lines of the sample): the full request with the
// model built (the panel or the diagnostics build it once per version), and a range request of one screen, which reads
// the names and the specs on its lines only. The limits are generous (a slow CI machine passes); the numbers measured
// are in docs/design/highlighting.md. Skipped under coverage, whose instrumentation slows everything down.
import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { semanticTokens } from '../src/semanticTokens';
import { shellState } from '../src/semantics/state';
import { createUnbashParser } from '../src/syntax/adapters/unbash';

const LINES = 5000;

/** The median time of `runs` calls of `f`, in milliseconds. */
function median(f: () => unknown, runs = 5): number {
  const times: number[] = [];
  for (let i = 0; i < runs; i++) {
    const t0 = performance.now();
    f();
    times.push(performance.now() - t0);
  }
  return times.sort((a, b) => a - b)[Math.floor(runs / 2)];
}

describe('the speed of the semantic tokens', function () {
  this.timeout(120000);
  before(function () {
    if (process.env.NODE_V8_COVERAGE) this.skip();
  });

  const sample = fs.readFileSync(path.join(__dirname, 'fixtures/sample.sh'), 'utf8').split('\n');
  const lines: string[] = [];
  while (lines.length < LINES) lines.push(...sample);
  const text = lines.slice(0, LINES).join('\n') + '\n';

  it(`colours ${LINES} lines in time, and one screen of them much faster`, () => {
    const tree = createUnbashParser().parse(text);
    const doc = { lines: text.split('\n'), tree };
    shellState(tree);
    const full = median(() => semanticTokens(doc));
    const range = median(() => semanticTokens(doc, { lines: { from: 2000, to: 2060 } }));
    assert.ok(full < 1500, `full request: ${full.toFixed(0)} ms`);
    assert.ok(range < 150, `range request: ${range.toFixed(0)} ms`);
    assert.ok(range * 4 < full, `range ${range.toFixed(0)} ms against full ${full.toFixed(0)} ms`);
  });

  it('takes a time linear in the uses of one variable', () => {
    // (Whether the model trusts a variable is asked at every use; a scan of its writes each time made 20,000 lines of
    // these take 13 times as long as 5,000.)
    const time = (n: number) => {
      const tree = createUnbashParser().parse(Array.from({ length: n }, () => 'x=$i; echo "$x"').join('\n'));
      shellState(tree);
      return median(() => semanticTokens({ lines: [], tree }), 3);
    };
    const small = time(5000);
    const large = time(20000);
    assert.ok(large < small * 8, `5,000 lines: ${small.toFixed(0)} ms; 20,000: ${large.toFixed(0)} ms`);
  });
});
