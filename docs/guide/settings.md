# Settings

[User guide](README.md) · English · [日本語](ja/settings.md)

Every setting is in VS Code's Settings editor under *Bash Explainer* (**Bash Explainer: Open Settings** in the hover and the panel opens it). The web page, the command-line tool and the Language Server take the same settings where they have a meaning ([Settings outside VS Code](#settings-outside-vs-code)).

## Settings in VS Code

| Setting | Default | Description |
| --- | --- | --- |
| **Display** | | |
| `bashExplainer.hover.enabled` | `true` | Hover for the part under the mouse (`Ctrl+K Ctrl+E`, the whole line, works either way) |
| `bashExplainer.hover.followCursor` | `false` | Show the hover whenever the cursor moves |
| `bashExplainer.hover.followDelay` | `400` | Delay (ms) before it does |
| `bashExplainer.hover.maxDepth` | `0` | Levels of the explanation tree the hover shows (`0`: all) |
| `bashExplainer.panel.autoOpen` | `false` | Open the panel when a shell script is opened |
| `bashExplainer.panel.animations` | `true` | Rows of the panel, bash's steps, "More" and the examples grow and shrink when they are unfolded and folded (off: they appear at once; reduced motion turns it off too) |
| `bashExplainer.panel.colors` | `"classic"` | Colours of the parts of a line in the panel: `classic` (its own six), `theme` (the editor theme's, where readable), `themeLike` (the theme's, with new colours where the theme gives two kinds of part one colour). In a remote window, every theme when the extension is installed on the local side (where VS Code installs it); VS Code's default themes only when it runs on the remote side. VS Code only |
| `bashExplainer.highlight.enabled` | `true` | Colour shell code as the explanations read it (semantic tokens over the editor's colours): what each command name runs, options, readonly variables. Can be set per language (below); the web page always does it |
| `bashExplainer.hints.names` | `true` | A hint after a command name that does not run what it suggests |
| `bashExplainer.hints.deadCode` | `true` | Fade code that never runs (a branch whose condition the script has decided, the skipped side of `&&` or `||`, what follows `exit`, `return`, `break` or `continue`): a hint, not a warning |
| `bashExplainer.blockOutline` | `"bar"` | How a command over several lines (a loop, an `if`, a function, a pipeline, a here-document) is marked in the editor while the cursor is in it: `bar` (a line at the left of its lines), `tint` (a faint background) or `off`. The colours are the theme colours `bashExplainer.blockBar` and `bashExplainer.blockTint`. Also on the web page |
| `bashExplainer.inline.enabled`, `bashExplainer.inline.maxLength` | | Removed: no longer have an effect |
| `bashExplainer.examples.enabled` | `true` | Show worked examples at all |
| `bashExplainer.examples.disabled` | `[]` | Kinds of examples not to show: `regex`, `sed`, `awk`, `jq`, `yq`, `perl`, `textFilters`, `pipeline`, `expansion`, `printf`, `glob`, `test`, `xargs`, `read`, `getopt`, `gitLog`, `date` |
| `bashExplainer.examples.inHover` | `true` | Show examples in the hover too (off: only in the panel) |
| `bashExplainer.examples.placement` | `first` | Worked examples under the part they illustrate, before (`first`) or after (`last`) its pieces, or all at the end (`bottom`) |
| `bashExplainer.language` | `auto` | `auto` (follow VS Code), `en` or `ja` |
| `bashExplainer.notes.idioms` | `true` | Notes about well-known idioms (strict mode, `IFS= read -r`…) |
| `bashExplainer.notes.pitfalls` | `true` | Point out common mistakes and how to avoid them (unquoted variables, `for f in $(ls)`, `rm -rf $DIR/…`…); errors (`x = 1`) are pointed out either way |
| `bashExplainer.notes.basis` | `true` | Mark a note, or the explanation of a part, that rests on bash's behaviour rather than the manual ("Not in the manual · checked with bash 5.2"), with a command to try it in your terminal |
| **Checks** | | |
| `bashExplainer.shell` | `auto` | The shell scripts are written for: `auto`, `bash`, `sh`, `dash`, `ash`, `yash`, `ksh`, `mksh`, `zsh` |
| `bashExplainer.bashVersion` | `5.2` | The bash release to explain for: `5.2` or `5.3`. A construct of bash 5.3 (`${ cmd; }`) is explained as 5.3 runs it, and is an error with `5.2` |
| `bashExplainer.diagnostics.enabled` | `true` | Errors and warnings in the Problems panel, with quick fixes |
| `bashExplainer.diagnostics.ignore` | `[]` | Warning codes to leave out (the code shown in the Problems panel, e.g. `dbracket`, `echoE`, `dockerPipefail`) |
| `bashExplainer.diagnostics.embedded` | `true` | Also warn about shell code inside other files |
| `bashExplainer.diagnostics.pitfalls` | `true` | Also list the warnings and caveats of the explanations in the Problems panel (`rm -rf $DIR/*`, `rm $f`: warnings; `cat $f`, `read line`: information); their errors (`[` without `]`, `x = 1`) are listed either way |
| `bashExplainer.yq.flavor` | `auto` | `auto`, `mikefarah4`, `kislyuk` or `mikefarah3` |
| **Files** | | |
| `bashExplainer.embedded.files` | all | Files whose shell code is explained: `dockerfile`, `makefile`, `yaml`, `packageJson`, `markdown`, `python` (also the patterns of `re`), `jenkinsfile`, `bats` |
| `bashExplainer.languages` | `["shellscript"]` | Language IDs explained as shell scripts |
| **Dictionary** | | |
| `bashExplainer.customCommands` | `{}` | Describe commands the dictionary does not know (see below) |

### Colours per kind of file

The colours are on for shell scripts and the shell code of other files (not Python files and Dockerfiles, which their own language servers colour). To turn them off for one kind of file, set the setting for its language in `settings.json`:

```json
"[makefile]": { "bashExplainer.highlight.enabled": false },
"[yaml]": { "bashExplainer.highlight.enabled": false }
```

The languages are those VS Code shows in the status bar: `shellscript`, `bats`, `makefile`, `yaml` (GitLab CI, and GitHub workflows without the GitHub Actions extension), `github-actions-workflow`, `json` (package.json), `markdown`, `groovy` and `jenkinsfile`. `"bashExplainer.highlight.enabled": false` alone turns them off everywhere.

### Your own commands

In-house tools are shown as *external commands* until you describe them:

```json
"bashExplainer.customCommands": {
  "deploy": {
    "summary": "Deploy a service to production",
    "options": [
      { "names": ["-n", "--dry-run"], "description": "only show what would happen" },
      { "names": ["-e"], "description": "target environment", "takesValue": true }
    ],
    "operands": [{ "description": "service name", "repeat": "+" }],
    "subcommands": {
      "status": { "summary": "Show what is deployed", "operands": [{ "description": "service name", "repeat": "*" }] }
    }
  }
}
```

- `options`: each option's names, its description, and `takesValue` when it takes a value (`-e prod`, `-eprod`, `--env=prod`).
- `operands`: the words that are not options, in order. `repeat` is `?` (optional), `*` (any number) or `+` (one or more); without it, the operand is there exactly once. When the words do not fit, they are shown as plain words.
- `style`: `gnu` (the default: options may come after operands), `posix` (the first operand ends the options) or `single-dash` (long options with one dash, `-name value`).
- `subcommands`: the same fields, for each subcommand.

The shape before 0.7 (`options` as an object, `"-n|--dry-run": "…"`, and `arguments`, a list of texts of which the last repeats) is still read, and a later release drops it.

## Settings outside VS Code

The same settings work on the web page, in the command-line tool and in the Language Server, wherever they have a meaning:

| Settings (`bashExplainer.`…) | Web page | Command line | Language Server |
| --- | --- | --- | --- |
| `language`, `notes.idioms`, `notes.pitfalls`, `notes.basis`, `shell`, `bashVersion`, `yq.flavor`, `diagnostics.ignore`, `diagnostics.embedded`, `diagnostics.pitfalls`, `examples.enabled`, `examples.disabled`, `customCommands` | ✓ | ✓ | ✓ |
| `diagnostics.enabled` | ✓ | (`--check` asks for the warnings) | ✓ |
| `hover.enabled`, `hints.names`, `hints.deadCode` | ✓ | | ✓ |
| `examples.placement`, `panel.animations`, `blockOutline` | ✓ | | |
| `editor.wrap` (the web page only: it is not in VS Code's settings, which has `editor.wordWrap`) | ✓ | | |
| `examples.inHover`, `hover.maxDepth`, `highlight.enabled`, `languages`, `embedded.files` | | | ✓ |
| `hover.followCursor`, `hover.followDelay`, `panel.autoOpen`, `panel.colors` | | | |

The empty cells are about what only VS Code has (the hover's depth and examples, a hover that follows the cursor, a panel to open, files to choose); the web page and the command line explain the file they are given, as the kind you choose.

- **Web page:** click ⚙ in the app bar. The shell and yq are also chosen with the chip in the editor's header that shows the file type and the shell, or the menu's **File type and shell…**; its yq list shows only when the cursor's line runs yq. Changes apply at once, and are kept in your browser (localStorage); **Reset to defaults** puts the settings back, and **Clear stored data** (after a confirmation) removes everything the page keeps in the browser: the settings and the choices it remembers besides them (theme, pane sizes, depth, the “What the program receives” switch, read mode, closed hints). The defaults show at once; a hint you closed shows again at the next load. The shell and yq chosen in the chip are the dialog's **Shell** and **yq flavor** settings, and the language chosen in the menu is its **Language** setting. **Export to a file** (or **Copy**) gives the settings you changed as a settings file in the format below, for the command-line tool or VS Code's `settings.json`; **Import a file…** (or dropping a file on the dialog, or pasting JSON) replaces the page's settings with those of such a file, and lists the keys it left out.
- **Command line and Language Server:** a JSON file with the keys of VS Code's `settings.json`, with or without `bashExplainer.` (comments are allowed). It is the file given with `--config`, else `$BASH_EXPLAINER_CONFIG`, else `$XDG_CONFIG_HOME/bash-explainer/settings.json` (by default `~/.config/bash-explainer/settings.json`). `--set key=value` sets one setting. See [Settings](../../cli/README.md#settings) in the tool's README.

```json
{
  "bashExplainer.language": "ja",
  "bashExplainer.shell": "sh",
  "bashExplainer.diagnostics.ignore": ["crlf"],
  "bashExplainer.examples.disabled": ["date"],
  "bashExplainer.customCommands": {
    "deploy": { "summary": "Deploy a service to production" }
  }
}
```
