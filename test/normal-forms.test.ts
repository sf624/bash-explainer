// The normal-forms table (docs/design/oracles.md, 4.2 and step 7): test/fixtures/oracles/normal-forms.json holds, for
// each function of src/ that maps several spellings to one key (4.1), groups of forms bash runs the same (`same`) and
// near-misses it runs otherwise (`differ`). Both sides of each row are checked:
// - the keys (test/support/normal-forms.ts, `KEYS`): the forms of `same` get one key, those of `differ` one each. A row
//   whose keys disagree with bash is a finding, recorded in the row (`known`, with the reason); a `known` row whose keys
//   agree is stale and fails, as in test/fixtures/bash-ast-known.json;
// - bash: the forms of `same` give the same observations (stdout, stderr, status, the files left), those of `differ`
//   each other ones, in bash 5.2 and, when `$BASH_EXPLAINER_BASH53` names one, 5.3. A row that bash runs otherwise is
//   wrong and fails. Each form runs as a script of its own, in a directory of its own, with no walls (the forms are
//   hand-written: test/support/rewrite-states.ts, `Job.walls`), in contained batches (test/support/contained.ts).
import * as assert from 'assert';
import { spawnSync } from 'child_process';
import { formsOf, jobOf, keyOf, NORMALIZERS, type Observed, readTable, type Row } from './support/normal-forms';
import { hasBash53, PROBE_BASH, PROBE_BASH53, probeSkipReason } from './support/probe';
import { type Ran, runJobs } from './support/rewrite-states';

const rows = readTable();
const label = (row: Row, i: number): string => `#${i} ${row.normalizer} ${JSON.stringify(formsOf(row)).slice(0, 100)}`;
const oneValue = (xs: readonly string[]): boolean => xs.every((x) => x === xs[0]);
const allDistinct = (xs: readonly string[]): boolean => new Set(xs).size === xs.length;

describe('normal forms (oracles.md, 4.2): the table', () => {
  it('has well-formed rows, for every normalizer of 4.1', () => {
    const bad = rows.flatMap((row, i) => {
      const why = [
        !NORMALIZERS.includes(row.normalizer) && 'an unknown normalizer',
        (row.same === undefined) === (row.differ === undefined) && 'not one of `same` and `differ`',
        formsOf(row).length < 2 && 'fewer than two forms',
        !allDistinct(formsOf(row)) && 'a form twice',
        !row.observe.length && 'nothing to observe',
        row.known !== undefined && !row.known.trim() && 'a `known` with no reason',
      ].filter(Boolean);
      return why.length ? [`${label(row, i)}: ${why.join(', ')}`] : [];
    });
    const missing = NORMALIZERS.filter((n) => !rows.some((r) => r.normalizer === n));
    assert.deepStrictEqual([...bad, ...missing.map((n) => `no row for ${n}`)], []);
  });

  it('gives one key to the forms of `same` and one each to those of `differ`, but where a row says why not (`known`)', () => {
    const fresh: string[] = [];
    const stale: string[] = [];
    rows.forEach((row, i) => {
      const keys = formsOf(row).map((f) => keyOf(row, f));
      const agrees = row.same ? oneValue(keys) : allDistinct(keys);
      if (!agrees && row.known === undefined) fresh.push(`${label(row, i)}: ${row.same ? 'keys differ' : 'keys merge'}: ${JSON.stringify(keys)}`);
      if (agrees && row.known !== undefined) stale.push(`stale: ${label(row, i)}: the keys agree with bash now; drop its \`known\``);
    });
    assert.deepStrictEqual([...fresh, ...stale], []);
  });
});

/** What a run gives for each thing a row observes, as one string. */
function observed(r: Ran, what: readonly Observed[]): string {
  return JSON.stringify(what.map((w) => (w === 'stdout' ? r.out : w === 'stderr' ? r.err : w === 'status' ? r.status : r.files)));
}

/** Whether `program` is on the PATH the forms run with. */
const present = (program: string): boolean => spawnSync('sh', ['-c', 'command -v "$1"', 'sh', program], { env: { PATH: '/usr/bin:/bin' } }).status === 0;

describe('normal forms (oracles.md, 4.2): bash runs them as the table says', function () {
  this.timeout(120000);
  const releases: [string, string][] = [['5.2', PROBE_BASH], ...(hasBash53 ? [['5.3', PROBE_BASH53!] as [string, string]] : [])];
  // (The rows whose programs are missing are skipped, and the title says so: a count that grows shows what CI misses.)
  const missing = [...new Set(rows.flatMap((row) => row.requires ?? []))].filter((p) => !present(p));
  const runnable = rows.map((row, i) => ({ row, i })).filter(({ row }) => !(row.requires ?? []).some((p) => missing.includes(p)));
  const skipped = rows.length - runnable.length;

  for (const [release, program] of releases) {
    it(`in bash ${release}: the forms of \`same\` run the same, those of \`differ\` each otherwise${skipped ? ` (${skipped} rows skipped, without ${missing.join(', ')})` : ''}`, async function () {
      if (probeSkipReason) this.skip();
      const jobs = runnable.flatMap(({ row }) => formsOf(row).map((f) => jobOf(row, f)));
      const ran = await runJobs(program, jobs);
      let k = 0;
      const wrong = runnable.flatMap(({ row, i }) => {
        const got = formsOf(row).map(() => observed(ran[k++], row.observe));
        const holds = row.same ? oneValue(got) : allDistinct(got);
        return holds ? [] : [`${label(row, i)}: bash gives ${got.join(' / ')}`];
      });
      assert.deepStrictEqual(wrong, []);
    });
  }
});
