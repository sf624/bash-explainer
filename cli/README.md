# bash-explainer

Explains shell scripts line by line in the terminal — every command, option, redirection and `${…}` — with worked examples, and points out common pitfalls (unquoted variables, `x = 1`, `for f in $(ls)`…). The command-line companion of the [Bash Explainer](https://marketplace.visualstudio.com/items?itemName=shun-fujioka.bash-explainer) VS Code extension, with the same explanations.

**Offline by design:** no network, no AI, no telemetry. English and Japanese.

```console
$ npx bash-explainer --no-examples -e 'tar -czf backup.tgz -C src .'
(command):1  tar -czf backup.tgz -C src .
  tar -czf backup.tgz -C src .  Create or extract tar archives
    -czf  Combined short options -c -z -f
      -c  create an archive
      -z  gzip (.tar.gz)
      -f  archive file name
    backup.tgz  Value for -f
    -C  change to this directory first
    src  Value for -C
    …
```

## Installation

Requires Node.js 18 or later. The parser is WebAssembly, so there are no native dependencies: it runs wherever Node.js does.

- **Without installing:** `npx bash-explainer <file>` fetches the package on first use.
- **Installed:** `npm install --global bash-explainer`, then `bash-explainer <file>`. Use this when you run it often, or from an editor.
- **From source:** in a clone of [the repository](https://github.com/sf624/bash-explainer), `npm ci && npm run build:cli`, then `node cli/dist/cli.js <file>`.

## Usage

```sh
bash-explainer deploy.sh              # every line that does something
bash-explainer deploy.sh:12           # one line (or deploy.sh:12-20)
bash-explainer -e 'cmd 2>&1 > out'    # a command line
cat deploy.sh | bash-explainer -      # standard input
bash-explainer Dockerfile             # the shell code in Dockerfiles, Makefiles, CI YAML,
                                      # Jenkinsfiles, package.json, Markdown and Python
bash-explainer --check install.sh     # constructs its shell (#!/bin/sh: dash…) lacks
```

| Option | |
| --- | --- |
| `-e`, `--command <text>` | explain this command line |
| `-l`, `--line <n>[-<m>]` | only these lines |
| `--check` | report constructs the script's shell lacks, and other risks (script injection in GitHub Actions, Docker `RUN` pipes without `pipefail`…); exit 1 if there is a warning |
| `--shell <name>` | the script's shell: `bash`, `sh`, `dash`, `ash`, `yash`, `ksh`, `mksh`, `zsh` (default: from the shebang or the file name) |
| `--kind <kind>` | what the file is: `shell`, `dockerfile`, `makefile`, `yaml`, `npm`, `markdown`, `python`, `jenkinsfile` (default: from the file name) |
| `--lang <en\|ja>` | language (default: from `LANG`) |
| `--format <format>` | `text`, `markdown` or `json`; with `--check`, also `github` (annotations in GitHub Actions) or `sarif` (for code scanning) |
| `--no-examples` | leave out worked examples |
| `--lsp` | run as a Language Server on standard input and output (see [In your editor](#in-your-editor-language-server)) |
| `--color`, `--no-color` | colour the text output (default: when writing to a terminal; `NO_COLOR` turns it off) |

In the text output, a construct is labelled with its keywords and a placeholder for what is left out (`while` *condition* `do` *commands* `done`): the placeholder is in italics and dim with colour, and shown as `‹condition›` without. With `--format json`, `label` is that text and `labelParts` lists the parts (`{ "text": "while" }`, `{ "text": "condition", "placeholder": true }`…).

`--check` prints problems as compilers do (`file:line:column: warning: … [code]`), so editors and CI can pick them up. With `--format github` they become GitHub Actions annotations, shown on the pull request's diff; with `--format sarif`, a SARIF file for code scanning.

## In CI (GitHub Actions)

The repository is also a GitHub Action, which runs this tool at its own version:

```yaml
- uses: actions/checkout@v5
- uses: sf624/bash-explainer@v0
  with:
    files: '**/*.sh Dockerfile .github/workflows/*.yml'
```

`@v0` follows the latest 0.x release. To stay on one version, use its tag (`@v0.2.0`); to be sure the code cannot change, its commit SHA (`@<sha> # v0.2.0`), which Dependabot can keep up to date.

![Warnings from the action on a pull request's diff](https://raw.githubusercontent.com/sf624/bash-explainer/main/images/action-annotations.png)

Warnings appear on the pull request's diff, and fail the step (`fail-on-warning: 'false'` keeps it green). The inputs: `files` (bash globs; default `**/*.sh`), `shell` (default: from each script), `fail-on-warning`, `sarif` (also write a SARIF file, for `github/codeql-action/upload-sarif`) and `package` (another npm package spec to run). The output `warnings` is the number of warnings. In other CI systems, run `npx bash-explainer --check <files>` and use the exit status.

## In your editor (Language Server)

`bash-explainer --lsp` is a Language Server on standard input and output: hover a line for its explanation, and get the warnings with their quick fixes, in any editor that speaks LSP. It handles shell scripts (language IDs `sh`, `bash`, `zsh`, `shellscript`…) and the shell code in Dockerfiles, Makefiles, YAML, `package.json`, Markdown, Python and Jenkinsfiles. It runs next to other servers, such as bash-language-server.

Install it with `npm install --global bash-explainer` (see [Installation](#installation)), so the editor does not wait for `npx`.

**Neovim** (0.11 or later), in `init.lua`:

```lua
vim.lsp.config('bash_explainer', {
  cmd = { 'bash-explainer', '--lsp' },
  filetypes = { 'sh', 'bash', 'zsh', 'dockerfile', 'make', 'yaml', 'groovy' },
  root_markers = { '.git' },
  -- init_options = { language = 'ja', shell = 'dash' },
})
vim.lsp.enable('bash_explainer')
```

**Helix**, in `languages.toml`:

```toml
[language-server.bash-explainer]
command = "bash-explainer"
args = ["--lsp"]

[[language]]
name = "bash"
language-servers = ["bash-language-server", "bash-explainer"]
```

**Emacs** (Eglot, one server per mode):

```elisp
(with-eval-after-load 'eglot
  (add-to-list 'eglot-server-programs '((sh-mode bash-ts-mode) . ("bash-explainer" "--lsp"))))
```

Settings, as `initializationOptions` or through `workspace/didChangeConfiguration` (under `bashExplainer`): `language` (`en` or `ja`; default from `LANG`), `shell` (the shell to check for; default: from the file), `examples` (`false` leaves out worked examples).

## Privacy

Everything runs in the Node.js process: the tool contains no code that opens a network connection or starts a process, which a test checks on every change. See [Privacy](https://github.com/sf624/bash-explainer#privacy).

## License

[MIT](LICENSE). Third-party components: [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
