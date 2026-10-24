# Changes since 0.8.0, in detail

The short list is in [CHANGELOG.md](../../CHANGELOG.md#unreleased).

## New

### Pitfalls as problems

The pitfalls that the explanation of a line points out are now problems too. Each has a code, shown in the Problems panel and in the output of `--check`, and its range is the part of the line it is about (the word `$DIR/*`, the `$(ls)` of a `for`, the whole `x = 1`).

```text
script.sh:2:10: warning: Pitfall: the output of $(ls …) is split on spaces and newlines, so file names with spaces break. Use a glob, as in for f in *.txt [for-over-ls-output]
script.sh:3:8: warning: Pitfall: if DIR is empty this becomes rm -r /*, deleting from the root. Write "${DIR:?}/…" to stop when it is empty [rm-empty-variable-root]
script.sh:3:8: info: Pitfall: $DIR/* is not quoted, so a value with spaces or * is split into several arguments or expanded to file names. Write "$DIR/*" [unquoted-variable-as-path]
script.sh:4:1: warning: Pitfall: x =… runs a command named x; it is not an assignment. Write x=… with no spaces around = [assignment-with-spaces]
```

Warnings, for what breaks the script:

| Code | Example |
| --- | --- |
| `assignment-with-spaces` | `x = 1` |
| `bracket-no-space` | `[-f x]` |
| `bracket-close-in-word` | `[ -f $x]` |
| `and-or-in-bracket` | `[ a && b ]` |
| `redirect-in-bracket` | `[ $a < $b ]` |
| `brace-no-space` | `{echo a; }` |
| `brace-close-no-separator` | `{ echo a }` |
| `rm-empty-variable-root` | `rm -rf $DIR/*` |
| `prefix-assignment-expanded-first` | `FOO=1 echo $FOO` |
| `for-over-ls-output` | `for f in $(ls)` |
| `for-over-unquoted-args` | `for a in $*` |
| `redirect-by-your-shell` | `sudo cmd > /etc/x` |

Information, for what is frequent and harmless with most values:

| Code | Example |
| --- | --- |
| `unquoted-variable-as-path` | `cp $src /tmp/` |
| `unquoted-variable-in-test` | `[ $a = b ]` |
| `read-without-r` | `read line` |

- They follow the same settings as the other problems: `bashExplainer.diagnostics.ignore` and `# bash-explainer disable=<code>` leave one out. The new `bashExplainer.diagnostics.pitfalls` (default on) leaves all of them out, and so does `bashExplainer.notes.pitfalls` off.
- They follow the script's shell. In zsh, which does not split or glob an unquoted `$var`, `cp $a b` and `for a in $@` have none; `[ -n $x ]` keeps its pitfall, since zsh drops an empty unquoted word too, and says so. A line that zsh syntax leaves unreadable to bash gets none.
- They are found in shell scripts, and in the strings a script runs as scripts (`bash -c 'x = 1'`, `eval '…'`, `trap '…' EXIT`), at their place in the string. The shell code inside other files (Dockerfiles, Makefiles, CI YAML, bats files…) shows them in its explanations, as before, but not yet as problems.
- These are the pitfalls about how a line is written and how its words expand. The others the explanations give (on exit status and `set -e`, `shopt -s extglob`, a variable set in a pipeline, a glob that matches nothing) are not problems yet.
- **Compatibility:** `--check` prints these lines, but its exit status does not change: a warning on a pitfall makes it exit 1 only with the new `--strict`. The GitHub Action has a `strict` input (default `'false'`) for it; with a `package:` pin to a tool without `--strict`, the step fails and says so. Its `warnings` output counts the warnings that fail the step (those on pitfalls only with `strict`), as before; the new `pitfalls` output counts the pitfalls, warnings and notices. The annotations of pitfalls are titled `Bash Explainer (pitfall): <code>`, and `--format github` prints those that fail the check first, since GitHub shows only the first annotations of each kind in a step. SARIF has them as `warning` and `note` results. Before, `--check` reported only what the script's shell lacks and the risks in embedded shell code.

## Fixed

### Quoting suggested for a path with a glob, `~` or braces

The notes for an unquoted path (`cp $a/*.txt d`) and for `rm -rf $DIR/…` quote only the expansions, and leave the rest of the word as written, so a glob, a `~` or a brace expansion still works:

| Written | Suggested now | Suggested before |
| --- | --- | --- |
| `rm -rf $DIR/*` | `"$DIR"/*` and `"${DIR:?}"/*` | `"$DIR/*"` and `"${DIR:?}/…"` (they name a file `*`) |
| `cp ~/$x/* e` | `~/"$x"/*` | `"~/$x/*"` (no tilde expansion) |
| `cp $x/{a,b}.txt e` | `"$x"/{a,b}.txt` | `"$x/{a,b}.txt"` (no brace expansion) |
| `cp $*/* e` | `"$@"/*` (`"$*"` joins the arguments into one word) | `"$*/*"` |
| `cp ${a[*]}/* e` | `"${a[@]}"/*` | `"${a[*]}/*"` |

A word whose other parts mean the same in quotes is still quoted whole (`cp $a/b.txt e` → `"$a/b.txt"`).

When quotes would change what an expansion gives, the note gives no rewrite: a glob, a `~` or quotes in the value of `${…}` work only outside double quotes (`${x:-*.txt}`, `${x:-~}`, `${x:-'a b'}`, `${x:-$a/*}`, `${x/a/*}`).

### `rm -r` of a path from a variable that may be empty

The warning that an empty variable makes `rm -r` delete from the root:

- now also covers `rm -rf "$DIR"/*`, `"$DIR/"*` and `"$DIR""/x"`;
- suggests `"${DIR:?}"/*` for `$DIR/*`, keeping the glob outside the quotes;
- for an expansion with an operator that may be empty (`${DIR%/}/*`, which is `/*` when `DIR` is `/`; `${DIR:+x}/*`, `${DIR-/a}/x`, `${DIR?}/x`), suggests a check before the line, `[ -n "${DIR%/}" ] || exit 1`, and no longer rewrites it to `${DIR:?}`, which dropped the operator;
- says nothing about an expansion that is never empty: `${#DIR}`, `${DIR:-/tmp/x}`, `${DIR:=/a}`, `${DIR:?}`. Before, `rm -rf ${DIR:-/tmp/x}/*` was told it could become `rm -r /*`.
- treats a default that is empty after quote removal (`${DIR:-''}/a`, `${DIR-""}/a`, `${DIR:-$''}/a`) as an empty value, and suggests `"${DIR:?}"/a`; and says nothing for a literal default written with quotes or a backslash (`${DIR:-"lit"}/a`, `${DIR:-a\ b}/x`);
- when the operator's word has a quote or a backslash and the value may be empty (`${DIR:+''}/a`, `${DIR%'x'}/a`), gives no check line (in `"…"` it would read the word differently) and only says to check;
- now warns about an element or a list that can be empty: `${DIR[0]}/a` (rewrite `"${DIR[0]:?}"/a`), `$@/a`, `"$@"/a` and `$*/a` (check `[ "$#" -gt 0 ] || exit 1`), `${DIR[@]}/a` and `${!DIR[@]}/a` (check `[ "${#DIR[@]}" -gt 0 ] || exit 1`).

### Pitfalls

- `x = 1` is a pitfall only when `x` runs nothing known: not a builtin (`export = x`, `local = x`), a function, an alias, a program the dictionary knows (`echo ==========`, `sed = file`), nor a name a `source`d file may define. Before, all of these were said to be assignments written with spaces.
- `rm -rf $DIR/*` is no warning when the script set `DIR`, on every path to it, to a value with text of its own (`DIR=/opt/app`, `BUILD_DIR="$SCRIPT_DIR/build"`), and nothing else may change it unseen (src/semantics/trust.ts). A value from `$1`, `read`, a branch or a sourced file keeps the warning.

### zsh

- An unquoted `$var` or `${var}` is no longer said to be "word-split and globbed" in zsh, which does neither by default (`SH_WORD_SPLIT` and `GLOB_SUBST` are off). The pitfall on `cp $a b` is gone there, and so is the one on `for a in $@` (zsh gives each argument as one word). `[`'s explanation says that an empty unquoted variable is dropped, and `[ -n $x ]` keeps its pitfall with that reason.
- `{ echo a }` is not a pitfall in zsh, where `}` closes the group without a `;` unless `IGNORE_CLOSE_BRACES` is set.
