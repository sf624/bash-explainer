# Roadmap

What is planned, in the order agreed with the maintainer, and what waits on a decision. The design documents hold the details of each plan ([docs/design/README.md](design/README.md) lists them with their status); this page holds the order.

Keep it current:

- Read it before starting new work, and before proposing any.
- Update it in the same PR that starts, finishes or drops an item. Move a finished item to "Done lately" with its PRs.
- Add an item when the maintainer agrees to a plan, or asks for something that will not be done at once. An idea nobody agreed to goes under "Not decided".

## Now

1. Thin `src/analyzer.ts`: steps 1–9 of [design/analyzer.md](design/analyzer.md). Each step keeps every explanation byte-identical. Before step 1, decide whether to write the design document on the three layers (bash-ast's tree, the manual's language, bash's implementation-defined behaviour) and the kinds of basis, since it shapes the modules.

## Next, in this order

1. bash 5.3, step 2 of [design/bash-versions.md](design/bash-versions.md): fix the explanations of `printf %#q` and `%ls` first (they are wrong today), then steps 3–7.
2. Run-based oracles, steps 2–10 of [design/oracles.md](design/oracles.md): argv capture, checking suggestions in bash, the normal-forms audit.
3. Pipeline examples: show the shape of the input each stage reads (item 3 of the external review of October 2026).
4. bats, what [design/bats.md](design/bats.md) lists as not done: a model per test (its own process, `set -e`), hooks, bats-assert, tags.
5. Small gaps of the specs ([design/semantics.md](design/semantics.md), A3): procps reads digits after BSD letters as PIDs (`ps u1`); GNU tar reads a first word without a dash as letters (`tar vf a.tar`).

## Waiting on the maintainer

- A check on a real phone of the zoom fix (#285).

## Not decided

- Variable kinds: say what a variable name is where it is used, as the name kinds do for commands: a shell variable, an exported (environment) variable that child processes see, a special parameter (`$?`, `$@`), a function's local, or one bash sets itself (`RANDOM`, `SECONDS`). The model already has the attributes (`shellState`). It answers the same question as `sudo echo`: what a child process sees.
- `which` against `type` and `command -v`: a sentence saying that `which` looks only for programs on PATH, while `type` and `command -v` also find builtins, functions and aliases, so their answers can differ.

## Done lately

- Name kinds: a badge on every command name (keyword, builtin, function, alias, program) and a "Same name, also" line, in both panel views (#306; [design/name-kind.md](design/name-kind.md)).
- Panel header, Meaning/Reading names, the eight steps, fold motion and the row kept in place (#293, #294, #292); "subshell" in Reading (#296). Plain elbows in Reading (#299).
- Web page: same icons as VS Code (#297), the bar's order (#298), no version switch on the release page (#302). A pasted script sets the file kind (#295). README npm badge (#300).
- Design documents brought up to date (#301), with an index (#303).
