// Argv capture over the whole corpus (docs/design/oracles.md, step 3): the fixtures, every snippet of the tests that
// parses and 200 fuzz inputs, each in the two environments of test/argv.test.ts, which runs the fixtures and a sample of
// the snippets in CI. Run it by hand before a release, or after a change of the word model:
//
//   npx tsx scripts/argv-corpus.ts [--jobs N]
//
// It prints the counts of each set, the differences test/fixtures/argv-known.json does not accept, its entries that are
// stale (an input that ran and no longer differs, or one that is in no set), and the words the model could know (bash
// gave them the same fields on every run: a report, not a failure). It fails on a difference, a stale entry, or a
// command that reached a PATH search. It takes about 10 s on 4 jobs.
import * as fs from 'fs';
import { ARGV_KNOWN, type ArgvKnownFile, checkArgv, fixtureInputs, fuzzArgvInputs, matchKnown, snippetInputs } from '../test/support/argv';
import { probeSkipReason } from '../test/support/probe';

const at = process.argv.indexOf('--jobs');
const jobs = at > 0 ? Number(process.argv[at + 1]) : 4;

(async () => {
  if (probeSkipReason) throw new Error(`needs bash 5.2 or later: ${probeSkipReason}`);
  const known = JSON.parse(fs.readFileSync(ARGV_KNOWN, 'utf8')) as ArgvKnownFile;
  const sets = { fixtures: fixtureInputs(), snippets: snippetInputs(), fuzz: fuzzArgvInputs(200) };
  let failed = false;
  const names = new Set<string>();
  for (const [set, inputs] of Object.entries(sets)) {
    const started = Date.now();
    const { found, escaped, counts, candidates } = await checkArgv(inputs, { jobs });
    const { unexplained, stale } = matchKnown(found, known.known, inputs);
    inputs.forEach((i) => names.add(i.name));
    console.log(`${set}: ${inputs.length} inputs, ${((Date.now() - started) / 1000).toFixed(1)} s`);
    for (const [env, c] of Object.entries(counts)) console.log(`  ${env}: ${JSON.stringify(c)}`);
    for (const e of escaped) console.log(`  ESCAPED ${e}`);
    for (const u of unexplained) console.log(`  DIFFERS ${u}`);
    for (const s of stale) console.log(`  STALE ${s}`);
    if (candidates.length) console.log(`  could know (${candidates.length}):`);
    for (const c of candidates) console.log(`    ${c.word} in ${JSON.stringify(c.command)}: ${JSON.stringify(c.fields).slice(0, 100)}`);
    failed ||= escaped.length + unexplained.length + stale.length > 0;
  }
  const gone = known.known.filter((e) => !names.has(e.input));
  for (const e of gone) console.log(`STALE (no such input) ${JSON.stringify(e.input)}: ${e.command}`);
  process.exitCode = failed || gone.length ? 1 : 0;
})();
