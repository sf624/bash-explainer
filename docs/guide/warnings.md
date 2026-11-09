# Warnings and quick fixes

[User guide](README.md) · English · [日本語](ja/warnings.md)

Warnings appear in VS Code's Problems panel, so you see them without hovering, and the same warnings come from the command-line tool (`--check`), the Language Server and the GitHub Action. Where a rewrite keeps the meaning, a quick fix is offered:

| Before | After |
| --- | --- |
| `[[ -f $f && -n $x ]]` | `[ -f "$f" ] && [ -n "$x" ]` |
| `[ "$a" == b ]` | `[ "$a" = b ]` |
| `source ./lib.sh` | `. ./lib.sh` |
| `function f {` | `f() {` |
| `cmd &> log` | `cmd > log 2>&1` |
| `cmd \|& tee log` | `cmd 2>&1 \| tee log` |
| `cp a b \|\| echo failed` (last in a script) | `cp a b \|\| { echo failed >&2; exit 1; }` |
| `source lib.sh` | `source "$(dirname "${BASH_SOURCE[0]}")"/lib.sh` |
| `grep "$user" f` | `grep -F "$user" f` |
| `read line` | `read -r line` |

For a construct the script's shell lacks, a fix is offered only when the meaning is kept: `[[ $f == *.txt ]]` is a pattern match, so it gets no fix. Each such rewrite is checked to behave in dash as the original does in bash. Where a warning or caveat shows the code to write, that code is a quick fix too (both, when it shows two: the one it recommends first). Each of these rewrites is run in bash 5.2 and 5.3 by the tests. To silence a warning, add `# bash-explainer disable=<code>` on the line before it (or after the code on the same line), `# bash-explainer disable-file=<code>` anywhere for the whole file, or list the code in `bashExplainer.diagnostics.ignore`; `all` matches every warning. Turn the Problems panel entries off with `bashExplainer.diagnostics.enabled`.

Problems have three levels, as VS Code's own: **ⓧ Error** (red) for a line that fails every time as written (`[` without `]`, `x = 1`, a construct the script's shell lacks, `then` with no `;` before it, `$((09))`, a regex its program refuses such as `grep -E '[a'`), **⚠ Warning** (yellow) for damage that cannot be undone under some values or conditions (`rm -rf $DIR/*` with an empty `DIR`, `rm $f`, `curl … | sh`), and **ⓘ Information** (blue) for what goes wrong only with some values or on some systems, or goes unnoticed (`for f in $(ls)`, `cat $f`, `read` without `-r`, `local x=$(cmd)`). The explanations (in the panel, the hover, the terminal and on the web page) show each level with its own icon, colour and word ("Error:", "Pitfall:", "Caveat:"), errors first; the Problems lists show its icon. Every error, warning and caveat the explanations point out is a problem too, each with its code; a plain fact is not. `bashExplainer.diagnostics.pitfalls` leaves the warnings and caveats out, not the errors. `--check` and the GitHub Action fail on an error, on a warning only with `--strict`, and never on information. So by default they catch a construct the script's shell lacks only where it surely fails: what the shell refuses while it reads the file (`a=(1)`, `<<<`, also in a function never called), and a command it surely gets to. In a function, in a branch, or after a command that may stop the script (`. ./lib`, an `exit` in a function), the construct may never run, so it is a warning: `--strict` is what catches a bashism there. Nothing is said after a command that surely stops the script (`exit 0`, `exec` with a command); after one that only may stop it (`source`, `trap`, an `exit` in a function), what says the shell reads the text wrongly (`x = 1`, `[-f x]`, a syntax error) is a warning.
