import type { Text } from './i18n';
import { tokenText, tokenWarning } from './messages-levels';

// What the tokens of a shebang say.

export const SHEBANG_TEXTS = {
  /** `#!bash`: the kernel opens the interpreter as a path, from the current directory. */
  'shebang-relative-interpreter': tokenWarning<{ interp: string }>(({ interp }) => [
    `カーネルはインタープリタを PATH から探さず、カレントディレクトリからの相対パスとして \`${interp}\` を探すので、実行はたいてい失敗する（required file not found）`,
    `The kernel does not search PATH for the interpreter: it looks for \`${interp}\` from the current directory, so running the file mostly fails ("required file not found")`]),
  /** `#!/usr/bin/env -S"a`: the string `env -S` is given cannot be split. */
  'shebang-env-string-refused': tokenWarning(() => [
    'env はこの文字列を分けられず、何も実行せずに終了ステータス 125 で終わる',
    'env cannot split this string and exits with status 125, running nothing']),
  /** `#!/usr/bin/env -i bash`: env reads the whole word as options. */
  'shebang-env-reads-options': tokenWarning<{ rest: string; last: string }>(({ rest, last }) => [
    `Linux ではインタープリタの後ろの \`${rest}\` 全体が env への1つの引数になり、env はそれを1つのオプションの並びとして読むので、\`${last}\` をコマンドとして実行しない（多くは不正なオプションとして終了ステータス 125 で終わる）。分けるには \`env -S\` と書く`,
    `On Linux the whole \`${rest}\` after the interpreter is one argument to env, which reads it as one run of options, so it does not run \`${last}\` (it mostly fails with an invalid option and status 125); write \`env -S\` to split it`]),
  /** `#!/usr/bin/env bash -e`: env looks for a program named with the whole rest. */
  'shebang-env-one-argument': tokenWarning<{ rest: string }>(({ rest }) => [
    `Linux ではインタープリタの後ろの \`${rest}\` 全体が env への1つの引数になるので、env はその名前のプログラムを探して失敗する。分けるには \`env -S\` と書く`,
    `On Linux the whole \`${rest}\` after the interpreter is one argument to env, which looks for a program of that name and fails; write \`env -S\` to split it`]),
  /** env given no command (`#!/usr/bin/env`, or only an assignment): it runs the script's path, whose shebang runs env again. */
  'shebang-env-loop': tokenWarning<{ assignment?: string }>(({ assignment }) => [
    `env はスクリプトのパスをコマンドとして実行する${assignment ? `（\`${assignment}\` は設定する変数として読む）` : ''}ので、スクリプトが自分自身を終わりなく起動し直す`,
    `env runs the script's path as the command${assignment ? ` (it takes \`${assignment}\` as a variable to set)` : ''}, so the script starts itself again, without end`]),
  /** `#!`: no interpreter. */
  'shebang-no-interpreter': tokenText(() => [
    'シバン（shebang）だがインタープリタがない: ファイルをプログラムとして実行すると、カーネルはそれを実行できず、実行しようとしたシェル（bash など）が自分でシェルスクリプトとして読む。bash にとってこの行はコメント',
    'Shebang with no interpreter: run as a program, the kernel cannot start the file, and the shell that runs it reads it as a shell script itself. To bash this line is a comment']),
  /**
   * `#!/bin/bash -eu`: what the kernel runs (`shown`: the command line; `oneArg`: the rest of the line has blanks and is one argument;
   * `arg`: the rest; `relative`, `notes`: sentences of the warnings; `env`: `env` finds `arg` on PATH; `dialect`: the shell the script is explained as).
   */
  'shebang-line': tokenText<{ shown: string; oneArg: boolean; arg: string; relative: string; env: boolean; notes: string; dialect: Text }>(
    ({ shown, oneArg, arg, relative, env, notes, dialect }) => [
      `シバン（shebang）: ファイルをプログラムとして実行すると（\`./script.sh\`、または PATH から見つかるコマンドとして）、カーネル（それをしないシステムでは bash）が \`${shown} ./script.sh 引数…\` を実行する`
        + `${oneArg ? `（Linux では行の残りの \`${arg}\` 全体が1つの引数になる）` : ''}${relative}${env ? `。\`env\` は PATH から \`${arg}\` を探して実行する` : ''}${notes}`
        + `。bash にとってこの行はコメントで、\`bash script.sh\`・\`sh script.sh\`・\`source script.sh\`・\`. script.sh\` では無視される${dialect.ja}`,
      `Shebang: when the file is run as a program (\`./script.sh\`, or a command found on PATH), the kernel (or bash, on a system whose kernel does not) runs \`${shown} ./script.sh args…\``
        + `${oneArg ? ` (on Linux the whole rest of the line, \`${arg}\`, is one argument)` : ''}${relative}${env ? `, and \`env\` finds \`${arg}\` on PATH and runs it` : ''}${notes}`
        + `. To bash this line is a comment: \`bash script.sh\`, \`sh script.sh\`, \`source script.sh\` and \`. script.sh\` ignore it${dialect.en}`]),
};
