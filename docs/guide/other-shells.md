# Scripts for other shells

[User guide](README.md) · English · [日本語](ja/other-shells.md)

Explanations follow bash. When a script is written for another shell, Bash Explainer also points out what that shell does not have, and what behaves differently there:

```sh
#!/bin/sh
[[ -n $name ]] && echo -e "hi\t$name"
# ⓧ Error: `[[ ]]` is not POSIX sh (in dash `[[` is run as a command, is not found and gives status 127, so a condition with it is false). Instead, use `[ ]`.
# ⚠ Portability: `echo -e` is not POSIX sh (dash's `echo` prints `-e` as text). Instead, use `printf` …
# ⓘ Portability: dash's `echo` interprets `\t`, `\n` and the like in its arguments …
```

- **Shells:** POSIX `sh` (naming what fails in dash and busybox ash), `dash`, `ash`, `yash`, `ksh`, `mksh`, `zsh`. What works where was measured with each shell.
- **Which shell:** from the shebang (`#!/bin/sh`, `#!/usr/bin/env dash`, …), a `# shellcheck shell=` line or the file name — or set `bashExplainer.shell`. In a Markdown code block, a shebang wins over the fence's tag; a block tagged `sh` without one is read as bash (write `#!/bin/sh` in it to check it as POSIX sh), and `bash`, `zsh`, `dash`, `ksh` keep their shell.
