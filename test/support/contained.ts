import { spawn, spawnSync } from 'child_process';
import * as fs from 'fs';

export interface ContainedRun { stdout: string; stderr: string; status: number | null }

/** Whether `systemd-run --user --scope` works here (not in every CI runner or container). */
export const scoped = spawnSync('systemd-run', ['--user', '--scope', '-q', 'true']).status === 0;

/**
 * Kills every process of the session `sid` (its leader's pid), whatever process group it is in. The session outlives its
 * leader: it lasts as long as one of its processes. `pkill` is not atomic: a process that forks meanwhile can survive a
 * pass, so it is repeated until nothing is left (it exits 1 when nothing matches), for `ms` at most, and then it fails
 * rather than returning with the session alive. It does not block the event loop: a pass can take seconds while a fork
 * bomb fills the machine, and a blocked loop let the run's own timer fire before the exit it was waiting for (seen in CI,
 * November 2026).
 */
export async function killSession(sid: number, ms = 5000): Promise<void> {
  const end = Date.now() + ms;
  for (;;) {
    const status = await new Promise<number | null>((resolve) => {
      spawn('pkill', ['-KILL', '-s', String(sid)], { stdio: 'ignore' }).on('error', () => resolve(null)).on('close', resolve);
    });
    if (status !== 0) return;
    if (Date.now() > end) throw new Error(`session ${sid} still has processes after ${ms} ms of kills`);
  }
}

/**
 * Kills every process of the scope `unit` at once: `systemctl kill` writes the cgroup's `cgroup.kill` (systemd 255 and
 * the kernel from 5.14), which also stops a process that is forking at that moment, as no pass of `pkill` can. It fails
 * quietly when the scope is gone (it ends with its last process) or the kill is not there: `killSession` follows.
 */
function killScope(unit: string): Promise<void> {
  return new Promise((resolve) => {
    spawn('systemctl', ['--user', 'kill', '--signal=SIGKILL', '--kill-whom=all', `${unit}.scope`], { stdio: 'ignore' })
      .on('error', () => resolve()).on('close', () => resolve());
  });
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

let runs = 0;

/**
 * Runs `argv` (a bash, usually) in `cwd` with `env` and FUNCNEST set: in a cgroup that caps its memory and tasks when
 * `systemd-run --user` works, under `timeout`, spawned in a process group of its own and killed as a group if it
 * outlives `ms`, so that a script that forks without end cannot fill the machine.
 *
 * What the run starts does not outlive it: when the shell ends (or the run outlives `ms`), the run's scope is killed at
 * once where there is one (`killScope`), and then every process of its session, which is a session of its own
 * (`detached`) because `timeout`, `set -m` and the like make process groups out of reach of a group kill
 * (`killSession`). A process that leaves the session (`setsid`) outside a scope is not reached by that; only the scope's
 * lifetime (`RuntimeMaxSec`, which also covers a test process that is itself killed) ends it, and only where
 * `systemd-run` works. The promise is settled only when all of that is dead, or rejected when it cannot be killed or
 * the shell does not end within `ms` + 5 s; the time the kill takes does not count against that.
 *
 * Because the run is killed as soon as the shell ends, output that a process left running would still write
 * (`echo hi > >(sleep 0.3; cat)`, `(sleep 0.3; echo late) &`) is lost; no caller relies on it.
 */
export function runContained(argv: string[], cwd: string, env: NodeJS.ProcessEnv = {}, ms = 20000): Promise<ContainedRun> {
  const seconds = String(Math.ceil(ms / 1000));
  const unit = `explain-bash-contained-${process.pid}-${++runs}`;
  const cmd = scoped
    ? ['systemd-run', '--user', '--scope', '-q', `--unit=${unit}`, '-p', 'MemoryMax=3G', '-p', 'MemorySwapMax=0', '-p', 'TasksMax=500', '-p', `RuntimeMaxSec=${Math.ceil(ms / 1000) + 10}`, 'timeout', seconds, ...argv]
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
    const closed = new Promise<number | null>((done) => child.on('close', done));
    /** Kills the run: the shell's group, the scope as a whole, then what is left of the session. */
    const stop = async (): Promise<void> => {
      try {
        process.kill(-child.pid!, 'SIGKILL');
      } catch {
        // (Gone already.)
      }
      if (scoped) await killScope(unit);
      await killSession(child.pid!);
    };
    const timer = setTimeout(() => {
      stop().then(() => reject(new Error(`${argv.join(' ')} timed out\n${stdout}${stderr}`)), reject);
    }, ms + 5000);
    child.on('error', (e) => { clearTimeout(timer); reject(e); });
    // (A process that holds the pipes open would keep `close` from coming: kill everything as soon as the shell ends.)
    child.on('exit', () => {
      clearTimeout(timer);
      stop().then(async () => {
        // (Nothing is alive to hold the pipes: `close` comes at once, or a bug of ours is reported rather than waited for.)
        const give = setTimeout(() => reject(new Error(`${argv.join(' ')}: the pipes stayed open after the kill\n${stdout}${stderr}`)), 5000);
        const status = await closed;
        clearTimeout(give);
        resolve({ stdout, stderr, status });
      }, reject);
    });
  });
}
