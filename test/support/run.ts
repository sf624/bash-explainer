import { spawnSync, SpawnSyncReturns } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

export interface RunOptions {
  /** Text fed to the tool's stdin. */
  input?: string;
  env?: NodeJS.ProcessEnv;
  cwd?: string;
  timeout?: number;
  maxBuffer?: number;
  /** Throw when the tool cannot start or exits non-zero, as execFileSync does. */
  check?: boolean;
  /** Hide the tool's stderr (the default is to capture it). */
  ignoreStderr?: boolean;
}

/**
 * Runs a tool like spawnSync, with `input` as its stdin read from a temporary file, not a pipe.
 * A tool that stops reading early (BEGIN-only awk, head, sed q, xargs) then cannot make the write
 * fail with EPIPE, which Node 18 reports as an error depending on timing.
 * Do not use it where the test needs stdin to be a pipe.
 */
export function run(cmd: string, args: string[], options: RunOptions = {}): SpawnSyncReturns<Buffer> {
  const { input = '', check, ignoreStderr, ...rest } = options;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'explain-bash-stdin-'));
  const file = path.join(dir, 'stdin');
  fs.writeFileSync(file, input);
  const fd = fs.openSync(file, 'r');
  try {
    const r = spawnSync(cmd, args, { ...rest, stdio: [fd, 'pipe', ignoreStderr ? 'ignore' : 'pipe'] }) as SpawnSyncReturns<Buffer>;
    if (check && (r.error || r.status !== 0)) {
      throw r.error ?? new Error(`Command failed: ${cmd} ${args.join(' ')}\n${r.stderr?.toString() ?? ''}`);
    }
    return r;
  } finally {
    fs.closeSync(fd);
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
