// What bash does to a word, as depth 2 of the panel says it (`wordSteps`, src/semantics/wordsteps.ts), against the word probes: the rows of
// test/fixtures/probes/words.json hold what bash gave each word, and test/word-probes.test.ts holds `wordFields` to it. A word where no step
// acts is one field, its text without its quotes. A word that becomes several fields, or none, has a step that acts.
import * as assert from 'assert';
import { createUnbashParser } from '../src/syntax/adapters/unbash';
import { descendants, field, fields } from '../src/syntax/tree';
import { shellState } from '../src/semantics/state';
import { stepsChange, wordSteps } from '../src/semantics/wordsteps';
import { type StepKind, wordFields, wordMeaning, type WordEnv } from '../src/semantics/words';
import { BOX, FILES, instrument, PROBE_ENV, readProbeTable } from './support/probe';

const ENV: WordEnv = { variables: PROBE_ENV, pwd: BOX, files: FILES };
const ORDER: readonly StepKind[] = ['brace', 'tilde', 'parameter', 'command', 'arithmetic', 'process', 'split', 'glob', 'quote-removal'];

describe('the steps of a word against the word probes', () => {
  const parser = createUnbashParser();
  const rows = readProbeTable('words') as { snippet: string; posix?: boolean; bash?: '5.2' | '5.3' }[];
  const stepsOf = (src: string, text: string) => {
    const tree = parser.parse(src);
    const state = shellState(tree, 'bash', { read: 'script' });
    const w = descendants(tree.root, ['command']).flatMap((c) => fields(c, 'argument')).find((a) => a.text === text)!;
    return wordSteps(wordMeaning(w, state)!);
  };

  it('agrees over the probes: no step acts, one field; several fields or none, a step acts', () => {
    let quiet = 0;
    let acting = 0;
    for (const row of rows) {
      const tree = parser.parse(instrument(row.snippet).script);
      const state = shellState(tree, 'bash', { posix: row.posix, version: row.bash, read: 'script' });
      for (const c of descendants(tree.root, ['command']).filter((x) => field(x, 'name')?.text === '__probe')) {
        for (const w of fields(c, 'argument').slice(1)) {
          const m = wordMeaning(w, state);
          if (!m) continue;
          const steps = wordSteps(m);
          // Every step, in bash's order.
          if (steps) assert.deepStrictEqual(steps.map((s) => s.kind), ORDER, row.snippet);
          const got = wordFields(w, state, ENV);
          if (!got.fields) continue;
          if (!steps || !stepsChange(steps)) {
            quiet++;
            assert.strictEqual(got.fields.length, 1, `${row.snippet}: ${w.text} gives ${JSON.stringify(got.fields)}`);
            if (m.value !== undefined) assert.strictEqual(got.fields[0], m.value, `${row.snippet}: ${w.text}`);
          } else if (got.fields.length !== 1) {
            acting++;
            assert.ok(stepsChange(steps), `${row.snippet}: ${w.text} gives ${JSON.stringify(got.fields)}`);
          }
        }
      }
    }
    assert.ok(quiet > 20 && acting > 20, `${quiet} and ${acting}: the probes reach both`);
  });

  it('names each step that acts, arithmetic expansion too, with why another does not', () => {
    const acts = (src: string, text: string) => stepsOf(src, text)!.filter((s) => s.applies !== false).map((s) => s.kind);
    assert.deepStrictEqual(acts('echo $((1 + 2))', '$((1 + 2))'), ['arithmetic', 'split', 'glob']);
    assert.deepStrictEqual(acts('echo "$((1 + 2))"', '"$((1 + 2))"'), ['arithmetic', 'quote-removal']);
    assert.deepStrictEqual(acts('echo ~/a', '~/a'), ['tilde']);
    assert.deepStrictEqual(acts('echo {a,b}$c', '{a,b}$c'), ['brace', 'parameter', 'split', 'glob']);
    const quoted = stepsOf('echo "$a"', '"$a"')!;
    assert.deepStrictEqual(quoted.filter((s) => s.kind === 'split' || s.kind === 'glob').map((s) => [s.applies, s.why]), [[false, 'quoted'], [false, 'quoted']]);
    // The manual's section of each.
    assert.deepStrictEqual(quoted.filter((s) => s.applies !== false).map((s) => s.manual), ['3.5.3', '3.5.9']);
    // A word no step has anything to do with has none; nor one in a place that leaves them out.
    assert.strictEqual(stepsOf('echo a.txt', 'a.txt'), undefined);
    // (`set -f` is a reason worth saying; a place with no brace expansion, on a word with no braces, is not.)
    assert.strictEqual(stepsOf('set -f; echo *.txt', '*.txt')!.find((s) => s.kind === 'glob')!.why, 'noglob');
    assert.strictEqual(stepsOf('echo $a', '$a')!.find((s) => s.kind === 'brace')!.why, undefined);
  });
});
