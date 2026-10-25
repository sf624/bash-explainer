// Builds the command-line tool (the npm package in cli/): one bundled script, the
// license and the notices. Usage: npx tsx scripts/build-cli.ts [--outdir=cli] [--metafile=<path>] [--tag=v0.9.0]
// With another --outdir the directory is a complete package: package.json and README.md are copied
// too. With --tag the copy of the README is pinned to that tag (scripts/readme-pins.ts), so the
// npm page shows the images and links of the version it describes: the Release workflow publishes that directory.
import * as esbuild from 'esbuild';
import * as fs from 'fs';
import * as path from 'path';
import { pinReadme } from './readme-pins';

const root = path.join(__dirname, '..');
const option = (name: string) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const outdir = path.resolve(root, option('outdir') ?? 'cli');
const metafile = option('metafile');
const tag = option('tag');
const version: string = JSON.parse(fs.readFileSync(path.join(root, 'cli', 'package.json'), 'utf8')).version;

async function main(): Promise<void> {
  if (tag && outdir === path.join(root, 'cli')) throw new Error('--tag needs another --outdir: cli/README.md is the source and is not rewritten in place');
  const dist = path.join(outdir, 'dist');
  fs.rmSync(dist, { recursive: true, force: true });
  fs.mkdirSync(dist, { recursive: true });
  const result = await esbuild.build({
    entryPoints: [path.join(root, 'cli', 'main.ts')],
    outfile: path.join(dist, 'cli.js'),
    bundle: true,
    platform: 'node',
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
  copy('LICENSE', 'LICENSE');
  copy('THIRD_PARTY_NOTICES.md', 'THIRD_PARTY_NOTICES.md');
  if (outdir !== path.join(root, 'cli')) {
    copy('cli/package.json', 'package.json');
    const readme = fs.readFileSync(path.join(root, 'cli', 'README.md'), 'utf8');
    fs.writeFileSync(path.join(outdir, 'README.md'), tag ? pinReadme(readme, 'cli', tag) : readme);
  }
  console.log(`Built the command-line tool ${version} into ${path.relative(root, outdir) || '.'}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
