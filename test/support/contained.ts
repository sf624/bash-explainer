import { spawn, spawnSync } from 'child_process';
import * as fs from 'fs';
import { promises as fsp } from 'fs';

export interface ContainedRun { stdout: string; stderr: string; status: number | null }

/** Whether `systemd-run --user --scope` works here (not in every CI runner or container). */
export const scoped = spawnSync('systemd-run', ['--user', '--scope', '-q', 'true']).status === 0;

/** How long `killSession` keeps killing before it gives up and fails. */
const KILL_MS = 5000;
/** How long a run may outlive its `ms` (the shell's start-up and `timeout`'s own signal) before it is killed and fails. */
const RUN_SLACK_MS = 5000;
/** How long `close` may take after everything of the run is dead (nothing is left to hold the pipes). */
const PIPES_MS = 5000;

/** Whether process `pid` is running: a zombie or a pid that is gone is not. */
function isRunning(pid: number): boolean {
  try {
    const stat = fs.readFileSync(`/proc/${pid}/stat`, 'utf8');
    return !/^[ZX]/.test(stat.slice(stat.lastIndexOf(')') + 2));
  } catch {
    return false;
  }
}

/** The pids of the processes of session `sid` that are alive: a zombie cannot be killed, only reaped by its parent, and holds nothing. */
async function liveInSession(sid: number): Promise<number[]> {
  const names = (await fsp.readdir('/proc')).filter((name) => /^\d+$/.test(name));
  const found = await Promise.all(names.map(async (name) => {
    try {
      // (pid (command) state ppid pgrp session …: the command may hold spaces and parentheses, so read after the last one.)
      const stat = await fsp.readFile(`/proc/${name}/stat`, 'utf8');
      const [state, , , session] = stat.slice(stat.lastIndexOf(')') + 2).split(' ');
      return state !== 'Z' && state !== 'X' && Number(session) === sid ? Number(name) : 0;
    } catch {
      return 0; // (Gone meanwhile.)
    }
  }));
  return found.filter((pid) => pid > 0);
}

/**
 * Kills every process of the session `sid` (its leader's pid), whatever process group it is in, and returns when none is
 * alive (a zombie does not count: a container without an init never reaps its orphans). The session outlives its leader:
 * it lasts as long as one of its processes. Killing is not atomic: a process that forks meanwhile can survive a pass, so
 * the session is read again and again until it is empty, for `ms` at most, and then this fails rather than returning
 * with the session alive (its last read is made after that time, so it is never a stale answer). It reads `/proc` and
 * does not block the event loop: a synchronous `pkill` pass took seconds while a fork bomb filled the machine, and the
 * blocked loop let the run's own timer fire before the exit it was waiting for (seen in CI, November 2026).
 */
export async function killSession(sid: number, ms = KILL_MS): Promise<void> {
  const end = Date.now() + ms;
  for (;;) {
    const live = await liveInSession(sid);
    if (live.length === 0) return;
    if (Date.now() > end) throw new Error(`session ${sid} still has ${live.length} live processes after ${ms} ms of kills`);
    for (const pid of live) {
      try {
        process.kill(pid, 'SIGKILL');
      } catch {
        // (Gone already.)
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

/**
 * Kills every process of the scope `unit` at once: with systemd 255 and a kernel from 5.14 `systemctl kill` writes the
 * cgroup's `cgroup.kill`, which also stops a process that is forking at that moment, as no pass over the session can.
 * It fails quietly when the scope is gone (it ends with its last process) or the kill is not there (older systemd
 * signals the processes it finds, one pass): `killSession` follows.
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
 * the shell is still running `slackMs` (5 s) after its `ms`; the time the kill takes does not count against that.
 *
 * Because the run is killed as soon as the shell ends, output that a process left running would still write
 * (`echo hi > >(sleep 0.3; cat)`, `(sleep 0.3; echo late) &`) is lost; no caller relies on it.
 */
export function runContained(argv: string[], cwd: string, env: NodeJS.ProcessEnv = {}, ms = 20000, slackMs = RUN_SLACK_MS): Promise<ContainedRun> {
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
    // (Whichever of the timer and the shell's exit comes first ends the run; the other does nothing.)
    let ending = false;
    // (A process that holds the pipes open would keep `close` from coming: kill everything as soon as the shell ends.)
    const shellEnded = (): void => {
      if (ending) return;
      ending = true;
      clearTimeout(timer);
      stop().then(async () => {
        // (Nothing is alive to hold the pipes: `close` comes at once, or a bug of ours is reported rather than waited for.)
        const give = setTimeout(() => reject(new Error(`${argv.join(' ')}: the pipes stayed open after the kill\n${stdout}${stderr}`)), PIPES_MS);
        const status = await closed;
        clearTimeout(give);
        resolve({ stdout, stderr, status });
      }, reject);
    };
    const timer = setTimeout(() => {
      if (ending) return;
      // (A test process that was starved or blocked for longer than the limit runs its timers before it reads the shell's
      // exit: the process table says whether the shell is still running.)
      if (!isRunning(child.pid!)) return shellEnded();
      ending = true;
      stop().then(() => reject(new Error(`${argv.join(' ')} timed out\n${stdout}${stderr}`)), reject);
    }, ms + slackMs);
    child.on('error', (e) => { ending = true; clearTimeout(timer); reject(e); });
    child.on('exit', shellEnded);
  });
}
