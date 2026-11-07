// The phone's summary row of the cursor's line as data (src/ui/summaryRow.ts; docs/design/chrome-redesign.md, step
// C8b): the line's first problem by level, else its "In short" sentence, else its summary, else that there is nothing
// to explain. The page draws it under the folded sheet's tabs and on the keyboard (test/web-keyboard.test.ts).
import * as assert from 'assert';
import { LEVELS } from '../src/levels';
import { summaryRow } from '../src/ui/summaryRow';
import { diagnosticsFor } from '../src/document';
import { openDocument, shellsOf } from '../src/document-setup';
import { defaultSettings } from '../src/settings';
import { createUnbashParser } from '../src/syntax/adapters/unbash';
import { explain } from './support/explain';

const parser = createUnbashParser();

/** The problems the list shows of a script, as the page gets them (src/document.ts, `diagnosticsFor`). */
const shown = (src: string, lang: 'en' | 'ja', settings = defaultSettings()) => {
  const doc = openDocument(src, 'shell', (text) => parser.parse(text));
  return diagnosticsFor(() => doc, () => shellsOf(src.split('\n'), 'x.sh', undefined), lang, settings, 'web').shown;
};
const row = (src: string, line: number, lang: 'en' | 'ja', settings = defaultSettings()) => summaryRow(explain(src, line, lang, { sentence: true }), shown(src, lang, settings), line, lang);

describe('the summary row of a line', () => {
  it('shows the line\'s first problem by level, with its level\'s mark, in the words of the Problems list', () => {
    // Two pitfalls: the first found. Plain text: no backticks.
    assert.deepStrictEqual(row('rm -rf $DIR/*', 0, 'en'), {
      level: 'warning', mark: LEVELS.warning.mark,
      text: 'Pitfall: if DIR is empty this becomes rm -r /*, deleting from the root. Write "${DIR:?}"/* to stop when it is empty',
    });
    assert.deepStrictEqual(row('rm -rf $DIR/*', 0, 'ja'), {
      level: 'warning', mark: '⚠', text: '落とし穴: DIR が空だと rm -r /* になり、ルートから削除してしまいます。"${DIR:?}"/* と書くと、空のときは止まります',
    });
    // An error, without "Error:" (its mark says it, as in the Problems list), before the line's other problems.
    const error = row('[ -f $x ]; [ -f y', 0, 'en');
    assert.deepStrictEqual([error.level, error.mark], ['error', 'ⓧ']);
    assert.ok(error.text.startsWith('[ has no ] as its last argument'), error.text);
    assert.deepStrictEqual(explain('[ -f $x ]; [ -f y', 0, 'en').noteInfo.map((n) => n.level).sort(), ['error', 'info']);
    // A caveat, with its word.
    const caveat = row('set -e\nlocal x=$(false)', 1, 'en');
    assert.deepStrictEqual([caveat.level, caveat.mark], ['info', 'ⓘ']);
    assert.ok(caveat.text.startsWith('Caveat: local can be used only inside a function'), caveat.text);
  });

  it('shows the line\'s sentence where it has no problem, also next to a caveat the catalog keeps a note', () => {
    assert.deepStrictEqual(row('ls -l', 0, 'en'), { mark: '', text: 'Runs ls (list directory contents) using -l (long format).' });
    assert.deepStrictEqual(row('cd /tmp; echo `date`', 0, 'ja'), { mark: '', text: 'cd（カレントディレクトリを移動する）を実行する。続けて、echo（引数を空白区切りで標準出力に表示する）を実行する。' });
    // (`ssh-local-expansion` is a caveat, but no problem in the editors.)
    const ssh = explain('ssh host "echo $HOME"', 0, 'en', { sentence: true });
    assert.deepStrictEqual(ssh.noteInfo.map((n) => n.level), ['info']);
    assert.deepStrictEqual(summaryRow(ssh, shown('ssh host "echo $HOME"', 'en'), 0, 'en'), { mark: '', text: 'Runs ssh (connect to a remote host over SSH).' });
  });

  it('shows only what the Problems list shows: a problem turned off is not in the row', () => {
    const sentence = { mark: '', text: 'Runs rm (remove files) using -r (remove directories and their contents) and -f (ignore nonexistent files, never prompt).' };
    const rm = 'rm -rf $DIR/*';
    const off = (change: Partial<ReturnType<typeof defaultSettings>>) => ({ ...defaultSettings(), ...change });
    // A comment in the script, for every level's problem of the line.
    assert.deepStrictEqual(row(`# bash-explainer disable=rm-empty-variable-root,unquoted-variable-as-path\n${rm}`, 1, 'en'), sentence);
    // A comment for one of the two: the row says the other.
    assert.match(row(`# bash-explainer disable=rm-empty-variable-root\n${rm}`, 1, 'en').text, /^Pitfall: /);
    assert.notStrictEqual(row(`# bash-explainer disable=rm-empty-variable-root\n${rm}`, 1, 'en').text, row(rm, 0, 'en').text);
    // The settings: an ignored code, the problems off, the pitfalls off (an error stays).
    assert.deepStrictEqual(row(rm, 0, 'en', off({ 'diagnostics.ignore': ['rm-empty-variable-root', 'unquoted-variable-as-path'] })), sentence);
    assert.deepStrictEqual(row(rm, 0, 'en', off({ 'diagnostics.enabled': false })), sentence);
    assert.deepStrictEqual(row(rm, 0, 'en', off({ 'diagnostics.pitfalls': false })), sentence);
    assert.strictEqual(row('[ -f y', 0, 'en', off({ 'diagnostics.pitfalls': false })).level, 'error');
  });

  it('takes the highest level first, then from the left, and only the problems of the line', () => {
    const line = (severity: 'error' | 'warning' | 'info', startCol: number, startLine = 0) => ({ code: 'x', severity, message: `${severity} ${startCol}`, head: 'h', startLine, startCol, endLine: startLine, endCol: startCol + 1 });
    const ex = explain('ls', 0, 'en', { sentence: true });
    const pick = (...list: ReturnType<typeof line>[]) => summaryRow(ex, list, 0, 'en').text;
    assert.strictEqual(pick(line('info', 0), line('warning', 5), line('error', 9)), 'error 9');
    assert.strictEqual(pick(line('warning', 5), line('warning', 2)), 'warning 2');
    assert.strictEqual(pick(line('error', 0, 1), line('info', 3)), 'info 3');
  });

  it('shows what a line without code is, and says when there is nothing to explain', () => {
    assert.deepStrictEqual(row('# a comment', 0, 'en'), { mark: '', text: 'Comment: everything after # is ignored' });
    assert.deepStrictEqual(row('# a comment', 0, 'ja'), { mark: '', text: 'コメント: # から行末までは実行されない' });
    assert.deepStrictEqual(row('ls\n\nls', 1, 'en'), { mark: '', text: 'Nothing to explain on this line.' });
    assert.deepStrictEqual(row('ls\n\nls', 1, 'ja'), { mark: '', text: 'この行には解説する内容がありません。' });
  });
});
