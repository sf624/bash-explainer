# Facts and their sources

Status: agreed by the maintainer on 2026-10-31. Phase A (the guards) is in progress; phase B goes into the UX steps; phase C waits until after 0.10.0. The order is in [../roadmap.md](../roadmap.md).

Counts and line numbers are at a54d9435 (the release of 0.9.0). They come from three read-only audits of that commit (2026-10-31), checked where this page says so, and from searches of the code.

## 1. The diagnosis

In every layer, a fact has a source: the word model, the argument interpreter, `resolveName`, the message catalog, the note levels. But nothing forces callers to use it. New code reads the tree or the text again, or keeps its own table, and each fix of the source leaves the copies behind.

The refactoring of October 2026 ([refactor.md](refactor.md)) removed 55 such copies. It fixed instances, not the mechanism: no test stopped the next copy. The few facts that have a guard test stayed clean: the names guard of src/explain/, the syntax boundary, the web page's storage, the trust allow-list.

So each fact gets a source and a guard: a test that fails on a new reading outside the source. Today's offenders go into a known list that may only shrink, as [word-source.md](word-source.md), section 4, does for words.

## 2. Design before wording

Decided by the maintainer on 2026-10-31: "If keeping today's explanations has bent the overall design, fix the design even if the explanations change: a clean, consistent design should produce clean explanations."

- **The model is the source.** An explanation says what the model knows. Where a clean model cannot support a text, the text changes: it gets simpler, or less precise. The model does not grow a special case to keep it.
- **Refactoring steps need not keep explanations byte-identical.** Each PR lists the explanation changes it makes (in its description, with a few before/after lines of test/snapshot.ts or a dump). None may contradict bash or the tool: the probes, the example tables and the renderings check (test/support/renderings.ts) still pass. A change users notice gets a CHANGELOG line.
- **Less precise is not wrong.** "`b` is a source or the destination, depending on how many words `$a` gives" is true. "`b` is the destination" is wrong when `$a` gives none. The first is allowed; the second is a bug.

### 2.1 Machinery kept for a wording

These places exist mainly to keep a particular wording or precision. For each: what the clean model gives, what the explanation would then say, and whether the machinery can go. "C" marks the rows that simplify a phase C migration (section 4).

| # | Machinery | The clean model gives | The explanation would say | Can it go? | Recommendation |
| --- | --- | --- | --- | --- | --- |
| M1 | The clauses of the count hedges: profiles, classes, conditions of at most two atoms, at most four clauses (`CLAUSES`), the folded text, and their ja/en texts (src/argv/profiles.ts, 313 lines; profiletexts.ts, 162; much of src/explain/operand-texts.ts, 238). Steps 6–7 of [count-hedges.md](count-hedges.md) would add more. | The table of readings, one per argv shape (src/argv/readings.ts): for each word, the set of roles over the shapes, and the words whose counts change it. | One role where every shape agrees. Else the roles and the words that decide ("source or destination, depending on how many words `$a` gives"). Keep one clause for one word and one atom ("source when `$a` expands to nothing"): it is the common `cp $a b`. | Mostly. readings.ts stays (it is the model, and the renderings check reads it); the classes, the conditions of two atoms and the budget go. | After 0.10.0, before count-hedges steps 6–7: simplify the texts, then judge steps 6–7 again (they may not be needed). C (words: fewer readers of counts) |
| M2 | The trust special cases S1–S17 of #498 and #501 ([trust-fields.md](trust-fields.md), 1.2; src/semantics/deferred.ts, parts of effects.ts), and the redesign meant to replace them (src/semantics/fieldshape.ts, 589 lines, step 1 done). They keep values, decisions and dead code that a blind script would lose. | The allow-list's rule: a builtin's word whose fields the word model does not know makes the script trust nothing. With one simple field rule: an operand that starts with literal text other than `-` or `+`, or after `--`, cannot be an option (S9, S16). | Fewer "always true" decisions and fewer values in scripts that print a variable with `printf`, or run one in late code (`trap`). The common idioms (`printf "Usage: $0\n"`, `read -p "$p" x`) stay trusted by the simple rule. | Partly: S5–S8 and S10–S14 (plans, caps, late code) are candidates. Measured gain of trust-fields: one snippet. | Before trust-fields step 2: remove each candidate in turn and measure what the corpus and the real scripts lose; delete those that lose nothing in representative scripts, and drop trust-fields steps 2–6 unless the rest needs one rule. C (words: fieldshape folds in, word-source step 6) |
| M3 | `simulateRedirects` (src/idioms.ts), which computes the descriptor table as localised prose, with the `2>&1 >file` pitfall inside it as a plain `note:` string; and the readers that read the redirections again (`stdinOf`, `pipelineStage`, `descriptors`, `replacedBy`, `OUTPUT`, `OPENS_FILE`). | A descriptor table per command in src/semantics (fd → file, pipe, terminal, closed; in order; `exec` carried along the walk). | The table, rendered from data ("stdout → out.log, stderr → the terminal"). The pitfall becomes a catalog fact: a warning, a problem, with its rewrite. The prose sentences go. | Yes: the prose builder and the four second readings. | Phase B takes the pitfall into the catalog (before P7a); phase C builds the table. C (the descriptor model) |
| M4 | The texts of the declaration builtins in src/explain/argv.ts (`markedAssignment`, `declaredOperand`, `argumentAssignment`, `bracedDeclare`, `unsetOperand`, `badName`: about 270 lines, read with `readDeclarationWords` on raw nodes; line 506 says `declare` for `local` and `typeset`). The file is at 995 of 1,000 lines. | The walk's outcome for each operand: sets `x` with these attributes in this scope; refused (not a name, readonly); prints. | One catalog text per kind of outcome, with the name and the attributes as parameters. Some bespoke phrasings (braced names, `-p` combinations) become the general text. | Yes: the six functions become one renderer. | Phase C, with the outcomes from the walk. C (declaration outcomes) |
| M5 | `knownTruth` in src/examples/runtime.ts: the examples' own tables for `[` and `[[`, so that an example can show a result (the extglob example is wrong). | The model's evaluator (src/semantics/conditions.ts). | The model's result where it decides; where it does not, the example shows both outcomes or none. | Yes. | Phase C, one test evaluator. C |
| M6 | The pipeline examples' decisions by command name (src/examples/pipeline.ts: `sourceOutput` for `echo`, `printf`, `seq`; `inertStages`; `firstIsCatFile`; `consumer.cmd.endsWith('grep')`; about eight registries of simulators). | Stage facts from the spec (`io`, `copies`, a runner per spec) and the values of the word model. | An example where every stage has a runner, else none. `printf "%s\n" b a \| sort \| uniq -c` then gets its example, as the single-quoted form does today (checked: double quotes give "made-up lines"). | The name switches, yes; the runners stay. | Guard first (phase A, names in src/examples); the rest in phase C, with `commandRead`. C |

## 3. The facts and their sources

One row per fact. "Offenders" are the readings outside the source today. "Phase" is when the copies go (section 4). "Common bug" says whether a wrong or missing explanation in representative usage (tutorials, LPIC/LinuC material) depends on the copies; checked ones say so.

| # | Fact | Source | Guard test | Offenders today | Phase | Common bug |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | What bash makes of a word: its fields and their count, quoting, globbing, literal start and end, tildes, braces | `wordMeaning`, `wordFields` (src/semantics/words.ts), `ownChars` (chars.ts); `WordView` planned | test/word-source.test.ts (phase A, word-source step 1, being built) | 25 decider rows, about 45 functions in 35 files ([word-source.md](word-source.md), 2.4) | A guard; C migration (word-source steps 2–8) | No wrong text; one lost token: the tilde in `[ -f ~/.bashrc ]` |
| 2 | How a command reads its words: the spec found, options, values, operands | `interpret` (src/argv/interpret.ts) with the lookup of src/explain/reads.ts; `commandRead(n)` planned on the model | Phase A: `interpret(` and option regexes outside src/argv/ and `commandRead` | 21 `interpret(` calls in 11 files (checked); 34 lines of `/^-…/` in 23 files outside src/argv, src/dict, src/embedded (a rough count; the guard's list is exact); three hand lists of commands that cannot fail (status.ts `cannotFail`, `closesEarly`, checked; writechecks.ts `SAFE_BUILTINS`, checked) | A guard; C migration | No: rare spellings (`read -pr x` passes the `read -r` check; `head -n -1` taken as closing early) |
| 3 | `command` and `builtin` unwrapped | `wrapped`, `commandWords` (src/semantics/effects.ts) | Planned, with row 2 | The loop written again in 5 places; skipped in 3 | C, with `commandRead` | No |
| 4 | What a command name runs | `resolveName` (src/semantics/names.ts) | test/names-probes.test.ts (behaviour); no static guard | src/idioms.ts never asks it (an idiom of `read` matches a function `read`); walker.ts `functionCalled` repeats a rule | C, with `commandRead` | No |
| 5 | A command's behaviour from its spec, not its name | The specs (src/dict/), `CommandSpec` fields | Names guard of test/explain-imports.test.ts (src/explain/: 3 known); phase A extends it to src/examples/ | 0 in src/explain/; src/examples/ not scanned (pipeline.ts by name, row M6) | A guard; C (M6) | Missing example: `printf "%s\n" b a \| sort \| uniq -c` (checked) |
| 6 | Where each file descriptor of a command points | None in the model (src/semantics/redirects.ts says only safe or may fail); `simulateRedirects` (src/idioms.ts) as prose | Planned, with the model | 4 readers (M3) | B (the pitfall as a fact, before P7a); C (the model) | Yes: `cmd 2>&1 >out.log` is a plain note, not a warning or a problem (checked); `exec < data.txt; sort` labels sort's input as stdin |
| 7 | What a declaration builtin does with each operand | The walk (src/semantics/walk/builtins.ts), `readDeclarationWords` (src/semantics/vars.ts) | Planned | 6 functions in src/explain/argv.ts (M4; line 506 checked) | C | No (rare: `local` named `declare`) |
| 8 | The parts of a `${…}` | The adapter's `expansion` nodes (src/syntax/adapters/unbash.ts) | Planned: a tree accessor, then a guard on `parseExpansion(` | `parseExpansion` from text: 59 calls in 21 files | C | No (line continuations inside, rare) |
| 9 | What a shell does differently from bash (behaviour, not syntax) | `FEATURES` (src/shellfeatures.ts) for syntax only; a behaviour table planned, with a three-valued `isBash` | Planned | 29 inline tests in 22 files; `sh` and unknown shells treated differently | C | No |
| 10 | The shell a script is read as, and how it starts (shebang, options) | `detectShell` (src/dialect.ts), `shebangStart` (src/semantics/state.ts), `childOpening` (opening.ts): three readers; one `Opening` planned | Planned | 3 parsers of the shebang | B (`detectShell` gives its source, before C5); C (one `Opening`) | No (rare: `#!/usr/bin/env -S -u LANG bash` picks `LANG`) |
| 11 | Whether a `test` or `[[ ]]` is true | src/semantics/conditions.ts | test/decisions.test.ts (behaviour) | src/semantics/walk/conditions.ts; `knownTruth` (M5); operators tabled in about 5 places | C | No (the extglob example) |
| 12 | What differs between bash 5.2 and 5.3 | `SINCE` (src/bashversion.ts) and three other mechanisms | Planned: named differences, tested against [bash-versions.md](bash-versions.md) | About 30 inline version tests in about 10 files | C | No |
| 13 | A note's level and how each output shows it (severity per protocol, ANSI, codicon, glyph, rank, palette variable, word, accessible name) | `severityOf`, `MARKS`, `PITFALL_WORD` (src/messages.ts); the level table of [three-levels.md](three-levels.md) step 1 | Phase A: level literals outside the table | About 14 places (the CLI, the Language Server, diagnostics, the web editor and Problems list with `⚠`/`ⓘ`, checked at web/problem-list.ts:31, the panel, the hover, render.ts, palette.ts, a11y.ts); action.yml counts failures by grepping titles | A guard; B (three-levels step 1, before chrome C2) | Yes, visible: three vocabularies (a screen reader hears "Warning … Pitfall:") |
| 14 | A note's text as a catalog fact | The catalog (src/messages.ts, `fact()`) | Phase A: `cx.note` and `cx.say` with a plain string | 9 `cx.note` calls with a string (searched; the audit said 10); about 130 inline token texts without an id | A guard; B (before P7a) | Yes: row 6's pitfall |
| 15 | What a token's row says and shows | None: four renderers (media/panel.js `item()`, src/ui/hoverView.ts, src/ui/render.ts `toPlainMarkdown`, cli/main.ts `textOutput`) | Planned: the row record's tests (P7a) | 4 renderers; past features touched 5 to 14 files each | B (P7a's row record) | No |
| 16 | The Reading steps, and what data a view needs | media/panel.js (untyped, outside coverage); `needsReading` planned in src/ui | Planned (unit tests of the module) | `view === 'tree'` decided twice (src/ui/panel.ts:154, :182 and web/main.ts:210, checked); the page mirrors the panel's header with a MutationObserver | B (before P1) | No |
| 17 | The panel's and the page's own texts | `ui` in src/ui/render.ts (200 lines inside a renderer) | Planned: the ja-style check over inline pairs of src/ui and panel.js | Inline ja/en in panelView.ts, cli/lsp.ts, web/main.ts; a line label in four forms | B (before P7a: `ui` out of render.ts) | No |
| 18 | The colour of each kind of token | None: five tables (render.ts `KIND_ROLE`, web/editor-colors.ts, panel.css, the CLI's `ANSI`, panel.js `ROLES`) | panel.css only | 4 copies | C | No |
| 19 | The view switch and the header's controls | None: three copies (the panel body, web/index.html, panel.js) | Planned (P1's `viewControl`) | 2 copies | C, or gone with P1, P8 and chrome C7 | No |
| 20 | Where code runs (subshells, slots, calls) | `shellState().env(n)` (src/semantics/env.ts) | test/env-probes.test.ts | None found | Healthy | No |
| 21 | The shell state along a script | `shellState().at(n)` (src/semantics/state.ts) | test/state-probes.test.ts | None found | Healthy | No |
| 22 | What decisions may rely on | src/semantics/allow.ts, read by the trust scan and the walk with shared builtin readers | test/allow-list.test.ts | None found (but M2) | Healthy | No |
| 23 | The parser | src/syntax/adapters/unbash.ts | test/syntax-boundary.test.ts | 0 | Healthy | No |
| 24 | The hover's Markdown, the problems of a document | src/ui/hoverView.ts; `diagnosticsFor`, `explainDocumentLine` (src/document.ts, src/service.ts), shared by every host | test/hover-view.test.ts, test/document.test.ts | 0 | Healthy | No |
| 25 | The settings | src/settings.ts | test/settings-schema.test.ts (against package.json) | 0 | Healthy | No |
| 26 | The web page's stored state | web/storage.ts | test/web-storage.test.ts | 0 | Healthy | No |

## 4. Phases

### Phase A: the guards (now, beside the UX work)

One test per fact, each with a known list of today's offenders that may only shrink (an entry that matches less than its count is stale, and fails). Tests and fixtures only; no src/ change, no CHANGELOG. Each guard is a small PR; A2 to A5 may go together.

1. **A1. Words** (row 1): test/word-source.test.ts and test/fixtures/word-source-known.json, as [word-source.md](word-source.md), section 4, details: it is the detailed plan of row 1, and its step 1. Being built.
2. **A2. Command reading** (rows 2 and 3): `interpret(` calls, and option scans by regex (`/^-…/`, tests of an option's `.text`), outside src/argv/ and the future `commandRead`.
3. **A3. Command names in src/examples** (row 5): the names guard of test/explain-imports.test.ts also scans src/examples/, except the language interpreters (jq, awk, sed, perlrun, yaml, regex).
4. **A4. Note levels** (row 13): severity numbers, level words, the glyphs `⚠` and `ⓘ`, and codicon names of levels, outside the level table. Its list empties in three-levels step 1.
5. **A5. Catalog facts** (row 14): `cx.note` and `cx.say` with a plain string instead of a catalog fact. Its list empties before P7a.

Order: A1 first (in progress), then A2 to A5. Size: small each.

### Phase B: prerequisites inside the UX steps

So that the UX work adds no new copies, each goes into the step named, as part of it or as a PR just before it.

1. **B1. The level table** (row 13), in [three-levels.md](three-levels.md) step 1: it carries every output mapping (VS Code, LSP, SARIF, GitHub and CodeMirror severity; ANSI; codicon; glyph; rank; palette variable; word; accessible name). The CLI emits the counts the Action needs, so action.yml stops grepping titles. Before chrome C2. Medium.
2. **B2. The Reading step model** (row 16), before P1 of [panel-redesign.md](panel-redesign.md): it moves from media/panel.js into a typed, pure module of src/ui. One `needsReading(state)` replaces the two decisions. The page's header mirror is driven by data, not by a MutationObserver. Medium.
3. **B3. Tokens and rows** (rows 6, 14, 15, 17), before P7a: `Token.role` and `Token.facts` (fact ids); no string notes (the `2>&1 >file` pitfall becomes a catalog fact, with its rewrite); one row record per token, read by all four renderers; the `ui` texts out of render.ts. Medium to large; P7b then has every warning typed.
4. **B4. The automatic shell** (row 10), before chrome C5: `detectShell` gives its source (a directive, the shebang, the file name, the default), and the wording "bash (auto)" comes from the same function (chrome-redesign.md, decision 12). Small.

### Phase C: the migrations (after 0.10.0, Deferred)

In the roadmap's "Deferred", to be judged again after 0.10.0. Each step lists its explanation changes (section 2) and takes the machinery of section 2.1 with it.

| Step | What | Rows | Size |
| --- | --- | --- | --- |
| C1 | Words: [word-source.md](word-source.md) steps 2–8; with M1's simpler hedge texts and M2's measurement | 1 | large |
| C2 | `commandRead(n)` on the model: the resolved name, the full spec, the parse with `argWordIn(model)`, `command` and `builtin` unwrapped; spec fields `closesInputEarly` and `neverFails` instead of the hand lists; idioms ask `resolveName`; the pipeline examples' stage facts (M6) | 2, 3, 4, 5 | large |
| C3 | A descriptor model in src/semantics (M3) | 6 | medium to large |
| C4 | The declaration builtins' outcomes from the walk (M4) | 7 | medium |
| C5 | `${…}` from the tree | 8 | medium |
| C6 | A shell-behaviour table and a three-valued `isBash` | 9 | medium |
| C7 | One shebang `Opening` | 10 | small to medium |
| C8 | One test evaluator (M5) | 11 | medium |
| C9 | Named bash-version differences | 12 | small to medium |
| C10 | One colour table per kind | 18 | small |
| C11 | The view switch's copies, if P1, P8 and chrome C7 leave any | 19 | small |

Order: C1 and C2 first (the others read words and commands), then C3, C4 and C8, then the rest in any order. C1's step 6 (fieldshape) before trust-fields step 3, as word-source.md says.

## 5. The rule from now on

- **A new fact gets a source and a guard in the same PR.** The PR adds its row to the table of section 3. A fact with a source but no guard is not done.
- **A copy found later goes into its guard's known list**, with the step that removes it, or is fixed in the same PR.
- **A design review checks the table**: for each fact the change touches, that it reads the source, and that the guard still passes without new known entries.
- **Design before wording** (section 2): a text that needs a special case of the model is changed instead.
