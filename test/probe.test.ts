// The probe tables (test/fixtures/probes/*.json): what bash 5.2 does with each snippet, as
// scripts/record-probes.ts recorded it. Steps B1–B5 of docs/design/semantics.md compare the semantic model
// with these facts; here bash is run again on every row, to check that the facts are still what it does.
import * as assert from 'assert';
import { factsOf, instrument, pooled, PROBE_KINDS, probeEnv, probeSkipReason, probeState, probeWords, readProbeTable } from './support/probe';

describe('probes: the harness', () => {
  it('numbers the markers that have no id, and keeps the lines', () => {
    const { script, markers } = instrument('@PROBE@ | @PROBE:x@\n@PROBE@ a');
    assert.deepStrictEqual(markers, ['1', 'x', '3']);
    assert.strictEqual(script, '__probe 1 | __probe x\n__probe 3 a');
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
      before(async () => {
        facts = await pooled(rows.map((row) => () => factsOf(kind, row)));
      });
      rows.forEach((row, i) => {
        const opts = [row.posix && 'bash --posix', row.errexit === false && 'no -e'].filter(Boolean).join(', ');
        it(`${row.manual}: ${JSON.stringify(row.snippet)}${opts ? ` (${opts})` : ''}`, () => {
          assert.deepStrictEqual(facts[i], row.facts);
        });
      });
    });
  }
});
