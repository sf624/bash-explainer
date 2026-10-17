// Prints the coverage of the unit tests as Markdown, for the job summary: the totals, then the files
// with the most lines and branches the tests never reach. Reads coverage/coverage-summary.json
// (written by `npm run coverage`); the HTML report in coverage/ shows the lines themselves.
import fs from 'node:fs';
import path from 'node:path';

const summary = JSON.parse(fs.readFileSync('coverage/coverage-summary.json', 'utf8'));
const pct = (m) => `${m.pct}% (${m.covered}/${m.total})`;
const missed = (m) => m.total - m.covered;
const { total, ...files } = summary;

const out = [
  '## Unit test coverage',
  '',
  '| | Covered |',
  '|---|---|',
  `| Lines | ${pct(total.lines)} |`,
  `| Branches | ${pct(total.branches)} |`,
  `| Functions | ${pct(total.functions)} |`,
  '',
  'The VS Code side (`src/extension.ts`, `src/ui/` except the renderers) and the language server run in the integration tests and the CLI tests, which are not measured.',
  '',
  '### Most uncovered',
  '',
  '| File | Lines | Branches | Missed lines | Missed branches |',
  '|---|---|---|---|---|',
];
const rows = Object.entries(files)
  .map(([file, m]) => ({ file: path.relative(process.cwd(), file).replace(/\\/g, '/'), m }))
  .filter(({ m }) => missed(m.lines) + missed(m.branches) > 0)
  .sort((a, b) => missed(b.m.lines) + missed(b.m.branches) - (missed(a.m.lines) + missed(a.m.branches)))
  .slice(0, 20);
for (const { file, m } of rows) out.push(`| \`${file}\` | ${m.lines.pct}% | ${m.branches.pct}% | ${missed(m.lines)} | ${missed(m.branches)} |`);
console.log(out.join('\n'));
