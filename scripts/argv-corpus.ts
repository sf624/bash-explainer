// Argv capture over the whole corpus (docs/design/oracles.md, steps 3 and 9): the fixtures, every snippet of the tests
// that parses and 200 fuzz inputs, each in the two environments of test/argv.test.ts, which runs the fixtures and a
// sample of the snippets in CI. Run it by hand before a release, or after a change of the word model or the explanation
// of words:
//
//   npx tsx scripts/argv-corpus.ts [--jobs N]
//
// It prints the counts of each set, the differences test/fixtures/argv-known.json does not accept, its entries that are
// stale (an input that ran and no longer differs, or one that is in no set), and the words the model could know (bash
// gave them the same fields on every run: a report, not a failure). Then the same for the renderings and the roles
// (step 9, test/support/renderings.ts) and test/fixtures/renderings-known.json. It fails on a difference, a stale entry,
// or a command that reached a PATH search; but a difference of the renderings in a fuzz input is only reported (`SHOWN
// (fuzz, not failing)`): the fuzz inputs change with every snippet, too often for entries, and a bug they show is given
// a stable input (a snippet or test/fixtures/renderings.sh) with its entry. It takes about 15 s on 4 jobs.
import * as fs from 'fs';
import { ARGV_KNOWN, type ArgvKnownFile, checkArgv, fixtureInputs, fuzzArgvInputs, matchKnown, runArgv, snippetInputs } from '../test/support/argv';
import { probeSkipReason } from '../test/support/probe';
import { checkRenderings, matchRenderKnown, RENDER_KNOWN, type RenderKnownFile, staleClasses } from '../test/support/renderings';

const at = process.argv.indexOf('--jobs');
const jobs = at > 0 ? Number(process.argv[at + 1]) : 4;

(async () => {
  if (probeSkipReason) throw new Error(`needs bash 5.2 or later: ${probeSkipReason}`);
  const known = JSON.parse(fs.readFileSync(ARGV_KNOWN, 'utf8')) as ArgvKnownFile;
  const renderKnown = JSON.parse(fs.readFileSync(RENDER_KNOWN, 'utf8')) as RenderKnownFile;
  const sets = { fixtures: fixtureInputs(), snippets: snippetInputs(), fuzz: fuzzArgvInputs(200) };
  let failed = false;
  const names = new Set<string>();
  const classes: number[] = [];
  for (const [set, inputs] of Object.entries(sets)) {
    const started = Date.now();
    const plans = await runArgv(inputs, { jobs });
    const { found, escaped, counts, candidates } = checkArgv(plans);
    const { unexplained, stale } = matchKnown(found, known.known, inputs);
    const rendered = checkRenderings(plans);
    const r = matchRenderKnown(rendered.found, renderKnown.known, inputs);
    classes.push(...r.classes);
    inputs.forEach((i) => names.add(i.name));
    console.log(`${set}: ${inputs.length} inputs, ${((Date.now() - started) / 1000).toFixed(1)} s`);
    for (const [env, c] of Object.entries(counts)) console.log(`  ${env}: ${JSON.stringify(c)}`);
    for (const e of escaped) console.log(`  ESCAPED ${e}`);
    for (const u of unexplained) console.log(`  DIFFERS ${u}`);
    for (const s of stale) console.log(`  STALE ${s}`);
    if (candidates.length) console.log(`  could know (${candidates.length}):`);
    for (const c of candidates) console.log(`    ${c.word} in ${JSON.stringify(c.command)}: ${JSON.stringify(c.fields).slice(0, 100)}`);
    console.log('  renderings and roles:');
    for (const [env, c] of Object.entries(rendered.counts)) console.log(`    ${env}: ${JSON.stringify(c)}`);
    const fuzz = set === 'fuzz';
    for (const u of r.unexplained) console.log(`    SHOWN${fuzz ? ' (fuzz, not failing)' : ''} ${u}`);
    for (const s of r.stale) console.log(`    STALE ${s}`);
    failed ||= escaped.length + unexplained.length + stale.length + (fuzz ? 0 : r.unexplained.length) + r.stale.length > 0;
  }
  const gone = [
    ...known.known.filter((e) => !names.has(e.input)).map((e) => `${JSON.stringify(e.input)}: ${e.command}`),
    ...renderKnown.known.filter((e) => e.input !== undefined && !names.has(e.input)).map((e) => `${JSON.stringify(e.input)}: ${e.command} [${e.word}, ${e.check}]`),
  ];
  const unused = staleClasses(renderKnown.known, classes);
  for (const e of gone) console.log(`STALE (no such input) ${e}`);
  for (const e of unused) console.log(`STALE (a class no input has) ${e}`);
  process.exitCode = failed || gone.length || unused.length ? 1 : 0;
})();
