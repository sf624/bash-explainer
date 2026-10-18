// Builds grammar/tree-sitter-bash.wasm: tree-sitter-bash 0.25.1 with patches/tree-sitter-bash/grammar.patch
// applied (`=~` and `=` in `[[ ]]` bind tighter than `&&`, `=` takes a pattern like `==`, `!` negates the whole comparison; `${s:$i+1}` takes a variable in the offset).
//
//   node scripts/build-grammar.mjs           rebuild grammar/tree-sitter-bash.wasm
//   node scripts/build-grammar.mjs --check   rebuild and fail if it differs from the committed file
//
// Every input is pinned by a hash, so the committed wasm can be checked against what its sources build:
// - tree-sitter-bash comes from node_modules, which `npm ci` checks against package-lock.json;
// - the tree-sitter CLI and wasi-sdk (the C compiler for WebAssembly) are downloaded from their GitHub
//   releases and checked against the SHA-256 below (the digests GitHub lists for the release files).
//   They are kept in ~/.cache/bash-explainer (about 120 MB) and checked again on every run.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';

const CLI = { version: '0.26.8', url: 'https://github.com/tree-sitter/tree-sitter/releases/download/v0.26.8/' };
const WASI_SDK = { version: '29.0', url: 'https://github.com/WebAssembly/wasi-sdk/releases/download/wasi-sdk-29/' };
const TOOLS = {
  'linux-x64': {
    cli: ['tree-sitter-linux-x64.gz', '9754a32800f0b970152782df177b4a47c711e34e651a7aceb384d8bd29fa136e'],
    wasiSdk: ['wasi-sdk-29.0-x86_64-linux.tar.gz', '87d1d1a2879d139cdc624b968efad3d4a97b8078cdff95e63ac88ecafd1a0171'],
  },
  'linux-arm64': {
    cli: ['tree-sitter-linux-arm64.gz', 'e339d6533b20830dd1666fe320aff85d301b3f59964a3836870b77f4827f9a17'],
    wasiSdk: ['wasi-sdk-29.0-arm64-linux.tar.gz', '052ad773397dc9e5aa99fb4cfef694175e6b1e81bb2ad1d3c8e7b3fc81441b7c'],
  },
  'darwin-x64': {
    cli: ['tree-sitter-macos-x64.gz', 'd0daa279054c1d1cedb08f5ca784b451ceb1f0e6b083b112d07317958ae77fe0'],
    wasiSdk: ['wasi-sdk-29.0-x86_64-macos.tar.gz', 'd0de2fd3ea5c57060efa87e4356c164bec3689972f2386f0c9a89c58e10cec8d'],
  },
  'darwin-arm64': {
    cli: ['tree-sitter-macos-arm64.gz', '024e2cee34723524d62d41bde4d2b4af23c8bbe0236e116c79c0b37d9575889e'],
    wasiSdk: ['wasi-sdk-29.0-arm64-macos.tar.gz', 'e11552913e3f99e834d7fe7da1bd081abaf764759ed76b6097a34c63fc83665e'],
  },
  'win32-x64': {
    cli: ['tree-sitter-windows-x64.gz', '28301a969412066bf4818c30c71d9c313091a9b9dc24b53a14ddda3a8e2cc2bb'],
    wasiSdk: ['wasi-sdk-29.0-x86_64-windows.tar.gz', '6c19b820577486f00332ad8d04ac506da67b0892316b8d485371a58cbf216dee'],
  },
  'win32-arm64': {
    cli: ['tree-sitter-windows-arm64.gz', '7e276c740a1d47d3326f2450c91a40165265d4bb3097f5df584285f8460a307d'],
    wasiSdk: ['wasi-sdk-29.0-arm64-windows.tar.gz', '694198d0ec9e949ec2e85e6e99fc13339ea82f699ad9fe5590d97955899f8904'],
  },
};

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'grammar', 'tree-sitter-bash.wasm');
const check = process.argv.includes('--check');
const cache = path.join(homedir(), '.cache', 'bash-explainer');
const tools = TOOLS[`${process.platform}-${process.arch}`];
if (!tools) throw new Error(`no tree-sitter CLI and wasi-sdk listed for ${process.platform}-${process.arch}`);

const sha256 = (data) => createHash('sha256').update(data).digest('hex');

/** The release file, from the cache or downloaded, after checking its SHA-256. */
async function fetchChecked(base, [name, hash]) {
  const file = path.join(cache, name);
  if (existsSync(file) && sha256(readFileSync(file)) === hash) return file;
  console.log(`Downloading ${base}${name}`);
  const res = await fetch(base + name);
  if (!res.ok) throw new Error(`${base}${name}: HTTP ${res.status}`);
  const data = Buffer.from(await res.arrayBuffer());
  if (sha256(data) !== hash) throw new Error(`${name}: SHA-256 is ${sha256(data)}, expected ${hash}`);
  mkdirSync(cache, { recursive: true });
  writeFileSync(file, data);
  return file;
}

const tmp = mkdtempSync(path.join(tmpdir(), 'ts-bash-'));
try {
  const cli = path.join(tmp, process.platform === 'win32' ? 'tree-sitter.exe' : 'tree-sitter');
  writeFileSync(cli, gunzipSync(readFileSync(await fetchChecked(CLI.url, tools.cli))));
  chmodSync(cli, 0o755);
  const wasiSdk = path.join(tmp, 'wasi-sdk');
  mkdirSync(wasiSdk);
  execFileSync('tar', ['-xzf', await fetchChecked(WASI_SDK.url, tools.wasiSdk), '-C', wasiSdk, '--strip-components=1']);

  const work = path.join(tmp, 'tree-sitter-bash');
  cpSync(path.join(root, 'node_modules', 'tree-sitter-bash'), work, { recursive: true });
  const run = (cmd, args) => execFileSync(cmd, args, { cwd: work, stdio: 'inherit', env: { ...process.env, TREE_SITTER_WASI_SDK_PATH: wasiSdk } });
  const grammar = path.join(work, 'grammar.js');
  const before = readFileSync(grammar, 'utf8');
  cpSync(path.join(root, 'patches', 'tree-sitter-bash', 'grammar.patch'), path.join(work, 'grammar.patch'));
  // A repository of its own: inside another work tree (the temp directory may be in one), `git apply` would skip the paths silently.
  run('git', ['init', '-q']);
  run('git', ['apply', '--ignore-whitespace', 'grammar.patch']);
  if (readFileSync(grammar, 'utf8') === before) throw new Error('patches/tree-sitter-bash/grammar.patch did not change grammar.js');
  run(cli, ['generate']);
  run(cli, ['build', '--wasm', '-o', 'built.wasm']);
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
