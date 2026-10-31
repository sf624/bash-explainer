// The message catalog (src/messages.ts): every entry cites sections of the manual that exist, says its kind with the
// right mark in both languages, and the analyzer lists a fact with the exact text of the note it shows.
import * as assert from 'assert';
import { fact, factOf, marked, MESSAGES, plainNote, PORTABILITY, problemText, severityOf, type FactId } from '../src/messages';
import { SECTIONS } from '../src/manual';
import { reference } from '../src/references';
import { explain } from './support/explain';

describe('the message catalog', () => {
  it('cites only known references (sections of the manual, manual pages), and at least one section', () => {
    for (const [id, e] of Object.entries(MESSAGES)) {
      assert.ok(e.refs.length >= 1 && e.refs.length <= 3, id);
      assert.ok(e.refs.some((r) => SECTIONS.has(r)), id);
      for (const r of e.refs) assert.ok(reference(r), `${id}: ${r}`);
    }
  });

  it('cites in each case, where the sections depend on the params (`refsOf`), some of `refs`, sections of the manual', () => {
    // (Each case of the ids that choose: every combination of the params `refsOf` reads.)
    const find = ['missing', 'empty', 'alone', 'once'].flatMap((why) => [true, false].flatMap((bare) => [true, false].flatMap((plus) => [true, false]
      .map((noCommand) => ({ option: '-exec', why, plus, bare, noCommand, word: '{}x', rewrite: [] })))));
    const cases: Record<string, readonly unknown[]> = { 'find-action-refused': find };
    const choosing = Object.entries(MESSAGES).filter(([, e]) => 'refsOf' in e);
    assert.deepStrictEqual(choosing.map(([id]) => id).sort(), Object.keys(cases).sort());
    for (const [id, e] of choosing) {
      const refsOf = (e as { refsOf: (p: unknown) => readonly string[] }).refsOf;
      for (const p of cases[id]) {
        const refs = refsOf(p);
        const where = `${id} ${JSON.stringify(p)}: ${refs.join(', ')}`;
        assert.ok(refs.length >= 1 && refs.every((r) => e.refs.includes(r) && SECTIONS.has(r)), where);
        assert.deepStrictEqual(fact('en', id as FactId, p as never).refs, refs, where);
      }
    }
  });

  it('marks a note with ℹ and a pitfall with ⚠, in both languages', () => {
    const note = fact('en', 'exit-modulo', { command: 'exit', value: '300', status: 44, ends: 'shell' });
    assert.strictEqual(note.kind, 'note');
    assert.ok(note.text.startsWith('ℹ '));
    assert.ok(fact('ja', 'exit-modulo', { command: 'exit', value: '300', status: 44, ends: 'shell' }).text.startsWith('ℹ 終了ステータスは'));
    assert.deepStrictEqual(note.refs, ['3.7.5']);
    const pit = fact('en', 'posix-function-name', {});
    assert.strictEqual(pit.kind, 'pitfall');
    assert.ok(pit.text.startsWith('⚠ Pitfall: '));
    assert.ok(fact('ja', 'posix-function-name', {}).text.startsWith('⚠ 落とし穴: '));
    // (A pitfall that fails every time is an error, with the word of the level.)
    assert.ok(fact('en', 'local-outside-function', { stops: false }).text.startsWith('ⓧ Error: '));
    assert.ok(fact('ja', 'local-outside-function', { stops: false }).text.startsWith('ⓧ エラー: '));
    assert.strictEqual(factOf('en', { id: 'exit-modulo', params: { command: 'exit', value: '300', status: 44, ends: 'shell' } }).text, note.text);
  });

  // The levels of docs/design/note-levels.md: a pitfall is a warning unless it is a caveat or fails every time (an
  // error, docs/design/three-levels.md, step 2); a note is a plain fact unless it says the line fails when it runs.
  const CAVEATS = ['declaration-masks-status', 'pipefail-missing', 'function-last-test-returns-status', 'failure-reported-as-success', 'posix-special-function-name-maybe', 'posix-function-name-maybe', 'posix-special-builtin-error-maybe',
    'extglob-maybe-on', 'extglob-not-found', 'extglob-maybe-on-trap', 'globstar-maybe-on',
    'globstar-not-found', 'ssh-local-expansion', 'function-not-imported-sh', 'unmatched-glob-runs-once', 'for-over-ls-output', 'for-over-unquoted-args',
    'unquoted-variable-in-test', 'dockerfile-pipefail-missing', 'script-last-test-returns-status', 'array-joined-in-assignment', 'alias-maybe-not-expanded',
    'function-shadowed-by-program'];
  const PITFALL_ERRORS = ['posix-special-function-name', 'extglob-turned-off', 'globstar-unsupported', 'function-not-in-container', 'builtin-or-function-as-program',
    'function-not-on-remote', 'function-not-in-new-shell-blocked', 'function-not-in-new-shell', 'function-not-imported', 'wrapper-assignment-expanded-first',
    'prefix-assignment-expanded-first', 'shebang-refused', 'shebang-bom', 'bats-test-line-dropped', 'bats-negation-ignored', 'bats-run-in-pipeline-stage',
    'bats-run-in-pipeline', 'bats-setup-suite-in-test-file', 'regex-backslash-dropped', 'python-string-without-shell'];
  const FAILURES = ['find-action-refused', 'keyword-needs-separator', 'bracket-missing-close', 'bracket-close-glued', 'test-malformed', 'unset-readonly', 'assign-readonly', 'unset-function-and-variable', 'bats-tags-invalid', 'restricted-refused', 'exit-refused'];
  it('gives each entry the level of the design: error, warning, info or note', () => {
    for (const [id, e] of Object.entries(MESSAGES) as [FactId, { kind: string; level?: unknown }][]) {
      if (typeof e.level === 'function') continue;
      const want = e.kind === 'note' ? (FAILURES.includes(id) ? 'error' : 'note') : CAVEATS.includes(id) ? 'info' : PITFALL_ERRORS.includes(id) ? 'error' : 'warning';
      assert.strictEqual(e.level ?? (e.kind === 'pitfall' ? 'warning' : 'note'), want, id);
    }
    // The ones whose level depends on the case: an unquoted path given to `rm`, `mv` or `cp`; an unset read that stops a shell.
    assert.deepStrictEqual(Object.entries(MESSAGES).filter(([, e]) => typeof (e as { level?: unknown }).level === 'function').map(([id]) => id), ['local-outside-function', 'postfix-increment-status', 'postfix-decrement-status', 'alias-not-expanded-in-script', 'extglob-in-same-block', 'extglob-not-in-new-shell', 'variable-not-in-remote-shell', 'variable-not-passed-by-wrapper', 'variable-not-exported', 'function-not-in-new-shell-export', 'pipeline-subshell-variable', 'unquoted-variable-as-path', 'nounset-unbound', 'redirect-by-your-shell', 'distro-alias-in-script']);
    // `local` in a file with no shebang, which a function may source, or in a trap's action; an alias after code not
    // read, which may turn expand_aliases on; a name that may come from the environment, exported.
    assert.strictEqual(fact('en', 'local-outside-function', { stops: false }).level, 'error');
    assert.strictEqual(fact('en', 'local-outside-function', { stops: false, sourced: true }).level, 'info');
    assert.strictEqual(fact('en', 'local-outside-function', { stops: 'script', trap: true }).level, 'info');
    assert.strictEqual(fact('en', 'alias-not-expanded-in-script', { name: 'll', value: 'ls -l' }).level, 'error');
    assert.strictEqual(fact('en', 'alias-not-expanded-in-script', { name: 'll', value: 'ls -l', off: true, unread: true }).level, 'info');
    assert.strictEqual(fact('en', 'alias-not-expanded-in-script', { name: 'll', value: 'ls -l', fn: true }).level, 'info');
    // (After code not read, which may set or export it there: `unread`, a caveat.)
    for (const unread of [false, true]) {
      const level = unread ? 'info' : 'error';
      assert.strictEqual(fact('en', 'variable-not-in-remote-shell', { v: 'x', unread }).level, level);
      assert.strictEqual(fact('en', 'variable-not-passed-by-wrapper', { v: 'x', via: 'sudo', unread }).level, level);
      assert.strictEqual(fact('en', 'variable-not-exported', { v: 'x', unread }).level, level);
      assert.strictEqual(fact('en', 'function-not-in-new-shell-export', { via: 'bash -c', fn: 'f', unread }).level, level);
    }
    // (A variable ssh may send, `SendEnv`: a caveat.)
    assert.strictEqual(fact('en', 'variable-not-in-remote-shell', { v: 'LANG', sent: true }).level, 'info');
    // (A distribution's alias, or `shopt -s extglob` in the block of its glob, in a file with no shebang, which an interactive shell may read.)
    const distro = { name: 'll', where: 'Ubuntu', what: { ja: 'エイリアス', en: 'an alias' }, many: false, instead: { ja: '', en: '' } };
    assert.strictEqual(fact('en', 'distro-alias-in-script', distro).level, 'error');
    assert.strictEqual(fact('en', 'distro-alias-in-script', { ...distro, reader: 'sourced' }).level, 'info');
    assert.strictEqual(fact('en', 'extglob-in-same-block', { use: '!(x)' }).level, 'error');
    assert.strictEqual(fact('en', 'extglob-in-same-block', { use: '!(x)', reader: 'sourced' }).level, 'info');
    assert.strictEqual(fact('en', 'extglob-not-in-new-shell', { use: '!(x)', reader: 'interactive' }).level, 'info');
    assert.strictEqual(fact('en', 'distro-alias-in-script', { ...distro, reader: 'interactive' }).level, 'info');
    assert.strictEqual(fact('en', 'variable-not-exported', { v: 'x' }).level, 'error');
    assert.strictEqual(fact('en', 'variable-not-exported', { v: 'X', environment: 'maybe' }).level, 'info');
    // (A name in lower case may come from the environment too, though it seldom does: a warning, with a clause.)
    assert.strictEqual(fact('en', 'variable-not-exported', { v: 'x', environment: 'unlikely' }).level, 'warning');
    // (The increment's params carry its rewrites, `incr`; the text renders their code.)
    const incr = (v: string) => ({ v, rewrite: [`${v}=$((${v}+1))`, `((++${v}))`, `((${v}++)) || true`].map((code) => ({ code, edits: [] })) });
    for (const id of ['postfix-increment-status', 'postfix-decrement-status'] as const) {
      assert.strictEqual(fact('en', id, { ...incr('i'), errexit: true }).level, 'warning', id);
      assert.strictEqual(fact('en', id, incr('i')).level, 'info', id);
    }
    // (The warning leads with the consequence and the reason: `set -e` is on, so the shell stops there.)
    assert.strictEqual(fact('en', 'postfix-increment-status', { ...incr('count'), errexit: true }).text, '⚠ Pitfall: `set -e` is on here, so the script stops at this line when `count` is 0: `((count++))` gives the value before the increment, and 0 is a failure status. Write `count=$((count+1))`, `((++count))` or `((count++)) || true`');
    assert.strictEqual(fact('ja', 'postfix-increment-status', { ...incr('count'), errexit: true, stops: 'subshell' }).text, '⚠ 落とし穴: ここでは `set -e` が効いているので、`count` が 0 のときこの行でサブシェルが終わる。`((count++))` の値は増やす前の値で、0 は失敗の終了ステータスになるため。`count=$((count+1))` か `((++count))` か `((count++)) || true` と書く');
    assert.match(fact('en', 'postfix-decrement-status', { v: 'n', errexit: true, stops: 'unknown' }).text, /^⚠ Pitfall: `set -e` is on here, so the shell running it stops at this line when `n` is 0/);
    // Every shell that `set -e` stops, in both languages and for both operators.
    const ends = { script: ['スクリプトが止まる', 'the script stops'], subshell: ['サブシェルが終わる', 'the subshell ends'], unknown: ['これを実行するシェルが止まる', 'the shell running it stops'] } as const;
    for (const id of ['postfix-increment-status', 'postfix-decrement-status'] as const) {
      for (const [stops, [ja, en]] of Object.entries(ends)) {
        assert.ok(fact('ja', id, { ...incr('n'), errexit: true, stops: stops as keyof typeof ends }).text.includes(`この行で${ja}`), `${id} ja ${stops}`);
        assert.ok(fact('en', id, { ...incr('n'), errexit: true, stops: stops as keyof typeof ends }).text.includes(`so ${en} at this line`), `${id} en ${stops}`);
      }
      assert.ok(fact('ja', id, { ...incr('n'), errexit: true }).text.includes('この行でスクリプトが止まる'), `${id} ja default`);
      assert.ok(fact('en', id, { ...incr('n'), errexit: true }).text.includes('so the script stops at this line'), `${id} en default`);
      assert.ok(!fact('en', id, incr('n')).text.includes('set -e` is on here'), `${id} en plain`);
      assert.ok(!fact('ja', id, incr('n')).text.includes('が効いているので'), `${id} ja plain`);
    }
    assert.match(fact('en', 'unquoted-variable-as-path', { bare: '$f', destroys: true, rewrite: [] }).text, /file names, and this command then deletes or overwrites files it should not$/);
    assert.strictEqual(fact('en', 'unquoted-variable-as-path', { bare: '$f', destroys: true, rewrite: [] }).level, 'warning');
    assert.strictEqual(fact('en', 'unquoted-variable-as-path', { bare: '$f', rewrite: [] }).level, 'info');
    const unset = { v: 'x', name: 'x', shell: 'bash', environment: 'no', rewrite: [] } as const;
    // (Unset on every path: the shell stops, or the command fails, every time.)
    assert.strictEqual(fact('en', 'nounset-unbound', { ...unset, exits: 'script' }).level, 'error');
    assert.strictEqual(fact('en', 'nounset-unbound', { ...unset, exits: 'command', errexit: 'script' }).level, 'error');
    assert.strictEqual(fact('en', 'nounset-unbound', { ...unset, exits: 'command' }).level, 'error');
    // (A name that may come from the environment, in capitals or, with a clause, in lower case: a stop halfway, a
    // warning, or a command that fails while the shell goes on, a caveat.)
    assert.strictEqual(fact('en', 'nounset-unbound', { ...unset, exits: 'script', environment: 'maybe' }).level, 'warning');
    assert.strictEqual(fact('en', 'nounset-unbound', { ...unset, exits: 'command', errexit: 'script', environment: 'maybe' }).level, 'warning');
    assert.strictEqual(fact('en', 'nounset-unbound', { ...unset, exits: 'command', environment: 'maybe' }).level, 'info');
    assert.strictEqual(fact('en', 'nounset-unbound', { ...unset, exits: 'script', environment: 'unlikely' }).level, 'warning');
    // (A pipeline's variable is gone on every path, or only on those that do not turn `lastpipe` on; a redirection
    // under sudo fails every time for a path only root writes, and otherwise only for a file of root's.)
    const fix = { ja: '', en: '' };
    assert.strictEqual(fact('en', 'pipeline-subshell-variable', { used: 'v', fix, partial: false }).level, 'error');
    assert.strictEqual(fact('en', 'pipeline-subshell-variable', { used: 'v', fix, partial: true }).level, 'info');
    assert.strictEqual(fact('en', 'redirect-by-your-shell', { op: '>', kind: 'write', file: '/etc/x.conf' }).level, 'error');
    assert.strictEqual(fact('en', 'redirect-by-your-shell', { op: '>', kind: 'write' }).level, 'info');
  });

  it('starts a note with the mark of its level, and a pitfall with the word of its level too', () => {
    assert.ok(fact('en', 'declaration-masks-status', { kw: 'local', v: 'x', rewrite: [{ code: 'local x; x=$(f)', edits: [] }] }).text.startsWith('ⓘ Caveat: the status of'));
    assert.ok(fact('ja', 'declaration-masks-status', { kw: 'local', v: 'x', rewrite: [{ code: 'local x; x=$(f)', edits: [] }] }).text.startsWith('ⓘ 注意: '));
    assert.ok(fact('en', 'unset-readonly', { name: 'x' }).text.startsWith('ⓧ Error: The variable `x` is read-only'));
    // (A heading of its own in place of the word.)
    assert.ok(fact('en', 'python-shell-injection').text.startsWith('⚠ Shell injection risk: '));
    assert.deepStrictEqual(marked('en', 'info', 'dash\'s `echo`', { heading: PORTABILITY, code: 'echoE' }), { text: 'ⓘ Portability: dash\'s `echo`', level: 'info', label: 'Portability:', body: 'dash\'s `echo`', code: 'echoE' });
    assert.strictEqual(marked('ja', 'info', 'x', { heading: PORTABILITY }).text, 'ⓘ 移植性: x');
    assert.strictEqual(marked('en', 'note', 'x').text, 'ℹ x');
  });

  it('leaves out of a problem the word of a level said on every note, which its severity says (three-levels.md, 1b)', () => {
    const heading = { ja: '見出し: ', en: 'Heading: ' };
    assert.deepStrictEqual((['en', 'ja'] as const).map((lang) => [
      problemText(fact(lang, 'unset-readonly', { name: 'x' }), lang).slice(0, 14),
      // (A pitfall at the error level has the error's word: left out; a heading names no level: kept.)
      problemText(marked(lang, 'error', 'x', { kind: 'pitfall' }), lang), problemText(marked(lang, 'error', 'x', { heading }), lang),
      // (The words of the other levels are no level's name: kept, as the plain fact's text.)
      problemText(marked(lang, 'warning', 'x', { kind: 'pitfall' }), lang), problemText(marked(lang, 'info', 'x', { heading: PORTABILITY }), lang), problemText(plainNote('x'), lang),
    ]), [
      ['ⓧ The variable', 'ⓧ x', 'ⓧ Heading: x', '⚠ Pitfall: x', 'ⓘ Portability: x', 'x'],
      ['ⓧ 変数 `x` は読み取り', 'ⓧ x', 'ⓧ 見出し: x', '⚠ 落とし穴: x', 'ⓘ 移植性: x', 'x'],
    ]);
  });

  it('gives a note its level, its word and the rest as data', () => {
    const { text, level, label, body, code } = fact('en', 'posix-function-name', {});
    assert.deepStrictEqual({ level, label, code }, { level: 'warning', label: 'Pitfall:', code: 'posix-function-name' });
    assert.strictEqual(text, `⚠ Pitfall: ${body}`);
    const caveat = fact('ja', 'declaration-masks-status', { kw: 'local', v: 'x', rewrite: [{ code: 'local x; x=$(f)', edits: [] }] });
    assert.deepStrictEqual([caveat.level, caveat.label], ['info', '注意:']);
    const risk = fact('en', 'python-shell-injection');
    assert.deepStrictEqual([risk.level, risk.label], ['warning', 'Shell injection risk:']);
    // (A warning that names its own problem has no word; a plain fact neither; a note without a mark, an idiom, is a plain fact.)
    assert.deepStrictEqual(marked('en', 'warning', '`[[ ]]` is not POSIX sh'), { text: '⚠ `[[ ]]` is not POSIX sh', level: 'warning', label: '', body: '`[[ ]]` is not POSIX sh' });
    assert.strictEqual(fact('en', 'exit-modulo', { command: 'exit', value: '300', status: 44, ends: 'shell' }).label, '');
    assert.deepStrictEqual(plainNote('Idiom: `cmd || true`'), { text: 'Idiom: `cmd || true`', level: 'note', label: '', body: 'Idiom: `cmd || true`' });
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
