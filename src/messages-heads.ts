import type { FactId, MESSAGES, Params, ProblemEntry } from './messages';
import type { StyleCase, StyleCode } from './messages-levels';
import type { Stops } from './messages-posix';
import { syntaxErrorHead } from './messages-syntax';

// The headline of each problem of the catalog: one sentence with what happens, which the panel's box "Problems on this
// line" shows first (docs/design/panel-redesign.md, P7b); "more" holds the whole text. It says only what the text says
// in the same case, with no fix. By case where the text has cases (a level by params, `set -e` on or off). A separate
// table only as src/messages.ts is at the limit of test/file-length.test.ts; the type makes it complete: a new entry
// that can be a problem does not compile without its headline.

/** The facts that can be problems: those whose entry is one, whatever its level by params. */
export type ProblemFactId = { [K in FactId]: (typeof MESSAGES)[K] extends ProblemEntry ? K : never }[FactId];

/** A headline, in Japanese and English. */
export type Head = readonly [ja: string, en: string];

/** What stops in `postfix…` under `set -e`. */
const POSTFIX_STOPS: Record<Stops, Head> = {
  script: ['スクリプトが止まる', 'the script stops'],
  subshell: ['サブシェルが終わる', 'the subshell ends'],
  unknown: ['実行しているシェルが止まる', 'the shell running it stops'],
};

function postfixHead(written: string, v: string, errexit: boolean | undefined, stops: Stops = 'script'): Head {
  const [ja, en] = POSTFIX_STOPS[stops];
  return errexit
    ? [`\`set -e\` が有効なので、\`${v}\` が 0 のとき、ここで${ja}。`, `With \`set -e\` on, ${en} here when \`${v}\` is 0.`]
    : [`\`${v}\` が 0 のとき、\`${written}\` の終了ステータスは 1 になる。`, `\`${written}\` has status 1 when \`${v}\` is 0.`];
}

export const FACT_HEADS: { [K in ProblemFactId]: (p: Params<K>) => Head } = {
  'exit-refused': ({ why, word, exits }) => (why === 'too-many'
    ? ['`exit` に語を複数渡すと終了せず、シェルは続く。', '`exit` given more than one word does not exit, and the shell goes on.']
    : exits
      ? [`\`${word}\` は数でないので、\`exit\` はエラーを出して終了ステータス 2 で終わる。`, `\`${word}\` is no number, so \`exit\` reports an error and exits with status 2.`]
      : [`\`${word}\` は数でないので、\`exit\` はエラーを出し、シェルは続く。`, `\`${word}\` is no number, so \`exit\` reports an error, and the shell goes on.`]),
  'declaration-masks-status': ({ kw, v }) => [`\`${kw} ${v}=$(…)\` は \`$(…)\` の中の失敗を隠す。`, `\`${kw} ${v}=$(…)\` hides a failure inside \`$(…)\`.`],
  'pipefail-missing': ({ last }) => [`\`set -o pipefail\` がないので、\`${last}\` より前の失敗では \`set -e\` で止まらない。`, `Without \`set -o pipefail\`, \`set -e\` does not stop on a failure before \`${last}\`.`],
  'function-last-test-returns-status': ({ name }) => [`\`&&\` の左側が失敗すると、\`${name}\` は 0 以外を返す。`, `When the left side of \`&&\` fails, \`${name}\` returns a non-zero status.`],
  'function-last-test-stops-script': ({ name }) => [`\`&&\` の左側が失敗すると、\`${name}\` の呼び出しで \`set -e\` がスクリプトを止める。`, `When the left side of \`&&\` fails, \`set -e\` stops the script at the call of \`${name}\`.`],
  'script-last-test-returns-status': ({ left }) => [`\`${left}\` が失敗すると、スクリプトは 0 以外の終了ステータスで終わる。`, `When \`${left}\` fails, the script ends with a non-zero status.`],
  'failure-reported-as-success': ({ where, name, left }) => ({
    function: [`\`${left}\` が失敗しても、\`${name}\` は成功（終了ステータス 0）を返す。`, `If \`${left}\` fails, \`${name}\` still returns success (status 0).`],
    script: [`\`${left}\` が失敗しても、スクリプトは終了ステータス 0 で終わる。`, `If \`${left}\` fails, the script still ends with status 0.`],
    fragment: [`スクリプトとして実行すると、\`${left}\` が失敗しても終了ステータス 0 で終わる。`, `Run as a script, it still ends with status 0 if \`${left}\` fails.`],
    errexit: [`\`${left}\` が失敗しても、\`set -e\` はスクリプトを止めない。`, `If \`${left}\` fails, \`set -e\` does not stop the script.`],
  } satisfies Record<typeof where, Head>)[where],
  'line-too-deep': () => ['入れ子が深すぎて最後までたどれないので、この行は説明されない。', 'The line nests too deep to follow to the end, so it is not explained.'],
  'file-not-read': ({ why }) => (why === 'too-deep'
    ? ['入れ子が深すぎて読めないので、このファイルは何も説明されない。', 'The file nests too deep to be read, so none of it is explained.']
    : ['Bash Explainer の不具合で読めなかったので、このファイルは何も説明されない。', 'A bug of the tool stopped it reading the file, so none of it is explained.']),
  'syntax-error': (p) => syntaxErrorHead(p) as Head,
  'syntax-error-if-bash': (p) => syntaxErrorHead(p) as Head,
  'keyword-needs-separator': ({ kw }) => [`\`${kw}\` の前に \`;\` か改行がないので、シェルはこの行まで来ると構文エラーで止まる。`, `\`${kw}\` has no \`;\` or newline before it: the shell stops with a syntax error if it reaches this line.`],
  'bracket-missing-close': () => ['`[` の最後の引数が `]` でないので、条件を評価せずに失敗する。', '`[` has no `]` as its last argument, so it fails without testing anything.'],
  'bracket-close-glued': ({ word }) => [`\`${word}\` の \`]\` は単語の一部なので、\`[\` は条件を評価せずに失敗する。`, `The \`]\` in \`${word}\` is part of the word, so \`[\` fails without testing anything.`],
  'test-malformed': ({ name }) => [`\`${name}\` はこの引数を条件式として読めないので、失敗する。`, `\`${name}\` cannot read these arguments as a condition, so it fails.`],
  'unset-function-and-variable': () => ['`unset` に `-f` と `-v` を同時に指定すると失敗し、何も削除されない。', '`unset` with both `-f` and `-v` fails, and nothing is unset.'],
  'unset-readonly': ({ name }) => [`\`${name}\` は読み取り専用なので、\`unset\` は失敗する。`, `\`${name}\` is read-only, so \`unset\` fails.`],
  'assign-readonly': ({ name }) => [`\`${name}\` は読み取り専用なので、この代入は失敗する。`, `\`${name}\` is read-only, so this assignment fails.`],
  'restricted-refused': ({ kind, name }) => ({
    builtin: [`制限付きシェルはこの \`${name}\` を拒否する。`, `A restricted shell refuses this \`${name}\`.`],
    slash: ['制限付きシェルは `/` を含むコマンド名を拒否する。', 'A restricted shell refuses a command name with a `/`.'],
    redirect: [`制限付きシェルは出力のリダイレクト \`${name}\` を拒否する。`, `A restricted shell refuses the output redirection \`${name}\`.`],
  } satisfies Record<typeof kind, Head>)[kind],
  'local-outside-function': () => ['`local` は関数の外では失敗する。', '`local` fails outside a function.'],
  'posix-special-function-name': () => ['POSIX モードでは、特殊組み込みコマンドの名前の関数を定義できない。', 'In POSIX mode a function cannot have the name of a special builtin.'],
  'posix-special-function-name-maybe': () => ['POSIX モードが有効な経路では、特殊組み込みコマンドの名前の関数を定義できない。', 'Where POSIX mode is on, a function cannot have the name of a special builtin.'],
  'posix-function-name': () => ['POSIX モードの bash 5.2 は、この関数名を拒否する。', 'In POSIX mode bash 5.2 refuses this function name.'],
  'posix-function-name-maybe': () => ['POSIX モードが有効な経路では、bash 5.2 はこの関数名を拒否する。', 'Where POSIX mode is on, bash 5.2 refuses this function name.'],
  'posix-special-builtin-error': ({ name }) => [`POSIX モードでは、この \`${name}\` のエラーで非対話シェルが終わる。`, `In POSIX mode this error of \`${name}\` ends a shell that is not interactive.`],
  'posix-special-builtin-error-maybe': ({ name }) => [`POSIX モードが有効な経路では、この \`${name}\` のエラーで非対話シェルが終わる。`, `Where POSIX mode is on, this error of \`${name}\` ends a shell that is not interactive.`],
  'postfix-increment-status': ({ v, errexit, stops }) => postfixHead(`((${v}++))`, v, errexit, stops),
  'postfix-decrement-status': ({ v, errexit, stops }) => postfixHead(`((${v}--))`, v, errexit, stops),
  'alias-not-expanded-in-script': ({ name, off, unread, fn }) => {
    const [ja, en] = unread || fn ? ['になることがある', 'may be'] : ['になる', 'is'];
    return off
      ? [`エイリアスの展開が無効なので、\`${name}\` は command not found ${ja}。`, `Alias expansion is off, so \`${name}\` ${en} "command not found".`]
      : [`スクリプトではエイリアスを展開しないので、\`${name}\` は command not found ${ja}。`, `bash does not expand aliases in scripts, so \`${name}\` ${en} "command not found".`];
  },
  'alias-maybe-not-expanded': ({ name }) => [`スクリプトとして実行すると、\`${name}\` は command not found になる。`, `Run as a script, \`${name}\` is "command not found".`],
  'unbraced-element': ({ name, sub }) => [`\`$${name}${sub}\` は配列の要素ではない。`, `\`$${name}${sub}\` is not an element of the array.`],
  'extglob-in-same-block': ({ use, reader }) => (reader
    ? [`\`${use}\` は構文エラーになることがある（同じブロックの \`shopt -s extglob\` では間に合わない）。`, `\`${use}\` may be a syntax error: \`shopt -s extglob\` in the same block comes too late.`]
    : [`\`${use}\` は構文エラーになる（同じブロックの \`shopt -s extglob\` では間に合わない）。`, `\`${use}\` is a syntax error: \`shopt -s extglob\` in the same block comes too late.`]),
  'extglob-maybe-on': ({ use }) => [`\`extglob\` を有効にしない経路では、\`${use}\` は構文エラーになる。`, `\`${use}\` is a syntax error on the paths that do not turn \`extglob\` on.`],
  'extglob-turned-off': ({ use }) => [`\`shopt -u extglob\` で無効にしたので、\`${use}\` は構文エラーになる。`, `\`${use}\` is a syntax error: \`shopt -u extglob\` turned it off.`],
  'extglob-not-found': ({ use }) => [`\`extglob\` をほかの場所で有効にしていなければ、\`${use}\` は構文エラーになる。`, `\`${use}\` is a syntax error unless \`extglob\` is turned on elsewhere.`],
  'extglob-maybe-on-trap': ({ use }) => [`\`extglob\` が有効になる前にシグナルが来ると、トラップの \`${use}\` は構文エラーになる。`, `\`${use}\` in a trap is a syntax error if its signal comes before \`extglob\` is on.`],
  'extglob-not-in-new-shell': ({ use, reader }) => (reader
    ? [`新しいシェルでは、\`${use}\` は構文エラーになることがある。`, `\`${use}\` may be a syntax error in the new shell.`]
    : [`新しいシェルは \`extglob\` が無効で始まるので、\`${use}\` は構文エラーになる。`, `\`${use}\` is a syntax error in the new shell, which starts with \`extglob\` off.`]),
  'globstar-maybe-on': ({ on }) => [`\`${on}\` を通らない経路では、\`**\` は1階層しか一致しない。`, `On the paths that do not run \`${on}\`, \`**\` matches one level only.`],
  'globstar-not-found': ({ on }) => [`\`${on}\` をほかの場所で実行していなければ、\`**\` は1階層しか一致しない。`, `\`**\` matches one level only unless \`${on}\` runs elsewhere.`],
  'globstar-unsupported': ({ shell }) => [`${shell} には globstar がないので、\`**\` は1階層しか一致しない。`, `${shell} has no globstar, so \`**\` matches one level only.`],
  'variable-not-in-remote-shell': ({ v, unread, sent }) => (unread || sent
    ? [`リモートのシェルには \`${v}\` がないことがある。`, `The remote shell may not have \`${v}\`.`]
    : [`リモートのシェルには \`${v}\` がない。`, `The remote shell does not have \`${v}\`.`]),
  'variable-not-passed-by-wrapper': ({ v, via }) => [`\`${via}\` は \`${v}\` を新しいシェルに渡さない。`, `\`${via}\` does not pass \`${v}\` to the new shell.`],
  'variable-not-exported': ({ v, environment, array, unread }) => (array
    ? [`\`${v}\` は配列で、配列はエクスポートできないので、新しいシェルでは空になる。`, `\`${v}\` is an array, which bash cannot export, so it is empty in the new shell.`]
    : environment === 'maybe'
      ? [`\`${v}\` は、もともと環境変数にあるときだけ新しいシェルに届く。`, `\`${v}\` reaches the new shell only if it was in the environment already.`]
      : environment || unread
        ? [`\`${v}\` はエクスポートされていないので、新しいシェルでは空になることがある。`, `\`${v}\` is not exported, so it may be empty in the new shell.`]
        : [`\`${v}\` はエクスポートされていないので、新しいシェルでは空になる。`, `\`${v}\` is not exported, so it is empty in the new shell.`]),
  'function-not-in-container': ({ name }) => [`コンテナの中には、このスクリプトの関数 \`${name}\` がない。`, `The container does not have this script's function \`${name}\`.`],
  'builtin-or-function-as-program': ({ via, name, isFn }) => (isFn
    ? [`\`${via}\` は \`${name}\` を別のプログラムとして起動するので、シェルの関数は実行できない。`, `\`${via}\` starts \`${name}\` as a program, so it cannot run a shell function.`]
    : [`\`${via}\` は \`${name}\` を別のプログラムとして起動するので、シェルの組み込みコマンドは実行できない。`, `\`${via}\` starts \`${name}\` as a program, so it cannot run a shell builtin.`]),
  'ssh-local-expansion': ({ risky }) => [`\`ssh\` に渡す前に、手元のシェルが \`${risky}\` を展開する。`, `The local shell expands \`${risky}\` before \`ssh\` sends the command.`],
  'placeholder-in-shell-string': ({ by, what }) => (what === 'path'
    ? [`\`${by}\` が見つけたパスをシェルのコードに埋め込むので、ファイル名によっては任意のコマンドが実行される。`, `\`${by}\` pastes each path it finds into the shell's code, so a file name can run arbitrary commands.`]
    : [`\`${by}\` が入力の1件をシェルのコードに埋め込むので、その中身によっては任意のコマンドが実行される。`, `\`${by}\` pastes each input item into the shell's code, so an item can run arbitrary commands.`]),
  'function-not-on-remote': ({ name }) => [`リモートのシェルには、このスクリプトの関数 \`${name}\` がない。`, `The remote shell does not have this script's function \`${name}\`.`],
  'function-not-in-new-shell-blocked': ({ via, fn }) => [`\`${via}\` の新しいシェルには、\`export -f\` をしても関数 \`${fn}\` がない。`, `The new shell of \`${via}\` does not have the function \`${fn}\`, even with \`export -f\`.`],
  'function-not-in-new-shell': ({ via, fn }) => [`\`${via}\` の新しいシェルには、このスクリプトの関数 \`${fn}\` がない。`, `The new shell of \`${via}\` does not have this script's function \`${fn}\`.`],
  'function-not-imported': ({ shell, fn }) => [`${shell} は bash がエクスポートした関数を読まないので、\`${fn}\` がない。`, `${shell} does not read the functions bash exports, so \`${fn}\` is not there.`],
  'function-not-in-new-shell-export': ({ via, fn }) => [`\`export -f\` がないと、\`${via}\` の新しいシェルには関数 \`${fn}\` がない。`, `Without \`export -f\`, the new shell of \`${via}\` does not have the function \`${fn}\`.`],
  'function-not-imported-sh': ({ fn }) => [`sh はエクスポートした関数を読まないことがあるので、\`${fn}\` がないことがある。`, `sh may not read exported functions, so \`${fn}\` may not be there.`],
  'function-shadowed-by-program': ({ name }) => [`このスクリプトの関数ではなく、プログラム \`${name}\` が実行される。`, `The program \`${name}\` runs, not this script's function.`],
  'wrapper-assignment-expanded-first': ({ use, via, v }) => [`\`${via}\` が \`${v}\` を設定する前に、今のシェルが \`${use}\` を展開する。`, `The current shell expands \`${use}\` before \`${via}\` sets \`${v}\`.`],
  'pipeline-subshell-variable': ({ used, partial }) => (partial
    ? [`\`lastpipe\` が有効でない経路では、パイプの右側で設定した \`${used}\` は消える。`, `Where \`lastpipe\` is off, \`${used}\` set on the right side of the pipe is gone when the pipeline ends.`]
    : [`パイプの右側で設定した \`${used}\` は、パイプラインが終わると消える。`, `\`${used}\` set on the right side of the pipe is gone when the pipeline ends.`]),
  'unmatched-glob-runs-once': ({ glob, v, how }) => (how.menu
    ? [`\`${glob}\` に一致するファイルがなくても、メニューには項目が出る。`, `When no file matches \`${glob}\`, the menu still shows an entry for it.`]
    : [`\`${glob}\` に一致するファイルがなくても、\`${v}\` がパターンの文字列のままでループが実行される。`, `When no file matches \`${glob}\`, the loop still runs, with \`${v}\` set to the pattern's text.`]),
  'prefix-assignment-expanded-first': ({ v, name, use }) => [`\`${v}=…\` が \`${name}\` に届く前に、今のシェルが \`${use}\` を展開する。`, `The current shell expands \`${use}\` before \`${v}=…\` reaches \`${name}\`.`],
  'unquoted-variable-as-path': ({ bare, destroys }) => (destroys
    ? [`クォートしていない \`${bare}\` は値によって分かれたり展開されたりし、意図しないファイルを削除や上書きすることがある。`, `Unquoted \`${bare}\` can split or expand, and this command may then delete or overwrite files it should not.`]
    : [`クォートしていない \`${bare}\` は、値に空白や \`*\` があると分かれたり展開されたりする。`, `Unquoted \`${bare}\` is split or expanded when its value has spaces or \`*\`.`]),
  'for-over-ls-output': ({ cmd }) => [`\`$(${cmd} …)\` の出力は空白と改行で分かれるので、空白を含むファイル名が壊れる。`, `The output of \`$(${cmd} …)\` is split on spaces and newlines, so file names with spaces break.`],
  'for-over-unquoted-args': ({ value }) => [`クォートしていない \`${value}\` は、空白を含む引数を分けてしまう。`, `Unquoted \`${value}\` splits arguments that contain spaces.`],
  'array-joined-in-assignment': ({ v, args }) => (args
    ? [`引数が空白でつながり、\`${v}\` は1つの文字列になる。`, `The arguments are joined by spaces, and \`${v}\` is one string.`]
    : [`要素が空白でつながり、\`${v}\` は1つの文字列になる。`, `The elements are joined by spaces, and \`${v}\` is one string.`]),
  'unquoted-variable-in-test': ({ bare, zsh }) => (zsh
    ? [`クォートしていない \`${bare}\` は、値が空のとき \`[ ]\` の条件式を壊す。`, `Unquoted \`${bare}\` breaks the \`[ ]\` test when it is empty.`]
    : [`クォートしていない \`${bare}\` は、値が空や空白入りのとき \`[ ]\` の条件式を壊す。`, `Unquoted \`${bare}\` breaks the \`[ ]\` test when it is empty or has spaces.`]),
  'nounset-unbound': ({ v, name, environment }) => (environment === 'no'
    ? [`\`${v}\` はここで設定されておらず、\`set -u\` では読むとエラーになる。`, `\`${v}\` is not set here, and with \`set -u\` reading it is an error.`]
    : [`\`${name}\` が環境変数から来なければ、\`set -u\` では \`${v}\` を読むとエラーになる。`, `Unless \`${name}\` comes from the environment, reading \`${v}\` is an error with \`set -u\`.`]),
  'shebang-refused': ({ rest }) => [`Linux では bash が \`${rest}\` を1つの引数として拒否し、直接実行すると何も実行せずに止まる。`, `On Linux bash refuses \`${rest}\` as one argument: run directly, the script stops before running anything.`],
  'find-action-refused': ({ option }) => [`find はこの \`${option}\` を拒否し、エラーで止まる。`, `find refuses this \`${option}\` and stops with an error.`],
  'shebang-bom': () => ['先頭の見えない BOM のせいで、1行目はシバンではなく、失敗するコマンドになる。', 'An invisible BOM makes the first line no shebang but a command that fails.'],
  'redirect-by-your-shell': ({ op, file }) => (file
    ? [`\`${file}\` はふつう root しか書き込めないが、\`${op}\` を開くのは sudo ではなく今のシェルなので、失敗する。`, `\`${file}\` is normally writable only by root, and your shell, not sudo, opens \`${op}\`, so it fails.`]
    : [`リダイレクト \`${op}\` を開くのは sudo ではなく今のシェルなので、権限が足りないと失敗する。`, `Your shell, not sudo, opens the redirection \`${op}\`, so it fails without the rights.`]),
  'bats-tags-invalid': ({ scope }) => [`\`${scope}_tags\` の書き方が正しくないので、bats はこのファイルのテストを1つも実行しない。`, `The \`${scope}_tags\` list is not valid, so bats runs none of the tests of this file.`],
  'bats-test-line-dropped': ({ dropped }) => [`関数名より前の \`${dropped}\` は実行されない。`, `\`${dropped}\` before the function's name never runs.`],
  'bats-negation-ignored': ({ cmd }) => [`テストの最後でない限り、\`${cmd}\` が成功しても \`! ${cmd}\` はテストを失敗させない。`, `Unless it is the last command, \`! ${cmd}\` does not fail the test when \`${cmd}\` succeeds.`],
  'bats-run-in-pipeline-stage': ({ cmd }) => [`\`run ${cmd}\` が設定した \`$status\` と \`$output\` は、パイプラインが終わると消える。`, `The \`$status\` and \`$output\` of \`run ${cmd}\` are gone when the pipeline ends.`],
  'bats-run-in-pipeline': ({ cmd }) => [`\`run\` は \`${cmd}\` の出力を \`$output\` に入れるので、パイプには何も流れない。`, `\`run\` keeps the output of \`${cmd}\` in \`$output\`, so the pipe gets nothing.`],
  'bats-setup-suite-in-test-file': () => ['bats はテストファイルの `setup_suite` を呼ばない。', 'bats does not call a `setup_suite` of a test file.'],
  'regex-backslash-dropped': ({ list }) => [`\`[[ =~ ]]\` の右辺の ${list} はバックスラッシュが消え、正規表現の演算子にならない。`, `In \`[[ =~ ]]\`, ${list} loses its backslash and is no regex operator.`],
  'distro-alias-in-script': ({ name, what }) => [`\`${name}\` は対話シェル用の${what.ja}で、コマンドではない。`, `\`${name}\` is ${what.en} for interactive shells, not a command.`],
  'dockerfile-pipefail-missing': () => ['パイプの途中のコマンドが失敗しても、RUN は成功してビルドが続く。', 'If a command in the middle of the pipe fails, RUN still succeeds and the build goes on.'],
  'python-string-without-shell': () => ['shell=True がないと、文字列全体が1つのプログラム名になる。', 'Without shell=True the whole string is one program name.'],
  'python-shell-injection': () => ['Python の値を埋め込んだ文字列をシェルが実行するので、値によって任意のコマンドが実行される。', 'The shell runs a string with Python values pasted in, so a value can run arbitrary commands.'],
  'actions-script-injection': ({ expr }) => [`外部の人が書ける \`${expr}\` がスクリプトに埋め込まれ、値によって任意のコマンドが実行される。`, `\`${expr}\`, which anyone can set, is pasted into the script, so a value can run arbitrary commands.`],
  'stderr-to-original-stdout': ({ dup, file, discards }) => (discards
    ? [`\`${dup}\` が \`${file}\` より前なので、標準エラー出力は捨てられない。`, `\`${dup}\` comes before \`${file}\`, so stderr is not discarded.`]
    : [`\`${dup}\` が \`${file}\` より前なので、標準エラー出力はファイルに行かない。`, `\`${dup}\` comes before \`${file}\`, so stderr does not go to the file.`]),
};

/** The headline of each style check of src/pitfalls.ts, as for a fact: by what the check found (`StyleCase`). */
export const STYLE_HEADS: Record<StyleCode, (c: StyleCase) => Head> = {
  'bracket-no-space': () => ['かっこの後に空白がないので、別のコマンド名として読まれる。', 'With no space after the bracket, this reads as another command name.'],
  'assignment-with-spaces': () => ['これは代入ではなく、コマンドの実行になる。', 'This runs a command; it is not an assignment.'],
  'brace-no-space': () => ['`{` の後に空白がないので、グループの始まりではなくコマンド名になる。', 'With no space after `{`, this is a command name, not the start of a group.'],
  'brace-close-no-separator': () => ['`}` の前に `;` か改行がないので、グループが閉じない。', '`}` has no `;` or newline before it, so the group is never closed.'],
  'rm-empty-variable-root': () => ['値が空だと、ルートから削除することになる。', 'If the value is empty, this deletes from the root.'],
  'read-without-r': () => ['`-r` がないと、入力のバックスラッシュが失われる。', 'Without `-r`, backslashes in the input are lost.'],
  'redirect-in-bracket': () => ['`[ ]` の中の `<` や `>` は比較ではなくリダイレクトになる。', 'A `<` or `>` inside `[ ]` is a redirection, not a comparison.'],
  'bracket-close-in-word': ({ maybeEmpty }) => (maybeEmpty
    ? ['`]` は単語の一部なので、変数が空だと別の条件になり、値があると `[` は失敗する。', 'The `]` is part of the word: an empty variable makes another test, and a value makes `[` fail.']
    : ['`]` は単語の一部なので、`[` は閉じず、失敗する。', 'The `]` is part of the word, so `[` has no closing `]` and fails.']),
  'and-or-in-bracket': () => ['`[ ]` の中の `&&` や `||` はコマンドをつなぐ演算子になり、`[` の `]` がなくなる。', 'A `&&` or `||` inside `[ ]` joins commands, so `[` loses its `]`.'],
  'download-run-by-shell': () => ['ダウンロードした内容を、確かめずにシェルが実行する。', 'A shell runs what is downloaded, unchecked.'],
  'trap-goes-on': () => ['この処理のあと、スクリプトは止まらずに続く。', 'After this action, the script goes on from where it was.'],
  'source-searches-path': () => ['名前に `/` がないので、ファイルを `$PATH` からも探す。', 'With no `/` in its name, the file is also searched for in `$PATH`.'],
  'pattern-from-variable': () => ['変数の値はただの文字列ではなく、正規表現として読まれる。', 'The value of the variable is read as a regular expression, not as plain text.'],
};
