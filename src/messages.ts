import type { Lang, Text } from './i18n';

// The message catalog: the notes and pitfalls that render a fact of the semantic models (src/semantics/: the shell
// state, where code runs, words, names, status), each with a stable id, its texts in ja and en, and the sections of
// the Bash manual it is about (src/manual.ts). The renderers show the sections as links, or as "(Bash manual 3.7.5)"
// in the CLI; the JSON output gives the id.
//
// The texts are the analyzer's: a fact is found where the model is read (src/analyzer.ts, src/statusfacts.ts,
// src/wordfacts.ts), and said here. The style checks of src/pitfalls.ts are not facts and have no entry.

/** `note`: said with ℹ. `pitfall`: with ⚠, and only when the pitfalls are on. */
export type FactKind = 'note' | 'pitfall';

interface Entry<P> {
  kind: FactKind;
  refs: readonly string[];
  /** The text in Japanese and English, without the ℹ or ⚠ that `kind` gives. */
  text: (p: P) => readonly [ja: string, en: string];
}

const entry = <P = Record<string, never>>(kind: FactKind, refs: readonly string[], text: (p: P) => readonly [string, string]): Entry<P> => ({ kind, refs, text });

/** A text in both languages, for a parameter that is itself words (where `set -e` is ignored…). */
type Words = Text;

export const MESSAGES = {
  // ---------------------------------------------------------------- exit status (3.7.5)
  'exit-modulo': entry<{ value: string; status: number }>('note', ['3.7.5'], ({ value, status }) => [
    `終了ステータスは 0〜255 なので、\`${value}\` は 256 で割った余りの ${status} になる`,
    `An exit status is 0–255, so \`${value}\` becomes ${status} (the value modulo 256)`]),

  // ---------------------------------------------------------------- errexit (4.3.1, 4.3.2)
  'errexit-off-in-substitution': entry<{ first: string }>('note', ['4.3.1', '4.3.2'], ({ first }) => [
    `bash は \`$( )\` の中では \`set -e\` を切る（\`shopt -s inherit_errexit\` が無いとき）。\`${first}\` が失敗しても、あとのコマンドは実行される`,
    `bash turns \`set -e\` off inside \`$( )\` (without \`shopt -s inherit_errexit\`): if \`${first}\` fails, the commands after it still run`]),
  'errexit-set-called-where-ignored': entry<{ name: string; line: number }>('note', ['4.3.1'], ({ name, line }) => [
    `この \`set -e\` は \`${name}\` の呼び出しが終わるまで効かない: \`${name}\` は \`set -e\` が無視される所（行 ${line}）から呼ばれる`,
    `This \`set -e\` takes effect only when the call of \`${name}\` returns: \`${name}\` is called where \`set -e\` is ignored (line ${line})`]),
  'errexit-set-maybe-called-where-ignored': entry<{ name: string; line: number }>('note', ['4.3.1'], ({ name, line }) => [
    `\`${name}\` は \`set -e\` が無視される所（行 ${line}）からも呼ばれ、そのときこの \`set -e\` は呼び出しが終わるまで効かない`,
    `\`${name}\` is also called where \`set -e\` is ignored (line ${line}); there this \`set -e\` takes effect only when the call returns`]),
  'errexit-set-in-ignored-subshell': entry<{ where: Words }>('note', ['4.3.1'], ({ where }) => [
    `この \`set -e\` は効かない: このサブシェルは ${where.ja}にあり、そこでは \`set -e\` が無視される`,
    `This \`set -e\` has no effect: this subshell runs ${where.en}, where \`set -e\` is ignored`]),
  'errexit-set-in-ignored-group': entry<{ where: Words }>('note', ['4.3.1'], ({ where }) => [
    `この \`set -e\` は、それを含むコマンドが終わるまで効かない: ${where.ja}では \`set -e\` が無視される`,
    `This \`set -e\` takes effect only when the command that holds it ends: \`set -e\` is ignored ${where.en}`]),
  'errexit-function-called-only-where-ignored': entry<{ name: string; line: number }>('note', ['4.3.1', '3.3'], ({ name, line }) => [
    `\`${name}\` は \`set -e\` が無視される所（行 ${line}）からしか呼ばれないので、その中でも \`set -e\` は無視される。途中のコマンドが失敗しても止まらず、次のコマンドに進む`,
    `\`${name}\` is called only where \`set -e\` is ignored (line ${line}), so it is ignored in all of its body too: a command that fails in the middle does not stop it`]),
  'errexit-group-where-ignored': entry<{ what: string; where: Words }>('note', ['4.3.1'], ({ what, where }) => [
    `${where.ja}で実行されるので、${what}の中でも \`set -e\` は無視される。途中のコマンドが失敗しても止まらず、次のコマンドに進む`,
    `\`set -e\` is ignored in this ${what}, since it runs ${where.en}: a command that fails in the middle does not stop it`]),
  'declaration-masks-status': entry<{ kw: string; v: string }>('pitfall', ['4.2', '4.3.1'], ({ kw, v }) => [
    `\`${kw} ${v}=$(…)\` の終了ステータスは \`${kw}\` 自身のもの（成功）になり、\`$(…)\` の中の失敗が隠れます（\`set -e\` でも止まりません）。\`${kw} ${v}\` と \`${v}=$(…)\` の2行に分けます`,
    `the status of \`${kw} ${v}=$(…)\` is that of \`${kw}\` (success), which hides a failure inside \`$(…)\` (even from \`set -e\`). Split it: \`${kw} ${v}\`, then \`${v}=$(…)\``]),
  'pipefail-missing': entry<{ last: string }>('pitfall', ['3.2.3', '4.3.1'], ({ last }) => [
    `\`set -o pipefail\` が無いので、パイプラインの終了ステータスは最後のコマンド（\`${last}\`）のものだけになる。前のコマンドが失敗しても \`set -e\` では止まらない（このスクリプトのほかのパイプラインも同じ）`,
    `without \`set -o pipefail\`, the status of a pipeline is that of its last command (\`${last}\`) alone, so \`set -e\` does not stop the script when a command before it fails (the same holds for the other pipelines of the script)`]),
  'function-last-test-returns-status': entry<{ name: string; line: number }>('pitfall', ['3.3', '3.7.5', '4.3.1'], ({ name, line }) => [
    `これは関数 \`${name}\` の最後のコマンドなので、\`&&\` の左側が失敗すると \`${name}\` はその終了ステータス（0 以外）を返し、行 ${line} の呼び出しで終わるスクリプトもその終了ステータスになる。\`if …; then …; fi\` と書くか、最後に \`return 0\` を置く`,
    `this is the last command of \`${name}\`, so when the left side of \`&&\` fails, \`${name}\` returns its non-zero status, and so does the script, which ends with the call on line ${line}. Write \`if …; then …; fi\`, or end the function with \`return 0\``]),
  'function-last-test-stops-script': entry<{ name: string; line: number }>('pitfall', ['3.3', '3.7.5', '4.3.1'], ({ name, line }) => [
    `これは関数 \`${name}\` の最後のコマンドなので、\`&&\` の左側が失敗すると \`${name}\` はその終了ステータス（0 以外）を返し、\`set -e\` により行 ${line} の呼び出しでスクリプトが止まる。\`if …; then …; fi\` と書くか、最後に \`return 0\` を置く`,
    `this is the last command of \`${name}\`, so when the left side of \`&&\` fails, \`${name}\` returns its non-zero status and \`set -e\` stops the script at the call on line ${line}. Write \`if …; then …; fi\`, or end the function with \`return 0\``]),

  // ---------------------------------------------------------------- functions and what runs instead (3.3, 3.7.2)
  'function-defined-later': entry<{ name: string; line: number; runs: Words }>('note', ['3.3'], ({ name, line, runs }) => [
    `\`${name}\` は行 ${line} で関数として定義されますが、この行はその前に実行されるので、まだ関数ではありません（${runs.ja}）`,
    `\`${name}\` is defined as a function on line ${line}, but this runs before that, so it is not the function yet (${runs.en})`]),
  'function-defined-in-subshell': entry<{ name: string; line: number; runs: Words }>('note', ['3.3', '3.7.3'], ({ name, line, runs }) => [
    `\`${name}\` は行 ${line} で関数として定義されますが、それはサブシェルの中で、サブシェルで定義した関数は終わると消えます。ここでは関数ではありません（${runs.ja}）`,
    `\`${name}\` is defined as a function on line ${line}, but in a subshell, and what a subshell defines is gone when it ends. It is not the function here (${runs.en})`]),
  'function-defined-in-uncalled-function': entry<{ name: string; line: number; by: string; runs: Words }>('note', ['3.3'], ({ name, line, by, runs }) => [
    `\`${name}\` は行 ${line} で関数 \`${by}\` の中で定義され、その関数がここより前に実行されないので、まだ関数ではありません（${runs.ja}）`,
    `\`${name}\` is defined on line ${line} inside the function \`${by}\`, which has not run before this, so it is not a function yet (${runs.en})`]),
  'function-defined-in-dead-branch': entry<{ name: string; line: number; runs: Words }>('note', ['3.3', '3.2.5.2'], ({ name, line, runs }) => [
    `\`${name}\` は行 ${line} で関数として定義されますが、そこは実行されないコード（条件が成り立たない分岐か、\`break\`・\`continue\`・\`return\`・\`exit\` の後）なので、関数ではありません（${runs.ja}）`,
    `\`${name}\` is defined as a function on line ${line}, but in code that never runs before this (a branch whose condition is never met, or after \`break\`, \`continue\`, \`return\` or \`exit\`), so it is not the function (${runs.en})`]),
  'function-removed-by-unset': entry<{ name: string; line: number; runs: Words }>('note', ['3.3', '4.1'], ({ name, line, runs }) => [
    `関数 \`${name}\` は行 ${line} の \`unset\` で削除されているので、ここでは関数ではありません（${runs.ja}）`,
    `The function \`${name}\` was removed by \`unset\` on line ${line}, so it is not a function here (${runs.en})`]),
  'special-builtin-before-function': entry<{ name: string; line: number }>('note', ['3.7.2', '6.11'], ({ name, line }) => [
    `POSIX モードでは特殊ビルトインが関数より先に見つかるので、行 ${line} の関数 \`${name}\` ではなく、ビルトインの \`${name}\` が動きます`,
    `In POSIX mode a special builtin is found before a function, so the builtin \`${name}\` runs, not the function \`${name}\` of line ${line}`]),
  'local-outside-function': entry('pitfall', ['4.2'], () => [
    '`local` は関数の中でしか使えず、関数の外で使うと「can only be used in a function」のエラーになります',
    '`local` can be used only inside a function; outside one it fails with "can only be used in a function"']),

  // ---------------------------------------------------------------- POSIX mode (6.11, 4.4)
  'posix-special-function-name': entry('pitfall', ['6.11', '4.4'], () => [
    `POSIX モードでは特殊ビルトインと同じ名前の関数は定義できず、bash はここで「is a special builtin」のエラーになってスクリプトを止めます。別の名前にします`,
    `in POSIX mode a function cannot have the name of a special builtin: bash stops the script here with the error "is a special builtin". Use another name`]),
  'posix-special-function-name-maybe': entry('pitfall', ['6.11', '4.4'], () => [
    `POSIX モードでは特殊ビルトインと同じ名前の関数は定義できず、bash はここで「is a special builtin」のエラーになってスクリプトを止めます（この前で POSIX モードにしているのは一部の経路だけ）。別の名前にします`,
    `in POSIX mode a function cannot have the name of a special builtin: bash stops the script here with the error "is a special builtin" (only some paths before here turn POSIX mode on). Use another name`]),

  // ---------------------------------------------------------------- arithmetic and status (6.5, 4.3.1)
  'postfix-increment-status': entry<{ v: string }>('pitfall', ['6.5', '4.3.1'], ({ v }) => [
    `\`((${v}++))\` の値は増やす前の値なので、\`${v}\` が 0 のとき終了ステータスは 1 になる（\`set -e\` ではスクリプトが止まる）。\`((++${v}))\` や \`${v}=$((${v}+1))\` なら 0 になる`,
    `the value of \`((${v}++))\` is the value before the increment, so the exit status is 1 when \`${v}\` is 0 (under \`set -e\` the script stops). \`((++${v}))\` and \`${v}=$((${v}+1))\` give status 0`]),
  'postfix-decrement-status': entry<{ v: string }>('pitfall', ['6.5', '4.3.1'], ({ v }) => [
    `\`((${v}--))\` の値は減らす前の値なので、\`${v}\` が 0 のとき終了ステータスは 1 になる（\`set -e\` ではスクリプトが止まる）`,
    `the value of \`((${v}--))\` is the value before the decrement, so the exit status is 1 when \`${v}\` is 0 (under \`set -e\` the script stops)`]),

  // ---------------------------------------------------------------- conditions decided by the values above (3.2.4, 3.2.5; src/statusfacts.ts)
  // (`which`: `if` or `elif` when both are on the line, else empty: "this condition".)
  'condition-always-false': entry<{ values: Words; which: string }>('note', ['3.2.5.2'], ({ values, which }) => [
    `ここでは ${values.ja}なので、${which ? `\`${which}\` の条件` : 'この条件'}は常に偽になり、\`then\` の後のコマンドは実行されない`,
    `${values.en} here, so ${which ? `the \`${which}\` condition` : 'this condition'} is always false: the commands after its \`then\` never run`]),
  'condition-always-true': entry<{ values: Words; rest: { kinds: string[]; count: number }; which: string }>('note', ['3.2.5.2'], ({ values, rest, which }) => [
    `ここでは ${values.ja}なので、${which ? `\`${which}\` の条件` : 'この条件'}は常に真になり、${rest.count ? `後の分岐（${rest.kinds.map((k) => `\`${k}\``).join('・')}）は実行されない` : '`then` の後のコマンドは必ず実行される'}`,
    `${values.en} here, so ${which ? `the \`${which}\` condition` : 'this condition'} is always true: ${rest.count ? `${rest.count > 1 ? 'the branches' : 'the branch'} after it (${rest.kinds.map((k) => `\`${k}\``).join(', ')}) never ${rest.count > 1 ? 'run' : 'runs'}` : 'the commands after its `then` always run'}`]),
  'loop-never-runs': entry<{ values: Words }>('note', ['3.2.5.1'], ({ values }) => [
    `ここでは ${values.ja}なので、ループは最初の判定で終わり、本体は一度も実行されない`,
    `${values.en} here, so the loop stops at its first test: its body never runs`]),
  'loop-never-ends': entry<{ values: Words }>('note', ['3.2.5.1'], ({ values }) => [
    `ここでは ${values.ja}なので、条件ではこのループは終わらない。終わるのは \`break\`・\`return\`・\`exit\`、シグナルかエラーのときだけ`,
    `${values.en} here, so the condition never stops this loop: it ends only through \`break\`, \`return\`, \`exit\`, a signal or an error`]),
  'and-or-right-never-runs': entry<{ values: Words; op: string }>('note', ['3.2.4'], ({ values, op }) => [
    `ここでは ${values.ja}なので、\`${op}\` の左側は常に${op === '&&' ? '失敗' : '成功'}し、右側のコマンドは実行されない`,
    `${values.en} here, so the left side of \`${op}\` always ${op === '&&' ? 'fails' : 'succeeds'}: the command after it never runs`]),
  'case-runs-only': entry<{ values: Words; branches: Words; several: boolean }>('note', ['3.2.5.2'], ({ values, branches, several }) => [
    `ここでは ${values.ja}なので、この \`case\` で実行されるのは ${branches.ja} の分岐だけ`,
    `${values.en} here, so only ${branches.en} of this \`case\` ${several ? 'run' : 'runs'}`]),
  'case-runs-none': entry<{ values: Words }>('note', ['3.2.5.2'], ({ values }) => [
    `ここでは ${values.ja}なので、この \`case\` のどのパターンにも一致せず、どの分岐も実行されない`,
    `${values.en} here, so no pattern of this \`case\` matches: none of its branches runs`]),

  // ---------------------------------------------------------------- aliases (6.6)
  'alias-not-expanded-in-script': entry<{ name: string; value: string }>('pitfall', ['6.6', '4.3.2'], ({ name, value }) => [
    `bash はスクリプトの中ではエイリアスを展開しないので、\`${name}\` は「command not found」になります。\`shopt -s expand_aliases\` を \`alias\` より前に書くか、関数 \`${name}() { ${value} "$@"; }\` にします（\`.bashrc\` など対話シェルで読むファイルなら問題ありません）`,
    `bash does not expand aliases in scripts, so \`${name}\` is "command not found". Put \`shopt -s expand_aliases\` before the \`alias\`, or make it a function: \`${name}() { ${value} "$@"; }\` (fine in files read by interactive shells, such as \`.bashrc\`)`]),
  'alias-defined-same-unit': entry<{ name: string; line: number }>('note', ['6.6'], ({ name, line }) => [
    `\`${name}\` は行 ${line} で \`alias\` として定義されますが、bash は行（複合コマンドや関数の本体も）をまとめて読んでから実行するので、同じ行で定義したエイリアスはまだ使えません。ここでは alias ではないので、\`${name}\` というコマンドがなければ「command not found」になります（\`eval\` に渡した文字列は実行時に読み直されるので、エイリアスが使えます）`,
    `\`${name}\` is defined as an alias on line ${line}, but bash reads a whole line (and a whole compound command or function body) before running it, so an alias defined on the same line is not in effect yet. It is not an alias here: without a command named \`${name}\`, this is "command not found" (a string given to \`eval\` is read again when it runs, so it can use the alias)`]),
  'alias-defined-later': entry<{ name: string; line: number }>('note', ['6.6'], ({ name, line }) => [
    `\`${name}\` は行 ${line} で \`alias\` として定義されますが、これはその前に読まれ、エイリアスは実行された後に読まれるものにだけ効きます。ここでは alias ではないので、\`${name}\` というコマンドがなければ「command not found」になります（\`eval\` に渡した文字列は実行時に読み直されるので、エイリアスが使えます）`,
    `\`${name}\` is defined as an alias on line ${line}, but this is read before that, and an alias works only on what is read after it ran. It is not an alias here: without a command named \`${name}\`, this is "command not found" (a string given to \`eval\` is read again when it runs, so it can use the alias)`]),

  // ---------------------------------------------------------------- extended globs and globstar (3.5.8.1, 3.5.8, 4.3.2)
  'extglob-in-same-block': entry<{ use: string }>('pitfall', ['3.5.8.1', '4.3.2'], ({ use }) => [
    `bash は関数や \`if\`・\`{ }\` などのまとまりを最後まで読んでから実行します。そのため、同じまとまりの中の \`shopt -s extglob\` は \`${use}\` を読む時点ではまだ効いておらず、構文エラーになります。\`shopt -s extglob\` は、まとまりの外のそれより前の行に書きます`,
    `bash reads a whole function or block (\`if\`, \`{ }\`…) before running it, so a \`shopt -s extglob\` inside the same block is not yet on when it reads \`${use}\`: a syntax error. Put \`shopt -s extglob\` on an earlier line, outside the block`]),
  'extglob-maybe-on': entry<{ use: string }>('pitfall', ['3.5.8.1', '4.3.2'], ({ use }) => [
    `\`${use}\` のような拡張グロブは、\`shopt -s extglob\` のあとでないと構文エラーになります（\`[[ ]]\` の中では不要）。この前で有効にしているのは一部の経路（分岐やループ）だけなので、ほかの経路では構文エラーになります`,
    `extended globs like \`${use}\` are a syntax error unless \`shopt -s extglob\` comes first (not needed inside \`[[ ]]\`), and only some paths before here (a branch or a loop) turn it on`]),
  'extglob-turned-off': entry<{ use: string }>('pitfall', ['3.5.8.1', '4.3.2'], ({ use }) => [
    `\`${use}\` のような拡張グロブは \`shopt -s extglob\` のあとでないと構文エラーになりますが、\`shopt -u extglob\` で無効にされています`,
    `extended globs like \`${use}\` are a syntax error unless \`shopt -s extglob\` is on, and \`shopt -u extglob\` turned it off`]),
  'extglob-not-found': entry<{ use: string }>('pitfall', ['3.5.8.1', '4.3.2'], ({ use }) => [
    `\`${use}\` のような拡張グロブは、\`shopt -s extglob\` のあとでないと構文エラーになります（\`[[ ]]\` の中では不要）。この行より前に見当たりません。\`source\` したファイルなどで有効にしているなら問題ありません`,
    `extended globs like \`${use}\` are a syntax error unless \`shopt -s extglob\` comes first (not needed inside \`[[ ]]\`). It is not found before this line; fine if it is turned on elsewhere, as in a file read with \`source\``]),
  'extglob-maybe-on-trap': entry<{ use: string }>('pitfall', ['3.5.8.1', '4.3.2', '4.1'], ({ use }) => [
    `\`${use}\` のような拡張グロブは、\`shopt -s extglob\` のあとでないと構文エラーになります（\`[[ ]]\` の中では不要）。トラップの文字列はシグナルが来たときに読まれるので、\`extglob\` が有効になる前に来れば構文エラーになります`,
    `extended globs like \`${use}\` are a syntax error unless \`shopt -s extglob\` comes first (not needed inside \`[[ ]]\`), and a trap's action is read when its signal comes: if that is before \`extglob\` is on, it is a syntax error`]),
  'extglob-not-in-new-shell': entry<{ use: string }>('pitfall', ['3.5.8.1', '4.3.2', '3.7.3'], ({ use }) => [
    `\`${use}\` のような拡張グロブは、\`shopt -s extglob\` のあとでないと構文エラーになります（\`[[ ]]\` の中では不要）。新しいシェルは \`extglob\` が無効の状態で始まり、このスクリプトの \`shopt\` は引き継がれません。文字列の中で、グロブより前の行で \`shopt -s extglob\` するか、\`bash -O extglob -c\` で起動します`,
    `extended globs like \`${use}\` are a syntax error unless \`shopt -s extglob\` comes first (not needed inside \`[[ ]]\`). The new shell starts with \`extglob\` off: this script's \`shopt\` does not reach it. Turn it on in the string, on a line before the glob, or start the shell with \`bash -O extglob -c\``]),
  'globstar-maybe-on': entry<{ on: string }>('pitfall', ['3.5.8', '4.3.2'], ({ on }) => [
    `\`**\` がサブディレクトリまでたどるのは \`${on}\` のあとだけです。この前で有効にしているのは一部の経路（分岐やループ）だけなので、ほかの経路では \`*\` と同じく1階層分にしか一致しません`,
    `\`**\` reaches into subdirectories only after \`${on}\`, and only some paths before here (a branch or a loop) turn it on; on the others \`**\` is the same as \`*\` and matches one level only`]),
  'globstar-not-found': entry<{ on: string }>('pitfall', ['3.5.8', '4.3.2'], ({ on }) => [
    `\`**\` がサブディレクトリまでたどるのは \`${on}\` のあとだけです。この行より前に見当たらないので、このままでは \`*\` と同じく1階層分にしか一致しません。\`source\` したファイルなどで有効にしているなら問題ありません`,
    `\`**\` reaches into subdirectories only after \`${on}\`. It is not found before this line, so as it stands \`**\` is the same as \`*\` and matches one level only. Fine if it is turned on elsewhere, as in a file read with \`source\``]),
  'globstar-unsupported': entry<{ shell: string }>('pitfall', ['3.5.8'], ({ shell }) => [
    `${shell} には globstar がなく、\`**\` は \`*\` と同じく1階層分にしか一致しません。サブディレクトリまでたどるには \`find\` を使います`,
    `${shell} has no globstar, so \`**\` is the same as \`*\` and matches one level only. To reach into subdirectories, use \`find\``]),

  // ---------------------------------------------------------------- what a wrapper or a new shell does not get (3.7.3, 3.7.4, 3.3)
  'variable-not-in-remote-shell': entry<{ v: string }>('pitfall', ['3.7.3', '3.7.4'], ({ v }) => [
    `\`$${v}\` はリモートのシェルが展開しますが、リモートにはこのスクリプトの変数 \`${v}\` はありません。値を送るなら、こちらで展開されるようダブルクォートの中に書きます`,
    `the remote shell expands \`$${v}\`, but it does not have \`${v}\`, a variable of this script. To send its value, write it in double quotes, so that it is expanded here`]),
  'variable-not-passed-by-wrapper': entry<{ v: string; via: string }>('pitfall', ['3.7.3', '3.7.4'], ({ v, via }) => [
    `文字列の中の \`$${v}\` は新しいシェルが展開しますが、\`${via}\` はこのスクリプトの変数を（エクスポートしたものも）渡さないので、そこには \`${v}\` はありません。値を使うなら、こちらで展開されるようダブルクォートの中に書きます`,
    `the new shell expands \`$${v}\` in the string, but \`${via}\` passes none of this script's variables (not even exported ones), so \`${v}\` is not there. To use its value, write it in double quotes, so that it is expanded here`]),
  'variable-not-exported': entry<{ v: string }>('pitfall', ['3.7.3', '3.7.4'], ({ v }) => [
    `文字列の中の \`$${v}\` は新しいシェルが展開します。\`${v}\` はこのスクリプトの変数で、エクスポートされていないので、そこでは空です。先に \`export ${v}\` します`,
    `the new shell expands \`$${v}\` in the string, and \`${v}\` is a variable of this script that is not exported, so it is empty there. Run \`export ${v}\` first`]),
  'function-not-in-container': entry<{ via: string; name: string }>('pitfall', ['3.3', '3.7.3'], ({ via, name }) => [
    `\`${via}\` は \`${name}\` をコンテナの中で実行します。このスクリプトの関数はコンテナの中にはないので使えません。関数の中身を直接書きます`,
    `\`${via}\` runs \`${name}\` inside the container, and a function from this script is not available in the container. Write out its body instead`]),
  'builtin-or-function-as-program': entry<{ via: string; name: string; isFn: boolean; fix: Words }>('pitfall', ['3.7.3', '3.3'], ({ via, name, isFn, fix }) => [
    `\`${via}\` は \`${name}\` を別のプログラムとして起動するため、シェルの${isFn ? '関数' : '組み込みコマンド'}は実行できません（\`command not found\` になるか、今のシェルには効きません）。${fix.ja}`,
    `\`${via}\` starts \`${name}\` as a separate program, so it cannot run a shell ${isFn ? 'function' : 'builtin'} ("command not found", or no effect on the current shell). ${fix.en}`]),
  'ssh-local-expansion': entry<{ risky: string }>('pitfall', ['3.7.1', '3.7.3'], ({ risky }) => [
    `\`ssh\` に渡すコマンドのうち \`${risky}\` は、送られる前にこちらのシェルが展開します（\`$変数\`・\`$(…)\`・\`*\`・\`~\` はこちらの値になります）。リモートで展開したいときは全体をシングルクォートで囲みます: \`ssh host '…'\``,
    `the local shell expands \`${risky}\` in the command given to \`ssh\` before it is sent (\`$var\`, \`$(…)\`, \`*\` and \`~\` take local values). To expand them on the remote side, single-quote the whole command: \`ssh host '…'\``]),
  'function-not-on-remote': entry<{ name: string }>('pitfall', ['3.3', '3.7.3'], ({ name }) => [
    `リモートのシェルには、このスクリプトの関数 \`${name}\` はありません。中身を直接書くか、\`ssh host "$(declare -f ${name}); ${name}"\` のように定義ごと送ります`,
    `the remote shell does not have this script's function \`${name}\`. Write out its body, or send the definition too: \`ssh host "$(declare -f ${name}); ${name}"\``]),
  'function-not-in-new-shell-blocked': entry<{ via: string; fn: string; blocker: string }>('pitfall', ['3.3', '3.7.3'], ({ via, fn, blocker }) => [
    `\`${via}\` は新しいシェルでコマンドを実行するため、このスクリプトの関数 \`${fn}\` は使えません。\`${blocker}\` は環境の関数を渡さないので、\`export -f ${fn}\` も効きません。関数の中身を直接書きます`,
    `\`${via}\` runs the command in a new shell, which does not have this script's function \`${fn}\`, and \`${blocker}\` passes no exported functions, so \`export -f ${fn}\` does not help either. Write out its body`]),
  'function-not-in-new-shell': entry<{ via: string; fn: string }>('pitfall', ['3.3', '3.7.3'], ({ via, fn }) => [
    `\`${via}\` は新しいシェルでコマンドを実行するため、このスクリプトの関数 \`${fn}\` は使えません。関数の中身を直接書きます`,
    `\`${via}\` runs the command in a new shell, which does not have this script's function \`${fn}\`. Write out its body`]),
  'function-not-imported': entry<{ via: string; shell: string; fn: string }>('pitfall', ['3.3', '3.7.3'], ({ via, shell, fn }) => [
    `\`${via}\` はコマンドを ${shell} で実行します。${shell} は bash がエクスポートした関数を読まないので、\`export -f\` してもこのスクリプトの関数 \`${fn}\` は使えません。関数の中身を直接書くか、\`bash -c\` を使います`,
    `\`${via}\` runs the command in ${shell}, which does not read the functions bash exports, so this script's function \`${fn}\` is not there, even with \`export -f\`. Write out its body, or use \`bash -c\``]),
  'function-not-in-new-shell-export': entry<{ via: string; fn: string }>('pitfall', ['3.3', '3.7.3'], ({ via, fn }) => [
    `\`${via}\` は新しいシェルでコマンドを実行するため、このスクリプトの関数 \`${fn}\` は使えません。関数の中身を直接書くか、先に \`export -f ${fn}\` で関数を渡します（新しいシェルが bash のときだけ）`,
    `\`${via}\` runs the command in a new shell, which does not have this script's function \`${fn}\`. Write out its body, or pass the function with \`export -f ${fn}\` first (only when the new shell is bash)`]),
  'function-not-imported-sh': entry<{ via: string; fn: string }>('pitfall', ['3.3', '3.7.3'], ({ via, fn }) => [
    `\`${via}\` はコマンドを sh で実行します。Debian や Ubuntu の sh は dash で、dash は bash がエクスポートした関数を読まないので、このスクリプトの関数 \`${fn}\` は使えないことがあります。\`bash -c\` を使います`,
    `\`${via}\` runs the command in sh, which is dash on Debian and Ubuntu, and dash does not read the functions bash exports, so this script's function \`${fn}\` may not be there. Use \`bash -c\``]),
  'wrapper-assignment-expanded-first': entry<{ use: string; via: string; v: string }>('pitfall', ['3.7.1', '3.7.4'], ({ use, via, v }) => [
    `\`${use}\` は、\`${via}\` が \`${v}\` を設定する前に今のシェルが展開します（今の値で、なければ空）。設定した値を使うなら \`${via} ${v}=… sh -c '… "\$${v}"'\` のようにシェル経由にします`,
    `the current shell expands \`${use}\` before \`${via}\` sets \`${v}\` (to its present value, or nothing). To use the value it sets, go through a shell: \`${via} ${v}=… sh -c '… "\$${v}"'\``]),

  // ---------------------------------------------------------------- pipelines and globs (3.2.3, 3.7.3, 3.5.8)
  'pipeline-subshell-variable': entry<{ used: string; fix: Words; partial: boolean }>('pitfall', ['3.2.3', '3.7.3'], ({ used, fix, partial }) => [
    `パイプ（\`|\`）でつないだコマンドはサブシェルで実行されるので、右側で設定した \`${used}\` はパイプラインが終わると消え、あとの \`$${used}\` には届きません。${fix.ja}`
      + (partial ? '（この前で `shopt -s lastpipe` を有効にしているのは一部の経路だけです）' : ''),
    `the commands of a pipeline (\`|\`) run in subshells, so \`${used}\` set on the right side is gone when the pipeline ends; the later \`$${used}\` does not see it. ${fix.en}`
      + (partial ? ' (only some paths before here turn `shopt -s lastpipe` on)' : '')]),
  'unmatched-glob-runs-once': entry<{ glob: string; v: string; nullglob: boolean }>('pitfall', ['3.5.8'], ({ glob, v, nullglob }) => [
    `\`${glob}\` に一致するファイルが1つもないと、\`${v}\` に \`${glob}\` という文字列がそのまま入って1回実行されます。本体の先頭に \`[ -e "$${v}" ] || continue\` を${nullglob ? '書くか、ループの前で `shopt -s nullglob` にします' : '書きます'}`,
    `when no file matches \`${glob}\`, the loop runs once with \`${v}\` set to the text \`${glob}\` itself. Start the body with \`[ -e "$${v}" ] || continue\`${nullglob ? ', or turn on `shopt -s nullglob` before the loop' : ''}`]),

  // ---------------------------------------------------------------- words (3.7.1, 3.5.7, 3.4.2, 3.6; src/wordfacts.ts)
  'prefix-assignment-expanded-first': entry<{ v: string; name: string; use: string }>('pitfall', ['3.7.1', '3.7.4'], ({ v, name, use }) => [
    `\`${v}=…\` は \`${name}\` の環境にだけ入ります。\`${use}\` は、その前に今のシェルが展開します（今の値で、なければ空）。新しい値を使うなら \`${v}=… sh -c '… "\$${v}"'\` のようにシェル経由にします`,
    `\`${v}=…\` is set only in the environment of \`${name}\`; the current shell expands \`${use}\` before that (to its present value, or nothing). To use the new value, go through a shell: \`${v}=… sh -c '… "\$${v}"'\``]),
  'unquoted-variable-as-path': entry<{ bare: string }>('pitfall', ['3.5.7', '3.5.8'], ({ bare }) => [
    `\`${bare}\` をクォートしていないので、値に空白や \`*\` があると別々の引数に分かれたり、ファイル名に展開されたりします。\`"${bare}"\` と書きます`,
    `\`${bare}\` is not quoted, so a value with spaces or \`*\` is split into several arguments or expanded to file names. Write \`"${bare}"\``]),
  'for-over-ls-output': entry<{ cmd: string }>('pitfall', ['3.5.7'], ({ cmd }) => [
    `\`$(${cmd} …)\` の結果は空白や改行で区切られるので、空白を含むファイル名が壊れます。${cmd === 'ls' ? '`for f in *.txt` のようにグロブを使います' : '`find … -print0 | while IFS= read -r -d \'\' f` や `find -exec` を使います'}`,
    `the output of \`$(${cmd} …)\` is split on spaces and newlines, so file names with spaces break. ${cmd === 'ls' ? 'Use a glob, as in `for f in *.txt`' : "Use `find … -print0 | while IFS= read -r -d '' f` or `find -exec`"}`]),
  'for-over-unquoted-args': entry<{ value: string }>('pitfall', ['3.4.2', '3.5.7'], ({ value }) => [
    `\`${value}\` をクォートしないと、空白を含む引数が分かれてしまいます。\`for a in "$@"\`（または \`for a\` だけ）と書きます`,
    `unquoted \`${value}\` splits arguments that contain spaces. Write \`for a in "$@"\` (or just \`for a\`)`]),
  'unquoted-variable-in-test': entry<{ bare: string }>('pitfall', ['3.5.7'], ({ bare }) => [
    `\`[ ]\` の中の \`${bare}\` をクォートしないと、値が空や空白入りのときに条件式が壊れます（\`unary operator expected\` などのエラーや、誤った結果。空の \`[ -n $x ]\` は真になります）。\`"${bare}"\` と書きます`,
    `unquoted \`${bare}\` inside \`[ ]\` breaks the test when the value is empty or has spaces (an error such as "unary operator expected", or a wrong result: an empty \`[ -n $x ]\` is true). Write \`"${bare}"\``]),
  'redirect-by-your-shell': entry('pitfall', ['3.6', '3.7.3'], () => [
    'リダイレクト（`>`）は sudo ではなく今のシェルが、今のユーザーの権限で行います。root しか書けないファイルには `… | sudo tee ファイル` を使います',
    'the redirection (`>`) is done by your own shell with your rights, not by sudo. For a file only root can write, use `… | sudo tee file`']),

  // ---------------------------------------------------------------- bats test files (src/bats.ts; bash's side of what bats does)
  'bats-test': entry('note', ['3.3', '4.3.1'], () => [
    'bats はテストを1つずつ別のプロセスで、`set -e` を有効にして実行する。途中のコマンドが失敗するとそこでテストは失敗し（`set -e` が無視される所、つまり条件・`&&` や `||` の左側・`!` のあとを除く）、最後のコマンドが失敗しても失敗する。テストで設定した変数は、ほかのテストには届かない',
    'bats runs each test in a process of its own, with `set -e` on: a command that fails stops the test and fails it (except where `set -e` is ignored: in a condition, on the left of `&&` or `||`, after `!`), and so does a last command that fails. What a test sets does not reach the other tests']),
  'bats-negation-ignored': entry<{ cmd: string }>('pitfall', ['4.3.1', '3.2.3'], ({ cmd }) => [
    `\`set -e\` は \`!\` のあとのコマンドの結果を無視するので、\`! ${cmd}\` はテストの最後のコマンドでない限り、\`${cmd}\` が成功してもテストを失敗させません。\`run ! ${cmd}\`（bats 1.5.0 から。\`bats_require_minimum_version 1.5.0\` と書く）か \`! ${cmd} || false\` と書きます`,
    `\`set -e\` ignores the status of a command after \`!\`, so unless it is the last command of the test, \`! ${cmd}\` does not fail the test when \`${cmd}\` succeeds. Write \`run ! ${cmd}\` (since bats 1.5.0, with \`bats_require_minimum_version 1.5.0\`) or \`! ${cmd} || false\``]),
  'bats-run-in-pipeline': entry<{ cmd: string }>('pitfall', ['3.2.3'], ({ cmd }) => [
    `パイプは \`run\` の出力を受け取りますが、\`run\` は \`${cmd}\` の出力を \`$output\` に入れるだけで何も出力しません。また、パイプラインのコマンドはサブシェルで実行されるので、\`run\` が設定した \`$status\` と \`$output\` はパイプラインが終わると消えます。パイプライン全体を \`run\` で実行するには \`run bats_pipe ${cmd} \\| …\` か \`run bash -c '… | …'\` と書きます`,
    `the pipe gets the output of \`run\`, but \`run\` writes nothing: it keeps the output of \`${cmd}\` in \`$output\`. And the commands of a pipeline run in subshells, so the \`$status\` and \`$output\` that \`run\` sets are gone when the pipeline ends. To run the whole pipeline under \`run\`, write \`run bats_pipe ${cmd} \\| …\` or \`run bash -c '… | …'\``]),
} satisfies Record<string, Entry<never>>;

export type FactId = keyof typeof MESSAGES;
export type Params<K extends FactId> = Parameters<(typeof MESSAGES)[K]['text']>[0];

/** A fact as a note: its id, its text (with ℹ or ⚠), and the sections it cites. */
export interface Fact { id: FactId; kind: FactKind; text: string; refs: readonly string[] }

const PREFIX: Record<FactKind, Text> = {
  note: { ja: 'ℹ ', en: 'ℹ ' },
  pitfall: { ja: '⚠ 落とし穴: ', en: '⚠ Pitfall: ' },
};

/** The note of a fact, in `lang`. */
export function fact<K extends FactId>(lang: Lang, id: K, ...params: Params<K> extends Record<string, never> ? [] : [Params<K>]): Fact {
  const e = MESSAGES[id] as Entry<unknown>;
  const [ja, en] = e.text(params[0]);
  return { id, kind: e.kind, text: PREFIX[e.kind][lang] + (lang === 'ja' ? ja : en), refs: e.refs };
}

/** A fact before its language is chosen: its id and its params (language-free, or `Words`). */
export type FactSpec = { [K in FactId]: { id: K; params: Params<K> } }[FactId];

/** The note of a `FactSpec`, in `lang`. */
export function factOf(lang: Lang, spec: FactSpec): Fact {
  return (fact as (l: Lang, id: FactId, p: unknown) => Fact)(lang, spec.id, spec.params);
}

export type { Words };
