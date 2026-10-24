// Debug helper: the full explanation of every line of the corpus, in Japanese and English, as JSON lines.
// Every refactoring step diffs its output against main's (docs/design/analyzer.md, step 0).
// usage: npx tsx test/snapshot.ts <output file>
//   git diff --no-index --stat before.jsonl after.jsonl
// The clock and the time zone are fixed, so the output is the same from run to run.
process.env.TZ = 'UTC';
import * as fs from 'fs';
import { Analyzer } from '../src/analyzer';
import { detectShell } from '../src/dialect';
import { createUnbashParser } from '../src/syntax/adapters/unbash';
import { corpus } from './support/corpus';

const FIXED_NOW = Date.UTC(2026, 9, 1, 12, 0, 0); // sampleCommits and the date examples read Date.now()
Date.now = () => FIXED_NOW;

(async () => {
  const out = process.argv[2];
  if (!out) {
    console.error('usage: npx tsx test/snapshot.ts <output file>');
    process.exit(2);
  }
  const parser = createUnbashParser();
  const { files, snippets } = corpus();
  const rows: string[] = [];
  for (const lang of ['ja', 'en'] as const) {
    for (const input of [...files, ...snippets]) {
      const tree = parser.parse(input.text);
      const shell = detectShell(input.text, input.name.startsWith('snippet') ? '' : input.name);
      const analyzer = new Analyzer(lang);
      const count = input.text.split('\n').length;
      for (let i = 0; i < count; i++) {
        let explanation: unknown;
        try {
          explanation = analyzer.explainLine(tree, i, shell);
        } catch (e) {
          explanation = { threw: String(e) };
        }
        rows.push(JSON.stringify({ lang, input: input.name, line: i + 1, explanation }));
      }
    }
  }
  fs.writeFileSync(out, rows.join('\n') + '\n');
  console.log(`${rows.length} lines, ${fs.statSync(out).size} bytes -> ${out}`);
})();
