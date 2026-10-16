import * as esbuild from 'esbuild';
import { copyFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const watch = process.argv.includes('--watch');
const production = process.argv.includes('--production');
// The offline test builds the shipped bundles elsewhere to inspect them.
const outfile = process.argv.find((a) => a.startsWith('--outfile='))?.slice('--outfile='.length) ?? 'dist/extension.js';
// What went into the bundles ({ node, web }), for scripts/notices.ts.
const metafile = process.argv.find((a) => a.startsWith('--metafile='))?.slice('--metafile='.length);

mkdirSync('dist', { recursive: true });
copyFileSync('node_modules/web-tree-sitter/tree-sitter.wasm', 'dist/tree-sitter.wasm');
copyFileSync('node_modules/tree-sitter-bash/tree-sitter-bash.wasm', 'dist/tree-sitter-bash.wasm');

const common = {
  entryPoints: ['src/extension.ts'],
  bundle: true,
  format: 'cjs',
  sourcemap: !production,
  minify: production,
  logLevel: 'info',
  metafile: !!metafile,
};

const contexts = {
  // VS Code on the desktop: the extension host is Node.js.
  node: await esbuild.context({ ...common, outfile, platform: 'node', target: 'node18', external: ['vscode'] }),
  // VS Code on the web (vscode.dev, github.dev): a web worker. web-tree-sitter requires fs and
  // path only when it runs in Node.js.
  web: await esbuild.context({ ...common, outfile: join(dirname(outfile), 'web', 'extension.js'), platform: 'browser', target: 'es2020', external: ['vscode', 'fs', 'path'] }),
};

if (watch) {
  await Promise.all(Object.values(contexts).map((c) => c.watch()));
} else {
  const node = await contexts.node.rebuild();
  const web = await contexts.web.rebuild();
  if (metafile) writeFileSync(metafile, JSON.stringify({ node: node.metafile, web: web.metafile }));
  await Promise.all(Object.values(contexts).map((c) => c.dispose()));
}
