// Run by offline.test.ts in a process of its own, so that nothing loaded by other tests can hide
// a request: blocks the network and process modules and the browser network APIs, then parses
// and explains the sample scripts. Prints the number of lines explained, or fails.
import * as fs from 'fs';
import * as path from 'path';
import Module = require('module');

const root = path.join(__dirname, '..');
const BLOCKED_MODULES = ['http', 'https', 'http2', 'net', 'tls', 'dgram', 'dns', 'child_process', 'worker_threads', 'cluster'];
const BLOCKED_GLOBALS = ['fetch', 'XMLHttpRequest', 'WebSocket', 'EventSource'];
const used: string[] = [];

const mod = Module as unknown as { _load(request: string, ...rest: unknown[]): unknown };
const load = mod._load;
mod._load = function (request: string, ...rest: unknown[]) {
  if (BLOCKED_MODULES.includes(request.replace(/^node:/, ''))) {
    used.push(`require("${request}")`);
    throw new Error(`blocked: require("${request}")`);
  }
  return load.call(this, request, ...rest);
};
for (const name of BLOCKED_GLOBALS) {
  Object.defineProperty(globalThis, name, {
    configurable: true,
    value: function blocked() {
      used.push(name);
      throw new Error(`blocked: ${name}`);
    },
  });
}

// The hook must be in place for the modules loaded below.
try {
  require('http');
} catch {}
if (used.shift() !== 'require("http")') throw new Error('the module hook is not active');

async function main(): Promise<void> {
  const { createBashParser } = require('../src/parser') as typeof import('../src/parser');
  const { Analyzer } = require('../src/analyzer') as typeof import('../src/analyzer');
  const parser = await createBashParser({
    runtimeDir: path.join(root, 'node_modules/web-tree-sitter'),
    bashWasm: path.join(root, 'grammar/tree-sitter-bash.wasm'),
  });
  let lines = 0;
  for (const file of ['sample.sh', 'posix.sh', 'ksh.ksh']) {
    const tree = parser.parse(fs.readFileSync(path.join(root, 'test/fixtures', file), 'utf8'));
    for (const lang of ['en', 'ja'] as const) {
      for (let line = 0; line <= tree.rootNode.endPosition.row; line++, lines++) new Analyzer(lang).explainLine(tree, line);
    }
  }
  if (used.length) throw new Error(`used: ${used.join(', ')}`);
  console.log(lines);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
