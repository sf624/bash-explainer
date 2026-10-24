# Name kinds: what a command name is

The same text runs different things. `echo hi` runs bash's builtin; `sudo echo hi` runs the program `/usr/bin/echo`, because sudo looks the name up and has no builtins; after `echo() { …; }`, `echo hi` runs the function. `time` is a reserved word, but `command time ls` runs the program `time`. A learner sees the same word and cannot tell. Bash's own tool for it is `type -a NAME` (3.7.2, 4.2).

The panel shows it on every command name, in both views: a badge with the kind, who looks the name up when bash does not, and, only on a name with another meaning, one muted line on what else the same name is and the code that reaches it.

## Inventory

What a command name can be (3.7.2, in bash's order), and the badge:

| Kind | Badge (en / ja) | Edge | Example |
| --- | --- | --- | --- |
| reserved word | keyword / 予約語 | solid, the keyword colour | `time`, `[[` |
| alias | alias / エイリアス | solid | `ll` after `shopt -s expand_aliases; alias ll='ls -l'` |
| function | function / 関数 | solid | `f` after `f() { …; }` |
| builtin | builtin / ビルトイン | solid | `cd`, `echo`, `[` |
| program | program / プログラム | dashed | `ls`, `apt-get`, `echo` under `sudo` |
| nothing | nothing runs / 実行されない | dotted | `builtin nope` |

Where the names are:

- the name of a simple command (the token of the command; for `[`, the token of `[`);
- a command another command runs (`sudo echo`, `xargs kill`, `find -exec`, `env`, `nohup`, `exec`, `command`, `builtin`): the badge says "run by `sudo`";
- the reserved words that stand where a command name does: `time` and `[[`. In Reading, a reserved word's node has no badge (its kind, "keyword", says it), but keeps its line on the other meanings.

A subcommand (`git commit`) has no badge: bash does not look it up; it stays a command with the note that to the shell it is an argument. A name that is an expansion (`$cmd`) has none: it is known only when the line runs.

The other meanings, and the code that reaches each:

| Here | Also | Reached with |
| --- | --- | --- |
| reserved word `time` | program | `command time`, `\time`, `env time` |
| builtin `echo` | program | `env echo` |
| function `echo` | builtin; program | `builtin echo`, `command echo`; `env echo` |
| function `ls` | program | `command ls` |
| alias `grep` | program | `\grep`, `command grep` |
| program `echo` run by `sudo` | builtin | `echo` (said as: "`sudo` looks the name up, so this is the program, not bash's builtin") |
| program `\grep` (quoted) | alias | `grep` |
| program `f` run by `command` | function | `f` |
| program `echo` after `enable -n echo` | builtin, turned off | `enable echo` turns it on again |
| program `time` run by `command` | reserved word | `time`, first and unquoted |

## Options

Three looks were prototyped (`?nameKind=a|b|c` on the web page, never merged):

- **A. A badge.** The kind's word after the name. Clear and readable by a screen reader, but it says only what runs here; the confusing cases (`sudo echo`, `command time`) need the other meaning too.
- **B. A colour and an underline style per kind**, on the name in the line and in the rows, with a legend. Compact, but the roles already own the colours (a command is blue whatever its kind), a colour alone fails for colour-blind readers and in forced colours, and the legend must be learnt.
- **C. The badge, and a line on the other meanings.** The badge of A, plus "Same name, also: …" with the code that runs each other meaning, only where there is one. It teaches the lookup order where it matters, and costs nothing on names that are only one thing.

The maintainer chose C, always on (no setting).

## Rules

- The facts come from the model: `resolveName` (src/semantics/names.ts) says what runs, and `nameFacts` adds who looks it up (the slot of src/semantics/env.ts that runs the word) and the other meanings. "Also a program" comes from the dictionary (the program a builtin's entry describes, `CommandSpec.program`, and the programs named like reserved words); nothing reads the file system, so the path is "usually `/usr/bin/NAME`". A path (`/bin/echo`) names no other meaning.
- The texts come from the catalog, src/messages.ts (`nameSaid`: the kind's word, its tooltip, "run by", the line, and the suffix of the outputs with no badge), in both languages, with the manual's sections of each kind. src/namefacts.ts joins them into `Token.name`; the analyzer only asks for it where it makes the token of a name, and src/reading.ts copies it to the nodes of the Reading view.
- The panel draws what it is given (media/panel.js `nameBadge`, `nameAlso`); it composes no text.
- The badge replaces the kind in the text: the dictionary's "(shell builtin)" suffix is gone from the explanations, and the programs named like builtins say their package instead ("(from coreutils)", "(from procps; …)"). The outputs with no badge (the hover, the CLI's text and Markdown, Copy as Markdown) end the row with the kind from the same field, " (builtin)", " (program, run by `sudo`)"; the JSON output has the whole `name`. The line's summary (the inline hint) keeps a builtin's kind, as before.
- An alias is a token kind of its own (`alias`), no longer `function`.

test/name-kinds.test.ts checks the model against bash: the line runs what the badge says, each code of the line runs the meaning it is given for, and `type -a` lists the same meanings (the differences are listed with their reasons). test/web-name-kinds.test.ts checks the badges in both views, on the web page at 1280 and 390 pixels and in the VS Code panel; test/contrast.test.ts the colours (the word in the foreground colour, at least 4.5:1; the edge at least 3:1).
