// What an explanation rests on (src/basis.ts, docs/design/basis.md): the facts of the catalog that are bash's
// behaviour name a probe row with a try-it, the row is in the copy the explanations read (src/basis-probes.json, the
// same as the tables say), and every try-it of the tables is shown by some fact. test/probe.test.ts runs the try-its
// in bash; here nothing runs bash.
import * as assert from 'assert';
import * as fs from 'fs';
import { Analyzer } from '../src/analyzer';
import { basisFor, basisOf, type BasisSpec, PROBE_COPY, type ProbeRef } from '../src/basis';
import type { Shell } from '../src/shellfeatures';
import { createUnbashParser } from '../src/syntax/adapters/unbash';
import { basisGate, basisSaid, fact, type FactId, MESSAGES } from '../src/messages';
import { basisLine, noteBasis } from '../src/ui/render';
import { explain } from './support/explain';
import { BASIS_COPY, basisCopy, PROBE_KINDS, type ProbeKind, readProbeTable } from './support/probe';

type Spec = BasisSpec | ((p: unknown) => BasisSpec | undefined);

/** The params the basis of an entry that depends on them is read with: each case it tells apart. */
const SAMPLES: Partial<Record<FactId, unknown[]>> = {
  'exit-modulo': [{ command: 'exit', value: '300', status: 44, ends: 'shell' }, { command: 'return', value: '300', status: 44, ends: 'function' }],
  'errexit-off-in-substitution': [{ first: 'false', form: '$( )' }, { first: 'false', form: '${ …; }' }],
  'assign-readonly': [{ name: 'x' }, { name: 'x', then: 'runs' }, { name: 'x', then: 'abandons' }, { name: 'x', then: 'subshell' }],
  'unquoted-variable-in-test': [{ bare: '$x' }, { bare: '$x', zsh: true }],
  'nounset-unbound': [
    { v: 'x', name: 'x', exits: 'command', shell: 'bash', environment: 'no' }, { v: 'x', name: 'x', exits: 'script', shell: 'bash', environment: 'no' },
    { v: 'x', name: 'x', exits: 'command', shell: 'dash', environment: 'no' },
  ],
  'variable-not-exported': [{ v: 'a', array: true }, { v: 'a' }],
};

/** The kind of basis an entry gives for each of its samples (or its one spec), `manual` where it gives none. */
const kinds = (id: FactId): string[] => {
  const basis = (MESSAGES[id] as { basis?: Spec }).basis;
  if (!basis) return ['manual'];
  return typeof basis === 'function' ? SAMPLES[id]!.map((p) => basis(p)?.kind ?? 'manual') : [basis.kind];
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
    assert.deepStrictEqual(exit.basis, { kind: 'checked', bash: ['5.2', '5.3'], probes: ['status#exit-status', 'status#exit-negative'] });
    assert.deepStrictEqual(exit.tryIt, { code: "bash -c '(exit 300); echo $?'", output: '44', bash: '5.2', probe: 'status#exit-status' });
    // (`return 300`: 4.1 says that `return` keeps the least significant 8 bits.)
    const ret = fact('en', 'exit-modulo', { command: 'return', value: '300', status: 44, ends: 'function' });
    assert.ok(!('basis' in ret) && !('tryIt' in ret));
    assert.deepStrictEqual(basisFor(ret), { kind: 'manual', sections: ['3.7.5'] });
    assert.deepStrictEqual(basisFor({}), { kind: 'manual', sections: [] });
    const unset = fact('ja', 'unset-function-and-variable');
    assert.deepStrictEqual(unset.basis, { kind: 'checked', bash: ['5.2', '5.3'], probes: ['state#unset-fv'] });
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

  // Step 2: the words of the views, and the setting.
  it('words the chip of `checked` and `differs`, with the releases the try-it passed, and none for the others', () => {
    const checked = { kind: 'checked', bash: ['5.2'], probes: ['status#exit-status'] } as const;
    assert.strictEqual(basisSaid('en', checked)?.label, 'Not in the manual · checked with bash 5.2');
    assert.strictEqual(basisSaid('ja', checked)?.label, 'マニュアルに記述なし・bash 5.2 で確認');
    assert.match(basisSaid('ja', checked)!.title, /^Bash マニュアルに書かれていない bash の実際の動き。/);
    const differs = { kind: 'differs', bash: ['5.2', '5.3'], probes: ['status#exit-status'] } as const;
    assert.deepStrictEqual(basisSaid('en', differs), {
      kind: 'differs', label: 'Differs from the manual · checked with bash 5.2 and 5.3',
      title: "bash's actual behaviour, which differs from what the Bash manual says: checked by running bash 5.2 and 5.3 (messages as with `LC_ALL=C`)",
    });
    assert.deepStrictEqual(basisSaid('ja', differs), {
      kind: 'differs', label: 'マニュアルの記述と異なる・bash 5.2・5.3 で確認',
      title: 'Bash マニュアルの記述とは異なる bash の実際の動き。bash 5.2・5.3 で実行して確かめた（メッセージは `LC_ALL=C` のときのもの）',
    });
    assert.strictEqual(basisSaid('en', { kind: 'manual', sections: ['3.7.5'] }), undefined);
    assert.strictEqual(basisSaid('en', undefined), undefined);
  });

  it('leaves the basis and the try-it out with `notes.basis` off, and only then', () => {
    const exit = fact('en', 'exit-modulo', { command: 'exit', value: '300', status: 44, ends: 'shell' });
    assert.strictEqual(basisGate(exit, true), exit);
    assert.strictEqual(basisGate(exit, undefined), exit);
    const off = basisGate(exit, false);
    assert.ok(!('basis' in off) && !('tryIt' in off) && off.text === exit.text);
    const plain = fact('en', 'exit-modulo', { command: 'return', value: '300', status: 44, ends: 'function' });
    assert.strictEqual(basisGate(plain, false), plain);
  });

  it('marks a note in the views only where it is not the manual\'s, and says it in one line for the outputs with no chip', () => {
    const ex = explain('f() { return 300; }; exit 300', 0);
    const [ret, exit] = ex.notes;
    assert.strictEqual(noteBasis(ex, ret, 'en'), undefined);
    const b = noteBasis(ex, exit, 'en')!;
    assert.deepStrictEqual(b.tryIt, { code: "bash -c '(exit 300); echo $?'", output: '44' });
    assert.strictEqual(basisLine('en', b, (s) => `[${s}]`), "Not in the manual · checked with bash 5.2 and 5.3 · Try it in your terminal: [bash -c '(exit 300); echo $?'] → [44]");
    assert.strictEqual(noteBasis({ ...ex, facts: undefined }, exit, 'en'), undefined);
  });

  // Step 3: the catalog, section by section against the manual (the audit is in the PR of step 3, #PR).
  it('gives the basis the audit found, per case of the params', () => {
    const audit: Partial<Record<FactId, string[]>> = {
      'exit-modulo': ['checked', 'manual'],
      'errexit-off-in-substitution': ['manual', 'checked'],
      'keyword-needs-separator': ['checked'],
      'bracket-missing-close': ['checked'],
      'bracket-close-glued': ['checked'],
      'test-malformed': ['differs'],
      'unset-function-and-variable': ['checked'],
      'unset-readonly': ['checked'],
      'assign-readonly': ['manual', 'differs', 'checked', 'checked'],
      'restricted-refused': ['checked'],
      'posix-special-function-name': ['checked'],
      'posix-special-function-name-maybe': ['checked'],
      'extglob-in-same-block': ['checked'],
      'extglob-maybe-on': ['checked'],
      'extglob-turned-off': ['checked'],
      'extglob-not-found': ['checked'],
      'extglob-maybe-on-trap': ['checked'],
      'extglob-not-in-new-shell': ['checked'],
      'variable-not-exported': ['checked', 'manual'],
      'bash-subshell-not-counted': ['differs'],
      'array-joined-in-assignment': ['checked'],
      'unquoted-variable-in-test': ['differs', 'manual'],
      'nounset-unbound': ['differs', 'manual', 'manual'],
    };
    for (const id of Object.keys(MESSAGES) as FactId[]) assert.deepStrictEqual(kinds(id), audit[id] ?? ['manual'], id);
  });

  it('lists the releases each try-it passed in: bash 5.3 too where it prints the same, and only 5.3 for its constructs', () => {
    assert.deepStrictEqual(fact('en', 'errexit-off-in-substitution', { first: 'false', form: '${ …; }' }).basis, { kind: 'checked', bash: ['5.3'], probes: ['status#funsub-errexit'] });
    assert.deepStrictEqual(fact('en', 'test-malformed', { name: '[' }).basis, { kind: 'differs', bash: ['5.2', '5.3'], probes: ['state#test-malformed'] });
    assert.strictEqual(basisSaid('en', fact('en', 'test-malformed', { name: '[' }).basis)?.label, 'Differs from the manual · checked with bash 5.2 and 5.3');
  });

  it('says that bash does not count the subshell of a simple command in a pipeline in `$BASH_SUBSHELL`', () => {
    const noted = (src: string, shell?: Shell) => (new Analyzer('en').explainLine(createUnbashParser().parse(src), 0, shell).facts ?? []).some((f) => f.id === 'bash-subshell-not-counted');
    for (const src of ['echo "$BASH_SUBSHELL" | cat', 'echo ${BASH_SUBSHELL:-0} | cat', 'cat </dev/null | echo $BASH_SUBSHELL', 'x=$(echo $BASH_SUBSHELL | cat)', 'echo $(( BASH_SUBSHELL + 1 )) | cat']) assert.ok(noted(src), src);
    // (A group in a pipeline is counted; so is `$( )`, `( )` and `&`; and the shell itself is 0. A function called in a
    // stage is not said.)
    for (const src of ['{ echo $BASH_SUBSHELL; } | cat', 'f() { echo $BASH_SUBSHELL; }; f | cat', 'y=$(echo $BASH_SUBSHELL) | cat', '(echo $BASH_SUBSHELL)', 'echo $BASH_SUBSHELL', 'echo $BASHPID | cat', 'echo ${#BASH_SUBSHELL} | cat']) assert.ok(!noted(src), src);
    // (Only bash has it; with lastpipe on, the last stage runs in the shell.)
    assert.ok(noted('echo $BASH_SUBSHELL | cat', 'bash'));
    assert.ok(!noted('echo $BASH_SUBSHELL | cat', 'sh'));
    assert.ok(!noted('shopt -s lastpipe; cat </dev/null | echo $BASH_SUBSHELL'));
    const f = explain('echo $BASH_SUBSHELL | cat').facts!.find((x) => x.id === 'bash-subshell-not-counted')!;
    assert.deepStrictEqual(f.basis, { kind: 'differs', bash: ['5.2', '5.3'], probes: ['words#bash-subshell-stage'] });
    assert.deepStrictEqual(f.refs, ['5.2', '3.2.3']);
  });
});