import { basisOf, type Basis, type BasisSpec, type TryIt } from './basis';
import type { ConventionId } from './conventions';
import { invisibleList, pictureList, visibleChar } from './ctlchars';
import type { Lang, Text } from './i18n';
import { codeSpan, shorten } from './label';
import { type FindRefusalParams, findRefusalRefs, findRefusalText } from './messages-find';
import { extglobText, globstarText, type LoopHow, type LoopPattern, unmatchedGlobText } from './messages-glob';
import { type ExitRefusedParams, exitRefusedText, ends, type PosixExitParams, posixExitText, type Stops } from './messages-posix';
import type { Rewrite } from './rewrite';
import type { NameFacts, NameKind } from './semantics/names';
import type { ShebangRefusal } from './semantics/state';
import type { ExpansionValue } from './semantics/values';

// The message catalog: the notes and pitfalls that render a fact of the semantic models (src/semantics/: the shell
// state, where code runs, words, names, status), each with a stable id, its texts in ja and en, and the sections of
// the Bash manual it is about (src/manual.ts). The renderers show the sections as links, or as "(Bash manual 3.7.5)"
// in the CLI; the JSON output gives the id.
//
// The texts are the analyzer's: a fact is found where the model is read (src/explain/, src/statusfacts.ts,
// src/wordfacts.ts), and said here. The style checks of src/pitfalls.ts are not facts and have no entry.

/** `note`: a fact of the models, always said. `pitfall`: advice on how a script is written, said only when the pitfalls are on. */
export type FactKind = 'note' | 'pitfall';

/**
 * How much a note matters, the one source of its severity in every output (docs/design/note-levels.md):
 * - `warning` (⚠ "Pitfall" / 「落とし穴」, the editor's yellow squiggle): the line breaks as written, or if it goes
 *   wrong the damage cannot be undone (`x = 1`, `[-f x]`, `rm -rf $DIR/*` with an empty DIR, a stop under `set -u`).
 * - `info` (ⓘ "Caveat" / 「注意」, blue): it goes wrong only with some values or systems and the damage is limited, or
 *   a failure goes unnoticed (`echo $x`, `read line`, `local x=$(false)`). A dialect note on a construct that works
 *   differently in the target shell is `info` too, with the word "Portability" / 「移植性」.
 * - `note` (ℹ, no word, no squiggle): a fact of how the shell runs the line.
 * A level that depends on the case (the command a word is given to, how far a failure reaches) is a function of the
 * params (`unquoted-variable-as-path`, `nounset-unbound`).
 */
export type NoteLevel = 'warning' | 'info' | 'note';

interface Entry<P> {
  kind: FactKind;
  refs: readonly string[];
  /** The sections the fact cites in a case, some of `refs` (all it may cite), when they depend on the params. */
  refsOf?: (p: P) => readonly string[];
  /** The text in Japanese and English, without the mark (and the heading) that `level` and `kind` give. */
  text: (p: P) => readonly [ja: string, en: string];
  /** Only on a pitfall: what follows the mark in place of "落とし穴: " / "注意: " (empty: nothing). */
  heading?: Text;
  /** The level (by default `warning` for a pitfall, `note` for a note); a function when it depends on the params. */
  level?: NoteLevel | ((p: P) => NoteLevel);
  /** `false`: a warning or caveat that stays a note, never a problem in the editors (`notProblem`, `isProblem`). */
  problem?: false;
  /**
   * Where the fact is bash's behaviour rather than the manual's, or has a command to try it: the probe row that checks
   * it (src/basis.ts, `withBasis`); a function when it depends on the params. None: the manual's sections in `refs`.
   */
  basis?: BasisSpec | ((p: P) => BasisSpec | undefined);
  /**
   * A pitfall whose advice is a habit (sorted "both": docs/design/basis-spec-convention.md, 2.3): the habit, from the
   * table of src/conventions.ts (`withConvention`). The basis stays the fact's.
   */
  convention?: ConventionId;
  /** The rewrites the fact carries (`Fact.rewrite`, docs/design/oracles.md 3.2), from the params, as `suggests` gives them. */
  rewrite?: (p: P) => readonly Rewrite[];
}

const note = <P = Record<string, never>>(refs: readonly string[], text: (p: P) => readonly [string, string]): Entry<P> => ({ kind: 'note', refs, text });
/** A fact that says the line fails when it runs: a note at the level of a warning. */
const failure = <P = Record<string, never>>(refs: readonly string[], text: (p: P) => readonly [string, string]): Entry<P> => ({ kind: 'note', refs, text, level: 'warning' });
const pitfall = <P = Record<string, never>>(refs: readonly string[], text: (p: P) => readonly [string, string], heading?: Text, level?: NoteLevel | ((p: P) => NoteLevel)): Entry<P> =>
  ({ kind: 'pitfall', refs, text, ...(heading ? { heading } : {}), ...(level ? { level } : {}) });
/** A pitfall at the level `info`: harmless with most values, systems or paths. */
const caveat = <P = Record<string, never>>(refs: readonly string[], text: (p: P) => readonly [string, string], heading?: Text): Entry<P> => pitfall(refs, text, heading, 'info');
/**
 * A caveat that stays a note: the panel, the hover and the CLI say it with its level, but it is no problem in the
 * editors, since it is often meant, or wrong where a file is read after the option is set (docs/design/note-levels.md,
 * "Notes as problems").
 */
const notProblem = <P>(e: Entry<P>): Entry<P> => ({ ...e, problem: false });
/** An entry with its basis: the probe row that checks it and gives a try-it (src/basis.ts, docs/design/basis.md). */
const withBasis = <P>(e: Entry<P>, basis: BasisSpec | ((p: P) => BasisSpec | undefined)): Entry<P> => ({ ...e, basis });
/** A pitfall whose advice is a habit, beside the fact it states (src/conventions.ts). */
const withConvention = <P>(e: Entry<P>, convention: ConventionId): Entry<P> => ({ ...e, convention });
/** An entry whose suggestion is rewrites: its params carry them (`rewrite`), its text renders their code, its fact those with edits. */
const suggests = <P extends { rewrite: readonly Rewrite[] }>(e: Entry<P>): Entry<P> => ({ ...e, rewrite: (p) => p.rewrite.filter((r) => r.edits.length) });

/** `local-outside-function` in a file with no shebang (`sourced`): a function may read it with `source`, and `local` then works. */
const withSourced =(sourced: boolean | undefined, [ja, en]: readonly [string, string]): readonly [string, string] => (sourced ? [
  `${ja}。ただし、このファイルにはシバンがないので、関数の中から \`source\` で読み込まれたときは、\`local\` はその関数のローカル変数を宣言します`,
  `${en}. But this file has no shebang: when a function reads it with \`source\`, \`local\` works there, and declares a variable of that function`] : [ja, en]);

/** Headings of pitfalls whose text names its own kind of problem. */
const NO_HEADING: Text = { ja: '', en: '' };
const SYSTEM_DEPENDENT: Text = { ja: '環境依存: ', en: 'System-dependent: ' };

/** A text in both languages, for a parameter that is itself words (where `set -e` is ignored…). */
type Words = Text;

/** (`errexit`: `set -e` is on where the statement runs and not ignored: the script stops at the first 0, so a warning.) */
const postfixLevel = ({ errexit }: { errexit?: boolean }): NoteLevel => (errexit ? 'warning' : 'info');

export const MESSAGES = {
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

  'exit-refused': failure<ExitRefusedParams>(['4.1', '6.11'], exitRefusedText),

  // ---------------------------------------------------------------- errexit (4.3.1, 4.3.2)
  // (`form`: `$( )`, or bash 5.3's `${ …; }` and `${| …; }`. For `$( )`, 3.7.3 and 4.3.2 (`inherit_errexit`) say that
  // bash unsets `-e` in a command substitution's subshell. bash 5.3's forms run in the shell itself, and neither manual
  // says what `set -e` does there: checked, with bash 5.3.)
  'errexit-off-in-substitution': withBasis(note<{ first: string; form: string }>(['4.3.1', '4.3.2', '3.5.4'], ({ first, form }) => [
    `bash は \`${form}\` の中では \`set -e\` を切る（\`shopt -s inherit_errexit\` が無いとき）。\`${first}\` が失敗しても、あとのコマンドは実行される`,
    `bash turns \`set -e\` off inside \`${form}\` (without \`shopt -s inherit_errexit\`): if \`${first}\` fails, the commands after it still run`]),
  ({ form }) => (form === '$( )' ? undefined : { kind: 'checked', probe: 'status#funsub-errexit' })),
  'errexit-set-called-where-ignored': note<{ name: string; line: number }>(['4.3.1'], ({ name, line }) => [
    `この \`set -e\` は \`${name}\` の呼び出しが終わるまで効かない: \`${name}\` は \`set -e\` が無視される所（行 ${line}）から呼ばれる`,
    `This \`set -e\` takes effect only when the call of \`${name}\` returns: \`${name}\` is called where \`set -e\` is ignored (line ${line})`]),
  'errexit-set-maybe-called-where-ignored': note<{ name: string; line: number }>(['4.3.1'], ({ name, line }) => [
    `\`${name}\` は \`set -e\` が無視される所（行 ${line}）からも呼ばれ、そのときこの \`set -e\` は呼び出しが終わるまで効かない`,
    `\`${name}\` is also called where \`set -e\` is ignored (line ${line}); there this \`set -e\` takes effect only when the call returns`]),
  'errexit-set-in-ignored-subshell': note<{ where: Words }>(['4.3.1'], ({ where }) => [
    `この \`set -e\` は効かない: このサブシェルは ${where.ja}にあり、そこでは \`set -e\` が無視される`,
    `This \`set -e\` has no effect: this subshell runs ${where.en}, where \`set -e\` is ignored`]),
  'errexit-set-in-ignored-group': note<{ where: Words }>(['4.3.1'], ({ where }) => [
    `この \`set -e\` は、それを含むコマンドが終わるまで効かない: ${where.ja}では \`set -e\` が無視される`,
    `This \`set -e\` takes effect only when the command that holds it ends: \`set -e\` is ignored ${where.en}`]),
  'errexit-function-called-only-where-ignored': note<{ name: string; line: number }>(['4.3.1', '3.3'], ({ name, line }) => [
    `\`${name}\` は \`set -e\` が無視される所（行 ${line}）からしか呼ばれないので、その中でも \`set -e\` は無視される。途中のコマンドが失敗しても止まらず、次のコマンドに進む`,
    `\`${name}\` is called only where \`set -e\` is ignored (line ${line}), so it is ignored in all of its body too: a command that fails in the middle does not stop it`]),
  'errexit-group-where-ignored': note<{ what: string; where: Words }>(['4.3.1'], ({ what, where }) => [
    `${where.ja}で実行されるので、${what}の中でも \`set -e\` は無視される。途中のコマンドが失敗しても止まらず、次のコマンドに進む`,
    `\`set -e\` is ignored in this ${what}, since it runs ${where.en}: a command that fails in the middle does not stop it`]),
  // (4.2 says that `local` and `declare` (`typeset`) return 0 unless an option, a name or a readonly variable is wrong,
  // 4.1 the same of `export` and `readonly`: a failed command substitution is not among the reasons. `rewrite`: src/statusfacts.ts.)
  'declaration-masks-status': withConvention(suggests(caveat<{ kw: string; v: string; rewrite: readonly Rewrite[] }>(['4.2', '4.1', '4.3.1'], ({ kw, v, rewrite }) => [
    `\`${kw} ${v}=$(…)\` の終了ステータスは \`${kw}\` 自身のもの（成功）になり、\`$(…)\` の中の失敗が隠れます（\`set -e\` でも止まりません）。${codeSpan(shorten(rewrite[0].code, Infinity))} と分けて書きます`,
    `the status of \`${kw} ${v}=$(…)\` is that of \`${kw}\` (success), which hides a failure inside \`$(…)\` (even from \`set -e\`). Split it: ${codeSpan(shorten(rewrite[0].code, Infinity))}`])), 'declare-then-assign'),
  'pipefail-missing': withConvention(caveat<{ last: string }>(['3.2.3', '4.3.1'], ({ last }) => [
    `\`set -o pipefail\` が無いので、パイプラインの終了ステータスは最後のコマンド（\`${last}\`）のものだけになる。前のコマンドが失敗しても \`set -e\` では止まらない（このスクリプトのほかのパイプラインも同じ）`,
    `without \`set -o pipefail\`, the status of a pipeline is that of its last command (\`${last}\`) alone, so \`set -e\` does not stop the script when a command before it fails (the same holds for the other pipelines of the script)`]), 'pipefail'),
  // (3.2.4: the status of a list is that of its last command run; 3.3: a function's is that of the last command of its
  // body; 6.1: a script's is that of its last command. `rewrite`: an `if`, then `return 0` or `exit 0`; src/statusfacts.ts.)
  'function-last-test-returns-status': suggests(caveat<{ name: string; line: number; rewrite: readonly Rewrite[] }>(['3.3', '3.2.4', '6.1'], ({ name, line, rewrite: r }) => [
    `これは関数 \`${name}\` の最後のコマンドなので、\`&&\` の左側が失敗すると \`${name}\` はその終了ステータス（0 以外）を返し、行 ${line} の呼び出しで終わるスクリプトもその終了ステータスになる。${codeSpan(shorten(r[0].code, Infinity))} と書くか、最後に \`${r[1].code}\` を置く`,
    `this is the last command of \`${name}\`, so when the left side of \`&&\` fails, \`${name}\` returns its non-zero status, and so does the script, which ends with the call on line ${line}. Write ${codeSpan(shorten(r[0].code, Infinity))}, or end the function with \`${r[1].code}\``])),
  'function-last-test-stops-script': suggests(pitfall<{ name: string; line: number; rewrite: readonly Rewrite[] }>(['3.3', '3.2.4', '4.3.1'], ({ name, line, rewrite: r }) => [
    `これは関数 \`${name}\` の最後のコマンドなので、\`&&\` の左側が失敗すると \`${name}\` はその終了ステータス（0 以外）を返し、\`set -e\` により行 ${line} の呼び出しでスクリプトが止まる。${codeSpan(shorten(r[0].code, Infinity))} と書くか、最後に \`${r[1].code}\` を置く`,
    `this is the last command of \`${name}\`, so when the left side of \`&&\` fails, \`${name}\` returns its non-zero status and \`set -e\` stops the script at the call on line ${line}. Write ${codeSpan(shorten(r[0].code, Infinity))}, or end the function with \`${r[1].code}\``])),
  'script-last-test-returns-status': suggests(caveat<{ left: string; rewrite: readonly Rewrite[] }>(['3.2.4', '6.1', '3.7.5'], ({ left, rewrite: r }) => [
    `これはスクリプトの最後のコマンドなので、\`${left}\` が失敗すると、スクリプトはその終了ステータス（0 以外）で終わり、呼び出し元（CI や \`make\`、\`./script && next\`）には失敗に見えます。${codeSpan(shorten(r[0].code, Infinity))} と書くか、最後に \`${r[1].code}\` を置きます`,
    `this is the last command of the script, so when \`${left}\` fails, the script ends with its non-zero status, which its caller (CI, \`make\`, \`./script && next\`) sees as a failure. Write ${codeSpan(shorten(r[0].code, Infinity))}, or end the script with \`${r[1].code}\``])),
  // `cmd || echo "msg"` where its status matters: the end of a function or of a script (`fragment`: a file with no
  // shebang, which may be run as one), or where `set -e` stops the script (`where`). `quiet`: the redirections of `cmd`
  // that discard its own error message (`2>/dev/null`), or ''. `rewrite`: src/statusfacts.ts; `sourced`: it ends with
  // `return 1 2>/dev/null || exit 1`. (3.2.4: a list's status is that of its last command; 3.3: a function's, that of
  // its last command; 4.3.1: a failure left of `||` does not stop `set -e`. 6.1, 3.6, 4.1 not cited: at most three.)
  'failure-reported-as-success': suggests(caveat<{ where: 'function' | 'script' | 'fragment' | 'errexit'; name: string; left: string; right: string; quiet: string; sourced: boolean; rewrite: readonly Rewrite[] }>(['3.2.4', '3.3', '4.3.1'], ({ where, name, left, right, quiet, sourced, rewrite }) => {
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
  })),

  // ---------------------------------------------------------------- functions and what runs instead (3.3, 3.7.2)
  // (3.2.1: a reserved word is one only as the first word of a command. That bash then stops a script with a syntax
  // error, the manual only implies: 6.3.3, item 19, says that in an interactive shell "Parser syntax errors will not
  // cause the shell to exit". Checked.)
  'keyword-needs-separator': withBasis(failure<{ kw: string }>(['3.2.1', '3.2.5.1', '3.2.5.2'], ({ kw }) => [
    `構文エラー: \`${kw}\` の前に \`;\` か改行が要る。無いと \`${kw}\` はただの引数として読まれ、この構文に \`${kw}\` が無いので、bash は「syntax error near unexpected token」で止まる`,
    `Syntax error: a \`;\` or a newline is needed before \`${kw}\`. Without it \`${kw}\` is read as an ordinary argument, so this construct has no \`${kw}\` and bash stops with "syntax error near unexpected token"`]),
  { kind: 'checked', probe: 'state#keyword-separator' }),
  // (4.1: "When the [ form is used, the last argument to the command must be a ]"; 3.7.5: "All builtins return an exit
  // status of 2 to indicate incorrect usage, generally invalid options or missing arguments". The manual's; the probe
  // row's try-it is kept as data, which the views do not show for the manual's facts.)
  'bracket-missing-close': withBasis(failure(['4.1', '3.7.5', '6.4'], () => [
    '`[` は最後の引数が `]` でないので、実行するとエラーになり、条件は評価されません（`[: missing \']\'`、終了ステータス 2）。構文エラーではなく、コマンド `[` が実行時に出すエラーです',
    '`[` has no `]` as its last argument, so it fails when it runs, without evaluating the condition (`[: missing \']\'`, status 2). This is not a syntax error but an error of the command `[` at run time']),
  { kind: 'manual', probe: 'state#bracket-missing' }),
  'bracket-close-glued': withBasis(suggests(failure<{ word: string; rewrite: readonly Rewrite[] }>(['4.1', '3.7.5', '6.4'], ({ word, rewrite: [fix] }) => [
    `\`${word}\` の \`]\` は単語の一部なので、\`[\` の最後の引数は \`]\` ではありません。実行するとエラーになり、条件は評価されません（\`[: missing ']'\`、終了ステータス 2）。${fix ? `\`]\` の前に空白が要ります（\`${fix.code}\`）` : 'この `]` はエスケープされている（`\\]`）ので、空白を入れても単語の文字のままです。テストの終わりには、空白のあとに別の `]` を書きます'}`,
    `The \`]\` in \`${word}\` is part of the word, so \`[\` has no \`]\` as its last argument: it fails when it runs, without evaluating the condition (\`[: missing ']'\`, status 2). ${fix ? `\`]\` needs a space before it (\`${fix.code}\`)` : 'This `]` is escaped (`\\]`): with a space before it, it is still a character of the word. End the test with another `]`, after a space'}`])),
  { kind: 'manual', probe: 'state#bracket-missing' }),
  // (4.1: `test` and `[` "return a status of 0 (true) or 1 (false)", and two arguments whose first is no unary
  // operator, or three that are no binary test, `!` or `( )`, are false. bash fails with status 2 ("unary operator
  // expected"): differs. With four or more, 4.1 says only that they are "parsed and evaluated according to precedence".)
  'test-malformed': withBasis(failure<{ name: string }>(['4.1', '6.4'], ({ name }) => [
    `\`${name}\` はこの引数を条件式として読めないので、実行するとエラーになり、条件は評価されません（\`unary operator expected\`、\`binary operator expected\`、\`too many arguments\` など、終了ステータス 2）。構文エラーではなく、コマンド \`${name}\` が実行時に出すエラーです`,
    `\`${name}\` cannot read these arguments as a conditional expression, so it fails when it runs, without evaluating anything ("unary operator expected", "binary operator expected", "too many arguments"…, status 2). This is not a syntax error but an error of the command \`${name}\` at run time`]),
  { kind: 'differs', probe: 'state#test-malformed' }),
  'function-defined-later': note<{ name: string; line: number; runs: Words }>(['3.3'], ({ name, line, runs }) => [
    `\`${name}\` は行 ${line} で関数として定義されますが、この行はその前に実行されるので、まだ関数ではありません（${runs.ja}）`,
    `\`${name}\` is defined as a function on line ${line}, but this runs before that, so it is not the function yet (${runs.en})`]),
  'function-defined-in-subshell': note<{ name: string; line: number; runs: Words }>(['3.3', '3.7.3'], ({ name, line, runs }) => [
    `\`${name}\` は行 ${line} で関数として定義されますが、それはサブシェルの中で、サブシェルで定義した関数は終わると消えます。ここでは関数ではありません（${runs.ja}）`,
    `\`${name}\` is defined as a function on line ${line}, but in a subshell, and what a subshell defines is gone when it ends. It is not the function here (${runs.en})`]),
  'function-defined-in-uncalled-function': note<{ name: string; line: number; by: string; runs: Words }>(['3.3'], ({ name, line, by, runs }) => [
    `\`${name}\` は行 ${line} で関数 \`${by}\` の中で定義され、その関数がここより前に実行されないので、まだ関数ではありません（${runs.ja}）`,
    `\`${name}\` is defined on line ${line} inside the function \`${by}\`, which has not run before this, so it is not a function yet (${runs.en})`]),
  'function-defined-in-dead-branch': note<{ name: string; line: number; runs: Words }>(['3.3', '3.2.5.2'], ({ name, line, runs }) => [
    `\`${name}\` は行 ${line} で関数として定義されますが、そこは実行されないコード（条件が成り立たない分岐か、\`break\`・\`continue\`・\`return\`・\`exit\` の後）なので、関数ではありません（${runs.ja}）`,
    `\`${name}\` is defined as a function on line ${line}, but in code that never runs before this (a branch whose condition is never met, or after \`break\`, \`continue\`, \`return\` or \`exit\`), so it is not the function (${runs.en})`]),
  'function-removed-by-unset': note<{ name: string; line: number; runs: Words }>(['3.3', '4.1'], ({ name, line, runs }) => [
    `関数 \`${name}\` は行 ${line} の \`unset\` で削除されているので、ここでは関数ではありません（${runs.ja}）`,
    `The function \`${name}\` was removed by \`unset\` on line ${line}, so it is not a function here (${runs.en})`]),
  'special-builtin-before-function': note<{ name: string; line: number }>(['3.7.2', '6.11'], ({ name, line }) => [
    `POSIX モードでは特殊ビルトインが関数より先に見つかるので、行 ${line} の関数 \`${name}\` ではなく、ビルトインの \`${name}\` が動きます`,
    `In POSIX mode a special builtin is found before a function, so the builtin \`${name}\` runs, not the function \`${name}\` of line ${line}`]),
  // (4.1 says what `-f` and `-v` each do, not that both together are an error.)
  'unset-function-and-variable': withBasis(failure(['4.1'], () => [
    '`unset` に `-f` と `-v` を同時に指定するとエラーになり（`cannot simultaneously unset a function and a variable`、終了ステータス 1）、何も削除されません',
    '`unset` with both `-f` and `-v` is an error (`cannot simultaneously unset a function and a variable`, status 1): nothing is unset']),
  { kind: 'checked', probe: 'state#unset-fv' }),
  // (4.1: "Readonly variables and functions may not be unset", and the status is then not zero; that it is 1, the
  // manual does not say: checked.)
  'unset-readonly': withBasis(failure<{ name: string }>(['4.1', '4.2'], ({ name }) => [
    `変数 \`${name}\` は読み取り専用なので、\`unset\` はエラーになり（\`cannot unset: readonly variable\`、終了ステータス 1）、\`${name}\` は削除されません`,
    `The variable \`${name}\` is read-only, so \`unset\` fails (\`cannot unset: readonly variable\`, status 1) and \`${name}\` stays`]),
  { kind: 'checked', probe: 'state#unset-readonly' }),
  // (A variable bash makes read-only, `UID`, or the script: `readonly x`. `then`: what bash does next, when it is
  // known (bash, not in POSIX mode, where an assignment that is not before a command name ends the script): an
  // assignment of its own abandons the command of the script it is in, or ends the subshell it runs in; one before a
  // command name (`UID=0 echo hi`) leaves the command to run. 4.1 says that a readonly value "may not be changed by
  // subsequent assignment", and 3.7.1 that such an assignment is an error and "the command exits with a non-zero status":
  // for one before a command name, bash runs the command (differs); what bash abandons after one of its own, the manual
  // does not say outside POSIX mode (checked).)
  'assign-readonly': withBasis(failure<{ name: string; then?: 'abandons' | 'subshell' | 'runs' | 'exits' }>(['3.4', '4.1', '3.7.1'], ({ name, then }) => [
    `変数 \`${name}\` は読み取り専用なので、この代入はエラーになり（\`readonly variable\`）、\`${name}\` の値は変わりません${then === 'abandons'
      ? '。bash はそれを含むスクリプトのコマンドの残り（この行、または囲む繰り返しや関数呼び出し）を中断し、次のコマンドから続けます（終了ステータス 1）'
      : then === 'subshell' ? '。サブシェルはそこで終わります（終了ステータス 1）'
        : then === 'runs' ? '。コマンドは、この代入なしで実行されます'
          : then === 'exits' ? '。POSIX モードなので、bash はここでスクリプトを止めます（終了ステータス 1）' : ''}`,
    `The variable \`${name}\` is read-only, so this assignment fails (\`readonly variable\`) and \`${name}\` keeps its value${then === 'abandons'
      ? '; bash also abandons the rest of the command of the script it is in (the line, or the loop or function call around it) and goes on with the next one, status 1'
      : then === 'subshell' ? '; the subshell ends there, status 1'
        : then === 'runs' ? '; the command still runs, without it'
          : then === 'exits' ? '; in POSIX mode, bash stops the script here, status 1' : ''}`]),
  // (In POSIX mode, 6.11 says the shell exits: `exits` is the manual's.)
  ({ then }) => (then === 'runs' ? { kind: 'differs', probe: 'state#readonly-prefix' } : then && then !== 'exits' ? { kind: 'checked', probe: 'state#readonly-abandons' } : undefined)),
  // (What a restricted shell refuses, 6.10, where the state says the shell is one (src/explain/reads.ts,
  // `restrictedAt`): a builtin's call (`CommandSpec.restricted`: `name` the builtin, `word` what bash names after it), a
  // command name with a `/` (`name` the name), an output redirection (`name` its operator, `word` its target). Each
  // fails with status 1 (which `set -e` stops at, as any failure); a refused name or redirection leaves the command
  // not run. 6.10 lists what is refused, but not the status: checked.)
  'restricted-refused': withBasis(failure<{ kind: 'builtin' | 'slash' | 'redirect'; name: string; word?: string }>(['6.10'], ({ kind, name, word }) => {
    const shell = ['制限付きシェル（`bash -r`・`rbash`）なので、bash は', 'This is a restricted shell (`bash -r`, `rbash`), so bash refuses'];
    if (kind === 'builtin') {
      const said = `\`${name}: ${word ? `${word}: ` : ''}restricted\``;
      return [`${shell[0]}この \`${name}\` を拒否します（${said}）。何もせずに、終了ステータス 1 で失敗します`,
        `${shell[1]} this \`${name}\` (${said}): it does nothing, and fails with status 1`];
    }
    if (kind === 'slash') {
      return [`${shell[0]} \`/\` を含むコマンド名を拒否し（\`${name}: restricted\`、コマンド名に \`/\` は使えない。終了ステータス 1）、\`${name}\` を実行しません`,
        `${shell[1]} a command name with a \`/\` (\`${name}: restricted\`: no \`/\` in command names, status 1) and does not run \`${name}\``];
    }
    return [`${shell[0]}出力のリダイレクト \`${name}\` を拒否し（\`${word}: restricted: cannot redirect output\`、終了ステータス 1）、コマンドを実行しません`,
      `${shell[1]} the output redirection \`${name}\` (\`${word}: restricted: cannot redirect output\`, status 1) and does not run the command`];
  }), { kind: 'checked', probe: 'state#restricted' }),
  // (`RANDOM`, `SECONDS` and the other variables the manual says "lose their special properties" when unset;
  // `subshell`: why the `unset` runs in a subshell, which alone loses it.)
  'unset-ends-special': note<{ name: string; subshell?: string }>(['5.2', '3.7.3'], ({ name, subshell }) => subshell ? [
    `\`${name}\` は \`unset\` すると、このサブシェル（${subshell}）では bash の特別な働きがなくなり、あとで値を代入しても普通の変数になります（外のシェルの \`${name}\` はそのまま）`,
    `Once unset, \`${name}\` loses what bash does with it in this subshell (${subshell}): set again there, it is a plain variable (the shell outside keeps its \`${name}\`)`] : [
    `\`${name}\` は \`unset\` すると bash の特別な働きがなくなり、あとで値を代入しても普通の変数になります`,
    `Once unset, \`${name}\` loses what bash does with it: set again later, it is a plain variable`]),
  // (`stops`: in dash and busybox ash, which stop the shell that runs it there, the script, a subshell (which ends
  // only itself, status 2) or a shell not known to be either; bash goes on with status 1.)
  // (`sourced`: a file with no shebang (src/semantics/env.ts, `readAs`), which a function may read with `source`.)
  'local-outside-function': pitfall<{ stops: false | 'script' | 'subshell' | 'shell'; sourced?: boolean }>(['4.2'], ({ stops, sourced }) => withSourced(sourced, stops === 'script' ? [
    '`local` は関数の中でしか使えず、関数の外で使うと dash や busybox ash は「local: not in a function」のエラーでスクリプトを止めます',
    '`local` can be used only inside a function; outside one, dash and busybox ash stop the script with "local: not in a function"'] : stops === 'subshell' ? [
    '`local` は関数の中でしか使えず、関数の外で使うと dash や busybox ash は「local: not in a function」のエラーでこのサブシェルを終えます（終了ステータス 2。サブシェルの外は続きます）',
    '`local` can be used only inside a function; outside one, dash and busybox ash end this subshell with "local: not in a function" (status 2; what is outside the subshell goes on)'] : stops ? [
    '`local` は関数の中でしか使えず、関数の外で使うと dash や busybox ash は「local: not in a function」のエラーで、それを実行するシェルを止めます（サブシェルなら、終わるのはそのサブシェルだけです）',
    '`local` can be used only inside a function; outside one, dash and busybox ash stop the shell that runs it with "local: not in a function" (in a subshell, only the subshell ends)'] : [
    '`local` は関数の中でしか使えず、関数の外で使うと「can only be used in a function」のエラーになります',
    '`local` can be used only inside a function; outside one it fails with "can only be used in a function"']), undefined,
  ({ sourced }) => (sourced ? 'info' : 'warning')),

  // ---------------------------------------------------------------- POSIX mode (6.11, 4.4)
  // (6.11: "Function names may not be the same as one of the POSIX special builtins". That the definition then ends the
  // script, the manual does not say: checked.)
  'posix-special-function-name': withBasis(pitfall<{ stops?: Stops }>(['6.11', '4.4'], ({ stops = 'script' }) => [
    `POSIX モードでは特殊ビルトインと同じ名前の関数は定義できず、bash は「is a special builtin」のエラーになり、${ends(stops)[0]}。別の名前にします`,
    `in POSIX mode a function cannot have the name of a special builtin: bash says "is a special builtin" and ${ends(stops)[1]}. Use another name`]),
  { kind: 'checked', probe: 'state#posix-special-function' }),
  'posix-special-function-name-maybe': withBasis(caveat<{ stops?: Stops }>(['6.11', '4.4'], ({ stops = 'script' }) => [
    `POSIX モードでは特殊ビルトインと同じ名前の関数は定義できず、bash は「is a special builtin」のエラーになり、${ends(stops)[0]}（この前で POSIX モードにしているのは一部の経路だけ）。別の名前にします`,
    `in POSIX mode a function cannot have the name of a special builtin: bash says "is a special builtin" and ${ends(stops)[1]} (only some paths before here turn POSIX mode on). Use another name`]),
  { kind: 'checked', probe: 'state#posix-special-function' }),

  'posix-function-name': pitfall<{ stops?: Stops }>(['6.11', '3.3'], ({ stops = 'script' }) => [
    `POSIX モードの bash 5.2 は、名前として正しくない関数名を受け付けず、「not a valid identifier」のエラーになり、${ends(stops)[0]}（終了ステータス 2。bash 5.3 は定義する）。英数字と \`_\` だけの名前にします`,
    `in POSIX mode bash 5.2 refuses a function name that is not a valid name: it says "not a valid identifier" and ${ends(stops)[1]} (status 2; bash 5.3 defines the function). Use a name of letters, digits and \`_\``]),
  'posix-function-name-maybe': caveat<{ stops?: Stops }>(['6.11', '3.3'], ({ stops = 'script' }) => [
    `POSIX モードの bash 5.2 は、名前として正しくない関数名を受け付けず、「not a valid identifier」のエラーになり、${ends(stops)[0]}（この前で POSIX モードにしているのは一部の経路だけ。bash 5.3 は定義する）。英数字と \`_\` だけの名前にします`,
    `in POSIX mode bash 5.2 refuses a function name that is not a valid name: it says "not a valid identifier" and ${ends(stops)[1]} (only some paths before here turn POSIX mode on; bash 5.3 defines the function). Use a name of letters, digits and \`_\``]),
  'posix-special-builtin-error': pitfall<PosixExitParams>(['4.4', '6.11'], (p) => posixExitText(p, false)),
  'posix-special-builtin-error-maybe': caveat<PosixExitParams>(['4.4', '6.11'], (p) => posixExitText(p, true)),

  // ---------------------------------------------------------------- arithmetic and status (6.5, 4.3.1)
  // (`errexit`: `set -e` surely stops the shell there, the warning: the text leads with that and why. `stops`: the shell
  // it stops, from the status model; none means the script. `rewrite`: src/explain/status.ts.)
  // (6.5: the operators' values are those of C; 3.2.5.2: `(( ))` is 1 when the value is 0. That an assignment with no
  // command substitution is 0 is 3.7.1's, not cited: an entry cites at most three sections.)
  'postfix-increment-status': suggests(pitfall<{ v: string; errexit?: boolean; stops?: 'script' | 'subshell' | 'unknown'; rewrite: readonly Rewrite[] }>(['6.5', '3.2.5.2', '4.3.1'], ({ v, errexit, stops, rewrite: r }) => errexit ? [
    `ここでは \`set -e\` が効いているので、\`${v}\` が 0 のときこの行で${stops === 'subshell' ? 'サブシェルが終わる' : stops === 'unknown' ? 'これを実行するシェルが止まる' : 'スクリプトが止まる'}。\`((${v}++))\` の値は増やす前の値で、0 は失敗の終了ステータスになるため。${r.map((x) => `\`${x.code}\``).join(' か ')} と書く`,
    `\`set -e\` is on here, so ${stops === 'subshell' ? 'the subshell ends' : stops === 'unknown' ? 'the shell running it stops' : 'the script stops'} at this line when \`${v}\` is 0: \`((${v}++))\` gives the value before the increment, and 0 is a failure status. Write ${r.slice(0, -1).map((x) => `\`${x.code}\``).join(', ')} or \`${r[r.length - 1].code}\``] : [
    `\`((${v}++))\` の値は増やす前の値なので、\`${v}\` が 0 のとき終了ステータスは 1 になる（\`set -e\` ではスクリプトが止まる）。${r.map((x) => `\`${x.code}\``).join(' や ')} なら 0 になる`,
    `the value of \`((${v}++))\` is the value before the increment, so the exit status is 1 when \`${v}\` is 0 (under \`set -e\` the script stops). ${r[1] ? `\`${r[0].code}\` and \`${r[1].code}\` give` : `\`${r[0].code}\` gives`} status 0`], undefined, postfixLevel)),
  'postfix-decrement-status': pitfall<{ v: string; errexit?: boolean; stops?: 'script' | 'subshell' | 'unknown' }>(['6.5', '3.2.5.2', '4.3.1'], ({ v, errexit, stops }) => errexit ? [
    `ここでは \`set -e\` が効いているので、\`${v}\` が 0 のときこの行で${stops === 'subshell' ? 'サブシェルが終わる' : stops === 'unknown' ? 'これを実行するシェルが止まる' : 'スクリプトが止まる'}。\`((${v}--))\` の値は減らす前の値で、0 は失敗の終了ステータスになるため`,
    `\`set -e\` is on here, so ${stops === 'subshell' ? 'the subshell ends' : stops === 'unknown' ? 'the shell running it stops' : 'the script stops'} at this line when \`${v}\` is 0: \`((${v}--))\` gives the value before the decrement, and 0 is a failure status`] : [
    `\`((${v}--))\` の値は減らす前の値なので、\`${v}\` が 0 のとき終了ステータスは 1 になる（\`set -e\` ではスクリプトが止まる）`,
    `the value of \`((${v}--))\` is the value before the decrement, so the exit status is 1 when \`${v}\` is 0 (under \`set -e\` the script stops)`], undefined, postfixLevel),

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

  // ---------------------------------------------------------------- aliases (6.6)
  // (`off`: the script turned it off, `shopt -u expand_aliases`, which counts in an interactive shell too.)
  'alias-not-expanded-in-script': pitfall<{ name: string; value: string; off?: boolean }>(['6.6', '4.3.2'], ({ name, value, off }) => off ? [
    `\`shopt -u expand_aliases\` でエイリアスの展開が無効になっているので、\`${name}\` は対話シェルでも「command not found」になります。\`shopt -s expand_aliases\` で有効に戻すか、関数 \`${name}() { ${value} "$@"; }\` にします`,
    `alias expansion is turned off (\`shopt -u expand_aliases\`), so \`${name}\` is "command not found", also in an interactive shell. Turn it on again with \`shopt -s expand_aliases\`, or make it a function: \`${name}() { ${value} "$@"; }\``] : [
    `bash はスクリプトの中ではエイリアスを展開しないので、\`${name}\` は「command not found」になります。\`shopt -s expand_aliases\` を \`alias\` より前に書くか、関数 \`${name}() { ${value} "$@"; }\` にします（\`.bashrc\` など対話シェルで読むファイルなら問題ありません）`,
    `bash does not expand aliases in scripts, so \`${name}\` is "command not found". Put \`shopt -s expand_aliases\` before the \`alias\`, or make it a function: \`${name}() { ${value} "$@"; }\` (fine in files read by interactive shells, such as \`.bashrc\`)`]),
  // (A file with no shebang, which bash may run as a script or an interactive shell may read: src/semantics/state.ts.)
  'alias-maybe-not-expanded': caveat<{ name: string; value: string }>(['6.6', '4.3.2'], ({ name, value }) => [
    `このファイルにはシバンがありません。\`.bashrc\` のように対話シェルが読むなら \`${name}\` は展開されますが、スクリプトとして実行すると（\`bash ファイル\`）bash はエイリアスを展開しないので「command not found」になります。スクリプトなら \`shopt -s expand_aliases\` を \`alias\` より前に書くか、関数 \`${name}() { ${value} "$@"; }\` にします`,
    `this file has no shebang. Read by an interactive shell, as \`.bashrc\` is, \`${name}\` is expanded; but run as a script (\`bash file\`), bash does not expand aliases, so it is "command not found". Put \`shopt -s expand_aliases\` before the \`alias\` in a script, or make it a function: \`${name}() { ${value} "$@"; }\``]),
  'alias-defined-same-unit': note<{ name: string; line: number }>(['6.6'], ({ name, line }) => [
    `\`${name}\` は行 ${line} で \`alias\` として定義されますが、bash は行（複合コマンドや関数の本体も）をまとめて読んでから実行するので、同じ行で定義したエイリアスはまだ使えません。ここでは alias ではないので、\`${name}\` というコマンドがなければ「command not found」になります（\`eval\` に渡した文字列は実行時に読み直されるので、エイリアスが使えます）`,
    `\`${name}\` is defined as an alias on line ${line}, but bash reads a whole line (and a whole compound command or function body) before running it, so an alias defined on the same line is not in effect yet. It is not an alias here: without a command named \`${name}\`, this is "command not found" (a string given to \`eval\` is read again when it runs, so it can use the alias)`]),
  'unbraced-element': suggests(pitfall<{ name: string; sub: string; glob?: boolean; rewrite: readonly Rewrite[] }>(['6.7'], ({ name, sub, glob, rewrite: [fix] }) => [
    `\`$${name}${sub}\` は配列の要素ではありません: \`$${name}\`（\`\${${name}[0]}\` と同じ）の後に文字列 \`${sub}\` が続きます${glob ? '（ここではグロブにもなります）' : ''}。要素は \`${fix.code}\` と波かっこで囲んで書きます`,
    `\`$${name}${sub}\` is not an element of the array: it is \`$${name}\` (that is \`\${${name}[0]}\`) followed by the text \`${sub}\`${glob ? ' (a glob too, here)' : ''}. For the element, write \`${fix.code}\` with braces`])),
  'alias-defined-later': note<{ name: string; line: number }>(['6.6'], ({ name, line }) => [
    `\`${name}\` は行 ${line} で \`alias\` として定義されますが、これはその前に読まれ、エイリアスは実行された後に読まれるものにだけ効きます。ここでは alias ではないので、\`${name}\` というコマンドがなければ「command not found」になります（\`eval\` に渡した文字列は実行時に読み直されるので、エイリアスが使えます）`,
    `\`${name}\` is defined as an alias on line ${line}, but this is read before that, and an alias works only on what is read after it ran. It is not an alias here: without a command named \`${name}\`, this is "command not found" (a string given to \`eval\` is read again when it runs, so it can use the alias)`]),

  // ---------------------------------------------------------------- extended globs and globstar (3.5.8.1, 3.5.8, 4.3.2)
  // (3.5.8.1: extglob "changes the behavior of the parser", so it must be on "before parsing constructs containing the
  // patterns, including shell functions". That a pattern read without it is a syntax error, which stops the script,
  // the manual does not say: checked. A new shell starts with its own options (3.7.3 lists what a command run apart
  // gets, and `shopt` options are not among them); the try-it shows it.)
  // (3.5.8.1: with globstar, `**` matches "zero or more directories"; without it, two `*`, each of which matches no `/`.)
  'extglob-in-same-block': withBasis(pitfall<{ use: string }>(['3.5.8.1', '4.3.2'], extglobText('in-same-block')), { kind: 'checked', probe: 'state#extglob-off' }),
  'extglob-maybe-on': withBasis(caveat<{ use: string }>(['3.5.8.1', '4.3.2'], extglobText('maybe-on')), { kind: 'checked', probe: 'state#extglob-off' }),
  'extglob-turned-off': withBasis(pitfall<{ use: string }>(['3.5.8.1', '4.3.2'], extglobText('turned-off')), { kind: 'checked', probe: 'state#extglob-off' }),
  'extglob-not-found': withBasis(notProblem(caveat<{ use: string }>(['3.5.8.1', '4.3.2'], extglobText('not-found'))), { kind: 'checked', probe: 'state#extglob-off' }),
  'extglob-maybe-on-trap': withBasis(caveat<{ use: string }>(['3.5.8.1', '4.3.2', '4.1'], extglobText('maybe-on-trap')), { kind: 'checked', probe: 'state#extglob-off' }),
  'extglob-not-in-new-shell': withBasis(pitfall<{ use: string }>(['3.5.8.1', '4.3.2', '3.7.3'], extglobText('not-in-new-shell')), { kind: 'checked', probe: 'state#extglob-new-shell', also: ['state#extglob-off'] }),
  'globstar-maybe-on': caveat<{ on: string }>(['3.5.8', '4.3.2'], globstarText('maybe-on')),
  'globstar-not-found': notProblem(caveat<{ on: string }>(['3.5.8', '4.3.2'], globstarText('not-found'))),
  'globstar-unsupported': pitfall<{ shell: string }>(['3.5.8'], ({ shell }) => [
    `${shell} には globstar がなく、\`**\` は \`*\` と同じく1階層分にしか一致しません。サブディレクトリまでたどるには \`find\` を使います`,
    `${shell} has no globstar, so \`**\` is the same as \`*\` and matches one level only. To reach into subdirectories, use \`find\``]),

  // ---------------------------------------------------------------- what a wrapper or a new shell does not get (3.7.3, 3.7.4, 3.3)
  'variable-not-in-remote-shell': pitfall<{ v: string }>(['3.7.3', '3.7.4'], ({ v }) => [
    `\`$${v}\` はリモートのシェルが展開しますが、リモートにはこのスクリプトの変数 \`${v}\` はありません。値を送るなら、こちらで展開されるようダブルクォートの中に書きます`,
    `the remote shell expands \`$${v}\`, but it does not have \`${v}\`, a variable of this script. To send its value, write it in double quotes, so that it is expanded here`]),
  // (`keeps`: what the wrapper still passes of the environment, up to two names: sudo's `TERM`, `LANG`, `su -l`'s
  // `TERM`; `SlotLink.keeps`.)
  'variable-not-passed-by-wrapper': pitfall<{ v: string; via: string; keeps?: readonly string[] }>(['3.7.3', '3.7.4'], ({ v, via, keeps = [] }) => {
    const [a, b] = keeps.map((k) => `\`${k}\``);
    return [
      `文字列の中の \`$${v}\` は新しいシェルが展開しますが、\`${via}\` はこのスクリプトの変数を（エクスポートしたものも${b ? `、${a} や ${b} などいくつかを除いて` : a ? `、${a} を除いて` : ''}）渡さないので、そこには \`${v}\` はありません。値を使うなら、こちらで展開されるようダブルクォートの中に書きます`,
      `the new shell expands \`$${v}\` in the string, but \`${via}\` passes none of this script's variables (not even exported ones${b ? `, but for a few such as ${a} and ${b}` : a ? `, but for ${a}` : ''}), so \`${v}\` is not there. To use its value, write it in double quotes, so that it is expanded here`];
  }),
  // (`environment`: the script set it with no `unset`, `local` or `export -n` before, so it is exported when it came
  // from the environment, `maybe` (capitals) or `unlikely` (lower case): src/semantics/shellstate.ts, `fromEnvironment`.)
  // (`array`: bash exports no array, even one `export` marks, `declare -p` showing `-ax`. The Reference Manual does not
  // say it (the man page does, under BUGS: "Array variables may not (yet) be exported"): checked. Without it, 3.7.3 and
  // 3.7.4 say that a command run apart gets only what is exported.)
  'variable-not-exported': withBasis(pitfall<{ v: string; environment?: 'maybe' | 'unlikely'; array?: boolean }>(['3.7.3', '3.7.4'], ({ v, environment, array }) => (array ? [
    `文字列の中の \`$${v}\` は新しいシェルが展開しますが、\`${v}\` は配列で、bash は配列をエクスポートできない（\`export\` しても渡らない）ので、そこでは空です。値を渡すなら、\`"\${${v}[*]}"\` を引数として渡すか、文字列の変数にします`,
    `the new shell expands \`$${v}\` in the string, but \`${v}\` is an array, and bash cannot export an array (not even with \`export\`), so it is empty there. To pass its values, give \`"\${${v}[*]}"\` as an argument, or use a string variable`] : environment === 'maybe' ? [
    `文字列の中の \`$${v}\` は新しいシェルが展開します。\`${v}\` はこのスクリプトで設定していますが、エクスポートしていないので、そこに値が届くのは \`${v}\` が初めから環境変数にあったとき（環境変数から来た変数はエクスポートされています）だけで、そうでなければ空です。先に \`export ${v}\` します`,
    `the new shell expands \`$${v}\` in the string, and \`${v}\` is set by this script but not exported: its value gets there only when \`${v}\` was in the environment already (a variable from the environment is exported), and it is empty otherwise. Run \`export ${v}\` first`] : [
    `文字列の中の \`$${v}\` は新しいシェルが展開します。\`${v}\` はこのスクリプトの変数で、エクスポートされていないので、そこでは空です${environment ? `（環境変数に初めから \`${v}\` があるときを除く）` : ''}。先に \`export ${v}\` します`,
    `the new shell expands \`$${v}\` in the string, and \`${v}\` is a variable of this script that is not exported, so it is empty there${environment ? ` (unless the environment already has \`${v}\`)` : ''}. Run \`export ${v}\` first`]), undefined,
  ({ environment }) => (environment === 'maybe' ? 'info' : 'warning')),
  ({ array }) => (array ? { kind: 'checked', probe: 'state#export-array' } : undefined)),
  'function-not-in-container': pitfall<{ via: string; name: string }>(['3.3', '3.7.3'], ({ via, name }) => [
    `\`${via}\` は \`${name}\` をコンテナの中で実行します。このスクリプトの関数はコンテナの中にはないので使えません。関数の中身を直接書きます`,
    `\`${via}\` runs \`${name}\` inside the container, and a function from this script is not available in the container. Write out its body instead`]),
  'builtin-or-function-as-program': pitfall<{ via: string; name: string; isFn: boolean; fix: Words }>(['3.7.3', '3.3'], ({ via, name, isFn, fix }) => [
    `\`${via}\` は \`${name}\` を別のプログラムとして起動するため、シェルの${isFn ? '関数' : '組み込みコマンド'}は実行できません（\`command not found\` になるか、今のシェルには効きません）。${fix.ja}`,
    `\`${via}\` starts \`${name}\` as a separate program, so it cannot run a shell ${isFn ? 'function' : 'builtin'} ("command not found", or no effect on the current shell). ${fix.en}`]),
  'ssh-local-expansion': notProblem(caveat<{ risky: string }>(['3.7.1', '3.7.3'], ({ risky }) => [
    `\`ssh\` に渡すコマンドのうち \`${risky}\` は、送られる前にこちらのシェルが展開します（\`$変数\`・\`$(…)\`・\`*\`・\`~\` はこちらの値になります）。リモートで展開したいときは全体をシングルクォートで囲みます: \`ssh host '…'\``,
    `the local shell expands \`${risky}\` in the command given to \`ssh\` before it is sent (\`$var\`, \`$(…)\`, \`*\` and \`~\` take local values). To expand them on the remote side, single-quote the whole command: \`ssh host '…'\``])),
  'function-not-on-remote': pitfall<{ name: string }>(['3.3', '3.7.3'], ({ name }) => [
    `リモートのシェルには、このスクリプトの関数 \`${name}\` はありません。中身を直接書くか、\`ssh host "$(declare -f ${name}); ${name}"\` のように定義ごと送ります`,
    `the remote shell does not have this script's function \`${name}\`. Write out its body, or send the definition too: \`ssh host "$(declare -f ${name}); ${name}"\``]),
  'function-not-in-new-shell-blocked': pitfall<{ via: string; fn: string; blocker: string }>(['3.3', '3.7.3'], ({ via, fn, blocker }) => [
    `\`${via}\` は新しいシェルでコマンドを実行するため、このスクリプトの関数 \`${fn}\` は使えません。\`${blocker}\` は環境の関数を渡さないので、\`export -f ${fn}\` も効きません。関数の中身を直接書きます`,
    `\`${via}\` runs the command in a new shell, which does not have this script's function \`${fn}\`, and \`${blocker}\` passes no exported functions, so \`export -f ${fn}\` does not help either. Write out its body`]),
  'function-not-in-new-shell': pitfall<{ via: string; fn: string }>(['3.3', '3.7.3'], ({ via, fn }) => [
    `\`${via}\` は新しいシェルでコマンドを実行するため、このスクリプトの関数 \`${fn}\` は使えません。関数の中身を直接書きます`,
    `\`${via}\` runs the command in a new shell, which does not have this script's function \`${fn}\`. Write out its body`]),
  'function-not-imported': pitfall<{ via: string; shell: string; fn: string }>(['3.3', '3.7.3'], ({ via, shell, fn }) => [
    `\`${via}\` はコマンドを ${shell} で実行します。${shell} は bash がエクスポートした関数を読まないので、\`export -f\` してもこのスクリプトの関数 \`${fn}\` は使えません。関数の中身を直接書くか、\`bash -c\` を使います`,
    `\`${via}\` runs the command in ${shell}, which does not read the functions bash exports, so this script's function \`${fn}\` is not there, even with \`export -f\`. Write out its body, or use \`bash -c\``]),
  'function-not-in-new-shell-export': pitfall<{ via: string; fn: string }>(['3.3', '3.7.3'], ({ via, fn }) => [
    `\`${via}\` は新しいシェルでコマンドを実行するため、このスクリプトの関数 \`${fn}\` は使えません。関数の中身を直接書くか、先に \`export -f ${fn}\` で関数を渡します（新しいシェルが bash のときだけ）`,
    `\`${via}\` runs the command in a new shell, which does not have this script's function \`${fn}\`. Write out its body, or pass the function with \`export -f ${fn}\` first (only when the new shell is bash)`]),
  'function-not-imported-sh': caveat<{ via: string; fn: string }>(['3.3', '3.7.3'], ({ via, fn }) => [
    `\`${via}\` はコマンドを sh で実行します。Debian や Ubuntu の sh は dash で、dash は bash がエクスポートした関数を読まないので、このスクリプトの関数 \`${fn}\` は使えないことがあります。\`bash -c\` を使います`,
    `\`${via}\` runs the command in sh, which is dash on Debian and Ubuntu, and dash does not read the functions bash exports, so this script's function \`${fn}\` may not be there. Use \`bash -c\``]),
  'wrapper-assignment-expanded-first': suggests(pitfall<{ use: string; via: string; v: string; rewrite: readonly Rewrite[] }>(['3.7.1', '3.7.4'], ({ use, via, v, rewrite: [fix] }) => [
    `\`${use}\` は、\`${via}\` が \`${v}\` を設定する前に今のシェルが展開します（今の値で、なければ空）。設定した値を使うなら \`${via} ${v}=… ${fix.code}\` のようにシェル経由にします`,
    `the current shell expands \`${use}\` before \`${via}\` sets \`${v}\` (to its present value, or nothing). To use the value it sets, go through a shell: \`${via} ${v}=… ${fix.code}\``])),

  // ---------------------------------------------------------------- pipelines and globs (3.2.3, 3.7.3, 3.5.8)
  // (5.2 says that `BASH_SUBSHELL` is "incremented by one within each subshell", and 3.2.3 that each command of a
  // pipeline runs in its own subshell; bash does not count the subshell of a simple command in a pipeline while it
  // expands the command's words (what the command runs, an `eval` string or a function, sees it counted): differs.)
  'bash-subshell-not-counted': withBasis(note(['5.2', '3.2.3'], () => [
    'パイプラインの中の単純コマンドはサブシェルで実行される（最後のコマンドは、`shopt -s lastpipe` が有効でジョブ制御が無効のとき以外）が、bash はこのサブシェルを `$BASH_SUBSHELL` に数えないので、値はパイプラインの外のシェルと同じになる。サブシェルかどうかは `$BASHPID` と `$$` を比べて確かめる',
    'A simple command in a pipeline runs in a subshell (the last one too, unless `shopt -s lastpipe` is on and job control is off), but bash does not count this subshell in `$BASH_SUBSHELL`: the value is that of the shell around the pipeline. To tell whether code runs in a subshell, compare `$BASHPID` with `$$`']),
  { kind: 'differs', probe: 'words#bash-subshell-stage' }),
  'pipeline-subshell-variable': pitfall<{ used: string; fix: Words; partial: boolean }>(['3.2.3', '3.7.3'], ({ used, fix, partial }) => [
    `パイプ（\`|\`）でつないだコマンドはサブシェルで実行されるので、右側で設定した \`${used}\` はパイプラインが終わると消え、あとの \`$${used}\` には届きません。${fix.ja}`
      + (partial ? '（この前で `shopt -s lastpipe` を有効にしているのは一部の経路だけです）' : ''),
    `the commands of a pipeline (\`|\`) run in subshells, so \`${used}\` set on the right side is gone when the pipeline ends; the later \`$${used}\` does not see it. ${fix.en}`
      + (partial ? ' (only some paths before here turn `shopt -s lastpipe` on)' : '')]),
  // (`rewrite`: a test first in the body, where each pass of the loop is over a pattern, and `shopt -s nullglob` where the shell has it.)
  'unmatched-glob-runs-once': withConvention(suggests(caveat<{ glob: string; patterns: readonly LoopPattern[]; v: string; alone: boolean; rewrite: readonly Rewrite[]; how: LoopHow }>(['3.5.8', '3.2.5.1', '3.2.5.2'], ({ glob, patterns, v, alone, rewrite, how }) => unmatchedGlobText(glob, patterns, v, alone, rewrite, how))), 'guard-unmatched-glob'),
  // (The shell sets the standard input up, but a command given a file to read reads that instead: jq, sort, cat…)
  'stdin-not-read': note<{ cmd: string; file: string; stdin: Words }>(['3.2.3', '3.6'], ({ cmd, file, stdin }) => [
    `\`${cmd}\` には読むファイル（\`${file}\`）が指定されているので、標準入力（${stdin.ja}）は読まない（\`-\` を指定すると標準入力も読む）`,
    `\`${cmd}\` is given a file to read (\`${file}\`), so it does not read its stdin (${stdin.en}); \`-\` would make it read stdin too`]),

  // ---------------------------------------------------------------- words (3.7.1, 3.5.7, 3.4.2, 3.6; src/wordfacts.ts)
  // (`rewrite`: the command through `sh -c`, src/wordfacts.ts, `throughShell`.)
  // (`apart`: the command acts on this shell, `cd`, or is a function or an alias, which no other shell has: set it first.)
  'prefix-assignment-expanded-first': suggests(pitfall<{ v: string; name: string; use: string; apart: boolean; rewrite: readonly Rewrite[] }>(['3.7.1', '3.7.4'], ({ v, name, use, apart, rewrite: [sh] }) => [
    `\`${v}=…\` は \`${name}\` の環境にだけ入ります。\`${use}\` は、その前に今のシェルが展開します（今の値で、なければ空）。新しい値を使うなら${apart ? `、先に \`${sh.code}\` のように別に代入します` : ` \`${v}=… ${sh.code}\` のようにシェル経由にします`}`,
    `\`${v}=…\` is set only in the environment of \`${name}\`; the current shell expands \`${use}\` before that (to its present value, or nothing). To use the new value, ${apart ? `assign it first, apart: \`${sh.code}\`` : `go through a shell: \`${v}=… ${sh.code}\``}`])),
  // (`rewrite`: the word with only its expansions in quotes, so a glob or a tilde in it still works: `"$DIR"/*`; none
  // when quotes would change it, as in `${x:-*.txt}`.)
  // (`destroys`: the command deletes or overwrites what the word names, `rm`, `mv`, `cp`: a wrong name cannot be undone.)
  // (`known`: the one word the model knows it gives here; then it does no harm as it is, and is a caveat.)
  'unquoted-variable-as-path': withConvention(suggests(pitfall<{ bare: string; rewrite: readonly Rewrite[]; destroys?: boolean; known?: string }>(['3.5.7', '3.5.8'], ({ bare, rewrite: [quoted], destroys, known }) => [
    `\`${bare}\` をクォートしていないので、値に空白や \`*\` があると別々の引数に分かれたり、ファイル名に展開されたりする${destroys ? '。このコマンドは意図しないファイルを削除したり上書きしたりすることになる' : ''}${known !== undefined ? `（ここでの値では1つの引数 \`${known}\` のままだが、値が変わると壊れる）` : ''}${quoted ? `。\`${quoted.code}\` と書く` : ''}`,
    `\`${bare}\` is not quoted, so a value with spaces or \`*\` is split into several arguments or expanded to file names${destroys ? ', and this command then deletes or overwrites files it should not' : ''}${known !== undefined ? ` (with its value here it stays one argument, \`${known}\`, but another value breaks it)` : ''}${quoted ? `. Write \`${quoted.code}\`` : ''}`],
  undefined, ({ destroys, known }) => (destroys && known === undefined ? 'warning' : 'info'))), 'quote-expansions'),
  'for-over-ls-output': withConvention(caveat<{ cmd: string }>(['3.5.7'], ({ cmd }) => [
    `\`$(${cmd} …)\` の結果は空白や改行で区切られるので、空白を含むファイル名が壊れます。${cmd === 'ls' ? '`for f in *.txt` のようにグロブを使います' : '`find … -print0 | while IFS= read -r -d \'\' f` や `find -exec` を使います'}`,
    `the output of \`$(${cmd} …)\` is split on spaces and newlines, so file names with spaces break. ${cmd === 'ls' ? 'Use a glob, as in `for f in *.txt`' : "Use `find … -print0 | while IFS= read -r -d '' f` or `find -exec`"}`]), 'no-loop-over-command-output'),
  'for-over-unquoted-args': withConvention(suggests(caveat<{ value: string; rewrite: readonly Rewrite[] }>(['3.4.2', '3.5.7'], ({ value, rewrite: [quoted, bare] }) => [
    `\`${value}\` をクォートしないと、空白を含む引数が分かれてしまいます。\`${quoted.code}\`${bare ? `（または \`${bare.code}\` だけ）` : ' '}と書きます`,
    `unquoted \`${value}\` splits arguments that contain spaces. Write \`${quoted.code}\`${bare ? ` (or just \`${bare.code}\`)` : ''}`])), 'quote-all-arguments'),
  // (`args`: `$@`, which 3.4.2 states: "In contexts where word splitting is not performed, this expands to a single word
  // with each positional parameter separated by a space" (3.4: no word splitting in an assignment). For an array,
  // 6.7 says only that `${a[@]}` "is analogous to the expansion of the special parameters": checked.)
  'array-joined-in-assignment': withConvention(withBasis(suggests(caveat<{ v: string; op: string; word: string; args: boolean; rewrite: readonly Rewrite[] }>(['3.4', '3.4.2', '6.7'], ({ v, op, word, args, rewrite: r }) => [
    `\`${v}${op}${word}\` では${args ? '引数' : '要素'}が空白で区切られて1つの文字列につながり、\`${v}\` はただの文字列になります（空白を含む${args ? '引数' : '要素'}は元に戻せません）。別々に残すには配列にして \`${v}${op}${r[0].code}\` と書${r[1] ? `き、1つの文字列にするつもりなら \`${v}${op}${r[1].code}\` と書きます` : 'きます'}`,
    `\`${v}${op}${word}\` joins the ${args ? 'arguments' : 'elements'} into one string, separated by spaces: \`${v}\` is a plain string, and ${args ? 'arguments' : 'elements'} with spaces cannot be told apart again. To keep them apart, assign an array: \`${v}${op}${r[0].code}\`${r[1] ? `; if one string is meant, write \`${v}${op}${r[1].code}\`` : ''}`])),
  ({ args }) => (args ? { kind: 'manual', probe: 'state#assign-at' } : { kind: 'checked', probe: 'state#assign-array' })), 'array-for-a-list'),
  // (`zsh`: the shell is zsh, not bash. For bash, 4.1 says that `[ -n ]` (one argument, not null) is true, and that two
  // arguments whose first is no unary operator are false, where bash fails with status 2 (`[ = y ]`): differs.)
  'unquoted-variable-in-test': withConvention(withBasis(suggests(caveat<{ bare: string; zsh?: boolean; rewrite: readonly Rewrite[] }>(['3.5.7', '4.1'], ({ bare, zsh, rewrite: [q] }) => zsh ? [
    `\`[ ]\` の中の \`${bare}\` をクォートしないと、zsh では空白で分かれはしませんが、値が空のときは引数ごと消えるので条件式が壊れます（\`[ -n $x ]\` は空でも真になります）${q ? `。\`${q.code}\` と書きます` : ''}`,
    `unquoted \`${bare}\` inside \`[ ]\` is not split in zsh, but an empty value drops the word, which breaks the test (an empty \`[ -n $x ]\` is true)${q ? `. Write \`${q.code}\`` : ''}`] : [
    `\`[ ]\` の中の \`${bare}\` をクォートしないと、値が空や空白入りのときに条件式が壊れます（\`unary operator expected\` などのエラーや、誤った結果。空の \`[ -n $x ]\` は真になります）${q ? `。\`${q.code}\` と書きます` : ''}`,
    `unquoted \`${bare}\` inside \`[ ]\` breaks the test when the value is empty or has spaces (an error such as "unary operator expected", or a wrong result: an empty \`[ -n $x ]\` is true)${q ? `. Write \`${q.code}\`` : ''}`])),
  ({ zsh }) => (zsh ? undefined : { kind: 'differs', probe: 'state#test-empty-operand' })), 'quote-expansions'),
  // (`set -u` on every path, and no value on every path: src/semantics/unbound.ts, `unboundRead`. `shell`: the
  // messages of bash and dash are quoted, another shell's are not.)
  // (4.3.1: with `-u`, "a non-interactive shell will exit". Where bash fails only the command (`exits: 'command'`, a
  // redirection of a program), and goes on, it differs.)
  'nounset-unbound': withBasis(suggests(pitfall<{
    v: string; name: string; exits: 'script' | 'subshell' | 'shell' | 'command'; shell: 'bash' | 'dash' | 'other'; environment: 'maybe' | 'unlikely' | 'no'; errexit?: 'script' | 'subshell'; rewrite: readonly Rewrite[];
  }>(['4.3.1', '3.5.3'], ({ v, name, exits, shell, environment, errexit, rewrite: [fix] }) => {
    const message = `${v}: ${shell === 'bash' ? 'unbound variable' : 'parameter not set'}`;
    return [
      `ここでは \`${v}\` に値が設定されていない${errexit ? `ので、${errexit === 'script' ? 'スクリプト' : 'これを実行するサブシェル'}が終了する` : ''}。\`set -u\` が有効なので、${shell === 'other' ? '読むとエラーになり' : `${shell} は \`${message}\` のエラーを出し`}、`
        + `${exits === 'script' ? 'スクリプトが終了する' : exits === 'subshell' ? 'これを実行するサブシェルが終了する' : exits === 'shell' ? 'これを実行するシェルが終了する' : `このコマンドは実行されず、終了ステータス 1 で失敗する${errexit ? `。\`set -e\` がこの失敗で${errexit === 'script' ? 'スクリプト' : 'これを実行するサブシェル'}を止める` : ''}`}`
        + `${environment !== 'no' ? `（\`${name}\` が環境変数から来るときを除く）` : ''}。${fix ? `設定されていないことがあるなら \`${fix.code}\` と書く` : 'この前で値を設定しておく'}`,
      `\`${v}\` is not set here${errexit ? `, so ${errexit === 'script' ? 'the script' : 'the subshell running it'} stops` : ''}: with \`set -u\` on, ${shell === 'other' ? 'reading it is an error, and' : `${shell} fails with "${message}" and`} `
        + `${exits === 'script' ? 'the script exits' : exits === 'subshell' ? 'the subshell running it exits' : exits === 'shell' ? 'the shell running it exits' : `the command does not run: it fails with status 1${errexit ? `, and \`set -e\` stops ${errexit === 'script' ? 'the script' : 'the subshell running it'} on that failure` : ''}`}`
        + `${environment !== 'no' ? ` (unless \`${name}\` comes from the environment)` : ''}. ${fix ? `If it may be unset, write \`${fix.code}\`` : 'Set it before this line'}`];
  }, undefined,
  // (Only the command fails, and the shell goes on: an unset read in a redirection of a program, `cat < "$f"` with `set -u`.)
  // (A name in capitals, which by custom the environment may have: a caveat, src/semantics/shellstate.ts, `fromEnvironment`.)
  ({ exits, errexit, environment }) => (environment === 'maybe' || (exits === 'command' && !errexit) ? 'info' : 'warning'))),
  ({ exits, shell }) => (exits === 'command' && shell === 'bash' ? { kind: 'differs', probe: 'state#nounset-redirect' } : undefined)),
  // (src/semantics/state.ts, `shebangRefused`.)
  'shebang-refused': pitfall<ShebangRefusal>(['6.1', '3.8', 'execve(2)'], (r) => [
    `Linux ではシバンのインタープリタの後ろの \`${r.rest}\` 全体が bash への1つの引数になり、bash はそれを受け付けない（${r.why === 'blank' ? '空白はオプションではない'
      : r.why === 'letter' ? `\`-${r.letter}\` というオプションはない` : r.why === 'name' ? '`o` が次の引数のスクリプトのパスをオプション名として読む'
        : r.why === 'shopt' ? '`O` が次の引数のスクリプトのパスを shopt のオプション名として読む' : 'その名前の長いオプションはない'}）。`
      + `直接実行すると、スクリプトは何も実行せずにエラーで終わる。オプションは次の行に \`set\`${r.rest.includes('O') ? '（`-O` は `shopt -s`）' : ''} で書く（\`bash スクリプト\` で実行すると、シバンのオプションは読まれない）`,
    `on Linux the whole \`${r.rest}\` after the interpreter is one argument to bash, which refuses it (${r.why === 'blank' ? 'a blank is not an option'
      : r.why === 'letter' ? `bash has no option \`-${r.letter}\`` : r.why === 'name' ? '`o` takes the next argument, the script\'s path, as an option name'
        : r.why === 'shopt' ? '`O` takes the next argument, the script\'s path, as a shopt option name' : 'no long option has that name'}). `
      + `Run directly, the script stops with an error before running anything. Write the options with \`set\`${r.rest.includes('O') ? ' (`-O` with `shopt -s`)' : ''} on the next line (\`bash script\` ignores the options of the shebang)`]),
  // (find: an action whose command find refuses; the reasons, the messages and the sections of each case: src/messages-find.ts.)
  'find-action-refused': { ...suggests(failure<FindRefusalParams>(['3.2.4', '3.1.2.1', '3.1.2.2'], findRefusalText)), refsOf: findRefusalRefs },
  // (src/wordfacts.ts: a first word `\uFEFF#!…` at the start of the file; `word` without the mark.)
  'shebang-bom': pitfall<{ word: string; slash: boolean }>(['3.8', 'execve(2)'], ({ word, slash }) => [
    `1行目が見えないバイト順マーク(BOM、U+FEFF)で始まっているので、シバンにならない。カーネルはファイルの先頭2バイトが \`#!\` のときだけインタープリタを起動し、`
      + `bash はこの行を BOM の付いた \`${word}\` という名前のコマンドとして実行して失敗する（${slash ? 'No such file or directory' : 'command not found'}）。BOM を付けずに保存する`,
    `the first line starts with an invisible byte order mark (BOM, U+FEFF), so it is no shebang: the kernel starts an interpreter only when the file's first two bytes are \`#!\`, `
      + `and bash runs this line as a command named \`${word}\` with the BOM before it, which fails (${slash ? '"No such file or directory"' : '"command not found"'}). Save the file without the BOM`]),
  // (src/wordfacts.ts: `op` is the operator as written; `file` is a static path under a directory only root writes.)
  'redirect-by-your-shell': pitfall<{ op: string; kind: 'write' | 'append' | 'other' | 'read'; file?: string }>(['3.6', '3.7.3'], ({ op, kind, file }) => {
    const read = kind === 'read';
    const f = (ja: boolean) => file ?? (ja ? 'ファイル' : 'file');
    const sh = (ja: boolean) => `sudo bash -c '… ${op} ${f(ja)}'`;
    return [
      (file ? `\`${file}\` はふつう root しか書き込めない。` : read ? 'ファイルが root しか読めないなら、' : 'ファイルが root しか書き込めないなら、')
        + `リダイレクト（\`${op}\`）は sudo ではなく今のシェルが今のユーザーの権限で開くので、sudo が動く前に「Permission denied」で失敗し、コマンドは実行されない。`
        + (read ? `コマンドにファイルを引数で渡すか、\`${sh(true)}\` のようにリダイレクトも sudo の中で行う`
          : kind === 'write' ? `\`… | sudo tee ${f(true)}\`（追記なら \`sudo tee -a\`）を使う`
            : kind === 'append' ? `\`… | sudo tee -a ${f(true)}\` を使う`
              : `\`${sh(true)}\` のようにリダイレクトも sudo の中で行う`),
      (file ? `\`${file}\` is normally writable only by root: ` : read ? 'if the file is readable only by root, ' : 'if the file is writable only by root, ')
        + `the redirection (\`${op}\`) is opened by your own shell with your rights, before sudo starts, so it fails with "Permission denied" and the command does not run. `
        + (read ? `Pass the file to the command as an argument, or do the redirection inside sudo too: \`${sh(false)}\``
          : kind === 'write' ? `Use \`… | sudo tee ${f(false)}\` (\`sudo tee -a\` to append)`
            : kind === 'append' ? `Use \`… | sudo tee -a ${f(false)}\``
              : `Use \`${sh(false)}\`, so that the redirection is done inside sudo too`)];
  }),

  // ---------------------------------------------------------------- bats test files (src/bats.ts; bash's side of what bats does)
  'bats-test': note(['3.3', '4.3.1'], () => [
    'bats はテストを1つずつ別のプロセスで、`set -e` を有効にして実行する。途中のコマンドが失敗するとそこでテストは失敗し（`set -e` が無視される所、つまり条件・`&&` や `||` の左側・`!` のあとを除く）、最後のコマンドが失敗しても失敗する。テストで設定した変数は、ほかのテストには届かない。各プロセスはまずファイル全体を読み込むので、テストの外のコードはテストごとに実行される',
    'bats runs each test in a process of its own, with `set -e` on: a command that fails stops the test and fails it (except where `set -e` is ignored: in a condition, on the left of `&&` or `||`, after `!`), and so does a last command that fails. What a test sets does not reach the other tests. Each process first reads the whole file, so the code outside the tests runs again for each test']),
  // (`text`: the line is in a string or a here-document, where bash reads it as text; bats reads every line.)
  'bats-tags': note<{ scope: 'test' | 'file'; tags: readonly string[]; text?: 'string' | 'heredoc' }>(['3.1.3'], ({ scope, tags, text }) => {
    const list = tags.map((t) => `\`${t}\``).join(', ');
    const focus = tags.includes('bats:focus');
    return [
      (text === 'string' ? 'bash にとっては文字列の中の文字で、コマンドではない' : text === 'heredoc' ? 'bash にとってはヒアドキュメントの中の文字で、コマンドではない' : 'bash にとってはコメントで、無視される')
        + `。bats がこの行を読み、${scope === 'file' ? 'このファイルのこれ以降のすべてのテスト' : tags.length ? '次のテストだけ' : '次のテスト'}に${tags.length ? `タグ ${list} を付ける` : 'タグを付けない（空のリスト）'}`
        + (scope === 'file' ? (tags.length ? '（あとの `# bats file_tags=` が置き換える）' : '（前の `file_tags` を無効にする）')
          : tags.length ? '（同じテストの前にあとの `# bats test_tags=` の行があると、そちらが置き換える。そのあとのテストには付かない）' : '（同じテストの前の `test_tags` を無効にする）')
        + (tags.length ? '。`bats --filter-tags タグ` で、タグでテストを選んで実行できる' : '')
        + (focus ? '。`bats:focus` が付いたテストがあると、bats はそのテストだけを実行し、成功しても終了ステータスを 1 にする（`BATS_NO_FAIL_FOCUS_RUN=1` で 0 にできる）' : ''),
      (text === 'string' ? 'to bash this line is text of a string, not a command' : text === 'heredoc' ? 'to bash this line is text of a here-document, not a command' : 'to bash this is a comment, and it is ignored')
        + `. bats reads the line and gives ${scope === 'file' ? 'every later test of the file' : tags.length ? 'the next test only' : 'the next test'} ${tags.length ? `the ${tags.length > 1 ? 'tags' : 'tag'} ${list}` : 'no tags (an empty list)'}`
        + (scope === 'file' ? (tags.length ? ' (a later `# bats file_tags=` replaces them)' : ' (it cancels an earlier `file_tags`)')
          : tags.length ? ' (a later `# bats test_tags=` line before the same test replaces them; the tests after it do not get them)' : ' (it cancels an earlier `test_tags` before the same test)')
        + (tags.length ? '; `bats --filter-tags TAGS` runs only the tests with the tags given' : '')
        + (focus ? '. When a test has `bats:focus`, bats runs only the focused tests, and exits with status 1 even if they pass (`BATS_NO_FAIL_FOCUS_RUN=1` keeps 0)' : '')];
  }),
  'bats-tags-invalid': failure<{ scope: 'test' | 'file'; why: 'empty' | 'syntax' }>(['3.1.3'], ({ scope, why }) => [
    `\`${scope}_tags\` の書き方が正しくないので、bats はこのファイルのテストを1つも実行せずに失敗する。タグは英数字・\`-\`・\`_\`・\`:\` だけで書き、コンマ（前後の空白は可）で区切る。`
      + (why === 'empty' ? '先頭のコンマや、空白だけのリストで、空のタグができている（タグを付けないなら、`=` のあとに何も書かない）' : '空のタグ（`a,,b` や末尾のコンマ）や、空白や記号を含むタグは書けない'),
    `The \`${scope}_tags\` list is not valid, so bats runs none of the tests of this file and fails. Tags are letters, digits, \`-\`, \`_\` and \`:\`, separated by commas (spaces around them are fine). `
      + (why === 'empty' ? 'A leading comma, or a list of only spaces, makes an empty tag (for no tags, nothing follows the `=`)' : 'An empty tag (`a,,b`, a trailing comma) and a tag with a space or another character are errors')]),
  // (bats-preprocess matches `name() { # @test` anywhere on the line, and replaces the whole line.)
  'bats-test-line-dropped': pitfall<{ dropped: string }>(['3.3'], ({ dropped }) => [
    `bats はこの行全体をテストの関数の定義に置き換えるので、関数名の前の \`${dropped}\` は実行されません。別の行に書きます`,
    `bats replaces this whole line with the definition of the test, so \`${dropped}\` before the function's name never runs. Put it on a line of its own`]),
  'bats-negation-ignored': pitfall<{ cmd: string; form: 'command' | 'pipeline' | 'other' }>(['4.3.1', '3.2.3'], ({ cmd, form }) => [
    `\`set -e\` は \`!\` のあとのコマンドの結果を無視するので、\`! ${cmd}\` はテストの最後のコマンドでない限り、\`${cmd}\` が成功してもテストを失敗させません。`
      + (form === 'command' ? `\`run ! ${cmd}\`（bats 1.5.0 から。\`bats_require_minimum_version 1.5.0\` と書く）か \`! ${cmd} || false\` と書きます`
        : form === 'pipeline' ? `\`! ${cmd} || false\` と書くか、パイプラインを \`run ! bats_pipe …\` で実行します（\`|\` は \`\\|\` と書く。bats 1.10.0 から）`
        : `\`! ${cmd} || false\` と書きます`),
    `\`set -e\` ignores the status of a command after \`!\`, so unless it is the last command of the test, \`! ${cmd}\` does not fail the test when \`${cmd}\` succeeds. `
      + (form === 'command' ? `Write \`run ! ${cmd}\` (since bats 1.5.0, with \`bats_require_minimum_version 1.5.0\`) or \`! ${cmd} || false\``
        : form === 'pipeline' ? `Write \`! ${cmd} || false\`, or run the pipeline with \`run ! bats_pipe …\`, each \`|\` written \`\\|\` (since bats 1.10.0)`
        : `Write \`! ${cmd} || false\``)]),
  'bats-run-in-pipeline-stage': pitfall<{ cmd: string }>(['3.2.3', '3.7.3'], ({ cmd }) => [
    `パイプラインのコマンドはサブシェルで実行されるので、\`run ${cmd}\` が設定した \`$status\` と \`$output\` はパイプラインが終わると消えます。パイプライン全体を \`run\` で実行するには \`run bats_pipe … \\| ${cmd}\` か \`run bash -c '… | …'\` と書きます`,
    `the commands of a pipeline run in subshells, so the \`$status\` and \`$output\` that \`run ${cmd}\` sets are gone when the pipeline ends. To run the whole pipeline under \`run\`, write \`run bats_pipe … \\| ${cmd}\` or \`run bash -c '… | …'\``]),
  'bats-run-in-pipeline': pitfall<{ cmd: string }>(['3.2.3'], ({ cmd }) => [
    `パイプは \`run\` の出力を受け取りますが、\`run\` は \`${cmd}\` の出力を \`$output\` に入れるだけで何も出力しません。また、パイプラインのコマンドはサブシェルで実行されるので、\`run\` が設定した \`$status\` と \`$output\` はパイプラインが終わると消えます。パイプライン全体を \`run\` で実行するには \`run bats_pipe ${cmd} \\| …\` か \`run bash -c '… | …'\` と書きます`,
    `the pipe gets the output of \`run\`, but \`run\` writes nothing: it keeps the output of \`${cmd}\` in \`$output\`. And the commands of a pipeline run in subshells, so the \`$status\` and \`$output\` that \`run\` sets are gone when the pipeline ends. To run the whole pipeline under \`run\`, write \`run bats_pipe ${cmd} \\| …\` or \`run bash -c '… | …'\``]),
  // (The hooks bats calls: libexec/bats-core/bats-exec-test and bats-exec-file of bats-core 1.13.)
  'bats-hook': note<{ name: string; when: 'before' | 'after' | 'file-before' | 'file-after' }>(['3.3', '4.3.1'], ({ name, when }) => (when === 'before' ? [
    `bats は \`${name}\` を各テストの前に、そのテストのプロセスで呼ぶ。ここで設定した変数はテストに届く。\`set -e\` が有効なので、失敗したコマンドがあるとそこで止まり、テストは実行されずに失敗する`,
    `bats calls \`${name}\` before each test, in the test's own process: what it sets, the test sees. \`set -e\` is on, so a command that fails stops it there, and the test fails without running`]
    : when === 'after' ? [
      `bats は \`${name}\` を各テストの後に、そのテストのプロセスで呼ぶ（テストが失敗したときも）。\`${name} || …\` の形で呼ぶので、中では \`set -e\` が無視され、途中のコマンドが失敗しても止まらない。テストが失敗するのは、\`${name}\` が 0 以外の終了ステータス（最後のコマンドのもの）を返したときだけ`,
      `bats calls \`${name}\` after each test, in the test's process (also when the test fails). It calls it as \`${name} || …\`, so \`set -e\` is ignored in it: a command that fails in the middle does not stop it, and the test fails only when \`${name}\` returns a status that is not 0 (that of its last command)`]
    : when === 'file-before' ? [
      `bats は \`${name}\` をこのファイルの最初のテストの前に1回だけ、別のプロセスで呼ぶ。テストに届くのは、ここで \`export\` した変数だけ。失敗したコマンドがあると（\`set -e\`）、ファイルのテストはどれも実行されない`,
      `bats calls \`${name}\` once, before the first test of the file, in a process of its own: only the variables it exports (\`export\`) reach the tests. If a command in it fails (\`set -e\`), no test of the file runs`]
    : [
      `bats は \`${name}\` をこのファイルの最後のテストの後に1回だけ、\`setup_file\` と同じプロセスで呼ぶ。\`${name} || …\` の形で呼ぶので、中では \`set -e\` が無視され、途中のコマンドが失敗しても止まらない`,
      `bats calls \`${name}\` once, after the last test of the file, in the process of \`setup_file\`. It calls it as \`${name} || …\`, so \`set -e\` is ignored in it: a command that fails in the middle does not stop it`])),
  'bats-setup-suite-in-test-file': pitfall(['3.3'], () => [
    'bats はテストファイルの `setup_suite` を呼ばず、警告(BW03)を出します。`setup_suite` は、テストと同じディレクトリのファイル `setup_suite.bash` に書きます',
    'bats does not call a `setup_suite` of a test file, and warns (BW03). Put `setup_suite` in the file `setup_suite.bash`, next to the tests']),
  // ---------------------------------------------------------------- words and names
  // (`digits`: `\d` or `\D` among them, which no POSIX regex has, even from a variable; `others`: an operator of glibc's
  // regexes among them, `\s`, `\b`…, which a variable keeps. `rewrite`: `[0-9]` in place, or the regex in a variable;
  // none when one is inside a bracket expression, `[\s]`, where a backslash is no operator either way.)
  'regex-backslash-dropped': suggests(pitfall<{ list: string; digits: boolean; others: boolean; rewrite: readonly Rewrite[] }>(['3.5.9', '3.2.5.2'], ({ list, digits, others, rewrite: [fix] }) => [
    [`\`[[ =~ ]]\` の右辺に書いた ${list} は、クォート除去でバックスラッシュが消えて普通の文字になる（正規表現の演算子にならない）`,
      ...(digits ? [`POSIX の正規表現には \`\\d\` がなく、変数に入れても \`d\` という文字になるので、\`\\d\` は \`[0-9]\`、\`\\D\` は \`[^0-9]\` と書く${!others && fix ? `（\`${fix.code}\`）` : ''}`] : []),
      ...(others ? [fix ? `演算子として使うには変数に入れる（\`${fix.code}\`）か、\`[[:space:]]\` や \`[[:alnum:]_]\` のような書き方にする` : '`[[:space:]]` や `[[:alnum:]_]` のような書き方にする（`[ ]` の中のバックスラッシュは、変数に入れても演算子にならない）'] : [])].join('。'),
    [`In \`[[ =~ ]]\`, an unquoted ${list} loses its backslash to quote removal and is an ordinary character, not a regex operator`,
      ...(digits ? [`POSIX regexes have no \`\\d\`: even from a variable it is the letter \`d\`. Write \`[0-9]\` for \`\\d\` and \`[^0-9]\` for \`\\D\`${!others && fix ? ` (\`${fix.code}\`)` : ''}`] : []),
      ...(others ? [fix ? `Keep the regex in a variable (\`${fix.code}\`) or use \`[[:space:]]\` or \`[[:alnum:]_]\` instead` : 'Use `[[:space:]]` or `[[:alnum:]_]` instead (inside `[ ]`, a backslash is no operator, even from a variable)'] : [])].join('. ')], NO_HEADING)),
  'distro-alias-in-script': pitfall<{ name: string; where: string; what: Words; many: boolean; instead: Words }>(['6.6'], ({ name, where, what, many, instead }) => [
    `\`${name}\` は ${where} が対話シェル用に定義する${what.ja}で、コマンドではありません。ほかの環境にはなく、スクリプトの中では${many ? 'これらの' : 'その'}環境でも使えません（command not found）。${instead.ja}`,
    `\`${name}\` is ${what.en} ${where} define${many ? '' : 's'} for interactive shells, not a command. Other systems lack it, and scripts do not have it even there ("command not found"). ${instead.en}`], SYSTEM_DEPENDENT),
  'distro-alias-interactive': note<{ name: string; where: string; what: Words; many: boolean; portable?: string }>(['6.6'], ({ name, where, what, many, portable }) => [
    `環境依存: \`${name}\` は ${where} が対話シェル用に定義する${what.ja}で、ほかの環境にはありません。どこでも動かすには${portable ? ` \`${portable}\` と書きます` : '、したいことに合ったコマンドをそのまま書きます'}`,
    `System-dependent: \`${name}\` is ${what.en} ${where} define${many ? '' : 's'} for interactive shells; other systems lack it. ${portable ? `Write \`${portable}\` to work everywhere` : 'To work everywhere, write the command you mean'}`]),
  // ---------------------------------------------------------------- host files (src/hosts.ts)
  'dockerfile-pipefail-missing': withConvention(caveat<Record<string, never>>(['3.2.3', '4.3.1'], () => [
    'パイプの途中のコマンドが失敗しても、RUN は最後のコマンドの結果だけで成功扱いになり、ビルドは止まりません。先に `SHELL ["/bin/bash", "-o", "pipefail", "-c"]` と書くと失敗を検出できます。',
    'If a command in the middle of the pipe fails, RUN still succeeds with the status of the last command, and the build goes on. Put `SHELL ["/bin/bash", "-o", "pipefail", "-c"]` first to catch such failures.'], NO_HEADING), 'pipefail'),
  'python-string-without-shell': pitfall<Record<string, never>>(['3.7.2'], () => [
    'shell=True なしで文字列を渡すと、文字列全体が1つのプログラム名として扱われます（引数やパイプは使えず、多くの場合 FileNotFoundError）。`["cmd", "arg"]` のようなリストで渡すか、shell=True を付けます。',
    'Without shell=True the whole string is taken as one program name (no arguments or pipes; usually FileNotFoundError). Pass a list like `["cmd", "arg"]`, or add shell=True.'], NO_HEADING),
  'python-shell-injection': withConvention(pitfall<Record<string, never>>(['3.1.1', '3.1.2'], () => [
    'Python の値を埋め込んだ文字列をシェルが実行します。値に `;` や `$(…)` が含まれると任意のコマンドが実行されます。`shlex.quote()` でクォートするか、shell=True をやめてリストで渡してください。',
    'the shell runs a string with Python values pasted in, so a value containing `;` or `$(…)` runs arbitrary commands. Quote it with `shlex.quote()`, or drop shell=True and pass a list.'], { ja: 'シェルインジェクションの危険: ', en: 'Shell injection risk: ' }), 'quote-for-shell-in-python'),
  'actions-script-injection': withConvention(pitfall<{ expr: string }>(['3.1.1', '3.1.2'], ({ expr }) => [
    `\`${expr}\` は外部の人が自由に書ける値で、そのままスクリプトに埋め込まれます（\`"; curl … | sh #\` のような値で任意のコマンドが実行される）。\`env:\` で環境変数に渡し、\`"$変数"\` として使ってください。`,
    `\`${expr}\` can be set by anyone and is pasted into the script as it is (a value like \`"; curl … | sh #\` runs arbitrary commands). Pass it through \`env:\` and use it as \`"$VAR"\`.`], { ja: 'スクリプトインジェクションの危険: ', en: 'Script injection risk: ' }), 'actions-expression-through-env'),
} satisfies Record<string, Entry<never>>;

export type FactId = keyof typeof MESSAGES;
export type Params<K extends FactId> = Parameters<(typeof MESSAGES)[K]['text']>[0];

/**
 * A note as data (docs/design/note-levels.md): its text as the line's notes have it (`LineExplanation.notes`: the mark,
 * the word, the body), its level, the word after the mark that names the level or the kind of problem ("Pitfall:",
 * "Caveat:", "Script injection risk:"; empty when there is none), and the rest. `code`: the problem it is, in the
 * editors (`DocumentIssue.code`: a fact's id, a style check, a dialect issue). The views read the level and the word
 * from here, never from the text. `convention`: the habit its advice is, beside the fact it states (src/conventions.ts;
 * data only, no view shows it).
 */
export interface Note { text: string; level: NoteLevel; label: string; body: string; code?: string; convention?: ConventionId }

/**
 * A fact as a note: its id (also its `code`), its kind, and the sections it cites; where it is bash's behaviour rather
 * than the manual's, its `basis` (none: the manual's sections in `refs`, `basisFor`), and a command that shows it
 * (`tryIt`), both from the probe row that checks it (src/basis.ts); a pitfall whose advice is a habit, its `convention`;
 * where it suggests mechanical rewrites, those (`rewrite`: alternatives, each complete, the first recommended;
 * src/rewrite.ts), which its text renders.
 */
export interface Fact extends Note { id: FactId; kind: FactKind; refs: readonly string[]; code: FactId; basis?: Basis; tryIt?: TryIt; rewrite?: readonly Rewrite[] }

/** The mark a note starts with, one per level. */
export const MARKS: Record<NoteLevel, string> = { warning: '⚠', info: 'ⓘ', note: 'ℹ' };

/** What follows the mark of a pitfall when it has no heading of its own. */
const PITFALL_WORD: Record<'warning' | 'info', Text> = {
  warning: { ja: '落とし穴: ', en: 'Pitfall: ' },
  info: { ja: '注意: ', en: 'Caveat: ' },
};

/**
 * A note of `level` whose text starts with its mark, then, for a pitfall, the word that names the level (or its
 * heading, `heading`), then `body`.
 */
export function marked(lang: Lang, level: NoteLevel, body: string, opts: { kind?: FactKind; heading?: Text; code?: string } = {}): Note {
  const { kind = 'note', heading, code } = opts;
  const word = heading ? heading[lang] : kind === 'pitfall' && level !== 'note' ? PITFALL_WORD[level][lang] : '';
  return { text: `${MARKS[level]} ${word}${body}`, level, label: word.trimEnd(), body, ...(code ? { code } : {}) };
}

/** A note with no mark (an idiom, where a line is): a plain fact, the whole text its body. */
export function plainNote(text: string): Note {
  return { text, level: 'note', label: '', body: text };
}

/** The heading of a dialect note on a construct that works differently in the target shell (src/dialect.ts). */
export const PORTABILITY: Text = { ja: '移植性: ', en: 'Portability: ' };

/** The severity of a diagnostic for a note of `level`: a `note` is never one, so it is taken as information. */
export function severityOf(level: NoteLevel): 'warning' | 'info' {
  return level === 'warning' ? 'warning' : 'info';
}

/** The note of a fact, in `lang`. */
export function fact<K extends FactId>(lang: Lang, id: K, ...params: Params<K> extends Record<string, never> ? [] : [Params<K>]): Fact {
  const e = MESSAGES[id] as Entry<unknown>;
  const [ja, en] = e.text(params[0]);
  const level = typeof e.level === 'function' ? e.level(params[0]) : e.level ?? (e.kind === 'pitfall' ? 'warning' : 'note');
  const { text, label, body } = marked(lang, level, lang === 'ja' ? ja : en, { kind: e.kind, heading: e.heading });
  const { basis, tryIt } = basisOf(typeof e.basis === 'function' ? e.basis(params[0]) : e.basis);
  const rewrite = e.rewrite?.(params[0]);
  return { id, kind: e.kind, level, text, refs: e.refsOf?.(params[0]) ?? e.refs, label, body, code: id, ...(basis ? { basis } : {}), ...(tryIt ? { tryIt } : {}), ...(e.convention ? { convention: e.convention } : {}), ...(rewrite?.length ? { rewrite } : {}) };
}

/** Whether the note with `code` is a problem when it is a warning or a caveat: all are, but the facts that `notProblem` marks. */
export function isProblem(code: string): boolean {
  return (MESSAGES as Record<string, Entry<never>>)[code]?.problem !== false;
}

/** A fact before its language is chosen: its id and its params (language-free, or `Words`). */
export type FactSpec = { [K in FactId]: { id: K; params: Params<K> } }[FactId];

/** The note of a `FactSpec`, in `lang`. */
export function factOf(lang: Lang, spec: FactSpec): Fact {
  return (fact as (l: Lang, id: FactId, p: unknown) => Fact)(lang, spec.id, spec.params);
}

export type { Words };

/**
 * The one gate of the `notes.pitfalls` setting: the facts that are said, which are all but the pitfalls when the
 * pitfalls are off. The analyzer, the bats facts and the host notes all say their facts through it.
 */
export function said(facts: readonly Fact[], pitfalls: boolean | undefined): Fact[] {
  return facts.filter((f) => f.kind !== 'pitfall' || pitfalls !== false);
}

/**
 * The one gate of the `notes.basis` setting (docs/design/basis.md, 4): the fact, or a note's data, as the explanation
 * carries it, with no basis, no try-it and no convention when the setting is off, as `said` leaves the pitfalls out.
 */
export function basisGate<N extends Note & { basis?: Basis; tryIt?: TryIt }>(f: N, basis: boolean | undefined): N {
  if (basis !== false || (!f.basis && !f.tryIt && !f.convention)) return f;
  const { basis: _b, tryIt: _t, convention: _c, ...rest } = f;
  return rest as N;
}

/** A note's convention, as a field of another record (a problem of `--check`): none when it has none. */
export function conventionOf({ convention }: Note): { convention?: ConventionId } {
  return convention ? { convention } : {};
}

// ---------------------------------------------------------------- what an explanation rests on (docs/design/basis.md)

/** A basis the views mark, in a language: the chip's words and its tooltip. */
export interface BasisSaid { kind: 'checked' | 'differs'; label: string; title: string }

/** The releases a try-it passed: "5.2", "5.2 and 5.3" / 「5.2・5.3」. */
const releases = (lang: Lang, bash: readonly string[]): string => (lang === 'ja' ? bash.join('・') : bash.join(' and '));

/**
 * The chip of a basis the views mark (`checked`, `differs`; none for the others): the releases are those the try-it
 * passed in CI (`Basis.bash`), whatever `bashVersion` is set to.
 */
export function basisSaid(lang: Lang, b: Basis | undefined): BasisSaid | undefined {
  if (b?.kind !== 'checked' && b?.kind !== 'differs') return undefined;
  const r = releases(lang, b.bash);
  const [label, title] = b.kind === 'checked'
    ? (lang === 'ja'
      ? [`マニュアルに記述なし・bash ${r} で確認`, `Bash マニュアルに書かれていない bash の実際の動き。bash ${r} で実行して確かめた（メッセージは \`LC_ALL=C\` のときのもの）`]
      : [`Not in the manual · checked with bash ${r}`, `bash's actual behaviour, which the Bash manual does not state: checked by running bash ${r} (messages as with \`LC_ALL=C\`)`])
    : (lang === 'ja'
      ? [`マニュアルの記述と異なる・bash ${r} で確認`, `Bash マニュアルの記述とは異なる bash の実際の動き。bash ${r} で実行して確かめた（メッセージは \`LC_ALL=C\` のときのもの）`]
      : [`Differs from the manual · checked with bash ${r}`, `bash's actual behaviour, which differs from what the Bash manual says: checked by running bash ${r} (messages as with \`LC_ALL=C\`)`]);
  return { kind: b.kind, label, title };
}

// ---------------------------------------------------------------- what a command name is (3.7.2; src/semantics/names.ts `nameFacts`)

/** The words of the kinds of a command name: the badge (`word`), what the kind is (`title`), and how a line on the other meanings names it (`other`). */
const NAME_KINDS: Record<NameKind, { word: Text; title: Text; other: Text }> = {
  keyword: {
    word: { ja: '予約語', en: 'keyword' }, other: { ja: '予約語', en: 'a reserved word' },
    title: { ja: 'bash の構文の単語（予約語）。コマンドとして探されない', en: 'bash syntax (a reserved word): not looked up as a command' },
  },
  alias: {
    word: { ja: 'エイリアス', en: 'alias' }, other: { ja: 'エイリアス', en: 'an alias' },
    title: { ja: 'エイリアス: bash が行を読むときに、その中身に置き換える', en: 'an alias: bash replaces it with its text when it reads the line' },
  },
  function: {
    word: { ja: '関数', en: 'function' }, other: { ja: 'このスクリプトの関数', en: 'the function of this script' },
    title: { ja: 'このスクリプトの関数: 今のシェルで動く', en: 'a function of this script: it runs in this shell' },
  },
  builtin: {
    word: { ja: 'ビルトイン', en: 'builtin' }, other: { ja: 'bash のビルトイン', en: 'bash\'s builtin' },
    title: { ja: 'bash に組み込まれたコマンド: 新しいプロセスなしで、今のシェルで動く', en: 'a command built into bash: it runs in this shell, with no new process' },
  },
  program: {
    word: { ja: 'プログラム', en: 'program' }, other: { ja: 'プログラム', en: 'a program' },
    title: { ja: 'プログラム: PATH から（パスならそのパスで）見つけたファイルを、別のプロセスとして動かす', en: 'a program: a file found in PATH (or at the path given), run as another process' },
  },
  none: {
    word: { ja: '実行されない', en: 'nothing runs' }, other: { ja: '何もない', en: 'nothing' },
    title: { ja: '何も実行されない（コマンドが見つからない）', en: 'nothing runs (no command is found)' },
  },
};

/** The badge's tooltip on a POSIX special builtin (4.4; checked with bash 5.2 in test/name-kinds.test.ts). */
const SPECIAL_TITLE: Text = {
  ja: 'POSIX の特殊ビルトイン: bash に組み込まれたコマンドで、新しいプロセスなしで今のシェルで動く。POSIX モードでは、関数より先に見つかり、エラーになると非対話シェルが終了し、前に書いた代入がコマンドの後も残る',
  en: 'a POSIX special builtin: a command built into bash, which runs in this shell with no new process. In POSIX mode, it is found before functions, an error in it exits a non-interactive shell, and the assignments before it stay after it',
};

/** The badge of a POSIX special builtin (4.4): its own word, in place of the builtin's. */
const SPECIAL_WORD: Text = { ja: '特殊ビルトイン', en: 'special builtin' };

/** The word of a kind of command name, as the badge says it ("builtin", "ビルトイン"). */
export const nameKindWord =(lang: Lang, kind: NameKind): string => NAME_KINDS[kind].word[lang];

/** What the panel and the other outputs say of a command name, in one language (`nameSaid`). */
export interface NameSaid {
  /** The badge: the kind's word. */
  kind: string;
  /** What the kind is: the badge's tooltip. */
  title: string;
  /** "run by `sudo`": the command that looks the name up; where nothing runs, why ("`builtin` finds no builtin named `ls`"). */
  by?: string;
  /** The line on what else the same name is, and how to reach it (only on a name with another meaning). */
  also?: string;
  /** The kind (and who runs it) for an output with no badge: " (builtin)", "（プログラム。`sudo` が実行）". */
  short: string;
  /** The badge and `by`, for a screen reader: "program, run by sudo". */
  spoken: string;
}

/** The texts of the facts of a command name, in `lang`. */
export function nameSaid(lang: Lang, f: NameFacts): NameSaid {
  const k = NAME_KINDS[f.runs];
  const ja = lang === 'ja';
  const codes = (cs: string[]): string => {
    const q = cs.map((c) => `\`${c}\``);
    return ja ? q.join('・') : q.length > 1 ? `${q.slice(0, -1).join(', ')} or ${q[q.length - 1]}` : q[0];
  };
  // (A program that looks the name up runs the program even where bash has a builtin of that name: `sudo echo`.)
  const program = f.by !== undefined && f.runs === 'program' && f.also.some((o) => o.kind === 'builtin' && !o.off);
  const lines: string[] = f.noProgram
    ? [f.by !== undefined
      ? (ja ? `\`${f.by}\` が名前を探すので、bash のビルトインは動かない。この名前のプログラムはふつうない` : `\`${f.by}\` looks the name up, so bash's builtin does not run, and there is usually no program of this name`)
      : (ja ? 'この名前のプログラムはふつうない' : 'There is usually no program of this name')]
    : program ? [ja ? `\`${f.by}\` が名前を探すので、これはプログラムで、bash のビルトインではない` : `\`${f.by}\` looks the name up, so this is the program, not bash's builtin`] : [];
  const others = f.also.filter((o) => !((program || (f.noProgram && f.by !== undefined)) && o.kind === 'builtin')).map((o) => {
    const detail = o.kind === 'keyword' ? (ja ? 'クォートせずにコマンドの先頭に書いたとき' : 'where it starts a command unquoted')
      : o.off ? (ja ? `\`enable -n\` で無効。\`enable ${f.name}\` で有効に戻る` : `turned off by \`enable -n\` (\`enable ${f.name}\` turns it on again)`)
        : o.unexpanded ? (ja ? 'スクリプトの中では展開されない。`shopt -s expand_aliases` が要る' : 'not expanded in a script (needs `shopt -s expand_aliases`)')
          : o.path ? (ja ? `ふつうは \`${o.path}\`` : `usually \`${o.path}\``) : '';
    const reach = o.reach.length ? (ja ? `${codes(o.reach)} で動く` : `run with ${codes(o.reach)}`) : '';
    const name = o.kind === 'program' && !o.path ? (ja ? 'PATH の中のプログラム' : 'a program in PATH') : NAME_KINDS[o.kind].other[lang];
    if (ja) return [detail, reach].some(Boolean) ? `${name}（${[detail, reach].filter(Boolean).join('。')}）` : name;
    return `${name}${detail ? `, ${detail}` : ''}${reach ? ` (${reach})` : ''}`;
  });
  if (others.length) lines.push(ja ? `同じ名前で、ほかに: ${others.join('・')}` : `Same name, also: ${others.join('; ')}`);
  const by = f.runs === 'none' ? (f.why === 'not-found'
    ? (ja ? `${f.by ? `\`${f.by}\`` : 'bash'} が探しても \`${f.name}\` という名前のコマンドはない（bash は \`${f.name}: command not found\` と表示する）`
      : `${f.by ? `\`${f.by}\`` : 'bash'} finds no command named \`${f.name}\` (bash says \`${f.name}: command not found\`)`)
    : (ja ? `\`${f.by ?? 'builtin'}\` が探しても \`${f.name}\` という名前のビルトインはない` : `\`${f.by ?? 'builtin'}\` finds no builtin named \`${f.name}\``))
    : f.by === undefined ? undefined : ja ? `\`${f.by}\` が実行` : `run by \`${f.by}\``;
  // (A special builtin, as the manual names it (4.4), differs from the others in POSIX mode only.)
  const title = f.special ? SPECIAL_TITLE[lang] : k.title[lang];
  const word = f.special ? SPECIAL_WORD[lang] : k.word[lang];
  return {
    kind: word, title, ...(by ? { by } : {}), ...(lines.length ? { also: lines.join(ja ? '。' : '. ') } : {}),
    short: ja ? `（${word}${by ? `。${by}` : ''}）` : ` (${word}${by ? `, ${by}` : ''})`,
    spoken: [word, ...(by ? [by] : [])].join(ja ? '、' : ', ').replace(/`/g, ''),
  };
}

/**
 * What the outputs say of the value of an expansion where it runs (`Token.value`; docs/design/expansion-values.md):
 * the model's value, from the script's own assignments, not bash's output. The panel draws `value` and the words of
 * `split` as chips between the texts; the other outputs show `text`.
 */
export interface ValueSaid {
  /** Before the value: "Value here, from the script:". */
  lead: string;
  /** The value as shown (control characters as pictures, cut when long); absent when it is empty (then `empty`). */
  value?: string;
  /** How many characters at each end of `value` are marks of a space (`␣`), for the outputs that draw them (see `spaceLabel`). */
  valueEnds?: SpaceEnds;
  /** "an empty string", in place of `value`. */
  empty?: string;
  /** What word splitting makes of it, when that is not the value itself: the text before the words, and the words as shown. */
  split?: { said: string; words: string[]; wordEnds: SpaceEnds[] };
  /** What a drawn mark of a space is called ("space"), when `value` or a word has one: the label of the panel's and the hover's mark. */
  spaceLabel?: string;
  /** After the rest: a glob in the value, what the control characters' pictures are (inline Markdown, with no value in it). */
  tail?: string;
  /** The whole line in inline Markdown, for the outputs with no chips (the hover, Markdown, the CLI). */
  text: string;
}

/** The characters at the start and at the end of a shown text that are marks of a space. */
export type SpaceEnds = readonly [lead: number, trail: number];

/** How long a value, or a word of it, is shown; a longer one is cut. */
const VALUE_SHOWN = 80;
/**
 * How a space at either end of a value, and an empty word of a split value, are shown in the outputs that are text only.
 * U+2423 (OPEN BOX) is in far more fonts than U+2420 (SYMBOL FOR SPACE), which a machine with few fonts draws as a box;
 * the panel and the hover draw the mark themselves (`SpaceEnds`), and use this one only where a note names it.
 */
export const SPACE_MARK = '␣';
export const EMPTY_WORD = '∅';
/** How many words of a split value are shown. */
const WORDS_SHOWN = 12;

/**
 * A value, or a word of it, as the outputs show it: control characters as pictures, a space at either end as `␣`, an
 * empty word as `∅`, cut when long; `ends`: how many characters at each end are marks of a space.
 */
export function shownWord(t: string): { text: string; ends: SpaceEnds } {
  // (A newline is shown as `␊`, as in the notes on quote removal, so that it is not read as the two characters `\n`.
  // A space at either end is `␣`: Markdown takes one space at each end of a code span as padding, and a chip or a
  // hover would hide it. An empty word of a split value is `∅`. The cut is on characters, not on UTF-16 units.)
  if (t === '') return { text: EMPTY_WORD, ends: [0, 0] };
  const chars = [...t].map((c) => (c === '\n' ? '␊' : visibleChar(c)));
  const cut = chars.length > VALUE_SHOWN;
  const units = cut ? [...chars.slice(0, VALUE_SHOWN - 1), '…'] : chars;
  const first = units.findIndex((c) => c !== ' ');
  const last = units.map((c) => c !== ' ').lastIndexOf(true);
  const marked = units.map((c, i) => c === ' ' && (i < first || (!cut && i > last)));
  const firstText = marked.indexOf(false);
  const lead = firstText < 0 ? 0 : firstText;
  const trail = firstText < 0 ? marked.length : marked.length - 1 - marked.lastIndexOf(false);
  return { text: units.map((c, i) => (marked[i] ? SPACE_MARK : c)).join(''), ends: [lead, trail] };
}

/** The texts of the value of an expansion, in `lang`; `bash`: false in a script of sh or dash (the shell runs it, not bash). */
export function valueSaid(lang: Lang, v: ExpansionValue, bash = true): ValueSaid {
  const ja = lang === 'ja';
  const show = shownWord;
  const lead = ja ? 'スクリプトから分かるここでの値:' : 'Value here, from the script:';
  const shownValue = v.text === '' ? undefined : show(v.text);
  const value = shownValue?.text;
  const words = v.words;
  let split: ValueSaid['split'];
  if (words && !(words.length === 1 && words[0] === v.text)) {
    const n = words.length;
    const shown = words.slice(0, WORDS_SHOWN).map(show);
    const more = n > WORDS_SHOWN ? (ja ? `（最初の ${WORDS_SHOWN} 語）` : ` (the first ${WORDS_SHOWN})`) : '';
    split = n === 0
      ? { said: ja ? '。クォートしていないので単語分割され、単語は残らない' : '; unquoted, it is split and gives no word', words: [], wordEnds: [] }
      : { said: ja ? `。クォートしていないので単語分割され、${n} 語になる${more}:` : `; unquoted, it is split into ${n === 1 ? '1 word' : `${n} words`}${more}:`, words: shown.map((w) => w.text), wordEnds: shown.map((w) => w.ends) };
  }
  const tails: string[] = [];
  if (v.glob && v.joined) {
    tails.push(ja ? '。クォートしていないので、ワイルドカードを含む単語が前後の文字列とつながったままパターンとして働き、実行するときにファイル名と照合される（ここでは照合しない）'
      : '. Unquoted, the word its wildcards end up in, with the text around it, is a pattern: bash matches it against file names when the line runs (not done here)');
  } else if (v.glob) {
    tails.push(ja ? '。クォートしていないのでパターンとして働き、実行するときにファイル名と照合される（ここでは照合しない）'
      : `. Unquoted, it is a pattern: ${bash ? 'bash' : 'the shell'} matches it against file names when the line runs (not done here)`);
  }
  const shownTexts = [value ?? '', ...(split?.words ?? [])];
  const pictures = pictureList(shownTexts, (j, e) => (ja ? j : e));
  if (pictures) tails.push(ja ? `（制御文字は記号で表している: ${pictures}）` : ` (control characters are shown as symbols: ${pictures})`);
  const escapes = invisibleList(shownTexts, (j, e) => (ja ? j : e));
  if (escapes) tails.push(ja ? `（見えない文字はコードで表している: ${escapes}）` : ` (invisible characters are shown as their code: ${escapes})`);
  const spaced = [shownValue?.ends, ...(split?.wordEnds ?? [])].some((e) => e && e[0] + e[1] > 0);
  const marks = [
    ...(spaced ? [ja ? `\`${SPACE_MARK}\` は端の空白` : `\`${SPACE_MARK}\` is a space at an end`] : []),
    ...(split?.words.includes(EMPTY_WORD) ? [ja ? `\`${EMPTY_WORD}\` は空の単語` : `\`${EMPTY_WORD}\` is an empty word`] : []),
  ];
  if (marks.length) tails.push(ja ? `（${marks.join('、')}）` : ` (${marks.join(', ')})`);
  const tail = tails.length ? tails.join('') : undefined;
  const empty = ja ? '空文字列' : 'an empty string';
  const text = `${lead} ${value !== undefined ? codeSpan(value) : empty}${split ? split.said + split.words.map((w) => ` ${codeSpan(w)}`).join('') : ''}${tail ?? ''}`;
  return {
    lead,
    ...(value !== undefined ? { value, valueEnds: shownValue!.ends } : { empty }),
    ...(split ? { split } : {}),
    ...(spaced ? { spaceLabel: ja ? '空白' : 'space' } : {}),
    ...(tail ? { tail } : {}),
    text,
  };
}
