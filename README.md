<img src="media/icon.png" width="96" alt="Bash Explainer icon">

# Bash Explainer

[![Visual Studio Marketplace](https://vsmarketplacebadges.dev/version/shun-fujioka.bash-explainer.svg)](https://marketplace.visualstudio.com/items?itemName=shun-fujioka.bash-explainer)
[![Open VSX](https://img.shields.io/open-vsx/v/shun-fujioka/bash-explainer?label=Open%20VSX)](https://open-vsx.org/extension/shun-fujioka/bash-explainer)
[![Test](https://github.com/sf624/bash-explainer/actions/workflows/test.yml/badge.svg)](https://github.com/sf624/bash-explainer/actions/workflows/test.yml)
[![Offline: no network, no AI, no telemetry](https://img.shields.io/badge/runtime-offline%20%C2%B7%20no%20AI%20%C2%B7%20no%20telemetry-2ea44f)](#privacy)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE) ![lang: English](https://img.shields.io/badge/lang-English-lightgrey)
[![lang: 日本語](https://img.shields.io/badge/lang-%E6%97%A5%E6%9C%AC%E8%AA%9E-blue)](./README.ja.md)

A Visual Studio Code extension that explains shell scripts line by line — like [regex101](https://regex101.com/), but for bash.

Hover a line and see what every command, option, redirection and `${…}` does, with worked examples you can edit. Useful for reading unfamiliar scripts, learning the shell, and teaching it.

![Bash Explainer demo](images/demo.gif)

## Quick start

1. Install **[Bash Explainer](https://marketplace.visualstudio.com/items?itemName=shun-fujioka.bash-explainer)** from the Visual Studio Marketplace.
2. Open a shell script (`.sh`, `.bash`, …).
3. Hover any line — or put the cursor on it and press `Ctrl+K Ctrl+E` (`Cmd+K Cmd+E` on macOS).

For a side pane that follows the cursor, click **Open in panel** at the bottom of the hover.

To try it without installing anything, open the **[web version](https://sf624.github.io/bash-explainer/)**, paste a script and move the cursor: the same explanations, in the browser.

No setup, and [offline by design](#privacy): no network, no AI, no telemetry. Scripts are parsed with [tree-sitter-bash](https://github.com/tree-sitter/tree-sitter-bash) and explained from built-in dictionaries, in English or Japanese.

## What it shows

| You write | Bash Explainer tells you |
| --- | --- |
| `tar -czf backup.tgz -C src .` | what `-c`, `-z`, `-f` and `-C src` each do |
| `cmd 2>&1 > out.log` | where stdout and stderr end up — and that errors do *not* go to the file here |
| `echo "${file%.*}"` | `file=report.tar.gz` → `report.tar` |
| `sed -E 's/^([a-z]+)=(.*)$/\2=\1/'` | the regex piece by piece, and a sample: `a=x` → `x=a` |
| `#!/bin/sh` … `[[ -f $f ]]` | ⚠ `[[ ]]` fails in dash — with a quick fix to `[ -f "$f" ]` |
| `RUN apt-get update && …` in a Dockerfile | the same explanations inside Dockerfiles, Makefiles, CI YAML, `package.json` and Python |

## Ways to show explanations

| | How | Default |
| --- | --- | --- |
| **Hover** | Hover a line, or press `Ctrl+K Ctrl+E` on the cursor line | on |
| **Panel** | A side pane that follows the cursor, colour-coded like regex101, where you can edit the example input and watch the result change | open it from the hover or the editor title bar |
| **Inline** | A faint one-line summary at the end of the cursor line | off |

Turn them on or off by clicking **Bash Explainer** in the status bar.

### Hover

Hover a line to see its breakdown, right where you are reading.

![Hover](images/hover.gif)

### Panel

The panel follows the cursor line by line. Point at a part of the tree to highlight it in the editor.

![Panel](images/panel.gif)

### Inline

A one-line summary at the end of the cursor line.

![Inline](images/inline.png)

## Installation

- **Marketplace:** [shun-fujioka.bash-explainer](https://marketplace.visualstudio.com/items?itemName=shun-fujioka.bash-explainer)
- **In VS Code:** open the Extensions view (`Ctrl+Shift+X` / `Cmd+Shift+X`) and search for *Bash Explainer*, or run `ext install shun-fujioka.bash-explainer` from Quick Open (`Ctrl+P` / `Cmd+P`).
- **Command line:** `code --install-extension shun-fujioka.bash-explainer`
- **VSCodium and other editors using Open VSX:** [open-vsx.org/extension/shun-fujioka/bash-explainer](https://open-vsx.org/extension/shun-fujioka/bash-explainer)
- **No installation:** the [web version](https://sf624.github.io/bash-explainer/) runs in the browser.

Requires VS Code 1.85 or later. There are no native dependencies (the parser is WebAssembly), so it runs wherever VS Code runs.

---

## The panel

The panel works like regex101:

- **Edit the examples.** Change the input of a worked example — grep and `[[ =~ ]]` test strings, sed, awk, jq, perl, `sort`, `cut`, `xargs`, whole pipelines — and the output updates as you type.
- **See what matched.** Matches are highlighted in the input, each capture group in its own colour, the same colour as the group in the explanation; a table shows what `\1`, `\2`, … captured.
- **Switch the shell or yq** for the current file from the header, and see the explanation and warnings change.
- **Fold** the explanation tree, **copy** it as Markdown for a review or a document, and open the searchable **quick reference** of expansions, redirections, tests, variables and commands.

## What is explained

| | Examples |
| --- | --- |
| Commands and options | about 120 commands and builtins (`grep`, `sed`, `awk`, `find`, `curl`, `tar`, `git`, `docker`, …); combined flags (`-rn`), values (`-o pipefail`, `--include=*.sh`), subcommands (`git commit`), commands run by others (`sudo`, `xargs`, `find -exec`) |
| Operators and redirections | `\|`, `&&`, `\|\|`, `;`, `&`, `>`, `>>`, `2>&1`, `&>`, here-documents, here-strings — including what the order of redirections does |
| Expansions | `${var:-default}`, `${file%.sh}`, `${#array[@]}`, `$?`, `$@`, `$(…)`, `<(…)`, `$((…))`, broken into their parts |
| Languages inside arguments | regular expressions (BRE, ERE or PCRE, as the options say), sed scripts, awk programs, jq and yq filters, perl one-liners, `printf` and `date` formats, `find` expressions, `chmod` modes, `sort -k` / `cut -f` / `tr` sets, `getopts` / `getopt` option strings, `git log --pretty` / `--date` |
| Control flow | `if`, `for`, `while`, `case`, functions; lines inside a block show where they are (*for loop › if statement*) |
| Idioms and pitfalls | `IFS= read -r`, the script-directory idiom, strict mode, `trap … EXIT`, `command -v … >/dev/null 2>&1`, … |

## Worked examples

Many constructs come with a made-up input and the output it produces. The built-in runners are checked against the real tools (GNU sed and coreutils, gawk, jq, perl, bash, git, yq) in the tests.

| For | You see |
| --- | --- |
| `grep` patterns, `[[ =~ ]]`, globs, `case` patterns | strings that match and strings that do not |
| `sed`, `awk`, `jq`, `yq`, `perl`, `sort`, `uniq`, `cut`, `tr`, `head`, `tail` | sample input → output |
| whole pipelines | the output after each stage |
| `${…}` expansions, `printf`, brace expansion | the resulting value |
| `[ ]`, `[[ ]]`, `(( ))` | values that make the test true and false |
| `xargs`, `read`, `getopt` | the commands that run, the variables that get set, how arguments are rearranged |
| `git log --pretty` / `--date` | the output for sample commits |

Examples appear right under the part they illustrate (see `bashExplainer.examples.placement`).

## Scripts for other shells

Explanations follow bash. When a script is written for another shell, Bash Explainer also points out what that shell does not have, and what behaves differently there:

```sh
#!/bin/sh
[[ -n $name ]] && echo -e "hi\t$name"
# ⚠ `[[ ]]` is not POSIX sh (it fails in dash). Instead, use `[ ]`.
# ⚠ `echo -e` is not POSIX sh (it fails in dash). Instead, use `printf` …
```

- **Shells:** POSIX `sh` (naming what fails in dash and busybox ash), `dash`, `ash`, `yash`, `ksh`, `mksh`, `zsh`. What works where was measured with each shell.
- **Which shell:** from the shebang (`#!/bin/sh`, `#!/usr/bin/env dash`, …), a `# shellcheck shell=` line or the file name — or set `bashExplainer.shell`.

## Shell code in other files

| File | What is explained |
| --- | --- |
| Dockerfile | `RUN` / `CMD` / `ENTRYPOINT` (shell form, `RUN <<EOF`, exec form, `["sh", "-c", "…"]`) and `SHELL [...]`; warns when a `RUN` pipe hides failures without `pipefail` |
| Makefile | recipes, with make's `$(VAR)`, `$@` and `$$` explained |
| CI YAML | GitHub Actions `run:` (workflows and `action.yml`, following `shell:` and `defaults`) and GitLab CI `script:`; warns when untrusted input like `${{ github.event.pull_request.title }}` is pasted into a script |
| `package.json` | `scripts` |
| Markdown | code blocks marked `sh`, `bash`, `console`, … |
| Python | `subprocess.run(…)`, `os.system(…)`, …; flags strings passed without `shell=True` and values pasted into a shell command |

Each snippet is checked for the shell that runs it (`/bin/sh` for Dockerfiles and Makefiles unless `SHELL` says otherwise). Choose which kinds of files with `bashExplainer.embedded.files`.

## yq

Three different tools are called `yq`, each with its own syntax: **mikefarah/yq v4**, **kislyuk/yq** (a jq wrapper) and the older **mikefarah/yq v3**. Bash Explainer tells which one a command is for — from its options, subcommands and functions, and from how yq is installed in the same file — and says so on the line:

> yq: explained as mikefarah/yq v4 (v4.22.1 or later). Because: `-o json` is a mikefarah/yq v4 option; `pick` is a mikefarah/yq function (jq has none)
> Works with: mikefarah/yq v4 (v4.22.1 or later) ✓ / kislyuk/yq ✗ (no `-o json`, `pick`) / mikefarah/yq v3 ✗ (no jq-style expressions, `-o json`)

The first release with each feature was measured on every 4.x minor release. When nothing tells, mikefarah/yq v4 is assumed; set `bashExplainer.yq.flavor` to fix the choice.

## Problems panel and quick fixes

Warnings also appear in the Problems panel, so you see them without hovering. Where a rewrite keeps the meaning, a quick fix is offered:

| Before | After |
| --- | --- |
| `[[ -f $f && -n $x ]]` | `[ -f "$f" ] && [ -n "$x" ]` |
| `[ "$a" == b ]` | `[ "$a" = b ]` |
| `source ./lib.sh` | `. ./lib.sh` |
| `function f {` | `f() {` |
| `cmd &> log` | `cmd > log 2>&1` |
| `cmd \|& tee log` | `cmd 2>&1 \| tee log` |

Fixes are offered only when the script's shell lacks the construct, and only when the meaning is kept: `[[ $f == *.txt ]]` is a pattern match, so it gets no fix. Each rewrite is checked to behave in dash as the original does in bash. To silence a warning, add `# bash-explainer disable=<code>` on the line before it (or after the code on the same line), `# bash-explainer disable-file=<code>` anywhere for the whole file, or list the code in `bashExplainer.diagnostics.ignore`; `all` matches every warning. Turn the Problems panel entries off with `bashExplainer.diagnostics.enabled`.

## Commands

| Command | Shortcut / where |
| --- | --- |
| Bash Explainer: Explain Bash on Current Line | `Ctrl+K Ctrl+E` / `Cmd+K Cmd+E` |
| Bash Explainer: Open Bash Explanation Panel | the editor title bar, the hover |
| Bash Explainer: Turn Hover, Inline and Panel On or Off | the status bar item |
| Bash Explainer: Open Settings | the hover and the panel |

## Settings

| Setting | Default | Description |
| --- | --- | --- |
| **Display** | | |
| `bashExplainer.hover.enabled` | `true` | Hover for the line under the mouse (`Ctrl+K Ctrl+E` works either way) |
| `bashExplainer.hover.followCursor` | `false` | Show the hover whenever the cursor moves |
| `bashExplainer.hover.followDelay` | `400` | Delay (ms) before it does |
| `bashExplainer.hover.maxDepth` | `0` | Levels of the explanation tree the hover shows (`0`: all) |
| `bashExplainer.panel.autoOpen` | `false` | Open the panel when a shell script is opened |
| `bashExplainer.inline.enabled` | `false` | One-line summary at the end of the cursor line |
| `bashExplainer.inline.maxLength` | `120` | Maximum length of that summary |
| `bashExplainer.examples.enabled` | `true` | Show worked examples at all |
| `bashExplainer.examples.disabled` | `[]` | Kinds of examples not to show: `regex`, `sed`, `awk`, `jq`, `yq`, `perl`, `textFilters`, `pipeline`, `expansion`, `printf`, `glob`, `test`, `xargs`, `read`, `getopt`, `gitLog` |
| `bashExplainer.examples.inHover` | `true` | Show examples in the hover too (off: only in the panel) |
| `bashExplainer.examples.placement` | `first` | Worked examples under the part they illustrate, before (`first`) or after (`last`) its pieces, or all at the end (`bottom`) |
| `bashExplainer.language` | `auto` | `auto` (follow VS Code), `en` or `ja` |
| `bashExplainer.notes.idioms` | `true` | Notes about well-known idioms (strict mode, `IFS= read -r`…) |
| **Checks** | | |
| `bashExplainer.shell` | `auto` | The shell scripts are written for: `auto`, `bash`, `sh`, `dash`, `ash`, `yash`, `ksh`, `mksh`, `zsh` |
| `bashExplainer.diagnostics.enabled` | `true` | Warnings in the Problems panel, with quick fixes |
| `bashExplainer.diagnostics.ignore` | `[]` | Warning codes to leave out (the code shown in the Problems panel, e.g. `dbracket`, `echoE`, `dockerPipefail`) |
| `bashExplainer.diagnostics.embedded` | `true` | Also warn about shell code inside other files |
| `bashExplainer.yq.flavor` | `auto` | `auto`, `mikefarah4`, `kislyuk` or `mikefarah3` |
| **Files** | | |
| `bashExplainer.embedded.files` | all | Files whose shell code is explained: `dockerfile`, `makefile`, `yaml`, `packageJson`, `markdown`, `python` |
| `bashExplainer.languages` | `["shellscript"]` | Language IDs explained as shell scripts |
| **Dictionary** | | |
| `bashExplainer.customCommands` | `{}` | Describe commands the dictionary does not know (see below) |

### Your own commands

In-house tools are shown as *external commands* until you describe them:

```json
"bashExplainer.customCommands": {
  "deploy": {
    "summary": "Deploy a service to production",
    "options": {
      "-n|--dry-run": "only show what would happen",
      "-e": { "description": "target environment", "takesValue": true }
    },
    "arguments": ["service name"]
  }
}
```

## Limitations

- Explanations are rule-based. Commands that are not in the dictionary are shown as an *external command* without option details.
- A few constructs are mis-parsed by the underlying grammar, e.g. `[[ -f a && $x =~ re ]]` (mixing `&&` with `=~`), and zsh-only syntax such as `*(.)`.

## Privacy

Bash Explainer works entirely offline by design:

- **No network access.** The extension contains no code that opens network connections, and the panel's Content Security Policy blocks external requests.
- **No AI.** Scripts are parsed with tree-sitter-bash and explained from built-in dictionaries, so the same line always gets the same explanation.
- **No telemetry.** The extension collects nothing.
- **No external processes.** Examples are computed by built-in code; your tools are never run.

A [CI check](test/offline.test.ts) fails the build if network or process APIs appear in the packaged extension ([latest runs](https://github.com/sf624/bash-explainer/actions/workflows/test.yml)). You can also verify this yourself: the `.vsix` is a zip archive, and the extension works with networking disabled.

The [web version](https://sf624.github.io/bash-explainer/) works the same way. GitHub Pages serves the page, but your script is parsed and explained in the browser and sent nowhere; the page's Content Security Policy allows no requests to other sites, and a link to a script carries it after `#`, which browsers do not send. The same CI check covers the page, and a test opens it in Chromium, blocking every request to other sites, and keeps using it offline.

This describes the extension and its web version, not VS Code, other extensions or your browser. It is provided as is, without warranty (see [LICENSE](LICENSE)); please evaluate it against your own requirements before using it with sensitive data.

## Release notes

See [CHANGELOG.md](CHANGELOG.md).

## Contributing

Issues and pull requests are welcome at [github.com/sf624/bash-explainer](https://github.com/sf624/bash-explainer).

```sh
npm install
npm run build      # bundle into dist/ (also copies the wasm files)
npm test           # type check + unit tests
npm run package    # build a .vsix
```

- Press `F5` in VS Code to launch an Extension Development Host with `test/fixtures/sample.sh` open.
- `npm run build:web` builds the web version into `site/`; `python3 -m http.server -d site` serves it at <http://localhost:8000/>.
- `npx tsx test/dump.ts <file> [en|ja] [line]` prints the explanation of every line of a file.
- Tests that compare with real tools use the shells on `PATH` or in `$BASH_EXPLAINER_SHELLS`, and the yq releases in `$BASH_EXPLAINER_YQ`; missing ones are skipped. The web page test needs Chromium (`npx playwright-core install --with-deps chromium-headless-shell`).
- To add a command, add an entry to [`src/dict/commands.ts`](src/dict/commands.ts): `cmd(japanese, english, [options…], { positional: […] })`.
- To release, bump `version` in `package.json`, add a section to `CHANGELOG.md`, and push a tag `v<version>`. The [Release workflow](.github/workflows/release.yml) tests and packages it, waits for approval in the `release` environment, then publishes to the VS Code Marketplace and Open VSX and creates a GitHub Release; see [docs/publishing.md](docs/publishing.md) for the one-time setup.

## License

[MIT](LICENSE). Third-party components are listed in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
