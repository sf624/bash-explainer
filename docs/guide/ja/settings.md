# 設定

[ユーザーガイド](README.md) · [English](../settings.md) · 日本語

設定はすべて、VS Code の設定エディタの *Bash Explainer* にあります（ホバーとパネルの **Bash Explainer: 設定を開く** からも開けます）。Web 版、コマンドラインツール、Language Server でも、意味のある範囲で同じ設定を使えます（[VS Code 以外での設定](#vs-code-以外での設定)）。

## VS Code の設定

| 設定 | 既定値 | 説明 |
| --- | --- | --- |
| **表示** | | |
| `bashExplainer.hover.enabled` | `true` | マウスを乗せた部分の解説をホバーで表示（行全体を解説する `Ctrl+K Ctrl+E` はオフでも使える） |
| `bashExplainer.hover.followCursor` | `false` | カーソルが移動するたびにホバーを表示 |
| `bashExplainer.hover.followDelay` | `400` | その表示までの遅延（ミリ秒） |
| `bashExplainer.hover.maxDepth` | `0` | ホバーに表示する解説ツリーの階層数（`0` はすべて） |
| `bashExplainer.panel.autoOpen` | `false` | シェルスクリプトを開いたらパネルを自動で開く |
| `bashExplainer.panel.animations` | `true` | パネルの行、bash の手順、「詳しく」、例を、展開と折りたたみのときに伸び縮みさせる（オフでは即座に表示。動きを減らす設定でもオフ） |
| `bashExplainer.panel.colors` | `"classic"` | パネルで行の各部分に付ける色。`classic`（独自の6色）、`theme`（エディターのテーマの色。読みにくい色は除く）、`themeLike`（テーマの色。テーマが2種類の部分に同じ色を付けるところは新しい色）。リモートのウィンドウでは、拡張機能がローカル側に入っていれば（VS Code はそこに入れる）どのカラーテーマも、リモート側で動くときは VS Code の既定のカラーテーマだけ。VS Code だけ |
| `bashExplainer.highlight.enabled` | `true` | 解説と同じ読み方でシェルのコードを色分け（エディタの色分けに重ねるセマンティックトークン）。コマンド名が実行するもの・オプション・読み取り専用の変数に色が付く。言語ごとに設定できる（下記）。Web 版は常にこの色分け |
| `bashExplainer.hints.names` | `true` | 名前どおりのものを実行しないコマンド名の後ろにヒントを表示 |
| `bashExplainer.hints.deadCode` | `true` | 実行されないコード（スクリプトが結果を決めている条件の分岐、`&&` や `||` の実行されない側、`exit`・`return`・`break`・`continue` の後）を薄く表示。警告ではなくヒント |
| `bashExplainer.blockOutline` | `"bar"` | 複数行にわたるコマンド（ループ・`if`・関数・パイプライン・ヒアドキュメントなど）にカーソルがあるとき、エディタでの目印。`bar`（行の左の縦線）・`tint`（薄い背景色）・`off`。色は `bashExplainer.blockBar` と `bashExplainer.blockTint` のテーマカラー。Web 版にもある |
| `bashExplainer.inline.enabled`・`bashExplainer.inline.maxLength` | | 削除済み。効果はない |
| `bashExplainer.examples.enabled` | `true` | 具体例を表示する |
| `bashExplainer.examples.disabled` | `[]` | 表示しない具体例の種類: `regex`・`sed`・`awk`・`jq`・`yq`・`perl`・`textFilters`・`pipeline`・`expansion`・`printf`・`glob`・`test`・`xargs`・`read`・`getopt`・`gitLog`・`date` |
| `bashExplainer.examples.inHover` | `true` | ホバーにも具体例を表示する（オフならパネルだけ） |
| `bashExplainer.examples.placement` | `first` | 具体例を対応する部分の下の、各要素の解説より先（`first`）・後（`last`）、またはすべての解説の後（`bottom`）に表示 |
| `bashExplainer.language` | `auto` | `auto`（VS Code の表示言語に合わせる）・`ja`・`en` |
| `bashExplainer.notes.idioms` | `true` | 定番の書き方（strict mode、`IFS= read -r` など）の補足を表示する |
| `bashExplainer.notes.pitfalls` | `true` | よくある間違いと避け方を注記する（クォートしていない変数、`for f in $(ls)`、`rm -rf $DIR/…` など）。エラー（`x = 1`）はオフでも注記する |
| `bashExplainer.notes.basis` | `true` | マニュアルではなく bash の実際の動きに基づく注記や部分の説明に印（「マニュアルに記述なし・bash 5.2 で確認」）を付け、端末で試すコマンドを添える |
| **確認** | | |
| `bashExplainer.shell` | `auto` | スクリプトの対象シェル: `auto`・`bash`・`sh`・`dash`・`ash`・`yash`・`ksh`・`mksh`・`zsh` |
| `bashExplainer.bashVersion` | `5.2` | 解説の対象にする bash のバージョン: `5.2`・`5.3`。bash 5.3 の書き方（`${ cmd; }` など）は 5.3 での動きを解説し、`5.2` ではエラーにする |
| `bashExplainer.diagnostics.enabled` | `true` | エラーと警告を「問題」パネルにも表示（クイックフィックス付き） |
| `bashExplainer.diagnostics.ignore` | `[]` | 出さない警告のコード（「問題」パネルに表示されるコード。`dbracket`・`echoE`・`dockerPipefail` など） |
| `bashExplainer.diagnostics.embedded` | `true` | 他のファイルの中のシェルの警告も出す |
| `bashExplainer.diagnostics.pitfalls` | `true` | 解説の警告と注意も「問題」パネルに出す（`rm -rf $DIR/*`・`rm $f` は警告、`cat $f`・`read line` は情報）。解説のエラー（`]` のない `[`、`x = 1`）は、この設定にかかわらず出す |
| `bashExplainer.yq.flavor` | `auto` | `auto`・`mikefarah4`・`kislyuk`・`mikefarah3` |
| **ファイル** | | |
| `bashExplainer.embedded.files` | すべて | 中のシェルを解説するファイル: `dockerfile`・`makefile`・`yaml`・`packageJson`・`markdown`・`python`・`jenkinsfile`・`bats` |
| `bashExplainer.languages` | `["shellscript"]` | シェルスクリプトとして解説する言語 ID |
| **辞書** | | |
| `bashExplainer.customCommands` | `{}` | 辞書にないコマンドの説明を追加する（下記） |

### ファイルの種類ごとの色分け

色分けは、シェルスクリプトと、ほかのファイルの中のシェルのコードでオンです（Python ファイルと Dockerfile は、それぞれの言語サーバーが色分けするので対象外）。ファイルの種類ごとにオフにするには、`settings.json` でその言語に設定します。

```json
"[makefile]": { "bashExplainer.highlight.enabled": false },
"[yaml]": { "bashExplainer.highlight.enabled": false }
```

言語は VS Code のステータスバーに出るものです: `shellscript`・`bats`・`makefile`・`yaml`（GitLab CI と、GitHub Actions 拡張機能がないときの GitHub のワークフロー）・`github-actions-workflow`・`json`（package.json）・`markdown`・`groovy`・`jenkinsfile`。言語を付けずに `"bashExplainer.highlight.enabled": false` とすると、すべてでオフになります。

### 自分のコマンドを追加する

社内ツールなどは、説明を書くまで「外部コマンド」として表示されます:

```json
"bashExplainer.customCommands": {
  "deploy": {
    "summary": "サービスを本番にデプロイする",
    "options": [
      { "names": ["-n", "--dry-run"], "description": "実行せずに内容だけ表示" },
      { "names": ["-e"], "description": "デプロイ先の環境", "takesValue": true }
    ],
    "operands": [{ "description": "サービス名", "repeat": "+" }],
    "subcommands": {
      "status": { "summary": "デプロイ済みのものを表示する", "operands": [{ "description": "サービス名", "repeat": "*" }] }
    }
  }
}
```

- `options`: 各オプションの名前（`names`）・説明（`description`）と、値を取るなら `"takesValue": true`（`-e prod`・`-eprod`・`--env=prod`）。
- `operands`: オプションでない語を順に書きます。`repeat` は `?`（省略できる）・`*`（いくつでも）・`+`（1つ以上）のどれかで、書かなければちょうど1つです。語の数が合わないときは、普通の語として表示します。
- `style`: `gnu`（既定。オペランドの後にもオプションを書ける）・`posix`（最初のオペランドでオプションが終わる）・`single-dash`（長いオプションも `-` 1つ。`-name 値`）のどれか。
- `subcommands`: サブコマンドごとに、同じ項目を書きます。

0.7 より前の形（`options` をオブジェクト `"-n|--dry-run": "…"` で、オペランドを `arguments` の説明の並びで書く形。最後の説明は繰り返す）も読みます。この形は今後のリリースで読まなくなります。

## VS Code 以外での設定

同じ設定を、意味のある範囲で、Web 版・コマンドラインツール・Language Server でも使えます。

| 設定（`bashExplainer.`…） | Web 版 | コマンドライン | Language Server |
| --- | --- | --- | --- |
| `language`・`notes.idioms`・`notes.pitfalls`・`notes.basis`・`shell`・`bashVersion`・`yq.flavor`・`diagnostics.ignore`・`diagnostics.embedded`・`diagnostics.pitfalls`・`examples.enabled`・`examples.disabled`・`customCommands` | ✓ | ✓ | ✓ |
| `diagnostics.enabled` | ✓ | （警告は `--check` で出す） | ✓ |
| `hover.enabled`・`hints.names`・`hints.deadCode` | ✓ | | ✓ |
| `examples.placement`・`panel.animations`・`blockOutline` | ✓ | | |
| `editor.wrap`（Web 版だけの設定です。VS Code の設定にはなく、VS Code には `editor.wordWrap` があります） | ✓ | | |
| `examples.inHover`・`hover.maxDepth`・`highlight.enabled`・`languages`・`embedded.files` | | | ✓ |
| `hover.followCursor`・`hover.followDelay`・`panel.autoOpen`・`panel.colors` | | | |

空欄は、VS Code にしかないもの（ホバーの深さと具体例、カーソルに追従するホバー、開くパネル、対象ファイルの選択）についての設定です。Web 版とコマンドラインは、渡されたファイルを、選んだ種類として解説します。

- **Web 版:** 上のバーの ⚙ で開きます。変更はすぐに反映され、ブラウザに保存されます（localStorage）。**既定値に戻す** で設定が戻り、**保存したデータを消去**（確認あり）で、ページがブラウザに保存しているものすべて、つまり設定と、そのほかに覚えている選択（テーマ、画面の大きさ、深さ、「プログラムが受け取るもの」のスイッチ、閲覧モード、閉じたヒント）を削除します。既定の状態はすぐに表示され、閉じたヒントは次に読み込んだときにまた表示されます。シェルと yq は、エディタのヘッダーにある、ファイルの種類とシェルを表示するチップか、メニューの **ファイルの種類とシェル…** でも選べます。yq の一覧は、カーソルの行が yq を実行するときだけ表示します。チップで選ぶシェルと yq はこのダイアログの **対象シェル** と **yq の種類**、メニューで選ぶ言語は **言語** の設定と同じです。**ファイルにエクスポート**（または **コピー**）で、変えた設定を下の形式の設定ファイルにでき、コマンドラインツールや VS Code の `settings.json` で使えます。**ファイルからインポート…**（ダイアログへのファイルのドロップや、JSON の貼り付けも可）で、ページの設定をそのファイルの内容に置き換えます。読み込まなかったキーは一覧で表示します。
- **コマンドラインと Language Server:** VS Code の `settings.json` と同じキー（`bashExplainer.` は付けても付けなくてもよい）の JSON ファイルです（コメントも書けます）。`--config` で指定したファイル、なければ `$BASH_EXPLAINER_CONFIG`、なければ `$XDG_CONFIG_HOME/bash-explainer/settings.json`（既定では `~/.config/bash-explainer/settings.json`）を読みます。1つの設定は `--set キー=値` でも変えられます。詳しくはツールの README の [Settings](../../../cli/README.md#settings) を参照してください（英語）。

```json
{
  "bashExplainer.language": "ja",
  "bashExplainer.shell": "sh",
  "bashExplainer.diagnostics.ignore": ["crlf"],
  "bashExplainer.examples.disabled": ["date"],
  "bashExplainer.customCommands": {
    "deploy": { "summary": "サービスを本番にデプロイする" }
  }
}
```
