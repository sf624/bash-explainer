# 解説できるもの

[ユーザーガイド](README.md) · [English](../explained.md) · 日本語

コマンドとオプション、演算子とリダイレクト、展開、引数の中の言語、制御構文、定番の書き方と落とし穴は、README の一覧にあります（[解説できるもの](../../../README.ja.md#解説できるもの)）。このページでは、具体例、他のファイルの中のシェル、`yq` という名前の3つのツールを説明します。

## 具体例

多くの書き方に、入力例とその出力を表示します。計算は組み込みの実行器で行い、テストで実物（GNU sed・coreutils、gawk、jq、perl、bash、git、yq）と照合しています。

| 対象 | 表示される内容 |
| --- | --- |
| `grep` のパターン、`[[ =~ ]]`、グロブ、`case` のパターン | 一致する文字列と一致しない文字列 |
| `sed`・`awk`・`jq`・`yq`・`perl`・`sort`・`uniq`・`cut`・`tr`・`head`・`tail` | 入力例 → 出力 |
| パイプライン全体 | 段ごとの途中経過 |
| `${…}` の展開、`printf`、ブレース展開 | 展開・出力される値 |
| `[ ]`・`[[ ]]`・`(( ))` | 真になる値と偽になる値 |
| `xargs`・`read`・`getopt` | 実行されるコマンド、変数に入る値、引数の並び替え結果 |
| `git log --pretty`・`--date` | 例のコミットでの表示 |
| `date +書式` | 決まった2つの日時での出力（パネルで日時を書き換えられる） |

具体例は、対応する部分の解説の真下に表示します（`bashExplainer.examples.placement` で変更可）。

## 他のファイルの中のシェル

| ファイル | 解説する部分 |
| --- | --- |
| Dockerfile | `RUN`・`CMD`・`ENTRYPOINT`（シェル形式、`RUN <<EOF`、exec 形式、`["sh", "-c", "…"]`）と `SHELL [...]`。`pipefail` なしの `RUN` のパイプで失敗が見逃される場合は警告 |
| Makefile | レシピ。make の `$(VAR)`・`$@`・`$$` も説明。make がシェルなしで実行する行（`;`・`"`・`$`・`|` などがない行）は、`/bin/sh` ではなくプログラムとして説明 |
| CI の YAML | GitHub Actions の `run:`（ワークフローと `action.yml`。`shell:` や `defaults` に従う）、GitLab CI の `script:`、CircleCI の `run:`・`command:`、Azure Pipelines の `script:`・`bash:`（`$(変数)` のマクロも）。`${{ github.event.pull_request.title }}` のような外部からの入力をスクリプトに埋め込むと警告 |
| `package.json` | `scripts` |
| Markdown | `sh`・`bash`・`console` などのコードブロック（シェルはブロック内の shebang、なければ言語名のシェル。`sh` は bash として読む） |
| Python | `subprocess.run(…)`・`os.system(…)` など。`shell=True` なしの文字列や、シェルに値を埋め込む書き方を指摘。`re` を import したファイルでは `re.search(…)`・`re.compile(…)`・`re.sub(…)` などのパターンも解説（フラグを踏まえたパターンの各部分、Python が受け付けないパターンのエラー `bad escape \e at position 0`、`count` の位置に渡したフラグの警告、`r` のない文字列がエスケープを文字に変える `"\bword\b"`・`"(a)\1"` の警告）。f-string のフィールド（`rf"^{prefix}\d+$"`）は、値の分からない部分として読む。その行のチップは「シェルなし（Python の正規表現）」。Web ページでは、`import re` と `re.search(…)` などの呼び出しがある貼り付けたスクリプトを Python として扱う |
| Jenkinsfile | `sh '…'`・`sh "…"`・`sh '''…'''`・`sh(script: …)`。シェルより先に Groovy が埋め込む `$名前` や `${…}` を指摘 |
| bats（`.bats` か `bats` の shebang） | ファイル全体を bash として。`@test "…" {` は bats が `set -e` で実行するテストとして、`run`（`!`・`-N`・`--separate-stderr` も）・`load`・`skip`・`bats_pipe` も説明。テストを失敗させられない `! cmd` や、パイプラインの中の `run` を指摘 |

それぞれ、実際に実行するシェル向けの書き方になっているかも確認します（Dockerfile と Makefile は `SHELL` の指定がなければ `/bin/sh`。Dockerfile ではそのステージのベースイメージで決まり、`alpine`・`busybox`・`-alpine` のタグは busybox ash、`debian`・`ubuntu` は dash）。対象にするファイルの種類は `bashExplainer.embedded.files` で選べます。

## yq

`yq` という名前のツールは3種類あり、記法がそれぞれ違います。**mikefarah/yq v4**、**kislyuk/yq**（jq のラッパー）、古い **mikefarah/yq v3** です。Bash Explainer は、オプション・サブコマンド・関数や、同じファイル内のインストール方法からどれ向けかを判定し、その結果を行ごとに表示します。

> yq: mikefarah/yq v4（v4.22.1 以降）として解説。根拠: `-o json` は mikefarah/yq v4 のオプション、`pick` は mikefarah/yq の関数（jq にはない）
> 互換性: mikefarah/yq v4（v4.22.1 以降） ✓ ／ kislyuk/yq ✗（`-o json`・`pick` が使えない） ／ mikefarah/yq v3 ✗（jq 形式の式・`-o json` が使えない）

各機能がどのリリースで入ったかは、4.x の全マイナーリリースで実際に動かして調べています。判定できないときは mikefarah/yq v4 として扱います。`bashExplainer.yq.flavor` で種類を固定することもできます。
