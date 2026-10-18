// Checks the coverage of the unit tests (coverage/coverage-final.json, from `npm run coverage`, which
// leaves out the code tsx adds; see scripts/coverage-report.mjs): every file must run all its lines
// and take all its branches, except files listed in coverage-floors.json, which must not go below
// their floor. CI runs it on the job where every tool the tests compare against is installed; locally,
// tests for missing tools are skipped, so the numbers are lower. Measure with Node.js 24, as CI does:
// Node.js 22 reports the methods of a class that never ran as run.
//
//   node scripts/coverage-check.mjs           check
//   node scripts/coverage-check.mjs --update  set the floors to the current numbers (after adding tests)
import fs from 'node:fs';
import path from 'node:path';
import libCoverage from 'istanbul-lib-coverage';

const FLOORS = 'coverage-floors.json';
const map = libCoverage.createCoverageMap(JSON.parse(fs.readFileSync('coverage/coverage-final.json', 'utf8')));
const floors = fs.existsSync(FLOORS) ? JSON.parse(fs.readFileSync(FLOORS, 'utf8')) : {};
floors.lines ??= {};
floors.branches ??= {};

const pct = (covered, total) => (total ? Math.floor((covered / total) * 10000) / 100 : 100);
const rel = (f) => path.relative(process.cwd(), f).replace(/\\/g, '/');
const results = map.files().map((file) => {
  const fc = map.fileCoverageFor(file);
  const lineHits = fc.getLineCoverage();
  const lines = Object.keys(lineHits).filter((l) => !lineHits[l]).map(Number);
  const branches = Object.entries(fc.b).flatMap(([id, counts]) => counts.flatMap((n, i) => {
    if (n) return [];
    const loc = fc.branchMap[id].locations[i];
    return [`${loc.start.line}:${loc.start.column + 1}`];
  }));
  const s = fc.toSummary();
  return {
    file: rel(file),
    lines: { pct: pct(s.lines.covered, s.lines.total), uncovered: lines },
    branches: { pct: pct(s.branches.covered, s.branches.total), uncovered: branches },
  };
}).sort((a, b) => a.file.localeCompare(b.file));

const KINDS = ['lines', 'branches'];

if (process.argv.includes('--update')) {
  const out = {};
  for (const kind of KINDS) {
    // Branch counts differ a little between machines (tool versions): keep a margin below.
    const floor = (p) => (kind === 'branches' ? Math.floor(p) : p);
    out[kind] = Object.fromEntries(results.filter((r) => r[kind].pct < 100).map((r) => [r.file, floor(r[kind].pct)]));
  }
  fs.writeFileSync(FLOORS, JSON.stringify(out, null, 2) + '\n');
  console.log(`${FLOORS}: ${Object.keys(out.lines).length} files below 100% of lines, ${Object.keys(out.branches).length} below 100% of branches.`);
  process.exit(0);
}

const errors = [];
const notes = [];
for (const kind of KINDS) {
  for (const r of results) {
    const { pct: p, uncovered } = r[kind];
    const floor = floors[kind][r.file];
    const where = uncovered.length ? ` (${kind === 'lines' ? 'lines' : 'at'} ${uncovered.slice(0, 12).join(', ')}${uncovered.length > 12 ? ', …' : ''})` : '';
    if (floor === undefined && p < 100) errors.push(`${r.file}: ${p}% of ${kind}, not 100%${where}`);
    else if (floor !== undefined && p < floor) errors.push(`${r.file}: ${p}% of ${kind}, below its floor of ${floor}%${where}`);
    else if (floor !== undefined && Math.floor(p) > floor) notes.push(`${r.file}: ${p}% of ${kind}, above its floor of ${floor}%`);
  }
  for (const file of Object.keys(floors[kind])) {
    if (!results.some((r) => r.file === file)) notes.push(`${file}: listed under ${kind} in ${FLOORS} but not measured`);
  }
}

for (const n of notes) console.log(`note: ${n}`);
if (notes.length) console.log(`Run \`node scripts/coverage-check.mjs --update\` to raise the floors in ${FLOORS}.`);
for (const e of errors) console.log(`::error::${e}`);
if (errors.length) {
  console.log('Add tests for these (see coverage/index.html), remove what cannot run, or explain in a comment why it cannot and mark it with `/* c8 ignore next */`.');
  process.exit(1);
}
const full = (kind) => results.filter((r) => r[kind].pct === 100).length;
console.log(`Coverage: ${full('lines')} of ${results.length} files run every line, ${full('branches')} take every branch; the others are at or above their floors.`);
