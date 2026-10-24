import * as assert from 'assert';
import * as fs from 'fs';
import { forEachChild, parse } from 'unbash';
import { createUnbashParser } from '../src/syntax/adapters/unbash';
import type { SyntaxTree } from '../src/syntax/tree';
import { hasError } from '../src/syntax/tree';
import { fuzzInputs, soundness, uncovered } from './support/fuzz';
import { corpus } from './support/corpus';
import { Analyzer } from '../src/analyzer';
import { documentIssues } from '../src/document';
import type { Shell } from '../src/dialect';

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

  // The analyzer and the checks must not throw on any tree, whatever is typed: the extension explains the line the user is typing.
  const analyzers = { en: new Analyzer('en'), ja: new Analyzer('ja') };
  const shells: Shell[] = ['sh', 'bash', 'zsh'];
  const exercise = (text: string): string | undefined => {
    let t: SyntaxTree;
    try {
      t = ub.parse(text);
    } catch {
      return undefined; // the parser's own test reports it
    }
    const lines = text.split(/\r?\n/);
    try {
      for (const lang of ['en', 'ja'] as const) {
        for (let i = 0; i < lines.length; i++) for (const shell of [undefined, 'zsh'] as const) analyzers[lang].explainLine(t, i, shell);
        for (const forced of shells) documentIssues({ lines, tree: t }, lang, { forced });
      }
    } catch (e) {
      return `${JSON.stringify(text)}: throws ${(e as Error).stack?.split('\n').slice(0, 3).join(' | ')}`;
    }
    return undefined;
  };

  // (`jq 'def g(x'` looped for ever: the parameters of a definition with no `)`.)
  it('analyzer and document checks: the unfinished lines that threw', () => {
    for (const text of ['for f in *', 'for f in *.txt; d', '[[ -f', 'if [[ -z', '[[ $a && -n', '[[ x || -z ', 'cat <<', 'cat <<-', 'tr a-z A-Z <<', '#!/bin/sh\nmake build &>', '#!/bin/sh\nif [[ -f ]]; then :; fi', "jq 'def g(x'"]) {
      assert.strictEqual(exercise(text), undefined, text);
    }
  });

  it('analyzer and document checks: no throw on any fuzzed tree', function () {
    this.timeout(120000);
    const bad: string[] = [];
    for (const text of inputs) {
      const r = exercise(text);
      if (r) bad.push(r);
    }
    assert.deepEqual(bad.slice(0, 30), []);
  });

  it('analyzer and document checks: no throw on any prefix of any line of the fixtures', function () {
    this.timeout(120000);
    const bad: string[] = [];
    const seen = new Set<string>();
    for (const f of corpus().files) {
      for (const line of f.text.split('\n')) {
        for (let n = 1; n <= line.length; n++) {
          const prefix = line.slice(0, n);
          if (seen.has(prefix)) continue;
          seen.add(prefix);
          const r = exercise(prefix);
          if (r) bad.push(r);
        }
      }
    }
    assert.deepEqual(bad.slice(0, 30), []);
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
