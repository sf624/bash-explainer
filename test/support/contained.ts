import { spawn, spawnSync } from 'child_process';
import * as fs from 'fs';

export interface ContainedRun { stdout: string; stderr: string; status: number | null }

/** Whether `systemd-run --user --scope` works here (not in every CI runner or container). */
export const scoped = spawnSync('systemd-run', ['--user', '--scope', '-q', 'true']).status === 0;

/**
 * Kills every process of the session `sid` (its leader's pid), whatever process group it is in. The session outlives its
 * leader: it lasts as long as one of its processes.
 */
export function killSession(sid: number): void {
  spawnSync('pkill', ['-KILL', '-s', String(sid)]);
}

/** The pids of the processes whose working directory or command line is in `dir` (the leaks a test looks for). */
export function processesIn(dir: string): number[] {
  const found: number[] = [];
  for (const name of fs.readdirSync('/proc')) {
    if (!/^\d+$/.test(name)) continue;
    try {
      const cwd = fs.readlinkSync(`/proc/${name}/cwd`);
      const cmd = fs.readFileSync(`/proc/${name}/cmdline`, 'utf8');
      if (cwd.startsWith(dir) || cmd.includes(dir)) found.push(Number(name));
    } catch {
      // (Gone, or not ours to read.)
    }
  }
  return found;
}

/**
 * Runs `argv` (a bash, usually) in `cwd` with `env` and FUNCNEST set: in a cgroup that caps its memory and tasks when
 * `systemd-run --user` works, under `timeout`, spawned in a process group of its own and killed as a group if it
 * outlives `ms`, so that a script that forks without end cannot fill the machine.
 *
 * Nothing the run started outlives it: a process that made a group of its own (`timeout` does) is out of reach of the
 * group kill, and stays when the run's shell is killed before it kills it. So the run is a session (`detached`), every
 * process of which is killed at the end (`killSession`), and the scope has a lifetime of its own, as a backstop for
 * a test process that is itself killed.
 */
export function runContained(argv: string[], cwd: string, env: NodeJS.ProcessEnv = {}, ms = 20000): Promise<ContainedRun> {
  const seconds = String(Math.ceil(ms / 1000));
  const cmd = scoped
    ? ['systemd-run', '--user', '--scope', '-q', '-p', 'MemoryMax=3G', '-p', 'MemorySwapMax=0', '-p', 'TasksMax=500', '-p', `RuntimeMaxSec=${Math.ceil(ms / 1000) + 10}`, 'timeout', seconds, ...argv]
    : ['timeout', seconds, ...argv];
  return new Promise((resolve, reject) => {
    const child = spawn(cmd[0], cmd.slice(1), {
      cwd, detached: true, stdio: ['ignore', 'pipe', 'pipe'],
      env: { PATH: '/usr/bin:/bin', HOME: cwd, LC_ALL: 'C', FUNCNEST: '50', XDG_RUNTIME_DIR: process.env.XDG_RUNTIME_DIR, DBUS_SESSION_BUS_ADDRESS: process.env.DBUS_SESSION_BUS_ADDRESS, ...env },
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d: Buffer) => { stdout += d; });
    child.stderr.on('data', (d: Buffer) => { stderr += d; });
    const stop = (): void => {
      try {
        process.kill(-child.pid!, 'SIGKILL');
      } catch {
        // (Gone already.)
      }
      killSession(child.pid!);
    };
    const timer = setTimeout(() => {
      stop();
      reject(new Error(`${argv.join(' ')} timed out\n${stdout}${stderr}`));
    }, ms + 5000);
    child.on('error', (e) => { clearTimeout(timer); reject(e); });
    // (A process that holds the pipes open would keep `close` from coming: kill the session as soon as the shell ends.)
    child.on('exit', stop);
    child.on('close', (status) => {
      clearTimeout(timer);
      stop();
      resolve({ stdout, stderr, status });
    });
  });
}
