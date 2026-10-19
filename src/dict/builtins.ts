import { tx } from '../i18n';
import { CommandDoc, cmd, pos } from './types';

export const shellOptions = {
  errexit: tx('コマンドが失敗したら即座にスクリプトを終了（`-e` と同じ）', 'exit immediately when a command fails (same as `-e`)'),
  nounset: tx('未定義の変数を参照したらエラー（`-u` と同じ）', 'error on unset variables (same as `-u`)'),
  pipefail: tx('パイプライン中のどれかが失敗したら、パイプライン全体を失敗扱いにする', 'a pipeline fails if any command in it fails'),
  xtrace: tx('実行するコマンドを表示する（`-x` と同じ）', 'print commands as they run (same as `-x`)'),
  noclobber: tx('`>` で既存ファイルを上書きしない（`-C` と同じ）', 'do not overwrite files with `>` (same as `-C`)'),
  noglob: tx('グロブ（ワイルドカード展開）を無効化（`-f` と同じ）', 'disable globbing (same as `-f`)'),
  vi: tx('行編集を vi モードにする', 'use vi-style line editing'),
  emacs: tx('行編集を emacs モードにする', 'use emacs-style line editing'),
  posix: tx('POSIX 互換モードにする', 'POSIX compatibility mode'),
};

/** Options of bash's `shopt`. */
export const shoptOptions = {
  globstar: tx('`**` が任意の深さのディレクトリに一致する（`**/*.sh` でサブディレクトリの中まで）', '`**` matches directories at any depth (`**/*.sh` reaches into subdirectories)'),
  nullglob: tx('何にも一致しないグロブを、そのままの文字列ではなく空にする', 'a glob that matches nothing expands to nothing instead of itself'),
  failglob: tx('何にも一致しないグロブをエラーにする', 'a glob that matches nothing is an error'),
  dotglob: tx('`*` などが `.` で始まる名前にも一致する', '`*` and the like also match names starting with `.`'),
  extglob: tx('拡張グロブ `@(…)`、`!(…)`、`+(…)` などを使えるようにする', 'enable extended globs such as `@(…)`, `!(…)` and `+(…)`'),
  nocaseglob: tx('グロブで大文字と小文字を区別しない', 'globs ignore case'),
  nocasematch: tx('`[[ == ]]` や `case` のパターンで大文字と小文字を区別しない', '`[[ == ]]` and `case` patterns ignore case'),
  inherit_errexit: tx('`$(…)` の中でも `set -e` を効かせる', 'keep `set -e` inside `$(…)`'),
  lastpipe: tx('パイプラインの最後のコマンドを今のシェルで実行する（`… | read x` の `x` が残る）', 'run the last command of a pipeline in the current shell (so `… | read x` keeps `x`)'),
  expand_aliases: tx('スクリプトの中でもエイリアスを展開する', 'expand aliases in scripts too'),
};

const b = (ja: string, en: string, opts: Parameters<typeof cmd>[2] = [], extra: Parameters<typeof cmd>[3] = {}): CommandDoc =>
  cmd(ja, en, opts, { builtin: true, ...extra });

export const builtins: Record<string, CommandDoc> = {
  echo: b('引数を空白区切りで標準出力に表示する', 'Print arguments to stdout, separated by spaces', [
    ['-n', '末尾の改行を出力しない', 'do not print the trailing newline'],
    ['-e', '`\\n` などのバックスラッシュエスケープを解釈する', 'interpret backslash escapes like `\\n`'],
    ['-E', 'バックスラッシュエスケープを解釈しない（既定）', 'do not interpret escapes (default)'],
  ], { positional: [pos('表示する文字列', 'text to print')] }),
  printf: b('書式を指定して文字列を出力する（`%s` 文字列, `%d` 整数, `\\n` 改行 など）', 'Print formatted output (`%s` string, `%d` integer, `\\n` newline…)', [
    ['-v', '出力せず、結果を指定した変数に代入する', 'assign the output to a variable instead of printing', 'arg'],
  ], { positional: [pos('書式文字列', 'format string'), pos('書式に埋め込む値', 'value for the format')], positionalLang: ['printf'] }),
  read: b('標準入力から1行読み、変数に代入する', 'Read a line from stdin into variables', [
    ['-r', 'バックスラッシュをエスケープ文字として扱わない（ほぼ常に付けるべき）', 'do not treat backslashes as escapes (almost always wanted)'],
    ['-p', '入力前にプロンプトを表示する', 'show a prompt first', 'arg'],
    ['-s', '入力を画面に表示しない（パスワード入力用）', 'silent mode (for passwords)'],
    ['-a', '単語に分割して配列に代入する', 'read words into an array', 'arg'],
    ['-n', '指定した文字数だけ読む', 'read only this many characters', 'arg'],
    ['-t', 'タイムアウト秒数', 'timeout in seconds', 'arg'],
    ['-d', '改行の代わりにこの文字まで読む', 'read up to this delimiter instead of newline', 'arg'],
    ['-u', '指定したファイルディスクリプタから読む', 'read from this file descriptor', 'arg'],
  ], { positional: [pos('読み込んだ値を入れる変数名', 'variable to store the input')] }),
  cd: b('カレントディレクトリを移動する', 'Change the current directory', [
    ['-P', 'シンボリックリンクを解決した物理パスに移動', 'use the physical path (resolve symlinks)'],
    ['-L', 'シンボリックリンクをたどる（既定）', 'follow symlinks (default)'],
  ], { positional: [pos('移動先のディレクトリ（`-` は直前のディレクトリ、省略時は $HOME）', 'target directory (`-` = previous, default $HOME)')] }),
  pwd: b('カレントディレクトリのパスを表示する', 'Print the current directory', [
    ['-P', 'シンボリックリンクを解決した物理パスを表示', 'print the physical path'],
  ]),
  exit: b('シェル（スクリプト）を終了する', 'Exit the shell or script', [], { positional: [pos('終了ステータス（0 が成功、省略時は直前のコマンドのステータス）', 'exit status (0 = success; default: status of last command)')] }),
  return: b('関数から戻る', 'Return from a function', [], { positional: [pos('戻り値となる終了ステータス', 'exit status to return')] }),
  set: b('シェルオプションや位置パラメータを設定する', 'Set shell options or positional parameters', [
    ['-e', 'コマンドが失敗したら即座にスクリプトを終了する', 'exit immediately if a command fails'],
    ['-u', '未定義の変数を参照したらエラーにする', 'treat unset variables as an error'],
    ['-x', '実行するコマンドを展開後の形で表示する（デバッグ用）', 'print each command after expansion (debugging)'],
    ['-v', '読み込んだ行をそのまま表示する', 'print input lines as they are read'],
    ['-o', '名前でオプションを有効にする', 'enable an option by name', 'arg', shellOptions],
    ['-f', 'グロブ（ワイルドカード展開）を無効にする', 'disable globbing'],
    ['-C', '`>` で既存ファイルを上書きしない', 'do not overwrite files with `>`'],
    ['-n', 'コマンドを読むだけで実行しない（構文チェック）', 'read commands but do not execute (syntax check)'],
    ['-a', '以降に設定した変数を自動でエクスポートする', 'export all subsequently set variables'],
    ['-E', '`trap … ERR` を関数やサブシェルの中でも効かせる（`set -Eeuo pipefail` の定番）', 'make `trap … ERR` work inside functions and subshells too (as in `set -Eeuo pipefail`)'],
    ['-T', '`trap … DEBUG` と `RETURN` を関数の中でも効かせる', 'make `trap … DEBUG` and `RETURN` work inside functions too'],
    ['--', '以降の引数を位置パラメータ $1, $2... に設定する', 'set the remaining arguments as $1, $2…'],
  ]),
  shopt: b('bash 固有のシェルオプションを設定・表示する', 'Set or show bash-specific shell options', [
    ['-s', 'オプションを有効にする', 'enable the options'],
    ['-u', 'オプションを無効にする', 'disable the options'],
    ['-q', '何も表示せず、終了ステータスで状態を返す', 'quiet; report via exit status'],
  ], { positional: [pos('オプション名（例: nullglob, globstar, extglob）', 'option name (e.g. nullglob, globstar, extglob)')] }),
  print: b('引数を表示する（ksh・mksh・zsh の組み込み。bash にはない。`echo` と違いオプションの扱いが決まっている）', 'Print the arguments (a ksh, mksh and zsh builtin, not in bash; unlike `echo` its options are well defined)', [
    ['-n', '最後に改行を出さない', 'do not print a trailing newline'],
    ['-r', '`\\` によるエスケープを解釈しない', 'do not interpret `\\` escapes'],
    ['-R', '`-r` に加えて、以降の `-` で始まる引数もオプションとして扱わない', 'like `-r`, and treat later `-` arguments as text'],
    ['-u', '指定したファイル記述子に書き出す（`-u2` で標準エラー出力）', 'write to the given file descriptor (`-u2` for stderr)', 'arg'],
    ['-f', 'printf と同じ書式で表示する（ksh93）', 'format like printf (ksh93)', 'arg'],
    ['-s', 'コマンド履歴に追加する', 'append to the command history'],
    ['-l', '引数を1行ずつ表示する（zsh）', 'print each argument on its own line (zsh)'],
  ]),
  whence: b('コマンド名がどう解釈されるか（パスやエイリアスなど）を表示する（ksh・mksh・zsh の組み込み。bash の `type`・`command -v` に相当）', 'Show how a command name is interpreted (a ksh, mksh and zsh builtin; like bash\'s `type` / `command -v`)', [
    ['-v', '種類（組み込み・関数・エイリアスなど）も表示する', 'say what kind of command it is'],
    ['-p', '関数やエイリアスを無視して PATH から探す', 'search PATH only, ignoring functions and aliases'],
    ['-a', '見つかったものをすべて表示する', 'show every match'],
  ], { positional: [pos('調べるコマンド名', 'command name to look up')] }),
  trap: b('シグナルや終了時に実行するコマンドを登録する', 'Run a command when a signal or event occurs', [
    ['-l', 'シグナル名の一覧を表示', 'list signal names'],
    ['-p', '登録済みの trap を表示', 'show registered traps'],
  ], { positional: [pos('実行するコマンド（`-` でリセット、空文字で無視）', 'command to run (`-` resets, empty string ignores)'), pos('対象のシグナル（EXIT, ERR, INT, TERM など）', 'signal (EXIT, ERR, INT, TERM…)')] }),
  source: b('ファイルを読み込み、現在のシェルで実行する（変数や関数が現在のシェルに残る）', 'Run a file in the current shell (its variables and functions persist)', [], { positional: [pos('読み込むファイル', 'file to source'), pos('そのファイルに渡す引数', 'arguments passed to it')] }),
  '.': b('ファイルを読み込み、現在のシェルで実行する（`source` と同じ）', 'Run a file in the current shell (same as `source`)', [], { positional: [pos('読み込むファイル', 'file to source')] }),
  eval: b('引数を連結して文字列をコマンドとして再解釈・実行する（注入に注意）', 'Concatenate arguments and execute the result as a command (beware of injection)'),
  exec: b('現在のシェルを指定したコマンドで置き換える。引数なしならリダイレクトをシェル自体に適用', 'Replace the shell with the command; without a command, apply redirections to the shell itself', [], { wraps: true }),
  shift: b('位置パラメータを左にずらす（$2 が $1 になる）', 'Shift positional parameters left ($2 becomes $1)', [], { positional: [pos('ずらす数（省略時は 1）', 'how many (default 1)')] }),
  getopts: b('スクリプトのオプション引数を1つずつ解析する（`while getopts … ; do case … esac; done` の形で使い、次に読む位置は $OPTIND）', 'Parse script options one at a time (used as `while getopts …; do case … esac; done`; $OPTIND tracks the position)', [], { positional: [pos('受け付けるオプション文字（`:` 付きは引数を取る）', 'option letters (`:` means takes an argument)'), pos('見つけたオプションの文字を入れる変数名', 'variable that receives the option letter')], positionalLang: ['getopts'] }),
  wait: b('バックグラウンドジョブの終了を待つ', 'Wait for background jobs to finish', [
    ['-n', 'どれか1つの終了を待つ', 'wait for any single job'],
  ], { positional: [pos('待つプロセスID（省略時は全て）', 'PID to wait for (default: all)')] }),
  kill: b('プロセスにシグナルを送る（既定は TERM で終了要求）', 'Send a signal to a process (default TERM)', [
    ['-9|-KILL', '強制終了（KILL シグナル）', 'force kill (SIGKILL)'],
    ['-s', '送るシグナル名', 'signal name to send', 'arg'],
    ['-l', 'シグナル一覧を表示', 'list signals'],
    ['-0', 'プロセスが存在するか確認するだけ', 'only check whether the process exists'],
  ], { positional: [pos('対象のプロセスID', 'target PID')] }),
  test: b('条件式を評価し、真なら 0、偽なら 1 を返す（`[ ]` と同じ）', 'Evaluate a conditional expression; exit 0 if true (same as `[ ]`)', [
    ['-z', '文字列が空なら真', 'true if the string is empty'], ['-n', '文字列が空でなければ真', 'true if the string is not empty'],
    ['-e', 'ファイルが存在すれば真', 'true if the file exists'], ['-f', '通常のファイルなら真', 'true if it is a regular file'],
    ['-d', 'ディレクトリなら真', 'true if it is a directory'], ['-s', 'ファイルが空でなければ真', 'true if the file is not empty'],
    ['-r', '読めるなら真', 'true if readable'], ['-w', '書けるなら真', 'true if writable'], ['-x', '実行できるなら真', 'true if executable'],
    ['-L|-h', 'シンボリックリンクなら真', 'true if it is a symbolic link'],
    ['-eq', '数値として等しい', 'numerically equal'], ['-ne', '数値として等しくない', 'numerically not equal'],
    ['-lt', 'より小さい', 'less than'], ['-le', '以下', 'less than or equal'], ['-gt', 'より大きい', 'greater than'], ['-ge', '以上', 'greater than or equal'],
  ], { longSingleDash: true }),
  compgen: b('補完の候補を生成して表示する（補完関数の中で使う）', 'Generate completion candidates (used in completion functions)', [
    ['-G', 'このグロブに合うファイル名（`compgen -G パターン` は一致があるかの判定によく使う）', 'file names matching this glob (`compgen -G pattern` is a common way to test for a match)', 'arg'],
    ['-W', 'この単語の一覧から候補を作る', 'candidates from this word list', 'arg'], ['-A', '候補の種類（`file`、`command`、`variable`…）', 'kind of candidates (`file`, `command`, `variable`…)', 'arg'],
    ['-f', 'ファイル名', 'file names'], ['-d', 'ディレクトリ名', 'directory names'], ['-c', 'コマンド名', 'command names'], ['-v', '変数名', 'variable names'],
    ['-o', '補完の動作オプション', 'completion option', 'arg'],
  ], { positional: [pos('補完中の単語（これで始まる候補だけ）', 'word being completed (only candidates starting with it)')] }),
  complete: b('コマンドの引数の補完方法を登録する', "Register how a command's arguments are completed", [
    ['-F', 'この関数で候補を作る', 'use this function to generate candidates', 'arg'], ['-W', 'この単語の一覧から候補を作る', 'candidates from this word list', 'arg'],
    ['-C', 'このコマンドの出力を候補にする', "use this command's output as candidates", 'arg'], ['-o', '補完の動作オプション（`nospace`、`default`…）', 'completion option (`nospace`, `default`…)', 'arg'],
    ['-r', '登録を削除する', 'remove the registration'], ['-p', '登録を表示する', 'print the registrations'],
  ], { positional: [pos('対象のコマンド名', 'command name')] }),
  compopt: b('補完中に補完の動作オプションを変える', 'Change completion options while completing', [
    ['-o', 'オプションを有効にする（`nospace`、`nosort`…）', 'enable an option (`nospace`, `nosort`…)', 'arg'], ['+o', 'オプションを無効にする', 'disable an option', 'arg'],
  ]),
  setopt: b('zsh のオプションを有効にする', 'Turn zsh options on', [], { positional: [pos('オプション名（`local_options`、`extended_glob`…）', 'option name (`local_options`, `extended_glob`…)')] }),
  unsetopt: b('zsh のオプションを無効にする', 'Turn zsh options off', [], { positional: [pos('オプション名', 'option name')] }),
  true: b('何もせず成功（終了ステータス 0）を返す', 'Do nothing and succeed (exit 0)'),
  false: b('何もせず失敗（終了ステータス 1）を返す', 'Do nothing and fail (exit 1)'),
  ':': b('何もしないコマンド（常に成功）。無限ループ `while :` や引数の展開だけしたい時に使う', 'No-op that always succeeds; used in `while :` or to evaluate expansions'),
  alias: b('コマンドの別名を定義する', 'Define a command alias'),
  unalias: b('別名を削除する', 'Remove an alias'),
  type: b('コマンドの種類（ビルトイン・関数・外部コマンドなど）を表示する', 'Show how a name would be interpreted (builtin, function, file…)', [
    ['-t', '種類だけを1語で表示', 'print only the kind'],
    ['-a', '該当する全ての候補を表示', 'show all matches'],
    ['-P', '外部コマンドのパスを表示', 'print the path of the executable'],
  ]),
  command: b('関数や別名を無視してコマンドを実行する。`-v` で存在確認によく使う', 'Run a command ignoring functions/aliases; `-v` is often used to check existence', [
    ['-v', 'コマンドのパスまたは名前を表示（存在確認に使う）', 'print the command path or name (existence check)'],
    ['-V', 'コマンドの詳しい説明を表示', 'print a verbose description'],
    ['-p', '標準の PATH で検索する', 'use a default PATH'],
  ], { wraps: true }),
  builtin: b('同名の関数があってもシェルのビルトインを実行する', 'Run the shell builtin even if a function has the same name', [], { wraps: true }),
  hash: b('コマンドのパスのキャッシュを操作する', 'Manage the command path cache'),
  jobs: b('現在のジョブ一覧を表示する', 'List current jobs'),
  fg: b('ジョブをフォアグラウンドに戻す', 'Bring a job to the foreground'),
  bg: b('停止中のジョブをバックグラウンドで再開する', 'Resume a stopped job in the background'),
  disown: b('ジョブをシェルの管理から外す（シェル終了時に終了させない）', 'Remove jobs from the job table (they survive shell exit)'),
  umask: b('新規ファイルのパーミッションマスク（作成時に外す権限）を設定・表示する', 'Set or show the file creation mask (permissions removed from new files)', [
    ['-S', '記号形式（u=rwx,g=rx,o=rx など）で表示する', 'show in symbolic form (u=rwx,g=rx,…)'],
    ['-p', '再入力できる形で表示する', 'output in a reusable form'],
  ], { positional: [pos('マスク値（例: `022`）', 'mask (e.g. `022`)')], positionalLang: ['umask'] }),
  ulimit: b('プロセスのリソース上限を設定・表示する', 'Set or show resource limits', [
    ['-n', 'オープンできるファイル数', 'max open files'],
    ['-c', 'コアダンプのサイズ', 'core dump size'],
    ['-a', '全ての上限を表示', 'show all limits'],
  ]),
  mapfile: b('標準入力の各行を配列に読み込む', 'Read lines from stdin into an array', [
    ['-t', '各行末の改行を取り除く', 'strip trailing newlines'],
    ['-n', '読む行数の上限', 'max lines to read', 'arg'],
    ['-d', '行区切り文字', 'line delimiter', 'arg'],
  ], { positional: [pos('格納する配列名（省略時は MAPFILE）', 'array name (default MAPFILE)')] }),
  readarray: b('標準入力の各行を配列に読み込む（mapfile と同じ）', 'Read lines from stdin into an array (same as mapfile)', [
    ['-t', '各行末の改行を取り除く', 'strip trailing newlines'],
  ], { positional: [pos('格納する配列名', 'array name')] }),
  let: b('算術式を評価する（例: `let i++`）', 'Evaluate arithmetic expressions (e.g. `let i++`)', [], {
    positional: [pos('算術式（引数ごとに1つ。左から順に評価され、前の結果が後ろの式から見える）',
      'arithmetic expression (one per argument, evaluated left to right, so later ones see earlier results)')],
  }),
  pushd: b('ディレクトリスタックに積んで移動する', 'Push a directory onto the stack and cd to it'),
  popd: b('ディレクトリスタックから取り出してそこへ戻る', 'Pop the directory stack and cd to it'),
  dirs: b('ディレクトリスタックを表示する', 'Show the directory stack'),
  break: b('ループを抜ける', 'Exit from a loop', [], { positional: [pos('抜けるループの段数', 'number of loop levels')] }),
  continue: b('ループの次の繰り返しに進む', 'Skip to the next loop iteration', [], { positional: [pos('対象のループの段数', 'number of loop levels')] }),
  unset: b('変数や関数を削除する', 'Unset variables or functions', [
    ['-v', '変数を削除', 'unset variables'],
    ['-f', '関数を削除', 'unset functions'],
  ], { positional: [pos('削除する名前', 'name to unset')] }),
  enable: b('ビルトインを有効・無効にする', 'Enable or disable builtins'),
  help: b('ビルトインのヘルプを表示する', 'Show help for builtins'),
  history: b('コマンド履歴を表示・操作する', 'Show or manipulate command history'),
  times: b('シェルと子プロセスの累積CPU時間を表示する', 'Print accumulated CPU times'),
  caller: b('呼び出し元の行番号・関数名を表示する（デバッグ用）', 'Print the caller context (debugging)'),
};
