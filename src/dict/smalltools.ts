import type { CommandSpec, PatternOption } from '../argv/spec';
import { tx } from '../i18n';
import { cmd, operand, OptSpec, pos, runs } from './types';

// rg, pv, sponge, expect, socat and sshpass, checked against ripgrep 14.1.0, pv 1.8.5, moreutils 0.69 (sponge), expect 5.45.4,
// socat 1.8.0.0 and sshpass 1.09: their option lines (recorded in test/fixtures/small-tools/, compared in test/small-tools.test.ts)
// and their behaviour (test/small-tools-real.test.ts, which runs them when $RG, $PV, $SPONGE, $EXPECT, $SOCAT and $SSHPASS name them).
//
// How each reads its words: ripgrep uses lexopt (the parser `lexopt`: clusters, `-A3`, `-A=3`, `--name=value` or `--name value`, no
// abbreviation of a long name); pv uses getopt_long (so `--siz` is `--size`); sponge and sshpass use getopt (sshpass stops at the
// first operand, the command it runs); expect reads each option as a whole word (`-c cmds`, `-f file`, never clustered); socat reads
// them as one word each too (`-v -x`, not `-vx`: it refuses that; all before the two addresses), with the value of some in the next word or attached
// (`-t 5`, `-t5`, `-lf /var/log/x`, `-lf/var/log/x`).
//
// Not read: ripgrep's pattern (a regular expression of the Rust `regex` crate: no reader has that flavour, and the POSIX and PCRE
// ones would misread it), expect's script (Tcl), socat's addresses (`TCP:host:80,fork`: a keyword, its parameters and options) and
// the program after `--pre`.

// ---------------------------------------------------------------- rg

/** A flag that `--no-NAME` turns off, as ripgrep lets the later flag win: `[name, ja, en]`. */
const NEGATED: [string, string, string][] = [
  ['auto-hybrid-regex', '`--auto-hybrid-regex`', '`--auto-hybrid-regex`'],
  ['binary', '`--binary`', '`--binary`'],
  ['block-buffered', '`--block-buffered`', '`--block-buffered`'],
  ['byte-offset', '`--byte-offset`', '`--byte-offset`'],
  ['column', '`--column`', '`--column`'],
  ['context-separator', '`--context-separator`', '`--context-separator`'],
  ['crlf', '`--crlf`', '`--crlf`'],
  ['encoding', '`--encoding`', '`--encoding`'],
  ['fixed-strings', '`--fixed-strings`', '`--fixed-strings`'],
  ['follow', '`--follow`', '`--follow`'],
  ['glob-case-insensitive', '`--glob-case-insensitive`', '`--glob-case-insensitive`'],
  ['heading', '`--heading`', '`--heading`'],
  ['hidden', '`--hidden`', '`--hidden`'],
  ['ignore-file-case-insensitive', '`--ignore-file-case-insensitive`', '`--ignore-file-case-insensitive`'],
  ['include-zero', '`--include-zero`', '`--include-zero`'],
  ['invert-match', '`--invert-match`', '`--invert-match`'],
  ['json', '`--json`', '`--json`'],
  ['line-buffered', '`--line-buffered`', '`--line-buffered`'],
  ['max-columns-preview', '`--max-columns-preview`', '`--max-columns-preview`'],
  ['mmap', '`--mmap`', '`--mmap`'],
  ['multiline', '`--multiline`', '`--multiline`'],
  ['multiline-dotall', '`--multiline-dotall`', '`--multiline-dotall`'],
  ['one-file-system', '`--one-file-system`', '`--one-file-system`'],
  ['pcre2', '`--pcre2`', '`--pcre2`'],
  ['pre', '`--pre`', '`--pre`'],
  ['search-zip', '`--search-zip`', '`--search-zip`'],
  ['sort-files', '`--sort-files`', '`--sort-files`'],
  ['stats', '`--stats`', '`--stats`'],
  ['text', '`--text`', '`--text`'],
  ['trim', '`--trim`', '`--trim`'],
];

const negated = (): OptSpec[] => NEGATED.map(([name, ja, en]): OptSpec => [`--no-${name}`, `${ja} を無効にする（あとに書いたほうが効く）`, `turn off ${en} (the later flag wins)`]);

const RG: OptSpec[] = [
  ['-e|--regexp', '検索するパターン（複数指定でき、どれかに一致すれば当たり。`-` で始まるパターンにも使う）', 'a pattern to search for (several allowed, a line matches if any does; also for a pattern that starts with `-`)', 'arg fills'],
  ['-f|--file', '検索するパターンをファイルから読む（1 行に 1 つ）', 'read the patterns from a file (one per line)', 'arg fills io:read'],
  ['--pre', '各ファイルを検索する前に、そのファイルを引数にして実行するコマンド（出力を検索する）', 'a command run on each file before it is searched, with the file as its argument (its output is searched)', 'arg'],
  ['--pre-glob', '`--pre` を使うファイルをグロブで絞る', 'a glob that picks the files `--pre` runs on', 'arg'],
  ['-z|--search-zip', '圧縮されたファイル（gzip、bzip2、xz、lz4、brotli、zstd）の中も検索する', 'also search inside compressed files (gzip, bzip2, xz, lz4, brotli, zstd)'],
  ['-s|--case-sensitive', '大文字・小文字を区別して検索する（既定）', 'search case sensitively (the default)'],
  ['--crlf', '行の終わりを CRLF として扱う', 'treat CRLF as the line terminator'],
  ['--dfa-size-limit', '正規表現の DFA の大きさの上限（`10M` のように単位が付けられる）', 'upper size limit of the regex DFA (a suffix such as `10M` is allowed)', 'arg'],
  ['-E|--encoding', '検索するファイルの文字コード（`utf-16`、`sjis` など。`none` で変換しない）', 'text encoding of the files to search (`utf-16`, `sjis`; `none` for no conversion)', 'arg'],
  ['--engine', '使う正規表現エンジン（`default`、`pcre2`、`auto`）', 'which regex engine to use (`default`, `pcre2`, `auto`)', 'arg'],
  ['-F|--fixed-strings', 'パターンを正規表現ではなく文字そのままとして扱う', 'treat the patterns as literal strings, not regexes'],
  ['-i|--ignore-case', '大文字・小文字を区別しない', 'ignore case'],
  ['-v|--invert-match', '一致しない行を選ぶ', 'select the lines that do not match'],
  ['-x|--line-regexp', '行全体に一致する場合だけ当たりとする', 'match only whole lines'],
  ['-m|--max-count', 'ファイルごとに N 行一致したらそのファイルの検索をやめる', 'stop searching a file after N matching lines', 'arg'],
  ['--mmap', '可能ならメモリマップでファイルを読む', 'search with memory maps when possible'],
  ['-U|--multiline', '複数行にまたがる一致を許す', 'allow matches across lines'],
  ['--multiline-dotall', '`.` が改行にも一致する（`-U` と使う）', 'let `.` match a line terminator (with `-U`)'],
  ['--no-unicode', 'Unicode のモードを使わない', 'turn off Unicode mode'],
  ['--unicode', 'Unicode のモードを使う（既定）', 'turn on Unicode mode (the default)'],
  ['--null-data', '行の区切りを改行でなく NUL にする', 'use NUL, not a newline, as the line terminator'],
  ['-P|--pcre2', '正規表現に PCRE2 を使う（先読みや後方参照が使える）', 'use PCRE2 for the regex (lookaround and backreferences work)'],
  ['--regex-size-limit', 'コンパイルした正規表現の大きさの上限', 'size limit of the compiled regex', 'arg'],
  ['-S|--smart-case', 'パターンに大文字がなければ大文字・小文字を区別しない', 'ignore case unless the pattern has an uppercase letter'],
  ['--stop-on-nonmatch', '一致の後の一致しない行で、そのファイルの検索をやめる', 'stop searching a file at the first non-matching line after a match'],
  ['-a|--text', 'バイナリファイルもテキストとして検索する', 'search binary files as if they were text'],
  ['-j|--threads', '使うスレッド数のめやす（0 で自動）', 'the approximate number of threads (0: automatic)', 'arg'],
  ['-w|--word-regexp', '単語の境界に囲まれた一致だけを当たりとする', 'match only text surrounded by word boundaries'],
  ['--auto-hybrid-regex', '（廃止）必要なら PCRE2 を使う。`--engine auto` を使う', '(deprecated) use PCRE2 when needed; use `--engine auto`'],
  ['--no-pcre2-unicode', '（廃止）PCRE2 の Unicode のモードを使わない', '(deprecated) turn off Unicode mode for PCRE2'],
  ['--binary', 'バイナリファイルも検索する（一致した所でバイナリと分かるまで）', 'search binary files too (a file found binary stops at that point)'],
  ['-L|--follow', 'シンボリックリンクをたどる', 'follow symbolic links'],
  ['-g|--glob', 'パスをグロブで含める・除く（`!` で始めると除く。複数可）', 'include or exclude paths by a glob (a leading `!` excludes; several allowed)', 'arg'],
  ['--glob-case-insensitive', 'すべての `-g` を大文字・小文字を区別せず扱う', 'treat all `-g` globs case insensitively'],
  ['-.|--hidden', '隠しファイルと隠しディレクトリも検索する', 'search hidden files and directories'],
  ['--iglob', '大文字・小文字を区別せず、パスをグロブで含める・除く', 'include or exclude paths by a glob, ignoring case', 'arg'],
  ['--ignore-file', '追加の無視ファイル（`.gitignore` と同じ書き方）', 'an extra ignore file (the syntax of `.gitignore`)', 'arg io:read'],
  ['--ignore-file-case-insensitive', '無視ファイルを大文字・小文字を区別せず扱う', 'process ignore files case insensitively'],
  ['-d|--max-depth', '下りるディレクトリの深さの上限', 'descend at most the given number of directories', 'arg'],
  ['--max-filesize', '指定した大きさより大きいファイルは無視する（`10M` のように単位が付けられる）', 'ignore files larger than the given size (a suffix such as `10M` is allowed)', 'arg'],
  ['--no-ignore', '無視ファイル（`.gitignore`、`.ignore`、`.rgignore`）を使わない', 'do not use ignore files (`.gitignore`, `.ignore`, `.rgignore`)'],
  ['--no-ignore-dot', '`.ignore` と `.rgignore` を使わない', 'do not use `.ignore` or `.rgignore` files'],
  ['--no-ignore-exclude', '`.git/info/exclude` などの、そのリポジトリだけの除外ファイルを使わない', 'do not use local exclusion files such as `.git/info/exclude`'],
  ['--no-ignore-files', '`--ignore-file` で指定したファイルを使わない', 'do not use the files given with `--ignore-file`'],
  ['--no-ignore-global', 'グローバルな無視ファイルを使わない', 'do not use global ignore files'],
  ['--no-ignore-parent', '親ディレクトリの無視ファイルを使わない', 'do not use ignore files of parent directories'],
  ['--no-ignore-vcs', 'バージョン管理の無視ファイル（`.gitignore`）を使わない', 'do not use ignore files of version control (`.gitignore`)'],
  ['--no-require-git', 'Git のリポジトリの外でも `.gitignore` を使う', 'use `.gitignore` also outside a Git repository'],
  ['--one-file-system', '別のファイルシステムのディレクトリには入らない', 'do not descend into directories on other file systems'],
  ['-t|--type', '種類で絞って、その種類のファイルだけ検索する（`rg --type-list` が一覧を出す）', 'search only files of a type (`rg --type-list` lists them)', 'arg'],
  ['-T|--type-not', '種類を指定して、その種類のファイルを検索しない', 'do not search files of a type', 'arg'],
  ['--type-add', 'ファイルの種類にグロブを足す（`web:*.html` や `src:include:cpp,py`）', 'add a glob to a file type (`web:*.html`, `src:include:cpp,py`)', 'arg'],
  ['--type-clear', 'ファイルの種類のグロブを空にする', 'clear the globs of a file type', 'arg'],
  ['-u|--unrestricted', '絞り込みをゆるめる（`-u` で無視ファイル、`-uu` で隠しファイル、`-uuu` でバイナリも）', 'relax the filtering (`-u`: ignore files, `-uu`: hidden files too, `-uuu`: binary files too)'],
  ['-A|--after-context', '一致した行のあとの N 行も表示する', 'show N lines after each match', 'arg'],
  ['-B|--before-context', '一致した行のまえの N 行も表示する', 'show N lines before each match', 'arg'],
  ['--block-buffered', '出力をブロック単位でバッファーする', 'force block buffering'],
  ['-b|--byte-offset', '一致した行の、ファイル先頭からのバイト位置も表示する', 'print the byte offset of each matching line'],
  ['--color', '色を付ける時期（`never`、`auto`、`always`、`ansi`）', 'when to use color (`never`, `auto`, `always`, `ansi`)', 'arg'],
  ['--colors', '色と書式の設定（`match:fg:red`、`path:style:bold`）', 'color and style settings (`match:fg:red`, `path:style:bold`)', 'arg'],
  ['--column', '一致した位置の列番号も表示する', 'show the column number of each match'],
  ['-C|--context', '一致した行の前後の N 行も表示する', 'show N lines before and after each match', 'arg'],
  ['--context-separator', '前後の行のまとまりの間に置く区切り（既定は `--`）', 'the separator between groups of context lines (default `--`)', 'arg'],
  ['--field-context-separator', '前後の行のファイル名・行番号の区切り（既定は `-`）', 'the separator between the fields of a context line (default `-`)', 'arg'],
  ['--field-match-separator', '一致した行のファイル名・行番号の区切り（既定は `:`）', 'the separator between the fields of a matching line (default `:`)', 'arg'],
  ['--heading', 'ファイルごとにまとめ、ファイル名を見出しとして 1 度だけ表示する（端末では既定）', 'group the matches by file under one heading of the file name (the default on a terminal)'],
  ['-h|--help', '使い方を表示する（`--help` は詳しく）', 'show the help (`--help` in more detail)'],
  ['--hostname-bin', 'ホスト名を調べるために実行するコマンド（ハイパーリンクで使う）', 'a command run to find the host name (used for hyperlinks)', 'arg'],
  ['--hyperlink-format', 'ハイパーリンクの書式（`default`、`vscode` など）', 'the format of hyperlinks (`default`, `vscode`…)', 'arg'],
  ['--include-zero', '件数の出力に、一致が 0 のファイルも含める（`-c` と使う）', 'include files with zero matches in the counts (with `-c`)'],
  ['--line-buffered', '出力を 1 行ごとにバッファーする', 'force line buffering'],
  ['-n|--line-number', '行番号を表示する', 'show line numbers'],
  ['-N|--no-line-number', '行番号を表示しない', 'do not show line numbers'],
  ['-M|--max-columns', '指定した長さより長い行は表示しない', 'omit lines longer than the given length', 'arg'],
  ['--max-columns-preview', '長すぎて省いた行も、先頭の部分は表示する', 'show a preview of the lines omitted for length'],
  ['-0|--null', 'ファイル名のあとに NUL を出力する（`xargs -0` と使う）', 'output a NUL after file paths (for `xargs -0`)'],
  ['-o|--only-matching', '行全体ではなく、一致した部分だけを表示する', 'print only the matched parts of a line'],
  ['--path-separator', '出力するパスの区切り文字', 'the path separator used in the output', 'arg'],
  ['--passthru', '一致しない行もそのまま表示する（一致した所は強調される）', 'print the non-matching lines too (matches are highlighted)'],
  ['-p|--pretty', '`--color=always --heading --line-number` の別名', 'an alias for `--color=always --heading --line-number`'],
  ['-q|--quiet', '何も出力せず、終了ステータスだけで結果を返す', 'print nothing; report only by the exit status'],
  ['-r|--replace', '一致した部分を指定した文字に置き換えて表示する（元のファイルは変わらない。`$1` で括弧の中身）', 'print each match replaced by the given text (the files do not change; `$1` is a capture group)', 'arg'],
  ['--sort', 'ファイル名などの順に並べて出力する（`path`、`modified`、`accessed`、`created`、`none`。1 スレッドになる）', 'sort the results in ascending order (`path`, `modified`, `accessed`, `created`, `none`; it runs on one thread)', 'arg'],
  ['--sortr', '`--sort` の逆順に並べて出力する', 'sort the results in descending order', 'arg'],
  ['--trim', '一致した行の頭の空白を取り除く', 'trim the whitespace at the start of each line shown'],
  ['--vimgrep', '`ファイル:行:列:本文` の形で、一致ごとに 1 行出力する（Vim が読める形）', 'print one `FILE:LINE:COLUMN:TEXT` line per match (a form Vim reads)'],
  ['-H|--with-filename', '各行にファイル名を付ける', 'print the file path with each line'],
  ['-I|--no-filename', '各行にファイル名を付けない', 'never print the file path with each line'],
  ['--sort-files', '（廃止）ファイル名の順に並べる。`--sort path` を使う', '(deprecated) sort by file path; use `--sort path`'],
  ['-c|--count', 'ファイルごとに、一致した行の数を表示する', 'show the number of matching lines per file'],
  ['--count-matches', 'ファイルごとに、一致の数（1 行に複数でも数える）を表示する', 'show the number of matches per file (several on a line count each)'],
  ['-l|--files-with-matches', '一致があったファイルの名前だけを表示する', 'print only the names of files with a match'],
  ['--files-without-match', '一致がなかったファイルの名前だけを表示する', 'print only the names of files without a match'],
  ['--json', '結果を JSON Lines で出力する', 'print the results as JSON Lines'],
  ['--debug', 'デバッグ用のメッセージを表示する', 'show debug messages'],
  ['--no-ignore-messages', '無視ファイルの書き方の誤りを表示しない', 'do not show errors in the syntax of ignore files'],
  ['--no-messages', 'ファイルを開けないなどのエラーを表示しない', 'do not show some error messages, such as a file that cannot be opened'],
  ['--stats', '検索の統計（一致の数、検索したファイルの数、時間）も表示する', 'also print statistics (matches, files searched, time)'],
  ['--trace', 'トレース用のメッセージを表示する', 'show trace messages'],
  ['--files', '検索するファイルの名前だけを表示する（検索はしない）', 'print the files that would be searched, and search none'],
  ['--generate', 'man ページや補完のスクリプトを出力する（`man`、`complete-bash`、`complete-zsh` など）', 'print a man page or a completion script (`man`, `complete-bash`, `complete-zsh`…)', 'arg'],
  ['--no-config', '設定ファイル（`RIPGREP_CONFIG_PATH`）を読まない', 'never read the configuration file (`RIPGREP_CONFIG_PATH`)'],
  ['--pcre2-version', '使っている PCRE2 の版を表示する', 'print the version of PCRE2 in use'],
  ['--type-list', '知っているファイルの種類とそのグロブを表示する', 'show all the file types and their globs'],
  ['-V|--version', '版を表示する', 'print the version'],
  ...negated(),
];

// ---------------------------------------------------------------- pv

const PV: OptSpec[] = [
  ['-p|--progress', '進行状況のバーを表示する', 'show the progress bar'],
  ['-t|--timer', '経過時間を表示する', 'show the elapsed time'],
  ['-e|--eta', '終わるまでの予想時間を表示する', 'show the estimated time to completion'],
  ['-I|--fineta', '終わる予想の時刻を表示する', 'show the estimated time of day of completion'],
  ['-r|--rate', '転送の速さを表示する', 'show the data transfer rate'],
  ['-a|--average-rate', '平均の転送の速さを表示する', 'show the average data transfer rate'],
  ['-m|--average-rate-window', '平均の速さを求める期間（秒。既定は 30）', 'the period in seconds the average rate is computed over (default 30)', 'arg'],
  ['-b|--bytes', '転送したバイト数を表示する', 'show the number of bytes transferred'],
  ['-8|--bits', '転送したビット数を表示する', 'show the number of bits transferred'],
  ['-T|--buffer-percent', '転送用バッファーの使用率を表示する', 'show the percentage of the transfer buffer in use'],
  ['-A|--last-written', '最後に書いた N バイトを表示する', 'show the last N bytes written', 'arg'],
  ['-F|--format', '表示の書式（`%t %b %r %p`。`%N` は名前）', 'the output format (`%t %b %r %p`; `%N` is the name)', 'arg'],
  ['-n|--numeric', 'バーでなく、進行率の数字だけを出力する（1 行に 1 つ）', 'print only the percentage, as a number per line, not the bar'],
  ['-q|--quiet', '転送の情報を何も表示しない', 'show no transfer information at all'],
  ['-W|--wait', '最初のバイトが来るまで何も表示しない', 'show nothing until the first byte is transferred'],
  ['-D|--delay-start', '指定した秒数がたつまで何も表示しない', 'show nothing until the given number of seconds have passed', 'arg'],
  ['-s|--size', '全体の大きさ（バイト。`10M` のように単位が付けられる）。進行率と残り時間の計算に使う', 'the expected total size in bytes (a suffix such as `10M` is allowed); the percentage and the estimate use it', 'arg'],
  ['-l|--line-mode', 'バイトでなく行を数える', 'count lines, not bytes'],
  ['-0|--null', '行の区切りを NUL にする（`-l` と使う）', 'lines end with NUL (with `-l`)'],
  ['-i|--interval', '表示を更新する間隔（秒）', 'update the display at the given interval in seconds', 'arg'],
  ['-w|--width', '端末の幅を指定した文字数とみなす', 'assume the terminal is the given number of characters wide', 'arg'],
  ['-H|--height', '端末の高さを指定した行数とみなす', 'assume the terminal is the given number of rows high', 'arg'],
  ['-N|--name', '表示の先頭に付ける名前（複数の `pv` を見分ける）', 'a name to prefix the display with (to tell several `pv` apart)', 'arg'],
  ['-f|--force', '標準エラー出力が端末でなくても表示する', 'show the display even if standard error is not a terminal'],
  ['-c|--cursor', 'カーソルの位置を制御するエスケープシーケンスで表示を更新する', 'update the display with cursor positioning escape sequences'],
  ['-L|--rate-limit', '転送の速さの上限（バイト毎秒。`1M` のように単位が付けられる）', 'limit the transfer to the given number of bytes per second (a suffix such as `1M` is allowed)', 'arg'],
  ['-B|--buffer-size', '使うバッファーの大きさ（バイト）', 'the buffer size in bytes', 'arg'],
  ['-C|--no-splice', '`splice()` を使わず、いつも read と write で転送する', 'never use `splice()`; always read and write'],
  ['-E|--skip-errors', '入力の読み取りエラーを飛ばして続ける', 'skip read errors in the input'],
  ['-Z|--error-skip-block', '読み取りエラーを、指定したバイト数のブロックごとに飛ばす', 'skip read errors in blocks of the given number of bytes', 'arg'],
  ['-S|--stop-at-size', '`--size` のバイト数を転送したら止める', 'stop after `--size` bytes have been transferred'],
  ['-Y|--sync', '書くたびにキャッシュをディスクに書き出す', 'flush the cache to disk after every write'],
  ['-K|--direct-io', 'ダイレクト I/O でキャッシュを通さない', 'use direct I/O to bypass the cache'],
  ['-X|--discard', '入力を出力に書かず捨てる', 'discard the input instead of writing it to the output'],
  ['-R|--remote', '動いている別の `pv`（PID）の設定を変える', 'update the settings of another running `pv` (PID)', 'arg'],
  ['-P|--pidfile', '自分のプロセス ID を書くファイル', 'a file to save the process ID in', 'arg io:write'],
  ['-d|--watchfd', '別のプロセスが開いているファイルの進み具合を見る（`PID` か `PID:FD`）', 'watch the progress of a file another process has open (`PID` or `PID:FD`)', 'arg'],
  ['-h|--help', '使い方を表示する', 'show the help'],
  ['-V|--version', '版を表示する', 'show the version'],
];

// ---------------------------------------------------------------- sshpass

const SSHPASS: OptSpec[] = [
  ['-f', 'パスワードを読むファイル（先頭の 1 行）', 'a file to read the password from (its first line)', 'arg io:read'],
  ['-d', 'パスワードを読むファイル記述子の番号', 'the number of a file descriptor to read the password from', 'arg'],
  ['-p', 'パスワード（コマンド行に書くと `ps` などで他のユーザーに見える。`-f` か `-e` を使う）', 'the password (on the command line other users can see it in `ps`; use `-f` or `-e`)', 'arg'],
  ['-e', '環境変数 `SSHPASS` からパスワードを読む', 'read the password from the environment variable `SSHPASS`'],
  ['-P', 'パスワードの入力を求める行とみなす文字列（既定は `assword`）', 'the string that marks the password prompt (default `assword`)', 'arg'],
  ['-v', 'しようとしていることを表示する', 'show what it is doing'],
  ['-h', '使い方を表示する', 'show the usage'],
  ['-V', '版を表示する', 'show the version'],
];

// ---------------------------------------------------------------- expect

const EXPECT_ARG = operand('ARG', 'スクリプトに渡す引数（変数 `argv` に入る）', 'an argument for the script (it goes into the variable `argv`)', { repeat: '*' });

const EXPECT: OptSpec[] = [
  ['-c', 'スクリプトより前に実行するコマンド（Tcl。`;` で区切れば複数。何度でも指定できる）', 'commands (Tcl) to run before the script (`;` separates several; may be given more than once)', 'arg'],
  ['-d', '診断の出力を有効にする（`expect` や `interact` の内部の動きを表示する）', 'turn on diagnostic output (what `expect` and `interact` do inside)'],
  ['-D', '対話式のデバッガーを有効にする（0 以外の整数で、次の Tcl 手続きの前に止まる）', 'turn on the interactive debugger (a nonzero integer stops before the next Tcl procedure)', 'arg'],
  ['-f', 'コマンドを読むスクリプトのファイル（省略できる）', 'the script file to read commands from (optional)', 'arg io:read'],
  ['-b', 'スクリプトのファイルを 1 行ずつ読んで実行する', 'read the script file one line at a time', 'arg io:read'],
  ['-i', 'スクリプトでなく、対話的にコマンドを入力する（スクリプトも `-c` もなければ既定）', 'prompt for commands interactively (the default with no script and no `-c`)'],
  ['-n', '`~/.expect.rc` を読まない', 'do not read `~/.expect.rc`'],
  ['-N', '`$exp_library/expect.rc` を読まない', 'do not read `$exp_library/expect.rc`'],
  ['-v', '版を表示して終わる', 'print the version and exit'],
];

// ---------------------------------------------------------------- socat

const SOCAT: OptSpec[] = [
  ['-V', '版と機能を標準出力に表示して終わる', 'print the version and the features to stdout, and exit'],
  ['-h|-?', '使い方（オプションとアドレス）を表示する', 'print a help text of the options and the addresses'],
  ['-hh', '`-h` に加えて、アドレスのオプション名の一覧（よく使うもの）を表示する', 'like `-h`, plus the common address option names'],
  ['-hhh', '`-hh` に加えて、アドレスのオプション名をすべて表示する', 'like `-hh`, plus all the address option names'],
  ['-d', '詳しさを 1 段階上げる（`-d -d` か `-dd` で 2 段階。最大 4 回。2 回がおすすめ）', 'one more level of verbosity (`-d -d` or `-dd` for two; up to four; two are recommended)'],
  ['-D', 'データの転送を始める前に、ファイル記述子を分析して表示する', 'analyze and print the file descriptors before the transfer loop'],
  ['--experimental', '実験的な機能を有効にする', 'enable experimental features'],
  ['--statistics', '終わるときに転送の統計を表示する', 'print the transfer statistics on exit'],
  ['-ly', 'syslog に記録する（`-lyFACILITY` で facility を指定。既定は daemon）', 'log to syslog (`-lyFACILITY` picks the facility; default daemon)'],
  ['-lf', '記録を書くファイル（`-lf FILE` か `-lfFILE`）', 'a file to write the log to (`-lf FILE` or `-lfFILE`)', 'arg io:write'],
  ['-ls', '記録を標準エラー出力に書く（他の指定がなければ既定）', 'log to stderr (the default if no other log is given)'],
  ['-lm', '最初は標準エラー出力、データ転送が始まったら syslog に記録する（`-lmFACILITY`）', 'log to stderr at first, then to syslog once the transfer begins (`-lmFACILITY`)'],
  ['-lp', 'ログと変数で使うプログラム名（`-lp NAME` か `-lpNAME`）', 'the program name used for logging and variables (`-lp NAME` or `-lpNAME`)', 'arg'],
  ['-lu', 'ログの時刻をマイクロ秒まで書く', 'use microseconds in the log timestamps'],
  ['-lh', 'ログにホスト名を加える', 'add the host name to the log messages'],
  ['-v', '流れるデータを文字で表示する（標準エラー出力）', 'print the data traffic as text (to stderr)'],
  ['-x', '流れるデータを 16 進で表示する（標準エラー出力）', 'print the data traffic in hexadecimal (to stderr)'],
  ['-r', '左から右へ流れる生のデータを書くファイル', 'a file to write the raw data flowing from left to right to', 'arg io:write'],
  ['-R', '右から左へ流れる生のデータを書くファイル', 'a file to write the raw data flowing from right to left to', 'arg io:write'],
  ['-b', 'データ用のバッファーの大きさ（バイト。既定は 8192）', 'the size of the data buffer in bytes (default 8192)', 'arg'],
  ['-s', 'エラーがあっても続ける（雑に）', 'sloppy: go on after an error'],
  ['-S', '記録するシグナルを指定したものにする（既定のものを上書き）', 'log these signals, overriding the default', 'arg'],
  ['-t', '片方が閉じたあと、もう片方を閉じるまで待つ秒数', 'seconds to wait before closing the second channel', 'arg'],
  ['-T', '何も流れないまま指定した秒数がたったら終わる', 'end after the given number of seconds with no data', 'arg'],
  ['-u', '一方向にする（左から右だけ）', 'unidirectional: left to right only'],
  ['-U', '一方向にする（右から左だけ）', 'unidirectional: right to left only'],
  ['-g', 'アドレスのオプションのグループを確かめない', 'do not check the groups of the address options'],
  ['-L', '指定したロックファイルを作れなければ失敗する', 'try to obtain the given lock file, or fail', 'arg io:write'],
  ['-W', '指定したロックファイルを作れるまで待つ', 'try to obtain the given lock file, or wait', 'arg io:write'],
  ['-4', '版を指定しないアドレスでは IPv4 を優先する', 'prefer IPv4 where the address names no version'],
  ['-6', '版を指定しないアドレスでは IPv6 を優先する', 'prefer IPv6 where the address names no version'],
];

const socatPatterns: PatternOption[] = [
  { pattern: /^-d(?:d{1,3}|[0-4])$/, text: ([w]) => tx(/^-d\d$/.test(w) ? `詳しさのレベルを ${w.slice(2)} にする（0 はエラーだけ、4 はデバッグまで）` : `詳しさを ${w.length - 1} 段階上げる（\`-d\` の重ね書き）`, /^-d\d$/.test(w) ? `verbosity level ${w.slice(2)} (0: errors only; 4: everything including debug)` : `${w.length - 1} levels more verbose (\`-d\` repeated)`) },
  { pattern: /^-ly(.+)$/, text: ([, f]) => tx(`syslog に \`${f}\` の facility で記録する`, `log to syslog with the facility \`${f}\``) },
  { pattern: /^-lm(.+)$/, text: ([, f]) => tx(`最初は標準エラー出力、そのあと syslog（facility \`${f}\`）に記録する`, `log to stderr at first, then to syslog with the facility \`${f}\``) },
  { pattern: /^-lf(.+)$/, text: ([, f]) => tx(`記録を \`${f}\` に書く`, `write the log to \`${f}\``) },
  { pattern: /^-lp(.+)$/, text: ([, n]) => tx(`ログと変数で使うプログラム名を \`${n}\` にする`, `use \`${n}\` as the program name for logging and variables`) },
  { pattern: /^-r(.+)$/, text: ([, f]) => tx(`左から右へ流れる生のデータを \`${f}\` に書く`, `write the raw data flowing from left to right to \`${f}\``) },
  { pattern: /^-R(.+)$/, text: ([, f]) => tx(`右から左へ流れる生のデータを \`${f}\` に書く`, `write the raw data flowing from right to left to \`${f}\``) },
  { pattern: /^-b(.+)$/, text: ([, n]) => tx(`データ用のバッファーの大きさを ${n} バイトにする`, `data buffer size ${n} bytes`) },
  { pattern: /^-S(.+)$/, text: ([, s]) => tx(`記録するシグナルを \`${s}\` にする`, `log the signals \`${s}\``) },
  { pattern: /^-t(.+)$/, text: ([, n]) => tx(`片方が閉じたあと、もう片方を閉じるまで ${n} 秒待つ`, `wait ${n} seconds before closing the second channel`) },
  { pattern: /^-T(.+)$/, text: ([, n]) => tx(`何も流れないまま ${n} 秒たったら終わる`, `end after ${n} seconds with no data`) },
];

const ADDRESS = (n: number): ReturnType<typeof operand> => operand(
  n === 1 ? 'ADDRESS1' : 'ADDRESS2',
  `${n === 1 ? '1 つ目' : '2 つ目'}のアドレス（\`-\` は標準入出力、ほかに \`TCP:ホスト:ポート\`、\`UNIX-CONNECT:パス\`、\`EXEC:コマンド\`、ファイル名など。\`,\` のあとにアドレスのオプション）`,
  `the ${n === 1 ? 'first' : 'second'} address (\`-\` for standard input and output, \`TCP:HOST:PORT\`, \`UNIX-CONNECT:PATH\`, \`EXEC:COMMAND\`, a file name…, with address options after a \`,\`)`,
);

// ---------------------------------------------------------------- the specs

export const smallTools: Record<string, CommandSpec> = {
  rg: cmd(
    'ディレクトリを再帰的に検索して、パターン（Rust の正規表現）に一致する行を表示する（ripgrep。`.gitignore` に載ったファイル、隠しファイル、バイナリファイルは既定で飛ばす）',
    'Recursively search the current directory for lines that match a pattern (a Rust regex; ripgrep). It skips files in `.gitignore`, hidden files and binary files by default',
    RG,
    {
      parser: 'lexopt',
      helpCommand: 'rg --help',
      exits: [{ status: 1, text: tx('選ばれた行がなかった', 'no line was selected') }],
      positional: [pos('検索するパターン（正規表現。`-` で始まるときは `-e` を使う）', 'the pattern to search for (a regex, or give it with `-e` when it starts with `-`)'), pos('検索するファイルかディレクトリ（省略すると今のディレクトリ。標準入力が使えるときは標準入力）', 'a file or directory to search (the current directory when none, standard input when it is a pipe)')],
      positionalIo: [undefined, 'input'],
    },
  ),
  pv: cmd(
    '入力をそのまま出力に流しながら、進み具合（バー、経過時間、速さ、残り時間）を標準エラー出力に表示する（ファイルの指定がなければ標準入力）',
    'Copy the input to the output, showing the progress (bar, elapsed time, rate, estimate) on standard error (standard input when no file is given)',
    PV,
    { parser: 'getopt_long', helpCommand: 'pv --help', positional: [pos('流すファイル（`-` または省略で標準入力）', 'a file to copy (`-` or none for standard input)')], positionalIo: ['input'] },
  ),
  sponge: cmd(
    '標準入力をすべて読み終えてから、ファイルに書く。同じファイルを読むパイプラインの出力でも、そのファイルに戻せる（`sort f | sponge f`）。ファイルを指定しなければ標準出力に書く',
    'Read all of standard input first, then write it to a file, so that a pipeline that reads a file can write its output back to it (`sort f | sponge f`). With no file it writes to standard output',
    [['-a', 'ファイルを置き換えず、元の内容のあとに追記する', 'append to the file instead of replacing it']],
    { positional: [pos('書き込むファイル（省略すると標準出力）', 'the file to write (standard output when none)')], positionalIo: ['write'] },
  ),
  expect: cmd(
    '対話的なプログラムを、スクリプト（Tcl）に従って自動で操作する（`spawn` で起動し、`expect` で出力を待ち、`send` で入力する）',
    'Drive an interactive program by a script (Tcl): `spawn` starts it, `expect` waits for its output, `send` types to it',
    EXPECT,
    {
      parser: 'single-dash',
      optionsFirst: true,
      operands: [
        { when: { option: ['-f', '-b'] }, pattern: [EXPECT_ARG] },
        { pattern: [operand('SCRIPT', '実行するスクリプトのファイル（Tcl。`-` なら標準入力）', 'the script file to run (Tcl, or `-` for standard input)', { repeat: '?', io: 'read' }), EXPECT_ARG] },
      ],
    },
  ),
  socat: cmd(
    '2 つのアドレス（ファイル、ソケット、コマンド、端末など）の間でデータを両方向に流す',
    'Relay data both ways between two addresses (files, sockets, commands, terminals…)',
    SOCAT,
    {
      parser: 'single-dash',
      optionsFirst: true,
      patternOptions: socatPatterns,
      helpCommand: 'socat -h',
      operands: [{ pattern: [ADDRESS(1), ADDRESS(2)] }],
    },
  ),
  sshpass: cmd(
    'パスワードをコマンド行・ファイル・環境変数から与えて、対話的なパスワードの入力を求めるコマンド（ssh、scp など）を実行する',
    'Run a command that asks for a password interactively (ssh, scp…), supplying the password from the command line, a file or the environment',
    SSHPASS,
    { optionsFirst: true, helpCommand: 'sshpass -h', operands: [{ pattern: [runs()] }] },
  ),
};
