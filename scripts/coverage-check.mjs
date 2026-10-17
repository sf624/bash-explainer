// Checks the coverage of the unit tests (coverage/coverage-final.json, from `npm run coverage`): every
// file must run all its lines and take all its branches, except files listed in coverage-floors.json,
// which must not go below their floor. CI runs it on the job where every tool the tests compare against
// is installed; locally, tests for missing tools are skipped, so the numbers are lower. Measure with
// Node.js 24, as CI does: Node.js 22 reports the methods of a class that never ran as run.
//
//   node scripts/coverage-check.mjs           check
//   node scripts/coverage-check.mjs --update  set the floors to the current numbers (after adding tests)
//
// A line counts when any statement on it ran. Some lines and branches are not counted, as tests cannot
// reach them:
// - a line of closing brackets after a line that ran, and a branch of nothing but closing brackets
//   (V8 reports the end of a block after a `return` as not run, and tsx's `0 && (module.exports = …)`
//   maps to the last `};` of a file);
// - line 1 of a file where other lines ran, and the branches there (tsx's helpers map there);
// - a branch on the name of a function that is declared (tsx's getters for exports map there).
import fs from 'node:fs';
import path from 'node:path';

const FLOORS = 'coverage-floors.json';
const coverage = JSON.parse(fs.readFileSync('coverage/coverage-final.json', 'utf8'));
const floors = fs.existsSync(FLOORS) ? JSON.parse(fs.readFileSync(FLOORS, 'utf8')) : {};
floors.lines ??= {};
floors.branches = typeof floors.branches === 'object' ? floors.branches : {};

/** Line numbers of a file with statements, and the ones that never ran. */
export function lineCoverage(src, cov) {
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

/** The branches of a file that count, and those never taken (as `line:column`). */
export function branchCoverage(src, cov) {
  const text = ({ start: a, end: b }) => a.line === b.line
    ? src[a.line - 1].slice(a.column, b.column)
    : [src[a.line - 1].slice(a.column), ...src.slice(a.line, b.line - 1), (src[b.line - 1] ?? '').slice(0, b.column)].join('\n');
  const anyRan = Object.values(cov.s).some((n) => n > 0);
  let total = 0;
  const uncovered = [];
  for (const [id, branch] of Object.entries(cov.branchMap)) {
    branch.locations.forEach((loc, i) => {
      const t = text(loc);
      if (loc.start.line === 1 && anyRan) return;
      if (/^[\s})\];,]*$/.test(t)) return;
      if (/^[\w$]*\(?$/.test(t) && /\b(?:function\*?\s+[\w$]+\s*\(|(?:const|let)\s+[\w$]+\s*=\s*(?:async\s*)?\()/.test(src[loc.start.line - 1])) return;
      total++;
      if (!cov.b[id][i]) uncovered.push(`${loc.start.line}:${loc.start.column + 1}`);
    });
  }
  return { total, uncovered };
}

const pct = ({ total, uncovered }) => total ? Math.floor(((total - uncovered.length) / total) * 10000) / 100 : 100;
const rel = (f) => path.relative(process.cwd(), f).replace(/\\/g, '/');
const results = Object.entries(coverage).map(([file, cov]) => {
  const src = fs.readFileSync(file, 'utf8').split('\n');
  const lines = lineCoverage(src, cov);
  const branches = branchCoverage(src, cov);
  return { file: rel(file), lines: { pct: pct(lines), uncovered: lines.uncovered }, branches: { pct: pct(branches), uncovered: branches.uncovered } };
}).sort((a, b) => a.file.localeCompare(b.file));

const KINDS = { lines: 'lines', branches: 'branches' };

if (process.argv.includes('--update')) {
  const out = {};
  for (const kind of Object.keys(KINDS)) {
    // Branch counts differ a little between machines (tool versions): keep a margin below.
    const floor = (p) => kind === 'branches' ? Math.floor(p) : p;
    out[kind] = Object.fromEntries(results.filter((r) => r[kind].pct < 100).map((r) => [r.file, floor(r[kind].pct)]));
  }
  fs.writeFileSync(FLOORS, JSON.stringify(out, null, 2) + '\n');
  console.log(`${FLOORS}: ${Object.keys(out.lines).length} files below 100% of lines, ${Object.keys(out.branches).length} below 100% of branches.`);
  process.exit(0);
}

const errors = [];
const notes = [];
for (const kind of Object.keys(KINDS)) {
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
