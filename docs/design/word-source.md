# One source for what bash makes of a word

Status: agreed by the maintainer on 2026-10-31 (section 7): step 1 (the guard) now, beside the UX work; steps 2 to 8 after 0.10.0, in the roadmap's "Deferred". This page is the detailed plan of the words row of [sources.md](sources.md) (row 1, steps SA1 and SC1).

What bash makes of a word is one set of facts: its fields and how many, which characters are quoted, whether it globs, its literal start and end, its tildes and braces. The model has a source for them: `wordMeaning`, `wordFields`, `braceWords` and `holedWords` in src/semantics/words.ts, with `ownChars`, `patternOfChars`, `ifsEscaped` and `globbedByBash` in src/semantics/chars.ts. test/word-probes.test.ts checks them against bash.

But many other places decide the same facts again, from node types and from the text. The refactoring plan ([refactor.md](refactor.md), "one source per fact") did not cover words. Nothing checks the rule, so each new feature added a decider, and each fix of the word model left the others behind. This page lists them (section 2), says what the one source must give (section 3), adds a test that stops new ones (section 4), and gives the steps (section 5) and their priority (section 6).

Line numbers are at 83436a9b. "V" marks a divergence that was run: bash 5.2 in a cgroup (`systemd-run --user --scope -p MemoryMax=3G …`, `FUNCNEST=50`), and `npx tsx test/dump.ts` for what we say. Other divergences are read from the code.

## 1. The rule

A word's run-time facts come from the word model. Code elsewhere may read a word's source text (to colour it, show it, rewrite it, or find a substitution to recurse into). It may not decide from node types, quotes, glob characters or IFS what bash does with the word.

Three things make a decider:

- It reads word-part node types (`word`, `number`, `string`, `raw_string`, `ansi_c_string`, `translated_string`, `concatenation`, `simple_expansion`, `expansion`, `command_substitution`, `arithmetic_expansion`, `process_substitution`, `brace_expression`), or tests glob, IFS, tilde or brace characters in the text.
- From that it concludes a run-time fact: a count of fields, quoting, globbing, a literal value or start, a tilde, braces.
- That fact changes what we say or decide.

## 2. Inventory

### 2.1 How it was searched

- Comparisons of `.type` with the node types above, and sets or regexes of them, over all of src/: 376 lines in 61 files, outside words.ts, chars.ts, the syntax adapter and jq's parser.
- Calls of the text helpers that act as deciders: `staticWordValue`, `literalContent`, `unquoteWord`, `isPlainWord`, `isGlob`, `hasGlob`, `tildeSpots`, `countOf`, `splitsIn`.
- Regexes on glob characters (`[*?[`) and IFS.

Each place was classified by function, then the rows were merged by fact.

### 2.2 The deciders

**Literal value.** Words.ts has `WordMeaning.value` and `wordIn(…, 'value')`.

| # | Where | What it decides | Callers | Divergence |
| --- | --- | --- | --- | --- |
| W-L1 | src/staticword.ts `staticWordValue`, `literalValue`, `globbed` | The text after quote removal, when nothing expands. It takes the node and the shell, never the model, so it knows nothing of `set -f`, `set +B`, the context or IFS. It reads `$(:)` as empty. | 151 uses in 37 files, words.ts too (lines 371 and 607) | V: `:() { printf x; }; $(:)echo hi` is said to run the builtin `echo`; bash runs `xecho` (command not found). It gives no value where bash has one: `set -f; ./x*`, a here-string, `[[ ]]` operands. |
| W-L2 | src/staticword.ts `literalContent` | The text a command gets. It returns a plain `word` as written, `~`, `*` and `{,}` included. The model corrects the glob case afterwards; it does not correct braces or tildes. | about 30 calls in 12 files; explain/examples.ts `inputSource`, `stdinOf` | Mostly guarded. `sort a{1,2}.txt` is right ("the files `a{1,2}.txt` names"), `cat <<< ~/x` shows no example. |
| W-L3 | src/staticword.ts `unquoteWord`, `messageText` | Quote removal of an operand's text: no tilde, no `&` of `patsub_replacement`. | pitfalls.ts `rootTarget`, expansion.ts, expansion-tokens.ts:251, dict/syntax.ts `rep`, `pat` | V (bash only): `x=abc; echo ${x/a/&&}` prints `aabc`. `rep` likely shows the replacement as `&&`. |
| W-L4 | semantics: written.ts `writtenValue`, state.ts:344, walk/walker.ts:254 and :966 (`for` list), walk/builtins.ts:94–427, redirects.ts, env.ts:640, posixexits.ts, trust.ts (about 20 sites), names.ts `resolveRun`, effects.ts `commandName`, `wordName` | Names and operands as text, through W-L1, inside the walk, where `wordIn` has the state | the trust scan, the walk, names, status | The `$(:)` hole of W-L1. Otherwise they err on the safe side. |

**Plain or quoted.** Words.ts has `WordMeaning.steps` (only quote removal applies), `partMeaning(…).quoted`, `ownChars` and `patternOfChars`.

| # | Where | What it decides | Callers | Divergence |
| --- | --- | --- | --- | --- |
| W-P1 | src/staticword.ts `isPlainWord` (`type` is `word` or `number`) | It takes "plain text" to mean no expansion, glob or tilde. A `word` can still hold `*`, `~`, `\`. | about 20 sites: explain/{commands, redirections, scripts, argv, tests, operand-texts, words}.ts, expansion-tokens.ts:380 | V (dump): in `sudo -u u* ls`, `ls` is said to be the "argument of `u*`" (operand-texts.ts:75). In `command ~/bin/x -v`, it "runs `~/bin/x`", then `-v` "depends on what the expansion gives" (argv.ts:800). `[ -f ~/.bashrc ]` gets no tilde token, while `. ~/.bashrc` on the same line does (tests.ts:295). Redirections take two paths (redirections.ts:123 and :399). |
| W-P2 | explain/reads.ts `unquotedWord` | "Unquoted": every part is `word`, `number` or `brace_expression` | examples.ts, redirections.ts, commands.ts, words.ts, assignments.ts | Safe today; a second copy of W-P1. |
| W-P3 | explain/words.ts `casePattern`; explain/tests.ts `quotedPatternNote`, `wholeRegex`, `binary` (317) | Which parts of a pattern are quoted. The two use different rules: only `casePattern` sees the quoted default of `${q:-"*"}`. | the pattern notes of `case` and `[[ ]]` | `[[ $x == ${q:-"*"} ]]` is read otherwise than `case $x in ${q:-"*"})`. The panel redesign already plans to decide this from the word model ([panel-redesign.md](panel-redesign.md), P2). |
| W-P4 | explain/scripts.ts `trapNote`, analyzer.ts:101, walk/walker.ts:1172, deferred.ts `quotedIn`, shvalues.ts:36–97, effects.ts `quotedName`, staticword.ts `surelyHasSlash` | Small quoting tests on node types | the trap note, alias lookup, empty command names, dash's declarations | `trap 'a'"$x" EXIT` gets no note. `x=1 $""` misses `$""` (walker.ts). dash's `local "-r" x` is likely misread. All rare. |

**Globbing.** Words.ts has the `glob` step (with `why`), `GlobState` and `globbedByBash(pattern, extglob)`.

| # | Where | What it decides | Callers | Divergence |
| --- | --- | --- | --- | --- |
| W-G1 | examples/shellwords.ts `isGlob`; embedded/glob.ts `hasGlob` | Whether the text has unquoted glob characters. Neither reads the extglob state, and both take the quotes from the caller's text. `hasGlob` misses `\\*`. | `isGlob`: fieldshape.ts, explain/examples.ts:748, :826, explain/words.ts:351. `hasGlob`: about 25 callers in explain/, idioms.ts, expansion-tokens.ts | `echo '*'{a,b} z` gets no example; the cause is not isolated. |
| W-G2 | idioms.ts `globGuard` (316) | That the `for` word globs. It checks nullglob and failglob, never noglob. | the idiom "unmatched glob in for" | V: after `set -f`, `for f in a:b *.txt; do [ -e "$f" ] \|\| continue; …` gets "when `*.txt` matches nothing, bash keeps it". The `*.txt` token on the same line says `set -f` turned globbing off. |
| W-G3 | examples/runtime.ts `knownTruth` (164), examples/patterns.ts `operand` | Whether the right side of `[[ == ]]` is a pattern: `/[*?[]/` on the text, with no extglob operators | the examples of `[[ ]]` | V: `x='@(abc\|d)'; [[ abc == $x ]] && echo yes` prints `yes`. Our example says "False when x=…". `[[ ]]` matches as if extglob were on. |
| W-G4 | explain/words.ts `word`, `notGlobbedHere`; explain/argv.ts `positional` (865); explain/redirections.ts `openedPath`, `redirectTargetNote` | Start from `hasGlob(text)`. They ask the model only about noglob, IFS and assignment values. | pattern tokens, glob notes, "ambiguous redirect" | `IFS='*'; : > a*` is likely called an ambiguous glob, but bash opens `a*`. Contexts that never glob are covered only where the code lists them. |
| W-G5 | semantics/trust.ts:561–576 (declaration operands) | Takes an unquoted word that looks like a glob (`a[1]`) to match no file | `declare`, `local`, `export`, `readonly` | V (bash): `touch a1; declare a[1]` declares `a1`. Rare. |
| W-G6 | testexpr.ts `fieldText`, `wordText`; fixes.ts `single`; pitfalls.ts `hasStaticText` | Text tests: does `test` get one field, is a pattern a pattern, does the text stay | `test`'s malformed check, the `[[`→`[` fix, `[ -f "$x"]` | They err on the safe side (refuse or say not sure); no wrong case found. |

**Counts and splitting.** Words.ts has `wordFields`, the `split` step, `splitOn`, `holedWords`, and fieldshape's `mayGiveNone`.

| # | Where | What it decides | Callers | Divergence |
| --- | --- | --- | --- | --- |
| W-C1 | src/argv/words.ts `argWordFor`, `countOf`, `partsOf`, `wordCount`, `prefixOf`, `startParts`, `splitsIn`, `mayGiveDashes` | Each word's value, known start, count and parts, from node types. Any unquoted expansion splits; a `GLOB` regex finds globs; IFS, noglob and extglob are never read. | the interpreter for every spec; semantics/{effects, env, nested, deferred}.ts, idioms.ts, dialect.ts, semanticFacts.ts and explain/examples.ts:394 use it without the model | `gcc -o b*/$n a.c` loses a clause (maintainer). Likely: `IFS='*'; ls a*`, and `set -f`, in the model's own readers. Braces are counted whatever `set +B` says (left from #481). |
| W-C2 | semantics/argwords.ts `countIn` | Uses W-C1's count unless the model knows the fields; then it uses those | explain/argv.ts, pitfalls.ts, the walk | A patch over W-C1, not a source. |
| W-C3 | semantics/testwords.ts `testWordShape`; trust.ts:424–444 `lead` | The word count of a `test` word, from a regex on the text | trust.ts:431 | Errs on the safe side: it ignores `set -f` and nullglob, and reads the start from the source. |
| W-C4 | semantics/nofield.ts `mayGiveNoField`, `givesOneNumber`, `neverEmpty`, `integerDefault`; words.ts `integerParameter`; fieldshape.ts `kindOf` | "Never empty" and "may give none": three definitions | argwords.ts, explain/words.ts:185, :227 | Kept in step by hand. fieldshape's `mayGiveNone` is a fourth. |
| W-C5 | semantics/elements.ts `givesElements`; globwords.ts `severalFields` | One field per element (`"$@"`). The two disagree on namerefs and `${!x}`. | explain/argv.ts, explain/words.ts, argv/words.ts, nofield.ts, fieldshape.ts | Likely: `declare -n r='a[@]'; "$r"`. |
| W-C6 | semantics/walk/arith.ts `letText` (287) | Guesses that `let`'s word splits from `/[\s*?[]/` | arithmetic in the walk | V (bash): `IFS=:; z='1:2'; let $z` is `let 1 2` (status 0). Rare. |
| W-C7 | wordfacts.ts `alwaysNumber` | `$#` and `$?` never split | `unquoted-variable-in-test` | `IFS=1` splits them. Rare. |
| W-C8 | explain/operand-texts.ts `eachText` (W-C1's `splitsIn`); explain/examples.ts `exampleWords`, `wordExample` | Read W-C1's guesses | role texts of brace words; echo/printf outputs | Follows W-C1. |

**Tildes, braces, and the second model.**

| # | Where | What it decides | Callers | Divergence |
| --- | --- | --- | --- | --- |
| W-T1 | `tildeSpots` / `tildeParts` called by written.ts:42, deferred.ts:161 `expands`, walk/builtins.ts:589 `readsUnwritten` | Where a tilde expands. Each caller picks its own mode instead of the context table (`WordMeaning.tildes`). | values written, deferred words, the walk's reads | The modes can disagree with the model in POSIX mode and in declaration contexts. None was run. |
| W-B1 | explain/words.ts `bracesHere`, `braceWithExpansion` (text scan); trust.ts:569 (`braceValues` directly); W-C1's default `bracesWork` | Whether braces expand, and into what | brace tokens, the trust scan, the model's readers | `{1..$n}` is handled by hand. The model's readers ignore `set +B` (W-C1). |
| W-F1 | src/semantics/fieldshape.ts `wordShapes` | A second model of fields: shapes with starts, ends, holes and counts ([trust-fields.md](trust-fields.md), step 1). It takes its pieces from `holedWords`, so words.ts decides the quoting of the source, the braces, the tildes and the values. Then it builds its own characters (`atomsOf`): its own split flag, a hard-coded `WHITE = ' \t\n'`, `isGlob` in place of `globbedByBash`, a second `TRANSFORMS`, and its own hole kinds. It never calls `ownChars`. Where `ownChars` applies bash's IFS quoting rule, `wordShapes` gives up (lines 356–383, F81, F83, F95, F96). `misread` lists the words that words.ts reads otherwise than bash (F90–F100). | only test/fieldshape.test.ts, so far | It is wrong nowhere known: it gives up instead. But each fix of the word model must also be made here, and `wordFields` and `wordShapes` can drift apart. |

Not words, and left out: the body of a here-document (`stdinOf` in src/examples/source.ts). Nothing in the model reads it, and it errs on the safe side.

### 2.3 Legitimate uses

These read node types or text, but only to work on the syntax:

- **Parsing and colouring.** src/syntax/** (the adapter, the tree), src/highlight.ts, src/semanticTokens.ts.
- **Dispatch.** src/explain/dispatch.ts sends each node type to its module.
- **Walking.** The walk recurses into substitutions and arithmetic: state.ts:652, walk/expansions.ts, walk/shared.ts, pipeline.ts, env.ts:108, stops.ts, status.ts, unbound.ts, nested.ts. trust.ts and allow.ts look nodes up in their allow-list tables.
- **Expansion operators and source spans.** expansion-tokens.ts (operators through `parseExpansion`), substitution-tokens.ts, refs.ts (sections for a node).
- **Other languages.** src/embedded/** and src/examples/{jq, awk, sed, perlrun, yaml, regex}.ts read their own ASTs. src/arith.ts parses arithmetic.
- **Source rewrites and shape tests.** dialect.ts finds syntax a shell lacks. fixes.ts rewrites source (`quoteExpansions`). idioms.ts and pitfalls.ts check source shapes ("the word is one `$x`").
- **Commands that split their own input.** `read` does its own splitting in examples/commands.ts and runtime.ts, with `IFS_WHITESPACE` from chars.ts.
- **Already reads the model.** values.ts, walk/conditions.ts `fieldsOf`, `staticText` (it checks `builtinRuns`), deferred.ts `literalStart`, globwords.ts `wordPatterns`, wordfacts.ts `bare`, explain/reads.ts `ifsAt`, `globState`.
- **Part of the word layer.** brace.ts, wordcontexts.ts, wordsites.ts and operands.ts. Also the text helpers that words.ts itself calls: `ansiCValue`, `decodedText`, `bracketSpans`, `elementClose`, `braceSequence`, `globToRegex`.

### 2.4 Counts

There are 25 decider rows, covering about 45 functions in 35 files:

| Kind | Rows |
| --- | --- |
| Literal value | 4 |
| Plain or quoted | 4 |
| Globbing | 6 |
| Counts and splitting | 8 |
| Tildes | 1 |
| Braces | 1 |
| Second model | 1 |

Run against bash:

- Five rows are wrong where both bash and our output were run: W-L1 (`$(:)`), W-P1 (`sudo -u u*`, `command ~/bin/x`), W-G2 (`set -f`), W-G3 (extglob in `[[ ]]`), and W-C1 (the maintainer's `gcc -o b*/$n`).
- Three rows have the bash side run, and our side read from the code: W-L3 (`&`), W-G5 (`declare a[1]`), W-C6 (`let`).
- The other rows are likely divergences, rows that err on the safe side, or duplicates that agree today.

## 3. The one API

### 3.1 What a consumer needs

Every decider above asks one of these questions about a word in its context:

- Its one value, if nothing expands. W-P1 really asks whether the word is plain: its value is known and only quote removal applies.
- Its fields, or for each word of its brace expansion, its characters, each one quoted or not, splitting or not, a pattern or not, known or a hole.
- How many fields: an exact number, or a range.
- The literal start of its first field and the literal end of its last.
- Whether it globs: some field is a pattern, given the glob options in effect.
- Its tildes and its braces.
- What is not known, and why: a value, the IFS, an option, a word the model misreads, too many words.

Words.ts already answers most of these, but in four forms: `WordMeaning`, `wordFields`, `braceWords` and `holedWords`. Fieldshape answers the rest a fifth way. Callers pick one, or give up and read the tree.

### 3.2 `WordView`

Add one view next to words.ts, src/semantics/wordview.ts, so that words.ts stays the evaluator:

```ts
interface WordView {
  meaning: WordMeaning;            // context, steps, tildes, ifs, glob options, failure: as today
  value?: string;                  // the one field when nothing expands (WordMeaning.value)
  plain: boolean;                  // value known, and no step but quote removal changes the text
  words: ViewWord[];               // one per word of its brace expansion (one where braces do not apply)
  count: { min: number; max?: number }; // fields of the whole word after every step
  start?: string; end?: string;    // literal start of its first field, literal end of its last
  globs: Applies;                  // some field is a pattern bash expands here
  shapes?: WordShapes;             // per field (fieldshape's domain), where the model can say
  unknown: readonly ('value' | 'ifs' | 'option' | 'misread' | 'too-many')[];
}
interface ViewWord { written: string; chars: Char[]; fields?: string[] }
// chars.ts: Char gains `pattern` (an unquoted glob character where the glob step applies, with the extglob state)
// and `hole?: Hole` (a part whose value is not known); ownChars is its only producer.
```

It has three entry points:

- `wordView(n, model)` for code that has the finished model: explain/, argv, pitfalls, idioms.
- `wordViewIn(n, st, source)` for the walk, which has a state and a `WalkSource`. It is today's `wordIn`, with the view's shape.
- `wordViewAsWritten(n, shell)` for code that runs before or without a model: the parse stage, aliases, dialect. It is the view in the state of a script that sets nothing: the default IFS, options as the shell starts, braces as the shell has them. A command substitution there is not known. It is never read as empty. This replaces `staticWordValue` in those callers and closes the `$(:)` hole (W-L1).

### 3.3 Fieldshape folds in

Fieldshape stops being a second model. Words.ts makes the characters, and fieldshape keeps only the abstract domain:

1. `Char` carries a hole. `ownChars` makes the characters for both exact words and holed words, so `atomsOf`, `WHITE` and the bail-outs at lines 356–383 go. Where `ownChars` knows bash's IFS quoting rule, `wordShapes` answers instead of giving up.
2. The hole kinds become one function in words.ts, `partKind(part, quoted)`. It replaces `holeOf` and `kindOf`, `severalFields`, `integerParameter`, nofield's `neverEmpty`, `isNumber` and `integerDefault`, and `givesElements` (W-C4, W-C5). `Hole` moves to words.ts, which ends the type-only cycle.
3. `misread` shrinks as words.ts is fixed for each item. Until then, the view reports those words as `unknown: 'misread'`, for every caller and not only fieldshape.
4. `risky` joins `WordMeaning.failure`, and `isGlob` gives way to `globbedByBash`.
5. What stays in fieldshape.ts: the `Field` and `Shape` types, `join`, `matched`, `fieldHolds` and its questions, `shapesHold` and `mayGiveNone`. `mayGiveNone` replaces `mayGiveNoField`. `wordFields` becomes the case of `wordShapes` with no holes.

This is the plan trust-fields step 3 already asks for ("`mayGiveNoField` and `wordPatterns` become views of fieldshape.ts"), so do it before that step.

### 3.4 `countOf` and the argument interpreter

`argWordFor` takes a view function instead of `shell` and `braces`:

- `value` is `view.value`, `prefix` is `view.start`, and `count` is `view.count` (none when it is exactly one).
- `parts` and `prefixEach` come from `view.words`. In each brace word, the characters before the first split character keep the start, and a head that globs gives `prefixEach`.
- `dashes` comes from a pattern char after a start of `-` or `--`.
- `fields` is `view.words[…].fields`.

`ArgWord` does not change, so src/argv/readings.ts and the count-hedges table read the same data as today, now from one source. `countIn` (argwords.ts) goes. `countOf`, `partsOf`, `startParts`, `splitsIn` and `prefixOf` go once their last callers move.

The model's own readers (effects.ts, env.ts, nested.ts, deferred.ts) pass `wordViewIn` from the walk. idioms.ts and dialect.ts pass `wordView`. So `set +B`, `set -f` and IFS count everywhere.

## 4. The guard

### 4.1 The test

Add test/word-source.test.ts, modelled on test/explain-imports.test.ts. It reads every `src/**/*.ts` with the TypeScript compiler API and reports each match below. It gives the nearest named function, method or `const` around the match, so that moving lines does not break it. It matches:

1. **Node types.** One of these string literals: `word`, `number`, `string`, `string_content`, `raw_string`, `ansi_c_string`, `translated_string`, `concatenation`, `simple_expansion`, `expansion`, `command_substitution`, `arithmetic_expansion`, `process_substitution`, `brace_expression`. It counts where the literal is:
   - a side of `===` or `!==` whose other side ends in `.type`;
   - a `case` of a `switch` on something `.type`;
   - an element of an array literal or a `new Set([…])` that the same file tests with `.type` (`.has(x.type)`, `.includes(x.type)`);
   - inside a regex literal tested on something `.type` (`/^(word|number)$/.test(n.type)`).
2. **Decider helpers.** A call of `staticWordValue`, `literalContent`, `unquoteWord`, `isPlainWord`, `isGlob`, `hasGlob`, `tildeSpots`, `tildeParts`, `countOf`, `splitsIn` or `plainWords`. The list shrinks as each helper goes.
3. **Glob character classes.** A regex literal with a character class that holds `*` and `?` (`/[*?[]/`, `/[\s*?[]/`).
4. **IFS whitespace.** The identifiers `IFS_WHITESPACE` and `IFS_ERRATIC`, and the string literal `' \t\n'`.

### 4.2 The allow-list (whole files)

- **The word layer.** src/semantics/{words, chars, wordview, brace, wordcontexts, wordsites, operands, fieldshape}.ts.
- **Where the helpers are defined.** src/staticword.ts and src/examples/shellwords.ts. Each helper leaves the list when it is removed.
- **Syntax.** src/syntax/**, src/highlight.ts, src/semanticTokens.ts.
- **Other languages.** src/embedded/**, src/examples/{jq, awk, sed, perlrun, yaml, regex}.ts, src/arith.ts.

Everything else is matched.

### 4.3 The known list

test/fixtures/word-source-known.json holds the matches that are allowed today. Each entry is a file, a function, the kind of match and the count:

- `deciders`: each entry names its row in section 2.2 (`"row": "W-P1"`). This list only shrinks; each step of section 5 removes its entries.
- `syntax`: legitimate uses (section 2.3), with a reason given once per file and kept with the entry: "dispatch by node type", "recursion into substitutions", "source span", "source rewrite", "read's own splitting".

The test fails:

- on a match not in either list;
- on an entry that matches less than its count (it is stale: lower it or remove it);
- on a `syntax` entry with no reason.

A new feature that reads node types must therefore either read the view, or add a `syntax` entry with a reason. The reviewer sees the reason in the diff.

The first version lists about 150 functions: about 45 deciders and the rest syntax. A script prints the list from the matches, and the reasons are written by hand from section 2. What this costs is the review of that first list, not code.

The test is static. It cannot see a decider that works through new helper names. Section 2.2 is the list to keep, and the renderings oracle (test/support/renderings.ts: the counts we state, against bash's argv) stays the check on behaviour.

### 4.4 The line for CLAUDE.md

Under "Design", next to the semantic model:

> - What bash makes of a word (its fields and their count, which characters are quoted, whether it globs, its literal start and end, tildes, braces) comes from the word model: `wordView` (src/semantics/wordview.ts) over `wordMeaning` and `wordFields` (src/semantics/words.ts) and `ownChars` (chars.ts). Code elsewhere does not decide it from word-part node types, quotes, glob characters or IFS. test/word-source.test.ts fails on a new such reading outside its allow-list; a use that is only syntax needs a reason in test/fixtures/word-source-known.json (docs/design/word-source.md).

Until the view exists (step 2), the line names `wordMeaning` and `wordFields` only.

## 5. Steps

Each step is one PR (or a few, where it says so). Every test keeps passing. The explanations need not stay byte-identical ([sources.md](sources.md), section 2, decided 2026-10-31): each PR lists the changes it makes to the snapshot (test/snapshot.ts) and the dumps of sample.sh and the fixtures, and none may contradict bash. Each fix gets a test against bash and a CHANGELOG line.

| Step | What | Files | Size | Fixes |
| --- | --- | --- | --- | --- |
| 1 | **The guard.** test/word-source.test.ts and the known list as it stands; the CLAUDE.md line (in the same PR, or the next, as the maintainer prefers). | test/, test/fixtures/, CLAUDE.md | small | none; it stops new deciders |
| 2 | **The view.** `WordView`, the three entry points, and `Char.pattern` and `Char.hole` (chars.ts). Nothing reads it yet. test/word-probes.test.ts also compares `count`, `start`, `end`, `plain` and `globs` with bash on words.json, with new rows for `set -f`, extglob, a custom IFS and `set +B`. | src/semantics/wordview.ts, chars.ts, test/word-probes.test.ts, test/fixtures/probes/words.json | medium | none |
| 3a | **Literal values in the model.** W-L4 and W-T1 read `wordViewIn` and `WordMeaning.tildes`. The remaining callers of `staticWordValue` in semantics/ read the view. | src/semantics/** | medium | W-L1's `$(:)` in names and trust; W-T1; W-G5 (`declare a[1]`) |
| 3b | **Literal values in the explanation.** `valueNote`, command heads, redirections, `declare` and `unset` names, and example inputs (W-L2) read `view.value`. | src/explain/{words, commands, redirections, argv, assignments, scripts, examples}.ts, src/reading.ts | medium | values under `set -f` and in here-strings (listed in the PR) |
| 4 | **Plain words and globs in the explanation.** `isPlainWord`, `hasGlob`, `isGlob`, `unquotedWord`, `casePattern` and `quotedPatternNote` read `plain`, `globs` and `chars`. | src/explain/{words, tests, argv, redirections, commands, scripts, operand-texts, examples}.ts, expansion-tokens.ts, examples/{runtime, patterns}.ts, idioms.ts | medium–large (two PRs: explain/, then examples/ and idioms) | W-P1 (`sudo -u u*`, `command ~/bin/x`, the tilde token of `[ -f ~/x ]`), W-P2, W-P3, W-G1, W-G2, W-G3, W-G4 |
| 5 | **Counts in the interpreter.** `argWordFor` reads the view (3.4). `countIn`, `testWordShape`, `letText`, `alwaysNumber` and `givesElements` become reads of it. | src/argv/words.ts, src/semantics/{argwords, testwords, nofield, elements, effects, env, nested, deferred, walk/arith}.ts, dialect.ts, semanticFacts.ts | medium–large | W-C1 (`gcc -o b*/$n a.c`, `set +B` in the model's readers), W-C3, W-C5, W-C6, W-C7 |
| 6 | **Fieldshape folds in** (3.3). Before trust-fields step 3. test/fieldshape.test.ts gates it: its generated cases against bash, and the share of refused words, which should fall. | src/semantics/{fieldshape, words, chars, globwords, nofield, elements}.ts | large | W-F1, W-C4 |
| 7 | **Small leftovers.** W-P4 (`trap 'a'"$x"`, `$""`, dash's `local "-r"`), W-L3 (`unquoteWord` in operands: `~` and `&` from `operandReplacement`), W-G6. | scripts.ts, analyzer.ts, walk/walker.ts, shvalues.ts, pitfalls.ts, dict/syntax.ts, expansion.ts, testexpr.ts, fixes.ts | small each | W-P4, W-L3, W-G6 |
| 8 | **Remove the helpers.** `staticWordValue` (left as the body of `wordViewAsWritten`), `isPlainWord`, `literalContent`, `isGlob`, `hasGlob`, `countOf` and the others leave their modules. The `deciders` list is empty. | src/staticword.ts, examples/shellwords.ts, embedded/glob.ts, argv/words.ts | small | none |

Order: 1, then 2, then 3a, 5 and 6, which work on semantics and argv and can overlap. Steps 3b, 4 and 7 touch src/explain/. Step 8 comes last. Fix W-G2 alone at any time if wanted: it is one condition in idioms.ts (read the glob step's `applies`, as explain/argv.ts:691 does).

## 6. Priority

### 6.1 Common usage, or rare corners?

No verified divergence is common in tutorial or LPIC-level scripts. Each needs something a beginner rarely writes:

- `set -f` before a glob (W-G2);
- an extglob pattern in a variable (W-G3);
- a redefined `:` (W-L1);
- a custom IFS with `let` or a glob character (W-C6, W-G4);
- a glob as an option's value or a wrapped command (W-P1, W-C1);
- `declare a[1]` next to a file `a1` (W-G5);
- `&` in a replacement (W-L3).

The common forms come out right today: `*.txt`, `"$x"`, `$x`, `~/x` in an argument, `{a,b}`, `cp *.txt ~/backup/`. They are right because the model answers them where it matters, and the parallel deciders agree with it there.

One common line loses an explanation without being wrong. In `[ -f ~/.bashrc ] && . ~/.bashrc`, the test operand gets no tilde token (W-P1, tests.ts:295). Step 4 fixes it.

The real cost is ahead, not behind. Each bash fix in words.ts (#521 and #522 this week) leaves these deciders behind, and each new feature adds one. The guard stops that.

### 6.2 What can run beside the UX work

*Superseded on 2026-10-31: steps 2 to 8 come after 0.10.0 ([sources.md](sources.md), SC1); only step 1 runs beside the UX work. Sections 6.2 and 6.3 are kept as the record of the proposal.*

The panel redesign and the web page's chrome touch:

- src/ui/**, src/settings.ts, src/analyzer.ts, src/linesummary.ts and src/argvline.ts;
- in src/explain/: words.ts, tests.ts, examples.ts and scripts.ts;
- src/reading.ts, src/idioms.ts, src/pitfalls.ts, src/dict/syntax.ts, src/messages.ts and src/fixes.ts.

panel-redesign.md P2 already plans to decide "pattern or plain in `[[ ]]`" from the word model.

| Can run beside the UX work | Collides with it |
| --- | --- |
| 1 (tests only); 2 (a new module, chars.ts, probes); 3a, 5 and 6 (src/semantics/**, src/argv/**, dialect.ts, semanticFacts.ts) | 3b, 4 and 7 (src/explain/, idioms.ts, pitfalls.ts, dict/syntax.ts, reading.ts). Do them after panel P2, or as part of panel P2 where it rewrites the same function (W-P3 of section 2.2). |

### 6.3 Recommendation

*Superseded on 2026-10-31 for steps 2 to 8 (after 0.10.0, [sources.md](sources.md), SC1). Step 1 stands as recommended.*

**Before the UX work: step 1 only.** It is small and touches no src/ file. It stops new deciders from the start of the UX work, which will add explanations in src/explain/.

After it:

- Steps 2, 3a, 5 and 6 may go on in parallel with the panel redesign, the web page's chrome and the usability test. They are not needed for the release, and none of them fixes a common case.
- Step 6 must land before trust-fields step 3.
- Steps 3b, 4 and 7 wait until the panel steps that touch src/explain/ have landed. Or panel P2 takes the view for its own rewrite of the `[[ ]]` patterns.

## 7. For the maintainer

1. **The rule.** Agree that a word's run-time facts come only from the word model, checked by the guard, with legitimate uses listed with a reason.
2. **The minimum.** Agree to step 1 alone before the UX work. Or add W-G2, which is one line.
3. **Where the view lives.** The view as a module next to words.ts (src/semantics/wordview.ts). Or fold it into words.ts, which is already 1,100 lines.
4. **The roadmap.** A roadmap item for steps 2 to 8, placed after the panel redesign, the web page's chrome and the usability test, with step 6 before step 3 of "Trust of a builtin's words from what their fields may be".

Decided 2026-10-31: 1 and 2 as proposed (step 1 alone before the UX work); 3 is left to step 2; 4: steps 2 to 8 are in the roadmap's "Deferred", as step SC1 of [sources.md](sources.md). A step may change the explanations where a clean model gives a simpler text ([sources.md](sources.md), section 2); the hedge texts of [count-hedges.md](count-hedges.md) are such a case (sources.md, M1, part of SC1).
