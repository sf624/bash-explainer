// The shells as commands: bash (Bash manual 6.1, and `bash --help`), bash as `rbash` (6.10), and the POSIX `sh`.
// (Other shells take the options of `sh`: src/dict/aliases.ts.)
import type { CommandSpec, OperandAlt, OperandSpec } from '../argv/spec';
import { tx } from '../i18n';
import { builtins, shellOptions, shoptOptions } from './builtins';
import { cmd, operand, type OptSpec, wordTable } from './types';

/** The words a shell takes as its positional parameters. */
const shellArgs = (ja: string, en: string): OperandSpec => operand('ARG', ja, en, { repeat: '*' });
/**
 * The operands of a shell: `bash -c 'cmd' NAME ARG…` (the string runs in a new shell; `NAME` is its `$0`),
 * `bash -s ARG…`, and `bash SCRIPT ARG…` (`$N`: the number of the positional parameter).
 */
const SHELL_OPERANDS: OperandAlt[] = [
  {
    when: { option: ['-c'] },
    pattern: [
      operand('COMMAND_STRING', 'コマンド文字列: 実行するコマンド', 'The command string: the commands to run', { command: { run: 'shell-string', env: 'exported', params: true } }),
      operand('NAME', '`$0` になる名前（スクリプト名の代わり。エラーメッセージにも出る）。引数ではない', 'Becomes `$0`, the name in place of a script name (shown in error messages); not an argument', { repeat: '?' }),
      shellArgs('コマンド文字列の位置パラメータ `$N`', 'Positional parameter `$N` of the command string'),
    ],
  },
  { when: { option: ['-s'] }, pattern: [shellArgs('スクリプトへの引数（`$N`）', 'Argument to the script (`$N`)')], stdin: 'script' },
  { pattern: [operand('SCRIPT', '実行するスクリプト', 'Script to run', { repeat: '?', type: 'file', io: 'run' }), shellArgs('スクリプトへの引数（`$N`）', 'Argument to the script (`$N`)')], stdin: 'script' },
];

/** A shell's `-c` (bash, and POSIX `sh`): the string is the first operand, wherever the options after `-c` end (`bash -c -e 'cmd'`). */
const SHELL_C: OptSpec = ['-c', 'コマンドを、ファイルや標準入力からではなく、オプションの後の最初の引数（コマンド文字列）から読んで実行する。その後の引数は `$0`、`$1`… になる',
  'read the commands from the first argument after the options (the command string), not from a file or stdin; the arguments after it become `$0`, `$1`…'];

/**
 * bash when it starts (Bash manual 6.1, and `bash --help`): every letter of `set`, with the same meaning (one
 * source: the `set` spec), and the options bash takes only then. Long options come first (the `bash` parser).
 */
const BASH: CommandSpec = cmd('bash シェルを起動する（スクリプトやコマンド文字列を実行）', 'Run the bash shell (a script or a command string)', [
  SHELL_C,
  ['-i', '対話シェルとして起動する（起動時に `~/.bashrc` を読み、エイリアスを展開する。`$-` に `i` が入る）', 'act as an interactive shell (it reads `~/.bashrc` at start and expands aliases; `$-` contains `i`)'],
  ['-l|--login', 'ログインシェルとして起動する（起動時に `/etc/profile` と、`~/.bash_profile`・`~/.bash_login`・`~/.profile` のうち最初にあるものを読む。対話シェルでなくても読む）',
    'act as a login shell (at start it reads `/etc/profile`, then the first of `~/.bash_profile`, `~/.bash_login` and `~/.profile` that exists, even when not interactive)'],
  ['-r|--restricted', '制限付きシェルとして起動する。`cd`、`/` を含むコマンド名、出力のリダイレクト（`>`・`>>` など）、`exec` でのコマンドの実行、`/` を含むファイルの `.`、`PATH`・`SHELL`・`ENV`・`BASH_ENV`・`HISTFILE` の変更などを拒否する（それぞれ失敗する）',
    'start a restricted shell: it refuses `cd`, command names with a `/`, output redirections (`>`, `>>`…), running a command with `exec`, `.` of a file named with a `/`, changing `PATH`, `SHELL`, `ENV`, `BASH_ENV` or `HISTFILE`, and more (each fails)'],
  ['-s', 'コマンドを標準入力から読む（オペランドが残っていなければ `-s` がなくてもそうする）。オペランドは `$1`… になる', 'read the commands from stdin (also the default when no operand is left); the operands become `$1`…'],
  ['-D|--dump-strings', '`$"…"` の翻訳する文字列を一覧表示する。コマンドは何も実行しない（`-n` を含む）', 'list the `$"…"` strings to translate, and run no command (it implies `-n`)'],
  {
    names: ['-O'], text: tx('名前で `shopt` のオプションを有効にする', 'turn a `shopt` option on by name'), offText: tx('名前で `shopt` のオプションを無効にする', 'turn a `shopt` option off by name'),
    value: { name: 'VALUE', how: 'next-only', values: shoptOptions },
    noValue: {
      text: tx('`-O` だけ（名前なし）: `shopt` のオプションとその値を一覧表示する', '`-O` alone (no name): list the `shopt` options and their values'),
      offText: tx('`+O` だけ（名前なし）: `shopt` のオプションの設定を、そのまま再入力できる形（`shopt -u autocd` など）で表示する', '`+O` alone (no name): print the `shopt` settings as commands that make them (`shopt -u autocd`…)'),
    },
  },
  ...builtins.set.options!.filter((o) => o.names.every((n) => /^-[a-zA-Z]$/.test(n))),
  ['--debug', 'bash 自身のデバッグ用（マニュアルにない。リリース版の bash 5.2・5.3 では見える変化はない）', "bash's own debugging (not in the manual; in bash 5.2 and 5.3 as released, nothing visible changes)"],
  ['--debugger', '起動の前にデバッガ（bashdb）を読み込み、`extdebug` を有効にする（bashdb がなければ警告を表示し、どちらもしない）', 'load the debugger (bashdb) before starting, and turn on `extdebug` (without bashdb installed, it warns and does neither)'],
  ['--dump-po-strings', '`-D` と同じだが、GNU gettext の PO 形式で出力する', 'as `-D`, in the PO format of GNU gettext'],
  ['--help', '使い方を表示して終了する（終了ステータス 0）。ほかは何も実行しない', 'print the usage and exit with status 0; nothing else runs'],
  ['--init-file|--rcfile', '対話シェルで、起動時に `~/.bashrc` の代わりに読むファイル', 'in an interactive shell, the file to read at start instead of `~/.bashrc`', 'arg'],
  ['--noediting', '対話シェルで、コマンド行の編集に Readline を使わない', 'in an interactive shell, do not use Readline to edit command lines'],
  ['--noprofile', 'ログインシェルで、`/etc/profile`・`~/.bash_profile`・`~/.bash_login`・`~/.profile` を読まない', 'in a login shell, do not read `/etc/profile`, `~/.bash_profile`, `~/.bash_login` or `~/.profile`'],
  ['--norc', '対話シェルで、`~/.bashrc` を読まない', 'in an interactive shell, do not read `~/.bashrc`'],
  ['--posix', 'POSIX モードで起動する（`set -o posix` と同じ）', 'start in POSIX mode (as `set -o posix`)'],
  ['--pretty-print', 'スクリプトを整形して表示する。実行はしない', 'print the script reformatted, and run nothing'],
  ['--verbose', '読み込んだ行をそのまま表示する（`-v` と同じ）', 'print input lines as they are read (same as `-v`)'],
  ['--version', 'バージョンを表示して終了する（終了ステータス 0）。ほかは何も実行しない', 'print the version and exit with status 0; nothing else runs'],
], {
  parser: 'bash', plusOptions: true,
  operands: SHELL_OPERANDS,
  unknownOption: tx('bash にないオプション: bash は `invalid option` と使い方を表示し、何も実行せずに終了する（終了ステータス 2。前に `-e` があれば 1）',
    'An option bash does not have: bash says `invalid option`, prints its usage, and exits, running nothing (status 2; 1 after `-e`)'),
});

export const shells: Record<string, CommandSpec> = wordTable({
  bash: BASH,
  rbash: { ...BASH, summary: tx('制限付きシェル（`rbash` の名前で起動した bash。`bash -r` と同じ）を起動する', 'Run the restricted shell (bash started with the name `rbash`: as `bash -r`)') },
  sh: cmd('POSIX シェルを起動する', 'Run the POSIX shell', [
    SHELL_C,
    ['-s', 'コマンドを標準入力から読む（スクリプトの引数は `$1`… になる）', 'read commands from stdin (the arguments become `$1`…)'],
    ['-i', '対話シェルとして起動', 'act as an interactive shell'],
    ['-l', 'ログインシェルとして起動', 'act as a login shell'],
    ['-e', 'エラーで即終了', 'exit on error'],
    ['-u', '未定義の変数を参照したらエラーにする', 'treat unset variables as an error'],
    ['-x', '実行するコマンドを表示', 'trace commands'],
    ['-n', '構文チェックのみ', 'syntax check only'],
    ['-v', '読み込んだ行をそのまま表示する', 'print input lines as they are read'],
    ['-a', '代入した変数を自動でエクスポートする', 'export every variable that is set'],
    ['-C', '`>` で既存ファイルを上書きしない', 'do not overwrite files with `>`'],
    ['-f', 'グロブ（ワイルドカード展開）を無効にする', 'disable globbing'],
    ['-b', 'バックグラウンドジョブの終了をすぐに知らせる', 'report the end of background jobs at once'],
    ['-m', 'ジョブ制御を有効にする', 'turn on job control'],
    ['-p', '実効ユーザー ID が実ユーザー ID と違っても、実効 ID を戻さない（setuid の権限を捨てない）', 'keep the effective user ID when it differs from the real one (do not drop setuid privileges)'],
    ['-o', '名前でオプションを有効にする（`set -o` と同じ）', 'enable an option by name (as `set -o`)', 'arg', shellOptions],
  ], {
    optionsFirst: true, plusOptions: true,
    operands: SHELL_OPERANDS,
  }),
});
