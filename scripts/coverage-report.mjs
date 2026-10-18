// Writes the coverage reports from coverage/coverage-final.json (c8's raw data, from `npm run
// coverage`), leaving out the code that tsx adds when it compiles the sources for the tests. That
// code maps back to places in the sources that no test can run:
// - line 1 of a file, where tsx's helpers and the getters of its exports map;
// - the name of a declared function, where some getters of exports map;
// - lines and branches of nothing but closing brackets, after code that ran (V8 counts the end of a
//   block after a `return` as not run, and tsx's `0 && (module.exports = …)` maps to the last `};`).
// Only parts that never ran are left out, so the numbers say what the tests reach in our code.
// Then it writes coverage-final.json again, the text summary, the HTML report and
// coverage-summary.json, which scripts/coverage-check.mjs and scripts/coverage-summary.mjs read.
import fs from 'node:fs';
import libCoverage from 'istanbul-lib-coverage';
import libReport from 'istanbul-lib-report';
import reports from 'istanbul-reports';

const DIR = 'coverage';
const FINAL = `${DIR}/coverage-final.json`;
const raw = JSON.parse(fs.readFileSync(FINAL, 'utf8'));

const closersOnly = (text) => /^[\s})\];,]*$/.test(text);
const declaresFunction = (line) => /\b(?:function\*?\s+[\w$]+\s*\(|(?:const|let)\s+[\w$]+\s*=\s*(?:async\s*)?\()/.test(line);

/** The file's coverage without the parts tsx added. */
export function clean(file, cov) {
  const src = fs.readFileSync(file, 'utf8').split('\n');
  const text = ({ start: a, end: b }) => a.line === b.line
    ? src[a.line - 1].slice(a.column, b.column)
    : [src[a.line - 1].slice(a.column), ...src.slice(a.line, b.line - 1), (src[b.line - 1] ?? '').slice(0, b.column)].join('\n');
  const anyRan = Object.values(cov.s).some((n) => n > 0);
  const linesRan = new Set(Object.entries(cov.statementMap).filter(([id]) => cov.s[id] > 0).map(([, l]) => l.start.line));
  const linesWithCode = new Set(Object.values(cov.statementMap).map((l) => l.start.line));
  /** A line of closing brackets after a line that ran (or after lines with no statements). */
  const trailingClosers = (line) => {
    if (!closersOnly(src[line - 1] ?? '')) return false;
    let p = line - 1;
    while (p > 0 && !src[p - 1].trim()) p--;
    return p > 0 && (linesRan.has(p) || !linesWithCode.has(p));
  };

  const out = { ...cov, statementMap: {}, s: {}, fnMap: {}, f: {}, branchMap: {}, b: {} };
  for (const [id, loc] of Object.entries(cov.statementMap)) {
    if (!cov.s[id] && !linesRan.has(loc.start.line) && ((loc.start.line === 1 && anyRan) || trailingClosers(loc.start.line))) continue;
    out.statementMap[id] = loc;
    out.s[id] = cov.s[id];
  }
  for (const [id, fn] of Object.entries(cov.fnMap)) {
    const at = fn.decl.start;
    if (!cov.f[id] && anyRan && (at.line === 1 || (/^[\w$]*\(?$/.test(text(fn.decl)) && declaresFunction(src[at.line - 1])))) continue;
    out.fnMap[id] = fn;
    out.f[id] = cov.f[id];
  }
  for (const [id, branch] of Object.entries(cov.branchMap)) {
    const keep = branch.locations.map((loc, i) => {
      if (cov.b[id][i]) return true;
      const t = text(loc);
      if (loc.start.line === 1 && anyRan) return false;
      if (closersOnly(t)) return false;
      if (/^[\w$]*\(?$/.test(t) && declaresFunction(src[loc.start.line - 1])) return false;
      return true;
    });
    if (!keep.some(Boolean)) continue;
    out.branchMap[id] = { ...branch, locations: branch.locations.filter((_, i) => keep[i]) };
    out.b[id] = cov.b[id].filter((_, i) => keep[i]);
  }
  return out;
}

const cleaned = Object.fromEntries(Object.entries(raw).map(([file, cov]) => [file, clean(file, cov)]));
fs.writeFileSync(FINAL, JSON.stringify(cleaned));
const map = libCoverage.createCoverageMap(cleaned);
const context = libReport.createContext({ dir: DIR, coverageMap: map });
for (const name of ['text-summary', 'html', 'json-summary']) reports.create(name).execute(context);
