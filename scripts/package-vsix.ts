// Packages the extension (the .vsix that the Release workflow publishes to the VS Code Marketplace and
// Open VSX). vsce rewrites the README's and the changelog's relative links and images to absolute
// ones; by default it points them at HEAD, so a page would show the newest images from main, not the
// ones of its version. Here they are pinned to the tag of the version (`--githubBranch v<version>`).
// The README also loses its note about the development version (scripts/readme-pins.ts): a package
// page describes a release. vsce reads the README by its name, so the package is made from a copy of
// the files it would contain (`vsce ls`) in a temporary directory, the README replaced in the copy.
//
// Usage: npx tsx scripts/package-vsix.ts [--out <file>]     (run `node esbuild.mjs --production` first)
//        --root <dir>  package another directory than the repository (test/readme-pins.test.ts)
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { stripDevelopmentNote } from './readme-pins';

const vsce = path.join(__dirname, '..', 'node_modules', '@vscode', 'vsce', 'vsce');

function main(): void {
  const args = process.argv.slice(2);
  const option = (name: string) => args[args.indexOf(`--${name}`) + 1];
  const root = path.resolve(args.includes('--root') ? option('root') : path.join(__dirname, '..'));
  const version: string = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version;
  const out = path.resolve(args.includes('--out') ? option('out') : path.join(root, `bash-explainer-${version}.vsix`));
  const run = (cwd: string, ...argv: string[]) => execFileSync(process.execPath, [vsce, ...argv], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] });

  const staging = fs.mkdtempSync(path.join(os.tmpdir(), 'bash-explainer-vsix-'));
  try {
    for (const file of run(root, 'ls', '--no-dependencies').split('\n').filter(Boolean)) {
      fs.mkdirSync(path.join(staging, path.dirname(file)), { recursive: true });
      fs.copyFileSync(path.join(root, file), path.join(staging, file));
    }
    fs.copyFileSync(path.join(root, '.vscodeignore'), path.join(staging, '.vscodeignore'));
    fs.writeFileSync(path.join(staging, 'README.md'), stripDevelopmentNote(fs.readFileSync(path.join(root, 'README.md'), 'utf8')));
    process.stdout.write(run(staging, 'package', '--no-dependencies', '--githubBranch', `v${version}`, '-o', out));
  } finally {
    fs.rmSync(staging, { recursive: true, force: true });
  }
}

if (require.main === module) main();
