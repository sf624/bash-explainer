// Records what bash does with the rows of the probe tables (test/fixtures/probes/*.json): runs each row's
// snippet with its probe (test/support/probe.ts) and writes the facts into the row. test/probe.test.ts
// checks that bash still does the same.
//
//   npx tsx scripts/record-probes.ts [kind…]           rewrite the facts (of these kinds, or all)
//   npx tsx scripts/record-probes.ts --check [kind…]   fail if a row's facts are not what bash does
//
// To add a row, add `{ "manual": "3.5.7", "snippet": "…" }` to a table and run the script; then read the
// facts it wrote before committing them.
import * as fs from 'fs';
import { factsOf, pooled, PROBE_KINDS, probeFile, ProbeKind, probeSkipReason, readProbeTable } from '../test/support/probe';

const args = process.argv.slice(2);
const check = args.includes('--check');
const kinds = args.filter((a) => a !== '--check') as ProbeKind[];
for (const k of kinds) if (!PROBE_KINDS.includes(k)) throw new Error(`unknown probe kind: ${k} (${PROBE_KINDS.join(', ')})`);

(async () => {
  if (probeSkipReason) {
    console.error(`Cannot record the probes: ${probeSkipReason}`);
    process.exit(1);
  }
  let stale = 0;
  for (const kind of kinds.length ? kinds : PROBE_KINDS) {
    const rows = readProbeTable(kind);
    const facts = await pooled(rows.map((row) => () => factsOf(kind, row)));
    const next = rows.map((row, i) => ({ ...row, facts: facts[i] }));
    const json = `${JSON.stringify(next, null, 2)}\n`;
    if (check) {
      next.forEach((row, i) => {
        if (JSON.stringify(row.facts) !== JSON.stringify(rows[i].facts)) {
          stale++;
          console.error(`${kind}.json: ${JSON.stringify(row.snippet)}\n  recorded: ${JSON.stringify(rows[i].facts)}\n  bash:     ${JSON.stringify(row.facts)}`);
        }
      });
    } else {
      fs.writeFileSync(probeFile(kind), json);
      console.log(`${kind}.json: ${rows.length} rows`);
    }
  }
  if (stale) process.exit(1);
})();
