# Bash Explain

**bash スクリプトを1行ずつ解説** — シェルスクリプト版の [regex101](https://regex101.com/) です。

カーソルを置いた行を、コマンド・オプション・リダイレクト・変数展開などに分解して、それぞれが何をしているかを解説します。

[English README](README.md)

![Bash Explain デモ](images/demo.gif)

## 例

```bash
grep -rn "ERROR $USER" ./src 2>&1 | sort -u > errors.txt
```

```text
grep -rn "ERROR $USER" ./src 2>&1 | sort -u > errors.txt — 入出力のリダイレクト: … 全体の入出力を切り替える
├─ grep -rn "ERROR $USER" ./src 2>&1 | sort -u — パイプライン: 各コマンドの標準出力を次のコマンドの標準入力につなぐ
│  ├─ grep -rn "ERROR $USER" ./src 2>&1 — パターン（正規表現）に一致する行を検索して表示する
│  │  ├─ -rn — 短いオプション -r -n をまとめて指定
│  │  │  ├─ -r — ディレクトリ内を再帰的に検索
│  │  │  └─ -n — 行番号を表示
│  │  ├─ "ERROR $USER" — 検索パターン（正規表現）
│  │  │  └─ $USER — ログインユーザー名
│  │  ├─ ./src — 検索対象のファイル（省略時は標準入力）
│  │  └─ 2>&1 — 標準エラー出力(fd 2)を標準出力(fd 1)と同じ出力先に向ける
│  ├─ | — パイプ: 左のコマンドの標準出力を右のコマンドの標準入力に渡す
│  └─ sort -u — 行を並べ替える
│     └─ -u — 重複行を1つにまとめる
└─ > errors.txt — 標準出力(fd 1)をファイル errors.txt に書き込む（既存の内容は上書き）
```

## 特長

- **コマンドとオプション** — 結合オプション（`-rn`）、値付きオプション（`-o pipefail`, `--include=*.sh`）、各引数の役割。約120のコマンド・ビルトインに対応（`grep`, `sed`, `awk`, `find`, `xargs`, `curl`, `tar`, `git`, `docker` …）
- **入れ子のコマンド** — サブコマンド（`git commit`）や、他のコマンドから実行されるコマンド（`sudo`, `xargs`, `env`, `find -exec`）
- **演算子とリダイレクト** — `|`, `&&`, `||`, `;`, `&`, `>`, `>>`, `2>&1`, `&>`, `>/dev/null`、ヒアドキュメント、ヒアストリング
- **展開** — `${var:-default}`, `${file%.sh}`, `${#array[@]}`, `$?`, `$@`, `$(…)`, `<(…)`, `$((…))`。パラメータ展開は変数名・演算子・パターン・開始位置などの部品に分けて解説し、`file=report.tar.gz → report.tar` のような具体例も表示
- **引数の中のミニ言語** — 正規表現（grep、`[[ =~ ]]`。オプションに応じて BRE / ERE / PCRE）、sed スクリプト（アドレス、`s///` とフラグ、`&`、`\1` など）、jq フィルタ（パス、パイプ、`select`、`map` など）、定番の awk プログラム（`BEGIN`/`END`、パターン、`$1`、`NR`、`print` など）も分解して解説
- **具体例** — grep のパターンには一致する行・しない行の例を、sed スクリプト・awk プログラム・jq フィルタには入力例とその出力を表示。`sort`・`uniq`・`cut`・`tr`・`head`/`tail`・`seq`・`basename`/`dirname`・`printf`・ブレース展開（`{a,b}`、`{1..10..3}`）・グロブと `case` のパターン・`xargs`（実行されるコマンド）・`[ ]`/`[[ ]]`/`(( ))` の条件（真になる値・偽になる値）・`IFS` 付きの `read`・perl のワンライナー・`git log` の `--pretty`/`--format` と `--date`（例のコミットでの表示）にも具体例を表示し、パイプライン全体は段ごとの途中経過を表示（すべて組み込みの実行器で計算。テストで GNU sed/coreutils/findutils・gawk・jq・perl・bash・git と照合）
- **さらに多くのミニ言語** — printf と `date` の書式（`%-10s`、`%05.2f`、`+%Y-%m-%d`。date は今の表示例も）、1つの文として読み下す `find` の条件式（`-o`、`!`、`\( \)`、`-prune -o` の定番）、`chmod`/`umask` のモード（`755` → rwxr-xr-x、`u+rwX,go-w`、`umask 022` → 644/755）、`sort -k`・`cut -f`・`tr` の指定、`getopts` のオプション文字列と `getopt -o`・`--long`（例の引数がどう並べ直されるかも表示）、perl のワンライナー（`perl -pi -e 's/…/…/g'`、`-lane`）、`git log --pretty=format:`
- **定番の書き方と落とし穴** — よく使われる書き方（`IFS= read -r`、スクリプトのディレクトリを得る書き方、`command -v … >/dev/null 2>&1`、strict mode、`trap … EXIT` など）や、リダイレクトの評価順（`2>&1 >file` でエラーがファイルに行かない理由など）を補足
- **条件式** — `[ ]`, `[[ ]]`, `(( ))` と `-f`, `-z`, `-eq`, `=~` などの演算子
- **制御構文** — `if`, `for`, `while`, `until`, `case`、関数。ブロック内の行では「for ループ › if 文」のように位置も表示
- **複数行の文** — `\` による行継続、ヒアドキュメントの本文、同じスクリプト内で定義した関数の呼び出し
- **オフラインで即座に表示** — [tree-sitter-bash](https://github.com/tree-sitter/tree-sitter-bash) で構文解析し、組み込みの辞書で解説。通信も AI も使いません
- **日本語と英語に対応**

## 表示方法

ホバー・インライン要約・パネルは同時に使えます。それぞれ設定でオン/オフでき、ステータスバーの **Bash Explain** をクリックしても切り替えられます。

### ホバー（既定でオン）

行にマウスを乗せると解説が表示されます。`Ctrl+Alt+E`（macOS は `Cmd+Alt+E`）でキーボードカーソルの行を解説します。下部の **パネルで詳しく見る** で、同じ行をパネルに表示します。

![ホバー](images/hover.gif)

### パネル

カーソルに追従するサイドペインです。regex101 のように行を色分けして表示します。部分にマウスを乗せるとエディタ側の該当箇所がハイライトされ、クリックすると選択されます。エディタのタイトルバー・ホバーのリンク・**Bash Explain: bash の解説パネルを開く** から開けます。`bashExplain.panel.autoOpen` をオンにすると、bash スクリプトを開いたときに自動で開きます。

![パネル](images/panel.gif)

### インライン（既定でオフ）

カーソル行の行末に1行の要約を薄く表示します。`bashExplain.inline.enabled` でオンにします。

![インライン](images/inline.png)

## 他のファイルの中のシェル

他のファイルに書かれたシェルも解説します。対象は Dockerfile の `RUN`/`CMD`/`ENTRYPOINT`（`RUN <<EOF` のヒアドキュメント、exec 形式の `RUN ["cmd", "arg"]`、`["sh", "-c", "…"]` に渡すスクリプト、`SHELL [...]` も。`pipefail` なしの `RUN` のパイプで失敗が見逃される場合は警告）、Makefile のレシピ、CI の YAML（GitHub Actions のワークフローと composite の `action.yml` の `run:`、GitLab CI の `script:` など）、`package.json` の scripts、Markdown のコードブロック（`sh`・`bash`・`console` など）、Python の `subprocess.run(…)`・`os.system(…)` などです（`shell=True` の文字列は `/bin/sh` のスクリプト、リストはシェルを通さない実行として解説し、`shell=True` なしの文字列や f-string をシェルに渡す危険な書き方を指摘）。GitHub Actions では `defaults: run: shell:` に従い、`$GITHUB_OUTPUT` などの専用ファイルを説明し、`${{ github.event.pull_request.title }}` のような外部からの入力をスクリプトに埋め込むとスクリプトインジェクションの危険があることを警告します。make の `$(CC)`・`$@`・`$$` や GitHub Actions の `${{ … }}` のようなシェル以外の書き方はその意味を説明し、実際に実行するシェル向けの書き方になっているかも確認します（Dockerfile と Makefile は `SHELL` の指定がなければ `/bin/sh`）。`bashExplain.embedded.enabled` でオフにできます。

## bash 以外のシェル

解説は bash に基づきますが、スクリプトが別のシェル向けのときは、そのシェルにない書き方を指摘します。たとえば `#!/bin/sh` のスクリプト中の `[[ ]]`・配列・`&>`・`echo -e`・`{1..3}` などに注意を出し、移植性のある書き方を提案します。動くけれど意味が変わる書き方も補足します（`echo 'a\tb'` の `\t` は dash・yash・mksh・zsh では解釈される、zsh ではクォートしない `$var` が単語分割されない、yash と zsh の配列の添字は 1 から、ksh93 では `name() { … }` の関数内の `typeset` がローカルにならない、など）。ksh の組み込みコマンド `print`・`whence` も解説します。`*(.)` や `${(f)var}` のような zsh 独自の書き方は解析できないため、その旨を表示します。

対象のシェルは shebang（`#!/bin/sh`、`#!/usr/bin/env dash`、`#!/bin/busybox sh` など）・`# shellcheck shell=` 指定・ファイル名から判定し、`bashExplain.shell` でも指定できます。対応しているのは POSIX `sh`（dash と busybox ash で動かないものを明記）・`dash`・`ash`（busybox）・`yash`・`ksh`（ksh93）・`mksh`・`zsh` です。どのシェルが何に対応しているかは各シェルで実測し、テストでも再確認しています。

## 問題パネルとクイックフィックス

警告は「問題」パネル（とエディタ上の波線）にも表示されるので、行にマウスを乗せなくても気づけます。対象は、スクリプトのシェルで使えない書き方、GitHub Actions のスクリプトインジェクション、`pipefail` なしの Docker `RUN` のパイプ、`shell=True` なしの Python の文字列やシェルに値を埋め込む書き方です。意味を変えずに書き換えられる場合はクイックフィックスも出ます: `[[ ]]` → `[ ]`（変数をクォートし、`&&`・`||` は分割）、`==` → `=`、`source` → `.`、`function f` → `f()`、`&> file` → `> file 2>&1`、`|&` → `2>&1 |`。`== *.txt` のパターン一致・`=~`・`<` のように `[ ]` で表せない `[[ ]]` は、警告だけ出してクイックフィックスは出しません。書き換え結果は、元の書き方を bash で実行した場合と dash で同じ結果になることをテストで確認しています。`bashExplain.diagnostics.enabled` でオフにできます。

## コマンド

| コマンド | キー | 説明 |
| --- | --- | --- |
| Bash Explain: カーソル行の bash を解説 | `Ctrl+Alt+E` / `Cmd+Alt+E` | カーソル行の解説を表示 |
| Bash Explain: bash の解説パネルを開く | | サイドパネルを開く（エディタのタイトルバーからも可） |
| Bash Explain: 表示方法を選択 | | ホバー・インライン要約・パネルの自動表示をそれぞれオン/オフ |
| Bash Explain: 設定を開く | | この拡張の設定を開く（ホバーとパネルのリンクからも可） |

## 設定

| 設定 | 既定値 | 説明 |
| --- | --- | --- |
| `bashExplain.language` | `auto` | `auto`（VS Code の表示言語に合わせる） / `ja` / `en` |
| `bashExplain.shell` | `auto` | スクリプトの対象シェル（`auto`・`bash`・`sh`・`dash`・`ash`・`yash`・`ksh`・`mksh`・`zsh`）。そのシェルにない書き方を指摘 |
| `bashExplain.diagnostics.enabled` | `true` | 警告を「問題」パネルにも表示（クイックフィックス付き） |
| `bashExplain.examples.placement` | `first` | `first`（具体例を対応する部分の真下、その中の各要素の解説より先に表示） / `last`（各要素の解説の後に表示） / `bottom`（解説の後にまとめて表示） |
| `bashExplain.hover.enabled` | `true` | マウスを乗せた行の解説をホバーで表示（`Ctrl+Alt+E` はオフでも使える） |
| `bashExplain.hover.followCursor` | `false` | カーソル移動に追従してホバーを自動表示 |
| `bashExplain.hover.followDelay` | `400` | 追従表示までの遅延（ミリ秒） |
| `bashExplain.inline.enabled` | `false` | カーソル行の行末に1行の要約を表示 |
| `bashExplain.inline.maxLength` | `120` | インライン要約の最大文字数 |
| `bashExplain.panel.autoOpen` | `false` | bash スクリプトを開いたらパネルを自動で開く |
| `bashExplain.embedded.enabled` | `true` | Dockerfile・Makefile・CI の YAML・`package.json` の scripts・Markdown のコードブロック・Python の `subprocess` 呼び出し中のシェルも解説 |
| `bashExplain.languages` | `["shellscript"]` | 解説の対象とする言語 ID |

## 制限事項

- 解説はルールベースです。辞書に無いコマンドは「外部コマンド」として表示され、オプションの詳細は出ません。
- 構文解析に使っている文法の都合で、正しく解析できない書き方があります（例: `[[ -f a && $x =~ re ]]` のように `&&` と `=~` を混ぜたもの）。

## 開発

不具合報告やプルリクエストは [github.com/sf624/bash-explain](https://github.com/sf624/bash-explain) へどうぞ。

```sh
npm install
npm run build      # dist/ にバンドル（wasm もコピー）
npm test           # 型チェック + 単体テスト
npm run package    # .vsix を作成
```

VS Code でこのフォルダを開いて `F5` を押すと、`test/fixtures/sample.sh` を開いた拡張機能開発ホストが起動します。
`npx tsx test/dump.ts <file> [ja|en] [line]` で、ファイルの各行の解説をテキストで確認できます。
シェルごとの対応表は、`PATH` または `$BASH_EXPLAIN_SHELLS` のディレクトリにあるシェル（`dash`・`busybox`・`yash`・`ksh93`・`mksh`・`zsh`）で検証します。無いシェルのテストはスキップされます。

コマンドを追加するには [`src/dict/commands.ts`](src/dict/commands.ts) に
`cmd(日本語の説明, 英語の説明, [オプション…], { positional: […] })` を追加します。

## ライセンス

[MIT](LICENSE)。同梱しているサードパーティのソフトウェアは [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) を参照してください。
