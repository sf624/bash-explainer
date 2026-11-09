import { lineLabel } from './i18n';
import { codeSpan, shorten } from './label';
import type { NoteLevel } from './levels';
import { type Catalog, caveat, failure, note, pitfall, saying, suggests, withBasis, withConvention, type Words } from './messages-entry';
import type { Head } from './messages-levels';
import { type ExitRefusedParams, exitRefusedText, type Stops } from './messages-posix';
import type { Rewrite } from './rewrite';
import { type ErrexitStopParams, errexitStopRefs, errexitStopText } from './messages-errexit-stop';

// The catalog's facts on exit statuses (src/statusfacts.ts, src/explain/status.ts): what `exit` and `return` give, where
// `set -e` is off or ignored, what hides a failure, the status of `((i++))`, and what a condition always decides. Spread
// into `MESSAGES` (src/messages.ts).

/** What stops in `postfix…` under `set -e`, in the headline. */
const POSTFIX_STOPS: Record<Stops, Head> = {
  script: ['スクリプトが止まる', 'the script stops'],
  subshell: ['サブシェルが終わる', 'the subshell ends'],
  unknown: ['実行しているシェルが止まる', 'the shell running it stops'],
};

/** The headline of `postfix-increment-status` and `postfix-decrement-status`. */
function postfixHead(written: string, v: string, errexit: boolean | undefined, stops: Stops = 'script'): Head {
  const [ja, en] = POSTFIX_STOPS[stops];
  return errexit
    ? [`\`set -e\` が有効なので、\`${v}\` が 0 のとき、ここで${ja}。`, `With \`set -e\` on, ${en} here when \`${v}\` is 0.`]
    : [`\`${v}\` が 0 のとき、\`${written}\` の終了ステータスは 1 になる。`, `\`${written}\` has status 1 when \`${v}\` is 0.`];
}

/** (`errexit`: `set -e` is on where the statement runs and not ignored: the script stops at the first 0, so a warning.) */
const postfixLevel = ({ errexit }: { errexit?: boolean }): NoteLevel => (errexit ? 'warning' : 'info');

export const STATUS_MESSAGES = {
  // ---------------------------------------------------------------- exit status (3.7.5)
  // (`command`: the builtin's name as written; `ends`: what it ends, from the status model: `exit` the shell, `return` a
  // function or a sourced file. The manual's section 2 says an exit status is restricted to eight bits, and 3.7.5 that
  // it falls between 0 and 255: that implies, without stating it, what `exit 300` and `exit -1` give. 4.1 states it for
  // `return` (its least significant 8 bits), so only `exit` is checked. The builtin is in the text, so that `exit 300`
  // and `return 300` on one line are two notes, each with its basis.)
  'exit-modulo': withBasis(note<{ command: string; value: string; status: number; ends: 'shell' | 'function' }>(['3.7.5'], ({ command, value, status }) => [
    `終了ステータスは 0〜255 なので、\`${command} ${value}\` では 256 で割った余りの ${status} になる`,
    `An exit status is 0–255, so \`${command} ${value}\` gives ${status} (the value modulo 256)`]),
  ({ ends }) => (ends === 'shell' ? { kind: 'checked', probe: 'status#exit-status', also: ['status#exit-negative'] } : undefined)),

  'exit-refused': failure<ExitRefusedParams>(['4.1', '6.11'], exitRefusedText,
    ({ why, word, exits }) => (why === 'too-many'
      ? ['`exit` に語を複数渡すと終了せず、シェルは続く。', '`exit` given more than one word does not exit, and the shell goes on.']
      : exits
        ? [`\`${word}\` は数でないので、\`exit\` はエラーを出して終了ステータス 2 で終わる。`, `\`${word}\` is no number, so \`exit\` reports an error and exits with status 2.`]
        : [`\`${word}\` は数でないので、\`exit\` はエラーを出し、シェルは続く。`, `\`${word}\` is no number, so \`exit\` reports an error, and the shell goes on.`])),

  // ---------------------------------------------------------------- errexit (4.3.1, 4.3.2)
  // (`form`: `$( )`, or bash 5.3's `${ …; }` and `${| …; }`. For `$( )`, 3.7.3 and 4.3.2 (`inherit_errexit`) say that
  // bash unsets `-e` in a command substitution's subshell. bash 5.3's forms run in the shell itself, and neither manual
  // says what `set -e` does there: checked, with bash 5.3.)
  'errexit-off-in-substitution': withBasis(note<{ first: string; form: string }>(['4.3.1', '4.3.2', '3.5.4'], ({ first, form }) => [
    `bash は \`${form}\` の中では \`set -e\` を切る（\`shopt -s inherit_errexit\` が無いとき）。\`${first}\` が失敗しても、あとのコマンドは実行される`,
    `bash turns \`set -e\` off inside \`${form}\` (without \`shopt -s inherit_errexit\`): if \`${first}\` fails, the commands after it still run`]),
  ({ form }) => (form === '$( )' ? undefined : { kind: 'checked', probe: 'status#funsub-errexit' })),
  'errexit-set-called-where-ignored': note<{ name: string; line: number }>(['4.3.1'], ({ name, line }) => [
    `この \`set -e\` は \`${name}\` の呼び出しが終わるまで効かない: \`${name}\` は \`set -e\` が無視される所（${lineLabel('ja', line)}）から呼ばれる`,
    `This \`set -e\` takes effect only when the call of \`${name}\` returns: \`${name}\` is called where \`set -e\` is ignored (${lineLabel('en', line, 'inline')})`]),
  'errexit-set-maybe-called-where-ignored': note<{ name: string; line: number }>(['4.3.1'], ({ name, line }) => [
    `\`${name}\` は \`set -e\` が無視される所（${lineLabel('ja', line)}）からも呼ばれ、そのときこの \`set -e\` は呼び出しが終わるまで効かない`,
    `\`${name}\` is also called where \`set -e\` is ignored (${lineLabel('en', line, 'inline')}); there this \`set -e\` takes effect only when the call returns`]),
  'errexit-set-in-ignored-subshell': note<{ where: Words }>(['4.3.1'], ({ where }) => [
    `この \`set -e\` は効かない: このサブシェルは ${where.ja}にあり、そこでは \`set -e\` が無視される`,
    `This \`set -e\` has no effect: this subshell runs ${where.en}, where \`set -e\` is ignored`]),
  'errexit-set-in-ignored-group': note<{ where: Words }>(['4.3.1'], ({ where }) => [
    `この \`set -e\` は、それを含むコマンドが終わるまで効かない: ${where.ja}では \`set -e\` が無視される`,
    `This \`set -e\` takes effect only when the command that holds it ends: \`set -e\` is ignored ${where.en}`]),
  'errexit-function-called-only-where-ignored': note<{ name: string; line: number }>(['4.3.1', '3.3'], ({ name, line }) => [
    `\`${name}\` は \`set -e\` が無視される所（${lineLabel('ja', line)}）からしか呼ばれないので、その中でも \`set -e\` は無視される。途中のコマンドが失敗しても止まらず、次のコマンドに進む`,
    `\`${name}\` is called only where \`set -e\` is ignored (${lineLabel('en', line, 'inline')}), so it is ignored in all of its body too: a command that fails in the middle does not stop it`]),
  'errexit-group-where-ignored': note<{ what: string; where: Words }>(['4.3.1'], ({ what, where }) => [
    `${where.ja}で実行されるので、${what}の中でも \`set -e\` は無視される。途中のコマンドが失敗しても止まらず、次のコマンドに進む`,
    `\`set -e\` is ignored in this ${what}, since it runs ${where.en}: a command that fails in the middle does not stop it`]),
  // (Where a failure under `set -e` stops the script, which traps run then, and the status it ends with:
  // src/messages-errexit-stop.ts, from the models; docs/design/errexit-stop.md, section 4. 4.1 is `trap`.)
  'errexit-stops-here': { ...note<ErrexitStopParams>(['4.3.1', '4.1', '3.7.5'], (p) => [errexitStopText('ja', p), errexitStopText('en', p)]), refsOf: errexitStopRefs },
  // (4.2 says that `local` and `declare` (`typeset`) return 0 unless an option, a name or a readonly variable is wrong,
  // 4.1 the same of `export` and `readonly`: a failed command substitution is not among the reasons. `rewrite`: src/statusfacts.ts.)
  'declaration-masks-status': saying(withConvention(suggests(caveat<{ kw: string; v: string; rewrite: readonly Rewrite[] }>(['4.2', '4.1', '4.3.1'], ({ kw, v, rewrite }) => [
    `\`${kw} ${v}=$(…)\` の終了ステータスは \`${kw}\` 自身のもの（成功）になり、\`$(…)\` の中の失敗が隠れます（\`set -e\` でも止まりません）。${codeSpan(shorten(rewrite[0].code, Infinity))} と分けて書きます`,
    `the status of \`${kw} ${v}=$(…)\` is that of \`${kw}\` (success), which hides a failure inside \`$(…)\` (even from \`set -e\`). Split it: ${codeSpan(shorten(rewrite[0].code, Infinity))}`],
    ({ kw, v }) => [`\`${kw} ${v}=$(…)\` は \`$(…)\` の中の失敗を隠す。`, `\`${kw} ${v}=$(…)\` hides a failure inside \`$(…)\`.`])), 'declare-then-assign'), 'errexit'),
  'pipefail-missing': saying(withConvention(caveat<{ last: string }>(['3.2.3', '4.3.1'], ({ last }) => [
    `\`set -o pipefail\` が無いので、パイプラインの終了ステータスは最後のコマンド（\`${last}\`）のものだけになる。前のコマンドが失敗しても \`set -e\` では止まらない（このスクリプトのほかのパイプラインも同じ）`,
    `without \`set -o pipefail\`, the status of a pipeline is that of its last command (\`${last}\`) alone, so \`set -e\` does not stop the script when a command before it fails (the same holds for the other pipelines of the script)`],
    ({ last }) => [`\`set -o pipefail\` がないので、\`${last}\` より前の失敗では \`set -e\` で止まらない。`, `Without \`set -o pipefail\`, \`set -e\` does not stop on a failure before \`${last}\`.`]), 'pipefail'), 'pipeStatus', 'errexit'),
  // A program that counts a status other than 0 as a success, where `set -e` stops on it (`CommandSpec.exits`, `success`:
  // buildozer's 3, no file needed a change): a run that finds the work done stops there. `text`: when it gives it, from
  // the spec; `stops`: the script, a subshell, or a shell not known. (4.3.1: `set -e` exits on a status other than 0;
  // 3.7.5: what an exit status is.)
  'errexit-stops-on-success': saying(pitfall<{ name: string; status: number; text: Words; stops: Stops }>(['4.3.1', '3.7.5'], ({ name, status, text, stops }) => {
    const [ja, en] = POSTFIX_STOPS[stops];
    return [
      `\`${name}\` は${text.ja}とき終了ステータス ${status} で終わります。\`set -e\` が有効なので、そのとき${ja}。作業が済んだあとの実行（スクリプトの2回目の実行など）は、この行より先に進みません。続けるには \`… || [ $? -eq ${status} ]\` と書きます`,
      `\`${name}\` exits with status ${status} when ${text.en}. With \`set -e\` on, ${en} here then: a run that finds the work done (a second run of the script) does not go past this line. To go on, write \`… || [ $? -eq ${status} ]\``];
  },
  ({ name, status }) => [`\`set -e\` が有効なので、\`${name}\` が成功の意味で終了ステータス ${status} を返すと、ここで止まる。`, `With \`set -e\` on, a status ${status} of \`${name}\`, which means success, stops here.`], undefined, 'warning'), 'errexit'),
  // (3.2.4: the status of a list is that of its last command run; 3.3: a function's is that of the last command of its
  // body; 6.1: a script's is that of its last command. `rewrite`: an `if`, then `return 0` or `exit 0`; src/statusfacts.ts.)
  'function-last-test-returns-status': suggests(caveat<{ name: string; line: number; rewrite: readonly Rewrite[] }>(['3.3', '3.2.4', '6.1'], ({ name, line, rewrite: r }) => [
    `これは関数 \`${name}\` の最後のコマンドなので、\`&&\` の左側が失敗すると \`${name}\` はその終了ステータス（0 以外）を返し、${lineLabel('ja', line)} の呼び出しで終わるスクリプトもその終了ステータスになる。${codeSpan(shorten(r[0].code, Infinity))} と書くか、最後に \`${r[1].code}\` を置く`,
    `this is the last command of \`${name}\`, so when the left side of \`&&\` fails, \`${name}\` returns its non-zero status, and so does the script, which ends with the call on ${lineLabel('en', line, 'inline')}. Write ${codeSpan(shorten(r[0].code, Infinity))}, or end the function with \`${r[1].code}\``],
    ({ name }) => [`\`&&\` の左側が失敗すると、\`${name}\` は 0 以外を返す。`, `When the left side of \`&&\` fails, \`${name}\` returns a non-zero status.`])),
  'function-last-test-stops-script': saying(suggests(pitfall<{ name: string; line: number; rewrite: readonly Rewrite[] }>(['3.3', '3.2.4', '4.3.1'], ({ name, line, rewrite: r }) => [
    `これは関数 \`${name}\` の最後のコマンドなので、\`&&\` の左側が失敗すると \`${name}\` はその終了ステータス（0 以外）を返し、\`set -e\` により${lineLabel('ja', line)} の呼び出しでスクリプトが止まる。${codeSpan(shorten(r[0].code, Infinity))} と書くか、最後に \`${r[1].code}\` を置く`,
    `this is the last command of \`${name}\`, so when the left side of \`&&\` fails, \`${name}\` returns its non-zero status and \`set -e\` stops the script at the call on ${lineLabel('en', line, 'inline')}. Write ${codeSpan(shorten(r[0].code, Infinity))}, or end the function with \`${r[1].code}\``],
    ({ name }) => [`\`&&\` の左側が失敗すると、\`${name}\` の呼び出しで \`set -e\` がスクリプトを止める。`, `When the left side of \`&&\` fails, \`set -e\` stops the script at the call of \`${name}\`.`])), 'errexit'),
  'script-last-test-returns-status': suggests(caveat<{ left: string; rewrite: readonly Rewrite[] }>(['3.2.4', '6.1', '3.7.5'], ({ left, rewrite: r }) => [
    `これはスクリプトの最後のコマンドなので、\`${left}\` が失敗すると、スクリプトはその終了ステータス（0 以外）で終わり、呼び出し元（CI や \`make\`、\`./script && next\`）には失敗に見えます。${codeSpan(shorten(r[0].code, Infinity))} と書くか、最後に \`${r[1].code}\` を置きます`,
    `this is the last command of the script, so when \`${left}\` fails, the script ends with its non-zero status, which its caller (CI, \`make\`, \`./script && next\`) sees as a failure. Write ${codeSpan(shorten(r[0].code, Infinity))}, or end the script with \`${r[1].code}\``],
    ({ left }) => [`\`${left}\` が失敗すると、スクリプトは 0 以外の終了ステータスで終わる。`, `When \`${left}\` fails, the script ends with a non-zero status.`])),
  // `cmd || echo "msg"` where its status matters: the end of a function or of a script (`fragment`: a file with no
  // shebang, which may be run as one), or where `set -e` stops the script (`where`). `quiet`: the redirections of `cmd`
  // that discard its own error message (`2>/dev/null`), or ''. `rewrite`: src/statusfacts.ts; `sourced`: it ends with
  // `return 1 2>/dev/null || exit 1`. (3.2.4: a list's status is that of its last command; 3.3: a function's, that of
  // its last command; 4.3.1: a failure left of `||` does not stop `set -e`. 6.1, 3.6, 4.1 not cited: at most three.)
  'failure-reported-as-success': saying(suggests(pitfall<{ where: 'function' | 'script' | 'fragment' | 'errexit'; name: string; left: string; right: string; quiet: string; sourced: boolean; rewrite: readonly Rewrite[] }>(['3.2.4', '3.3', '4.3.1'], ({ where, name, left, right, quiet, sourced, rewrite }) => {
    const ja = {
      function: `これは関数 \`${name}\` の最後のコマンドなので、\`${left}\` が失敗しても \`${name}\` は \`${right}\` の終了ステータス 0 を返し、呼び出し元には成功に見えます。`,
      script: `これはスクリプトの最後のコマンドなので、\`${left}\` が失敗してもスクリプトは \`${right}\` の終了ステータス 0 で終わり、呼び出し元（cron や CI、\`./script && next\`）には成功に見えます。`,
      fragment: `このファイルをスクリプトとして実行すると、これが最後のコマンドなので、\`${left}\` が失敗してもスクリプトは \`${right}\` の終了ステータス 0 で終わり、呼び出し元（cron や CI、\`./script && next\`）には成功に見えます。`,
      errexit: `\`${left}\` が失敗しても、\`||\` の左側の失敗では \`set -e\` は止まらず、\`${right}\` が成功するので、スクリプトはそのまま続きます。`,
    }[where];
    const en = {
      function: `this is the last command of \`${name}\`, so when \`${left}\` fails, \`${name}\` still returns 0, the status of \`${right}\`: its caller sees success.`,
      script: `this is the last command of the script, so when \`${left}\` fails, the script still ends with status 0, the status of \`${right}\`: what runs it (cron, CI, \`./script && next\`) sees success.`,
      fragment: `if this file is run as a script, this is its last command, so when \`${left}\` fails, the script still ends with status 0, the status of \`${right}\`: what runs it (cron, CI, \`./script && next\`) sees success.`,
      errexit: `when \`${left}\` fails, \`set -e\` does not stop the script (a failure on the left of \`||\` is ignored), and \`${right}\` succeeds, so the script goes on.`,
    }[where];
    const fix = shorten(rewrite[0].code, Infinity); // (a group over several lines: its first line)
    return [
      `${ja}${quiet ? `また、\`${quiet}\` でコマンド自身のエラーメッセージも捨てられるので、理由を伝えるのはこのメッセージだけです。` : ''}${where === 'errexit' ? 'スクリプトを止めるには' : '失敗を伝えるには'} \`… || ${fix}\` と書きます${sourced ? '。ファイルが `source` で読み込まれたときは `return` で戻り、実行されたときは `exit` で終わります' : ''}`,
      `${en}${quiet ? ` And \`${quiet}\` discards the error message of the command itself, so only this message is left to say why.` : ''} ${where === 'errexit' ? 'To stop the script' : 'To pass the failure on'}, write \`… || ${fix}\`${sourced ? ': it returns when the file is sourced, and exits when it is run' : ''}`];
  },
    ({ where, name, left }) => ({
      function: [`\`${left}\` が失敗しても、\`${name}\` は成功（終了ステータス 0）を返す。`, `If \`${left}\` fails, \`${name}\` still returns success (status 0).`],
      script: [`\`${left}\` が失敗しても、スクリプトは終了ステータス 0 で終わる。`, `If \`${left}\` fails, the script still ends with status 0.`],
      fragment: [`スクリプトとして実行すると、\`${left}\` が失敗しても終了ステータス 0 で終わる。`, `Run as a script, it still ends with status 0 if \`${left}\` fails.`],
      errexit: [`\`${left}\` が失敗しても、\`set -e\` はスクリプトを止めない。`, `If \`${left}\` fails, \`set -e\` does not stop the script.`],
    } satisfies Record<typeof where, Head>)[where])), 'errexit'),

  // ---------------------------------------------------------------- arithmetic and status (6.5, 4.3.1)
  // (`errexit`: `set -e` surely stops the shell there, the warning: the text leads with that and why. `stops`: the shell
  // it stops, from the status model; none means the script. `rewrite`: src/explain/status.ts.)
  // (6.5: the operators' values are those of C; 3.2.5.2: `(( ))` is 1 when the value is 0. That an assignment with no
  // command substitution is 0 is 3.7.1's, not cited: an entry cites at most three sections.)
  'postfix-increment-status': saying(suggests(pitfall<{ v: string; errexit?: boolean; stops?: 'script' | 'subshell' | 'unknown'; rewrite: readonly Rewrite[] }>(['6.5', '3.2.5.2', '4.3.1'], ({ v, errexit, stops, rewrite: r }) => errexit ? [
    `ここでは \`set -e\` が効いているので、\`${v}\` が 0 のときこの行で${stops === 'subshell' ? 'サブシェルが終わる' : stops === 'unknown' ? 'これを実行するシェルが止まる' : 'スクリプトが止まる'}。\`((${v}++))\` の値は増やす前の値で、0 は失敗の終了ステータスになるため。${r.map((x) => `\`${x.code}\``).join(' か ')} と書く`,
    `\`set -e\` is on here, so ${stops === 'subshell' ? 'the subshell ends' : stops === 'unknown' ? 'the shell running it stops' : 'the script stops'} at this line when \`${v}\` is 0: \`((${v}++))\` gives the value before the increment, and 0 is a failure status. Write ${r.slice(0, -1).map((x) => `\`${x.code}\``).join(', ')} or \`${r[r.length - 1].code}\``] : [
    `\`((${v}++))\` の値は増やす前の値なので、\`${v}\` が 0 のとき終了ステータスは 1 になる（\`set -e\` ではスクリプトが止まる）。${r.map((x) => `\`${x.code}\``).join(' や ')} なら 0 になる`,
    `the value of \`((${v}++))\` is the value before the increment, so the exit status is 1 when \`${v}\` is 0 (under \`set -e\` the script stops). ${r[1] ? `\`${r[0].code}\` and \`${r[1].code}\` give` : `\`${r[0].code}\` gives`} status 0`],
    ({ v, errexit, stops }) => postfixHead(`((${v}++))`, v, errexit, stops), undefined, postfixLevel)), 'errexit'),
  'postfix-decrement-status': saying(pitfall<{ v: string; errexit?: boolean; stops?: 'script' | 'subshell' | 'unknown' }>(['6.5', '3.2.5.2', '4.3.1'], ({ v, errexit, stops }) => errexit ? [
    `ここでは \`set -e\` が効いているので、\`${v}\` が 0 のときこの行で${stops === 'subshell' ? 'サブシェルが終わる' : stops === 'unknown' ? 'これを実行するシェルが止まる' : 'スクリプトが止まる'}。\`((${v}--))\` の値は減らす前の値で、0 は失敗の終了ステータスになるため`,
    `\`set -e\` is on here, so ${stops === 'subshell' ? 'the subshell ends' : stops === 'unknown' ? 'the shell running it stops' : 'the script stops'} at this line when \`${v}\` is 0: \`((${v}--))\` gives the value before the decrement, and 0 is a failure status`] : [
    `\`((${v}--))\` の値は減らす前の値なので、\`${v}\` が 0 のとき終了ステータスは 1 になる（\`set -e\` ではスクリプトが止まる）`,
    `the value of \`((${v}--))\` is the value before the decrement, so the exit status is 1 when \`${v}\` is 0 (under \`set -e\` the script stops)`],
    ({ v, errexit, stops }) => postfixHead(`((${v}--))`, v, errexit, stops), undefined, postfixLevel), 'errexit'),

  // ---------------------------------------------------------------- conditions decided by the values above (3.2.4, 3.2.5; src/statusfacts.ts)
  // (`which`: `if` or `elif` when both are on the line, else empty: "this condition".)
  'condition-always-false': note<{ values: Words; which: string }>(['3.2.5.2'], ({ values, which }) => [
    `ここでは ${values.ja}なので、${which ? `\`${which}\` の条件` : 'この条件'}は常に偽になり、\`then\` の後のコマンドは実行されない`,
    `${values.en} here, so ${which ? `the \`${which}\` condition` : 'this condition'} is always false: the commands after its \`then\` never run`]),
  'condition-always-true': note<{ values: Words; rest: { kinds: string[]; count: number }; which: string }>(['3.2.5.2'], ({ values, rest, which }) => [
    `ここでは ${values.ja}なので、${which ? `\`${which}\` の条件` : 'この条件'}は常に真になり、${rest.count ? `後の分岐（${rest.kinds.map((k) => `\`${k}\``).join('・')}）は実行されない` : '`then` の後のコマンドは必ず実行される'}`,
    `${values.en} here, so ${which ? `the \`${which}\` condition` : 'this condition'} is always true: ${rest.count ? `${rest.count > 1 ? 'the branches' : 'the branch'} after it (${rest.kinds.map((k) => `\`${k}\``).join(', ')}) never ${rest.count > 1 ? 'run' : 'runs'}` : 'the commands after its `then` always run'}`]),
  'loop-never-runs': note<{ values: Words }>(['3.2.5.1'], ({ values }) => [
    `ここでは ${values.ja}なので、ループは最初の判定で終わり、本体は一度も実行されない`,
    `${values.en} here, so the loop stops at its first test: its body never runs`]),
  'loop-never-ends': note<{ values: Words }>(['3.2.5.1'], ({ values }) => [
    `ここでは ${values.ja}なので、条件ではこのループは終わらない。終わるのは \`break\`・\`return\`・\`exit\`、シグナルかエラーのときだけ`,
    `${values.en} here, so the condition never stops this loop: it ends only through \`break\`, \`return\`, \`exit\`, a signal or an error`]),
  'and-or-right-never-runs': note<{ values: Words; op: string }>(['3.2.4'], ({ values, op }) => [
    `ここでは ${values.ja}なので、\`${op}\` の左側は常に${op === '&&' ? '失敗' : '成功'}し、右側のコマンドは実行されない`,
    `${values.en} here, so the left side of \`${op}\` always ${op === '&&' ? 'fails' : 'succeeds'}: the command after it never runs`]),
  'case-runs-only': note<{ values: Words; branches: Words; several: boolean }>(['3.2.5.2'], ({ values, branches, several }) => [
    `ここでは ${values.ja}なので、この \`case\` で実行されるのは ${branches.ja} の分岐だけ`,
    `${values.en} here, so only ${branches.en} of this \`case\` ${several ? 'run' : 'runs'}`]),
  'case-runs-none': note<{ values: Words }>(['3.2.5.2'], ({ values }) => [
    `ここでは ${values.ja}なので、この \`case\` のどのパターンにも一致せず、どの分岐も実行されない`,
    `${values.en} here, so no pattern of this \`case\` matches: none of its branches runs`]),
  // (The hint that fades a statement that never runs, `deadCodeHints`, src/document.ts.)
  'dead-code': note(['3.2.5.2', '3.2.4'], () => [
    'ここは実行されない: 条件が成り立たない分岐、`&&` や `||` の実行されない側、または `break`・`continue`・`return`・`exit` の後にある',
    'This never runs: it is in a branch whose condition is never met, on the side of `&&` or `||` that is skipped, or after `break`, `continue`, `return` or `exit`']),

} satisfies Catalog;
