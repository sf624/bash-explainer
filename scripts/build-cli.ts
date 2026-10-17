// Builds the command-line tool (the npm package in cli/): one bundled script, the wasm files, the
// license and the notices. Usage: npx tsx scripts/build-cli.ts [--outdir=cli] [--metafile=<path>]
import * as esbuild from 'esbuild';
import * as fs from 'fs';
import * as path from 'path';

const root = path.join(__dirname, '..');
const option = (name: string) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const outdir = path.resolve(root, option('outdir') ?? 'cli');
const metafile = option('metafile');
const version: string = JSON.parse(fs.readFileSync(path.join(root, 'cli', 'package.json'), 'utf8')).version;

async function main(): Promise<void> {
  const dist = path.join(outdir, 'dist');
  fs.rmSync(dist, { recursive: true, force: true });
  fs.mkdirSync(dist, { recursive: true });
  const result = await esbuild.build({
    entryPoints: [path.join(root, 'cli', 'main.ts')],
    outfile: path.join(dist, 'cli.js'),
    bundle: true,
    platform: 'node',
    // web-tree-sitter's CommonJS build: its ES module build needs import.meta, which CommonJS lacks.
    alias: { 'web-tree-sitter': path.join(root, 'node_modules/web-tree-sitter/web-tree-sitter.cjs') },
    format: 'cjs',
    target: 'node18',
    minify: true,
    banner: { js: '#!/usr/bin/env node' },
    define: { __VERSION__: JSON.stringify(version) },
    metafile: true,
    logLevel: 'warning',
  });
  if (metafile) fs.writeFileSync(metafile, JSON.stringify(result.metafile));
  fs.chmodSync(path.join(dist, 'cli.js'), 0o755);
  const copy = (from: string, to: string) => fs.copyFileSync(path.join(root, from), path.join(outdir, to));
  copy('node_modules/web-tree-sitter/web-tree-sitter.wasm', 'dist/web-tree-sitter.wasm');
  copy('node_modules/tree-sitter-bash/tree-sitter-bash.wasm', 'dist/tree-sitter-bash.wasm');
  copy('LICENSE', 'LICENSE');
  copy('THIRD_PARTY_NOTICES.md', 'THIRD_PARTY_NOTICES.md');
  if (outdir !== path.join(root, 'cli')) copy('cli/package.json', 'package.json');
  console.log(`Built the command-line tool ${version} into ${path.relative(root, outdir) || '.'}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
