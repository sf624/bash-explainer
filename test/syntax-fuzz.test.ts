import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { forEachChild, parse } from 'unbash';
import { createTreeSitterParser } from '../src/syntax/adapters/tree-sitter';
import { createUnbashParser } from '../src/syntax/adapters/unbash';
import type { BashParser, SyntaxTree } from '../src/syntax/tree';
import { hasError } from '../src/syntax/tree';
import { fuzzInputs, soundness, uncovered } from './support/fuzz';
import { corpus } from './support/oracle';

// Fuzzing the adapters with unfinished and damaged input. The inputs come from the fixtures and the
// snippets of the tests: prefixes (what the user has typed so far), a word removed, a random cut.
// A fixed seed makes the run the same every time. Every tree must be sound, whatever the text:
// no throw, every child inside its parent and in order, texts and types of tokens true to the source,
// all indexes in range; and a text that unbash reports errors for must have errors or an incomplete
// node in the tree.

/** Whether unbash reports an error for the text, in the script or in any substitution in it. */
function unbashComplains(text: string): boolean {
  let found = false;
  const walk = (m: Parameters<typeof forEachChild>[0]): void => {
    if (m.type === 'Script' && (m as { errors?: unknown[] }).errors?.length) found = true;
    if (!found) forEachChild(m, walk);
  };
  walk(parse(text));
  return found;
}

describe('syntax adapters: fuzzing', () => {
  const root = path.join(__dirname, '..');
  let ts: BashParser;
  const ub = createUnbashParser();
  before(async () => {
    ts = await createTreeSitterParser({ runtimeDir: path.join(root, 'node_modules/web-tree-sitter'), bashWasm: path.join(root, 'grammar/tree-sitter-bash.wasm') });
  });
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

  it('tree-sitter adapter: no throw, and a tree that has the model\'s shape', () => {
    const bad: string[] = [];
    for (const text of inputs) {
      let t: SyntaxTree;
      try {
        t = ts.parse(text);
      } catch (e) {
        bad.push(`${JSON.stringify(text)}: throws ${(e as Error).message}`);
        continue;
      }
      // (tree-sitter starts an expansion in a string at the blank before it: the token `${` has a blank in its text.)
      const broken = soundness(t).filter((b) => !/token (\S+) has text\s+\1$/.test(b));
      if (broken.length) bad.push(`${JSON.stringify(text)}: ${broken[0]}`);
    }
    assert.deepEqual(bad.slice(0, 30), []);
  });

  it('unbash adapter: parses in linear time', () => {
    // A script of every fixture, repeated: 8 times the text should take about 8 times as long (not 64).
    const script = corpus().files.map((f) => f.text).join('\n');
    const best = (text: string): number => {
      let min = Infinity;
      for (let i = 0; i < 5; i++) {
        const t0 = performance.now();
        ub.parse(text);
        min = Math.min(min, performance.now() - t0);
      }
      return min;
    };
    best(script);
    const one = best(script);
    const eight = best(Array(8).fill(script).join('\n'));
    assert.ok(eight < 12 * one, `1x: ${one.toFixed(1)} ms, 8x: ${eight.toFixed(1)} ms`);
    // Many short lines: the case that was quadratic.
    const lines = (n: number): string => 'echo a b\n'.repeat(n);
    best(lines(500));
    assert.ok(best(lines(4000)) < 12 * best(lines(500)));
  });
});
