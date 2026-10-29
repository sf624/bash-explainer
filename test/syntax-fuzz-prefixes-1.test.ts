import * as assert from 'assert';
import { createUnbashParser } from '../src/syntax/adapters/unbash';
import { exerciseTree, prefixChunk } from './support/fuzz-exercise';

// One chunk of the prefixes of the fixtures' lines (see test/support/fuzz-exercise.ts).
describe('unbash adapter: fuzzing, prefixes chunk 1 of 2', function () {
  // (78 s of 120 s on a CI runner under coverage.)
  this.timeout(300000);
  it('analyzer and document checks: no throw on any prefix of any line of the fixtures', () => {
    const ub = createUnbashParser();
    const bad: string[] = [];
    for (const text of prefixChunk(1, 2)) {
      const r = exerciseTree(ub, text);
      if (r) bad.push(r);
    }
    assert.deepEqual(bad.slice(0, 30), []);
  });
});
