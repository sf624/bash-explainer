// Builds grammar/tree-sitter-bash.wasm: tree-sitter-bash 0.25.1 with patches/tree-sitter-bash/grammar.patch
// applied (`=~` binds tighter than `&&`; `${s:$i}` takes a variable as the offset).
//
//   node scripts/build-grammar.mjs           rebuild grammar/tree-sitter-bash.wasm
//   node scripts/build-grammar.mjs --check   rebuild and fail if it differs from the committed file
//
// The first run downloads wasi-sdk (about 113 MB) into the tree-sitter cache directory.
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
  const run = (cmd, args) => execFileSync(cmd, args, { cwd: work, stdio: 'inherit', shell: process.platform === 'win32' });
  // Outside a repository, `git apply` works as plain `patch`.
  run('git', ['apply', '--ignore-whitespace', path.join(root, 'patches', 'tree-sitter-bash', 'grammar.patch')]);
  run('npx', ['--yes', CLI, 'generate']);
  const built = path.join(tmp, 'tree-sitter-bash.wasm');
  run('npx', ['--yes', CLI, 'build', '--wasm', '-o', built]);
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
