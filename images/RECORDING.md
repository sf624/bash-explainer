# README 用 GIF の撮り方

README.md / README_ja.md は次の4ファイルを参照しています。このディレクトリに同じ名前で置いてください。

| ファイル | 内容 | 目安 |
| --- | --- | --- |
| `demo.gif` | 冒頭のデモ。ホバー → パネルの流れを短く | 10〜15秒 |
| `hover.gif` | ホバーモード | 8〜12秒 |
| `panel.gif` | パネルモード | 10〜15秒 |
| `inline.png` | インラインモードの静止画 | — |

`images/` は `.vscodeignore` で .vsix には含まれません。Marketplace の README は、`package.json` の `repository`（github.com/sf624/bash-explain）から画像を読み込みます。**push してから公開**してください。

## 準備

- 録画ツール: Windows は [ScreenToGif](https://www.screentogif.com/)、macOS は [Kap](https://getkap.co/)
- 開くファイル: `images/demo.sh`
- ウィンドウ: VS Code を 1280×720 前後にする。サイドバーとミニマップは閉じ、エディタのフォントは 16px 前後
- テーマ: Dark Modern など定番のもの
- 言語: 英語版 README 用なので、`"bashExplainer.language": "en"` にする（日本語の GIF も欲しければ `ja` で別に撮り、README_ja.md の参照先を変える）
- 書き出し: 横幅 1000px 以下、10〜15fps、1ファイル 5MB 以下を目安に

## シナリオ

### demo.gif

1. `displayMode` を `both` にしておく
2. 8行目（`grep -n "ERROR" …`）にマウスを乗せ、ホバーを1〜2秒見せる
3. ホバー下部の **Open in panel** をクリックする
4. パネルで `2>/dev/null` の部分にマウスを乗せ、エディタ側がハイライトされるところを見せる
5. 矢印キーでカーソルを 11行目 → 12行目と動かし、パネルが追従するところを見せる

### hover.gif

1. `displayMode` を `hover` にしておく
2. 2行目（`set -euo pipefail`）にマウスを乗せる
3. 4行目（`${1:-…}`）にマウスを乗せる
4. 7行目（ループ内）に乗せ、ヘッダーに「for loop」と出るところを見せる

### panel.gif

1. `displayMode` を `panel` にしておく（パネルが右に開く）
2. 2行目から矢印キーで1行ずつ下へ動かし、12行目まで進める（各行1秒程度）
3. 11行目（`find … -exec rm -f {} \;`）で、パネルのツリーの `-exec` 行にマウスを乗せる

### inline.png

1. `displayMode` を `inline` にしておく
2. カーソルを 8行目に置き、行末の要約が見える状態で撮る
