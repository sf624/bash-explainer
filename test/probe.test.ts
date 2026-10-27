// The probe tables (test/fixtures/probes/*.json): what bash 5.2 does with each snippet (bash 5.3, for a row of its
// constructs: `"bash": "5.3"`, run with $BASH_EXPLAINER_BASH53), as scripts/record-probes.ts recorded it. Steps B1–B5
// of docs/design/semantics.md compare the semantic model with these facts; here bash is run again on every row, to
// check that the facts are still what it does, and that each row's try-it prints what it recorded (the explanations show
// it: docs/design/basis.md).
import * as assert from 'assert';
import { factsOf, hasBash53, hasRequired, instrument, pooled, PROBE_KINDS, probeEnv, probeSkipReason, probeState, probeWords, readProbeTable, tryOutput } from './support/probe';

describe('probes: the harness', () => {
  it('numbers the markers that have no id, and keeps the lines', () => {
    const { script, markers } = instrument('@PROBE@ | @PROBE:x@\n@PROBE@ a');
    assert.deepStrictEqual(markers, ['1', 'x', '3']);
    assert.strictEqual(script, '__probe 1 | __probe x\n__probe 3 a');
  });

  it('runs a try-it as a terminal shows it: stdout and stderr in order, the row\'s bash as `bash`', async function () {
    if (probeSkipReason) this.skip();
    const out = await tryOutput({ manual: '', snippet: '', try: { code: "echo out; echo err >&2; bash -c 'echo \"${BASH_VERSINFO[0]}\"'; pwd" } });
    assert.strictEqual(out, 'out\nerr\n5\n/BOX');
    await assert.rejects(tryOutput({ manual: '', snippet: '', try: { code: 'sleep 5' } }, 100), /timed out/);
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
