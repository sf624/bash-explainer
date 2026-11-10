# What is explained

[User guide](README.md) · English · [日本語](ja/explained.md)

The README lists what is explained: commands and options, operators and redirections, expansions, the languages inside arguments, control flow, idioms and pitfalls ([What is explained](../../README.md#what-is-explained)). This page adds the worked examples, the shell code in other files, and the three tools called `yq`.

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

## Shell code in other files

| File | What is explained |
| --- | --- |
| Dockerfile | `RUN` / `CMD` / `ENTRYPOINT` (shell form, `RUN <<EOF`, exec form, `["sh", "-c", "…"]`) and `SHELL [...]`; warns when a `RUN` pipe hides failures without `pipefail` |
| Makefile | recipes, with make's `$(VAR)`, `$@` and `$$` explained; a line make runs with no shell (no `;`, `"`, `$`, `|`… in it) is explained as a program, not as `/bin/sh` |
| CI YAML | GitHub Actions `run:` (workflows and `action.yml`, following `shell:` and `defaults`), GitLab CI `script:`, CircleCI `run:` / `command:`, and Azure Pipelines `script:` / `bash:` with its `$(variable)` macros; warns when untrusted input like `${{ github.event.pull_request.title }}` is pasted into a script |
| `package.json` | `scripts` |
| Markdown | code blocks marked `sh`, `bash`, `console`, …; the shell is the block's shebang, else the one the tag names (`sh` counts as bash) |
| Python | `subprocess.run(…)`, `os.system(…)`, …; flags strings passed without `shell=True` and values pasted into a shell command. Also the patterns of `re.search(…)`, `re.compile(…)`, `re.sub(…)`, …, in a file that imports `re`: each part of the pattern, read with its flags, an Error where Python refuses it (`bad escape \e at position 0`), and a Warning for a flag passed as `count` or for an escape that a string without `r` turns into a character (`"\bword\b"`, `"(a)\1"`). The fields of an f-string (`rf"^{prefix}\d+$"`) are read as values not known. The chip says "no shell (Python regex)" there. The web page takes a pasted script with `import re` and such a call as Python |
| Jenkinsfile | `sh '…'`, `sh "…"`, `sh '''…'''`, `sh(script: …)`; points out the `$name` and `${…}` that Groovy fills in before the shell runs |
| bats (`.bats`, or a `bats` shebang) | the whole file as bash: `@test "…" {` as the test bats runs with `set -e`, and `run` (with `!`, `-N`, `--separate-stderr`), `load`, `skip`, `bats_pipe`; warns about `! cmd` that cannot fail a test and `run` in a pipeline |

Each snippet is checked for the shell that runs it (`/bin/sh` for Dockerfiles and Makefiles unless `SHELL` says otherwise; in a Dockerfile, the base image of the stage says which: busybox ash under `alpine`, `busybox` and the `-alpine` tags, dash under `debian` and `ubuntu`). Choose which kinds of files with `bashExplainer.embedded.files`.

## yq

Three different tools are called `yq`, each with its own syntax: **mikefarah/yq v4**, **kislyuk/yq** (a jq wrapper) and the older **mikefarah/yq v3**. Bash Explainer tells which one a command is for — from its options, subcommands and functions, and from how yq is installed in the same file — and says so on the line:

> yq: explained as mikefarah/yq v4 (v4.22.1 or later). Because: `-o json` is a mikefarah/yq v4 option; `pick` is a mikefarah/yq function (jq has none)
> Works with: mikefarah/yq v4 (v4.22.1 or later) ✓ / kislyuk/yq ✗ (no `-o json`, `pick`) / mikefarah/yq v3 ✗ (no jq-style expressions, `-o json`)

The first release with each feature was measured on every 4.x minor release. When nothing tells, mikefarah/yq v4 is assumed; set `bashExplainer.yq.flavor` to fix the choice.
