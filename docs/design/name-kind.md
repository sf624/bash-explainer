# Name kinds: what a command name is

The same text runs different things. `echo hi` runs bash's builtin; `sudo echo hi` runs the program `/usr/bin/echo`, because sudo looks the name up and has no builtins; after `echo() { …; }`, `echo hi` runs the function. `time` is a reserved word, but `command time ls` runs the program `time`. A learner sees the same word and cannot tell. Bash's own tool for it is `type -a NAME` (3.7.2, 4.2).

The panel shows it on every command name, in both views: a badge with the kind, who looks the name up when bash does not, and, only on a name with another meaning, one muted line on what else the same name is and the code that reaches it.

## Inventory

What a command name can be (3.7.2, in bash's order), and the badge:

| Kind | Badge (en / ja) | Edge | Example |
| --- | --- | --- | --- |
| reserved word | keyword / 予約語 | solid, the keyword colour | `time` |
| alias | alias / エイリアス | solid | `ll` after `shopt -s expand_aliases; alias ll='ls -l'` |
| function | function / 関数 | solid | `f` after `f() { …; }` |
| builtin | builtin / ビルトイン | solid | `cd`, `echo`, `[` |
| program | program / プログラム | dashed | `ls`, `apt-get`, `echo` under `sudo` |
| nothing | nothing runs / 実行されない | dotted | `builtin nope` |

Where the names are:

- the name of a simple command (the token of the command; for `[`, the token of `[`);
- a command another command runs (`sudo echo`, `xargs kill`, `find -exec`, `env`, `nohup`, `exec`, `command ls`, `builtin ls`): the badge says "run by `sudo`". A builtin that `command` or `builtin` finds (`builtin cd`, `command echo`) runs in this shell, as bash runs a command name: its badge is the builtin's alone, its explanation is the builtin's (no "runs `cd`"), and in Reading it is a command name of bash's layer under the word, whose arguments `cd` reads (decided by the maintainer, 2026-10-25);
- the reserved word `time`, which stands where a command name does and is also a program. In Reading, a reserved word's node has no badge (its kind, "keyword", says it), but keeps its line on the other meanings. `[[` has none (decided by the maintainer, 2026-10-25): it is a test, which no other meaning shares.

A subcommand (`git commit`) has no badge: bash does not look it up; it stays a command with the note that to the shell it is an argument. A name that is an expansion (`$cmd`) has none: it is known only when the line runs.

The other meanings, and the code that reaches each:

| Here | Also | Reached with |
| --- | --- | --- |
| reserved word `time` | program | `\time`, `command time` |
| reserved word `time`, after `function time { …; }` | function; program | `\time`; `command time` |
| builtin `echo` | program | `env echo` |
| function `echo` | builtin; program | `builtin echo`, `command echo`; `env echo` |
| function `ls` | program | `command ls` |
| nothing (`builtin ls`) | program | `ls` |
| nothing (`builtin ls`, after `ls() { …; }`) | function; program | `ls`; `command ls` |
| nothing (`builtin echo` after `enable -n echo`) | builtin, turned off; program | `enable echo` turns it on again; `echo` |
| nothing (`command [[`: "command not found") | reserved word | `[[`, first and unquoted |
| alias `grep` | program | `\grep`, `command grep` |
| program `echo` run by `sudo` | builtin | `echo` (said as: "`sudo` looks the name up, so this is the program, not bash's builtin") |
| program `\grep` (quoted) | alias | `grep` |
| program `f` run by `command` | function | `f` |
| program `echo` after `enable -n echo` | builtin, turned off | `enable echo` turns it on again |
| program `cd` run by `sudo` | builtin | `cd` (said as: "`sudo` looks the name up, so bash's builtin does not run, and there is usually no program of this name") |
| program `ll`, with an alias `ll` and no `shopt -s expand_aliases` | alias, not expanded here | none (needs `shopt -s expand_aliases`) |
| program `time` run by `command` | reserved word | `time`, first and unquoted |

## Options

Three looks were prototyped (`?nameKind=a|b|c` on the web page, never merged):

- **A. A badge.** The kind's word after the name. Clear and readable by a screen reader, but it says only what runs here; the confusing cases (`sudo echo`, `command time`) need the other meaning too.
- **B. A colour and an underline style per kind**, on the name in the line and in the rows, with a legend. Compact, but the roles already own the colours (a command is blue whatever its kind), a colour alone fails for colour-blind readers and in forced colours, and the legend must be learnt.
- **C. The badge, and a line on the other meanings.** The badge of A, plus "Same name, also: …" with the code that runs each other meaning, only where there is one. It teaches the lookup order where it matters, and costs nothing on names that are only one thing.

The maintainer chose C, always on (no setting).

## Rules

- The facts come from the model: `resolveName` (src/semantics/names.ts) says what runs, and `nameFacts` adds who looks it up (the slot of src/semantics/env.ts that runs the word) and the other meanings. "Also a program" comes from the dictionary (the program a builtin's entry describes, `CommandSpec.program`, and the programs named like reserved words); nothing reads the file system. The path is said only where the dictionary gives one (`CommandSpec.path`: the programs named like builtins, `/usr/bin/time`); else the line says "a program in PATH". A path (`/bin/echo`) names no other meaning.
- The code of each other meaning comes from what the name resolves to where it is, in the shell around the command (`resolveName` asked again: the bare name, `\NAME`, `command NAME`, `builtin NAME`). The bare name is given when it reaches that meaning; else `\NAME` (no alias, no reserved word) where it does, and `command NAME` (no function either); `builtin NAME` for a builtin; and `env NAME` for a program only where a builtin of the name is on, so that `command` and `\NAME` find the builtin first.
- Nothing runs: `builtin NAME` where no builtin has the name (or it is turned off by `enable -n`), and a reserved word looked up as a command (`command [[`, `\if`), which no program is named: bash says "command not found". A builtin with no program of its name, run by a program (`sudo cd`, `nohup cd`), is said so: "there is usually no program of this name".
- The texts come from the catalog, src/messages.ts (`nameSaid`: the kind's word, its tooltip, "run by", the line, the suffix of the outputs with no badge, and what a screen reader says), in both languages. The token keeps the sections of the manual on what the name runs (a builtin's own section, `builtinSections`). src/namefacts.ts joins them into `Token.name`; the analyzer only asks for it where it makes the token of a name, and src/reading.ts copies it to the nodes of the Reading view.
- The panel draws what it is given (media/panel.js `nameBadge`, `nameAlso`); it composes no text.
- The badge replaces the kind in the text: the dictionary's "(shell builtin)" suffix is gone from the explanations, and the programs named like builtins say their package instead ("(from coreutils)", "(from procps; …)"). The outputs with no badge (the hover, the CLI's text and Markdown, Copy as Markdown) end the row with the kind from the same field, " (builtin)", " (program, run by `sudo`)"; the JSON output has the whole `name`. The line's summary (the inline hint) keeps a builtin's kind, as before.
- An alias is a token kind of its own (`alias`), no longer `function`.
- A POSIX special builtin (4.4: `set`, `export`, `exit`…, and `source` and `times`, which bash 5.2 treats so) keeps the badge "builtin", since it differs from the others in POSIX mode only; its tooltip names the class and what POSIX mode changes (`NameFacts.special`).

## Limits

- An alias named like a reserved word (`alias time=date` with `shopt -s expand_aliases`): bash expands it, since it looks for aliases before reserved words, but the parser (unbash) reads `time` as the reserved word, so the badge says keyword. A rare case; it needs the parser to know the aliases.
- The model does not know the file system: "a program" may not be there (`ll` with an alias that is not expanded is "command not found"), and a program that is not in the dictionary is never listed as another meaning of a builtin's or a function's name, except as "a program in PATH" where the dictionary knows the name.
- After `hash -p PATH NAME`, the badge says program; the line does not list the program PATH would find.
- In POSIX mode, a function named like a special builtin cannot be reached by its name; it is not listed.
- Reserved words other than `time` (`[[`, `if`, `while`, `{`…) get no badge: their kind is the construct they start.
- In a string run by another shell (`bash -c 'echo hi'`), the codes are those of the shell where the name is, read with the functions that shell gets.

test/name-kinds.test.ts checks the model against bash: the line runs what the badge says, each code of the line runs the meaning it is given for, and `type -a` lists the same meanings (the differences are listed with their reasons). test/web-name-kinds.test.ts checks the badges in both views, on the web page at 1280 and 390 pixels and in the VS Code panel; test/contrast.test.ts the colours (the word in the foreground colour, at least 4.5:1; the edge at least 3:1).
