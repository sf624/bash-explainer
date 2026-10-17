# bash-explainer

Explains shell scripts line by line in the terminal — every command, option, redirection and `${…}` — with worked examples. The command-line companion of the [Bash Explainer](https://marketplace.visualstudio.com/items?itemName=shun-fujioka.bash-explainer) VS Code extension, with the same explanations.

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
                                      # package.json, Markdown and Python
bash-explainer --check install.sh     # constructs its shell (#!/bin/sh: dash…) lacks
```

| Option | |
| --- | --- |
| `-e`, `--command <text>` | explain this command line |
| `-l`, `--line <n>[-<m>]` | only these lines |
| `--check` | report constructs the script's shell lacks, and other risks (script injection in GitHub Actions, Docker `RUN` pipes without `pipefail`…); exit 1 if there is a warning |
| `--shell <name>` | the script's shell: `bash`, `sh`, `dash`, `ash`, `yash`, `ksh`, `mksh`, `zsh` (default: from the shebang or the file name) |
| `--kind <kind>` | what the file is: `shell`, `dockerfile`, `makefile`, `yaml`, `npm`, `markdown`, `python` (default: from the file name) |
| `--lang <en\|ja>` | language (default: from `LANG`) |
| `--format <format>` | `text`, `markdown` or `json` |
| `--no-examples` | leave out worked examples |
| `--color`, `--no-color` | colour the text output (default: when writing to a terminal; `NO_COLOR` turns it off) |

`--check` prints problems as compilers do (`file:line:column: warning: … [code]`), so editors and CI can pick them up.

## Privacy

Everything runs in the Node.js process: the tool contains no code that opens a network connection or starts a process, which a test checks on every change. See [Privacy](https://github.com/sf624/bash-explainer#privacy).

## License

[MIT](LICENSE). Third-party components: [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
