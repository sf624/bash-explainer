# Changelog

## Unreleased

- `${a[@]:1:2}` and `${@:2}` are explained as taking elements (of the array, or the arguments from `$2`), with examples checked in bash; they were explained, with a wrong example, as taking characters.
- An assignment with only a redirection (`FOO=1 2>/dev/null`) is explained as an assignment in the shell; it was "the external command ``".
- perl one-liners that leave the `-n`/`-p` loop with `last` (`perl -ne 'last if /^END/; print'`) get worked examples, as perl runs them: the loop stops, `END` still runs.
- jq filters with `.a.[0]` (jq 1.7) or a `def` after a comma (`1, def f: 2; f`) are explained; before, the whole filter was "could not parse".
- `git log --date=relative` examples over a year old read like git's: "1 year, 1 month ago" up to five years, instead of "1 year ago".
- perl one-liners with a `BEGIN { … }` or `END { … }` block followed by more code without `;` (`perl -lne 'END { print $n } $n++'`) are explained statement by statement; the block and the code after it were taken for one assignment.
- `exec 3>&-` and `exec 3<&-` are explained again as closing the descriptor; since the parser update in 0.3.0 they were only "redirection `>&-`".
- A Jenkinsfile `sh` step starting with a shebang (`#!/bin/bash`, `#!/usr/bin/env zsh`) is read as that shell; the shebang was misread before.
- `**` in file-name globs is explained as any depth of directories, as it is meant, with examples such as `src/lib/error.ts`. When no `shopt -s globstar` comes before it, a pitfall says that bash then treats `**` as `*` (one level only), unless a file read with `source` turns it on; after `shopt -u globstar`, and in shells without globstar (`sh`, `dash`…), it is explained as `*`. zsh always has it. Examples no longer show names like `appapp/app.ts`. The options of `shopt` (`globstar`, `nullglob`, `dotglob`, `extglob`…) are explained.
- Glob examples follow `shopt -s dotglob` (names starting with `.` match too), `nocaseglob` (file names ignore case) and `nocasematch` (`case` and `[[ == ]]` patterns ignore case), set earlier in the script; the explanation says which is on.
- Extended globs (`!(*.txt)`, `*.@(jpg|png)`, `+([0-9])`…) in arguments are read as one word; before, the parser took `!(…)` for a subshell and explained `*.txt` as a command. They are explained part by part, with matching and non-matching names. A pitfall points out a missing `shopt -s extglob` (bash's syntax error), or one inside the same function or block as the glob, which comes too late because bash reads the whole block first. In zsh, `*(…)` is noted as zsh-only syntax (glob qualifiers), as before.
- A pitfall for `for f in *.log` (and `"$dir"/*`): when nothing matches, the loop runs once with the pattern itself. It suggests `[ -e "$f" ] || continue` or `shopt -s nullglob`, and stays quiet when the body already checks, or with nullglob or failglob on.
- A pitfall for variables set on the right of a pipe and read after it (`cat f | while read -r l; do n=…; done; echo "$n"`): the pipeline ran in a subshell. It suggests `done < file`, `< <(command)` or `shopt -s lastpipe`, and stays quiet in zsh and ksh, where the last part runs in the shell itself.
- Aliases defined in the script (`alias ll='ls -l'`) are explained where they are used, with a pitfall that bash does not expand them in scripts without `shopt -s expand_aliases`.
- Variables of CI systems are explained: about 100 environment variables that GitHub Actions, GitLab CI/CD, CircleCI, Jenkins, Bitbucket Pipelines and Azure Pipelines set (`$GITHUB_WORKSPACE`, `$CI_COMMIT_SHA`, `$BUILD_NUMBER`…), unless the script sets them itself; the contexts of GitHub Actions expressions (`${{ github.head_ref }}`, `secrets.*`, `matrix.*`, `steps.<id>.outputs.*`…); Azure Pipelines macros (`$(Build.SourcesDirectory)`); and Jenkins' `${env.BRANCH_NAME}` and `${params.X}`.
- Fixes found by new tests: `$"…"` (a translated string) is explained as such instead of as a plain string without its `$`; `unset` explains its options and names; a Python `shell=True` script with `\x41` or `\u0041` escapes is decoded as Python does; perl one-liners with `elsif` get worked examples.
- The pitfall for `rm -rf "$DIR"/…` no longer fires on special parameters such as `"$$/x"`, where it suggested `${VAR:?}`.
- `git log` examples with `%<(1,trunc)` show `..`, as git does, instead of the first character; a width of 0, which git does not take, gets no example.
- perl one-liners: `s{a{1}}{b}` (nested brackets) and `s{a} {b}` are split into pattern and replacement as perl does, and `s/a//` reads "delete" instead of "replace with ``".
- awk: the pattern `0` is explained as always false; it was "always true (non-zero)".
- Regex examples: `a{,2}` in `grep -E`/`sed -E` (and `a\{,2\}` in basic regexes) is read as "at most 2", as GNU tools do, instead of as the text `{,2}`; in `grep -P`, `[]a]` is a class of `]` and `a` instead of a class that matches nothing.
- `printf '%c' ""` in examples prints a NUL byte, as bash does.
- Extended globs such as `!(app)*`, where `!(…)` is followed by a part of varying length, get no examples: bash may end `!(…)` at any point, so names like `appapp` match, which the examples said did not.
- mikefarah/yq v3 paths: `(.==x)` is explained as the elements equal to `x`, instead of the elements whose `.` matches `x`.
- sed examples follow GNU sed in more cases: `\L`/`\U` cancel a pending `\u`/`\l` (`s/.*/\u\L&/` is all lower case); an empty regex (`//`) is the last one used when the line runs, not the one written before it; and scripts GNU sed rejects (`\9` for a group the pattern lacks, `//` with no regex used yet) get no example instead of a made-up output.
- Shell dialects: `select` loops and `read -n1` (a value attached to `-n`, `-t`…) are noted in scripts for shells that lack them; the parser reads `select` as a `for` loop, and only separate values were seen.
- Examples for `${v#[[:digit:]]}` and other patterns with POSIX classes (`[[:alpha:]]`, `[[:space:]]`…) follow bash; the class was cut at its first `]`.
- Aliases and functions that distributions define for interactive shells are explained, with what they stand for on each system, as checked in the files the distributions ship: Ubuntu's `ll`, `la`, `l` and `alert`; Fedora / RHEL's `ll` and `l.`; openSUSE's `ll`, `la`, `l`, `ls-l`, `o`, `..`, `...`, `cd..`, `+`, `-`, `md`, `rd`, `rehash`, `beep`, `unmount`, `remount` and `xd`; Git for Windows' `ll`. A note says they depend on the system and are missing in scripts, and what to write instead; in Markdown code blocks, typed into a terminal, the note is milder.

## 0.3.0

- About 100 more commands and builtins, chosen from a survey of shell scripts, Dockerfiles and workflows in popular repositories: package managers (`apt-get`, `apk`, `dpkg`, `dnf`, `brew`, `pip`), users and groups (`id`, `useradd`, `adduser`), system information and services (`uname`, `nproc`, `systemctl`), signatures and checksums (`gpg`, `openssl`, `sha512sum`), compression (`xz`, `zstd`), toolchains (`go`, `cargo`, `node`), `gh`, `shellcheck` and more, plus frequent options of known ones (`set -E`, `test -z`, `tar --strip-components`, `curl --retry`, `jq --argjson`…). In that survey, the share of commands explained went from 80% to 89%.
- About 45 more from a second survey, of operations and cloud scripts, node bootstrap scripts and dotfiles: `kubectl`, `helm`, `kustomize`, `kind`, `terraform`, `aws`, `gcloud`, `az`, `cosign`, `podman` (with docker's subcommands), `envsubst`, `dd`, `lsblk`, `iptables`, `usermod`, `ssh-keygen`, `bc`, `npx`, `pnpm`, macOS's `defaults` and `hdiutil`, and more; `docker buildx`/`system`/`inspect`, `gh pr` options, `git submodule`/`symbolic-ref`/`show-ref`, `comm -1 -2 -3`. Across both surveys, about 90% of the commands met are now explained.
- `terraform -var-file=x` and `go test -count=1`: single-dash long options with `=value` are read.
- `head -1`, `tail -5` and `git log -3` are read as `-n N`.
- `sed -i.bak` takes `.bak` as the backup suffix instead of more options.
- `gawk`, `mawk` and `nawk` are explained as `awk`.
- `date +FORMAT` gets a worked example: what it prints at two fixed moments (in UTC), editable in the panel. It replaces the note "right now this prints…", which changed with the time, so the same line now always gets the same explanation. More conversions are worked out (`%s`, `%I`, `%p`, `%Z`, `%z`, week numbers, `%c`…), checked against GNU `date`. Turn it off with the `date` kind in `bashExplainer.examples.disabled`.
- Pitfalls are pointed out where they appear, with how to avoid them: `x = 1` (a command, not an assignment), `rm -rf $DIR/…` when `DIR` may be empty, unquoted variables as paths and inside `[ ]`, `for f in $(ls)` / `$(find)`, `for a in $*`, `read` without `-r`, `local x=$(cmd)` hiding a failure, and `sudo cmd > /etc/…`. In about 165,000 lines of the surveyed scripts they were found about 400 times. Turn them off with `bashExplainer.notes.pitfalls`.
- More CI systems: Jenkinsfile `sh` steps (in every quoting, with the `$name` and `${…}` that Groovy fills in pointed out), CircleCI `run:` steps written with `name:` and `command:`, and Azure Pipelines `script:` and `bash:` steps, whose `$(variable)` macros are no longer taken for command substitution (`script:` on Windows agents, and PowerShell steps, are left out). The web version and the command-line tool (`--kind jenkinsfile`) read Jenkinsfiles too.
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
