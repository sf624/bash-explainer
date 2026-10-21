// The message catalog (src/messages.ts): every entry cites sections of the manual that exist, says its kind with the
// right mark in both languages, and the analyzer lists a fact with the exact text of the note it shows.
import * as assert from 'assert';
import { Analyzer } from '../src/analyzer';
import { fact, factOf, MESSAGES, type FactId } from '../src/messages';
import { SECTIONS } from '../src/manual';
import { createUnbashParser } from '../src/syntax/adapters/unbash';

const parser = createUnbashParser();
const explain = (src: string, line: number, lang: 'en' | 'ja' = 'en', opts?: { pitfalls?: boolean }) => new Analyzer(lang).explainLine(parser.parse(src), line, undefined, opts);

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
    const pit = fact('en', 'local-outside-function');
    assert.strictEqual(pit.kind, 'pitfall');
    assert.ok(pit.text.startsWith('⚠ Pitfall: '));
    assert.ok(fact('ja', 'local-outside-function').text.startsWith('⚠ 落とし穴: '));
    assert.strictEqual(factOf('en', { id: 'exit-modulo', params: { value: '300', status: 44 } }).text, note.text);
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
