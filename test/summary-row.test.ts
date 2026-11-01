// The phone's summary row of the cursor's line as data (src/ui/summaryRow.ts; docs/design/chrome-redesign.md, step
// C8b): the line's first problem by level, else its "In short" sentence, else its summary, else that there is nothing
// to explain. The page draws it under the folded sheet's tabs and on the keyboard (test/web-keyboard.test.ts).
import * as assert from 'assert';
import { LEVELS } from '../src/levels';
import { summaryRow } from '../src/ui/summaryRow';
import { explain } from './support/explain';

const row = (src: string, line: number, lang: 'en' | 'ja') => summaryRow(explain(src, line, lang, { sentence: true }), lang);

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
    assert.deepStrictEqual(row('ls -l', 0, 'en'), { mark: '', text: 'Runs ls (list directory contents) using -l (long format (permissions, owner, size, mtime)).' });
    assert.deepStrictEqual(row('cd /tmp; echo `date`', 0, 'ja'), { mark: '', text: 'cd（カレントディレクトリを移動する）を実行する。続けて、echo（引数を空白区切りで標準出力に表示する）を実行する。' });
    // (`ssh-local-expansion` is a caveat, but no problem in the editors.)
    const ssh = explain('ssh host "echo $HOME"', 0, 'en', { sentence: true });
    assert.deepStrictEqual(ssh.noteInfo.map((n) => n.level), ['info']);
    assert.deepStrictEqual(summaryRow(ssh, 'en'), { mark: '', text: 'Runs ssh (connect to a remote host over SSH (optionally run a command)).' });
  });

  it('shows what a line without code is, and says when there is nothing to explain', () => {
    assert.deepStrictEqual(row('# a comment', 0, 'en'), { mark: '', text: 'Comment: everything after # is ignored' });
    assert.deepStrictEqual(row('# a comment', 0, 'ja'), { mark: '', text: 'コメント: # から行末までは実行されない' });
    assert.deepStrictEqual(row('ls\n\nls', 1, 'en'), { mark: '', text: 'Nothing to explain on this line.' });
    assert.deepStrictEqual(row('ls\n\nls', 1, 'ja'), { mark: '', text: 'この行には解説する内容がありません。' });
  });
});
