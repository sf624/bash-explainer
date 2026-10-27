import { spawn, spawnSync } from 'child_process';

export interface ContainedRun { stdout: string; stderr: string; status: number | null }

/** Whether `systemd-run --user --scope` works here (not in every CI runner or container). */
export const scoped = spawnSync('systemd-run', ['--user', '--scope', '-q', 'true']).status === 0;

/**
 * Runs `argv` (a bash, usually) in `cwd` with `env` and FUNCNEST set: in a cgroup that caps its memory and tasks when
 * `systemd-run --user` works, under `timeout`, spawned in a process group of its own and killed as a group if it
 * outlives `ms`, so that a script that forks without end cannot fill the machine.
 */
export function runContained(argv: string[], cwd: string, env: NodeJS.ProcessEnv = {}, ms = 20000): Promise<ContainedRun> {
  const seconds = String(Math.ceil(ms / 1000));
  const cmd = scoped
    ? ['systemd-run', '--user', '--scope', '-q', '-p', 'MemoryMax=3G', '-p', 'MemorySwapMax=0', '-p', 'TasksMax=500', 'timeout', seconds, ...argv]
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
    };
    const timer = setTimeout(() => {
      stop();
      reject(new Error(`${argv.join(' ')} timed out\n${stdout}${stderr}`));
    }, ms + 5000);
    child.on('error', (e) => { clearTimeout(timer); reject(e); });
    child.on('close', (status) => {
      clearTimeout(timer);
      stop();
      resolve({ stdout, stderr, status });
    });
  });
}
