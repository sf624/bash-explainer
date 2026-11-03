// The contained runs leave nothing behind: a process a job starts (a background loop, in a group of its own or not)
// does not outlive the run, whether the run's shell ends normally or is killed (docs: test/support/contained.ts).
import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { killSession, processesIn, runContained, scoped } from './support/contained';
import { runArgvBatch } from './support/argv';

/** Waits (up to two seconds) until no process is in `dir`, and returns those that are. */
async function leftIn(dir: string): Promise<number[]> {
  let left = processesIn(dir);
  for (let i = 0; i < 40 && left.length; i++) {
    await new Promise((r) => setTimeout(r, 50));
    left = processesIn(dir);
  }
  return left;
}

/** Stops what is left by exact pid, so that a failing test does not leave the loop running. */
function reap(pids: number[]): void {
  for (const p of pids) {
    try {
      process.kill(p, 'SIGKILL');
    } catch {
      // (Gone already.)
    }
  }
}

describe('contained runs leave no process behind', function () {
  this.timeout(30000);
  let dir: string;
  beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'explain-bash-contained-')); });
  afterEach(() => { reap(processesIn(dir)); fs.rmSync(dir, { recursive: true, force: true }); });

  // (`timeout` makes its command a process group of its own, out of reach of the kill of the run's group.)
  const loop = `timeout 60 bash -c 'while :; do sleep 0.1; done' &`;

  it('runContained: a loop in a group of its own, after the shell ended', async () => {
    const run = await runContained(['bash', '-c', `${loop} sleep 0.3`], dir);
    assert.strictEqual(run.status, 0);
    assert.deepStrictEqual(await leftIn(dir), []);
  });

  it('runContained: a loop in a group of its own, after the shell was killed', async () => {
    const run = await runContained(['bash', '-c', `${loop} sleep 0.3; kill -KILL $$`], dir);
    assert.strictEqual(run.status, null);
    assert.deepStrictEqual(await leftIn(dir), []);
  });

  it('runContained: a run that outlives its time', async () => {
    // (`timeout` ends the shell after a second: status 124.)
    const run = await runContained(['bash', '-c', `${loop} sleep 60`], dir, {}, 1000);
    assert.strictEqual(run.status, 124);
    assert.deepStrictEqual(await leftIn(dir), []);
  });

  it('runContained: a fork bomb in a group of its own, which one pass over the session does not catch', async function () {
    // (Only in a cgroup, whose TasksMax stops the bomb at 500 processes; FUNCNEST is 50, the run's default.)
    if (!scoped) return this.skip();
    const start = Date.now();
    // (The `sleep` starts before the bomb, and the shell only waits for it: once the scope is full of the bomb the shell could
    // not fork a `sleep 1`, bash would back off for seconds in "fork: retry", and `timeout` would end it with status 124.)
    const run = await runContained(['bash', '-c', `sleep 1 & s=$!; timeout 12 bash -c 'f(){ (f) & (f); }; f' & wait $s`], dir, {}, 3000);
    assert.strictEqual(run.status, 0);
    // (Well before the bomb's own `timeout 12` ends it: a run that waited for the bomb to die took 12 s. Starting `systemd-run`
    // and killing a full scope take seconds on a machine under load, so the bound is not tighter.)
    assert.ok(Date.now() - start < 10000, `took ${Date.now() - start} ms`);
    assert.deepStrictEqual(await leftIn(dir), []);
  });

  it('runContained: a shell that ended while the test process was blocked is not a timeout', async () => {
    // (The timer runs before the poll that would tell that the shell ended: a test process starved or blocked for longer
    // than the limit, as under CI's load, got "timed out" for a run that had finished.)
    const run = runContained(['true'], dir, {}, 1000, 200);
    const end = Date.now() + 1500;
    while (Date.now() < end) { /* (Blocks the event loop.) */ }
    assert.strictEqual((await run).status, 0);
  });

  it('killSession kills the processes of a session, whatever their group', async () => {
    const { spawn } = await import('child_process');
    const child = spawn('bash', ['-c', `timeout 60 bash -c 'while :; do sleep 0.1; done' & sleep 60`], { cwd: dir, detached: true, stdio: 'ignore' });
    await new Promise((r) => setTimeout(r, 400));
    assert.ok(processesIn(dir).length > 0);
    await killSession(child.pid!);
    assert.deepStrictEqual(await leftIn(dir), []);
  });

  it('killSession does not wait for a zombie that nobody reaps', async () => {
    // (As in a container without an init: the bash `exec`s a `sleep`, which never reaps `setsid sleep 0.2`, a session of its own.)
    const { spawn } = await import('child_process');
    const parent = spawn('bash', ['-c', 'setsid sleep 0.2 & echo $!; exec sleep 60'], { cwd: dir, detached: true, stdio: ['ignore', 'pipe', 'ignore'] });
    try {
      const sid = await new Promise<number>((resolve) => parent.stdout.once('data', (d: Buffer) => resolve(Number(String(d).trim()))));
      let state = '';
      for (let i = 0; i < 40 && state !== 'Z'; i++) {
        await new Promise((r) => setTimeout(r, 50));
        state = fs.readFileSync(`/proc/${sid}/stat`, 'utf8').replace(/^.*\) /, '')[0];
      }
      assert.strictEqual(state, 'Z', 'the session leader is a zombie');
      const start = Date.now();
      await killSession(sid);
      assert.ok(Date.now() - start < 1000, `took ${Date.now() - start} ms`);
    } finally {
      reap([parent.pid!]);
    }
  });

  it('runArgvBatch: a background loop of the script', async () => {
    // (The batch's directory is made in the temporary directory, which is `dir` here.)
    const saved = process.env.TMPDIR;
    process.env.TMPDIR = dir;
    try {
      // (`set -m` gives the loop a process group of its own, out of reach of the driver's own kill of the job's group.)
      const [run] = await runArgvBatch([{ script: 'set -m\n{ while :; do sleep 0.1; done; } &\n__probe 1\n' }]);
      assert.strictEqual(run.status, 0);
      assert.deepStrictEqual(run.records.get('1'), [[]]);
    } finally {
      if (saved === undefined) delete process.env.TMPDIR;
      else process.env.TMPDIR = saved;
    }
    assert.deepStrictEqual(await leftIn(dir), []);
  });
});
