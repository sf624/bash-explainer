# Bash Explain

bash スクリプトを **1行ずつ** 解説する VS Code 拡張機能です。[regex101](https://regex101.com/) が正規表現を分解して説明するように、カーソル行のコマンド・オプション・リダイレクト・変数展開などをトークン単位で解説します。

解説はすべてルールベース（[tree-sitter-bash](https://github.com/tree-sitter/tree-sitter-bash) による構文解析 + 組み込み辞書）で、オフラインかつ即座に表示されます。日本語と英語に対応しています。

## 表示方法

`bashExplain.displayMode` で選べます。ステータスバーの項目をクリックするか、コマンド **Bash Explain: 表示方法を選択** でも切り替えられます。

| モード | 説明 |
| --- | --- |
| `hover`（既定） | マウスを乗せた行の解説をフローティング表示。`Ctrl+Alt+E`（mac: `Cmd+Alt+E`）でカーソル行の解説を表示。`bashExplain.hover.followCursor` を有効にすると、カーソル移動に追従して自動表示 |
| `panel` | 右側のペインにカーソル行の解説を常時表示。行は種類ごとに色分けされ、トークンにマウスを乗せるとエディタ側の該当箇所もハイライト、クリックで選択 |
| `inline` | カーソル行の行末に1行の要約を薄く表示 |
| `both` | `hover` と `panel` の両方 |

## 解説できるもの

- コマンドと **オプション**（`-rn` のような結合、`-o pipefail` のような値付き、`--include=*.sh` 形式）、位置引数の役割
- 約120のコマンド・ビルトイン（grep, sed, awk, find, xargs, curl, tar, git, docker …）。サブコマンド（`git commit` など）や、他のコマンドを実行するコマンド（`sudo`, `xargs`, `env`, `find -exec` …）の中身も解説
- パイプ `|`、`&&` / `||`、`;`、`&`
- リダイレクト（`>`, `>>`, `<`, `2>&1`, `&>`, `>/dev/null` …）、ヒアドキュメント、ヒアストリング
- パラメータ展開（`${var:-default}`, `${f%.sh}`, `${#arr[@]}`, `${x//a/b}` …）、特殊変数（`$?`, `$@`, `$#` …）
- コマンド置換 `$(…)`、プロセス置換 `<(…)`、算術展開 `$((…))`
- `[ ]` / `[[ ]]` / `(( ))` の条件式と各演算子（`-f`, `-z`, `-eq`, `=~` …）
- `if` / `for` / `while` / `until` / `case` / 関数定義。ブロック内の行では「どの構文の中にいるか」も表示
- `\` による行継続、ヒアドキュメント本文の行、スクリプト内で定義した関数の呼び出し

辞書に無いコマンドは「外部コマンド」として表示されます。

## 設定

| 設定 | 既定値 | 説明 |
| --- | --- | --- |
| `bashExplain.displayMode` | `hover` | 表示方法（`hover` / `panel` / `inline` / `both`） |
| `bashExplain.language` | `auto` | 解説の言語（`auto` は VS Code の表示言語に合わせる / `ja` / `en`） |
| `bashExplain.hover.followCursor` | `false` | ホバーモードでカーソル移動に追従して自動表示 |
| `bashExplain.hover.followDelay` | `400` | 追従表示までの遅延（ミリ秒） |
| `bashExplain.inline.maxLength` | `120` | インライン要約の最大文字数 |
| `bashExplain.languages` | `["shellscript"]` | 対象とする言語 ID |

## 開発

```sh
npm install
npm run build      # dist/ にバンドル（wasm もコピー）
npm test           # 型チェック + analyzer の単体テスト
npm run package    # .vsix を作成
```

VS Code でこのフォルダを開き `F5` で拡張機能開発ホストが起動し、`test/fixtures/sample.sh` が開けます。

`npx tsx test/dump.ts <file> [ja|en] [line]` で、ファイルの各行の解説をテキストで確認できます。

### 構成

- `src/analyzer.ts` — 構文木から行ごとの解説（トークンの木）を作る。VS Code に依存しない
- `src/dict/` — 構文・ビルトイン・外部コマンドの解説辞書（日英）
- `src/ui/` — ホバー・パネル（Webview）・インライン表示
- `media/` — パネルの Webview 用スクリプトとスタイル

コマンドを追加するには `src/dict/commands.ts` に `cmd(日本語の説明, 英語の説明, [オプション…], { positional: […] })` を追加します。
