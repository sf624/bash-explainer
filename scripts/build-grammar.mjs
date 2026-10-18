// Builds grammar/tree-sitter-bash.wasm: tree-sitter-bash 0.25.1 with patches/tree-sitter-bash/grammar.patch
// applied (`=~` and `=` in `[[ ]]` bind tighter than `&&`, `=` takes a pattern like `==`, `!` negates the whole comparison; `${s:$i+1}` takes a variable in the offset).
//
//   node scripts/build-grammar.mjs           rebuild grammar/tree-sitter-bash.wasm
//   node scripts/build-grammar.mjs --check   rebuild and fail if it differs from the committed file
//
// Needs network the first time: npx downloads tree-sitter-cli, and the CLI downloads wasi-sdk (about 113 MB) into the tree-sitter cache directory.
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const CLI = 'tree-sitter-cli@0.26.8';
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'grammar', 'tree-sitter-bash.wasm');
const check = process.argv.includes('--check');

const tmp = mkdtempSync(path.join(tmpdir(), 'ts-bash-'));
try {
  const work = path.join(tmp, 'tree-sitter-bash');
  cpSync(path.join(root, 'node_modules', 'tree-sitter-bash'), work, { recursive: true });
  // Every argument is relative to `work`, so none has a space that `shell: true` (needed for npx.cmd on Windows) would split.
  const run = (cmd, args) => execFileSync(cmd, args, { cwd: work, stdio: 'inherit', shell: process.platform === 'win32' });
  const grammar = path.join(work, 'grammar.js');
  const before = readFileSync(grammar, 'utf8');
  cpSync(path.join(root, 'patches', 'tree-sitter-bash', 'grammar.patch'), path.join(work, 'grammar.patch'));
  // A repository of its own: inside another work tree (the temp directory may be in one), `git apply` would skip the paths silently.
  run('git', ['init', '-q']);
  run('git', ['apply', '--ignore-whitespace', 'grammar.patch']);
  if (readFileSync(grammar, 'utf8') === before) throw new Error('patches/tree-sitter-bash/grammar.patch did not change grammar.js');
  run('npx', ['--yes', CLI, 'generate']);
  run('npx', ['--yes', CLI, 'build', '--wasm', '-o', 'built.wasm']);
  const built = path.join(work, 'built.wasm');
  if (check) {
    if (!existsSync(out) || !readFileSync(out).equals(readFileSync(built))) {
      console.error('grammar/tree-sitter-bash.wasm is not what scripts/build-grammar.mjs builds; run it and commit the result.');
      process.exitCode = 1;
    }
  } else {
    mkdirSync(path.dirname(out), { recursive: true });
    writeFileSync(out, readFileSync(built));
  }
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
