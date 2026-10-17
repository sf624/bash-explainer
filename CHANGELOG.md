# Changelog

## Unreleased

- Pitfalls are pointed out where they appear, with how to avoid them: `x = 1` (a command, not an assignment), `rm -rf $DIR/…` when `DIR` may be empty, unquoted variables as paths and inside `[ ]`, `for f in $(ls)` / `$(find)`, `for a in $*`, `read` without `-r`, `local x=$(cmd)` hiding a failure, and `sudo cmd > /etc/…`. In about 165,000 lines of the surveyed scripts they were found about 400 times. Turn them off with `bashExplainer.notes.pitfalls`.
- About 100 more commands and builtins, chosen from a survey of shell scripts, Dockerfiles and workflows in popular repositories: package managers (`apt-get`, `apk`, `dpkg`, `dnf`, `brew`, `pip`), users and groups (`id`, `useradd`, `adduser`), system information and services (`uname`, `nproc`, `systemctl`), signatures and checksums (`gpg`, `openssl`, `sha512sum`), compression (`xz`, `zstd`), toolchains (`go`, `cargo`, `node`), `gh`, `shellcheck` and more, plus frequent options of known ones (`set -E`, `test -z`, `tar --strip-components`, `curl --retry`, `jq --argjson`…). In that survey, the share of commands explained went from 80% to 89%.
- About 45 more from a second survey, of operations and cloud scripts, node bootstrap scripts and dotfiles: `kubectl`, `helm`, `kustomize`, `kind`, `terraform`, `aws`, `gcloud`, `az`, `cosign`, `podman` (with docker's subcommands), `envsubst`, `dd`, `lsblk`, `iptables`, `usermod`, `ssh-keygen`, `bc`, `npx`, `pnpm`, macOS's `defaults` and `hdiutil`, and more; `docker buildx`/`system`/`inspect`, `gh pr` options, `git submodule`/`symbolic-ref`/`show-ref`, `comm -1 -2 -3`. Across both surveys, about 90% of the commands met are now explained.
- `terraform -var-file=x` and `go test -count=1`: single-dash long options with `=value` are read.
- `head -1`, `tail -5` and `git log -3` are read as `-n N`.
- `sed -i.bak` takes `.bak` as the backup suffix instead of more options.
- `gawk`, `mawk` and `nawk` are explained as `awk`.
- `date +FORMAT` gets a worked example: what it prints at two fixed moments (in UTC), editable in the panel. It replaces the note "right now this prints…", which changed with the time, so the same line now always gets the same explanation. More conversions are worked out (`%s`, `%I`, `%p`, `%Z`, `%z`, week numbers, `%c`…), checked against GNU `date`. Turn it off with the `date` kind in `bashExplainer.examples.disabled`.
- Code that is not shell is no longer explained as shell: the JavaScript of `actions/github-script` (`with: script:`), `run:` steps of jobs on Windows runners (PowerShell by default, unless the step says `shell: bash`), and Dockerfile stages that use PowerShell or cmd (`SHELL ["powershell", …]`, Windows base images). `SHELL` now applies until the next `FROM`, as in Docker.
- A step's `shell:` written after `- run:` is now taken into account.
- The parser is updated: tree-sitter-bash 0.25.1 (from 0.23.3) with web-tree-sitter 0.27.0 (from 0.22.6). Explanations of bash scripts stay the same; scripts with syntax the grammar cannot read, such as zsh-only code, may be split up differently.

## 0.2.0

- A command-line tool, the npm package [`bash-explainer`](cli/README.md): `npx bash-explainer deploy.sh:12` explains lines in the terminal (text, Markdown or JSON), and `--check` reports what the script's shell lacks, as compilers print warnings.
- A Language Server for other editors: `bash-explainer --lsp` gives Neovim, Helix, Emacs and others the same hovers, warnings and quick fixes (see the CLI's README for the set-up).
- Checks in CI: `bash-explainer --check --format github` (annotations on the pull request) or `--format sarif` (code scanning), and the repository as a GitHub Action, `uses: sf624/bash-explainer@v0`.
- Works in VS Code for the Web: on [vscode.dev](https://vscode.dev) and [github.dev](https://github.dev).
- The web version now links to the licenses of the software it includes (CodeMirror and others), listed in THIRD_PARTY_NOTICES.md.

## 0.1.1

- A [web version](https://sf624.github.io/bash-explainer/) to try Bash Explainer without installing it: paste a script and see the explanations, worked examples and warnings in the browser, for shell scripts and the other files the extension reads. It runs in the browser alone, like the extension, and can share a script as a link.
- The extension itself behaves as in 0.1.0. It is now tested in VS Code 1.85 (the oldest it supports) and the latest, on Linux and Windows, with checks that it opens no connection and starts no process.

## 0.1.0

First release.

### Explanations

- Line-by-line explanations of shell scripts in English and Japanese: commands and options (about 120 commands and builtins, with combined flags, option values and subcommands), operators, redirections and their order, `${…}` expansions part by part, control flow, and well-known idioms.
- The languages inside arguments: regular expressions (BRE, ERE, PCRE), sed scripts, awk programs, jq and yq filters, perl one-liners, `printf` and `date` formats, `find` expressions, `chmod` modes, `sort -k` / `cut -f` / `tr` sets, `getopts` / `getopt` option strings, and `git log --pretty` / `--date` formats.
- Worked examples with sample input and output, for regexes, sed, awk, jq, yq, perl, text filters, whole pipelines, expansions, `printf`, globs, tests, `xargs`, `read`, `getopt` and `git log`. They are computed by built-in code that the tests check against the real tools.
- Your own commands, described in `bashExplainer.customCommands`.

### Ways to show them

- A hover for the line under the mouse, or for the cursor line with `Ctrl+K Ctrl+E` (`Cmd+K Cmd+E` on macOS).
- A panel that follows the cursor, inspired by regex101: edit an example's input and watch the output change, with matches and capture groups highlighted; fold the tree, copy it as Markdown, switch the shell or yq for the file, and search a quick reference.
- An inline one-line summary at the end of the cursor line.

### Other shells and other files

- Constructs that POSIX sh, dash, ash, yash, ksh, mksh or zsh do not support are pointed out, and behaviour that differs from bash is noted. The shell is detected from the shebang, a `# shellcheck shell=` line or the file name.
- Shell code inside Dockerfiles, Makefiles, GitHub Actions and GitLab CI YAML, `package.json` scripts, Markdown code blocks and Python `subprocess` / `os.system` calls is explained too, with warnings about script injection, Docker `RUN` pipes without `pipefail` and Python commands passed without `shell=True`.
- yq commands are recognised as mikefarah/yq v4, kislyuk/yq or mikefarah/yq v3, with the first v4 release that has what the command uses.

### Problems panel

- Warnings in the Problems panel, with quick fixes where the rewrite keeps the meaning (`[[ ]]` → `[ ]`, `==` → `=`, `source` → `.`, `&>` → `> … 2>&1`, and more).
- `# bash-explainer disable=<code>` and `disable-file=<code>` comments, and `bashExplainer.diagnostics.ignore`, to silence them.

### Privacy

- Works offline by design: no network access, no AI, no telemetry, no external processes. A CI check keeps it that way.
