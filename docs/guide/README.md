# Bash Explainer user guide

English · [日本語](ja/README.md)

These pages go with the [README](../../README.md), which has the quick start. On `main` they describe the development version, which can be ahead of the release; the pages at a release's tag describe that release.

| Page | What it covers |
| --- | --- |
| [In VS Code](vscode.md) | Installation, the hover, the panel, the name hints, the commands |
| [Settings](settings.md) | Every setting, colours per kind of file, your own commands, and the settings of the web page, the command line and the Language Server |
| [What is explained](explained.md) | Worked examples, shell code in Dockerfiles, Makefiles, CI YAML and other files, and the three tools called `yq` |
| [Scripts for other shells](other-shells.md) | `sh`, `dash`, `ash`, `yash`, `ksh`, `mksh`, `zsh`, and how the shell is chosen |
| [Warnings and quick fixes](warnings.md) | The quick fixes, the three levels of problems, how to silence a warning, what `--check` fails on |
| [The web page](web.md) | Files, the file type and the shell, problems, sharing, settings, keys, touch screens |
| [Limitations](limitations.md) | What is not read as bash reads it, and what the explanations assume |
| [Privacy](privacy.md) | Offline by design: no network, no AI, no telemetry, no external processes, and how that is checked |

## Command line, other editors and CI

The command-line tool, the Language Server and the GitHub Action are one npm package, [`bash-explainer`](https://www.npmjs.com/package/bash-explainer) (`npx bash-explainer`, or `npm install --global bash-explainer`). [Its README](../../cli/README.md) covers the options, the output formats (text, Markdown, JSON, SARIF, GitHub annotations), the set-up for Neovim, Helix and Emacs, and the action's inputs.

## More

- [CHANGELOG.md](../../CHANGELOG.md): what changed in each release.
- [CONTRIBUTING.md](../../CONTRIBUTING.md): how to build, test and release.
