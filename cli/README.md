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
| `--check` | report constructs the script's shell lacks, other risks (script injection in GitHub Actions, Docker `RUN` pipes without `pipefail`…) and the pitfalls of a script (`x = 1`, `rm -rf $DIR/*`…); exit 1 if there is a warning, other than on a pitfall |
| `--strict` | with `--check`, also exit 1 if there is a warning on a pitfall |
| `--shell <name>` | the script's shell: `bash`, `sh`, `dash`, `ash`, `yash`, `ksh`, `mksh`, `zsh` (default: from the shebang or the file name) |
| `--kind <kind>` | what the file is: `shell`, `dockerfile`, `makefile`, `yaml`, `npm`, `markdown`, `python`, `jenkinsfile` (default: from the file name) |
| `--lang <en\|ja>` | language (default: from `LANG`) |
| `--sarif <file>` | with `--check`, also write the problems to this file as SARIF, whatever `--format` prints (so one run gives annotations and a SARIF file) |
| `--format <format>` | `text`, `markdown` or `json`; with `--check`, also `github` (annotations in GitHub Actions) or `sarif` (for code scanning) |
| `--no-examples` | leave out worked examples |
| `--config <file>` | read the settings from this file (see [Settings](#settings)) |
| `--no-config` | read no settings file |
| `--set <key>=<value>` | set one setting, as named in VS Code (`--set shell=dash`, `--set notes.idioms=false`); may be repeated |
| `--print-config` | print the settings in effect, as JSON |
| `--lsp` | run as a Language Server on standard input and output (see [In your editor](#in-your-editor-language-server)) |
| `--color`, `--no-color` | colour the text output (default: when writing to a terminal; `NO_COLOR` turns it off) |

In the text output, a construct is labelled with its keywords and a placeholder for what is left out (`while` *condition* `do` *commands* `done`): the placeholder is in italics and dim with colour, and shown as `‹condition›` without. With `--format json`, `label` is that text and `labelParts` lists the parts (`{ "text": "while" }`, `{ "text": "condition", "placeholder": true }`…).

A row or a note about a part of bash ends with the sections of the GNU Bash Reference Manual it is about: `(Bash manual 3.7.2)` in the text output, links to the sections on gnu.org with `--format markdown`. The numbers are those of the bash 5.2 manual. With `--format json`, a token has them in `refs` (`["3.7.2"]`), and `facts` lists the notes that come from the message catalog, with their `id`, `kind` (`note` or `pitfall`), `text` and `refs`.

`--check` prints problems as compilers do (`file:line:column: warning: … [code]`), so editors and CI can pick them up. With `--format github` they become GitHub Actions annotations, shown on the pull request's diff; with `--format sarif`, a SARIF file for code scanning (a warning is a `warning` result, information a `note`).

The pitfalls of a shell script are problems too, with their own codes: a warning for what breaks the script, information for the rest. They make `--check` fail only with `--strict`, so a CI that passed before keeps passing; turn them off with `--set diagnostics.pitfalls=false`.

```text
$ bash-explainer --check deploy.sh
deploy.sh:2:10: warning: Pitfall: the output of $(ls …) is split on spaces and newlines, so file names with spaces break. Use a glob, as in for f in *.txt [for-over-ls-output]
deploy.sh:4:1: warning: Pitfall: x =… runs a command named x; it is not an assignment. Write x=… with no spaces around = [assignment-with-spaces]
$ echo $?
0
```

## Settings

The tool takes the settings of the VS Code extension that have a meaning in a terminal: `language`, `notes.idioms`, `notes.pitfalls`, `shell`, `yq.flavor`, `diagnostics.ignore`, `diagnostics.embedded`, `diagnostics.pitfalls`, `examples.enabled`, `examples.disabled` and `customCommands` (see [Settings](https://github.com/sf624/bash-explainer#settings) for what each one does). They come from a JSON file with the keys of VS Code's `settings.json`, with or without `bashExplainer.`; comments and trailing commas are allowed, and nested objects too (`{ "notes": { "idioms": false } }`):

```jsonc
{
  // The shell to check scripts for, whatever their shebang says.
  "bashExplainer.shell": "sh",
  "bashExplainer.language": "ja",
  "bashExplainer.diagnostics.ignore": ["crlf"],
  "bashExplainer.examples.disabled": ["date"],
  "bashExplainer.customCommands": {
    "deploy": {
      "summary": "Deploy a service to production",
      "options": [{ "names": ["-n", "--dry-run"], "description": "only show what would happen" }]
    }
  }
}
```

The file is the one given with `--config`, else the one in `$BASH_EXPLAINER_CONFIG`, else `$XDG_CONFIG_HOME/bash-explainer/settings.json` (`~/.config/bash-explainer/settings.json` when `XDG_CONFIG_HOME` is not set). The last one may be missing; a file named with `--config` or `$BASH_EXPLAINER_CONFIG` must be there, and a file that is not JSON is an error (exit status 2). `--no-config` reads none. An unknown key, or a value of the wrong type, is left out with a warning on standard error. Settings that have a meaning only in VS Code or the Language Server (`hover.enabled`, `panel.autoOpen`…) are accepted and left alone, so the file can be a copy of the editor's settings.

`--set key=value` sets one setting; the value is read as JSON when it is JSON (`false`, `["crlf"]`), else as a string (`dash`). Each source overrides the ones before it:

1. the defaults,
2. the settings file,
3. `--set`,
4. `--lang`, `--shell` and `--no-examples`.

`--print-config` prints the settings in effect, as JSON that can be saved as a settings file:

```console
$ bash-explainer --set shell=dash --print-config
{
  "bashExplainer.language": "auto",
  "bashExplainer.notes.idioms": true,
  "bashExplainer.notes.pitfalls": true,
  "bashExplainer.shell": "dash",
  …
}
```

With `language` set to `auto` (the default), the language follows `LC_ALL`, `LC_MESSAGES` or `LANG`.

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

Warnings appear on the pull request's diff, and fail the step (`fail-on-warning: 'false'` keeps it green); the pitfalls appear too, but fail it only with `strict: 'true'`. The inputs: `files` (bash globs; default `**/*.sh`), `shell` (default: from each script), `fail-on-warning`, `strict` (also fail on a warning on a pitfall; default `'false'`), `sarif` (also write a SARIF file, for `github/codeql-action/upload-sarif`) and `package` (another npm package spec to run). The outputs: `warnings`, the number of warnings that fail the step (those on pitfalls only with `strict`), and `pitfalls`, the number of pitfalls (warnings and notices). The annotations of pitfalls are titled `Bash Explainer (pitfall): <code>`, and those that fail the step come first, since GitHub shows only the first annotations of a step. `strict` needs a tool with `--strict`: with a `package` pin to an older one, the step fails and says so. In other CI systems, run `npx bash-explainer --check <files>` and use the exit status.

## In your editor (Language Server)

`bash-explainer --lsp` is a Language Server on standard input and output: hover a line for its explanation, and get the warnings with their quick fixes, in any editor that speaks LSP. With `highlight.enabled` on, it also colours the shell code (semantic tokens, from the same syntax tree as the explanations). It handles shell scripts (language IDs `sh`, `bash`, `zsh`, `shellscript`…) and the shell code in Dockerfiles, Makefiles, YAML, `package.json`, Markdown, Python and Jenkinsfiles. It runs next to other servers, such as bash-language-server.

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

Settings: the keys of the VS Code extension's settings that have a meaning here, as `initializationOptions` or through `workspace/didChangeConfiguration`, under `bashExplainer` or not, flat (`"diagnostics.ignore": ["crlf"]`) or nested (`diagnostics = { ignore = { 'crlf' } }`): `language`, `notes.idioms`, `notes.pitfalls`, `shell`, `yq.flavor`, `diagnostics.enabled`, `diagnostics.ignore`, `diagnostics.embedded`, `diagnostics.pitfalls`, `examples.enabled`, `examples.disabled`, `examples.inHover`, `hover.enabled`, `hover.maxDepth`, `highlight.enabled`, `languages` (more language IDs to read as shell scripts), `embedded.files` and `customCommands`. `examples: false`, as earlier releases read it, still turns the examples off. Under what the editor sends, the server reads the [settings file](#settings) of the command-line tool (also `--lsp --config <file>`). Keys and values it cannot use are reported in the editor's log (`window/logMessage`).

## Privacy

Everything runs in the Node.js process: the tool contains no code that opens a network connection or starts a process, which a test checks on every change. See [Privacy](https://github.com/sf624/bash-explainer#privacy).

## License

[MIT](LICENSE). Third-party components: [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
