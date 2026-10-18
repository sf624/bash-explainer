// Runs the oracle by hand: both adapters on the fixtures and the test snippets (or on the files named),
// the agreement as the number of top-level statements that are the same, and the first difference of
// each input that differs.
//
//   npx tsx scripts/syntax-oracle.ts [-v] [--dump] [-e 'script'] [file…]
import * as fs from 'fs';
import * as path from 'path';
import { createTreeSitterParser } from '../src/syntax/adapters/tree-sitter';
import { createUnbashParser } from '../src/syntax/adapters/unbash';
import { corpus, diffTrees, dumpModel, topLevel } from '../test/support/oracle';
import type { Input } from '../test/support/oracle';

const root = path.join(__dirname, '..');
(async () => {
  const args = process.argv.slice(2);
  const verbose = args.includes('-v');
  const dump = args.includes('--dump');
  const inline = args.indexOf('-e');
  const ts = await createTreeSitterParser({ runtimeDir: path.join(root, 'node_modules/web-tree-sitter'), bashWasm: path.join(root, 'grammar/tree-sitter-bash.wasm') });
  const ub = createUnbashParser();
  const named = args.filter((a, i) => !a.startsWith('-') && args[i - 1] !== '-e');
  let inputs: Input[];
  if (inline >= 0) inputs = [{ name: 'inline', text: args[inline + 1].replace(/\\n/g, '\n') }];
  else if (named.length) inputs = named.map((f) => ({ name: f, text: fs.readFileSync(f, 'utf8') }));
  else { const c = corpus(); inputs = [...c.files, ...c.snippets]; }
  const causes = new Map<string, string[]>();
  let identical = 0, total = 0, same = 0, crashes = 0;
  for (const input of inputs) {
    const a = ts.parse(input.text);
    let b;
    try { b = ub.parse(input.text); } catch (e) { crashes++; console.log(`${input.name}\n    CRASH ${(e as Error).stack?.split('\n').slice(0, 3).join(' | ')}`); continue; }
    const t = topLevel(a, b);
    identical += t.identical; total += t.total;
    const d = diffTrees(a, b);
    if (!d) same++;
    if (dump) { console.log(`--- tree-sitter\n${dumpModel(a.root)}--- unbash\n${dumpModel(b.root)}`); if (a.errors.length || b.errors.length) console.log(JSON.stringify(a.errors), JSON.stringify(b.errors)); }
    if (d) { const key = d.replace(/@\d+/g, '').replace(/\d+/g, 'N').split('/').slice(-3).join('/'); causes.set(key, [...(causes.get(key) ?? []), input.name]); }
    if (d && (verbose || inputs.length < 20)) {
      const at = Number(/@(\d+)[^@]*$/.exec(d.split(':')[0])?.[1] ?? NaN);
      console.log(`${input.name}\n    ${d.slice(0, 300)}${Number.isNaN(at) ? '' : `\n    source: ${JSON.stringify(input.text.slice(Math.max(0, at - 20), at + 50))}`}`);
    }
  }
  if (args.includes('--causes')) for (const [k, v] of [...causes].sort((x, y) => y[1].length - x[1].length)) console.log(`${v.length}\t${k}\n\t\te.g. ${v.slice(0, 2).join(' ; ')}`);
  console.log(`statements identical: ${identical} of ${total}; whole inputs identical: ${same} of ${inputs.length}; crashes: ${crashes}`);
})();
