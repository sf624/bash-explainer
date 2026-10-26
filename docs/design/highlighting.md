# Syntax colouring

The shell code is coloured from the same reading the explanations use: our syntax tree, and the models over it. VS Code gets the colours as semantic tokens over its TextMate grammar; the Language Server sends the same tokens; the web page draws the same spans as marks. `bashExplainer.highlight.enabled` turns it on or off, per language (on by default since this design).

## What we colour

From the tree (src/highlight.ts): comments, strings, here-documents and their delimiters (a body ends where bash ends it), keywords, operators and redirections, the delimiters of `$( )`, `<( )` and `$(( ))`, variables and the names an assignment sets, numbers and names in arithmetic, glob characters where the shell expands the word, and the tree's guess of options (`-x`, `--long`, not after `--`).

From the models (src/semanticFacts.ts), painted over the tree's colours:

| Fact | Source | Kind, token |
| --- | --- | --- |
| What a command name runs: keyword, alias, function, builtin, program | `resolveName` (src/semantics/names.ts), as the panel's badge ([name-kind.md](name-kind.md)) | `keyword`; `alias` as `macro`; `function`; `builtin` as `function.defaultLibrary`; `command` as `function` |
| A command run by another one (`sudo echo`, `xargs rm`, `builtin cd`, `find -exec rm {} +`) | the spec's command slot (find's from its `expressionSpec`), `slotEnvs`, then `resolveName` there | as above |
| A word the spec reads as an option, or as data that only looks like one (`grep -e -v`, `find -name -foo`) | `interpret` (src/argv/) | `option` as `parameter`; `argument` as `string.unquoted` (our own modifier), mapped to the grammar's `string.unquoted.argument.shell`, the colour of a plain argument |
| A variable readonly or exported where it is used or set | the run state (`shellState(...).at(n)`), only where `trusts()` allows | modifiers `readonly` (standard) and `exported` (our own, declared in package.json); on the web page, the classes `cm-bx-readonly` (bold) and `cm-bx-exported` (dotted underline) |

Not painted from the specs: `test` and `[` (their words are an expression, whose operators the tree colours), and the words of a function or an alias (no spec). A subcommand (`git log`) keeps the grammar's colour.

In a host file, each shell (a workflow step, a recipe line, a GitLab job's script; a recipe with `.ONESHELL`, Markdown's blocks together) is read with its own tree and model (`scriptTree`, src/hosts/scripts.ts), as the explanations read it, and with the region's shell unless the user forced one. Nothing is painted over host syntax the extraction rewrote (`$(CC)`, `${{ }}`).

Dead code (`.dead(n)`) is not faded yet: it would be a `DiagnosticTag.Unnecessary` hint, a diagnostic of its own with a message in the catalog, on every surface. It is listed in the roadmap.

### The shebang

The first line `#!…` (only as the file's first two bytes, `isShebang` in src/syntax/tree.ts, as execve(2) reads it) is its own kind, `shebang`: to bash a comment, but the line the kernel reads to start the program it names. So it is drawn apart from comments, as the program it names:

| Surface | How |
| --- | --- |
| Panel (Meaning, Reading) | the token kind and the Reading kind `shebang`; `.kind-shebang` takes `--c-shebang`, which defaults to the command's colour (media/panel.css) |
| `panel.colors` | the role `shebang` (src/ui/themeTokens.ts), in the group of the command (src/ui/themePalette.ts) and last in `ROLE_ORDER`: `theme` takes the editor's colour of the line where it is readable (a comment's in most themes), `themeLike` gives way to the command's when the theme colours it as the comment |
| VS Code | our token type `shebang` (package.json `semanticTokenTypes`, `superType: comment`), mapped to the grammar's `comment.line.number-sign.shell meta.shebang.shell` |
| Language Server | `shebang` in the legend; sent as `comment` to a client whose `tokenTypes` does not list it (`SUPER_TYPES`, src/semanticTokens.ts) |
| Web page | the class `cm-bx-shebang`: the command's colour, in italics like a comment |

The editor gets no colour of ours by default. A theme with no rule for `shebang` colours it through the super type and the grammar's scope, as a comment, as before. `semanticTokenScopes` can only name scopes, which themes colour as comments. `configurationDefaults` could set a default of `editor.semanticTokenColorCustomizations` (VS Code 1.143 takes defaults for any setting), but only a fixed colour for every theme, or one per theme by name: not one that fits each theme, and it would change a setting of VS Code's own. So the user or the theme chooses: `"editor.semanticTokenColorCustomizations": { "rules": { "shebang": "#4ec9b0" } }`.

## Why semantic tokens, not a TextMate injection

- A grammar reads a line at a time with regular expressions. It cannot know where bash ends a here-document whose delimiter is quoted, what a name runs (a function defined above, an alias only with `expand_aliases`, a builtin of bash only), or which words a command takes as options. The tree and the models know, and the explanations already rely on them.
- An injection would be one grammar per host language (YAML block scalars, Makefile recipes with make's `$(…)`, JSON strings with escapes), each repeating what the extractors (src/hosts/) already do, and mapping columns back is the extractor's job.
- Semantic tokens use the standard types and modifiers, which every theme colours; `semanticTokenScopes` (package.json) maps each to a scope of VS Code's shell grammar, so a theme colours our tokens as it colours that grammar. The Language Server sends the same tokens to any LSP editor.

The cost: a theme needs semantic highlighting (most have it), and the tokens arrive after the grammar's colours, a moment after an edit.

## One provider per document

VS Code takes the semantic tokens of one provider for a whole document: the best match of the selectors that gives an answer. So:

- We register for the shell languages and the host languages, except those whose own extension sends semantic tokens in common use (`OWN_SEMANTIC_KINDS` in src/document-setup.ts: Python, for Pylance, and Dockerfiles, for the Docker extension's language server). In those files the shell code keeps the grammar's colour; the explanations are unchanged.
- A document with no shell code, or with the setting off for its language, gets no answer (`undefined`), never an empty one: an empty answer would hide the tokens of another provider (a Dockerfile or YAML language server).
- `semanticTokenScopes` has one entry per language we send tokens for (`SEMANTIC_LANGUAGES`); an entry without `language` would recolour the semantic tokens of every language (a test checks both).

## The switch per kind of file

`bashExplainer.highlight.enabled` is `language-overridable`: the provider reads it with `getConfiguration('bashExplainer', document)`, so `"[makefile]": { "bashExplainer.highlight.enabled": false }` turns it off for Makefiles. This is VS Code's own mechanism, shown in the settings editor, and it covers each language we colour: `shellscript`, `bats`, `makefile`, `yaml`, `github-actions-workflow`, `json` (package.json is the only JSON file we read), `markdown`, `groovy`, `jenkinsfile`.

It cannot tell apart host kinds that share a language: `yaml` is GitLab CI, and GitHub workflows without the GitHub Actions extension. A list setting of host kinds would, but it would be a second switch beside `embedded.files` for a case nobody asked for; with the GitHub Actions extension, workflows have their own language anyway. The Language Server reads the setting for every document (its clients have no language overrides of VS Code's kind).

## Speed

The tokens are asked for again when a setting they depend on changes (`TOKEN_SETTINGS` in src/settings.ts: the switch, the languages, the kinds of files, the shell), and when a shell is chosen in the panel; a request VS Code has cancelled is not worked out.

The tree is cached per document version (`TreeCache`), the model per tree (`shellState`), the shell code of a host file per version, and the tree of each of its shells per extraction: the tokens, the panel and the diagnostics share them. A range request (the visible lines) paints and reads the names and specs of those lines only; the model of the whole script is built once per version, by whichever asks first.

Measured on 5,000 lines (the sample repeated; Node 22, a laptop under WSL, medians, varying by about ±30% between runs):

| | Tree only (before) | Prototype (`proto/semantic-highlight`) | Now |
| --- | --- | --- | --- |
| Parse | 120–150 ms | 120 ms | 130–190 ms |
| Model (`shellState`) | none | about 200 ms | about 200 ms, shared |
| Full request, model built | 22 ms | 122 ms | 95–215 ms |
| Range request (60 lines), model built | 21 ms (the whole script, then filtered) | 279 ms (the model again) | 3.5–5 ms |

Whether the model trusts a variable (`trusts`, src/semantics/trust.ts) is asked at every use of it, and kept per name: a scan of the variable's writes each time made colouring quadratic in the uses of one variable (20,000 lines of `x=$i; echo "$x"`: 2.2 s, now 0.3 s with the model built).

test/highlight-speed.test.ts guards these with generous limits (full under 1.5 s, a range under 150 ms and a quarter of the full request, 20,000 lines of one variable under 8 times 5,000), skipped under coverage.
