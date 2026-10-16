import * as esbuild from 'esbuild';
import { copyFileSync, mkdirSync, writeFileSync } from 'node:fs';

const watch = process.argv.includes('--watch');
const production = process.argv.includes('--production');
// The offline test builds the shipped bundle elsewhere to inspect it.
const outfile = process.argv.find((a) => a.startsWith('--outfile='))?.slice('--outfile='.length) ?? 'dist/extension.js';
// What went into the bundle, for scripts/notices.ts.
const metafile = process.argv.find((a) => a.startsWith('--metafile='))?.slice('--metafile='.length);

mkdirSync('dist', { recursive: true });
copyFileSync('node_modules/web-tree-sitter/tree-sitter.wasm', 'dist/tree-sitter.wasm');
copyFileSync('node_modules/tree-sitter-bash/tree-sitter-bash.wasm', 'dist/tree-sitter-bash.wasm');

const ctx = await esbuild.context({
  entryPoints: ['src/extension.ts'],
  bundle: true,
  outfile,
  platform: 'node',
  format: 'cjs',
  target: 'node18',
  external: ['vscode'],
  sourcemap: !production,
  minify: production,
  logLevel: 'info',
  metafile: !!metafile,
});

if (watch) {
  await ctx.watch();
} else {
  const result = await ctx.rebuild();
  if (metafile) writeFileSync(metafile, JSON.stringify(result.metafile));
  await ctx.dispose();
}
