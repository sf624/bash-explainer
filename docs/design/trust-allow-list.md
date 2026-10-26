# Trust as a strict allow-list

Status: proposed (2026-10-26). Values in Meaning, decided conditions and dead code rest on the trust of src/semantics/trust.ts ([semantics.md](semantics.md), 4.14; [expansion-values.md](expansion-values.md), 3). This page proposes to turn its default around. Today a construct the scan does not recognise is taken to change nothing. With this plan, every construct is looked up in a table, and a construct that is not in the table changes anything. A new hole then gives no value, instead of a wrong one.

## 1. The failure pattern

**How the trust works today.** The scan (`Scan.visit` in trust.ts) walks the whole text once. It handles the node types, builtins and options it knows: a plain assignment, a declaration, `read`, `eval`, `trap`, `source`, `$cmd`, arithmetic, indirection, and so on. For each one it records a write that is not plain (the name is not trusted) or a reason to trust nothing (`blindFor`). Everything else falls through the `switch` and is taken to change nothing: a builtin with no `shellEffect` in its spec, an option of `set` or `shopt` with no case of its own, a variable of bash with no rule, a word of `test` in a position nobody thought of. So the trust is an allow-list of variables, but a deny-list of constructs. It blocks the causes it knows.

**The evidence.** Each review finds the neighbours of the last fix:

- The review of #356 (values) found 7 wrong values.
- #382 (step 0 of [trust-per-position.md](trust-per-position.md)) fixed 8 holes. Its review then found 8 close variants:
  - `[ "$1" "$2" ]`, `test "$@"` and `[ $x ]` acting as `-v a[u=2]` (step 0 fixed only a static `-v`);
  - nameref chains (`declare -n b=$1; declare -n a=b`; step 0 fixed only a direct target not known);
  - values from the environment kept by `: "${n:=0}"`, `n="$n"`, a string `+=` or `localvar_inherit`, then read as arithmetic (step 0 fixed only a bare `declare n`);
  - `enable -ns exit` (step 0 fixed only `enable -n exit`);
  - `x+='…'` building a `\044((u=2))` prompt for `${x@P}` (step 0 checked each assigned text alone);
  - `widen` keeping `readonly` after a recursive call;
  - history expansion (`!!`) after `set -H`;
  - `case … ;;&`: the patterns after it read with the values from before the `case`.
- #387 fixes four of these (test words, nameref chains, `enable`, `widen`). The other four are open.

**More of the same, found for this page.** The question "what does the scan not know?" has finite answers: the builtins of bash, the options of `set` and `shopt`, the variables of the manual's sections 5.1 and 5.2. Going through those lists found six more holes in main (9eef251b). Each was checked with bash 5.2 and bash 5.3, run in a memory-capped scope with `FUNCNEST` set:

| Script | bash 5.2 and 5.3 | The model today |
| --- | --- | --- |
| `shopt -s compat42; x=abc; y="${x/b/'q'}"; echo "$y"` (also `BASH_COMPAT=42`) | `a'q'c` | value `aqc` |
| `shopt -s compat31; x=abc; if [[ $x =~ "a.c" ]]; then y=yes; else y=no; fi; echo "$y"` | `yes` | condition always false; `y=yes` dead; `$y` is `no` |
| `FUNCNEST=1; g() { x=2; }; f() { g; }; x=1; f`, then a line `echo "$x"` | `1` ("maximum function nesting level exceeded"; the rest of the first line is discarded) | `2` |
| `shopt -s expand_aliases; BASH_ALIASES[1]="u=2"; u=1`, then a line `1`, then `echo "$u"` | `2` | `1` |
| `set -C; : > f; x=1; declare x=2 > f; echo "$x"` | `1` ("cannot overwrite existing file": `declare` does not run) | `2` |
| `set -k; f() { y=$x; }; x=1; f x=2; echo "$y"` | `2` (`x=2` is an assignment for `f`) | `1` |

None of these is exotic in bash's terms. Each is one row of a list the scan never read in full. The fix of each, one by one, would be the ninth, tenth and eleventh special case. The scan needs to fail toward "no value" for what it does not know.

## 2. The allow-list

**The rule.** The scan looks up every construct of the script in one table. Each entry gives the construct's *effect*:

- `none`: it changes nothing a value, a decision or a dead mark reads. (`echo`, a program, `>file`.)
- `followed`: the walk follows its effect exactly (src/semantics/walk/). An entry may have a *precondition*; when the precondition fails, the entry gives its fallback effect instead (`names` or `all`).
- `names N`: it may change the variables N, in a way the walk does not follow. Those names are not trusted (today's `write(…, plain: false)`).
- `all`: it may change anything. Nothing is trusted (today's `blindFor`).

A construct that is not in the table has the effect `all`. "Construct" means a member of one of these finite sets:

1. the node types of the syntax tree (`NodeType`, src/syntax/tree.ts);
2. the command names: a function the script defines, a builtin (each by name), anything else (a program, or not found);
3. for each builtin, its options and operand roles (from its spec, src/dict/builtins.ts);
4. the operators of parameter expansion;
5. the options of `set -o` and of `shopt`;
6. the variables bash gives a meaning (`BASH_VARIABLES`, src/semantics/vars.ts);
7. the redirection operators.

Each set can be checked for completeness: the type checker for `NodeType`, and bash itself for the others (section 5).

**The tables.** Each row says what the construct may change. "Today" means the scan already does this; "new" marks a change.

*Syntax.*

| Construct | Effect |
| --- | --- |
| `program`, `comment`, `command_name`, `pipeline`, `list`, `negated_command`, `compound_statement`, `subshell`, `do_group`, `if_statement`, `elif_clause`, `else_clause`, `while_statement`, `c_style_for_statement`, `time_statement`, `redirected_statement`, `arithmetic_command`, `extended_test`, the word and expression nodes | followed (the walk; the arithmetic, test and word parts below) |
| `function_definition` | followed; the function is closed only when every call is one the walk sees (today) |
| `for_statement`, `select_statement` | names: the loop variable (and `REPLY` for `select`) (today) |
| `coproc_statement` | names: the coprocess array and its `_PID` (today) |
| `case_statement` | followed, precondition: no pattern after a `;&` or `;;&` reads a name that a list before it may write (a list that calls a function or runs a builtin that writes may write any). Else `all`, until the walk expands such patterns in the state after the list before them (new) |
| `error` (text our parser could not read) | `all` (new): bash may read it otherwise |

*Command names.*

| Construct | Effect |
| --- | --- |
| A function the script defines | followed (the walk walks the call) |
| A builtin | its row below |
| Any other static name (a program, or a name not found) | `none`: it runs in a child process. (`command_not_found_handle` also runs "in a separate execution environment", manual 3.7.2.) Its prefix assignments go to the child's environment only |
| A name not known (`$cmd`) | today's rule (a variable the script sets only to safe commands or to functions), else `all` |

*Builtins* (all 61 of `compgen -b`, the same in 5.2 and 5.3). An option the spec does not know makes the call `all` (new): bash may take it, and the scan cannot say what it does.

| Builtins | Effect |
| --- | --- |
| `:`, `true`, `false`, `echo`, `printf` (no `-v`), `pwd`, `type`, `help`, `times`, `jobs`, `caller`, `dirs`, `disown`, `suspend`, `logout`, `ulimit`, `umask`, `hash`, `bind`, `history`, `kill`, `wait` (no `-p`), `bg`, `fg`, `complete`, `compopt` | `none` (a function named as a callback, `complete -F f`, is not closed: today) |
| `cd`, `pushd`, `popd`; `shift` | names: `PWD`, `OLDPWD`, `DIRSTACK`; the positional parameters (never trusted) |
| `exit`, `return`, `break`, `continue` | followed (jumps; a count not known takes both paths) |
| `declare`, `typeset`, `local`, `export`, `readonly` | followed for `x=w` with no option but `-r`, `-x`, `-g`; names for the other options the spec knows (`-i`, `-a`, `-A`, `-l`, `-u`, `-t`); the nameref rule for `-n`; `all` for a name not known (today), and for an option the spec lacks (`-I`: `declare -I x` in a function keeps the caller's value) |
| `unset` | followed for static names and `-f`; `all` for a name not known (today) |
| `read`, `mapfile`, `readarray`, `getopts`, `printf -v`, `wait -p` | names: the variables they name; `all` for a name not known (today) |
| `let` | arithmetic (below) |
| `eval` | followed when the walk reads its string; else `all` (today) |
| `source`, `.` | `all` (today) |
| `trap` | followed for an action the walk reads (foreign text); `all` for DEBUG, RETURN, signals not known, or an action not known (today) |
| `alias`, `unalias` | followed for static text; else `all` (today) |
| `enable` | followed for `-n NAME`, `NAME`, and `-a` or `-p` that only print; `all` for `-f`, `-d`, other letters, or a name not known (#387 does most of this) |
| `set` | each option, by the table below; the positional parameters (never trusted) |
| `shopt` | each option, by the table below; `all` for a name not known (new) |
| `test`, `[` | followed, precondition: no word may be `-v` or `-R` with an operand that has a subscript. That is: no unquoted word that may split into such words, no `"$@"`, and no word that is not static text directly after one that may be an operator (#387); else `all` |
| `command`, `builtin` | the row of the command they run; `command -v`, `-V`: `none` (today) |
| `compgen` | `none` for a quiet word list and no `-F` or `-C`; else `all` (today) |
| `fc` | `none` with `-l`; else `all` (today) |
| `exec` | followed with no command (its redirections); with one, the shell ends there (the walk does not mark the code after it dead, which only says less) |

*Options of `set`* (the 27 of `set -o`, the same in 5.2 and 5.3).

| Options | Effect when turned on |
| --- | --- |
| `allexport`, `errexit`, `nounset`, `noglob`, `pipefail`, `monitor`, `braceexpand` (also off), `xtrace` (with the PS4 rule, today) | followed |
| `emacs`, `vi`, `ignoreeof`, `nolog`, `notify`, `verbose`, `hashall`, `physical`, `privileged`, `interactive-comments`, `errtrace`, `functrace` | `none` (`errtrace` and `functrace` only change where ERR, DEBUG and RETURN traps run; DEBUG and RETURN traps are `all`, and an ERR trap's action is foreign text) |
| `histexpand`, `history` | `all` (new): `!!` runs an earlier line |
| `keyword` | `all` (new): an assignment word anywhere in a command is an assignment for it (table of section 1) |
| `noclobber` | `all` (new): a `>` to an existing file fails, so its command does not run (table of section 1) |
| `noexec`, `onecmd` | `all` (new): the commands after it do not run |
| `posix` (also `POSIXLY_CORRECT`) | `all` (new), until the POSIX-mode rows of [bash-versions.md](bash-versions.md), step 6, say which of the manual's differences (6.11) the walk follows |

*Options of `shopt`* (57 in 5.2; 5.3 adds `array_expand_once` and `bash_source_fullpath`).

| Options | Effect |
| --- | --- |
| `expand_aliases`, `extglob`, `nocasematch`, `lastpipe`, `inherit_errexit`, `failglob` | followed |
| `nullglob`, `dotglob`, `globstar`, `globskipdots`, `nocaseglob` | `none`: a value with a glob character is never given, and no decision reads a glob |
| `patsub_replacement`, `noexpand_translation`, `promptvars`, `xpg_echo`, `sourcepath`, `execfail`, `checkwinsize`, `varredir_close`, `shift_verbose`, `gnu_errfmt`, `huponexit`, `checkhash`, `checkjobs`, `cmdhist`, `lithist`, `histappend`, `histreedit`, `histverify`, `hostcomplete`, `progcomp`, `progcomp_alias`, `complete_fullquote`, `direxpand`, `dirspell`, `cdspell`, `cdable_vars`, `autocd`, `mailwarn`, `no_empty_cmd_completion`, `force_fignore`, `interactive_comments`, `login_shell`, `restricted_shell`, `bash_source_fullpath` | `none`: what they change is never given as a value (`${x/p/&}`, `$"…"`, `${x@P}` of a value that is not quiet), only printed, only interactive, or a variable bash sets itself |
| `compat31` … `compat44`, `extdebug`, `localvar_inherit`, `localvar_unset`, `assoc_expand_once`, `array_expand_once` | `all` when turned on (new; `compat31` and `compat42` in section 1, `localvar_inherit` in the review) |
| `extquote`, `globasciiranges` | `all` when turned off (new): `$'…'` inside `"${x:-…}"`, and ranges in patterns by the locale |

*Variables of bash.* `BASH_VARIABLES` gets a field `effect`, for what assigning the variable does to bash (new):

| Variables | Effect of a write |
| --- | --- |
| `BASH_COMPAT`, `FUNCNEST`, `BASH_ALIASES`, `POSIXLY_CORRECT` | `all` (section 1; `POSIXLY_CORRECT` turns on POSIX mode) |
| `LANG`, `LC_ALL`, `LC_CTYPE`, `LC_COLLATE` | `none` for `C`, `POSIX`, `C.UTF-8` or empty; else `all`: case conversion, character classes and ranges follow the locale (manual 5.2) |
| `IFS`, `PS4`, `OPTIND`, `BASH_ENV`, `ENV`, the readonly ones (`SHELLOPTS`, `UID`…), the dynamic ones (`RANDOM`, `PWD`…) | followed (today: the word model, the PS4 rule, arithmetic, other shells' models, never trusted) |
| The others (`PATH`, `CDPATH`, `HOME`, `GLOBIGNORE`, `TMOUT`, `HIST*`, `PS1`, `TIMEFORMAT`…) | `none` |

A prefix assignment of a program (`LANG=de_DE.UTF-8 sort`) is `none`: it goes to the program's environment only.

*Expansions.*

| Construct | Effect |
| --- | --- |
| `$x`, `${x}`, `${#x}`, `${x-w}`, `${x:-w}`, `${x+w}`, `${x:+w}`, `${x?w}`, `${x:?w}`, `#`, `##`, `%`, `%%`, `/`, `//`, `/#`, `/%`, `^`, `^^`, `,`, `,,`, `~`, `~~` | `none` (`?` may end the shell: followed by src/semantics/stops.ts) |
| `${x=w}`, `${x:=w}` | names: `x` (today). Its value is "kept": a set `x` keeps its value, which may come from the environment (new: read as arithmetic, it is `all`) |
| `${x:o:l}`, a subscript | arithmetic (below; a subscript of an associative array is a key) |
| `${x@Q}`, `@E`, `@A`, `@a`, `@K`, `@k`, `@U`, `@u`, `@L` | `none` |
| `${x@P}` | followed, precondition: every value the script gives `x` is quiet, and none is made with `+=` (new: `+=` joins texts that are quiet alone); else `all` |
| `${!x}` and the other indirections | `all` (today); `${!a[@]}`, `${!p@}` with nothing after them: `none` |
| `$(…)`, backquotes, `<(…)`, `>(…)` | `none` for this shell (a subshell); their own commands are looked up as well |
| `${ …; }`, `${| …; }` (bash 5.3) | `all` (today) |
| `$((…))`, `$[…]` | arithmetic |
| `$"…"`, brace expansion, a tilde, a glob | `none` (never given as a value) |

*Redirections.* `<`, `>`, `>>`, `<>`, `>|`, `&>`, `&>>`, `<&`, `>&`, here-documents and here-strings: `none` (their words are looked up as words). `{fd}>…`: names `fd` (today). (`set -C` is `all`, above.)

*Arithmetic* (`(( ))`, `$(( ))`, `let`, `for (( ))`, subscripts, offsets, integer variables, `[[ x -eq y ]]`). Followed, as today: the names it assigns are `names`, and the names it reads must have values the script wrote, since bash runs a value as an expression. The closure gets three more preconditions (new), each `all` when it fails: no value the script copies from the same variable (`n="$n"`), no value kept by `${n:=w}`, and no `+=` on a variable that arithmetic reads. With `localvar_inherit` (`all` above), a `local n` keeps the caller's value too.

## 3. How the model reads it

**The decision function does not change.** `Trust.blind`, `Trust.variable(name)` and `Trust.closed(name)` keep their meaning and their readers: `StateModel.trusts`, `condition`, `dead`, `settled`, `expansionValue`, the status model and the env model. What changes is how the scan maps constructs to writes and reasons:

- A new module, src/semantics/allow.ts, holds the tables: `SYNTAX: Record<NodeType, Effect>` (the type checker makes it complete), `BUILTINS` (by name), `SET_OPTIONS`, `SHOPT_OPTIONS`, `EXPANSION_OPERATORS`, `REDIRECTIONS`, and the field `effect` of `BASH_VARIABLES`. `Effect` is `none`, `{ followed, unless?, otherwise }`, `{ names }` or `{ all: why }`.
- `Scan.visit` asks the table first. `all` calls `blindFor(why)`, `names` calls `write(…, plain: false)`, and `followed` runs today's handler, which checks the precondition and falls back to `otherwise`. The `switch` of today becomes the handlers of the `followed` rows. A node type, builtin, option or operator with no row is `all`.
- A precondition that needs the value at a point (an unquoted `$x` in `test` whose values have blanks: the walk knows how it splits there; a `${x@P}` whose value differs between paths) is checked by the walk, as arithmetic that reads a name no path has set is today: `Walker.found` walks the script again with nothing trusted.

**What it composes with.** The walk (src/semantics/state.ts, src/semantics/walk/) does not change for this plan. The table states what the walk claims to follow; each `followed` row names the probe rows and generator constructs that test it (section 5). A bug of the walk in a `followed` row (the recursion of `widen`, the patterns after `;;&`) is not caught by the table. The table makes the claim explicit, and the precondition of `case` stands in until the walk is fixed.

[trust-per-position.md](trust-per-position.md) (deferred) is orthogonal: it would turn `all` into a taint on the paths after the construct, instead of the whole script. The kinds of that page (command, expansion, later) fit the rows here. Nothing here depends on it.

## 4. Cost, measured

**Method.** A prototype of the rule on trust.ts (about 150 lines behind an environment switch, not committed): the rows marked "new" above, with `all` for each construct of section 1, the arithmetic preconditions, `${x@P}` with `+=`, the `case` precondition, unknown builtin options, and `error` nodes. It does not have the walk-side checks of section 3, so it is a little stricter than the plan. It was measured on two sets, read as data and never run:

- (a) the repository's corpus (test/support/corpus.ts: the fixtures, the host files and the snippets of the tests, as test/snapshot.ts reads them; 1,502 inputs at #387's head);
- (b) 802 real scripts on this machine: 616 files of /usr/share/bash-completion, 142 files of /usr/bin and /usr/sbin with a `bash`, `sh` or `dash` shebang, and 44 files of /etc (`*.sh`, `*.bash` or such a shebang).

Counted per file: expansions with a value (`expansionValue` over every `simple_expansion` and `expansion`), decided conditions (`condition(n)` defined, over `if`, `elif`, `while`, `for (( ))`, `&&`/`||` lists and `case`), dead statements (`dead(n)`, the outermost only), and files that trust nothing (`blind`). (The review of #382 reported 436 values, 58 decisions and 32 dead marks on 2,310 files, with a counter of its own. Every column here comes from the one counter above, so the columns compare with each other, not with that tally.)

| Set | Measure | Before step 0 (a8dda2d8) | Step 0 (#382) | #387 | #387 + allow-list |
| --- | --- | --- | --- | --- | --- |
| (a) corpus | values (files) | 32 (13) | 32 (13) | 32 (13) | 32 (13) |
| | decisions | 26 | 26 | 26 | 26 |
| | dead statements | 9 | 9 | 9 | 9 |
| | blind files | 142 | 143 | 158 | 200 |
| (b) real | values (files) | 173 (22) | 173 (22) | 69 (16) | 69 (16) |
| | decisions | 0 | 0 | 0 | 0 |
| | dead statements | 0 | 0 | 0 | 0 |
| | blind files | 485 | 657 | 670 | 679 |

**What the allow-list costs, on top of #387: no value, decision or dead mark.** It makes 51 more files blind, none of which had one:

- corpus: 38 snippets with a parse error (`error`), 3 with a builtin option the spec does not know (`read` twice, `declare`), 1 with a glob in `[ ]`;
- real: 5 bash-completion files with `complete` options the spec does not know (`-f`, `-u`, `-X`…), 2 with `set -o noclobber` (`add-shell`, `remove-shell`; `gzexe` and `bzexe` were already blind), and 2 helpers in Perl and Python under bash-completion/helpers, which the collection took and our parser cannot read.

The options the specs lack should be added first (section 6, step 1); then the cost is the parse errors and `noclobber` only.

**What #387 costs, for comparison.** On the real scripts, #387 takes 173 values to 69. Of the 104 lost, 76 are in `ncurses6-config` and `ncursesw6-config`: `[ $lib_first = yes ]`, where `lib_first` is only ever `yes` or `no`, but the script saves and restores IFS (`save_IFS="$IFS"; IFS=':'; …; IFS="$save_IFS"`), and #387 requires every value of IFS to be static text. The prototype follows copies (`IFS` from `save_IFS` from `IFS`) and keeps those 76. It also asks less: a value of `$x` that cannot hold `[` or a glob character cannot give `-v` an operand with a subscript, however it splits. The other 28 (`znew`, `service`, `xml2-config`, `select-editor`) are lost by both: their words come from `$1`, `read` or command output.

**The decisions' generator** (test/support/decisions.ts, `scripts(1, 120)`, the model only): step 0 decided 114 conditions and marked 966 statements dead, with 63 scripts blind; #387: 73, 598 and 78. The allow-list without its `case` precondition changes none of these; with it: 51, 450 and 87. The generator writes variables in `case` lists and reads them in patterns after `;;&` on purpose (that is how the review found the hole), so the precondition costs most there. The walk fix (step 4) gives those back.

## 5. Tests

- **Completeness, against bash.** test/allow-list.test.ts runs bash 5.2 (and 5.3 from `$BASH_EXPLAINER_BASH53`) with an empty environment and compares the tables with `compgen -b`, `set -o` and `shopt`: every builtin and option has a row, and no row names one bash lacks. `BASH_VARIABLES` is already compared with bash (test/bash-variables.test.ts); each entry must now have an `effect`. `SYNTAX` is complete by its type. Each builtin's options are compared with what bash accepts (`help -s` and the usage bash prints for an invalid option), so `bopt` finds a missing option of a spec, not a wrong `all`.
- **Every `followed` row is tested.** Each row lists the probe rows (test/fixtures/probes/*.json) and the generator constructs that exercise it; a test fails on a `followed` row with none, and on a listed row that does not exist.
- **The property.** For any script that holds a construct whose effect is `all`, the model gives no value, decides no condition and marks nothing dead. The generator checks it directly: test/decisions.test.ts gets "unknown construct" statements at random points (`shopt -s compat42`, `set -C`, `set -k`, `FUNCNEST=1`, `BASH_ALIASES[1]=…`, `set -o history -H` with a `!` line, `enable -ns exit`, `shopt -s localvar_inherit`, a builtin option no spec has), and asserts `blind` on those scripts, besides the existing differential check (no decision, value or dead mark that bash contradicts).
- **Each finding and its variants.** Rows in values.json, recorded with bash: the six holes of section 1; the four open findings of the #382 review (`: "${n:=0}"`, `n="$n"`, `n+=x`, `localvar_inherit` read as arithmetic with `n='y=5'` in the environment; `x='\0'; x+='44((u=2))'` for `${x@P}`; `set -o history -H` with `!-2`; `;;&` with a pattern that a list before writes); and one variant each that is safe and keeps its value (a static pattern after `;;&`, `LC_ALL=C`, a prefix `LANG=… sort`, `IFS` saved and restored).
- **The corpus**, before and after each step, with the counter of section 4 (the measuring script goes to scripts/, as [trust-per-position.md](trust-per-position.md), section 8, asks): no file may lose a value except for a row marked "new", and each loss is read by hand.

## 6. Steps

Each step keeps every test passing.

1. **The specs first.** Add the builtin options the specs lack (`complete -f`, `-u`, `-X` and the others, `declare -I`, and those the corpus snippets use with `read`), with test/builtins-real.test.ts. Nothing users see changes, except the explanation of those options.
2. **The table, with today's behaviour.** src/semantics/allow.ts with every row, and today's effect in each: `none` where the scan lets a construct through today. The scan reads the table; the default for a missing row is still `none`. Every explanation stays byte-identical (test/snapshot.ts). The completeness tests of section 5 land here.
3. **The default flips.** A missing row is `all`, and the rows marked "new" take their effect: the options, the variables of bash, the arithmetic preconditions, `${x@P}` with `+=`, `error` nodes. Each with its probe rows and the generator's "unknown construct" statements. Users see fewer wrong values and dead marks (CHANGELOG "Fixed": one bullet, the details in docs/changes).
4. **The walk-side preconditions**, and `case`: the patterns after `;&` and `;;&` expanded in the state after the list before them, so the `case` row loses its precondition; the test-word check of a value with blanks moved to the walk.
5. **Docs**: [semantics.md](semantics.md) 4.14 ("What decisions trust": the table replaces the lists), [expansion-values.md](expansion-values.md) section 3, README's Limitations (the assumptions about the start, as [trust-per-position.md](trust-per-position.md) section 2 lists them), the roadmap and this page's status.

**Risks.**

- **A wrong `followed` row.** The table can claim too much. The rows are checked against bash by their probe rows, and the generator's property covers the rest; the reviews should still try to find a construct the table follows wrongly.
- **Upkeep.** A new option in a spec needs a row (or it is `all`), and so does a new builtin or shopt option of a later bash (the completeness test fails until it has one). That is the point of the plan, but it is work on every spec change.
- **Parse errors.** `error` as `all` blinds any script our parser cannot read in full. On the corpus this cost no value; if it does later, a narrower rule (only the statement that holds the error, and what follows it) can come with trust per position.
- **Sample and examples.** The web page's sample must keep its values (test/expansion-values.test.ts checks it); #387 already changed its `[ $answer = yes ]` line. Step 3 checks the worked examples of every spec (src/examples/) for values they lose.

## 7. For the maintainer

- The allow-list costs no value, decision or dead mark on either set, on top of #387. It closes the six holes of section 1 and the four findings of the #382 review that #387 leaves open, and it makes the next such hole fail toward "no value".
- #387's rule for IFS loses 76 values in two real scripts that save and restore IFS; following copies keeps them (section 4). That can be done in #387 or in step 4 here.
- POSIX mode is `all` until the POSIX-mode rows of the roadmap's bash 5.3 item are done. Scripts that turn it on are rare; sh scripts, which start in it, keep their model.
