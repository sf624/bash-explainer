// The rewrites of the corpus (docs/design/oracles.md, 3.3 and step 5): every fact of a mechanical id that sample.sh,
// the other fixtures and the snippets of the tests raise, its rewrites applied. For each rewrite, the two cheap checks:
// it parses (`bash -n`, in bash 5.2 and 5.3 when `$BASH_EXPLAINER_BASH53` names one), and explaining it raises no fact
// of the same id where it was made. Then the oracles of each id over its states (test/support/rewrite-states.ts,
// `STATES`), where they apply: the meaning is kept, the hazard is gone. The counts are pinned, so that a change of the
// corpus or of an oracle that runs fewer checks shows (update them when the corpus changes them).
import * as assert from 'assert';
import type { FactId } from '../src/messages';
import { checkStates, corpusFacts, factsIn, type IdCounts, leavesNoFact, MECHANICAL, parses, singles, STATES, subjects } from './support/rewrite-states';
import { programs } from './support/rewrites';

/**
 * For each id: its subjects (the rewrites of an input, applied together), those whose states ran, the checks made, and
 * why the others did not run.
 */
const PINNED: Partial<Record<FactId, IdCounts>> = {
  'array-joined-in-assignment': { subjects: 11, ran: 10, checks: 20, skipped: { 'an assignment in a function, whose variable the epilogue does not see': 1 } },
  'bracket-close-glued': { subjects: 3, ran: 2, checks: 2, skipped: { 'not a plain name before `]`': 1 } },
  'declaration-masks-status': { subjects: 6, ran: 5, checks: 11, skipped: { 'bash does not parse it': 1 } },
  'failure-reported-as-success': { subjects: 2, ran: 2, checks: 16, skipped: {} },
  'for-over-unquoted-args': { subjects: 4, ran: 4, checks: 12, skipped: {} },
  'nounset-unbound': { subjects: 5, ran: 5, checks: 15, skipped: {} },
  'postfix-increment-status': { subjects: 14, ran: 14, checks: 28, skipped: {} },
  'prefix-assignment-expanded-first': { subjects: 1, ran: 1, checks: 2, skipped: {} },
  'regex-backslash-dropped': { subjects: 2, ran: 2, checks: 24, skipped: {} },
  'unbraced-element': { subjects: 1, ran: 1, checks: 1, skipped: {} },
  'unmatched-glob-runs-once': { subjects: 7, ran: 7, checks: 14, skipped: {} },
  'unquoted-variable-as-path': { subjects: 27, ran: 13, checks: 76, skipped: { 'a command named by a path': 2, 'the script sets `BUILD_DIR`': 1, 'the script sets `D`': 5, 'the script sets `DIR`': 5, '`source`': 1 } },
  'unquoted-variable-in-test': { subjects: 9, ran: 9, checks: 51, skipped: {} },
  'wrapper-assignment-expanded-first': { subjects: 1, ran: 1, checks: 2, skipped: {} },
};

/**
 * Inputs for the ids the corpus raises nowhere (the three `*-last-test-*` ids), and for a list of a glob and other
 * words, where the test of the name in the body would skip the words that are no files: the same oracles.
 */
const HAND = [
  '#!/bin/bash\nset -e\nf() {\n  [ -f x ] && echo "@y"\n}\nf\necho @next\n',
  '#!/bin/bash\nset -e\nf() { [[ -f x ]] && echo y; }\necho @start\nf\n',
  '#!/bin/bash\necho @start\n[ -f x ] && echo "@y"\n',
  'for i in a b *.c; do echo "$i"; done\n',
];

describe('the rewrites of the corpus (docs/design/oracles.md, step 5)', function () {
  this.timeout(60000);
  const facts = corpusFacts();
  const one = singles(facts);

  it('has states and an oracle for every mechanical id', () => {
    assert.deepStrictEqual(MECHANICAL.filter((id) => !STATES[id]), []);
  });
  it('leave no fact of the same id where they were made', () => {
    assert.deepStrictEqual(one.flatMap((s) => { const bad = leavesNoFact(s); return bad ? [`${s.id} in ${JSON.stringify(s.input)}, ${JSON.stringify(s.codes)}: ${bad}`] : []; }), []);
  });
  for (const { name, program } of programs) {
    it(`parse in ${name}, where the original does`, async () => {
      const [before, after] = await Promise.all([parses(program, one.map((s) => s.original)), parses(program, one.map((s) => s.script))]);
      assert.deepStrictEqual(one.filter((_, i) => before[i] && !after[i]).map((s) => `${s.id} in ${JSON.stringify(s.input)}: ${JSON.stringify(s.codes)}`), []);
      // (One snippet bash does not parse: `@(a|b)` in a `case` without extglob.)
      assert.strictEqual(before.filter((b) => !b).length, 1);
    });
    it(`keep the meaning and remove the hazard over the states of their ids, in ${name}`, async () => {
      const { failures, counts } = await checkStates(program, subjects(facts));
      assert.deepStrictEqual(failures, []);
      assert.deepStrictEqual(Object.fromEntries(Object.entries(counts).sort()), PINNED);
    });
    it(`do so too on inputs for the ids the corpus raises nowhere, in ${name}`, async () => {
      const { failures, counts } = await checkStates(program, subjects(HAND.flatMap((t) => factsIn(t, t))));
      assert.deepStrictEqual(failures, []);
      // (Every mechanical id has run over its states.)
      assert.deepStrictEqual(MECHANICAL.filter((id) => !counts[id]?.ran && !PINNED[id]?.ran), []);
    });
  }
});
