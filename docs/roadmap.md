# Roadmap

What is planned, in the order agreed with the maintainer, and what waits on a decision. The design documents hold the details of each plan ([docs/design/README.md](design/README.md) lists them with their status); this page holds the order.

Keep it current:

- Read it before starting new work, and before proposing any.
- Update it in the same PR that starts, finishes or drops an item. Move a finished item to "Done lately" with its PRs.
- Add an item when the maintainer agrees to a plan, or asks for something that will not be done at once. An idea nobody agreed to goes under "Not decided".

## Now

1. Thin `src/analyzer.ts`: steps 1–9 of [design/analyzer.md](design/analyzer.md). Each step keeps every explanation byte-identical. The modules follow what is explained, not the three layers (bash-ast's tree, the manual, bash's behaviour): those become data, the next item.

## Next, in this order

1. Explanation fixes asked on 2026-10-25, after step 7 of the analyzer (they touch the code it moves): `builtin cd` and `command cd` run the builtin in the same shell (not "run by `builtin`" / "`builtin` reads"); the keyword badge only on reserved words that have another meaning (`time`), not on `[[`; `-it` of `docker run`/`exec` split into `-i` and `-t` as other combined options are (today a dictionary entry of its own); a positional parameter in a script run by another shell (`sudo sh -c '… $1 …' sh "$msg"`) says in Meaning whose argument it is; brace sequences name their parts (`{1..10..3}`: first, last, increment).
2. Show the value of an expansion the script fixes (`msg="hello"; echo $msg` → `hello`) in Meaning, where the model trusts the value.
3. Every pitfall stated as a problem, with its level and its range, once the thinned analyzer gives note nodes ([design/note-levels.md](design/note-levels.md), "The bridge"): the views then read the level from the node, not from the note's mark (`noteLevel`, `splitNote`). Today only the pitfalls of src/pitfalls.ts and src/wordfacts.ts are problems; the other notes found on a node already carry its range (`LineExplanation.anchors`, for the part hover). Decided with the hover ([design/hover.md](design/hover.md)); the other notes stay out of the diagnostics until then.
4. The basis of an explanation, as data, after the analyzer is thinned: an explanation that rests on bash's behaviour rather than the manual gets a chip ("Not in the manual · checked with bash 5.2", or "Differs from the manual"), and a folded "Try it in your terminal" with a command and its output, taken from the probe that checks it in CI (look A of the prototype on branch `proto/basis`). A setting turns the chips and the try-its off. Other kinds of basis (another tool's spec, convention) are data only for now.
5. bash 5.3, step 2 of [design/bash-versions.md](design/bash-versions.md): fix the explanations of `printf %#q` and `%ls` first (they are wrong today), then steps 3–7.
6. Run-based oracles, steps 2–10 of [design/oracles.md](design/oracles.md): argv capture, checking suggestions in bash, the normal-forms audit.
7. Pipeline examples: show the shape of the input each stage reads (item 3 of the external review of October 2026).
8. bats, what [design/bats.md](design/bats.md) lists as not done: a model per test (its own process, `set -e`), hooks, bats-assert, tags.
9. Small gaps of the specs and the models ([design/semantics.md](design/semantics.md), A3): procps reads digits after BSD letters as PIDs (`ps u1`); GNU tar reads a first word without a dash as letters (`tar vf a.tar`). The word model (`wordMeaning`, src/semantics/words.ts) applies brace expansion in every shell: in a `#!/bin/dash` script, `echo {a,b}` is said to expand, though dash (like POSIX sh) has no brace expansion and prints `{a,b}` (noted in #332; only the redirection target checks the dialect, `braceWorks` in src/explain/redirections.ts).
10. Dead code faded in the editor: a `DiagnosticTag.Unnecessary` hint on a statement that never runs (`shellState(...).dead(n)`), with its message in the catalog and on every surface ([design/highlighting.md](design/highlighting.md)).

## Waiting on the maintainer

- A check on a real phone of the zoom fix (#285).

## Not decided

- Variable kinds: say what a variable name is where it is used, as the name kinds do for commands: a shell variable, an exported (environment) variable that child processes see, a special parameter (`$?`, `$@`), a function's local, or one bash sets itself (`RANDOM`, `SECONDS`). The model already has the attributes (`shellState`). It answers the same question as `sudo echo`: what a child process sees.
- Makefile recipes: make execs simple lines directly; the badge should say program, run by make. (GNU make runs a recipe line with no shell syntax without a shell: `echo -e x` execs `/bin/echo`, which prints `-e x`; the badge says builtin.)
- `which` against `type` and `command -v`: a sentence saying that `which` looks only for programs on PATH, while `type` and `command -v` also find builtins, functions and aliases, so their answers can differ.

## Done lately

- Reading view: each reader's band has a rule in its colour on the left and hairlines at its ends; a click on a row on another line (a `case` clause in a `while`) only folds it, without moving the editor to that line (#342; [design/tree-view/README.md](design/tree-view/README.md)).
- Syntax colouring on by default, switched per language, with what a name runs, options by the specs and readonly variables from the models; fast range requests (#321; [design/highlighting.md](design/highlighting.md)).
- Panel colours from the editor theme: the setting `bashExplainer.panel.colors` (`classic`, `theme`, `themeLike`) ([design/theme-colours.md](design/theme-colours.md)).
- The hover explains the part at the position; a card on no part; the whole line per command through `Ctrl+K Ctrl+E` or the hover's link; no tree glyphs; the Language Server's hover starts with the part (#317; [design/hover.md](design/hover.md)). The part shows only its own notes, and counts the others in a link to the whole line ([design/hover.md](design/hover.md), "Notes").
- Name hints after the command names that do not run what they suggest, in VS Code and the Language Server; the inline summary removed, its settings deprecated (#318; [design/hover.md](design/hover.md)).
- Note levels: warning, caveat and plain fact, from the catalog, the style checks and the dialect issues, shown with an icon, a word and a colour in every view (#320; [design/note-levels.md](design/note-levels.md)).
- Name kinds: a badge on every command name (keyword, builtin, function, alias, program) and a "Same name, also" line, in both panel views (#306; [design/name-kind.md](design/name-kind.md)).
- Panel header, Meaning/Reading names, the eight steps, fold motion and the row kept in place (#293, #294, #292); "subshell" in Reading (#296). Plain elbows in Reading (#299).
- Web page: same icons as VS Code (#297), the bar's order (#298), no version switch on the release page (#302). A pasted script sets the file kind (#295). README npm badge (#300).
- Design documents brought up to date (#301), with an index (#303).
