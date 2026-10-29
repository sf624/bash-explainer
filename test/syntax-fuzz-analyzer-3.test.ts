import * as assert from 'assert';
import { createUnbashParser } from '../src/syntax/adapters/unbash';
import { exerciseTree, fuzzChunk } from './support/fuzz-exercise';

// One chunk of the inputs of test/syntax-fuzz.test.ts (see test/support/fuzz-exercise.ts).
describe('unbash adapter: fuzzing, analyzer chunk 3 of 6', function () {
  this.timeout(120000);
  it('analyzer and document checks: no throw on any fuzzed tree', () => {
    const ub = createUnbashParser();
    const bad: string[] = [];
    for (const text of fuzzChunk(3, 6)) {
      const r = exerciseTree(ub, text);
      if (r) bad.push(r);
    }
    assert.deepEqual(bad.slice(0, 30), []);
  });
});
