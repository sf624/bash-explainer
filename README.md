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
- **Worked examples** — grep patterns show lines that match and lines that do not; sed scripts, awk programs and jq filters show a made-up input and the output they produce for it, computed by built-in runners (checked against GNU sed, gawk and perl in the tests)
- **More mini-languages** — printf and `date` format strings (`%-10s`, `%05.2f`, `+%Y-%m-%d`, with what the date format prints now), `find` expressions read as one sentence (`-o`, `!`, `\( \)`, the `-prune -o` idiom), `chmod`/`umask` modes (`755` → rwxr-xr-x, `u+rwX,go-w`, `umask 022` → 644/755), `sort -k`, `cut -f` and `tr` sets, `getopts` option strings, perl one-liners (`perl -pi -e 's/…/…/g'`, `-lane`) and `git log --pretty=format:`
- **Idioms and pitfalls** — notes for well-known patterns (`IFS= read -r`, the script-directory idiom, `command -v … >/dev/null 2>&1`, strict mode, `trap … EXIT`…) and for redirection order, e.g. why `2>&1 >file` does not send errors to the file
- **Tests** — `[ ]`, `[[ ]]` and `(( ))` with `-f`, `-z`, `-eq`, `=~`, …
- **Control flow** — `if`, `for`, `while`, `until`, `case` and functions; lines inside a block show where they are (e.g. *for loop › if statement*)
- **Multi-line statements** — lines continued with `\`, here-document bodies, and calls to functions defined in the same script
- **Offline and instant** — parsed with [tree-sitter-bash](https://github.com/tree-sitter/tree-sitter-bash) and explained from built-in dictionaries; no network, no AI
- **English and Japanese**

## Display modes

Choose with `bashExplain.displayMode`, or click **Bash Explain** in the status bar.

### Hover (default)

Hover over a line to see its explanation. Press `Ctrl+Alt+E` (`Cmd+Alt+E` on macOS) to explain the line under the keyboard cursor. **Open in panel** at the bottom shows the same line in the panel.

![Hover mode](images/hover.gif)

### Panel

A side pane that follows the cursor, colour-coded like regex101. Hover a part to highlight it in the editor; click it to select it.

![Panel mode](images/panel.gif)

### Inline

A faint one-line summary at the end of the cursor line.

![Inline mode](images/inline.png)

`both` shows the hover and the panel together.

## Commands

| Command | Key | Description |
| --- | --- | --- |
| Bash Explain: Explain Current Line | `Ctrl+Alt+E` / `Cmd+Alt+E` | Explain the line under the cursor |
| Bash Explain: Open Explanation Panel | | Open the side panel (also in the editor title bar) |
| Bash Explain: Select Display Mode | | Switch between hover, panel, inline and both |

## Settings

| Setting | Default | Description |
| --- | --- | --- |
| `bashExplain.displayMode` | `hover` | `hover`, `panel`, `inline` or `both` |
| `bashExplain.language` | `auto` | `auto` (follow VS Code), `en` or `ja` |
| `bashExplain.hover.followCursor` | `false` | In hover mode, show the hover automatically when the cursor moves |
| `bashExplain.hover.followDelay` | `400` | Delay (ms) before the hover follows the cursor |
| `bashExplain.inline.maxLength` | `120` | Maximum length of the inline summary |
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

To add a command, add an entry to [`src/dict/commands.ts`](src/dict/commands.ts):
`cmd(japanese, english, [options…], { positional: […] })`.

## License

[MIT](LICENSE). Third-party components are listed in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
