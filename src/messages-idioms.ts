// The catalog's notes on idioms (src/idioms.ts, `IDIOMS`): one entry per idiom, its words, and the sections of the
// manual it is about; apart, to keep src/messages.ts short (which spreads them into `MESSAGES`).

/** An idiom's entry: a note (always said), with the label "Idiom:" before its words. */
const idiom = (refs: readonly string[], [ja, en]: readonly [string, string]) => ({ kind: 'note' as const, refs, text: (_p: Record<string, never>) => [`定番の書き方: ${ja}`, `Idiom: ${en}`] as const });

export const IDIOM_MESSAGES = {
  'idiom-ifs-read-raw': idiom(['4.2', '3.5.7'], [
    '`IFS= read -r`: 1行を加工せずそのまま読む（`IFS=` で前後の空白を取り除かせず、`-r` でバックスラッシュをそのまま残す）',
    '`IFS= read -r`: reads a line exactly as is (`IFS=` keeps surrounding spaces, `-r` keeps backslashes)']),
  'idiom-script-dir': idiom(['5.2', '3.5.4'], [
    'スクリプトが置かれているディレクトリの絶対パスを得る（どこから実行しても同じ場所を指せる）',
    'gets the absolute path of the directory the script lives in (the same wherever it is run from)']),
  'idiom-cd-script-dir': idiom(['5.2', '4.1'], [
    'スクリプトが置かれているディレクトリに移動する（どこから実行しても相対パスが同じように使える）',
    'moves to the directory the script lives in (so relative paths work wherever it is run from)']),
  'idiom-quiet-check': idiom(['4.2', '3.6'], [
    'コマンドがインストールされているかを、出力を出さずに確かめる',
    'checks quietly whether a command is installed']),
  'idiom-run-directly': idiom(['5.2', '3.4.2'], [
    'スクリプトが直接実行されたか（`source` で読み込まれたのではないか）を判定する（Python の `if __name__ == "__main__"` に相当）',
    'checks whether the script is run directly rather than sourced (like Python\'s `if __name__ == "__main__"`)']),
  'idiom-strict-mode': idiom(['4.3.1'], [
    '安全なスクリプトのための定番設定（strict mode）: エラーで止まる、未定義の変数をエラーにする、パイプの途中の失敗も見逃さない',
    'the usual "strict mode": stop on errors, treat unset variables as errors, and catch failures inside pipelines']),
  'idiom-require-variable': idiom(['3.5.3', '4.1'], [
    '`: "${VAR:?…}"`: 必須の変数が設定されているか確かめる（未設定ならメッセージを出して終了。`:` は何もしないコマンド）',
    '`: "${VAR:?…}"`: checks that a required variable is set (exits with the message if not; `:` does nothing itself)']),
  'idiom-default-variable': idiom(['3.5.3', '4.1'], [
    '`: "${VAR:=…}"`: 変数が未設定か空なら既定値を代入する（`:=` の場合。`=` だけなら未設定のときだけ。`:` は何もしないコマンドで、展開だけを行わせる）',
    '`: "${VAR:=…}"`: assigns a default if the variable is unset or empty (with `:=`; plain `=` only when unset; `:` does nothing, only the expansion matters)']),
  'idiom-or-true': idiom(['3.2.4', '4.3.1'], [
    '`|| true`: 失敗しても終了ステータスを成功にする（`set -e` でスクリプトが止まらないようにする）',
    '`|| true`: turns a failure into success (so `set -e` does not stop the script)']),
  'idiom-exit-trap': idiom(['4.1'], [
    '`trap … EXIT`: スクリプトがどう終わっても（エラーでも）最後に後片付けを実行する',
    '`trap … EXIT`: runs clean-up when the script exits, however it exits']),
  'idiom-exec-tee': idiom(['4.1', '3.5.6'], [
    '以降のすべての出力を画面に出しつつ、ログにも保存する',
    'from here on, everything printed also goes to a log']),
  'idiom-endless-loop': idiom(['3.2.5.1'], [
    '無限ループ（`break` や `exit` で抜ける）',
    'an endless loop (left with `break` or `exit`)']),
  'idiom-mktemp': idiom(['3.5.4'], [
    '`mktemp`: 他と重ならない一時ファイル（-d ならディレクトリ）を安全に作る',
    '`mktemp`: safely creates a unique temporary file (or directory with -d)']),
  'idiom-read-file-loop': idiom(['3.2.5.1', '4.2', '3.6.1'], [
    '`while read … done < ファイル`: ファイルを1行ずつ読んで処理する（ループ全体の標準入力がそのファイルになる）。最後の行の末尾に改行がないと、その行は読まれずに終わる（`while read -r line || [ -n "$line" ]` とすれば読める）',
    '`while read … done < file`: reads a file line by line (the file is the stdin of the whole loop). A last line with no newline at its end is skipped, unless the loop is `while read -r line || [ -n "$line" ]`']),
  'idiom-read-command-loop': idiom(['3.5.6', '4.2'], [
    '`while read … done < <(コマンド)`: コマンドの出力を1行ずつ読んで処理する。`コマンド | while read …` と違い、ループがカレントシェルで動くので、中で代入した変数がループのあとも残る。最後の行の末尾に改行がないと、その行は読まれずに終わる（`|| [ -n "$line" ]` を足せば読める）',
    '`while read … done < <(command)`: reads the output of a command line by line. Unlike `command | while read …`, the loop runs in the current shell, so variables set in it are still there after the loop. A last line with no newline at its end is skipped, unless `|| [ -n "$line" ]` is added']),
  'idiom-getopts-loop': idiom(['4.1'], [
    '`while getopts`: 短いオプション（`-a`、値つきの `-b 値`）を1つずつ読む。オプションの文字は変数に、値は `$OPTARG` に入る。最初のオプションでない語で読み取りが止まるので、オプションは引数より前に置く',
    '`while getopts`: reads short options (`-a`, `-b value`) one at a time: the letter goes to the variable, the value to `$OPTARG`. It stops at the first word that is not an option, so options must come before the operands']),
  'idiom-shift-optind': idiom(['4.1', '3.4.1'], [
    '`shift $((OPTIND-1))`: `getopts` で読み終えたオプションを取り除き、`$1` を最初の引数にする。関数の中で `getopts` を使うなら、先に `local OPTIND=1` としておく（さもないと2回目の呼び出しが前回の続きから始まり、何も読まない）',
    '`shift $((OPTIND-1))`: drops the options `getopts` has read, so `$1` is the first operand. In a function that uses `getopts`, set `local OPTIND=1` first, or a second call starts where the first stopped and reads nothing']),
  'idiom-getopt-loop': idiom(['4.1'], [
    '`getopt`（`s` なし）は組み込みの `getopts` とは別の外部コマンドで、整えた引数を表示して終わる。1つずつ読むループにはならない（組み込みは `getopts`）',
    '`getopt` (no `s`) is an external program, not the builtin `getopts`: it prints the rewritten arguments and exits, so it cannot drive a loop that reads one option at a time (the builtin is `getopts`)']),
  'idiom-getopt-args': idiom(['4.1', '3.5.4'], [
    '`getopt`（GNU/util-linux）: 引数を整えた形に書き直す（`-ab` は `-a -b` に、`--long=値` は `--long 値` に分け、最後に `--` を付ける）。あとの `case` が `$1` だけ見ればよくなる。終了ステータスを見ること（不正なオプションなら失敗する）。`local args=$(getopt …)` では失敗が隠れる',
    '`getopt` (GNU/util-linux): rewrites the arguments into a fixed form (`-ab` becomes `-a -b`, `--long=v` becomes `--long v`, and `--` ends them), so a `case` only has to look at `$1`. Check its exit status (it fails on a bad option); `local args=$(getopt …)` hides the failure']),
  'idiom-eval-set': idiom(['4.1', '4.3.1'], [
    '`eval set -- "$args"`: `getopt` が整えた引数（クォート済み）を、このスクリプトの位置パラメータ `$1 $2 …` に入れ直す。`"$args"` は必ずダブルクォートで囲む',
    '`eval set -- "$args"`: puts the arguments that `getopt` rewrote (and quoted) back into `$1 $2 …`. Keep `"$args"` in double quotes']),
  'idiom-args-loop': idiom(['3.4.1', '4.1'], [
    '引数を先頭から順に読むループ（ふつうは `case` で `$1` を調べ、最後に `shift` で1つ進める）。値をとるオプションは `shift 2` が要る。`shift` を忘れると、ループが終わらない',
    'a loop over the arguments (usually a `case` on `$1`, then `shift` to move on). An option that takes a value needs `shift 2`; without any `shift` the loop never ends']),
  'idiom-read-nul': idiom(['4.2'], [
    '`read -d \'\'`: NUL（バイト 0）までを1項目として読む。`find -print0` と組み合わせると、空白や改行を含む名前も安全に扱える。区切りは `-d \'\'` と書く（`-d \'\\0\'` では区切りが `\\` になり、何も読めない）',
    '`read -d \'\'`: reads up to a NUL byte as one item. With `find -print0`, names containing spaces or newlines are safe. Write the delimiter as `-d \'\'` (`-d \'\\0\'` makes `\\` the delimiter, and nothing is read)']),
  'idiom-find-print0': idiom(['4.2'], [
    '`find -print0`: 名前を改行でなく NUL で区切って出力する。受け取る側も NUL を読むこと（`xargs -0`、`read -d \'\'`）。改行区切りのままだと、空白や改行を含む名前が壊れる',
    '`find -print0`: separates the names with a NUL byte instead of a newline. The reader must read NUL too (`xargs -0`, `read -d \'\'`); with newlines, names containing spaces or newlines break']),
  'idiom-xargs-nul': idiom(['3.2.3'], [
    '`xargs -0`: 入力を NUL 区切りで読む（`find -print0` と組み合わせる）。付けないと、空白やクォートを含む名前が分割されたり壊れたりする',
    '`xargs -0`: reads its input separated by NUL bytes (pair it with `find -print0`). Without it, names with spaces or quotes are split or mangled']),
  'idiom-until': idiom(['3.2.5.1'], [
    '`until コマンド`: コマンドが失敗する間、くり返す（成功したら止まる。`while` の逆）。何かの準備ができるのを待つときに使う。回数や時間の上限がないと、永久に終わらないことがある',
    '`until command`: repeats while the command fails and stops when it succeeds (the opposite of `while`). Used to wait for something to be ready. With no limit on tries or time, it can run forever']),
  'idiom-mapfile': idiom(['4.2'], [
    '`mapfile`（`readarray`）: 入力の各行を配列の要素に入れる。`-t` で行末の改行を取り除く（付けないと各要素が改行で終わる）。`コマンド | mapfile` は配列が消える（サブシェルで動く）ので、`mapfile -t 配列 < <(コマンド)` と書く',
    '`mapfile` (`readarray`): reads each line of the input into an array element. `-t` strips the trailing newline (without it, each element ends with one). `command | mapfile` loses the array (it runs in a subshell); write `mapfile -t arr < <(command)`']),
  'idiom-glob-guard': idiom(['3.5.8'], [
    '存在しない名前を飛ばす。`for f in *.txt` で何にも一致しないと、bash は `*.txt` をそのまま残し、ループが存在しない名前で1回まわる。その対策（`shopt -s nullglob` でも防げる）',
    'skips a name that does not exist. When `for f in *.txt` matches nothing, bash keeps `*.txt` as it is and the loop runs once with that text. This guards against it (`shopt -s nullglob` does too)']),
  'idiom-yes-no': idiom(['4.2'], [
    'はい／いいえの確認。`[y/N]` の大文字は、Enter だけのときの既定値という慣習で、空の答えをその既定値として扱うのは続くコードの役目。`-p` の表示は、標準入力が端末のときだけ出る',
    'a yes/no question. The capital letter in `[y/N]` is only a convention for the default on a bare Enter: the code after it must treat an empty answer that way. The `-p` prompt is shown only when stdin is a terminal']),
};

/** The id of an idiom's note. */
export type IdiomId = keyof typeof IDIOM_MESSAGES;
