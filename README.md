# Bash Explainer

[![Visual Studio Marketplace](https://vsmarketplacebadges.dev/version/shun-fujioka.bash-explainer.svg)](https://marketplace.visualstudio.com/items?itemName=shun-fujioka.bash-explainer)
[![Open VSX](https://img.shields.io/open-vsx/v/shun-fujioka/bash-explainer?label=Open%20VSX)](https://open-vsx.org/extension/shun-fujioka/bash-explainer)
[![Test](https://github.com/sf624/bash-explainer/actions/workflows/test.yml/badge.svg?branch=main&event=push)](https://github.com/sf624/bash-explainer/actions/workflows/test.yml?query=branch%3Amain+event%3Apush)
[![Coverage: 100% of lines and branches](https://img.shields.io/badge/coverage-100%25-brightgreen)](https://github.com/sf624/bash-explainer/actions/workflows/test.yml)
[![Offline: no network, no AI, no telemetry](https://img.shields.io/badge/runtime-offline%20%C2%B7%20no%20AI%20%C2%B7%20no%20telemetry-2ea44f)](#privacy)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE) ![lang: English](https://img.shields.io/badge/lang-English-lightgrey)
[![lang: 日本語](https://img.shields.io/badge/lang-%E6%97%A5%E6%9C%AC%E8%AA%9E-blue)](./README.ja.md)

Explains shell scripts line by line — like [regex101](https://regex101.com/), but for bash.

Hover a line and see what every command, option, redirection and `${…}` does, with worked examples you can edit. Useful for reading unfamiliar scripts, learning the shell, and teaching it.

**No setup, and [offline by design](#privacy):** no network, no AI, no telemetry. In English and Japanese.

![Bash Explainer demo](images/demo.gif)

Bash Explainer is a VS Code extension, and more: the same explanations and warnings also come as a web page you can try without installing anything, a command-line tool, a Language Server for other editors, and a GitHub Action that checks scripts in pull requests.

## Where to use it

| Where | How |
| --- | --- |
| **VS Code** | Install **[Bash Explainer](https://marketplace.visualstudio.com/items?itemName=shun-fujioka.bash-explainer)** from the Marketplace, open a shell script and hover a line. See [In VS Code](#in-vs-code). |
| VSCodium and other editors using Open VSX | [open-vsx.org/extension/shun-fujioka/bash-explainer](https://open-vsx.org/extension/shun-fujioka/bash-explainer) |
| vscode.dev and github.dev | The same extension works in VS Code for the Web (press `.` in a GitHub repository). |
| **Browser**, no installation | The [web version](https://sf624.github.io/bash-explainer/): paste a script and move the cursor. The [development version](https://sf624.github.io/bash-explainer/next/) is built from `main` and may differ from the release. |
| **Terminal** | `npx bash-explainer deploy.sh:12`, or `npm install --global bash-explainer`. See [cli/README.md](cli/README.md#installation). |
| **Neovim, Helix, Emacs** and other LSP editors | `bash-explainer --lsp`, a Language Server with the same hovers, warnings and quick fixes. See [In your editor](cli/README.md#in-your-editor-language-server). |
| **CI** | `uses: sf624/bash-explainer@v0` in GitHub Actions puts the warnings on the pull request's diff; elsewhere, `npx bash-explainer --check`. See [In CI](cli/README.md#in-ci-github-actions). |

## What it shows

| You write | Bash Explainer tells you |
| --- | --- |
| `tar -czf backup.tgz -C src .` | what `-c`, `-z`, `-f` and `-C src` each do |
| `cmd 2>&1 > out.log` | where stdout and stderr end up — and that errors do *not* go to the file here |
| `echo "${file%.*}"` | `file=report.tar.gz` → `report.tar` |
| `sed -E 's/^([a-z]+)=(.*)$/\2=\1/'` | the regex piece by piece, and a sample: `a=x` → `x=a` |
| `#!/bin/sh` … `[[ -f $f ]]` | ⚠ `[[ ]]` fails in dash — with a quick fix to `[ -f "$f" ]` |
| `RUN apt-get update && …` in a Dockerfile | the same explanations inside Dockerfiles, Makefiles, CI YAML, Jenkinsfiles, `package.json` and Python |

## What is explained

| | Examples |
| --- | --- |
| Commands and options | about 330 commands and builtins (`grep`, `sed`, `awk`, `find`, `curl`, `tar`, `git`, `docker`, `apt-get`, `gpg`, `systemctl`, `kubectl`, `helm`, `terraform`, `aws`, `go`, …); combined flags (`-rn`), values (`-o pipefail`, `--include=*.sh`), subcommands (`git commit`), commands run by others (`sudo`, `xargs`, `find -exec`) |
| Operators and redirections | `\|`, `&&`, `\|\|`, `;`, `&`, `>`, `>>`, `2>&1`, `&>`, here-documents, here-strings — including what the order of redirections does |
| Expansions | `${var:-default}`, `${file%.sh}`, `${#array[@]}`, `$?`, `$@`, `$(…)`, `<(…)`, `$((…))`, broken into their parts |
| Languages inside arguments | regular expressions (BRE, ERE or PCRE, as the options say), sed scripts, awk programs, jq and yq filters, perl one-liners, `printf` and `date` formats, `find` expressions, `chmod` modes, `sort -k` / `cut -f` / `tr` sets, `getopts` / `getopt` option strings, `git log --pretty` / `--date` |
| Control flow | `if`, `for`, `while`, `case`, functions; lines inside a block show where they are (*for loop › if statement*) |
| Idioms and pitfalls | `IFS= read -r`, the script-directory idiom, strict mode, `trap … EXIT`, `command -v … >/dev/null 2>&1`, …; and what goes wrong in `x = 1`, `rm -rf $DIR/…` with an empty `DIR`, unquoted variables, `for f in $(ls)`, `read` without `-r`, `local x=$(cmd)`, `sudo cmd > /etc/…` |

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
| `date +FORMAT` | the output at two fixed moments; edit them in the panel |

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
| CI YAML | GitHub Actions `run:` (workflows and `action.yml`, following `shell:` and `defaults`), GitLab CI `script:`, CircleCI `run:` / `command:`, and Azure Pipelines `script:` / `bash:` with its `$(variable)` macros; warns when untrusted input like `${{ github.event.pull_request.title }}` is pasted into a script |
| `package.json` | `scripts` |
| Markdown | code blocks marked `sh`, `bash`, `console`, … |
| Python | `subprocess.run(…)`, `os.system(…)`, …; flags strings passed without `shell=True` and values pasted into a shell command |
| Jenkinsfile | `sh '…'`, `sh "…"`, `sh '''…'''`, `sh(script: …)`; points out the `$name` and `${…}` that Groovy fills in before the shell runs |

Each snippet is checked for the shell that runs it (`/bin/sh` for Dockerfiles and Makefiles unless `SHELL` says otherwise). Choose which kinds of files with `bashExplainer.embedded.files`.

## yq

Three different tools are called `yq`, each with its own syntax: **mikefarah/yq v4**, **kislyuk/yq** (a jq wrapper) and the older **mikefarah/yq v3**. Bash Explainer tells which one a command is for — from its options, subcommands and functions, and from how yq is installed in the same file — and says so on the line:

> yq: explained as mikefarah/yq v4 (v4.22.1 or later). Because: `-o json` is a mikefarah/yq v4 option; `pick` is a mikefarah/yq function (jq has none)
> Works with: mikefarah/yq v4 (v4.22.1 or later) ✓ / kislyuk/yq ✗ (no `-o json`, `pick`) / mikefarah/yq v3 ✗ (no jq-style expressions, `-o json`)

The first release with each feature was measured on every 4.x minor release. When nothing tells, mikefarah/yq v4 is assumed; set `bashExplainer.yq.flavor` to fix the choice.

## Warnings and quick fixes

Warnings appear in VS Code's Problems panel, so you see them without hovering, and the same warnings come from the command-line tool (`--check`), the Language Server and the GitHub Action. Where a rewrite keeps the meaning, a quick fix is offered:

| Before | After |
| --- | --- |
| `[[ -f $f && -n $x ]]` | `[ -f "$f" ] && [ -n "$x" ]` |
| `[ "$a" == b ]` | `[ "$a" = b ]` |
| `source ./lib.sh` | `. ./lib.sh` |
| `function f {` | `f() {` |
| `cmd &> log` | `cmd > log 2>&1` |
| `cmd \|& tee log` | `cmd 2>&1 \| tee log` |

Fixes are offered only when the script's shell lacks the construct, and only when the meaning is kept: `[[ $f == *.txt ]]` is a pattern match, so it gets no fix. Each rewrite is checked to behave in dash as the original does in bash. To silence a warning, add `# bash-explainer disable=<code>` on the line before it (or after the code on the same line), `# bash-explainer disable-file=<code>` anywhere for the whole file, or list the code in `bashExplainer.diagnostics.ignore`; `all` matches every warning. Turn the Problems panel entries off with `bashExplainer.diagnostics.enabled`.

## In VS Code

### Quick start

1. Install **[Bash Explainer](https://marketplace.visualstudio.com/items?itemName=shun-fujioka.bash-explainer)** from the Visual Studio Marketplace.
2. Open a shell script (`.sh`, `.bash`, …).
3. Hover any line — or put the cursor on it and press `Ctrl+K Ctrl+E` (`Cmd+K Cmd+E` on macOS).

For a side pane that follows the cursor, click **Open in panel** at the bottom of the hover.

### Installation

- **Marketplace:** [shun-fujioka.bash-explainer](https://marketplace.visualstudio.com/items?itemName=shun-fujioka.bash-explainer)
- **In VS Code:** open the Extensions view (`Ctrl+Shift+X` / `Cmd+Shift+X`) and search for *Bash Explainer*, or run `ext install shun-fujioka.bash-explainer` from Quick Open (`Ctrl+P` / `Cmd+P`).
- **Command line:** `code --install-extension shun-fujioka.bash-explainer`
- **VSCodium and other editors using Open VSX:** [open-vsx.org/extension/shun-fujioka/bash-explainer](https://open-vsx.org/extension/shun-fujioka/bash-explainer)
- **VS Code for the Web:** the extension also works on [vscode.dev](https://vscode.dev) and [github.dev](https://github.dev) (press `.` in a GitHub repository).

Requires VS Code 1.85 or later. There are no native dependencies (the parser is plain JavaScript), so it runs wherever VS Code runs.

### Ways to show explanations

| | How | Default |
| --- | --- | --- |
| **Hover** | Hover a line, or press `Ctrl+K Ctrl+E` on the cursor line | on |
| **Panel** | A side pane that follows the cursor, colour-coded like regex101, where you can edit the example input and watch the result change | open it from the hover or the editor title bar |
| **Inline** | A faint one-line summary at the end of the cursor line | off |

Turn them on or off by clicking **Bash Explainer** in the status bar.

#### Hover

Hover a line to see its breakdown, right where you are reading.

![Hover](images/hover.gif)

#### Panel

The panel follows the cursor line by line. Point at a part of the tree to highlight it in the editor.

![Panel](images/panel.gif)

#### Inline

A one-line summary at the end of the cursor line.

![Inline](images/inline.png)

### The panel

The panel works like regex101:

- **Edit the examples.** Change the input of a worked example — grep and `[[ =~ ]]` test strings, sed, awk, jq, perl, `sort`, `cut`, `xargs`, whole pipelines — and the output updates as you type.
- **See what matched.** Matches are highlighted in the input, each capture group in its own colour, the same colour as the group in the explanation; a table shows what `\1`, `\2`, … captured.
- **Switch the shell or yq** for the current file from the header, and see the explanation and warnings change.
- **Fold** the explanation tree, **copy** it as Markdown for a review or a document, and open the searchable **quick reference** of expansions, redirections, tests, variables and commands.

### Commands

| Command | Shortcut / where |
| --- | --- |
| Bash Explainer: Explain Bash on Current Line | `Ctrl+K Ctrl+E` / `Cmd+K Cmd+E` |
| Bash Explainer: Open Bash Explanation Panel | the editor title bar, the hover |
| Bash Explainer: Turn Hover, Inline and Panel On or Off | the status bar item |
| Bash Explainer: Open Settings | the hover and the panel |

### Settings

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
| `bashExplainer.examples.disabled` | `[]` | Kinds of examples not to show: `regex`, `sed`, `awk`, `jq`, `yq`, `perl`, `textFilters`, `pipeline`, `expansion`, `printf`, `glob`, `test`, `xargs`, `read`, `getopt`, `gitLog`, `date` |
| `bashExplainer.examples.inHover` | `true` | Show examples in the hover too (off: only in the panel) |
| `bashExplainer.examples.placement` | `first` | Worked examples under the part they illustrate, before (`first`) or after (`last`) its pieces, or all at the end (`bottom`) |
| `bashExplainer.language` | `auto` | `auto` (follow VS Code), `en` or `ja` |
| `bashExplainer.notes.idioms` | `true` | Notes about well-known idioms (strict mode, `IFS= read -r`…) |
| `bashExplainer.notes.pitfalls` | `true` | Point out common mistakes and how to avoid them (`x = 1`, unquoted variables, `for f in $(ls)`…) |
| **Checks** | | |
| `bashExplainer.shell` | `auto` | The shell scripts are written for: `auto`, `bash`, `sh`, `dash`, `ash`, `yash`, `ksh`, `mksh`, `zsh` |
| `bashExplainer.diagnostics.enabled` | `true` | Warnings in the Problems panel, with quick fixes |
| `bashExplainer.diagnostics.ignore` | `[]` | Warning codes to leave out (the code shown in the Problems panel, e.g. `dbracket`, `echoE`, `dockerPipefail`) |
| `bashExplainer.diagnostics.embedded` | `true` | Also warn about shell code inside other files |
| `bashExplainer.yq.flavor` | `auto` | `auto`, `mikefarah4`, `kislyuk` or `mikefarah3` |
| **Files** | | |
| `bashExplainer.embedded.files` | all | Files whose shell code is explained: `dockerfile`, `makefile`, `yaml`, `packageJson`, `markdown`, `python`, `jenkinsfile` |
| `bashExplainer.languages` | `["shellscript"]` | Language IDs explained as shell scripts |
| **Dictionary** | | |
| `bashExplainer.customCommands` | `{}` | Describe commands the dictionary does not know (see below) |

#### Your own commands

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

## Command line, other editors and CI

The command-line tool, the Language Server and the GitHub Action are one npm package, [`bash-explainer`](cli/README.md). Its README covers the options, the output formats (text, Markdown, JSON, SARIF, GitHub annotations), the set-up for Neovim, Helix and Emacs, and the action's inputs.

## Limitations

- Explanations are rule-based. Commands that are not in the dictionary are shown as an *external command* without option details.
- A few constructs are not read as bash reads them: zsh-only syntax such as `*(.)` and `${(f)var}` (with the shell set to zsh, such a line is marked as not parsed), `echo (` (bash: syntax error; it is accepted without an error), and the base-64 digit `@` in arithmetic next to other terms (`$((64#@))` alone is read as 62, but in `$((64#@ + 1))` the whole expression becomes one word). In a `[ ]`, the arguments are grouped by bash's own rules for `test` (`-o` below `-a` below `!`; `-a` and `-o` as unary operators where an operand is expected), whatever the parser says.
- A script with Windows line endings (CRLF) is explained as if it had LF, and a warning (`crlf`, on the last word of the first such line) says that bash reads the CR as part of the last word of each line. To keep the file as it is, write `# bash-explainer disable-file=crlf` on a line of its own (the first line is the shebang, so `disable=` before it is not possible). A here-document in such a script has no closing line, as in bash.

## Privacy

Bash Explainer works entirely offline by design:

- **No network access.** The extension contains no code that opens network connections, and the panel's Content Security Policy blocks external requests.
- **No AI.** Scripts are parsed with [unbash](https://github.com/webpro-nl/unbash), a JavaScript parser bundled into the extension, and explained from built-in dictionaries, so the same line always gets the same explanation.
- **No telemetry.** The extension collects nothing.
- **No external processes.** Examples are computed by built-in code; your tools are never run.

A [CI check](test/offline.test.ts) fails the build if network or process APIs appear in the packaged extension ([latest runs](https://github.com/sf624/bash-explainer/actions/workflows/test.yml)). [Integration tests](integration/extension.itest.ts) also run the packaged extension in VS Code — on Linux with no network at all — and fail if it opens a connection or starts a process. You can also verify this yourself: the `.vsix` is a zip archive, and the extension works with networking disabled.

The [web version](https://sf624.github.io/bash-explainer/) works the same way. GitHub Pages serves the page, but your script is parsed and explained in the browser and sent nowhere; the page's Content Security Policy allows no requests to other sites, and a link to a script carries it after `#`, which browsers do not send. The same CI check covers the page, and a test opens it in Chromium, blocking every request to other sites, and keeps using it offline.

In VS Code for the Web, the extension runs in your browser; VS Code loads its files (including the parser) from the Marketplace, but your scripts are explained there and sent nowhere.

The [command-line tool](cli/README.md), which is also the Language Server, works the same way: it contains no code that opens a network connection or starts a process, which the same CI check covers, and a test runs it with network and process modules blocked. Only getting it uses the network: `npx` and the GitHub Action download it from npm; installed, it runs offline.

This describes the extension, its web version and the command-line tool, not VS Code, other extensions, your browser, npm or GitHub Actions. It is provided as is, without warranty (see [LICENSE](LICENSE)); please evaluate it against your own requirements before using it with sensitive data.

## Release notes

See [CHANGELOG.md](CHANGELOG.md).

## Contributing

Issues and pull requests are welcome at [github.com/sf624/bash-explainer](https://github.com/sf624/bash-explainer).

```sh
npm install
npm run build      # bundle into dist/
npm test           # type check + unit tests
npm run coverage   # unit tests with coverage (report in coverage/index.html)
npm run package    # build a .vsix
npx tsx scripts/extract-snippets.ts   # after changing the scripts in the tests: rewrite test/fixtures/snippets.json, the inputs of the syntax tests and the fuzz (CI runs it with --check)
npm run test:integration   # run the extension in VS Code (downloaded into .vscode-test/)
npm run test:integration:web   # …and in VS Code for the Web (needs `npx playwright install chromium`)
```

- Press `F5` in VS Code to launch an Extension Development Host with `test/fixtures/playground.sh` open (a gitignored copy of `sample.sh`, the tour of every feature, made when it is missing; edit it freely), with the panel beside it (`.vscode/playground.code-workspace` turns on `bashExplainer.panel.autoOpen`). F5 first runs `npm install`, so `node_modules` follows `package-lock.json` after a pull.
- `npm run build:web` builds the web version into `site/` (`-- --channel=next` builds the development version shown at `/next/`, with its banner); `python3 -m http.server -d site` serves it at <http://localhost:8000/>.
- `npx tsx test/dump.ts <file> [en|ja] [line]` prints the explanation of every line of a file.
- To try the command-line tool from this repository, `npm run build:cli`, then `node cli/dist/cli.js <file>` (or `npx --package=./cli bash-explainer <file>`). A bare `npx bash-explainer` does not work here: the extension's own `package.json` is also named `bash-explainer`, so npx takes this project for the package.
- Tests that compare with real tools use the shells on `PATH` or in `$BASH_EXPLAINER_SHELLS`, and the yq releases in `$BASH_EXPLAINER_YQ`; missing ones are skipped. `test/bash-ast.test.ts` compares the syntax tree with bash's own parser through [bash-ast](https://github.com/cv/bash-ast) (GPL: used only as an external program, never a dependency or part of a bundle), found at `$BASH_AST` or on `PATH`; without it the test is skipped. CI runs it with the pinned release v0.3.3 (`bash-ast-v0.3.3-x86_64-unknown-linux-gnu.tar.gz` from <https://github.com/cv/bash-ast/releases/tag/v0.3.3>; the known differences are those of this version), downloaded on each run, checked by its SHA-256 and never stored or redistributed; set `BASH_EXPLAINER_BASH_AST=1` to fail instead of skipping when it cannot be run. To run only this test: `npx mocha --no-config --node-option import=tsx test/bash-ast.test.ts` (`--spec` would add to the whole suite). Its known differences are listed, with reasons, in `test/fixtures/bash-ast-known.json`; the test fails on a new difference and on an entry that no longer applies. The web page test needs Chromium (`npx playwright-core install --with-deps chromium-headless-shell`).
- CI measures the coverage of the unit tests with every tool installed (the Node.js 24 job): the run's summary lists the least covered files, and the `coverage` artifact holds the HTML report. Measured locally, it is lower when tools are missing, as their tests are skipped; use Node.js 24 as CI does, since older versions count methods that never ran as covered. `npm run coverage` runs in UTC, as CI does, since some branches depend on the time zone. The reports leave out the code that tsx adds when it compiles the sources for the tests (its helpers, the getters of exports), which maps to places no test can run ([scripts/coverage-report.mjs](scripts/coverage-report.mjs)).
- Every line of `src/` must run in a unit test, and every branch must be taken, or CI fails (`npm run coverage:check`). Files not there yet are listed in [coverage-floors.json](coverage-floors.json) with their current share, which must not go down; after adding tests, `node scripts/coverage-check.mjs --update` raises the floors and drops the files that reach 100%. A branch no test can take is removed, or, when it guards against a bug elsewhere, marked with `/* c8 ignore next */` and a comment saying why. The VS Code side (`extension.ts`, `service.ts`, `ui/` except the renderers) is left to the integration tests. The coverage badge at the top is static; it stays true because CI fails below 100%.
- After changing dependencies, run `npm run notices` to regenerate [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) from what the builds include; a test fails while it is out of date, or if something under a license not yet reviewed gets in.
- Japanese text follows [docs/japanese-style.md](docs/japanese-style.md) (in Japanese); a test checks it.
- To add a command, add an entry to [`src/dict/commands.ts`](src/dict/commands.ts): `cmd(japanese, english, [options…], { positional: […] })`. Write the descriptions in your own words: do not copy them from man pages, `--help` output or other documentation, whose licenses (often the GPL or the GFDL) differ from this project's.
- To release, bump `version` in `package.json` and `cli/package.json`, add a section to `CHANGELOG.md`, and push a tag `v<version>`. The [Release workflow](.github/workflows/release.yml) tests and packages it, waits for approval in the `release` environment, then publishes to the VS Code Marketplace, Open VSX and npm, creates a GitHub Release, moves the `v0` tag the GitHub Action is used by, and updates the web version; see [docs/publishing.md](docs/publishing.md) for the steps and the one-time setup.

## License

[MIT](LICENSE). Third-party components are listed in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
