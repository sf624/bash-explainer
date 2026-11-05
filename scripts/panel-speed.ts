// The time of a move of the cursor in the panel on real scripts: npx tsx scripts/panel-speed.ts [--depth 2] [--receives off] file.sh… (test/support/panel-speed.ts;
// the budget is in docs/design/panel-redesign.md, section 5). Run it on main and on a branch to compare.
import * as fs from 'fs';
import { panelMoves, percentile } from '../test/support/panel-speed';

const args = process.argv.slice(2);
let depth: 1 | 2 = 1;
let receives = true;
while (args[0] === '--depth' || args[0] === '--receives') {
  if (args[0] === '--depth') depth = Number(args[1]) as 1 | 2;
  else receives = args[1] !== 'off';
  args.splice(0, 2);
}
for (const file of args) {
  const moves = panelMoves(fs.readFileSync(file, 'utf8'), 250, depth, receives);
  const worst = [...moves.times].sort((a, b) => b.ms - a.ms)[0];
  console.log(`${file}: ${moves.lines} lines, ${moves.times.length} moves: p50 ${percentile(moves, 0.5).toFixed(1)} ms, p95 ${percentile(moves, 0.95).toFixed(1)} ms, worst ${worst.ms.toFixed(1)} ms (line ${worst.line + 1})`);
}
