// Debug helper: print the explanation of every line of a file.
// usage: npx tsx test/dump.ts <file> [ja|en] [line]
import * as fs from 'fs';
import * as path from 'path';
import { Analyzer, Token } from '../src/analyzer';
import { detectShell } from '../src/dialect';
import { createBashParser } from '../src/parser';

const root = path.join(__dirname, '..');
(async () => {
  const [file, lang = 'ja', only] = process.argv.slice(2);
  const parser = await createBashParser({
    runtimeDir: path.join(root, 'node_modules/web-tree-sitter'),
    bashWasm: path.join(root, 'node_modules/tree-sitter-bash/tree-sitter-bash.wasm'),
  });
  const src = fs.readFileSync(file, 'utf8');
  const tree = parser.parse(src);
  const analyzer = new Analyzer(lang as 'ja' | 'en');
  const lines = src.split('\n');
  const print = (t: Token, d: number) => {
    console.log(`${'  '.repeat(d)}- [${t.kind}] ${t.label} (${t.span.start.line + 1}:${t.span.start.character}-${t.span.end.line + 1}:${t.span.end.character}) — ${t.explanation}`);
    t.children.forEach((c) => print(c, d + 1));
  };
  lines.forEach((text, i) => {
    if (only && Number(only) !== i + 1) return;
    const e = analyzer.explainLine(tree, i, detectShell(src, file));
    console.log(`\n### ${i + 1}: ${text}`);
    if (e.context.length) console.log('  context: ' + e.context.map((c) => `${c.label}@${c.line + 1}`).join(' > '));
    e.notes.forEach((n) => console.log('  note: ' + n));
    console.log('  summary: ' + e.summary);
    e.items.forEach((t) => print(t, 1));
    for (const x of e.examples) {
      console.log(`  ## ${x.title}`);
      for (const sec of x.sections) {
        console.log(`  ### ${sec.label}`);
        (sec.lines.length ? sec.lines : [sec.empty ?? '']).forEach((l) => console.log(`    ${l}`));
      }
    }
  });
})();
