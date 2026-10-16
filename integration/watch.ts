// Records network access and processes started by the extension under test, from inside VS Code's
// extension host. VS Code and its built-in extensions share the process, so a call counts only
// when the extension's bundle is on the call stack. Recording does not block anything.
const KEY = '__bashExplainerWatch';

interface Watch {
  /** The extension's bundle, normalised for comparing with stack traces. */
  target: string;
  calls: string[];
  /** Whether the extension had already started when the watch was installed (it must not). */
  activeAtStart: boolean;
}

// The runner and the tests are separate bundles: the state lives on globalThis.
export const state = (): Watch => (globalThis as Record<string, unknown>)[KEY] as Watch;

const norm = (s: string) => s.replace(/\\/g, '/').toLowerCase();

function describe(args: unknown[]): string {
  return args.map((a) => {
    if (typeof a === 'string') return JSON.stringify(a.slice(0, 120));
    if (a instanceof URL) return a.href;
    if (a && typeof a === 'object') return JSON.stringify(a, (_k, v) => (typeof v === 'function' ? undefined : v))?.slice(0, 120);
    return String(a);
  }).join(', ');
}

export function install(bundle: string, activeAtStart: boolean): void {
  const w: Watch = { target: norm(bundle), calls: [], activeAtStart };
  (globalThis as Record<string, unknown>)[KEY] = w;
  const fromExtension = () => norm(new Error().stack ?? '').includes(w.target);

  const wrap = (owner: Record<string, unknown> | undefined, name: string, label: string) => {
    const original = owner?.[name];
    if (typeof original !== 'function') return;
    owner![name] = function (this: unknown, ...args: unknown[]) {
      if (fromExtension()) w.calls.push(`${label}(${describe(args)})`);
      return original.apply(this, args);
    };
  };

  const g = globalThis as unknown as Record<string, unknown>;
  wrap(g, 'fetch', 'fetch');
  for (const name of ['http', 'https']) {
    const m = require(name);
    wrap(m, 'request', `${name}.request`);
    wrap(m, 'get', `${name}.get`);
  }
  // Every TCP connection, from net.connect, http, tls or anything else, goes through here.
  wrap(require('net').Socket.prototype, 'connect', 'net.Socket.connect');
  wrap(require('tls'), 'connect', 'tls.connect');
  wrap(require('dgram'), 'createSocket', 'dgram.createSocket');
  const dns = require('dns');
  for (const name of ['lookup', 'resolve', 'resolve4', 'resolve6']) wrap(dns, name, `dns.${name}`);
  const cp = require('child_process');
  for (const name of ['spawn', 'spawnSync', 'exec', 'execSync', 'execFile', 'execFileSync', 'fork']) wrap(cp, name, `child_process.${name}`);
  const wt = require('worker_threads');
  const Worker = wt.Worker;
  try {
    wt.Worker = class extends Worker {
      constructor(...args: unknown[]) {
        if (fromExtension()) w.calls.push(`new Worker(${describe(args)})`);
        super(...(args as [string]));
      }
    };
  } catch {
    // Read-only in this Node.js: the bundle check (test/offline.test.ts) covers it.
  }

  // Modules the bundle loads: only vscode, fs and path are expected.
  // The module itself (an import would give a read-only copy in the bundle).
  const M = require('module') as { _load(request: string, parent: { filename?: string } | undefined, ...rest: unknown[]): unknown };
  const load = M._load;
  M._load = function (request: string, parent: { filename?: string } | undefined, ...rest: unknown[]) {
    if (parent?.filename && norm(parent.filename) === w.target && !['vscode', 'fs', 'path'].includes(request)) w.calls.push(`require(${JSON.stringify(request)})`);
    return load.call(this, request, parent, ...rest);
  };
}
