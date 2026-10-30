// What an explanation rests on (src/basis.ts, docs/design/basis.md): the facts of the catalog that are bash's
// behaviour name a probe row with a try-it, the row is in the copy the explanations read (src/basis-probes.json, the
// same as the tables say), and every try-it of the tables is shown by some fact. test/probe.test.ts runs the try-its
// in bash; here nothing runs bash.
import * as assert from 'assert';
import * as fs from 'fs';
import { Analyzer } from '../src/analyzer';
import type { Token } from '../src/analyzer-types';
import { type Basis, basisFor, basisOf, type BasisSpec, PROBE_COPY, type ProbeRef, tokenBasisFor } from '../src/basis';
import { type Convention, CONVENTIONS, type ConventionId } from '../src/conventions';
import { documentIssues, explainDocumentLine } from '../src/document';
import { openDocument } from '../src/document-setup';
import { explainHostedLine, extractShell } from '../src/hosts';
import { SECTIONS } from '../src/manual';
import { STYLE_CONVENTIONS, STYLE_LEVELS, STYLE_REFS } from '../src/pitfalls';
import type { Shell } from '../src/shellfeatures';
import { createUnbashParser } from '../src/syntax/adapters/unbash';
import { basisGate, basisSaid, fact, type FactId, MESSAGES } from '../src/messages';
import { readingNodes } from '../src/reading';
import { TOKEN_BASES, type TokenBasisId } from '../src/tokenbases';
import { basisLine, basisMarkdown, noteBasis, partBasis, toPlainMarkdown, withBasisShown } from '../src/ui/render';
import { allTokens, explain } from './support/explain';
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
  'array-joined-in-assignment': [
    { v: 'v', op: '=', word: '$@', args: true, rewrite: [] }, { v: 'v', op: '=', word: '${a[@]}', args: false, rewrite: [] },
  ],
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

  it('names rows that exist, the first with a try-it about a section the fact cites; and every try-it is shown by a fact or a token', () => {
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
    // (A token's text: its row need not be about a section the token cites, as a token cites its construct's, 3.4 for
    // an assignment; its sample, below, shows that the token has it.)
    for (const [id, spec] of Object.entries(TOKEN_BASES) as [TokenBasisId, BasisSpec][]) {
      assert.ok(PROBE_COPY[spec.probe], `${id}: ${spec.probe} has no try-it in the copy`);
      for (const ref of spec.also ?? []) assert.ok(rowExists(ref), `${id}: no row ${ref}`);
      shown.add(spec.probe);
    }
    assert.deepStrictEqual(Object.keys(PROBE_COPY).filter((k) => !shown.has(k)), [], 'a try-it no fact or token shows');
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

  // Step 3: the catalog, section by section against the manual (the audit is in the PR of step 3, #447).
  it('gives the basis the audit found, per case of the params', () => {
    const audit: Partial<Record<FactId, string[]>> = {
      'exit-modulo': ['checked', 'manual'],
      'errexit-off-in-substitution': ['manual', 'checked'],
      'keyword-needs-separator': ['checked'],
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
      'array-joined-in-assignment': ['manual', 'checked'],
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
    for (const src of ['echo "$BASH_SUBSHELL" | cat', 'eval "echo $BASH_SUBSHELL" | cat', 'f "$BASH_SUBSHELL" | cat', 'echo ${BASH_SUBSHELL:-0} | cat', 'cat </dev/null | echo $BASH_SUBSHELL', 'x=$(echo $BASH_SUBSHELL | cat)', 'echo $(( BASH_SUBSHELL + 1 )) | cat']) assert.ok(noted(src), src);
    // (A group in a pipeline is counted; so is `$( )`, `( )` and `&`; and the shell itself is 0. What the stage's command
    // runs, a function's body, an `eval` string or a trap's action, sees the subshell counted: a row of words.json checks that bash prints 1 there.)
    for (const src of ['{ echo $BASH_SUBSHELL; } | cat', 'f() { echo $BASH_SUBSHELL; }; f | cat', "eval 'echo $BASH_SUBSHELL' | cat", "trap 'echo $BASH_SUBSHELL' EXIT | cat", 'y=$(echo $BASH_SUBSHELL) | cat', '(echo $BASH_SUBSHELL)', 'echo $BASH_SUBSHELL', 'echo $BASHPID | cat', 'echo ${#BASH_SUBSHELL} | cat']) assert.ok(!noted(src), src);
    // (Only bash has it; with lastpipe on, the last stage runs in the shell.)
    assert.ok(noted('echo $BASH_SUBSHELL | cat', 'bash'));
    assert.ok(!noted('echo $BASH_SUBSHELL | cat', 'sh'));
    assert.ok(!noted('shopt -s lastpipe; cat </dev/null | echo $BASH_SUBSHELL'));
    const f = explain('echo $BASH_SUBSHELL | cat').facts!.find((x) => x.id === 'bash-subshell-not-counted')!;
    assert.deepStrictEqual(f.basis, { kind: 'differs', bash: ['5.2', '5.3'], probes: ['words#bash-subshell-stage'] });
    assert.deepStrictEqual(f.refs, ['5.2', '3.2.3']);
  });

  // Step 4: the texts of tokens (src/tokenbases.ts), audited against the manual (the audit is in the PR of step 4).
  /** A line where a token shows each entry's text: the line, its number (0-based), and the token's label. */
  const TOKEN_SAMPLES: Record<TokenBasisId, [string, number, string]> = {
    'underscore-after-assignment': ['a=1; echo "$_"', 0, '$_'],
    'columns-from-environment': ['echo "$COLUMNS"', 0, '$COLUMNS'],
    'rematch-empty-after-failure': ['echo "$BASH_REMATCH"', 0, '$BASH_REMATCH'],
    'bash-source-file': ['echo "${BASH_SOURCE[0]}"', 0, 'BASH_SOURCE'],
    'histfile-script': ['echo "$HISTFILE"', 0, '$HISTFILE'],
    'opterr-default': ['echo "$OPTERR"', 0, '$OPTERR'],
    'random-seed-repeats': ['RANDOM=7', 0, 'RANDOM=7'],
    'dot-posix-status': ['set -o posix\n. ./lib.sh', 1, '.'],
    'xtracefd-old-stays-open': ['BASH_XTRACEFD=7', 0, 'BASH_XTRACEFD=7'],
    'funcnest-status': ['FUNCNEST=10', 0, 'FUNCNEST=10'],
    'path-forgets-hash': ['PATH=/x:$PATH', 0, 'PATH=/x:$PATH'],
    'pwd-variable-only': ['PWD=/x', 0, 'PWD=/x'],
    'posixly-correct-unset': ['POSIXLY_CORRECT=1', 0, 'POSIXLY_CORRECT=1'],
    'local-special-plain': ['f() { local RANDOM=3; }', 0, 'RANDOM=3'],
    'ignored.LINENO': ['LINENO=5', 0, 'LINENO=5'],
    'ignored.BASH_COMMAND': ['BASH_COMMAND=x', 0, 'BASH_COMMAND=x'],
    'readonly-abandons': ['UID=0', 0, 'UID=0'],
    'readonly-subshell': ['(UID=0; echo in)', 0, 'UID=0'],
    'readonly-prefix-runs': ['UID=0 echo hi', 0, 'UID=0'],
    'bash-refuses-option': ['bash -x --posix -c true', 0, '--posix'],
    'bash-lone-plus': ["bash + -c 'echo ran'", 0, '+'],
    'alias-invalid-name': ['alias a/b=x', 0, 'a/b=x'],
    'alias-no-name': ['alias =x', 0, '=x'],
    'alias-in-alias-blank': ["shopt -s expand_aliases\nalias t=s s='echo '\nt w", 2, 't'],
    'array-at-subscript': ['a[@]=x', 0, 'a[@]=x'],
    'export-subscript-refused': ['export e[1]', 0, 'e[1]'],
    'declare-p-subscript': ['declare -p a[1]', 0, 'a[1]'],
    'assoc-missing-subscript': ['declare -A m=([a]=1 b)', 0, 'b'],
    'array-brace-value': ['x=([4]={a,b})', 0, '[4]={a,b}'],
    'assoc-tilde': ['declare -A m=(k ~)', 0, '~'],
    'kill-posix-sig': ['set -o posix\nkill -SIGTERM $$', 1, '-SIGTERM'],
    'posix-indirect-hash': ['set -o posix\necho "${!#}"', 1, '${!#}'],
    'trap-posix-signal': ['set -o posix\ntrap INT', 1, 'INT'],
    'time-alone': ['time', 0, 'time'],
    'arith-syntax-abandons': ['echo $((1 +)); ((2 *))', 0, '1 +'],
  };

  it('gives the tokens whose text states bash\'s behaviour the basis the audit found, and Reading\'s nodes too', () => {
    const audit: Record<TokenBasisId, string> = {
      'underscore-after-assignment': 'checked', 'columns-from-environment': 'checked', 'rematch-empty-after-failure': 'checked',
      'bash-source-file': 'checked', 'histfile-script': 'checked', 'opterr-default': 'checked', 'random-seed-repeats': 'checked', 'dot-posix-status': 'checked',
      'xtracefd-old-stays-open': 'differs', 'funcnest-status': 'checked', 'path-forgets-hash': 'checked', 'pwd-variable-only': 'checked',
      'posixly-correct-unset': 'checked', 'local-special-plain': 'checked', 'ignored.LINENO': 'checked', 'ignored.BASH_COMMAND': 'checked',
      'readonly-abandons': 'checked', 'readonly-subshell': 'checked', 'readonly-prefix-runs': 'differs', 'bash-refuses-option': 'checked',
      'bash-lone-plus': 'checked', 'alias-invalid-name': 'checked', 'alias-no-name': 'checked', 'alias-in-alias-blank': 'differs',
      'array-at-subscript': 'checked', 'export-subscript-refused': 'checked', 'declare-p-subscript': 'checked', 'assoc-missing-subscript': 'checked',
      'array-brace-value': 'checked', 'assoc-tilde': 'differs', 'kill-posix-sig': 'checked', 'posix-indirect-hash': 'checked',
      'trap-posix-signal': 'checked', 'time-alone': 'checked', 'arith-syntax-abandons': 'checked',
    };
    assert.deepStrictEqual(Object.fromEntries(Object.entries(TOKEN_BASES).map(([id, spec]) => [id, spec.kind])), audit);
    assert.deepStrictEqual(Object.keys(TOKEN_SAMPLES).sort(), Object.keys(TOKEN_BASES).sort());
    for (const [id, [src, line, label]] of Object.entries(TOKEN_SAMPLES) as [TokenBasisId, [string, number, string]][]) {
      const spec: BasisSpec = TOKEN_BASES[id];
      for (const lang of ['en', 'ja'] as const) {
        const ex = explain(src, line, lang, { reading: true });
        const tok = allTokens(ex.items).find((t) => t.label === label && t.tryIt?.probe === spec.probe);
        assert.ok(tok, `${id} (${lang}): no token \`${label}\` with ${spec.probe}: ${allTokens(ex.items).map((t) => t.label).join(' ')}`);
        assert.deepStrictEqual(tok.basis, basisOf(spec).basis, id);
        const node = readingNodes(ex.reading!).find((n) => n.label === label && n.text === tok.explanation);
        assert.deepStrictEqual([node?.basis, node?.tryIt], [tok.basis, tok.tryIt], `${id} (${lang}): Reading's node`);
      }
    }
    // (Not where the text is not said: `$_` after a command with arguments, `PATH` for one command, `time` with a
    // pipeline, a variable whose text the manual states, the declaration that makes a variable read-only.)
    // (A program's spec, step 5a, is not such a basis: `ls`.)
    for (const src of ['true x; echo "$_"', 'PATH=/x cmd', 'time ls', 'echo "$HOME"', 'readonly x=1', 'BASHPID=1']) {
      assert.deepStrictEqual(allTokens(explain(src).items).filter((t) => (t.basis && t.basis.kind !== 'spec') || t.tryIt).map((t) => t.label), [], src);
    }
  });

  it('leaves the tokens\' basis and try-it out with `notes.basis` off', () => {
    const ex = explain('UID=0; echo "$COLUMNS"', 0, 'en', { reading: true, basis: false });
    assert.deepStrictEqual(allTokens(ex.items).filter((t) => t.basis || t.tryIt), []);
    assert.deepStrictEqual(readingNodes(ex.reading!).filter((n) => n.basis || n.tryIt), []);
  });

  it('marks a token in the views as a note: the panel\'s rows and Reading, Markdown', () => {
    const ex = explain('BASH_XTRACEFD=7; echo "$HOME"', 0, 'en', { reading: true });
    const tok = allTokens(ex.items).find((t) => t.label === 'BASH_XTRACEFD=7')!;
    const b = partBasis(tok, 'en')!;
    assert.strictEqual(b.label, 'Differs from the manual · checked with bash 5.2 and 5.3');
    assert.deepStrictEqual(b.tryIt, { code: PROBE_COPY['state#xtracefd-old-open'].try.code, output: 'fd 3 is still open' });
    assert.strictEqual(partBasis(allTokens(ex.items).find((t) => t.label === '$HOME')!, 'en'), undefined);
    // (A basis of the manual's with a try-it: none shown, as for a note.)
    assert.strictEqual(partBasis({ tryIt: tok.tryIt }, 'en'), undefined);
    const shown = withBasisShown(ex, 'ja');
    const row = allTokens(shown.items).find((t) => t.label === 'BASH_XTRACEFD=7') as { basisShown?: { label: string } };
    assert.strictEqual(row.basisShown?.label, 'マニュアルの記述と異なる・bash 5.2・5.3 で確認');
    const node = readingNodes(shown.reading!).find((n) => n.label === 'BASH_XTRACEFD=7' && n.basis) as { basisShown?: { label: string } };
    assert.strictEqual(node.basisShown?.label, 'マニュアルの記述と異なる・bash 5.2・5.3 で確認');
    assert.ok(!('basisShown' in allTokens(shown.items).find((t) => t.label === '$HOME')!));
    // (Without Reading, the rows only; a line with nothing to show is sent as it is.)
    assert.ok(!('reading' in withBasisShown(explain('BASH_XTRACEFD=7'), 'en')));
    const plain = explain('echo hi', 0, 'en', { reading: true });
    assert.strictEqual(withBasisShown(plain, 'en'), plain);
    assert.strictEqual(basisMarkdown(tok, 'en', '  '), `\\\n  _${basisLine('en', b, (c) => `\`${c}\``)}_`);
    assert.strictEqual(basisMarkdown({}, 'en', '  '), '');
    assert.match(toPlainMarkdown(ex, 'BASH_XTRACEFD=7', 'x.sh:1'), /- `BASH_XTRACEFD=7` — .*\\\n +_Differs from the manual · checked with bash 5\.2 and 5\.3 · Try it in your terminal: `bash -c '[^`]*'` → `fd 3 is still open`_/);
  });

  /** Each token of `items`, with the tokens above it (the outermost first). */
  const withAbove = (items: readonly Token[], above: readonly Token[] = []): [Token, readonly Token[]][] =>
    items.flatMap((t) => [[t, above] as [Token, readonly Token[]], ...withAbove(t.children, [...above, t])]);
  /** What each token rests on by `tokenBasisFor`, as `label: kind command` (the spec) or `label: manual`. */
  const rests = (src: string, line = 0, opts?: Parameters<typeof explain>[3]) => withAbove(explain(src, line, 'en', opts).items).map(([t, above]) => {
    const b = tokenBasisFor(t, above);
    return `${t.label}: ${b.kind === 'spec' ? `spec ${b.command}` : b.kind}`;
  });
  const spec = (command: string): Basis => ({ kind: 'spec', command });

  it('gives a program\'s command token the spec it reads its words with, and the tokens it reads rest on it by the rule (step 5a)', () => {
    const ex = explain('grep -rn "a+" .', 0, 'en', { reading: true });
    // (Only the command's token holds it: the others rest on it by `tokenBasisFor`.)
    assert.deepStrictEqual(allTokens(ex.items).filter((t) => t.basis).map((t) => [t.label, t.basis]), [['grep', spec('grep')]]);
    assert.deepStrictEqual(rests('grep -rn "a+" .'), [
      'grep: spec grep', '-rn: spec grep', '-r: spec grep', '-n: spec grep', '"a+": spec grep', '"a+": manual', 'a: spec grep', '+: spec grep', '.: spec grep',
    ]);
    // (Reading copies it to the node of the command's name.)
    assert.deepStrictEqual(readingNodes(ex.reading!).filter((n) => n.basis).map((n) => [n.kind, n.label, n.basis]), [['commandName', 'grep', spec('grep')]]);
    // By the dictionary's name: a path, a name the dictionary reads as another, a program `hash -p` or `enable -n` names,
    // a shell read with the options of `sh` (`zsh`, `posh`: sh's entry), the program of a builtin's name.
    for (const [src, line, command] of [
      ['/bin/sed -n p f', 0, 'sed'], ['egrep x f', 0, 'grep'], ['hash -p /bin/ls l\nl -l', 1, 'ls'], ['enable -n echo\necho hi', 1, 'echo'],
      ['dash -c ls', 0, 'sh'], ['/bin/zsh -c ls', 0, 'sh'], ['mksh -c ls', 0, 'sh'], ['posh -c ls', 0, 'sh'], ['/bin/kill -9 1', 0, 'kill'],
    ] as const) {
      assert.deepStrictEqual(explain(src, line).items.map((t) => t.basis), [spec(command)], src);
    }
    // A command another runs has its own spec (`rm`), not that of the command that runs it; bash's are the manual's.
    assert.deepStrictEqual(rests('sudo rm -rf x'), ['sudo: spec sudo', 'rm: spec rm', '-rf: spec rm', '-r: spec rm', '-f: spec rm', 'x: spec rm']);
    // (One with no spec of its own, and its words, are the manual's, as when bash runs it: never its runner's spec.)
    assert.deepStrictEqual(rests('env X=1 bash -c ls').slice(0, 5), ['env: spec env', 'X=1: spec env', 'bash: manual', '-c: manual', 'ls: manual']);
    assert.deepStrictEqual(rests('sudo bash -c ls').slice(0, 3), ['sudo: spec sudo', 'bash: manual', '-c: manual']);
    assert.deepStrictEqual(rests('sudo frobnicate -x'), ['sudo: spec sudo', 'frobnicate: manual', '-x: manual']);
    assert.deepStrictEqual(rests('frobnicate -x'), ['frobnicate: manual', '-x: manual']);
    assert.deepStrictEqual(rests('f() { :; }\ntimeout 5 f -x', 1), ['timeout: spec timeout', '5: spec timeout', 'f: manual', '-x: manual']);
    assert.deepStrictEqual(rests('f() { :; }\nxargs f -x', 1), ['xargs: spec xargs', 'f: manual', '-x: manual']);
    assert.deepStrictEqual(rests('xargs printf "%s"').filter((r) => r.startsWith('%s') || r.startsWith('printf')), ['printf: spec printf', '%s: spec printf']);
    // (The regex of `=~` is bash's; that of `grep -E` grep's, in a word of several parts too.)
    assert.deepStrictEqual(rests('[[ x =~ a+ ]]').filter((r) => /^(a|\+):/.test(r)), ['a: manual', '+: manual']);
    assert.deepStrictEqual(rests('grep -E x"a+" f').filter((r) => /^(x|a|\+):/.test(r)), ['x: manual', 'x: spec grep', 'a: spec grep', '+: spec grep']);
    // (The tokens of an embedded language rest on its command, under its tokens of kind `command` too: sed's `/x/d`,
    // awk's `getline x`, perl's `print`.)
    assert.deepStrictEqual(rests("sed -e '/x/d' f").filter((r) => !r.startsWith("'")), [
      'sed: spec sed', '-e: spec sed', '/x/d: spec sed', '/x/: spec sed', 'x: spec sed', 'd: spec sed', 'f: spec sed',
    ]);
    assert.deepStrictEqual(rests("awk '{print $1; getline x}' f").filter((r) => !r.startsWith("'")), [
      'awk: spec awk', '{print $1; getline x}: spec awk', 'print $1: spec awk', '$1: spec awk', 'getline x: spec awk', 'getline: spec awk', 'f: spec awk',
    ]);
    assert.ok(rests("perl -ne 'print if /x/' f").filter((r) => !r.startsWith("'")).every((r) => r.endsWith('spec perl')));
  });

  it('gives no spec to a builtin, bash, a function, an alias, an unknown or a custom command; bats\' own commands have bats\'', () => {
    const none = (src: string, line = 0, opts?: Parameters<typeof explain>[3]) => {
      assert.deepStrictEqual(allTokens(explain(src, line, 'en', opts).items).filter((t) => t.basis).map((t) => t.label), [], src);
      assert.ok(rests(src, line, opts).every((r) => !r.includes('spec')), `${src}: ${rests(src, line, opts).join(', ')}`);
    };
    none('read -r x');
    none("bash -c 'echo hi'");
    none('/bin/bash --posix x.sh');
    none("bash5.2 -c 'echo hi'");
    none("/bin/rbash -c 'echo hi'");
    none('f() { :; }\nf -x', 1);
    none("shopt -s expand_aliases\nalias l='ls -l'\nl /", 2);
    none('shopt -s expand_aliases\nalias e=echo\ne hi', 2);
    none('frobnicate --x y');
    none('hash -p /opt/frob f\nf -x', 1);
    none('grep -n x f', 0, { customCommands: { grep: { summary: 'My grep' } } });
    none('builtin ls');
    none('command cd /');
    assert.deepStrictEqual(rests('sudo "$cmd" x'), ['sudo: spec sudo', '"$cmd": manual', 'x: manual']);
    assert.ok(!allTokens(explain('sudo "$cmd" x').items[0].children).some((t) => t.basis));
    assert.deepStrictEqual(rests('sudo tool -a x', 0, { customCommands: { tool: { summary: 'T' } } }), ['sudo: spec sudo', 'tool: manual', '-a: manual', 'x: manual']);
    // (An alias explained as the command it runs, with its words after the alias's, says that command's spec.)
    assert.deepStrictEqual(explain("shopt -s expand_aliases\nalias ls='ls -F'\nls /", 2).items[0].basis, spec('ls'));
    const lines = ['@test "a" {', '  run grep -n x f', '}'];
    const extracted = extractShell('bats', lines.join('\n'));
    const ex = explainHostedLine(new Analyzer('en'), createUnbashParser().parse(extracted.text), extracted, lines, 1, 'en')!;
    assert.deepStrictEqual(allTokens(ex.items).filter((t) => t.basis).map((t) => [t.label, t.basis]), [['run', spec('run')], ['grep', spec('grep')]]);
  });

  it('gives an alias the spec its arguments are read with, as the command it runs would have (decision of 2026-10-28)', () => {
    const on = 'shopt -s expand_aliases\n';
    const basisOf1 = (src: string, opts?: Parameters<typeof explain>[3]) => allTokens(explain(src, src.split('\n').length - 1, 'en', opts).items).filter((t) => t.basis).map((t) => [t.label, t.basis]);
    // An alias to a program: on its token only, the words it reads rest on it (`tokenBasisFor`).
    assert.deepStrictEqual(basisOf1(`${on}alias g=grep\ng -rn x .`), [['g', spec('grep')]]);
    assert.deepStrictEqual(rests(`${on}alias g=grep\ng -rn x .`, 2).slice(0, 3), ['g: spec grep', '-rn: spec grep', '-r: spec grep']);
    // By the dictionary's name: a path, an alias to an alias.
    assert.deepStrictEqual(basisOf1(`${on}alias g=/bin/grep\ng -n x f`), [['g', spec('grep')]]);
    assert.deepStrictEqual(basisOf1(`${on}alias a=b b=egrep\na -n x f`), [['a', spec('grep')]]);
    // Reading copies it to the node of the alias's name.
    const ex = explain(`${on}alias g=grep\ng -n x f`, 2, 'en', { reading: true });
    assert.deepStrictEqual(readingNodes(ex.reading!).filter((n) => n.basis).map((n) => [n.label, n.basis]), [['g', spec('grep')]]);
    // An alias to a builtin (its options are the manual's), to bash, to a function, to a command the dictionary does not
    // know: none, as for the name itself.
    for (const src of [`${on}alias e=echo\ne -n hi`, `${on}alias a=b b=echo\na hi`, `${on}alias b=bash\nb --posix x`, `${on}f() { :; }\nalias g=f\ng -x`, `${on}alias g=frob\ng -x`]) {
      assert.deepStrictEqual(basisOf1(src), [], src);
    }
    // An alias with options in its text (`alias ll='ls -l'`): its words go after those and no spec reads them, so none. One
    // named as its command (`alias ls='ls -F'`) is that command.
    assert.deepStrictEqual(basisOf1(`${on}alias ll='ls -l'\nll -a`), []);
    assert.deepStrictEqual(basisOf1(`${on}alias ls='ls -F'\nls -a`), [['ls', spec('ls')]]);
    // Not in effect: no expand_aliases in a script (the name is "command not found"), or not on every path.
    assert.deepStrictEqual(basisOf1('alias g=grep\ng -n x f'), []);
    assert.deepStrictEqual(basisOf1('shopt -u expand_aliases\nalias g=grep\ng -n x f'), []);
    assert.deepStrictEqual(basisOf1('if [ -n "$A" ]; then shopt -s expand_aliases; fi\nalias g=grep\ng -n x f'), []);
    // The command an alias to a wrapper runs has its own.
    assert.deepStrictEqual(basisOf1(`${on}alias s=sudo\ns rm -rf x`), [['s', spec('sudo')], ['rm', spec('rm')]]);
    // Setting off: none.
    assert.deepStrictEqual(basisOf1(`${on}alias g=grep\ng -n x f`, { basis: false }), []);
    // What `hash -p` or `enable -n` makes the alias's word run, as for the name itself (bash: `type -P grep` is the hashed path,
    // `type -t echo` is `file` after `enable -n echo`, and `e --help` prints coreutils' usage).
    assert.deepStrictEqual(basisOf1(`${on}alias g=grep\nhash -p /opt/frob grep\ng -n x f`), [], 'hashed to a file the dictionary does not know');
    assert.deepStrictEqual(basisOf1(`${on}alias g=grep\nhash -p /usr/bin/egrep grep\ng -n x f`), [['g', spec('grep')]], 'hashed to a program it knows');
    assert.deepStrictEqual(basisOf1(`${on}enable -n echo\nalias e=echo\ne -n hi`), [['e', spec('echo')]], 'the program of a builtin turned off');
    assert.deepStrictEqual(basisOf1(`${on}alias g=grep\nhash -p /bin/ls grep\ng -n x f`), [['g', spec('ls')]], 'hashed to another program: its spec');
    for (const src of [`${on}alias g=grep\nhash -p /bin/ls grep\ng -n x f`, `${on}enable -n echo\nalias e=echo\ne -n hi`]) {
      // (The same line direct: the words are read with the spec of the same program, not with the spec of the alias's word.)
      const direct = explain(src.replace(/alias (\w)=(\w+)\n/, '').replace(/\n[ge] /, (m) => `\n${src.includes('echo') ? 'echo' : 'grep'} `), src.split('\n').length - 2, 'en').items;
      const viaAlias = explain(src, src.split('\n').length - 1, 'en').items;
      const opts = (ts: Token[]) => allTokens(ts).filter((t) => t.kind === 'option').map((t) => t.explanation);
      assert.deepStrictEqual(opts(viaAlias), opts(direct), src);
    }
    // (A hashed file the dictionary does not know: grep's `-n` is not read; the word is the alias text's.)
    const frob = allTokens(explain(`${on}alias g=grep\nhash -p /opt/frob grep\ng -n x f`, 3, 'en').items).find((t) => t.label === '-n')!;
    assert.match(frob.explanation, /^A word passed on to `grep`/);
    // The alias token says what runs, as the name itself does (`Run the external command … (`hash -p` on line N gave …)`).
    const said = (src: string, lang: 'en' | 'ja') => allTokens(explain(src, src.split('\n').length - 1, lang).items).find((t) => t.kind === 'alias')!.explanation;
    const hashedSrc = `${on}alias g=grep\nhash -p /opt/frob grep\ng -n x f`;
    const offSrc = `${on}enable -n echo\nalias e=echo\ne -n hi`;
    assert.strictEqual(said(hashedSrc, 'en'), 'The alias `g` defined on line 2: replaced by `grep` (`hash -p` on line 3 gave `grep` the path `/opt/frob`)');
    assert.strictEqual(said(hashedSrc, 'ja'), 'このスクリプトの行 2 で定義したエイリアス `g`: `grep` に置き換わる（行 3 の `hash -p` で `grep` は `/opt/frob` を指す）');
    assert.strictEqual(said(offSrc, 'en'), 'The alias `e` defined on line 3: replaced by `echo` (`enable -n` on line 2 turned the builtin `echo` off)');
    assert.strictEqual(said(offSrc, 'ja'), 'このスクリプトの行 3 で定義したエイリアス `e`: `echo` に置き換わる（行 2 の `enable -n` で組み込みの `echo` は無効になっている）');
    // One bracket, not two, when the alias is for an alias and the name was hashed: "(`b` is an alias too, …; `hash -p` …)".
    const chainSrc = `${on}alias a=b b=grep\nhash -p /opt/frob grep\na -n x f`;
    assert.strictEqual(said(chainSrc, 'en'), 'The alias `a` defined on line 2: replaced by `b` (`b` is an alias too, for `grep`; `hash -p` on line 3 gave `grep` the path `/opt/frob`)');
    assert.strictEqual(said(chainSrc, 'ja'), 'このスクリプトの行 2 で定義したエイリアス `a`: `b` に置き換わる（`b` もエイリアスで、`grep` に置き換わる。行 3 の `hash -p` で `grep` は `/opt/frob` を指す）');
    // A word the dictionary lacks, after `hash -p` to a file it does not know, points to the manual of that file, as the path written out does.
    const lacks = (src: string): string => allTokens(explain(src, src.split('\n').length - 1, 'en').items).find((t) => t.label === '-n')!.explanation;
    assert.strictEqual(lacks('hash -p /opt/frob grep\ngrep -n x f'), 'Option (not in the dictionary; see `man frob`)');
    assert.strictEqual(lacks('/opt/frob -n x f'), 'Option (not in the dictionary; see `man frob`)');
    assert.strictEqual(lacks('hash -p /bin/ls grep\ngrep -n x f'), lacks('/bin/ls -n x f'));
    // (The same words as the name run directly.)
    const direct = explain(`enable -n echo\necho -n hi`, 1, 'en').items[0].explanation;
    assert.match(direct, /\(`enable -n` on line 1 turned the builtin `echo` off\)/);
    assert.strictEqual(said(`${on}alias g=grep\ng -n x f`, 'en'), 'The alias `g` defined on line 2: replaced by `grep`');
    // Not when the hashed path is on some paths only (`hash -p` in a branch): `grep` may run `/opt/frob`, so no one spec
    // reads the words, and the alias's text says so.
    const branch = `${on}alias g=grep\nif [ -n "$A" ]; then hash -p /opt/frob grep; fi\ng -n x f`;
    assert.deepStrictEqual(basisOf1(branch), []);
    assert.strictEqual(said(branch, 'en'), 'The alias `g` defined on line 2: replaced by `grep` (if the `hash -p` on line 3 ran, `grep` runs the path `/opt/frob` instead)');
  });

  it('keeps a token\'s own basis over the spec, and gives none with `notes.basis` off; no view shows `spec`', () => {
    const tok = allTokens(explain('alias a/b=x').items).find((t) => t.label === 'a/b=x')!;
    assert.strictEqual(tokenBasisFor(tok, []).kind, 'checked');
    const grep = { kind: 'command', origin: 'shell', basis: spec('grep') };
    const own = basisOf(TOKEN_BASES['bash-refuses-option']).basis!;
    assert.strictEqual(tokenBasisFor({ kind: 'option', origin: 'argv', basis: own }, [grep]), own);
    assert.deepStrictEqual(tokenBasisFor({ kind: 'option', origin: 'argv', refs: ['4.2'] }, []), { kind: 'manual', sections: ['4.2'] });
    assert.deepStrictEqual(tokenBasisFor({ kind: 'option', origin: 'argv' }, [grep, { kind: 'option', origin: 'argv' }]), spec('grep'));
    const off = explain('sudo grep -n x f', 0, 'en', { reading: true, basis: false });
    assert.deepStrictEqual(allTokens(off.items).filter((t) => t.basis), []);
    assert.deepStrictEqual(readingNodes(off.reading!).filter((n) => n.basis), []);
    // (`partBasis` and `basisSaid` show `checked` and `differs` only: a line with a spec only is sent as it is.)
    const ex = explain('grep -n x f', 0, 'en', { reading: true });
    assert.strictEqual(partBasis(ex.items[0], 'en'), undefined);
    assert.strictEqual(basisSaid('ja', spec('grep')), undefined);
    assert.strictEqual(withBasisShown(ex, 'en'), ex);
    assert.doesNotMatch(toPlainMarkdown(ex, 'grep -n x f', 'x.sh:1'), /manual ·|Try it/);
  });
});

// Step 5b (docs/design/basis-spec-convention.md): the habit a note's advice is, beside its basis, from
// src/conventions.ts; and the sections of the style checks.
describe('conventions: the habit a note recommends', () => {
  const parser = createUnbashParser();
  const conventionOfEntry = (id: FactId) => (MESSAGES[id] as { convention?: ConventionId }).convention;

  // The audit of section 2.3: every pitfall of the catalog and every style check is a fact, or a fact whose advice is a
  // habit (sorted "both"): then the id of its habit. A new pitfall or style check must be sorted here.
  it('sorts every pitfall and every style check as the audit did: a fact, or the habit its advice is', () => {
    const both: Partial<Record<FactId, ConventionId>> = {
      'declaration-masks-status': 'declare-then-assign',
      'pipefail-missing': 'pipefail',
      'unmatched-glob-runs-once': 'guard-unmatched-glob',
      'unquoted-variable-as-path': 'quote-expansions',
      'for-over-ls-output': 'no-loop-over-command-output',
      'for-over-unquoted-args': 'quote-all-arguments',
      'array-joined-in-assignment': 'array-for-a-list',
      'unquoted-variable-in-test': 'quote-expansions',
      'dockerfile-pipefail-missing': 'pipefail',
      'python-shell-injection': 'quote-for-shell-in-python',
      'actions-script-injection': 'actions-expression-through-env',
    };
    const pitfalls = (Object.keys(MESSAGES) as FactId[]).filter((id) => MESSAGES[id].kind === 'pitfall');
    assert.strictEqual(pitfalls.length, 63, 'a new pitfall: sort it in this test (fact, or the habit of its advice)');
    for (const id of Object.keys(MESSAGES) as FactId[]) assert.strictEqual(conventionOfEntry(id) ?? 'fact', both[id] ?? 'fact', id);
    assert.deepStrictEqual(STYLE_CONVENTIONS, {
      'bracket-no-space': null, 'assignment-with-spaces': null, 'brace-no-space': null, 'brace-close-no-separator': null,
      'rm-empty-variable-root': 'guard-empty-path', 'read-without-r': 'read-r', 'redirect-in-bracket': null,
      'bracket-close-in-word': null, 'and-or-in-bracket': null, 'download-run-by-shell': 'read-before-run', 'trap-goes-on': null,
      'source-searches-path': 'source-by-script-path', 'pattern-from-variable': 'grep-fixed-strings',
    });
    assert.deepStrictEqual(Object.keys(STYLE_CONVENTIONS), Object.keys(STYLE_LEVELS));
  });

  it('names each habit once, used by some note, with its sources as plain strings', () => {
    const used = new Set([...(Object.keys(MESSAGES) as FactId[]).map(conventionOfEntry), ...Object.values(STYLE_CONVENTIONS)]);
    assert.deepStrictEqual(Object.keys(CONVENTIONS).filter((id) => !used.has(id as ConventionId)), []);
    for (const [id, c] of Object.entries(CONVENTIONS) as [ConventionId, Convention][]) {
      assert.ok(c.habit.length > 0, id);
      for (const s of c.sources) assert.match(s, /^(ShellCheck SC\d{4}|Hadolint DL\d{4}|Python documentation: .+|GitHub Docs: .+)$/, `${id}: ${s}`);
    }
  });

  it('cites sections of the bash 5.2 manual for every style check but one about grep', () => {
    assert.deepStrictEqual(Object.keys(STYLE_REFS), Object.keys(STYLE_LEVELS));
    for (const [code, refs] of Object.entries(STYLE_REFS)) for (const r of refs) assert.ok(SECTIONS.has(r), `${code}: ${r}`);
    assert.deepStrictEqual(Object.entries(STYLE_REFS).filter(([, refs]) => !refs.length).map(([code]) => code), ['pattern-from-variable']);
  });

  it('gives a fact and a style check their habit, beside the basis, and none with `notes.basis` off', () => {
    const local = fact('en', 'declaration-masks-status', { kw: 'local', v: 'v', rewrite: [{ code: 'local v; v=$(f)', edits: [] }] });
    assert.strictEqual(local.convention, 'declare-then-assign');
    assert.ok(!('basis' in local));
    assert.ok(!('convention' in basisGate(local, false)));
    assert.strictEqual(basisGate(local, true), local);
    // (A habit beside a basis of its own: both are kept, and both go with the setting off.)
    const test = fact('en', 'unquoted-variable-in-test', { bare: '$x', rewrite: [{ code: '"$x"', edits: [] }] });
    assert.deepStrictEqual([test.basis?.kind, test.convention], ['differs', 'quote-expansions']);
    assert.ok(!('convention' in basisGate(test, false)) && !('basis' in basisGate(test, false)));
    assert.ok(!('convention' in fact('en', 'pipeline-subshell-variable', { used: 'n', fix: { ja: '', en: '' }, partial: false })));

    const src = 'f() { local v=$(false); read line; [-f x]; }';
    const on = explain(src);
    assert.deepStrictEqual(on.facts?.filter((f) => f.kind === 'pitfall').map((f) => [f.id, f.convention]), [['declaration-masks-status', 'declare-then-assign']]);
    assert.deepStrictEqual(on.noteInfo.filter((n) => n.code).map((n) => `${n.code} ${n.convention ?? '-'}`).sort(), [
      'bracket-no-space -', 'declaration-masks-status declare-then-assign', 'read-without-r read-r',
    ]);
    const off = explain(src, 0, 'en', { basis: false });
    assert.deepStrictEqual([...off.facts!, ...off.noteInfo].filter((n) => 'convention' in n), []);
    assert.strictEqual(off.notes.length, on.notes.length);
  });

  it('gives the habit of a host file\'s note, in its facts, its notes and its problems', () => {
    const lines = (kind: 'dockerfile' | 'yaml' | 'python', text: string, line: number, basis?: boolean) => {
      const doc = openDocument(text, kind, (t) => parser.parse(t));
      return { ex: explainDocumentLine(new Analyzer('en'), doc, line, 'en', {}, { basis }), issues: documentIssues(doc, 'en', {}) };
    };
    const docker = lines('dockerfile', 'FROM alpine\nRUN wget -qO- x | tar x\n', 1);
    assert.deepStrictEqual(docker.ex.facts?.map((f) => [f.id, f.convention]), [['dockerfile-pipefail-missing', 'pipefail']]);
    assert.ok(docker.ex.noteInfo.some((n) => n.code === 'dockerPipefail' && n.convention === 'pipefail'));
    assert.deepStrictEqual(docker.issues.map((i) => [i.code, i.convention]), [['dockerPipefail', 'pipefail']]);
    const off = lines('dockerfile', 'FROM alpine\nRUN wget -qO- x | tar x\n', 1, false);
    assert.deepStrictEqual([...off.ex.facts!, ...off.ex.noteInfo].filter((n) => 'convention' in n), []);

    const actions = lines('yaml', 'on: issues\njobs:\n  a:\n    runs-on: ubuntu-latest\n    steps:\n      - run: echo "${{ github.event.issue.title }}"\n', 5);
    assert.deepStrictEqual(actions.ex.facts?.map((f) => [f.id, f.convention]), [['actions-script-injection', 'actions-expression-through-env']]);
    assert.ok(actions.issues.some((i) => i.code === 'injection' && i.convention === 'actions-expression-through-env'));

    const python = lines('python', 'import subprocess\nname = "x"\nsubprocess.run(f"echo {name}", shell=True)\n', 2);
    assert.ok(python.ex.facts?.some((f) => f.id === 'python-shell-injection' && f.convention === 'quote-for-shell-in-python'));
    assert.ok(python.issues.some((i) => i.code === 'pythonInjection' && i.convention === 'quote-for-shell-in-python'));
    // (A note with no habit makes a problem with none.)
    assert.ok(documentIssues(openDocument('[[ -f x ]]', 'shell', (t) => parser.parse(t)), 'en', { forced: 'sh' }).every((i) => !('convention' in i)));
  });
});
