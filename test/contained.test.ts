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

  it('runContained: a fork bomb in a group of its own, which one pass of pkill does not catch', async function () {
    // (Only in a cgroup, whose TasksMax stops the bomb at 500 processes; FUNCNEST is 50, the run's default.)
    if (!scoped) return this.skip();
    const start = Date.now();
    const run = await runContained(['bash', '-c', `timeout 12 bash -c 'f(){ (f) & (f); }; f' & sleep 1`], dir, {}, 3000);
    assert.strictEqual(run.status, 0);
    assert.ok(Date.now() - start < 6000, `took ${Date.now() - start} ms`);
    assert.deepStrictEqual(await leftIn(dir), []);
  });

  it('killSession kills the processes of a session, whatever their group', async () => {
    const { spawn } = await import('child_process');
    const child = spawn('bash', ['-c', `timeout 60 bash -c 'while :; do sleep 0.1; done' & sleep 60`], { cwd: dir, detached: true, stdio: 'ignore' });
    await new Promise((r) => setTimeout(r, 400));
    assert.ok(processesIn(dir).length > 0);
    await killSession(child.pid!);
    assert.deepStrictEqual(await leftIn(dir), []);
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
