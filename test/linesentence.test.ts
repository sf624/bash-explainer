// The sentence of a line, "In short" (src/linesentence.ts; docs/design/panel-redesign.md, P5): what each shape of line
// says, in English and in Japanese; its rules over the corpus (every line with code has one; it says nothing a problem
// of the line says; no code span holds more than one shell word of the line; it is never a row's text alone); and the
// values it gives assignments, against bash (the argv capture's runs, test/support/argv.ts).
import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { Analyzer, type LineExplanation, type Token } from '../src/analyzer';
import { argvWords } from '../src/argvline';
import { detectShell, type Shell } from '../src/dialect';
import { explainHostedLine, extractShell, hostKind } from '../src/hosts';
import { problemSections } from '../src/linesentence';
import { jaSpaced, listSaid } from '../src/messages-sentence';
import { codeSpan } from '../src/label';
import { createUnbashParser } from '../src/syntax/adapters/unbash';
import { shellState } from '../src/semantics/state';
import { descendants, field, type SyntaxNode } from '../src/syntax/tree';
import { panelUpdate, PANEL_BODY } from '../src/ui/panelView';
import { ui } from '../src/ui/render';
import { type ArgvInput, fixtureInputs, runArgv } from './support/argv';
import { argvHolds, argvShown } from './support/argvline';
import { probeSkipReason } from './support/probe';

const parser = createUnbashParser();
const said = (src: string, line: number, lang: 'en' | 'ja', shell?: Shell): string | undefined =>
  new Analyzer(lang).explainLine(parser.parse(src), line, shell, { sentence: true }).sentence;

/** Each shape: the script, the line, the sentence in English and in Japanese (null: none), the shell when not bash. */
const SHAPES: [string, number, string | null, string | null, Shell?][] = [
    ["sort -u < in.txt > out.txt 2>> err.log", 0, "Runs `sort` (sort lines) using `-u` (output only unique lines), with stdin (fd 0) from `in.txt`, stdout (fd 1) to `out.txt`, stderr (fd 2) appended to `err.log`.", "`sort`（行を並べ替える）を実行する（標準入力(fd 0)は `in.txt` から、標準出力(fd 1)は `out.txt` へ、標準エラー出力(fd 2)は `err.log` に追記）。"],
    ["make &> log; make &>> log", 0, "Runs `make` (build targets from a Makefile), with stdout and stderr to `log`; then runs `make` (build targets from a Makefile), with stdout and stderr appended to `log`.", "`make` を実行する（標準出力と標準エラー出力は `log` へ）。続けて、`make` を実行する（標準出力と標準エラー出力は `log` に追記）。"],
    ["cat 3<&0 <&4 <<< \"$x\"", 0, "Runs `cat`, with file descriptor 3 from where stdin (fd 0) reads, stdin (fd 0) from where file descriptor 4 reads, stdin (fd 0) from the value of `$x` (a here-string).", "`cat` を実行する（ファイルディスクリプタ 3 は標準入力(fd 0)と同じところから、標準入力(fd 0)はファイルディスクリプタ 4 と同じところから、標準入力(fd 0)は `$x` の値から（ヒアストリング））。"],
    ["cat <<EOF\nhi\nEOF", 1, "Runs `cat` (concatenate files and print to stdout), with stdin (fd 0) from the here-document.", "`cat`（ファイルの内容を連結して標準出力に出す）を実行する（標準入力(fd 0)はヒアドキュメントから）。"],
    ["exec 3>&-", 0, "Runs `exec` (replace the shell with the command; without a command, apply redirections to the shell itself), with file descriptor 3 closed.", "`exec`（現在のシェルを指定したコマンドで置き換える。引数なしならリダイレクトをシェル自体に適用）を実行する（ファイルディスクリプタ 3 を閉じて）。"],
    ["f() { :; }; f a > o", 0, "Defines the function `f`, whose body runs each time it is called; then calls the function `f`, with stdout (fd 1) to `o`.", "関数 `f` を定義する。本体は呼び出されるたびに実行される。続けて、関数 `f` を呼び出す（標準出力(fd 1)は `o` へ）。"],
    ["[ -f a ] > o", 0, "Tests the condition in `[ … ]`, with stdout (fd 1) to `o`.", "`[ … ]` の条件を判定する（標準出力(fd 1)は `o` へ）。"],
    ["local x=1 y", 0, "Runs `local` (declare variables local to the current function) and sets `x` to `1`.", "`local`（関数内だけで有効なローカル変数を宣言）を実行する。`x` に `1` を代入する。"],
    ["x+=b", 0, "Sets `x` to its value followed by `b`.", "`x` に今の値のあとに `b` をつなげたものを代入する。"],
    ["x= y=\"\" z=\"$HOME\"/bin", 0, "Sets `x` to the empty string, `y` to the empty string and `z` to ‹home directory›`/bin`.", "`x` に空文字列を、`y` に空文字列を、`z` に‹ホームディレクトリ›`/bin` を代入する。"],
    ["x='a`b'", 0, "Sets `x` to ``a`b``.", "`x` に ``a`b`` を代入する。"],
    ["items=(a b c d e)", 0, "Sets `items` to an array of `a`, `b`, `c` and ….", "`items` に配列（`a`・`b`・`c`・…）を代入する。"],
    ["> f", 0, "Runs no command, only its redirections: stdout (fd 1) to `f`.", "コマンドは実行せず、リダイレクトだけを行う（標準出力(fd 1)は `f` へ）。"],
    ["x=1 > f", 0, "Sets `x` to `1`, with stdout (fd 1) to `f`.", "`x` に `1` を代入する（標準出力(fd 1)は `f` へ）。"],
    ["IFS=: read -r a b <<< \"$e\"", 0, "Runs `read` (read a line from stdin into variables), with `IFS` set to `:`, stdin (fd 0) from the value of `$e` (a here-string).", "`read`（標準入力から1行読み、変数に代入する）を実行する（`IFS` は `:`、標準入力(fd 0)は `$e` の値から（ヒアストリング））。"],
    ["exit 1", 0, "Runs `exit` (exit the shell or script) with status 1.", "`exit`（シェル（スクリプト）を終了する）を実行する（終了ステータス 1）。"],
    ["exit 256", 0, "Runs `exit` (exit the shell or script).", "`exit`（シェル（スクリプト）を終了する）を実行する。"],
    ["git log --oneline -n 5", 0, "Runs `git` `log` (show commit logs) using `--oneline` (one line per commit) and `-n` (number of commits).", "`git` `log`（コミット履歴を表示する）を `--oneline`（1コミット1行で表示）・`-n`（表示する件数）を付けて実行する。"],
    ["sed -e 's/a/b/' -e 's/c/d/' f", 0, "Runs `sed` (stream editor: edit input line by line (substitute with `s/old/new/g`)) using `-e` (add a script to run).", "`sed`（ストリームエディタ: 入力を1行ずつスクリプトで編集して出力する（置換は `s/前/後/g`））を `-e`（実行するスクリプトを指定（複数指定可））を付けて実行する。"],
    ["/opt/app --config x", 0, "Runs `/opt/app`.", "`/opt/app` を実行する。"],
    ["cp -r -p -v a b", 0, "Runs `cp` (copy files and directories).", "`cp`（ファイルやディレクトリをコピーする）を実行する。"],
    ["! false", 0, "Runs `false` (do nothing and fail (exit 1)), and negates its status.", "`false`（何もせず失敗（終了ステータス 1）を返す）を実行する（終了ステータスは反転）。"],
    ["! a | b", 0, "Pipes `a` into `b`, and negates its status; its status is that of `b`, negated.", "`a` の出力を `b` に渡す（終了ステータスは反転）。終了ステータスは `b` のものを反転したもの。"],
    ["time", 0, "Does nothing, and reports the time it takes.", "何もしない。かかった時間を表示する。"],
    ["time sleep 1", 0, "Runs `sleep` (pause for a duration), and reports the time it takes.", "`sleep`（指定した時間だけ待つ）を実行する。かかった時間を表示する。"],
    ["coproc cat", 0, "Runs `cat` (concatenate files and print to stdout) as a coprocess.", "`cat`（ファイルの内容を連結して標準出力に出す）をコプロセスとして実行する。"],
    ["{ a; b; } > f &", 0, "In the background, with stdout (fd 1) to `f`: as one group, runs `a`; then runs `b`.", "バックグラウンドで: 全体の入出力: 標準出力(fd 1)は `f` へ。1つのグループとして: `a` を実行する。続けて、`b` を実行する。"],
    ["(cd x; ls)", 0, "In a subshell, runs `cd` (change the current directory); then runs `ls` (list directory contents).", "サブシェルで: `cd`（カレントディレクトリを移動する）を実行する。続けて、`ls`（ディレクトリの中身（ファイル一覧）を表示する）を実行する。"],
    ["if a; then b; elif c; then d; else e; fi", 0, "If `a` succeeds, runs `b`; otherwise, if `c` succeeds, runs `d`; otherwise, runs `e`.", "`a` が成功したら、`b` を実行する。そうでなければ、`c` が成功したら、`d` を実行する。そうでなければ、`e` を実行する。"],
    ["if a; then b; fi", 0, "If `a` succeeds, runs `b`.", "`a` が成功したら、`b` を実行する。"],
    ["case $x in a|b) c ;; *) ;; esac", 0, "Runs the first branch whose pattern matches the value of `$x`.", "`$x` の値に最初に一致したパターンの分岐を実行する。"],
    ["f() { a; }", 0, "Defines the function `f`, whose body runs each time it is called.", "関数 `f` を定義する。本体は呼び出されるたびに実行される。"],
    ["(( i++ ))", 0, "Evaluates the arithmetic in `(( … ))`.", "`(( … ))` の算術式を評価する。"],
    ["[[ -n $x ]]", 0, "Tests the condition in `[[ … ]]`.", "`[[ … ]]` の条件を判定する。"],
    ["while :; do a; done", 0, "Repeats its body (`a`) until `break` or `exit` leaves the loop.", "`break` か `exit` で抜けるまで、本体（`a`）をくり返す。"],
    ["until a; do b; done", 0, "Repeats its body (`b`) until `a` succeeds.", "`a` が成功するまで、本体（`b`）をくり返す。"],
    ["while ! a; do b; done", 0, "Repeats its body (`b`) while the negation of `a` succeeds.", "`a` の否定が成功する間、本体（`b`）をくり返す。"],
    ["while a | b; do c; done", 0, "Repeats its body (`c`) while the pipeline of `a` and `b` succeeds.", "`a`・`b` のパイプラインが成功する間、本体（`c`）をくり返す。"],
    ["while a; b; do c; done", 0, "Repeats its body (`c`) while its condition (`a` and `b`) succeeds.", "条件（`a`・`b`）が成功する間、本体（`c`）をくり返す。"],
    ["while [[ -n $x ]]; do c; done", 0, "Repeats its body (`c`) while the test `[[ … ]]` succeeds.", "テスト `[[ … ]]` が成功する間、本体（`c`）をくり返す。"],
    ["while (( i < 3 )); do c; done", 0, "Repeats its body (`c`) while the test `(( … ))` succeeds.", "テスト `(( … ))` が成功する間、本体（`c`）をくり返す。"],
    ["while test -n \"$x\"; do c; done", 0, "Repeats its body (`c`) while `test` (evaluate a conditional expression; exit 0 if true (same as `[ ]`)) succeeds.", "`test`（条件式を評価し、真なら 0、偽なら 1 を返す（`[ ]` と同じ））が成功する間、本体（`c`）をくり返す。"],
    ["if [ -f a ]; then b; fi", 0, "If the test `[ … ]` succeeds, runs `b`.", "テスト `[ … ]` が成功したら、`b` を実行する。"],
    ["for x; do a; done", 0, "Runs its body (`a`) with `$x` set to each argument, one at a time.", "`$x` を各引数に順に設定して、本体（`a`）を実行する。"],
    ["for x in a b c d e; do :; done", 0, "Runs its body (`:`) with `$x` set to `a`, `b`, `c` and …, one at a time.", "`$x` を `a`・`b`・`c`・…に順に設定して、本体（`:`）を実行する。"],
    ["for f in *.txt; do :; done", 0, "Runs its body (`:`) with `$f` set to each file name matching `*.txt`, one at a time.", "`$f` を `*.txt` に一致する各ファイル名に順に設定して、本体（`:`）を実行する。"],
    ["for w in $(ls); do :; done", 0, "Runs its body (`:`) with `$w` set to the output of `$(ls)`, one at a time.", "`$w` を `$(ls)` の出力に順に設定して、本体（`:`）を実行する。"],
    ["e=; for x in $e; do :; done", 0, "Sets `e` to the empty string; then does not run its body (`:`): the words after `in` give none.", "`e` に空文字列を代入する。続けて、`in` の後の単語からは何も得られないので、本体（`:`）は実行されない。"],
    ["select x in \"$@\"; do :; done", 0, "Shows a menu of each argument and runs its body (`:`) with `$x` set to the choice.", "各引数のメニューを表示し、選ばれた値を `$x` に設定して本体（`:`）を実行する。"],
    ["for ((i=0;i<3;i++)); do :; done", 0, "Runs its body (`:`) while the test in `(( … ))` is true.", "`(( … ))` の条件が真の間、本体（`:`）を実行する。"],
    ["cmd || echo \"failed\" >&2", 0, "Runs `cmd`; if that fails, prints a message on stderr (`echo`).", "`cmd` を実行する。失敗したら、標準エラー出力にメッセージを出す（`echo`）。"],
    ["echo hi 1>&2", 0, "Prints a message on stderr (`echo`).", "標準エラー出力にメッセージを出す（`echo`）。"],
    ["x=1 echo hi >&2", 0, "Runs `echo` (print arguments to stdout, separated by spaces), with `x` set to `1`, stdout (fd 1) to where stderr (fd 2) goes.", "`echo`（引数を空白区切りで標準出力に表示する）を実行する（`x` は `1`、標準出力(fd 1)は標準エラー出力(fd 2)と同じ先へ）。"],
    ["echo hi >&2 2>/dev/null", 0, "Runs `echo` (print arguments to stdout, separated by spaces), with stdout (fd 1) to where stderr (fd 2) goes, stderr (fd 2) to `/dev/null`.", "`echo`（引数を空白区切りで標準出力に表示する）を実行する（標準出力(fd 1)は標準エラー出力(fd 2)と同じ先へ、標準エラー出力(fd 2)は `/dev/null` へ）。"],
    ["echo hi <<< x", 0, "Runs `echo` (print arguments to stdout, separated by spaces), with stdin (fd 0) from `x` (a here-string).", "`echo`（引数を空白区切りで標準出力に表示する）を実行する（標準入力(fd 0)は `x` から（ヒアストリング））。"],
    ["printf 'a\\n' >&2", 0, "Prints a message on stderr (`printf`).", "標準エラー出力にメッセージを出す（`printf`）。"],
    ["command -v jq >/dev/null 2>&1", 0, "Checks, printing nothing, whether a command is installed.", "コマンドがインストールされているかを、何も表示せずに確かめる。"],
    ["while read -r l; do echo \"$l\"; done < f.txt", 0, "Reads `f.txt` one line at a time, running its body (`echo`) for each line.", "`f.txt` を1行ずつ読み、行ごとに本体（`echo`）を実行する。"],
    ["while true; do sleep 1; done", 0, "Repeats its body (`sleep`) until `break` or `exit` leaves the loop.", "`break` か `exit` で抜けるまで、本体（`sleep`）をくり返す。"],
    ["sort | uniq -c | sort -rn", 0, "Counts how often each line of its input occurs and lists the lines from the most frequent, with their counts; its status is that of `sort`.", "入力の各行の出現回数を数え、多い順に回数つきで並べる。終了ステータスは `sort` のもの。"],
    ["cat f | sort | uniq -c | sort -rn | head", 0, "Counts how often each line of the output of `cat` occurs and lists the lines from the most frequent, with their counts (the first 10); its status is that of `head`.", "`cat` の出力の各行の出現回数を数え、多い順に回数つきで並べる（上位 10 行）。終了ステータスは `head` のもの。"],
    ["sort f | uniq -c | sort -nr | head -n 3", 0, "Counts how often each line of its input occurs and lists the lines from the most frequent, with their counts (the first 3); its status is that of `head`.", "入力の各行の出現回数を数え、多い順に回数つきで並べる（上位 3 行）。終了ステータスは `head` のもの。"],
    ["sort f | uniq -c | sort -nr | head -5", 0, "Counts how often each line of its input occurs and lists the lines from the most frequent, with their counts (the first lines only); its status is that of `head`.", "入力の各行の出現回数を数え、多い順に回数つきで並べる（先頭の行だけ）。終了ステータスは `head` のもの。"],
    ["sort f | uniq -c | sort -rn | tail", 0, "Pipes `sort` (sort lines) into `uniq` (collapse adjacent duplicate lines (usually after `sort`)) into `sort` (sort lines) into `tail` (print the last part of files (default 10 lines)); its status is that of `tail`.", "`sort` の出力を `uniq` に渡し、その出力を `sort` に渡し、その出力を `tail` に渡す。終了ステータスは `tail` のもの。"],
    ["sort f | uniq -c | sort -rn | head | cat", 0, "Pipes `sort` into `uniq` into `sort` into `head` into `cat`; its status is that of `cat`.", "`sort` の出力を `uniq` に渡し、その出力を `sort` に渡し、その出力を `head` に渡し、その出力を `cat` に渡す。終了ステータスは `cat` のもの。"],
    ["sort f | uniq | sort -rn", 0, "Pipes `sort` (sort lines) into `uniq` (collapse adjacent duplicate lines (usually after `sort`)) into `sort` (sort lines); its status is that of `sort`.", "`sort`（行を並べ替える）の出力を `uniq`（隣接する重複行をまとめる（通常 `sort` の後に使う））に渡し、その出力を `sort`（行を並べ替える）に渡す。終了ステータスは `sort` のもの。"],
    ["sort -u f | uniq -c | sort -rn", 0, "Pipes `sort` (sort lines) into `uniq` (collapse adjacent duplicate lines (usually after `sort`)) into `sort` (sort lines); its status is that of `sort`.", "`sort`（行を並べ替える）の出力を `uniq`（隣接する重複行をまとめる（通常 `sort` の後に使う））に渡し、その出力を `sort`（行を並べ替える）に渡す。終了ステータスは `sort` のもの。"],
    ["sort f | uniq -c | sort -n", 0, "Pipes `sort` (sort lines) into `uniq` (collapse adjacent duplicate lines (usually after `sort`)) into `sort` (sort lines); its status is that of `sort`.", "`sort`（行を並べ替える）の出力を `uniq`（隣接する重複行をまとめる（通常 `sort` の後に使う））に渡し、その出力を `sort`（行を並べ替える）に渡す。終了ステータスは `sort` のもの。"],
    ["sort f | uniq -c | sort -r", 0, "Pipes `sort` (sort lines) into `uniq` (collapse adjacent duplicate lines (usually after `sort`)) into `sort` (sort lines); its status is that of `sort`.", "`sort`（行を並べ替える）の出力を `uniq`（隣接する重複行をまとめる（通常 `sort` の後に使う））に渡し、その出力を `sort`（行を並べ替える）に渡す。終了ステータスは `sort` のもの。"],
    ["echo a & echo b", 0, "In the background, runs `echo` (print arguments to stdout, separated by spaces); then runs `echo` (print arguments to stdout, separated by spaces).", "バックグラウンドで: `echo`（引数を空白区切りで標準出力に表示する）を実行する。続けて、`echo`（引数を空白区切りで標準出力に表示する）を実行する。"],
    ["set -o pipefail\nfoo | bar", 1, "Pipes `foo` into `bar`; its status is that of the last command that fails, or 0.", "`foo` の出力を `bar` に渡す。終了ステータスは最後に失敗したコマンドのもの（なければ 0）。"],
    ["foo | bar", 0, "Pipes `foo` into `bar`; its status is that of `bar`.", "`foo` の出力を `bar` に渡す。終了ステータスは `bar` のもの。"],
    ["[[ $x ]] && set -o pipefail\nfoo | bar", 1, "Pipes `foo` into `bar`.", "`foo` の出力を `bar` に渡す。"],
    ["set -e\na && b || c", 1, "Runs `a`; if that succeeds, runs `b`; if that fails, runs `c`; under `set -e`, a command that fails before the last one does not stop the script.", "`a` を実行する。成功したら、`b` を実行する。失敗したら、`c` を実行する。`set -e` があっても、最後より前のコマンドが失敗したときはスクリプトは止まらない。"],
    ["set -e\nf() {\n  a && b\n}\nif f; then :; fi", 2, "Runs `a`; if that succeeds, runs `b`.", "`a` を実行する。成功したら、`b` を実行する。"],
    ["set -e\n(\n  false\n)", 2, "Runs `false` (do nothing and fail (exit 1)); if it fails, `set -e` stops the subshell.", "`false`（何もせず失敗（終了ステータス 1）を返す）を実行する。失敗すると `set -e` でサブシェルが止まる。"],
    ["set -e\n(\n  exit 1\n  x=1\n  true\n)", 2, "Runs `exit` (exit the shell or script) with status 1.", "`exit`（シェル（スクリプト）を終了する）を実行する（終了ステータス 1）。"],
    ["set -e\n(\n  x=1\n)", 2, "Sets `x` to `1`.", "`x` に `1` を代入する。"],
    ["set -e\n(\n  true\n)", 2, "Runs `true` (do nothing and succeed (exit 0)).", "`true`（何もせず成功（終了ステータス 0）を返す）を実行する。"],
    ["set -e\nf() {\n  false\n}", 2, "Runs `false` (do nothing and fail (exit 1)); if it fails, `set -e` stops the shell it runs in (the script or a subshell).", "`false`（何もせず失敗（終了ステータス 1）を返す）を実行する。失敗すると `set -e` でシェル（スクリプトかサブシェル）が止まる。"],
    ["set -e\ntar czf a b || echo \"failed\" >&2", 1, "Runs `tar` (create or extract tar archives); if that fails, prints a message on stderr (`echo`).", "`tar`（tar アーカイブを作成・展開する）を実行する。失敗したら、標準エラー出力にメッセージを出す（`echo`）。"],
    ["set -e\ncurl -s x | sh", 1, "Pipes `curl` (transfer data to or from a URL (HTTP requests etc.)) into `sh` (run the POSIX shell).", "`curl`（URL を指定してデータを送受信する（HTTP リクエストなど））の出力を `sh`（POSIX シェルを起動する）に渡す。"],
    ["if a\nthen\n  b\nfi", 1, "`then` continues the `if` of line 1.", "`then` は行 1 からの `if` 文の続き。"],
    ["if a; then\n  b\nelif c; then\n  d\nfi", 2, "Otherwise, if `c` succeeds, runs what follows `then`.", "そうでなければ、`c` が成功したら、`then` 以下を実行する。"],
    ["if a; then\n  b\nelif c; then d\nfi", 2, "Otherwise, if `c` succeeds, runs `d`.", "そうでなければ、`c` が成功したら、`d` を実行する。"],
    ["if a; then\n  b\nelse c\nfi", 2, "Otherwise, runs `c`.", "そうでなければ、`c` を実行する。"],
    ["if a; then\n b\nelse\n c\nfi", 2, "Otherwise, runs line 4.", "そうでなければ、行 4 を実行する。"],
    ["for x in a\ndo\n  b\ndone", 1, "`do` continues the `for` loop of line 1.", "`do` は行 1 からの `for` ループの続き。"],
    ["for x in a; do\n  b\ndone", 0, "Runs line 2 with `$x` set to `a`, one at a time.", "`$x` を `a` に順に設定して、行 2 を実行する。"],
    ["while a\ndo b; done", 1, "Runs `b`; `done` ends the `while` loop of line 1: repeats line 2 while `a` succeeds.", "`b` を実行する。`done` は行 1 からの `while` ループの終わり。`a` が成功する間、行 2 をくり返す。"],
    ["while a; do\n  b\ndone > out", 2, "`done` ends the `while` loop of line 1: repeats line 2 while `a` succeeds; the whole of the `while` loop runs with stdout (fd 1) to `out`.", "`done` は行 1 からの `while` ループの終わり。`a` が成功する間、行 2 をくり返す。`while` ループ全体の入出力: 標準出力(fd 1)は `out` へ。"],
    ["while a; do\n  b\ndone", 2, "`done` ends the `while` loop of line 1: repeats line 2 while `a` succeeds.", "`done` は行 1 からの `while` ループの終わり。`a` が成功する間、行 2 をくり返す。"],
    ["until a; do\n b\ndone", 2, "`done` ends the `until` loop of line 1: repeats line 2 until `a` succeeds.", "`done` は行 1 からの `until` ループの終わり。`a` が成功するまで、行 2 をくり返す。"],
    ["case x in\n  a)\n    b\n    ;;\nesac", 4, "`esac` ends the `case` of line 1: runs the first branch (lines 2–4) whose pattern matches `x`.", "`esac` は行 1 からの `case` 文の終わり。`x` に最初に一致したパターンの分岐（行 2〜4）を実行する。"],
    ["case x in\n  a)\n    b\n    ;;\nesac", 1, "If the value matches `a`, runs line 3.", "値が `a` に一致したら、行 3 を実行する。"],
    ["case x in\n  a)\n    b\n    ;;\nesac", 3, "`;;` ends the branch of line 2: if the value matches `a`, runs line 3.", "`;;` は行 2 からの分岐の終わり。値が `a` に一致したら、行 3 を実行する。"],
    ["case x in\n  a)\n    b ;;\nesac", 2, "Runs `b`.", "`b` を実行する。"],
    ["case x in\n  a)\n  ;;\nesac", 1, "If the value matches `a`, runs its body.", "値が `a` に一致したら、本体を実行する。"],
    ["case x in a) b ;;\nesac", 0, "Runs the first branch whose pattern matches `x`; if the value matches `a`, runs `b`.", "`x` に最初に一致したパターンの分岐を実行する。値が `a` に一致したら、`b` を実行する。"],
    ["{\n  a\n} > out", 2, "`}` ends the group of line 1: runs line 2 as one group; the whole of the group runs with stdout (fd 1) to `out`.", "`}` は行 1 からのグループの終わり。行 2 を1つのグループとして実行する。グループ全体の入出力: 標準出力(fd 1)は `out` へ。"],
    ["(\n  a\n)", 0, "Runs line 2 in a subshell.", "行 2 をサブシェルで実行する。"],
    ["(\n  a\n)", 2, "`)` ends the subshell of line 1: runs line 2 in a subshell.", "`)` は行 1 からのサブシェルの終わり。行 2 をサブシェルで実行する。"],
    ["{\n  a\n}", 0, "Runs line 2 as one group.", "行 2 を1つのグループとして実行する。"],
    ["{ a\n}", 1, "`}` ends the group of line 1: runs its body (`a`) as one group.", "`}` は行 1 からのグループの終わり。本体（`a`）を1つのグループとして実行する。"],
    ["f() {\n  a\n}", 0, "Defines the function `f` (lines 1–3), whose body runs each time it is called.", "関数 `f` を定義する（行 1〜3）。本体は呼び出されるたびに実行される。"],
    ["f() {\n  a\n}", 2, "`}` ends the function `f` of line 1.", "`}` は行 1 からの関数 `f` の終わり。"],
    ["f()\n{\n  a\n}", 1, "`{` continues the function `f` of line 1.", "`{` は行 1 からの関数 `f` の続き。"],
    ["for ((i=0;i<3;i++)); do\n a\ndone", 0, "Runs line 2 while the test in `(( … ))` is true.", "`(( … ))` の条件が真の間、行 2 を実行する。"],
    ["for ((i=0;i<3;i++)); do\n a\ndone", 2, "`done` ends the `for` loop of line 1: runs line 2 while the test in `(( … ))` is true.", "`done` は行 1 からの `for` ループの終わり。`(( … ))` の条件が真の間、行 2 を実行する。"],
    ["select x in a b; do\n a\ndone", 0, "Shows a menu of `a` and `b` and runs line 2 with `$x` set to the choice.", "`a`・`b` のメニューを表示し、選ばれた値を `$x` に設定して行 2 を実行する。"],
    ["select x in a b; do\n a\ndone", 2, "`done` ends the `select` loop of line 1: shows a menu of `a` and `b` and runs line 2 with `$x` set to the choice.", "`done` は行 1 からの `select` ループの終わり。`a`・`b` のメニューを表示し、選ばれた値を `$x` に設定して行 2 を実行する。"],
    ["(( x =\n 1 ))", 1, "Evaluates the arithmetic in `(( … ))`.", "`(( … ))` の算術式を評価する。"],
    ["cat f | while read l; do\n  echo \"$l\"\ndone", 0, "Pipes `cat` into a `while` loop (lines 1–3); the `while` loop runs in a subshell: repeats line 2 while `read` succeeds; its status is that of the `while` loop.", "`cat` の出力を `while` ループ（行 1〜3）に渡す。`while` ループはサブシェルで実行される。`read` が成功する間、行 2 をくり返す。終了ステータスは `while` ループのもの。"],
    ["a &&\n  b", 1, "Runs `a`; if that succeeds, runs `b`.", "`a` を実行する。成功したら、`b` を実行する。"],
    ["# just a comment", 0, null, null],
    ["", 0, null, null],
    ["x=a\ncat < $x", 1, "Runs `cat` (concatenate files and print to stdout), with stdin (fd 0) from `a`.", "`cat`（ファイルの内容を連結して標準出力に出す）を実行する（標準入力(fd 0)は `a` から）。"],
    ["x=\"a b\"\ncat < $x", 1, "Runs `cat` (concatenate files and print to stdout), with stdin (fd 0) from the words of `$x`.", "`cat`（ファイルの内容を連結して標準出力に出す）を実行する（標準入力(fd 0)は `$x` から得られる単語から）。"],
    ["name=${1,,}", 0, "Sets `name` to what `${1,,}` gives.", "`name` に `${1,,}` の結果を代入する。", "sh"],
    ["docker run --rm -it -v \"$PWD\":/app -p 8080:80 -e A=1 nginx", 0, "Runs `docker` `run` (run a new container).", "`docker` `run`（イメージから新しいコンテナを起動する）を実行する。"],
    ["grep -rn \"ERROR $USER\" ./src 2>&1 | sort -u > errors.txt && echo \"done: $(date +%F)\" || exit 1", 0, "Pipes `grep` into `sort`; if that succeeds, runs `echo`; if that fails, runs `exit` with status 1.", "`grep` の出力を `sort` に渡す。成功したら、`echo` を実行する。失敗したら、`exit` を実行する（終了ステータス 1）。"],
    ["IFS=: read -r user _ uid gid rest <<< \"$entry\"", 0, "Runs `read` (read a line from stdin into variables), with `IFS` set to `:`, stdin (fd 0) from the value of `$entry` (a here-string).", "`read`（標準入力から1行読み、変数に代入する）を実行する（`IFS` は `:`、標準入力(fd 0)は `$entry` の値から（ヒアストリング））。"],
    ["if a; then\n  b\nfi", 2, "`fi` ends the `if` of line 1: if `a` succeeds, runs what follows `then`.", "`fi` は行 1 からの `if` 文の終わり。`a` が成功したら、`then` 以下を実行する。"],
    ["if [ -f a ]; then\n  b\nfi", 2, "`fi` ends the `if` of line 1: if the test `[ … ]` succeeds, runs what follows `then`.", "`fi` は行 1 からの `if` 文の終わり。テスト `[ … ]` が成功したら、`then` 以下を実行する。"],
    ["x='a``b'", 0, "Sets `x` to ```a``b```.", "`x` に ```a``b``` を代入する。"],
    ["case x in\n  a) b ;;\nesac", 0, "Runs the first branch (line 2) whose pattern matches `x`.", "`x` に最初に一致したパターンの分岐（行 2）を実行する。"],
    ["if a; then\n  # c\n  b\nfi", 1, null, null],
    ["case x in\n  a) ;;\nesac", 1, "If the value matches `a`, does nothing.", "値が `a` に一致したら、何もしない。"],
    ["cat f | { sort; }", 0, "Pipes `cat` (concatenate files and print to stdout) into a group; the group runs in a subshell: runs `sort` (sort lines); its status is that of the group.", "`cat`（ファイルの内容を連結して標準出力に出す）の出力をグループに渡す。グループはサブシェルで実行される。`sort`（行を並べ替える）を実行する。終了ステータスはグループのもの。"],
    ["for x in a; do { b; }; done", 0, "Runs its body (the group) with `$x` set to `a`, one at a time.", "`$x` を `a` に順に設定して、本体（グループ）を実行する。"],
    ["a=()", 0, "Sets `a` to an empty array.", "`a` に空の配列を代入する。"],
    ["set -e\n(\n  a && b\n)", 2, "Runs `a`; if that succeeds, runs `b`; under `set -e`, a command that fails before the last one does not stop the shell.", "`a` を実行する。成功したら、`b` を実行する。`set -e` があっても、最後より前のコマンドが失敗したときはシェルは止まらない。"],
    ["sort f | uniq -c | sort -rn | head -n \"$n\"", 0, "Counts how often each line of its input occurs and lists the lines from the most frequent, with their counts (the first lines only); its status is that of `head`.", "入力の各行の出現回数を数え、多い順に回数つきで並べる（先頭の行だけ）。終了ステータスは `head` のもの。"],
    ["e=; cat < $e", 0, "Sets `e` to the empty string; then runs `cat` (concatenate files and print to stdout), with stdin (fd 0) from the words of `$e`.", "`e` に空文字列を代入する。続けて、`cat`（ファイルの内容を連結して標準出力に出す）を実行する（標準入力(fd 0)は `$e` から得られる単語から）。"],
    ["local x={a,b}", 0, "Runs `local` (declare variables local to the current function) and sets `x` to the words of `x={a,b}`.", "`local`（関数内だけで有効なローカル変数を宣言）を実行する。`x` に `x={a,b}` から得られる単語を代入する。"],
    ["local x=", 0, "Runs `local` (declare variables local to the current function) and sets `x` to the empty string.", "`local`（関数内だけで有効なローカル変数を宣言）を実行する。`x` に空文字列を代入する。"],
    ["declare -i n=1+1", 0, "Runs `declare` (declare variables and set attributes) using `-i` (treat as integer (arithmetic on assignment)) and sets `n` to what `1+1` gives.", "`declare`（変数を宣言し、属性を設定する）を `-i`（整数として扱う（代入時に算術評価））を付けて実行する。`n` に `1+1` の結果を代入する。"],
    ["declare -i n\nn=1+1", 1, "Sets `n` to what `1+1` gives.", "`n` に `1+1` の結果を代入する。"],
    ["a=(1 2)\na=(3)", 1, "Sets `a` to an array of `3`.", "`a` に配列（`3`）を代入する。"],
    ["declare -a a=(1 2)", 0, "Runs `declare` (declare variables and set attributes) using `-a` (declare an indexed array) and sets `a` to an array of `1` and `2`.", "`declare`（変数を宣言し、属性を設定する）を `-a`（インデックス配列として宣言）を付けて実行する。`a` に配列（`1`・`2`）を代入する。"],
    ["!", 0, "Does nothing, and negates its status.", "何もしない（終了ステータスは反転）。"],
    ["a &&", 0, "Runs `a`.", "`a` を実行する。"],
    ["for", 0, "Runs its body with `$` set to each argument, one at a time.", "`$` を各引数に順に設定して、本体を実行する。"],
    ["select", 0, "Shows a menu of each argument and runs its body with `$` set to the choice.", "各引数のメニューを表示し、選ばれた値を `$` に設定して本体を実行する。"],
    ["coproc", 0, "Does nothing.", "何もしない。"],
    ["cat f | while read l; do echo \"$l\"; done", 0, "Pipes `cat` into a `while` loop; the `while` loop runs in a subshell: repeats its body (`echo`) while `read` succeeds; its status is that of the `while` loop.", "`cat`（ファイルの内容を連結して標準出力に出す）の出力を `while` ループに渡す。`while` ループはサブシェルで実行される。`read`（標準入力から1行読み、変数に代入する）が成功する間、本体（`echo`）をくり返す。終了ステータスは `while` ループのもの。"],
    ["cat f | while read l; do\n  echo \"$l\"\ndone | sort", 2, "`done` ends the `while` loop of line 1: repeats line 2 while `read` succeeds; pipes its output into `sort` (sort lines).", "`done` は行 1 からの `while` ループの終わり。`read` が成功する間、行 2 をくり返す。その出力を `sort`（行を並べ替える）に渡す。"],
    ["cat f | while read l; do\n  echo \"$l\"\ndone", 1, "Runs `echo` (print arguments to stdout, separated by spaces).", "`echo`（引数を空白区切りで標準出力に表示する）を実行する。"],
    ["a |\n  while read l; do\n    b\n  done", 1, "Repeats line 3 while `read` (read a line from stdin into variables) succeeds.", "`read`（標準入力から1行読み、変数に代入する）が成功する間、行 3 をくり返す。"],
    ["{ a; b; } | sort", 0, "Pipes a group into `sort` (sort lines); the group runs in a subshell: runs `a`; then runs `b`; its status is that of `sort`.", "グループの出力を `sort`（行を並べ替える）に渡す。グループはサブシェルで実行される。`a` を実行する。続けて、`b` を実行する。終了ステータスは `sort` のもの。"],
    ["{\n  a\n} | sort", 0, "Pipes a group (lines 1–3) into `sort`; the group runs in a subshell: runs line 2; its status is that of `sort`.", "グループ（行 1〜3）の出力を `sort` に渡す。グループはサブシェルで実行される。行 2 を実行する。終了ステータスは `sort` のもの。"],
    ["{\n  a\n} | sort", 2, "`}` ends the group of line 1: runs line 2 as one group; pipes its output into `sort` (sort lines).", "`}` は行 1 からのグループの終わり。行 2 を1つのグループとして実行する。その出力を `sort`（行を並べ替える）に渡す。"],
    ["{\n  a\n} |\n  sort", 3, "Runs `sort` (sort lines).", "`sort`（行を並べ替える）を実行する。"],
    ["( a; b ) | sort", 0, "Pipes a subshell into `sort` (sort lines); the subshell runs `a`; then runs `b`; its status is that of `sort`.", "サブシェルの出力を `sort`（行を並べ替える）に渡す。サブシェルは、`a` を実行する。続けて、`b` を実行する。終了ステータスは `sort` のもの。"],
    ["cat f | if a; then b; fi", 0, "Pipes `cat` (concatenate files and print to stdout) into an `if`; the `if` runs in a subshell: if `a` succeeds, runs `b`; its status is that of the `if`.", "`cat`（ファイルの内容を連結して標準出力に出す）の出力を `if` 文に渡す。`if` 文はサブシェルで実行される。`a` が成功したら、`b` を実行する。終了ステータスは `if` 文のもの。"],
    ["while read -r l; do echo; done < f | sort", 0, "Pipes a `while` loop into `sort` (sort lines); the `while` loop runs in a subshell: reads `f` one line at a time, running its body (`echo`) for each line; its status is that of `sort`.", "`while` ループの出力を `sort`（行を並べ替える）に渡す。`while` ループはサブシェルで実行される。`f` を1行ずつ読み、行ごとに本体（`echo`）を実行する。終了ステータスは `sort` のもの。"],
    ["shopt -s lastpipe\ncat f | while read l; do\n  echo\ndone", 1, "Pipes `cat` into a `while` loop (lines 2–4); the `while` loop runs in the shell itself (`lastpipe`): repeats line 3 while `read` succeeds; its status is that of the `while` loop.", "`cat` の出力を `while` ループ（行 2〜4）に渡す。`while` ループは（`lastpipe` で）シェル自体で実行される。`read` が成功する間、行 3 をくり返す。終了ステータスは `while` ループのもの。"],
    ["[ -n \"$x\" ] && shopt -s lastpipe\ncat f | { b; }", 1, "Pipes `cat` (concatenate files and print to stdout) into a group; the group runs in a subshell, or in the shell itself with `lastpipe`: runs `b`; its status is that of the group.", "`cat`（ファイルの内容を連結して標準出力に出す）の出力をグループに渡す。グループはサブシェルで実行される（`lastpipe` が有効ならシェル自体で）。`b` を実行する。終了ステータスはグループのもの。"],
    ["cat f | while read l; do echo; done &", 0, "In the background, pipes `cat` into a `while` loop; the `while` loop runs in a subshell: repeats its body (`echo`) while `read` succeeds.", "バックグラウンドで: `cat` の出力を `while` ループに渡す。`while` ループはサブシェルで実行される。`read` が成功する間、本体（`echo`）をくり返す。"],
    ["while read -r l; do\n  echo\ndone < input.txt", 2, "`done` ends the `while` loop of line 1: reads `input.txt` one line at a time, running line 2 for each line.", "`done` は行 1 からの `while` ループの終わり。`input.txt` を1行ずつ読み、行ごとに行 2 を実行する。"],
    ["while :; do\n  a\ndone > log", 2, "`done` ends the `while` loop of line 1: repeats line 2 until `break` or `exit` leaves the loop; the whole of the `while` loop runs with stdout (fd 1) to `log`.", "`done` は行 1 からの `while` ループの終わり。`break` か `exit` で抜けるまで、行 2 をくり返す。`while` ループ全体の入出力: 標準出力(fd 1)は `log` へ。"],
    ["for x in; do :; done", 0, "Does not run its body (`:`): the words after `in` give none.", "`in` の後の単語からは何も得られないので、本体（`:`）は実行されない。"],
    ["e=; select x in $e; do :; done", 0, "Sets `e` to the empty string; then does not run its body (`:`): the words after `in` give none.", "`e` に空文字列を代入する。続けて、`in` の後の単語からは何も得られないので、本体（`:`）は実行されない。"],
    ["exec >&- <&- 3>&- 2>&1 4>&5-", 0, "Runs `exec`, with stdout (fd 1) closed, stdin (fd 0) closed, file descriptor 3 closed, stderr (fd 2) to where stdout (fd 1) goes, file descriptor 5 moved to file descriptor 4.", "`exec` を実行する（標準出力(fd 1)を閉じて、標準入力(fd 0)を閉じて、ファイルディスクリプタ 3 を閉じて、標準エラー出力(fd 2)は標準出力(fd 1)と同じ先へ、ファイルディスクリプタ 5 はファイルディスクリプタ 4 に移す）。"],
    ["cat 5<>f", 0, "Runs `cat` (concatenate files and print to stdout), with file descriptor 5 open on `f` for reading and writing.", "`cat`（ファイルの内容を連結して標準出力に出す）を実行する（ファイルディスクリプタ 5 は `f` を読み書き両用で開く）。"],
    ["a=$((1+2)) b=$(ls) c=<(x)", 0, "Sets `a` to `3`, `b` to the output of `$(ls)` and `c` to the file name of `<(x)`.", "`a` に `3` を、`b` に `$(ls)` の出力を、`c` に `<(x)` のファイル名を代入する。"],
    ["now=`date`", 0, "Sets `now` to the output of `` `date` ``.", "`now` に `` `date` `` の出力を代入する。"],
    ["export PATH=/x:$PATH", 0, "Runs `export` (export variables so child processes inherit them) and sets `PATH` to `/x:`‹value of `$PATH`›.", "`export`（変数を環境変数としてエクスポートし、子プロセスにも引き継ぐ）を実行する。`PATH` に `/x:`‹`$PATH` の値›を代入する。"],
    ["if a\nthen b; else c\nfi", 1, "Runs `b`; otherwise, runs `c`.", "`b` を実行する。そうでなければ、`c` を実行する。"],
    ["case x in a) b ;; c) d ;;\nesac", 0, "Runs the first branch whose pattern matches `x`; if the value matches `a`, runs `b`; if the value matches `c`, runs `d`.", "`x` に最初に一致したパターンの分岐を実行する。値が `a` に一致したら、`b` を実行する。値が `c` に一致したら、`d` を実行する。"],
    ["e=\na=($e)", 1, "Sets `a` to an empty array.", "`a` に空の配列を代入する。"],
    ["e=\nfor x in $e a; do :; done", 1, "Runs its body (`:`) with `$x` set to `a`, one at a time.", "`$x` を `a` に順に設定して、本体（`:`）を実行する。"],
];

/** The files of the corpus: sample.sh and the other fixtures, the host files with their shell parts. */
function corpus(): { name: string; text: string; tree: ReturnType<typeof parser.parse>; explain: (line: number, lang: 'en' | 'ja') => LineExplanation | undefined }[] {
  const dir = path.join(__dirname, 'fixtures');
  const files = [...['sample.sh', 'posix.sh', 'ksh.ksh', 'coverage.sh', 'renderings.sh'].map((f) => path.join(dir, f)), ...fs.readdirSync(path.join(dir, 'hosts')).sort().map((f) => path.join(dir, 'hosts', f))];
  return files.map((file) => {
    const text = fs.readFileSync(file, 'utf8');
    const kind = hostKind('', file, text);
    const extracted = kind ? extractShell(kind, text) : undefined;
    const tree = parser.parse(extracted ? extracted.text : text);
    const lines = text.split('\n');
    const analyzers = { en: new Analyzer('en'), ja: new Analyzer('ja') };
    return {
      name: path.relative(dir, file), text: extracted ? extracted.text : text, tree,
      explain: (line, lang) => (extracted
        ? explainHostedLine(analyzers[lang], tree, extracted, lines, line, lang, undefined, { sentence: true })
        : analyzers[lang].explainLine(tree, line, detectShell(text, file), { sentence: true })),
    };
  });
}

/** The code spans of a marked text, without their fences. */
const codeSpans = (text: string): string[] => [...text.matchAll(/(`+)(.+?)\1/g)].map((m) => m[2].replace(/^ (.*) $/, '$1'));

/** The nodes that are one shell word each (with no word above them). */
const WORDS = new Set(['word', 'concatenation', 'string', 'raw_string', 'ansi_c_string', 'translated_string', 'number', 'extglob_pattern', 'regex',
  'brace_expression', 'simple_expansion', 'expansion', 'command_substitution', 'process_substitution', 'arithmetic_expansion', 'variable_assignment', 'test_operator',
  'heredoc_start', 'heredoc_body']);

/**
 * The shell words and the tokens between them (operators, keywords) on a line, as offsets: a code span of the sentence
 * that is a stretch of the line lies in one of them.
 */
function unitsOn(root: SyntaxNode, line: number): [number, number][] {
  const out: [number, number][] = [];
  const visit = (n: SyntaxNode): void => {
    if (n.endPosition.row < line || n.startPosition.row > line || n.type === 'comment') return;
    if (WORDS.has(n.type) || !n.children.length) out.push([n.startIndex, n.endIndex]);
    else n.children.forEach(visit);
  };
  visit(root);
  return out;
}

/** Whether `span` holds more than one shell word of the line: no place of it in the line lies within one unit. */
function retypes(span: string, text: string, root: SyntaxNode, line: number): boolean {
  const start = text.split('\n').slice(0, line).reduce((a, l) => a + l.length + 1, 0);
  const lineText = text.split('\n')[line];
  const units = unitsOn(root, line);
  const places: number[] = [];
  for (let i = lineText.indexOf(span); i >= 0; i = lineText.indexOf(span, i + 1)) places.push(start + i);
  return places.length > 0 && places.every((a) => units.filter(([s, e]) => s < a + span.length && a < e).length > 1);
}

const plainText = (t: string): string => t.replace(/[.。]$/, '').replace(/`/g, '').toLowerCase();
const rowTexts = (items: readonly Token[]): string[] => items.flatMap((t) => [t.explanation, t.summary ?? '', ...rowTexts(t.children)]);
/** Where a code span touches a kana or a kanji with no space, and Japanese words with a space between them. */
const letter = /[ぁ-ゖァ-ヺー一-鿿]/;

describe('the sentence of a line, "In short" (src/linesentence.ts)', function () {
  this.timeout(60000);

  it('says each shape of line, in English and in Japanese', () => {
    for (const [src, line, en, ja, shell] of SHAPES) {
      assert.deepStrictEqual([said(src, line, 'en', shell) ?? null, said(src, line, 'ja', shell) ?? null], [en, ja], `${JSON.stringify(src)}:${line}`);
    }
  });

  it('is a field of the explanation only when it is asked for, and not of a string read as a script', () => {
    const tree = parser.parse("sort f\nbash -c 'ls\nwc'");
    assert.strictEqual(new Analyzer('en').explainLine(tree, 0).sentence, undefined);
    assert.strictEqual(new Analyzer('en').explainLine(tree, 0, undefined, { sentence: true }).sentence, 'Runs `sort` (sort lines).');
    // (The line of the string says the command that reads it.)
    assert.strictEqual(new Analyzer('en').explainLine(tree, 2, undefined, { sentence: true }).sentence, 'Runs `bash` (run the bash shell (a script or a command string)).');
  });

  it('reads the sections of the problems of a line: a fact\'s, a style check\'s, none for a dialect issue or a plain note', () => {
    const sections = (src: string, shell?: Shell) => [...problemSections(new Analyzer('en').explainLine(parser.parse(src), 0, shell))].sort();
    assert.deepStrictEqual(sections('set -e; cmd || echo failed >&2'), ['3.2.4', '3.3', '4.3.1']);
    assert.deepStrictEqual(sections('rm -rf $d/'), ['3.5.3', '3.5.7', '3.5.8']);
    assert.deepStrictEqual(sections('[[ a ]]', 'sh'), []);
    assert.deepStrictEqual(sections('set -euo pipefail'), []);
  });

  it('spaces code from Japanese, and lists items in both languages', () => {
    assert.deepStrictEqual([jaSpaced('`a`を``b`c``に`d'), jaSpaced('`a`'), listSaid('en', ['a', 'b', 'c']), listSaid('ja', ['a', 'b'])],
      ['`a` を ``b`c`` に`d', '`a`', 'a, b and c', 'a・b']);
  });

  it('says a host\'s problems not again: a pipeline without pipefail in a Dockerfile, a bats test', () => {
    const text = 'FROM alpine\nRUN curl -s x | tar -x\n';
    const extracted = extractShell(hostKind('', 'Dockerfile', text)!, text);
    const tree = parser.parse(extracted.text);
    const ex = explainHostedLine(new Analyzer('en'), tree, extracted, text.split('\n'), 1, 'en', undefined, { sentence: true })!;
    assert.ok(ex.notes.some((n) => /pipefail/.test(n)), ex.notes.join('\n'));
    assert.strictEqual(ex.sentence, 'Pipes `curl` (transfer data to or from a URL (HTTP requests etc.)) into `tar` (create or extract tar archives).');
    const bats = '@test "a" {\n  run true\n}\n@test "b" { true; }\n';
    const bx = extractShell(hostKind('', 't.bats', bats)!, bats);
    const bt = parser.parse(bx.text);
    const test = (line: number, lang: 'en' | 'ja', sentence = true) => explainHostedLine(new Analyzer(lang), bt, bx, bats.split('\n'), line, lang, undefined, { sentence })!.sentence;
    assert.deepStrictEqual([test(0, 'en'), test(0, 'ja'), test(3, 'en'), test(0, 'en', false)], [
      'Defines a bats test (lines 1–3), whose body bats runs in a process of its own.',
      'bats のテストを定義する（行 1〜3）。bats はテストごとに別のプロセスで本体を実行する。',
      'Defines a bats test, whose body bats runs in a process of its own.',
      undefined,
    ]);
  });

  it('is drawn at the top of the Meaning view, with its label', () => {
    assert.ok(/<main id="main">\s*<p id="short" hidden><\/p>\s*<div id="notes">/.test(PANEL_BODY));
    const explanation = new Analyzer('ja').explainLine(parser.parse('sort f'), 0, undefined, { sentence: true });
    const msg = panelUpdate({ lang: 'ja', explanation, file: 'a.sh', line: 0, lineText: 'sort f', choice: {}, placement: 'bottom', animations: false });
    assert.deepStrictEqual([msg.explanation.sentence, msg.labels.inShort, ui.en.panel.inShort], ['`sort`（行を並べ替える）を実行する。', 'ひとことで', 'In short']);
  });

  it('says every line of the snippets of the tests, and of lines cut while they are typed, without failing', () => {
    const snippets = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'snippets.json'), 'utf8')) as string[];
    const sample = fs.readFileSync(path.join(__dirname, 'fixtures', 'sample.sh'), 'utf8').split('\n');
    const typed = ['!', 'a &&', 'a ||', 'a |', 'for', 'select', 'coproc', 'if a; then', 'case x in a)', 'x=$(', 'f() {', ...sample.flatMap((l) => [l.slice(0, l.length >> 1), l.slice(0, -1)])];
    let lines = 0;
    for (const src of [...snippets, ...typed]) {
      const tree = parser.parse(src);
      src.split('\n').forEach((_, i) => {
        for (const lang of ['en', 'ja'] as const) {
          new Analyzer(lang).explainLine(tree, i, undefined, { sentence: true });
          lines++;
        }
      });
    }
    assert.ok(lines > 5000, String(lines));
  });

  describe('over the corpus (sample.sh and the fixtures), in both languages', () => {
    const files = corpus();

    it('gives every line with code a sentence', () => {
      const missing: string[] = [];
      let lines = 0;
      for (const f of files) {
        f.text.split('\n').forEach((_, i) => {
          for (const lang of ['en', 'ja'] as const) {
            const ex = f.explain(i, lang);
            if (!ex?.items.some((t) => t.kind !== 'comment' && t.kind !== 'shebang')) continue;
            lines++;
            if (!ex.sentence) missing.push(`${f.name}:${i + 1} ${lang}`);
          }
        });
      }
      assert.deepStrictEqual(missing, []);
      assert.ok(lines > 700, String(lines));
    });

    it('says nothing a problem of the line says: no status where a problem is about it, no `set -e` where one is about it', () => {
      const found: string[] = [];
      let checked = 0;
      for (const f of files) {
        f.text.split('\n').forEach((_, i) => {
          for (const lang of ['en', 'ja'] as const) {
            const ex = f.explain(i, lang);
            if (!ex?.sentence) continue;
            const sections = problemSections(ex);
            if (sections.has('4.3.1') && ex.sentence.includes('`set -e`')) found.push(`${f.name}:${i + 1} ${lang}: ${ex.sentence}`);
            if (sections.has('3.2.3') && /its status is|終了ステータスは.*のもの/.test(ex.sentence)) found.push(`${f.name}:${i + 1} ${lang}: ${ex.sentence}`);
            if (sections.has('4.3.1') || sections.has('3.2.3')) checked++;
          }
        });
      }
      assert.deepStrictEqual(found, []);
      assert.ok(checked > 10, String(checked));
    });

    it('never retypes the line: no code span holds more than one shell word of it', () => {
      const found: string[] = [];
      for (const f of files) {
        f.text.split('\n').forEach((_, i) => {
          for (const lang of ['en', 'ja'] as const) {
            const s = f.explain(i, lang)?.sentence;
            for (const span of s ? codeSpans(s) : []) if (retypes(span, f.text, f.tree.root, i)) found.push(`${f.name}:${i + 1}: ${span}`);
          }
        });
      }
      assert.deepStrictEqual(found, []);
      // (The check finds a stretch of two words.)
      const t = parser.parse('grep -rn x f | sort');
      assert.deepStrictEqual([retypes('grep -rn', t.text, t.root, 0), retypes('-rn', t.text, t.root, 0), retypes('f | sort', t.text, t.root, 0), retypes('zz', t.text, t.root, 0)], [true, false, true, false]);
    });

    it('never says what a row of the line says alone', () => {
      const found: string[] = [];
      for (const f of files) {
        f.text.split('\n').forEach((_, i) => {
          for (const lang of ['en', 'ja'] as const) {
            const ex = f.explain(i, lang);
            if (ex?.sentence && [ex.summary, ...rowTexts(ex.items)].some((r) => plainText(r) === plainText(ex.sentence!))) found.push(`${f.name}:${i + 1} ${lang}`);
          }
        });
      }
      assert.deepStrictEqual(found, []);
    });

    it('writes Japanese after docs/japanese-style.md: a space between code and Japanese and after a line number, none before a particle', () => {
      const found: string[] = [];
      for (const f of files) {
        f.text.split('\n').forEach((_, i) => {
          const s = f.explain(i, 'ja')?.sentence;
          if (!s) return;
          const parts = s.split(/(`+.+?`+)/);
          const glued = parts.some((p, k) => k % 2 === 1 && (letter.test(parts[k - 1].slice(-1)) || letter.test(parts[k + 1].charAt(0))));
          const number = parts.some((p, k) => k % 2 === 0 && /行 \d+(〜\d+)?[ぁ-ゖァ-ヺー一-鿿]/.test(p));
          if (glued || number || /[ぁ-ゖァ-ヺー一-鿿] [をにがはの]/.test(s)) found.push(`${f.name}:${i + 1}: ${s}`);
        });
      }
      assert.deepStrictEqual(found, []);
    });
  });

  describe('the values it gives assignments, against bash', function () {
    this.timeout(300000);
    if (probeSkipReason) {
      it.skip(`needs bash 5.2 or later: ${probeSkipReason}`, () => undefined);
      return;
    }

    it('gives the value bash gives, with a fixed HOME and the commands stubbed (`date` prints nothing)', async () => {
      // Each assignment with no command, a statement of its own, gets `: MARK "${x}"` after it, whose argv the capture records.
      const MARK = '__sentence_value__';
      const marked: { input: ArgvInput; original: ArgvInput; marks: { line: number; names: string[]; values: (SyntaxNode | undefined)[] }[] }[] = [];
      for (const original of fixtureInputs().filter((x) => !x.name.startsWith('hosts/'))) {
        const assignments = descendants(original.tree.root, ['command']).filter((c) => !field(c, 'name') && c.namedChildren.length
          && c.namedChildren.every((a) => a.type === 'variable_assignment' && field(a, 'value')?.type !== 'array' && !a.children.some((x) => x.type === '+=') && field(a, 'name')!.type === 'variable_name')
          && ['program', 'compound_statement', 'do_group', 'else_clause', 'case_item', 'subshell'].includes(c.parent!.type)
          && c.parent!.children[c.parent!.children.indexOf(c) + 1]?.type !== '&');
        if (!assignments.length) continue;
        let text = original.tree.text;
        for (const c of [...assignments].reverse()) {
          text = `${text.slice(0, c.endIndex)}; : ${MARK} ${c.namedChildren.map((a) => `"\${${field(a, 'name')!.text}}"`).join(' ')}${text.slice(c.endIndex)}`;
        }
        const tree = parser.parse(text);
        marked.push({
          input: { name: `${original.name} (values)`, tree, model: shellState(tree, 'bash'), provided: [] }, original,
          marks: assignments.map((c) => ({ line: c.startPosition.row, names: c.namedChildren.map((a) => field(a, 'name')!.text), values: c.namedChildren.map((a) => field(a, 'value')) })),
        });
      }
      const plans = await runArgv(marked.map((m) => m.input), { jobs: 2 });
      const found: string[] = [];
      let checked = 0;
      for (const p of plans) {
        const { original, marks } = marked.find((m) => m.input === p.input)!;
        const colons = p.inst.markers.filter((m) => m.words[1]?.text === MARK);
        assert.strictEqual(colons.length, marks.length, p.input.name);
        colons.forEach((m, k) => {
          const mark = marks[k];
          const words = mark.values.map((v) => (v ? argvWords(v, original.model, 'en') : []));
          for (const run of p.run.records.get(m.id) ?? []) {
            words.forEach((w, j) => {
              checked++;
              const expected = w.length ? w : [{ from: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } }, parts: [{ text: '' }] }];
              if (!argvHolds(expected, [run[j + 2]])) found.push(`${p.input.name}:${mark.line + 1} (${p.env}): ${mark.names[j]} is ${argvShown(expected)}, bash: ${JSON.stringify(run[j + 2])}`);
            });
          }
          // (And the sentence says the text of each value as code.)
          const sentence = new Analyzer('en').explainLine(original.tree, mark.line, undefined, { sentence: true }).sentence!;
          for (const part of words.flat().flatMap((w) => w.parts)) {
            if ('text' in part && part.text && part.text.length < 40 && !/[\n`]/.test(part.text) && !sentence.includes(codeSpan(part.text))) found.push(`${original.name}:${mark.line + 1}: ${sentence} lacks ${part.text}`);
          }
        });
      }
      assert.deepStrictEqual(found, []);
      assert.ok(checked > 40, String(checked));
    });
  });
});
