// The generator of the normal-forms audit over more forms than CI runs (docs/design/oracles.md, step 8):
// test/normal-forms-gen.test.ts runs a small sample, from a fixed seed; this runs as many forms of each scenario as
// asked, from the seed given, in bash 5.2 (and 5.3, when `$BASH_EXPLAINER_BASH53` names one). Run it by hand after a
// change of a normalizer (src/staticword.ts, src/dict/aliases.ts, src/argv/interpret.ts…):
//
//   npx tsx scripts/normal-forms-sweep.ts [--seed N] [--count N] [--jobs N] [--missed]
//
// It prints the counts, the false merges that no rule of `ACCEPTED` takes (forms with one key that bash runs
// otherwise), and with `--missed` the missed matches (forms with keys of their own that bash runs the same: a report).
// It fails on a false merge. A rule of `ACCEPTED` that took nothing is listed, not failed: the sample may not reach it.
import { ACCEPTED, check, generate, SEED } from '../test/support/normal-forms-gen';
import { hasBash53, PROBE_BASH, PROBE_BASH53, probeSkipReason } from '../test/support/probe';

const arg = (name: string, fallback: number): number => {
  const at = process.argv.indexOf(name);
  return at > 0 ? Number(process.argv[at + 1]) : fallback;
};
const seed = arg('--seed', SEED);
const count = arg('--count', 200);
const jobs = arg('--jobs', 4);
const missed = process.argv.includes('--missed');

(async () => {
  if (probeSkipReason) throw new Error(`needs bash 5.2 or later: ${probeSkipReason}`);
  const forms = generate(seed, count);
  let failed = false;
  for (const [release, program] of [['5.2', PROBE_BASH], ...(hasBash53 ? [['5.3', PROBE_BASH53!]] : [])]) {
    const started = Date.now();
    const r = await check(program, forms, jobs);
    console.log(`bash ${release}: ${r.counts.forms} forms, ${r.counts.groups} groups of several forms, ${((Date.now() - started) / 1000).toFixed(1)} s`);
    for (const f of r.falseMerges) {
      console.log(`  FALSE MERGE (${f.scenario}, ${f.normalizer}) key ${JSON.stringify(f.key)}`);
      for (const x of f.forms) console.log(`    ${JSON.stringify(x.text)} -> ${x.observed}`);
    }
    if (missed) {
      for (const f of r.missedMatches) {
        console.log(`  missed match (${f.scenario}, ${f.normalizer}) ${f.forms[0].observed}`);
        for (const x of f.forms) console.log(`    ${JSON.stringify(x.text)}`);
      }
    } else console.log(`  ${r.missedMatches.length} missed matches (--missed lists them)`);
    for (const [n, a] of ACCEPTED.entries()) if (!r.used.has(n)) console.log(`  rule ${n} took nothing: ${a.reason}`);
    failed ||= r.falseMerges.length > 0;
  }
  process.exitCode = failed ? 1 : 0;
})();
