import { CommandDoc, cmd, pos } from './types';

// External commands that major distributions install by default (util-linux, coreutils, procps,
// iproute / net-tools, systemd, openssh, acl, attr, libcap…), with the options scripts use most.

const files = pos('対象のファイル', 'target file');
const host = pos('ホスト名または IP アドレス', 'host name or IP address');
const device = pos('デバイス（`/dev/sdb1`…）', 'device (`/dev/sdb1`…)');
const noPager = (): [string, string, string] => ['--no-pager', 'ページャーを使わない', 'do not use a pager'];
const recurse = (): [string, string, string] => ['-R|--recursive', 'ディレクトリの中も再帰的に', 'recurse into directories'];

const editor = cmd('テキストエディタ', 'Text editor', [
  ['-R', '読み取り専用で開く', 'open read-only'],
  ['-c', '開いた後に実行する Ex コマンド', 'Ex command to run after opening', 'arg'],
  ['-S', '開いた後に読み込むスクリプト', 'script to source after opening', 'arg'],
  ['-o', '各ファイルを上下に分割して開く', 'open each file in a horizontal split'],
  ['-O', '各ファイルを左右に分割して開く', 'open each file in a vertical split'],
  ['-u', '設定ファイル（`NONE`: 読み込まない）', 'config file (`NONE`: none)', 'arg'],
], { positional: [files] });

export const distro: Record<string, CommandDoc> = {
  // ---- coreutils and util-linux -------------------------------------------------------------
  flock: cmd('ロックを取ってからコマンドを実行する（同時実行を防ぐ）', 'Run a command while holding a lock (prevents concurrent runs)', [
    ['-n|--nonblock', 'ロックが取れなければ待たずに失敗する', 'fail instead of waiting if the lock is taken'],
    ['-w|--timeout', 'ロックを待つ秒数の上限', 'give up waiting after the given number of seconds', 'arg'],
    ['-x|--exclusive', '排他ロックを取る（既定）', 'take an exclusive lock (default)'],
    ['-s|--shared', '共有ロックを取る', 'take a shared lock'],
    ['-u|--unlock', 'ロックを解放する', 'release the lock'],
    ['-c|--command', 'シェルで実行するコマンド文字列', 'command string to run with the shell', 'arg'],
    ['-E|--conflict-exit-code', 'ロックが取れなかったときの終了ステータス', 'exit status when the lock is taken', 'arg'],
  ], { positional: [pos('ロックファイルまたはディレクトリ（番号ならファイルディスクリプタ）', 'lock file or directory (or a file descriptor number)'), pos('実行するコマンド', 'command to run')] }),
  setsid: cmd('新しいセッションでコマンドを実行する（端末から切り離す）', 'Run a command in a new session (detached from the terminal)', [
    ['-f|--fork', '常に fork して実行する', 'always fork'],
    ['-w|--wait', '子プロセスの終了を待ち、その終了ステータスを返す', 'wait for the child and return its exit status'],
    ['-c|--ctty', '制御端末を引き継ぐ', 'take over the controlling terminal'],
  ], { wraps: true }),
  uuidgen: cmd('UUID を生成する', 'Generate a UUID', [
    ['-r|--random', 'ランダムな UUID(v4)', 'random UUID (v4)'],
    ['-t|--time', '時刻ベースの UUID(v1)', 'time-based UUID (v1)'],
    ['-x|--hex', '16 進数だけで出力する', 'print as plain hex'],
  ]),
  shuf: cmd('行をランダムに並べ替える・選ぶ', 'Shuffle lines or pick random ones', [
    ['-n|--head-count', '出力する行数の上限', 'output at most the given number of lines', 'arg'],
    ['-i|--input-range', '範囲 `LO-HI` の整数を並べ替える', 'shuffle the integers in the range `LO-HI`', 'arg'],
    ['-e|--echo', '引数を入力の行として扱う', 'treat the arguments as input lines'],
    ['-r|--repeat', '同じ行を繰り返し選べるようにする', 'allow lines to be picked more than once'],
    ['-o|--output', '出力先のファイル', 'output file', 'arg'],
    ['-z|--zero-terminated', '行の区切りを NUL にする', 'lines end with NUL'],
  ], { positional: [files] }),
  stdbuf: cmd('標準入出力のバッファリングを変えてコマンドを実行する', 'Run a command with modified buffering of its standard streams', [
    ['-i|--input', '標準入力のバッファ（`L`: 行単位、`0`: なし）', 'stdin buffering (`L`: line, `0`: none)', 'arg'],
    ['-o|--output', '標準出力のバッファ（`L`: 行単位、`0`: なし）', 'stdout buffering (`L`: line, `0`: none)', 'arg'],
    ['-e|--error', '標準エラー出力のバッファ（`L`: 行単位、`0`: なし）', 'stderr buffering (`L`: line, `0`: none)', 'arg'],
  ], { wraps: true }),
  truncate: cmd('ファイルのサイズを変える（足りない分は 0 で埋める）', 'Make a file shorter or longer (new bytes are zeros)', [
    ['-s|--size', '新しいサイズ（`+` で増やす、`-` で減らす、`K` `M` `G` の単位）', 'new size (`+` grows, `-` shrinks; units `K` `M` `G`)', 'arg'],
    ['-c|--no-create', 'ファイルがなければ作らない', 'do not create the file'],
    ['-r|--reference', '指定したファイルと同じサイズにする', 'use the size of the given file', 'arg'],
  ], { positional: [files] }),
  yes: cmd('同じ文字列（既定は `y`）を延々と出力する', 'Output a string (default `y`) over and over', [], { positional: [pos('繰り返す文字列', 'string to repeat')] }),
  printenv: cmd('環境変数の値を表示する', 'Print environment variables', [
    ['-0|--null', '各項目を改行ではなく NUL で終える', 'end each entry with NUL, not a newline'],
  ], { positional: [pos('環境変数の名前（省略時はすべて）', 'variable name (default: all)')] }),
  fold: cmd('長い行を指定した幅で折り返す', 'Wrap long lines to a given width', [
    ['-w|--width', '折り返す幅（既定 80）', 'line width (default 80)', 'arg'],
    ['-s|--spaces', '空白の位置で折り返す', 'break at spaces'],
    ['-b|--bytes', '幅を文字数ではなくバイト数で数える', 'count bytes, not columns'],
  ], { positional: [files] }),
  fmt: cmd('段落を指定した幅に整形する', 'Reformat paragraphs to a given width', [
    ['-w|--width', '最大の幅（既定 75）', 'maximum width (default 75)', 'arg'],
    ['-s|--split-only', '長い行を分けるだけで、短い行はつなげない', 'split long lines only, do not join short ones'],
    ['-u|--uniform-spacing', '単語の間を 1 つの空白、文の間を 2 つの空白にそろえる', 'one space between words, two between sentences'],
  ], { positional: [files] }),
  expand: cmd('タブを空白に変換する', 'Convert tabs to spaces', [
    ['-t|--tabs', 'タブの幅（既定 8）', 'tab width (default 8)', 'arg'],
    ['-i|--initial', '行頭のタブだけ変換する', 'convert only leading tabs'],
  ], { positional: [files] }),
  unexpand: cmd('空白をタブに変換する', 'Convert spaces to tabs', [
    ['-t|--tabs', 'タブの幅（`-a` も有効になる）', 'tab width (implies `-a`)', 'arg'],
    ['-a|--all', '行頭以外の空白も変換する', 'convert all runs of spaces, not just leading ones'],
  ], { positional: [files] }),
  join: cmd('共通のキー欄で 2 つのソート済みファイルの行を結合する', 'Join lines of two sorted files on a common field', [
    ['-1', '1 つ目のファイルのキー欄の番号', 'key field of file 1', 'arg'],
    ['-2', '2 つ目のファイルのキー欄の番号', 'key field of file 2', 'arg'],
    ['-t', '欄の区切り文字', 'field separator', 'arg'],
    ['-a', '対応のない行も出力する（ファイル番号 1 または 2）', 'also print unpairable lines of file 1 or 2', 'arg'],
    ['-v', '対応のない行だけ出力する（ファイル番号 1 または 2）', 'print only unpairable lines of file 1 or 2', 'arg'],
    ['-o', '出力する欄の書式（`1.1,2.2`…）', 'output field list (`1.1,2.2`…)', 'arg'],
    ['-e', '空の欄の代わりに使う文字列', 'string to use for empty fields', 'arg'],
  ], { positional: [pos('1 つ目のソート済みファイル（`-` で標準入力）', 'first sorted file (`-` for stdin)'), pos('2 つ目のソート済みファイル（`-` で標準入力）', 'second sorted file (`-` for stdin)')] }),
  chgrp: cmd('ファイルのグループを変える', 'Change the group of files', [
    recurse(),
    ['-h|--no-dereference', 'シンボリックリンク自体を変える', 'change symlinks themselves'],
    ['-c|--changes', '変更があったものだけ報告する', 'report only changes'],
    ['-v|--verbose', '処理したファイルを報告する', 'report every file processed'],
    ['--reference', '指定したファイルと同じグループにする', 'use the group of the given file', 'arg'],
  ], { positional: [pos('グループ', 'group'), files] }),
  mkfifo: cmd('名前付きパイプ(FIFO)を作る', 'Make named pipes (FIFOs)', [
    ['-m|--mode', '権限（`0600`…）', 'permissions (`0600`…)', 'arg'],
  ], { positional: [pos('作る FIFO のパス', 'FIFO path to create')] }),
  b2sum: cmd('BLAKE2 チェックサムを計算・検証する', 'Compute or check BLAKE2 checksums', [
    ['-c|--check', 'チェックサムのファイルを読み、各ファイルを検証する', 'read checksums from files and verify them'],
    ['-l|--length', 'ダイジェストのビット数', 'digest length in bits', 'arg'],
    ['--quiet', '検証に成功したものは表示しない', 'do not print OK lines'],
    ['--status', '何も出力せず、結果を終了ステータスで返す', 'print nothing; report via the exit status'],
    ['-b|--binary', 'バイナリモードで読む', 'read in binary mode'],
  ], { positional: [files] }),
  cksum: cmd('CRC チェックサムとバイト数を表示する', 'Print CRC checksums and byte counts', [
    ['-a|--algorithm', 'アルゴリズム（`crc`、`sha256`、`blake2b`…）', 'algorithm (`crc`, `sha256`, `blake2b`…)', 'arg'],
    ['-c|--check', 'チェックサムのファイルを読み、各ファイルを検証する', 'read checksums from files and verify them'],
  ], { positional: [files] }),
  tty: cmd('標準入力につながっている端末のファイル名を表示する', 'Show which terminal device stdin is attached to', [
    ['-s|--silent|--quiet', '何も出力せず、端末かどうかを終了ステータスで返す', 'print nothing; report via the exit status'],
  ]),
  groups: cmd('ユーザーが属するグループを表示する', 'Print the groups a user belongs to', [], { positional: [pos('ユーザー名（省略時は自分）', 'user name (default: yourself)')] }),
  who: cmd('現在ログインしているユーザーを表示する', 'Show who is logged in', [
    ['-b|--boot', '最後に起動した時刻', 'time of last boot'],
    ['-H|--heading', '見出しの行を付ける', 'print a heading line'],
    ['-q|--count', 'ユーザー名とその人数だけ表示', 'only names and the number of users'],
    ['-u|--users', 'アイドル時間も表示', 'also show idle time'],
    ['-a|--all', 'すべての情報を表示', 'show everything'],
  ]),
  strings: cmd('バイナリから印字できる文字列を取り出す', 'Print the printable strings in a binary file', [
    ['-n|--bytes', '文字列の最小の長さ（既定 4）', 'minimum string length (default 4)', 'arg'],
    ['-a|--all', 'ファイル全体を調べる', 'scan the whole file'],
    ['-t|--radix', '各文字列の位置を表示する（`d`: 10 進、`x`: 16 進）', 'print the offset of each string (`d`: decimal, `x`: hex)', 'arg'],
    ['-e|--encoding', '文字の種類（`s`: 7 ビット、`l`: 16 ビットのリトルエンディアン…）', 'character encoding (`s`: 7-bit, `l`: 16-bit little-endian…)', 'arg'],
  ], { positional: [files] }),
  zgrep: cmd('gzip 圧縮されたファイルも含めて検索する（`grep` と同じオプション）', 'Search files, compressed with gzip or not (same options as `grep`)', [
    ['-i|--ignore-case', '大文字小文字を区別しない', 'ignore case'],
    ['-v|--invert-match', '一致しない行を出力する', 'select non-matching lines'],
    ['-n|--line-number', '行番号を付ける', 'prefix with the line number'],
    ['-c|--count', '一致した行数だけ表示', 'only count matching lines'],
    ['-l|--files-with-matches', '一致したファイル名だけ表示', 'only list files with matches'],
    ['-E|--extended-regexp', '拡張正規表現(ERE)', 'extended regular expressions (ERE)'],
    ['-F|--fixed-strings', '正規表現ではなく固定文字列', 'fixed strings, not regular expressions'],
    ['-e|--regexp', '検索するパターン', 'pattern to search for', 'arg'],
  ], { positional: [pos('検索するパターン', 'pattern to search for'), files] }),

  // ---- process and system information ---------------------------------------------------------
  free: cmd('メモリとスワップの使用状況を表示する', 'Show memory and swap usage', [
    ['-h|--human', 'KiB、MiB、GiB など読みやすい単位で表示', 'human-readable units'],
    ['-m|--mebi', 'MiB 単位で表示', 'show in mebibytes'],
    ['-g|--gibi', 'GiB 単位で表示', 'show in gibibytes'],
    ['-b|--bytes', 'バイト単位で表示', 'show in bytes'],
    ['-t|--total', '合計の行も表示', 'show a total line'],
    ['-s|--seconds', '指定した秒数ごとに繰り返し表示', 'repeat at the given interval in seconds', 'arg'],
    ['-w|--wide', 'バッファとキャッシュを分けて表示', 'show buffers and cache separately'],
  ]),
  top: cmd('プロセスの状況を実時間で表示する', 'Display running processes in real time', [
    ['-b', 'バッチモード（端末の操作なしで出力し続ける。ログ向け）', 'batch mode (plain output, for logs)'],
    ['-n', '指定した回数で終了する', 'exit after the given number of iterations', 'arg'],
    ['-d', '更新間隔（秒）', 'refresh interval in seconds', 'arg'],
    ['-p', '見るプロセスの PID（カンマ区切り）', 'only these PIDs (comma separated)', 'arg'],
    ['-u', '指定したユーザーのプロセスだけ', 'only the given user', 'arg'],
    ['-o', '並べ替えのフィールド（`%MEM`、`%CPU`…）', 'sort field (`%MEM`, `%CPU`…)', 'arg'],
    ['-H', 'スレッドごとに表示', 'show threads'],
  ]),
  pidof: cmd('プログラム名からプロセス ID を表示する', 'Print the process IDs of a program', [
    ['-s', '最初の 1 つだけ表示', 'return a single PID'],
    ['-q', '何も出力せず、見つかったかどうかを終了ステータスで返す', 'print nothing; report via the exit status'],
    ['-x', 'スクリプトとして動いているものも含める', 'also match scripts running the program'],
    ['-o', '指定したプロセス ID を除く', 'omit these PIDs', 'arg'],
  ], { positional: [pos('プログラム名', 'program name')] }),
  lsof: cmd('開いているファイルやソケットを一覧表示する', 'List open files and sockets', [
    ['-i', 'ネットワーク接続だけ（`:8080` や `tcp` で絞れる）', 'network connections only (a filter such as `:8080` or `tcp` can follow)'],
    ['-p', '指定したプロセス ID だけ', 'only the given PID', 'arg'],
    ['-u', '指定したユーザーだけ', 'only the given user', 'arg'],
    ['-t', 'プロセス ID だけを出力する', 'print only PIDs'],
    ['-n', 'ホスト名を解決しない', 'do not resolve host names'],
    ['-P', 'ポート番号をサービス名にしない', 'do not convert port numbers to names'],
    ['-c', '指定したコマンド名で始まるプロセスだけ', 'only processes whose command starts with the given name', 'arg'],
  ], { positional: [pos('ファイル名（`-i` の絞り込み `:8080` なども）', 'file name (or the filter of `-i`, such as `:8080`)')] }),
  fuser: cmd('ファイルやポートを使っているプロセスを表示する', 'Show which processes use files or ports', [
    ['-k|--kill', '使っているプロセスにシグナルを送る（注意）', 'kill the processes using them (careful)'],
    ['-m|--mount', 'ファイルシステム全体を対象にする', 'name a mounted file system'],
    ['-v|--verbose', '詳細な形式で表示', 'verbose output'],
    ['-n|--namespace', '名前空間（`tcp`、`udp`、`file`）', 'namespace (`tcp`, `udp`, `file`)', 'arg'],
    ['-s|--silent', '何も表示しない', 'print nothing'],
    ['-i|--interactive', '終了させる前に確認する', 'ask before killing'],
  ], { positional: [pos('ファイルまたは `ポート/tcp`', 'file or `port/tcp`')] }),
  pstree: cmd('プロセスの親子関係を木の形で表示する', 'Show processes as a tree', [
    ['-p', 'PID も表示', 'show PIDs'],
    ['-a', 'コマンドラインの引数も表示', 'show command-line arguments'],
    ['-u', 'ユーザーが変わるところを表示', 'show user transitions'],
    ['-h', '今のプロセスの系統を強調', 'highlight the current process'],
    ['-n', 'PID の順に並べる', 'sort by PID'],
  ], { positional: [pos('ユーザー名または PID', 'user name or PID')] }),
  lscpu: cmd('CPU の情報を表示する', 'Display CPU information', [
    ['-e|--extended', 'CPU ごとの表で表示', 'one table row per CPU'],
    ['-p|--parse', '機械で読みやすい形式', 'machine-readable output'],
    ['-J|--json', 'JSON で出力', 'output JSON'],
  ]),
  lsmod: cmd('読み込まれているカーネルモジュールを表示する', 'Show loaded kernel modules'),
  taskset: cmd('プロセスを動かす CPU を指定・確認する', 'Pin a command or process to some CPUs, or show which it may use', [
    ['-c|--cpu-list', 'CPU を番号の一覧（`0,2-3`）で指定', 'give CPUs as a list (`0,2-3`)'],
    ['-p|--pid', '動いているプロセスを対象にする', 'operate on a running PID'],
  ], { positional: [pos('CPU のマスクまたは一覧', 'CPU mask or list'), pos('コマンドまたは PID', 'command or PID')] }),
  renice: cmd('動いているプロセスの優先度(nice 値)を変える', 'Change the priority (nice value) of running processes', [
    ['-n|--priority', '新しい nice 値（-20〜19、小さいほど優先）', 'new nice value (-20 to 19, lower is higher priority)', 'arg'],
    ['-p|--pid', '対象はプロセス ID（既定）', 'targets are PIDs (default)'],
    ['-u|--user', '対象はユーザー', 'targets are users'],
    ['-g|--pgrp', '対象はプロセスグループ', 'targets are process groups'],
  ], { positional: [pos('プロセス ID', 'process ID')] }),
  ionice: cmd('ディスク入出力の優先度を指定してコマンドを実行する', 'Run a command with a lower or higher priority for disk I/O', [
    ['-c|--class', 'クラス（`1`: リアルタイム、`2`: ベストエフォート（既定）、`3`: ディスクが空いているときだけ）', 'class: `1` real time, `2` best effort (the default), `3` only when the disk is idle', 'arg'],
    ['-n|--classdata', 'クラス内の優先度（0〜7、小さいほど優先）', 'priority within the class (0 to 7, lower is higher)', 'arg'],
    ['-p|--pid', '動いているプロセスを対象にする', 'operate on a running PID', 'arg'],
  ], { wraps: true }),
  unshare: cmd('名前空間を切り離してコマンドを実行する', 'Run a command in new namespaces', [
    ['-m|--mount', 'マウント名前空間を分ける', 'new mount namespace'],
    ['-u|--uts', 'ホスト名の名前空間を分ける', 'new UTS (host name) namespace'],
    ['-i|--ipc', 'IPC 名前空間を分ける', 'new IPC namespace'],
    ['-n|--net', 'ネットワーク名前空間を分ける', 'new network namespace'],
    ['-p|--pid', 'PID 名前空間を分ける', 'new PID namespace'],
    ['-U|--user', 'ユーザー名前空間を分ける', 'new user namespace'],
    ['-r|--map-root-user', '今のユーザーを新しい名前空間の root に対応づける', 'map the current user to root in the new namespace'],
    ['-f|--fork', '子プロセスとして実行する', 'fork before running the command'],
    ['--mount-proc', '新しい PID 名前空間用に `/proc` をマウントし直す', 'mount `/proc` for the new PID namespace'],
  ], { wraps: true }),
  nsenter: cmd('他のプロセスの名前空間に入ってコマンドを実行する', "Run a command in another process's namespaces", [
    ['-t|--target', '名前空間を借りるプロセスの PID', 'PID whose namespaces to enter', 'arg'],
    ['-m|--mount', 'マウント名前空間に入る', 'enter the mount namespace'],
    ['-u|--uts', 'ホスト名の名前空間に入る', 'enter the UTS namespace'],
    ['-i|--ipc', 'IPC 名前空間に入る', 'enter the IPC namespace'],
    ['-n|--net', 'ネットワーク名前空間に入る', 'enter the network namespace'],
    ['-p|--pid', 'PID 名前空間に入る', 'enter the PID namespace'],
    ['-a|--all', 'すべての名前空間に入る', 'enter all namespaces'],
  ], { wraps: true }),
  script: cmd('端末での操作と出力をファイルに記録する', 'Record everything shown in the terminal to a file', [
    ['-q|--quiet', '開始・終了のメッセージを出さない', 'do not print start and done messages'],
    ['-a|--append', 'ファイルに追記する', 'append to the file'],
    ['-c|--command', '対話シェルではなく指定したコマンドを実行する', 'run the given command instead of an interactive shell', 'arg'],
    ['-e|--return', '実行したコマンドの終了ステータスを返す', 'exit with the status the command exited with'],
    ['-f|--flush', '書くたびにフラッシュする', 'flush after each write'],
  ], { positional: [pos('記録するファイル（既定 `typescript`）', 'output file (default `typescript`)')] }),

  // ---- network ------------------------------------------------------------------------------
  ping: cmd('ICMP echo でホストへの到達性を確かめる', 'Check if a host is reachable with ICMP echo', [
    ['-c', '指定した回数送って終了する', 'stop after the given number of packets', 'arg'],
    ['-W', '応答を待つ秒数', 'seconds to wait for a reply', 'arg'],
    ['-w', '全体の制限時間（秒）', 'overall deadline in seconds', 'arg'],
    ['-i', '送信間隔（秒）', 'interval between packets in seconds', 'arg'],
    ['-q', '最後の集計だけ表示', 'quiet, show only the summary'],
    ['-n', 'ホスト名を解決しない', 'numeric output, no name lookups'],
    ['-4', 'IPv4 を使う', 'use IPv4'],
    ['-6', 'IPv6 を使う', 'use IPv6'],
  ], { positional: [host] }),
  nc: cmd('TCP/UDP で接続・待ち受けする（ポートの確認、データ転送）', 'Connect or listen over TCP/UDP (port checks, data transfer)', [
    ['-z', 'データを送らず、待ち受けているかだけ調べる（Ncat にはない）', 'scan for listeners without sending data (not in Ncat)'],
    ['-v', '詳しく表示', 'verbose'],
    ['-w', '接続のタイムアウト（秒）', 'connection timeout in seconds', 'arg'],
    ['-l', '接続を待ち受ける', 'listen for a connection'],
    ['-p', '使うポート番号', 'source or listening port', 'arg'],
    ['-u', 'TCP ではなく UDP を使う', 'use UDP instead of TCP'],
    ['-k', '接続が切れても待ち受け続ける（traditional 版にはない）', 'keep listening after a connection ends (not in traditional netcat)'],
    ['-n', '名前解決をしない', 'no DNS lookups'],
  ], { positional: [pos('ホスト', 'host'), pos('ポート', 'port')] }),
  dig: cmd('DNS に問い合わせる', 'Query DNS servers', [
    ['-x', '逆引き（IP アドレスから名前）', 'reverse lookup (address to name)'],
    ['-t', 'レコードの種類（`A`、`MX`、`TXT`…）', 'record type (`A`, `MX`, `TXT`…)', 'arg'],
    ['-p', 'DNS サーバーのポート', 'server port', 'arg'],
    ['-4', 'IPv4 で問い合わせる', 'use IPv4 only'],
    ['-6', 'IPv6 で問い合わせる', 'use IPv6 only'],
  ], { positional: [pos('`@サーバー`、名前、レコードの種類、`+short` などの表示オプション', '`@server`, name, record type, display options such as `+short`')] }),
  nslookup: cmd('DNS に問い合わせる（名前なしで起動すると対話形式）', 'Query DNS servers (interactive if run without a name)', [], { positional: [pos('調べる名前', 'name to look up'), pos('DNS サーバー', 'DNS server')] }),
  host: cmd('名前と IP アドレスを DNS で変換する', 'Look up DNS names and addresses', [
    ['-t', 'レコードの種類（`A`、`MX`、`TXT`…）', 'record type (`A`, `MX`, `TXT`…)', 'arg'],
    ['-a', 'すべての種類のレコードを詳しく表示', 'all records, verbose'],
    ['-W', '応答を待つ秒数', 'seconds to wait for a reply', 'arg'],
    ['-4', 'IPv4 で問い合わせる', 'use IPv4 only'],
    ['-6', 'IPv6 で問い合わせる', 'use IPv6 only'],
  ], { positional: [pos('調べる名前または IP アドレス', 'name or address to look up'), pos('DNS サーバー', 'DNS server')] }),
  ifconfig: cmd('ネットワークインターフェースを表示・設定する（古い `ip` 相当）', 'Show or configure network interfaces (the older counterpart of `ip`)', [
    ['-a', '停止中のものも含めてすべて表示', 'show all interfaces, including down ones'],
    ['-s', '短い一覧で表示', 'short list'],
  ], { positional: [pos('インターフェース名、`up` / `down`、アドレス', 'interface name, `up` / `down`, address')] }),
  netstat: cmd('ネットワーク接続・待ち受けポート・経路を表示する（古い `ss` 相当）', 'Show connections, listening ports and routes (the older counterpart of `ss`)', [
    ['-t', 'TCP', 'TCP'],
    ['-u', 'UDP', 'UDP'],
    ['-l', '待ち受けているソケットだけ', 'listening sockets only'],
    ['-a', 'すべてのソケット', 'all sockets'],
    ['-n', '名前解決をせず数値で表示', 'numeric addresses and ports'],
    ['-p', 'ソケットを使っているプロセスも表示', 'show the owning process'],
    ['-r', '経路表を表示', 'show the routing table'],
    ['-i', 'インターフェースの統計を表示', 'show interface statistics'],
  ]),
  'ssh-add': cmd('ssh-agent に秘密鍵を登録する', 'Add private keys to ssh-agent', [
    ['-l', '登録されている鍵の指紋を表示', 'list fingerprints of loaded keys'],
    ['-L', '登録されている公開鍵を表示', 'list public keys of loaded keys'],
    ['-d', '指定した鍵を取り除く', 'remove the given keys'],
    ['-D', 'すべての鍵を取り除く', 'remove all keys'],
    ['-t', '鍵を保持する秒数', 'lifetime of the key in seconds', 'arg'],
  ], { positional: [pos('秘密鍵のファイル', 'private key file')] }),
  'ssh-agent': cmd('秘密鍵を保持する認証エージェントを起動する', 'Start the authentication agent that holds private keys', [
    ['-s', 'Bourne シェル用のコマンドを出力する（`eval` で使う）', 'print Bourne-shell commands (for `eval`)'],
    ['-c', 'C シェル用のコマンドを出力する', 'print C-shell commands'],
    ['-k', '動いているエージェントを終了する', 'kill the running agent'],
    ['-a', 'ソケットのパス', 'socket path', 'arg'],
    ['-t', '鍵の既定の保持秒数', 'default key lifetime in seconds', 'arg'],
    ['-D', 'フォアグラウンドで動かす', 'run in the foreground'],
  ]),
  'ssh-copy-id': cmd('公開鍵をリモートの authorized_keys に登録する', "Install public keys in the remote host's authorized_keys", [
    ['-i', '登録する公開鍵のファイル', 'public key file to install', 'arg'],
    ['-p', 'SSH のポート', 'SSH port', 'arg'],
    ['-o', 'ssh に渡すオプション', 'option passed to ssh', 'arg'],
    ['-f', '登録済みでも確認せずに追加する', 'force: install without checking if already present'],
    ['-n', '実際には変更せず、登録される鍵を表示する', 'dry run: print the keys that would be installed'],
  ], { positional: [pos('`ユーザー@ホスト`', '`user@host`')] }),
  sftp: cmd('SSH 上でファイルを転送する（対話形式）', 'Transfer files over SSH (interactive)', [
    ['-P', 'ポート番号', 'port', 'arg'],
    ['-i', '秘密鍵のファイル', 'identity file', 'arg'],
    ['-o', 'ssh に渡すオプション', 'option passed to ssh', 'arg'],
    ['-b', 'コマンドを書いたバッチファイル（`-` で標準入力）', 'batch file of commands (`-` for stdin)', 'arg'],
    ['-r', 'ディレクトリを再帰的にコピー', 'copy directories recursively'],
    ['-q', '進捗を表示しない', 'quiet'],
    ['-C', '圧縮を有効にする', 'enable compression'],
  ], { positional: [pos('`ユーザー@ホスト:パス`', '`user@host:path`')] }),

  // ---- systems management ---------------------------------------------------------------------
  crontab: cmd('ユーザーの cron テーブル（定期実行の予定）を編集・表示する', "Edit or list a user's cron table (scheduled jobs)", [
    ['-l', '今の cron テーブルを表示', 'list the current crontab'],
    ['-e', 'エディタで編集', 'edit in an editor'],
    ['-r', 'cron テーブルをすべて削除する（注意）', 'remove the whole crontab (careful)'],
    ['-u', '対象のユーザー', 'user whose crontab to use', 'arg'],
    ['-i', '削除の前に確認する', 'ask before removing'],
  ], { positional: [pos('登録する crontab ファイル（`-` で標準入力）', 'crontab file to install (`-` for stdin)')] }),
  journalctl: cmd('systemd のジャーナル（ログ）を表示する', 'Query the systemd journal (logs)', [
    ['-u|--unit', '指定したユニットのログだけ', 'only the given unit', 'arg'],
    ['-f|--follow', '新しいログを追い続ける', 'follow new entries'],
    ['-n|--lines', '表示する末尾の行数', 'number of recent lines', 'arg'],
    ['-b|--boot', '今回（または指定した）起動のログだけ', 'only this (or the given) boot'],
    ['-p|--priority', '指定した重要度以上のログだけ（`err`、`warning`…）', 'only the given priority or higher (`err`, `warning`…)', 'arg'],
    ['--since', '指定した時刻以降（`"1 hour ago"`、`today`…）', 'since the given time (`"1 hour ago"`, `today`…)', 'arg'],
    ['--until', '指定した時刻まで', 'until the given time', 'arg'],
    ['-o|--output', '出力形式（`json`、`short-iso`、`cat`…）', 'output format (`json`, `short-iso`, `cat`…)', 'arg'],
    noPager(),
    ['-r|--reverse', '新しい順に表示', 'newest first'],
  ]),
  timedatectl: cmd('システムの時刻とタイムゾーンを表示・設定する', 'Show or set the system time and time zone', [noPager()], {
    subcommands: {
      status: cmd('現在の時刻設定を表示する', 'Show the current time settings'),
      'set-timezone': cmd('タイムゾーンを設定する（`Asia/Tokyo`…）', 'Set the time zone (`Asia/Tokyo`…)'),
      'set-ntp': cmd('NTP による時刻同期を有効・無効にする（`true` / `false`）', 'Turn NTP synchronization on or off (`true` / `false`)'),
      'list-timezones': cmd('使えるタイムゾーンを一覧表示する', 'List known time zones'),
    },
  }),
  hostnamectl: cmd('ホスト名を表示・設定する', 'Show or set the host name', [
    ['--static', '静的なホスト名を対象にする', 'the static host name'],
    ['--transient', '一時的なホスト名を対象にする', 'the transient host name'],
    ['--pretty', '表示用のホスト名を対象にする', 'the pretty host name'],
  ], {
    subcommands: {
      status: cmd('現在のホスト名と環境を表示する', 'Show the host name and environment'),
      'set-hostname': cmd('ホスト名を設定する', 'Set the host name'),
    },
  }),
  loginctl: cmd('systemd-logind のセッションとユーザーを操作する', 'Control systemd-logind sessions and users', [noPager()], {
    subcommands: {
      'list-sessions': cmd('セッションを一覧表示する', 'List sessions'),
      'list-users': cmd('ログイン中のユーザーを一覧表示する', 'List logged-in users'),
      'enable-linger': cmd('ログアウトしてもユーザーのサービスを動かし続ける', 'Keep the user services running after logout'),
      'terminate-session': cmd('セッションを終了させる', 'Terminate a session'),
    },
  }),
  'update-alternatives': cmd('同じ役割のコマンドのうち、どれを使うかを切り替える（Debian 系）', 'Choose which of several commands provides a role (Debian family)', [
    ['--install', '代替を登録する（リンク 名前 パス 優先度）', 'register an alternative (link name path priority)'],
    ['--set', '名前に対して使うパスを決める', 'set the path used for a name'],
    ['--config', '対話的に選ぶ', 'choose interactively'],
    ['--display', '現在の設定を表示', 'show the current setting'],
    ['--list', '登録されているパスを一覧表示', 'list the registered paths'],
    ['--remove', '登録を取り除く', 'remove a registration'],
    ['--auto', '自動選択に戻す', 'switch to automatic mode'],
  ], { positional: [pos('名前、パス…', 'name, path…')] }),
  passwd: cmd('パスワードを変える', 'Change a password', [
    ['-l|--lock', 'アカウントをロックする', 'lock the account'],
    ['-u|--unlock', 'アカウントのロックを解除する', 'unlock the account'],
    ['-d|--delete', 'パスワードを削除する（注意）', 'delete the password (careful)'],
    ['-e|--expire', 'パスワードをすぐに期限切れにする', 'expire the password now'],
    ['-S|--status', 'アカウントの状態を表示', 'show the account status'],
  ], { positional: [pos('ユーザー名（省略時は自分）', 'user name (default: yourself)')] }),
  chpasswd: cmd('標準入力の `ユーザー:パスワード` からパスワードを一括で変える', 'Change passwords in bulk from `user:password` lines on stdin', [
    ['-e|--encrypted', '入力のパスワードは暗号化済み', 'passwords are already encrypted'],
    ['-c|--crypt-method', '暗号化の方式（`SHA512`…）', 'encryption method (`SHA512`…)', 'arg'],
  ]),
  gpasswd: cmd('グループのメンバーや管理者を管理する', 'Administer groups and their members', [
    ['-a|--add', 'ユーザーをグループに加える', 'add a user to the group', 'arg'],
    ['-d|--delete', 'ユーザーをグループから外す', 'remove a user from the group', 'arg'],
    ['-M|--members', 'メンバーを一覧で置き換える（カンマ区切り）', 'set the member list (comma separated)', 'arg'],
    ['-A|--administrators', '管理者を一覧で置き換える', 'set the administrators', 'arg'],
  ], { positional: [pos('グループ', 'group')] }),
  visudo: cmd('sudoers を構文チェック付きで編集する', 'Edit sudoers with a syntax check', [
    ['-c|--check', '編集せず構文だけ調べる', 'check the syntax only'],
    ['-f|--file', '対象の sudoers ファイル', 'sudoers file to edit or check', 'arg'],
    ['-q|--quiet', 'エラー以外は表示しない', 'less verbose'],
    ['-s|--strict', '厳密に調べる', 'strict checking'],
  ]),
  getfacl: cmd('ファイルのアクセス制御リスト(ACL)を表示する', 'Show the access control lists (ACLs) of files', [
    recurse(),
    ['-n|--numeric', 'ユーザー・グループを番号のまま表示', 'print numeric user and group IDs'],
    ['-p|--absolute-names', '先頭の `/` を取り除かない', 'do not strip the leading `/`'],
    ['-d|--default', '既定の ACL を表示', 'show the default ACL'],
  ], { positional: [files] }),
  setfacl: cmd('ファイルのアクセス制御リスト(ACL)を設定する', 'Set the access control lists (ACLs) of files', [
    ['-m|--modify', 'ACL の項目を追加・変更する（`u:alice:rwx`）', 'add or modify ACL entries (`u:alice:rwx`)', 'arg'],
    ['-x|--remove', 'ACL の項目を取り除く', 'remove ACL entries', 'arg'],
    ['-b|--remove-all', '拡張 ACL をすべて取り除く', 'remove all extended entries'],
    ['-k|--remove-default', '既定の ACL を取り除く', 'remove the default ACL'],
    recurse(),
    ['-d|--default', '既定の ACL に対して操作する', 'operate on the default ACL'],
    ['-M|--modify-file', 'ファイルから項目を読んで追加・変更する', 'read entries to modify from a file', 'arg'],
  ], { positional: [files] }),
  chattr: cmd('ファイルの拡張属性（変更不可など）を変える', 'Change file attributes (immutable and more)', [
    ['-R', 'ディレクトリの中も再帰的に', 'recurse into directories'],
    ['-V', '詳しく表示', 'verbose'],
  ], { positional: [pos('属性の変更（`+i`: 変更不可にする、`-i`: 解く、`+a`: 追記のみ可…）', 'attribute change (`+i`: make immutable, `-i`: clear it, `+a`: append only…)'), files] }),
  lsattr: cmd('ファイルの拡張属性を表示する', 'List file attributes', [
    ['-R', 'ディレクトリの中も再帰的に', 'recurse into directories'],
    ['-a', '`.` で始まるファイルも表示', 'include files starting with `.`'],
    ['-d', 'ディレクトリの中身ではなくディレクトリ自体を表示', 'list directories themselves, not their contents'],
  ], { positional: [files] }),
  setcap: cmd('実行ファイルにケーパビリティ(capabilities)を付ける', 'Set file capabilities on executables', [
    ['-r', 'ケーパビリティを取り除く', 'remove the capabilities'],
    ['-q', '静かに実行する', 'quiet'],
    ['-v', '付いているケーパビリティを確認する', 'verify the capabilities'],
  ], { positional: [pos('ケーパビリティ（`cap_net_bind_service=+ep`…）', 'capabilities (`cap_net_bind_service=+ep`…)'), files] }),
  getcap: cmd('ファイルに付いているケーパビリティ(capabilities)を表示する', 'Show the file capabilities of files', [
    ['-r', 'ディレクトリの中も再帰的に', 'recurse into directories'],
    ['-v', 'ケーパビリティのないファイルも表示', 'also show files without capabilities'],
  ], { positional: [files] }),
  ldconfig: cmd('共有ライブラリのキャッシュを更新する', 'Update the shared library cache', [
    ['-p|--print-cache', 'キャッシュの内容を表示', 'print the cache'],
    ['-v|--verbose', '詳しく表示', 'verbose'],
    ['-n', '指定したディレクトリだけ処理する', 'process only the given directories'],
    ['-N', 'キャッシュを作り直さない', 'do not rebuild the cache'],
  ]),

  // ---- disks ----------------------------------------------------------------------------------
  mkfs: cmd('ファイルシステムを作る（デバイスの内容は失われる）', "Build a file system (destroys the device's contents)", [
    ['-t|--type', 'ファイルシステムの種類（`ext4`、`xfs`…）', 'file system type (`ext4`, `xfs`…)', 'arg'],
  ], { positional: [device] }),
  'mkfs.ext4': cmd('ext4 ファイルシステムを作る（デバイスの内容は失われる）', "Make an ext4 file system (destroys the device's contents)", [
    ['-L', 'ボリュームラベル', 'volume label', 'arg'],
    ['-F', '確認せず強制的に作る（注意）', 'force, do not ask (careful)'],
    ['-q', '出力を抑える', 'quiet'],
    ['-m', '予約ブロックの割合（%）', 'reserved blocks percentage', 'arg'],
    ['-t', 'ファイルシステムの種類', 'file system type', 'arg'],
  ], { positional: [device] }),
  fsck: cmd('ファイルシステムを検査して修復する', 'Check and repair a file system', [
    ['-y', '修復の質問にすべて「はい」と答える', 'answer yes to every repair question'],
    ['-n', '修復せず検査だけ', 'check only, change nothing'],
    ['-f', 'きれいに見えても強制的に検査する', 'force a check even if the file system looks clean'],
    ['-p', '安全に直せるものを自動で修復する', 'repair automatically what is safe'],
    ['-A', '`/etc/fstab` のすべてを検査する', 'check all file systems in `/etc/fstab`'],
    ['-t', 'ファイルシステムの種類', 'file system type', 'arg'],
  ], { positional: [device] }),
  losetup: cmd('ループデバイスを設定・表示する（ファイルをデバイスとして扱う）', 'Set up and show loop devices (files used as block devices)', [
    ['-f|--find', '空いているループデバイスを探す', 'pick a free loop device'],
    ['-P|--partscan', 'パーティションを読み取る', 'scan for partitions'],
    ['-d|--detach', 'ループデバイスを切り離す', 'detach a loop device'],
    ['-D|--detach-all', 'すべてのループデバイスを切り離す', 'detach all loop devices'],
    ['-a|--all', 'すべてのループデバイスを表示', 'list all loop devices'],
    ['-r|--read-only', '読み取り専用にする', 'read-only'],
    ['--show', 'ループデバイスの名前を出力する', 'print the device name'],
    ['-j|--associated', '指定したファイルに割り当てたデバイスを表示', 'show devices associated with the given file', 'arg'],
  ], { positional: [pos('ループデバイス、ファイル', 'loop device, file')] }),
  swapon: cmd('スワップ領域を有効にする', 'Enable swap areas', [
    ['-a|--all', '`/etc/fstab` のスワップをすべて有効にする', 'enable all swaps in `/etc/fstab`'],
    ['-s|--summary', '使用状況を表示', 'show a summary'],
    ['--show', '使用状況を表で表示', 'show usage as a table'],
    ['-p|--priority', '優先度', 'priority', 'arg'],
  ], { positional: [pos('スワップのデバイスまたはファイル', 'swap device or file')] }),
  swapoff: cmd('スワップ領域を無効にする', 'Disable swap areas', [
    ['-a|--all', 'すべてのスワップを無効にする', 'disable all swaps'],
  ], { positional: [pos('スワップのデバイスまたはファイル', 'swap device or file')] }),
  mkswap: cmd('スワップ領域を作る（内容は失われる）', 'Set up a swap area (destroys the contents)', [
    ['-L|--label', 'ラベル', 'label', 'arg'],
    ['-f|--force', '確認せずに作る（注意）', 'force, do not ask (careful)'],
    ['-U|--uuid', 'UUID', 'UUID', 'arg'],
  ], { positional: [pos('スワップにするデバイスまたはファイル', 'device or file to use as swap')] }),

  // ---- editors --------------------------------------------------------------------------------
  vi: editor,
  vim: editor,
  nano: cmd('テキストエディタ（初心者向け）', 'Text editor (beginner-friendly)', [
    ['-l|--linenumbers', '行番号を表示', 'show line numbers'],
    ['-w|--nowrap', '長い行を折り返さない', 'do not wrap long lines'],
    ['-B|--backup', '保存時にバックアップを作る', 'back up the file when saving'],
    ['-c|--constantshow', 'カーソル位置を常に表示', 'always show the cursor position'],
    ['-m|--mouse', 'マウスを使えるようにする', 'enable the mouse'],
    ['-R|--restricted', '制限モード（ほかのファイルやシェルを使えない）', 'restricted mode (no other files or shell)'],
  ], { positional: [files] }),
};
