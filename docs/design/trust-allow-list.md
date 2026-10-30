# Trust as a strict allow-list

Status: built (2026-10-26): steps 1 to 5 done (section 6). Values in Meaning, decided conditions and dead code rest on the trust of src/semantics/trust.ts ([semantics.md](semantics.md), 4.14; [expansion-values.md](expansion-values.md), 3). This page turns its default around. Before, a construct the scan did not recognise was taken to change nothing. Now every construct is looked up in a table (src/semantics/allow.ts), and a construct that is not in the table changes anything. A new hole then gives no value, instead of a wrong one.

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

**And the review of this page found more.** A fresh review of the first draft tried to break its tables, and found six more ways the model is wrong today (each checked with bash 5.2 and 5.3; the model says the value from before):

- A redirection that fails stops its command, with no option set: `x=1; { x=2; } < ./nofile; if [ "$x" = 2 ]; then echo two; else echo other; fi` prints `other`; the model decides the condition always true and marks `echo other` dead. The same with `declare x=2 < ./nofile`, a function call `> ./no/such/dir`, `2>&9` with fd 9 closed, and a function defined with a failing redirection. (A command with only assignments still assigns: `x=2 < ./nofile` sets 2, and the model agrees.)
- `jobs -x eval x=2` runs `eval` in this shell; the spec already says so (`runs({ run: 'current-shell' })`), but the scan does not read it.
- Options in the shebang: `#!/bin/bash -k`, `#!/bin/bash -C`, `#!/usr/bin/env -S bash -O compat31` and `#!/usr/bin/env -S BASH_COMPAT=42 bash` each give the wrong result of the table above, when the script is run as a program. The walk reads the shebang's `set` letters (`shebangStart`), the scan does not, and `-O` is read by neither.
- A prefix assignment to another bash reaches its model: `BASH_COMPAT=31 bash -c '…'` with the `compat31` script of the table decides "always false"; bash takes `then`.
- Values from the environment reach arithmetic through copies: with `b='y=5'` in the environment, `y=1; a="$b"; b="$a"; (( a ))` and `y=1; a="$b"; b=0; (( a ))` both set `y` to 5. The closure of names read as arithmetic is by name, not by position.
- `exec {a[u=2]}>/dev/null` sets `u`: the scan takes only a plain name before `>`.

So the tables of section 2 cannot be written from what the scan knows today. They must be written from bash's lists, from the specs (each option and slot), and from what the walk really follows; section 2 does so.

## 2. The allow-list

**The rule.** The scan looks up every construct of the script in one table. Each entry gives the construct's *effect*:

- `none`: it changes nothing a value, a decision or a dead mark reads. (`echo`, a program, `>file`.)
- `followed`: the walk follows its effect exactly (src/semantics/walk/). An entry may have a *precondition*; when the precondition fails, the entry gives its fallback effect instead (`names` or `all`).
- `names N`: it may change the variables N, in a way the walk does not follow. Those names are not trusted (today's `write(…, plain: false)`).
- `all`: it may change anything. Nothing is trusted (today's `blindFor`).

A construct that is not in the table has the effect `all` (the variables are the one exception: see their table). "Construct" means a member of one of these finite sets:

1. the node types of the syntax tree (`NodeType`, src/syntax/tree.ts);
2. the command names: a function the script defines, a builtin (each by name), anything else (a program, or not found);
3. for each builtin, its options and operand roles (from its spec, src/dict/builtins.ts);
4. the operators of parameter expansion;
5. the options of `set -o` and of `shopt`;
6. the variables bash gives a meaning (`BASH_VARIABLES`, src/semantics/vars.ts);
7. the redirection operators.

Each set can be checked for completeness: the type checker for `NodeType`, the manual's lists for the variables, and bash itself for the others (section 5).

**The tables.** Each row says what the construct may change. "Today" means the scan already does this; "new" marks a change.

*Syntax.*

| Construct | Effect |
| --- | --- |
| `program`, `comment`, `command`, `command_name`, `variable_assignment`, `pipeline`, `list`, `negated_command`, `compound_statement`, `subshell`, `do_group`, `if_statement`, `elif_clause`, `else_clause`, `case_item`, `while_statement`, `c_style_for_statement`, `time_statement`, `arithmetic_command`, `extended_test`, the word and expression nodes | followed (the walk; the arithmetic, test and word parts below) |
| The shebang (the first `comment`) | its options are looked up in the tables below as if set on the first line: `set` letters (`bash -k`), `-O name`, `-o name`, and the assignments of `env -S` (`BASH_COMPAT=42 bash`) (new) |
| `redirected_statement`, and the redirect nodes (`file_redirect`, `file_descriptor`, `heredoc_redirect`, `heredoc_start`, `heredoc_body`, `heredoc_content`, `heredoc_end`, `herestring_redirect`) | the redirection rows below |
| `function_definition` | followed; the function is closed only when every call is one the walk sees (today) |
| `for_statement`, `select_statement` | names: the loop variable (and `REPLY` for `select`) (today) |
| `coproc_statement` | names: the coprocess array and its `_PID` (today) |
| `case_statement` | followed, once the walk expands a pattern after `;&` or `;;&` in the state after the list before it (new: today it uses the state before the `case`) |
| `error` (text our parser could not read) | `all` (new): bash may read it otherwise |

*Command names.*

| Construct | Effect |
| --- | --- |
| A function the script defines | followed (the walk walks the call) |
| A builtin | its row below |
| Any other static name (a program, or a name not found) | `none`: it runs in a child process. (`command_not_found_handle` also runs "in a separate execution environment", manual 3.7.2.) Its prefix assignments go to the child's environment only |
| A name not known (`$cmd`) | today's rule (a variable the script sets only to safe commands or to functions), else `all` |

*Builtins* (all 61 of `compgen -b`, the same in 5.2 and 5.3). The rows come from the specs where the specs say it, not from a list kept beside them (new): a command slot that runs in this shell (`runs({ run: 'current-shell' })`: `jobs -x`, `eval`, `command`, `builtin`) is `all` unless the walk walks it, and an option or operand that names a variable (`read x`, `printf -v x`, 5.3's `compgen -V x`) gives `names`. An option the spec does not know makes the call `all` (new): bash may take it, and the scan cannot say what it does. (Not for `echo`, `printf`, `:`, `true` and `false`, which print or ignore such a word.)

| Builtins | Effect |
| --- | --- |
| `:`, `true`, `false`, `echo`, `printf` (no `-v`), `pwd`, `type`, `help`, `times`, `jobs` (no `-x`), `caller`, `dirs`, `disown`, `suspend`, `logout`, `ulimit` (no `-n`, `-u`), `umask`, `hash`, `bind`, `history`, `kill`, `wait` (no `-p`), `bg`, `fg`, `complete`, `compopt` | `none` (a function named as a callback, `complete -F f`, is not closed: today) |
| `cd`, `pushd`, `popd`; `shift` | names: `PWD`, `OLDPWD`, `DIRSTACK`; the positional parameters (never trusted) |
| `exit`, `return`, `break`, `continue` | followed (jumps; a count not known takes both paths) |
| `declare`, `typeset`, `local`, `export`, `readonly` | followed for `x=w` with no option but `-r`, `-x`, `-g`; names for the other options the spec knows (`-i`, `-a`, `-A`, `-l`, `-u`, `-t`); the nameref rule for `-n`; `all` for a name not known (today), and for an option the spec lacks (`-I`: `declare -I x` in a function keeps the caller's value) |
| `unset` | followed for static names and `-f`; `all` for a name not known (today) |
| `read`, `mapfile`, `readarray`, `getopts`, `printf -v`, `wait -p` | names: the variables they name; `all` for a name not known (today) |
| `mapfile -C`, `readarray -C` | `all` (since the review of steps 1 to 3): bash runs the callback's text in this shell, as `eval` does, with the index and the line after it |
| `ulimit -n`, `ulimit -u` | `all` (since the review of steps 1 to 3): a lower limit makes a redirection (even to `/dev/null`), the pipe of `$( )` or a fork fail |
| `let` | arithmetic (below) |
| `eval` | followed when the walk reads its string; else `all` (today) |
| `source`, `.` | `all` (today) |
| `trap` | followed for an action the walk reads (foreign text); `all` for DEBUG, RETURN, signals not known, or an action not known (today) |
| `alias`, `unalias` | followed for static text; else `all` (today) |
| `jobs -x` | `all` (since the review of steps 1 to 3): it runs its command in this shell |
| `enable` | followed as #387 reads it (`-n NAME`, `-ns NAME`, `-n -s NAME`, `-n -a NAME`, `NAME`; `-p` prints); `all` for `-f`, `-d`, or a name not known |
| `set` | each option, by the table below; the positional parameters (never trusted) |
| `shopt` | each option, by the table below; `all` for a name not known (new) |
| `test`, `[` | followed, precondition: no word may be `-v` with an operand that has a subscript (`-R` evaluates no subscript: `[ -R 'a[u=2]' ]` leaves `u`). That is: no unquoted word that may split into such words, no `"$@"`, and no word that is not static text directly after one that may be an operator (#387); else `all` |
| `command`, `builtin` | the row of the command they run; `command -v`, `-V`: `none` (today) |
| `compgen` | `none` for a quiet word list and no `-F` or `-C`; else `all` (today); `-V x` (5.3): names `x` |
| `fc` | `none` with `-l`; else `all` (today) |
| `exec` | followed with no command (its redirections); with one, the shell ends there (the walk does not mark the code after it dead, which only says less) |

*Options of `set`* (the 27 of `set -o`, the same in 5.2 and 5.3).

| Options | Effect when turned on |
| --- | --- |
| `allexport`, `errexit`, `nounset`, `noglob`, `pipefail`, `monitor`, `braceexpand` (also off), `xtrace` (with the PS4 rule, today) | followed |
| `emacs`, `vi`, `ignoreeof`, `nolog`, `notify`, `verbose`, `hashall`, `physical`, `privileged`, `interactive-comments`, `errtrace`, `functrace` | `none` (`errtrace` and `functrace` only change where ERR, DEBUG and RETURN traps run; DEBUG and RETURN traps are `all`, and an ERR trap's action is foreign text) |
| `histexpand`, `history` | `all` (new): `!!` runs an earlier line |
| `keyword` | `all` (new): an assignment word anywhere in a command is an assignment for it (table of section 1) |
| `noclobber` | followed by the redirection rule below: with it, a `>` may fail on any file (table of section 1) |
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

*Variables of bash.* Here the default differs: a variable with no row is the script's own, a plain variable. So the rows must cover every variable bash gives a meaning: `BASH_VARIABLES` (the manual's sections 5.1 and 5.2, compared with bash by test/bash-variables.test.ts), plus those it lacks today: 5.3's `GLOBSORT`, `BASH_MONOSECONDS` and `BASH_TRAPSIG`, and `TEXTDOMAIN`, `TEXTDOMAINDIR`. Each gets a field `effect`, for what assigning it does to bash (new):

| Variables | Effect of a write |
| --- | --- |
| `BASH_COMPAT`, `FUNCNEST`, `BASH_ALIASES`, `POSIXLY_CORRECT` | `all` (section 1; `POSIXLY_CORRECT` turns on POSIX mode) |
| `LANG`, `LC_ALL`, `LC_CTYPE`, `LC_COLLATE` | `none` for `C`, `POSIX`, `C.UTF-8` or empty; else `all`: case conversion, character classes and ranges follow the locale (manual 5.2) |
| `IFS`, `PS4`, `OPTIND`, `HOME`, `BASH_ENV`, `ENV`, the readonly ones (`SHELLOPTS`, `UID`…), the dynamic ones (`RANDOM`, `PWD`…) | followed (today: the word model, the PS4 rule, arithmetic, the tilde, other shells' models, never trusted) |
| The others (`PATH`, `CDPATH`, `GLOBIGNORE`, `TMOUT`, `HIST*`, `PS1`, `TIMEFORMAT`, `GLOBSORT`…) | `none` |

A prefix assignment of a program (`LANG=de_DE.UTF-8 sort`) is `none`: it goes to the program's environment only. Not so for another shell the model reads (`bash -c`, `sh -c`): what its model starts with (the values given or exported to it, and `SHELLOPTS` and `BASHOPTS` when exported) goes through this table, so `BASH_COMPAT=31 bash -c '…'` makes that model `all` (new).

*Expansions.*

| Construct | Effect |
| --- | --- |
| `$x`, `${x}`, `${#x}`, `${x-w}`, `${x:-w}`, `${x+w}`, `${x:+w}`, `${x?w}`, `${x:?w}`, `#`, `##`, `%`, `%%`, `/`, `//`, `/#`, `/%`, `^`, `^^`, `,`, `,,`, `~`, `~~` | `none` (`?` may end the shell: followed by src/semantics/stops.ts) |
| `${x=w}`, `${x:=w}` | names: `x` (today). A set `x` keeps its value, which may come from the environment (see arithmetic) |
| `${x:o:l}`, a subscript | arithmetic (below; a subscript of an associative array is a key) |
| `${x@Q}`, `@E`, `@A`, `@a`, `@K`, `@k`, `@U`, `@u`, `@L` | `none` |
| `${x@P}` | followed, precondition: every value the script gives `x` is quiet, and none is made with `+=` (new: `+=` joins texts that are quiet alone); else `all` |
| `${!x}` and the other indirections | `all` (today); `${!a[@]}`, `${!a[*]}`, `${!p@}`, `${!p*}` with nothing after them: `none` |
| `$(…)`, backquotes, `<(…)`, `>(…)` | `none` for this shell (a subshell); their own commands are looked up as well |
| `${ …; }`, `${| …; }` (bash 5.3) | `all` (today) |
| `$((…))`, `$[…]` | arithmetic |
| A tilde | followed (the value of `~` is `HOME`'s, where the script sets it: `HOME=/a; x=~`) |
| `$"…"`, brace expansion, a glob | `none` (never given as a value) |

*Redirections.* Here-documents, here-strings, `/dev/null`, and a copy of fd 0, 1 or 2: followed (they do not fail; their words are looked up as words). Any other `<`, `>`, `>>`, `<>`, `>|`, `&>`, `&>>`, `<&`, `>&` may fail, and then its command does not run: followed, with the command taken as "may not run" (the walk merges the state before it with the state after it), except for a command with only assignments, which assigns anyway (new: today the walk takes every redirection as made, [expansion-values.md](expansion-values.md), section 6). `{fd}>…`: names `fd` (today); `{a[i]}>…`: names `a`, and `i` is arithmetic (new).

*Arithmetic* (`(( ))`, `$(( ))`, `let`, `for (( ))`, subscripts, offsets, integer variables, `[[ x -eq y ]]`). Followed, as today: the names it assigns are `names`, and the names it reads must have values the script wrote, since bash runs a value as an expression. The scan's closure is by name, so it cannot see order: `n="$n"`, `${n:=w}`, `n+=x`, `a="$b"; b=0` all let a value of the environment through. Instead of a special case for each, one rule moves to the walk (new): where arithmetic reads a name, its value must be known on every path there, as text the script wrote (no unknown part, nothing kept from before the script set it); else `Walker.found` walks the script again with nothing trusted, as it does today for a name no path has set.

## 3. How the model reads it

**The decision function does not change.** `Trust.blind`, `Trust.variable(name)` and `Trust.closed(name)` keep their meaning and their readers: `StateModel.trusts`, `condition`, `dead`, `settled`, `expansionValue`, the status model and the env model. What changes is how the scan maps constructs to writes and reasons:

- A new module, src/semantics/allow.ts, holds the tables: `SYNTAX: Record<NodeType, Effect>` (the type checker makes it complete), `BUILTINS` (by name), `SET_OPTIONS`, `SHOPT_OPTIONS`, `EXPANSION_OPERATORS`, `REDIRECTIONS`, and the field `effect` of `BASH_VARIABLES`. `Effect` is `none`, `{ followed, unless?, otherwise }`, `{ names }` or `{ all: why }`.
- `Scan.visit` asks the table first. `all` calls `blindFor(why)`, `names` calls `write(…, plain: false)`, and `followed` runs today's handler, which checks the precondition and falls back to `otherwise`. The `switch` of today becomes the handlers of the `followed` rows. A node type, builtin, option or operator with no row is `all`.
- A precondition that needs the value at a point (a name read as arithmetic; a `${x@P}` whose value differs between paths) is checked by the walk, as arithmetic that reads a name no path has set is today: `Walker.found` walks the script again with nothing trusted.

**What it composes with.** The walk (src/semantics/state.ts, src/semantics/walk/) changes in three places only: redirections that may fail, the arithmetic rule above, and the patterns after `;&` and `;;&`. The table states what the walk claims to follow; each `followed` row names the probe rows and generator constructs that test it (section 5). A bug of the walk in a `followed` row (the recursion of `widen`, the patterns after `;;&`) is not caught by the table. The table makes the claim explicit, and its tests check it.

[trust-per-position.md](trust-per-position.md) (deferred) is orthogonal: it would turn `all` into a taint on the paths after the construct, instead of the whole script. The kinds of that page (command, expansion, later) fit the rows here. Nothing here depends on it.

## 4. Cost, measured

**Method.** A prototype of the first draft's rule on trust.ts (about 150 lines behind an environment switch, not committed): `all` for each construct of section 1's first table, for `histexpand`, `history`, `noclobber`, `keyword`, `noexec`, `onecmd`, the `shopt` rows marked `all`, a locale other than C, `BASH_COMPAT`, `FUNCNEST` and `BASH_ALIASES`; for unknown builtin options and `error` nodes; for `${x@P}` with `+=`; for a nameref that names a nameref; for `n="$n"`, `${n:=w}` and `+=` on a name read as arithmetic; and for a pattern after `;&` or `;;&` that reads a name a list before may write. It differs from the tables as they now stand: it lacks `set -o posix`, `POSIXLY_CORRECT` and an unknown `shopt` name (neither set writes them, but for sample.sh, which keeps its values), the shebang, child shells, `jobs -x`, `{a[i]}>`, redirections that may fail and the walk-side arithmetic rule; it has a `case` precondition instead of the walk fix; and it blinds a static glob in `[ ]`, which the tables do not. So this measures the first draft; step 3 (section 6) measures the walk changes. It was measured on two sets, read as data and never run:

- (a) the repository's corpus (test/support/corpus.ts: the fixtures, the host files and the snippets of the tests, as test/snapshot.ts reads them; 1,499 inputs at a8dda2d8, 1,500 at step 0 and 1,502 at #387, as the tests grew);
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

- corpus: 38 snippets with a parse error (`error`), 3 with a builtin option the spec does not know (`read` twice, `declare`), 1 with a static glob in `[ ]` (the prototype's rule, not the tables');
- real: 5 bash-completion files with `complete` options the spec does not know (`-f`, `-u`, `-X`…), 2 with `set -o noclobber` (`add-shell`, `remove-shell`; `gzexe` and `bzexe` were already blind), and 2 helpers in Perl and Python under bash-completion/helpers, which the collection took and our parser cannot read.

The options the specs lack should be added first (section 6, step 1); then the cost is the parse errors only. The rules the review added (redirections that may fail above all: `{ …; } > "$log"` is common) are not in this measure.

**What #387 costs, for comparison.** On the real scripts, #387 takes 173 values to 69. Of the 104 lost, 76 are in `ncurses6-config` and `ncursesw6-config`: `[ $lib_first = yes ]`, where `lib_first` is only ever `yes` or `no`, but the script saves and restores IFS (`save_IFS="$IFS"; IFS=':'; …; IFS="$save_IFS"`), and #387 requires every value of IFS to be static text. On step 0 with a test-word rule of its own (instead of #387's), the prototype followed copies (`IFS` from `save_IFS` from `IFS`) and kept those 76 (145 values in 18 files, 676 blind). But that rule also asked less than #387's, and the review showed it unsound: `x=-v; [ $x 'a[u=2]' ]` sets `u`, since the `[` comes from the static word. The sound change is #387's check (no value may split into `-v`) with copies of IFS followed; it should keep the 76, but it is not measured. The other 28 (`znew`, `service`, `xml2-config`, `select-editor`) are lost either way: their words come from `$1`, `read` or command output.

**The decisions' generator** (test/support/decisions.ts, `scripts(1, 120)`, the model only): step 0 decided 114 conditions and marked 966 statements dead, with 63 scripts blind; #387: 73, 598 and 78. The allow-list without its `case` precondition changes none of these; with it: 51, 450 and 87. The generator writes variables in `case` lists and reads them in patterns after `;;&` on purpose (that is how the review found the hole), so a precondition costs most there. So the plan fixes the walk instead (step 3), and puts no precondition on `case`.

## 5. Tests

- **Completeness, against bash.** test/allow-list.test.ts runs bash 5.2 (and 5.3 from `$BASH_EXPLAINER_BASH53`) with an empty environment and compares the tables with `compgen -b`, `set -o` and `shopt`: every builtin and option has a row, and no row names one that bash lacks, except the rows marked for 5.3 only (`array_expand_once`, `bash_source_fullpath`) when it runs bash 5.2. `BASH_VARIABLES` is already compared with bash (test/bash-variables.test.ts); each entry must now have an `effect`. `SYNTAX` is complete by its type. Each builtin's options are compared with what bash accepts (`help -s` and the usage bash prints for an invalid option), so `bopt` finds a missing option of a spec, not a wrong `all`.
- **Every `followed` row is tested.** Each row lists the probe rows (test/fixtures/probes/*.json) and the generator constructs that exercise it; a test fails on a `followed` row with none, and on a listed row that does not exist.
- **The property.** For any script that holds a construct whose effect is `all`, the model gives no value, decides no condition and marks nothing dead. The generator checks it directly: test/decisions.test.ts gets "unknown construct" statements at random points (`shopt -s compat42`, `set -C`, `set -k`, `FUNCNEST=1`, `BASH_ALIASES[1]=…`, `set -o history -H` with a `!` line, `enable -ns exit`, `shopt -s localvar_inherit`, a builtin option no spec has), and asserts `blind` on those scripts, besides the existing differential check (no decision, value or dead mark that bash contradicts). Its floors (more than 50 decisions and 200 dead marks over 120 scripts) count only the scripts without such statements, and those statements go into a fifth of the scripts at most, so the floors keep their meaning.
- **Each finding and its variants.** Rows in values.json, recorded with bash: the twelve holes of section 1; the four open findings of the #382 review (`: "${n:=0}"`, `n="$n"`, `n+=x`, `localvar_inherit` read as arithmetic with `n='y=5'` in the environment; `x='\0'; x+='44((u=2))'` for `${x@P}`; `set -o history -H` with `!-2`; `;;&` with a pattern that a list before writes); and one variant each that is safe and keeps its value (a static pattern after `;;&`, `LC_ALL=C`, a prefix `LANG=… sort`, `IFS` saved and restored, `> /dev/null`, a here-document, `HOME=/a; x=~`).
- **The corpus**, before and after each step, with the counter of section 4 (the measuring script goes to scripts/, as [trust-per-position.md](trust-per-position.md), section 8, asks): no file may lose a value except for a row marked "new", and each loss is read by hand.

## 6. Steps

Each step keeps every test passing.

| Step | Status |
| --- | --- |
| 1. The specs | Done (2026-10-26) |
| 2. The table, with today's behaviour | Done (2026-10-26) |
| 3. The walk | Done (2026-10-26) |
| 4. The default flips | Done (2026-10-26) |
| 5. Docs | Done (2026-10-27) |

1. **The specs first.** Every builtin's options as bash 5.2 and 5.3 accept them (`complete -f`, `-u`, `-X` and the others, `declare -I`, those of `read` the corpus uses, and the rest the comparison of section 5 finds), with test/builtins-real.test.ts. Nothing users see changes, except the explanation of those options.

   Done. test/builtins-real.test.ts compares each builtin's options with the letters of `help -s` in bash 5.2 and 5.3 (every builtin of `compgen -b`; the options a spec has beyond the usage line, such as `kill -9`, are listed with why). It found `complete` (`-abcdefgjksuv`, `-A`, `-G`, `-X`, `-P`, `-S`, `-D`, `-E`, `-I`), `compgen` (the same letters, `-F`, `-C`), `compopt` (`-D`, `-E`, `-I`), `cd -e`, `ulimit -R` and `declare`/`typeset`/`local -I`. bash lists `ulimit -k`, `-P`, `-T` and `cd -@` too, but refuses them on Linux; they stay out. `read -l`, `read -q`, `read -z` and `declare -Q`, the corpus's other unknown options, are refused by bash (snippets of tests, and a zsh branch in npm's completion). Two rows needed more than the spec: `compgen -F` and `-C`, now known options, still make the scan blind (`-F` runs its function in the shell); and `declare -I x` in a function keeps the value from outside (the scan writes `kept`, the walk takes the value as not known), where before the scan took it as a new local with no value.
2. **The table, with today's behaviour.** src/semantics/allow.ts with every row, and today's effect in each: `none` where the scan lets a construct through today. The scan reads the table; the default for a missing row is still `none`. Every explanation stays byte-identical (test/snapshot.ts). The completeness tests of section 5 land here.

   Done. src/semantics/allow.ts holds the tables: `SYNTAX` (a `Record` of every `NodeType`), `BUILTINS` (the 61, each with a row for an option its spec does not know), `SET_OPTIONS`, `SHOPT_OPTIONS` (an option's row is for turning it on, with `off` where turning it off differs), `EXPANSION_OPERATORS` (by `expansionOperator`: `length`, `:-`, `@P`, `!`, `![@]`…), `REDIRECTIONS`, and the field `effect` of each entry of `BASH_VARIABLES` (src/semantics/vars.ts), which now also has `GLOBSORT`, `BASH_MONOSECONDS`, `BASH_TRAPSIG`, `TEXTDOMAIN` and `TEXTDOMAINDIR`. Each row holds today's effect, and `next` the effect step 4 gives it (the rows marked "new"); `UNLISTED`, the row of a construct the table lacks, is `none` with `next` `all`. A `followed` row names its checks in `tests`: a probe row by its `id` (`status#arith-command`), a construct of the decisions' generator by its name in `GENERATED` (`generator: case`), or a test of a test file by its exact title (`test/nested.test.ts: starts another shell with its options, …`); test/allow-list.test.ts checks that each names exactly one. The scan asks the table in one place, `Scan.apply`: at each named node, each write of a variable, each operator of an expansion and of a redirection, each option of `set` and `shopt`, and each builtin (its unknown options first); `all` trusts nothing, and `none` skips the handler. What the specs say (variables an option or operand names, callbacks, `runsUnread`, `alters`) is still read from them for every builtin; test/allow-list.test.ts checks that the rows agree (`source`, `.`; the command slots that run in this shell: `eval`, `command`, `builtin`, `trap`, and `jobs -x`, whose row is `all` in step 4).

   test/allow-list.test.ts compares the tables with `compgen -b`, `set -o` and `shopt` of bash 5.2 and 5.3, the operators of parameter expansion with the terms of the manual's 3.5.3 (and `~`, `~~`, which bash takes beyond it), and the redirection operators with 3.6; it checks that every `tests` entry is there. The snapshot of the corpus, the probe tables (one row added, for `<<-`) and the model's decisions on 1,000 generated scripts (blind reasons, conditions, dead statements and values) are the same as before. One hole of the scan showed while writing the `set` and `shopt` rows, and is fixed: `shopt -so allexport` exports the functions defined after it, as `set -a` does, and the scan did not read it.

   The review of steps 1 to 3 added rows for options (`BuiltinRow.options`, `all` today): `jobs -x`, `mapfile -C` and `readarray -C`, and `ulimit -n` and `-u`. The specs now type `mapfile -C` as code this shell runs (it was a function's name: bash runs any text there, `mapfile -C 'x=2; :'`), and `compgen -C` and `complete -C` as code a subshell runs. test/allow-list.test.ts checks every callback of a builtin against bash (where it runs: this shell, a subshell, or only in an interactive shell, as `complete`, `bind -x` and `PROMPT_COMMAND`), and that each row names its checks precisely: a probe row by its `id`, a test by its exact title, a construct of the generator by its name in `GENERATED`.
3. **The walk.** Redirections that may fail make their command "may not run"; the patterns after `;&` and `;;&` are expanded in the state after the list before them; a name read as arithmetic must have a value known on every path there (`Walker.found` otherwise). Each with probe rows. Measure the corpus and the real scripts: the redirection rule may cost values after `{ …; } > "$log"`. Users see fewer wrong values and dead marks (CHANGELOG "Fixed").

   Done, with copies of IFS. Each change was measured on the corpus (1,517 inputs at this step), the 802 real scripts and 1,000 generated scripts (the counter of section 4 and the model's decisions on `scripts(1, 1000)`), against step 2:

   | Change | Corpus: values (files), decisions, dead, blind | Real: values (files), blind | Generated: blind, decisions, dead, values |
   | --- | --- | --- | --- |
   | Step 2 | 32 (13), 26, 9, 159 | 69 (16), 668 | 631, 623, 1,702, 801 |
   | Redirections that may fail | the same | the same | the same |
   | Patterns after `;;&` | the same | the same | 632, 618, 1,662, 804 |
   | Arithmetic: values known on every path | the same | the same | the same |
   | Copies of IFS | the same | 145 (18), 665 | the same |

   - *Redirections.* `redirectionMayFail` (src/semantics/walk/conditions.ts): every file redirection but `safeRedirect`'s, a copy of fd 0, 1 or 2, closing a descriptor, and one from or to a process substitution. The walk merges the state after the redirections with the state after the command (`Walker.mayNotRun`), for a simple command and a compound one (a function defined with a redirection gets it at each call). It cost nothing measured: the redirections in the corpus that may fail are on programs, or in subshells and pipelines. One state probe (`declare n=… > f$(( m++ ))`) and one test (`{ set -f; } > out`) now say "may"; the probe lists it in `gaps`.
   - *`case`.* The decision (`WalkConditions.caseRuns`) is not made when testing goes on past `;;&` to patterns that are not static text, or after a list that may change an option a pattern reads (`shopt`, `eval`, `source`, a function, an alias). The walk expands the patterns after a `;;&` list in the state that list leaves. On the generated scripts this costs 5 decisions and 40 dead statements, in scripts whose patterns read `$mode` or `$flag` after a list that writes them; one more script walks again with nothing trusted. The differential check finds no contradiction on the 1,000 scripts, before and after.
   - *Arithmetic.* `VariableState.kept` marks a value the script may not have written there: a variable absent on one path of a merge (the environment's), or made of such a value (`n="$n"`, `a="$b"` while `b` is unset, `n+=x`, `${n:=w}` of an unset `n`, `export n`, `declare n`). `Walker.unsetRead`, which ran arithmetic again with nothing trusted only for a name no path had set, now also does so for a `kept` one. IFS is never `kept`: bash ignores an IFS in the environment. One fix came with it: `$(( ${#a[@]} * 2 ))` no longer "may fail" (a length is a number), which kept the web page's sample from trusting nothing.
   - *Copies of IFS.* The check of the words of `test` that may split (`testSplits`, now in src/semantics/testwords.ts) follows a value of IFS that copies a variable whose values are text the script wrote or copies of IFS (which starts as space, tab and newline). The walk checks, at each such copy (`Trust.copied`), that the variable is set there on every path and not `kept`. This wins back the 76 values of `ncurses6-config` and `ncursesw6-config` that #387 lost, and `update-shells` no longer trusts nothing.
   - *The review of steps 1 to 3* found these holes, each checked with bash (test/trust.test.ts, test/decisions.test.ts), and fixed here (rows of the table: step 2):
     - *Copies of IFS* through a `for` variable, an array or `$(( ))` were taken as empty (`for s in 0; do :; done; IFS=$s`, `s=( 0 )`, `s=$((0))`, `IFS=$((0))`, `for IFS in 0`): a written value now keeps the texts it may take (`each`, src/semantics/written.ts) and whether a number is in it (`arith`: any digits or `-`). `testSplits` split each value of a `[` word by each value of IFS in turn, not by all of them at once (`IFS=v; IFS=:` and `x='-v:'`: `IFS=:` gives `-v`). `x+=v` (`x=-; x+=v` is `-v`) is followed when no value of `x` has a `-`; `IFS+=x` is not followed. A variable a word of `[` splits must be set there on every path, as a copy into IFS must (`Trust.copied`): `[ -n "$z" ] && x=a; [ $x … ]` may split an `x` of the environment.
     - *A copy of fd 0, 1 or 2* may fail where the script may close one of them (`Trust.fdsMayClose`, src/semantics/redirects.ts): `exec 1>&-`, `>&-` on a command (also a function, whose body then runs with it closed, and in the same list: `>&- 2>&1`), a move (`3>&1-`), a copy from a word not known (`>&$x`), `{v}>&-`, and any write of `BASH_XTRACEFD` (unsetting it, or making it empty, closes the fd it named). The whole script is read at once: one such redirection anywhere makes every copy one that may fail. It cost nothing measured.
     - *`case`*: the commands of a list before patterns tested after `;;&` may change no more than variables, by their rows (`changesOnlyNames` in src/semantics/walk/conditions.ts: `none` or `names` for the builtin, the options given, an option the spec lacks and each variable assigned, and no callback), instead of a list of builtins (`jobs -x shopt -s nocasematch` was missed). `test` and `[`, `followed` for their `-v` rule, now stop the decision too.
     - *`set -e`* (the maintainer's decision): where errexit is surely on and not ignored (the walk's `quietly`: a condition, the left of `&&` and `||`, `!`, a function called there; `$( )` turns it off without inherit_errexit), a redirection that fails ends the shell, so the code after it runs only when the command ran: `set -e; x=1; { x=2; } > out.txt; [ "$x" = 1 ]` is always false (`WalkConditions.mayNotRun`).
     - *Arithmetic*: an array is `kept` when one of its elements may be (`a[0]=$q`, `a=("$q")`, `a+=("$q")`, `declare -a a=([0]="$q")`), and an element read as arithmetic (`(( a[0] ))`) is checked as a name is. A tilde reads `HOME` (`m=~`, `declare m=~`, `m=(~)`, `: ${a[m]}`), and `~user` a value not known, both in the scan and in the walk's `kept`.

   Measured as above, one change at a time, with the generator of step 3 (the extended one below changes the scripts):

   | Change | Corpus: values (files), decisions, dead, blind | Real: values (files), blind | Generated: blind, decisions, dead, values |
   | --- | --- | --- | --- |
   | Step 3 | 32 (13), 26, 9, 160 | 145 (18), 665 | 632, 618, 1,662, 804 |
   | Rows (step 2's level): `mapfile -C`, `jobs -x`, `ulimit -n` | 32 (13), 26, 9, 161 | the same | the same |
   | Copies of IFS, each IFS apart, `+=`, split variables set | the same | the same | 638, 607, 1,637, 795 |
   | Copies of fd 0, 1 and 2 | the same | the same | the same |
   | `case`: lists by their rows | the same | the same | 638, 606, 1,631, 796 |
   | `set -e` | the same | the same | the same |
   | Arrays `kept`; tildes | the same | the same | the same |

   The decisions' generator now also writes what the review found (test/support/decisions.ts): redirections that may fail around a group (with `set -e` or not), closed and copied standard descriptors, copies of IFS through `for`, arrays and `$(( ))` before a `[` word that may split into `-v` and a subscript that assigns, arrays and tildes read as arithmetic with `q='w=7'` and `HOME='w=8'` in bash's environment, and callbacks that run code (`mapfile -C`, `jobs -x`).
4. **The default flips.** A missing row is `all`, and the rows marked "new" take their effect: the options (also from the shebang), the variables of bash (also those given to another shell), `jobs -x`, `{a[i]}>`, `${x@P}` with `+=`, `error` nodes. Each with its probe rows and the generator's "unknown construct" statements. Users see fewer wrong values and dead marks (CHANGELOG "Fixed": one bullet, the details in docs/changes).

   Done. Each row holds its effect (the field `next` is gone), and a construct with no row trusts nothing, with a reason that names it (`unlisted`: "the node type `x`", "`shopt -s nosuch`", "the parameter expansion `${x@Z}`", "the redirection operator `x`", "… which the allow-list does not have"). What changed besides the rows marked "new":

   - *The start of a shell.* The shebang's options and assignments go through the tables as if set on the first line (`Opening`, src/semantics/opening.ts): `#!/bin/bash -k`, `#!/usr/bin/env -S bash -O compat31` (the walk now also starts with that `shopt` option on) and `#!/usr/bin/env -S BASH_COMPAT=42 bash`. So do another shell's invocation and the variables it starts with (`childOpening`, read in `childModel`, src/semantics/state.ts): `bash -O compat31 -c`, `bash -k -c` (an option the spec of `bash` lacks is now passed on as written, `shellInvocation`), `BASH_COMPAT=31 bash -c`, `env BASH_COMPAT=31 bash -c`; its model walks again with nothing trusted. POSIX mode at the start (`#!/bin/bash --posix`, `POSIXLY_CORRECT=1` in `env -S`, `bash -o posix -c`) is left out: the walk follows it from the start, as for `sh`.
   - *Prefix assignments of a program* (`LANG=de_DE.UTF-8 sort`, `BASH_COMPAT=31 bash -c …`) do not go through the variables' table for this shell: a static name that is no builtin of bash, no function of the script or its host, in a script that defines no alias (`Scan.program`).
   - *Locales.* `LANG`, `LC_ALL`, `LC_CTYPE` and `LC_COLLATE` are followed when every value the script gives them is `C`, `POSIX`, `C.UTF-8`, `C.utf8` or empty, or unset, or kept from the environment (`localeWritten`; for another shell, the static value given). Any other value, a value not known, or `+=` trusts nothing.
   - *Options turned off.* `set +k`, `+H`, `+o history`, `+n`, `+t` and `shopt -u` of the `compat` options and the others turned on as `all` change nothing (`off: none`); `set +o posix` stays `all`.
   - *Names not known.* `set -o "$x"`, `shopt -s "$x"`, and a word not known before the operands of `set` (`set $x`, which may be `-k`) trust nothing; before, they only exported the functions defined after them. Since #498, a word of `set`, of a declaration or of a builtin whose options or operands name variables or functions, whose variables the script sets only to text it wrote, is read as the fields of each such value and of none, with braces on and off (`x=-e; set $x`, `set -o $y`, `set {-e,-u}`, `x=-f; declare $x g`, `x=-v; printf $x u 2`: `Scan.readDeferred`); the walk reads it so too (`Trust.expands`), and walks again with nothing trusted where it does not know the fields there. A word whose value is not known still trusts nothing in `set`.
   - *Builtins' options.* The unknown option of `test` and `[` is `none`: their words are the expression's (`[ -a file ]`, `[ -o errexit ]`). That of the declarations (`declare -Q`) is `all`, as the table says, instead of `names`. A name of the dictionary that is no builtin of bash (zsh's `setopt`, `print`) runs a program in bash: `none` (`PROGRAM`).
   - An empty assignment (`x=`) gives a value known in full (`writtenValue`), so `LC_ALL=` keeps the trust.
   - *The review of step 4* found these, each checked with bash 5.2 (test/allow-list.test.ts, test/decisions.test.ts), and fixed here:
     - An empty command name, unquoted (`cmd=; $cmd eval x=2`): the next word is the command. The empty value above made it look safe; an unquoted command variable must now be non-empty.
     - At its start, bash turns on the options SHELLOPTS and BASHOPTS list, and POSIX mode for POSIX_PEDANTIC. In a shebang's `env -S`, SHELLOPTS and BASHOPTS are read as those options (the walk starts with them) and go through the option tables; POSIX_PEDANTIC, and the three given to another shell (`env SHELLOPTS=keyword bash -c`), trust nothing. An exported SHELLOPTS still passes the outer model's options.
     - Every start option the table does not have trusts nothing (`Opening.others`): `-r` (a redirection fails in a restricted shell), `-i`, `-l`, `--login`, `--debugger`, `-s`, a word left before the script's path. `-c`, `--norc`, `--noprofile`, `--noediting`, `--posix`, `-` and `--` change nothing else (`HARMLESS_START`). So do `-o` and `-O` with a name not known (`bash -O "$o" -c`), and an `env -S` line not read in full (`-S -u LANG bash`, `-Sbash`).
     - A write through a nameref is one of its targets, also through a chain, by the target's row (`declare -n r=BASH_COMPAT; r=31`), and the PS4 check and the words of `test` read those writes too.
     - `#!/bin/bash -a` exports the functions defined after it, as `set -a` does.
     - `env 'BASH_COMPAT=31' bash -c`: a quoted assignment of `env` is given by its value (src/semantics/env.ts).
     - The values given to another shell are taken from its assignments only, not from the words after the string (`bash -c '…' LC_ALL=C` is a parameter); names not known (`docker run --env-file f`) trust nothing.
     - The probe row `values#locale-other` shows no effect of the locale in bash's output: the machines that record the probes have no German locale. It checks only that the model gives no value.
     - To keep trust.ts under 1,000 lines, the `Trust` interface, `HostCommands`, `StringTrees`, `BLIND` and `withinTrust` moved to src/semantics/trustmodel.ts.

   test/allow-list.test.ts checks that a construct with no row (a node type no parser gives, an option, an operator) trusts nothing, and the start of a shell against bash (a shebang run as a program, `BASH_COMPAT=31 bash -c`). values.json has rows for the holes of section 1 (each recorded with bash), for a locale of C, and for a prefix assignment of a program. The decisions' generator puts an unknown construct (`UNKNOWN_CONSTRUCTS`, test/support/decisions.ts: `shopt -s compat42`, `BASH_COMPAT=42`, `set -k`, `FUNCNEST=1`, `BASH_ALIASES[1]=…`, `set -o history -H`, `shopt -s localvar_inherit`, `read -Q`, `set -o posix`, `shopt -u extquote`, a locale, `shopt -s nosuch`, `${v@Z}`) into a fifth of the scripts of `withUnknown`, by a generator of its own; test/decisions.test.ts checks that each such script is blind, decides nothing and marks nothing dead, and that bash contradicts none of them. This mostly restates the rows; it would catch a row the scan does not reach. `scripts(seed, n)` is unchanged, so its floors keep their meaning.

   Measured against step 3 (the counter of section 4; both on the corpus of this step, whose snippets of the tests differ from those of step 3 by one, so step 3 counts 160 blind inputs here and 161 in its own table):

   | Set | Values (files) | Decisions | Dead | Blind |
   | --- | --- | --- | --- | --- |
   | Corpus (1,518 inputs), step 3 | 32 (13) | 26 | 9 | 160 |
   | Corpus, step 4 | 32 (13) | 25 | 9 | 213 |
   | Real scripts (802), step 3 | 145 (18) | 0 | 0 | 665 |
   | Real scripts, step 4 | 145 (18) | 0 | 0 | 667 |
   | Generated (`scripts(1, 1000)`), step 3 and step 4 | 746 | 534 | 4,663 | 641 |

   - The corpus: 53 more inputs trust nothing, 38 of them for a parse error. The others: `set -o posix` (5), `read -q`, `read -z` and `declare -Q` (options bash refuses), `${(f)var}`, `${(j:,:)arr}`, `${x@Z}` and `${x@w}` (expansions bash rejects), `set +o globstar` and `shopt -s foo` (names bash does not have). One decision is lost: `if true; then echo ${(f)x}; fi`, a zsh expansion that bash rejects ("bad substitution") at run time; the model no longer decides the `if` of a script it cannot read. The snapshot of the corpus (test/snapshot.ts) is byte-identical: no explanation shows a decision or a value that changed.
   - The real scripts: 2 more trust nothing, the Perl and Python helpers of bash-completion that the parser cannot read. `add-shell` and `remove-shell` (`set -o noclobber`) keep their trust: `noclobber` is followed (step 3 takes every redirection to a file as one that may fail). No value is lost.
   - Section 4 predicted 51 more blind files (42 in the corpus, 9 real), and no value lost. Measured: 55 (53 and 2). The corpus adds `set -o posix`, the names and the expansions bash rejects, which the prototype did not count; the real scripts lose 7 of the 9, since step 1 put the options of `complete` in its spec and `noclobber` is followed.
   - The generated scripts are the same: none uses a construct whose row changed.
5. **Docs**: [semantics.md](semantics.md) 4.14 ("What decisions trust": the table replaces the lists), [expansion-values.md](expansion-values.md) section 3, README's Limitations (the assumptions about the start: those of [trust-per-position.md](trust-per-position.md) section 2, `BASH_COMPAT`, `POSIXLY_CORRECT`, `FUNCNEST`, `BASHOPTS` and the locale from the environment, and how the script is started: `bash -k script`, `sh script`), the roadmap and this page's status.

   Done. semantics.md 4.14 ("What decisions trust") and expansion-values.md section 3 say what the table does: the effects, the default for a construct with no row, the start of a shell, what is followed and what blinds, and point here and to src/semantics/allow.ts rather than copy the tables. README's Limitations (en and ja) say that the model assumes a default start, that it decides nothing when the script changes that start itself (shebang options, `env -S`, `BASH_COMPAT`, `POSIXLY_CORRECT`, `FUNCNEST`, a locale other than C), and that it cannot see the environment, `SHELLOPTS`, `BASHOPTS`, nor the options of `bash -k script` or `sh script`.

**Risks.**

- **A wrong `followed` row.** The table can claim too much. The rows are checked against bash by their probe rows, and the generator's property covers the rest; the reviews should still try to find a construct the table follows wrongly.
- **Upkeep.** A new option in a spec needs a row (or it is `all`), and so does a new builtin or shopt option of a later bash (the completeness test fails until it has one). That is the point of the plan, but it is work on every spec change.
- **Subshells.** An `all` construct inside `( … )` or `$( )` blinds the whole script, though its effect stays in the subshell (`(umask 77; set -C; > "$tmp")` in zdiff). That is over-strict but safe; confining it is a refinement for later, or part of trust per position.
- **Parse errors.** `error` as `all` blinds any script our parser cannot read in full. On the corpus this cost no value; if it does later, a narrower rule (only the statement that holds the error, and what follows it) can come with trust per position.
- **Sample and examples.** The web page's sample must keep its values (test/expansion-values.test.ts checks it); #387 already changed its `[ $answer = yes ]` line. Step 3 checks the worked examples of every spec (src/examples/) for values they lose.

## 7. For the maintainer

- The first draft of the allow-list cost no value, decision or dead mark on either set, on top of #387. The rules its review added (redirections that may fail, arithmetic values known at the point) are walk changes whose cost step 3 measures. Together they close the twelve holes of section 1 and the four findings of the #382 review that #387 leaves open, and they make the next such hole fail toward "no value".
- #387's rule for IFS loses 76 values in two real scripts that save and restore IFS. Following copies of IFS, with #387's check kept, should keep them (section 4). That can be done in #387 or in step 3 here.
- POSIX mode is `all` until the POSIX-mode rows of the roadmap's bash 5.3 item are done. Scripts that turn it on are rare; sh scripts, which start in it, keep their model.
