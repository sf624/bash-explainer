// The probe tables (test/fixtures/probes/*.json): what bash 5.2 does with each snippet (bash 5.3, for a row of its
// constructs: `"bash": "5.3"`, run with $BASH_EXPLAINER_BASH53), as scripts/record-probes.ts recorded it. Steps B1–B5
// of docs/design/semantics.md compare the semantic model with these facts; here bash is run again on every row, to
// check that the facts are still what it does, and that each row's try-it prints what it recorded (the explanations show
// it: docs/design/basis.md).
import * as assert from 'assert';
import { factsOf, hasBash53, hasRequired, instrument, pooled, PROBE_KINDS, probeEnv, probeSkipReason, probeState, probeWords, readProbeTable, releaseOf, steadyTimes, tryOutput, tryReleases } from './support/probe';

describe('probes: the harness', () => {
  it('numbers the markers that have no id, and keeps the lines', () => {
    const { script, markers } = instrument('@PROBE@ | @PROBE:x@\n@PROBE@ a');
    assert.deepStrictEqual(markers, ['1', 'x', '3']);
    assert.strictEqual(script, '__probe 1 | __probe x\n__probe 3 a');
  });

  it('runs a try-it as a terminal shows it: stdout and stderr in order, the row\'s bash as `bash`', async function () {
    if (probeSkipReason) this.skip();
    const run = (code: string, timeout?: number) => tryOutput({ manual: '', snippet: '', try: { code } }, timeout);
    assert.strictEqual(await run(`echo out; echo err >&2; bash -c 'echo "\${BASH_VERSINFO[0]}"'; pwd; echo "$PATH"`), 'out\nerr\n5\n/BOX\nBIN:/usr/bin:/bin');
    await assert.rejects(run('sleep 5', 100), /timed out/);
    // (A shell killed by itself has not timed out; a job left in the background is killed with the shell.)
    assert.strictEqual(await run('echo before; kill -9 $$'), 'before');
    const pid = Number(await run('sleep 30 & echo $!'));
    await new Promise((r) => setTimeout(r, 100));
    assert.throws(() => process.kill(pid, 0), /ESRCH/);
  });

  it('writes the digits of the times `time` prints as zeros, and leaves other text alone', () => {
    // (bash measures them: `time` alone took 0m0.002s once in CI.)
    assert.strictEqual(steadyTimes('\nreal\t0m0.002s\nuser\t1m10.100s\nsys\t0m0.000s\nreal 0m0.002s'), '\nreal\t0m0.000s\nuser\t0m00.000s\nsys\t0m0.000s\nreal 0m0.002s');
  });

  it('reads every table: a manual section, a snippet with markers, and recorded facts', () => {
    for (const kind of PROBE_KINDS) {
      const rows = readProbeTable(kind);
      assert.ok(rows.length >= 10, kind);
      for (const row of rows) {
        assert.match(row.manual, /^\d+(\.\d+)*$/, `${kind}: ${row.snippet}`);
        assert.ok(row.facts !== undefined, `${kind}: ${row.snippet} has no facts: run scripts/record-probes.ts`);
        if (kind !== 'state') assert.ok(instrument(row.snippet).markers.length || kind === 'status', `${kind}: ${row.snippet} has no marker`);
        if (kind === 'names') assert.ok(row.names?.length, `${row.snippet} names nothing`);
      }
    }
  });
});

(probeSkipReason ? describe.skip : describe)(`probes: bash does what the tables say${probeSkipReason ? ` (${probeSkipReason})` : ''}`, function () {
  this.timeout(60000);

  it('keeps fields with newlines, empty fields and no fields apart', async () => {
    const { fields } = await probeWords("@PROBE:a@ $'a\\nb' '' x; @PROBE:b@; @PROBE:c@ ''");
    assert.deepStrictEqual(fields, { a: [['a\nb', '', 'x']], b: [[]], c: [['']] });
  });

  it('runs a snippet in dash with `__probe` on its first line: NULs, empty fields and line numbers are kept', async function () {
    if (!hasRequired({ manual: '', snippet: '', requires: 'dash' })) this.skip();
    const { fields, run } = await probeWords("@PROBE:a@ 'a\nb' '' x; @PROBE:b@\n@PROBE:c@ ''\n${x/a/b}", { dash: true });
    assert.deepStrictEqual(fields, { a: [['a\nb', '', 'x']], b: [[]], c: [['']] });
    // (dash names the line of the error: the fourth.)
    assert.match(run.stderr, /^SCRIPT: 4: Bad substitution/);
  });

  it('gives the state of a marker that ran, and none for one that did not', async () => {
    const { states } = await probeState('x=1\n@PROBE:a@\nexit 0\n@PROBE:b@');
    assert.deepStrictEqual(states.a.variables.x, { attrs: '-', value: '"1"' });
    assert.ok(!('b' in states) && !('end' in states));
  });

  it('says that a marker that never ran did not', async () => {
    const { env } = await probeEnv('false && @PROBE:a@; @PROBE:b@');
    assert.deepStrictEqual(env, { a: 'not-run', b: 'main' });
  });

  for (const kind of PROBE_KINDS) {
    describe(kind, () => {
      const rows = readProbeTable(kind);
      let facts: unknown[] = [];
      let outputs: (string | undefined)[] = [];
      before(async () => {
        facts = await pooled(rows.map((row) => () => (hasRequired(row) ? factsOf(kind, row) : Promise.resolve(row.facts))));
        outputs = await pooled(rows.map((row) => () => (row.try && hasRequired(row) ? tryOutput(row) : Promise.resolve(row.try?.output))));
      });
      rows.forEach((row, i) => {
        const opts = [row.bash && `bash ${row.bash}`, row.posix && 'bash --posix', row.shell === 'sh' ? 'dash and bash --posix' : row.shell, row.errexit === false && 'no -e'].filter(Boolean).join(', ');
        it(`${row.manual}: ${JSON.stringify(row.snippet)}${opts ? ` (${opts})` : ''}`, () => {
          // (Without a bash 5.3, its rows keep what was recorded; CI's `bash53` job runs them.)
          if (row.bash === '5.3' && !hasBash53 && process.env.BASH_EXPLAINER_BASH53_REQUIRED) assert.fail('BASH_EXPLAINER_BASH53_REQUIRED is set, but $BASH_EXPLAINER_BASH53 is not a bash 5.3');
          assert.deepStrictEqual(facts[i], row.facts);
          if (row.try) assert.strictEqual(outputs[i], row.try.output, `try-it: ${row.try.code}`);
        });
      });
    });
  }
});

// Every try-it of bash 5.2 runs in bash 5.3 too (CI's `bash53` job, which runs the tests named "bash 5.3"): the copy
// lists 5.3 as a release the try-it was checked in (`Basis.bash`, the chip's words) exactly when it prints the same.
describe('probes: the try-its in bash 5.3', function () {
  this.timeout(60000);
  const rows = PROBE_KINDS.flatMap((kind) => readProbeTable(kind).filter((row) => row.try && releaseOf(row) === '5.2').map((row) => ({ kind, row })));

  it('lists the releases of each try-it: its own row\'s first, then 5.3 or nothing', () => {
    for (const { kind, row } of rows) assert.ok(['5.2', '5.2,5.3'].includes(tryReleases(row).join()), `${kind}#${row.id}: ${tryReleases(row).join()}`);
  });

  for (const { kind, row } of rows) {
    it(`${kind}#${row.id} prints the same in bash 5.3 exactly when it lists 5.3`, async function () {
      if (!hasBash53) {
        if (process.env.BASH_EXPLAINER_BASH53_REQUIRED) assert.fail('BASH_EXPLAINER_BASH53_REQUIRED is set, but $BASH_EXPLAINER_BASH53 is not a bash 5.3');
        this.skip();
      }
      const output = await tryOutput(row, undefined, '5.3');
      assert.strictEqual(output === row.try!.output, tryReleases(row).includes('5.3'), `try-it: ${row.try!.code}\n  bash 5.3: ${JSON.stringify(output)}`);
    });
  }
});
