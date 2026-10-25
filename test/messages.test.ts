// The message catalog (src/messages.ts): every entry cites sections of the manual that exist, says its kind with the
// right mark in both languages, and the analyzer lists a fact with the exact text of the note it shows.
import * as assert from 'assert';
import { fact, factOf, MESSAGES, noteLevel, notePrefix, PORTABILITY, severityOf, splitNote, type FactId } from '../src/messages';
import { SECTIONS } from '../src/manual';
import { explain } from './support/explain';

describe('the message catalog', () => {
  it('cites only sections of the manual, and at least one', () => {
    for (const [id, e] of Object.entries(MESSAGES)) {
      assert.ok(e.refs.length >= 1 && e.refs.length <= 3, id);
      for (const r of e.refs) assert.ok(SECTIONS.has(r), `${id}: ${r}`);
    }
  });

  it('marks a note with ℹ and a pitfall with ⚠, in both languages', () => {
    const note = fact('en', 'exit-modulo', { value: '300', status: 44 });
    assert.strictEqual(note.kind, 'note');
    assert.ok(note.text.startsWith('ℹ '));
    assert.ok(fact('ja', 'exit-modulo', { value: '300', status: 44 }).text.startsWith('ℹ 終了ステータスは'));
    assert.deepStrictEqual(note.refs, ['3.7.5']);
    const pit = fact('en', 'local-outside-function', { stops: false });
    assert.strictEqual(pit.kind, 'pitfall');
    assert.ok(pit.text.startsWith('⚠ Pitfall: '));
    assert.ok(fact('ja', 'local-outside-function', { stops: false }).text.startsWith('⚠ 落とし穴: '));
    assert.strictEqual(factOf('en', { id: 'exit-modulo', params: { value: '300', status: 44 } }).text, note.text);
  });

  // The levels of docs/design/note-levels.md: a pitfall is a warning unless it is a caveat; a note is a plain fact
  // unless it says the line fails when it runs.
  const CAVEATS = ['declaration-masks-status', 'pipefail-missing', 'function-last-test-returns-status', 'posix-special-function-name-maybe',
    'extglob-maybe-on', 'extglob-not-found', 'extglob-maybe-on-trap', 'globstar-maybe-on',
    'globstar-not-found', 'ssh-local-expansion', 'function-not-imported-sh', 'unmatched-glob-runs-once', 'for-over-ls-output', 'for-over-unquoted-args',
    'unquoted-variable-in-test', 'dockerfile-pipefail-missing'];
  const FAILURES = ['bracket-missing-close', 'bracket-close-glued', 'test-malformed', 'unset-readonly', 'unset-function-and-variable'];
  it('gives each entry the level of the design: warning, info or note', () => {
    for (const [id, e] of Object.entries(MESSAGES) as [FactId, { kind: string; level?: unknown }][]) {
      if (typeof e.level === 'function') continue;
      const want = e.kind === 'note' ? (FAILURES.includes(id) ? 'warning' : 'note') : CAVEATS.includes(id) ? 'info' : 'warning';
      assert.strictEqual(e.level ?? (e.kind === 'pitfall' ? 'warning' : 'note'), want, id);
    }
    // The ones whose level depends on the case: an unquoted path given to `rm`, `mv` or `cp`; an unset read that stops a shell.
    assert.deepStrictEqual(Object.entries(MESSAGES).filter(([, e]) => typeof (e as { level?: unknown }).level === 'function').map(([id]) => id), ['postfix-increment-status', 'postfix-decrement-status', 'unquoted-variable-as-path', 'nounset-unbound']);
    for (const id of ['postfix-increment-status', 'postfix-decrement-status'] as const) {
      assert.strictEqual(fact('en', id, { v: 'i', errexit: true }).level, 'warning', id);
      assert.strictEqual(fact('en', id, { v: 'i' }).level, 'info', id);
    }
    assert.strictEqual(fact('en', 'unquoted-variable-as-path', { bare: '$f', destroys: true }).level, 'warning');
    assert.strictEqual(fact('en', 'unquoted-variable-as-path', { bare: '$f' }).level, 'info');
    const unset = { v: 'x', name: 'x', shell: 'bash', environment: false } as const;
    assert.strictEqual(fact('en', 'nounset-unbound', { ...unset, exits: 'script' }).level, 'warning');
    assert.strictEqual(fact('en', 'nounset-unbound', { ...unset, exits: 'command', errexit: 'script' }).level, 'warning');
    assert.strictEqual(fact('en', 'nounset-unbound', { ...unset, exits: 'command' }).level, 'info');
  });

  it('starts a note with the mark of its level, and a pitfall with the word of its level too', () => {
    assert.ok(fact('en', 'declaration-masks-status', { kw: 'local', v: 'x' }).text.startsWith('ⓘ Caveat: the status of'));
    assert.ok(fact('ja', 'declaration-masks-status', { kw: 'local', v: 'x' }).text.startsWith('ⓘ 注意: '));
    assert.ok(fact('en', 'unset-readonly', { name: 'x' }).text.startsWith('⚠ The variable `x` is read-only'));
    // (A heading of its own in place of the word.)
    assert.ok(fact('en', 'python-shell-injection').text.startsWith('⚠ Shell injection risk: '));
    assert.strictEqual(notePrefix('en', 'info', 'note', PORTABILITY), 'ⓘ Portability: ');
    assert.strictEqual(notePrefix('ja', 'info', 'note', PORTABILITY), 'ⓘ 移植性: ');
    assert.strictEqual(notePrefix('en', 'note'), 'ℹ ');
  });

  it('reads a note back into its level, its word and the rest', () => {
    assert.deepStrictEqual(splitNote('⚠ Pitfall: `x =…` runs a command', 'en'), { level: 'warning', label: 'Pitfall:', body: '`x =…` runs a command' });
    assert.deepStrictEqual(splitNote('ⓘ 注意: `-r` を付けないと', 'ja'), { level: 'info', label: '注意:', body: '`-r` を付けないと' });
    assert.deepStrictEqual(splitNote('ⓘ Portability: dash\'s `echo`', 'en'), { level: 'info', label: 'Portability:', body: 'dash\'s `echo`' });
    assert.deepStrictEqual(splitNote('⚠ Script injection risk: `x`', 'en'), { level: 'warning', label: 'Script injection risk:', body: '`x`' });
    // (A warning that names its own problem has no word; a plain fact neither; a note without a mark, an idiom, is a plain fact.)
    assert.deepStrictEqual(splitNote('⚠ `[[ ]]` is not POSIX sh', 'en'), { level: 'warning', label: '', body: '`[[ ]]` is not POSIX sh' });
    assert.deepStrictEqual(splitNote('ℹ An exit status', 'en'), { level: 'note', label: '', body: 'An exit status' });
    assert.deepStrictEqual(splitNote('Idiom: `cmd || true`', 'en'), { level: 'note', label: '', body: 'Idiom: `cmd || true`' });
    assert.deepStrictEqual(['⚠ a', 'ⓘ b', 'ℹ c', 'd'].map(noteLevel), ['warning', 'info', 'note', 'note']);
    // (A diagnostic is a warning or information: a plain fact is never one, so it is taken as information.)
    assert.deepStrictEqual((['warning', 'info', 'note'] as const).map(severityOf), ['warning', 'info', 'info']);
  });

  // [script, line, id]: the analyzer says the fact on that line, and lists it with the text of its note.
  const rows: [string, number, FactId][] = [
    ['exit 300', 0, 'exit-modulo'],
    ['set -e\nf() {\n  local x=$(false)\n}\nf', 2, 'declaration-masks-status'],
    ['f\nf() { echo hi; }', 0, 'function-defined-later'],
    ['local x=1', 0, 'local-outside-function'],
    ['x=$(echo hi | cat)\nset -e\ncat < /dev/null | cat', 2, 'pipefail-missing'],
    ['for f in $(ls); do :; done', 0, 'for-over-ls-output'],
    ['FOO=1 echo $FOO', 0, 'prefix-assignment-expanded-first'],
  ];
  for (const [src, line, id] of rows) {
    for (const lang of ['en', 'ja'] as const) {
      it(`lists ${id} (${lang}) for line ${line + 1} of ${JSON.stringify(src)}`, () => {
        const r = explain(src, line, lang);
        const f = r.facts?.find((x) => x.id === id);
        assert.ok(f, JSON.stringify(r.notes));
        assert.ok(r.notes.includes(f.text));
        assert.deepStrictEqual(f.refs, MESSAGES[id].refs);
      });
    }
  }

  it('leaves a pitfall out of the facts when the pitfalls are off', () => {
    const r = explain('local x=1', 0, 'en', { pitfalls: false });
    assert.strictEqual(r.facts, undefined);
  });
});
