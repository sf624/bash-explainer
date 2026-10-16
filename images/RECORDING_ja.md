# README 用の画像の撮り方

[English](RECORDING.md)

README.md と README_ja.md は、このディレクトリの次の4ファイルを参照しています。

| ファイル | 内容 | 長さ |
| --- | --- | --- |
| `demo.gif` | 冒頭のデモ。ホバー → パネル | 約17秒 |
| `hover.gif` | ホバーモード | 約15秒 |
| `panel.gif` | パネルモード | 約17秒 |
| `inline.png` | インラインモードの静止画 | — |

`images/` は `.vscodeignore` で .vsix には含まれません。Marketplace の README は、`package.json` の `repository`（github.com/sf624/bash-explainer）を通して GitHub から画像を読み込みます。**push してから公開**してください。

## 自動で撮る

```sh
npm ci
npm run images                 # 4つ全部
npm run images -- hover panel  # 一部だけ
npm run images -- --keep       # フレーム画像と一時プロファイルを残す
```

[scripts/capture-readme-images.mjs](../scripts/capture-readme-images.mjs) が、このディレクトリのファイルを上書きします。処理の流れは次のとおりです。

1. 拡張機能をビルドし、.vsix にまとめる
2. 空の一時的な拡張機能ディレクトリに .vsix をインストールする（普段の VS Code の設定や拡張機能は使わず、変更もしない）
3. 画像ごとに、`--remote-debugging-port`・新しい user-data ディレクトリ・そのシナリオ用の設定で VS Code を起動し、[Playwright](https://playwright.dev/)（`playwright-core`。ブラウザのダウンロードは不要）で操作する
4. マウスを動かしたりキーを押したりしながらスクリーンショットを撮る。スクリーンショットにはマウスポインタが写らないので、ポインタを描き足す
5. ffmpeg でフレームを GIF にする

必要なもの:

- VS Code。OS ごとの標準のインストール先を探します。見つからない場合は `VSCODE_PATH` に Code の実行ファイルを指定してください（`code` コマンドが隣の `bin/` にない場合は `VSCODE_CLI` も）。
- `PATH` 上の `ffmpeg`（または `FFMPEG` で指定）

実行中（3分ほど）は VS Code のウィンドウが勝手に開閉するので、PC に触らないでください。

途中で失敗した場合は一時ディレクトリを残し、そこに `<シナリオ名>-error.png` を保存します。

### 撮る内容

どの画像も、Dark Modern テーマ、エディタのフォント 16px、ミニマップ・アクティビティバー・サイドバーは非表示、`"bashExplainer.language": "en"` です。ウィンドウは 1280×720（`hover.gif` だけ 1000×600）で、1.5倍のスケールで撮り、横幅 1000px・10fps で書き出します。

| 画像 | 設定 | 手順 |
| --- | --- | --- |
| `demo.gif` | 既定（ホバーあり） | 8行目（`grep -n "ERROR" …`）にホバーし、ホバーを **Open in panel** までスクロールしてクリック。パネルで `2>/dev/null` を指してエディタ側がハイライトされるのを見せ、矢印キーで 11行目 → 12行目と動かしてパネルが追従するのを見せる |
| `hover.gif` | 既定（ホバーあり） | 2行目（`set -euo pipefail`）、4行目（`${1:-…}`）、7行目（ループ内。ヘッダーに「for loop」と出る）の順にホバー |
| `panel.gif` | `hover.enabled: false`, `panel.autoOpen: true` | 1行目から矢印キーで 11行目まで下り、ツリーの `-exec` 行を指してから 12行目へ |
| `inline.png` | `hover.enabled: false`, `inline.enabled: true` | カーソルを 8行目に置き、行末に要約が出た状態。エディタの行の部分だけに切り抜く |

シナリオを変えるときは、スクリプトの `record()` を編集してください。

## 手で撮る

- 録画ツール: Windows は [ScreenToGif](https://www.screentogif.com/)、macOS は [Kap](https://getkap.co/)
- `images/demo.sh` を開き、上の表の設定と手順で撮る
- 書き出しは横幅 1000px 以下、10〜15fps、1ファイル 5MB 以下を目安に
- 日本語の画像が欲しい場合は `"bashExplainer.language": "ja"` にして別名で保存し、README_ja.md の参照先を変える
