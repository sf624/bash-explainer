import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { run } from './run';

export interface BashOptions {
  /** Text fed to stdin (by file, as run.ts does). */
  input?: string;
  /** Run in a fresh temporary directory holding these empty files. */
  files?: string[];
  /** Run in this directory (ignored with `files`). */
  cwd?: string;
  /** `--posix`. */
  posix?: boolean;
  /** Extra environment variables on top of the clean one. */
  env?: NodeJS.ProcessEnv;
  timeout?: number;
}

export interface BashResult {
  stdout: string;
  stderr: string;
  /** The exit status; -1 when bash could not start or was killed. */
  status: number;
}

/**
 * Runs `bash --norc --noprofile -c script` in the C locale with a clean PATH and HOME, so that the user's
 * setup cannot change the result, and returns what it printed.
 */
export function runBash(script: string, options: BashOptions = {}): BashResult {
  const dir = options.files ? fs.mkdtempSync(path.join(os.tmpdir(), 'explain-bash-run-')) : undefined;
  try {
    for (const f of options.files ?? []) fs.writeFileSync(path.join(dir!, f), '');
    const r = run('bash', ['--norc', '--noprofile', ...(options.posix ? ['--posix'] : []), '-c', script], {
      input: options.input,
      cwd: dir ?? options.cwd,
      env: { PATH: '/usr/bin:/bin', HOME: '/home/w', LC_ALL: 'C', ...options.env },
      timeout: options.timeout ?? 10000,
    });
    return { stdout: r.stdout?.toString() ?? '', stderr: r.stderr?.toString() ?? '', status: r.status ?? -1 };
  } finally {
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
  }
}
