import { lineLabel } from './i18n';
import { broken, type Catalog, caveat, failure, note, pitfall, suggests, withBasis, type Words } from './messages-entry';
import type { Head } from './messages-levels';
import { inTrap, LOCAL_SOURCED, noShebang } from './messages-common';
import { syntaxErrorHead, syntaxErrorText, type SyntaxErrorWhat } from './messages-syntax';
import { ends, type PosixExitParams, posixExitText, type Stops } from './messages-posix';
import type { Rewrite } from './rewrite';

// The catalog's facts on commands that fail or do not run as written: syntax errors, `[` and `test`, functions defined
// where they do not reach, `unset` and read-only variables, restricted shells, `local`, and POSIX mode. Spread into
// `MESSAGES` (src/messages.ts).

export const COMMAND_MESSAGES = {
  // ---------------------------------------------------------------- functions and what runs instead (3.3, 3.7.2)
  // (3.2.1: a reserved word is one only as the first word of a command. That bash then stops a script with a syntax
  // error, the manual only implies: 6.3.3, item 19, says that in an interactive shell "Parser syntax errors will not
  // cause the shell to exit". Checked.)
  'keyword-needs-separator': withBasis(failure<{ kw: string }>(['3.2.1', '3.2.5.1', '3.2.5.2'], ({ kw }) => [
    `\`${kw}\` の前に \`;\` か改行が要る。無いと \`${kw}\` はただの引数として読まれ、この構文に \`${kw}\` が無いので、bash はこの行まで来ると「syntax error near unexpected token」を出す`,
    `A \`;\` or a newline is needed before \`${kw}\`. Without it \`${kw}\` is read as an ordinary argument, so this construct has no \`${kw}\` and, if it reaches this line, bash reports "syntax error near unexpected token"`],
    ({ kw }) => [`\`${kw}\` の前に \`;\` か改行がないので、シェルはこの行まで来ると構文エラーで止まる。`, `\`${kw}\` has no \`;\` or newline before it: the shell stops with a syntax error if it reaches this line.`]),
  { kind: 'checked', probe: 'state#keyword-separator' }),
  'syntax-error': withBasis(failure<{ what: SyntaxErrorWhat }>(['3.1.1'], syntaxErrorText,
    syntaxErrorHead), { kind: 'checked', probe: 'state#syntax-error' }),
  'syntax-error-if-bash': withBasis({ ...failure<{ what: SyntaxErrorWhat }>(['3.1.1'], syntaxErrorText,
    syntaxErrorHead), level: 'warning' as const }, { kind: 'checked', probe: 'state#syntax-error' }),
  // (4.1: "When the [ form is used, the last argument to the command must be a ]"; 3.7.5: "All builtins return an exit
  // status of 2 to indicate incorrect usage, generally invalid options or missing arguments". The manual's; the probe
  // row's try-it is kept as data, which the views do not show for the manual's facts.)
  'bracket-missing-close': withBasis(failure(['4.1', '3.7.5', '6.4'], () => [
    '`[` は最後の引数が `]` でないので、実行するとエラーになり、条件は評価されません（`[: missing \']\'`、終了ステータス 2）。構文エラーではなく、コマンド `[` が実行時に出すエラーです',
    '`[` has no `]` as its last argument, so it fails when it runs, without evaluating the condition (`[: missing \']\'`, status 2). This is not a syntax error but an error of the command `[` at run time'],
    () => ['`[` の最後の引数が `]` でないので、条件を評価せずに失敗する。', '`[` has no `]` as its last argument, so it fails without testing anything.']),
  { kind: 'manual', probe: 'state#bracket-missing' }),
  'bracket-close-glued': withBasis(suggests(failure<{ word: string; rewrite: readonly Rewrite[] }>(['4.1', '3.7.5', '6.4'], ({ word, rewrite: [fix] }) => [
    `\`${word}\` の \`]\` は単語の一部なので、\`[\` の最後の引数は \`]\` ではありません。実行するとエラーになり、条件は評価されません（\`[: missing ']'\`、終了ステータス 2）。${fix ? `\`]\` の前に空白が要ります（\`${fix.code}\`）` : 'この `]` はエスケープされている（`\\]`）ので、空白を入れても単語の文字のままです。テストの終わりには、空白のあとに別の `]` を書きます'}`,
    `The \`]\` in \`${word}\` is part of the word, so \`[\` has no \`]\` as its last argument: it fails when it runs, without evaluating the condition (\`[: missing ']'\`, status 2). ${fix ? `\`]\` needs a space before it (\`${fix.code}\`)` : 'This `]` is escaped (`\\]`): with a space before it, it is still a character of the word. End the test with another `]`, after a space'}`],
    ({ word }) => [`\`${word}\` の \`]\` は単語の一部なので、\`[\` は条件を評価せずに失敗する。`, `The \`]\` in \`${word}\` is part of the word, so \`[\` fails without testing anything.`])),
  { kind: 'manual', probe: 'state#bracket-missing' }),
  // (4.1: `test` and `[` "return a status of 0 (true) or 1 (false)", and two arguments whose first is no unary
  // operator, or three that are no binary test, `!` or `( )`, are false. bash fails with status 2 ("unary operator
  // expected"): differs. With four or more, 4.1 says only that they are "parsed and evaluated according to precedence".)
  'test-malformed': withBasis(failure<{ name: string }>(['4.1', '6.4'], ({ name }) => [
    `\`${name}\` はこの引数を条件式として読めないので、実行するとエラーになり、条件は評価されません（\`unary operator expected\`、\`binary operator expected\`、\`too many arguments\` など、終了ステータス 2）。構文エラーではなく、コマンド \`${name}\` が実行時に出すエラーです`,
    `\`${name}\` cannot read these arguments as a conditional expression, so it fails when it runs, without evaluating anything ("unary operator expected", "binary operator expected", "too many arguments"…, status 2). This is not a syntax error but an error of the command \`${name}\` at run time`],
    ({ name }) => [`\`${name}\` はこの引数を条件式として読めないので、失敗する。`, `\`${name}\` cannot read these arguments as a condition, so it fails.`]),
  { kind: 'differs', probe: 'state#test-malformed' }),
  'function-defined-later': note<{ name: string; line: number; runs: Words }>(['3.3'], ({ name, line, runs }) => [
    `\`${name}\` は${lineLabel('ja', line)} で関数として定義されますが、この行はその前に実行されるので、まだ関数ではありません（${runs.ja}）`,
    `\`${name}\` is defined as a function on ${lineLabel('en', line, 'inline')}, but this runs before that, so it is not the function yet (${runs.en})`]),
  'function-defined-in-subshell': note<{ name: string; line: number; runs: Words }>(['3.3', '3.7.3'], ({ name, line, runs }) => [
    `\`${name}\` は${lineLabel('ja', line)} で関数として定義されますが、それはサブシェルの中で、サブシェルで定義した関数は終わると消えます。ここでは関数ではありません（${runs.ja}）`,
    `\`${name}\` is defined as a function on ${lineLabel('en', line, 'inline')}, but in a subshell, and what a subshell defines is gone when it ends. It is not the function here (${runs.en})`]),
  'function-defined-in-uncalled-function': note<{ name: string; line: number; by: string; runs: Words }>(['3.3'], ({ name, line, by, runs }) => [
    `\`${name}\` は${lineLabel('ja', line)} で関数 \`${by}\` の中で定義され、その関数がここより前に実行されないので、まだ関数ではありません（${runs.ja}）`,
    `\`${name}\` is defined on ${lineLabel('en', line, 'inline')} inside the function \`${by}\`, which has not run before this, so it is not a function yet (${runs.en})`]),
  'function-defined-in-dead-branch': note<{ name: string; line: number; runs: Words }>(['3.3', '3.2.5.2'], ({ name, line, runs }) => [
    `\`${name}\` は${lineLabel('ja', line)} で関数として定義されますが、そこは実行されないコード（条件が成り立たない分岐か、\`break\`・\`continue\`・\`return\`・\`exit\` の後）なので、関数ではありません（${runs.ja}）`,
    `\`${name}\` is defined as a function on ${lineLabel('en', line, 'inline')}, but in code that never runs before this (a branch whose condition is never met, or after \`break\`, \`continue\`, \`return\` or \`exit\`), so it is not the function (${runs.en})`]),
  'function-removed-by-unset': note<{ name: string; line: number; runs: Words }>(['3.3', '4.1'], ({ name, line, runs }) => [
    `関数 \`${name}\` は${lineLabel('ja', line)} の \`unset\` で削除されているので、ここでは関数ではありません（${runs.ja}）`,
    `The function \`${name}\` was removed by \`unset\` on ${lineLabel('en', line, 'inline')}, so it is not a function here (${runs.en})`]),
  'special-builtin-before-function': note<{ name: string; line: number }>(['3.7.2', '6.11'], ({ name, line }) => [
    `POSIX モードでは特殊ビルトインが関数より先に見つかるので、${lineLabel('ja', line)} の関数 \`${name}\` ではなく、ビルトインの \`${name}\` が動きます`,
    `In POSIX mode a special builtin is found before a function, so the builtin \`${name}\` runs, not the function \`${name}\` of ${lineLabel('en', line, 'inline')}`]),
  // (4.1 says what `-f` and `-v` each do, not that both together are an error.)
  'unset-function-and-variable': withBasis(failure(['4.1'], () => [
    '`unset` に `-f` と `-v` を同時に指定するとエラーになり（`cannot simultaneously unset a function and a variable`、終了ステータス 1）、何も削除されません',
    '`unset` with both `-f` and `-v` is an error (`cannot simultaneously unset a function and a variable`, status 1): nothing is unset'],
    () => ['`unset` に `-f` と `-v` を同時に指定すると失敗し、何も削除されない。', '`unset` with both `-f` and `-v` fails, and nothing is unset.']),
  { kind: 'checked', probe: 'state#unset-fv' }),
  // (4.1: "Readonly variables and functions may not be unset", and the status is then not zero; that it is 1, the
  // manual does not say: checked.)
  'unset-readonly': withBasis(failure<{ name: string }>(['4.1', '4.2'], ({ name }) => [
    `変数 \`${name}\` は読み取り専用なので、\`unset\` はエラーになり（\`cannot unset: readonly variable\`、終了ステータス 1）、\`${name}\` は削除されません`,
    `The variable \`${name}\` is read-only, so \`unset\` fails (\`cannot unset: readonly variable\`, status 1) and \`${name}\` stays`],
    ({ name }) => [`\`${name}\` は読み取り専用なので、\`unset\` は失敗する。`, `\`${name}\` is read-only, so \`unset\` fails.`]),
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
          : then === 'exits' ? '; in POSIX mode, bash stops the script here, status 1' : ''}`],
    ({ name }) => [`\`${name}\` は読み取り専用なので、この代入は失敗する。`, `\`${name}\` is read-only, so this assignment fails.`]),
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
  },
    ({ kind, name }) => ({
      builtin: [`制限付きシェルはこの \`${name}\` を拒否する。`, `A restricted shell refuses this \`${name}\`.`],
      slash: ['制限付きシェルは `/` を含むコマンド名を拒否する。', 'A restricted shell refuses a command name with a `/`.'],
      redirect: [`制限付きシェルは出力のリダイレクト \`${name}\` を拒否する。`, `A restricted shell refuses the output redirection \`${name}\`.`],
    } satisfies Record<typeof kind, Head>)[kind]), { kind: 'checked', probe: 'state#restricted' }),
  // (`RANDOM`, `SECONDS` and the other variables the manual says "lose their special properties" when unset;
  // `subshell`: why the `unset` runs in a subshell, which alone loses it.)
  'unset-ends-special': note<{ name: string; subshell?: string }>(['5.2', '3.7.3'], ({ name, subshell }) => subshell ? [
    `\`${name}\` は \`unset\` すると、このサブシェル（${subshell}）では bash の特別な働きがなくなり、あとで値を代入しても普通の変数になります（外のシェルの \`${name}\` はそのまま）`,
    `Once unset, \`${name}\` loses what bash does with it in this subshell (${subshell}): set again there, it is a plain variable (the shell outside keeps its \`${name}\`)`] : [
    `\`${name}\` は \`unset\` すると bash の特別な働きがなくなり、あとで値を代入しても普通の変数になります`,
    `Once unset, \`${name}\` loses what bash does with it: set again later, it is a plain variable`]),
  // (`stops`: in dash and busybox ash, which stop the shell that runs it there, the script, a subshell (which ends
  // only itself, status 2) or a shell not known to be either; bash goes on with status 1.)
  // (`sourced`: a file with no shebang (src/semantics/env.ts, `readAs`), which a function may read with `source`.
  // `trap`: a trap's action, which runs where the trap fires, in a function or not (`inFunction`).)
  'local-outside-function': pitfall<{ stops: false | 'script' | 'subshell' | 'shell'; sourced?: boolean; trap?: boolean }>(['4.2'], ({ stops, sourced, trap }) => inTrap(trap, noShebang(sourced, stops === 'script' ? [
    '`local` は関数の中でしか使えず、関数の外で使うと dash や busybox ash は「local: not in a function」のエラーでスクリプトを止めます',
    '`local` can be used only inside a function; outside one, dash and busybox ash stop the script with "local: not in a function"'] : stops === 'subshell' ? [
    '`local` は関数の中でしか使えず、関数の外で使うと dash や busybox ash は「local: not in a function」のエラーでこのサブシェルを終えます（終了ステータス 2。サブシェルの外は続きます）',
    '`local` can be used only inside a function; outside one, dash and busybox ash end this subshell with "local: not in a function" (status 2; what is outside the subshell goes on)'] : stops ? [
    '`local` は関数の中でしか使えず、関数の外で使うと dash や busybox ash は「local: not in a function」のエラーで、それを実行するシェルを止めます（サブシェルなら、終わるのはそのサブシェルだけです）',
    '`local` can be used only inside a function; outside one, dash and busybox ash stop the shell that runs it with "local: not in a function" (in a subshell, only the subshell ends)'] : [
    '`local` は関数の中でしか使えず、関数の外で使うと「can only be used in a function」のエラーになります',
    '`local` can be used only inside a function; outside one it fails with "can only be used in a function"'], LOCAL_SOURCED)),
    () => ['`local` は関数の外では失敗する。', '`local` fails outside a function.'], undefined,
  ({ sourced, trap }) => (sourced || trap ? 'info' : 'error')),

  // ---------------------------------------------------------------- POSIX mode (6.11, 4.4)
  // (6.11: "Function names may not be the same as one of the POSIX special builtins". That the definition then ends the
  // script, the manual does not say: checked.)
  'posix-special-function-name': withBasis(broken<{ stops?: Stops }>(['6.11', '4.4'], ({ stops = 'script' }) => [
    `POSIX モードでは特殊ビルトインと同じ名前の関数は定義できず、bash は「is a special builtin」のエラーになり、${ends(stops)[0]}。別の名前にします`,
    `in POSIX mode a function cannot have the name of a special builtin: bash says "is a special builtin" and ${ends(stops)[1]}. Use another name`],
    () => ['POSIX モードでは、特殊組み込みコマンドの名前の関数を定義できない。', 'In POSIX mode a function cannot have the name of a special builtin.']),
  { kind: 'checked', probe: 'state#posix-special-function' }),
  'posix-special-function-name-maybe': withBasis(caveat<{ stops?: Stops }>(['6.11', '4.4'], ({ stops = 'script' }) => [
    `POSIX モードでは特殊ビルトインと同じ名前の関数は定義できず、bash は「is a special builtin」のエラーになり、${ends(stops)[0]}（この前で POSIX モードにしているのは一部の経路だけ）。別の名前にします`,
    `in POSIX mode a function cannot have the name of a special builtin: bash says "is a special builtin" and ${ends(stops)[1]} (only some paths before here turn POSIX mode on). Use another name`],
    () => ['POSIX モードが有効な経路では、特殊組み込みコマンドの名前の関数を定義できない。', 'Where POSIX mode is on, a function cannot have the name of a special builtin.']),
  { kind: 'checked', probe: 'state#posix-special-function' }),

  'posix-function-name': pitfall<{ stops?: Stops }>(['6.11', '3.3'], ({ stops = 'script' }) => [
    `POSIX モードの bash 5.2 は、名前として正しくない関数名を受け付けず、「not a valid identifier」のエラーになり、${ends(stops)[0]}（終了ステータス 2。bash 5.3 は定義する）。英数字と \`_\` だけの名前にします`,
    `in POSIX mode bash 5.2 refuses a function name that is not a valid name: it says "not a valid identifier" and ${ends(stops)[1]} (status 2; bash 5.3 defines the function). Use a name of letters, digits and \`_\``],
    () => ['POSIX モードの bash 5.2 は、この関数名を拒否する。', 'In POSIX mode bash 5.2 refuses this function name.']),
  'posix-function-name-maybe': caveat<{ stops?: Stops }>(['6.11', '3.3'], ({ stops = 'script' }) => [
    `POSIX モードの bash 5.2 は、名前として正しくない関数名を受け付けず、「not a valid identifier」のエラーになり、${ends(stops)[0]}（この前で POSIX モードにしているのは一部の経路だけ。bash 5.3 は定義する）。英数字と \`_\` だけの名前にします`,
    `in POSIX mode bash 5.2 refuses a function name that is not a valid name: it says "not a valid identifier" and ${ends(stops)[1]} (only some paths before here turn POSIX mode on; bash 5.3 defines the function). Use a name of letters, digits and \`_\``],
    () => ['POSIX モードが有効な経路では、bash 5.2 はこの関数名を拒否する。', 'Where POSIX mode is on, bash 5.2 refuses this function name.']),
  'posix-special-builtin-error': pitfall<PosixExitParams>(['4.4', '6.11'], (p) => posixExitText(p, false),
    ({ name }) => [`POSIX モードでは、この \`${name}\` のエラーで非対話シェルが終わる。`, `In POSIX mode this error of \`${name}\` ends a shell that is not interactive.`]),
  'posix-special-builtin-error-maybe': caveat<PosixExitParams>(['4.4', '6.11'], (p) => posixExitText(p, true),
    ({ name }) => [`POSIX モードが有効な経路では、この \`${name}\` のエラーで非対話シェルが終わる。`, `Where POSIX mode is on, this error of \`${name}\` ends a shell that is not interactive.`]),

} satisfies Catalog;
