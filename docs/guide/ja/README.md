# Bash Explainer ユーザーガイド

[English](../README.md) · 日本語

このガイドは [README](../../../README.ja.md) の続きです。クイックスタートは README にあります。`main` ブランチのページは開発版について書いています。公開済みの版より先の機能を含むことがあります。リリースのタグにあるページは、そのリリースについて書いています。

| ページ | 内容 |
| --- | --- |
| [VS Code で使う](vscode.md) | インストール、ホバー、パネル、コマンド名のヒント、コマンド |
| [設定](settings.md) | すべての設定、ファイルの種類ごとの色分け、自分のコマンドの追加、Web 版・コマンドライン・Language Server での設定 |
| [解説できるもの](explained.md) | 具体例、Dockerfile・Makefile・CI の YAML などの中のシェル、`yq` という名前の3つのツール |
| [bash 以外のシェル向けのスクリプト](other-shells.md) | `sh`・`dash`・`ash`・`yash`・`ksh`・`mksh`・`zsh` と、シェルの判定 |
| [警告とクイックフィックス](warnings.md) | クイックフィックス、問題の3つのレベル、警告を出さない方法、`--check` が失敗する場合 |
| [Web 版](web.md) | ファイル、ファイルの種類とシェル、問題、共有、設定、キー、タッチ画面 |
| [制限事項](limitations.md) | bash と同じには読めない書き方と、解説の前提 |
| [プライバシー](privacy.md) | 設計上オフラインで動くこと（通信・AI・テレメトリ・外部プロセスなし）と、その確かめ方 |

## コマンドライン、他のエディタ、CI

コマンドラインツール、Language Server、GitHub Action は、1つの npm パッケージ [`bash-explainer`](https://www.npmjs.com/package/bash-explainer) にまとまっています（`npx bash-explainer` で実行、または `npm install --global bash-explainer` でインストール）。オプション、出力形式（テキスト、Markdown、JSON、SARIF、GitHub のアノテーション）、Neovim・Helix・Emacs の設定、Action の入力は、[パッケージの README](../../../cli/README.md) を参照してください（英語）。

## そのほか

- [CHANGELOG.md](../../../CHANGELOG.md): リリースごとの変更点（英語）。
- [CONTRIBUTING.md](../../../CONTRIBUTING.md): ビルド、テスト、リリースの方法（英語）。
