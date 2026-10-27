// What an explanation rests on (src/basis.ts, docs/design/basis.md): the facts of the catalog that are bash's
// behaviour name a probe row with a try-it, the row is in the copy the explanations read (src/basis-probes.json, the
// same as the tables say), and every try-it of the tables is shown by some fact. test/probe.test.ts runs the try-its
// in bash; here nothing runs bash.
import * as assert from 'assert';
import * as fs from 'fs';
import { basisFor, basisOf, type BasisSpec, PROBE_COPY, type ProbeRef } from '../src/basis';
import { fact, type FactId, MESSAGES } from '../src/messages';
import { explain } from './support/explain';
import { BASIS_COPY, basisCopy, PROBE_KINDS, type ProbeKind, readProbeTable } from './support/probe';

type Spec = BasisSpec | ((p: unknown) => BasisSpec | undefined);

/** The params the basis of an entry that depends on them is read with: each case it tells apart. */
const SAMPLES: Partial<Record<FactId, unknown[]>> = {
  'exit-modulo': [{ command: 'exit', value: '300', status: 44, ends: 'shell' }, { command: 'return', value: '300', status: 44, ends: 'function' }],
};

const entries = (Object.entries(MESSAGES) as [FactId, { basis?: Spec }][]).filter(([, e]) => e.basis);

/** The specs an entry gives: its own, or one per sample of its params. */
function specsOf(id: FactId, basis: Spec): BasisSpec[] {
  if (typeof basis !== 'function') return [basis];
  const samples = SAMPLES[id];
  assert.ok(samples, `${id}: a basis that depends on the params needs samples in SAMPLES`);
  return samples.map(basis).filter((s): s is BasisSpec => s !== undefined);
}

/** Whether a table has a row with that id. */
function rowExists(ref: ProbeRef): boolean {
  const [table, id] = ref.split('#') as [ProbeKind, string];
  return PROBE_KINDS.includes(table) && readProbeTable(table).some((r) => r.id === id);
}

describe('basis: what an explanation rests on', () => {
  it('keeps the copy of the rows with a try-it as the tables have them', () => {
    assert.strictEqual(fs.readFileSync(BASIS_COPY, 'utf8'), `${JSON.stringify(basisCopy(), null, 2)}\n`, 'run npx tsx scripts/record-probes.ts');
  });

  it('names rows that exist, the first with a try-it about a section the fact cites; and every try-it is shown by a fact', () => {
    assert.ok(entries.length >= 2);
    const shown = new Set<string>();
    for (const [id, e] of entries) {
      for (const spec of specsOf(id, e.basis!)) {
        assert.ok(PROBE_COPY[spec.probe], `${id}: ${spec.probe} has no try-it in the copy`);
        assert.ok((MESSAGES[id].refs as readonly string[]).includes(PROBE_COPY[spec.probe].manual), `${id}: ${spec.probe} is about ${PROBE_COPY[spec.probe].manual}`);
        for (const ref of spec.also ?? []) assert.ok(rowExists(ref), `${id}: no row ${ref}`);
        shown.add(spec.probe);
      }
    }
    assert.deepStrictEqual(Object.keys(PROBE_COPY).filter((k) => !shown.has(k)), [], 'a try-it no fact shows');
  });

  it('gives a try-it as one word for bash, `bash -c \'…\'`, which any shell (bash, zsh, fish) passes on as it is', () => {
    // (fish reads `\'` and `\\` inside single quotes: none may be there.)
    for (const [ref, row] of Object.entries(PROBE_COPY)) assert.match(row.try.code, /^bash -c '[^'\\]*'$/, ref);
  });

  it('gives a fact its basis and try-it, and none where the manual says it', () => {
    const exit = fact('en', 'exit-modulo', { command: 'exit', value: '300', status: 44, ends: 'shell' });
    assert.deepStrictEqual(exit.basis, { kind: 'checked', bash: ['5.2'], probes: ['status#exit-status', 'status#exit-negative'] });
    assert.deepStrictEqual(exit.tryIt, { code: "bash -c '(exit 300); echo $?'", output: '44', bash: '5.2', probe: 'status#exit-status' });
    // (`return 300`: 4.1 says that `return` keeps the least significant 8 bits.)
    const ret = fact('en', 'exit-modulo', { command: 'return', value: '300', status: 44, ends: 'function' });
    assert.ok(!('basis' in ret) && !('tryIt' in ret));
    assert.deepStrictEqual(basisFor(ret), { kind: 'manual', sections: ['3.7.5'] });
    assert.deepStrictEqual(basisFor({}), { kind: 'manual', sections: [] });
    const unset = fact('ja', 'unset-function-and-variable');
    assert.deepStrictEqual(unset.basis, { kind: 'checked', bash: ['5.2'], probes: ['state#unset-fv'] });
    assert.match(unset.tryIt!.output, /cannot simultaneously unset a function and a variable\nstatus 1, x=1\nfunction$/);
    // A basis of the manual with a probe: only the try-it.
    assert.deepStrictEqual(basisOf({ kind: 'manual', probe: 'status#exit-status' }), { tryIt: exit.tryIt });
    assert.deepStrictEqual(basisOf(undefined), {});
  });

  it('reads what a builtin ends from the status model: `exit` the shell, `return` a function', () => {
    const facts = (src: string, line: number) => explain(src, line).facts ?? [];
    assert.strictEqual(facts('exit 300', 0).find((f) => f.id === 'exit-modulo')?.basis?.kind, 'checked');
    const ret = facts('f() {\n  return 300\n}', 1).find((f) => f.id === 'exit-modulo');
    assert.ok(ret && !ret.basis);
    // Both on one line: two notes, each with its basis (the facts of a line are kept once per text).
    const both = facts('f() { return 300; }; exit 300', 0).filter((f) => f.id === 'exit-modulo');
    assert.deepStrictEqual(both.map((f) => [f.body, f.basis?.kind]), [
      ['An exit status is 0–255, so `return 300` gives 44 (the value modulo 256)', undefined],
      ['An exit status is 0–255, so `exit 300` gives 44 (the value modulo 256)', 'checked'],
    ]);
  });
});
