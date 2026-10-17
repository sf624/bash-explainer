// Checks the line coverage of the unit tests (coverage/coverage-final.json, from `npm run coverage`):
// every file must reach 100%, except those listed in coverage-floors.json, which must not go below
// their floor. The whole must not go below the branch floor either. CI runs it on the job where every
// tool the tests compare against is installed; locally, tests for missing tools are skipped, so the
// numbers are lower. Measure with Node.js 24, as CI does: Node.js 22 reports the methods of a class
// that never ran as run.
//
//   node scripts/coverage-check.mjs           check
//   node scripts/coverage-check.mjs --update  set the floors to the current numbers (after adding tests)
//
// A line counts when any statement on it ran. Two kinds of lines are not counted, as tests cannot run
// them: a line of closing brackets after a line that ran (V8 reports the end of a block after a
// `return` as not run, and tsx's `0 && (module.exports = …)` maps to the last `};` of a file), and
// line 1 of a file where other lines ran (tsx's helpers map there).
import fs from 'node:fs';
import path from 'node:path';

const FLOORS = 'coverage-floors.json';
const coverage = JSON.parse(fs.readFileSync('coverage/coverage-final.json', 'utf8'));
const summary = JSON.parse(fs.readFileSync('coverage/coverage-summary.json', 'utf8'));
const floors = fs.existsSync(FLOORS) ? JSON.parse(fs.readFileSync(FLOORS, 'utf8')) : { branches: 0, lines: {} };

/** Line numbers of a file with statements, and the ones that never ran. */
export function lineCoverage(file, cov) {
  const src = fs.readFileSync(file, 'utf8').split('\n');
  const hits = new Map();
  for (const [id, loc] of Object.entries(cov.statementMap)) {
    const line = loc.start.line;
    hits.set(line, Math.max(hits.get(line) ?? 0, cov.s[id]));
  }
  const lines = [...hits.keys()].sort((a, b) => a - b);
  const ran = (l) => (hits.get(l) ?? 0) > 0;
  const uncovered = lines.filter((l) => {
    if (ran(l)) return false;
    const text = src[l - 1] ?? '';
    if (l === 1 && lines.some(ran)) return false;
    if (/^[\s})\];,]*$/.test(text)) {
      let p = l - 1;
      while (p > 0 && !src[p - 1].trim()) p--;
      if (p > 0 && (ran(p) || !hits.has(p))) return false;
    }
    return true;
  });
  const skipped = lines.filter((l) => !ran(l) && !uncovered.includes(l)).length;
  return { total: lines.length - skipped, uncovered };
}

const rel = (f) => path.relative(process.cwd(), f).replace(/\\/g, '/');
const results = Object.entries(coverage).map(([file, cov]) => {
  const { total, uncovered } = lineCoverage(file, cov);
  const pct = total ? Math.floor(((total - uncovered.length) / total) * 10000) / 100 : 100;
  return { file: rel(file), pct, uncovered };
}).sort((a, b) => a.file.localeCompare(b.file));

if (process.argv.includes('--update')) {
  const lines = Object.fromEntries(results.filter((r) => r.pct < 100).map((r) => [r.file, r.pct]));
  // Branch counts differ a little between machines (tool versions): keep a margin below.
  const branches = Math.floor(summary.total.branches.pct * 10) / 10;
  fs.writeFileSync(FLOORS, JSON.stringify({ branches, lines }, null, 2) + '\n');
  console.log(`${FLOORS}: ${Object.keys(lines).length} files below 100% of lines, branches at ${branches}%.`);
  process.exit(0);
}

const errors = [];
const notes = [];
for (const r of results) {
  const floor = floors.lines[r.file];
  const where = r.uncovered.length ? ` (lines ${r.uncovered.slice(0, 12).join(', ')}${r.uncovered.length > 12 ? ', …' : ''})` : '';
  if (floor === undefined && r.pct < 100) errors.push(`${r.file}: ${r.pct}% of lines, not 100%${where}`);
  else if (floor !== undefined && r.pct < floor) errors.push(`${r.file}: ${r.pct}% of lines, below its floor of ${floor}%${where}`);
  else if (floor !== undefined && r.pct > floor) notes.push(`${r.file}: ${r.pct}% of lines, above its floor of ${floor}%`);
}
for (const file of Object.keys(floors.lines)) {
  if (!results.some((r) => r.file === file)) notes.push(`${file}: listed in ${FLOORS} but not measured`);
}
const branches = summary.total.branches.pct;
if (branches < floors.branches) errors.push(`branches: ${branches}% in all, below the floor of ${floors.branches}%`);
else if (branches > floors.branches) notes.push(`branches: ${branches}% in all, above the floor of ${floors.branches}%`);

for (const n of notes) console.log(`note: ${n}`);
if (notes.length) console.log(`Run \`node scripts/coverage-check.mjs --update\` to raise the floors in ${FLOORS}.`);
for (const e of errors) console.log(`::error::${e}`);
if (errors.length) {
  console.log('Add tests for these lines (see coverage/index.html), or explain in a comment why a line cannot run and mark it with `/* c8 ignore next */`.');
  process.exit(1);
}
console.log(`Line coverage: ${results.filter((r) => r.pct === 100).length} of ${results.length} files at 100%, the others at or above their floors.`);
