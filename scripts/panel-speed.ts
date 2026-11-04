// The time of a move of the cursor in the panel on real scripts: npx tsx scripts/panel-speed.ts [--depth 2] file.sh… (test/support/panel-speed.ts;
// the budget is in docs/design/panel-redesign.md, section 5). Run it on main and on a branch to compare.
import * as fs from 'fs';
import { panelMoves, percentile } from '../test/support/panel-speed';

const args = process.argv.slice(2);
const depth = args[0] === '--depth' ? Number(args[1]) as 1 | 2 : 1;
for (const file of args[0] === '--depth' ? args.slice(2) : args) {
  const moves = panelMoves(fs.readFileSync(file, 'utf8'), 250, depth);
  const worst = [...moves.times].sort((a, b) => b.ms - a.ms)[0];
  console.log(`${file}: ${moves.lines} lines, ${moves.times.length} moves: p50 ${percentile(moves, 0.5).toFixed(1)} ms, p95 ${percentile(moves, 0.95).toFixed(1)} ms, worst ${worst.ms.toFixed(1)} ms (line ${worst.line + 1})`);
}
