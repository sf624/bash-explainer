# The basis of an explanation, as data

Status: in progress (2026-10-27). Step 1 (the data model and its source) done (#441); step 2 (the views and the setting) done (#442); step 3 (more facts: the catalog against the manual, every try-it in bash 5.3) done (#447). Roadmap item "The basis of an explanation, as data".

Most of what the explainer says is what the Bash manual says, and the sections it cites (`refs`) are the basis. Some of it is bash's behaviour where the manual is silent (`exit 300` exits with 44), or where the manual says otherwise (`$BASH_SUBSHELL` in a pipeline stage). A reader who checks such a line against the manual finds nothing, or the opposite, and may think we are wrong. The roadmap item asks for:

- a chip on such an explanation: "Not in the manual · checked with bash 5.2", or "Differs from the manual · checked with bash 5.2";
- a folded "Try it in your terminal": a command and its output, taken from the probe that checks the behaviour in CI;
- a setting that turns the chips and the try-its off;
- the other kinds of basis (another tool's spec, a convention) as data only for now.

The panel redesign takes the chips as row data (step P7a of [panel-redesign.md](panel-redesign.md), decision 3 of its section 8), so this item lands first and gives data that the row model can carry: language-free fields on a fact and a token, and the words of the chips from the catalog.

## 1. What a basis is

A basis is data on what an explanation rests on (src/basis.ts):

| Kind | Meaning | Its data | Source |
| --- | --- | --- | --- |
| `manual` | What the manual's sections say | `sections` | The `refs` of the fact or token (src/manual.ts: bash 5.2's numbers). The default: nothing is stored |
| `checked` | bash's behaviour; the manual does not say it | `bash` (the releases it was checked in, a list), `probes` | The probe rows that check it |
| `differs` | bash's behaviour; the manual says otherwise | as `checked` | as `checked` |
| `spec` | What another program does (an option of `grep`) | `command` | Its command spec in src/dict/ (data only, later) |
| `convention` | A habit of shell scripts, not a rule of bash | — | A style check of src/pitfalls.ts (data only, later) |

Apart from the basis, an explanation can have a **try-it** (`TryIt`): a command for the reader's terminal (`code`), what it printed (`output`, stdout and stderr as a terminal shows them), the bash it ran in, and the probe row it comes from. A `checked` or `differs` fact always has one. The data may also give one to a fact the manual states (the prototype's `local x=$(false)`), but the views show try-its only for `checked` and `differs` (section 8, decision 3). A try-it may show another value than its row's snippet (`exit 300` for the row of `exit 256`): both run in CI.

Where it is carried:

- **A fact of the message catalog** (src/messages.ts). The entry names its basis with `withBasis(entry, spec)`: the kind and the probe row with the try-it (`probe`), and other rows that check the same behaviour (`also`). A function of the params when it depends on the case, as `level` does: `exit-modulo` is `checked` for `exit` and the manual's for `return` (4.1 says that `return` keeps the least significant 8 bits; for `exit`, section 2 and 3.7.5 imply it without stating it), read from the status model's `ends`, not from the name. The facts of a line are kept once per text, so a fact whose basis depends on the params says the case in its text: `exit 300` and `return 300` on one line are two notes. `fact()` gives `Fact.basis` (only when it is not the manual's: `basisFor` gives the default) and `Fact.tryIt`. Each such entry has a comment that says what the manual's sections say and do not say.
- **A token** (step 4): `Token.basis` and `Token.tryIt`, the same types, for a text of a token that states bash's behaviour (`$_` after a command of assignments only is empty). The reading tree copies them to its nodes, as it copies `name`.
- **Other notes** (style checks, dialect issues, idioms): no basis until a step gives them `convention` or `spec`; a view shows nothing for them.

The kinds `spec` and `convention` are in the type now so that the row model is written once; nothing gives them yet, and no view shows them.

## 2. Where it comes from

One source per fact: the probe tables that already run in CI (test/fixtures/probes/*.json, test/probe.test.ts).

- A probe row that shows a behaviour to the reader gets a `try`: `{ code, output }`. `code` is written by hand, as the reader would type it: one word `bash -c '…'` with no `'` or `\` inside, so that bash, zsh and fish all hand the same script to bash (test/basis.test.ts checks the form). `output` is recorded by scripts/record-probes.ts (`tryOutput` in test/support/probe.ts: the code run by `bash --norc --noprofile -c` in a fresh directory with the probes' files and environment, with the row's bash first on `PATH` as `bash`, stdout and stderr in one file, the directory written as `BOX` and the one of the row's bash as `BIN`; the process group is killed when the shell ends, so no background job outlives it, and on a timeout). test/probe.test.ts runs it again on every CI run, with bash 5.2 (and the rows of bash 5.3 in the `bash53` job, which also runs every try-it of bash 5.2 in bash 5.3). A row with a try-it has an `id`. A try-it may span lines (`nounset-redirect` writes a script with a here-document, since `bash -c` gives another status than a script there).
- The explanations do not read the test tables, which the bundles do not hold, so scripts/record-probes.ts writes a copy of the rows with a try-it to src/basis-probes.json: `kind#id` → the section, the releases, the code and the output. test/basis.test.ts fails when the copy differs from the tables, when an entry names a row that is not there or a row about a section the fact does not cite, and when a try-it is shown by no fact. An entry that names a row with no try-it does not compile: `BasisSpec.probe` is a key of the copy. The copy is small (a few rows) and changes only when a try-it changes.
- `Basis.bash` lists the releases the try-it passed in CI: the row's own (5.2, or 5.3 for a row of `"bash": "5.3"`), then 5.3 for a row of 5.2 when bash 5.3 prints the same output. scripts/record-probes.ts writes the list into the row (`try.bash`) when `$BASH_EXPLAINER_BASH53` is set (else it keeps the one recorded), and the `bash53` job checks that a try-it prints its output in 5.3 exactly when the list names 5.3 (`extglob-new-shell` first printed `shopt extglob`, whose columns differ in 5.3, and was rewritten with `shopt -p`). The chip names them, whatever `bashVersion` is set to, never a release the try-it did not run in. The manual's sections stay the fact's `refs`.
- Whether the manual is silent or differs is a judgement, made against the bash 5.2 manual (the bash-doc package) when the entry is written, and written in the entry's comment; a test cannot check it. Step 3 went through the catalog section by section (the audit table is in #447's description); test/basis.test.ts pins the kind each entry gives, per case of its params, so that a change is a decision.

Nothing runs bash when a view is drawn: the output shown is the one recorded and checked in CI.

The argv capture of oracles step 2 (test/argv.test.ts) checks what each program receives over the fixtures, but per script, not per fact; it is not a source of try-its. It may later back a `checked` basis of the word model's fields, as data only.

## 3. How a view shows it

Look A of the prototype (branch `proto/basis`): a chip after the text, and the try-it behind a disclosure. Look B (a muted line, the try-it always open) took too much room on a line with several notes.

- **The chip.** Its words and its tooltip come from the catalog (`basisSaid(lang, basis)`, step 2): "Not in the manual · checked with bash 5.2" / 「マニュアルに記述なし・bash 5.2 で確認」, and "Differs from the manual · checked with bash 5.2" / 「マニュアルの記述と異なる・bash 5.2 で確認」; the tooltip says what it means ("bash's actual behaviour, which the Bash manual does not state: checked by running bash 5.2"). The chip is quiet (the colour of the section links), never the colour of a level: it is not a problem.
- **The try-it.** A folded "Try it in your terminal" / 「端末で試す」: the code with a copy button, then "prints" / 「出力」 and the output. The panel never runs it. A click in it neither folds the row nor moves the cursor.
- **Where.** Today's panel: after a note in Meaning, and on a node of Reading. The hover and Copy as Markdown: a line in italics after the note, and the try-it as code. The CLI's text: a dim line under the note; its JSON gains `basis` and `tryIt` on each fact (a field added, nothing removed). A try-it's output is one string, stdout and stderr as a terminal shows them; the tooltip says that messages are as bash prints them with `LC_ALL=C` (a translated bash may word them otherwise). The web page draws the same panel.
- **The panel redesign.** P7a's rows carry `basis` and `tryIt` as they come from the fact or the token; the row model adds no words of its own. P7b's problems box shows the chip on a problem's "more".

## 4. The setting

`bashExplainer.notes.basis` (boolean, default on; decided), beside `notes.pitfalls` and `notes.idioms`: off hides the chips and the try-its in every view (panel, hover, Copy as Markdown, CLI text, web page's settings). As built (step 2), it is read where `notes.pitfalls` is: the analyzer gives the facts with no basis and no try-it (`basisGate` in src/messages.ts, the one gate), so every view, and the CLI's JSON, have none; one place decides, and no view needs the setting. The CLI takes it as the other settings (`--set notes.basis=false`, the settings file).

## 5. What is kept of the prototype

Kept: the kinds (`manual`, `behaviour` split into `checked` and `differs`, `spec`, `convention`); the basis on the catalog entry, as a value or a function of the params; samples of the params in the test; a try-it that starts its own bash and shows its output; the chip's words; look A.

Changed: the prototype wrote each try-it's code and output in the catalog, and a test ran them. Here the try-it is part of the probe row that checks the behaviour, recorded by the same script and checked by the same test as the row's facts, and the catalog names the row: one place says what bash does. The prototype's labels were computed in src/basis.ts at `fact()` time; here the fact carries language-free data, and the words come from the catalog when a view draws it (step 2), so the row model and the JSON read the same data. `TOKEN_BASES` (`$_`) waits for step 4; the new note on `$BASH_SUBSHELL` came with step 3 (`bash-subshell-not-counted`).

## 6. Steps

Each step is a PR that keeps every test passing.

1. **The data model and its source** (#441). src/basis.ts (the types, `basisOf`, `basisFor`), `withBasis` in the catalog, `Fact.basis` and `Fact.tryIt`; the probe rows' `try`, recorded and checked (test/support/probe.ts, scripts/record-probes.ts, test/probe.test.ts), the copy src/basis-probes.json, test/basis.test.ts. Two facts: `exit-modulo` for `exit` (`status#exit-status`, also `status#exit-negative`) and `unset-function-and-variable` (`state#unset-fv`), both `checked`. No view change; `exit-modulo` names the builtin in its text ("`exit 300` gives 44"), a CHANGELOG line.
2. **The views and the setting** (#442). The catalog's words for the chips (`basisSaid`), the panel's notes, the hover, Copy as Markdown, the CLI (text and JSON), the web page; `bashExplainer.notes.basis`. One helper, `noteBasis` in src/ui/render.ts, gives every view the chip and the try-it of a note, only for `checked` and `differs`; `basisLine` says them in one line where there is no chip. The panel keeps a try-it the reader opened open when it draws the line again. Layout test (test/web-basis.test.ts): nothing is cut or overlaps, at 1280 and 390 px, in both languages, with CI's CJK fonts. CHANGELOG (New): "A note that rests on bash's behaviour rather than the manual says so, with a command to try it in your terminal."
3. **More facts** (#447). The catalog, section by section against the bash 5.2 manual: each entry is the manual's, `checked` or `differs`, with a probe row and a try-it for the last two (16 new try-its, in state.json, words.json and status.json). A fact is the manual's when the sections it cites state each of its claims; an exact status the manual gives only as "non-zero", and a consequence it does not state (a syntax error that stops the script), make it `checked`. The words of bash's messages are quoted as examples, not claims. Where a claim was stated in a section the entry did not cite, the entry cites it now (at most three sections). Among them the new note on `$BASH_SUBSHELL` in a simple command of a pipeline (`bash-subshell-not-counted`, `differs`; the variable's `stageUncounted` in src/semantics/vars.ts, read with the environment model in src/explain/where.ts; a CHANGELOG bullet). The `bash53` job runs every try-it in bash 5.3 too, so a chip says both releases when both agree.
4. **Tokens.** `Token.basis` and `Token.tryIt` for texts that state bash's behaviour (`$_` after assignments only), from a table keyed as the catalog is, read where the token's text is chosen; the reading tree copies them. No name checks in src/explain/: the table is keyed by the fact, not by a command.
5. **Data only: spec and convention.** Style checks get `convention`; an option's text from a spec gets `spec`. No view, until the maintainer asks for one.

Then the panel redesign's P7a takes `basis` and `tryIt` as row data.

## 7. Tests

- test/basis.test.ts (no bash): the copy equals the tables; every entry names a row with a try-it about a section it cites, and its other rows exist; every try-it is shown by some fact; a try-it is one word `bash -c '…'`; `fact()` gives the basis and the try-it, per case of the params; the analyzer gives the basis of `exit 300` and not of `return 300`, also on one line.
- test/probe.test.ts (bash): every try-it prints what it recorded; the harness keeps stdout and stderr in order, writes its directories as `BOX` and `BIN`, kills a try-it that hangs, does not call a shell that killed itself a timeout, and kills a job left in the background.
- Step 2 adds the views' tests (the setting off shows nothing; the chip's words in both languages; the JSON), and the layout tests.
- Step 3: test/basis.test.ts pins the kind of basis of every entry of the catalog, per case of its params; test/probe.test.ts runs every try-it of bash 5.2 in bash 5.3 (in the `bash53` job, its tests named "bash 5.3"), and fails when the output agrees but the row does not list 5.3, or the other way round.

## 8. Decisions

Decided by the maintainer on 2026-10-27, after the review of #441 (whose reviewer agreed on 1, 2 and 4, and proposed 3):

1. **The setting** is `bashExplainer.notes.basis`, on by default.
2. **stderr.** A try-it's output keeps stderr as a terminal shows it, in one string (for `unset -fv`, the message is the behaviour shown). The tooltip says that messages are as with `LC_ALL=C`.
3. **Try-its on facts the manual states.** For now the views show try-its only for `checked` and `differs`, so that a try-it stays a sign of "not in the manual". The data may carry a try-it on a fact of the manual (`kind: 'manual'` with a probe); no view shows it until decided otherwise.
4. **The releases on the chip** are those the try-it passed in CI (`Basis.bash`, a list), whatever `bashExplainer.bashVersion` is set to; never a release it did not run in.
