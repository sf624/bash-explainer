// CI runs the unit tests in shards (.github/workflows/test.yml, scripts/test-shards.cjs): every test file
// must run in exactly one shard, or a file would be left out of CI (and of the coverage) or run twice.
import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';

const root = path.join(__dirname, '..');
const shards = require('../scripts/test-shards.cjs') as {
  testFiles(): string[];
  readTimings(column?: string): Record<string, number>;
  column(version?: string): string;
  split(files: string[], timings: Record<string, number>, n: number): { files: string[]; time: number }[];
  parseShard(spec: string): { index: number; count: number };
  shardFiles(spec: string): string[];
};
const lookupFiles = require('mocha/lib/cli/lookup-files') as (spec: string, extensions: string[], recursive: boolean) => string[];

/** The shard count of the workflow, after checking that both jobs of shards (Node.js 18 and 24) list each shard once, and name their count in MOCHA_SHARD. */
function workflowShards(): number {
  const yml = fs.readFileSync(path.join(root, '.github/workflows/test.yml'), 'utf8');
  const listed = [...yml.matchAll(/^\s*shard: \[([\d, ]+)\]$/gm)].map((m) => m[1]);
  const counts = [...yml.matchAll(/MOCHA_SHARD: \$\{\{ matrix\.shard \}\}\/(\d+)$/gm)].map((m) => Number(m[1]));
  assert.strictEqual(listed.length, 2, 'two jobs of shards');
  assert.strictEqual(counts.length, 2, 'two jobs name their count in MOCHA_SHARD');
  const n = counts[0];
  for (const [i, list] of listed.entries()) {
    assert.strictEqual(counts[i], n);
    assert.deepStrictEqual(list.split(',').map(Number), Array.from({ length: n }, (_, k) => k + 1));
  }
  return n;
}

describe('the shards of the unit tests', () => {
  it('find the files that mocha finds without them', () => {
    const before = process.cwd();
    process.chdir(root);
    try {
      const mocha = lookupFiles('test/**/*.test.ts', ['.ts'], false).map((f) => path.relative(root, path.resolve(f)).split(path.sep).join('/'));
      assert.deepStrictEqual(shards.testFiles(), mocha.sort());
    } finally {
      process.chdir(before);
    }
  });

  it('put each test file in exactly one shard, for every count up to 8 and the workflow\'s, on each Node.js', () => {
    const files = shards.testFiles();
    const counts = new Set([1, 2, 3, 4, 5, 6, 7, 8, workflowShards()]);
    for (const column of ['18', '24']) {
      for (const n of counts) {
        const seen = new Map<string, number>();
        shards.split(files, shards.readTimings(column), n).forEach((s, i) => {
          assert.ok(s.files.length > 0, `shard ${i + 1}/${n} is empty`);
          for (const f of s.files) {
            assert.ok(!seen.has(f), `${f} is in shards ${seen.get(f)} and ${i + 1} of ${n}`);
            seen.set(f, i + 1);
          }
        });
        assert.deepStrictEqual([...seen.keys()].sort(), files, `the ${n} shards hold every test file (Node.js ${column})`);
      }
    }
    const n = workflowShards();
    const union = Array.from({ length: n }, (_, i) => shards.shardFiles(`${i + 1}/${n}`)).flat().sort();
    assert.deepStrictEqual(union, files);
  });

  it('put a file with no timing in a shard too, counted as the median', () => {
    const files = ['test/a.test.ts', 'test/b.test.ts', 'test/c.test.ts', 'test/new.test.ts'];
    const split = shards.split(files, { 'test/a.test.ts': 10, 'test/b.test.ts': 2, 'test/c.test.ts': 4 }, 2);
    assert.deepStrictEqual(split.map((s) => s.files), [['test/a.test.ts'], ['test/b.test.ts', 'test/c.test.ts', 'test/new.test.ts']]);
    assert.deepStrictEqual(split.map((s) => s.time), [10, 10]);
  });

  it('time only files that exist', () => {
    assert.deepStrictEqual([shards.column('18.20.8'), shards.column('20.0.0'), shards.column('24.1.0')], ['18', '24', '24']);
    const files = new Set(shards.testFiles());
    const timed = new Set([...Object.keys(shards.readTimings('18')), ...Object.keys(shards.readTimings('24'))]);
    const stale = [...timed].filter((f) => !files.has(f));
    assert.deepStrictEqual(stale, [], 'remove these from scripts/test-timings.json (or measure again: node scripts/test-shards.cjs --measure)');
  });

  it('refuse a shard that is not i/n', () => {
    assert.deepStrictEqual(shards.parseShard('2/4'), { index: 2, count: 4 });
    for (const bad of ['0/4', '5/4', '4', 'a/b', '1/0']) assert.throws(() => shards.parseShard(bad), /bad shard/);
    assert.throws(() => shards.split([], {}, 0), /bad shard count/);
  });
});
