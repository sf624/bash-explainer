# bash 以外のシェル向けのスクリプト

[ユーザーガイド](README.md) · [English](../other-shells.md) · 日本語

解説は bash に基づきますが、スクリプトが別のシェル向けのときは、そのシェルにない書き方や、意味が変わる書き方も指摘します。

```sh
#!/bin/sh
[[ -n $name ]] && echo -e "hi\t$name"
# ⓧ エラー: `[[ ]]` は POSIX sh にない書き方です（dash では `[[` がコマンドとして実行され、見つからずに終了ステータス 127 になります。条件に使うと偽になります）。代わりに `[ ]` を使う。
# ⚠ 移植性: `echo -e` は POSIX sh にない書き方です（dash の `echo` は `-e` を文字として表示します）。代わりに `printf` を使う…
# ⓘ 移植性: dash の `echo` は引数の `\t` や `\n` などを解釈します…
```

- **対応シェル:** POSIX `sh`（dash と busybox ash で動かないものを明記）、`dash`、`ash`、`yash`、`ksh`、`mksh`、`zsh`。どのシェルで何が動くかは、各シェルで実測しています。
- **シェルの判定:** shebang（`#!/bin/sh`、`#!/usr/bin/env dash` など）、`# shellcheck shell=` の行、ファイル名から判定します。`bashExplainer.shell` で指定もできます。Markdown のコードブロックでは、ブロック内の shebang がフェンスの言語名より優先されます。shebang のない `sh` のブロックは bash として読みます（POSIX sh として調べるには `#!/bin/sh` を書く）。`bash`・`zsh`・`dash`・`ksh` はそのシェルのままです。
