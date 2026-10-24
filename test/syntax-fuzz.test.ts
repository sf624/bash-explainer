import * as assert from 'assert';
import * as fs from 'fs';
import { forEachChild, parse } from 'unbash';
import { createUnbashParser } from '../src/syntax/adapters/unbash';
import type { SyntaxTree } from '../src/syntax/tree';
import { hasError } from '../src/syntax/tree';
import { fuzzInputs, soundness, uncovered } from './support/fuzz';
import { exerciseTree } from './support/fuzz-exercise';
import { corpus } from './support/corpus';

// Fuzzing the adapter with unfinished and damaged input. The inputs come from the fixtures and the
// snippets of the tests: prefixes (what the user has typed so far), a word removed, a random cut.
// A fixed seed makes the run the same every time. Every tree must be sound, whatever the text:
// no throw, every child inside its parent and in order, texts and types of tokens true to the source,
// all indexes in range; and a text that unbash reports errors for must have errors or an incomplete
// node in the tree.

/**
 * Whether unbash reports an error for the text, in the script or in any substitution in it. (Not the one it reports
 * for `&> >(tee log)`, a redirection with no target before a process substitution: the adapter reads it as bash does,
 * `parseScript` in src/syntax/adapters/unbash.ts.)
 */
function unbashComplains(text: string): boolean {
  let found = false;
  const bothOutputs = (e: { message: string; pos: number }): boolean => e.message === 'expected redirect target' && /^[<>]\(/.test(text.slice(e.pos)) && /&>>?[ \t]*$/.test(text.slice(0, e.pos));
  const walk = (m: Parameters<typeof forEachChild>[0]): void => {
    if (m.type === 'Script' && (m as { errors?: { message: string; pos: number }[] }).errors?.some((e) => !bothOutputs(e))) found = true;
    if (!found) forEachChild(m, walk);
  };
  walk(parse(text));
  return found;
}

// (The analyzer and the document checks on the same inputs run in test/syntax-fuzz-analyzer-*.test.ts and
// test/syntax-fuzz-prefixes-*.test.ts, in chunks, so that parallel workers share the time.)
describe('unbash adapter: fuzzing', () => {
  const ub = createUnbashParser();
  const inputs = fuzzInputs();

  it('is deterministic and large enough', () => {
    assert.deepEqual(fuzzInputs(), inputs);
    assert.ok(inputs.length > 5000, `${inputs.length} inputs`);
  });

  it('unbash adapter: no throw, sound trees, and errors for what unbash rejects', () => {
    const bad: string[] = [];
    for (const text of inputs) {
      let t: SyntaxTree;
      try {
        t = ub.parse(text);
      } catch (e) {
        bad.push(`${JSON.stringify(text)}: throws ${(e as Error).message}`);
        continue;
      }
      const broken = soundness(t);
      if (broken.length) bad.push(`${JSON.stringify(text)}: ${broken[0]}`);
      else if (t.text !== text) bad.push(`${JSON.stringify(text)}: text`);
      else if (unbashComplains(text) && !t.errors.length && !hasError(t.root)) bad.push(`${JSON.stringify(text)}: unbash reports an error, the tree has none`);
      else if (uncovered(t).length) bad.push(`${JSON.stringify(text)}: text no node covers: ${uncovered(t)[0]}`);
    }
    assert.deepEqual(bad.slice(0, 30), []);
  });

  it('keeps a quoted [ out of the test command, and a condition out of the part after it', () => {
    for (const text of ["'[", "'[' -f x ]", 'if !(then :; fi', 'if (then :; elif (then :; fi']) {
      assert.deepEqual(soundness(ub.parse(text)), [], text);
    }
  });

  const exercise = (text: string): string | undefined => exerciseTree(ub, text);

  // (`jq 'def g(x'` looped for ever: the parameters of a definition with no `)`.)
  it('analyzer and document checks: the unfinished lines that threw', () => {
    for (const text of ['for f in *', 'for f in *.txt; d', '[[ -f', 'if [[ -z', '[[ $a && -n', '[[ x || -z ', 'cat <<', 'cat <<-', 'tr a-z A-Z <<', '#!/bin/sh\nmake build &>', '#!/bin/sh\nif [[ -f ]]; then :; fi', "jq 'def g(x'"]) {
      assert.strictEqual(exercise(text), undefined, text);
    }
  });

  it('unbash adapter: parses in linear time', () => {
    // A script of every fixture, repeated: 8 times the text should take about 8 times as long (not 64).
    const script = corpus().files.map((f) => f.text).join('\n');
    // Best of several runs, on inputs large enough that a run takes milliseconds: on a busy CI runner a
    // garbage collection can double one short run. A quadratic parser gives 64 times as long for 8 times
    // the input, so a bound of 16 still catches it.
    const best = (text: string): number => {
      let min = Infinity;
      for (let i = 0; i < 7; i++) {
        const t0 = performance.now();
        ub.parse(text);
        min = Math.min(min, performance.now() - t0);
      }
      return min;
    };
    best(script);
    const one = best(script);
    const eight = best(Array(8).fill(script).join('\n'));
    assert.ok(eight < 16 * one, `1x: ${one.toFixed(1)} ms, 8x: ${eight.toFixed(1)} ms`);
    // Many short lines: the case that was quadratic.
    const lines = (n: number): string => 'echo a b\n'.repeat(n);
    best(lines(1000));
    const few = best(lines(1000));
    const many = best(lines(8000));
    assert.ok(many < 16 * few, `1000 lines: ${few.toFixed(1)} ms, 8000 lines: ${many.toFixed(1)} ms`);
  });
});
