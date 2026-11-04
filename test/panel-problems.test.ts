import * as assert from 'assert';
import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { Analyzer } from '../src/analyzer';
import { diagnosticsFor, documentIssues, issueFilter, type ShellDocument } from '../src/document';
import { defaultSettings, type Settings } from '../src/settings';
import { failsCheck } from '../src/levels';
import { createUnbashParser } from '../src/syntax/adapters/unbash';
import { boxProblems, problemsAround } from '../src/ui/panelProblems';
import { rowModel } from '../src/ui/panelRows';
import { panelUpdate } from '../src/ui/panelView';
import { placeExamples } from '../src/ui/render';

// The box "Problems on this line" as data, and the errors of the tokens as problems (docs/design/panel-redesign.md, P7b).

const parser = createUnbashParser();
const doc = (text: string): ShellDocument => ({ lines: text.split('\n'), tree: parser.parse(text) });
const explain = (text: string, line = 0, lang: 'en' | 'ja' = 'en') => new Analyzer(lang).explainLine(parser.parse(text), line);
const issues = (text: string, opts: Parameters<typeof documentIssues>[4] = {}, ignore: string[] = []) => documentIssues(doc(text), 'en', {}, ignore, opts);
const errors = (text: string) => issues(text).filter((i) => i.severity === 'error').map((i) => i.code);

describe('the errors of the tokens, as problems', () => {
  it('reach the problems of the document, on the token\'s place', () => {
    const [i] = issues('echo $((09))');
    assert.strictEqual(i.code, 'arith-invalid-number');
    assert.strictEqual(i.severity, 'error');
    assert.deepStrictEqual([i.startLine, i.startCol, i.endCol], [0, 8, 10]);
    assert.match(i.message, /^ⓧ Invalid number `09`/);
    assert.match(i.head, /not valid/);
    assert.strictEqual(i.pitfall, undefined);
    assert.ok(failsCheck(i.severity, false));
  });

  it('say the shebang\'s errors at their level, on the first line only', () => {
    assert.deepStrictEqual(errors('#!/usr/bin/env bash -e\necho a'), ['shebang-env-one-argument']);
    assert.deepStrictEqual(errors('#!/usr/bin/env\necho a'), ['shebang-env-loop']);
    assert.deepStrictEqual(errors('#!/usr/bin/env -S"a\necho a'), ['shebang-env-string-refused']);
    for (const fine of ['#!/usr/bin/env -S bash -e\necho a', '#!/usr/bin/env bash\necho a', 'echo a\n#!/usr/bin/env bash -e', ' #!/usr/bin/env bash -e\necho a']) assert.deepStrictEqual(errors(fine), [], fine);
  });

  it('are said once, whichever lines say them and however deep', () => {
    // (A statement over several lines says its notes on each.)
    assert.deepStrictEqual(errors('echo $((09)) \\\n  a \\\n  b'), ['arith-invalid-number']);
    // (A string read as a script: the place is in the document's word.)
    const [nested, ...none] = issues("bash -c 'echo $((09))'");
    assert.deepStrictEqual([nested.code, nested.startCol, nested.endCol, none.length], ['arith-invalid-number', 17, 19, 0]);
    // (Each number is a problem of its own.)
    assert.deepStrictEqual(issues('echo $((09)) $((08))').map((i) => i.startCol), [8, 16]);
  });

  it('are one problem where a note says the same', () => {
    // (A row says "Word `then`"; only the note says the error.)
    assert.deepStrictEqual(errors('if [ -f a ] then echo x; fi'), ['keyword-needs-separator']);
  });

  it('stay with the pitfalls off, and go with `disable=` and `ignore`, by their id', () => {
    assert.deepStrictEqual(issues('echo $((09))', { pitfalls: false }).map((i) => i.code), ['arith-invalid-number']);
    assert.deepStrictEqual(issues('echo $((09))', {}, ['arith-invalid-number']), []);
    assert.deepStrictEqual(issues('# bash-explainer disable=arith-invalid-number\necho $((09))'), []);
    assert.deepStrictEqual(issues('# bash-explainer disable-file=shebang-env-one-argument\n'), []);
  });

  it('leave a token\'s warning on its row: it is no finding on its own', () => {
    assert.deepStrictEqual(issues('#!bash\necho a'), []);
    assert.deepStrictEqual(issues('echo ${x:-$((09))}'), []);
    assert.deepStrictEqual(explain('#!bash').noteInfo, []);
  });

  it('are notes of the line, with the level\'s word, in the language', () => {
    assert.ok(explain('echo $((09))').notes[0].startsWith('ⓧ Error: Invalid number `09`'));
    assert.ok(explain('echo $((09))', 0, 'ja').notes[0].startsWith('ⓧ エラー: 不正な数 `09`'));
    assert.deepStrictEqual(explain('echo $((09))', 0, 'ja').noteInfo.map((n) => [n.level, n.code]), [['error', 'arith-invalid-number']]);
  });

  it('are true of the real tool: the lines marked fail, and those beside them work', function () {
    // (bash, env and the kernel, on a file run as a program: the table of `--check`'s new failures.)
    this.timeout(30000);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bash-explainer-problems-'));
    try {
      const run = (script: string) => {
        const file = path.join(dir, 's');
        fs.writeFileSync(file, script, { mode: 0o755 });
        return spawnSync(file, { encoding: 'utf8', timeout: 5000, cwd: dir, env: { PATH: process.env.PATH, FUNCNEST: '20' } });
      };
      for (const [script, code] of [
        ['#!/usr/bin/env bash -e\necho ran\n', 'shebang-env-one-argument'],
        ['#!/usr/bin/env -S"a\necho ran\n', 'shebang-env-string-refused'],
        ['#!/bin/bash\necho $((09)); echo ok\n', 'arith-invalid-number'],
        ['#!/bin/bash\nlet x=09 && echo ok\n', 'arith-invalid-number'],
        ['#!/bin/bash\nx=$((2#2)) && echo ok\n', 'arith-invalid-number'],
      ] as const) {
        const r = run(script);
        assert.ok(r.status !== 0 || !r.stdout.includes('ok'), `${script}: ${r.status} ${r.stdout}`);
        assert.doesNotMatch(r.stdout, /ran/, script);
        assert.ok(errors(script).includes(code), script);
      }
      // (The messages say "run directly as a program": `bash file` ignores the line and runs the script.)
      for (const script of ['#!/usr/bin/env bash -e\necho ran\n', '#!/usr/bin/env -S"a\necho ran\n', '#!/usr/bin/env\necho ran\n']) {
        const file = path.join(dir, 's');
        fs.writeFileSync(file, script, { mode: 0o755 });
        const r = spawnSync('bash', [file], { encoding: 'utf8', timeout: 5000, cwd: dir, env: { PATH: process.env.PATH, FUNCNEST: '20' } });
        assert.ok(r.status === 0 && r.stdout.includes('ran'), `${script}: ${r.status} ${r.stdout}`);
        for (const lang of ['en', 'ja'] as const) {
          const [i] = documentIssues(doc(script), lang, {}).filter((x) => x.severity === 'error');
          assert.match(i.message, lang === 'en' ? /Run directly as a program, .*\(`bash file` ignores the line\)/ : /プログラムとして直接実行すると.*（`bash file` ではこの行はコメント）/, `${lang} ${script}`);
          assert.match(i.head, lang === 'en' ? /^(Run directly as a program|Run directly as a program on Linux)/ : /プログラムとして直接実行すると|Linux でプログラムとして直接実行すると/, `${lang} ${script}`);
        }
      }
      for (const script of ['#!/usr/bin/env -S bash -e\necho ok\n', '#!/bin/bash\necho $((10#09)) ok\n', '#!/bin/bash\ndeclare -A a; a[09]=1; echo ${a[09]} ok\n', '#!/bin/bash\n[ 09 -eq 9 ] && echo ok\n']) {
        const r = run(script);
        assert.ok(r.status === 0 && r.stdout.includes('ok'), `${script}: ${r.status} ${r.stdout} ${r.stderr}`);
        assert.deepStrictEqual(errors(script), [], script);
      }
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

const DEPTH1 = { depth: 1, receives: false } as const;

describe('the box "Problems on this line"', () => {
  const box = (text: string, line = 0, lang: 'en' | 'ja' = 'en') => {
    const ex = placeExamples(explain(text, line, lang));
    return boxProblems(ex, rowModel(ex, DEPTH1, lang).places, lang, () => true);
  };

  it('gives each problem its level\'s word and look, its headline, and the whole text under "more"', () => {
    const [p] = box('read line');
    assert.deepStrictEqual([p.level, p.className, p.icon, p.word], ['info', 'level-info', 'info', 'Caveat']);
    assert.strictEqual(p.head, 'Without `-r`, backslashes in the input are lost.');
    assert.strictEqual(p.label, 'Caveat:');
    assert.match(p.body, /^without `-r`/);
    assert.match(p.text, /^ⓘ Caveat: without `-r`/);
    assert.deepStrictEqual(p.fixes, ['read -r']);
    assert.strictEqual(box('read line', 0, 'ja')[0].word, '注意');
  });

  it('says in "more" what a problem cites and rests on', () => {
    const [p] = box('unset -fv x');
    assert.deepStrictEqual(p.refs, ['4.1']);
    assert.strictEqual(p.basis?.kind, 'checked');
    assert.match(p.basis!.tryIt.code, /unset -fv/);
    assert.strictEqual(box('read line')[0].basis, undefined);
  });

  it('gives the panel the box, the pointers and the squiggles from the document\'s problems', () => {
    const text = 'for f in $(ls); do\n  echo $((09))\ndone';
    const message = panelUpdate({ lang: 'en', explanation: explain(text, 1), line: 1, lineText: '  echo $((09))', file: 'f', choice: {}, detected: { shell: 'bash', source: 'default' }, placement: 'first', animations: false, doc: doc(text), issues: documentIssues(doc(text), 'en', {}) } as never);
    assert.deepStrictEqual(message.problems.map((p) => p.word), ['Error']);
    assert.ok(message.around.length > 0);
    assert.deepStrictEqual(message.marks.map((m) => [m.from, m.to, m.className]), [[10, 12, 'level-error']]);
  });

  it('leaves a silenced problem out of the box, and shows it as a plain note below it', () => {
    const update = (text: string, line: number, settings: Settings) => panelUpdate({
      lang: 'en', explanation: explain(text, line), line, lineText: text.split('\n')[line], file: 'f', choice: {}, detected: { shell: 'bash', source: 'default' },
      placement: 'first', animations: false, doc: doc(text), issues: diagnosticsFor(() => doc(text), () => ({ detected: { shell: 'bash', source: 'default' } }) as never, 'en', settings, 'vscode').shown,
      shown: issueFilter(doc(text), settings, 'vscode'),
    } as never);
    const ignoring = { ...defaultSettings(), 'diagnostics.ignore': ['arith-invalid-number'] };
    // (By a comment, and by `diagnostics.ignore`: the Problems lists and the box read the same rule, `issueFilter`.)
    for (const [text, line, settings] of [['# bash-explainer disable=arith-invalid-number\necho $((09))', 1, defaultSettings()], ['echo $((09))', 0, ignoring]] as const) {
      const message = update(text, line, settings);
      assert.deepStrictEqual(message.problems, [], text);
      assert.deepStrictEqual(message.marks, [], text);
      assert.deepStrictEqual(message.notes.map((n) => n.level), ['error'], text);
      assert.match(message.notes[0].body, /^Invalid number `09`/);
    }
    // (Not silenced: in the box, and not among the notes. The pitfalls of `diagnostics.pitfalls` off are notes too, the errors stay.)
    const loud = update('echo $((09))', 0, defaultSettings());
    assert.strictEqual(loud.problems.length, 1);
    assert.deepStrictEqual(loud.notes, []);
    const noPitfalls = update('read line; echo $((09))', 0, { ...defaultSettings(), 'diagnostics.pitfalls': false });
    assert.deepStrictEqual(noPitfalls.problems.map((p) => p.level), ['error']);
    assert.deepStrictEqual(noPitfalls.notes.map((n) => n.level), ['info']);
    // (Silenced on a line, not on another line with the same text.)
    const two = '# bash-explainer disable=arith-invalid-number\necho $((09))\necho $((09))';
    assert.deepStrictEqual([1, 2].map((l) => update(two, l, defaultSettings()).problems.length), [0, 1]);
    // (A statement over several lines: the cursor's own line, not silenced, does not let in a problem silenced on another line. The box
    // and the list agree on every line: the box holds only what the list shows.)
    const off = '# bash-explainer disable=arith-invalid-number\n';
    for (const text of [`${off}echo $((09)) \\\n  b`, `${off}echo $((09)) |\n  cat`, 'echo $((09)) \\\n  $((08)) # bash-explainer disable=arith-invalid-number']) {
      const settings = defaultSettings();
      const shown = diagnosticsFor(() => doc(text), () => ({ detected: { shell: 'bash', source: 'default' } }) as never, 'en', settings, 'vscode').shown;
      for (let l = 0; l < text.split('\n').length; l++) {
        const inBox = update(text, l, settings).problems.map((p) => p.text);
        const listed = shown.map((i) => i.message);
        assert.deepStrictEqual(inBox.filter((t) => !listed.includes(t)), [], `${text} @${l}`);
      }
    }
    // (Where the settings turn the problems off, none is in the box.)
    assert.deepStrictEqual(update('echo $((09))', 0, { ...defaultSettings(), 'diagnostics.enabled': false }).problems, []);
  });

  it('puts errors first, and leaves plain notes and the caveats that are no problems as notes', () => {
    assert.deepStrictEqual(box('read line; x = 1').map((p) => p.level), ['error', 'info']);
    // (`ssh-local-expansion` stays a note: no problem in the editors.)
    assert.deepStrictEqual(box('ssh host "echo $x"'), []);
    assert.deepStrictEqual(box('echo hello'), []);
    const message = panelUpdate({ lang: 'en', explanation: explain('ssh host "echo $x"'), line: 0, lineText: 'ssh host "echo $x"', file: 'f', choice: {}, detected: { shell: 'bash', source: 'default' }, placement: 'first', animations: false, doc: doc('ssh host "echo $x"') } as never);
    assert.strictEqual(message.notes.length > 0, true);
    assert.deepStrictEqual(message.problems, []);
    assert.deepStrictEqual(message.marks, []);
  });

  it('links a problem to the rows it is about, by their paths in the list', () => {
    const ex = placeExamples(explain('echo $((09))'));
    const { rows, places } = rowModel(ex, DEPTH1, 'en');
    const [p] = boxProblems(ex, places, 'en', () => true);
    assert.strictEqual(p.rows.length, 1);
    const at = p.rows[0].split('.').map(Number).reduce<{ children: typeof rows; label?: string }>((t, i) => t.children[i], { children: rows });
    assert.strictEqual(at.label, '09');
    // (About two places: a row each, and one fix for both.)
    const two = box('cp $a b; cp $a c').find((x) => x.fixes.length)!;
    assert.strictEqual(two.rows.length, 2);
    assert.strictEqual(two.fixes.length, 1);
    // (A note about no node has no row: no link.)
    assert.deepStrictEqual(boxProblems({ ...explain('echo a'), notes: ['⚠ x'], noteInfo: [{ text: '⚠ x', level: 'warning', label: '', body: 'x', head: 'h', code: 'c' }] }, new Map(), 'en', () => true).map((p) => p.rows), [[]]);
  });

  it('points to a problem on the line of a construct around, unless the line says it too', () => {
    const text = 'for f in $(ls); do\n  echo hi\ndone';
    const all = documentIssues(doc(text), 'en', {});
    const ex = explain(text, 1);
    assert.deepStrictEqual(ex.context.map((c) => c.line), [0]);
    const pointers = problemsAround(ex, all, [], 'en');
    assert.ok(pointers.length > 0);
    assert.deepStrictEqual(pointers.map((p) => [p.level, p.where, p.title, p.line]).slice(0, 1), [['info', 'Caveat on line 1', 'Go to line 1', 0]]);
    assert.match(pointers[0].head, /split on spaces/);
    assert.strictEqual(problemsAround(explain(text, 1, 'ja'), documentIssues(doc(text), 'ja', {}), [], 'ja')[0].where, '行 1 の注意');
    // (Its own line, and a problem it says itself, are in the box.)
    assert.deepStrictEqual(problemsAround({ line: 0, context: [{ line: 0, label: 'x' } as never] }, all, [], 'en'), []);
    assert.deepStrictEqual(problemsAround(ex, all, all.map((i) => ({ text: i.message })) as never, 'en'), []);
  });
});
