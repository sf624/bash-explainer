// The generator of the normal-forms audit (docs/design/oracles.md, 4.2 and step 8; test/support/normal-forms-gen.ts):
// seeded spellings of the words of a few scenarios (quoting variants, path prefixes of a command name, option
// spellings), keyed by the normalizers of 4.1 and run in bash 5.2 and, when `$BASH_EXPLAINER_BASH53` names one, 5.3.
// Forms with one key that bash runs otherwise are a false merge, and fail, unless a rule of `ACCEPTED` takes them
// (with its reason); a rule that takes nothing in the sample is stale and fails, as a `known` row of the table does.
// Forms with keys of their own that bash runs the same (a missed match) are not failures: scripts/normal-forms-sweep.ts
// lists them, over as many forms and from whatever seed it is given.
import * as assert from 'assert';
import { ACCEPTED, check, generate, SCENARIOS, SEED } from './support/normal-forms-gen';
import { hasBash53, PROBE_BASH, PROBE_BASH53, probeSkipReason } from './support/probe';

/** The forms of each scenario in the sample. */
const COUNT = 30;
const forms = generate(SEED, COUNT);

describe('normal forms (oracles.md, 4.2): the generator', () => {
  it('makes the same forms from the same seed, for every scenario', () => {
    assert.deepStrictEqual(generate(SEED, COUNT).map((f) => f.text), forms.map((f) => f.text));
    assert.deepStrictEqual(SCENARIOS.filter((s) => !forms.some((f) => f.scenario === s)).map((s) => s.name), []);
  });
});

describe('normal forms (oracles.md, 4.2): generated forms with one key run the same in bash', function () {
  this.timeout(120000);
  const releases: [string, string][] = [['5.2', PROBE_BASH], ...(hasBash53 ? [['5.3', PROBE_BASH53!] as [string, string]] : [])];
  for (const [release, program] of releases) {
    it(`in bash ${release} (${forms.length} forms, seed ${SEED})`, async function () {
      if (probeSkipReason) this.skip();
      const r = await check(program, forms);
      const merges = r.falseMerges.map((f) => `${f.scenario}, ${f.normalizer}: key ${JSON.stringify(f.key)}: ${f.forms.map((x) => `${JSON.stringify(x.text)} -> ${x.observed}`).join(' / ')}`);
      const stale = ACCEPTED.filter((_, n) => !r.used.has(n)).map((a) => `stale: a rule of ACCEPTED took nothing (${a.scenario}, ${a.normalizer}): ${a.reason}`);
      // (A scenario and normalizer whose forms never share a key would check nothing.)
      const empty = Object.entries(r.counts.per).filter(([, n]) => !n).map(([k]) => `no key of several forms: ${k}`);
      assert.deepStrictEqual([...merges, ...stale, ...empty], []);
    });
  }
});
