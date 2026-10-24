// Design study helper (not a test): times the semantic tokens of a large script.
// usage: npx tsx test/sh-bench-tokens.ts <lines>
import fs from 'node:fs';
import path from 'node:path';
import { createUnbashParser } from '../src/syntax/adapters/unbash';
import { richSemanticTokens, semanticTokens } from '../src/semanticTokens';
import { shellState } from '../src/semantics/state';

const want = Number(process.argv[2] ?? 5000);
const sample = fs.readFileSync(path.join(__dirname, 'fixtures/sample.sh'), 'utf8').split('\n');
const lines: string[] = [];
while (lines.length < want) lines.push(...sample);
const text = lines.slice(0, want).join('\n') + '\n';
const parser = createUnbashParser();
const time = <T>(label: string, f: () => T, runs = 5): T => {
  let out!: T;
  const ts: number[] = [];
  for (let i = 0; i < runs; i++) {
    const t0 = performance.now();
    out = f();
    ts.push(performance.now() - t0);
  }
  ts.sort((a, b) => a - b);
  console.log(`${label}: median ${ts[Math.floor(runs / 2)].toFixed(1)} ms (min ${ts[0].toFixed(1)}, max ${ts[runs - 1].toFixed(1)})`);
  return out;
};
console.log(`${want} lines, ${text.length} chars`);
time('parse', () => parser.parse(text));
// Each edit gives a new tree: every run below starts from a fresh parse, as after a keystroke.
time('plain tokens (tree only), fresh tree', () => { const tree = parser.parse(text); return semanticTokens({ lines, tree }); });
time('model alone (shellState), fresh tree', () => shellState(parser.parse(text)));
const data = time('rich tokens (tree + models), fresh tree', () => { const tree = parser.parse(text); return richSemanticTokens({ lines, tree }); });
console.log(`  ${data.length / 5} tokens`);
time('rich tokens, cached model (panel already built it)', (() => { const tree = parser.parse(text); shellState(tree); return () => richSemanticTokens({ lines, tree }); })());
time('rich range request (60 visible lines), fresh tree', () => { const tree = parser.parse(text); return richSemanticTokens({ lines, tree }, undefined, { from: 2000, to: 2060 }); });
