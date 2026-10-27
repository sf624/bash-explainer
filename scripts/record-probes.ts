// Records what bash does with the rows of the probe tables (test/fixtures/probes/*.json): runs each row's
// snippet with its probe (test/support/probe.ts) and writes the facts into the row, and the output of its try-it
// (`try`), if any; then writes the copy of the rows with a try-it that the explanations read (src/basis-probes.json,
// docs/design/basis.md). test/probe.test.ts checks that bash still does the same.
//
//   npx tsx scripts/record-probes.ts [kind…]           rewrite the facts (of these kinds, or all)
//   npx tsx scripts/record-probes.ts --check [kind…]   fail if a row's facts are not what bash does
//
// To add a row, add `{ "manual": "3.5.7", "snippet": "…" }` to a table and run the script; then read the
// facts it wrote before committing them.
import * as fs from 'fs';
import { BASIS_COPY, basisCopy, factsOf, hasRequired, pooled, PROBE_KINDS, probeFile, ProbeKind, probeSkipReason, readProbeTable, tryOutput } from '../test/support/probe';

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
    // (A row whose program is missing keeps its facts.)
    const facts = await pooled(rows.map((row) => () => (hasRequired(row) ? factsOf(kind, row) : Promise.resolve(row.facts))));
    const outputs = await pooled(rows.map((row) => () => (row.try && hasRequired(row) ? tryOutput(row) : Promise.resolve(row.try?.output))));
    const next = rows.map((row, i) => ({ ...row, ...(row.try ? { try: { code: row.try.code, output: outputs[i] } } : {}), facts: facts[i] }));
    const json = `${JSON.stringify(next, null, 2)}\n`;
    if (check) {
      next.forEach((row, i) => {
        if (JSON.stringify(row.facts) !== JSON.stringify(rows[i].facts) || row.try?.output !== rows[i].try?.output) {
          stale++;
          console.error(`${kind}.json: ${JSON.stringify(row.snippet)}\n  recorded: ${JSON.stringify(rows[i].facts)} ${JSON.stringify(rows[i].try?.output ?? '')}\n  bash:     ${JSON.stringify(row.facts)} ${JSON.stringify(row.try?.output ?? '')}`);
        }
      });
    } else {
      fs.writeFileSync(probeFile(kind), json);
      console.log(`${kind}.json: ${rows.length} rows`);
    }
  }
  // (The copy is made from the tables as written; with --check, compared with the file.)
  const copy = `${JSON.stringify(basisCopy(), null, 2)}\n`;
  if (check) {
    if (fs.readFileSync(BASIS_COPY, 'utf8') !== copy) {
      stale++;
      console.error('src/basis-probes.json is not the copy of the rows with a try-it: run npx tsx scripts/record-probes.ts');
    }
  } else fs.writeFileSync(BASIS_COPY, copy);
  if (stale) process.exit(1);
})();
