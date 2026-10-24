// Builds proto-a.html, proto-b.html and proto-c.html from src/: the shared CSS and script, and viz-data.json, inlined
// into each, so that each prototype is one file that works offline.
// Run from the root of the repository: node docs/design/tree-view/build.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = dirname(fileURLToPath(import.meta.url));
const read = (name) => readFileSync(join(dir, name), 'utf8');
const css = read('src/common.css');
const js = read('src/common.js');
const data = read('viz-data.json').trim();
for (const p of ['a', 'b', 'c']) {
  // (A function as the replacement: `$` in the data is not a pattern.)
  const html = read(`src/${p}.html`).replace('/*COMMON_CSS*/', () => css).replace('/*COMMON_JS*/', () => js).replace('/*DATA*/', () => data);
  writeFileSync(join(dir, `proto-${p}.html`), html);
  console.log(`proto-${p}.html`, Buffer.byteLength(html));
}
