import type { Text } from './i18n';
import { tokenError, tokenText, tokenWarning } from './messages-levels';

// What the tokens of a shebang say.

export const SHEBANG_TEXTS = {
  /** `#!bash`: the kernel opens the interpreter as a path, from the current directory. */
  'shebang-relative-interpreter': tokenWarning<{ interp: string }>(({ interp }) => [
    `カーネルはインタープリタを PATH から探さず、カレントディレクトリからの相対パスとして \`${interp}\` を探すので、実行はたいてい失敗する（required file not found）`,
    `The kernel does not search PATH for the interpreter: it looks for \`${interp}\` from the current directory, so running the file mostly fails ("required file not found")`]),
  /** `#!/usr/bin/env -S"a`: the string `env -S` is given cannot be split. */
  'shebang-env-string-refused': tokenError({
    head: ['プログラムとして直接実行すると、env がこの文字列を分けられず、何も実行されない。', 'Run directly as a program, env cannot split this string, and nothing runs.'],
    then: ['プログラムとして直接実行すると、何も実行せずに終了ステータス 125 で終わる（`bash file` ではこの行はコメント）', 'Run directly as a program, it exits with status 125, running nothing (`bash file` ignores the line)'],
  }, () => ['env はこの文字列を分けられない', 'env cannot split this string']),
  /** `#!/usr/bin/env -i bash`: env reads the whole word as options. */
  'shebang-env-reads-options': tokenWarning<{ rest: string; last: string }>(({ rest, last }) => [
    `Linux ではインタープリタの後ろの \`${rest}\` 全体が env への1つの引数になり、env はそれを1つのオプションの並びとして読むので、\`${last}\` をコマンドとして実行しない（多くは不正なオプションとして終了ステータス 125 で終わる）。分けるには \`env -S\` と書く`,
    `On Linux the whole \`${rest}\` after the interpreter is one argument to env, which reads it as one run of options, so it does not run \`${last}\` (it mostly fails with an invalid option and status 125); write \`env -S\` to split it`]),
  /** `#!/usr/bin/env bash -e`: env looks for a program named with the whole rest. */
  'shebang-env-one-argument': tokenError<{ rest: string }>({
    head: ['Linux でプログラムとして直接実行すると、env は残り全体を1つのプログラム名として探して失敗する。', 'Run directly as a program on Linux, env looks for one program named with all the rest, and fails.'],
    then: ['プログラムとして直接実行すると、env はその名前のプログラムを探して失敗する（`bash file` ではこの行はコメント）。分けるには `env -S` と書く', 'Run directly as a program, env looks for a program of that name and fails (`bash file` ignores the line); write `env -S` to split it'],
  }, ({ rest }) => [`Linux ではインタープリタの後ろの \`${rest}\` 全体が env への1つの引数になる`, `On Linux the whole \`${rest}\` after the interpreter is one argument to env`]),
  /** env given no command (`#!/usr/bin/env`, or only an assignment): it runs the script's path, whose shebang runs env again. */
  'shebang-env-loop': tokenError<{ assignment?: string }>({
    head: ['プログラムとして直接実行すると、スクリプトが自分自身を終わりなく起動し直す。', 'Run directly as a program, the script starts itself again, without end.'],
    then: ['プログラムとして直接実行すると、スクリプトが自分自身を終わりなく起動し直す（`bash file` ではこの行はコメント）', 'Run directly as a program, the script starts itself again, without end (`bash file` ignores the line)'],
  }, ({ assignment }) => [
    `env はスクリプトのパスをコマンドとして実行する${assignment ? `（\`${assignment}\` は設定する変数として読む）` : ''}`,
    `env runs the script's path as the command${assignment ? ` (it takes \`${assignment}\` as a variable to set)` : ''}`]),
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
      `シバン（shebang）: プログラムとして実行すると（\`./script.sh\`）、ファイルは \`${shown} ./script.sh 引数…\` として実行される`
        + `${oneArg ? `（Linux では行の残りの \`${arg}\` 全体が1つの引数になる）` : ''}${relative}${env ? `。\`env\` は PATH から \`${arg}\` を探して実行する` : ''}${notes}${dialect.ja}`,
      `Shebang: run as a program (\`./script.sh\`), the file runs as \`${shown} ./script.sh args…\``
        + `${oneArg ? ` (on Linux the whole rest of the line, \`${arg}\`, is one argument)` : ''}${relative}${env ? `, and \`env\` finds \`${arg}\` on PATH and runs it` : ''}${notes}${dialect.en}`]),
  /**
   * The `#!` of a shebang, as bash reads it, which the panel shows at depth 2 (it says no more than how bash reads it, `Token.plain`): to
   * bash the start of a comment; to the kernel, the mark of a script.
   */
  'shebang-magic': tokenText(() => [
    'bash にとって `#` はコメントの始まりで、`bash script.sh`・`sh script.sh`・`source script.sh`・`. script.sh` ではこの行は無視される。'
      + 'ファイルをプログラムとして実行すると（`./script.sh`、または PATH から見つかるコマンドとして）、カーネル（それをしないシステムでは bash）が `#!` を読む',
    'To bash, `#` starts a comment: `bash script.sh`, `sh script.sh`, `source script.sh` and `. script.sh` ignore this line. '
      + 'When the file is run as a program (`./script.sh`, or a command found on PATH), the kernel reads `#!` (or bash, on a system whose kernel does not)']),
};
