// What the tool says of itself: an example's result it does not show, and a line or a file it could not read: a limit of
// the tool or a bug of it, never a finding about the script. Spread into `MESSAGES` (src/messages.ts).
import { type Catalog, type Entry, note } from './messages-entry';
import type { Head } from './messages-levels';

/**
 * That a line or a file was not read: a warning, since no one can say that the line fails every time (an error says that),
 * though a check that could not read it has not passed (`isNotRead`: the command-line tool exits with status 2).
 */
const unreadable = <P = Record<string, never>>(text: (p: P) => readonly [string, string], head: (p: P) => Head): Entry<P> & { level: 'warning'; head: (p: P) => Head } =>
  ({ kind: 'note', refs: [], text, head, level: 'warning' });

/** The notes said in place of an example's result (a limit, or a bug of the tool), and of a line a bug left unexplained. */
export const TOOL_NOTES = {
  // (Said in the example in place of its result, of what the guard does not run: src/examples/regexguard.ts.)
  'regex-not-computed': note(['3.2.5.2', '3.5.8.1'], () => ['結果は計算しない: このパターンはこの文字列では時間がかかりすぎるおそれがある。一致するかどうかは、この例では示さない', 'Not computed: this pattern may take too long on this text. This example does not say whether it matches']),
  // (Said in place of the output of a `printf` whose digits depend on the machine: src/examples/floatdigits.ts.)
  'digits-not-computed': note(['4.2'], () => ['この数の最後の桁は、機械の浮動小数点型によって変わるため、出力は示さない', "The last digit of this number depends on the machine's floating-point type, so no output is shown"]),
  // (The next five are about the tool, not the manual: they cite no section, and test/messages.test.ts names them as `ABOUT_THE_TOOL`.)
  // (Said so where the values a runner makes run out, not a pattern: `x=$x$x`, jq's `.+.`.)
  'size-not-computed': note([], () => ['結果は計算しない: 作られる値が大きくなりすぎるおそれがある。出力は、この例では示さない', 'Not computed: the values this makes may get too large. This example does not show its output']),
  // (Said so where the steps of a runner run out: `jq -n 'def f: f; f'`, awk's `while(1);`.)
  'steps-not-computed': note([], () => ['結果は計算しない: 手順が多すぎて、終わらないおそれがある。出力は、この例では示さない', 'Not computed: this takes too many steps, and may never end. This example does not show its output']),
  // (Said so where what is left of the line's limit, or the line's share of a long document's, ran out: src/examples/regexguard.ts.)
  'budget-not-computed': note([], () => ['結果は計算しない: この行の例に使える分を超えるおそれがある（長いスクリプトでは1行あたりの分が小さくなる）。出力は、この例では示さない', 'Not computed: this may take more than what is left for the examples of this line (each line has less in a long script). This example does not show its output']),
  // (Said so where the panel's box of a Python pattern holds text past what its examples show: src/examples/rerun.ts, `PY_SHOWN`.)
  'python-text-not-computed': note([], () => ['結果は計算しない: Python の `re` は、ASCII 以外の文字と制御文字を独自の規則で読む（`\\d` は全角の「１」にも一致する など）。この例で試せるのは、ASCII の文字だけ',
    "Not computed: Python's `re` reads characters past ASCII, and control characters, by its own rules (`\\d` matches `１` too). This example tries ASCII text only"]),
  // (A boundary, src/failures.ts: the bug itself is told where the product logs.)
  'example-failed': note([], () => ['結果は示さない: この例の計算が Bash Explainer の不具合で失敗した。行の説明の他の部分は、そのまま読める', 'Not shown: computing this example failed, a bug of Bash Explainer. The rest of the explanation of this line stands']),
  'line-not-explained': note([], () => ['この行は説明できなかった: Bash Explainer の不具合で説明の途中に失敗した。スクリプトの誤りではない', 'This line could not be explained: Bash Explainer failed while explaining it, a bug of the tool, not a problem of the script']),
} satisfies Catalog;

export const UNREAD = {
  // (No bug, so nothing is logged, and a problem where the file or the line is, so that a check that could not read it does not pass: src/document.ts.)
  'line-too-deep': unreadable(() => ['この行は説明できなかった: 入れ子が深すぎて、このツールでは最後までたどれない。ツールの限界で、スクリプトの誤りではない', 'This line could not be explained: it nests too deep for this tool to follow to the end. That is a limit of the tool, not an error in the script'],
    () => ['入れ子が深すぎて最後までたどれないので、この行は説明されない。', 'The line nests too deep to follow to the end, so it is not explained.']),
  'file-not-read': unreadable<{ why: 'too-deep' | 'failed' }>(({ why }) => (why === 'too-deep'
    ? ['このファイルは読めなかった: 入れ子が深すぎて、このツールでは構文を読み取れない。中身は説明しない。ツールの限界で、スクリプトの誤りではない', 'This file could not be read: it nests too deep for the parser of this tool, and nothing in it is explained. That is a limit of the tool, not an error in the script']
    : ['このファイルは読めなかった: Bash Explainer の不具合で読み取りに失敗した。スクリプトの誤りではない', 'This file could not be read: Bash Explainer failed while reading it, a bug of the tool, not a problem of the script']),
    ({ why }) => (why === 'too-deep'
      ? ['入れ子が深すぎて読めないので、このファイルは何も説明されない。', 'The file nests too deep to be read, so none of it is explained.']
      : ['Bash Explainer の不具合で読めなかったので、このファイルは何も説明されない。', 'A bug of the tool stopped it reading the file, so none of it is explained.'])),
} satisfies Catalog;

/** Whether `code` says that a line or a file was not read: no finding about the script, so that no count of findings holds it. */
export const isNotRead = (code: string | undefined): boolean => code === 'line-too-deep' || code === 'file-not-read';
