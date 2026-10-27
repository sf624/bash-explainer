# Spec and convention, as data

Status: proposed (2026-10-28). The design of step 5 of [basis.md](basis.md): the two kinds of basis that steps 1 to 4 left in the type only. Data only: no view shows them (basis.md, section 6). Its questions are in section 5.

Steps 1 to 4 gave a basis to what bash does: the manual's sections, or a probe row (`checked`, `differs`). Two kinds are still empty:

- `spec`: what another program does (an option of `grep`), from its command spec in src/dict/.
- `convention`: a habit of shell scripts, not a rule of bash.

The last step found that both are larger than they look. `spec` would add a field to every token a command reads, and the name of the command must reach the place where the field is set. `convention` needs an audit: which pitfalls are conventions, and which are facts of bash. This document answers both, with the audit done (section 2.3).

## 1. Spec

### 1.1 What it means

A `spec` basis says: this text is what the program does, as its spec in src/dict/ describes it. It is not the Bash manual's, and no probe checks it.

Which program's spec: the one the dictionary describes. That is the program as a GNU/Linux system has it, by default: GNU getopt_long parsing (`parser` `gnu`, 546 of 686 programs; `getopt_long` for 102 more), GNU coreutils, util-linux, procps. Where BSD or macOS differ, the text says so (`cal -m`); a few programs exist only on macOS (src/dict/macos.ts). POSIX is not the reference: a spec describes the program a reader runs, not the standard.

It is never the basis of:

- a builtin's options and operands (65 builtins in src/dict/builtins.ts): they are the manual's. The builtin's token cites its section (`read`: 4.2), and the tokens under it have no `refs` of their own: the rule of section 1.4, already;
- bash's own options (`bash -c`, `bash --posix`): the manual's 6.1;
- a function, an alias, or a command the dictionary does not know: no spec, so no basis;
- a command of `bashExplainer.customCommands`: the reader wrote its text. bats' host commands (`run`, `load`, src/dict/bats.ts) are bats-core's spec, and get it.

### 1.2 Where it comes from

One source: the command spec, by the dictionary's name for it (`lookupCommand`; `/bin/rm` is `rm`, as `pathCommand` reads it). The specs do not cite their sources today: `CommandSpec` has no field for a man page, a `--help` text or a version. The tests that compare a spec with the real tool are the check (test/parsers-real.test.ts, test/subcommands-real.test.ts, test/wrappers-real.test.ts, test/examples-*.test.ts with GNU sed, gawk, perl, jq and coreutils). They check many specs, not all, and per table, not per text. So the basis names the command only: `{ kind: 'spec', command: 'grep' }`, as the type has it. Naming the implementation or the tests is left (section 5, question 4).

### 1.3 What carries it

A token whose text comes from a spec:

- the tokens of origin `argv` that a program's spec reads: its options, their values, its operands, its subcommands, the command it runs (`sudo rm`: the word `rm` is a role of sudo's spec);
- the tokens of origin `embedded` in a word that program reads: the regex of `grep -E`, the script of `sed`, the filter of `jq`. Their `language` already names the language; the spec is the program that reads it. An embedded language that bash reads (the regex of `=~`, the format of the `printf` builtin) is the manual's (3.2.5.2, 4.2).

The text of a token the command reads may still state bash's behaviour: how the word expands (`expands`), an option bash refuses (`based` texts of step 4). A text with its own basis keeps it: the token's own basis comes first.

The command's own token (`grep`, its summary) comes from the spec too.

### 1.4 What the JSON shows: the size

Measured on `test/fixtures/sample.sh` (`npx tsx cli/main.ts --format json`, 123 lines, 875,614 bytes): 118 command tokens, 70 of them programs with a spec; 281 tokens of origin `argv` (197 read by a program's spec, 84 by a builtin's); 179 tokens of origin `embedded` (105 outermost).

| Where `basis: { kind: 'spec', … }` goes | Added | Growth |
| --- | --- | --- |
| On every `argv` token of a program, and every `embedded` token | 51,297 bytes | +5.9% |
| On the outermost `argv` and `embedded` tokens only | 32,282 bytes | +3.7% |
| On a program's command token, and the outermost `embedded` tokens | 22,773 bytes | +2.6% |
| **On a program's command token only** | **7,269 bytes** | **+0.8%** |
| One list per line (`specs: [{ command: 'grep' }]`), a new field | 6,069 bytes | +0.7% |

Per token, the same value repeats up to five times under one command (`grep -rn`: `-rn`, `-r`, `-n`, the pattern, the path), and says nothing a reader cannot derive.

**Proposal: the command token only.** A program's command token gets `basis: { kind: 'spec', command }`. A token of origin `argv` or `embedded` with no basis of its own rests on the basis of the nearest command token above it: a rule, as the manual's basis is the default from `refs` and nothing is stored (src/basis.ts, `basisFor`). One helper gives it (`tokenBasisFor(token, above)`), so that the row model of the panel redesign (P7a) and a reader of the JSON apply the same rule. The cost is 0.8%, and the field already exists (`Token.basis`, step 4).

Where it is set: where the command token is made (src/explain/commands.ts), which has the spec it read the words with. The name does not travel down to each token: that was the cost the last step found. As in step 4, the analyzer gives it after the line is explained, and only with `notes.basis` on (one gate for every kind).

## 2. Convention

### 2.1 What it means

A convention is advice that rests on common practice, not on what bash does: quote every expansion, always write `read -r`, prefer `$(…)` to backquotes, capitals for the environment's variables. A reader cannot check it against the manual or by running bash; at most, a style guide or a linter states it.

### 2.2 How a note is sorted

A pitfall says what goes wrong and how to write it instead. Each one is sorted by what its claims rest on, as decision 5 (basis.md, section 8) sorts the facts:

- **fact**: what goes wrong follows from bash, or from the program the note names, on the line as written, in the case the note names; its advice is how to write what was meant. A reader can check each claim.
- **convention**: the point is a habit. Bash runs the line as meant; no claim about bash would fail a check.
- **both**: the note states a fact, but the fact bites only with input, values or a setup the line does not control (a value with a space, a backslash in the input, a cut download, an earlier stage that fails), and the advice is a common habit that rules them out beyond this line. A convention that prevents a fact of bash.

### 2.3 The audit

Every style check of src/pitfalls.ts (13 codes) and every pitfall of the catalog, warnings and caveats (63 entries of kind `pitfall` in src/messages.ts), on main at 2fefb18b. "Also rests on" names the program, other than bash, that a claim is about. "Habit" is the convention of a note sorted *both*, with who states it where it is known (the ShellCheck and Hadolint codes are to be checked in step 5b).

**Result: 60 fact, 0 convention, 16 both.** No note rests on a convention alone. 32 notes also rest on another program.

Style checks (src/pitfalls.ts, no catalog entry, no sections today; the sections are proposed for step 5b):

| Code | Level | Kind | Sections | Also rests on | Why / habit |
| --- | --- | --- | --- | --- | --- |
| `bracket-no-space` | warning | fact | 4.1, 3.7.2 | | `[-f` is one word, a command name bash looks for and does not find |
| `assignment-with-spaces` | warning | fact | 3.4, 3.7.1 | | `x = 1` is a command `x` with two arguments; an assignment has no blanks around `=` |
| `brace-no-space` | warning | fact | 3.2.5.3 | | `{` is a reserved word only as a word of its own; `{echo` is a command name |
| `brace-close-no-separator` | warning | fact | 3.2.5.3 | | `}` without `;` or a newline before it is an argument; the group is not closed |
| `rm-empty-variable-root` | warning | both | 3.5.3, 3.5.8 | `rm` | An empty value leaves `/…`; it bites only when the variable is empty. Habit: `${v:?}` (ShellCheck SC2115) |
| `read-without-r` | info | both | 4.2 | | Without `-r`, `read` takes a backslash as an escape; it bites only when the input has one. Habit: always `read -r` (SC2162) |
| `redirect-in-bracket` | warning | fact | 3.6, 3.2.5.2 | | `>` in `[ ]` is a redirection, not a comparison |
| `bracket-close-in-word` | warning | fact | 4.1, 3.5.7 | | `]` inside a word is not the last argument `[` needs |
| `and-or-in-bracket` | warning | fact | 3.2.4, 4.1 | | `&&` ends the command `[`, which then has no `]` |
| `download-run-by-shell` | warning | both | 6.1 | `curl`, `wget` | The shell runs what arrives, line by line; it bites only when the download is cut or not what was meant. Habit: download, read, then run |
| `trap-goes-on` | info | fact | 4.1, 3.7.6 | | After the action, bash goes on with the script; the advice ends the action with `exit` |
| `source-searches-path` | info | both | 4.1, 6.11 | cron (its start directory) | `.` looks in `$PATH` first (only there in POSIX mode); it bites only when `$PATH` has the name or the script starts elsewhere. Habit: a path from the script's directory |
| `pattern-from-variable` | info | both | | `grep` | grep reads the value as a regex; it bites only with `.`, `*`, `[` or a part of a longer text. Habit: `-F` for fixed text |

The catalog (src/messages.ts and src/messages-posix.ts; sections are the entries' own):

| Entry | Level | Kind | Also rests on | Why / habit |
| --- | --- | --- | --- | --- |
| `declaration-masks-status` | info | both | | 4.2: the status is that of `local`; it bites only when the substitution fails. Habit: declare and assign apart (SC2155) |
| `pipefail-missing` | info | both | | 3.2.3: a pipeline's status is its last command's; it bites only when an earlier stage fails. Habit: `set -o pipefail` |
| `function-last-test-returns-status` | info | fact | | 3.3, 3.2.4: the function returns the status of its last list; the advice fixes this line |
| `function-last-test-stops-script` | warning | fact | | With `set -e`, the call stops the script whenever the test is false |
| `script-last-test-returns-status` | info | fact | | The script's status is its last command's (3.7.5) |
| `failure-reported-as-success` | info | fact | | The status is the right side's; the advice reports the failure |
| `local-outside-function` | warning, info | fact | dash, busybox ash | bash refuses `local` outside a function (4.2); dash and ash stop the shell there |
| `posix-special-function-name` | warning | fact | | 6.11, with the probe that shows the end (`checked`) |
| `posix-special-function-name-maybe` | info | fact | | As above, on some paths |
| `posix-function-name` | warning | fact | | bash 5.2 in POSIX mode refuses the name (6.11); 5.3 defines it |
| `posix-function-name-maybe` | info | fact | | As above, on some paths |
| `posix-special-builtin-error` | warning | fact | | 6.11: a special builtin's error ends a POSIX shell |
| `posix-special-builtin-error-maybe` | info | fact | | As above, on some paths |
| `postfix-increment-status` | warning, info | fact | | 6.5: `v++` gives the old value, and 0 is status 1 |
| `postfix-decrement-status` | warning, info | fact | | As above, for `v--` |
| `alias-not-expanded-in-script` | warning | fact | | 6.6: no aliases in a shell that is not interactive, unless `expand_aliases` |
| `alias-maybe-not-expanded` | info | fact | | 6.6, for a file with no shebang: both ways it may be read are stated |
| `unbraced-element` | warning | fact | | 6.7: `$a[1]` is `$a` and the text `[1]` |
| `extglob-in-same-block` | warning | fact | | 3.5.8.1, `checked`: bash parses the block before it runs `shopt` |
| `extglob-maybe-on` | info | fact | | As above, on some paths |
| `extglob-turned-off` | warning | fact | | As above, after `shopt -u extglob` |
| `extglob-not-found` | info | fact | | As above, with no `shopt -s extglob` before |
| `extglob-maybe-on-trap` | info | fact | | As above, for a trap's action read when the signal comes |
| `extglob-not-in-new-shell` | warning | fact | | As above, in a new shell, which starts with it off |
| `globstar-maybe-on` | info | fact | | 3.5.8: `**` is `*` without `globstar`, on some paths |
| `globstar-not-found` | info | fact | | As above, with no `shopt -s globstar` before |
| `globstar-unsupported` | warning | fact | the target shell | The shell has no `globstar` |
| `variable-not-in-remote-shell` | warning | fact | `ssh` | The remote shell expands the variable, and does not have it |
| `variable-not-passed-by-wrapper` | warning | fact | the wrapper (`env -i`, `sudo`) | The wrapper passes no variables of the script |
| `variable-not-exported` | warning, info | fact | | 3.7.3, 3.7.4; an array is never exported (`checked`) |
| `function-not-in-container` | warning | fact | `docker` and the like | The command runs in the container, which lacks the function |
| `builtin-or-function-as-program` | warning | fact | the wrapper | The wrapper starts a program (3.7.3); a builtin or a function is not one |
| `ssh-local-expansion` | info | fact | `ssh` | 3.7.1: this shell expands the words before ssh gets them; often meant (not a problem) |
| `function-not-on-remote` | warning | fact | `ssh` | The remote shell lacks the function |
| `function-not-in-new-shell-blocked` | warning | fact | the wrapper | A new shell lacks the function, and the wrapper passes no exported functions |
| `function-not-in-new-shell` | warning | fact | the wrapper | A new shell lacks the function |
| `function-not-imported` | warning | fact | the other shell | Only bash reads the functions bash exports |
| `function-not-in-new-shell-export` | warning | fact | the wrapper | A new shell lacks the function unless it is exported to a bash |
| `function-not-imported-sh` | info | fact | Debian's and Ubuntu's `sh` (dash) | dash does not read exported functions |
| `wrapper-assignment-expanded-first` | warning | fact | the wrapper | 3.7.1: this shell expands the words before the wrapper sets the variable |
| `pipeline-subshell-variable` | warning | fact | | 3.2.3: each stage runs in a subshell |
| `unmatched-glob-runs-once` | info | both | | 3.5.8: no match leaves the pattern; it bites only when nothing matches. Habit: `[ -e "$f" ] \|\| continue`, or `nullglob` |
| `prefix-assignment-expanded-first` | warning | fact | | 3.7.1, 3.7.4: the words are expanded before the assignment reaches the command |
| `unquoted-variable-as-path` | warning, info | both | | 3.5.7, 3.5.8; it bites only with a blank or a glob character in the value. Habit: quote expansions (SC2086) |
| `for-over-ls-output` | info | both | `ls`, `find` | 3.5.7; it bites only with blanks in the names. Habit: a glob, or `find -print0` (SC2045, SC2044) |
| `for-over-unquoted-args` | info | both | | 3.5.7; it bites only with blanks in the arguments. Habit: `"$@"` (SC2068) |
| `array-joined-in-assignment` | info | both | | 3.4, 6.7 (`checked` for an array's elements): the words are joined; it bites when an array was meant. Habit: an array, or `*` for one string (SC2124) |
| `unquoted-variable-in-test` | info | both | | 3.5.7, 4.1 (`differs`, but in zsh); it bites only with an empty value or blanks. Habit: quote in `[ ]` (SC2086) |
| `nounset-unbound` | warning, info | fact | | 4.3.1, 3.5.3 (`differs` in one case) |
| `shebang-refused` | warning | fact | Linux `execve` | The kernel passes all after the interpreter as one argument, which bash refuses (6.1) |
| `shebang-bom` | warning | fact | the kernel | A BOM before `#!` is no shebang |
| `redirect-by-your-shell` | warning | fact | `sudo` | 3.6: this shell opens the file before sudo runs (ShellCheck SC2024 says the same) |
| `bats-test-line-dropped` | warning | fact | bats | bats replaces the whole `@test` line |
| `bats-negation-ignored` | warning | fact | bats | 4.3.1: `set -e` ignores a status after `!` |
| `bats-run-in-pipeline-stage` | warning | fact | bats | 3.2.3: `run` in a stage sets its variables in a subshell |
| `bats-run-in-pipeline` | warning | fact | bats | `run` prints nothing, and its variables are set in a subshell |
| `bats-setup-suite-in-test-file` | warning | fact | bats | bats does not call it there (warning BW03) |
| `regex-backslash-dropped` | warning | fact | | 3.2.5.2, 3.5.9: quote removal drops the backslash; the advice (a variable) is the manual's own |
| `distro-alias-in-script` | warning | fact | the distribution's start-up files | 6.6: the alias exists only in interactive shells there |
| `dockerfile-pipefail-missing` | info | both | Docker (`RUN` with `/bin/sh -c`) | It bites only when a stage before the last fails. Habit: `SHELL` with `-o pipefail` (Hadolint DL4006) |
| `python-string-without-shell` | warning | fact | Python's `subprocess` | Without `shell=True`, the string is one program name |
| `python-shell-injection` | warning | both | Python's `subprocess` | 3.1.2: the shell reads the pasted values as code; it bites only with `;` or `$(…)` in a value. Habit: `shlex.quote()` or a list (Python's documentation) |
| `actions-script-injection` | warning | both | GitHub Actions | The expression is pasted into the script; it bites only with a hostile value. Habit: pass it through `env:` (GitHub's security hardening guide) |

### 2.4 What follows

- **A convention is not the basis of a claim.** Every claim of these notes rests on bash, or on the program named: no note would get `convention` as its basis. And a note sorted *both* keeps the basis of its fact: `unquoted-variable-in-test` and `array-joined-in-assignment` are `differs` and `checked` with a try-it; a `convention` basis in their place would drop the chip.
- **So the habit is a field of its own, beside the basis.** A note sorted *both* names its habit: `convention: ConventionId`, an id into a table (src/conventions.ts) that says the habit and who states it (`sources`: `'ShellCheck SC2086'`, `'Hadolint DL4006'`, Python's documentation), with a comment, as `TOKEN_BASES` does for tokens. One habit serves several notes: `quote-expansions` serves `unquoted-variable-as-path` and `unquoted-variable-in-test`; `pipefail` serves `pipefail-missing` and `dockerfile-pipefail-missing`.
- **The `convention` kind leaves `Basis`.** It is a placeholder that nothing gives and no view reads; the row model of P7a is not written yet. Removing it now keeps `Basis` to what a claim rests on (section 5, question 1).
- **Where it is given.** A catalog entry with `withConvention(entry, id)`, as `withBasis`. A style check with a table by code beside `STYLE_LEVELS` (`STYLE_CONVENTIONS: Record<StyleCode, ConventionId | null>`): total, so that a new code must decide. The style checks also get the sections of the table above (`STYLE_REFS`), so that their fact has a basis like the catalog's.
- **What carries it.** `Fact.convention` and `Note.convention` (the `noteInfo` of a line, which holds the style checks), behind the same gate as the basis (`notes.basis`). The JSON: `facts[].convention`, and the records of `--check --format json`, which already carry each note's `code` (a field added, nothing removed). The explanation's JSON lists style checks only as text (`notes`); it stays so.

Out of the audit, and why:

- **Idioms** (src/idioms.ts): they say what a known pattern does (`trap … EXIT`, `cd "$(dirname "$0")"`), which is a fact. A few call a pattern usual ("the usual strict mode"): that word is the only convention, and it is no advice.
- **Dialect issues** (src/dialect.ts, "Portability"): what another shell lacks or does otherwise. They rest on that shell, a `spec` of a shell, not a convention. Left for later, as data if a view asks.
- **The model's premises.** The model assumes that a name in capitals may come from the environment (`variable-not-exported`, `environment: 'maybe'`; src/semantics/shellstate.ts, `fromEnvironment`), and that a file such as `/etc/hosts` is written only by root (`redirect-by-your-shell`). These conventions decide the case, not the claim; the note says "maybe" or "usually". They need no field.

## 3. Views

None, as basis.md says (section 1, step 5). The audit gives no reason to change that:

- `spec` would mark nearly every option and operand: a chip on each would be noise, and the reader already sees the command's name above them.
- No note is a convention alone, so no note would be wrongly read as bash's rule. The 16 notes sorted *both* say their habit in plain words ("Usually write `read -r`", "Write `"$a"`"); the fact they warn of is real.

`partBasis` and `basisSaid` show only `checked` and `differs`, so a `spec` basis changes no view; a test pins that. P7a's rows carry the fields and show nothing for them, until the maintainer asks.

## 4. Steps

Each step is a PR that keeps every test passing. 5a and 5b are independent: plain PRs from main, in either order.

1. **5a, `spec` on command tokens.** A program's command token gets `basis: { kind: 'spec', command }`, set where the token is made (src/explain/commands.ts) and given after the line is explained, with `notes.basis` on. `tokenBasisFor` in src/basis.ts gives the basis of a token of origin `argv` or `embedded` from the nearest command token above it; the reading tree copies the command token's basis to its node, as it copies `basis` now. Not for builtins, bash, functions, aliases, unknown or custom commands; for bats' host commands. Tests (test/basis.test.ts): the basis of `grep -rn x .`'s token and the rule for its options and pattern; none for `read -r`, `bash -c`, `f` a function, `ls` an alias, a custom command; a text with a basis of its own keeps it (`alias a/b=x`); none with the setting off; `partBasis` shows nothing for `spec`; the CLI's JSON (test/cli.test.ts). No view changes. The details file (docs/changes/unreleased.md) adds to the basis entry that the CLI's JSON names the spec on a command's token; no new CHANGELOG bullet.
2. **5b, conventions.** src/conventions.ts (the ids, the habits, their sources, each checked: the ShellCheck and Hadolint codes against their own lists); `withConvention` on the 11 catalog entries sorted *both*; `STYLE_CONVENTIONS` (5 codes) and `STYLE_REFS` (12 codes; `pattern-from-variable` has none) in src/pitfalls.ts; `Fact.convention`, `Note.convention`; the JSON's facts and the `--check` records; `convention` removed from `Basis` (if question 1 is agreed). test/basis.test.ts pins the kind of every pitfall and style check, as the table of section 2.3 (fact, or the id of its habit), so that a new pitfall must be sorted; the sections of every style check are in src/manual.ts. The details file, as in 5a.
3. **Then** P7a takes `basis`, `tryIt` and `convention` as row data, and shows the chip of `checked` and `differs` only.

basis.md, the design index and the roadmap item are updated in each.

## 5. Questions for the maintainer

1. **`convention` as a field, not a kind of basis.** The audit found no note that rests on a convention alone; 16 notes state a fact and recommend a habit. Their basis must stay the fact's (two of them show a chip). *Recommendation:* remove `convention` from `Basis`, and give such notes `convention: ConventionId` beside their basis.
2. **`spec` on the command token only.** Per token, the JSON of sample.sh grows by 5.9%, and the value repeats under each command; on the command token, by 0.8%, with a rule for the tokens under it. *Recommendation:* the command token, and the rule in one helper.
3. **Sources of the habits.** A habit can name who states it: ShellCheck's and Hadolint's codes, Python's and GitHub's documentation. That is data only; nothing is fetched or linked. *Recommendation:* name them where one exists, as plain strings; ShellCheck is only cited, never run or bundled.
4. **What a `spec` names.** The specs do not say which implementation and version they describe, nor which test compares them with it. *Recommendation:* not now. The dictionary describes GNU/Linux by default and says where BSD or macOS differ; add the implementation to a spec only when a view needs it.
5. **The style checks' sections.** Twelve of the 13 style checks are facts of bash, but have no `refs`, so their basis is the manual with no section. *Recommendation:* give them the sections of section 2.3 in step 5b (`STYLE_REFS`), checked against the bash 5.2 manual; they stay in src/pitfalls.ts, as CLAUDE.md says.
