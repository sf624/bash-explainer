# Bash Explain

**Understand any bash script, one line at a time** — like [regex101](https://regex101.com/), but for shell scripts.

Put your cursor on a line and Bash Explain breaks it down into commands, options, redirections and expansions, and explains what each part does.

[日本語版 README はこちら](README_ja.md)

![Bash Explain demo](images/demo.gif)

## Example

```bash
grep -rn "ERROR $USER" ./src 2>&1 | sort -u > errors.txt
```

```text
grep -rn "ERROR $USER" ./src 2>&1 | sort -u > errors.txt — Redirection applied to … as a whole
├─ grep -rn "ERROR $USER" ./src 2>&1 | sort -u — Pipeline: each command's stdout feeds the next command's stdin
│  ├─ grep -rn "ERROR $USER" ./src 2>&1 — Print lines matching a pattern (regex)
│  │  ├─ -rn — Combined short options -r -n
│  │  │  ├─ -r — search directories recursively
│  │  │  └─ -n — show line numbers
│  │  ├─ "ERROR $USER" — search pattern (regex)
│  │  │  └─ $USER — Current user name
│  │  ├─ ./src — file to search (default: stdin)
│  │  └─ 2>&1 — Send stderr (fd 2) to wherever stdout (fd 1) goes
│  ├─ | — Pipe: send stdout of the left command to stdin of the right
│  └─ sort -u — Sort lines
│     └─ -u — output only unique lines
└─ > errors.txt — Write stdout (fd 1) to file errors.txt (overwrite)
```

## Features

- **Commands and options** — combined flags (`-rn`), options with values (`-o pipefail`, `--include=*.sh`) and the role of each argument, for about 120 commands and builtins (`grep`, `sed`, `awk`, `find`, `xargs`, `curl`, `tar`, `git`, `docker`, …)
- **Nested commands** — subcommands (`git commit`) and commands run by other commands (`sudo`, `xargs`, `env`, `find -exec`)
- **Operators and redirections** — `|`, `&&`, `||`, `;`, `&`, `>`, `>>`, `2>&1`, `&>`, `>/dev/null`, here-documents, here-strings
- **Expansions** — `${var:-default}`, `${file%.sh}`, `${#array[@]}`, `$?`, `$@`, `$(…)`, `<(…)`, `$((…))`. Parameter expansions are broken into their parts (name, operator, pattern, offset…) with a worked example such as `file=report.tar.gz → report.tar`
- **Mini-languages inside arguments** — regular expressions (grep, `[[ =~ ]]`; BRE, ERE or PCRE depending on the options), sed scripts (addresses, `s///` with flags, `&`, `\1`…), jq filters (paths, pipes, `select`, `map`, …) and common awk programs (`BEGIN`/`END`, patterns, `$1`, `NR`, `print`, …) are broken down too
- **Worked examples** — grep patterns show lines that match and lines that do not; sed scripts, awk programs and jq filters show a made-up input and the output they produce for it, computed by built-in runners. The same goes for `sort`, `uniq`, `cut`, `tr`, `head`/`tail`, `seq`, `basename`/`dirname`, `printf`, brace expansion (`{a,b}`, `{1..10..3}`), globs and `case` patterns, `xargs` (the commands it would run), `[ ]`/`[[ ]]`/`(( ))` tests (values that make them true and false), `read` with `IFS`, perl one-liners, `git log --pretty`/`--format` and `--date` (the output for sample commits), and whole pipelines, shown stage by stage. Every runner is checked against the real tool (GNU sed/coreutils/findutils, gawk, jq, perl, bash, git) in the tests
- **More mini-languages** — printf and `date` format strings (`%-10s`, `%05.2f`, `+%Y-%m-%d`, with what the date format prints now), `find` expressions read as one sentence (`-o`, `!`, `\( \)`, the `-prune -o` idiom), `chmod`/`umask` modes (`755` → rwxr-xr-x, `u+rwX,go-w`, `umask 022` → 644/755), `sort -k`, `cut -f` and `tr` sets, `getopts` option strings and `getopt -o`/`--long` (with how sample arguments are rearranged), perl one-liners (`perl -pi -e 's/…/…/g'`, `-lane`) and `git log --pretty=format:`
- **Idioms and pitfalls** — notes for well-known patterns (`IFS= read -r`, the script-directory idiom, `command -v … >/dev/null 2>&1`, strict mode, `trap … EXIT`…) and for redirection order, e.g. why `2>&1 >file` does not send errors to the file
- **Tests** — `[ ]`, `[[ ]]` and `(( ))` with `-f`, `-z`, `-eq`, `=~`, …
- **Control flow** — `if`, `for`, `while`, `until`, `case` and functions; lines inside a block show where they are (e.g. *for loop › if statement*)
- **Multi-line statements** — lines continued with `\`, here-document bodies, and calls to functions defined in the same script
- **Offline and instant** — parsed with [tree-sitter-bash](https://github.com/tree-sitter/tree-sitter-bash) and explained from built-in dictionaries; no network, no AI
- **English and Japanese**

## Ways to show explanations

The hover, the inline summary and the panel can be used together. Turn each on or off in the settings, or click **Bash Explain** in the status bar.

### Hover (on by default)

Hover over a line to see its explanation. Press `Ctrl+Alt+E` (`Cmd+Alt+E` on macOS) to explain the line under the keyboard cursor. **Open in panel** at the bottom shows the same line in the panel.

![Hover mode](images/hover.gif)

### Panel

A side pane that follows the cursor, colour-coded like regex101. Hover a part to highlight it in the editor; click it to select it. Open it from the editor title bar, the hover link or **Bash Explain: Open Bash Explanation Panel**; with `bashExplain.panel.autoOpen` it opens by itself when you open a bash script.

![Panel mode](images/panel.gif)

### Inline (off by default)

A faint one-line summary at the end of the cursor line. Turn it on with `bashExplain.inline.enabled`.

![Inline mode](images/inline.png)

## Shell code in other files

Shell code inside other files is explained too: Dockerfile `RUN`/`CMD`/`ENTRYPOINT` (including `RUN <<EOF` here-documents, the exec form `RUN ["cmd", "arg"]`, the script of `["sh", "-c", "…"]` and `SHELL [...]`, with a warning when a `RUN` pipe would hide failures without `pipefail`), Makefile recipes, CI YAML (`run:` in GitHub Actions workflows and composite `action.yml`, `script:` in GitLab CI…), `package.json` scripts, Markdown code blocks (`sh`, `bash`, `console`…) and Python's `subprocess.run(…)`, `os.system(…)` and friends (a string with `shell=True` is a `/bin/sh` script, a list is run without a shell; a string without `shell=True` and f-strings pasted into a shell command are flagged). GitHub Actions steps follow `defaults: run: shell:`, explain `$GITHUB_OUTPUT` and the other runner files, and warn when untrusted input like `${{ github.event.pull_request.title }}` is pasted into a script. Host syntax is explained for what it is (`$(CC)`, `$@` and `$$` in make, `${{ … }}` in GitHub Actions), and each snippet is checked for the shell that runs it, e.g. `/bin/sh` for Dockerfiles and Makefiles unless `SHELL` says otherwise. Turn this off with `bashExplain.embedded.enabled`.

## Other shells

Explanations always follow bash, but when a script is written for another shell Bash Explain points out constructs that shell does not have, such as `[[ ]]`, arrays, `&>`, `echo -e` or `{1..3}` in a `#!/bin/sh` script, and suggests a portable alternative. Constructs that work but behave differently are noted too: `echo 'a\tb'` interprets `\t` in dash, yash, mksh and zsh; zsh does not split an unquoted `$var`; arrays start at 1 in yash and zsh; in ksh93 `typeset` inside a `name() { … }` function is not local. The ksh builtins `print` and `whence` are explained as well. zsh-only syntax such as `*(.)` or `${(f)var}` cannot be parsed, which is said on the line.

The shell comes from the shebang (`#!/bin/sh`, `#!/usr/bin/env dash`, `#!/bin/busybox sh`…), a `# shellcheck shell=` directive or the file name, and can be set with `bashExplain.shell`. Supported: POSIX `sh` (naming what fails in dash and busybox ash), `dash`, `ash` (busybox), `yash`, `ksh` (ksh93), `mksh` and `zsh`. Which shell supports what was measured with each shell and is re-checked in the tests.

## Problems panel and quick fixes

The warnings also appear in the Problems panel (and as squiggles), so they are found without hovering: constructs the script's shell lacks, script injection in GitHub Actions, Docker `RUN` pipes without `pipefail`, Python strings without `shell=True` or with values pasted into a shell command. Where a portable rewrite keeps the meaning, a quick fix is offered: `[[ ]]` → `[ ]` (quoting variables, splitting `&&` / `||`), `==` → `=`, `source` → `.`, `function f` → `f()`, `&> file` → `> file 2>&1`, `|&` → `2>&1 |`. A `[[ ]]` that `[ ]` cannot express (`== *.txt` patterns, `=~`, `<`) keeps its warning without a fix. Each rewrite is checked to give the same result in dash as the original in bash. Turn this off with `bashExplain.diagnostics.enabled`.

## Commands

| Command | Key | Description |
| --- | --- | --- |
| Bash Explain: Explain Bash on Current Line | `Ctrl+Alt+E` / `Cmd+Alt+E` | Explain the line under the cursor |
| Bash Explain: Open Bash Explanation Panel | | Open the side panel (also in the editor title bar) |
| Bash Explain: Choose Display | | Turn the hover, the inline summary and opening the panel automatically on or off |
| Bash Explain: Open Settings | | Open this extension's settings (also linked from the hover and the panel) |

## Settings

| Setting | Default | Description |
| --- | --- | --- |
| `bashExplain.language` | `auto` | `auto` (follow VS Code), `en` or `ja` |
| `bashExplain.shell` | `auto` | The shell scripts are written for (`auto`, `bash`, `sh`, `dash`, `ash`, `yash`, `ksh`, `mksh`, `zsh`); constructs it lacks are pointed out |
| `bashExplain.diagnostics.enabled` | `true` | Show warnings in the Problems panel, with quick fixes |
| `bashExplain.examples.placement` | `first` | `first` (each worked example right under the part it illustrates, before the explanations of its pieces), `last` (after them) or `bottom` (all together after the explanations) |
| `bashExplain.hover.enabled` | `true` | Show the hover for the line under the mouse (`Ctrl+Alt+E` works either way) |
| `bashExplain.hover.followCursor` | `false` | Show the hover automatically when the cursor moves |
| `bashExplain.hover.followDelay` | `400` | Delay (ms) before the hover follows the cursor |
| `bashExplain.inline.enabled` | `false` | Show a one-line summary at the end of the cursor line |
| `bashExplain.inline.maxLength` | `120` | Maximum length of the inline summary |
| `bashExplain.panel.autoOpen` | `false` | Open the panel automatically when a bash script is opened |
| `bashExplain.embedded.enabled` | `true` | Explain shell code in Dockerfiles, Makefiles, CI YAML, `package.json` scripts, Markdown code blocks and Python `subprocess` calls |
| `bashExplain.languages` | `["shellscript"]` | Language IDs to explain |

## Limitations

- Explanations are rule-based. Commands that are not in the dictionary are shown as an *external command* without option details.
- A few constructs are mis-parsed by the underlying grammar, e.g. `[[ -f a && $x =~ re ]]` (mixing `&&` with `=~`).

## Contributing

Issues and pull requests are welcome at [github.com/sf624/bash-explain](https://github.com/sf624/bash-explain).

```sh
npm install
npm run build      # bundle into dist/ (also copies the wasm files)
npm test           # type check + unit tests
npm run package    # build a .vsix
```

Press `F5` in VS Code to launch an Extension Development Host with `test/fixtures/sample.sh` open.
`npx tsx test/dump.ts <file> [en|ja] [line]` prints the explanation of every line of a file.
The shell-support table is checked against every shell found on `PATH` or in the directory `$BASH_EXPLAIN_SHELLS` (`dash`, `busybox`, `yash`, `ksh93`, `mksh`, `zsh`); missing ones are skipped.

To add a command, add an entry to [`src/dict/commands.ts`](src/dict/commands.ts):
`cmd(japanese, english, [options…], { positional: […] })`.

## License

[MIT](LICENSE). Third-party components are listed in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
